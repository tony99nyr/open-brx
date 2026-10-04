"""Apply validated config patches without Session state."""
from __future__ import annotations

from typing import Any, Callable

from ..modes.hillbeacon import NEUTRAL_TEAM as _NEUTRAL_TEAM
from ..modes.registry import validate_mode_params as _validate_mode_params
from . import compile as _compile
from . import configcheck as _check
from . import policy as _policy
from . import presentation as _pres
from .types import (MAX_PLAYERS, OBJECTIVE_MODES, RESPAWN_DELAY_MAX_S, STATION_SOURCES,
                    TIME_LIMIT_MAX_S, GameConfig, Respawn, Stun, parse_win_by)


CONFIG_KEYS = {"mode", "environment", "night", "time_limit_s", "respawn", "scoring",
               "health", "teams", "led", "player_num_base", "loadout_policy", "presentation",
               "station_source", "mode_params", "vip_player_id", "stun", "coverage", "recoil",
               "volume"}

Defaults = Callable[[str], GameConfig]
Handler = Callable[[GameConfig, Any, str, Defaults], None]


def _time_limit(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if not _check.patch_time_limit(value):
        raise ValueError(f"time_limit_s must be an integer 1..{TIME_LIMIT_MAX_S} or null")
    cfg["time_limit_s"] = value


def _environment(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if value not in ("indoor", "outdoor"):
        raise ValueError("environment must be indoor|outdoor")
    cfg["environment"] = value


def _night(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    cfg["night"] = bool(value)


def _recoil(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    cfg["recoil"] = bool(value)


def _volume(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if _compile.check_game_volume(value) is None:
        cfg.pop("volume", None)
    else:
        cfg["volume"] = value


def _coverage(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if value is not None and value not in ("full", "partial"):
        raise ValueError("coverage must be full|partial or null")
    if value is None:
        cfg.pop("coverage", None)
    else:
        cfg["coverage"] = value


def _respawn(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if not isinstance(value, dict):
        raise ValueError("respawn must be an object")
    merged: dict[str, Any] = {**cfg["respawn"], **value}
    if not _check.respawn_type_ok(merged.get("type")):
        raise ValueError("respawn.type must be auto|scanner|none")
    delay = merged.get("delay_s", 0)
    if not _check.respawn_delay_ok(delay):
        raise ValueError(f"respawn.delay_s must be 0..{RESPAWN_DELAY_MAX_S}")
    if _check.respawn_delay_unsafe(delay):
        raise ValueError("respawn.delay_s of 1-2s wedges the headset in the relay's "
                         "out-blink (F13); use 0 (no respawn) or >= 3")
    _compile.respawn_settings(merged)
    respawn: Respawn = {"type": merged["type"], "delay_s": delay}
    if "protect_s" in merged:
        respawn["protect_s"] = merged["protect_s"]
    if "weapon_delay_ms" in merged:
        respawn["weapon_delay_ms"] = merged["weapon_delay_ms"]
    if "station_protect_s" in merged:
        respawn["station_protect_s"] = merged["station_protect_s"]
    gate = merged.get("gate")
    if gate is not None and merged["type"] == "scanner":
        if gate not in ("trigger", "presence"):
            raise ValueError("respawn.gate must be trigger|presence (scanner respawn only)")
        respawn["gate"] = gate
    cfg["respawn"] = respawn


def _scoring(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if not isinstance(value, dict):
        raise ValueError("scoring must be an object")
    merged: dict[str, Any] = {**cfg["scoring"], **value}
    frag_limit = merged.get("frag_limit")
    if not _check.frag_limit_ok(frag_limit):
        raise ValueError("scoring.frag_limit must be a positive integer or null")
    hold_target = merged.get("hold_target_s")
    if hold_target is not None:
        if mode != "koth":
            raise ValueError("A HOLD TARGET ONLY APPLIES TO KING OF THE HILL: CLEAR IT OR PICK KING OF THE HILL")
        if not _check.hold_target_ok(hold_target):
            raise ValueError("HOLD TARGET MUST BE 1 S TO 2:00:00, OR NO TARGET")
    cfg["scoring"] = {"frag_limit": frag_limit,
                      "win_by": parse_win_by(merged.get("win_by"), defaults(mode)["scoring"]["win_by"])}
    if hold_target is not None:
        cfg["scoring"]["hold_target_s"] = hold_target


def _health(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if not isinstance(value, dict):
        raise ValueError("health must be an object")
    merged: dict[str, Any] = {**cfg["health"], **value}
    preset_name = value.get("preset")
    if preset_name is not None and preset_name not in _compile.HEALTH_PRESET_NAMES:
        raise ValueError(f"health.preset must be one of {_compile.HEALTH_PRESET_NAMES}")
    legacy = preset_name is None and "max_shield" not in value
    if preset_name and preset_name != "custom":
        hp, armor, shield = _compile.HEALTH_PRESETS[preset_name]
        merged = {**merged, "max_hp": hp, "max_armor": armor, "max_shield": shield}
    pools: dict[str, int] = {}
    for key, low in (("max_hp", 1), ("max_armor", 0), ("max_shield", 0)):
        pool = merged.get(key, 0)
        if not _check.health_pool_ok(key, pool):
            raise ValueError(f"health.{key} must be {low}..255")
        pools[key] = pool
    if legacy:
        preset = "custom"
    elif preset_name and preset_name != "custom":
        preset = preset_name
    elif preset_name == "custom":
        preset = "custom"
    else:
        preset = _compile.resolve_health_preset(pools["max_hp"], pools["max_armor"], pools["max_shield"])
    cfg["health"] = {"max_hp": pools["max_hp"], "max_armor": pools["max_armor"],
                     "max_shield": pools["max_shield"], "preset": preset}


def _teams(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if not _check.team_patch_shape(value):
        raise ValueError("teams must be a list of team objects with team_id + integer tid")
    for key, label in (("team_id", "team_id"), ("tid", "$TID")):
        dupes = _check.duplicate_team_values(value, key)
        if dupes:
            raise ValueError(
                f"duplicate {label} {dupes} in teams: two teams "
                f"sharing a {label} are one side on the field (a shared $TID cannot register a "
                f"hit between them; a shared team_id resolves every player to the first of "
                f"the two). Give each team its own.")
    bad = _check.invalid_team_tids(_check.team_tids(value))
    if bad:
        raise ValueError(f"team tid(s) {sorted(set(bad))} outside 0-3 (F35): the IR word's "
                         f"team field is 2 bits -- a $TID of 4 or higher makes teammates "
                         f"damage each other and can let a gun read its own shots as friendly")
    if mode == "koth" and len(set(_check.team_tids(value))) != 2:
        raise ValueError("KING OF THE HILL IS EXACTLY 2 TEAMS: PICK TWO COLOURS")
    if mode in OBJECTIVE_MODES and len(set(_check.team_tids(value))) > 3:
        raise ValueError(
            f"F97: mode {mode!r} supports at most three teams (tids 0, 1 and 3): a neutral "
            f"hill broadcasts team {_NEUTRAL_TEAM} and the IR team field is 2 bits, so a "
            "fourth player has to share a team -- an FFA hill caps at three players")
    if mode in OBJECTIVE_MODES and _check.neutral_team_ids(value, _NEUTRAL_TEAM):
        raise ValueError("YELLOW IS KING OF THE HILL'S NEUTRAL TEAM: PICK RED, BLUE OR PURPLE")
    cfg["teams"] = value


def _led(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if value is not None and not isinstance(value, dict):
        raise ValueError("led must be an object")
    if value is None:
        cfg.pop("led", None)
    else:
        cfg["led"] = value


def _station_source(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if value is not None and value not in STATION_SOURCES:
        raise ValueError("station_source must be null or one of: "
                         + ", ".join(f"{key} ({description})" for key, description in sorted(STATION_SOURCES.items())))
    if value is None:
        cfg.pop("station_source", None)
    else:
        cfg["station_source"] = value


def _mode_params(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError("mode_params must be an object (the mode's parameters, GET /api/modes .params)")
    resolved, errors = _validate_mode_params(mode, {**(cfg.get("mode_params") or {}), **value})
    if errors:
        raise ValueError("; ".join(errors))
    if resolved:
        cfg["mode_params"] = resolved
    else:
        cfg.pop("mode_params", None)


def _vip_player_id(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if not _check.vip_patch_shape(value):
        raise ValueError("vip_player_id must be a player_id string or null")
    if value is None:
        cfg.pop("vip_player_id", None)
    else:
        cfg["vip_player_id"] = value


def _stun(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if value is not None and not isinstance(value, dict):
        raise ValueError("stun must be an object {duration_s} or null (F15/A20)")
    if value is None:
        cfg.pop("stun", None)
    else:
        stun: Stun = {}
        if "duration_s" in value:
            stun["duration_s"] = value["duration_s"]
        cfg["stun"] = stun


def _player_num_base(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    if not (isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= MAX_PLAYERS):
        raise ValueError("player_num_base must be 1..63")
    cfg["player_num_base"] = value


def _loadout_policy(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    cfg["loadout_policy"] = _policy.merge(cfg.get("loadout_policy") or _policy.default_policy(mode), value)


def _presentation(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    cfg["presentation"] = _pres.merge(cfg.get("presentation") or _pres.default_for(mode), value)


def _mode(cfg: GameConfig, value: Any, mode: str, defaults: Defaults) -> None:
    cfg["mode"] = value


_HANDLERS: dict[str, Handler] = {
    "time_limit_s": _time_limit, "environment": _environment, "night": _night,
    "recoil": _recoil, "volume": _volume, "coverage": _coverage,
    "respawn": _respawn, "scoring": _scoring, "health": _health, "teams": _teams,
    "led": _led, "station_source": _station_source, "mode_params": _mode_params,
    "vip_player_id": _vip_player_id, "stun": _stun, "player_num_base": _player_num_base,
    "loadout_policy": _loadout_policy, "presentation": _presentation, "mode": _mode,
}


def merge_config(cfg: GameConfig, patch: dict, mode: str, defaults: Defaults) -> GameConfig:
    """Apply each known key in patch order; retain the caller's config object."""
    for key, value in patch.items():
        if key not in CONFIG_KEYS:
            continue
        handler = _HANDLERS.get(key)
        if handler is not None:
            handler(cfg, value, mode, defaults)
    return cfg
