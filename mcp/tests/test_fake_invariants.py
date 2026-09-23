"""Behaviour shared by the real Session, FakeNet and the wire-level MockNode."""
import json
from pathlib import Path

from brx_mcp.mc.mock_node import MockNode
from test_mc_lobby_updating import ack, lobby, to_lobby


def test_invariant_ids():
    rows = json.loads((Path(__file__).parents[1] / "brx_mcp/mc/fake_invariants.json").read_text())
    ids = [row["id"] for row in rows]
    assert len(ids) == len(set(ids)) and all(row["rule"].endswith(".") for row in rows)
    assert set(ids) == {name.removeprefix("test_inv_") for name in globals() if name.startswith("test_inv_")}


def test_inv_gun_binding():
    s, _, _, ps = to_lobby(2)
    assert s.players[ps[0]["player_id"]]["node_id"] == "node0"
    assert s.players[ps[1]["player_id"]]["node_id"] == "node1"
    node = MockNode("ws://unused", gun_name="GUN-A")
    node._absorb_context({"player": {"player_id": ps[0]["player_id"], "player_num": 1}})
    assert node.player_id == ps[0]["player_id"]


def test_inv_push_acks():
    s, net, clock, ps = to_lobby(2)
    s.push_config()
    ack(s, net, clock, 0)
    s.set_ready(ps[0]["player_id"], True, host_override=True)
    s.push_config()
    assert s.acks == {} and s.players[ps[0]["player_id"]]["ready"] is True


def test_inv_current_ack():
    s, net, clock, ps = to_lobby(2)
    s.push_config()
    pid = ps[0]["player_id"]
    ack(s, net, clock, 0, config_id="older")
    assert not s._ack_is_current(pid) and not s.all_acked()
    ack(s, net, clock, 0)
    assert s._ack_is_current(pid)
    sent = []
    node = MockNode("ws://unused")
    node._send = sent.append
    node._handle({"kind": "config", "body": {"config": {"config_id": "head-one"}, "frames": {}}})
    assert sent[-1]["kind"] == "ack_config" and sent[-1]["body"]["config_id"] == "head-one"


def test_inv_fresh_repush():
    s, net, clock, _ = to_lobby(2)
    s.push_config()
    old = s.config["config_id"]
    ack(s, net, clock, 0)
    s.push_config()
    assert s.config["config_id"] != old and s.acks == {}
    node = MockNode("ws://unused")
    node._absorb_context({"config": {"config_id": old}})
    node._absorb_context({"config": {"config_id": s.config["config_id"]}})
    assert node.config_id == s.config["config_id"]


def test_inv_updating():
    s, net, clock, ps = to_lobby(2)
    s.push_config()
    s.ready_all()
    assert lobby(s)["updating"] == 2
    ack(s, net, clock, 0, config_id="older")
    ack(s, net, clock, 1, ok=False)
    assert lobby(s)["updating"] == 1
    ack(s, net, clock, 0)
    assert lobby(s)["updating"] == 0 and lobby(s)["ready"] == len(ps)


def test_inv_coverage_zones():
    s, _, _, ps = to_lobby(2)
    for i in range(len(ps)):
        s.net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}", via="backhaul")
    assert s.coverage() == {"level": "zones", "on_backhaul": 2, "bound": 2}, "every phone on the tunnel is still zones"


def test_inv_stale_start():
    s, net, clock, _ = to_lobby(2)
    s.push_config()
    ack(s, net, clock, 0, config_id="older")
    ack(s, net, clock, 1)
    try:
        s.start(10, force=True)
    except ValueError as error:
        assert "OLDER" in str(error)
    else:
        raise AssertionError("START accepted an older head")
