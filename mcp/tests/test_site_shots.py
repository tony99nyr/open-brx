"""The site's marketing screenshots must be generated from the real UIs, never taken by hand.

`site/shots.mjs` renders Mission Control and the phone HUD in a real browser and writes JPEGs plus
a manifest into `site/shots/`. The manifest records the git tree hash of each UI's source directory
at capture time; this file's staleness test fails the moment that source moves on without a
re-capture, so a screenshot can never silently drift out of sync with the UI it claims to show.

Runs under both `pytest` and the zero-dependency `run_tests.py` (system python has no pytest), same
pattern as test_published_build.py: `pytest` may be unavailable, so we skip through `_skip.Skipped`
when it is, and through `pytest.skip` when it is not (so a real pytest run reports SKIPPED, not
failed).
"""
from __future__ import annotations

import json
import pathlib
import subprocess

from _skip import Skipped

try:
    import pytest
except ImportError:  # system python has no pytest — run_tests.py must stay green regardless
    pytest = None

REPO = pathlib.Path(__file__).resolve().parents[2]
SHOTS_DIR = REPO / "site" / "shots"
MANIFEST = SHOTS_DIR / "manifest.json"
MAX_BYTES = 450 * 1024


def _skip(reason: str) -> None:
    if pytest is not None:
        pytest.skip(reason)
    raise Skipped(reason)


def _git(*args: str) -> str | None:
    try:
        r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def _manifest() -> dict:
    if not MANIFEST.exists():
        raise AssertionError(
            f"{MANIFEST} is missing: run \"cd site && node shots.mjs\" to generate the screenshots"
        )
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def test_site_shots_manifest_exists():
    manifest = _manifest()
    files = manifest.get("files")
    assert isinstance(files, dict) and files, f"{MANIFEST} has no files entry"

    on_disk = {p.name for p in SHOTS_DIR.glob("*.jpg")}
    listed = set(files.keys())

    missing_from_disk = sorted(listed - on_disk)
    assert not missing_from_disk, (
        f"{MANIFEST} lists jpgs that are not in {SHOTS_DIR}: {missing_from_disk} "
        "(run \"cd site && node shots.mjs\" to regenerate)"
    )

    unlisted = sorted(on_disk - listed)
    assert not unlisted, (
        f"{SHOTS_DIR} has jpgs the manifest does not list: {unlisted} "
        "(run \"cd site && node shots.mjs\" to regenerate)"
    )


def test_site_shots_match_the_ui_source():
    if not MANIFEST.exists():
        _skip(f"{MANIFEST} missing (covered by test_site_shots_manifest_exists)")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    if _git("rev-parse", "--git-dir") is None:
        _skip("git")

    mc_head = _git("rev-parse", "HEAD:webapp/mc/src")
    hud_head = _git("rev-parse", "HEAD:app/src")
    if mc_head is None or hud_head is None:
        _skip("shallow clone: webapp/mc/src or app/src is not a tree object at HEAD")

    stale = []
    if manifest.get("mc_src") != mc_head:
        stale.append(f"webapp/mc/src ({manifest.get('mc_src')!r} != {mc_head!r})")
    if manifest.get("hud_src") != hud_head:
        stale.append(f"app/src ({manifest.get('hud_src')!r} != {hud_head!r})")

    assert not stale, (
        "site/shots are older than the UI they show: run \"cd site && node shots.mjs\" and commit "
        "site/shots/ (stale: " + "; ".join(stale) + ")"
    )


def test_site_shots_are_small():
    if not SHOTS_DIR.exists():
        _skip(f"{SHOTS_DIR} missing (covered by test_site_shots_manifest_exists)")
    jpgs = sorted(SHOTS_DIR.glob("*.jpg"))
    if not jpgs:
        _skip(f"no jpgs in {SHOTS_DIR} (covered by test_site_shots_manifest_exists)")
    oversized = [(p.name, p.stat().st_size) for p in jpgs if p.stat().st_size >= MAX_BYTES]
    assert not oversized, f"screenshots at or over {MAX_BYTES} bytes: {oversized}"


_UI_DIRS = ("webapp/mc/src", "app/src")


def _dirty_ui_files() -> list[str] | None:
    """Paths under the UI source dirs that differ from HEAD — modified, staged or untracked.

    `git status --porcelain` is the working-tree hash: it already walks the files, compares content to
    the index and HEAD, and honours .gitignore, which a hand-rolled sha walk would have to re-implement
    (and would get wrong for `app/www/app.js`, which is generated and ignored).
    """
    out = _git("status", "--porcelain", "--untracked-files=normal", "--", *_UI_DIRS)
    if out is None:
        return None
    return sorted({ln[3:].strip().strip('"') for ln in out.split("\n") if ln.strip()})


def test_site_shots_match_the_ui_working_tree():
    """2026-09-12 review: the staleness check compared the manifest to `HEAD:webapp/mc/src` and
    `HEAD:app/src` only, so a screenshot was "current" the moment the UI change was committed — and
    every UI change is UNCOMMITTED while it is being made. That is exactly when someone rebuilds the
    site and ships a shot of the previous design.

    A dirty tree cannot prove anything about the shots either way, so it SKIPS and names the files;
    with a clean tree the HEAD hashes ARE the working tree and the manifest must match them.
    """
    if not MANIFEST.exists():
        _skip(f"{MANIFEST} missing (covered by test_site_shots_manifest_exists)")
    dirty = _dirty_ui_files()
    if dirty is None:
        _skip("git")
    if dirty:
        _skip("working tree dirty: shots may be stale for " + ", ".join(dirty[:8])
              + (f" (+{len(dirty) - 8} more)" if len(dirty) > 8 else ""))

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    heads = {d: _git("rev-parse", f"HEAD:{d}") for d in _UI_DIRS}
    if any(v is None for v in heads.values()):
        _skip("shallow clone: webapp/mc/src or app/src is not a tree object at HEAD")
    stale = [f"{d} ({manifest.get(k)!r} != {heads[d]!r})"
             for d, k in (("webapp/mc/src", "mc_src"), ("app/src", "hud_src"))
             if manifest.get(k) != heads[d]]
    assert not stale, (
        "the UI source is clean but site/shots do not match it: run \"cd site && npm run shots\" and "
        "commit site/shots/ (stale: " + "; ".join(stale) + ")")
