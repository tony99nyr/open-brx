"""The config merger works without constructing a Session."""
import copy
import ast
from pathlib import Path
from typing import cast

from brx_mcp.mc import config_merge
from brx_mcp.mc.types import GameConfig


def _base() -> GameConfig:
    return cast(GameConfig, {
        "config_id": "fixed", "mode": "tdm", "environment": "outdoor", "night": False,
        "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 10},
        "scoring": {"frag_limit": None, "win_by": "kills"},
        "health": {"max_hp": 45, "max_armor": 70, "max_shield": 0, "preset": "standard"},
        "teams": [], "loadout_policy": {}, "presentation": {},
    })


def _defaults(mode: str) -> GameConfig:
    cfg = _base()
    cfg["scoring"]["win_by"] = "kills"
    return cfg


def test_module_merges_in_patch_order_without_session():
    source = Path(config_merge.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imports = [node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]
    assert all((node.module or "").split(".")[-1] != "state"
               and all(alias.name != "state" for alias in node.names)
               for node in imports if isinstance(node, ast.ImportFrom))
    assert all("brx_mcp.mc.state" not in alias.name for node in imports if isinstance(node, ast.Import)
               for alias in node.names)
    cfg = _base()
    patch = {"night": 1, "coverage": "full", "scoring": {"frag_limit": 5},
             "config_id": "injected", "unknown": 1, "stun": {"duration_s": 4, "extra": 9}}
    result = config_merge.merge_config(cfg, patch, "tdm", _defaults)
    assert result is cfg
    assert cfg["night"] is True
    assert cfg["coverage"] == "full"
    assert cfg["scoring"] == {"frag_limit": 5, "win_by": "kills"}
    assert cfg["stun"] == {"duration_s": 4}
    assert cfg["config_id"] == "fixed" and "unknown" not in cfg


def test_module_keeps_earlier_writes_when_a_later_key_fails():
    cfg = _base()
    before = copy.deepcopy(cfg)
    try:
        config_merge.merge_config(cfg, {"night": True, "environment": "bad"}, "tdm", _defaults)
    except ValueError as exc:
        assert str(exc) == "environment must be indoor|outdoor"
    else:
        assert False, "the invalid environment must fail"
    assert cfg == {**before, "night": True}


def test_dispatch_has_one_handler_for_each_applied_key():
    assert set(config_merge._HANDLERS) == config_merge.CONFIG_KEYS
