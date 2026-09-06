# Volume
_On-gun 1–5, protocol 0–100, and why "30" is silence_
Last verified: 2026-09-06

## 30 is silence.
The gun menu offers volume 1–5. Over Bluetooth the same control is a 0–100 scale. On that scale, the gap between "quiet" and "you hear nothing" is smaller than you would think.
Source: docs/reference/brx-manual-notes.md, protocol/brx-protocol.md

## The scales, side by side
| Control | Range | Notes |
|---|---|---|
| On-gun menu (SELECT → settings) | 1–5 | Remembered per game mode as the new default 📖 |
| Bluetooth `$VOL,<0–100>,0,*` | 0–100 (`MaxMusicVolume` = 100) | Sent by every app on connect and again at game end ✅🔍 |
Source: docs/reference/brx-manual-notes.md, protocol/brx-protocol.md, docs/experiment-log.md

## What the official apps send
Android Callsign: `$VOL,100` · iOS Callsign: `$VOL,69` · Open BRX game default: **80 indoors / 90 outdoors** (`compile.play_volume()` sets it from the venue; 69 measured as roughly on-gun level 2 and was inaudible on a field, 2026-08-30) · Open BRX try-out default: **69** (fired at arm's length) · Open BRX probing default: **30** (deliberately quiet, and deliberately not for games).
Source: protocol/brx-protocol.md, CLAUDE.md

## 30 is not "quiet", it is silent for weapon audio.
We measured it with a microphone harness. At volume 100 the gun's sounds peak at 7–37× the room noise floor, and at 30 nothing rises above room noise. Volume 45 is barely audible. Use **≥ 65** to hear a tagger reliably. Open BRX plays at **80 indoors / 90 outdoors**, because 69 was measurably too quiet across a field (2026-08-30). No absolute SPL figure exists for any of these values.
Source: docs/experiment-log.md #6, protocol/brx-protocol.md

## Practical levels
- **Play:** 69, the value the official iOS app sets on connect. The Android app sends 100. ✅
- **Bench / diagnostics:** 30 or lower keeps the neighbours happy and still confirms the command path (the gun echoes its state, you just won't hear it). ✅
Source: protocol/brx-protocol.md, docs/experiment-log.md #6, CLAUDE.md

## Safety.
The boot chime plays at the gun's stored level before any host can lower it. A gun last used at 100 is loud at the next power-on. Set the volume down before you switch off if kids or a quiet venue are next. Voice lines and the death beep are uncomfortable held to the ear at 100. The official iOS app ships 69 for a reason.
Source: docs/experiment-log.md 2026-08-30 (volume), docs/reference/brx-manual-notes.md

_[diagram SND-06: Horizontal loudness scale 0–100 with the two app defaults (69, 100) marked and a shaded "inaudible for weapon audio" zone below ~45. GENERATE.]_
