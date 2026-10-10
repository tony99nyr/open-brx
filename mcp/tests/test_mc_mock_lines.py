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

_TS_STR = re.compile(r"""'((?:[^'\\\n]|\\.){%d,})'|"((?:[^"\\\n]|\\.){%d,})"|`([^`$\n]{%d,})`""" % (MIN_LEN, MIN_LEN, MIN_LEN))


def _norm(s: str) -> str:
    """The same line, whatever its dashes, quotes or spacing."""
    s = s.replace("—", "-").replace("–", "-").replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", s).strip().lower()


def _python_lines() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in sorted(MC.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) >= MIN_LEN:
                out.setdefault(_norm(node.value), node.value)
    return out


def _mock_lines() -> list[str]:
    text = MOCK.read_text(encoding="utf-8")
    return [next(g for g in m.groups() if g is not None) for m in _TS_STR.finditer(text)]


def test_a_mock_line_that_restates_an_mc_line_is_identical():
    server = _python_lines()
    shared = drift = 0
    bad = []
    for line in _mock_lines():
        raw = line.encode().decode("unicode_escape") if "\\u" in line else line
        twin = server.get(_norm(raw))
        if twin is None:
            continue
        shared += 1
        if twin != raw:
            drift += 1
            bad.append(f"mock: {raw!r}\n  MC: {twin!r}")
    assert shared >= 10, f"the scan found only {shared} shared lines: is it reading the right files?"
    assert not bad, f"{drift} mock line(s) differ from MC's own wording:\n" + "\n".join(bad)
