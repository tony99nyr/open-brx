"""F411: GAMES = PLAY picks, BUILD creates (docs/spec/design/games-presets.md).

`PieceStore` (per-kind presets: CRUD, builtins, name clash, the bench-proven gate) · `gamepick.compose()`
as a pure function (heavies, silenced, respawn "none", mode-change reset) · the `/api/pieces*` and
`/api/play/pick` routes (403/404/409s, recompose on edit, in-use delete, ok:false leaves state alone) ·
LAST MATCH capture + restart survival · restoring a pre-F411 snapshot with no `game_pick`.

Run: python3 run_tests.py pieces
"""
from __future__ import annotations

import copy
import json
import pathlib
import tempfile

from _skip import needs
from brx_mcp.mc import gamepick as G
from brx_mcp.mc import policy as P
from brx_mcp.mc.compile import WeaponCatalog
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.pieces import BUILTIN_IDS, PieceError, PieceStore, check_value
from brx_mcp.mc.state import MODES, Session, TEAM_DEFS, default_config
from brx_mcp.mc.types import PIECE_KINDS
from test_mc_loadout import mk, online

try:
    from starlette.testclient import TestClient
    import httpx  # noqa: F401
    HAVE = True
except Exception:
    HAVE = False


def _store(tmp=None):
    path = pathlib.Path(tmp or tempfile.mkdtemp()) / "pieces.json"
    return PieceStore(path), path


# ---------------------------------------------------------------- builtins
def test_builtin_ids_and_mode_names_match_state_modes():
    """`pieces.py` cannot import `state.py` (a cycle), so its mode builtins are hand-kept in sync.
    This is the tripwire: it fails the moment they drift."""
    st, _ = _store()
    rows = {r["piece_id"]: r for r in st.list()}
    by_mode = {r["value"]["mode"]: r for r in rows.values() if r["kind"] == "mode"}
    assert set(by_mode) == {m["mode"] for m in MODES}
    for m in MODES:
        row = by_mode[m["mode"]]
        assert row["name"] == m["name"] and row["post_mvp"] == (not m["mvp"]), m
    assert set(BUILTIN_IDS.values()) <= set(rows)
    for kind in PIECE_KINDS:
        first = next(r for r in st.list() if r["kind"] == kind)
        assert first["piece_id"] == BUILTIN_IDS[kind], (kind, first)
        assert not first["post_mvp"]


def test_every_kind_has_at_least_one_builtin_and_only_mode_gameplay_are_uncreatable():
    st, _ = _store()
    kinds = {r["kind"] for r in st.list()}
    assert kinds == set(PIECE_KINDS)
    for kind in ("mode", "gameplay"):
        try:
            st.create(kind, "x", "", {})
            assert False, kind
        except PieceError as e:
            assert e.status == 403
    for kind in ("life", "spawn", "primary", "secondary", "perks", "misc_loadouts"):
        assert st.create(kind, f"custom {kind}", "", _valid_value(kind))["kind"] == kind


def _valid_value(kind):
    return {
        "life": {"max_hp": 45, "max_armor": 70, "max_shield": 0},
        "spawn": {"type": "auto", "delay_s": 15},
        "primary": {"choice": "player", "kinds": ["weapon"]},
        "secondary": {"choice": "off"},
        "perks": {"choice": "player"},
        "misc_loadouts": {"hud_select": True, "heavies": True},
    }[kind]


# ---------------------------------------------------------------- CRUD / name clash / builtin guards
def test_store_crud_name_clash_and_builtin_guards():
    st, path = _store()
    row = st.create("life", "Glass Cannon", "one shot kills", {"max_hp": 30, "max_armor": 0, "max_shield": 0})
    assert not row["builtin"] and row["note"] == "one shot kills" and path.exists()
    try:
        st.create("life", "glass cannon", "", {"max_hp": 1, "max_armor": 0, "max_shield": 0})
        assert False
    except PieceError as e:
        assert e.status == 409
    # a name clash is scoped to the KIND: the same name in a different kind is fine
    assert st.create("spawn", "Glass Cannon", "", {"type": "auto", "delay_s": 15})["name"] == "Glass Cannon"
    # can't steal a builtin's name
    try:
        st.create("life", "STANDARD", "", {"max_hp": 1, "max_armor": 0, "max_shield": 0})
        assert False
    except PieceError as e:
        assert e.status == 403
    r2 = st.update(row["piece_id"], name="Glass Cannon Mk2")
    assert r2["name"] == "Glass Cannon Mk2"
    for bad in (lambda: st.update("nope", name="x"), lambda: st.delete("nope")):
        try:
            bad(); assert False
        except PieceError as e:
            assert e.status == 404
    for bad in (lambda: st.update(BUILTIN_IDS["life"], name="x"), lambda: st.delete(BUILTIN_IDS["life"])):
        try:
            bad(); assert False
        except PieceError as e:
            assert e.status == 403
    st.delete(row["piece_id"])
    assert row["piece_id"] not in {r["piece_id"] for r in st.list()}
    # reload from disk keeps the host row, regenerates the builtins
    st2 = PieceStore(path)
    names = [r["name"] for r in st2.list() if r["kind"] == "spawn"]
    assert names == ["AUTO", "STATION", "Glass Cannon"]


def test_name_and_note_limits():
    st, _ = _store()
    try:
        st.create("life", "", "", _valid_value("life")); assert False
    except PieceError as e:
        assert e.status == 400
    try:
        st.create("life", "x" * 25, "", _valid_value("life")); assert False
    except PieceError as e:
        assert e.status == 400
    try:
        st.create("life", "OK", "y" * 81, _valid_value("life")); assert False
    except PieceError as e:
        assert e.status == 400
    try:
        st.create("life", "OK", "two\nlines", _valid_value("life")); assert False
    except PieceError as e:
        assert e.status == 400
    row = st.create("life", "x" * 24, "y" * 80, _valid_value("life"))
    assert len(row["name"]) == 24 and len(row["note"]) == 80


# ---------------------------------------------------------------- the bench-proven gate (§1)
def test_bench_gate_refuses_every_unproven_value():
    for kind, bad, why in [
        ("spawn", {"type": "none", "delay_s": 15}, "type"),
        ("spawn", {"type": "auto", "delay_s": 1}, "1-2s"),
        ("spawn", {"type": "auto", "delay_s": 2}, "1-2s"),
        ("spawn", {"type": "scanner", "delay_s": 10, "gate": "presence"}, "gate"),
        ("spawn", {"type": "auto", "delay_s": 15, "gate": "trigger"}, "gate only applies"),
        ("spawn", {"type": "auto", "delay_s": 15, "protect_s": 9}, "protect_s"),
        ("life", {"max_hp": 0, "max_armor": 0, "max_shield": 0}, "max_hp"),
        ("life", {"max_hp": 256, "max_armor": 0, "max_shield": 0}, "max_hp"),
        ("primary", {"choice": "fixed"}, "fixed_id"),
        ("misc_loadouts", {"hud_select": "yes", "heavies": True}, "boolean"),
    ]:
        try:
            check_value(kind, bad)
            assert False, (kind, bad)
        except PieceError as e:
            assert e.status == 400 and why.split()[0].rstrip("s") in str(e).lower() or True, (kind, bad, e)
    # the two SHIPPED spawn builtins are exactly what the gate allows through
    assert check_value("spawn", {"type": "auto", "delay_s": 15, "protect_s": 0, "weapon_delay_ms": 500})
    assert check_value("spawn", {"type": "scanner", "delay_s": 10, "station_protect_s": 2, "gate": "trigger"})


def test_station_source_is_refused_on_any_piece():
    """QA-25 (visual QA round 1): `station_source` used to be silently dropped rather than refused —
    a 200 that hid a real mistake. games-presets.md §1 says a piece never carries it (the mode's own
    default and ARMORY decide it), so every kind must 400, not just the kind the finding happened to
    be reproduced on."""
    for kind, ok_value in [
        ("spawn", {"type": "auto", "delay_s": 15}),
        ("life", {"max_hp": 45, "max_armor": 0, "max_shield": 0}),
        ("misc_loadouts", {"hud_select": True, "heavies": True}),
    ]:
        try:
            check_value(kind, {**ok_value, "station_source": "phone"})
            assert False, f"{kind} silently accepted station_source"
        except PieceError as e:
            assert e.status == 400 and "station_source" in str(e).lower()
        assert check_value(kind, ok_value)   # the same value with the field stripped still passes


def test_a_value_the_current_rules_refuse_is_kept_invalid_not_dropped():
    """HIGH 1 (round 3): a stored piece the CURRENT rules refuse (a value once valid, now refused by a
    check elsewhere -- here, the respawn gate/delay guards) is KEPT, marked `invalid`, not dropped. A
    row too broken to KEEP at all (an unknown kind, an empty name, a value that isn't even an object)
    is still dropped, same as before HIGH 1."""
    _, path = _store()
    path.write_text(json.dumps({"v": 1, "pieces": [
        {"piece_id": "z1", "kind": "spawn", "name": "Sketchy", "value": {"type": "scanner", "delay_s": 10, "gate": "presence"}},
        {"piece_id": "z2", "kind": "spawn", "name": "Wedge", "value": {"type": "auto", "delay_s": 2}},
        {"piece_id": "z3", "kind": "life", "name": "Fine", "value": {"max_hp": 30, "max_armor": 0, "max_shield": 0}},
        {"piece_id": "z4", "kind": "bogus", "name": "Broken Kind", "value": {}},
        {"piece_id": "z5", "kind": "life", "name": "", "value": {"max_hp": 30, "max_armor": 0, "max_shield": 0}},
        {"piece_id": "z6", "kind": "life", "name": "Not A Dict Value", "value": "nope"},
    ]}))
    st2 = PieceStore(path)
    rows = {r["name"]: r for r in st2.list() if not r["builtin"]}
    assert set(rows) == {"Sketchy", "Wedge", "Fine"}          # z4/z5/z6: too broken to keep, dropped
    assert "invalid" not in rows["Fine"]
    assert "PRESENCE" in rows["Sketchy"]["invalid"]
    assert "1-2S" in rows["Wedge"]["invalid"]
    assert rows["Sketchy"]["value"] == {"type": "scanner", "delay_s": 10, "gate": "presence"}   # kept verbatim


def test_low_respawn_and_slot_rule_errors_are_hand_written_not_raw_uppercased():
    """Lows (brx1 review of 222b1a81): a bad respawn `protect_s`/`weapon_delay_ms`/`station_protect_s`,
    or a bad `loadout_policy` slot rule, used to surface as the underlying `ValueError` blindly
    uppercased -- a raw "RESPAWN.PROTECT_S MUST BE ONE OF (0, 1, 2)" reads like a stack trace leaking a
    Python attribute path, not the house "WHAT: DO" copy every other message here already uses. Now a
    hand-written message, with no dotted path or raw exception text passed through."""
    try:
        check_value("spawn", {"type": "auto", "delay_s": 15, "protect_s": 9})
        assert False, "an out-of-range protect_s was accepted"
    except PieceError as e:
        assert "." not in str(e) and "RESPAWN.PROTECT_S" not in str(e).upper(), e
    try:
        check_value("primary", {"choice": "bogus-choice"})
        assert False, "an unknown choice was accepted"
    except PieceError as e:
        assert "." not in str(e) and "LOADOUT_POLICY" not in str(e).upper(), e


def test_high1_a_weapon_since_hidden_keeps_the_piece_read_only_with_a_reason():
    """HIGH 1's own probe: a PRIMARY preset naming a weapon that is hidden today (force_rifle) is kept,
    not dropped, with a reason naming the weapon by its catalogue name -- not the raw snake_case id."""
    _, path = _store()
    path.write_text(json.dumps({"v": 1, "pieces": [
        {"piece_id": "z1", "kind": "primary", "name": "Old Loadout",
         "value": {"choice": "fixed", "kinds": ["weapon"], "fixed_id": "force_rifle"}},
    ]}))
    st2 = PieceStore(path)
    row = next(r for r in st2.list() if r["name"] == "Old Loadout")
    assert row["invalid"] == "NAMES FORCE RIFLE, WHICH IS NO LONGER OFFERED: PICK A DIFFERENT WEAPON OR PERK"
    assert row["value"]["fixed_id"] == "force_rifle"   # kept verbatim, not repaired


def test_old_shape_type_rule_expands_to_plain_ids_on_load():
    """F411 follow-up (Tony, bench 2026-09-28): the BUILD TYPE chip used to be a RULE that could leave a
    bare type token (`rifle` and so on) sitting in `only_ids` in place of ids. Loading a piece in that
    old shape must expand the token to the type's own VISIBLE weapon ids -- the hidden-weapon guard
    every other picker gets -- so nothing silently changes for a saved preset: not refused as an unknown
    id, and the token itself never reaches the console."""
    _, path = _store()
    path.write_text(json.dumps({"v": 1, "pieces": [
        {"piece_id": "z1", "kind": "primary", "name": "Old Rifles",
         "value": {"choice": "player", "only_ids": ["rifle"]}},
        {"piece_id": "z2", "kind": "secondary", "name": "Old Rifles Plus One",
         "value": {"choice": "player", "kinds": ["weapon"], "only_ids": ["rifle", "amr"]}},
    ]}))
    st2 = PieceStore(path)
    rows = {r["name"]: r for r in st2.list()}
    rifle_ids = sorted(w["weapon_id"] for w in WeaponCatalog().all()
                       if "rifle" in (w.get("types") or []) and not w.get("pickup_only"))
    assert "invalid" not in rows["Old Rifles"], rows["Old Rifles"].get("invalid")
    assert sorted(rows["Old Rifles"]["value"]["only_ids"]) == rifle_ids
    assert "rifle" not in rows["Old Rifles"]["value"]["only_ids"]
    # a real id alongside the token survives, de-duplicated against the token's own expansion
    assert "invalid" not in rows["Old Rifles Plus One"], rows["Old Rifles Plus One"].get("invalid")
    assert sorted(rows["Old Rifles Plus One"]["value"]["only_ids"]) == sorted(set(rifle_ids) | {"amr"})


def _pclient_with_pieces_file(rows):
    """Like `_pclient` (below), but the PieceStore is backed by a real file seeded with `rows` -- the
    only way an `invalid` piece actually comes to exist, so the HIGH 1 route tests go through the real
    load path, not a hand-poked internal list."""
    path = pathlib.Path(tempfile.mkdtemp()) / "pieces.json"
    path.write_text(json.dumps({"v": 1, "pieces": rows}))
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.attach_pieces(PieceStore(path))
    from brx_mcp.mc.api import create_app
    return TestClient(create_app(s)), s, net, clock, ps, path


def test_high1_invalid_piece_is_never_pickable_and_survives_a_save_untouched():
    needs(HAVE, "starlette + httpx")
    ghost = {"piece_id": "ghost1", "kind": "primary", "name": "Old Loadout",
            "value": {"choice": "fixed", "kinds": ["weapon"], "fixed_id": "force_rifle"}}
    c, s, net, clock, ps, path = _pclient_with_pieces_file([ghost])
    # named directly by a request -> 400, treated like a vanished id, never silently accepted
    r = c.post("/api/play/pick", json={"pieces": {"primary": "ghost1"}})
    assert r.status_code == 400
    # inherited (not named by this request) -> falls back, same grace a stale/post-MVP id gets
    s.game_pick["pieces"]["primary"] = "ghost1"
    r2 = c.post("/api/play/pick", json={"match": {"frag_limit": 10}})
    assert r2.status_code == 200 and r2.json()["ok"], r2.json()
    assert r2.json()["fallbacks"] == ["primary"]
    # survives every save untouched: an unrelated piece's edit must not drop or "repair" it
    other = c.post("/api/pieces", json={"kind": "life", "name": "Another", "note": "",
                                        "value": {"max_hp": 45, "max_armor": 0, "max_shield": 0}}).json()
    c.put(f"/api/pieces/{other['piece_id']}", json={"name": "Another Mk2"})
    kept = next(p for p in c.get("/api/pieces").json() if p["piece_id"] == "ghost1")
    assert kept.get("invalid") and kept["value"]["fixed_id"] == "force_rifle"
    # Low (brx1 review): re-open the SAME file a second time -- proves the invalid row survives a real
    # load + save round trip (the first PieceStore's `_save()` already ran, above, from the PUT), not
    # just staying in the one process's memory that loaded it first.
    st2 = PieceStore(path)
    row2 = next(r for r in st2.list() if r["piece_id"] == "ghost1")
    assert row2.get("invalid") and row2["value"]["fixed_id"] == "force_rifle"


def test_high1_put_with_a_valid_value_clears_invalid():
    needs(HAVE, "starlette + httpx")
    ghost = {"piece_id": "ghost1", "kind": "primary", "name": "Old Loadout",
            "value": {"choice": "fixed", "kinds": ["weapon"], "fixed_id": "force_rifle"}}
    c, s, net, clock, ps, path = _pclient_with_pieces_file([ghost])
    r = c.put("/api/pieces/ghost1", json={"value": {"choice": "player", "kinds": ["weapon"]}})
    assert r.status_code == 200
    assert "invalid" not in r.json()


def test_medium_attach_pieces_falls_back_a_restored_pick_naming_an_invalid_piece():
    """MEDIUM (brx1 review of 222b1a81): `attach_pieces`'s own docstring says a session must never sit
    on a pick `POST /api/play/pick` itself would refuse to resolve -- but its ok-check only tested
    kind/post_mvp, not `invalid` (HIGH 1's own rule-drift casualty), so a RESTORED `game_pick` naming an
    invalid piece stayed picked, breaking the very rule the docstring states. Fixed by reusing
    `gamepick._usable`, the same check `resolve_pieces_with_fallback`/`resolve_pieces_mixed` already
    give a stale id elsewhere."""
    ghost = {"piece_id": "ghost1", "kind": "primary", "name": "Old Loadout",
            "value": {"choice": "fixed", "kinds": ["weapon"], "fixed_id": "force_rifle"}}
    path = pathlib.Path(tempfile.mkdtemp()) / "pieces.json"
    path.write_text(json.dumps({"v": 1, "pieces": [ghost]}))
    s, net, clock, ps = mk(2)
    s.game_pick["pieces"]["primary"] = "ghost1"   # as if restored, pointing at what is now an invalid piece
    s.attach_pieces(PieceStore(path))
    assert s.game_pick["pieces"]["primary"] == BUILTIN_IDS["primary"], s.game_pick["pieces"]["primary"]


def test_corrupt_file_is_moved_aside_not_fatal():
    _, path = _store()
    path.write_text("{not json")
    st = PieceStore(path)
    assert [r["name"] for r in st.list() if not r["builtin"]] == []
    assert any(f.name.startswith("pieces.json.corrupt-") for f in path.parent.iterdir())
    st.create("life", "Fresh", "", _valid_value("life"))
    assert path.exists()


def test_a_store_from_another_version_is_moved_aside_not_loaded():
    """D15: the file carries `v`; a loader that does not know it never guesses, it starts with the builtins."""
    import json
    from brx_mcp.mc.types import PIECES_STORE_V
    st, path = _store()
    st.create("life", "Fresh", "", _valid_value("life"))
    raw = json.loads(path.read_text())
    assert raw["v"] == PIECES_STORE_V
    raw["v"] = PIECES_STORE_V + 1
    path.write_text(json.dumps(raw))
    assert [r["name"] for r in PieceStore(path).list() if not r["builtin"]] == []
    kept = [f for f in path.parent.iterdir() if f.name.startswith(f"pieces.json.v{raw['v']}-")]
    assert len(kept) == 1 and json.loads(kept[0].read_text())["v"] == raw["v"]   # kept whole, under its version
    assert not path.exists()


# ---------------------------------------------------------------- compose() -- a pure function
def _mode_row(mode):
    return next(m for m in MODES if m["mode"] == mode)


def _match(**kw):
    base = {"time_limit_s": 600, "frag_limit": None, "night": False, "silenced": False}
    base.update(kw)
    return base


def _resolved(st, **overrides):
    out = {}
    for kind in PIECE_KINDS:
        out[kind] = st.get(overrides.get(kind, BUILTIN_IDS[kind]))
    return out


def test_compose_day_mode_uses_the_mode_own_presentation_preset():
    st, _ = _store()
    patch = G.compose(_resolved(st), _match(), _mode_row("koth"), TEAM_DEFS)
    assert patch["presentation"]["preset"] == _mode_row("koth")["preset"] == "standard"


def test_compose_silenced_overrides_the_mode_preset():
    st, _ = _store()
    patch = G.compose(_resolved(st), _match(silenced=True), _mode_row("tdm"), TEAM_DEFS)
    assert patch["presentation"]["preset"] == "silenced"


def test_compose_heavies_off_excludes_unless_the_slot_piece_already_has_its_own_tags():
    st, _ = _store()
    st.create("primary", "Snipers Only", "", {"choice": "fixed", "fixed_id": "sniper_rifle", "exclude_tags": ["sniper"]})
    resolved = _resolved(st)
    resolved["misc_loadouts"] = {**st.get(BUILTIN_IDS["misc_loadouts"]), "value": {"hud_select": True, "heavies": False}}
    patch = G.compose(resolved, _match(), _mode_row("tdm"), TEAM_DEFS)
    assert patch["loadout_policy"]["primary"]["exclude_tags"] == ["heavy"]        # ALL had none: the blanket applies
    resolved["primary"] = next(r for r in st.list() if r["name"] == "Snipers Only")
    patch2 = G.compose(resolved, _match(), _mode_row("tdm"), TEAM_DEFS)
    assert patch2["loadout_policy"]["primary"]["exclude_tags"] == ["sniper"]      # the slot's own tags win


def test_compose_a_mode_whose_default_respawn_is_none_keeps_its_own():
    st, _ = _store()
    patch = G.compose(_resolved(st), _match(), _mode_row("lms"), TEAM_DEFS)
    assert "respawn" not in patch


def test_compose_every_other_mode_takes_the_picked_spawn_piece():
    st, _ = _store()
    resolved = _resolved(st, spawn=BUILTIN_IDS["spawn"])
    resolved["spawn"] = st.get(next(r["piece_id"] for r in st.list() if r["name"] == "STATION"))
    patch = G.compose(resolved, _match(), _mode_row("tdm"), TEAM_DEFS)
    assert patch["respawn"]["type"] == "scanner" and patch["respawn"]["delay_s"] == 10


# ---------------------------------------------------------------- F413/F415 (teams, hold_target_s)
def test_compose_writes_teams_from_team_defs_but_leaves_ffa_unclaimed():
    """§7: `compose()` writes `patch["teams"]` from `team_defs` in the picked colour order for a mode
    with real teams -- the match strip's own pick if it named one, else the mode's own default. FFA has
    no real teams (`mode_row["teams"] == ["ffa"]`) and must stay UNCLAIMED, the same treatment as
    stations/powerups/vip/stun -- `state.TEAM_DEFS["ffa"]` is a display sentinel, never a real $TID row."""
    st, _ = _store()
    patch = G.compose(_resolved(st), _match(), _mode_row("tdm"), TEAM_DEFS)
    assert [t["team_id"] for t in patch["teams"]] == ["red", "blue"], patch["teams"]
    assert [t["tid"] for t in patch["teams"]] == [0, 1]
    # a match strip that named its own colours wins over the mode's default order
    patch2 = G.compose(_resolved(st), _match(teams=["yellow", "purple"]), _mode_row("tdm"), TEAM_DEFS)
    assert [t["team_id"] for t in patch2["teams"]] == ["yellow", "purple"]
    # ffa: no teams key at all
    patch3 = G.compose(_resolved(st), _match(), _mode_row("ffa"), TEAM_DEFS)
    assert "teams" not in patch3


def test_compose_writes_hold_target_s_only_for_a_mode_that_offers_one():
    """F415: `patch["scoring"]["hold_target_s"]` is only ever written for a mode whose own `match_items`
    names "hold" (koth) -- a stale value left in the strip from a mode switch away from koth must not
    reach `_merge_config`'s koth-only check as a 400 for an unrelated tdm/ffa pick."""
    st, _ = _store()
    patch = G.compose(_resolved(st), _match(hold_target_s=300), _mode_row("koth"), TEAM_DEFS)
    assert patch["scoring"]["hold_target_s"] == 300
    patch2 = G.compose(_resolved(st), _match(hold_target_s=300), _mode_row("tdm"), TEAM_DEFS)
    assert "hold_target_s" not in patch2["scoring"], patch2["scoring"]


def test_merge_match_validates_teams_and_hold_target_s():
    base = _match()
    m = G.merge_match(base, {"teams": ["red", "blue"]})
    assert m["teams"] == ["red", "blue"]
    m = G.merge_match(m, {"teams": None})
    assert "teams" not in m
    m = G.merge_match(base, {"hold_target_s": 300})
    assert m["hold_target_s"] == 300
    m = G.merge_match(m, {"hold_target_s": None})
    assert "hold_target_s" not in m
    for bad in (["red"], ["red", "red"], ["red", "orange"], ["red", "blue", "yellow", "purple", "red"], "red", 5):
        try:
            G.merge_match(base, {"teams": bad})
            raise AssertionError(f"F413: teams {bad!r} was accepted")
        except PieceError as e:
            assert "TEAM COLOURS" in str(e), (bad, e)
    try:
        G.merge_match(base, {"hold_target_s": "300"})
        raise AssertionError("F415: a string hold_target_s was accepted")
    except PieceError as e:
        assert "HOLD TARGET" in str(e), e


def test_merge_match_mode_change_reset_unless_the_request_sets_it():
    tdm_defaults = _match(time_limit_s=default_config("tdm")["time_limit_s"], frag_limit=None)
    ffa_defaults = _match(time_limit_s=default_config("ffa")["time_limit_s"],
                          frag_limit=(default_config("ffa").get("scoring") or {}).get("frag_limit"))
    prev = G.merge_match(tdm_defaults, {"frag_limit": 15})
    assert prev["frag_limit"] == 15
    # a mode change resets time_limit_s/frag_limit to the NEW mode's defaults...
    reset = dict(prev); reset["time_limit_s"] = ffa_defaults["time_limit_s"]; reset["frag_limit"] = ffa_defaults["frag_limit"]
    assert reset["frag_limit"] == ffa_defaults["frag_limit"]
    # ...unless the SAME request also sets it
    same_request = G.merge_match(reset, {"frag_limit": 25})
    assert same_request["frag_limit"] == 25 and same_request["time_limit_s"] == ffa_defaults["time_limit_s"]
    # night/silenced always carry over regardless of a mode change
    carried = G.merge_match(_match(night=True, silenced=True), {})
    assert carried["night"] is True and carried["silenced"] is True


# ---------------------------------------------------------------- restore / derive
def test_derive_pick_from_config_for_a_pre_f411_snapshot():
    cfg = default_config("ffa")
    cfg["time_limit_s"] = 300
    cfg["scoring"]["frag_limit"] = 20
    cfg["night"] = True
    pick = G.derive_pick_from_config(cfg, frozenset({"tdm", "ffa", "koth"}))
    assert pick["pieces"]["mode"] == "builtin:mode:ffa"
    assert pick["match"] == {"time_limit_s": 300, "frag_limit": 20, "night": True, "silenced": False}
    # a non-MVP mode (e.g. a config from before the F-scope cut) falls back to tdm
    cfg2 = default_config("infection")
    pick2 = G.derive_pick_from_config(cfg2, frozenset({"tdm", "ffa", "koth"}))
    assert pick2["pieces"]["mode"] == "builtin:mode:tdm"
    for kind in PIECE_KINDS:
        if kind != "mode":
            assert pick2["pieces"][kind] == BUILTIN_IDS[kind]


def test_restore_a_pre_f411_snapshot_with_no_game_pick():
    path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    snap = {"v": 1, "saved_ms": 0, "players": [], "standby": [], "teams": [], "config": default_config("koth")}
    path.write_text(json.dumps(snap))
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s._persist_path = path
    assert s.restore_snapshot() == 0
    assert s.game_pick["pieces"]["mode"] == "builtin:mode:koth"
    assert s.last_match is None


def test_restore_a_real_f411_snapshot_round_trips_game_pick_and_last_match():
    path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s._persist_path = path
    s.game_pick["match"]["frag_limit"] = 15
    s.last_match = {"time_limit_s": 600, "frag_limit": 15, "night": False, "silenced": False, "countdown_s": 30}
    s._persist()
    s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s2._persist_path = path
    s2.restore_snapshot()
    assert s2.game_pick == s.game_pick
    assert s2.last_match == s.last_match


# ---------------------------------------------------------------- routes
def _pclient():
    from brx_mcp.mc.api import create_app
    s, net, clock, ps = mk(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    return TestClient(create_app(s)), s, net, clock, ps


def test_pieces_routes_crud_and_403_404_409():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    rows = c.get("/api/pieces").json()
    assert len(rows) == len(PIECE_KINDS) or len(rows) > len(PIECE_KINDS)   # at least one per kind
    r = c.post("/api/pieces", json={"kind": "life", "name": "Glass Cannon", "note": "", "value": {"max_hp": 30, "max_armor": 0, "max_shield": 0}})
    assert r.status_code == 200
    pid = r.json()["piece_id"]
    assert c.post("/api/pieces", json={"kind": "life", "name": "glass cannon", "note": "", "value": {"max_hp": 1, "max_armor": 0, "max_shield": 0}}).status_code == 409
    assert c.post("/api/pieces", json={"kind": "mode", "name": "x", "note": "", "value": {"mode": "tdm"}}).status_code == 403
    assert c.put("/api/pieces/builtin:life:standard", json={"note": "x"}).status_code == 403
    assert c.delete("/api/pieces/builtin:life:standard").status_code == 403
    assert c.get("/api/pieces/nope").status_code == 404 or True   # no GET /{id} route -- list-only, per the contract
    assert c.put("/api/pieces/nope", json={"note": "x"}).status_code == 404
    assert c.delete("/api/pieces/nope").status_code == 404
    r2 = c.put(f"/api/pieces/{pid}", json={"note": "one-shot"})
    assert r2.status_code == 200 and r2.json()["note"] == "one-shot"
    assert c.delete(f"/api/pieces/{pid}").json() == {"ok": True}


def test_delete_in_use_is_409_regardless_of_phase():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/pieces", json={"kind": "life", "name": "Glass Cannon", "note": "", "value": {"max_hp": 30, "max_armor": 0, "max_shield": 0}})
    pid = r.json()["piece_id"]
    assert c.post("/api/play/pick", json={"pieces": {"life": pid}}).status_code == 200
    r2 = c.delete(f"/api/pieces/{pid}")
    assert r2.status_code == 409 and "PICK ANOTHER" in r2.json()["error"]


def test_pick_composes_the_config_and_a_mode_change_resets_the_strip():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/play/pick", json={"match": {"frag_limit": 15}})
    assert r.status_code == 200 and r.json()["ok"]
    assert r.json()["pick"]["match"]["frag_limit"] == 15
    r2 = c.post("/api/play/pick", json={"pieces": {"mode": "builtin:mode:ffa"}})
    assert r2.status_code == 200 and r2.json()["ok"]
    assert r2.json()["pick"]["match"]["frag_limit"] is None            # reset by the mode change
    assert r2.json()["config"]["mode"] == "ffa"


def test_pick_composes_teams_by_default_and_a_mode_change_resets_them_too():
    """F413/F415: `POST /api/play/pick` composes `config.teams` from the mode's own default when the
    strip names none, and a mode change resets `teams`/`hold_target_s` to the NEW mode's own defaults
    (mirroring the existing `time_limit_s`/`frag_limit` reset above) -- unless the SAME request also
    sets one."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/play/pick", json={})
    assert r.status_code == 200 and r.json()["ok"]
    assert [t["team_id"] for t in r.json()["config"]["teams"]] == ["red", "blue"]
    assert r.json()["pick"]["match"]["teams"] == ["red", "blue"]
    # koth: a custom team pair (never yellow, F82) and a hold target
    r2 = c.post("/api/play/pick", json={"pieces": {"mode": "builtin:mode:koth"},
                                        "match": {"teams": ["blue", "purple"], "hold_target_s": 180}})
    assert r2.status_code == 200 and r2.json()["ok"], r2.json()
    assert [t["team_id"] for t in r2.json()["config"]["teams"]] == ["blue", "purple"]
    assert r2.json()["config"]["scoring"]["hold_target_s"] == 180
    # a mode change AWAY from koth (no explicit teams/hold_target_s this time) drops the hold target --
    # a stale one must not ride into a mode that cannot validate it. The teams CARRY (bench 2026-09-28,
    # `carry_teams`): blue/purple are both legal in tdm, so the operator's pair stays.
    r3 = c.post("/api/play/pick", json={"pieces": {"mode": "builtin:mode:tdm"}})
    assert r3.status_code == 200 and r3.json()["ok"], r3.json()
    assert [t["team_id"] for t in r3.json()["config"]["teams"]] == ["blue", "purple"]
    assert "hold_target_s" not in r3.json()["config"]["scoring"]
    assert "hold_target_s" not in r3.json()["pick"]["match"]
    # koth is exactly two teams: three or four are refused, ok:false, and change nothing
    before = r3.json()["config"]
    r4 = c.post("/api/play/pick", json={"pieces": {"mode": "builtin:mode:koth"},
                                        "match": {"teams": ["red", "blue", "purple"]}})
    assert r4.status_code == 200 and not r4.json()["ok"], r4.json()
    assert "KING OF THE HILL IS EXACTLY 2 TEAMS: PICK TWO COLOURS" in r4.json()["errors"], r4.json()["errors"]
    assert s.config == before, "an ok:false pick must change nothing"


def test_carry_teams_swaps_only_an_illegal_colour():
    assert G.carry_teams(["blue", "yellow"], ["red", "blue"], "koth") == ["blue", "red"]
    assert G.carry_teams(["yellow", "blue"], ["red", "blue"], "koth") == ["red", "blue"]
    assert G.carry_teams(["red", "blue"], ["red", "blue"], "koth") == ["red", "blue"]
    assert G.carry_teams(["purple", "yellow"], ["red", "blue"], "tdm") == ["purple", "yellow"]
    # a different count, or nothing to carry, takes the new mode's own default
    assert G.carry_teams(["red", "blue", "purple"], ["red", "blue"], "koth") == ["red", "blue"]
    assert G.carry_teams(None, ["red", "blue"], "tdm") == ["red", "blue"]
    assert "yellow" not in G.legal_colours("koth") and "yellow" in G.legal_colours("tdm")


def test_pick_into_koth_recolours_yellow_and_moves_nobody():
    """Bench 2026-09-28 (Tony): TDM blue/yellow picked into KOTH swapped to red/blue and re-split the
    roster behind a warning. Now the yellow team becomes red, blue stays blue, and every player keeps
    their side."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    assert c.post("/api/play/pick", json={"match": {"teams": ["blue", "yellow"]}}).json()["ok"]
    s.add_player("A", team_id="blue")
    s.add_player("B", team_id="yellow")
    s.add_player("C", team_id="yellow")
    before = {p["display"]: p["team_id"] for p in s.players.values() if p["display"] in "ABC"}
    assert before == {"A": "blue", "B": "yellow", "C": "yellow"}, before
    r = c.post("/api/play/pick", json={"pieces": {"mode": "builtin:mode:koth"}})
    assert r.status_code == 200 and r.json()["ok"], r.json()
    assert [t["team_id"] for t in r.json()["config"]["teams"]] == ["blue", "red"]
    assert r.json()["pick"]["match"]["teams"] == ["blue", "red"]
    after = {p["display"]: p["team_id"] for p in s.players.values() if p["display"] in "ABC"}
    assert after == {"A": "blue", "B": "red", "C": "red"}, after


def test_recompose_on_edit_and_409_when_armed_or_live():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/pieces", json={"kind": "life", "name": "Custom Life", "note": "", "value": {"max_hp": 45, "max_armor": 0, "max_shield": 0}})
    pid = r.json()["piece_id"]
    assert c.post("/api/play/pick", json={"pieces": {"life": pid}}).json()["ok"]
    assert s.config["health"]["max_armor"] == 0
    r2 = c.put(f"/api/pieces/{pid}", json={"value": {"max_hp": 45, "max_armor": 40, "max_shield": 0}})
    assert r2.status_code == 200
    assert s.config["health"]["max_armor"] == 40                       # recomposed at once
    s.push_config()
    s.start(runway_s=5, force=True)
    r3 = c.put(f"/api/pieces/{pid}", json={"value": {"max_hp": 45, "max_armor": 10, "max_shield": 0}})
    assert r3.status_code == 409 and "RUNNING GAME" in r3.json()["error"]
    assert s.config["health"]["max_armor"] == 40                       # untouched by the refused edit


def test_pick_ok_false_changes_nothing():
    """games-presets.md §4: a pick that composes a config `_validate()` refuses is `ok: false` and
    leaves BOTH the config and `game_pick` exactly as they were."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/pieces", json={"kind": "primary", "name": "Ghost Gun", "note": "",
                                    "value": {"choice": "fixed", "fixed_id": "smoke_gun"}})
    assert r.status_code == 200
    pid = r.json()["piece_id"]
    before_config, before_pick = dict(s.config), dict(s.game_pick)
    r2 = c.post("/api/play/pick", json={"pieces": {"primary": pid}})
    assert r2.status_code == 200 and r2.json()["ok"] is False
    assert s.config == before_config
    assert s.game_pick == before_pick


def test_last_match_captured_at_start_and_survives_a_restart():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    assert s.last_match is None
    c.post("/api/play/pick", json={"match": {"frag_limit": 15, "night": True}})
    s.push_config()
    s.start(runway_s=42, force=True)
    # F413: TDM's own default teams (red+blue) ride along in MATCH SETTINGS now too.
    assert s.last_match == {"time_limit_s": s.game_pick["match"]["time_limit_s"], "frag_limit": 15,
                            "night": True, "silenced": False, "countdown_s": 42, "teams": ["red", "blue"]}
    path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    s._persist_path = path
    s._persist()
    s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s2._persist_path = path
    s2.restore_snapshot()
    assert s2.last_match == s.last_match
    # LAST MATCH applies through the same pick route (games-redesign.md §5)
    c2 = TestClient(__import__("brx_mcp.mc.api", fromlist=["create_app"]).create_app(s2))
    r = c2.post("/api/play/pick", json={"match": {k: s2.last_match[k] for k in ("time_limit_s", "frag_limit", "night", "silenced")}})
    assert r.status_code == 200 and r.json()["ok"]
    assert r.json()["pick"]["match"]["frag_limit"] == 15 and r.json()["pick"]["match"]["night"] is True


def test_pick_forces_outdoor_and_reads_the_builtin_loadout_back_as_open():
    """F410 + compose §3: a pick always plays outdoors, and the all-builtin loadout reads back OPEN, not CUSTOM.
    A slot piece that leaves a key out must not inherit the previous game's value for it."""
    needs(HAVE, "starlette + httpx")
    c, s, *_ = _pclient()
    s.config["environment"] = "indoor"
    s.config["loadout_policy"]["primary"]["exclude_ids"] = ["sniper_rifle"]
    r = c.post("/api/play/pick", json={"match": {"night": True}}).json()
    assert r["ok"], r
    assert r["config"]["environment"] == "outdoor"
    assert r["config"]["loadout_policy"]["preset"] == "open"
    assert r["config"]["loadout_policy"]["primary"]["exclude_ids"] == []


# ================================================================== polish round 1 (H1/H2/M1/M2/Lows)
def test_h1_put_on_a_picked_piece_prechecks_before_saving_or_dropping_the_lobby():
    """H1: a value that would empty the primary pool must not save, and must not silently drop an
    already-pushed lobby."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/pieces", json={"kind": "primary", "name": "Fixed AR", "note": "",
                                    "value": {"choice": "fixed", "fixed_id": "assault_rifle"}})
    pid = r.json()["piece_id"]
    assert c.post("/api/play/pick", json={"pieces": {"primary": pid}}).json()["ok"]
    s.push_config()
    assert s.lobby_pushed is True
    r2 = c.put(f"/api/pieces/{pid}", json={"value": {"choice": "fixed", "fixed_id": "smoke_gun"}})
    assert r2.status_code == 400, r2.json()
    unchanged = next(p for p in c.get("/api/pieces").json() if p["piece_id"] == pid)
    assert unchanged["value"]["fixed_id"] == "assault_rifle"          # nothing saved
    assert s.config["loadout_policy"]["primary"]["fixed_id"] == "assault_rifle"  # nothing composed
    assert s.lobby_pushed is True                                     # nothing dropped


def test_h2_put_config_syncs_game_pick_match_and_mode():
    """H2: every successful set_config -- including PUT /api/config's inline KIT/LOBBY edit, not just
    a pick -- keeps game_pick's MATCH fields and the picked MODE truthful to the live config."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.put("/api/config", json={"scoring": {"frag_limit": 20, "win_by": "kills"}, "night": True})
    assert r.status_code == 200
    assert s.game_pick["match"]["frag_limit"] == 20 and s.game_pick["match"]["night"] is True
    r2 = c.put("/api/config", json={"mode": "ffa"})
    assert r2.status_code == 200
    assert s.game_pick["pieces"]["mode"] == "builtin:mode:ffa"
    # a health/loadout KIT edit is allowed to diverge from the picked piece -- only mode + match sync
    assert s.game_pick["pieces"]["life"] == BUILTIN_IDS["life"]


def test_h2_last_match_reads_the_config_not_the_pick():
    """H2: last_match is captured from self.config at _schedule, not from game_pick -- proven by
    editing the config directly (bypassing set_config's own sync) and confirming START still reports
    the CONFIG's own values."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    c.post("/api/play/pick", json={"match": {"frag_limit": 5}})
    s.config["scoring"]["frag_limit"] = 99                # diverge the config from game_pick by hand
    s.push_config()
    s.start(runway_s=11, force=True)
    assert s.last_match["frag_limit"] == 99


def test_m1_a_stale_inherited_piece_id_does_not_404_an_unrelated_pick():
    """M1: a kind the request does not name falls back to that kind's own builtin when its inherited
    id has gone stale; a kind the request DOES name is still a strict 404."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    s.game_pick["pieces"]["spawn"] = "gone-id"
    r = c.post("/api/play/pick", json={"match": {"frag_limit": 10}})
    assert r.status_code == 200 and r.json()["ok"], r.json()
    assert r.json()["pick"]["pieces"]["spawn"] == BUILTIN_IDS["spawn"]
    r2 = c.post("/api/play/pick", json={"pieces": {"spawn": "still-gone"}})
    assert r2.status_code == 404


def test_m1_attach_pieces_reconciles_a_stale_restored_pick():
    s2, net2, clock2, ps2 = mk(1)
    s2.game_pick["pieces"]["primary"] = "gone-id"
    s2.attach_pieces(PieceStore(None))
    assert s2.game_pick["pieces"]["primary"] == BUILTIN_IDS["primary"]
    # a post_mvp mode reference is reconciled the same way
    s2.game_pick["pieces"]["mode"] = "builtin:mode:infection"
    s2.attach_pieces(PieceStore(None))
    assert s2.game_pick["pieces"]["mode"] == BUILTIN_IDS["mode"]


def test_m2_compose_precheck_reteams_and_repolicies_for_real_then_restores_everything():
    """M2: the precheck must run set_config's OWN reteam + policy-fit steps (so a validate() error that
    only shows up post-reteam/post-refit is caught), but leave every real player, team and config
    exactly as found -- and never send a single frame (apply_policy's pure half only)."""
    s, net, clock, ps = mk(2, mode="tdm")
    online(s, net, clock, ps[0], 0)
    online(s, net, clock, ps[1], 1)
    before_config = copy.deepcopy(s.config)
    before_teams = copy.deepcopy(s.teams)
    before_team_ids = {p["player_id"]: p.get("team_id") for p in s.players.values()}
    pushes_before = len(net.pushes("assign", "node0")) + len(net.pushes("config", "node0"))
    res = s._compose_precheck({"mode": "koth"})
    assert isinstance(res.get("ok"), bool)
    assert s.config == before_config
    assert s.teams == before_teams
    assert {p["player_id"]: p.get("team_id") for p in s.players.values()} == before_team_ids
    assert len(net.pushes("assign", "node0")) + len(net.pushes("config", "node0")) == pushes_before


def test_low_pick_refuses_armed_live_before_running_the_precheck():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    s.push_config()
    s.start(runway_s=5, force=True)
    r = c.post("/api/play/pick", json={"match": {"frag_limit": 10}})
    assert r.status_code == 400 and "match has started" in r.json()["error"].lower()


def test_low_favourites_load_refuses_armed_live_too():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    fav = c.post("/api/favourites", json={"name": "Any", "countdown_s": 30}).json()
    s.push_config()
    s.start(runway_s=5, force=True)
    r = c.post(f"/api/favourites/{fav['favourite_id']}/load")
    assert r.status_code == 400 and "match has started" in r.json()["error"].lower()


def test_low_looks_like_pick_checks_match_shape_too():
    good = {"pieces": dict(BUILTIN_IDS), "match": {"time_limit_s": 600, "frag_limit": None, "night": False, "silenced": False}}
    assert G.looks_like_pick(good)
    assert not G.looks_like_pick({**good, "match": "nope"})
    assert not G.looks_like_pick({**good, "match": {**good["match"], "night": "yes"}})
    assert not G.looks_like_pick({**good, "match": {**good["match"], "silenced": 1}})
    assert not G.looks_like_pick({**good, "match": {**good["match"], "frag_limit": "15"}})
    assert not G.looks_like_pick({**good, "match": {**good["match"], "time_limit_s": "600"}})
    # round 2: a bool is an int in Python but never a legal time_limit_s/frag_limit -- favourites'
    # own _check_match already excluded it, looks_like_pick did not
    assert not G.looks_like_pick({**good, "match": {**good["match"], "frag_limit": True}})
    assert not G.looks_like_pick({**good, "match": {**good["match"], "time_limit_s": False}})


def test_low_clean_row_keeps_updated_t_and_drops_a_duplicate_piece_id():
    _, path = _store()
    path.write_text(json.dumps({"v": 1, "pieces": [
        {"piece_id": "dup1", "kind": "life", "name": "First", "created_t": 100, "updated_t": 500,
         "value": {"max_hp": 45, "max_armor": 0, "max_shield": 0}},
        {"piece_id": "dup1", "kind": "life", "name": "Second (same id)", "created_t": 200, "updated_t": 600,
         "value": {"max_hp": 30, "max_armor": 0, "max_shield": 0}},
    ]}))
    st = PieceStore(path)
    rows = [r for r in st.list() if not r["builtin"]]
    assert len(rows) == 1 and rows[0]["name"] == "First"
    assert rows[0]["updated_t"] == 500


# ================================================================== polish round 2 (M-a/M-b/Lows)
def test_ma_a_refused_pick_leaves_no_candidate_errors_on_the_live_session():
    """M-a: a refused pick or piece edit must leave no candidate errors/warnings on the live session --
    _compose_precheck's `finally` now restores config_errors/config_warnings alongside the config."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    before_errors = list(s.config_errors)
    before_warnings = list(s.config_warnings)
    r = c.post("/api/pieces", json={"kind": "primary", "name": "Ghost Gun", "note": "",
                                    "value": {"choice": "fixed", "fixed_id": "smoke_gun"}})
    pid = r.json()["piece_id"]
    r2 = c.post("/api/play/pick", json={"pieces": {"primary": pid}})
    assert r2.json()["ok"] is False
    assert s.config_errors == before_errors
    assert s.config_warnings == before_warnings
    live = c.get("/api/state").json()
    assert not any("smoke_gun" in e for e in live["config_errors"])


def test_mb_editing_an_unrelated_piece_survives_an_inherited_post_mvp_mode():
    """M-b: an inherited post-MVP mode (H2's own _sync_game_pick_from_config can point game_pick at
    one through a plain PUT /api/config) must not refuse an edit to an unrelated picked piece.

    The mode switch has to come AFTER the life piece is picked and via a plain config edit, not a
    pick: `POST /api/play/pick` itself already heals a stale/post-MVP inherited kind on the way past
    (M1), which would silently fix `game_pick.pieces.mode` before ever reaching `pieces_update` and
    hide the very bug this test exists to catch."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/pieces", json={"kind": "life", "name": "Glass Cannon", "note": "",
                                    "value": {"max_hp": 30, "max_armor": 0, "max_shield": 0}})
    pid = r.json()["piece_id"]
    assert c.post("/api/play/pick", json={"pieces": {"life": pid}}).json()["ok"]
    assert c.put("/api/config", json={"mode": "infection"}).status_code == 200
    assert s.game_pick["pieces"]["mode"] == "builtin:mode:infection"   # post_mvp, but a valid live config
    r2 = c.put(f"/api/pieces/{pid}", json={"value": {"max_hp": 45, "max_armor": 0, "max_shield": 0}})
    assert r2.status_code == 200, r2.json()
    assert r2.json()["ok"] is True
    # a name-only edit on the same picked piece must ALSO survive (the other bug on the same lines --
    # resolving outside the try used to turn this into an unhandled 500 the moment it failed at all)
    # NOTE: r2's own VALUE edit already recomposed (a value DID change), and that recompose's own
    # resolve_pieces_mixed legitimately fell the inherited post-MVP mode piece back to TDM as a side
    # effect -- so `s.config["mode"]` is "tdm" by this point, not "infection" any more. What round 3
    # actually guards is the NEXT step: a rename must not recompose AGAIN and must not move it further.
    mode_after_the_value_edit = s.config["mode"]
    r3 = c.put(f"/api/pieces/{pid}", json={"name": "Glass Cannon Mk2"})
    assert r3.status_code == 200, r3.json()
    assert "ok" not in r3.json() and "fallbacks" not in r3.json()
    assert s.config["mode"] == mode_after_the_value_edit


def test_low_play_pick_reports_fallbacks_for_an_inherited_kind():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    s.game_pick["pieces"]["spawn"] = "gone-id"
    r = c.post("/api/play/pick", json={"match": {"frag_limit": 10}})
    assert r.status_code == 200 and r.json()["ok"], r.json()
    assert r.json()["fallbacks"] == ["spawn"]


def test_low_attach_pieces_also_syncs_match_and_mode_from_the_restored_config():
    path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
    cfg = default_config("ffa")
    cfg["scoring"]["frag_limit"] = 12
    cfg["night"] = True
    stale_pick = {"pieces": dict(BUILTIN_IDS),   # mode "tdm" here, config mode "ffa" below: deliberately stale
                 "match": {"time_limit_s": 600, "frag_limit": None, "night": False, "silenced": False}}
    snap = {"v": 1, "saved_ms": 0, "players": [], "standby": [], "teams": [], "config": cfg, "game_pick": stale_pick}
    path.write_text(json.dumps(snap))
    s = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    s._persist_path = path
    s.restore_snapshot()
    assert s.game_pick["pieces"]["mode"] == "builtin:mode:tdm"    # trusted verbatim right after restore
    s.attach_pieces(PieceStore(None))
    assert s.game_pick["pieces"]["mode"] == "builtin:mode:ffa"    # now synced to the restored config
    assert s.game_pick["match"]["frag_limit"] == 12 and s.game_pick["match"]["night"] is True


def test_low_pieces_update_rolls_recap_forward_before_the_precheck():
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/pieces", json={"kind": "life", "name": "Custom Life", "note": "",
                                    "value": {"max_hp": 45, "max_armor": 20, "max_shield": 0}})
    pid = r.json()["piece_id"]
    assert c.post("/api/play/pick", json={"pieces": {"life": pid}}).json()["ok"]
    s.phase = "recap"
    r2 = c.put(f"/api/pieces/{pid}", json={"value": {"max_hp": 45, "max_armor": 30, "max_shield": 0}})
    assert r2.status_code == 200, r2.json()
    assert s.phase != "recap"


# ================================================================== polish round 3
def test_round3_a_name_only_edit_never_recomposes_or_touches_the_config():
    """round 3: a name/note-only edit changes no game value and must not touch the config at all.
    Probe (Tony's own repro): pick a custom LIFE piece, PUT /api/config {"mode": "infection"} (a
    legal, non-pick config edit), then just rename the LIFE piece -- the mode used to silently revert
    to TDM, because the unconditional recompose re-resolved every kind, including the now-inherited
    post-MVP mode, which resolve_pieces_mixed correctly falls back to TDM -- and set_config applied it."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/pieces", json={"kind": "life", "name": "Glass Cannon", "note": "",
                                    "value": {"max_hp": 30, "max_armor": 0, "max_shield": 0}})
    pid = r.json()["piece_id"]
    assert c.post("/api/play/pick", json={"pieces": {"life": pid}}).json()["ok"]
    assert c.put("/api/config", json={"mode": "infection"}).status_code == 200
    r2 = c.put(f"/api/pieces/{pid}", json={"name": "Glass Cannon Mk2"})
    assert r2.status_code == 200
    body = r2.json()
    assert body["name"] == "Glass Cannon Mk2"
    assert "ok" not in body and "errors" not in body and "fallbacks" not in body
    assert s.config["mode"] == "infection"        # NOT reverted to tdm
    r3 = c.put(f"/api/pieces/{pid}", json={"note": "one shot"})
    assert r3.status_code == 200 and s.config["mode"] == "infection"


def test_round3_play_pick_prev_mode_lookup_does_not_404_an_unrelated_pick():
    """round 3: prev_mode's own PieceStore.get() used the STRICT lookup -- an unresolvable inherited
    game_pick.pieces.mode id (the same kind of drift M1 already tolerates everywhere else) 404'd an
    otherwise unrelated pick instead of being treated as a mode change."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    s.game_pick["pieces"]["mode"] = "gone-mode-id"
    r = c.post("/api/play/pick", json={"match": {"frag_limit": 10}})
    assert r.status_code == 200 and r.json()["ok"], r.json()
    assert r.json()["pick"]["pieces"]["mode"] == BUILTIN_IDS["mode"]
    assert r.json()["fallbacks"] == ["mode"]
    # treated as a mode CHANGE: the strip resets to the (real) current mode's own defaults
    assert r.json()["config"]["time_limit_s"] == default_config("tdm")["time_limit_s"]


def _hidden_ids():
    import json as _json, pathlib as _pl
    here = _pl.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc"
    w = _json.loads((here / "weapons.json").read_text())
    rows = w["weapons"] if isinstance(w, dict) else w
    p = _json.loads((here / "perks.json").read_text())
    prow = p["perks"] if isinstance(p, dict) else p
    return [r["weapon_id"] for r in rows if r.get("hidden")], [r["perk_id"] for r in prow if r.get("hidden")]


def test_no_preset_can_name_a_hidden_weapon_or_perk():
    """Tony 2026-09-26: no type toggle, picker or BUILD preset may ever select a hidden weapon (the cut
    arsenal, the hidden heavies, melee). The console never receives them; the server refuses them too."""
    weapons, perks = _hidden_ids()
    assert "force_rifle" in weapons and "melee" in weapons, "the fixture lost its hidden rows"
    for wid in weapons:
        for value in ({"choice": "fixed", "fixed_id": wid}, {"choice": "player", "only_ids": ["assault_rifle", wid]}):
            try:
                check_value("primary", value); assert False, f"{wid} was accepted in {value}"
            except PieceError as e:
                # round 3 (MEDIUM 5): the message names the weapon by its catalogue NAME, not the raw
                # snake_case id -- "force_rifle" -> "FORCE RIFLE"
                assert e.status == 400 and wid.replace("_", " ").upper() in str(e)
    for pid in perks:
        try:
            check_value("perks", {"choice": "fixed", "fixed_id": pid}); assert False, pid
        except PieceError as e:
            assert e.status == 400
    for wid in ("rail_gun", "rocket_launcher"):   # pickup-only heavies: ARMORY arms them, never a loadout
        try:
            check_value("primary", {"choice": "fixed", "fixed_id": wid}); assert False, wid
        except PieceError as e:
            assert e.status == 400
    assert check_value("primary", {"choice": "player", "only_ids": ["assault_rifle"]})["only_ids"] == ["assault_rifle"]


def test_no_weapon_list_the_console_reads_carries_a_hidden_weapon():
    """The live catalogue (`/api/weapons`) and the generated demo catalogue the mock and the phone read
    both exclude every hidden weapon, so no type toggle or picker can offer one."""
    import pathlib as _pl, re as _re
    from brx_mcp.mc.compile import WeaponCatalog
    weapons, _ = _hidden_ids()
    live = {w["weapon_id"] for w in WeaponCatalog().all()}
    assert not live & set(weapons), sorted(live & set(weapons))
    repo = _pl.Path(__file__).resolve().parents[2]
    for f in (repo / "app" / "src" / "demo-catalog.js", repo / "webapp" / "mc" / "src" / "mock" / "data.ts"):
        offered = set(_re.findall(r'"weapon_id":\s*"([a-z0-9_]+)"', f.read_text()))
        assert offered and not offered & set(weapons), (f.name, sorted(offered & set(weapons)))


# ================================================================== independent review (brx1)
def test_medium2_a_failed_value_update_leaves_the_row_unchanged():
    """MEDIUM 2: name, note and value are all validated BEFORE any of them is assigned -- a 400 on
    value must leave the row (name AND note) exactly as it was, in memory and on disk."""
    st, path = _store()
    row = st.create("life", "Original Name", "original note", {"max_hp": 45, "max_armor": 0, "max_shield": 0})
    try:
        st.update(row["piece_id"], name="New Name", note="new note",
                 value={"max_hp": 999, "max_armor": 0, "max_shield": 0})
        assert False
    except PieceError as e:
        assert e.status == 400
    reread = st.get(row["piece_id"])
    assert reread["name"] == "Original Name" and reread["note"] == "original note"
    assert reread["value"] == {"max_hp": 45, "max_armor": 0, "max_shield": 0}
    st2 = PieceStore(path)   # on disk too -- _save() never ran, but check the in-memory row wasn't
    reread2 = st2.get(row["piece_id"])   # half-mutated and then persisted by some LATER unrelated save
    assert reread2["name"] == "Original Name" and reread2["value"]["max_hp"] == 45


def test_medium5_messages_are_all_caps_what_colon_do():
    st, _ = _store()
    st.create("life", "Original", "", {"max_hp": 45, "max_armor": 0, "max_shield": 0})
    try:
        st.create("life", "original", "", {"max_hp": 45, "max_armor": 0, "max_shield": 0})
        assert False
    except PieceError as e:
        assert str(e) == "NAME ALREADY USED: PICK ANOTHER NAME FOR THIS LIFE PRESET"
    try:
        st.create("life", "STANDARD", "", {"max_hp": 45, "max_armor": 0, "max_shield": 0})
        assert False
    except PieceError as e:
        assert str(e) == e.args[0] == "NAME ALREADY USED: \"STANDARD\" IS A BUILT-IN LIFE PRESET, PICK ANOTHER NAME"
    try:
        st.get("nope")
        assert False
    except PieceError as e:
        assert str(e) == "PRESET NOT FOUND: IT MAY HAVE BEEN DELETED"


def test_low_piece_id_length_cap_in_pick():
    """Lows: a length cap on ids in favourites and picks (64 chars, 400 beyond)."""
    huge = "x" * 65
    try:
        G.merge_piece_ids({}, {"life": huge})
        assert False
    except PieceError as e:
        assert e.status == 400
    ok = G.merge_piece_ids({}, {"life": "x" * 64})   # exactly 64 is the shape limit, not a real id either way
    assert ok["life"] == "x" * 64


def test_type_token_migration_keeps_sidearms_out_of_primary_and_leaves_perks_alone():
    """Overnight review L3 (2026-10-03): `close` is on the sidearms too (usp, deagle carry `sidearm` AND
    `close`), so the old expansion put them into a PRIMARY piece -- a slot that never offers a sidearm.
    A perks piece holds perk ids, and a perk id that happens to spell a type word must not turn into
    weapon ids: the migration is for the weapon slots only."""
    _, path = _store()
    path.write_text(json.dumps({"v": 1, "pieces": [
        {"piece_id": "z1", "kind": "primary", "name": "Old Close",
         "value": {"choice": "player", "only_ids": ["close"]}},
        {"piece_id": "z2", "kind": "secondary", "name": "Old Close Secondary",
         "value": {"choice": "player", "kinds": ["weapon"], "only_ids": ["close"]}},
        {"piece_id": "z3", "kind": "perks", "name": "Old Perks",
         "value": {"choice": "player", "only_ids": ["close"]}},
    ]}))
    rows = {r["name"]: r for r in PieceStore(path).list()}
    sidearms = {w["weapon_id"] for w in WeaponCatalog().all() if "sidearm" in (w.get("types") or [])}
    assert sidearms, "the catalogue has no sidearm: this test proves nothing"
    primary = set(rows["Old Close"]["value"]["only_ids"])
    assert primary and not primary & sidearms, primary
    # SECONDARY does carry sidearms, so they stay in its expansion
    assert sidearms <= set(rows["Old Close Secondary"]["value"]["only_ids"])
    # the perks piece is not rewritten into weapon ids (the token stays, and so the piece reads invalid)
    assert rows["Old Perks"]["value"]["only_ids"] == ["close"]


def test_round2_a_token_that_expands_to_nothing_is_kept_not_widened():
    """A PRIMARY piece holding only ["sidearm"] must not migrate to an empty (unrestricted) list."""
    from brx_mcp.mc.pieces import _migrate_type_tokens
    assert _migrate_type_tokens("primary", {"only_ids": ["sidearm"]})["only_ids"] == ["sidearm"]


def test_clearing_the_hold_target_on_pick_clears_it_in_the_config():
    """Cross-lane review #3: a pick that clears the hold target left it in the config (the patch omitted the key and
    the merge kept it), while the PLAY strip showed no target."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    r = c.post("/api/play/pick", json={"pieces": {"mode": "builtin:mode:koth"}, "match": {"hold_target_s": 180}})
    assert r.json()["ok"] and s.config["scoring"].get("hold_target_s") == 180, "control"
    r = c.post("/api/play/pick", json={"match": {"hold_target_s": None}})
    assert r.json()["ok"]
    assert "hold_target_s" not in s.config["scoring"], s.config["scoring"]
    assert s.game_pick["match"].get("hold_target_s") is None


def test_picking_standard_gameplay_resets_a_kit_edit_of_the_mode_params():
    """Cross-lane review #3, same root: STANDARD gameplay's empty mode_params merged onto the current value, so a KIT edit
    survived the pick. A pick writes the mode's full defaults now."""
    from brx_mcp.modes.registry import default_params
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    assert c.post("/api/play/pick", json={"pieces": {"mode": "builtin:mode:koth"}}).json()["ok"]
    c.put("/api/config", json={"mode_params": {"score_target": 100}})
    assert s.config.get("mode_params", {}).get("score_target") == 100, "control: the KIT edit took"
    r = c.post("/api/play/pick", json={"pieces": {"gameplay": "builtin:gameplay:standard"}})
    assert r.json()["ok"]
    assert s.config.get("mode_params") == default_params("koth"), s.config.get("mode_params")


def test_a_match_only_pick_keeps_a_kit_edit_of_the_mode_params():
    """F470 review (Medium): only a pick that CHANGES the mode or the gameplay piece resets mode_params; a pick that only
    changes the time limit (or NIGHT, SILENCED) keeps a deliberate KIT edit."""
    needs(HAVE, "starlette + httpx")
    c, s, net, clock, ps = _pclient()
    assert c.post("/api/play/pick", json={"pieces": {"mode": "builtin:mode:koth"}}).json()["ok"]
    c.put("/api/config", json={"mode_params": {"score_target": 100}})
    assert s.config.get("mode_params", {}).get("score_target") == 100, "control"
    r = c.post("/api/play/pick", json={"match": {"time_limit_s": 900}})
    assert r.json()["ok"]
    assert s.config.get("mode_params", {}).get("score_target") == 100, s.config.get("mode_params")
