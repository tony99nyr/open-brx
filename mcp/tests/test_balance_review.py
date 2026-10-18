"""The balance review tool (`mcp/tools/balance_review.py`) gives the same verdict for the same input, and
each named test catches the candidate it exists to catch.

Every test runs at `REPS_SCALE` (the test-only `reps_scale`): the same seeds and code paths as a real
review, with far fewer reps. A scaled verdict is never recorded. Nothing here writes to docs/.
"""
import contextlib
import copy
import io
import json
import pathlib
import sys
import tempfile

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import balance_review as R  # noqa: E402
from brx_mcp.mc.compile import WeaponCatalog, armed_armor, armed_shield  # noqa: E402
from brx_mcp.mc.perks import PerkCatalog  # noqa: E402

REPS_SCALE = 0.01


def _ar_copy(weapon_id: str, name: str, dmg: int) -> dict:
    row = copy.deepcopy(WeaponCatalog()._row("assault_rifle"))
    row.update(weapon_id=weapon_id, name=name)
    row.setdefault("wire", {})["dmg"] = dmg
    return row


def _review_cli(candidate: dict) -> tuple[int, dict]:
    """The CLI end to end: candidate file in, verdict JSON out, in a folder of this test's own."""
    with tempfile.TemporaryDirectory() as d:
        src, out = pathlib.Path(d) / "cand.json", pathlib.Path(d) / "verdict.json"
        src.write_text(json.dumps(candidate))
        with contextlib.redirect_stdout(io.StringIO()):
            code = R.main(["--candidate", str(src), "--out", str(out), "--jobs", "1",
                           "--reps-scale", str(REPS_SCALE)])
        return code, json.loads(out.read_text())


def test_the_matrix_has_todays_kits_and_columns_and_one_seed_gives_one_answer():
    """Today's matrix shape: every visible lethal primary but the DoT Toxin Rifle, the two combo kits,
    and the versioned scenario columns. Two runs with the cache cleared between give identical cells.
    Break it once (seed a cell from `random.random()`) and watch the equality fail."""
    world = R.build_worlds(R.load_candidate({"weapon_id": "sniper_rifle", "changes": {"wire.dmg": 61}}))[0]
    runs = []
    for _ in range(2):
        R.clear_cache()
        specs, _perks, skipped = R.build_kits(world, REPS_SCALE, 1)
        runs.append(R.dominance_matrix(world, specs, REPS_SCALE, 1))
    a, b = runs
    assert a["kits"] == ["Assault Rifle", "Burst Rifle", "SMG", "Shotgun", "Sniper Rifle", "AMR", "Suppressor",
                         "Energy Rifle", "Charge Rifle", "CR+Sniper+BA", "CR+Sniper+QS"], a["kits"]
    assert any(s.startswith("toxin_rifle") for s in skipped), skipped
    assert R.COLUMNS == ("1v1 close", "1v1 mid", "1v1 long", "long contact", "peek mid", "field", "ambush", "shields")
    assert set(a["columns"]["Assault Rifle"]) == set(R.COLUMNS)
    assert a["columns"] == b["columns"] and a["duels"] == b["duels"]
    assert R.SCENARIO_VERSION >= 1


def test_a_dominant_candidate_fails_no_domination():
    """An Assault Rifle copy at three times the damage is near the top everywhere. Break it once (set every
    margin to -1) and watch it pass."""
    code, v = _review_cli({"title": "dominant", "row": _ar_copy("test_ar_heavy", "Test AR heavy", 27)})
    t = v["tests"]["no_domination"]
    assert t["status"] == "fail", t
    assert "Test AR heavy" in t["numbers"]["near_top_everywhere"], t
    assert code == 1 and v["pass"] is False
    assert v["reps_scale"] == REPS_SCALE and v["scenario_version"] == R.SCENARIO_VERSION


def test_a_useless_candidate_fails_viable():
    """An Assault Rifle copy at 1 damage cannot trade in the field. Break it once (VIABLE_FIELD_FLOOR = 0)
    and watch it pass."""
    v = R.review({"title": "useless", "row": _ar_copy("test_ar_light", "Test AR light", 1)}, reps_scale=REPS_SCALE)
    t = v["tests"]["viable"]
    assert t["status"] == "fail", t
    assert t["numbers"]["field"] < R.VIABLE_FIELD_FLOOR
    assert v["tests"]["value_addition"]["status"] == "fail", v["tests"]["value_addition"]


def test_op_rule_fails_a_loadout_row_that_one_shots_a_preset_and_spares_a_pickup():
    """Rule 7: one-shot weapons are a pickup tier. A loadout row whose close pull reaches the lowest pool a
    player can field (Quick Switch on Standard: 95) fails; the same row marked pickup-only passes. Break it
    once (compare with `>` instead of `>=`) and watch the 95 case pass."""
    rows = WeaponCatalog()._rows
    base_perks = PerkCatalog()._rows
    one_shot = _ar_copy("test_ar_95", "Test AR 95", 95)
    under = _ar_copy("test_ar_94", "Test AR 94", 94)
    pickup = dict(_ar_copy("test_ar_pickup", "Test AR pickup", 150), pickup_only=True)
    world = R.World(WeaponCatalog(rows + [one_shot, under, pickup]), PerkCatalog(base_perks))
    op = R.op_check(world, ["test_ar_95", "test_ar_94", "test_ar_pickup", "sniper_rifle", "shotgun"])
    assert op["test_ar_95"]["lowest_pool"]["standard"] == 95
    assert not op["test_ar_95"]["pass"] and op["test_ar_95"]["one_shots"]["standard"]
    assert op["test_ar_94"]["pass"]
    assert op["test_ar_pickup"]["pass"]
    assert op["sniper_rifle"]["pass"] and op["shotgun"]["pass"]
    # Hardcore (45) is reported, never gated: the Sniper one-shots it today and still passes.
    assert op["sniper_rifle"]["one_shots"]["hardcore"]


def test_the_pool_arithmetic_matches_compile_for_every_shipped_perk():
    """`pool_parts` reads a perk's own `max_armor_add` so a perk candidate can move it; it must agree with
    compile.armed_armor/armed_shield for every shipped perk on both gated presets."""
    perks = PerkCatalog()
    for pid in [None] + perks.visible_ids():
        for preset, (hp, arm, sh) in (("standard", (45, 70, 0)), ("shields", (45, 0, 105))):
            shields = arm == 0
            want = (hp, armed_armor(arm, pid, shields), armed_shield(sh, pid, shields))
            assert R.pool_parts(preset, perks.effects(pid)) == want, (pid, preset)


def test_candidate_files_round_trip_in_row_diff_and_perk_forms():
    """Each candidate form loads from a file and lands in the candidate world only; `with` context lands in
    both; a diff that moves nothing the catalogue reads is refused."""
    with tempfile.TemporaryDirectory() as d:
        def write(obj):
            p = pathlib.Path(d) / f"c{len(list(pathlib.Path(d).iterdir()))}.json"
            p.write_text(json.dumps(obj))
            return str(p)

        diff = R.load_candidate(write({"weapon_id": "sniper_rifle", "changes": {"mag": 1, "wire.dmg": 57},
                                       "sim": {"perk_exempt": True},
                                       "with": [{"weapon_id": "charge_rifle", "changes": {"wire.tap_dmg": 14}}]}))
        base, cand = R.build_worlds(diff)
        assert base.cat.damage("sniper_rifle") == 60 and cand.cat.damage("sniper_rifle") == 57
        assert cand.cat._ammo("sniper_rifle", None)[0] == 1
        assert base.cat.tap_damage("charge_rifle") == cand.cat.tap_damage("charge_rifle") == 14
        assert cand.perk_exempt == {"sniper_rifle"} and not base.perk_exempt
        # the exemption keeps Quick Hands off the bolt
        qh = cand.fx("quick_hands")
        assert R.make_kit(cand, "x", "sniper_rifle", perk="quick_hands").guns[0].reload_ms == 1700
        assert R.make_kit(base, "x", "sniper_rifle", perk="quick_hands").guns[0].reload_ms == 1700 * qh["reload_mult"]

        row = R.load_candidate(write(_ar_copy("test_ar_new", "Test AR new", 10)))
        assert row["entry"]["kind"] == "row"
        base, cand = R.build_worlds(row)
        assert "test_ar_new" in cand.cat._by_id and "test_ar_new" not in base.cat._by_id

        perk = R.load_candidate(write({"perk_id": "quick_hands", "changes": {"reload_mult": 0.4}}))
        base, cand = R.build_worlds(perk)
        assert base.fx("quick_hands")["reload_mult"] == 0.5 and cand.fx("quick_hands")["reload_mult"] == 0.4

        bad = R.load_candidate(write({"weapon_id": "sniper_rifle", "changes": {"tap_dmg": 14}}))
        try:
            R.build_worlds(bad)
        except ValueError as e:
            assert "move nothing" in str(e)
        else:
            raise AssertionError("a diff with no effect was accepted")


def test_a_bolt_is_a_trigger_mechanic_the_arsenal_lacks():
    """value_addition's second door: a 1-round single-shot magazine is a new trigger mechanic; a damage
    change is not."""
    shipped = R.World(WeaponCatalog(), PerkCatalog())
    have = set().union(*[R.trigger_mechanics(shipped.cat, w) for w in R.loadout_ids(shipped.cat)])
    assert {"overheat", "charge plus tap", "3-round burst", "shell-by-shell reload"} <= have
    assert "bolt action (1-round magazine)" not in have
    cand = R.build_worlds(R.load_candidate({"weapon_id": "sniper_rifle", "changes": {"mag": 1}}))[1]
    assert "bolt action (1-round magazine)" in R.trigger_mechanics(cand.cat, "sniper_rifle")


def test_record_appends_a_section_and_refuses_a_scaled_verdict():
    v = {"date": "2026-10-18", "title": "t", "pass": True, "scenario_version": R.SCENARIO_VERSION, "seed": R.SEED,
         "git_sha": "abc", "reps_scale": 1.0, "candidate": {"weapon_id": "x"},
         "tests": {"op_rule": {"status": "pass", "numbers": {"failing": []}}}}
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "log.md"
        p.write_text("# log\n\n")
        R.record(v, "pending", p)
        R.record(dict(v, title="t2"), "Tony: ship it", p)
        text = p.read_text()
        assert text.index("## 2026-10-18: t\n") < text.index("## 2026-10-18: t2\n")
        assert "Tony's call: pending" in text and "Tony's call: Tony: ship it" in text
        try:
            R.record(dict(v, reps_scale=0.01), "pending", p)
        except ValueError:
            pass
        else:
            raise AssertionError("a scaled verdict was recorded")
