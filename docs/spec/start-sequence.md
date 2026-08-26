# M-START — the dispersed, time-synced match start (and its symmetric timed end)

- **Status:** Draft at contracts **A6** (Wave 2 module; layers on M-NODE + M-NET). Owner: M-START lane.
- **Binds to:** `contracts.md` §3 (`FrameBundle`), §5 (`start` message, `welcome` re-hydration), §6
  (lifecycle `ARMED`), **§7 (clock sync — this module's spine)**, §8 (frame contract), §9 A4/A5. Phase 5 of
  `README.md` §3.
- **Ground truth referenced, not restated:** arm/go-live frame order `protocol/brx-protocol.md` §7e;
  `$PLAY` two-slot semantics §7o; sound ids `mcp/brx_mcp/sounds.py` + `callsign-extract/sound-bank.md`
  (MC-side truth — the node only ever sees ids via `frames.cues`); audio ownership
  `docs/sound-architecture.md` (Cut 1B — host-triggered `$PLAY` on a rule).

The problem this solves: you cannot keep every player in Wi-Fi range at T-0 — on a large park most nodes
are out of range for most of the match (contracts A4.8). Teams want to **walk to their bases first, then
get a countdown**. So we never send a "go" signal at T-0 and never an "end" signal at T-end. Instead MC
hands every node a **`match_id` + wall-clock go-live time** while everyone is still in the lobby, and each
node — dispersed and offline — counts itself down on its **own synced clock**, spawns its gun, plays the
countdown **through the gun speaker**, and later ends its own match at `go_live_t + time_limit_s`. No LAN,
no signal, no MC at either moment of truth.

---

## 1. Core mechanism

1. **Lobby (in range).** The lobby `config` push (contracts §5) delivered `GameConfig` + this player's
   `FrameBundle`, and the node wrote **`frames.head`** — silent by construction: **no `$SPAWN`, no
   `$PLAY,VA81`** (A4.2; the countdown sound lives in the choreography below, not in the head). The gun is
   configured but **unspawned**; the node replied `ack_config{gun_echo}`.
2. **Schedule.** Host picks a go-live moment. MC mints a **`match_id`**, computes `go_live_t` (a synced
   wall-clock Unix-ms instant, §7) and broadcasts `start { match_id, go_live_t, config_id, seq, countdown_s }`
   (contracts §5) to every lobby node.
3. **Arm the schedule locally.** Each node calls `startAt(match_id, go_live_t, config_id, seq, countdown_s)`
   (§7). It verifies it holds that `config_id` (config + bundle) and is freshly synced (§4), enters lifecycle
   **`ARMED(countdown)`** (§6), and **persists `{match_id, go_live_t, config_id, seq, offset}`** to local
   storage. **From `startAt()` on, every persisted event the node emits carries `match_id`** (A4.3). From
   here the node needs nothing from anyone.
4. **Disperse.** Players walk to bases and leave Wi-Fi range. The WS drops; that is expected and fine —
   `start` is best-effort and the schedule is already local (contracts §5 store-and-forward semantics).
5. **Local countdown.** Each node ticks on `synced_now()` and drives the gun-speaker choreography (§2)
   off its own clock. Because every node shares the same `go_live_t` and the same offset-corrected clock,
   the countdowns are aligned across the field to within the drift budget (§4) — no coordination needed.
6. **T-0: self-spawn.** At `synced_now() >= go_live_t` the node writes **`frames.spawn`** (§3) to take the
   gun live and plays "GO". The gun is now in play; the node's autonomous engine (M-NODE) owns it from here.
   `ARMED → LIVE`.
7. **Rejoin.** As players wander into a coverage zone mid-match the WS reconnects and store-and-forward
   flushes queued events; the start itself required no reconnection.
8. **T-end: the symmetric timed end.** At `synced_now() >= go_live_t + time_limit_s·1000` the node writes
   **`frames.end`**, plays **`cues.game_over`** (if present), and returns to **KITTED** — gun + player retained,
   a rematch is a new `config` push (node.md §3.9; contracts §6, A5.9). **This is the ONLY end condition that
   reaches a dispersed node** (A4.8) — which is why `time_limit_s` is required. Frag-limit / survival /
   objective ends are coverage-zone conveniences that MC broadcasts as `control{end}`; a node that never hears
   them still stops on time. `time_limit_s == null` is legal only for a fully-covered venue (contracts §3):
   then there is **no local end** and the match ends only on `control{end}`/`recall`.

---

## 2. Audio choreography (gun-speaker, host-on-a-rule → local)

All of this is played **by the node onto its own gun over BLE** as its local clock crosses each mark —
it is `sound-architecture.md` Cut 1B (`$PLAY` on a rule), except the "host" computing the rule is the
node's own countdown timer, not MC. **Volume 69** was baked into `frames.head` (house rule; 30 is
inaudible). The node writes **`frames.cues` frames verbatim** — they arrive pre-composed by the compiler (contracts A6.3: slot placement is the compiler's job); the node carries no sound id and no `$PLAY` template of its own; `sounds.py` is the MC-side source that fills `cues`.

**Default runway = `DEFAULT_RUNWAY_S` (120 s, "walk time"; host-set, §6).**

| Mark | Cue | Frame (illustrative) | `cues` key / confidence |
|---|---|---|---|
| T-30s | voice "thirty seconds — get to your base" | `$PLAY,,4,6,<cues.runway_30>,,,,*` | `runway_30` — **PROVISIONAL** (pick from VA voice range by ear) |
| T-20s | voice "twenty seconds" | `$PLAY,,4,6,<cues.runway_20>,,,,*` | `runway_20` — PROVISIONAL |
| T-10s | voice "ten seconds — weapons hot" | `$PLAY,,4,6,<cues.runway_10>,,,,*` | `runway_10` — PROVISIONAL (VH "weapons hot" `VHT` is a candidate) |
| T-9 … T-4 | one short beep per second (tick) | `$PLAY,<cues.tick>,,,,,,,*` (the contracts §3 template's **token-1-only** form) | `tick` — **PROVISIONAL** (`U16`, 0.43 s, is a real bank id — safe to emit; its "tick" *meaning* is unconfirmed) |
| T-3 → T-0 | **"3 … 2 … 1 … GO"** spawn countdown | `$PLAY,<cues.countdown>,4,6,,,,,*` | `countdown` = **`VA81` CONFIRMED** (2.97 s) — the native arena spawn countdown; its "GO" lands on T-0 |
| **T-0** | **spawn + klaxon + green flash** | `frames.spawn` (§3), then `$SFLASH,*` + `$PLAY,<cues.klaxon>,4,6,,,,,*` | `$SFLASH` CONFIRMED as a command (§7o); `klaxon` PROVISIONAL |
| **T-end** | **game over** | `frames.end`, then `$PLAY,,4,6,<cues.game_over>,,,,*` | `game_over` — Callsign ends with `$PLAY,VSF,4,6,JAY` (§7o); id PROVISIONAL until pinned (A5.10) |

Design notes:
- **`cues.countdown` (`VA81`) is the anchor.** Fire it at **T-3s** so its built-in "GO" coincides with the
  spawn. Everything before T-3 is runway dressing (voice + ticks) so the moment *feels* like a real match
  start rather than a bare beep.
- **Missing cues are skipped, not guessed.** `cues` keys other than `countdown` and `kill` are optional
  (contracts §3); a node with no `tick`/`klaxon`/`runway_*`/`game_over` simply plays `VA81` at T-3 + the spawn
  and ends silently. That is the minimum viable start and it is fully confirmed hardware.
- **Short runway is legit.** A host who set a 10 s countdown gets ticks + `VA81`. Never schedule two long
  voice clips closer than their durations (the compiler knows the bank lengths; the node trusts the cue set).
- **Provisional ids are safe to ship** — every id MC puts in `cues` is a real bank id (asserted by
  `test_sounds.py`), so the worst case is "plays *a* clip, not the ideal one." Pinning the runway lines and
  klaxon by ear is a `verification-checklist` task; add them to `sounds.py` as new `Cue`s when confirmed.
- **Do not reuse `GAME_OVER`/`VA33`** or the `V101–V144` objective callouts here — those carry match-end /
  objective meaning elsewhere; a distinct start palette keeps the audio language unambiguous.

---

## 3. The go-live burst (T-0)

The node does **not** re-push config at T-0 — that happened at lobby. It writes **`frames.spawn` verbatim**
(compiled by M-MODES in MC, contracts A4.2 — nodes never invent frames), then its own `$SFLASH,*`:

```
$PLAYX,0,*                 # frames.spawn[0]: clear any lingering countdown playback
$SPAWN,,*                  # <-- GO LIVE (empty token matters; §7e)
$AMMO,0,<mag>,<reserve>,1,*   # load magazines (per loadout slot)
$AMMO,1,<mag>,<reserve>,1,*
$BMAP,0,0,,,,,*            # re-map trigger AFTER spawn (mandatory; §7e)
$SFLASH,*                  # node's own template: "you are live" (PROVISIONAL as a spawn cue — $SFLASH is
                           #   confirmed only as the kill-confirm flash §7o; repurposing it is no-arg/low-risk but unverified)
```

- The gun echoes `$LCD`/`$ALCD` (HP/armor/mag) confirming live; the node's engine begins its own-gun loop
  and stamps `match_id` on everything.
- If the node's runway was shorter than the `VA81` clip (e.g. a degraded late arm, §4), skip the separate
  T-3 cue and play `cues.countdown` immediately before `frames.spawn` — the whole countdown-into-spawn.
- **Never spawn a gun that may already be live.** Before *any* `frames.spawn` that is not the scheduled T-0
  write on an ARMED node — a reconnect, relaunch, resume or hot-swap (E1/E5/E9) — the node first runs the
  M-NODE §3.10 **observe step** (contracts A5.3): a `$ALCD` decrement = alive + configured (do nothing);
  `$BUT` without `$ALCD` = dead (DOWN, respawn timer, no spawn); an `$HP`/`$LCD` line = trust it; silence for
  `RESYNC_PROBE_S` = unconfigured → re-write `frames.head` then `frames.spawn`. A spawn on a live gun is a
  free heal and an erased death — it is never written blind.
- **Panic remains `frames.panic`** (`$CLEAR,*` then `$SP,99,*`, house rule) — the host's emergency stop, not
  part of any abort/recall path (§5 E7).
- **⚠ PENDING HARDWARE TEST — hold-across-disperse.** The confirmed live arm (`protocol/brx-protocol.md`
  §7e) writes `$START`→config→`$SPAWN` **within seconds on one held link**. M-START instead holds the gun
  in `$START`+config-but-**UNSPAWNED** across the walk-to-base (**minutes**) and only fires the T-0 `$SPAWN`
  at the end. That long-hold-then-spawn path is **bench-verified for a ~2-min hold** (2026-08-25, protocol §7r: `$SPAWN`
  after the hold went live with `$LCD,45,70,…` and full ammo); the 5-min run is still owed (checklist NEXT 1).
  The head write is **silent** (no voice, no cock — those belong to `$SPAWN`), so the T-10 re-write costs nothing audible. **Fallback if config is lost: the node re-writes
  `frames.head` at T-10 s** — it holds the whole bundle locally, the write takes ~3 s over BLE, and it
  needs no LAN. This is cheap enough that it may become the **default** regardless of the bench outcome
  (it also covers a gun that was power-cycled during the walk, E1); the only cost is the `$START`
  re-issue, whose side effects at T-10 must be observed in the same bench session. **Legality:** the head
  starts with `$CLEAR`, so the T-10 re-write is allowed only when the gun is provably **unspawned** — the
  node is ARMED with no `$LCD,45,70`/`$ALCD` seen since the head, or the §3.10 observe step said
  "unconfigured". Never on a spawned gun.

---

## 4. Clock-sync dependency (the whole thing rests on §7)

`synced_now() = local_now() + offset`, with `offset` the smoothed NTP-lite estimate from the
`time_req`/`time_res` handshake (contracts §7). M-START's correctness = every dispersed node agreeing on
`go_live_t` (and `go_live_t + time_limit_s`) within tolerance.

- **Gate ready-up on a fresh sync.** A node may not report `ready:true` (and MC will not let it into the
  countdown) unless its **last successful sync is fresher than `SYNC_FRESH_MS`** (contracts §9, 10 000 ms)
  and it has **≥3 handshake samples** (so `offset` is smoothed, not a single noisy RTT). The node re-pings
  `time_req` on entering LOBBY and just before it acknowledges `start`. This guarantees the offset is fresh
  *while still in range*, right before the player walks out of range. The node reports the outcome as
  `status.synced` (contracts §4).
- **Drift budget.** Phone RTC drift is ≪1 s over a typical match (contracts §7). Budget: a node armed with a
  <10 s-old sync should fire within **±250 ms** of the field consensus — imperceptible for a countdown.
  "Close enough" = **±0.5 s**; beyond that the start feels ragged. The lobby re-sync is the **guarantee**; a
  node that happens to be in a coverage zone mid-disperse also re-syncs opportunistically (net.md §7's
  periodic `time_req` fires only when connected). No mid-disperse sync is needed within a normal 5–20 min
  match — the same budget covers the timed end.
- **A node that never synced** (no samples, or stale beyond `SYNC_FRESH_MS`): it is **blocked from ready-up**
  and shown red on MC's board (§6). If it somehow receives `start` unsynced (edge: synced then went stale
  before arm), it falls back to **degraded counting** — treat `go_live_t` as `receipt_now + remaining` using
  its *uncorrected* local clock from the instant it got `start`, and **log it** (contracts §7 degraded path;
  `status.synced=false`, so MC scores its events on `t_recv`, contracts A4.7). Degraded nodes may fire
  seconds off; MC flags them `unsynced` in the per-node status.

---

## 5. Edge cases (the hard part)

**E1 — Power-cycle after dispersing, out of range.** Player reboots phone and/or gun at their base; RAM
schedule is gone and there's no LAN to re-fetch it. **Primary mitigation: the node persists
`{match_id, go_live_t, config_id, seq, offset}` at `startAt()` — alongside the `GameConfig` and the whole
`FrameBundle` it already stored at the lobby push** (step 3). On relaunch the node reads it back,
re-verifies `synced_now()` (RTC survives reboot so a recent offset is still valid for the minutes involved),
and **resumes the countdown from where the clock now is** — if `go_live_t` is still future, it re-enters
`ARMED` and continues; if already passed, see E5. The gun keeps its config across a *BLE* reconnect (bench-verified §7r) but a **power-cycle wipes it** —
the tell is a `$SPAWN` that echoes `$LCD,0,0,0,0,0,0`; if the **gun** was power-cycled the node follows the M-NODE §3.10 **observe-before-write** policy (contracts A5.3): observe for
`RESYNC_PROBE_S`; only if the gun is silent (unconfigured) **re-write `frames.head`, then `frames.spawn`**
(immediately if T-0 has passed, else at T-0); a gun that answers `$ALCD`/`$HP` is left alone. This is why the
node caches the full bundle, not just the go-live time.

**E2 — Late-join at a base still in range.** A straggler arrives at a base inside a coverage zone (or the
host walks MC to them). Node reconnects; **`welcome.node.start` re-hydrates the schedule automatically**
(contracts A4.5) — no host action, no explicit re-send. If `go_live_t` is still future, normal path. This is
the graceful "someone was late leaving the lobby" case.

**E3 — Grace re-arm.** Host can re-broadcast the *same* `start` at any time — **same `seq`, same
`match_id`**, same `config_id`/`go_live_t` (contracts A5.6); a node already armed to that `seq` treats it as
a no-op, a node that lost it re-arms. Cheap, safe, and the manual fallback on MC's board ("re-push start") for
a node whose `welcome` re-hydration somehow didn't take. A re-push never mints a new `match_id`; only a
**reschedule** (E8) does.

**E4 — A player who never synced / never got start.** Blocked at ready-up (§4) so ideally never reaches
dispersal. If it happens anyway (host overrode), the node has no schedule: it sits in LOBBY, shows
"NOT ARMED" locally and red on MC. Recovery is E2/E3 once in coverage, or **degraded fallback** (§4) if the
host force-starts it from receipt.

**E5 — Time already passed when a node (re)connects/reboots/resumes.** `synced_now() > go_live_t` at the
moment the node learns/recovers the schedule. Rules by how late:
  - **Within `LATE_ARM_GRACE_MS` (contracts §9, 8 000 ms):** spawn **immediately** — write `frames.spawn`
    now, skip the runway, play only `cues.countdown` + `$SFLASH` so the player still gets a "GO." They join
    a few seconds behind; acceptable.
  - **Beyond grace but match still live (`go_live_t < now < go_live_t + time_limit`):** **hot-join** — spawn
    immediately, no countdown, brief "in play" cue; the node stamps **`match_id`** on everything from the
    spawn on (A4.3) and MC marks the player joined-late. The match clock is the shared
    `go_live_t + time_limit`, so a late spawn just means less playtime, computed the same everywhere.
  - **Match already over:** do not spawn; node shows "match ended" and returns to KITTED; MC shows the
    player as DNP.
  - **In every branch the spawn is gated by the observe step** (§3, node.md §3.10): if the gun is *already*
    live — a hot-swapped phone on a gun that never stopped, a relaunch after a BLE blip — nothing is written;
    the node just adopts LIVE and, for a swapped phone, its `welcome.node.score` (deaths etc.).

**E6 — A player who starts late (slow to a base).** Not special — their gun still spawns at `go_live_t` on
their own clock wherever they are. They may be caught in the open; that's a gameplay consequence, not a
system fault. (Design choice: we start *on time*, not *on arrival*. A host who wants arrival-gated starts
uses a longer runway.)

**E7 — Abort / reschedule.** Host abort sends **`control{cmd:"abort_start", seq}`** (contracts §5), where
`seq` references the `start.seq` being cancelled. A node in coverage whose current schedule matches that
`seq`:
  - **before T-0 (ARMED):** cancels the countdown, `ARMED → LOBBY` — the gun still holds `frames.head`,
    nothing to undo;
  - **after T-0 (already LIVE for that `seq`):** behaves exactly as **`recall`** — writes `frames.end`, plays
    `cues.game_over`, → **KITTED** (contracts A5.9). **No panic**: `frames.panic` is the host's emergency
    stop, never an abort path.
(`recall` is the distinct "stop a live/armed game" control → KITTED; `abort_start` only differs while the
schedule is still pending; §6.)

> **Host-facing rule, shown on the Start screen: "Reschedule further out BEFORE the walk. Once players
> disperse, an abort reaches only the nodes in coverage."** Out-of-range nodes cannot hear an abort — the
> fundamental limit of a no-signal start. Mitigations: (a) keep the runway long enough that most aborts land
> while nodes are still in range; (b) reschedule by issuing a **new `go_live_t` further out** *before* the
> old one fires, which supersedes it on any node that reconnects; (c) if an out-of-range node does fire on an
> aborted start, its gun simply goes live alone, **ends on its own timer** (`go_live_t + time_limit_s`), and
> MC parks its events under the abandoned `match_id` on reconnect (A4.3) — nothing pollutes the real match;
> if it reaches coverage while still LIVE, MC's `recall` ends it early.

**E8 — Duplicate/superseding schedules.** A node keeps only the **latest** `start` by its MC-stamped
monotonic schedule `seq` (contracts §5, A5.6). A **reschedule** = higher `seq` **and** a new `match_id`, and
supersedes; a re-broadcast (E3) = same `seq` + same `match_id` = no-op. There is no third case.

**E9 — App backgrounded / phone locked across T-0** (node.md §3.11). The engine is JS; when the app is
backgrounded or the screen locks, its timers stop and T-0 is missed. The phone is required to be mounted and
foreground (README §7, A4.11) — this is the *recovery*, not the plan. On resume the node reconciles against
`synced_now()`: if `go_live_t` is still future → continue the countdown from wherever the clock is; if
`synced_now() ≥ go_live_t` → run the **observe step first** (§3 — the gun may well have been spawned before
the lock and be live and healthy), then the **E5 rules** (grace spawn / hot-join / match over) only if it is
unconfigured. The persisted schedule (E1) makes resume and relaunch the same code path (`resumeSchedule()`, §7).
Log it (`resumed_late`) so recap can show why a player joined late.

**E10 — Timed end while offline.** At `go_live_t + time_limit_s` a dispersed node writes `frames.end`, plays
`cues.game_over`, and returns to **KITTED** on its own (step 8; node.md §3.9). MC learns of it at the node's
next sync (status `arm_state=kitted`, plus the flushed events). A `control{end}` that arrives later — or
earlier, in a coverage zone — is **idempotent** with the local end: whichever fires first tears down, the
other is a no-op. `control{recall}` behaves the same. An untimed game (`time_limit_s == null`) is legal only
for a fully-covered venue and then has no local end (contracts §3).

**E11 — Late joiner mid-match** (contracts A5.6). A player who arrives after `start` went out: MC `assign`s
them → `config` (node writes `frames.head`, LOBBY) → MC re-pushes the **same** `start` (same `seq`, same
`match_id`) → the node's `startAt()` sees `synced_now() > go_live_t` and hot-joins per E5, stamping
`match_id` from the spawn on. The lobby's "every node acked" start gate does **not** apply to a late joiner —
it gates the initial broadcast only.

---

## 6. Host controls & MC display

Host controls (MC start panel, phase 5):
- **Schedule start** — host sets the **runway = walk time** (presets 60/120/180 s, default
  `DEFAULT_RUNWAY_S = 120`, contracts §9 — 30 s is a backyard number, not a park's) and hits Start; MC mints
  `match_id`, computes `go_live_t = server synced now + runway`, broadcasts `start` to all lobby nodes.
- **Abort** — best-effort `control{cmd:"abort_start", seq}` (E7). (Distinct from `recall`, which stops a
  live game.) There is no `pause` (contracts A4.6).
- **Reschedule** — issue a new `go_live_t` (**new `seq`, new `match_id`**); supersedes the old (E8). Offered as
  the safe alternative to abort, and the default suggestion while nodes are still in range.
- **Re-push start** — idempotent re-broadcast (E3: **same `seq`, same `match_id`**), the manual fix for a node
  showing not-armed and the path for a late joiner (E11).

MC per-node display (fed by node `status`, §7):
- Header: the current **`match_id`**, `go_live_t` as local time, runway, and the **coverage hint** — at
  schedule time MC lists which nodes are **in range now** (heartbeat fresh) vs **already out**, and warns:
  "N nodes are out of coverage — an abort will not reach them; reschedule instead."
- Board of nodes with, per node: **sync freshness** (green <10 s / amber / red never-synced), **armed state**
  (`LOBBY` / `ARMED T-minus MM:SS` counting on MC's own synced clock as a mirror / `LIVE` / `unsynced`
  degraded / `late-join` / `ended` = back in KITTED), last-seen staleness age, and battery. "All armed & synced" is the green
  light to let the countdown ride. MC's T-minus is a *display mirror*; the authoritative countdown is each
  node's.
- Because armed nodes disperse, MC shows **last-known** armed state with a staleness age (contracts §5 —
  stale, not gone); a node that armed then walked away reads "ARMED T-… (last seen 40 s ago)," which is
  expected, not an error. The same applies at the timed end: MC's own clock says the match is over; each
  node's `ended` state arrives when it next syncs.

---

## 7. Interface

**On the node (M-START API, consumed by M-NODE):**
```ts
startAt(match_id: string, go_live_t: number, config_id: string, seq: number, countdown_s: number): ArmResult
// Preconditions: node holds config_id (GameConfig + FrameBundle from the `config` push or `welcome`
//   re-hydration, contracts §5) and is fresh-synced (§4). Frames are NOT startAt arguments — the bundle
//   is already local; startAt only schedules the spawn (and, via time_limit_s, the end).
// Args: match_id (MC-minted, stamped on every persisted event from now on), go_live_t (synced wall-clock
//   T-0), config_id (staleness key it must already hold), seq (MC-stamped schedule counter — supersede/
//   abort ordering, E8), countdown_s (runway length, §2).
// Effect: verify → persist {match_id, go_live_t, config_id, seq, offset} → enter ARMED(countdown) →
//         run the §2 choreography off synced_now() → at T-0 write frames.spawn (§3) → LIVE →
//         at go_live_t + time_limit_s write frames.end + cues.game_over → KITTED (E10).
//         Same seq already held → no-op (E3). Past go_live_t → E5 (observe step first, §3).
// Returns: { ok, state, reason? }  (reason: "stale_config" | "unsynced" | "match_over" | ...)

cancelStart(reason): void   // abort_start (E7): before T-0 → stop countdown → LOBBY; already LIVE → recall semantics:
                            //   frames.end + cues.game_over → KITTED. Never panics.
resumeSchedule(): void      // on app relaunch/resume/BLE reconnect (E1/E9): reload the persisted schedule, run the
                            //   node.md §3.10 observe step, then reconcile vs synced_now() — spawn only if unconfigured.
armState(): { state, match_id?, go_live_t?, t_minus_ms?, synced: boolean, degraded: boolean }  // for the status heartbeat
```

**On the wire (contracts §5, A4):**
- MC → node: `start { match_id, go_live_t, config_id, seq, countdown_s }` — `seq` is the MC-stamped
  monotonic schedule counter (supersede ordering, E8); `countdown_s` is the runway length for the node's §2
  choreography/display; `match_id` is stamped on every persisted event thereafter.
- MC → node: `welcome { …, node: { …, start?, match_id? } }` — re-hydrates a pending schedule on reconnect
  (E2), so the node calls `startAt()` itself from `welcome`.
- MC → node: **abort via `control{cmd:"abort_start", seq}`** (E7), where `seq` names the schedule to cancel —
  **not** a field on `start`; a reschedule is a new `start` (new `seq` + `match_id`). (`recall`/`end` stop a
  live game → KITTED; an `abort_start` that reaches an already-LIVE node is the same thing; §6.)
- node → MC: armed/countdown status rides the periodic `status` message (contracts §4), which carries
  `arm_state` + `t_minus_ms` + `synced` (+ `match_id?`). No new message type required.

---

## 8. Task breakdown

1. **Sync gate** — implement `SYNC_FRESH_MS`/sample-count gate on ready-up; persist smoothed `offset`;
   report `status.synced`.
2. **`startAt()` + `ARMED` state** — schedule persistence (`match_id`, `go_live_t`, `config_id`, `seq`,
   `offset`), countdown ticker on `synced_now()`, transition to `LIVE` at T-0; `resumeSchedule()` on
   relaunch, app resume **and BLE reconnect** (E1/E5/E9 share one reconcile path that runs the §3.10 observe
   step before any spawn); same-`seq` re-push = no-op, higher `seq` = supersede (E3/E8/E11).
3. **`match_id` stamping** — from `startAt()` on, every persisted event (`hit_taken`/`death`/`respawn`) and
   `status` carries `match_id`; hot-join (E5) stamps from the spawn on.
4. **Choreography engine** — the §2 mark table driven off the local clock, ids **only from `frames.cues`**,
   optional cues skipped; guard against overlapping long clips; the node's single `$PLAY` template.
5. **Go-live burst** — write `frames.spawn` verbatim + `$SFLASH` (§3); the **T-10 s `frames.head`
   re-write** as a switchable option, legal only on a provably unspawned gun (default decided by bench item
   11); gun-was-power-cycled path (E1) behind the observe step.
6. **Timed end** — at `go_live_t + time_limit_s` write `frames.end` + `cues.game_over` → KITTED; idempotent
   with `control{end}`/`recall` (E10); no local end when `time_limit_s == null` (full-coverage venues only).
7. **Late/degraded/abort paths** — grace spawn, hot-join (E5, observe-gated), late joiner (E11), unsynced
   fallback, DNP (E4); `abort_start` → LOBBY before T-0, recall semantics (`frames.end` → KITTED) after (E7).
8. **MC start panel + board** — schedule (mints `match_id`; runway default `DEFAULT_RUNWAY_S`)/abort/
   reschedule (new `seq`+`match_id`)/re-push (same both); coverage hint at schedule time; per-node
   armed/sync/`ended` display (§6).
9. **Sound verification** — pin the runway lines + klaxon by ear; **confirm the `U16` countdown-tick
   meaning**; add as `Cue`s in `sounds.py` so the compiler fills `cues`; keep `test_sounds.py` green.
10. **Mock-clock edge-case test harness** — a deterministic clock injectable for `synced_now()` (advance /
    jump / drift / reset offset) so E1–E10 are unit-testable without hardware: **E1** persist→relaunch→resume
    (and gun-power-cycle re-write behind the observe step), **E2** re-hydration via `welcome`, **E3**
    idempotent re-arm (same `seq` = no-op), **E5** grace-spawn / hot-join / match-ended by clock position
    (+ "gun already live → no spawn"), **E7** `abort_start` before vs after T-0 (LOBBY vs recall→KITTED),
    **E8** supersede by higher `seq` + new `match_id`, **E9** resume-across-T-0, **E10** local end idempotent
    with a late/early `control{end}`, **E11** late joiner, and the §4 degraded/unsynced fallback. Assert
    transitions against the contracts §6 lifecycle.
11. **⚠ Bench: hold-across-disperse (pending hardware).** Write `frames.head`, leave the gun UNSPAWNED for
    5+ minutes, then write `frames.spawn` — does it go live with the config intact? In the same session,
    test the **T-10 `frames.head` re-write** on a still-configured gun (does the `$START`/`$CLEAR` re-issue
    have audible/visible side effects?) and on a power-cycled gun. **Also: is `$START` in the head audible at
    the lobby write itself?** (A5.11 — UNVERIFIED; tonight's bench wrote heads with no reported sound but
    nobody was listening for it.) Outcome decides task 5's default. Log to `docs/experiment-log.md`.

## 9. Open questions

- ~~**Default runway length?**~~ **DECIDED (A5.10):** `DEFAULT_RUNWAY_S = 120`, host-set per match (presets 60/120/180); it is walk time, not a countdown.
- **Klaxon id** and the three runway voice lines — by-ear pin (task 9). Until then, `cues` ships them
  absent and the node skips them.
- **T-10 `frames.head` re-write: default or fallback?** Depends on the hold-across-disperse bench (task 11).
  If the gun holds config for minutes, the re-write is insurance only; if not, it is the mechanism.
- **Persisted-offset validity after a long-parked reboot** — is an offset from >X minutes ago still trustworthy
  for a same-match rejoin, or must E1 force a fresh sync if any LAN is reachable? Propose: trust for the match
  duration; force-resync opportunistically whenever back in coverage.
- **Should MC hard-block force-starting an unsynced node,** or allow it with a loud "degraded, may fire off"
  warning? Propose: allow with warning (host's field call), always logged.
- **`$SFLASH` as a spawn cue** — confirmed only as the kill-confirm flash; verify it is harmless at spawn or
  drop it from §3.
