"""Fixed pre-change observations for validate() and compile()."""
import copy
import json
import pathlib
import random
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.perks import PerkCatalog
from brx_mcp.modes.registry import known_modes

from _session import TEAMS


ROOT = pathlib.Path(__file__).resolve().parent
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

    p = copy.deepcopy(PLAYER); p["loadout"]["weapons"] = [{"weapon_id": "assault_rifle"}]
    yield "single_weapon", _config(), [p], {}
    p = copy.deepcopy(PLAYER); p["loadout"]["perk"] = "armor_piercing"
    yield "armor_piercing_perk", _config(), [p], {}
    p = copy.deepcopy(PLAYER); p["loadout"] = {"weapons": [{"weapon_id": "smg"}], "perk": "test_crit"}
    yield "crit_perk_dual_emitter", _config(), [p], {}, {"test_crit_perk": True}
    p = copy.deepcopy(PLAYER); p["loadout"] = {"weapons": [{"weapon_id": "assault_rifle"}], "perk": "test_crit"}
    yield "crit_perk_single_emitter", _config(), [p], {}, {"test_crit_perk": True}
    yield "seeded_voice_roll", _config(), [PLAYER], {}, {"roll_seed": 1}
    cfg = _config(); cfg["night"] = True
    yield "night", cfg, [PLAYER], {}
    yield "infection_two_team_flip", _config("infection"), [PLAYER], {}
    yield "explicit_hit_plan", _config(), [PLAYER], {}, {"plan": True}
    # polish round 2: a RE-KEYED hit plan (hit_audio_rekey on), the $WEAP cell rewrite no other case reaches
    cfg = _config(); cfg["hit_audio_rekey"] = True
    yield "rekeyed_hit_plan", cfg, [PLAYER], {}, {"plan": "rekey"}
    p = copy.deepcopy(PLAYER); p["loadout"]["weapons"][0]["weapon_id"] = None
    yield "primary_weapon_id_none", _config(), [p], {}
    cfg = _config(); cfg["stun"] = "malformed"
    yield "malformed_stun_config", cfg, [PLAYER], {}
    cfg = _config(); cfg["stun"] = {"enabled": True}; cfg["hit_audio_rekey"] = True
    yield "stun_hit_audio_rekey_conflict", cfg, [PLAYER], {}
    cfg = _config(); cfg["stun"] = {"enabled": True}
    cfg["scoring"]["frag_limit"] = 25; cfg["hit_audio_class"] = True
    yield "stun_frag_limit_hit_audio_class", cfg, [PLAYER], {}


def _inputs(case):
    name, cfg, *rest = case
    if not rest:
        return name, cfg, [PLAYER], {}, {}
    if len(rest) == 2:
        roster, opts = rest
        return name, cfg, roster, opts, {}
    roster, opts, compile_args = rest
    return name, cfg, roster, opts, compile_args


def _observe(name, cfg, roster, opts, compile_args):
    before = copy.deepcopy((cfg, roster, opts))
    perks = (PerkCatalog([{"perk_id": "test_crit", "name": "Test Crit",
                           "effects": {"crit_pct_add": 20}}])
             if compile_args.get("test_crit_perk") else None)
    compiler = Compiler(perks=perks)
    validated = compiler.validate(cfg, roster, opts)
    assert (cfg, roster, opts) == before, name
    kwargs = {}
    if "roll_seed" in compile_args:
        kwargs["roll"] = random.Random(compile_args["roll_seed"])
    if compile_args.get("plan"):
        kwargs["plan"] = compiler.hit_plan(roster, rekey=compile_args["plan"] == "rekey")
    try:
        compiled = {"bundle": compiler.compile(cfg, roster[0], cfg.get("teams", TEAMS), **kwargs)}
    except Exception as exc:
        compiled = {"exception": {"type": type(exc).__name__, "message": str(exc)}}
    assert (cfg, roster, opts) == before, name
    return {"name": name, "config": cfg, "validate": validated, "compile": compiled}


def _observations():
    return [_observe(*_inputs(case)) for case in _cases()]


def test_validate_and_compile_match_fixed_old_code_observations():
    expected = json.loads((ROOT / "fixtures" / "compile_characterisation.json").read_text())
    actual = _observations()
    assert [row["name"] for row in expected] == [row["name"] for row in actual]
    for old, new in zip(expected, actual):
        assert old == new, old["name"]


if __name__ == "__main__":
    if sys.argv[1:] != ["--regen"]:
        raise SystemExit("usage: python3 tests/test_compile_characterisation.py --regen")
    # Use only for a deliberate output change. Normal fixes must match the committed old observations.
    (ROOT / "fixtures" / "compile_characterisation.json").write_text(
        json.dumps(_observations(), indent=2) + "\n")
