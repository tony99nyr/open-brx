"""M-NET tests (net.md / contracts §5): envelope validation runs everywhere; the live
server + MockNode tests need `websockets` and SKIP cleanly without it
(`.venv/bin/python run_tests.py mc_net` runs them for real)."""
from __future__ import annotations

import asyncio
import contextlib
import json
import time

from _skip import Skipped, needs

from brx_mcp.mc import envelope as E
from brx_mcp.mc.types import PROTOCOL_V

try:
    import websockets  # noqa: F401
    HAVE_WS = True
except ImportError:  # system python
    HAVE_WS = False

if HAVE_WS:
    from brx_mcp.mc.mock_node import MockNode
    from brx_mcp.mc.net import NetServer


# --------------------------------------------------------------------------- envelope (pure)
def _ev(seq=1, **kw):
    ev = {"type": "hit_taken", "t": E.now_ms(), "match_id": "m1", "node_id": "n1",
          "player_id": "p1", "shooter_num": 19, "shooter_team": 2, "dmg": 9}
    ev.update(kw)
    return E.make_envelope("event", ev, seq=seq)


def test_envelope_roundtrip_and_kinds():
    env = E.make_envelope("hello", {"node_id": "n1", "node_type": "phone", "app_ver": "x", "seq_next": 1})
    out = E.decode(E.encode(env))
    assert out["kind"] == "hello" and out["v"] == PROTOCOL_V and out["body"]["seq_next"] == 1
    # MC kinds are rejected on the node→MC direction and vice versa
    try:
        E.decode(E.encode(E.make_envelope("welcome", {"session_id": "s", "server_t": 1, "seq_hi": 0})))
        assert False, "welcome accepted as node kind"
    except E.EnvelopeError as e:
        assert e.reason == "unknown_kind"
    E.decode(E.encode(E.make_envelope("welcome", {"session_id": "s", "server_t": 1, "seq_hi": 0})),
             direction="mc")


def test_envelope_version_gate():
    env = E.make_envelope("hello", {"node_id": "n1", "node_type": "phone", "app_ver": "x", "seq_next": 1})
    env["v"] = 2
    try:
        E.validate(env)
        assert False
    except E.EnvelopeError as e:
        assert e.reason == "version"


def test_envelope_required_fields_and_t():
    try:
        E.validate(E.make_envelope("bind", {"node_id": "n1"}))
        assert False
    except E.EnvelopeError as e:
        assert e.reason == "missing_field" and "gun_name" in e.detail
    env = E.make_envelope("time_req", {"t_node": 1})
    env["t"] = 12345  # seconds, not ms
    try:
        E.validate(env)
        assert False
    except E.EnvelopeError as e:
        assert e.reason == "bad_t"


def test_envelope_event_rules():
    assert E.validate(_ev())["seq"] == 1
    bad = _ev()
    del bad["seq"]
    try:
        E.validate(bad)
        assert False
    except E.EnvelopeError as e:
        assert "seq" in e.detail
    try:
        E.validate(_ev(type="status"))          # status is not a persisted fact
        assert False
    except E.EnvelopeError as e:
        assert e.reason == "bad_event"
    try:
        E.validate(_ev(shooter_num=64))
        assert False
    except E.EnvelopeError as e:
        assert "shooter_num" in e.detail
    # status must not carry a seq
    st = E.make_envelope("status", {"node_id": "n1", "arm_state": "live", "synced": True}, seq=3)
    try:
        E.validate(st)
        assert False
    except E.EnvelopeError as e:
        assert e.reason == "bad_event"
    # batch items need seq + valid events
    batch = E.make_envelope("event_batch", {"events": [dict(_ev()["body"], seq=1), dict(_ev()["body"], seq=2)]})
    assert len(E.validate(batch)["body"]["events"]) == 2


def test_envelope_size_caps():
    big = E.make_envelope("log_data", {"node_id": "n1", "seq": 0, "chunk": "x" * (49 * 1024), "last": True})
    try:
        E.validate(big)
        assert False
    except E.EnvelopeError as e:
        assert e.reason == "oversize"
    huge = E.make_envelope("log_offer", {"node_id": "n1", "bytes": 1, "lines": 1, "pad": "y" * (70 * 1024)})
    try:
        E.encode(huge)
        assert False
    except E.EnvelopeError as e:
        assert e.reason == "oversize"
    try:
        E.decode(b"{" + b"a" * (70 * 1024))
        assert False
    except E.EnvelopeError as e:
        assert e.reason == "oversize"


def test_envelope_control_cmds_and_malformed_counter():
    try:
        E.validate(E.make_envelope("control", {"cmd": "pause"}), direction="mc")
        assert False
    except E.EnvelopeError:
        pass
    E.validate(E.make_envelope("control", {"cmd": "recall"}), direction="mc")
    c = E.MalformedCounter(limit_per_s=3)
    for i in range(3):
        c.hit(now=100.0 + i * 0.1)
    assert not c.too_many()
    c.hit(now=100.4)
    assert c.too_many()
    c.hit(now=102.0)
    assert not c.too_many() and c.total == 5


# --------------------------------------------------------------------------- live server
def _skip(name):
    """Bow out of a live-server test. RAISES, so run_tests.py counts it as a skip — it used to just
    print and return, which the runner scored as a PASS (review 2026-09-01)."""
    raise Skipped("websockets")


def _run(coro):
    return asyncio.run(asyncio.wait_for(coro, 20))


class _Harness:
    """A NetServer with recording callbacks, on an ephemeral port."""

    def __init__(self, **kw):
        self.net = NetServer(**kw)
        self.events: list[tuple[str, dict, int]] = []
        self.statuses: list[tuple[str, dict, int]] = []
        self.msgs: list[tuple[str, str, dict]] = []
        self.nodes: list[dict] = []
        self.stale: list[tuple[str, int]] = []
        self.returned: list[str] = []
        self.hydrate_calls: list[dict] = []
        self.context: dict | None = None
        self.net.on_event(lambda n, ev, t: self.events.append((n, ev, t)))
        self.net.on_status(lambda n, b, t: self.statuses.append((n, b, t)))
        self.net.on_node_message(lambda n, k, b, t: self.msgs.append((n, k, b)))
        self.net.on_node(lambda info: self.nodes.append(info))
        self.net.on_stale(lambda n, a: self.stale.append((n, a)))
        self.net.on_return(lambda n: self.returned.append(n))
        self.net.hydrate(self._hydrate)

    def _hydrate(self, hello):
        self.hydrate_calls.append(hello)
        return self.context

    async def __aenter__(self):
        await self.net.start("127.0.0.1", 0)
        self.url = f"ws://127.0.0.1:{self.net.port}/ws"
        return self

    async def __aexit__(self, *a):
        await self.net.stop()


async def _until(pred, timeout=5.0, step=0.02):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        await asyncio.sleep(step)
    return pred()


def test_handshake_hydrate_bind_and_seq_hi():
    if not HAVE_WS:
        return _skip("handshake")

    async def go():
        async with _Harness() as h:
            h.context = {"player": {"player_id": "p1", "player_num": 6}, "team": {"team_id": "blue", "tid": 1},
                         "roster": [], "config": {"config_id": "c1", "time_limit_s": 600,
                                                  "health": {"max_hp": 45, "max_armor": 70}}}
            node = MockNode(h.url, node_id="n1", gun_name="GUN-A", gun_tail="3D4F", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            assert h.hydrate_calls and h.hydrate_calls[0]["gun"]["name"] == "GUN-A"
            assert node.player_id == "p1" and node.player_num == 6 and node.session_id == h.net.session_id
            assert node.seq_next == 1 and node.seq_hi_seen == 0
            assert await _until(lambda: len(h.nodes) >= 2)          # hello + bind
            assert h.nodes[-1]["gun_name"] == "GUN-A" and h.nodes[-1]["player_id"] == "p1"
            rec = h.net.nodes["n1"]
            assert rec.gun_tail == "3D4F" and rec.gun_fw == "v4.32" and rec.connected
            assert await _until(lambda: len(node.time_res) >= 3)    # clock burst answered
            assert node.synced and abs(node.offset_ms) < 2000
            await node.close()
    _run(go())


def test_events_dedup_ack_prune_and_t_recv():
    if not HAVE_WS:
        return _skip("dedup")

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            node.arm_state = "live"
            node.alive = True
            node.match_id = "m1"
            before = E.now_ms()
            node.take_hit(19, 2, 9)
            node.take_hit(19, 2, 9)
            assert await _until(lambda: len(h.events) == 2)
            nid, ev, t_recv = h.events[0]
            assert nid == "n1" and ev["type"] == "hit_taken" and ev["shooter_num"] == 19 and ev["match_id"] == "m1"
            assert before <= t_recv <= E.now_ms()
            assert await _until(lambda: node.acks and node.acks[-1] == 2 and not node.ring)
            assert h.net.nodes["n1"].seq_hi == 2
            # replay: re-send seq 1 and 2 by hand → dropped silently
            replay = E.encode(E.make_envelope("event_batch", {"events": [
                dict(h.events[0][1], seq=1), dict(h.events[1][1], seq=2)]}))
            node.send_raw(replay)
            await asyncio.sleep(0.3)
            assert len(h.events) == 2 and h.net.stats["replays"] == 2
            # out-of-order inside the window: seq 4 then seq 3 → both applied once
            e4 = dict(h.events[0][1], seq=4)
            e3 = dict(h.events[0][1], seq=3)
            node.send_raw(E.encode(E.make_envelope("event", e4, seq=4)))
            await asyncio.sleep(0.1)
            node.send_raw(E.encode(E.make_envelope("event", e3, seq=3)))
            assert await _until(lambda: len(h.events) == 4)
            node.send_raw(E.encode(E.make_envelope("event", e3, seq=3)))
            await asyncio.sleep(0.2)
            assert len(h.events) == 4 and h.net.nodes["n1"].seq_hi == 4
            await node.close()
    _run(go())


def test_offline_ring_flushes_as_batch_in_order():
    if not HAVE_WS:
        return _skip("batch")

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="n1", heartbeat_ms=100, backoff_cap_s=0.2)
            await node.start()
            await node.wait_connected()
            node.arm_state, node.alive, node.match_id = "live", True, "m1"
            await node.disconnect()
            for i in range(5):
                node.take_hit(19, 2, 9)
            node.die(19, 2)
            assert len(node.ring) == 6 and not h.events
            node.reconnect()
            await node.wait_connected(10)
            assert await _until(lambda: len(h.events) == 6)
            seqs = [ev.get("seq") for _, ev, _ in h.events]
            types = [ev["type"] for _, ev, _ in h.events]
            assert seqs == [1, 2, 3, 4, 5, 6] and types[-1] == "death"
            assert await _until(lambda: not node.ring)
            assert node.reconnects >= 0
            await node.close()
    _run(go())


def test_storage_reset_seq_next_resume():
    if not HAVE_WS:
        return _skip("seq_next")

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            node.arm_state, node.alive, node.match_id = "live", True, "m1"
            node.take_hit(19, 2, 9)
            node.take_hit(19, 2, 9)
            node.take_hit(19, 2, 9)
            assert await _until(lambda: h.net.nodes["n1"].seq_hi == 3)
            await node.close()
            # "reinstalled" app: same node_id, seq restarts at 1, no key — only once the record is stale (A8)
            h.net.stale_after_ms = 300; await asyncio.sleep(0.5)
            fresh = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            await fresh.start()
            await fresh.wait_connected()
            assert fresh.seq_hi_seen == 3 and fresh.seq_next == 4
            fresh.arm_state, fresh.alive, fresh.match_id = "live", True, "m1"
            fresh.take_hit(6, 1, 9)
            assert await _until(lambda: len(h.events) == 4)
            assert h.events[-1][1]["seq"] == 4 and h.events[-1][1]["shooter_num"] == 6
            await fresh.close()
    _run(go())


def test_status_path_and_node_messages():
    if not HAVE_WS:
        return _skip("status")

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="n1", heartbeat_ms=50)
            await node.start()
            await node.wait_connected()
            assert await _until(lambda: len(h.statuses) >= 3)
            nid, body, t_recv = h.statuses[-1]
            assert nid == "n1" and body["arm_state"] in ("connected", "kitted") and body["preflight"]["ssid_ok"]
            assert body["fw"] == "v4.32" and isinstance(t_recv, int)
            # config push → ack_config with gun echo, and ready
            h.net.push("n1", "config", {"config": {"config_id": "c9", "time_limit_s": 300,
                                                  "health": {"max_hp": 45, "max_armor": 70}},
                                        "frames": {"head": ["$VOL,69,0,*"]}, "roster": []})
            assert await _until(lambda: any(k == "ack_config" for _, k, _ in h.msgs))
            ack = [b for _, k, b in h.msgs if k == "ack_config"][-1]
            assert ack["ok"] and ack["config_id"] == "c9" and ack["gun_echo"].startswith("$LCD")
            assert node.arm_state == "lobby"
            node.send_ready(True)
            assert await _until(lambda: any(k == "ready" for _, k, _ in h.msgs))
            # broadcast start → node arms, then goes live at go_live_t (synced clock)
            go_live = E.now_ms() + 300
            n = h.net.broadcast("start", {"match_id": "m7", "go_live_t": go_live, "config_id": "c9",
                                          "seq": 1, "countdown_s": 1})
            assert n == 1
            assert await _until(lambda: node.arm_state == "armed")
            assert await _until(lambda: node.arm_state == "live", timeout=3)
            assert node.match_id == "m7" and node.alive
            # time_minus rides status while armed; live-only status carries match_id
            assert await _until(lambda: h.statuses[-1][1].get("match_id") == "m7")
            h.net.push("n1", "control", {"cmd": "recall"})
            assert await _until(lambda: node.arm_state == "kitted")
            await node.close()
    _run(go())


def test_stale_and_return():
    if not HAVE_WS:
        return _skip("stale")

    async def go():
        async with _Harness(stale_after_ms=300) as h:
            node = MockNode(h.url, node_id="n1", heartbeat_ms=50, backoff_cap_s=0.2)
            await node.start()
            await node.wait_connected()
            await node.disconnect()
            assert await _until(lambda: h.stale and h.stale[0][0] == "n1", timeout=3)
            assert h.stale[0][1] >= 300 and len(h.stale) == 1
            assert "n1" in h.net.nodes and not h.net.nodes["n1"].connected   # stale, not gone
            node.reconnect()
            assert await _until(lambda: h.returned == ["n1"], timeout=5)
            await asyncio.sleep(0.5)
            assert len(h.stale) == 1          # no re-fire while alive
            await node.close()
    _run(go())


def test_takeover_by_node_id_and_by_gun():
    if not HAVE_WS:
        return _skip("takeover")

    async def go():
        async with _Harness(stale_after_ms=250) as h:
            a = MockNode(h.url, node_id="n1", gun_name="GUN-A", gun_tail="3D4F", heartbeat_ms=100)
            await a.start()
            await a.wait_connected()
            key = a.node_key                       # A8: the per-node secret from welcome
            assert key
            # (1) legit restart: same node_id + the correct key → takeover, old socket closed
            b = MockNode(h.url, node_id="n1", gun_name="GUN-A", gun_tail="3D4F", heartbeat_ms=100)
            b.node_key = key
            a._paused = True                       # don't let the old one fight back
            await b.start()
            await b.wait_connected()
            assert await _until(lambda: a._ws is None, timeout=3)
            assert h.net.stats["takeovers"] >= 1 and h.net.nodes["n1"].ws is not None
            # (2) rogue: same node_id, WRONG/absent key, old still fresh → refused (can't kick a player)
            rogue = MockNode(h.url, node_id="n1", gun_name="GUN-A", gun_tail="3D4F", heartbeat_ms=100)
            rogue.node_key = "not-the-key"
            await rogue.start()
            await asyncio.sleep(0.5)
            assert not rogue.connected and h.net.stats["rejected"] >= 1
            assert h.net.nodes["n1"].ws is not None    # b still holds it; rogue was refused
            await rogue.close()
            # (3) hot-swap: a NEW node_id binds the same gun after the old holder goes STALE → succeeds
            b._paused = True
            await asyncio.sleep(0.4)                  # let b's server record age past stale_after_ms
            c = MockNode(h.url, node_id="n2", gun_name="GUN-A", gun_tail="3D4F", heartbeat_ms=100)
            await c.start()
            await c.wait_connected()
            assert await _until(lambda: h.net.nodes["n2"].gun_name == "GUN-A" and h.net.nodes["n2"].connected, 3)
            for n in (a, b, c):
                await n.close()
    _run(go())


def test_rogue_and_malformed_handling():
    if not HAVE_WS:
        return _skip("rogue")

    async def go():
        from websockets.asyncio.client import connect
        async with _Harness(hello_timeout_s=0.3) as h:
            # no hello → closed after the grace window
            ws = await connect(h.url, ping_interval=None)
            try:
                await asyncio.wait_for(ws.recv(), 2)
                assert False, "expected close"
            except asyncio.TimeoutError:
                assert False, "server did not close a hello-less socket"
            except Exception as e:
                assert type(e).__name__.startswith("ConnectionClosed"), e
            finally:
                with contextlib.suppress(Exception):
                    await ws.close()
            assert h.net.stats["quarantined"] >= 1
            # wrong version → control{end, reason:version} then close 4001
            ws = await connect(h.url, ping_interval=None)
            try:
                env = E.make_envelope("hello", {"node_id": "x", "node_type": "phone", "app_ver": "1", "seq_next": 1})
                env["v"] = 9
                await ws.send(json.dumps(env))
                msg = json.loads(await asyncio.wait_for(ws.recv(), 2))
                assert msg["kind"] == "control" and msg["body"]["reason"] == "version"
                try:
                    await asyncio.wait_for(ws.recv(), 2)
                    assert False, "expected close 4001"
                except Exception as e:
                    rcvd = getattr(e, "rcvd", None)
                    assert rcvd is not None and rcvd.code == 4001, e
            finally:
                with contextlib.suppress(Exception):
                    await ws.close()
            # a bad frame on a good socket is dropped, not fatal; a flood closes it
            node = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            node.send_raw("not json")
            node.send_raw(json.dumps({"v": 1, "kind": "nope", "id": "z", "t": E.now_ms(), "body": {}}))
            await asyncio.sleep(0.2)
            assert node.connected and h.net.stats["malformed"] >= 2
            node.arm_state, node.alive, node.match_id = "live", True, "m1"
            node.take_hit(19, 2)
            assert await _until(lambda: len(h.events) == 1)
            await node.close()
            # a flood of malformed frames from a (rogue) raw client → quarantined: closed with 1008
            ws = await connect(h.url, ping_interval=None)
            try:
                await ws.send(json.dumps(E.make_envelope("hello", {"node_id": "rogue", "node_type": "phone",
                                                                     "app_ver": "1", "seq_next": 1})))
                await asyncio.wait_for(ws.recv(), 2)          # welcome
                for _ in range(40):
                    await ws.send("garbage")
                try:
                    await asyncio.wait_for(ws.recv(), 3)
                    assert False, "expected the flood to be quarantined"
                except Exception as e:
                    rcvd = getattr(e, "rcvd", None)
                    assert rcvd is not None and rcvd.code == 1008, e
            finally:
                with contextlib.suppress(Exception):
                    await ws.close()
            assert h.net.stats["quarantined"] >= 2
    _run(go())


def test_join_info_and_oversize_frame():
    if not HAVE_WS:
        return _skip("join_info")

    async def go():
        async with _Harness() as h:
            info = h.net.join_info()
            assert info["url"] == h.url and info["qr"] == info["url"] and info["session_id"] == h.net.session_id
            node = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            node.send_raw("{" + "x" * (70 * 1024))
            await asyncio.sleep(0.3)
            # websockets' max_size closes the socket with 1009; the node reconnects on its own
            assert h.net.nodes["n1"] is not None
            await node.close()
    _run(go())


def test_non_ws_http_path_gets_a_404_not_a_dropped_connection():
    """MEDIUM (2026-09-12): `process_request` refuses anything but `ws_path` with a real HTTP 404
    (`Response(404, "Not Found", Headers(), ...)`). Pinned as a regression: an older
    `Response(404, "Not Found", None, ...)` raised AttributeError inside websockets at serialize time because a response's
    headers must be a `Headers` object, and the client saw the socket dropped rather than a 404."""
    if not HAVE_WS:
        return _skip("404")
    try:
        import httpx
    except ImportError:
        raise Skipped("httpx")

    async def go():
        async with _Harness() as h:
            async with httpx.AsyncClient() as client:
                r = await client.get(f"http://127.0.0.1:{h.net.port}/not-the-ws-path")
                assert r.status_code == 404
    _run(go())


# ── polish-loop 2026-08-26 deferred low, closed 2026-09-01 ───────────────────────────────────────
def test_a_late_mdns_registration_unpublishes_itself():
    """`advertise_mdns()` runs in a worker thread behind a 6 s `wait_for`, and a timeout abandons the
    AWAIT, not the thread. A wedged multicast stack that finishes afterwards used to leave a service
    advertised that nothing tracked and `stop()` had already run past — phones kept discovering an
    MC that was gone."""
    import sys
    import types
    from brx_mcp.mc.net import NetServer

    closed = []

    class FakeZeroconf:
        def __init__(self):
            self.registered = None

        def register_service(self, info):
            self.registered = info
            net.abort_mdns()                 # the caller gives up WHILE we are registering

        def close(self):
            closed.append(self)

    fake = types.ModuleType("zeroconf")
    fake.Zeroconf = FakeZeroconf
    fake.ServiceInfo = lambda *a, **k: {"info": True}
    saved = sys.modules.get("zeroconf")
    sys.modules["zeroconf"] = fake
    try:
        net = NetServer()
        net._host, net._port, net._advertised_host = "127.0.0.1", 8765, "127.0.0.1"
        assert net.advertise_mdns() is False, "a late registration must not report success"
        assert len(closed) == 1, "the late registration must be torn down"
        assert net._zeroconf is None, "and never stashed — stop() has already run past it"

        # once aborted, a fresh attempt does not even open a Zeroconf
        closed.clear()
        assert net.advertise_mdns() is False and not closed
    finally:
        if saved is None:
            sys.modules.pop("zeroconf", None)
        else:
            sys.modules["zeroconf"] = saved


def test_a_restarted_server_can_advertise_again():
    """`stop()` sets the mDNS abort latch so a late worker unpublishes itself. That latch must be
    cleared on the next `start()`, or a restarted NetServer silently never advertises again —
    `resume_mdns()` existed with no caller, i.e. the guard was only half applied (2026-09-01)."""
    needs(HAVE_WS, "websockets")
    from brx_mcp.mc.net import NetServer
    n = NetServer()
    n.abort_mdns()
    assert n._mdns_abort.is_set()

    async def go():
        # start and stop must share ONE loop — the server binds to the loop it was started on
        await n.start(host="127.0.0.1", port=0)
        try:
            assert not n._mdns_abort.is_set(), "start() must clear a previous abort"
        finally:
            await n.stop()
        assert n._mdns_abort.is_set(), "stop() re-arms it for any worker still in flight"

    _run(go())
