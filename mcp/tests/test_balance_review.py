"""The balance review tool (`mcp/tools/balance_review.py`) gives the same verdict for the same input, and
each named test catches the candidate it exists to catch.

Every test runs at `REPS_SCALE` (the test-only `reps_scale`): the same seeds and code paths as a real
review, with far fewer reps. A scaled verdict is never recorded. Nothing here writes to docs/.
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

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import balance_review as R  # noqa: E402
import balance_sim as B  # noqa: E402
from brx_mcp.mc.compile import PULL_SIGMA, WeaponCatalog, armed_armor, armed_shield  # noqa: E402
from brx_mcp.mc.perks import PerkCatalog  # noqa: E402

REPS_SCALE = 0.01


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
            code = R.main(["--candidate", str(src), "--out", str(out), "--jobs", "1", "--reps-scale", str(REPS_SCALE)])
        return code, json.loads(out.read_text())


def _shipped_specs():
    w = R.shipped_world()
    return w, R.build_kits(w, REPS_SCALE, 1, anchor_world=w)[0]


# --------------------------------------------------------------------------- the matrix

def test_the_matrix_has_todays_kits_and_columns_and_one_seed_gives_one_answer():
    """Today's kits (every visible lethal primary but the DoT Toxin Rifle, plus the two combos) and the versioned
    columns. Two runs with the cache cleared give identical cells. Break it once (seed a cell from
    `random.Random()`) and watch the equality fail."""
    runs = []
    for _ in range(2):
        R.clear_cache()
        w, specs = _shipped_specs()
        runs.append(R.dominance_matrix(w, specs, REPS_SCALE, 1, anchor_world=w))
    a, b = runs
    assert a["kits"] == ["Assault Rifle", "Burst Rifle", "SMG", "Shotgun", "Sniper Rifle", "AMR", "Suppressor",
                         "Energy Rifle", "Charge Rifle", "CR+Sniper+BA", "CR+Sniper+QS"], a["kits"]
    assert a["keys"]["Sniper Rifle"] == "sniper_rifle" and a["keys"]["CR+Sniper+BA"] == "CR+Sniper+BA"
    assert R.COLUMNS == ("1v1 close", "1v1 mid", "1v1 long", "long contact", "peek mid", "field", "ambush", "shields")
    assert a["columns"] == b["columns"] and a["duels"] == b["duels"]


def test_four_workers_give_the_numbers_one_worker_gives():
    """--jobs changes nothing. Break it once (key a cell's rng on the worker's pid) and watch it differ."""
    w, specs = _shipped_specs()
    R.clear_cache()
    one = R.dominance_matrix(w, specs, REPS_SCALE, 1, anchor_world=w)
    R.clear_cache()
    four = R.dominance_matrix(w, specs, REPS_SCALE, 4, anchor_world=w)
    assert one["columns"] == four["columns"] and one["duels"] == four["duels"]


def test_the_column_top_ignores_nan():
    """A cell that did not run is NaN. Break it once (plain max) and watch NaN win."""
    assert R._top([float("nan"), 0.4, 0.5]) == 0.5
    assert math.isnan(R._top([float("nan")]))


# --------------------------------------------------------------------------- the named tests, end to end

def test_a_dominant_candidate_fails_no_domination():
    """An Assault Rifle copy at three times the damage is near the top everywhere. Break it once (every margin -1)
    and watch it pass."""
    code, v = _review_cli({"title": "dominant", "row": _copy("assault_rifle", "test_ar_heavy", "Test AR heavy", dmg=27)})
    t = v["tests"]["no_domination"]
    assert t["status"] == "fail" and "Test AR heavy" in t["numbers"]["near_top_everywhere"], t
    assert code == 1 and v["pass"] is False and v["reps_scale"] == REPS_SCALE


def test_a_useless_ar_change_fails_viable_against_the_baseline_ar():
    """The AR itself at 1 damage. The field ratio and the ambush anchor on the BASELINE AR, so the change cannot
    pass by being measured against itself. Break it once (anchor on the candidate world) and watch the ratio
    sit near 1 and pass."""
    v = R.review({"weapon_id": "assault_rifle", "changes": {"wire.dmg": 1}}, reps_scale=REPS_SCALE)
    t = v["tests"]["viable"]
    assert t["status"] == "fail" and t["numbers"]["field"] < R.VIABLE_FIELD_FLOOR, t


def test_only_a_new_mechanic_can_carry_value_addition():
    """A weak 1-round-magazine Sniper is near the top nowhere; the bolt alone carries value_addition. Break it once
    (drop the bolt feature from trigger_mechanics) and watch it fail."""
    v = R.review({"weapon_id": "sniper_rifle", "changes": {"mag": 1, "wire.dmg": 20}}, reps_scale=REPS_SCALE)
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
    assert R.MARKSMAN_STRONG_COLUMN in R.COLUMNS


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

        diff = R.load_candidate(write({"weapon_id": "sniper_rifle", "changes": {"mag": 1, "wire.dmg": 57, "reload_type": "bolt"},
                                       "with": [{"weapon_id": "charge_rifle", "changes": {"wire.tap_dmg": 14}}]}))
        base, cand = R.build_worlds(diff)
        assert base.cat.damage("sniper_rifle") == 60 and cand.cat.damage("sniper_rifle") == 57
        assert base.cat.tap_damage("charge_rifle") == cand.cat.tap_damage("charge_rifle") == 14
        assert R.make_kit(cand, "x", "sniper_rifle", perk="quick_hands").guns[0].reload_ms == 1700
        assert R.make_kit(cand, "x", "sniper_rifle", perk="extended_mags").guns[0].mag == 1
        assert R.make_kit(base, "x", "sniper_rifle", perk="quick_hands").guns[0].reload_ms == 850

        row = R.load_candidate(write(_copy("assault_rifle", "test_ar_new", "Test AR new", dmg=10)))
        base, cand = R.build_worlds(row)
        assert "test_ar_new" in cand.cat._by_id and "test_ar_new" not in base.cat._by_id

        perk = R.load_candidate(write({"perk_id": "quick_hands", "changes": {"reload_mult": 0.4}}))
        base, cand = R.build_worlds(perk)
        assert base.fx("quick_hands")["reload_mult"] == 0.5 and cand.fx("quick_hands")["reload_mult"] == 0.4

        for bad, text in ((({"tap_dmg": 14}), "tap_dmg"), ({"mag": 2, "wire.dmgg": 61}, "wire.dmgg"),
                          ({"mag": 2, "wire.dmg": 60}, "wire.dmg"), ({"wire.range_outdoor_pct": 90}, "range_outdoor")):
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
