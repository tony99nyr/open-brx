"""A58: the station tamper lock (`station_config.lock_s`) and the restart flags from `uptime_s`/`boot_count`.

Tony (2026-09-24): a station must resist tampering during a match. MC sends the lock on every
`station_config`: the LOAD value in LOBBY (the only one a muster Stick hears), the exact time left at START
and on a mid-match reconnect, and 0 at END, RECALL, abort-start and the operator's unlock. A reboot inside
the lock window is flagged, dated by the station's own uptime so a muster station's reboot shows when it
rejoins after the match.
"""
from __future__ import annotations

from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from brx_mcp.mc.types import (DEFAULT_RUNWAY_S, STATION_LOCK_LOBBY_S, STATION_LOCK_MARGIN_S,
                              STATION_LOCK_MAX_S)


class Clock:
    def __init__(self, t: int = 1_000_000):
        self.t = t

    def __call__(self) -> int:
        return self.t


def _sess(time_limit_s: int | None = 600):
    clock = Clock()
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=clock)
    s.set_config({"mode": "tdm", "time_limit_s": time_limit_s})
    guns = [g["gun_id"] for g in s.armory.list()][:2]
    teams = [t["team_id"] for t in s.config["teams"]]
    for i, g in enumerate(guns):
        s.add_player(f"P{i}", teams[i % len(teams)], g, "male")
    s.net.simulate_utility_hello("stick-1")
    s.set_station("stick-1", {"kind": "respawn", "team": "blue", "id": 3})
    return s, clock


def _lock(s) -> int:
    return [b for n, k, b in s.net.pushed if k == "station_config" and n == "stick-1"][-1]["lock_s"]


def _beat(s, clock, **fields):
    s.net.simulate_status("stick-1", {"role": "utility", "kind": "respawn", "team": 1, "station_id": 3, **fields},
                          clock.t)


def _flags(s) -> list[str]:
    return next(v for v in s.stations_view() if v["node_id"] == "stick-1")["attention"]


def test_the_lock_follows_the_phase():
    s, clock = _sess(600)
    assert _lock(s) == 0                                     # assigned at muster: unlocked
    s.push_config(force=True)
    assert _lock(s) == 600 + STATION_LOCK_LOBBY_S + STATION_LOCK_MARGIN_S   # LOAD: lobby wait + the match
    clock.t += 5000
    s.start(runway_s=30, force=True)
    assert _lock(s) == 30 + 600 + STATION_LOCK_MARGIN_S       # START: the exact time left
    clock.t += 100_000                                       # a reconnect 100 s later gets the time LEFT
    s.net.simulate_utility_hello("stick-1")
    assert _lock(s) == 30 + 600 + STATION_LOCK_MARGIN_S - 100
    s.control("end")
    assert _lock(s) == 0                                     # END unlocks


def test_no_time_limit_gets_the_cap_and_recall_and_abort_unlock():
    s, clock = _sess(600)
    s.push_config(force=True)
    s.config["time_limit_s"] = None      # the validator refuses no limit today (A4.8); the lock must not care
    s.arm_stations()
    assert _lock(s) == STATION_LOCK_MAX_S
    s.start(runway_s=30, force=True)
    assert _lock(s) == STATION_LOCK_MAX_S
    s.abort_start()
    assert _lock(s) == 0                                     # the whistle never blew
    s.start(runway_s=30, force=True)
    assert _lock(s) == STATION_LOCK_MAX_S                    # a new START locks again
    s.control("recall")
    assert _lock(s) == 0


def test_a_long_time_limit_is_capped():
    s, _ = _sess(7000)
    s.push_config(force=True)
    assert _lock(s) == STATION_LOCK_MAX_S


def test_the_operator_unlock_holds_until_the_next_start():
    s, clock = _sess(600)
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    assert s.unlock_stations()["ok"] is True
    assert _lock(s) == 0
    s.net.simulate_utility_hello("stick-1")                  # a reconnect does not re-lock it
    assert _lock(s) == 0
    s.reschedule(30)
    assert _lock(s) > 0


def test_a_reboot_inside_the_lock_window_is_flagged():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=50, boot_count=4, assoc="held")
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    clock.t += 60_000
    _beat(s, clock, uptime_s=110, boot_count=4, assoc="held")   # the same boot, 60 s on
    assert not any("RESTARTED" in f for f in _flags(s))
    clock.t += 10_000
    _beat(s, clock, uptime_s=3, boot_count=5, assoc="held")     # rebooted
    assert "STATION #3 RESTARTED" in _flags(s)
    assert next(v for v in s.stations_view())["restarts"] == 1


def test_a_reboot_without_boot_count_is_caught_by_the_boot_instant():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=50)
    s.push_config(force=True)
    clock.t += 60_000
    _beat(s, clock, uptime_s=2)                               # boot_count lost (NVS wiped): uptime alone
    assert "STATION #3 RESTARTED" in _flags(s)


def test_a_muster_stations_reboot_shows_when_it_rejoins_after_the_match():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=40, boot_count=7, assoc="muster")
    s.push_config(force=True)                                # it drops Wi-Fi here
    s.start(runway_s=30, force=True)
    clock.t += 300_000                                       # rebooted mid-match, out of Wi-Fi
    reboot_at = clock.t
    clock.t += 400_000
    s.control("end")                                         # MC's unlock goes to nobody
    clock.t += 60_000
    s.net.simulate_utility_hello("stick-1")                  # the operator walks it back
    _beat(s, clock, uptime_s=(clock.t - reboot_at) // 1000, boot_count=8, assoc="muster")
    assert "STATION #3 RESTARTED" in _flags(s)


def test_a_reboot_outside_the_window_is_not_flagged():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=40, boot_count=7)
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    s.control("end")                                         # unlocked
    clock.t += 120_000
    _beat(s, clock, uptime_s=5, boot_count=8)                # rebooted after the match: not tampering
    assert not any("RESTARTED" in f for f in _flags(s))
    s.push_config(force=True)                                # a NEW game's lock starts a fresh count
    assert not any("RESTARTED" in f for f in _flags(s))


def test_only_a_held_station_is_flagged_offline():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=40, boot_count=1, assoc="held")
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    s.net.simulate_stale("stick-1", 20_000)
    assert "STATION #3 OFFLINE" in _flags(s)
    _beat(s, clock, uptime_s=41, boot_count=1, assoc="muster")
    s.net.simulate_stale("stick-1", 20_000)
    assert "STATION #3 OFFLINE" not in _flags(s)             # a muster station is out of Wi-Fi by design


def test_a_long_lobby_warns_that_a_muster_lock_runs_out_mid_match():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=40, boot_count=1, assoc="muster")
    s.push_config(force=True)
    warn = "STATION #3 LOCK EXPIRES MID-MATCH, REJOIN IT"
    assert warn not in _flags(s)
    clock.t += (STATION_LOCK_LOBBY_S + STATION_LOCK_MARGIN_S - DEFAULT_RUNWAY_S) * 1000 - 1000
    assert warn not in _flags(s)
    clock.t += 2000
    assert warn in _flags(s)
    s.net.simulate_utility_hello("stick-1")                  # through muster again: a fresh LOAD lock
    assert warn not in _flags(s)


def test_a_muster_station_out_of_wifi_is_not_flagged_for_re_arming_by_a_lock_resend():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=40, boot_count=1, assoc="muster")
    s.push_config(force=True)                                # delivered; the Stick then drops Wi-Fi
    real_push = s.net.push
    s.net.push = lambda nid, kind, body: False if nid == "stick-1" else real_push(nid, kind, body)
    s.start(runway_s=30, force=True)                         # the START re-send misses it, by design
    assert "BRING IT BACK TO RE-ARM" not in _flags(s)
    s.control("end")                                         # so does END's unlock...
    assert "BRING IT BACK TO RE-ARM" not in _flags(s)
    clock.t += 120_000                                       # ...but the window still closes at END
    s.net.push = real_push
    s.net.simulate_utility_hello("stick-1")
    _beat(s, clock, uptime_s=5, boot_count=2, assoc="muster")   # rebooted after the whistle
    assert not any("RESTARTED" in f for f in _flags(s))


def test_a_release_drops_the_lock_state():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=40, boot_count=1)
    s.push_config(force=True)
    clock.t += 10_000
    _beat(s, clock, uptime_s=2, boot_count=2)
    assert "STATION #3 RESTARTED" in _flags(s)
    s.release_station("stick-1")
    st = s.stations.get("stick-1") or {}
    assert not any(k in st for k in ("lock", "locked_since", "restarts")), st


def test_a_new_session_mid_match_unlocks():
    s, clock = _sess(600)
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    s.new_session()
    assert _lock(s) == 0


def test_a_repush_from_kit_sends_the_lobby_lock_not_zero():
    s, clock = _sess(600)
    s.push_config(force=True)
    s.set_phase("kit")
    assert _lock(s) > 0                                      # F337 (d): leaving LOBBY keeps a pushed game locked
    s.push_config(force=True)                                # the re-push branch
    assert _lock(s) == 600 + STATION_LOCK_LOBBY_S + STATION_LOCK_MARGIN_S


def test_abort_then_start_reopens_the_window_for_a_muster_station_out_of_wifi():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=40, boot_count=1, assoc="muster")
    s.push_config(force=True)
    real_push = s.net.push
    s.net.push = lambda nid, kind, body: False if nid == "stick-1" else real_push(nid, kind, body)
    s.start(runway_s=30, force=True)
    s.abort_start()
    s.start(runway_s=30, force=True)
    clock.t += 200_000
    reboot_at = clock.t                                      # the real match: rebooted out of Wi-Fi
    clock.t += 100_000
    s.control("end")
    s.net.push = real_push
    s.net.simulate_utility_hello("stick-1")
    _beat(s, clock, uptime_s=(clock.t - reboot_at) // 1000, boot_count=2, assoc="muster")
    assert "STATION #3 RESTARTED" in _flags(s)


def test_a_late_heartbeat_with_the_same_boot_count_is_not_a_reboot():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=40, boot_count=3)
    s.push_config(force=True)
    clock.t += 30_000
    _beat(s, clock, uptime_s=40 + 30 - 8, boot_count=3)      # 8 s late: the boot instant moved, the count did not
    assert not any("RESTARTED" in f for f in _flags(s))


def test_kit_auto_advancing_back_to_a_pushed_lobby_locks_again():
    s, clock = _sess(600)
    s.push_config(force=True)
    s.set_phase("kit")
    for p in s.players.values():
        p["ready"] = False
    for pid in list(s.players):
        s._on_ready(pid, True)                               # the last READY advances KIT -> LOBBY
    assert s.phase == "lobby"
    assert _lock(s) == 600 + STATION_LOCK_LOBBY_S + STATION_LOCK_MARGIN_S


def _ctl_beat(s, clock, hold, revives=None, **fields):
    body = {"role": "utility", "kind": "control", "team": 255, "station_id": 3,
            "control": {"owner": 1, "progress": 100, "contested": False, "hold_ms": hold}, **fields}
    if revives is not None:
        body["revives"] = revives
    s.net.simulate_status("stick-1", body, clock.t)


def _report(s):
    return next(v for v in s.stations_view() if v["node_id"] == "stick-1")["report"]


def test_a_station_restart_cannot_shrink_its_tally_within_one_game():
    """brx4 (2026-09-24): a restarted Stick resumes its hold time from the tally saved at its last capture, so
    its report can DROP mid-match. The station is self-authoritative for its count, and a count within one game
    only grows, so MC keeps the per-team maximum (and the largest revive count) until a new game is armed."""
    s, clock = _sess(600)
    s.set_station("stick-1", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True)
    clock.t += 10_000
    _ctl_beat(s, clock, {"1": 90_000, "3": 20_000}, revives=5)
    clock.t += 2_000
    _ctl_beat(s, clock, {"1": 60_000, "3": 25_000}, revives=2, uptime_s=1)   # rebooted: blue's tally went back
    rep = _report(s)
    assert rep["control"]["hold_ms"] == {"1": 90_000, "3": 25_000}, rep
    assert rep["revives"] == 5, rep
    s.start(runway_s=30, force=True)
    s.control("end")
    s.push_config(force=True)                                # a NEW game: the station resets, and so does MC
    clock.t += 5_000
    _ctl_beat(s, clock, {"1": 1_000})
    assert _report(s)["control"]["hold_ms"] == {"1": 1_000}


def test_a_reassigned_station_starts_a_fresh_tally_in_the_same_game():
    s, clock = _sess(600)
    s.set_station("stick-1", {"kind": "control", "team": "any", "id": 3})
    s.push_config(force=True)
    clock.t += 10_000
    _ctl_beat(s, clock, {"1": 90_000})
    s.set_station("stick-1", {"kind": "control", "team": "any", "id": 4})   # fixed at setup: a new point
    clock.t += 5_000
    _ctl_beat(s, clock, {"1": 2_000}, station_id=4)
    assert _report(s)["control"]["hold_ms"] == {"1": 2_000}, _report(s)


# ---------------- F337: the lock across an MC restart, adopted matches, and KIT ----------------

def _restart(s, clock):
    """A new MC process reading the old one's session.json (and a store of its own, so it can resume)."""
    import pathlib
    import tempfile
    from brx_mcp.mc.store import Store
    if s._persist_path is None:
        s._persist_path = pathlib.Path(tempfile.mkdtemp(prefix="brx-lock-test-")) / "session.json"
    s._persist_last = 0.0
    s._persist()
    s2 = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=clock,
                 store=Store("t2", s._persist_path.parent / "s2.sqlite"))
    s2._persist_path = s._persist_path
    s2.restore_snapshot()
    s2.resume_match()
    return s2


def test_f337a_an_unlock_survives_an_mc_restart_mid_match():
    s, clock = _sess(600)
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    s.unlock_stations()
    clock.t += 60_000
    s2 = _restart(s, clock)
    assert s2.phase in ("armed", "live"), s2.phase
    s2.net.simulate_utility_hello("stick-1")
    assert _lock(s2) == 0, "the operator's UNLOCK must not re-lock on the first hello after an MC restart"


def test_f337a_restarts_counted_before_an_mc_restart_are_kept_and_the_window_holds():
    s, clock = _sess(600)
    _beat(s, clock, uptime_s=50, boot_count=4, assoc="held")
    s.push_config(force=True)
    s.start(runway_s=30, force=True)
    clock.t += 60_000
    _beat(s, clock, uptime_s=3, boot_count=5, assoc="held")      # rebooted once, before MC restarts
    assert "STATION #3 RESTARTED" in _flags(s)
    s2 = _restart(s, clock)
    s2.net.simulate_utility_hello("stick-1")
    clock.t += 5_000
    s2.net.simulate_status("stick-1", {"role": "utility", "kind": "respawn", "team": 1, "station_id": 3,
                                       "uptime_s": 8, "boot_count": 5, "assoc": "held"}, clock.t)
    assert "STATION #3 RESTARTED" in next(v for v in s2.stations_view() if v["node_id"] == "stick-1")["attention"]
    clock.t += 5_000
    s2.net.simulate_status("stick-1", {"role": "utility", "kind": "respawn", "team": 1, "station_id": 3,
                                       "uptime_s": 1, "boot_count": 6, "assoc": "held"}, clock.t)
    view = next(v for v in s2.stations_view() if v["node_id"] == "stick-1")
    assert view["restarts"] == 2, view
    assert "STATION #3 RESTARTED 2 TIMES" in view["attention"]


def test_f337c_an_adopted_match_locks_to_the_cap_not_the_draft_limit():
    s, clock = _sess(60)                                     # the operator's draft says 60 s
    s.start_info = {"match_id": "m-orphan", "go_live_t": clock.t, "seq": 1, "countdown_s": 0, "adopted": True}
    s.phase = "live"
    s.net.simulate_utility_hello("stick-1")
    assert _lock(s) == STATION_LOCK_MAX_S, "MC holds no limit for an adopted match: the draft must not unlock early"
    s.start_info["adopted"] = False                          # the same field, a match MC started
    s.net.simulate_utility_hello("stick-1")
    assert _lock(s) == 60 + STATION_LOCK_MARGIN_S


def test_f337d_lobby_back_to_kit_keeps_a_pushed_game_locked():
    s, clock = _sess(600)
    s.push_config(force=True)
    locked = 600 + STATION_LOCK_LOBBY_S + STATION_LOCK_MARGIN_S
    assert _lock(s) == locked
    s.set_phase("kit")
    assert _lock(s) == locked, "stepping back to KIT sends no unlock"
    s.net.simulate_utility_hello("stick-1")
    assert _lock(s) == locked, "a reconnect in KIT with a pushed game is locked too"
    s.set_phase("build")
    s.net.simulate_utility_hello("stick-1")
    assert _lock(s) == locked
    s.unlock_stations()
    assert _lock(s) == 0, "the operator's unlock still works outside a match"


def test_f337d_an_invalid_edit_that_drops_the_push_unlocks_the_stations():
    s, clock = _sess(600)
    s.push_config(force=True)
    assert _lock(s) > 0
    res = s.set_config({"time_limit_s": None})               # invalid (A4.8): the push is dropped, not re-sent
    assert res["ok"] is False and s.lobby_pushed is False, res
    assert _lock(s) == 0, "no pushed game any more: the stations are told so"
