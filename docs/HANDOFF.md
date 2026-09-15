# Handoff — Open BRX

**State as of 2026-09-15.** The GSET token 2 field finding is integrated, reviewed and validated. Evidence is in
`docs/experiment-log/2026-09.md`; remaining work is indexed by `docs/FOLLOWUPS.md`.

## What changed

- Contract-DRY phases 1 and 2 are implemented: Mission Control compiles with strict TypeScript;
  `win_by` is closed and invalid values are refused; four casts and five redundant console pool
  intersections are gone. The remaining phases are in `HANDOFF-dry-2026-09-13.md`.
- `$GSET` t2 is centralised as `GSET_T2_SAFE = 0` and pinned in real and fallback player, try-out and utility
  frame generators. Venue volume remains 80 indoors, 90 outdoors; try-outs remain 69.
- The venue reminder now describes the physical ALT mode accurately: outdoor beam width gives roughly twice the
  aim tolerance on three measured guns. It does not claim ALT changes range or that t2 is the ALT bit.
- Protocol, spec and manual references describe t2 as a receiving-gun hit gate. The 2026-09-13 field control found
  t2=1 gave zero hits from a full clip at 30 ft while t2=0 restored reliable registration. The reflection theory
  remains untested; t2 stays pinned to 0 until F198 is run at the bench.

## Validation

Contract-DRY phase 2 pre-commit: MCP system 1750 passed (74 skips: optional extras and dirty UI shot
gate), MCP extras 1823 passed (1 dirty UI shot-gate skip); console strict typecheck/build and 514 unit
tests passed, real-server e2e 24 passed; phone 501 and build passed; site Playwright 102 passed. A
post-commit shot recapture and freshness check remain before phase 3.

## Next actions

1. Continue the contract-DRY plan with compiler interface checking (F42.15), then generated console
   view types (F42.9). Commit each phase after review and validation.
2. Tony runs F198 indoors at t2=0 and watches for phantom reflected hits. Keep t2=0 unless evidence supports a
   different mapping.
3. Tony runs F170: hosted MC config versus native at the far mark and 30–40 ft, with t2=0 and fixed controls.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments; the MacBook
is the field target. Never modify stock firmware.
