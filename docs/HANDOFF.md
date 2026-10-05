# Handoff: Open BRX, state on the eve of the 0.4.18 re-bench
**State as of 2026-10-03.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-10-03)
**App 0.4.15 is the last published build** (`app-v0.4.15`; `app/package.json` on main reads 0.4.15). 0.4.16 (the
2026-10-02 standard bench) and 0.4.17 were built on release branches and not published. **0.4.18 is cut from main
overnight**, after brx3 lands the station RESTORE (F448) and the hill alerts (F444, F442); the morning re-bench runs
it: [`bench-rebench-2026-10-04.md`](bench-rebench-2026-10-04.md). On main since 0.4.15: F416's weapon-state spawn
check, F436's reconcile re-equip, F437-F439, F440 fair presence (a 3 dB exit band), F441, F443, F446, F447, the hill
kept across END and NEXT MATCH, and NIGHT OPS from a LOBBY edit. The Stick firmware on the bench predates F434 and
F440: reflash it from main before any Stick sheet. The iPhone X build (B21 iOS half, uncompiled Swift) is Tony's
MacBook step, `.claude/skills/iphone-build`.
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: brx1, orchestration
**State:** overnight 2026-10-03: brx3, brx4 and brx5 polish code; brx2 does the docs; brx1 cuts 0.4.18 from main
once F448 and F444 land, and installs nothing until the phones are back.
**Next:** the morning re-bench on 0.4.18 ([`bench-rebench-2026-10-04.md`](bench-rebench-2026-10-04.md)), then the
Stick and Mac sheets.
**Blocked:** the phones (off overnight); B21 on the MacBook.
## Lane: brx2, bench, audio, utility and docs
**State:** 2026-10-05 day, all landed (main `a4fdc910`). test-all: task allowances from measured peaks (a full `--ui`
512 s, box peak 3,112); outside load makes a job wait (60 min cap, a per-minute line naming the top consumers) instead
of crashing; an env-tag reaper (`BRX_TEST_REAP`, `BRX_LAND_GATE`) stops a job's detached MC, vite and browsers on any
exit; old `/tmp` run logs are pruned. `land.mjs withdraw` works while a lander runs; `land status` no longer crashes
mid-batch. F488 was a real HUD bug (the idle screen rebuilt the gun picker 1 s after boot). The 0.4.19 re-bench sheet
is on main: the APK is built from `c7f08cf0` (not published) and every fix it tests is in it. CI is green through
`0d3e010d`; I watch each land. Next free id: F499.
**Next:** the 0.4.19 bench, `bench-rebench-0419.md`. Setup: re-pair adb, install `/home/tony/apk-0.4.19`, run
`./start.sh --setup-only` online once, reflash the Sticks from main, start MC from main with `--bench-volume 80`. R4/T5 read-only research is authorised; flashing stays
decision first.
**Blocked:** F270 on A8; F274 on its three 2-hour soaks; F275 on outdoor space.

## Lane: brx3, releases and Mission Control
**State as of 2026-10-05.** The desk lane is empty; only bench rows remain. On main and in 0.4.19:
- **MC late facts (`32e364f5`).** Each stored fact carries `_mc_holder` (its node's player at arrival) and
  `_mc_evicted`; every replay binds by them. At the whistle the scorer's node map is frozen, so late facts follow the
  whistle's bindings through a debrief handover, an evict in RECAP (F483 keeps them, Tony to confirm) and the roll.
  F481, F482, F486, F487, F490 and F492 are closed with it.
- **F489 (`04b81a29`)** was the harness (a `die` before the stand-in was live). **F494 (`c9c3c7e7`):** a console timer.
- **F493** (brx4's revive fix) reviewed twice and approved at `53f97f2f`.
- **Next bench (0.4.19 sheet):** step 27, F294's first contact on WSL. Its new log lines (`5609ac30`) tell a sweep that
  paused for a gun connect (`sweep paused (gun connect)` and its resume) from one whose probes went unanswered (the
  per-/24 `probed, open, closed, timed out, threw` line). The RECAP-handover check (step 26): the board's dot moves to
  the new holder, and a late death stays with its first holder. Also F434's Stick claim ladder (step 4a).
- **Bench rows, owner brx3:** F434, F440, F383, F443, F444, F448, F365, F237, F442, F395, F396, F294, F339.

## Lane: brx4, the engine and the StickS3
**State:** the engine split is done: `reconcile.js` (8a404b6c), `ammo.js` (e021a370) and `_onHp` as named steps,
landed with bug 3 (echo family), the reconcile and stun fixes and the HP fixes (82426e56). A18 shared test helpers
(613f77d0); A8 hill cues in `presentation.EVENTS`, `CLIP_MS` generated (53a40876). A refactor proves "no behaviour
change" with the golden traces plus an old/new differential; never `--accept` to make one pass.
**Next:** bench F459 (stun x reconcile), F460 (own-write echo), F461 (shield fill echo), F463 (clip timing + Tony's
ruling on hill sounds with the announcer off).
**Blocked:** none.
## Lane: brx5, powerups, clock trust and the stage
**State:** 2026-10-05 landed F473 and F474 (+ follow-up), F475, F476 (deferred check), F477, F484, F485, F495, F464 (Tony's option 1),
A19 (shared mcp test helpers), the stage hp-mirror, the 0.4.19 release notes and a docs accuracy pass (log 2026-10-05).
**Next:** none queued. `fix/koth-dense-adverts` (`wt-dense`) is held: run it as an A/B with its own labelled APK only after the
0.4.19 sheet's scan-flood baseline (step 24, F342) is recorded.
**Blocked:** none.
## Start here

1. **Next sitting:** [`bench-rebench-2026-10-04.md`](bench-rebench-2026-10-04.md) on 0.4.18; record evidence and
   promote or close each row from the result. Then the Stick and Mac sheets in [`bench-plan.md`](bench-plan.md).
2. **Desk:** B21's iOS compile on the MacBook (`.claude/skills/iphone-build`).
3. **Decisions for Tony:** the FOLLOWUPS MVP DECISION group.
4. **Only after MVP:** [`post-mvp.md`](post-mvp.md) is the roadmap; nothing there is scheduled.

If Tony is not at the bench, prepare the decision packet and read the exact FOLLOWUPS methods; do not invent a new
implementation for a bench-gated row.

## Machine state

MC is `mcp/` on 8765/8766 serving `webapp/mc/dist`; rebuild before starting and restart between matches
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume`
(S58 powerups are on by default; add `--no-powerups` to turn them off). Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC,
Windows drives BLE, and the MacBook is the field target. Never modify stock firmware.
