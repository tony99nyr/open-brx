# Handoff — Open BRX

**State as of 2026-09-15.** The GSET token 2 field finding is integrated, reviewed and validated. Evidence is in
`docs/experiment-log/2026-09.md`; remaining work is indexed by `docs/FOLLOWUPS.md`.

## What changed

- Contract-DRY phases 1 to 3 are implemented: Mission Control compiles with strict TypeScript;
  `win_by` is closed; the residue casts and pool intersections are gone; `Session.compiler` is a
  checked interface shared by real and fake compilers. The remaining phases are in
  `HANDOFF-dry-2026-09-13.md`.
- `$GSET` t2 is centralised as `GSET_T2_SAFE = 0` and pinned in real and fallback player, try-out and utility
  frame generators. Venue volume remains 80 indoors, 90 outdoors; try-outs remain 69.
- The venue reminder now describes the physical ALT mode accurately: outdoor beam width gives roughly twice the
  aim tolerance on three measured guns. It does not claim ALT changes range or that t2 is the ALT bit.
- Protocol, spec and manual references describe t2 as a receiving-gun hit gate. The 2026-09-13 field control found
  t2=1 gave zero hits from a full clip at 30 ft while t2=0 restored reliable registration. The reflection theory
  remains untested; t2 stays pinned to 0 until F198 is run at the bench.

## Validation

Contract-DRY phase 3: MCP system 1753 passed (73 optional skips), MCP extras 1826 passed; console
strict typecheck/build and 514 unit tests passed; real-server browser e2e 24 passed; phone 501
tests and build passed; site Playwright 102 passed. Existing shot manifest remains current because
no UI source changed.

## Next actions

1. Continue the contract-DRY plan with generated console view types (F42.9), then checked phone
   transport (F42.12) and bench stage (F42.14). Commit each phase after review and validation.
2. Tony runs F198 indoors at t2=0 and watches for phantom reflected hits. Keep t2=0 unless evidence supports a
   different mapping.
3. Tony runs F170: hosted MC config versus native at the far mark and 30–40 ft, with t2=0 and fixed controls.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments; the MacBook
is the field target. Never modify stock firmware.
