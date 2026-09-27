# GAMES: PLAY picks, BUILD creates (F411)

**Status:** the server⇄console contract for the F411 build, 2026-09-26. The product brief is
[`games-redesign.md`](../../archive/spec-design-games-redesign.md) (read it first); the storyboard is Proposal A of
`C:\Users\Tony\brx-games-flow\index.html`. Where this file and the brief differ, this file is the wire. The types are in
`mcp/brx_mcp/mc/types.py` (`GamePiece`, `GamePick`, `MatchSettings`, `PieceKind`) and generated into
`webapp/mc/src/api/contract.gen.ts`. The routes are rows in `mcp/brx_mcp/mc/API.md`.

The rule: **BUILD creates presets. PLAY picks presets.** BUILD never starts a game. PLAY never edits a preset.

## 1. The model

A **piece** is one named preset for one PLAY picker. There are eight kinds:

| Kind | `value` shape | Builtins (id `builtin:<kind>:<slug>`) | Host can add? |
|---|---|---|---|
| `mode` | `{mode}` | `tdm` TEAM DEATHMATCH, `ffa` FREE-FOR-ALL, `koth` KING OF THE HILL; `infection`, `lms`, `extraction` with `post_mvp: true` | no (403) |
| `life` | `{max_hp, max_armor, max_shield}` | `standard` 45/70/0, `shields` 45/0/105, `hardcore` 45/0/0 (`compile.HEALTH_PRESETS`) | yes |
| `spawn` | `Respawn` | `auto` AUTO: `{type: "auto", delay_s: 15, protect_s: 0, weapon_delay_ms: 500}`; `station` STATION: `{type: "scanner", delay_s: 10, station_protect_s: 2, gate: "trigger"}` | yes |
| `primary` | `SlotRule` | `all` ALL (players choose any weapon) | yes |
| `secondary` | `SlotRule` | `all` ALL | yes |
| `perks` | `SlotRule` | `all` ALL | yes |
| `misc_loadouts` | `{hud_select, heavies}` | `standard` PLAYERS PICK · HEAVIES ON: `{hud_select: true, heavies: true}` | yes |
| `gameplay` | `{mode_params}` | `standard` OPEN BRX STANDARD: `{mode_params: {}}` | no (403) |

- A piece `name` is 1 to 24 characters, unique inside its kind (case-insensitive), and never a builtin's name.
- A piece `note` is one line of at most 80 characters, or `""`.
- A builtin cannot be edited or deleted (403). BUILD makes a new piece by copying one.
- **Only bench-proven values can be saved** (brief §13). The server refuses the rest with a 400, whatever the UI
  shows: `spawn.gate` may only be `"trigger"` (and only on `type: "scanner"`); `spawn.type` is `"auto"` or
  `"scanner"`; `spawn.delay_s` is refused in the 1 to 2 s band that wedges the headset (the guard today's Designer
  applies); a piece never carries `station_source` (the mode's own default and ARMORY decide it).
- Every `value` is validated through the same code as `PUT /api/config` (`policy._check_rule`, the health and
  respawn checks). A bad value is a 400 that names the field.
- The store is `home_dir()/pieces.json` (`{"v": 1, "pieces": [...]}`, atomic write). A corrupt file moves aside and
  MC starts with the builtins only, as `presets.py` does today.
- **A stored piece a rule change elsewhere later refuses is KEPT, never dropped** (independent review, HIGH 1): a
  weapon a PRIMARY/SECONDARY/PERKS piece named that is later hidden or turned pickup-only, or any other value the
  server would now refuse, marks the piece `invalid` (the plain ALL-CAPS reason) instead of deleting it — losing a
  host's saved work over a rule tightened somewhere else is worse than showing it read only. An `invalid` piece is
  listed by `GET /api/pieces`, is never pickable (PICK/LOAD treat its id like a vanished one: named by the request =
  400, merely inherited = falls back to that kind's builtin), and survives every future save untouched. A `PUT`
  supplying a `value` the current rules accept again clears the flag.
- **No migration.** The old whole-game store (`presets.json`, `/api/presets*`, `SavedGame`, `active_preset_id`) is
  removed. MC does not read `presets.json` any more and leaves the file on disk.

## 2. The pick

`GamePick` is what PLAY has chosen: one piece id for every kind, plus the MATCH SETTINGS strip.

```
GamePick = { pieces: { mode, life, spawn, primary, secondary, perks, misc_loadouts, gameplay: piece_id },
             match:  { time_limit_s: int | null, frag_limit: int | null, night: bool, silenced: bool } }
```

- The snapshot carries it as `game_pick`, always, on an F411 server. **Absent = the server predates this console.**
- It is session state: it survives an MC restart (the session snapshot) and RECAP's PLAY AGAIN (A43 roll-forward).
- A fresh session picks the first builtin of every kind (TDM, STANDARD, AUTO, ALL, ALL, ALL, standard, standard),
  and the strip starts from TDM's defaults, day, not silenced.
- A session restored from before F411 has no pick. MC derives one: `mode` = the config's mode if it is an MVP
  mode, else `tdm`; every other kind = its first builtin; the strip = the config's own values. MC does not
  recompose the config on restore.
- **LAST MATCH** (brief §5): the snapshot carries `last_match: {time_limit_s, frag_limit, night, silenced,
  countdown_s}`, captured when a match STARTs (`countdown_s` from the start request). It survives an MC restart and
  a new session. **Absent until a match has been played**, and then the console hides the button.
- The arm countdown is **not** in the pick. The strip's COUNTDOWN writes the console's existing runway store
  (`webapp/mc/src/runway.ts`), the same value LOBBY's ARM COUNTDOWN reads. One source of truth. Its default
  becomes **30 s** (Tony: "120s is generally too long").

## 3. Composing the config

MC composes the `GameConfig` from the pick and applies it through the `PUT /api/config` path (`set_config`):
same phase gating, the same RECAP roll-forward, the same re-announce while LOADED.

1. Start from `default_config(mode)` when the mode changes. When the mode is the same, start from the current
   config, so teams set on KIT and the fields no piece claims (stations, powerups, vip, stun) survive.
2. `health` = the `life` value. `sanitize` derives `health.preset` as today.
3. `respawn` = the `spawn` value, except for a mode whose default respawn type is `"none"` (post-MVP LMS), which
   keeps its own.
4. `loadout_policy`: `primary`, `secondary`, `perk` = the three slot pieces; `hud_select` from `misc_loadouts`.
   When `heavies` is false, `exclude_tags: ["heavy"]` goes on primary and secondary, **unless** that slot piece has
   its own non-empty `exclude_tags` (the slot piece wins). `preset` is derived by `policy.merge` as today.
5. `mode_params` = the mode's defaults merged with the `gameplay` value.
6. `time_limit_s`, `scoring.frag_limit` and `night` come from `match`. `silenced: true` sets
   `presentation = presentation.profile_from_preset("silenced")` (F282: announcer, voice, LED and the silent
   weapons together). `silenced: false` sets the mode's automatic presentation.
7. `environment` is always `"outdoor"` (F410: MVP is outdoors only). `volume` is not set (the venue value, 90).

**Mode change resets the strip's limits.** When a pick changes `mode`, `match.time_limit_s` and
`match.frag_limit` take the new mode's defaults, unless the same request sets them. `night` and `silenced` stay.

**`game_pick` stays truthful to whatever config is live** (polish round 1, H2): every successful `set_config`
— including `PUT /api/config`'s own inline KIT/LOBBY edit, not only a pick — re-derives `game_pick.match`
from the committed config and, if the config's mode no longer matches the picked mode piece, repoints
`pieces.mode` at that mode's builtin. The other seven kinds' piece ids are left alone: a KIT edit of health
or a loadout rule is allowed to diverge from what PLAY shows picked, since only the mode and the four MATCH
SETTINGS fields are facts a config can state about itself — the rest is still "whichever piece" until the
operator picks a different one.

## 4. Routes

| Route | Body → answer | Errors | Phases |
|---|---|---|---|
| `GET /api/pieces` | → `GamePiece[]`: every kind, builtins first, then the host's pieces by `created_t` | | any |
| `POST /api/pieces` | `{kind, name, note?, value}` → `GamePiece` | 400 bad kind/name/value · 403 kind `mode`/`gameplay`, or a builtin's name · 409 name clash in the kind | any |
| `PUT /api/pieces/{id}` | `{name?, note?, value?}` → `GamePiece`. When the piece is in the current pick, MC recomposes the config | 403 builtin · 404 · 409 clash · 409 `IN USE BY THE RUNNING GAME` when the piece is picked and the phase is armed/live | any |
| `DELETE /api/pieces/{id}` | → `{ok: true}` | 403 builtin · 404 · 409 `IN USE: PICK ANOTHER ON PLAY FIRST` when the piece is in the current pick | any |
| `POST /api/play/pick` | `{pieces?: {kind: piece_id}, match?: Partial<MatchSettings>}` → `{ok, errors, config, pick}` | 404 unknown id · 400 a piece of the wrong kind, a `post_mvp` mode, a bad match value; the `PUT /api/config` phase 400s | as `PUT /api/config` |

- A pick with `ok: false` changes nothing: not the pick, not the config.
- `config_errors` (for example KOTH with no hill station) still arrive in the snapshot. A pick that composes a
  config with errors is `ok: true`; LOAD is what those errors block.
- `PUT /api/config` stays (KIT and LOBBY edit the loaded game inline). It does not change `game_pick`.
- `POST /api/games/load` is unchanged.

## 5. The console

**PLAY** (the stepper's second slot, was GAMES; header PICK GAME; a `BUILD ▸` link in the header):

- One picker row per kind. **A kind with only one pickable piece is hidden and applied silently** (a `post_mvp`
  piece is not pickable). On a fresh install that leaves GAME MODE, LIFE and SPAWN. GAMEPLAY is always hidden.
- Each option shows its name; the selected option is marked. A tap is one `POST /api/play/pick`. The result must
  show: the option's marked state follows the server's `game_pick`, never a local guess.
- The MATCH SETTINGS strip, above LOAD: TIME (`−`/`+` steppers and a quick-pick row 5/10/15/20/30 MIN), KILLS
  (NO KILL LIMIT, 10/15/25/50/100; shown only when the mode's `win_by` is `kills`), COUNTDOWN (quick-picks 10/30/60 S, steppers over
  the `RUNWAYS` values, the runway store), DAY/NIGHT, SILENCED (a small switch, off = normal; no "NORMAL" option). Tapping a value opens
  its quick-pick row.
- The operator note: at most two short lines derived from the composed config, shown under the mode picker and on
  LOBBY and ARMED (`ⓘ ...`). KOTH: `PLACE THE HILL BEFORE START · HOLD IT TO SCORE`. TDM: `TEAM HITS DON'T COUNT`.
  FFA: none. A kill limit set: `WIN: PLAYERS CONFIRM AT MC`. Spawn STATION: `RESPAWN AT STATIONS`. Empty = hidden.
- A read-only `PICKUPS: …` line when ARMORY has pickups armed; hidden when none. Pickups are ARMORY-only.
- KOTH with no hill: LOAD is blocked with one plain reason and `ASSIGN A HILL ▸`, which opens ARMORY. Never a dead end.
- LAST MATCH: a small button on the strip, shown only when `last_match` exists. One tap sends the four server
  values in one `POST /api/play/pick` and sets the runway store to `countdown_s`.
- LOAD ▸ as today. PLAY shows no gun-programming state, no settings grid, no venue chips, no EDIT panel.
- No "tonight" copy anywhere in the console (storyboard §4.6 lists the 8 on-screen hits).

**BUILD** (a screen off PLAY and ARMORY, not a stepper step; `◂ BACK TO PLAY`):

- One tab per kind. Each tab lists its pieces as cards (name, note, a `BUILT-IN` tag). GAME MODE and GAMEPLAY are
  read-only; post-MVP modes show greyed with `POST-MVP`.
- `NEW ▸` copies the selected piece into an editor. The editor holds the kind's fields: LIFE the three numbers;
  SPAWN type, delay, protection, weapon delay, gate (choosing AUTO or STATION first fills every value from that
  builtin); PRIMARY/SECONDARY/PERKS who picks, fixed item, only/exclude; MISC LOADOUTS who picks and heavies.
- The name is edited inline at the top of the editor. `SAVE ▸`, `DELETE` (two-tap). Leaving with unsaved edits
  asks once, inline.
- Every action's error shows in the error strip, with the server's words.

**LOBBY:** after the push, one outcome line: `GUNS READY n/n`, or the one gun that is not ready and what to do
(`GUN-D NOT READY — CHECK IT IS ON AND RECONNECT IT`). The operator note shows here and on ARMED.

**BUILD's bench gate:** a field or value that is not bench-proven shows read-only at its shipped value, marked
`NOT YET SUPPORTED` (the respawn gate shows `TRIGGER`). SPAWN's delay input applies the same 1 to 2 s guard.

**Stale server:** `game_pick` absent from the snapshot, or `GET /api/pieces` 404, shows a banner:
`THE SERVER PREDATES THIS CONSOLE. RESTART MISSION CONTROL (./start.sh).` PLAY still renders.

## 6. FAVOURITES

Tony: "bundle everything on PLAY under a name, like a named LAST MATCH." A **favourite** bundles the WHOLE
PLAY pick — all eight pieces plus the MATCH SETTINGS strip and a COUNTDOWN — under one name, so a whole
night's setup (SNIPERS + STATION + SILENCED + a 15-kill limit + a 15 s countdown) is one tap, not the four
taps §16's silent-snipers example takes. It is not a ninth picker and it is not a preset: BUILD still makes
pieces one kind at a time, and a favourite has no fields of its own to edit beyond its name.

`Favourite = {favourite_id, name (<= 24 chars, unique case-insensitive), created_t, updated_t, pick: GamePick,
countdown_s: int}`. It stores piece **references** (the ids inside `pick.pieces`), not copies of their
values — editing a piece in BUILD changes what every favourite naming it loads next, exactly like editing a
piece changes what the live `game_pick` composes. The store is `home_dir()/favourites.json`
(`{"v": 1, "favourites": [...]}`, atomic write); a corrupt file moves aside and MC starts with an empty
shelf, as `pieces.json` does.

**Routes** (`mc/favourites.py`, `mc/api.py`):

| Route | Body → answer | Errors |
|---|---|---|
| `GET /api/favourites` | → `Favourite[]`, by `created_t` | |
| `POST /api/favourites` | `{name, countdown_s, pick?}` → `Favourite`. `pick` defaults to the CURRENT `game_pick` (the ordinary way: build the game on PLAY, then SAVE AS A FAVOURITE) | `400` bad name/countdown_s/pick shape · `409` name clash |
| `PUT /api/favourites/{id}` | `{name}` → `Favourite` (rename only) | `404` · `409` clash |
| `DELETE /api/favourites/{id}` | → `{ok: true}` | `404` |
| `POST /api/favourites/{id}/load` | `{}` → `{ok, errors, config, pick, countdown_s, fallbacks: PieceKind[]}` — applies the favourite's pieces and match through the SAME `compose`/`set_config` path `POST /api/play/pick` uses: same phase gating, same RECAP roll-forward, same re-announce while LOADED, and the same **`ok: false` changes nothing** rule (checked before anything is applied; `config`/`pick` in that reply are the unchanged current ones). A piece id the favourite named that no longer exists, or that turned `post_mvp` since, falls back to that kind's first builtin and is named in `fallbacks` — never a 404 for the whole favourite, only for an unknown favourite id itself | `404` unknown favourite |

`countdown_s` is the same 5–900 s arm-runway range `POST /api/start`/`POST /api/start/reschedule` already
enforce — a favourite's countdown is that same knob, saved under a name. It is never part of `GamePick`
itself (§2: the runway is the console's own `RUNWAYS` store, not server session state) — LOAD hands it back
in the response so the console can set the runway store the same way LAST MATCH does.

**The console:** a FAVOURITES row on PLAY (name chips, most-recently-loaded or alphabetical), a
`☆ SAVE AS A FAVOURITE` action next to LOAD (name-only inline form; countdown defaults to the current
runway store value), tap a chip to LOAD, delete behind the two-step confirm. A `fallbacks` reply shows one
line per replaced kind (`SPAWN — STATION IS GONE, USING AUTO`) so the operator is never surprised by a
silent substitution; the load still succeeds.

## 7. Teams and per-mode items (F413, F415)

**Per-mode items (F415).** Each `GET /api/modes` row carries `match_items`: the MATCH SETTINGS keys it
offers, in order, from `time`, `kills`, `countdown`, `daynight`, `silenced`, `teams` and `hold`. The console
renders the strip from it and never keeps its own per-mode list. When `match_items` is absent (an older
server), the console falls back to `time, kills, countdown, daynight, silenced`, with `kills` only for a
kill-scored mode.

| Mode | `match_items` |
|---|---|
| TDM | time, kills, countdown, daynight, silenced, teams |
| FFA | time, kills, countdown, daynight, silenced |
| KOTH | time, hold, countdown, daynight, silenced, teams |

**Teams (F413).**
- `match.teams` is the team colours in play, in order: 2 to 4 unique values from `red` (tid 0), `blue` (1),
  `yellow` (2) and `purple` (3). It is absent for a mode without teams (FFA).
- Every team mode defaults to `["red", "blue"]`. KOTH is exactly 2 teams and never offers yellow (a neutral
  hill broadcasts tid 2, F82). Anything else is a 400 on `POST /api/play/pick` or a favourite save.
- Compose writes `config.teams` from `TEAM_DEFS` in that order. A change of count or colour re-teams the
  roster evenly, through the same path as a mode switch, so PLAY's moves-players confirm applies to it.
- A mode change resets `teams` to the new mode's default, like the limits.

**KOTH hold target (F415).**
- `match.hold_target_s` (KOTH only): `null` = no target. Otherwise the first team whose possession reaches
  it wins at once. If no team reaches it, the team with the most possession at the clock wins, as before.
- Compose writes it to `config.scoring.hold_target_s`. MC's scorer enforces it, as it does the frag limit.
- The phone shows it through the existing `game_brief()` text (for example `FIRST TO HOLD 5:00 WINS`), with
  no app change.
- The console item offers NO TARGET and 3, 5 and 10 MIN as quick-picks, plus steppers in 1-minute steps.

`last_match` and FAVOURITES carry both keys like the other strip values.
