"""Host-side game-mode rule engines for Open BRX.

The BRX tagger keeps no game state (protocol/brx-protocol.md §7n), so every mode
lives here: a pure rules engine that consumes the parsed event stream + wall-clock
ticks and emits *actions* (frames to send, callouts to play, score updates). The
engines are deliberately transport-free — the same module runs on a Companion
node, in the MCP host, or in a unit test with synthetic events. A driver
translates the emitted Actions into BLE writes / audio.
"""

from .extraction import (
    Action,
    Bank,
    Callout,
    ChannelReset,
    ChannelStarted,
    Extracted,
    ExtractionConfig,
    ExtractionGame,
    GameOver,
    LootDropped,
    SendFrame,
)

__all__ = [
    "Action",
    "Bank",
    "Callout",
    "ChannelReset",
    "ChannelStarted",
    "Extracted",
    "ExtractionConfig",
    "ExtractionGame",
    "GameOver",
    "LootDropped",
    "SendFrame",
]
