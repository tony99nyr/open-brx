# Handoff — Open BRX

**State as of 2026-09-15.** The GSET token 2 field finding is integrated, reviewed and validated. Evidence is in
`docs/experiment-log/2026-09.md`; remaining work is indexed by `docs/FOLLOWUPS.md`.

## What changed

- Contract-DRY phases 1 to 3 and F42.9 batches 1-2 are implemented: Mission Control compiles with strict TypeScript;
  `win_by` is closed; the residue casts and pool intersections are gone; `Session.compiler` is a
  checked interface shared by real and fake compilers. The leaf console views, `WeaponView`, `SavedGame`
  and `LiveRow` are generated from checked Python producers. The remaining batches and phases are in
  `HANDOFF-dry-2026-09-13.md`.
- `$GSET` t2 is centralised as `GSET_T2_SAFE = 0` and pinned in real and fallback player, try-out and utility
  frame generators. Venue volume remains 80 indoors, 90 outdoors; try-outs remain 69.
- The venue reminder now describes the physical ALT mode accurately: outdoor beam width gives roughly twice the
  aim tolerance on three measured guns. It does not claim ALT changes range or that t2 is the ALT bit.
- Protocol, spec and manual references describe t2 as a receiving-gun hit gate. The 2026-09-13 field control found
  t2=1 gave zero hits from a full clip at 30 ft while t2=0 restored reliable registration. The reflection theory
  remains untested; t2 stays pinned to 0 until F198 is run at the bench.

## Validation

F42.9 batches 1-2: strict console typecheck/build and 514 tests; MCP extras 1825 passed;
system MCP 1752 passed; phone tests/build and site Playwright 102 passed; real-browser console
e2e passed 24 steps. Post-commit site shots are the final freshness step for this batch.

## Next actions

1. Continue F42.9 with batch 3 (`NodeView`, `StationView`, presentation, coverage), then the composed
   views and `State.snapshot()`. After F42.9, check phone
   transport (F42.12) and bench stage (F42.14). Commit each phase after review and validation.
2. Tony runs F198 indoors at t2=0 and watches for phantom reflected hits. Keep t2=0 unless evidence supports a
   different mapping.
3. Tony runs F170: hosted MC config versus native at the far mark and 30–40 ft, with t2=0 and fixed controls.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments; the MacBook
is the field target. Never modify stock firmware.
