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
