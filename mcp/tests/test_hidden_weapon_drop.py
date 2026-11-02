"""Issue 12 (Tony, game 2026-11-01): hiding the SMG (`hidden: true`, F638) locked him out of presets and
saved kits that named it. The rule (Tony 2026-09-28): when a pick becomes illegal, drop or remap it
silently; never block, never warn. A hidden weapon must still never be SELECTED (Tony 2026-09-26)."""
from __future__ import annotations

import json
import pathlib
import tempfile

from brx_mcp.mc.compile import Compiler, WeaponCatalog
from brx_mcp.mc.perks import default_perks
from brx_mcp.mc.pieces import PieceError, PieceStore, check_value
from _session import mk_loadout_session


def _hidden() -> set[str]:
    return {w["weapon_id"] for w in WeaponCatalog()._rows if w.get("hidden") or w.get("pickup_only")}


def _visible_types(wid: str) -> set[str]:
    return set(WeaponCatalog().row(wid)["types"] or [])


def test_a_hidden_weapon_drops_out_of_a_preset_list():
    v = check_value("primary", {"choice": "player", "only_ids": ["smg", "assault_rifle"]})
    assert v["only_ids"] == ["assault_rifle"]


def test_a_list_the_drop_would_empty_remaps_to_the_same_type():
    v = check_value("primary", {"choice": "player", "only_ids": ["smg"]})
    assert v["only_ids"], "an empty list reads as unrestricted: the remap must keep the piece narrow"
    assert not set(v["only_ids"]) & _hidden()
    assert all("close" in _visible_types(w) for w in v["only_ids"]), v["only_ids"]


def test_a_fixed_hidden_weapon_remaps_to_a_visible_one_of_the_same_type():
    v = check_value("primary", {"choice": "fixed", "fixed_id": "smg"})
    assert v["choice"] == "fixed" and v["fixed_id"] not in _hidden()
    assert "close" in _visible_types(v["fixed_id"])


def test_no_preset_ever_returns_a_hidden_weapon():
    """Tony 2026-09-26 still holds: a preset never selects a hidden weapon. Each one is dropped, remapped or
    (with nothing of its type to remap to, e.g. melee) refused; it never comes back out of the check."""
    for wid in sorted(_hidden()):
        for value in ({"choice": "fixed", "fixed_id": wid}, {"choice": "player", "only_ids": ["assault_rifle", wid]}):
            try:
                out = check_value("primary", value)
            except PieceError:
                continue
            assert wid not in out["only_ids"] and out["fixed_id"] != wid, (wid, out)


def test_a_typo_is_still_refused():
    try:
        check_value("primary", {"choice": "fixed", "fixed_id": "smgg"})
        assert False, "an id the catalogue never held was accepted"
    except PieceError as e:
        assert e.status == 400


def test_a_stored_preset_naming_the_smg_loads_usable():
    path = pathlib.Path(tempfile.mkdtemp()) / "pieces.json"
    path.write_text(json.dumps({"v": 1, "pieces": [
        {"piece_id": "z1", "kind": "primary", "name": "Close Quarters",
         "value": {"choice": "player", "only_ids": ["smg", "shotgun"]}},
        {"piece_id": "z2", "kind": "secondary", "name": "Spray",
         "value": {"choice": "fixed", "kinds": ["weapon"], "fixed_id": "smg"}},
    ]}))
    rows = {r["name"]: r for r in PieceStore(path).list()}
    for name in ("Close Quarters", "Spray"):
        assert "invalid" not in rows[name], rows[name].get("invalid")
    assert rows["Close Quarters"]["value"]["only_ids"] == ["shotgun"]
    assert rows["Spray"]["value"]["fixed_id"] not in _hidden()


def test_a_saved_kit_with_the_smg_is_refit_not_refused():
    s, net, clock, ps = mk_loadout_session(2, compiler=Compiler())
    p = s.add_player("OLD KIT", loadout={"weapons": [{"weapon_id": "smg"}]})
    ws = [w["weapon_id"] for w in p["loadout"]["weapons"]]
    assert ws and not set(ws) & _hidden(), ws
    q = s.patch_player(ps[0]["player_id"], loadout={"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "smg"}]})
    assert [w["weapon_id"] for w in q["loadout"]["weapons"]] == ["assault_rifle"]


def test_a_kit_with_an_unknown_weapon_is_still_refused():
    s, net, clock, ps = mk_loadout_session(2, compiler=Compiler())
    try:
        s.add_player("TYPO", loadout={"weapons": [{"weapon_id": "smgg"}]})
        assert False, "an unknown weapon_id was accepted"
    except ValueError as e:
        assert "unknown weapon_id" in str(e)


def test_a_fixed_hidden_perk_becomes_the_players_pick():
    """Review Medium: a perks preset fixed on a perk hidden since (med_kit) must not block PLAY either."""
    hidden = [p["perk_id"] for p in default_perks()._rows if p.get("hidden")]
    assert hidden, "the fixture lost its hidden perks"
    v = check_value("perks", {"choice": "fixed", "fixed_id": hidden[0]})
    assert v["choice"] == "player" and v["fixed_id"] is None
    assert check_value("perks", {"choice": "player", "only_ids": [hidden[0]]})["only_ids"] == []


def test_the_remap_keeps_to_the_first_type_and_never_widens():
    """Review Low: a hidden glock (sidearm, close) remaps to the sidearms only, so a pistols-only round does not
    gain the shotgun; and a primary never remaps to a support weapon."""
    out = check_value("primary", {"choice": "player", "only_ids": ["glock"]})["only_ids"]
    assert out and all("sidearm" in _visible_types(w) for w in out), out
    for wid in sorted(_hidden()):
        try:
            v = check_value("primary", {"choice": "fixed", "fixed_id": wid})
        except PieceError:
            continue
        assert "support" not in _visible_types(v["fixed_id"]), (wid, v)


def test_a_session_policy_naming_only_the_smg_still_pushes():
    """brx1 (2026-11-02, F653 gap): a restored or saved config whose `loadout_policy` names only the hidden SMG
    emptied the primary pool and blocked the push. The policy VIEW remaps it; the stored config keeps the id."""
    s, net, clock, ps = mk_loadout_session(2, compiler=Compiler())
    s.config["loadout_policy"]["primary"] = {**s.config["loadout_policy"]["primary"], "choice": "player", "only_ids": ["smg"]}
    pool = s.loadout_pool()["primary"]
    assert pool and not set(pool) & _hidden(), pool
    assert s._primary_pool_refusal() is None
    assert s.config["loadout_policy"]["primary"]["only_ids"] == ["smg"], "the stored config must keep the hidden id"
    s.config["loadout_policy"]["primary"] = {**s.config["loadout_policy"]["primary"], "choice": "fixed", "fixed_id": "smg", "only_ids": []}
    assert s.loadout_pool()["primary"] and s._primary_pool_refusal() is None
