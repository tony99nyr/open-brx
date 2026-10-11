"""The e2e stand-ins (`webapp/mc/test/e2e/nodes.py`) rely on two MockNode shapes: `UtilityNode`'s heartbeat is the real
utility one (`role: "utility"`, what `app/src/utility.js` `utilityStatusBody` sends and `Session._on_status` reads as a
station report), never the phone shape; and `MockNode.extra_status` rides on a phone's heartbeat (O6, O10, `pool_stale`)."""
import asyncio

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
