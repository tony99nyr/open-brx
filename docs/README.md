# Docs index

**New here? Read [`architecture-topology.md`](architecture-topology.md) first** — how the system is
physically wired, what each link's limits are, and which parts are proven on hardware versus only
specified. Then **[`manual/`](manual/)**, the confirmed-facts manual the public site is built from.

| You are… | Read |
|---|---|
| **A BRX owner wondering if you can use this** | [`architecture-topology.md`](architecture-topology.md) §3 · [`platform/index.md`](platform/index.md) · the [root README](../README.md) |
| **Running a match today** | [`field-runbook-mc.md`](field-runbook-mc.md) · [`field-process.md`](field-process.md) · [`field-issues.md`](field-issues.md) |
| **Starting Mission Control on the dev box** (no hardware, no phones) | [`../mcp/brx_mcp/mc/README.md`](../mcp/brx_mcp/mc/README.md) → *Start it*: the one command, what it prints, the busy-port trap, served vs dev UI |
| **Trying LEDs, sounds and events on ONE gun at the bench** | [`gun-stage.md`](gun-stage.md) (`python -m brx_mcp stage`) |
| **Changing the code** | [`spec/README.md`](spec/README.md) → [`spec/contracts.md`](spec/contracts.md) · [`adr/`](adr/) |
| **An AI agent working on this repo** | `../CLAUDE.md` for hard rules + environment, then [`HANDOFF.md`](HANDOFF.md) |

## Status — three living files, one job each
- **[HANDOFF.md](HANDOFF.md)** — **one screen**: what is true today, what changed, the next three actions,
  machine roles. Overwritten each session, never stacked.
- **[FOLLOWUPS.md](FOLLOWUPS.md)** — **every open item and nothing else**, with a "Needs Tony at the bench"
  section (the bench queue) and "System proofs" (needs players / space). Ids are permanent. The rows are
  the only index.
- **[experiment-log/](experiment-log/)** — the append-only lab notebook, one file per month;
  [`experiment-log.md`](experiment-log.md) is its index. **Append after every session.** Nobody reads it
  for orientation; grep it.

Around them: **[`gotchas.md`](gotchas.md)** (field lore by symptom, plus the bench pre-flight) and
**[`field-issues.md`](field-issues.md)** (the issue register + what to check next match).

**The bench sheets, and which one to open** (a sheet is archived the moment its log entry lands):

| sheet | what it is |
|---|---|
| **[`game-test-2026-09-11.md`](game-test-2026-09-11.md)** | **the 2026-09-11 game test.** Every issue from a 1v1 on two taggers, self-contained: symptom, evidence, mechanism, fix |
| **[`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md)** | **the NEXT sitting.** The four readings still open (three of the original six were answered 2026-09-11), deliberately self-contained — run it without reading anything else |
| [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) | the WHOLE queue, grouped by setup block. FOLLOWUPS §9 is the register (ids); this is the running order |
| [`bench-grenade.md`](bench-grenade.md) | the grenade/hill rungs. Read its *What is answered* table first, then *Still to run* |
| [`bench-super-indoor-2026-09-07.md`](bench-super-indoor-2026-09-07.md) | Q15, MacBook-only, entirely outstanding and needing its own plumbing pass |
| [`bench-flash-control-2026-09-05.md`](bench-flash-control-2026-09-05.md) | the flash ladder, written up once; the queue CITES it rather than re-deriving it. The t6/t21/t22/F23 designs are in [`archive/bench-weap-tokens-discovery-2026-09-04.md`](archive/bench-weap-tokens-discovery-2026-09-04.md), cited from the queue's BQ-D1 row |

### Session close is three writes
1. One entry in the current month's experiment log (the evidence).
2. One FOLLOWUPS diff: strike or add rows, no prose. A closed item becomes one dated line in
   [`archive/followups-closed.md`](archive/followups-closed.md) with a link to the log anchor.
3. One HANDOFF replacement.

A new **fact** goes to `protocol/` or `manual/` in the same commit, or gets a FOLLOWUPS row that says
"promote X". A **retraction** is fixed at the source (`protocol/brx-protocol.md` row, `manual/` page,
`spec/`, and the code + comment built on it) — a stale answer recruits the next session, an open question
only warns it. `mcp/tests/test_docs_hygiene.py` enforces the stamp, id, length and link rules.

## Runbooks (how-to, no status)
- **[field-runbook-mc.md](field-runbook-mc.md)** — match-day operator runbook from the MacBook (install, field
  network, phase-by-phase host flow, troubleshooting; the REST routes are `../mcp/brx_mcp/mc/API.md`).
- **[field-process.md](field-process.md)** — the **Armory Setup** + **Muster** operator processes.
- **[mac-dev-runbook.md](mac-dev-runbook.md)** — working on the MacBook: the setup that is not in git, restart-MC
  vs hard-reload.
- **[wsl-dev-runbook.md](wsl-dev-runbook.md)** — working on the WSL/Windows box: the two-Python split, the UNC
  install path, first contact, where captures land.
- **[gun-stage.md](gun-stage.md)** — the click-to-try page + walkthrough for one real gun.
- **[capture-runbook.md](capture-runbook.md)** — how to take a capture (iOS PacketLogger, Android HCI
  snoop, the ESP32 IR rig, the decoders and their gotchas) and the capture jobs still open.

## Spec of record — build against this
- **[spec/README.md](spec/README.md)** (invariants + module map + amendment index) →
  **[spec/contracts.md](spec/contracts.md)** (the shared data + node↔MC wire; amendments folded into the body,
  their ids kept as anchors — **the authority**). Modules: [node](spec/node.md) · [start-sequence](spec/start-sequence.md)
  · [modes](spec/modes.md) · [loadout](spec/loadout.md) · [utility](spec/utility.md) · the server⇄UI contract
  [`../mcp/brx_mcp/mc/API.md`](../mcp/brx_mcp/mc/API.md). Design briefs: [spec/design/mission-control.md](spec/design/mission-control.md)
  · [spec/design/phone-hud.md](spec/design/phone-hud.md). The software (`mcp/brx_mcp/mc/`, `app/`, `webapp/mc/`)
  is built + tested against this (`cd mcp && python3 run_tests.py`).
- **[adr/](adr/)** — the load-bearing decisions: [0001](adr/0001-companion-rider-architecture.md) per-player node ·
  [0002](adr/0002-laptop-mission-control-host.md) laptop Mission Control + local LAN ·
  [0003](adr/0003-native-app-over-web-bluetooth.md) native app over Web Bluetooth.

## Vision & plan
- **[VISION.md](VISION.md)** — strategy + naming.
- **[game-modes.md](game-modes.md)** — the mode catalog, the infrastructure tiers, and the hard ceilings per mode.
- **[extraction-design.md](extraction-design.md)** — the flagship Extraction mode: the event ladder, the BRX
  mechanic mapping, the tier ladder and the genre research.
- **[edge-brp.md](edge-brp.md)** — the competitive study of Battle Company's EDGE + Battle Rifle Pro, and the
  parity targets it sets. It is strategy context, not manual evidence.
- **[weapon-design.md](weapon-design.md)** — the balance rationale and the open flatten-vs-retune decision.
- **[utility-roadmap.md](utility-roadmap.md)** — the objective-station work in order, the grenade-as-control-point
  evidence, and two designs (roaming hills, Territories) that are specified but not built. What it costs an
  outsider to add a mode is FOLLOWUPS §2 (E1-E7).
- **[led-language.md](led-language.md)** — the LED language (gun body, headset RGB, headset flash): the design of
  record for contracts A16, amended as the bench moves it; the open build items are S10.
- [`hud-review-2026-09-03.md`](hud-review-2026-09-03.md) — the closed HUD review ledger that `screens.mjs` cites.

## Ground truth
| Fact | Canonical home |
|---|---|
| Serial command reference (framing, tables, `$SIR`, `$WEAP`, safe testing) | [`../protocol/brx-protocol.md`](../protocol/brx-protocol.md) |
| Dated session findings + retracted readings (2026-08) | [`../protocol/session-findings-2026-08.md`](../protocol/session-findings-2026-08.md) |
| IR shot protocol + station words | [`../protocol/brx-ir-protocol.md`](../protocol/brx-ir-protocol.md) |
| `$GSET`/`$WEAP`/`$PSET` field maps, modes, grenade (APK teardown) | [`../protocol/callsign-extract/`](../protocol/callsign-extract/) |
| The 2477 sounds on the gun, with meanings | [`reference/sound-catalog.md`](reference/sound-catalog.md) (generated from `mcp/brx_mcp/data/sound_catalog.json`) |
| Every confirmed BRX fact, for people | [`manual/`](manual/) (+ [`manual/README.md`](manual/README.md): how a fact gets in) |
| The evidence the manual cites | [`reference/`](reference/) (manual notes, community posts, JEDGE, grenade, weapons data, print-file survey, iOS BLE notes) |
| Decoded transcripts + raw btsnoop traces | [`../protocol/captures/`](../protocol/captures/) |
| Node↔MC wire + game data model | [`spec/contracts.md`](spec/contracts.md) |
| Open work | [`FOLLOWUPS.md`](FOLLOWUPS.md) |

## Hardware
- **[../hardware/inventory.md](../hardware/inventory.md)** — what the bench owns, what is on order, what is planned.
- **[../hardware/m5sticks3/README.md](../hardware/m5sticks3/README.md)** — the M5StickS3 station firmware (IR decode over RMT,
  kind-5 BLE advert, BRIDGE/HILL modes, the bench gate).
- **[../hardware/esp32-ir-bridge/README.md](../hardware/esp32-ir-bridge/README.md)** — the IR transceiver that
  exists (board registry, wiring, the receiver traps).
- **[../hardware/brx-companion-spec.md](../hardware/brx-companion-spec.md)** (per-tagger node, paper) ·
  **[../hardware/brx-station-spec.md](../hardware/brx-station-spec.md)** (the Utility Box, paper) ·
  **[../hardware/print-files.md](../hardware/print-files.md)** (what we would print, and the caliper-measurement
  blocker; the market survey behind it is [`reference/print-files.md`](reference/print-files.md)).

## Building the software
- **[../app/README.md](../app/README.md)** — the native phone app (Capacitor → Android + iOS), the APK publish path.
- **[../mcp/README.md](../mcp/README.md)** — `brx-mcp`: install, first contact, the CLI and MCP tool
  tables, `diag-game`, platform notes — the tooling docs, as opposed to the protocol facts in
  `manual/dev.md`.
- **[../mcp/brx_mcp/mc/README.md](../mcp/brx_mcp/mc/README.md)** — the Mission Control server: how to start it, every flag, the UI it serves.
- **[../webapp/mc/README.md](../webapp/mc/README.md)** — the Mission Control web UI.
- **[manual/README.md](manual/README.md)** — the public site: how a fact gets in. **[site/README.md](site/README.md)**
  (how to run the build + gate) and **[site/FORMAT.md](site/FORMAT.md)** (the page contract).

## Archive
**[`archive/`](archive/)** — not maintained; grep it, do not read it. Closed followups, dated bench sheets that
ran, superseded spec modules, the design-tool exports the briefs re-seed from. Only files a living doc still
links stay; old HANDOFF banners live in `git log -p -- docs/HANDOFF.md`.

## The system in one paragraph
The BRX tagger is **dumb** — it fires a weapon we define (`$WEAP`), reads IR hits, tracks health, and
**keeps no game state**. So every real capability lives off-gun: a **per-player node** (the phone app,
or the Companion) is the game engine that drives spawn/respawn/score and feedback over BLE, with
**exact per-player attribution** (`$PSET` player id → `$HIR` shooter, no extra hardware);
**Mission Control** (a laptop) authors games, compiles each player's frame bundle, and aggregates a live
scoreboard over a **local Wi-Fi LAN** (WebSocket, no cloud); **objective stations** (QR codes, IR boxes,
or a phone in utility mode) provide capture/respawn/pickup. Nothing is blocked on unknown protocol — the
APK teardown decoded the command set, the sound bank, and the game-mode model, and P2 closed per-player
identity over BLE. Two whole multi-phone matches have run on this stack outdoors (2026-08-30, 2026-09-01).
