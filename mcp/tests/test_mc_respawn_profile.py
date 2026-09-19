"""Respawn profiles (Tony, 2026-09-19; docs/spec/contracts.md §3): the compiler's `respawn_profile` and MC's settings.

Run: python3 run_tests.py mc_respawn_profile
A TIMED respawn (in place) writes t8 only when the game sets protection (default 0 = no `$TMP`), holds the trigger
and names when the node maps it (`trigger_ms`, never while protected). A STATION respawn is protected (default 2 s),
maps the trigger at once and lights a shield. The legacy `spawn`/`revive` lists stay as they were for an app < 0.4.3.
"""
from brx_mcp.mc.compile import (SPAWN_PROTECT_ON, TRIGGER_HELD, TRIGGER_LIVE, Compiler, assert_respawn_profile,
                                respawn_settings)
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session
from _session import match_config

C = Compiler()
_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]
_PLAYER = {"player_id": "p7", "player_num": 7, "display": "REAPER", "team_id": "blue", "node_id": None, "gun_id": None,
           "voice": "male", "ready": True, "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}


def _bundle(mode="tdm", **respawn):
    cfg = match_config(mode, frag=0, time_limit_s=600, led=None, teams=_TEAMS)
    cfg["respawn"] = {**cfg["respawn"], **respawn}
    return C.compile(cfg, _PLAYER, _TEAMS)


def _after_spawn(frames):
    return frames[frames.index("$SPAWN,,*") + 1:]


def _raises(fn, text):
    try:
        fn()
    except ValueError as e:
        assert text in str(e), e
        return
    raise AssertionError(f"expected ValueError containing {text!r}")


def test_defaults_timed_writes_no_tmp_and_holds_the_trigger():
    rp = _bundle()["respawn_profile"]
    assert (rp["protect_ms"], rp["trigger_ms"], rp["station_protect_ms"]) == (0, 500, 2000)
    assert not [f for f in rp["revive"] if f.startswith("$TMP")]
    assert _after_spawn(rp["revive"])[0].startswith("$TID,")
    assert TRIGGER_HELD in rp["revive"] and TRIGGER_LIVE not in rp["revive"]
    assert rp["trigger_live"] == TRIGGER_LIVE


def test_the_t0_spawn_is_equal_for_everyone_whatever_the_settings():
    # Tony, field 2026-09-19: at match start every player is hittable and can fire at go-live.
    for settings in ({}, {"protect_s": 2, "weapon_delay_ms": 3000, "station_protect_s": 3}):
        sp = _bundle(**settings)["respawn_profile"]["spawn"]
        assert sp[0] == "$PLAYX,0,*"
        assert not [f for f in sp if f.startswith("$TMP")], settings
        assert TRIGGER_LIVE in _after_spawn(sp) and TRIGGER_HELD not in sp, settings


def test_station_is_protected_maps_the_trigger_and_shows_the_shield():
    rp = _bundle()["respawn_profile"]
    st = rp["revive_station"]
    assert _after_spawn(st)[:1] == [SPAWN_PROTECT_ON] and _after_spawn(st)[1].startswith("$TID,")
    assert TRIGGER_LIVE in st and TRIGGER_HELD not in st
    assert st[-1] == rp["shield_on"] and rp["shield_on"].startswith("$HLED,6,2,")
    assert rp["shield_off"].startswith("$HLED,")


def test_timed_protection_1s_carries_t8_and_moves_the_trigger_to_1_5s():
    rp = _bundle(protect_s=1)["respawn_profile"]
    assert (rp["protect_ms"], rp["trigger_ms"]) == (1000, 1500)
    assert _after_spawn(rp["revive"])[0] == SPAWN_PROTECT_ON
    assert TRIGGER_HELD in rp["revive"]
    # a longer weapon delay wins over protection + 0.5 s
    assert _bundle(protect_s=1, weapon_delay_ms=3000)["respawn_profile"]["trigger_ms"] == 3000
    assert _bundle(protect_s=2)["respawn_profile"]["trigger_ms"] == 2500


def test_station_protection_0_writes_no_tmp_and_no_shield():
    rp = _bundle(station_protect_s=0)["respawn_profile"]
    assert not [f for f in rp["revive_station"] if f.startswith("$TMP")]
    assert rp["shield_on"] == "" and rp["shield_off"] == ""
    assert _bundle(station_protect_s=3)["respawn_profile"]["station_protect_ms"] == 3000


def test_the_legacy_lists_are_unchanged_for_an_older_app():
    b = _bundle(protect_s=2)
    for name in ("spawn", "revive"):
        assert _after_spawn(b[name])[0] == SPAWN_PROTECT_ON and TRIGGER_LIVE in b[name], name


def test_infection_flips_use_the_timed_profile():
    rp = _bundle(mode="infection")["respawn_profile"]
    assert rp.get("team_flip"), "an infection bundle carries the profile's flip bursts"
    for tid, frames in rp["team_flip"].items():
        assert frames[0] == f"$TID,{tid},*" and TRIGGER_HELD in frames, tid


def test_settings_refuse_values_outside_the_options():
    _raises(lambda: respawn_settings({"protect_s": 5}), "respawn.protect_s must be one of 0, 1, 2")
    _raises(lambda: respawn_settings({"weapon_delay_ms": 700}), "respawn.weapon_delay_ms must be one of 500, 1000, 3000")
    _raises(lambda: respawn_settings({"station_protect_s": 1}), "respawn.station_protect_s must be one of 0, 2, 3")
    _raises(lambda: respawn_settings({"protect_s": True}), "respawn.protect_s")
    assert respawn_settings(None) == (0, 500, 2000)


def test_the_guard_refuses_a_timed_list_that_maps_the_trigger_or_a_trigger_inside_protection():
    rp = dict(_bundle(protect_s=1)["respawn_profile"])
    bad = dict(rp, revive=[TRIGGER_LIVE if f == TRIGGER_HELD else f for f in rp["revive"]])
    _raises(lambda: assert_respawn_profile(bad), "must hold the trigger")
    _raises(lambda: assert_respawn_profile(dict(rp, trigger_ms=1200)), "while the player is still protected")
    _raises(lambda: assert_respawn_profile(dict(rp, protect_ms=0)), "back to back")


def test_timed_lists_hold_the_trigger_before_spawn_not_after():
    # Review finding, 2026-09-19: TRIGGER_HELD goes in FRONT of $SPAWN in a timed revive, so the previous
    # life's live trigger mapping cannot survive into the gap before the new life's own trigger row lands.
    rp = _bundle()["respawn_profile"]
    revive = rp["revive"]
    assert revive.index(TRIGGER_HELD) < revive.index("$SPAWN,,*")
    assert TRIGGER_HELD not in _after_spawn(revive)
    infected = _bundle(mode="infection")["respawn_profile"]["team_flip"]
    for tid, frames in infected.items():
        assert frames.index(TRIGGER_HELD) < frames.index("$SPAWN,,*"), tid
        assert TRIGGER_HELD not in _after_spawn(frames), tid
    # the T-0 spawn and the station revive are untouched: they map the trigger, never hold it
    sp = rp["spawn"]
    assert TRIGGER_HELD not in sp
    assert rp["revive_station"].index("$SPAWN,,*") < rp["revive_station"].index(TRIGGER_LIVE)


def test_the_guard_refuses_a_timed_list_that_holds_the_trigger_after_spawn():
    rp = dict(_bundle(protect_s=1)["respawn_profile"])
    moved = [f for f in rp["revive"] if f != TRIGGER_HELD] + [TRIGGER_HELD]   # the old (pre-fix) placement
    _raises(lambda: assert_respawn_profile(dict(rp, revive=moved)), "must hold the trigger")


def test_mc_settings_round_trip_into_the_compiled_bundle():
    s = Session(C, FakeNet(), FakeArmory(demo_armory()))
    s.set_config({"respawn": {"type": "auto", "delay_s": 15, "protect_s": 1, "weapon_delay_ms": 3000, "station_protect_s": 3}})
    r = s.config["respawn"]
    assert (r["protect_s"], r["weapon_delay_ms"], r["station_protect_s"]) == (1, 3000, 3), r
    s.set_config({"respawn": {"delay_s": 20}})   # a patch of one key keeps the others
    assert s.config["respawn"]["weapon_delay_ms"] == 3000 and s.config["respawn"]["delay_s"] == 20
    cfg = match_config("tdm", frag=0, time_limit_s=600, led=None, teams=_TEAMS)
    cfg["respawn"] = s.config["respawn"]
    rp = C.compile(cfg, _PLAYER, _TEAMS)["respawn_profile"]
    assert (rp["protect_ms"], rp["trigger_ms"], rp["station_protect_ms"]) == (1000, 3000, 3000)
    _raises(lambda: s.set_config({"respawn": {"weapon_delay_ms": 250}}), "respawn.weapon_delay_ms")
    assert s.config["respawn"]["weapon_delay_ms"] == 3000, "a refused patch changes nothing"
    assert any("respawn.protect_s" in e for e in C.validate({**cfg, "respawn": {**cfg["respawn"], "protect_s": 9}}, [])["errors"])
