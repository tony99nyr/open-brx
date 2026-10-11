"""Every language-neutral case file in app/test/fixtures/ has a key-set schema, and validates against it.

Each runner (JS, Python, C++) reads only the keys it knows. A mistyped key (`"expcet"` for `"expect"`, `"valid_id"`
for `"valid_ids"`) is therefore ignored by all of them, and the case asserts nothing. `case-schemas.json` pins the
exact key set of each file, so such a case fails here. The schemas use a small JSON Schema subset: type, required,
properties, additionalProperties, items, enum (type-strict), oneOf, minItems, minProperties. The validator below implements exactly that subset."""
from __future__ import annotations

import copy
import json
import pathlib

FIXTURES = pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures"
SCHEMAS = json.loads((FIXTURES / "case-schemas.json").read_text(encoding="utf-8"))["schemas"]
# Every JSON file in fixtures/ is a shared case file unless it is listed here (generated HUD goldens, the MC proof vector,
# the schema itself), so a new case file named any way at all needs a schema.
NOT_CASE_FILES = {"case-schemas.json", "hud-dom-golden.json", "hud-html-golden.json", "hud-html-states.json", "mc-proof-vector.json"}
PENDING: set[str] = set()   # a schema whose fixture has not landed yet; empty since A4 brought station-config-cases.json
KEYWORDS = {"type", "required", "properties", "additionalProperties", "items", "enum", "oneOf", "minItems", "minProperties"}


def _is(value, name: str) -> bool:
    if name == "object":
        return isinstance(value, dict)
    if name == "array":
        return isinstance(value, list)
    if name == "string":
        return isinstance(value, str)
    if name == "boolean":
        return isinstance(value, bool)
    if name == "null":
        return value is None
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    raise AssertionError(f"unknown type name {name!r}")


def errors(value, schema: dict, path: str = "$") -> list[str]:
    """Every way `value` breaks `schema`, as readable lines. An empty list means it validates."""
    unknown = set(schema) - KEYWORDS
    assert not unknown, f"{path}: the schema uses keywords outside the subset: {sorted(unknown)}"
    out: list[str] = []
    if "type" in schema:
        names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_is(value, n) for n in names):
            return [f"{path}: expected {names}, got {type(value).__name__}"]
    # type-strict: Python's True == 1 must not let a boolean through an integer enum
    if "enum" in schema and not any(type(value) is type(e) and value == e for e in schema["enum"]):
        out.append(f"{path}: {value!r} is not one of {schema['enum']}")
    if "oneOf" in schema:
        hits = [s for s in schema["oneOf"] if not errors(value, s, path)]
        if len(hits) != 1:
            out.append(f"{path}: matches {len(hits)} of {len(schema['oneOf'])} alternatives")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        out += [f"{path}: missing required key {k!r}" for k in schema.get("required", []) if k not in value]
        extra = schema.get("additionalProperties", True)
        for k, v in value.items():
            if k in props:
                out += errors(v, props[k], f"{path}.{k}")
            elif extra is False:
                out.append(f"{path}: unknown key {k!r}")
            elif isinstance(extra, dict):
                out += errors(v, extra, f"{path}.{k}")
    if isinstance(value, dict) and len(value) < schema.get("minProperties", 0):
        out.append(f"{path}: {len(value)} keys, at least {schema['minProperties']} needed")
    if isinstance(value, list) and len(value) < schema.get("minItems", 0):
        out.append(f"{path}: {len(value)} items, at least {schema['minItems']} needed")
    if isinstance(value, list) and "items" in schema:
        for i, v in enumerate(value):
            out += errors(v, schema["items"], f"{path}[{i}]")
    return out


def _load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _fixture_files() -> list[str]:
    return sorted(p.name for p in FIXTURES.glob("*.json") if p.name not in NOT_CASE_FILES)


def _misspell_first_key(case: dict) -> dict:
    out = {}
    for i, (k, v) in enumerate(case.items()):
        out[k + "x" if i == 0 else k] = v
    return out


def test_every_case_file_has_a_schema_and_every_schema_has_a_file():
    files = set(_fixture_files())
    assert not files - set(SCHEMAS), f"case files without a schema: {sorted(files - set(SCHEMAS))}"
    absent = set(SCHEMAS) - files
    assert absent <= PENDING, f"schemas naming a file that does not exist: {sorted(absent - PENDING)}"
    assert not PENDING & files, f"{sorted(PENDING & files)} has landed: remove it from PENDING so it is checked"
    assert files, "control: the folder has case files"


def test_every_case_file_validates():
    for name in _fixture_files():
        errs = errors(_load(name), SCHEMAS[name])
        assert not errs, (name, errs[:5])


def test_the_validator_catches_an_unknown_key_a_missing_key_and_a_wrong_type():
    schema = {"type": "object", "required": ["expect"], "additionalProperties": False,
              "properties": {"expect": {"type": "integer"}, "tags": {"type": "array", "items": {"type": "string"}},
                             "mode": {"enum": ["a", "b"]}}}
    assert errors({"expect": 1, "tags": ["x"], "mode": "a"}, schema) == []
    assert errors({"expect": 1, "expcet": 1}, schema), "an unknown key must fail"
    assert errors({"expcet": 1}, schema), "a missing required key must fail"
    assert errors({"expect": "1"}, schema), "a wrong type must fail"
    assert errors({"expect": True}, schema), "a boolean is not an integer"
    assert errors({"expect": 1, "tags": [3]}, schema), "a wrong item type must fail"
    assert errors({"expect": 1, "mode": "c"}, schema), "a value outside the enum must fail"
    one = {"oneOf": [{"type": "object", "required": ["a"], "additionalProperties": False, "properties": {"a": {}}},
                     {"type": "object", "required": ["b"], "additionalProperties": False, "properties": {"b": {}}}]}
    assert errors({"a": 1}, one) == [] and errors({"b": 1}, one) == []
    assert errors({"a": 1, "b": 1}, one) and errors({"c": 1}, one), "oneOf takes exactly one alternative"
    assert errors({"x": 1}, {"type": "object", "additionalProperties": {"type": "integer"}}) == []
    assert errors({"x": "1"}, {"type": "object", "additionalProperties": {"type": "integer"}})


def test_a_misspelt_first_key_in_any_real_case_fails():
    """Case by case, over every list of objects at the top of every file, so no file and no case is skipped."""
    tried = 0
    for name in _fixture_files():
        doc = _load(name)
        for field, rows in doc.items():
            if not (isinstance(rows, list) and rows and all(isinstance(r, dict) for r in rows)):
                continue
            for i, row in enumerate(rows):
                bad = copy.copy(doc)
                bad[field] = rows[:i] + [_misspell_first_key(row)] + rows[i + 1:]
                assert errors(bad, SCHEMAS[name]), f"{name}: {field}[{i}] with a misspelt first key still validates"
                tried += 1
        # the top level too: a misspelt first key of the file itself
        assert errors(_misspell_first_key(doc), SCHEMAS[name]), f"{name}: a misspelt top-level key still validates"
    assert tried >= 250, f"control: only {tried} mutated cases were tried"


def test_the_schemas_use_only_the_subset():
    def walk(s, where):
        assert set(s) <= KEYWORDS, (where, sorted(set(s) - KEYWORDS))
        for k, v in s.get("properties", {}).items():
            walk(v, f"{where}.{k}")
        if isinstance(s.get("additionalProperties"), dict):
            walk(s["additionalProperties"], where + ".*")
        if "items" in s:
            walk(s["items"], where + "[]")
        for j, a in enumerate(s.get("oneOf", [])):
            walk(a, f"{where}|{j}")
    for name, s in SCHEMAS.items():
        walk(s, name)



def test_a_runner_list_or_checkpoint_that_runs_or_asserts_nothing_fails():
    """Codex r1: `runners: ["appp"]`, `only: []` and a checkpoint holding only its `t` all validated and ran nowhere."""
    adv = _load("advert-vectors.json")
    bad = copy.deepcopy(adv); bad["variants"][0]["runners"] = ["appp"]
    assert errors(bad, SCHEMAS["advert-vectors.json"])
    pu = _load("powerup-station-cases.json")
    bad = copy.deepcopy(pu); bad["cases"][0]["only"] = []
    assert errors(bad, SCHEMAS["powerup-station-cases.json"])
    ph = _load("presence-hill-cases.json")
    bad = copy.deepcopy(ph); bad["cases"][0]["expect"][0] = {"t": bad["cases"][0]["expect"][0]["t"]}
    assert errors(bad, SCHEMAS["presence-hill-cases.json"])
    pol = _load("policy-cases.json")
    bad = copy.deepcopy(pol); bad["perks"][0]["effects"] = {"switch_mulx": 0.5}
    assert errors(bad, SCHEMAS["policy-cases.json"])
    assert errors(True, {"enum": [1]}), "a boolean is not the integer 1"



def test_a_powerup_case_carries_the_block_its_runners_read():
    """Opus r1: `only: ["mc"]` with no `mc` block validates but runs nowhere (test_powerup_cases_mc.py needs `mc`, and
    the phone and Stick runners skip it). The schema subset cannot say it, so this does."""
    doc = _load("powerup-station-cases.json")
    bad = [c.get("name") for c in doc["cases"] if c.get("only") == ["mc"] and "mc" not in c]
    assert not bad, bad
    # and the mirror: a case that names only the phone and/or the Stick runs `steps`, so it must carry them
    bad = [c.get("name") for c in doc["cases"] if c.get("only") and "mc" not in c["only"] and not c.get("steps")]
    assert not bad, bad
