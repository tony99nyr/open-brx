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

_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1}]


def _cfg(max_hp, max_armor):
    return {"config_id": "c1", "mode": "tdm", "environment": "indoor", "night": False,
            "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
            "scoring": {"frag_limit": 0, "win_by": "kills"},
            "health": {"max_hp": max_hp, "max_armor": max_armor}, "teams": _TEAMS}


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

    # -- validate()'s pool is never returned; observe it through the mag>=htk gate instead --

    # rocket_launcher resolves at 115 dmg / mag 2 -> threshold 230. The perk alone must swing this.
    ok = C.validate(_cfg(45, 150), [_player("rocket_launcher")])
    assert not any("one magazine" in e for e in ok["errors"]), ok["errors"]        # pool 195, legal
    tipped = C.validate(_cfg(45, 150), [_player("rocket_launcher", perk="body_armor")])
    errs = [e for e in tipped["errors"] if "one magazine" in e]
    assert errs and "245 pool" in errs[0], (
        "body_armor must push the pool from 195 to 245 inside validate()'s own arithmetic too "
        f"(rocket_launcher mag 2, threshold 230): {tipped['errors']}"
    )

    # amr resolves at 24 dmg / mag 14 -> threshold 336. With max_armor=255 + body_armor's +50, the
    # UNCLAMPED sum would be 45+305=350 (illegal: ceil(350/24)=15 > mag 14); the 255-clamped pool
    # is 45+255=300 (legal: ceil(300/24)=13 <= mag 14). This isolates the clamp itself, not just
    # the perk -- a naive validate() that forgot the ceiling would flag this player's amr as
    # unable to kill on one magazine when the gun is actually armed well inside the limit.
    clamped = C.validate(_cfg(45, 255), [_player("amr", perk="body_armor")])
    assert not any("one magazine" in e for e in clamped["errors"]), (
        "the 255 ceiling must be applied inside validate()'s pool too, or it grades a player "
        f"armed at 300 as if they were armed at 350: {clamped['errors']}"
    )
