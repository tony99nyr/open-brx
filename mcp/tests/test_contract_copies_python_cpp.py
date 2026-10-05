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


def _distinctive(value) -> bool:
    """A value worth guarding: a sequence of strings, or a string long or odd enough not to collide by chance."""
    if isinstance(value, (list, tuple)):
        return bool(value) and all(isinstance(v, str) for v in value)
    return isinstance(value, str) and (len(value) >= 12 or "$" in value)


def python_copies(root: pathlib.Path, exported: dict, skip: set[str]) -> list[str]:
    wanted = {n: (list(v) if isinstance(v, (list, tuple)) else v) for n, v in exported.items() if _distinctive(v)}
    hits = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root).as_posix()
        if rel in skip:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
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
