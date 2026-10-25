"""The balance sim (`mcp/tools/balance_sim.py`) reads every weapon number from the catalogue and gives
answers that a symmetric fight can check.

Every test uses a fixed seed and a small number of matches, so the file runs in a few seconds and the
same run gives the same numbers. The toxin test holds the published result in docs/weapon-design.md
§7.5b: 1.09 at N=2, 0.94 at N=10 and 48% in a 1v1, against the Assault Rifle.
"""
import copy
import heapq
import math
import pathlib
import random
import shutil
import sys
import tempfile
from contextlib import contextmanager

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import balance_sim as B  # noqa: E402
import balance_review as R  # noqa: E402
from brx_mcp.mc.compile import WeaponCatalog  # noqa: E402

SEED = 7
CAT = WeaponCatalog()


@contextmanager
def raises(exc):
    """The system Python here has no pytest (run_tests.py): a small `pytest.raises` stand-in."""
    try:
        yield
    except exc:
        return
    raise AssertionError(f"{exc.__name__} not raised")


def _cfg(**kw) -> B.SimConfig:
    return B.SimConfig(pool=B.default_pool(), **kw)


def test_field_contact_defaults_follow_the_refit():
    cfg = _cfg()
    assert cfg.hit_probs == (0.35,)
    assert cfg.contact_mean_s == 3.0
    assert cfg.gap_mean_s == 70.0
    assert cfg.respawn_seek_mean_s == 7.0
    assert cfg.fight_overshoot_ms == B.FIGHT_OVERSHOOT_MS


def test_respawn_seek_has_its_own_delay():
    ar = B.weapon_model(CAT, "assault_rifle")
    players = [B.Player(i, i, ar, B.default_pool()) for i in range(2)]
    cfg = _cfg(respawn_seek_mean_s=7.0)
    match = B.Match(players, random.Random(SEED), cfg, 0.35, 1)
    players[0].alive = False
    players[0].reload_amount = 3
    players[0].next_ready = 9999
    match._respawn(players[0], 1000.0)
    assert players[0].reload_amount == 0 and players[0].next_ready == 1000.0
    seek = [t for t, _, kind, pid, _ in match.heap if kind == match.SEEK and pid == 0]
    assert len(seek) == 1 and seek[0] > 1000.0
    assert seek[0] < 1000.0 + 70_000.0


def test_an_attacker_can_seek_again_after_its_target_respawns():
    ar = B.weapon_model(CAT, "assault_rifle")
    players = [B.Player(i, i, ar, B.default_pool()) for i in range(2)]
    cfg = _cfg(respawn_seek_mean_s=7.0)
    match = B.Match(players, random.Random(SEED), cfg, 0.35, 1)
    players[0].target = 1
    players[1].attackers = 1
    match._death(players[1], players[0], 1000.0, dot=False)
    seek = [(t, gen) for t, _, kind, pid, gen in match.heap if kind == match.SEEK and pid == 0]
    assert len(seek) == 1
    assert seek[0][0] > 1000.0 + cfg.pool.respawn_ms
    assert seek[0][0] < 1000.0 + cfg.pool.respawn_ms + 7_000.0
    assert seek[0][1] == players[1].pid + 1


def test_refit_respawn_to_first_hit_stays_near_the_field():
    """The TDM roster is the slowest field case. The field median is 7.2 s (CI 5.0 to 11.2)."""
    ids = ("assault_rifle", "sniper_rifle", "sniper_rifle", "charge_rifle")
    teams = (0, 1, 1, 0)
    cfg = _cfg(match_ms=651_700.0)

    class HitMatch(B.Match):
        def __init__(self, *args):
            super().__init__(*args)
            self.hits = []
            self.respawns = []

        def _hit(self, src, tgt, dmg, t):
            self.hits.append((t, tgt.pid))
            super()._hit(src, tgt, dmg, t)

        def _respawn(self, p, t, gen=0):
            self.respawns.append((t, p.pid))
            super()._respawn(p, t, gen)

    rng = B.cell_rng(SEED, "respawn_fit")
    delays = []
    for _ in range(40):
        players = [B.Player(i, teams[i], B.weapon_model(CAT, wid), cfg.pool) for i, wid in enumerate(ids)]
        match = HitMatch(players, rng, cfg, cfg.hit_probs[0], 2)
        match.run()
        for t, pid in match.respawns:
            next_hits = [ht for ht, victim in match.hits if victim == pid and ht >= t]
            if next_hits:
                delays.append((min(next_hits) - t) / 1000.0)
    assert len(delays) > 100
    assert 5.0 <= sorted(delays)[len(delays) // 2] <= 11.2


def test_fight_press_medians_track_the_field():
    rng = random.Random(SEED)
    for weapon_id, observed in (("usp", 196), ("amr", 440), ("deagle", 714), ("sniper_rifle", 1528)):
        fire = CAT.fire_ms(weapon_id)
        samples = sorted(B.fight_semi_interval(rng, fire) for _ in range(3000))
        median = samples[len(samples) // 2]
        assert fire <= median <= fire * 1.25, (weapon_id, median)
        assert abs(median - observed) / observed < 0.18, (weapon_id, median, observed)


def test_fight_press_keeps_bolt_lever_on_the_original_pull_model():
    assert B.FIGHT_OVERSHOOT_MS < B.DEFAULT_PULL_MS
    cfg = _cfg(range_model=False, tactical_reload=False, hit_probs=(1.0,), match_ms=20_000.0)
    sniper = B.weapon_model(CAT, "sniper_rifle")
    kills = [k for k in (_kill_trace(sniper, cfg, seed)[1] for seed in range(80)) if k is not None]
    mean = sum(kills) / len(kills)
    want = CAT.paced_cycle_ms("sniper_rifle")
    assert abs(mean - want) / want < 0.06, (mean, want)


def test_published_single_shot_cycle_matches_both_fight_sims():
    """Every mode-7 row, hidden rows included, publishes the sims' interval: the sampled fight interval for an
    ordinary single shot, and the pull model for the bolt Sniper."""
    rng = random.Random(SEED)
    rows = [row for row in CAT._rows if CAT._frame_int(row["weapon_id"], "mode") == 7]
    assert {row["weapon_id"] for row in rows} == {
        "bolt_rifle", "shotgun", "sniper_rifle", "plasma_sniper", "amr",
        "glock", "usp", "deagle", "rocket_launcher", "ion_sniper",
    }
    assert abs(B.FIGHT_OVERSHOOT_MS - ((196 - 190) + (440 - 350) + (714 - 700)) / 3) < 0.01
    assert R.FIGHT_OVERSHOOT_MS == B.FIGHT_OVERSHOOT_MS
    for row in rows:
        wid = row["weapon_id"]
        published = CAT.paced_cycle_ms(wid)
        if row.get("reload_type") == "bolt":
            # The match sim samples the first press after the bolt. The review duel samples
            # a full press gap, which differs by about 95 ms on the 2.2 s Sniper cycle.
            match_mean = B.DEFAULT_PULL_MS + sum(
                B.semi_interval(rng, row["reload_ms"], B.DEFAULT_PULL_MS) for _ in range(5000)
            ) / 5000
            review_mean = 2 * R.PULL_MS + row["reload_ms"]
            assert abs(match_mean - published) / published < 0.02, (wid, match_mean, published)
            assert abs(review_mean - published) / published < 0.04, (wid, review_mean, published)
        else:
            fire = CAT.fire_ms(wid)
            mean = sum(B.fight_semi_interval(rng, fire) for _ in range(5000)) / 5000
            # The fit is a median. Its lognormal mean exceeds the median by about 17%.
            assert abs(mean - published) / published < 0.02, (wid, mean, published)


def test_refit_two_shooter_victim_clusters_match_the_field():
    """Group victim hits at a three second gap, as the field analysis does."""
    ar = B.weapon_model(CAT, "assault_rifle")
    cfg = _cfg(match_ms=150_000.0)

    class HitMatch(B.Match):
        def __init__(self, *args):
            super().__init__(*args)
            self.hits = []

        def _hit(self, src, tgt, dmg, t):
            self.hits.append((t, src.pid, tgt.pid))
            super()._hit(src, tgt, dmg, t)

    rng = B.cell_rng(SEED, "victim_clusters")
    multi = total = 0
    for _ in range(100):
        players = [B.Player(pid, pid // 2, ar, cfg.pool) for pid in range(4)]
        match = HitMatch(players, rng, cfg, cfg.hit_probs[0], 2)
        match.run()
        for victim in range(4):
            hits = sorted((t, shooter) for t, shooter, target in match.hits if target == victim)
            cluster = []
            for hit in hits:
                if cluster and hit[0] - cluster[-1][0] > 3000:
                    total += 1
                    multi += len({shooter for _, shooter in cluster}) >= 2
                    cluster = []
                cluster.append(hit)
            if cluster:
                total += 1
                multi += len({shooter for _, shooter in cluster}) >= 2
    assert total > 500
    assert 0.05 <= multi / total <= 0.13, (multi, total)


def test_heat_parameters_come_from_the_catalogue():
    charge = B.weapon_model(CAT, "charge_rifle")
    energy = B.weapon_model(CAT, "energy_rifle")
    assert dict(charge.heat) == CAT._row("charge_rifle")["heat"]
    assert dict(energy.heat) == CAT._row("energy_rifle")["heat"]
    edited = B.weapon_model(_edited("charge_rifle", heat__per_tap=20), "charge_rifle")
    assert dict(edited.heat)["per_tap"] == 20
    assert isinstance(hash(charge), int)


def test_charge_heat_locks_after_the_crossing_round_and_recovers():
    charge = B.weapon_model(CAT, "charge_rifle")
    dummy = B.weapon_model(_edited("assault_rifle", dmg=0), "assault_rifle")
    players = [B.Player(0, 0, charge, B.default_pool()), B.Player(1, 1, dummy, B.default_pool())]
    match = B.Match(players, random.Random(SEED), _cfg(range_model=False), 1.0, 1)
    shooter = players[0]
    shooter.target = 1
    shooter.contact_end = 20_000
    shooter.engage_id = 1
    shooter.heat = 100.0
    shooter.last_heat_ms = 0.0
    match._shot(shooter, 0.0, 1)
    assert shooter.shots == 1
    assert shooter.heat_lock_until == dict(charge.heat)["lockout_ms"]
    match._shot(shooter, 1000.0, 1)
    assert shooter.shots == 1
    match._shot(shooter, shooter.heat_lock_until, 1)
    assert shooter.shots == 2


def test_charge_heat_cools_between_rounds():
    charge = B.weapon_model(CAT, "charge_rifle")
    dummy = B.weapon_model(_edited("assault_rifle", dmg=0), "assault_rifle")
    players = [B.Player(0, 0, charge, B.default_pool()), B.Player(1, 1, dummy, B.default_pool())]
    match = B.Match(players, random.Random(SEED), _cfg(range_model=False), 1.0, 1)
    shooter = players[0]
    shooter.target = 1
    shooter.contact_end = 20_000
    shooter.engage_id = 1
    shooter.heat = 80.0
    shooter.last_heat_ms = 0.0
    match._shot(shooter, 2000.0, 1)
    assert shooter.heat == 76.0
    assert shooter.heat_lock_until < 0


def test_charge_heat_threshold_uses_catalogue_charge_and_tap_costs():
    charge = B.weapon_model(CAT, "charge_rifle")
    dummy = B.weapon_model(_edited("assault_rifle", dmg=0), "assault_rifle")
    pool = B.Pool(health=1000, armour=0, shield=0, respawn_ms=15_000)
    players = [B.Player(0, 0, charge, pool), B.Player(1, 1, dummy, pool)]
    match = B.Match(players, random.Random(SEED), _cfg(range_model=False), 1.0, 1)
    shooter = players[0]
    shooter.target = 1
    shooter.contact_end = 20_000
    shooter.engage_id = 1
    # Use one timestamp to isolate heat per pull from passive cooling.
    match._shot(shooter, 0.0, 1)
    for _ in range(3):
        match._shot(shooter, 0.0, 1)
    assert shooter.heat == 98
    assert shooter.heat_lock_until < 0
    for _ in range(2):
        match._shot(shooter, 0.0, 1)
    assert shooter.heat >= dict(charge.heat)["lock_at"]
    assert shooter.shots == 5
    assert shooter.heat_lock_until == dict(charge.heat)["lockout_ms"]


def test_charge_heat_toggle_at_real_tap_cadence():
    charge = B.weapon_model(_edited("charge_rifle", heat__per_charge=55, heat__per_tap=14), "charge_rifle")
    dummy = B.weapon_model(_edited("assault_rifle", dmg=0), "assault_rifle")
    pool = B.Pool(health=1000, armour=0, shield=0, respawn_ms=15_000)
    for cooling, locked in ((True, False), (False, True)):
        players = [B.Player(0, 0, charge, pool), B.Player(1, 1, dummy, pool)]
        match = B.Match(players, random.Random(SEED), _cfg(range_model=False, heat_cool_while_firing=cooling), 1.0, 1)
        shooter = players[0]
        shooter.target, shooter.contact_end, shooter.engage_id = 1, 20_000, 1
        for i in range(6):
            match._shot(shooter, i * 285.0, 1)
        assert (shooter.heat_lock_until > 0) is locked, (cooling, shooter.heat)
    shipped = B.weapon_model(CAT, "charge_rifle")
    for cooling in (True, False):
        players = [B.Player(0, 0, shipped, pool), B.Player(1, 1, dummy, pool)]
        match = B.Match(players, random.Random(SEED), _cfg(range_model=False, heat_cool_while_firing=cooling), 1.0, 1)
        shooter = players[0]
        shooter.target, shooter.contact_end, shooter.engage_id = 1, 20_000, 1
        for i in range(4):
            match._shot(shooter, i * 285.0, 1)
        assert shooter.heat_lock_until < 0, (cooling, shooter.heat)


def test_three_cooling_branches_at_tap_cadence():
    for charge, tap, shots, locks in ((55, 14, 6, {"after_lockout", "none"}),
                                      (70, 16, 4, set())):
        cat = _edited("charge_rifle", heat__per_charge=charge, heat__per_tap=tap)
        weapon = B.weapon_model(cat, "charge_rifle")
        for branch in B.HEAT_COOLING_BRANCHES:
            clock = list(B._cr_shots(0, weapon.pull_dmg, weapon.tap_dmg, weapon.rounds_per_charge,
                                     285, weapon.mag, weapon.reserve, weapon.reload_ms, 1.0,
                                     start_charged=True, heat=dict(weapon.heat), heat_cooling=branch))
            assert (clock[shots - 1][0] > (shots - 1) * 285) is (branch in locks)


def test_energy_vent_uses_each_catalogue_pull():
    heat = dict(B.weapon_model(CAT, "energy_rifle").heat)
    assert B.vent_pulls(99, heat) == 1
    assert B.vent_pulls(200, heat) == 3
    assert B.vent_pulls(heat["lock_at"], {**heat, "vent_per_pull": 100}) == 1
    energy = B.weapon_model(CAT, "energy_rifle")
    dummy = B.weapon_model(_edited("assault_rifle", dmg=0), "assault_rifle")
    players = [B.Player(0, 0, energy, B.default_pool()), B.Player(1, 1, dummy, B.default_pool())]
    match = B.Match(players, random.Random(SEED), _cfg(range_model=False, pull_ms=0), 1.0, 1)
    shooter = players[0]
    shooter.target, shooter.contact_end, shooter.engage_id = 1, 20_000, 1
    shooter.heat = 197
    match._shot(shooter, 0, 1)
    assert shooter.heat == 95
    assert shooter.heat_lock_until == energy.reload_ms


def test_shields_rule_reads_charge_heat_and_cooling_branch():
    for branch, expected in (("throughout", True), ("none", False)):
        model = B.RecoilDuelModel.from_catalog(CAT, health_preset="shields", heat_cooling=branch)
        assert dict(model.cr_heat) == CAT._row("charge_rifle")["heat"]
        result = B.recoil_duel_batch(B.run_recoil_duel_rule1, "cr", 200, SEED, "gate_rule1",
                                     model, float(B.CHARGE_TAP_CADENCE_MS))
        assert (result.win_rate > 0.6) is expected


def test_kill_count_summary_names_its_horizon():
    summary = B.summary_text([], _cfg(), "assault_rifle", [2], [], "balance")
    assert "150 s kill-count win rate" in summary
    assert "kills/1v1" in summary
    short_summary = B.summary_text([], _cfg(match_ms=90_000), "assault_rifle", [2], [], "balance")
    assert "90 s kill-count win rate" in short_summary
    assert "150 s kill-count win rate" not in short_summary


def test_reload_credits_ammo_only_after_completion():
    ar = B.weapon_model(CAT, "assault_rifle")
    players = [B.Player(i, i, ar, B.default_pool()) for i in range(2)]
    match = B.Match(players, random.Random(SEED), _cfg(range_model=False), 1.0, 1)
    shooter = players[0]
    shooter.ammo = 0
    before = shooter.reserve
    match._start_reload(shooter, 100.0)
    assert shooter.ammo == 0 and shooter.reserve == before
    shooter.target, shooter.contact_end, shooter.engage_id = 1, 20_000, 1
    match._shot(shooter, shooter.reload_until, 1)
    assert shooter.ammo == ar.mag - 1 and shooter.reserve == before - ar.mag


def test_old_seek_does_not_replace_a_live_engagement():
    ar = B.weapon_model(CAT, "assault_rifle")
    players = [B.Player(i, i, ar, B.default_pool()) for i in range(2)]
    match = B.Match(players, random.Random(SEED), _cfg(range_model=False), 0.35, 1)
    match._seek(players[0], 0.0)
    match._release(players[0], 100.0)
    match._death(players[0], players[1], 200.0, dot=False)
    match._respawn(players[0], 300.0)
    match._seek(players[0], 400.0)
    target, gen, attackers = players[0].target, players[0].engage_id, players[1].attackers
    match._seek(players[0], 500.0)
    assert (players[0].target, players[0].engage_id, players[1].attackers) == (target, gen, attackers)


def test_energy_heat_vents_with_one_lever_pull_and_a_reload():
    energy = B.weapon_model(CAT, "energy_rifle")
    dummy = B.weapon_model(_edited("assault_rifle", dmg=0), "assault_rifle")
    players = [B.Player(0, 0, energy, B.default_pool()), B.Player(1, 1, dummy, B.default_pool())]
    match = B.Match(players, random.Random(SEED), _cfg(range_model=False), 1.0, 1)
    shooter = players[0]
    shooter.target = 1
    shooter.contact_end = 20_000
    shooter.engage_id = 1
    shooter.heat = 96.0
    shooter.last_heat_ms = 0.0
    match._shot(shooter, 0.0, 1)
    assert shooter.shots == 1
    assert shooter.heat_lock_until >= energy.reload_ms
    assert shooter.ammo == energy.mag - 1
    assert shooter.reload_amount == 1
    match._shot(shooter, 1000.0, 1)
    assert shooter.shots == 1
    match._shot(shooter, shooter.heat_lock_until, 1)
    assert shooter.shots == 2
    assert shooter.ammo == energy.mag - 1
    assert shooter.reload_amount == 0


def test_energy_vent_cools_from_lock_end_when_next_shot_is_late():
    energy = B.weapon_model(_edited("energy_rifle", heat__cool_per_s=30), "energy_rifle")
    dummy = B.weapon_model(_edited("assault_rifle", dmg=0), "assault_rifle")
    players = [B.Player(0, 0, energy, B.default_pool()), B.Player(1, 1, dummy, B.default_pool())]
    match = B.Match(players, random.Random(SEED), _cfg(range_model=False, pull_ms=0), 1.0, 1)
    shooter = players[0]
    shooter.target, shooter.contact_end, shooter.engage_id = 1, 20_000, 1
    shooter.heat = 96.0
    match._shot(shooter, 0.0, 1)
    lock_end = shooter.heat_lock_until
    residual_heat = shooter.heat
    match._shot(shooter, lock_end + 1000.0, 1)
    expected = max(0.0, residual_heat - dict(energy.heat)["cool_per_s"]) + dict(energy.heat)["per_shot"]
    assert shooter.heat == expected


def test_heated_auto_vent_refills_cell_and_resets_recoil():
    profile = B.RecoilProfile(crisp=100, degraded=50, heavy=25, after_shots=1,
                              heavy_after=2, settle_ms=600)
    heat = {"per_shot": 50, "lock_at": 100, "vent": "lever", "vent_per_pull": 100,
            "cool_per_s": 0}
    shots = B._heated_auto_shots(0.0, 10, 100.0, 4, 4, 500.0, profile, 1.0,
                                 heat, "none", 0.0, random.Random(SEED))
    first = [next(shots) for _ in range(6)]
    assert [round(t) for t, _, _ in first] == [0, 100, 600, 700, 1200, 1300]
    assert [p for _, p, _ in first] == [1.0, 0.5, 1.0, 0.5, 1.0, 0.5]


def _edited(weapon_id: str, **changes) -> WeaponCatalog:
    """A copy of the real catalogue with one row changed through the sweep's own path syntax."""
    return B.catalogue_with(CAT, weapon_id, {k.replace("__", "."): v for k, v in changes.items()})


def test_the_pool_and_respawn_come_from_the_game_default():
    from brx_mcp.mc import state
    cfg = state.default_config("tdm")
    pool = B.default_pool()
    assert (pool.health, pool.armour, pool.shield) == (cfg["health"]["max_hp"], cfg["health"]["max_armor"], 0)
    assert pool.respawn_ms == cfg["respawn"]["delay_s"] * 1000


def test_identical_weapons_duel_near_half():
    ar = B.weapon_model(CAT, "assault_rifle")
    r = B.duel(ar, ar, _cfg(), 400, SEED)
    assert abs(r.win_rate - 0.5) < 0.07, r.win_rate


def test_the_anchor_against_itself_is_at_parity():
    ar = B.weapon_model(CAT, "assault_rifle")
    r = B.team(ar, ar, 4, _cfg(), 40, SEED)
    lo, hi = r.ci()
    assert lo < 1.0 < hi and 0.85 < r.ratio < 1.15, (r.ratio, lo, hi)


def test_strictly_more_damage_wins():
    base = B.weapon_model(CAT, "assault_rifle")
    stronger = B.weapon_model(_edited("assault_rifle", dmg=base.gun_dmg + 5), "assault_rifle")
    assert stronger.gun_dmg == base.gun_dmg + 5
    r = B.duel(stronger, base, _cfg(), 300, SEED)
    assert r.win_rate > 0.6, r.win_rate


def test_the_toxin_preset_reproduces_its_published_parity():
    """weapon-design.md §7.5b: 1.06 at N=2, 0.95 at N=10, 51% 1v1, under the shipped row's own conditions."""
    cfg = B.toxin_preset_config()
    toxin = B.weapon_model(CAT, "toxin_rifle")
    ar = B.weapon_model(CAT, "assault_rifle")
    for n, published, reps in ((2, 1.06, 150), (10, 0.95, 45)):
        r = B.team(toxin, ar, n, cfg, reps, SEED)
        lo, hi = r.ci()
        assert lo <= published <= hi, (n, r.ratio, lo, hi)
        assert r.dot_kills_test > 0, "no poison kills: the DoT is not being applied"
    d = B.duel(toxin, ar, cfg, 600, SEED)
    lo, hi = d.ci()
    assert lo <= 0.51 <= hi, (d.win_rate, lo, hi)


def test_toxin_cli_uses_the_published_gap_and_respawn_seek():
    parser = B.build_parser()
    args = parser.parse_args(["--preset", "toxin"])
    B._apply_preset(args, parser)
    expected = B.toxin_preset_config()
    assert args.gap_mean_s == expected.gap_mean_s
    assert args.respawn_seek_mean_s == expected.respawn_seek_mean_s
    off = parser.parse_args(["--heat-cool-while-firing", "off"])
    assert off.heat_cool_while_firing == "off"


def test_every_number_is_read_from_the_catalogue():
    """Change a row in a copied catalogue and the model, and the result, move with it."""
    m = B.weapon_model(CAT, "toxin_rifle")
    assert m.pull_dmg == CAT.damage_per_pull("toxin_rifle")
    assert m.fire_ms == CAT.fire_ms("toxin_rifle")
    assert (m.mag, m.reserve) == CAT.spawn_ammo("toxin_rifle")
    row = CAT._row("toxin_rifle")
    assert m.dot_per_tick == row["dot"]["per_tick"]

    edited = B.weapon_model(_edited("toxin_rifle", dmg=12, fire_ms=200, mag=5, crit_pct=25,
                                    range_band="close", dot__per_tick=0), "toxin_rifle")
    assert (edited.gun_dmg, edited.fire_ms, edited.mag, edited.crit_pct, edited.range_band,
            edited.dot_per_tick) == (12, 200, 5, 25, "close", 0)

    cfg = B.toxin_preset_config()
    ar = B.weapon_model(CAT, "assault_rifle")
    no_poison = B.weapon_model(_edited("toxin_rifle", dot__per_tick=0), "toxin_rifle")
    r0 = B.team(m, ar, 2, cfg, 60, SEED)
    r1 = B.team(no_poison, ar, 2, cfg, 60, SEED)
    assert r1.dot_kills_test == 0 and r1.ratio < r0.ratio, (r0.ratio, r1.ratio)
    # The real catalogue is untouched by the edits above.
    assert CAT._row("toxin_rifle")["dot"]["per_tick"] == row["dot"]["per_tick"]


def test_the_mechanics_follow_the_catalogue():
    charge = B.weapon_model(CAT, "charge_rifle")
    assert charge.charge_and_tap and charge.tap_dmg == CAT.tap_damage("charge_rifle")
    assert charge.rounds_per_charge == CAT.rounds_per_charge("charge_rifle")
    burst = B.weapon_model(CAT, "burst_rifle")
    assert (2 * burst.fire_ms + burst.burst_gap_ms) / 3 == CAT.cycle_ms("burst_rifle")
    assert B.weapon_model(CAT, "shotgun").chain_reload == (CAT._row("shotgun").get("reload_type") == "chain")
    assert B.weapon_model(CAT, "shotgun").headset_dmg == CAT.damage_per_pull("shotgun") - CAT.damage("shotgun")


def _kill_trace(m: "B.WeaponModel", cfg: "B.SimConfig", seed: int):
    """One uninterrupted engagement: `m` against a harmless (0-effective-damage) dummy, at the 100% hit
    chance `cfg`'s `Match` is built with. Drives the real `_seek()`/`_shot()` path -- so `cfg.range_model`
    genuinely applies -- then pins the engagement window open (`contact_end`) so nothing cuts the shot
    sequence off before the kill: `_shot()` itself stops scheduling once its next shot would land past
    `contact_end` (see the `nxt <= p.contact_end` guard), so a short window silently truncates a fight
    otherwise. Returns (hit count, ms of the killing hit) -- what `WeaponCatalog.hits_to_kill()` and
    `time_to_kill()` publish -- and whether the kill came from a headset word, which lands
    `HEADSET_WORD_DELAY_MS` after its pull (F602), so such a kill comes that much after the published time."""
    dummy = B.weapon_model(B.catalogue_with(CAT, "assault_rifle", {"wire.dmg": 0}), "assault_rifle")
    players = [B.Player(0, 0, m, cfg.pool), B.Player(1, 1, dummy, cfg.pool)]
    rng = B.cell_rng(seed, "ttk", m.weapon_id)
    match = B.Match(players, rng, cfg, 1.0, 1)
    hits: list[float] = []
    orig_hit = match._hit
    def traced(src, tgt, dmg, t):
        orig_hit(src, tgt, dmg, t)
        if src is players[0]:
            hits.append(t)
    match._hit = traced
    match._seek(players[0], 0.0)
    players[0].contact_end = 1e9
    kill_t, by_word = None, False
    while match.heap:
        t, _s, kind, pid, gen = heapq.heappop(match.heap)
        if kind not in (match.SHOT, match.WORD):
            continue   # the engagement never legitimately ends here -- CEND/TICK/RESPAWN are not pushed for pid 0
        if t > cfg.match_ms:
            break
        (match._shot if kind == match.SHOT else match._word)(players[pid], t, gen)
        if players[1].health <= 0:
            kill_t, by_word = t, kind == match.WORD
            break
    return len(hits), kill_t, by_word


def test_shot_mechanics_reproduce_hits_and_time_to_kill():
    """At a 100% hit chance with the range model off, `_shot()`'s own landed-hit count and elapsed time
    must match `WeaponCatalog.hits_to_kill()`/`time_to_kill()` exactly -- these are the numbers a player
    is shown, and both come from the shot mechanic alone, never the engagement/contact-window noise
    around it. Covers a plain weapon, a burst-free two-word pull (Shotgun), a charge-without-tap weapon
    (Rail Gun, Laser Cannon) and a charge-with-tap weapon (Charge Rifle); the Toxin Rifle runs with its
    DoT zeroed, because `hits_to_kill()`/`time_to_kill()` are gun-body numbers and do not model a tick.
    Breaking `_shot()`'s own interval (e.g. `interval = w.fire_ms + 1`) must fail this. A perfect trigger
    finger (`pull_ms` 0) on both sides, because the paced single-shot cycle is sampled, not exact: its own test
    is `test_sampled_single_shot_pulls_match_the_paced_cycle`."""
    cfg = B.SimConfig(pool=B.default_pool(), range_model=False, tactical_reload=False, hit_probs=(1.0,),
                      match_ms=20_000.0, pull_ms=0.0)
    pool_pts = cfg.pool.health + cfg.pool.armour
    for weapon_id, cat in (
        ("assault_rifle", CAT), ("smg", CAT), ("shotgun", CAT), ("sniper_rifle", CAT),
        ("rail_gun", CAT), ("laser_cannon", CAT), ("charge_rifle", CAT),
        ("toxin_rifle", _edited("toxin_rifle", dot__per_tick=0)),
    ):
        m = B.weapon_model(cat, weapon_id)
        htk = CAT.hits_to_kill(weapon_id, pool_pts)
        ttk = CAT.time_to_kill(weapon_id, pool_pts, pull_ms=0)
        n_hits, kill_ms, by_word = _kill_trace(m, cfg, SEED)
        assert n_hits == htk, (weapon_id, n_hits, htk)
        late = B.HEADSET_WORD_DELAY_MS if by_word else 0.0   # F602: the word lands 88 ms after its pull
        assert kill_ms is not None and round(kill_ms - late) == ttk, (weapon_id, kill_ms, ttk)


def test_legacy_sampled_pull_gaps_match_the_renewal_estimate():
    """The legacy pull sampler (`semi_interval`, which the bolt lever still uses) matches its renewal closed form
    at each pull rate. The published single-shot cycle no longer comes from it (F576)."""
    rng = random.Random(SEED)
    for weapon_id in ("amr", "deagle", "usp", "shotgun"):
        fire = CAT.fire_ms(weapon_id)
        for pull in (250, 300, 350):
            n = 20_000
            mean = sum(B.semi_interval(rng, fire, pull) for _ in range(n)) / n
            want = max(pull, fire + pull * math.exp(B.PULL_SIGMA * B.PULL_SIGMA) / 2)
            # The closed form is the renewal limit, exact for a long t14; a t14 well under the pull runs up to
            # about 2% short (the USP at 350 ms: 422 against 429).
            assert abs(mean - want) / want < 0.03, (weapon_id, pull, round(mean), round(want))
        assert B.semi_interval(rng, fire, 0) == fire                  # a perfect finger: the gun's own t14
        assert min(B.semi_interval(rng, fire, 300) for _ in range(2000)) >= fire   # never inside t14


def test_the_engines_fire_single_shots_at_the_paced_cycle():
    """A field fight waits t14 plus the fitted overshoot; legacy duel generators retain their sampled clock."""
    cfg = B.SimConfig(pool=B.default_pool(), range_model=False, tactical_reload=False, hit_probs=(1.0,),
                      match_ms=20_000.0)
    pool_pts = cfg.pool.health + cfg.pool.armour
    for weapon_id in ("shotgun", "deagle"):   # no crit_pct: htk is exact at a 100% hit chance (not the bolt Sniper)
        m = B.weapon_model(CAT, weapon_id)
        htk = CAT.hits_to_kill(weapon_id, pool_pts)
        traces = [_kill_trace(m, cfg, seed) for seed in range(300)]
        kills = [k for _n, k, _w in traces if k is not None]
        mean = sum(kills) / len(kills)
        by_word = sum(w for _n, k, w in traces if k is not None) / len(kills)
        want = (htk - 1) * (CAT.fire_ms(weapon_id) + B.FIGHT_OVERSHOOT_MS * math.exp(B.PULL_SIGMA ** 2 / 2)) \
            + by_word * B.HEADSET_WORD_DELAY_MS   # F602: a kill by the headset word lands 88 ms after its pull
        # The lognormal's mean, not its median: the median is about 6 ms per gap short, about 1% of a kill.
        assert abs(mean - want) / want < 0.005, (weapon_id, round(mean), round(want))
    m = _recoil_model()
    rng = random.Random(SEED)
    for name, gen in (("amr", B._amr_combatant(0.0, m, "mid", rng)), ("shotgun", B._shotgun_combatant(0.0, m, "close", rng))):
        times = [next(gen)[0] for _ in range(4)]
        gaps = [b - a for a, b in zip(times, times[1:])]
        assert min(gaps) > CAT.fire_ms(name) and len(set(gaps)) > 1, (name, gaps)   # sampled, never inside t14
    # F579: the duel's single shots wait t14 plus the field overshoot (its mean), not the old 300 ms pull, and the
    # model's own overshoot reaches them (the CLI's --fight-overshoot-ms).
    for overshoot in (B.FIGHT_OVERSHOOT_MS, 100.0):
        mm = B.RecoilDuelModel.from_catalog(CAT, fight_overshoot_ms=overshoot)
        for name, make in (("amr", lambda r: B._amr_combatant(0.0, mm, "mid", r)),
                           ("shotgun", lambda r: B._shotgun_combatant(0.0, mm, "close", r))):
            gaps = []
            for seed in range(300):
                times = [next(g)[0] for g in [make(random.Random(seed))] for _ in range(5)]
                gaps += [b - a for a, b in zip(times, times[1:])]
            want = CAT.fire_ms(name) + overshoot * math.exp(B.PULL_SIGMA ** 2 / 2)
            assert abs(sum(gaps) / len(gaps) - want) / want < 0.02, (name, overshoot, sum(gaps) / len(gaps), want)


def test_the_bolt_sniper_kills_at_the_paced_bolt_cycle():
    """F573 review (Codex): after a bolt round the player pulls the lever (one pull gap), the bolt runs, and the next
    round waits for the first press after it, so `Match._shot()` must land a two-hit kill one `paced_cycle_ms` after
    the first hit, not one bare `reload_ms`. Delete the bolt branch in `_shot()` and it lands at 2200 and fails."""
    cfg = B.SimConfig(pool=B.default_pool(), range_model=False, tactical_reload=False, hit_probs=(1.0,),
                      match_ms=20_000.0)
    m = B.weapon_model(CAT, "sniper_rifle")
    assert m.bolt and CAT.hits_to_kill("sniper_rifle", cfg.pool.health + cfg.pool.armour) == 2
    kills = [k for k in (_kill_trace(m, cfg, seed)[1] for seed in range(300)) if k is not None]
    mean, want = sum(kills) / len(kills), CAT.paced_cycle_ms("sniper_rifle")
    assert abs(mean - want) / want < 0.03, (round(mean), round(want))


def test_only_single_shot_weapons_are_player_paced():
    """The model touches t20 = 7 alone: an automatic, burst or charge weapon keeps its gun-limited cycle, and the
    sim marks exactly the single-shot rows as `semi`."""
    for weapon_id in ("assault_rifle", "smg", "burst_rifle", "charge_rifle", "rail_gun"):
        assert CAT.paced_cycle_ms(weapon_id) == CAT.cycle_ms(weapon_id), weapon_id
        assert not B.weapon_model(CAT, weapon_id).semi, weapon_id
    for weapon_id in ("amr", "deagle", "usp", "shotgun", "sniper_rifle"):   # the Sniper through the bolt branch
        assert CAT.paced_cycle_ms(weapon_id) > CAT.cycle_ms(weapon_id), weapon_id
        assert B.weapon_model(CAT, weapon_id).semi, weapon_id


def test_a_non_refreshing_dot_is_refused_like_a_stacking_one():
    """`_hit()` (~line 447) always resets the DoT clock on a hit -- that models `refresh: true` only,
    the one value the catalogue carries today. A row that turned refresh off, or stacking on, must be
    refused at `weapon_model()`, not silently modelled wrong (mirrors the existing `stack: true` guard
    a few lines above it)."""
    with raises(ValueError):
        B.weapon_model(_edited("toxin_rifle", dot__refresh=False), "toxin_rifle")
    with raises(ValueError):
        B.weapon_model(_edited("toxin_rifle", dot__stack=True), "toxin_rifle")
    # refresh: true (today's real value) and no `stack` key must both still build fine.
    B.weapon_model(_edited("toxin_rifle", dot__refresh=True), "toxin_rifle")
    B.weapon_model(CAT, "toxin_rifle")


def test_crits_raise_the_win_rate():
    ar = B.weapon_model(CAT, "assault_rifle")
    crit = B.weapon_model(_edited("assault_rifle", crit_pct=100), "assault_rifle")
    r = B.duel(crit, ar, _cfg(), 300, SEED)
    assert r.win_rate > 0.6, r.win_rate


def test_the_range_model_can_be_switched_off():
    shotgun = B.weapon_model(CAT, "shotgun")
    on, off = _cfg(venue="outdoor"), _cfg(range_model=False)
    assert B.hit_multiplier(shotgun, 2, on) < 1.0
    assert B.hit_multiplier(shotgun, 2, off) == 1.0


def test_each_range_band_is_best_at_its_own_distance():
    """A close weapon must GAIN up close, not only lose far away (the 2026-09-19 review found a model
    that only penalised, so the Shotgun could never beat the rifle at the distance it is built for)."""
    home = {"close": 0, "mid": 1, "long": 2}
    for band, d in home.items():
        best = max(B.BAND_FIT, key=lambda b: B.BAND_FIT[b][d])
        assert B.BAND_FIT[band][d] == B.BAND_FIT[best][d], (band, d, best)
        assert all(B.BAND_FIT[band][d] >= row[d] for row in B.BAND_FIT.values())
    assert B.BAND_FIT["close"][0] > B.BAND_FIT["mid"][0] > B.BAND_FIT["long"][0]
    # and it shows in a fight: every contact close, the close weapon does better than with range off
    B.VENUE_DISTANCE["_test_all_close"] = (1.0, 0.0, 0.0)
    try:
        shotgun, ar = B.weapon_model(CAT, "shotgun"), B.weapon_model(CAT, "assault_rifle")
        close = B.duel(shotgun, ar, _cfg(venue="_test_all_close"), 300, SEED)
        flat = B.duel(shotgun, ar, _cfg(range_model=False), 300, SEED)
    finally:
        B.VENUE_DISTANCE.pop("_test_all_close", None)
    assert close.win_rate > flat.win_rate + 0.05, (close.win_rate, flat.win_rate)


def test_each_weapon_is_judged_against_its_own_slot_kind():
    usp, deagle = B.weapon_model(CAT, "deagle"), B.weapon_model(CAT, "usp")
    assert B.anchor_for(usp) == B.anchor_for(deagle) == B.ROLE_ANCHORS["sidearm"]
    assert B.anchor_for(B.weapon_model(CAT, "smg")) == B.DEFAULT_ANCHOR
    assert B.anchor_for(usp, "smg") == "smg"   # --anchor overrides the rule
    assert CAT._row(B.ROLE_ANCHORS["sidearm"])["role"] == "sidearm"


def test_a_pickup_only_weapon_is_never_flagged():
    rocket = B.weapon_model(CAT, "rocket_launcher")
    assert rocket.pickup_only
    ar = B.weapon_model(CAT, "assault_rifle")
    teams = {("rocket_launcher", 2): B.TeamResult("rocket_launcher", "assault_rifle", 2, 1, 900, 10, 1.0, 1.0, 0)}
    assert teams[("rocket_launcher", 2)].ci()[0] > 1.0     # it would be DOMINATES if flagged
    ranked = B.rank_weapons([rocket, ar], teams, {}, [2], {"rocket_launcher": "assault_rifle"})
    assert next(r for r in ranked if r["weapon"] == "rocket_launcher")["flag"] == ""


def test_the_summary_prints_no_nan_when_the_duels_did_not_run():
    out = pathlib.Path(tempfile.mkdtemp(prefix="balance_sim_nan_"))
    try:
        B.main(["--scenario", "team", "--weapon", "usp", "--n", "2", "--reps", "2", "--jobs", "1",
                "--out", str(out / "t.csv")])
        text = (out / "t_summary.txt").read_text()
        assert "nan" not in text.lower(), text
        row = next(line for line in text.splitlines() if line.startswith("usp "))
        assert row.split()[3] == "usp" and "-" in row.split(), row   # judged against usp; no duel column
    finally:
        shutil.rmtree(out, ignore_errors=True)


def test_hidden_and_non_lethal_rows_are_filtered():
    visible, skipped = B.catalogue_ids(CAT)
    hidden = {r["weapon_id"] for r in CAT._rows if r.get("hidden")}
    assert not hidden & set(visible)
    # a hidden non-lethal row (the Haze since F577) is skipped as hidden, before the lethal check
    assert {r["weapon_id"] for r in CAT._rows if r.get("lethal") is False and not r.get("hidden")} == set(skipped)
    with_hidden, _ = B.catalogue_ids(CAT, include_hidden=True)
    assert hidden - {r["weapon_id"] for r in CAT._rows if r.get("lethal") is False} <= set(with_hidden)


def test_sweep_syntax():
    assert B.parse_values("5..9") == [5, 6, 7, 8, 9]
    assert B.parse_values("90..130:20") == [90, 110, 130]
    assert B.parse_values("3000,5000") == [3000, 5000]
    assert B.parse_sweep(["dmg=5..6", "dot.per_tick=2"]) == [("dmg", [5, 6]), ("dot.per_tick", [2])]
    row = copy.deepcopy(CAT._row("toxin_rifle"))
    B.set_field(row, "dmg", 5)
    B.set_field(row, "dot.duration_ms", 3000)
    assert row["wire"]["dmg"] == 5 and row["dot"]["duration_ms"] == 3000


def test_same_seed_same_answer():
    ar = B.weapon_model(CAT, "assault_rifle")
    smg = B.weapon_model(CAT, "smg")
    a = B.duel(smg, ar, _cfg(), 50, SEED)
    b = B.duel(smg, ar, _cfg(), 50, SEED)
    assert (a.wins, a.kills_a, a.kills_b) == (b.wins, b.kills_a, b.kills_b)


def test_main_writes_a_csv_and_a_summary_where_it_is_told():
    out = pathlib.Path(tempfile.mkdtemp(prefix="balance_sim_test_"))
    try:
        rc = B.main(["--weapon", "smg", "--n", "2", "--reps", "3", "--duel-reps", "3", "--jobs", "1",
                     "--out", str(out / "r.csv")])
        assert rc == 0
        text = (out / "r.csv").read_text()
        assert text.startswith("scenario,") and "\nteam,smg,assault_rifle,2," in text
        assert "smg" in (out / "r_summary.txt").read_text()
        rc = B.main(["--weapon", "toxin_rifle", "--sweep", "dmg=7..8", "--n", "2", "--reps", "2",
                     "--duel-reps", "2", "--jobs", "1", "--out", str(out / "s.csv")])
        assert rc == 0 and "sweep_team" in (out / "s.csv").read_text()
        assert (out / "s_summary.txt").read_text().startswith("SWEEP toxin_rifle")
    finally:
        shutil.rmtree(out, ignore_errors=True)


# --------------------------------------------------------------------------- #
# Recoil duel mode (F291): Tony's three 2026-09-23 balance rules
# --------------------------------------------------------------------------- #

def test_recoil_profile_pins_the_shipped_ar_against_the_engine_test():
    """`app/test/engine.test.mjs` ('S54: the round counts are derived from the row's dmg...') pins the
    shipped Assault Rifle row's `_recoilProfile()` output at crisp 100, degraded 70, heavy 45, after 6
    rounds, heavy after 7, settled at the 600 ms floor -- Tony's 2026-09-23 deepening (F291), tightened
    the same day (R7, F308): `heavy` now starts once a burst holds past 6 rounds, an explicit
    `after_heavy: 7` declared alongside the deeper floor (was 8, one round later) so a full-auto AR
    earns its own penalty sooner, making room for the Burst Rifle to beat it (R7). Eased back 40 -> 45
    the same day, polish round 2 (F308, "full auto point blank ... too harsh"), once bench 4.3 showed
    the deeper floor read as punishing rather than a trade -- `after_shots`/`after_heavy`/`settle_ms`
    unchanged. This is the SAME row (`weapons.json` `assault_rifle`), read through the Python mirror --
    if the two ever disagree, one of the two files drifted from `app/src/engine.js` and this test is
    what catches it."""
    p = B.recoil_profile(CAT._row("assault_rifle"))
    assert p == B.RecoilProfile(crisp=100.0, degraded=70, heavy=45.0, after_shots=6, heavy_after=7,
                                settle_ms=600.0), p


def test_recoil_profile_pins_the_shipped_suppressor_row():
    """The Suppressor's own exception the OTHER way (Tony, 2026-09-23, R10, `docs/weapon-design.md`'s
    Balance rules table, row 3): "it should be weaker since its silent but not too weak." An explicit
    `heavy: 70` (not derived; every other reference-calibre weapon ships the 60 floor) declared
    alongside the captured `floor: 60`, so `recoil_profile()` reads `heavy` over `floor` and `degraded`
    derives between `crisp` and the NEW `heavy`, landing at 85, not 80. `after_shots`/`after_heavy` are
    unaffected -- they derive off the row's own `dmg` (7), not `heavy`, same as before the fix (7, 10).
    Mirrors `test_recoil_profile_pins_the_shipped_ar_against_the_engine_test` above; the AR pin also
    lives in `app/test/engine.test.mjs`, this one does not (no JS test reads the real suppressor row
    for recoil, only synthetic `dmg`-only fixtures -- see that file's own S54 test)."""
    p = B.recoil_profile(CAT._row("suppressor"))
    assert p == B.RecoilProfile(crisp=100.0, degraded=85, heavy=70.0, after_shots=7, heavy_after=10,
                                settle_ms=600.0), p


def test_a_crit_lands_1_5x_truncated_same_as_the_gun():
    """compile.py's `t6` (F62): the GUN rolls its own crit, and a crit lands `int(magnitude x
    CRIT_MULT)` -- `CRIT_MULT = 1.5`, truncated toward zero, the SAME formula `Match._shot()` already
    used. The recoil-duel/range-duel engine shares it now too (F308, polish round 1): `_ar_shots` and
    `_burst3_shots` both take `crit_pct`, rolled once per round, independent of the hit roll. This
    needs no RNG statistics -- `crit_pct=100`/`crit_pct=0` force every round one way or the other, so
    it pins the ARITHMETIC (including the truncation: 13 x 1.5 = 19.5, and the shipped rule is 19, not
    a rounded 20) without touching the accuracy model at all."""
    rng = random.Random(0)
    gen = B._ar_shots(0.0, 13, 100.0, 999, 0, 0, None, 1.0, rng=rng, crit_pct=100)
    assert next(gen)[2] == 19, "int(13 * 1.5) = 19 -- truncated, not rounded"
    gen0 = B._ar_shots(0.0, 13, 100.0, 999, 0, 0, None, 1.0, rng=rng, crit_pct=0)
    assert next(gen0)[2] == 13, "crit_pct=0 must never roll a crit"
    # the Burst Rifle's own shipped numbers (dmg 10, crit_pct 40): a forced crit lands int(10*1.5) = 15
    genb = B._burst3_shots(0.0, 10, 75.0, 275.0, 999, 0, 0, 1.0, rng=rng, crit_pct=100)
    assert next(genb)[2] == 15, "int(10 * 1.5) = 15"
    genb0 = B._burst3_shots(0.0, 10, 75.0, 275.0, 999, 0, 0, 1.0, rng=rng, crit_pct=0)
    assert next(genb0)[2] == 10, "crit_pct=0 must never roll a crit"


def test_recoil_profile_pins_the_engine_tests_synthetic_rows_too():
    """The same table `app/test/engine.test.mjs` pins for energy_rifle/smg/force_rifle/stinger/
    suppressor/toxin_rifle (reference calibre, a heavier round, the lightest and heaviest calibres, and
    an odd midpoint that must round DOWN) -- restated here so a change to the derivation's arithmetic,
    not just the AR's own numbers, shows up on both sides."""
    def row(dmg, **recoil):
        return {"dmg": dmg, "recoil": recoil}

    def want(crisp, degraded, heavy, after_shots, heavy_after):
        return B.RecoilProfile(crisp=crisp, degraded=degraded, heavy=heavy, after_shots=after_shots,
                               heavy_after=heavy_after, settle_ms=600.0)

    cases = [
        (row(8, ceiling=100, floor=70, per_shot=10, recover_ms=150), want(100, 85, 70, 6, 9)),
        (row(8, ceiling=100, floor=60, per_shot=15, recover_ms=150), want(100, 80, 60, 6, 9)),
        (row(9, ceiling=100, floor=60, per_shot=10, recover_ms=150), want(100, 80, 60, 5, 8)),
        (row(13, ceiling=100, floor=60, per_shot=8, recover_ms=120), want(100, 80, 60, 4, 6)),
        (row(7, ceiling=100, floor=60, per_shot=15, recover_ms=150), want(100, 80, 60, 7, 10)),
        (row(7, ceiling=100, floor=65, per_shot=10, recover_ms=150), want(100, 82, 65, 7, 10)),
    ]
    for r, expected in cases:
        assert B.recoil_profile(r) == expected, (r, B.recoil_profile(r), expected)
    # a one-press trigger (floor == ceiling) and a missing recoil block both carry nothing to degrade.
    assert B.recoil_profile({"dmg": 9, "recoil": {"ceiling": 100, "floor": 100, "per_shot": 0}}) is None
    assert B.recoil_profile({"dmg": 9}) is None


def test_the_charge_rifle_carries_no_recoil_profile():
    """`ceiling == floor == 100` on the Charge Rifle row: it cannot degrade, so its accuracy is fixed at
    100 for both the charge and every tap (`_cr_shots` never reads a profile)."""
    assert B.recoil_profile(CAT._row("charge_rifle")) is None


def _recoil_model(**kw) -> B.RecoilDuelModel:
    return B.RecoilDuelModel.from_catalog(CAT, **kw)


def test_recoil_duel_seeded_runs_land_in_band():
    """One seeded run per rule, at a rep count small enough to stay well under the suite's speed
    budget, pinned to a band around the value this exact model gives at SEED -- reproducible per the
    module's own convention (`cell_rng`: the seed plus the cell key, not run order)."""
    m = _recoil_model()
    r1 = B.recoil_duel_batch(B.run_recoil_duel_rule1, "cr", 2000, SEED, "rule1_test", m,
                             float(B.CHARGE_TAP_CADENCE_MS))
    r2 = B.recoil_duel_batch(B.run_recoil_duel_rule2, "ar", 2000, SEED, "rule2_test", m,
                             float(B.CHARGE_TAP_CADENCE_MS))
    r3 = B.recoil_duel_batch(B.run_recoil_duel_rule3, "burst", 2000, SEED, "rule3_test", m)
    assert 0.88 < r1.win_rate < 0.98, r1.win_rate    # rule 1: a charged CR clearly beats an AR
    assert 0.82 < r2.win_rate < 0.98, r2.win_rate     # rule 2: the AR is burst-disciplined too (Tony's
                                                       # 2026-09-23 correction) and the Charge Rifle's tap
                                                       # damage moved 20->16 (wire.tap_dmg, t37 -- a real
                                                       # gun-enforced lever; the tap CADENCE stays the
                                                       # bench-measured 285ms, it was never a gun setting)
    assert 0.60 < r3.win_rate < 0.85, r3.win_rate     # rule 3: the deepened AR ladder (degraded 70,
                                                       # heavy 40 from round 8, Tony 2026-09-23) now clears
                                                       # rule 3 at the DEFAULT 150-300 ms pause -- shipped
    # same seed, same cell key -> the same answer, regardless of what else ran first (parallel-safe).
    again = B.recoil_duel_batch(B.run_recoil_duel_rule1, "cr", 2000, SEED, "rule1_test", m,
                                float(B.CHARGE_TAP_CADENCE_MS))
    assert (again.wins, again.reps) == (r1.wins, r1.reps)


def test_recoil_duel_rule3_wins_more_with_a_shorter_burst_pause():
    """The burst player is ALWAYS crisp in this model (burst_max 5 < the AR's derived after_shots 6:
    see `test_recoil_profile_pins_the_shipped_ar_against_the_engine_test`), so the 150-300 ms pause
    buys it no recoil recovery it did not already have on release -- it is pure dead time. Before
    Tony's 2026-09-23 AR ladder deepening (degraded 70, heavy 40 from round 7), shrinking the pause was
    the ONLY lever that got rule 3 over 60%; the deepened ladder now clears it at the shipped 150-300 ms
    pause too (see `test_recoil_duel_seeded_runs_land_in_band`), so a shorter pause only widens the
    margin further -- this pins that it still does, not that it is still load-bearing."""
    m = _recoil_model(burst_pause_min_ms=0.0, burst_pause_max_ms=50.0)
    r = B.recoil_duel_batch(B.run_recoil_duel_rule3, "burst", 4000, SEED, "rule3_shortpause", m)
    assert r.win_rate > 0.9, r.win_rate


def test_recoil_duel_rules_clear_the_65_percent_bar():
    """The CI gate for `docs/weapon-design.md`'s Balance rules table, row 4 (Tony, 2026-09-23, F291):
    three duel rules, each meaning the named side wins AT LEAST 65% of a stochastic 1v1 at full
    Standard health. 10,000 reps a rule keeps the win rate stable (it lands near the 94/91/72% the
    `--scenario recoil-duel` module docstring reports at the same rep count) while this file still
    runs in a couple of seconds. Every number comes from `WeaponCatalog` (`weapons.json`), read through
    `RecoilDuelModel.from_catalog`, so a catalogue edit that weakens a rule fails HERE, not on the
    bench. Break it once (e.g. set the Charge Rifle's `wire.tap_dmg` back to 20) and watch rule 2 go
    red, then restore it."""
    m = _recoil_model()
    reps = 10_000
    r1 = B.recoil_duel_batch(B.run_recoil_duel_rule1, "cr", reps, SEED, "gate_rule1", m,
                             float(B.CHARGE_TAP_CADENCE_MS))
    r2 = B.recoil_duel_batch(B.run_recoil_duel_rule2, "ar", reps, SEED, "gate_rule2", m,
                             float(B.CHARGE_TAP_CADENCE_MS))
    r3 = B.recoil_duel_batch(B.run_recoil_duel_rule3, "burst", reps, SEED, "gate_rule3", m)
    assert r1.win_rate >= 0.65, (
        f"Rule 1 broke: a Charge Rifle with its charge already built should beat an Assault Rifle "
        f"most of the time, but it won only {r1.win_rate:.1%} of {reps} duels (needs >= 65%). See "
        "docs/weapon-design.md's Balance rules table, row 4 (F291)."
    )
    assert r2.win_rate >= 0.65, (
        f"Rule 2 broke: a skilled Assault Rifle (controlled bursts) that catches an uncharged Charge "
        f"Rifle should beat it most of the time, but it won only {r2.win_rate:.1%} of {reps} duels "
        "(needs >= 65%). See docs/weapon-design.md's Balance rules table, row 4 (F291)."
    )
    assert r3.win_rate >= 0.65, (
        f"Rule 3 broke: an Assault Rifle firing controlled 3-5 round bursts should beat one held in "
        f"full auto most of the time, but it won only {r3.win_rate:.1%} of {reps} duels (needs >= "
        "65%). See docs/weapon-design.md's Balance rules table, row 4 (F291)."
    )


def test_recoil_duel_cli_runs_end_to_end():
    out = pathlib.Path(tempfile.mkdtemp(prefix="balance_sim_recoil_"))
    try:
        rc = B.main(["--scenario", "recoil-duel", "--recoil-rule", "1", "--recoil-reps", "500",
                     "--seed", "3", "--out", str(out / "r.csv")])
        assert rc == 0
        text = (out / "r_summary.txt").read_text()
        assert "RECOIL DUEL" in text and "Rule 1: charged CR beats AR" in text
        assert "Rule 3" not in text   # --recoil-rule 1 runs only rule 1
    finally:
        shutil.rmtree(out, ignore_errors=True)


def test_range_duel_close_band_adds_the_headset_word_mid_does_not():
    """`_pull_dmg()` is the whole close/mid mechanism (F308): close = gun word + a declared headset
    word, mid = gun word alone. Direct, RNG-free check of the numbers Tony gave -- SMG 7+2=9 close /
    7 mid (R5, 2026-09-23: moved from 8+1 so the gun word alone drops further past the headset
    word's reach), Shotgun 19+20=39 close / 19 mid (F579, 2026-10-24: the gun word moved 20 to 19), Burst Rifle 10 either way (it declares no
    headset word)."""
    m = _recoil_model()
    assert B._pull_dmg(m.smg_gun_dmg, m.smg_headset_dmg, "close") == 9 == m.smg_gun_dmg + m.smg_headset_dmg
    assert B._pull_dmg(m.smg_gun_dmg, m.smg_headset_dmg, "mid") == 7 == m.smg_gun_dmg
    assert B._pull_dmg(m.sg_gun_dmg, m.sg_headset_dmg, "close") == 39
    assert B._pull_dmg(m.sg_gun_dmg, m.sg_headset_dmg, "mid") == 19
    assert m.br_dmg == 10   # no headset word declared; band never touches it


# F308, polish round 2 (Tony, 2026-09-24, "full auto point blank ... too harsh"): the AR's `heavy`
# recoil eased 40 -> 45 and the Burst Rifle's `overrides.t23` gap eased 550 -> 540ms. Tony kept the
# rock-paper-scissors triangle (a bursting AR beats a full-auto AR and the Burst Rifle, the Burst
# Rifle beats a full-auto AR) but accepted that R7 now holds "more often than not" rather than "most
# of the time": its own bar drops 65% -> 55%, alone. R3 and R6 (also AR-recoil-adjacent) stay at 65%
# -- both still clear it comfortably at the new numbers. A per-rule bar, not a global one, so only R7
# reads differently.
RANGE_BAR_STANDARD = 0.65
RANGE_BAR_OVERRIDES = {"7": 0.55}   # F308, 2026-09-24: R7 alone, see the comment above


def _range_bar(key: str) -> float:
    return RANGE_BAR_OVERRIDES.get(key, RANGE_BAR_STANDARD)


def test_range_duel_rules_clear_their_bar():
    """The CI gate for `docs/weapon-design.md`'s Balance rules table, rows R4-R9 (Tony, 2026-09-23,
    F308). Every number comes from `WeaponCatalog` (`weapons.json`), read through
    `RecoilDuelModel.from_catalog`, so a catalogue edit that weakens a rule fails HERE, not on the
    bench. Break it once (e.g. put the Burst Rifle's `overrides.t23` back to 275) and watch R6 go red
    (13%, the pre-fix reading), then restore it.

    Nine cells cleared 65% at 10,000 reps the day this rule shipped. Two needed a second round of
    tuning the same day (Tony, 2026-09-23, approved): R5's SMG pairing (a bursting AR beats a
    full-auto SMG past headset range) read only ~62% with no lever in scope until the SMG's own
    split moved 8+1 to 7+2; R7 (Burst Rifle beats a full-auto AR) shared R6's only lever and lost
    margin to it until the Assault Rifle's own `after_heavy` tightened 8 to 7.

    Modelling crits (polish round 1, same day, F308 -- see `test_a_crit_lands_1_5x_truncated_same_as_
    the_gun` below) reopened R4b and R6: the Burst Rifle's own 40% `crit_pct` raises its average round
    damage about 20%, and its `overrides.t23` gap (410ms) no longer held R6 or R4's SMG pairing above
    65% once that was modelled (R4b ~48.8%, R6 ~21.7%). Tony kept the 40% crit and moved the gap again
    instead (410 -> 550ms, the smallest single-token value of the three swept -- dmg, crit_pct, gap --
    that clears R4b, R4d, R6 and R7 together; docs/weapon-design.md Sec7.5d has the full sweep, kept
    as history). All ten cells cleared 65% with the crit modelled and the 550ms gap shipped.

    Polish round 2 (Tony, 2026-09-24, F308, "full auto point blank ... too harsh"): the AR's `heavy`
    eased 40 -> 45 and the gap eased 550 -> 540ms, softening R7 to ~57.1% -- under the old 65% bar, so
    R7's own bar moved to 55% (`RANGE_BAR_OVERRIDES` above) instead of tuning the numbers again. R3
    and R6 (~67.1%/~66.2%) still clear 65% comfortably; every other cell is unchanged in kind."""
    m = _recoil_model()
    reps = 10_000
    results = {r.label.replace("range_", "", 1): r
              for r in B.range_duel_report(m, reps, SEED, tuple(sorted(B.RANGE_RULES)))}

    for key in sorted(B.RANGE_RULES):
        r = results[key]
        desc = B.RANGE_RULES[key][0]
        bar = _range_bar(key)
        assert r.win_rate >= bar, (
            f"{desc} broke: won only {r.win_rate:.1%} of {reps} duels (needs >= {bar:.0%}). See "
            "docs/weapon-design.md's Balance rules table (F308)."
        )


def test_range_duel_cli_runs_end_to_end():
    out = pathlib.Path(tempfile.mkdtemp(prefix="balance_sim_range_"))
    try:
        rc = B.main(["--scenario", "range-duel", "--range-rule", "6", "--recoil-reps", "500",
                     "--seed", "3", "--out", str(out / "r.csv")])
        assert rc == 0
        text = (out / "r_summary.txt").read_text()
        assert "RANGE DUEL" in text and "R6: a bursting AR beats the Burst Rifle" in text
        assert "R7:" not in text   # --range-rule 6 runs only rule 6
    finally:
        shutil.rmtree(out, ignore_errors=True)


def test_r10_sidearms_finish_a_kill_within_the_bar():
    """The CI gate for R10(a) (Tony, 2026-09-23, F308, docs/weapon-design.md's Balance rules table
    row 10): each live sidearm (USP, Desert Eagle -- the Glock is `hidden`) finishes an undefended
    35 HP target within `R10_FINISH_BAR_MS` median, reaction delay included. The bar moved 1.0 -> 1.2 s
    on 2026-10-17 (Tony: "1.2s on the pistol time to finish seems fine"), when the single-shot cycle
    became player-paced: at 300 ms pulls the USP (12 at 190 ms) reads about 1066 ms and the unchanged
    Desert Eagle about 1173 ms. At 350 ms pulls the Desert Eagle sits ON the bar (1192-1206 ms across
    seeds, Opus review); Tony kept it unchanged, so only the 300 ms model is gated."""
    m = _recoil_model()
    reps = 10_000
    for kind in B.R10_SIDEARMS:
        r = B.finish_time_batch(m, kind, reps, SEED)
        assert r.median_ms < B.R10_FINISH_BAR_MS, (
            f"{B.R10_SIDEARM_NAMES[kind]} broke R10(a): median finish time {r.median_ms:.0f}ms "
            f"against a {B.R10_FINISH_POOL_HP} HP target (needs < {B.R10_FINISH_BAR_MS:.0f}ms). "
            "See docs/weapon-design.md's Balance rules table, row 10 (F308)."
        )


def test_r10_primaries_beat_sidearms_at_65_percent():
    """The CI gate for R10(b) (Tony, 2026-09-23, F308): every primary this engine can model beats
    each live sidearm from full Standard health at least 65% of the time. The Toxin Rifle (DoT) and
    the Force Rifle (burst mode + a real recoil ladder) are named, not modelled -- see
    `r10_summary_text`'s own trailing note for why.

    All twelve cells clear the full 65% bar. The Suppressor against the Desert Eagle used to read
    ~62% (stable at ~61.7% at 100,000 reps) until Tony's fix the same day (row 3): the Suppressor's
    `heavy` rung is now explicitly 70, not the 60 floor every other reference-calibre weapon ships
    ("it should be weaker since its silent but not too weak") -- a steadier heavy frame, not a
    looser trigger. It now reads ~77.9% against the Deagle and ~99.8% against the USP, and still
    trails every other primary against a bursting AR (~92.4%, the highest of the six), so it stays
    the weakest primary by design."""
    m = _recoil_model()
    reps = 10_000
    for p in B.R10_PRIMARIES:
        for s in B.R10_SIDEARMS:
            r = B.r10_duel_batch(m, p, s, reps, SEED)
            assert r.win_rate >= 0.65, (
                f"{B.R10_PRIMARY_NAMES[p]} vs {B.R10_SIDEARM_NAMES[s]} broke R10(b): won only "
                f"{r.win_rate:.1%} of {reps} duels (needs >= 65%). See docs/weapon-design.md's "
                "Balance rules table, row 12 (F308)."
            )


def test_r10_duel_cli_runs_end_to_end():
    out = pathlib.Path(tempfile.mkdtemp(prefix="balance_sim_r10_"))
    try:
        rc = B.main(["--scenario", "r10-duel", "--recoil-reps", "500", "--seed", "3",
                     "--out", str(out / "r.csv")])
        assert rc == 0
        text = (out / "r_summary.txt").read_text()
        assert "R10 (F308)" in text and "USP" in text and "Desert Eagle" in text
    finally:
        shutil.rmtree(out, ignore_errors=True)


def _shields_low(cells) -> list[str]:
    return [f"{name}: {r.win_rate:.1%}" for name, r in cells if r.win_rate < B.SHIELDS_BAR]


def _shields_model() -> B.RecoilDuelModel:
    m = _recoil_model(health_preset="shields")
    assert m.pool_hp == 150
    return m


# F310 (Tony, 2026-09-23: "looser but generally yes"): every duel rule the Standard gates check (R1-R3, R4-R9,
# R10b) holds on the Shields preset (45 health + 105 shield = 150) at `SHIELDS_BAR`, 60%, Tony's
# decision of 2026-09-23. R10a is left out: its 35 HP finishing target is health only, the same on every preset.
# Hardcore is reported by `--health-preset hardcore`, never gated. Three tests, so run_tests.py's SPLIT can
# spread them. Break one once (e.g. set the bar to 0.64) and watch R8 go red at ~63%, then restore it.

def test_shields_preset_recoil_rules_r1_to_r3():
    m, reps, tap = _shields_model(), 10_000, float(B.CHARGE_TAP_CADENCE_MS)
    cells = [("R1", B.recoil_duel_batch(B.run_recoil_duel_rule1, "cr", reps, SEED, "gate_rule1", m, tap)),
             ("R2", B.recoil_duel_batch(B.run_recoil_duel_rule2, "ar", reps, SEED, "gate_rule2", m, tap)),
             ("R3", B.recoil_duel_batch(B.run_recoil_duel_rule3, "burst", reps, SEED, "gate_rule3", m))]
    low = _shields_low(cells)
    assert not low, f"Shields preset under the {B.SHIELDS_BAR:.0%} bar (F310): " + "; ".join(low)


def test_shields_preset_range_rules_r4_to_r9():
    m = _shields_model()
    low = _shields_low([(r.label, r) for r in B.range_duel_report(m, 10_000, SEED)])
    assert not low, f"Shields preset under the {B.SHIELDS_BAR:.0%} bar (F310): " + "; ".join(low)


def test_shields_preset_primaries_beat_sidearms_r10b():
    m = _shields_model()
    cells = [(f"R10b {B.R10_PRIMARY_NAMES[p]} vs {B.R10_SIDEARM_NAMES[s]}", B.r10_duel_batch(m, p, s, 10_000, SEED))
             for p in B.R10_PRIMARIES for s in B.R10_SIDEARMS]
    low = _shields_low(cells)
    assert not low, f"Shields preset under the {B.SHIELDS_BAR:.0%} bar (F310): " + "; ".join(low)
