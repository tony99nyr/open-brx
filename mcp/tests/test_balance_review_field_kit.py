"""Field kit swaps and Armour Piercing use the same catalogue rules as the duel engine."""
import pathlib
import random
import sys

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import balance_review as R  # noqa: E402
import balance_sim as B  # noqa: E402


def _match(kit):
    opponent = R.field_kit(R.shipped_world(), "target", "assault_rifle")
    p = R._kit_player(0, 0, kit)
    q = R._kit_player(1, 1, opponent)
    match = R.KitMatch([p, q], random.Random(1), B.SimConfig(pool=B.default_pool(), range_model=False), 1.0, 1)
    p.target, p.engage_id, p.contact_end = 1, 1, 10000.0
    return match, p, q


def test_field_kit_draws_a_lethal_secondary_when_primary_runs_dry():
    world = R.shipped_world()
    match, p, q = _match(R.field_kit(world, "backup", "assault_rifle", "glock"))
    p.ammo = p.reserve = 0
    match._shot(p, 0.0, p.engage_id)
    assert p.active == 1 and p.swap_until == p.kit.swap_ms
    assert p.ammo == p.models[1].mag
    before = p.shots
    match._shot(p, p.swap_until, p.engage_id)
    assert p.shots == before + 1 and q.health + q.armour + q.shield < 115


def test_field_kit_draws_secondary_after_a_heat_locking_round():
    world = R.shipped_world()
    match, p, _q = _match(R.field_kit(world, "hot", "energy_rifle", "glock"))
    heat = dict(p.w.heat)
    p.heat = float(heat["lock_at"] - heat["per_shot"])
    match._shot(p, 0.0, p.engage_id)
    assert p.active == 1 and p.swap_until == p.kit.swap_ms
    assert p.stash[0][5] > 0


def test_field_kit_armour_piercing_hits_health_and_refuses_unpriced_primary():
    world = R.shipped_world()
    kit = R.field_kit(world, "AP", "assault_rifle", perk="armor_piercing")
    assert kit.models[0].gun_dmg == world.cat._row("assault_rifle")["ap_dmg"]
    assert kit.models[0].fire_ms == world.cat._row("assault_rifle")["ap_fire_ms"]
    assert kit.models[0].headset_dmg == 0
    match, p, q = _match(kit)
    match._hit(p, q, p.w.gun_dmg, 0.0)
    assert (q.health, q.armour, q.shield) == (45 - p.w.gun_dmg, 70, 0)
    try:
        R.field_kit(world, "unpriced", "amr", perk="armor_piercing")
    except ValueError as exc:
        assert "ap_dmg" in str(exc)
    else:
        raise AssertionError("unpriced Armour Piercing primary was accepted")
