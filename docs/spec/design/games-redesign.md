# GAMES redesign — PICK GAME and BUILD (option A)

**Status: approved for build.** Tony, 2026-09-26, reading the storyboard: "yeah this makes sense." Build starts
after the 2026-09-25/26 bench session; brx1 routes the work. This brief is self-contained: read it without the
chat that produced it. The full storyboard (real `webapp/mc` screenshots plus proposed frames, at both widths)
is `C:\Users\Tony\brx-games-flow\index.html` — open it for the visual detail this brief only describes in
words. Followups row: [`FOLLOWUPS.md`](../../FOLLOWUPS.md) F411.

Ground truth this brief builds against: `mcp/brx_mcp/mc/types.py` (`GameConfig`), `policy.py`, `compile.py`
(`HEALTH_PRESETS`, `respawn_settings`), `presentation.py`, `mcp/brx_mcp/mc/API.md`, and the shipped
`webapp/mc/src/screens/Games.tsx` / `Designer.tsx` / `GameEditPanel.tsx` / `AdvancedPresentation.tsx`.

## 1. The design principle

**On BUILD you create the presets. On PLAY you pick the presets.**

- **BUILD** is a preset editor: create, edit, rename and delete named presets, one section per picker (§3).
  BUILD never starts a game — nothing here is "playing," everything here is "writing something down for PLAY
  to offer later."
- **PLAY (PICK GAME)** only picks among saved presets, each with a sensible default, then LOADs. PLAY has no
  editing and no "tuned, not saved" state. Any change that should outlive one game is made in BUILD, not on
  PLAY.

Two personas drive every decision: a **new operator** (a friend at Tony's house who has never opened MC) must
reach LOAD in a couple of taps with almost nothing to read, and **Tony**, who plans ahead and wants every option
MC supports reachable somewhere, but never on the first screen a guest sees. The one-line test: *a friend who
has never used it starts a game without asking Tony.*

## 2. Navigation

PLAY keeps the stepper's existing second slot (today's GAMES tab: ARMORY → PLAY → KIT → LOBBY → MATCH) — the
match sequence's gate position does not move. BUILD is a header link ("BUILD ▸"), reachable from PLAY and from
ARMORY at any time, **never a stepper step** — planning ahead is optional, not something a new operator clicks
past to reach KIT. GAME DESIGNER (today's five-part scroll) is retired: its content is absorbed into the eight
picker editors below (§3), one deep-edit surface, not two.

## 3. The eight pickers

Each is a named-preset editor in BUILD, and (subject to §4's hiding rule and §13's bench gate) a compact picker
on PLAY. MISC does not exist as a ninth picker: everything it would have held moved to the MATCH SETTINGS strip
(§5), which is not a preset at all.

| # | Picker | Fields | MVP built-ins |
|---|---|---|---|
| 1 | **GAME MODE** | `mode`, `station_source` | TDM · FFA · KOTH |
| 2 | **LIFE** | `health` (a LIFE preset IS its numbers: max HP, armour, shield) | STANDARD (45/70/0) · SHIELDS (45/0/105) · HARDCORE (45/0/0) |
| 3 | **SPAWN** | `respawn` — type, delay, protection, weapon delay, gate, ALL in the one preset (Tony: "I was imagining the protection and weapon delay would be a part of spawning") | AUTO: delay 15 s, timed protection 0 s, weapon delay 500 ms · STATION: delay 10 s, station protection 2 s, trigger live at once, gate "trigger" |
| 4 | **PRIMARY** | `loadout_policy.primary` | 1 built-in: ALL |
| 5 | **SECONDARY** | `loadout_policy.secondary` | 1 built-in: ALL |
| 6 | **PERKS** | `loadout_policy.perk` | 1 built-in: ALL |
| 7 | **MISC LOADOUTS** | `loadout_policy.hud_select` (who picks: players/host) + the blanket HEAVIES exclude (applies `exclude_tags: ["heavy"]` to primary and secondary at once) | 1 built-in: PLAYERS PICK, HEAVIES ON |
| 8 | **GAMEPLAY** | `mode_params` — the **derived remainder**: whatever field none of the other seven pickers, MATCH SETTINGS, ARMORY or post-MVP claims. Today that is `mode_params` alone. | 1, fixed: OPEN BRX STANDARD |

Not duplicated in MISC LOADOUTS: "number of slots" and "a primary with no secondary" are already SECONDARY's
own NONE option. A slot preset's own FIXED choice or exclude tags always overrides the MISC LOADOUTS blanket
for that slot.

**Easy Reload** stays a per-player accessibility switch set on KIT (`loadout.overrides.easy_reload`). It is
**never** part of any preset here — do not add it to MISC LOADOUTS or anywhere else in BUILD.

**Team count and team membership** stay in KIT/LOBBY, not a picker. **Health, spawn and loadouts stay presets**
— they are never touched by the MATCH SETTINGS strip.

A future `GameConfig` field with no obvious home lands in GAMEPLAY by default until someone gives it one of the
other seven pickers instead — never invent a ninth picker for it without checking §13's coverage table first.

## 4. The one-choice hiding rule

Tony: *"if a preset option only has one choice, play doesn't even need to have the operator pick it. just use
it."* A picker with exactly one saved preset is **hidden on PLAY and applied silently**. The moment BUILD gets
a second preset for that picker, it appears on PLAY.

- **Fresh install:** only GAME MODE, LIFE and SPAWN ship with more than one built-in, so those are the only
  three pickers a brand-new install shows. PRIMARY, SECONDARY, PERKS, MISC LOADOUTS and GAMEPLAY each have
  exactly one preset and stay hidden. **Words on screen ≈ 26** (title, 3 picker labels, 8 option names, the
  5-item MATCH SETTINGS strip, LOAD). **Clicks to LOAD: 1** — every default is sensible.
- **Later**, once Tony has added RIFLES/SNIPERS under PRIMARY and a CURATED set under PERKS in BUILD, those two
  pickers appear automatically. **Words ≈ 33. Clicks to LOAD: still 1** — more presets only ever add optional
  reading, never a required tap.

GAMEPLAY is hidden on PLAY **for MVP regardless of preset count** (§3, §13) — one option is noise for a new
operator, and post-MVP is where it grows a second preset (§15).

## 5. MATCH SETTINGS — not a picker, not a preset

Tony's case: *"like lets play the same game but only 15 kills!"* A preset defines what the game **is**; MATCH
SETTINGS is one summary strip on PICK GAME, just above LOAD, for what changes game to game. Its values start
from whichever presets are chosen, **apply to this one game only**, **carry over to PLAY AGAIN**, and **never
write back to a saved preset**.

This is **not** the forbidden "tuned, not saved" state (§1): that state was PLAY editing a *preset's* own
values and leaving them dangling, unnamed and unsaved. A match setting has nowhere to be saved to, so there is
nothing to lose track of — it belongs to this one game the way a scoreboard does.

Five items (MVP is outdoors-only, F410, so indoor/outdoor is **not** on the strip — see §15):

1. **Time limit.**
2. **Score or kill limit.**
3. **Countdown before START** (the arm runway) — **default 30 s** (Tony, 2026-09-26: "default countdown 30s.
   120s is generally too long."). This pre-fills LOBBY's own ARM COUNTDOWN control; it is not a second source
   of truth, just an earlier place to set the same default.
4. **Day or night** (night ops).
5. **SILENCED** (§6).

**Interaction:** tapping a *value* (not the −/+ steppers) opens a short row of common choices — kills
10/15/25/50/100, time 5/10/15/20/30 MIN, countdown 10/30/60 S — one tap to open, one tap to pick. The steppers
stay for fine adjustment beyond that list. Worked example: RECAP → PLAY AGAIN (1) → tap the kill number (1) →
tap 15 (1) → LOAD (1) = **4 taps** for "same game, only 15 kills," and the saved SNIPERS/STATION/SILENCED
presets underneath are untouched.

**LAST MATCH button.** Tony: *"use last match settings."* A small LAST MATCH button on the strip fills all five
values from the last match actually played. MC **persists those five values across an MC restart** (a small
key in the session store, not a preset). The button is **hidden until a match has been played** (hide-empty-
values). PLAY AGAIN already carries the values forward on its own path; LAST MATCH exists for the other two
paths: after an MC restart, and after picking a different mode or preset (which would otherwise reset the strip
to that preset's own defaults).

## 6. SILENCED — one switch, not two

Tony: *"there are two silenced double buttons in the design. we only need one switch."* **One** SILENCED switch
on the strip, off by default, covers announcer, voice, LED and the silent weapons together. brx3's F282
silent-weapons designer switch (`presentation.silent_weapons`) **folds into this one switch** — MVP has no
separate "silent weapons" control anywhere. Turning it on applies the full silenced preset
(`presentation.py PRESETS["silenced"]`) in one step. The other six presentation presets
(`counter_strike`/`vip`/`infection`/`last_stand`/`extraction`, plus the read-only sounds & lights table) are
post-MVP or mode-assigned automatically (§15); none is a manual pick.

## 7. Pickups — ARMORY only

Tony: *"setup in armory and thats it? thats easy i like it."* Powerups/pickups (`GameConfig.powerups`,
`stations` for the powerup kind) are configured **only** in ARMORY (the existing ITEMS station assignment).
Neither PLAY nor BUILD gets a pickup control. Both show a **read-only** line of what ARMORY has armed, e.g.
"PICKUPS: ROCKETS @ STATION 1 · OVERSHIELD @ STATION 2" — and the line **disappears entirely** when nothing is
armed (hide-empty-values). Same treatment for the objective/hill station (`GameConfig.stations`, `station_source`
naming which *mechanism* — see §3's GAME MODE row for the mechanism choice, ARMORY for *which physical unit*).

## 8. KOTH with no hill assigned — never a dead end

KOTH needs a hill station assigned in ARMORY (a hard LOAD block per brx3's work). On PICK GAME, picking KOTH
with nothing assigned shows a plain-English block and one button:

> ▲ NO HILL STATION ASSIGNED — KING OF THE HILL NEEDS ONE PHONE OR STICK SET AS THE HILL, IN ARMORY.
> [ASSIGN A HILL ▸] [LOAD ▸ (disabled)]

ASSIGN A HILL ▸ jumps straight to ARMORY with the station slot **already focused**. Assign a gun as the hill,
tap BACK TO PLAY, and PLAY returns with KOTH still selected and LOAD now live. **Two clicks fix it, never a
dead end.**

## 9. Operator notes

Tony: *"some modes require operator announcements or explanations, like score to win requires players to come
to MC to confirm... we need a place for this to live. operators need to know."* On length: *"short and concise.
tl;dr but still."* Each note is **one or two words-only lines**, derived from real behaviour
(`mcp/brx_mcp/mc/state.py` `MODES`, `docs/game-modes.md`: "MC is not BLE-connected to guns during play... kills
reconcile only at sync points"), never invented.

| Source | Note (max 2 lines) |
|---|---|
| GAME MODE: KING OF THE HILL | PLACE THE HILL BEFORE START · HOLD IT TO SCORE |
| GAME MODE: TEAM DEATHMATCH | TEAM HITS DON'T COUNT |
| GAME MODE: FREE-FOR-ALL | *(none — hidden entirely, hide-empty-values)* |
| MATCH SETTINGS: a score/kill limit is set | WIN: PLAYERS CONFIRM AT MC |
| MATCH SETTINGS: no time limit set | TIME: RUNS UNTIL YOU END IT |
| SPAWN: STATION | RESPAWN AT STATIONS |
| GAME MODE: LAST MAN STANDING *(post-MVP)* | LAST ALIVE WINS · NO RESPAWNS — Tony's own example, post-launch |

**Where it shows:** on PLAY once the mode is picked (short, one banner); again on LOBBY and ARMED as the last
reminder before players scatter. **Not** on the phone BRIEFING for MVP, though the existing MODE BRIEFING panel
on PLAY's sticky rail is the natural, low-cost place to add it later.

## 10. Bugs to fix in this build

- **Respawn delay does not follow respawn type.** Every MVP mode ships `respawn: {type: "auto", delay_s: 15}`
  (`state.py` `MODES`), and Designer's own `onChange` only ever overwrites `type` —
  `put({ respawn: { ...cfg.respawn, type: v } })` — never `delay_s`. Switching to STATION today keeps whatever
  delay was already there. Fix: the SPAWN preset (§3) carries its own `delay_s` as part of the preset, so
  picking STATION sets 10 s and picking AUTO sets 15 s, always, as one unit.
- **The name is buried.** Today's Designer only lets you rename a game in section "4 // NAME & NOTES," the
  last section of a five-part scroll, while the name is shown at the top of the sticky rail and the loaded-game
  header — nowhere near an edit control (Tony: "the naming of the game is confusing... every time I go to edit
  the name on the right panel"). Fix: each preset's own **name is its editor's title in BUILD**, editable inline
  wherever it shows (the picker card, the loaded header, everywhere).
- **The gun-config line is confusing on PLAY.** Today's "GUNS NOT CONFIGURED YET: WEAPONS GO AT THE LOBBY PUSH,
  AFTER KITTING" (`webapp/mc/src/screens/Games.tsx:449`, `LoadStatus`) reads like a KIT fact to an operator
  (Tony: "this is confusing. isn't it at the kit?"). Fix: **remove this line from PICK GAME entirely.** LOBBY
  reports exactly one outcome after the config push: **"GUNS READY n/n"** when everyone is ready, or the one
  gun that is not ready and what to do about it (e.g. "GUN-D NOT READY — CHECK IT IS ON AND RECONNECT IT").

## 11. No migration

Tony, 2026-09-26: *"dont worry about old saved game config support. no one is using this yet, we can change
it."* **No migration path is needed or built.** Nothing is saved in the field yet; the new model is a clean
break. Existing whole-`GameConfig` saves (`~/.brx-mcp/presets.json`) may simply stop working; do not spend
build time preserving them.

## 12. "Tonight" copy — remove it

Tony: *"Drop the 'Tonight's' references. We usually play at day time, but there is no need. just Pick Game is
fine."* The PLAY entry screen is titled **PICK GAME**, not "Pick Tonight's Game." `grep -rni "tonight"
webapp/mc/src` finds 19 hits across 8 files; 8 are on-screen copy to change, the rest are code comments or one
identifier that need no wording change:

| File : line | Hit | User-facing? |
|---|---|---|
| `screens/Games.tsx:4` | comment: `// BEFORE a config has been sent to the guns it is "pick tonight's game"` | comment |
| `screens/Games.tsx:160` | comment: `// the venue is tonight's, never the saved game's` | comment |
| `screens/Games.tsx:559` | copy: `VENUE = WHERE YOU ARE PLAYING TONIGHT (NOT PART OF THE GAME)...` | **yes** |
| `screens/AdvancedPresentation.tsx:3` | comment: "TONIGHT'S applied game" | comment |
| `screens/AdvancedPresentation.tsx:51` | comment: "showed tonight's APPLIED..." | comment |
| `screens/AdvancedPresentation.tsx:94` | copy: "Read only. This is tonight's applied game, as the server resolved it." | **yes** |
| `screens/AdvancedPresentation.tsx:96` | copy: "...and tonight's applied game uses a different one..." | **yes** |
| `screens/AdvancedPresentation.tsx:97` | copy: "...which shares its profile with tonight's applied game..." | **yes** |
| `api/types.ts:107` | doc comment: "tonight's presentation profile, resolved" | comment |
| `screens/gameSummary.ts:21` | doc comment: "this describes tonight's game" | comment |
| `screens/Designer.tsx:138` | identifier: `const applyTonight = async () => {` | identifier |
| `screens/Designer.tsx:148` | comment: "the venue stays tonight's" | comment |
| `screens/Designer.tsx:156` | comment: "seed the draft from tonight's config" | comment |
| `screens/Designer.tsx:339` | copy: `PLAYS TONIGHT WITHOUT SAVING: NAME IT ABOVE TO KEEP IT ON THE SHELF` | **yes** |
| `screens/Designer.tsx:347` | copy: `TONIGHT'S GAME STILL RUNS THE OLD VERSION` | **yes** |
| `screens/Designer.tsx:349` | copy: `APPLY TO TONIGHT'S GAME ▸` | **yes** |
| `screens/Kit.tsx:758` | comment: "not something the operator can fix tonight" | comment |
| `alerts/setup.ts:28` | catalogued alert: `TONIGHT'S GAME STILL RUNS THE OLD VERSION` | **yes** |
| `alerts/setup.ts:30` | catalogued alert: `PLAYS TONIGHT WITHOUT SAVING: NAME IT ABOVE TO KEEP IT ON THE SHELF` | **yes** |

Most of this UI (Designer.tsx, the old Games.tsx picking flow, GameEditPanel.tsx) is replaced outright by this
build, which removes most of these hits along with it; re-grep after the build and fix whatever is left.

## 13. Field coverage, and the bench-proven gate

Tony's rule for this build: *"in the build, lets not allow changes to fields which are untested and might break
gameplay. respawn on trigger for example. we have not tested that working on other functions like pulling back
on reload handle. it might break gameplay... we can show it read only... dont allow the builder to configure a
preset which breaks gameplay."*

**Rule:** BUILD exposes only bench-proven values. A field or option value that is not proven on hardware is
shown **READ-ONLY at its shipped/default value**, marked as not yet supported, and cannot be edited. Unlocking
a value later needs a bench proof plus its own FOLLOWUPS row, filed to `post-mvp.md` until then (§15).
**Builder test: no preset BUILD can save may carry an unproven value** — validate against the table below at
save time, not just in the UI.

Every `GameConfig` field, its picker (§3), and its status. Evidence is cited; anything not clearly bench-proven
is marked READ-ONLY per the "when unsure" rule, not EDITABLE.

| Field | Picker / bucket | Status | Evidence |
|---|---|---|---|
| `mode` (TDM/FFA/KOTH) | GAME MODE | **EDITABLE** | TDM/FFA are the original, most-played modes; KOTH's hill mechanic bench-proven end to end through the gun over BLE (experiment-log 2026-09-10) |
| `station_source: "grenade"` | GAME MODE | **EDITABLE** | the grenade beacon path is the one bench-proven KOTH mechanism (2026-09-10) |
| `station_source: "ir_station"` | GAME MODE | **READ-ONLY** (not offered) | `API.md`: "unproven on our bench" |
| `station_source: "phone"` | GAME MODE | **READ-ONLY** (not offered) | added 2026-09-11 (F103); no bench-pass citation found |
| `health` — STANDARD (45/70/0) | LIFE | **EDITABLE** | the original default, exercised in every match |
| `health` — SHIELDS (45/0/105) | LIFE | **EDITABLE** | armour-piercing-vs-shield interaction bench-confirmed 2026-09-18 |
| `health` — HARDCORE (45/0/0) | LIFE | **EDITABLE** | zero armour/shield, same proven pool-write mechanism |
| `health` — custom numbers | LIFE | **EDITABLE** | same mechanism as the three presets at different numbers; no new code path |
| `respawn.type: "auto"` | SPAWN | **EDITABLE** | the original respawn mechanism, used in every timed match |
| `respawn.type: "scanner"` (STATION) | SPAWN | **EDITABLE** | a named MVP built-in Tony explicitly asked for; ships as one of the two SPAWN presets |
| `respawn.delay_s` | SPAWN | **EDITABLE**, guarded | free integer, but the existing 1–2 s "wedges the headset" trap must stay guarded exactly as today's Designer already does (`onChange`'s snap-away logic) |
| `respawn.protect_s` (0/1/2) | SPAWN | **EDITABLE** | a closed, server-enforced set (`TimedProtectS`); no free-form risk |
| `respawn.weapon_delay_ms` (500/1000/3000) | SPAWN | **EDITABLE** | closed set (`WeaponDelayMs`) |
| `respawn.station_protect_s` (0/2/3) | SPAWN | **EDITABLE** | closed set (`StationProtectS`) |
| `respawn.gate: "trigger"` | SPAWN | **READ-ONLY**, the only value offered | shipped default; F212/F325 only prove it survives the API, not that it works across every weapon's input (e.g. a HELD chain-reload handle vs a simple trigger pull) — needs a bench proof to unlock full weapon-class confidence, but ships as the sole, working default |
| `respawn.gate: "presence"` | SPAWN | **READ-ONLY** (not offered) | Tony's own example: never bench-tested against other functions (e.g. the reload handle) |
| `loadout_policy.primary/secondary/perk` | PRIMARY / SECONDARY / PERKS | **EDITABLE** | the core pool mechanism runs in every match; `UNPLAYABLE_IDS` and `pickup_only` are already server-enforced regardless of what BUILD offers |
| `loadout_policy.hud_select` + blanket HEAVIES | MISC LOADOUTS | **EDITABLE** | `no_heavies` is an existing, long-proven preset |
| `time_limit_s` | MATCH SETTINGS | **EDITABLE** | the basic match clock, used in every game |
| `scoring.frag_limit` | MATCH SETTINGS | **EDITABLE** | the basic score cap, used in every game |
| the arm countdown/runway | MATCH SETTINGS | **EDITABLE** | the existing 60/120/180 s runway mechanism, now defaulting to 30 s (Tony, 2026-09-26) |
| `night` | MATCH SETTINGS | **EDITABLE** | the existing, already-shipped VENUE toggle |
| `presentation` — SILENCED switch | MATCH SETTINGS | **EDITABLE** (ship the switch); its `silent_weapons` claim stays under F282's own open bench row | F282: built at the desk, A/B/A eyes-and-ears bench pass still open — ship the control, keep chasing the bench proof under F282, not a reason to block this build |
| `mode_params` | GAMEPLAY | **READ-ONLY**, fixed "OPEN BRX STANDARD" | no mode declares a parameter yet; nothing to edit |
| `environment` (indoor/outdoor) | *n/a for MVP* | **HIDDEN** | F410: MVP is outdoors only |
| `volume` | *n/a for MVP* | **HIDDEN**, fixed at 90 | follows `environment`; see F410 |
| `stations` (objective/hill), `powerups` | ARMORY | out of scope here | configured in ARMORY only (§7); already bench-proven end to end for the powerup grant/pickup path (bench 2026-09-24 sitting A, items 1–9) |
| `led`, `siphon`, `hit_audio_class`, `hit_audio_rekey`, `stun`, `recoil` | Post-MVP | **HIDDEN** | no control anywhere today; no bench evidence either way |
| `teams` | *n/a* | derived | set by mode choice / LOBBY roster drag, never a picker field |
| `scoring.win_by` | *n/a* | derived, read-only | mode-derived everywhere already |
| `player_num_base`, `vip_player_id` | *n/a* | KIT/roster | never a preset field by existing design (a preset "names no person," `loadout.md`) |
| `game_byte`, `respawn_auto_teams` | *n/a* | system-derived | never user-set |
| `coverage` | *n/a* | site/CLI concern | a venue fact, not a per-game rule |
| `config_id` | *n/a* | system identity | never user-set |

**Needs a bench proof to unlock** (file each as its own row when proven, per `FOLLOWUPS.md`'s id rules):
`respawn.gate: "presence"`; `respawn.gate: "trigger"` against every weapon's input type, specifically a
HELD/chain reload handle (e.g. the Shotgun); `station_source: "ir_station"`; `station_source: "phone"`;
`presentation.silent_weapons`'s own A/B/A pass (already tracked as F282, left as-is, not duplicated here).

## 14. Policy-slot gap

PRIMARY, SECONDARY and PERKS map cleanly onto `policy.py`'s real shape (`_rule(choice, kinds, exclude_tags,
exclude_ids, only_ids, fixed_id)`) for a **single fixed weapon** — e.g. today's SNIPERS preset is exactly
`_rule(choice="fixed", kinds=["weapon"], fixed_id="sniper_rifle")`, already shipped. The gap: a **class**
preset that lets players choose *among* several weapons of one class (e.g. "RIFLES," or a multi-sniper
"SNIPERS") needs `only_ids` computed from the weapon catalogue's class/role tags — `policy.py` has **no
built-in class vocabulary** beyond the single "heavy" `exclude_tags` value today. BUILD must compute that id
list itself from `weapons.json`'s `role`/`tags`, and it will **not** auto-update if a new weapon of that class
ships later; re-generate the list, or add a real class tag to `policy.py`, before relying on it long-term.

## 15. Post-MVP (do not build now)

- INFECTION, LAST MAN STANDING, EXTRACTION modes (F377, already moved to `post-mvp.md`) — greyed in BUILD's
  mode picker only, marked "POST-MVP," never offered on PLAY.
- Indoor venue support and its volume choice (F410) — the whole `environment` control returns here.
- Custom GAMEPLAY presets (loading or customising `mode_params` once a mode declares parameters worth
  varying) — Tony: "post mvp we could enable some way of either loading or customizing the gameplay into
  presets."
- Per-event sound and LED editing (today's read-only "ADVANCED — SOUNDS & LIGHTS" table stays exactly as it
  is, read-only, for MVP).
- `respawn.gate: "presence"`, `station_source: "ir_station"`/`"phone"`, and the full `respawn.gate: "trigger"`
  weapon-class bench pass — each unlocks with its own bench proof and its own FOLLOWUPS row (§13).
- The phone BRIEFING echo of the operator note (§9) — low-cost, not required for MVP.

## 16. Builder test list

- **Fresh install:** PICK GAME shows exactly GAME MODE, LIFE, SPAWN and the MATCH SETTINGS strip. **≤ 1 click
  to LOAD**, **≈ 26 words** on screen.
- **After BUILD gains a second PRIMARY and a second PERKS preset:** both pickers appear on PICK GAME
  automatically, with no code change to PLAY. **Still 1 click to LOAD**, **≈ 33 words**.
- **Silent-snipers example:** from a fresh LOAD, reach SNIPERS + STATION + SILENCED-on in **4 taps** (SPAWN,
  PRIMARY, SILENCED, LOAD). **0 saved presets are created or required.**
- **"Only 15 kills":** RECAP → PLAY AGAIN → tap the kill number → tap 15 → LOAD = **4 taps** (3 plus LOAD).
- **LAST MATCH:** play a match, restart MC, open PICK GAME — the LAST MATCH button is visible (it was hidden
  before any match had been played) and restores all five MATCH SETTINGS values from that match.
- **No unproven value can be saved:** attempt to save a PRIMARY/SPAWN/etc. preset carrying a READ-ONLY-only
  value from §13's table (e.g. `respawn.gate: "presence"`) and confirm BUILD refuses it, not just hides its
  control.
- **KOTH with no hill:** LOAD is blocked with the plain-English reason; ASSIGN A HILL ▸ jumps to ARMORY with
  the station slot focused; assigning one and returning re-enables LOAD. Never a dead end.
- **Respawn delay follows type:** switching the SPAWN preset from AUTO to STATION changes the shown delay from
  15 s to 10 s in the same action, never carrying the old number over.
- **Rename anywhere:** editing a preset's name in BUILD updates it everywhere that name is shown (the picker
  card, PLAY's loaded header) with no separate "name & notes" step.
- **PICK GAME never edits:** confirm there is no path on PLAY that mutates a saved preset's own stored values;
  every mutating action lives in BUILD.
- **Docs:** `pnpm run test:all` stays green; `mcp/tests/test_docs_hygiene.py` stays green.
