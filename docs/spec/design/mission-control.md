# BRX Design — Mission Control (MacBook web app; tablet-friendly)

**Package for:** the operator console (`webapp/mc/`, React/TS; server⇄UI contract `mcp/brx_mcp/mc/API.md`).
Real weapon data is `mcp/brx_mcp/mc/weapons.json` (the public arsenal page is `docs/manual/gameplay.md`).
The shipping UI is the visual source of truth; the 2026-08-25 Claude Design export it started from is archived
at `docs/archive/design/mc-export/` for re-seeding the design tool (per Tony, 2026-08-26, the exports were
inspiration, not definitive). Absorbed 2026-09-06: the shared foundation brief and the screen sections of the
retired `spec/mission-control.md` (`docs/archive/spec-design-foundation.md`, `docs/archive/spec-mission-control.md`).

## 0. Shared foundation (both UIs: this console and `phone-hud.md`)

**Logic vs visuals.** These briefs are *visual/UX*. Screens, states, content and art direction are yours to
iterate. Flows, fields and capabilities are fixed by `contracts.md` + `API.md` — don't invent them. If a screen
seems to need a control the brief doesn't mention, **ask**, don't fill it in.

**Brand & tone.** Tactical, precise, energetic, confident. High-contrast and legible over pretty. Never
cartoonish. Numbers are the hero on both UIs — big, tabular. **Team colours are fixed and meaningful** (Blue
`#3a86ff`, Yellow `#ffd23f`, Red `#ff5252`, Green `#2ecc71`) — never repurposed as decoration; semantic colour
(ok/warn/bad) is separate from the brand accent (`#39b4ff`). Tokens live in the code (`webapp/mc/src/tokens.ts`,
`app/www/index.html`); the MC `micro` ink is `#71879c` (≥4.5:1, design-review 2026-08-26). Fonts: Oswald +
Chakra Petch (MC), Saira Condensed + Chakra Petch (HUD); ship fallback stacks — the field LAN has no internet.

**Three states to design.** Everyday/staging (the default dark look) · **bright outdoor** (max contrast,
oversized type, thick bars, no thin greys for anything load-bearing) · **full blackout (night)** — a hard mode
of the phone HUD only (dim red, no white, no flashes; the phone must not act like a flashlight). MC sits at the
base and needs a dark theme, not a true blackout.

**Real content, never lorem.** Handles a host would type: `REAPER`, `VIPER`, `NOMAD`, `GHOST`, `HAVOC`, `SABLE`.
Gun names `GUN-A`, shown as `GUN-A-3D4F` (`<sticker>-<tail>`; real sticker ids never enter the repo). TDM
defaults HP `45`, armor `70`, ammo `32 / 192` (the AR). Modes: TDM, FFA, Infection, Last Man Standing,
Extraction. Player numbers `#1`–`#63`. Scoreboard columns: Player · Team · K · D · A · K/D · Acc% · Streak ·
Medals. Recap honors: MVP, Most Kills, Best K/D, Sharpshooter, Survivor, First Blood, Multikill, Assistant.
Timers and counts are tabular numerals; K/D and Acc% one decimal.

**Hard constraints (design *with* these).**
1. Kills / assists / accuracy are **Mission-Control-computed** and reconcile only at sync points while players
   are dispersed. The phone shows "—" until told; make that state look intentional.
2. Deaths, HP, armor, ammo, respawn and who killed you ARE known live on the phone.
3. Blackout night mode is a real requirement; outdoor sun legibility governs the default HUD.
4. **MC is not BLE-connected to guns during play** — its live board is fed by nodes over an intermittent LAN;
   the scoreboard shows **staleness**, never fabricates live individual truth.
5. The phone is mounted on the gun/forearm, foreground, screen on, during the countdown and the match.
6. Ready-up is a KITTED action; LOBBY is the armed-pending wait. A finished match returns to KITTED.
7. Every destructive action (ABORT / END / RECALL / RESCHEDULE / PANIC / EVICT / delete) is a two-step confirm.
8. A user action whose API call fails must show it — never `.catch(() => {})`; a stale server raises the
   "THE MC SERVER PREDATES THIS UI — RESTART IT" banner (design-review round 7).

An operator console the host drives from armory to recap. **Desktop-first, but every screen must also work
on a tablet held in one hand** — the host walks up to each player during kit-out. Dense where it helps the
host, calm where it doesn't. Beat the Callsign app's operator UI (1-at-a-time carousel, 1-slider settings);
don't copy it.

**Persistent frame:** command bar with the session/game name, **field-LAN status** (SSID + "N nodes
connected"), the phase stepper (ARMORY → GAMES → KIT → LOBBY → LIVE → RECAP; the server owns `phase`, the UI
may browse), and a **PANIC** control (two-step; then a persistent "FLEET SAFED n/N" banner). The join QR +
`ws://` address live big on the ARMORY screen, not in a status bar (round 4 #7). Screen width capped 1380 px.

### A1 · ARMORY — readiness board *(gate before a game)*
A red/amber/green **gear grid**, one card per gun. Signals are **reported by each player's phone** (it holds
the gun), not by a laptop scan; the laptop's `scan()` only adds an **unclaimed guns** list. Per card: sticker
name, player number once kitted, gun linked?, headset (proven after the config push), gun battery %, phone
battery %, on the field Wi-Fi?, clock synced?, screen on / foreground?, last-seen (aged and decayed, never
presented stale as current — round 5), Companion batt/fw slot (future → "—"). Colours: **green** ready ·
**amber** unknown/unsampled and does NOT block (battery not read, low phone battery, headset not yet proven,
screen off) · **red** blocks the push (no phone on the gun, identity unknown/reverted, wrong Wi-Fi / MC
unreachable, never synced); after the push a gun that didn't **echo** turns red and blocks start. An operator
checklist strip: mobile data off, auto-join field SSID, auto-lock off, Do-Not-Disturb on. Summary + gate:
**"6/8 green, 2 amber, 0 red — GO"**; gate is **no reds**, not all-green; STANDBY while the roster is empty;
show *why* a gun is red. Device-first muster: claim a phone + gun in one gesture.

### A2 · GAMES — "pick the game", and the GAME DESIGNER — "define a game" *(2026-08-27)*
Tony: picking tonight's game and defining a game are different jobs; BUILD had both and buried the defining
controls. **GAMES** (the stepper step): `YOUR GAMES` cards (saved games — name, base-mode art, one generated
rules line, EDIT / DUPLICATE / delete-with-confirm, `+ CREATE A GAME`), `STOCK MODES` cards (defaults;
CUSTOMIZE), a **VENUE** strip (indoor/outdoor, night ops — about where you play, never saved into a game;
re-asserted after a game is applied), a sticky "what the players get" summary rail (name, mode board, rule
rows, loadout line, reset notices) and `CONTINUE ▸`. No forms. Mode boards render uncropped at native aspect
(they carry baked-in text). `State.active_preset_id` marks which saved game is PLAYING — never content
identity (a copy is identical to its source). Verbs: CUSTOMIZE (stock) · EDIT (yours) · COPY / MAKE MY OWN
(opens a draft; nothing written until SAVE). Playing another card while the draft is TUNED — NOT SAVED asks once.

**GAME DESIGNER** (a page, not a phase — opened by CREATE / EDIT / CUSTOMIZE): one scrolling page — 1 BASE MODE
→ 2 RULES (teams, time, score, respawn type + delay + gate, health) → 3 LOADOUT (three columns PRIMARY /
SECONDARY / PERK: who picks player / host / fixed / off, class quick-filter chips ON / ◐ partial (n/N) / OFF with
a one-line legend, a tappable weapon grid where a tile dimmed by a chip is still tappable, fixed pick shows
candidates at full opacity and "TAP THE WEAPON EVERYONE GETS"; the SECONDARY column's kind chips are `WEAPONS ·
SIDEARMS` (A12), the PERK column has its own grid; OPEN / NO HEAVIES / SNIPERS are starting templates) → 4
PRESENTATION (preset + the announcer / gun flash / headset / gun-body switches, per-event sound + colours; the
ADVANCED read-only rows from `GET /api/presentation`) → 5 NAME & NOTES — with a sticky rail that reads like the
card will and holds `PLAY THIS NOW ▸` / `SAVE` / `SAVE AS NEW`. Edits a DRAFT; nothing touches the live game
until PLAY (an unnamed draft plays without being saved, and says so). The pool is computed ON THE CLIENT from the
rules being edited (`POST /api/loadout/pool` only re-confirms the preset name). Discard guards on BACK TO GAMES.
Mode-card click applies defaults on *change* only (round 4 #15). Phones show "setting up the game" until the
host CONTINUEs to KIT, then the BRIEFING (`phone-hud.md` B7), then their kit.

### A3 · KIT — each player, the centerpiece
A **per-player card**, filled while the player gears up and sizes their strap. **Player number** (1–63,
auto-filled in roster order, editable — the id enemy guns report when hit by this player; visible and
unique), **vanity display name**, **team** (colour chips), **voice** (the full pack; a preview speaks on the
gun), **gun binding** (a picker over unbound armory guns + UNBIND — round 5). Roster rows show each player's
live state — `PICKING…` (phone browser open), `TRYING <weapon>`, `READY ✓`, `· NO GUN` — and the loadout line
`PRIMARY + SECONDARY ◆ PERK`. Detail: identity strip → **loadout rail** (PRIMARY / SECONDARY / PERK cards, A14;
secondary is weapon | empty, perk is perk | empty; a rule-locked slot shows a padlock + "SET IN BUILD") →
**arsenal** for the selected slot (a gallery, not a dropdown: weapon art, class tag as "CLASS n" with a tooltip
— never a bare protocol number, HITS TO KILL against the host's pool instead of a range bar, the pool summary
once in the header "13 OF 18 · NO HEAVIES", out-of-pool tiles dimmed; the PERK slot shows the perk grid with an
effects block) → hero for the selected item. Picking Easy Reload over a loaded secondary (or the reverse) is a
two-tap confirm on the tile ("DROPS THEIR SMG — TAP AGAIN"). A rejected host pick is recorded and shown as the
host's error, never blamed on the phone (round 8). Tablet ≤ 900 px: the roster becomes a horizontal strip.

### A4 · Weapon try-out
Changing a weapon **arms that player's gun privately** so they fire + reload to feel it — no game start,
audible at arm's length. A small **non-modal** "TRYING: <weapon>" state on the roster row (subtle pulse) with
END TRY-OUT; never a dialog. Try-outs close once the lobby is pushed (with a human reason).

### A5 · LOBBY
**Team assignment:** drag players between team columns (Blue/Yellow/Red/Green), balance hint, lock teams.
**Ready-up:** each node reports ready (only when synced) → a filling checklist ("5/8 ready"); the host can
override-ready (logged). The action rail is three numbered steps **ALL READY → PUSH CONFIG → ARM COUNTDOWN**
(completed step = green), disabled until the gate is green; **push and arm are separate clicks** (round 4 #5).
Per player two ticks — **frames written** and **gun echoed** (the headset proof). This is the last moment
everyone's in range — make "all ready → push → start" a confident sequence.

### A6 · START (dispersed countdown control)
Host sets a **runway** (default 120 s — walk time; presets 60/120/180) and arms; MC hands every node a synced
go-live time. Hero: `SYNCED GO-LIVE IN` + a big T-minus mirror, "GUNS COUNT DOWN ON THEIR OWN — PLAYERS MAY
SCATTER OUT OF RANGE. ALL GO LIVE AT T-0." A per-node **armed / T-minus / in range / last seen** grid (ARMED ·
NO ACK · RETRYING · LAST SEEN 40s — a silent node is never "gone"). **RESCHEDULE** (primary; the runway seg
mid-countdown is labelled "RESCHEDULE TO") and **ABORT** (secondary, hazard stripe) — copy: *"Once players
disperse, an abort only reaches phones still in range — reschedule early."* Both two-step.

### A7 · LIVE — Halo-style scoreboard (signature screen)
**Team totals** up top (huge numbers, team colours), **time remaining** (the match ends everywhere at this
time, even for phones out of range), a **live event feed** naming killer and victim ("REAPER ☠ VIPER"),
multikills, first blood, **team-kill** entries marked distinctly (team modes only; none in FFA), and SYNC POINT
entries. Per-player rows: number, name, team, K / D / A, K/D, accuracy, streak, alive / down + respawn, and a
**per-node staleness** cue ("synced 40s ago" / "in range"); out-of-range nodes show last-known + age, **not**
"gone". A one-time banner on first LIVE entry explains "K / A / ACC are MC-derived, reconciled at sync points"
(the 9 px footnote alone carries too much). Host controls END / RECALL / PANIC (two-step); "early end reached
N/M nodes; the rest end at 12:00". **TV mode** for a spectator display (read-only, no token).

### A8 · RECAP (the payoff)
**Winner** up top (team, or top player in FFA), celebratory but tactical; **NEW MATCH** is the primary action
(round 4 #19). **Provisional state** until every phone has flushed: "N players still out — kills provisional"
+ a provisional export, finalized vs provisional designed distinctly. **Honors** as award cards — none under 3
scored players; MVP / MOST KILLS require kills > 0; SURVIVOR reads "FEWEST DEATHS · N". **Full stats table**
(all players, all columns, MEDALS) + **EXPORT CSV**; a history picker over this session's finished matches.

### Items panel (utility phones; designed 2026-09-04, not built — `utility.md` §5b, `utility-roadmap.md` A2)
On ARMORY/KIT: one row per utility phone from its heartbeat (kind, team, station id, threshold, live, revives,
armed, battery, last seen, app version), assign + ARM buttons, attention flags ("bring back to re-arm",
"battery low", "not seen since last match", "app behind"). Station status copy on the phone: "NOT ARMED BY
MISSION CONTROL" until the push lands, "MC-ARMED · game N" after.

## Deliverables to iterate
The screens A1–A8 + the designer, each with a **desktop** and a **tablet** variant for KIT and LIVE. Keep it
one product with the Phone HUD. Every control gets a screen-truth assertion in `tools/e2e.mjs` before the
screen is called done, and a compat step against a server without its new routes (round 7).
