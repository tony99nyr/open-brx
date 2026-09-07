# Open BRX

An open-source (MIT) platform that turns **Battle Company BRX** laser taggers into one connected laser tag
system: hosted game modes, live scoring, custom weapons, objectives and a laptop Mission Control, on stock
guns with stock firmware. It is a self-hosted alternative to Battle Company's Edge software: no subscription,
no location lock, and it is designed for large fields with no venue Wi-Fi. The same repo is also the source of
**The Ultimate BRX Manual**, the public reference for the tagger and headset, built from `docs/manual/` and
served at <https://open-brx.iamrossi.workers.dev/>.

Today a laptop runs a full scored Team Deathmatch on real taggers over Bluetooth LE (Tier 0), and the
per-player phone app (the BRX Combat HUD) plus the Mission Control console have run two whole multi-phone
matches outdoors on real hardware (2026-08-30 and 2026-09-01). The phone-node path is what lifts the laptop's
BLE-range limit.

**Start here: [`docs/README.md`](docs/README.md)**, the documentation index. It points to
[`docs/architecture-topology.md`](docs/architecture-topology.md) (how it is wired and what is proven),
the manual, the spec of record (`docs/spec/`), the ADRs and the open-work list.

> **Credit:** Protocol discovery and the tagger-rider ESP32 concept originate with
> **[LaserTagMods](https://github.com/LaserTagMods)** (JEDGE / JBOX projects). This project is a fresh,
> independent implementation, no code copied, but it stands on that discovery work.

**Prime directives**

1. Stock BRX firmware is **never modified**. All control is via the documented Bluetooth serial protocol
   (`protocol/brx-protocol.md`). Power-cycling always restores a tagger; Battle Company's USB updater is the
   factory-restore path.
2. Store-and-forward everywhere: every node buffers timestamped events locally and syncs when in coverage.
   Live feed is best-effort; final results are always complete.
3. Each per-player **node** runs its own gun's game loop autonomously (offline-capable); **Mission Control**
   (a laptop) authors games and aggregates the scoreboard over the local LAN. It is not a live BLE hub
   (ADR-0001 / 0002).
4. Everything is a subscriber: scoreboard, lights, smoke, announcer are peers on the event stream.

## Repo layout

| Path | What |
|---|---|
| `docs/` | **[`docs/README.md`](docs/README.md)** index: the manual (`docs/manual/`, canonical BRX facts and the site source), the spec of record (`docs/spec/`), ADRs, followups, reference notes, the lab notebook |
| `protocol/` | The serial command reference (`brx-protocol.md`), the IR word (`brx-ir-protocol.md`), the Callsign APK teardown (`callsign-extract/`: command/field maps, `$WEAP` token map) and the decoded captures |
| `mcp/` | **brx-mcp**, the MCP server + CLI that drives taggers over BLE, and **`mcp/brx_mcp/mc/`**, the Mission Control server (game modes, scoring, the frame compiler; `API.md` is the server⇄UI contract) |
| `app/` | **BRX Combat HUD**, the native per-player phone app (Capacitor: one codebase → Android + iOS, native BLE). See [`app/README.md`](app/README.md) |
| `webapp/` | **Generated output, do not hand-edit.** The public site built from `docs/manual/` by `site/`, plus `webapp/mc/` (the Mission Control console, Vite/React) and `webapp/download/` (the committed Android APK) |
| `site/` | The static-site generator and its Playwright verification suite |
| `hardware/` | `esp32-ir-bridge/` (the IR capture/emit rig, built and proven), the Companion and Utility Box specs, print-file notes |
| `firmware/` | Empty. Companion / station firmware is still to write; the only ESP32 code that exists is the IR bridge in `hardware/` |

## brx-mcp quickstart

The MCP server runs on **whichever machine owns the Bluetooth radio**: it is pure Python (`bleak` + `mcp`)
and works identically on Windows, macOS and Linux.

```bash
# FIRST: switch each tagger's HEADSET on. A gun with no headset accepts a BLE connection,
# answers one ping, then drops the link, so `scan` and `identify` still look fine
# while everything that configures or plays a game fails.

# on the machine with the BLE radio (Windows PowerShell, macOS terminal, or Linux):
git clone git@github.com:tony99nyr/open-brx.git && cd open-brx
python -m venv .venv && . .venv/bin/activate   # (Windows: .venv\Scripts\activate)
pip install -e ./mcp

# first contact, no MCP client needed:
python -m brx_mcp scan            # find the tagger (Gen2/3 advertise Nordic UART)
python -m brx_mcp identify <addr> # $PING → generation check
python -m brx_mcp listen <addr>   # read-only live console: pull trigger, watch $BUT/$HIR/$HP

# ...and now actually play. This is the hardware-proven Tier-0 path: your laptop drives the
# guns directly over BLE, so everyone has to stay within BLE range of it (a room or a yard).
python -m brx_mcp play tdm <addr1> <addr2> volume=69   # a real Team Deathmatch, live scoring
#   modes: tdm ffa infection lms cs domination koth ctf extraction
#   run `python -m brx_mcp --help` for the full command list
#   (bare `python -m brx_mcp` starts the MCP server and blocks; that is not the help)

# no guns to hand? this needs no hardware at all:
python -m brx_mcp game-sim tdm                        # narrated demo match in your terminal

# register with Claude Code:
claude mcp add brx -- python -m brx_mcp
```

> **What works today:** the command above ran a full TDM on two real taggers: scoring, respawn,
> frag limit, correct winner (`docs/experiment-log/2026-08.md`, "FIRST LIVE M0 GAME"). The **phone-node +
> field Wi-Fi** path has run **two whole matches on real hardware**: a 300 s FFA on 2026-08-30 (two phones,
> two taggers, one MacBook hosting; 12 kills, 126 landed hits, 12 respawns, a winner) and an outdoor TDM on
> 2026-09-01 with two Android HUDs. Still unproven: a dispersed start with players out of Wi-Fi range before
> T-0, more than two phones, the 20-minute soak, phone auto-rejoin and iOS locked-phone BLE (`docs/FOLLOWUPS.md`
> "System proofs"). See [`docs/architecture-topology.md`](docs/architecture-topology.md) §7 for the line-by-line.

> **You do not need the phone app for any of the above.** The phone node is what lifts the BLE-range
> limit later. A **debug-signed Android test build** is published at
> <https://open-brx.iamrossi.workers.dev/platform/app/> (under construction; a later release-signed build
> will not upgrade over it). iOS builds from source (`app/README.md`).

### Platform notes

- **WSL2 has no Bluetooth.** Develop in WSL, but run the server with **Windows Python**
  (`python.exe`); Claude Code in WSL can register it directly:
  `claude mcp add brx -- python.exe -m brx_mcp` (with the package installed into Windows Python).
- **macOS:** grant your terminal Bluetooth permission (System Settings → Privacy & Security →
  Bluetooth). CoreBluetooth reports per-machine UUIDs instead of MAC addresses, so the
  `~/.brx-mcp/known-devices.json` registry is per-machine: re-scan on the MacBook.
- **Gen1 taggers** use Bluetooth Classic (SPP, 57600 baud; headset must be connected). `bleak`
  is BLE-only: pair the tagger in the OS and use the serial port path instead (guide todo).

## The phone app and the public site

- **Build and run the phone app:** [`app/README.md`](app/README.md) (prerequisites, iOS signing, the
  Android APK release step and its rules). The app uses native BLE; Web Bluetooth is not the player path
  (ADR-0003).
- **Change the manual or the public site:** [`docs/manual/README.md`](docs/manual/README.md) (how a fact
  gets in, the build, the test gate, and the fact that a push to `main` deploys `webapp/`).

## Safety

- Nothing here can brick a tagger: stock firmware is untouched; a power-cycle restores it.
- The MCP refuses malformed frames and requires `confirm=true` for commands outside the
  known-safe list enforced in `mcp/brx_mcp/protocol.py` (documented in `protocol/brx-protocol.md` §3).
- A `panic` tool (`$CLEAR,*` + `$SP,99,*`) silences and stops any tagger. It leaves the gun with **no
  `$SIR` table**, so it cannot be hit until it is re-armed or power-cycled: correct for a panic stop, not
  a playable state.

## Roadmap

M1 Identify ✅ → M2 Control ✅ → M3 Protocol depth (`$WEAP` map, the 2,477-file sound bank, per-player id over
BLE, the IR word) ✅ → M4 Pilot game (per-player node + Mission Control + live scoreboard): **built and tested in
software** (`cd mcp && python3 run_tests.py`, incl. 14 full-stack e2e in `test_mc_e2e.py`) and **run on hardware**:
two whole two-phone matches outdoors (2026-08-30, 2026-09-01); a dispersed start, more than two phones and the
20-minute soak are still owed (`docs/field-runbook-mc.md`) → M5 Arena (objectives, items) → M6 Companion + scale. Spec of record:
**`docs/spec/`**; decisions: `docs/adr/`; open work: `docs/FOLLOWUPS.md`.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) (how to build, test, and propose a change) and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

MIT, see `LICENSE`.
