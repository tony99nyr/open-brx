# BRX IR shot protocol — decoded

**The over-the-air IR word a BRX tagger emits when it fires.** This is the *optical* protocol (what one
gun's IR carries to another gun's headset), distinct from the BLE serial protocol in `brx-protocol.md`.

**Source & credit:** decoded from **LaserTagMods' `NRFL-Bases/NRFL Bases/Nodes/node1.ino`**
(github.com/LaserTagMods) — a referee-free domination *base* that receives gun IR and decodes the BRX
tag. Credit LaserTagMods (JEDGE/JBOX) for the protocol discovery. **Status:** high-confidence from source,
**not yet verified on our own bench** — confirm against a VS1838B capture (`hardware/ir-prototype-plan.md`,
`esp32-ir-bridge/ir_capture.ino`) before treating as final.

## Frame: ~25-bit word, pulse-width encoded

- **Carrier:** 38 kHz, 940/980 nm (a standard VS1838B/TSOP demod receiver recovers it).
- **Sync/start:** a **~2 ms LOW pulse** precedes the frame (node1 gates on `pulseIn(pin, LOW) > 1500 µs`,
  "2 ms sync ± 500 µs"). Use it to detect frame start / reject non-BRX IR.
- **Bits:** each bit is a LOW pulse read by `pulseIn(pin, LOW, 5000)`. Width encodes value —
  **long (~1000 µs) = 1, short (~500 µs) = 0**, split at a **~750 µs threshold** (node1 compares `> 750`).
  Matches the LaserTagMods "25-bit, 1000/500 µs marks" note in `docs/reference/lasertagmods.md`.

## Field layout (in transmit order, after sync)

| Field | Bits | Meaning |
|---|---:|---|
| **B** | 4 | bullet / weapon type |
| **P** | 6 | **player id (0–63)** — per-player identity is in every shot |
| **T** | 2 | team id (4 teams: red / blue / green / yellow) |
| **D** | 8 | damage amount |
| **C** | 1 | critical-hit flag |
| **U** | 2 | unknown / reserved (node1 reads but doesn't use) |
| **Z** | 2–3 | parity / check |

4+6+2+8+1+2+2 = **25 bits**.

- **Team decode (T[0],T[1] vs 750 µs):** node1 maps the 2 team bits to red=1 / blue=2 / green=3 /
  yellow=4 (its own base-side numbering; e.g. Yellow = `T[0] > 750 && T[1] < 750`). Note this is the
  *base's* interpretation — reconcile with the BLE `$TID` team codes (1=blue, 2=yellow, 0=red) when we
  verify on the bench; the raw 2-bit field is what matters.
- **Parity check:** a frame is accepted as legit BRX only if `Z[1] != Z[0] && Z[2] < 250` — i.e. the two
  parity bits are never identical and there is no long 3rd parity bit. Good cheap validity filter.

## Why this matters for us

- **B13 (capture the BRX IR bit-layout) is largely answered from source** — this table is the payload
  meaning the Utility Box (B4) emit side and any IR receiver need. Still verify pulse timings/thresholds
  on our VS1838B (tomorrow's kit) before emitting.
- **Per-player attribution (P2) is solvable over IR — no nRF required.** Every shot carries a **6-bit
  player id**. An IR receiver (VS1838B + ESP32-S3) at a base/Companion, or a Companion co-located with a
  player, can decode **who** fired, not just the team the BLE `$HIR` gives us. This is a cheaper P2 path
  than the nRF mesh tap, and it uses hardware arriving 2026-08-26.
- **The nRF mesh tap is a *separate* question.** NRFL-Bases talk to guns over **IR** (above) and only use
  nRF24 **base-to-base** (their own params: addresses `0xB3B4B5B6E0..F5`, RF channel 76 = library
  default, **1 Mbps**, ackPayload, CE/CSN = 9/10). Those are **not** the BRX gun's native
  `NRFhost/NRFslave` kill-confirm mesh params — that network is still unknown and this source does not
  reveal it. (See `docs/experiment-log.md` "feedback fork" + FOLLOWUPS B18.)

## Verify-on-bench checklist (before trusting for emit)
1. Capture a real gun shot on VS1838B → confirm the ~2 ms sync + 25 pulses + ~500/1000 µs marks.
2. Fire from a known player id / team / weapon → confirm P/T/B fields decode to the expected values.
3. Confirm the parity rule holds across many shots.
4. Then wire the emit side (`ir_emit.ino`) and test whether a gun's headset accepts our re-emitted word.
