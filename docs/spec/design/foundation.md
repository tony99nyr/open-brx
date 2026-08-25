# BRX Design — Shared Foundation (read first for BOTH UIs)

This applies to both Open BRX interfaces (Mission Control and the Phone HUD). Read it alongside the
UI-specific brief in this package. Pair with `tokens.css` for the concrete palette/type.

**Logic vs visuals.** This package is a *visual/UX* brief. Screens, states, content, and art direction
are yours to iterate. Flows, fields, and capabilities are fixed by the product spec — don't invent them.
If a screen seems to need a control the brief doesn't mention, **ask**, don't fill it in.

## 1. The product in one line
Stock BRX laser taggers, run as a hosted event: a **MacBook Mission Control** kits players out and runs
the match over a local field Wi-Fi; each player carries a **phone** showing a **video-game HUD** for
their one gun. Tactical, competitive, club/rental-grade — a real arena ops console + an FPS HUD, not a toy.

## 2. Brand & tone
- Tactical, precise, energetic, confident. High-contrast and legible over pretty. Never cartoonish.
- Palette, type, and components: see `tokens.css`. Numbers are the hero on both UIs — big, tabular.
- **Team colors are fixed and meaningful** (Blue `#3a86ff`, Yellow `#ffd23f`, +Red/Green for 3-4 teams) —
  never repurpose them as decoration. Semantic color (ok/warn/bad) is separate from the brand accent.

## 3. Three states to design (two are environmental)
| Context | Where | Requirement |
|---|---|---|
| **Everyday / staging** | indoor prep, dim lobby | the default dark look, comfortable density |
| **Bright outdoor** | midday sun, glare | **max contrast**, oversized type, thick bars, no thin/low-contrast grays for anything load-bearing — readable at arm's length in sun |
| **Full blackout (night)** | night games | **near-total darkness, no light leak** — dim red/amber, NO white, no bright flashes; the phone must not act like a flashlight or reveal a player's position. A distinct mode, not a dimmed copy. |
Blackout is a **hard mode of the phone HUD** (auto by the game's `night` flag + manual toggle). Mission
Control has a dark theme but doesn't need true blackout (it sits at the base).

## 7. Real content to populate mockups (never lorem)
- **Teams:** Blue `#3a86ff`, Yellow `#ffd23f` (+Red/Green). Example handles a host would type:
  `REAPER`, `VIPER`, `NOMAD`, `GHOST`, `HAVOC`, `SABLE`.
- **Gun (armory) names:** sticker-style ids like `R0BAT`, `R0BQT`, `R0BAS`, `R0BP1`, shown as
  `<NAME>-<tail>` (e.g. `R0BAT-3D4F`).
- **Health/ammo defaults (TDM):** HP `45`, armor `70`, ammo `36 / 216`.
- **Modes:** Team Deathmatch, Free-for-All, Infection, Last-Man-Standing, Extraction.
- **Weapons:** the ~18-weapon roster + real stats are in `weapon-roster.md` (MC package). Per weapon show
  **damage, magazine, reserve, fire-rate, reload time, range, class**. Archetypes: assault rifle, SMG,
  sniper, shotgun, pistol, LMG. **Use the real names/numbers from that file.**
- **Voices:** Male, Female.
- **Settings enums:** weapon-respawn 30 / 60 / 90 s / 3 min; pickup Scan / Player / Both; respawn type
  Scanner / Auto.
- **Scoreboard columns:** Player · Team · K · D · A · K/D · Acc% · Streak · Medals.
- **Recap medals:** MVP, Most Kills, Best K/D, Sharpshooter, Survivor, First Blood, Multikill.
- Timers/counts are tabular numerals; K/D and Acc% one decimal (`2.3`, `41%`).

## 8. Hard constraints (design *with* these, not around them)
1. **Kills / assists / accuracy are Mission-Control-computed** and reconcile only at sync points while
   players are dispersed. The phone shows **"— MC"** until told — make that state look intentional.
2. **Deaths, HP, armor, ammo, respawn** ARE known live on the phone — those update in real time.
3. **Blackout night mode** is a real requirement, not a nice-to-have.
4. **Outdoor sun legibility** governs the default HUD — if it's not readable in glare, it's wrong.
5. **MC is not BLE-connected to guns during play** — its live board is fed by nodes over an intermittent
   LAN; the scoreboard shows **staleness**, never fabricates live individual truth.
6. Team colors are fixed and meaningful.
