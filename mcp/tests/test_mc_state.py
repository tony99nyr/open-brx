"""Session — player_num rules, readiness amber-vs-red (no deadlock), push gate, start/reschedule/abort,
timed-end mirror, hydrate by gun, hot-swap baseline, controls → KITTED."""
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import TEAM_DEFS, Session
from brx_mcp.mc.scoring import Scorer
from brx_mcp.mc.types import DEFAULT_RUNWAY_S, MAX_PLAYERS

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


def test_recap_reports_played_seconds_from_go_live_to_end():
    s, net, clock, ps = mk()
    sc = Scorer("m1", T0, None, "tdm", s.players, s.teams, {}, {}, now_ms=lambda: clock["t"])
    sc.set_end(T0 + 754_000)
    s.scorer = sc
    assert "played_s" not in s.recap()
    s.phase = "recap"
    assert s.recap()["played_s"] == 754
    sc.end_t = T0 + 754_600
    assert s.recap()["played_s"] == 755, "rounded to the nearest second, as the console shows it"
    # polish 2026-09-25: a scorer with no whistle time reports no length, never one that keeps growing
    s.scorer = Scorer("m2", T0, None, "tdm", s.players, s.teams, {}, {}, now_ms=lambda: clock["t"])
    assert "played_s" not in s.recap()


def test_team_alert_uses_the_scorers_current_team_after_infection():
    s, net, clock, ps = mk(4)
    for i, p in enumerate(ps):
        p["node_id"] = f"node{i}"
        p["team_id"] = "blue"
    sc = Scorer("m1", T0, 60, "infection", s.players, s.teams, {}, {}, now_ms=lambda: clock["t"])
    s.scorer = sc
    turned_id = ps[2]["player_id"]
    sc.stats[turned_id].team_id = "yellow"
    s._alert("infected", "blue", {"player_id": turned_id})
    alerted_nodes = {row[0] for row in net.pushes("alert")}
    assert alerted_nodes == {"node0", "node1", "node3"}


def test_claiming_a_gun_on_armory_never_moves_the_phase():
    """Bench 2026-09-17: Tony set the first gamertag on ARMORY and the console jumped to KIT; the
    second gamertag, set from KIT, correctly stayed put. Adding a player must never move the phase:
    the operator presses CONTINUE TO KIT (`POST /api/phase`) when they are ready."""
    s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    assert s2.phase == "muster"
    s2.add_player("OP0")
    assert s2.phase == "muster", "claiming a gun before any config must not advance the phase"
    s, net, clock, ps = mk(0)
    assert s.phase == "build"
    s.add_player("OP0", gun_id="GUN-A")
    assert s.phase == "build", "the FIRST claim on ARMORY must not advance the phase"
    s.add_player("OP1", gun_id="GUN-B")
    assert s.phase == "build", "a SECOND claim must not advance the phase either"


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


def test_unrostered_phone_count_excludes_claimed_and_standby_but_counts_a_stray():
    # F-3 (2026-09-13, field 2026-09-12: "4 guns connected, only 2 in lobby"). A connected phone with a
    # gun nobody has claimed is a STRAY; the ARMORY claim card already renders one, this just counts
    # them for the KIT/LOBBY banner.
    s, net, clock, ps = mk(2)   # rosters GUN-A, GUN-B
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    assert s.readiness()["unrostered_phones"] == 0, "control: both connected phones are rostered"
    # a third phone connects wearing GUN-C — nobody has claimed it
    tail_c = demo_armory()[2]["ble"]["tail"]
    net.simulate_hello("node2", f"GUN-C-{tail_c}")
    assert s.readiness()["unrostered_phones"] == 1, "a connected, unclaimed gun is a stray"
    # claiming it drops the count back to 0
    s.add_player("NEWGUY", gun_id="GUN-C")
    assert s.readiness()["unrostered_phones"] == 0, "claimed — no longer a stray"
    # a fourth phone connects wearing GUN-A, whose player is now on STANDBY — not a stray, a stand-down
    s.stand_down(ps[0]["player_id"])
    tail_a = demo_armory()[0]["ble"]["tail"]
    net.simulate_hello("node3", f"GUN-A-{tail_a}")
    assert s.readiness()["unrostered_phones"] == 0, "the gun's holder is parked on standby, not a stray"
    # a phone with no gun set at all ("WAITING FOR ITS GUN") is a different situation, not a stray either
    net.simulate_hello("node4", "")
    assert s.readiness()["unrostered_phones"] == 0, "no gun set yet is not a roster mismatch"


def test_unrostered_phone_count_ignores_a_phone_that_has_gone_silent():
    """T2 review S5. The count walked every node with NO freshness test at all, and `_on_disconnect`
    only nulls `reach` -- so a phone that said hello wearing a gun and then LEFT kept "1 CONNECTED PHONE
    NOT IN THE ROSTER" up on KIT and LOBBY for the ten minutes until `_prune_unbound_nodes` dropped the
    record, with nothing claimable on ARMORY behind it.

    The gate is the `stale` flag the net layer already raises (`_attach_net`'s `on_stale`,
    STALE_AFTER_MS = 8 s) and `_on_status` clears on the next heartbeat. Deliberately NOT a
    `last_seen_ms` vs `OFFLINE_AFTER_MS` comparison: that constant is 600_000 ms, exactly the window
    `_prune_unbound_nodes` already drops these records at, so gating on it would have changed nothing
    an operator could ever see."""
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    tail_c = demo_armory()[2]["ble"]["tail"]
    net.simulate_hello("node2", f"GUN-C-{tail_c}")
    assert s.readiness()["unrostered_phones"] == 1, "control: a connected, unclaimed gun is a stray"
    s._touch("node2", stale=True)      # the net layer heard nothing for STALE_AFTER_MS
    assert s.readiness()["unrostered_phones"] == 0, "a phone that left is not a stray to go and claim"
    s._touch("node2", stale=False)     # ...and it came back
    assert s.readiness()["unrostered_phones"] == 1, "heard again: countable again"


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
    start_view = s.snapshot()["start"]
    assert start_view["config_id"] == s.config["config_id"]
    assert start_view["per_node"][ps[0]["player_id"]]["t_minus_ms"] is None
    st2 = s.reschedule(60)
    assert st2["seq"] == 2 and st2["match_id"] != st1["match_id"]      # reschedule = new seq + new match_id
    ab = s.abort_start()
    assert s.phase == "lobby" and set(ab["reached"]) == {p["player_id"] for p in ps}
    assert net.pushes("control")[-1][2] == {"cmd": "abort_start", "seq": 2}


def test_start_with_no_runway_defaults_to_default_runway_s():
    """Tony 2026-09-25: "default countdown 30s. 120s is generally too long." A START with no
    runway_s must use the ONE `DEFAULT_RUNWAY_S` constant, not a stale literal re-typed at the call site."""
    assert DEFAULT_RUNWAY_S == 30, "the default itself moved; update this test's expectation, not the constant"
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    st = s.start()   # no runway_s passed at all
    assert st["go_live_t"] == T0 + DEFAULT_RUNWAY_S * 1000
    assert s.snapshot()["start"]["countdown_s"] == DEFAULT_RUNWAY_S


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
    live_view = s.snapshot()["live"]
    assert live_view["score"]["blue"] == 1
    assert live_view["ends_t"] == info["go_live_t"] + live_view["time_limit_s"] * 1000
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


def test_hot_swap_onto_an_incompatible_app_withholds_frames_and_start():
    """F121 polish review #2 (2026-09-18): the hot-swap of the test above, but the new phone is on a
    build `compatible()` refuses. Before this fix the welcome (`_hydrate`) and the hot-join push inside
    `_bind` both sent `frames` + `start` with no version check, so a player behind that phone would run
    the whole match with F121's `$TMP` off frame never written -- invulnerable, invisibly. Now both are
    withheld and the operator feed says why."""
    s, net, clock, ps = mk(1)
    online(s, net, clock, ps[0], 0)
    s.push_config()
    net.simulate_node_message("node0", "ack_config", {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    s.start(runway_s=5)
    tail = demo_armory()[0]["ble"]["tail"]
    node = net.simulate_hello("brand-new-phone", f"GUN-A-{tail}", app_ver="0.3.0")   # wrong minor
    assert node and node["player"]["player_id"] == ps[0]["player_id"]
    assert "frames" not in node and "start" not in node and "config" not in node
    assert not net.pushes("config", node_id="brand-new-phone")
    assert not net.pushes("start", node_id="brand-new-phone")
    withheld = [e for e in s.feed if e.get("tag") == "WITHHELD"]
    # exactly one line, though the same hello reaches `_bind` twice (`_hydrate`'s own call, then `_on_node`'s)
    assert len(withheld) == 1, withheld
    assert "0.3.0" in withheld[0]["text"] and ps[0]["display"].upper() in withheld[0]["text"]


def test_late_join_and_patch_mid_match_on_an_incompatible_app_withhold_config_and_start():
    """Item 1, polish review #2 round 2: `_resend` (reached from `add_player`/`patch_player` via
    `_after_player_change`) had no version check at all -- unlike `_bind`'s own hot join and
    `_hydrate`'s welcome (both fixed above), a late player added or patched mid-match on an
    incompatible gun still got `config`/`frames` and `start`, arming it with spawn protection never
    turned off. Both the add and a later patch now withhold both, with one WITHHELD feed line."""
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    s.start(runway_s=5)
    net.pushed.clear()
    tail = demo_armory()[2]["ble"]["tail"]
    net.simulate_hello("node2", f"GUN-C-{tail}", app_ver="0.3.0")   # a third gun, already on the LAN, wrong minor
    late = s.add_player("LATE", gun_id="GUN-C")
    assert late["node_id"] == "node2"                          # `_adopt_node_for_gun` bound it on the spot
    assert not net.pushes("config", node_id="node2")
    assert not net.pushes("start", node_id="node2")
    withheld = [e for e in s.feed if e.get("tag") == "WITHHELD"]
    assert len(withheld) == 1 and "0.3.0" in withheld[0]["text"], withheld
    net.pushed.clear()
    s.patch_player(late["player_id"], display="STILL LATE")
    assert not net.pushes("config", node_id="node2")
    assert not net.pushes("start", node_id="node2")


def test_start_broadcast_skips_an_unbound_node_on_an_incompatible_app():
    """Item 2, polish review #2 round 2: `start()`'s own `start` broadcast walks every non-utility,
    non-parked node, bound or not -- so a phone that had said hello on a bad build but never claimed a
    gun still got `start` at the whistle. `_refuse_incompatible_app` only checks BOUND nodes, so this
    was reachable even though the match itself starts clean."""
    s, net, clock, ps = mk(2)
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    tail = demo_armory()[2]["ble"]["tail"]
    net.simulate_hello("node2", f"GUN-C-{tail}", app_ver="0.3.0")   # unbound: GUN-C has no player
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    net.pushed.clear()
    s.start(runway_s=5)
    assert net.pushes("start", node_id="node0") and net.pushes("start", node_id="node1")
    assert not net.pushes("start", node_id="node2")


def test_start_refuses_bound_node_on_incompatible_or_unparsable_app():
    """Item 2, polish review #2: `start()`'s gate used to block only `compatible() is False`. An
    UNPARSABLE version reads amber on the readiness board by design (A1: amber never blocks a push),
    but that is a push-time judgement, not a licence to run a match with a node MC cannot vouch for --
    so the START GATE now blocks both, while the board keeps its amber wording for the unparsable case
    (pinned below)."""
    for bad_ver, board_red in (("0.3.0", True), ("hud-0.2", False)):
        s, net, clock, ps = mk(2)
        online(s, net, clock, ps[0], 0)
        online(s, net, clock, ps[1], 1)
        tail = demo_armory()[1]["ble"]["tail"]
        net.simulate_hello("node1", f"GUN-B-{tail}", app_ver=bad_ver)   # same node, now on a bad build
        assert s.push_config(force=True)["ok"]   # an incompatible minor reds the board; force past it to reach start
        for i in range(2):
            net.simulate_node_message(f"node{i}", "ack_config",
                                      {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
        row = {r["player_id"]: r for r in s.readiness()["board"]}[ps[1]["player_id"]]
        assert (row["status"] == "red") == board_red, (bad_ver, row)
        try:
            s.start()
            raise AssertionError(f"expected start() to refuse a bound node on app {bad_ver}")
        except ValueError as e:
            assert "not on" in str(e) and bad_ver in str(e), e


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
        assert r["blockers"][0].startswith("OFFLINE (LAST SEEN "), r["blockers"][0]
        assert "30M" in r["blockers"][0], f"a readable duration, not raw seconds: {r['blockers'][0]}"
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
    net.pushed.clear()
    assert s._alert("infected", "all", {"player_id": ps[0]["player_id"]}) >= 1
    # the SUBJECT (who turned) rides as player_id_subject; player_id stays the recipient (polish 2026-09-04)
    bodies = [b for _, k, b in net.pushed if k == "alert"]
    assert {b["player_id"] for b in bodies} == {ps[0]["player_id"], ps[1]["player_id"]}
    assert all(b["player_id_subject"] == ps[0]["player_id"] for b in bodies)
    s.set_config({"mode": "tdm", "time_limit_s": 60, "presentation": {"mc_events": False}})
    net.pushed.clear()
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    assert s._alert("lead_taken", "blue") == 0 and not net.pushed


def test_every_push_rolls_the_unpicked_voice_fields_and_so_does_a_late_joiner():
    """A15.1: MC rolls the death scream per push from the character's pool, so two pushes (or two players on
    the same character) do not have to share a scream; a late joiner hydrated at hello rolls too; an explicit
    `voice_slots` pick is never rolled over. A15.3 narrowed the roll to death_scream alone -- the cry and the
    three pain fields ship empty and are never rolled (the node plays them itself)."""
    import random
    from brx_mcp.mc.compile import Compiler
    net = FakeNet()
    s = Session(Compiler(), net, FakeArmory(demo_armory()), voice_rng=random.Random(7))
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    a = s.add_player("A", gun_id="GUN-A", voice="male")
    b = s.add_player("B", gun_id="GUN-B", voice="male", voice_slots={"death_scream": "VA5"})
    draws = set()
    for _ in range(8):
        s.push_config(force=True)
        ra, rb = s.bundles[a["player_id"]]["voice"]["rolled"], s.bundles[b["player_id"]]["voice"]["rolled"]
        assert set(ra) == {"death_scream"}                       # A15.3: the only field left to roll
        assert "death_scream" not in rb and s.bundles[b["player_id"]]["voice"]["pset"]["death_scream"] == "VA5"
        pset = next(f for f in s.bundles[a["player_id"]]["head"] if f.startswith("$PSET,")).split(",")
        assert pset[10] == ra["death_scream"] and pset[11] == pset[12] == pset[13] == pset[14] == ""
        draws.add(tuple(sorted(ra.items())))
    assert len(draws) > 1, "eight pushes with the same draw: the session is not rolling"
    del s.bundles[a["player_id"]]                          # a node that says hello after the push is hydrated from a fresh roll
    tail = demo_armory()[0]["ble"]["tail"]
    net.simulate_hello("late-node", f"GUN-A-{tail}")
    assert s.bundles[a["player_id"]]["voice"]["rolled"]["death_scream"] in ("VA3", "VA4", "VA5")


def test_f35_team_tid_must_be_0_to_3():
    """F35 (bench 2026-09-07): the IR word's team field is only 2 bits, so a gun armed on $TID 4-7
    transmits tid&3 on the wire while the victim compares its own FULL tid -- teammates on either side
    of that split damage each other, and a tid>=4 player's own shots can read as a lower, friendly team
    to everyone else. Only 0-3 are valid team ids; the colour painted for a team (0-7) is unaffected."""
    s = Session.__new__(Session)
    ok = s.sanitize_config({"mode": "tdm", "teams": [
        {"team_id": "a", "tid": 0}, {"team_id": "b", "tid": 3}]})
    assert [t["tid"] for t in ok["teams"]] == [0, 3]
    for bad_tid in (4, 5, 7, 8, -1):
        try:
            s.sanitize_config({"mode": "tdm", "teams": [{"team_id": "a", "tid": bad_tid}]})
            raise AssertionError(f"tid {bad_tid} was accepted")
        except ValueError as e:
            assert "F35" in str(e)


# ---------------------------------------------------------------------------------------------
# Round-2 fix pass B (2026-09-12) - the one-team gate
# ---------------------------------------------------------------------------------------------
def test_round2_b_a_one_team_roster_is_refused_by_push_and_start_and_force_does_not_open_it():
    """The safety half of the field's mode-switch bug.

    A match fought on one side cannot register a hit -- the gun refuses friendly damage -- so the
    whole session plays out with nothing scoring and no error anywhere. This is a statement about what
    the field CAN do, not a readiness judgement, so `force` does not open it (the same line
    `_refuse_push_in_play` draws).

    The mode switch that used to CREATE this roster (FFA -> TDM landing all four on BLUE) is re-teamed
    by index and rebalanced since round-3 FIELD-1, so the roster is built here the way an operator can
    still build it: by dragging everyone onto one side. The gate is the backstop, and it must hold.

    Full auto-balance is a later tier; 1-v-3 is merely UNEVEN and must still be allowed to play.
    """
    s, net, clock, ps = mk(4)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    for p in ps:
        s.patch_player(p["player_id"], team_id="blue")
    assert len({p["team_id"] for p in s.players.values()}) == 1, "control: everyone really is on one side"

    rd = s.readiness()
    assert not rd["go"], "a one-side roster cannot be a GO"
    assert any("ONE SIDE" in f for f in rd["roster_faults"]), rd["roster_faults"]

    for force in (False, True):
        try:
            s.push_config(force=force)
            raise AssertionError(f"a one-team roster was pushed (force={force})")
        except ValueError as e:
            assert "ONE SIDE" in str(e), e

    # 1 v 3: uneven, legal, and it plays.
    s.patch_player(ps[0]["player_id"], team_id="yellow")
    rd = s.readiness()
    assert rd["roster_faults"] == [], rd["roster_faults"]
    assert rd["go"], rd["board"]
    s.push_config()
    s.start(force=True)          # `force` here is only about the missing gun echoes, which is another test's ground

    # ...and putting them back makes START itself refuse, force included.
    s.phase = "lobby"
    s.players[ps[0]["player_id"]]["team_id"] = "blue"
    for force in (False, True):
        try:
            s.start(force=force)
            raise AssertionError(f"a one-team roster was started (force={force})")
        except ValueError as e:
            assert "ONE SIDE" in str(e), e


def test_round2_b_the_gate_never_fires_on_a_solo_game_or_an_empty_roster():
    """CONTROL. `ffa` declares one team and so does `lms` -- every player shares it BY DESIGN, and the
    gun's friendly-fire rule is not in play there. The gate is about a TEAMS game (2+ configured
    teams) whose roster left one of them empty; it must not turn every solo mode into a refusal."""
    s, net, clock, ps = mk(3)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    for mode in ("ffa", "lms"):
        s.set_config({"mode": mode, "time_limit_s": 60})
        assert len({p["team_id"] for p in s.players.values()}) == 1
        assert s.readiness()["roster_faults"] == [], mode
        s.push_config()
    s2 = mk(0)[0]
    assert s2.readiness()["roster_faults"] == []
    s3 = mk(1)[0]                # a solo session: nobody to shoot whatever the teams say, never this fault
    assert s3.readiness()["roster_faults"] == []


# ---- round-3 fix pass (2026-09-13): MERGE-0 / FIELD-1 / MERGE-2 ------------------------------
def test_round3_merge0_the_team_fault_is_tid_based_and_allows_a_third_empty_team():
    """MERGE-0. The round-2 gate asked "is EVERY declared team populated?", which is wrong twice.

    (a) TDM advertises 2-4 teams and the objective modes allow three, so a 2/2/0 across three
        declared sides is an ordinary, perfectly playable match -- two sides can shoot each other.
        The old rule refused it, and `force` does not open this gate, so the operator was stuck.
    (b) `counts` was keyed by `team_id` and nothing checks that two teams do not share a `$TID`.
        Two teams on tid 1 both read "populated" while the GUN sees one side: no hit can register
        for the whole match, and the gate PASSED it.

    One predicate, stated on the tids that actually have somebody on them.
    """
    s, net, clock, ps = mk(4)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    three = [TEAM_DEFS["blue"], TEAM_DEFS["yellow"], TEAM_DEFS["green"]]
    s.set_config({"mode": "tdm", "time_limit_s": 60, "teams": three})
    for p, t in zip(ps, ("blue", "blue", "yellow", "yellow")):
        s.players[p["player_id"]]["team_id"] = t
    assert s.readiness()["roster_faults"] == [], "2/2/0 over three declared teams plays"
    assert s.readiness()["go"], s.readiness()["board"]
    s.push_config()

    # (b) two teams, one $TID: 2 v 2 on paper, ONE side on the field.
    # Written straight onto the config rather than through `set_config`, which since A36 REFUSES a
    # duplicate `$TID` outright (`test_mc_config_proof`). This shape can still ARRIVE -- a restored
    # snapshot's config is taken verbatim, and a preset saved by an older build has never been
    # re-validated -- so the predicate is still the backstop it was written to be, and the point of
    # this half is that the predicate reads TIDS, not `team_id`s.
    dup = [dict(TEAM_DEFS["blue"]), {**TEAM_DEFS["yellow"], "tid": 1}]
    s.config["teams"] = dup
    s.teams = list(dup)
    counts = {}
    for p in s.players.values():
        counts[p["team_id"]] = counts.get(p["team_id"], 0) + 1
    assert sorted(counts.values()) == [2, 2], f"control: the roster really is 2 v 2 by team_id ({counts})"
    assert s.one_team_fault(), "two teams sharing one $TID are ONE side"
    assert any("ONE SIDE" in f for f in s.readiness()["roster_faults"]), s.readiness()["roster_faults"]
    try:
        s._refuse_one_team()
        raise AssertionError("the gate passed a roster where every player is on one $TID")
    except ValueError as e:
        assert "ONE SIDE" in str(e), e
    # (the compiler's own `duplicate team tid` error refuses the push first — belt and braces, and
    # the reason the gate must still be right: `start()` re-asks this gate with no compile behind it)
    for force in (False, True):
        try:
            s.push_config(force=force)
            raise AssertionError(f"a single-$TID roster was pushed (force={force})")
        except ValueError:
            pass


def test_round3_field1_a_mode_pick_reteams_by_index_and_rebalances():
    """FIELD-1. `set_config` used to dump every player whose team the new mode does not have onto
    `teams[0]`, so TDM(blue/yellow) -> KOTH(blue/green) put the whole field on BLUE and the MERGE-0
    gate then refused the push, unforceably. The operator had to re-drag half the roster on every
    cross-family mode pick (`koth.mjs` grew a `rebalance()` helper for exactly this).

    The rule now: map by team INDEX, least-count fill whatever is left over, and rebalance ONLY if
    the one-side predicate is true afterwards.
    """
    s, net, clock, ps = mk(4)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)

    def tids():
        return [s.players[p["player_id"]]["team_id"] for p in ps]

    s.set_config({"mode": "tdm", "time_limit_s": 60})
    for p, t in zip(ps, ("blue", "blue", "yellow", "yellow")):
        s.players[p["player_id"]]["team_id"] = t

    # (1) tdm 2 v 2 -> koth: the operator's split SURVIVES, yellow -> green by index.
    s.set_config({"mode": "koth", "time_limit_s": 60})
    assert tids() == ["blue", "blue", "green", "green"], tids()
    assert s.readiness()["roster_faults"] == [], "the pick does not strand the roster on one side"

    # (2) a switch that changes nothing leaves the teams alone.
    s.set_config({"mode": "koth", "time_limit_s": 45})
    assert tids() == ["blue", "blue", "green", "green"], tids()

    # (3) ffa (one team) -> tdm: everyone lands on index 0, so the rebalance splits them 2/2.
    s.set_config({"mode": "ffa", "time_limit_s": 60})
    assert len(set(tids())) == 1, "control: ffa really does share one team"
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    got = {}
    for t in tids():
        got[t] = got.get(t, 0) + 1
    assert sorted(got.values()) == [2, 2], got
    assert s.readiness()["roster_faults"] == []

    # (4) three declared teams -> two: the third team's players are least-count filled, and a 2/2/0
    #     that already plays is NEVER rebalanced.
    s.set_config({"mode": "tdm", "time_limit_s": 60,
                  "teams": [TEAM_DEFS["blue"], TEAM_DEFS["yellow"], TEAM_DEFS["green"]]})
    for p, t in zip(ps, ("blue", "blue", "green", "green")):
        s.players[p["player_id"]]["team_id"] = t
    assert s.readiness()["roster_faults"] == [], "2/2/0 is left alone"
    assert tids() == ["blue", "blue", "green", "green"], tids()
    s.set_config({"mode": "tdm", "time_limit_s": 60,
                  "teams": [TEAM_DEFS["blue"], TEAM_DEFS["yellow"]]})
    assert tids() == ["blue", "blue", "yellow", "yellow"], tids()


def test_round3_merge2_an_unbound_recompile_drops_the_stale_ack():
    """MERGE-2. `_resend`'s unbound branch (round-2 pass H) recompiles the player's stored bundle but
    left their ACK in place, and `_bind` drops a displaced player's `node_id` without touching theirs
    either. So a player could hold `ok: true` + a gun echo for frames that had since been recompiled
    and never sent -- and the moment their phone came back, `all_acked()` certified the new head on
    the strength of the old echo and `start()` went through without `force`."""
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config()
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    assert s.all_acked()
    a = ps[0]["player_id"]

    # node0's phone is claimed by the other operator: player 0 is unbound and keeps its ok ack.
    s._bind("node0", s.players[ps[1]["player_id"]])
    assert s.players[a]["node_id"] is None, "control: player 0 really is unbound"
    assert (s.acks.get(a) or {}).get("ok"), "control: the stale ok is still there before the edit"

    # ...and now an edit silently recompiles the frames nobody sent.
    s.patch_player(a, display="RENAMED")
    assert a not in s.acks, "the recompile must drop the ack it just invalidated"

    # when the phone comes back the old echo must not certify the new head
    s._bind("node1", s.players[a])
    assert not s.all_acked(), "a recompiled, never-sent bundle is not acked"
    try:
        s.start()
        raise AssertionError("start() accepted a roster holding a stale ack")
    except ValueError as e:
        assert "acked" in str(e), e


def test_a_hot_joiner_whose_weapon_the_pinned_plan_never_saw_is_withheld():
    """S16 review 2026-09-19: a player who joins a running match is compiled against the PINNED hit plan. A
    weapon with a conditional `$SIR` row (catalogue `sir_fn`: the Toxin Rifle's <11,0>) that the plan never
    saw is in no gun's table, and a `dot` weapon is missing from every `dot` table, so its hits vanish in
    silence. The hot join is withheld with one WITHHELD feed line; a stock-cell joiner still joins."""
    from brx_mcp.mc.compile import Compiler
    clock = {"t": T0}
    net = FakeNet()
    s = Session(Compiler(), net, FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s.set_config({"mode": "tdm", "time_limit_s": 60})
    ps = [s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}") for i in range(2)]
    online(s, net, clock, ps[0], 0); online(s, net, clock, ps[1], 1)
    s.push_config(force=True)
    for i in range(2):
        net.simulate_node_message(f"node{i}", "ack_config",
                                  {"config_id": s.config["config_id"], "ok": True, "gun_echo": "$LCD"}, clock["t"])
    s.start(force=True)
    assert s.in_play()
    assert "toxin_rifle" not in s._pinned_hit_plan.cells, "fixture: the match must start with no Toxin Rifle"
    net.pushed.clear()
    tail = demo_armory()[2]["ble"]["tail"]
    net.simulate_hello("node2", f"GUN-C-{tail}")
    late = s.add_player("LATE", gun_id="GUN-C", loadout={"weapons": [{"weapon_id": "toxin_rifle"}]})
    assert [w["weapon_id"] for w in late["loadout"]["weapons"]][:1] == ["toxin_rifle"], late["loadout"]
    assert late["node_id"] == "node2"
    assert not net.pushes("config", node_id="node2"), "no frames: its hits would register on no gun"
    assert not net.pushes("start", node_id="node2")
    assert late["player_id"] not in s.bundles
    withheld = [e for e in s.feed if e.get("tag") == "WITHHELD"]
    assert len(withheld) == 1, withheld
    assert "TOXIN RIFLE" in withheld[0]["text"] and "LATE" in withheld[0]["text"], withheld[0]["text"]
    # the welcome path (a re-hello) withholds too, and says it once
    node = net.simulate_hello("node2", f"GUN-C-{tail}")
    assert node and "frames" not in node and "start" not in node
    assert len([e for e in s.feed if e.get("tag") == "WITHHELD"]) == 1

    # a joiner on a stock cell still hot joins
    net.pushed.clear()
    tail3 = demo_armory()[3]["ble"]["tail"]
    net.simulate_hello("node3", f"GUN-D-{tail3}", app_ver="0.4.5")
    ok = s.add_player("STOCK", gun_id="GUN-D", loadout={"weapons": [{"weapon_id": "assault_rifle"}]})
    assert ok["node_id"] == "node3"
    assert net.pushes("config", node_id="node3") and net.pushes("start", node_id="node3")


def test_q13_the_briefing_says_team_damage_off_only_in_a_game_with_teams():
    """Q13: the phone briefing shows TEAM DAMAGE: OFF from `game.team_damage`, present only with 2+ teams."""
    from brx_mcp.mc.state import default_config
    s, net, clock, ps = mk()
    for mode, want in (("tdm", "off"), ("ffa", None), ("lms", None), ("infection", "off")):
        s.config = default_config(mode)
        assert s.game_brief().get("team_damage") == want, (mode, s.game_brief().get("team_damage"))
