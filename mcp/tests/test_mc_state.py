"""Session — player_num rules, readiness amber-vs-red (no deadlock), push gate, start/reschedule/abort,
timed-end mirror, hydrate by gun, hot-swap baseline, controls → KITTED."""
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.types import MAX_PLAYERS

T0 = 5_000_000


def mk(n_players=2):
    clock = {"t": T0}
    net = FakeNet()
    s = Session(FakeCompiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(n_players)]
    return s, net, clock, ps


def online(s, net, clock, p, i, synced=True):
    tail = demo_armory()[i]["ble"]["tail"]
    name = f"GUN-{chr(65 + i)}-{tail}"
    net.simulate_hello(f"node{i}", name)
    net.simulate_status(f"node{i}", {"player_id": p["player_id"], "hp": 45, "armor": 70, "ammo": 36, "alive": True, "shots": 0,
                                     "battery": 80, "fw": "v4.32", "arm_state": "kitted", "synced": synced,
                                     "preflight": {"ssid_ok": True, "mc_reachable": True, "phone_batt": 90, "screen_on": True,
                                                   "foreground": True, "gun_linked": True}}, clock["t"])


def test_player_num_assignment_unique_zero_reserved():
    s, net, clock, ps = mk(3)
    assert [p["player_num"] for p in ps] == [1, 2, 3]
    s.patch_player(ps[0]["player_id"], player_num=7)
    try:
        s.patch_player(ps[1]["player_id"], player_num=7); assert False
    except ValueError: pass
    for bad in (0, MAX_PLAYERS + 1):
        try:
            s.patch_player(ps[1]["player_id"], player_num=bad); assert False
        except ValueError: pass
    s.remove_player(ps[0]["player_id"])
    assert s.add_player("NEW")["player_num"] == 1     # lowest free slot reused


def test_readiness_no_node_is_waiting_and_headset_unknown_is_amber_pre_push():
    """A phone that has not connected yet BLOCKS the start but is not a FAULT.

    Field 2026-09-01, Tony looking at a board of disconnected guns: *"it makes it look like the guns
    are broken. They are simply disconnected. It shouldn't look like critical errors."* So the row
    gets its own status: it still gates `go`, but the UI paints it inactive rather than red.
    """
    s, net, clock, ps = mk(2)
    rd = s.readiness()
    assert all(r["status"] == "waiting" for r in rd["board"]), "no phone yet is not a fault"
    assert not rd["go"], "...but it still blocks the start"
    assert all("WAITING FOR THE PHONE" in r["blockers"][0] for r in rd["board"])
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    rd = s.readiness()
    assert all(r["status"] == "amber" for r in rd["board"]) and rd["go"]      # headset unproven ≠ red → no deadlock
    assert all(r["headset"] == "unknown" for r in rd["board"])


def test_a_real_fault_alongside_a_missing_phone_still_reads_red():
    """`waiting` is only for the case where the ABSENT PHONE is the sole complaint."""
    s, net, clock, ps = mk(2)
    s.patch_player(ps[0]["player_id"], gun_id="GUN-A")
    s.scan_rows = [{"gun_id": "GUN-A", "identity": "reverted", "basename": "gun-a", "tail": "AAAA", "rssi": -50, "t": 0}]
    row = next(r for r in s.readiness()["board"] if r["player_id"] == ps[0]["player_id"])
    assert row["status"] == "red", "a reverted identity is a fault even with no phone attached"


def test_unsynced_and_wrong_ssid_are_red():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0, synced=False); online(s, net, clock, ps[1], 1)
    net.simulate_status("node1", {"player_id": ps[1]["player_id"], "synced": True, "preflight": {"ssid_ok": False}}, clock["t"])
    st = {r["player_id"]: r for r in s.readiness()["board"]}
    assert st[ps[0]["player_id"]]["status"] == "red" and st[ps[1]["player_id"]]["status"] == "red"


def test_push_gate_and_empty_echo_red_and_start_rules():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    res = s.push_config()
    assert res["ok"] and s.phase == "lobby" and len(net.pushes("config")) == 2
    cfg = net.pushes("config")[0][2]
    assert cfg["frames"]["head"][4].startswith(f"$PSET,{ps[0]['player_num']},0,") and "$SPAWN,,*" not in cfg["frames"]["head"]
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD,0,0,0,0,0,0,*"}, clock["t"])
    net.simulate_node_message("node1", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": ""}, clock["t"])
    st = {r["player_id"]: r for r in s.readiness()["board"]}
    assert st[ps[1]["player_id"]]["status"] == "red" and st[ps[1]["player_id"]]["headset"] == "absent"
    try:
        s.start(); assert False
    except ValueError: pass
    net.simulate_node_message("node1", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD,0,0,0,0,0,0,*"}, clock["t"])
    st1 = s.start(runway_s=30)
    assert s.phase == "armed" and st1["seq"] == 1 and st1["go_live_t"] == T0 + 30_000
    assert net.pushes("start")[-1][2]["match_id"] == st1["match_id"]
    st2 = s.reschedule(60)
    assert st2["seq"] == 2 and st2["match_id"] != st1["match_id"]      # reschedule = new seq + new match_id
    ab = s.abort_start()
    assert s.phase == "lobby" and set(ab["reached"]) == {p["player_id"] for p in ps}
    assert net.pushes("control")[-1][2] == {"cmd": "abort_start", "seq": 2}


def test_timed_end_mirror_and_recap_kitted():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    info = s.start(runway_s=10)
    clock["t"] = info["go_live_t"] + 1
    s.tick(); assert s.phase == "live"
    mid = info["match_id"]
    net.simulate_event("node1", {"type": "death", "t": clock["t"], "match_id": mid, "player_id": ps[1]["player_id"], "shooter_num": ps[0]["player_num"], "shooter_team": 1}, clock["t"], seq=1)
    assert s.snapshot()["live"]["score"]["blue"] == 1
    clock["t"] = info["go_live_t"] + 60_000 + 6000
    s.tick(); assert s.phase == "recap" and s.recap()["winner"] == {"team_id": "blue"}
    # late flush after the end is recorded but not scored (A6.1)
    net.simulate_event("node0", {"type": "death", "t": info["go_live_t"] + 65_000, "match_id": mid, "player_id": ps[0]["player_id"], "shooter_num": ps[1]["player_num"], "shooter_team": 2}, clock["t"], seq=2)
    assert s.recap()["score"]["yellow"] == 0 and s.recap()["post_end"] == 1
    assert not s.lobby_pushed


def test_hydrate_by_gun_then_node_and_hot_swap_baseline():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    s.push_config()
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    s.start(runway_s=5)
    net.simulate_status("node0", {"player_id": ps[0]["player_id"], "shots": 12, "alive": True, "synced": True, "arm_state": "armed"}, clock["t"])
    tail = demo_armory()[0]["ble"]["tail"]
    node = net.simulate_hello("brand-new-phone", f"GUN-A-{tail}")   # hot-swap: unknown node_id, known gun
    assert node and node["player"]["player_id"] == ps[0]["player_id"] and "frames" in node and node["start"]["seq"] == 1
    assert node["score"]["shots_total"] == 12
    net.simulate_status("brand-new-phone", {"player_id": ps[0]["player_id"], "shots": 3, "alive": True, "synced": True}, clock["t"])
    assert s.scorer.shots_total(ps[0]["player_id"]) == 15
    assert s._hydrate({"node_id": "nobody", "gun": {"name": "Tactix2-FFFF", "tail": "FFFF"}}) is None


def test_controls_land_in_kitted_and_rematch_needs_push():
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    s.push_config()
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    s.start(runway_s=5)
    try:
        s.control("panic"); assert False
    except ValueError: pass
    s.control("recall")
    assert s.phase == "kit" and not s.lobby_pushed and net.pushes("control")[-1][2]["cmd"] == "recall"


def test_tryout_disabled_once_the_lobby_is_pushed():
    """A10 §4.4: the gate is the config PUSH, not 'any node reports LOBBY' — the old rule let the first
    player's ready kill every other player's try-out (brx-opus2 S1, 2026-08-27)."""
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.tryout(ps[0]["player_id"], "smg")
    assert any(f.startswith("$WEAP,0,<smg>") for f in net.pushes("tutorial")[-1][2]["frames"])
    net.simulate_status("node0", {"player_id": ps[0]["player_id"], "arm_state": "lobby", "synced": True}, clock["t"])
    s.tryout(ps[1]["player_id"], "shotgun")           # another node's state never blocks a try-out
    s.push_config()
    try:
        s.tryout(ps[0]["player_id"], "shotgun"); assert False
    except ValueError as e:
        assert "closed" in str(e)                     # human reason (loadout_ack.reason / MC toast)


def test_config_warnings_surface():
    s, net, clock, ps = mk(1)
    s.set_config({"scoring": {"frag_limit": 25}})
    assert any("frag_limit" in w for w in s.snapshot()["config_warnings"])


def test_a_powered_down_tagger_reads_offline_not_a_wall_of_faults():
    """Field 2026-09-02: after a session, both cards showed BLOCKED with up to six red bars —
    GUN LINK LOST, CLOCK NOT SYNCED, WRONG WI-FI, STALE LINK (65612s), PHONE BATTERY LOW,
    SCREEN OFF — for taggers that were simply switched off. Every one of those is a CONSEQUENCE of
    the node being gone. Say it once, and do not paint it as a fault.
    """
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    assert all(r["status"] in ("green", "amber") for r in s.readiness()["board"])

    clock["t"] += 30 * 60 * 1000                     # everyone packs up and goes home
    board = s.readiness()["board"]
    for r in board:
        assert r["status"] == "waiting", "a gone node blocks the start but is not a fault"
        assert len(r["blockers"]) == 1, f"one statement, not a symptom list: {r['blockers']}"
        assert r["blockers"][0].startswith("OFFLINE — LAST SEEN"), r["blockers"][0]
        assert "30m" in r["blockers"][0], f"a readable duration, not raw seconds: {r['blockers'][0]}"
    assert not s.readiness()["go"], "...and it still gates the start"


def test_durations_are_readable_at_every_scale():
    """`1093m32s` is not something an operator can read as 18 hours."""
    from brx_mcp.mc.state import Session
    assert Session._human_age(5_000) == "5s"
    assert Session._human_age(65_000) == "1m"
    assert Session._human_age(65_612_000) == "18h13m"
    assert Session._human_age(94_000_000) == "1d02h"


# ---- A11.5: MC confidence gates the MC-driven global-state events ---------------------------------
def test_mc_confidence_needs_every_hud_live_fresh_and_flushed():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0)
    assert s.mc_confidence()["confident"] is False            # OP1 has no node yet
    online(s, net, clock, ps[1], 1)
    c = s.mc_confidence()
    assert c["confident"] is True, c
    clock["t"] += 7_000                                       # nobody heard from for 7 s -> stale
    c = s.mc_confidence()
    assert c["confident"] is False and len(c["stale"]) == 2
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.nodes["node1"]["pending"] = 3                           # a queue still draining
    c = s.mc_confidence()
    assert c["confident"] is False and c["unflushed"] == [ps[1]["player_id"]]


def test_global_state_alerts_are_withheld_when_not_confident_and_sent_when_confident():
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    assert s.mc_confidence()["confident"]
    n = s._alert("lead_taken", "blue")
    assert n >= 1 and any(k == "alert" and b["kind"] == "lead_taken" for _, k, b in net.pushed)
    net.pushed.clear()
    clock["t"] += 7_000                                       # HUDs go quiet
    assert s._alert("next_kill_wins", "all") == 0
    assert not any(k == "alert" for _, k, b in net.pushed)
    assert any(e.get("tag") == "WITHHELD" for e in s.feed)
    # a non-global event (someone else turned) is not gated by confidence, only by the class switch
    assert s._alert("infected", "all", {"player_id": ps[0]["player_id"]}) >= 1
    s.set_config({"mode": "tdm", "time_limit_s": 60, "presentation": {"mc_events": False}})
    net.pushed.clear()
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    assert s._alert("lead_taken", "blue") == 0 and not net.pushed
