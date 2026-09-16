# Handoff — Open BRX

**State as of 2026-09-16.** Contract-DRY phases 1-3, all five F42.9 batches and F42.12 are implemented, reviewed and validated.
The GSET token 2 field finding is integrated and the M5StickS3 utility-node design is recorded (H8). Evidence is in
`docs/experiment-log/2026-09.md`; remaining work is indexed by `docs/FOLLOWUPS.md`.

## What changed

- Mission Control compiles under strict TypeScript and consumes generated Python contracts for the leaf, arsenal,
  saved-game, live-row, node, station, tunnel, coverage, presentation, mode, recap, match-history, live and start views.
- The top-level `State` and its LAN, kit, lobby, announcement, sync, options, versions, notices, restore and feed
  blocks are generated too. `Session.snapshot()` composes named checked producers rather than one untyped dictionary.
- The Python producers now return their declared TypedDicts. Presentation and tunnel API envelopes are checked,
  scorer recap components compose into `RecapView`, and match history validates persisted JSON before serving it.
- The browser mock implements the same presentation rows and summary fields as the real server. Mode defaults pass
  through the existing policy guard where the console needs a fully served `ConfigView`.
- The persisted recap decoder supplies defaults for older rows and rejects malformed nested score, honor,
  possession, after-end and station data instead of advertising it as a checked view.
- The phone transport is checked as strict JavaScript. Its generated runtime contract has a generated sibling
  declaration, untrusted envelope bodies stay `unknown` until narrowed, and CI runs the same app typecheck.

## Desk work since (no hardware touched)
- **The M5StickS3 takes its kind from MC over Wi-Fi** (Tony, 2026-09-14): armed at muster, then carried out and
  placed. Specified as `spec/utility.md` §5g, filed as **H8**. The finding that sizes it: **the wire needs no
  amendment** — MC gates a station on the one string `node_type: "utility"` and never validates its value, so an
  ESP32 speaking the M-NET envelope is a utility node today and `station_config` reaches it unchanged. All the
  work is Stick-side (a four-kind WS client, `WIFI`/`MC` serial commands + mDNS, and **two Wi-Fi association
  modes** — `muster` drops the link for the match, `held` keeps it for **F95** roaming hills around a house;
  `held` puts the Wi-Fi/BLE coexistence jitter on the critical path rather than dodging it).
  Arm it respawn or control — the other three kinds have no player side. Still blocked behind H7: **no Stick has
  ever been powered on**, and the coexistence/battery claims in §5g.4 are reasoning, not measurements.

## Validation

The F42.12 polish loop removed the declaration-check bypass, replaced broad wire-body `any` types with
`unknown` plus explicit narrowing, and shared generator rendering used by both TypeScript targets. Its fresh
second pass found no remaining medium-or-higher issue. MCP system passed 1754 tests with 74 optional/dirty-shot
skips; MCP extras passed 1827 with one dirty-shot skip. The generator suite, strict phone typecheck, 501 phone
tests and build pass. Console typecheck/build, 514 tests and 24-step browser e2e pass; site build and 102 tests pass.
Post-commit site-shot recapture remains required because phone source changed.

## Next actions

1. Continue with F42.14 stage pyright, then the remaining coverage/runtime-input audit.
2. Tony runs F198 indoors at GSET t2=0 and watches for phantom reflected hits; keep t2=0 until evidence supports another mapping.
3. Tony runs F170: hosted MC config versus native at the far mark and 30–40 ft, with t2=0 and fixed controls.

**Machine roles:** WSL runs Python suites and no-hardware MC; Windows Python is for BLE instruments; the MacBook
is the field target. Never modify stock firmware.
