# Handoff: BRX Phone HUD (v2 — landscape, rail-mounted)

## Overview
Per-player companion app for Open BRX laser tag. One phone, one gun, one player. The phone rides a picatinny-rail mount on the tagger **in landscape**. It covers a short setup flow (connect gun → lobby → armed countdown) and the in-game FPS-style HUD with full-screen "moment" takeovers (kill confirm, down/respawn, T-minus). A separate blackout night mode exists for night games.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to ship. Recreate these screens in the target codebase's environment (e.g. React Native, Flutter, native, or a web view) using its established patterns. `Phone HUD v2.dc.html` is a gallery of static screen states; the MOTION captions under the moment screens describe the intended animations.

## Fidelity
**High-fidelity.** Colors, type, spacing, and copy are final intent. Recreate pixel-perfectly, respecting the safe-area rule below. Animations are specified as notes (durations/easing below), not implemented.

## Global rules
- **Orientation:** landscape, designed at 844×390 (iPhone-class). Scale proportionally.
- **Safe area:** nothing load-bearing closer than ~26px (top) / ~32-36px (sides & bottom) to screen edges — bezels and cases eat the edge. Decorative full-bleed elements (hazard stripes, edge glows, vignettes) are exempt.
- **No scrolling during play.** Every in-game state fits one screen.
- **Team colors are fixed and meaningful** (never decorative): Blue `#3a86ff`, Yellow `#ffd23f`, Red `#ff5252`, Green `#2ecc71`. The player's team tints edge glows and plates via a `--team` variable.
- **Data ownership:** HP, armor, ammo, deaths, respawn timer are live on the phone. Kills / assists / accuracy are Mission-Control-computed — show `—` until MC syncs, then the value with a small `✓MC` tick. This is an intentional state, not an error.
- **Health/shield have no text labels.** Green = health, blue (holo) = shield/armor. Bare numbers next to color-coded bars.

## Design Tokens (holo theme, baked in)
Ground: bg gradients from `#0b1220 → #05080d → #02040a` (radial vignette); plates `rgba(12,28,44,.85)`; plate insets `rgba(4,12,20,.9)`; borders `#2a4e6e`.
Ink: numerals `#eef9ff`; muted `#7fa0b8`; glow accent `#5fd6ff`.
Semantic: health `#39e07c`, shield `#7fd4ff`, warn `#ffb020`, bad `#ff5252`, ok `#39e07c`.
Night mode overrides (blackout): bg `#000`, ink `#b23b3b`, muted `#5a1f1f`, health `#7a3a3a`, shield `#7a5a1f`, **no white, no glow, no plates**.

Type:
- Display/numerals: **Saira Condensed** 600/700, italic for hero numerals and moment titles. Always `font-variant-numeric: tabular-nums`.
- UI/labels: **Chakra Petch** 500-700, letterspaced uppercase (`.14em-.4em`).
- Gun IDs: monospace, format `GUN-A-3D4F` (name + accent-colored MAC tail).

Signature geometry: plates and chips are skewed `skewX(-6° to -18°)` with inner content counter-skewed; bars are skewed parallelograms with segmented fills (`repeating-linear-gradient`, 22px segment / 4px gap for health, 34/4 for shield); ammo pips are 5×16px skewed bars. Glow via `text-shadow: 0 0 18-70px` of the accent.

## Screens / Views

### 1. IDLE — Set my gun
Left half: BRX wordmark + "COMBAT HUD", accent-cyan skewed button **SET MY GUN ▸** (260×60). Right half (54% width): dark panel, "SCANNING FOR TAGGERS" with blinking dot, live list of nearby taggers — each row: mono name+tail, RSSI bars + dBm; already-claimed guns show `IN USE` (warn) at 55% opacity. Footer helper: "Tagger not listed? Power-cycle it — it'll appear within a couple seconds." Tapping a row connects.

### 2. LOBBY — kitted, ready-up
Top-left: callsign `REAPER` (44px italic), team chip `BLUE SQUAD` + gun id. Loadout plates: weapon (`ASSAULT RIFLE`, `MAG 36 · RESERVE 216`) and `45 · 70` (health green / shield blue) `TDM LOADOUT`. Bottom: full-width green **READY ✓** button (96px tall, skewed, green glow) + note "Waiting for the host to arm the match. Tap again to un-ready."

### 3. T-MINUS (ARMED)
Full-screen. Hazard-stripe bands top/bottom (26px, warn/black 45° stripes — full-bleed OK). Center: `T-MINUS` (warn, letterspaced) + giant countdown numeral (230px italic, cyan glow) + team chip `BLUE · REAPER` and `TDM · 15:00`.
MOTION: stripes slide in 250ms → numeral punch-scales 1.15→1.0 each tick → 80ms white-out at zero.

### 4. HUD — ALIVE (the core screen)
- Top-center: skewed plate, match clock `12:42` (30px) + mode tag `TDM`.
- Top-left: team-color arrow glyph + callsign + `BLUE SQUAD`.
- Top-right: link dot (green, glowing), gun battery outline + `82%`, bordered `◉ CAM` chip (see screen 5).
- Under top-right: stat row `K 4 ✓MC · D 3 · A — · ACC —`.
- Center: 6px reticle dot at 55% opacity.
- Bottom-left (300px wide): HP numeral 84px italic green-glow + shield number 24px in shield blue; below, segmented health bar (14px tall, skewed −18°) and shield bar (9px, 78% width).
- Bottom-right: ammo `36` (84px italic, cyan glow) `/216` (26px muted); row of 12 ammo pips (spent pips 25% opacity); label `ASSAULT RIFLE`.
- Ambient: team edge glow (inset shadow) + 5px vertical team gradient strips at left/right edges (decorative, full-bleed).

### 5. HUD — LOOK-THROUGH (camera passthrough)
Same layout as ALIVE over the live rear-camera feed. Plates become `rgba(4,8,14,.6)`; all ink gets heavy dark text-shadows; top/bottom scrim gradients (~55% black) for legibility. `◉ CAM ON` chip filled accent-cyan. Toggle is optional, off by default (battery cost). The prototype uses a drop-an-image slot to simulate the feed.

### 6. HUD — TAKING FIRE / critical
Red-tinted vignette pulsing at 1s; HP numeral red, blinking, bar at 20% with red border; shield 0/empty. Center: blinking `TAKING FIRE` (red, letterspaced — no directional info, the hardware can't know). Bottom-right: blinking warn `RELOAD ▸▸` chip, ammo `02` in warn, pips nearly spent.

### 7. KILL CONFIRMED — full-screen takeover (the feel-great moment)
Full takeover, victory-screen energy. Radial deep-blue burst bg; slow-spinning ray wheel (repeating-conic-gradient of accent at ~13%, masked radial fade, 30s linear); two shock rings (340px pulsing, 540px static). Center stack: gold `+1 ELIMINATION` chip → `KILL` 148px italic with huge cyan glow → `CONFIRMED` 34px letterspaced cyan → three skewed accent bars (gold/cyan/cyan-50%). Bottom: `YELLOW OPERATIVE DOWN` chip in the killer-team color + `K 5 · CONFIRMED BY MISSION CONTROL`.
MOTION: 60ms white-out → rays burst outward + slow spin → "KILL" slams 1.8→1.0 scale with 2-frame shake → shock ring expands → gold shimmer sweeps type → holds 1.2s → whole comp collapses into the K counter top-right.
Trigger: MC kill attribution sync (this moment may arrive seconds after the hit).

### 8. DOWN
Red-black radial bg, heavy red inset wash; the ALIVE HUD ghosts behind at 15% opacity, grayscale. Center: `DOWN` 64px italic red-glow + `KILLED BY [YELLOW]` team chip; right: respawn countdown 190px italic + `REDEPLOY IN`.
MOTION: impact frame 60ms white flash → red wash floods 300ms → countdown ticks with heartbeat pulse.

### 9. REDEPLOY
Team-color diagonal wipe covers left ~55% (skewed −14°, white 3% divider slash). On the wipe: `REAPER` / `BLUE SQUAD` in team-ink. Right: `REDEPLOYED` 64px italic glow, `WEAPONS HOT ▸▸▸` (green), `45 · 70 · MAG FULL`.
MOTION: wipe sweeps L→R 280ms → text tracks in → wipe exits right, HUD elements fly to corners.

### 10. NIGHT / BLACKOUT
A distinct mode, not a filter: pure black bg, dim-red ink only, **no white, no glow, no plates, no flashes**. Timer top-center (muted), HP 76px + thin 5px bars bottom-left, ammo 76px bottom-right, `D 3 · K —` micro-row, `NIGHT OPS` label. Auto-on via the game's night flag + manual toggle. Phone must not act as a flashlight.

## Interactions & Behavior
- Lifecycle: IDLE → (scan/pick) CONNECTED → KITTED → LOBBY (ready toggle) → ARMED (T-minus) → ALIVE ⇄ DOWN → match end. Link loss in any state: small non-alarming "reconnecting" chip; HUD keeps running on last-known values.
- Low ammo: numeral turns warn + RELOAD chip blinking (≤ ~15% mag). Empty: `00`, chip solid.
- Low gun battery: warn line in top-right (`GUN BATT 12% — CHARGE SOON`).
- Blink cadences: reload chip .7s, taking-fire .5s, critical HP 1s; damage vignette pulse 1s.
- All countdowns tick with tabular numerals (no layout shift).

## State Management
Live local: hp, armor, magAmmo, reserveAmmo, deaths, respawnCountdown, gunBattery, linkState, matchClock.
MC-synced (nullable until sync): kills, assists, accuracy — render `—` when null, value + `✓MC` when present.
Config: team, callsign, gunId, mode, nightFlag, camPassthrough (bool, default off).

## Assets
No raster assets. Fonts from Google Fonts: Saira Condensed, Chakra Petch. All graphics are CSS (gradients, skews, clip paths). The camera-feed image slot in the prototype is a stand-in for the live camera.

## Files
- `Phone HUD v2.dc.html` — the full screen gallery (open in a browser; sections: HUD states, full-screen moments, blackout, setup).
- `image-slot.js` — helper the prototype uses for the camera-feed placeholder (not for production).
- `tokens.css` — original shared BRX token seed (upstream reference; holo values above supersede where they differ).
