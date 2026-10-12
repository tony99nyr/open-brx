# Handoff: Open BRX, state after the 48-hour improvement push
**State as of 2026-10-11.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-10-11)
**App 0.4.15 is the last published build** (`app-v0.4.15`). 0.4.16-0.4.21 were built on release branches and not
published. **0.4.21** (`/home/tony/apk-0.4.21`, from main `795e0ba3`, after the 2026-10-10/11 improvement push) is the
bench build, and the bench sheet is [`bench-rebench-0421.md`](bench-rebench-0421.md). The push's reviews, triage and retro are in
`/home/tony/reviews-2026-10-10/` and `/home/tony/retro-2026-10-11.md` (outside the repo). The Stick firmware changed
(ButtonController, TickController, the advert checks): reflash every Stick from main before any Stick sheet. The iPhone X
build (B21 iOS half) is Tony's MacBook step, `.claude/skills/iphone-build`.
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: brx1, orchestration
**State:** 2026-10-11: the 48-hour improvement push ended early, with every lane idle. It ran review rounds 1 and 2, a
DRY and simplification pass, a cross-lane review and a final pass. Every Critical and High finding is fixed, with Opus
and Codex reviews on each change. Process rules that held: lanes by pillar, no per-fix FOLLOWUPS or HANDOFF edits, local
`--changed --ui` gates, `land.mjs` only from an origin/main worktree, and no Claude attribution in commits (`land.mjs`
refuses it; the 244 older commits stay, by Tony's decision).
**Next:** the 0.4.21 bench (`bench-rebench-0421.md`) when Tony is at the bench. The after-push design work: MC candidate 2 slices 2-3
and candidate 1 (notes in the push's mc.md review file).
**Blocked:** the phones; B21 on the MacBook; publishing waits for Tony's go.
## Lane: brx2, tooling, the test system, CI and the docs structure
**State:** 2026-10-11, the improvement push: everything landed and CI is green. The lander gates on one `results.json`
rule, refuses Claude attribution and bad flags, and regenerates the FOLLOWUPS index itself (rows-only branches).
`scripts/lib/jobs.mjs` is the one job registry: a changed job shows as a diff of `mcp/tests/fixtures/test_all_jobs.json`;
regenerate it with `node scripts/test/jobs-snapshot.mjs mcp/tests/fixtures/test_all_jobs.json`. A change to `jobs.mjs`
runs the full `--ui` gate.
**Next:** post-push, from the push's tooling review (outside the repo): the admission scheduler (#3), then the
`test-all.mjs` and `land.mjs` splits; F523 (the e2e port race). R4/T5 read-only research is authorised; flashing stays
decision first.
**Blocked:** nothing.
## Lane: brx3, releases and Mission Control
**State as of 2026-10-11.** The improvement push is closed for this lane; nothing is queued or gating.
- **Landed in the push** (fix log with every commit: `~/reviews-2026-10-10/mc.md`; summary: the 2026-10 log entry):
  robustness (one MC per home, orderly stop, F513 holes and their grace), the armory data-loss fix (`a7981b84`), the
  route split, the Scorer, game-pick and ledger modules, declared compiler and armory capabilities, and the console's
  `src/rules/` and `useResource`.
- **Next, after the push** (design notes in `~/reviews-2026-10-10/mc.md`, "Design notes for after the push"):
  candidate 2 slice 2 (the station registry: 10 host members pass directly, 21 wait for candidate 1), then candidate 1
  (a match-in-play module), with candidate 2 slice 3 (the snapshot codec) folded into it. Each gets a design review.
  Also deferred: splitting Games.tsx and Kit.tsx by concern, and building the mock from recorded snapshots.
- **Bench rows, owner brx3:** see [`FOLLOWUPS.md`](FOLLOWUPS.md) (bench).

## Lane: brx4, the engine and the StickS3
**State (2026-10-12):** the post-push desk work is landed: F517, F520, F522 (with brx5), the Games and Kit split, and
F525 and F526 (Tony's two engine decisions: a silent hill point yields after 2 s, and a taken pickup station no longer
hides a claimable one). Nothing was flashed.
**Next (bench, run first):** F519 and F521 together on one Stick flash; F525 and F526 in Sitting C (C.34, C.35, on a
build newer than 0.4.21); F518 (does a `$QUERY` `$LCD` carry the live shield?); F511 and F501.
**Blocked:** none.
## Lane: brx5, cross-language seams and the stage
**State:** 2026-10-12, F522 steps 1 and 2 are landed with brx4 (log 2026-10-12): both golden-trace runners age a dropped
station under `setup.stations_age`, and the stage runner picks one control point per scan. brx5 is brx3's second
reviewer for each architecture candidate 1 slice.
**Next:** review brx3's candidate 1 slices as they come. `fix/koth-dense-adverts` (`wt-dense`) is still held for its A/B
after the F342 baseline.
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
