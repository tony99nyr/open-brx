"""The site's marketing screenshots must be generated from the real UIs, never taken by hand.

`site/shots.mjs` renders Mission Control and the phone HUD in a real browser and writes JPEGs plus
a manifest into `site/shots/`. The manifest records the git tree hash of each UI's source directory
at capture time. The `site-shots` CI job compares those hashes to main and re-captures when they
differ, so a screenshot cannot drift out of step with the UI it shows for longer than one CI run.

Runs under both `pytest` and the zero-dependency `run_tests.py` (system python has no pytest), same
pattern as test_published_build.py: `pytest` may be unavailable, so we skip through `_skip.Skipped`
when it is, and through `pytest.skip` when it is not (so a real pytest run reports SKIPPED, not
failed).
"""
from __future__ import annotations

import json
import os
import pathlib

from _skip import Skipped

try:
    import pytest
except ImportError:  # system python has no pytest — run_tests.py must stay green regardless
    pytest = None

REPO = pathlib.Path(__file__).resolve().parents[2]
SHOTS_DIR = REPO / "site" / "shots"
MANIFEST = SHOTS_DIR / "manifest.json"
MAX_BYTES = 450 * 1024

# Staleness (do the shots match the UI source?) is NOT checked here. The `site-shots` job in
# .github/workflows/ci.yml owns it: it regenerates the shots after every push to main and commits them
# back. A local check made every UI commit fail `test:all` until someone captured by hand, and those hand
# captures raced the job's own commit (removed 2026-09-26). This file keeps the checks a push can fail
# on its own: the manifest lists what is on disk, and every shot is small.


def _skip(reason: str) -> None:
    # Under pytest, skip the pytest way. Under run_tests.py, raise ITS Skipped: `pytest.skip` raises a
    # BaseException that run_tests.py does not catch, so with pytest importable (the venv) and a dirty
    # UI tree the whole run used to die at this file with no summary (found 2026-09-12).
    if pytest is not None and os.environ.get("PYTEST_CURRENT_TEST"):
        pytest.skip(reason)
    raise Skipped(reason)


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


def test_site_shots_are_small():
    if not SHOTS_DIR.exists():
        _skip(f"{SHOTS_DIR} missing (covered by test_site_shots_manifest_exists)")
    jpgs = sorted(SHOTS_DIR.glob("*.jpg"))
    if not jpgs:
        _skip(f"no jpgs in {SHOTS_DIR} (covered by test_site_shots_manifest_exists)")
    oversized = [(p.name, p.stat().st_size) for p in jpgs if p.stat().st_size >= MAX_BYTES]
    assert not oversized, f"screenshots at or over {MAX_BYTES} bytes: {oversized}"
