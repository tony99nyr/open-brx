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
| respawned / revived (LIVE) | the **REDEPLOYED moment** (A44): REDEPLOYED · WEAPONS HOT · `<max HP> HP · <max ARMOR> ARMOR · MAG FULL`, about 1.7 s. It marks the end of spawn protection, not the spawn itself: the node arms hit reception on the gun's first proof it can fire, or 2100 ms after the write. The DOWN countdown label is **REDEPLOY IN**, and **AWAITING REDEPLOY** while no clock is running (`hud.js _redeploy`) |
| stunned (LIVE) | **A20 host-driven stun (F15).** A proto-8 hit empties every live slot for `config.stun.duration_s` (10 s by default) and the node puts the live counts back when the timer runs out. The HUD has **no stun state today**: the ammo readout simply reads empty, so the player cannot tell a stun from a real reload. Design an explicit takeover (a named EMP cue and the remaining seconds) before the stun ships in a game |
| operator action (ARMED/LIVE) | **A47.** The operator can push RESYNC GUN, FORCE RESPAWN or RELINK to this phone from the Mission Control LIVE board. RESYNC runs the ordinary resync prompt ladder (pull the trigger, then the reload handle); FORCE RESPAWN redeploys the player; RELINK re-applies the config. The phone answers with an `operator_result` fact, so MC reports the outcome. Nothing here is a new screen yet: the player sees the resync or redeploy state the phone already has |
| pool stale (LIVE) | **A45/A47.** The phone claims `pool_stale` on `status` when the gun has gone quiet for 185 s (`silent`), when three trigger presses in a row got no shot back (`no_fire`), or when this life's spawn or revive write was lost (`write_lost`). **The claim is for MC, not for the screen**: the console shows a grey `GUN SILENT` cue and the HUD shows nothing. Deliberate, so a suspect reading never becomes an alarm mid-firefight. Decide whether the player deserves a quiet cue of their own |
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
- **Energy weapons read differently (A48, F248).** `weapon_class` decides the wording: a ballistic weapon says
  RELOAD, an energy weapon says RECHARGE and HOLD TO RECHARGE, and runs out of ENERGY, not AMMO. The reload is a
  **hold** of the lever on an energy weapon, so the cue must say hold. The **gauge** is a separate choice, made
  by the catalogue's `rounds_per_charge`: a weapon that spends more than one round per charge draws a percentage
  bar with cell pills, and every other weapon (including a low-cost energy weapon such as the Rail Gun) keeps the
  round count. Never pick the gauge from the weapon id.
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
- Clear **DOWN** state — desaturate/dim the HUD, big central redeploy countdown labelled **REDEPLOY IN**
  (**AWAITING REDEPLOY** while no clock is running), "☠ by <NAME> · <TEAM>".
- On respawn: the crisp **REDEPLOYED** moment (B0, A44), HUD back to full ALIVE. The gun does not re-arm itself:
  the node writes the live `$SIR` table once the gun can fire, and the moment is what the player sees of it.

### B4 · Blackout / night mode
A **distinct visual mode** (auto when the game's `night` flag is set; also a manual toggle). Near-black,
essential readouts only, **dim red/amber low-luminance, no white**, no bright flashes, reduced brightness.
Read HP/ammo/respawn without the phone becoming a flashlight. Its own screen (the `[data-env="night"]`
token block in `app/www/index.html`), not a filter over B2.

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
ready-up · the "gun relinked" prompt. Keep it one product with Mission Control (the two token sets are deliberately near-identical; see the
design brief `mission-control.md`).
