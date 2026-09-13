# Contract DRY: the phase-1 design spec, archived

**Archived 2026-09-13. History, not a source of truth.** This is the working spec the contract-DRY lane was
built from on 2026-09-12 (commits `86a8c3a`, the `types.py` hunk of `be1ce39`, polish `85bab68`, `1dfb99e`).
It is committed because the generator and its tests cite it by section. Where it disagrees with the code, the
code and `docs/spec/contracts.md` A33 win. The remaining DRY work is queued in
`docs/HANDOFF-dry-2026-09-13.md` and FOLLOWUPS F42.9, F42.11, F42.12, F42.14, F42.15 and F134.

## As built, where the code diverged from the draft below

- **Kind vocabularies.** TS gets a `[...] as const` array plus a `typeof X[number]` type, no `Set`. JS gets a
  `Set`. Python sets are sorted; tuples and dicts (`STATION_KINDS`, `STATION_SOURCES`) keep source order,
  because that order is the advert byte map and the operator's menu.
- **Optionality** is read with `get_type_hints(include_extras=True)` and `get_origin(...) is NotRequired`,
  falling back to the class's `__total__`. `__required_keys__` is unusable here: under
  `from __future__ import annotations` it reports every field as required.
- **Comment rule.** A comment-only line below a symbol is its continuation ONLY when the text after `#`
  starts with 8 or more spaces; anything less is the next symbol's preface. Section dividers
  (`# ---- ... ----`) never become JSDoc. Literal aliases carry their preface. The JS output carries the
  same JSDoc as the TS.
- **`envelope.py` constants.** Every module-level UPPER_CASE int, float or str is emitted, so `T_MIN_MS` and
  `T_MAX_MS` went public and `envelope.js` hand-mirrors nothing.
- **`ReadinessRow`** ended TOTAL: every path through `readiness()` writes every key, and an unknown value is
  `| None`, not an absent key. The dead TS-only `last_seen_ms` was dropped.
- **`ConfigView`** (`GameConfig & { loadout_policy: LoadoutPolicy }`) became the console's read type; the
  draft's "narrow once at the store" was rejected in review.
- **`test_ui_contract.py`**'s six field-name mirrors were replaced by "types.ts declares no generated shape"
  and a DEFAULT_POLICY pin that actually runs.

## Review findings cited from the code by number

The first polish review of `86a8c3a`, as numbered in the fix pass (`gen_contract.py` and
`test_contract_generated.py` cite "review finding #N"):

1. The continuation rule attached `PERSISTED_EVENT_TYPES`'s whitelist warning to `MAX_LOG_CHUNK_BYTES`.
2. `envelope.py` compared `shooter_num` against a literal 63 instead of `MAX_PLAYERS`.
3. `_T_MIN_MS` / `_T_MAX_MS` were the last pair hand-mirrored in `envelope.js`.
4. Literal aliases lost their comments in the TS output.
5. A section-divider comment became the first constant's JSDoc.
6. `STATION_SOURCE_IDS` was sorted instead of keeping source order.
7. A non-`str` Literal member rendered as a quoted string instead of raising.
8. `validate()`'s `MC_KINDS | {"apply"}` was dead once `apply` joined `MC_KINDS`.
9. `envelope.js` still said it mirrored the Python by hand.
10. The deleted `types.ts` nuance for `Loadout`, `LoadoutPool` and `LoadoutPolicy` had to move into
    `types.py` docstrings so it travels.

---

# Contract DRY spec (draft 1, 2026-09-12)

Goal: the node↔MC wire contract and the server⇄UI contract have ONE machine source, and the
other two copies are generated from it and gated by a test. A kind, a required field, a
constant or a shared shape that is added on the Python side reaches the phone and the console by
running one script, and forgetting to run it fails CI.

## 0. Findings that motivate this (verified 2026-09-12)

- envelope.py vs envelope.js, diffed mechanically:
  - `PERSISTED_EVENT_TYPES`: Python has `possession`, the phone does not (latent: the phone
    never validates outbound events, so no possession fact is rejected today).
  - `_REQUIRED["result"]`: Python requires 6 fields, the phone requires `match_id` only. This
    one is DELIBERATE (A24 comment in envelope.js): a result must reach the engine even when a
    field is missing. Today that intent is a silent difference between two hand-kept tables.
- types.py vs types.ts, 18 shared shapes. `test_ui_contract.py` checks field NAMES on 6 of
  them. Type-level drift it cannot see today:
  - `ScoreRow`: five A24 fields are required in Python, optional in TS (TS is right for
    persisted sessions that predate them; Python's TypedDict is wrong for what the server can
    actually return).
  - `ReadinessRow`: `state.py` (~line 2232) emits `last_seen_age_ms` and `gun_linked`; Python's
    TypedDict has neither. TS also declares `last_seen_ms`, which the server never emits and the
    UI never reads (dead). TS makes `sticker`/`tail`/`present`/`identity`/`node`/`headset`/`status`/
    `blockers` required; Python is `total=False` throughout, and TS is wrong about at least
    `headset`, which is only assigned in the has-node branch (a waiting row has no key).
  - `GameConfig.loadout_policy`: NotRequired in Python (it is filled by the server when absent),
    required in TS (the console reads it unguarded in ~25 places).
  - `GameConfig.coverage`: `str` in Python, `'full' | 'partial'` in TS.
  - `GameConfig.stations`: `list[dict]` in Python, `{id, kind: StationKind}[]` in TS.
  - `Loadout.overrides`, `PerkView.effects`: bare `dict` in Python, structured in TS.
  - `SlotRule.kinds`: `list[str]` vs `ItemKind[]`; `SlotRule.fixed_id` required vs optional.
  - `StationKind`: a TS union type; in Python only the tuple `STATION_KINDS`.
- History: alert (A11.4), station_config (A13.5) and result (A24) each shipped with the kind
  missing from one whitelist. All table drift. None was a type-level bug.

## 1. Source of truth

The Python package `mcp/brx_mcp/mc/`:

- `types.py` — constants (§9), Literal aliases (`ArmState`, and new ones), TypedDict shapes,
  `NODE_KINDS`, `MC_KINDS`, `CONTROL_CMDS`, `STATION_KINDS`, `STATION_SOURCES`.
- `envelope.py` — `REQUIRED` (per-kind required body fields), `EVENT_REQUIRED`,
  `PERSISTED_EVENT_TYPES`, `MAX_ENVELOPE_BYTES`, `MAX_LOG_CHUNK_BYTES`, and the new `ACCEPT_MIN`.

`docs/spec/contracts.md` stays the human spec of record; `test_contract_kinds.py` keeps pinning
its §5 tables against the machine source. Nothing is generated FROM the markdown.

Why Python: the server owns the semantics, already has the stricter validator and the shapes,
and is importable under the system python with no dependencies. Why not JSON Schema: two
codegen dependencies, worse to read than a TypedDict, and it becomes a fourth copy unless
everything is generated from it. Why not TS-first: Python has no cheap way to consume TS.

## 2. Generator: `mcp/tools/gen_contract.py`

Same shape as `gen_ui_catalog.py` (which it sits beside): `render() -> {path: text}` pure,
`main()` writes or `--check`s, `python3 mcp/tools/gen_contract.py` from the repo root. Reads the
source by IMPORTING `brx_mcp.mc.types` and `brx_mcp.mc.envelope` (both dependency-free) plus
`ast` over `types.py` for comments. Dependency-free, stdlib only.

### 2.1 Outputs

| File | Consumer | Content |
|---|---|---|
| `webapp/mc/src/api/contract.gen.ts` | MC UI (Vite/TS) | constants, Literal aliases as `type`, every TypedDict as `interface`, kind sets as `readonly string[]` + `Set`, required-field tables |
| `app/src/transport/contract.gen.js` | phone app (esbuild) + node tests + tools | constants, kind sets as `Set`, `REQUIRED`, `EVENT_REQUIRED`, `ACCEPT_MIN`, `PERSISTED_EVENT_TYPES`, `CONTROL_CMDS`, `STATION_KINDS` |

Both start with a header: `// GENERATED by mcp/tools/gen_contract.py from mcp/brx_mcp/mc/types.py +
envelope.py -- do not edit; run python3 mcp/tools/gen_contract.py`. Whole-file generation, not
marker splicing (nothing hand-written lives in them).

Not emitted: a `.d.ts` for the app (no consumer until the checkJs step; the render function is
written so that adding one is one more target).

### 2.2 Type mapping (Python → TS)

| Python | TS |
|---|---|
| `str` | `string` |
| `int`, `float` | `number` |
| `bool` | `boolean` |
| `None` | `null` |
| `X \| Y` | `X \| Y` |
| `list[X]` | `X[]` |
| bare `list` | `unknown[]` |
| `dict[str, X]` | `Record<string, X>` |
| bare `dict` | `Record<string, unknown>` |
| `Any` | `unknown` |
| `Literal["a","b"]` | `'a' \| 'b'` |
| a module-level `Name = Literal[...]` alias | `export type Name = ...` and fields referencing it use `Name` |
| a TypedDict by name (incl. forward-ref string) | the interface name |
| `NotRequired[X]` / field of a `total=False` class | `x?: X` |
| `tuple[...]` | not supported: the generator FAILS with the field name (nothing on the wire is a tuple) |

Anything else unmapped → the generator fails loudly naming the class and field. No silent `any`.

Emit order: constants, type aliases, interfaces in source order, tables. Interface order does
not matter to TS. Deterministic output (sorted where the Python source is a set).

### 2.3 Comments travel

For each TypedDict field, `ast` gives the line and `tokenize` gives the COMMENT tokens (never
split a source line on `#` by hand). A field's JSDoc is: the comment on its own line, plus
CONTINUATION lines (comment-only lines directly below it whose text after `#` begins with 8+
spaces — types.py's style for a wrapped trailing comment), plus PREFACE lines (the run of
comment-only lines directly above it that are not a continuation of the previous field). The
class docstring becomes the interface's JSDoc. Module-level constants take their preface run
the same way. `#` is stripped, `*/` inside a comment is escaped. This is what keeps
`types.ts`-level legibility for anyone reading the generated file; without it the refactor
makes the console's types LESS self-explaining than today.

Verified 2026-09-12: `python3 -c "import brx_mcp.mc.types, brx_mcp.mc.envelope"` works under the
bare system python, so the freshness test gates in CI's first (no-extras) pass, not only the
second.

### 2.4 What is generated, exactly

- Constants: every module-level `UPPER_CASE` `int`/`float`/`str` in `types.py` and the two size
  caps from `envelope.py`. Not `APP_MAJOR`/`APP_MINOR` (a compatibility statement, not wire; the
  app has its own version source) — an explicit deny-list in the generator, commented.
- Kind sets: `NODE_KINDS`, `MC_KINDS`, `CONTROL_CMDS`, `PERSISTED_EVENT_TYPES` — TS: a
  `readonly [...]` const array + `Set`; JS: `Set` in exactly the literal form
  `export const MC_KINDS = new Set([...])` (one entry per line, sorted) so the two existing regex
  tests can be pointed at the generated file without rewriting their parsers.
- `STATION_KINDS` (from the tuple) and `STATION_SOURCES` (keys only, sorted; the descriptions
  are operator prose and stay Python).
- Tables: `REQUIRED` (kind → fields), `EVENT_REQUIRED`, `ACCEPT_MIN`.
- Shapes: every TypedDict in `types.py`, every `Literal` alias.

## 3. Source-side changes (phase 2, after brx-fixes' milestone-2 lands)

In `envelope.py`:
- `_REQUIRED` → `REQUIRED`, `_EVENT_REQUIRED` → `EVENT_REQUIRED` (public; the generator and
  tests must not import privates). Keep the old names as aliases for one release? No: grep says
  only envelope.py and tests use them; rename the tests.
- NEW `ACCEPT_MIN: dict[str, tuple[str, ...]] = {"result": ("match_id",)}` with the A24
  comment moved from envelope.js. Semantics: `REQUIRED[kind]` is what the SENDER promises;
  a RECEIVER of a kind listed in `ACCEPT_MIN` checks only those fields. The rule is the same in
  both languages and lives in one place: `validate(env, direction="mc")` (the node receiving) uses
  `ACCEPT_MIN.get(kind, REQUIRED[kind])`; `direction="node"` (MC receiving) uses `REQUIRED`.
  Python's `mock_node.py` decodes with `direction="mc"` (lines ~263, ~284), so the stage/mock node
  must accept exactly what the phone accepts, or the stage diverges from the phone again.
- `EVENT_REQUIRED` gains nothing; `possession` is already there.

In `types.py`, the enrichments the diff in §0 demands (each is the server's truth, checked
against `state.py`/`api.py` before changing):
- `StationKind = Literal[...]`, `STATION_KINDS = get_args(StationKind)`.
- `StationRef(TypedDict): id: int; kind: StationKind`; `GameConfig.stations: NotRequired[list[StationRef]]`.
- `GameConfig.coverage: NotRequired[Literal["full", "partial"]]`.
- `LoadoutOverrides(TypedDict, total=False): max_hp: int; max_armor: int`; `Loadout.overrides: NotRequired[LoadoutOverrides]`.
- `PerkEffects(TypedDict, total=False)` with the five known keys; `PerkView.effects: PerkEffects`.
- `ItemKind = Literal["weapon", "perk", "sidearm"]`; `SlotRule.kinds: list[ItemKind]`;
  `SlotChoice`, `LoadoutPreset` aliases likewise (TS already names them).
- `ScoreRow`: the five A24 fields become `NotRequired` (persisted rows may lack them).
- `ReadinessRow`: add `last_seen_age_ms: int | None` and `gun_linked: bool | None`; drop the
  dead `last_seen_ms` from TS. Then STOP being `total=False`: read every branch of
  `state.py readiness()` and make REQUIRED exactly the keys every row carries (expected:
  `sticker`, `tail`, `present`, `identity`, `node`, `status`, `blockers`, `ambers`; `headset` is
  branch-only and stays optional). This is the biggest `tsc -b` blast radius in the change —
  budget it explicitly in W1, and let W1's findings settle the per-field list.
- `Phase = Literal["muster", ...]` in `types.py`; `state.py PHASES = get_args(Phase)` (the
  server owns the phase vocabulary; TS `Phase` then comes from the generated file).
- `GameConfig.loadout_policy`: stays `NotRequired` (it IS absent on a PUT body; `state.py`
  ~365/~483 fills it on every SERVED config). Those are two types, not one with a gap: the UI
  declares `type ConfigView = GameConfig & { loadout_policy: LoadoutPolicy }` for what it READS
  (`State.config`, `ModeInfo.defaults`, `SavedGame.config`, PUT/apply responses) and keeps
  `Partial<GameConfig>` for what it SENDS. `withPolicy()` stays as the runtime guard at the one
  place a config enters the store. No `!` anywhere.
- `ACCEPT_MIN` invariants, asserted by the generator AND the new test: every key is in
  `MC_KINDS`, and `set(ACCEPT_MIN[k]) <= set(REQUIRED[k])`. A typo'd key would otherwise miss
  silently and A24's guarantee would regress green. Plus one decode test per side: a `result`
  carrying only `match_id` decodes on the phone (node test) and in `mock_node` (Python test).

## 4. Consumers (phase 2)

`app/src/transport/envelope.js`: delete the constants and the four tables; `import` them from
`./contract.gen.js` and RE-EXPORT the names it exports today (`logsync.js`, `clock.js`,
`utility.js`, `transport.js`, tests, `engine.js` import from envelope.js; that surface does not
change). `validate()` for direction `mc` uses `ACCEPT_MIN[kind] ?? REQUIRED[kind]`.

`webapp/mc/src/api/types.ts`: delete the 18 mirrored shapes and the aliases they use; add
`export type { ... } from './contract.gen'` for the types and a SEPARATE
`export { STATION_KINDS, STATION_SOURCE_IDS, ... } from './contract.gen'` for the values
(`verbatimModuleSyntax: true` forbids mixing them in one statement; `erasableSyntaxOnly` means
the generated TS is interfaces, type aliases and consts only, never enums or namespaces); keep the UI-only types (`State`,
`NodeView`, `LiveView`, `RecapView`, views, `Api`, `FeedEntry`, ...). `STATION_KINDS` const
moves to the generated file.

Other hand-mirrors found by review, all adoption targets:
- `webapp/mc/src/screens/gameSummary.ts` ~line 52 and `webapp/mc/src/mock/backend.ts` ~line 40
  each carry the `STATION_SOURCES` values (labels/hints, refusal wording). Key the label map as
  `Record<StationSourceId, ...>` off the generated `STATION_SOURCE_IDS`, so a new source on the
  server fails the UI compile instead of rendering nothing.
- `app/src/engine.js` ~line 18 hardcodes `CONFIG_TTL_MS: 1_800_000`; import it.
- `app/src/beacon.js` `KIND` and `app/src/utility.js` `KIND_LABEL` mirror `STATION_KINDS`
  (byte map and labels — they stay hand-written, but a node test pins their keys to the
  generated set).
- `webapp/mc/src/mock/policy.ts` `DEFAULT_POLICY` mirrors `policy.py`'s default and is what
  `withPolicy()` falls back to. Not generated in this pass (it is logic), but `test_ui_contract.py`
  gets a test that the mock default equals the server default's shape, since the
  `loadout_policy` decision leans on it: if the two defaults drift, `withPolicy()` produces a
  policy the server would refuse while the type system calls it valid. Pin `DEFAULT_POLICY()`
  equal to `_policy.default_policy()` (field by field) in `test_ui_contract.py`.

Tests:
- NEW `mcp/tests/test_contract_generated.py` — same pattern as `test_ui_catalog_generated.py`:
  render in memory, compare to disk, name the command; plus floor tests (≥ 15 interfaces, every
  kind in `MC_KINDS` has a `REQUIRED` row, `possession` is in the JS persisted set, the
  `ACCEPT_MIN` override is present, a `dict` field renders as `Record<string, unknown>`, a
  comment on a Python field appears in the TS JSDoc).
- `test_contract_kinds.py`: its `_js_set` regex reads `contract.gen.js` instead of `envelope.js`.
  `test_mc_envelope_kinds.py` never reads the JS; it imports `E._REQUIRED` (lines ~66, ~85) —
  update those two imports to the public `REQUIRED`.
- NEW in `app/test`: `beacon.js KIND` and `utility.js KIND_LABEL` keys equal the generated
  `STATION_KINDS` (they mirror it today by comment only, types.py ~line 255).
- `.github/workflows/ci.yml` (phase 2 file list): the webapp job runs `npm run typecheck`
  (`tsc -b`) before `npm test`; vitest alone type-checks nothing, so the TS half of the
  contract is ungated today.
- `test_ui_contract.py`: the six TypedDict field tests are superseded (types.ts no longer
  declares those shapes); replace them with one test that asserts `types.ts` re-exports each
  generated name and declares none of them itself. The voice-option and weapons-json tests stay.
- `webapp/mc`: `tsc -b` must pass (CI runs `npm test` = vitest; `build` runs `tsc -b`; add
  `"typecheck": "tsc -b"` and run it in CI's webapp step).
- `app`: `npm test` (node --test) must pass; the `result` A24 tests keep passing because
  `ACCEPT_MIN` preserves the phone's behaviour.

## 5. Phasing (concurrency: brx-fixes owns the seven contract files for ~1–2 h)

Phase 1 (now, new files only, nothing committed):
- G1 generator + freshness test, generating from the CURRENT working tree.
- W1 / W2 prototypes run in a git worktree that is first brought to the SAME state as the dirty
  main tree (`git diff HEAD` applied, untracked new files copied), because the five contract
  files are all uncommitted right now and a worktree off `main` would lack ~210 lines of them.
  The deliverable is a findings list plus a patch against that snapshot; the patch is
  re-applied by hand on top of milestone-2 (small, mechanical conflicts expected).
- W1: UI adoption (types.ts re-export; what breaks under `tsc -b`; the Python enrichments
  needed, per field for ReadinessRow) → patch + findings.
- W2: app adoption (envelope.js imports + ACCEPT_MIN rule; engine CONFIG_TTL_MS; the
  KIND/KIND_LABEL pin test; node tests) → patch + findings.
Phase 2 (after milestone-2): apply the Python source changes, regenerate, apply W1/W2 patches,
run all four suites, polish-loop, commit with `git commit --only` on the lane's paths.
Phase 3: docs — contracts.md amendment row (A33 or next free), `mc/README.md` and
`webapp/mc/README.md` and `app/README.md` one paragraph each ("contract.gen.* is generated:
run ..."), CLAUDE.md one line, the session-close three writes.

## 6. Out of scope (named so they are not silently dropped)

- The 29 UI-only view types (`State`, `LiveView`, `RecapView`, `NodeView`, ...) have no Python
  shape; `api.py` builds untyped dicts. Generating them needs the view TypedDicts first — the
  pyright cleanup's job. FOLLOWUPS row.
- `webapp/mc/src/mock/policy.ts` mirrors `policy.py` (logic, not shapes). Not a generator target.
- `DELIVERED` in `transport.js` (which MC kinds the phone engine handles) is behaviour, not
  contract; the existing parity test keeps it honest.
- A `.d.ts` for the app and JSDoc/checkJs on `envelope.js`/`transport.js`: the next step, not this one.
- pyright as a gate: separate lane.
