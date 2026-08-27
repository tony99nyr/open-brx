# Accessories
_Grenade, stations, headsets, power and mounts — what each is, and the gotchas nobody tells you._
Last verified: 2026-08-27

## Smart grenade
- **What it is:** a portable objective device — button on top, three IR emitters, an emitter+receiver, status LEDs, USB-C charging. Flashes green at power-up = ready. 👥✅
- **Five button-set modes, by LED colour:** red = Frag (thrown blast), green = Assault, blue = Hill (King of the Hill), yellow = Respawn, white = CTF. Set by holding the top button ~4 s (long beep), cycling while it beeps, releasing on the colour; the LED goes white to confirm the lock. Mode persists across power cycles; boot flashes the current mode's colour for ~1 s. ✅
- **Pairing is only for thrown use:** boot the gun holding RIGHT ("install accessory"), shoot the grenade within its 30 s window, pair all accessories in one session. Objective modes need **no pairing** — any gun interacts by IR. 📖✅
- **Respawn-station gotcha:** each tagger must *receive* the station's IR (pre-game exposure or a grenade-button press mid-game) to switch from self-respawn to station-respawn. A tagger that never got it just self-respawns. Stations can be overtaken. ✅👥
- **Known quirks:** no winner display for its own KotH/domination modes; Assault can be captured by the defending team by accident; the mode cannot be set from an app — it is button-locked on the device. 👥✅
- Credit: Jay's two 2019 grenade videos are the de-facto manual; our reference extends them with bench findings. → full grenade page in *Gameplay*.
Source: docs/reference/grenade.md · docs/reference/brx-extended-user-guide.md (Accessory / grenade pairing)

_[image FIX-09: ]_

## Other IR-paired accessories (official)
- **Hatchet, shield, sidearm, extra grenades** — all pair to a specific gun over IR with the same "install accessory" boot so only the owner can trigger them; re-pair everything together whenever you add one. Hatchet, shield and sidearm firmware updates the same way as the gun (PROGRAM button at power-on → disk mode). 📖
Source: docs/reference/brx-extended-user-guide.md

## Utility boxes & stations
- **JBOX family (LaserTagMods / Jay):** IR "smart bases" that a player shoots to capture and that emit IR back to heal, boost, respawn or damage. Modes: single- and multi-point domination (time / shots / damage-weighted), tug-of-war, Ultimate King of the Hill (up to 21 boxes, roles reshuffled every round), battle royale with storm and checkpoints, loot/weapon pickups, proximity mine, gas, alarm. Configured from a phone browser on the box's WiFi hotspot; **JBOX Mini** is the minimal ESP32 + IR rx/tx + one RGB LED, USB-powered. 👥
- **JHALO:** a spare BRX headset plus an ESP32 becomes a respawn/utility box — reuses gear you own. 👥
- **Measured radio ranges (Jay, obstructed trail):** ESP-NOW ~250 ft (~580 ft with an external antenna); LoRa standard mode ~1,370 ft with zero loss but ~3.5 s round trip. 👥
Source: docs/reference/jay-ecosystem.md · docs/reference/lasertagmods.md

## Headset variants
| Headset | Notes | Confidence |
|---|---|---|
| v1 | Slide-out battery compartment | 📖 |
| v2 | Single 18650 cell; same hardware as the Battle Rifle Pro headset, firmware differs; 3 W green hit LEDs on four sides plus WS2812B RGB | 📖👥 |
| "Gen-3" pairing | Uses the button-hold + RIGHT-at-boot "PAIRING MODE" procedure | 👥 |
| SwapTX headset (mod) | ~$50, 18650, unlocks on-tagger hosting; **no IR emitters**; dimmer LEDs in sun; beta | 👥 |
| All | Pairs automatically at power-on (up to 3 min); won't pair in target mode; goes dark during play; rainbow = disconnected | 📖✅ |
Source: docs/reference/brx-extended-user-guide.md · docs/reference/community-notes.md · docs/experiment-log.md 2026-08-27

## Batteries & chargers
- Gun pack: 7.4 V ~2200 mAh Li-ion, 2-pin connector, **reversed polarity vs. convention** 👥
- Gun charger: 8.4 V two-cell smart charger; LED red while charging → green when full 📖
- Headset: single 18650 (v2); any 5 V USB charger 📖👥
- Runtime: ~8 h play per charge 📖
- Alternative: 6×AA tray, **non-rechargeable only** 📖
- Spares: charge outside the gun via a spliced BRX AC adapter; keep a stack and swap 👥
- Rider power: USB power bank on the bracket (5000 mAh ≈ 15 h of JEDGE); tagger port OK under 300 mA 👥
Source: docs/reference/brx-manual-notes.md · docs/reference/brx-extended-user-guide.md · docs/reference/community-notes.md · docs/reference/lasertagmods.md

## Mounts & carry
- **Phone bracket** — official Battle Company part; the standard mount for phones, power banks and rider boards. 📖👥
- **Sling** — drill 7/32" for a sling swivel. 👥
Source: hardware/print-files.md · docs/reference/community-notes.md
