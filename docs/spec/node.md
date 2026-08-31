# M-NODE — the phone node: per-gun engine + video-game HUD

- **Status:** Draft (Wave 2), updated to contracts **A4–A6**. Binds to the frozen backbone:
  [`README.md`](README.md) §2/§3/§7, [`contracts.md`](contracts.md) §3 (`FrameBundle`), §4 (events),
  §5 (protocol), §6 (lifecycle), §7 (clock).
- **Owner interface (from README §4):** *the node app; consumes `Transport` (M-NET) + the per-player
  `FrameBundle` (compiled by M-MODES inside MC, delivered over the wire).* **Depends on:** M-CONTRACTS,
  M-NET. The node **never calls a frame compiler** — it writes bundle frames verbatim (contracts A4.2).
- **Seed:** the current single-gun app — [`app/src/app.js`](../../app/src/app.js) +
  [`app/www/index.html`](../../app/www/index.html). This spec **evolves that code**; it does not
  rewrite it. Where a mechanism already exists and works, we say *keep it* and point at it.
- **Later target:** the same engine runs on the ESP32 Companion (ADR-0001). Keep the engine a pure
  state machine over BRX frames + Transport messages + a `FrameBundle`, so it ports without the DOM
  and without a compiler — a Companion is the same verbatim frame writer in C++.

> **Invariants this module must never break (README §2, ADR-0001):** a node owns **exactly one gun**
> and its own-gun loop (arm → damage → death → respawn → local feedback → timed end) **runs with the
> LAN dead.** The gun is **host-blind about its own kills** — the node never tries to detect its own
> kills. But every hit it *takes* names the shooter: `$HIR` token 3 = shooter `player_num`, token 4 =
> shooter team (protocol §7q). The node latches **both** and reports them; MC does the crediting.

---

## 1. Scope & non-scope

**In scope:** the per-gun game engine (§3), the HUD (§4), field diagnostics + preflight (§5),
on-device log capture + export (§6), the BLE plumbing carried over from the seed app (§7).
Cross-platform notes (§8), tasks + open questions (§9/§10).

**Explicitly NOT this module:** cross-player scoring (kills/assists/accuracy — MC derives them,
contracts §4), the LAN transport itself (M-NET owns the `Transport` class, envelopes and the platform
network gates, net.md §8), frame compilation (M-MODES, in MC — the node receives a `FrameBundle`),
the dispersed-start scheduler (M-START owns `startAt`; the node executes the countdown it is handed).
This module *consumes* all four.

---

## 2. Shape of the thing

Two layers, one process:

```
   ┌─────────────────────────── M-NODE (one phone, one gun) ────────────────────────────┐
   │  HUD (§4)  ◄── state ──  Engine (§3)  ── frames ──►  BLE plumbing (§7)  ──► the gun  │
   │   glare/blackout          pure state machine          init-once, retry,             │
   │   diagnostics (§5)        writes FrameBundle verbatim  reassembler, 20B chunk        │
   │        ▲                  emits Event (§4 contracts)                                 │
   │        │                       │  ▲                                                  │
   │        │                       ▼  │  consumes assign/config(bundle)/tutorial/start/feedback/control │
   │   log capture (§6) ◄──────  Transport (M-NET client) ◄──── field LAN ──── MC         │
   └────────────────────────────────────────────────────────────────────────────────────┘
```

- **Engine** is the seed's `me` object + `handleFrame`/`death`/respawn loop, promoted to a real state
  machine over contracts §6. It knows nothing about the DOM or the socket directly — it **emits
  Events**, **accepts commands**, and **writes the frames it was given**. This is what ports to the
  Companion.
- **HUD** is a pure function of engine state (§4.4). It never writes frames.
- **Transport** is injected (M-NET). With no Transport, the node still runs from its persisted
  bundle — it just can't report or receive MC feedback. The seed already proves the loop: it plays a
  whole local game with no server.

---

## 3. The per-gun engine

### 3.1 Arming from a pushed config + FrameBundle

The seed hard-codes a TDM `SETUP` array and `spawnFrames(team)`. **Replace that with the wire.** Kit-out
(`assign{player, team, roster}`, contracts §5) sets player + team → KITTED. The **lobby
`config{config, frames, roster}` push** → LOBBY carries the arming material. On `config` the node:

1. stores `player`, `team`, `roster`, `config`, `frames` (the `FrameBundle`, contracts §3) —
   persisted (§3.7) — and takes `config.health.max_hp`/`max_armor` as the HUD bar caps (replacing the
   hard-coded `MAX_HP=45`/`MAX_AR=70`);
2. writes **`frames.head` verbatim** over BLE (§7) — the config head, **no `$SPAWN`**, no countdown
   sound; the gun sits configured-but-unspawned until M-START's T-0;
3. **captures the gun's echo**: a configured gun answers the head with `$LCD,…`/`$ALCD,…` lines
   (protocol §7e). The node waits ~1.5 s for them. **What the echo proves:** the gun *answered* and holds
   the config. It does **not** report state — after `$CLEAR` the head echo is `$LCD,0,0,0,0,0,0` on a
   healthy gun (bench 2026-08-25), not HP. **Silence = the gun did not answer** (headset off / asleep /
   unconfigured) — **red after the push** per contracts §4 Readiness. ⚠ Whether an unspawned head echoes
   *at all* with the headset off is **UNVERIFIED** (Q11); the hardware-proven headset detector is the
   `$LCD,45,70,…` echo on **`$SPAWN`** (B18b). Before the push, headset is amber, never red (A5.4);
4. replies `ack_config{config_id, ok, err?, gun_echo}` — `gun_echo` is the first `$LCD`/`$ALCD` line
   verbatim; no echo → `ok:false, err:"no_echo"`; a BLE write failure → `ok:false` + the error. MC's board
   reflects it.

**Pre-config probe set (contracts §3, A5.4).** Before any bundle exists — in **CONNECTED/KITTED only,
never after a head is written** — the node sends `$PHONE,*` once (starts the ~30 s `$VOLTS` telemetry so
battery exists at muster) and runs the `$STOP,*` → `$PHONE,*` → `$VERSION,*` ritual once (firmware →
`hello.gun.fw` / `status.fw`). These are the *only* frames the node sends before it holds a bundle.

The node **owns exactly two literal frame templates** and nothing else (contracts §3/§8, A6.3):
`$SFLASH,*` and `$PLAYX,0,*` — plus the pre-config probe set above. `frames.cues` values are **pre-composed
`$PLAY` frames** (the compiler decides slot placement); the node writes them verbatim like any bundle frame. Everything else —
`head`, `spawn`, `revive`, `end`, `panic`, `team_flip` from the bundle, and the `tutorial{frames}`
*message* (not a bundle field) — is written verbatim. Volume is MC's concern: the head carries `$VOL,69,…` (house rule — 30 is inaudible); the node
merely **checks it is present** and logs a warning if not. It never rewrites a frame.

`config.respawn.delay_s` replaces the manual `#respawn` input; `config.time_limit_s` drives the HUD
match clock and the local timed end (§3.9). `night` selects blackout defaults (§4.3).

### 3.2 Tracking hp / armor / ammo / shooter

> ⚠ **Two pools tracked, three on the wire (2026-08-26).** `$HP` carries `<hp>,<armor>,<shield>` and
> damage drains **shields → armor → HP**, but the engine, the `status` event and the HUD all model
> only hp+armor. Nothing is wrong today because shields cannot be granted over BLE at all — the pool
> fills **only** from an IR `$SIR` function-11 event (P16) — but that is now something we can build.
> The consequences and the decision are **§10-Q12**; this section is unchanged until it is settled.

Keep the seed's frame handlers (`handleFrame`), which already work on hardware:

| frame | tokens read | engine effect |
|---|---|---|
| `$HP,<hp>,<armor>,<shield>,*` | hp, armor, **(shield — not read, see §10-Q12)** | set `hp`, `armor`; **if `hp==0 && alive && running` → death() (§3.4)** |
| `$LCD,...` | hp, armor, ammo (tok 5) | set `hp`, `armor`, `ammo` — the periodic full-state line; also the **config/spawn echo** (§3.1, §3.10) |
| `$ALCD,<ammo>,...` | ammo (tok 1) | set `ammo`; **a decrement within a magazine = a shot → `shots++`** (§3.3); an increase = reload/pickup, ignored |
| `$HIR,<ir_proto>,<t2>,<shooter_num>,<shooter_team>,...` | tok 3 = shooter `player_num`, tok 4 = shooter team; **guard tok 2 ≠ `15`** (grenade/station beacon, not a hit) | latch `{shooter_num, shooter_team, at}` (§3.5). **Tok 1 is the SENSOR that caught the IR** — `0` headset FRONT dome, `1` headset BACK dome, `4` gun body (§7r; the old "`4` = armor absorbed / `0` = HP / `2` = kill" reading is **RETRACTED**, and a kill is never marked in `$HIR`). Directional logic only holds at field distance — at point-blank the IR floods every receiver. **Tok 5 is the RAW magnitude, not the damage applied**: applied = magnitude × the victim's `$SIR`-function multiplier × (1 + `$GSET` t7/100) if crit — ×1.5 only at our shipped t7=50 (§7r addendum), so never use tok 5 as a damage source — derive from the `$HP` delta. Log tok 1 and carry it as `ir_proto` on `hit_taken` |
| `$VOLTS,...` | pack % (**provisional** token — token 3 vs 4 unresolved, §10-Q4) | set `battery` (§4 batt, §5) |

Ammo is **observed**, never asserted — the gun is the source of truth for its own magazine. The node
does **not** simulate reloads; it reflects `$ALCD`/`$LCD`.

### 3.3 Emitting Events (contracts §4, A4)

The engine emits **only node-observable facts**, handed to Transport. Two classes:

**Persisted facts** (queued in the ring if the LAN is down — §3.7; carry `Envelope.seq` + `match_id`):
- **`hit_taken`** — on a `$HIR` (tok 2 ≠ 15) that drops `$HP`: `{shooter_num, shooter_team, dmg,
  ir_proto?}` (dmg = the hp+armor delta the hit caused).
- **`death`** — on `$HP→0` (§3.4): `{shooter_num, shooter_team, desync?}` from the latch (§3.5) —
  `shooter_num: 0` when the latch is older than `DEATH_LATCH_MS` (environmental / unknown) or when the
  death was inferred by the §3.10 resync (`desync: true`).
- **`respawn`** — on local respawn (§3.4); `resync: true` when forced by §3.10.
- **`team_change`** — `{tid}` when this gun moved to another team mid-match (infection, §3.4).
`shooter_num` **0 is reserved** (contracts A5.1): never a player — a tutorial-armed gun, a stale latch, a
desync. Players are 1–63.

Every persisted event carries **`match_id`** (from `start`, contracts A4.3). **Before a `start` is
known the node emits no persisted events** — hits taken in a tutorial or a pre-start lobby are not match
facts. `t = synced_now()` (contracts §7). Idempotent by `(node_id, seq)`.

**Live-only** (never queued, never persisted, **no `seq`**; sent only while connected):
- **`status`** — every `STATUS_HEARTBEAT_MS` (2000): `{match_id?, hp, armor, ammo, alive, shots,
  deadline_s?, battery, fw?, arm_state, t_minus_ms?, synced, dropped?, preflight}`. `match_id` once armed;
  `fw` from the probe set (§3.1); `arm_state ∈ idle|connected|kitted|lobby|armed|live` (the §3.8 game
  phase — **orthogonal** to link state); `t_minus_ms` only while ARMED; `synced` = clock-sync is fresh
  (§7); `deadline_s` = seconds left on the respawn timer when DOWN; `dropped` = ring-overflow count since
  last status; `preflight` = `{ssid_ok, mc_reachable, auto_join_ok, cellular_off, dnd_on, phone_batt,
  screen_on, foreground, gun_linked, headset_ok}` (§5).

**The `shots` counter rule** (replaces the removed per-bullet `shot` event, A4.4): `$ALCD` token 1 is
the magazine count. A **decrement** (within one magazine, i.e. `new < prev`) adds `prev − new` to
`shots`; an **increase** (reload, pickup, respawn refill) is ignored and just resets `prev`. `shots`
resets to 0 at `startAt()` and rides `status`; MC diffs it. Hardware note: `$ALCD` was seen counting
36→0 shot-by-shot in every live run (exp-log 2026-08-25), so the counter is exact for automatic fire.

### 3.4 Own-death detection + local respawn

Keep the seed's model exactly — it is already correct:

- **death():** `$HP→0` while alive+running → `alive=false`, `deaths++`, `deadAt=synced_now()`, read the
  §3.5 latch **only if it is fresher than `DEATH_LATCH_MS` (2 s)** — the killing `$HIR` arrives in the
  same millisecond as `$HP,0` (§7q), so an older latch means the death had another cause (station, host
  `$BHIT`, unknown) → `shooter_num: 0`. Emit `death`, HUD flips to DOWN (§4.4). The killed-by line
  resolves `shooter_num` through `roster` to a **display name** ("☠ by REAPER · YELLOW"); 0 or an unknown
  number falls back to the team or "☠ DOWN". **No frame is written to the gun on death** — the firmware
  handles its own down-state; the node only *observes* it. (A dead gun cannot fire — protocol §7q — so
  the HUD's DOWN state is also physically true.)
- **Infection (`config.mode == "infection"`):** a killed human, on death, writes
  `frames.team_flip[<infected tid>]` verbatim, emits **`team_change{tid}`**, flips its own HUD identity
  chip to the infected team, then runs the normal respawn timer → `frames.revive`. Node-local; works
  offline. ⚠ Whether a mid-match `$TID` write changes the gun's **friendly-fire resolution** is
  **UNTESTED** (Q9) — until then infected-vs-human damage may not register.
- **respawn:** the 500 ms tick. When `respawn.type=="auto"` and `now - deadAt ≥ delay_s`, write
  **`frames.revive`** verbatim (`$SPAWN,,` + loadout-correct `$AMMO` — respawn restores ammo implicitly,
  §7f, but the bundle may refill explicitly), set `alive=true`, refill HUD caps, emit `respawn`. For
  `type:"scanner"`/`"none"` the node does **not** auto-revive — it waits for the gun's own respawn
  signal / stays down (surface a "find a respawn point" HUD hint; Q2). Respawn math uses **synced time**
  so a mid-match reconnect doesn't warp the countdown.

### 3.5 Shooter identity from `$HIR`

`$HIR` token 3 = shooter **`player_num`**, token 4 = shooter **team** — both always present, both
hardware-verified in both directions (protocol §7q). Latch `{shooter_num, shooter_team, at}` on every
valid `$HIR` (tok 2 ≠ 15); at death read the latch iff `now − at ≤ DEATH_LATCH_MS`, else report
`shooter_num: 0`. Attribution is **exact**; there is no team-only
fallback and no heuristic. The node still **never computes its own kills** — a kill you score is
invisible in your own stream; only the *victim* reports it (§3.6). The `roster` (contracts §2
`RosterEntry[]`) turns a number into a name for the HUD; an unknown number is still reported verbatim.

### 3.6 Kill feedback is MC-driven — do NOT detect own-kills

**Hard boundary (ADR-0001).** In a BLE-armed game the gun does **not** self-fire the green sight; it
emits **no shooter-side kill event** (exp-log D4). The node therefore **cannot and must not** try to
detect that *it* killed someone. Instead it exposes a **`feedback()` hook** that MC calls — and since
A4 MC knows *exactly* who the killer is (victim's `shooter_num`), `feedback{player_id, kind, t, cue?}` is
targeted, never guessed (contracts §5):

```
feedback(kind):  $SFLASH,*   → sleep 120ms → write cues[kind] verbatim (a pre-composed $PLAY frame, A6.3)
```

This is the seed's `feedback()` — keep it; the ids come from `frames.cues` (or the message's `cue`).
`VAA`/`V3A` both played on hardware from our stack (`mcp/play_probe.py`, G3; protocol §7o). The hook is
**best-effort**: no local game logic ever depends on receiving it. The node **ignores a `feedback` whose
`t` is older than `FEEDBACK_MAX_AGE_MS`** (contracts §9) so a late flush never flashes a sight minutes
after the kill.

**Field reality (README §3 coverage honesty, A4.8):** on a large park the victim's report and MC's
`feedback` both need the LAN, so the green sight and live K/A/ACC fire only in **coverage zones** — a
base or respawn point inside router range — and at recap. That is the designed behaviour on the phone
path, not a fault; field-wide instant feedback is the Companion mesh (M6). The HUD's K/A/ACC stay
**"— MC"** (§4.4) until MC pushes them; the node never computes them.

### 3.7 Autonomy — the whole loop runs with the LAN down

This is the headline requirement (README §2/§7). Concretely, with **no Transport connected**:

- arming still works: the node **persists its whole context** — `player`, `team`, `roster`, `config`,
  the `FrameBundle`, the pending `start` (`match_id`, `go_live_t`, `seq`, `countdown_s`) and its clock
  offset — so a power-cycled phone rejoins the same game without MC in range (M-START E1);
- damage/death/respawn/battery/timed-end all run off BLE frames + synced time alone;
- persisted events **queue** in a bounded persisted ring (contracts §5) and flush as `event_batch` on
  reconnect; the Transport consumes MC's **`ack{seq_hi}`** to prune the ring;
- on any (re)connect the node sends `hello{…, gun: {name, tail, fw?}, seq_next}` and MC's **`welcome`
  re-hydrates everything** (`node: {player, team, roster, config, frames, start?, match_id?, score?}` +
  `seq_hi`, contracts A4.5/A5.5). **Hydration is resolved by the gun**: `gun.name` is the full advert
  name (`<sticker>-<tail>`) and `tail` is parsed from it — **never from the platform `deviceId`** (iOS
  gives a UUID, not a MAC). So a **hot-swapped** phone with a brand-new `node_id` is hydrated on its very
  first `hello`, before `bind`; `score?` seeds its HUD D/K/A so the row doesn't restart at 0. The node
  adopts `next_seq = max(own, seq_hi+1)` — a reinstalled app can't have its events silently dropped by
  dedup. After hydrating, the node **re-sends `ack_config`/`ready`** if its own state says they were sent
  but MC's returned context doesn't reflect them (net.md §6);
- only two things degrade: MC `feedback` (no sight flash) and cross-player HUD stats (stay "— MC").

The node **never blocks** on the LAN. Start uses the pre-shared `go_live_t`, end uses
`go_live_t + time_limit_s` (contracts §7 / M-START), so neither T-0 nor T-end needs a signal.

### 3.8 Lifecycle (contracts §6) → engine states

```
IDLE ─setGun─► CONNECTED ─assign─► KITTED ─[ready-up; all-ready → config(bundle)]─► LOBBY ─start(seq,go_live_t)─► ARMED(countdown)
                                      ▲                                                                                │
                                      └──── end / recall / panic / local time-expiry ◄──── LIVE{ALIVE ⇄ DOWN} ◄──── T = go_live_t ────┘
```

The seed collapses this to IDLE/READY/ALIVE/DOWN; **promote it** to the full set so the HUD and MC
agree on one vocabulary. **IDLE = no gun; CONNECTED = gun, no player; KITTED = gun + player, no game on
the gun.** A finished, recalled or panicked match returns to **KITTED** (contracts A5.9) — the player is
still kitted; a rematch is a new `config` push → LOBBY. `DISCONNECTED` (WS) is orthogonal, and so is the
BLE link (§3.10) — a node can lose either in any phase and keep running; it returns to the prior state,
it is **not** a game transition. Control meanings (contracts §5, A5.9 — `pause` no longer exists):
- `control{cmd:"recall"}` **stops a LIVE (or ARMED) game** → write `frames.end` (+ `cues.game_over`) → KITTED;
- `control{cmd:"end"}` is the normal match end (same teardown) → KITTED;
- `control{cmd:"panic"}` → write `frames.panic` (`$CLEAR,*` then `$SP,99,*`) → KITTED;
- `control{cmd:"abort_start", seq}` cancels a *pending* countdown (by `seq`) while ARMED → LOBBY (the
  gun still holds `head`, nothing to undo). If the node is **already LIVE** for that `seq` it behaves as
  `recall` (end frames, no panic) → KITTED;
- `end`/`recall` received in KITTED/LOBBY: write `frames.end` iff a bundle is held (LOBBY), → KITTED.
LIVE also ends with **no MC command at all** on local time-expiry (§3.9).

### 3.9 Local time-expiry match end (the timed end, symmetric to the timed start)

Just as the dispersed **start** fires off a pre-shared `go_live_t` with no T-0 signal (§3.7, M-START),
the dispersed **end** must fire off a pre-shared duration with no `end`/`recall` from MC — on a large
park it is the **only** end condition that reaches a node (README §6; `time_limit_s` is required).
**M-NODE owns this.** ⚠ **Bench-untested:** the end frames are hardware-confirmed, but the *composed*
time-expiry-end flow has not been run on hardware (exp-log 2026-08-25: "time-limit end not yet
exercised") — treat as a pending bench test, not a proven path. While LIVE, the engine holds
`go_live_t` and `config.time_limit_s`; when

```
synced_now() ≥ go_live_t + time_limit_s * 1000   (contracts §7 synced time)
```

the node ends **its own** match locally: write **`frames.end`** verbatim (the game-over teardown), then
play **`cues.game_over`** if present (the `$PLAY` template — Callsign ends with `VSF`+`JAY`; `frames.end`'s
own `$SPAWN` voice is already muted by its `$PLAYX,0`), stop the loop, LIVE→**KITTED** — exactly the
teardown a `recall`/`end` would have driven, just self-triggered. An `end`/`recall` that *does* arrive
earlier still ends the game; whichever comes first wins (idempotent teardown). Expiry math uses **synced
time** so a mid-match reconnect/clock-resync can't warp the deadline; a never-synced node falls back to
the degraded `received-start + duration` count (§7). Frag-limit / survival ends are MC-broadcast `end`s
and only reach nodes in coverage. `time_limit_s == null` (legal only for a fully-covered venue,
contracts §3) means **no local expiry** — the match ends only by `end`/`recall`.

### 3.10 BLE resync after a drop — positive evidence only (A6.6)

The node's whole loop keys off frames it *observes*. After a BLE drop it **cannot tell a radio blip from
a gun power-cycle**, and it may have **missed `$HP,0,0,0`** (player is dead, HUD says ALIVE) or the gun
may have **lost its config** (power-cycled: boots to idle). The lab hit this class once already
(`resetup` respawning regardless of engine state — exp-log 2026-08-25 "live-path resilience").

**Why the obvious fixes are wrong.** (1) Re-writing `head` + `spawn` on every reconnect: the head starts
with `$CLEAR`, so its echo is `$LCD,0,0,0,0,0,0` on a healthy gun (bench 2026-08-25) — it **cannot** reveal a
missed death — and the `$SPAWN` that follows is a **full heal + refill**: toggle Bluetooth to heal, and a
death inside the gap is erased. (2) Reading `$BUT,0,1`-without-`$ALCD` as "dead": an **empty magazine**
dry-fires the same way (protocol §7a), and so does an **unconfigured** gun (pre-game the trigger emits
`$BUT` but does not fire). (3) Reading silence as "unconfigured": a quiet live gun would get a free heal.
So the node **writes nothing first**, and **no branch below writes `spawn` without positive evidence**.

**The evidence protocol (`RESYNC_PROBE_S = 10` per step, contracts §9) — trigger first, then reload.**
On BLE reconnect in **ARMED/LIVE** (and on app resume after a suspension, §3.11) the HUD shows
**"GUN RELINKED — pull the trigger"** and the node classifies from what it *sees*. Trigger-first matters:
a reload on an already-full magazine emits nothing, so reload-first could misread a live gun as
unconfigured — and trigger-first is what players do anyway.

| step | observation | conclusion | action |
|---|---|---|---|
| any time | an `$HP` / `$LCD` line arrives (a hit, a periodic state line) | trust it verbatim | update hp/armor/ammo/alive. `$HP,0` while the engine thought alive → DOWN + `death{desync:true}` **credited to the latched `$HIR` if it is within `DEATH_LATCH_MS`, else `shooter_num:0`** |
| 1 · trigger | `$ALCD` decrement (a shot went out) | **alive** and configured | nothing; HUD back to ALIVE |
| 1 · trigger | `$BUT,0,1` with **no** `$ALCD` | ambiguous: dead / empty mag / unconfigured | HUD "now pull the RELOAD handle" → step 2 |
| 2 · reload (`$BUT,2`) | `$ALCD` refill | configured, mag was empty | HUD "pull the trigger" → step 3 |
| 2 · reload | no `$ALCD`, last-known reserve > 0 | **not a live configured gun**: unconfigured (power-cycled) *or* dead-and-reload-inert (unknown, bench) — both cost a life | non-LMS: emit `death{desync:true, shooter_num: latched-if-fresh else 0}`, re-write `frames.head`, normal respawn timer, `frames.revive`, emit `respawn{resync:true}`. **LMS: mark dead, write NOTHING** (a wrong write is elimination; the host can `recall`) |
| 2 · reload | no `$ALCD`, last-known reserve == 0 | ambiguous: out of ammo *or* the above | wait one more `RESYNC_PROBE_S` for any `$HP`/`$LCD`; if still nothing, **escalate** to the row above (a wrongly-judged out-of-ammo player loses a life instead of standing inert forever). LMS: stay last-known |
| 3 · trigger | `$ALCD` decrement | **alive** (was just out of ammo) | HUD ALIVE |
| 3 · trigger | `$BUT,0,1` with **no** `$ALCD` (after a good reload) | **dead** (a dead gun can't fire — §7q) | HUD DOWN, `death{desync:true, shooter_num: latched-if-fresh else 0}`, respawn timer from now → `frames.revive` as normal (LMS: dead, no revive) |
| 1–3 | nothing within `RESYNC_PROBE_S` | player didn't do it | keep the prompt up; **stay in last-known state**; never write |

Rules that fall out: **no branch writes `spawn`/`head` on silence**, and in **LMS no branch writes at
all** unless the gun is provably dead. A desync death is flagged (`desync:true`) so MC's recap can show
"N deaths uncredited/desync" rather than silently undercounting the killer. The prompt costs the player a
trigger pull (and sometimes a reload); that is the price of never guessing. Every resync action is logged
(`resync_*`). **Known limitation:** a station revive (`respawn.type:"scanner"`) that happened *inside*
the gap hides the death that preceded it.

**Bench result 2026-08-25 (protocol §7r) — there is NO side-effect-free probe; the table above stands.** On a
fresh link a dead gun emits nothing unprompted and `$PHONE` reads nothing back (`$VERSION` still answers, so the
link is fine). Dead trigger → `$BUT,0,1/0` only; dead reload handle → `$BUT,2,1/0` only (no refill). Config
**survives a BLE drop** (a `$SPAWN` on the fresh link revived with `$LCD,45,70,…`) and is **wiped by a
power-cycle**. Two positive tells the engine must use: (a) headset off/unlinked = the gun will not hold a link at
all (`$DISCONNECT`, then drops within seconds) — that is a link problem, not a resync case; (b) **after any
`head`/`spawn` write, a `$SPAWN` echo of `$LCD,0,0,0,0,0,0` means the config was wiped** — re-write
`frames.head` then `frames.spawn` (the "unconfigured" branch gets a proof instead of an inference).

### 3.11 App lifecycle: foreground, screen-on, mount

The engine is **JavaScript timers in a webview**. The T-0 arm, the respawn tick, the timed end and
the outbox drain all stop the moment the app is backgrounded or the phone locks. Keep-awake prevents
auto-lock; it does not stop the power button, an incoming call, or the OS reaping a backgrounded
webview. On iOS the `bluetooth-central` background mode keeps CoreBluetooth delivering — **but the
webview's JS still freezes**. Therefore:

- **Hard requirement: the phone is mounted and the app is foreground with the screen on during
  ARMED/LIVE** (README §7, A4.11). A rail/forearm **phone mount** is a hardware deliverable
  (`hardware/` H-item); the HUD (§4) is designed for a mounted phone read at arm's length, not a
  phone in a pocket.
- **Platform:** Capacitor keep-awake + max brightness while ARMED/LIVE; an **Android foreground
  service** (persistent notification) so the OS doesn't kill the process; iOS `UIBackgroundModes:
  bluetooth-central` so the BLE link survives a lock. Both applied by `app/scripts/*-setup.sh`, never
  hand-edited in the generated projects (§8).
- **Resume → reconcile = M-START `resumeSchedule()`** (start-sequence §7). On `appStateChange(active)` /
  `visibilitychange` / relaunch / hot-swap the engine **first runs the §3.10 observe step** — it never
  spawns a gun that may already be live — then reconciles against `synced_now()`: if
  `synced_now() ≥ go_live_t` and the gun is classified unspawned → the M-START E5 grace / hot-join path;
  if a respawn was due while suspended → `frames.revive` now; if the match expired → `frames.end` now
  (→ KITTED); then flush the outbox. Every reconcile action is logged (`resume_reconcile`).
- **Unknowns.** Whether BLE notifications queued while the JS was frozen are **delivered on iOS resume**
  (or dropped) is UNKNOWN (Q10) — if dropped, a death during a lock is only recoverable by §3.10. An
  incoming **phone call foregrounds the dialer** on both platforms regardless of keep-awake — the muster
  checklist puts phones in **Do-Not-Disturb** (`preflight.dnd_on`).
- **Tell MC.** `status.preflight.screen_on` / `foreground` (contracts A4.9) flip to false the instant
  the app is backgrounded (last heartbeat before suspension) so the readiness/live board can show it.

---

## 4. The HUD — a glare-legible video-game HUD (the heart)

The HUD is the player's whole world during a match. Design target: **readable at a glance, at arm's
length on a mounted phone, in direct outdoor sun, while moving** — and **fully dark at night** (§4.3).
It is a pure render of engine state (§4.4); it holds no game logic.

> **Layout is superseded by the Phone HUD v2 design export** (`docs/spec/design/hud-export/`, 2026-08-25):
> **landscape, rail-mounted (844×390 design frame)**, ten states incl. full-screen moments (T-MINUS, KILL
> CONFIRMED, DOWN, REDEPLOY), optional camera look-through, blackout. The sections below describe the
> *requirements* (honesty rule, blackout, glare, state mapping); the export describes the *pixels*.

### 4.1 Layout — big, sparse, thumb-free (original portrait sketch; see the export)

Portrait, full-bleed, **no scrolling during play** (the log/diagnostics live behind a button). One
screen, three zones:

```
┌──────────────────────────────────────────────┐
│  GUN-A · #7 · BLUE       ⏱ 07:12   🔋 55%  ⓘ  │  top strip: gun, player number (1–63, as-is), team, clock, batt, info
├──────────────────────────────────────────────┤
│                                                │
│                  ██  ALIVE  ██                 │  STATE band — the single most important pixel:
│                                                │  a full-width color field (green ALIVE / red DOWN)
├──────────────────────────────────────────────┤
│  HEALTH ███████████████░░░░░   32              │  two fat bars, huge tabular numerals
│  ARMOR  ████████░░░░░░░░░░░░   18              │
│                                                │
│            AMMO   36      ☠ by REAPER · YELLOW │  ammo giant; killed-by line (killer name, team-colored)
├──────────────────────────────────────────────┤
│   K —MC    D 2    A —MC    ACC —MC   ⟳ 4m     │  bottom stat row (kills/assists/acc = MC-owned) + last-synced age
└──────────────────────────────────────────────┘
```

- **STATE band is the hero.** Peripheral-vision readable: when you die the whole band goes red and
  the ALIVE→DOWN swap is unmissable without focusing. When DOWN it becomes the **respawn countdown**:
  a giant number ticking down over red, plus a shrinking bar.
- Health/armor keep the seed's fat bars (`.bar`/`.bar.armor`) but **scaled up** and paired with the
  numeral — never a bar alone (color-blind + glare safety). Health bar color steps green→amber→red at
  ~50%/25% for glance-readable danger.
- Ammo is the largest number on the screen after the state band — it's what a player checks mid-firefight.
- Match clock (`⏱`) counts down `time_limit_s` off synced time (it *is* the end condition, §3.9).
- **Preflight chip:** a small red chip in the top strip whenever any `preflight` item fails (Wi-Fi /
  MC / phone battery / screen / gun / headset — §5). Tap → the diagnostics panel. Green = hidden.
- Player number shows as **`#<player_num>`** (1–63, exactly the wire value; 0 is reserved and never a
  player — contracts A5.1), matching what the host sees.

### 4.2 Outdoor / sun-glare palette

Non-negotiable (README §7). Rules the palette must obey:

- **Maximum contrast, minimum chrome.** Near-black ground, pure-white/pure-color foreground. No subtle
  greys for anything load-bearing — glare eats them. The seed's `--dim` mid-greys are fine for the log,
  **not** for HUD values.
- **Color = state, not decoration.** Green=alive, red=dead/danger, amber=warning (low hp / low batt),
  team color only on the identity chip + killed-by line. Nothing else is colored, so a color *means*
  something at a glance.
- **Big type, tabular numerals** (`font-variant-numeric:tabular-nums`, already in the seed) so numbers
  don't jitter as they change.
- **No thin strokes, no gradients, no shadows** as the only signal — sun flattens them.
- Force **full brightness** while the HUD is foregrounded (Capacitor: keep-awake + max screen
  brightness, §3.11); a dimmed auto-brightness screen is unreadable outdoors.

### 4.3 Blackout night mode (no light leak)

For `night:true` games (or a manual toggle): a phone glowing on a dark field paints a target.
Blackout means **truly dark**, not "dark theme":

- Screen goes to **pure `#000`** with only the few pixels that must exist. Kill the STATE band's
  color field — replace with a thin outline; render health/ammo as **dim red** (retains night vision,
  lowest visible-at-distance signature) at minimum legible size.
- **On damage/death, no bright flash** — the gun's own audio/haptics carry the alert; the screen must
  not strobe and give away position. A brief haptic tick (§ Capacitor Haptics) replaces visual pops.
- Drop screen brightness to minimum-usable; disable any white UI (log, diagnostics) while blacked out.
- Blackout is a **display concern only** — the engine, frames, and events are identical. It ships on
  **both platforms**; nothing here is platform-specific (§8).
- One-tap toggle reachable without leaving the HUD (long-press the STATE band), plus auto-on from
  `config.night`.

### 4.4 State → display mapping (single source of truth)

| lifecycle (§3.8) | STATE band | health/armor/ammo | stat row | notes |
|---|---|---|---|---|
| IDLE | grey "SET GUN" | — | hidden | picker CTA (§7) front and center; no gun linked |
| CONNECTED | grey "READY" | live from gun | hidden | gun linked, not yet kitted |
| KITTED | team-tint "READY UP ✓/○" | caps (loadout) | shown, all "— MC" | ready toggle sends `ready` to MC; loadout/weapon + `#num` shown; tutorial overlay lives here — **also where a finished match lands** ("MATCH OVER" for a few seconds, then READY UP for the next game; A5.9) |
| LOBBY | team-tint "LOBBY — armed-pending" | caps from config | shown | head written, `ack_config` sent; awaiting `start` |
| ARMED (countdown) | **giant T-minus** | full caps | shown | M-START countdown; gun plays the cues |
| LIVE · ALIVE | **green ALIVE** | live | K/D/A/ACC | D is local-real; K/A/ACC = MC + last-synced age |
| LIVE · DOWN | **red + respawn count** | health 0, ammo dim | stat row frozen | "☠ by <NAME> · <TEAM>"; countdown = `deadline_s` |
| WS DISCONNECTED (any) | amber "RECONNECTING…" strip | last-known, dimmed | last-known | non-destructive; returns to prior state; expected for most of a park match |
| BLE DROPPED (any) | red "GUN LINK LOST" strip | frozen | frozen | the seed's retry loop, unbounded while ARMED/LIVE |
| BLE RELINKED (ARMED/LIVE) | amber "GUN RELINKED — pull the trigger" | frozen until classified | frozen | §3.10 observe window (`RESYNC_PROBE_S`); resolves to ALIVE / DOWN / re-arm |
| preflight fail (any) | small red chip, top strip | — | — | Wi-Fi/MC/battery/screen/gun/headset; tap → §5 |

**Honesty rule (README §3, contracts §4):** **Kills, Assists, Accuracy render literally as "— MC"**
until MC pushes them, because a phone node cannot observe them (host-blind about own kills; hits-landed
are known only from victims). **Deaths, ammo, and who killed you are locally real.** Never show a
fabricated kill count — the "— MC" is a deliberate honesty affordance, not a placeholder to be filled
with a guess.

These MC-owned numbers **reconcile at coverage zones** — a base or respawn point that the host has
placed inside router range, or recap — **not continuously**: on a large park a player is out of LAN
range for most of a match, and MC is never BLE-connected mid-match. Each time the node reconnects it
flushes its `event_batch` and MC pushes the row back. Until the next zone the row keeps showing the
last snapshot with a **"⟳ last synced Nm ago"** age so the player knows it is a snapshot, not live.
Design the venue so every death is a sync point (respawn inside coverage) and the row catches up every
life.

---

## 5. Diagnostics + preflight — an optional info button for field debugging

Behind the `ⓘ` in the top strip (never in the player's way). A slide-over panel exposing the raw
state the seed already logs, made inspectable on the field:

- **Preflight (the top block; feeds `status.preflight`, contracts A4.9/A5.4):** expected SSID vs joined
  SSID (`ssid_ok`), MC reachable + last `welcome` age (`mc_reachable`), field SSID saved with auto-join
  (`auto_join_ok`), mobile data off where readable (`cellular_off`), Do-Not-Disturb (`dnd_on`), clock-sync
  age and sample count (`synced`), phone battery % + charging (`phone_batt`), `screen_on` / `foreground`
  flags, gun link (`gun_linked`), headset (`headset_ok` = the last config/spawn echo arrived — amber until
  then), firmware from the probe set (`fw`), outbox queue depth, `match_id`, `player_num`, `config_id`.
  Each row green/amber/red; the HUD chip (§4.1) is the rollup.
- **BLE link:** deviceId (opaque handle §8), connection state, retry count, last disconnect **HCI
  reason code** with plain-English gloss (`0x16` local, `0x13` gun/headset gate, `0x08` out-of-range,
  `0x3E` failed-establish — table from `handoff-ios-ble-findings.md` §2). This turns "it dropped" into
  "the *gun* hung up (0x13 — headset gate)" on the spot.
- **Last frames:** a live tail of parsed frames in/out (the seed's `#log`), with the hardened
  reassembler's output so a merged-notify shows as two clean frames.
- **Engine state dump:** hp/armor/ammo/alive/shots, the `$HIR` latch (`shooter_num`/team/at),
  `deadAt`, team, caps, arm_state, go_live_t, resync/reconcile log lines.
- **Link + battery:** RSSI (from scan), `$VOLTS` pack%/cell mV, time since last `$VOLTS`.
- **Timings:** clock offset vs MC (contracts §7), last heartbeat sent, Transport state.
- A **Panic** button (writes `frames.panic`) and a manual **reconnect** here too, for field recovery.

The panel is diagnostic-only — it must not be a path to arm/fire the gun in a way that bypasses the
game engine.

---

## 6. Log capture + export

The seed's in-DOM `#log` becomes a **rolling on-device log** the node can hand to MC or share out.

- **Rolling ring buffer**, bounded (size + line count), timestamped, persisted across restarts (so a
  crash/power-cycle keeps the pre-crash tail). Captures: frames in/out, connect/disconnect + reason
  codes, state transitions, emitted Events, config/bundle applied, resync/reconcile actions, panic.
- **Offer to MC:** on connect (or when MC asks) the node sends `log_offer{node_id, bytes, lines}`
  (contracts §5); MC replies `pull_log{}`; the node uploads the buffer as **`log_data{seq, chunk,
  last}`** messages, chunks **≤ 48 KB** (under the 64 KB envelope cap). This feeds MC's recap ingest
  (README §7 "MC can ingest node logs at recap").
- **Share out:** a **Share** button in diagnostics uses the native share sheet (Capacitor Share /
  Filesystem) to export the log as a text file — for offline debugging when MC isn't around. On
  Android/iOS both, plain UTF-8 text; filename `brx-node-<gun_tail>-<ts>.log`.
- **Redaction:** the log is field-debug data, not PII — it contains the opaque deviceId, the gun's
  advert name and player numbers; that's fine. Don't log vanity gamertags beyond what MC sent.

---

## 7. BLE plumbing to preserve (reference, don't re-derive)

All of this exists in the seed and is **hardware-proven** (ADR-0001 confirmations; iOS handoff; the
two-node game 2026-08-25). **Carry it forward unchanged**; the notes say *why* so a refactor doesn't
regress it.

- **Init exactly once.** `ensureInit()` memoizes `BleClient.initialize({androidNeverForLocation:true})`.
  iOS `initialize()` **replaces** the CBCentralManager and drops every live gun — a second call
  disconnects the gun (`cap9`). **A "rescan" button must not re-init** (handoff §1).
- **Connect-with-retry.** BRX establishment succeeds ~1 in 3; retry with a guard closure
  (`connectWithRetry`). Shared by first-connect and reconnect. `deviceId` is committed **only on a
  successful connect** (handoff §4) so arming can't enable for an unconnected gun. **While ARMED or
  LIVE the reconnect loop is unbounded with backoff** (500 ms → 10 s cap, jitter) — a match must not lose
  its node because 1-in-3 establishment failed six times in a row. The seed's 5–6 attempts remain the
  *interactive* (IDLE→CONNECTED) behaviour where the user is the loop.
- **Continuous low-latency scan picker.** `requestLEScan({allowDuplicates:true, scanMode:2})` +
  our own in-app list (not `requestDevice`'s one-shot picker), accumulating hits until the player
  taps. Shows name + **MAC-tail suffix** + **RSSI** (closest = in your hand) to disambiguate two
  `Tactix2` guns on iOS (handoff §3). Enrolled guns advertise `<$NAME>-<tail>` → unambiguous.
- **Hardened reassembler.** `pump()` splits on both `*` and `$` boundaries to survive merged
  notifications (`$ALCD,..$BUT,0,1,*`). Keep it; it's the parser the whole engine trusts.
- **20-byte chunking + pacing.** `sendFrame` writes 20-byte chunks with `writeWithoutResponse` +
  8 ms inter-chunk / 18 ms inter-frame sleeps; a per-device write queue (`enqueue`/`wq`) serializes
  writes. Proven for full config+spawn arms with >20-byte frames (ADR-0001 G5).
- **`androidNeverForLocation`** in `initialize()` **and** the `neverForLocation` manifest flag (via
  `app/scripts/android-setup.sh`) — lets Android 12+ scan **without** the system Location toggle. iOS
  ignores the option (harmless). iOS also needs `NSBluetoothAlwaysUsageDescription` (via
  `app/scripts/ios-setup.sh`) or the app is terminated on `initialize()` (handoff §5).
- **Auto-reconnect** on `onDrop` with the same retry loop, guarded by `me.deviceId` so a deliberate
  disconnect doesn't fight the user — followed by the **§3.10 resync**.
- **Before a bundle exists the node sends only the pre-config probe set** (§3.1: `$PHONE`, and the
  `$STOP→$PHONE→$VERSION` ritual) — nothing else, ever, in CONNECTED/KITTED.
- **Network gates are M-NET's**, not this module's: iOS Local-Network permission + ATS, Android
  cleartext + bind-to-Wi-Fi, auto-rejoin of the router SSID — see `net.md` §8. The node only
  *reports* their state in `preflight`.

Refactor guidance: extract the above into a `BrxLink` module (init/scan/connect/write/notify) so the
**engine** talks to it through a thin interface — that same seam is where the Companion swaps BLE for
its native ESP32 stack.

---

## 8. Cross-platform notes

- **`deviceId` is opaque.** Android → MAC, iOS → per-device CoreBluetooth UUID. Treat it as a handle;
  **never persist it and expect meaning on another phone/OS** (contracts §1: correlate by
  sticker/advert name, not address). Binding to MC uses the **gun tail/name**, not the deviceId.
- **Scan labels:** the MAC-tail suffix is real on Android; on iOS the "tail" is derived from the UUID
  and is only locally stable — still useful for disambiguation, not for cross-host identity.
- **Blackout works on both** (§4.3) — it's pure CSS/brightness; no platform BLE difference. Keep-awake,
  brightness, haptics, foreground-service/background-mode (§3.11) and share all go through Capacitor
  plugins that resolve per-platform.
- Everything in `mcp/` stays cross-platform (bleak) for the bench; the **node** stays Capacitor
  (Android + iOS) — one web UI/engine, native BLE. Web Bluetooth is **ruled out** (ADR-0001; iOS has
  none) — the node is a **native app**, and the webapp harness is not a player path.
- iOS deployment target 15.0; iPhone X (16.7) supported. Generated `ios/`/`android/` are rebuilt —
  platform settings live in `app/scripts/*-setup.sh`, never hand-edited in Xcode/Studio.

---

## 9. Task breakdown

1. **Extract the engine** from `app.js` into a DOM-free state machine over contracts §6 (states,
   `handleFrame`, death/respawn, `$HIR` latch + `DEATH_LATCH_MS`, infection `team_flip`/`team_change`,
   `shots` counter, event emission). Unit-testable with a fake BRX frame source.
2. **Extract `BrxLink`** (§7) behind a thin interface; engine ↔ link seam = the Companion port point;
   unbounded reconnect while ARMED/LIVE.
3. **FrameBundle writer** — replace the hard-coded arrays with verbatim writes of `frames.head` /
   `spawn` / `revive` / `end` / `panic` / `team_flip` and the `tutorial{frames}` message; the three
   literal templates + the pre-config probe set (`$PHONE`, `$STOP→$PHONE→$VERSION`, CONNECTED/KITTED
   only); echo capture → `ack_config{gun_echo}` / `no_echo`; caps + respawn + clock from `GameConfig`.
4. **Wire Transport** (M-NET): `hello{seq_next}`/`welcome` re-hydration/`bind`/`assign`/`config`/
   `event`/`event_batch`/`status`/`ack_config`/`feedback`/`control`/`tutorial`/`start`; A10 `loadout_request`/
   `loadout_browse` up and `loadout_ack` down, `assign.catalog` + `assign.policy` (docs/spec/loadout.md §4); the persisted
   context (§3.7) and the bounded persisted event ring + reconnect flush; `match_id` stamping.
5. **Rebuild the HUD** to §4: STATE band, scaled bars+numerals, match clock, killer-name line from
   `roster`, `#num`, stat row with honest "— MC" + last-synced age, preflight chip, full lifecycle
   mapping (§4.4).
6. **Blackout mode** (§4.3): night palette, no-flash-on-damage, brightness/haptics, toggle + auto.
7. **Preflight + diagnostics panel** (§5): the checklist → `status.preflight`; reason-code decode,
   frame tail, state dump, timings, panic/reconnect.
8. **BLE resync policy** (§3.10): observe-before-write — the "pull the trigger" prompt, the
   `$ALCD`/`$BUT`/`$HP` classifier, `RESYNC_PROBE_S` timeout → head (+spawn) re-write, `death{desync}` /
   `respawn{resync}`, LMS never-revive; unit-tested with a fake link that drops, reboots, and dies-in-gap.
9. **App-lifecycle handling** (§3.11): keep-awake/brightness, Android foreground service + iOS
   background mode in the setup scripts, `resumeSchedule()` → observe → reconcile, preflight flags incl.
   `dnd_on`/`auto_join_ok`/`cellular_off`.
10. **Log ring + export** (§6): persisted buffer, `log_offer`/`pull_log`/`log_data` chunks, native share.
11. **Tutorial arming** (§3a): handle `tutorial{weapon, frames}` → write the frames; suppress event
    emission while tutoring; clean exit on the next `tutorial`/`config`/`end`.
12. **Clock sync** (contracts §7): `time_req`/`time_res`, smoothed offset, `synced_now()` used by all
    event `t`, respawn, countdown and expiry math.
13. **Local time-expiry end** (§3.9): while LIVE, watch `synced_now() ≥ go_live_t + time_limit_s`; on
    expiry write `frames.end` + LIVE→KITTED with no MC command, idempotent with a `recall`/`end`
    that arrives first.

Ships with its own fakes (a scripted BRX frame emitter + a mock Transport + a sample `FrameBundle`) so
it builds and demos with neither a gun nor MC present — matching the seed's "runs with the LAN dead"
property.

## 10. Open questions

- **Q2 — respawn ownership for `scanner`/`none` modes.** Does the gun emit a respawn-point signal the
  node can observe, or must the node stay DOWN until an `$HP` refill appears? Needs a bench check;
  affects §3.4. (Grenade respawn stations disable self-respawn and need a per-gun IR arming step —
  FOLLOWUPS B12.)
- **Q3 — dmg accounting.** `hit_taken.dmg` = hp+armor delta. Drain order is **shields → armor → HP**
  (§7r; armor overflow spills into shields on a grant). A single `$HIR` spanning two pools is one
  `hit_taken` with the summed delta — assume yes. ⚠ **Superseded in part by Q12:** the definition is
  blind to the shield pool, so a hit a shield fully absorbs produces no delta at all.
- **Q4 — `$VOLTS` token map.** Seed reads token 3 as pack %; the lab log leans token 4 = cell-voltage
  SoC. A controlled discharge sweep settles which token the HUD/readiness shows.
- **Q5 — cached-context rejoin (§3.7).** How much of a prior game may a power-cycled phone re-arm from
  cache without MC in range before it's unsafe/stale? `CONFIG_TTL_MS` + a "stale config" HUD warning.
- **Q6 — keep-awake vs. battery.** Full brightness + keep-awake + continuous BLE drains the phone over
  a long event. Measure; consider dimming only the non-STATE zones between firefights.
- **Q7 — side-effect-free gun state probe (§3.10).** After a BLE reconnect, does anything short of
  `$SPAWN` make the gun report `$LCD` (HP/armor/ammo + "configured")? Blocking for the resync policy.
- ~~**Q8 — `$HIR` token 1 meaning.**~~ ✅ **CLOSED 2026-08-26 (§7r): tok 1 is the SENSOR** — `0` front dome, `1` back dome, `4` gun body. The reading below is retracted; kept for provenance.
  ~~**Q8 (retracted).**~~ `4` while armor absorbs, `0` for HP-taking hits, `2` on the killing
  hit (§7q). Effect class or weapon? Carried as `ir_proto` until understood.
- **Q9 — mid-match `$TID` write (infection).** Does a `$TID` change on a spawned gun change its
  friendly-fire resolution, its LED, both, or neither? Bench: flip one gun mid-game, shoot it from both teams.
- **Q10 — iOS queued BLE notifications on resume.** With `bluetooth-central` background mode, are
  notifications received while the JS was frozen delivered on resume, or dropped? Decides whether a death
  during a screen-lock is recoverable from frames or only via §3.10. (Soak item 4.)
- **Q11 — does an unspawned head echo with the headset OFF?** The proven headset gate is the `$LCD,45,70`
  echo on `$SPAWN`; if the head's `$LCD,0,0,…` echo also depends on the headset, `ack_config.gun_echo`
  is a valid pre-spawn gate; if not, the gate only exists at T-0.
- **Q12 — the third pool (NEW, 2026-08-26, blocking any shield-granting station).** The wire has
  three pools; the node models two. Three consequences, all currently latent:
  1. **`hit_taken` may not fire at all.** It is defined as "a `$HIR` that drops `$HP`" with
     `dmg` = the hp+armor delta. A hit a shield fully absorbs moves neither — so on a strict reading
     there is **no event**: no assist attribution, nothing in the outbox, and a player being shot who
     looks untouched. It fails *open*, which is why nothing has surfaced yet.
  2. **`status` carries no shield**, so the HUD and MC's board cannot show it.
  3. `$HP` is parsed as a 2-token frame (§3.2), so the value is discarded before anything could use it.

  **Decision needed** (not made here): (a) read `$HP` token 3 into engine state and add `shield` to
  `status`; (b) redefine `hit_taken.dmg` as the **total** pool delta including shields, so a hit that
  landed always produces an event. The IR bench's recommendation, and this spec's author's, is
  **both** — and specifically *include* the shield delta rather than emitting `dmg: 0`, because a
  zero invites `if dmg:` guards downstream to drop the event again, which is the same bug wearing a
  different hat.
