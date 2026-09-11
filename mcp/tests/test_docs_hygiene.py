"""Mechanical checks on the living docs, so a fourth cold read is never needed.

Added 2026-09-06 with the docs triage. Each check guards a rule that was broken at least once:

* headset sticker ids (the headset serial/PIN) never enter the repo (gotchas.md);
* FOLLOWUPS.md's "Updated" stamp moves when the file does (it sat on 09-01 through 09-05);
* an id is one H2 in FOLLOWUPS.md, never two (F15/F16 each named two items);
* HANDOFF.md is one screen, not a stack of banners (it reached 836 lines);
* a relative link in docs/ points at a file that exists.

No pytest: plain test_* functions, run by run_tests.py under the system python.
"""
from __future__ import annotations

import datetime as _dt
import pathlib
import re
import subprocess

from _skip import Skipped

REPO = pathlib.Path(__file__).resolve().parents[2]
DOCS = REPO / "docs"
FOLLOWUPS = DOCS / "FOLLOWUPS.md"
HANDOFF = DOCS / "HANDOFF.md"

# The headset sticker ids all share this shape; the letters are assembled at runtime so the
# pattern itself is not a hit.
_STICKER = re.compile("R" + "0B" + r"[A-Z0-9]{2}\b")
_TEXT_SUFFIXES = {".md", ".py", ".ts", ".tsx", ".js", ".mjs", ".json", ".txt", ".toml", ".yml", ".yaml", ".html", ".css", ".svg"}


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout if out.returncode == 0 else None


def _tracked_files() -> list[pathlib.Path]:
    """Tracked files PLUS untracked-but-not-ignored ones.

    ⚠ This used to be a bare `ls-files`, i.e. TRACKED ONLY, and that hole was walked into on
    2026-09-07: a new bench sheet carrying a headset sticker id was written, this suite was run and
    passed (the file was still untracked, so the guard could not see it), and the leak entered the very
    next commit. The guard was green precisely because the file was new, which is when a leak is most
    likely. `--others --exclude-standard` adds untracked files while still honouring .gitignore, so a
    file is checked BEFORE it is added rather than one commit too late.
    """
    listing = _git("ls-files", "--cached", "--others", "--exclude-standard")
    if listing is None:
        raise Skipped("git")
    return [REPO / p for p in dict.fromkeys(listing.split("\n")) if p]


def test_no_headset_sticker_id_in_tracked_files():
    hits = []
    for f in _tracked_files():
        if f.suffix not in _TEXT_SUFFIXES or not f.is_file():
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for m in _STICKER.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            hits.append(f"{f.relative_to(REPO)}:{line}")
    assert not hits, "headset sticker ids in the repo (use Tactix-XXXX or an alias): " + ", ".join(hits[:20])


def _stamp(path: pathlib.Path) -> _dt.date:
    head = path.read_text(encoding="utf-8")[:2000]
    m = re.search(r"Updated[^0-9]{0,20}(\d{4}-\d{2}-\d{2})", head)
    assert m, f"{path.name} has no 'Updated: YYYY-MM-DD' line near the top"
    return _dt.date.fromisoformat(m.group(1))


def test_followups_stamp_moves_with_the_file():
    stamp = _stamp(FOLLOWUPS)
    rel = str(FOLLOWUPS.relative_to(REPO))
    dirty = _git("status", "--porcelain", "--", rel)
    if dirty is None:
        raise Skipped("git")
    if dirty.strip():
        assert stamp == _dt.date.today(), (
            f"FOLLOWUPS.md is edited but its Updated stamp says {stamp}; set it to today"
        )
        return
    last = _git("log", "-1", "--format=%cs", "--", rel)
    if not last or not last.strip():
        raise Skipped("git history")
    committed = _dt.date.fromisoformat(last.strip())
    assert stamp >= committed, f"FOLLOWUPS.md was committed {committed} but its Updated stamp says {stamp}"


# A followup id is DEFINED by a row that carries a status marker (`- **F42 🟡** ...`); the same id may
# then be REFERENCED freely, which §9's bench run-sheet does constantly. Definitions must be unique.
_STATUS = ("🔴", "🟠", "🟡", "🟢", "✅", "⬜")
_ROW = re.compile(r"\s*- \*\*([A-Z]\d{1,3})\b(.*)$")


def _followup_definitions(text: str) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for n, line in enumerate(text.split("\n"), 1):
        m = _ROW.match(line)
        if m and any(s in m.group(2)[:12] for s in _STATUS):
            out.setdefault(m.group(1), []).append(n)
    return out


def test_followups_ids_are_defined_exactly_once():
    """No id may head two different items.

    ⚠ THIS CHECK USED TO SCAN `## ` HEADINGS ONLY, and every followup id lives in a BULLET row — so it
    saw ONE id (`E1`) out of 89 and was effectively vacuous. On 2026-09-07 three sessions read "Next
    free" concurrently and all claimed the same numbers: F40, F41 and F42 each ended up naming two
    different items, and the guard whose entire job is "never reuse an id" reported green throughout.
    Same shape as the bench-teardown scan that only read `finally:` blocks and the clear-safety sweep
    that only read named constants — a guard correct for the place it looked, and blind everywhere else.
    """
    dupes = {k: v for k, v in _followup_definitions(FOLLOWUPS.read_text(encoding="utf-8")).items()
             if len(v) > 1}
    assert not dupes, ("an id defines more than one item in FOLLOWUPS.md (ids are never reused — "
                       "claim the next one in the header FIRST, then write the row): " + str(dupes))


def test_the_id_check_sees_the_ids_that_actually_exist():
    """The floor that stops it going vacuous again: if a format change drops the row pattern, this
    fails instead of the file silently checking nothing."""
    found = _followup_definitions(FOLLOWUPS.read_text(encoding="utf-8"))
    assert len(found) > 50, f"only {len(found)} followup ids found — the row pattern has stopped matching"


def test_the_id_check_can_actually_fail():
    """A uniqueness check that cannot be made to fail is indistinguishable from no check."""
    dupes = _followup_definitions("- **F42 🟡** one thing\n- **F42 🔴** a different thing\n")
    assert dupes["F42"] == [1, 2], f"the checker did not flag a duplicate definition: {dupes}"
    refs = _followup_definitions("- **F42 🟡** the definition\n- **F42** a bench-sheet reference\n")
    assert refs["F42"] == [1], "a reference without a status marker must NOT count as a definition"


def test_the_next_free_ids_are_actually_free():
    """The collision's root cause: three sessions trusted the header and it was already stale. An id
    advertised as free that is in use is worse than no header at all."""
    text = FOLLOWUPS.read_text(encoding="utf-8")
    defined = set(_followup_definitions(text))
    m = re.search(r"\*\*Next free:([^*]+)\*\*", text)
    assert m, "FOLLOWUPS.md no longer advertises a 'Next free:' list"
    claimed = set(re.findall(r"\b([A-Z]\d{1,3})\b", m.group(1)))
    assert claimed, "the 'Next free:' list parsed to nothing"
    taken = sorted(claimed & defined)
    assert not taken, ("'Next free' advertises ids that are already in use: " + ", ".join(taken))


def test_handoff_is_one_screen():
    n = len(HANDOFF.read_text(encoding="utf-8").split("\n"))
    assert n <= 150, f"HANDOFF.md is {n} lines; it is one screen (<=150), history goes to docs/archive/handoff-history.md"


def test_docs_links_resolve():
    bad = []
    for f in DOCS.rglob("*.md"):
        if "archive" in f.relative_to(DOCS).parts:
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", text):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:", "/")):
                continue  # site-absolute paths are resolved by the site generator
            if not (f.parent / target).exists():
                bad.append(f"{f.relative_to(REPO)} -> {target}")
    assert not bad, "dangling links in docs/: " + "; ".join(bad[:20])


def test_every_package_json_parses():
    """Cloudflare's build starts with `npm run build:ci` at the root. On 2026-09-11 a scripted edit left a
    literal backslash-n after the closing brace of the root package.json; npm refused to parse it, the deploy
    failed, and the only symptom was a site that never updated. JSON, not JavaScript, at every level."""
    import json
    for rel in ("package.json", "site/package.json", "app/package.json", "webapp/mc/package.json"):
        p = REPO / rel
        if not p.exists():
            continue
        raw = p.read_text(encoding="utf-8")
        assert raw.endswith("}\n") or raw.endswith("}"), f"{rel} does not end at its closing brace: {raw[-12:]!r}"
        json.loads(raw)  # raises with the position if it is not JSON
