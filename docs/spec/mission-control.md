# M-MC — Mission Control (the host app)

- **Status:** Draft (Wave 3 integrator), updated to contracts **A6**. Binds to [`contracts.md`](contracts.md) — **read it first**.
- **Owner:** M-MC session. This is the **current MC spec** (the authority for the feature catalog); it
  matches/beats the operator surface in `docs/reference/callsign-ui.md`. Anchored by ADR-0002 (laptop = author
  + host + coordinator, BLE only at the bench).
- **Role:** the **integrator**. MC owns no game rules and no transport of its own — it **composes**
  M-ARMORY, M-MODES (which runs *inside* MC and compiles every frame), M-NET, and drives the host through
  README §3 phases 1-7. Every data shape it touches is defined in `contracts.md`; this doc says *what MC
  does with them*, not what they are.

This is a **design** spec: screens, behaviors, and the interfaces MC consumes. It does not restate schemas,
protocol frames, or another module's internals — it links them.

---

## 1. What MC is (and is not)

MC is the **one operator surface** for an event: enroll gear, author a game, kit each player, run a synced
start, watch a board, and produce a recap. It is the human's window into the whole
[architecture-at-a-glance](README.md#2-architecture-at-a-glance) diagram.

**MC is not** the game engine (that is M-NODE, per gun) and is **not BLE-connected to guns during play**
(`mc-not-live-during-gameplay`). MC holds BLE **only at the bench** for Armory Setup and a **scan-only**
presence sweep. Once players disperse, MC talks to **nodes** over the field LAN via M-NET, never to guns.

**Cross-player truth (kills, assists, accuracy, score) is MC-derived** from node event reports
(`contracts.md` §4) and it is **exact**: every hit a gun takes names the shooter's player id (`$PSET`
token 1 ↔ `$HIR` token 3, protocol §7p/§7q, hardware-verified). There are **no attribution heuristics** —
MC maps `shooter_num → player_id` through the match roster and credits. What MC is *not* is real-time:
**the field is a large park and the LAN covers the base, not the match** (README §3 "coverage honesty",
contracts A4.8). The live board is a **coverage-zone view** — a node's line is current only while that node
is in range; everything else is last-known + a staleness age, and reconciles at **sync points** (a base or
respawn station inside router range, or recap). Design every MC screen around that, never around a live
LAN.

## 2. Tech / stack — **[DECIDED: Python server + local web UI]**

Per README §6:

- **MC server = Python.** It **wraps `mcp/brx_mcp`** for the armory (USB Teensy console + BLE scan via
  `bleak`), which is already cross-platform — **CoreBluetooth on the MacBook**, WinRT/BlueZ elsewhere. The
  same process **hosts the frame compiler** (M-MODES = `gameconfig.py`, Python): MC compiles each player's
  `FrameBundle` and tutorial frames and ships them over the LAN; nodes write them verbatim (contracts A4.2).
  One BLE stack, one frame authority, reused not reimplemented. The server also hosts the M-NET WebSocket +
  mDNS/QR endpoint (`contracts.md` §5) and holds all match state.
- **UI = a local web app** the server serves at `http://<mc-host>:<port>/` — opened in the operator's
  browser on the same machine (and on a tablet on the field LAN). Big-screen roster/board/recap (ADR-0002).
  Sharing a web/UI kit with the Capacitor node app (M-NODE) where practical keeps **one web-UI language**.
- **Why not Web Bluetooth in MC:** rejected per ADR-0003 — no silent bulk scan, ~7-10 link
  ceiling, no iOS. The Python `bleak` path has none of those limits and is the same code the CLI uses.
- **State store:** match/roster/armory persist under `~/.brx-mcp/` on the host (armory registry already
  lives there, `contracts.md` §1). **Event log → SQLite**, every inbound envelope stored with its node `t`,
  MC's **`t_recv`** (contracts A4.7), and `match_id` (A4.3), so recap survives a crash, late flushes backfill,
  and foreign-match events can be **parked** rather than scored.

**Justification in one line:** reuse the working BLE + protocol + frame code (Python), avoid a second BLE
stack or a JS/C++ frame compiler, give the host a real screen, keep the node's web UI kit shared.

## 3. Field-LAN control (start/join the network)

MC **must not assume it is the AP** (ADR-0002). Two paths, host picks at session start:

- **Primary — travel router.** The battery router hosts the LAN; MC **joins as a client** and advertises
  `_openbrx._tcp` (mDNS/Bonjour, `contracts.md` §5) so nodes self-discover. This keeps the AP burden off
  the Mac and the Mac free for other Wi-Fi if wanted.
- **Fallback — Mac hotspot.** For a small pickup game MC can run macOS Internet Sharing as the AP. **Note
  the macOS AP is weak** (limited clients, flaky) — surface a warning and a client-count guidance; this is
  a documented small-game fallback, not the default.

**Network screen (always reachable):** shows LAN mode (router / hotspot), **MC's own address** printed big
(`ws://192.168.x.x:PORT` + the mDNS name) **and as a QR code** (net.md §3 — scanning beats typing on 16
phones), so a node whose auto-discovery fails can be pointed manually. Live list of connected nodes with
heartbeat age (from M-NET). A node appears here the moment it sends `hello`. The screen also carries the
**operator preflight checklist** the phones cannot enforce for themselves: *mobile data off (or the app
bound to Wi-Fi), auto-join the field SSID, auto-lock off, **Do-Not-Disturb on** (`preflight.dnd_on`)* — see net.md §8.

## 4. Phase 1 — Readiness board (muster) — **node-reported (A4.9)**

Readiness is assembled by **MC**, not by a BLE sweep. A gun's single BLE central belongs to its **node**,
so the node is the thing that can actually see the gun; MC's own BLE is a **scan-only presence sweep**
(M-ARMORY `scan()`) for guns nobody has claimed yet. Sources, per row:

| Signal | Green when | Source |
|---|---|---|
| Gun claimed / linked | a node has `bind`-ed this gun and `status.preflight.gun_linked` | node `hello.gun` + `bind` + `status` |
| Identity | advert basename == sticker (not a `Tactix2` revert), matches the armory | M-ARMORY `scan()` `ScanRow.identity` / armory map |
| **Headset linked** | **amber until the config push** (A5.4): the only hardware-proven detector is the `$LCD,45,70,…` echo on **`$SPAWN`** (B18b). After the lobby push, a non-empty `ack_config.gun_echo` (the head's echo is `$LCD,0,0,0,0,0,0` — it proves the gun *answered*, not its state) turns it green; an **empty echo is red** and blocks `start`. Whether an unspawned head echoes with the headset off is **UNVERIFIED** (bench, §14). | node `ack_config` / `status.preflight.headset_ok` (amber-only pre-push) |
| Gun battery % | fresh `$VOLTS` via the node — it streams only after the node's **pre-config probe set** (`$PHONE,*`, contracts §3; CONNECTED/KITTED only); **amber** (not red) if unsampled — a miss ≠ flat (A1) | node `status.battery` |
| Firmware | `$VERSION` from the node's pre-config probe ritual (`$STOP→$PHONE→$VERSION`, contracts §3) | node `hello.gun.fw` / `status.fw` |
| Phone battery | above threshold | `status.preflight.phone_batt` |
| Wi-Fi | on the field SSID | `status.preflight.ssid_ok` |
| MC reachable | the socket that carried this `status` (self-evident) + `mc_reachable` | node `status` |
| Clock synced | `status.synced` (fresh within `SYNC_FRESH_MS`) | node `status` |
| Screen / foreground | `status.preflight.screen_on && foreground` — **amber before `start`** (players lock phones while waiting), red only at the start gate | node `status` |
| Mobile data off / auto-join / auto-lock off / DND on | operator checklist — the phone can't report all of it reliably (`auto_join_ok`, `cellular_off`, `dnd_on` best-effort) | host ticks it (§3) |
| Unclaimed guns | advertising but no node — listed separately with tail + RSSI so the host can hand them out | M-ARMORY `scan()` |
| Companion batt/fw (later) | present + charged | node `hello`/`status` |

- **No deadlock (A5.4).** Before the config push, **red** = no node, identity reverted/unknown, never synced, wrong
  SSID / MC unreachable; **amber** = headset unknown, battery unsampled/stale, low phone battery, screen or
  foreground off, fw unknown — shown, not gating. The push itself is the headset test: an empty `gun_echo`
  afterwards is red and blocks `start`. (Making "headset not proven" red pre-push would block the very push that
  proves it.) The row/board shapes are `ReadinessRow`/`ReadinessSnapshot` in **contracts §4** — MC assembles them,
  never redefines them.
- Sort by lowest battery; flag any gun/phone below threshold to charge before play.
- Each card shows the **sticker id** (`Tactix-XXXX` form in all committed examples — never real labels)
  and the **player number** once kitted.
- The board is a projection of the latest `status` per node plus the last `scan()`; it re-renders on every
  heartbeat. There is **no persistent-connection fleet reader** and MC never holds N links to N guns.
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
| **Time limit — required** | `time_limit_s` | minutes. **The only end condition that reaches a dispersed node** (A4.8); `validate()` refuses null unless the host marks the venue fully covered |
| Respawn | `respawn.{type,delay_s}` | Scanner / Auto / none · delay |
| Scoring | `scoring.{frag_limit,win_by}` | score-to-win, kills / survival / objective — shown with a **"coverage-zone only"** badge: MC can end the match early on these only for nodes it can reach |
| Health | `health.{max_hp,max_armor}` | mode default, overridable |
| Teams | `teams[]` | team list + colors (`tid`→`$TID`); FFA = one team, FF on |

MC **does not** compute frames or validate enums itself — it edits the `GameConfig` object and lets
**M-MODES** own defaults/validation (`validate()`). Output of this phase is a single serializable
`GameConfig` that round-trips (author → JSON → frames) with no hidden state. Save/load named games.

## 6. Phase 3 — Kit each player

Done **while players gear up and size straps** — the UI is built for a host walking down a line, not a
sit-down form. One **player card** per person (a `Player`, `contracts.md` §2):

- **Player number** — `player_num`, **1–63, shown as-is** and written as-is to `$PSET` token 1 (contracts A5.1;
  **wire 0 is reserved** for tutorial arms / unknown shooter and is never a player). MC **auto-assigns in roster
  order** (first player = 1) and lets the host edit; unique per match, ≤63 players.
  This is the id every enemy gun will report when it is hit by this player — it is what makes K/D exact.
- **Vanity DISPLAY NAME** — the gamertag the host types. This is a **display layer only**; it is **never
  written to the gun** (the gun's `$NAME` is the permanent sticker id — `tagger-naming-architecture`).
  It labels the scoreboard, recap, and other players' "☠ by …" line.
- **Team** — assign to a `Team`; color follows `tid` automatically.
- **Voice** — dropdown; Male / Female today (`callsign-ui.md`), room for the full voice-pack set later.
- **Per-player settings / overrides** — `Loadout.overrides` (max_hp/armor) where the mode allows.
- **Gun binding** — pick which rostered gun (`gun_id`) this player carries; the readiness board must show
  its node green.

Committing a player card pushes **`assign { player, team, roster }`** to that player's node
(`contracts.md` §5) — player + team + the current roster, **no config** — moving the node to **KITTED**.
`assign` is **re-sent on any change** to that player (name, team, number, loadout); the node's latest
`player` is authoritative. The full `GameConfig` + frames is the *separate* lobby `config` push (§7).

### 6a. Weapon select — a **cool, visible** UI

The headline surface. A rich **weapon gallery** (not a dropdown): **weapon art + the three exact printed
numbers** (clip / reserve mags / reload s) and the relative **Damage / RPM / Range bars**, all from the
**M-MODES `WeaponCatalog`** (`contracts.md` §3; seed values in `callsign-ui.md`'s ~18-weapon table). Class
badges, filter/sort by class or stat. Selecting a weapon sets a `WeaponSel` in the player's `Loadout`
(ordered → gun slots). Primary + optional secondary (removable), matching Callsign but visually far ahead.

> ⚠ **The bars are not equally meaningful (2026-08-26).** `rng` is the wire's `t41`, which reads
> **75 on all eighteen guns** — range is not differentiated on the wire at all, so that bar carries no
> information today. `dmg` is the emitted magnitude (`t5`); five weapons land more or less than it via
> their `$SIR` row. Showing **hits-to-kill** against the live health config is the honest number —
> `weapons.json` now carries `htk`/`ttk_ms` per weapon. See `docs/weapon-design.md` §6.2.

**Weapon art (`Weapon.icon?`, contracts §3) is optional in the catalog.** MC **ships a bundled placeholder
icon set** (class-based silhouettes) as the owner/fallback and renders it wherever `icon` is absent; real
per-weapon art is TBD and drops in without a schema change (additive `icon` on the `WeaponCatalog`).

### 6b. Phase 3a — Weapon try-out (tutorial arming)

**The magic moment:** the instant the host changes a player's weapon, MC pushes a private tutorial arming
to that player's gun so they can **shoot + reload to feel it** before committing — no full game, no
scoring, no announcement (it is *audible* — the point is to hear fire + reload).

- MC calls **M-MODES `tutorialFrames(weapon, environment)`** (environment from the current `GameConfig`,
  default indoor) and sends **`tutorial { weapon, frames }`** to that player's node (`contracts.md` §5).
  The node writes the frames verbatim; nothing is scored and no `start` is implied. State stays **KITTED**.
- **UX:** on the player card, weapon selection is **live** — tap a new weapon, a subtle "trying out on
  <name>'s gun" indicator appears; the player squeezes the trigger a few times, feels the fire rate + mag +
  reload, and either the host keeps it or taps another. The compiled frames carry **`$VOL,80` indoors / `$VOL,90` outdoors** (`compile.play_volume()`; the audible
  game value, `modes.md` §4) — never the diagnostic `30`.
- This flows **MC (compile) → M-NET → node (write) → gun**; MC never touches the gun over BLE (players may
  already be out of bench range — this is why it goes over the LAN via the node).

- **Try-out safety rule (interim, from modes.md §4):** once any node has reached **LOBBY** (config head written,
  `$SIR` table live on that gun) MC **disables further try-outs** for the session — a try-out shot may register on a
  configured-but-unspawned gun (bench-unverified). Re-enable only if the bench proves an unspawned gun ignores IR.

## 7. Phase 4 — Lobby

- **Team assignment finalized:** drag-and-drop team builder, auto-balance, lock teams before start.
  Board shows each team's roster + colors + numbers.
- **Per-player READY-UP:** each player readies on **their node**, which sends **`ready { player_id, ready }`**
  over M-NET (`contracts.md` §5) to flip `Player.ready` — a toggle while the node is **KITTED**. A node may
  only go ready when **`status.synced` is true** (clock fresh within `SYNC_FRESH_MS`, M-START §4) and its
  preflight is green; MC shows why a node can't ready. The host can override-ready a player (logged).
- **Push config on all-ready:** when every rostered player is ready (and the board has no reds), MC calls
  **M-MODES `compile(config, player)`** for each player and pushes **`config { config, frames, roster }`**
  (`contracts.md` §5) — the per-player **`FrameBundle`** (head / spawn / revive / end / panic / team_flip /
  cues). Nodes write **`frames.head`** (gun configured, **unspawned**), enter **LOBBY**, and return
  **`ack_config { ok, gun_echo }`**. MC **gates START on `ok:true` AND a non-empty `gun_echo` from every
  node** — the echo is the headset-present proof (§4; pre-push reds are the §4 list, headset is *not* one of them). A `player_num` / loadout / team change after the
  push **re-compiles and re-pushes that player's bundle** (and the roster to everyone); an un-acked node
  blocks start until it re-acks. This is the "push everything in range, then only `start`" decision (README §6).

## 8. Phase 5 — Dispersed timed start

MC **delegates the start choreography to M-START** — it does not implement the countdown. MC's job:

- Host taps **START**; MC **mints a `match_id`** (never reused — it stamps every event of this play,
  contracts A4.3), picks `go_live_t` (synced clock, `contracts.md` §7) a configurable runway ahead, and
  issues **`start { match_id, go_live_t, config_id, seq, countdown_s }`** to every node. Runway default
  **`DEFAULT_RUNWAY_S = 120`** — it is *walk time* on a park, not a drum-roll; presets 60 / 120 / 180 s.
- **MC MUST stamp a monotonic `seq`** (per session) on **every** `start`. `seq` is what a reschedule or an
  **`abort_start`** targets — a higher `seq` supersedes (contracts §9 "three `seq` namespaces"). **Rules (A5.6):** re-issuing the
  *same* schedule to a straggler = **same `seq`, same `match_id`** (a node that already holds it treats it as a
  no-op); a **reschedule** = **new `seq` + new `match_id`** (supersedes on every node that hears it).
- **Per-node "armed, T-minus" board with a coverage indicator:** each node counts down on its **own**
  clock and spawns its gun at T (README §5, M-START). MC shows per node: got-start → armed → T-minus →
  LIVE, **and whether the node is currently in range** (last heartbeat age). A node that never synced falls
  back to `now + duration` from receipt (degraded, flagged).
- **Abort reaches only nodes in range.** The Start screen says so in plain words and offers **Reschedule**
  (a new `go_live_t` further out, higher `seq`) as the **default** recovery — issued *before* the old T-0
  while most nodes are still near the base. Abort is the secondary action and lists which nodes it cannot
  reach. Late/early-join and power-cycle-after-dispersal re-sync are **M-START's** concern.
- **Late joiner mid-match** (A5.6): kit the player (`assign`), push their `config` (compile → `frames`, `ack_config`
  + echo), then re-push the **same `start`** (same `seq`/`match_id`); the node hot-joins per M-START E5/E11. The
  all-nodes-acked start gate does not apply to a joiner — the match is already running.

## 9. Phase 6 — Live board

A **Halo-style board** assembled from node **`hit_taken` / `death` / `respawn`** (persisted facts) and
**`status`** (live heartbeat + counters) over the LAN (M-NET). It is a projection of **eventually-consistent,
coverage-zone** data — never a real-time assumption (§1).

- **Rows** are `ScoreRow` (`contracts.md` §4): kills, deaths, assists, shots, hits, accuracy, K/D, streak,
  medals — **all MC-derived**. **Attribution is exact:** `death.shooter_num` → roster → killer;
  `hit_taken.shooter_num` → assists (`ASSIST_WINDOW_MS`) and hits. A `shooter_num` not in the roster (a
  station/grenade `$HIR`, or a gun from another game) is logged, not credited.
- **Team-kills** are **roster-based, never `$TID`-based** (A5.2): friendly ⇔ killer and victim share a non-null
  roster `team_id` **and `mode != "ffa"`** (FFA is one `$TID` for everyone — `$TID` equality would make every
  FFA kill a team-kill). Flagged on the row and in the feed (−1 by default, mode may override). **Infection:**
  ingest `team_change{player_id, tid}` facts and re-evaluate roster teams from them before scoring later kills.
- **Winner:** `mode == "ffa"` → top `ScoreRow`; team modes → team kills (or `scoring.win_by`).
- **Accuracy** = `hits` (count of *victims'* `hit_taken` whose `shooter_num` is me, **non-friendly targets only**)
  ÷ my latest `status.shots`. Both are counters MC already holds; there is no per-bullet event (A4.4). If a node's
  last `status` predates the match (phone died mid-game), accuracy shows **"—"**, never 0.
- **Time base (A4.7/A5.7):** a node that was synced at lobby keeps its own `t` for the whole match (drift ≪1 s).
  For a **never-synced** node MC uses `t_recv` for live `event`s, re-bases an `event_batch` once per flush
  (`offset = t_recv − t_newest`, order preserved), and **suppresses window awards** (multi-kill, first blood)
  derived from that node's facts.
- **End freeze (A6.1):** MC records `end_t` at `control{end}` (or the timed end); facts after it are parked
  `post_end` and never scored — the winner shown at the end is final. **Hot-swap (A6.2):** accuracy uses
  `shots_total` (baseline + the new phone's counter).
- **`match_id` parking (A4.3):** events whose `match_id` is not the current match are **parked** (stored,
  visible in that match's recap, never scored into this one). This is what makes a phone that flushes
  last match's deaths during this match harmless.
- **Staleness:** dedup by `(node_id, seq)`; a missing node is **stale, not gone** — last-known values +
  age (grey after `STALE_AFTER_MS`). Late `event_batch` flushes reconcile silently.
- **Feedback loop:** when MC scores a kill/multi/medal it sends **`feedback { player_id, kind, t, cue? }`** to the
  **killer's** node (it knows exactly who — A4.1) so it greens the sight + plays the cue — **only if the
  death is fresher than `FEEDBACK_MAX_AGE_MS`** (no flash minutes later for a late flush), and only if that
  node is in range. In a large park this fires in **coverage zones**; that is expected.
- **Host controls:** `control { cmd: end|panic|abort_start|recall }` (`contracts.md` §5). One meaning each
  (A5.9): **`abort_start`** cancels a *pending* start (by `seq`) while a node is ARMED — a node that is already
  LIVE for that `seq` treats it as `recall`; **`recall`** stops a *live/armed* game; **`end`** is the normal
  early end; **`panic`** relays the safe sequence (node writes `frames.panic`). Every one of them lands the node
  in **KITTED** (gun + player retained) — a **rematch is just a new `config` push** → LOBBY → `start`. There is
  **no `pause`** (A4.6). **Frag-limit / survival / objective ends:** MC decides the winner when the event log says
  so and broadcasts `end` **best-effort** — nodes in range stop; nodes out of range **keep playing until
  `go_live_t + time_limit_s`**, which is the end that reaches everyone. Say this on screen ("early end sent
  to 5/8 nodes; the rest end at 12:00").
- **TV mode:** a full-screen board for a spectator display.

## 10. Phase 7 — Recap

When players return in range, MC **reconciles final events and computes end state**:

- **Ingest late flushes and parked events:** `event_batch`es land as nodes reconnect; parked foreign-match
  events are routed to their own match's record. Recap is explicitly allowed to **complete late** and shows
  "waiting for N nodes" until every rostered node has flushed (or the host finalizes with last-known).
- **Ingest node logs:** a node offers `log_offer`; MC requests **`pull_log`** and folds the chunked
  **`log_data`** into the SQLite log so dropped events and BLE-resync respawns (node.md §3.10) are visible.
- **Recap is provisional until every rostered node has flushed** (A5.11): kills exist only in *victims'* reports,
  so an absent victim silently under-counts *other* players' kills. Show **"N victims missing — kills
  provisional"** and mark the export provisional until the host finalizes.
- **Compute end state** from the reconciled event log: **winner** (FFA → top `ScoreRow`; team modes →
  `scoring.win_by` or team kills at time-expiry), **most kills**, **best K/D**, **accuracy leader**, and **medals** — all **per player** now
  (M-MODES `medalCatalog()` + `awardMedals(rows, kills)`; MVP / Top Gun / Sharp Shooter / Survivalist / First
  Blood / multi-kills / Assistant).
- **Export:** match summary + per-player `ScoreRow`s + kill feed to a file (JSON/CSV) under `~/.brx-mcp/`;
  optional at-home sync is out of scope for the field (ADR-0002 — the field is an island).

## 11. Interfaces MC consumes (by contract, not internals)

MC binds only to these published surfaces; a gap becomes a `contracts.md` **amendment** (README §5), never
a reach-in.

| Module | MC consumes | For |
|---|---|---|
| **M-ARMORY** | `list()` / `enroll()` / `rename()` armory CRUD; **`scan() → ScanRow[]`** (presence + identity + RSSI); `bind_player()` validation; bench panic | phases 0-1 |
| **M-MODES** (in-process) | mode catalog + `GameConfig` builder/defaults/**`validate()`**; `WeaponCatalog`; **`compile(config, player) → FrameBundle`**; **`tutorialFrames(weapon, environment)`**; `cues`; `medalCatalog()` + **`awardMedals()`** | phases 2, 3, 3a, 4, 7 |
| **M-NET** | `NetServer`: mDNS/QR advertise, node WS, heartbeat + **`status`** intake, store-and-forward intake with **`t_recv`**, clock-sync; **`hydrate(hello) → welcome.node`** hook MC answers on every `hello` — resolved **by `hello.gun` (sticker/tail → the player bound to that gun) first, `node_id` second** (A5.5), returning player/team/roster/config/frames/start/match_id/**score**; `hello`/`bind`/`event`/`event_batch`/`status`/`ack_config`/`ready`/`log_offer`/`log_data` in; `welcome`/`assign`/`config`/`tutorial`/`start`/`feedback`/`control`/`pull_log`/`ack` out | phases 1-7 |
| **M-START** | `start { match_id, go_live_t, config_id, seq, countdown_s }` (MC mints `match_id`, stamps `seq`; **same-`seq` re-push vs new-`seq`+new-`match_id` reschedule**, A5.6) + per-node armed/T-minus/coverage state; `abort_start(seq)` | phase 5 |
| **M-CONTRACTS** | every data shape: `ArmoryRecord`, `Player` (+`player_num`), `Team`, `Loadout`, `RosterEntry`, `GameConfig`, `FrameBundle`, `Weapon`, `Event`, `Kill`/`Assist`/`ScoreRow`, envelope, constants | all |

MC **produces**: the roster/match state (incl. `player_num`s and `match_id`s), the compiled bundles (via
M-MODES), the derived scoreboard (`ScoreRow`), the recap + export, and the operator UI itself. It **owns**
none of the schemas.

## 12. Screen map (the app)

| Screen | Phase | Core content |
|---|---|---|
| **Network** | any | LAN mode, MC address (big) + QR, connected-node list + heartbeat, operator preflight checklist |
| **Readiness** | 1 | **node-reported** red/amber/green cards (headset/screen amber pre-push, A5.4) + unclaimed-gun list from `scan()`; push-gate |
| **Build Game** | 2 | mode grid + global settings panel (`GameConfig`; time limit required) |
| **Kit Players** | 3/3a | player cards incl. **player number**; weapon gallery; live try-out |
| **Lobby** | 4 | team builder, ready column (sync-gated), bundle push + `ack_config`/`gun_echo` ticks |
| **Start** | 5 | START + per-node armed/T-minus/**coverage** board; Reschedule (primary) / Abort |
| **Live** | 6 | Halo-style board, exact K/D/A, team-kill marks, staleness, host controls, TV mode |
| **Recap** | 7 | winner/leaders/medals, **provisional until all nodes flushed**, late-flush + parked ingest, log ingest, export |

## 13. Task breakdown

1. **Python server skeleton** — HTTP static + JSON API; serve the web UI; state store + SQLite event log
   (`t`, `t_recv`, `match_id`, parked flag) under `~/.brx-mcp/`.
2. **Wrap M-ARMORY** — `scan()` render + unclaimed list; enroll/rename delegated (mock until M-ARMORY lands).
3. **M-NET server integration** — mDNS/QR advertise, node WS intake, `status` intake → readiness board,
   store-and-forward ingest with `t_recv`, clock-sync serving, **`hydrate()` hook** answering `welcome.node`.
4. **Readiness board** — node-reported rollup (§4, contracts §4 shapes) + operator checklist; the A5.4 red/amber
   rules (no headset deadlock).
5. **Build-game UI** — mode grid + global settings bound to `GameConfig` (M-MODES catalog/defaults/validate;
   time limit required; coverage-only badge on frag/survival).
6. **Kit-players UI** — player cards with **`player_num` auto-assign + edit**; **weapon gallery** from
   `WeaponCatalog`; team/voice/overrides; `assign` re-send on change.
7. **Tutorial try-out** — weapon change → `tutorialFrames()` → `tutorial{weapon, frames}` push; the
   "trying out" UX.
8. **Lobby** — team builder + sync-gated ready column; **`compile()` per player → `config{config, frames,
   roster}` push**; `ack_config` + `gun_echo` gate; re-compile/re-push on late edits.
9. **Start** — mint `match_id`; delegate to M-START; per-node armed/T-minus/**coverage** board; Reschedule
   primary (new `seq`+`match_id`), Abort secondary with reach warning; same-`seq` re-push; **late-joiner flow**
   (assign → config → same `start`).
10. **Scoring engine** — ingest facts → exact `Kill`/`Assist`/`ScoreRow` per `contracts.md` §4 + constants;
    roster `shooter_num` map (0 = no killer); **roster-based friendly rule (never in FFA)**; `team_change`
    ingest; accuracy from counters (non-friendly hits; "—" on stale `status`); A5.7 time base + award
    suppression; **`match_id` parking**; staleness; fresh-only `feedback{…, t}` to the killer's node.
11. **Live board + host controls** — Halo-style board, TV mode, end/panic/abort_start/recall (no pause);
    "early end reached N/M nodes" copy.
12. **Recap** — late-flush + parked reconciliation, **provisional flag until all nodes flushed**, `log_data`
    ingest, per-player medals via `awardMedals()`, FFA/team winner, export. **Rematch** = new `config` push to
    the KITTED nodes.
13. **Network chooser** — router-join vs Mac-hotspot with the macOS-AP-weak warning + manual-IP/QR display.

Each ships with **mocks** for its dependencies (README §5 rule 3) so MC builds before M-ARMORY/M-MODES/
M-NET are live.

## 14. Open questions

- **`feedback` fan-out cost.** How aggressively should MC push `feedback` (every kill? only medals?) given
  best-effort delivery and node audio load. Default: kills + medals, coalesced, fresh-only.
- **Coverage-zone planning UI.** Should MC help the host *plan* coverage — mark which base/respawn point is
  in router range (from node heartbeats seen during setup walks) and warn when a respawn point is out of
  range? Cheap and directly improves how often K/A/ACC catch up mid-match (README §3).
- **Host-side mid-match interventions** (powerups / extra-life / loadout-swap).
  MC is not gun-connected mid-match — any intervention must ride `control`/`assign` **via the node** and only
  reaches nodes in range. Confirm which interventions are in scope for M-MC vs deferred.
- **Multi-operator / handoff.** One host today; is a second read-only board (another laptop/phone on the
  LAN) wanted for a co-host? Out of scope unless requested.
- **Node → player binding trust.** How MC confirms a node actually holds the gun it claims (`bind.gun_name`/
  `gun_tail`, from the advert name) before pushing config — reconcile against `scan()` presence + the armory map;
  the `gun_echo` closes it.
- **[HW-CONFIRM] Does an unspawned head echo with the headset off?** If yes, `gun_echo` after the lobby push is
  *not* a headset proof and the gate must move to the T-0 `$SPAWN` echo (`status.preflight.headset_ok` from the
  node at spawn). Bench item; until then the push-echo is the gate and this is flagged unverified (§4).

---

*Credit **LaserTagMods (JEDGE/JBOX)** and **Jay Burden** for the protocol/IR discovery MC's armory and
scoring stand on, in any public-facing surface (README §7).*
