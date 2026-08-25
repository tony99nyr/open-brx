# Open BRX — End-to-End Product Spec

- **Status:** Draft (backbone authored; module specs in progress)
- **Owners:** Tony (product) · multiple Claude sessions (parallel implementation)
- **Anchors:** ADR-0001 (per-player node), ADR-0002 (laptop MC + local host).
  Extends `docs/mission-control-spec.md`, `docs/phone-app-spec.md`,
  `docs/m0-game-engine.md`, `docs/game-modes.md`. Ground truth: `protocol/brx-protocol.md`.

This is the **whole product**, armory to recap. It is written to be **built in parallel**:
§4 defines modules with hard interface boundaries, §5 the workstream/dependency plan, and
[`contracts.md`](contracts.md) freezes the shared data + protocol every module binds to. **Read
`contracts.md` before touching any module** — it is the single point of coordination.

---

## 1. Product vision

A club/rental-grade system that turns stock BRX taggers into a fully-hosted laser tag experience:
a **MacBook Mission Control** runs the whole event over a **local field Wi-Fi LAN** — enrolls and
health-checks the gear, lets a host build a game and kit each player out (name, team, weapon, voice,
LED/environment), pushes it to the taggers, starts a **synchronized dispersed** match, tracks a
**live Halo-style scoreboard**, and produces a **recap** (winner, K/D, accuracy, medals). Each player
carries a **phone (now) or Companion (later)** as their **node**: it drives their one gun over BLE and
shows a **glare-legible video-game HUD**. No internet, no SIM, no cloud in the loop — the field is an
island (ADR-0002).

## 2. Architecture at a glance

```
   ┌──────────────────────── FIELD LAN (travel router, or Mac hotspot) ───────────────────────┐
   │                                                                                            │
   │   Mission Control (MacBook)                         Player nodes (phone → Companion)       │
   │   ┌───────────────────────────┐                     ┌───────────────┐  ┌───────────────┐  │
   │   │ MC server (local backend) │◄───── WS / mDNS ────►│ node A        │  │ node B    …N  │  │
   │   │  · armory (USB + BLE)     │   status ▲ ▼ config  │  engine + HUD │  │  engine + HUD │  │
   │   │  · mode author + push     │                      └──────┬────────┘  └──────┬────────┘  │
   │   │  · live scoreboard        │                        BLE  │  (one gun)  BLE   │           │
   │   │  · recap                  │                          ┌──▼──┐            ┌──▼──┐         │
   │   └──────────┬────────────────┘                          │ gun │            │ gun │         │
   │              │ USB (armory setup)  · BLE (armory scan)    └─────┘            └─────┘         │
   │           ┌──▼──┐                                                                            │
   │           │ gun │  (at the bench, one at a time)                                             │
   │           └─────┘                                                                            │
   └────────────────────────────────────────────────────────────────────────────────────────────┘

   Roles (ADR-0001/0002):  MC = author + host + coordinator, BLE only at the bench (never mid-match).
                           Node = the live game engine for ONE gun + the player HUD.
```

**Key invariants** (violating these breaks the architecture):
- **A node owns exactly one gun and runs autonomously.** Its own-gun loop (arm/damage/death/respawn/
  local feedback) works with the LAN dead. See M-NODE.
- **MC never holds BLE to guns during play.** Bench only (armory). Mid-match, MC talks to *nodes* over
  the LAN. See M-NET.
- **Cross-player truth (kills, assists, accuracy, score) is MC's**, assembled from node event reports;
  it is **eventually-consistent** via store-and-forward, never assumed real-time. See M-CONTRACTS.
- **The gun is host-blind about its own kills** (ADR-0001): a kill is only observable from the
  *victim*. Every scoring rule derives from victim-side events.

## 3. The end-to-end experience (the spine every module serves)

One host runs these phases in order. Each phase names its owning module.

| # | Phase | What happens | Owner |
|---|---|---|---|
| 0 | **Armory (one-time)** | Per gun, over **USB**: read headset PIN, bind BLE MAC, write `$NAME` = sticker id, label it. Produces the permanent gun↔headset↔MAC↔name map. | M-ARMORY |
| 1 | **Muster / readiness** | **BLE scan** the fleet: who's powered, headset connected, battery %, Companion batt/fw, link. Red/green board. Nothing starts until green. | M-ARMORY |
| 2 | **Build the game** | Host picks a **mode** (TDM/FFA/…); sets global settings (indoor/outdoor, respawn rules, time limit, night/LED). Callsign-parity mode UI. | M-MODES, M-MC |
| 3 | **Kit each player** | While gearing up + sizing straps: set **vanity display name**, **team**, **weapon** (rich visual select), **voice**, per-player settings. | M-MC |
| 3a | **Weapon try-out** | Changing a weapon **silently pushes it to a private tutorial arming** so the player can shoot + reload to feel it, before committing. | M-MODES, M-NODE |
| 4 | **Lobby** | All players assigned to teams; each **readies up** on their node. On "all ready", **config is pushed to the taggers** (via nodes). | M-MC, M-NET, M-NODE |
| 5 | **Dispersed timed start** | MC issues a **go-live wall-clock time**; players walk to bases; each node counts down locally and, at T, **arms the gun + plays the countdown/klaxon through the gun speaker**. No signal needed at T. | M-START |
| 6 | **Live play** | Nodes run the match; phones show the HUD; nodes stream status/events to MC as the LAN allows; MC shows a **live scoreboard**; store-and-forward covers dropouts. | M-NODE, M-NET, M-MC |
| 7 | **Recap** | Players return in range; MC reconciles final events and computes **end state**: winner, most kills, best K/D, accuracy, medals. Exportable. | M-MC, M-CONTRACTS |

## 4. Module map (the parallel workstreams)

Each module is an independent workstream with a **frozen interface**. "Depends on" = compile/design-time
dependency; everything depends on **M-CONTRACTS**.

| Module | Owns | Exposes (interface) | Depends on |
|---|---|---|---|
| **M-CONTRACTS** | Shared data models, the node↔MC protocol, gameconfig schema, event model, time-sync + versioning. **Freeze first.** | `contracts.md` (schemas + message types) | — |
| **M-NET** | Field LAN transport: node↔MC WebSocket, mDNS/discovery, heartbeat, store-and-forward queue, clock-sync handshake, reconnect. | `Transport` client (node) + server (MC); `net` events | M-CONTRACTS |
| **M-ARMORY** | USB armory setup (Teensy console: PIN read, `$NAME`, bind) + BLE fleet scan (status/battery/map). Reuses `mcp/brx_mcp`. | Armory CRUD + `readiness()` snapshot | M-CONTRACTS |
| **M-MODES** | Game-mode catalog + config authoring; weapon loadouts + stats; the tutorial-arming frames. Reuses `gameconfig.py`/`m0`. | `GameConfig` builder + `WeaponCatalog` + `armFrames()` | M-CONTRACTS |
| **M-MC** | Mission Control app: server + web UI for phases 1-7 (readiness board, mode author, player kit-out, lobby, live scoreboard, recap). | The MC application (composes the others) | all below |
| **M-NODE** | Phone node: per-gun engine + HUD (glare/blackout modes), diagnostics, log export. Autonomous; LAN-optional. | The node app; consumes Transport + armFrames | M-CONTRACTS, M-NET, M-MODES |
| **M-START** | Dispersed time-synced start sequence (schedule, local countdown, gun-audio choreography, late/early-join handling). | `startAt(T, config)` on node + MC control | M-CONTRACTS, M-NET, M-NODE |

## 5. Parallelization plan

**Wave 0 — freeze the backbone (blocking, single-author):** M-CONTRACTS. Nothing else starts until
`contracts.md` is ratified (this doc's polish-loop). Interface changes after freeze go through a
documented amendment, not silent edits.

**Wave 1 — foundations (parallel, contract-only deps):**
- **M-NET** — build against mocked endpoints.
- **M-ARMORY** — standalone; wraps existing `mcp/` code.
- **M-MODES** — standalone; wraps existing `gameconfig`.

**Wave 2 — integrators (parallel, depend on Wave 1 interfaces, not internals):**
- **M-NODE** — HUD + engine on Transport + M-MODES frames. The current `app/` is its seed.
- **M-START** — layers on M-NODE + M-NET.

**Wave 3 — assembly:**
- **M-MC** — composes armory + modes + net + scoreboard + recap into the host app.

**Coordination rules for parallel sessions:**
1. Bind to **interfaces in `contracts.md`**, never another module's internals.
2. Any interface gap → propose an amendment to `contracts.md` (PR-style), don't fork the shape.
3. Each module ships with its own mocks/fakes so it builds without its dependencies live.
4. One module = one session's lane; cross-lane changes are handoffs, not reach-ins.

## 6. Open decisions & recommendations

Marked **[DECIDE]** where owner input is wanted; the recommendation is the default we build unless
overridden in polish-loop.

- **Field LAN host — [DECIDED, ADR-0002]:** battery **travel router** hosts the LAN; MacBook joins as
  client. Mac-hosted hotspot is a documented small-game fallback (macOS AP is weak). MC must not assume
  it is the AP.
- **Dispersed start — [DECIDED]:** **time-synced local countdown** (§M-START). Clocks synced at lobby
  over the LAN; countdown + arm happen on each node's own clock; audio plays on the gun. Solves the
  range problem without a T-0 signal.
- **Attribution fidelity — [DECIDE]:** phone nodes give **team-level** attribution (from `$HIR` shooter
  team). **Player-level K/D + assists + true accuracy need IR player-id decode (P2, Companion)** or a
  best-effort MC heuristic. Recommendation: ship **team-level now**, spec player-level as a Companion
  capability, and have MC compute a **best-effort** individual attribution from timing where it can.
- **Accuracy definition — [DECIDE]:** shots-fired is local (trigger/ammo deltas); hits-landed is only
  known from victims. Recommendation: **accuracy = confirmed-hits-on-enemies / shots-fired**, computed
  by MC from victim reports; show "—" on the phone until MC supplies it, like kills.
- **MC tech stack — [DECIDE]:** reuse. Recommendation: **MC server = Python** (wraps `mcp/brx_mcp` for
  USB + BLE armory, already cross-platform incl. CoreBluetooth) serving a **local web UI**; the node app
  stays **Capacitor** (shared web/UI kit with MC where practical). One BLE stack (bleak) for the bench,
  one web UI language across both surfaces.
- **Ready-up + config-push timing — [DECIDE]:** push full config at **lobby ready-up** (in range),
  then only the lightweight go-live time at start. Recommendation as stated; §M-START covers re-sync
  for a player who power-cycles after dispersal.

## 7. Non-negotokens (product qualities every module honors)

- **Glare-legible + blackout** HUD (outdoor sun; night play). High-contrast default, full black-out mode.
- **Autonomous nodes**, store-and-forward everywhere; no phase blocks on a live LAN except by design.
- **Stateless, interchangeable gear** (ADR-0001): any node clips to any gun; a dead unit is a hot-swap.
- **Never modify stock firmware**; all gun control over BLE serial. Panic = `$CLEAR,*` then `$SP,99,*`.
- **Diagnostics + log export** on the node for field debugging; MC can ingest node logs at recap.
- Credit **LaserTagMods (JEDGE/JBOX)** + **Jay Burden** for protocol/IR discovery in public surfaces.

## 8. Milestones

- **M1 — Node loop (done/in progress):** single-gun autonomous node + HUD (current `app/`).
- **M2 — LAN + MC skeleton:** M-NET + M-ARMORY readiness board + M-MODES author; node reports status.
- **M3 — Full kit-out + tutorial + lobby:** phases 2-4 end-to-end for 2-4 guns.
- **M4 — Timed dispersed start + live scoreboard:** phases 5-6.
- **M5 — Recap + medals + export:** phase 7.
- **M6 — Companion parity:** same Transport onto ESP32 Companions; player-level attribution via IR.

Each module doc carries its own detailed task list; this is the cross-module ladder.
