"""The M5StickS3 station's pure core (hardware/m5sticks3/*.h) has host tests in C++.

They pin the IR word codec to the bench-measured timings, the BLE advert to strings produced by
app/src/beacon.js, and the two ownership modes to the 2026-09-10 grenade findings. This runs them
under the same runner as everything else so a change to the headers cannot go green silently.
Skips when there is no g++ (system python without a compiler must stay green).

H8 (2026-09-24) added a second host binary, `test/test_link.cpp`, for the Mission Control link core
(`station_link.h` + `json_lite.h`): the hello/status JSON builders, the tolerant parsers, and the
link state machine. It is built and run the same way as `test_core.cpp` below. A new C++ test file
under `test/` belongs in `TEST_FILES` here, or it never runs anywhere (`mcp/tests/test_utility_esp32.py`
also builds `test_link.cpp` directly, in its own golden-dump mode -- see that file's docstring)."""
import pathlib
import re
import shutil
import subprocess
import tempfile

from _skip import needs

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORE = ROOT / "hardware" / "m5sticks3"
TEST_FILES = ("test_core.cpp", "test_link.cpp", "test_ui.cpp", "test_screen.cpp", "test_presence.cpp", "test_range.cpp")
# Revive feedback is post-MVP and off by default (presence.h REVIVE_FEEDBACK_ENABLED). These files test
# both sides of that switch, so they are also built with it on: the post-MVP path cannot rot.
REVIVE_ON_FILES = ("test_link.cpp", "test_screen.cpp", "test_presence.cpp")
GXX = shutil.which("g++")


def _build_and_run(name: str, defines: tuple = ()):
    src = CORE / "test" / name
    assert src.exists(), f"{src} is missing"
    with tempfile.TemporaryDirectory() as td:
        exe = pathlib.Path(td) / src.stem
        build = subprocess.run(
            [GXX, "-std=c++17", "-Wall", "-Wextra", "-Werror", *defines, f"-I{CORE}", str(src), "-o", str(exe)],
            capture_output=True, text=True, timeout=120,
        )
        assert build.returncode == 0, f"g++ failed on {name} {defines}:\n{build.stdout}\n{build.stderr}"
        run = subprocess.run([str(exe)], capture_output=True, text=True, timeout=60)
        assert run.returncode == 0, f"{name} {defines} failed:\n{run.stdout}\n{run.stderr}"
        assert "all checks passed" in run.stdout, run.stdout


def test_sticks3_core_host_tests_pass():
    needs(GXX, "g++")
    for name in TEST_FILES[:3]:
        _build_and_run(name)


def test_sticks3_core_host_tests_pass_part_2():  # a second function, so SPLIT runs the two halves in parallel
    needs(GXX, "g++")
    for name in TEST_FILES[3:]:
        _build_and_run(name)


def test_sticks3_host_tests_pass_with_revive_feedback_on():
    needs(GXX, "g++")
    for name in REVIVE_ON_FILES:
        _build_and_run(name, ("-DBRX_REVIVE_FEEDBACK=1",))


def test_sticks3_headers_have_no_arduino_dependency():
    """The core must stay host-testable: nothing in these headers may pull in Arduino."""
    for name in ("brx_ir.h", "brx_advert.h", "control_point.h", "station_link.h", "json_lite.h",
                 "station_ui.h", "station_screen.h", "presence.h", "stick_state.h", "station_range.h"):
        text = (CORE / name).read_text(encoding="utf-8")
        assert "Arduino.h" not in text and "M5Unified" not in text, f"{name} includes Arduino"


def test_f391_lock_restore_contract_matches_firmware():
    link = (CORE / "station_link.h").read_text(encoding="utf-8")
    interval_ms = int(re.search(r"MATCH_LOCK_SAVE_INTERVAL_MS = (\d+)", link).group(1))
    cap_s = int(re.search(r"MATCH_LOCK_RESTORE_MAX_S = (\d+)", link).group(1))
    assert interval_ms == 300000 and cap_s == 120
    contracts = (ROOT / "docs/spec/contracts.md").read_text(encoding="utf-8")
    a58 = next(line for line in contracts.splitlines() if line.startswith("| A58 |"))
    utility = (ROOT / "docs/spec/utility.md").read_text(encoding="utf-8")
    assert "at most once per five minutes" in a58
    assert "at most 120 seconds" in a58 and "saved game byte" in a58
    assert "at most once per five minutes" in utility
    assert "at most 120 seconds" in utility and "saved game byte" in utility


def test_stick_readme_idle_brightness_matches_firmware():
    firmware = (CORE / "m5sticks3.ino").read_text(encoding="utf-8")
    dim = int(re.search(r"BACKLIGHT_DIM = (\d+)", firmware).group(1))
    readme = (CORE / "README.md").read_text(encoding="utf-8")
    assert f"from 120 to {dim}" in readme


def test_f389_pending_muster_drop_keeps_socket_polling():
    glue = (CORE / "mc_link_glue.h").read_text(encoding="utf-8")
    assert "mc_dial_allowed(wifiUp, link.radio_down_for_match(), linkOff)" in glue
    assert "mc_dial_allowed(wifiUp, link.dropped_for_match(), linkOff)" not in glue


def test_f391_lock_snapshot_checks_nvs_result():
    glue = (CORE / "mc_link_glue.h").read_text(encoding="utf-8")
    assert "lockSnapshotWritten" in glue
    assert "lockClearPending" in glue
