# Handoff — Open BRX

**State as of 2026-09-16.** Contract-DRY phases 1-3, F42.9 batches 1-3, and the recap/history half of batch 4 are implemented, reviewed and validated. Evidence is in `docs/experiment-log/2026-09.md`; remaining work is indexed by `docs/FOLLOWUPS.md`.

## What changed

- Mission Control compiles under strict TypeScript and consumes generated Python contracts for the leaf, arsenal,
  saved-game, live-row, node, station, tunnel, coverage, presentation, mode, recap and match-history views.
- The Python producers now return their declared TypedDicts. Presentation and tunnel API envelopes are checked,
  scorer recap components compose into `RecapView`, and match history validates persisted JSON before serving it.
- The browser mock implements the same presentation rows and summary fields as the real server. Mode defaults pass
  through the existing policy guard where the console needs a fully served `ConfigView`.
- The persisted recap decoder supplies defaults for older rows and rejects malformed nested score, honor,
  possession, after-end and station data instead of advertising it as a checked view.

## Validation

Polish loop iteration 1 fixed all Critical/High/Medium findings; the fresh second pass found no remaining
medium-or-higher issue. MCP system: 1753 passed, 74 optional/dirty-shot skips. MCP extras: 1826 passed,
one dirty-shot skip. Console strict typecheck/build passed; 514 unit tests passed; browser e2e passed all
24 steps, including mock and old-session flows. Phone: 501 tests and build passed. Site build and Playwright
passed. Post-commit site-shot recapture and its focused freshness gate remain required because console source changed.

## Next actions

1. Finish F42.9 batch 4 with generated `LiveView` and `StartView`, then batch 5 by decomposing and typing
   `State.snapshot()`. Run the same review, validation and commit cycle.
2. Continue with F42.12 phone transport checkJs, F42.14 stage pyright, then the remaining coverage/runtime-input audit.
3. Tony runs F198 indoors at GSET t2=0 and watches for phantom reflected hits; keep t2=0 until evidence supports another mapping.
4. Tony runs F170: hosted MC config versus native at the far mark and 30–40 ft, with t2=0 and fixed controls.

**Machine roles:** WSL runs Python suites and no-hardware MC; Windows Python is for BLE instruments; the MacBook
is the field target. Never modify stock firmware.
