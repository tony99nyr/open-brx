# Getting started with `brx-mcp`
_From `pip install` to a live game in six commands — plus the MCP tools for driving a gun from an AI agent_
Last verified: 2026-08-27

`brx-mcp` is the project's lab instrument: a pure-Python (`bleak` + `mcp`) CLI and MCP server that runs on **whichever machine owns the Bluetooth radio** — Windows, macOS or Linux. It enforces the known-safe list, refuses malformed frames, records every session, and has a `panic` tool.
Source: README.md (quickstart, Safety)

```bash
# on the machine with the BLE radio (Windows PowerShell, macOS terminal, or Linux):
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e ./mcp

# first contact — no MCP client needed:
python -m brx_mcp scan             # find taggers (Gen2/3 advertise the Nordic UART service)
python -m brx_mcp identify <addr>  # $PING → generation check, firmware, host image
python -m brx_mcp listen <addr>    # read-only live console: pull the trigger, watch $BUT/$HIR/$HP
```
Source: README.md

```bash
# ...and now actually play. Your laptop drives the guns directly over BLE,
# so everyone stays within BLE range of it (a room or a yard).
python -m brx_mcp play tdm <addr1> <addr2> volume=69   # a real Team Deathmatch with live scoring
#   modes: tdm ffa infection lms cs domination koth ctf extraction
#   run `python -m brx_mcp` with no arguments for the full command list

# no guns to hand? this needs no hardware at all:
python -m brx_mcp game-sim tdm                         # narrated demo match in your terminal

# read the USB device record (tagger on the Programing Port):
python -m brx_mcp usb-query                            # QUERY over the Teensy serial console
```
Source: README.md; mcp/brx_mcp/__main__.py

```bash
# register with Claude Code as an MCP server:
claude mcp add brx -- python -m brx_mcp
# WSL2 has no Bluetooth — develop in WSL, run the server with Windows Python:
claude mcp add brx -- python.exe -m brx_mcp
```
Source: README.md (Platform notes)

## CLI commands
| Command | What it does |
|---|---|
| `scan` · `identify <addr>` · `listen <addr>` · `probe <addr>` | Discover, check, watch, probe a single gun |
| `startgame <addr>` · `deathmatch <addr>` · `arena <addr1> <addr2>` · `fieldstart …` | Earlier single-purpose game drivers (the §7e sequence) |
| `play <mode> <addr…> [volume=69]` | Hosted match with live scoring; modes tdm ffa infection lms cs domination koth ctf extraction |
| `game-sim <mode>` · `extraction-sim` | Hardware-free narrated simulations |
| `diag <addr>` · `diagnose <addr>` · `diag-game <addr>` · `fleet` | Diagnostics, fleet battery/reachability sweep |
| `usb-query [port]` · `enroll` · `armory` · `rename` · `reset` | USB device record, armory enrolment, persistent `$NAME`, reset |
| `ir-capture` · `ir-emit` · `ir-range` | Drive the ESP32 IR transceiver rig |
Source: mcp/brx_mcp/__main__.py (dispatch table)

## MCP tools (what an agent can call)
| Tool | Purpose |
|---|---|
| `scan(duration_s)` · `identify(address)` · `diagnostics(address)` · `fleet_status(addresses)` | Discovery and health |
| `connect(address, alias)` · `disconnect(alias)` · `list_connections()` | Session management |
| `send(alias, command, confirm=False)` · `send_batch(alias, commands, gap_ms=100)` | Write frames; anything outside the known-safe list needs `confirm=True` |
| `get_events(alias, since_seq)` · `wait_for(alias, prefix, timeout_s)` | Read the buffered event stream / block on a message |
| `session_log(alias, action, label)` · `diff_captures(file_a, file_b)` | Record and diff sessions |
| `panic(alias)` | `$CLEAR,*` then `$SP,99,*` |
| `parse_query_dump(text)` | Parse a USB `QUERY` record |
| Resources: `protocol_doc`, `known_devices`, `capture` | The protocol reference, the device registry, capture files |
Source: mcp/brx_mcp/server.py

## Platform notes.
macOS: grant your terminal Bluetooth permission; CoreBluetooth reports per-machine **UUIDs instead of MAC addresses**, so never pattern-match on address format and expect to re-scan per machine. Gen1 taggers use Bluetooth Classic — `bleak` is BLE-only, so pair in the OS and use the serial port (guide todo). Captures and the device registry live in `~/.brx-mcp/`.
Source: README.md; CLAUDE.md; docs/gotchas.md

## Recommended first session (safe order)
1. `scan` → note the address. `identify` → confirm `$PONG` and read the `$VERSION` reply.
2. `listen` read-only: pull the trigger, get tagged by another gun, watch `$BUT`/`$HIR`/`$HP` — send **no** config yet.
3. `play tdm … volume=69` on two guns; confirm each echoes `$LCD,45,70,0,0,36,216` on spawn.
4. If anything looks wrong: `panic`, then power-cycle — that always restores the tagger.
Source: protocol/brx-protocol.md §8; README.md
