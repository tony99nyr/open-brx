# Open BRX

Open-source platform orchestrating Battle Company BRX laser taggers.
**Strategy/vision:** `docs/VISION.md`; what-to-build-by-budget: `docs/build-tiers.md`; mode catalog:
`docs/game-modes.md`. Specs:
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
- **Volume:** the diagnostic default is `$VOL,30` (kind to ears indoors), but **30 is measurably
  inaudible for weapon/game audio** — use **69** (the app's value) for real games. CLI game commands
  take volume as an argument; keep the low default for probing, pass 69 for play.

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
`app/` native phone app (Capacitor → Android + iOS; see `app/README.md`) ·
`firmware/` PlatformIO ESP32 flavors · `server/` game engine + MQTT · `webapp/` static site
(Mission Control + the Web-Bluetooth **test harness** — Web BT is not the player path) ·
`hardware/` STLs/BOM · `protocol/` + `docs/` reference.

**Generated, never hand-edit:** `app/ios/`, `app/android/`, `app/www/app.js` (all git-ignored and
rebuilt by `npm run` scripts). iOS settings we depend on live in `app/scripts/ios-setup.sh`, not in
the Xcode project — regenerating the platform wipes anything edited there.
