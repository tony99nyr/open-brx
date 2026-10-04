"""A test run must import brx_mcp from the checkout under test. The dev venv's editable install points at the main
checkout, so a worktree's (or the land lane's) MC could run main's code and pass. test-all sets BRX_MCP_EXPECT_DIR;
brx_mcp/__init__.py refuses any other copy, and test-all puts <ROOT>/mcp first on PYTHONPATH for every job."""
import os
import pathlib
import subprocess
import sys
import tempfile

MCP = pathlib.Path(__file__).resolve().parents[1]
REPO = MCP.parent


def _import_with(expect: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "PYTHONPATH": str(MCP), "BRX_MCP_EXPECT_DIR": expect}
    with tempfile.TemporaryDirectory() as cwd:   # a neutral cwd, so sys.path[0] cannot help
        return subprocess.run([sys.executable, "-c", "import brx_mcp; print(brx_mcp.__file__)"],
                              cwd=cwd, env=env, capture_output=True, text=True, timeout=60)


def test_this_checkout_imports_when_it_is_the_expected_one():
    r = _import_with(str(MCP))
    assert r.returncode == 0, r.stderr
    assert pathlib.Path(r.stdout.strip()).resolve().is_relative_to(MCP.resolve())


def test_an_import_from_another_checkout_fails_loudly():
    with tempfile.TemporaryDirectory() as other:
        r = _import_with(other)
    assert r.returncode != 0
    assert "brx_mcp imported from" in r.stderr and "this test run checks" in r.stderr, r.stderr


def test_test_all_sets_the_expected_dir_and_pythonpath_for_every_job():
    src = (REPO / "scripts" / "test-all.mjs").read_text(encoding="utf-8")
    assert "BRX_MCP_EXPECT_DIR: OWN_MCP" in src and "...ownBrxMcpEnv(env)" in src
