# BRX — Design Handoff for Claude Design (Mission Control + Phone HUD)

**Purpose.** A visual/UX brief for iterating the two Open BRX interfaces in Claude's design tool. It
gives you screens, states, real content, and art direction — **not** backend logic. Logic/flow truth
lives in `docs/spec/` (README, contracts, the module specs); this doc is downstream of it and must not
invent flows, fields, or capabilities the spec doesn't have.

**How to use.** Two self-contained parts — **Part A: Mission Control** (MacBook web app, also opened on
a tablet over the field Wi-Fi) and **Part B: Phone HUD** (the per-player node). Drop either part into a
Claude Design session on its own. §1-§3 (shared foundation) apply to both — paste them alongside
whichever part you're iterating.

**Guardrails for the design tool (read first):**
- Populate every mockup with the **real content in §7** — never lorem, never invented weapon names/stats.
- **Honor the honesty rule:** individual **kills / assists / accuracy are computed by Mission Control**,
  not the phone, and reconcile only at sync points while players are dispersed. On the HUD those fields
  read **"— MC"** until supplied. Don't design a phone HUD that shows a live personal kill counter.
- Two of the three states that matter are **environmental**: bright outdoor sun and full night. Design
  **both**, plus the everyday case.
- Don't design settings/flows that aren't in the spec. If a screen seems to need one, flag it as a
  question, don't fill it in.

---

## 1. The product in one line

Stock BRX laser taggers, run as a hosted event: a **MacBook Mission Control** kits players out and runs
the match over a local field Wi-Fi; each player carries a **phone** showing a **video-game HUD** for
their one gun. Tactical, competitive, club/rental-grade — think a real arena's ops console + a
first-person-shooter HUD, not a toy.

## 2. Brand & tone

- **Feel:** tactical, precise, energetic, confident. High-contrast and legible over pretty. Never
  cartoonish, never fussy.
- **Existing palette to evolve** (from the shipped app — a starting point, not a cage):
  - ground `#0c1016` (near-black navy), panel `#141b24`, line `#25313f`
  - ink `#e8eef5`, dim `#8aa0b4`
  - accent `#39b4ff` (electric blue)
  - semantic: ok `#2ecc71`, bad `#ff5252`, warn `#ffb020`
  - **team colors** (fixed, meaningful — don't recolor): Blue `#3a86ff`, Yellow `#ffd23f`, plus
    Red `#ff5252`/Green `#2ecc71` available for 3-4 team modes.
- **Type:** a strong, slightly condensed display face for numbers/labels (HUD readouts, scoreboard,
  timers) paired with a clean, highly-legible UI face for body/controls. Numbers are the hero on both
  UIs — use tabular figures everywhere digits change (HP, ammo, timers, K/D).
- **Semantic color is separate from accent.** Good/warn/critical (green/amber/red) mean state, not brand.

## 3. The two environments (design all three)

| Context | Where | Design requirement |
|---|---|---|
| **Everyday / staging** | indoor prep, dim arena lobby | the default look; dark theme, comfortable density |
| **Bright outdoor** | midday sun, glare on the phone | **maximal contrast**, oversized type, thick bars, no thin hairlines or low-contrast grays for anything load-bearing; the HUD must be readable at arm's length in sun |
| **Full blackout (night)** | night games | **near-total darkness, no light leak** — minimal luminance, dim/red accents, NO white fields or bright flashes; the phone must not give away a player's position. A deliberate, separate visual mode, not a dimmed copy. |

Blackout is a **hard mode of the phone HUD** (toggle + auto by game `night` flag). Mission Control has a
dark theme but doesn't need true blackout (it sits at the base).

---

# PART A — Mission Control (MacBook web app; tablet-friendly)

An operator console the host drives from armory to recap. Desktop-first, **but every screen must also
work on a tablet held in one hand** (the host walks up to each player during kit-out). Information-dense
where it helps the host, calm where it doesn't. Beat the Callsign app's operator UI, don't copy it.

**Persistent frame:** a top bar with the **session/game name**, the **field-LAN status** (SSID +
"N nodes connected"), the current **phase** (Muster → Build → Kit → Lobby → Live → Recap), and a panic
control. A left rail or stepper for the phases.

### A1. Muster / Readiness board *(phase 1)*
A red/amber/green **gear grid** — one card per gun. The go/no-go gate before a game.
- Per gun: **sticker name** (e.g. `R0BAT`), **powered?**, **headset connected?**, **battery %**,
  **link/last-seen**, and a **Companion batt/fw** slot (future, show as "—" for now).
- State color: **green** = ready, **amber** = unknown/unsampled (e.g. battery not yet read — does NOT
  block start), **red** = a real problem (off / no headset), blocks start.
- A clear **"Ready to start: 6/8 green, 2 amber, 0 red — GO"** summary; the gate is **no reds**, not
  all-green. Show *why* a gun is red.

### A2. Build the game *(phase 2)*
Mode picker + global settings. Callsign-parity, cleaner.
- **Mode select:** TDM · FFA · Infection · Last-Man-Standing · Extraction — as big selectable cards with
  a one-line description and an icon each.
- **Global settings:** environment **Indoor/Outdoor**, **Night** toggle, **respawn** (type
  Scanner/Auto/None + delay seconds), **time limit**, **scoring** (frag limit / win condition).
- Advanced/LED/environment customization tucked behind a disclosure, not front-and-center.

### A3. Kit each player *(phase 3)* — the centerpiece
A **per-player card/panel**, filled out while the player is gearing up and sizing their strap. This is
where the "cool" lives.
- **Vanity display name** (free text), **team** (color chips), **voice** (Male/Female).
- **Weapon select — make it a showcase.** A visual gallery of the **~18-weapon roster** (names + stats
  from `reference/callsign-ui.md` / the WeaponCatalog — use the real ones, §7): weapon art, class, and a
  clean **stat block** (damage, magazine, reserve, fire-rate, reload time, range). Selecting a weapon
  feels deliberate and game-like — this is the moment a player picks their kit.
- Per-player settings live here too (kept minimal).
- A player's card shows their **live node/gun link** (are they connected?) so the host knows the kit-out
  actually reached them.

### A4. Weapon try-out *(phase 3a)* — silent tutorial
When the host changes a player's weapon, it **silently arms that player's gun** so they can shoot + reload
to feel it — no game start, minimal fuss. **UX to design:** a small, non-modal "trying: <weapon>" state
on the player card (a subtle pulse + "have them fire a few rounds"), and a clean exit. It should feel
like a natural part of kit-out, not a separate mode the host has to manage.

### A5. Lobby *(phase 4)*
Teams + ready-up, the last step before dispersal.
- **Team assignment**: drag players between team columns (Blue/Yellow/…), balanced-count hint.
- **Ready-up**: each player's node reports ready; show a **ready checklist** filling in
  ("5/8 ready"). When all ready, the host pushes the config to the taggers (one action).
- This is the last moment everyone's in Wi-Fi range — make "everyone ready, push config, then start" feel
  like an obvious, confident sequence.

### A6. Start *(phase 5)* — dispersed countdown control
- Host sets a **countdown length** and hits start; MC hands every node a synced go-live time. Players
  **walk to their bases** out of range; the guns run the countdown themselves.
- MC shows a **per-node "armed, T-minus" board** — who's armed and counting, who hasn't acknowledged —
  and an **abort/reschedule** control. Convey "the match is arming even though players have scattered."

### A7. Live scoreboard *(phase 6)* — Halo-style
The signature live screen. A big, glanceable scoreboard the host (and a spectator tablet) watches.
- **Team totals** up top (big numbers, team colors), **time remaining**, and a **live feed** of
  events (kills, multikills, first blood).
- **Per-player rows:** display name, team, kills / deaths / assists, K/D, accuracy, streak, current
  alive/dead + respawn. Sort by score.
- **Honesty:** kills/assists/accuracy are **MC-derived and reconcile at sync points** — show a
  **staleness indicator** per node ("synced 40s ago") and don't imply second-by-second truth while
  players are dispersed. A node that's out of range shows last-known + its age, **not** as "gone."

### A8. Recap *(phase 7)*
The post-match payoff.
- **Winner** (team or player) up top, celebratory but tactical.
- **Superlatives / medals:** MVP, Most Kills, Best K/D, Sharpshooter (accuracy), Survivor (fewest
  deaths), First Blood, Multikill — as award cards.
- **Full stats table** (all players, all columns), and an **export** action.

---

# PART B — Phone HUD (the per-player node)

One phone, one gun, one player. Two jobs: a few **setup screens** (before the match) and the **in-game
HUD** (during). The HUD is the star: a **first-person-shooter heads-up display** — instantly readable at
a glance, in sun or dark, while the player is moving and possibly getting shot at.

**Portrait, one-handed, thumb-reachable controls.** Minimal chrome. Big numbers. No scrolling during play.

### B0. Node lifecycle → what the screen shows
The phone moves through these states; design the HUD's dominant readout for each:

| State | Screen |
|---|---|
| **IDLE** | "Set my gun" — connect screen (see B1) |
| **CONNECTED** | gun named, "waiting for kit-out from Mission Control" |
| **KITTED** | your loadout shown (weapon, team, name) — "ready when you are" |
| **LOBBY** | a big **READY-UP** button/toggle; shows your team + name |
| **ARMED** | full-screen **countdown** (T-minus) — the pre-match moment; the gun is also beeping |
| **LIVE / ALIVE** | the **HUD** (B2) |
| **LIVE / DOWN** | **death/respawn** overlay (B3) |
| any + link lost | a small, non-alarming "reconnecting" indicator; the HUD keeps running |

### B1. Set my gun (connect)
- A **"Set my gun"** button opens a **scanning sheet**: a live list of nearby taggers, each showing its
  **name** and **MAC-tail** + signal (so a player picks the right gun). Tap to connect. Include the
  reassuring line: "power-cycle a gun if it doesn't appear."
- Then **team** (if the player self-selects) and a clear "connected — waiting for the host" state.

### B2. The in-game HUD *(ALIVE)* — the hero screen
A clean FPS HUD. Suggested reading order / zones (iterate freely, keep the hierarchy):
- **Health + armor** — the biggest, most glanceable element. Two bars or a bold segmented readout; HP
  and armor distinct (armor absorbs first). Numbers + bar. **Max HP 45, max armor 70** (values vary by
  mode — read them live, don't hardcode).
- **Ammo** — large, bottom corner FPS-style: **mag / reserve** (e.g. `36 / 216`), with a clear low/empty
  state and a reload cue.
- **Respawn timer** — when down, a big central countdown (see B3).
- **Match time remaining** — top, secondary.
- **Personal stats cluster** — kills / deaths / assists / accuracy. **Deaths is the only one the phone
  knows locally**; **kills / assists / accuracy show "— MC"** (a small "synced" tick when MC has
  supplied them). Design this so the "— MC" state looks intentional, not broken.
- **Team + identity** — your team color as an ambient accent (a border/edge tint), your name small.
- **Battery** — a small gun-battery indicator; a **low-battery warning** state.
- **"Killed by …"** — a brief callout on death (team-level: "killed by YELLOW").

Contrast is everything here: this must read in **direct sun** (B-outdoor) and in **blackout** (B-night)
without redesign — just re-themed. Motion: keep it minimal (glare + battery); a hit/damage flash and a
death state are the main animated moments.

### B3. Death & respawn *(DOWN)*
- A clear **DOWN** state — desaturate/dim the HUD, big **respawn countdown**, "killed by <TEAM>".
- On respawn: a crisp "**RESPAWNED**" moment, HUD returns to full ALIVE. (The gun re-arms itself; the
  screen just reflects it.)

### B4. Blackout / night mode
A **distinct visual mode** (auto when the game's `night` flag is set; also a manual toggle). Near-black
field, only the essential readouts in **dim red/amber low-luminance**, **no white**, no bright flashes,
reduced brightness overall. The player must be able to read HP/ammo/respawn without the phone acting like
a flashlight. Design it as its own screen, not a filter over B2.

### B5. Diagnostics / info (optional button)
Behind a small **info button**: raw BLE link state, last frames, battery, timings, node/gun ids — a field
-debug panel. Utilitarian, dense, monospaced is fine. Also a **"save/share log"** action (the host can
pull it). This screen can be plain; it's for fixing problems, not for play.

---

## 7. Real content to populate mockups (no lorem)

- **Teams:** Blue `#3a86ff`, Yellow `#ffd23f` (Red/Green for 3-4 team modes). Example rosters: use real
  callsign-style handles the host would type — e.g. `REAPER`, `VIPER`, `NOMAD`, `GHOST`, `HAVOC`, `SABLE`.
- **Guns (armory names):** sticker-style ids like `R0BAT`, `R0BQT`, `R0BAS`, `R0BP1` (+ a MAC-tail like
  `3D4F`). Format is `<NAME>-<tail>`.
- **Health/ammo defaults (TDM):** HP `45`, armor `70`, ammo `36 / 216`.
- **Modes:** Team Deathmatch, Free-for-All, Infection, Last-Man-Standing, Extraction.
- **Weapons:** the ~18-weapon roster + stats live in `docs/reference/callsign-ui.md` (the WeaponCatalog).
  Use those **real names and numbers**. Stat fields to render per weapon: **damage, magazine, reserve,
  fire-rate, reload time, range, class**. Archetypes present: assault rifle, SMG, sniper, shotgun, pistol,
  LMG (pull exact entries from the catalog).
- **Voices:** Male, Female.
- **Settings enums (from callsign-ui):** weapon-respawn 30 / 60 / 90 s / 3 min; pickup Scan / Player /
  Both; respawn type Scanner / Auto.
- **Scoreboard columns:** Player · Team · K · D · A · K/D · Acc% · Streak · Medals.
- **Recap medals:** MVP, Most Kills, Best K/D, Sharpshooter, Survivor, First Blood, Multikill.
- **Timers/counts** are tabular numerals; K/D and Acc% one decimal (e.g. `2.3`, `41%`).

## 8. Hard constraints (don't design around these — design *with* them)

1. **Kills / assists / accuracy are Mission-Control-computed**, and reconcile at sync points while
   players are dispersed. Phone shows **"— MC"** until told. (The gun is blind to its own kills.)
2. **Deaths, HP, armor, ammo, respawn** ARE known live on the phone — those can update in real time.
3. **Blackout night mode** is a real requirement, not a nice-to-have.
4. **Outdoor sun legibility** governs the default HUD — if it's not readable in glare, it's wrong.
5. **MC is not BLE-connected to guns during play** — its live board is fed by nodes over the LAN, which
   is intermittent by design; the scoreboard shows **staleness**, never fabricates live individual truth.
6. Team colors are **fixed and meaningful** — don't repurpose them as decoration.

## 9. Deliverables to iterate in Claude Design

- **Mission Control:** the 8 screens A1-A8 (desktop + a tablet variant of the kit-out and scoreboard).
- **Phone HUD:** B1 connect, B2 HUD (in **both** sun and blackout), B3 death/respawn, the ARMED
  countdown, and the LOBBY ready-up.
- Deliver a small **design-system frame** (palette incl. both environments, type scale, the number/bar
  components, team-color treatment) so both UIs feel like one product.

> When a screen feels like it needs a control or flow this brief doesn't mention, **ask** — the logic
> lives in `docs/spec/`, and I (backend) will confirm or correct rather than have the visual invent it.
