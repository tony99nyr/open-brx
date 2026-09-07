"""Contract test: does the Mission Control UI's hand-mirrored TypeScript still match the Python
source of truth it claims to mirror?

`webapp/mc/src/api/types.ts` says at its own top "Mirrors mcp/brx_mcp/mc/API.md + types.py ...
Keep field names identical" -- in a COMMENT. `webapp/mc/src/mock/policy.ts` says it mirrors
`mcp/brx_mcp/mc/policy.py`. `webapp/mc/src/mock/data.ts` says its weapon table is GENERATED from
`mcp/brx_mcp/mc/weapons.json`. Nothing checks any of that: the two sides can drift silently (a field
added on the Python TypedDict, a weapon added to the JSON catalog) and only a human re-reading both
files side by side would ever notice.

This test parses the Python side with `ast` (TypedDict field names; dict-literal keys for the two
plain-dict shapes that predate a TypedDict) and the TypeScript side with a small depth-aware brace
scanner (an `interface Foo { ... }` body, top-level fields only -- a nested inline object type like
PerkView.effects does not leak its own keys in as top-level fields). No TS parser dependency, and the
Python server is never imported -- both sides are read as plain text, so this stays dependency-free
under the system python (see mcp/run_tests.py, mcp/tests/_skip.py).

No pytest: plain test_* functions, run by run_tests.py under the system python.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re

from _skip import Skipped

REPO = pathlib.Path(__file__).resolve().parents[2]
TYPES_PY = REPO / "mcp" / "brx_mcp" / "mc" / "types.py"
VOICES_PY = REPO / "mcp" / "brx_mcp" / "voices.py"
COMPILE_PY = REPO / "mcp" / "brx_mcp" / "mc" / "compile.py"
WEAPONS_JSON = REPO / "mcp" / "brx_mcp" / "mc" / "weapons.json"
TYPES_TS = REPO / "webapp" / "mc" / "src" / "api" / "types.ts"
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


def test_player_fields_match():
    ts = _ts_interface_fields(TYPES_TS, "Player")
    py = _py_typeddict_fields(TYPES_PY, "Player")
    _assert_fields_match("Player", ts, py, str(TYPES_TS), str(TYPES_PY))


def test_gameconfig_fields_match():
    ts = _ts_interface_fields(TYPES_TS, "GameConfig")
    py = _py_typeddict_fields(TYPES_PY, "GameConfig")
    _assert_fields_match("GameConfig", ts, py, str(TYPES_TS), str(TYPES_PY))


def test_slotrule_fields_match():
    ts = _ts_interface_fields(TYPES_TS, "SlotRule")
    py = _py_typeddict_fields(TYPES_PY, "SlotRule")
    _assert_fields_match("SlotRule", ts, py, str(TYPES_TS), str(TYPES_PY))


def test_loadoutpolicy_fields_match():
    ts = _ts_interface_fields(TYPES_TS, "LoadoutPolicy")
    py = _py_typeddict_fields(TYPES_PY, "LoadoutPolicy")
    _assert_fields_match("LoadoutPolicy", ts, py, str(TYPES_TS), str(TYPES_PY))


def test_loadoutpool_fields_match():
    ts = _ts_interface_fields(TYPES_TS, "LoadoutPool")
    py = _py_typeddict_fields(TYPES_PY, "LoadoutPool")
    _assert_fields_match("LoadoutPool", ts, py, str(TYPES_TS), str(TYPES_PY))


def test_perkview_fields_match():
    ts = _ts_interface_fields(TYPES_TS, "PerkView")
    py = _py_typeddict_fields(TYPES_PY, "PerkView")
    _assert_fields_match("PerkView", ts, py, str(TYPES_TS), str(TYPES_PY))


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
    """`webapp/mc/src/mock/data.ts`'s `RAW` weapon table says it is GENERATED from `weapons.json` --
    the visible (non-`hidden`) weapon ids on both sides must be exactly the same set."""
    if not WEAPONS_JSON.is_file():
        raise Skipped(f"{WEAPONS_JSON} (missing)")
    catalog = json.loads(WEAPONS_JSON.read_text(encoding="utf-8"))
    py_ids = {w["weapon_id"] for w in catalog.get("weapons", []) if not w.get("hidden")}
    if not py_ids:
        raise Skipped(f"weapon ids in {WEAPONS_JSON} (catalog empty or restructured?)")

    if not DATA_TS.is_file():
        raise Skipped(f"{DATA_TS} (missing)")
    text = DATA_TS.read_text(encoding="utf-8")
    m = re.search(r"const RAW\s*=\s*\[(.*?)\]\s*as const;", text, re.S)
    if not m:
        raise Skipped(f"RAW weapon array in {DATA_TS} (not found -- renamed or restructured?)")
    ts_ids = set(re.findall(r'"weapon_id"\s*:\s*"([a-z_0-9]+)"', m.group(1)))
    if not ts_ids:
        raise Skipped(f"weapon_id entries inside RAW in {DATA_TS}")

    missing_in_ts = sorted(py_ids - ts_ids)
    missing_in_py = sorted(ts_ids - py_ids)
    msgs = []
    if missing_in_ts:
        msgs.append(f"weapon ids in {WEAPONS_JSON} missing from {DATA_TS}'s RAW table: {missing_in_ts}")
    if missing_in_py:
        msgs.append(f"weapon ids in {DATA_TS}'s RAW table not in {WEAPONS_JSON}: {missing_in_py}")
    assert not msgs, "; ".join(msgs)
