"""Mechanical checks on the living docs, so a fourth cold read is never needed.

Added 2026-09-06 with the docs triage. Each check guards a rule that was broken at least once:

* headset sticker ids (the headset serial/PIN) never enter the repo (gotchas.md);
* FOLLOWUPS.md's "Updated" stamp moves when the file does (it sat on 09-01 through 09-05);
* an id is one H2 in FOLLOWUPS.md, never two (F15/F16 each named two items);
* HANDOFF.md is one screen, not a stack of banners (it reached 836 lines);
* a relative link in docs/ points at a file that exists;
* a closed id does not still fly an open marker, in either glyph family and either word order;
* a closure in the archive that hands work on names an id that still exists;
* a living page does not send the reader into docs/archive/ for a fact.

No pytest: plain test_* functions, run by run_tests.py under the system python.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
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

# R4: exact stock-image identities. Facts only; the binaries stay outside the repository.
_STOCK_IMAGE_HASHES = {
    "c5ba9df7b93f3e5cec262269157483f0dc5a53b572c3c3d802606d541d49c889": "tagger 2.01U",
    "8772ccdb5cebe86d14a6eaf85e9933f0b17dc18e7286e5cb9a10f9e154b40f37": "tagger 2.02c",
    "d95962f121762a0c61b383edb8fb243df5504407c86b1c3ba46ab79e6eeaf110": "tagger 2.02e",
    "9a68848a1f77aae7a9d5ecd97e57cd10dc074793f4a8684b171bd708fa421d77": "tagger 2.08b",
    "cf92f690325d4bc320e0137a2b153e653cab4648bb5038511f61820c57c050e1": "tagger 4.32",
    "9cd08de7257ae97b45f4eac1e8d304bbfebbc0730bc147024ba9507a610903ef": "headset 1.27",
    "3818d52a3c06593e809e2727dd01bfb394fbe9e5061bbddd0bb6f7c7390adf6a": "headset 1.34",
    "9d3ea47f33bfb0c9707fa41d6ecf8719bd57bd5d29a62e0af4edb4df1b6391b1": "BRX audio update v5 to v6",
}
_STOCK_IMAGE_SIZES = {193824, 190960, 191024, 170284, 190372, 65392, 56884, 21642062}


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


def _forbidden_hash_hits(files: list[pathlib.Path], forbidden: dict[str, str], sizes: set[int] | None = None) -> list[str]:
    hits = []
    for path in files:
        if not path.is_file():
            continue
        try:
            if sizes is not None and path.stat().st_size not in sizes:
                continue
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
        if digest in forbidden:
            hits.append(f"{path}: {forbidden[digest]}")
    return hits


def test_no_stock_firmware_or_ltp_file_is_waiting_to_be_committed():
    # Cached + untracked/non-ignored: a renamed `firmware.dat` must fail BEFORE it is staged. Ignored
    # .bin/.LTP files disappear from the untracked half but reappear here if somebody force-adds one.
    files = _tracked_files()
    extensions = [str(path.relative_to(REPO)) for path in files if path.suffix.lower() in {".bin", ".ltp"}]
    hashes = _forbidden_hash_hits(files, _STOCK_IMAGE_HASHES, _STOCK_IMAGE_SIZES)
    assert not extensions, "firmware/audio files belong outside the repo: " + ", ".join(extensions[:20])
    assert not hashes, "stock firmware image content belongs outside the repo: " + ", ".join(hashes[:20])


def test_the_stock_image_hash_guard_can_detect_renamed_content():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        disguised = pathlib.Path(td) / "harmless.dat"
        disguised.write_bytes(b"stock-image-guard-control")
        digest = hashlib.sha256(disguised.read_bytes()).hexdigest()
        hits = _forbidden_hash_hits([disguised], {digest: "control image"})
    assert hits and hits[0].endswith(": control image"), "hash guard missed renamed forbidden content"


def test_r4_t2_screamer_code_read_keeps_evidence_and_bench_boundaries_visible():
    """R4/T2 must not silently turn private code readings into confirmed field facts."""
    plan = (DOCS / "firmware-image-research-plan.md").read_text(encoding="utf-8")
    log = (DOCS / "experiment-log" / "2026-09.md").read_text(encoding="utf-8")
    screamers = (DOCS / "bench-screamers-2026-09-19.md").read_text(encoding="utf-8")

    assert "T2 screamers complete 2026-09-21" in plan
    assert "R4/T2 v4.32 screamer code-read" in log
    r4_t2 = log.split("## 2026-09-21 (desk, private input, no gun): R4/T2 v4.32 screamer code-read", 1)[1]
    assert r4_t2.count("**CODE-READ, NOT BENCH-PROVEN**") == 4
    r4_t2_lower = r4_t2.lower()
    for fact in ("1,023 usable bytes", "split frame", "`$*`", "10 ms"):
        assert fact.lower() in r4_t2_lower, f"R4/T2 log omitted {fact}"
    for step in ("A1c", "A4", "A7b", "A7c"):
        assert f"| {step} |" in screamers, f"R4/T2 omitted precise bench step {step}"
    assert 146 * len("$PING,*".encode()) == 1_022
    assert 147 * len("$PING,*".encode()) == 1_029
    assert "Existing `send`, `send_batch`, and stage `raw` inject delay" in screamers


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

    # 2026-09-17: `mcp/brx_mcp/mc/weapons.json` reached main with TWO `recoil` keys in 13 objects, a
    # merge of two lanes. That is legal JSON and `json.loads` silently keeps the last one, so a whole
    # block of tuning never reached the compiler and every test passed. `test_weapon_derivations.py`
    # now rejects a repeated key across `mc/*.json`; the same hook belongs on every package.json,
    # where a repeated `"scripts"` would drop half the build commands just as quietly.
    def refuse_a_repeated_key(pairs, _rel=""):
        seen: dict = {}
        for key, value in pairs:
            assert key not in seen, f"{_rel}: {key!r} appears twice in one object — JSON keeps only the last"
            seen[key] = value
        return seen

    for rel in ("package.json", "site/package.json", "app/package.json", "webapp/mc/package.json"):
        p = REPO / rel
        if not p.exists():
            continue
        raw = p.read_text(encoding="utf-8")
        assert raw.endswith("}\n") or raw.endswith("}"), f"{rel} does not end at its closing brace: {raw[-12:]!r}"
        # raises with the position if it is not JSON, and with the key if one is repeated
        json.loads(raw, object_pairs_hook=lambda pairs, _rel=rel: refuse_a_repeated_key(pairs, _rel))


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
# above that. This is a CEILING, not an auto-ratchet: nothing in this suite lowers it on its own. Lower
# it by hand, to the new size plus a small margin, the next time a HANDOFF rewrite lands well under it.
_HANDOFF_MAX_BYTES = 13_400


def test_handoff_is_one_screen_by_bytes_too():
    n = len(HANDOFF.read_bytes())
    assert n <= _HANDOFF_MAX_BYTES, (
        f"HANDOFF.md is {n} bytes (cap {_HANDOFF_MAX_BYTES}, target 9000); it is one screen, not a stack "
        "of banners — overwrite it, never append")


# The two id scans below were `DOCS.glob("*.md")` — top level only, so `docs/spec/` (contracts.md, the
# spec of record) and `docs/manual/` were exempt from both. 2026-09-12: 27 files scanned, 70 tracked.
# `archive/` is history by policy (CLAUDE.md: grep it, do not read it) and `experiment-log/` is the lab
# notebook, where an entry written on the day an item was open is a correct record, not rot.
_ID_SCAN_SKIP_DIRS = ("archive", "experiment-log")


def _living_docs() -> list[pathlib.Path]:
    """Every tracked markdown page a reader is meant to TRUST, at any depth under docs/."""
    out = []
    for f in sorted(DOCS.rglob("*.md")):
        parts = f.relative_to(DOCS).parts
        if parts[:-1] and parts[0] in _ID_SCAN_SKIP_DIRS:
            continue
        out.append(f)
    return out


def _dated_closed_ids() -> set[str]:
    """Ids with a `- YYYY-MM-DD **F42** ...` closure line in the archive — CLAUDE.md's one-line-per-item
    session-close format. A block heading in the older part of the file is deliberately NOT counted."""
    text = (DOCS / "archive" / "followups-closed.md").read_text(encoding="utf-8")
    # `(?!\.\d)`: a sub-item closure (`**F42.2**`) does not close its parent row (`F42`), which stays open.
    return {m.group(1) for m in re.finditer(r"^- \d{4}-\d{2}-\d{2} \*\*([A-Z]\d{1,3})\b(?!\.\d)", text, re.M)}


# 2026-09-17 doc-rot review: the set held 🔴🟠🟡 only, and `field-issues.md` — the register every field
# report lands in — marks its open items 🔍 ("open, evidence named") and 💭 ("open, design"), per its own
# legend. So F206 and F207 sat there as open for a day after both closed, and this check was green.
# 🔧 ("fixed, needs a field check") is deliberately NOT here: the work IS done, the row is a reminder.
_OPEN_GLYPHS = ("🔴", "🟠", "🟡", "🔍", "💭")
# `field-issues.md` also puts the glyph BEFORE the id (`- 🔍 **F208** ...`), which `_ROW` cannot match at
# all, so widening `_OPEN_GLYPHS` alone would have changed nothing. Only the FIRST id on such a row is
# the subject; the rest of the line cites related ids in prose (`**F49** at game scale`).
_ROW_GLYPH_FIRST = re.compile(r"\s*- (?:" + "|".join(_OPEN_GLYPHS) + r")\s*\*\*([A-Z]\d{1,3})\b")
# Empty on purpose: the two 2026-09-12 pins were for `game-test-2026-09-11.md`, which moved to
# `docs/archive/` on 2026-09-17 and is outside every id scan. Add a pin only with the date and the
# reason, and delete it as soon as the file it names is fixed.
_CLOSED_AS_OPEN_ALLOW: set[tuple[str, str]] = set()


def _ids_shown_as_open(line: str) -> list[str]:
    """The ids ONE line presents as open work, by the three shapes below. Split out so the floor test
    can drive this function itself: a test that re-implements the regex inline passes even when the
    real arm goes blind, which is how the heading blind spot survived a green suite in the first place."""
    m = _ROW.match(line)
    if m and any(g in m.group(2)[:14] for g in _OPEN_GLYPHS):
        return [m.group(1)]
    mg = _ROW_GLYPH_FIRST.match(line)
    if mg:
        return [mg.group(1)]
    if line.startswith("#") and any(g in line for g in _OPEN_GLYPHS):
        # Not a lookbehind on `\b` alone: `BC-A1` would yield `A1`, and a rung label is not a followup
        # id. Require the id to start a word that no letter, digit or hyphen precedes.
        return re.findall(r"(?<![A-Za-z0-9-])([A-Z]\d{1,3})\b", line)
    return []


def _closed_ids_cited_as_open() -> list[str]:
    """Three conservative shapes, so a sentence like "F69 CLOSED" or a bench rung gated *on* an id can
    never trip it: a FOLLOWUPS-style definition row (`- **F42 🟡** ...`, glyph right after the id), the
    same row with the glyph first (`- 🔍 **F208** ...`, `field-issues.md`'s shape), and a heading that
    carries a glyph anywhere in it.

    ⚠ The heading arm used to read only the text BEFORE the glyph, which is one of the two orders a
    heading is written in. `bench-critical-2026-09-11.md` writes the other one — `### BC-A1 — does it
    change the protocol? (15 min) 🔴 F91` — so three rungs headed red for ids retired on 2026-09-11 and
    the check reported green. A glyph anywhere in a heading now claims every id in that heading.
    """
    closed = _dated_closed_ids()
    hits = []
    for f in _living_docs():
        for n, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").split("\n"), 1):
            for i in _ids_shown_as_open(line):
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


def test_the_closed_as_open_check_reads_both_open_glyph_families_and_both_orders():
    """The floor under the 2026-09-17 widening: each of the three shapes must still match its own
    example, and the two shapes that must NOT match must still not match. Without this the widening can
    silently revert to 🔴🟠🟡-after-the-id and nothing says so."""
    assert {"🔍", "💭"} <= set(_OPEN_GLYPHS), "field-issues.md's open glyphs are no longer open"
    assert "🔧" not in _OPEN_GLYPHS, "🔧 is 'fixed, needs a field check' — the work is done, not open"

    assert _ROW_GLYPH_FIRST.match("- 🔍 **F208** a gun can die with the HUD holding the player alive").group(1) == "F208"
    assert _ROW_GLYPH_FIRST.match("- 💭 **F209** the respawn delay collapses to 0").group(1) == "F209"
    # the subject id only: a bolded id cited later in the same row is a reference, not a second subject
    assert _ROW_GLYPH_FIRST.match("- 🔍 **F206** team modes register nothing; **F49** at game scale").group(1) == "F206"
    assert _ROW_GLYPH_FIRST.match("- ✅ **F206** closed 2026-09-16") is None, "✅ is not an open glyph"
    assert _ROW_GLYPH_FIRST.match("- 🔧 **F206** fixed, needs a field check") is None, "🔧 is not an open glyph"

    # Drive the REAL arm, never a copy of its regex: the previous version of this assertion built its
    # own `re.findall` inline and stayed green with the production check reverted to its blind form.
    heading = "### BC-A1 — does `$WEAP` t3 change the transmitted IR protocol? (15 min) 🔴 F91"
    claimed = _ids_shown_as_open(heading)
    assert claimed == ["F91"], f"a glyph AFTER the id in a heading must claim F91 and nothing else, got {claimed}"
    assert _ids_shown_as_open("### BC-A1 — a rung with no glyph, and no id") == [], "a heading with no open glyph claims nothing"
    # All four combinations the name promises: both glyph families, in both orders.
    assert _ids_shown_as_open("- 🔍 **F208** a gun can die with the HUD holding the player alive") == ["F208"]
    assert _ids_shown_as_open("- **F208 🔍** the same row, glyph after the id") == ["F208"]
    assert _ids_shown_as_open("- 🔴 **F208** the older family, glyph first") == ["F208"]
    assert _ids_shown_as_open("- **F208 🔴** the older family, glyph after the id") == ["F208"]
    assert _ids_shown_as_open("- ✅ **F206** closed 2026-09-16") == [], "✅ is not an open glyph"
    assert _ids_shown_as_open("- **F206 ✅** closed 2026-09-16") == [], "✅ is not an open glyph in either order"


# Prefixes FOLLOWUPS actually uses, MINUS H and U: `H43`/`U100` are on-gun sound ids and `U1..U10` is
# weapon-design.md's own local question register, so those two letters are a different namespace that
# happens to share the shape (2026-09-12: scanning them produced 54 false positives and 0 real ones).
_CITED_ID = re.compile(r"\*\*([FSBEPQKDGR]\d{1,3})\b")
# An entry is either a bare id (allowed anywhere) or a `(file name, id)` pair (allowed in that page
# only) — the same two-level shape `_CLOSED_AS_OPEN_ALLOW` above uses.
#
# `B0` is bench-grenade.md's own rung label ("**B0** (geometry) is not **B**"), not a followup id.
#
# 2026-09-12, when this scan grew from `docs/*.md` to every living page: `docs/spec/` turned out to hold
# two LOCAL registers that happen to share a FOLLOWUPS letter, exactly like the `H`/`U` case the
# `_CITED_ID` comment above describes. `node.md` §10 "Open questions" numbers its own Q1…Q12 (FOLLOWUPS
# separately owns Q13/Q15/Q16/Q18), and `start-sequence.md` numbers its own edge cases E1…E11 (FOLLOWUPS
# separately owns E2…E7, the extensibility items). Both define every id they cite, in the same file, a
# few lines away — so they are self-resolving, not dangling. Pinned per FILE rather than by bare id, so
# a genuinely missing **Q2** cited from anywhere else still fails.
_CITED_ID_ALLOW: set = {
    "B0",
    *(("node.md", i) for i in ("Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q10")),
    *(("start-sequence.md", i) for i in ("E9", "E10", "E11")),
}


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
    known = _known_ids() | {a for a in _CITED_ID_ALLOW if isinstance(a, str)}
    missing: dict[str, str] = {}
    for f in _living_docs():
        for n, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").split("\n"), 1):
            for m in _CITED_ID.finditer(line):
                if (f.name, m.group(1)) in _CITED_ID_ALLOW:
                    continue                       # a local register that numbers its own ids (see above)
                missing.setdefault(m.group(1), f"{f.relative_to(REPO)}:{n}")
    dangling = {k: v for k, v in missing.items() if k not in known}
    assert not dangling, ("docs/ cites followup ids that resolve to nothing (not in FOLLOWUPS.md, not in "
                          "archive/followups-closed.md, not in the snapshot): " + str(dangling))


def test_the_id_scans_reach_the_whole_docs_tree():
    """The widening itself: both id scans read `docs/*.md` only until 2026-09-12, which exempted
    `docs/spec/` (the spec of record) and `docs/manual/` (the published manual) from either check."""
    pages = _living_docs()
    names = {f.relative_to(DOCS).as_posix() for f in pages}
    assert len(pages) > 60, f"only {len(pages)} living docs pages scanned — the walk stopped recursing"
    for required in ("spec/contracts.md", "manual/operate.md", "FOLLOWUPS.md", "adr/0001-companion-rider-architecture.md"):
        assert required in names, f"docs/{required} is not in the id scan's file list"
    for excluded in pages:
        assert excluded.relative_to(DOCS).parts[0] not in _ID_SCAN_SKIP_DIRS, (
            f"{excluded} is history/lab-notebook and must stay out of the id scans")


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


# ---------------------------------------------------------------------------- #
# 2026-09-17 doc-rot review: the archive. Two rules it broke, both invisible until a human read it.
# ---------------------------------------------------------------------------- #

ARCHIVE = DOCS / "archive" / "followups-closed.md"
_SUB_ID = r"[A-Z]\d{1,3}(?:\.\d{1,2})?"
_CLOSURE_HEAD = re.compile(r"^- (\d{4}-\d{2}-\d{2}) \*\*(" + _SUB_ID + r")\b")
# "…it continues as **F247**." A closure that hands work on names the id it hands it to, and that id is
# the ONLY way a reader gets from the closed item to the live one.
_FORWARD = re.compile(
    r"(?:continues as|continued as|carries on as|carried on as|re-?filed as|refiled to|filed as(?: its own job,)?"
    r"|split into|re-?opened as|tracked as|superseded by|replaced by|renumbered to|moved to)"
    r"[^.;\n]{0,40}?\*{0,2}(" + _SUB_ID + r")\b")


def _archive_entries() -> list[tuple[int, str, str]]:
    """(line number, subject id, whole entry text) for every dated closure line, continuation lines
    folded in — `- 2026-09-17 **F218** …` runs to three lines and the pointer is on the third."""
    out: list[tuple[int, str, list[str]]] = []
    for n, line in enumerate(ARCHIVE.read_text(encoding="utf-8").split("\n"), 1):
        m = _CLOSURE_HEAD.match(line)
        if m:
            out.append((n, m.group(2), [line]))
        elif out and line.startswith(("  ", "\t")):
            out[-1][2].append(line)
    return [(n, i, " ".join(body)) for n, i, body in out]


def _archive_forward_pointers() -> list[tuple[int, str, str]]:
    return [(n, subject, m.group(1))
            for n, subject, body in _archive_entries()
            for m in _FORWARD.finditer(body)
            if m.group(1) != subject]


def _ids_a_forward_pointer_may_land_on() -> set[str]:
    """A row in FOLLOWUPS.md, or an id that is itself closed. Deliberately NOT "any id the archive
    mentions": that would make every pointer self-resolving, because the pointer IS an archive mention.
    Sub-ids count (`F42.14` is a sub-row of F42, not its own bullet)."""
    known = set(re.findall(r"\*\*(" + _SUB_ID + r")\b", FOLLOWUPS.read_text(encoding="utf-8")))
    known |= {m.group(2) for m in
              (_CLOSURE_HEAD.match(line) for line in ARCHIVE.read_text(encoding="utf-8").split("\n"))
              if m}
    return known


def test_every_archive_forward_pointer_resolves():
    """`docs/archive/` is skipped by both id scans (it is history: grep it, do not read it), so the one
    thing in it that a reader still has to follow — "this closed, it continues as F247" — was checked by
    nothing. The 2026-09-13 branch renumbered F230-F242 to F235-F247 and the archive was not part of the
    sweep, because no test looked there.

    ⚠ HONEST LIMIT: this catches a pointer that lands on NOTHING. It cannot catch a pointer that lands
    on the wrong row, which is what that renumber actually left behind — F218's "it continues as F242"
    still resolved, to "the results overlay". Only a human reading both rows finds that one.
    """
    known = _ids_a_forward_pointer_may_land_on()
    dangling = [f"followups-closed.md:{n} {subject} -> {target}"
                for n, subject, target in _archive_forward_pointers() if target not in known]
    assert not dangling, (
        "a closed item hands its remainder to an id that is in neither FOLLOWUPS.md nor the archive — "
        "the usual cause is a renumber that did not sweep docs/archive/: " + ", ".join(dangling))


def test_the_forward_pointer_scan_is_not_vacuous():
    """The floor: the scan reads free text, so one rephrasing ("this rolls into F247") makes it see
    nothing at all and stay green forever. Fails instead, so the phrase list gets the new wording."""
    pointers = _archive_forward_pointers()
    assert len(pointers) >= 2, (
        f"only {len(pointers)} forward pointers parsed out of the archive — add the new wording to "
        "_FORWARD, or the check is free")
    entries = _archive_entries()
    assert len(entries) > 30, f"only {len(entries)} dated closure entries parsed"
    assert any(len(body) > 200 for _, _, body in entries), "continuation lines are no longer folded in"
    # it must flag a target that does not exist, and accept one that does
    fake = "- 2026-09-17 **F218** half of it did not run today; it continues as **F999**."
    assert _FORWARD.search(fake).group(1) == "F999"
    assert "F999" not in _ids_a_forward_pointer_may_land_on()


# `docs/archive/` is history (CLAUDE.md: grep it, do not read it), so a living page that sends the
# reader there for a FACT has put its own content out of reach: the archive is not maintained, not id
# scanned, and not link checked. The fix is always to promote the fact and keep the archive as
# provenance only. `followups-closed.md` is the one archive file everything may cite — it is the
# sanctioned record of a closure, named as such in CLAUDE.md.
_ARCHIVE_INDEX_FILES = ("docs/README.md", "docs/FOLLOWUPS.md", "docs/experiment-log.md")
# The lab notebook is history by construction: every entry is dated and cites the sheet that session
# ran from, so a link into the archive there IS the provenance this rule asks for, not a fact hidden
# out of reach. A month file may never be the only home of a live fact anyway -- the living pages are.
_ARCHIVE_INDEX_PREFIXES = ("docs/experiment-log/",)
_ARCHIVE_REF = re.compile(r"(?<![\w/.-])(?:docs/)?archive/([A-Za-z0-9._][A-Za-z0-9._/-]*)")
# Baseline measured 2026-09-17, on the day the rule was written: these pages already point into the
# archive for content. A page NOT on this list that starts doing it fails immediately. The list only
# ever shrinks — delete an entry when its page stops citing the archive, and never add one to make a
# red go away: archiving a sheet means promoting what the living pages still need FIRST.
_ARCHIVE_CITERS_BASELINE = {
    "app/README.md",                        # design/hud-export/
    "docs/architecture-topology.md",        # verification-checklist.md
    "docs/bench-grenade.md",                # bench-grenade-answered.md
    "docs/bench-queue-2026-09-09.md",       # bench-weap-tokens-discovery-2026-09-04.md, hardware/range-experiment.md
    "docs/field-issues.md",                 # docs/archive/game-test-2026-09-11.md
    "docs/game-test-2026-09-13.md",         # docs/archive/HANDOFF-gset-t2-2026-09-13.md: provenance, the sheet that ran that afternoon
    "docs/reference/ttk-model.md",          # game-test-2026-09-11.md (D2 provenance, cited twice)
    "docs/site/README.md",                  # site/SIMPLIFY-PLAN.md
    "docs/spec/contracts.md",               # mode-extensibility.md, spec-armory.md, spec-net.md
    "docs/spec/design/mission-control.md",  # design/mc-export/
    "docs/spec/design/phone-hud.md",        # design/hud-export/
    "docs/spec/loadout.md",                 # spec-loadout-superseded-notes.md
    "docs/spec/start-sequence.md",          # spec-start-sequence-tasks.md
    "docs/weapon-design.md",                # game-test-2026-09-11.md (D2 provenance)
    "hardware/esp32-ir-bridge/README.md",   # hardware/bench-shopping-list.md, hardware/ir-prototype-plan.md
    "hardware/inventory.md",                # hardware/bench-shopping-list.md
    "webapp/mc/README.md",                  # design/mc-export/
}


def _pages_citing_the_archive() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for f in _markdown_with_links():
        rel = f.relative_to(REPO).as_posix()
        if rel in _ARCHIVE_INDEX_FILES or rel.startswith(_ARCHIVE_INDEX_PREFIXES):
            continue
        for m in _ARCHIVE_REF.finditer(f.read_text(encoding="utf-8", errors="ignore")):
            if m.group(1) != "followups-closed.md":
                out.setdefault(rel, []).append(m.group(1))
    return out


def test_no_new_page_makes_the_archive_the_home_of_a_fact():
    new = {k: sorted(set(v)) for k, v in _pages_citing_the_archive().items()
           if k not in _ARCHIVE_CITERS_BASELINE}
    assert not new, (
        "these pages send the reader into docs/archive/, which is unmaintained history — promote the "
        "fact into the living page and cite the archive only as provenance: " + str(new))


def test_the_archive_citation_scan_still_matches():
    """The floor: the baseline above is a list of KNOWN hits, so if the regex stops matching the test
    passes for the wrong reason. Every baselined page must still parse as citing the archive: this is
    what makes the list actually shrink, per its own comment. Delete an entry the moment its page stops
    citing the archive, do not leave it here to rot."""
    found = set(_pages_citing_the_archive())
    missing = _ARCHIVE_CITERS_BASELINE - found
    assert not missing, (
        f"these baselined pages no longer parse as citing the archive: {sorted(missing)} — delete them "
        "from _ARCHIVE_CITERS_BASELINE, the list only ever shrinks")
    assert _ARCHIVE_REF.search("see [`archive/spec-net.md`](archive/spec-net.md)").group(1) == "spec-net.md"
    assert _ARCHIVE_REF.search("`docs/archive/hardware/range-experiment.md`").group(1) == "hardware/range-experiment.md"
