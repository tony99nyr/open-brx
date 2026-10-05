"""Task limits and admission maths used by scripts/test-all.mjs."""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
TASKS = REPO / "scripts" / "lib" / "tasks.mjs"
PSS = REPO / "scripts" / "lib" / "pss.mjs"
BUDGET = REPO / "scripts" / "lib" / "budget.mjs"
NODE = shutil.which("node")


def _node(expr):
    needs(NODE, "node")
    source = f"Promise.resolve().then(async()=>{{{expr}}}).then(v=>console.log(JSON.stringify(v)))"
    result = subprocess.run([NODE, "--input-type=module", "-e", source], cwd=REPO,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_task_headroom_uses_limited_ancestor_for_unlimited_leaf():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        cgroup = tmp / "proc-self-cgroup"
        cgroup.write_text("0::parent/leaf\n")
        root = tmp / "sys"
        (root / "parent" / "leaf").mkdir(parents=True)
        (root / "parent" / "pids.max").write_text("5000\n")
        (root / "parent" / "pids.current").write_text("3000\n")
        (root / "parent" / "leaf" / "pids.max").write_text("max\n")
        got = _node(f"const m=await import({json.dumps(TASKS.as_uri())}); return m.taskHeadroom({json.dumps(str(cgroup))},{json.dumps(str(root))});")
        assert got == {"max": 5000, "current": 3000, "free": 2000}


def test_task_headroom_returns_null_when_all_ancestors_are_unlimited():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        cgroup = tmp / "proc-self-cgroup"
        cgroup.write_text("0::parent/leaf\n")
        root = tmp / "sys"
        leaf = root / "parent" / "leaf"
        leaf.mkdir(parents=True)
        (leaf / "pids.max").write_text("max\n")
        (root / "parent" / "pids.max").write_text("max\n")
        (root / "pids.max").write_text("max\n")
        got = _node(f"const m=await import({json.dumps(TASKS.as_uri())}); return m.taskHeadroom({json.dumps(str(cgroup))},{json.dumps(str(root))});")
        assert got is None


def test_task_headroom_returns_null_when_cgroup_files_are_unreadable():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        cgroup = tmp / "proc-self-cgroup"
        cgroup.write_text("0::missing\n")
        got = _node(f"const m=await import({json.dumps(TASKS.as_uri())}); return m.taskHeadroom({json.dumps(str(cgroup))},{json.dumps(str(tmp / 'sys'))});")
        assert got is None


def test_process_tree_task_count_includes_threads_and_descendants():
    with tempfile.TemporaryDirectory() as d:
        proc = Path(d)
        for pid, parent, group, threads in [(10, 1, 10, 2), (11, 10, 11, 3), (12, 1, 12, 4)]:
            directory = proc / str(pid)
            (directory / "task").mkdir(parents=True)
            (directory / "stat").write_text(f"{pid} (job) S {parent} {group} 0\n")
            for thread in range(threads):
                (directory / "task" / str(thread)).touch()
        got = _node(f"const m=await import({json.dumps(PSS.as_uri())}); return m.sumTreeTasks([10],{json.dumps(str(proc))});")
        assert got == 5


def test_task_admission_includes_reserve_and_recent_pending():
    got = _node(f"const m=await import({json.dumps(BUDGET.as_uri())}); return [m.taskAdmission(2000,1500,400,100),m.taskAdmission(2000,1500,401,100)];")
    assert got == ["start", "wait"]


def test_task_screen_shards_obey_headroom_and_keep_one():
    got = _node(f"const m=await import({json.dumps(BUDGET.as_uri())}); return [m.taskScreensShards(16,2220,1500,0),m.taskScreensShards(16,2220,1500,300),m.taskScreensShards(16,1500,1500,0)];")
    assert got == [10, 6, 1]
