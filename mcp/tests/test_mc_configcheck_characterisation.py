"""Old config patch and compiler outcomes, captured before the shared checks moved."""
import copy
import json
from pathlib import Path

from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session, default_config


# Each case changes one config key. A patch and a whole config deliberately have different gates.
CASES = [
    ("time_min", "time_limit_s", 1, "tdm", {}),
    ("time_max", "time_limit_s", 7200, "tdm", {}),
    ("time_zero", "time_limit_s", 0, "tdm", {}),
    ("time_over", "time_limit_s", 7201, "tdm", {}),
    ("time_bool", "time_limit_s", True, "tdm", {}),
    ("time_none", "time_limit_s", None, "tdm", {}),
    ("time_none_asserted", "time_limit_s", None, "tdm", {"venue_coverage": "full"}),
    ("time_string", "time_limit_s", "60", "tdm", {}),
    ("respawn_object", "respawn", [], "tdm", {}),
    ("respawn_type", "respawn", {"type": "later"}, "tdm", {}),
    ("respawn_delay_min", "respawn", {"delay_s": 0}, "tdm", {}),
    ("respawn_delay_max", "respawn", {"delay_s": 600}, "tdm", {}),
    ("respawn_delay_over", "respawn", {"delay_s": 601}, "tdm", {}),
    ("respawn_delay_bool", "respawn", {"delay_s": True}, "tdm", {}),
    ("respawn_delay_unsafe", "respawn", {"delay_s": 2}, "tdm", {}),
    ("respawn_protect", "respawn", {"protect_s": 999}, "tdm", {}),
    ("respawn_gate", "respawn", {"gate": "unknown"}, "tdm", {}),
    ("respawn_lms", "respawn", {"type": "auto"}, "lms", {}),
    ("scoring_object", "scoring", [], "tdm", {}),
    ("scoring_frag_min", "scoring", {"frag_limit": 1}, "tdm", {}),
    ("scoring_frag_zero", "scoring", {"frag_limit": 0}, "tdm", {}),
    ("scoring_frag_bool", "scoring", {"frag_limit": True}, "tdm", {}),
    ("scoring_frag_none", "scoring", {"frag_limit": None}, "tdm", {}),
    ("scoring_win_by", "scoring", {"win_by": "bad"}, "tdm", {}),
    ("scoring_hold_min", "scoring", {"hold_target_s": 1}, "koth", {}),
    ("scoring_hold_max", "scoring", {"hold_target_s": 7200}, "koth", {}),
    ("scoring_hold_over", "scoring", {"hold_target_s": 7201}, "koth", {}),
    ("scoring_hold_bool", "scoring", {"hold_target_s": True}, "koth", {}),
    ("scoring_hold_wrong_mode", "scoring", {"hold_target_s": 10}, "tdm", {}),
    ("health_object", "health", [], "tdm", {}),
    ("health_hp_min", "health", {"max_hp": 1, "max_shield": 0}, "tdm", {}),
    ("health_hp_zero", "health", {"max_hp": 0, "max_shield": 0}, "tdm", {}),
    ("health_hp_bool", "health", {"max_hp": True, "max_shield": 0}, "tdm", {}),
    ("health_armor_max", "health", {"max_armor": 255, "max_shield": 0}, "tdm", {}),
    ("health_shield_over", "health", {"max_shield": 256}, "tdm", {}),
    ("health_preset", "health", {"preset": "unknown"}, "tdm", {}),
    ("mode_params_none", "mode_params", None, "tdm", {}),
    ("mode_params_object", "mode_params", [], "tdm", {}),
    ("mode_params_unknown", "mode_params", {"unknown": 1}, "tdm", {}),
    ("mode_params_bound", "mode_params", {"hold_target_s": 0}, "koth", {}),
    ("teams_object", "teams", {}, "tdm", {}),
    ("teams_tid_bool", "teams", [{"team_id": "red", "tid": True}], "tdm", {}),
    ("teams_tid_high", "teams", [{"team_id": "red", "tid": 4}], "tdm", {}),
    ("teams_duplicate", "teams", [{"team_id": "a", "tid": 0}, {"team_id": "b", "tid": 0}], "tdm", {}),
    ("teams_neutral", "teams", [{"team_id": "a", "tid": 2}], "koth", {}),
    ("teams_koth_count", "teams", [{"team_id": "a", "tid": 0}], "koth", {}),
    ("vip_none", "vip_player_id", None, "tdm", {}),
    ("vip_empty", "vip_player_id", "", "tdm", {}),
    ("vip_bool", "vip_player_id", True, "tdm", {}),
    ("vip_missing", "vip_player_id", "absent", "tdm", {}),
    ("presentation_object", "presentation", [], "tdm", {}),
    ("presentation_bad", "presentation", {"preset": "unknown"}, "tdm", {}),
    ("presentation_vip", "presentation", {"preset": "vip"}, "tdm", {}),
]


def _outcome(call):
    try:
        return {"value": call()}
    except Exception as exc:
        return {"exception": type(exc).__name__, "message": str(exc)}


def _observed():
    session = Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))
    compiler = Compiler()
    observed = {}
    for name, key, value, mode, opts in CASES:
        cfg = default_config(mode)
        cfg["config_id"] = "fixed"
        patch = {key: copy.deepcopy(value)}
        def merge():
            merged = session._merge_config(copy.deepcopy(cfg), patch, mode)
            return {"present": key in merged, "key_value": merged.get(key)}
        observed[name] = {
            "patch": _outcome(merge),
            "validate": _outcome(lambda: compiler.validate({**copy.deepcopy(cfg), key: copy.deepcopy(value)}, [], opts)),
        }
    return observed


def test_patch_and_validate_characterisation():
    expected = json.loads(Path(__file__).with_name("fixtures").joinpath("mc_configcheck.json").read_text())
    observed = _observed()
    assert observed == expected, [name for name in observed if observed[name] != expected.get(name)]
