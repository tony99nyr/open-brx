"""Every symbol the amendment index points at must still exist.

2026-09-12 doc-rot review. `docs/spec/contracts.md` §10 is the map from an amendment (A1…A31) to the
code that implements it — "folded into: `state.py _finish/_push_result`, `hud.js`". It is the first
thing anyone reads to find out where a decision LIVES, and it is written at design time, before the
code, so a renamed function or a helper that never got written leaves the index pointing at nothing.
Nothing else in the suite reads that column.

Deliberately loose: it asserts the cited name appears SOMEWHERE under `mcp/brx_mcp/`, `app/src/` or
`webapp/mc/src/` (or, for a file name, that such a file exists), not that it appears in the module the
row names. A stricter check would fail on every legitimate move; this one fails only when the symbol
is gone.

Run: python3 run_tests.py amendment_citations
"""
from __future__ import annotations

import collections
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[2]
CONTRACTS = REPO / "docs" / "spec" / "contracts.md"
CODE_DIRS = (REPO / "mcp" / "brx_mcp", REPO / "app" / "src", REPO / "webapp" / "mc" / "src")
_GREPPABLE = {".py", ".js", ".mjs", ".ts", ".tsx", ".html"}      # not .json: the sound catalog is ~10 MB
_FILENAME = re.compile(r"\.(py|js|mjs|ts|tsx|md|json|html)$")

# A symbol shape an English word cannot take: snake_case, a dotted path, or an API route. A bare
# lowercase word in backticks is usually a wire kind or prose emphasis ("`score`", "`not`"), and the
# kinds are already pinned by test_contract_kinds.py.
_SYMBOL = re.compile(r"/api/[a-z0-9_/{}.-]+"
                     r"|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+"
                     r"|[a-z][a-z0-9]*(?:_[a-z0-9]+)+")

# Symbols specified but not yet built. EMPTY on 2026-09-12: every symbol A24/A25/A27/A29/A31 cite had
# landed by the time this test was written. An entry is a dated IOU — "2026-MM-DD: under construction,
# see FOLLOWUPS D1" — and is deleted the day the symbol lands, never left to rot.
ALLOW: dict[str, str] = {}


def _amendment_rows(text: str | None = None) -> list[tuple[str, str]]:
    """(amendment id, its "folded into" cell) for every §10 row. `text` overrides the file, so the
    floor test below can feed the REAL parser a fabricated row."""
    text = CONTRACTS.read_text(encoding="utf-8") if text is None else text
    head = "## 10. Amendment index"
    assert head in text, "contracts.md no longer has the §10 amendment index"
    section = text[text.index(head):].split("\n## ")[0]
    rows = []
    for line in section.split("\n"):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 4 and re.fullmatch(r"A\d+(\.\d+)?", cells[0]):
            rows.append((cells[0], cells[3]))       # id, "folded into"
    return rows


def _cited_symbols(text: str | None = None) -> dict[str, set[str]]:
    out: dict[str, set[str]] = collections.defaultdict(set)
    for aid, folded in _amendment_rows(text):
        for span in re.finditer(r"`([^`]+)`", folded):
            for part in re.split(r"[\s,;]+", span.group(1)):
                part = part.strip("().,;:*|→-")
                if _SYMBOL.fullmatch(part):
                    out[aid].add(part)
    return out


def _haystack() -> tuple[str, set[str]]:
    """All greppable source text, and every file NAME under the code dirs plus docs/."""
    text, names = [], set()
    for d in CODE_DIRS:
        if not d.is_dir():
            continue
        for f in d.rglob("*"):
            if not f.is_file():
                continue
            names.add(f.name)
            if f.suffix in _GREPPABLE:
                text.append(f.read_text(encoding="utf-8", errors="ignore"))
    names |= {f.name for f in (REPO / "docs").rglob("*.md")}
    return "\n".join(text), names


def _unresolved(cited: dict[str, set[str]], source: str, names: set[str]) -> dict[str, list[str]]:
    """THE check, as one function both the real test and its floor call. It used to live inline in the
    test body, which is why the "can actually fail" test below could only assert that two invented
    strings were absent from the haystack — it never ran a line of the resolver it was vouching for."""
    missing: dict[str, list[str]] = collections.defaultdict(list)
    for aid, syms in cited.items():
        for s in sorted(syms):
            if s in ALLOW:
                continue
            if _FILENAME.search(s):
                if s not in names:
                    missing[aid].append(s)
                continue
            needle = s if s.startswith("/api/") else s.split(".")[-1]
            if needle not in source:
                missing[aid].append(s)
    return missing


def test_every_amendment_citation_resolves():
    source, names = _haystack()
    missing = _unresolved(_cited_symbols(), source, names)
    assert not missing, (
        "contracts.md §10 points at code that does not exist (rename the row, or build the symbol): "
        + "; ".join(f"{k}: {v}" for k, v in sorted(missing.items())))


def test_the_citation_check_reads_real_rows():
    """The floor. If §10's table shape changes, this fails instead of the check above going vacuous."""
    rows = _amendment_rows()
    assert len(rows) > 20, f"only {len(rows)} amendment rows parsed out of contracts.md §10"
    cited = _cited_symbols()
    total = sum(len(v) for v in cited.values())
    assert total > 25, f"only {total} symbols extracted from the 'folded into' column across {len(rows)} rows"
    source, names = _haystack()
    assert len(source) > 500_000, f"the source haystack is only {len(source)} chars — the code dirs stopped being read"


# A §10 table the parser must read exactly as it reads contracts.md's own: one real symbol, one symbol
# nobody wrote, and one missing file. Tabs/pipes match the live table's shape.
_FAKE_SECTION = """## 10. Amendment index

| id | date | what | folded into |
| --- | --- | --- | --- |
| A99 | 2026-09-12 | a fabricated row | `weapon_view`, `def_nonexistent_symbol_xyz`, `no_such_module.py` |

## 11. Next
"""


def test_the_citation_check_can_actually_fail():
    """Run the REAL parser and the REAL resolver over a fabricated §10 row.

    Two symbols in it do not exist and one does, so this pins both directions at once: the check must
    report exactly the two, and must not report the one. Asserting only that an invented string is
    absent from the haystack (what this test did before) passes just as happily when the resolver is
    broken, because it never calls it.
    """
    cited = _cited_symbols(_FAKE_SECTION)
    assert "A99" in cited, f"the row parser did not read the fabricated §10 row: {dict(cited)}"
    assert {"weapon_view", "def_nonexistent_symbol_xyz", "no_such_module.py"} <= cited["A99"], cited["A99"]

    source, names = _haystack()
    missing = _unresolved(cited, source, names)
    assert "def_nonexistent_symbol_xyz" in missing.get("A99", []), (
        "the resolver did not report a symbol nobody ever wrote — it would pass a §10 index pointing at "
        f"nothing: {dict(missing)}")
    assert "no_such_module.py" in missing.get("A99", []), (
        f"the resolver did not report a cited FILE that does not exist: {dict(missing)}")
    assert "weapon_view" not in missing.get("A99", []), (
        "the resolver reported `weapon_view`, which `mcp/brx_mcp/mc/views.py` really defines — it is "
        "failing everything, so the real test above proves nothing either")
