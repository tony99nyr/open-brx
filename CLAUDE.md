# BRX Open Battle System

Open-source platform orchestrating Battle Company BRX laser taggers. Specs:
`docs/brx-architecture-v0.2.md` (master plan), `docs/brx-mcp-spec.md`,
`protocol/brx-protocol.md` (serial command reference — the ground truth for all tagger I/O).

**Start with [`docs/README.md`](docs/README.md)** — the docs index. Before any hardware/protocol
work also read `docs/HANDOFF.md` (current state), `docs/experiment-log.md` (lab notebook — **append
after every session**), and `docs/FOLLOWUPS.md` (consolidated open work). Ground truth:
`protocol/brx-protocol.md` + `protocol/callsign-extract/` (APK teardown: command/field maps, WEAP
token positions, 2166-id sound bank, game modes, grenade). System specs: `mission-control-spec.md`,
`phone-app-spec.md`, `hardware/brx-companion-spec.md`. Community/JEDGE facts:
`docs/reference/lasertagmods.md` + `community-notes.md`.

## Hard rules

- **Never modify stock BRX firmware.** All control is over the Bluetooth serial protocol.
- Credit **LaserTagMods** (JEDGE/JBOX) for protocol discovery in anything public-facing.
- MCP/server enforce the known-safe command list (`protocol.py`); unknown commands need
  explicit confirm. Panic sequence: `$CLEAR,*` then `$SP,99,*`.

## Environment (important)

- Development happens in **WSL2, which has no Bluetooth**. The `brx-mcp` server runs on
  **Windows Python** via WSL interop:
  - Windows venv: `C:\Users\Tony\.brx-mcp\venv` (from WSL: `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`)
  - Installed editable from `\\wsl.localhost\Ubuntu-24.04\home\tony\gitrepos\battlecompany\mcp`
    — code edits in WSL take effect immediately, no reinstall.
  - CLI first contact: `python.exe -m brx_mcp scan|identify|listen`.
- Match-day target is a **MacBook**: everything in `mcp/` must stay cross-platform
  (bleak: WinRT/CoreBluetooth/BlueZ). macOS gives BLE UUIDs, not MAC addresses — never
  assume address formats.
- Captures + device registry live in `~/.brx-mcp/` on the machine running the server
  (i.e. `C:\Users\Tony\.brx-mcp\` here).

## Layout

`mcp/` Python MCP server (M1–M3 lab instrument, later game-master backend) ·
`firmware/` PlatformIO ESP32 flavors · `server/` game engine + MQTT · `webapp/` static
Web-Bluetooth site · `hardware/` STLs/BOM · `protocol/` + `docs/` reference.
