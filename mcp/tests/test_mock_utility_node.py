"""The e2e stand-ins (`webapp/mc/test/e2e/nodes.py`) rely on two MockNode shapes: `UtilityNode`'s heartbeat is the real
utility one (`role: "utility"`, what `app/src/utility.js` `utilityStatusBody` sends and `Session._on_status` reads as a
station report), never the phone shape; and `MockNode.extra_status` rides on a phone's heartbeat (O6, O10, `pool_stale`)."""
import asyncio

from _skip import Skipped
from brx_mcp.mc.mock_node import MockNode, UtilityNode


def test_utility_heartbeat_is_the_station_shape_not_the_phone_shape():
    body = UtilityNode("ws://127.0.0.1:1/ws", "util-x", "esp32").status_body()
    assert body["role"] == "utility" and body["node_id"] == "util-x" and body["platform"] == "esp32"
    for k in ("kind", "team", "station_id", "threshold", "live", "armed", "battery", "uptime_s"):
        assert k in body, k
    assert body["threshold"] == -57, "an esp32 Stick's default threshold"
    for k in ("hp", "ammo", "armor", "player_id", "match_id"):
        assert k not in body, f"{k} is phone-shaped"
    assert UtilityNode("ws://x/ws", "u").status_body()["threshold"] == -70


def test_utility_station_config_arms_the_report():
    n = UtilityNode("ws://127.0.0.1:1/ws", "util-y")
    n.apply_station_config({"kind": "hill", "team": 2, "id": 4, "threshold": -65})
    b = n.status_body()
    assert (b["kind"], b["team"], b["station_id"], b["threshold"]) == ("hill", 2, 4, -65)
    assert b["armed"] is True and b["live"] is True and n.configs[-1]["id"] == 4


def test_utility_report_change_reaches_the_heartbeat():
    n = UtilityNode("ws://127.0.0.1:1/ws", "util-z")
    n.report.update(station_id=4, platform="esp32", actions_dropped=3)
    b = n.status_body()
    assert b["station_id"] == 4 and b["actions_dropped"] == 3 and b["platform"] == "esp32"
    assert n.send_status() is False, "no socket: the status went nowhere"


def test_mock_node_extra_status_rides_on_the_phone_heartbeat():
    async def run():
        n = MockNode("ws://127.0.0.1:1/ws", gun_name="GUN-A")
        n.extra_status.update({"pool_stale": "pool_wrong", "battery": 20})
        n.extra_status["outbox_lost"] = {"match_id": "m1", "n": 7}
        b = n.status_body()
        assert b["pool_stale"] == "pool_wrong" and b["battery"] == 20, "an extra field overrides the node's own"
        assert b["outbox_lost"] == {"match_id": "m1", "n": 7} and b["hp"] == n.hp and "role" not in b
        n.extra_status.pop("pool_stale")
        assert "pool_stale" not in n.status_body()
    asyncio.run(run())


def test_utility_heartbeat_arm_state_matches_the_stick_firmware():
    assert UtilityNode("ws://x/ws", "u").status_body()["arm_state"] == "connected"   # hardware/m5sticks3/station_link.h


def test_a_failed_status_send_raises_from_flush():
    class _Broken:
        async def send(self, text):
            raise ConnectionError("closed")

    async def run():
        n = UtilityNode("ws://x/ws", "u")
        n._ws = _Broken()
        n.welcomed.set()
        assert n.send_status() is True
        try:
            await n.flush()
        except RuntimeError as e:
            assert "went nowhere" in str(e)
        else:
            raise AssertionError("flush() hid a send that failed")
    asyncio.run(run())


def test_after_the_socket_closes_a_status_send_reports_failure():
    try:
        from websockets.asyncio.server import serve
    except ImportError:
        raise Skipped("websockets")
    from brx_mcp.mc import envelope as E

    async def handler(ws):
        await ws.recv()                                                  # the hello
        await ws.send(E.encode(E.make_envelope("welcome", {"session_id": "s", "server_t": 0, "seq_hi": 0})))
        await asyncio.sleep(0.3)                                         # long enough for the node to see the welcome
        await ws.close()                                                 # MC drops the station

    async def run():
        async with serve(handler, "127.0.0.1", 0) as server:
            port = server.sockets[0].getsockname()[1]
            n = UtilityNode(f"ws://127.0.0.1:{port}/ws", "u")
            await n.start()
            await n.wait_connected(5)
            assert n._task is not None
            await asyncio.wait_for(asyncio.gather(n._task, return_exceptions=True), 5)   # the node's run ends with the socket
            assert n.send_status() is False, "the socket is closed: the status must not claim to be sent"
    asyncio.run(run())


def test_a_roleless_heartbeat_from_a_utility_hello_still_reaches_the_station_registry():
    """Older apps: the node said hello as `utility`, its status carries no `role` (state.py `node_type == "utility"`)."""
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    t = [1_000_000]
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=lambda: t[0])
    s.net.simulate_utility_hello("old-stick")
    s.net.simulate_status("old-stick", {"arm_state": "connected", "synced": False, "kind": "powerup", "station_id": 6, "battery": 33}, t[0])
    view = next(v for v in s.stations_view() if v["node_id"] == "old-stick")
    assert view["report"].get("station_id") == 6 and view["report"].get("battery") == 33, view
