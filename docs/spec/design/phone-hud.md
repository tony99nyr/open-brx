# BRX Design — Phone HUD (the per-player node)

**Package for:** the player's phone. Shared brand/constraints: the header of `mission-control.md`.
**The shipping HUD is the source of truth** (`app/www/index.html` + `app/src/hud/`, 844×390 landscape; iterate
with `cd app && npm run ui:stage`, prove with `npm run ui:screens`). The 2026-08-25 Claude Design export it was
built from (Phone HUD v2: landscape, rail-mounted, ten screen states) is archived at
`docs/archive/design/hud-export/` for re-seeding the design tool; per Tony (2026-08-26) the exports were
inspiration, not definitive.

One phone, one gun, one player. Two jobs: a few **setup screens** (before the match) and the **in-game
HUD** (during). The HUD is the star: a **first-person-shooter heads-up display** — instantly readable at
a glance, in sun or dark, while the player is moving and getting shot at.

**Landscape (844×390), rail-mounted on the gun/forearm. Minimal chrome. Big numbers. No scrolling during play.**

### B0 · Lifecycle → what the screen shows
| State | Screen |
|---|---|
| **IDLE** | "Set my gun" connect screen (B1) |
| **CONNECTED** | gun named; "waiting for kit-out from Mission Control" |
| **KITTED** | your loadout (weapon, team, name, **#number** 1–63) + the big **READY-UP** toggle (ready-up is a KITTED action). *2026-08-27:* the loadout plates are **two tappable slots** (PRIMARY / SECONDARY) that open the **LOADOUT browser** (B6) when the host's rules allow; locked slots show a padlock + "Set by the host" |
| **LOBBY** | "armed-pending": gun configured, waiting for the host's start — team + name + number, no controls |
| **ARMED** | full-screen **countdown** (T-minus); the gun is also beeping |
| **LIVE / ALIVE** | the **HUD** (B2) |
| **LIVE / DOWN** | **death/respawn** overlay (B3) |
| **match over** | brief "MATCH OVER", then back to **KITTED** (gun + player kept) — never "Set my gun" |
| any + Wi-Fi/MC lost | small, non-alarming "reconnecting" chip; the HUD keeps running (normal for most of a park match) |
| any + gun link lost | red "GUN LINK LOST" strip; values freeze |
| gun relinked (LIVE) | the **RECONCILING takeover**: GUN RELINKED · SYNCING WITH YOUR GUN · WEAPON DISARMED FOR A MOMENT (3 s fill); real pools kept, never a heal, no trigger pull asked (S7.1, 2026-09-04; node.md §3.10) |
| gun relinked (LOBBY/ARMED) | amber **"GUN RELINKED"** prompt while the head is re-written (~10 s) |
| any + preflight fail | small red preflight chip (Wi-Fi / MC / phone battery / screen / gun / headset) → diagnostics |

### B1 · Set my gun (connect)
- A **"Set my gun"** button opens a **scanning sheet**: live list of nearby taggers, each with its
  **name** + **MAC-tail** + signal (so the player picks the right gun). Tap to connect. Reassure:
  "power-cycle a gun if it doesn't appear."
- Then a clear "connected — waiting for the host" state. **No team self-select** — team, name, number come from Mission Control.

### B2 · The in-game HUD (ALIVE) — the hero screen
A clean FPS HUD. Suggested zones (iterate freely, keep the hierarchy):
- **Health + armor** — biggest, most glanceable. HP and armor distinct (armor absorbs first); bar +
  number. **Max HP 45, armor 70** (values vary by mode — read live, don't hardcode).
- **Ammo** — large, bottom-corner FPS-style **mag / reserve** (`36 / 216`), clear low/empty + reload cue.
- **Match time remaining** — top, secondary.
- **Personal stats cluster** — K / D / A / accuracy. **Deaths is the only one the phone knows locally**;
  **kills / assists / accuracy show "— MC"** (a small "synced" tick when MC supplies them). Make "— MC"
  look intentional.
- **Team + identity** — team color as an ambient edge tint; name small; **player number** `#7` (1–63).
- **Battery** — small gun-battery indicator + a **low-battery** warning state.
- **"Killed by …"** — brief callout on death naming the **killer**: "☠ by REAPER · YELLOW" (the phone knows exactly who shot it).
Reads in **direct sun** (`data-env="outdoor"`) and **blackout** (`data-env="night"`) with no redesign —
just re-themed via tokens. Motion minimal (glare + battery); the hit/damage flash and death are the main
animated moments.

### B3 · Death & respawn (DOWN)
- Clear **DOWN** state — desaturate/dim the HUD, big central **respawn countdown**, "☠ by <NAME> · <TEAM>".
- On respawn: a crisp **"RESPAWNED"** moment, HUD back to full ALIVE. (The gun re-arms itself; the screen
  reflects it.)

### B4 · Blackout / night mode
A **distinct visual mode** (auto when the game's `night` flag is set; also a manual toggle). Near-black,
essential readouts only, **dim red/amber low-luminance, no white**, no bright flashes, reduced brightness.
Read HP/ammo/respawn without the phone becoming a flashlight. Its own screen (see `tokens.css`
`[data-env="night"]`), not a filter over B2.

### B5 · Diagnostics / info (optional button)
Behind a small **info button**: raw BLE link state, last frames, battery, timings, node/gun ids — a
field-debug panel + a **"save / share log"** action (the host can pull it). Utilitarian, dense, monospace
is fine; it's for fixing problems, not for play.

### B6 · Loadout browser (self-serve kitting; loadout.md §4.5) — *added 2026-08-27*
The one exception to "no self-select on the phone": when the host's rules allow, a player picks their own
weapons/perk. Tab bar `PRIMARY | SECONDARY | PERK` (A14, 2026-09-04: the perk is its own slot); the **list on the
left** (rows ≥44 px: thumb, name, class, MAG; the secondary tab carries `WEAPONS · NONE` chips, the perk tab `PERKS ·
NONE`; Easy Reload over a loaded secondary is a two-tap confirm), **art + stats on the right**, a persistent bottom bar
`TRY IT` (weapons only — MC arms the gun for a few rounds) + `DONE`. **Tap a row = equipped** (MC confirms;
a rejected pick shows the host's reason in plain words). Only what the rules allow is listed — a player never
sees a greyed-out weapon they can't have. Must read at 844×390 and a short viewport, in sun and blackout.

### B7 · Setting up → BRIEFING → kit (loadout.md §4.6) — *added 2026-08-27*
While the host is still picking the game (`kit_open:false`) the KITTED screen is a calm **"MISSION CONTROL IS
SETTING UP THE GAME"** — callsign, number, gun, nothing to tap. When the host continues to KIT the phone shows a
**BRIEFING**: the game's name big, the mode board, the host's notes, the rule lines (teams · win · respawn ·
time · HP/armor · venue) and one sentence on who carries what — read at the player's own pace, then
**`BUILD MY KIT ▸`** (or `SEE MY KIT ▸` when the kit is fixed) reveals the slot plates + READY UP. A `BRIEFING`
button brings it back any time. Blackout rules apply (no white, no flashes).

## Deliverables to iterate
B1 connect · B2 HUD in **both sun and blackout** · B3 death/respawn · the ARMED countdown · the KITTED
ready-up · the "gun relinked" prompt. Keep it one product with Mission Control (shared `tokens.css`).
