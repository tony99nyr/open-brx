"""scripts/lib/scheduler.mjs: test-all's admission in one module (architecture #3, the 2026-10-10 tooling review).

WHY. The start rule lived twice (pump() in test-all.mjs and planPeakMb, a hand-kept mirror), the pool size callbacks were
inline closures no test could drive, and the run's tally debited a job's planned `mb` while the pool leased its
admission-sized `mb`. These tests drive the real module; the last ones check test-all.mjs calls it.
"""
import json
import re
from pathlib import Path

from _node import run_node_json

REPO = Path(__file__).resolve().parents[2]
SCHEDULER = (REPO / "scripts" / "lib" / "scheduler.mjs").as_uri()
BUDGET = (REPO / "scripts" / "lib" / "budget.mjs").as_uri()
RUNNER = REPO / "scripts" / "test-all.mjs"


def _node(body: str):
    expr = (f"const m = await import({json.dumps(SCHEDULER)}); const b = await import({json.dumps(BUDGET)});\n"
            f"console.log(JSON.stringify(await (async () => {{ {body} }})()));")
    return run_node_json(expr, cwd=REPO)


def test_start_order_is_longest_first_and_keeps_ties_in_registry_order():
    got = _node("return m.startOrder([{name:'a',secs:5},{name:'b',secs:9},{name:'c',secs:5},{name:'d',secs:1}]).map(j => j.name);")
    assert got == ["b", "a", "c", "d"]


def test_take_startable_fills_the_ceiling_and_lets_a_smaller_job_past_a_big_one():
    got = _node("const q = [{name:'big',mb:600},{name:'huge',mb:900},{name:'small',mb:300},{name:'tiny',mb:100}];"
                " const started = m.takeStartable(q, { usedMb: 0, running: 0, ceilingMb: 1000 });"
                " return { started: started.map(j => j.name), left: q.map(j => j.name) };")
    assert got == {"started": ["big", "small", "tiny"], "left": ["huge"]}


def test_take_startable_runs_a_job_bigger_than_the_ceiling_alone():
    got = _node("const q = [{name:'huge',mb:5000},{name:'small',mb:100}];"
                " const idle = m.takeStartable([...q], { usedMb: 0, running: 0, ceilingMb: 1000 }).map(j => j.name);"
                " const busy = m.takeStartable([...q], { usedMb: 200, running: 1, ceilingMb: 1000 }).map(j => j.name);"
                " return { idle, busy };")
    assert got == {"idle": ["huge"], "busy": ["small"]}


def test_plan_peak_follows_the_start_rule():
    # 600 and 300 start (900); the 500 waits for the 300 (secs 2) to finish; peak 900, then 600 + 500 = 1100 > 1000,
    # so the 500 waits for the 600 as well and runs alone.
    got = _node("return m.planPeakMb([{mb:600,secs:10},{mb:300,secs:2},{mb:500,secs:5}], 1000);")
    assert got == 900


def test_admit_sizes_a_job_at_this_runs_share_of_what_is_free():
    got = _node("const calls = [];"
                " const resolve = (budgetMb, cpus) => { calls.push([budgetMb, cpus]);"
                "   return [{ name: 'mcp', mb: Math.round(budgetMb / 10), cores: cpus, ui: false }]; };"
                " const a = m.admit({ name: 'mcp', mb: 800 }, { freeMb: 3000, freeCores: 4, freeTasks: 1e9 },"
                "   { ownMb: 8000, ownCores: 16, resolve });"
                " return { calls, a };")
    assert got["calls"] == [[3000, 4]]                    # the smaller of this run's budget and the pool's free memory
    assert got["a"]["request"] == {"mb": 300, "cores": 4, "tasks": 70}
    assert got["a"]["sized"]["mb"] == 300


def test_admit_holds_app_screens_to_its_shard_floor_from_the_uncut_plan():
    # 2026-10-11: a loaded box sized app-screens to one shard, which cannot finish inside the timeout cap. The floor reads
    # the job's uncut plan (`screensCap`), not the start-up task cut, and the request is sized for the floor.
    got = _node("const resolve = () => [{ name: 'app-screens', screensShards: 1, mb: 1, cores: 1, env: { X: '1' } }];"
                " const free = { freeMb: 400, freeCores: 1, freeTasks: b.TASK_ALLOWANCES.screensShard };"
                " const a = m.admit({ name: 'app-screens', screensCap: 6, mb: 2000 }, free, { ownMb: 8000, ownCores: 16, resolve });"
                " return { a, floor: b.SCREENS_MIN_SHARDS, size: b.screensJobSize(b.SCREENS_MIN_SHARDS),"
                "   perShard: b.TASK_ALLOWANCES.screensShard };")
    floor = got["floor"]
    assert got["a"]["sized"]["screensShards"] == floor and got["a"]["sized"]["env"] == {"X": "1", "SCREENS_SHARDS": str(floor)}
    assert got["a"]["request"] == {"mb": got["size"]["mb"], "cores": got["size"]["cores"], "tasks": got["perShard"] * floor}


def test_screens_raise_takes_what_memory_cores_and_tasks_all_hold():
    got = _node("const per = b.TASK_ALLOWANCES.screensShard, mb = b.SCREENS_SHARD_MB;"
                " return [m.screensRaise(5, { freeMb: mb * 3, freeCores: 8, freeTasks: per * 9 }),"
                "   m.screensRaise(5, { freeMb: mb * 9, freeCores: 2, freeTasks: per * 9 }),"
                "   m.screensRaise(5, { freeMb: 0, freeCores: 8, freeTasks: per * 9 }), { per, mb }];")
    by_mem, by_cores, none, unit = got
    assert by_mem == {"admitted": 3, "request": {"mb": unit["mb"] * 3, "cores": 3, "tasks": unit["per"] * 3}}
    assert by_cores["admitted"] == 2
    assert none["admitted"] == 0 and none["request"]["cores"] == 1   # asks for one shard, which the pool then refuses


def test_test_all_admits_through_the_scheduler_and_keeps_no_copy_of_its_rules():
    src = RUNNER.read_text()
    assert "takeStartable(queue, { usedMb, running, ceilingMb: PLAN_BUDGET_MB })" in src
    assert "admit(j, free, { ownMb: BUDGET_MB, ownCores: CPUS, resolve: rawJobs })" in src
    assert "screensRaise(more, free)" in src
    # no second copy of the start rule, the share or the shard floor
    assert not re.search(r"usedMb \+ j\.mb >", src)
    for name in ("admissionShare(", "screensAdmissionShards(", "extraLeaseCores("):
        assert name not in src, name


def test_the_tally_debits_the_size_the_pool_admitted():
    # The pool leases the admitted size; the run's own tally (which gates the next start) must use the same number.
    src = RUNNER.read_text()
    assert "usedMb += runJob.mb - debitMb; debitMb = runJob.mb;" in src
    assert "usedMb -= debitMb; running--;" in src and "usedMb -= j.mb" not in src
