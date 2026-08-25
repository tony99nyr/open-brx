# Open BRX — End-to-End Product Spec

- **Status:** Backbone ratified; contracts at amendment **A5** (2026-08-25 — A4: P2 closed over BLE, frames
  compiled by MC, large-field reality; A5: adversarial + consistency review fixes). Module specs updated to A5.
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
  *victim* — but the victim's `$HIR` names the shooter **by player id** (`$PSET` token 1 ↔ `$HIR` token 3,
  protocol §7p/§7q). Every scoring rule derives from victim-side events; attribution is exact.
- **Frames are compiled in MC and written verbatim by nodes** (contracts A4.2). One frame authority
  (`gameconfig.py`), three runtimes (Python MC, JS phone, C++ Companion) — only the first compiles.
- **The field is a large park; the LAN covers the base, not the match** (A4.8). Config, sync and start
  happen in range; the match runs on nodes; scores reconcile at sync points. Only `time_limit_s` can end a
  dispersed match.

## 3. The end-to-end experience (the spine every module serves)

One host runs these phases in order. Each phase names its owning module.

| # | Phase | What happens | Owner |
|---|---|---|---|
| 0 | **Armory (one-time)** | Per gun, over **USB**: read headset PIN, bind BLE MAC, write `$NAME` = sticker id, label it. Produces the permanent gun↔headset↔MAC↔name map. | M-ARMORY |
| 1 | **Muster / readiness** | Players connect their **node** to their gun; each node reports gun link, `$VOLTS` battery + firmware (via the pre-config probe set), phone battery, Wi-Fi/MC reachability, clock sync (`status.preflight`, A4.9). Headset presence is **amber until the lobby push** — the proven detector is the gun's echo when written (A5.4). MC's **BLE scan is presence-only** for guns nobody has claimed yet. Red/amber/green board (`ReadinessRow`, contracts §4); nothing starts on a red — and the board cannot deadlock on a signal only the push can produce. | M-MC (board), M-NODE (report), M-ARMORY (scan + identity) |
| 2 | **Build the game** | Host picks a **mode** (TDM/FFA/…); sets global settings (indoor/outdoor, respawn rules, **time limit — required**, night/LED). Callsign-parity mode UI. | M-MODES, M-MC |
| 3 | **Kit each player** | While gearing up + sizing straps: **assign `player_num`** (1–63, shown as-is; wire 0 is reserved), set **vanity display name**, **team**, **weapon** (rich visual select), **voice**, per-player settings. | M-MC |
| 3a | **Weapon try-out** | Changing a weapon pushes a **private tutorial arming** (frames compiled by MC) so the player can shoot + reload to feel it, before committing. Audible, unscored. | M-MODES, M-NODE |
| 4 | **Lobby** | Teams locked; each player **readies up** on their node (sync must be fresh). On "all ready", MC pushes **`config` + the per-player `FrameBundle`** — nodes write the config head (gun unspawned) and ack with the gun's echo (an empty echo is the red that blocks `start`). | M-MC, M-NET, M-NODE |
| 5 | **Dispersed timed start** | MC issues **`match_id` + a go-live wall-clock time**; players walk to bases and leave range; each node counts down locally and, at T, **spawns the gun + plays the countdown through the gun speaker**. No signal at T. | M-START |
| 6 | **Live play** | Nodes run the match (damage/death/respawn/local audio, **and the timed end**); phones show the HUD; whenever a node is in range it streams status/events and gets its K/A/ACC back; MC shows a board with staleness. | M-NODE, M-NET, M-MC |
| 7 | **Recap** | Players return in range; nodes flush; MC reconciles and computes **end state**: winner, most kills, best K/D, accuracy, medals. **Provisional until every rostered node has flushed** (kills live in victims' reports). Exportable. | M-MC, M-CONTRACTS |

> **Coverage honesty (phase 6, A4.8):** each node's *own* loop (damage/death/respawn/local audio/timed end)
> is instant and offline. Cross-player effects — the green-sight kill-confirm (`$SFLASH`), live K/D/assists —
> need the victim's report to reach MC **and** MC's `feedback` to reach the shooter. On a large field that
> happens only in **coverage zones** (a base or respawn station inside router range) and at recap. Design the
> zones deliberately: put respawn/base points inside coverage so every death is a sync point, and the HUD's
> "— MC" numbers catch up every life, not only at the end. Instant field-wide feedback is the **Companion
> mesh (M6)**; on the phone path it is a zone feature, not a bug.

## 4. Module map (the parallel workstreams)

Each module is an independent workstream with a **frozen interface**. "Depends on" = compile/design-time
dependency; everything depends on **M-CONTRACTS**.

| Module | Owns | Exposes (interface) | Depends on |
|---|---|---|---|
| **M-CONTRACTS** | Shared data models, the node↔MC protocol, gameconfig + `FrameBundle` schema, event model, time-sync + versioning. | `contracts.md` (schemas + message types) | — |
| **M-NET** | Field LAN transport: node↔MC WebSocket, discovery (mDNS/QR/manual), heartbeat, store-and-forward queue, clock-sync handshake, reconnect, **platform network gates**. | `Transport` client (node) + `NetServer` (MC); `net` events | M-CONTRACTS |
| **M-ARMORY** | USB armory setup (Teensy console: PIN read, `$NAME`, bind) + **scan-only** BLE presence/identity for unclaimed guns. Reuses `mcp/brx_mcp`. | Armory CRUD + `scan()` presence; readiness rollup is M-MC's from node `status` | M-CONTRACTS |
| **M-MODES** | Game-mode catalog + config authoring + validation; weapon catalog; **the frame compiler** (`FrameBundle` per player, tutorial frames, cues). Runs in MC. Reuses `gameconfig.py`/`m0`. | `GameConfig` builder/validate + `WeaponCatalog` + `compile(config, player) → FrameBundle` + `tutorialFrames()` | M-CONTRACTS |
| **M-MC** | Mission Control app: server + web UI for phases 1-7 (readiness board, mode author, player kit-out incl. `player_num`, lobby, live board, recap, scoring). | The MC application (composes the others) | all below |
| **M-NODE** | Phone node: per-gun engine (writes bundles verbatim) + HUD (glare/blackout), preflight, BLE resync, app-lifecycle handling, diagnostics, log export. Autonomous; LAN-optional. | The node app; consumes Transport + FrameBundle | M-CONTRACTS, M-NET |
| **M-START** | Dispersed time-synced start (schedule, local countdown, gun-audio choreography from `cues`, late/early-join) **and the symmetric timed end**. | `startAt(match_id, T, …)` on node + MC control | M-CONTRACTS, M-NET, M-NODE |

## 5. Parallelization plan

**Wave 0 — backbone:** `contracts.md` ratified at A4. Interface changes go through a documented amendment,
not silent edits.

**Wave 1 — foundations (parallel, contract-only deps):**
- **M-NET** — build against mocked endpoints; **ship the platform gates first** (net.md §8), they block M2.
- **M-ARMORY** — standalone; wraps existing `mcp/` code (enroll/rename/scan).
- **M-MODES** — standalone; wraps `gameconfig.py`; adds `player_num` to `$PSET` and the `FrameBundle` compiler.

**Wave 2 — integrators (parallel, depend on Wave 1 interfaces, not internals):**
- **M-NODE** — HUD + engine on Transport + FrameBundle. The current `app/` is its seed.
- **M-START** — layers on M-NODE + M-NET.

**Wave 3 — assembly:**
- **M-MC** — composes armory + modes + net + scoring + board + recap into the host app.

**Interface freeze:** `contracts.md` covers the **wire** (data + messages). Cross-module **code**
interfaces (`Transport`/`NetServer` in `net.md`, `compile`/`tutorialFrames`/`WeaponCatalog` in `modes.md`,
`scan()`/armory CRUD in `armory.md`, `startAt()` in `start-sequence.md`) live in each module's **Interface**
section and are **frozen when that module's Wave is ratified**. After freeze they change only by the same
amendment discipline as `contracts.md`.

**Coordination rules for parallel sessions:**
1. Bind to the **wire in `contracts.md`** *and* the **Interface section of any module you depend on** —
   never another module's internals.
2. Any gap in either → propose an amendment (to `contracts.md` for wire, to the owning module's Interface
   section for code) — don't fork the shape.
3. Each module ships with its own mocks/fakes so it builds without its dependencies live.
4. One module = one session's lane; cross-lane changes are handoffs, not reach-ins.
5. **Sticker labels stay out of the repo.** Examples use `Tactix-XXXX` / `GUN-A`; real headset ids only in
   local memory and `~/.brx-mcp/`.

## 6. Decisions (and what is still open)

- **Field LAN host — [DECIDED, ADR-0002]:** battery **travel router** hosts the LAN; MacBook joins as
  client. Mac-hosted hotspot is a documented small-game fallback (macOS AP is weak). MC must not assume
  it is the AP.
- **Venue — [DECIDED]:** large park; **the LAN does not cover the match.** Coverage zones at bases (§3).
- **Dispersed start + end — [DECIDED]:** **time-synced local countdown** (§M-START) and **local time-expiry
  end** (M-NODE). `time_limit_s` is required. Frag-limit / survival / objective ends are LAN-coverage-only.
- **Attribution — [DECIDED, A4.1/A5.2]:** exact, per player, BLE-native (`$PSET` id ↔ `$HIR` token 3). No
  heuristics. Friendly fire is roster-team-based and never applies in FFA. Wire id 0 is reserved (A5.1).
- **Accuracy — [DECIDED, A4.4]:** `hits` from victims' `hit_taken` (shooter-tagged) ÷ shooter's
  `status.shots` counter; MC number; "— MC" on the HUD until supplied.
- **Frame compilation — [DECIDED, A4.2]:** MC compiles (`gameconfig.py`), nodes write verbatim.
- **Readiness — [DECIDED, A4.9/A5.4]:** node-reported via `status.preflight` + the `ack_config` gun echo; MC
  BLE is scan-only presence for unclaimed guns. Headset/screen are amber before the push, never a muster red.
- **BLE resync — [DECIDED, A5.3]:** observe before write (trigger prompt; `$ALCD` = alive, `$BUT`-only = dead,
  silence = re-push). Never a forced respawn on reconnect.
- **After a match — [DECIDED, A5.9]:** nodes return to KITTED; a rematch is a new `config` push.
- **Runway — [DECIDED, A5.10]:** default 120 s ("walk time"), host-set.
- **MC tech stack — [DECIDED]:** **MC server = Python** (wraps `mcp/brx_mcp` for USB + BLE, cross-platform
  incl. CoreBluetooth; owns the frame compiler) serving a **local web UI**; the node app stays **Capacitor**.
- **Ready-up + config-push timing — [DECIDED]:** full `config` + `FrameBundle` at **lobby all-ready** (in
  range), then only `start` at go time. M-START covers re-sync for a power-cycled node.
- **[OPEN — bench] Hold-across-disperse:** does a gun keep `head` for minutes unspawned? (start-sequence §3.)
- **[OPEN — bench] BLE resync probe:** is there a side-effect-free "what's your state" query that would replace
  the trigger prompt? Does an unspawned head echo at all with the headset off? Is `$START` in the head audible
  at the lobby write? Does a mid-match `$TID` write change the gun's friendly-fire resolution? (node.md §3.10, modes §9.)
- **[OPEN — bench] Link longevity:** 20-min two-node soak with a screen-lock and a backgrounding.
- **[OPEN] `$VOLTS` % token; night LED-off; voice-pack maps; `game_over`/tick/klaxon cue ids.** (module docs.)

## 7. Non-negotiables (product qualities every module honors)

- **Glare-legible + blackout** HUD (outdoor sun; night play). High-contrast default, full black-out mode.
- **Autonomous nodes**, store-and-forward everywhere; no phase blocks on a live LAN except by design.
- **The phone is mounted and foreground** during ARMED/LIVE (A4.11): a rail/forearm mount is a hardware
  deliverable; the app keeps the screen on and treats background/lock as a fault it recovers from.
- **Stateless, interchangeable gear** (ADR-0001): any node clips to any gun; a dead unit is a hot-swap
  (`welcome` re-hydrates it).
- **Never modify stock firmware**; all gun control over BLE serial. Panic = `$CLEAR,*` then `$SP,99,*`.
- **Diagnostics + log export** on the node for field debugging; MC can ingest node logs at recap.
- Credit **LaserTagMods (JEDGE/JBOX)** + **Jay Burden** for protocol/IR discovery in public surfaces.

## 8. Milestones

- **M1 — Node loop (done):** single-gun autonomous node + HUD (current `app/`); two-node game proven.
- **M2 — LAN + MC skeleton:** M-NET incl. platform gates + QR join; MC readiness board from node
  `status`; M-MODES compiler with `player_num`; node writes a pushed `FrameBundle`.
- **M3 — Full kit-out + tutorial + lobby:** phases 2-4 end-to-end for 2-4 guns; exact attribution on the
  board (P2 is done — this is wiring).
- **M4 — Timed dispersed start + timed end + coverage-zone feedback:** phases 5-6 on a real field.
- **M5 — Recap + medals + export:** phase 7.
- **M6 — Companion parity:** same Transport + FrameBundle onto ESP32 Companions; mesh for field-wide
  live feedback.

Each module doc carries its own detailed task list; this is the cross-module ladder.
