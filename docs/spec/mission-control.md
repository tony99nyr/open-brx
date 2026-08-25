# M-MC — Mission Control (the host app)

- **Status:** Draft (Wave 3 integrator). Binds to [`contracts.md`](contracts.md) — **read it first**.
- **Owner:** M-MC session. **Extends** `docs/mission-control-spec.md` (feature catalog) and matches/beats
  the operator surface in `docs/reference/callsign-ui.md`. Anchored by ADR-0002 (laptop = author + host +
  coordinator, BLE only at the bench).
- **Role:** the **integrator**. MC owns no game rules, no protocol frames, no transport of its own — it
  **composes** M-ARMORY, M-MODES, M-NET and drives the host through README §3 phases 1-7. Every data
  shape it touches is defined in `contracts.md`; this doc says *what MC does with them*, not what they are.

This is a **design** spec: screens, behaviors, and the interfaces MC consumes. It does not restate schemas,
protocol frames, or another module's internals — it links them.

---

## 1. What MC is (and is not)

MC is the **one operator surface** for an event: enroll/health-check gear, author a game, kit each player,
run a synced start, watch a live board, and produce a recap. It is the human's window into the whole
[architecture-at-a-glance](README.md#2-architecture-at-a-glance) diagram.

**MC is not** the game engine (that is M-NODE, per gun) and is **not BLE-connected to guns during play**
(`mc-not-live-during-gameplay`). MC holds BLE **only at the bench** for armory (phase 0-1). Once players
disperse, MC talks to **nodes** over the field LAN via M-NET, never to guns. Cross-player truth (kills,
assists, accuracy, score) is **MC-derived** from node event reports (`contracts.md` §4), eventually
consistent, never assumed real-time.

## 2. Tech / stack — **[recommend: Python server + local web UI]**

Per README §6 "MC tech stack", the recommendation the backbone already leans to:

- **MC server = Python.** It **wraps `mcp/brx_mcp`** for the armory (USB Teensy console + BLE scan/connect
  via `bleak`), which is already cross-platform — **CoreBluetooth on the MacBook**, WinRT/BlueZ elsewhere.
  One BLE stack for the bench, reused, not reimplemented. The server also hosts the M-NET WebSocket + mDNS
  endpoint (`contracts.md` §5) and holds all match state.
- **UI = a local web app** the server serves at `http://<mc-host>:<port>/` — opened in the operator's
  browser on the same machine. Big-screen roster/board/recap (ADR-0002 "big screen" rationale). Sharing a
  web/UI kit with the Capacitor node app (M-NODE) where practical keeps **one web-UI language across both
  surfaces**.
- **Why not Web Bluetooth in MC:** rejected in `mission-control-spec.md` — no silent bulk scan (user-gesture
  picker per tagger), ~7-10 link ceiling, no iOS. The Python `bleak` path has none of those limits and is
  the same code the CLI already uses.
- **State store:** match/roster/armory persist under `~/.brx-mcp/` on the host (armory registry already
  lives there, `contracts.md` §1). Event log → SQLite so recap survives a crash and store-and-forward can
  backfill late (README §8 M5).

**Justification in one line:** reuse the working BLE + protocol code (Python), avoid a second BLE stack,
give the host a real screen, and keep the node's web UI kit shared.

## 3. Field-LAN control (start/join the network)

MC **must not assume it is the AP** (ADR-0002). Two paths, host picks at session start:

- **Primary — travel router.** The battery router hosts the LAN; MC **joins as a client** and advertises
  `_openbrx._tcp` (mDNS/Bonjour, `contracts.md` §5) so nodes self-discover. This keeps the AP burden off
  the Mac and the Mac free for other Wi-Fi if wanted.
- **Fallback — Mac hotspot.** For a small pickup game MC can run macOS Internet Sharing as the AP. **Note
  the macOS AP is weak** (limited clients, flaky) — surface a warning and a client-count guidance; this is
  a documented small-game fallback, not the default.

**Network screen (always reachable):** shows LAN mode (router / hotspot), **MC's own address** printed big
(`http://192.168.x.x:PORT` + the mDNS name) so a node whose auto-discovery fails can be **pointed manually**
(the `contracts.md` §5 "host types MC's IP" fallback). Live list of connected nodes with heartbeat age
(from M-NET). A node appears here the moment it sends `hello`.

## 4. Phase 1 — Readiness board (muster)

Renders **M-ARMORY `readiness()`** (a `ReadinessSnapshot`; MC does not scan the fleet itself — it asks
M-ARMORY). Per gun, a **red/amber/green** card built straight from the `ReadinessRow` fields (M-ARMORY
§3.4):

| Signal | Green when | Source (M-ARMORY `ReadinessRow`) |
|---|---|---|
| Present / advertising | seen in the BLE `scan()` | `present` (scan) |
| Identity | advert basename == sticker, not a `Tactix2` revert | `identity` (`correlate`, §2.2) |
| Headset linked | answers the `$VERSION`/`$VOLTS` ritual ⇒ live headset at link | `headset` (§3.3) |
| Battery % | fresh `$VOLTS` reading above threshold | `battery_pct` + `battery_age_ms` |
| Firmware | `$VERSION` after the `$STOP→$PHONE→$VERSION` ritual | `fw` |
| Reachable | link holds + the notification stream heartbeats | `rssi` + persistent-connection stream |
| Companion batt/fw (later) | present + charged | `companion` (node `hello`/`status`) |

- Sort by lowest battery; flag any gun below threshold to charge before play.
- Each card shows the **sticker id** (`Tactix-XXXX` form in all committed examples — never real labels).
- **"Re-scan armory"** re-pulls `readiness()`. **Start gates on `ReadinessSnapshot.go` (no reds)** — the
  board owns the go/no-go, but **amber does not block** (a missed `$VOLTS`, a field-only headset ambiguity,
  `name_confirmed=false` are shown, not gating; M-ARMORY §3.4, contracts A1 amber-not-red). Amber rows are
  surfaced for the host to address, red rows must clear before START.
- Bench BLE actions (enroll, `$NAME` write, panic) delegate to M-ARMORY; MC never issues frames directly.

## 5. Phase 2 — Build the game (mode author)

The **Callsign-parity** authoring surface, but done better than the app (`callsign-ui.md` UX notes: the
1-at-a-time carousel and the 1-slider global settings are the anti-patterns to beat).

**Mode selection UI:** the whole mode set as a **searchable grid shown at once** (not a carousel). Tiles
come from **M-MODES catalog** (TDM / FFA / Infection / LMS / Extraction / …). Selecting a mode loads its
default `GameConfig` (`contracts.md` §3) which the host then tunes.

**Global settings panel** — one coherent surface, editing the `GameConfig` fields:

| Control | Maps to `GameConfig` | Values (Callsign parity) |
|---|---|---|
| Environment | `environment` | indoor / outdoor |
| Night / LED | `night` (+ `led`) | on / off → blackout HUD + LED choices |
| Time limit | `time_limit_s` | minutes, or untimed (null) |
| Respawn | `respawn.{type,delay_s}` | Scanner / Auto / none · delay |
| Scoring | `scoring.{frag_limit,win_by}` | score-to-win, kills / survival / objective |
| Health | `health.{max_hp,max_armor}` | mode default, overridable |
| Teams | `teams[]` | team list + colors (`tid`→`$TID`) |

MC **does not** compute frames or validate enums itself — it edits the `GameConfig` object and lets
**M-MODES** own defaults/validation. Output of this phase is a single serializable `GameConfig` that
round-trips (author → JSON → frames) with no hidden state (`contracts.md` §3). Save/load named games.

## 6. Phase 3 — Kit each player

Done **while players gear up and size straps** — the UI is built for a host walking down a line, not a
sit-down form. One **player card** per person (a `Player`, `contracts.md` §2):

- **Vanity DISPLAY NAME** — the gamertag the host types. This is a **display layer only**; it is **never
  written to the gun** (the gun's `$NAME` is the permanent sticker id — `tagger-naming-architecture`,
  `mission-control-spec.md` §1b). It labels the scoreboard and recap.
- **Team** — assign to a `Team`; color follows `tid` automatically.
- **Voice** — dropdown; Male / Female today (`callsign-ui.md`), room for the full voice-pack set later.
- **Per-player settings / overrides** — `Loadout.overrides` (max_hp/armor) where the mode allows.
- **Gun binding** — pick which rostered gun (`gun_id`) this player carries; the readiness board must show
  it green.

Committing a player card pushes **`assign { player, team }`** to that player's node (`contracts.md` §5) —
**player + team only, no config** — moving the node to **KITTED**. This is what makes the phase-3a tutorial
legal (KITTED precondition); the full `GameConfig` is the *separate* lobby `config` push (§7).

### 6a. Weapon select — a **cool, visible** UI

The headline surface. A rich **weapon gallery** (not a dropdown): **weapon art + the three exact printed
numbers** (clip / reserve mags / reload s) and the relative **Damage / RPM / Range bars**, all from the
**M-MODES `WeaponCatalog`** (`contracts.md` §3; seed values in `callsign-ui.md`'s ~18-weapon table). Class
badges, filter/sort by class or stat. Selecting a weapon sets a `WeaponSel` in the player's `Loadout`
(ordered → gun slots). Primary + optional secondary (removable), matching Callsign but visually far ahead.

**Weapon art (`Weapon.icon?`, contracts §3) is optional in the catalog.** MC **ships a bundled placeholder
icon set** (class-based silhouettes) as the owner/fallback and renders it wherever `icon` is absent; real
per-weapon art is TBD and drops in without a schema change (additive `icon` on the `WeaponCatalog`).

### 6b. Phase 3a — Weapon try-out (silent tutorial arming)

**The magic moment:** the instant the host changes a player's weapon, MC **silently pushes a private
tutorial arming to that player's gun** so they can **shoot + reload to feel it** before committing — no
full game, no scoring, no announcement.

- MC sends **`tutorial { weapon }`** to that player's node (`contracts.md` §5, MC→Node). The node arms its
  gun with **M-MODES `armFrames()`/tutorial frames** and lets the player fire and reload; nothing is
  scored and no `start` is implied. State stays in `KITTED` (node lifecycle, `contracts.md` §6).
- **UX:** on the player card, weapon selection is **live** — tap a new weapon, a subtle "trying out on
  <name>'s gun" indicator appears; the player squeezes the trigger a few times, feels the fire rate + mag +
  reload, and either the host keeps it or taps another. Volume for these arming pushes **must be `VOL 69`**
  (the audible game value, `modes.md`) — **not** the diagnostic `30`, which is inaudible for weapon/game
  audio — so the try-out is actually heard; it rides the node's game audio path, never the probe default.
- This flows **MC → M-NET → node → M-MODES frames → gun**; MC never touches the gun (players may already be
  out of bench BLE range — this is why it goes over the LAN via the node).

## 7. Phase 4 — Lobby

- **Team assignment finalized:** drag-and-drop team builder, auto-balance, lock teams before start
  (`mission-control-spec.md` §2). Board shows each team's roster + colors.
- **Per-player READY-UP:** each player readies on **their node**, which sends **`ready { player_id, ready }`**
  over M-NET (`contracts.md` §5, A1) to flip `Player.ready` — a LOBBY-state toggle. The lobby shows a live
  ready/not-ready column; the host can also override-ready a player.
- **Push config on all-ready:** when every rostered player is ready (and readiness is `go`), MC pushes the
  **full `GameConfig`** to each node via the **`config { config: GameConfig }`** message (`contracts.md` §5,
  A2) — the **separate** lobby push, distinct from the phase-3 `assign` (which carried player+team only, no
  config). Nodes store it, enter **LOBBY**, and return **`ack_config`**; MC shows per-node applied/failed and
  **blocks start on any un-acked node**. This is the "push full config at lobby ready-up, in range" timing
  decision (README §6). After this only the lightweight go-live schedule is sent at start.

## 8. Phase 5 — Dispersed timed start

MC **delegates the start choreography to M-START** — it does not implement the countdown. MC's job:

- Host taps **START**; MC picks a **go-live wall-clock time** `go_live_t` (synced clock, `contracts.md` §7)
  a configurable lead ahead (enough to walk to bases), and issues **`start { go_live_t, config_id, seq,
  countdown_s }`** to every node (`contracts.md` §5).
- **MC MUST stamp a monotonic `seq`** (per session) on **every** `start` it issues. The `seq` is what a
  reschedule or an **`abort_start`** targets — a higher `seq` supersedes a prior schedule — so a specific
  pending start can be cancelled or replaced unambiguously (contracts §9 "three `seq` namespaces": this is
  `start.seq`, MC-owned, distinct from the per-node event counter). Re-issuing `start` to a straggler carries
  a fresh higher `seq`.
- **Per-node "armed, T-minus" board:** each node counts down on its **own synced clock** and arms its gun +
  plays the countdown/klaxon **through the gun speaker** at T — no signal needed at the instant (README §5,
  M-START). MC shows each node's state: got-start → armed → T-minus HH:MM:SS → LIVE. A node that never
  synced falls back to `now + duration` from receipt (degraded, flagged) — MC surfaces the flag.
- Late/early-join and power-cycle-after-dispersal re-sync are **M-START's** concern; MC just reflects node
  state and can re-issue `start` to a straggler.

## 9. Phase 6 — Live scoreboard

A **Halo-style live board** assembled from node **`status`/`event`** reports over the LAN (M-NET). Built
for **store-and-forward tolerance** — the board is a projection of eventually-consistent data, never a
real-time assumption.

- **Rows** are `ScoreRow` (`contracts.md` §4): kills, deaths, assists, shots, hits, accuracy, K/D, streak,
  medals — **all MC-derived**. MC ingests node-observable `Event`s (`shot`, `hit_taken`, `death`, `respawn`,
  `status`) and computes cross-player truth using the §4 rules and the §9 constants (`ASSIST_WINDOW_MS`,
  `MULTI_KILL_MS`, `ATTRIB_FUSE_MS`, etc.). **Kills/assists/accuracy are never sent by nodes** — MC alone
  produces them from victim-side `hit_taken`/`death` (the gun is host-blind about its own kills).
- **Attribution fidelity (README §6):** ship **team-level** now (from `shooter_team`); when a Companion
  supplies `shooter_id` (P2) go exact; otherwise MC MAY best-effort individual-attribute from timing/
  proximity, **flagged `approx`** on the row.
- **Staleness:** dedup by `(node_id, seq)`; treat a missing node as **stale, not gone** — show last-known
  values with a **staleness age** (grey after `STALE_AFTER_MS`). Late `event_batch` flushes on reconnect
  reconcile silently.
- **Feedback loop:** when MC scores a kill/multi/medal it MAY send **`feedback`** to the scoring node so it
  greens the sight + plays audio (`contracts.md` §5) — best-effort, the node never depends on it.
- **Host controls:** `control { cmd: end|pause|panic|abort_start|recall }` (`contracts.md` §5). One meaning
  each: **`abort_start`** cancels a *pending* scheduled start (by `seq`, back to LOBBY — issued from the Start
  screen before go-live); **`recall`** stops a *live/armed* game; `end` is a normal match end; `pause` holds.
  **Panic** relays the safe sequence to nodes, which apply `$CLEAR,*` then `$SP,99,*` to their gun (MC issues
  the *command*, the node issues the frames).
- **TV mode:** a full-screen board for a spectator display.

## 10. Phase 7 — Recap

When players return in range, MC **reconciles final events and computes end state**:

- **Ingest node logs:** a node offers `log_offer`; MC requests **`pull_log`** and folds the diagnostic
  events into the SQLite log so late/dropped events complete the record (store-and-forward closure).
- **Compute end state** from the reconciled event log: **winner** (by `scoring.win_by`), **most kills**,
  **best K/D**, **accuracy leader**, and **medals** (MVP / Top Gun / Sharp Shooter / multi-kills — sourced
  from `config-facts.md` via M-MODES/contracts constants).
- **Export:** match summary + per-player `ScoreRow`s + kill feed to a file (JSON/CSV) under `~/.brx-mcp/`;
  optional at-home sync is out of scope for the field (ADR-0002 — the field is an island).

## 11. Interfaces MC consumes (by contract, not internals)

MC binds only to these published surfaces; a gap becomes a `contracts.md` **amendment** (README §5), never
a reach-in.

| Module | MC consumes | For |
|---|---|---|
| **M-ARMORY** | `readiness()` snapshot; armory CRUD (enroll/`$NAME`/bind); bench panic | phases 0-1 |
| **M-MODES** | mode catalog + `GameConfig` builder/defaults/validation; `WeaponCatalog`; `armFrames()`/tutorial frames | phases 2, 3, 3a |
| **M-NET** | Transport **server**: mDNS advertise, node WS, heartbeat, store-and-forward intake, clock-sync; `hello`/`bind`/`event`/`event_batch`/`ack_config`/`log_offer` in; `welcome`/`assign`/`config`/`tutorial`/`start`/`feedback`/`control`/`pull_log` out | phases 3a-7 |
| **M-START** | `startAt(go_live_t, config_id, seq, countdown_s)` control (MC-stamped `seq`) + per-node armed/T-minus state; `abort_start(seq)` | phase 5 |
| **M-CONTRACTS** | every data shape: `ArmoryRecord`, `Player`, `Team`, `Loadout`, `GameConfig`, `Weapon`, `Event`, `Kill`/`Assist`/`ScoreRow`, envelope, constants | all |

MC **produces**: the roster/match state, the derived scoreboard (`ScoreRow`), the recap + export, and the
operator UI itself. It **owns** none of the schemas or frames.

## 12. Screen map (the app)

| Screen | Phase | Core content |
|---|---|---|
| **Network** | any | LAN mode, MC address (big), connected-node list + heartbeat |
| **Readiness** | 1 | red/green gun cards from `readiness()`; start-gate |
| **Build Game** | 2 | mode grid + global settings panel (`GameConfig`) |
| **Kit Players** | 3/3a | player cards; weapon gallery; live try-out |
| **Lobby** | 4 | team builder, ready column, push-config + ack status |
| **Start** | 5 | START + per-node armed/T-minus board |
| **Live** | 6 | Halo-style board, staleness, host controls, TV mode |
| **Recap** | 7 | winner/leaders/medals, log ingest, export |

## 13. Task breakdown

1. **Python server skeleton** — HTTP static + JSON API; serve the web UI; state store + SQLite event log
   under `~/.brx-mcp/`.
2. **Wrap M-ARMORY** — `readiness()` render + re-scan; bench actions delegated (mock until M-ARMORY lands).
3. **M-NET server integration** — mDNS advertise, node WS intake, node list + heartbeat, store-and-forward
   ingest, clock-sync serving.
4. **Build-game UI** — mode grid + global settings bound to `GameConfig` (M-MODES catalog/defaults).
5. **Kit-players UI** — player cards; **weapon gallery** from `WeaponCatalog`; team/voice/overrides.
6. **Tutorial try-out** — live weapon change → `tutorial` push → node arms; the "trying out" UX.
7. **Lobby** — team builder + ready column; `config` push + `ack_config` gate.
8. **Start** — delegate to M-START; per-node armed/T-minus board.
9. **Scoring engine** — ingest `Event`s → `Kill`/`Assist`/`ScoreRow` per `contracts.md` §4 + constants;
   staleness; `approx` flag; `feedback` emit.
10. **Live board + host controls** — Halo-style board, TV mode, end/pause/panic/recall.
11. **Recap** — end-state compute, `pull_log` ingest, medals, export.
12. **Network chooser** — router-join vs Mac-hotspot with the macOS-AP-weak warning + manual-IP display.

Each ships with **mocks** for its dependencies (README §5 rule 3) so MC builds before M-ARMORY/M-MODES/
M-NET are live.

## 14. Open questions

- **`feedback` fan-out cost.** How aggressively should MC push `feedback` (every kill? only medals?) given
  best-effort delivery and node audio load. Default: kills + medals, coalesced.
- **`approx` attribution algorithm.** The timing/proximity heuristic for individual attribution without
  `shooter_id` (P2) needs a concrete rule inside `ATTRIB_FUSE_MS` — spec vs defer to Companion.
- **Host-side mid-match interventions.** `mission-control-spec.md` §5 lists powerups/extra-life/loadout-swap.
  ADR-0002 says MC is not gun-connected mid-match — so any intervention must ride `control`/`assign` **via
  the node**. Confirm which interventions are in scope for M-MC vs deferred.
- **Multi-operator / handoff.** One host today; is a second read-only board (another laptop/phone on the
  LAN) wanted for a co-host? Out of scope unless requested.
- **Node → player binding trust.** How MC confirms a node actually holds the gun it claims (`bind.gun_tail`)
  before pushing config — reconcile against readiness/armory map.

---

*Credit **LaserTagMods (JEDGE/JBOX)** and **Jay Burden** for the protocol/IR discovery MC's armory and
scoring stand on, in any public-facing surface (README §7).*
