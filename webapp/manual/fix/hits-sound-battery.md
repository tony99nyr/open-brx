# Hits, sound & battery
_When the gun fires but nothing lands, nothing is heard, or nothing lasts._
Last verified: 2026-08-27

## "IR isn't registering hits"
1. **Same team, friendly fire off?** → yes → Zero damage is correct. The firmware enforces it. ✅
2. **Is the target alive and in a started game?** → no → A dead tagger accepts no IR at all. A tagger that is set up but not started ignores it too. Silence from a corpse proves nothing. ✅
3. **Bright sunlight?** → The gun's hit radius shrinks by about half in full sun, because of IR noise filtering. Range is best in shade and at night. Typical max is ~600 ft in good conditions. 📖
4. **Wrong indoor/outdoor mode?** → Hold **ALT for 3 s** to toggle it. The setting survives power cycles. Indoor dims the green hit LEDs, turns on the RGB LEDs, and shrinks explosion and melee range. Outdoor projects further. 📖
5. **Is the scope sighted?** → Boot in **target mode** (hold LEFT at power-on: yellow team, 0 damage, unlimited ammo). Direct hits flash the target green. Sight indoors at ~20 ft and outdoors at ~300 ft. Snipers want 300–400 ft; shotgun and SMG want 50–100 ft. 📖👥
6. **Mag-dumping?** → The simulated-recoil model pulls your accuracy off under rapid fire. A miss makes the enemy hear a zip and lights their headset with **0 damage**. Fire in bursts. 📖
7. **Hits register from the front but not the back, or the other way round?** → The headset has separate front and back sensor domes, plus a gun-body sensor. A dead dome is a replaceable part, and sensor boards for front, left and right are sold. 📖👥✅
8. **Never lands at any range, target mode included?** → IR emitters do die. The laser emitter is a separately replaceable part. 👥📖
Source: protocol/session-findings-2026-08.md §7r (FF firmware-enforced; dead/unspawned guns ignore IR; sensor map) · docs/reference/brx-extended-user-guide.md (indoor/outdoor, target mode, accuracy) · docs/reference/brx-manual-notes.md · docs/reference/community-notes.md

**Outdoors, prefer the stock headset.** SwapTX-modded headsets have dimmer LEDs than the BRX headset. In direct sun that makes it hard to tell whether you are landing tags at range. 👥
Source: docs/reference/community-notes.md ("Scoping / sighting & outdoor play")

## "No sound" / "too quiet"
1. **Did you hear a "pop" at power-on?** → yes → The speaker and amp have power, so check the audio files next. → no → It is the speaker or its wiring. Battle Company sells replacement speakers. 👥
2. **Volume set to 1?** → On-gun volume is 1–5 in the SELECT menu, and it is remembered per game mode. 📖
3. **Driven from an app or host?** → The wire-level volume command has a much wider range. The official app sends **69**. At a "safe" 30 you cannot hear weapon audio outdoors at all. ✅
4. **Booted into USB disk mode by accident?** → SELECT-at-boot turns the startup sound off completely. Reboot with nothing held. 📖
5. **Just updated to v4.30+?** → That release needs a **complete new audio file set** in the `AUDIO` folder. Old files leave silences. 👥
6. **Installed a custom pack and only some sounds changed?** → App-selected guns use different filenames from the default gun files. The default weapons to target are SR-100, TAC-87, SMG-X3 and MG7 (→ *Sound* section for the id map). 👥
Source: docs/reference/community-notes.md (Audio) · docs/reference/brx-extended-user-guide.md (SELECT menu) · CLAUDE.md volume rule / docs/experiment-log.md · docs/reference/brx-manual-notes.md

## "Battery dies fast" / "won't charge" / replacing a pack
1. **Charger LED never goes green?** → Make sure it is the 8.4 V two-cell smart charger (the headset takes any 5 V USB). The LED is red while charging and green when full. 📖
2. **Bluetooth stops holding as the day goes on?** → The firmware will not re-pair BLE below a battery threshold. Top the pack up, or swap packs. 👥
3. **Buying a replacement pack?** → Stock is a **7.4 V, ~2200 mAh Li-ion** with a 2-pin connector. Marketplace packs often have a 3-pin connector, and the BRX ignores the third (thermistor) pin. **Check the polarity. Battle Company's is reversed from the usual convention.** 👥
4. **Want to charge spares without the gun?** → Owners splice a BRX AC adapter onto a battery connector and charge packs on the bench. Then they hot-swap in the field. One screw near the reload switch opens the gun's battery bay. The v1 headset has a slide compartment. 👥📖
5. **Running a rider board off the tagger?** → Battle Company confirms that under 300 mA draw from the tagger's port is OK. Most modders use a separate USB power bank anyway. 👥
6. **Want a live reading?** → The USB console `QUERY` shows gun and headset volts. A battery frame also comes over Bluetooth. ✅
Source: docs/reference/brx-extended-user-guide.md (Battery) · docs/reference/community-notes.md (Hardware / power) · protocol/brx-protocol.md (QUERY record) · docs/experiment-log.md §17 ($VOLTS)

**A live pack during a mod fries the mainboard. Reversed polarity risks damage too.** Unplug the battery before any work inside the shell. Meter the connector before you plug in a non-stock pack. Never use rechargeable AAs in the AA tray. 👥📖
Source: docs/reference/community-notes.md · docs/reference/brx-manual-notes.md
