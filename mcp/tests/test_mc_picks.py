"""mc.md #10 (architecture review 2026-10-10): the game-pick rules are one module, `picks.GamePick`, tested here directly,
without HTTP. A mode change resets the match strip to the new mode's defaults; a refused pick changes neither the
config nor the pick; an armed or live match refuses a pick before anything is resolved."""
from __future__ import annotations

import pathlib
import tempfile

from _session import mk_loadout_session, online

from brx_mcp.mc.picks import GamePick
from brx_mcp.mc.pieces import PieceStore
from brx_mcp.mc.state import default_config


def _pick():
    s, net, clock, ps = mk_loadout_session(2)
    for i, p in enumerate(ps):
        online(s, net, clock, p, i)
    s.attach_pieces(PieceStore(pathlib.Path(tempfile.mkdtemp()) / "pieces.json"))
    return GamePick(s), s


def test_a_mode_change_resets_the_strip_to_the_new_modes_defaults():
    g, s = _pick()
    first = g.pick({}, {"time_limit_s": 777, "frag_limit": 37})
    assert first["ok"] and s.game_pick["match"]["time_limit_s"] == 777, first["errors"]
    res = g.pick({"mode": "builtin:mode:ffa"}, {})
    assert res["ok"], res["errors"]
    assert s.config["mode"] == "ffa"
    dc = default_config("ffa")
    assert s.game_pick["match"]["time_limit_s"] == dc["time_limit_s"], s.game_pick["match"]
    assert s.game_pick["match"]["frag_limit"] == (dc.get("scoring") or {}).get("frag_limit"), s.game_pick["match"]


def test_picking_domination_takes_its_first_to_1000_target_from_any_mode():
    """Review 2026-11-06: a mode change dropped the target, so Domination picked on PLAY had none and always ran to
    the clock. The new mode's default comes with it, from TDM and from a KOTH that had its own target."""
    g, s = _pick()
    res = g.pick({"mode": "builtin:mode:domination"}, {})
    assert res["ok"], res["errors"]
    assert s.config["scoring"].get("hold_target_s") == 1000, s.config["scoring"]
    assert s.game_pick["match"].get("hold_target_s") == 1000, s.game_pick["match"]
    res = g.pick({"mode": "builtin:mode:koth"}, {"hold_target_s": 300})
    assert res["ok"], res["errors"]
    assert s.config["scoring"].get("hold_target_s") == 300, "CONTROL: the same request's own target wins"
    res = g.pick({"mode": "builtin:mode:domination"}, {})
    assert res["ok"], res["errors"]
    assert s.config["scoring"].get("hold_target_s") == 1000, "a KOTH 5:00 is not 300 POINTS"
    res = g.pick({"mode": "builtin:mode:koth"}, {})
    assert res["ok"], res["errors"]
    assert s.config["scoring"].get("hold_target_s") is None, "KOTH keeps no default target, never Domination's 1000"


def test_a_refused_pick_changes_neither_the_config_nor_the_pick():
    g, s = _pick()
    import copy
    before_cfg, before_pick = copy.deepcopy(s.config), copy.deepcopy(s.game_pick)
    res = g.pick({}, {"time_limit_s": -5})
    assert not res["ok"] and res["errors"], res
    assert s.game_pick == before_pick, "the pick moved"
    assert s.config == before_cfg, "the config moved"


def test_an_armed_match_refuses_a_pick_before_resolving_anything():
    g, s = _pick()
    s.phase = "armed"
    try:
        g.pick({"mode": "no-such-piece"}, {})      # a bad id would 404 if it were resolved first
    except ValueError as e:
        assert "after the match has started" in str(e), f"refused for the wrong reason: {e}"
        return
    raise AssertionError("an armed match took a pick")


def test_a_pick_keeps_the_operators_venue():
    """F546 (bench C.1, 2026-10-16): `play/pick ffa` after `PUT` venue indoor set the venue back to outdoor. The venue is
    the operator's fact about the site: a pick (a mode change or not) and a favourite load keep it. A new session still
    starts outdoors (`default_config`)."""
    g, s = _pick()
    assert s.config["environment"] == "outdoor", "a new session must still start outdoors"
    assert s.set_config({"environment": "indoor"})["ok"]
    res = g.pick({"mode": "builtin:mode:ffa"}, {})
    assert res["ok"], res["errors"]
    assert s.config["mode"] == "ffa" and s.config["environment"] == "indoor", "a mode pick reset the venue"
    from brx_mcp.mc.compile import head_volume, play_volume
    assert head_volume(s.config) == play_volume("indoor") != play_volume("outdoor"), "the play volume follows the venue"
    res = g.pick({}, {"time_limit_s": 600})
    assert res["ok"], res["errors"]
    assert s.config["environment"] == "indoor", "a same-mode pick reset the venue"
    res = g.load(s.game_pick)
    assert res["ok"], res["errors"]
    assert s.config["environment"] == "indoor", "a favourite load reset the venue"


def test_an_old_domination_favourite_with_no_target_loads_as_first_to_1000():
    """brx1 2026-11-06 (Tony's auto-fix rule, no warning): a Domination favourite saved while a mode change dropped the
    target has no `hold_target_s`; it loads as first to 1000, never as a match that runs to the clock."""
    g, s = _pick()
    assert g.pick({"mode": "builtin:mode:domination"}, {})["ok"]
    old = {"pieces": dict(s.game_pick["pieces"]), "match": {k: v for k, v in s.game_pick["match"].items() if k != "hold_target_s"}}
    assert "hold_target_s" not in old["match"]
    assert g.pick({"mode": "builtin:mode:tdm"}, {})["ok"]
    res = g.load(old)
    assert res["ok"], res["errors"]
    assert s.config["mode"] == "domination" and s.config["scoring"].get("hold_target_s") == 1000, s.config["scoring"]
    assert s.game_pick["match"].get("hold_target_s") == 1000, s.game_pick["match"]
    assert "hold_target_s" not in old["match"], "the stored favourite stays as saved"
    kept = {**old, "match": {**old["match"], "hold_target_s": 600}}
    assert g.load(kept)["ok"] and s.config["scoring"]["hold_target_s"] == 600, "CONTROL: a saved target is kept"


def test_a_restored_domination_setup_with_no_target_gets_first_to_1000():
    """brx1 2026-11-06: an idle session saved on Domination with no target restores as first to 1000. KOTH keeps none."""
    import json
    from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    for mode, want in (("domination", 1000), ("koth", None)):
        g, s = _pick()
        assert g.pick({"mode": f"builtin:mode:{mode}"}, {})["ok"]
        path = pathlib.Path(tempfile.mkdtemp()) / "session.json"
        s._persist_path = path
        s._persist_last, s._persist_dirty = 0.0, True
        s.persist_now()
        snap = json.loads(path.read_text())
        snap["config"]["scoring"].pop("hold_target_s", None)
        snap.get("game_pick", {}).get("match", {}).pop("hold_target_s", None)
        assert "match" not in snap or snap["match"] is None, "CONTROL: no match in play"
        path.write_text(json.dumps(snap))
        s2 = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
        s2._persist_path = path
        s2.restore_snapshot()
        assert s2.config["scoring"].get("hold_target_s") == want, (mode, s2.config["scoring"])
        assert s2.game_pick["match"].get("hold_target_s") == want, (mode, s2.game_pick["match"])
