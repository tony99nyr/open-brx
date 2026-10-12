"""scripts/lib/jobs.mjs, the job registry: every test-all job resolves as it did before the registry existed.

WHY (2026-10-11, architecture candidate 5). Five tables named the same jobs: JOBS in test-all.mjs, inputs.mjs (the
cache key), budget.mjs's E2E_SPECS, OTHER_UI_JOBS and TASK_BY_JOB. The registry is one record per job. The fixture
was written by the OLD test-all.mjs (rawJobs, inputsForJob, jobTaskAllowance) over a matrix of budgets, cores, --ui
and filters, free tasks and --no-skip flags, so this test proves the move changed no job's name, directory, command,
environment, cost, cores, flags, task allowance or inputs.

An intended change to a job changes the fixture too. Regenerate it, and read the diff before you commit it:

    node scripts/test/jobs-snapshot.mjs mcp/tests/fixtures/test_all_jobs.json
"""
from __future__ import annotations

import json
from pathlib import Path

from _node import run_node_json

REPO = Path(__file__).resolve().parents[2]
SNAPSHOT = REPO / "scripts" / "test" / "jobs-snapshot.mjs"
FIXTURE = REPO / "mcp" / "tests" / "fixtures" / "test_all_jobs.json"


def _expand(snap: dict) -> list:
    """One entry per (context, job): the dedupe table expanded, so a failure names the job and the context."""
    return [(c["ctx"], snap["records"][i]) for c in snap["combos"] for i in c["jobs"]]


def test_every_job_resolves_as_the_fixture_says():
    want = json.loads(FIXTURE.read_text())
    ctxs = json.dumps([c["ctx"] for c in want["combos"]])
    got = run_node_json(f"import({json.dumps(SNAPSHOT.as_uri())}).then(async m => "
                        f"console.log(JSON.stringify(await m.snapshot({ctxs}))))", cwd=REPO, timeout=60)
    assert len(got["combos"]) == len(want["combos"])
    for (ctx, w), (_, g) in zip(_expand(want), _expand(got), strict=True):
        assert g == w, f"{w['name']} under {ctx}:\n  want {w}\n  got  {g}"
    for c_want, c_got in zip(want["combos"], got["combos"], strict=True):
        assert len(c_got["jobs"]) == len(c_want["jobs"]), c_want["ctx"]
    assert got["inputs"] == want["inputs"]
    assert list(got["inputs"]) == list(want["inputs"])   # the job order too: --list and the queue tie-break read it
    assert got["otherUiJobs"] == want["otherUiJobs"]


def test_the_fixture_covers_every_job_and_the_sized_ones_vary():
    """Not a vacuous pin: the matrix reaches every job, and each sized job takes more than one shape across it."""
    snap = json.loads(FIXTURE.read_text())
    names = {r["name"] for r in snap["records"].values()}
    assert names == set(snap["inputs"]), names ^ set(snap["inputs"])
    shapes = {}
    for r in snap["records"].values():
        shapes.setdefault(r["name"], set()).add(json.dumps(r, sort_keys=True))
    for sized in ("mcp", "chaos", "mc-vitest", "site", "app-screens"):
        assert len(shapes[sized]) > 1, sized
    ports = ["BRX_PORT_END", "BRX_PORT_NEXT", "MC_PORT", "MC_WS_PORT", "VITE_PORT"]   # F523: a block per e2e job
    assert any(r["env"] == {"<ports>": ports} for r in snap["records"].values())
