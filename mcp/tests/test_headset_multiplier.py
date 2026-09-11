"""`compile.headset_multiplier()` at the three points bench-measured 2026-09-11 (gun Tactix-3D4F).

Run: python3 run_tests.py headset_multiplier
Sensor-gated headset scaling superseded the flat x1.25/x2 reading from 2026-09-02: the gun-body
sensor is always x1 for fn 1/36/37 alike, and the headset scale is a function of the compiled
`$GSET` criticalShotModifier (t7), not a fixed constant. See experiment-log/2026-09.md
(2026-09-11, bench) and docs/weapon-design.md §6.
"""
from brx_mcp.mc.compile import headset_multiplier


def test_fn36_at_the_mc_default_crit_modifier_is_the_2026_09_02_reading():
    # t7=50 (the MC-compiled default): fn 36 -> 1.25, matching the earlier flat reading exactly.
    assert headset_multiplier(36, 50) == 1.25


def test_fn37_at_the_mc_default_crit_modifier_is_the_2026_09_02_reading():
    # t7=50: fn 37 -> 2.0, matching the earlier flat reading exactly.
    assert headset_multiplier(37, 50) == 2.0


def test_fn37_at_the_closing_control_crit_modifier_zero_is_unscaled():
    # Bench 2026-09-11's closing control: $GSET,...,t7=0 read fn 37 back to a plain x1 on the
    # headset, isolating t7 (not the function alone) as what drives the scale.
    assert headset_multiplier(37, 0) == 1.0


def test_fn36_at_crit_modifier_zero_is_also_unscaled():
    assert headset_multiplier(36, 0) == 1.0


def test_fn36_scales_linearly_with_crit_modifier():
    assert headset_multiplier(36, 100) == 1.5
    assert headset_multiplier(36, 0) == 1.0


def test_fn37_scales_linearly_with_crit_modifier():
    assert headset_multiplier(37, 100) == 3.0
    assert headset_multiplier(37, 0) == 1.0


def test_every_other_function_is_unscaled_regardless_of_crit_modifier():
    # Plain damage (fn 1), a status row (fn 24) and a grant (fn 10): none of these are the
    # multiplier pair, so the crit_modifier must never touch them.
    for fn in (0, 1, 3, 4, 5, 7, 8, 10, 24, 29, 38):
        assert headset_multiplier(fn, 50) == 1.0
        assert headset_multiplier(fn, 100) == 1.0
