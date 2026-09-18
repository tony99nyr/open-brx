"""One arithmetic, three sites: `hp + max(0, min(255, armor + perk's flat grant))`.

S50 (2026-09-17, perk balance pass, decided in docs/perk-design.md §2): `body_armor`'s grant is a
flat +25 (was +50 -- "maybe 50 is too much armor and it should be 25", Tony 2026-09-17);
`quick_switch` carries a flat -20 cost. Both are `compile._MAX_ARMOR_ADD`, keyed by perk_id.

`Session.health_pool()` (state.py), `Compiler._to_gc()` (compile.py, what actually goes out on
`$PSET`), and the mag>=htk gate inside `Compiler.validate()` (compile.py) each write this formula
out by hand. The comments at all three sites record that it ALREADY DRIFTED ONCE (review
2026-09-01: a `body_armor` player was armed at a 165 pool while a simpler, perk-blind version of
the sum graded it at 115 or 115). This test pins the three sites to each other and to the 255
policy ceiling BEFORE any refactor touches them -- if it fails on unmodified code, the formula has
drifted again and that is a bug report, not a green light for a merge.

Deliberately does not duplicate `test_weapon_derivations.py`'s
`test_the_quoted_pool_is_the_pool_the_gun_is_ACTUALLY_armed_with`, which already pins
`health_pool()` to `_to_gc()`'s `$PSET`. This file adds the third leg: `validate()`'s internal
pool, which is never returned -- only observable through whether it trips the mag>=htk error --
plus a case that isolates the 255 clamp specifically inside `validate()`.
"""
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from _session import match_config

_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1}]


def _cfg(max_hp, max_armor):
    return match_config(max_hp=max_hp, max_armor=max_armor, teams=_TEAMS)


def _player(weapon_id, perk=None):
    return {"player_id": "p1", "player_num": 1, "display": "REAPER", "team_id": "blue",
            "node_id": None, "gun_id": None, "voice": "male",
            "loadout": {"weapons": [{"weapon_id": weapon_id}], "perk": perk}}


def _pset_pool(compiler, config, player):
    """hp+armor off the literal $PSET frame -- what `_to_gc()` actually armed the gun with."""
    head = compiler.compile(config, player, _TEAMS)["head"]
    t = next(f for f in head if f.startswith("$PSET")).split(",")
    return int(t[3]) + int(t[4])


def _pset_shield(compiler, config, player):
    """The literal $PSET shield token (t5, split index 5) -- S50's shields-preset branch."""
    head = compiler.compile(config, player, _TEAMS)["head"]
    t = next(f for f in head if f.startswith("$PSET")).split(",")
    return int(t[5])


def test_health_pool_and_to_gc_and_validate_agree_across_hp_armor_perk_spread():
    C = Compiler()
    from brx_mcp.mc.state import Session
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    p = s.add_player("ALPHA", gun_id="GUN-A")
    pid = p["player_id"]

    # (max_hp, max_armor, perk, expected pool = hp + max(0, min(255, armor + flat grant)))
    cases = [
        (45, 70, None, 115),
        (45, 70, "body_armor", 140),       # 70 + 25
        (100, 100, None, 200),
        # base armour 0 => is_shields_preset(): body_armor's grant redirects to SHIELD instead
        # (S50), and this formula (armed_pool) deliberately excludes shield -- so the pool is
        # UNCHANGED by the perk here, same as if it carried no perk at all.
        (50, 0, "body_armor", 50),
        (45, 250, "body_armor", 300),      # 250 + 25 = 275, over the 255 ceiling -> clamps to 255
        (45, 255, None, 300),
    ]
    for hp, armor, perk, want in cases:
        s.set_config({"health": {"max_hp": hp, "max_armor": armor}})
        s.patch_player(pid, loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": perk})
        q = s.players[pid]

        got_health_pool = s.health_pool(q)
        got_pset_pool = _pset_pool(s.compiler, s.config, q)
        assert got_health_pool == want, f"health_pool hp={hp} armor={armor} perk={perk}: got {got_health_pool}, want {want}"
        assert got_pset_pool == want, f"$PSET pool hp={hp} armor={armor} perk={perk}: got {got_pset_pool}, want {want}"

    # -- validate()'s pool is never returned; observe it through the mag>=htk guard instead --
    #
    # F146 (field 2026-09-12) took the guard OFF this formula on purpose, and the third leg records
    # the new rule rather than being deleted. The guard grades the weapon against the host's health
    # model — the BASE pool, no perk — because grading against the armed pool meant one player's Body
    # Armor (+50) re-graded every weapon for the whole field, and as a hard error it blocked two
    # pushes at a real match. The 255 ceiling still applies, and so does a per-player health override.

    # rocket_launcher resolves at 115 dmg / mag 2 -> threshold 230. The perk must NOT swing this.
    ok = C.validate(_cfg(45, 150), [_player("rocket_launcher")])
    assert not any("ONE MAGAZINE" in w for w in ok["warnings"]), ok["warnings"]     # pool 195, legal
    tipped = C.validate(_cfg(45, 150), [_player("rocket_launcher", perk="body_armor")])
    assert not any("ONE MAGAZINE" in w for w in tipped["warnings"]), (
        "body_armor re-graded the weapon: the guard reads the BASE pool (195), not the armed pool: "
        f"{tipped['warnings']}"
    )
    # ...and the base pool itself still moves it: 45 + 200 = 245 > 230 is over the line
    over = C.validate(_cfg(45, 200), [_player("rocket_launcher")])
    said = [w for w in over["warnings"] if "ONE MAGAZINE" in w]
    assert said and "245 pool" in said[0], over["warnings"]
    assert C.validate(_cfg(45, 200), [_player("rocket_launcher")])["ok"], "a guideline never blocks"

    # The 255 ceiling is clamped inside the guard's OWN pool: max_armor=300 must grade as 45+255=300,
    # never as 45+300=345.
    #
    # This used to assert "the AMR raises no warning at 300", which was true only because the AMR
    # happened to deal 24 damage with a 14-round magazine, so ceil(300/24)=13 fitted and ceil(345/24)
    # =15 did not. That made a live weapon's balance numbers the fixture for a CLAMPING rule, and the
    # 2026-09-18 crit pass moved the AMR to 21 damage and broke it. Whether a particular weapon can
    # empty a magazine into a 300 pool is a balance question; whether the guard clamps is not.
    # So assert the clamp itself: whatever the weapon's numbers, the guard must never grade against
    # 345, and if it does warn it must say it measured 300.
    clamped = C.validate(_cfg(45, 300), [_player("amr")])
    said = [w for w in clamped["warnings"] if "ONE MAGAZINE" in w]
    assert not any("345" in w for w in said), (
        "the 255 ceiling is not applied inside the guard's pool: it graded a player armed at 300 as "
        f"if they were armed at 345: {said}")
    assert all("300 pool" in w for w in said), (
        f"the magazine guard quoted a pool that is neither the clamped 300 nor the illegal 345: {said}")


def test_body_armor_grants_shield_not_armour_when_base_armour_is_zero():
    """S50: a game whose `health.max_armor` is 0 (the Shields preset, e.g. 30 HP + 120 shield) must
    not have body_armor reintroduce an armour LAYER the preset was designed without -- the grant
    compiles into the $PSET SHIELD ceiling instead (`compile.is_shields_preset`/`armed_shield`).

    Break `armed_armor()`'s `if shields: return ... untouched` branch (or `is_shields_preset()`
    itself) and this goes red: armour would move off 0 for a body_armor pick, or shield would stop
    moving, or both would move at once."""
    C = Compiler()
    cfg = dict(_cfg(30, 0))    # base armour 0 -- the shields-preset signal
    unperked = _player("assault_rifle")
    armoured = _player("assault_rifle", perk="body_armor")

    # armour stays 0 for BOTH -- the grant never lands there once the preset has none to begin with.
    assert _pset_pool(C, cfg, unperked) == 30 + 0
    assert _pset_pool(C, cfg, armoured) == 30 + 0

    # shield: unperked keeps the compiler's own default (70, `Compiler._GC_SHIELD_DEFAULT`); the
    # perk's flat +25 grant lands there instead.
    base_shield = _pset_shield(C, cfg, unperked)
    assert base_shield == 70
    assert _pset_shield(C, cfg, armoured) == base_shield + 25

    # ...and a NORMAL game (base armour > 0) is the control: the grant lands on armour, shield never moves.
    normal = dict(_cfg(45, 70))
    assert _pset_shield(C, normal, unperked) == _pset_shield(C, normal, armoured) == 70
    assert _pset_pool(C, normal, armoured) == 45 + 70 + 25


def test_a_negative_grant_floors_at_zero_not_underflow():
    """S50: quick_switch's grant is NEGATIVE (a flat -20) -- `armed_armor`/`armed_shield` must floor
    the result at 0, never go negative. Break the `max(0, ...)` clamp and a small base armour (or
    shield) underflows to a negative $PSET token, which the firmware has never been sent and whose
    behaviour is unknown."""
    C = Compiler()
    quick_switch = _player("assault_rifle", perk="quick_switch")
    # base armour 5: 5 + (-20) = -15 -> floors to 0, not a negative $PSET token.
    small = dict(_cfg(45, 5))
    assert _pset_pool(C, small, quick_switch) == 45 + 0

    # base armour 0 in a shields game: the grant redirects to shield instead (70 default - 20 = 50,
    # still comfortably above the floor, but exercised here so the shield branch is covered by the
    # same cost perk that exercises the armour floor above).
    shields_cfg = dict(_cfg(45, 0))
    assert _pset_shield(C, shields_cfg, quick_switch) == 70 - 20
    assert _pset_shield(C, shields_cfg, _player("assault_rifle")) == 70
