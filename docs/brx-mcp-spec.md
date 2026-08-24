# BRX MCP Server — Specification (Draft v0.1)

> **Note (2026-08-24):** original draft spec. The `mcp/` package is now implemented and ahead of this
> doc (actual CLI/tools: scan/identify/listen/probe/startgame/deathmatch/arena/fieldstart/diagnose/
> fleet…). The §6 repo-layout block (`brx-tools/`) is superseded by the root `README.md` tree
> (`open-brx` with `mcp/`). Kept for the original tool-design rationale.

**Purpose:** An MCP server that gives Claude Code (and any MCP client) direct control of BRX taggers over Bluetooth — scan, identify, connect, send `$` commands, and observe live tagger traffic. Primary use cases: (1) interactive protocol reverse-engineering, (2) tagger configuration/diagnostics, (3) later, game-master control via the game server API.

**Companion doc:** `brx-protocol.md` (serial command reference). Ship it as an MCP *resource* so the model always has the protocol in context.

---

## 1. Stack

- **Language:** Python 3.11+
- **BLE:** `bleak` (cross-platform: macOS, Linux/Pi, Windows)
- **MCP framework:** official `mcp` Python SDK (FastMCP), stdio transport
- **Install target:** runs on the laptop/Pi that has the Bluetooth radio; registered in Claude Code via `claude mcp add brx -- python -m brx_mcp`

Constraint to design around: MCP is request/response — no server push. Live tagger notifications are captured by a background listener into per-device ring buffers (with monotonic sequence numbers + timestamps), and the model polls with `get_events`.

## 2. Tools

### Discovery & identification
- **`scan(duration_s: int = 8) -> list[Device]`**
  BLE scan. Returns `{name, address, rssi, has_uart_service}` per device. Flags likely BRX gear (Nordic UART service `6E400001-…`).
- **`identify(address) -> DeviceInfo`**
  Connects briefly, sends `$PING,*`, reports: reachable?, PONG latency, inferred generation (BLE+PONG → Gen2/3; instruct user re Gen1/Classic fallback), advertised name.

### Connection lifecycle
- **`connect(address, alias: str)`** — open BLE session, subscribe to TX notifications, start buffering events. Aliases (e.g. `"tagger1"`, `"grenade"`) are used by all other tools. Multiple simultaneous connections supported (target: 4+).
- **`disconnect(alias)`** / **`list_connections()`** — with per-connection status, buffer depth, last-seen.

### Protocol I/O
- **`send(alias, command: str) -> SendResult`**
  Send one raw command (e.g. `$GLED,1,1,1,0,10,,*`). Validates framing (`$…,*`). Returns echo of any reply arriving within `reply_window_ms` (default 500).
- **`send_batch(alias, commands: list[str], gap_ms: int = 100)`**
  Ordered command sequence with pacing (config sequences like CLEAR→START→GSET→PSET→SIR×n→BMAP need pacing to not overrun the tagger).
- **`get_events(alias, since_seq: int = 0, max: int = 200) -> Events`**
  Drain buffered tagger→host messages: `{seq, t_ms, raw, parsed}` where `parsed` is best-effort tokenization ( `$HIR` → shooter id/team; `$HP` → health; `$BUT` → button id).
- **`wait_for(alias, prefix: str, timeout_s: int = 30)`**
  Block until a message starting with e.g. `$HIR` or `$BUT` arrives. This is the workhorse for human-in-the-loop experiments: *"send this $WEAP, then wait_for $BUT while the user pulls the trigger."*

### Experiment support (reverse-engineering QoL)
- **`session_log(alias, action: "start"|"stop"|"dump", label: str)`**
  Timestamped capture of ALL traffic both directions to a JSONL file — the raw material for diffing official-app behavior vs ours.
- **`diff_captures(file_a, file_b)`** — token-level diff of two captures (e.g. app sets damage 24 vs 38 → which `$WEAP` token changed).

### Safety rails
- Refuse malformed frames; require explicit `confirm=true` arg on commands not in the known-safe list from `brx-protocol.md` §3.
- `panic(alias)` tool: sends `$CLEAR,*` + `$SP,99,*` to return tagger to a sane state.
- Nothing here can brick a tagger — stock firmware is untouched; power-cycle always restores.

## 3. Resources
- `brx://protocol` → contents of `brx-protocol.md`
- `brx://captures/{label}` → saved session logs
- `brx://known-devices` → persisted address↔alias↔generation registry (JSON on disk)

## 4. Prompts (optional, nice for community)
- `probe-new-device` — guided flow: scan → identify → read-only listen session → report findings
- `weap-field-mapping` — guided one-token-at-a-time `$WEAP` experiment protocol

## 5. Milestones
1. **M1:** scan / identify / connect / send / get_events against one tagger. (Answers "what gen are mine" definitively.)
2. **M2:** 4 concurrent connections + session_log + wait_for. (Full experiment rig.)
3. **M3:** diff_captures + grenade probe. (`$WEAP` field map, grenade findings → protocol doc v0.2.)
4. **M4 (later):** second transport backend — same tools, but proxied via the game server's MQTT/HTTP API instead of local BLE, so Claude Code can game-master a live 20-tagger match. Design the tool layer transport-agnostic from day one.

## 6. Repo placement
```
brx-tools/
  protocol/brx-protocol.md
  mcp/               # this server (pip installable: brx-mcp)
  bridge-firmware/   # ESP32 (PlatformIO + ESP Web Tools manifest)
  server/            # game engine, MQTT, scoreboard
  webapp/            # Web Bluetooth one-stop-shop
  hardware/          # STLs, wiring, BOM
  docs/
```
License: MIT. Credit: LaserTagMods (JEDGE/JBOX) for original protocol discovery.
