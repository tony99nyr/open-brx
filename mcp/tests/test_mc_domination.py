"""Domination from Mission Control (Tony 2026-11-02, docs/domination-design.md §5): three Bluetooth hills, 1 point per
owned hill per second, first to 1000. The one rule that differs from KOTH: OWNERSHIP scores, not presence.

The station banks both clocks and knows no mode (utility.md §5d.6): `hold_ms` (a living owner on it, alone; KOTH) and
`own_ms` (the team owns it, contested or empty; Domination). Since 2026-11-07 (Tony: "it should be the phones") MC scores
Domination from the phones' `own_change` facts (`ownership.owned_ms`); the Stick's `own_ms` (`stations.ownership_clock`)
is only the cross-check on its STATIONS row. KOTH still scores the stations' presence clock.

Run: python3 run_tests.py mc_domination
"""
import pathlib
import tempfile

from _session import assign_koth_hill, mc_session, mk_session, mk_stored_session, online, restart_session
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


def _live(mode, target, stored=False):
    s, net, clock, ps = mk_stored_session(2) if stored else mk_session(2)
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


_SEQ = {"n": 1000}


def _own(s, net, clock, node, hill, frm, own, at=None, mid=None):
    """A phone's `own_change` fact (Tony 2026-11-07: Domination is scored from the phones): the owner of `hill`'s advert
    went from `frm` to `own` at `at` (MC's clock; now by default)."""
    _SEQ["n"] += 1
    site = str(s.station_registry.stations[hill]["assigned"]["id"])
    at = clock["t"] if at is None else at
    recv = max(clock["t"], at)   # a fact reaches MC after the phone heard the step
    net.simulate_event(node, {"type": "own_change", "t": at, "match_id": mid or s._m().head["match_id"], "site": site,
                              "from_tid": frm, "owner_tid": own, "at_ms": at}, recv, seq=_SEQ["n"])


def test_domination_scores_the_phones_owner_timeline_summed_across_hills_and_ends_at_the_target():
    """Tony 2026-11-07: a hill's points are the time its owner held it, from the phones' own_change facts. An owned hill
    with nobody near it keeps scoring, so the target ends the match on the tick with no new report. The Stick's own
    clock scores nothing (it is the cross-check on its row)."""
    s, net, clock = _live("domination", 1000)
    red, blue = s.config["teams"][0], s.config["teams"][1]
    r, b = red["tid"], blue["tid"]
    go = s._m().head["go_live_t"]
    _own(s, net, clock, "node0", "util-a", 2, r, at=go + 10_000)
    _own(s, net, clock, "node1", "util-a", 2, r, at=go + 10_300)        # a second phone, the same step: counted once
    _own(s, net, clock, "node0", "util-b", 2, r, at=go + 20_000)
    _own(s, net, clock, "node1", "util-c", 2, b, at=go + 100_000)
    clock["t"] = go + 400_000
    _beat(s, net, clock, "util-a", r, {str(r): 1}, {str(r): 999_000})   # the Stick's clock: never the score
    poss = s._m().scorer.possession()
    assert poss["by_team"] == {red["team_id"]: 770, blue["team_id"]: 300}, poss
    assert s.phase == "live", "770 points: under the target"
    clock["t"] = go + 400_000 + 114_000
    s.tick()
    assert s.phase == "live", "998 points (390 + 114 + 380 + 114): short of 1000"
    clock["t"] += 1_000
    s.tick()
    assert s.phase == "recap", ("1000 points on the tick, with no new report", s.phase)
    assert s.end_reason == "hold_target", s.end_reason



def test_a_late_own_change_after_the_whistle_counts_from_its_time():
    """A phone out of Wi-Fi heard blue take hill C before the whistle; its fact arrives after it. The step counts from
    when it was heard, and a step heard after the whistle does not count."""
    s, net, clock = _live("domination", 1000)
    blue = s.config["teams"][1]
    go, mid = s._m().head["go_live_t"], s._m().head["match_id"]
    clock["t"] = go + 300_000
    s.control("end")
    assert s.phase == "recap", s.phase
    clock["t"] += 30_000
    _own(s, net, clock, "node1", "util-c", 2, blue["tid"], at=go + 200_000, mid=mid)
    _own(s, net, clock, "node1", "util-a", 2, blue["tid"], at=go + 310_000, mid=mid)   # after the whistle: not counted
    poss = (s.recap() or {}).get("possession") or {}
    assert poss.get("by_team", {}).get(blue["team_id"]) == 100, poss


def test_an_mc_restart_mid_match_rebuilds_the_owner_timeline_from_the_stored_facts():
    s, net, clock = _live("domination", 1000, stored=True)
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    red, blue = s.config["teams"][0], s.config["teams"][1]
    go = s._m().head["go_live_t"]
    _own(s, net, clock, "node0", "util-a", 2, red["tid"], at=go + 10_000)
    _own(s, net, clock, "node1", "util-a", red["tid"], 2, at=go + 70_000)
    _own(s, net, clock, "node1", "util-a", 2, blue["tid"], at=go + 75_000)
    clock["t"] = go + 200_000
    before = s._m().scorer.possession()["by_team"]
    assert before == {red["team_id"]: 60, blue["team_id"]: 125}, before
    s2, _net2 = restart_session(s, clock)
    assert s2.resume_match() == "live"
    assert s2._m().scorer.possession()["by_team"] == before, s2._m().scorer.possession()



def test_a_target_crossed_while_mc_was_down_ends_at_the_resume_not_at_the_first_fact():
    """Chaos `domination-hills-target`: an owned hill scores while MC is down, so a resume can find the target crossed.
    The resume stamped that whistle at the replay's first fact, where nobody had any points, and the recap scored
    nothing. The points are read now, so the whistle is now."""
    s, net, clock = _live("domination", 1000, stored=True)
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    red = s.config["teams"][0]
    go = s._m().head["go_live_t"]
    _own(s, net, clock, "node0", "util-a", 2, red["tid"], at=go + 10_000)
    clock["t"] = go + 20_000
    s.tick()
    assert s.phase == "live"
    s._persist_last = 0.0
    s._persist()
    clock["t"] = go + 1_200_000                          # MC was down past red's 1000th point
    from _session import restart_no_repersist
    s2, _net2 = restart_no_repersist(s, clock)
    s2.resume_match()
    s2.tick()
    assert s2.phase == "recap" and s2.end_reason == "hold_target", (s2.phase, s2.end_reason)
    by = ((s2.last_recap or {}).get("possession") or {}).get("by_team") or {}
    assert by.get(red["team_id"], 0) >= 1000, by


def test_the_phones_are_told_to_send_own_change_and_get_each_teams_points():
    """brx2's gate: the config a phone gets says `own_change: true` in Domination only (an older MC never says it, and
    rejects the fact). The live score push carries each team's hill points from the owner timeline."""
    s, net, clock = _live("domination", 1000)
    assert s._wire_config().get("own_change") is True
    red, blue = s.config["teams"][0], s.config["teams"][1]
    go = s._m().head["go_live_t"]
    _own(s, net, clock, "node0", "util-a", 2, red["tid"], at=go + 10_000)
    clock["t"] = go + 70_000
    s._push_scores()
    teams = {t["team_id"]: t for t in net.pushes("score")[-1][2]["board"]["teams"]}
    assert teams[red["team_id"]]["points"] == 60 and teams[blue["team_id"]]["points"] == 0, teams
    k, knet, kclock = _live("koth", 1000)
    assert "own_change" not in k._wire_config(), "CONTROL: KOTH"
    k._push_scores()
    assert all("points" not in t for t in knet.pushes("score")[-1][2]["board"]["teams"]), "CONTROL: KOTH has no points"


def test_a_resume_reads_each_replayed_step_at_its_own_time_not_now():
    """Chaos `domination-hills-target`: a resume replays the facts in arrival order to find when a target was reached.
    Read at "now", blue's capture alone (later drained) looked like 90 points and ended the match on a 30 target."""
    s, net, clock = _live("domination", 30, stored=True)
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    blue = s.config["teams"][1]
    go = s._m().head["go_live_t"]
    clock["t"] = go + 10_000
    _own(s, net, clock, "node1", "util-a", 2, blue["tid"])
    clock["t"] = go + 11_000
    _own(s, net, clock, "node1", "util-a", blue["tid"], 2)
    clock["t"] = go + 100_000
    s2, _net2 = restart_session(s, clock)
    assert s2.resume_match() == "live", s2.end_reason
    s2.tick()
    assert s2.phase == "live", (s2.phase, s2.end_reason)
    assert s2._m().scorer.possession()["by_team"][blue["team_id"]] == 1


def test_a_batch_from_a_phone_back_in_wifi_does_not_end_the_match_on_its_first_step():
    """Codex review 2026-11-07: a phone out of Wi-Fi delivers four steps at once. Checked per fact, its first capture
    alone read as owned until now (50 points on a 30 target) and ended the match; the tick checks after the batch."""
    s, net, clock = _live("domination", 30)
    red, blue = s.config["teams"][0], s.config["teams"][1]
    go, mid = s._m().head["go_live_t"], s._m().head["match_id"]
    site = str(s.station_registry.stations["util-a"]["assigned"]["id"])
    steps = [(10_000, 2, red["tid"]), (20_000, red["tid"], 2), (30_000, 2, blue["tid"]), (40_000, blue["tid"], 2)]
    clock["t"] = go + 60_000
    net.simulate_batch("node0", [{"type": "own_change", "t": go + at, "match_id": mid, "site": site, "from_tid": f,
                                  "owner_tid": o, "at_ms": go + at, "seq": 7000 + i} for i, (at, f, o) in enumerate(steps)],
                       clock["t"])
    s.tick()
    assert s.phase == "live", (s.phase, s.end_reason)
    assert s._m().scorer.possession()["by_team"] == {red["team_id"]: 10, blue["team_id"]: 10}



def test_a_possession_fact_inside_a_batch_does_not_end_the_match_on_a_half_built_timeline():
    """Codex review of the phone half (2026-11-07): a phone back in Wi-Fi sends red's capture at 10 s, a possession
    tally at 30 s and the drain at 40 s as one batch. The tally's own target check read the timeline with only the
    capture in it (red 90 points on a 60 target) and the match ended. In Domination every target check is the tick's."""
    s, net, clock = _live("domination", 60)
    red = s.config["teams"][0]
    go, mid = s._m().head["go_live_t"], s._m().head["match_id"]
    site = str(s.station_registry.stations["util-a"]["assigned"]["id"])
    ev = lambda at, **b: {"t": go + at, "match_id": mid, **b}
    batch = [ev(10_000, type="own_change", site=site, from_tid=2, owner_tid=red["tid"], at_ms=go + 10_000, seq=7100),
             ev(30_000, type="possession", site=site, hold_ms={str(red["tid"]): 20_000}, observed_ms=30_000, seq=7101),
             ev(40_000, type="own_change", site=site, from_tid=red["tid"], owner_tid=2, at_ms=go + 40_000, seq=7102)]
    clock["t"] = go + 100_000
    net.simulate_batch("node0", batch, clock["t"])
    s.tick()
    assert s.phase == "live", (s.phase, s.end_reason)
    assert s._m().scorer.possession()["by_team"][red["team_id"]] == 30


def test_a_domination_match_scored_from_tallies_alone_still_ends_on_its_target():
    """Phones older than OWN_CHANGE_MIN_APP send only possession tallies. A tally no longer checks the target itself, so
    the tick must cover a match with no own_change at all."""
    s, net, clock = _live("domination", 60)
    red = s.config["teams"][0]
    go, mid = s._m().head["go_live_t"], s._m().head["match_id"]
    site = str(s.station_registry.stations["util-a"]["assigned"]["id"])
    clock["t"] = go + 70_000
    net.simulate_event("node0", {"type": "possession", "t": clock["t"], "match_id": mid, "site": site,
                                 "hold_ms": {str(red["tid"]): 61_000}, "observed_ms": 70_000}, clock["t"], seq=7200)
    s.tick()
    assert s.phase == "recap" and s.end_reason == "hold_target", (s.phase, s.end_reason)

def test_an_own_change_stamped_outside_the_match_is_refused():
    """Codex review: a step stamped long before go-live fabricated points from go-live, and one stamped after MC received
    it stood as the site's only fact and blanked the phones' tally for it."""
    s, net, clock = _live("domination", 1000)
    red, blue = s.config["teams"][0], s.config["teams"][1]
    go = s._m().head["go_live_t"]
    clock["t"] = go + 100_000
    site_a = str(s.station_registry.stations["util-a"]["assigned"]["id"])
    net.simulate_event("node0", {"type": "possession", "t": clock["t"], "match_id": s._m().head["match_id"],
                                 "site": site_a, "hold_ms": {str(red["tid"]): 80_000}, "observed_ms": 90_000},
                       clock["t"], seq=4100)
    _own(s, net, clock, "node1", "util-b", 2, red["tid"], at=1)                         # far past
    net.simulate_event("node1", {"type": "own_change", "t": clock["t"], "match_id": s._m().head["match_id"],
                                 "site": site_a, "from_tid": 2, "owner_tid": blue["tid"], "at_ms": go + 10_000_000},
                       clock["t"], seq=4101)                                            # far future
    poss = s._m().scorer.possession()
    assert poss["by_team"] == {red["team_id"]: 80, blue["team_id"]: 0}, poss


def test_one_score_push_builds_each_hills_timeline_once():
    """Codex review 2026-11-07: every player's push rebuilt every hill's timeline (1.8 s for 20 phones late in a long
    match). The board is built once per push, and the timeline is cached by its facts and its end."""
    from brx_mcp.mc import scoring
    s, net, clock = _live("domination", 1000)
    red = s.config["teams"][0]
    go = s._m().head["go_live_t"]
    _own(s, net, clock, "node0", "util-a", 2, red["tid"], at=go + 1_000)
    _own(s, net, clock, "node1", "util-b", 2, red["tid"], at=go + 2_000)
    clock["t"] = go + 50_000
    calls = []
    real = scoring.owned_ms
    scoring.owned_ms = lambda *a, **k: (calls.append(1), real(*a, **k))[1]
    try:
        s._push_scores()
    finally:
        scoring.owned_ms = real
    assert len(net.pushes("score")) >= 2 and len(calls) == 2, (len(net.pushes("score")), len(calls))

def test_an_old_apk_with_no_own_change_scores_its_hill_from_the_possession_tally():
    """A phone older than OWN_CHANGE_MIN_APP sends only `possession`: that site keeps today's merge, and a site with
    own_change facts uses the timeline."""
    s, net, clock = _live("domination", 1000)
    red, blue = s.config["teams"][0], s.config["teams"][1]
    go = s._m().head["go_live_t"]
    clock["t"] = go + 100_000
    site_b = str(s.station_registry.stations["util-b"]["assigned"]["id"])
    net.simulate_event("node0", {"type": "possession", "t": clock["t"], "match_id": s._m().head["match_id"],
                                 "site": site_b, "hold_ms": {str(red["tid"]): 40_000}, "observed_ms": 90_000},
                       clock["t"], seq=4000)
    _own(s, net, clock, "node1", "util-a", 2, blue["tid"], at=go + 50_000)
    r = str(red["tid"])
    _beat(s, net, clock, "util-c", red["tid"], {r: 1}, {r: 90_000})   # a Stick nobody's phone reports: its clock is no score
    poss = s._m().scorer.possession()
    assert poss["by_team"] == {red["team_id"]: 40, blue["team_id"]: 50}, poss

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
    seconds) said a tie although red crossed the target and ended the match. The rule is shared; since Domination is
    scored from the phones (2026-11-07) the stations' presence clocks drive it here, in KOTH."""
    s, net, clock = _live("koth", 1000)
    red, blue = s.config["teams"][0], s.config["teams"][1]
    r, b = str(red["tid"]), str(blue["tid"])
    clock["t"] += 1_100_000
    _beat(s, net, clock, "util-c", blue["tid"], {b: 999_600}, None)
    _beat(s, net, clock, "util-a", red["tid"], {r: 500_000}, None)
    assert s.phase == "live", "CONTROL: nobody has crossed yet"
    _beat(s, net, clock, "util-b", red["tid"], {r: 500_000}, None)
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
    go = s._m().head["go_live_t"]
    _own(s, net, clock, "node0", "util-a", 2, red["tid"], at=go)
    clock["t"] = go + 1_000_000
    s.tick()
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
    The empty in-play beat is the base now; the late gain is bounded by the time from that beat to the whistle. Since
    Domination is scored from the phones (2026-11-07) the station rule is KOTH's, so the test runs in KOTH."""
    s, net, clock = _live("koth", 1000)
    red = s.config["teams"][0]
    r = str(red["tid"])
    clock["t"] += 100_000
    _beat(s, net, clock, "util-a", 2, {}, None)                  # heard in play: nobody owns it yet
    clock["t"] += 3_000
    _beat(s, net, clock, "util-a", 2, {}, None)                  # beats on (the first may sit in the arming window)
    heard_at = clock["t"]
    clock["t"] += 60_000                                       # out of Wi-Fi; red captures it and holds it
    s.control("end")
    end = clock["t"]
    assert s.phase == "recap", s.phase
    clock["t"] += 20_000
    _beat(s, net, clock, "util-a", red["tid"], {r: 50_000}, None)   # back in Wi-Fi after the whistle
    clock["t"] += 3_000
    _beat(s, net, clock, "util-a", red["tid"], {r: 50_000}, None)   # past the relock's window
    poss = (s.last_recap or {}).get("possession") or {}
    assert poss.get("by_team", {}).get(red["team_id"]) == 50, (poss, end - heard_at)



def test_a_late_hill_report_on_an_empty_base_survives_a_restart_in_recap():
    """Codex pass 2026-11-07: the empty in-play base was not a history row, so a restart in RECAP replayed the late
    report as in play, the whistle moved it back, no in-play row was found and the hill's points went: red 50 to 40
    became blue 40 to 0. KOTH since Domination is scored from the phones (2026-11-07)."""
    import pathlib
    import tempfile
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    s, net, clock = _live("koth", 1000)
    r, b = (str(t["tid"]) for t in s.config["teams"])
    clock["t"] += 100_000
    _beat(s, net, clock, "util-a", 2, {}, None)
    clock["t"] += 3_000
    _beat(s, net, clock, "util-a", 2, {}, None)                         # heard in play, nobody owns it
    _beat(s, net, clock, "util-b", int(b), {b: 40_000}, None)
    clock["t"] += 60_000                                                # util-a out of Wi-Fi; red captures it
    s.control("end")
    clock["t"] += 20_000
    _beat(s, net, clock, "util-a", int(r), {r: 50_000}, None)
    clock["t"] += 3_000
    _beat(s, net, clock, "util-a", int(r), {r: 50_000}, None)
    before = (s.last_recap["possession"]["by_team"], s.last_recap["winner"])
    assert before == ({"red": 50, "blue": 40}, {"team_id": "red"}), before
    path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path, s._persist_last, s._persist_dirty = path, 0.0, True
    s.persist_now()
    import json
    raw = path.read_text()

    def strip_empty_rows(node):   # a snapshot written before the empty base became a history row
        if isinstance(node, dict):
            if isinstance(node.get("station_history"), dict):
                node["station_history"] = {k: [r for r in rows if r[1]] for k, rows in node["station_history"].items()}
            for v in node.values():
                strip_empty_rows(v)
    old = json.loads(raw)
    strip_empty_rows(old)
    for text, label in ((raw, "this MC's snapshot"), (json.dumps(old), "an older MC's snapshot (no empty history row)")):
        path.write_text(text)
        s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=lambda: clock["t"])
        s2._persist_path = path
        s2.restore_snapshot()
        assert s2.resume_match() == "recap", label
        after = (s2.last_recap["possession"]["by_team"], s2.last_recap["winner"])
        assert after == before, (label, before, after)

def _scorer(hold_target_s=None):
    from brx_mcp.mc.scoring import Scorer
    t0, now = 1_000_000, {"t": 1_000_000}
    teams = [{"team_id": "red", "name": "R", "color": "#f00", "tid": 0}, {"team_id": "blue", "name": "B", "color": "#00f", "tid": 1}]
    sc = Scorer("m1", t0, 1800, "koth", {}, teams, {}, {}, now_ms=lambda: now["t"], win_by="objective",
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



def test_an_empty_base_still_in_play_survives_a_whistle_moved_between_two_empty_beats():
    """Codex pass round 2: empty beats at 100 s and 200 s, then the whistle moves to 150 s. The 100 s beat was in play
    and stays the base, so a later 40 s report scores (bounded by 150 - 100 s); it was "unverified" and scored nothing."""
    sc, now, t0 = _scorer()
    now["t"] = t0 + 100_000
    sc.station_possession("1", {}, seen_ms=t0 + 100_000)
    now["t"] = t0 + 200_000
    sc.station_possession("1", {}, seen_ms=t0 + 200_000)
    sc.set_end(t0 + 150_000)
    now["t"] = t0 + 210_000
    sc.station_possession("1", {0: 40_000}, seen_ms=t0 + 210_000)
    assert "1" not in sc.station_unverified, sc.station_unverified
    assert sc.possession()["by_team"]["red"] == 40, (sc.possession(), sc.station_possession_ms)

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
