"""M-NET tests (net.md / contracts §5): envelope validation runs everywhere; the live
server + MockNode tests need `websockets` and SKIP cleanly without it
(`.venv/bin/python run_tests.py mc_net` runs them for real)."""
from __future__ import annotations

import asyncio
import contextlib
import json
import time

from _net_harness import NetHarness as _Harness, net_until as _until, run_net as _run
from _skip import Skipped, needs
from _async import until

from brx_mcp.mc import envelope as E
from brx_mcp.mc.types import PROTOCOL_V

try:
    import websockets  # noqa: F401
    HAVE_WS = True
except ImportError:  # system python
    HAVE_WS = False

if HAVE_WS:
    from brx_mcp.mc.mock_node import MockNode
    from brx_mcp.mc.net import NetServer, NodeRecord


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
            h.net.stale_after_ms = 300
            await until(lambda: not h.net._fresh(h.net.nodes["n1"]), what="node n1 becomes stale")
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
            await until(lambda: h.net.stats["rejected"] >= 1, what="rogue hello is rejected")
            await asyncio.sleep(0.5)   # a window that must pass with the rogue never connected (the count rises before the close)
            assert not rogue.connected and h.net.stats["rejected"] >= 1
            assert h.net.nodes["n1"].ws is not None    # b still holds it; rogue was refused
            await rogue.close()
            # (3) hot-swap: a NEW node_id binds the same gun after the old holder goes STALE → succeeds
            b._paused = True
            await until(lambda: not h.net._fresh(h.net.nodes["n1"]), what="node n1 becomes stale")
            c = MockNode(h.url, node_id="n2", gun_name="GUN-A", gun_tail="3D4F", heartbeat_ms=100)
            await c.start()
            await c.wait_connected()
            assert await _until(lambda: h.net.nodes["n2"].gun_name == "GUN-A" and h.net.nodes["n2"].connected, 3)
            for n in (a, b, c):
                await n.close()
    _run(go())


def test_hud_hello_consumes_only_a_proven_prior_utility_identity():
    """F184: brxu/brx are distinct ids; the old takeover key is the authenticated physical bridge."""
    if not HAVE_WS:
        return _skip("prior utility identity")

    async def go():
        async with _Harness() as h:
            util = MockNode(h.url, node_id="brxu-old", node_type="utility", gun_name="", gun_tail="")
            await util.start(); await util.wait_connected()
            assert util.node_key

            rogue = MockNode(h.url, node_id="brx-rogue", gun_name="GUN-R", gun_tail="0001",
                             prior_utility={"node_id": "brxu-old", "node_key": "wrong"})
            await rogue.start(); await rogue.wait_connected()
            assert "brxu-old" in h.net.nodes and not rogue.prior_utility_consumed
            assert not any(n.get("prior_utility_node_id") for n in h.nodes if n["node_id"] == "brx-rogue")
            await rogue.close()

            wrong_role = MockNode(h.url, node_id="brxu-other", node_type="utility", gun_name="", gun_tail="",
                                  prior_utility={"node_id": "brxu-old", "node_key": util.node_key})
            await wrong_role.start(); await wrong_role.wait_connected()
            assert ("brxu-old" in h.net.nodes and not wrong_role.prior_utility_consumed), \
                "only a HUD hello can consume the old utility identity"
            await wrong_role.close()

            hud = MockNode(h.url, node_id="brx-new", gun_name="GUN-H", gun_tail="0002",
                           prior_utility={"node_id": "brxu-old", "node_key": util.node_key})
            await hud.start(); await hud.wait_connected()
            assert hud.prior_utility_consumed
            assert "brxu-old" not in h.net.nodes
            assert await _until(lambda: any(n.get("prior_utility_node_id") == "brxu-old"
                                            for n in h.nodes if n["node_id"] == "brx-new"))
            await hud.close(); await util.close()
    _run(go())


def test_a_failed_handoff_welcome_leaves_the_old_proof_retryable():
    """F184 polish: consumption is committed only after its acknowledgement reaches the new HUD."""
    if not HAVE_WS:
        return _skip("prior utility retry")

    class BrokenWs:
        async def send(self, _raw): raise OSError("link died before welcome")
        async def close(self, *_args): pass

    class GoodWs:
        def __init__(self): self.sent = []
        async def send(self, raw): self.sent.append(E.decode(raw, direction="mc"))
        async def close(self, *_args): pass

    async def go():
        net = NetServer()
        old = NodeRecord(node_id="brxu-old", node_type="utility", node_key="old-proof", hello_ok=True)
        net.nodes[old.node_id] = old
        claim = {"node_id": "brxu-old", "node_key": "old-proof"}
        first = NodeRecord(node_id="brx-first", node_key="first-key")
        net.nodes[first.node_id] = first
        body = {"node_id": first.node_id, "node_type": "phone", "app_ver": "x", "seq_next": 1,
                "prior_utility": claim}
        try:
            await net._hello_gate(BrokenWs(), body, first, "")
            assert False, "the broken welcome unexpectedly landed"
        except OSError:
            pass
        assert net.nodes.get("brxu-old") is old and not net._utility_handoffs

        retry = NodeRecord(node_id="brx-retry", node_key="retry-key")
        net.nodes[retry.node_id] = retry
        ws = GoodWs()
        await net._hello_gate(ws, {**body, "node_id": retry.node_id}, retry, "")
        assert ws.sent[0]["body"]["prior_utility_consumed"] is True
        assert "brxu-old" not in net.nodes
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


def test_f490_a_utility_hello_forgets_the_player_the_node_held():
    """F490: NetServer kept a node's player_id through a utility hello and fired it back on the node's next HUD hello, so
    a phone that became a station and then came back with a gun nobody owns got its old player bound again."""
    if not HAVE_WS:
        return _skip("utility forgets player")

    async def go():
        async with _Harness() as h:
            h.context = {"player": {"player_id": "p1", "player_num": 6}, "team": {"team_id": "blue", "tid": 1},
                         "roster": [], "config": {"config_id": "c1", "time_limit_s": 600,
                                                  "health": {"max_hp": 45, "max_armor": 70}}}
            hud = MockNode(h.url, node_id="n1", gun_name="GUN-A", gun_tail="3D4F")
            await hud.start(); await hud.wait_connected()
            assert await _until(lambda: h.net.nodes["n1"].player_id == "p1"), "control: the phone bound p1"
            await hud.close()
            h.context = None                                  # a station, then a gun nobody owns: hydrate binds no one
            util = MockNode(h.url, node_id="n1", node_type="utility", gun_name="", gun_tail="")
            util.node_key = hud.node_key                      # the same phone: it re-claims its id with its key
            await util.start(); await util.wait_connected()
            assert h.net.nodes["n1"].player_id is None, "the station still speaks for p1"
            await util.close()
            back = MockNode(h.url, node_id="n1", gun_name="GUN-X", gun_tail="0000")
            back.node_key = util.node_key
            await back.start(); await back.wait_connected()
            assert await _until(lambda: h.nodes and h.nodes[-1]["node_id"] == "n1" and h.nodes[-1]["node_type"] == "phone")
            assert "player_id" not in h.nodes[-1], ("the HUD comeback carried the old player", h.nodes[-1])
            await back.close()
    _run(go())


def test_f492_a_station_mc_still_holds_is_never_pruned_while_offline():
    """F492: the prune dropped every disconnected record with no player after 10 min. Since F490 that includes a phone
    turned station, so its HUD comeback could not prove the old utility identity (F184) and MC kept listing the station.
    A record MC still holds as a station (the `retain` hook) is kept; any other unbound record is still pruned."""
    if not HAVE_WS:
        return _skip("prune")
    import time as _t
    from brx_mcp.mc.net import PRUNE_AFTER_MS
    net = NetServer()
    held = {"util-1"}
    net.retain(lambda nid: nid in held)
    old = _t.monotonic() - (PRUNE_AFTER_MS / 1000 + 60)
    kept = NodeRecord(node_id="util-1", node_type="utility", hello_ok=True, last_seen=old)
    gone = NodeRecord(node_id="util-2", node_type="utility", hello_ok=True, last_seen=old)
    assert not net._prunable(kept, _t.monotonic()), "a station MC holds is kept"
    assert net._prunable(gone, _t.monotonic()), "control: an unheld unbound record is still pruned"


def test_a_decoder_or_handler_bug_costs_the_frame_not_the_socket():
    """Seams #1 belt (brx3): E.decode refuses with EnvelopeError, but any other exception from it (a decoder bug, the
    OverflowError a 400-digit integer once raised) fell to the handler's outer except and dropped the node's socket.
    The same for an exception while dispatching one frame. Both now cost the frame only."""
    if not HAVE_WS:
        return _skip("belt")

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            ws0 = h.net.nodes["n1"].ws     # MockNode reconnects on its own: a dropped socket shows as a new socket here
            real_decode = E.decode

            def boom(raw, **kw):
                if "BOOM" in (raw if isinstance(raw, str) else raw.decode("utf-8", "replace")):
                    raise RuntimeError("decoder bug")
                return real_decode(raw, **kw)
            E.decode = boom
            try:
                before = h.net.stats["malformed"]
                node.send_raw('{"BOOM": 1}')
                assert await _until(lambda: h.net.stats["malformed"] > before)
                await asyncio.sleep(0.2)
                assert h.net.nodes["n1"].ws is ws0, "a decoder bug dropped the socket"
            finally:
                E.decode = real_decode
            real_dispatch = h.net._dispatch
            calls = []

            def bad_dispatch(rec, env, t_recv):
                calls.append(env["kind"])
                if env["kind"] == "status" and len(calls) < 3:
                    raise KeyError("handler bug")
                return real_dispatch(rec, env, t_recv)
            h.net._dispatch = bad_dispatch
            try:
                assert await _until(lambda: h.net.stats["dispatch_errors"] >= 1)
                await asyncio.sleep(0.3)
                assert h.net.nodes["n1"].ws is ws0, "a handler bug dropped the socket"
                assert await _until(lambda: calls.count("status") >= 3), "frames after the failure must still be handled"
            finally:
                h.net._dispatch = real_dispatch
            # an event whose handling fails is still acked (Codex r1): the phone must not hold the fact until a reconnect
            acks = len(node.acks)

            def bad_event(rec, env, t_recv):
                if env["kind"] == "event":
                    raise KeyError("handler bug on an event")
                return real_dispatch(rec, env, t_recv)
            h.net._dispatch = bad_event
            try:
                node.arm_state, node.alive, node.match_id = "live", True, "m1"
                node.take_hit(19, 2)
                assert await _until(lambda: len(node.acks) > acks), "a failed event dispatch sent no ack"
                assert h.net.nodes["n1"].ws is ws0
            finally:
                h.net._dispatch = real_dispatch
            await node.close()

    asyncio.run(go())


def test_f513_a_fact_mc_did_not_store_is_never_covered_by_a_later_ack():
    """F513: seq_hi is a maximum, so an ack after a gap told the phone to drop a fact MC never stored. Phone outbox
    [1, 2, 3]: MC refuses 2 (a frame it reads as malformed) and stores 3; the ack said 3 and the phone pruned 2 for good.
    The ack is now the contiguous prefix MC holds: 1, and the phone keeps 2 to resend. (A fact whose MC handler RAISES is
    still treated as stored: the handler may already have scored it, and a resend could count it twice.)"""
    if not HAVE_WS:
        return _skip("f513")

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            node.arm_state, node.alive, node.match_id = "live", True, "m1"
            node.take_hit(19, 2)                                   # seq 1: stored
            assert await _until(lambda: 1 in node.acks)
            bad = node.emit({"type": "hit_taken"})                 # seq 2: MC refuses it (no shooter_num, no dmg)
            node.take_hit(19, 2)                                   # seq 3: stored
            assert await _until(lambda: h.net.nodes["n1"].seq_hi >= 3)
            await asyncio.sleep(0.2)
            assert max(node.acks) < bad, f"an ack covered the refused fact {bad}: {node.acks}"
            assert any(s == bad for s, _ in node.ring), "the phone dropped a fact MC never stored"

            # the phone resends the gap after a reconnect; MC stores it then, and the ack moves past everything
            await node.disconnect()
            # stand in for a fact MC can read this time (the real case: an MC fix, or a phone update, between reconnects)
            good = next(e for s, e in node.ring if s == bad + 1)
            node.ring = [(s, {**good, "t": e["t"]}) if s == bad else (s, e) for s, e in node.ring]
            node.reconnect()
            await node.wait_connected()
            assert await _until(lambda: node.acks and max(node.acks) >= bad + 1, 8), node.acks
            await node.close()

    asyncio.run(go())


def test_f513_a_connected_phone_recovers_after_the_grace_and_its_heartbeat_gets_the_ack():
    """brx5's landed-late review (Medium): the phone resends its ring only after a reconnect, so a hole left open while
    it stays connected kept every later fact un-acked (status.pending > 0), and MC withheld its global alerts for that
    player for the rest of the match. A hole not resent within HOLE_GRACE_S is now given up, and the next heartbeat
    carries the ack, so the phone prunes and its pending count returns to 0."""
    if not HAVE_WS:
        return _skip("f513 grace")
    from brx_mcp.mc import net as N
    saved = N.HOLE_GRACE_S
    N.HOLE_GRACE_S = 0.3

    async def go():
        async with _Harness() as h:
            said = []
            h.net.on_node_message(lambda nid, kind, body, t: said.append((kind, body)))
            node = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            node.arm_state, node.alive, node.match_id = "live", True, "m1"
            node.take_hit(19, 2)
            assert await _until(lambda: 1 in node.acks)
            bad = node.emit({"type": "hit_taken"})                 # MC refuses it
            for _ in range(5):
                node.take_hit(19, 2)                               # later facts, stored
            assert await _until(lambda: h.net.nodes["n1"].seq_hi >= bad + 5)
            assert max(node.acks) < bad
            # no further event: only the heartbeat can carry the ack that frees the phone
            assert await _until(lambda: max(node.acks) >= bad + 5, 4), node.acks
            assert await _until(lambda: not node.ring, 2), f"the phone still holds {len(node.ring)} un-acked facts"
            assert [b["seq"] for k, b in said if k == "fact_unreadable"] == [bad], said
            await node.close()
    try:
        asyncio.run(go())
    finally:
        N.HOLE_GRACE_S = saved


def test_f513_holes_given_up_together_are_one_callback_with_a_count():
    """brx5's landed-late review (Low): a refused batch of 200 sound items, refused twice, gave up 200 holes one by one,
    and the operator's feed got 200 identical alert rows. One frame's holes are now one callback with a count."""
    import json as _json
    from brx_mcp.mc.net import NetServer, NodeRecord
    srv = NetServer()
    said = []
    srv.on_node_message(lambda nid, kind, body, t: said.append((kind, body)))
    rec = NodeRecord("n1")
    good = lambda q: {"seq": q, "type": "respawn", "t": E.now_ms(), "node_id": "n1", "player_id": "p1", "match_id": "m1"}
    raw = _json.dumps({"v": E.PROTOCOL_V + 1, "kind": "event_batch", "id": "b", "t": E.now_ms(),
                       "body": {"events": [good(q) for q in range(1, 201)]}})
    srv._note_holes(rec, raw)
    srv._note_holes(rec, raw)
    lost = [b for k, b in said if k == "fact_unreadable"]
    assert len(lost) == 1 and lost[0]["count"] == 200 and lost[0]["seq"] == 1, [(b.get("count"), b.get("seq")) for b in lost]
    assert not rec.holes and srv._ack_hi(rec) == 200, srv._ack_hi(rec)   # acked through the given-up batch


def test_f513_hole_rules_refusals_batches_and_the_limit():
    """F513 review (Opus, brx4): (1) a fact refused again on its resend is permanent (the phone resends the same bytes):
    MC acks past it and says so, once; (2) a refused batch opens holes only for seqs MC never saw, never for items it
    stored beyond the applied window (a later resend would score them twice); (3) a hole not resent within HOLE_LIMIT
    later facts is given up on the next ack, even with no further refused frame."""
    import json as _json
    from brx_mcp.mc import net as N
    from brx_mcp.mc.net import NetServer, NodeRecord
    srv = NetServer()
    said = []
    srv.on_node_message(lambda nid, kind, body, t: said.append((kind, body["seq"])))
    rec = NodeRecord("n1")
    rec.seq_hi = 10
    bad = _json.dumps({"v": 1, "kind": "event", "id": "x", "t": E.now_ms(), "seq": 11, "body": {"type": "hit_taken"}})
    srv._note_holes(rec, bad)
    assert rec.holes == {11} and srv._ack_hi(rec) == 10
    srv._note_holes(rec, bad)                                  # the resend, refused again
    assert not rec.holes and srv._ack_hi(rec) == 11 and said == [("fact_unreadable", 11)]   # final pass: acked THROUGH the given-up fact
    # a refused batch: items 3..12 (3..10 MC holds, outside a small applied window) open a hole for 12 only
    rec2 = NodeRecord("n2")
    rec2.seq_hi = 10
    batch = _json.dumps({"v": 1, "kind": "event_batch", "id": "y", "t": E.now_ms(),
                         "body": {"events": [{"seq": s, "type": "hit_taken"} for s in range(3, 13)]}})
    srv._note_holes(rec2, batch)
    assert rec2.holes == {11, 12}, rec2.holes
    # a resent batch with ONE bad item (Codex r1): the good items come back to be stored, only the bad one is a hole
    rec4 = NodeRecord("n4")
    rec4.seq_hi = 10
    good = lambda q: {"seq": q, "type": "respawn", "t": E.now_ms(), "node_id": "n4", "player_id": "p1", "match_id": "m1"}
    mixed = _json.dumps({"v": E.PROTOCOL_V, "kind": "event_batch", "id": "w", "t": E.now_ms(),
                         "body": {"events": [good(11), {"seq": 12, "type": "hit_taken"}, good(13)]}})
    back = srv._note_holes(rec4, mixed)
    assert back is not None and [i["seq"] for i in back["body"]["events"]] == [11, 13], back
    assert rec4.holes == {12}, rec4.holes
    # a given-up seq is a tombstone: the next refused resend does not reopen it or alert again
    srv._note_holes(rec4, mixed)                                # refused again: 12 is given up
    n_said = len(said)
    srv._note_holes(rec4, mixed)
    assert 12 not in rec4.holes and len(said) == n_said, said
    # the limit: a hole MC never hears again is given up on a later ack
    rec3 = NodeRecord("n3")
    rec3.seq_hi = 5
    srv._note_holes(rec3, _json.dumps({"v": 1, "kind": "event", "id": "z", "t": E.now_ms(), "seq": 6, "body": {}}))
    rec3.seq_hi = 6 + N.HOLE_LIMIT + 1
    assert srv._ack_hi(rec3) == rec3.seq_hi and not rec3.holes and ("fact_unreadable", 6) in said


def test_f513_a_given_up_seq_is_final_and_a_late_copy_is_a_replay():
    """Final pass L1: once MC gives a fact up it acks through it and tells the operator it is lost. A readable copy that
    arrives later must not then be stored and scored behind that alert: it is refused as a replay."""
    import json as _json
    from brx_mcp.mc import net as N
    from brx_mcp.mc.net import NetServer, NodeRecord
    srv = NetServer()
    seen = []
    srv.on_event(lambda nid, ev, t: seen.append(ev["seq"]))
    rec = NodeRecord("n1")
    rec.seq_hi = 10
    srv._note_holes(rec, _json.dumps({"v": 1, "kind": "event", "id": "x", "t": E.now_ms(), "seq": 11, "body": {}}))
    for q in range(12, 16):
        srv._ingest(rec, q, {"type": "respawn", "seq": q}, E.now_ms())
    rec.hole_opened[11] -= N.HOLE_GRACE_S + 1                   # two heartbeats pass with no resend
    assert srv._ack_hi(rec, grace=True) == 15 and 11 in rec.lost_seqs   # the heartbeat path
    assert srv._ingest(rec, 11, {"type": "respawn", "seq": 11}, E.now_ms()) is None and 11 not in seen


def test_f513_a_reconnect_restarts_the_grace_so_a_later_flush_batch_is_not_given_up():
    """Opus r1: hole_opened survived a disconnect, so after any reconnect longer than HOLE_GRACE_S every hole was stale,
    and the ack after the first resend batch gave up holes whose resends were still in a later batch (beyond the
    reorder window, a fact that would have landed was lost). The hello restarts each hole's grace."""
    if not HAVE_WS:
        return _skip("f513 regrace")
    from brx_mcp.mc import net as N
    saved = N.HOLE_GRACE_S
    N.HOLE_GRACE_S = 0.3

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="n1", heartbeat_ms=10_000)     # no heartbeat inside this test
            await node.start()
            await node.wait_connected()
            node.arm_state, node.alive, node.match_id = "live", True, "m1"
            node.take_hit(19, 2)
            assert await _until(lambda: 1 in node.acks)
            bad = node.emit({"type": "hit_taken"})
            assert await _until(lambda: bad in h.net.nodes["n1"].holes)
            await node.disconnect()
            await asyncio.sleep(0.5)                                   # longer than the grace, while offline
            node.ring = [(s, e) for s, e in node.ring if s != bad]     # no resend of it, so the hole stays open
            t_back = time.monotonic()
            node.reconnect()
            await node.wait_connected()
            rec = h.net.nodes["n1"]
            assert bad in rec.holes and rec.hole_opened[bad] >= t_back, "the hello did not restart the hole's grace"
            await node.close()
    try:
        asyncio.run(go())
    finally:
        N.HOLE_GRACE_S = saved



def test_f513_only_a_heartbeat_expires_a_hole_never_a_batch_ack():
    """Codex r2: the grace started at hello, so on a slow welcome or backhaul the ack after the first resend batch could
    still expire a hole whose resend was in a later batch. Only the heartbeat path applies the grace now: the phone
    heartbeats after its flush and the socket keeps order, so by then every resend it holds has been read."""
    import json as _json
    from brx_mcp.mc import net as N
    from brx_mcp.mc.net import NetServer, NodeRecord
    srv = NetServer()
    rec = NodeRecord("n1")
    rec.seq_hi = 10
    srv._note_holes(rec, _json.dumps({"v": 1, "kind": "event", "id": "x", "t": E.now_ms(), "seq": 11, "body": {}}))
    rec.seq_hi = 15
    rec.hole_opened[11] -= N.HOLE_GRACE_S + 1
    assert srv._ack_hi(rec) == 10 and 11 in rec.holes, "a batch ack expired a stale hole"
    assert srv._ack_hi(rec, grace=True) == 15 and 11 not in rec.holes


def test_f513_a_trailing_unreadable_fact_is_acked_through_once_given_up():
    """Final pass (Codex, confirmed High): when the LATEST fact is the refused one, seq_hi never reached it, so giving its
    hole up acked only to the fact before. The phone kept it, later heartbeats sent no further ack, and pending (with the
    alerts that hang on it) never cleared until another readable fact arrived, perhaps never at the end of a match. A
    given-up seq is final: the ack now moves through it."""
    if not HAVE_WS:
        return _skip("f513 trailing")
    from brx_mcp.mc import net as N
    saved = N.HOLE_GRACE_S
    N.HOLE_GRACE_S = 0.3

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="n1", heartbeat_ms=100)
            await node.start()
            await node.wait_connected()
            node.arm_state, node.alive, node.match_id = "live", True, "m1"
            node.take_hit(19, 2)
            assert await _until(lambda: 1 in node.acks)
            bad = node.emit({"type": "hit_taken"})                 # the LAST fact of the match, refused
            # heartbeats only from here on
            assert await _until(lambda: node.acks and max(node.acks) >= bad, 4), f"acks {node.acks}, bad {bad}"
            assert await _until(lambda: not node.ring, 2), f"the phone still holds {len(node.ring)} un-acked facts"
            await node.close()
    try:
        asyncio.run(go())
    finally:
        N.HOLE_GRACE_S = saved


def test_f513_giving_up_a_later_hole_never_skips_an_earlier_one_still_open():
    """Opus r1 on the final-pass fix: holes 11 and 13 open, 12 stored; 13 is given up (seq_hi moves to 13) while 11 is
    still open. The ack must stay below 11, and a resend of 11 must still be stored, after which the ack moves through 13."""
    import json as _json
    from brx_mcp.mc.net import NetServer, NodeRecord
    srv = NetServer()
    rec = NodeRecord("n1")
    rec.seq_hi = 10
    refused = lambda q: _json.dumps({"v": 1, "kind": "event", "id": f"x{q}", "t": E.now_ms(), "seq": q, "body": {}})
    srv._note_holes(rec, refused(11))
    srv._ingest(rec, 12, {"type": "respawn", "seq": 12}, E.now_ms())
    srv._note_holes(rec, refused(13))
    srv._note_holes(rec, refused(13))                        # refused twice: 13 is given up
    assert 13 in rec.lost_seqs and srv._ack_hi(rec) == 10, (rec.seq_hi, rec.holes)
    assert srv._ingest(rec, 11, {"type": "respawn", "seq": 11}, E.now_ms()) is not None, "the earlier hole's resend was refused"
    assert srv._ack_hi(rec) == 13



def test_f513_a_far_later_give_up_never_pushes_an_earlier_hole_over_the_limit():
    """Codex r2 on the final-pass fix: raising seq_hi on a give-up could carry an earlier, still recoverable hole past
    HOLE_LIMIT, and the next ack gave it up too. seq_hi stays the highest stored fact; only the ack runs through lost_hi."""
    import json as _json
    from brx_mcp.mc import net as N
    from brx_mcp.mc.net import NetServer, NodeRecord
    srv = NetServer()
    rec = NodeRecord("n1")
    rec.seq_hi = 10
    refused = lambda q: _json.dumps({"v": 1, "kind": "event", "id": f"x{q}", "t": E.now_ms(), "seq": q, "body": {}})
    srv._note_holes(rec, refused(11))                       # an early hole, still open
    far = 11 + N.HOLE_LIMIT + 50
    rec.seq_hi = 11 + N.HOLE_LIMIT - 1                       # facts stored up to just under the limit for 11
    srv._note_holes(rec, refused(far))
    srv._note_holes(rec, refused(far))                       # refused twice: the far hole is given up
    assert 11 in rec.holes and srv._ack_hi(rec) == 10, "giving up a far later hole gave up the earlier one too"
    assert srv._ingest(rec, 11, {"type": "respawn", "seq": 11}, E.now_ms()) is not None
