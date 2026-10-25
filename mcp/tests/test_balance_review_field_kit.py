"""Field kit swaps and Armour Piercing use the same catalogue rules as the duel engine."""
import pathlib
import heapq
import random
import sys
from dataclasses import replace

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


def test_field_kit_waits_out_a_heat_lock_when_the_secondary_cannot_finish():
    # F601: a locked primary draws only a secondary that finishes first. One Glock round cannot finish a full pool,
    # so the kit fires the locking round and waits out the lock instead of drawing.
    world = R.shipped_world()
    match, p, _q = _match(R.field_kit(world, "hot", "energy_rifle", "glock"))
    p.stash[1] = (1, 0, *p.stash[1][2:])
    heat = dict(p.w.heat)
    p.heat = float(heat["lock_at"] - heat["per_shot"])
    match._shot(p, 0.0, p.engage_id)
    assert p.active == 0 and p.shots == 1 and p.heat_lock_until > 0


def test_field_kit_draws_a_secondary_that_finishes_before_the_heat_lock_ends():
    world = R.shipped_world()
    match, p, _q = _match(R.field_kit(world, "hot", "energy_rifle", "glock"))
    heat = dict(p.w.heat)
    p.heat = float(heat["lock_at"] - heat["per_shot"])
    match._shot(p, 0.0, p.engage_id)
    assert p.active == 1 and p.swap_until == p.kit.swap_ms


def test_field_kit_does_not_cancel_a_reload_to_swap_between_two_dry_slots():
    # F601 (Opus review): the check after a shot also ran after a reload start, swapped away and cancelled it, so a
    # slow-reload primary and a fast-reload sidearm, both dry, swapped about 28 times and never finished a reload.
    world = R.shipped_world()
    kit = R.field_kit(world, "slow", "shotgun", "deagle")
    kit = replace(kit, models=(replace(kit.models[0], reload_ms=5000.0), replace(kit.models[1], reload_ms=300.0)))
    p = R._kit_player(0, 0, kit)
    q = R._kit_player(1, 1, R.field_kit(world, "target", "assault_rifle"))
    match = R.KitMatch([p, q], random.Random(1), B.SimConfig(pool=B.default_pool(), range_model=False), 0.3, 1)
    p.target, p.engage_id, p.contact_end = 1, 1, 60000.0
    q.health = 400                      # a long fight, so both slots run dry and reload
    match._swap_to(p, 1, 0.0)
    p.ammo, p.committed = 1, False
    p.stash[0] = (0, 12, *p.stash[0][2:])
    swaps = []
    orig = match._swap_to
    match._swap_to = lambda pp, idx, t_end: (swaps.append(idx), orig(pp, idx, t_end))
    match.heap = []
    match.push(0.0, match.SHOT, 0, p.engage_id)
    for _ in range(80):
        due = [e for e in match.heap if e[2] == match.SHOT and e[3] == 0]
        if not due:
            break
        event = min(due)
        match.heap.remove(event)
        heapq.heapify(match.heap)
        match._shot(p, event[0], event[4])
    assert len(swaps) <= 2, swaps


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


def _shields_match(delay_ms=None):
    world = R.shipped_world()
    pool = B.Pool(health=45, armour=0, shield=105, respawn_ms=5000.0)
    kit = R.field_kit(world, "AR", "assault_rifle")
    kit = replace(kit, pool=pool, **({"shield_regen_delay_ms": delay_ms} if delay_ms else {}))
    p, q = R._kit_player(0, 0, kit), R._kit_player(1, 1, kit)
    match = R.KitMatch([p, q], random.Random(1), B.SimConfig(pool=pool, range_model=False), 1.0, 1)
    return match, p, q


def _run_regen(match, until):
    while match.heap and match.heap[0][0] <= until:
        t, _s, kind, pid, gen = heapq.heappop(match.heap)
        if kind == match.REGEN:
            match._regen(match.players[pid], t, gen)


def test_the_field_refills_a_shield_after_the_quiet_window_in_four_grants():
    # F605: the field engine never regenerated Shields, so Shields team numbers ignored regen
    match, p, q = _shields_match()
    match._hit(p, q, 60, 0.0)
    assert q.shield == 45
    _run_regen(match, R.SHIELD_REGEN_DELAY_MS - 1)
    assert q.shield == 45
    _run_regen(match, R.SHIELD_REGEN_DELAY_MS + 3 * R.SHIELD_REGEN_STEP_MS)
    assert q.shield == 105


def test_damage_restarts_the_window_and_a_kit_can_shorten_it():
    match, p, q = _shields_match()
    match._hit(p, q, 60, 0.0)
    match._hit(p, q, 10, 5000.0)           # restarts the window: nothing refills at 6.5 s
    _run_regen(match, R.SHIELD_REGEN_DELAY_MS + 100)
    assert q.shield == 35
    fast, p2, q2 = _shields_match(delay_ms=4000.0)
    fast._hit(p2, q2, 60, 0.0)
    _run_regen(fast, 4000.0)
    assert q2.shield > 45                   # a 4 s kit (pass 7's Recharge) starts refilling at 4 s


def test_a_respawn_cancels_a_pending_refill():
    match, p, q = _shields_match()
    match._hit(p, q, 60, 0.0)
    match._respawn(q, 1000.0)
    q.shield = 50                           # a stale refill must not top up the new life
    _run_regen(match, R.SHIELD_REGEN_DELAY_MS + 5 * R.SHIELD_REGEN_STEP_MS)
    assert q.shield == 50


def test_the_duel_uses_the_kits_regen_delay():
    world = R.shipped_world()
    kit = replace(R.make_kit(world, "AR", R.ANCHOR, R.SECONDARY), shield_regen_delay_ms=4000.0)
    f = R.Fighter(kit, (45, 0, 105), 0.4, 0, random.Random(2))
    f.receive(60, t=0.0)
    f.advance_shield(4000.0)
    assert f.shield > 45


def test_a_shields_field_kit_fields_a_regenerating_pool_and_a_tick_restarts_the_window():
    # F605 (Opus review): field_kit always built the Standard pool, so no field run regenerated anything
    world = R.shipped_world()
    kit = R.field_kit(world, "AR", "assault_rifle", preset="shields")
    assert (kit.pool.armour, kit.pool.shield) == (0, 105)
    assert R.field_kit(world, "AR", "assault_rifle").pool.armour == 70
    match, p, q = _shields_match()
    match._hit(p, q, 60, 0.0)
    q.poison_gen, q.poison_left, q.poison_dmg, q.poison_tick_ms, q.poison_src = 1, 2, 5, 1000.0, 0
    match._tick(q, 5000.0, 1)              # a poison tick restarts the quiet window too
    _run_regen(match, R.SHIELD_REGEN_DELAY_MS + 100)
    assert q.shield == 40


def test_a_zero_damage_hit_does_not_restart_the_window():
    # F605 (Codex review): the phone restarts the clock only for positive damage; a Haze hit carries 0
    match, p, q = _shields_match()
    match._hit(p, q, 60, 0.0)
    B.Match._hit(match, p, q, 0, 6000.0)
    _run_regen(match, R.SHIELD_REGEN_DELAY_MS + 100)
    assert q.shield > 45
