# Repairs
_What owners fix themselves, what Battle Company sells, and what's a send-it-back._
Last verified: 2026-08-27

**BRX repairs are switches, plastic and sensors.** You can reach the reload handle, D-pad, power switch, battery bay, sensors and emitter. You cannot reach the mainboard. Unplug the battery first, every time. 👥📖
Source: docs/reference/community-notes.md · docs/reference/brx-manual-notes.md

## Before you open anything
- **Unplug the battery.** A live pack during work inside the shell is how owners have fried mainboards. 👥
- **The emitter is a Class 1 IR laser (980 nm, 38 kHz, ~17 mW measured on our unit).** Do not change its drive circuit, and do not stare into it while you probe. 📖✅
- **There is no public mainboard schematic** (only partial community mapping). Do not expect to trace faults past the switches and connectors. 👥
- **Never modify stock firmware.** Battle Company's official USB updater is the factory-restore path. A firmware *backup* is not possible over the console. ✅
- Lots of wires and switches live inside. Photograph every connector before you pull it. 👥
Source: docs/reference/community-notes.md · docs/reference/brx-extended-user-guide.md (IR specs) · protocol/brx-protocol.md (QUERY laser mW; "Firmware backup: impossible")

## The repair catalogue
- **Reload handle: stiff, binding, or not registering.** The handle works a mechanical switch under two screws. Test the switch with a pen. If it binds, slip a thin nylon washer between the handle and the assembly. Owners cut one from a soft clear plastic lid. Add a light silicone lube on the inner track. Or replace the handle with the reload-button mod (→ *Mods*). 📖👥
- **D-pad buttons: cracked.** The button plastic cracks from wear, and it is a known repeat failure. The DIY fix is to fill it with hot glue. Better: pull one from a parts gun, or ask Battle Company for the part. **No printable STL exists yet.** That is an open contribution. 👥
- **Power switch: random on/off.** The mechanical slide switch is failing. Switch cleaner is a temporary fix. Replacing it is the real one. 👥
- **Trigger switch.** Continuity-test it. It should beep on a pull, with the battery unplugged. Replace the microswitch, or reseat the cable. 👥
- **Battery bay & contacts.** One screw near the reload switch opens it. Check the 2-pin connector for looseness, and confirm the polarity if anything was ever rewired. 📖👥
- **Headset sensor domes / gun sensor.** Battle Company sells the sensor circuit boards (front/left/right, headset 2.0), speakers, and a 19" 2-pin wire bundle. The v2 headset is the same hardware as the Battle Rifle Pro headset. Only the firmware differs. 👥
- **IR emitter.** They do die. The laser emitter is a separately replaceable module. 👥📖
- **Water.** Take the battery out. Owners have brought guns back after days of drying. 👥
- **Sling mount.** Drill 7/32". A 15/64" hole is too loose. 👥
- **Mainboard.** Not community-serviceable. Send it in. 👥
Source: docs/reference/community-notes.md ("More repairs", "Hardware / power", "Common failures") · docs/reference/brx-manual-notes.md ("Troubleshooting nuggets") · docs/reference/brx-extended-user-guide.md

_[image FIX-03: ]_

_[image FIX-06: ]_

## Firmware update over USB (the official path: use only Battle Company's files)
1. Gun **off**. Hold **SELECT**, slide power **on**. There is no startup sound, and that is correct.
2. Plug the micro-USB **programming port** (not the charging port) into a computer. A disk drive appears with a firmware `.BIN` at the root and an `AUDIO` folder.
3. Delete the existing `.BIN`, then copy the new one to the root. Non-logo guns wait ~10 s and say "UPGRADE COMPLETE". Gen-1 guns need an extra step: reboot, then press SELECT three times.
4. **Expect v4.30+ to wipe your config.** It also breaks headset pairing until you re-run setup, and it demands a **complete new audio set** in `AUDIO`.
5. Headset, hatchet, shield and sidearm firmware: hold the device's **PROGRAM** pin-button while powering on → disk mode → replace the root file.
Source: docs/reference/brx-extended-user-guide.md ("Firmware & sound-pack updates over USB") · docs/reference/community-notes.md (Firmware v4.30) · docs/reference/grenade.md (G7)

**Keep a record of your gun before it breaks.** The USB console's `QUERY` prints the firmware version, the headset PIN, battery voltages, player and field IDs, and the grenade pin. It is the only local "backup" the tagger offers. Save it for each gun. It holds the headset PIN, so keep it private. ✅
Source: protocol/brx-protocol.md ("QUERY and SETUP")
