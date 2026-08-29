# Firmware updates & factory restore
_The same USB disk carries the firmware. Here is the official procedure, and the traps_
Last verified: 2026-08-27

## One port, one `.BIN`.
Firmware for the tagger, headset, hatchet, shield and sidearm all update the same way: enter USB disk mode, then replace the file at the root. Battle Company's updater package is also your factory restore, for both firmware and sounds.
Source: docs/reference/brx-extended-user-guide.md

## Update tagger firmware (Battle Company's procedure, restated)
1. Download the current firmware package from Battle Company. (Link to their official download; the site never rehosts it.) 📖
2. Switch the gun **off**, plug the USB cable into the Programming Port, then **hold SELECT and switch on**. There is no startup sound, and a disk appears. 📖
3. **Delete** the existing `.BIN` at the root of the disk. 📖
4. Copy the new `.BIN` to the root. Don't touch `AUDIO` unless the release notes say the audio set changed. 📖
5. Eject and power-cycle. Non-logo (older) guns wait about 10 s and then announce "upgrade complete". 📖
Source: docs/reference/brx-extended-user-guide.md

## Update a headset or accessory (hatchet, shield, sidearm)
1. Hold the device's **PROGRAM button** (a pinhole) while you power it on. 📖
2. Replace the root firmware file exactly as above, once it shows up as a USB disk. 📖
Source: docs/reference/brx-extended-user-guide.md

## Firmware v4.30 was a "makeover" release.
The community reports that it **wipes on-gun config**, breaks headset pairing and Callsign until you re-run setup, and **requires a completely new audio-file set** in `AUDIO`. Gen-1 guns need an extra step after flashing (reboot, then press SELECT three times). Read the release notes and back up `AUDIO` first.
Source: docs/reference/community-notes.md

## Known issues and Battle Company-verified fixes
- **Headset won't pair after an update.** The BC-verified recovery: downgrade to `BCgunV2_02e.bin`, run `SETUP` from the USB serial console, re-pair the headset, then re-upgrade to `BCgunV2_08b.bin`.
- **Re-pair a headset** without the downgrade: boot the gun holding **RIGHT** ("install accessory"), power the headset, then press its button once.
- **Admin lock blocks hosting.** Locked taggers (LEFT+RIGHT 3 s, or LEFT+RIGHT+SELECT 3 s) can't host. v4.30 adds hold-SELECT to unlock.
- **Version you're on:** the serial console's `QUERY` reports it. The guns on our bench run **v4.32**.
Source: docs/reference/community-notes.md · docs/reference/brx-extended-user-guide.md (accessory pairing), docs/reference/community-notes.md · docs/reference/community-notes.md · docs/HANDOFF.md

## Factory restore
- Battle Company's USB updater package = the reference firmware `.BIN` plus the matching `AUDIO` set. Restore both from that package and a tagger returns to stock, whatever packs were installed. 📖👥
- Keep your own backup of `AUDIO` from before any change. It is faster than a full restore, and it preserves the exact set your firmware version expects. 👥
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

Open BRX never modifies stock firmware. All of its control runs over the Bluetooth serial protocol. So a tagger running Open BRX is always on Battle Company's firmware, and always restorable with Battle Company's updater.
Source: CLAUDE.md, docs/adr/0001-companion-rider-architecture.md

_[image SND-05: REAL PHOTO: close-up of the tagger's two ports (charging and Programming/micro-USB) with a cable in the Programming Port.]_
