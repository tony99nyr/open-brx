# The IR word — what a shot carries through the air
_A 25-bit pulse-width-encoded word on a 38 kHz carrier, decoded from LaserTagMods' base-station source and verified on our own receiver and emitter_
Last verified: 2026-08-27

## Credit.
The layout was decoded from **LaserTagMods' NRFL-Bases** `node1.ino` (a referee-free domination base that receives BRX shots), then bench-verified: timings, bit count, field offsets and the parity rule were all confirmed by pushing known `$WEAP` frames over BLE and watching only the expected bits move. A stock tagger then **accepted a fully synthetic word** from our emitter (invented player 42 / team 2 / damage 33 landed as a real `$HIR` and killed the player).
Source: protocol/brx-ir-protocol.md

## Physical layer
- Carrier **38 kHz**, **940/980 nm** — a standard VS1838B/TSOP demodulating receiver recovers it. Laser rated 16.9 mW on the gun's USB record.
- **Sync:** one ~2 ms LOW pulse before the frame — measured **1988–1991 µs**.
- **Bits:** each bit is a LOW pulse; **long ≈ 1000 µs = 1** (measured 990–994), **short ≈ 500 µs = 0** (489–512), spaces 489–512 µs; decision threshold ~750 µs.
- **End of frame:** a trailing short pulse (< 250 µs in node1's test).
- ⚠ A `> 1500 µs` sync gate is not BRX-unique (a Sony SIRC remote's 2390 µs header passes it). Bound sync to ~1800–2200 µs and require 25 bits + the parity rule.
Source: protocol/brx-ir-protocol.md; protocol/brx-protocol.md §7c (laser mW)

## Word layout (transmit order after sync; 25 bits)
| Field | Bits | Offset | Meaning | Bench evidence | Conf |
|---|---:|---|---|---|---|
| **B** | 4 | 0–3 | IR protocol / damage type = `$WEAP` t3 = `$HIR` tok2 = `$SIR` protocol key | AR read 0; rocket (t3=10) read 10; native melee read 13 | ✅ |
| **P** | 6 | 4–9 | player id 0–63 = `$PSET` token 1 = `$HIR` tok3 | matched the registry | ✅ |
| **T** | 2 | 10–11 | team id 0–3 = `$TID & 3` = `$HIR` tok4 | matched | ✅ |
| **D** | 8 | 12–19 | magnitude = `$WEAP` t5 = `$HIR` tok5 | pushed 22 → 9 → 115; only these bits moved | ✅ |
| **C** | 1 | 20 | critical flag → `$HIR` tok6, applies ×(1 + `$GSET` t7/100) | emitted crit=1 → `$HIR,…,1,…` | ✅ |
| **U** | 2 | 21–22 | `$SIR` subtype → `$HIR` tok7 | U=0/1/3 registered with rows; U=2 (no row) ignored | ✅ |
| **Z** | 2 | 23–24 | parity trailer | see rule | ✅ |
Source: protocol/brx-ir-protocol.md; docs/experiment-log.md (2026-08-26 melee capture)

_[diagram DEV-06: Bit-field ruler of the 25-bit word with the sync pulse and a sample pulse train (`1101000111010101101000110` = protocol 13, player 7, team 1, magnitude 90, crit 0, subtype 1 — a genuine captured melee swing).]_

## Parity — what genuine frames emit vs what the gun checks.
Real BRX frames set Z by parity over bits 0–22: **odd number of ones → `01`, even → `10`** (4/4 captured frames). But the gun's acceptance test is only **`Z0 ≠ Z1`**: `01` and `10` both land 8/8, `00` and `11` are rejected 0/8. Compute the true parity for fidelity; use the mismatch to tell your own traffic from a real gun's.
Source: protocol/brx-ir-protocol.md

```python
def encode_word(proto: int, player: int, team: int, magnitude: int, crit: int, subtype: int) -> str:
    """25-bit BRX IR word as a bit string (MSB of each field first), Z = genuine-frame parity."""
    bits = (f"{proto & 0xF:04b}{player & 0x3F:06b}{team & 0x3:02b}"
            f"{magnitude & 0xFF:08b}{crit & 1:01b}{subtype & 0x3:02b}")
    ones = bits.count("1")
    return bits + ("01" if ones % 2 else "10")

def decode_word(bits: str) -> dict:
    assert len(bits) == 25
    payload, z = bits[:23], bits[23:]
    return {
        "proto": int(payload[0:4], 2), "player": int(payload[4:10], 2),
        "team": int(payload[10:12], 2), "magnitude": int(payload[12:20], 2),
        "crit": int(payload[20]), "subtype": int(payload[21:23], 2),
        "accepted": z[0] != z[1],
        "parity_matches": z == ("01" if payload.count("1") % 2 else "10"),
    }
```
Source: protocol/brx-ir-protocol.md (rule); illustrative implementation

## Native emissions captured off the air
| Source | Word | Note | Conf |
|---|---|---|---|
| Assault Rifle | proto 0, magnitude 9 | The stock AR emits 9, not the manual's 24 | ✅ |
| Shotgun | proto 0, magnitude 45 | | ✅ |
| Sniper | proto 0, subtype 1, magnitude 80 | | ✅ |
| Rocket Launcher | proto 10, magnitude 115 | | ✅ |
| Melee (gyro swing, native game) | proto 13, subtype 1, magnitude 90 | Subtype 1 = Rifle Bash | ✅ |
| Supremacy Sentinel death-nova (headset) | proto 10, magnitude 125, player/team = the **dying** player | Out-damages the rocket; credits kills to the corpse | ✅ |
Source: protocol/brx-protocol.md §7r addendum; docs/experiment-log.md

## Headset emission cannot be forced over BLE.
`$IRTX`, `$HFIRE`, `$MELEE` and `$BHIT` produced zero IR with a receiver control passing before and after. The headset emits only for a physical melee swing in a native game and for the Sentinel death-nova.
Source: docs/experiment-log.md (2026-08-26 headset emission)

- **Do I need a victim gun to test an emitter?** No — a VS1838B on an ESP32 decodes the word, and the sync/mark timings above are the acceptance spec.
- **Can a station revive a dead player by IR?** No. A dead gun ignores all IR; stations *arm* a living tagger's respawn path.
- **Why do my captured frames come out as prefixes (16/17/20/21 bits)?** Your capture sketch is printing while the next frame lands. Turn the RAW dump off.
Source: protocol/brx-ir-protocol.md · docs/experiment-log.md (448-word brute force) · docs/gotchas.md; protocol/brx-ir-protocol.md (capture gotcha)
