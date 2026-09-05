# Docs index

**New here? Read [`architecture-topology.md`](architecture-topology.md) first** — how the system is
physically wired, what each link's limits are, and which parts are proven on hardware versus only
specified. It is the shortest path to understanding why everything else looks the way it does.

Then, by who you are:

| You are… | Read |
|---|---|
| **A BRX owner wondering if you can use this** | [`architecture-topology.md`](architecture-topology.md) §3 · [`build-tiers.md`](build-tiers.md) · the [root README](../README.md) quickstart |
| **Running a match today** | [`field-runbook-mc.md`](field-runbook-mc.md) · [`field-process.md`](field-process.md) |
| **Trying LEDs, sounds and events on ONE gun at the bench** | [`gun-stage.md`](gun-stage.md) (`python -m brx_mcp stage`, the click-to-try page + walkthrough) |
| **Changing the code** | [`spec/README.md`](spec/README.md) → [`spec/contracts.md`](spec/contracts.md) · [`adr/`](adr/) |
| **An AI agent working on this repo** | `../CLAUDE.md` for hard rules + environment, then [`HANDOFF.md`](HANDOFF.md) |

> Much of what follows is the project's own working material — lab notebooks, bench plans, and
> session handoffs written agent-to-agent. It is kept in the open deliberately, but it is **not**
> user documentation; the table above is.

## Spec of record — build against this
- **[spec/](spec/)** — the **end-to-end product spec**, frozen and reviewed. Read
  **[spec/README.md](spec/README.md)** (architecture + the armory→recap flow + the module map) then
  **[spec/contracts.md](spec/contracts.md)** (the shared data + node↔MC wire, amendments A1–A8 — the
  authority). Modules: [net](spec/net.md) · [armory](spec/armory.md) · [modes](spec/modes.md) ·
  [node](spec/node.md) · [start-sequence](spec/start-sequence.md) · [mission-control](spec/mission-control.md).
  The software (`mcp/brx_mcp/mc/`, `app/`, `webapp/mc/`) is built + tested against this (run
  `cd mcp && python3 run_tests.py` for the current count, incl. full-stack e2e). Design briefs live in [spec/design/](spec/design/).

## Status & process
- **[FOLLOWUPS.md](FOLLOWUPS.md)** — the single source of truth for **open work**.
- **[HANDOFF.md](HANDOFF.md)** — current cross-machine state; read before a hardware session.
- **[experiment-log.md](experiment-log.md)** — the shared lab notebook. **Append after every session.**
- **[`gotchas.md`](gotchas.md)** — **the field lore**: every quirk that wastes an hour, indexed by symptom. Read before a bench session.
- **[`unknowns.md`](unknowns.md)** — **the index of everything not yet confirmed**, grouped by what
  unblocks it. Start here to see the whole board.
- **[`bench-tomorrow.md`](bench-tomorrow.md)** — ⭐ **THE bench queue, and the only one.** Everything
  still blocked on a human (trigger pulls, ears, eyes, the grenade), grouped to minimise re-rigging.
  Its **START HERE** block names the first three things in order. **Start here on bench day.**
- **[`bench-2026-09-03.md`](bench-2026-09-03.md)** — the next dated session sheet: pre-flight,
  the emitter-range blocker, and what is already closed. A selection from the queue above.
- **[`bench-next-30.md`](bench-next-30.md)** — a 30-minute **subset** of the above, not a rival plan.
  If the two disagree, `bench-tomorrow.md` wins.
- **[verification-checklist.md](verification-checklist.md)** — what needs YOU + a tagger to confirm (the
  running hardware-verification to-do list). **The MC↔phone field path is UNVERIFIED on hardware** —
  proven in software + the single-gun bench only.
- **[field-runbook-mc.md](field-runbook-mc.md)** — the **match-day operator runbook** (install, field
  network, phase-by-phase host flow, troubleshooting) for running a game from the MacBook.
- **[field-process.md](field-process.md)** — the **Armory Setup** + **Muster** operator processes.

### Closing an open item — the checklist

Both cold-read handoff tests failed this repo on the *same* thing: an answer that landed in one file and
left the old reading standing in five others. When you close a question (a `P##`/`Q##`/`F#`/`K#`, or a
bench item), sweep it **in the same commit**:

```
grep -rn "P17" docs/ protocol/ mcp/ --include=*.md --include=*.py
```

and check each of these, because each has burned us:

| where | what to fix |
|---|---|
| `docs/unknowns.md` | strike the row, put the **answer** in it — not just a ✅ |
| `docs/FOLLOWUPS.md` | same, and re-read the whole section: a header can say "solved" while a subsection below still argues the old reading |
| `docs/spec/` | **the spec of record.** It drifts most, because it is written for a different audience and nobody greps it |
| `docs/manual/` | the public site is built from this — a stale claim here ships |
| `protocol/brx-protocol.md` | retract **in place**, and say what still stands |
| `docs/bench-tomorrow.md` + `bench-next-30.md` | strike the queued test so nobody re-runs it |
| `docs/verification-checklist.md` | flip ⬜ → ✅ |
| **code** | the frame or constant built on the retracted reading, **and the comment next to it**. Night mode shipped a broken `$GLED` for days because only the log was updated |

A stale answer is worse than an open question: an open question warns you, a stale answer recruits you.

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

- **[mac-dev-runbook.md](mac-dev-runbook.md)** — 🆕 **working on the MacBook**: the setup that is not
  in git, the change-to-screen loop (restart MC vs hard reload — the biggest time-waster there is),
  the test suites' two traps, and how to read a session store without drawing a wrong conclusion.
- **[verify-together.md](verify-together.md)** — 🆕 **the bench checklist: shipped-but-unconfirmed
  fixes and reports I could not reproduce.** Each says what would prove it AND what would
  disprove it. Ten minutes with two guns.
- **[field-issues.md](field-issues.md)** — 🆕 **the issue register: everything reported from a live
  session and what happened to it.** Add to it when an issue is reported, not after it is fixed.
- **[handoff-post-first-match.md](handoff-post-first-match.md)** — 🆕 **after the first full match on
  our own stack (2026-08-30/31).** Everything reported that day is fixed; what remains is split by
  which machine can do it — the two highest-value items are **Mac-only** (a Callsign capture, and the
  phone's BLE frame ring). Start here before picking up field work.
- **[handoff-ble-experiments-no-ir.md](handoff-ble-experiments-no-ir.md)** — **four BLE-only bench
  experiments** needing just two taggers and a laptop (no IR, no Callsign, no capture rig). Top item
  could close P2 and remove an IR hardware dependency.

## Reference
- **[reference/weapons.md](reference/weapons.md)** — **the complete Callsign arsenal**: all 20 weapons,
  named and behaviour-verified, with damage/cycle/clip/reserve/heat as sent on the wire.

## Building the software
- **[../app/README.md](../app/README.md)** — the **native phone app** (Capacitor → Android + iOS): the
  player node. Web Bluetooth is a dev-only harness; the player path is native (ADR-0003).
  §*Publishing the Android build* is the release step: `npm run android:apk` builds the APK the public
  site hands out at [`/platform/app`](https://open-brx.iamrossi.workers.dev/platform/app/) into
  `webapp/download/`, **then `cd site && npm run build && npm test`** (a version bump deletes the old
  APK, so a page that was not rebuilt links a file that is gone), then commit and push to deploy.
  iOS has no sideload path (build from source).
- **[../mcp/brx_mcp/mc/API.md](../mcp/brx_mcp/mc/API.md)** — the Mission Control HTTP/WS API.
- **[../README.md](../README.md)** — `brx-mcp` quickstart (the CLI that drives taggers at the bench).

## The BRX Manual — canonical facts (and the public website built from it)
- **[manual/](manual/README.md)** — **the manual: every confirmed BRX fact, once, with its source.**
  Hardware · operation · gameplay/weapons · sound bank · fix/mod · developer/protocol · platform.
  Known facts only; each file ends with a *Research backlog* of what's held back. **Look here before
  restating a BRX fact from `reference/` or `protocol/`.** The website is built from these files.
- **[site/](site/README.md)** — the design package for the website: the Claude Design brief (IA,
  templates, LLM-SEO, deploy target), and the image manifest (Gemini prompts + real-photo shoot list).

## Vision & strategy
- **[VISION.md](VISION.md)** — can we supersede Edge? Capability ceiling, gaps, open-source + business.
- **[build-tiers.md](build-tiers.md)** — what you can build at each investment level.
- [`hud-review-2026-09-03.md`](hud-review-2026-09-03.md) — the HUD screen review log: 52 items, each with its fix and the screen-truth step that guards it (`cd app && npm run ui:stage` to look, `npm run ui:screens` to prove).
- [`bench-weap-tokens-2026-09-04.md`](bench-weap-tokens-2026-09-04.md) + [`bench-weap-tokens-discovery-2026-09-04.md`](bench-weap-tokens-discovery-2026-09-04.md) — `$WEAP` tok15 = the swap delay (proven), and the pre-bench discovery + ranked plan for the remaining blind tokens (crit, accuracy, range pair, reload type, secondary block) plus F23.
- [`utility-roadmap.md`](utility-roadmap.md) — the order of work for the utility phone (stations): what is built, the arming loop, radio hardening, then control point / extraction / powerup / bomb, each with surface, owner, tests and bench gate.
- [`mode-readiness.md`](mode-readiness.md) — how far off a playable end-to-end **Counter-Strike** and **Extraction** match is: what the mode/scoring code already does vs the gaps (input source, MC integration, CS round-loop/side-swap), the shared objective-station spine, and where the grenade still fits (the B23 bridge).
- [`mode-extensibility.md`](mode-extensibility.md) — critical review of the game-config + mode-registration path for **opening the project up**: what JSON can/can't customize, why a new ruleset needs Python across ~4 files, and the four-item plan (E1-E4 in FOLLOWUPS) to make modes a drop-in plugin + JSON block.
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
