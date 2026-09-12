# M-NODE — the phone node: per-gun engine + video-game HUD

- **Status:** built (`app/src/engine.js`, `app/src/brxlink.js`, `app/src/transport/`, `app/src/hud/`), bench-validated
  through 2026-09-04. Binds to `README.md` §2/§3, `contracts.md` §3 (`FrameBundle`), §4 (events), §5 (protocol),
  §6 (lifecycle), §7 (clock). The screens are `design/phone-hud.md`; the review log is `docs/hud-review-2026-09-03.md`.
  Pruned 2026-09-06: the original portrait layout sketch, the task list and the closed open-questions moved to git
  history (`git log -- docs/spec/node.md`).
- **Owner interface:** *the node app; consumes `Transport` (M-NET) + the per-player `FrameBundle` (compiled by
  M-MODES inside MC, delivered over the wire).* The node **never calls a frame compiler** — it writes bundle
  frames verbatim (contracts A4.2).
- **Later target:** the same engine runs on the ESP32 Companion (ADR-0001). Keep the engine a pure
  state machine over BRX frames + Transport messages + a `FrameBundle`, so it ports without the DOM
  and without a compiler — a Companion is the same verbatim frame writer in C++.

> **Invariants this module must never break (README §2, ADR-0001):** a node owns **exactly one gun** and
> its own-gun loop (arm → damage → death → respawn → local feedback → timed end) **runs with the LAN dead.**
> The gun is **host-blind about its own kills** — the node never tries to detect its own kills. But every hit
> it *takes* names the shooter: `$HIR` token 3 = shooter `player_num`, token 4 = shooter team (protocol §7q).
> The node latches **both** and reports them; MC does the crediting.

---

## 1. Scope & non-scope

**In scope:** the per-gun game engine (§3), the HUD requirements + state mapping (§4), field diagnostics +
preflight (§5), on-device log capture + export (§6), the BLE plumbing (§7), cross-platform notes (§8), open
questions (§10).

**Explicitly NOT this module:** cross-player scoring (kills/assists/accuracy — MC derives them,
contracts §4), the LAN transport itself (contracts §5/§5a, `app/src/transport/`), frame compilation (M-MODES,
in MC), the dispersed-start scheduler (M-START owns the schedule semantics; the node executes them). This
module *consumes* all four.

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
   │        │                       ▼  │  consumes assign/config(bundle)/tutorial/start/feedback/alert/score/apply/control │
   │   log capture (§6) ◄──────  Transport (M-NET client) ◄──── field LAN ──── MC         │
   └────────────────────────────────────────────────────────────────────────────────────┘
```

- **Engine** (`engine.js`) is a state machine over contracts §6. It knows nothing about the DOM or the socket
  directly — it **emits Events**, **accepts commands**, and **writes the frames it was given**. This is what
  ports to the Companion.
- **HUD** (`hud/`) is a pure function of engine state (§4.4). It never writes frames.
- **Transport** is injected. With no Transport, the node still runs from its persisted bundle — it just can't
  report or receive MC feedback.

---

## 3. The per-gun engine

### 3.1 Arming from a pushed config + FrameBundle

Kit-out (`assign{player, team, roster, catalog, policy, game}`, contracts §5) sets player + team → KITTED. The
**lobby `config{config, frames, roster}` push** → LOBBY carries the arming material. On `config` the node:

1. stores `player`, `team`, `roster`, `config`, `frames` (the `FrameBundle`, contracts §3) — persisted (§3.7)
   — and takes `config.health.max_hp`/`max_armor` as the HUD bar caps;
2. writes **`frames.head` verbatim** over BLE (§7) — the config head, **no `$SPAWN`**, no countdown sound; the
   gun sits configured-but-unspawned until M-START's T-0. The head write is silent on the gun (bench
   2026-08-25, protocol §7r);
3. **captures the gun's echo**: a configured gun answers the head with `$LCD,…`/`$ALCD,…` lines (protocol §7e).
   The node waits ~1.5 s for them. **What the echo proves:** the gun *answered* and holds the config. It does
   **not** report state — after `$CLEAR` the head echo is `$LCD,0,0,0,0,0,0` on a healthy gun, not HP. **Silence
   = the gun did not answer**: with the headset OFF the head write echoes nothing and the gun drops the link
   (`$DISCONNECT`; bench 2026-08-25 §7r), so link + echo IS the headset proof and an empty echo is **red after
   the push** (contracts §4 Readiness). Before the push, headset is amber, never red (A5.4);
4. replies `ack_config{config_id, ok, err?, gun_echo}` — `gun_echo` is the first `$LCD`/`$ALCD` line
   verbatim; no echo → `ok:false, err:"no_echo"`; a BLE write failure → `ok:false` + the error.

**Pre-config probe set (contracts §3, A5.4).** Before any bundle exists — in **CONNECTED/KITTED only,
never after a head is written** — the node sends `$PHONE,*` once (starts the ~30 s `$VOLTS` telemetry so
battery exists at muster) and runs the `$STOP,*` → `$PHONE,*` → `$VERSION,*` ritual once (firmware →
`hello.gun.fw` / `status.fw`). `engine.js` `PROBE_VOLTS` / `PROBE_FW`.

The node **owns exactly two literal frame templates** and nothing else (contracts §3/§8, A6.3):
`$SFLASH,*` and `$PLAYX,0,*` (`engine.js`'s exported `SFLASH` / `PLAYX` constants) — plus the pre-config probe set above. `frames.cues` values
are **pre-composed `$PLAY` frames** (the compiler decides slot placement); the node writes them verbatim like
any bundle frame. Everything else — `head`, `spawn`, `revive`, `end`, `panic`, `team_flip`, `leds`, `gun`,
`headset` from the bundle, and the `tutorial{frames}` *message* — is written verbatim. Volume is MC's concern:
the head carries `$VOL,<80 indoor|90 outdoor>` (`compile.play_volume()`); the node merely **checks it is
present** and logs a warning if not. It never rewrites a frame.

`config.respawn.delay_s`/`type`/`gate` drive the respawn rule (§3.4, utility.md §4); `config.time_limit_s` drives
the HUD match clock and the local timed end (§3.9). `night` selects blackout defaults (`design/phone-hud.md` B4).

### 3.2 Tracking hp / armor / ammo / shooter

> ⚠ **Two pools scored, three on the wire.** `$HP` carries `<hp>,<armor>,<shield>` and damage drains
> **shields → armor → HP**. The engine now reads and persists `shield` (`engine.js`'s `$HP` handler and its snapshot) but the `status`
> event, `hit_taken.dmg` and the HUD still model hp+armor. Nothing is wrong today because shields cannot be
> granted over BLE — the pool fills **only** from an IR `$SIR` function-11 event (P16) — but that is now something
> a station can do. The decision is **§10-Q12**.

| frame | tokens read | engine effect |
|---|---|---|
| `$HP,<hp>,<armor>,<shield>,*` | hp, armor, shield | set pools; **if `hp==0 && alive && running` → death() (§3.4)** |
| `$LCD,...` | hp, armor, ammo (tok 5) | set `hp`, `armor`, `ammo` — the periodic full-state line; also the **config/spawn echo** (§3.1, §3.10) |
| `$ALCD,<ammo>,...` | ammo (tok 1) | set `ammo`; **a decrement within a magazine = a shot → `shots++`** (§3.3); an increase = reload/pickup, ignored; a slot's clip cap corrects `activeSlot` after a SWITCHING window |
| `$HIR,<sensor>,<ir_proto>,<shooter_num>,<shooter_team>,...` | tok 3 = shooter `player_num`, tok 4 = shooter team; **guard tok 2 ≠ `15`** (grenade/station beacon, not a hit) | latch `{shooter_num, shooter_team, at, ir_proto, sensor}` (§3.5). **Tok 1 is the SENSOR that caught the IR** — `0`–`3` are ALL HEADSET sensors (four of them; only `0` front and `1` back are bench-mapped), `4` gun body (§7r). Directional logic only holds at field distance — at point-blank the IR floods every receiver. **Tok 5 is the RAW magnitude, not the damage applied**: derive damage from the `$HP` delta. ⚠ The node read `ir_proto` from tok 1 until 2026-09-01, so every fact before then carries the SENSOR under the `ir_proto` name, with no version marker |
| `$VOLTS,...` | pack % (**provisional** token — tok 3 vs 4 unresolved, §10-Q4) | set `battery` (§5) |
| `$BUT,2,1` / `$BUT,0,1` | reload handle / trigger | RELOADING takeover (§4.5); a dead gun still reports the trigger, which is the scanner-respawn act (utility.md §4.1) |

Ammo is **observed**, never asserted — the gun is the source of truth for its own magazine. The node
does **not** simulate reloads; it reflects `$ALCD`/`$LCD`.

### 3.3 Emitting Events (contracts §4)

The engine emits **only node-observable facts**, handed to Transport. Two classes:

**Persisted facts** (queued in the ring if the LAN is down — §3.7; carry `Envelope.seq` + `match_id`):
- **`hit_taken`** — on a `$HIR` (tok 2 ≠ 15) that drops `$HP`: `{shooter_num, shooter_team, dmg, ir_proto, sensor}`
  (dmg = the hp+armor delta the hit caused).
- **`death`** — on `$HP→0` (§3.4): `{shooter_num, shooter_team, desync?}` from the latch (§3.5) —
  `shooter_num: 0` when the latch is older than `DEATH_LATCH_MS` (environmental / unknown), and
  `desync: true` when the `$HP,0` was learned out of band — inside a rejoin reconcile or a lobby/armed
  resync (§3.10) rather than from a live hit sequence.
- **`respawn`** — on local revive (§3.4); `station: <id>` when a scanner station revived the player (A13.2).
  `resync: true` is a **legacy flag**: the retired live-reconnect resync set it; the reconcile that replaced it
  (§3.10) re-arms without emitting a respawn.
- **`team_change`** — `{tid}` when this gun moved to another team mid-match (infection, §3.4).
`shooter_num` **0 is reserved** (contracts A5.1): never a player — a tutorial-armed gun, a stale latch, a
desync. Players are 1–63.

Every persisted event carries **`match_id`** (from `start`, contracts A4.3). **Before a `start` is
known the node emits no persisted events** — hits taken in a tutorial or a pre-start lobby are not match
facts. `t = synced_now()` (contracts §7). Idempotent by `(node_id, seq)`.

**Live-only** (never queued, never persisted, **no `seq`**; sent only while connected):
- **`status`** — every `STATUS_HEARTBEAT_MS` (2000): `{match_id?, hp, armor, ammo, alive, shots,
  deadline_s?, battery, fw?, arm_state, t_minus_ms?, synced, dropped?, preflight}`. `arm_state ∈
  idle|connected|kitted|lobby|armed|live` (the §3.8 game phase — **orthogonal** to link state); `t_minus_ms`
  only while ARMED; `deadline_s` = seconds left on the respawn timer when DOWN; `preflight` = `{ssid_ok,
  mc_reachable, auto_join_ok, cellular_off, dnd_on, phone_batt, screen_on, foreground, gun_linked, headset_ok}` (§5).

**The `shots` counter rule** (contracts A4.4): `$ALCD` token 1 is the magazine count. A **decrement** (within
one magazine) adds `prev − new` to `shots`; an **increase** (reload, pickup, respawn refill) is ignored and
resets `prev`. `shots` resets to 0 at `startAt()` and rides `status`; MC diffs it. `$ALCD` was seen counting
36→0 shot-by-shot in every live run (exp-log 2026-08-25), so the counter is exact for automatic fire.

### 3.4 Own-death detection + local respawn

- **death():** `$HP→0` while alive+running → `alive=false`, `deaths++`, `deadAt=synced_now()`, read the
  §3.5 latch **only if it is fresher than `DEATH_LATCH_MS` (2 s)** — the killing `$HIR` arrives in the
  same millisecond as `$HP,0` (§7q), so an older latch means the death had another cause → `shooter_num: 0`.
  Emit `death`, HUD flips to DOWN (§4.5). The killed-by line resolves `shooter_num` through `roster` to a
  display name; 0 or an unknown number falls back to the team or "DOWN". **No frame is written to the gun on
  death** — the firmware handles its own down-state; the node only *observes* it, then paints the headset
  out-blink from `bundle.headset.death` (A11.6). A dead gun cannot fire (§7q), so the HUD's DOWN state is
  physically true.
- **Infection (`config.mode == "infection"`):** a killed human, on death, writes
  `frames.team_flip[<infected tid>]` verbatim, emits **`team_change{tid}`**, flips its own HUD identity
  chip to the infected team and plays its own `infected` cue (A11.4), then runs the normal respawn timer →
  `frames.revive`. Node-local; works offline. A mid-match `$TID` write **flips hit resolution immediately**
  (bench 2026-08-25 §7r; the LED repaints at respawn).
- **respawn:** the 500 ms tick. `respawn.type=="auto"`: when `now − deadAt ≥ delay_s`, write **`frames.revive`**
  verbatim (`$SPAWN,,` + loadout-correct `$AMMO`), set `alive=true`, refill HUD caps, emit `respawn`.
  `type=="scanner"`: revive only when the player's team **respawn station** is present (utility.md §4.1) and the
  gate (`trigger` = a pull on the dead gun's `$BUT,0,1`; `presence` = dwell) is met; the DOWN screen walks the
  player through it (§4.5). `type=="none"`: stay down (LMS). Respawn math uses **synced time**.

### 3.5 Shooter identity from `$HIR`

`$HIR` token 3 = shooter **`player_num`**, token 4 = shooter **team** — both always present, both
hardware-verified in both directions (protocol §7q). Latch `{shooter_num, shooter_team, at}` on every
valid `$HIR` (tok 2 ≠ 15); at death read the latch iff `now − at ≤ DEATH_LATCH_MS`, else report
`shooter_num: 0`. Attribution is **exact**; there is no team-only fallback and no heuristic. The node still
**never computes its own kills** — a kill you score is invisible in your own stream; only the *victim* reports
it (§3.6). The `roster` turns a number into a name for the HUD; an unknown number is still reported verbatim.

### 3.6 Kill feedback is MC-driven — do NOT detect own-kills

**Hard boundary (ADR-0001).** In a BLE-armed game the gun does **not** self-fire the green sight; it
emits **no shooter-side kill event** (exp-log D4). The node therefore **cannot and must not** try to
detect that *it* killed someone. MC knows *exactly* who the killer is (victim's `shooter_num`), so
`feedback{player_id, kind, t, cue?, medals?}` is targeted, never guessed (contracts §5):

```
feedback(kind):  $SFLASH,*  →  write cues[kind] verbatim (a pre-composed $PLAY frame, A6.3)
                 + leds[kind] (A11.3); medals play back to back 2 s apart INSTEAD of the kill line (A11.4)
```

The hook is **best-effort**: no local game logic ever depends on receiving it. The node **ignores a
`feedback` or `alert` whose `t` is older than `FEEDBACK_MAX_AGE_MS`** so a late flush never flashes a sight
minutes after the kill. The node fires every event its **own** gun can witness itself (hit_taken, died,
respawned, healed/armour_up/shield_up, low_health, the clock callouts `time_60/30/10`, the extraction ladder,
its own infection turn) from the bundle it holds; MC pushes exist only for facts no single gun can know
(A11.4/A11.5).

**Field reality (A4.8):** on a large park the victim's report and MC's `feedback` both need the LAN, so the
green sight and live K/A/ACC fire only in **coverage zones** and at recap. The HUD's K/A/ACC stay **"—"**
until MC pushes them (`score`, `welcome.node.score`); the node never computes them.

### 3.7 Autonomy — the whole loop runs with the LAN down

With **no Transport connected**:
- arming still works: the node **persists its whole context** — `player`, `team`, `roster`, `config`,
  the `FrameBundle`, the pending `start` (`match_id`, `go_live_t`, `seq`, `countdown_s`), its clock offset
  **and its combat state** (`alive/hp/armor/shield/deadAt/killedBy`, S7.1) — so a power-cycled phone rejoins
  the same game without MC in range (M-START E1);
- damage/death/respawn/battery/timed-end all run off BLE frames + synced time alone;
- persisted events **queue** in the bounded persisted ring (`transport/ring.js`) and flush as `event_batch` on
  reconnect; the Transport consumes MC's **`ack{seq_hi}`** to prune the ring;
- on any (re)connect the node sends `hello{…, gun: {name, tail, fw?}, seq_next}` and MC's **`welcome`
  re-hydrates everything** (contracts A4.5/A5.5). **Hydration is resolved by the gun**: `gun.name` is the full
  advert name and `tail` is parsed from it — **never from the platform `deviceId`** (iOS gives a UUID). So a
  **hot-swapped** phone with a brand-new `node_id` is hydrated on its very first `hello`; `score?` seeds its
  HUD D/K/A. The node adopts `next_seq = max(own, seq_hi+1)`. After hydrating, the node **re-sends
  `ack_config`/`ready`** if its own state says they were sent but MC's returned context doesn't reflect them;
- only two things degrade: MC `feedback`/`alert`/`score` (no sight flash, stale board) and cross-player HUD
  stats.

The node **never blocks** on the LAN. Start uses the pre-shared `go_live_t`, end uses
`go_live_t + time_limit_s` (contracts §7 / M-START), so neither T-0 nor T-end needs a signal.

### 3.8 Lifecycle (contracts §6) → engine states

```
IDLE ─setGun─► CONNECTED ─assign─► KITTED ─[ready-up; all-ready → config(bundle)]─► LOBBY ─start(seq,go_live_t)─► ARMED(countdown)
                                      ▲                                                                                │
                                      └──── end / recall / panic / local time-expiry ◄──── LIVE{ALIVE ⇄ DOWN} ◄──── T = go_live_t ────┘
```

**IDLE = no gun; CONNECTED = gun, no player; KITTED = gun + player, no game on the gun.** A finished, recalled
or panicked match returns to **KITTED** (contracts A5.9) — the player is still kitted; a rematch is a new
`config` push → LOBBY. `DISCONNECTED` (WS) is orthogonal, and so is the BLE link (§3.10) — a node can lose
either in any phase and keep running. Control meanings (contracts §5, A5.9 — `pause` no longer exists):
- `control{cmd:"recall"}` **stops a LIVE (or ARMED) game** → write `frames.end` (+ `cues.game_over`) → KITTED;
- `control{cmd:"end"}` is the normal match end (same teardown) → KITTED;
- `control{cmd:"panic"}` → write `frames.panic` (`$CLEAR,*` then `$SP,99,*`) → KITTED;
- `control{cmd:"abort_start", seq}` cancels a *pending* countdown (by `seq`) while ARMED → LOBBY (the
  gun still holds `head`). If the node is **already LIVE** for that `seq` it behaves as `recall` → KITTED;
- `end`/`recall` received in KITTED/LOBBY: write `frames.end` iff a bundle is held (LOBBY), → KITTED.
LIVE also ends with **no MC command at all** on local time-expiry (§3.9). A new match, a match end and a panic
each clear an in-flight reconcile (§3.10) and end any tutorial.

### 3.9 Local time-expiry match end (the timed end, symmetric to the timed start)

While LIVE the engine holds `go_live_t` and `config.time_limit_s`; when

```
synced_now() ≥ go_live_t + time_limit_s * 1000   (contracts §7 synced time)
```

the node ends **its own** match locally: write **`frames.end`** verbatim, then play **`cues.game_over`** (the
`frames.end` `$SPAWN` voice is already muted by its `$PLAYX,0`), stop the loop, LIVE→**KITTED** — exactly the
teardown a `recall`/`end` would have driven. An `end`/`recall` that arrives earlier still ends the game;
whichever comes first wins (idempotent teardown). Frag-limit / survival ends are MC-broadcast `end`s and only
reach nodes in coverage. `time_limit_s == null` (full-coverage venues only) means **no local expiry**. The
node also fires its own `time_60/30/10` callouts and, in extraction, `raid_ending`/`raid_over` from this clock
(A11.4). ⚠ The composed time-expiry flow has not been run on hardware (FOLLOWUPS).

### 3.13 The match result (contracts A24) — pushed, never inferred

The end of a match is two facts on the node. **"It ended"** is local (§3.9) or an `end`/`recall`. **"How it
ended"** only ever comes from MC as a **`result`** envelope: `outcome` is already computed for THIS recipient
(`win`/`lose`/`draw`/`undecided`), with the winner, every player's `ScoreRow`, team totals, honors and
possession. The engine stores it as `state().result` (null until it arrives), folds `outcome`, `team_scores`,
`best_streak`, `medals` and its own hill hold (`this.hold`) into the `onEnd` history entry, and accepts a
`result` for the CURRENT `match_id` only (a stale one is logged and dropped). `welcome.node.result` hydrates it
on a rejoin during recap. **Rule:** no code path on the node may write WIN or LOSE from the absence of a
message — a `victory` cue that never came means "lost" and "out of coverage" identically. The FINAL RESULTS
screen (§4.4) shows "RESULT PENDING" until the push, and "MC NOT REACHED — see Mission Control" once the
settle window (30 s) passes with no MC link; it is mode-aware from `result.mode`/`win_by`, with a TEAM view
(totals + each team's players) and a PLAYER view (the leaderboard), medals and best streak from the rows, and
never hard-codes a cell set. `OK` leaves it (`ackEnd`); a `RESULTS` button on the MATCH COMPLETE screen and a
`HISTORY` list (per session, from `localStorage['brx.history']`) reopen it.

### 3.14 Background log sync (contracts A25) — game sync has priority

`pull_log` is answered by the node only when **not ARMED and not LIVE** and **`ring.pending() === 0`** (no
unacked fact in the store-and-forward ring, §5a). Otherwise the request is parked and retried on a 5 s → 60 s
backoff until it can be served; a reconnect re-sends `log_offer` so MC asks again. The upload is the existing
`log_offer` + `log_data` chunk stream (≤ 48 KB), one chunk in flight, the next only after the socket buffer
drains, so a log never delays a fact. The phone keeps `uploadedThrough` (the log line count MC has) and a
later pull sends only the tail. The debug panel's SHARE LOG stays as the manual route.

### 3.10 BLE reconnect — reconcile from persisted state, never guess (S7.1, contracts A6.8)

**The node persists and restores combat state.** `_save`/`_load` carry `alive/hp/armor/shield/deadAt/killedBy`
across an app kill (2026-09-04). After a reopen the node already KNOWS its real pools, so it does not have to
probe the gun to reconstruct them. This closes a real cheat: before persistence a rejoin defaulted
`alive:false/hp:0`, the recovery `deadAt` stamp booked a death, and auto-respawn healed to full — a free
respawn on demand (force-close at low HP → reopen → full HP). Found on hardware, Tony 2026-09-04.

**A LIVE reconnect RECONCILES (a disarmed window); it never re-arms blind and never infers death.** On a BLE
reconnect while `live` the node opens a `reconciling` window of `RECONCILE_MS = 3000` (`_beginReconcile`):
- **Disarm** at once — `$AMMO,0,0,0,1` on both slots — so the gun cannot fire while state settles. The
  deliberate 3 s hold is itself an anti-cheat: restarting to escape or heal is slow and pointless, while a
  genuine app crash costs 3 s (Tony's call, 2026-09-04).
- **Keep the restored pools** — nothing that changes hp/armor is written.
- When the window elapses, `_endReconcile` **re-arms to the real spawn `$AMMO` frames only if alive**, and
  **never writes `$SPAWN` or `$PSET`** — so a rejoin can never heal. Down → stay disarmed and down, awaiting a
  real respawn on its true `deadAt` timer.
- **No death is inferred.** A missed death is booked only from POSITIVE evidence: a real `$HP,0` / `$LCD` line
  arriving mid-window is trusted verbatim → DOWN + `death{desync:true}` (credited to a latched `$HIR` within
  `DEATH_LATCH_MS`, else `shooter_num:0`) with the true respawn timer.

A new match, a match end, and a panic each clear an in-flight reconcile; auto-respawn, the recovery `deadAt`
stamp, scanner-revive, and reload takeover are all gated off while `reconciling`. `state().reconciling` drives
the HUD's RECONCILING takeover (§4.5), and no trigger pull is asked of the player. **Validated on hardware
2026-09-04:** shot to HP 29, force-close, reopen → held at 29, takeover shown, gun re-armed, no heal
(experiment-log). Every reconcile action is logged.

**LOBBY / ARMED reconnect (and resume) just re-write the head.** There is no live state to reconcile, so the
node re-applies `frames.head` (`_beginResync` for those phases) and the scheduled T-0 spawn runs as normal.
Config survives a BLE drop but is wiped by a power-cycle (§7r), so the head re-write is what restores a
power-cycled gun. The old trigger-first evidence protocol (A6.6) survives ONLY here.

**Why the reconcile never blind-writes `spawn`:** (1) the head's echo is `$LCD,0,0,0,0,0,0` on a healthy gun
(bench 2026-08-25) — it cannot reveal a death; (2) `$SPAWN` is a full heal + refill. Persistence removed the
NEED to probe, so the evidence protocol was retired for the live path — it mis-concluded "dead" on reconnect
and let auto-respawn heal.

**Known limitation — gap-death re-arm (FOLLOWUPS S7).** If the gun DIED while the app was closed and does not
re-report `$HP,0` on reconnect, the reconcile trusts the restored "alive" and re-arms it. The firmware itself
gates firing on a truly-dead gun, so this favours no cheat, but the HUD would read alive until the gun
re-announces.

### 3.11 App lifecycle: foreground, screen-on, mount

The engine is **JavaScript timers in a webview**. The T-0 arm, the respawn tick, the timed end and
the outbox drain all stop the moment the app is backgrounded or the phone locks. Keep-awake prevents
auto-lock; it does not stop the power button, an incoming call, or the OS reaping a backgrounded
webview. On iOS the `bluetooth-central` background mode keeps CoreBluetooth delivering — **but the
webview's JS still freezes**. Therefore:

- **Hard requirement: the phone is mounted and the app is foreground with the screen on during
  ARMED/LIVE** (README §6, A4.11). A rail/forearm **phone mount** is a hardware deliverable; the HUD is
  designed for a mounted phone read at arm's length.
- **Platform:** Capacitor keep-awake + max brightness while ARMED/LIVE; an **Android foreground
  service** so the OS doesn't kill the process; iOS `UIBackgroundModes: bluetooth-central`. Both applied by
  `app/scripts/*-setup.sh`, never hand-edited in the generated projects (§8).
- **Resume → reconcile = `resumeSchedule()`** (M-START). On `appStateChange(active)` / `visibilitychange` /
  relaunch / hot-swap the engine **first settles the BLE link (§3.10)** — a live relink opens the disarmed
  reconcile window, a lobby/armed relink re-writes the head; neither blind-spawns — then reconciles against
  `synced_now()`: missed T-0 → the M-START E5 grace / hot-join path; a respawn due while suspended →
  `frames.revive` now; match expired → `frames.end` now (→ KITTED); then flush the outbox. Logged
  (`resume_reconcile`).
- **Unknowns.** Whether BLE notifications queued while the JS was frozen are **delivered on iOS resume**
  (or dropped) is UNKNOWN (Q10). An incoming **phone call foregrounds the dialer** on both platforms — the
  muster checklist puts phones in **Do-Not-Disturb** (`preflight.dnd_on`).
- **Tell MC.** `status.preflight.screen_on` / `foreground` flip to false the instant the app is backgrounded.

### 3.12 Host-driven stun (EMP) — the node disarms, the node restores (F15, contracts A20)

The gun does not stun itself. The chain the bench proved: a **proto-8 IR word** → the victim's `$SIR,8,0,,24` row
(fn 24 is a **status** function: `$HIR,…,8,…` fires, no pool moves, **no `$HP` follows**) → the node writes
`$AMMO,<slot>,0,0,1,*` for every live slot → the node restores when its timer runs out. MC ships the fn-24 row only
under **`config.stun`** (`{duration_s?}`, default 10 s); without it the stock `<8,0>` row is the **charge rifle's
plain damage**, so the node's rule is gated on the config too — a plain charge-rifle hit must disarm nobody.

| rule | engine (`engine.js _stun` / `_stunRestore`; `stage.py` mirrors) |
|---|---|
| trigger | `$HIR` tok 2 = `8`, only while LIVE + spawned + alive + not tutorial + `config.stun` present. The shooter is still latched (§3.5) |
| disarm | one write: `$AMMO,<slot>,0,0,1,*` per slot the bundle's spawn frames load (0, and 1 when a secondary exists). `moment {kind: stunned, data: {ms}}`, presentation hook `stunned` |
| the restore counts | snapshotted AT the stun: the last `$ALCD` mag + reserve per slot, else the frame's spawn values for a slot that never fired. **Never the frame's for a slot that fired** — a re-push refills (F87) and a stun is not a reload |
| extend | a second EMP inside the window pushes `until` out to a full window from now and writes nothing — no second disarm, never a double restore |
| expiry | `tick()`: `$AMMO,<slot>,<mag>,<reserve>,1,*` per slot from the snapshot, once; `moment stun_over`, hook `stun_over`. A link that is down at expiry gets no write (the relink reconcile re-arms, §3.10) |
| death | cancels with **no write** — `frames.revive` carries its own `$AMMO`, and `_revive` resets the per-slot counters as always |
| rejoin | `_beginReconcile` cancels the stun: the reconcile owns the disarm/re-arm from there (coarse: it re-arms with the frame's counts) |
| `$ALCD` while stunned | ignored — a gun that cannot fire has no shot to count, and if the gun echoes our `$AMMO,0` (hardware-UNVERIFIED) that echo must not become the count we restore |
| state | `state().stunned = {until, leftMs}` (null when not stunned) for a STUNNED takeover; not persisted (a reload during a stun loses the timer; the relink reconcile re-arms the gun) |
| wire | nothing: a status row moves no pool, so no `hit_taken`; MC does not learn of stuns today (open) |

The **source** is a catalog matter, not a node one: any `$WEAP` with t3 = 8 fires the word (the charge rifle keys `<8,0>`
today, so under `config.stun` it stuns and deals no damage — `validate()` says so), or a proto-8 station. The native
firmware stun is not relied on (2/5 singles, lasts until death).

---

## 4. The HUD — requirements and state mapping

The HUD is the player's whole world during a match. Design target: **readable at a glance, at arm's
length on a mounted phone, in direct outdoor sun, while moving** — and **fully dark at night**. It is a pure
render of engine state; it holds no game logic. **The pixels are `design/phone-hud.md`** (landscape, 844×390,
rail-mounted) and the shipping `app/src/hud/`; this section is the requirements the pixels must honour.

- **Glare:** maximum contrast, minimum chrome; colour = state, not decoration (green alive, red down/danger,
  amber warning, team colour only on identity); big tabular numerals; no thin strokes, gradients or shadows
  as the only signal; full brightness while foregrounded.
- **Blackout (night):** truly dark, not "dark theme" — pure `#000`, dim red readouts, no bright flash on
  damage/death (haptics carry it), minimum brightness, auto-on from `config.night` + a manual toggle. A
  display concern only; engine, frames and events are identical.
- **Honesty rule (README §2, contracts §4):** kills, assists, accuracy render as **"—"** until MC pushes them
  (a phone cannot observe them); deaths, ammo, pools and who killed you are locally real. Never show a
  fabricated kill count. ACCURACY shows only once MC has counted ≥ 1 hit and ≥ 10 shots. MC-owned numbers
  reconcile at coverage zones, not continuously; the header shows a "last synced" age.
- Player number shows as **`#<player_num>`** (1–63, exactly the wire value).

### 4.4 State → display mapping (single source of truth)

| lifecycle (§3.8) | STATE band | health/armor/ammo | stat row | notes |
|---|---|---|---|---|
| IDLE | "SET MY GUN" | — | hidden | scan picker (§7) front and center; no gun linked |
| CONNECTED | "waiting for Mission Control" | live from gun | hidden | gun linked, not yet kitted |
| KITTED | setting-up → BRIEFING → three slot plates PRIMARY / SECONDARY / PERK + READY UP | caps (loadout) | shown, all "—" | `kit_open` gates the plates (loadout.md §4.6); ready toggle sends `ready`; try-out panel lives here — **also where a finished match lands** ("MATCH OVER", then READY UP; A5.9) |
| LOBBY | "armed-pending" | caps from config | shown | head written, `ack_config` sent; awaiting `start` |
| ARMED (countdown) | **giant T-minus** | full caps | shown | M-START countdown; gun plays the cues |
| LIVE · ALIVE | the HUD | live | K/D/A/ACC | D is local-real; K/A/ACC = MC + last-synced age |
| LIVE · DOWN | **DOWN takeover** | health 0, ammo dim | frozen | countdown (auto) or the station lesson (scanner), the race to the cap while MC is linked |
| WS DISCONNECTED (any) | amber MC dot only | last-known | last-known | non-destructive; expected for most of a park match |
| BLE DROPPED (any) | red "GUN LINK LOST" strip | frozen | frozen | the retry loop, unbounded while ARMED/LIVE |
| BLE RELINKED (LOBBY/ARMED) | amber "GUN RELINKED" while the head is re-written | frozen until the echo | frozen | §3.10 head re-write |
| BLE RELINKED (LIVE) | **RECONCILING takeover** "GUN RELINKED · SYNCING WITH YOUR GUN · weapon disarmed for a moment" | real pools kept | frozen | S7.1: never infers a death, never heals; 3 s disarmed, then re-armed at the real HP; no trigger pull asked |
| preflight fail (any) | small red chip, top strip | — | — | Wi-Fi/MC/battery/screen/gun/headset; tap → §5 |

### 4.5 Takeovers and moments (built 2026-09-03/04; the review log is `docs/hud-review-2026-09-03.md`)

Two kinds of overlay sit on the LIVE screen. **Takeovers** are persistent and own the screen while a state
holds (the chip bar hides under them); **moments** are transient and stack above whatever is up.

| overlay | kind | trigger | copy / what it shows | ends |
|---|---|---|---|---|
| RELOADING | takeover | `$BUT,2,1` (reload handle) or ALT on a one-weapon gun (`easy_reload`) | weapon name, a progress track sized to the catalog `reload_s` × the equipped perk's `reload_mult` (MC applies the same to `$WEAP` t18) | the mag comes back (`$ALCD` up), or `reload_s` + 600 ms; never while dead, in resync/reconcile, or with a dry reserve |
| SWITCHING | takeover | ALT with two weapons | STOWING → DRAWING tiles (art + names), a track over the gun's swap delay = `FrameBundle.swap_ms` (`$WEAP` t15, bench 2026-09-04: the larger of the two slots; `quick_switch` halves it) | the next shot on the new slot → an ACTIVE ✓ confirm ("CONFIRMED BY YOUR GUN"), or the window expires → "READY" (assumed; the next `$ALCD` corrects `activeSlot`) |
| RECONCILING | takeover | a BLE rejoin while LIVE (S7.1) | GUN RELINKED · SYNCING WITH YOUR GUN · 3 s fill · WEAPON DISARMED FOR A MOMENT | `state().reconciling` clears |
| DOWN | takeover | death | auto mode: the countdown; scanner mode: the **lesson** — RUN TO YOUR TEAM'S RESPAWN STATION (then pull the trigger there / and stand there, per `respawnGate`) → GET CLOSER + a closeness bar (RSSI vs the station's threshold) → HOLD… → PULL THE TRIGGER TO RESPAWN / RESPAWNING…; a recap row: TIME LEFT · the race to the cap (team chips + FIRST TO n, **only while MC is linked**, from `score.board`) · YOU (deaths, shots; kills only when linked) | revive |
| KILL CONFIRMED | moment (takeover-styled) | MC `feedback{kill}` | dims the HUD, KILL / CONFIRMED, the victim chip; **medal badges** land 2 s apart with the announcer lines (A11.4) | 1.8 s + 2 s per extra medal |
| REDEPLOYED | moment | revive | the kit you go back in with (primary, secondary, perk — A14), a light sweep | 1.7 s |
| HIT / GAIN | moment | `$HP` down / up | the damage number + the shooter's team chip / +n POOL; one fade in, one fade out, never a repeating flash | 0.7 s / 1 s |
| ALERT | moment | MC `alert` or a node clock callout (A11.4) | a full-width band: OBJECTIVE (team colour) · CLOCK (amber) · ALERT (red) · MATCH (glow) + the text MC chose | 2.2 s |

Rules that hold across all of them: one whiteout flash at most every 500 ms (WCAG 2.3.1) and none under
`prefers-reduced-motion`; nothing in the top-right 48 px gutter (the ⓘ diagnostics button lives there; native builds
also inset the whole frame 28 px under the status bar); the frame never shrinks below 844 CSS px (it is scaled, not
reflowed); the header shows two dots, GUN and MC, and mid-match MC out of range is the amber dot only (a tap on the
MC label shows the detail — playing out of range is the normal case); zero stats stay off the header; the result
tally is **this MC session's** games (the phone's all-time count lives in the diagnostics; MC-owned totals are F24).

---

## 5. Diagnostics + preflight — an optional info button for field debugging

Behind the `ⓘ` in the top strip (never in the player's way). A slide-over panel exposing the raw state, made
inspectable on the field:

- **Preflight (the top block; feeds `status.preflight`, contracts A4.9/A5.4):** expected SSID vs joined
  SSID (`ssid_ok`), MC reachable + last `welcome` age (`mc_reachable`), field SSID saved with auto-join
  (`auto_join_ok`), mobile data off where readable (`cellular_off`), Do-Not-Disturb (`dnd_on`), clock-sync
  age and sample count (`synced`), phone battery % + charging (`phone_batt`), `screen_on` / `foreground`
  flags, gun link (`gun_linked`), headset (`headset_ok` = the last config/spawn echo arrived — amber until
  then), firmware from the probe set (`fw`), outbox queue depth, `match_id`, `player_num`, `config_id`.
  Each row green/amber/red; the HUD chip is the rollup.
- **BLE link:** deviceId (opaque handle §8), connection state, retry count, last disconnect **HCI
  reason code** with plain-English gloss (`0x16` local, `0x13` gun/headset gate, `0x08` out-of-range,
  `0x3E` failed-establish — table from `docs/reference/ios-ble-notes.md` §2).
- **Last frames:** a live tail of parsed frames in/out, with the hardened reassembler's output.
- **Engine state dump:** hp/armor/shield/ammo/alive/shots, the `$HIR` latch, `deadAt`, team, caps, arm_state,
  go_live_t, resync/reconcile log lines, the station presence (`state().station`, utility.md §4.2).
- **Link + battery:** RSSI (from scan), `$VOLTS` pack%/cell mV, time since last `$VOLTS`.
- **Timings:** clock offset vs MC (contracts §7), last heartbeat sent, Transport state.
- A manual **reconnect**, the utility-role switch (7 taps; utility.md §1) and **SHARE LOG** (§6). There is no
  PANIC button on the phone (design-review 2026-08-26 round 6).

The panel is diagnostic-only — it must not be a path to arm/fire the gun in a way that bypasses the engine.

---

## 6. Log capture + export

- **Rolling ring buffer**, bounded (size + line count), timestamped, persisted across restarts. Captures:
  frames in/out, connect/disconnect + reason codes, state transitions, emitted Events, config/bundle applied,
  resync/reconcile actions, panic.
- **Offer to MC:** on connect (or when MC asks) the node sends `log_offer{node_id, bytes, lines}`; MC replies
  `pull_log{reason?}` (A25: gated on the node — never while ARMED/LIVE or with unacked facts, §3.14); the node uploads the buffer as **`log_data{seq, chunk, last}`** messages, chunks **≤ 48 KB**
  (under the 64 KB envelope cap).
- **Share out:** a **Share** button in diagnostics uses the native share sheet to export the log as a text
  file — `brx-node-<gun_tail>-<ts>.log`.
- **Redaction:** the log is field-debug data, not PII — it contains the opaque deviceId, the gun's advert
  name and player numbers. Don't log vanity gamertags beyond what MC sent.

---

## 7. BLE plumbing to preserve (reference, don't re-derive)

All of this exists in `app/src/brxlink.js` / `app.js` and is **hardware-proven** (ADR-0001 confirmations; iOS
handoff; the two-node game 2026-08-25). **Carry it forward unchanged**; the notes say *why* so a refactor
doesn't regress it.

- **Init exactly once.** `ensureInit()` memoizes `BleClient.initialize({androidNeverForLocation:true})`.
  iOS `initialize()` **replaces** the CBCentralManager and drops every live gun. **A "rescan" button must not re-init.**
- **Connect-with-retry.** BRX establishment succeeds ~1 in 3; retry with a guard closure. `deviceId` is
  committed **only on a successful connect** so arming can't enable for an unconnected gun. **While ARMED or
  LIVE the reconnect loop is unbounded with backoff** (500 ms → 10 s cap, jitter). The interactive
  (IDLE→CONNECTED) behaviour stays 5–6 attempts where the user is the loop.
- **Continuous low-latency scan picker.** `requestLEScan({allowDuplicates:true, scanMode:2})` + our own
  in-app list, showing name + **tail** + **RSSI** (closest = in your hand). Enrolled guns advertise
  `<$NAME>-<tail>` → unambiguous. The same scan carries the utility beacons (utility.md §6).
- **Hardened reassembler.** `pump()` splits on both `*` and `$` boundaries to survive merged notifications
  (`$ALCD,..$BUT,0,1,*`). The fake gun must reproduce the full bench-captured frame traffic (other slots' clip
  caps included) or the HUD passes tests it fails on real guns.
- **20-byte chunking + pacing.** `sendFrame` writes 20-byte chunks with `writeWithoutResponse` + 8 ms
  inter-chunk / 18 ms inter-frame sleeps; a per-device write queue serializes writes.
- **`androidNeverForLocation`** in `initialize()` **and** the `neverForLocation` manifest flag (via
  `app/scripts/android-setup.sh`). iOS needs `NSBluetoothAlwaysUsageDescription` (via `ios-setup.sh`).
- **Auto-reconnect** on `onDrop` with the same retry loop, guarded by `me.deviceId` — followed by the **§3.10
  reconcile / head re-write**.
- **Before a bundle exists the node sends only the pre-config probe set** (§3.1) — nothing else, ever.
- **Network gates are contracts §5c**, not this module's: the node only *reports* their state in `preflight`.

---

## 8. Cross-platform notes

- **`deviceId` is opaque.** Android → MAC, iOS → per-device CoreBluetooth UUID. **Never persist it and expect
  meaning on another phone/OS** (contracts §1). Binding to MC uses the **gun tail/name**, not the deviceId.
- **Scan labels:** the tail suffix is real on Android; on iOS it is derived from the UUID and only locally stable.
- **Blackout works on both** — pure CSS/brightness. Keep-awake, brightness, haptics, foreground-service/
  background-mode (§3.11), advertising (utility.md §6) and share all go through Capacitor plugins.
- The **node** stays Capacitor (Android + iOS) — one web UI/engine, native BLE. Web Bluetooth is **ruled out**
  (ADR-0003).
- iOS deployment target 15.0; iPhone X (16.7) supported. Generated `ios/`/`android/` are rebuilt —
  platform settings live in `app/scripts/*-setup.sh`, never hand-edited in Xcode/Studio.

---

## 10. Open questions (still open on 2026-09-06; closed ones are in git history)

- **Q2 — the third pool on the wire (`$HIR` from a station).** With scanner respawn built over BLE adverts
  (utility.md §4), the remaining question is whether a grenade/IR station beacon (`$HIR` tok2 = 15) should also
  be a presence source (FOLLOWUPS B23).
- **Q3 — dmg accounting.** `hit_taken.dmg` = hp+armor delta; a single `$HIR` spanning two pools is one
  `hit_taken` with the summed delta. ⚠ **Superseded in part by Q12:** the definition is blind to the shield pool.
- **Q4 — `$VOLTS` token map.** Seed reads token 3 as pack %; the lab log leans token 4 = cell-voltage
  SoC. A controlled discharge sweep settles which token the HUD/readiness shows.
- **Q5 — cached-context rejoin (§3.7).** How much of a prior game may a power-cycled phone re-arm from
  cache without MC in range before it's unsafe/stale? `CONFIG_TTL_MS` + a "stale config" HUD warning.
- **Q6 — keep-awake vs. battery.** Full brightness + keep-awake + continuous BLE + beacon scanning drains the
  phone over a long event. Measure; consider dimming only the non-STATE zones between firefights.
- **Q7 — side-effect-free gun state probe.** Does anything short of `$SPAWN` make the gun report `$LCD`
  (HP/armor/ammo + "configured")? Less pressing since S7.1 restores pools from persistence; still the only way
  to catch a gap-death (§3.10 known limitation).
- **Q10 — iOS queued BLE notifications on resume.** With `bluetooth-central` background mode, are
  notifications received while the JS was frozen delivered on resume, or dropped?
- **Q12 — the third pool (2026-08-26, blocking any shield-granting station).** The wire has three pools; the
  engine now stores `shield` but `status` does not carry it, the HUD does not show it, and `hit_taken` is
  defined as "a `$HIR` that drops hp+armor", so a hit a shield fully absorbs produces **no event** (no assist
  attribution, nothing in the outbox). It fails *open*, which is why nothing has surfaced. **Decision needed:**
  (a) add `shield` to `status`; (b) redefine `hit_taken.dmg` as the **total** pool delta including shields, so a
  hit that landed always produces an event — and specifically *include* the shield delta rather than emitting
  `dmg: 0`, because a zero invites `if dmg:` guards downstream to drop the event again. The IR bench's
  recommendation, and this spec's author's, is **both**.
