"""A17 hit audio — the material layer, the class layer, and the guard that keeps re-keying survivable."""
import random

from brx_mcp import hitaudio as H
from brx_mcp import sounds as S
from brx_mcp.gameconfig import GameConfig, pset_foot, _PSET_FOOT_INHERITED
from brx_mcp.mc import compile as C


def test_every_id_this_module_can_emit_is_really_on_the_gun():
    """The whole point of picking from `sound_catalog.json` is that the ids are real. An id that is
    only in the APK's 2166-id list plays a FALLBACK clip on the gun, which is the silent-wrong-sound
    failure this test exists to stop."""
    on_gun = S.on_gun_ids()
    missing = sorted(i for i in H.pool_ids() if i not in on_gun)
    assert not missing, f"not on the gun: {missing}"


def test_material_pools_stay_short_enough_to_survive_a_burst():
    """A material clip that outlasts the fire interval stutters over the next hit, and the firmware
    gives us no mixing control. The AR at 100-140 ms is unwinnable -- no `fx:hit` clip is that short --
    but we can refuse to make it worse: nothing past 0.8 s, and the ids WE chose stay at or under
    0.66 s. The only two above that are H13 and H21, Callsign's own inherited armour and shield ids,
    kept in pool precisely so the shipped sound is still one of the draws."""
    inherited = {"H13", "H21"}
    for role, pool in H.MATERIAL_POOLS.items():
        for sid in pool:
            cap = 0.8 if sid in inherited else 0.66
            assert H.duration(sid) <= cap, f"{role} take {sid} is {H.duration(sid):.2f}s (cap {cap})"


def test_the_three_pools_are_acoustically_distinct_families():
    """Armour reads METAL (tonal: low spectral flatness = a ringing partial, not noise), health reads
    BODY (noisier and duller), shield reads ENERGY (brightest). If a future edit blurs those, the
    layer stops carrying information and this test is the thing that says so."""
    cat = S._catalog()
    def mean(pool, key):
        return sum((cat[i].get("shape") or {}).get(key, 0) for i in pool) / len(pool)
    armor, hp, shield = (H.MATERIAL_POOLS[r] for r in ("hit_armor", "hit_hp", "hit_shield"))
    assert mean(armor, "flatness") < mean(hp, "flatness"), "armour must be more tonal than health"
    assert mean(shield, "centroid_hz") > mean(hp, "centroid_hz"), "shield must be brighter than health"


def test_pset_is_byte_identical_to_the_inherited_frame_when_nothing_is_picked_or_rolled():
    """The inherited Callsign foot is the control. A caller that asks for nothing must get exactly the
    frame we have always sent -- A17 may not change the shipped bytes by accident."""
    assert pset_foot() == _PSET_FOOT_INHERITED
    assert GameConfig()._pset(3).split(",")[-9:-1] == _PSET_FOOT_INHERITED


def test_a_pinned_hit_sound_wins_over_the_roll_and_lands_in_the_right_slot():
    g = GameConfig(hit_sounds={"hit_armor": "H14", "hit_shield": "H21"})
    for frame in g.pset_frames(3, "male", rng=random.Random(5)):
        foot = frame.split(",")[-9:-1]
        assert foot[2] == "H14" and foot[3] == "H21"        # hitArrmor, hitShield
        assert foot[1] in H.MATERIAL_POOLS["hit_hp"]        # hitHp still rolled
        assert foot[0] == "H06" and foot[-1] == "A10"       # the non-hit tokens never move


def test_pset_pool_rolls_a_fresh_material_set_per_take():
    """The anti-repetition mechanism: the SAME write that re-rolls the death scream re-rolls what a
    hit sounds like, so variety costs no extra BLE traffic and no in-hit latency."""
    frames = GameConfig().pset_frames(7, "male", rng=random.Random(1))
    assert len(frames) > 1
    assert len({f.split(",")[-8] for f in frames}) > 1, "hitHp never varied across the pool"


def test_deterministic_for_a_seeded_rng():
    a = GameConfig().pset_frames(7, "male", rng=random.Random(4))
    b = GameConfig().pset_frames(7, "male", rng=random.Random(4))
    assert a == b


# ---- the class layer ------------------------------------------------------- #
def _entries(compiler, ids):
    sir = C._sir_index(C._SIR_TABLE)
    return [e for e in (compiler._hit_entry(w, sir) for w in ids) if e is not None]


def test_the_shipped_table_is_silent_on_the_three_commonest_rows():
    """The premise of the class layer, asserted so it cannot rot: <0,0>, <0,1> and <0,3> -- which
    between them carry 17 of the 22 catalogued weapons -- ship an EMPTY sound token."""
    empties = {c for row, c in zip(C._SIR_TABLE, C._sir_cells(C._SIR_TABLE))
               if row.split(",")[C._SIR_SOUND_TOK] == ""}
    assert {("0", "0"), ("0", "1"), ("0", "3")} <= empties


def test_in_place_plan_moves_nobody_and_still_gives_every_used_row_a_sound():
    c = C.default_compiler()
    ids = ["assault_rifle", "shotgun", "sniper_rifle", "rocket_launcher", "melee"]
    entries = _entries(c, ids)
    plan = H.plan_in_place(entries)
    assert all(plan.cells[e.weapon_id] == e.cell for e in entries), "in-place plan must not re-key"
    rows = c.sir_table(plan, random.Random(2))
    cells = C._sir_cells(rows)
    assert len(rows) == len(C._SIR_TABLE), "in-place plan must not add rows"
    for cell in plan.groups:
        assert rows[cells.index(cell)].split(",")[C._SIR_SOUND_TOK], f"{cell} still silent"


def test_a_pinned_weapon_keeps_its_own_sound_and_its_own_cell():
    """The rocket's X13 and the rail gun's H02 are chosen, weapon-specific ids in the stock table. A
    family pool must never overwrite them, even when another power weapon shares the family."""
    c = C.default_compiler()
    plan = H.plan(_entries(c, ["rocket_launcher", "rail_gun", "laser_cannon", "melee"]))
    rows = c.sir_table(plan, random.Random(9))
    by_cell = dict(zip(C._sir_cells(rows), rows))
    assert by_cell[plan.cells["rocket_launcher"]].split(",")[C._SIR_SOUND_TOK] == "X13"
    assert by_cell[plan.cells["rail_gun"]].split(",")[C._SIR_SOUND_TOK] == "H02"


def test_rekeying_gives_each_family_its_own_cell_without_moving_damage():
    """The whole point: an AR, a shotgun and a suppressor must stop sounding identical. The function
    each weapon lands MUST travel with it -- damage is a property of the (weapon, table) pair."""
    c = C.default_compiler()
    ids = ["assault_rifle", "shotgun", "suppressor", "sniper_rifle", "deagle", "melee"]
    entries = _entries(c, ids)
    plan = H.plan(entries, base_cells=C._sir_cells(C._SIR_TABLE))
    rows = c.sir_table(plan, random.Random(3))
    fns = C._sir_index(rows)
    for e in entries:
        assert fns[plan.cells[e.weapon_id]] == e.fn, f"{e.weapon_id} changed $SIR function"
    sounds = {plan.cells[w]: dict(zip(C._sir_cells(rows), rows))[plan.cells[w]].split(",")[C._SIR_SOUND_TOK]
              for w in ("assault_rifle", "shotgun", "sniper_rifle")}
    assert len(set(sounds.values())) == 3, f"families still share a clip: {sounds}"


def test_rekeying_never_removes_a_stock_row():
    """A vacated cell keeps its row, so a stock BRX gun or a grenade station still registers. Removing
    it would make those hits vanish in silence -- the F11 shape."""
    c = C.default_compiler()
    plan = H.plan(_entries(c, ["assault_rifle", "shotgun", "melee"]), base_cells=C._sir_cells(C._SIR_TABLE))
    cells = set(C._sir_cells(c.sir_table(plan, random.Random(3))))
    assert set(C._sir_cells(C._SIR_TABLE)) <= cells


def test_the_guard_catches_a_weapon_keyed_to_a_row_that_does_not_exist():
    # No pytest: CLAUDE.md requires `python3 run_tests.py` to stay green under SYSTEM python, which has
    # no pytest, and a bare `import pytest` aborts the whole run at this file.
    head = ["$SIR,0,0,,1,0,0,1,,*", "$WEAP,0,,100,4,0,9,0,*", "$TID,1,*"]
    try:
        C.assert_sir_covers_weapons(head)
    except ValueError as e:
        assert "A17 GUARD" in str(e)
    else:
        raise AssertionError("the guard passed a weapon keyed to <4,0> with no such row")
    C.assert_sir_covers_weapons(["$SIR,4,0,H09,1,0,0,1,,*", "$WEAP,0,,100,4,0,9,0,*"])


def test_a_rekeyed_head_arms_weapons_the_table_actually_covers():
    """End to end: re-key a real roster, compile the head, and let the guard judge it. This is the
    test that would have caught a re-key that silently stopped a weapon registering."""
    c = C.default_compiler()
    roster = [{"loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}},
              {"loadout": {"weapons": [{"weapon_id": "sniper_rifle"}, {"weapon_id": "deagle"}]}}]
    plan = c.hit_plan(roster, rekey=True)
    assert plan.cells["assault_rifle"] != plan.cells["shotgun"], "re-key did not separate the families"
    rows = c.sir_table(plan, random.Random(3))
    for wid in ("assault_rifle", "shotgun", "sniper_rifle", "deagle", "melee"):
        head = rows + [C.Compiler._rekey(c.catalog.resolve(wid, 0), plan.cell_for(wid))]
        C.assert_sir_covers_weapons(head)


def test_the_bundle_publishes_what_a_hit_will_sound_like():
    b = C.golden_bundle()
    ha = b["hit_audio"]
    assert ha["rekey"] is False and ha["material"] == list(H.MATERIAL_ROLES)
    assert ha["cells"] and ha["classes"]
    assert len(b["sir_pool"]) == C._SIR_TAKES
    assert all(len(t) == len(C._SIR_TABLE) for t in b["sir_pool"])


def test_rekeying_is_off_unless_the_config_explicitly_asks_for_it():
    """The one A17 decision that is a SAFETY property rather than a taste one, pinned so a refactor
    cannot quietly flip it.

    `plan()` and `plan_in_place()` are not one function with a flag -- they are the risky path and the
    safe path, and they run different algorithms (the safe one never allocates a cell at all; it picks
    a winner per SHARED cell by weapon count, which the risky one has no notion of). What makes the
    risky path risky is that its failure is SILENT: a weapon keyed to a cell the victim's table lacks
    registers nothing, reports healthy at both ends, and looks exactly like a dead sensor. So the
    default must be provably the safe one -- from an absent config key, not merely from a default
    argument someone can drop."""
    c = C.default_compiler()
    roster = [{"loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}}]
    sir = C._sir_index(C._SIR_TABLE)
    stock = {e.weapon_id: e.cell for e in _entries(c, ["assault_rifle", "shotgun", "melee"])}

    # 1. the config key ABSENT (not False -- absent) must resolve to the safe path
    for cfg in ({}, {"hit_audio_rekey": False}):
        plan = c.hit_plan(roster, rekey=bool(cfg.get("hit_audio_rekey", False)))
        assert all(plan.cells[w] == stock[w] for w in stock), f"{cfg} re-keyed a weapon"

    # 2. and a head compiled with no plan at all must arm the stock cells, whatever else changes
    b = C.golden_bundle()
    assert b["hit_audio"]["rekey"] is False
    for f in b["head"]:
        if f.startswith("$WEAP"):
            t = f.split(",")
            assert (t[4] or "0", t[5] or "0") in sir, "a no-plan head armed a cell the stock table lacks"
