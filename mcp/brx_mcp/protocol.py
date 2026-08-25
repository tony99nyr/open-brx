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
    elif name == "VOLTS":
        parsed.update(parse_volts(message))
    elif name == "VERSION":
        parsed.update(parse_version(message))

    return parsed


def _to_int(s: str | None) -> int | None:
    try:
        return int(s) if s not in (None, "") else None
    except (ValueError, TypeError):
        return None


def parse_volts(frame: str) -> dict[str, Any]:
    """`$VOLTS,<pack_mV>,<cell_mV>,<n3>,<n4>,*` battery telemetry.

    e.g. `$VOLTS,7662,3921,55,70,*` → 7.662 V pack, 3.921 V cell; the last two
    tokens read as charge %/levels (exact meaning TBC). Returns {} if not VOLTS.
    """
    t = tokenize(frame)
    if not t or t[0] != "VOLTS":
        return {}
    pack_mv, cell_mv = _to_int(t[1] if len(t) > 1 else None), _to_int(t[2] if len(t) > 2 else None)
    return {
        "pack_mv": pack_mv,
        "cell_mv": cell_mv,
        "pack_v": round(pack_mv / 1000, 3) if pack_mv is not None else None,
        "cell_v": round(cell_mv / 1000, 3) if cell_mv is not None else None,
        "charge_pct": _to_int(t[3] if len(t) > 3 else None),
        "level_pct": _to_int(t[4] if len(t) > 4 else None),
    }


def parse_version(frame: str) -> dict[str, Any]:
    """`$VERSION,<ver>,?,<n>,,<host>,*` firmware version reply.

    e.g. `$VERSION,v4.32,?,4,,devhost.03,*` → firmware v4.32, host image
    devhost.03. `devhost*` host images are developer builds, not retail.
    """
    t = tokenize(frame)
    if not t or t[0] != "VERSION":
        return {}
    host = t[5] if len(t) > 5 else None
    return {
        "firmware": t[1] if len(t) > 1 else None,
        "host_image": host,
        "is_devhost": bool(host and host.lower().startswith("devhost")),
    }


def parse_query(text: str) -> dict[str, Any]:
    """Parse the Teensy USB `QUERY` console dump into a device record.

    The dump is free-form `Label: value` / `Label value` lines. We pull the
    fields we know (serial/head PIN, versions, voltages, radio flags, PCB rev,
    tested-by) by label, and keep the raw text. Robust to line-order changes.
    """
    rec: dict[str, Any] = {"raw": text}
    patterns = {
        "serial_head_pin": r"Serial Number\s*/?\s*Head PIN\s*[:=]?\s*([A-Za-z0-9]+)",
        "bt_central_version": r"BT central V(?:ersion)?\s*[:=]?\s*([A-Za-z0-9.]+)",
        "pcb_rev": r"\b(PCB-?\d+)\b",
        "tested_by": r"Tested by\s*[:=]?\s*([A-Za-z0-9 ]+?)\s*(?:\r?\n|$)",
        "nrf_host": r"NRFhost\s*[:=]?\s*(\d+)",
        "nrf_slave": r"NRFslave\s*[:=]?\s*(\d+)",
        "dev_host": r"devHost\s*[:=]?\s*(\d+)",
        "headset_version": r"Headset Version\s*[:=]?\s*([A-Za-z0-9.]+)",
    }
    for key, pat in patterns.items():
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            v = m.group(1).strip()
            rec[key] = int(v) if v.isdigit() else v
    return rec


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


def extract_frames(buf: str) -> tuple[list[str], str]:
    """Split a notify-reassembly buffer into complete BRX frames + the remainder.

    A frame starts with ``$`` and ends with ``*``; a *new* ``$`` also delimits, so a
    frame that arrives without its trailing ``*`` (the rare merged-notify case seen on
    the bench, e.g. ``$ALCD,…$BUT,0,1,*``) still splits correctly instead of swallowing
    the next one. Bytes before the first ``$`` are dropped. Returns ``(frames,
    remainder)`` where remainder is an as-yet-incomplete tail for the next notification.
    """
    frames: list[str] = []
    while True:
        s = buf.find("$")
        if s < 0:
            return frames, ""
        if s > 0:
            buf = buf[s:]
        star = buf.find("*", 1)
        nd = buf.find("$", 1)
        if star >= 0 and (nd < 0 or star < nd):
            end = star + 1              # complete frame ending in '*'
        elif nd >= 0:
            end = nd                    # truncated -> the next '$' is the boundary
        else:
            return frames, buf          # incomplete -> keep as remainder
        frame = buf[:end].strip()
        buf = buf[end:]
        if frame:
            frames.append(frame)
