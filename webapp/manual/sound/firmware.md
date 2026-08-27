# Firmware updates & factory restore
_The same USB disk carries the firmware — here's the official procedure and the traps_
Last verified: 2026-08-27

## One port, one `.BIN`.
Firmware for the tagger, headset, hatchet, shield and sidearm all update the same way: enter USB disk mode, replace the file at the root. Battle Company's updater package is also your factory restore for both firmware and sounds.
Source: docs/reference/brx-extended-user-guide.md

## Update tagger firmware (Battle Company's procedure, restated)
1. Download the current firmware package from Battle Company. (Link to their official download; the site never rehosts it.) 📖
2. Gun **off** → USB cable into the Programming Port → **hold SELECT, switch on**. No startup sound; a disk appears. 📖
3. **Delete** the existing `.BIN` at the root of the disk. 📖
4. Copy the new `.BIN` to the root. Don't touch `AUDIO` unless the release notes say the audio set changed. 📖
5. Eject and power-cycle. Non-logo (older) guns wait about 10 s and then announce "upgrade complete". 📖
Source: docs/reference/brx-extended-user-guide.md

## Update a headset or accessory (hatchet, shield, sidearm)
1. Hold the device's **PROGRAM button** (a pinhole) while powering it on. 📖
2. It enumerates as a USB disk; replace the root firmware file exactly as above. 📖
Source: docs/reference/brx-extended-user-guide.md

## Firmware v4.30 was a "makeover" release.
Community reports: it **wipes on-gun config**, breaks headset pairing and Callsign until you re-run setup, and **requires a completely new audio-file set** in `AUDIO`. Gen-1 guns need an extra step after flashing (reboot, press SELECT three times). Read the release notes and back up `AUDIO` first.
Source: docs/reference/community-notes.md

## Known issues and Battle Company-verified fixes
- **Headset won't pair after an update.** BC-verified recovery: downgrade to `BCgunV2_02e.bin`, run `SETUP` from the USB serial console, re-pair the headset, then re-upgrade to `BCgunV2_08b.bin`.
- **Re-pair a headset** without the downgrade: boot the gun holding **RIGHT** ("install accessory"), power the headset, press its button once.
- **Admin lock blocks hosting.** Locked taggers (LEFT+RIGHT 3 s, or LEFT+RIGHT+SELECT 3 s) can't host; v4.30 adds hold-SELECT to unlock.
- **Version you're on:** the serial console's `QUERY` reports it; the guns on our bench run **v4.32**.
Source: docs/reference/community-notes.md · docs/reference/brx-extended-user-guide.md (accessory pairing), docs/reference/community-notes.md · docs/reference/community-notes.md · docs/HANDOFF.md

## Factory restore
- Battle Company's USB updater package = the reference firmware `.BIN` + the matching `AUDIO` set. Restoring both from that package returns a tagger to stock regardless of what packs were installed. 📖👥
- Keep your own backup of `AUDIO` from before any change — it's faster than a full restore and preserves the exact set your firmware version expects. 👥
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

Open BRX never modifies stock firmware — all of its control is over the Bluetooth serial protocol, so a tagger running Open BRX is always on Battle Company's firmware and always restorable with Battle Company's updater.
Source: CLAUDE.md, docs/adr/0001-companion-rider-architecture.md

_[image SND-05: REAL PHOTO — close-up of the tagger's two ports (charging and Programming/micro-USB) with a cable in the Programming Port.]_
