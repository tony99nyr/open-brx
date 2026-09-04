"""Sidearms (2026-09-04): three Counter-Strike-style pistols in the catalog + the `sidearm` policy kind.

docs/spec/loadout.md §1.1 / §3 (A12). A pistol is a WEAPON on the wire (WeaponSel, kind "weapon" in a
`loadout_request`); "sidearm" is a POLICY kind — a slot rule that admits only the `sidearm`-tagged rows,
the way `kinds: ["perk"]` admits only perks. This file pins: the three rows and their frames, the pool
under every kinds combination, the phone-path rejection copy, auto-apply, and the node view.
"""
from brx_mcp.mc import policy as P
from brx_mcp.mc.compile import DEFAULT_POOL, WeaponCatalog
from brx_mcp.mc.perks import default_perks

CAT = WeaponCatalog()
W = CAT.all()
PK = default_perks().all()
PISTOLS = ("glock", "usp", "deagle")


def _T(frame: str, key: str) -> str:
    return frame.split(",")[WeaponCatalog._T[key] + 1]


# ---------------------------------------------------------------- the rows
def test_the_three_pistols_are_visible_sidearms():
    by = {w["weapon_id"]: w for w in W}
    for wid in PISTOLS:
        assert wid in by, wid
        assert by[wid]["role"] == "sidearm" and "sidearm" in by[wid]["tags"] and "pistol" in by[wid]["tags"]
        assert by[wid]["verified"] is False                 # never benched yet
        assert by[wid]["desc"].strip().endswith(".")


def test_pistol_frames_ride_the_bolt_rifle_and_only_named_tokens_move():
    """Same semi-auto trigger (t20 = 7), same $SIR row (t3/t4), own damage / cycle / ammo / sounds."""
    bolt = CAT.resolve("bolt_rifle", 1).split(",")
    for wid in PISTOLS:
        p = CAT.resolve(wid, 1).split(",")
        assert len(p) == len(bolt)
        moved = {i for i, (a, b) in enumerate(zip(p, bolt)) if a != b}
        allowed = {WeaponCatalog._T[k] + 1 for k in ("dmg", "fire", "mag", "reserve", "reload", "clipstart", "reserve_half",
                                                     "snd_fire", "rel1", "rel2", "rel3", "swap")}   # swap: tok15 = draw time (bench 2026-09-04)
        if wid == "usp":
            allowed |= {26, 27}                               # t25/t26: suppressed, flashless (the Suppressor's pair)
        assert moved <= allowed, f"{wid} moved unnamed tokens {sorted(moved - allowed)}"
        assert _T(",".join(p), "mode") == "7", f"{wid} is not semi-automatic"
        assert p[1] == "1"                                    # slot 1 = the secondary


def test_pistol_identities_keep_the_counter_strike_ordering():
    dmg = {w: CAT.damage(w) for w in PISTOLS}
    fire = {w: CAT.fire_ms(w) for w in PISTOLS}
    assert dmg["glock"] < dmg["usp"] < dmg["deagle"]
    assert fire["glock"] < fire["usp"] < fire["deagle"]
    mags = {w: CAT.spawn_ammo(w)[0] for w in PISTOLS}
    assert mags["deagle"] < mags["usp"] < mags["glock"]
    # every pistol lands in the 1.5-3.5 s band the arsenal is balanced to
    for w in PISTOLS:
        assert 1500 <= CAT.time_to_kill(w, DEFAULT_POOL) <= 3500, w


def test_pistol_sounds_are_unique_on_gun_ids():
    """Each pistol's fire sound is used by no other weapon, so a custom .LTP swapped over the data
    port changes one pistol and nothing else (community-notes.md, custom sounds)."""
    fire = {w["weapon_id"]: _T(w["weap_frame"], "snd_fire") for w in W}
    for wid in PISTOLS:
        assert list(fire.values()).count(fire[wid]) == 1, (wid, fire[wid])
    assert fire["usp"].startswith("Q"), "the USP-S is suppressed — a Q-family (silenced) shot"
    usp = CAT.resolve("usp", 1).split(",")
    assert usp[25 + 1] == "2" and usp[26 + 1] == "50"        # no flash, half loudness — as on the Suppressor
    for wid in PISTOLS:
        p = CAT.resolve(wid, 1).split(",")
        assert (_T(",".join(p), "rel1"), _T(",".join(p), "rel2"), _T(",".join(p), "rel3")) == ("D08", "D07", "D06")


def test_pistols_draw_in_500ms_but_the_gun_takes_the_slower_slot():
    """Bench 2026-09-04 (docs/bench-weap-tokens-2026-09-04.md): tok15 IS the swap delay and the gun applies the
    LARGER of the two loaded slots, so a 500 ms pistol only draws fast beside another quick weapon or a perk."""
    for w in PISTOLS:
        assert CAT.swap_ms(w) == 500, w
        assert _T(CAT.resolve(w, 1), "swap") == "500", w
    assert CAT.swap_ms("assault_rifle") == 850          # primaries keep the captured value


# ---------------------------------------------------------------- the policy kind
def _pol(**patch):
    return P.merge(P.preset_rules("open"), patch)


def test_sidearm_kind_narrows_the_secondary_pool_to_the_pistols():
    lp = P.pool(_pol(secondary={"kinds": ["sidearm", "perk"]}), W, PK)
    assert lp["secondary_weapons"] == list(PISTOLS) and len(lp["secondary_perks"]) == len(PK)
    lp = P.pool(_pol(secondary={"kinds": ["sidearm"]}), W, PK)
    assert lp["secondary_weapons"] == list(PISTOLS) and lp["secondary_perks"] == []
    # "weapon" already includes the pistols — adding "sidearm" beside it changes nothing
    a = P.pool(_pol(secondary={"kinds": ["weapon"]}), W, PK)
    b = P.pool(_pol(secondary={"kinds": ["weapon", "sidearm"]}), W, PK)
    assert a == b and "usp" in a["secondary_weapons"] and "smg" in a["secondary_weapons"]
    # exclude_* still applies on top of the kind
    lp = P.pool(_pol(secondary={"kinds": ["sidearm"], "exclude_ids": ["deagle"]}), W, PK)
    assert lp["secondary_weapons"] == ["glock", "usp"]


def test_pistol_round_on_the_primary_slot():
    pol = _pol(primary={"kinds": ["sidearm"]}, secondary={"choice": "off"})
    lp = P.pool(pol, W, PK)
    assert lp["primary"] == list(PISTOLS)
    fixed = P.apply(pol, lp, {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}]}, W, PK)
    assert fixed == {"weapons": [{"weapon_id": "glock"}]}    # first allowed pistol; secondary cleared
    for bad in ({"primary": {"kinds": ["perk"]}},           # a perk never goes in slot 1
                {"secondary": {"kinds": ["rifle"]}}):
        try:
            _pol(**bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"policy accepted {bad}")


def test_phone_path_copy_for_a_sidearm_only_slot():
    pol = _pol(secondary={"kinds": ["sidearm", "perk"]})
    lp = P.pool(pol, W, PK)
    assert P.check_request(pol, lp, "secondary", "weapon", "usp", W, PK) == (True, None)
    ok, why = P.check_request(pol, lp, "secondary", "weapon", "smg", W, PK)
    assert not ok and why == "Only sidearms go in the secondary slot this game"
    assert P.check_request(pol, lp, "secondary", "perk", "body_armor", W, PK) == (True, None)
    # a pistol is requested as kind "weapon" — "sidearm" is not a request kind
    ok, why = P.check_request(pol, lp, "secondary", "sidearm", "usp", W, PK)
    assert not ok and why == "Unknown pick"
    # host side says the same thing
    ok, why = P.validate_loadout(pol, lp, {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}]}, W, PK)
    assert not ok and why == "Only sidearms go in the secondary slot this game"
    assert P.validate_loadout(pol, lp, {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "deagle"}]}, W, PK) == (True, None)
    # perks-only still reads as before
    pol2 = _pol(secondary={"kinds": ["perk"]})
    ok, why = P.check_request(pol2, P.pool(pol2, W, PK), "secondary", "weapon", "usp", W, PK)
    assert not ok and why == "A weapon can't go in the secondary slot this game"


def test_node_view_carries_the_kind_so_the_hud_can_label_the_chip():
    pol = _pol(secondary={"kinds": ["sidearm", "perk"]})
    nv = P.node_view(pol, P.pool(pol, W, PK))
    assert nv["secondary"]["kinds"] == ["sidearm", "perk"]
    assert nv["secondary"]["allowed_weapon_ids"] == list(PISTOLS)


def test_open_preset_is_untouched_by_the_new_kind():
    lp = P.pool(P.preset_rules("open"), W, PK)
    assert set(PISTOLS) <= set(lp["primary"]) and set(PISTOLS) <= set(lp["secondary_weapons"])
    assert P.merge(P.preset_rules("open"), {}) ["preset"] == "open"
    assert _pol(secondary={"kinds": ["sidearm", "perk"]})["preset"] == "custom"
