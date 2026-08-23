# Handoff — BRX work, state as of 2026-08-23 (evening)

**You are:** Claude picking this up on Tony's MacBook. Read `CLAUDE.md` first, then this.
Protocol ground truth: `protocol/brx-protocol.md` — §7e (game start) and §7f (combat) are
the important new sections. Also read `docs/reference/brx-manual-notes.md` (official
manual, distilled) and `docs/experiment-log.md` (shared lab notebook — append your results).

## The headline: remote game start is SOLVED

The project's central blocker is gone. `python -m brx_mcp startgame <uuid>` configures a
tagger and takes it live — verified on hardware, gun fires, ammo decrements. The sequence
is in §7e, transcribed from a PacketLogger capture of the official iOS Callsign app.

Three things had been missing, which is why every earlier attempt configured the gun but
never made it live:
1. `$AMMO,<slot>,<mag>,<reserve>,<flag>,*` after spawn — undocumented until today.
2. All seven `$BMAP` entries, plus `$BMAP,0,0,,,,,*` **again after** `$SPAWN`.
3. `$SPAWN,,*` with the empty token, not `$SPAWN,*`.

Combat, death and host-driven respawn are captured too (§7f).

## Environment (macOS, already set up)

- venv: `.venv` built with `/opt/homebrew/bin/python3.13` (system python3 is 3.9 — too old).
  `pip install -e ./mcp`. Extras installed for tooling: `pyserial`, `numpy`.
- The `mcp` PyPI package resolved to **2.0.0**, which moved `mcp.server.fastmcp` →
  `mcp.server.mcpserver`. **`server.py` (MCP-server mode) is therefore broken.** The CLI
  is unaffected. Fix by pinning `mcp>=1.2,<2` or porting the ~15 decorators.
- `cat` is aliased to `bat` in this shell — use `sed -n`/`python` for file reads in scripts.

## Hardware truths learned today

- **Two taggers, both `v4.32` / `devhost.03`, `devHost 1`** — these are developer/host
  images, not retail. Callsign warns "supported version is until v2.01e" (an UPPER bound —
  the guns are ahead of the app's range) but the warning is **soft**: games still run.
- **The MCU is a Teensy.** Micro-USB enumerates as `USB Serial` / `Teensyduino`.
- **USB console commands are `QUERY` and `SETUP`** (from LaserTagMods' notes). `QUERY` is
  read-only and dumps everything: versions, serial/head PIN, voltages, NRF + devHost flags.
  A backup lives in `~/.brx-mcp/device-backups/`. `SETUP` is factory provisioning
  (asks for the headset serial); entering it and power-cycling out changed **nothing**.
- **Firmware cannot be backed up** — Teensy's HalfKay bootloader is write-only. Do not
  reflash without Battle Company supplying a rollback image. The email to them was never
  sent; that's still the open question about what `devhost.03` is.
- The `$` protocol is a **115200 UART**; BLE and the Gen1 HC-05 are both bridges onto it.
  There is no external accessory port, so a wired tap means opening the gun.

## BLE: it works, connecting is just flaky

**Do not repeat today's wrong turn.** We spent hours concluding the link "dies after 6 s"
and even that the firmware's BLE stack was broken. Both were wrong. Reality:

- **Establishment is intermittent (~1 in 3), holding is fine.** A clean session runs 75 s+
  (ours) and 80 s+ (the app, §7e). `ble.py` now retries 5×; that was the whole fix.
- The lesson: never conclude anything about the link from two or three attempts.

## What's worth doing next

1. **Differential captures to decode `$GSET`** — capture the same game type twice with one
   setting changed (e.g. score-to-win 50 → 25) and diff. `diff_captures` already exists.
   Same method cracks `$WEAP`'s 44 tokens. Highest value for the game engine.
2. **Two-tagger capture with distinct player IDs** — §7f could not confirm `$HIR` shooter
   attribution because every hit read `1,1` in a 2-player game.
3. **Fix `server.py`** for the mcp 2.0 API if MCP-server mode is wanted.
4. **The lobby question** (§7g): game discovery between phones takes ~1 minute and is not
   BLE — it looks like a cloud round-trip. An open system needs its own answer. Capturing
   the phone's *network* traffic (not Bluetooth) would settle it.

## Dead ends — don't redo these

- **Sound-bank sweep by microphone.** Built it, and the negative control failed: a nonsense
  id (`ZZ99`) still produced audio, so the tagger appears to play a fallback sound for
  unknown ids. "Audio detected" never proved "id exists". **And there is no SD card to read
  instead** — the official manual confirms the BRX has none (that's a commercial-line
  feature). If the sound bank is ever wanted, the realistic routes are the official
  updater's sound package or asking Battle Company; do not repeat the microphone sweep.
- **`listen ... pair` on macOS** — CoreBluetooth has no pairing API. Now a no-op, not a crash.
- **Chasing the version gate.** It is soft. Games run on v4.32 regardless.

## Working agreements with Tony

- Hands-on and fast: give one clear physical instruction at a time and say exactly what to
  report. Power-cycle between experiments.
- **His observations are data.** "No disconnect voice" and "it works maybe 1 in 3" each
  overturned a confident wrong conclusion today. Ask for what he hears, and believe it.
- Volume: `CLAUDE.md` says 30, but **30 is measurably inaudible** for weapon audio — the
  app uses 69. `startgame` takes volume as a CLI arg; the default is still 30 per the rule.
- Never modify tagger firmware; credit LaserTagMods (JEDGE/JBOX) publicly.
- **LaserTagMods' repos carry no license** (all rights reserved). Their protocol *findings*
  are restated independently in our docs — do not copy their code into this MIT project.
