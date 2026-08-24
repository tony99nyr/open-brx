"""BRX serial protocol helpers: framing validation, tokenization, event parsing.

Reference: protocol/brx-protocol.md (draft v0.1).
Messages are ASCII, comma-delimited, start with $COMMAND, end with ,*
Empty tokens mean "leave unchanged / not applicable".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# Nordic UART Service (Gen2/3 BLE transport)
NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NUS_RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  # write to tagger
NUS_TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  # notify from tagger

# Tokens may not contain a comma, '*', or a line break; frame must end at \Z
# (so an embedded newline can't smuggle a second frame past validation).
_FRAME_RE = re.compile(r"^\$[A-Z0-9!]+(,[^,*\r\n]*)*,\*\Z")

# Commands documented in brx-protocol.md §3 that are safe to send without an
# explicit confirm=true. Anything else (unknown/undocumented) requires the
# caller to opt in — that is the MCP safety rail, not a tagger limitation.
KNOWN_SAFE_COMMANDS = {
    "PING", "CLEAR", "START", "SPAWN", "CONNECT", "INIT", "PHONE",
    "GSET", "PSET", "WEAP", "SIR", "BMAP", "GLED", "PLAY", "AS", "SP",
    "PBWEAP", "PBTEAM", "PBPERK", "TID",
    # Verified in the official iOS Callsign captures (protocol §7e/§7f):
    # every one of these was sent by the app during a normal game.
    "AMMO", "STOP", "PLAYX", "VOL", "HLED", "NAME", "VERSION", "HLOOP",
    "SFLASH",
}

PANIC_SEQUENCE = ["$CLEAR,*", "$SP,99,*"]


def validate_frame(command: str) -> str | None:
    """Return an error string if the frame is malformed, else None."""
    if not command.startswith("$"):
        return "frame must start with '$'"
    if not command.endswith(",*"):
        return "frame must end with ',*'"
    if not _FRAME_RE.match(command):
        return "frame failed pattern check ($NAME,tokens...,*)"
    return None


def command_name(command: str) -> str:
    """Extract the command word: '$GLED,1,...,*' -> 'GLED'."""
    body = command.lstrip("$")
    # Gen1 replies can be prefixed, e.g. $!DFP,PONG,*
    if body.startswith("!"):
        parts = body.split(",")
        return parts[1] if len(parts) > 1 else parts[0]
    return body.split(",", 1)[0]


def is_known_safe(command: str) -> bool:
    return command_name(command) in KNOWN_SAFE_COMMANDS


def tokenize(message: str) -> list[str]:
    """Split a frame into tokens, stripping the leading $ and trailing *."""
    msg = message.strip()
    if msg.endswith(",*"):
        msg = msg[:-2]
    elif msg.endswith("*"):
        msg = msg[:-1]
    if msg.startswith("$"):
        msg = msg[1:]
    return msg.split(",")


def parse_event(message: str) -> dict[str, Any]:
    """Best-effort semantic parse of a tagger→host message.

    Always returns at least {"command": <name>, "tokens": [...]}.
    Adds typed fields for the messages the protocol doc explains.
    """
    tokens = tokenize(message)
    name = command_name(message)
    parsed: dict[str, Any] = {"command": name, "tokens": tokens}

    def tok(i: int) -> str | None:
        return tokens[i] if i < len(tokens) else None

    if name == "HIR":
        # token 3 = shooter player ID, token 4 = shooter team ID (per protocol §4)
        parsed["shooter_player_id"] = tok(3)
        parsed["shooter_team_id"] = tok(4)
    elif name == "HP":
        hp_raw = tok(1)
        try:
            parsed["hp"] = int(hp_raw) if hp_raw else None
        except ValueError:
            parsed["hp"] = hp_raw
        parsed["died"] = parsed.get("hp") == 0
    elif name == "BUT":
        parsed["button"] = tok(1)
    elif name == "PONG":
        parsed["pong"] = True

    return parsed


@dataclass
class BufferedEvent:
    seq: int
    t_ms: int  # ms since connection opened (monotonic)
    direction: str  # "rx" (tagger→host) or "tx" (host→tagger)
    raw: str
    parsed: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "t_ms": self.t_ms,
            "direction": self.direction,
            "raw": self.raw,
            "parsed": self.parsed,
        }
