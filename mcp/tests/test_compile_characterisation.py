"""Fixed pre-change observations for validate() and compile()."""
import json
import pathlib

from brx_mcp.mc.compile import Compiler
from brx_mcp.modes.registry import known_modes


ROOT = pathlib.Path(__file__).resolve().parent
TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
         {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]
PLAYER = {"player_id": "p7", "player_num": 7, "display": "REAPER", "team_id": "blue",
          "node_id": None, "gun_id": None, "voice": "male", "ready": True,
          "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}}


def _config(mode="tdm"):
    return {"config_id": "c1", "mode": mode, "environment": "indoor", "night": False,
            "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
            "scoring": {"frag_limit": 0, "win_by": "kills"},
            "health": {"max_hp": 45, "max_armor": 70, "max_shield": 0, "preset": "standard"},
            "teams": TEAMS}


def _cases():
    for mode in known_modes():
        yield "mode_" + mode, _config(mode)
    for preset, values in (("standard", (45, 70, 0)), ("shields", (45, 0, 105)),
                           ("hardcore", (100, 0, 0)), ("custom", (60, 35, 40))):
        cfg = _config()
        cfg["health"] = {"max_hp": values[0], "max_armor": values[1],
                         "max_shield": values[2], "preset": preset}
        yield "health_" + preset, cfg
    for preset in ("open", "no_heavies", "snipers", "custom"):
        cfg = _config()
        cfg["loadout_policy"] = {"preset": preset}
        yield "loadout_" + preset, cfg
    cfg = _config(); cfg["time_limit_s"] = None
    yield "time_limit_missing", cfg, [PLAYER], {}
    yield "time_limit_asserted_coverage", cfg, [PLAYER], {"venue_coverage": "full"}
    yield "time_limit_observed_coverage", cfg, [PLAYER], {"coverage": "full"}
    yield "duplicate_player_num", _config(), [PLAYER, PLAYER], {}
    for label, num in (("zero", 0), ("above_max", 64)):
        yield "player_num_" + label, _config(), [dict(PLAYER, player_num=num)], {}
    cfg = _config("koth")
    yield "objective_neutral_tid", cfg, [dict(PLAYER, team_id="yellow")], {}
    bad_teams = [dict(TEAMS[0], tid=1), dict(TEAMS[1], tid=4)]
    cfg = _config(); cfg["teams"] = bad_teams
    yield "team_tid_out_of_range", cfg, [PLAYER], {}
    for label, src in (("phone", "phone"), ("field", "field"), ("invalid", "bogus")):
        cfg = _config(); cfg["station_source"] = src
        yield "station_source_" + label, cfg, [PLAYER], {}
    cfg = _config(); cfg["scoring"]["frag_limit"] = 25
    yield "frag_limit_warning", cfg, [PLAYER], {}
    cfg = _config(); cfg["time_limit_s"] = None
    yield "time_limit_compile_failure", cfg, [PLAYER], {}
    cfg = _config(); cfg["respawn"] = {"type": "wave", "delay_s": 30}
    yield "respawn_wave", cfg, [PLAYER], {}
    cfg = _config(); cfg["presentation"] = {"preset": "silenced"}
    yield "presentation_silenced", cfg, [PLAYER], {}
    cfg = _config(); cfg["station_source"] = "phone"
    cfg["powerups"] = [{"weapon_id": "smg", "slot": 3}]
    yield "powerups_smoke", cfg, [PLAYER], {}
    p = dict(PLAYER); p["loadout"] = {"weapons": [{"weapon_id": "death_ray"}]}
    yield "unknown_weapon", _config(), [p], {}
    p = dict(PLAYER); p["loadout"] = {**PLAYER["loadout"], "perk": "not_a_perk"}
    yield "unknown_perk", _config(), [p], {}
    # polish round 1: the VIP checker, and one config that trips every checker at once, so the ORDER of the messages
    # (each checker appends to the same lists) is pinned and a reordered split fails here
    cfg = _config(); cfg["presentation"] = {"preset": "vip"}
    yield "vip_preset_without_vip", cfg, [PLAYER], {}
    cfg = _config(); cfg["vip_player_id"] = "nobody"
    yield "vip_not_on_roster", cfg, [PLAYER], {}
    cfg = _config("koth"); cfg["time_limit_s"] = None
    cfg["teams"] = [dict(TEAMS[0], tid=1), dict(TEAMS[1], tid=4)]
    cfg["station_source"] = "bogus"; cfg["scoring"]["frag_limit"] = 25; cfg["vip_player_id"] = "nobody"
    cfg["respawn"] = {"type": "auto", "delay_s": 2}; cfg["mode_params"] = {"hold_target_s": 0}
    bad = dict(PLAYER, player_num=0, team_id="yellow")
    bad["loadout"] = {"weapons": [{"weapon_id": "death_ray"}], "perk": "not_a_perk"}
    yield "everything_wrong", cfg, [bad, dict(PLAYER), dict(PLAYER)], {}


def test_validate_and_compile_match_fixed_old_code_observations():
    expected = json.loads((ROOT / "fixtures" / "compile_characterisation.json").read_text())
    actual_inputs = {}
    for case in _cases():
        name, cfg, *rest = case
        actual_inputs[name] = (cfg, *(rest or ([PLAYER], {})))
    assert [row["name"] for row in expected] == list(actual_inputs)
    compiler = Compiler()
    for row in expected:
        cfg, roster, opts = actual_inputs[row["name"]]
        assert row["config"] == cfg, row["name"]
        assert row["validate"] == compiler.validate(cfg, roster, opts), row["name"]
        try:
            actual = {"bundle": compiler.compile(cfg, roster[0], cfg.get("teams", TEAMS))}
        except Exception as exc:
            actual = {"exception": {"type": type(exc).__name__, "message": str(exc)}}
        assert row["compile"] == actual, row["name"]
