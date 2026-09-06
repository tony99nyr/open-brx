# Archived 2026-09-06 from `docs/spec/start-sequence.md` §6–§9 (host controls, interface, task breakdown, open questions)

Not maintained. The living spec is `docs/spec/start-sequence.md` §1–§5; the host controls are `mcp/brx_mcp/mc/API.md`
(`/api/start`, `/api/start/reschedule`, `/api/start/abort`); the node interface is `app/src/engine.js` (`startAt`,
`resumeSchedule`). Everything below was either built or is tracked in `docs/FOLLOWUPS.md`.

## 6. Host controls & MC display (as specified 2026-08-25)

Host controls (MC start panel, phase 5):
- **Schedule start** — host sets the **runway = walk time** (presets 60/120/180 s, default
  `DEFAULT_RUNWAY_S = 120`) and hits Start; MC mints `match_id`, computes `go_live_t = server synced now + runway`,
  broadcasts `start` to all lobby nodes.
- **Abort** — best-effort `control{cmd:"abort_start", seq}` (E7). There is no `pause` (A4.6).
- **Reschedule** — issue a new `go_live_t` (**new `seq`, new `match_id`**); supersedes the old (E8). The default
  suggestion while nodes are still in range.
- **Re-push start** — idempotent re-broadcast (E3: **same `seq`, same `match_id`**).

MC per-node display: the current `match_id`, `go_live_t` as local time, runway, the coverage hint (which nodes are
in range now vs already out: "N nodes are out of coverage — an abort will not reach them; reschedule instead"),
per-node sync freshness, armed state with a T-minus mirror, last-seen staleness age, battery. MC's T-minus is a
display mirror; the authoritative countdown is each node's.

## 7. Interface (as specified)

```ts
startAt(match_id, go_live_t, config_id, seq, countdown_s): ArmResult   // verify → persist → ARMED → choreography → T-0 spawn → LIVE → timed end → KITTED
cancelStart(reason): void   // abort_start before T-0 → LOBBY; already LIVE → recall semantics → KITTED. Never panics.
resumeSchedule(): void      // relaunch/resume/BLE reconnect: reload the persisted schedule, settle the BLE link, reconcile vs synced_now()
armState(): { state, match_id?, go_live_t?, t_minus_ms?, synced, degraded }
```
On the wire: `start`, `welcome.node.start`, `control{abort_start, seq}`, `status.arm_state/t_minus_ms/synced`.

## 8. Task breakdown (all built by 2026-09-04 except item 11's 5-min run)

1. Sync gate (`SYNC_FRESH_MS`, sample count, `status.synced`).
2. `startAt()` + ARMED state with persistence; `resumeSchedule()` on relaunch, resume and BLE reconnect.
3. `match_id` stamping from `startAt()` on.
4. Choreography engine driven off the local clock, ids only from `frames.cues`, optional cues skipped.
5. Go-live burst; the T-10 s head re-write as a switchable option.
6. Timed end, idempotent with `control{end}`/`recall`.
7. Late/degraded/abort paths.
8. MC start panel + board.
9. Sound verification by ear (runway lines + klaxon): **still open**, `compile.py` ships runway_30/20 silent.
10. Mock-clock edge-case harness for E1–E11.
11. Bench: hold-across-disperse. 2-min hold proven 2026-08-25; the 5-min run is still owed (FOLLOWUPS).

## 9. Open questions (state as of 2026-09-06)

- Default runway: DECIDED (A5.10) 120 s.
- Klaxon id and the three runway voice lines: by-ear pin still open; `cues` ships runway_30/20 empty.
- T-10 `frames.head` re-write default or fallback: the 2-min hold held, so it is insurance; the 5-min run decides.
- Persisted-offset validity after a long-parked reboot: trust for the match duration; force-resync opportunistically.
- Should MC hard-block force-starting an unsynced node: allow with a loud warning, always logged.
- `$SFLASH` as a spawn cue: confirmed only as the kill-confirm flash; harmless at spawn unverified.
