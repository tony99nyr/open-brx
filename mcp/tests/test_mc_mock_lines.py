"""A6 (maintainability review 2026-10-10, finding 6): the console mock (webapp/mc/src/mock/backend.ts) restates about 32
of MC's operator lines by hand, and one had already drifted (a hyphen became an em dash). Tony decides UI from `?mock`
renders, so a drifted line shows him wording MC never prints. This joins every long string literal in the mock to MC's
own literals, and a pair that is the same line except for punctuation or spacing must be IDENTICAL."""
from __future__ import annotations

import ast
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
MC = ROOT / "mcp" / "brx_mcp" / "mc"
MOCK = ROOT / "webapp" / "mc" / "src" / "mock" / "backend.ts"
MIN_LEN = 25

_TS_STR = re.compile(r"""'((?:[^'\\\n]|\\.){%d,})'|"((?:[^"\\\n]|\\.){%d,})"|`((?:[^`\\\n]|\\.){%d,})`""" %(MIN_LEN, MIN_LEN, MIN_LEN))
_TS_HOLE = re.compile(r"\$\{[^}]*\}")
_U_ESC = re.compile(r"\\u([0-9a-fA-F]{4})")


def _norm(s: str) -> str:
    """The same line, whatever its dashes, quotes, spacing or case."""
    s = s.replace("\u2014", "-").replace("\u2013", "-").replace("\u2019", "'").replace("\u2018", "'")
    return re.sub(r"\s+", " ", s).strip().lower()


def _py_text(node: ast.AST) -> str | None:
    """A literal's text; an f-string's text with each `{...}` hole as `{}` (Codex r1: MC builds many lines that way)."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(v.value if isinstance(v, ast.Constant) else "{}" for v in node.values)
    return None


def _python_lines() -> dict[str, set[str]]:
    """normal form -> every MC literal with it (Codex r1: two can share one; the mock may match either)."""
    out: dict[str, set[str]] = {}
    for path in sorted(MC.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            text = _py_text(node)
            if text is not None and len(text) >= MIN_LEN:
                out.setdefault(_norm(text), set()).add(text)
    return out


def _ts_text(raw: str) -> str:
    """The rendered text of a TS literal: escapes resolved (only \\uXXXX decoded, so real non-ASCII text survives) and
    each `${...}` hole as `{}`."""
    raw = _U_ESC.sub(lambda m: chr(int(m.group(1), 16)), raw)
    raw = raw.replace("\\'", "'").replace('\\"', '"').replace("\\`", "`").replace("\\\\", "\\")
    return _TS_HOLE.sub("{}", raw)


def _mock_lines() -> list[str]:
    text = MOCK.read_text(encoding="utf-8")
    return [_ts_text(next(g for g in m.groups() if g is not None)) for m in _TS_STR.finditer(text)]


def test_a_mock_line_that_restates_an_mc_line_is_identical():
    server = _python_lines()
    shared = 0
    bad = []
    for line in _mock_lines():
        twins = server.get(_norm(line))
        if not twins:
            continue
        shared += 1
        if line not in twins:
            bad.append(f"mock: {line!r}\n  MC: {sorted(twins)!r}")
    assert shared >= 10, f"the scan found only {shared} shared lines: is it reading the right files?"
    assert not bad, f"{len(bad)} mock line(s) differ from MC's own wording:\n" + "\n".join(bad)
