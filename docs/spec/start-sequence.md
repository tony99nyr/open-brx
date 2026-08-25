# M-START — the dispersed, time-synced match start

- **Status:** Draft (Wave 2 module; layers on M-NODE + M-NET). Owner: M-START lane.
- **Binds to:** `contracts.md` §5 (`start` message), §6 (lifecycle `ARMED`), **§7 (clock sync — this
  module's spine)**, §8 (BRX frame contract). Phase 5 of `README.md` §3.
- **Ground truth referenced, not restated:** arm/go-live frame order `protocol/brx-protocol.md` §7e;
  `$PLAY` two-slot semantics §7o; sound ids `mcp/brx_mcp/sounds.py` + `callsign-extract/sound-bank.md`;
  audio ownership `docs/sound-architecture.md` (Cut 1B — host-triggered `$PLAY` on a rule).

The problem this solves: you cannot keep every player in Wi-Fi range at T-0. Teams want to **walk to
their bases first, then get a countdown**. So we never send a "go" signal at T-0. Instead MC hands every
node a **wall-clock go-live time** while everyone is still in the lobby, and each node — dispersed and
offline — counts itself down on its **own synced clock**, arms its gun, and plays the countdown/klaxon
**through the gun speaker**. No LAN, no signal, no MC at the moment of truth.

---

## 1. Core mechanism

1. **Lobby (in range).** Config is already on the tagger — the lobby `config` message pushed the full
   `GameConfig` + loadout at ready-up (`README.md` §6 decision) and the node applied it (`ack_config`). The gun is
   configured but **not spawned** (`$PSET`/`$WEAP`/`$SIR`/`$BMAP` written; no `$SPAWN` yet).
2. **Schedule.** Host picks a go-live moment. MC computes `go_live_t` (a synced wall-clock Unix-ms
   instant, §7) and broadcasts `start { go_live_t, config_id }` (contracts §5) to every lobby node.
3. **Arm the schedule locally.** Each node calls its own `startAt(go_live_t, config_id, seq, countdown_s)`
   (§7). It verifies it holds that `config_id` and is freshly synced (§4), enters lifecycle
   **`ARMED(countdown)`** (§6), and **persists** `{go_live_t, config_id, seq}` to local storage. From here
   the node needs nothing from anyone.
4. **Disperse.** Players walk to bases and leave Wi-Fi range. The WS drops; that is expected and fine —
   `start` is best-effort and the schedule is already local (contracts §5 store-and-forward semantics).
5. **Local countdown.** Each node ticks on `synced_now()` and drives the gun-speaker choreography (§2)
   off its own clock. Because every node shares the same `go_live_t` and the same offset-corrected clock,
   the countdowns are aligned across the field to within the drift budget (§4) — no coordination needed.
6. **T-0: self-arm.** At `synced_now() >= go_live_t` the node runs the **go-live frame burst** (§3) to
   take the gun live and plays "GO"/klaxon. The gun is now in play; the node's autonomous engine (M-NODE)
   owns it from here. `ARMED → LIVE`.
7. **Rejoin.** As players wander back into range mid-match the WS reconnects and store-and-forward flushes
   queued events; the start itself required no reconnection.

---

## 2. Audio choreography (gun-speaker, host-on-a-rule → local)

All of this is played **by the node onto its own gun over BLE** as its local clock crosses each mark —
it is `sound-architecture.md` Cut 1B (`$PLAY` on a rule), except the "host" computing the rule is the
node's own countdown timer, not MC. **Volume 69** for real games (house rule; 30 is inaudible). Frames
use the two-slot `$PLAY` (§7o): **token 1** = local/effect SFX, **token 4** = the announcer/voice channel.

**Default 30-second runway** (host-configurable length, §5). `snd.*` names are from `mcp/brx_mcp/sounds.py`.

| Mark | Cue | Frame (illustrative) | Source / confidence |
|---|---|---|---|
| T-30s | voice "thirty seconds — get to your base" | `$PLAY,,4,6,<START_30S>,,,,*` | **PROVISIONAL** — pick from VA voice range by ear |
| T-20s | voice "twenty seconds" | `$PLAY,,4,6,<START_20S>,,,,*` | PROVISIONAL |
| T-10s | voice "ten seconds — weapons hot" | `$PLAY,,4,6,<START_10S>,,,,*` | PROVISIONAL (VH `weapons hot` VHT is a candidate) |
| T-9 … T-4 | one short beep per second (tick) | `$PLAY,U16,,,,,,,*` (token-1 SFX) | **PROVISIONAL tick** — `U16` (0.43 s) is a real bank id (safe to emit); sound-bank lists it as "connect-related," so the countdown-tick *meaning* is unconfirmed |
| T-3 → T-0 | **"3 … 2 … 1 … GO"** spawn countdown | `$PLAY,VA81,4,6,,,,,*` | **CONFIRMED** `snd.COUNTDOWN` (VA81, 2.97 s) — the native arena spawn countdown; its "GO" lands on T-0 |
| **T-0** | **arm + klaxon + green flash** | go-live burst §3, then `$SFLASH,*` + `$PLAY,<KLAXON>,4,6,,,,,*` | `$SFLASH` CONFIRMED (§7o); klaxon PROVISIONAL |

Design notes:
- **`VA81` is the anchor.** It is the confirmed 3-2-1 spawn countdown (2.97 s). Fire it at **T-3s** so its
  built-in "GO" coincides with the arm. Everything before T-3 is runway dressing (voice + ticks) so the
  moment *feels* like a real match start rather than a bare beep.
- **Short runway is legit.** With a 30 s runway the T-30/T-20 voice lines are optional garnish; the
  minimum viable start is just `VA81` at T-3 + the arm. A host who set a 10 s countdown gets ticks +
  `VA81`. Never schedule two long voice clips closer than their durations (sound-bank lists each length).
- **Provisional ids are safe to ship** — every id we emit is a real bank id (asserted by `test_sounds.py`),
  so the worst case is "plays *a* clip, not the ideal one." Pinning `START_30S/20S/10S` and the klaxon by
  ear is a `verification-checklist` task; add them to `sounds.py` as new `Cue`s when confirmed.
- **Do not reuse `GAME_OVER`/`VA33`** or the `V101–V144` objective callouts here — those carry match-end /
  objective meaning elsewhere; a distinct start palette keeps the audio language unambiguous.

---

## 3. The go-live burst (T-0)

The node does **not** re-push config at T-0 — that happened at lobby. It sends only the **arm tail** of the
canonical start sequence (`protocol/brx-protocol.md` §7e), produced by **M-MODES `armFrames(config, player)`**
(contracts §8 — nodes never invent frames):

```
$PLAYX,0,*                 # clear any lingering countdown playback
$PLAY,VA81,4,6,,,,,*       # (already fired at T-3 in the choreography; here iff runway < 3s)
$SPAWN,,*                  # <-- GO LIVE (empty token matters; §7e)
$AMMO,0,<mag>,<reserve>,1,*   # load magazines (per loadout slot)
$AMMO,1,<mag>,<reserve>,1,*
$BMAP,0,0,,,,,*            # re-map trigger AFTER spawn (mandatory; §7e)
$SFLASH,*                  # green-sight flash — "you are live"
```

- The gun echoes `$LCD`/`$ALCD` (HP/armor/mag) confirming live; the node's engine begins its own-gun loop.
- If the node's runway was shorter than the `VA81` clip (e.g. a degraded late arm, §4), skip the separate
  T-3 cue and let the burst's own `$PLAY,VA81` be the whole countdown-into-arm.
- **Panic remains** `$CLEAR,*` then `$SP,99,*` (house rule) — an aborted or recalled start uses it (§5).
- **⚠ PENDING HARDWARE TEST — hold-across-disperse.** The confirmed live arm (`protocol/brx-protocol.md`
  §7e) writes `$START`→config→`$SPAWN` **within seconds on one held link**. M-START instead holds the gun
  in `$START`+config-but-**UNSPAWNED** across the walk-to-base (**minutes**) and only fires the T-0 `$SPAWN`
  at the end. That long-hold-then-spawn path is **UNTESTED** on hardware — does the gun keep the pushed
  config/loadout while parked unspawned for minutes, or does it time out / need a re-push before `$SPAWN`?
  Bench-verify before relying on it (see task/test harness §8); if it drops config, the E1 gun-power-cycle
  re-push path (config head + tail) is the fallback.

---

## 4. Clock-sync dependency (the whole thing rests on §7)

`synced_now() = local_now() + offset`, with `offset` the smoothed NTP-lite estimate from the
`time_req`/`time_res` handshake (contracts §7). M-START's correctness = every dispersed node agreeing on
`go_live_t` within tolerance.

- **Gate ready-up on a fresh sync.** A node may not report `ready:true` (and MC will not let it into the
  countdown) unless its **last successful sync is fresher than `SYNC_FRESH_MS`** (propose **10 000 ms**) and
  it has **≥3 handshake samples** (so `offset` is smoothed, not a single noisy RTT). The node re-pings
  `time_req` on entering LOBBY and just before it acknowledges `start`. This guarantees the offset is fresh
  *while still in range*, right before the player walks out of range.
- **Drift budget.** Phone RTC drift is ≪1 s over a typical match (contracts §7). Budget: a node armed with a
  <10 s-old sync should fire within **±250 ms** of the field consensus — imperceptible for a countdown.
  "Close enough" = **±0.5 s**; beyond that the start feels ragged. We re-sync at lobby only; no mid-disperse
  sync is needed within a normal 5–20 min match.
- **A node that never synced** (no samples, or stale beyond `SYNC_FRESH_MS`): it is **blocked from ready-up**
  and shown red on MC's board (§6). If it somehow receives `start` unsynced (edge: synced then went stale
  before arm), it falls back to **degraded counting** — treat `go_live_t` as `receipt_now + remaining` using
  its *uncorrected* local clock from the instant it got `start`, and **log it** (contracts §7 degraded path).
  Degraded nodes may fire seconds off; MC flags them `unsynced` in the per-node status.

---

## 5. Edge cases (the hard part)

**E1 — Power-cycle after dispersing, out of range.** Player reboots phone and/or gun at their base; RAM
schedule is gone and there's no LAN to re-fetch it. **Primary mitigation: the node persists
`{go_live_t, config_id}` to durable local storage at `startAt()`** (step 3; `config_id` is the config
identity/staleness key — contracts §9, there is no separate hash). On relaunch the
node reads it back, re-verifies `synced_now()` (its offset is also persisted; RTC survives reboot so a
recent offset is still valid for the minutes involved), and **resumes the countdown from where the clock
now is** — if `go_live_t` is still future, it re-enters `ARMED` and continues; if already passed, see E5.
The gun keeps its config across a BLE reconnect only if it wasn't power-cycled; if the **gun** was
power-cycled the node must **re-push config before arming** — it still holds the `GameConfig` locally
(from the lobby `config` push), so it replays `armFrames()` config head + tail. This is why the node caches the full
config, not just the go-live time.

**E2 — Late-join at a base still in range.** A straggler arrives at a base that happens to be in Wi-Fi
range (or the host walks MC to them). Node reconnects, `hello` → MC re-sends `start`. If `go_live_t` is
still future, normal path. This is the graceful "someone was late leaving the lobby" case.

**E3 — Grace re-arm.** Host can re-broadcast the *same* `start` (idempotent by `config_id` + `go_live_t`)
at any time; a node already armed to that pair treats it as a no-op, a node that lost it re-arms. Cheap,
safe, and the default recovery action on MC's board ("re-push start").

**E4 — A player who never synced / never got start.** Blocked at ready-up (§4) so ideally never reaches
dispersal. If it happens anyway (host overrode), the node has no schedule: it sits in LOBBY/idle, shows
"NOT ARMED" locally and red on MC. Recovery is E2/E3 once back in range, or **degraded fallback** (§4) if
the host force-starts it from receipt.

**E5 — Time already passed when a node (re)connects/reboots.** `synced_now() > go_live_t` at the moment the
node learns/recovers the schedule. Rules by how late:
  - **Within a grace window `LATE_ARM_GRACE_MS` (propose 8 000 ms):** arm **immediately** — run the go-live
    burst now, skip the runway, play only `VA81`+`$SFLASH` so the player still gets a "GO." They join a few
    seconds behind; acceptable.
  - **Beyond grace but match still live (`go_live_t < now < go_live_t + time_limit`):** **hot-join** — arm
    immediately, no countdown, brief "in play" cue; MC marks the player joined-late. The match clock is the
    shared `go_live_t + time_limit`, so a late arm just means less playtime, computed the same everywhere.
  - **Match already over:** do not arm; node shows "match ended," MC shows the player as DNP.

**E6 — A player who starts late (slow to a base).** Not special — their gun still arms at `go_live_t` on
their own clock wherever they are. They may be caught in the open; that's a gameplay consequence, not a
system fault. (Design choice: we start *on time*, not *on arrival*. A host who wants arrival-gated starts
uses a longer runway.)

**E7 — Abort / reschedule.** Host abort sends **`control{cmd:"abort_start", seq}`** (contracts §5 control
table + A1/A2), where `seq` references the `start.seq` being cancelled. An in-range armed node whose current
schedule matches that `seq` cancels the countdown, returns `ARMED → LOBBY`, and if it had already armed the
gun runs **panic** (`$CLEAR,*` → `$SP,99,*`). (`recall` is a distinct control — it stops a *live/armed
game*, not a pending countdown — so it is **not** the cancel-a-schedule path; §6.)
**Out-of-range nodes can't hear an abort** — this is the fundamental limit of a no-signal start. Mitigations:
(a) keep the runway long enough that most aborts land while nodes are still in range; (b) reschedule by
issuing a **new `go_live_t` further out** *before* the old one fires, which supersedes it on any node that
reconnects; (c) if an out-of-range node does fire on an aborted start, its gun simply goes live alone and
MC recalls it on reconnect. **State clearly to the host:** "once nodes disperse, an abort only reaches those
back in range — reschedule early."

**E8 — Duplicate/superseding schedules.** A node keeps only the **latest** `start` by its MC-stamped
monotonic schedule `seq` (contracts §5, ratified A1/A2). A higher `seq` supersedes; re-broadcasts (E3) with
the same `seq`/`config_id`+`go_live_t` are no-ops.

---

## 6. Host controls & MC display

Host controls (MC start panel, phase 5):
- **Schedule start** — host sets **countdown length** (runway; presets 10/30/60 s, default 30) and hits
  Start; MC computes `go_live_t = server synced now + runway`, broadcasts `start` to all ready nodes.
- **Abort** — best-effort `control{cmd:"abort_start", seq}` (E7); MC warns which nodes are already out of
  range and thus uncancellable. (Distinct from `recall`, which stops a live game.)
- **Reschedule** — issue a new `go_live_t`; supersedes the old (E8). Offered as the safe alternative to abort.
- **Re-push start** — idempotent re-broadcast (E3), the default fix for a node showing not-armed.

MC per-node display (fed by node status, §7):
- Board of nodes with, per node: **sync freshness** (green <10 s / amber / red never-synced), **armed state**
  (`LOBBY` / `ARMED T-minus MM:SS` counting on MC's own synced clock as a mirror / `LIVE` / `unsynced`
  degraded / `late-join`), last-seen staleness age, and battery. "All armed & synced" is the green light to
  let the countdown ride. MC's T-minus is a *display mirror*; the authoritative countdown is each node's.
- Because armed nodes disperse, MC shows **last-known** armed state with a staleness age (contracts §5 —
  stale, not gone); a node that armed then walked away reads "ARMED T-… (last seen 40 s ago)," which is
  expected, not an error.

---

## 7. Interface

**On the node (M-START API, consumed by M-NODE):**
```ts
startAt(go_live_t: number, config_id: string, seq: number, countdown_s: number): ArmResult
// Preconditions: node holds config_id (pushed earlier via the `config` message, §M-NET) and is
//   fresh-synced (§4). Config is NOT a startAt argument — startAt only schedules the arm.
// Args: go_live_t (synced wall-clock T-0), config_id (staleness key it must already hold),
//   seq (MC-stamped schedule counter — supersede/abort ordering, E8), countdown_s (runway length, §2).
// Effect: verify → persist {go_live_t, config_id, seq, offset} → enter ARMED(countdown) →
//         run the §2 choreography off synced_now() → at T-0 run the §3 go-live burst → LIVE.
// Returns: { ok, state, reason? }  (reason: "stale_config" | "unsynced" | "past_grace" | ...)

cancelStart(reason): void   // abort_start while ARMED (E7): stop countdown, panic if already live.
armState(): { state, go_live_t?, t_minus_ms?, synced: boolean, degraded: boolean }  // for status heartbeat
```

**On the wire (contracts §5, ratified A1/A2):**
- MC → node: `start { go_live_t, config_id, seq, countdown_s }` — `seq` is the MC-stamped monotonic schedule
  counter (supersede ordering, E8); `countdown_s` is the runway length for the node's §2 choreography/display.
- MC → node: **abort/reschedule via `control{cmd:"abort_start", seq}`** (E7), where `seq` names the schedule
  to cancel — **not** a field on `start`. (`recall` stops a live game, a different path; §6.)
- node → MC: armed/countdown status rides the existing periodic `status` Event (contracts §4), which carries
  `arm_state` + `t_minus_ms` + `synced` (ratified A1/A2). No new message type required.

---

## 8. Task breakdown

1. **Sync gate** — implement `SYNC_FRESH_MS`/sample-count gate on ready-up; persist smoothed `offset`.
2. **`startAt()` + `ARMED` state** — schedule persistence, countdown ticker on `synced_now()`, transition
   to `LIVE` at T-0; resume-from-storage on relaunch (E1/E5).
3. **Choreography engine** — the §2 mark table driven off the local clock; pull ids from `sounds.py`; guard
   against overlapping long clips; volume 69.
4. **Go-live burst** — wire `armFrames()` tail (§3); handle gun-was-power-cycled re-push (E1).
5. **Late/degraded paths** — grace arm, hot-join, unsynced fallback, DNP (E4/E5).
6. **MC start panel + board** — schedule/abort/reschedule/re-push; per-node armed & sync display (§6).
   Abort/reschedule emits `control{cmd:"abort_start", seq}` (E7), not a `start` field.
7. **Contracts amendment** — ✅ landed as A1/A2: `start.seq`/`countdown_s`, `control.abort_start`,
   `status.arm_state`/`t_minus_ms`/`synced`, `config_id` as staleness key (contracts §9). Nothing further to
   land; consume these shapes as-is.
8. **Sound verification** — pin `START_30S/20S/10S` + klaxon by ear; **confirm the `U16` countdown-tick
   meaning** (currently provisional, §2); add as `Cue`s; keep `test_sounds.py` green.
9. **Mock-clock edge-case test harness** — a deterministic clock injectable for `synced_now()` (advance /
   jump / drift / reset offset) so E1–E8 are unit-testable without hardware: **E1** persist→relaunch→resume
   (and gun-power-cycle re-push), **E2** late-join reconnect, **E3** idempotent grace re-arm (same
   `seq`/`config_id`+`go_live_t` = no-op), **E5** grace-arm / hot-join / match-ended by clock position,
   **E7** `abort_start` cancel (+ panic if live), **E8** supersede by higher `seq`, and the §4
   degraded/unsynced fallback. Assert transitions against the §6 lifecycle.
10. **⚠ Bench: hold-across-disperse arm (pending hardware).** Verify §3's long-hold path — write
    `$START`+config, leave the gun UNSPAWNED for minutes, then fire `$SPAWN` — actually goes live with the
    config intact, vs. the confirmed within-seconds `$START`→config→`$SPAWN` (protocol §7e). Determine whether
    a config re-push is needed before the T-0 `$SPAWN`; log to `docs/experiment-log.md`.

## 9. Open questions

- **Default runway length?** 30 s is proposed; club play with long walks to bases may want 60–90 s. [DECIDE]
- **Klaxon id** and the three runway voice lines — by-ear pin (task 8). Until then, ship provisional.
- **Abort path — RESOLVED (A2):** cancel a pending schedule with `control{cmd:"abort_start", seq}`; `recall`
  is reserved for stopping a live/armed game. No `start.abort` field. (E7 updated.)
- **Persisted-offset validity after a long-parked reboot** — is an offset from >X minutes ago still trustworthy
  for a same-match rejoin, or must E1 force a fresh sync if any LAN is reachable? Propose: trust for the match
  duration; force-resync opportunistically whenever back in range.
- **Should MC hard-block force-starting an unsynced node,** or allow it with a loud "degraded, may fire off"
  warning? Propose: allow with warning (host's field call), always logged.
