# Repairs
_What owners fix themselves, what Battle Company sells, and what's a send-it-back._
Last verified: 2026-08-27

**BRX repairs are switches, plastic and sensors.** Reload handle, D-pad, power switch, battery bay, sensors and emitter are all reachable; the mainboard is not. Unplug the battery first — every time. 👥📖
Source: docs/reference/community-notes.md · docs/reference/brx-manual-notes.md

## Before you open anything
- **Unplug the battery.** A live pack during work inside the shell is how owners have fried mainboards. 👥
- **The emitter is a Class 1 IR laser (980 nm, 38 kHz, ~17 mW measured on our unit).** Don't modify its drive circuit and don't stare into it while probing. 📖✅
- **There is no public mainboard schematic** (only partial community mapping) — don't expect to trace faults beyond the switches and connectors. 👥
- **Never modify stock firmware.** Battle Company's official USB updater is the factory-restore path; a firmware *backup* is not possible over the console. ✅
- Lots of wires and switches live inside; photograph every connector before pulling it. 👥
Source: docs/reference/community-notes.md · docs/reference/brx-extended-user-guide.md (IR specs) · protocol/brx-protocol.md (QUERY laser mW; "Firmware backup: impossible")

## The repair catalogue
- **Reload handle — stiff, binding, or not registering.** The handle actuates a mechanical switch under two screws; test the switch with a pen. Binding: slip a thin nylon washer (owners cut one from a soft clear plastic lid) between handle and assembly and add a light silicone lube on the inner track. Or replace the handle with the reload-button mod (→ *Mods*). 📖👥
- **D-pad buttons — cracked.** The button plastic cracks from wear; a known recurring failure. DIY: fill with hot glue; better: pull one from a parts gun or ask Battle Company for the part. **No printable STL exists yet** — an open contribution. 👥
- **Power switch — random on/off.** Mechanical slide switch failing. Switch cleaner is a temporary fix; replacement is the real one. 👥
- **Trigger switch.** Continuity-test it (should beep on pull, battery unplugged). Replace the microswitch or reseat the cable. 👥
- **Battery bay & contacts.** One screw near the reload switch opens it. Check the 2-pin connector for looseness and confirm polarity if anything was ever rewired. 📖👥
- **Headset sensor domes / gun sensor.** Battle Company sells the sensor circuit boards (front/left/right, headset 2.0), speakers, and a 19" 2-pin wire bundle. The v2 headset is the same hardware as the Battle Rifle Pro headset — only firmware differs. 👥
- **IR emitter.** They do die; the laser emitter is a separately replaceable module. 👥📖
- **Water.** Remove the battery; owners have recovered guns after days of drying. 👥
- **Sling mount.** Drill 7/32" — 15/64" is too loose. 👥
- **Mainboard.** Not community-serviceable. Send it in. 👥
Source: docs/reference/community-notes.md ("More repairs", "Hardware / power", "Common failures") · docs/reference/brx-manual-notes.md ("Troubleshooting nuggets") · docs/reference/brx-extended-user-guide.md

_[image FIX-03: ]_

_[image FIX-06: ]_

## Firmware update over USB (official path — do this only with Battle Company's files)
1. Gun **off**. Hold **SELECT**, slide power **on**. No startup sound — that's correct.
2. Plug the micro-USB **programming port** (not the charging port) into a computer; a disk drive appears with a firmware `.BIN` at the root and an `AUDIO` folder.
3. Delete the existing `.BIN`, copy the new one to the root. Non-logo guns wait ~10 s and say "UPGRADE COMPLETE"; Gen-1 guns need an extra step (reboot, press SELECT three times).
4. **Expect v4.30+ to wipe your config**, break headset pairing until you re-run setup, and demand a **complete new audio set** in `AUDIO`.
5. Headset, hatchet, shield and sidearm firmware: hold the device's **PROGRAM** pin-button while powering on → disk mode → replace the root file.
Source: docs/reference/brx-extended-user-guide.md ("Firmware & sound-pack updates over USB") · docs/reference/community-notes.md (Firmware v4.30) · docs/reference/grenade.md (G7)

**Keep a record of your gun before it breaks.** The USB console's `QUERY` prints firmware version, the headset PIN, battery voltages, player/field IDs and the grenade pin — the only local "backup" the tagger offers. Save it per gun (it contains the headset PIN, so keep it private). ✅
Source: protocol/brx-protocol.md ("QUERY and SETUP")
