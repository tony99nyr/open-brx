# BRX IR shot protocol — decoded

**The over-the-air IR word a BRX tagger emits when it fires.** This is the *optical* protocol (what one
gun's IR carries to another gun's headset), distinct from the BLE serial protocol in `brx-protocol.md`.

**Source & credit:** decoded from **LaserTagMods' `NRFL-Bases/NRFL Bases/Nodes/node1.ino`**
(github.com/LaserTagMods) — a referee-free domination *base* that receives gun IR and decodes the BRX
tag. Credit LaserTagMods (JEDGE/JBOX) for the protocol discovery.

**Status: ✅ BENCH-VERIFIED 2026-08-26** on our own rig (ESP32-S3 + VS1838B, Tactix-FE30). Timings, bit
count, field offsets and the parity rule are all confirmed against ground truth pushed over BLE.
Two corrections to the source-derived table are folded in below: the **B field is the IR
protocol / damage type** (not a "bullet type"), and the **Z trailer is a computed parity**, not just
a pair that happens to differ.

## Frame: ~25-bit word, pulse-width encoded

- **Carrier:** 38 kHz, 940/980 nm (a standard VS1838B/TSOP demod receiver recovers it).
- **Sync/start:** a **~2 ms LOW pulse** precedes the frame (node1 gates on `pulseIn(pin, LOW) > 1500 µs`,
  "2 ms sync ± 500 µs"). Use it to detect frame start / reject non-BRX IR.
- **MEASURED on our bench (2026-08-26, Tactix-FE30 @ ~1 m):** sync **1988–1991 µs** · one-marks
  **990–994 µs** · zero-marks **489–512 µs** · spaces **489–512 µs**. The 750 µs split is comfortably
  centred. ⚠ **The `>1500 µs` sync gate is NOT BRX-unique** — a Sony SIRC remote's 2390 µs header
  passes it (captured on the same rig). For a station that lives in a room with TVs, bound the sync
  to roughly **1800–2200 µs** and additionally require 25 bits + the parity rule below.
- **Bits:** each bit is a LOW pulse read by `pulseIn(pin, LOW, 5000)`. Width encodes value —
  **long (~1000 µs) = 1, short (~500 µs) = 0**, split at a **~750 µs threshold** (node1 compares `> 750`).
  Matches the LaserTagMods "25-bit, 1000/500 µs marks" note in `docs/reference/lasertagmods.md`.

## Field layout (in transmit order, after sync)

| Field | Bits | Offset | Meaning | Bench evidence (2026-08-26) |
|---|---:|---|---|---|
| **B** | 4 | 0–3 | **IR protocol / damage type** — the same number as `$WEAP` **t3** and the `$HIR` **tok2** echo. *(node1 called this "bullet type".)* | AR (t3 empty→0) read `0`; rocket (**t3=10**) read **10** |
| **P** | 6 | 4–9 | **player id (0–63)** — per-player identity is in every shot | read `0`, matching Tactix-FE30's registry `player_id: 0` |
| **T** | 2 | 10–11 | team id (4 teams) — cf. BLE `$TID & 3` | read `1`, matching Tactix-FE30's registry `field_id: 1` |
| **D** | 8 | 12–19 | **damage amount** = `$WEAP` **t5** = `$HIR` **tok5** | pushed t5 **22 → 9 → 115**, only these 8 bits moved |
| **C** | 1 | 20 | **critical-hit flag → echoes `$HIR` tok6`** | emitted `crit=1` → `$HIR,0,0,42,2,1,**1**,0`. Reads 0 on every stock weapon — not dead, just never set. We can emit crits. |
| **U** | 2 | 21–22 | **`$SIR` SUBTYPE → echoes `$HIR` tok7** *(node1 called this "unknown/reserved")* | rows pushed for subtypes 0/1/3; U=0/1/3 all registered and echoed, **U=2 — the only one without a row — was ignored** |
| **Z** | 2 | 23–24 | **computed parity** over bits 0–22 (see below) | 4/4 frames match the rule |

**B and U together are the `$SIR` composite key `<protocol, subtype>`** — the exact index a `$SIR`
row is looked up by. 4 bits and 2 bits — 16 × 4 = **64 addressable effect cells, and the table is ours to write
over BLE.** A victim registers an IR event **only if a row exists for that cell**; with no row the hit
is silently dropped (this is why an incomplete table produced repeated false negatives on the bench).

> **Correction (same session):** an earlier note here called the 4-bit protocol field "a hard
> constraint" leaving "~10 free slots". That framing was wrong — scarcity of protocol *numbers* is not
> the limit, because both halves of the key are assignable and the row's **function** is what decides
> the effect. Stock BRX occupies `0` standard, `8` charge, `10` rocket, `11` gas, `13` melee,
> `15` grenade beacon; everything else is free, and even occupied protocols are re-definable per game
> since we push the table. ⚠️ "Everything else is free" is too strong: `brx-protocol.md` §5 also
> ships rows on protocols **1, 2, 3, 6 and 9**, so the genuinely unused values are 4, 5, 7, 12 and 14.

4+6+2+8+1+2+2 = **25 bits** (node1 reads a 26th "Z2" pulse only to confirm it is short — the
end-of-frame check, not a data bit).

- **Team decode (T[0],T[1] vs 750 µs):** node1 maps the 2 team bits to red=1 / blue=2 / green=3 /
  yellow=4 (its own base-side numbering; e.g. Yellow = `T[0] > 750 && T[1] < 750`). Note this is the
  *base's* interpretation — reconcile with the BLE `$TID` team codes (1=blue, 2=yellow, 0=red) when we
  verify on the bench; the raw 2-bit field is what matters.
- **Parity rule — BENCH-DERIVED 2026-08-26 (the source did not give this).** `Z` is not merely a
  differing pair: it is a **parity over the 23-bit payload (bits 0–22)**.

  > **odd number of 1s → `Z = 01` · even number of 1s → `Z = 10`**

  Verified on four distinct words: damage 22 (4 ones, even → `10`), damage 9 (3, odd → `01`),
  damage 0 (1, odd → `01`), rocket damage 115 (8, even → `10`). Because the two values are always
  `01` or `10`, node1's cheap `Z[1] != Z[0]` test never fails on a real frame — which is why the
  weaker rule appeared sufficient from the source alone.

  **⚠ CORRECTION (tested 2026-08-26, same session): the gun does NOT enforce this parity.** An
  earlier note here claimed a synthesized word "must carry the correct computed parity or a gun
  should reject it" — that was inferred, not measured. Emitting at Tactix-FE30, 8 shots per variant:

  | Z sent | registered |
  |---|---|
  | rule-correct (`01` here) | **8 / 8** |
  | deliberately wrong but differing (`10`) | **8 / 8** |
  | `00` | **0 / 8** |
  | `11` | **0 / 8** |

  So the gun's actual acceptance test is exactly node1's cheap one — **`Z0 != Z1`**, nothing more.
  Either differing pair is accepted; equal pairs are rejected outright. The odd/even rule above is
  still a true description of what **genuine BRX frames emit**, so `encode_word()` keeps computing it
  for fidelity (and `decode_word()` reports `parity_matches`, useful for telling our traffic from a
  real gun's) — but it is **not** an acceptance gate, and an emitter that gets it "wrong" still lands.
- **Frame acceptance (node1's own test):** `Z[1] != Z[0] && Z[2] < 250` — the trailing short pulse
  (<250 µs) marks end-of-frame. Keep it, but prefer the full parity check above.

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
1. ✅ **DONE 2026-08-26** — captured real Tactix-FE30 shots on VS1838B: ~1990 µs sync, 25 bits, 990/500 µs marks.
2. ✅ **DONE 2026-08-26** — P and T matched the armory registry; **B and D pinned by pushing known
   `$WEAP` frames over BLE** (AR t5=9, rocket t3=10/t5=115) and watching only the expected bits move.
3. ✅ **DONE 2026-08-26** — parity holds on 4/4 frames, and the *rule* behind it is now known.
4. ✅ **DONE 2026-08-26** — emit side wired and **a stock tagger accepted a fully synthetic word**
   (invented player 42 / team 2 / damage 33 landed as a real `$HIR` and killed the player). B4's
   gating proof.

**Capture gotcha (our rig, not the protocol):** `ir_capture.ino` prints a long `RAW` line per frame,
and at 115200 that takes ~15 ms — any shot landing inside that window is captured truncated. The
symptom is a run of frames that are *prefixes* of the real word (16/17/20/21/24 bits). **FIXED 2026-08-27** — `IDLE_GAP_US` raised 8000 → 30000 and the RAW dump is now **toggleable with `r`**. **Send `r` to turn RAW off for any capture that matters**; it is a debugging aid, not a capture mode. This bug silently cost four captures (the `$GREN` accessory word, the Sentinel EMP ability, and two death-nova attempts) before it was found.
