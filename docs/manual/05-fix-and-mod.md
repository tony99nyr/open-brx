# 05 · Fix, mod & accessorise  (section slug: /manual/fix)
**Last verified:** 2026-08-27
**Audience:** BRX owners whose tagger is misbehaving right now, owners about to open one up, and modders deciding what to bolt on · **Goal of this section:** get a broken tagger back into a game in under five minutes with symptom-first ladders; document the repairs and mods the community actually does (with credit); catalogue accessories and where owners gather; answer the ten questions every owner asks.
**Provenance legend:** ✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the Callsign APK · 👥 community-reported — only confirmed facts are published; see Research backlog at the end.

**Sourcing rule for this section:** every fact is restated in our own words with credit — Battle Company (the V7 manual and the 2018 Extended User Guide), LaserTagMods (JEDGE/JBOX), Jay of *Extreme Laser Tag And More!*, and the BRX owners' community. Link to official PDFs and original videos; never rehost them. Community members other than public creators are credited as "the owner community".

---

## Pages

### Page: Diagnose my tagger  (`/manual/fix/diagnose`)
_Symptom first. Start at the top of the ladder that matches what you see — the headset is the first thing to check._

[hero]
**It won't fire.** Before you decide it's broken, check the headset, the game state and the locks. Work the ladder in order and stop at the first check that says yes. Confidence for the whole page is shown per block. ✅📖👥
src: docs/gotchas.md · docs/reference/community-notes.md · docs/reference/brx-manual-notes.md

[callout:info]
**Three things to know before any ladder.** (1) The tagger keeps no game state — if it isn't in a started game it won't shoot at anyone. ✅ (2) The gun locks when its headset disconnects *mid-game* (anti-cheat). 📖 (3) A dead player's trigger does nothing but click — that's a game rule, not a fault. ✅
src: protocol/brx-protocol.md §7n §7r · docs/reference/brx-manual-notes.md (Headset §) · docs/experiment-log.md (2026-08-25 "dead gun can't fire")

[symptom-ladder]  **"Won't fire" — the ladder**
1. **Is the headset slow-blinking a rainbow?** → yes → It's disconnected. The gun refuses to join or fire until the headset links. Power the headset on, wait for it to settle to team colour (up to 3 minutes in a room full of Bluetooth), or re-pair (→ *Headset, pairing & Bluetooth*). ✅📖
2. **Did the headset drop *after* the game started?** (it was fine, then the gun "charges its energy weapon but nothing happens on the trigger") → yes → Anti-cheat lockout. Re-link the headset; if it won't, power-cycle both and restart the round. 👥📖
3. **Is the game actually started?** → no → On-gun play: pull the **reload handle** to start — that's the "go" signal, not the trigger. Hosted play: wait for the host's start. 📖
4. **Are you dead / waiting on a respawn station?** → yes → Respawn (or walk to the station; once a tagger has been armed to a respawn station its self-respawn is disabled). Trigger-while-dead makes only the empty click. ✅👥
5. **Can you cycle weapons with the trigger *before* a game starts?** → no → Controls are locked. Check **admin lock**: primary lock is LEFT+RIGHT held 3 s in the root menu; the secondary LEFT+RIGHT+SELECT 3 s also blocks indoor/outdoor, weapon, team and perk changes. Unlock the same way (v4.30: also hold SELECT). 👥
6. **Does the reload handle click home?** → no → The handle drives a mechanical switch under two screws; press the switch with a pen. If the pen works and the handle doesn't, it's the handle (→ *Repairs*). 📖👥
7. **Does the trigger switch show continuity when pulled?** (multimeter in beep mode, battery **unplugged**) → no → Trigger switch or a loose internal cable. Open the shell and reseat connectors (→ *Repairs*). 👥
8. **Still nothing?** → It's the mainboard. Not community-serviceable — contact Battle Company for repair. 👥
✅📖👥 · src: docs/reference/community-notes.md ("Gun won't fire — diagnostic ladder") · docs/reference/brx-manual-notes.md · docs/reference/grenade.md (Respawn Station) · docs/experiment-log.md 2026-08-27 (headset rainbow)

[callout:tip]
**Running the gun from a third-party host or your own code?** Three silent fire-killers we hit on the bench: the button map must be sent or the firmware reports the trigger as disabled; a game head without the start command spawns a gun whose trigger only reloads; and a magazine must be loaded *after* the spawn or the gun goes live with no ammunition. ✅
src: docs/gotchas.md ("Sending commands") · docs/experiment-log.md 2026-08-25 (night, try-out couldn't fire)

[symptom-ladder]  **"Won't power on" / "powers off by itself"**
1. **Did you hold a button while sliding the switch?** → yes → SELECT-at-boot puts the gun in USB disk mode with **no startup sound** — it looks dead but is waiting for a computer. LEFT-at-boot is target mode, RIGHT-at-boot is accessory pairing. Power off, power on with nothing held. 📖
2. **Is the battery charged?** → no → The charger LED is red while charging and goes green when full; a full charge gives ~8 h of play. Use the 8.4 V two-cell smart charger for the gun (the headset takes any 5 V USB). 📖
3. **Using AAs?** → The optional 6×AA tray takes **non-rechargeable** cells only — the manual says never use rechargeable AAs. 📖
4. **Replacement pack or rebuilt connector?** → Battle Company wires the battery connector with polarity **reversed** from the usual convention. Verify with a meter before plugging in — a reversed pack can damage the board. 👥
5. **Random on/off, especially when jostled?** → The slide **power switch** is a known mechanical failure. Contact/switch cleaner buys time; replacement is the fix (→ *Repairs*). 👥
6. **Was the battery plugged in while you modded it?** → A live battery during a mod is how owners have killed mainboards. That's a repair, not a fix. 👥
7. **Got wet?** → Owners have recovered guns after days of thorough drying. Remove the battery, dry fully before any power attempt. 👥
📖👥 · src: docs/reference/brx-extended-user-guide.md (USB disk mode, battery) · docs/reference/brx-manual-notes.md · docs/reference/community-notes.md (Battery / power; Common failures)

[stat-row]
~8 h play per charge (📖) · charger LED red → green when full (📖) · up to 3 min for a headset to auto-pair in a crowded room (📖) · establishing a Bluetooth link is intermittent, official app included — retrying is the fix (✅)
src: docs/reference/brx-manual-notes.md · docs/reference/brx-extended-user-guide.md · docs/gotchas.md ("Connection failed") · docs/experiment-log.md 2026-08-23 (link held 73.8 s once up)

---

### Page: Headset, pairing & Bluetooth  (`/manual/fix/pairing`)
_The headset gates everything — firing, joining a game, and whether a phone can even hold a connection._

[hero]
**Rainbow means disconnected.** Read the headset LEDs, re-pair when you have to, and understand "screamers" — the after-an-hour failure that ends hosted games. ✅👥
src: docs/experiment-log.md 2026-08-27 (headset LED) · docs/reference/community-notes.md (SCREAMERS)

[table]  **Headset LED language (what the colours mean)**
| Headset shows | Meaning | Confidence |
|---|---|---|
| Slow rainbow blink / LEDs cycling colours at power-on | Disconnected / not paired — waiting to pair; the gun will not join or fire | ✅ owner-observed, repeatable · 👥 |
| Solid team colour (red/blue) | Paired, pre-game only | ✅ |
| Dark | Normal during play — not a fault | ✅ |
✅👥 · src: docs/experiment-log.md 2026-08-27 · docs/reference/community-notes.md (Gen-3 re-pair)

[symptom-ladder]  **"Headset not detected" / "keeps dropping"**
1. **Is the headset charged?** → Check the headset battery first. The v2 headset runs on a single 18650 cell; charge from any 5 V USB. 👥📖
2. **Did you boot the gun in target mode (LEFT held)?** → yes → The headset deliberately won't pair in target mode. Reboot normally. 📖
3. **Lots of taggers or Bluetooth devices nearby?** → Auto-pairing can take up to 3 minutes. Wait it out before re-pairing. 📖
4. **Still rainbow after 3 minutes?** → Re-pair using the procedure below. 👥
5. **Just updated firmware (v4.30 or later)?** → The v4.30 "makeover" wipes config and breaks headset pairing until you re-enter setup. A Battle Company-verified fix for a headset that won't pair after the update: downgrade to the previous gun firmware, run `SETUP` over the USB console, re-pair, then upgrade again. 👥
6. **Paired, then the whole fleet drops after an hour?** → "Screamers" — see below. 👥✅
📖👥✅ · src: docs/reference/brx-manual-notes.md · docs/reference/brx-extended-user-guide.md · docs/reference/community-notes.md (Firmware / pairing)

[steps]  **Re-pair a headset to a tagger (Gen-3, the "PAIRING MODE" procedure — contributed by the owner community)**
1. Turn the **headset** on; its LEDs cycle colours.
2. Press and **hold the small headset button** — keep holding through every step.
3. On the **tagger**, hold **RIGHT on the D-pad while sliding the power on**.
4. Wait for the voice line **"PAIRING MODE"**.
5. **Pull the trigger once** → "HEADSET CONNECTED"; the headset LEDs stop cycling.
6. A **second trigger pull** announces "device paired". Release the headset button.
👥 · src: docs/reference/community-notes.md ("Gen-3 headset re-pair procedure")

[accordion]  **Other pairing routes**
- **"Install accessory" boot:** power the tagger holding RIGHT, power the headset, press its button once. This is the same boot mode used to pair grenades and other IR accessories. 👥📖
- **USB serial console (`QUERY` / `SETUP`):** the micro-USB *programming* port is a plain serial terminal (PuTTY in serial mode, or `screen`). `QUERY` prints the device record including the **Serial Number / Head PIN** — which matches the sticker on the paired headset; `SETUP` asks for a headset serial to bind. Entering `SETUP` and backing out changes nothing; committing it is a factory re-provision. Credit LaserTagMods for the command set. ✅👥
- **Pairing PIN facts:** change one digit of the PIN and the pair breaks; re-matching re-pairs. 👥
✅👥📖 · src: protocol/brx-protocol.md ("What DOES work: QUERY and SETUP") · docs/reference/lasertagmods.md · docs/reference/community-notes.md

[callout:warn]
**"Screamers" — the after-an-hour failure.** In any hosted/online mode, after roughly an hour taggers start randomly failing with a loud buzz and need a reboot; separately, the firmware refuses to re-pair Bluetooth once the battery drops below a threshold, so a game cascades down to half or three-quarters of its players. On our bench, a gun left powered all day still advertised normally but connection attempts hung, and power cycles helped only briefly. **Prevention:** keep batteries topped, plan on periodic reboots, and never assume a Bluetooth link survives a full session. 👥✅
src: docs/reference/community-notes.md (SCREAMERS) · docs/experiment-log.md 2026-08-26 ("screamer" state) · docs/gotchas.md

[symptom-ladder]  **"Can't pair / connect my phone"**
1. **Android 11 or newer?** → The official Callsign app works only on Android 10 and older. Use an older Android device. 👥
2. **Is the headset linked (not rainbow)?** → no → Callsign connects to a headset-less tagger and silently disconnects about a second later; you cannot create a game until the app's top-right icon is green and reads "connected". The gun answers other clients fine — the app is enforcing the headset. ✅
3. **"Connection failed" once?** → Try again. Establishing a Bluetooth link is intermittent, with the official app too, and the link holds once it is up; retrying *is* the fix, not a sign of a broken stack. ✅
4. **Reconnecting right after the gun dropped you?** → Back off at least 5 seconds after a gun-initiated disconnect, or the new session comes up dead. ✅
5. **Gun is admin-locked?** → Locked taggers cannot host. Unlock (LEFT+RIGHT 3 s). 👥
6. **Gen-1 tagger?** → It uses Bluetooth *Classic*, advertises as `LTP-alpha`, default pair code `0001`, and needs the headset connected for Bluetooth to work at all. Gen-2/3 advertise as `Tactix-XXXX` over BLE with no PIN. 📖✅
📖👥✅ · src: docs/reference/community-notes.md (Ecosystem; Admin lock) · docs/experiment-log.md §16 · docs/gotchas.md ("Connecting") · protocol/brx-protocol.md (transport table) · docs/reference/brx-extended-user-guide.md

[callout:info]
**"My gun is called Tactix2 again."** Opening the official app resets an owner-assigned gun name back to the factory `Tactix2`; the Bluetooth advertised name (`Tactix-XXXX`, derived from the radio address) is a different field and never changes. Not a fault — re-apply your name, then power-cycle: the advertised name only refreshes at boot. ✅
src: docs/gotchas.md ("The gun is called Tactix2 again") · docs/experiment-log.md 2026-08-24 (QUERY vs BLE names; rename)

[compare]  **What survives a Bluetooth drop vs. a power cycle**
| State | Survives a BLE drop? | Survives a power cycle? |
|---|---|---|
| Pushed game config (weapon, health pools, team) | **Yes** — reconnect, re-spawn, reload and it plays on with config intact | **No** — the gun boots live with nothing loaded; the whole head must be re-sent |
| Alive/dead status and ammo count | Yes (the gun keeps counting) | No |
| Indoor/outdoor mode (ALT 3 s) | Yes | **Yes** |
| On-gun menu settings (lives, time, respawn, volume) | Yes | **Yes** — remembered per game mode |
| Owner-assigned gun name | Yes | Yes (advert refreshes at boot) |
| Headset pairing (PIN) | Yes | Yes — but the gun needs the headset *re-linked* before Bluetooth will hold |
| Smart grenade's locked objective mode | n/a | **Yes** — it flashes its mode colour for ~1 s at boot |
| Firmware and sound files | Yes | Yes |
✅📖 · src: protocol/brx-protocol.md §7r ("config survives a BLE drop (E1)", "Power-cycle WIPES the config") · docs/reference/brx-extended-user-guide.md (indoor/outdoor persists; SELECT menu) · docs/reference/grenade.md

[callout:tip]
**Two resets worth knowing.** In-game soft reset: hold LEFT+RIGHT for 5 s → the gun reboots to its menu. Fresh from a power cycle a tagger ignores a bare version query until it has been greeted (the phone's handshake) — so "it's not answering" right after boot is expected. 📖✅
src: docs/reference/brx-extended-user-guide.md (RESET) · protocol/brx-protocol.md §7r ("Fresh power-up needs the handshake")

---

### Page: Hits, sound & battery  (`/manual/fix/hits-sound-battery`)
_When the gun fires but nothing lands, nothing is heard, or nothing lasts._

[symptom-ladder]  **"IR isn't registering hits"**
1. **Same team, friendly fire off?** → yes → Zero damage is correct; the firmware enforces it. ✅
2. **Is the target alive and in a started game?** → no → A dead tagger accepts no IR at all, and a configured-but-unstarted one ignores it too. Silence from a corpse proves nothing. ✅
3. **Bright sunlight?** → The gun's hit radius shrinks by roughly half in full sun (IR noise filtering); range is best in shade and at night. Typical max is ~600 ft in good conditions. 📖
4. **Wrong indoor/outdoor mode?** → Hold **ALT for 3 s** to toggle; it persists across power cycles. Indoor dims the green hit LEDs, enables the RGB LEDs and shrinks explosion/melee range; outdoor projects further. 📖
5. **Is the scope sighted?** → Boot in **target mode** (hold LEFT at power-on: yellow team, 0 damage, unlimited ammo); direct hits flash the target green. Sight indoors at ~20 ft, outdoors ~300 ft; snipers 300–400 ft, shotgun/SMG 50–100 ft. 📖👥
6. **Mag-dumping?** → The simulated-recoil model drifts accuracy under rapid fire; a miss makes the enemy hear a zip and their headset light with **0 damage**. Fire in bursts. 📖
7. **Hits register from the front but not the back (or vice versa)?** → The headset has separate front and back sensor domes plus a gun-body sensor; a dead dome is a replaceable part (sensor boards for front/left/right are sold). 📖👥✅
8. **Never lands at any range, target mode included?** → IR emitters do die. The laser emitter is a separately replaceable part. 👥📖
✅📖👥 · src: protocol/brx-protocol.md §7r (FF firmware-enforced; dead/unspawned guns ignore IR; sensor map) · docs/reference/brx-extended-user-guide.md (indoor/outdoor, target mode, accuracy) · docs/reference/brx-manual-notes.md · docs/reference/community-notes.md

[callout:info]
**Outdoors, prefer the stock headset.** SwapTX-modded headsets have dimmer LEDs than the BRX headset, which makes it hard to tell in direct sun whether you're landing tags at range. 👥
src: docs/reference/community-notes.md ("Scoping / sighting & outdoor play")

[symptom-ladder]  **"No sound" / "too quiet"**
1. **Did you hear a "pop" at power-on?** → yes → The speaker and amp are powered; check the audio files next. → no → Speaker/wiring; Battle Company sells replacement speakers. 👥
2. **Volume set to 1?** → On-gun volume is 1–5 in the SELECT menu and is remembered per game mode. 📖
3. **Driven from an app or host?** → The wire-level volume command has a much wider range: the official app sends **69**; a "safe" 30 is measurably inaudible for weapon audio outdoors. ✅
4. **Booted into USB disk mode by accident?** → SELECT-at-boot suppresses the startup sound entirely. Reboot with nothing held. 📖
5. **Just updated to v4.30+?** → That release requires a **complete new audio file set** in the `AUDIO` folder; old files leave silences. 👥
6. **Installed a custom pack and only some sounds changed?** → The filenames the app-selected guns use differ from the default gun files; the default weapons to target are SR-100, TAC-87, SMG-X3 and MG7 (→ *Sound* section for the id map). 👥
👥📖✅ · src: docs/reference/community-notes.md (Audio) · docs/reference/brx-extended-user-guide.md (SELECT menu) · CLAUDE.md volume rule / docs/experiment-log.md · docs/reference/brx-manual-notes.md

[symptom-ladder]  **"Battery dies fast" / "won't charge" / replacing a pack**
1. **Charger LED never goes green?** → Confirm it's the 8.4 V two-cell smart charger (headset: any 5 V USB). The LED is red while charging and green when full. 📖
2. **Bluetooth stops holding as the day goes on?** → Firmware won't re-pair BLE below a battery threshold. Top up, or swap packs. 👥
3. **Buying a replacement pack?** → Stock is a **7.4 V, ~2200 mAh Li-ion** with a 2-pin connector. Marketplace packs often have a 3-pin connector; the third (thermistor) pin is ignored by the BRX. **Check polarity — Battle Company's is reversed from the usual convention.** 👥
4. **Want to charge spares without the gun?** → Owners splice a BRX AC adapter onto a battery connector and charge packs on the bench, then hot-swap in the field (one screw near the reload switch opens the gun's battery bay; the v1 headset has a slide compartment). 👥📖
5. **Running a rider board off the tagger?** → Under 300 mA draw from the tagger's port is confirmed OK by Battle Company; most modders use a separate USB power bank anyway. 👥
6. **Want a live reading?** → The USB console `QUERY` shows gun and headset volts; a battery frame also appears over Bluetooth. ✅
📖👥✅ · src: docs/reference/brx-extended-user-guide.md (Battery) · docs/reference/community-notes.md (Hardware / power) · protocol/brx-protocol.md (QUERY record) · docs/experiment-log.md §17 ($VOLTS)

[callout:warn]
**A live pack during a mod fries the mainboard; reversed polarity risks damage.** Unplug the battery before any work inside the shell, meter the connector before plugging a non-stock pack, and never use rechargeable AAs in the AA tray. 👥📖
src: docs/reference/community-notes.md · docs/reference/brx-manual-notes.md

---

### Page: Repairs  (`/manual/fix/repairs`)
_What owners fix themselves, what Battle Company sells, and what's a send-it-back._

[hero]
**BRX repairs are switches, plastic and sensors.** Reload handle, D-pad, power switch, battery bay, sensors and emitter are all reachable; the mainboard is not. Unplug the battery first — every time. 👥📖
src: docs/reference/community-notes.md · docs/reference/brx-manual-notes.md

[callout:warn]  **Before you open anything**
- **Unplug the battery.** A live pack during work inside the shell is how owners have fried mainboards. 👥
- **The emitter is a Class 1 IR laser (980 nm, 38 kHz, ~17 mW measured on our unit).** Don't modify its drive circuit and don't stare into it while probing. 📖✅
- **There is no public mainboard schematic** (only partial community mapping) — don't expect to trace faults beyond the switches and connectors. 👥
- **Never modify stock firmware.** Battle Company's official USB updater is the factory-restore path; a firmware *backup* is not possible over the console. ✅
- Lots of wires and switches live inside; photograph every connector before pulling it. 👥
👥📖✅ · src: docs/reference/community-notes.md · docs/reference/brx-extended-user-guide.md (IR specs) · protocol/brx-protocol.md (QUERY laser mW; "Firmware backup: impossible")

[cards]  **The repair catalogue**
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
👥📖 · src: docs/reference/community-notes.md ("More repairs", "Hardware / power", "Common failures") · docs/reference/brx-manual-notes.md ("Troubleshooting nuggets") · docs/reference/brx-extended-user-guide.md

[image FIX-03]
Reload handle removed, showing the two screws and the switch beneath. 📖👥

[image FIX-06]
A cracked D-pad button next to a good one. 👥

[steps]  **Firmware update over USB (official path — do this only with Battle Company's files)**
1. Gun **off**. Hold **SELECT**, slide power **on**. No startup sound — that's correct.
2. Plug the micro-USB **programming port** (not the charging port) into a computer; a disk drive appears with a firmware `.BIN` at the root and an `AUDIO` folder.
3. Delete the existing `.BIN`, copy the new one to the root. Non-logo guns wait ~10 s and say "UPGRADE COMPLETE"; Gen-1 guns need an extra step (reboot, press SELECT three times).
4. **Expect v4.30+ to wipe your config**, break headset pairing until you re-run setup, and demand a **complete new audio set** in `AUDIO`.
5. Headset, hatchet, shield and sidearm firmware: hold the device's **PROGRAM** pin-button while powering on → disk mode → replace the root file.
📖👥✅ · src: docs/reference/brx-extended-user-guide.md ("Firmware & sound-pack updates over USB") · docs/reference/community-notes.md (Firmware v4.30) · docs/reference/grenade.md (G7)

[callout:tip]
**Keep a record of your gun before it breaks.** The USB console's `QUERY` prints firmware version, the headset PIN, battery voltages, player/field IDs and the grenade pin — the only local "backup" the tagger offers. Save it per gun (it contains the headset PIN, so keep it private). ✅
src: protocol/brx-protocol.md ("QUERY and SETUP")

---

### Page: Mods  (`/manual/fix/mods`)
_The community norm is "no permanent modification" — everything rides on the phone bracket or clips to the rail._

[hero]
**Bolt on, never cut.** From a reload button to a full ESP32 field host, the proven BRX mods leave the tagger stock and reversible — which is also how the Open BRX Companion is designed. 👥
src: docs/reference/community-notes.md ("Modding landscape") · hardware/brx-companion-spec.md

[cards]  **Mods owners actually run**
- **Reload-button mod (the most established BRX print).** Replaces the pull-back reload handle with a push button — easier to store and transport a fleet. A YouTube tutorial exists ("Battle Company BRX Laser Tag Gun Reload Button Modification") and an STL circulates privately in the owners' group. 👥
- **JEDGE tagger rider (LaserTagMods).** An ESP32 that Bluetooth-bridges each tagger for phone-free, host-coordinated multiplayer — scoring, respawn, team/perk/weapon assignment — over ESP-NOW or LoRa, configured from a WiFi web page. Rides on the phone bracket with a USB power bank (a 5000 mAh pack runs ~15 h, about two gun-battery cycles); no permanent mod, no drain on the gun. A field host has run **45 rifles at once**. Credit LaserTagMods (JEDGE/JBOX). 👥
- **JBOX / JCUBE / JBOX Mini / JTOWER / JHALO (Jay, Extreme Laser Tag And More!).** ESP32 objective stations: domination, CTF, respawn, medic, sentry, supply/upgrade, tug-of-war, battle-royale checkpoints. JHALO turns a **spare BRX headset** into a respawn box. Each is its own WiFi hotspot (`192.168.4.1`, ~45 s window after boot to reach the menu), firmware flashed over that page. → *Accessories: stations*. 👥
- **SwapTX headset mod.** A ~$50 replacement headset (single 18650) that unlocks STX-style on-tagger hosting and JEDGE controls — but it has **no IR emitters**, so splash damage, shotguns, pass-through, medics, many Supremacy/Deathmatch perks and base/commander respawn requests are lost. Non-final beta; Battle Company declined to productise it. 👥
- **Custom sound packs.** The tagger's audio is swappable over the programming port (SELECT-at-boot → `AUDIO` folder → replace `<ID>.LTP`). Star Wars overlay packs exist. Keep the originals. → *Sound* section. 📖👥
- **Headset LED mods.** The addressable RGB LEDs are standard WS2812B (5050), wired in series on the BRX headset — one data line, NeoPixel-compatible. 👥
- **Phone bracket / mount.** Battle Company sells the BRX phone bracket; it doubles as the mount for rider boards and power banks. 📖👥
- **Scope.** Sight it in target mode (LEFT-at-boot); indoors ~20 ft, outdoors ~300 ft, snipers 300–400 ft. 📖👥
- **Cosmetics.** 3D-printed skins (private files, SwapTX-style). Painting: clean, scuff, **black Krylon primer**, thin colour coats, clear. Stickers/paint to keep gun–headset pairs matched at events. 👥
👥📖 · src: hardware/print-files.md · docs/reference/lasertagmods.md · docs/reference/jay-ecosystem.md · docs/reference/community-notes.md · hardware/brx-companion-spec.md · docs/reference/brx-extended-user-guide.md

[callout:warn]  **Hard-won electrical cautions for any ESP32 rider (credit Jay / the owners' group)**
- Feed the BRX serial side **3.0–3.4 V logic (~3.06 V sweet spot)** — 5 V produces corrupt characters; even 0.3 V off on the BT-module pins breaks reception.
- Insert **~5 ms between characters** or the tagger garbles/drops them.
- A **diode** is required between the ESP32 TX pin and the board RX / BT-module tab.
- Draw **< 300 mA** if powering from the tagger (Battle Company-confirmed); a separate power bank is the norm.
- Cheap ESP32 D1-mini boards are failure-prone (undersized regulator) — power via USB or add a large capacitor.
- **Use exactly the units in the maintained build docs.** Substituted hardware is what sits behind the "JEDGE 6 doesn't work, LoRa doesn't work" threads. Play **outdoors** — ESP32 radio range is flaky indoors around solid cover.
👥 · src: docs/reference/community-notes.md ("Hardware / power", "Modding landscape", "JEDGE mesh internals")

[table]  **3D-printed parts — what exists (there is no public BRX print library)**
| Part | Status | Where |
|---|---|---|
| Reload-button handle | Exists, shared privately | Owners' group |
| JEDGE rider mount / clip-on cover | Exists, part of the JEDGE build docs | LaserTagMods / owners' group |
| Skins / covers (incl. sniper body) | Private SwapTX work; wanted | Owners' group |
| D-pad replacement buttons | **Wanted, no STL** | Open contribution |
| JBOX enclosures (Box V5 / Disk / Mini) | Published with the JBOX repo — for the accessory, not the tagger; unlicensed | LaserTagMods GitHub |
| Open BRX `hardware/` | Planned MIT library: reload button, D-pad, Companion mount, station enclosures, skins — version-tagged | this project |
👥 · src: hardware/print-files.md

[image FIX-08]
A tagger with the phone bracket carrying a USB power bank and a small ESP32 board — the "rider" pattern. 👥

---

### Page: Accessories  (`/manual/fix/accessories`)
_Grenade, stations, headsets, power and mounts — what each is, and the gotchas nobody tells you._

[cards]  **Smart grenade**
- **What it is:** a portable objective device — button on top, three IR emitters, an emitter+receiver, status LEDs, USB-C charging. Flashes green at power-up = ready. 👥✅
- **Five button-set modes, by LED colour:** red = Frag (thrown blast), green = Assault, blue = Hill (King of the Hill), yellow = Respawn, white = CTF. Set by holding the top button ~4 s (long beep), cycling while it beeps, releasing on the colour; the LED goes white to confirm the lock. Mode persists across power cycles; boot flashes the current mode's colour for ~1 s. ✅
- **Pairing is only for thrown use:** boot the gun holding RIGHT ("install accessory"), shoot the grenade within its 30 s window, pair all accessories in one session. Objective modes need **no pairing** — any gun interacts by IR. 📖✅
- **Respawn-station gotcha:** each tagger must *receive* the station's IR (pre-game exposure or a grenade-button press mid-game) to switch from self-respawn to station-respawn. A tagger that never got it just self-respawns. Stations can be overtaken. ✅👥
- **Known quirks:** no winner display for its own KotH/domination modes; Assault can be captured by the defending team by accident; the mode cannot be set from an app — it is button-locked on the device. 👥✅
- Credit: Jay's two 2019 grenade videos are the de-facto manual; our reference extends them with bench findings. → full grenade page in *Gameplay*.
✅📖👥 · src: docs/reference/grenade.md · docs/reference/brx-extended-user-guide.md (Accessory / grenade pairing)

[image FIX-09]
Smart grenade held in hand, top button and LED visible, LED lit blue. ✅

[cards]  **Other IR-paired accessories (official)**
- **Hatchet, shield, sidearm, extra grenades** — all pair to a specific gun over IR with the same "install accessory" boot so only the owner can trigger them; re-pair everything together whenever you add one. Hatchet, shield and sidearm firmware updates the same way as the gun (PROGRAM button at power-on → disk mode). 📖
📖 · src: docs/reference/brx-extended-user-guide.md

[cards]  **Utility boxes & stations**
- **JBOX family (LaserTagMods / Jay):** IR "smart bases" that a player shoots to capture and that emit IR back to heal, boost, respawn or damage. Modes: single- and multi-point domination (time / shots / damage-weighted), tug-of-war, Ultimate King of the Hill (up to 21 boxes, roles reshuffled every round), battle royale with storm and checkpoints, loot/weapon pickups, proximity mine, gas, alarm. Configured from a phone browser on the box's WiFi hotspot; **JBOX Mini** is the minimal ESP32 + IR rx/tx + one RGB LED, USB-powered. 👥
- **JHALO:** a spare BRX headset plus an ESP32 becomes a respawn/utility box — reuses gear you own. 👥
- **Measured radio ranges (Jay, obstructed trail):** ESP-NOW ~250 ft (~580 ft with an external antenna); LoRa standard mode ~1,370 ft with zero loss but ~3.5 s round trip. 👥
👥 · src: docs/reference/jay-ecosystem.md · docs/reference/lasertagmods.md

[table]  **Headset variants**
| Headset | Notes | Confidence |
|---|---|---|
| v1 | Slide-out battery compartment | 📖 |
| v2 | Single 18650 cell; same hardware as the Battle Rifle Pro headset, firmware differs; 3 W green hit LEDs on four sides plus WS2812B RGB | 📖👥 |
| "Gen-3" pairing | Uses the button-hold + RIGHT-at-boot "PAIRING MODE" procedure | 👥 |
| SwapTX headset (mod) | ~$50, 18650, unlocks on-tagger hosting; **no IR emitters**; dimmer LEDs in sun; beta | 👥 |
| All | Pairs automatically at power-on (up to 3 min); won't pair in target mode; goes dark during play; rainbow = disconnected | 📖✅ |
📖👥✅ · src: docs/reference/brx-extended-user-guide.md · docs/reference/community-notes.md · docs/experiment-log.md 2026-08-27

[spec-sheet]  **Batteries & chargers**
- Gun pack: 7.4 V ~2200 mAh Li-ion, 2-pin connector, **reversed polarity vs. convention** 👥
- Gun charger: 8.4 V two-cell smart charger; LED red while charging → green when full 📖
- Headset: single 18650 (v2); any 5 V USB charger 📖👥
- Runtime: ~8 h play per charge 📖
- Alternative: 6×AA tray, **non-rechargeable only** 📖
- Spares: charge outside the gun via a spliced BRX AC adapter; keep a stack and swap 👥
- Rider power: USB power bank on the bracket (5000 mAh ≈ 15 h of JEDGE); tagger port OK under 300 mA 👥
📖👥 · src: docs/reference/brx-manual-notes.md · docs/reference/brx-extended-user-guide.md · docs/reference/community-notes.md · docs/reference/lasertagmods.md

[cards]  **Mounts & carry**
- **Phone bracket** — official Battle Company part; the standard mount for phones, power banks and rider boards. 📖👥
- **Sling** — drill 7/32" for a sling swivel. 👥
📖👥 · src: hardware/print-files.md · docs/reference/community-notes.md

---

### Page: The community  (`/manual/fix/community`)
_Where BRX owners actually solve things — and what each place is good for._

[cards]  **Resources**
- **BRX Elite Owners Group (Facebook, ~200 members).** The live source: repair threads, battery and pairing fixes, sound-pack swaps, painted-tagger photos (browse the Media tab), and the pinned "JEDGE for all" document. Best for: *"has anyone seen this?"* 👥
- **LaserTagMods on GitHub (JEDGE / JBOX / autoupdate and ~10 more repos).** The de-facto reverse-engineered BRX command dictionary and the JBOX station designs with enclosures and schematics. **No license — read, don't copy.** Best for: protocol facts, station behaviours, current firmware versions. 👥
- **Jay — "Extreme Laser Tag And More!" (YouTube @extremelasertag3602).** The grenade manual that never shipped, measured radio-range tests, every JBOX mode demonstrated, the 45-rifle field host. Best for: seeing a mode or accessory actually work before you build it. 👥
- **lasertaginfo.org forum + Jay's Google Drive.** Legacy JEDGE documentation and binaries. 👥
- **SWAPTX-EVOLVER (Facebook).** The sister group for the SwapTX headset mod and Evolver cross-play. 👥
- **Battle Company (battlecompany.com).** Official manual PDFs (link, don't rehost), firmware updater, replacement parts (speakers, sensor boards, wire bundles, D-pad on request), the phone bracket, and mainboard repair. 📖
- **Open BRX (this project).** MIT-licensed protocol reference, Mission Control, the Companion and Utility Box designs, and the planned open print library. 
👥📖 · src: docs/reference/community-notes.md ("Ecosystem") · docs/reference/lasertagmods.md · docs/reference/jay-ecosystem.md · hardware/print-files.md

[quote]
"No permanent BRX modification" — the community norm. Everything rides on the phone bracket, and the taggers stay stock. 👥
src: docs/reference/community-notes.md ("Modding landscape")

---

### Page: FAQ  (`/manual/fix/faq`)
_The questions owners ask first._

[faq]
- **Why won't my gun fire?** Check the headset first: it's off, unpaired (slow rainbow blink) or dropped mid-game, and the firmware locks the trigger. Link it, or re-pair. Second most common: the game hasn't started (pull the reload handle) or you're dead. ✅📖👥
- **How do I re-pair a headset?** Headset on, hold its small button, boot the tagger holding RIGHT, wait for "PAIRING MODE", pull the trigger once ("HEADSET CONNECTED") and once more ("device paired"). 👥
- **The headset went dark once the game started — is it broken?** No. Team colour shows pre-game only; dark during play is native. Rainbow is the fault state. ✅
- **Can I put custom sounds on the tagger?** Yes. Hold SELECT while powering on with the programming port plugged into a computer; a drive appears with an `AUDIO` folder — replace the `.LTP` files (slow: ~1 h per 250 MB). Keep the originals. 📖👥
- **Which phones work with the official app?** Callsign works on Android 10 and older, not on newer Android. On any phone the headset must be linked or the app disconnects. 👥✅
- **What battery and charger does it take?** A 7.4 V ~2200 mAh Li-ion pack with an 8.4 V two-cell smart charger; the headset charges from any 5 V USB. Optional 6×AA — non-rechargeable only. 📖👥
- **Is the battery polarity really reversed?** Yes — reversed from the usual convention. Meter any replacement pack before plugging it in. 👥
- **Why is my gun called Tactix2 again?** Opening the official app resets the owner-set name. Rename it and power-cycle. ✅
- **Why do guns fail after about an hour of hosted play?** "Screamers": a documented failure of taggers left powered and hosted for long sessions, plus a firmware rule that refuses Bluetooth re-pairing below a battery threshold. Power-rest guns, rotate them, keep batteries topped. 👥✅
- **Do I have to open the gun for JEDGE?** No. It rides on the phone bracket with its own power; stock firmware is never touched. The Open BRX Companion is designed the same way. 👥
- **Can I change the grenade's mode from an app?** No — it's set only by the button-hold on the device, and it stays set across power cycles. 👥✅
- **Where do I get 3D-print files?** There is no public BRX library yet; the reload-button STL circulates in the owners' group. Open BRX is building an open, versioned one. 👥
✅📖👥 · src: pages above

---

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| FIX-01 | Diagnose / hero | Section opener: a laser-tag tagger and headset on a dark workbench with a small screwdriver, multimeter probes and a coiled cable — "we're going to fix this" mood | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a modern black rifle-style laser-tag tagger lying on a dark workbench beside a matching black headband-style sensor headset, a precision screwdriver, two multimeter probes and a coiled cable; a thin electric-blue rim light traces the tagger's edges; one small amber status LED glows on the headset; shallow depth of field, overhead three-quarter angle. |
| FIX-02 | Pairing / LED table | The headset in its "disconnected" state next to a paired one: one slow-blinking rainbow, one solid team colour | REAL PHOTO | owner | Two headsets side by side on a neutral dark surface, shot from the front at eye level; left headset mid-rainbow (catch a colour), right headset solid red or blue; room dim so LEDs read clearly; no stickers/serials visible (mask or turn them away). |
| FIX-03 | Repairs / catalogue | Reload handle removed from the tagger, the two screws and the mechanical switch beneath, a pen tip touching the switch | REAL PHOTO | owner | Right side of the tagger, macro, 45° from above; handle off and placed in frame; battery unplugged and visibly disconnected; a pen pressing the switch. |
| FIX-04 | Hits, sound & battery / battery ladder | Battery bay open (the single screw out), the 2-pin connector and pack visible | REAL PHOTO | owner | Macro of the open bay with the connector oriented so the two wires and their colours are legible; pack label in frame if it shows voltage/capacity; no serial stickers. |
| FIX-05 | Pairing / survives-a-drop compare | Diagram: two columns of "state" tokens — one column persists through a Bluetooth-link break, a subset also persists through a power cycle | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: an abstract diagram of a rifle-shaped silhouette at left connected by a dotted wireless link to a small device silhouette; the link is broken by a lightning-shaped gap in electric blue, while a second, amber power-switch icon sits below; six small rounded tokens hover over the rifle, four outlined in blue (kept) and two fading to grey (lost); minimal, iconographic, generous negative space. |
| FIX-06 | Repairs / catalogue | A cracked D-pad button beside an intact one | REAL PHOTO | owner | Macro, flat lighting; the two buttons on a dark mat; crack clearly visible; optionally the D-pad recess on the tagger in the background. |
| FIX-07 | Pairing / re-pair steps | The re-pair posture: one hand holding the headset's small button, the other holding RIGHT on the D-pad while sliding the power on | REAL PHOTO | owner | Three-quarter view showing both hands and both devices; power switch mid-slide; D-pad thumb on RIGHT; headset button pressed; no stickers. Consider a 3-frame strip: hold button → boot holding RIGHT → trigger pull. |
| FIX-08 | Mods / rider | The tagger's phone bracket carrying a USB power bank and a small ESP32 board, cable to the tagger's port | REAL PHOTO | owner | Side profile of the tagger, bracket and rider in focus; show the clip/strap holding the bank; no brand logos prominent. |
| FIX-09 | Accessories / grenade | The smart grenade in hand, top button and status LED visible, LED lit in one mode colour | REAL PHOTO | owner | Hand-held at chest height, LED blue (Hill) or yellow (Respawn); second frame with the LED white (lock confirmation) if possible; dim room. |
| FIX-10 | Hits, sound & battery / IR ladder | Illustration of IR range in sun vs. shade: two figures, one in harsh sunlight with a short beam, one in shade with a long beam | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a split scene — left half a stylised figure holding a rifle-style laser-tag tagger under a large amber sun, emitting a short, diffused electric-blue beam that fades quickly; right half the same figure under a tree canopy at dusk emitting a long, crisp electric-blue beam reaching the far edge; flat iconographic figures, minimal ground line. |
| FIX-11 | Repairs / firmware steps | Close-up of the tagger's port cluster: charging port, micro-USB programming port, power switch | REAL PHOTO | owner | Macro, straight-on, with a micro-USB cable plugged into the programming port to disambiguate it from the charging port; power switch in frame. |
| FIX-12 | Community / hero | Abstract "network of owners" art: a cluster of small tagger silhouettes connected by faint lines to a central glowing node | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a constellation of small, simplified rifle-style laser-tag tagger silhouettes scattered across the frame, joined by thin dotted electric-blue lines converging on one softly glowing central node; a few nodes accented amber; the feel of a knowledge network, sparse and elegant. |

## Interactive ideas (≤5)
1. **"Diagnose my tagger" wizard** — the four symptom ladders as a branching questionnaire; each yes/no step reveals the fix card, with the confidence emoji and the source link. Ends with "still stuck → community links".
2. **"What did I just lose?" toggle** — a two-state switch (Bluetooth dropped / power-cycled) that greys out the state tokens from the *survives* table so a host knows what to re-send.
3. **Re-pair procedure stepper** — one step per screen with the expected voice line ("PAIRING MODE", "HEADSET CONNECTED", "device paired") shown as a caption, plus a "didn't hear it?" branch.
4. **Headset LED decoder** — tap a colour/pattern (rainbow, red/blue, dark, cycling at power-on) → meaning + provenance.
5. **Battery & pack checker** — pick stock / marketplace 2-pin / 3-pin pack → shows the polarity warning, which pin is ignored, and the charger to use.

## Sources used
- `docs/gotchas.md` — symptom-indexed field lore (headset rainbow, screamers, 1-in-3 connects, ≥5 s back-off, $BMAP/$AMMO/$START, Callsign name wipe)
- `docs/reference/community-notes.md` — won't-fire ladder, Gen-3 re-pair, battery polarity/pack specs, SCREAMERS, common failures (D-pad, power switch, emitters, water), admin lock, v4.30 firmware, audio/SD notes, WS2812B, painting, ecosystem/people, JEDGE cautions and electrical rules, sling drill
- `docs/reference/lasertagmods.md` — JEDGE/JBOX descriptions, QUERY/SETUP/PIN, rider mount + runtime, station behaviours, lineup
- `docs/reference/jay-ecosystem.md` — device family (JBOX/JCUBE/Mini/JTOWER/JHALO/JEDGE/Configurator), WiFi config model, OTA, measured ranges, modes, 45-rifle host
- `docs/reference/brx-manual-notes.md` — controls/ports, battery/charger, range/sun, indoor-outdoor, reload-handle start, headset auto-pair + lockout, target mode, reload-switch pen test, replaceable emitter/receivers
- `docs/reference/brx-extended-user-guide.md` — USB disk mode + firmware/sound updates, accessory firmware, IR laser specs, accessory pairing, SELECT-menu settings, indoor/outdoor + sunlight, RESET, battery/charger/swap, Gen-1 Bluetooth facts
- `docs/reference/grenade.md` — grenade hardware, five modes and setup, pairing for thrown use, respawn-station arming, quirks, USB-C charge-only
- `hardware/print-files.md` — reload-button mod, rider mount, skins, D-pad gap, phone bracket, JBOX enclosures, Open BRX library plan
- `hardware/brx-companion-spec.md`, `hardware/brx-station-spec.md` — Companion / Utility Box one-liners (design stage)
- `docs/experiment-log.md` — §16 headset gates the app; 2026-08-25 late (headset-off = $DISCONNECT, config survives drop); 2026-08-26 screamer reproduction; 2026-08-27 headset LED table; 2026-08-24 QUERY/USB console and name fields; 2026-08-25 night (try-out couldn't fire; Callsign reset $NAME)
- `protocol/brx-protocol.md` — transport table (Gen1 vs Gen2/3), "QUERY and SETUP" console, §7r (survives a BLE drop vs power cycle, handshake after boot, dead/unspawned guns ignore IR, sensor map, FF enforced), "Firmware backup: impossible"
- `docs/unknowns.md`, `docs/VISION.md` ("The definitive BRX manual") — gaps list and sourcing policy
- `CLAUDE.md` — volume 30 vs 69 rule

## Research backlog (held — NOT published)
_Items removed from the pages above because they are unconfirmed, hedged, or contradicted between sources. Each returns to the manual only when confirmed. One line each, with where it came from._

**Held from the page blocks**
- **Headset green LED = hit feedback (blink) / kill feedback (hold)** — owner-reported; whose hit and whose kill is not pinned down. Removed two rows from the *Headset LED language* table and the green states from interactive idea #4. src: docs/experiment-log.md 2026-08-27.
- **Audio SD card: hot-glued to the board vs. removable/swappable for diagnosis** — two community accounts conflict; neither published. Removed the "sound cuts in and out → loose/corrupt SD card" rung from *No sound*. src: docs/reference/community-notes.md (Audio).
- **Reload-handle model variants** — "older and newer BRX handles differ; one owner printed the wrong version"; no way to tell which you have. Removed the gotcha from the reload-button mod card, "version-specific" from the print-parts table, and "model-version specific" from the FAQ. src: hardware/print-files.md · docs/reference/community-notes.md.
- **Smart grenade firmware update path** — the official guide says PROGRAM-button → disk mode like other accessories, but on our bench the grenade's USB-C exposed no data interface and it has no PROGRAM pin. Contradicted; grenade removed from the accessory-firmware step, from the "other accessories" firmware sentence, and the "USB-C is charge-only" quirk held. src: docs/reference/brx-extended-user-guide.md vs docs/reference/grenade.md (G7).
- **"Install accessory" boot = RIGHT vs RIGHT+SELECT** — some owners report RIGHT+SELECT; official says RIGHT. Published RIGHT only; the variant is held. src: docs/reference/community-notes.md.
- **Gun charge time: ~2 h vs 2–4 h** — the V7 manual says ~2 h, the Extended User Guide 2–4 h. Neither published; the diagnose ladder, stat strip, battery ladder and charger spec-sheet state only the charger LED behaviour (red → green) both agree on. src: docs/reference/brx-manual-notes.md · docs/reference/brx-extended-user-guide.md.
- **"~1 in 3" BLE connection attempts succeed** — an operator impression (no counted trial in the log); published only as "establishing a link is intermittent; retry". src: docs/gotchas.md ("Connection failed") · docs/experiment-log.md 2026-08-23 (#5).
- **When the headset-drop firing lockout arrived ("since a 2018/2019 firmware revision")** — community-dated; the mid-game lockout itself was never controlled for on the bench. Date removed from the diagnose callout; the lockout stays as 📖. src: docs/reference/community-notes.md (won't-fire ladder) · docs/experiment-log.md (headset lockout "never controlled for").
- **Callsign on iOS works fine** — "reportedly" only; held. Android ≤10 stays published. src: docs/reference/community-notes.md (Ecosystem).
- **Why rechargeable AAs are banned (lower cell voltage → won't boot / drops out)** — our reasoning, not the manual's; the manual only says never use them. Reason held, rule published. src: docs/reference/brx-manual-notes.md.
- **"Headsets usually don't survive water"** — no concrete report behind it; held (gun recoveries stay). src: docs/reference/community-notes.md (Common failures).
- **Respawn-station reliability "not always consistent"** — vague; held. src: docs/reference/grenade.md.
- **Screamers root cause** — unknown. The symptom (after ~1 h of hosted play, loud buzz, reboot needed) and the separate low-battery BLE re-pair refusal stay as community facts; our all-day-powered bench gun is published as an observation only, not as a reproduction of the same failure. "Power-rest guns / rotate the fleet" prevention advice was ours, not sourced — held. src: docs/reference/community-notes.md (SCREAMERS) · docs/experiment-log.md 2026-08-26.
- **Cases / transport** — "no documented case; the reload-button mod exists largely because fleets are awkward to pack" — speculative; card removed from *Mounts & carry*. src: hardware/print-files.md.
- **Open BRX Companion (rider) and Open BRX Utility Box** — design-stage teasers (❓); cards removed from *Mods* and *Utility boxes & stations*; FAQ now states only that the Companion is *designed* to ride the bracket. src: hardware/brx-companion-spec.md · hardware/brx-station-spec.md.
- Frequency claims rewritten to plain checks: "nine times out of ten / most problems are the headset", "almost always the headset", "the community's #1 / classic mainboard killer", "most repairs are switches and plastic", "3D-printed skins are the dominant route", "'JEDGE doesn't work' threads are almost always off-script hardware", "low headset battery is the quietest cause".

**Open gaps (carried over from "Still cracking")**
- **D-pad replacement STL** — nobody has published one; the most-requested first contribution to the open print library.
- **Full mainboard schematic** — none public; only partial community mapping.
- **Which Bluetooth-drop states are shared with the headset** — the gun↔headset link carries team colour, but that channel is uncharacterised.
- **CTF grenade team assignment and the King-of-the-Hill charge level** — not yet decoded.
- **Exact `$VOLTS` battery-frame decode** and a reliable "low battery → BLE refuses to pair" threshold number.
- **IR emitter replacement** — the part is sold and replaceable per the manual, but no step-by-step procedure is documented anywhere we've found.
- **Smart grenade `.bin` updates** — owners say one exists; mechanism unknown (see the firmware-path contradiction above).

**Images:** none removed — no image slot illustrated only a held claim (FIX-02 shows rainbow vs team colour, both published).
