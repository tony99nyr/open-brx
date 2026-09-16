# Handoff — Open BRX

**State as of 2026-09-14.** The GSET token 2 field finding is integrated and the M5StickS3 utility-node design
is recorded. Evidence is in `docs/experiment-log/2026-09.md`; remaining work is indexed by `docs/FOLLOWUPS.md`.

## What changed

- `$GSET` t2 is centralised as `GSET_T2_SAFE = 0` and pinned in real and fallback player, try-out and utility
  frame generators. Venue volume remains 80 indoors, 90 outdoors; try-outs remain 69.
- The venue reminder now describes the physical ALT mode accurately: outdoor beam width gives roughly twice the
  aim tolerance on three measured guns. It does not claim ALT changes range or that t2 is the ALT bit.
- Protocol, spec and manual references describe t2 as a receiving-gun hit gate. The 2026-09-13 field control found
  t2=1 gave zero hits from a full clip at 30 ft while t2=0 restored reliable registration. The reflection theory
  remains untested; t2 stays pinned to 0 until F198 is run at the bench.

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

MCP system Python: 1747 passed, 73 skipped for unavailable optional extras. MCP extras: 1819 passed, 1 skipped
because the working tree makes the UI screenshot freshness guard inapplicable. Mission Control: 514 unit tests and
24 real-browser steps passed, including stale-server and old-session checks. Site: 102 Playwright tests passed.
Phone app: 501 tests and build passed. Focused venue tests and desktop/phone/stale-server browser checks passed.
ProofShot captured the reminder with zero browser console errors; its mock-only run logged expected proxy refusals.

## Next actions

1. Tony runs F198 indoors at t2=0 and watches for phantom reflected hits. Keep t2=0 unless evidence supports a
   different mapping.
2. Tony runs F170: hosted MC config versus native at the far mark and 30–40 ft, with t2=0 and fixed controls.
3. Continue F201–F205 and the existing bench/system-proof queue; do not revive the disproved ALT/range theory.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments; the MacBook
is the field target. Never modify stock firmware.
