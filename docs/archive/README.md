# Archive

Not maintained. Grep it, do not read it.

Everything here was moved out of the living docs on or after 2026-09-06 because it was history
(closed followups, superseded handoffs, dated bench sheets no longer in the running order, one-time design handoffs,
retracted session write-ups). Nothing in this directory is a source of truth: if a file here
disagrees with `docs/manual/`, `docs/spec/contracts.md`, `protocol/brx-protocol.md` or
`docs/FOLLOWUPS.md`, the living file wins.

Files keep their original names. Where a living file absorbed part of an archived one, the
living file says so at the point of absorption.

Subdirectories: `hardware/` (plans that ran or were superseded) and `site/` (superseded site-build plans).
`followups-closed.md` is an aggregate, not a moved file.
`followups-closed.md` opens with the followup id history, then runs by close date, oldest first, so the newest
closure is last.

The experiment-log months stay in `docs/experiment-log/` for good: code and tests link them there. A file with no
living reader is deleted, not kept here; `git log --diff-filter=D --name-only -- docs/archive` lists them.

**Moved on 2026-09-24:**

- `bench-critical-2026-09-11.md`, `bench-super-indoor-2026-09-07.md` and `bench-flash-control-2026-09-05.md`: bench
  sheets no longer in the running order. `docs/post-mvp.md` §9 says where each rung went. The two unrun flash rungs
  (L10, L11) are in the S10 row of `docs/FOLLOWUPS.md`.
- `game-test-2026-09-13.md`: the 2026-09-13 game test (F206-F216). Its sanitised store stays in
  `docs/evidence/2026-09-13-session-3782dc77/`.
- `session-findings-2026-08.md`: the August protocol notebook, from `protocol/`. Every finding that still stands is
  in `protocol/brx-protocol.md`.
- `field-issues.md`: the field issue register. Open field issues are rows in `docs/FOLLOWUPS.md` §6. Its three
  still-open "Check next match" items (V3, V4, V5) are bullets in §10; V1, V2 and V8 were already F28, F29 and F3; V6 was F31 (closed) and V7 is F32.

**Moved on 2026-10-27:** `bench-rebench-2026-10-04.md` and `bench-rebench-0419.md` (never ran),
`bench-standard-2026-09-29.md` (ran 2026-10-02), `bench-stick-2026-09-29.md` (never ran) and
`mc-warning-audit-2026-09-16.md`. `docs/bench-plan.md` NEXT carries every open step of the bench sheets.
