"""The newcomer launcher (`./start.sh` / `start.cmd` -> `scripts/start.mjs`): its options and its
`--report` path, run as a real `node` process the way a user runs it.

The full setup path (pip, npm ci, a console build) needs the network and a minute, so it is not run
here: a fresh-clone run is the check for that. `--report` is run for real when the repo's `.venv` is
already set up (the start script then skips the install), and skips cleanly when it is not.

Every identifier in the fixture session is MADE UP (it comes from test_mc_report.make_evidence).
"""
import hashlib
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path

from _skip import needs
from test_mc_report import assert_clean, make_evidence, members

REPO = Path(__file__).resolve().parents[2]
START = REPO / "scripts" / "start.mjs"
NODE = shutil.which("node")
VENV_PY = REPO / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run_start(*args: str, env: dict | None = None, timeout: float = 120) -> subprocess.CompletedProcess:
    return subprocess.run([NODE or "node", str(START), *args], cwd=REPO, env=env, stdin=subprocess.DEVNULL,
                          capture_output=True, text=True, timeout=timeout)


def test_help_lists_every_option_the_parser_accepts():
    needs(NODE, "node")
    res = run_start("--help")
    assert res.returncode == 0, res.stderr
    src = START.read_text(encoding="utf-8")
    known = re.search(r"const known = new Set\(\[([^\]]*)\]\)", src)
    assert known, "start.mjs no longer declares its options in `known`"
    for flag in re.findall(r"'(--[a-z-]+)'", known.group(1)):
        assert flag in res.stdout, f"{flag} is accepted but --help does not mention it"


def test_an_unknown_option_stops_with_the_usage():
    needs(NODE, "node")
    res = run_start("--no-such-option")
    assert res.returncode == 2
    assert "Unknown option: --no-such-option" in res.stderr
    assert "--report" in res.stderr


def _venv_ready() -> bool:
    """True when start.mjs's python() step will skip the install (same stamp rule as start.mjs)."""
    stamp = REPO / ".venv" / ".open-brx-stamp"
    if not VENV_PY.exists() or not stamp.exists():
        return False
    want = hashlib.sha256((REPO / "mcp" / "pyproject.toml").read_bytes()).hexdigest()[:16]
    return stamp.read_text(encoding="utf-8").strip() == want


def test_report_makes_a_clean_zip_and_opens_the_issue_form():
    needs(NODE, "node")
    needs(_venv_ready(), "a set-up .venv (run ./start.sh --setup-only once)")
    root = Path(tempfile.mkdtemp(prefix="brx-launcher-test-"))
    try:
        ev, _armory, _ = make_evidence(root)
        # Stand-ins for the browser and the file manager: they record what they were given, so the
        # test proves the launcher asked for both without opening anything on the developer's desktop.
        fake = root / "bin"
        fake.mkdir()
        opened = root / "opened.txt"
        for name in ("xdg-open", "open", "browser"):
            script = fake / name
            script.write_text(f"#!/bin/sh\necho \"{name} $*\" >> '{opened}'\n", encoding="utf-8")
            script.chmod(script.stat().st_mode | stat.S_IXUSR)
        env = {**os.environ, "BRX_MCP_HOME": str(root), "PATH": f"{fake}{os.pathsep}{os.environ['PATH']}",
               "BROWSER": str(fake / "browser"), "NO_COLOR": "1"}
        res = run_start("--report", "launch-abc", env=env)
        out = res.stdout + res.stderr
        assert res.returncode == 0, out
        assert "[2/2] Making a bug report" in out, out
        zips = list(ev.glob("open-brx-report-*.zip"))
        assert len(zips) == 1, out
        files = members(zips[0])
        assert {"README.txt", "session.sqlite", "mc.log", "diag.json", "environment.json"} <= set(files)
        assert_clean(files)
        assert zipfile.is_zipfile(zips[0])
        seen = opened.read_text(encoding="utf-8") if opened.exists() else ""
        assert "github.com/tony99nyr/open-brx/issues/new?template=bug_report.yml" in seen, seen
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_report_without_any_session_says_what_to_do():
    needs(NODE, "node")
    needs(_venv_ready(), "a set-up .venv (run ./start.sh --setup-only once)")
    root = Path(tempfile.mkdtemp(prefix="brx-launcher-test-"))
    try:
        env = {**os.environ, "BRX_MCP_HOME": str(root), "BROWSER": "true", "NO_COLOR": "1"}
        res = run_start("--report", env=env)
        assert res.returncode != 0
        assert "start.sh" in res.stdout + res.stderr
    finally:
        shutil.rmtree(root, ignore_errors=True)
