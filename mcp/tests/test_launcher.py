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


def _install_stamp(repo: Path) -> str:
    """The python() install stamp: pyproject.toml then constraints.txt (a missing file hashes as empty)."""
    h = hashlib.sha256()
    for name in ("pyproject.toml", "constraints.txt"):
        f = repo / "mcp" / name
        h.update(f.read_bytes() if f.exists() else b"")
    return h.hexdigest()[:16]


def _node_eval(code: str, *args: str) -> str:
    res = subprocess.run([NODE or "node", "--input-type=module", "-e", code, *args], cwd=REPO, capture_output=True,
                         text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    return res.stdout.strip()


def _types(major: int, minor: int) -> str:
    return f"APP_MAJOR = {major}\nAPP_MINOR = {minor}\n"


def _warning(old: str, new: str) -> str:
    code = ("import {phonesWarning} from './scripts/lib/launcher.mjs';"
            "console.log(phonesWarning(process.argv[1], process.argv[2]) ?? 'NONE')")
    return _node_eval(code, old, new)


def test_the_warning_prints_when_the_app_minor_changes_and_not_otherwise():
    needs(NODE, "node")
    assert "PHONES MUST UPDATE TOO" in _warning(_types(0, 4), _types(0, 5))
    assert "0.4 to 0.5" in _warning(_types(0, 4), _types(0, 5))
    assert "PHONES MUST UPDATE TOO" in _warning(_types(0, 9), _types(1, 0))
    assert _warning(_types(0, 4), _types(0, 4)) == "NONE"
    assert _warning(_types(1, 2), _types(1, 3)) == "NONE"  # from 1.0 on only MAJOR is breaking
    assert _warning("garbage", _types(0, 5)) == "NONE"      # an unreadable file never blocks an update


def test_the_install_stamp_changes_when_constraints_change():
    needs(NODE, "node")
    root = Path(tempfile.mkdtemp(prefix="brx-stamp-test-"))
    try:
        (root / "mcp").mkdir()
        (root / "mcp" / "pyproject.toml").write_text("[project]\n", encoding="utf-8")
        code = "import {installStamp} from './scripts/lib/launcher.mjs'; console.log(installStamp(process.argv[1]))"
        none = _node_eval(code, str(root))
        assert none == _install_stamp(root)
        (root / "mcp" / "constraints.txt").write_text("bleak==1\n", encoding="utf-8")
        one = _node_eval(code, str(root))
        (root / "mcp" / "constraints.txt").write_text("bleak==2\n", encoding="utf-8")
        two = _node_eval(code, str(root))
        assert len({none, one, two}) == 3
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_constraints_pin_every_runtime_dependency_exactly():
    pins = {}
    for line in (REPO / "mcp" / "constraints.txt").read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            assert re.fullmatch(r"[A-Za-z0-9_.-]+==[0-9][A-Za-z0-9.]*", line.strip()), line
            pins[line.split("==")[0].lower()] = line
    for dep in ("bleak", "mcp", "websockets", "starlette", "uvicorn", "zeroconf"):
        assert dep in pins, f"{dep} is not pinned"


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
                        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"})


def _update_prompt_run(minor_after: int) -> str:
    """Run start.mjs in a throwaway clone that is one commit behind, with no python, brew or winget on PATH
    so the run stops right after the update step. Returns stdout. No terminal is attached."""
    base = Path(tempfile.mkdtemp(prefix="brx-update-test-"))
    try:
        origin, clone = base / "origin", base / "clone"
        origin.mkdir()
        _git(origin, "init", "-q", "-b", "main")
        for rel in ("scripts/start.mjs", "scripts/lib/launcher.mjs"):
            (origin / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / rel, origin / rel)
        types = origin / "mcp" / "brx_mcp" / "mc" / "types.py"
        types.parent.mkdir(parents=True)
        types.write_text(_types(0, 4), encoding="utf-8")
        _git(origin, "add", "-A")
        _git(origin, "commit", "-qm", "one")
        _git(base, "clone", "-q", str(origin), str(clone))
        types.write_text(_types(0, minor_after), encoding="utf-8")
        (origin / "new.txt").write_text("x", encoding="utf-8")
        _git(origin, "add", "-A")
        _git(origin, "commit", "-qm", "two")
        bin_dir = base / "bin"
        bin_dir.mkdir()
        for tool in ("node", "git"):
            (bin_dir / tool).symlink_to(shutil.which(tool))
        env = {"PATH": str(bin_dir), "HOME": str(base), "BRX_MCP_HOME": str(base / "home"), "NO_COLOR": "1"}
        res = subprocess.run([str(bin_dir / "node"), str(clone / "scripts" / "start.mjs")], cwd=clone, env=env,
                             stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=120)
        assert (clone / "new.txt").exists() is False, "a run with no terminal must not update"
        return res.stdout
    finally:
        shutil.rmtree(base, ignore_errors=True)


def test_the_update_prompt_defaults_to_no_without_a_terminal():
    needs(NODE and shutil.which("git"), "node and git")
    out = _update_prompt_run(4)
    assert "Update now? [y/N] no (default)" in out, out
    assert "kept the current version" in out
    assert "PHONES MUST UPDATE TOO" not in out


def test_the_update_prompt_warns_before_the_question_when_the_app_version_changes():
    needs(NODE and shutil.which("git"), "node and git")
    out = _update_prompt_run(5)
    assert "PHONES MUST UPDATE TOO" in out, out
    assert out.index("PHONES MUST UPDATE TOO") < out.index("Update now?")
    assert "Update now? [y/N] no (default)" in out


def _venv_ready() -> bool:
    """True when start.mjs's python() step will skip the install (same stamp rule as start.mjs)."""
    stamp = REPO / ".venv" / ".open-brx-stamp"
    if not VENV_PY.exists() or not stamp.exists():
        return False
    return stamp.read_text(encoding="utf-8").strip() == _install_stamp(REPO)


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
