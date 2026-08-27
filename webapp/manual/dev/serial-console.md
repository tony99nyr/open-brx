# The USB serial console — `QUERY` and `SETUP`
_The micro-USB "Programing Port" is a Teensy serial console with two commands, not the `$` protocol and not SSH_
Last verified: 2026-08-27

The BRX has two ports: charging, and a separate micro-USB **"Programing Port"**. Plugged into a computer it enumerates as a **Teensyduino USB Serial** CDC device (Windows `COMx`, macOS `/dev/tty.usbmodem*`, Linux `/dev/ttyACM*`, VID `16C0`). Baud is ignored. This is what the community means by "PuTTY into the tagger". The command set came from LaserTagMods' headset-pairing note.
Source: protocol/brx-protocol.md §7c; docs/experiment-log.md (2026-08-24 B7)

## What the port does and does not do
| Sent | Result | Conf |
|---|---|---|
| `$PING,*`, `$VERSION,*`, any `$` frame | **Echoed back** (local echo on — easy to mistake for a reply); with CR: `ERROR` | ✅ |
| `?`, `help`, `AT`, `status`, … | `ERROR` | ✅ |
| `QUERY` + CR | Dumps the device record (below). Case-insensitive. | ✅ |
| `SETUP` + CR | Enters factory provisioning; prompts (EN/中文) for the **headset's** serial number | ✅ |
| Hold SELECT while powering on with USB connected | Mass-storage mode exposing the on-board sound storage (the sound-pack update path) — a different mode from the console | 👥 |
Source: protocol/brx-protocol.md §7c; protocol/callsign-extract/protocol-classes.md ("New sounds ON THE TAGGER")

```text
QUERY
Gun Info
Gun Version: v4.32
Serial Number/Head PIN: <SERIAL>      <- matches the sticker on the paired headset
Gun Name: Tactix2                     <- the field $NAME writes
Headset Version: hds.59               <- reads '?' briefly after a power-cycle until the headset re-handshakes
Gun: 7.671 VOLTS
PlayerID 0                            <- device-level player id (separate from the per-game $PSET id)
FieldID1
NRFhost 1
NRFslave 1
devHost 1                             <- developer/host image, not retail
Head: 3.837 VOLTS                     <- headset battery
Head Tested:
Head BURN in test: 0
Gun BURN in test: 3hours28minutes
Grenade Pin: <PIN>
Laser: 16.9 mW
PCB-5
BTchip- 4
BT central V: devhost.03
```
Source: protocol/brx-protocol.md §7c (values are one unit's; PIN/serial redacted)

## Real-format quirks
the parser has to survive: `Gun Name` is NUL-padded, lines end `\r\r\n`, `Laser` can read `UNTESTED` instead of a number, `Grenade Pin` is a real non-zero value. `brx-mcp` ships `parse_query()` and `python -m brx_mcp usb-query [port]`, which saves a backup to `~/.brx-mcp/device-backups/`.
Source: docs/experiment-log.md (2026-08-24 B7); mcp/brx_mcp/protocol.py

## `SETUP` — the provisioning/re-pair path (identity lives here)
1. Run `QUERY` on both gun and headset-side records first; `SETUP` on the gun asks for the **headset's** serial number — that is the gun↔headset pairing mechanism.
2. The "Factory Defaults" banner is a **mode header, not an action**: entering `SETUP` and power-cycling out changed nothing (field-by-field diff).
3. 👥 The community's "change tagger ID / re-pair the headset" procedure is this console (LaserTagMods' headset-pairing note); the identity fields it concerns are the ones `QUERY` prints: `PlayerID`, `FieldID`, `Serial Number/Head PIN`, `Grenade Pin`.
4. Only the first prompt (the headset serial) has been walked on our bench. Do it only on a gun you can afford to re-pair.
5. For per-game identity you do not need this: `$PSET` token 1 over BLE sets the player id each game.
Source: protocol/brx-protocol.md §7c, §7p; docs/experiment-log.md (2026-08-24)

## Firmware backup is impossible; do not reflash.
Teensy's HalfKay bootloader is write-only by design, so no image can be read back. Rollback depends entirely on Battle Company supplying the original image. The official app's version gate (supports "until v2.01e") is an *upper* bound; it warns and still runs a game.
Source: protocol/brx-protocol.md §7b, §7c

- **Is `$QUERY,*` over BLE the same thing?** No. Over BLE it returns a `$`-framed status array with no serial, PIN or version. The device record is USB-only.
- **What is the advertised BLE name vs `Gun Name`?** Two fields: the advertisement is `Tactix-XXXX` from the MAC tail; `Gun Name` is what `$NAME` writes.
Source: docs/experiment-log.md (2026-08-24) · docs/experiment-log.md (2026-08-24)
