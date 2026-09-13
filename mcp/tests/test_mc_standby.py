"""STANDBY (2026-09-12): pull a player out of the lobby without forgetting them, and put them back.

Field ask (Tony, first four-phone session): "i had a player walk away. i dont have a way to do that in
MC ... pull them out into standby ... in the future i want to be able to select who is going to
participate in the lobby". DELETE existed on the API and nothing in the console used it; and DELETE
forgets the callsign, team, gun and loadout the operator just typed.

The design keeps a parked player OUTSIDE `players` so every roster loop (readiness, kit/lobby counts,
compile, push, scoring) ignores them with no filter of its own. These tests pin what STAND DOWN takes
away, what PLAY brings back, and what each refuses.
"""
import json, pathlib, tempfile
from contextlib import contextmanager

from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session

T0 = 1_700_000_000_000


@contextmanager
def raises(exc, match=None):
    """The system Python here has no pytest (run_tests.py): a small `pytest.raises` stand-in."""
    try:
        yield
    except exc as e:
        assert match is None or match in str(e), f"{e!r} does not mention {match!r}"
        return
    raise AssertionError(f"{exc.__name__} not raised")


def _status(node, pid):
    return {"player_id": pid, "hp": 45, "armor": 70, "ammo": 36, "alive": True, "shots": 0, "battery": 80,
            "fw": "v4.32", "arm_state": "kitted", "synced": True,
            "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90, "screen_on": True,
                          "foreground": True, "gun_linked": True}}


def _session(n=3, mode="tdm"):
    """`n` players on GUN-A.., each with a phone that said hello and reported KITTED."""
    clock = {"t": T0}
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": mode, "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n)]
    for i, p in enumerate(ps):
        tail = demo_armory()[i]["ble"]["tail"]
        net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
        net.simulate_status(f"node{i}", _status(f"node{i}", p["player_id"]), clock["t"])
    return s, net, clock, ps


def _pushes(net, nid, kind):
    return [b for (n, k, b) in net.pushed if n == nid and k == kind]


# ---------------------------------------------------------------- stand down

def test_stand_down_leaves_the_roster_and_unbinds_the_phone():
    s, net, clock, ps = _session()
    pid = ps[1]["player_id"]
    assert s.node_player.get("node1") == pid
    parked = s.stand_down(pid)
    assert pid not in s.players and s.standby[pid] is parked
    assert parked["node_id"] is None and parked["ready"] is False
    assert parked["gun_id"] == "GUN-B" and parked["display"] == "OP1"       # nothing typed is lost
    assert "node1" not in s.node_player
    assert s.nodes["node1"].get("player_id") is None, "the node view no longer names them"
    snap = s.snapshot()
    assert [p["player_id"] for p in snap["standby"]] == [pid]
    assert pid not in {p["player_id"] for p in snap["players"]}
    assert snap["kit"]["total"] == 2 and snap["lobby"]["total"] == 2, "counts no longer wait on them"
    assert pid not in {b["player_id"] for b in snap["readiness"]["board"]}
    assert snap["readiness"]["roster_size"] == 2


def test_stand_down_forgets_their_ready_ack_tryout_and_browse():
    s, net, clock, ps = _session()
    pid = ps[0]["player_id"]
    s.set_ready(pid, True, host_override=True)
    s.browsing[pid] = clock["t"]
    s.stand_down(pid)
    assert pid not in s.browsing and pid not in s.acks and pid not in s.trying and pid not in s.bundles
    assert s.standby[pid]["ready"] is False


def test_stand_down_pushes_nothing_to_the_phone():
    """v1 (API.md): an unbound node receives no frames — the HUD keeps its last assign until PLAY."""
    s, net, clock, ps = _session()
    before = len(net.pushed)
    s.stand_down(ps[0]["player_id"])
    assert len(net.pushed) == before


def test_stand_down_unknown_id_is_a_key_error():
    s, *_ = _session()
    with raises(KeyError):
        s.stand_down("nobody")


# ---------------------------------------------------------------- reinstate

def test_reinstate_rebinds_the_connected_phone_and_keeps_the_number():
    s, net, clock, ps = _session()
    pid, num = ps[1]["player_id"], ps[1]["player_num"]
    s.stand_down(pid)
    n_assign = len(_pushes(net, "node1", "assign"))
    p = s.reinstate(pid)
    assert pid in s.players and pid not in s.standby
    assert p["player_num"] == num, "the wire id they were briefed with survives"
    assert p["node_id"] == "node1" and s.node_player["node1"] == pid, "the phone still holding GUN-B is re-bound"
    assert p["ready"] is False and p["gun_id"] == "GUN-B" and p["display"] == "OP1"
    assert len(_pushes(net, "node1", "assign")) == n_assign + 1, "a fresh assign goes to the phone"
    assert s.snapshot()["lobby"]["total"] == 3


def test_reinstate_after_the_lobby_push_sends_config_too():
    s, net, clock, ps = _session()
    pid = ps[2]["player_id"]
    s.stand_down(pid)
    s.push_config(force=True)
    n_cfg = len(_pushes(net, "node2", "config"))
    s.reinstate(pid)
    # (>= not ==: the re-bind and `_after_player_change` each push a config, exactly as `add_player` with a
    # gun does after a push. Same head twice, harmless; not this feature's to change.)
    assert len(_pushes(net, "node2", "config")) >= n_cfg + 1


def test_reinstate_takes_the_next_free_number_when_theirs_is_gone():
    s, net, clock, ps = _session()
    pid, num = ps[0]["player_id"], ps[0]["player_num"]
    s.stand_down(pid)
    q = s.add_player("NEWBIE")
    s.patch_player(q["player_id"], player_num=num)          # somebody took #1 while they sat out
    p = s.reinstate(pid)
    used = [x["player_num"] for x in s.players.values()]
    assert len(used) == len(set(used)) and p["player_num"] != num


def test_a_parked_players_gun_cannot_be_handed_to_anyone_else():
    """Review 2026-09-12: the ARMORY claim form (POST /api/players) and PATCH gun_id could hand a benched
    player's gun to a new callsign, and PLAY then refused with the collision it had just allowed."""
    s, net, clock, ps = _session()
    pid = ps[0]["player_id"]
    s.stand_down(pid)
    with raises(ValueError, match="gun GUN-A is on standby with OP0 - PLAY puts them back"):
        s.add_player("ROCCO", gun_id="GUN-A")
    with raises(ValueError, match="on standby with OP0"):
        s.patch_player(ps[1]["player_id"], gun_id="gun-a")          # case-insensitive, like the rostered check
    assert len(s.players) == 2 and s.players[ps[1]["player_id"]]["gun_id"] == "GUN-B"
    s.reinstate(pid)                                                # and the way back still works
    assert s.players[pid]["gun_id"] == "GUN-A"


def test_reinstate_backstop_refuses_a_collision_that_got_in_anyway():
    """The rule above makes this unreachable through the API; a hand-edited session.json still can."""
    s, net, clock, ps = _session()
    pid = ps[0]["player_id"]
    s.stand_down(pid)
    s.players[ps[1]["player_id"]]["gun_id"] = "GUN-A"
    with raises(ValueError, match="OP1"):
        s.reinstate(pid)
    assert pid in s.standby, "still parked, nothing half-applied"


def test_reinstate_rebalances_when_their_team_is_gone():
    s, net, clock, ps = _session()
    pid = ps[0]["player_id"]
    s.patch_player(pid, team_id="yellow")
    s.stand_down(pid)
    # the game is re-teamed while they sit out: red replaces yellow
    s.set_config({"teams": [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
                            {"team_id": "red", "name": "Red", "color": "red", "tid": 3}]})
    for q in s.players.values():
        s.patch_player(q["player_id"], team_id="blue")
    p = s.reinstate(pid)
    assert p["team_id"] == "red", "auto-balanced onto the emptier team, never parked on a team that no longer exists"


def test_reinstate_refits_the_loadout_to_the_current_policy():
    s, net, clock, ps = _session()
    pid = ps[0]["player_id"]
    s.stand_down(pid)
    s.standby[pid]["loadout"] = {"weapons": [{"weapon_id": "not-a-weapon"}]}   # a pick the policy cannot honour
    p = s.reinstate(pid)
    assert p["loadout"]["weapons"] and p["loadout"]["weapons"][0]["weapon_id"] != "not-a-weapon"


def test_reinstate_refuses_a_full_roster():
    import brx_mcp.mc.state as st
    s, net, clock, ps = _session()
    pid = ps[0]["player_id"]
    s.stand_down(pid)
    keep = st.MAX_PLAYERS
    st.MAX_PLAYERS = 2
    try:
        with raises(ValueError, match="roster full"):
            s.reinstate(pid)
    finally:
        st.MAX_PLAYERS = keep


def test_reinstate_unknown_id_is_a_key_error():
    s, *_ = _session()
    with raises(KeyError):
        s.reinstate("nobody")


# ---------------------------------------------------------------- phase gate

def _armed(s, net, clock, ps):
    s.push_config(force=True)
    for i, p in enumerate(ps):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "x"}, clock["t"])
    s.start(force=True)
    assert s.phase == "armed"


def test_stand_down_and_reinstate_are_refused_once_the_match_started():
    s, net, clock, ps = _session()
    parked = ps[2]["player_id"]
    s.stand_down(parked)
    _armed(s, net, clock, ps[:2])
    with raises(ValueError, match="after the match has started"):
        s.stand_down(ps[0]["player_id"])
    with raises(ValueError, match="after the match has started"):
        s.reinstate(parked)
    assert parked in s.standby and ps[0]["player_id"] in s.players


# ---------------------------------------------------------------- remove / session / persistence

def test_delete_drops_a_parked_record():
    s, net, clock, ps = _session()
    pid = ps[0]["player_id"]
    s.stand_down(pid)
    s.remove_player(pid)
    assert pid not in s.standby and pid not in s.players


def test_fresh_session_clears_standby_and_a_kept_roster_keeps_it():
    s, net, clock, ps = _session()
    pid = ps[0]["player_id"]
    s.stand_down(pid)
    s.new_session(keep_roster=True)
    assert pid in s.standby
    s.new_session(keep_roster=False)
    assert s.standby == {} and s.players == {}


def test_session_json_round_trips_standby():
    s, net, clock, ps = _session()
    pid = ps[1]["player_id"]
    s.stand_down(pid)
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = tmp
    s._persist_last = 0.0
    s._persist()
    on_disk = json.loads(tmp.read_text())
    assert [p["player_id"] for p in on_disk["standby"]] == [pid]
    s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=lambda: T0)
    s2._persist_path = tmp
    assert s2.restore_snapshot() == 2
    assert pid in s2.standby and s2.standby[pid]["display"] == "OP1" and s2.standby[pid]["node_id"] is None
    assert pid not in s2.players


def test_snapshot_before_standby_existed_restores_with_none():
    tmp = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    tmp.write_text(json.dumps({"v": 1, "players": [{"player_id": "abc", "player_num": 1, "display": "OLD", "team_id": None,
                                                     "node_id": None, "gun_id": None, "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]},
                                                     "voice": "male", "ready": False}]}))
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=lambda: T0)
    s._persist_path = tmp
    assert s.restore_snapshot() == 1
    assert s.standby == {}
