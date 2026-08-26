# Docs index

Start here. Read `../CLAUDE.md` first for hard rules and environment, then this.

## Spec of record — build against this
- **[spec/](spec/)** — the **end-to-end product spec**, frozen and reviewed. Read
  **[spec/README.md](spec/README.md)** (architecture + the armory→recap flow + the module map) then
  **[spec/contracts.md](spec/contracts.md)** (the shared data + node↔MC wire, amendments A1–A8 — the
  authority). Modules: [net](spec/net.md) · [armory](spec/armory.md) · [modes](spec/modes.md) ·
  [node](spec/node.md) · [start-sequence](spec/start-sequence.md) · [mission-control](spec/mission-control.md).
  The software (`mcp/brx_mcp/mc/`, `app/`, `webapp/mc/`) is built + tested against this (438 tests incl.
  12 full-stack e2e). Design briefs live in [spec/design/](spec/design/).

## Status & process
- **[FOLLOWUPS.md](FOLLOWUPS.md)** — the single source of truth for **open work**.
- **[HANDOFF.md](HANDOFF.md)** — current cross-machine state; read before a hardware session.
- **[experiment-log.md](experiment-log.md)** — the shared lab notebook. **Append after every session.**
- **[verification-checklist.md](verification-checklist.md)** — what needs YOU + a tagger to confirm (the
  running hardware-verification to-do list). **The MC↔phone field path is UNVERIFIED on hardware** —
  proven in software + the single-gun bench only.
- **[field-runbook-mc.md](field-runbook-mc.md)** — the **match-day operator runbook** (install, field
  network, phase-by-phase host flow, troubleshooting) for running a game from the MacBook.
- **[field-process.md](field-process.md)** — the **Armory Setup** + **Muster** operator processes.

## Architecture Decision Records (the load-bearing, expensive-to-reverse calls)
- **[adr/0001](adr/0001-companion-rider-architecture.md)** — the per-player **node** (Companion / phone):
  why stock firmware + an offline dispersed field force a per-player BLE rider for live feedback/scoring.
- **[adr/0002](adr/0002-laptop-mission-control-host.md)** — **laptop Mission Control + local host**:
  authors/hosts/coordinates on a local Wi-Fi **LAN** (WebSocket, no cloud, no MQTT); phones are one-gun nodes.
- **[adr/0003](adr/0003-native-app-over-web-bluetooth.md)** — **native app over Web Bluetooth**: the
  browser PWA path is dead (disabled on Android, absent on iOS); the player node is a native Capacitor app.

## Canonical sources (avoid restating — link to these)
| Fact | Canonical home |
|---|---|
| Gun-keeps-no-state proof | `../protocol/brx-protocol.md` §7n |
| Per-player attribution (BLE-native) | `../protocol/brx-protocol.md` §7p (`$PSET` tok1 player id) / §7q (`$HIR` tok3 shooter) |
| `$GSET`/`$WEAP`/`$PSET` + command field maps | `../protocol/callsign-extract/protocol-classes.md` |
| Sound bank (2166 ids) + USB sound-swap | `../protocol/callsign-extract/sound-bank.md` / `reference/brx-extended-user-guide.md` |
| Grenade — full manual, mode map, beacon decode | `reference/grenade.md` |
| Health-write semantics (`$LIFE`/`$BUMP` additive-clamped; no native regen) | `game-modes.md` §Health / `experiment-log.md` #33 |
| Kill feedback is BLE-drivable (`$SFLASH` + token-4 `$PLAY`) | `../protocol/brx-protocol.md` §7o |
| Field transport / range / device-per-player | `adr/0001` + `adr/0002` + `reference/jay-ecosystem.md` §5 |
| Edge/UBox parity + pricing | `reference/edge-brp.md` |
| Node↔MC wire + game data model | `spec/contracts.md` |
| Open work (all items) | `FOLLOWUPS.md` |

## Reference
- **[reference/weapons.md](reference/weapons.md)** — **the complete Callsign arsenal**: all 20 weapons,
  named and behaviour-verified, with damage/cycle/clip/reserve/heat as sent on the wire.

## Building the software
- **[../app/README.md](../app/README.md)** — the **native phone app** (Capacitor → Android + iOS): the
  player node. Web Bluetooth is a dev-only harness; the player path is native (ADR-0003).
- **[../mcp/brx_mcp/mc/API.md](../mcp/brx_mcp/mc/API.md)** — the Mission Control HTTP/WS API.
- **[../README.md](../README.md)** — `brx-mcp` quickstart (the CLI that drives taggers at the bench).

## Vision & strategy
- **[VISION.md](VISION.md)** — can we supersede Edge? Capability ceiling, gaps, open-source + business.
- **[build-tiers.md](build-tiers.md)** — what you can build at each investment level.
- **[m0-game-engine.md](m0-game-engine.md)** — the mode engines (TDM/FFA/infection/LMS/extraction) +
  `GameConfig`; the compiler that turns config → BRX frames now lives in `mcp/brx_mcp/mc/compile.py`.
- **[sound-architecture.md](sound-architecture.md)** — how BRX audio works: reactive sounds vs
  host-`$PLAY` announcements; the `$SFLASH`/multikill findings.
- **[game-modes.md](game-modes.md)** — catalog of every known game mode, by infrastructure tier.
- **[mode-limits.md](mode-limits.md)** — the constraints ledger: what limits each mode at each tier.
- **[diagnostic-game.md](diagnostic-game.md)** — the end-to-end diagnostic suite (`diag-game <addr>`).

## Hardware
- **[../hardware/brx-companion-spec.md](../hardware/brx-companion-spec.md)** — the per-tagger ESP32-S3
  node (offline engine + feedback + mesh). Per ADR-0001 an optimization for dispersed feedback, not
  required for attribution (that's BLE-native).
- **[../hardware/brx-station-spec.md](../hardware/brx-station-spec.md)** — the **Utility Box** (open
  IR/objective node: Hill/Assault/CTF/Respawn/Domination/Extraction/Bomb).
- **[../hardware/ir-prototype-plan.md](../hardware/ir-prototype-plan.md)** — the ~$15 ESP32 IR prototype
  (capture/emit BRX IR; the `$SIR` effect space). **[bench-shopping-list.md](../hardware/bench-shopping-list.md)** · **[print-files.md](../hardware/print-files.md)**.

## Protocol & reference (ground truth)
- **[../protocol/brx-protocol.md](../protocol/brx-protocol.md)** — the serial command reference (framing,
  command tables, session findings incl. §7o feedback, §7p/§7q per-player id).
- **[../protocol/brx-ir-protocol.md](../protocol/brx-ir-protocol.md)** — the IR shot protocol (~25-bit word).
- **[../protocol/callsign-extract/](../protocol/callsign-extract/)** — APK teardown: `protocol-classes.md`
  (command/field maps, `$WEAP` token positions), `apk-harvest.md` (modes/stations/grenade), `sound-bank.md`
  (2166 ids), `config-facts.md` / `README.md` / `RAW_ASSETS_NOTE.md`.
- **[reference/](reference/)** — external facts: `brx-manual-notes.md`, `brx-extended-user-guide.md`,
  `edge-brp.md`, `lasertagmods.md`, `community-notes.md`, `callsign-ui.md`, `grenade.md`,
  `jay-ecosystem.md` (JBOX/JEDGE devices + measured ESP-NOW/LoRa ranges).
- **[../protocol/captures/](../protocol/captures/)** + **[raw/](../protocol/captures/raw/)** — decoded
  transcripts + raw btsnoop traces (re-decodable with `python -m brx_mcp.btsnoop` / `callsigndiff`).

## The system in one paragraph
The BRX tagger is **dumb** — it fires a weapon we define (`$WEAP`), reads IR hits, tracks health, and
**keeps no game state**. So every real capability lives off-gun: a **per-player node** (the phone app,
or the Companion) is the game engine that drives spawn/respawn/score and feedback over BLE, with
**exact per-player attribution** (`$PSET` player id → `$HIR` shooter, no extra hardware);
**Mission Control** (a laptop) authors games, compiles each player's frame bundle, and aggregates a live
scoreboard over a **local Wi-Fi LAN** (WebSocket, no cloud); **objective stations** (QR codes or IR
boxes) provide capture/respawn/pickup. Nothing is blocked on unknown protocol — the APK teardown decoded
the command set, the sound bank, and the game-mode model, and P2 closed per-player identity over BLE.
