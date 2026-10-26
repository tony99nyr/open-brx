"""T7, T8 and OP14 (2026-10-10 review): a test run that proves nothing must not read as green.

- T7: `run_tests.py` with a filter that matches no file ran nothing and exited 0; a failed extras install turned the MC
  tests into skips and CI stayed green. Now no match exits 2, and `--no-skip <reason>` fails a run on such a skip.
- T8: a stray `ONLY` in the shell reached every test-all job and shrank the browser gates to nothing.
- OP14: a CI job with no time limit holds a runner for GitHub's 6 h default.
Run: cd mcp && python3 run_tests.py run_tests_guards
"""
from __future__ import annotations

import json
import ast
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

from _node import run_node_json

MCP = pathlib.Path(__file__).resolve().parents[1]
REPO = MCP.parent
NODE = shutil.which("node")


def _run_tests(cwd: pathlib.Path, *args: str, inline: bool = True) -> subprocess.CompletedProcess:
    mode = ["--inline"] if inline else ["-j", "1"]   # CI and test-all use the parallel path
    return subprocess.run([sys.executable, "run_tests.py", *mode, *args], cwd=cwd, capture_output=True,
                          text=True, timeout=120)


def test_a_filter_that_matches_no_file_exits_2():
    r = _run_tests(MCP, "no_such_test_file_xyz")
    assert r.returncode == 2 and "no test file matches no_such_test_file_xyz" in r.stderr, r.stdout + r.stderr


def test_no_skip_fails_a_run_whose_skip_reason_matches_and_only_then():
    # A copy of the runner with one test that skips for want of "fakedep", so the real suite is not involved.
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        shutil.copy(MCP / "run_tests.py", root / "run_tests.py")
        (root / "tests").mkdir()
        shutil.copy(MCP / "tests" / "_skip.py", root / "tests" / "_skip.py")
        (root / "tests" / "test_fake.py").write_text(
            "from _skip import needs, xfail\n\ndef test_needs_fakedep():\n    needs(False, 'fakedep')\n\n"
            "def test_needs_a_longer_name():\n    needs(False, 'fakedepx + other')\n\n"
            "def test_an_xfail_naming_it():\n    xfail('F999: fakedep reconnect drops', lambda: (_ for _ in ()).throw(AssertionError()))\n\n"
            "def test_passes():\n    assert True\n")
        plain = _run_tests(root, "fake")
        assert plain.returncode == 0 and "skipped 1: needs fakedep" in plain.stdout, plain.stdout + plain.stderr
        other = _run_tests(root, "fake", "--no-skip", "starlette")
        assert other.returncode == 0, other.stdout + other.stderr
        for inline in (True, False):
            banned = _run_tests(root, "fake", "--no-skip", "fakedep", inline=inline)
            assert banned.returncode == 1 and "not allowed here" in banned.stderr, (inline, banned.stdout + banned.stderr)
            # whole tokens only: "fakedepx" and the xfail's free text do not count
            assert "1 need fakedep" in banned.stderr and "fakedepx" not in banned.stderr and "F999" not in banned.stderr, \
                banned.stderr


def test_ci_extras_pass_forbids_a_skip_for_every_extra_it_installs():
    ci = (REPO / ".github" / "workflows" / "ci.yml").read_text()
    lines = ci.splitlines()
    pip = next(i for i, l in enumerate(lines) if "pip install" in l and "starlette" in l)
    run = next(l for l in lines[pip + 1:] if "run_tests.py" in l)
    for extra in ("starlette", "uvicorn", "websockets", "httpx", "pyright", "bleak"):
        assert f"--no-skip {extra}" in run, (extra, run)


def test_ci_checks_followups_freshness_on_main_push_only():
    ci = (REPO / ".github" / "workflows" / "ci.yml").read_text()
    mcp = ci.split("  mcp:\n", 1)[1].split("\n  webapp-mc:", 1)[0]
    runs = re.findall(r"^      - run: cd mcp && python3 run_tests.py.*(?:\n        .*)*", mcp, re.M)
    assert len(runs) == 2, runs
    for run in runs:
        assert "BRX_FOLLOWUPS_INDEX_FRESH: ${{ github.event_name == 'push' && '1' || '' }}" in run, run


def test_test_all_jobs_never_see_a_single_scripts_debug_switch():
    if not NODE:
        from _skip import needs
        needs(False, "node")
    script = ("import { stripDebugEnv } from './scripts/lib/jobenv.mjs';"
              "console.log(JSON.stringify(stripDebugEnv({ ONLY: 'x', HEADED: '1', KEEP_SHOTS: '1', DBG: '1', ALLOW_STALE: '1', PATH: 'p' })));")
    got = run_node_json(script, cwd=REPO)
    assert got["env"] == {"PATH": "p"} and sorted(got["dropped"]) == ["ALLOW_STALE", "DBG", "HEADED", "KEEP_SHOTS", "ONLY"], got
    # ...and test-all spawns every job from that env, not from process.env.
    # (the runner moved to scripts/lib/job-runner.mjs, A10 stage 2: it spawns from `baseEnv`, which test-all builds from jobEnv)
    src = (REPO / "scripts" / "test-all.mjs").read_text()
    assert "baseEnv: { ...jobEnv, MC_PY: PY }" in src
    runner = (REPO / "scripts" / "lib" / "job-runner.mjs").read_text()
    spawns = re.findall(r"spawn\(cmd\[0\].*?env: \{ \.\.\.(\w+)", runner)
    assert spawns == ["baseEnv"], spawns


def test_test_all_jobs_never_inherit_the_wayland_display():
    # 2026-10-24: a stalled WSLg compositor hung every headless Chromium page.screenshot ("waiting for fonts to load")
    # while WAYLAND_DISPLAY was set, so every browser gate timed out. A headless browser never needs a display.
    if shutil.which("node") is None:
        from _skip import needs
        needs(False, "node")
    script = ("import { stripDebugEnv } from './scripts/lib/jobenv.mjs';"
              "console.log(JSON.stringify(stripDebugEnv({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0', PATH: 'p' })));")
    got = run_node_json(script, cwd=REPO)
    assert got["env"] == {"DISPLAY": ":0", "PATH": "p"} and got["dropped"] == [], got


def test_every_ci_job_has_a_time_limit():
    for wf in sorted((REPO / ".github" / "workflows").glob("*.yml")):
        lines = wf.read_text().splitlines()
        start = lines.index("jobs:")
        jobs, current = {}, None
        for l in lines[start + 1:]:
            m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", l)
            if m:
                current = m.group(1)
                jobs[current] = False
            elif current and re.match(r"^    timeout-minutes: \d+", l):
                jobs[current] = True
        assert jobs and all(jobs.values()), (wf.name, jobs)


def test_test_all_holds_only_its_own_venv_to_the_extras_and_caches_on_the_job_env():
    src = (REPO / "scripts" / "test-all.mjs").read_text()
    assert "const NO_SKIP = noSkipFor({ foundVenv," in src   # F613: the set lives in lib/python.mjs noSkipFor
    assert "const reasons = foundVenv ? ['websockets', 'uvicorn'] : [];" in (REPO / "scripts" / "lib" / "python.mjs").read_text()   # extras: never MC_PY or system python
    assert "import { findPython, noSkipFor } from './lib/python.mjs';" in src and "findPython(ROOT)" in src and "function findPython" not in src
    lib = (REPO / "scripts" / "lib" / "python.mjs").read_text()
    assert "foundVenv: Boolean(found)" in lib and "if (process.env.MC_PY) return { python: process.env.MC_PY, foundVenv: false };" in lib
    assert "findPython(ROOT)" in (REPO / "scripts" / "regen.mjs").read_text()   # one resolver for both runners
    assert "cacheBypassReason(jobEnv)" in src


def test_split_keys_name_existing_files_and_have_multiple_chunks():
    tree = ast.parse((MCP / "run_tests.py").read_text())
    assignment = next(n for n in tree.body if isinstance(n, ast.Assign)
                      and any(isinstance(t, ast.Name) and t.id == "SPLIT" for t in n.targets))
    split = ast.literal_eval(assignment.value)
    files = {p.stem for p in (MCP / "tests").glob("test_*.py")}
    assert all(key in files and isinstance(chunks, int) and chunks > 1
               for key, chunks in split.items()), split


def test_ci_browser_gate_is_blocking_exactly_when_f512_is_closed():
    # T17 (2026-10-11): one browser gate in CI, non-blocking for its first week. The switch to blocking is a decision
    # with a date, so the job and FOLLOWUPS F512 must change together: blocking only once F512 is closed. F512 closed
    # 2026-10-26, so this now keeps the job blocking unless the row is reopened.
    ci = (REPO / ".github" / "workflows" / "ci.yml").read_text()
    job = ci.split("\n  mc-play:\n")[1].split("\n\n  ")[0]
    assert "test/e2e/play.mjs" in job and "MC_PY=" in job and "timeout-minutes:" in job, job
    followups = (REPO / "docs" / "FOLLOWUPS.md").read_text()
    open_row = "- **F512 " in followups
    assert ("continue-on-error: true" in job) == open_row, (
        "mc-play is blocking exactly when F512 is closed: reopen F512 if you add continue-on-error back")
