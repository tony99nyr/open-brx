"""The balance sim (`mcp/tools/balance_sim.py`) reads every weapon number from the catalogue and gives
answers that a symmetric fight can check.

Every test uses a fixed seed and a small number of matches, so the file runs in a few seconds and the
same run gives the same numbers. The toxin test holds the published result in docs/weapon-design.md
§7.5b: 1.09 at N=2, 0.94 at N=10 and 48% in a 1v1, against the Assault Rifle.
"""
import copy
import pathlib
import shutil
import sys
import tempfile

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import balance_sim as B  # noqa: E402
from brx_mcp.mc.compile import WeaponCatalog  # noqa: E402

SEED = 7
CAT = WeaponCatalog()


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
    """weapon-design.md §7.5b: 1.09 at N=2, 0.94 at N=10, 48% 1v1, under the old sim's conditions."""
    cfg = B.toxin_preset_config()
    toxin = B.weapon_model(CAT, "toxin_rifle")
    ar = B.weapon_model(CAT, "assault_rifle")
    for n, published, reps in ((2, 1.09, 150), (10, 0.94, 45)):
        r = B.team(toxin, ar, n, cfg, reps, SEED)
        lo, hi = r.ci()
        assert lo <= published <= hi, (n, r.ratio, lo, hi)
        assert r.dot_kills_test > 0, "no poison kills: the DoT is not being applied"
    d = B.duel(toxin, ar, cfg, 600, SEED)
    lo, hi = d.ci()
    assert lo <= 0.48 <= hi, (d.win_rate, lo, hi)


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
    assert B.hit_multiplier(shotgun, 0, on) == 1.0


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
