"""F555: a station hill is scored on the STATION's own `hold_ms`; the phones' possession is the cross-check.

`docs/spec/utility.md` §5d.6 makes the station self-authoritative, with the players' facts as the check. MC did it the
other way round: `Scorer.winner()` and the hold target read only the phones' `possession` facts, and the station's
tally reached nothing but the recap's stations row (field 2026-10-17, report §3.7 "Four more hill bugs" item 1). A
phone cannot see who is alive on the point (F554), so its tally pays an owner the station no longer pays.

Run: python3 run_tests.py mc_hill_authority
"""
from _session import mc_session, mk_session, online
from brx_mcp.mc.scoring import Scorer

_sess = mc_session


def _scorer(session, time_limit_s=600, nodes=(), **kw):
    node_player = dict(nodes)
    return Scorer("m1", 1_000_000, time_limit_s, session.config["mode"], session.players, session.teams,
                  node_player, {n: True for n in node_player}, now_ms=lambda: 1_000_000,
                  win_by=session.config["scoring"]["win_by"], **kw)


def _poss(hold_ms, site="9"):
    return {"type": "possession", "match_id": "m1", "t": 1_100_000, "hold_ms": hold_ms, "observed_ms": 300_000,
            "site": site}


def _row(hold_ms, sid=9):
    return {"node_id": f"util-{sid}", "kind": "control", "id": sid, "team": 255, "heard": True, "hold_ms": hold_ms}


def _koth():
    s = _sess("koth")
    pid = [p for p in s.players.values() if p.get("team_id")][0]["player_id"]
    red, blue = s.config["teams"][0], s.config["teams"][1]
    return s, pid, red, blue


def test_the_station_decides_a_site_and_the_phones_are_the_cross_check():
    s, pid, red, blue = _koth()
    sc = _scorer(s, nodes=[("n1", pid)])
    # the phone paid RED for the drain it could not see; the station paid BLUE more
    sc.ingest("n1", _poss({str(red["tid"]): 200_000, str(blue["tid"]): 50_000}), 1_100_000)
    assert sc.winner() == {"team_id": red["team_id"]}, "CONTROL: with no station reading the phones decide"
    sc.station_possession("9", {str(red["tid"]): 100_000, str(blue["tid"]): 150_000}, 1_200_000)
    assert sc.winner() == {"team_id": blue["team_id"]}, sc.winner()
    poss = sc.possession()
    assert poss["by_team"] == {red["team_id"]: 100, blue["team_id"]: 150}, poss
    assert poss["station_sites"] == 1, poss
    assert poss["phones_by_team"] == {red["team_id"]: 200, blue["team_id"]: 50}, poss


def test_a_site_with_no_station_reading_keeps_the_phones_tally():
    """A grenade hill (no site id) and a station never heard from have only the phones."""
    s, pid, red, blue = _koth()
    sc = _scorer(s, nodes=[("n1", pid)])
    sc.ingest("n1", _poss({str(red["tid"]): 80_000}, site=""), 1_100_000)
    sc.ingest("n1", _poss({str(blue["tid"]): 60_000}, site="9"), 1_100_000)
    sc.station_possession("9", {str(blue["tid"]): 30_000}, 1_200_000)
    poss = sc.possession()
    assert poss["by_team"] == {red["team_id"]: 80, blue["team_id"]: 30}, poss
    assert poss["station_sites"] == 1 and poss["phones_by_team"] == {red["team_id"]: 80, blue["team_id"]: 60}, poss


def test_a_station_reading_only_grows_and_is_clamped_to_the_match():
    s, pid, red, blue = _koth()
    sc = _scorer(s, time_limit_s=300, nodes=[("n1", pid)])
    sc.station_possession("9", {str(red["tid"]): 120_000}, 1_100_000)
    sc.station_possession("9", {str(red["tid"]): 40_000}, 1_150_000)   # a restarted Stick's lower report
    assert sc.possession()["by_team"][red["team_id"]] == 120
    sc.station_possession("9", {str(red["tid"]): 9_999_000, "2": 5_000, "x": 1, str(blue["tid"]): "bad"}, 1_200_000)
    poss = sc.possession()
    assert poss["by_team"] == {red["team_id"]: 300, blue["team_id"]: 0} and poss["neutral_s"] == 5, poss


def test_the_frozen_recap_rows_decide_the_winner_too():
    """`recap(stations=...)` carries the rows frozen at the whistle; they are the station's final word."""
    s, pid, red, blue = _koth()
    sc = _scorer(s, nodes=[("n1", pid)])
    sc.ingest("n1", _poss({str(red["tid"]): 200_000}), 1_100_000)
    r = sc.recap(stations=[_row({str(blue["tid"]): 90_000, str(red["tid"]): 10_000})])
    assert r["winner"] == {"team_id": blue["team_id"]}, r["winner"]
    assert r["possession"]["by_team"] == {red["team_id"]: 10, blue["team_id"]: 90}, r["possession"]
    # a row never heard from, or of another kind, decides nothing
    sc2 = _scorer(s, nodes=[("n1", pid)])
    sc2.ingest("n1", _poss({str(red["tid"]): 200_000}), 1_100_000)
    unheard = {**_row(None), "heard": False}
    respawn = {"node_id": "util-3", "kind": "respawn", "id": 9, "team": 0, "heard": True, "revives": 4}
    assert sc2.recap(stations=[unheard, respawn])["winner"] == {"team_id": red["team_id"]}


def test_the_station_tally_fires_the_hold_target():
    s, pid, red, _blue = _koth()
    fired: list[int] = []
    sc = Scorer("m1", 1_000_000, 600, "koth", s.players, s.teams, {"n1": pid}, {"n1": True},
                now_ms=lambda: 1_100_000, win_by="objective", hold_target_s=100, on_limit=fired.append)
    sc.station_possession("9", {str(red["tid"]): 60_000}, 1_100_000)
    assert fired == [], "under the target"
    sc.station_possession("9", {str(red["tid"]): 100_000}, 1_160_000)
    assert fired == [1_160_000], fired


def test_a_phone_report_past_the_target_does_not_fire_when_the_station_disagrees():
    s, pid, red, _blue = _koth()
    fired: list[int] = []
    sc = Scorer("m1", 1_000_000, 600, "koth", s.players, s.teams, {"n1": pid}, {"n1": True},
                now_ms=lambda: 1_100_000, win_by="objective", hold_target_s=100, on_limit=fired.append)
    sc.station_possession("9", {str(red["tid"]): 60_000}, 1_100_000)
    sc.ingest("n1", _poss({str(red["tid"]): 150_000}), 1_150_000)
    assert fired == [], fired


def test_a_station_reading_in_a_mode_with_no_hill_scores_nothing():
    """F535: a hill left armed from KOTH scores nothing in a mode with no hill."""
    s = _sess("tdm")
    sc = _scorer(s)
    sc.station_possession("9", {str(s.config["teams"][0]["tid"]): 60_000}, 1_100_000)
    assert sc.possession() is None
    assert "possession" not in sc.recap(stations=[_row({str(s.config["teams"][0]["tid"]): 60_000})])


def test_a_live_station_heartbeat_ends_the_match_on_the_hold_target():
    """The Session feeds a control station's heartbeat to the scorer while the match is live."""
    s, net, clock, ps = mk_session(2)
    s.set_config({"mode": "koth", "time_limit_s": 600, "scoring": {"hold_target_s": 60}})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    net.simulate_utility_hello("util-hill")
    s.set_station("util-hill", {"kind": "control"})
    s.push_config(force=True)
    info = s.start(runway_s=1, force=True)
    clock["t"] = info["go_live_t"] + 5_000
    s.tick()
    assert s.phase == "live", s.phase
    red = s.config["teams"][0]
    sid = s.station_registry.stations["util-hill"]["assigned"]["id"]
    body = {"role": "utility", "kind": "control", "id": sid, "game": None,
            "control": {"owner": red["tid"], "progress": 100, "contested": False, "hold_ms": {str(red["tid"]): 30_000}}}
    clock["t"] += 10_000
    net.simulate_status("util-hill", body, clock["t"])
    assert s.phase == "live", "under the target"
    clock["t"] += 10_000
    body["control"]["hold_ms"] = {str(red["tid"]): 61_000}
    net.simulate_status("util-hill", body, clock["t"])
    assert s.phase == "recap", s.phase
    assert s.end_reason == "hold_target", s.end_reason
    assert s.recap()["winner"] == {"team_id": red["team_id"]}, s.recap()["winner"]


def test_a_rescore_keeps_the_station_readings():
    """A replay rebuilds the board from stored facts; a station's tally is not one, so it carries over."""
    s, pid, red, blue = _koth()
    old = _scorer(s, nodes=[("n1", pid)])
    old.station_possession("9", {str(blue["tid"]): 90_000})
    new = s._scorer_like(old)
    new.ingest("n1", _poss({str(red["tid"]): 200_000}), 1_100_000)
    assert new.winner() == {"team_id": blue["team_id"]}, new.winner()
