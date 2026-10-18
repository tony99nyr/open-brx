"""F555: a station hill is scored on the STATION's own `hold_ms`; the phones' possession is the cross-check.

`docs/spec/utility.md` §5d.6 makes the station self-authoritative, with the players' facts as the check. MC did it the
other way round: `Scorer.winner()` and the hold target read only the phones' `possession` facts, and the station's
tally reached nothing but the recap's stations row (field 2026-10-17, report §3.7 "Four more hill bugs" item 1). A
phone cannot see who is alive on the point (F554), so its tally pays an owner the station no longer pays.

Run: python3 run_tests.py mc_hill_authority
"""
import pathlib
import tempfile

from _session import mc_session, mk_session, mk_stored_session, online, restart_no_repersist
from brx_mcp.mc.scoring import Scorer

_sess = mc_session


def _scorer(session, time_limit_s=600, nodes=(), **kw):
    node_player = dict(nodes)
    return Scorer("m1", 1_000_000, time_limit_s, session.config["mode"], session.players, session.teams,
                  node_player, {n: True for n in node_player}, now_ms=lambda: 1_000_000 + time_limit_s * 1000,   # the whistle
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


def test_the_station_tally_at_the_whistle_decides_the_winner():
    """`_finish` hands each hill's final tally to the scorer before the rows freeze."""
    s, net, clock, ps, info, sid = _live_koth_with_station()
    red, blue = s.config["teams"][0], s.config["teams"][1]
    net.simulate_event("node0", {"type": "possession", "match_id": info["match_id"], "node_id": "node0",
                                 "player_id": ps[0]["player_id"], "t": clock["t"], "site": str(sid),
                                 "hold_ms": {str(red["tid"]): 200_000}, "observed_ms": 200_000}, clock["t"], seq=1)
    s.station_registry.stations["util-hill"]["tally"] = {"key": [s._game_byte(), "control", sid],
                                                         "hold_ms": {str(blue["tid"]): 90_000}, "revives": None}
    s.control("end")
    r = s.last_recap
    assert r["winner"] == {"team_id": blue["team_id"]}, r["winner"]
    assert r["possession"]["phones_by_team"][red["team_id"]] == 200, r["possession"]


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
    clock["t"] = info["go_live_t"] + 50_000
    body = {"role": "utility", "kind": "control", "station_id": sid,
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



def _live_koth_with_station(**cfg):
    s, net, clock, ps = mk_session(2)
    s.set_config({"mode": "koth", "time_limit_s": 600, **cfg})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    net.simulate_utility_hello("util-hill")
    s.set_station("util-hill", {"kind": "control"})
    s.push_config(force=True)
    info = s.start(runway_s=1, force=True)
    clock["t"] = info["go_live_t"] + 5_000
    s.tick()
    assert s.phase == "live", s.phase
    clock["t"] = info["go_live_t"] + 120_000   # two minutes played: a station reading is clamped to the time played
    sid = s.station_registry.stations["util-hill"]["assigned"]["id"]
    return s, net, clock, ps, info, sid


def _beat(net, clock, sid, hold_ms, station_id=None):
    body = {"role": "utility", "kind": "control", "station_id": sid if station_id is None else station_id,
            "control": {"owner": 0, "progress": 100, "contested": False, "hold_ms": hold_ms}}
    net.simulate_status("util-hill", body, clock["t"])


def test_a_previous_games_tally_never_reaches_this_match():
    """Opus and Codex reviews: the raw report and a heard recap row can still carry the last game's tally, and a merge
    that keeps the maximum could never take it out. Only the tally keyed to this match's arming counts."""
    s, net, clock, ps, info, sid = _live_koth_with_station()
    red, blue = s.config["teams"][0], s.config["teams"][1]
    st = s.station_registry.stations["util-hill"]
    st["tally"] = {"key": [s._game_byte() - 1 or 255, "control", sid], "hold_ms": {str(blue["tid"]): 500_000}, "revives": None}
    st["report"] = {**(st.get("report") or {}), "station_id": sid,
                    "control": {"owner": blue["tid"], "hold_ms": {str(blue["tid"]): 500_000}}}
    s._station_possession("util-hill", clock["t"])
    assert s._m().scorer.station_possession_ms == {}, "a previous game's tally scored in this match"
    net.simulate_event("node0", {"type": "possession", "match_id": info["match_id"], "node_id": "node0",
                                 "player_id": ps[0]["player_id"], "t": clock["t"], "site": str(sid),
                                 "hold_ms": {str(red["tid"]): 30_000}, "observed_ms": 30_000}, clock["t"], seq=1)
    assert s.recap()["winner"] == {"team_id": red["team_id"]}, "viewing the recap must not seed the stale row"
    # CONTROL: the tally keyed to this game's arming does count
    st["tally"]["key"] = [s._game_byte(), "control", sid]
    s._station_possession("util-hill", clock["t"])
    assert s.recap()["winner"] == {"team_id": blue["team_id"]}, s.recap()["winner"]


def test_a_station_reporting_another_id_is_not_this_points_authority():
    s, net, clock, ps, info, sid = _live_koth_with_station()
    red = s.config["teams"][0]
    clock["t"] += 3_000
    _beat(net, clock, sid, {str(red["tid"]): 10_000}, station_id=sid + 40)
    assert s._m().scorer.station_possession_ms == {}
    clock["t"] += 3_000
    _beat(net, clock, sid, {str(red["tid"]): 9_000})
    assert s._m().scorer.station_possession_ms == {str(sid): {red["tid"]: 9_000}}, \
        "the other id's 10 s must not have seeded this point's tally (Codex review)"


def test_an_empty_station_tally_does_not_silence_the_phones():
    s, pid, red, _blue = _koth()
    sc = _scorer(s, nodes=[("n1", pid)])
    sc.ingest("n1", _poss({str(red["tid"]): 40_000}), 1_100_000)
    assert sc.station_possession("9", {}) == "ignored"
    assert sc.possession()["by_team"][red["team_id"]] == 40 and "station_sites" not in sc.possession()


def test_a_beat_after_the_whistle_is_not_a_live_reading():
    s, net, clock, ps, info, sid = _live_koth_with_station()
    red = s.config["teams"][0]
    sc = s._m().scorer
    s.control("end")
    assert s.phase == "recap"
    s.station_registry.stations["util-hill"]["tally"] = {"key": [s._game_byte(), "control", sid],
                                                         "hold_ms": {str(red["tid"]): 60_000}, "revives": None}
    clock["t"] += 3_000
    s._station_possession("util-hill", clock["t"])    # a live-style call in RECAP is refused
    assert sc.station_possession_ms == {}, sc.station_possession_ms
    s._station_possession("util-hill", None)          # CONTROL: the whistle's final-word path (t None) does take it
    assert sc.station_possession_ms == {str(sid): {red["tid"]: 60_000}}


def test_the_hill_tally_survives_an_mc_restart():
    """Codex and Opus reviews: a resume rebuilds the scorer from stored facts, and a station's tally is not one. The
    stations' persisted tallies (`_keep_tally`) are fed back in, so the phones do not decide while the hill is quiet."""
    s, net, clock, ps = mk_stored_session(2, "koth")
    net.simulate_utility_hello("util-hill")
    s.set_station("util-hill", {"kind": "control"})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config(force=True)
    info = s.start(runway_s=1, force=True)
    clock["t"] = info["go_live_t"] + 5_000
    s.tick()
    sid = s.station_registry.stations["util-hill"]["assigned"]["id"]
    red, blue = s.config["teams"][0], s.config["teams"][1]
    clock["t"] = info["go_live_t"] + 100_000
    _beat(net, clock, sid, {str(blue["tid"]): 50_000})
    assert s._m().scorer.station_possession_ms == {str(sid): {blue["tid"]: 50_000}}
    net.simulate_event("node0", {"type": "possession", "match_id": info["match_id"], "node_id": "node0",
                                 "player_id": ps[0]["player_id"], "t": clock["t"], "site": str(sid),
                                 "hold_ms": {str(red["tid"]): 90_000}, "observed_ms": 90_000}, clock["t"], seq=1)
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last = 0.0
    s._persist()
    s2, _net2 = restart_no_repersist(s, clock)
    assert s2.resume_match() == "live"
    assert s2.recap()["winner"] == {"team_id": blue["team_id"]}, s2.recap()["winner"]



def test_a_station_tally_is_clamped_to_the_time_played():
    """brx3 review: an END at 5:00 of a 10:00 match, and a station that missed the relock and counted on, must not add
    the unplayed half when it reports late in RECAP."""
    s, net, clock, ps, info, sid = _live_koth_with_station()
    blue = s.config["teams"][1]
    clock["t"] = info["go_live_t"] + 300_000
    s.control("end")
    sc = s._m().scorer
    st = s.station_registry.stations["util-hill"]
    st["tally"] = {"key": [s._game_byte(), "control", sid], "hold_ms": {str(blue["tid"]): 550_000}, "revives": None}
    clock["t"] += 400_000
    s._station_possession("util-hill", None)
    held = sc.station_possession_ms[str(sid)][blue["tid"]]
    assert held <= 300_000, held



def test_a_hill_released_in_play_keeps_its_count_across_an_mc_restart():
    """Codex review: RELEASE removes the assignment and the tally; the departed row in the snapshot carries the count."""
    s, net, clock, ps = mk_stored_session(2, "koth")
    net.simulate_utility_hello("util-hill")
    s.set_station("util-hill", {"kind": "control"})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.push_config(force=True)
    info = s.start(runway_s=1, force=True)
    clock["t"] = info["go_live_t"] + 5_000
    s.tick()
    sid = s.station_registry.stations["util-hill"]["assigned"]["id"]
    red, blue = s.config["teams"][0], s.config["teams"][1]
    clock["t"] = info["go_live_t"] + 100_000
    _beat(net, clock, sid, {str(blue["tid"]): 50_000})
    assert s.release_station("util-hill")
    net.simulate_event("node0", {"type": "possession", "match_id": info["match_id"], "node_id": "node0",
                                 "player_id": ps[0]["player_id"], "t": clock["t"], "site": str(sid),
                                 "hold_ms": {str(red["tid"]): 90_000}, "observed_ms": 90_000}, clock["t"], seq=1)
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last = 0.0
    s._persist()
    s2, _net2 = restart_no_repersist(s, clock)
    assert s2.resume_match() == "live"
    assert s2.recap()["winner"] == {"team_id": blue["team_id"]}, s2.recap()["winner"]



def test_a_beat_naming_another_game_never_seeds_this_games_tally():
    """brx3 review: a beat sent before the station applied this arming carries the last game's count. The station names
    the game it counts under (`control.game`), and `_keep_tally` refuses another game's."""
    s, net, clock, ps, info, sid = _live_koth_with_station()
    red = s.config["teams"][0]
    old = s._game_byte() - 1 or 255
    clock["t"] += 3_000
    body = {"role": "utility", "kind": "control", "station_id": sid,
            "control": {"owner": red["tid"], "game": old, "hold_ms": {str(red["tid"]): 90_000}}}
    net.simulate_status("util-hill", body, clock["t"])
    assert s._m().scorer.station_possession_ms == {}, "the last game's count seeded this one"
    clock["t"] += 3_000
    body["control"] = {"owner": red["tid"], "game": s._game_byte(), "hold_ms": {str(red["tid"]): 4_000}}
    net.simulate_status("util-hill", body, clock["t"])
    assert s._m().scorer.station_possession_ms == {str(sid): {red["tid"]: 4_000}}, "CONTROL"


def test_a_stood_down_or_re_armed_hill_is_not_this_points_authority():
    s, net, clock, ps, info, sid = _live_koth_with_station()
    red = s.config["teams"][0]
    st = s.station_registry.stations["util-hill"]
    st["tally"] = {"key": [s._game_byte(), "control", sid], "hold_ms": {str(red["tid"]): 30_000}, "revives": None}
    assert s._station_hold("util-hill") == (str(sid), {str(red["tid"]): 30_000}), "CONTROL"
    armed = dict(st["armed"])
    st["armed"] = {**armed, "game": (s._game_byte() % 255) + 1}   # a newer arming that has not reseeded the tally
    assert s._station_hold("util-hill") is None
    st["armed"] = armed
    real = s.station_registry.stood_down
    s.station_registry.stood_down = lambda a: True   # type: ignore[method-assign]
    try:
        assert s._station_hold("util-hill") is None
    finally:
        s.station_registry.stood_down = real   # type: ignore[method-assign]



def test_lobby_time_never_seeds_the_hill_tally():
    """Opus review: a phone hill counts in the lobby under this match's game byte; only played time may seed the tally."""
    s, net, clock, ps = mk_session(2)
    s.set_config({"mode": "koth", "time_limit_s": 600})
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    net.simulate_utility_hello("util-hill")
    s.set_station("util-hill", {"kind": "control"})
    s.push_config(force=True)
    sid = s.station_registry.stations["util-hill"]["assigned"]["id"]
    red = s.config["teams"][0]
    clock["t"] += 5_000
    _beat(net, clock, sid, {str(red["tid"]): 40_000})
    assert not (s.station_registry.stations["util-hill"].get("tally") or {}).get("hold_ms"), "a lobby beat seeded the tally"



def test_f558_the_station_view_carries_the_hills_inputs():
    """F558 (field 2026-10-17): the station reported none of its inputs, so every rate question was inferred from slopes."""
    s, net, clock, ps, info, sid = _live_koth_with_station()
    body = {"role": "utility", "kind": "control", "station_id": sid,
            "control": {"owner": 0, "progress": 100, "contested": False, "net": 2, "counts": {"0": 3, "1": 1}, "lead": 0}}
    net.simulate_status("util-hill", body, clock["t"])
    c = s.station_registry.station_view("util-hill")["report"]["control"]
    assert (c["net"], c["counts"], c["lead"]) == (2, {"0": 3, "1": 1}, 0), c
    body["control"] = {"owner": 255, "net": True, "counts": {"0": -1}, "lead": None}
    net.simulate_status("util-hill", body, clock["t"] + 2_000)
    c = s.station_registry.station_view("util-hill")["report"]["control"]
    assert "net" not in c and "counts" not in c and c["lead"] is None, c
    body["control"] = {"owner": 255, "net": 9, "counts": {"7": 1}, "lead": 9}   # nothing a station can send
    net.simulate_status("util-hill", body, clock["t"] + 4_000)
    c = s.station_registry.station_view("util-hill")["report"]["control"]
    assert "net" not in c and "counts" not in c and "lead" not in c, c
