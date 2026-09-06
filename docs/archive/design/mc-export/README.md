# Handoff: BRX Mission Control — Operator Console (Phases A1–A8)

## Overview
Mission Control is the operator console for Open BRX laser-tag events: a MacBook web app (tablet-friendly) the host uses to check gear, author a game, kit players out, form teams, arm a dispersed countdown, watch a live scoreboard, and run the recap. This handoff covers all six console phases: **Armory readiness (A1), Build (A2), Kit-out (A3, with A4 try-out cues), Lobby (A5) + dispersed start (A6), Live scoreboard (A7), Recap (A8)** — one persistent frame, six screens.

## About the Design Files
`Mission Control.dc.html` is a **design reference created in HTML** — a prototype showing intended look and behavior, not production code. Recreate it in the target codebase's environment (React/Vue/etc.) using its established patterns; if no frontend exists yet, pick the framework that fits the product (the prototype's state model maps 1:1 onto a React component). The `reference/` folder contains the product briefs and token seed the design was built from — they are authoritative for flows and constraints.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy, and states are final intent. Recreate pixel-close. All styles in the prototype are inline on the elements, so every value can be read directly off the markup.

## Design language ("military armory" system)
- **No border radius anywhere.** Square corners; key panels get a chamfered corner via `clip-path` (12–14px 45° cut, usually top-right or bottom-right).
- **Corner brackets** on hero panels: 16–18px L-shaped 2px borders in the accent color, absolutely positioned top-left + bottom-right (::before/::after).
- **Segmented bars**: every meter (battery, weapon stats, progress) is a filled bar with a repeating-linear-gradient overlay (`transparent 0 7–14px, #07090d +2px`) that slices it into cells.
- **Striped placeholders**: `repeating-linear-gradient(45deg, #141c26 0 8px, #0c1016 8px 16px)` marks every image slot (weapon art, mode art) with a monospace caption. Replace with real art.
- **Hazard stripe**: PANIC/ABORT buttons carry a left cell of `repeating-linear-gradient(135deg, #ff5252 0 5px, #0c0507 5px 10px)`.
- **Type hierarchy**: Oswald for all numbers and big titles (always `font-variant-numeric: tabular-nums` on changing numbers); Chakra Petch for labels/UI text with heavy letterspacing (.1–.34em, uppercase); `ui-monospace` for micro-telemetry labels (9–11px, .12–.3em tracking).
- **Screen headers**: monospace accent kicker `[ A1 // GEAR CHECK ]` above a 30px Oswald title; section rules are a label + 1px `#1c2733` line that flexes to fill.
- Subtle blueprint grid on the page background: two 1px `rgba(57,180,255,.028)` line gradients at 36px.

## Design Tokens
Ground: page `#07090d`, panel `#0c1016`, panel-alt/header strips `#090d12`, inset `#05070a`, hairline `#1c2733` (rows `#131c26`).
Ink: primary `#e8eef5`, body `#c7d3de`, secondary `#8aa0b4`, dim/micro `#5c7186`, faint `#3a4a5c`.
Accent (brand, not state): `#39b4ff`, hover `#7fd0ff`, ink-on-accent `#04121e`.
Semantic: ok `#2ecc71`, warn `#ffb020`, bad `#ff5252`.
Teams (FIXED, meaningful — never decorative): Blue `#3a86ff`, Yellow `#ffd23f`, Red `#ff5252`, Green `#2ecc71`, FFA/no-team = white `#e8eef5`.
Class colors (weapon archetypes): AR `#39b4ff`, SMG `#7fd0ff`, SNIPER `#ffd23f`, SHOTGUN `#ff8c42`, HEAVY `#ff5252`, LMG `#2ecc71`.
Fonts (Google): Oswald 500–700, Chakra Petch 500–700.
`reference/tokens.css` is the shared seed (also used by the Phone HUD) — keep role names when building real tokens.

## Persistent frame (all screens)
- **Command bar** (`#05070a`, 1px bottom hairline): brand block (accent chamfered "B" mark 26px, "OPEN BRX" 11px/.34em accent, "MISSION CONTROL" 18px Oswald); phase stepper; PANIC button (hazard stripe + red border).
- **Phase stepper**: six steps, each a two-line button — mono step number (`01`…`06`, 9px) over the label (12px/.22em Chakra Petch 700). Active: `#0c1420` bg + 2px accent bottom border + accent number. Inactive: `#8aa0b4`. All phases navigable.
- **Telemetry strip** (`#090d12`, mono 10px/.16em): `NET ▸ BRX-FIELD · 8 NODES LINKED` / `PHASE ▸ 0n/06 NAME` / `UPLINK ▸ OK · SYNC 0.4s` / right-aligned session timestamp. Wire to real LAN status.
- Content area: `padding: 22px 24px 48px`, scrolls.
- Screen mount animation: fade + 6px rise, .25s ease-out.

## Screens

### A1 · ARMORY — Readiness board
- Header right: three count blocks (GREEN/AMBER/RED, 24px Oswald over 9px label) + the **gate chip**: chamfered solid block, `GO` on ok-green or `HOLD` on red, with a mono reason line under it ("GUN-D BLOCKS START — POWER IT ON" / "NO REDS — START WHEN READY"). **Gate rule: no reds — ambers do NOT block.**
- Gear grid: `repeat(auto-fill, minmax(248px, 1fr))`, gap 12. Card: panel bg, hairline border, **3px left border in status color**, chamfered top-right. Contents: sticker name (20px Oswald) + `-TAIL` (mono dim); status tag (solid status-color bg, dark ink): READY / CHECK / BLOCKED; label/value grid (82px label column, mono labels): POWER, HEADSET, BATTERY (% + segmented cell bar, color by level: <30 bad, <60 warn, else ok; unread = "—" dim), LINK (last-seen age; stale = warn), COMPANION ("—" future slot).
- Red/amber cards append a reason strip: `▲ NOT POWERED — BLOCKS START` (2px left border + 10% tint bg).
- Demo data: 8 guns — GUN-A-3D4F, GUN-B-91C2, GUN-C-7A10, GUN-D-22E8 (red, off), GUN-E-5D77, GUN-F-A0B3 (amber, battery unread), GUN-G-4F19, GUN-H-C3E5 (amber, 52s stale link).

### A2 · BUILD — Game authoring
- Left: mode grid `repeat(auto-fit, minmax(190px, 1fr))`. Card: 76px striped **mode art slot** (abbr tag top-left, ACTIVE tag when selected), name (15px Oswald) + one-liner. Selected: accent border + 2px top bar + 6% accent tint.
- **Mode briefing panel** under the grid (updates with selection): 3px accent left border, mono kicker `MODE BRIEFING // <NAME>`, 13px body paragraph, plus three stat cells: TEAMS / WIN CONDITION / RESPAWN. Copy for all five modes is in the prototype's `MODES` array — use verbatim.
- Right: GLOBAL SETTINGS panel (chamfered, header strip with accent tick): ENVIRONMENT Indoor/Outdoor segmented; NIGHT OPS toggle (square, drives the phone HUD blackout flag); RESPAWN TYPE Scanner/Auto; RESPAWN DELAY 15 S; TIME LIMIT 10 MIN; SCORE TO WIN 25; collapsed `LED & ENVIRONMENT EXTRAS ▸` disclosure. Value boxes: inset bg, Oswald 17px numbers, unit in dim Chakra.

### A3 · KIT-OUT (centerpiece) + A4 try-out
- Header right: `3/8 KITTED` + segmented progress bar (accent fill).
- **Squad roster** (left, 250–330px): header strip "SQUAD ROSTER"; rows = 4px team-color bar, name (14px/.14em), gun id (mono dim), status word (KITTED ok / FITTING accent / — dim). Selected row: accent border + 6% tint. Click selects the operator.
- **A4 try-out state**: a roster row can carry a pulsing amber tag `TRYING SMG` (box-shadow pulse, 1.6s loop). Non-modal — changing a weapon silently arms that player's gun for a few test shots; show the tag while active, clear on exit. Never a dialog.
- **Operator card**: 6px team-color bar + OPERATOR kicker + name (32px Oswald); TEAM chip row (BLUE/YELLOW/RED/GREEN/FFA — selected chip fills with team color + dark ink, others outline in `#1c2733` with team-color text; FFA is white = no team); VOICE Male/Female segmented; right: live node link chip (blinking green dot + `GUN-B-91C2 · LINKED 1s` mono). Team/voice changes write to the player config.
- **Weapon hero panel** (corner brackets): striped art slot (`VISUAL // PENDING` corner label) + name (30px Oswald uppercase) + class tag (solid class-color) + three segmented stat bars (DAMAGE / FIRE RATE / RANGE, white fill, 80px label column) + three number cells (MAGAZINE / RESERVE / RELOAD s, 24px Oswald).
- **Arsenal gallery**: section rule `ARSENAL // 18 WEAPONS` + right hint `SELECT TO ARM`. Tile grid `minmax(152px, 1fr)`: striped thumb (class tag corner), name + clip number. Selected: accent border + 8% tint. (An alternate compact list layout exists in the prototype behind the `weaponGallery` tweak.)
- Weapon data: all 18 weapons with clip/mags/reload are real values from `reference/weapon-roster.md`; damage/fire-rate/range bar fills are qualitative (0–100) — see the `W` array. `reserve = clip × mags`.

### A5 · LOBBY — Team assignment + ready-up
- Header right: balance chip (`4 V 4 — BALANCED`, ok-green solid) + `6/8 READY` + segmented ok-green progress.
- Two team columns (Blue/Yellow shown; support up to four): header strip with 2px team-color top border, team name in team color, operator count; member rows with `⠿` drag handle, name, gun id, READY (ok outline) / WAIT (dim) tag. **Drag between columns re-teams the player** (prototype shows the affordance only).
- **Action rail** (bottom): numbered steps `1 ALL READY 6/8 → 2 PUSH CONFIG → 3 ARM COUNTDOWN` (completed step = green number block), amber warning `▲ SABLE + DRIFT NOT READY — LAST MOMENT ALL NODES ARE IN RANGE`, and the primary chamfered accent button **PUSH CONFIG & ARM ▸**. This is the confident "all ready → push → start" moment; disable the push until gate conditions are met in production.

### A6 · DISPERSED START — Match arming (reached from A5 push)
- Header actions: `◂ BACK TO LOBBY`, RESCHEDULE (amber outline), ABORT (hazard stripe, red).
- Hero panel (corner brackets): `SYNCED GO-LIVE IN` + **T-02:41** (56px Oswald); countdown presets 01:00 / 03:00 / 05:00 segmented; status copy `7/8 NODES ARMED · 1 AWAITING ACK` + mono explainer "GUNS COUNT DOWN ON THEIR OWN — PLAYERS MAY SCATTER OUT OF RANGE. ALL GO LIVE AT T-0."
- Node grid `minmax(200px, 1fr)`: gun name + ARMED (ok) / NO ACK (warn) tag, player, per-node T-minus (22px Oswald; `——:——` when no ack), mono substate (`COUNTING · AUTONOMOUS` / `RETRYING · LAST SEEN 40s`).
- Semantics: MC hands each node a synced go-live time; nodes count down autonomously. The board tracks acks, never pretends a silent node is gone.

### A7 · LIVE — Halo-style scoreboard
- **Score strip**: three cells — Blue block (4px team border-left, 16% team tint gradient, team name .3em + 64px Oswald score), center time cell (`TIME REMAINING` mono, 40px `04:12`, `TDM · CAP 25`), Yellow block mirrored.
- **Player table** (sorted by kills): columns OPERATOR / K / D / A / K/D / ACC / STK / STATUS / SYNC. Rows: 3px team-color left border; K bold 16px Oswald, others 14–15px; K/D one decimal; streak ≥3 in warn. STATUS: `ALIVE` ok / `RESPAWN 0:07` bad (row gets 5% red tint) / `LAST KNOWN` warn for out-of-range. SYNC: mono age — fresh (1–5s) faint, 40s warn, `1m12s AGO` warn. Min-width 640px with horizontal scroll on tablet.
- Footnote (verbatim): `K / A / ACC ARE MC-DERIVED — RECONCILED AT SYNC POINTS. OUT-OF-RANGE NODES SHOW LAST KNOWN + AGE, NEVER "GONE".` **This honesty rule is a hard product constraint.**
- **Event feed** (right, 280–400px): header with blinking red dot `EVENT FEED // LIVE`; entries = mono timestamp + text + optional solid tag (DOUBLE KILL warn, STREAK ×5 warn, FIRST BLOOD bad, sync-point entries accent left border).

### A8 · RECAP
- **Winner banner** (yellow corner brackets, yellow tint gradient): `[ A8 // MATCH COMPLETE · TDM · 10:00 ]` kicker; `YELLOW WINS` 46px with "YELLOW" as a solid team-color block; score `25 — 21` in team colors; right: **⬇ EXPORT CSV** (accent, chamfered) + NEW MATCH (ghost).
- **HONORS** grid `minmax(168px, 1fr)`: 7 award cards (2px top border in award color, chamfered bottom-right): mono award name, player 19px Oswald, mono stat line. Awards: MVP (yellow), MOST KILLS, BEST K/D · NON-MVP, SHARPSHOOTER, SURVIVOR, FIRST BLOOD (red), MULTIKILL (amber).
- **FULL STATS** table: same row anatomy as A7 minus STATUS/SYNC, plus a MEDALS column (mono, yellow, `·`-separated; `—` when none). MVP row gets a 5% yellow tint. Export must produce the full table.

## Interactions & State
Prototype state (maps to component/store state): `phase` (6 values), `selPlayer`, `selWeapon`, `selMode`, `teams` (per-player override map), `armed` (A5→A6 substate). Implemented interactions: phase nav, player select, weapon select (= silently arms that gun → show A4 trying state), mode select (updates briefing), team chip assignment, PUSH CONFIG & ARM → armed board, BACK TO LOBBY. Shown-but-static (build these): lobby drag-to-reteam, ready-up ingestion, countdown ticking, live table/feed updates, CSV export, panic (must have a confirm step, then fleet-wide safe over the LAN).

## Responsive
Desktop-first; every screen must work on a tablet held in one hand. The prototype does this with wrap-friendly flex (`flex: N 1 <basis>`) and `auto-fill/auto-fit` grids — no media queries. Tables scroll horizontally below 640px content width. Keep hit targets ≥44px on touch.

## Hard constraints (from reference/foundation.md — do not design around)
1. Kills/assists/accuracy are MC-computed, reconciled at sync points — always show staleness.
2. MC has no live BLE link to guns during play; the LAN is intermittent.
3. Team colors are fixed and meaningful; semantic ok/warn/bad is separate from the accent.
4. Amber (unknown) never blocks the A1 gate; only red does.
5. Real weapon names/values only — from `reference/weapon-roster.md`.

## Assets
None bundled. Every striped placeholder (18 weapon art slots, 5 mode art slots) needs real art. Fonts load from Google Fonts (Oswald, Chakra Petch) — self-host in production.

## Files
- `Mission Control.dc.html` — the full six-phase prototype (template markup + a `Component` logic class holding all demo data arrays: GUNS, MODES, W (weapons), PLAYERS, LIVE, RECAP, medals, feed).
- `reference/BRIEF-mission-control.md` — original screen-by-screen product brief (A1–A8).
- `reference/foundation.md` — shared brand/tone/constraints (both UIs).
- `reference/tokens.css` — shared token seed (includes outdoor + blackout modes for the phone HUD).
- `reference/weapon-roster.md` — real weapon/settings data distilled from the Callsign app (functional baseline, not a UX target).
