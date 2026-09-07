"""A15: the character voices -- the family line layout read off the gun, the $PSET picks, `voice:<role>` sounds."""
from brx_mcp import voices as V
from brx_mcp import sounds as snd
from brx_mcp.gameconfig import VOICE_PACKS, voice_tail


def _raises(fn, *a, **kw):
    try:
        fn(*a, **kw)
    except ValueError:
        return True
    raise AssertionError(f"{fn.__name__}{a} did not raise")


def test_heavy_lines_carry_the_pset_fields_and_the_kill_cue():
    ls = {l["id"]: l for l in V.lines("heavy")}
    assert len(ls) == 22 and all(i.startswith("V3") for i in ls)
    assert ls["V33"]["uses"] == ["pset:death_scream", "pool:death_scream"] and ls["V33"]["role"] == "death_scream" and ls["V33"]["group"] == "hit"
    assert ls["V34"]["uses"] == ["pool:death_scream"]                                   # A15.1: MC rolls the field from 3/4/5
    # A15.2: the respawn cry is NOT in the $PSET any more (the field ships empty); Heavy's one spawn line has no pool
    assert ls["V3I"]["uses"] == [] and ls["V3I"]["role"] == "boast" and ls["V3I"]["words"] == "Get some!"
    # A15.3: the three pain fields ship EMPTY (the node plays pain_short/pain_long/pain_melee itself),
    # so these ids now carry only the node's pain pools, never a pset: use
    assert ls["V3C"]["uses"] == ["pool:pain_short", "pool:pain_melee"] and ls["V3G"]["uses"] == ["pool:pain_short"] and ls["V3E"]["uses"] == ["pool:pain_long"]
    assert ls["V37"]["uses"] == ["pset:pain_relief"] and ls["V37"]["role"] == "healed"
    assert ls["V3A"]["uses"] == ["cue:kill", "pool:kill"] and ls["V3A"]["role"] == "kill_confirm" and ls["V3A"]["group"] == "personality"
    assert ls["V3K"]["uses"] == ["pool:kill"] and ls["V38"]["uses"] == ["pool:kill"]
    assert ls["V3K"]["role"] == "taunt" and ls["V31"]["role"] == "intro" and ls["V3M"]["role"] == "name"
    assert [l["slot"] for l in V.lines("heavy")] == list("123456789ABCDEFGHIJKLM")   # slot order


def test_male_default_family_is_the_18_slot_player_pack_plus_the_announcer_grunts():
    ls = {l["id"]: l for l in V.lines("male")}
    assert "VAA" in ls and ls["VAA"]["uses"] == ["cue:kill", "pool:kill"] and ls["VAA"]["words"] == "Kill."
    assert ls["VA3"]["uses"] == ["pset:death_scream", "pool:death_scream"] and ls["VA7"]["uses"] == ["pset:pain_relief"]   # what $PSET ships today
    assert ls["VAI"]["words"] == "There's nowhere for you to hide."
    # A15.2: the Male player's spawn pool is VAI / VAN / VAO ("all good at spawn picked randomly")
    assert ls["VAI"]["uses"] == ["pool:spawn"] and ls["VAN"]["uses"] == ["pool:spawn"] and ls["VAO"]["uses"] == ["pool:spawn"]


def test_every_line_of_every_family_is_on_the_gun():
    on = snd.on_gun_ids()
    for v in VOICE_PACKS:
        ls = V.lines(v)
        assert ls, v
        assert all(l["id"] in on for l in ls), v
        assert all(l["uses"] for l in ls if l["id"] in voice_tail(v)), v      # the five written $PSET ids are marked
        assert voice_tail(v)[1] == "", v                                        # A15.2: the cry field ships EMPTY


def test_check_slots_rejects_a_bad_role_and_an_off_gun_id_and_normalises_case():
    assert V.check_slots(None) == {} and V.check_slots({}) == {}
    assert V.check_slots({"death_scream": "v34", "kill": ""}) == {"death_scream": "V34"}
    assert _raises(V.check_slots, {"dance": "V34"})
    assert _raises(V.check_slots, {"death_scream": "E_J10"})       # app-only, not on the gun
    assert _raises(V.check_slots, {"death_scream": 12})
    assert _raises(V.check_slots, ["V34"])


def test_pset_ids_and_role_id_honour_the_override():
    d = V.pset_ids("heavy")
    # A15.3: melee_grunt / short_pain / long_pain ship EMPTY too now (the node plays them by damage)
    assert d == {"death_scream": "V33", "respawn_cry": "", "melee_grunt": "", "short_pain": "", "long_pain": "", "pain_relief": "V37"}
    o = V.pset_ids("heavy", {"death_scream": "V35", "kill": "V38"})     # kill is not a $PSET field
    assert o["death_scream"] == "V35" and "kill" not in o and o["respawn_cry"] == "" and o["short_pain"] == ""
    assert V.pset_ids("heavy", {"respawn_cry": "V3I"})["respawn_cry"] == "V3I"    # the escape hatch: a pick puts a firmware cry back
    assert V.pset_ids("heavy", {"short_pain": "V3H"})["short_pain"] == "V3H"      # A15.3: same escape hatch, a pain field
    assert V.candidates("heavy")["respawn_cry"] == []
    assert V.role_id("heavy", "boast") == "V3I" and V.role_id("heavy", "kill") == "V3A" and V.role_id("medic", "kill") == "V8S"
    assert V.role_id("heavy", "kill", {"kill": "V38"}) == "V38" and V.role_id("heavy", "taunt") == "V3K"
    assert V.role_id("heavy", "dance") is None
    ls = {l["id"]: l for l in V.lines("heavy", {"death_scream": "V35", "kill": "V38"})}
    assert ls["V35"]["uses"] == ["pset:death_scream"] and ls["V33"]["uses"] == [] and ls["V38"]["uses"] == ["cue:kill"]
    assert voice_tail("heavy", {"death_scream": "V35"}) == ["V35", "", "", "", "", "V37"]   # A15.3: cry + all three pains empty
    # a pick from OUTSIDE the family still appears in the list, flagged
    ls = {l["id"]: l for l in V.lines("heavy", {"pain_relief": "V87"})}
    assert ls["V87"]["role_words"] == "outside the family" and ls["V87"]["uses"] == ["pset:pain_relief"]


def test_hurt_loop_is_playable_and_long_death_is_retired():
    """Tony, 2026-09-06 (bench): the hurt loop (slot 6) is good for critical health; the long death
    (slot J) "is ridiculous, probably dont use that one for anything" -- catalogued, never selectable."""
    assert "hurt_loop" in V.SOUND_ROLES
    assert "long_death" not in V.SOUND_ROLES
    assert V.candidates("heavy")["death_scream"] == ["V33", "V34", "V35"]      # V3J (long_death) dropped
    assert V.role_id("heavy", "hurt_loop") == "V36"
    ls = {l["id"]: l for l in V.lines("heavy")}
    assert ls["V3J"]["role"] == "long_death" and ls["V3J"]["group"] == "extra"  # not a "hit" reaction the gun plays


def test_options_cover_every_player_family_and_no_commander():
    opts = {o["id"]: o for o in V.options()}
    assert set(opts) == set(VOICE_PACKS)
    assert opts["clean_male"]["family"] == "VP" and opts["clean_male"]["speaker"] == "Male (clean)"
    assert opts["soldier"]["family"] == "VE" and opts["soldier"]["speaker"] == "Soldier"
    assert opts["heavy"]["verified"] is True and opts["heavy"]["lines"] == 22 and opts["medic"]["verified"] is False
    assert not {o["family"] for o in opts.values()} & {"VQ", "VR", "VS"}
    c = V.candidates("heavy")
    assert c["death_scream"][0] == "V33" and c["kill"][0] == "V3A" and c["pain_relief"] == ["V37"]
    assert V.play_line_frame("V3K") == "$PLAY,,4,6,V3K,,,,*"


def test_slot_2_is_the_gas_death_not_an_idle_line():
    """Tony, 2026-09-06 (bench): "va2 is dieing of smoke or gas" -- VA2 is the documented $SIR,11 tear-gas victim
    sound and every family's slot 2 is the same coughing death, so the role is gas_death (a HIT sound)."""
    assert V.SLOT_ROLES["2"] == ("gas_death", "hit") and "idle" not in V.SOUND_ROLES and "gas_death" in V.SOUND_ROLES
    assert V.role_id("male", "gas_death") == "VA2" and V.role_id("scout", "gas_death") == "VB2"
    vb2 = next(l for l in V.lines("scout") if l["id"] == "VB2")
    assert vb2["role"] == "gas_death" and vb2["group"] == "hit"
    assert "2" not in V.PSET_CANDIDATES["respawn_cry"]


def test_role_ids_are_pools_default_first_and_kill_is_confirms_plus_taunts():
    """A15.1: a `voice:<role>` sound is a POOL the node rolls from. Order = slot order with the documented default
    first; `kill` = the kill line, the other two kill confirms, then the two taunts (Tony: "The kill confirm sound
    and taunts should be selected on single kill at random")."""
    assert V.role_ids("heavy", "kill") == ["V3A", "V38", "V39", "V3K", "V3L"]
    assert V.role_ids("male", "kill") == ["VAA", "VA8", "VA9", "VAK", "VAL"]
    assert V.role_ids("medic", "kill")[0] == "V8S"                       # the documented kill line leads
    assert V.role_ids("heavy", "pain") == ["V3C", "V3D", "V3E", "V3F", "V3G", "V3H"]
    assert V.role_ids("heavy", "death_scream") == ["V33", "V34", "V35"] and V.role_ids("heavy", "taunt") == ["V3K", "V3L"]
    assert V.role_ids("heavy", "boast") == ["V3I"] and V.role_ids("heavy", "dance") == []
    assert V.role_ids("heavy", "kill", {"kill": "V39"}) == ["V39"]      # an explicit pick is the whole pool
    assert V.role_id("heavy", "kill") == "V3A" and V.role_id("heavy", "pain") == "V3C"


def test_pset_fields_roll_from_curated_pools_and_explicit_picks_win():
    """A15.1: "the death scream ... sounds … are all equal and should be picked at random"; the Male player's
    respawn cry may be VAI / VAN / VAO -- but as a node spawn-pool draw, not a $PSET roll (A15.2). A15.3 narrows
    the $PSET roll to death_scream alone: the three pain fields ship EMPTY and are never rolled (the node plays
    pain_short/pain_long/pain_melee itself by damage). Deterministic for a seeded Random, never outside the pool."""
    import random
    assert V.roll_pool("male", "respawn_cry") == [] and V.roll_pool("heavy", "respawn_cry") == []   # A15.2: not a $PSET roll any more
    assert V.role_ids("male", "spawn") == ["VAI", "VAN", "VAO"]          # …it is the node's spawn POOL (one draw per spawn)
    assert V.role_ids("heavy", "spawn") == ["V3I"]                       # one spawn line until its extra lines are audited
    assert V.roll_pool("heavy", "death_scream") == ["V33", "V34", "V35"]
    # A15.3: the pain fields ship EMPTY and are no longer rolled at all (was: short_pain/long_pain had curated pools)
    assert V.roll_pool("heavy", "short_pain") == [] and V.roll_pool("heavy", "long_pain") == [] and V.roll_pool("heavy", "melee_grunt") == []
    assert V.roll_pool("heavy", "pain_relief") == ["V37"]
    seen = set()
    for seed in range(12):
        r = V.roll_pset("male", None, random.Random(seed))
        assert r == V.roll_pset("male", None, random.Random(seed))       # deterministic
        assert r["death_scream"] in ("VA3", "VA4", "VA5") and r["respawn_cry"] == ""
        assert r["short_pain"] == "" and r["long_pain"] == "" and r["melee_grunt"] == "" and r["pain_relief"] == "VA7"
        seen.add(r["death_scream"])
    assert len(seen) > 1, "twelve seeds never varied: the roll is not rolling"
    fixed = V.roll_pset("male", {"death_scream": "VA4", "respawn_cry": "VAO"}, random.Random(0))
    assert fixed["death_scream"] == "VA4" and fixed["respawn_cry"] == "VAO"


def test_the_spawn_line_is_ours_a15_2():
    """A15.2 (bench 2026-09-06): the $PSET cry field is empty, `spawn` is a sound role with a pool, and the
    board marks the pool members. A15.3 empties the three pain fields the same way."""
    assert "spawn" in V.SOUND_ROLES and V.role_id("male", "spawn") == "VAI" and V.role_id("scout", "spawn") == "VBI"
    assert V.role_ids("male", "spawn", {"spawn": "VAO"}) == ["VAO"]      # an explicit pick is the whole pool
    assert voice_tail("male") == ["VA3", "", "", "", "", "VA7"]
    assert voice_tail("male", {"respawn_cry": "VAN"}) == ["VA3", "VAN", "", "", "", "VA7"]
