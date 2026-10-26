"""The balance review tool (`mcp/tools/balance_review.py`) gives the same verdict for the same input, and
each named test catches the candidate it exists to catch.

Verdict tests run at `REPS_SCALE`; the dominance candidate keeps a larger scale for its margin.
Matrix repeatability checks use `MATRIX_REPS_SCALE`.
Both use the same seeds and code paths as a real review, with fewer reps. A scaled verdict is never
recorded. Nothing here writes to docs/.
"""
import contextlib
import copy
import io
import json
import math
import pathlib
import random
import sys
import tempfile
from unittest import mock

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import balance_review as R  # noqa: E402
import balance_sim as B  # noqa: E402
from brx_mcp.mc.compile import PULL_SIGMA, WeaponCatalog, armed_armor, armed_shield  # noqa: E402
from brx_mcp.mc.perks import PerkCatalog  # noqa: E402

REPS_SCALE = 0.01
DOMINANCE_REPS_SCALE = REPS_SCALE
MATRIX_REPS_SCALE = 0.003


def test_older_verdict_rep_scale_matches_main():
    assert REPS_SCALE == 0.01


def test_burst_keeps_a_loaded_primary_when_deagle_needs_a_landed_hit():
    plain = R.make_kit(R.shipped_world(), "plain", "burst_rifle", "deagle")
    fast = R.replace(plain, name="fast", swap_ms=plain.swap_ms / 2,
                     guns=(R.replace(plain.guns[0], reload_ms=plain.guns[0].reload_ms / 2), plain.guns[1]))
    rng = random.Random(7)
    fighter = R.Fighter(fast, (45, 70, 0), R.REAL_AIM, R.DIST["mid"], rng)
    target = R.Fighter(plain, (5, 0, 0), 0, R.DIST["mid"], rng)
    fighter.targets = [target]
    fighter.gs[0].ammo = 16
    fighter.gs[0].count = 20

    assert fighter._finish_ms(0, target, 4643) < fast.swap_ms + fighter._finish_ms(1, target, 4643)
    assert not fighter._maybe_swap(4643)
    assert fighter.active == 0


def test_finish_estimate_counts_whole_landed_shots():
    kit = R.make_kit(R.shipped_world(), "plain", "burst_rifle", "deagle")
    deagle = kit.guns[1]
    hit = deagle.gun_dmg + deagle.head_dmg
    est = {}
    for health in (hit + 4, 2 * hit):
        rng = random.Random(7)
        fighter = R.Fighter(kit, (45, 70, 0), R.REAL_AIM, R.DIST["mid"], rng)
        target = R.Fighter(kit, (health, 0, 0), 0, R.DIST["mid"], rng)
        fighter.targets = [target]
        est[health] = fighter._finish_ms(1, target, 0)
    # Both need two landed Deagle hits, so a mean-damage count must not call the first one quicker.
    assert est[hit + 4] == est[2 * hit]


def test_a_last_round_that_kills_if_it_lands_is_a_finish():
    kit = R.make_kit(R.shipped_world(), "plain", "burst_rifle", "deagle")
    rng = random.Random(7)
    fighter = R.Fighter(kit, (45, 70, 0), R.REAL_AIM, R.DIST["close"], rng)
    target = R.Fighter(kit, (5, 0, 0), 0, R.DIST["close"], rng)
    fighter.targets = [target]
    fighter.gs[1].ammo, fighter.gs[1].reserve = 1, 0
    # Whole landed shots must not turn a likely one-round kill into "never".
    assert 0.5 < fighter._hit_chance(1) < 1
    assert fighter._finish_ms(1, target, 0) < float("inf")


def test_a_zero_success_cell_is_never_near_top():
    # Every kit is within 0.05 of a 0.011 top, but zero wins add no value.
    assert not R._near_top("hill hold", 0.0, 0.011)
    assert R._near_top("hill hold", 0.01, 0.011)


def _dry_deagle_estimate(pool, chance, rounds):
    deagle = R.make_kit(R.shipped_world(), "plain", "burst_rifle", "deagle").guns[1]
    return R.finish_estimate(deagle, pool=pool, chance=chance, ammo=rounds, reserve=0, reload_amount=0,
                             ready_at=0.0, locked_until=0.0, t=0.0, pull_ms=R.PULL_MS,
                             overshoot_ms=R.FIGHT_OVERSHOOT_MS, charged=True, count=0, dist=R.DIST["mid"],
                             heat=0.0, heat_t=0.0, heat_cool_while_firing=True)


def test_a_dry_gun_finishes_only_when_its_rounds_likely_land_the_kill():
    # Two 26-damage rounds at 0.9 against 30 health: two hits are needed and land 81% of the time.
    assert _dry_deagle_estimate(30, 0.9, 2) < float("inf")
    # One round at 0.05 against 5 health: a likely miss is not a finish.
    assert _dry_deagle_estimate(5, 0.05, 1) == float("inf")
    # One round, two hits needed: never.
    assert _dry_deagle_estimate(30, 0.9, 1) == float("inf")


def test_the_dry_estimate_is_monotonic_in_reserve_and_never_overflows():
    # Two hits at 0.2 land with even odds by round 9, with or without a reserve behind them.
    dry = _dry_deagle_estimate(30, 0.2, 9)
    deagle = R.make_kit(R.shipped_world(), "plain", "burst_rifle", "deagle").guns[1]
    stocked = R.finish_estimate(deagle, pool=30, chance=0.2, ammo=9, reserve=96, reload_amount=0, ready_at=0.0,
                                locked_until=0.0, t=0.0, pull_ms=R.PULL_MS, overshoot_ms=R.FIGHT_OVERSHOOT_MS,
                                charged=True, count=0, dist=R.DIST["mid"], heat=0.0, heat_t=0.0,
                                heat_cool_while_firing=True)
    assert dry == stocked < float("inf")
    assert _dry_deagle_estimate(30 * 26, 0.02, 1200) == float("inf")


def _copy(src: str, weapon_id: str, name: str, **wire) -> dict:
    row = copy.deepcopy(WeaponCatalog()._row(src))
    row.update(weapon_id=weapon_id, name=name)
    row.setdefault("wire", {}).update(wire)
    return row


def _raises(fn, text: str = ""):
    try:
        fn()
    except (ValueError, SystemExit) as e:
        assert text in str(e), (text, str(e))
        return
    raise AssertionError("no refusal")


def _review_cli(candidate: dict) -> tuple[int, dict]:
    """The CLI end to end: candidate file in, verdict JSON out, in a folder of this test's own."""
    with tempfile.TemporaryDirectory() as d:
        src, out = pathlib.Path(d) / "cand.json", pathlib.Path(d) / "verdict.json"
        src.write_text(json.dumps(candidate))
        with contextlib.redirect_stdout(io.StringIO()):
            code = R.main(["--candidate", str(src), "--out", str(out), "--jobs", "1", "--reps-scale", str(DOMINANCE_REPS_SCALE)])
        return code, json.loads(out.read_text())


def _shipped_specs():
    w = R.shipped_world()
    return w, R.build_kits(w, REPS_SCALE, 1, anchor_world=w)[0]


# --------------------------------------------------------------------------- the matrix

def test_the_matrix_has_todays_kits_and_columns_and_one_seed_gives_one_answer():
    """Today's kits (every visible lethal primary, plus the two combos) and the versioned
    columns. Two runs with the cache cleared give identical cells. Break it once (seed a cell from
    `random.Random()`) and watch the equality fail."""
    runs = []
    for _ in range(2):
        R.clear_cache()
        w, specs = _shipped_specs()
        runs.append(R.dominance_matrix(w, specs, MATRIX_REPS_SCALE, 1, anchor_world=w))
    a, b = runs
    assert a["kits"] == ["Assault Rifle", "Burst Rifle", "SMG", "Shotgun", "Sniper Rifle", "AMR", "Suppressor",
                         "Energy Rifle", "Charge Rifle", "Toxin Rifle", "CR+Sniper+BA", "CR+Sniper+FH"], a["kits"]
    assert a["keys"]["Sniper Rifle"] == "sniper_rifle" and a["keys"]["CR+Sniper+BA"] == "CR+Sniper+BA"
    assert R.COLUMNS == ("1v1 close", "1v1 mid", "1v1 long", "real aim close", "real aim mid", "real aim long", "long contact",
                         "peek mid", "field", "ambush", "shields", "hill hold", "ammo stress")
    assert set(R.NEAR_TOP_MARGIN) == set(R.COLUMNS)
    assert a["columns"]["Assault Rifle"]["ammo stress"] > 0
    assert len(a["field_counts"]["Assault Rifle"]) == len(R.FIELD_NS)
    assert all(test > 0 and anchor > 0 for test, anchor in a["field_counts"]["Assault Rifle"])
    assert set(a["ammo_stress_cap_hits"]) == set(a["kits"])
    assert set(a["ammo_stress_end_reasons"]) == set(a["kits"])
    assert all(sum(counts.values()) == R._reps("ammo", MATRIX_REPS_SCALE)
               for counts in a["ammo_stress_end_reasons"].values() if counts)
    assert a["ammo_stress_anchor_cap_hits"] == 0
    assert a["ammo_stress_cap_hits"]["Energy Rifle"] == 0
    assert json.dumps(a["columns"], sort_keys=True) == json.dumps(b["columns"], sort_keys=True)
    assert a["duels"] == b["duels"]
    for distance in R.DIST:
        expected = sum(a["duels"][f"real|{distance}|Assault Rifle|{other}"]
                       for other in a["kits"] if other != "Assault Rifle") / (len(a["kits"]) - 1)
        assert a["columns"]["Assault Rifle"][f"real aim {distance}"] == expected
    assert all(f"real aim {distance}" in R.matrix_markdown(a) for distance in R.DIST)
    assert R.domination_verdict(a, a)["status"] == "pass"
    assert max(row["field"] for row in a["columns"].values()) < R.FIELD_RATIO_CEILING


def test_field_score_is_zero_when_one_team_size_gets_no_kills():
    shipped = R.shipped_world()
    # F601: at 3 the fixed swap let its Deagle finish in every team size. F617: whole-hit estimates moved the seed-7
    # draws, so at 1 it now scores in every size; 2 keeps one size with no kills
    row = _copy("assault_rifle", "weak_ar", "Weak AR", dmg=2)
    world = R.World(WeaponCatalog(shipped.cat._rows + [row]), shipped.perks)
    specs = [R.KitSpec("AR", R.ANCHOR, R.SECONDARY, None, False),
             R.KitSpec("Weak AR", "weak_ar", R.SECONDARY, None, False)]
    matrix = R.dominance_matrix(world, specs, 0.001, 1, anchor_world=shipped)
    counts = matrix["field_counts"]["Weak AR"]
    assert any(kills == 0 and anchor > 0 for kills, anchor in counts), counts
    assert any(kills > 0 for kills, _ in counts), counts
    assert matrix["columns"]["Weak AR"]["field"] == 0.0


def test_four_workers_give_the_numbers_one_worker_gives():
    """--jobs changes nothing. Break it once (key a cell's rng on the worker's pid) and watch it differ."""
    w, specs = _shipped_specs()
    R.clear_cache()
    one = R.dominance_matrix(w, specs, MATRIX_REPS_SCALE, 1, anchor_world=w)
    R.clear_cache()
    four = R.dominance_matrix(w, specs, MATRIX_REPS_SCALE, 4, anchor_world=w)
    assert json.dumps(one["columns"], sort_keys=True) == json.dumps(four["columns"], sort_keys=True)
    assert one["duels"] == four["duels"]


def test_the_column_top_ignores_nan():
    """A cell that did not run is NaN. Break it once (plain max) and watch NaN win."""
    assert R._top([float("nan"), 0.4, 0.5]) == 0.5
    assert math.isnan(R._top([float("nan")]))


def test_ammo_stress_near_top_uses_a_relative_margin():
    assert R._near_top("ammo stress", 9.0, 10.0)
    assert not R._near_top("ammo stress", 8.9, 10.0)
    assert R._near_top("hill hold", 0.75, 0.80)
    assert not R._near_top("hill hold", 0.74, 0.80)
    assert not R._near_top("ammo stress", float("nan"), 10.0)


def test_ammo_stress_matrix_formats_ratio_as_ratio():
    assert R._fmt("ammo stress", 1.25) == "1.25"
    assert R._fmt("ammo stress", float("nan")) == "n/a"


def test_bolt_kits_have_no_ammo_stress_cell_or_niche_score_loss():
    world = R.shipped_world()
    specs = [R.KitSpec("AR", R.ANCHOR, R.SECONDARY, None, False),
             R.KitSpec("Sniper", "sniper_rifle", R.SECONDARY, None, False),
             R.KitSpec("Combo", "charge_rifle", "sniper_rifle", None, True)]
    matrix = R.dominance_matrix(world, specs, 0.001, 1, anchor_world=world)
    for name in ("Sniper", "Combo"):
        assert math.isnan(matrix["columns"][name]["ammo stress"])
        assert "ammo stress" not in matrix["near_top"][name]
    assert math.isfinite(matrix["top"]["ammo stress"])
    kept = R.balance_kept({}, {}, {}, matrix, matrix, None)
    assert kept["status"] == "pass"
    assert kept["numbers"]["kits_losing_last_near_top"] == []

    baseline, candidate = copy.deepcopy(matrix), copy.deepcopy(matrix)
    baseline["near_top"]["Sniper"] = ["peek mid"]
    # Ammo stress remains absent for the bolt; its own peek score determines the niche loss.
    candidate["near_top"]["Sniper"] = [column for column in ("ammo stress",)
                                          if math.isfinite(candidate["columns"]["Sniper"][column])]
    assert candidate["near_top"]["Sniper"] == []
    candidate["columns"]["Sniper"]["peek mid"] = 0.0
    lost = R.balance_kept({}, {}, {}, baseline, candidate, None)
    assert lost["status"] == "fail"
    assert lost["numbers"]["kits_losing_last_near_top"] == ["sniper_rifle"]


def test_one_round_non_bolt_has_an_ammo_stress_score():
    world = R.shipped_world()
    row = _copy("sniper_rifle", "one_round_mag", "One round magazine")
    row.update(mag=1, reserve=20, reload_type="magazine")
    candidate = R.World(WeaponCatalog(world.cat._rows + [row]), world.perks)
    specs = [R.KitSpec("AR", R.ANCHOR, R.SECONDARY, None, False),
             R.KitSpec("One round", "one_round_mag", R.SECONDARY, None, False)]
    matrix = R.dominance_matrix(candidate, specs, 0.001, 1, anchor_world=world)
    assert math.isfinite(matrix["columns"]["One round"]["ammo stress"])


def test_bolt_verdict_json_is_strict_and_null_reads_as_na():
    with tempfile.TemporaryDirectory() as d:
        src, out = pathlib.Path(d) / "candidate.json", pathlib.Path(d) / "verdict.json"
        src.write_text(json.dumps({"weapon_id": "sniper_rifle", "changes": {"wire.dmg": 56}}))
        with contextlib.redirect_stdout(io.StringIO()):
            R.main(["--candidate", str(src), "--out", str(out), "--jobs", "1", "--reps-scale", "0.001"])
        verdict = json.loads(out.read_text(), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        assert verdict["matrix"]["candidate"]["columns"]["Sniper Rifle"]["ammo stress"] is None
        assert "| Sniper Rifle | n/a | n/a |" in R.report_markdown(verdict)
        assert R._short({"ammo stress": None}) == '{"ammo stress": "n/a"}'
        with mock.patch.object(R, "record_guard"), mock.patch.object(R, "record") as record:
            R.main(["--record-from", str(out), "--call", "Tony: retain"])
        assert record.call_args.args[0]["matrix"]["candidate"]["columns"]["Sniper Rifle"]["ammo stress"] is None


def test_report_scenario_copy_uses_the_current_assumptions():
    reasons = {"dry": 1, "died_reloading": 0, "died_heat_locked_or_venting": 0,
               "died_swapping": 0, "cap": 0}
    matrix = {"kits": ["AR", "Sniper"], "specs": {"AR": {"perk": None},
              "Sniper": {"perk": None, "primary": "sniper_rifle"}},
              "columns": {"AR": {column: 1.25 for column in R.COLUMNS},
                          "Sniper": {column: (float("nan") if column == "ammo stress" else 0.5)
                                     for column in R.COLUMNS}},
              "near_top": {"AR": [], "Sniper": []}, "ammo_stress_kills": {"AR": 5.0,
                                                                    "Sniper": float("nan")},
              "ammo_stress_anchor_kills": 4.0, "ammo_stress_anchor_cap_hits": 0,
              "ammo_stress_anchor_end_reasons": reasons,
              "ammo_stress_end_reasons": {"AR": reasons, "Sniper": reasons}}
    verdict = {"title": "copy", "scenario_version": R.SCENARIO_VERSION, "seed": R.SEED,
               "git_sha": "abc", "fingerprint": "abc", "date": "2026-10-18",
               "reps_scale": 1, "pass": True, "tests": {
                   "op_rule": {"status": "pass", "numbers": {}},
                   "marksman_rush_counter": {"status": "n/a", "numbers": {}}},
               "candidate": {}, "facts": {}, "matrix": {"baseline": matrix, "candidate": matrix},
               "rules": {"shipped": {}, "baseline": {}, "candidate": {}}, "ttk": [],
               "assumptions": {}, "not_modelled": [],
               "rush_speed_sweep": {"rows": [{"speed_m_s": speed,
                   "plain": {"rush_success": 0.4}, "body_armor": {"rush_success": 0.5}}
                   for speed in R.RUSH_SPEED_SWEEP], "verdict_flips": True},
               "aim_sweep": R.aim_sweep_status(
                   [{"aim": aim, "mid": 0.4, "long": 0.5} for aim in R.AIM_SWEEP],
                   {"1v1 mid": 0.5, "1v1 long": 0.5}),
               "haze_blind_sweep": [{"blind_ms": ms, "win_vs_ar_body_armor": 0.7}
                                    for ms in R.HAZE_BLIND_SWEEP_MS],
               "hill": {"hold": [], "overwatch": [], "contest": []},
               "pistol_finishers": [{"primary": "AR", "pistol": "USP", "finish_ms": 1,
                                     "reload_finish_ms": 2, "bar_ms": 3, "beats_staying": True}]}
    with mock.patch.object(R, "REAL_AIM", 0.73), mock.patch.object(R, "AMMO_STRESS_ATTACKER_AIM", 0.17), \
            mock.patch.object(R, "AMMO_PICKUP_AFTER_KILLS", 7), \
            mock.patch.object(R, "HILL_SECOND_ATTACKER_MS", 4200), \
            mock.patch.object(B, "R10_FINISH_POOL_HP", 42):
        report = R.report_markdown(verdict)
    assert "holder has 0.73 aim" in report
    assert "attackers have 0.17 aim" in report
    assert "after 7 kills" in report
    assert "arrives 4.2 s later" in report
    assert "with 42 HP left" in report
    assert "Bolt kits are n/a" in report
    assert "chain reload can be interrupted only in ammo stress" in report
    assert "| Sniper | n/a | n/a |" in report
    assert "## Rush speed sensitivity" in report
    assert "## In-fight aim sensitivity" in report
    assert "## Haze blind-duration sensitivity" in report


# --------------------------------------------------------------------------- the named tests, end to end

def test_a_dominant_candidate_fails_no_domination():
    """An Assault Rifle copy at about four and a half times the damage (40) is near the top everywhere (at three times, 27, the 75-damage
    bolt Sniper still out-peeks it at range: F573). Break it once (every margin -1) and watch it pass."""
    code, v = _review_cli({"title": "dominant", "row": _copy("assault_rifle", "test_ar_heavy", "Test AR heavy", dmg=40)})
    t = v["tests"]["no_domination"]
    assert t["status"] == "fail" and "Test AR heavy" in t["numbers"]["near_top_everywhere"], t
    assert code == 1 and v["pass"] is False and v["reps_scale"] == DOMINANCE_REPS_SCALE


def test_an_ar_at_27_damage_fails_no_domination():
    v = R.review({"row": _copy("assault_rifle", "crit_ar_27", "Crit AR 27", dmg=27)},
                 reps_scale=DOMINANCE_REPS_SCALE)
    t = v["tests"]["no_domination"]
    assert t["status"] == "fail", t
    assert t["numbers"]["field_ceiling_exceeded"] or t["numbers"]["priority_near_top"], t


def test_priority_column_dominance_fails_without_a_field_ceiling_breach():
    assert R.DOMINATION_PRIORITY == ("real aim close", "real aim mid", "real aim long", "field")
    row = {column: 0.5 for column in R.COLUMNS}
    row["field"] = 1.2
    matrix = {"kits": ["candidate"], "columns": {"candidate": row},
              "near_top": {"candidate": list(R.DOMINATION_PRIORITY)}}
    result = R.domination_verdict(matrix, matrix)
    assert result["status"] == "fail"
    assert result["numbers"]["priority_near_top"] == ["candidate"]
    assert result["numbers"]["field_ceiling_exceeded"] == []
    matrix["near_top"]["candidate"] = ["1v1 close", "1v1 mid", "1v1 long", "field"]
    ceiling = R.domination_verdict(matrix, matrix)
    assert ceiling["status"] == "pass" and ceiling["numbers"]["priority_near_top"] == []


def test_real_aim_is_one_value_cell_and_requires_all_distances_for_domination():
    near = [c for c in R.COLUMNS if c != "real aim long"]
    row = {c: 0.5 for c in R.COLUMNS}
    matrix = {"kits": ["candidate"], "columns": {"candidate": row},
              "near_top": {"candidate": near}}
    result = R.domination_verdict(matrix, matrix)
    assert result["numbers"]["near_top_everywhere"] == []
    assert R._value_near_top_cells(near) == [c for c in near if not c.startswith("real aim")] + ["real aim"]
    matrix["columns"]["candidate"]["real aim long"] = float("nan")
    assert R.domination_verdict(matrix, matrix)["numbers"]["near_top_everywhere"] == ["candidate"]


def test_branch_domination_compares_new_kits_even_when_baseline_already_fails():
    before = {"near_top_everywhere": ["Old"], "field_ceiling_exceeded": [],
              "priority_near_top": []}
    for key in before:
        after = {**before, key: [*before[key], "New"]}
        assert R._new_dominance_kits(before, after) == ["New"]


def test_heat_sensitivity_excludes_primary_branch_failures():
    flips = {"throughout": ["shields|R1"], "after_lockout": ["shields|R1", "no_domination"],
             "none": ["shields|R1"]}
    assert R._heat_sensitive_flips(flips, "throughout") == {"after_lockout": ["no_domination"]}


def test_a_useless_ar_change_fails_viable_against_the_baseline_ar():
    """The AR itself at 1 damage. The field ratio and the ambush anchor on the BASELINE AR, so the change cannot
    pass by being measured against itself. Break it once (anchor on the candidate world) and watch the ratio
    sit near 1 and pass."""
    calls = []
    real_field_kit = R.field_kit

    def capture(world, name, primary, secondary=None, *args, **kwargs):
        if name == "AR anchor":
            calls.append(secondary)
        return real_field_kit(world, name, primary, secondary, *args, **kwargs)

    with mock.patch.object(R, "field_kit", side_effect=capture):
        v = R.review({"weapon_id": "assault_rifle", "changes": {"wire.dmg": 1}}, reps_scale=REPS_SCALE)
    assert None in calls
    t = v["tests"]["viable"]
    assert t["status"] == "fail" and t["numbers"]["field"] < R.VIABLE_FIELD_FLOOR, t


def test_only_a_new_mechanic_can_carry_value_addition():
    """A number edit to the shipped Sniper keeps its existing bolt mechanic, so that mechanic earns no new value."""
    v = R.review({"weapon_id": "sniper_rifle", "changes": {"wire.dmg": 20}}, reps_scale=REPS_SCALE)
    t = v["tests"]["value_addition"]
    assert t["numbers"]["near_top_in"] == [], t
    assert t["numbers"]["new_mechanics"] == [] and t["status"] == "fail", t


def test_a_pickup_only_candidate_is_not_judged_on_loadout_value():
    """Rule 7: no player spawns with a pickup, so value_addition and viable are n/a, never a fail. Break it once
    (drop the pickup branch) and watch value_addition fail."""
    row = dict(_copy("assault_rifle", "test_pickup", "Test pickup", dmg=2), pickup_only=True)
    v = R.review({"row": row}, reps_scale=REPS_SCALE)
    assert v["tests"]["value_addition"]["status"] == "n/a", v["tests"]["value_addition"]
    assert v["tests"]["viable"]["status"] == "n/a"
    assert v["tests"]["op_rule"]["status"] == "pass"
    assert v["tests"]["pickup_utility"]["status"] == "fail"
    assert v["pass"] is False


def test_shipped_pickups_clear_the_pickup_utility_bars():
    world = R.shipped_world()
    for row in world.cat._rows:
        if row.get("pickup_only") and row.get("lethal") is not False:
            result = R.pickup_utility(world, row["weapon_id"], REPS_SCALE)
            assert result["status"] == "pass", (row["weapon_id"], result)


def test_pickup_assumptions_match_the_shipped_minimum():
    assert R.assumptions()["pickup_utility"]["shipped_margin"] == \
        "about 0.62 kills per stock and 900 ms at full repetitions"
    skill = pathlib.Path(__file__).resolve().parents[2] / ".claude/skills/balance-review/SKILL.md"
    assert "laser_cannon has the shipped minimum: 1.62 kills per stock against 45 + 70" in skill.read_text()


def test_pickup_utility_handles_every_band_and_resets_each_fight_cap():
    standard = R.HEALTH_PRESETS["standard"]
    for band in B.BAND_FIT:
        row = _copy("assault_rifle", f"test_pickup_{band}", "Test pickup")
        row["range_band"] = band
        world = R.World(WeaponCatalog(WeaponCatalog()._rows + [row]), PerkCatalog())
        caps, pools = [], []

        def fake_fight(rng, side_a, side_b, cap_ms, **kwargs):
            caps.append(cap_ms)
            pools.append((side_b[0].health, side_b[0].armour, side_b[0].shield))
            side_a[0].next_t = 10_000.0
            side_b[0].alive = len(caps) == 2

        with mock.patch.object(R, "_reps", return_value=1), mock.patch.object(R, "fight", side_effect=fake_fight), \
                mock.patch.object(R, "time_to_kill", return_value=(1000.0, 1.0)) as ttk:
            R.pickup_utility(world, row["weapon_id"], 0.001)
        assert caps == [R.PICKUP_STOCK_CAP_MS, 10_000.0 + R.PICKUP_STOCK_CAP_MS]
        assert pools == [standard, standard]
        assert ttk.call_args.args[1] == standard


def test_an_all_na_verdict_cannot_pass():
    assert not R._overall_pass({"value_addition": R._test(None, {}, "n/a")})


def test_a_perk_candidate_that_strips_armour_fails_viable_and_op_rule():
    """Body Armor turned into -60 armour: no primary is better off with it, and the Sniper's 60 now one-shots the
    55 pool it leaves. Break it once (op_check on modelled perks only, or gate the perk scope off) and watch op_rule
    pass."""
    v = R.review({"perk_id": "body_armor", "changes": {"max_armor_add": -60}}, reps_scale=REPS_SCALE)
    t = v["tests"]
    assert t["viable"]["status"] == "fail", t["viable"]
    assert t["op_rule"]["status"] == "fail" and "sniper_rifle" in t["op_rule"]["numbers"]["failing"], t["op_rule"]
    assert t["marksman_rush_counter"]["status"] == "n/a"


def test_a_sidearm_that_beats_the_rifles_fails_balance_kept_on_the_ci_r10_engine():
    """A Desert Eagle copy at 60 damage: the R10b primaries no longer beat it. The cells are exactly
    B.R10_PRIMARIES on both presets. Break it once (bar 0) and watch balance_kept pass."""
    v = R.review({"row": _copy("deagle", "test_deagle_60", "Test Deagle 60", dmg=60)}, reps_scale=REPS_SCALE)
    t = v["tests"]["balance_kept"]
    assert {k.split("|")[1] for k in t["numbers"]["r10b_primaries_beat_it"]} == set(B.R10_PRIMARIES)
    assert t["status"] == "fail" and t["numbers"]["r10b_under_bar"], t
    assert v["sidearm_r10"]["finish_ms"] < B.R10_FINISH_BAR_MS
    assert "test_deagle_60" not in B.RANGE_COMBATANTS and "candidate:test_deagle_60" not in B.RANGE_COMBATANTS


# --------------------------------------------------------------------------- balance_kept, op_rule, marksman pieces

def _rules(passes: dict) -> dict:
    return {k: {"value": 0.7 if ok else 0.5, "bar": 0.65, "pass": ok} for k, ok in passes.items()}


def _m(near: dict) -> dict:
    return {"kits": list(near), "keys": {n: k for n, (k, _) in near.items()}, "near_top": {n: c for n, (_, c) in near.items()}}


def test_balance_kept_judges_with_context_against_shipped_and_keys_kits_by_weapon_id():
    """A rule cell that passes as shipped but fails in BOTH worlds (a `with` entry broke it) fails; one already
    failing as shipped does not. A kit is found by weapon_id, not by display name. Break it once (compare baseline
    with candidate only, or compare names) and watch a case go green."""
    s = _rules({"standard|R1": True, "standard|R2": False})
    b = _rules({"standard|R1": False, "standard|R2": False})
    c = _rules({"standard|R1": False, "standard|R2": False})
    same = _m({"AMR": ("amr", ["1v1 long"])})
    t = R.balance_kept(s, b, c, same, same, None)
    assert t["status"] == "fail" and list(t["numbers"]["rule_flips"]) == ["standard|R1"], t
    ok = _rules({"standard|R1": True})
    renamed_b = _m({"Sniper Rifle": ("sniper_rifle", ["peek mid"]), "AMR": ("amr", ["1v1 long"])})
    renamed_c = _m({"Sniper Mk2": ("sniper_rifle", []), "AMR": ("amr", ["1v1 long"])})
    renamed_b["columns"] = {"Sniper Rifle": {"peek mid": 0.9}}
    renamed_c["columns"] = {"Sniper Mk2": {"peek mid": 0.5}}
    renamed_b["reps"] = renamed_c["reps"] = {"duel": 1000}
    t = R.balance_kept(ok, ok, ok, renamed_b, renamed_c, "amr")
    assert t["numbers"]["kits_losing_last_near_top"] == ["sniper_rifle"], t


def test_baseline_niche_ignores_sampling_noise_but_catches_a_real_drop():
    baseline = _m({"Top": ("top", ["peek mid"]), "Other": ("other", ["peek mid"])})
    baseline["columns"] = {"Top": {"peek mid": 0.85}, "Other": {"peek mid": 0.80}}
    baseline["top"] = {"peek mid": 0.85}
    baseline["reps"] = {"duel": 1000}
    candidate = copy.deepcopy(baseline)
    candidate["columns"]["Top"]["peek mid"] = 0.851
    candidate["top"]["peek mid"] = 0.851
    candidate["near_top"]["Other"] = []
    quiet = R.balance_kept({}, {}, {}, baseline, candidate, None)
    assert quiet["status"] == "pass", quiet
    assert quiet["numbers"]["near_top_losses_within_noise"] == ["other"]
    candidate["columns"]["Other"]["peek mid"] = 0.6
    real = R.balance_kept({}, {}, {}, baseline, candidate, None)
    assert real["status"] == "fail", real


def test_niche_score_error_uses_mean_precision_and_non_binomial_errors():
    many = _m({"Top": ("top", ["1v1 close"]), "Other": ("other", ["1v1 close"])})
    many["kits"] += [f"Opponent {i}" for i in range(9)]
    many.update(columns={"Top": {"1v1 close": 0.85}, "Other": {"1v1 close": 0.80}},
                top={"1v1 close": 0.85}, reps={"duel": 100})
    assert math.isclose(R._column_standard_error(many, "Other", "1v1 close", 0.80, 100),
                        math.sqrt(0.8 * 0.2 / (100 * 10)))

    baseline = _m({"Top": ("top", ["field"]), "Other": ("other", ["field"])})
    baseline.update(columns={"Top": {"field": 1.0}, "Other": {"field": 0.99}},
                    top={"field": 1.0}, reps={"field": 600})
    candidate = copy.deepcopy(baseline)
    candidate["columns"]["Other"]["field"] = 0.8
    assert R._niche_score_material_loss(baseline, candidate, "Other", "Other", "field")

    # The same ratio from two kills has much less precision than one from thousands of kills.
    candidate["field_counts"] = {"Top": [(2, 2)] * len(R.FIELD_NS),
                                  "Other": [(2, 2)] * len(R.FIELD_NS)}
    assert not R._niche_score_material_loss(baseline, candidate, "Other", "Other", "field")
    candidate["field_counts"] = {"Top": [(2000, 2000)] * len(R.FIELD_NS),
                                  "Other": [(1600, 2000)] * len(R.FIELD_NS)}
    assert R._niche_score_material_loss(baseline, candidate, "Other", "Other", "field")

    baseline["near_top"]["Other"] = ["ambush"]
    baseline["columns"]["Other"] = {"ambush": 1.25}
    baseline["reps"] = {"ambush": 100}
    candidate = copy.deepcopy(baseline)
    candidate["columns"]["Other"]["ambush"] = 1.19
    assert not R._niche_score_material_loss(baseline, candidate, "Other", "Other", "ambush")


def test_zero_field_kills_do_not_hide_a_niche_score_loss():
    baseline = _m({"Top": ("top", ["field"]), "Other": ("other", ["field"])})
    baseline.update(columns={"Top": {"field": 1.0}, "Other": {"field": 0.99}},
                    top={"field": 1.0}, reps={"field": 600})
    candidate = copy.deepcopy(baseline)
    candidate["near_top"]["Other"] = []
    candidate["columns"]["Other"]["field"] = 0.0
    candidate["field_counts"] = {"Top": [(10000, 10000)] * len(R.FIELD_NS),
                                  "Other": [(0, 10000)] + [(10000, 10000)] * (len(R.FIELD_NS) - 1)}
    assert R.balance_kept({}, {}, {}, baseline, candidate, None)["numbers"]["kits_losing_last_near_top"] == ["other"]


def test_moved_column_top_cannot_fail_a_kit_whose_own_niche_score_holds():
    baseline = _m({"Top": ("top", ["peek mid", "field"]), "Related": ("related", ["peek mid"])})
    baseline.update(columns={"Top": {"peek mid": 0.90, "field": 0.95},
                             "Related": {"peek mid": 0.88, "field": 0.4}},
                    top={"peek mid": 0.90, "field": 0.95}, reps={"duel": 10000})
    candidate = copy.deepcopy(baseline)
    candidate["columns"]["Top"].update({"peek mid": 0.99, "field": 0.70})
    candidate["top"].update({"peek mid": 0.99, "field": 0.70})
    candidate["near_top"]["Related"] = []
    verdict = R.balance_kept({}, {}, {}, baseline, candidate, None)
    assert verdict["status"] == "pass", verdict
    assert verdict["numbers"]["kits_losing_last_near_top"] == []
    assert verdict["numbers"]["near_top_losses_within_noise"] == ["related"]


def test_own_score_drop_in_every_baseline_niche_column_fails_even_when_still_near_top():
    baseline = _m({"Top": ("top", ["peek mid", "shields"]),
                   "Other": ("other", ["peek mid", "shields"])})
    baseline.update(columns={"Top": {"peek mid": 0.85, "shields": 0.85},
                             "Other": {"peek mid": 0.80, "shields": 0.80}},
                    reps={"duel": 1000})
    candidate = copy.deepcopy(baseline)
    candidate["columns"]["Top"]["peek mid"] = 0.62
    candidate["columns"]["Other"].update({"peek mid": 0.60, "shields": 0.60})
    candidate["top"] = {"peek mid": 0.62, "shields": 0.85}
    candidate["near_top"]["Other"] = ["peek mid"]
    verdict = R.balance_kept({}, {}, {}, baseline, candidate, None)
    assert verdict["status"] == "fail", verdict
    assert verdict["numbers"]["kits_losing_last_near_top"] == ["other"]
    candidate["columns"]["Other"]["shields"] = 0.80
    candidate["near_top"]["Other"] = ["peek mid", "shields"]
    held = R.balance_kept({}, {}, {}, baseline, candidate, None)
    assert held["status"] == "pass", held
    assert held["numbers"]["kits_losing_last_near_top"] == []


def test_paired_sampling_uses_one_standard_error_for_a_niche_score_drop():
    baseline = _m({"Top": ("top", ["peek mid"]), "Other": ("other", ["peek mid"])})
    baseline.update(columns={"Top": {"peek mid": 0.85}, "Other": {"peek mid": 0.80}},
                    top={"peek mid": 0.85}, reps={"duel": 400})
    candidate = copy.deepcopy(baseline)
    # 0.055 clears one sample's 2 SE (about 0.044) and the 0.05 margin floor, but not the two-sample 2 SE (0.059)
    candidate["columns"]["Other"]["peek mid"] = 0.745
    candidate["near_top"]["Other"] = []
    verdict = R.balance_kept({}, {}, {}, baseline, candidate, None)
    assert verdict["status"] == "fail", verdict
    assert verdict["numbers"]["kits_losing_last_near_top"] == ["other"]


def test_a_drop_beyond_noise_but_under_the_near_top_margin_is_not_a_lost_niche():
    # F611 (Opus review): with many reps a tiny real drop (one new counter in the mean) cleared 2 SE and failed
    baseline = _m({"Top": ("top", ["peek mid"]), "Other": ("other", ["peek mid"])})
    baseline.update(columns={"Top": {"peek mid": 0.85}, "Other": {"peek mid": 0.80}},
                    top={"peek mid": 0.85}, reps={"duel": 100000})
    candidate = copy.deepcopy(baseline)
    candidate["columns"]["Other"]["peek mid"] = 0.77      # 0.03: far beyond 2 SE at 100000 reps, under 0.05
    verdict = R.balance_kept({}, {}, {}, baseline, candidate, None)
    assert verdict["pass"] and verdict["numbers"]["kits_losing_last_near_top"] == []


def test_a_kit_carrying_the_changed_perk_is_not_judged_as_a_bystander():
    # F611: a Body Armor nerf must not fail on CR+Sniper+BA's own score drop; that kit is part of the change
    def matrix(score):
        return {"keys": {"Combo": "Combo"}, "near_top": {"Combo": ["peek mid"]},
                "columns": {"Combo": {"peek mid": score}}, "top": {"peek mid": 0.9}, "kits": ["Combo", "Other"],
                "specs": {"Combo": {"primary": "charge_rifle", "secondary": "sniper_rifle", "perk": "body_armor",
                                    "shields_perk": "body_armor", "combo": True}},
                "reps": {"duel": 3000}}
    dropped = R.balance_kept({}, {}, {}, matrix(0.9), matrix(0.5), None)
    assert dropped["numbers"]["kits_losing_last_near_top"] == ["Combo"]
    kept = R.balance_kept({}, {}, {}, matrix(0.9), matrix(0.5), None, involved={"body_armor"})
    assert kept["pass"] and kept["numbers"]["kits_losing_last_near_top"] == []


def test_an_over_nerfed_subject_still_fails_balance_kept():
    # F611 (brx1): the kits carrying the change are not judged as bystanders, so a nerf into a trap fails here
    empty = {"keys": {}, "near_top": {}}
    trap = R.balance_kept({}, {}, {}, empty, empty, None, subject_trap=True)
    assert not trap["pass"] and trap["numbers"]["subject_is_a_trap"]
    assert R.balance_kept({}, {}, {}, empty, empty, None)["pass"]
    # a comfort pick near zero is not a trap; a clear loss on average is
    assert not R.perk_is_a_trap([0.01, -0.02, 0.0, -0.01], 2000)
    assert R.perk_is_a_trap([-0.10, -0.12, -0.08, -0.11], 2000)


def test_ceiling_only_near_top_cells_do_not_define_a_niche():
    baseline = _m({"Top": ("top", ["1v1 close"]), "Other": ("other", ["1v1 close"])})
    baseline.update(columns={"Top": {"1v1 close": 0.85}, "Other": {"1v1 close": 0.80}},
                    top={"1v1 close": 0.85}, reps={"duel": 1000})
    candidate = copy.deepcopy(baseline)
    candidate["columns"]["Other"]["1v1 close"] = 0.10
    candidate["near_top"]["Other"] = []
    verdict = R.balance_kept({}, {}, {}, baseline, candidate, None)
    assert verdict["status"] == "pass", verdict
    assert verdict["numbers"]["kits_losing_last_near_top"] == []


def test_a_real_rule_flip_is_caught():
    """A USP at 40 damage: the rifles no longer beat it (R10b). Break it once (skip the shipped comparison and the
    baseline one) and watch the flip vanish."""
    cand = R.build_worlds(R.load_candidate({"weapon_id": "usp", "changes": {"wire.dmg": 40}}))[1]
    s = R.run_rules(R.shipped_world(), REPS_SCALE, 1)
    c = R.run_rules(cand, REPS_SCALE, 1)
    t = R.balance_kept(s, s, c, _m({}), _m({}), "usp")
    assert t["status"] == "fail" and any("R10b" in k for k in t["numbers"]["rule_flips"]), t


def test_the_ci_labels_make_r1_the_ci_number():
    """R1-R3 seed from the CI gate's own labels. Break it once (another label) and watch the numbers differ."""
    w = R.shipped_world()
    sig = json.dumps({x: w.cat._row(x) for x in ("charge_rifle", "assault_rifle")}, sort_keys=True)
    m = B.RecoilDuelModel.from_catalog(w.cat)
    ci = B.recoil_duel_batch(B.run_recoil_duel_rule1, "cr", 200, 7, "gate_rule1", m, float(B.CHARGE_TAP_CADENCE_MS))
    assert R._run_rule("R1", "recoil", "standard", sig, 200, aim_factor=R.AIM)["value"] == ci.win_rate
    real_model = B.RecoilDuelModel.from_catalog(w.cat, aim_factor=R.REAL_AIM)
    real = B.recoil_duel_batch(B.run_recoil_duel_rule1, "cr", 200, 7, "gate_rule1",
                               real_model, float(B.CHARGE_TAP_CADENCE_MS))
    assert R._run_rule("R1", "recoil", "standard", sig, 200, aim_factor=R.REAL_AIM) == {
        "value": real.win_rate, "draw_share": real.draw_rate}


def test_rule_tables_gate_at_real_aim_and_report_the_ceiling():
    world = R.shipped_world()
    for heated in (False, True):
        def cells(jobs, _n_jobs):
            assert {job[-1] for job in jobs} == {R.REAL_AIM, R.AIM}
            return [{"value": 0.60 if job[-1] == R.REAL_AIM else 0.90,
                     "draw_share": 0.20 if job[-1] == R.REAL_AIM else 0.01}
                    for job in jobs]

        with mock.patch.object(R, "run_cells", side_effect=cells):
            if heated:
                result = R.run_heated_rules(world, 0.001, 1, "none", {"R1"})
            else:
                result = R.run_rules(world, 0.001, 1)
        cell = result["standard|R1"]
        assert cell["value"] == 0.60 and cell["draw_share"] == 0.20
        assert cell["ceiling_value"] == 0.90 and cell["ceiling_draw_share"] == 0.01
        assert not cell["pass"]


def test_op_rule_gates_on_the_crit_pull_and_on_every_fieldable_perk():
    """Rule 7. A row 10 under the lowest fieldable Standard pool, with a 40% crit, passes on its plain pull and
    one-shots on a crit (115 today: no shipped perk costs armour since Fast Hands, 2026-10-25). A visible perk
    with an unmodelled key still sets a pool: -30 armour beside Armour Piercing drops Standard to 85, so a 90 row
    one-shots. A pickup is exempt. Break it once (gate on the plain pull, or use modelled perks) and watch one pass."""
    low = R.lowest_pools(PerkCatalog())["standard"]
    crit_dmg = low - 10
    assert crit_dmg < low <= int(crit_dmg * B.CRIT_MULT)
    perks = copy.deepcopy(PerkCatalog()._rows)
    perks.append({"perk_id": "test_glass", "name": "Glass", "effects": {"max_armor_add": -30, "armor_piercing": True}})
    rows = WeaponCatalog()._rows + [
        dict(_copy("amr", "test_crit", "Test crit", dmg=crit_dmg), crit_pct=40),
        _copy("assault_rifle", "test_90", "Test 90", dmg=90),
        dict(_copy("assault_rifle", "test_pickup", "Test pickup", dmg=150), pickup_only=True)]
    plain = R.World(WeaponCatalog(rows), PerkCatalog())
    glass = R.World(WeaponCatalog(rows), PerkCatalog(perks))
    op = R.op_check(plain, ["test_crit", "test_90", "test_pickup", "sniper_rifle"])
    assert op["test_crit"]["crit_pull"] == int(crit_dmg * B.CRIT_MULT) and not op["test_crit"]["pass"]
    assert op["test_90"]["pass"] and op["test_pickup"]["pass"] and op["sniper_rifle"]["pass"]
    assert R.op_check(glass, ["test_90"])["test_90"]["lowest_pool"]["standard"] == 85
    assert not R.op_check(glass, ["test_90"])["test_90"]["pass"]
    # a `with` perk: nothing in the candidate changed a weapon, yet the Sniper now one-shots
    base = R.World(WeaponCatalog(), PerkCatalog(perks))
    t = R.op_rule(R.shipped_world(), base, base, ["sniper_rifle", "shotgun"], [])
    assert t["status"] == "pass"
    perks[-1]["effects"]["max_armor_add"] = -60
    base = R.World(WeaponCatalog(), PerkCatalog(perks))
    t = R.op_rule(R.shipped_world(), base, base, ["sniper_rifle", "shotgun"], [])
    assert t["status"] == "fail" and t["numbers"]["failing"] == ["sniper_rifle"], t


def test_marksman_rush_counter_catches_both_sides():
    """A Sniper that one-shots is never rushed down (counter fails); one at 20 damage never peek-kills (strong
    fails). The strong side reads MARKSMAN_STRONG_COLUMN. Break it once (drop either condition) and watch a case
    pass."""
    w = R.shipped_world()
    ar = R.make_kit(w, "AR (plain)", R.ANCHOR)
    out = {}
    for dmg in (200, 20):
        cw = R.build_worlds(R.load_candidate({"weapon_id": "sniper_rifle", "changes": {"wire.dmg": dmg}}))[1]
        out[dmg] = R.marksman_rush_counter(R.make_kit(cw, f"sn{dmg}", "sniper_rifle"), ar, 60)
    hi = R.marksman_verdict(out[200], out[200], [R.MARKSMAN_STRONG_COLUMN])
    lo = R.marksman_verdict(out[20], out[20], [R.MARKSMAN_STRONG_COLUMN])
    assert hi["numbers"]["strong_ok"] and not hi["numbers"]["counter_ok"] and hi["status"] == "fail", hi
    assert not lo["numbers"]["strong_ok"] and lo["status"] == "fail", lo
    good = {"peek_kill": 0.7, "rush_success": 0.6}
    assert R.marksman_verdict(good, good, [R.MARKSMAN_STRONG_COLUMN])["status"] == "pass"
    armoured = {"peek_kill": 0.7, "rush_success": 0.0}
    assert R.marksman_verdict(good, armoured, [R.MARKSMAN_STRONG_COLUMN])["status"] == "fail"
    assert R.marksman_verdict(good, good, [])["status"] == "fail"
    far = {"peek_kill": 0.7, "rush_success": 0.3}
    numbers = R.marksman_verdict(good, good, [R.MARKSMAN_STRONG_COLUMN], far, far)["numbers"]
    assert numbers["vs_plain_ar_30m"] == far and numbers["rush_start_m"] == 20.0
    assert R.MARKSMAN_STRONG_COLUMN in R.COLUMNS


def test_rush_speed_sweep_reports_three_speeds_and_a_constructed_verdict_flip():
    assert R.RUSH_SPEED_SWEEP == (2.5, 5.0, 8.0)
    rows = [{"speed_m_s": speed, "plain": {"rush_success": plain},
             "body_armor": {"rush_success": armoured}}
            for speed, plain, armoured in ((2.5, 0.2, 0.3), (5.0, 0.4, 0.45), (8.0, 0.6, 0.7))]
    assert R.rush_sweep_flips(rows, strong_ok=True, verdict_pass=False)
    assert not R.rush_sweep_flips(rows, strong_ok=False, verdict_pass=False)


def test_aim_sweep_flags_a_near_top_change():
    assert R.AIM_SWEEP == (0.33, 0.40, 0.48)
    rows = [{"aim": aim, "mid": mid, "long": long}
            for aim, mid, long in ((0.33, 0.30, 0.65), (0.40, 0.40, 0.66), (0.48, 0.51, 0.67))]
    assert R.aim_sweep_status(rows, {"1v1 mid": 0.55, "1v1 long": 0.70})["near_top_changes"] == ["mid"]


def _visible_haze_world():
    """F577 (Tony 2026-10-18) hides the Haze, so a test about a SELECTABLE fn-23 row builds one: the shipped world with
    `smoke_gun` shown again."""
    shipped = R.shipped_world()
    visible = copy.deepcopy(shipped.cat._row("smoke_gun"))
    visible["hidden"] = False
    return R.World(WeaponCatalog([visible if row["weapon_id"] == "smoke_gun" else row
                                  for row in shipped.cat._rows]), shipped.perks)


@contextlib.contextmanager
def _shipped_as(world):
    """Run `haze_gate` with `world` as the shipped catalogue."""
    with mock.patch.object(R, "shipped_world", return_value=world):
        yield


def test_shipped_haze_cache_uses_row_content_and_clear_cache_clears_it():
    world = _visible_haze_world()
    calls = []

    def sweep(current, reps, heat, weapon_id):
        calls.append(current.cat._row(weapon_id)["wire"]["dmg"])
        return [{"damage": calls[-1]}]

    with _shipped_as(world), mock.patch.object(R, "haze_blind_sweep", side_effect=sweep):
        R.clear_cache()
        R._shipped_haze_sweep("smoke_gun", 4)
        changed = copy.deepcopy(world)
        changed.cat._row("smoke_gun")["wire"]["dmg"] += 1
        with _shipped_as(changed):
            R._shipped_haze_sweep("smoke_gun", 4)
            assert len(calls) == 2
            R.clear_cache()
            assert not R._SHIPPED_HAZE_CACHE


def test_f577_the_shipped_haze_is_hidden_so_no_standing_failure_ships():
    shipped = R.shipped_world()
    assert shipped.cat._row("smoke_gun").get("hidden") is True
    with mock.patch.object(R, "haze_blind_sweep", side_effect=AssertionError("a hidden Haze was swept")):
        result = R.haze_gate(shipped, shipped, 4)
    assert result == {"rows": [], "flips": [], "fail": False, "standing_shipped_failures": []}, result


def test_unhiding_haze_fails_only_when_it_crosses_the_blind_sweep_bar():
    shipped = R.shipped_world()
    hidden = copy.deepcopy(shipped.cat._row("smoke_gun"))
    hidden["hidden"] = True
    visible = copy.deepcopy(hidden)
    visible["hidden"] = False
    baseline = R.World(WeaponCatalog([hidden if row["weapon_id"] == "smoke_gun" else row
                                      for row in shipped.cat._rows]), shipped.perks)
    candidate = R.World(WeaponCatalog([visible if row["weapon_id"] == "smoke_gun" else row
                                       for row in shipped.cat._rows]), shipped.perks)
    assert R.HAZE_BLIND_SWEEP_MS == (1000, 1500, 2000, 3000)
    sweep = R.haze_blind_sweep(candidate, 300)
    assert [row["blind_ms"] for row in sweep] == list(R.HAZE_BLIND_SWEEP_MS)
    assert sweep[-1]["win_vs_ar_body_armor"] > R.HAZE_WIN_BAR
    with mock.patch.object(R, "haze_blind_sweep", return_value=sweep):
        assert R.haze_gate(baseline, candidate, 4)["fail"]
        assert not R.haze_gate(baseline, baseline, 4)["fail"]
        assert not R.haze_gate(shipped, shipped, 4)["fail"]
    with mock.patch.object(R, "haze_blind_sweep", return_value=sweep):
        verdict = R.review({"row": visible, "with": [{"row": hidden}]}, reps_scale=0.001)
    assert verdict["tests"]["balance_kept"]["status"] == "fail"
    assert verdict["tests"]["balance_kept"]["numbers"]["haze_flip_over_bar"]
    assert "## Haze blind-duration sensitivity" in R.report_markdown(verdict)
    result = R.balance_kept({}, {}, {}, {"keys": {}, "near_top": {}},
                            {"keys": {}, "near_top": {}}, "smoke_gun", haze_failure=True)
    assert result["status"] == "fail" and "Haze" in result["why"]


def test_haze_gate_reports_standing_shipped_failure_without_candidate_failure():
    shipped = _visible_haze_world()
    with _shipped_as(shipped):
        result = R.haze_gate(shipped, shipped, 300)
    assert not result["fail"]
    assert any(row["weapon_id"] == "smoke_gun" and row["blind_ms"] == 3000
               for row in result["standing_shipped_failures"])


def test_haze_gate_uses_newly_selectable_fn23_variant_row():
    shipped = R.shipped_world()
    hidden = _copy("smoke_gun", "haze_variant", "Haze variant")
    hidden["hidden"] = True
    visible = copy.deepcopy(hidden)
    visible["hidden"] = False
    baseline = R.World(WeaponCatalog(shipped.cat._rows + [hidden]), shipped.perks)
    candidate = R.World(WeaponCatalog(shipped.cat._rows + [visible]), shipped.perks)
    with mock.patch.object(R, "haze_blind_sweep", side_effect=lambda world, reps, heat_cool_while_firing=True,
                           weapon_id="smoke_gun": [{"blind_ms": 3000, "win_vs_ar_body_armor":
                           0.8 if weapon_id == "haze_variant" else 0.7}]):
        result = R.haze_gate(baseline, candidate, 4)
    assert result["fail"]
    assert any(row["weapon_id"] == "haze_variant" for row in result["flips"])


def test_haze_gate_does_not_fail_when_shipped_blind_lengthens():
    shipped = _visible_haze_world()
    changed = copy.deepcopy(shipped.cat._row("smoke_gun"))
    changed["wire"]["swap_ms"] = 100
    candidate = R.World(WeaponCatalog([changed if row["weapon_id"] == "smoke_gun" else row
                                       for row in shipped.cat._rows]), shipped.perks)
    def longer(world, reps, heat_cool_while_firing=True, weapon_id="smoke_gun"):
        return [{"blind_ms": 3000, "win_vs_ar_body_armor": 0.8 if world is candidate else 0.7}]
    with mock.patch.object(R, "haze_blind_sweep", side_effect=longer), _shipped_as(shipped):
        result = R.haze_gate(shipped, candidate, 4)
    assert not result["fail"]
    assert result["standing_shipped_failures"]


def test_haze_gate_reuses_the_shipped_sweep():
    shipped = _visible_haze_world()
    R.clear_cache()
    with mock.patch.object(R, "haze_blind_sweep", return_value=[
            {"blind_ms": 3000, "win_vs_ar_body_armor": 0.7}]) as sweep, _shipped_as(shipped):
        R.haze_gate(shipped, shipped, 4)
        R.haze_gate(shipped, shipped, 4)
    assert sweep.call_count == 5


def test_review_uses_gate_rows_for_the_haze_sweep():
    rows = [{"weapon_id": "smoke_gun", "blind_ms": 3000, "baseline": 0.5,
             "candidate": 0.6, "bar": R.HAZE_WIN_BAR}]
    gate = {"rows": rows, "flips": [], "fail": False, "standing_shipped_failures": []}
    with mock.patch.object(R, "haze_gate", return_value=gate), \
         mock.patch.object(R, "haze_blind_sweep", side_effect=AssertionError("duplicate sweep")):
        v = R.review({"weapon_id": "smoke_gun", "changes": {"wire.dmg": 0}},
                     reps_scale=0.001, haze=True)
    assert v["haze_gate"] == gate
    assert "## Haze blind-duration sensitivity" in R.report_markdown(v)


def test_rush_table_covers_every_marksman_and_both_starts():
    world, specs = _shipped_specs()
    rows = R.rush_table(world, specs, 80, 1)
    marks = {s.name for s in specs if s.combo or world.cat._row(s.primary).get("role") == "marksman"}
    expected = {(m, r, d) for m in marks for r in (R.ANCHOR, "smg", "shotgun")
                for d in (20.0, 30.0)}
    assert {(r["marksman"], r["rusher"], r["start_m"]) for r in rows} == expected
    by_pair = {(r["marksman"], r["rusher"], r["start_m"]): r for r in rows}
    for marksman in marks:
        for rusher in (R.ANCHOR, "smg", "shotgun"):
            near = by_pair[(marksman, rusher, 20.0)]
            far = by_pair[(marksman, rusher, 30.0)]
            assert far["rush_success"] <= near["rush_success"] + 0.15, (near, far)
            assert 0 <= far["peek_kill"] <= 1


def test_rush_table_reuses_one_peek_sample_per_pair_and_verdict_names():
    world = R.shipped_world()
    spec = R.KitSpec("Sniper Rifle", "sniper_rifle", R.SECONDARY, None, False)
    calls = []
    original = R.peek_encounter

    def count(rng, marksman, rusher, *args, **kwargs):
        calls.append((marksman.kit.name, rusher.kit.name))
        return original(rng, marksman, rusher, *args, **kwargs)

    with mock.patch.object(R, "peek_encounter", side_effect=count):
        rows = R.rush_table(world, [spec], 3, 1)
    assert len(calls) == 3 * 3, calls
    assert {name for name, _ in calls} == {"Sniper Rifle (plain)"}
    assert {name for _, name in calls} == {"AR (plain)", "smg (plain)", "shotgun (plain)"}
    for rusher in (R.ANCHOR, "smg", "shotgun"):
        pair = [row for row in rows if row["rusher"] == rusher]
        assert pair[0]["peek_kill"] == pair[1]["peek_kill"]


def test_rush_table_20m_plain_row_matches_the_verdict_pair():
    world = R.shipped_world()
    spec = R.KitSpec("Sniper Rifle", "sniper_rifle", R.SECONDARY, "body_armor", False)
    row = next(r for r in R.rush_table(world, [spec], 40, 1)
               if r["rusher"] == R.ANCHOR and r["start_m"] == 20.0)
    marksman = R.make_kit(world, "Sniper Rifle (plain)", "sniper_rifle")
    ar = R.make_kit(world, "AR (plain)", R.ANCHOR)
    assert row["rush_success"] == R.marksman_rush_counter(marksman, ar, 40)["rush_success"]
    assert row["peek_kill"] == R.marksman_rush_counter(marksman, ar, 40)["peek_kill"]


def test_hill_hold_scores_both_kits_and_overwatch_has_no_escape():
    world, specs = _shipped_specs()
    kits = {s.name: R.make_kit(world, s.name, s.primary, s.secondary, s.perk) for s in specs}
    ar = R.make_kit(world, "AR", R.ANCHOR)
    shotgun = kits["Shotgun"]
    sniper = R.make_kit(world, "Sniper", "sniper_rifle")
    shotgun_hold = R.hill_hold(shotgun, ar, 1000)
    # The second fraction was the Body Armor AR holding against two plain ARs. That hold was always about 0.1%
    # (2 of 1000 on main), and Body Armor at +20 (2026-10-25) drops it to about 0.02%, so 1000 reps read 0.0. The
    # same Shotgun against the plain SMG reference attacker holds about 17%: a second kit pairing, well inside (0, 1).
    smg = R.make_kit(world, "smg (plain)", "smg", R.SECONDARY)
    smg_hold = R.hill_hold(shotgun, smg, 1000)
    assert 0 < shotgun_hold < 1 and 0 < smg_hold < 1, (shotgun_hold, smg_hold)
    first_only = R.hill_hold(shotgun, ar, 1000, second_attacker=False)
    with mock.patch.object(R, "HILL_SECOND_ATTACKER_MS", 0):
        both_at_once = R.hill_hold(shotgun, ar, 1000)
    assert first_only > shotgun_hold > both_at_once, (first_only, shotgun_hold, both_at_once)
    assert R.hill_overwatch(sniper, ar, 160) + 0.05 >= R.marksman_rush_counter(sniper, ar, 160)["peek_kill"]


def test_hill_holder_does_not_hit_second_attacker_before_arrival():
    world = R.shipped_world()
    holder = R.make_kit(world, "Holder", R.ANCHOR)
    weak = R.replace(R.make_kit(world, "Weak", R.ANCHOR),
                     parts=(("standard", (1, 0, 0)),), pools=(("standard", 1),))
    fighters, hits = [], []
    original_init, original_receive = R.Fighter.__init__, R.Fighter.receive

    def capture_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        fighters.append(self)

    def capture_receive(self, dmg, **kwargs):
        if len(fighters) == 3 and self is fighters[2]:
            hits.append(kwargs["t"])
        return original_receive(self, dmg, **kwargs)

    with mock.patch.object(R.Fighter, "__init__", capture_init), \
            mock.patch.object(R.Fighter, "receive", capture_receive):
        R.hill_hold(holder, weak, 1)
    assert hits and min(hits) >= R.HILL_SECOND_ATTACKER_MS, hits


def test_a_hill_hold_counts_only_when_the_second_attacker_dies_too():
    world = R.shipped_world()
    holder, attacker = R.make_kit(world, "Holder", R.ANCHOR), R.make_kit(world, "AR", R.ANCHOR)

    def scripted(kills_second):
        def fake_fight(rng, side_a, side_b, **kwargs):
            # The first fight kills the first attacker; the second fight kills the second only when told to.
            side_b[0].alive = False
            if len(side_b) > 1 and kills_second:
                side_b[1].alive = False
        return fake_fight

    with mock.patch.object(R, "fight", scripted(kills_second=False)):
        assert R.hill_hold(holder, attacker, 4) == 0
    with mock.patch.object(R, "fight", scripted(kills_second=True)):
        assert R.hill_hold(holder, attacker, 4) == 1


def test_matrix_hill_attackers_use_baseline_guns_and_secondary():
    base = R.shipped_world()
    changed = R.build_worlds(R.load_candidate({"weapon_id": "shotgun", "changes": {"wire.dmg": 2}}))[1]
    seen = []

    def cells(jobs, _):
        seen.extend(jobs)
        out = []
        for job in jobs:
            kind = job[0]
            out.append((1.0, 0, {"dry": 1}) if kind == "ammo" else
                       (0.5, 0.5) if kind == "ambush" else 0.5)
        return out

    spec = R.KitSpec("AR", R.ANCHOR, R.SECONDARY, None, False)
    with mock.patch.object(R, "run_cells", side_effect=cells):
        R.dominance_matrix(changed, [spec], 0.001, 1, anchor_world=base)
    refs = [job[2] for job in seen if job[0] == "hill_hold"]
    assert len(refs) == len(R.HILL_REFERENCES)
    assert all(len(kit.guns) == 2 and kit.guns[1].wid == R.SECONDARY for kit in refs)
    shotgun = next(kit for kit in refs if kit.guns[0].wid == "shotgun")
    assert shotgun.guns[0].gun_dmg == R.make_gun(base.cat, "shotgun").gun_dmg


def test_hill_report_covers_each_kit_and_reference():
    world, specs = _shipped_specs()
    report = R.hill_report(world, specs, 12, 1)
    expected = {(s.name, ref) for s in specs for ref in R.HILL_REFERENCES}
    assert {(r["holder"], r["attacker"]) for r in report["hold"]} == expected
    assert {(r["kit"], r["opponent"]) for r in report["contest"]} == expected
    assert {r["holder"] for r in report["overwatch"]} == set(R.HILL_REFERENCES)
    assert "Assault Rifle" in {r["long_gun"] for r in report["overwatch"]}


def test_hill_report_attackers_use_baseline_world():
    base = R.shipped_world()
    changed = R.build_worlds(R.load_candidate({"weapon_id": "shotgun", "changes": {"wire.dmg": 2}}))[1]
    jobs = []

    def cells(batch, _):
        jobs.extend(batch)
        return [0.5] * len(batch)

    with mock.patch.object(R, "run_cells", side_effect=cells):
        R.hill_report(changed, [R.KitSpec("AR", R.ANCHOR, R.SECONDARY, None, False)], 4, 1,
                      anchor_world=base)
    refs = [job[2] for job in jobs if job[0] == "hill_hold"]
    shotgun = next(kit for kit in refs if kit.guns[0].wid == "shotgun")
    assert shotgun.guns[0].gun_dmg == R.make_gun(base.cat, "shotgun").gun_dmg


def test_ammo_stress_rewards_extended_mags_and_spawn_reserve_pickup():
    world = R.shipped_world()
    plain = R.make_kit(world, "Shotgun plain", "shotgun", R.SECONDARY)
    mags = R.make_kit(world, "Shotgun mags", "shotgun", R.SECONDARY, "extended_mags")
    anchor = R.make_kit(world, "AR attacker", R.ANCHOR, R.SECONDARY)
    # A longer streak exposes the extra spawn reserve before most lives end during a reload.
    with mock.patch.object(R, "AMMO_STRESS_ATTACKER_AIM", 0.1):
        plain_kills = R.ammo_stress(plain, anchor, 160)
        mags_kills = R.ammo_stress(mags, anchor, 160)
    assert mags_kills > plain_kills, (mags_kills, plain_kills)
    ar_holder = R.make_kit(world, "AR holder", R.ANCHOR, R.SECONDARY)
    with_pickup = R.ammo_stress(ar_holder, anchor, 160)
    without_pickup = R.ammo_stress(ar_holder, anchor, 160, pickup=False)
    assert with_pickup > without_pickup, (with_pickup, without_pickup)


def test_ammo_stress_quick_hands_helps_a_kit_reloading_under_fire():
    row = _copy(R.ANCHOR, "test_slow_reload", "Slow reload", dmg=40)
    row.update(mag=8, reserve=100, reload_ms=15000)
    world = R.World(WeaponCatalog(WeaponCatalog()._rows + [row]), PerkCatalog())
    attacker = R.make_kit(world, "AR attacker", R.ANCHOR, R.SECONDARY)
    plain = R.make_kit(world, "Slow reload plain", "test_slow_reload")
    quick = R.make_kit(world, "Slow reload quick", "test_slow_reload", perk="quick_hands")
    plain_kills = R.ammo_stress(plain, attacker, 160)
    quick_kills = R.ammo_stress(quick, attacker, 160)
    assert quick_kills >= plain_kills, (quick_kills, plain_kills)


def test_ammo_stress_anchor_and_isolation_assumptions():
    world = R.shipped_world()
    anchor = R.make_kit(world, "AR anchor", R.ANCHOR, R.SECONDARY)
    plain = R.make_kit(world, "AR plain", R.ANCHOR, R.SECONDARY)
    enemy = R.make_kit(world, "AR enemy", R.ANCHOR, R.SECONDARY)
    assert R.SCENARIO_VERSION == 24
    assert R.AMMO_STRESS_RANGE == "mid"
    assert R.AMMO_STRESS_BAND_FIT is False
    assert R.AMMO_STRESS_HEAL is True
    assert 0 < R.AMMO_STRESS_ATTACKER_AIM < R.REAL_AIM
    anchor_kills = R.ammo_stress(anchor, enemy, 160)
    assert anchor_kills >= 3, anchor_kills
    assert 0.8 <= R.ammo_stress(plain, enemy, 160) / anchor_kills <= 1.2
    with mock.patch.object(R, "AMMO_STRESS_HEAL", False):
        without_heal = R.ammo_stress(anchor, enemy, 160)
    assert anchor_kills > without_heal, (anchor_kills, without_heal)
    assumptions = R.assumptions()["ammo_stress"]
    assert assumptions["holder_aim"] == R.REAL_AIM
    assert assumptions["attacker_aim"] == R.AMMO_STRESS_ATTACKER_AIM
    assert assumptions["heal_between_fights"] is True
    assert assumptions["band_fit"] is False
    assert assumptions["downtime_only"] is True


def test_ammo_stress_reports_an_attacker_cap_hit():
    world = R.shipped_world()
    anchor = R.make_kit(world, "AR anchor", R.ANCHOR, R.SECONDARY)
    with mock.patch.object(R, "AMMO_STRESS_MAX_ATTACKERS", 1):
        _raises(lambda: R.ammo_stress(anchor, anchor, 8), "cap")
        _, cap_hits = R.ammo_stress(anchor, anchor, 8, report_caps=True)
        assert cap_hits > 0


def test_ammo_stress_does_not_end_a_life_when_a_fight_times_out():
    world = R.shipped_world()
    anchor = R.make_kit(world, "AR anchor", R.ANCHOR, R.SECONDARY)
    with mock.patch.object(R, "AMMO_STRESS_FIGHT_CAP_MS", 1):
        _raises(lambda: R.ammo_stress(anchor, anchor, 1), "fight cap")


def test_ammo_stress_holder_without_downtime_never_dies():
    row = _copy(R.ANCHOR, "test_endless_mag", "Endless magazine", dmg=100)
    row.update(mag=10000, reserve=10000)
    world = R.World(WeaponCatalog(WeaponCatalog()._rows + [row]), PerkCatalog())
    holder = R.make_kit(world, "Endless holder", "test_endless_mag")
    attacker = R.make_kit(world, "AR attacker", R.ANCHOR)
    with mock.patch.object(R, "AMMO_STRESS_MAX_ATTACKERS", 20):
        kills, caps, reasons = R.ammo_stress(holder, attacker, 30, report_caps=True, report_reasons=True)
    assert kills == 20 and caps == 30
    assert reasons == {"dry": 0, "died_reloading": 0, "died_heat_locked_or_venting": 0,
                       "died_swapping": 0, "cap": 30}


def test_ammo_stress_long_reload_dies_more_than_quick_hands():
    row = _copy(R.ANCHOR, "test_reload_exposure", "Reload exposure", dmg=45)
    row.update(mag=5, reserve=15, reload_ms=3000)
    world = R.World(WeaponCatalog(WeaponCatalog()._rows + [row]), PerkCatalog())
    attacker = R.make_kit(world, "AR attacker", R.ANCHOR)
    plain = R.make_kit(world, "Reload plain", "test_reload_exposure")
    quick = R.make_kit(world, "Reload quick", "test_reload_exposure", perk="quick_hands")
    _, _, plain_reasons = R.ammo_stress(plain, attacker, 100, report_reasons=True)
    _, _, quick_reasons = R.ammo_stress(quick, attacker, 100, report_reasons=True)
    assert plain_reasons["died_reloading"] > quick_reasons["died_reloading"], (plain_reasons, quick_reasons)


def test_sniper_can_die_during_its_bolt_cycle():
    world = R.shipped_world()
    sniper = R.make_kit(world, "Sniper", "sniper_rifle")
    attacker = R.make_kit(world, "AR attacker", R.ANCHOR)
    _, _, reasons = R.ammo_stress(sniper, attacker, 80, report_reasons=True)
    assert reasons["died_reloading"] > 0, reasons


def test_attacker_reacts_before_firing_at_a_reloading_holder():
    row = _copy(R.ANCHOR, "test_one_round", "One round", dmg=200)
    row.update(mag=1, reserve=8, reload_ms=5000)
    world = R.World(WeaponCatalog(WeaponCatalog()._rows + [row]), PerkCatalog())
    holder = R.make_kit(world, "Holder", "test_one_round")
    attacker = R.make_kit(world, "Enemy", R.ANCHOR)
    times = []
    original = R.Fighter.act

    def capture(self, t):
        if self.kit.name == "Enemy":
            times.append(t)
        return original(self, t)

    with mock.patch.object(R.Fighter, "act", capture), mock.patch.object(R, "_reaction", return_value=400), \
            mock.patch.object(R, "REAL_AIM", 1), mock.patch.object(R, "AMMO_STRESS_GAP_MS", 0), \
            mock.patch.object(R, "AMMO_STRESS_MAX_ATTACKERS", 2):
        R.ammo_stress(holder, attacker, 1, report_caps=True)
    assert times and min(times) >= 400, times


def test_combo_draws_charge_rifle_after_sniper_runs_dry():
    world = R.shipped_world()
    combo = R.make_kit(world, "CR+Sniper", "charge_rifle", "sniper_rifle", plan="combo")
    holder = R.Fighter(combo, 115, 1, 1, random.Random(2), pull_ms=0, persistent_reload=True)
    holder.targets = [R.Fighter(combo, 115, 0, 1, random.Random(3))]
    holder.active = 1
    holder.gs[1].ammo = holder.gs[1].reserve = 0
    assert holder.act(0) is None and holder.active == 0
    assert holder.act(holder.next_t) is not None
    assert holder.gs[0].ammo < combo.guns[0].mag


def test_chain_reload_credits_each_shell_and_can_fire_between_shells():
    world = R.shipped_world()
    kit = R.make_kit(world, "Shotgun", "shotgun")
    holder = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0, persistent_reload=True)
    holder.targets = [R.Fighter(kit, 115, 0, 1, random.Random(3))]
    state = holder.gs[0]
    state.ammo = 0
    state.reload_amount = 3
    state.ready_at = kit.guns[0].reload_ms * 3
    original_reserve = state.reserve
    holder._credit_reload(state, kit.guns[0].reload_ms * 2 + 1)
    assert (state.ammo, state.reserve, state.reload_amount) == (2, original_reserve - 2, 1)
    assert holder.act(kit.guns[0].reload_ms * 2 + 1) is not None
    assert state.reload_amount == 0
    during_fight = R.Fighter(kit, 115, 1, 1, random.Random(4), pull_ms=0, persistent_reload=True)
    during_fight.targets = [R.Fighter(kit, 115, 0, 1, random.Random(5))]
    during_fight.gs[0].ammo = 0
    assert during_fight.act(0) is None
    assert during_fight.next_t == kit.guns[0].reload_ms
    assert during_fight.act(during_fight.next_t) is not None


def test_chain_reload_credits_the_first_shell_at_fractional_start_times():
    world = R.shipped_world()
    kit = R.make_kit(world, "Shotgun", "shotgun")
    for first in (1234.567, 2345.678, 3456.789):
        holder = R.Fighter(kit, 115, 1, 1, random.Random(2), persistent_reload=True)
        state = holder.gs[0]
        state.ammo = 0
        state.reload_amount = 3
        state.ready_at = first + 2 * kit.guns[0].reload_ms
        holder._credit_reload(state, first - 1)
        assert state.ammo == 0
        holder._credit_reload(state, first)
        assert state.ammo == 1, (first, state.ammo)


def test_chain_reload_is_interruptible_only_in_ammo_stress():
    world = R.shipped_world()
    kit = R.make_kit(world, "Shotgun", "shotgun")
    for persistent in (False, True):
        holder = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0,
                           persistent_reload=persistent)
        holder.targets = [R.Fighter(kit, 115, 0, 1, random.Random(3))]
        state = holder.gs[0]
        state.ammo = 0
        state.reload_amount = 3
        state.ready_at = 3 * kit.guns[0].reload_ms
        holder._credit_reload(state, kit.guns[0].reload_ms)
        assert state.ammo == (1 if persistent else 0)
        fresh = R.Fighter(kit, 115, 1, 1, random.Random(4), pull_ms=0,
                          persistent_reload=persistent)
        fresh.targets = [R.Fighter(kit, 115, 0, 1, random.Random(5))]
        fresh.gs[0].ammo = 0
        assert fresh.act(0) is None
        assert fresh.next_t == (kit.guns[0].reload_ms if persistent else
                                kit.guns[0].reload_ms * kit.guns[0].mag)


def test_plain_shotgun_against_ar_close_duel_uses_the_full_reload_path():
    world = R.shipped_world()
    shotgun = R.make_kit(world, "Shotgun plain", "shotgun")
    ar = R.make_kit(world, "AR plain", R.ANCHOR)
    # F609: without the melee lottery the Shotgun wins every close duel at aim 0.9, which pins nothing; the pin moves to
    # real aim, where a kill takes about 7.5 shells on average, so most duels reach the 6-shell tube's reload
    rate = R.duel_rate(shotgun, ar, "close", reps=200, aim=R.REAL_AIM)
    assert rate == 0.79, rate   # F602: the headset word lands 88 ms after the gun word


def test_swap_applies_a_deferred_ammo_pickup_after_cancelling_reload():
    world = R.shipped_world()
    kit = R.make_kit(world, "Shotgun and AR", "shotgun", R.ANCHOR)
    holder = R.Fighter(kit, 115, 1, 1, random.Random(2), persistent_reload=True)
    state = holder.gs[0]
    state.ammo, state.reserve, state.reload_amount = 0, 2, 3
    state.ready_at = 3 * kit.guns[0].reload_ms
    R._ammo_pickup(holder)
    holder._swap(1, 0)
    assert state.reload_amount == 0
    assert state.reserve == kit.guns[0].reserve


def test_combo_starts_each_ammo_stress_fight_with_a_charged_opener():
    world = R.shipped_world()
    kit = R.make_kit(world, "CR+Sniper", "charge_rifle", "sniper_rifle", plan="combo")
    holder = R.Fighter(kit, 115, 1, 1, random.Random(2), persistent_reload=True)
    holder.phase, holder.active = "finish", 1
    holder.gs[0].charged = False
    holder.after(1000, False, True)
    assert holder.phase == "open" and holder.active == 0
    assert holder.gs[0].charged


def test_ammo_pickup_waits_for_a_pending_reload():
    world = R.shipped_world()
    kit = R.make_kit(world, "AR", R.ANCHOR)
    holder = R.Fighter(kit, 115, 1, 1, random.Random(2), persistent_reload=True)
    state = holder.gs[0]
    state.ammo = 0
    state.reserve = 2
    state.reload_amount = 2
    state.ready_at = 3000
    R._ammo_pickup(holder)
    assert state.reserve == 2
    holder._credit_reload(state, 2999)
    assert state.reserve == 2
    holder._credit_reload(state, 3000)
    assert state.ammo == 2 and state.reserve == kit.guns[0].reserve


def test_ammo_stress_energy_life_ends_on_ammo_or_heat():
    world = R.shipped_world()
    holder = R.make_kit(world, "Energy holder", "energy_rifle", R.SECONDARY)
    attacker = R.make_kit(world, "AR attacker", R.ANCHOR, R.SECONDARY)
    deaths = []
    receive = R.Fighter.receive

    def capture_death(fighter, dmg, **kwargs):
        killed = receive(fighter, dmg, **kwargs)
        if killed and fighter.kit.name == holder.name:
            state = fighter.gs[0]
            deaths.append((state.ammo, state.locked_until > kwargs["t"] or state.venting))
        return killed

    with mock.patch.object(R.Fighter, "receive", capture_death):
        _, _, reasons = R.ammo_stress(holder, attacker, 100, report_reasons=True)
    assert reasons["dry"] + reasons["died_heat_locked_or_venting"] + reasons["died_reloading"] == 100, reasons
    assert all(ammo == 0 or heat_locked for ammo, heat_locked in deaths), deaths


def test_ammo_stress_end_reasons_sum_to_reps():
    world = R.shipped_world()
    holder = R.make_kit(world, "AR holder", R.ANCHOR, R.SECONDARY)
    attacker = R.make_kit(world, "AR attacker", R.ANCHOR, R.SECONDARY)
    _, caps, reasons = R.ammo_stress(holder, attacker, 40, report_reasons=True)
    assert sum(reasons.values()) == 40
    assert reasons["cap"] == caps


def test_pistol_finisher_lists_every_primary_and_pistol_and_respects_cycle():
    world = R.shipped_world()
    rows = R.pistol_finisher_report(world)
    primaries = set(R.roster_ids(world)[0])
    pistols = {row["weapon_id"] for row in world.cat._rows if row.get("role") == "sidearm"
               and not row.get("hidden") and row.get("lethal") is not False}
    assert {(r["primary"], r["pistol"]) for r in rows} == {(p, s) for p in primaries for s in pistols}
    assert all(r["bar_ms"] == B.R10_FINISH_BAR_MS and r["reload_finish_ms"] >= 0 for r in rows)
    gun = R.make_gun(world.cat, "usp")
    slow = R.replace(gun, fire_ms=gun.fire_ms * 2)
    assert R.pistol_finish_ms(slow, 500) >= R.pistol_finish_ms(gun, 500)


def test_pistol_finisher_includes_r10a_reaction_delay():
    gun = R.make_gun(R.shipped_world().cat, "deagle")
    instant = R.replace(gun, gun_dmg=1000, head_dmg=0, mag=1)
    assert R.pistol_finish_ms(instant, 0) == R.REACTION_MEAN_MS


def test_pistol_finisher_bar_uses_sampled_r10a_median():
    world = R.shipped_world()
    model = B.RecoilDuelModel.from_catalog(world.cat, health_preset="standard")
    reps = R._reps("finish", 0.001)
    sampled = B.finish_time_batch(model, "usp", reps, R.SEED).median_ms
    kit = R.make_kit(world, "AR+USP", R.ANCHOR, "usp")
    expected = R.pistol_finish_ms(kit.guns[1], kit.swap_ms)
    sampled += kit.swap_ms
    assert sampled != expected, (sampled, expected)
    bar = (sampled + expected) / 2
    with mock.patch.object(B, "R10_FINISH_BAR_MS", bar):
        row = next(r for r in R.pistol_finisher_report(world, scale=0.001)
                   if r["primary"] == R.ANCHOR and r["pistol"] == "usp")
    assert row["finish_ms"] == sampled
    assert row["under_bar"] == (sampled < bar)
    assert row["under_bar"] != (expected < bar)


# --------------------------------------------------------------------------- candidates, pools, the record

def test_candidate_files_round_trip_and_every_path_must_move_something():
    """Each form loads from a file and lands in the candidate world only; `with` lands in both. A bolt row ignores
    the ammo and reload perks. A misspelt, unread or unchanged field is refused even beside a good one, and the
    old sim.perk_exempt flag is refused. Break it once (validate the diff as a whole) and watch a mixed diff pass."""
    with tempfile.TemporaryDirectory() as d:
        def write(obj):
            p = pathlib.Path(d) / f"c{len(list(pathlib.Path(d).iterdir()))}.json"
            p.write_text(json.dumps(obj))
            return str(p)

        diff = R.load_candidate(write({"weapon_id": "sniper_rifle", "changes": {"wire.dmg": 57, "reload_ms": 1700},
                                       "with": [{"weapon_id": "charge_rifle", "changes": {"wire.tap_dmg": 12}}]}))
        base, cand = R.build_worlds(diff)
        assert base.cat.damage("sniper_rifle") == 75 and cand.cat.damage("sniper_rifle") == 57
        assert base.cat.tap_damage("charge_rifle") == cand.cat.tap_damage("charge_rifle") == 12
        assert R.make_kit(cand, "x", "sniper_rifle", perk="fast_hands").guns[0].reload_ms == 1700
        assert R.make_kit(cand, "x", "sniper_rifle", perk="extended_mags").guns[0].mag == 1
        assert R.make_kit(base, "x", "assault_rifle", perk="fast_hands").guns[0].reload_ms == 700
        plain_mag = R.make_kit(base, "x", "assault_rifle").guns[0].mag
        em = {p: R.make_kit(base, "x", "assault_rifle", perk="extended_mags", preset=p).guns[0].mag
              for p in (None, "standard", "shields")}
        assert em == {None: 2 * plain_mag, "standard": 2 * plain_mag, "shields": int(1.5 * plain_mag)}, (plain_mag, em)
        assert R.field_kit(base, "x", "assault_rifle", perk="extended_mags", preset="shields").models[0].mag == \
            int(1.5 * plain_mag)

        row = R.load_candidate(write(_copy("assault_rifle", "test_ar_new", "Test AR new", dmg=10)))
        base, cand = R.build_worlds(row)
        assert "test_ar_new" in cand.cat._by_id and "test_ar_new" not in base.cat._by_id

        perk = R.load_candidate(write({"perk_id": "fast_hands", "changes": {"reload_mult": 0.4}}))
        base, cand = R.build_worlds(perk)
        assert base.fx("fast_hands")["reload_mult"] == 0.5 and cand.fx("fast_hands")["reload_mult"] == 0.4
        for old_id in ("quick_hands", "quick_switch"):   # an old id names Fast Hands, as stored loadouts do
            _, cand = R.build_worlds(R.load_candidate(write({"perk_id": old_id, "changes": {"reload_mult": 0.4}})))
            assert cand.fx("fast_hands")["reload_mult"] == 0.4, old_id
            fh = dict(next(r for r in base.perks._rows if r["perk_id"] == "fast_hands"), perk_id=old_id)
            _, cand = R.build_worlds(R.load_candidate(write({"perk": fh})))
            assert [r["perk_id"] for r in cand.perks._rows].count("fast_hands") == 1, old_id
            assert old_id not in {r["perk_id"] for r in cand.perks._rows}, old_id

        for bad, text in ((({"tap_dmg": 14}), "tap_dmg"), ({"mag": 2, "wire.dmgg": 61}, "wire.dmgg"),
                          ({"mag": 2, "wire.dmg": 75}, "wire.dmg"), ({"wire.range_outdoor_pct": 90}, "range_outdoor")):
            c = R.load_candidate(write({"weapon_id": "sniper_rifle", "changes": bad}))
            _raises(lambda: R.build_worlds(c), text)
        _raises(lambda: R.build_worlds(R.load_candidate(write({"perk_id": "fast_hands", "changes": {"reload_mult": 0.5}}))),
                "already")
        _raises(lambda: R.load_candidate({"weapon_id": "sniper_rifle", "changes": {"mag": 1}, "sim": {"perk_exempt": True}}),
                "reload_type")


def test_the_pool_arithmetic_matches_compile_for_every_shipped_perk():
    """`pool_parts` reads a perk's own `max_armor_add` so a perk candidate can move it; it must agree with
    compile.armed_armor/armed_shield for every shipped perk on both gated presets."""
    perks = PerkCatalog()
    for pid in [None] + perks.visible_ids():
        for preset, (hp, arm, sh) in (("standard", (45, 70, 0)), ("shields", (45, 0, 105))):
            shields = arm == 0
            want = (hp, armed_armor(arm, pid, shields), armed_shield(sh, pid, shields))
            assert R.pool_parts(preset, perks.effects(pid)) == want, (pid, preset)


def test_pull_gap_is_one_draw_of_the_shared_pull_model():
    """pull_gap reuses balance_sim.semi_interval: one lognormal draw, mean pull_ms, log-sigma PULL_SIGMA."""
    mu = math.log(300.0) - PULL_SIGMA * PULL_SIGMA / 2
    assert R.pull_gap(random.Random(3), 300.0) == random.Random(3).lognormvariate(mu, PULL_SIGMA)
    assert R.pull_gap(random.Random(3), 0.0) == 0.0


def test_charge_heat_locks_only_after_the_crossing_round():
    row = copy.deepcopy(WeaponCatalog()._row("charge_rifle"))
    row["heat"] = {"per_tap": 14, "per_charge": 56, "lock_at": 103,
                   "lockout_ms": 4800, "cool_per_s": 30, "vent": "self"}
    cat = WeaponCatalog([row])
    kit = R.make_kit(R.World(cat, PerkCatalog()), "charge", "charge_rifle")
    f = R.Fighter(kit, 115, 1.0, 0, random.Random(3), pull_ms=0)
    for i in range(4):
        assert f.act(0) is not None
    assert f.gs[0].heat == 98 and f.gs[0].locked_until == 0
    assert f.act(0) is not None
    assert f.gs[0].heat >= 103 and f.gs[0].locked_until > 0
    assert f.act(1) is None
    paced = R.Fighter(kit, 115, 1.0, 0, random.Random(3), pull_ms=0)
    for i in range(6):
        assert paced.act(i * 285) is not None
    assert paced.gs[0].locked_until == 0  # passive cooling changes the five-tap outcome at real cadence
    row["heat"]["per_charge"] = 55
    kit55 = R.make_kit(R.World(WeaponCatalog([row]), PerkCatalog()), "charge55", "charge_rifle")
    for cooling, locks in ((True, False), (False, True)):
        f = R.Fighter(kit55, 115, 1.0, 0, random.Random(3), pull_ms=0,
                      heat_cool_while_firing=cooling)
        for i in range(5):
            assert f.act(i * 285) is not None
        assert (f.gs[0].locked_until > 0) is locks
        assert (f.act(5 * 285) is None) is locks
    shipped = R.Fighter(kit, 115, 1.0, 0, random.Random(3), pull_ms=0,
                        heat_cool_while_firing=False)
    for i in range(4):
        assert shipped.act(i * 285) is not None
    assert shipped.gs[0].heat == 98 and shipped.gs[0].locked_until == 0


def test_armour_piercing_uses_health_only_and_refuses_an_ineligible_primary():
    w = R.shipped_world()
    ap = R.make_kit(w, "AP AR", "assault_rifle", perk="armor_piercing")
    plain = R.make_kit(w, "AR", "assault_rifle")
    row = w.cat._row("assault_rifle")
    assert ap.guns[0].gun_dmg == row["ap_dmg"]
    assert ap.guns[0].fire_ms == row["ap_fire_ms"]
    assert ap.guns[0].head_dmg == 0
    victim = R.Fighter(plain, (45, 70, 0), 0, 1, random.Random(2))
    shooter = R.Fighter(ap, (45, 70, 0), 1, 1, random.Random(2), pull_ms=0)
    victim.next_t = math.inf
    n = math.ceil(45 / row["ap_dmg"])
    # The AR fires controlled bursts (BURST_LEN rounds, then a BURST_PAUSE_MS pause), so n rounds at ap_fire_ms
    # also need the worst-case pauses. Without them a fast AP cycle runs out of time, not out of health.
    pauses = math.ceil(n / R.BURST_LEN[0]) * R.BURST_PAUSE_MS[1]
    R.fight(random.Random(2), [shooter], [victim], cap_ms=n * row["ap_fire_ms"] + pauses)
    assert shooter.shots == n
    assert not victim.alive and victim.armour == 70
    plain_victim = R.Fighter(plain, (45, 70, 0), 0, 1, random.Random(2))
    for _ in range(n):
        plain_victim.receive(ap.guns[0].gun_dmg)
    assert plain_victim.alive
    _raises(lambda: R.make_kit(w, "AMR AP", "amr", perk="armor_piercing"), "Armour Piercing")


def test_toxin_refreshes_and_ticks_after_the_last_shot():
    w = R.shipped_world()
    toxin = R.make_kit(w, "toxin", "toxin_rifle")
    assert "toxin_rifle" in R.roster_ids(w)[0]
    one = R.replace(toxin.guns[0], mag=1, reserve=0)
    toxin = R.replace(toxin, guns=(one,))
    victim = R.Fighter(R.make_kit(w, "victim", "assault_rifle"), (20, 0, 0), 0, 1, random.Random(2))
    shooter = R.Fighter(toxin, 115, 1, 1, random.Random(2))
    victim.next_t = math.inf
    R.fight(random.Random(1), [shooter], [victim], cap_ms=6000)
    assert not victim.alive and shooter.kill_times == [3000.0], shooter.kill_times
    refreshed = R.Fighter(R.make_kit(w, "fresh", "assault_rifle"), (40, 0, 0), 0, 1, random.Random(2))
    refreshed.receive(one.gun_dmg, src=shooter, t=0, gun=one)
    refreshed.tick(1000)
    refreshed.receive(one.gun_dmg, src=shooter, t=1500, gun=one)
    assert refreshed.dot_next == 2500 and refreshed.dot_left == one.dot_ticks
    before = refreshed.health
    refreshed.tick(2000)
    assert refreshed.health == before
    refreshed.tick(2500)
    assert refreshed.health == before - one.dot_per_tick
    doomed = R.Fighter(R.make_kit(w, "finisher", "assault_rifle"), (20, 0, 0), 1, 1, random.Random(2))
    poisoned = R.Fighter(toxin, (1, 0, 0), 0, 1, random.Random(2))
    poisoned.next_t = math.inf
    doomed.receive(one.gun_dmg, src=poisoned, t=0, gun=one)
    R.fight(random.Random(1), [poisoned], [doomed], cap_ms=6000)
    assert not poisoned.alive and not doomed.alive


def test_a_dry_primary_draws_a_lethal_secondary_and_pays_both_swaps():
    w = R.shipped_world()
    kit = R.make_kit(w, "AR + Deagle", "assault_rifle", "deagle")
    primary = R.replace(kit.guns[0], mag=1, reserve=2)
    secondary = R.replace(kit.guns[1], mag=1, reserve=0)
    kit = R.replace(kit, guns=(primary, secondary))
    f = R.Fighter(kit, 115, 1, 0, random.Random(2), pull_ms=0)
    f.targets = [R.Fighter(kit, 115, 0, 0, random.Random(3))]
    assert f.act(0) is not None
    assert f.act(f.next_t) is None and f.active == 1
    out_t = f.next_t
    assert out_t >= primary.fire_ms + kit.swap_ms
    assert f.act(out_t) is not None
    back_start = f.next_t
    assert f.act(back_start) is None and f.active == 0
    assert f.next_t >= back_start + kit.swap_ms
    solo = R.Fighter(R.replace(kit, guns=(primary,), swap_ms=0), 115, 1, 0, random.Random(2), pull_ms=0)
    solo.targets = f.targets
    solo.act(0)
    shots = solo.shots
    assert solo.act(solo.next_t) is None
    assert solo.active == 0 and solo.shots == shots and len(solo.gs) == 1


def _dry_fast_reload_shotgun():
    w = R.shipped_world()
    kit = R.make_kit(w, "Shotgun + Deagle + QH", "shotgun", "deagle", perk="quick_hands")
    f = R.Fighter(kit, 115, 0.4, R.DIST["long"], random.Random(2))
    f.targets = [R.Fighter(kit, 45, 0, R.DIST["long"], random.Random(3))]   # a target already down to health
    f.gs[0].ammo = 0
    return f


def test_a_fast_reload_primary_reloads_instead_of_drawing():
    # F601: a dry primary drew the secondary unconditionally, and the way back counted the primary's short reload,
    # so a Quick Hands Shotgun swapped back and forth for the whole fight and never fired or reloaded.
    f = _dry_fast_reload_shotgun()
    assert f.act(0) is None
    assert f.active == 0 and f.gs[0].reload_amount > 0


def test_a_drawn_secondary_acts_before_the_slot_is_reconsidered():
    f = _dry_fast_reload_shotgun()
    f._swap(1, 0)
    assert f.act(f.next_t) is not None and f.active == 1


def test_a_fast_reload_primary_does_not_ping_pong_with_its_secondary():
    f = _dry_fast_reload_shotgun()
    swaps, t = 0, 0.0
    for _ in range(40):
        before = f.active
        f.act(t)
        swaps += f.active != before
        t = f.next_t
    assert swaps <= 2 and f.shots > 0


def test_the_field_engine_does_not_ping_pong_a_dry_shotgun():
    # F601 in KitMatch (Fable sim review #2): a dry primary forced the secondary, the way back chose the primary,
    # and the reload never started inside a contact: about 27 swaps and 49 shots a 2v2 match for a Shotgun.
    w = R.shipped_world()
    fk = R.field_kit(w, "shotgun", "shotgun", "deagle")
    cfg = R.B.SimConfig(pool=R.B.default_pool(), venue=R.FIELD_VENUE)
    swaps = []
    orig = R.KitMatch._swap_to

    def counting(self, p, idx, t_end):
        swaps.append(p.pid)
        return orig(self, p, idx, t_end)

    rng = random.Random(7)
    R.KitMatch._swap_to = counting
    try:
        for r in range(8):
            players = [R._kit_player(i, i // 2, fk) for i in range(4)]
            R.KitMatch(players, rng, cfg, cfg.hit_probs[r % len(cfg.hit_probs)], 2).run()
    finally:
        R.KitMatch._swap_to = orig
    assert len(swaps) / 8 < 8


def test_a_loaded_secondary_fires_before_returning_to_an_empty_primary():
    world = R.shipped_world()
    kit = R.make_kit(world, "AR + Deagle", R.ANCHOR, R.SECONDARY)
    holder = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0, persistent_reload=True)
    target = R.Fighter(kit, 115, 0, 1, random.Random(3))
    holder.targets = [target]
    holder.active = 1
    holder.gs[0].ammo = 0
    before = holder.gs[1].ammo
    assert holder.act(0) is not None
    assert holder.active == 1 and holder.gs[1].ammo == before - 1


def test_a_dry_primary_draws_a_secondary_with_reserve_to_reload():
    world = R.shipped_world()
    kit = R.make_kit(world, "AR + Deagle", R.ANCHOR, R.SECONDARY)
    holder = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0, persistent_reload=True)
    holder.targets = [R.Fighter(kit, 115, 0, 1, random.Random(3))]
    holder.gs[0].ammo = holder.gs[0].reserve = 0
    holder.gs[1].ammo = 0
    assert holder.gs[1].reserve > 0
    assert holder.act(0) is None and holder.active == 1
    assert holder.act(holder.next_t) is None and holder.gs[1].reload_amount > 0
    both_dry = R.Fighter(kit, 115, 1, 1, random.Random(4), pull_ms=0, persistent_reload=True)
    both_dry.targets = holder.targets
    both_dry.active = 1
    both_dry.gs[0].ammo = both_dry.gs[1].ammo = 0
    assert both_dry.act(0) is None and both_dry.active == 1
    assert both_dry.gs[1].reload_amount > 0


def test_haze_blinds_then_swaps_and_zero_blind_cannot_improve_the_kit():
    w = R.shipped_world()
    haze = R.make_kit(w, "AR Haze", "assault_rifle", "smoke_gun", plan="haze")
    plain = R.make_kit(w, "AR", "assault_rifle")
    a = R.Fighter(haze, 115, 1, 0, random.Random(2), pull_ms=0)
    b = R.Fighter(plain, 115, 1, 0, random.Random(2), pull_ms=0)
    a.targets, b.targets = [b], [a]
    shot = a.act(0)
    assert shot is not None
    b.receive(shot[0], src=a, t=0, gun=a.last_effect)
    assert b.blind_until == R.HAZE_BLIND_MS
    assert b.act(100)[1] == 0
    assert a.active == 0 and a.next_t >= haze.swap_ms
    assert R.duel_rate(haze, plain, "close", reps=40, haze_blind_ms=0) <= R.duel_rate(plain, plain, "close", reps=40)


def test_the_headset_word_reaches_every_range_and_lands_88_ms_later():
    # F602: the review dropped the headset word past close; compile ships it at every range, about 88 ms behind
    w = R.shipped_world()
    kit = R.make_kit(w, "Shotgun", "shotgun")
    g = kit.guns[0]
    assert g.head_dmg > 0
    f = R.Fighter(kit, 115, 1, R.DIST["mid"], random.Random(2), pull_ms=0)
    tgt = R.Fighter(kit, (500, 0, 0), 0, R.DIST["mid"], random.Random(3))
    tgt.next_t = math.inf
    hits = []
    receive = tgt.receive
    tgt.receive = lambda dmg, **kw: (hits.append((kw["t"], dmg)), receive(dmg, **kw))[1]
    R.fight(random.Random(1), [f], [tgt], cap_ms=150)
    assert hits[:2] == [(0.0, g.gun_dmg), (R.HEADSET_WORD_DELAY_MS, g.head_dmg)], hits
    est = R.finish_estimate(g, pool=g.gun_dmg + g.head_dmg, chance=1.0, ammo=g.mag, reserve=0, reload_amount=0,
                            ready_at=0.0, locked_until=-1.0, t=0.0, pull_ms=0, overshoot_ms=0.0, charged=True,
                            count=0, dist=R.DIST["mid"], heat=0.0, heat_t=0.0, heat_cool_while_firing=True,
                            cooling_started=False)
    assert est == 0.0, est


def test_headset_words_queue_and_a_dead_shooters_word_is_dropped():
    w = R.shipped_world()
    kit = R.make_kit(w, "Shotgun", "shotgun")
    f = R.Fighter(kit, 115, 1, 0, random.Random(2), pull_ms=0)
    tgt = R.Fighter(kit, (500, 0, 0), 0, 0, random.Random(3))
    f.pending_head = 20
    R.queue_word(f, tgt, 0.0)
    R.queue_word(f, tgt, 50.0)          # a second word inside 88 ms queues, it does not overwrite the first
    assert len(f.words) == 2 and R.word_due(f) == R.HEADSET_WORD_DELAY_MS
    R.land_word(f)
    assert tgt.health == 480 and R.word_due(f) == 50.0 + R.HEADSET_WORD_DELAY_MS
    f.alive = False                     # the shooter died since the pull: its headset no longer fires
    assert not R.land_word(f) and tgt.health == 480 and not f.words


def test_a_stop_lets_words_in_flight_land_in_order_with_the_other_events():
    # F602 (Codex re-review): a stop_when exit landed the words at once, before a shot that killed their shooter
    w = R.shipped_world()
    kit = R.make_kit(w, "Shotgun", "shotgun")
    holder = R.Fighter(kit, (1, 0, 0), 1, 0, random.Random(2), pull_ms=0)
    enemy = R.Fighter(kit, (500, 0, 0), 1, 0, random.Random(3), pull_ms=0)
    holder.next_t, enemy.next_t = 0.0, 40.0          # the enemy fires inside the holder's 88 ms
    holder.gs[0].ammo, holder.gs[0].reserve = 1, 0
    R.fight(random.Random(1), [holder], [enemy], stop_when=lambda: holder.gs[0].ammo == 0 and holder.gs[0].reserve == 0)
    assert not holder.alive and enemy.health == 500 - kit.guns[0].gun_dmg


def test_a_stated_headset_reach_keeps_the_word_inside_it_only():
    old = R.HEADSET_WORD_REACH_M
    R.HEADSET_WORD_REACH_M = 10.0      # the U002 proxy's physical reach, a sensitivity line
    try:
        assert R.headset_word_reaches(R.DIST["close"]) and not R.headset_word_reaches(R.DIST["mid"])
        assert R.headset_word_reaches(R.DIST["mid"], 8.0) and not R.headset_word_reaches(R.DIST["close"], 12.0)
        w = R.shipped_world()
        kit = R.make_kit(w, "Shotgun", "shotgun")
        f = R.Fighter(kit, 115, 1, R.DIST["mid"], random.Random(2), pull_ms=0)
        f.targets = [R.Fighter(kit, (500, 0, 0), 0, R.DIST["mid"], random.Random(3))]
        assert f.act(0) is not None and f.pending_head == 0
    finally:
        R.HEADSET_WORD_REACH_M = old
    assert R.headset_word_reaches(R.DIST["long"])


def test_a_lapsed_melee_back_to_a_spent_gun_still_draws_the_secondary():
    # F609 (Opus re-review): the swap back committed the gun, and a spent gun then idled for ever
    w = R.shipped_world()
    kit = R.make_kit(w, "Shotgun + Deagle", "shotgun", "deagle")
    f = R.Fighter(kit, 115, 1, 0, random.Random(2), pull_ms=0, allow_melee=True)
    f.targets = [R.Fighter(kit, (30, 0, 0), 0, 0, random.Random(3))]
    f.gs[0].ammo = f.gs[0].reserve = 0
    assert f.act(0) is None and f.melee_in_hand
    f.targets[0].health = 200
    assert f.act(f.next_t) is None and not f.melee_in_hand
    f.act(f.next_t)
    assert f.active == 1


def test_a_duel_undecided_at_the_cap_is_a_draw_not_a_pool_ranking():
    # F603 (Astra #7): two survivors at the cap were ranked by the pool left, so unused Body Armor counted as a win
    w = R.shipped_world()
    armoured = R.make_kit(w, "AR + BA", R.ANCHOR, R.SECONDARY, "body_armor")
    plain = R.make_kit(w, "AR", R.ANCHOR, R.SECONDARY)
    assert armoured.pool("standard") > plain.pool("standard")
    out = R.duel_outcomes(armoured, plain, "long", reps=20, aim=0.0, cap_ms=2000)
    assert out == {"win": 0, "loss": 0, "trade": 0, "censored": 20, "reps": 20}
    rate = R.duel_rate(armoured, plain, "long", reps=20, aim=0.0, cap_ms=2000)
    assert rate == 0.5 and rate.censored == 1.0


def test_a_rule_broken_only_at_the_ceiling_still_flips():
    # F610 (Opus review): a cell the shipped catalogue fails at real aim could never flip, so a candidate could gut
    # the rule at 0.9 unseen
    def cell(real, ceiling):
        return {"standard|R1": {"value": real, "bar": 0.65, "pass": real >= 0.65, "ceiling_value": ceiling}}
    empty = {"keys": {}, "near_top": {}}
    kept = R.balance_kept(cell(0.40, 0.93), cell(0.40, 0.93), cell(0.20, 0.30), empty, empty, None)
    assert not kept["pass"] and kept["numbers"]["ceiling_rule_flips"] == ["standard|R1"]
    held = R.balance_kept(cell(0.40, 0.93), cell(0.40, 0.93), cell(0.38, 0.90), empty, empty, None)
    assert held["pass"] and not held["numbers"]["ceiling_rule_flips"]


def test_melee_finishes_at_close_only():
    w = R.shipped_world()
    kit = R.make_kit(w, "Glock", "glock")
    assert kit.melee_dmg == w.cat.damage("melee") and kit.melee_ms == w.cat.fire_ms("melee")
    a = R.Fighter(kit, 115, 1, 0, random.Random(2), pull_ms=0, allow_melee=True)
    b = R.Fighter(kit, (30, 0, 0), 0, 0, random.Random(2))
    b.next_t = math.inf
    R.fight(random.Random(1), [a], [b], cap_ms=500 + kit.melee_swap_ms)
    assert not b.alive and a.shots == 1 and a.last_effect == "melee"
    wind = R.Fighter(kit, 115, 1, 0, random.Random(2), pull_ms=0, allow_melee=True)
    wind.targets = [R.Fighter(kit, (30, 0, 0), 0, 0, random.Random(2))]
    assert kit.swap_ms == 0 and kit.melee_swap_ms == w.cat.swap_ms("glock")   # a one-gun kit still draws slot 4
    assert wind.act(0) is None and wind.next_t == kit.melee_swap_ms + R.MELEE_SWING_MS   # the draw, then the swing
    drawn = wind.next_t
    wind.targets[0].health = 200                     # the swing no longer finishes: drop it and pay the swap back
    assert wind.act(drawn) is None and not wind.melee_winding and not wind.melee_in_hand
    assert wind.next_t == drawn + kit.melee_swap_ms
    plain = R.Fighter(kit, 115, 1, 0, random.Random(2), pull_ms=0)     # F609: no melee outside the rush
    plain.targets = [R.Fighter(kit, (30, 0, 0), 0, 0, random.Random(2))]
    assert plain.act(0) is not None and plain.last_effect != "melee"
    c = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0)
    d = R.Fighter(kit, (30, 0, 0), 0, 1, random.Random(2))
    c.targets = [d]
    shot = c.act(0)
    assert shot is not None and shot[0] > 0 and d.alive
    d.receive(shot[0], src=c, t=0, gun=c.last_effect)
    assert d.alive
    no_gun = R.replace(kit, guns=(R.replace(kit.guns[0], gun_dmg=0, head_dmg=0, reserve=0),))
    assert R.time_to_kill(no_gun, 30, 1, 4, dist="close")[0] == math.inf


def test_real_aim_column_uses_the_field_aim_factor():
    w = R.shipped_world()
    ar = R.make_kit(w, "AR", "assault_rifle")
    assert R.REAL_AIM == 0.4
    assert 0.33 <= R.REAL_AIM * B.BAND_FIT[ar.guns[0].band][R.DIST["mid"]] <= 0.43
    assert all(f"real aim {distance}" in R.COLUMNS for distance in R.DIST)
    assert all(f"real aim {distance}" in R.NEAR_TOP_MARGIN for distance in R.DIST)
    ar = R.replace(ar, guns=(R.replace(ar.guns[0], gun_dmg=1, head_dmg=0),))
    landed = shots = 0
    for seed in range(5):
        rng = random.Random(seed)
        a = R.Fighter(ar, 10000, R.REAL_AIM, 1, rng)
        b = R.Fighter(ar, 10000, R.REAL_AIM, 1, rng)
        R.fight(rng, [a], [b], cap_ms=20000)
        landed += 10000 - b.health
        shots += a.shots
    assert shots > 400 and 0.32 <= landed / shots <= 0.46, (shots, landed)


def test_haze_flag_adds_a_separate_close_and_mid_report():
    assert R.build_parser().parse_args(["--candidate", "x.json", "--haze"]).haze
    section = R.haze_report(R.shipped_world(), 8)
    assert {r["range"] for r in section} == {"close", "mid"}
    assert all("plain" in r and "haze" in r for r in section)


def test_plain_baselines_carry_the_matrix_secondary():
    w = R.shipped_world()
    gun_calls, field_calls = [], []
    real_gun, real_field = R.make_kit, R.field_kit

    def gun(world, name, primary, secondary=None, *args, **kw):
        gun_calls.append((name, primary, secondary))
        return real_gun(world, name, primary, secondary, *args, **kw)

    def field(world, name, primary, secondary=None, *args, **kw):
        field_calls.append((name, primary, secondary))
        return real_field(world, name, primary, secondary, *args, **kw)

    with mock.patch.object(R, "make_kit", side_effect=gun), mock.patch.object(R, "field_kit", side_effect=field):
        with mock.patch.object(R, "run_cells", side_effect=lambda jobs, _n: [
                1.0 if j[0] == "field" else (0.0, 0.0) if j[0] == "ambush" else
                (0.5, 0, {"dry": j[3], "died_reloading": 0,
                          "died_heat_locked_or_venting": 0, "died_swapping": 0, "cap": 0})
                if j[0] == "ammo" else 0.5 for j in jobs]):
            R.dominance_matrix(w, [R.KitSpec("AR", R.ANCHOR, R.SECONDARY, None, False)], REPS_SCALE, 1)
        with mock.patch.object(R, "run_cells", side_effect=lambda jobs, _n: [0.5] * len(jobs)):
            R.choose_perks(w, [R.ANCHOR], REPS_SCALE, 1, w)
        with mock.patch.object(R, "duel_rate", return_value=0.5):
            R.haze_report(w, 4)
    for name in ("AR enemy", "AR (plain)", "AR plain", "Assault Rifle|None"):
        assert any(n == name and p == R.ANCHOR and s == R.SECONDARY for n, p, s in gun_calls)
    assert any(n == "AR anchor" and p == R.ANCHOR and s == R.SECONDARY
               for n, p, s in field_calls)


def test_haze_row_blinds_without_damage_and_swing_scales_with_aim():
    w = R.shipped_world()
    haze = R.make_kit(w, "haze", "assault_rifle", "smoke_gun", plan="haze")
    attacker = R.Fighter(haze, 115, 1, 0, random.Random(2), pull_ms=0)
    victim = R.Fighter(haze, 115, 1, 0, random.Random(2))
    attacker.targets = [victim]
    before = victim.pool
    shot = attacker.act(0)
    victim.receive(shot[0], src=attacker, gun=attacker.last_effect)
    assert shot[0] == 0 and victim.pool == before and victim.blind_until == R.HAZE_BLIND_MS
    weak = R.Fighter(R.make_kit(w, "g", "glock"), 115, 0.4, 0, random.Random(2), pull_ms=0, allow_melee=True)
    weak.targets = [R.Fighter(haze, 30, 0, 0, random.Random(2))]
    weak.act(0)
    assert weak.act(weak.next_t)[1] == R.MELEE_HIT_P * 0.4


def test_charge_secondary_starts_charging_at_draw_and_reload_cancels_on_swap():
    w = R.shipped_world()
    kit = R.make_kit(w, "AR CR", "assault_rifle", "charge_rifle", plan="combo")
    f = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0)
    f.targets = [R.Fighter(kit, 115, 0, 1, random.Random(3))]
    f._swap(1, 100)
    assert f.act(100 + kit.swap_ms) is None
    assert f.next_t >= 100 + kit.swap_ms + kit.guns[1].fire_ms
    assert f.act(f.next_t)[0] >= kit.guns[1].gun_dmg
    f2 = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0)
    f2.gs[0].ammo = 0
    f2.targets = f.targets
    f2._act(0)
    assert f2.gs[0].ammo == 0
    f2._swap(1, 1)
    assert f2.gs[0].ammo == 0 and f2.gs[0].ready_at <= 1


def test_finish_estimate_counts_capacity_and_first_round_at_draw():
    w = R.shipped_world()
    kit = R.make_kit(w, "AR Glock", "assault_rifle", "glock")
    f = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0)
    target = R.Fighter(kit, 1000, 0, 1, random.Random(3))
    f.gs[1].reserve = 0
    assert f._finish_ms(1, target, 0) == math.inf
    target.health = kit.guns[1].gun_dmg
    assert f._hit_chance(1) == 1.0
    assert f._finish_ms(1, target, 0) == 0


def test_finished_reload_is_credited_before_swap_and_slot_choice():
    w = R.shipped_world()
    kit = R.make_kit(w, "AR Glock", "assault_rifle", "glock")
    f = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0)
    s = f.gs[0]
    s.ammo, s.reserve, s.reload_amount, s.ready_at = 0, 10, 3, 100
    f._swap(1, 101)
    assert (s.ammo, s.reserve, s.reload_amount) == (3, 7, 0)
    fk = R.field_kit(w, "AR Glock", "assault_rifle", "glock")
    p = R._kit_player(0, 0, fk)
    q = R._kit_player(1, 1, fk)
    cfg = B.SimConfig(pool=B.default_pool())
    match = R.KitMatch([p, q], random.Random(2), cfg, 0.5, 1)
    p.target = 1
    p.ammo, p.reserve, p.reload_amount, p.reload_until = 0, 10, 3, 100
    match._choose_slot(p, 101)
    assert (p.ammo, p.reserve, p.reload_amount) == (3, 7, 0)
    p.reload_amount, p.reload_until = 2, 200
    match._swap_to(p, 1, 201 + fk.swap_ms)
    assert p.stash[0][0:2] == (5, 5)


def test_respawn_clears_pending_reload_and_ready_clock():
    w = R.shipped_world()
    fk = R.field_kit(w, "AR", "assault_rifle", "glock")
    p = R._kit_player(0, 0, fk)
    q = R._kit_player(1, 1, fk)
    cfg = B.SimConfig(pool=B.default_pool())
    match = R.KitMatch([p, q], random.Random(2), cfg, 0.5, 1)
    p.ammo, p.reserve, p.reload_amount, p.reload_until, p.next_ready = 0, 5, 4, 999, 999
    match._respawn(p, 100)
    assert (p.ammo, p.reserve, p.reload_amount) == (fk.models[0].mag, fk.models[0].reserve, 0)
    assert p.reload_until == -1 and p.next_ready <= 100


def test_heat_flag_reaches_perk_and_rush_cells():
    w = R.shipped_world()
    seen = []
    with mock.patch.object(R, "duel_rate", side_effect=lambda *a, **kw: seen.append(kw["heat_cool_while_firing"]) or 0.5):
        R._CACHE.clear()
        R.choose_perks(w, ["charge_rifle"], 0.001, 1, heat_cool_while_firing=False)
    assert seen and set(seen) == {False}
    with mock.patch.object(R, "duel_rate", return_value=0.5) as heated_pair:
        R.sidearm_r10(w, "deagle", 0.001, heat_cool_while_firing=False)
    assert any(call.kwargs.get("heat_cool_while_firing") is False for call in heated_pair.call_args_list)
    real = R.Fighter
    seen.clear()

    class WatchingFighter(real):
        def __init__(self, *args, **kw):
            seen.append(kw.get("heat_cool_while_firing", True))
            super().__init__(*args, **kw)

    with mock.patch.object(R, "Fighter", WatchingFighter):
        R.marksman_rush_counter(R.make_kit(w, "CR", "charge_rifle"),
                                R.make_kit(w, "AR", "assault_rifle"), 1,
                                heat_cool_while_firing=False)
    assert seen and set(seen) == {False}


def test_mirror_primary_only_field_anchor_and_shields_perk_label():
    w = R.shipped_world()
    fk = R.field_kit(w, "candidate", R.ANCHOR)
    anchor = R.field_kit(w, "anchor", R.ANCHOR)
    assert 0.8 <= R.field_ratio(fk, anchor, 2, 12) <= 1.2
    matrix = {"kits": ["AR"], "specs": {"AR": {"primary": R.ANCHOR, "secondary": R.SECONDARY,
               "perk": "quick_hands", "shields_perk": "body_armor", "combo": False}},
              "columns": {"AR": {c: 0.5 for c in R.COLUMNS}}, "near_top": {"AR": []}}
    assert "quick_hands / body_armor" in R.matrix_markdown(matrix)


def test_heat_rows_include_secondary_and_combo_slots():
    matrix = {"specs": {"plain": {"primary": "assault_rifle", "secondary": "charge_rifle"},
                        "combo": {"primary": "sniper_rifle", "secondary": "charge_rifle"}},
              "columns": {"plain": {"field": 1.0}, "combo": {"field": 0.8}},
              "duels": {"standard|mid|plain|combo": 0.6}}
    rows = R.heat_rows(matrix, "charge_rifle")
    assert set(rows["kits"]) == {"plain", "combo"}
    assert rows["kits"]["combo"]["columns"]["field"] == 0.8


def test_shared_finish_estimator_matches_bolt_charge_and_zero_overshoot():
    w = R.shipped_world()
    kit = R.make_kit(w, "bolt", "bolt_rifle")
    f = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0)
    tgt = R.Fighter(kit, (150, 0, 0), 0, 1, random.Random(3))
    cfg = B.SimConfig(pool=B.default_pool(), pull_ms=0, fight_overshoot_ms=0)
    fk = R.field_kit(w, "bolt", "bolt_rifle")
    p, q = R._kit_player(0, 0, fk), R._kit_player(1, 1, fk)
    match = R.KitMatch([p, q], random.Random(2), cfg, 1, 1)
    p.target = 1
    q.health, q.armour, q.shield = 150, 0, 0
    assert f._finish_ms(0, tgt, 0) == match._finish_ms(p, 0, 0, 150)
    combo = R.make_kit(w, "AR CR", "assault_rifle", "charge_rifle", plan="combo")
    charge_f = R.Fighter(combo, 115, 1, 1, random.Random(2), fit=False, pull_ms=0)
    charge_tgt = R.Fighter(combo, combo.guns[1].gun_dmg, 0, 1, random.Random(3))
    assert charge_f._finish_ms(1, charge_tgt, 0) >= combo.guns[1].fire_ms


def test_sniper_finish_per_round_matches_compile_bolt_cycle():
    cat = WeaponCatalog()
    gun = R.make_gun(cat, "sniper_rifle")
    result = R.finish_estimate(gun, pool=150, chance=1, ammo=1, reserve=5,
                               reload_amount=0, ready_at=0, locked_until=0, t=0,
                               pull_ms=R.PULL_MS, overshoot_ms=R.FIGHT_OVERSHOOT_MS,
                               charged=False, count=0, dist="mid", heat=0, heat_t=0,
                               heat_cool_while_firing=True)
    expected = cat.paced_cycle_ms("sniper_rifle")
    assert abs(result - expected) / expected < 0.01, (result, expected)


def test_sampled_sniper_bolt_round_matches_compile_bolt_cycle():
    """F581: the Fighter's sampled bolt round averages compile's bolt cycle. It used to add a second full pull
    gap (about 95 ms a round slower)."""
    rng = random.Random(7)
    row = WeaponCatalog()._row("sniper_rifle")
    gaps = [R.bolt_gap(rng, row["reload_ms"], R.PULL_MS) for _ in range(40000)]
    mean, want = sum(gaps) / len(gaps), WeaponCatalog().paced_cycle_ms("sniper_rifle")
    assert abs(mean - want) / want < 0.01, (round(mean), round(want))


def test_the_sampled_fight_uses_bolt_gap_for_a_bolt_sniper():
    """F581: the Fighter's bolt round goes through `bolt_gap`, so the helper's test covers the fight. Break it by
    restoring an inline two-pull interval in `Fighter`: this fails."""
    with mock.patch.object(R, "bolt_gap", wraps=R.bolt_gap) as gap:
        R.review({"weapon_id": "sniper_rifle", "changes": {"wire.dmg": 74}}, reps_scale=0.001)
    assert gap.call_count > 0


def test_a_two_round_bolt_edit_is_still_a_bolt():
    """F581 review: the review used to call any one-round single shot a bolt, so a Sniper edit to `mag` 2 lost the
    bolt the compiler still runs (it reads `reload_type`)."""
    row = copy.deepcopy(WeaponCatalog()._row("sniper_rifle"))
    row["mag"] = 2
    cat = WeaponCatalog([row if r["weapon_id"] == "sniper_rifle" else r for r in WeaponCatalog()._rows])
    assert R.make_gun(cat, "sniper_rifle").mode == "bolt"


def test_shared_finish_estimator_counts_charge_heat_lockout_in_both_engines():
    row = copy.deepcopy(WeaponCatalog()._row("charge_rifle"))
    row["heat"]["per_charge"] = 55
    row["heat"]["per_tap"] = 14
    world = R.World(WeaponCatalog([row]), PerkCatalog())
    kit = R.make_kit(world, "charge", "charge_rifle")
    field = R.field_kit(world, "charge", "charge_rifle")
    for cooling, expected in ((False, 4 * 285 + 4800), (True, 5 * 285)):
        fighter = R.Fighter(kit, 115, 1, 1, random.Random(2), fit=False, pull_ms=0,
                            heat_cool_while_firing=cooling)
        victim = R.Fighter(kit, 150, 0, 1, random.Random(3))
        cfg = B.SimConfig(pool=B.default_pool(), pull_ms=0, fight_overshoot_ms=0,
                          heat_cool_while_firing=cooling, range_model=False)
        p, q = R._kit_player(0, 0, field), R._kit_player(1, 1, field)
        match = R.KitMatch([p, q], random.Random(2), cfg, 1, 1)
        p.target = 1
        assert fighter._finish_ms(0, victim, 0) == expected
        assert match._finish_ms(p, 0, 0, 150) == expected


def test_fighter_fires_a_completed_reload_without_drawing_the_secondary():
    world = R.shipped_world()
    kit = R.make_kit(world, "AR Glock", "assault_rifle", "glock")
    fighter = R.Fighter(kit, 115, 1, 1, random.Random(2), pull_ms=0)
    fighter.targets = [R.Fighter(kit, 24, 0, 1, random.Random(3))]
    state = fighter.gs[0]
    state.ammo, state.reserve, state.reload_amount, state.ready_at = 0, 10, 3, 100
    shot = fighter.act(100)
    assert shot is not None and fighter.active == 0
    assert (state.ammo, state.reserve, state.reload_amount) == (2, 7, 0)


def test_lever_vent_waits_for_swap_and_rush_drains_dot_after_kill():
    w = R.shipped_world()
    fk = R.field_kit(w, "energy", "energy_rifle", "glock")
    p, q = R._kit_player(0, 0, fk), R._kit_player(1, 1, fk)
    cfg = B.SimConfig(pool=B.default_pool())
    match = R.KitMatch([p, q], random.Random(2), cfg, 1, 1)
    p.target, p.engage_id, p.contact_end = 1, 1, 1000
    p.heat_lock_until, p.swap_until = math.inf, 100
    match._shot(p, 0, 1)
    assert p.reload_amount == 0 and p.heat_lock_until == math.inf
    mkit = R.make_kit(w, "Glock", "glock")
    mkit = R.replace(mkit, guns=(R.replace(mkit.guns[0], gun_dmg=0, head_dmg=0),), melee_dmg=0)
    vkit = R.make_kit(w, "Deagle", "deagle")
    m = R.Fighter(mkit, (1, 0, 0), 1, 0, random.Random(2), pull_ms=0)
    v = R.Fighter(vkit, (100, 0, 0), 1, 0, random.Random(3), pull_ms=0)
    v.dot_next, v.dot_left, v.dot_dmg, v.dot_ms, v.dot_src = 1200, 1, 100, 1000, m

    class Hits(random.Random):
        def random(self):
            return 0.0

    R.rush_encounter(Hits(2), m, v, 0)
    assert not m.alive and not v.alive and 1200 in m.kill_times, \
        (m.alive, v.alive, m.kill_times, v.kill_times)


def test_heat_ap_facts_and_shields_perk_selection():
    w = R.shipped_world()
    facts = R._facts(w.cat, "charge_rifle")
    assert "heat" in facts and "ap_dmg" in facts and "ap_fire_ms" in facts
    best, scores = R.choose_perks(w, ["assault_rifle"], REPS_SCALE, 1, w)
    assert set(best["assault_rifle"]) == {"standard", "shields"}
    assert "armor_piercing" in scores["assault_rifle"]["shields"]


def test_op_rule_checks_ap_against_lowest_health():
    w = R.shipped_world()
    row = copy.deepcopy(w.cat._row("assault_rifle"))
    row["ap_dmg"] = 45
    world = R.World(WeaponCatalog([r if r["weapon_id"] != "assault_rifle" else row
                                   for r in w.cat._rows]), w.perks)
    checked = R.op_check(world, ["assault_rifle"])["assault_rifle"]
    assert checked["ap_dmg"] == 45 and not checked["pass"]


def test_heat_candidate_reports_all_cooling_assumptions():
    args = R.build_parser().parse_args(["--candidate", "x.json", "--heat-cool-while-firing", "off"])
    assert args.heat_cool_while_firing == "off"
    v = R.review({"weapon_id": "charge_rifle", "changes": {"heat.cool_per_s": 29}},
                 reps_scale=0.001, heat_cool_while_firing=False)
    assert v["facts"]["candidate"]["heat"]["cool_per_s"] == 29
    assert set(v["heat"]["charge_rifle"]) == set(B.HEAT_COOLING_BRANCHES)
    assert v["heat"]["charge_rifle"]["throughout"]["candidate"]["columns"]
    assert v["heat"]["charge_rifle"]["none"]["candidate"]["duels"]
    assert "CR+Sniper+BA" in v["heat"]["charge_rifle"]["after_lockout"]["candidate"]["kits"]
    assert "Heat: cooling throughout / after lockout / none" in R.report_markdown(v)
    assert "| field | 150 s kill-count match |" in R.report_markdown(v)
    assert "## Heated Balance rule cells" in R.report_markdown(v)
    assert "shields|R1" not in v.get("failed_heat_branches", {}).get("none", [])
    assert "shields|R1" in v["heat_rules"]
    assert not v["heat_rules"]["shields|R1"]["none"]["shipped"]["pass"]


def test_heated_pickup_utility_checks_every_cooling_branch():
    row = _copy("charge_rifle", "test_heated_pickup", "Heated pickup")
    row.update(pickup_only=True, hidden=True)
    row["wire"]["tap_dmg"] = 45
    v = R.review({"row": row}, reps_scale=0.001)
    utility = v["heat_pickup_utility"]
    assert set(utility) == set(B.HEAT_COOLING_BRANCHES)
    assert {branch: (result["numbers"]["kills_per_stock"], result["numbers"]["median_ttk_ms"])
            for branch, result in utility.items()} == {
                "throughout": (30.5, 855.0), "after_lockout": (31.0, 570.0), "none": (31.0, 5940.0)}
    assert utility["throughout"]["pass"]
    assert utility["throughout"]["numbers"]["median_ttk_ms"] <= R.PICKUP_TTK_BAR_MS
    assert not utility["none"]["pass"]
    assert utility["none"]["numbers"]["median_ttk_ms"] > R.PICKUP_TTK_BAR_MS
    assert "pickup_utility" in v["failed_heat_branches"]["none"]
    assert not v["tests"]["heat_sensitivity"]["pass"]
    assert "| none |" in R.report_markdown(v).split("## Heated pickup utility", 1)[1]


def test_unheated_candidate_checks_heat_branches_because_roster_rules_include_heat():
    with mock.patch.object(R, "run_rules", wraps=R.run_rules) as rules, \
         mock.patch.object(R, "run_heated_rules", wraps=R.run_heated_rules) as heated_rules, \
         mock.patch.object(R, "dominance_matrix", wraps=R.dominance_matrix) as matrices:
        v = R.review({"weapon_id": "shotgun", "changes": {"wire.dmg": 30}}, reps_scale=0.001)
    assert "heat_sensitivity" in v["tests"]
    assert v["heat"]
    assert rules.call_count == 3
    assert heated_rules.call_count > 0
    assert matrices.call_count > 2


def test_pickup_only_heated_candidate_gets_heat_branches():
    row = _copy("charge_rifle", "test_heated_pickup", "Heated pickup")
    row.update(pickup_only=True, hidden=True)
    v = R.review({"row": row}, reps_scale=0.001)
    assert "heat_sensitivity" in v["tests"]


def test_a_rule_flip_only_after_lockout_names_that_branch():
    real = R.run_heated_rules

    def altered(world, scale, n_jobs, branch, ids):
        result = real(world, scale, n_jobs, branch, ids)
        changed = world.cat._row("charge_rifle").get("heat", {}).get("cool_per_s") == 29
        if branch == "after_lockout":
            result["standard|R1"] = {"value": 0.5 if changed else 0.9, "bar": 0.65,
                                      "pass": not changed}
        return result

    with mock.patch.object(R, "run_heated_rules", side_effect=altered):
        v = R.review({"weapon_id": "charge_rifle", "changes": {"heat.cool_per_s": 29}},
                     reps_scale=0.001)
    assert "standard|R1" in v["failed_heat_branches"]["after_lockout"]
    assert "standard|R1" not in v["failed_heat_branches"].get("throughout", [])


def test_branch_niche_score_loss_is_recorded_beside_a_rule_flip():
    real_matrix = R.dominance_matrix
    real_rules = R.run_heated_rules

    def matrix(world, specs, scale, n_jobs, *, anchor_world, heat_cool_while_firing):
        result = real_matrix(world, specs, scale, n_jobs, anchor_world=anchor_world,
                             heat_cool_while_firing=heat_cool_while_firing)
        if heat_cool_while_firing == "none":
            result = copy.deepcopy(result)
            if world.cat._row("charge_rifle")["heat"]["cool_per_s"] == 29:
                result["near_top"]["Shotgun"] = []
                result["columns"]["Shotgun"]["peek mid"] = 0.0
            else:
                result["near_top"]["Shotgun"] = ["peek mid"]
            result["reps"]["duel"] = 1_000_000
        return result

    def rules(world, scale, n_jobs, branch, ids):
        result = real_rules(world, scale, n_jobs, branch, ids)
        if branch == "none":
            changed = world.cat._row("charge_rifle")["heat"]["cool_per_s"] == 29
            result["standard|R1"] = {"value": 0.5 if changed else 0.9, "bar": 0.65,
                                      "pass": not changed}
        return result

    with mock.patch.object(R, "dominance_matrix", side_effect=matrix), \
         mock.patch.object(R, "run_heated_rules", side_effect=rules):
        v = R.review({"weapon_id": "charge_rifle", "changes": {"heat.cool_per_s": 29}},
                     reps_scale=0.001)
    assert "standard|R1" in v["failed_heat_branches"]["none"]
    assert "balance_kept:shotgun" in v["failed_heat_branches"]["none"]
    assert "balance_kept:shotgun" not in v["failed_heat_branches"].get("throughout", [])
    assert v["heat_last_cell_losses"]["none"] == ["shotgun"]
    assert "shotgun" not in v["heat_last_cell_losses"]["throughout"]


def test_reference_heat_keeps_field_ambush_hill_and_ammo_on_selected_branch():
    shipped = R.shipped_world()
    heated = []
    for row in shipped.cat._rows:
        copy_row = copy.deepcopy(row)
        if row["weapon_id"] in {R.ANCHOR, R.HILL_REFERENCES[0]}:
            copy_row["heat"] = {"per_round": 1, "lock_at": 100, "cool_per_s": 30}
        heated.append(copy_row)
    baseline = R.World(WeaponCatalog(heated), shipped.perks)
    specs = [R.KitSpec("Shotgun", "shotgun", R.SECONDARY, None, False)]
    R.clear_cache()
    with mock.patch.object(R, "run_cells", wraps=R.run_cells) as cells:
        R.dominance_matrix(shipped, specs, 0.001, 1, anchor_world=baseline,
                           heat_cool_while_firing="none")
    jobs = cells.call_args.args[0]
    affected = [job for job in jobs if job[0] in {"field", "ambush", "hill_hold", "ammo"}
                and any(gun.heat for participant in job[1:-1]
                        for gun in getattr(participant, "guns", getattr(participant, "models", ())))]
    assert {job[0] for job in affected} == {"field", "ambush", "hill_hold", "ammo"}
    assert all(job[-1] == "none" for job in affected)


def test_unheated_matrix_cells_share_cache_across_heat_branches():
    w = R.shipped_world()
    specs = [R.KitSpec("AR", R.ANCHOR, R.SECONDARY, None, False),
             R.KitSpec("Shotgun", "shotgun", R.SECONDARY, None, False),
             R.KitSpec("CR", "charge_rifle", R.SECONDARY, None, False)]
    R.clear_cache()
    throughout = R.dominance_matrix(w, specs, 0.001, 1, anchor_world=w,
                                     heat_cool_while_firing="throughout")
    old_jobs = set(R._CACHE)
    none = R.dominance_matrix(w, specs, 0.001, 1, anchor_world=w,
                              heat_cool_while_firing="none")
    assert all(job[-1] == "none" for job in set(R._CACHE) - old_jobs)
    assert throughout["duels"]["standard|close|AR|Shotgun"] == none["duels"]["standard|close|AR|Shotgun"]
    assert throughout["columns"]["AR"]["field"] == none["columns"]["AR"]["field"]


def test_heated_perk_candidate_runs_heat_branches():
    v = R.review({"perk_id": "body_armor", "changes": {"max_armor_add": 31}}, reps_scale=0.001)
    assert "heat_sensitivity" in v["tests"]
    assert "charge_rifle" in v["heat"]


def test_rush_sweep_reuses_verdict_at_five_metres_per_second():
    w = R.shipped_world()
    mk = R.make_kit(w, "Sniper", "sniper_rifle")
    ar = R.make_kit(w, "AR", R.ANCHOR)
    ba = R.make_kit(w, "AR+BA", R.ANCHOR, perk="body_armor")
    plain = {"peek_kill": 0.7, "peek_death": 0.1, "escape": 0.2, "rush_success": 0.6}
    armoured = {**plain, "rush_success": 0.55}
    original = R.marksman_rush_counter
    def other_speeds(*args, **kwargs):
        assert kwargs["speed_m_s"] != R.RUSH_SPEED_MS
        return original(*args, **kwargs)
    with mock.patch.object(R, "marksman_rush_counter", side_effect=other_speeds):
        rows = R.rush_speed_sweep(mk, ar, ba, 4, verdict_plain=plain, verdict_armoured=armoured)
    assert rows[1]["plain"] is plain and rows[1]["body_armor"] is armoured


def test_shields_regenerate_after_quiet_window():
    f = R.Fighter(R.make_kit(R.shipped_world(), "target", "assault_rifle"),
                  (45, 0, 105), 1.0, 1, random.Random(2))
    f.receive(30, t=0)
    f.advance_shield(6499)
    assert f.shield == 75
    f.advance_shield(6500)
    assert f.shield == 102
    f.advance_shield(7500)
    assert f.shield == 105


def test_energy_vent_keeps_heat_until_reload_finishes():
    kit = R.make_kit(R.shipped_world(), "energy", "energy_rifle")
    f = R.Fighter(kit, 115, 1.0, 1, random.Random(2), pull_ms=0)
    s = f.gs[0]
    s.heat = 197
    assert f.act(0) is not None
    assert s.heat == 200 and s.locked_until == math.inf
    assert f.act(kit.guns[0].fire_ms) is None
    assert s.vent_heat_after == 95 and s.heat == 200
    f._credit_reload(s, s.vent_until)
    assert s.heat == 95 and s.locked_until == 0


def test_heat_review_names_all_branches_and_horizons():
    args = R.build_parser().parse_args(["--candidate", "x.json", "--heat-cooling", "after_lockout"])
    assert args.heat_cooling == "after_lockout"
    a = R.assumptions()
    assert a["horizons"]["field"] == "150 s kill-count match"
    assert a["horizons"]["long contact"] == "20 s first kill"
    assert set(a["heat_cooling_branches"]) == {"throughout", "after_lockout", "none"}


def test_record_needs_a_call_a_clean_tree_and_an_unmoved_fingerprint():
    """Each refusal fires on its own, and a clean verdict appends a section. Break any guard once and watch its
    case record."""
    fp = R.fingerprint()
    assert fp == R.fingerprint() and len(fp) == 16
    v = {"date": "2026-10-18", "title": "t", "pass": True, "scenario_version": R.SCENARIO_VERSION, "seed": R.SEED,
         "git_sha": "abc", "fingerprint": fp, "dirty": False, "reps_scale": 1.0, "candidate": {"weapon_id": "x"},
         "tests": {"op_rule": {"status": "pass", "numbers": {"failing": []}}}}
    clean = {"dirty_now": False, "fingerprint_now": fp}
    R.record_guard(v, "Tony: ship it", **clean)
    _raises(lambda: R.record_guard(v, "pending", **clean), "call")
    _raises(lambda: R.record_guard(v, "", **clean), "call")
    _raises(lambda: R.record_guard(dict(v, reps_scale=0.01), "Tony: yes", **clean), "scaled")
    _raises(lambda: R.record_guard(dict(v, dirty=True), "Tony: yes", **clean), "dirty")
    _raises(lambda: R.record_guard(v, "Tony: yes", dirty_now=True, fingerprint_now=fp), "dirty")
    _raises(lambda: R.record_guard(v, "Tony: yes", dirty_now=False, fingerprint_now="0" * 16), "fingerprint")
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "log.md"
        p.write_text("# log\n\n")
        R.record(v, "Tony: ship it", p)
        R.record(dict(v, title="t2"), "Tony: no", p)
        text = p.read_text()
        assert text.index("## 2026-10-18: t\n") < text.index("## 2026-10-18: t2\n")
        assert "Tony's call: Tony: ship it" in text and f"fingerprint `{fp}`" in text
        verdict = pathlib.Path(d) / "v.json"
        verdict.write_text(json.dumps(v))
        _raises(lambda: R.main(["--record-from", str(verdict)]), "call")
        # --record takes no path: the decision log is the only file it can write (round-2 review)
        _raises(lambda: R.main(["--record-from", str(verdict), "--record", str(p), "--call", "Tony: x"]), "")
        # A log that ends on one newline still gets a blank line before the heading, and a FAIL names its
        # failing tests in words, not only in the table (F573 record)
        q = pathlib.Path(d) / "tight.md"
        q.write_text("# log\n\nlast paragraph.\n")
        bad = dict(v, title="f", tests={"op_rule": {"status": "pass", "numbers": {}},
                                        "viable": {"status": "fail", "numbers": {}},
                                        "balance_kept": {"status": "fail", "numbers": {}}})
        bad["pass"] = False
        R.record(bad, "Tony: ship it anyway", q)
        tight = q.read_text()
        assert "last paragraph.\n\n## 2026-10-18: f\n" in tight, tight
        assert "- Fails: viable, balance_kept." in tight, tight
        assert "- Fails:" not in text


def test_the_verdict_states_the_compiled_pools_and_they_match_the_sim():
    # F604 (Astra #11): every candidate report states the pools the compiler arms, and they equal the sim's
    w = R.shipped_world()
    pools = R.compiled_pools(w)
    for pid in [None] + R.fieldable_perks(w.perks):
        for preset in ("standard", "shields"):
            if pools[str(pid or "none")][preset] is not None:     # None: the preset refuses the perk
                assert pools[str(pid or "none")][preset] == list(R.pool_parts(preset, w.perks.effects(pid)))
    assert pools["body_armor"]["shields"] is None
    rows = [dict(r, effects=dict(r.get("effects") or {})) for r in w.perks._rows]
    next(r for r in rows if r["perk_id"] == "body_armor")["effects"]["max_armor_add"] = 40
    cand = R.World(w.cat, R.PerkCatalog(rows))
    assert R.compiled_pools(cand)["body_armor"]["standard"][1] == 110
