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
    assert _lock(s) == 0                                     # leaving LOBBY unlocks
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
