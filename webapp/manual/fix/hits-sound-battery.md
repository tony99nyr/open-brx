# Hits, sound & battery
_When the gun fires but nothing lands, nothing is heard, or nothing lasts._
Last verified: 2026-08-27

## "IR isn't registering hits"
1. **Same team, friendly fire off?** → yes → Zero damage is correct; the firmware enforces it. ✅
2. **Is the target alive and in a started game?** → no → A dead tagger accepts no IR at all, and a configured-but-unstarted one ignores it too. Silence from a corpse proves nothing. ✅
3. **Bright sunlight?** → The gun's hit radius shrinks by roughly half in full sun (IR noise filtering); range is best in shade and at night. Typical max is ~600 ft in good conditions. 📖
4. **Wrong indoor/outdoor mode?** → Hold **ALT for 3 s** to toggle; it persists across power cycles. Indoor dims the green hit LEDs, enables the RGB LEDs and shrinks explosion/melee range; outdoor projects further. 📖
5. **Is the scope sighted?** → Boot in **target mode** (hold LEFT at power-on: yellow team, 0 damage, unlimited ammo); direct hits flash the target green. Sight indoors at ~20 ft, outdoors ~300 ft; snipers 300–400 ft, shotgun/SMG 50–100 ft. 📖👥
6. **Mag-dumping?** → The simulated-recoil model drifts accuracy under rapid fire; a miss makes the enemy hear a zip and their headset light with **0 damage**. Fire in bursts. 📖
7. **Hits register from the front but not the back (or vice versa)?** → The headset has separate front and back sensor domes plus a gun-body sensor; a dead dome is a replaceable part (sensor boards for front/left/right are sold). 📖👥✅
8. **Never lands at any range, target mode included?** → IR emitters do die. The laser emitter is a separately replaceable part. 👥📖
Source: protocol/brx-protocol.md §7r (FF firmware-enforced; dead/unspawned guns ignore IR; sensor map) · docs/reference/brx-extended-user-guide.md (indoor/outdoor, target mode, accuracy) · docs/reference/brx-manual-notes.md · docs/reference/community-notes.md

**Outdoors, prefer the stock headset.** SwapTX-modded headsets have dimmer LEDs than the BRX headset, which makes it hard to tell in direct sun whether you're landing tags at range. 👥
Source: docs/reference/community-notes.md ("Scoping / sighting & outdoor play")

## "No sound" / "too quiet"
1. **Did you hear a "pop" at power-on?** → yes → The speaker and amp are powered; check the audio files next. → no → Speaker/wiring; Battle Company sells replacement speakers. 👥
2. **Volume set to 1?** → On-gun volume is 1–5 in the SELECT menu and is remembered per game mode. 📖
3. **Driven from an app or host?** → The wire-level volume command has a much wider range: the official app sends **69**; a "safe" 30 is measurably inaudible for weapon audio outdoors. ✅
4. **Booted into USB disk mode by accident?** → SELECT-at-boot suppresses the startup sound entirely. Reboot with nothing held. 📖
5. **Just updated to v4.30+?** → That release requires a **complete new audio file set** in the `AUDIO` folder; old files leave silences. 👥
6. **Installed a custom pack and only some sounds changed?** → The filenames the app-selected guns use differ from the default gun files; the default weapons to target are SR-100, TAC-87, SMG-X3 and MG7 (→ *Sound* section for the id map). 👥
Source: docs/reference/community-notes.md (Audio) · docs/reference/brx-extended-user-guide.md (SELECT menu) · CLAUDE.md volume rule / docs/experiment-log.md · docs/reference/brx-manual-notes.md

## "Battery dies fast" / "won't charge" / replacing a pack
1. **Charger LED never goes green?** → Confirm it's the 8.4 V two-cell smart charger (headset: any 5 V USB). The LED is red while charging and green when full. 📖
2. **Bluetooth stops holding as the day goes on?** → Firmware won't re-pair BLE below a battery threshold. Top up, or swap packs. 👥
3. **Buying a replacement pack?** → Stock is a **7.4 V, ~2200 mAh Li-ion** with a 2-pin connector. Marketplace packs often have a 3-pin connector; the third (thermistor) pin is ignored by the BRX. **Check polarity — Battle Company's is reversed from the usual convention.** 👥
4. **Want to charge spares without the gun?** → Owners splice a BRX AC adapter onto a battery connector and charge packs on the bench, then hot-swap in the field (one screw near the reload switch opens the gun's battery bay; the v1 headset has a slide compartment). 👥📖
5. **Running a rider board off the tagger?** → Under 300 mA draw from the tagger's port is confirmed OK by Battle Company; most modders use a separate USB power bank anyway. 👥
6. **Want a live reading?** → The USB console `QUERY` shows gun and headset volts; a battery frame also appears over Bluetooth. ✅
Source: docs/reference/brx-extended-user-guide.md (Battery) · docs/reference/community-notes.md (Hardware / power) · protocol/brx-protocol.md (QUERY record) · docs/experiment-log.md §17 ($VOLTS)

**A live pack during a mod fries the mainboard; reversed polarity risks damage.** Unplug the battery before any work inside the shell, meter the connector before plugging a non-stock pack, and never use rechargeable AAs in the AA tray. 👥📖
Source: docs/reference/community-notes.md · docs/reference/brx-manual-notes.md
