"""F613 (2026-10-25): the local `--changed` gate let a pyright skip through, and the lander went red on it.

A worktree held a partial `.venv` (a Codex subagent's: the MC extras, no pyright). `scripts/lib/python.mjs` picked it
as the repo venv, so `test_pyright` skipped ("needs pyright"), the gate read green, and the lander, whose venv has
pyright, found 3 type errors. test-all refused only websockets and uvicorn skips. Now `noSkipFor` also refuses a
pyright skip whenever the run gates code pyright checks: a `--changed` run whose diff touches `mcp/brx_mcp/**` or
`mcp/pyproject.toml`, and every lander gate. A plain `test:all` in a newcomer's venv (`./start.sh` installs no
pyright) still skips it, as CLAUDE.md allows.
"""
import json
import shutil
from pathlib import Path

from _node import run_node
from _skip import needs

REPO = Path(__file__).resolve().parents[2]
PY_MOD = REPO / "scripts" / "lib" / "python.mjs"


def _no_skip(**kw) -> list[str]:
    needs(shutil.which("node"), "node")
    expr = (f"import({json.dumps(PY_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.noSkipFor({json.dumps(kw)}))))")
    return json.loads(run_node(expr, cwd=REPO))


def _skips(flags: list[str]) -> list[str]:
    assert all(f == "--no-skip" for f in flags[::2]), flags
    return flags[1::2]


def test_a_changed_gate_on_pyright_checked_code_refuses_a_pyright_skip():
    for p in ("mcp/brx_mcp/mc/state.py", "mcp/brx_mcp/mc/routes/recap_history.py", "mcp/pyproject.toml"):
        assert "pyright" in _skips(_no_skip(foundVenv=True, changedPaths=["docs/x.md", p])), p


def test_every_lander_gate_refuses_a_pyright_skip():
    assert "pyright" in _skips(_no_skip(foundVenv=True, landGate=True))
    assert "pyright" in _skips(_no_skip(foundVenv=True, landGate=True, changedPaths=["docs/x.md"]))


def test_a_change_pyright_does_not_check_and_a_plain_run_still_allow_the_skip():
    assert _skips(_no_skip(foundVenv=True, changedPaths=["webapp/mc/src/screens/Kit.tsx", "mcp/tests/test_x.py"])) \
        == ["websockets", "uvicorn"]
    assert _skips(_no_skip(foundVenv=True)) == ["websockets", "uvicorn"], "a newcomer's plain test:all: no pyright there"


def test_mc_py_and_system_python_refuse_nothing():
    assert _no_skip(foundVenv=False, landGate=True, changedPaths=["mcp/brx_mcp/mc/state.py"]) == []


def test_test_all_reads_its_no_skip_set_from_the_helper():
    src = (REPO / "scripts" / "test-all.mjs").read_text()
    assert "noSkipFor(" in src and "landGate: process.env.BRX_LAND_GATE" in src, \
        "test-all must build NO_SKIP from noSkipFor, with the lander flag and the --changed paths"
