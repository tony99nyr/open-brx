# Mods
_The community norm is "no permanent modification" — everything rides on the phone bracket or clips to the rail._
Last verified: 2026-08-27

**Bolt on, never cut.** From a reload button to a full ESP32 field host, the proven BRX mods leave the tagger stock and reversible — which is also how the Open BRX Companion is designed. 👥
Source: docs/reference/community-notes.md ("Modding landscape") · hardware/brx-companion-spec.md

## Mods owners actually run
- **Reload-button mod (the most established BRX print).** Replaces the pull-back reload handle with a push button — easier to store and transport a fleet. A YouTube tutorial exists ("Battle Company BRX Laser Tag Gun Reload Button Modification") and an STL circulates privately in the owners' group. 👥
- **JEDGE tagger rider (LaserTagMods).** An ESP32 that Bluetooth-bridges each tagger for phone-free, host-coordinated multiplayer — scoring, respawn, team/perk/weapon assignment — over ESP-NOW or LoRa, configured from a WiFi web page. Rides on the phone bracket with a USB power bank (a 5000 mAh pack runs ~15 h, about two gun-battery cycles); no permanent mod, no drain on the gun. A field host has run **45 rifles at once**. Credit LaserTagMods (JEDGE/JBOX). 👥
- **JBOX / JCUBE / JBOX Mini / JTOWER / JHALO (Jay, Extreme Laser Tag And More!).** ESP32 objective stations: domination, CTF, respawn, medic, sentry, supply/upgrade, tug-of-war, battle-royale checkpoints. JHALO turns a **spare BRX headset** into a respawn box. Each is its own WiFi hotspot (`192.168.4.1`, ~45 s window after boot to reach the menu), firmware flashed over that page. → *Accessories: stations*. 👥
- **SwapTX headset mod.** A ~$50 replacement headset (single 18650) that unlocks STX-style on-tagger hosting and JEDGE controls — but it has **no IR emitters**, so splash damage, shotguns, pass-through, medics, many Supremacy/Deathmatch perks and base/commander respawn requests are lost. Non-final beta; Battle Company declined to productise it. 👥
- **Custom sound packs.** The tagger's audio is swappable over the programming port (SELECT-at-boot → `AUDIO` folder → replace `<ID>.LTP`). Star Wars overlay packs exist. Keep the originals. → *Sound* section. 📖👥
- **Headset LED mods.** The addressable RGB LEDs are standard WS2812B (5050), wired in series on the BRX headset — one data line, NeoPixel-compatible. 👥
- **Phone bracket / mount.** Battle Company sells the BRX phone bracket; it doubles as the mount for rider boards and power banks. 📖👥
- **Scope.** Sight it in target mode (LEFT-at-boot); indoors ~20 ft, outdoors ~300 ft, snipers 300–400 ft. 📖👥
- **Cosmetics.** 3D-printed skins (private files, SwapTX-style). Painting: clean, scuff, **black Krylon primer**, thin colour coats, clear. Stickers/paint to keep gun–headset pairs matched at events. 👥
Source: hardware/print-files.md · docs/reference/lasertagmods.md · docs/reference/jay-ecosystem.md · docs/reference/community-notes.md · hardware/brx-companion-spec.md · docs/reference/brx-extended-user-guide.md

## Hard-won electrical cautions for any ESP32 rider (credit Jay / the owners' group)
- Feed the BRX serial side **3.0–3.4 V logic (~3.06 V sweet spot)** — 5 V produces corrupt characters; even 0.3 V off on the BT-module pins breaks reception.
- Insert **~5 ms between characters** or the tagger garbles/drops them.
- A **diode** is required between the ESP32 TX pin and the board RX / BT-module tab.
- Draw **< 300 mA** if powering from the tagger (Battle Company-confirmed); a separate power bank is the norm.
- Cheap ESP32 D1-mini boards are failure-prone (undersized regulator) — power via USB or add a large capacitor.
- **Use exactly the units in the maintained build docs.** Substituted hardware is what sits behind the "JEDGE 6 doesn't work, LoRa doesn't work" threads. Play **outdoors** — ESP32 radio range is flaky indoors around solid cover.
Source: docs/reference/community-notes.md ("Hardware / power", "Modding landscape", "JEDGE mesh internals")

## 3D-printed parts — what exists (there is no public BRX print library)
| Part | Status | Where |
|---|---|---|
| Reload-button handle | Exists, shared privately | Owners' group |
| JEDGE rider mount / clip-on cover | Exists, part of the JEDGE build docs | LaserTagMods / owners' group |
| Skins / covers (incl. sniper body) | Private SwapTX work; wanted | Owners' group |
| D-pad replacement buttons | **Wanted, no STL** | Open contribution |
| JBOX enclosures (Box V5 / Disk / Mini) | Published with the JBOX repo — for the accessory, not the tagger; unlicensed | LaserTagMods GitHub |
| Open BRX `hardware/` | Planned MIT library: reload button, D-pad, Companion mount, station enclosures, skins — version-tagged | this project |
Source: hardware/print-files.md

_[image FIX-08: ]_
