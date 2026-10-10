"""T7, T8 and OP14 (2026-10-10 review): a test run that proves nothing must not read as green.

- T7: `run_tests.py` with a filter that matches no file ran nothing and exited 0; a failed extras install turned the MC
  tests into skips and CI stayed green. Now no match exits 2, and `--no-skip <reason>` fails a run on such a skip.
- T8: a stray `ONLY` in the shell reached every test-all job and shrank the browser gates to nothing.
- OP14: a CI job with no time limit holds a runner for GitHub's 6 h default.
Run: cd mcp && python3 run_tests.py run_tests_guards
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

MCP = pathlib.Path(__file__).resolve().parents[1]
REPO = MCP.parent
NODE = shutil.which("node")


def _run_tests(cwd: pathlib.Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "run_tests.py", "--inline", *args], cwd=cwd, capture_output=True,
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
            "from _skip import needs\n\ndef test_needs_fakedep():\n    needs(False, 'fakedep')\n\n"
            "def test_passes():\n    assert True\n")
        plain = _run_tests(root, "fake")
        assert plain.returncode == 0 and "skipped 1: needs fakedep" in plain.stdout, plain.stdout + plain.stderr
        other = _run_tests(root, "fake", "--no-skip", "starlette")
        assert other.returncode == 0, other.stdout + other.stderr
        banned = _run_tests(root, "fake", "--no-skip", "fakedep")
        assert banned.returncode == 1 and "not allowed here" in banned.stderr and "fakedep" in banned.stderr, \
            banned.stdout + banned.stderr


def test_ci_extras_pass_forbids_a_skip_for_every_extra_it_installs():
    ci = (REPO / ".github" / "workflows" / "ci.yml").read_text()
    lines = ci.splitlines()
    pip = next(i for i, l in enumerate(lines) if "pip install" in l and "starlette" in l)
    run = next(l for l in lines[pip + 1:] if "run_tests.py" in l)
    for extra in ("starlette", "uvicorn", "websockets", "httpx", "pyright", "bleak"):
        assert f"--no-skip {extra}" in run, (extra, run)


def test_test_all_jobs_never_see_a_single_scripts_debug_switch():
    if not NODE:
        from _skip import needs
        needs(False, "node")
    script = ("import { stripDebugEnv } from './scripts/lib/jobenv.mjs';"
              "console.log(JSON.stringify(stripDebugEnv({ ONLY: 'x', HEADED: '1', KEEP_SHOTS: '1', DBG: '1', PATH: 'p' })));")
    out = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert got["env"] == {"PATH": "p"} and sorted(got["dropped"]) == ["DBG", "HEADED", "KEEP_SHOTS", "ONLY"], got
    # ...and test-all spawns every job from that env, not from process.env.
    src = (REPO / "scripts" / "test-all.mjs").read_text()
    spawns = re.findall(r"spawn\(cmd\[0\].*?env: \{ \.\.\.(\w+)", src)
    assert spawns == ["jobEnv"], spawns


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
