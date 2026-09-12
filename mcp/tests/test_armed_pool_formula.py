"""One arithmetic, three sites: `hp + min(255, armor + body_armor's max_armor_add)`.

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


def test_health_pool_and_to_gc_and_validate_agree_across_hp_armor_perk_spread():
    C = Compiler()
    from brx_mcp.mc.state import Session
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    p = s.add_player("ALPHA", gun_id="GUN-A")
    pid = p["player_id"]

    # (max_hp, max_armor, perk, expected pool = hp + min(255, armor + (50 if body_armor else 0)))
    cases = [
        (45, 70, None, 115),
        (45, 70, "body_armor", 165),
        (100, 100, None, 200),
        (50, 0, "body_armor", 100),
        (45, 250, "body_armor", 300),   # armor+add (300) over the 255 ceiling -> clamps
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
        "body_armor re-graded the weapon: the guard reads the BASE pool (195), not the armed 245: "
        f"{tipped['warnings']}"
    )
    # ...and the base pool itself still moves it: 45 + 200 = 245 > 230 is over the line
    over = C.validate(_cfg(45, 200), [_player("rocket_launcher")])
    said = [w for w in over["warnings"] if "ONE MAGAZINE" in w]
    assert said and "245 pool" in said[0], over["warnings"]
    assert C.validate(_cfg(45, 200), [_player("rocket_launcher")])["ok"], "a guideline never blocks"

    # amr resolves at 24 dmg / mag 14 -> threshold 336. The 255 ceiling is clamped inside the guard's
    # own pool too: max_armor=300 would be 45+300=345 unclamped (illegal: ceil(345/24)=15 > mag 14)
    # and is 45+255=300 clamped (legal: ceil(300/24)=13 <= mag 14).
    clamped = C.validate(_cfg(45, 300), [_player("amr")])
    assert not any("ONE MAGAZINE" in w for w in clamped["warnings"]), (
        "the 255 ceiling must be applied inside the guard's pool too, or it grades a player "
        f"armed at 300 as if they were armed at 345: {clamped['warnings']}"
    )
