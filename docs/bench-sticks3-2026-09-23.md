# Bench runbook: M5StickS3 bring-up (H7, S57)

The first power-on of our own station firmware (`hardware/m5sticks3/`). Tony handles the hardware and types `1` when a
step is done; the agent runs every command (the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md)).
This is our ESP32 code, so flashing the Stick is fine. **Never flash or modify a BRX gun or headset.**

| gate | what | pass | kit |
|---|---|---|---|
| 0 | toolchain and compile | the sketch compiles for `m5stack_sticks3` | laptop only |
| 1 | flash, boot, serial | `# BRX StickS3 station ready` and a `mode=` line | Stick, USB-C data cable (not charge-only) |
| 2 | IR receive | a grenade beacon decodes as `proto=15 team=2 dmg=8`, genuine | + grenade (or the rig's emitter as control) |
| 3 | BLE advert, kind 5 | the laptop scan (or a HUD) reads the UUID the Stick prints | + laptop BLE or a phone |
| 4 | IR transmit | a HILL flip sends ONE magnitude-50 word that the rig and a stock gun both report | + 1 gun on MCP, the rig's receiver |
| 5 | once per flip | more shots from the owner send nothing; each flip sends exactly one word | as gate 4 |
| 6 | range (optional) | the cliff for `TXPIN 46`, then the Grove emitter | + a gun as witness, 2 ft steps |

## Conventions

- **WSL cannot see USB.** Every flash and serial command runs Windows programs from WSL: the Arduino IDE's bundled
  `arduino-cli.exe`, and Windows Python (`/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`, which has pyserial).
  Arguments go on the command line; environment variables do not cross from WSL to Windows.
- **The Windows arduino-cli cannot build from a `\\wsl.localhost` path.** The sketch is staged in
  `C:\Users\Tony\brx-sticks3\m5sticks3\` (the folder name must match the `.ino`), copied from the checkout before each
  compile.
- **COM numbers move.** COM7 and COM8 are the IR rig (CH343 serials `5C93045958` receiver, `5C4C136487` emitter). The
  Stick is the ESP32-S3's own USB, vendor id `0x303a`; find it by that, not by number.
- **The M5Stack board URL is passed per command** (`--additional-urls`), so Tony's Arduino config is not rewritten.

## Gate 0: toolchain and compile (agent, before Tony starts)

The M5Stack core and M5Unified install once; then stage and compile:

```
CLI="/mnt/c/Users/Tony/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"
URL=https://static-cdn.m5stack.com/resource/arduino/package_m5stack_index.json
"$CLI" core install m5stack:esp32 --additional-urls $URL && "$CLI" lib install M5Unified
mkdir -p /mnt/c/Users/Tony/brx-sticks3/m5sticks3 && cp hardware/m5sticks3/*.ino hardware/m5sticks3/*.h /mnt/c/Users/Tony/brx-sticks3/m5sticks3/
cd /mnt/c && "$CLI" compile --fqbn "m5stack:esp32:m5stack_sticks3:PartitionScheme=default_8MB,CDCOnBoot=cdc" --additional-urls $URL 'C:\Users\Tony\brx-sticks3\m5sticks3'
```

**Pass:** the compile ends with a sketch size under the 3 MB app partition. **Log:** core and library versions.

## Gate 1: flash, boot, serial

1. Tony plugs the Stick into the laptop by USB-C and powers it on. The agent lists ports and picks the `0x303a` one.
2. The agent flashes: `"$CLI" upload --fqbn <as gate 0> -p COM<n> 'C:\Users\Tony\brx-sticks3\m5sticks3'`. The
   factory firmware ignores a software reset, so the first flash needs download mode: Tony holds the Stick's
   SMALL side button (this is also the power button) while plugging in USB, then replugs without the button.
   Later flashes worked without it. The Stick's USB-C cable must carry data: a charge-only cable makes it
   vanish from the port list while its screen stays on.
3. The agent opens the port for 5 s and sends `STATUS`.

**Pass:** `# BRX StickS3 station ready (RX G42 via RMT, speaker off).`, a `# mode=` line, a `STATUS` reply, and the
screen painted. **Log:** the COM port, the mode, id and game from `STATUS`, and the live UUID.

## Gate 2: IR receive (the grenade beacon)

The IR circuit runs off the M5PM1 EXT_5V rail, which M5Unified leaves off by default: the firmware must call
`M5.Power.setExtOutput(true, m5::ext_none)` or the receiver hears nothing.

Control first: the rig's emitter (COM8) sends one known beacon word, `proto 15, team 2, magnitude 8`, at the Stick's
receiver from 1 ft. Then the real thing.

1. `MODE BRIDGE` (the agent). `r` turns the RAW dump off for the capture (it splits frames on the rig).
2. **Control:** the emitter sends the beacon word 3 times. Pass: 3 `SHOT ... proto=15 team=2 dmg=8 parityOK=1
   genuine=1` lines.
3. Tony powers a grenade in Hill mode and holds the Stick's receiver in its beacon cone at 6 ft for 20 s.
   Pass: at least 3 of the ~4 beacons decode as in step 2, and the screen reads NEUTRAL / beacon ok.
4. Tony shoots the grenade with a gun on team 0 (red). Pass: `dmg=50` within ~50 ms, then `OWNER team=0` and an
   `ADVERT` line, and the screen turns red.

**Log:** decode counts per step, any `genuine=0`, and whether the durations look shifted (the receiver polarity is an
assumption; see the README's "Unverified").

## Gate 3: the BLE advert, kind 5

1. The agent reads the Stick's live UUID from `STATUS`.
2. The agent scans from the laptop (Windows Python, `bleak`) for 10 s and lists the service UUIDs it hears.
3. If a HUD phone is at hand: a game or try-out with `station_source: grenade` or none, and the control point shows the
   Stick's owner.

**Pass:** the scanned UUID equals the Stick's printed one, byte for byte (the README's byte-order question), and
decodes to role 1, kind 5, the id and game from `STATUS`, and the owner from gate 2. **Log:** both strings.

## Gate 4: IR transmit (the capture word)

Arm one gun on the MCP session with the silent row (`$SIR,15,0,,28,0,0,1,,*`) and friendly fire off, as Block 7's
arm step does; the rig's receiver (COM7, `native_capture.py`) faces the Stick's IR LED.

1. `MODE HILL`, `RESET`, `TXPIN 46`. The Stick starts its 5 s magnitude-8 beacon.
2. **Control:** the rig receiver reports the beacon: one `proto=15 dmg=8` word about every 5 s.
3. Tony fires the gun once at the Stick's receiver (the gun's own team, say team 1).
   Pass: the Stick prints `proto=0` and `OWNER team=1`, and within 100 ms the rig reports ONE `proto=15 team=1 dmg=50`
   word. The gun on MCP reports `$HIR,<sensor>,15,0,1,50,...` if its headset faces the Stick.

**Log:** the rig's count of magnitude-50 words for the flip, the gun's `$HIR`, and the time from `OWNER` to the word.
A team-1 gun may not report a team-1 word with friendly fire off (F312): note it, and repeat with the gun on team 2.

## Gate 5: once per flip (S57's rule)

1. Tony fires 5 more single shots from the same team-1 gun. Pass: no new `OWNER` line and no magnitude-50 word; the
   5 s beacons continue.
2. A second gun on another team (or the rig's emitter sending a team-3 shot word) takes the hill. Pass: exactly one
   new `OWNER` line and exactly one magnitude-50 word, carrying the new team.

**Log:** words per flip (must be 1), words per non-flip shot (must be 0).

## Gate 6: range (optional)

The README's step 6: `TXPIN 46`, then `TXPIN 10` (the Grove emitter; `TXPIN 9` if it is silent), stepping 2 ft at a
time with a gun as witness. The bare-LED rig cliffed at 8 to 10 ft.

## Restore and close

Re-arm the gun stock (`armgen.py <team> <id> ar volume=65`) and power-cycle it and its headset. Leave the Stick in
`MODE BRIDGE`. Record every gate in the experiment log, and update H7, H8 and F312 from what the gates showed.

## Results (2026-09-23)

- **Gate 0 PASS.** The Arduino IDE's bundled arduino-cli built the sketch with the M5Stack core 3.3.9 and
  M5Unified 0.2.21 (M5GFX 0.2.28), staged in `C:\Users\Tony\brx-sticks3\m5sticks3`. Sketch size 835 KB of the
  3.3 MB app partition.
- **Gate 1 PASS.** The Stick enumerated as vendor `0x303a` (factory firmware pid `0x832b`, COM9; after our
  flash pid `0x1001`, COM10). `STATUS` replied and the screen read "BRIDGE 1 NEUTRAL no beacon yet".
- **Gate 2 FAIL (IR receive).** The rig's own emitter word decoded on the rig's own receiver at 1 ft, but the
  Stick decoded nothing at 2 ft. One burst at 6 in with the room lights off carried correct bit timing (marks
  about 1020/520 us, spaces 480 us) but a short sync (627/895 us) fused it to noise, so no decode; at 3 in the
  widths were garbled. Gun shots at 3 and 6 ft, at the top end and the front face, never decoded. A noise
  stream of about 4 bursts a second of 144 us pulses on a roughly 1.53 ms grid came and went (a thumb over the
  window stopped it); A/B/A tests on the Grove IR emitter and on the rig emitter's aim were inconclusive.
- **Gate 3 PASS (BLE advert).** A laptop `bleak` scan heard the Stick's printed UUID byte for byte at -42 dBm,
  and `brx_mcp.beacon.decode` gave role station, id 1, kind control, team 255 (neutral), state 0, value 0, seq
  1, game 0. The "BLE UUID byte order" item below is now CONFIRMED.
- **Gate 4 HALF PASS (IR transmit).** After the EXT_5V fix, the rig decoded the Stick's HILL beacon twice,
  clean and genuine. But every transmit is followed by `rmt: rmt_receive(401): channel not in enable state`:
  the receiver does not re-arm after a transmit, so HILL mode goes deaf after its first beacon (F314). The
  gun-decode half of gate 4 was NOT RUN.
- **Gates 5 and 6 NOT RUN.** Tony stopped the session to let the receiver be fixed at the desk.

Sheet corrections from this session are folded into gates 1 and 2 above: the download-mode step needs the
Stick's small side button, held only for the first flash after factory firmware; the Stick's cable must carry
data; and the IR receiver needs `M5.Power.setExtOutput(true, m5::ext_none)`, which our firmware lacked until
this session's fix.
