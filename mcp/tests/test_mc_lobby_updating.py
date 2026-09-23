"""F178 (Tony, 2026-09-23): READY stays the player's intent, and `lobby.updating` names the READY
players whose gun has not answered the pushed head yet, so the host sees why START refuses.

Run: python3 run_tests.py mc_lobby_updating
"""
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session

T0 = 5_000_000
ECHO = "$ALCD,32,100,0,192,0,*"


def to_lobby(n=3):
    clock = {"t": T0}
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n)]
    for i, p in enumerate(ps):
        tail = demo_armory()[i]["ble"]["tail"]
        net.simulate_hello(f"node{i}", f"GUN-{chr(65 + i)}-{tail}")
        net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36,
                                         "alive": True, "shots": 0, "battery": 80, "fw": "v4.32",
                                         "arm_state": "kitted", "synced": True,
                                         "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90,
                                                       "screen_on": True, "foreground": True, "gun_linked": True}},
                            clock["t"])
    return s, net, clock, ps


def ack(s, net, clock, i, config_id=None, ok=True):
    body = {"config_id": config_id or s.config["config_id"], "ok": ok}
    body.update({"gun_echo": ECHO} if ok else {"err": "no_echo"})
    net.simulate_node_message(f"node{i}", "ack_config", body, clock["t"])


def lobby(s):
    return s.snapshot()["lobby"]


def test_nothing_is_updating_before_the_push():
    s, net, clock, ps = to_lobby()
    s.set_ready(ps[0]["player_id"], True, host_override=True)
    assert lobby(s)["updating"] == 0, "no head was pushed, so no phone owes an answer"


def test_a_ready_player_with_no_ack_is_updating_and_leaves_the_count_when_it_acks():
    s, net, clock, ps = to_lobby()
    s.push_config()
    s.ready_all()
    assert lobby(s)["ready"] == 3 and lobby(s)["updating"] == 3, lobby(s)
    ack(s, net, clock, 0)
    ack(s, net, clock, 1)
    assert lobby(s)["ready"] == 3 and lobby(s)["updating"] == 1, "READY is intent: it never drops"
    ack(s, net, clock, 2)
    assert lobby(s)["updating"] == 0 and lobby(s)["all_acked"] is True


def test_an_ack_for_an_older_head_is_updating_and_start_still_refuses():
    s, net, clock, ps = to_lobby(2)
    s.push_config()
    old = s.config["config_id"]
    ack(s, net, clock, 0)
    ack(s, net, clock, 1)
    s.push_config()                                   # the re-push mints a fresh head (F6)
    assert s.config["config_id"] != old
    s.ready_all()
    ack(s, net, clock, 0)
    ack(s, net, clock, 1, config_id=old)              # an answer for the previous head lands late
    assert lobby(s)["updating"] == 1, lobby(s)
    try:
        s.start(10)
        raise AssertionError("START accepted a gun holding an older head")
    except ValueError as e:
        assert "OLDER" in str(e)


def test_a_refused_ack_is_a_red_not_an_update():
    s, net, clock, ps = to_lobby(2)
    s.push_config()
    s.ready_all()
    ack(s, net, clock, 0)
    ack(s, net, clock, 1, ok=False)
    assert lobby(s)["updating"] == 0, "GUN DID NOT ANSWER CONFIG is the board's red, not an update in flight"


def test_a_player_who_is_not_ready_is_never_counted():
    s, net, clock, ps = to_lobby(2)
    s.push_config()
    s.set_ready(ps[0]["player_id"], True, host_override=True)
    assert lobby(s)["updating"] == 1, "only the READY player with no ack; the other is simply not ready"
