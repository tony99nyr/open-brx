"""Data-only checks on the soak traffic catalog (brx_mcp/soak/patterns.py).

No BLE, no clock, no hardware: these just walk the PATTERNS dict and its frame lists. The one
property that actually matters for a P0 unattended soak: nothing in here may ever send a hang-list
frame (docs/bench-screamers-2026-09-19.md: `$DPLAY` locks a gun on a looping sound).
"""

from brx_mcp import protocol
from brx_mcp.soak.patterns import (HANG_LIST, PATTERNS, ScheduledFrames, SoakPattern,
                                   assert_pattern_is_safe)


def _all_frames(pattern: SoakPattern) -> list[str]:
    out = list(pattern.once)
    for g in pattern.repeating:
        out.extend(g.frames)
    return out


def test_no_pattern_carries_a_hang_list_frame():
    for name, p in PATTERNS.items():
        for cmd in _all_frames(p):
            assert protocol.command_name(cmd) not in HANG_LIST, f"{name}: {cmd!r} is on the hang list"
        assert_pattern_is_safe(p)   # does not raise


def test_every_frame_is_a_well_formed_known_safe_command():
    for name, p in PATTERNS.items():
        for cmd in _all_frames(p):
            assert protocol.validate_frame(cmd) is None, f"{name}: malformed frame {cmd!r}"
            assert protocol.is_known_safe(cmd), f"{name}: {cmd!r} is not on KNOWN_SAFE_COMMANDS"


def test_hang_list_and_known_safe_never_overlap():
    # A frame cannot both need an explicit confirm (hang list) and be pre-approved (known safe).
    # If it ever did, assert_pattern_is_safe's KNOWN_SAFE_COMMANDS check would let a hang-list
    # frame straight through.
    assert HANG_LIST.isdisjoint(protocol.KNOWN_SAFE_COMMANDS)


def test_catalog_has_the_patterns_the_bench_plan_asks_for():
    for name in ("match", "match-x10", "callsign", "recoil-oscillate", "burst-short", "burst-weap"):
        assert name in PATTERNS


def test_match_arms_the_gun_before_replaying_traffic():
    # every pattern's `once` sequence sets the volume, clears the table, and ends spawned live:
    # the same shape __main__.py's GAME_CONFIG + SPAWN_SEQUENCE already ship.
    for name, p in PATTERNS.items():
        assert p.once, f"{name}: no arm sequence"
        assert p.once[0].startswith("$VOL,"), f"{name}: does not set volume first"
        assert p.once[1] == "$CLEAR,*", f"{name}: does not clear the table right after"
        assert p.once[-1].startswith("$BMAP,0,0"), f"{name}: does not end spawned live"


def test_match_x10_is_match_at_ten_times_the_rate():
    match, x10 = PATTERNS["match"], PATTERNS["match-x10"]
    by_name = {g.name: g.every_s for g in match.repeating}
    by_name_x10 = {g.name: g.every_s for g in x10.repeating}
    assert by_name.keys() == by_name_x10.keys()
    for name, every_s in by_name.items():
        assert by_name_x10[name] == every_s / 10
    offsets = {g.name: g.offset_s for g in match.repeating}
    for g in x10.repeating:
        assert g.offset_s == offsets[g.name] / 10


def test_callsign_hit_cue_scales_with_player_count():
    match = {g.name: g.every_s for g in PATTERNS["match"].repeating}
    callsign = {g.name: g.every_s for g in PATTERNS["callsign"].repeating}
    # ASSUMPTION documented in patterns.py: 20 players' relayed hit-cue traffic reaches this one
    # gun, so the cadence is 20x match's single-player rate.
    assert callsign["relayed-hit-cue"] == match["hit-cue"] / 20
    # the LED readout and the revive are per-own-life events, not relayed, so they stay unscaled.
    assert callsign["led-readout"] == match["led-readout"]
    assert callsign["revive"] == match["revive"]


def test_burst_patterns_fire_continuously_with_no_gap():
    for name in ("burst-short", "burst-weap"):
        p = PATTERNS[name]
        assert len(p.repeating) == 1
        assert p.repeating[0].every_s == 0.0


def test_burst_short_is_100_frames_burst_weap_is_50():
    assert len(PATTERNS["burst-short"].repeating[0].frames) == 100
    assert len(PATTERNS["burst-weap"].repeating[0].frames) == 50


def test_burst_weap_frame_is_the_long_captured_weap_frame():
    frame = PATTERNS["burst-weap"].repeating[0].frames[0]
    assert frame.startswith("$WEAP,0,")
    assert len(frame) >= 100          # plan doc: "~101 bytes"


def test_assert_pattern_is_safe_rejects_a_hang_list_frame():
    bad = SoakPattern(name="bad", description="d",
                      repeating=(ScheduledFrames("x", 1.0, ("$DPLAY,A10,4,*",)),))
    try:
        assert_pattern_is_safe(bad)
        raised = False
    except ValueError:
        raised = True
    assert raised, "a $DPLAY frame must be refused"


def test_assert_pattern_is_safe_rejects_an_unknown_command():
    bad = SoakPattern(name="bad", description="d",
                      repeating=(ScheduledFrames("x", 1.0, ("$MYSTERY,1,*",)),))
    try:
        assert_pattern_is_safe(bad)
        raised = False
    except ValueError:
        raised = True
    assert raised, "an unlisted command needs explicit confirm, not a soak"


def _recoil_groups(p: SoakPattern) -> list[ScheduledFrames]:
    return [g for g in p.repeating if g.name.startswith("recoil-")]


def test_every_recoil_write_is_the_writers_weap_plus_ammo_pair():
    # engine.js `_recoilWrite`: the active slot's compiled $WEAP with ONLY t21/t22 changed, then an
    # $AMMO restore. Anything else would soak a frame the node never sends.
    from brx_mcp.soak.patterns import _WEAP_FRAME
    base = _WEAP_FRAME.split(",")
    for name in ("match", "recoil-oscillate"):
        groups = _recoil_groups(PATTERNS[name])
        assert groups, f"{name}: no recoil writes"
        for g in groups:
            weap, ammo = g.frames
            p = weap.split(",")
            assert len(p) == len(base)
            assert [i for i, (a, b) in enumerate(zip(base, p)) if a != b] in ([], [22, 23], [22], [23])
            assert p[22] == p[23]
            assert ammo.startswith("$AMMO,0,")


def test_match_carries_three_recoil_writes_per_burst():
    groups = _recoil_groups(PATTERNS["match"])
    assert len(groups) == 3
    assert len({g.every_s for g in groups}) == 1           # one burst cadence
    offsets = [g.offset_s for g in groups]
    assert offsets == sorted(offsets) and offsets[-1] < groups[0].every_s   # in order, inside one cycle


def test_recoil_oscillate_is_about_150_writes_a_minute():
    groups = _recoil_groups(PATTERNS["recoil-oscillate"])
    per_minute = sum(60 / g.every_s for g in groups)
    assert 140 <= per_minute <= 160, per_minute
