# Player simulator: a fake player phone for station bench tests

`player_sim.ino` turns one IR-rig ESP32-S3 board into a fake player phone. The board broadcasts one Open BRX
player advert, so a station's claim scan (the M5StickS3 powerup pickup in `hardware/m5sticks3`) can run
unattended, with no phones.

**This is a bench tool. Never leave it on near a real game.** A Stick awards a claim at any signal strength,
so a forgotten claim advert would steal real pickups on a shared field, again after every respawn. The
sketch limits the damage: a claim advert stops by itself after 10 s (at most 60 s), a plain advert after
5 minutes, and the TX power is 0 dBm unless you ask for more. Unplug the board when the test is done.

The advert is the one 128-bit service UUID that `app/src/beacon.js` `encodeUuid()` and
`hardware/m5sticks3/brx_advert.h` `advert_uuid()` produce, with role 2 (player). The sketch builds the advert
exactly as the Stick's own `publishAdvert()` does: flags `0x04`, the UUID as a complete 128-bit service list,
non-connectable, about 100 ms interval. The Stick scans passively, so the UUID is in the advert packet, never
a scan response.

## Serial commands (115200, one per line)

| Command | Effect |
|---|---|
| `ADV <player_num> <team> <state> <value> <game> [seq] [secs]` | Set the advert and (re)start it. Without `seq`, the seq bumps on every change, as a phone does. With claiming or claim_ready set (state bits 4/5), it stops after `secs` (default 10, 1 to 60). A plain advert stops after 5 minutes. |
| `OFF` | Stop advertising. Also ends a running script and cancels a running scan. |
| `STATUS` | Print the current fields and UUID. |
| `SCRIPT CLAIM <player_num> <team> <station_id> <game> [secs]` | State 1 (alive) for 1 s, then 17 (claiming) for 1 s, then 49 (claim_ready). `value` is the station id from the claiming step on. The advert stops `secs` after the claiming step starts (default 10, 1 to 60). |
| `POWER <LOW\|NORMAL\|HIGH>` | TX power -12, 0 or +9 dBm. The board boots at NORMAL (0 dBm). The controller's own default on this core is +9 dBm, so the sketch sets 0 dBm explicitly. |
| `SCAN <aa:bb:cc:dd:ee:ff> <secs>` | Measure one advertiser's packet gaps (F353). Stops advertising, then scans passively and continuously for `secs` (1 to 3600). `ADV` is refused until the scan ends. `ADV` afterwards resumes advertising. |

An auto-off prints `ADV auto-off after <N>s`, then `OFF`. Every change prints `ADV <uuid> t=<millis>`, and each script step prints `SCRIPT step=<n> <name> t=<millis>`.
Player state bits: 1 alive, 16 claiming, 32 claim_ready, 64 revived.

## Flash it onto a rig board

The rig boards are ESP32-S3 DevKitC-1 on CH343 USB, built as **ESP32S3 Dev Module** (`esp32:esp32:esp32s3`,
core 3.3.x). Use the board's **UART** USB-C port (`USB-Enhanced-SERIAL CH343`), not the native USB port.
The board registry in `hardware/esp32-ir-bridge/README.md` maps each CH343 serial to its board.

1. Close any serial monitor or `brx_mcp` session on that port. Windows ports are exclusive.
2. Find the COM port: `python3 hardware/m5sticks3/tools/stick.py ports`.
3. Build and flash from WSL:
   ```
   python3 hardware/player-sim/tools/sim.py flash COMn
   ```
   If the upload fails, hold BOOT, tap RESET, release BOOT, and run the command again.
4. Open the port at 115200 and look for `# BRX player-sim ready`.

The board needs no IR parts for this sketch. Its IR wiring can stay in place.

## Restore the rig firmware afterwards

The rig boards normally run the sketches in `hardware/esp32-ir-bridge/`:

| Board | CH343 serial | Normal sketch | Restore command |
|---|---|---|---|
| A, receiver | `5C93045958` | `ir_capture.ino` | `python3 hardware/player-sim/tools/sim.py restore capture COMn` |
| B, emitter | `5C4C136487` | `ir_emit.ino` | `python3 hardware/player-sim/tools/sim.py restore emit COMn` |

`restore` stages that one sketch alone (the two rig sketches share a folder and must not build together),
then builds and uploads it with the same FQBN. Without a port, it only compiles. Then confirm the banner:
`# BRX IR emit ready` (send `PING`, expect `PONG`) or `# BRX IR capture ready`.

## SCAN report

`SCAN` uses this board as the measuring instrument, because the laptop's Windows scanner drops most packets.
The scan is passive, with interval = window = 100 ms and every duplicate reported. It uses raw NimBLE
`ble_gap_disc()`, not the core's `BLEScan`. `BLEScan` keeps the first UUID an address sent for the whole scan,
so it would hide a republish (see the comment at the top of `scan_meter.h`).

At the end it prints lines that start with `SCAN`:

- `packets`, the time from the scan start to the first packet, and from the last packet to the scan end.
- The gap median, p90, p99 and max in ms.
- The number of gaps over 250 ms, over 1 s and over 4 s.
- The 5 largest gaps, with their start times in ms from the scan start.
- Each service UUID change from that address, with its time (`none` for a packet without a 128-bit UUID).

The report ends with `SCAN end`.
