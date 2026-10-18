"""F555: a station hill is scored on the STATION's own `hold_ms`; the phones' possession is the cross-check.

`docs/spec/utility.md` §5d.6 makes the station self-authoritative, with the players' facts as the check. MC did it the
other way round: `Scorer.winner()` and the hold target read only the phones' `possession` facts, and the station's
tally reached nothing but the recap's stations row (field 2026-10-17, report §3.7 "Four more hill bugs" item 1). A
phone cannot see who is alive on the point (F554), so its tally pays an owner the station no longer pays.

Run: python3 run_tests.py mc_hill_authority
"""
import json
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
    s.station_registry.stations["util-hill"]["last_seen_ms"] = clock["t"]   # heard at the whistle: a fresh reading
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
    assert s._station_hold("util-hill")[:2] == (str(sid), {str(red["tid"]): 30_000}), "CONTROL"
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


def test_milestone_a_stale_station_reading_does_not_outrank_growing_phones():
    """Opus (seam 5): a hill heard once at 2:00 and never again must not decide its site over phones that kept counting."""
    s, pid, red, _blue = _koth()
    sc = _scorer(s, time_limit_s=600, nodes=[("n1", pid)])   # the scorer's clock reads the whistle (1_000_000 + 600 s)
    sc.station_possession("9", {str(red["tid"]): 60_000}, seen_ms=1_000_000 + 120_000)   # last heard at 2:00
    sc.ingest("n1", _poss({str(red["tid"]): 400_000}), 1_100_000)
    assert sc.possession()["by_team"][red["team_id"]] == 400, "a stale station reading outranked the phones"
    # CONTROL: heard near the whistle, the station decides even against larger phone readings
    sc.station_possession("9", {str(red["tid"]): 70_000}, seen_ms=1_000_000 + 590_000)
    assert sc.possession()["by_team"][red["team_id"]] == 70


def test_milestone_an_adopted_match_does_not_clamp_hill_time_to_an_untrusted_clock():
    """Codex and Opus (seam 5): an adopted match's draft time limit and its go-live (often `now` at adoption) are guesses,
    so neither may cap a hill's tally."""
    s, pid, red, _blue = _koth()
    sc = _scorer(s, time_limit_s=600, nodes=[("n1", pid)])
    sc.clock_trusted = False
    sc.station_possession("9", {str(red["tid"]): 660_000})
    sc.ingest("n1", _poss({str(red["tid"]): 700_000}, site="A"), 1_100_000)
    poss = sc.possession()
    assert poss["by_team"][red["team_id"]] == 660 + 700, poss
    # CONTROL: a match MC scheduled clamps both to the 600 s it ran
    sc2 = _scorer(s, time_limit_s=600, nodes=[("n1", pid)])
    sc2.station_possession("9", {str(red["tid"]): 660_000})
    assert sc2.possession()["by_team"][red["team_id"]] == 600


def test_milestone_an_adopted_session_marks_its_scorer_untrusted():
    s, net, clock, ps, info, sid = _live_koth_with_station()
    assert s._m().scorer.clock_trusted is True, "a match MC scheduled trusts its clock"
    assert s._scorer_like(s._m().scorer).clock_trusted is True
    s._m().scorer.clock_trusted = False
    assert s._scorer_like(s._m().scorer).clock_trusted is False, "a rescore of an adopted match trusted its clock again"


def test_milestone_the_station_view_shows_the_pace_each_hill_runs():
    """Opus (seam 2): the phone reports capture_s/net_cap in status.control; MC dropped them, so ITEMS could not show the
    pace a hill really runs after a CLEAR (A77: absent keeps the station's own)."""
    s, net, clock, ps, info, sid = _live_koth_with_station()
    body = {"role": "utility", "kind": "control", "station_id": sid,
            "control": {"owner": 0, "progress": 100, "contested": False, "capture_s": 20, "net_cap": 2}}
    net.simulate_status("util-hill", body, clock["t"])
    c = s.station_registry.station_view("util-hill")["report"]["control"]
    assert (c["capture_s"], c["net_cap"]) == (20, 2), c
    body["control"] = {"owner": 0, "capture_s": 120, "net_cap": 12}   # outside A77's bounds: dropped
    net.simulate_status("util-hill", body, clock["t"] + 2_000)
    c = s.station_registry.station_view("util-hill")["report"]["control"]
    assert "capture_s" not in c and "net_cap" not in c, c


# ---- milestone round 3: a late reading after an early END, and freshness that survives a restart ----
def _ended_koth(time_limit_s=1200, end_at_s=600):
    """A scorer whose match ENDED early at `end_at_s` (an operator END moves end_t) and whose clock is past it."""
    s, pid, red, blue = _koth()
    clock = {"t": 1_000_000 + end_at_s * 1000}
    sc = Scorer("m1", 1_000_000, time_limit_s, "koth", s.players, s.teams, {"n1": pid}, {"n1": True},
                now_ms=lambda: clock["t"], win_by="objective")
    return s, pid, red, blue, sc, clock


def test_r3_a_late_reading_may_add_only_the_window_before_the_end():
    """brx1 (milestone): a muster Stick that missed an early END counts on; its late RECAP report may raise a team only by
    the time between MC's last heartbeat from it and the whistle, never by post-END hold."""
    s, pid, red, blue, sc, clock = _ended_koth()
    sc.station_possession("9", {str(red["tid"]): 180_000, str(blue["tid"]): 240_000}, 1_000_000 + 570_000,
                          seen_ms=1_000_000 + 570_000)          # last heard 30 s before the END
    sc.set_end(1_000_000 + 600_000)                              # the operator's early END at 10:00
    clock["t"] = 1_000_000 + 900_000
    sc.station_possession("9", {str(red["tid"]): 270_000, str(blue["tid"]): 240_000}, seen_ms=1_000_000 + 900_000)   # late
    by = sc.possession()["by_team"]
    assert by[red["team_id"]] == 210 and by[blue["team_id"]] == 240, by   # +30 s at most, not +90 s
    # a second late report cannot compound the window
    sc.station_possession("9", {str(red["tid"]): 300_000}, seen_ms=1_000_000 + 950_000)
    assert sc.possession()["by_team"][red["team_id"]] == 210


def test_r3_the_window_is_shared_between_teams():
    s, pid, red, blue, sc, clock = _ended_koth()
    sc.station_possession("9", {str(red["tid"]): 100_000, str(blue["tid"]): 100_000}, seen_ms=1_000_000 + 580_000)
    sc.set_end(1_000_000 + 600_000)
    clock["t"] = 1_000_000 + 900_000
    sc.station_possession("9", {str(red["tid"]): 200_000, str(blue["tid"]): 200_000}, seen_ms=1_000_000 + 900_000)
    by = sc.possession()["by_team"]
    assert by[red["team_id"]] + by[blue["team_id"]] <= 220, by        # 20 s of window in all, not 20 s each


def test_r3_a_station_never_heard_in_play_does_not_score_and_its_row_is_flagged():
    s, net, clock, ps, info, sid = _live_koth_with_station()
    red = s.config["teams"][0]
    net.simulate_event("node0", {"type": "possession", "match_id": info["match_id"], "node_id": "node0",
                                 "player_id": ps[0]["player_id"], "t": clock["t"], "site": str(sid),
                                 "hold_ms": {str(red["tid"]): 50_000}, "observed_ms": 50_000}, clock["t"], seq=1)
    s.control("end")
    clock["t"] += 60_000
    _beat(net, clock, sid, {str(red["tid"]): 500_000})              # first heard in RECAP: nothing to bound it by
    r = s.last_recap
    assert r["possession"]["by_team"][red["team_id"]] == 50, r["possession"]   # the phones decide the site
    row = next(x for x in r["stations"] if x["id"] == sid)
    assert row.get("unverified") is True, row


def test_r3_freshness_is_the_tally_receipt_not_any_hello():
    """Codex round 2: a HELLO refreshes last_seen_ms; only a tally MC received makes a station's reading fresh."""
    s, net, clock, ps, info, sid = _live_koth_with_station()
    red = s.config["teams"][0]
    _beat(net, clock, sid, {str(red["tid"]): 60_000})               # heard at 2:00
    clock["t"] = info["go_live_t"] + 590_000
    net.simulate_utility_hello("util-hill")                         # a bare hello near the whistle, no tally
    got = s._station_hold("util-hill")
    assert got is not None and got[2] is not None and got[2] < info["go_live_t"] + 200_000, got


def test_r3_a_restart_keeps_the_staleness_and_the_end_cap():
    """Opus and Codex round 2: the snapshot carries when each station's reading was received, and the pre-END reading."""
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
    blue = s.config["teams"][1]
    clock["t"] = info["go_live_t"] + 100_000
    _beat(net, clock, sid, {str(blue["tid"]): 50_000})
    sc = s._m().scorer
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last = 0.0
    s._persist()
    s2, _net2 = restart_no_repersist(s, clock)
    assert s2.resume_match() == "live"
    sc2 = s2._m().scorer
    assert sc2.station_seen_ms.get(str(sid)) == sc.station_seen_ms.get(str(sid)), (sc2.station_seen_ms, sc.station_seen_ms)
    assert sc2.station_pre_end.get(str(sid)) == sc.station_pre_end.get(str(sid)), (sc2.station_pre_end, sc.station_pre_end)


def test_r4_a_kill_cap_pulling_the_end_earlier_rebounds_the_station_reading():
    """Codex round 3: a station reading received at 1:50 kept its hold when a late kill fact moved the whistle back to
    1:30. The site is re-bounded from the last reading at or before the new end, plus at most the time to that end."""
    s, pid, red, blue, sc, clock = _ended_koth(end_at_s=110)
    sc.station_possession("9", {str(red["tid"]): 60_000}, seen_ms=1_000_000 + 80_000)
    sc.station_possession("9", {str(red["tid"]): 90_000}, seen_ms=1_000_000 + 110_000)
    assert sc.possession()["by_team"][red["team_id"]] == 90
    sc.set_end(1_000_000 + 90_000)                       # the capping kill, heard late, happened at 1:30
    assert sc.possession()["by_team"][red["team_id"]] == 70, sc.station_possession_ms   # 60 s + 10 s, not 90 s
    # a later report from the same station is a late reading against the new end, and cannot compound it
    sc.station_possession("9", {str(red["tid"]): 120_000}, seen_ms=1_000_000 + 130_000)
    assert sc.possession()["by_team"][red["team_id"]] == 70


def test_r4_a_site_first_heard_after_the_moved_end_is_unverified():
    s, pid, red, blue, sc, clock = _ended_koth(end_at_s=110)
    sc.ingest("n1", _poss({str(red["tid"]): 40_000}), 1_050_000)
    sc.station_possession("9", {str(red["tid"]): 90_000}, seen_ms=1_000_000 + 105_000)
    sc.set_end(1_000_000 + 90_000)
    assert sc.possession()["by_team"][red["team_id"]] == 40, sc.station_possession_ms   # the phones decide it
    assert "9" in sc.station_unverified


def test_r4_the_reading_history_survives_an_mc_restart():
    """After a restart, a kill fact that moves the end earlier still finds the reading at or before it."""
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
    blue = s.config["teams"][1]
    clock["t"] = info["go_live_t"] + 80_000
    _beat(net, clock, sid, {str(blue["tid"]): 60_000})
    clock["t"] = info["go_live_t"] + 110_000
    _beat(net, clock, sid, {str(blue["tid"]): 90_000})
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last = 0.0
    s._persist()
    s2, _net2 = restart_no_repersist(s, clock)
    assert s2.resume_match() == "live"
    sc2 = s2._m().scorer
    sc2.set_end(info["go_live_t"] + 90_000)
    assert sc2.station_possession_ms[str(sid)][blue["tid"]] == 70_000, sc2.station_possession_ms


def _legacy_restart(after_s, save_at_s=None, history=None):
    """A KOTH match with one hill heard at 1:40 whose snapshot predates round 3: the tally has no receipt time and the
    match carries no station_seen, station_pre_end or station_history. MC comes back `after_s` after go-live."""
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
    blue = s.config["teams"][1]
    clock["t"] = info["go_live_t"] + 100_000
    _beat(net, clock, sid, {str(blue["tid"]): 50_000})
    if save_at_s is not None:
        clock["t"] = info["go_live_t"] + save_at_s * 1000
    s._persist_path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last = 0.0
    s._persist()
    snap = json.loads(s._persist_path.read_text())
    snap["station_locks"]["util-hill"]["tally"].pop("at")
    for key in ("station_seen", "station_pre_end", "station_history"):
        snap["match"].pop(key)
    if history is not None:
        snap["match"]["station_history"] = history(sid, blue)
    s._persist_path.write_text(json.dumps(snap))
    clock["t"] = info["go_live_t"] + after_s * 1000
    s2, net2 = restart_no_repersist(s, clock)
    return s2, net2, clock, info, sid, blue


def test_r4_a_pre_upgrade_tally_is_stamped_with_the_snapshot_time():
    """Codex round 3: a tally saved before round 3 has no receipt time. It was received at or before the snapshot was
    written, so it counts as heard then (never after the whistle), and a heard hill is not flagged unverified."""
    s2, net2, clock, info, sid, blue = _legacy_restart(after_s=300)
    assert s2.resume_match() == "live"
    sc = s2._m().scorer
    assert sc.station_seen_ms.get(str(sid)) == info["go_live_t"] + 100_000, sc.station_seen_ms
    assert str(sid) not in sc.station_unverified


def test_r4_a_pre_upgrade_tally_after_the_whistle_keeps_its_hill_verified():
    """MC comes back after the time limit. A later report of the hill is bounded by the window before the whistle (the
    restarted MC has no arming to key a live beat to, so the report reaches the scorer directly), and the hill MC heard in
    play is not unverified."""
    s2, net2, clock, info, sid, blue = _legacy_restart(after_s=700)
    assert s2.resume_match() == "recap"
    sc = s2._m().scorer
    sc.station_possession(str(sid), {str(blue["tid"]): 80_000}, seen_ms=clock["t"] + 10_000)
    assert str(sid) not in sc.station_unverified, sc.station_unverified
    assert sc.station_possession_ms[str(sid)][blue["tid"]] == 80_000, sc.station_possession_ms   # 30 s within 500 s


def test_r4_an_operator_end_after_a_clock_step_back_keeps_the_hill():
    """An operator END is NOW: every reading MC already holds was received before it, even when the WSL clock stepped back
    (F451) and the END's time is earlier than the last tally's receipt. Only a fact's time moving the whistle earlier
    (a kill cap, a hold target, a rescore freeze) re-bounds a station."""
    s, net, clock, ps, info, sid = _live_koth_with_station()
    red = s.config["teams"][0]
    clock["t"] = info["go_live_t"] + 120_000
    _beat(net, clock, sid, {str(red["tid"]): 90_000})
    clock["t"] -= 5_000                                             # the clock steps back
    s.control("end")
    r = s.last_recap
    assert r["possession"]["by_team"][red["team_id"]] == 90, r["possession"]
    assert not next(x for x in r["stations"] if x["id"] == sid).get("unverified"), r["stations"]


def test_r4_a_pre_upgrade_tally_saved_after_the_whistle_is_unverified():
    """Codex review r4: a tally with no receipt time in a snapshot written after the whistle may hold post-END time, and
    nothing shows MC heard it in play. It does not score; the phones decide the site."""
    s2, net2, clock, info, sid, blue = _legacy_restart(after_s=700, save_at_s=650)
    s2.resume_match()
    sc = s2._m().scorer
    assert str(sid) in sc.station_unverified, sc.station_unverified
    assert str(sid) not in sc.station_possession_ms, sc.station_possession_ms


def test_r4_a_late_reading_already_bounded_is_bounded_again_when_the_end_moves_earlier():
    """Opus review r4: a late reading bounded against the old end left the receipt time at the in-play reading, so a kill
    cap that then moved the end earlier skipped the site."""
    s, pid, red, blue, sc, clock = _ended_koth()
    sc.station_possession("9", {str(red["tid"]): 100_000}, seen_ms=1_000_000 + 590_000)
    sc.set_end(1_000_000 + 600_000)
    clock["t"] = 1_000_000 + 620_000
    sc.station_possession("9", {str(red["tid"]): 120_000}, seen_ms=1_000_000 + 620_000)   # late: 100 + 10 s
    assert sc.possession()["by_team"][red["team_id"]] == 110
    sc.set_end(1_000_000 + 595_000)                     # a kill cap, heard late, at 9:55
    assert sc.possession()["by_team"][red["team_id"]] == 105, sc.station_possession_ms


def test_r4_restored_history_rows_are_sorted_and_usable():
    """Codex review r4: the restore keeps only rows with a reading, in receipt order."""
    def history(sid, blue):
        return {str(sid): [[5_090_000, {str(blue["tid"]): 40_000}], [5_050_000, {str(blue["tid"]): 20_000}],
                           [5_070_000, {}], ["x", {str(blue["tid"]): 1}], [True, {str(blue["tid"]): 1}]]}
    s2, net2, clock, info, sid, blue = _legacy_restart(after_s=300, history=history)
    s2.resume_match()
    rows = s2._m().scorer.station_history[str(sid)]
    assert [at for at, _per in rows] == sorted(at for at, _per in rows), rows
    assert [at for at, _per in rows][:2] == [5_050_000, 5_090_000], rows   # then the restored tally's own row


def test_r4_an_undated_tally_never_erases_a_reading_the_snapshot_already_timed():
    """Codex review r4 round 2: after one restart the snapshot holds the hill's timed reading, but the registry's tally can
    stay undated (the hill never beat again). A second restart from a snapshot saved after the whistle must keep the
    timed reading, not unverify the site."""
    s2, net2, clock, info, sid, blue = _legacy_restart(after_s=300)
    assert s2.resume_match() == "live"
    clock["t"] = info["go_live_t"] + 650_000
    s2._persist_last = 0.0
    s2._persist()
    clock["t"] = info["go_live_t"] + 700_000
    s3, _net3 = restart_no_repersist(s2, clock)
    s3.resume_match()
    sc = s3._m().scorer
    assert str(sid) not in sc.station_unverified, sc.station_unverified
    assert sc.station_possession_ms[str(sid)][blue["tid"]] == 50_000, sc.station_possession_ms


def test_r4_thinning_keeps_the_first_and_the_newest_rows_dense():
    """Opus r1 and Codex r2: thinning the whole list made the newest pre-END row coarse; it keeps the newest rows."""
    from brx_mcp.mc.scoring import STATION_HISTORY_MAX
    s, pid, red, blue, sc, clock = _ended_koth(time_limit_s=3600, end_at_s=3600)
    for i in range(STATION_HISTORY_MAX + 40):
        sc.station_possession("9", {str(red["tid"]): i * 1000}, seen_ms=1_000_000 + i * 1000)
    rows = sc.station_history["9"]
    assert len(rows) <= STATION_HISTORY_MAX, len(rows)
    assert rows[0][0] == 1_000_000, rows[0]
    newest = [at for at, _per in rows[-64:]]
    assert newest == [newest[0] + i * 1000 for i in range(64)], newest[:3]
