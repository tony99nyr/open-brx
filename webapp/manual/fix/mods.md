# Mods
_The community norm is "no permanent modification". Everything rides on the phone bracket or clips to the rail._
Last verified: 2026-08-27

**Bolt on, never cut.** The proven BRX mods run from a reload button up to a full ESP32 field host. Every one of them leaves the tagger stock and reversible. That is also how the Open BRX Companion is designed. 👥
Source: docs/reference/community-notes.md ("Modding landscape") · hardware/brx-companion-spec.md

## Mods owners actually run
- **Reload-button mod (the most established BRX print).** It swaps the pull-back reload handle for a push button, which makes a fleet easier to store and carry. A YouTube tutorial exists ("Battle Company BRX Laser Tag Gun Reload Button Modification"). An STL circulates privately in the owners' group. 👥
- **JEDGE tagger rider (LaserTagMods).** An ESP32 that Bluetooth-bridges each tagger for phone-free, host-run multiplayer. It handles scoring, respawn, and team, perk and weapon assignment. It talks over ESP-NOW or LoRa, and you set it up from a WiFi web page. It rides on the phone bracket with a USB power bank. A 5000 mAh pack runs ~15 h, about two gun-battery cycles. There is no permanent mod and no drain on the gun. One field host has run **45 rifles at once**. Credit LaserTagMods (JEDGE/JBOX). 👥
- **JBOX / JCUBE / JBOX Mini / JTOWER / JHALO (Jay, Extreme Laser Tag And More!).** ESP32 objective stations: domination, CTF, respawn, medic, sentry, supply/upgrade, tug-of-war, battle-royale checkpoints. JHALO turns a **spare BRX headset** into a respawn box. Each one is its own WiFi hotspot (`192.168.4.1`). You get a ~45 s window after boot to reach the menu. Firmware is flashed from that page. → *Accessories: stations*. 👥
- **SwapTX headset mod.** A ~$50 replacement headset (single 18650) that unlocks STX-style on-tagger hosting and JEDGE controls. It has **no IR emitters**, so you lose splash damage, shotguns, pass-through, medics, many Supremacy and Deathmatch perks, and base/commander respawn requests. It is a non-final beta, and Battle Company declined to productise it. 👥
- **Custom sound packs.** The tagger's audio swaps over the programming port (SELECT-at-boot → `AUDIO` folder → replace `<ID>.LTP`). Star Wars overlay packs exist. Keep the originals. → *Sound* section. 📖👥
- **Headset LED mods.** The addressable RGB LEDs are standard WS2812B (5050). They are wired in series on the BRX headset, on one data line, and they are NeoPixel-compatible. 👥
- **Phone bracket / mount.** Battle Company sells the BRX phone bracket. It doubles as the mount for rider boards and power banks. 📖👥
- **Scope.** Sight it in target mode (LEFT-at-boot). Indoors ~20 ft, outdoors ~300 ft, snipers 300–400 ft. 📖👥
- **Cosmetics.** 3D-printed skins exist (private files, SwapTX-style). Painting: clean, scuff, **black Krylon primer**, thin colour coats, clear. Owners use stickers or paint to keep gun and headset pairs matched at events. 👥
Source: hardware/print-files.md · docs/reference/lasertagmods.md · docs/reference/jay-ecosystem.md · docs/reference/community-notes.md · hardware/brx-companion-spec.md · docs/reference/brx-extended-user-guide.md

## Hard-won electrical cautions for any ESP32 rider (credit Jay / the owners' group)
- Feed the BRX serial side **3.0–3.4 V logic (~3.06 V sweet spot)**. 5 V produces corrupt characters, and even 0.3 V off on the BT-module pins breaks reception.
- Insert **~5 ms between characters**, or the tagger garbles or drops them.
- A **diode** is required between the ESP32 TX pin and the board RX or BT-module tab.
- Draw **< 300 mA** if you power from the tagger (Battle Company-confirmed). A separate power bank is the norm.
- Cheap ESP32 D1-mini boards fail often because the regulator is undersized. Power them over USB, or add a large capacitor.
- **Use exactly the units in the maintained build docs.** Swapped-in hardware is what sits behind the "JEDGE 6 doesn't work, LoRa doesn't work" threads. Play **outdoors**. ESP32 radio range is flaky indoors around solid cover.
Source: docs/reference/community-notes.md ("Hardware / power", "Modding landscape", "JEDGE mesh internals")

## 3D-printed parts: what exists (there is no public BRX print library)
| Part | Status | Where |
|---|---|---|
| Reload-button handle | Exists, shared privately | Owners' group |
| JEDGE rider mount / clip-on cover | Exists, part of the JEDGE build docs | LaserTagMods / owners' group |
| Skins / covers (incl. sniper body) | Private SwapTX work; wanted | Owners' group |
| D-pad replacement buttons | **Wanted, no STL** | Open contribution |
| JBOX enclosures (Box V5 / Disk / Mini) | Published with the JBOX repo. For the accessory, not the tagger; unlicensed | LaserTagMods GitHub |
| Open BRX `hardware/` | Planned MIT library, version-tagged: reload button, D-pad, Companion mount, station enclosures, skins | this project |
Source: hardware/print-files.md

_[image FIX-08: ]_
