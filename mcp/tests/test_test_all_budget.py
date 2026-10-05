"""scripts/lib/budget.mjs: the pure scheduling math scripts/test-all.mjs uses for its worker/shard counts.

WHY (2026-09-27). An audit found the app-screens job's `secs: 1500 / SCREENS_S` estimate about 4x too small
(1286 steps actually cost about 6300 shard-seconds), so test-all.mjs's own 3x-typical kill timeout fired
under load. These tests pin the corrected numbers by calling the REAL node module (not reimplementing its
maths here), so a future retune has to change budget.mjs, and this test catches drift the moment it does.
"""
import json
import shutil
import subprocess
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
BUDGET = REPO / "scripts" / "lib" / "budget.mjs"
RUNNER = REPO / "scripts" / "test-all.mjs"
PSS = REPO / "scripts" / "lib" / "pss.mjs"
NODE = shutil.which("node")


def _call(fn: str, *args: float) -> dict:
    needs(NODE, "node")
    expr = (
        f"import({json.dumps(BUDGET.as_uri())}).then(m => "
        f"console.log(JSON.stringify(m.{fn}({', '.join(str(a) for a in args)}))))"
    )
    res = subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=REPO,
                          capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def _call_expr(body: str) -> dict:
    """Like _call, but `body` is a JS expression with `m` bound to the imported module (for the tests below,
    which need more than one function call to build a job list before checking it)."""
    needs(NODE, "node")
    expr = f"import({json.dumps(BUDGET.as_uri())}).then(m => {{ console.log(JSON.stringify({body})); }})"
    res = subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=REPO,
                          capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_screens_budget_caps_at_16_shards_on_a_big_box():
    b = _call("screensBudget", 32, 8000)
    assert b["shards"] == 16, b
    assert b["mb"] == 3940, b   # about 3.9 GB, as the audit suggested
    assert b["mb"] <= 4000


def test_screens_budget_secs_gives_3x_headroom_over_the_real_wall_time():
    b = _call("screensBudget", 32, 8000)
    # Real measured cost is ~6300 shard-seconds; at 16 shards that is ~394s wall time. The job's
    # `secs` must be close to THAT (not the old, 4x-too-small 1500/S estimate) so
    # `Math.max(JOB_TIMEOUT_S, 3 * secs)` in test-all.mjs gives real headroom instead of firing early.
    assert 350 < b["secs"] < 450, b
    old_estimate = 1500 / b["shards"]
    assert b["secs"] > old_estimate * 3, "still using the stale, 4x-too-small estimate"


def test_screens_budget_scales_down_on_a_small_box():
    b = _call("screensBudget", 4, 1500)
    assert b["shards"] <= 2, b
    assert b["mb"] <= 100 + 240 * 2


def test_screens_budget_never_goes_below_one_shard():
    b = _call("screensBudget", 1, 100)
    assert b["shards"] == 1, b


def test_worker_count_respects_the_cap_and_the_memory_share():
    # 32 cores / 4 = 8 workers, capped at `cap`; 8000 MB budget / 4 / 70 MB ~= 28, so the cap (16) wins.
    assert _call("workerCount", 70, 16, 32, 8000) == 8
    # A tiny memory budget throttles workers below the cpu share.
    assert _call("workerCount", 300, 8, 32, 800) == 1
    # Never below 1, even with almost no budget or cores.
    assert _call("workerCount", 300, 8, 1, 1) == 1


def test_admission_share_caps_workers_and_shards_to_pool_capacity():
    result = _call_expr(
        "(() => {"
        "  const share = m.admissionShare(8000, 1200, 32, 4);"
        "  return { share, workers: m.workerCount(70, 16, share.cpus, share.budgetMb),"
        "    screens: m.screensBudget(share.cpus, share.budgetMb) };"
        "})()"
    )
    assert result["share"] == {"budgetMb": 1200, "cpus": 4}
    assert result["workers"] <= 1
    assert result["screens"]["shards"] <= 2
    assert result["screens"]["mb"] <= 100 + 240 * 2


def test_admission_share_keeps_one_worker_on_a_tiny_free_pool():
    share = _call("admissionShare", 500, 100, 8, 2)
    assert share == {"budgetMb": 100, "cpus": 2}


def test_job_task_allowances_match_measured_use_and_preserve_explicit_values():
    result = _call_expr(
        "(() => ({"
        "  site: m.jobTaskAllowance({ name: 'site' }),"
        "  appTest: m.jobTaskAllowance({ name: 'app-test' }),"
        "  oneScreensShard: m.jobTaskAllowance({ name: 'app-screens', screensShards: 1 }),"
        "  threeScreensShards: m.jobTaskAllowance({ name: 'app-screens', screensShards: 3 }),"
        "  otherUi: m.jobTaskAllowance({ name: 'mc-game-edit', ui: true }),"
        "  other: m.jobTaskAllowance({ name: 'mcp' }),"
        "  mcPlay: m.jobTaskAllowance({ name: 'mc-play', ui: true }),"
        "  mcVitest: m.jobTaskAllowance({ name: 'mc-vitest' }),"
        "  explicit: m.jobTaskAllowance({ name: 'site', tasks: 17 }),"
        "}))()"
    )
    assert result == {
        "site": 660,
        "appTest": 340,
        "oneScreensShard": 70,
        "threeScreensShards": 210,
        "otherUi": 240,
        "other": 70,
        "mcPlay": 300,
        "mcVitest": 100,
        "explicit": 17,
    }, result


def test_derive_timeout_s_uses_3x_typical_in_the_ordinary_case():
    assert _call("deriveTimeoutS", 600, 65) == 600      # 3*65=195 < the 600s floor
    assert _call("deriveTimeoutS", 600, 300) == 900      # 3*300=900 > the floor, under the cap


def test_derive_timeout_s_caps_the_derived_term_on_a_starved_box():
    # 2026-09-27 review: 1 app-screens shard makes secs=6300, and 3x that (18900s, over 5 hours) must not become
    # the actual kill timeout -- it is capped at 3600s here, well below the 5+ hour figure the bug produced.
    assert _call("deriveTimeoutS", 600, 6300) == 3600
    assert _call("deriveTimeoutS", 600, 6300) < 3 * 6300


def test_derive_timeout_s_never_undercuts_an_explicit_job_timeout_s_floor():
    # An operator's explicit JOB_TIMEOUT_S past the cap is never silently capped: only the DERIVED (3x) term is.
    assert _call("deriveTimeoutS", 5000, 65) == 5000


# F429/F430 (2026-09-27): two e2e jobs were killed mid-run ("Target page, context or browser has been closed")
# while test-all.mjs's own printed total sat at 7990 of an 8000 MB budget -- no margin at all for a job's `mb`
# running low. HEADROOM, screensBudget's `otherUiMb` reservation and the scheduler's own ceiling (test-all.mjs's
# PLAN_BUDGET_MB) exist to keep that from happening again; these tests pin the guarantee at the planning-math
# level, on the actual OTHER_UI_JOBS this repo runs, so a retuned mb/secs can't quietly drift past it.

def test_screens_budget_reserves_room_for_the_other_ui_jobs():
    # Passing otherUiMb shrinks app-screens' share; a huge otherUiMb (more than the whole budget, as a real
    # --ui run's OTHER_UI_JOBS sum is) still leaves it its historical fair half of the HEADROOM target, not zero.
    plain = _call("screensBudget", 32, 8000)
    reserved = _call("screensBudget", 32, 8000, 100000)
    assert reserved["mb"] < plain["mb"], (plain, reserved)
    assert reserved["shards"] >= 1, reserved
    half = 8000 * 0.85 / 2
    assert abs(reserved["mb"] - (100 + 240 * min(16, int(half // 240)))) < 240, reserved


def test_full_ui_plan_stays_within_headroom():
    """Mirrors test-all.mjs's rawJobs(): a full `--ui` run selects app-screens AND every OTHER_UI_JOBS entry at
    once (the exact scenario that produced F429/F430). app-screens is sized against what is left of the HEADROOM
    target after OTHER_UI_JOBS's own mb is totalled, then the whole plan (screens plus every other UI job) is
    bin-packed (planPeakMb, the same greedy scheduler test-all.mjs's pump() runs) against that same HEADROOM
    ceiling. The result must never plan to use more than HEADROOM's slice of the budget."""
    result = _call_expr(
        "(() => {"
        "  const cpus = 32, budgetMb = 8000;"
        "  const otherMb = m.OTHER_UI_JOBS.reduce((s, j) => s + j.mb, 0);"
        "  const screens = m.screensBudget(cpus, budgetMb, otherMb);"
        "  const ceiling = budgetMb * m.HEADROOM;"
        "  const jobs = [{ mb: screens.mb, secs: screens.secs }, ...m.OTHER_UI_JOBS];"
        "  const peak = m.planPeakMb(jobs, ceiling);"
        "  return { peak, ceiling, budgetMb, otherMb, screensMb: screens.mb };"
        "})()"
    )
    assert result["peak"] <= result["ceiling"], result
    assert result["peak"] <= result["budgetMb"] * 0.85, result
    # Not a vacuous pass: with the OTHER_UI_JOBS this repo runs today, the plan gets close to (not just under) the
    # ceiling, so a regression that removed the cap would show up as `peak` jumping toward `budgetMb`, not `peak`
    # trivially sitting at 0.
    assert result["peak"] > result["ceiling"] * 0.5, result


def test_pss_sampler_counts_detached_descendant_processes():
    import os
    import signal
    import time

    if not Path("/proc/self/smaps_rollup").exists():
        import pytest
        pytest.skip("Linux /proc PSS is required")
    needs(NODE, "node")
    launcher = subprocess.Popen(
        [NODE, "--input-type=module", "-e", """
          import { spawn } from 'node:child_process';
          const child = spawn(process.execPath, ['-e', 'const b=Buffer.alloc(50*1024*1024); for(let i=0;i<b.length;i+=4096)b[i]=1; setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
          console.log(child.pid);
          setInterval(()=>{},1000);
        """], stdout=subprocess.PIPE, text=True,
    )
    grandchild = None
    try:
        assert launcher.stdout is not None
        grandchild = int(launcher.stdout.readline().strip())
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = subprocess.run(
                [NODE, "--input-type=module", "-e",
                 f"import({json.dumps(PSS.as_uri())}).then(m=>console.log(m.sumTreePssKb([{launcher.pid}])))"],
                capture_output=True, text=True, timeout=5,
            )
            assert result.returncode == 0, result.stderr
            if int(result.stdout.strip()) >= 35 * 1024:
                break
            time.sleep(0.1)
        assert int(result.stdout.strip()) >= 35 * 1024, "detached 50 MB descendant was not counted"
    finally:
        for pid in (grandchild, launcher.pid):
            if pid:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        launcher.wait(timeout=5)


def test_runner_samples_pss_and_isolates_each_job_home():
    source = RUNNER.read_text()
    assert "sumTreePssKb" in source
    assert "const sampleTimer = canSamplePss || canSampleTreeTasks || taskStart ? setInterval(" in source
    assert "sumTreeTasks([pgid])" in source and "item.setTasks(observed[index])" in source
    assert "try { samplePss(); }" in source
    assert "realPeak" in source and "not measured" in source
    assert "${name}-brx-mcp-home" in source
    assert "BRX_MCP_HOME: jobHome" in source


def test_build_and_e2e_jobs_have_distinct_log_names():
    source = RUNNER.read_text()
    assert "withBuildLease('mc-dist-build'" in source
    assert "run('mc-build'" not in source


def test_measured_worker_jobs_do_not_use_worker_count_memory_formula():
    source = RUNNER.read_text()
    assert "name: 'mc-vitest'" in source and "mb: 300 + 300 * vitestW" in source
    assert "name: 'site'" in source and "mb: 300 + 300 * siteW" in source
