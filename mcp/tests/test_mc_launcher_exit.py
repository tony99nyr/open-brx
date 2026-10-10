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


def test_an_mc_that_exits_2_makes_the_launcher_exit_2():
    needs(NODE, "node")
    if os.name == "nt":
        return   # the fake interpreter is a shell script
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        shutil.copytree(REPO / "scripts", root / "scripts", ignore=shutil.ignore_patterns("node_modules", "test"))
        patterns = root / "mcp" / "brx_mcp" / "mc" / "redact_patterns.json"   # read by scripts/lib/redact.mjs
        patterns.parent.mkdir(parents=True)
        shutil.copy(REPO / "mcp" / "brx_mcp" / "mc" / "redact_patterns.json", patterns)
        py = root / ".venv" / "bin" / "python"
        py.parent.mkdir(parents=True)
        py.write_text("#!/bin/sh\necho 'Another Mission Control (pid 1, port 8765) owns this home' >&2\nexit 2\n")
        py.chmod(0o755)
        dist = root / "webapp" / "mc" / "dist"
        dist.mkdir(parents=True)
        (dist / "index.html").write_text("<!doctype html>")
        env = {**os.environ, "BRX_MCP_HOME": str(root / "home")}
        r = subprocess.run([NODE, str(root / "scripts" / "mc.mjs"), "--port", str(_free_port()),
                            "--ws-port", str(_free_port()), "--keep-all"],
                           cwd=root, env=env, capture_output=True, text=True, timeout=60)
        assert r.returncode == 2, (r.returncode, r.stdout[-500:], r.stderr[-500:])
        assert "server exited with code 2" in r.stderr, r.stderr[-500:]
