"""Honest pickers (Tony 2026-10-25): "picking Armour Piercing and then finding out at config push that the chosen
weapon cannot carry it is not fun". Every picker offers only legal pairs, and a later change that makes a pair illegal
clears the perk to none with no warning (the no-warnings auto-fix rule). Armour Piercing and Body Armor are also
refused on the Shields health preset, and a preset switch clears them the same way.

The refused sets come from the catalogue (`PerkView.blocked_primary/secondary/presets`), never a hand list.
"""
from _session import mk_loadout_session, online

from brx_mcp.mc.compile import HEALTH_PRESETS, Compiler


def _real(n=2):
    s, net, clock, ps = mk_loadout_session(n, compiler=Compiler())[:4]
    return s, net, clock, ps


def _shields(s, preset="shields"):
    hp, armor, shield = HEALTH_PRESETS[preset]
    s.set_config({"health": {"max_hp": hp, "max_armor": armor, "max_shield": shield, "preset": preset}})


def test_each_perk_view_names_the_presets_it_is_refused_under_from_its_effects():
    perks = {r["perk_id"]: r for r in Compiler().perk_catalog()}
    assert perks["armor_piercing"]["blocked_presets"] == ["shields"], perks["armor_piercing"]
    assert perks["body_armor"]["blocked_presets"] == ["shields"], perks["body_armor"]
    # control: a perk with a negative armour effect, and a perk with neither, are refused under no preset
    assert perks["quick_switch"]["blocked_presets"] == [], perks["quick_switch"]
    assert perks["extended_mags"]["blocked_presets"] == [], perks["extended_mags"]


def test_the_shields_preset_takes_armour_piercing_and_body_armor_out_of_the_perk_pool():
    s, *_ = _real()
    assert {"armor_piercing", "body_armor"} <= set(s.loadout_pool()["perks"]), "control: Standard offers both"
    _shields(s)
    perks = s.loadout_pool()["perks"]
    assert "armor_piercing" not in perks and "body_armor" not in perks, perks
    assert "extended_mags" in perks, perks
    _shields(s, "hardcore")
    assert {"armor_piercing", "body_armor"} <= set(s.loadout_pool()["perks"]), "only the Shields preset refuses them"


def test_a_switch_to_the_shields_preset_clears_the_perk_silently_and_the_push_goes_through():
    s, net, clock, ps = _real()
    a, b = ps[0]["player_id"], ps[1]["player_id"]
    s.patch_player(a, loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "armor_piercing"})
    s.patch_player(b, loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "extended_mags"})
    assert s.players[a]["loadout"].get("perk") == "armor_piercing", "setup"
    _shields(s)
    assert "perk" not in s.players[a]["loadout"], s.players[a]["loadout"]
    assert s.players[a]["loadout"]["weapons"] == [{"weapon_id": "assault_rifle"}], "the weapons stay"
    assert s.players[b]["loadout"].get("perk") == "extended_mags", "a perk the preset allows stays"
    assert not any("armor_piercing" in w or "Armour Piercing" in w or "RESET" in w for w in s.config_warnings), \
        "a perk-only clear is silent: no RESET notice (Codex review)"
    s.push_config(force=True)


def test_a_host_patch_of_body_armor_on_the_shields_preset_is_cleared_not_refused():
    s, net, clock, ps = _real()
    _shields(s)
    p = s.patch_player(ps[0]["player_id"], loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "body_armor"})
    assert "perk" not in p["loadout"], p["loadout"]


def test_a_fixed_armour_piercing_on_the_shields_preset_empties_the_perk_slot_as_preset_blocked():
    s, *_ = _real()
    pol = s.policy()
    pol["perk"] = {**pol["perk"], "choice": "fixed", "fixed_id": "armor_piercing"}
    s.set_config({"loadout_policy": pol})
    _shields(s)
    lp = s.loadout_pool()
    assert lp["perks"] == [] and lp.get("reasons", {}).get("perks") == "preset_blocked", lp
    for p in s.players.values():
        assert "perk" not in p["loadout"], p["loadout"]
    s.push_config(force=True)


def test_a_phone_weapon_pick_that_drops_the_held_perk_is_acked_with_no_warning():
    s, net, clock, ps = _real()
    online(s, net, clock, ps[0], 0)
    pid = ps[0]["player_id"]
    s.patch_player(pid, loadout={"weapons": [{"weapon_id": "assault_rifle"}], "perk": "armor_piercing"})
    s._on_loadout_request("node0", pid, {"slot": "primary", "kind": "weapon", "id": "burst_rifle"})
    acks = [b for n, k, b in net.pushed if k == "loadout_ack" and n == "node0"]
    assert acks and acks[-1]["ok"], acks[-1:]
    assert not acks[-1].get("dropped") and not acks[-1].get("reason"), acks[-1]
    lo = s.players[pid]["loadout"]
    assert lo["weapons"][0]["weapon_id"] == "burst_rifle" and "perk" not in lo, lo


def test_shields_is_read_from_the_numbers_not_the_stored_preset_string():
    """brx3 review: the console derives the preset from the numbers (`healthPresetOf`), so MC must too, or the GAMES
    preview and the real pool disagree."""
    s, *_ = _real()
    s.config["health"] = {"max_hp": 45, "max_armor": 0, "max_shield": 105}           # an older config: no preset key
    assert "armor_piercing" not in s.loadout_pool()["perks"], "45/0/105 is Shields"
    s.config["health"] = {"max_hp": 60, "max_armor": 0, "max_shield": 105, "preset": "shields"}   # edited numbers
    assert "armor_piercing" in s.loadout_pool()["perks"], "edited numbers are custom, whatever the string says"
