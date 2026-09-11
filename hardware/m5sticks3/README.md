# M5StickS3 station node

The first hardware Station (the ESP32 objective box of `../brx-station-spec.md`) in a case you can buy:
an M5StickS3 ($21.50, ESP32-S3, IR both ways, 1.14" screen, speaker, 250 mAh) running one sketch. It
hears BRX IR words on its own receiver, tracks who owns a control point, advertises the owner over BLE
in the same packet the phone HUDs already decode, emits BRX words, and paints the owner on the screen.

IR protocol credit: **LaserTagMods** (JEDGE/JBOX) decoded the BRX tag; `protocol/brx-ir-protocol.md` is
our bench-verified copy. The advert is `docs/spec/utility.md` section 2. The grenade facts this leans on
are the 2026-09-10 bench (`docs/experiment-log/2026-09.md`).

Status 2026-09-11: **compiles for the board, host tests green, never run on a Stick.** The hardware is
inbound. Everything under "Unverified" below is exactly that.

## Files

| file | what |
|---|---|
| `m5sticks3.ino` | the Arduino wrapper: RMT receive on G42, RMT transmit with a hardware 38 kHz carrier, NimBLE advert, M5Unified display and buttons, Preferences |
| `brx_ir.h` | pure C++: pulse durations to bits to fields, and back; the measured timings; the parity rule |
| `brx_advert.h` | pure C++: the 16-byte advert and its UUID string, an exact port of `app/src/beacon.js encodeUuid`; the republish policy from `control.js` |
| `control_point.h` | pure C++: the BRIDGE and HILL ownership state machines |
| `test/test_core.cpp` | host tests for the three headers, run by `mcp/tests/test_sticks3_core.py` when `g++` exists |

The three headers never include Arduino, so the logic is tested on the laptop and the sketch is only
plumbing. Keep it that way.

## Pin map (StickS3)

| pin | role | note |
|---|---|---|
| G42 | IR receiver | **RMT only**: M5's docs say GPIO-interrupt decoding does not work on this pin, and the speaker amplifier must be off or reception fails. The sketch never brings the speaker up |
| G46 | onboard IR LED | default transmit pin |
| G10 | Grove yellow (SCL) | M5Unified maps the port SCL = G10, SDA = G9, and M5 puts SCL on the yellow wire, which is a Seeed Grove module's SIG (pin 1): the Grove Infrared Emitter is `TXPIN 10`. M5's StickS3 web page lists the colours the other way, so if nothing fires try `TXPIN 9` |
| G9 | Grove white (SDA) | free (or the emitter, see above) |
| Grove red / black | 5 V / GND | 0.38 A budget on the 5 V rail |
| G11 / G12 | buttons A / B | hold A: reset to neutral. Hold B: toggle BRIDGE / HILL. Clicks do nothing, so a knock cannot flip a point |
| HAT header | EXT_5V, GND, G1 to G8, G10, G43, G44 | where the ring goes when the emitter has the Grove port |

Nothing needs wiring for the first bench gate.

## Build and flash

```
arduino-cli config add board_manager.additional_urls https://static-cdn.m5stack.com/resource/arduino/package_m5stack_index.json
arduino-cli core update-index
arduino-cli core install m5stack:esp32          # 3.3.9 has the m5stack_sticks3 board
arduino-cli lib install M5Unified               # 0.2.21 knows the StickS3 (pulls M5GFX)
cd hardware/m5sticks3
arduino-cli compile --fqbn m5stack:esp32:m5stack_sticks3:PartitionScheme=default_8MB .
arduino-cli upload  --fqbn m5stack:esp32:m5stack_sticks3:PartitionScheme=default_8MB -p <port> .
```

`default_8MB` gives a 3 MB app partition; BLE plus M5Unified does not fit the 1.2 MB default. On
Windows the port is a `COM` number, on the Mac `/dev/cu.usbmodem*`. WSL cannot see USB, so flash from
Windows Python or the Mac (the same rule as the DevKitC rig).

## Serial (115200)

The capture and emit formats are the DevKitC rig's, so the existing tools work unchanged.

| command | does |
|---|---|
| `r` / `s` / `c` | toggle the RAW dump / print frame count / clear, as `ir_capture.ino` (`native_capture.py` sends a bare `r` and reads the `# RAW dump ON` echo) |
| `TX <bits>` · `TXN <n> <bits>` · `AUTO <bits>\|OFF` · `PING` | as `ir_emit.ino` |
| `STATUS` | mode, owner, per-team charges, captures, advert seq and count, words heard, settings, the live UUID |
| `MODE BRIDGE\|HILL` | ownership mode, persisted. Resets the point |
| `ID <n>` · `GAME <n>` | advert bytes 6-7 and 13, persisted; a republish follows |
| `TXPIN 46\|9\|10` | onboard LED or the Grove emitter (either Grove signal pin), persisted |
| `RESET` | neutral, charges cleared |

Every received burst except the Stick's own echo prints `RAW n edges=.. us=[...]`, `DECODE bits=..
val=...`, and on a complete word (exactly 25 bits; a 26-bit frame is discarded, because an inserted
segment shifts every field and can still pass both parity tests) `SHOT player= team= dmg= proto=
crit= parityOK= genuine=`. `parityOK` is the gun's own test
(Z0 != Z1); `genuine` is the odd/even rule every real BRX frame carries, and ownership only moves on
words that pass both, so a corrupted word cannot credit the wrong team. An ownership change adds
`OWNER team=..`, every BLE republish adds `ADVERT <uuid> seq=..`, and a BRIDGE that loses its beacon
prints `ADVERT withdrawn`.

## The two modes

**BRIDGE** (default): the Stick sits in the grenade's beacon cone and repeats what the grenade says.
`proto=15 mag=8` carries the owner in its team bits, team 2 meaning neutral. `mag=50` is the capture
word, ~50 ms after the shot, and its team bits are the NEW owner: ownership moves on it at once and the
advert's rising bit shows for 1.5 s; the next beacon, ~5 s later, only confirms.
Two missed beacons (12 s) withdraw the BLE advert: a stale owner would look exactly like a live neutral
point on the phones, so the Stick says nothing and the phones' own 4 s expiry drops the point. The
screen keeps the last owner and says the beacon is lost. One miss changes nothing, because rung R
showed the beacon drops out in runs. Nothing is advertised before the first beacon either. Respawn
(6), boot (56) and was-neutral (53) never touch ownership. Shots are ignored: the grenade is the
authority.

**HILL**: the Stick is the hill. `proto=0` shots add their magnitude to the shooter's team; when the
attacker's total reaches the holder's total the point flips and the winner holds the total it took
to win (5 AR rounds took a hill holding 45, and it then held 45). That is
the **PROVISIONAL** rule from 2026-09-10 (attacker wins ties, F76 still open on the currency), and it
lives in one function in `control_point.h` so it can change without touching anything else. The hill
emits the grenade's own beacon word every 5 s (`proto 15, team = owner or 2, mag 8`) so stock guns
react through `$SIR,15,0,,28`. A hill held by team 2 therefore beacons as neutral on IR, exactly as a
stock grenade would (F82: never field a team on tid 2 in a hill game); the BLE advert still says team 2.
The advert's value byte is the holder's share of all charge, 0 to 100.

Both modes advertise `role 1, kind 5 (control), id, team (255 = neutral), state bits (held 1,
rising 4), value, seq, game` as one 128-bit service UUID, non-connectable, republished at once on an
owner or state change and at most once a second on a value-only change.

## First bench gate (one evening, Stick alone)

1. Flash, open the serial monitor, confirm `# BRX StickS3 station ready`. In BRIDGE mode no `ADVERT`
   line appears until a beacon is heard; `MODE HILL` advertises at once.
2. `MODE BRIDGE`. Power a grenade in hill mode, hold the Stick's receiver in its beacon cone at 6 ft.
   Expect a `SHOT ... proto=15 team=2 dmg=8` line every ~5 s and the screen saying NEUTRAL / beacon ok.
3. Shoot the grenade with a red gun. Expect `dmg=50` within ~50 ms, then `proto=15 team=0 dmg=8`,
   `OWNER team=0`, an `ADVERT` line, and a red screen.
4. On a HUD phone, confirm the control point appears with the same owner (the phone decodes the UUID
   with `decodeUuid`; the `id` and `game` must match what the phone expects, `GAME 0` means any).
5. `MODE HILL`, point a gun at the Stick's receiver and fire once. Expect `proto=0`, `OWNER`, the
   screen in the gun's colour, and a stock gun with `$SIR,15,0,,28` reacting to the Stick's beacon.
6. Range walk with `TXPIN 46` then `TXPIN 10` (Grove emitter; `TXPIN 9` if the emitter is silent),
   stepping 2 ft at a time with a gun as the witness. Write the cliff into the experiment log; the
   bare LED rig cliffed at 8 to 10 ft.

## Unverified

- **The receiver part on G42 is undocumented.** M5's NEC example runs at 38 kHz, so it is a
  demodulating receiver, but its bandwidth at our 500 us marks and its sensitivity to a 980 nm gun
  are unmeasured. Step 2 above is the test.
- **The receiver output polarity is assumed active-low, idle high** (every TSOP-class part). If the
  RAW durations come out shifted by one, flip the `lvl[k] != 0` test in `symbolsToDurations`.
- **RMT idle threshold is 20 ms** at a 1 us tick. Burst fire closer than that fuses frames; lower it
  if two words merge, the way `ir_capture.ino`'s gap was tuned.
- **The 38 kHz carrier duty is 33 %** via `rmtSetCarrier`; the DevKitC rig used 50 % on LEDC. Either
  registers on a gun; 33 % is what M5's own example uses.
- **Self-hearing.** The onboard LED and receiver are millimetres apart. The sketch re-arms the read
  after every transmit and drops a word that matches what it just sent within 150 ms. If the hill's
  own beacon still shows up as `SHOT`, that filter needs widening, not the receiver.
- **BLE UUID byte order.** The sketch feeds the UUID string to `BLEUUID`, which stores it reversed,
  so the phone reads back the same string `encodeUuid` produces. That is how the ESP32 library is
  written (`BLEUUID.cpp` fills `[15 - n]`); it is not yet seen on a phone screen.
- **A non-connectable, non-discoverable advert** (NimBLE `BLE_GAP_CONN_MODE_NON` with no scan
  response drops the discoverable flag). Android and iOS scanners still report it when they filter by
  service UUID, which the HUD does; if a phone never sees the Stick, try `setScanResponse(true)`.
- **Speaker off** is settled in the library, not on the bench: M5Unified's StickS3 branch drives the
  PM1 amp-enable line low at boot and with `internal_spk = false` never installs the enable callback,
  so the amp stays off. Left here only so nobody re-adds the speaker to a receiving Stick.
- **The hardware glitch filter is 3 us**, the ceiling of the 80 MHz filter clock. The 100 us the
  DevKitC sketch used is impossible here and would stop the receiver arming at all.
- **Battery life** with BLE advertising, RMT receive and the screen at brightness 120 is guessed at
  two hours. Measure it.
- **Emitter range** on both pins is unmeasured; Seeed's "10 m" is to a TV receiver.
