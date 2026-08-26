# Doc Audit — 2026-08-25

Audit of every markdown doc against the **current reality** (the spec of record `docs/spec/` +
the shipped code + `experiment-log.md`). Read-only; this is the findings report. Six parallel
auditors covered the ~30 pre-spec design/process/handoff/strategy/hardware docs; the `docs/spec/*`,
`protocol/*`, and `docs/reference/*` sets were the yardstick, not targets.

## The reality docs are measured against
- **Attribution is BLE-native and exact** — `$PSET` token 1 = `player_num` (1–63), `$HIR` token 3 =
  the shooter, both bench-confirmed (P2 CLOSED). No USB `SETUP`, no IR receiver, no nRF tap required.
- **Laptop Mission Control** (ADR-0002) hosts the game over a **local Wi-Fi LAN + WebSocket** (not
  MQTT, not a cloud server, not a live BLE hub). **Native Capacitor phone app** is the player node
  (Web Bluetooth is dead). MC compiles frames → per-player **FrameBundle** → node writes verbatim.
  Wire = contracts **A1–A8**; MC has **operator-token auth**.
- **Software is built + tested** (438 tests incl. 12 e2e); the **MC↔phone field path is UNVERIFIED**
  on real hardware.

## Three root causes of the rot
1. **"Per-player identity needs USB `SETUP` / IR decode / nRF tap" (P2 open).** P2 is closed over
   pure BLE. This lives in ~12 docs.
2. **"Web Bluetooth is the player path."** Dead — native app. ~8 docs.
3. **"MQTT / server-as-live-hub," and `docs/spec/` missing from the entry/index docs.** The root
   README, CLAUDE.md, and docs index don't point at the spec of record. ~5 docs.
Plus: two docs had a "P2 closed" banner bolted on top but the **body left stale** (game-modes,
mode-limits); build status understated; portrait-vs-landscape HUD; a few broken file refs.

---

## Priority 1 — ACTIVELY MISLEADING (fix first; a reader takes these as current)

| doc | the false/stale claim | fix |
|---|---|---|
| `docs/handoff-callsign-nrf-capture-RESULTS.md` | item 4 (~L90): "nRF24 tap … remains the **only route to per-player attribution** … `$HIR` names the team, not the shooter" | annotate SUPERSEDED — P2 closed over BLE (`$HIR` tok3 = shooter); no nRF tap needed |
| `hardware/bench-shopping-list.md` | "Route 2 — nRF24 mesh tap (**the priority**; the per-player attribution path) … CHOSEN" | demote nRF24 to exploratory native-mesh-feedback only; P2 is BLE-native; contradicts companion-spec's own reframe |
| `docs/game-modes.md` (body) | FFA "needs per-player id (P2) … set `PlayerID` via `SETUP`"; Syphon "needs P2" | edit body to match its own header — FFA attribution exact; drop SETUP; add the FFA-**never-friendly**/roster rule (A5.2) |
| `docs/mode-limits.md` (body) | "Per-player identity (P2): settable via `SETUP`, untested"; "Until P2, Syphon can only credit 'a teammate'" | P2 closed; Syphon routes to the exact killer, gated only by LAN coverage — not identity |
| `docs/sound-architecture.md` | "the base multikills are **already native**" | qualify: native multikill fires only in a phoneless gun-menu game; under our BLE config it is **silent** — MC must host-`$PLAY` it, LAN-gated (A5.3) |
| `docs/reference/jay-ecosystem.md` | Tier-0 built on "Android Chrome … browser-based player engine" (Web BT) | banner: the Web-BT node path is ruled out (ADR-0001, native app); keep the JBOX/JEDGE history |
| `hardware/brx-companion-spec.md` | BOM "VS1838B IR RX → per-player attribution (P2)"; "the Companion **is that phone** … must exist" | mark IR RX optional (attribution is BLE-native); demote Companion to an **optimization** for dispersed feedback (ADR-0001); reconcile the "runs its own engine" role with the FrameBundle node model |
| `docs/spec/design/phone-hud.md` | "**Portrait**, one-handed"; refs missing `current-hud-reference.html`; old `#0c1016` palette | rewrite to the shipped **landscape 844×390** HUD v2 (holo theme, rail-mounted), or defer to `design/hud-export/` |

## Priority 2 — ENTRY/INDEX docs (readers start here; they omit `docs/spec/` and cite dead arch)

| doc | issue | fix |
|---|---|---|
| `docs/README.md` | index labels phone path "Web-Bluetooth PWA"; "glued by a local **MQTT** bus"; **`docs/spec/` absent from the index** | add a `docs/spec/` section (spec of record); relabel phone path native; MQTT → WebSocket LAN |
| `README.md` (root) | roadmap "M4 Pilot game ← here" + "MQTT engine" — understates the built+tested software | advance status to "software built+tested, field path unverified"; drop MQTT; point to `docs/spec/` |
| `CLAUDE.md` | layout lists "`server/` game engine + MQTT"; no `docs/spec/` pointer | note the laptop-MC/LAN model (`mcp/brx_mcp/mc/`); add `docs/spec/` as spec of record |
| `docs/HANDOFF.md` | body: "**The new critical path: the nRF radio**" | update the where-it-stands/nRF sections → BLE-native + the build + `docs/spec/`, or mark historical |
| `docs/FOLLOWUPS.md` | B2 "Web-Bluetooth PWA", B3 "MC design prototype … wire to backend" | flip B2/B3 to built/tested; drop Web-BT wording |
| `docs/adr/README.md` | index lists only ADR-0001 | add the ADR-0002 row |
| `mcp/brx_mcp/mc/API.md` | missing `POST /api/phase`; **no mention of operator-token auth** | add the route + an Auth section (peer's lane — flag to them) |
| `mcp/brx_mcp/mc/README.md` | **empty (0 bytes)** | write a stub (entrypoint, ws/qr, → API.md + spec/mission-control.md) |

## Priority 3 — STALE but not urgent (correct or mark historical)

| doc | verdict | action |
|---|---|---|
| `docs/mission-control-spec.md` | SUPERSEDED → `docs/spec/mission-control.md` (Web-BT "pilot shortcut", P2-blocks-FFA) | mark superseded; salvage diagnostics/fleet-health tables into spec if not already |
| `docs/phone-app-spec.md` | HISTORICAL (dead Web-BT PWA; one-phone-many-guns) | mark historical → ADR-0001 + `app/README.md`; keep objective-node design |
| `docs/field-architecture.md` | STALE (Web-BT gate, "P2 prerequisite", USB SETUP) | strike Web-BT/P2 claims; keep the field-transport analysis; point to `net.md` |
| `docs/brx-architecture-v0.2.md` | HISTORICAL (server-as-live-hub, Web-BT) | one line pointing live-arch claims to `docs/spec/` + ADRs |
| `docs/brx-mcp-spec.md` | HISTORICAL (dead `brx-tools/`, Web-BT one-stop) | keep as rationale; optionally trim dead refs |
| `docs/tier0-plan.md` | STALE/SUPERSEDED (USB-P2 gating spine, Web-BT) | mark superseded by `docs/spec/` roadmap, or rewrite §2/§4/§5 |
| `docs/build-tiers.md` | STALE ("approximate until P2"; Tier-1 Web-BT PWA) | strike "approximate until P2"; recast Tier-1 as native nodes over LAN |
| `docs/mac-capture-plan.md` | STALE (L16 "nRF critical path"; Exp 3 per-player-id open) | strike L16; mark Exp 3 DONE (BLE-native), or fold to experiment-log |
| `docs/field-process.md` | STALE (identity via USB `SETUP`) | correct to "`player_num` assigned over BLE at kit-out" |
| `docs/handoff-callsign-nrf-capture.md` | HISTORICAL-DONE (banner caps it) | mark historical-DONE |
| `docs/apk-investigation.md` | HISTORICAL-DONE | add DONE to H1; fold the one open `$WEAP`-token scrap to FOLLOWUPS |
| `docs/m0-game-engine.md` | CURRENT (only "112 tests" stale) | update test count (438); pointer to `modes.md`/`node.md` |
| `hardware/brx-station-spec.md` | CURRENT (station IR is legit) | one line: P2 solved on the BLE side; station IR player-id stays a B13 task |
| `docs/spec/design-handoff.md` | SUPERSEDED by the split `design/` package | mark superseded or delete |
| `docs/spec/design/foundation.md` | STALE HUD framing; broken `weapon-roster.md` ref | fix the ref (→ `reference/callsign-ui.md`) |

## CURRENT / no action (the yardstick + already-refreshed docs)
`docs/VISION.md`, `docs/diagnostic-game.md`, `docs/verification-checklist.md`,
`docs/bench-plan-hardware.md`, `docs/handoff-ios-ble-findings.md`, `app/README.md`,
`app/src/transport/README.md`, `webapp/mc/README.md` (nit: "six"→"seven screens"),
`docs/adr/0001-*` (P2 addendum already present), `docs/adr/0002-*`,
`docs/spec/design/mission-control.md`, `design/mc-export/*`, `design/hud-export/*`,
`hardware/ir-prototype-plan.md`, `hardware/esp32-ir-bridge/README.md`,
`hardware/range-experiment.md`, `hardware/print-files.md` (dated research),
and 7 of 8 `docs/reference/*` (all except `jay-ecosystem.md`). The `docs/spec/*` set is current by
construction (it's the yardstick).

---

## Recommended execution order
1. **Priority 1** (8 docs) — the actively-misleading attribution/Web-BT/multikill/HUD claims. Highest
   risk: someone acts on a solved-problem framing.
2. **Priority 2** (8 docs) — the entry/index docs, so the first thing a reader sees points at
   `docs/spec/` and the real architecture. (`mc/API.md` + `mc/README.md` are the MC lane — coordinate.)
3. **Priority 3** (15 docs) — mark-historical/point-to-spec sweeps; low urgency, mostly one-liners.
</content>
