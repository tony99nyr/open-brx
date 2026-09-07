"""The build the website advertises must be real, current, and reachable.

Three separate things went wrong here before this existed, all silently:

* the site served 0.1.6 for three days while `app/src` moved 16 commits ahead, and nothing said so;
* `build.json` named commit `a1380f8` as its provenance long after a history rewrite renamed it, so
  `git show` on the published build's own SHA answered "bad object";
* the apk stopped being committed (it lives on the GitHub Release now), which makes the sidecar's
  `url` the only way anyone actually gets the file.

The site build already proves the page's stated bytes match the apk in front of it. This proves the
sidecar is honest about *which commit* it came from and *where the file lives*.

No pytest: plain test_* functions, run by run_tests.py under the system python.
"""
from __future__ import annotations

import json
import pathlib
import subprocess

from _skip import Skipped

REPO = pathlib.Path(__file__).resolve().parents[2]
SIDECAR = REPO / "webapp" / "download" / "build.json"
APP_PKG = REPO / "app" / "package.json"


def _git(*args: str) -> str | None:
    try:
        r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def _sidecar() -> dict:
    if not SIDECAR.exists():
        raise Skipped(f"{SIDECAR} (cut a build with `npm run android:apk`)")
    return json.loads(SIDECAR.read_text(encoding="utf-8"))


def test_published_build_names_a_commit_that_exists():
    """A rewrite renames every commit. A sidecar that still names the old hash is a dead end."""
    meta = _sidecar()
    sha = meta.get("git")
    assert isinstance(sha, str) and sha and sha != "unknown", (
        "webapp/download/build.json has no git provenance; cut the build with `npm run android:apk` "
        "rather than writing the sidecar by hand"
    )
    if _git("rev-parse", "--git-dir") is None:
        raise Skipped("git")
    assert _git("cat-file", "-e", f"{sha}^{{commit}}") is not None, (
        f"webapp/download/build.json says the published apk was built from {sha}, which is not a "
        "commit in this repo. If history was rewritten, remap it through .git/filter-repo/commit-map"
    )


def test_published_build_came_from_this_branch():
    """A build cut on a branch that never landed would advertise code nobody can read."""
    meta = _sidecar()
    sha = meta.get("git")
    if not isinstance(sha, str) or _git("rev-parse", "--git-dir") is None:
        raise Skipped("no git provenance")
    if _git("cat-file", "-e", f"{sha}^{{commit}}") is None:
        raise Skipped("provenance commit missing (covered by the test above)")
    merge_base = _git("merge-base", "--is-ancestor", sha, "HEAD")
    assert merge_base is not None, (
        f"the published apk was built from {sha}, which is not an ancestor of HEAD: it came from a "
        "branch that never landed, so the site advertises code that is not in this history"
    )


def test_published_build_is_the_current_app_version():
    """The staleness guard. Bumping the version without cutting a build is how the site fell behind."""
    meta = _sidecar()
    if not APP_PKG.exists():
        raise Skipped(f"{APP_PKG}")
    app_version = json.loads(APP_PKG.read_text(encoding="utf-8")).get("version")
    assert app_version, "app/package.json has no version"
    assert meta.get("version") == app_version, (
        f"app/package.json is {app_version} but the site advertises {meta.get('version')}. "
        "The published build is behind the app: cut it with `npm run android:apk` (which also "
        "publishes the release and updates the sidecar), then rebuild the site"
    )


def test_published_build_is_reachable():
    """The apk is not committed any more, so the release url is the only way to get the file."""
    meta = _sidecar()
    url = meta.get("url")
    assert isinstance(url, str) and url.startswith("https://"), (
        "webapp/download/build.json has no https url. Android builds are not committed (see "
        ".gitignore), so without it the download page has nothing to link"
    )
    assert meta.get("file") and meta["file"] in url, (
        f"the release url does not name the published file ({meta.get('file')}): {url}"
    )


def test_published_build_was_not_cut_from_a_dirty_tree():
    meta = _sidecar()
    assert meta.get("dirty") is False, (
        f"the published apk was built from a dirty tree (git {meta.get('git')}), so what it contains "
        "is not what that commit says. Commit app/ and cut it again"
    )


def test_the_apk_itself_is_not_committed():
    """The whole point of the Release: a tracked apk is ~5 MB of history per version, forever."""
    if _git("rev-parse", "--git-dir") is None:
        raise Skipped("git")
    tracked = _git("ls-files", "webapp/download")
    if tracked is None:
        raise Skipped("git ls-files")
    apks = [ln for ln in tracked.split("\n") if ln.strip().lower().endswith(".apk")]
    assert not apks, (
        "these apks are tracked in git: " + ", ".join(apks) + ". Android builds live on the "
        "app-v<version> GitHub Release; `git rm --cached` them (.gitignore already covers the path)"
    )
