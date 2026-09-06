# What you can build at each budget
_Start at $0 with the gear you own. Every step after that is optional._
Last verified: 2026-09-06

Starting inventory assumed: **4 BRX taggers (+ headsets), 2 Smart Grenades, a laptop or phone you already own.** No mods, no builds, no purchases. These are *spend* tiers.
Source: this page's pricing tiers below

**Tier 0: $0 · exactly what you own** ✅ (the pilot)
- A laptop in BLE range drives the guns directly, so a room, a yard or a small field works
- Set up and start a game, spawn, live hit and death tracking, host-driven respawn, synced start ✅
- TDM ✅; FFA / Infection / LMS engines 🧪; laptop scoreboard 🧪
- Custom weapons (`$WEAP`: damage, rate, mag, reload type, per-fire sounds; all 19 Callsign weapons captured (20 frames) and rebalanced) ✅
- Diagnostics (firmware, battery, per-tagger health) ✅
- Custom on-tagger sound packs over USB ✅
- Grenade objectives: Hill / Respawn / Assault / CTF / CS bomb ✅ (CTF team-assign open)
- Outdoor: a phone GPS geofence gives unlimited free objective points 📐; indoor: grenades + paper QR + phone touch-terminals 📐
- **Limit:** everyone stays in the laptop's BLE range, and there is no per-player HUD

**Tier 1: old Android / iOS phones as nodes · ~$0 if you have them (else ~$30–50 used)** 🧪
- The biggest jump in what you can do for the least money, because the link rides the player
- Full-field roaming for every Tier-0 mode; a **per-player HUD** ("your score / ammo / lives", the #1 thing players ask for); offline play with results syncing at the base
- Native app on Android + iOS (ADR-0003), one phone per gun
- **Status:** two phones, two whole matches on real hardware outdoors (2026-08-30, 2026-09-01); more than two phones not yet run

**Tier 2: ESP32 Companion per tagger · ~$12–25 each** 📐
- A purpose-built, rugged, phone-free node that rebuilds the native kill flash and audio
- Power-ups (extra life, faster fire, damage boost, shields) as decoded command sequences
- ESP-NOW mesh between Companions for instant field-wide kill-confirm
- Optional +$5–7 loud custom audio, +$8–12 on-gun HUD

**Tier 3: objective stations · ~$5–15 each (+ paper QR ~$0)** 📐 design · ✅ IR emit proven
- Domination (multi-point + live scoreboard), KotH, CTF variants, Assault, Extraction point, bomb site, respawn stations (data-mule sync)
- Grenades cover single-objective modes for $0. Stations are for multi-point play, live ownership and scoring, and respawn

**Tier 4: field radio · LoRa ~$10/node (or the gun's own nRF, unprobed, maybe free)** 📐
- Live coordination on a large park with no Wi-Fi: "flag taken!" broadcast, live HQ scoreboard, station status screens, Battle Royale
Source: docs/game-modes.md §Hard ceilings

## The Tier-0 objective toolkit (no bought hardware)
| Mechanism | Interaction | Good for | Limit |
|---|---|---|---|
| **Grenade ×2** ✅ | shoot it (IR) | flag, hill, extraction hold, bomb site, respawn | only 2; finicky button config |
| **Phone GPS geofence** 📐 | automatic | outdoor flag / hill / extraction / BR zone, unlimited points | outdoor only (~5–10 m) |
| **Printed QR + phone camera** 📐 | scan it | checkpoints, plant sites, pickups | needs an active scan |
| **Phone touch-terminal** 📐 | touch the screen | bomb plant/defuse, hack, hostage | needs a screen at the site |
| **Spare gun as a point** 📐 | shoot it (IR) | an extra capture point | uses up a gun |
Source: this page's Tier 0 above

## Environmental effects: a listener layer, gated by devices not by tier
| Effect | Trigger | Controller | ~Cost | Status |
|---|---|---|---|---|
| Music during the game | engine playlist | laptop audio → speakers | ~free | 🧪 |
| Stingers on events (streak, capture, last 10 s, game over) | engine event | same speakers, priority queue | ~free | 🧪 |
| Respawn → flash a light | respawn event | Wi-Fi smart plug or ESP32 + relay | ~$8–12 | 📐 |
| Last 10 s → red pulse lighting | clock | WLED strip or smart plug | ~$8–25 | 📐 |
| Smoke every 10 min / proximity smoke | timer or PIR / station | ESP32 + relay on the machine's remote jack | ~$8 + machine | 📐 |
| Team-colour / chase lighting, blacklights | MQTT events | WLED ESP32 + addressable strip | ~$15–25/zone | 📐 |
Source: this page's Environmental effects above

## Cheapest high-value path:
run the Tier-0 software on your laptop today. Later, put the phone app on the Android or iOS phones you already own. That alone gets you hosted, custom, multi-mode games for 4 taggers + 2 grenades with **no hardware spend**. Everything after that is optional. ✅/🧪
Source: this page's Tier ladder above
