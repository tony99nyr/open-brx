# Callsign app — UI reference (screens, modes, weapons, settings)

**Source:** the official **Battle Company "Callsign" app** (iOS), screenshotted by Tony 2026-08-25.
Restated as facts for design/interop reference. **The raw screenshots are kept OUT of the repo** (local
only) per the restate-facts-don't-rehost-copyrighted-assets policy (`VISION.md` §Sourcing). Complements
the APK teardown (`protocol/callsign-extract/`) with the *operator-facing* config surface — i.e. exactly
what **Mission Control** must expose, and what our `GameConfig` / `$GSET`/`$PSET`/`$WEAP` maps to.

> **Tony's read (design intent):** the app is **ugly and clunky — we can do much better.** Capture it as
> the *functional* baseline (every knob a game needs), not the UX target. Notable clunk: a **1-at-a-time
> horizontal carousel** to pick a game category (see UX notes at the bottom), a **global settings screen
> that is literally one Sound slider**, and cramped two-column game-settings.

## Screen flow

```
SELECT A GAME (category carousel)  ->  SELECT GAME MODE (4 tiles)  ->  GAME SETTINGS (loadout + rules)
   -> [CREATE GAME extra step for some modes: teams / health / players-remaining] -> lobby -> start
```

## Game categories — "SELECT A GAME" (horizontal carousel, 1 shown at a time)
Team Arena · Battle Royale · Battle Lines · Faction Wars · Infection *(carousel — there may be more off
either edge; these are the ones captured)*.

## Game modes — "SELECT GAME MODE" (4 tiles, under a category)
**Arena · Team Arena · Team Snipers · Capture the Flag** *(captured set; other categories likely surface
their own mode tiles)*.

## Weapon roster — "SELECT WEAPON" (~18 weapons)

Each weapon shows three exact numbers (icons) + relative Damage/RPM/Range bars. Icons decoded:
**🔫 clip size · �curved-mag = reserve mags · ⏱ reload seconds.** (Damage/Range below are qualitative
from the bar fill; clip/mags/reload are the exact printed values — the useful data for `WEAPON_AMMO`.)

| Weapon | Clip | Mags | Reload s | Notes (bars) |
|---|---:|---:|---:|---|
| Assault Rifle | 32 | 12 | 1.4 | mid dmg, high RPM, mid range |
| Burst Rifle | 36 | 6 | 1.7 | mid-high dmg, high range |
| Sniper Rifle | 4 | 6 | 1.7 | high dmg, low RPM, max range |
| Shotgun | 6 | 4 | 0.4 | high dmg, low RPM, short range |
| SMG | 72 | 4 | 2.5 | low dmg, very high RPM, short-mid |
| AMR | 14 | 4 | 1.4 | high dmg, high range |
| Energy Launcher | 1 | 6 | 1.4 | very high dmg, mid range |
| Rail Gun | 1 | 6 | 2.4 | very high dmg, high range |
| Rocket Launcher | 2 | 4 | 1.2 | very high dmg |
| Laser Cannon | 4 | 2 | 2 | very high dmg, high range |
| Charge Rifle | 100 | 2 | 2.5 | high dmg |
| Bolt Rifle | 18 | 10 | 2 | mid dmg |
| Plasma Sniper | 10 | 8 | 2 | high dmg |
| Force Rifle | 36 | 4 | 1.7 | mid dmg |
| Stinger | 18 | 4 | 1.7 | high dmg |
| Energy Rifle | 300 | 2 | 2.4 | low-mid dmg (huge clip) |
| Suppressor | 48 | 6 | 2 | high dmg |
| Ion Sniper | 2 | 6 | 2 | high dmg, high range |

→ **Cross-check against `protocol/callsign-extract/` WEAP tokens + our `gameconfig.WEAPON_AMMO`** — these
are real per-weapon ammo/reload values to validate or seed the weapon table.

## GAME SETTINGS (per-mode config — what MC must expose)

Two columns; PRIMARY WEAPON (left) / SECONDARY WEAPON (right, removable via an **X**).

| Field | Type | Values seen |
|---|---|---|
| Primary Weapon | picker | from the roster above |
| Secondary Weapon | picker (removable) | from the roster; X to drop it |
| **Weapon respawn** | dropdown | 30 sec · 60 sec · 90 sec · 3 min |
| **Weapon pick-up** | dropdown | **Scan · Player · Both** |
| **Weapon selection** | toggle | ON / OFF |
| **Outdoor mode** | toggle | ON / OFF (matches `$GSET` outdoor) |
| **Voice** | dropdown | **Male · Female** ← confirms the app's voice pick is just 2 (FOLLOWUPS **B14**) |
| **Time** | number | e.g. 1 (minutes) |
| **Score to Win** | number | e.g. 25 |
| **Respawn Type** | dropdown | **Scanner · Auto** |
| **Respawn time** | number | e.g. 15 (seconds) |
| **Lives** | number + checkbox | a count, or **Unlimited** ✓ |
| Buttons | — | BACK / **CREATE** |

## CREATE GAME (extra step for some modes — e.g. Battle Royale / no-team)
| Field | Values |
|---|---|
| **Allow Teams** | Allow Teams · No Teams |
| **Starting Health** | Low · Medium · Full |
| **Players Remaining** | Show · Hide |

## App settings (gear icon, global)
**One control: a SOUND slider + CLOSE.** That's the entire global settings screen — trivial.

## UX notes (what we do better in Mission Control)
- **Category picker is a 1-at-a-time carousel** — slow to browse ~5+ categories. MC: show the whole
  grid at once, searchable/filterable.
- **Voice = Male/Female only** — we can offer the full character voice-pack set (B14/P3) once the
  per-character id map is extracted.
- **Two competing "settings" surfaces** (per-game GAME SETTINGS vs a 1-slider global) — cramped and
  confusing. MC: one coherent game-authoring panel (this doc's fields) + a real fleet/readiness board.
- **Respawn Type "Scanner"** (respawn at a scanner/station) vs **"Auto"** (timed) — maps to our
  host-respawn vs station-respawn split (FOLLOWUPS B12).
- **Weapon pick-up Scan/Player/Both** and **Weapon respawn** are the app's take on mid-game weapon
  pickups (our Utility-Box / QR weapon-spawn territory, B4).
