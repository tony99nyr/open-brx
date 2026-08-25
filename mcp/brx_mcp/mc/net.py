"""M-NET server — the node↔MC WebSocket (docs/spec/net.md, contracts.md §5/§7/§9, A5).

`NetServer` is an asyncio component the M-MC core composes: it moves envelopes and enforces the
wire rules (version gate, validation, size cap, per-node seq dedup + ack, status path with
t_recv, staleness, takeover, rogue quarantine, time service) and never interprets an Event body.

    net = NetServer()
    net.hydrate(lambda hello: core.welcome_node_for(hello))   # MC answers by gun first, node_id second
    net.on_event(core.ingest)      # (node_id, ev, t_recv)  — post-dedup persisted facts only
    net.on_status(core.status)     # (node_id, body, t_recv) — live-only heartbeat, latest wins
    await net.start("0.0.0.0", 8765)
    net.push(node_id, "config", {...}); net.broadcast("start", {...})

Requires `websockets>=13` (asyncio API). Import of this module does not require it; `start()` does.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import socket
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

from . import envelope as E
from .types import PROTOCOL_V, STALE_AFTER_MS, STATUS_HEARTBEAT_MS

log = logging.getLogger("brx.mc.net")

HELLO_TIMEOUT_S = 5.0          # net.md §8: no valid hello within the grace window → close
REORDER_WINDOW = 256           # net.md §4: small recent-set to tolerate reordering
WS_PING_INTERVAL_S = STATUS_HEARTBEAT_MS / 1000.0   # server-initiated ping at the heartbeat cadence
WS_PING_TIMEOUT_S = STALE_AFTER_MS / 1000.0

_CLOSE_POLICY = 1008
_CLOSE_TAKEOVER = 4000
_CLOSE_VERSION = 4001


def lan_ip() -> str:
    """Best-effort LAN address of this host (the UDP-connect trick; no packet is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


@dataclass
class NodeRecord:
    """Everything MC-side knows about one node_id. Survives disconnects (stale, not gone)."""

    node_id: str
    node_type: str = "phone"
    app_ver: str = ""
    gun_name: str | None = None
    gun_tail: str | None = None
    gun_fw: str | None = None
    player_id: str | None = None
    ws: Any = None                     # live ServerConnection or None
    hello_ok: bool = False
    last_seen: float = field(default_factory=time.monotonic)   # monotonic seconds
    stale: bool = False
    seq_hi: int = 0                    # highest persisted seq applied
    applied: deque = field(default_factory=lambda: deque(maxlen=REORDER_WINDOW))
    malformed: E.MalformedCounter = field(default_factory=E.MalformedCounter)

    @property
    def connected(self) -> bool:
        return self.ws is not None

    def view(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id, "node_type": self.node_type, "app_ver": self.app_ver,
            "gun_name": self.gun_name, "gun_tail": self.gun_tail, "gun_fw": self.gun_fw,
            "player_id": self.player_id, "connected": self.connected, "stale": self.stale,
            "last_seen_ms": int((time.monotonic() - self.last_seen) * 1000), "seq_hi": self.seq_hi,
        }


class NetServer:
    """Implements `interfaces.NetServer` (sync callback registration; async start/stop)."""

    def __init__(self, *, session_id: str | None = None, stale_after_ms: int = STALE_AFTER_MS,
                 hello_timeout_s: float = HELLO_TIMEOUT_S, ping_interval_s: float = WS_PING_INTERVAL_S):
        self.session_id = session_id or uuid.uuid4().hex[:8]
        self.stale_after_ms = stale_after_ms
        self.hello_timeout_s = hello_timeout_s
        self.ping_interval_s = ping_interval_s
        self.nodes: dict[str, NodeRecord] = {}
        self._hydrate: Callable[[dict], dict | None] | None = None
        self._on_node: list[Callable[[dict], None]] = []
        self._on_event: list[Callable[[str, dict, int], None]] = []
        self._on_status: list[Callable[[str, dict, int], None]] = []
        self._on_node_message: list[Callable[[str, str, dict, int], None]] = []
        self._on_stale: list[Callable[[str, int], None]] = []
        self._on_return: list[Callable[[str], None]] = []
        self._server = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stale_task: asyncio.Task | None = None
        self._host = "0.0.0.0"
        self._advertised_host: str | None = None
        self._port = 0
        self._ws_path = "/ws"
        self._zeroconf = None
        self.stats = {"malformed": 0, "quarantined": 0, "takeovers": 0, "replays": 0, "events": 0}

    # ---------------- registration (interfaces.NetServer) ----------------
    def hydrate(self, cb: Callable[[dict], dict | None]) -> None:
        self._hydrate = cb

    def on_node(self, cb: Callable[[dict], None]) -> None:
        self._on_node.append(cb)

    def on_event(self, cb: Callable[[str, dict, int], None]) -> None:
        self._on_event.append(cb)

    def on_status(self, cb: Callable[[str, dict, int], None]) -> None:
        self._on_status.append(cb)

    def on_node_message(self, cb: Callable[[str, str, dict, int], None]) -> None:
        self._on_node_message.append(cb)

    def on_stale(self, cb: Callable[[str, int], None]) -> None:
        self._on_stale.append(cb)

    def on_return(self, cb: Callable[[str], None]) -> None:
        self._on_return.append(cb)

    # ---------------- lifecycle ----------------
    async def start(self, host: str = "0.0.0.0", port: int = 8765, ws_path: str = "/ws",
                    *, advertise_host: str | None = None) -> None:
        from websockets.asyncio.server import serve
        from websockets.http11 import Response

        self._loop = asyncio.get_running_loop()
        self._host, self._ws_path = host, ws_path
        self._advertised_host = advertise_host

        def process_request(connection, request):
            if request.path != ws_path:
                return Response(404, "Not Found", None, b"not found\n")
            return None

        self._server = await serve(
            self._handler, host, port,
            process_request=process_request,
            ping_interval=self.ping_interval_s, ping_timeout=WS_PING_TIMEOUT_S,
            max_size=E.MAX_ENVELOPE_BYTES + 1024,
            compression=None,
            close_timeout=1.0,   # a quarantined/taken-over peer with a backed-up inbox must not hold us for 10 s
        )
        self._port = self._server.sockets[0].getsockname()[1]
        self._stale_task = self._loop.create_task(self._stale_loop())
        log.info("M-NET listening on %s", self.join_info()["url"])

    async def stop(self) -> None:
        if self._stale_task:
            self._stale_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._stale_task
            self._stale_task = None
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        if self._zeroconf is not None:
            with contextlib.suppress(Exception):
                self._zeroconf.close()
            self._zeroconf = None

    @property
    def port(self) -> int:
        return self._port

    def join_info(self) -> dict[str, Any]:
        host = self._advertised_host
        if host is None:
            host = self._host if self._host not in ("", "0.0.0.0", "::") else lan_ip()
        url = f"ws://{host}:{self._port}{self._ws_path}"
        return {"url": url, "session_id": self.session_id, "qr": url}

    def advertise_mdns(self) -> bool:
        """Publish `_openbrx._tcp` via zeroconf if the package is available (net.md §3). Returns
        True if advertising. Optional — QR/manual entry are the mandatory paths."""
        try:
            from zeroconf import ServiceInfo, Zeroconf
        except ImportError:
            log.info("zeroconf not installed — mDNS advertising skipped")
            return False
        host = self.join_info()["url"].split("//")[1].split(":")[0]
        info = ServiceInfo(
            "_openbrx._tcp.local.", f"mc-{self.session_id}._openbrx._tcp.local.",
            addresses=[socket.inet_aton(host)], port=self._port,
            properties={"ver": str(PROTOCOL_V), "session_id": self.session_id, "ws_path": self._ws_path},
            server=f"openbrx-{self.session_id}.local.",
        )
        self._zeroconf = Zeroconf()
        self._zeroconf.register_service(info)
        return True

    # ---------------- downlink ----------------
    def push(self, node_id: str, kind: str, body: dict) -> bool:
        """Best-effort send to one node. Returns False if the node has no live socket."""
        rec = self.nodes.get(node_id)
        if rec is None or rec.ws is None:
            return False
        self._send(rec, kind, body)
        return True

    def broadcast(self, kind: str, body: dict) -> int:
        n = 0
        for rec in list(self.nodes.values()):
            if rec.ws is not None:
                self._send(rec, kind, body)
                n += 1
        return n

    def node_views(self) -> list[dict[str, Any]]:
        return [r.view() for r in self.nodes.values()]

    def _send(self, rec: NodeRecord, kind: str, body: dict) -> None:
        text = E.encode(E.make_envelope(kind, body))
        ws = rec.ws
        if ws is None or self._loop is None:
            return

        async def _go():
            try:
                await ws.send(text)
            except Exception as e:      # socket gone between check and send — best-effort
                log.debug("push %s to %s failed: %s", kind, rec.node_id, e)

        self._loop.create_task(_go())

    # ---------------- per-connection handler ----------------
    async def _handler(self, ws) -> None:
        peer = getattr(ws, "remote_address", None)
        rec: NodeRecord | None = None
        counter = E.MalformedCounter()
        try:
            # --- hello gate (net.md §8 rogue handling) ---
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=self.hello_timeout_s)
            except asyncio.TimeoutError:
                self.stats["quarantined"] += 1
                log.info("no hello from %s within %.1fs — closing", peer, self.hello_timeout_s)
                await ws.close(_CLOSE_POLICY, "no hello")
                return
            try:
                env = E.decode(raw)
            except E.EnvelopeError as e:
                self.stats["malformed"] += 1
                if e.reason == "version":
                    with contextlib.suppress(Exception):
                        await ws.send(E.encode(E.make_envelope("control", {"cmd": "end", "reason": "version"})))
                    await ws.close(_CLOSE_VERSION, "version")
                else:
                    await ws.close(_CLOSE_POLICY, f"bad hello: {e.reason}")
                return
            if env["kind"] != "hello":
                self.stats["quarantined"] += 1
                await ws.close(_CLOSE_POLICY, "first frame must be hello")
                return
            rec = await self._on_hello(ws, env)
            counter = rec.malformed

            # --- main loop ---
            async for raw in ws:
                t_recv = E.now_ms()
                try:
                    env = E.decode(raw)
                except E.EnvelopeError as e:
                    self.stats["malformed"] += 1
                    counter.hit()
                    log.debug("malformed from %s: %s", rec.node_id, e)
                    if counter.too_many():
                        self.stats["quarantined"] += 1
                        log.warning("quarantining %s: malformed flood", rec.node_id)
                        await ws.close(_CLOSE_POLICY, "malformed flood")
                        return
                    continue
                if rec.ws is not ws:      # taken over while we were waiting
                    return
                self._touch(rec)
                self._dispatch(rec, env, t_recv)
        except Exception as e:            # websockets closes raise ConnectionClosed* subclasses
            name = type(e).__name__
            if not name.startswith("ConnectionClosed"):
                log.exception("handler error for %s", rec.node_id if rec else peer)
        finally:
            if rec is not None and rec.ws is ws:
                rec.ws = None
                log.info("node %s disconnected (last seq %d)", rec.node_id, rec.seq_hi)

    def _send_raw(self, ws, kind: str, body: dict) -> None:
        if self._loop is None:
            return
        text = E.encode(E.make_envelope(kind, body))

        async def _go():
            with contextlib.suppress(Exception):
                await ws.send(text)

        self._loop.create_task(_go())

    async def _on_hello(self, ws, env: dict) -> NodeRecord:
        body = env["body"]
        node_id = str(body["node_id"])
        rec = self.nodes.get(node_id)
        if rec is None:
            rec = NodeRecord(node_id=node_id)
            self.nodes[node_id] = rec
        elif rec.ws is not None and rec.ws is not ws:
            # takeover: app restart / hot-swap re-using the same node_id — newest wins
            self.stats["takeovers"] += 1
            log.warning("takeover of node %s by a new socket", node_id)
            old = rec.ws
            rec.ws = None
            with contextlib.suppress(Exception):
                await old.close(_CLOSE_TAKEOVER, "taken over")
        rec.ws = ws
        rec.hello_ok = True
        rec.node_type = str(body.get("node_type", "phone"))
        rec.app_ver = str(body.get("app_ver", ""))
        gun = body.get("gun") or {}
        if isinstance(gun, dict):
            rec.gun_name = gun.get("name") or rec.gun_name
            rec.gun_tail = gun.get("tail") or rec.gun_tail
            rec.gun_fw = gun.get("fw") or rec.gun_fw
        seq_next = body.get("seq_next")
        if isinstance(seq_next, int) and seq_next <= rec.seq_hi:
            log.warning("node %s storage reset: seq_next=%d < seq_hi=%d", node_id, seq_next, rec.seq_hi)
        self._touch(rec)

        node_ctx = None
        if self._hydrate is not None:
            try:
                node_ctx = self._hydrate(dict(body))
            except Exception:
                log.exception("hydrate callback failed for %s", node_id)
        if isinstance(node_ctx, dict):
            pid = node_ctx.get("player", {}).get("player_id") if isinstance(node_ctx.get("player"), dict) else None
            if pid:
                rec.player_id = pid
        welcome = {"session_id": self.session_id, "server_t": E.now_ms(), "seq_hi": rec.seq_hi}
        if node_ctx:
            welcome["node"] = node_ctx
        await ws.send(E.encode(E.make_envelope("welcome", welcome)))
        self._fire_node(rec)
        return rec

    def _fire_node(self, rec: NodeRecord) -> None:
        info = {"node_id": rec.node_id, "node_type": rec.node_type}
        if rec.gun_name:
            info["gun_name"] = rec.gun_name
        if rec.gun_tail:
            info["gun_tail"] = rec.gun_tail
        if rec.player_id:
            info["player_id"] = rec.player_id
        for cb in self._on_node:
            self._call(cb, info)

    def _dispatch(self, rec: NodeRecord, env: dict, t_recv: int) -> None:
        kind, body = env["kind"], env["body"]
        if kind == "hello":
            # a second hello on a live socket: treat as a refresh (re-hydrate), not an error
            self._loop.create_task(self._on_hello(rec.ws, env))
            return
        if kind == "bind":
            self._on_bind(rec, body)
            return
        if kind == "event":
            self._ingest(rec, env["seq"], body, t_recv)
            self._send(rec, "ack", {"seq_hi": rec.seq_hi})
            return
        if kind == "event_batch":
            for item in body["events"]:
                self._ingest(rec, item["seq"], item, t_recv)
            self._send(rec, "ack", {"seq_hi": rec.seq_hi})
            return
        if kind == "status":
            body = dict(body)
            body.setdefault("node_id", rec.node_id)
            for cb in self._on_status:
                self._call(cb, rec.node_id, body, t_recv)
            return
        if kind == "time_req":
            self._send(rec, "time_res", {"t_node": body["t_node"], "server_t": E.now_ms()})
            return
        # ack_config / log_offer / log_data / ready
        for cb in self._on_node_message:
            self._call(cb, rec.node_id, kind, dict(body), t_recv)

    def _on_bind(self, rec: NodeRecord, body: dict) -> None:
        gun_name = str(body.get("gun_name") or "")
        gun_tail = str(body.get("gun_tail") or "")
        # takeover by gun: another live node claiming this gun is the stale one (hot-swap)
        for other in list(self.nodes.values()):
            if other is rec or other.ws is None:
                continue
            if gun_name and other.gun_name == gun_name:
                self.stats["takeovers"] += 1
                log.warning("gun %s re-bound from node %s to %s — closing the old socket",
                            gun_name, other.node_id, rec.node_id)
                old = other.ws
                other.ws = None
                self._loop.create_task(self._close_quiet(old, _CLOSE_TAKEOVER, "gun taken over"))
        rec.gun_name, rec.gun_tail = gun_name or rec.gun_name, gun_tail or rec.gun_tail
        if body.get("player_id"):
            rec.player_id = str(body["player_id"])
        self._fire_node(rec)

    async def _close_quiet(self, ws, code: int, reason: str) -> None:
        with contextlib.suppress(Exception):
            await ws.close(code, reason)

    def _ingest(self, rec: NodeRecord, seq: int, ev: dict, t_recv: int) -> None:
        """Per-node dedup (net.md §4): apply iff not seen and within the reorder window."""
        if seq in rec.applied or (seq <= rec.seq_hi and rec.seq_hi - seq > REORDER_WINDOW):
            self.stats["replays"] += 1
            return
        if seq <= rec.seq_hi and seq not in rec.applied and rec.seq_hi - seq <= REORDER_WINDOW:
            # late out-of-order fact inside the window: apply once
            pass
        rec.applied.append(seq)
        if seq > rec.seq_hi:
            rec.seq_hi = seq
        self.stats["events"] += 1
        ev = dict(ev)
        ev["seq"] = seq                      # facts carry their seq on both the single and batch paths
        ev.setdefault("node_id", rec.node_id)
        for cb in self._on_event:
            self._call(cb, rec.node_id, ev, t_recv)

    def _touch(self, rec: NodeRecord) -> None:
        rec.last_seen = time.monotonic()
        if rec.stale:
            rec.stale = False
            for cb in self._on_return:
                self._call(cb, rec.node_id)

    async def _stale_loop(self) -> None:
        period = max(0.05, min(1.0, self.stale_after_ms / 4000.0))
        while True:
            await asyncio.sleep(period)
            now = time.monotonic()
            for rec in list(self.nodes.values()):
                if not rec.hello_ok or rec.stale:
                    continue
                age_ms = int((now - rec.last_seen) * 1000)
                if age_ms >= self.stale_after_ms:
                    rec.stale = True
                    for cb in self._on_stale:
                        self._call(cb, rec.node_id, age_ms)

    @staticmethod
    def _call(cb: Callable, *args: Any) -> None:
        try:
            cb(*args)
        except Exception:
            log.exception("callback %r raised", getattr(cb, "__name__", cb))
