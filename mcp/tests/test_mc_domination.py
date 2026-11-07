"""Domination from Mission Control (Tony 2026-11-02, docs/domination-design.md §5): three Bluetooth hills, 1 point per
owned hill per second, first to 1000. The one rule that differs from KOTH: OWNERSHIP scores, not presence.

The station banks both clocks and knows no mode (utility.md §5d.6): `hold_ms` (a living owner on it, alone; KOTH) and
`own_ms` (the team owns it, contested or empty; Domination). MC picks the clock by mode (`stations.ownership_clock`).

Run: python3 run_tests.py mc_domination
"""
from _session import assign_koth_hill, mc_session, mk_session, online
from brx_mcp.mc.state import default_config
from brx_mcp.mc.stations import ownership_clock

_sess = mc_session


def test_the_defaults_are_first_to_1000_on_bluetooth_hills_red_against_blue():
    cfg = default_config("domination")
    assert cfg["scoring"] == {"frag_limit": None, "win_by": "objective", "hold_target_s": 1000}, cfg["scoring"]
    assert cfg["station_source"] == "phone"
    assert {t["tid"] for t in cfg["teams"]} == {0, 1}, "F82: never tid 2, the neutral hill team"
    assert "hold_target_s" not in default_config("koth")["scoring"], "CONTROL: KOTH keeps no default target"


def test_the_brief_says_the_target_in_hill_points():
    s = _sess("domination")
    assign_koth_hill(s)
    assert s.game_brief()["win_text"] == "FIRST TO 1000 HILL POINTS WINS", s.game_brief()
    s.set_config({"mode": "koth", "scoring": {"hold_target_s": 300}})
    assert s.game_brief()["win_text"] == "FIRST TO HOLD 5:00 WINS", "CONTROL: KOTH keeps its time wording"


def test_a_domination_game_compiles_with_a_hill_and_is_refused_without_one():
    s = _sess("domination")
    fault = s.station_registry.koth_hill_fault()
    assert fault and fault.startswith("DOMINATION NEEDS A HILL"), fault
    assign_koth_hill(s)
    assert s.station_registry.koth_hill_fault() is None
    res = s._validate()
    assert res["ok"], res["errors"]


def test_a_grenade_source_is_refused_because_a_grenade_names_no_point():
    s = _sess("domination")
    assign_koth_hill(s)
    s.config["station_source"] = "grenade"
    errs = s._validate()["errors"]
    assert any("DOMINATION NEEDS BLUETOOTH HILLS" in e for e in errs), errs
    s.config["station_source"] = "phone"
    assert not any("DOMINATION NEEDS BLUETOOTH HILLS" in e for e in s._validate()["errors"])


def test_fewer_than_three_hills_is_an_amber_line_not_a_refusal():
    s = _sess("domination")
    assign_koth_hill(s, "util-a")
    warn = s.station_registry.koth_hill_offline_warning()
    assert any("DOMINATION IS DESIGNED FOR 3 HILLS AND 1 IS ASSIGNED" in w for w in warn), warn
    assign_koth_hill(s, "util-b")
    assign_koth_hill(s, "util-c")
    assert not any("DESIGNED FOR 3" in w for w in s.station_registry.koth_hill_offline_warning())
    s.set_config({"mode": "koth"})
    assert not any("DESIGNED FOR 3" in w for w in s.station_registry.koth_hill_offline_warning()), "CONTROL: KOTH"


def test_the_ownership_clock_takes_own_ms_and_never_the_presence_clock():
    c = {"owner": 0, "hold_ms": {"0": 5_000}, "own_ms": {"0": 40_000, "1": 7_000},
         "games": {"9": {"hold_ms": {"0": 1}, "own_ms": {"0": 2}}, "8": {"hold_ms": {"1": 3}}}}
    got = ownership_clock(c)
    assert got["hold_ms"] == {"0": 40_000, "1": 7_000}, got
    assert got["games"] == {"9": {"hold_ms": {"0": 2}, "own_ms": {"0": 2}}, "8": {"hold_ms": {}}}, got["games"]
    assert ownership_clock({"owner": 0, "hold_ms": {"0": 5_000}})["hold_ms"] == {}, "an old station scores nothing"
    assert ownership_clock(None) is None


def _live(mode, target):
    s, net, clock, ps = mk_session(2)
    s.set_config({"mode": mode, "time_limit_s": 1800, "scoring": {"hold_target_s": target}})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    for nid in ("util-a", "util-b", "util-c"):
        net.simulate_utility_hello(nid)
        s.set_station(nid, {"kind": "control"})
    s.push_config(force=True)
    info = s.start(runway_s=1, force=True)
    clock["t"] = info["go_live_t"] + 5_000
    s.tick()
    assert s.phase == "live", s.phase
    return s, net, clock


def _beat(s, net, clock, nid, owner, hold, own):
    sid = s.station_registry.stations[nid]["assigned"]["id"]
    control = {"owner": owner, "progress": 100, "contested": True, "hold_ms": hold}
    if own is not None:
        control["own_ms"] = own
    net.simulate_status(nid, {"role": "utility", "kind": "control", "station_id": sid, "control": control}, clock["t"])


def test_domination_scores_owned_time_summed_across_hills_and_ends_at_the_target():
    s, net, clock = _live("domination", 1000)
    red, blue = s.config["teams"][0], s.config["teams"][1]
    r, b = str(red["tid"]), str(blue["tid"])
    clock["t"] += 400_000
    # A and B are red's, contested most of the time: the presence clock is small, the ownership clock is not
    _beat(s, net, clock, "util-a", red["tid"], {r: 10_000}, {r: 390_000})
    _beat(s, net, clock, "util-b", red["tid"], {r: 20_000}, {r: 380_000})
    _beat(s, net, clock, "util-c", blue["tid"], {b: 300_000}, {b: 300_000})
    assert s.phase == "live", "770 points: under the target"
    poss = s._m().scorer.possession()
    assert poss["by_team"] == {red["team_id"]: 770, blue["team_id"]: 300}, poss
    clock["t"] += 240_000
    _beat(s, net, clock, "util-b", red["tid"], {r: 20_000}, {r: 370_000})   # a lower restarted reading never walks back
    _beat(s, net, clock, "util-a", red["tid"], {r: 10_000}, {r: 615_000})
    assert s.phase == "live", "995 points (615 + 380): one hill-second short"
    _beat(s, net, clock, "util-a", red["tid"], {r: 10_000}, {r: 620_000})
    assert s.phase == "recap", s.phase
    assert s.end_reason == "hold_target", s.end_reason


def test_koth_still_scores_the_presence_clock_from_the_same_station():
    """CONTROL: the same heartbeat in KOTH scores `hold_ms`, so the swap is Domination's alone."""
    s, net, clock = _live("koth", 1000)
    red = s.config["teams"][0]
    r = str(red["tid"])
    clock["t"] += 400_000
    _beat(s, net, clock, "util-a", red["tid"], {r: 10_000}, {r: 390_000})
    assert s._m().scorer.possession()["by_team"][red["team_id"]] == 10, s._m().scorer.possession()


def test_an_old_station_with_no_ownership_clock_scores_nothing_in_domination():
    s, net, clock = _live("domination", 1000)
    red = s.config["teams"][0]
    clock["t"] += 400_000
    _beat(s, net, clock, "util-a", red["tid"], {str(red["tid"]): 300_000}, None)
    poss = s._m().scorer.possession()
    assert poss is None or poss["by_team"][red["team_id"]] == 0, poss


def test_the_bundle_names_the_hills_a_b_c_in_id_order_in_domination_only():
    s = _sess("domination")
    for nid in ("util-a", "util-b", "util-c"):
        assign_koth_hill(s, nid)
    rows = [r for r in s.station_registry.station_ids() if r["kind"] == "control"]
    assert [r["letter"] for r in rows] == ["A", "B", "C"], rows
    assert [r["id"] for r in rows] == sorted(r["id"] for r in rows), rows
    assert s._wire_config()["stations"] == s.station_registry.station_ids()
    s.set_config({"mode": "koth"})
    assert all("letter" not in r for r in s.station_registry.station_ids()), "CONTROL: KOTH's bundle is unchanged"


def test_a_domination_roster_is_two_teams_and_never_yellow_with_the_mode_named():
    s = _sess("domination")
    for teams, want in (([{"team_id": "red", "name": "RED", "color": "#f00", "tid": 0},
                          {"team_id": "blue", "name": "BLUE", "color": "#00f", "tid": 1},
                          {"team_id": "purple", "name": "PURPLE", "color": "#a0f", "tid": 3}],
                         "DOMINATION IS EXACTLY 2 TEAMS: PICK TWO COLOURS"),
                        ([{"team_id": "red", "name": "RED", "color": "#f00", "tid": 0},
                          {"team_id": "yellow", "name": "YELLOW", "color": "#ff0", "tid": 2}],
                         "YELLOW IS DOMINATION'S NEUTRAL TEAM: PICK RED, BLUE OR PURPLE")):
        try:
            s.set_config({"teams": teams})
            raise AssertionError(f"accepted {teams}")
        except ValueError as e:
            assert str(e) == want, e


def test_an_unreachable_target_is_said_in_points():
    """1000 points on one hill in 10:00 can never fire: one hill banks at most 600. Three hills can reach it."""
    s = _sess("domination")
    assign_koth_hill(s, "util-a")
    s.set_config({"time_limit_s": 600})
    assert any("THE SCORE TARGET (1000 POINTS) IS AT OR PAST THE TIME LIMIT (10:00)" in w for w in s.config_warnings), s.config_warnings
    assign_koth_hill(s, "util-b")
    s.set_config({"time_limit_s": 600})
    assert not any("SCORE TARGET" in w for w in s.config_warnings), "two hills bank up to 1200: reachable"


def test_the_team_that_crosses_the_target_wins_though_both_round_to_it():
    """Review 2026-11-06: blue at 999.6 points and red reaching 1000.0 both round to 1000, and the winner (rounded
    seconds) said a tie although red crossed the target and ended the match. KOTH shares the rule."""
    s, net, clock = _live("domination", 1000)
    red, blue = s.config["teams"][0], s.config["teams"][1]
    r, b = str(red["tid"]), str(blue["tid"])
    clock["t"] += 1_100_000
    _beat(s, net, clock, "util-c", blue["tid"], {b: 1}, {b: 999_600})
    _beat(s, net, clock, "util-a", red["tid"], {r: 1}, {r: 500_000})
    assert s.phase == "live", "CONTROL: nobody has crossed yet"
    _beat(s, net, clock, "util-b", red["tid"], {r: 1}, {r: 500_000})
    assert s.end_reason == "hold_target", s.end_reason
    sc = s._m().scorer
    assert sc.possession()["by_team"] == {red["team_id"]: 1000, blue["team_id"]: 1000}, sc.possession()
    assert sc.winner() == {"team_id": red["team_id"]}, sc.winner()
    assert (s.last_recap or {}).get("winner") == {"team_id": red["team_id"]}, (s.last_recap or {}).get("winner")
    sc._announced.discard("hold_target")     # round 2: a rebuilt scorer (a rescore, a resume) carries no such mark
    assert sc.winner() == {"team_id": red["team_id"]}, "the raw ms decide it, whatever the scorer remembers"


def test_a_hill_keeps_its_letter_when_another_leaves_in_play_and_across_a_restart():
    """Review 2026-11-06: a letter was a hill's rank among the hills assigned NOW. A hill that left in play (BACK TO
    HUD) renamed the others in a late joiner's bundle (B became A) while every other phone still said B."""
    import pathlib
    import tempfile
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    s, net, clock = _live("domination", 1000)
    letters = lambda sess: {r["id"]: r["letter"] for r in sess.station_registry.station_ids() if r["kind"] == "control"}
    before = letters(s)
    assert sorted(before.values()) == ["A", "B", "C"], before
    gone = min(before)                                   # hill A leaves mid-match
    nid = next(n for n, st in s.station_registry.stations.items() if (st.get("assigned") or {}).get("id") == gone)
    assert s.release_station(nid)
    after = letters(s)
    assert after == {k: v for k, v in before.items() if k != gone}, (before, after)
    path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = path
    s.persist_now()
    s._persist()
    s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s2._persist_path = path
    s2.restore_snapshot()
    assert s2.station_registry._hill_letters == before, s2.station_registry._hill_letters


def test_the_end_line_says_the_target_in_points():
    """Review 2026-11-06: the feed said "HOLD TARGET 16:40 REACHED" for a 1000-point Domination target."""
    s, net, clock = _live("domination", 1000)
    red = s.config["teams"][0]
    r = str(red["tid"])
    clock["t"] += 1_100_000
    _beat(s, net, clock, "util-a", red["tid"], {r: 1}, {r: 1_000_000})
    assert s.end_reason == "hold_target", s.end_reason
    lines = [e.get("text", "") for e in s.feed]
    assert any("SCORE TARGET 1000 POINTS REACHED" in t for t in lines), lines[-5:]
    assert not any("HOLD TARGET 16:40" in t for t in lines), lines[-5:]


def test_a_restart_keeps_each_hills_owner_and_points_on_its_row_before_it_beats_again():
    """Review 2026-11-06 (found by chaos `domination-hills`): a restart keeps a hill's tally (its points still score)
    but not its last report, so until the hill beats again its STATIONS row said NEVER HEARD FROM with no points. A hill
    out of Wi-Fi from the restart to the whistle kept that row on the recap while its points counted."""
    import pathlib
    import tempfile
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    s, net, clock = _live("domination", 1000)
    red = s.config["teams"][0]
    r = str(red["tid"])
    clock["t"] += 400_000
    _beat(s, net, clock, "util-a", red["tid"], {r: 1}, {r: 300_000})
    before = s.station_registry.station_view("util-a")["report"]["control"]
    assert before["owner"] == red["tid"] and before["hold_ms"] == {r: 300_000}, before
    path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = path
    s._persist_last = 0.0
    s._persist_dirty = True
    s.persist_now()
    s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s2._persist_path = path
    s2.restore_snapshot()
    got = s2.station_registry.station_view("util-a")["report"].get("control") or {}
    assert got.get("owner") == red["tid"] and got.get("hold_ms") == {r: 300_000}, got
    assert not s2.station_registry.station_view("util-b")["report"], "CONTROL: a hill that never reported stays unheard"


def test_a_reschedule_in_armed_keeps_the_letters_the_phones_hold():
    """Review round 2: RESCHEDULE runs START's bookkeeping again; a hill released while ARMED must not re-letter the rest."""
    s, net, clock, ps = mk_session(2)
    s.set_config({"mode": "domination", "time_limit_s": 1800})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    for nid in ("util-a", "util-b", "util-c"):
        net.simulate_utility_hello(nid)
        s.set_station(nid, {"kind": "control"})
    s.push_config(force=True)
    s.start(runway_s=60, force=True)
    assert s.phase == "armed", s.phase
    letters = lambda: {r["id"]: r["letter"] for r in s.station_registry.station_ids() if r["kind"] == "control"}
    before = letters()
    gone = min(before)
    nid = next(n for n, st in s.station_registry.stations.items() if (st.get("assigned") or {}).get("id") == gone)
    assert s.release_station(nid)
    s.reschedule(60)
    assert letters() == {k: v for k, v in before.items() if k != gone}, (before, letters())


def test_a_hill_captured_only_while_out_of_wifi_scores_its_late_report():
    """Review 2026-11-06 (chaos `domination-hills`): a far hill heard in play with nothing banked, captured only after it
    lost Wi-Fi, reports after the whistle. That report was "unverified" (no in-play reading) and all its points dropped.
    The empty in-play beat is the base now; the late gain is bounded by the time from that beat to the whistle."""
    s, net, clock = _live("domination", 1000)
    red = s.config["teams"][0]
    r = str(red["tid"])
    clock["t"] += 100_000
    _beat(s, net, clock, "util-a", 2, {}, {})                  # heard in play: nobody owns it yet
    clock["t"] += 3_000
    _beat(s, net, clock, "util-a", 2, {}, {})                  # beats on (the first may sit in the arming window)
    heard_at = clock["t"]
    clock["t"] += 60_000                                       # out of Wi-Fi; red captures it and holds it
    s.control("end")
    end = clock["t"]
    assert s.phase == "recap", s.phase
    clock["t"] += 20_000
    _beat(s, net, clock, "util-a", red["tid"], {r: 1}, {r: 50_000})   # back in Wi-Fi after the whistle
    clock["t"] += 3_000
    _beat(s, net, clock, "util-a", red["tid"], {r: 1}, {r: 50_000})   # past the relock's window
    poss = (s.last_recap or {}).get("possession") or {}
    assert poss.get("by_team", {}).get(red["team_id"]) == 50, (poss, end - heard_at)



def test_a_late_hill_report_on_an_empty_base_survives_a_restart_in_recap():
    """Codex pass 2026-11-07: the empty in-play base was not a history row, so a restart in RECAP replayed the late
    report as in play, the whistle moved it back, no in-play row was found and the hill's points went: red 50 to 40
    became blue 40 to 0."""
    import pathlib
    import tempfile
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    s, net, clock = _live("domination", 1000)
    r, b = (str(t["tid"]) for t in s.config["teams"])
    clock["t"] += 100_000
    _beat(s, net, clock, "util-a", 2, {}, {})
    clock["t"] += 3_000
    _beat(s, net, clock, "util-a", 2, {}, {})                         # heard in play, nobody owns it
    _beat(s, net, clock, "util-b", int(b), {b: 1}, {b: 40_000})
    clock["t"] += 60_000                                                # util-a out of Wi-Fi; red captures it
    s.control("end")
    clock["t"] += 20_000
    _beat(s, net, clock, "util-a", int(r), {r: 1}, {r: 50_000})
    clock["t"] += 3_000
    _beat(s, net, clock, "util-a", int(r), {r: 1}, {r: 50_000})
    before = (s.last_recap["possession"]["by_team"], s.last_recap["winner"])
    assert before == ({"red": 50, "blue": 40}, {"team_id": "red"}), before
    path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path, s._persist_last, s._persist_dirty = path, 0.0, True
    s.persist_now()
    s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
    s2._persist_path = path
    s2.restore_snapshot()
    assert s2.resume_match() == "recap"
    after = (s2.last_recap["possession"]["by_team"], s2.last_recap["winner"])
    assert after == before, (before, after)

def _scorer(hold_target_s=None):
    from brx_mcp.mc.scoring import Scorer
    t0, now = 1_000_000, {"t": 1_000_000}
    teams = [{"team_id": "red", "name": "R", "color": "#f00", "tid": 0}, {"team_id": "blue", "name": "B", "color": "#00f", "tid": 1}]
    sc = Scorer("m1", t0, 1800, "domination", {}, teams, {}, {}, now_ms=lambda: now["t"], win_by="objective",
                hold_target_s=hold_target_s)
    return sc, now, t0


def test_an_empty_hill_base_after_a_moved_whistle_does_not_silence_the_phones():
    """Review round 3: an empty in-play reading is a base for a late report, never a score. When the whistle moved
    earlier than that reading (an operator END replayed on a resume), the rebound made the site station-scored with
    nothing, so the phones' 100 s for it vanished and the result went undecided."""
    sc, now, t0 = _scorer()
    sc.possession_ms["1"] = {0: {"n1": 100_000}}           # the phones: red held hill 1 for 100 s
    now["t"] = t0 + 400_000
    sc.station_possession("1", {}, seen_ms=t0 + 400_000)   # the hill, heard with nothing banked
    assert sc.possession()["by_team"]["red"] == 100, "CONTROL: an empty reading scores nothing and silences nobody"
    sc.set_end(t0 + 300_000)                               # the whistle moves before that reading
    assert sc.possession()["by_team"]["red"] == 100, (sc.possession(), sc.station_possession_ms)
    assert "1" not in sc.station_possession_ms and "1" not in sc.station_seen_ms
    assert sc.winner() == {"team_id": "red"}, sc.winner()


def test_two_teams_over_the_target_are_decided_on_raw_points_not_rounded():
    """Review round 3: red crosses 1000 and MC ends; blue's hill, out of Wi-Fi, reports 1000.3 late inside its window.
    Rounded seconds called that a tie; the raw points decide it (only an exact raw tie is a tie)."""
    sc, now, t0 = _scorer(hold_target_s=1000)
    ends = []
    sc.on_limit = lambda t: (ends.append(t), sc.set_end(t))
    now["t"] = t0 + 1_100_000
    sc.station_possession("2", {1: 950_000}, now["t"], seen_ms=now["t"])
    now["t"] += 200_000
    sc.station_possession("1", {0: 1_000_000}, now["t"], seen_ms=now["t"])
    assert ends, "CONTROL: red's crossing ended the match"
    assert sc.winner() == {"team_id": "red"}, sc.winner()
    now["t"] += 30_000
    sc.station_possession("2", {1: 1_000_300}, None, seen_ms=now["t"])
    assert sc._possession_ms()[0]["blue"] == 1_000_300, sc._possession_ms()
    assert sc.winner() == {"team_id": "blue"}, sc.winner()


def test_hills_added_in_play_keep_the_letters_they_were_first_given():
    """Review round 3: an unfrozen hill took the next free letter by its place among the unfrozen ones, so a lower id
    added later took its letter (hill 5 was C, then hill 4 joined and took C)."""
    s, net, clock = _live("domination", 1000)
    letters = lambda: {r["id"]: r["letter"] for r in s.station_registry.station_ids() if r["kind"] == "control"}
    reg = s.station_registry
    reg._hill_letters = {1: "A", 2: "B"}                     # START froze two hills
    reg.stations["util-c"]["assigned"]["id"] = 5            # a third hill, id 5, joins in play
    assert letters()[5] == "C", letters()
    net.simulate_utility_hello("util-d")
    reg.stations["util-d"]["assigned"] = {**reg.stations["util-c"]["assigned"], "id": 4}   # then id 4
    got = letters()
    assert got[5] == "C" and got[4] == "D", got
