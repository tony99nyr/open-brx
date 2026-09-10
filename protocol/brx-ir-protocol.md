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

- **Carrier:** 38 kHz, 980 nm (the wavelength on the gun's Class 1 IEC 60825-1 label; not
  measured here). A standard VS1838B/TSOP demod receiver recovers the carrier. Many hobby IR
  parts are centred on 940 nm, so pick 980 nm-capable receivers.
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

## The grenade beacon: protocol 15 carries an OWNER (bench 2026-09-10)

A grenade emits a **beacon** on protocol 15 whose **magnitude is the MODE** and whose **team bits are the
OWNER**: hill `mag=8` every ~5 s, respawn `mag=6` every ~2.5 s. **Neutral is team 2.** Shooting a neutral
grenade claims it, and the very next beacon carries the shooter's team — measured end to end: neutral
`proto=15 team=2 mag=8`, a red gun fires `proto=0 player=5 team=0 mag=22`, and every following beacon reads
`proto=15 team=0 mag=8`, held for ten beacons.

✅ **Capture is CHARGE, and ANY weapon can do it (bench 2026-09-10).** Shooting a grenade adds charge; enough
charge flips it to the shooter's team. Measured end to end: one AR round (`mag=9`) claimed a neutral hill, and an
AR magazine then retook that owned hill within its first 13 rounds — **with no extra-headset emission involved**.
This confirms the charge mechanic `docs/reference/grenade.md` already documented, and matches native play, where
every player captures regardless of weapon. Two earlier readings are RETRACTED: that owned hills cannot be
retaken at all, and that capture requires the extra-headset word (`$WEAP` t1=2) — a shotgun's one `mag=70` word
simply out-charged four AR rounds at 36. Charge accumulates, and **an EQUAL total flips it — the attacker wins ties** (1 AR round took a hill holding 9; 5 AR rounds took one holding 45; one shotgun `mag=70` shell took one holding 45). The currency LOOKS like **MAGNITUDE**, which would make a weapon's capture power equal its damage — but that is 🟠, not settled. ⚠ **The discriminating trial is CONFOUNDED:** the shotgun's `mag=70` is its `t12` **extraHeadsetDamage** (a `t1=2` weapon), so magnitude and weapon-block varied together and it cannot separate "magnitude is the currency" from "an extra-headset word captures out of proportion". ⚠ And both AR flips were at **exact equality** (9 v 9, 45 v 45), so what is measured is **the attacker wins ties**, not "the higher total owns the point". See F70/F76. ⚠ Max charge unmeasured. **Do not build an objective economy on the exchange rate until F76 resolves.**
Power-cycling returns a grenade to neutral (team 2).

⭐ **CAPTURE IS ANNOUNCED, not just inferred, and now CONFIRMED CLEANLY OVER BLE (bench 2026-09-10).** A grenade
changing hands emits **two words**, `mag=53` and `mag=50` — but they are **two separate events roughly 5 s
apart, not one pair in the same burst.** Read verbatim off a live BLE stream (gun on team 1, a neutral grenade,
one AR round at `mag=24`):

```
t=41769  $BUT,0,1  + $ALCD,31->30   <- operator's shot
t=41770  $HIR,4,15,0,2,8,0,0        <- last NEUTRAL beacon (team 2)
t=41820  $HIR,4,15,0,1,50,0,0       <- mag 50: NEW OWNER = team 1, ~50 ms after the shot
t=46780  $HIR,0,15,0,2,53,0,0       <- mag 53: state LEFT = team 2, 5.0 s later, next beacon cycle
t=46780  $HIR,4,15,0,1,8,0,0        <- first ordinary HILL beacon owned by team 1
```

| word | bits | meaning | arrives |
|---|---|---|---|
| `proto=15 team=<new> mag=50` | `1111000000010011001000010` (to team 1) | the owner being **ENTERED** | **immediately** (~50 ms after the capturing shot) |
| `proto=15 team=<old> mag=53` | `1111000000100011010100001` (from neutral) | the state being **LEFT** | **on the NEXT beacon cycle** (~5 s later) |

**Design consequence: a node must not wait for both words before announcing a capture.** `mag=50` alone is the
capture signal and arrives right away; `mag=53` is a late confirmation of what was left behind, not part of the
same transaction. (One line also worth keeping: `mag=53` above rode in on **sensor 0**, the headset front, while
the ordinary hill beacons ride **sensor 4**, the gun body — consistent with F85, one grenade transmission
reaching more than one sensor.)

**This is very likely why guns announce "hill captured"** — the grenade tells them, rather than each gun
inferring it from a beacon whose team changed. A hosted game with the protocol-15 row hears it too, so a node can
fire a capture callout at the moment it happens instead of up to 5 s later.
⚠️ **Capture PROGRESS is not on the wire.** No charge value has ever been observed; the beacon carries owner and
mode only. Progress lives inside the grenade, so a hosted mode learns the discrete transition and **cannot draw a
capture bar**. Design around the event, not a percentage.

🔴 **Correction (2026-09-10 evening): "a transition PAIR in the same burst as the shot" was wrong, and it is
corrected here and everywhere else it was written down.** The original reading came from the ESP32 IR rig,
where the words showed up STITCHED into one overlapping capture and read as simultaneous. **They are not
simultaneous** — the BLE stream above shows `mag=50` 50 ms after the shot and `mag=53` a full beacon cycle
(~5 s) later. **Why the words used to only decode as STITCHED frames on the IR rig** (Tony, 2026-09-10): the
grenade's `mag=50` reply is essentially instantaneous, so it overlaps the SHOOTER's own word in the air; the
burst the receiver split literally contained both — `word1/2` the gun's shot, `word2/2` `mag=50`. `mag=53`,
arriving 5 s later on its own beacon cycle, was never really part of that burst at all; it only ever looked
adjacent because the rig's capture window happened to span both. **This still correctly explains why the IR
rig alone could never cleanly separate `mag=50` from the shooter's word** — that half of the finding stands —
but it does not describe the actual timing, which the BLE stream now settles unambiguously. Decoding whole and
unambiguous on a clean BLE capture, rather than only as byte-identical stitched fragments, is also a real
upgrade in evidence tier for the words themselves, independent of the timing correction: they are no longer
inferred from overlapping-burst artifacts, they are read directly off the wire. ⚠ Geometry (receiver behind the
grenade, not the shooter) is still worth doing for anyone repeating this on the IR rig alone, and a word that
only ever occurs inside a shot's burst remains the risk F75 names — but the capture pair itself is no longer in
that category.

✅ **SETTLED, n=2 (2026-09-10 evening): `mag=53` means the point WAS NEUTRAL; `mag=50` announces the incoming
owner on EVERY capture, neutral or enemy-to-enemy.** `mag=50` is confirmed for a team-to-team takeover too, and
**TWO independent enemy-to-enemy captures, both on continuous BLE streams, both carried `mag=50` with NO
`mag=53`:** first blue→red (gun on team 1 holding a hill, `$TID` live-written to 0, next shot took it —
`$HIR,4,15,0,0,50,0,0`, then ordinary `mag=8` beacons owned by red), then a second run red→blue the same
evening (`$TID` switched back to 1 mid-stream, `$HIR,4,15,0,1,50,0,0` on the flip, `mag=8` beacons owned by blue
after). Neither had a thin-window excuse. A neutral→blue capture earlier the same evening, on the same kind of
continuous connection, DID carry `mag=53` right alongside `mag=50`. The runs differ in exactly one variable —
whether the outgoing state was neutral — which settles it. **Method note, because it is why this settles what
the IR rig runs could not:** every one of these was a continuous BLE stream with the gun armed and listening
before, during and after the transition, not a thin IR capture window that could plausibly have missed a word
that was actually there. **Design consequence:** a node can tell "captured from neutral" apart from "stolen
from an enemy" purely from whether `mag=53` shows up — which is exactly the distinction native needs to pick
between callouts. And it reconfirms the capture-timing rule above: a node must fire on `mag=50` alone and never
wait for `mag=53`, because on an enemy-to-enemy capture it never arrives at all.

⚠️ **A hosted game sees none of this unless we ship a protocol-15 `$SIR` row** — the firmware discards an
unmatched cell in silence, which is why "station words do nothing in a host-driven game" (B23). One row makes
beacons arrive as `$HIR,<sensor>,15,0,<owner>,<mode>,0,0` with no pool change. ⚠️ **That is necessary and NOT
sufficient: `app/src/engine.js:1273` discards every `$HIR` with proto 15 before the phone reads it**
(`if (t[2] === '15') break;`), so the row reaches the GUN and still not the player. Reading a beacon in a
hosted game needs both (F72).

⭐ **SHIP FUNCTION 28, NOT 24 (F73, bench-swept 2026-09-10).** The row proved out here first was
`$SIR,15,0,,24,0,0,1,,*`, and it works — but **fn 24 gives the player a flash, a buzz and a long grenade-ish
clip on every beacon**, which a hill emits every ~5 s for as long as anyone stands there. **fn 28 registers
with NOTHING — no sound, no headset flash, no vibration** — so the host reads an IR event the player never
perceives. That is what a beacon row wants: `$SIR,15,0,,28,0,0,1,,*`. ✅ **Confirmed on a real beacon, protocol
15, bench 2026-09-10 evening (rung F73-b closed).** The original sweep ran fn 28 only in cell `<5,0>` with the
ESP32 rig's synthetic words, so "ship it on protocol 15" was an assumption. Armed a gun for real with
`$SIR,15,0,,28,0,0,1,,*` against the live grenade: the beacon arrived as `$HIR,4,15,0,2,8,0,0`, 20+ consecutive
beacons, period 5.0 s, no drift — the cell is the key, the function is the effect, and it holds on real
hardware. Polarity applies to both: they are
enemy-only under `$GSET` t1 = 0, so a gun sees only hills it does NOT own; **t1 = 1 lifts the gate** and the
owner arrives in `$HIR` token 4, which is how a host reads who holds a point.

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

## Native words captured off the air (reference rows)

| Source | B (proto) | P | T | D (magnitude) | C | U | Note |
|---|---|---|---|---|---|---|---|
| Assault Rifle | 0 | id | team | 9 | 0 | 0 | the stock AR emits 9, not the manual's 24 |
| Shotgun | 0 | id | team | 45 | 0 | 0 | |
| Sniper | 0 | id | team | 80 | 0 | 1 | subtype 1 keys the fn-36 row |
| Rocket Launcher | 10 | id | team | 115 | 0 | 0 | |
| Melee (gyro swing, native game) | 13 | id | team | 90 | 0 | 1 | subtype 1 = Rifle Bash |
| Supremacy Sentinel death-nova (headset) | 10 | dying player | dying team | 125 | 0 | 0 | credits kills to the corpse |
| **Smart Grenade, Respawn station: boot / announce** | 15 | 0 | 0 | **56** | 0 | 0 | `1111000000000011100000001`; sent once at power-up; before a game starts it **arms** a tagger (self-respawn off, "respawn enabled" at start) |
| **Respawn station: beacon** | 15 | 0 | owner | **6** | 0 | 0 | `1111000000010000011000001` (owner = team 1 shown); every ~2.5 s; **revives a dead, armed gun of that team** (4/4; wrong team 0/1); does not arm a running game |
| **Respawn station: button** | 15 | 0 | owner | 6 | **1** | 0 | `1111000000010000011010010`; the beacon with the crit bit; **arms a tagger mid-game** |

The three station words were captured on the VS1838B receiver and **replayed from the ESP32 emitter with the
grenade out of the building** on 2026-09-04: our emitter is a working respawn station for native games. Host-driven
(Mission Control) games ignore all three, with or without a `$SIR` row for protocol 15; the station logic is
native-mode firmware (FOLLOWUPS B23). Full behaviour and the arming paths: `docs/reference/grenade.md`
§Respawn Station mode; evidence `docs/experiment-log/2026-09.md` (2026-09-04). The Hill / Assault / CTF / Frag
words and the headset-front-plus-trigger request word are not yet captured intact.
