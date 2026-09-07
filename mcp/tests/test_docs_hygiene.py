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


def test_followups_ids_are_unique_headings():
    ids: dict[str, list[int]] = {}
    for n, line in enumerate(FOLLOWUPS.read_text(encoding="utf-8").split("\n"), 1):
        if not line.startswith("## "):
            continue
        for m in re.finditer(r"\b([A-Z])(\d{1,3})\b", line):
            # ids the file uses: one capital letter + number, first one on the heading
            ids.setdefault(m.group(0), []).append(n)
            break
    dupes = {k: v for k, v in ids.items() if len(v) > 1}
    assert not dupes, "an id heads more than one H2 in FOLLOWUPS.md (never reuse an id): " + str(dupes)


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
