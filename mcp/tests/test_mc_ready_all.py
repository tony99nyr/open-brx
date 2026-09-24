"""MARK ALL READY (bench 2026-09-17): a config re-push from LOBBY (e.g. the inline GameEditPanel)
mints a fresh head and resets every player's READY to false — correct, since a re-ack is owed on the
new head, but a roster that had already tapped READY UP found itself back at 0/N with no faster fix
than tapping each player's own HOST OVERRIDE (`set_ready(..., host_override=True)`) by hand.

`ready_all()` is the roster-wide sibling of that same cure: every rostered, non-standby player at
once, LOBBY only, never touching `self.acks` or the config head.

Run: python3 run_tests.py mc_ready_all
"""
from contextlib import contextmanager

from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session

T0 = 5_000_000


@contextmanager
def raises(exc, match=None):
    """The system Python here has no pytest (run_tests.py): a small `pytest.raises` stand-in."""
    try:
        yield
    except exc as e:
        assert match is None or match in str(e), f"{e!r} does not mention {match!r}"
        return
    raise AssertionError(f"{exc.__name__} not raised")


def mk(n_players=2):
    clock = {"t": T0}
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    return s, net, clock, ps


def online(s, net, clock, p, i, synced=True):
    tail = demo_armory()[i]["ble"]["tail"]
    net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36,
                                     "alive": True, "shots": 0, "battery": 80, "fw": "v4.32",
                                     "arm_state": "kitted", "synced": synced,
                                     "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                   "screen_on": True, "foreground": True, "gun_linked": True}},
                        clock["t"])


def to_lobby(n_players=2):
    s, net, clock, ps = mk(n_players)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    assert s.phase == "lobby" and s.lobby_pushed
    return s, net, clock, ps


def _pushes(net, nid, kind):
    return [b for (n, k, b) in net.pushed if n == nid and k == kind]


def test_ready_all_marks_every_rostered_player_ready():
    s, net, clock, ps = to_lobby(3)
    assert all(not p["ready"] for p in s.players.values()), "control: a fresh push clears ready"
    out = s.ready_all()
    assert out["ok"] is True
    assert set(out["readied"]) == {p["player_id"] for p in ps}
    assert all(s.players[p["player_id"]]["ready"] for p in ps)


def test_ready_all_tells_the_phone_the_same_way_a_ready_edit_already_does():
    """The phone's own HUD needs to hear it too, not only the console's count -- the wire field
    `PATCH .../ready` already documents (API.md): an `assign` carrying the player's new `ready`."""
    s, net, clock, ps = to_lobby(2)
    pid0 = ps[0]["player_id"]
    before = len(_pushes(net, "node0", "assign"))
    s.ready_all()
    pushes = _pushes(net, "node0", "assign")
    assert len(pushes) > before, "a freshly-readied, bound player gets a new assign"
    assert pushes[-1]["player"]["ready"] is True
    assert pushes[-1]["player"]["player_id"] == pid0


def test_ready_all_keeps_standby_players_out():
    s, net, clock, ps = to_lobby(2)
    pid0, pid1 = ps[0]["player_id"], ps[1]["player_id"]
    s.stand_down(pid0)
    assert pid0 not in s.players and pid0 in s.standby
    out = s.ready_all()
    assert out["readied"] == [pid1], "the benched player is not on `self.players` and is never touched"
    assert s.players[pid1]["ready"] is True
    assert s.standby[pid0]["ready"] is False, "STANDBY stays not-ready — this control is not PLAY"


def test_ready_all_refused_outside_lobby():
    s, net, clock, ps = mk(2)
    assert s.phase != "lobby"
    with raises(ValueError, match="needs the lobby"):
        s.ready_all()
    assert all(not p["ready"] for p in s.players.values()), "a refused call changes nothing"


def test_ready_all_refused_once_armed():
    s, net, clock, ps = to_lobby(2)
    for p in ps:
        s.set_ready(p["player_id"], True, host_override=True)   # start() needs the roster ready first
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                   {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD,45,70,0,0,36,216,*"},
                                   clock["t"])
    s.start(runway_s=1)
    assert s.phase in ("armed", "live")
    with raises(ValueError, match="needs the lobby"):
        s.ready_all()


def test_ready_all_does_not_touch_acks():
    s, net, clock, ps = to_lobby(2)
    for i, p in enumerate(ps):
        net.simulate_node_message(f"node{i}", "ack_config",
                                   {"config_id": s.config["config_id"], "ok": True, "gun_echo": None},
                                   clock["t"])
    before_acks = {k: dict(v) for k, v in s.acks.items()}
    before_config_id = s.config["config_id"]
    s.ready_all()
    assert s.acks == before_acks, "ready_all must never touch an ack — it is not a config re-push"
    assert s.config["config_id"] == before_config_id, "and it must never mint a fresh head"
