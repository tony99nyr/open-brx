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
    assert n <= 150, f"HANDOFF.md is {n} lines; it is one screen (<=150), history goes to `git log -p -- docs/HANDOFF.md`"


# The markdown OUTSIDE docs/ that a reader actually navigates from. 2026-09-12 review: the link check
# only ever read docs/, so a dead path in the root README or in a package README could not be caught by
# anything, and those are the first files a newcomer opens.
_LINKED_MARKDOWN = ("README.md", "CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md",
                    "mcp/README.md", "webapp/mc/README.md", "app/README.md", "app/tools/README.md")


def _markdown_with_links() -> list[pathlib.Path]:
    files = [f for f in DOCS.rglob("*.md") if "archive" not in f.relative_to(DOCS).parts]
    files += [REPO / rel for rel in _LINKED_MARKDOWN if (REPO / rel).is_file()]
    files += sorted(REPO.glob("hardware/**/*.md")) + sorted(REPO.glob("protocol/**/*.md"))
    return files


def test_docs_links_resolve():
    bad = []
    for f in _markdown_with_links():
        text = f.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", text):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:", "/")):
                continue  # site-absolute paths are resolved by the site generator
            if not (f.parent / target).exists():
                bad.append(f"{f.relative_to(REPO)} -> {target}")
    assert not bad, "dangling relative links: " + "; ".join(bad[:20])


def test_the_link_check_reaches_outside_docs():
    """The floor under the check above: if the root README stops being scanned, this fails rather than
    the extension silently reverting to docs/-only."""
    scanned = {str(f.relative_to(REPO)) for f in _markdown_with_links()}
    for rel in ("README.md", "CLAUDE.md", "protocol/brx-protocol.md"):
        assert rel in scanned, f"{rel} is no longer link-checked"


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


# ---------------------------------------------------------------------------- #
# 2026-09-12 doc-rot review: five more mechanical rules, each broken at least once.
# ---------------------------------------------------------------------------- #

# A memory-file wiki link. Claude's memory store uses `[[slug]]` to cross-reference its own notes; the
# repo has no such syntax, so one in a tracked file is a note that leaked out of the memory directory
# and points at a file no reader can open.
_SLUG = re.compile(r"\[\[[a-z0-9][a-z0-9-]{2,}\]\]")
# 2026-09-12 residue, being cleaned by the same review. A file listed here may still carry one; a leak
# anywhere ELSE fails immediately. Delete an entry once its file is clean and the skip turns into a pass.
_SLUG_RESIDUE = {"docs/FOLLOWUPS.md"}


def test_no_memory_slugs_in_tracked_markdown():
    hits = []
    for f in _tracked_files():
        rel = str(f.relative_to(REPO))
        # `.claude/skills/` DESCRIBES this rule, so it quotes the pattern on purpose.
        if f.suffix != ".md" or not f.is_file() or rel.startswith(".claude/"):
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for m in _SLUG.finditer(text):
            hits.append(f"{rel}:{text.count(chr(10), 0, m.start()) + 1} {m.group(0)}")
    new = [h for h in hits if h.split(":")[0] not in _SLUG_RESIDUE]
    assert not new, ("memory-file slugs ([[name]]) in tracked markdown — write the fact out or link a "
                     "real path: " + ", ".join(new[:10]))
    if hits:
        raise Skipped("the pinned _SLUG_RESIDUE still carries slugs: " + ", ".join(hits[:10]))


# HANDOFF is capped at 150 LINES, which one long line per bullet walks straight through: the file that
# triggered the rule was 836 lines, but the shape it keeps coming back as is 30 paragraph-length bullets.
# The intent is 9,000 bytes (~one screen). 2026-09-12: the file measures 12,752, so the cap is pinned just
# above that and RATCHETS DOWN — lower it toward 9,000 whenever a rewrite lands under the new number.
_HANDOFF_MAX_BYTES = 13_400


def test_handoff_is_one_screen_by_bytes_too():
    n = len(HANDOFF.read_bytes())
    assert n <= _HANDOFF_MAX_BYTES, (
        f"HANDOFF.md is {n} bytes (cap {_HANDOFF_MAX_BYTES}, target 9000); it is one screen, not a stack "
        "of banners — overwrite it, never append")


def _dated_closed_ids() -> set[str]:
    """Ids with a `- YYYY-MM-DD **F42** ...` closure line in the archive — CLAUDE.md's one-line-per-item
    session-close format. A block heading in the older part of the file is deliberately NOT counted."""
    text = (DOCS / "archive" / "followups-closed.md").read_text(encoding="utf-8")
    # `(?!\.\d)`: a sub-item closure (`**F42.2**`) does not close its parent row (`F42`), which stays open.
    return {m.group(1) for m in re.finditer(r"^- \d{4}-\d{2}-\d{2} \*\*([A-Z]\d{1,3})\b(?!\.\d)", text, re.M)}


_OPEN_GLYPHS = ("🔴", "🟠", "🟡")
# 2026-09-12 residue: `game-test-2026-09-11.md` still heads two rungs red for ids that closed the next
# morning. Owned by the game-test lane; remove these once the sheet's status block is refreshed.
_CLOSED_AS_OPEN_ALLOW = {("game-test-2026-09-11.md", "F124"), ("game-test-2026-09-11.md", "F125")}


def _closed_ids_cited_as_open() -> list[str]:
    """Two conservative shapes only, so a sentence like "F69 CLOSED" or a bench rung gated *on* an id
    can never trip it: a FOLLOWUPS-style definition row (`- **F42 🟡** ...`, glyph right after the id),
    and a heading whose id appears BEFORE its glyph (`### B1 · F124 · title 🔴`)."""
    closed = _dated_closed_ids()
    hits = []
    for f in sorted(DOCS.glob("*.md")):
        for n, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").split("\n"), 1):
            found = []
            m = _ROW.match(line)
            if m and any(g in m.group(2)[:14] for g in _OPEN_GLYPHS):
                found = [m.group(1)]
            elif line.startswith("#"):
                cut = min([line.find(g) for g in _OPEN_GLYPHS if g in line] or [-1])
                if cut > 0:
                    found = re.findall(r"\b([A-Z]\d{1,3})\b", line[:cut])
            for i in found:
                if i in closed and (f.name, i) not in _CLOSED_AS_OPEN_ALLOW:
                    hits.append(f"{f.relative_to(REPO)}:{n} {i}")
    return hits


def test_no_living_doc_shows_a_dated_closed_id_as_open():
    """A closed item still flying a red dot sends the next session to re-do work that is already done —
    the exact failure the three-writes session close (one log entry, one FOLLOWUPS diff, one HANDOFF
    replacement) exists to prevent, and the half that gets skipped is the diff."""
    hits = _closed_ids_cited_as_open()
    assert not hits, ("these ids have a dated closure in archive/followups-closed.md but still carry an "
                      "open marker: " + ", ".join(hits[:20]))


def test_the_closed_as_open_check_can_actually_fail():
    """It reports zero today, which is indistinguishable from a dead regex unless it is provoked."""
    closed = _dated_closed_ids()
    assert len(closed) > 30, f"only {len(closed)} dated closure lines parsed out of the archive"
    probe = f"- **{sorted(closed)[0]} 🔴** pretend this reopened\n"
    m = _ROW.match(probe.rstrip("\n"))
    assert m and any(g in m.group(2)[:14] for g in _OPEN_GLYPHS), "the definition-row shape stopped matching"


# Prefixes FOLLOWUPS actually uses, MINUS H and U: `H43`/`U100` are on-gun sound ids and `U1..U10` is
# weapon-design.md's own local question register, so those two letters are a different namespace that
# happens to share the shape (2026-09-12: scanning them produced 54 false positives and 0 real ones).
_CITED_ID = re.compile(r"\*\*([FSBEPQKDGR]\d{1,3})\b")
# `B0` is bench-grenade.md's own rung label ("**B0** (geometry) is not **B**"), not a followup id.
_CITED_ID_ALLOW = {"B0"}


def _known_ids() -> set[str]:
    text = FOLLOWUPS.read_text(encoding="utf-8")
    known = set(_followup_definitions(text))
    known |= set(re.findall(r"\*\*([A-Z]\d{1,3})\b", (DOCS / "archive" / "followups-closed.md").read_text(encoding="utf-8")))
    snap = DOCS / "archive" / "pre-2026-09-06-followups-snapshot.md"
    if snap.is_file():
        known |= set(re.findall(r"\b([A-Z]\d{1,3})\b", snap.read_text(encoding="utf-8")))
    m = re.search(r"\*\*Next free:([^*]+)\*\*", text)     # advertised-free ids resolve to "not yet taken"
    if m:
        known |= set(re.findall(r"\b([A-Z]\d{1,3})\b", m.group(1)))
    return known


def test_every_cited_followup_id_resolves():
    """A bolded **F42** that is in neither FOLLOWUPS nor the archive is a dangling reference: the reader
    cannot find out what it was, and the usual cause is an id renumbered or dropped rather than closed."""
    known = _known_ids() | _CITED_ID_ALLOW
    missing: dict[str, str] = {}
    for f in sorted(DOCS.glob("*.md")):
        for n, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").split("\n"), 1):
            for m in _CITED_ID.finditer(line):
                missing.setdefault(m.group(1), f"{f.relative_to(REPO)}:{n}")
    dangling = {k: v for k, v in missing.items() if k not in known}
    assert not dangling, ("docs/ cites followup ids that resolve to nothing (not in FOLLOWUPS.md, not in "
                          "archive/followups-closed.md, not in the snapshot): " + str(dangling))


def test_the_id_resolution_check_sees_real_ids():
    """The floor: the resolver must know the hundreds of ids that DO exist, or the check above is free."""
    known = _known_ids()
    assert len(known) > 200, f"only {len(known)} ids resolved — FOLLOWUPS or the archive stopped parsing"


def test_the_living_status_files_are_dated():
    """FOLLOWUPS carries `Updated: YYYY-MM-DD`; HANDOFF carries `State as of YYYY-MM-DD` in its banner.
    Both are how a reader decides whether to trust the file. `gotchas.md` and `field-issues.md` carry no
    stamp today and are deliberately NOT enforced here: they are registers, not status files.
    """
    _stamp(FOLLOWUPS)     # raises with the filename if the stamp is gone
    head = HANDOFF.read_text(encoding="utf-8")[:1200]
    assert re.search(r"(?:State as of|Updated)[^0-9]{0,20}\d{4}-\d{2}-\d{2}", head), (
        "HANDOFF.md has no dated 'State as of YYYY-MM-DD' banner in its first lines")
