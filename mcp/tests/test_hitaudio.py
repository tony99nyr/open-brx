"""A17 hit audio — the material layer, the class layer, and the guard that keeps re-keying survivable."""
import random

from brx_mcp import hitaudio as H
from brx_mcp import sounds as S
from brx_mcp.gameconfig import GameConfig, pset_foot, _PSET_FOOT_INHERITED
from brx_mcp.mc import compile as C


def test_every_id_this_module_can_emit_is_really_on_the_gun():
    """An id that is only in the APK's 2166-id list plays a FALLBACK clip on the gun -- the
    silent-wrong-sound failure this test exists to stop. "" is not an id: it is the deliberate EMPTY
    health field (A17), and empty means the firmware falls through, not that it plays a bad clip."""
    on_gun = S.on_gun_ids()
    missing = sorted(i for i in H.pool_ids() if i and i not in on_gun)
    assert not missing, f"not on the gun: {missing}"


def test_material_pools_stay_short_enough_to_survive_a_burst():
    """A material clip that outlasts the fire interval stutters over the next hit, and the firmware
    gives us no mixing control. Nothing past 0.8 s."""
    for role, pool in H.MATERIAL_POOLS.items():
        for sid in pool:
            if not sid:
                continue                    # health ships EMPTY on purpose (A17, bench 2026-09-07)
            assert H.duration(sid) <= 0.8, f"{role} take {sid} is {H.duration(sid):.2f}s"


def test_health_ships_silent_so_the_pain_grunt_is_the_only_thing_the_player_hears():
    """A17, bench-decided 2026-09-07. The gun has NO clean body-impact sound (the whole `fx:hit` family
    was auditioned; the near-misses, creature audio and melee attack sounds were all rejected by ear), and
    the best candidate still read as "all metal/armor hits" when heard after a run of armour clanks. So
    health ships EMPTY and the ABSENCE carries it: armour rings, and real damage is where the metal stops
    and the character cries out. Silence tested BETTER than the best clip, not merely equal to it.

    Pinned because it looks like a bug. An empty sound field reads as an omission to anyone skimming, and
    the obvious "fix" is to put a hit sound back -- which is the thing we measured as worse."""
    assert H.MATERIAL_POOLS["hit_hp"] == ("",), "health must ship silent"
    assert H.MATERIAL_DEFAULT["hit_hp"] == ""
    foot = pset_foot(H.roll_material(random.Random(0)))
    assert foot[1] == "", "the $PSET hitHp token must be EMPTY, not an inherited id"
    assert foot[0] == "H06" and foot[5:7] == _PSET_FOOT_INHERITED[5:7], "only A17's slots may move"
    assert foot[7] == "A10", "energyShieldLoop = A10, ear-confirmed as a real shield hum (F44, 2026-09-11)"


def test_an_explicit_empty_pick_is_not_rolled_over():
    """"" is a real pick meaning SILENCE, and a truthiness test would quietly roll a sound back into the
    slot we deliberately emptied. The bug this guards against is invisible: the frame stays valid and the
    gun plays a real, correct-sounding clip -- just not the nothing we chose."""
    for seed in range(8):
        assert H.roll_material(random.Random(seed), {"hit_armor": ""})["hit_armor"] == ""
    assert H.roll_material(random.Random(0))["hit_armor"] in H.MATERIAL_POOLS["hit_armor"]


def test_every_material_id_was_confirmed_by_ear_not_by_shape():
    """The ids rejected on hardware 2026-09-07 must not creep back into ANY pool. Each was a shape pick
    that plays a real, valid, correct clip -- so no test can catch them by inspecting output, only by
    remembering what a person heard. Shape separates tonal from noisy; it cannot separate metal from
    electronic, an impact from a near-miss, or a player from a creature."""
    rejected = {
        "H14": "synth tone, not metal",        "H03": "a hit with a smoke/gas cough tail",
        "H07": "bullet whizz-by, a near-miss", "H09": "bullet whizz-by, a near-miss",
        "H33": "creature audio",               "Z06": "creature audio",
        "Z07": "creature audio",               "H140": "reads as a 'disabled' sound",
        "H43": "dropped a gun on the ground, not an impact (2026-09-11)",
    }
    for sid, why in rejected.items():
        assert sid not in H.pool_ids(), f"{sid} is back in a pool; rejected by ear: {why}"
    # H22 is CONFIRMED, but as SHIELD -- it must never sit in the armour pool again (it did, by shape).
    assert "H22" not in H.MATERIAL_POOLS["hit_armor"] and H.MATERIAL_POOLS["hit_shield"] == ("H22",)


def test_the_default_foot_is_the_confirmed_set_and_nothing_else_moved():
    """A17 deliberately changes the shipped bytes -- the inherited Callsign ids were never chosen by
    anyone, and three of the four were wrong on the bench. What must NOT move is everything outside the
    hit slots, so this pins the change to exactly the tokens A17 owns."""
    foot = pset_foot()
    assert foot[1:5] == [H.MATERIAL_DEFAULT[r] for r in H.MATERIAL_ROLES], "hit slots = confirmed heads"
    assert foot[7] == "A10", "energyShieldLoop = A10, a real shield hum ear-confirmed alone (F44, 2026-09-11)"
    # untouched: missShotHit, emptyUnboundButtonSound, ammoOrGearPickUp -- inherited, never auditioned.
    assert [foot[0], foot[5], foot[6]] == [_PSET_FOOT_INHERITED[i] for i in (0, 5, 6)]
    assert GameConfig()._pset(3).split(",")[-9:-1] == foot


def test_a_pinned_hit_sound_wins_over_the_roll_and_lands_in_the_right_slot():
    g = GameConfig(hit_sounds={"hit_armor": "H14", "hit_shield": "H21"})
    for frame in g.pset_frames(3, "male", rng=random.Random(5)):
        foot = frame.split(",")[-9:-1]
        assert foot[2] == "H14" and foot[3] == "H21"        # hitArrmor, hitShield
        assert foot[1] == ""                                # hitHp ships EMPTY (A17): the grunt carries health
        assert foot[0] == "H06"                             # missShotHit: inherited, A17 does not touch it
        assert foot[-1] == "A10"                            # energyShieldLoop: the shield hum, not pinnable here


def test_pset_pool_rolls_a_fresh_material_set_per_take():
    """The anti-repetition mechanism: the SAME write that re-rolls the death scream re-rolls what a
    hit sounds like, so variety costs no extra BLE traffic and no in-hit latency. Asserted on ARMOUR,
    which is the pool that has takes to vary (three, ear-confirmed as complementary variants) -- health
    ships empty and shield has one confirmed id, so neither can vary by construction."""
    frames = GameConfig().pset_frames(7, "male", rng=random.Random(1))
    assert len(frames) > 1
    armour = {f.split(",")[-7] for f in frames}                   # foot[2] = hitArrmor
    assert armour <= set(H.MATERIAL_POOLS["hit_armor"]), f"armour drew outside its pool: {armour}"
    assert len(armour) > 1, "hitArrmor never varied across the pool"
    assert {f.split(",")[-8] for f in frames} == {""}, "hitHp must stay empty in every take"


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
    assert len(entries) >= 4, "fixture lost its weapons; the all() below would pass on an empty list"
    assert all(plan.cells[e.weapon_id] == e.cell for e in entries), "in-place plan must not re-key"
    rows = c.sir_table(plan, random.Random(2), class_sounds=True)
    cells = C._sir_cells(rows)
    assert len(rows) == len(C._SIR_TABLE), "in-place plan must not add rows"
    for cell in plan.groups:
        assert rows[cells.index(cell)].split(",")[C._SIR_SOUND_TOK], f"{cell} still silent"


def test_a_pinned_weapon_keeps_its_own_sound_and_its_own_cell():
    """The rocket's X13 and the rail gun's H02 are chosen, weapon-specific ids in the stock table. A
    family pool must never overwrite them, even when another power weapon shares the family."""
    c = C.default_compiler()
    plan = H.plan(_entries(c, ["rocket_launcher", "rail_gun", "laser_cannon", "melee"]))
    rows = c.sir_table(plan, random.Random(9), class_sounds=True)
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
    rows = c.sir_table(plan, random.Random(3), class_sounds=True)
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
    cells = set(C._sir_cells(c.sir_table(plan, random.Random(3), class_sounds=True)))
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
    rows = c.sir_table(plan, random.Random(3), class_sounds=True)
    for wid in ("assault_rifle", "shotgun", "sniper_rifle", "deagle", "melee"):
        head = rows + [C.Compiler._rekey(c.catalog.resolve(wid, 0), plan.cell_for(wid))]
        C.assert_sir_covers_weapons(head)


def test_the_bundle_publishes_what_a_hit_will_sound_like():
    b = C.golden_bundle()
    ha = b["hit_audio"]
    assert ha["rekey"] is False and ha["material"] == list(H.MATERIAL_ROLES)
    assert ha["cells"] and ha["classes"]
    # F38 (bench 2026-09-07): `$SIR` REPLACES the `$PSET` pool sound, so the class layer is OFF by
    # default and ships no rolled tables at all -- turning it on would silence the ear-confirmed
    # material layer on every standard hit.
    assert b["sir_pool"] == [], "the class layer ships off; sir_pool is empty"
    # F121/A23: the live table now rides the spawn burst, not the head. Stock rows, verbatim, is still
    # the property under test -- it just has a new address. The head carries the same cells DISARMED.
    assert [f for f in b["spawn"] if f.startswith("$SIR")] == list(C._SIR_TABLE), "stock rows, verbatim"
    assert [f for f in b["revive"] if f.startswith("$SIR")] == list(C._SIR_TABLE), "and again every life"
    assert all(f.split(",")[4] == "28" for f in b["head"] if f.startswith("$SIR")), "the head arms nothing"


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
    assert len(stock) == 3, "fixture lost its weapons; the all() below would pass on an empty dict"

    # 1. the config key ABSENT (not False -- absent) must resolve to the safe path
    for cfg in ({}, {"hit_audio_rekey": False}):
        plan = c.hit_plan(roster, rekey=bool(cfg.get("hit_audio_rekey", False)))
        assert all(plan.cells[w] == stock[w] for w in stock), f"{cfg} re-keyed a weapon"

    # 2. and a head compiled with no plan at all must arm the stock cells, whatever else changes
    b = C.golden_bundle()
    assert b["hit_audio"]["rekey"] is False
    weap = [f for f in b["head"] if f.startswith("$WEAP")]
    assert len(weap) >= 2, "no $WEAP frames: the loop below would check nothing"
    for f in weap:
        t = f.split(",")
        assert (t[4] or "0", t[5] or "0") in sir, "a no-plan head armed a cell the stock table lacks"


def test_health_is_silent_only_because_nothing_lies_further_inward():
    """BENCH 2026-09-07, and the reason the silent-health design is safe.

    An empty `$PSET` EFFECT field is NOT silence: it FALLS THROUGH OUTWARD to the neighbouring pool's
    clip. An empty `hitShield` plays the ARMOUR clip -- measured, twice. `hitHp` is silent only because
    it is the innermost pool and has nothing further in to fall to. This is NOT the A15.2/A15.3 rule
    ("an empty field makes the firmware play nothing"), which was established on the VOICE fields and
    does not generalise to the effect slots.

    Pinned because the consequence is counter-intuitive and load-bearing: emptying `hit_armor` or
    `hit_shield` to "mute" them would make them play a NEIGHBOUR, not go quiet. Only `hit_hp` may be
    empty. Anyone muting a pool must write an explicit quiet clip instead."""
    assert H.MATERIAL_POOLS["hit_hp"] == ("",), "health is the one pool that may ship empty"
    for role in ("hit_armor", "hit_shield", "hit_crit"):
        pool = H.MATERIAL_POOLS[role]
        assert pool and all(pool), (
            f"{role} must carry a real id: an empty effect field falls through to a neighbouring "
            f"pool's clip on hardware, it does not go silent")


def test_the_shipped_frame_matches_what_was_confirmed_on_hardware():
    """The exact foot the bench approved, so a refactor cannot drift it silently. Armour varies (three
    ear-confirmed complementary metal takes); health is empty; shield is the one confirmed fizz; the
    energyShieldLoop slot ships A10 -- Callsign's own inherited id, ear-confirmed 2026-09-11 as a real
    shield hum heard alone (F44 closed; the 2026-09-07 "geiger-ish tick" read was a barrage of shield-
    band hits landing on top of the loop, not the clip itself)."""
    foot = pset_foot(H.roll_material(random.Random(0)))
    assert foot[1] == ""                                   # hitHp   -- silent, the grunt carries health
    assert foot[2] in ("H02", "H36", "H37")                # hitArrmor -- "blacksmith hammer on steel"
    assert foot[3] == "H22"                                # hitShield -- "the proper shield hit sound"
    assert foot[0] == "H06"                                # missShotHit -- inherited, never auditioned
    assert foot[7] == "A10"                                # energyShieldLoop -- the shield hum (F44)


def test_rekey_end_to_end_through_the_real_compiler_and_every_gun_agrees():
    """The guard and the plan-forwarding must be exercised through `Compiler.compile()`, not around it.

    Every other test here calls `plan()` / `sir_table()` / `assert_sir_covers_weapons` DIRECTLY or hand-
    builds a head, so deleting the `plan=plan` forwarding in `state._compile_rolled` or the guard call in
    `compile()` would leave the whole suite green -- a guard that cannot be shown to fail is the shape
    this project keeps rediscovering. This drives the real path with re-keying ON.

    The assertion that matters is CROSS-PLAYER: every compiled head must carry a row for every cell ANY
    weapon in the match keys. A per-player plan would pass `assert_sir_covers_weapons` (which only checks
    one head against itself) and still drop every hit between two guns that disagree."""
    c = C.default_compiler()
    teams = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
             {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]
    config = {"config_id": "a17-rekey", "mode": "tdm", "environment": "indoor", "night": False,
              "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
              "scoring": {"frag_limit": 0, "win_by": "kills"},
              "health": {"max_hp": 45, "max_armor": 70}, "teams": teams,
              "hit_audio_rekey": True}
    roster = [
        {"player_id": "p1", "player_num": 1, "display": "ONE", "team_id": "blue", "node_id": None,
         "gun_id": None, "voice": "male", "ready": True,
         "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}},
        {"player_id": "p2", "player_num": 2, "display": "TWO", "team_id": "yellow", "node_id": None,
         "gun_id": None, "voice": "male", "ready": True,
         "loadout": {"weapons": [{"weapon_id": "sniper_rifle"}, {"weapon_id": "deagle"}]}},
    ]
    plan = c.hit_plan(roster, rekey=True)
    assert plan.cells["assault_rifle"] != plan.cells["shotgun"], "rekey did not separate the families"

    heads = []
    for p in roster:
        b = c.compile(config, p, teams, plan=plan)
        heads.append(b["head"])
        C.assert_sir_covers_weapons(b["head"])            # each head is self-consistent

    # ...and the heads AGREE. Every cell any head's $WEAP keys must have a row in EVERY head.
    def weap_cells(head):
        return {((f.split(",")[4] or "0"), (f.split(",")[5] or "0")) for f in head if f.startswith("$WEAP")}
    def sir_cells(head):
        return set(C._sir_cells([f for f in head if f.startswith("$SIR")]))
    all_weapon_cells = set().union(*(weap_cells(h) for h in heads))
    for h in heads:
        missing = all_weapon_cells - sir_cells(h)
        assert not missing, f"a gun has no row for cells another gun's weapons key: {sorted(missing)}"


def test_the_guard_is_actually_WIRED_INTO_compile_not_merely_correct():
    """`test_the_guard_catches_...` proves the guard WORKS. It does not prove `compile()` CALLS it --
    delete the call and that test still passes. So this hands `compile()` a plan that keys a weapon to a
    cell with no row and asserts the compile REFUSES. Verified by sabotage: commenting out the
    `assert_sir_covers_weapons(head)` call makes this test, and only this test, fail."""
    c = C.default_compiler()
    teams = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1}]
    config = {"config_id": "a17-guard", "mode": "ffa", "environment": "indoor", "night": False,
              "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
              "scoring": {"frag_limit": 0, "win_by": "kills"},
              "health": {"max_hp": 45, "max_armor": 70}, "teams": teams}
    player = {"player_id": "p1", "player_num": 1, "display": "ONE", "team_id": "blue", "node_id": None,
              "gun_id": None, "voice": "male", "ready": True,
              "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
    plan = c.hit_plan([player], rekey=False)
    plan.cells["assault_rifle"] = ("12", "3")      # a free cell no row covers; groups deliberately NOT updated
    try:
        c.compile(config, player, teams, plan=plan)
    except ValueError as e:
        assert "A17 GUARD" in str(e), f"refused, but not by the A17 guard: {e}"
    else:
        raise AssertionError("compile() armed a weapon keyed to a cell with no $SIR row -- guard not wired in")


def test_a_PER_PLAYER_plan_would_break_cross_gun_coverage():
    """Why `state._hit_plan` pins ONE plan per match instead of deriving it per compile.

    Derive a plan from each player's OWN weapons and the two guns disagree about which cell a family
    owns. Each head still passes `assert_sir_covers_weapons` -- it only checks a head against ITSELF --
    so nothing raises, and every hit between those two guns is dropped in silence with both ends
    reporting healthy. That is the F11 shape, and this test is the record of why the pin exists."""
    c = C.default_compiler()
    teams = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
             {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]
    base = {"config_id": "a17-split", "mode": "tdm", "environment": "indoor", "night": False,
            "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
            "scoring": {"frag_limit": 0, "win_by": "kills"},
            "health": {"max_hp": 45, "max_armor": 70}, "teams": teams, "hit_audio_rekey": True}
    roster = [
        {"player_id": "p1", "player_num": 1, "display": "ONE", "team_id": "blue", "node_id": None,
         "gun_id": None, "voice": "male", "ready": True,
         "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}},
        {"player_id": "p2", "player_num": 2, "display": "TWO", "team_id": "yellow", "node_id": None,
         "gun_id": None, "voice": "male", "ready": True,
         "loadout": {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "sniper_rifle"}]}},
    ]
    per_player = [c.compile(base, p, teams, plan=c.hit_plan([p], rekey=True))["head"] for p in roster]
    for h in per_player:
        C.assert_sir_covers_weapons(h)          # each head is individually fine -- that is the whole point

    def weap_cells(head):
        return {((f.split(",")[4] or "0"), (f.split(",")[5] or "0")) for f in head if f.startswith("$WEAP")}
    def sir_cells(head):
        return set(C._sir_cells([f for f in head if f.startswith("$SIR")]))
    uncovered = set()
    for shooter in per_player:
        for victim in per_player:
            uncovered |= (weap_cells(shooter) - sir_cells(victim))
    assert uncovered, "per-player plans happened to agree; this test can no longer show why the pin matters"

    shared = c.hit_plan(roster, rekey=True)     # ...and the pinned plan fixes exactly that
    heads = [c.compile(base, p, teams, plan=shared)["head"] for p in roster]
    for shooter in heads:
        for victim in heads:
            assert not (weap_cells(shooter) - sir_cells(victim)), "one shared plan must cover every gun"


def test_a_player_whose_weapons_the_pinned_plan_never_saw_falls_back_to_STOCK_cells():
    """Why pinning the plan (state._hit_plan) is safe for a LATE JOINER, and not merely a smaller window.

    The pin is taken at `push_config()`. A player who joins after it -- hydrated on their first hello, or
    resent after a loadout change -- may carry a weapon family the pinned plan never allocated a cell for.
    `Plan.cell_for()` then returns None, `Compiler._rekey` returns the frame UNCHANGED, and that weapon
    stays on its STOCK cell. Every gun's table always keeps the stock rows (`sir_table` never removes
    one), so the late joiner's hits still register on everyone and everyone's still register on them.

    That is the whole safety argument for the pin, and it rests on two behaviours that look incidental --
    a None cell being a no-op, and stock rows never being dropped. Pinned here so neither can be
    'simplified' into a silent hit-dropping bug."""
    c = C.default_compiler()
    teams = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1}]
    cfg = {"config_id": "a17-late", "mode": "tdm", "environment": "indoor", "night": False,
           "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
           "scoring": {"frag_limit": 0, "win_by": "kills"},
           "health": {"max_hp": 45, "max_armor": 70}, "teams": teams, "hit_audio_rekey": True}
    early = {"player_id": "p1", "player_num": 1, "display": "A", "team_id": "blue", "node_id": None,
             "gun_id": None, "voice": "male", "ready": True,
             "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}}
    late = {**early, "player_id": "p2", "player_num": 2,
            "loadout": {"weapons": [{"weapon_id": "rocket_launcher"}, {"weapon_id": "plasma_sniper"}]}}

    plan = c.hit_plan([early], rekey=True)                 # pinned BEFORE the late joiner exists
    assert plan.cell_for("rocket_launcher") is None, "fixture no longer exercises an unknown weapon"

    def cells(head, pfx):
        return {((f.split(",")[4] or "0"), (f.split(",")[5] or "0")) for f in head if f.startswith(pfx)}
    heads = {k: c.compile(cfg, p, teams, plan=plan)["head"] for k, p in (("early", early), ("late", late))}
    for h in heads.values():
        C.assert_sir_covers_weapons(h)

    late_weap = cells(heads["late"], "$WEAP")
    assert late_weap, "no $WEAP frames: the checks below would pass on an empty set"
    for name, h in heads.items():
        sir = set(C._sir_cells([f for f in h if f.startswith("$SIR")]))
        assert not (late_weap - sir), f"{name}'s table misses a late joiner's cell: {sorted(late_weap - sir)}"


def test_an_uncovered_ir_cell_is_an_error_not_a_fn_zero_row():
    """F53: `_hit_entry` used to default an uncovered cell's `$SIR` function to 0, so a future weapon on
    a cell the table lacks would (with `hit_audio_rekey` on) get its new row written with fn 0 -- a
    silently changed damage class that `assert_sir_covers_weapons` (row EXISTS, never function RIGHT)
    could not see. It raises now, naming the weapon and the cell."""
    c = C.Compiler()
    sir = C._sir_index(C._SIR_TABLE)
    # every catalogued weapon's stock cell is covered, so the shipped catalog compiles unchanged
    assert _entries(c, [w for w in c.catalog._by_id])
    # a table missing the AR's cell: the entry must refuse rather than key the weapon to fn 0
    ar = c._hit_entry("assault_rifle", sir)
    hole = {k: v for k, v in sir.items() if k != ar.cell}
    try:
        c._hit_entry("assault_rifle", hole)
        raise AssertionError("an uncovered cell produced an Entry")
    except ValueError as e:
        assert "F53" in str(e) and "assault_rifle" in str(e), e
