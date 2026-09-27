# Adding an Open BRX game mode

A row in `MODES` is only the first step. A mode is supported when Mission Control offers it, compiles a legal
bundle for every player, scores it and names a winner, the phone briefs the player and runs any node-side
rule, and the docs say honestly how much of it is proven. The sibling how-tos are
[`adding-weapons.md`](adding-weapons.md) and [`adding-perks.md`](adding-perks.md).

## 1. Start from what the gun can do

The gun keeps no game state: no mode, no clock, no score, no respawn rule. Mode logic lives on the host. Mission
Control scores the match, the phone engine (`app/src/engine.js`) runs the per-player rules, and only the combat
surface (team, player id, pools, weapons, `$SIR` rows, LEDs) becomes frames. Read these before you design:

- [`game-modes.md`](game-modes.md): the catalogue, and the gear tier each mode needs.
- [`spec/modes.md`](spec/modes.md) §2: the config schema and the end-condition rule. The only end that reaches
  every node is the local time expiry, so `time_limit_s` is required. Every other end (a frag limit, last alive,
  a hold target) is decided by Mission Control and delivered best-effort.

Record a new hardware fact in `protocol/` or `docs/manual/`, and an unproven claim in `docs/FOLLOWUPS.md`.

## 2. Add the mode row

The catalogue is `MODES` in `mcp/brx_mcp/mc/state.py`. Each entry is a `ModeRow`:

| Field | What it does |
|---|---|
| `mode`, `name`, `abbr` | The id, the display name, and the short tag the console and HUD show. |
| `desc`, `brief` | The one-line blurb and the briefing paragraph. The console, the mock and the public site read them. |
| `teams_text`, `win_text`, `respawn_text` | The three short rule lines on the mode card. |
| `teams` | Keys into `TEAM_DEFS`. Every team mode defaults to red and blue (F413). |
| `win_by` | `"kills"`, `"survival"` or `"objective"` (`WinBy` in `mcp/brx_mcp/mc/types.py`). The scorer branches on it. |
| `frag_limit`, `respawn` | The default cap and respawn rule that `default_config()` copies into the config. |
| `preset` | The presentation preset (a key of `PRESETS` in `mc/presentation.py`). `default_config()` reads it from the row. |
| `proven` | True only after a whole match on real taggers. The public site badges every other mode "in development". |
| `mvp` | False hides the mode from the STOCK MODES picker. The engine, the config and the tests stay. |
| `station_source` | Only on a mode with an objective emitter (KotH: `"phone"`). |
| `match_items` | The MATCH SETTINGS items the console shows, in order (`MatchItemKey` in `types.py`). |

Keep `mode`, `name`, `abbr`, `desc` and `brief` first, with `proven` after them: `site/lib/facts.mjs` reads the
rows with a regular expression in that order.

`default_config(mode)` builds the fresh config from the row, and `modes()` serves it as `GET /api/modes` with
`defaults` and the engine's `params` attached. Three other tables name modes by hand. Update each one:

- `_MODE_BUILTINS` in `mc/pieces.py`: the builtin mode piece the console lists (`mode`, `name`, `post_mvp`).
  Keep it in step with `name` and `mvp`.
- `MODE_DEFAULT_PRESET` in `mc/policy.py`: only when the mode needs a loadout default other than `open`.
- `SOLO_MODES` in `mc/compile.py`: add the mode when it is designed for solo play. A one-team game in such a mode
  lets every gun on the shared `$TID` hit the others. The phone keeps its own copy of this rule (search
  `const solo` in `app/src/engine.js`). Keep the two in step.

**Team rules.** An objective mode (`OBJECTIVE_MODES` in `types.py`) must never put a player on tid 2. Yellow is
the team a neutral hill broadcasts, so a yellow roster reads every neutral point as its own. `_merge_config` in
`state.py`, `Compiler.validate()` and `DominationEngine.add_player` each refuse it.

## 3. Register the engine and its parameters

`mcp/brx_mcp/modes/registry.py` maps a mode name to its engine class in `_engines()`. `params_schema()`,
`default_params()` and `validate_mode_params()` resolve the mode's knobs from the same table, and
`GameConfig.mode_params` carries them (`spec/modes.md` §2.1). Declare parameters on the engine, not in the UI:
the console renders the controls from `params`. Reuse an existing engine where the rules fit. KotH is
`DominationEngine` on one control point.

`presentation.MODE_PRESET` is an older, separately keyed table. The row's `preset` is what `default_config()`
reads.

## 4. Score it

`Scorer` in `mcp/brx_mcp/mc/scoring.py` takes `win_by` from the config's `scoring`:

- `kills`: `_check_frag_limit` ends the match at the cap.
- `objective`: `_check_hold_target` ends it when a team reaches `hold_target_s`, and `winner()` names the side
  with the most possession. With no possession reported, the winner stays undecided.
- `survival`: `_match_state_alerts` tracks who is left alive.

`winner()` also carries per-mode branches (FFA names a player, not a team). Reuse an existing `win_by` if you
can. A new value touches `WinBy` and `parse_win_by` in `types.py`, every `win_by` branch in `scoring.py`, the
phone's reading of `win_by` in `app/src/engine.js` and `app/src/hud/hud.js`, and the generated contract. Run
`python3 mcp/tools/gen_contract.py` after you edit `types.py`.

## 5. Compile

`Compiler.validate()` in `mc/compile.py` refuses a config or roster that cannot play. An objective mode also
goes through `assert_sir_covers_objective`, which refuses a head with no protocol-15 row. Trace one player's
bundle for the new mode: `$TID`, friendly fire, `$PSET` pools, the `$SIR` table and the loadout. Add a
validation rule for every combination that would give a silent, broken game.

## 6. The console

The console is `webapp/mc`:

- **The picker.** `screens/Games.tsx` lists the mode pieces that are not `post_mvp`.
- **The strip.** The MATCH SETTINGS strip renders `matchItems()` from `screens/matchItems.ts`, which reads the
  row's `match_items`. A new item needs a key in `MatchItemKey`, a control in `MatchItem` in `Games.tsx`, and a
  regenerated contract.
- **The art.** `ModeMark` shows `assets/modes/<mode>.jpg` when `MODE_ART` in `src/modeArt.ts` lists the mode,
  and a plain striped caption otherwise.
- **The mock.** `src/mock/data.ts` carries a generated `MODE_TEXT` block. Run
  `python3 mcp/tools/gen_ui_catalog.py` to refresh it. Then add the hand-written `MODES` entry with its
  `params`, `match_items` and `defaults`, so `?mock` shows the mode.

## 7. The phone

`game_brief()` in `state.py` builds the phone's BRIEFING screen. It takes `win_text` from the row, except for a
kills game (cap or time) and a hold target, which it writes itself. Check that the brief reads correctly for the
new mode.

A rule that runs on the node goes in `app/src/engine.js`; its HUD state goes in `app/src/hud/hud.js`. The phone
never waits for Mission Control during play, so the node must be able to finish the rule on its own. If the mode
needs new phone behaviour, an older APK must not start it. There is no per-mode `min_app` field today:
`_weapon_app_blockers` in `state.py` is the model to copy (see [`adding-weapons.md`](adding-weapons.md) §3).

## 8. The art

Put the same image in two places:

- `app/www/assets/modes/<mode>.jpg` (the phone);
- `webapp/mc/public/assets/modes/<mode>.jpg` (the console), and add the id to `MODE_ART`.

`test_ui_art_coverage_and_weapon_tree_parity` in `mcp/tests/test_ui_contract.py` reads the ids from `MODES` and
fails when either image is missing. If the art must come later, add the id to its `mode_gaps` set, and file a
FOLLOWUPS row. `webapp/mc/test/modeArt.test.ts` fails when `MODE_ART` and the folder disagree.

## 9. Prove it

Write the failing test first. At minimum, cover:

- the engine rules (`mcp/tests/test_modes.py`) and the parameters (`test_mode_params.py`);
- the Mission Control path end to end: config, validation, scoring, the winner and the recap. `test_mc_koth.py`
  is the model;
- the generated files: `test_ui_catalog_generated.py`, and `test_contract_generated.py` if `types.py` changed;
- the art guard above;
- the console: `webapp/mc/test/match-items.test.ts` and `mode-params.test.tsx` are the models;
- a chaos scenario. Copy `mcp/brx_mcp/chaos/scenarios/_template.py`, set `mode`, and give it `ci_seeds` once it
  passes. `tests/test_chaos_fuzz.py` runs every scenario's CI seeds. The possession actions in
  `chaos/actions.py` only run for `koth` and `domination`, so extend them for a new objective mode.

Run the focused suites while you iterate, then `pnpm run test:all -- --ui`, because the console changes.

## 10. Update the docs

- `docs/spec/modes.md` §2: the mode's row (engine, knobs, frames, the end that reaches everyone), and §2.1 for
  its parameters.
- `docs/platform/modes.md` → *What you can run*: the public page.
- `docs/game-modes.md`: the catalogue entry.
- `mcp/brx_mcp/mc/API.md`: only if a route or a field changed.
- `docs/manual/`: only for a new, confirmed BRX fact (`docs/manual/README.md` → *How a fact gets in*).

Flip `proven` in the row, never on the site, after the first real match.

## Dogfood: King of the Hill

KotH is catalogue id `koth`. The row sets `win_by: "objective"`, `station_source: "phone"` and
`match_items` with `hold` in place of `kills`, and `koth` is in `OBJECTIVE_MODES`. The registry runs it on
`DominationEngine` with one control point. The phone engine sends a `possession` fact, `Scorer.winner()` names
the side with the most possession, and `hold_target_s` ends the match early. The roster is red and blue, never
yellow, because tid 2 is the neutral hill team. The chaos scenarios are in `chaos/scenarios/koth.py`, and the
art is `koth.jpg` in both asset folders.
