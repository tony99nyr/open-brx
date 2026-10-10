"""OP1 (maintainability review 2026-10-10, Critical): two Mission Controls on one laptop shared `~/.brx-mcp`, so each
overwrote the other's session.json, pieces.json and favourites.json with no warning. A non-ephemeral MC now holds an
exclusive lock on `<home>/mc.lock`; a second one exits 2 before it restores or writes anything."""
from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import tempfile

MCP = pathlib.Path(__file__).resolve().parents[1]


def _env(home):
    return {**os.environ, "BRX_MCP_HOME": str(home), "PYTHONPATH": str(MCP)}


def test_a_second_holder_of_the_home_lock_exits_2_and_names_the_first():
    from brx_mcp.mc.__main__ import lock_home_or_exit
    home = pathlib.Path(tempfile.mkdtemp())
    held = lock_home_or_exit(home, port=8765)
    try:
        r = subprocess.run([sys.executable, "-c", "import pathlib,os;from brx_mcp.mc.__main__ import lock_home_or_exit;"
                            "lock_home_or_exit(pathlib.Path(os.environ['BRX_MCP_HOME']), port=9999)"],
                           env=_env(home), capture_output=True, text=True, timeout=60)
        assert r.returncode == 2, (r.returncode, r.stderr)
        assert str(os.getpid()) in r.stderr and "8765" in r.stderr, r.stderr
        assert "--ephemeral" in r.stderr and "BRX_MCP_HOME" in r.stderr, r.stderr
    finally:
        held.close()
    r = subprocess.run([sys.executable, "-c", "import pathlib,os;from brx_mcp.mc.__main__ import lock_home_or_exit;"
                        "lock_home_or_exit(pathlib.Path(os.environ['BRX_MCP_HOME']), port=9999)"],
                       env=_env(home), capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, ("control: free once the first holder is gone", r.stderr)


def test_a_second_mission_control_refuses_before_it_touches_the_session():
    from brx_mcp.mc.__main__ import lock_home_or_exit
    home = pathlib.Path(tempfile.mkdtemp())
    (home / "session.json").write_text('{"first": true}')
    held = lock_home_or_exit(home, port=8765)
    try:
        r = subprocess.run([sys.executable, "-m", "brx_mcp.mc", "--host", "127.0.0.1", "--port", "0", "--ws-port", "0",
                            "--no-auth"], env=_env(home), capture_output=True, text=True, timeout=120)
        assert r.returncode == 2, (r.returncode, r.stdout[-400:], r.stderr[-400:])
        assert "Mission Control  http" not in r.stdout, "no banner from the refused MC"
        assert (home / "session.json").read_text() == '{"first": true}', "the first MC's session is untouched"
    finally:
        held.close()


def test_demo_and_ephemeral_runs_take_no_lock():
    from brx_mcp.mc.__main__ import needs_home_lock, parser
    assert needs_home_lock(parser().parse_args([]))
    assert not needs_home_lock(parser().parse_args(["--demo"]))
    assert not needs_home_lock(parser().parse_args(["--ephemeral"]))
