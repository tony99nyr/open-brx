# M5StickS3 station node

The first hardware Station (the ESP32 objective box of `../brx-station-spec.md`) in a case you can
buy: an M5StickS3 ($21.50, ESP32-S3, IR both ways, 1.14" screen, speaker, 250 mAh) running one
sketch. This is the ONE place to work with it: build, flash, bench, and how the firmware works.

IR protocol credit: **LaserTagMods** (JEDGE/JBOX) decoded the BRX tag; `protocol/brx-ir-protocol.md`
is our bench-verified copy.

## What it is

A kind-5 control-point station (`docs/spec/utility.md` §5d). It runs one of two modes:

- **BRIDGE** (default): the Stick sits beside a stock grenade and repeats what the grenade's own
  beacon says. It decides nothing; the grenade is the authority.
- **HILL**: the Stick is the hill. It takes shots on its own receiver and decides ownership itself.

Either way it advertises the owner over BLE, in the same kind-5 packet every HUD phone already
decodes, and emits BRX IR words on its own LED or a Grove emitter.

How it fits the game:

- Phones accept the Stick's IR words only when the game's `station_source` is `grenade`. The Stick
  behaves like a grenade on the wire in both modes. Whether a Stick should get its own
  `station_source` value, instead of borrowing `grenade`'s, is the open **H8** decision
  (`docs/spec/utility.md` §5g.7).
- Arming the Stick from Mission Control over Wi-Fi, and everything else about it as a non-phone
  utility node, is designed but not built: the spec is `docs/spec/utility.md` §5g.

## Status

**2026-09-23: first bring-up on a real Stick.** Flash, boot, and serial all work. The BLE advert
and IR transmit both work. IR receive of a gun shot is open (**F314**): the receiver hears a burst
of the right length at close range, but the decode comes out distorted, so the strict decoder
rejects it and no gun shot has decoded yet. Full gate results and the rerun plan are in
`docs/bench-sticks3-2026-09-23.md`; that sheet is the source of record for gate procedures and the
running results, not this file.

**Settled at the bench (2026-09-23):** the receiver's output is active-low, idle-high, as the firmware assumes: the
rig's word arrived at 6 in with the right bit order and mark widths (about 1020 and 520 us).

**Bench to confirm:**

- Whether a gun shot decodes at some distance at all, and if so, which distance (F314).
- What a `SELFTEST` PASS means, given M5 asks for 30 cm between sender and receiver and the
  self-test runs at millimetre range.
- The source of an intermittent ~650 Hz stream of 144 us pulses seen during bring-up.
- The emitter's real range on either TX pin (Seeed's "10 m" is to a TV receiver, not a laser-tag
  receiver).
- Which Grove pin (G9 or G10) the yellow wire actually drives on this unit.

## Hardware and pins

| pin | role | note |
|---|---|---|
| G42 | IR receiver | RMT only. M5's own IR example uses this pin (docs.m5stack.com/en/arduino/m5sticks3/ir_nec) and warns the speaker amplifier must be off or reception fails. The sketch never brings the speaker up |
| G46 | onboard IR LED | default transmit pin |
| G9 / G10 | Grove port (SDA / SCL) | the yellow-wire question: M5's own StickS3 pinout page (docs.m5stack.com/en/core/StickS3) says the yellow wire is SDA = G9. An earlier firmware comment guessed the opposite (SCL = G10 on the yellow wire, from M5Unified's port mapping, not the pinout page). The firmware accepts either as a Grove emitter pin (`TXPIN 9` or `TXPIN 10`), so this is safe to leave open until the bench settles which one lights the emitter |
| G11 / G12 | buttons A / B | hold A: reset the point to neutral. Hold B: toggle BRIDGE / HILL. A click does nothing on either, so a knock cannot flip a point |
| small side button | power, and download mode | this is the Stick's power button. Held while plugging in USB, it puts the board into download mode (needed once, on the first flash over factory firmware only) |
| HAT header | EXT_5V, GND, G1-G8, G10, G43, G44 | where a ring or an external emitter goes when the Grove port is busy |

The speaker amplifier must stay off: the sketch calls `M5.Speaker.end()` and sets `internal_spk =
false`, matching M5's own warning above. Nothing needs wiring for the first bench gates; only the
Grove pin question needs hardware in hand.

## Power

The IR receiver and the onboard IR LED both run off the M5PM1 EXT_5V rail, which M5Unified leaves
off by default (docs.m5stack.com/en/arduino/m5sticks3/m5pm1: disabling EXT_5V "turns off power to
the Grove interface, Hat EXT_5V interface, and IR TX/RX"). The firmware turns it on with
`M5.Power.setExtOutput(true, m5::ext_none)` in `setup()`. Without that call the receiver hears
nothing at all: the first bring-up saw only short random pulses until this call was added.

## Toolchain

### On this WSL/Windows box

WSL cannot see USB, so every flash and serial command runs on the Windows side. `hardware/m5sticks3/tools/stick.py`
(WSL system python3) shells out to Windows programs for you; see "The fast loop" below for day to
day use. This section is the one-time setup underneath it.

1. Install the M5Stack board core and M5Unified once, using the Arduino IDE's own bundled
   `arduino-cli.exe` so Tony's Arduino config is not rewritten:

   ```
   CLI="/mnt/c/Users/Tony/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
   URL=https://static-cdn.m5stack.com/resource/arduino/package_m5stack_index.json
   "$CLI" core install m5stack:esp32 --additional-urls $URL   # 3.3.9 has the m5stack_sticks3 board
   "$CLI" lib install M5Unified                                # 0.2.21 knows the StickS3 (pulls M5GFX)
   ```

2. `stick.py compile` and `stick.py flash` stage the sketch to
   `C:\Users\Tony\brx-sticks3\m5sticks3` before building, because the Windows `arduino-cli` cannot
   build from a `\\wsl.localhost` path. The FQBN is
   `m5stack:esp32:m5stack_sticks3:PartitionScheme=default_8MB,CDCOnBoot=cdc`: `default_8MB` gives a
   3 MB app partition (BLE plus M5Unified does not fit the 1.2 MB default), and `CDCOnBoot=cdc` is
   required or the upload cannot find the port.
3. The factory firmware ignores a software reset. The first flash after factory firmware needs
   download mode: hold the Stick's small side button while plugging in USB, then unplug and replug
   without the button. Later flashes do not need this.
4. The USB-C cable must carry data. A charge-only cable drops the Stick from the port list while
   its screen stays lit.
5. On Windows the port is a `COM` number; find the Stick by its vendor id `0x303a`, not by number
   (`stick.py ports` does this for you).

### On a Mac

No Mac-specific bench notes exist yet for the Stick. `docs/mac-dev-runbook.md` does not cover it.
Expect the Mac's own `arduino-cli` to see the Stick directly over `/dev/cu.usbmodem*`, with no
staging step, since macOS has native USB access; the FQBN, core, and library versions above should
still apply. Confirm this the first time a Stick is flashed from a Mac.

## The fast loop

Run everything through `hardware/m5sticks3/tools/stick.py` (WSL system python3; it never imports
`pyserial` or `bleak` itself, and shells out to Windows Python for anything that touches USB or
BLE). `stick.py ports` is the only subcommand safe to run without a Stick plugged in.

| command | does |
|---|---|
| `stick.py ports` | list COM ports with vid/pid/serial; labels the Stick and the two IR-rig boards |
| `stick.py compile` | stage the sketch and run `arduino-cli compile`; prints the size line |
| `stick.py flash [--port COMn]` | stage, compile, and upload to the auto-detected Stick port |
| `stick.py cmd <secs> [cmd ...]` | send serial commands, print every line for `secs` |
| `stick.py status` | send `STATUS`, print its fields parsed out |
| `stick.py raw <secs>` | toggle RAW on, capture for `secs`, summarise with `rawscan.py` |
| `stick.py ble [secs]` | scan BLE adverts for `secs`, list every service UUID heard |
| `tools/sercmd.py COM<n> <secs> [cmd ...]` | what `cmd`/`status`/`raw` delegate to: open the port with DTR/RTS low, send each command, print every line for `secs` |
| `tools/blescan.py [secs]` | what `ble` delegates to |
| `tools/rawscan.py < capture.txt` | what `raw` delegates to: a DIAGNOSTIC summary of RAW bursts (mark/space ranges, sync length, a labelled CANDIDATE word). Never a decoder; see "Diagnostics" below |

Use `sercmd.py`/`blescan.py`/`rawscan.py` directly only when you need something `stick.py` does not
wrap yet. Do not write ad-hoc scripts for a bench step; see the
[`m5stick-bench` skill](../../.claude/skills/m5stick-bench/SKILL.md) for the session method.

## Serial commands (115200)

The capture and emit line formats are the DevKitC rig's, so `mcp/tools/native_capture.py` and the
`ir_emit.ino` one-liners work unchanged.

| command | does |
|---|---|
| `r` / `s` / `c` | toggle the RAW dump / print frame count / clear, as `ir_capture.ino` |
| `SELFTEST [bits]` | loop the Stick's own LED into its own receiver: send one word, wait for the echo, print RAW plus decode, and `SELFTEST PASS` or `FAIL`. Defaults to the current beacon word when `bits` is omitted. Never feeds ownership. **Bench to confirm** what a PASS means here: M5 asks for 30 cm between sender and receiver, so a FAIL at millimetre range may be overdrive, not a fault |
| `TX <bits>` · `TXN <n> <bits>` · `AUTO <bits>\|OFF` · `PING` | as `ir_emit.ino` |
| `STATUS` | mode, owner, per-team charges, captures, advert seq and count, words heard, settings, the live UUID |
| `MODE BRIDGE\|HILL` | ownership mode, persisted. Resets the point |
| `ID <n>` · `GAME <n>` | advert bytes 6-7 and 13, persisted; a republish follows |
| `TXPIN 46\|9\|10` | onboard LED or either Grove signal pin, persisted |
| `RESET` | neutral, charges cleared |

Every received burst except the Stick's own echo prints `RAW n edges=.. us=[...]`, `DECODE bits=..
val=...`, and on a complete word (exactly 25 bits; a 26-bit frame is discarded, because an inserted
segment shifts every field and can still pass both parity tests) `SHOT player= team= dmg= proto=
crit= parityOK= genuine=`. `parityOK` is the gun's own test (Z0 != Z1); `genuine` is the odd/even
rule every real BRX frame carries, and ownership only moves on words that pass both, so a corrupted
word cannot credit the wrong team. An ownership change adds `OWNER team=..`, every BLE republish
adds `ADVERT <uuid> seq=..`, and a BRIDGE that loses its beacon prints `ADVERT withdrawn`.

### The two modes

**BRIDGE**: the Stick sits in the grenade's beacon cone and repeats what the grenade says. `proto=15
mag=8` carries the owner in its team bits, team 2 meaning neutral. `mag=50` is the capture word,
~50 ms after the shot, and its team bits are the NEW owner: ownership moves on it at once and the
advert's rising bit shows for 1.5 s; the next beacon, ~5 s later, only confirms. Two missed beacons
(12 s) withdraw the BLE advert, because a stale owner would look exactly like a live neutral point
on the phones; the screen keeps the last owner and says the beacon is lost. Respawn (6), boot (56)
and was-neutral (53) never touch ownership. Shots are ignored: the grenade is the authority.

**HILL**: the Stick is the hill. `proto=0` shots add their magnitude to the shooter's team; when the
attacker's total reaches the holder's total the point flips and the winner holds the total it took
to win. That is the **PROVISIONAL** rule from 2026-09-10 (F76 still open on the currency), and it
lives in one function in `control_point.h` so it can change without touching anything else. The
hill emits the grenade's own beacon word every 5 s so stock guns react to it, and on a flip it sends
the grenade's capture word once. See `docs/ir-callouts.md` for the general rule this follows: one
word per event, sent once, from the device where it happened (S57). The advert's value byte is the
holder's share of all charge, 0 to 100.

Both modes advertise `role 1, kind 5 (control), id, team (255 = neutral), state bits (held 1, rising
4), value, seq, game` as one 128-bit service UUID, non-connectable, republished at once on an owner
or state change and at most once a second on a value-only change.

## Firmware architecture

| file | what |
|---|---|
| `m5sticks3.ino` | the Arduino wrapper: RMT receive on G42, RMT transmit with a hardware 38 kHz carrier, NimBLE advert, M5Unified display and buttons, Preferences |
| `brx_ir.h` | pure C++: pulse durations to bits to fields, and back; the measured timings; the parity rule |
| `brx_advert.h` | pure C++: the 16-byte advert and its UUID string, an exact port of `app/src/beacon.js encodeUuid`; the republish policy from `control.js` |
| `control_point.h` | pure C++: the BRIDGE and HILL ownership state machines |
| `test/test_core.cpp` | host tests for the three headers, run by `mcp/tests/test_sticks3_core.py` when `g++` exists |

The three headers never include Arduino, so the logic is tested on the laptop and the sketch is
only plumbing. Keep it that way.

**BLE advert.** The advert is 16 bytes: a 4-byte magic, a version byte, then role, id (2 bytes),
kind, team, state, value, seq, game, an RSSI threshold, and a pad byte, rendered as one 128-bit
service UUID string. It is an exact port of `app/src/beacon.js`'s `encodeUuid`, so a phone HUD
decodes a Stick the same way it decodes a phone station. The republish policy (`AdvertPolicy`)
republishes at once on an owner or state change, and at most once a second on a value-only change,
bumping `seq` every time so a scanner can tell fresh from stale.

**IR receive.** RMT on G42, 1 us ticks, a 3 us hardware glitch filter (the ceiling of the 80 MHz
filter clock; see docs.espressif.com's RMT reference), a 20 ms idle threshold, and a 128-symbol
buffer split across 3 memory blocks (matching M5's own StickS3 IR example). Decode is strict: the
leading mark must land within 1800-2200 us to count as a sync, and a mark longer than 750 us reads
as a 1 bit. The genuine-parity check is the odd/even rule every real BRX frame carries, on top of
the gun's own Z0/Z1 test. **Bench to confirm:** whether this buffer and filter setup is enough
headroom for a full word plus the glitch fragments F314 has shown on real bursts.

**IR transmit.** RMT with a hardware 38 kHz carrier at 33% duty (matching both M5's and Espressif's
own examples, not the DevKitC rig's 50% LEDC carrier). After every transmit the sketch rebuilds the
whole RX channel (`rmtDeinit` then re-init) rather than just re-arming it: a bare re-arm failed on
first bring-up with `rmt: rmt_receive(401): channel not in enable state`, which is a known, open,
unresolved upstream bug on the ESP32-S3 (espressif/esp-idf#17811).

**Echo filter.** The onboard LED and receiver are millimetres apart, so the sketch drops any
received word that matches what it just sent within 150 ms of sending it, to stop self-hearing.

## Diagnostics

- `r` toggles the RAW dump: every burst except the Stick's own echo, as mark/space durations in
  microseconds, plus the strict decode.
- `SELFTEST [bits]` (see "Serial commands" above) is the fastest way to check the transmit and
  receive paths are both alive without a gun or a grenade in the room.
- `stick.py raw <secs>` / `tools/rawscan.py` summarise RAW bursts: mark and space ranges, the
  sync-region length, and a labelled 25-mark CANDIDATE word at a 600 us bit threshold. This is a
  **diagnostic only, never a decoder, and it must never feed ownership**: on 2026-09-23 a tolerant
  re-read of real bursts produced wrong words that still passed both parity checks. Compare a
  CANDIDATE against the rig receiver's word for the same shot; that comparison is the result, not
  the CANDIDATE alone.

## Known pitfalls

- **EXT_5V is off by default.** A Stick with no IR activity at all is usually this, not a wiring
  fault; see "Power" above.
- **Download mode** is needed only on the first flash after factory firmware (hold the small side
  button while plugging in USB). A later flash over running firmware does not need it.
- **Charge-only USB-C cables** drop the Stick from the port list while its screen stays lit.
- **DTR/RTS reset the S3 on open.** `sercmd.py` (and everything `stick.py` delegates to) already
  opens the port with both low; a perceived reset needs checking the DTR/RTS lines first, not a
  delay added on top.
- **Read counts (`s`, `STATUS`) in the same serial session that captured them.** Closing and
  reopening the port does not reliably preserve what the firmware remembers across a bench
  narrative; a count read cold is a different measurement.
- **The RAW-split artefact is a known rig behaviour, not a Stick bug.** A burst printed as several
  short `RAW` lines instead of one long one is the receiver fragmenting on a mid-frame gap (the
  same behaviour documented for the DevKitC rig).
- **Aim and distance.** M5 says to keep at least 30 cm between sender and receiver; closer "can
  cause bad reception" (docs.m5stack.com/en/arduino/m5sticks3/ir_nec). Separately, a 38 kHz
  receiver in this class needs a gap after a burst of more than 5 times the burst length once the
  burst passes about 70 cycles (Vishay's TSOP382 datasheet, vishay.com/docs/82491/tsop382.pdf).
  BRX's ~2 ms sync is about 76 cycles at 38 kHz, and its own gaps are only ~500 us, so BRX frames sit
  right past the point where this class of receiver is documented to need a much longer recovery
  gap than BRX provides. That is a plausible, datasheet-grounded explanation for why the onboard
  receiver distorts BRX frames at close range; it is not proven root cause.
- **An intermittent ~650 Hz stream of about 144 us pulses** appeared during bring-up. Its source is
  unproven.
- **Never flash a BRX gun or headset with this tool.** `stick.py` and its FQBN target the StickS3
  only. The repo's hard rule stands: stock BRX firmware is never modified; all gun control stays on
  the Bluetooth serial protocol.

## Open questions

- **F314: IR receive of a gun shot is unproven.** The rerun plan, with a fixed-distance ladder and
  controls, is `docs/bench-sticks3-2026-09-23.md`'s Rerun section.
- **The Grove receiver swap test.** If no distance decodes cleanly on the onboard receiver, the next
  step is to wire a known part (a Seeed Grove IR receiver, Vishay TSOP382 family, or a VS1838B) to a
  Grove pin instead. The firmware today only reads G42 for receive; this test needs a small firmware
  change to read a Grove pin, and that change is **not built**.
- **H8**, whether a Stick should carry its own `station_source` value instead of borrowing
  `grenade`'s: `docs/spec/utility.md` §5g.7.
- **Which Grove pin (G9 or G10) the yellow wire drives on this unit**, given M5's own pinout page
  and the M5Unified port mapping disagree; see "Hardware and pins" above.
