# GAMES: PLAY picks, BUILD creates (F411)

**Status:** the server⇄console contract for the F411 build, 2026-09-26. The product brief is
[`games-redesign.md`](games-redesign.md) (read it first); the storyboard is Proposal A of
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

## 4. Routes

| Route | Body → answer | Errors | Phases |
|---|---|---|---|
| `GET /api/pieces` | → `GamePiece[]`: every kind, builtins first, then the host's pieces by `created_t` | | any |
| `POST /api/pieces` | `{kind, name, note?, value}` → `GamePiece` | 400 bad kind/name/value · 403 kind `mode`/`gameplay`, or a builtin's name · 409 name clash in the kind | any |
| `PUT /api/pieces/{id}` | `{name?, note?, value?}` → `GamePiece`. When the piece is in the current pick, MC recomposes the config | 403 builtin · 404 · 409 clash · 409 `IN USE BY THE RUNNING GAME` when the piece is picked and the phase is armed/live | any |
| `DELETE /api/pieces/{id}` | → `{ok: true}` | 403 builtin · 404 · 409 `IN USE: PICK ANOTHER ON PLAY FIRST` when the piece is in the current pick | any |
| `POST /api/play/pick` | `{pieces?: {kind: piece_id}, match?: Partial<MatchSettings>}` → `{ok, errors, config, pick}` | 400 unknown id, a piece of the wrong kind, a `post_mvp` mode, a bad match value; the `PUT /api/config` phase 400s | as `PUT /api/config` |

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
