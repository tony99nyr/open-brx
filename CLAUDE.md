# BRX Open Battle System

Open-source platform orchestrating Battle Company BRX laser taggers. Specs:
`docs/brx-architecture-v0.2.md` (master plan), `docs/brx-mcp-spec.md`,
`protocol/brx-protocol.md` (serial command reference — the ground truth for all tagger I/O).

**Before any hardware/protocol work, read:** `docs/experiment-log.md` (what's been tried,
what happened — append your own results after each session), `docs/reference/brx-manual-notes.md`
(distilled official manual: game-start flow, headset lockout, stock weapon/character stats),
`docs/HANDOFF.md` (current cross-machine state), `docs/field-architecture.md`
(how a real out-of-range match works — read before designing game logic),
`docs/apk-investigation.md` (highest-leverage desk work, no hardware needed), and
`docs/mac-capture-plan.md`
(experiments only the MacBook can run — Callsign is iOS-only, PacketLogger is
macOS-only). Full manual PDF: `docs/reference/`.

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
