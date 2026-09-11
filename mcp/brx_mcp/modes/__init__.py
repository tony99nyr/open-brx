"""Host-side game-mode rule engines for Open BRX.

The BRX tagger keeps no host-readable game state, so every mode lives here: a pure
rules engine that consumes the parsed event stream + wall-clock ticks and emits
*actions* (frames to send, respawns, heals, sounds, score). Engines are
transport-free — the same module runs on a Companion node, in the MCP host, or in
a unit test with synthetic events. A driver translates Actions into BLE writes.

M0: the combat modes (deathmatch, infection, lms), a customizable GameConfig
(brx_mcp/gameconfig.py), and the GameDriver that runs them live.

NOTE: the flagship **Extraction** engine (`extraction.py`) has its OWN richer action
set (Bank/ChannelStarted/…/its own GameOver) for the narrated sim. To avoid clobbering
the M0 base actions of the same name, import Extraction's action classes from
`brx_mcp.modes.extraction` directly — this package exports the M0 base actions.
"""

from .base import (
    Action, Callout, Eliminate, GameEngine, GameOver, Heal, PlaySound, Player,
    Respawn, Roster, Score, ScoredEngine, SendFrame, SetTeam,
    is_hit, is_death, shooter_team, shooter_player_id,
)
from .deathmatch import DeathmatchEngine
from .survival import InfectionEngine
from .lms import LastManStandingEngine
from .cs import BombEngine
from .objectives import DominationEngine, CtfEngine
from . import hillbeacon
from .hillbeacon import HillBeaconReader
from .driver import GameDriver, build_engine, run_live, assign_teams, clean_callsign
# A18 / E1: engine-declared mode parameters + the name -> engine table (the E2 seed)
from .params import Param
from . import registry
from .registry import engine_class, params_schema, params_schema_json, register_mode, validate_mode_params
# Extraction engine + its non-colliding data classes (config/game/results).
from .extraction import ExtractionConfig, ExtractionGame
from .extraction_adapter import ExtractionEngineAdapter

__all__ = [
    # M0 base actions + interface
    "Action", "Callout", "Eliminate", "GameEngine", "GameOver", "Heal",
    "PlaySound", "Player", "Respawn", "Roster", "Score", "ScoredEngine",
    "SendFrame", "SetTeam",
    "is_hit", "is_death", "shooter_team", "shooter_player_id",
    # engines + driver
    "DeathmatchEngine", "InfectionEngine", "LastManStandingEngine", "BombEngine",
    "DominationEngine", "CtfEngine",
    # the grenade-hill bridge (proto-15 $HIR -> objective state); the module is exported too
    # so the MC server can reach the wire constants without importing an engine.
    "hillbeacon", "HillBeaconReader",
    "GameDriver", "build_engine", "run_live", "assign_teams", "clean_callsign",
    "Param", "registry", "engine_class", "params_schema", "params_schema_json", "register_mode",
    "validate_mode_params",
    # extraction (import its Actions from .extraction directly)
    "ExtractionConfig", "ExtractionGame", "ExtractionEngineAdapter",
]
