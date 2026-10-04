"""Config patch outcomes captured before the Session merger moved."""
import copy
import json
from pathlib import Path

from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session, default_config


CASES = [
    ("environment", "tdm", {"environment": "indoor"}),
    ("environment_bad", "tdm", {"environment": "inside"}),
    ("night", "tdm", {"night": []}),
    ("recoil", "tdm", {"recoil": 0}),
    ("volume", "tdm", {"volume": 80}),
    ("volume_clear", "tdm", {"volume": None}),
    ("coverage", "tdm", {"coverage": "full"}),
    ("coverage_bad", "tdm", {"coverage": "total"}),
    ("coverage_clear", "tdm", {"coverage": None}),
    ("led", "tdm", {"led": {"extra": 1}}),
    ("led_clear", "tdm", {"led": None}),
    ("station_source", "koth", {"station_source": None}),
    ("station_source_bad", "koth", {"station_source": "unknown"}),
    ("mode_params", "koth", {"mode_params": {}}),
    ("mode_params_clear", "tdm", {"mode_params": None}),
    ("vip_clear", "tdm", {"vip_player_id": None}),
    ("stun", "tdm", {"stun": {"duration_s": 4, "extra": 1}}),
    ("stun_bad", "tdm", {"stun": []}),
    ("stun_clear", "tdm", {"stun": None}),
    ("player_num_base", "tdm", {"player_num_base": 63}),
    ("player_num_base_bad", "tdm", {"player_num_base": True}),
    ("loadout_policy", "tdm", {"loadout_policy": {"preset": "open"}}),
    ("presentation", "tdm", {"presentation": {"preset": "standard"}}),
    ("config_id", "tdm", {"config_id": "injected"}),
    ("mode", "tdm", {"mode": "ffa"}),
    ("unknown", "tdm", {"injected": 42}),
    ("ordered_failure", "tdm", {"night": True, "environment": "bad"}),
    ("scoring_missing_win_by", "tdm", {"scoring": {"frag_limit": 5}}),
]


def _outcomes(merge):
    observed = {}
    for name, mode, patch in CASES:
        cfg = default_config(mode)
        cfg["config_id"] = "fixed"
        if name == "scoring_missing_win_by":
            cfg["scoring"].pop("win_by")
        before = copy.deepcopy(cfg)
        original = cfg
        try:
            result = merge(cfg, copy.deepcopy(patch), mode)
            outcome = {"value_delta": _delta(before, result), "same_object": result is original}
        except Exception as exc:
            outcome = {"exception": type(exc).__name__, "message": str(exc)}
        outcome["input_delta"] = _delta(before, cfg)
        observed[name] = copy.deepcopy(outcome)
    return observed


def _delta(before, after):
    return {"set": {key: value for key, value in after.items() if key not in before or before[key] != value},
            "removed": [key for key in before if key not in after]}


def test_session_merge_characterisation():
    session = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    expected = json.loads(Path(__file__).with_name("fixtures").joinpath("mc_config_merge.json").read_text())
    assert _outcomes(session._merge_config) == expected
