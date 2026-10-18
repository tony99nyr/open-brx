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
                         "Energy Rifle", "Charge Rifle", "Toxin Rifle", "CR+Sniper+BA", "CR+Sniper+QS"], a["kits"]
    assert a["keys"]["Sniper Rifle"] == "sniper_rifle" and a["keys"]["CR+Sniper+BA"] == "CR+Sniper+BA"
    assert R.COLUMNS == ("1v1 close", "1v1 mid", "1v1 long", "1v1 real aim", "long contact",
                         "peek mid", "field", "ambush", "shields", "hill hold", "ammo stress")
    assert set(R.NEAR_TOP_MARGIN) == set(R.COLUMNS)
    assert a["columns"]["Assault Rifle"]["ammo stress"] > 0
    assert set(a["ammo_stress_cap_hits"]) == set(a["kits"])
    assert set(a["ammo_stress_end_reasons"]) == set(a["kits"])
    assert all(sum(counts.values()) == R._reps("ammo", MATRIX_REPS_SCALE)
               for counts in a["ammo_stress_end_reasons"].values() if counts)
    assert a["ammo_stress_anchor_cap_hits"] == 0
    assert a["ammo_stress_cap_hits"]["Energy Rifle"] == 0
    assert json.dumps(a["columns"], sort_keys=True) == json.dumps(b["columns"], sort_keys=True)
    assert a["duels"] == b["duels"]


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


def test_bolt_kits_have_no_ammo_stress_cell_or_last_cell_loss():
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
    # Ammo stress would be the candidate's only near-top cell, but a bolt has no score there.
    candidate["near_top"]["Sniper"] = [column for column in ("ammo stress",)
                                          if math.isfinite(candidate["columns"]["Sniper"][column])]
    assert candidate["near_top"]["Sniper"] == []
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


# --------------------------------------------------------------------------- the named tests, end to end

def test_a_dominant_candidate_fails_no_domination():
    """An Assault Rifle copy at about four and a half times the damage (40) is near the top everywhere (at three times, 27, the 75-damage
    bolt Sniper still out-peeks it at range: F573). Break it once (every margin -1) and watch it pass."""
    code, v = _review_cli({"title": "dominant", "row": _copy("assault_rifle", "test_ar_heavy", "Test AR heavy", dmg=40)})
    t = v["tests"]["no_domination"]
    assert t["status"] == "fail" and "Test AR heavy" in t["numbers"]["near_top_everywhere"], t
    assert code == 1 and v["pass"] is False and v["reps_scale"] == DOMINANCE_REPS_SCALE


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
    """A weak bolt Sniper (20 a hit) is near the top nowhere; the bolt alone carries value_addition. Break it once
    (drop the bolt feature from trigger_mechanics) and watch it fail."""
    v = R.review({"weapon_id": "sniper_rifle", "changes": {"wire.dmg": 20}}, reps_scale=REPS_SCALE)
    t = v["tests"]["value_addition"]
    assert t["numbers"]["near_top_in"] == [], t
    assert t["numbers"]["new_mechanics"] == ["bolt action (1-round magazine)"] and t["status"] == "pass", t


def test_a_pickup_only_candidate_is_not_judged_on_loadout_value():
    """Rule 7: no player spawns with a pickup, so value_addition and viable are n/a, never a fail. Break it once
    (drop the pickup branch) and watch value_addition fail."""
    row = dict(_copy("assault_rifle", "test_pickup", "Test pickup", dmg=2), pickup_only=True)
    v = R.review({"row": row}, reps_scale=REPS_SCALE)
    assert v["tests"]["value_addition"]["status"] == "n/a", v["tests"]["value_addition"]
    assert v["tests"]["viable"]["status"] == "n/a"
    assert v["tests"]["op_rule"]["status"] == "pass"


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
    t = R.balance_kept(ok, ok, ok, renamed_b, renamed_c, "amr")
    assert t["numbers"]["kits_losing_last_near_top"] == ["sniper_rifle"], t


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
    assert R._run_rule("R1", "recoil", "standard", sig, 200) == ci.win_rate


def test_op_rule_gates_on_the_crit_pull_and_on_every_fieldable_perk():
    """Rule 7. A 70-damage row with a 40% crit lands 105 on a crit, over the 95 Quick Switch pool. A visible perk
    with an unmodelled key still sets a pool: -30 armour beside Armour Piercing drops Standard to 85, so a 90 row
    one-shots. A pickup is exempt. Break it once (gate on the plain pull, or use modelled perks) and watch one pass."""
    perks = copy.deepcopy(PerkCatalog()._rows)
    perks.append({"perk_id": "test_glass", "name": "Glass", "effects": {"max_armor_add": -30, "armor_piercing": True}})
    rows = WeaponCatalog()._rows + [
        dict(_copy("amr", "test_crit", "Test crit", dmg=70), crit_pct=40),
        _copy("assault_rifle", "test_90", "Test 90", dmg=90),
        dict(_copy("assault_rifle", "test_pickup", "Test pickup", dmg=150), pickup_only=True)]
    plain = R.World(WeaponCatalog(rows), PerkCatalog())
    glass = R.World(WeaponCatalog(rows), PerkCatalog(perks))
    op = R.op_check(plain, ["test_crit", "test_90", "test_pickup", "sniper_rifle"])
    assert op["test_crit"]["crit_pull"] == 105 and not op["test_crit"]["pass"]
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
    assert R.marksman_verdict(good, good, [])["status"] == "fail"
    far = {"peek_kill": 0.7, "rush_success": 0.3}
    numbers = R.marksman_verdict(good, good, [R.MARKSMAN_STRONG_COLUMN], far, far)["numbers"]
    assert numbers["vs_plain_ar_30m"] == far and numbers["rush_start_m"] == 20.0
    assert R.MARKSMAN_STRONG_COLUMN in R.COLUMNS


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
    ar_hold = R.hill_hold(kits["Assault Rifle"], ar, 1000)
    assert 0 < shotgun_hold < 1 and 0 < ar_hold < 1, (shotgun_hold, ar_hold)
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
    assert R.SCENARIO_VERSION == 9
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
    rate = R.duel_rate(shotgun, ar, "close", reps=200)
    assert rate == 0.47, rate


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
        assert R.make_kit(cand, "x", "sniper_rifle", perk="quick_hands").guns[0].reload_ms == 1700
        assert R.make_kit(cand, "x", "sniper_rifle", perk="extended_mags").guns[0].mag == 1
        assert R.make_kit(base, "x", "assault_rifle", perk="quick_hands").guns[0].reload_ms == 700

        row = R.load_candidate(write(_copy("assault_rifle", "test_ar_new", "Test AR new", dmg=10)))
        base, cand = R.build_worlds(row)
        assert "test_ar_new" in cand.cat._by_id and "test_ar_new" not in base.cat._by_id

        perk = R.load_candidate(write({"perk_id": "quick_hands", "changes": {"reload_mult": 0.4}}))
        base, cand = R.build_worlds(perk)
        assert base.fx("quick_hands")["reload_mult"] == 0.5 and cand.fx("quick_hands")["reload_mult"] == 0.4

        for bad, text in ((({"tap_dmg": 14}), "tap_dmg"), ({"mag": 2, "wire.dmgg": 61}, "wire.dmgg"),
                          ({"mag": 2, "wire.dmg": 75}, "wire.dmg"), ({"wire.range_outdoor_pct": 90}, "range_outdoor")):
            c = R.load_candidate(write({"weapon_id": "sniper_rifle", "changes": bad}))
            _raises(lambda: R.build_worlds(c), text)
        _raises(lambda: R.build_worlds(R.load_candidate(write({"perk_id": "quick_hands", "changes": {"reload_mult": 0.5}}))),
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
    assert ap.guns[0].gun_dmg == w.cat._row("assault_rifle")["ap_dmg"]
    assert ap.guns[0].fire_ms == w.cat._row("assault_rifle")["ap_fire_ms"]
    assert ap.guns[0].head_dmg == 0
    victim = R.Fighter(plain, (45, 70, 0), 0, 1, random.Random(2))
    shooter = R.Fighter(ap, (45, 70, 0), 1, 1, random.Random(2), pull_ms=0)
    victim.next_t = math.inf
    n = math.ceil(45 / ap.guns[0].gun_dmg)
    R.fight(random.Random(2), [shooter], [victim], cap_ms=n * ap.guns[0].fire_ms)
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


def test_melee_finishes_at_close_only():
    w = R.shipped_world()
    kit = R.make_kit(w, "Glock", "glock")
    assert kit.melee_dmg == w.cat.damage("melee") and kit.melee_ms == w.cat.fire_ms("melee")
    a = R.Fighter(kit, 115, 1, 0, random.Random(2), pull_ms=0)
    b = R.Fighter(kit, (30, 0, 0), 0, 0, random.Random(2))
    b.next_t = math.inf
    R.fight(random.Random(1), [a], [b], cap_ms=500)
    assert not b.alive and a.shots == 1 and a.last_effect == "melee"
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
    assert "1v1 real aim" in R.COLUMNS
    assert "1v1 real aim" in R.NEAR_TOP_MARGIN
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
    weak = R.Fighter(R.make_kit(w, "g", "glock"), 115, 0.4, 0, random.Random(2), pull_ms=0)
    weak.targets = [R.Fighter(haze, 30, 0, 0, random.Random(2))]
    weak.act(0)
    assert weak.act(R.MELEE_SWING_MS)[1] == R.MELEE_HIT_P * 0.4


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
    assert any("shields|R1" in name for name in v["failed_heat_branches"]["none"])
    assert v["tests"]["heat_sensitivity"]["status"] == "fail"


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
