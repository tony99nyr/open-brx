"""A6 (maintainability review 2026-10-10, finding 6): the console mock (webapp/mc/src/mock/backend.ts) restates about 32
of MC's operator lines by hand, and one had already drifted (a hyphen became an em dash). Tony decides UI from `?mock`
renders, so a drifted line shows him wording MC never prints. This joins every long string literal in the mock to MC's
own literals, and a pair that is the same line except for punctuation, spacing or case must be IDENTICAL; a
near-miss (a changed word) is reported too."""
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
_FORMAT_FIELD = re.compile(r"\{[A-Za-z_][A-Za-z0-9_]*(?:![rsa])?(?::[^{}]*)?\}")


def _norm(s: str) -> str:
    """The same line, whatever its punctuation, spacing or case (Opus r1: a dash that became a colon must still pair).
    Holes stay as `{}`, so a moved placeholder changes the form."""
    s = s.lower().replace("{}", "\x00")
    s = re.sub(r"[^a-z0-9\x00]+", " ", s)
    return re.sub(r"\s+", " ", s).strip().replace("\x00", "{}")


def _py_text(node: ast.AST) -> str | None:
    """A literal's text; an f-string's text with each `{...}` hole as `{}` (Codex r1: MC builds many lines that way)."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return _FORMAT_FIELD.sub("{}", node.value)   # a `.format()` template's `{weapon}` is a hole too
    if isinstance(node, ast.JoinedStr):   # a `{x!r}` hole renders its quotes: count them as text (Opus r1)
        return "".join(v.value if isinstance(v, ast.Constant) else ("'{}'" if getattr(v, "conversion", -1) == ord("r") else "{}")
                       for v in node.values)
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
        # a `{x!r}` hole quotes a string and not a number, so either rendering is MC's
        if line not in twins and line not in {tw.replace("'{}'", "{}") for tw in twins}:
            bad.append(f"mock: {line!r}\n  MC: {sorted(twins)!r}")
    assert shared >= 10, f"the scan found only {shared} shared lines: is it reading the right files?"
    assert not bad, f"{len(bad)} mock line(s) differ from MC's own wording:\n" + "\n".join(bad)


# Near-misses the review judged deliberate: mock text -> why it differs from the nearest MC line.
NEAR_MISS_OK: dict[str, str] = {
    "STICK CANNOT SAVE TO FLASH [2 FAILED WRITES], A RESTART LOSES ITS SETTINGS: REPLACE IT":
        "demo data: MC's {count} filled in with 2",
    "HEADSET CONFIRMING (LINK 4 S)": "demo data: MC's {seconds} filled in with 4",
    "POST /api/armory/corrupt/dismiss": "a route name in an error, not an operator line",
}


def test_no_mock_line_is_a_near_miss_of_an_mc_line():
    """Opus r1: a changed WORD changes the normal form, so the pairing above cannot see it. A mock line that pairs with
    nothing but reads at least 90 % like an MC line is almost certainly a drifted copy: make it identical, or record
    why it differs in NEAR_MISS_OK."""
    import difflib
    server = _python_lines()
    forms = list(server)
    bad = []
    for line in _mock_lines():
        form = _norm(line)
        if form in server or line in NEAR_MISS_OK or len(form) < MIN_LEN:
            continue
        # MC builds some lines from pieces (a fixed head plus a concatenated tail): a whole MC piece inside the mock line,
        # or the mock line as the head of an MC one, is the same message
        if any(len(f) >= 20 and (f in form or f.startswith(form)) for f in forms):
            continue
        best = difflib.get_close_matches(form, forms, n=1, cutoff=0.9)
        if best:
            bad.append(f"mock: {line!r}\n  MC: {sorted(server[best[0]])!r}")
    assert not bad, f"{len(bad)} mock line(s) nearly match an MC line:\n" + "\n".join(bad)
