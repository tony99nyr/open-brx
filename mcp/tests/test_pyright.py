"""The static-type gate: pyright in `standard` mode over `brx_mcp/` (config: `mcp/pyproject.toml`
`[tool.pyright]`) must report ZERO errors.

Why a test and not a separate CI step: `run_tests.py` is the one entry point every box runs, and a gate
that lives beside the other guards is a gate that gets run. Under a python without pyright (the bench
box's system python) this SKIPS, the one legitimate reason to skip (mcp/tests/_skip.py); CI's second pass
installs pyright, so the gate is red in CI when it is red at all.

Run: python3 run_tests.py pyright        (`pip install pyright` first; it fetches its node bundle once)
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys

from _skip import Skipped

MCP = pathlib.Path(__file__).resolve().parents[1]
MIN_FILES_CHECKED = 40   # a config that silently checks nothing must not pass as "no errors"


def _pyright_cmd() -> list[str]:
    try:
        import pyright  # noqa: F401  (the pip package wraps the node bundle)
        return [sys.executable, "-m", "pyright"]
    except ImportError:
        pass
    exe = shutil.which("pyright")
    if exe:
        return [exe]
    raise Skipped("pyright (pip install pyright)")


def _run() -> dict:
    cmd = _pyright_cmd() + ["--outputjson", "--pythonpath", sys.executable, "--project", str(MCP / "pyproject.toml")]
    r = subprocess.run(cmd, cwd=MCP, capture_output=True, text=True, timeout=600)
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        raise AssertionError(f"pyright produced no JSON (rc={r.returncode}):\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")


# Lazy module-level cache: pyright takes ~10 s, and this file runs it from two tests. Filled on first
# use (result OR the Skipped it raised, so a missing pyright still skips both tests cleanly) rather
# than at import time, so a system python that never calls either test never pays for it.
_RESULT: dict | None = None
_ERROR: BaseException | None = None   # Skipped, an AssertionError, a TimeoutExpired: whatever the one run raised


def _cached_run() -> dict:
    global _RESULT, _ERROR
    if _RESULT is None and _ERROR is None:
        try:
            _RESULT = _run()
        except BaseException as e:   # cache the failure too, or the second test pays for a second 10 s run
            _ERROR = e
    if _ERROR is not None:
        raise _ERROR
    assert _RESULT is not None
    return _RESULT


def test_pyright_reports_no_errors():
    out = _cached_run()
    errs = [d for d in out.get("generalDiagnostics", []) if d.get("severity") == "error"]
    lines = [f"  {d['file'].split('/mcp/')[-1]}:{d['range']['start']['line'] + 1}: "
             f"{d['message'].splitlines()[0][:140]}  [{d.get('rule', '')}]" for d in errs[:60]]
    more = f"\n  ... and {len(errs) - 60} more" if len(errs) > 60 else ""
    assert not errs, (f"pyright: {len(errs)} error(s) in brx_mcp/ (run `cd mcp && python3 -m pyright` for the "
                      f"full list; fix the type or the code, never silence with `# type: ignore`):\n"
                      + "\n".join(lines) + more)


def test_pyright_actually_checked_the_package():
    """The floor: `filesAnalyzed` must be a real number, or an `include` typo would pass as clean."""
    summary = _cached_run().get("summary", {})
    n = summary.get("filesAnalyzed", 0)
    assert n >= MIN_FILES_CHECKED, f"pyright analysed only {n} files (summary: {summary}) -- is [tool.pyright] include right?"
