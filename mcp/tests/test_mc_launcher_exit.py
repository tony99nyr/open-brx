"""scripts/mc.mjs passes Mission Control's own exit code through (brx3, 2026-10-10).

MC exits 2 when another Mission Control owns its home folder (the instance lock, OP1) or a port is busy (F108). The
launcher turned every early exit into 1, so start.sh's caller could not tell "already running" from a crash."""
import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
NODE = shutil.which("node")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _launch(body: str) -> subprocess.CompletedProcess:
    """Run scripts/mc.mjs in a temp tree whose `.venv/bin/python` is the given shell body."""
    needs(NODE, "node")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        shutil.copytree(REPO / "scripts", root / "scripts", ignore=shutil.ignore_patterns("node_modules", "test"))
        patterns = root / "mcp" / "brx_mcp" / "mc" / "redact_patterns.json"   # read by scripts/lib/redact.mjs
        patterns.parent.mkdir(parents=True)
        shutil.copy(REPO / "mcp" / "brx_mcp" / "mc" / "redact_patterns.json", patterns)
        py = root / ".venv" / "bin" / "python"
        py.parent.mkdir(parents=True)
        py.write_text("#!/bin/sh\n" + body)
        py.chmod(0o755)
        dist = root / "webapp" / "mc" / "dist"
        dist.mkdir(parents=True)
        (dist / "index.html").write_text("<!doctype html>")
        env = {**os.environ, "BRX_MCP_HOME": str(root / "home")}
        return subprocess.run([NODE, str(root / "scripts" / "mc.mjs"), "--port", str(_free_port()),
                               "--ws-port", str(_free_port()), "--keep-all"],
                              cwd=root, env=env, capture_output=True, text=True, timeout=60)


def test_an_mc_that_exits_2_makes_the_launcher_exit_2():
    if os.name == "nt":
        return   # the fake interpreter is a shell script
    r = _launch("echo 'Another Mission Control (pid 1, port 8765) owns this home' >&2\nexit 2\n")
    assert r.returncode == 2, (r.returncode, r.stdout[-500:], r.stderr[-500:])
    assert "server exited with code 2" in r.stderr, r.stderr[-500:]


def test_an_mc_that_exits_0_makes_the_launcher_exit_0():
    if os.name == "nt":
        return
    r = _launch("echo usage\nexit 0\n")   # e.g. `--help`
    assert r.returncode == 0, (r.returncode, r.stderr[-500:])


def test_an_mc_killed_by_a_signal_fails_at_once_not_after_the_start_up_timeout():
    if os.name == "nt":
        return
    import time
    start = time.monotonic()
    r = _launch("kill -9 $$\n")
    assert r.returncode == 1 and "killed by SIGKILL" in r.stderr, (r.returncode, r.stderr[-500:])
    assert time.monotonic() - start < 10, "waited for the 15 s start-up timeout"
