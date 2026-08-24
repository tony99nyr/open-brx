"""BRX MCP server — Claude Code (or any MCP client) drives BRX taggers over BLE.

Spec: docs/brx-mcp-spec.md. Protocol reference: protocol/brx-protocol.md
(shipped as the brx://protocol resource).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import protocol, storage
from .ble import ConnectionManager

mcp = FastMCP("brx")
manager = ConnectionManager()

# protocol/brx-protocol.md. The server is installed editable from the repo
# checkout (see CLAUDE.md), so the first path resolves. The package does NOT
# vendor its own copy (the doc lives outside mcp/), so a non-editable wheel
# install won't serve brx://protocol — the resource says so rather than 404ing
# silently. A BRX_PROTOCOL_MD env var overrides for other layouts.
_PROTOCOL_CANDIDATES = [
    p for p in (
        os.environ.get("BRX_PROTOCOL_MD"),
        Path(__file__).resolve().parents[2] / "protocol" / "brx-protocol.md",
        Path(__file__).resolve().parent / "brx-protocol.md",
    ) if p
]


# -- discovery & identification -------------------------------------------

@mcp.tool()
async def scan(duration_s: int = 8) -> list[dict[str, Any]]:
    """BLE scan for nearby devices. BRX Gen2/3 taggers advertise the Nordic
    UART service and are flagged with has_uart_service=true and sorted first.
    A tagger that never appears here is likely Gen1 (Bluetooth Classic)."""
    return await manager.scan(duration_s)


@mcp.tool()
async def identify(address: str) -> dict[str, Any]:
    """Connect briefly to a BLE address, send $PING,*, and report: reachable?,
    PONG latency, inferred generation. Saves the result to the device registry."""
    info = await manager.identify(address)
    storage.save_device(address, generation=info.get("generation"))
    return info


# -- connection lifecycle --------------------------------------------------

@mcp.tool()
async def connect(address: str, alias: str) -> dict[str, Any]:
    """Open a persistent BLE session to a tagger and start buffering its
    messages. All other tools refer to the session by this alias (e.g.
    'tagger1'). Multiple simultaneous connections are supported."""
    result = await manager.connect(address, alias)
    storage.save_device(address, alias=alias)
    return result


@mcp.tool()
async def disconnect(alias: str) -> dict[str, Any]:
    """Close the BLE session for an alias."""
    return await manager.disconnect(alias)


@mcp.tool()
def list_connections() -> list[dict[str, Any]]:
    """List open sessions: alias, address, connected, buffer depth, last-seen."""
    return manager.list_connections()


# -- protocol I/O ----------------------------------------------------------

@mcp.tool()
async def send(alias: str, command: str, confirm: bool = False,
               reply_window_ms: int = 500) -> dict[str, Any]:
    """Send one raw framed command (e.g. '$GLED,1,1,1,0,10,,*') and return any
    replies arriving within reply_window_ms. Commands outside the known-safe
    list from brx-protocol.md require confirm=true."""
    err = protocol.validate_frame(command)
    if err:
        return {"error": f"malformed frame: {err}", "command": command}
    if not protocol.is_known_safe(command) and not confirm:
        return {"error": f"'{protocol.command_name(command)}' is not in the "
                         "known-safe command list; retry with confirm=true "
                         "if you intend to send it",
                "command": command}
    return await manager.send(alias, command, reply_window_ms)


@mcp.tool()
async def send_batch(alias: str, commands: list[str], gap_ms: int = 100,
                     confirm: bool = False) -> dict[str, Any]:
    """Send an ordered command sequence with pacing between frames (config
    sequences like CLEAR→START→GSET→PSET→SIR×n→BMAP need pacing so the tagger
    isn't overrun). Same safety rules as send()."""
    for cmd in commands:
        err = protocol.validate_frame(cmd)
        if err:
            return {"error": f"malformed frame: {err}", "command": cmd}
        if not protocol.is_known_safe(cmd) and not confirm:
            return {"error": f"'{protocol.command_name(cmd)}' is not known-safe; "
                             "retry with confirm=true", "command": cmd}
    return await manager.send_batch(alias, commands, gap_ms)


@mcp.tool()
def get_events(alias: str, since_seq: int = 0,
               max_events: int = 200) -> dict[str, Any]:
    """Drain buffered tagger→host messages newer than since_seq. Each event:
    {seq, t_ms, direction, raw, parsed} — parsed decodes $HIR (shooter id/team),
    $HP (health/death), $BUT (button)."""
    return manager.get_events(alias, since_seq, max_events)


@mcp.tool()
async def wait_for(alias: str, prefix: str, timeout_s: int = 30) -> dict[str, Any]:
    """Block until a tagger message starting with prefix (e.g. '$HIR', '$BUT')
    arrives, or time out. The workhorse for human-in-the-loop experiments:
    send a config, then wait_for '$BUT' while the user pulls the trigger."""
    return await manager.wait_for(alias, prefix, timeout_s)


# -- experiment support ----------------------------------------------------

@mcp.tool()
def session_log(alias: str, action: str, label: str = "") -> dict[str, Any]:
    """Timestamped capture of ALL traffic both directions to a JSONL file.
    action: 'start' (begin logging to captures/<label>.jsonl), 'stop', or
    'dump' (return the file path + line count)."""
    session = manager._get(alias)
    if action == "start":
        if not label:
            return {"error": "label required for start"}
        storage.ensure_dirs()
        path = storage.capture_path(label)
        session.log_file = path
        session.log_label = label
        return {"logging": True, "label": label, "path": str(path)}
    if action == "stop":
        stopped = session.log_label
        session.log_file = None
        session.log_label = None
        return {"logging": False, "stopped_label": stopped}
    if action == "dump":
        target = storage.capture_path(label or (session.log_label or ""))
        if not target.exists():
            return {"error": f"no capture at {target}",
                    "available": storage.list_captures()}
        lines = target.read_text(encoding="utf-8").splitlines()
        return {"label": target.stem, "path": str(target), "line_count": len(lines)}
    return {"error": "action must be start|stop|dump"}


@mcp.tool()
def diff_captures(file_a: str, file_b: str) -> dict[str, Any]:
    """Token-level diff of two session captures (paths or bare labels). Use to
    crack field meanings: capture the official app setting damage=24, then
    damage=38, and diff to see which $WEAP token changed."""
    return storage.diff_captures(file_a, file_b)


# -- safety ----------------------------------------------------------------

@mcp.tool()
async def panic(alias: str) -> dict[str, Any]:
    """Return a tagger to a sane state: sends $CLEAR,* then $SP,99,*.
    (Power-cycling the tagger always restores it fully — stock firmware is
    never modified.)"""
    return await manager.send_batch(alias, protocol.PANIC_SEQUENCE, gap_ms=200)


# -- resources -------------------------------------------------------------

@mcp.resource("brx://protocol")
def protocol_doc() -> str:
    """The BRX serial protocol reference (brx-protocol.md)."""
    for candidate in _PROTOCOL_CANDIDATES:
        path = Path(candidate)
        if path.exists():
            return path.read_text(encoding="utf-8")
    return "brx-protocol.md not found alongside the package"


@mcp.resource("brx://known-devices")
def known_devices() -> str:
    """Persisted address ↔ alias ↔ generation registry."""
    import json
    return json.dumps(storage.load_registry(), indent=2)


@mcp.resource("brx://captures/{label}")
def capture(label: str) -> str:
    """A saved session log (JSONL)."""
    path = storage.capture_path(label)
    if not path.exists():
        return f"no capture named '{label}'; available: {storage.list_captures()}"
    return path.read_text(encoding="utf-8")


def main() -> None:
    storage.ensure_dirs()
    mcp.run()


if __name__ == "__main__":
    main()
