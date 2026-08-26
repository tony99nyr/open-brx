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
import secrets
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

from . import envelope as E
from .types import PROTOCOL_V, STALE_AFTER_MS, STATUS_HEARTBEAT_MS

log = logging.getLogger("brx.mc.net")

HELLO_TIMEOUT_S = 5.0          # net.md §8: no valid hello within the grace window → close
REORDER_WINDOW = 256           # net.md §4: small recent-set to tolerate reordering
PRUNE_AFTER_MS = 600_000          # unbound + disconnected + silent this long → record dropped

WS_PING_INTERVAL_S = STATUS_HEARTBEAT_MS / 1000.0   # server-initiated ping at the heartbeat cadence
WS_PING_TIMEOUT_S = STALE_AFTER_MS / 1000.0

_CLOSE_POLICY = 1008
_CLOSE_TAKEOVER = 4000
_CLOSE_VERSION = 4001
_CLOSE_INUSE = 4003     # A8: another live node holds this node_id/gun and the key did not match


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
    node_key: str = ""                # A8: secret to re-claim this node_id / its gun
    displaced_keys: set = field(default_factory=set)   # keys of the (stale) holders this record displaced WITHOUT proving them
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


class _Rejected(Exception):
    """Raised inside _on_hello when a takeover is refused (A8); the handler returns quietly."""


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
        self._resolve_gun: Callable[[str, str], str | None] | None = None   # (gun_name, gun_tail) -> player_id (A8 by gun)
        self._on_node: list[Callable[[dict], None]] = []
        self._on_event: list[Callable[[str, dict, int], None]] = []
        self._on_batch: list[Callable[[str, list, int], None]] = []
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
        self.stats = {"malformed": 0, "quarantined": 0, "takeovers": 0, "replays": 0, "events": 0, "rejected": 0, "evicted": 0}

    # ---------------- registration (interfaces.NetServer) ----------------
    def hydrate(self, cb: Callable[[dict], dict | None]) -> None:
        self._hydrate = cb

    def resolve_gun(self, cb: Callable[[str, str], str | None]) -> None:
        """A8: the SAME fuzzy gun→player resolution hydrate uses (case, base name, tail), so the holder check
        runs against the record actually bound to that player — not just an exact gun_name match."""
        self._resolve_gun = cb

    def on_node(self, cb: Callable[[dict], None]) -> None:
        self._on_node.append(cb)

    def on_event(self, cb: Callable[[str, dict, int], None]) -> None:
        self._on_event.append(cb)

    def on_batch(self, cb: Callable[[str, list, int], None]) -> None:
        """Fired once per event_batch with the post-dedup items (A5.7 re-base runs here)."""
        self._on_batch.append(cb)

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
            try:
                rec = await self._on_hello(ws, env)
            except _Rejected:
                return
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

    def _fresh(self, rec: NodeRecord, now: float | None = None) -> bool:
        """A8: a record that said hello and was heard from within STALE_AFTER_MS — connected or not."""
        return rec.hello_ok and ((now if now is not None else time.monotonic()) - rec.last_seen) * 1000 < self.stale_after_ms

    def _gun_holders(self, rec: NodeRecord, gun_name: str, gun_tail: str) -> list[NodeRecord]:
        """Records other than `rec` that currently hold this gun: an exact gun_name match, or the node bound to
        the player the gun RESOLVES to (the fuzzy match hydrate would use — lowercase, base name, tail)."""
        pid = None
        if self._resolve_gun is not None and (gun_name or gun_tail):
            try:
                pid = self._resolve_gun(gun_name, gun_tail)
            except Exception:
                log.exception("resolve_gun callback failed")
        out = []
        for other in self.nodes.values():
            if other is rec:
                continue
            if (gun_name and other.gun_name == gun_name) or (pid and other.player_id == pid):
                out.append(other)
        return out

    def _claim_gun(self, rec: NodeRecord, presented_key: str, gun_name: str, gun_tail: str, where: str) -> NodeRecord | None:
        """A8 gun rule shared by hello and bind. Returns the fresh holder that BLOCKS the claim (caller closes
        4003), or None when the claim may proceed — after displacing any stale / keyed holders' sockets."""
        now = time.monotonic()
        for other in self._gun_holders(rec, gun_name, gun_tail):
            fresh = self._fresh(other, now)
            # A8.2: only the holder's own key proves a claim against a FRESH holder. A keyless hello may still displace a
            # STALE holder (hot-swap of a dead phone). The displaced owner's key is remembered on the displacer so that
            # when the owner comes back WITH its key it wins over a displacer that has itself gone stale — and records
            # nothing (else the displacer could use its own key to take the gun straight back). A FRESH displacer keeps
            # the gun even against the returning keyed owner: the hot-swap phone is the one mounted on the player; a dead
            # phone that reboots in a pocket must not yank the binding mid-match (operator EVICT if that is wrong).
            proven = presented_key == other.node_key
            returning = bool(presented_key) and presented_key in other.displaced_keys
            if fresh and not proven:
                self.stats["rejected"] += 1
                log.warning("%s for gun %s refused — node %s holds it (fresh, key not proven)", where, gun_name or gun_tail, other.node_id)
                return other
            if not (proven or returning):
                rec.displaced_keys.add(other.node_key)
                rec.displaced_keys |= other.displaced_keys
                rec.displaced_keys.discard(rec.node_key)
            if other.ws is None:
                continue                      # stale (or keyed) and already disconnected: nothing to displace
            self.stats["takeovers"] += 1
            log.warning("gun %s re-bound at %s from %s node %s to %s", gun_name or gun_tail, where, "keyed" if fresh else "stale", other.node_id, rec.node_id)
            old = other.ws
            other.ws = None
            self._loop.create_task(self._close_quiet(old, _CLOSE_TAKEOVER, "gun taken over"))
        return None

    def evict(self, node_id: str) -> bool:
        """Operator recovery (host UI): drop a node NOW — close its socket (4000), forget its gun/player, rotate its key
        and mark it stale so whatever it squatted on can be claimed by the next hello. Returns False for an unknown id."""
        rec = self.nodes.get(node_id)
        if rec is None:
            return False
        ws, rec.ws = rec.ws, None
        if ws is not None and self._loop is not None:
            self._loop.create_task(self._close_quiet(ws, _CLOSE_TAKEOVER, "evicted by operator"))
        rec.last_seen = -1e9                      # stale immediately (finite: view() still renders an age)
        rec.stale = True
        rec.node_key = secrets.token_urlsafe(9)   # its old key no longer reclaims anything
        rec.displaced_keys.clear()
        rec.player_id = None
        rec.gun_name = rec.gun_tail = rec.gun_fw = None
        self.stats["evicted"] += 1
        log.warning("node %s evicted by operator", node_id)
        return True

    def _set_player(self, rec: NodeRecord, pid: str | None) -> None:
        """Keep NodeRecord.player_id truthful: one record per player (the holder check keys on it)."""
        if pid is None:
            return
        rec.player_id = pid
        for other in self.nodes.values():
            if other is not rec and other.player_id == pid:
                other.player_id = None

    async def _on_hello(self, ws, env: dict) -> NodeRecord:
        body = env["body"]
        node_id = str(body["node_id"])
        rec = self.nodes.get(node_id)
        presented_key = str(body.get("node_key") or "")
        created = rec is None
        if rec is None:
            rec = NodeRecord(node_id=node_id, node_key=secrets.token_urlsafe(9))
            self.nodes[node_id] = rec
        try:
            return await self._hello_gate(ws, body, rec, presented_key)
        except _Rejected:
            if created:
                self.nodes.pop(node_id, None)     # a rejected stranger leaves no record behind (net.md §8 memory)
            raise

    async def _hello_gate(self, ws, body: dict, rec: NodeRecord, presented_key: str) -> NodeRecord:
        node_id = rec.node_id
        if rec.ws is None and rec.hello_ok and presented_key != rec.node_key:
            if self._fresh(rec):
                # A8: a known node_id that dropped a beat ago is still its owner's — a keyless hello must not
                # take it (the owner's reconnect-with-key would then be locked out). Only a STALE record may
                # be re-claimed without the key (wiped storage), and then the key rotates.
                self.stats["rejected"] += 1
                log.warning("rejected keyless hello for fresh node %s", node_id)
                await ws.close(_CLOSE_INUSE, "node in use")
                raise _Rejected()
            rec.node_key = secrets.token_urlsafe(9)
        elif rec.ws is not None and rec.ws is not ws:
            # A8: a live node_id is only handed over if the newcomer proves the key, or the old
            # socket has gone unresponsive (stale). Otherwise a rogue hello can't kick a player.
            if self._fresh(rec) and presented_key != rec.node_key:
                self.stats["rejected"] += 1
                log.warning("rejected hello for live node %s (bad/absent key)", node_id)
                await ws.close(_CLOSE_INUSE, "node in use")
                raise _Rejected()
            self.stats["takeovers"] += 1
            log.warning("takeover of node %s by a new socket", node_id)
            old = rec.ws
            rec.ws = ws                           # own the record BEFORE awaiting: a simultaneous keyed hello then sees a live socket
            with contextlib.suppress(Exception):
                await old.close(_CLOSE_TAKEOVER, "taken over")
            if rec.ws is not ws:                  # …and took it over from us meanwhile
                raise _Rejected()
        # A8 (gun): the same fresh-holder rule as bind, applied BEFORE hydrate — hydrate rebinds the
        # player to this node, so a keyless hello carrying a copied (or case/tail-varied) gun name must never reach it.
        gun0 = body.get("gun") if isinstance(body.get("gun"), dict) else {}
        gun_name_new, gun_tail_new = str(gun0.get("name") or ""), str(gun0.get("tail") or "")
        if gun_name_new or gun_tail_new:
            if self._claim_gun(rec, presented_key, gun_name_new, gun_tail_new, "hello") is not None:
                await ws.close(_CLOSE_INUSE, "gun in use")
                raise _Rejected()
        rec.ws = ws
        rec.hello_ok = True
        rec.node_type = str(body.get("node_type", "phone"))
        rec.app_ver = str(body.get("app_ver", ""))
        if gun0:
            rec.gun_name = gun0.get("name") or rec.gun_name
            rec.gun_tail = gun0.get("tail") or rec.gun_tail
            rec.gun_fw = gun0.get("fw") or rec.gun_fw
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
                self._set_player(rec, pid)
        welcome = {"session_id": self.session_id, "server_t": E.now_ms(), "seq_hi": rec.seq_hi, "node_key": rec.node_key}
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
            r = self._call(cb, info)
            if isinstance(r, str):            # Session returns the player it bound (keeps the record truthful after a bind)
                self._set_player(rec, r)

    def _dispatch(self, rec: NodeRecord, env: dict, t_recv: int) -> None:
        kind, body = env["kind"], env["body"]
        if kind == "hello":
            if str(body.get("node_id")) != rec.node_id:
                # one socket, one node_id: a second hello with another id would create a record sharing this socket
                self.stats["malformed"] += 1
                log.warning("node %s sent a hello for %r on its live socket — closing", rec.node_id, body.get("node_id"))
                ws, rec.ws = rec.ws, None
                self._loop.create_task(self._close_quiet(ws, _CLOSE_POLICY, "node_id changed"))
                return
            # a second hello on a live socket: treat as a refresh (re-hydrate), not an error
            self._loop.create_task(self._rehello(rec.ws, env))
            return
        if kind == "bind":
            self._on_bind(rec, body)
            return
        if kind == "event":
            self._ingest(rec, env["seq"], body, t_recv)
            self._send(rec, "ack", {"seq_hi": rec.seq_hi})
            return
        if kind == "event_batch":
            applied = []
            for item in body["events"]:
                ev = self._ingest(rec, item["seq"], item, t_recv, fire=not self._on_batch)
                if ev is not None:
                    applied.append(ev)
            if self._on_batch and applied:
                for cb in self._on_batch:
                    self._call(cb, rec.node_id, applied, t_recv)
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
        # A8 takeover by gun (exact name OR the player it resolves to): only a fresh holder whose key this node
        # did not prove blocks; a stale one is displaced (hot-swap).
        if gun_name or gun_tail:
            if self._claim_gun(rec, rec.node_key, gun_name, gun_tail, "bind") is not None:
                ws, rec.ws = rec.ws, None
                self._loop.create_task(self._close_quiet(ws, _CLOSE_INUSE, "gun in use"))
                return
        rec.gun_name, rec.gun_tail = gun_name or rec.gun_name, gun_tail or rec.gun_tail
        # A8: the player binding is the server's (set by hydrate); a client-supplied player_id is never honoured.
        self._fire_node(rec)

    async def _rehello(self, ws, env: dict) -> None:
        with contextlib.suppress(_Rejected):
            await self._on_hello(ws, env)

    async def _close_quiet(self, ws, code: int, reason: str) -> None:
        with contextlib.suppress(Exception):
            await ws.close(code, reason)

    def _ingest(self, rec: NodeRecord, seq: int, ev: dict, t_recv: int, fire: bool = True):
        """Per-node dedup (net.md §4): apply iff not seen and within the reorder window.
        Returns the applied ev (seq-stamped) or None on a replay. `fire=False` skips on_event
        (the batch path fires on_batch with the whole applied list instead)."""
        if seq in rec.applied or (seq <= rec.seq_hi and rec.seq_hi - seq > REORDER_WINDOW):
            self.stats["replays"] += 1
            return None
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
        if fire:
            for cb in self._on_event:
                self._call(cb, rec.node_id, ev, t_recv)
        return ev

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
                age_ms = int((now - rec.last_seen) * 1000)
                if rec.hello_ok and rec.ws is None and rec.player_id is None and age_ms > PRUNE_AFTER_MS:
                    self.nodes.pop(rec.node_id, None)     # net.md §8: throwaway / evicted records don't accumulate
                    continue
                if not rec.hello_ok or rec.stale:
                    continue
                if age_ms >= self.stale_after_ms:
                    rec.stale = True
                    for cb in self._on_stale:
                        self._call(cb, rec.node_id, age_ms)

    @staticmethod
    def _call(cb: Callable, *args: Any) -> Any:
        try:
            return cb(*args)
        except Exception:
            log.exception("callback %r raised", getattr(cb, "__name__", cb))
            return None
