"""F548 (field 2026-10-17, P0): the SMG's `$WEAP` frame shipped with no `,*` terminator.

The SMG capture is 44 fields with no t42 cell, and its `overrides.t42` (an invented headset word's indoor reach) was
written onto `p[43]`, which on that frame is the terminator itself. `*` is what dispatches a frame on the gun, so the
slot-0 weapon never loaded, the head never echoed, and the phone re-pushed the whole head on every relink, 33 times.
`protocol.validate_frame` would have refused it, but it was only called from the lab instrument.
"""
from _session import TEAMS, match_config

from brx_mcp.mc.compile import Compiler, WeaponCatalog
from brx_mcp.protocol import validate_frame

WC = WeaponCatalog()


def test_every_catalogue_weapon_frame_validates_in_every_slot_venue_and_mod():
    bad = []
    for w in WC.all():
        wid = w["weapon_id"]
        for slot in (0, 1, 2):
            for env in ("indoor", "outdoor"):
                for mods in (None, {"silent_weapons": True}):
                    frame = WC.resolve(wid, slot, mods, environment=env)
                    if (why := validate_frame(frame)) is not None:
                        bad.append((wid, slot, env, mods, why, frame[-30:]))
    assert not bad, bad


def test_the_smg_keeps_its_invented_headset_reach_and_its_terminator():
    """The fix extends the frame for t42 rather than dropping it, and `*` stays last."""
    p = WC.resolve("smg", 0, None, environment="outdoor").split(",")
    assert p[-1] == "*", p[-3:]
    assert p[WC._T["headset_range_indoor"] + 1] == "100", p[-4:]


def _player(weapons, perk=None):
    p = {"player_id": "p7", "player_num": 7, "display": "REAPER", "team_id": "blue", "node_id": None, "gun_id": None,
         "voice": "male", "ready": True, "loadout": {"weapons": [{"weapon_id": w} for w in weapons]}}
    if perk:
        p["loadout"]["perk"] = perk
    return p


def test_every_frame_in_a_compiled_smg_bundle_validates():
    cfg = match_config("tdm", teams=TEAMS)
    b = Compiler().compile(cfg, _player(("smg", "shotgun")), TEAMS)
    frames = []

    def walk(v):
        if isinstance(v, str) and v.startswith("$"):
            frames.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(b)
    assert frames and not [(f, validate_frame(f)) for f in frames if validate_frame(f) is not None]


def test_the_compiler_refuses_a_bundle_carrying_a_malformed_frame():
    """The compile path itself must refuse, loudly, rather than ship a frame the gun cannot dispatch."""
    rows = [dict(r) for r in WC._rows]
    for r in rows:
        if r["weapon_id"] == "assault_rifle":
            cap = dict(r["capture"])
            cap["frame"] = cap["frame"][:-2]          # drop ",*"
            r["capture"] = cap
    c = Compiler()
    c.catalog = WeaponCatalog(rows)
    try:
        c.compile(match_config("tdm", teams=TEAMS), _player(("assault_rifle", "shotgun")), TEAMS)
        raise AssertionError("a bundle with an unterminated $WEAP compiled")
    except ValueError as e:
        assert "$WEAP" in str(e) and "',*'" in str(e), e


def test_an_armor_piercing_smg_bundle_validates_too():
    """Armour Piercing rewrites the primary's damage, fire and headset tokens: the terminator must survive that path."""
    b = Compiler().compile(match_config("tdm", teams=TEAMS), _player(("smg", "shotgun"), perk="armor_piercing"), TEAMS)
    head = [f for f in b["head"] if f.startswith("$WEAP")]
    assert head and all(validate_frame(f) is None for f in head), head


def test_a_try_out_refuses_a_malformed_frame_too():
    """Codex review: `tutorial_frames` (the KIT try-out) writes a head of its own and must take the same gate."""
    rows = [dict(r) for r in WC._rows]
    for r in rows:
        if r["weapon_id"] == "assault_rifle":
            r["capture"] = {**r["capture"], "frame": r["capture"]["frame"][:-2]}
    c = Compiler()
    c.catalog = WeaponCatalog(rows)
    w = next(x for x in c.weapon_catalog() if x["weapon_id"] == "assault_rifle")
    try:
        c.tutorial_frames(w, "outdoor")
        raise AssertionError("a try-out with an unterminated $WEAP compiled")
    except ValueError as e:
        assert "COMPILED FRAME REFUSED" in str(e), e
    assert all(validate_frame(f) is None for f in Compiler().tutorial_frames(w, "outdoor"))
