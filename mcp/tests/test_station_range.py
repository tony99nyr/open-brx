"""A67 (F365): an operator edits a station's RANGE (threshold) or STRENGTH (tx_power) on the station itself, during
play, and MC keeps the last edit by time, per field.

Tony (2026-09-25): "if operator notices the range is too wide during gameplay, to long hold and be able to edit
it. if within wifi range sync with MC on the change." The station reports `<field>_src` and `<field>_edit_age_ms`;
MC dates the edit `t_recv - age` and adopts it when it is newer than MC's own value. MC's `station_config` carries
`<field>_age_ms`, and the station keeps its own edit only when that edit is younger. Each test pairs the
behaviour with a control on the same path.
"""
from __future__ import annotations

import pathlib
import tempfile

from brx_mcp.mc import envelope as E
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.types import ADOPT_SLACK_MS, STATION_EDIT_AGE_UNKNOWN_MS


class Clock:
    def __init__(self, t: int = 5_000_000):
        self.t = t

    def __call__(self) -> int:
        return self.t


def _sess():
    clock = Clock()
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=clock)
    s.set_config({"mode": "tdm", "time_limit_s": 600})
    guns = [g["gun_id"] for g in s.armory.list()][:2]
    teams = [t["team_id"] for t in s.config["teams"]]
    for i, g in enumerate(guns):
        s.add_player(f"P{i}", teams[i % len(teams)], g, "male")
    s.net.simulate_utility_hello("stick-1")
    s.set_station("stick-1", {"kind": "respawn", "team": "blue", "id": 3, "threshold": -57})
    return s, clock


def _cfg(s, nid="stick-1"):
    return [b for n, k, b in s.net.pushed if k == "station_config" and n == nid]


def _beat(s, clock, **fields):
    body = {"node_id": "stick-1", "arm_state": "connected", "synced": False, "role": "utility",
            "kind": "respawn", "team": 1, "station_id": 3, "armed": True, **fields}
    s.net.simulate_status("stick-1", body, clock.t)


def _a(s):
    return s.stations["stick-1"]["assigned"]


def _put(s, **range_fields):
    return s.set_station("stick-1", {"kind": "respawn", "team": 1, "id": 3, **range_fields})


def _feed(s):
    return [r["text"] for r in s.feed if r.get("tag") == "STATION"]


def test_the_last_edit_wins_both_ways_and_mc_sends_its_age():
    s, clock = _sess()
    set_at = clock.t
    assert _cfg(s)[-1]["threshold_age_ms"] == 0 and "tx_power" not in _cfg(s)[-1], "MC holds no strength yet"
    # CONTROL: an on-station edit OLDER than MC's value is not adopted (the station applies MC's on the next arm)
    clock.t += 60_000
    _beat(s, clock, threshold=-60, threshold_src="station", threshold_edit_age_ms=70_000)
    assert _a(s)["threshold"] == -57 and _a(s)["threshold_src"] == "mc"
    # a NEWER on-station edit is adopted, dated on MC's clock, and not re-armed (the station already has it)
    n = len(_cfg(s))
    _beat(s, clock, threshold=-60, threshold_src="station", threshold_edit_age_ms=20_000)
    assert _a(s)["threshold"] == -60 and _a(s)["threshold_src"] == "station"
    assert _a(s)["threshold_set_at"] == clock.t - 20_000 > set_at
    assert len(_cfg(s)) == n, "adoption must not push a station_config"
    v = s._station_view("stick-1")
    assert v["range"]["threshold_src"] == "station" and v["range"]["threshold_edit_age_ms"] == 20_000, v["range"]
    # the operator's console edit after it wins: source mc, set now, and the station is re-armed with the age
    clock.t += 5_000
    _put(s, threshold=-65)
    assert _a(s)["threshold"] == -65 and _a(s)["threshold_src"] == "mc" and _a(s)["threshold_set_at"] == clock.t
    assert len(_cfg(s)) == n + 1 and _cfg(s)[-1]["threshold"] == -65 and _cfg(s)[-1]["threshold_age_ms"] == 0
    # ...and a later station beat still carrying the OLD edit (its age has grown) changes nothing
    clock.t += 2_000
    _beat(s, clock, threshold=-60, threshold_src="station", threshold_edit_age_ms=27_000)
    assert _a(s)["threshold"] == -65
    # a re-arm later carries how old MC's value is by then
    clock.t += 30_000
    s.arm_stations()
    assert _cfg(s)[-1]["threshold_age_ms"] == 32_000
    for b in _cfg(s):
        E.validate(E.make_envelope("station_config", b), direction="mc")


def test_an_unchanged_re_put_does_not_beat_a_newer_station_edit():
    """ARM WITH CHANGES that changes only the kind, or a re-PUT of the same numbers, is not a RANGE edit."""
    s, clock = _sess()
    clock.t += 10_000
    _beat(s, clock, threshold=-62, threshold_src="station", threshold_edit_age_ms=1_000)
    edit_at = _a(s)["threshold_set_at"]
    clock.t += 10_000
    s.set_station("stick-1", {"kind": "respawn", "team": 1, "id": 4, "threshold": -62})   # a re-id; the draft follows the adoption
    assert _a(s)["threshold_src"] == "station" and _a(s)["threshold_set_at"] == edit_at
    assert _cfg(s)[-1]["threshold_age_ms"] == 11_000 + ADOPT_SLACK_MS
    # CONTROL: a different number IS an edit
    s.set_station("stick-1", {"kind": "respawn", "team": 1, "id": 4, "threshold": -50})
    assert _a(s)["threshold_src"] == "mc" and _cfg(s)[-1]["threshold_age_ms"] == 0


def test_threshold_and_tx_power_are_merged_independently():
    s, clock = _sess()
    clock.t += 10_000
    _put(s, threshold=-57, tx_power="high")
    assert _cfg(s)[-1]["tx_power"] == "high" and _cfg(s)[-1]["tx_power_age_ms"] == 0
    clock.t += 10_000
    # the station edits STRENGTH only; its threshold is MC's
    _beat(s, clock, threshold=-57, threshold_src="mc", tx_power="medium", tx_power_src="station", tx_power_edit_age_ms=3_000)
    assert _a(s)["tx_power"] == "medium" and _a(s)["tx_power_src"] == "station"
    assert _a(s)["threshold_src"] == "mc"
    # the operator then edits RANGE: STRENGTH stays the station's, and goes out with the station edit's age
    clock.t += 1_000
    _put(s, threshold=-66)
    assert _a(s)["tx_power"] == "medium" and _a(s)["tx_power_src"] == "station"
    assert _cfg(s)[-1]["threshold_age_ms"] == 0 and _cfg(s)[-1]["tx_power_age_ms"] == 4_000 + ADOPT_SLACK_MS
    # CONTROL: a bad strength is refused in the operator's voice, and leaves nothing behind
    try:
        _put(s, threshold=-66, tx_power="max")
        raise AssertionError("tx_power 'max' was accepted")
    except ValueError as e:
        assert "tx_power" in str(e)
    assert _a(s)["tx_power"] == "medium"


def test_an_offline_edit_syncs_when_the_station_reconnects():
    s, clock = _sess()
    set_at = clock.t
    clock.t += 120_000
    s.net.simulate_disconnect("stick-1")
    clock.t += 60_000                                      # out of Wi-Fi; the operator edits on the station
    clock.t += 30_000
    s.net.simulate_utility_hello("stick-1")                # back: MC arms it with its own value AND its age
    assert _cfg(s)[-1]["threshold"] == -57 and _cfg(s)[-1]["threshold_age_ms"] == clock.t - set_at
    # the station's edit is 30 s old (< MC's 210 s), so it keeps it and says so on the next beat
    _beat(s, clock, threshold=-61, threshold_src="station", threshold_edit_age_ms=30_000)
    assert _a(s)["threshold"] == -61 and _a(s)["threshold_src"] == "station"
    # CONTROL: had the station applied MC's value instead (src mc), MC changes nothing
    s2, c2 = _sess()
    c2.t += 5_000
    _beat(s2, c2, threshold=-57, threshold_src="mc")
    assert _a(s2)["threshold_src"] == "mc" and _a(s2)["threshold_set_at"] == c2.t - 5_000


def test_a_rebooted_sticks_large_age_loses_to_mc():
    """A Stick has no clock across a reboot, so it reports a LARGE age: MC's value wins, and the feed says the
    edit's time is lost instead of printing days."""
    s, clock = _sess()
    clock.t += 10_000
    _beat(s, clock, threshold=-60, threshold_src="station", threshold_edit_age_ms=STATION_EDIT_AGE_UNKNOWN_MS * 3,
          range_edits=[{"seq": 4, "field": "threshold", "from": -57, "to": -60, "locked": False,
                        "age_ms": STATION_EDIT_AGE_UNKNOWN_MS * 3}])
    assert _a(s)["threshold"] == -57 and _a(s)["threshold_src"] == "mc"
    assert _feed(s) == ["STATION #3 RANGE CHANGED -57 → -60 · BEFORE A RESTART"], _feed(s)


def test_range_edits_are_announced_once_each_in_the_feed_and_on_the_card():
    s, clock = _sess()
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    clock.t += 40_000
    e1 = {"seq": 1, "field": "threshold", "from": -57, "to": -60, "locked": True, "age_ms": 90_000}
    _beat(s, clock, range_edits=[e1])
    assert _feed(s) == ["STATION #3 RANGE CHANGED -57 → -60 (LOCKED) · 1 MIN AGO"], _feed(s)
    # the same edit on every later beat is not a new one (CONTROL for the dedupe: a new seq IS announced)
    clock.t += 2_000
    e2 = {"seq": 2, "field": "tx_power", "from": "high", "to": "medium", "locked": False, "age_ms": 1_000}
    _beat(s, clock, range_edits=[{**e1, "age_ms": 92_000}])
    assert len(_feed(s)) == 1
    _beat(s, clock, range_edits=[{**e1, "age_ms": 92_000}, e2])
    assert _feed(s)[0] == "STATION #3 STRENGTH CHANGED HIGH → MEDIUM · JUST NOW", _feed(s)
    assert len(_feed(s)) == 2
    v = s._station_view("stick-1")
    assert "RANGE EDITED ON STATION -57 → -60 (LOCKED)" in v["attention"], v["attention"]
    assert "STRENGTH EDITED ON STATION HIGH → MEDIUM" in v["attention"], v["attention"]
    assert [e["seq"] for e in v["range_edits"]] == [1, 2] and v["range_edits"][1]["age_ms"] == 1_000
    # a malformed row is dropped, not raised on every beat
    _beat(s, clock, range_edits=[{"seq": "x"}, {"seq": 3, "field": "tx_power", "from": "high", "to": "loud",
                                                "locked": False, "age_ms": 0}])
    assert len(_feed(s)) == 2
    # a reinstalled station counts from 1 again: a list whose top seq is below the mark starts a new count
    _beat(s, clock, range_edits=[{"seq": 1, "field": "threshold", "from": -57, "to": -50, "locked": False, "age_ms": 0}])
    assert _feed(s)[0].startswith("STATION #3 RANGE CHANGED -57 → -50"), _feed(s)


def _restart(s, clock):
    """A new MC process reading the old one's session.json."""
    from brx_mcp.mc.store import Store
    if s._persist_path is None:
        s._persist_path = pathlib.Path(tempfile.mkdtemp(prefix="brx-range-test-")) / "session.json"
    s._persist_last = 0.0
    s._persist()
    s2 = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=clock,
                 store=Store("t2", s._persist_path.parent / "s2.sqlite"))
    s2._persist_path = s._persist_path
    s2.restore_snapshot()
    return s2


def test_last_edit_wins_across_an_mc_restart_and_seen_edits_are_not_repeated():
    s, clock = _sess()
    clock.t += 10_000
    e1 = {"seq": 7, "field": "threshold", "from": -57, "to": -60, "locked": False, "age_ms": 1_000}
    _beat(s, clock, threshold=-60, threshold_src="station", threshold_edit_age_ms=1_000, range_edits=[e1])
    edit_at = _a(s)["threshold_set_at"]
    clock.t += 5_000
    _put(s, threshold=-60, tx_power="low")               # MC's strength, set after the station's range edit
    tx_at = clock.t
    assert len(_feed(s)) == 1
    previous_station_feed = _feed(s)
    clock.t += 60_000
    s2 = _restart(s, clock)
    a2 = s2.stations["stick-1"]["assigned"]
    assert a2["threshold"] == -60 and a2["threshold_src"] == "station" and a2["threshold_set_at"] == edit_at
    assert a2["tx_power_set_at"] == tx_at
    # the station comes back: MC arms it with the ages it held before the restart
    s2.net.simulate_utility_hello("stick-1")
    cfg = _cfg(s2)[-1]
    assert cfg["threshold_age_ms"] == clock.t - edit_at + ADOPT_SLACK_MS and cfg["tx_power_age_ms"] == clock.t - tx_at, cfg
    # a station beat still carrying an old strength edit (older than MC's) is not adopted after the restart
    _beat(s2, clock, tx_power="high", tx_power_src="station", tx_power_edit_age_ms=clock.t - tx_at + 1_000,
          range_edits=[{**e1, "age_ms": 66_000}])
    assert s2.stations["stick-1"]["assigned"]["tx_power"] == "low"
    assert _feed(s2) == previous_station_feed, "the earlier edit remains in the feed without being announced again"
    # CONTROL: a new seq after the restart IS announced
    _beat(s2, clock, range_edits=[{**e1, "age_ms": 66_000},
                                  {"seq": 8, "field": "threshold", "from": -60, "to": -58, "locked": False, "age_ms": 0}])
    assert _feed(s2) == ["STATION #3 RANGE CHANGED -60 → -58 · JUST NOW", *previous_station_feed], _feed(s2)


def test_a_range_only_put_is_allowed_in_play_and_re_arms_that_station_only():
    s, clock = _sess()
    s.net.simulate_hello("phone-0", s.players[next(iter(s.players))]["gun_id"])
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    for phase in ("armed", "live"):
        s.phase = phase
        s.net.pushed.clear()
        clock.t += 1_000
        v = _put(s, threshold=-50 if phase == "armed" else -52, tx_power="medium")
        assert v["assigned"]["threshold"] in (-50, -52) and _cfg(s) and _cfg(s)[-1]["tx_power"] == "medium"
        assert not [1 for _n, k, _b in s.net.pushed if k == "config"], "no HUD is re-armed for a range edit"
        # A66: the console sends no id (MC owns it); that is still a range-only change
        v = s.set_station("stick-1", {"kind": "respawn", "team": 1, "threshold": -54 if phase == "armed" else -56})
        assert v["assigned"]["threshold"] in (-54, -56) and v["assigned"]["id"] == 3, v["assigned"]
        # CONTROL: any other change is still refused in play
        try:
            s.set_station("stick-1", {"kind": "respawn", "team": 1, "id": 4, "threshold": -50})
            raise AssertionError("a re-id was accepted in play")
        except ValueError as e:
            assert phase.upper() in str(e)


# ---------------- polish round 1 ----------------

def test_an_adopted_edit_is_sent_back_older_than_the_stations_own_so_it_keeps_src_station():
    """MC dates an adopted edit `t_recv - age`, later than the true edit by the uplink latency. Sent back bare, the
    age is SMALLER than the station's own, so every A58 re-send made the station apply MC's equal value and flip
    its src to mc. While MC's source is the station, the age carries ADOPT_SLACK_MS."""
    s, clock = _sess()
    clock.t += 10_000
    _beat(s, clock, threshold=-60, threshold_src="station", threshold_edit_age_ms=2_000)   # true edit: older by latency
    clock.t += 30_000
    s.arm_stations()                                       # an A58 re-send (START, END, a lock change)
    station_age = 2_000 + 30_000
    assert _cfg(s)[-1]["threshold_age_ms"] > station_age, "the station's own edit must be the younger one"
    assert _cfg(s)[-1]["threshold_age_ms"] == station_age + ADOPT_SLACK_MS
    # CONTROL: MC's own value carries no slack
    _put(s, threshold=-66)
    clock.t += 5_000
    s.arm_stations()
    assert _cfg(s)[-1]["threshold_age_ms"] == 5_000


def test_strength_is_only_what_the_station_reports():
    s, clock = _sess()
    _put(s, threshold=-57, tx_power="high")
    clock.t += 1_000
    _beat(s, clock, threshold=-57, threshold_src="mc")    # a station that reports no strength (it cannot set one)
    assert "tx_power" not in s._station_view("stick-1").get("range", {}), "no STRENGTH from MC's record alone"
    # CONTROL: a reported strength is shown, even when it is not MC's
    _beat(s, clock, threshold=-57, threshold_src="mc", tx_power="medium", tx_power_src="mc")
    assert s._station_view("stick-1")["range"]["tx_power"] == "medium"


def test_a_report_that_differs_from_mcs_record_shows_the_stations_own_source_and_edit():
    s, clock = _sess()
    clock.t += 60_000
    # an on-station edit OLDER than MC's value: not adopted, but it is what the station applies right now
    _beat(s, clock, threshold=-61, threshold_src="station", threshold_edit_age_ms=70_000)
    r = s._station_view("stick-1")["range"]
    assert r["threshold"] == -61 and r["threshold_src"] == "station" and r["threshold_edit_age_ms"] == 70_000, r
    # CONTROL: once the station applies MC's value the card shows MC's record
    _beat(s, clock, threshold=-57, threshold_src="mc")
    r = s._station_view("stick-1")["range"]
    assert r["threshold"] == -57 and r["threshold_src"] == "mc" and "threshold_edit_age_ms" not in r, r


def test_a_kind_change_resets_the_range_to_the_new_kinds_default():
    s, clock = _sess()
    clock.t += 1_000
    s.set_station("stick-1", {"kind": "control", "team": "any", "id": 3, "threshold": -57})   # the draft still shows -57
    assert _a(s)["threshold"] == 0 and _a(s)["threshold_src"] == "mc"
    # CONTROL: a number the operator picks WITH the kind change is kept
    s.set_station("stick-1", {"kind": "respawn", "team": 1, "id": 3, "threshold": -65})
    assert _a(s)["threshold"] == -65


def test_an_unchanged_range_put_in_play_returns_the_view_not_a_refusal():
    s, clock = _sess()
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    n = len(_cfg(s))
    v = _put(s, threshold=-57)
    assert v["assigned"]["threshold"] == -57 and len(_cfg(s)) == n, "nothing moved, nothing sent"
    # CONTROL: a real change still refuses in play
    try:
        s.set_station("stick-1", {"kind": "respawn", "team": 1, "id": 9, "threshold": -57})
        raise AssertionError("a re-id was accepted in play")
    except ValueError:
        pass


def _edit_beat(s, clock, seq):
    _beat(s, clock, range_edits=[{"seq": seq, "field": "threshold", "from": -57, "to": -60 - seq, "locked": False, "age_ms": 0}])


def _lines(s):
    return [t for t in s._station_view("stick-1")["attention"] if "EDITED ON STATION" in t]


def test_a_range_edit_line_lives_for_its_match_not_its_game_byte():
    s, clock = _sess()
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    s.control("end")
    assert s.phase == "recap"
    _edit_beat(s, clock, 1)                               # an edit in RECAP belongs to the match just played
    assert _lines(s) == ["RANGE EDITED ON STATION -57 → -61"]
    s.next_match()                                        # the next LOAD moves the game byte...
    s.push_config(force=True)
    assert _lines(s) == ["RANGE EDITED ON STATION -57 → -61"], "...and the line stays until the next START"
    _edit_beat(s, clock, 2)                               # an edit in muster/lobby before START: the coming match's
    s.start(runway_s=3, force=True)
    assert _lines(s) == ["RANGE EDITED ON STATION -57 → -62"], _lines(s)   # the recap edit cleared at START
    s.control("end")
    s.next_match()
    s.push_config(force=True)
    s.start(runway_s=3, force=True)
    assert _lines(s) == [], "the pre-match edit cleared at the START after its match"
