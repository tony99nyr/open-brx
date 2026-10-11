"""The M5StickS3 station's pure core (hardware/m5sticks3/*.h) has host tests in C++.

They pin the IR word codec to the bench-measured timings, the BLE advert to strings produced by
app/src/beacon.js, and the two ownership modes to the 2026-09-10 grenade findings. This runs them
under the same runner as everything else so a change to the headers cannot go green silently.
Skips when there is no g++ (system python without a compiler must stay green).

H8 (2026-09-24) added a second host binary, `test/test_link.cpp`, for the Mission Control link core
(`station_link.h` + `json_lite.h`): the hello/status JSON builders, the tolerant parsers, and the
link state machine. It is built and run the same way as `test_core.cpp` below. A new C++ test file
under `test/` belongs in `TEST_FILES` here, or it never runs anywhere (`mcp/tests/test_utility_esp32.py`
also builds `test_link.cpp` directly, in its own golden-dump mode -- see that file's docstring).

Build cache (efficiency, 2026-10-10): each binary is cached under ~/.cache/brx-sticks3-host/, keyed by a hash
of every C/C++ source in hardware/m5sticks3, the tree's absolute path (three tests find a fixture from
__FILE__), the compiler path, `g++ --version`, gcc's include environment, the flags, the defines and the file.
A run with no change to that tree is EXPECTED to hit the cache and compile nothing; every binary still runs,
every time. A changed header, compiler or flag is a new key, so a stale binary can never run. An entry is
written once, through os.replace, and never changed; a corrupt one (its sha256 does not match) is rebuilt.
The newest 10 tree keys are kept, plus any tree used in the last hour. BRX_STICKS3_CACHE=0 turns the cache off and builds in a temp dir."""
import functools
import hashlib
import os
import time
import pathlib
import re
import shutil
import subprocess
import tempfile

from _skip import needs

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORE = ROOT / "hardware" / "m5sticks3"
TEST_FILES = ("test_core.cpp", "test_link.cpp", "test_ui.cpp", "test_screen.cpp", "test_presence.cpp", "test_range.cpp",
              "test_powerup_cases.cpp", "test_presence_cases.cpp", "test_threshold_default.cpp", "test_team_contract.cpp", "test_nvs.cpp", "test_powerup_id.cpp", "test_station_config_cases.cpp",
              "test_advert_vectors.cpp", "test_controller.cpp", "test_buttons.cpp")
# Revive feedback is post-MVP and off by default (presence.h REVIVE_FEEDBACK_ENABLED). These files test
# both sides of that switch, so they are also built with it on: the post-MVP path cannot rot.
REVIVE_ON_FILES = ("test_link.cpp", "test_screen.cpp", "test_presence.cpp")
GXX = shutil.which("g++")
FLAGS = ("-std=c++17", "-Wall", "-Wextra", "-Werror")
CACHE_KEEP = 10
# What a host binary is compiled from. Only these files go into the key, never the sim's build output
# (sim/.build, sim/out) or __pycache__, which other suites write while this one hashes.
SOURCE_SUFFIXES = {".h", ".hpp", ".c", ".cc", ".cpp", ".ino"}
SKIP_DIRS = {".build", "out", "__pycache__"}
CACHE_IDLE_S = 3600   # a tree is pruned only once it is outside the newest CACHE_KEEP AND unused this long
# The environment variables that change what g++ includes or links (gcc's "Environment Variables" page).
COMPILER_ENV = ("CPATH", "CPLUS_INCLUDE_PATH", "C_INCLUDE_PATH", "LIBRARY_PATH", "GCC_EXEC_PREFIX", "COMPILER_PATH")


def _compile(src: pathlib.Path, defines: tuple, exe: pathlib.Path) -> None:
    build = subprocess.run([GXX, *FLAGS, *defines, f"-I{CORE}", str(src), "-o", str(exe)],
                           capture_output=True, text=True, timeout=120)
    assert build.returncode == 0, f"g++ failed on {src.name} {defines}:\n{build.stdout}\n{build.stderr}"


def _cache_root() -> pathlib.Path | None:
    if os.environ.get("BRX_STICKS3_CACHE") == "0":
        return None
    return pathlib.Path.home() / ".cache" / "brx-sticks3-host"


@functools.lru_cache(maxsize=1)
def _tree_key() -> str:
    """Every C/C++ source in the Stick tree (path and bytes; not the sim's build output), where it is (a test finds its fixture from __FILE__,
    so a binary built in one worktree must not run in another), the compiler, its version, its include
    environment and the flags."""
    h = hashlib.sha256()
    for f in sorted(p for p in CORE.rglob("*") if p.suffix in SOURCE_SUFFIXES and p.is_file()
                    and not set(p.relative_to(CORE).parts[:-1]) & SKIP_DIRS):
        h.update(str(f.relative_to(CORE)).encode() + b"\0" + f.read_bytes() + b"\0")
    ver = subprocess.run([GXX, "--version"], capture_output=True, text=True, timeout=30).stdout
    env = [f"{k}={os.environ.get(k, '')}" for k in COMPILER_ENV]
    h.update(f"{CORE.resolve()}\0{os.path.realpath(GXX or '')}\0{ver}\0{FLAGS}\0{env}".encode())
    return h.hexdigest()[:32]


def _sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _valid(entry: pathlib.Path, exe: pathlib.Path) -> bool:
    try:
        return (entry / "sha256").read_text().strip() == _sha(exe)
    except OSError:
        return False


def _prune(root: pathlib.Path, keep: str) -> None:
    def age(d: pathlib.Path) -> float | None:
        try:                               # a parallel run may move or prune it under us
            return time.time() - d.stat().st_mtime
        except FileNotFoundError:
            return None
    for d in root.glob(".tmp-*"):          # a crashed run's half-built entry
        if (a := age(d)) is not None and a > CACHE_IDLE_S:
            shutil.rmtree(d, ignore_errors=True)
    trees = [(a, d) for d in root.iterdir() if not d.name.startswith(".") and (a := age(d)) is not None]
    for a, d in sorted(t for t in trees if t[1].name != keep)[CACHE_KEEP - 1:]:
        if a > CACHE_IDLE_S:               # never a tree another run touched lately
            shutil.rmtree(d, ignore_errors=True)


def _cached_binary(src: pathlib.Path, defines: tuple, root: pathlib.Path) -> pathlib.Path:
    """The built binary for (tree, src, defines): from the cache when its checksum holds, else built and stored."""
    tree = _tree_key()
    entry = root / tree / hashlib.sha256(f"{src.resolve()}\0{defines}".encode()).hexdigest()[:24]
    exe = entry / src.stem
    (root / tree).mkdir(parents=True, exist_ok=True)
    os.utime(root / tree)                  # in use: the prune keeps the newest trees by this time
    if _valid(entry, exe):
        return exe
    tmp = pathlib.Path(tempfile.mkdtemp(prefix=".tmp-", dir=root))
    try:
        _compile(src, defines, tmp / src.stem)
        (tmp / "sha256").write_text(_sha(tmp / src.stem))
        if _valid(entry, exe):             # a parallel run stored it while this one compiled: keep theirs
            return exe
        try:                               # a corrupt entry: move it aside, never edit it in place
            os.replace(entry, tmp / "old")
            shutil.rmtree(tmp / "old", ignore_errors=True)
        except FileNotFoundError:          # no entry, or a parallel run moved it first
            pass
        try:
            os.replace(tmp, entry)
        except OSError:                    # a parallel run stored the same entry first: use theirs
            if not _valid(entry, exe):
                raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    _prune(root, tree)
    return exe


def _build_and_run(name: str, defines: tuple = ()):
    src = CORE / "test" / name
    assert src.exists(), f"{src} is missing"
    root = _cache_root()
    with tempfile.TemporaryDirectory() as td:
        if root is None:
            exe = pathlib.Path(td) / src.stem
            _compile(src, defines, exe)
        else:
            exe = _cached_binary(src, defines, root)
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


def test_the_build_cache_hits_rebuilds_a_corrupt_entry_and_keys_on_defines():
    """A second ask for the same binary compiles nothing; a truncated binary or a lost checksum is rebuilt;
    other defines are another entry; the newest CACHE_KEEP trees are kept."""
    needs(GXX, "g++")
    global _compile
    real, builds = _compile, []
    def counting(src, defines, exe):
        builds.append((src.name, defines))
        real(src, defines, exe)
    _compile = counting
    try:
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td) / "cache"
            root.mkdir()
            src = pathlib.Path(td) / "tiny.cpp"     # a tiny file keeps this test fast; the key logic is the same
            src.write_text('#include <cstdio>\nint main() { std::puts("all checks passed"); }\n')
            exe = _cached_binary(src, (), root)
            assert _cached_binary(src, (), root) == exe and len(builds) == 1
            good = exe.read_bytes()
            exe.write_bytes(good[: len(good) // 2])
            assert _cached_binary(src, (), root).read_bytes() == good and len(builds) == 2
            (exe.parent / "sha256").unlink()
            assert _cached_binary(src, (), root).read_bytes() == good and len(builds) == 3
            assert _cached_binary(src, ("-DBRX_REVIVE_FEEDBACK=1",), root) != exe and len(builds) == 4
            run = subprocess.run([str(exe)], capture_output=True, text=True, timeout=60)
            assert run.returncode == 0 and "all checks passed" in run.stdout
            for i in range(CACHE_KEEP + 3):
                d = root / f"old{i:02d}"
                d.mkdir()
                os.utime(d, (1000 + i, 1000 + i))
            kept_key = _tree_key()
            _prune(root, kept_key)
            kept = sorted(d.name for d in root.iterdir() if not d.name.startswith("."))
            assert len(kept) == CACHE_KEEP and _tree_key() in kept and "old00" not in kept, kept
            recent = root / "recent"
            recent.mkdir()
            os.utime(recent, (time.time() - 60, time.time() - 60))
            for i in range(CACHE_KEEP + 2):
                d = root / f"new{i:02d}"
                d.mkdir()
            _prune(root, _tree_key())
            assert recent.exists(), "a tree used a minute ago was pruned"
            _tree_key.cache_clear()
            old = os.environ.get("CPATH")
            os.environ["CPATH"] = td
            try:
                assert _tree_key() != kept_key, "CPATH changes what g++ includes, so it must change the key"
            finally:
                if old is None:
                    del os.environ["CPATH"]
                else:
                    os.environ["CPATH"] = old
                _tree_key.cache_clear()
    finally:
        _compile = real


def test_the_cache_is_off_with_brx_sticks3_cache_0():
    old = os.environ.get("BRX_STICKS3_CACHE")
    os.environ["BRX_STICKS3_CACHE"] = "0"
    try:
        assert _cache_root() is None
    finally:
        if old is None:
            del os.environ["BRX_STICKS3_CACHE"]
        else:
            os.environ["BRX_STICKS3_CACHE"] = old
    assert _cache_root() == pathlib.Path.home() / ".cache" / "brx-sticks3-host" or old == "0"


def test_sticks3_headers_have_no_arduino_dependency():
    """The core must stay host-testable: nothing in these headers may pull in Arduino."""
    for name in ("brx_ir.h", "brx_advert.h", "control_point.h", "station_link.h", "json_lite.h",
                 "station_ui.h", "station_screen.h", "presence.h", "stick_state.h", "station_range.h",
                 "station_controller.h"):
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
    # ARCH-4: the pending flags moved to station_controller.h (test_controller.cpp drives them); the glue
    # still reports each flash write's result back to it.
    glue = (CORE / "mc_link_glue.h").read_text(encoding="utf-8")
    assert "return lockSnapshotWritten(seconds, game);" in glue
    assert "return lockSnapshotCleared();" in glue
    controller = (CORE / "station_controller.h").read_text(encoding="utf-8")
    assert "lock.save_pending = !fx.write_lock(" in controller
    assert "lock.clear_pending = true;" in controller


def test_p_l2_presence_observes_the_advert_arrival_time():
    # P-L2 (review 2026-10-03): the drain feeds each sighting at its own arrival time (clamped to `now`), not the
    # drain's `now`, so a burst drained together is not one instant in the sighting window.
    glue = (CORE / "mc_link_glue.h").read_text(encoding="utf-8")
    assert "presence.observe(sp.advert, sp.rssi, at)" in glue
    assert "(int32_t)(sp.seen_at - now) > 0 ? now : sp.seen_at" in glue
    assert "presence.observe(sp.advert, sp.rssi, now)" not in glue


def test_t9_every_stick_host_test_is_built_by_this_gate():
    """T9 (maintainability review 2026-10-10): TEST_FILES is a hand list, so a new test/*.cpp left out of it never ran."""
    on_disk = {p.name for p in (CORE / "test").glob("*.cpp")}
    assert on_disk, "no Stick host tests found"
    missing = sorted(on_disk - set(TEST_FILES))
    assert not missing, f"add these to TEST_FILES in mcp/tests/test_sticks3_core.py: {missing}"
    assert set(REVIVE_ON_FILES) <= set(TEST_FILES), "every revive-on file is also built normally"
