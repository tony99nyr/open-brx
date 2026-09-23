"""The balance sim (`mcp/tools/balance_sim.py`) reads every weapon number from the catalogue and gives
answers that a symmetric fight can check.

Every test uses a fixed seed and a small number of matches, so the file runs in a few seconds and the
same run gives the same numbers. The toxin test holds the published result in docs/weapon-design.md
§7.5b: 1.09 at N=2, 0.94 at N=10 and 48% in a 1v1, against the Assault Rifle.
"""
import copy
import heapq
import pathlib
import shutil
import sys
import tempfile
from contextlib import contextmanager

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import balance_sim as B  # noqa: E402
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
    `time_to_kill()` publish."""
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
    while match.heap:
        t, _s, kind, pid, gen = heapq.heappop(match.heap)
        if kind != match.SHOT:
            continue   # the engagement never legitimately ends here -- CEND/TICK/RESPAWN are not pushed for pid 0
        if t > cfg.match_ms:
            break
        match._shot(players[pid], t, gen)
        if players[1].health <= 0:
            break
    return len(hits), (hits[-1] if hits else None)


def test_shot_mechanics_reproduce_hits_and_time_to_kill():
    """At a 100% hit chance with the range model off, `_shot()`'s own landed-hit count and elapsed time
    must match `WeaponCatalog.hits_to_kill()`/`time_to_kill()` exactly -- these are the numbers a player
    is shown, and both come from the shot mechanic alone, never the engagement/contact-window noise
    around it. Covers a plain weapon, a burst-free two-word pull (Shotgun), a charge-without-tap weapon
    (Rail Gun, Laser Cannon) and a charge-with-tap weapon (Charge Rifle); the Toxin Rifle runs with its
    DoT zeroed, because `hits_to_kill()`/`time_to_kill()` are gun-body numbers and do not model a tick.
    Breaking `_shot()`'s own interval (e.g. `interval = w.fire_ms + 1`) must fail this."""
    cfg = B.SimConfig(pool=B.default_pool(), range_model=False, tactical_reload=False, hit_probs=(1.0,),
                      match_ms=20_000.0)
    pool_pts = cfg.pool.health + cfg.pool.armour
    for weapon_id, cat in (
        ("assault_rifle", CAT), ("smg", CAT), ("shotgun", CAT), ("sniper_rifle", CAT),
        ("rail_gun", CAT), ("laser_cannon", CAT), ("charge_rifle", CAT),
        ("toxin_rifle", _edited("toxin_rifle", dot__per_tick=0)),
    ):
        m = B.weapon_model(cat, weapon_id)
        htk = CAT.hits_to_kill(weapon_id, pool_pts)
        ttk = CAT.time_to_kill(weapon_id, pool_pts)
        n_hits, kill_ms = _kill_trace(m, cfg, SEED)
        assert n_hits == htk, (weapon_id, n_hits, htk)
        assert kill_ms is not None and round(kill_ms) == ttk, (weapon_id, kill_ms, ttk)


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
    assert {r["weapon_id"] for r in CAT._rows if r.get("lethal") is False} == set(skipped)
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
    shipped Assault Rifle row's `_recoilProfile()` output at crisp 100, degraded 80, heavy 60, after 6
    rounds, heavy after 9, settled at the 600 ms floor. This is the SAME row (`weapons.json`
    `assault_rifle`), read through the Python mirror -- if the two ever disagree, one of the two files
    drifted from `app/src/engine.js` and this test is what catches it."""
    p = B.recoil_profile(CAT._row("assault_rifle"))
    assert p == B.RecoilProfile(crisp=100.0, degraded=80, heavy=60.0, after_shots=6, heavy_after=9,
                                settle_ms=600.0), p


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
    assert 0.20 < r2.win_rate < 0.40, r2.win_rate     # rule 2: the AR is burst-disciplined too (Tony's
                                                       # 2026-09-23 correction), so its own 150-300 ms
                                                       # dead time costs it against a caught, tapping CR
    assert 0.20 < r3.win_rate < 0.40, r3.win_rate     # rule 3: at the default 150-300 ms pause, the burst
                                                       # player's own dead time outweighs full auto's degrade
    # same seed, same cell key -> the same answer, regardless of what else ran first (parallel-safe).
    again = B.recoil_duel_batch(B.run_recoil_duel_rule1, "cr", 2000, SEED, "rule1_test", m,
                                float(B.CHARGE_TAP_CADENCE_MS))
    assert (again.wins, again.reps) == (r1.wins, r1.reps)


def test_recoil_duel_rule3_flips_with_a_shorter_burst_pause():
    """The burst player is ALWAYS crisp in this model (burst_max 5 < the AR's derived after_shots 6:
    see `test_recoil_profile_pins_the_shipped_ar_against_the_engine_test`), so the 150-300 ms pause
    buys it no recoil recovery it did not already have on release -- it is pure dead time. Shrinking it
    is the one lever that flips rule 3 back over 60%, which is the finding the report leads with."""
    m = _recoil_model(burst_pause_min_ms=0.0, burst_pause_max_ms=50.0)
    r = B.recoil_duel_batch(B.run_recoil_duel_rule3, "burst", 4000, SEED, "rule3_shortpause", m)
    assert r.win_rate > 0.75, r.win_rate


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
