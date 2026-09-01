# Open BRX

An open-source (MIT) platform that turns **Battle Company BRX** laser taggers into a fully
orchestrated laser tag system: forced game modes, live scoring, objectives, items/power-ups,
effects, and a mission-control home base — scaling from 4 taggers to 20+. An open, moddable,
self-hosted alternative to Battle Company's Edge software (no subscription, no location lock, and
it works on large fields without venue WiFi).

**Start here:** [`docs/architecture-topology.md`](docs/architecture-topology.md) (**how it's wired,
what the limits are, what's actually proven**) · [`docs/README.md`](docs/README.md) (index) ·
[`docs/VISION.md`](docs/VISION.md) (what we're building & why) ·
[`docs/build-tiers.md`](docs/build-tiers.md) (what you can build at each budget) ·
[`docs/game-modes.md`](docs/game-modes.md) (mode catalog).

> **Credit:** Protocol discovery and the tagger-rider ESP32 concept originate with
> **[LaserTagMods](https://github.com/LaserTagMods)** (JEDGE / JBOX projects). This project is
> a fresh, independent implementation — no code copied — but it stands on that discovery work.

**Prime directives**

1. Stock BRX firmware is **never modified**. All control is via the documented Bluetooth serial
   protocol. Power-cycling always restores a tagger; Battle Company's USB updater is the
   factory-restore path.
2. Store-and-forward everywhere: every node buffers timestamped events locally and syncs when
   in coverage. Live feed is best-effort; final results are always complete.
3. Each per-player **node** runs its own gun's game loop autonomously (offline-capable); **Mission
   Control** (a laptop) authors games and aggregates the scoreboard over the local LAN — it is not a
   live BLE hub, and cross-player truth is eventually-consistent via store-and-forward (ADR-0001/0002).
4. Everything is a subscriber: scoreboard, lights, smoke, announcer are peers on the event stream.

## Repo layout

| Path | What |
|---|---|
| `protocol/` | Serial command reference + **`callsign-extract/`** (command/field maps, **$WEAP token map**, **2166-id sound bank**, game modes — decoded from the Callsign app) ✅ |
| `mcp/` | **brx-mcp** — MCP server + CLI giving direct BLE control (scan/identify/listen/startgame/deathmatch/arena/…) ✅ |
| ~~`firmware/`~~ | Empty — the only ESP32 code that exists today is the IR bridge in **`hardware/esp32-ir-bridge/`** (`ir_capture.ino`, `ir_emit.ino`, both hardware-proven). Companion / item-pack / objective-station firmware is still to write. |
| ~~`server/`~~ | Empty — the game engine lives in **`mcp/brx_mcp/mc/`** (Mission Control rules/modes, scoring, announcer, event log, driving player nodes over the LAN) ✅ |
| `app/` | **BRX Combat HUD** — the native phone app (Capacitor: one codebase → Android + iOS, native BLE). Build instructions: [`app/README.md`](app/README.md) ✅ |
| `webapp/` | **Generated output — do not hand-edit.** The public site built from `docs/manual/` by `site/`, plus `webapp/mc/` = the Mission Control operator console (Vite/React) and `webapp/download/` = the committed Android APK + its `build.json` (written by `app/`'s `npm run android:apk`, never by the site build). Web Bluetooth is not the player path — that is `app/` (ADR-0003) |
| `hardware/` | **`brx-companion-spec.md`** (per-tagger accessory) ✅; STLs, wiring, BOM (todo) |
| `docs/` | **[`docs/README.md`](docs/README.md)** index — the **[`docs/spec/`](docs/spec/)** product spec (the record), the **[ADRs](docs/adr/)**, followups, and protocol/reference |

**Current status:** protocol largely decoded (remote game start, `$WEAP`/`$GSET` maps, full sound
bank, game modes, grenade config) — including **native kill feedback over BLE** (`$SFLASH` +
the `$PLAY` announcer slot, `protocol/brx-protocol.md` §7o), so a host can drive the green-sight
kill confirm and announcer the same way the official app does. Working `brx-mcp` drives real
matches, and the whole stack is **built + tested in software** — Mission Control (`mcp/brx_mcp/mc/`,
WebSocket over the LAN), the native phone node (`app/`), and the web UI (`webapp/mc/`) — a full suite
incl. 12 full-stack e2e (`cd mcp && python3 run_tests.py`), with **BLE-native per-player identity**
(`$PSET`/`$HIR`, §7p/§7q). One phone has mustered at the bench; next is the first **multi-phone**
muster (`docs/field-runbook-mc.md`). See `docs/FOLLOWUPS.md`.

## brx-mcp quickstart

The MCP server runs on **whichever machine owns the Bluetooth radio** — it is pure Python
(`bleak` + `mcp`) and works identically on **Windows, macOS, and Linux**.

```bash
# FIRST: switch each tagger's HEADSET on. A gun with no headset accepts a BLE connection,
# answers one ping, then drops the link — so `scan` and `identify` still look fine
# while everything that configures or plays a game fails. (protocol/brx-protocol.md §7r)

# on the machine with the BLE radio (Windows PowerShell, macOS terminal, or Linux):
git clone git@github.com:tony99nyr/open-brx.git && cd open-brx
python -m venv .venv && . .venv/bin/activate   # (Windows: .venv\Scripts\activate)
pip install -e ./mcp

# first contact — no MCP client needed:
python -m brx_mcp scan            # find the tagger (Gen2/3 advertise Nordic UART)
python -m brx_mcp identify <addr> # $PING → generation check
python -m brx_mcp listen <addr>   # read-only live console: pull trigger, watch $BUT/$HIR/$HP

# ...and now actually play. This is the hardware-proven Tier-0 path: your laptop drives the
# guns directly over BLE, so everyone has to stay within BLE range of it (a room or a yard).
python -m brx_mcp play tdm <addr1> <addr2> volume=69   # a real Team Deathmatch, live scoring
#   modes: tdm ffa infection lms cs domination koth ctf extraction
#   run `python -m brx_mcp --help` for the full command list
#   (bare `python -m brx_mcp` starts the MCP server and blocks — that is not the help)

# no guns to hand? this needs no hardware at all:
python -m brx_mcp game-sim tdm                        # narrated demo match in your terminal

# register with Claude Code:
claude mcp add brx -- python -m brx_mcp
```

> **What works today:** the command above ran a full TDM on two real taggers — scoring, respawn,
> frag limit, correct winner (`docs/experiment-log.md`, "FIRST LIVE M0 GAME"). The **phone-node +
> field Wi-Fi** path that lifts the BLE-range limit has only been run **one phone at a time at a
> bench, and not through a whole match**; a field of phones, a router-hosted LAN and a dispersed
> start have not been run at all — see
> [`docs/architecture-topology.md`](docs/architecture-topology.md) §7 for the line-by-line.

> **You do not need the phone app for any of the above** — the quickstart is laptop-to-guns over BLE.
> The phone node is what lifts the BLE-range limit later. There is now a **debug-signed Android test
> build** to sideload at <https://open-brx.iamrossi.workers.dev/platform/app/> (it is under
> construction, and a later release-signed build will not upgrade over it). On iOS, and to build
> either yourself, you need a mobile toolchain per platform (`app/README.md`).

### Platform notes

- **WSL2 has no Bluetooth.** Develop in WSL, but run the server with **Windows Python**
  (`python.exe`) — Claude Code in WSL can register it directly:
  `claude mcp add brx -- python.exe -m brx_mcp` (with the package installed into Windows Python).
- **macOS:** grant your terminal Bluetooth permission (System Settings → Privacy & Security →
  Bluetooth). CoreBluetooth reports per-machine UUIDs instead of MAC addresses, so the
  `~/.brx-mcp/known-devices.json` registry is per-machine — re-scan on the MacBook.
- **Gen1 taggers** use Bluetooth Classic (SPP, 57600 baud; headset must be connected). `bleak`
  is BLE-only — pair the tagger in the OS and use the serial port path instead (guide todo).

## Phone app quickstart

The player-facing app is a Capacitor project in [`app/`](app/) — one codebase for **Android and
iOS**, using native BLE (not Web Bluetooth, which has no iOS support and ships disabled on Android).

```bash
cd app
npm ci
npm run build            # bundle src/app.js -> www/app.js

npm run ios:setup        # macOS + full Xcode; adds the iOS platform and applies our iOS config
npm run android:setup    # JDK 21 + Android SDK
npm run android:apk      # the release step: builds the APK the public site hands out
```

`npm run android:apk` writes `webapp/download/brx-companion-<version>-android-debug.apk` plus a
`build.json` sidecar; rebuild the site (`cd site && npm run build && npm test`), commit, and a push to
`main` deploys it to [`/platform/app`](https://open-brx.iamrossi.workers.dev/platform/app/).

Full prerequisites, signing notes, publishing rules, and what's generated vs committed:
**[`app/README.md`](app/README.md)**.

## Safety

- Nothing here can brick a tagger — stock firmware is untouched; power-cycle restores.
- The MCP refuses malformed frames and requires `confirm=true` for commands outside the
  known-safe list enforced in `mcp/brx_mcp/protocol.py` (documented in `brx-protocol.md` §3).
- A `panic` tool (`$CLEAR,*` + `$SP,99,*`) returns any tagger to a sane state.

## Roadmap

M1 Identify ✅ → M2 Control ✅ → M3 Protocol depth (`$WEAP` map, sound bank, **per-player id over BLE**) ✅ →
M4 Pilot game (per-player node + Mission Control + live scoreboard) — **built + tested in software**
(a full test suite incl. 12 full-stack e2e); the **MC↔phone path has run one phone at a time at a
bench, not a whole match and never a field** (next: a live muster, `docs/field-runbook-mc.md`) → M5 Arena (objectives, items) → M6 Companion + scale. Spec of
record: **`docs/spec/`**; decisions: `docs/adr/`; open work: `docs/FOLLOWUPS.md`.

## License

MIT — see `LICENSE`.
