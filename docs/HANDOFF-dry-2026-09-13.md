# Handoff: the remaining contract-DRY and typing work

**Filed 2026-09-13 by the session that built the generated contract and the pyright gate. Nothing here blocks a
match.** Self-contained: pick up any item below without reading the 2026-09-12 session. The ids live in
[`FOLLOWUPS.md`](FOLLOWUPS.md); the design record is [`spec/contracts.md`](spec/contracts.md) A33 and the archived
working spec [`archive/spec-contract-dry-2026-09-12.md`](archive/spec-contract-dry-2026-09-12.md).

## What is already DRY, so you do not redo it

| Contract | One source | Generated into | Gate that fails on drift |
|---|---|---|---|
| Node↔MC wire tables: kinds, required fields, event types, size caps, timing constants, `ACCEPT_MIN` | `mcp/brx_mcp/mc/envelope.py` + `types.py` | `app/src/transport/contract.gen.js`, `webapp/mc/src/api/contract.gen.ts` | `mcp/tests/test_contract_generated.py` |
| Shared shapes: every TypedDict and every `Literal` alias in `types.py`, comments carried as JSDoc | `mcp/brx_mcp/mc/types.py` | `webapp/mc/src/api/contract.gen.ts`, re-exported by `types.ts` | the same, plus `test_ui_contract.py` (types.ts may not re-declare one) |
| Kind vocabulary against the spec | `docs/spec/contracts.md` §5 | none, compared | `test_contract_kinds.py` |
| Weapon and mode catalogs in the two demos | `weapons.json`, `state.py MODES` | `webapp/mc/src/mock/data.ts`, `app/src/demo-catalog.js` | `test_ui_catalog_generated.py` |
| Python type hints | `mcp/brx_mcp/` (stage excluded) | none, checked | `test_pyright.py`, pyright 1.1.414 pinned in CI |
| Console type hints | `webapp/mc/src` | none, checked | `npm run typecheck` (`tsc -b`) runs before vitest in CI |

## The rules that keep it that way

1. **Edit `types.py` or `envelope.py`, then run `python3 mcp/tools/gen_contract.py` from the repo root.** Never
   hand-edit a `contract.gen.*` file. Forgetting to regenerate fails CI.
2. **A new MC→node kind goes in three places at once:** `MC_KINDS` in `types.py`, a `REQUIRED` row in
   `envelope.py`, and a row in `contracts.md` §5. The phone drops an unlisted kind silently; that exact bug shipped
   three times (`alert`, `station_config`, `result`) before the generator existed.
3. **A receiver that must accept a frame short of fields** gets an `ACCEPT_MIN` entry, never a hand edit on one
   side. The generator refuses a key not in `MC_KINDS` or a field not in `REQUIRED`.
4. **Fix the type or the code, never silence.** No `# type: ignore`, no `cast(Any, ...)`, no assert that only
   exists to quiet the checker. On 2026-09-13 the package has no `# type: ignore` and no `cast(Any, ...)`, but four
   narrowing `cast(...)` calls landed AFTER the gate, from a merge and the standby lane: pyright accepts a cast, so
   the gate cannot stop them. Two relabel an empty default, one an untyped JSON row, and one in `policy.py` casts
   around a field that is now declared (queue item below).
5. **Retake the site shots AFTER committing** any change under `app/src` or `webapp/mc/src`, and
   `contract.gen.ts` is under `webapp/mc/src`: `cd app && npm run build && cd ../site && npm run shots`. The
   manifest records HEAD's tree hashes, so shots taken before the commit are stale the moment it lands.
6. **The generator fails loudly on what it cannot map:** a `tuple`, a non-`str` `Literal` member, or an unknown
   type raises with the class and field name. Do not work around it with a looser hint; the wire has no tuples.

## The recipe for moving a hand-written console type into the generated contract

This is the core of F42.9 and it needs no generator change.

1. Add a TypedDict (or a `Literal` alias) to `mcp/brx_mcp/mc/types.py` that says exactly what the server sends:
   `NotRequired[...]` for a key that can be absent, `X | None` for a key that is always present but may be null.
   Read the producer to decide; do not copy the TS, which was hand-kept and has been wrong before.
2. Annotate the producer to return it (`-> RecapView`, not `-> dict`), and build it as one literal where you can.
   `test_pyright.py` then checks the producer honestly.
3. `python3 mcp/tools/gen_contract.py`. The interface appears in `contract.gen.ts` with the Python comments.
4. Delete the hand-written copy from `webapp/mc/src/api/types.ts` and add the name to its `export type { ... }`
   re-export. `test_ui_contract.py` fails if you forget the delete.
5. `cd webapp/mc && npm run typecheck && npm test`. Any error is either the old TS lying or the new TypedDict
   lying; read the producer again to decide which.

## The queue, in order

Sizes and error counts were measured on 2026-09-13 against `origin/main`. XS is under an hour, S an afternoon,
M a day, L several days. The order puts free and unblocking work first.

### 1. F42.11: turn on `strict` for the console. Done 2026-09-15

`webapp/mc/tsconfig.app.json` has `"strict": true`. The measured cost was zero errors; `tsc -b`
and 514 console tests passed. This keeps every later item's TS honest.

### 2. F134: close the `win_by` vocabulary. Done 2026-09-15

`WinBy` in `types.py` is the closed scoring vocabulary. `parse_win_by` normalises missing or empty
values to the mode default and rejects a typo at PUT, compile validation and Scorer construction.
The generated console contract carries the union.

### 3. F42.16: clear the residue the generated contract left behind. Done 2026-09-15

The four `cast(...)` calls and five redundant console intersections are gone. Standby JSON rows are
decoded and malformed rows are logged rather than asserted as `Player`. `PoolEmptyCode` now lives in
`types.py`, with the policy classifier and console importing the generated vocabulary.

### 4. F42.15: a `Protocol` for the session's compiler. Done 2026-09-15

`Session.compiler` now uses `interfaces.Compiler`, which both real and fake adapters satisfy under
pyright and the runtime conformance test. The fake accepts `plan`, publishes `dmg` stats, and has
public `perk_effects`; the real compiler has the same public method. `Session` no longer hides a
perk or catalog failure under a blanket exception. Real-only `hit_plan`, `voice_options` and
`voice_preview` remain optional through guarded lookups.

### 5. F42.9: generate the console's view types. M, then L for `State`

About two dozen types in `webapp/mc/src/api/types.ts` are hand-written because the server builds them as untyped
dicts. The pyright gate did not change that: it passes with those producers still returning `dict`. Use the
recipe above, leaf shapes first, and update `mcp/brx_mcp/mc/API.md` in the same commit where a shape is not
documented yet (`RecapStationRow` and `VoiceList` have no mention there today).

| Batch | Types | Producers | Size |
|---|---|---|---|
| 1 | `Honor`, `RecapStationRow`, `StationAssignment`, `ModeParamSpec`, `PhaseRefusal`, `VoiceList`, `EndDeliveryView` | `state.py _scorer_recap`, `_recap_stations`, `_station_view`, `_end_delivery_view`; `modes/params.py`; `compile.voice_options` | S |
| 2 | `WeaponView`, `SavedGame`, `LiveRow` | `views.weapon_view`; `presets.py`; the live block of `state.py snapshot()` | S |
| 3 | `NodeView`, `StationView`, `LanPublic`, `Coverage`, `PresentationRow`, `PresentationView`, `ModeInfo` | `state.py _node_view`, `stations_view`, `modes()`; `presentation.py`; `tunnel.py` | M |
| 4 | `RecapView`, `LiveView`, `StartView`, `MatchHistoryRow` | composed from batches 1 to 3 | M |
| 5 | `State` | `state.py snapshot()`, which inlines a dozen blocks and needs real decomposition, not an annotation | L |

`ConfigView`, `LoadoutPoolReasons` and `PoolEmptyCode` are already aliases of generated types. `Api`, `FeedTag`
and `FeedEntry` have no typed server producer and stay hand-written.

### 6. F42.12: type-check the phone transport. M

`app/src/transport` is plain JavaScript that nothing type-checks, although it imports the generated tables.
**Measured with `allowJs` + `checkJs` over the five transport files: 116 errors.**

| File | Errors |
|---|---|
| `transport.js` | 78 |
| `envelope.js` | 21 |
| `ring.js` | 9 |
| `clock.js` | 5 |
| `contract.gen.js` | 0 |
| `../build.js`, pulled in by an import | 3 |

74 are implicit-any (a JSDoc `@param` or `@typedef` fixes each) and 42 are property or assignment mismatches.
Adding `strict` on top adds none. The two mismatch clusters that look like bugs are not: `envelope.js`'s
`env.seq` is an intentional optional field set after the literal, and `Transport`'s constructor JSDoc lists fewer
options than it defaults. Both need a typedef, not a fix. The work:

1. Teach `gen_contract.py` one more target, a `contract.gen.d.ts` beside `contract.gen.js` (the render
   functions already produce the TS interfaces), or `@typedef {import('../../../webapp/...')}` the shapes. The
   `.d.ts` keeps the app self-contained.
2. Add `typescript` to `app/`'s devDependencies, a `tsconfig.json` with `allowJs` and `checkJs` scoped to
   `src/transport`, and `npm run typecheck` in `app/package.json` and in CI's app job.
3. JSDoc the 74, fix or type the 42, then widen the scope file by file.

### 7. F42.14: bring the bench stage under the pyright gate. M

`mcp/brx_mcp/stage/` is excluded in `mcp/pyproject.toml`. **Measured: 59 errors** (33 argument type, 12 optional
subscript, 6 attribute access, the rest small). The stage exists to predict `app/src/engine.js`, so every change
must keep it mirroring the phone. It already imports `STATION_SOURCES`, `Compiler` and `default_config` from the
typed side. Type its JSON message boundary once, as a TypedDict per message the page sends, then remove the
exclude and let `test_pyright.py` hold it.

## Deliberately hand-kept, and pinned instead

Not gaps. Each mirrors server data by hand because it is logic or a byte map, and a test fails when it drifts.

- `webapp/mc/src/mock/policy.ts` `DEFAULT_POLICY` mirrors `policy.py`'s default:
  `test_ui_contract.py::test_default_policy_matches_the_server_default`.
- `app/src/beacon.js` `KIND` and `app/src/utility.js` `KIND_LABEL` mirror `STATION_KINDS`:
  `app/test/contract.test.mjs`.
- `DELIVERED` in `app/src/transport/transport.js` lists which MC kinds the phone engine handles. That is engine
  behaviour, not contract, and its own parity test keeps it honest.

## Working safely here, the lessons that cost time on 2026-09-12

- **Every session shares one working tree and one git index.** Before editing a file another session has open,
  ask it or wait for its commit.
- **`git commit --only <file>` commits the WHOLE working copy of that file,** including another session's unstaged
  hunks. It swept 139 lines of `types.py` into an unrelated version bump. Diff what `--only` is about to take.
- **Never `git apply --3way`, `git stash` or `git checkout -- <file>` in the shared tree.** The first writes the
  shared index; the other two destroy other sessions' work, and during someone else's merge they discard a side.
- **Park co-owned edits in a worktree** (`git worktree add --detach`, then `git diff HEAD | git apply` to bring the
  dirty state along) and apply them only once the owner has committed.
- **When fanning out agents,** give each lane a disjoint file list, forbid git state changes and repo scripts in the
  prompt, and route a cross-file fix to the file's owner rather than widening a lane.

## Where the history is

`docs/experiment-log/2026-09.md`, the 2026-09-12 contract-DRY entry, has the drifts found, the decisions and both
polish loops. Commits: `86a8c3a`, `85bab68`, `1dfb99e` (the generated contract), `41ed9ee` (the pyright gate).
