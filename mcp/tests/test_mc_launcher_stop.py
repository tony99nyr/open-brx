"""scripts/mc.mjs stops Mission Control gracefully first (2026-10-10, with brx3's POST /api/shutdown, a23d8b2f).

On Windows Node's child.kill() is a hard TerminateProcess that skips Python's handlers, so a Stop lost up to 2 s of
edits. The launcher now POSTs /api/shutdown with `X-BRX-Shutdown: 1` and the operator token, waits for MC to exit,
and only then falls back to a kill."""
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
NODE = shutil.which("node")

# A stand-in for `python -m brx_mcp.mc`: answers / for the health check, prints the URL the launcher parses, and
# on POST /api/shutdown records the request and exits 0. It ignores SIGTERM, so only the graceful path can stop it.
FAKE_MC = r'''#!{python}
import http.server, json, os, signal, sys, threading, time
started = time.monotonic()
slow = os.environ.get("FAKE_MC_SLOW_HEALTH") == "1"   # the health check fails for 5 s: a stop lands during start-up
signal.signal(signal.SIGTERM, signal.SIG_IGN)
port = int(sys.argv[sys.argv.index("--port") + 1])
record = os.environ["FAKE_MC_RECORD"]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        code = 503 if slow and time.monotonic() - started < 5 else 200
        self.send_response(code); self.end_headers(); self.wfile.write(b"ok")
    def do_POST(self):
        with open(record, "w") as f:
            json.dump({"path": self.path, "shutdown": self.headers.get("X-BRX-Shutdown"),
                       "auth": self.headers.get("Authorization")}, f)
        self.send_response(202); self.end_headers(); self.wfile.write(b'{"ok": true}')
        threading.Timer(0.2, lambda: os._exit(0)).start()
srv = http.server.HTTPServer(("127.0.0.1", port), H)
print(f"Mission Control http://127.0.0.1:{port}/#tok=secret123", flush=True)
srv.serve_forever()
'''


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _stop_case(slow_health: bool, ready_text: str, expect_text: str = ""):
    needs(NODE, "node")
    if os.name == "nt":
        return   # the fake interpreter relies on a POSIX shebang
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        shutil.copytree(REPO / "scripts", root / "scripts", ignore=shutil.ignore_patterns("node_modules", "test"))
        patterns = root / "mcp" / "brx_mcp" / "mc" / "redact_patterns.json"   # read by scripts/lib/redact.mjs
        patterns.parent.mkdir(parents=True)
        shutil.copy(REPO / "mcp" / "brx_mcp" / "mc" / "redact_patterns.json", patterns)
        py = root / ".venv" / "bin" / "python"
        py.parent.mkdir(parents=True)
        py.write_text(FAKE_MC.replace("{python}", sys.executable))
        py.chmod(0o755)
        dist = root / "webapp" / "mc" / "dist"
        dist.mkdir(parents=True)
        (dist / "index.html").write_text("<!doctype html>")
        record = root / "shutdown.json"
        home = root / "home"
        env = {**os.environ, "BRX_MCP_HOME": str(home), "FAKE_MC_RECORD": str(record), "WSL_DISTRO_NAME": "x",
               "FAKE_MC_SLOW_HEALTH": "1" if slow_health else "0"}
        p = subprocess.Popen([NODE, str(root / "scripts" / "mc.mjs"), "--port", str(_free_port()),
                              "--ws-port", str(_free_port()), "--keep-all"],
                             cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 30
            out = ""
            while ready_text not in out and time.monotonic() < deadline:
                line = p.stdout.readline()
                if not line:
                    break
                out += line
            assert ready_text in out, out
            p.send_signal(signal.SIGTERM)
            p.wait(timeout=30)
            rest = p.stdout.read()
            # the branch under test really ran (under load the stop could land after the slow-health window)
            assert expect_text in out + rest, (out + rest)[-800:]
        finally:
            if p.poll() is None:
                p.kill()
        assert record.exists(), (p.returncode, out[-800:], p.stderr.read()[-800:])
        got = json.loads(record.read_text())
        assert got == {"path": "/api/shutdown", "shutdown": "1", "auth": "Bearer secret123"}, got
        assert p.returncode == 0, (p.returncode, (out + rest)[-600:], p.stderr.read()[-600:])
        manifest = json.loads(next((home / "sessions").glob("*/manifest.json")).read_text())
        assert manifest["status"] == "stopped", manifest


def test_a_stop_posts_api_shutdown_with_the_header_and_token_and_mc_exits_cleanly():
    _stop_case(slow_health=False, ready_text="Session evidence")


def test_a_stop_during_start_up_still_sends_the_token_and_ends_as_a_clean_stop():
    # Codex review: the token was read only after the health check (a stop then got 401), and an MC that exited 0
    # because we asked it to was reported as a start-up failure with the manifest left at `starting`.
    _stop_case(slow_health=True, ready_text="#tok=", expect_text="stopped during start-up")
