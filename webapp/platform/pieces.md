# The pieces
_Six components, one decoded protocol, one event stream._
Last verified: 2026-08-27

## One of these you can run today; five are under construction.
`brx-mcp` is documented in full. Mission Control, the phone HUD, the Companion, the Utility Box and effect nodes are still being built — each gets a 🚧 card here and nothing more until it has run on real hardware. (brief §10) ✅🚧

All six pieces share the decoded BRX protocol, the `brx-mcp` command layer, and the node↔MC WebSocket contract (`docs/spec/contracts.md`). Everything is a subscriber to the same event stream — scoreboard, lights, smoke, announcer are peers. ✅ (protocol) / 🧪 (contracts)
Source: README.md §Prime directives, docs/spec/contracts.md

## brx-mcp — the lab instrument
✅
- **What:** a Python package that is both a CLI and an MCP server, giving direct BLE control of taggers from whichever machine owns the Bluetooth radio (Windows / macOS / Linux; `bleak`).
- **Commands:** `scan` · `identify` · `listen` · `probe` · `diagnose` / `fleet` (firmware, battery, per-tagger health) · `play <mode> <addrs…>` (modes: tdm ffa infection lms cs domination koth ctf extraction) · `game-sim` / `extraction-sim` (no hardware) · `usb-query` (armory record over USB) · `ir-capture` / `ir-emit` / `ir-range` (the ESP32 IR rig) · `panic`.
- **Safety:** refuses malformed frames; commands outside the known-safe list need `confirm=true`; `panic` = `$CLEAR,*` then `$SP,99,*`.
- **Proven:** a full TDM on 2 taggers; 3-gun synchronised arm; diagnostics; custom `$WEAP` loadouts; native kill flash + announcer over BLE from our stack.
Source: README.md, mcp/brx_mcp/, docs/verification-checklist.md Session A/C½/D

## Mission Control — the operator console 🚧
Under construction — details when it has run on real hardware.

## BRX Combat HUD — the phone node 🚧
Under construction — details when it has run on real hardware.

## BRX Companion — the ESP32-S3 rider 🚧
Under construction — details when it has run on real hardware.

## BRX Utility Box — the objective station 🚧
Under construction — details when it has run on real hardware.

## Effect nodes — smoke, lights, DMX, music 🚧
Under construction — details when it has run on real hardware.

_[image PLAT-10: Real photo: the ESP32 IR transceiver rig on a breadboard next to a tagger — the instrument that proved synthetic shots.]_
