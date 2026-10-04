"""Pure checks for game config keys shared by patch merging and whole-config validation.

The callers own their messages and their different acceptance rules. This module has no Session state.
"""
from __future__ import annotations

from typing import Any, get_args

from .. import poolgauge as pg
from .types import (HOLD_TARGET_MAX_S, RESPAWN_DELAY_MAX_S, TIME_LIMIT_MAX_S,
                    TIMED_PROTECT_S_DEFAULT, WEAPON_DELAY_MS_DEFAULT, STATION_PROTECT_S_DEFAULT,
                    TimedProtectS, WeaponDelayMs, StationProtectS)


def bounded_int(value: object, low: int, high: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def patch_time_limit(value: object) -> bool:
    return value is None or bounded_int(value, 1, TIME_LIMIT_MAX_S)


def config_needs_time_limit(value: Any, asserted: bool) -> bool:
    # Whole-config validation predates the patch type gate. Keep its comparison behaviour.
    return not asserted and (value is None or value <= 0)


def respawn_type_ok(value: object) -> bool:
    return value in ("auto", "scanner", "none")


def respawn_delay_ok(value: object) -> bool:
    return bounded_int(value, 0, RESPAWN_DELAY_MAX_S)


def respawn_delay_unsafe(value: object) -> bool:
    return value in (1, 2)


def auto_respawn_in_lms(mode: str, respawn: Any) -> bool:
    return mode == "lms" and respawn.get("type") == "auto"


def respawn_profile_options(respawn: Any) -> None:
    for name, default, options in (("protect_s", TIMED_PROTECT_S_DEFAULT, get_args(TimedProtectS)),
                                   ("weapon_delay_ms", WEAPON_DELAY_MS_DEFAULT, get_args(WeaponDelayMs)),
                                   ("station_protect_s", STATION_PROTECT_S_DEFAULT, get_args(StationProtectS))):
        value = respawn.get(name, default)
        if isinstance(value, bool) or value not in options:
            raise ValueError(f"respawn.{name} must be one of {', '.join(str(o) for o in options)}")


def frag_limit_ok(value: object) -> bool:
    return value is None or (isinstance(value, int) and not isinstance(value, bool) and value > 0)


def hold_target_ok(value: object) -> bool:
    return bounded_int(value, 1, HOLD_TARGET_MAX_S)


def frag_limit_needs_coverage(scoring: Any, covered: bool) -> bool:
    return ((scoring.get("frag_limit") or 0) > 0
            and scoring.get("win_by") in (None, "", "kills") and not covered)



def health_pool_ok(name: str, value: object) -> bool:
    return bounded_int(value, 1 if name == "max_hp" else 0, 255)




def team_patch_shape(value: object) -> bool:
    return (isinstance(value, list) and all(isinstance(t, dict) and "team_id" in t
            and isinstance(t.get("tid"), int) and not isinstance(t.get("tid"), bool) for t in value))


def team_tids(teams: Any) -> list:
    return [team["tid"] for team in teams]



def duplicate_team_values(teams: Any, key: str) -> list[str]:
    counts: dict[str, int] = {}
    for team in teams:
        name = str(team[key])
        counts[name] = counts.get(name, 0) + 1
    return sorted(name for name, count in counts.items() if count > 1)


def invalid_team_tids(tids: list) -> list:
    return [tid for tid in tids if not (isinstance(tid, int) and not isinstance(tid, bool)
                                        and tid in pg.TEAM_TIDS)]



def neutral_team_ids(teams: Any, neutral_tid: int) -> list[str]:
    return sorted({str(team.get("team_id")) for team in teams if team.get("tid") == neutral_tid})


def vip_patch_shape(value: object) -> bool:
    return value is None or (isinstance(value, str) and bool(value))


def vip_on_roster(value: object, roster: Any) -> bool:
    return isinstance(value, str) and value in {str(player.get("player_id")) for player in roster}


def vip_presentation(presentation: dict) -> bool:
    return presentation.get("preset") == "vip"
