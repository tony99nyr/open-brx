"""Tony 2026-11-22 (bench): the player picks their voice on the phone's KIT screen.

Pins the MC half: `loadout_request {slot: "voice", id}` sets the same `Player.voice` the console sets, the gun plays one
random spawn line or kill confirm of the new voice after a `$VOL` at the game's head volume, the pick is refused once
the match is in play and before KIT, and every request is acked. `assign.catalog.voices` carries the personas.
"""
import random

from brx_mcp import voices as V
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import KIT_LOCKED, Session
from _session import T0_EPOCH_MS


OPTS = [{"id": i, "name": i.upper(), "family": "", "kill_line": "", "verified": False} for i in ("medic", "scout", "male")]


def _mk(phase="kit"):
    net = FakeNet()
    clock = {"t": T0_EPOCH_MS}
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.compiler.voice_options = lambda: OPTS          # the fake offers none; the real list comes from voices.options()
    s.set_config({"mode": "tdm"})
    p = s.add_player("REAPER", team_id="blue", gun_id="GUN-A")
    if phase:
        s.set_phase(phase)
    tail = demo_armory()[0]["ble"]["tail"]
    net.simulate_hello("node0", f"GUN-A-{tail}")
    return s, net, p


def _pick(net, voice):
    before = len(net.pushes("apply", "node0"))
    body = {"node_id": "node0", "player_id": "x", "slot": "voice", "kind": "voice", "id": voice}
    net.simulate_node_message("node0", "loadout_request", body, T0_EPOCH_MS)
    return net.pushes("loadout_ack", "node0")[-1][2], net.pushes("apply", "node0")[before:]


def test_a_phone_pick_sets_the_voice_and_plays_a_line_at_head_volume():
    s, net, p = _mk()
    assigns = len(net.pushes("assign", "node0"))
    ack, applies = _pick(net, "medic")
    assert ack == {"slot": "voice", "ok": True, "id": "medic", "loadout": s.players[p["player_id"]]["loadout"]}
    assert s.players[p["player_id"]]["voice"] == "medic"
    assert len(net.pushes("assign", "node0")) > assigns          # the phone learns the new voice from `assign`
    assert net.pushes("assign", "node0")[-1][2]["player"]["voice"] == "medic"
    assert len(applies) == 1
    body = applies[0][2]
    vol = s.compiler.head_volume(s.config)
    assert body["preview"] is True and body["frames"][0] == f"$VOL,{vol},0,*" and vol >= 80   # never the 30 diagnostic
    assert body["frames"][1].startswith("$PLAY,")


def test_the_same_voice_again_plays_another_line_without_a_reassign():
    s, net, p = _mk()
    _pick(net, "medic")
    assigns = len(net.pushes("assign", "node0"))
    ack, applies = _pick(net, "medic")
    assert ack["ok"] and len(applies) == 1 and len(net.pushes("assign", "node0")) == assigns


def test_an_unknown_voice_is_refused_and_nothing_plays():
    s, net, p = _mk()
    ack, applies = _pick(net, "nobody")
    assert ack["ok"] is False and ack["reason"] == "Unknown voice" and not applies
    assert s.players[p["player_id"]]["voice"] != "nobody"


def test_a_pick_before_kit_is_refused():
    s, net, p = _mk(phase=None)
    ack, applies = _pick(net, "medic")
    assert ack["ok"] is False and ack["reason"] == "Mission Control is still setting up the game" and not applies
    assert s.players[p["player_id"]]["voice"] != "medic"


def test_a_pick_in_play_is_refused_and_nothing_plays():
    s, net, p = _mk()
    s.phase = "live"
    ack, applies = _pick(net, "medic")
    assert ack == {"slot": "voice", "ok": False, "reason": KIT_LOCKED, "id": "medic", "loadout": s.players[p["player_id"]]["loadout"]}
    assert not applies and s.players[p["player_id"]]["voice"] != "medic"


def test_a_later_console_edit_wins():
    s, net, p = _mk()
    _pick(net, "medic")
    s.patch_player(p["player_id"], voice="scout")
    assert s.players[p["player_id"]]["voice"] == "scout"
    assert net.pushes("assign", "node0")[-1][2]["player"]["voice"] == "scout"


def test_assign_carries_the_voice_list():
    s, net, p = _mk()
    voices = s._assign_body(s.players[p["player_id"]])["catalog"]["voices"]   # the welcome and every assign
    assert voices and all(set(v) == {"id", "name"} for v in voices)
    assert [v["id"] for v in voices] == [o["id"] for o in s.compiler.voice_options() if o["id"]]


def test_the_pick_preview_draws_from_spawn_and_kill_confirm_lines():
    c = Compiler()
    pool = set(V.role_ids("medic", "spawn") + V.role_ids("medic", "kill_confirm"))
    rng = random.Random(7)
    got = {c.voice_pick_preview("medic", None, rng) for _ in range(200)}
    assert got == {f"$PLAY,{i},4,6,,,,,*" for i in pool}     # interrupt: a new pick cuts the last line
    # the console's preview is unchanged: the intro line (S39)
    assert c.voice_preview("medic") == V.play_line_frame(V.role_id("medic", "intro"))


def test_mocknode_mirrors_the_phone_preview_gate():
    """A91: the stand-in node takes a preview with its `$VOL` before the match, and drops every preview once ARMED or LIVE."""
    from brx_mcp.mc.mock_node import MockNode
    node = MockNode("ws://127.0.0.1:1/ws")
    preview = {"kind": "apply", "body": {"preview": True, "frames": ["$VOL,90,0,*", "$PLAY,V3I,4,6,,,,,*"]}}
    for state, kept in (("kitted", 1), ("lobby", 1), ("armed", 0), ("live", 0)):
        node.applies.clear()
        node.arm_state = state
        node._handle(preview)
        assert len(node.applies) == kept, state
    node.arm_state = "kitted"
    node.applies.clear()
    node._handle({"kind": "apply", "body": {"preview": True, "frames": ["$VOL,90,0,*", "$CLEAR,*"]}})
    assert not node.applies


def test_the_ack_echoes_the_phone_request_counter():
    s, net, p = _mk()
    body = {"node_id": "node0", "player_id": "x", "slot": "voice", "kind": "voice", "id": "medic", "req": 7}
    net.simulate_node_message("node0", "loadout_request", body, T0_EPOCH_MS)
    assert net.pushes("loadout_ack", "node0")[-1][2]["req"] == 7


def test_a_phone_voice_change_drops_the_old_family_line_picks():
    """A `voice_slots` pick names a line of the OLD voice; kept, the new voice would still say the old spawn line."""
    s, net, p = _mk()
    s.players[p["player_id"]]["voice_slots"] = {"spawn": "VAI"}
    _pick(net, "medic")
    assert "voice_slots" not in s.players[p["player_id"]]
    s.players[p["player_id"]]["voice_slots"] = {"spawn": "V8I"}
    _pick(net, "medic")                                    # the same voice again changes nothing
    assert s.players[p["player_id"]]["voice_slots"] == {"spawn": "V8I"}


def test_a_console_voice_change_drops_line_picks_unless_it_sends_its_own():
    s, net, p = _mk()
    pid = p["player_id"]
    s.players[pid]["voice_slots"] = {"spawn": "VAI"}
    s.patch_player(pid, voice="scout")
    assert "voice_slots" not in s.players[pid]
    s.patch_player(pid, voice="medic", voice_slots={"spawn": "V8I"})
    assert s.players[pid]["voice_slots"] == {"spawn": "V8I"}
    s.patch_player(pid, display="REAPER2")                  # no voice change: the picks stay
    assert s.players[pid]["voice_slots"] == {"spawn": "V8I"}
