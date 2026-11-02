"""F659 (Tony: trust option A): LAN trust is unchanged, but the host SEES a never-seen player phone join.

`NEW PHONE JOINED: <device or node id>` is `State.notices.new_phone`. The first LAN hello of a player node id this
MC home has never heard from raises it; a rejoin, a utility station and a restart do not.

Run: python3 run_tests.py mc_new_phone
"""
import asyncio
import tempfile
from pathlib import Path

from _net_harness import NetHarness as _Harness, net_until as _until, run_net as _run
from _session import mc_session
from _skip import Skipped

try:
    from brx_mcp.mc.mock_node import MockNode, UtilityNode
    HAVE_WS = True
except ImportError:
    HAVE_WS = False

from brx_mcp.mc.seen_nodes import SeenNodes


def test_seen_nodes_survive_a_restart_and_seed_from_the_known_phones():
    with tempfile.TemporaryDirectory() as d:
        home = Path(d)
        a = SeenNodes(home, seed={"old-1"})
        assert a.add("n1") is True and a.add("n1") is False
        assert a.add("old-1") is False, "a phone that already held a trust key is not new on upgrade"
        b = SeenNodes(home, seed=set())          # a restart reads the file back
        assert b.add("n1") is False and b.add("n2") is True


def _flags(h):
    return [c.get("new_phone") for c in h.hydrate_calls]


def test_the_first_lan_hello_of_a_player_is_flagged_once_and_a_station_never():
    if not HAVE_WS:
        raise Skipped("websockets")

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="phone-a", heartbeat_ms=100)
            await node.start(); await node.wait_connected()
            assert _flags(h) == [True]
            key = node.node_key
            await node.close()
            again = MockNode(h.url, node_id="phone-a", heartbeat_ms=100)
            again.node_key = key
            await again.start(); await again.wait_connected()
            assert _flags(h) == [True, None], "a known phone rejoining is not new"
            await again.close()
            st = UtilityNode(h.url, node_id="station-a")
            await st.start(); await asyncio.wait_for(st.welcomed.wait(), 5)
            assert _flags(h)[-1] is None, "a utility station is not a player phone"
            await st.close()
    _run(go())


def test_the_session_line_names_the_device_or_the_node_id_and_expires():
    s = mc_session()
    clock = [1_000_000]
    s.now_ms = lambda: clock[0]
    s._hydrate({"node_id": "px5", "node_type": "phone", "new_phone": True, "device": "Google Pixel 5"})
    assert s.snapshot()["notices"]["new_phone"] == "NEW PHONE JOINED: Google Pixel 5"
    s._hydrate({"node_id": "px6", "node_type": "phone", "new_phone": True})
    assert s.snapshot()["notices"]["new_phone"] == "NEW PHONE JOINED: px6"
    s._hydrate({"node_id": "px6", "node_type": "phone"})
    assert "new_phone" in s.snapshot()["notices"], "a rejoin does not clear or repeat it"
    clock[0] += 11 * 60 * 1000
    assert "new_phone" not in s.snapshot()["notices"]
    s._hydrate({"node_id": "st1", "node_type": "utility", "new_phone": True})
    assert "new_phone" not in s.snapshot()["notices"]


# ---- F659 part 2: two MCs on one LAN. Each says when it started, so a phone can pick the newer one.
def test_the_welcome_and_the_mdns_record_say_when_this_mc_started():
    if not HAVE_WS:
        raise Skipped("websockets")
    import sys
    import types
    from brx_mcp.mc.net import NetServer
    seen = {}
    fake = types.ModuleType("zeroconf")
    fake.Zeroconf = type("Z", (), {"register_service": lambda self, info: None, "close": lambda self: None})
    fake.ServiceInfo = lambda *a, **k: seen.update(k) or {"info": True}
    saved = sys.modules.get("zeroconf")
    sys.modules["zeroconf"] = fake
    try:
        net = NetServer()
        net._host, net._port, net._advertised_host = "127.0.0.1", 8765, "127.0.0.1"
        net.advertise_mdns()
    finally:
        if saved is None:
            sys.modules.pop("zeroconf", None)
        else:
            sys.modules["zeroconf"] = saved
    txt = seen["properties"]
    assert txt["started_at"] == str(net.started_at) and net.started_at > 1_700_000_000_000, txt
    assert txt["server_name"] == net.server_name and net.server_name

    async def go():
        async with _Harness() as h:
            node = MockNode(h.url, node_id="phone-b", heartbeat_ms=100)
            await node.start(); await node.wait_connected()
            w = node.welcome_body
            assert w["started_at"] == h.net.started_at and w["server_name"] == h.net.server_name, w
            await node.close()
    _run(go())
