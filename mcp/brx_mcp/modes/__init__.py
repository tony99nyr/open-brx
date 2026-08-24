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
    Respawn, Roster, Score, SendFrame, SetTeam,
    is_hit, is_death, shooter_team,
)
from .deathmatch import DeathmatchEngine
from .survival import InfectionEngine
from .lms import LastManStandingEngine
from .cs import BombEngine
from .driver import GameDriver, build_engine, run_live
# Extraction engine + its non-colliding data classes (config/game/results).
from .extraction import ExtractionConfig, ExtractionGame

__all__ = [
    # M0 base actions + interface
    "Action", "Callout", "Eliminate", "GameEngine", "GameOver", "Heal",
    "PlaySound", "Player", "Respawn", "Roster", "Score", "SendFrame", "SetTeam",
    "is_hit", "is_death", "shooter_team",
    # engines + driver
    "DeathmatchEngine", "InfectionEngine", "LastManStandingEngine", "BombEngine",
    "GameDriver", "build_engine", "run_live",
    # extraction (import its Actions from .extraction directly)
    "ExtractionConfig", "ExtractionGame",
]
