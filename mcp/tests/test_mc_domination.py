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
