"""T9 (2026-10-10): hardware/m5sticks3/tools/ci_compile.py, the Stick firmware compile in CI.

CI has no Stick toolchain to test against here, so these read the commands the script would run (`--dry-run`) and
the workflow that runs it: the pinned versions come from toolchain.json, both builds use stick.py's FQBN and flags,
and the workflow runs on every change under hardware/m5sticks3/.
Run: cd mcp && python3 run_tests.py stick_ci_compile
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = REPO / "hardware" / "m5sticks3" / "tools" / "ci_compile.py"
PINS = json.loads((REPO / "hardware" / "m5sticks3" / "toolchain.json").read_text())
WORKFLOW = REPO / ".github" / "workflows" / "stick-firmware.yml"
FQBN = "m5stack:esp32:m5stack_sticks3:PartitionScheme=default_8MB,CDCOnBoot=cdc"


def _dry_run() -> list[str]:
    r = subprocess.run([sys.executable, str(SCRIPT), "--dry-run"], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    return r.stdout.splitlines()


def test_it_installs_exactly_the_pinned_core_and_libraries():
    lines = _dry_run()
    installs = [l for l in lines if " install " in l]
    want = [f"core install {c}@{v}" for c, v in PINS["core"].items()] + [f"lib install {n}@{v}" for n, v in PINS["libraries"].items()]
    assert len(installs) == len(want), installs
    for w in want:
        assert any(w in l for l in installs), (w, installs)
    assert all("--additional-urls https://static-cdn.m5stack.com/" in l for l in installs if "core install" in l), installs


def test_it_compiles_the_flashed_build_and_the_revive_build_with_the_bench_fqbn_and_sha():
    compiles = [l for l in _dry_run() if " compile " in l]
    assert len(compiles) == 2, compiles
    for l in compiles:
        assert f"--fqbn {FQBN}" in l and "-DBRX_FW_SHA=" in l and l.rstrip().endswith("/m5sticks3"), l
    assert "-DBRX_REVIVE_FEEDBACK=1" not in compiles[0] and "-DBRX_REVIVE_FEEDBACK=1" in compiles[1], compiles


def test_the_workflow_runs_the_script_on_any_sketch_change_with_a_cache_keyed_on_the_pins():
    text = WORKFLOW.read_text()
    assert text.count('paths: ["hardware/m5sticks3/**", ".github/workflows/stick-firmware.yml"]') == 2, text
    assert "python3 hardware/m5sticks3/tools/ci_compile.py" in text
    assert "hashFiles('hardware/m5sticks3/toolchain.json')" in text
