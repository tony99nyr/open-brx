# Native game modes & their settings
_Everything the gun's own menu and the Callsign app will run, with the exact option values_
Last verified: 2026-08-27

The gun's menu offers seven modes with no phone at all; the Callsign app adds objective play (flags, control points, QR pickups, Battle Royale) and premium unlocks. Under both, the tagger itself only fires, gets hit, tracks health and reports — the rules live in the gun menu's firmware presets or in the app.
Source: docs/reference/brx-extended-user-guide.md §Game modes, protocol/callsign-extract/apk-harvest.md §Game modes

## Gun-menu modes (no phone)
the mode LED colour shows what you picked. Modes marked ★ are Callsign-Live unlocks on the gun.
| Mode | LED | Teams | How it plays | Weapons / perks |
|---|---|---|---|---|
| **Free For All** | white | none — everyone is one team with friendly fire **on** | most kills wins | M-4, SMG-X3, MG-7, SR-100 · no perks |
| **Death Match / Team Death Match** ★ | red | Alpha vs Bravo | team kills | M-4, SMG-X3, MG-7, SR-100, TAC-87 · **the only stock mode with the perk row** |
| **Generals** ★ | yellow | two teams, each with a **General** | the General is the team's mobile respawn point — revive by pulling the trigger at them; can be lives-limited for seek-and-destroy | TDM loadouts + perks |
| **Supremacy** ★ | blue | 3 factions: Resistance (red) · Vanguard (green) · Nexus (blue) | class-based; 9 characters are the loadout | no weapon picker — the character *is* the loadout; abilities on ALT |
| **Commander** ★ | pink | faction wars | Supremacy plus a Commander respawn character | class loadouts |
| **Survival (Infection)** | green | Human vs Infected | a killed human converts to infected; last human wins | M-4, SMG-X3, MG-7, SR-100, TAC-87 · no perks |
| **The Swarm** ★ | orange | Human vs Infected + a **Hive Queen** | infection where the Queen is the infected respawn point | class loadouts |
Source: docs/reference/brx-extended-user-guide.md §Game modes, docs/reference/brx-manual-notes.md §Game modes + §Per-mode weapons & perks

## Starting a gun-menu game
1. Power on (slide switch by the barrel). LEFT/RIGHT cycle modes; **trigger selects**.
2. D-pad picks team/faction; trigger cycles weapons or characters; **ALT cycles perks**.
3. D-pad sets lives / time / respawn / volume; SELECT advances. Settings persist as the new defaults.
4. **Pull the reload handle to start.** Headsets pair automatically after power-on (up to ~3 min with many taggers around).
Source: docs/reference/brx-manual-notes.md §On-gun game flow + §Headset

## Gun-menu settings — every value
- **Lives:** a count, or unlimited
- **Game time:** Off · 5 · 10 · 15 · 20 · 30 min
- **Respawn:** Off · 15 · 30 · 60 s · Ramp 45 · Ramp 90
- **Volume:** 1–5
- **Indoor / outdoor:** hold ALT 3 s (persists across power-cycles; indoor dims the green hit LEDs, enables the RGB LEDs, shrinks explosion/melee range; bright sun cuts hit radius ~50 %)
- **Region:** USA / International (the app's `GunLaserRegion` setting) — a factory setting, leave it alone
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, protocol/callsign-extract/apk-harvest.md §Region

## Callsign app modes
the complete list found in the app, with what each is built from. The app screens group them under categories (Team Arena · Battle Royale · Battle Lines · Faction Wars · Infection) and mode tiles (Arena · Team Arena · Team Snipers · Capture the Flag).
| Mode | Win rule | Props | Notes |
|---|---|---|---|
| Free For All | most kills (Slayer) | — | everyone vs everyone |
| Team Death Match | team kills / elimination | — | |
| Supremacy | score / control | — | 3 factions, class-based |
| Survival / Infection | last human | — | kill converts a human |
| Last Man Standing | last alive | — | limited lives |
| Capture the Flag | captures | **QR flags** | a flag carrier's headset blinks; "scary music" plays on the carrier's tagger |
| Domination | most control-point time | **QR / grenade control points** | |
| Assault | objectives armed/held | QR / grenade objectives | attackers arm, defenders hold |
| Territory (King of the Hill) | time held | one zone | |
| Team Arena | kills + captures | **QR weapon pickups + flags** | TDM with pickups |
| Battle Royale | last standing | **GPS** weapon/supply drops, shrinking zone | no-team option, Low/Medium/Full starting health, show/hide players remaining |
| Generals ★ | eliminate the General / kills | — | premium unlock |
| Commanders ★ | seek-and-destroy the Commander | — | premium unlock |
| Swarm ★ | last human | — | premium unlock |
🔍📖 (★ = paid unlock via the app's currency/subscription)
Source: protocol/callsign-extract/apk-harvest.md §Game modes + §Win conditions + §QR-code stations + §Monetization, docs/reference/callsign-ui.md §Game categories + §Game modes, docs/reference/community-notes.md §Grenade notes (CTF music), docs/game-modes.md §Catalog

## The app's "boxes" are paper.
Respawn points, weapon pickups, capture/control points and supply drops are printed **QR codes** the player scans or fires at — the no-hardware counterpart of LaserTagMods' JBOX utility box. A weapon pickup simply pushes a new weapon into a slot on your gun. Pickup pool seen in the app: Auto Rifle, Burst Rifle, Sniper Rifle, Shotgun, SMG/SAW, Sticky, Rail Gun, Rocket Launcher, Energy Rifle, War Hammer, Strike Rifle (scoped/unscoped), and "other players".
Source: protocol/callsign-extract/apk-harvest.md §QR-code stations + §Weapon spawns

## Callsign GAME SETTINGS — every field on the screen
- **Primary weapon / Secondary weapon** — pickers from the roster; the secondary is removable
- **Weapon respawn:** 30 sec · 60 sec · 90 sec · 3 min
- **Weapon pick-up:** Scan · Player · Both
- **Weapon selection:** ON / OFF
- **Outdoor mode:** ON / OFF
- **Voice:** Male · Female (that is the whole announcer choice in the app)
- **Time:** minutes (e.g. 1)
- **Score to win:** a number (e.g. 25)
- **Respawn type:** Scanner · Auto
- **Respawn time:** seconds (e.g. 15)
- **Lives:** a count, or Unlimited
- **Create-game step (Battle Royale / no-team modes):** Allow Teams · No Teams — Starting Health Low · Medium · Full — Players Remaining Show · Hide
- **App settings (gear):** one Sound slider. That's it.
Source: docs/reference/callsign-ui.md §GAME SETTINGS + §CREATE GAME + §App settings

_[image GAME-08: Mode icon set — FFA, TDM, Generals, Supremacy, Survival/Infection, Swarm, CTF, Domination, KotH, Battle Royale, Extraction.]_
