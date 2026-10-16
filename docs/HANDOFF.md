# Handoff: Open BRX, state after the 48-hour improvement push
**State as of 2026-10-11.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-10-13)
**App 0.4.15 is the last published build** (`app-v0.4.15`). 0.4.16-0.4.21 were built on release branches and not
published. **0.4.22** (`/home/tony/apk-0.4.22`, from main `221d4fe1`, release commit `be55fbd7`) is the bench build, and the bench sheet is
[`bench-rebench-0422.md`](bench-rebench-0422.md). The push's reviews, triage and retro are in
`/home/tony/reviews-2026-10-10/` and `/home/tony/retro-2026-10-11.md` (outside the repo). The Stick firmware changed
(ButtonController, TickController, the advert checks): reflash every Stick from main before any Stick sheet. The iPhone X
build (B21 iOS half) is Tony's MacBook step, `.claude/skills/iphone-build`.
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: brx1, orchestration
**State:** 2026-10-13: round 2 of the improvement work is finished. MC candidates 1 and 2, the recorded mock, F522 to
F528 and a docs DRY pass all landed with Opus and Codex reviews. The main checkout is current again (fast-forwarded with
Tony's go). Process rules from the push still hold (`/home/tony/retro-2026-10-11.md`).
**Next:** run the 0.4.22 bench with Tony (`bench-rebench-0422.md`). F512 on or after 2026-10-18 (brx2). Tony decides
brx2's CLAUDE.md proposals (`/home/tony/reviews-2026-10-10/docs-dry-claude-md.md`).
**Blocked:** B21 on the MacBook; publishing waits for Tony's go.
## Lane: brx2, tooling, the test system, CI and the docs structure
**State:** 2026-10-13: the post-push tooling work is landed with green CI: F523 (each e2e job claims its own port
block, `scripts/lib/ports.mjs`), the admission scheduler (`scripts/lib/scheduler.mjs`), the `test-all.mjs` split and
`land.mjs` split stages 1-4. The docs DRY pass of 2026-10-13 gives each rule one owner (both: log 2026-10-13).
**Next:** F512 on or after 2026-10-18: make `mc-play` blocking only if it was green on every main run for 7 days. The
rest of the `land.mjs` split (the candidate builder) is parked with a design note in the push's tooling review.
R4/T5 read-only research is authorised; flashing stays decision first.
**Blocked:** nothing.
## Lane: brx3, releases and Mission Control
**State as of 2026-10-13.** Nothing is queued or gating. The 2026-10-12/13 work is in the 2026-10 log entry.
- **Landed:** architecture round 2 candidates 1 and 2 (`Session.match`, `Session.retired`, the phase funnel, the
  session.json goldens), the mock built from recorded server states (slices 1-6), F524, F527 and the MC docs pass.
  Fix log: `~/reviews-2026-10-10/mc.md`.
- **Bench rows, owner brx3:** see [`FOLLOWUPS.md`](FOLLOWUPS.md) (bench).

## Lane: brx4, the engine and the StickS3
**State (2026-10-16):** the post-push desk work is landed: F517, F520, F522 (with brx5), the Games and Kit split, F525
and F526 (a silent hill point yields after 2 s; a taken pickup station hides no claimable one), and F528 (a station
that names a taker starts no claim, even with no countdown yet). Nothing was flashed.
**Next (bench, run first):** F519 and F521 together on one Stick flash; F525 and F526 in Sitting C (C.34, C.35, on
0.4.22); F511 and F501. F518 closed 2026-10-16: the fakes now send the live shield in a `$QUERY` `$LCD` t3. F500 closed 2026-10-16: a tap recharges every energy weapon, so the HUD says RECHARGE.
**Blocked:** none.
## Lane: brx5, cross-language seams and the stage
**State:** 2026-10-13: everything is landed. That covers F522 and the F525 stage mirror (with brx4), brx3's reviews
(mock slices 1 to 6, F527 and the MC docs DRY pass), and the 0.4.22 bench sheet, which was walked against main and
reviewed in three rounds (log 2026-10-13).
**Next:** support Tony's 0.4.22 bench (`bench-rebench-0422.md`): fix any step that does not run as written. Trim the
sheet's MC-restart lines to a pointer once the bench-session skill's "Volume and MC" section is on main. Stay brx3's
second reviewer. `fix/koth-dense-adverts` (`wt-dense`) is still held for its own labelled-APK A/B.
**Blocked:** none.
## Start here

1. **Next sitting:** the NEXT sheet in [`bench-plan.md`](bench-plan.md); record evidence and promote or close each row
   from the result.
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
