"""The generated wire-contract clients (contract.gen.ts / contract.gen.js) match their generator.

Companion to `test_ui_catalog_generated.py` -- same in-memory-render-vs-disk pattern, this time for
`mcp/tools/gen_contract.py`: the ONE machine copy of the node<->MC wire (`mcp/brx_mcp/mc/types.py` +
`envelope.py`) that the MC console and the phone app used to hand-keep as two more copies (contract-DRY
phase 1, docs scratch/contract-dry-spec.md). A kind, a required field, a constant or a shared shape
added on the Python side reaches both clients by running the generator; forgetting to run it fails here.

Run: python3 run_tests.py contract_generated
"""
from __future__ import annotations

import importlib.util
import pathlib
import re
import sys
import typing

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mcp"))
from brx_mcp.mc import envelope as _envelope   # dependency-free, imports cleanly under bare system python

GENERATOR = REPO / "mcp" / "tools" / "gen_contract.py"
TS_OUT = REPO / "webapp" / "mc" / "src" / "api" / "contract.gen.ts"
JS_OUT = REPO / "app" / "src" / "transport" / "contract.gen.js"
COMMAND = "python3 mcp/tools/gen_contract.py"

# No skip path, deliberately: `brx_mcp.mc.types`/`.envelope` are dependency-free and import cleanly
# under bare system python (verified), and the generator + both generated files are checked in. A
# missing generator, a missing/renamed source module, or a deleted contract.gen.* is a real failure
# here, never a quiet skip -- see `test_the_generated_files_exist` below for the last of those.


def _load():
    spec = importlib.util.spec_from_file_location("gen_contract", GENERATOR)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _render() -> dict[pathlib.Path, str]:
    return _load().render()


def _diff_hint(path: pathlib.Path, want: str, got: str) -> str:
    want_lines, got_lines = want.split("\n"), got.split("\n")
    for i, (a, b) in enumerate(zip(want_lines, got_lines), 1):
        if a != b:
            return f"line {i}\n  generated: {a[:160]}\n  on disk:   {b[:160]}"
    return f"length differs: generated {len(want_lines)} lines, on disk {len(got_lines)}"


def test_the_generated_files_exist():
    """A deleted contract.gen.ts/js is a FAILURE, not a pass-by-vacuity and not a skip: both files are
    checked in, and every consumer (webapp/mc, app/src/transport) imports from them directly."""
    missing = [str(p.relative_to(REPO)) for p in (TS_OUT, JS_OUT) if not p.is_file()]
    assert not missing, f"generated contract file(s) missing -- run `{COMMAND}`: {missing}"


def test_the_generated_contract_files_match_the_generator():
    """The freshness gate: a hand edit, or a source change nobody regenerated for, fails here."""
    stale = []
    for path, want in _render().items():
        got = path.read_text(encoding="utf-8") if path.exists() else "<file is missing>"
        if got != want:
            stale.append(f"{path.relative_to(REPO)}: {_diff_hint(path, want, got)}")
    assert not stale, (f"a generated contract file is stale -- run `{COMMAND}`:\n" + "\n".join(stale))


def _ts_js() -> tuple[str, str]:
    rendered = _render()
    return rendered[TS_OUT], rendered[JS_OUT]


# --------------------------------------------------------------------------------- floor tests --- #
# The freshness test above passes vacuously if the generator renders nothing useful and the files
# on disk happen to be equally empty. These pin a floor under what a real render must contain.

def test_the_ts_file_has_at_least_fifteen_interfaces():
    ts, _js = _ts_js()
    n = ts.count("export interface ")
    assert n >= 15, f"only {n} interfaces were generated -- the render lost most of types.py's TypedDicts"


def test_every_kind_mc_and_node_use_has_a_required_row_in_the_js():
    _ts, js = _ts_js()
    req_body = re.search(r"export const REQUIRED = \{(.*?)\n\};", js, re.S)
    assert req_body, "REQUIRED table missing from the generated JS"
    required_kinds = set(re.findall(r"^\s*([a-z_]+):", req_body.group(1), re.M))
    mc_kinds = set(re.findall(r"'([a-z_]+)'", re.search(r"MC_KINDS = new Set\(\[(.*?)\]\)", js, re.S).group(1)))
    node_kinds = set(re.findall(r"'([a-z_]+)'", re.search(r"NODE_KINDS = new Set\(\[(.*?)\]\)", js, re.S).group(1)))
    missing = (mc_kinds | node_kinds) - required_kinds
    assert not missing, f"these kinds have no REQUIRED row in the generated JS: {sorted(missing)}"


def test_possession_is_in_the_js_persisted_event_types():
    _ts, js = _ts_js()
    m = re.search(r"PERSISTED_EVENT_TYPES = new Set\(\[(.*?)\]\)", js, re.S)
    assert m, "PERSISTED_EVENT_TYPES missing from the generated JS"
    assert "'possession'" in m.group(1), "possession is missing from the JS PERSISTED_EVENT_TYPES"


def test_a_bare_dict_field_renders_as_record_string_unknown():
    ts, _js = _ts_js()
    assert "led?: Record<string, unknown>;" in ts, \
        "GameConfig.led (a bare `dict`) did not render as Record<string, unknown>"


def test_a_notrequired_field_renders_with_a_question_mark():
    ts, _js = _ts_js()
    assert "led?: Record<string, unknown>;" in ts       # NotRequired[dict]
    assert "player_num_base?: number;" in ts             # NotRequired[int]


def test_comments_travel_same_line_and_wrapped_continuation():
    ts, _js = _ts_js()
    assert "1..63 on the wire ($PSET token 1); 0 reserved" in ts, \
        "Player.player_num's same-line comment did not reach the generated TS"
    assert "the utility items MC armed for THIS game" in ts and "hand-armed fallback" in ts, \
        "GameConfig.stations's wrapped continuation comment did not reach the generated TS"


def test_a_literal_alias_renders_as_a_union_type():
    ts, _js = _ts_js()
    assert "export type ArmState = 'idle' | 'connected' | 'kitted' | 'lobby' | 'armed' | 'live';" in ts


def test_a_field_with_its_own_trailing_comment_keeps_an_unindented_run_below_it():
    """FrameBundle.cues has a same-line comment ("A6.3: key -> ...") followed by an EIGHT-line block
    ("game_over?, victory?, ..." through the A15.3 lines) with only single-space `#` indent -- no
    8-space continuation marker. That block describes `cues`, not the next field (`leds`), so it must
    land in cues' JSDoc even without the indent, because `cues` already has a trailing comment of its
    own. Regression for a real bug: the block used to be misread as `leds`' preface."""
    ts, _js = _ts_js()
    cues_i, leds_i = ts.index("cues: Record<string, string>;"), ts.index("leds?: Record<string, unknown[]>;")
    cues_block = ts[max(0, cues_i - 1500):cues_i]
    leds_block = ts[max(0, leds_i - 400):leds_i]
    assert "game_over?, victory?" in cues_block, "the game_over? paragraph did not land in cues' JSDoc"
    assert "game_over?, victory?" not in leds_block, "the game_over? paragraph leaked into leds' preface"
    assert "the tuned $GLED burst" in leds_block, "leds lost its own trailing comment"


def test_station_kinds_keep_source_order_not_sorted():
    """STATION_KINDS is a Python TUPLE, not a `set` -- its order is the advert-byte/UI mapping
    (types.py: "Mirrors `KIND` in app/src/beacon.js"), so it must be emitted as written, never
    alphabetized."""
    ts, js = _ts_js()
    assert "['respawn', 'powerup', 'extraction', 'bomb', 'control']" in ts
    js_block = re.search(r"STATION_KINDS = new Set\(\[(.*?)\]\)", js, re.S).group(1)
    ordered = [m for m in re.findall(r"'([a-z_]+)'", js_block)]
    assert ordered == ["respawn", "powerup", "extraction", "bomb", "control"], \
        f"STATION_KINDS was reordered in the JS: {ordered}"


def test_a_kind_vocabulary_type_name_that_collides_with_a_literal_alias_is_not_redeclared():
    """Once types.py grows a `StationKind = Literal[...]` alias (contract-dry-spec.md §3), the
    generator reuses that name for STATION_KINDS' companion type instead of inventing
    `StationKindId` -- but it must NOT also re-emit `export type StationKind = ...` for the kind
    vocabulary, or the two declarations collide (TS2300 "Duplicate identifier"). Exercises
    `_render_ts` directly with a synthetic model so this holds before that alias lands here."""
    mod = _load()
    fake_model = mod._Model(
        constants=[], literal_aliases=[("StationKind", ("respawn", "powerup"))],
        kind_sets=[("STATION_KINDS", "StationKind", ["respawn", "powerup"])],
        station_source_ids=[], interfaces=[], required={}, event_required={}, accept_min={},
    )
    ts = mod._render_ts(fake_model)
    assert ts.count("export type StationKind") == 1, \
        f"StationKind must be declared exactly once (got {ts.count('export type StationKind')}):\n{ts}"
    assert "export const STATION_KINDS = ['respawn', 'powerup'] as const;" in ts


def test_station_source_ids_get_a_const_array_and_type_in_ts_and_a_set_in_js():
    ts, js = _ts_js()
    assert "export const STATION_SOURCE_IDS = " in ts and "as const;" in ts
    assert "export type StationSourceId = typeof STATION_SOURCE_IDS[number];" in ts
    assert "export const STATION_SOURCE_IDS = new Set([" in js


def test_config_ttl_ms_is_emitted_for_the_app_to_import():
    """The app hard-codes `CONFIG_TTL_MS` today and is switching to importing it from here -- losing
    it from the render would be a silent regression for that migration, not a loud one."""
    ts, js = _ts_js()
    assert "export const CONFIG_TTL_MS = 1800000;" in ts
    assert "export const CONFIG_TTL_MS = 1800000;" in js


def test_the_generator_cannot_be_fooled_by_a_tuple_field():
    """Nothing on the wire is a tuple (spec contract-dry-spec.md §2.2) -- the mapper must refuse one
    loudly, naming the field, rather than emit something plausible-looking and wrong."""
    mod = _load()

    class _Probe(typing.TypedDict):
        pair: tuple[int, int]

    hints = typing.get_type_hints(_Probe, include_extras=True)
    try:
        mod._map_type(hints["pair"], f"{_Probe.__name__}.pair", {}, set())
    except mod.UnmappedType as e:
        assert "pair" in str(e), f"the error does not name the offending field: {e}"
        return
    raise AssertionError("the type mapper accepted a tuple field instead of raising")


# ----------------------------------------------------------------------- ACCEPT_MIN invariants --- #
# `_validate_accept_min` runs for real inside `render()` (so a bad ACCEPT_MIN in envelope.py fails
# the generator itself, not just a test); these two probe it directly with a synthetic bad table so
# each invariant is proven able to fail, not just assumed to hold because ACCEPT_MIN is `{}` today.

def test_accept_min_key_must_be_a_real_mc_kind():
    mod = _load()
    try:
        mod._validate_accept_min({"not_a_real_kind": ("x",)}, {"welcome", "result"}, {"not_a_real_kind": ("x",)})
    except mod.ContractInvariantError as e:
        assert "not_a_real_kind" in str(e), f"the error does not name the offending key: {e}"
        return
    raise AssertionError("accepted an ACCEPT_MIN key that is not in MC_KINDS")


def test_accept_min_fields_must_be_a_subset_of_required():
    mod = _load()
    try:
        mod._validate_accept_min({"result": ("match_id", "bogus_field")}, {"result"}, {"result": ("match_id",)})
    except mod.ContractInvariantError as e:
        assert "result" in str(e) and "bogus_field" in str(e), f"the error does not name the key/field: {e}"
        return
    raise AssertionError("accepted an ACCEPT_MIN field that REQUIRED does not promise")


def test_accept_min_matches_the_live_envelope_table_exactly():
    """Phase-agnostic (contract-dry-spec.md §3): whatever ACCEPT_MIN is on envelope.py right now --
    `{}` today, `{"result": ("match_id",)}` once the app lane's change lands -- the render must
    reproduce it byte-for-byte in BOTH files, built independently of the generator's own model via
    the same `getattr(envelope, "ACCEPT_MIN", {})` fallback the generator itself uses."""
    mod = _load()
    real_accept_min = getattr(_envelope, "ACCEPT_MIN", {})
    ts, js = _ts_js()
    assert mod._ts_table("ACCEPT_MIN", real_accept_min) in ts, \
        f"rendered TS ACCEPT_MIN does not match the live envelope.ACCEPT_MIN ({real_accept_min!r})"
    assert mod._js_table("ACCEPT_MIN", real_accept_min) in js, \
        f"rendered JS ACCEPT_MIN does not match the live envelope.ACCEPT_MIN ({real_accept_min!r})"


def test_accept_min_result_entry_when_present_is_match_id_only():
    """When ACCEPT_MIN is non-empty its `result` entry (the A24 case the table exists for) must
    render as exactly `['match_id']` in both files -- the sender's own REQUIRED for `result` is
    everything else, but the receiver only ever checks the one field A24 says must survive."""
    real_accept_min = getattr(_envelope, "ACCEPT_MIN", {})
    if "result" not in real_accept_min:
        return   # nothing to check until this phase -- covered by the exact-match test above regardless
    ts, js = _ts_js()
    assert "result: ['match_id']," in js
    assert "result: ['match_id']," in ts
