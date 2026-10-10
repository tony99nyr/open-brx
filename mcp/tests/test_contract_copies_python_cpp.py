"""The generated contract (mcp/tools/gen_contract.py) is the one copy of every shared constant. The phone side is
checked by app/test/contract-copies.test.mjs; this file checks the Python and C++ sides: no Python module outside
the constant's own source holds an equal list, tuple or distinctive string literal, and no Stick source outside the
generated header restates a shared string. (2026-10-04 cross-lane review #15: fakes.py restated PANIC_SEQUENCE.)"""
import ast
import importlib
import pathlib
import re
import sys

MCP = pathlib.Path(__file__).resolve().parents[1]
REPO = MCP.parent
sys.path.insert(0, str(MCP))
SOURCES = {"brx_mcp/mc/types.py", "brx_mcp/mc/envelope.py", "brx_mcp/protocol.py"}   # where the values are defined


def _exported() -> dict:
    js = (REPO / "app" / "src" / "transport" / "contract.gen.js").read_text(encoding="utf-8")
    names = set(re.findall(r"^export const ([A-Z][A-Z0-9_]*)\b", js, re.M))
    out = {}
    for mod in ("brx_mcp.mc.types", "brx_mcp.mc.envelope", "brx_mcp.protocol"):
        m = importlib.import_module(mod)
        out.update({n: getattr(m, n) for n in names if hasattr(m, n)})
    return out


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _distinctive(value) -> bool:
    """A value worth guarding: a sequence of strings, or a string long or odd enough not to collide by chance."""
    if isinstance(value, (list, tuple)):
        return bool(value) and all(isinstance(v, str) for v in value)
    return isinstance(value, str) and (len(value) >= 12 or "$" in value)


def _structural(value) -> bool:
    """Seams batch A: the advert layout tables. A dict of name -> int, a set of ints, or a tuple of 3+ ints."""
    if isinstance(value, dict):
        return len(value) >= 2 and all(isinstance(k, str) and _is_int(v) for k, v in value.items())
    if isinstance(value, (set, frozenset)):
        return len(value) >= 3 and all(_is_int(v) for v in value)
    return isinstance(value, (list, tuple)) and len(value) >= 3 and all(_is_int(v) for v in value)


def python_copies(root: pathlib.Path, exported: dict, skip: set[str]) -> list[str]:
    wanted = {n: (list(v) if isinstance(v, (list, tuple)) else v) for n, v in exported.items() if _distinctive(v)}
    shapes = {n: v for n, v in exported.items() if _structural(v)}
    hits = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root).as_posix()
        if rel in skip:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, (ast.Dict, ast.Set)):
                try:
                    val = ast.literal_eval(node)
                except (ValueError, SyntaxError):
                    continue
                for name, want in shapes.items():
                    if val == (dict(want) if isinstance(want, dict) else set(want)):
                        hits.append(f"{rel}:{node.lineno} restates {name}")
            if isinstance(node, (ast.List, ast.Tuple)):   # an int sequence, or a tuple/list of the set's members
                try:
                    val = ast.literal_eval(node)
                except (ValueError, SyntaxError):
                    continue
                for name, want in shapes.items():
                    if isinstance(want, (list, tuple)) and list(val) == list(want):
                        hits.append(f"{rel}:{node.lineno} restates {name}")
                    elif (isinstance(want, (set, frozenset)) and len(val) == len(want) and all(_is_int(x) for x in val)
          and set(val) == set(want)):
                        hits.append(f"{rel}:{node.lineno} restates {name}")
            if isinstance(node, (ast.List, ast.Tuple, ast.Constant)):
                try:
                    val = ast.literal_eval(node)
                except (ValueError, SyntaxError):
                    continue
                val = list(val) if isinstance(val, (list, tuple)) else val
                for name, want in wanted.items():
                    if val == want:
                        hits.append(f"{rel}:{node.lineno} restates {name}")
    return hits


def cpp_copies(root: pathlib.Path, exported: dict) -> list[str]:
    strings = {n: v for n, v in exported.items() if isinstance(v, str) and _distinctive(v)}
    seqs = {n: v for n, v in exported.items() if isinstance(v, (list, tuple)) and _distinctive(v)}
    hits = []
    for path in sorted([*root.glob("*.h"), *root.glob("*.cpp"), *root.glob("*.ino")]):
        if path.name == "contract.gen.h":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        literals = re.findall(r'"((?:[^"\\]|\\.)*)"', text)
        for name, v in strings.items():
            if v in literals:
                hits.append(f"{path.name} restates {name}")
        # A sequence is restated only as a brace list of the same strings in order; one token in use is not a copy.
        lists = [re.findall(r'"((?:[^"\\]|\\.)*)"', body) for body in re.findall(r"\{([^{}]*)\}", text)]
        for name, v in seqs.items():
            if any(items == list(v) for items in lists):
                hits.append(f"{path.name} restates {name} as a list")
        # An int brace list ({0x4f, 0x42, 0x52, 0x58}, {0, 1, 3}) that equals a generated int sequence or set.
        for body in re.findall(r"\{([^{}]*)\}", text):
            try:
                nums = [int(t.strip(), 0) for t in body.split(",") if t.strip()]
            except ValueError:
                continue
            for name, v in exported.items():
                if _structural(v) and not isinstance(v, dict) and len(nums) == len(v) and (
                        nums == list(v) if isinstance(v, (list, tuple)) else set(nums) == set(v)):
                    hits.append(f"{path.name} restates {name} as an int list")
    return hits


def test_no_python_module_restates_a_generated_constant():
    hits = python_copies(MCP, _exported(), SOURCES | {"tools/gen_contract.py"})
    hits = [h for h in hits if not h.startswith("tests/")]   # tests may pin a value on purpose
    assert not hits, hits


def test_no_stick_source_restates_a_generated_string():
    assert not cpp_copies(REPO / "hardware" / "m5sticks3", _exported()), cpp_copies(REPO / "hardware" / "m5sticks3", _exported())


def test_the_scan_finds_a_planted_copy():
    import tempfile
    exported = {"PANIC_SEQUENCE": ["$CLEAR,*", "$SP,99,*"]}
    with tempfile.TemporaryDirectory() as d:
        (pathlib.Path(d) / "fake.py").write_text('frames = {"panic": ["$CLEAR,*", "$SP,99,*"]}\n')
        assert python_copies(pathlib.Path(d), exported, set()) == ["fake.py:1 restates PANIC_SEQUENCE"]
        (pathlib.Path(d) / "x.h").write_text('if (k == "$CLEAR,*") {} const char* p[] = {"$CLEAR,*", "$SP,99,*"};\n')
        assert cpp_copies(pathlib.Path(d), exported) == ["x.h restates PANIC_SEQUENCE as a list"]


def test_the_scan_finds_a_planted_advert_layout_copy():
    import tempfile
    exported = {"ADVERT_ROLE": {"station": 1, "player": 2}, "HILL_CLAIMABLE_TIDS": frozenset({0, 1, 3}),
                "ADVERT_MAGIC": (79, 66, 82, 88)}
    with tempfile.TemporaryDirectory() as d:
        (pathlib.Path(d) / "a.py").write_text('R = {"station": 1, "player": 2}\nT = (0, 1, 3)\nM = bytes((0x4F, 0x42, 0x52, 0x58))\n')
        assert sorted(python_copies(pathlib.Path(d), exported, set())) == [
            "a.py:1 restates ADVERT_ROLE", "a.py:2 restates HILL_CLAIMABLE_TIDS", "a.py:3 restates ADVERT_MAGIC"]
        (pathlib.Path(d) / "x.h").write_text("const uint8_t b[] = {0x4f, 0x42, 0x52, 0x58};\n")
        assert cpp_copies(pathlib.Path(d), exported) == ["x.h restates ADVERT_MAGIC as an int list"]


# Seams A polish round 1: a name the firmware or a Python module keeps for a generated value must be BOUND to it.
# A same-value literal (`VERSION = 1`, `PLAYER_REVIVED = 64`) passes every behaviour test until the contract moves.
CPP_ALIASES = {
    "brx_advert.h": {
        "ADVERT_VERSION": "ADVERT_VERSION", "ROLE_STATION": "ADVERT_ROLE_STATION", "ROLE_PLAYER": "ADVERT_ROLE_PLAYER",
        "CONTROL_HELD": "ADVERT_CONTROL_STATE_HELD", "CONTROL_CONTESTED": "ADVERT_CONTROL_STATE_CONTESTED",
        "CONTROL_RISING": "ADVERT_CONTROL_STATE_RISING", "CONTROL_FALLING": "ADVERT_CONTROL_STATE_FALLING",
        "PLAYER_CLAIMING": "ADVERT_PLAYER_STATE_CLAIMING", "PLAYER_CLAIM_READY": "ADVERT_PLAYER_STATE_CLAIM_READY",
        "PLAYER_REVIVED": "ADVERT_PLAYER_STATE_REVIVED"},
    "presence.h": {"PLAYER_ALIVE": "ADVERT_PLAYER_STATE_ALIVE"},
}
PY_ALIASES = {
    "brx_mcp/beacon.py": {"VERSION": "ADVERT_VERSION", "TEAM_ANY": "STATION_TEAM_ANY", "MAGIC": "bytes(ADVERT_MAGIC)",
                          "ROLE": "dict(ADVERT_ROLE)", "PLAYER_STATE": "dict(ADVERT_PLAYER_STATE)",
                          "CONTROL_STATE": "dict(ADVERT_CONTROL_STATE)"},
    "brx_mcp/stage/stage.py": {"CONTROL_STATE": "_beacon.CONTROL_STATE", "STATION_TEAM_ANY": "_beacon.TEAM_ANY",
                               "ADVERT_VERSION": "_beacon.VERSION", "ADVERT_ROLE": "_beacon.ROLE"},
}


def cpp_alias_problems(root: pathlib.Path, aliases: dict) -> list[str]:
    out = []
    for fname, names in aliases.items():
        text = (root / fname).read_text(encoding="utf-8")
        for alias, generated in names.items():
            if not re.search(rf"\b{alias}\s*=\s*contract::{generated}\s*[,;]", text):
                out.append(f"{fname}: {alias} must be = contract::{generated}")
    return out


def cpp_logic_problems(root: pathlib.Path) -> list[str]:
    out = []
    adv = (root / "brx_advert.h").read_text(encoding="utf-8")
    m = re.search(r"const uint8_t b\[16\] = \{(.*?)\};", adv, re.S)
    if not m or [t.strip() for t in m.group(1).split(",")][:4] != [f"contract::ADVERT_MAGIC[{i}]" for i in range(4)]:
        out.append("brx_advert.h: advert_bytes must start with contract::ADVERT_MAGIC[0..3]")
    if "contract::ADVERT_MAGIC[i]" not in adv:
        out.append("brx_advert.h: decode_advert must compare against contract::ADVERT_MAGIC")
    m = re.search(r"inline bool hill_claimable\(int tid\) \{(.*?)\n\}", (root / "presence.h").read_text(encoding="utf-8"), re.S)
    if not m or "contract::HILL_CLAIMABLE_TIDS[" not in m.group(1) or re.search(r"tid\s*==", m.group(1)):
        out.append("presence.h: hill_claimable must read contract::HILL_CLAIMABLE_TIDS")
    return out


def py_alias_problems(root: pathlib.Path, aliases: dict) -> list[str]:
    out = []
    for fname, names in aliases.items():
        tree = ast.parse((root / fname).read_text(encoding="utf-8"))
        bound = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                bound[node.targets[0].id] = ast.unparse(node.value)
        for alias, want in names.items():
            if bound.get(alias) != want:
                out.append(f"{fname}: {alias} must be = {want} (got {bound.get(alias)!r})")
    return out


def test_the_stick_aliases_are_bound_to_the_generated_names():
    stick = REPO / "hardware" / "m5sticks3"
    assert not cpp_alias_problems(stick, CPP_ALIASES), cpp_alias_problems(stick, CPP_ALIASES)
    assert not cpp_logic_problems(stick), cpp_logic_problems(stick)


def test_the_python_advert_aliases_are_bound_to_the_types_constants():
    assert not py_alias_problems(MCP, PY_ALIASES), py_alias_problems(MCP, PY_ALIASES)


def test_the_alias_scans_find_a_planted_literal():
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        (root / "a.h").write_text("constexpr uint8_t PLAYER_REVIVED = 64;\n")
        assert cpp_alias_problems(root, {"a.h": {"PLAYER_REVIVED": "ADVERT_PLAYER_STATE_REVIVED"}})
        (root / "b.py").write_text("VERSION = 1\n")
        assert py_alias_problems(root, {"b.py": {"VERSION": "ADVERT_VERSION"}})
