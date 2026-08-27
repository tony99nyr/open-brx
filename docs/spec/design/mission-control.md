# BRX Design — Mission Control (MacBook web app; tablet-friendly)

**Package for:** the operator console. Read `foundation.md` (shared) + `tokens.css` first; real weapon
data is in `docs/reference/callsign-ui.md`. Iterate these 8 screens in Claude Design.

An operator console the host drives from armory to recap. **Desktop-first, but every screen must also
work on a tablet held in one hand** — the host walks up to each player during kit-out. Dense where it
helps the host, calm where it doesn't. Beat the Callsign app's operator UI; don't copy it.

**Persistent frame:** top bar with the **session/game name**, **field-LAN status** (SSID +
"N nodes connected"), the current **phase** (Muster → Build → Kit → Lobby → Live → Recap), and a **panic**
control. A left rail or stepper for the phases.

### A1 · Muster / Readiness board *(gate before a game)*
A red/amber/green **gear grid**, one card per gun.
- Signals are **reported by each player's phone** (it holds the gun), not by a laptop scan. Per gun/node card:
  **sticker name** (`GUN-A`), **player number** once kitted, **gun linked?**, **headset (proven after the
  config push)**, **gun battery %**, **phone battery %**, **on the field Wi-Fi?**, **clock synced?**, **screen
  on / foreground?**, **last-seen**, and a **Companion batt/fw** slot (future → "—"). A small separate list:
  **unclaimed guns** the laptop's scan sees but no phone has taken.
- Colors: **green** ready · **amber** unknown/unsampled and does NOT block (battery not read, low phone
  battery, headset not yet proven, screen off) · **red** blocks the push (no phone on the gun, identity
  unknown/reverted, wrong Wi-Fi / MC unreachable, never synced); after the push a gun that didn't **echo**
  turns red (headset absent) and blocks start.
- An **operator checklist** strip: mobile data off, auto-join field SSID, auto-lock off, Do-Not-Disturb on.
- Summary line + gate: **"6/8 green, 2 amber, 0 red — GO"**. Gate is **no reds**, not all-green. Show
  *why* a gun is red.

### A2 · Build the game
- **Mode select:** TDM · FFA · Infection · Last-Man-Standing · Extraction — big selectable cards, one-line
  description + icon each.
- **Global settings:** environment Indoor/Outdoor, **Night** toggle, respawn (type + delay), time limit,
  scoring (frag limit / win condition). LED/environment extras behind a disclosure.

### A2b · Loadout rules (in BUILD, under Global Settings) — *added 2026-08-27, loadout.md §3/§5*
Preset row `OPEN · NO HEAVIES · SNIPERS · CUSTOM` + a **players pick on phone** toggle, then one block per slot
(PRIMARY / SECONDARY): who picks (`PLAYER / HOST / FIXED / OFF`), a pool summary the server computes
("13 OF 18 WEAPONS · 4 PERKS"), allow-chips per class, a fixed-item picker, and a per-weapon override
disclosure. Any rule edit flips the preset to CUSTOM. FFA defaults to NO HEAVIES.

### A3 · Kit each player — the centerpiece
A **per-player card**, filled while the player gears up and sizes their strap. This is where the "cool" lives.
- **Player number** (1–63, auto-filled in roster order, editable — the id enemy guns report when hit by this
  player; must be visible and unique), **vanity display name**, **team** (color chips), **voice** (Male/Female).
- **Weapon select — a showcase.** A visual gallery of the ~18-weapon roster (real names/stats in
  `docs/reference/callsign-ui.md`): weapon art, class, and a clean **stat block** (damage, magazine, reserve,
  fire-rate, reload, range). Picking a weapon feels deliberate and game-like.
- Shows the player's **live node/gun link** so the host knows the kit-out reached them.
- **Two slots (2026-08-27, loadout.md §5).** A **loadout rail** of two cards — PRIMARY and SECONDARY — sits
  beside the hero; the focused card drives the arsenal below. Slot 2 is a **weapon OR a perk OR empty**
  ("alt-fire does nothing" — a valid kit). Perks are a second tab of the same arsenal (purple), with an
  effects block instead of DMG/ROF/RNG. Rule-locked slots show a padlock + "SET IN BUILD"; out-of-pool
  tiles stay visible but dimmed, and the arsenal header carries the pool summary once ("13 OF 18 · NO
  HEAVIES"), never per tile. Roster rows show each player's live state — `PICKING…` (phone browser open),
  `TRYING <weapon>`, `READY ✓` — and a two-item loadout line. A RULES chip in the header links to BUILD.
  Tablet ≤ 900 px: the roster becomes a horizontal strip above the detail.

### A4 · Weapon try-out (silent tutorial)
Changing a weapon **silently arms that player's gun** so they fire + reload to feel it — no game start.
Design a small, **non-modal** "trying: <weapon>" state on the card (subtle pulse + "have them fire a few
rounds") with a clean exit. Part of kit-out, not a mode the host babysits.

### A5 · Lobby
- **Team assignment:** drag players between team columns (Blue/Yellow/…), balance hint.
- **Ready-up:** each node reports ready (only when synced) → a filling checklist ("5/8 ready"). When all
  ready, one action pushes the game to the taggers; per player show two ticks — **frames written** and **gun
  echoed** (the headset proof). Start stays disabled until every player has both. This is the last moment
  everyone's in range — make "all ready → push → start" a confident sequence.

### A6 · Start (dispersed countdown control)
- Host sets a **countdown length** (default 120 s — it's *walk time*; presets 60/120/180) and starts; MC hands
  every node a synced go-live time. Players walk to bases out of range; the guns run the countdown themselves.
- MC shows a **per-node "armed, T-minus" board** (who's armed & counting, who hasn't acknowledged, **in range /
  last seen**) with **Reschedule** as the primary control and **Abort** secondary. Copy: *"Once players
  disperse, an abort only reaches phones still in range — reschedule early."* Convey "the match is arming even
  though players scattered."

### A7 · Live scoreboard — Halo-style (signature screen)
- **Team totals** up top (huge numbers, team colors), **time remaining** (the match ends everywhere at this
  time, even for phones out of range), a **live event feed** naming killer and victim ("REAPER ☠ VIPER"),
  multikills, first blood, **team-kill** entries marked distinctly (team modes only; none in FFA).
- **Per-player rows:** player number, name, team, K / D / A, K/D, accuracy, streak, alive/dead + respawn.
  Sort by score; attribution is exact per player — no "team-only" caveat. FFA winner = top row.
- **Honesty is about time, not attribution:** rows reconcile at sync points — show a **per-node staleness**
  cue ("synced 40s ago" / "in range"); an out-of-range node shows last-known + age, **not** "gone."

### A8 · Recap (the payoff)
- **Winner** up top (team, or top player in FFA), celebratory but tactical.
- **Provisional state** until every phone has flushed: "N players still out — kills provisional" + a
  provisional export; design finalized vs provisional distinctly.
- **Medals / superlatives:** MVP, Most Kills, Best K/D, Sharpshooter, Survivor, First Blood, Multikill,
  Assistant — award cards.
- **Full stats table** (all players, all columns) + **export**.

## Deliverables to iterate
The 8 screens A1-A8, each with a **desktop** and a **tablet** variant for A3 (kit-out) and A7
(scoreboard). Keep it feeling like one product with the Phone HUD (shared `tokens.css`).
