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
