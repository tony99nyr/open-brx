# What you can build at each budget
_Start at $0 with the gear you own. Every rung after is optional and additive._
Last verified: 2026-08-27

Starting inventory assumed: **4 BRX taggers (+ headsets), 2 Smart Grenades, a laptop or phone you already own.** No mods, no builds, no purchases. These are *spend* tiers.
Source: docs/build-tiers.md

**Tier 0 — $0 · exactly what you own** ✅ (the pilot)
- Laptop in BLE range drives the guns directly — a room, a yard, a small field
- Configure + start a game, spawn, live hit/death tracking, host-driven respawn, synchronised start ✅
- TDM ✅; FFA / Infection / LMS engines 🧪; laptop scoreboard 🧪
- Custom weapons (`$WEAP`: damage, rate, mag, reload type, per-fire sounds — all 20 Callsign weapons captured and rebalanced) ✅
- Diagnostics (firmware, battery, per-tagger health) ✅
- Custom on-tagger sound packs over USB ✅
- Grenade objectives: Hill / Respawn / Assault / CTF / CS bomb ✅ (CTF team-assign open)
- Outdoor: phone GPS geofence = unlimited free objective points 📐; indoor: grenades + paper QR + phone touch-terminals 📐
- **Limit:** everyone stays in the laptop's BLE range; no per-player HUD

**Tier 1 — old Android / iOS phones as nodes · ~$0 if you have them (else ~$30–50 used)** 🧪
- The biggest capability jump for the least money: the link rides the player
- Full-field roaming for every Tier-0 mode; a **per-player HUD** ("your score / ammo / lives" — the #1 thing players ask for); offline play with results syncing at the base
- Native app on Android + iOS (ADR-0003); one phone per gun
- **Status:** one phone → MC → gun proven at the bench; multi-phone field play not yet run

**Tier 2 — ESP32 Companion per tagger · ~$12–25 each** 📐
- Purpose-built, rugged, phone-free node; reconstructs the native kill flash + audio
- Power-ups (extra life, faster fire, damage boost, shields) as decoded command sequences
- ESP-NOW mesh between Companions for instant field-wide kill-confirm
- Optional +$5–7 loud custom audio, +$8–12 on-gun HUD

**Tier 3 — objective stations · ~$5–15 each (+ paper QR ~$0)** 📐 design · ✅ IR emit proven
- Domination (multi-point + live scoreboard), KotH, CTF variants, Assault, Extraction point, bomb site, respawn stations (data-mule sync)
- Grenades cover single-objective modes for $0; stations are for multi-point, live ownership/scoring and respawn

**Tier 4 — field radio · LoRa ~$10/node (or the gun's own nRF, unprobed, maybe free)** 📐
- Live coordination on a large no-Wi-Fi park: "flag taken!" broadcast, live HQ scoreboard, station status screens, Battle Royale
Source: docs/build-tiers.md, docs/mode-limits.md §3

## The Tier-0 objective toolkit (no bought hardware)
| Mechanism | Interaction | Good for | Limit |
|---|---|---|---|
| **Grenade ×2** ✅ | shoot it (IR) | flag, hill, extraction hold, bomb site, respawn | only 2; finicky button config |
| **Phone GPS geofence** 📐 | automatic | outdoor flag / hill / extraction / BR zone — unlimited points | outdoor only (~5–10 m) |
| **Printed QR + phone camera** 📐 | scan it | checkpoints, plant sites, pickups | needs an active scan |
| **Phone touch-terminal** 📐 | touch the screen | bomb plant/defuse, hack, hostage | needs a screen at the site |
| **Spare gun as a point** 📐 | shoot it (IR) | an extra capture point | uses up a gun |
Source: docs/build-tiers.md §Tier 0

## Environmental effects — a subscriber layer, gated by devices not by tier
| Effect | Trigger | Controller | ~Cost | Status |
|---|---|---|---|---|
| Music during the game | engine playlist | laptop audio → speakers | ~free | 🧪 |
| Stingers on events (streak, capture, last 10 s, game over) | engine event | same speakers, priority queue | ~free | 🧪 |
| Respawn → flash a light | respawn event | Wi-Fi smart plug or ESP32 + relay | ~$8–12 | 📐 |
| Last 10 s → red pulse lighting | clock | WLED strip or smart plug | ~$8–25 | 📐 |
| Smoke every 10 min / proximity smoke | timer or PIR / station | ESP32 + relay on the machine's remote jack | ~$8 + machine | 📐 |
| Team-colour / chase lighting, blacklights | MQTT events | WLED ESP32 + addressable strip | ~$15–25/zone | 📐 |
Source: docs/build-tiers.md §Environmental effects

## Cheapest high-value path:
run the Tier-0 software on your laptop today, then put the phone app on the Android/iOS phones you already own. That alone gets you orchestrated, custom, multi-mode games for 4 taggers + 2 grenades with **no hardware spend** — everything after is optional. ✅/🧪
Source: docs/build-tiers.md §Cheapest high-value path
