"""The M5StickS3 station's pure core (hardware/m5sticks3/*.h) has host tests in C++.

They pin the IR word codec to the bench-measured timings, the BLE advert to strings produced by
app/src/beacon.js, and the two ownership modes to the 2026-09-10 grenade findings. This runs them
under the same runner as everything else so a change to the headers cannot go green silently.
Skips when there is no g++ (system python without a compiler must stay green).
"""
import pathlib
import shutil
import subprocess
import tempfile

from _skip import needs

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORE = ROOT / "hardware" / "m5sticks3"
TEST = CORE / "test" / "test_core.cpp"
GXX = shutil.which("g++")


def test_sticks3_core_host_tests_pass():
    needs(GXX, "g++")
    assert TEST.exists(), f"{TEST} is missing"
    with tempfile.TemporaryDirectory() as td:
        exe = pathlib.Path(td) / "test_core"
        build = subprocess.run(
            [GXX, "-std=c++17", "-Wall", "-Wextra", "-Werror", f"-I{CORE}", str(TEST), "-o", str(exe)],
            capture_output=True, text=True, timeout=120,
        )
        assert build.returncode == 0, f"g++ failed:\n{build.stdout}\n{build.stderr}"
        run = subprocess.run([str(exe)], capture_output=True, text=True, timeout=60)
        assert run.returncode == 0, f"core tests failed:\n{run.stdout}\n{run.stderr}"
        assert "all checks passed" in run.stdout


def test_sticks3_headers_have_no_arduino_dependency():
    """The core must stay host-testable: nothing in the three headers may pull in Arduino."""
    for name in ("brx_ir.h", "brx_advert.h", "control_point.h"):
        text = (CORE / name).read_text(encoding="utf-8")
        assert "Arduino.h" not in text and "M5Unified" not in text, f"{name} includes Arduino"
