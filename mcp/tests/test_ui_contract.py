"""Contract test: does the Mission Control UI still take its shapes from the Python source?

The 18 wire shapes are no longer hand-mirrored: `mcp/tools/gen_contract.py` renders them into
`webapp/mc/src/api/contract.gen.ts`, `test_contract_generated.py` proves that file is fresh, and
`webapp/mc/src/api/types.ts` RE-EXPORTS them. So the six field-name comparisons this file used to run
(Player, GameConfig, SlotRule, LoadoutPolicy, LoadoutPool, PerkView) are superseded by the generator
itself -- a field can no longer be added on one side only. What replaces them is one structural test:
types.ts re-exports every generated shape and DECLARES none of them, which is the whole property the
old six were approximating.

What is still hand-mirrored, and so still checked here:
  * `webapp/mc/src/mock/policy.ts` / `screens/gameSummary.ts` `DEFAULT_POLICY()` vs `policy.py`'s
    default. `withPolicy()` falls back to it whenever a served config arrives with no
    `loadout_policy`, and the `ConfigView` type then calls the result valid -- so if the two defaults
    drift, the console hands the server a policy it would refuse and nothing says so.
  * `GET /api/voices` rows (a plain dict, no TypedDict to generate from).
  * `webapp/mc/src/mock/data.ts`'s weapon table vs `weapons.json`.

Both sides are read as plain text (`ast` for Python, small scanners for TypeScript) except
`policy.py`, which is imported -- it is dependency-free and imports cleanly under the system python,
the same call `test_contract_generated.py` makes. No TS parser dependency.

No pytest: plain test_* functions, run by run_tests.py under the system python.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
import sys

from _skip import Skipped

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mcp"))
from brx_mcp.mc import policy as _policy   # noqa: E402  -- dependency-free under bare system python

TYPES_PY = REPO / "mcp" / "brx_mcp" / "mc" / "types.py"
VOICES_PY = REPO / "mcp" / "brx_mcp" / "voices.py"
COMPILE_PY = REPO / "mcp" / "brx_mcp" / "mc" / "compile.py"
WEAPONS_JSON = REPO / "mcp" / "brx_mcp" / "mc" / "weapons.json"
TYPES_TS = REPO / "webapp" / "mc" / "src" / "api" / "types.ts"
CONTRACT_TS = REPO / "webapp" / "mc" / "src" / "api" / "contract.gen.ts"
SUMMARY_TS = REPO / "webapp" / "mc" / "src" / "screens" / "gameSummary.ts"
DATA_TS = REPO / "webapp" / "mc" / "src" / "mock" / "data.ts"


# ---------------------------------------------------------------------------
# Python side: field names, via `ast` -- never imports the server.
# ---------------------------------------------------------------------------
def _py_typeddict_fields(path: pathlib.Path, class_name: str) -> list[str]:
    """Annotated field names of `class <class_name>(TypedDict...)` in `path`."""
    if not path.is_file():
        raise Skipped(f"{path} (missing)")
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            fields = [stmt.target.id for stmt in node.body
                      if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name)]
            if not fields:
                raise Skipped(f"{class_name} in {path.name} (no annotated fields found -- renamed shape?)")
            return fields
    raise Skipped(f"class {class_name} in {path.name} (not found -- renamed or moved?)")


def _py_dict_literal_keys(path: pathlib.Path, func_name: str) -> set[str]:
    """Every string key that appears in a `dict`/dict-comprehension literal anywhere inside
    `def <func_name>(...)`. For the plain-dict shapes (voice options) that predate a TypedDict."""
    if not path.is_file():
        raise Skipped(f"{path} (missing)")
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func_name:
            keys: set[str] = set()
            for sub in ast.walk(node):
                if isinstance(sub, ast.Dict):
                    keys |= {k.value for k in sub.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)}
                elif isinstance(sub, ast.DictComp) and isinstance(sub.key, ast.Constant) and isinstance(sub.key.value, str):
                    keys.add(sub.key.value)
            if not keys:
                raise Skipped(f"{func_name}() in {path.name} (no dict-literal string keys found)")
            return keys
    raise Skipped(f"function {func_name} in {path.name} (not found -- renamed or moved?)")


# ---------------------------------------------------------------------------
# TypeScript side: field names of `interface Name { ... }`, textually.
# ---------------------------------------------------------------------------
_COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)


def _matching_brace(text: str, open_pos: int) -> int:
    """Index of the `}` that closes the `{` at `open_pos` (`text[open_pos] == '{'`)."""
    depth = 0
    for i in range(open_pos, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i
    raise ValueError("unbalanced braces")


def _interface_body(path: pathlib.Path, name: str) -> str:
    """The text between `interface <name> {` and its matching `}` (comments stripped first, so a
    stray brace inside a comment can never desync the scan)."""
    if not path.is_file():
        raise Skipped(f"{path} (missing)")
    text = _COMMENT.sub(" ", path.read_text(encoding="utf-8"))
    m = re.search(rf"\binterface\s+{re.escape(name)}\b[^{{]*\{{", text)
    if not m:
        raise Skipped(f"interface {name} in {path.name} (not found -- renamed or moved?)")
    open_pos = m.end() - 1
    close_pos = _matching_brace(text, open_pos)
    return text[open_pos + 1:close_pos]


def _ts_top_level_fields(body: str) -> list[str]:
    """Field names one level deep in an interface (or inline object-type) body. Depth-aware: a
    nested `effects: { a?: number; b?: number }` contributes only `effects`, never `a`/`b`."""
    fields: list[str] = []
    depth = 0
    chunk = ""
    for ch in body + ";":
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            depth -= 1
        if ch == ";" and depth == 0:
            m = re.match(r"\s*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:", chunk)
            if m:
                fields.append(m.group(1))
            chunk = ""
        else:
            chunk += ch
    return fields


def _ts_interface_fields(path: pathlib.Path, name: str) -> list[str]:
    return _ts_top_level_fields(_interface_body(path, name))


def _ts_nested_object_fields(path: pathlib.Path, interface_name: str, field_name: str) -> list[str]:
    """Fields of the inline object type on ONE field of an interface, e.g. `VoiceList.voices: {..}[]`."""
    body = _interface_body(path, interface_name)
    m = re.search(rf"\b{re.escape(field_name)}\s*\??\s*:\s*(?:\{{)", body)
    if not m:
        raise Skipped(f"{interface_name}.{field_name} in {path.name} (no inline object type found -- restructured?)")
    open_pos = m.end() - 1
    close_pos = _matching_brace(body, open_pos)
    return _ts_top_level_fields(body[open_pos + 1:close_pos])


# ---------------------------------------------------------------------------
def _assert_fields_match(shape: str, ts_fields, py_fields, ts_loc: str, py_loc: str) -> None:
    ts_set, py_set = set(ts_fields), set(py_fields)
    missing_in_ts = sorted(py_set - ts_set)
    missing_in_py = sorted(ts_set - py_set)
    msgs = []
    if missing_in_ts:
        msgs.append(f"{shape}: {py_loc} has {missing_in_ts} that {ts_loc} does not declare")
    if missing_in_py:
        msgs.append(f"{shape}: {ts_loc} declares {missing_in_py} that {py_loc} does not have")
    assert not msgs, "; ".join(msgs)


def test_types_ts_re_exports_the_generated_shapes_and_declares_none_of_them():
    """`types.ts` is a RE-EXPORT of `contract.gen.ts`, never a second copy of it.

    This supersedes the six per-shape field comparisons this file used to run. They existed because
    the wire shapes were hand-mirrored; they are generated now, so the only way the console can drift
    from the server again is by declaring a shape of its own that SHADOWS the generated one -- which
    compiles, and which no type error would ever point at. Both halves are asserted: every generated
    name is re-exported (a shape the generator adds cannot go unpublished), and none is re-declared.
    """
    if not CONTRACT_TS.is_file():
        raise Skipped(f"{CONTRACT_TS} (missing -- run python3 mcp/tools/gen_contract.py)")
    if not TYPES_TS.is_file():
        raise Skipped(f"{TYPES_TS} (missing)")
    gen = CONTRACT_TS.read_text(encoding="utf-8")
    generated = set(re.findall(r"^export interface (\w+)", gen, re.M))
    generated |= set(re.findall(r"^export type (\w+)", gen, re.M))
    if len(generated) < 15:
        raise Skipped(f"only {len(generated)} shapes in {CONTRACT_TS.name} (restructured?)")

    text = TYPES_TS.read_text(encoding="utf-8")
    declared = set(re.findall(r"^export (?:interface|type) (\w+)", text, re.M))
    # every `export type { A, B } from './contract.gen'` / `export { X } from './contract.gen'` body
    re_exported: set[str] = set()
    for body in re.findall(r"^export(?:\s+type)?\s*\{([^}]*)\}\s*from\s*'\./contract\.gen'", text, re.M | re.S):
        for part in body.split(","):
            name = part.strip().split(" as ")[0].strip()
            if name:
                re_exported.add(name)

    missing = sorted(generated - re_exported)
    shadowed = sorted(generated & declared)
    msgs = []
    if missing:
        msgs.append(f"{TYPES_TS} does not re-export the generated {missing} "
                    f"(add them to the `from './contract.gen'` block)")
    if shadowed:
        msgs.append(f"{TYPES_TS} DECLARES {shadowed}, which {CONTRACT_TS.name} already generates -- "
                    f"delete the local copy and re-export instead")
    assert not msgs, "; ".join(msgs)


# ---------------------------------------------------------------------------
# `DEFAULT_POLICY()` (gameSummary.ts) vs `policy.default_policy()` -- still hand-mirrored.
# ---------------------------------------------------------------------------
_TS_KEY = re.compile(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*:")


_TS_SPREAD = re.compile(r"\.\.\.([A-Za-z_$][A-Za-z0-9_$]*)")


def _ts_object(text: str, start: int) -> tuple[dict, int]:
    """Evaluate the TS object literal whose `{` is at `text[start]`. Handles exactly the grammar
    `gameSummary.ts`'s rule helpers use: string / boolean / null values, string arrays, nested
    object literals, and a trailing `...identifier` spread (recorded as key `"...identifier"` with
    value `None` -- callers that need to tolerate it, e.g. `rule()`'s `...over`, pop it back out).
    Anything else is a genuine parser gap, not a renamed or missing shape, so it fails the test
    loudly (`AssertionError`) instead of skipping -- a skip here previously hid the fact that this
    very test never ran (2026-09-12)."""
    assert text[start] == "{"
    i, out = start + 1, {}
    while True:
        while i < len(text) and text[i] in " \n\r\t,":
            i += 1
        if i >= len(text):
            raise AssertionError(f"an unterminated object literal in gameSummary.ts near {text[start:start + 40]!r}")
        if text[i] == "}":
            return out, i + 1
        m_spread = _TS_SPREAD.match(text, i)
        if m_spread:
            out[f"...{m_spread.group(1)}"] = None
            i = m_spread.end()
            continue
        m = _TS_KEY.match(text, i)
        if not m:
            raise AssertionError(f"an unparsable entry in gameSummary.ts near {text[i:i + 40]!r}")
        key, i = m.group(1), m.end()
        while text[i] == " ":
            i += 1
        if text[i] == "{":
            out[key], i = _ts_object(text, i)
        elif text[i] == "[":
            j = text.index("]", i)
            out[key] = [x.strip().strip("'\"") for x in text[i + 1:j].split(",") if x.strip()]
            i = j + 1
        else:
            j = min((k for k in (text.find(",", i), text.find("}", i)) if k != -1), default=-1)
            raw = text[i:j].strip()
            i = j
            if raw in ("true", "false"):
                out[key] = raw == "true"
            elif raw == "null":
                out[key] = None
            elif raw.startswith(("'", '"')):
                out[key] = raw[1:-1]
            else:
                raise AssertionError(f"an unparsable value for {key!r} in gameSummary.ts: {raw!r}")


def _ts_call_object(text: str, decl: str) -> dict:
    """The object literal in `const <decl> = ... => ({ ... })`."""
    m = re.search(rf"const {re.escape(decl)}\s*=.*?=>\s*\(?\s*(?=\{{)", text, re.S)
    if not m:
        raise Skipped(f"`const {decl}` in gameSummary.ts (renamed or restructured?)")
    obj, _ = _ts_object(text, m.end())
    return obj


def _ts_default_policy() -> dict:
    """`DEFAULT_POLICY()` from gameSummary.ts, with `rule()` / `perkRule()` expanded."""
    if not SUMMARY_TS.is_file():
        raise Skipped(f"{SUMMARY_TS} (missing)")
    text = _COMMENT.sub(" ", SUMMARY_TS.read_text(encoding="utf-8"))
    rule = _ts_call_object(text, "rule")
    rule.pop("...over", None)
    # `perkRule = (over = {}) => rule({ kinds: ['perk'], ...over })`
    m = re.search(r"const perkRule\s*=.*?rule\(\s*(?=\{)", text, re.S)
    if not m:
        raise Skipped("`const perkRule` in gameSummary.ts (renamed or restructured?)")
    perk_over, _ = _ts_object(text, m.end())
    perk_over.pop("...over", None)
    perk_rule = {**rule, **perk_over}

    m = re.search(r"const DEFAULT_POLICY\s*=.*?=>\s*\(\s*(?=\{)", text, re.S)
    if not m:
        raise Skipped("`const DEFAULT_POLICY` in gameSummary.ts (renamed or restructured?)")
    end = _matching_brace(text, m.end())
    body = text[m.end() + 1:end]
    out: dict = {}
    for key, val in re.findall(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([^,}]+)", body):
        val = val.strip()
        if val == "rule()":
            out[key] = dict(rule)
        elif val == "perkRule()":
            out[key] = dict(perk_rule)
        elif val in ("true", "false"):
            out[key] = val == "true"
        elif val.startswith(("'", '"')):
            out[key] = val[1:-1]
        else:
            # A found DEFAULT_POLICY with a value shape our scanner doesn't know is a parser gap,
            # not a rename -- fail loudly rather than skipping the comparison silently.
            raise AssertionError(f"DEFAULT_POLICY.{key} is {val!r} in gameSummary.ts -- not a plain rule() call any more")
    return out


def test_default_policy_matches_the_server_default():
    """`gameSummary.DEFAULT_POLICY()` must equal `policy.default_policy()` field for field.

    It is not decoration. `withPolicy()` substitutes this object whenever a config reaches the store
    with no `loadout_policy` (a session persisted before A10, an older MC), and `ConfigView` then
    types the result as a complete config -- so a drift here is a policy the SERVER would refuse
    travelling through the console with the type system calling it valid. `default_policy` takes the
    mode because `ffa` defaults to NO HEAVIES; the console's fallback is the mode-independent OPEN
    one, which is what every other mode resolves to."""
    ts = _ts_default_policy()
    py = _policy.default_policy("tdm")          # MODE_DEFAULT_PRESET has no tdm entry -> the "open" rules
    assert py.get("preset") == "open", f"policy.default_policy('tdm') is no longer the OPEN preset: {py.get('preset')!r}"
    msgs = []
    for k in sorted(set(py) | set(ts)):
        if k not in ts:
            msgs.append(f"DEFAULT_POLICY() has no {k!r}, which policy.py's default sets to {py[k]!r}")
        elif k not in py:
            msgs.append(f"DEFAULT_POLICY() sets {k!r}={ts[k]!r}, which policy.py's default does not have")
        elif ts[k] != py[k]:
            msgs.append(f"DEFAULT_POLICY().{k} is {ts[k]!r}, policy.py's default is {py[k]!r}")
    assert not msgs, ("webapp/mc/src/screens/gameSummary.ts DEFAULT_POLICY() has drifted from "
                      "mcp/brx_mcp/mc/policy.py default_policy(): " + "; ".join(msgs))


def test_voice_option_fields_match():
    """`VoiceList.voices[]` (types.ts) vs the dicts `GET /api/voices` actually returns: the base
    shape built by `voices.options()`, plus the `kill_line` key `compile.voice_options()` adds on
    top (mc/api.py `voices` route). A15 added `voice_slots` to Player around the same time this
    endpoint's shape (`speaker`, `lines`) grew -- the two are checked separately here."""
    ts = _ts_nested_object_fields(TYPES_TS, "VoiceList", "voices")
    py = _py_dict_literal_keys(VOICES_PY, "options") | _py_dict_literal_keys(COMPILE_PY, "voice_options")
    _assert_fields_match("VoiceList.voices[]", ts, sorted(py),
                          f"{TYPES_TS} (VoiceList.voices)",
                          f"{VOICES_PY} options() + {COMPILE_PY} voice_options()")


def test_weapon_ids_match_weapons_json():
    """`webapp/mc/src/mock/data.ts`'s weapon table is GENERATED from `weapons.json` -- the visible
    (non-`hidden`) weapon ids on both sides must be exactly the same set.

    2026-09-12: the table used to be a `const RAW = [...] as const;` the UI re-mapped by hand, and this
    scan was keyed to that name. `mcp/tools/gen_ui_catalog.py` now emits the finished `WEAPONS` array
    between `// GENERATED-START weapons` markers, so the scan reads the marked block instead."""
    if not WEAPONS_JSON.is_file():
        raise Skipped(f"{WEAPONS_JSON} (missing)")
    catalog = json.loads(WEAPONS_JSON.read_text(encoding="utf-8"))
    py_ids = {w["weapon_id"] for w in catalog.get("weapons", []) if not w.get("hidden")}
    if not py_ids:
        raise Skipped(f"weapon ids in {WEAPONS_JSON} (catalog empty or restructured?)")

    if not DATA_TS.is_file():
        raise Skipped(f"{DATA_TS} (missing)")
    text = DATA_TS.read_text(encoding="utf-8")
    m = re.search(r"// GENERATED-START weapons(.*?)// GENERATED-END weapons", text, re.S)
    if not m:
        raise Skipped(f"the GENERATED weapons block in {DATA_TS} (not found -- renamed or restructured?)")
    ts_ids = set(re.findall(r'"weapon_id"\s*:\s*"([a-z_0-9]+)"', m.group(1)))
    if not ts_ids:
        raise Skipped(f"weapon_id entries inside the generated block in {DATA_TS}")

    missing_in_ts = sorted(py_ids - ts_ids)
    missing_in_py = sorted(ts_ids - py_ids)
    msgs = []
    if missing_in_ts:
        msgs.append(f"weapon ids in {WEAPONS_JSON} missing from {DATA_TS}'s generated table: {missing_in_ts}")
    if missing_in_py:
        msgs.append(f"weapon ids in {DATA_TS}'s generated table not in {WEAPONS_JSON}: {missing_in_py}")
    assert not msgs, "; ".join(msgs)
