"""S56 ("what hit me") -- MC half: `Session.roster()`'s `weapons[]`/`hir` field (state.py).

A `$HIR` fact carries only a raw IR magnitude, never a weapon id, so a victim's phone matches that
magnitude against the SHOOTER's known weapons -- which means the roster it holds for the shooter must
carry the shooter's REAL, currently-compiled magnitudes (a perk such as Armour Piercing moves them),
and it must be kept fresh: a kit change made by one player must reach every OTHER player's next
roster too, not just the player who made it.
"""
from brx_mcp.mc.compile import Compiler, cells_from_weap

from test_mc_loadout import mk, online

C = Compiler()


def _cells(weapon_id: str) -> list[dict]:
    """F315: the catalogue frame's `cells`, the roster's value before any compile or re-key."""
    return cells_from_weap(C.catalog.resolve(weapon_id, 0))


def test_roster_carries_the_catalogue_magnitude_before_any_compile():
    s, net, clock, ps = mk(2, compiler=Compiler())
    pid = ps[0]["player_id"]
    entry = next(r for r in s.roster() if r["player_id"] == pid)
    assert entry["weapons"] == [{"weapon_id": "assault_rifle", "hir": C.catalog.hir_magnitudes("assault_rifle"),
                                 "cells": _cells("assault_rifle")}]


def test_roster_picks_up_armour_piercing_once_compiled():
    """Before the perk: the plain catalogue magnitude. After compiling WITH Armour Piercing: the
    weapon's own `ap_dmg`, not the base number -- `_roster_weapons` must read the COMPILED bundle,
    not just re-run the catalogue."""
    s, net, clock, ps = mk(1, compiler=Compiler())
    online(s, net, clock, ps[0], 0)
    pid = ps[0]["player_id"]
    s.push_config()
    base = next(r for r in s.roster() if r["player_id"] == pid)
    assert base["weapons"] == [{"weapon_id": "assault_rifle", "hir": [C.catalog.damage("assault_rifle")],
                                "cells": _cells("assault_rifle")}]

    s.patch_player(pid, loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "armor_piercing"})
    ap_dmg = C.catalog._row("assault_rifle")["ap_dmg"]
    after = next(r for r in s.roster() if r["player_id"] == pid)
    # F315: the cell follows the compiled frame too -- Armour Piercing re-keys the primary onto <4,0>
    assert after["weapons"] == [{"weapon_id": "assault_rifle", "hir": [ap_dmg],
                                 "cells": [{"proto": 4, "subtype": 0, "mag": ap_dmg}]}]
    assert ap_dmg != C.catalog.damage("assault_rifle")   # the perk actually moved the number


def test_a_players_own_weapon_list_carries_no_ghost_entries():
    s, net, clock, ps = mk(1, compiler=Compiler())
    pid = ps[0]["player_id"]
    s.players[pid]["loadout"] = {"weapons": []}
    assert s.roster()[0]["weapons"] == []


def test_a_kit_change_reaches_the_other_players_next_roster_too():
    """Round-2-shaped freshness check (S56): a repush that recompiles the WHOLE roster together must
    not hand an early-pushed player a LATER player's stale bundle beside their brand-new weapon_id.
    Reproduces cleanly if `_repush_lobby_config`/`push_config` ever go back to compiling-and-sending
    one player at a time."""
    s, net, clock, ps = mk(2, compiler=Compiler())
    online(s, net, clock, ps[0], 0)
    online(s, net, clock, ps[1], 1)
    s.push_config()
    p0, p1 = ps[0]["player_id"], ps[1]["player_id"]

    s.patch_player(p1, loadout={"weapons": [{"weapon_id": "shotgun"}]})

    # p0's OWN next assign carries p1's new pick too (roster is embedded in every assign/config body).
    body0 = net.pushes("config", "node0")[-1][2]
    entry = next(r for r in body0["roster"] if r["player_id"] == p1)
    assert entry["weapons"] == [{"weapon_id": "shotgun", "hir": C.catalog.hir_magnitudes("shotgun"),
                                 "cells": _cells("shotgun")}]

    # and p1's own node was told the same thing about itself
    body1 = net.pushes("config", "node1")[-1][2]
    entry1 = next(r for r in body1["roster"] if r["player_id"] == p1)
    assert entry1["weapons"] == entry["weapons"]
