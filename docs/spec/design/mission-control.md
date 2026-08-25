# BRX Design — Mission Control (MacBook web app; tablet-friendly)

**Package for:** the operator console. Read `foundation.md` (shared) + `tokens.css` first; real weapon
data is in `weapon-roster.md`. Iterate these 8 screens in Claude Design.

An operator console the host drives from armory to recap. **Desktop-first, but every screen must also
work on a tablet held in one hand** — the host walks up to each player during kit-out. Dense where it
helps the host, calm where it doesn't. Beat the Callsign app's operator UI; don't copy it.

**Persistent frame:** top bar with the **session/game name**, **field-LAN status** (SSID +
"N nodes connected"), the current **phase** (Muster → Build → Kit → Lobby → Live → Recap), and a **panic**
control. A left rail or stepper for the phases.

### A1 · Muster / Readiness board *(gate before a game)*
A red/amber/green **gear grid**, one card per gun.
- Per gun: **sticker name** (`R0BAT`), **powered?**, **headset connected?**, **battery %**, **link /
  last-seen**, and a **Companion batt/fw** slot (future → show "—").
- Colors: **green** ready · **amber** unknown/unsampled (e.g. battery not read — does NOT block) · **red**
  real problem (off / no headset — blocks start).
- Summary line + gate: **"6/8 green, 2 amber, 0 red — GO"**. Gate is **no reds**, not all-green. Show
  *why* a gun is red.

### A2 · Build the game
- **Mode select:** TDM · FFA · Infection · Last-Man-Standing · Extraction — big selectable cards, one-line
  description + icon each.
- **Global settings:** environment Indoor/Outdoor, **Night** toggle, respawn (type + delay), time limit,
  scoring (frag limit / win condition). LED/environment extras behind a disclosure.

### A3 · Kit each player — the centerpiece
A **per-player card**, filled while the player gears up and sizes their strap. This is where the "cool" lives.
- **Vanity display name**, **team** (color chips), **voice** (Male/Female).
- **Weapon select — a showcase.** A visual gallery of the ~18-weapon roster (real names/stats in
  `weapon-roster.md`): weapon art, class, and a clean **stat block** (damage, magazine, reserve,
  fire-rate, reload, range). Picking a weapon feels deliberate and game-like.
- Shows the player's **live node/gun link** so the host knows the kit-out reached them.

### A4 · Weapon try-out (silent tutorial)
Changing a weapon **silently arms that player's gun** so they fire + reload to feel it — no game start.
Design a small, **non-modal** "trying: <weapon>" state on the card (subtle pulse + "have them fire a few
rounds") with a clean exit. Part of kit-out, not a mode the host babysits.

### A5 · Lobby
- **Team assignment:** drag players between team columns (Blue/Yellow/…), balance hint.
- **Ready-up:** each node reports ready → a filling checklist ("5/8 ready"). When all ready, one action
  pushes the config to the taggers. This is the last moment everyone's in range — make "all ready → push
  → start" a confident sequence.

### A6 · Start (dispersed countdown control)
- Host sets a **countdown length** and starts; MC hands every node a synced go-live time. Players walk to
  bases out of range; the guns run the countdown themselves.
- MC shows a **per-node "armed, T-minus" board** (who's armed & counting, who hasn't acknowledged) + an
  **abort / reschedule** control. Convey "the match is arming even though players scattered."

### A7 · Live scoreboard — Halo-style (signature screen)
- **Team totals** up top (huge numbers, team colors), **time remaining**, a **live event feed**
  (kills, multikills, first blood).
- **Per-player rows:** name, team, K / D / A, K/D, accuracy, streak, alive/dead + respawn. Sort by score.
- **Honesty:** kills/assists/accuracy are MC-derived and reconcile at sync points — show a **per-node
  staleness** cue ("synced 40s ago"); an out-of-range node shows last-known + age, **not** "gone."

### A8 · Recap (the payoff)
- **Winner** up top (team or player), celebratory but tactical.
- **Medals / superlatives:** MVP, Most Kills, Best K/D, Sharpshooter, Survivor, First Blood, Multikill —
  award cards.
- **Full stats table** (all players, all columns) + **export**.

## Deliverables to iterate
The 8 screens A1-A8, each with a **desktop** and a **tablet** variant for A3 (kit-out) and A7
(scoreboard). Keep it feeling like one product with the Phone HUD (shared `tokens.css`).
