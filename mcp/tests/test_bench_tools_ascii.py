"""Bench tools must print pure ASCII.

The Windows console these run on is cp1252. A single emoji in a `print()` raises UnicodeEncodeError
and kills the run -- and because the crash lands in the VERDICT block, it happens after the
measurement is taken and before it is reported, which is the worst possible moment. This cost a
bench window twice on 2026-09-02, the second time in a tool written hours after the first fix.

Docstrings and comments are exempt: they are never encoded to the console.
"""
import ast
import pathlib

TOOLS = sorted((pathlib.Path(__file__).resolve().parents[1] / "tools").glob("*.py"))


def _printed_strings(path):
    """Every string literal that reaches a print()/SystemExit, with f-string parts included."""
    out = []
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and (
                (isinstance(node.func, ast.Name) and node.func.id in ("print", "SystemExit")))):
            continue
        for arg in node.args:
            for sub in ast.walk(arg):
                if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                    out.append((sub.lineno, sub.value))
    return out


def test_no_tool_prints_non_ascii():
    bad = []
    for f in TOOLS:
        for lineno, text in _printed_strings(f):
            for ch in text:
                if ord(ch) > 127:
                    bad.append(f"{f.name}:{lineno} prints {ch!r} (U+{ord(ch):04X})")
                    break
    assert not bad, "non-ASCII in bench tool output (cp1252 console will crash):\n  " + \
                    "\n  ".join(sorted(set(bad)))


def test_the_checker_actually_sees_a_violation():
    """A guard that cannot fail is worthless -- prove this one can."""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as fh:
        fh.write('print("done ✅")\n')
        p = pathlib.Path(fh.name)
    try:
        found = [t for _, t in _printed_strings(p) if any(ord(c) > 127 for c in t)]
        assert found, "the checker missed an obvious violation"
    finally:
        p.unlink()
