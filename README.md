# Open BRX

An open-source (MIT) platform that turns **Battle Company BRX** laser taggers into one connected laser tag
system: hosted game modes, live scoring, custom weapons, objectives and a laptop Mission Control, on stock
guns with stock firmware. It is a self-hosted alternative to Battle Company's Edge software: no subscription,
no location lock, and it is designed for large fields with no venue Wi-Fi. The same repo is the source of two
public doors built from one static-site generator: the platform landing/docs (`docs/platform/`) at
<https://open-brx.iamrossi.workers.dev/>, and **The Ultimate BRX Manual**, the public reference for the tagger
and headset, built from `docs/manual/` and served at <https://open-brx.iamrossi.workers.dev/manual/>.

Today the per-player phone app (the BRX Combat HUD) and the Mission Control console run whole matches on
real taggers. On 2026-10-17 four players played four matches: Free For All, Team Deathmatch and two King of
the Hill games, with two phones as respawn stations. Each match ran for 10 to 14 minutes. [`docs/field-2026-10-17.md`](docs/field-2026-10-17.md) lists the issues the day found. The phone-node path
is what lifts the laptop's BLE-range limit.

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
| `docs/` | **[`docs/README.md`](docs/README.md)** index: the platform pages (`docs/platform/`), the manual (`docs/manual/`, canonical BRX facts), the spec of record (`docs/spec/`), ADRs, followups, reference notes, the lab notebook |
| `protocol/` | The serial command reference (`brx-protocol.md`), the IR word (`brx-ir-protocol.md`), the Callsign APK teardown (`callsign-extract/`: command/field maps, `$WEAP` token map) and the decoded captures |
| `mcp/` | **brx-mcp**, the MCP server + CLI that drives taggers over BLE, and **`mcp/brx_mcp/mc/`**, the Mission Control server (game modes, scoring, the frame compiler; `API.md` is the server⇄UI contract) |
| `app/` | **BRX Combat HUD**, the native per-player phone app (Capacitor: one codebase → Android + iOS, native BLE). See [`app/README.md`](app/README.md) |
| `webapp/` | The site generator's output lands here, git-ignored (built from `docs/platform/` + `docs/manual/` by `site/`). `webapp/mc/` (the Mission Control console, Vite/React) and `webapp/download/build.json` (the Android build sidecar, which points at the GitHub Release) are hand-kept and tracked |
| `scripts/` | Repo scripts: start, the test runner, the land lane. [`scripts/README.md`](scripts/README.md) is the index |
| `site/` | The static-site generator (two doors, one source: `docs/site/FORMAT.md`) and its Playwright verification suite |
| `hardware/` | `esp32-ir-bridge/` and `m5sticks3/` (built ESP32 rigs), `player-sim/` (a fake player phone for station bench tests), the Companion and Station specs, print-file notes |

## Quickstart: run Mission Control

Clone the repository, then run one command from its root:

```bash
./start.sh      # macOS, Linux
start.cmd       # Windows: double-click it, or run it from a terminal
```

The script installs what is missing, builds the Mission Control console, starts Mission Control and
opens it in your browser. The second run starts straight away. [Install](docs/platform/install.md)
describes each step, and what to do without git.

No taggers on hand? `./start.sh --demo` runs a full demo match with 8 simulated players, no hardware
needed. Hit a bug? `./start.sh --report` makes a scrubbed bug report and opens a prefilled GitHub
issue. Run `./start.sh --help` for the rest of the options.

Developers: after `./start.sh` has set the machine up, `pnpm mc` (or `node scripts/mc.mjs`) starts
Mission Control directly, without the update and install steps. `mcp/brx_mcp/mc/README.md` covers every flag and the
manual setup path.

## brx-mcp CLI quickstart

The direct tagger-control CLI and stdio MCP server are documented in the
[`mcp/README.md`](mcp/README.md), which is the command reference and safe-order authority. It covers
installation, first contact, `play`, `game-sim`, MCP registration, platform notes, and the full command table.
That README's CLI table is the canonical command list; bare `python -m brx_mcp` starts the stdio server.

> **What works today:** `python -m brx_mcp play tdm` ([`mcp/README.md`](mcp/README.md)) runs a scored TDM
> on real taggers from a laptop, with no phones. The phone-node path ran the four field matches above. What is
> proven, mode by mode and feature by feature, is in [`docs/release-1.0.md`](docs/release-1.0.md). The open
> system proofs are in [`docs/post-mvp.md`](docs/post-mvp.md) → *System proofs*.

> **You do not need the phone app for any of the above.** The phone node is what lifts the BLE-range
> limit later. A **release-signed Android test build** (release-signed since 0.4.6; see
> [`app/RELEASING.md`](app/RELEASING.md)) is linked from
> <https://open-brx.iamrossi.workers.dev/download/>. iOS builds from source (`app/README.md`).

### Platform notes

WSL2 has no Bluetooth, macOS needs a Bluetooth permission grant and reports per-machine UUIDs
instead of MAC addresses, and Gen1 taggers need a serial path instead of BLE. The full detail lives
in [`mcp/README.md`](mcp/README.md) → *Platform notes* (and, for the WSL/Windows box specifically,
[`docs/wsl-dev-runbook.md`](docs/wsl-dev-runbook.md)).

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
- A `panic` tool silences and stops any tagger, but leaves it unhittable until it's re-armed or
  power-cycled: see `CLAUDE.md` → Hard rules and `protocol/brx-protocol.md` §3 for the exact sequence.

## Roadmap

M1 Identify ✅ → M2 Control ✅ → M3 Protocol depth (`$WEAP` map, the 2,477-file sound bank, per-player id over
BLE, the IR word) ✅ → M4 Pilot game (per-player node + Mission Control + live scoreboard): **built and tested in
software** (`cd mcp && python3 run_tests.py`, incl. the full-stack e2e suite in `test_mc_e2e.py`) and **run on hardware**
(per-mode evidence: `docs/release-1.0.md`) → M5 Arena (objectives, items) → M6 Companion + scale. Spec of record:
**`docs/spec/`**; decisions: `docs/adr/`; open MVP work: `docs/FOLLOWUPS.md`; the roadmap: `docs/post-mvp.md`.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) (how to build, test, and propose a change) and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

MIT, see `LICENSE`.
