# BRX Design — Phone HUD (the per-player node)

**Package for:** the player's phone. Read `foundation.md` (shared) + `tokens.css` first;
`current-hud-reference.html` is the **live shipping HUD today** — a visual starting point to push past,
not a target. Iterate these states in Claude Design.

One phone, one gun, one player. Two jobs: a few **setup screens** (before the match) and the **in-game
HUD** (during). The HUD is the star: a **first-person-shooter heads-up display** — instantly readable at
a glance, in sun or dark, while the player is moving and getting shot at.

**Portrait, one-handed, thumb-reachable. Minimal chrome. Big numbers. No scrolling during play.**

### B0 · Lifecycle → what the screen shows
| State | Screen |
|---|---|
| **IDLE** | "Set my gun" connect screen (B1) |
| **CONNECTED** | gun named; "waiting for kit-out from Mission Control" |
| **KITTED** | your loadout (weapon, team, name); "ready when you are" |
| **LOBBY** | big **READY-UP** toggle; your team + name |
| **ARMED** | full-screen **countdown** (T-minus); the gun is also beeping |
| **LIVE / ALIVE** | the **HUD** (B2) |
| **LIVE / DOWN** | **death/respawn** overlay (B3) |
| any + link lost | small, non-alarming "reconnecting" chip; the HUD keeps running |

### B1 · Set my gun (connect)
- A **"Set my gun"** button opens a **scanning sheet**: live list of nearby taggers, each with its
  **name** + **MAC-tail** + signal (so the player picks the right gun). Tap to connect. Reassure:
  "power-cycle a gun if it doesn't appear."
- Then **team** (if self-selected) and a clear "connected — waiting for the host" state.

### B2 · The in-game HUD (ALIVE) — the hero screen
A clean FPS HUD. Suggested zones (iterate freely, keep the hierarchy):
- **Health + armor** — biggest, most glanceable. HP and armor distinct (armor absorbs first); bar +
  number. **Max HP 45, armor 70** (values vary by mode — read live, don't hardcode).
- **Ammo** — large, bottom-corner FPS-style **mag / reserve** (`36 / 216`), clear low/empty + reload cue.
- **Match time remaining** — top, secondary.
- **Personal stats cluster** — K / D / A / accuracy. **Deaths is the only one the phone knows locally**;
  **kills / assists / accuracy show "— MC"** (a small "synced" tick when MC supplies them). Make "— MC"
  look intentional.
- **Team + identity** — team color as an ambient edge tint; name small.
- **Battery** — small gun-battery indicator + a **low-battery** warning state.
- **"Killed by …"** — brief callout on death (team-level: "killed by YELLOW").
Reads in **direct sun** (`data-env="outdoor"`) and **blackout** (`data-env="night"`) with no redesign —
just re-themed via tokens. Motion minimal (glare + battery); the hit/damage flash and death are the main
animated moments.

### B3 · Death & respawn (DOWN)
- Clear **DOWN** state — desaturate/dim the HUD, big central **respawn countdown**, "killed by <TEAM>".
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

## Deliverables to iterate
B1 connect · B2 HUD in **both sun and blackout** · B3 death/respawn · the ARMED countdown · the LOBBY
ready-up. Keep it one product with Mission Control (shared `tokens.css`).
