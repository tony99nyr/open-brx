# M-START — the dispersed, time-synced match start (and its symmetric timed end)

- **Status:** built (`app/src/engine.js` `startAt` / `resumeSchedule`; MC `POST /api/start`, `/reschedule`, `/abort`
  in `mcp/brx_mcp/mc/API.md`). Binds to `contracts.md` §3 (`FrameBundle`), §5 (`start`, `welcome`), §6 (lifecycle),
  **§7 (clock sync — this module's spine)**. Phase 5 of `README.md` §3. The original host-controls / interface /
  task sections are archived at `docs/archive/spec-start-sequence-tasks.md` (2026-09-06).
- **Ground truth referenced, not restated:** arm/go-live frame order `protocol/session-findings-2026-08.md` §7e; `$PLAY` two-slot
  semantics §7o; sound ids `mcp/brx_mcp/mc/compile.py` (`cues`) + `callsign-extract/sound-bank.md`.

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
   `$PLAY,VA81`** (A4.2), and the head write itself is silent on the gun (bench 2026-08-25, protocol §7r). The
   gun is configured but **unspawned**; the node replied `ack_config{gun_echo}`.
2. **Schedule.** Host picks a go-live moment. MC mints a **`match_id`**, computes `go_live_t` (a synced
   wall-clock Unix-ms instant, §7) and broadcasts `start { match_id, go_live_t, config_id, seq, countdown_s }`
   (contracts §5) to every lobby node.
3. **Arm the schedule locally.** Each node calls `startAt(match_id, go_live_t, config_id, seq, countdown_s)`.
   It verifies it holds that `config_id` (config + bundle) and is freshly synced (§4), enters lifecycle
   **`ARMED(countdown)`**, and **persists `{match_id, go_live_t, config_id, seq, offset}`** to local
   storage. **From `startAt()` on, every persisted event the node emits carries `match_id`** (A4.3). From
   here the node needs nothing from anyone.
4. **Disperse.** Players walk to bases and leave Wi-Fi range. The WS drops; that is expected and fine —
   `start` is best-effort and the schedule is already local (contracts §5a).
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

All of this is played **by the node onto its own gun over BLE** as its local clock crosses each mark. The
"host" computing the rule is the node's own countdown timer, not MC. Volume was baked into `frames.head`
by the compiler (`compile.play_volume()`: 80 indoors / 90 outdoors). The node writes **`frames.cues` frames
verbatim** — they arrive pre-composed (contracts A6.3); the node carries no sound id and no `$PLAY` template
of its own. A `$PLAY` needs tokens 2-3 = `4,6` to be audible; the empty-token form is silent (bench
2026-08-25), so every cue below is the full `4,6` form.

**Default runway = `DEFAULT_RUNWAY_S` (120 s, "walk time"; host-set, presets 60/120/180).**

What `compile.py` ships today (`compile.py:663-669`, 2026-09-06):

| Mark | Cue | `cues` key | shipped value / status |
|---|---|---|---|
| T-30s | voice "thirty seconds" | `runway_30` | **`""` — SILENT** (VA85 at 30, 20 and 10 stacked the same counting track, bench 2026-08-25; distinct lines still to pin by ear) |
| T-20s | voice "twenty seconds" | `runway_20` | **`""` — SILENT** (same) |
| T-10s | voice "ten seconds" | `runway_10` | `$PLAY,,4,6,VA85,,,,*` — provisional |
| T-9 … T-4 | one short beep per second | `tick` | `$PLAY,U16,4,6,,,,,*` — provisional id (a real bank id; its "tick" meaning unconfirmed) |
| T-3 → T-0 | **"3 … 2 … 1 … GO"** | `countdown` | `$PLAY,VA81,4,6,,,,,*` — **CONFIRMED** (2.97 s; the native arena spawn countdown; "GO" lands on T-0) |
| **T-0** | **spawn + klaxon + green flash** | `frames.spawn` (§3), then `$SFLASH,*` + `klaxon` | `$SFLASH` confirmed as a command (§7o); `klaxon` = `$PLAY,U16,4,6,,,,,*` provisional (same id as tick) |
| **T-end** | **game over** | `frames.end`, then `game_over` | Callsign ends with `$PLAY,VSF,4,6,JAY` (§7o); `VA33` = "game over", `VSF`+`JAY` = victory (bench 2026-08-25) |

Design notes:
- **`cues.countdown` (`VA81`) is the anchor.** Fire it at **T-3s** so its built-in "GO" coincides with the
  spawn. Everything before T-3 is runway dressing so the moment *feels* like a real match start.
- **Missing cues are skipped, not guessed.** `cues` keys other than `countdown` and `kill` are optional
  (contracts §3); a node with no `tick`/`klaxon`/`runway_*`/`game_over` simply plays `VA81` at T-3 + the spawn
  and ends silently. That is the minimum viable start and it is fully confirmed hardware.
- **Short runway is legit.** A host who set a 10 s countdown gets ticks + `VA81`. Never schedule two long
  voice clips closer than their durations (the compiler knows the bank lengths; the node trusts the cue set).
- **Provisional ids are safe to ship** — every id MC puts in `cues` is a real bank id (asserted by
  `test_sounds.py`), so the worst case is "plays *a* clip, not the ideal one." Pinning the runway lines and
  klaxon by ear is an open FOLLOWUPS item.
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
  and stamps `match_id` on everything. The presentation profile may add a `gun.take` write 2.5 s after the
  spawn (contracts A11.7) and the headset `start` flash (A11.6).
- If the node's runway was shorter than the `VA81` clip (e.g. a degraded late arm, §4), skip the separate
  T-3 cue and play `cues.countdown` immediately before `frames.spawn` — the whole countdown-into-spawn.
- **Never spawn a gun that may already be live.** Before *any* `frames.spawn` that is not the scheduled T-0
  write on an ARMED node — a reconnect, relaunch, resume or hot-swap (E1/E5/E9) — the node first settles the BLE
  link per node.md §3.10: a LIVE rejoin runs the 3 s disarmed reconcile from persisted state and never spawns;
  a LOBBY/ARMED rejoin re-writes `frames.head` and lets the scheduled T-0 spawn run. A spawn on a live gun is
  a free heal and an erased death — it is never written blind.
- **Panic remains `frames.panic`** (`$CLEAR,*` then `$SP,99,*`, house rule) — the host's emergency stop, not
  part of any abort/recall path (§5 E7).
- **Hold-across-disperse.** The confirmed live arm (`protocol/session-findings-2026-08.md` §7e) writes `$START`→config→`$SPAWN`
  within seconds on one held link. M-START instead holds the gun in `$START`+config-but-**UNSPAWNED** across the
  walk-to-base (minutes) and only fires the T-0 `$SPAWN` at the end. **Bench 2026-08-25 (§7r): a ~2-min hold then
  `$SPAWN` went live with `$LCD,45,70,…` and full ammo**; the 5-min run was interrupted and is still owed
  (FOLLOWUPS). Config survives a BLE drop and is wiped by a power-cycle (the tell: a `$SPAWN` echoing
  `$LCD,0,0,0,0,0,0`). **Fallback if config is lost: the node re-writes `frames.head` at T-10 s** — it holds the
  whole bundle locally, the write takes ~3 s over BLE, it is silent, and it needs no LAN. **Legality:** the head
  starts with `$CLEAR`, so the T-10 re-write is allowed only when the gun is provably **unspawned** (ARMED with no
  `$LCD,45,70`/`$ALCD` seen since the head). Never on a spawned gun.

---

## 4. Clock-sync dependency (the whole thing rests on contracts §7)

`synced_now() = local_now() + offset`, with `offset` the smoothed NTP-lite estimate from the
`time_req`/`time_res` handshake (contracts §7). M-START's correctness = every dispersed node agreeing on
`go_live_t` (and `go_live_t + time_limit_s`) within tolerance.

- **Gate ready-up on a fresh sync.** A node may not report `ready:true` (and MC will not let it into the
  countdown) unless its **last successful sync is fresher than `SYNC_FRESH_MS`** (10 000 ms) and it has
  **≥3 handshake samples**. The node re-pings `time_req` on entering LOBBY and just before it acknowledges
  `start`. This guarantees the offset is fresh *while still in range*. The node reports the outcome as
  `status.synced`.
- **Drift budget.** Phone RTC drift is ≪1 s over a typical match. Budget: a node armed with a <10 s-old sync
  should fire within **±250 ms** of the field consensus. "Close enough" = **±0.5 s**; beyond that the start
  feels ragged. The lobby re-sync is the guarantee; a node in a coverage zone mid-disperse re-syncs
  opportunistically. The same budget covers the timed end.
- **A node that never synced** is **blocked from ready-up** and shown red on MC's board. If it somehow
  receives `start` unsynced, it falls back to **degraded counting** — `go_live_t` as `receipt_now + remaining`
  on its uncorrected clock — and logs it (`status.synced=false`, so MC scores its events on `t_recv`, A4.7).

---

## 5. Edge cases (the hard part)

**E1 — Power-cycle after dispersing, out of range.** The node persisted `{match_id, go_live_t, config_id, seq,
offset}` at `startAt()` alongside the `GameConfig` and the whole `FrameBundle`. On relaunch it reads them back,
re-verifies `synced_now()` (RTC survives reboot) and **resumes the countdown from where the clock now is** — if
`go_live_t` is still future, ARMED continues; if already passed, E5. If the **gun** was power-cycled its config
is gone (a `$SPAWN` echoing `$LCD,0,0,0,0,0,0` is the tell): the LOBBY/ARMED path re-writes `frames.head`, then
`frames.spawn` at T-0 (or immediately if T-0 has passed). This is why the node caches the full bundle.

**E2 — Late-join at a base still in range.** Node reconnects; **`welcome.node.start` re-hydrates the schedule
automatically** (A4.5) — no host action.

**E3 — Grace re-arm.** Host can re-broadcast the *same* `start` — **same `seq`, same `match_id`** (A5.6); a node
already armed to that `seq` treats it as a no-op, a node that lost it re-arms. A re-push never mints a new
`match_id`; only a reschedule (E8) does.

**E4 — A player who never synced / never got start.** Blocked at ready-up (§4). If the host overrode, the node
sits in LOBBY, "NOT ARMED" locally, red on MC. Recovery is E2/E3 once in coverage, or degraded fallback (§4).

**E5 — Time already passed when a node (re)connects/reboots/resumes.**
  - **Within `LATE_ARM_GRACE_MS` (8 000 ms):** spawn **immediately**, skip the runway, play only `cues.countdown`
    + `$SFLASH` so the player still gets a "GO."
  - **Beyond grace but match still live:** **hot-join** — spawn immediately, brief "in play" cue; `match_id`
    stamped from the spawn on; MC marks the player joined-late. The match clock is the shared
    `go_live_t + time_limit`, so a late spawn just means less playtime.
  - **Match already over:** do not spawn; "match ended", back to KITTED; MC shows DNP.
  - **In every branch the spawn is gated by the BLE settle step** (§3, node.md §3.10): if the gun is *already*
    live nothing is written; the node adopts LIVE and, for a swapped phone, its `welcome.node.score`.

**E6 — A player who starts late (slow to a base).** Their gun still spawns at `go_live_t` wherever they are.
A gameplay consequence, not a system fault: we start *on time*, not *on arrival*. A host who wants
arrival-gated starts uses a longer runway.

**E7 — Abort / reschedule.** Host abort sends **`control{cmd:"abort_start", seq}`**. A node in coverage whose
schedule matches that `seq`: **before T-0 (ARMED):** cancels the countdown, `ARMED → LOBBY` (the gun still holds
`frames.head`); **after T-0 (already LIVE for that `seq`):** behaves exactly as **`recall`** — `frames.end`,
`cues.game_over`, → **KITTED** (A5.9). **No panic.**

> **Host-facing rule, shown on the Start screen: "Reschedule further out BEFORE the walk. Once players
> disperse, an abort reaches only the nodes in coverage."** Mitigations: (a) a runway long enough that most aborts
> land while nodes are still in range; (b) reschedule by issuing a **new `go_live_t` further out** *before* the
> old one fires; (c) if an out-of-range node does fire on an aborted start, its gun goes live alone, **ends on
> its own timer**, and MC parks its events under the abandoned `match_id` on reconnect (A4.3); if it reaches
> coverage while still LIVE, MC's `recall` ends it early.

**E8 — Duplicate/superseding schedules.** A node keeps only the **latest** `start` by `seq` (A5.6). A
**reschedule** = higher `seq` **and** a new `match_id`; a re-broadcast (E3) = same both = no-op. No third case.

**E9 — App backgrounded / phone locked across T-0** (node.md §3.11). JS timers stop and T-0 is missed. The phone
is required to be mounted and foreground (A4.11) — this is the *recovery*, not the plan. On resume the node
settles the BLE link first (a LIVE relink reconciles, never spawns), then reconciles against `synced_now()`: if
`go_live_t` is still future → continue the countdown; if passed and the gun is unconfigured → E5. The persisted
schedule (E1) makes resume and relaunch the same code path (`resumeSchedule()`). Logged as `resumed_late`.

**E10 — Timed end while offline.** At `go_live_t + time_limit_s` a dispersed node writes `frames.end`, plays
`cues.game_over`, and returns to **KITTED** on its own (step 8). MC learns of it at the node's next sync. A
`control{end}` that arrives later — or earlier, in a coverage zone — is **idempotent** with the local end;
`recall` behaves the same.

**E11 — Late joiner mid-match** (A5.6). MC `assign`s them → `config` (node writes `frames.head`, LOBBY) → MC
re-pushes the **same** `start` → the node's `startAt()` sees `synced_now() > go_live_t` and hot-joins per E5.
The lobby's "every node acked" start gate does **not** apply to a late joiner.
