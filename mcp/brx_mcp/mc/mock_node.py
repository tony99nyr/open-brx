"""MockNode — a scriptable phone-node stand-in over the real wire (contracts.md §5, net.md).

Used by the M-NET tests, by the MC/UI lanes to demo without phones, and by Tony at the bench:

    .venv/bin/python -m brx_mcp.mc.mock_node ws://192.168.1.10:8765/ws --gun GUN-A --tail 3D4F

then type `hit 19 2 9`, `die 19 2`, `respawn`, `drop`, `up`, `status`, `quit`.

Behaviour mirrors the spec's node: persisted node_id + seq counter, hello{seq_next} → welcome
(adopts seq_hi, stores the hydrated context), bind by advert name, live-only status heartbeat,
a persisted-fact ring flushed as event_batch on reconnect and pruned on ack, NTP-lite offset,
lifecycle transitions on start/end. It writes no BLE — the "gun" is a few numbers.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import random
import sys
import time
import uuid
from typing import Any

from . import envelope as E
from .types import STATUS_HEARTBEAT_MS

log = logging.getLogger("brx.mc.mock_node")


class MockNode:
    def __init__(self, url: str, *, node_id: str | None = None, gun_name: str = "GUN-A",
                 gun_tail: str = "3D4F", gun_fw: str = "v4.32", node_type: str = "phone",
                 app_ver: str = "mock-0.1", gun_echo: str | None = "$LCD,0,0,0,0,0,0,*",
                 heartbeat_ms: int = STATUS_HEARTBEAT_MS, max_hp: int = 45, max_armor: int = 70,
                 backoff_cap_s: float = 10.0):
        self.url = url
        self.node_id = node_id or f"mock-{uuid.uuid4().hex[:6]}"
        self.gun_name, self.gun_tail, self.gun_fw = gun_name, gun_tail, gun_fw
        self.node_type, self.app_ver = node_type, app_ver
        self.gun_echo = gun_echo
        self.heartbeat_ms = heartbeat_ms
        self.max_hp, self.max_armor = max_hp, max_armor
        self.backoff_cap_s = backoff_cap_s

        # persisted-node state
        self.seq_next = 1
        self.ring: list[tuple[int, dict]] = []      # (seq, event) un-acked facts
        self.context: dict[str, Any] = {}           # welcome.node / assign / config / start
        self.player_id: str | None = None
        self.player_num: int = 0
        self.match_id: str | None = None
        self.go_live_t: int | None = None
        self._start_seq = None
        self.time_limit_s: int | None = None
        self.offset_ms = 0.0
        self.synced = False
        self.session_id: str | None = None
        self.seq_hi_seen = 0
        self.node_key: str | None = None      # A8: per-node secret to re-claim a live node_id/gun

        # gun state
        self.arm_state = "connected"
        self.hp, self.armor, self.ammo = max_hp, max_armor, 36
        self.alive = False
        self.shots = 0
        self.battery = 90
        self.preflight = {"ssid_ok": True, "mc_reachable": True, "auto_join_ok": True,
                          "cellular_off": True, "dnd_on": True, "phone_batt": 80,
                          "screen_on": True, "foreground": True, "gun_linked": True,
                          "headset_ok": True}

        # inbox for tests / REPL
        self.received: list[dict] = []
        self.feedback: list[dict] = []
        self.controls: list[dict] = []
        self.tutorials: list[dict] = []
        self.configs: list[dict] = []
        self.loadout_acks: list[dict] = []      # A10: every `loadout_ack` received, in order
        self.starts: list[dict] = []
        self.acks: list[int] = []
        self.applies: list[dict] = []          # A6 `apply{frames, reason?}` downlinks (recorded, not "written")
        self.time_res: list[dict] = []

        self._ws = None
        self._task: asyncio.Task | None = None
        self._paused = False
        self._closed = False
        self._connected = asyncio.Event()
        self._welcomed = asyncio.Event()
        self.reconnects = 0

    # ---------------- public API ----------------
    @property
    def connected(self) -> bool:
        return self._ws is not None and self._welcomed.is_set()

    def synced_now(self) -> int:
        return int(time.time() * 1000 + self.offset_ms)

    async def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name=f"mock-node-{self.node_id}")

    async def wait_connected(self, timeout: float = 5.0) -> None:
        await asyncio.wait_for(self._welcomed.wait(), timeout)

    async def close(self) -> None:
        self._closed = True
        if self._ws is not None:
            with contextlib.suppress(Exception):
                await self._ws.close()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def disconnect(self) -> None:
        """Simulate walking out of range: drop the socket and stop reconnecting until reconnect()."""
        self._paused = True
        ws, self._ws = self._ws, None
        self._welcomed.clear()
        self._connected.clear()
        if ws is not None:
            with contextlib.suppress(Exception):
                await ws.close()

    def reconnect(self) -> None:
        self._paused = False

    def emit(self, ev: dict) -> int:
        """Queue a persisted fact (hit_taken/death/respawn/team_change) with the next seq."""
        seq = self.seq_next
        self.seq_next += 1
        ev = dict(ev)
        ev.setdefault("t", self.synced_now())
        ev.setdefault("match_id", self.match_id)
        ev.setdefault("node_id", self.node_id)
        ev.setdefault("player_id", self.player_id)
        self.ring.append((seq, ev))
        if self.connected:
            self._send(E.make_envelope("event", ev, seq=seq))
        return seq

    # scripted gun behaviour
    def take_hit(self, shooter_num: int, shooter_team: int, dmg: int = 9, ir_proto: int = 0) -> None:
        if not self.alive:
            return
        absorbed = min(self.armor, dmg)
        self.armor -= absorbed
        self.hp = max(0, self.hp - (dmg - absorbed))
        self.emit({"type": "hit_taken", "shooter_num": shooter_num, "shooter_team": shooter_team,
                   "dmg": dmg, "ir_proto": ir_proto})
        if self.hp == 0:
            self.die(shooter_num, shooter_team)

    def die(self, shooter_num: int, shooter_team: int) -> None:
        if not self.alive:
            return
        self.alive = False
        self.hp = 0
        self.emit({"type": "death", "shooter_num": shooter_num, "shooter_team": shooter_team})

    def respawn(self, resync: bool = False) -> None:
        self.alive = True
        self.hp, self.armor, self.ammo = self.max_hp, self.max_armor, 36
        ev = {"type": "respawn"}
        if resync:
            ev["resync"] = True
        self.emit(ev)

    def fire(self, rounds: int = 1) -> None:
        n = min(rounds, self.ammo) if self.alive else 0
        self.ammo -= n
        self.shots += n

    def team_change(self, tid: int) -> None:
        self.emit({"type": "team_change", "tid": tid})

    def send_loadout_request(self, slot: str, kind: str, rid: str | None = None, try_: bool = False) -> None:
        """A10 §4.2: pick <slot> <id> [try] — `kind` ∈ weapon|perk|none; slot ∈ primary|secondary|perk (A14)."""
        body = {"node_id": self.node_id, "player_id": self.player_id, "slot": slot, "kind": kind}
        if rid:
            body["id"] = rid
        if try_:
            body["try"] = True
        self._send(E.make_envelope("loadout_request", body))

    def send_loadout_browse(self, open_: bool = True) -> None:
        self._send(E.make_envelope("loadout_browse", {"node_id": self.node_id, "player_id": self.player_id, "open": bool(open_)}))

    def send_ready(self, ready: bool = True) -> None:
        self._send(E.make_envelope("ready", {"node_id": self.node_id, "player_id": self.player_id,
                                             "ready": ready}))

    def send_raw(self, text: str) -> None:
        """Test hook: push arbitrary bytes onto the socket (malformed-frame tests)."""
        if self._ws is not None:
            asyncio.create_task(self._ws.send(text))

    def status_body(self) -> dict:
        body = {
            "node_id": self.node_id, "player_id": self.player_id, "match_id": self.match_id,
            "hp": self.hp, "armor": self.armor, "ammo": self.ammo, "alive": self.alive,
            "shots": self.shots, "battery": self.battery, "fw": self.gun_fw,
            "arm_state": self.arm_state, "synced": self.synced, "dropped": 0,
            "preflight": dict(self.preflight),
        }
        if self.arm_state == "armed" and self.go_live_t:
            body["t_minus_ms"] = max(0, self.go_live_t - self.synced_now())
        return body

    # ---------------- internals ----------------
    def _send(self, env: dict) -> None:
        if self._ws is None:
            return
        text = E.encode(env)
        ws = self._ws

        async def _go():
            with contextlib.suppress(Exception):
                await ws.send(text)

        asyncio.create_task(_go())

    async def _run(self) -> None:
        from websockets.asyncio.client import connect
        attempt = 0
        while not self._closed:
            if self._paused:
                await asyncio.sleep(0.05)
                continue
            try:
                async with connect(self.url, ping_interval=None, max_size=E.MAX_ENVELOPE_BYTES + 1024,
                                   compression=None, open_timeout=3) as ws:
                    self._ws = ws
                    self._connected.set()
                    attempt = 0
                    await self._session(ws)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.debug("node %s link error: %s", self.node_id, e)
            finally:
                self._ws = None
                self._welcomed.clear()
                self._connected.clear()
            if self._closed or self._paused:
                continue
            attempt += 1
            self.reconnects += 1
            delay = min(self.backoff_cap_s, 0.05 * (2 ** min(attempt, 8)))
            await asyncio.sleep(delay * random.uniform(0.8, 1.2))

    async def _session(self, ws) -> None:
        hello = {"node_id": self.node_id, "node_type": self.node_type, "app_ver": self.app_ver,
                 "gun": {"name": self.gun_name, "tail": self.gun_tail, "fw": self.gun_fw},
                 "seq_next": self.seq_next}
        if self.node_key:
            hello["node_key"] = self.node_key
        await ws.send(E.encode(E.make_envelope("hello", hello)))
        raw = await asyncio.wait_for(ws.recv(), 5)
        env = E.decode(raw, direction="mc")
        if env["kind"] != "welcome":
            raise RuntimeError(f"expected welcome, got {env['kind']}")
        self._apply_welcome(env["body"])
        await ws.send(E.encode(E.make_envelope("bind", {
            "node_id": self.node_id, "player_id": self.player_id,
            "gun_name": self.gun_name, "gun_tail": self.gun_tail})))
        self._welcomed.set()
        # clock burst
        for _ in range(3):
            await ws.send(E.encode(E.make_envelope("time_req", {"t_node": int(time.time() * 1000)})))
        # flush backlog
        if self.ring:
            events = [dict(ev, seq=seq) for seq, ev in self.ring]
            for i in range(0, len(events), 200):
                await ws.send(E.encode(E.make_envelope("event_batch", {"events": events[i:i + 200]})))
        hb = asyncio.create_task(self._heartbeat())
        tick = asyncio.create_task(self._engine_tick())
        try:
            async for raw in ws:
                try:
                    env = E.decode(raw, direction="mc")
                except E.EnvelopeError as e:
                    log.debug("bad MC frame: %s", e)
                    continue
                self._handle(env)
        finally:
            hb.cancel()
            tick.cancel()

    def _apply_welcome(self, body: dict) -> None:
        self.session_id = body.get("session_id")
        if body.get("node_key"):
            self.node_key = body["node_key"]
        seq_hi = int(body.get("seq_hi", 0))
        self.seq_hi_seen = seq_hi
        self.seq_next = max(self.seq_next, seq_hi + 1)
        server_t = body.get("server_t")
        if isinstance(server_t, (int, float)):
            self.offset_ms = server_t - time.time() * 1000
            self.synced = True
        node = body.get("node")
        if isinstance(node, dict):
            self.context.update(node)
            self._absorb_context(node)

    def _absorb_context(self, node: dict) -> None:
        player = node.get("player")
        if isinstance(player, dict):
            self.player_id = player.get("player_id", self.player_id)
            self.player_num = int(player.get("player_num", self.player_num) or 0)
            if self.arm_state in ("idle", "connected"):
                self.arm_state = "kitted"
        config = node.get("config")
        if isinstance(config, dict):
            self.time_limit_s = config.get("time_limit_s")
            hp = (config.get("health") or {}).get("max_hp")
            ar = (config.get("health") or {}).get("max_armor")
            if hp:
                self.max_hp = int(hp)
            if ar:
                self.max_armor = int(ar)
            if node.get("frames") and self.arm_state == "kitted":
                self.arm_state = "lobby"
        start = node.get("start")
        if isinstance(start, dict):
            self._apply_start(start)

    def _apply_start(self, body: dict) -> None:
        seq = body.get("seq")
        if self.match_id == body.get("match_id") and self._start_seq == seq:
            return                        # A5.6: a same-seq re-push is a no-op — don't zero shots
        self._start_seq = seq
        self.match_id = body.get("match_id")
        self.go_live_t = int(body.get("go_live_t", 0))
        self.shots = 0
        self.starts.append(body)
        if self.arm_state in ("lobby", "kitted", "armed"):
            self.arm_state = "armed"

    def _handle(self, env: dict) -> None:
        kind, body = env["kind"], env["body"]
        self.received.append(env)
        if kind == "ack":
            hi = int(body["seq_hi"])
            self.acks.append(hi)
            self.ring = [(s, e) for s, e in self.ring if s > hi]
        elif kind == "time_res":
            self.time_res.append(body)
            t_node = body["t_node"]
            rtt = time.time() * 1000 - t_node
            self.offset_ms = body["server_t"] - (t_node + rtt / 2)
            self.synced = True
        elif kind == "assign":
            self.context["player"] = body.get("player")
            self.context["team"] = body.get("team")
            self.context["roster"] = body.get("roster")
            self.context["catalog"] = body.get("catalog")       # A10: what the phone browses
            self.context["policy"] = body.get("policy")
            self._absorb_context({"player": body.get("player")})
            self.arm_state = "kitted" if self.arm_state in ("idle", "connected") else self.arm_state
        elif kind == "loadout_ack":                              # A10 §4.2
            self.loadout_acks.append(body)
            print(f"loadout_ack {body.get('slot')} ok={body.get('ok')}" + (f" — {body['reason']}" if body.get("reason") else ""),
                  body.get("loadout"), flush=True)
        elif kind == "config":
            self.configs.append(body)
            self.context.update({k: body.get(k) for k in ("config", "frames", "roster")})
            self._absorb_context({"config": body.get("config"), "frames": body.get("frames")})
            self.arm_state = "lobby"
            ack = {"config_id": (body.get("config") or {}).get("config_id"), "ok": True}
            if self.gun_echo:
                ack["gun_echo"] = self.gun_echo
            else:
                ack = {"config_id": ack["config_id"], "ok": False, "err": "no_echo"}
            self._send(E.make_envelope("ack_config", ack))
        elif kind == "tutorial":
            self.tutorials.append(body)
        elif kind == "start":
            self._apply_start(body)
        elif kind == "feedback":
            self.feedback.append(body)
        elif kind == "control":
            self.controls.append(body)
            cmd = body.get("cmd")
            if cmd in ("end", "recall", "panic"):
                self.arm_state = "kitted"
                self.alive = False
            elif cmd == "abort_start" and self.arm_state == "armed":
                self.arm_state = "lobby"
                self.go_live_t = None
        elif kind == "apply":
            # Mirror the engine gate (A6.4 + A9.1): a runtime apply is written only when LIVE; a preview
            # apply may fire pre-live but ONLY if every frame is $PLAY/$SFLASH — it can't smuggle state
            # writes. Anything else is dropped, so a test can't go green on frames real hardware ignores.
            frames = body.get("frames", [])
            preview_ok = body.get("preview") is True and all(
                f.startswith("$PLAY") or f.startswith("$SFLASH") for f in frames)
            if self.arm_state == "live" or preview_ok:
                self.applies.append(body)
                log.info("apply %d frame(s) (%s)", len(frames), body.get("reason", ""))
            else:
                log.info("apply dropped (arm_state=%s, preview=%s)", self.arm_state, body.get("preview"))
        elif kind == "pull_log":
            self._send(E.make_envelope("log_data", {"node_id": self.node_id, "seq": 0,
                                                    "chunk": "mock log\n", "last": True}))

    async def _heartbeat(self) -> None:
        while True:
            if not self._paused:                       # a paused (asleep / out-of-range) phone sends nothing
                self._send(E.make_envelope("status", self.status_body()))
            await asyncio.sleep(self.heartbeat_ms / 1000.0)

    async def _engine_tick(self) -> None:
        while True:
            now = self.synced_now()
            if self.arm_state == "armed" and self.go_live_t and now >= self.go_live_t:
                self.arm_state = "live"
                self.alive = True
                self.hp, self.armor, self.ammo = self.max_hp, self.max_armor, 36
            elif (self.arm_state == "live" and self.go_live_t and self.time_limit_s
                  and now >= self.go_live_t + self.time_limit_s * 1000):
                self.arm_state = "kitted"
                self.alive = False
            await asyncio.sleep(0.1)


# ---------------- CLI demo ----------------
async def _repl(node: MockNode) -> None:
    print("commands: hit <num> <team> [dmg] | die <num> <team> | respawn | fire [n] | drop | up | "
          "status | ready | pick <primary|secondary|perk> <weapon_id|perk_id|none> [try] | browse [off] | quit")
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        parts = line.split()
        if not parts:
            continue
        cmd, args = parts[0], parts[1:]
        try:
            if cmd == "hit":
                node.take_hit(int(args[0]), int(args[1]), int(args[2]) if len(args) > 2 else 9)
            elif cmd == "die":
                node.die(int(args[0]), int(args[1]))
            elif cmd == "respawn":
                node.respawn()
            elif cmd == "fire":
                node.fire(int(args[0]) if args else 1)
            elif cmd == "drop":
                await node.disconnect()
            elif cmd == "up":
                node.reconnect()
            elif cmd == "ready":
                node.send_ready(True)
            elif cmd == "pick":                                  # A10: pick secondary body_armor / pick primary smg try
                slot, rid = args[0], args[1]
                cat = node.context.get("catalog") or {}
                kind = "none" if rid == "none" else ("perk" if any(p.get("perk_id") == rid for p in cat.get("perks") or []) else "weapon")
                node.send_loadout_request(slot, kind, None if kind == "none" else rid, try_=(len(args) > 2 and args[2] == "try"))
            elif cmd == "browse":
                node.send_loadout_browse(not (args and args[0] == "off"))
            elif cmd == "status":
                print(node.status_body(), "connected" if node.connected else "offline",
                      "ring", len(node.ring))
            elif cmd == "quit":
                break
            else:
                print("?")
        except (IndexError, ValueError) as e:
            print("bad args:", e)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Open BRX mock phone node")
    ap.add_argument("url", help="ws://host:port/ws (MC join URL / QR)")
    ap.add_argument("--gun", default="GUN-A")
    ap.add_argument("--tail", default="3D4F")
    ap.add_argument("--node-id", default=None)
    ap.add_argument("--no-echo", action="store_true", help="simulate a headset-less gun")
    ap.add_argument("-v", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.v else logging.INFO,
                        format="%(asctime)s %(name)s %(message)s")

    async def _main():
        node = MockNode(args.url, node_id=args.node_id, gun_name=args.gun, gun_tail=args.tail,
                        gun_echo=None if args.no_echo else "$LCD,0,0,0,0,0,0,*")
        await node.start()
        try:
            await node.wait_connected(10)
            print(f"node {node.node_id} connected as {args.gun}-{args.tail}; session {node.session_id}")
        except asyncio.TimeoutError:
            print("not connected yet — will keep retrying in the background")
        await _repl(node)
        await node.close()

    asyncio.run(_main())


if __name__ == "__main__":
    main()
