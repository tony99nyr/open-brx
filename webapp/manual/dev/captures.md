# Captures: recording and decoding the official app
_How every fact on these pages was obtained, and how to take the next one. Read this page if you want to record the app yourself._
Last verified: 2026-08-27

## Method.
Almost everything here came from three instruments: BLE HCI captures of the official Callsign app (Android HCI snoop; iOS via macOS PacketLogger), a VS1838B/ESP32 IR receiver+emitter, and a live tagger driven one token at a time. Captures are decoded with `python -m brx_mcp.btsnoop <file>` into `>>` (host→tagger) / `<<` (tagger→host) transcripts.
Source: protocol/captures/README.md; docs/capture-runbook.md

## iOS (the one that works; Callsign is effectively iOS-only)
1. Plug the iPhone into a Mac. Open **PacketLogger** (Xcode additional tools) → **File → New iOS Trace**. **Confirm lines are scrolling before you do anything.**
2. Make sure the tagger's **headset is on and paired**. The app silently drops a headset-less gun and you capture nothing. Get the app's connection icon green first.
3. Drive the app: connect, create/join, arm, play, end. For a differential capture change **exactly one** setting per trace.
4. **File → Export → btsnoop**. Two traps: export acts on the *frontmost* window (easy to re-export an old trace), and a trace that wasn't recording writes a silently useless file.
5. `python -m brx_mcp.btsnoop <file>` → transcript. `python -m brx_mcp.gsetdiff <capA> <capB> [capC]` diffs the config frames across raw captures.
Source: docs/capture-runbook.md (Job 2); protocol/brx-protocol.md §7m; protocol/captures/README.md

## Android (partial; the app rarely holds a connection here)
1. Enable **Developer options → Bluetooth HCI snoop log**.
2. Run the app; then `adb bugreport` (5–10 min; keep the phone still). The btsnoop log rides inside.
3. Decode with `python -m brx_mcp.btsnoop`. This route yielded the connect ritual and the version exchange, never a game.
Source: docs/experiment-log.md (#5 HCI snoop)

```bash
python -m brx_mcp.btsnoop capture.btsnoop            # → '>> $CLEAR,*' / '<< $LCD,…' transcript with timestamps
python -m brx_mcp.gsetdiff cap5.btsnoop cap6.btsnoop # byte-diff the $GSET/$PSET frames across captures
python -m brx_mcp.weapmap cap14.btsnoop cap15.btsnoop # token × weapon table from operator-annotated captures
```
Source: protocol/captures/README.md; protocol/callsign-extract/protocol-classes.md

## Decoder gotchas we hit.
Apple's btsnoop export uses datalink 1001 (no HCI type byte; the type is in the record flags), which decoded to zero frames until handled. With two guns in one trace, streams must be keyed on the **ACL connection handle** or they merge into garbage silently.
Source: docs/experiment-log.md (#4 PacketLogger; cap8 notes)

## Published transcripts
(decoded frames only; raw btsnoop files contain all of a phone's Bluetooth traffic and are not published)
| File | Shows |
|---|---|
| `2026-08-23-ios-callsign-game-start.txt` | The full working arm sequence (§7e) |
| `2026-08-23-ios-callsign-two-tagger-combat.txt` | `$HIR`/`$HP` damage, death, host-driven respawn (§7f) |
| `2026-08-23-gset-respawn15.txt` / `-respawn30.txt` / `-respawn05.txt` | Byte-identical `$GSET` at three respawn values; `respawn15` also contains a complete game ending (§7n) |
| `2026-08-23-no-headset-disconnects.txt` | App ritual completes, zero frames back, hangs up ~1.2 s later (§7m) |
Source: protocol/captures/README.md

## IR capture rig (ESP32-S3 + VS1838B)
1. A phone camera **cannot** see the ~5 mA IR LED. Judge with the receiver, never a camera.
2. Turn the sketch's per-frame RAW dump **off** (`r`) for any capture that matters; it takes ~15–20 ms at 115200 and truncates the next frame into a prefix.
3. Attenuate at close range. The VS1838B's AGC saturates point-blank. A gun at 1 m decodes cleanly where an LED at 5 cm does not.
4. Never fire toward the rig from the gun under test: reflected IR hits your own headset, drains armor and kills the player mid-window.
5. Bound the sync to ~1800–2200 µs and require 25 bits + `Z0 ≠ Z1`, or a TV remote will decode as a BRX frame.
Source: docs/gotchas.md (Capturing IR); protocol/brx-ir-protocol.md

## Measurement discipline that mattered.
Check the control *before* reading the result; one clean-looking run is not a result (everything that held was measured 3× with alternating conditions, or came from a human's senses); a host-visible field that correlates with a state is not evidence of that state; damage is a property of the (weapon, victim `$SIR` table) pair, never of the weapon alone.
Source: docs/gotchas.md (Interpreting)
