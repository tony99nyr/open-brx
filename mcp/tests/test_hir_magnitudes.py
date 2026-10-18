"""S56 ("what hit me"): `WeaponCatalog.hir_magnitudes()` / `hir_from_weap()` (compile.py).

A `$HIR` fact carries only a raw IR magnitude, never a weapon id, so a victim's phone that wants to
NAME what hit it must match that magnitude against the shooter's known weapons. These two functions
are the one place that magnitude set is derived: `hir_magnitudes()` from a fresh catalogue resolve,
`hir_from_weap()` from an already-compiled `$WEAP` frame (a player's own bundle, where a perk may
have moved the numbers). Both must agree on a plain catalogue weapon.
"""
from brx_mcp.mc.compile import WeaponCatalog, hir_from_weap

CAT = WeaponCatalog()


def test_an_ordinary_rifle_publishes_one_magnitude():
    # assault_rifle carries no headset word and no tap: t5 alone.
    assert CAT.hir_magnitudes("assault_rifle") == [CAT.damage("assault_rifle")]
    assert len(CAT.hir_magnitudes("assault_rifle")) == 1


def test_smg_publishes_both_the_gun_and_the_headset_word():
    # smg: t5 (gun, 7) and t12 (headset, 2) -- two distinct words, sorted ascending.
    # 2026-09-23 (R5, F308): split moved 8+1 -> 7+2, close-range total unchanged at 9.
    assert CAT.hir_magnitudes("smg") == [2, 7]


def test_shotgun_deduplicates_equal_gun_and_headset_words():
    # shotgun: t5 == t12 == 20 (wire.dmg + wire.headset_dmg). One entry, not two: the phone can only
    # tell a hit's SIZE, not which emitter sent it.
    assert CAT.hir_magnitudes("shotgun") == [20]


def test_charge_rifle_publishes_the_charge_and_the_tap_magnitude():
    # charge_rifle: t5 (charge, 70, wire.dmg) and t37 (tap, 16, wire.tap_dmg), no headset word.
    assert CAT.hir_magnitudes("charge_rifle") == [16, 70]


def test_hir_from_weap_agrees_with_hir_magnitudes_on_a_resolved_frame():
    for weapon_id in ("assault_rifle", "smg", "shotgun", "charge_rifle"):
        frame = CAT.resolve(weapon_id, 0)
        assert hir_from_weap(frame) == CAT.hir_magnitudes(weapon_id) == sorted(set(hir_from_weap(frame)))


def test_hir_from_weap_ignores_a_short_or_empty_frame():
    assert hir_from_weap("$WEAP,0,assault_rifle,*") == []
    assert hir_from_weap("") == []
