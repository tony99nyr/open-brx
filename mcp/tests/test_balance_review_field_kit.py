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
    p.stash[1] = (1, 0, *p.stash[1][2:])
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


def test_field_stale_seek_keeps_live_target_and_attacker_count():
    world = R.shipped_world()
    match, p, q = _match(R.field_kit(world, "AR", "assault_rifle", R.SECONDARY))
    q.attackers = 1
    match._release(p, 0)
    match._death(p, q, 1, dot=False)
    match._respawn(p, 2)
    match._seek(p, 3)
    before = (p.target, p.engage_id, q.attackers)
    match._seek(p, 4)
    assert before == (p.target, p.engage_id, q.attackers)


def test_field_reload_cancels_on_swap_and_charge_waits_from_draw():
    world = R.shipped_world()
    match, p, _q = _match(R.field_kit(world, "AR CR", "assault_rifle", "charge_rifle"))
    p.ammo = 0
    match._start_reload(p, 0)
    assert p.reload_amount > 0 and p.ammo == 0
    match._swap_to(p, 1, 100)
    assert p.stash[0][0] == 0 and p.stash[0][9] == 0
    assert p.last_pull == 100 and p.next_ready >= 100 + p.w.fire_ms
    match._swap_to(p, 0, 200)
    assert p.ammo == 0 and p.reload_amount == 0


def test_field_finish_estimate_uses_capacity_and_draw_ready_time():
    world = R.shipped_world()
    match, p, q = _match(R.field_kit(world, "AR Glock", "assault_rifle", "glock"))
    q.health, q.armour, q.shield = 1000, 0, 0
    p.stash[1] = (p.models[1].mag, 0, -1.0, 0.0, 0.0, -1.0, 0.0, -1e9, 0, 0)
    assert match._finish_ms(p, 1, 0, q.health) == float("inf")
    q.health = p.models[1].pull_dmg
    assert match._finish_ms(p, 1, 0, q.health) == 0


def test_field_lever_vent_restarts_after_swap():
    world = R.shipped_world()
    match, p, _q = _match(R.field_kit(world, "energy backup", "energy_rifle", "glock"))
    p.ammo = 0
    p.heat = float(dict(p.w.heat)["lock_at"])
    p.heat_lock_until = 1000
    match._start_reload(p, 0)
    match._swap_to(p, 1, 100)
    assert p.stash[0][5] == float("inf") and p.stash[0][9] == 0
    p.ammo = p.reserve = 0
    match._swap_to(p, 0, 200)
    match._shot(p, 200, p.engage_id)
    assert p.heat_lock_until > 200 and p.reload_amount > 0 and p.ammo == 0


def test_finish_estimate_steps_a_single_shot_at_the_published_cycle():
    """F576: the finish estimate, the sampled fight and compile all step a single shot at the MEAN interval."""
    world = R.shipped_world()
    for wid in ("usp", "deagle", "amr"):
        gun = R.make_kit(world, wid, wid).guns[0]
        one = R.finish_estimate(gun, pool=1, chance=1.0, ammo=gun.mag, reserve=gun.reserve, reload_amount=0,
                                ready_at=0.0, locked_until=-1.0, t=0.0, pull_ms=R.PULL_MS,
                                overshoot_ms=R.FIGHT_OVERSHOOT_MS, charged=False, count=0, dist=10.0,
                                heat=0.0, heat_t=0.0, heat_cool_while_firing=True)
        two = R.finish_estimate(gun, pool=gun.gun_dmg + 1, chance=1.0, ammo=gun.mag, reserve=gun.reserve,
                                reload_amount=0, ready_at=0.0, locked_until=-1.0, t=0.0, pull_ms=R.PULL_MS,
                                overshoot_ms=R.FIGHT_OVERSHOOT_MS, charged=False, count=0, dist=10.0,
                                heat=0.0, heat_t=0.0, heat_cool_while_firing=True)
        published = world.cat.paced_cycle_ms(wid)
        assert abs((two - one) - published) < 0.5, (wid, two - one, published)
