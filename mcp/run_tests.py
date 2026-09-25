#!/usr/bin/env python3
"""Zero-dependency test runner — discovers and runs every tests/test_*.py.

The system Python here has no pytest/pip, so this is the suite entry point:
    python3 run_tests.py            # run all, one process per file, in parallel
    python3 run_tests.py modes cs   # run only files matching these substrings
    python3 run_tests.py -j 1       # one file at a time (still one process per file)
    python3 run_tests.py --inline   # the old way: every file in THIS process, output streamed
    python3 run_tests.py --exclude chaos   # every file except those matching (repeatable)

Each test is a top-level `test_*` function; a raised assertion/exception = fail.
Exits non-zero if anything fails (CI-friendly).

Parallel by default (2026-09-16). The files ran serially in one process, so the suite took as long as
the sum of its files (~85 s) and a slow file held up every later one. Each file now runs in its own
child process: the wall clock is roughly the slowest file, and no file can leak module or event-loop
state into another (the order-dependency `tests/_async.py` documents cannot recur across files).
A child's output is buffered and printed when the file finishes, so lines never interleave.
"""
import atexit
import contextlib
import importlib
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

# The operator's real ~/.brx-mcp is field evidence (session-*.sqlite from real games), not a test
# scratch pad -- 2026-09-13, hundreds of empty test-run sqlite files had to be sifted from the four
# real ones by hand after a field night. Every brx_mcp module that persists anything reads
# BRX_MCP_HOME (storage.home_dir()) instead of hardcoding ~/.brx-mcp, so setting it here, before the
# first import of anything under brx_mcp, is the one place that makes the WHOLE suite -- and any
# subprocess it spawns, since children inherit the environment -- write into a throwaway directory
# instead. An operator who explicitly set BRX_MCP_HOME (e.g. to inspect what a run wrote) keeps their
# own value, and it is never ours to delete -- cleanup is scheduled only for a tempdir we create.
if "BRX_MCP_HOME" not in os.environ:
    _tmp_home = tempfile.mkdtemp(prefix="brx-mcp-run_tests-")
    os.environ["BRX_MCP_HOME"] = _tmp_home
    atexit.register(shutil.rmtree, _tmp_home, ignore_errors=True)

ROOT = pathlib.Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]

from _skip import Skipped  # noqa: E402  (needs the tests dir on the path first)

RESULT_MARK = "@@run_tests-result@@ "
# One file (or chunk) that runs longer than this is killed and counted as a failure. A hung test once held a whole
# parallel run for 10 minutes (the node suite, 2026-09-16); the slowest file here takes ~10 s. RUN_TESTS_TIMEOUT_S overrides.
FILE_TIMEOUT_S = float(os.environ.get("RUN_TESTS_TIMEOUT_S", "300"))

# Files whose tests are split across several child processes, `every n-th test function` each. The wall
# clock of a parallel run is the slowest process, and these files are several seconds of REAL waiting
# (timers, reconnect windows, websocket round-trips), not CPU. Only list a file whose tests pass in any
# subset: each chunk imports the module afresh, so a test that relies on an earlier one would fail loudly.
SPLIT = {"test_mc_e2e": 5, "test_mc_polish": 6, "test_stage": 3, "test_stage_server": 2, "test_mc_net": 3,
         "test_balance_sim": 4, "test_chaos_fuzz": 9, "test_chaos_gun": 3,
         "test_sticks3_screens": 1}  # ~8 s only when it rebuilds the Stick simulator (a header changed)


def run_file(stem: str, chunk: tuple[int, int] | None = None) -> dict:
    """Import one test file and call its tests in THIS process. Prints as it goes.

    `chunk=(i, n)` runs only every n-th test function, starting at the i-th (see SPLIT)."""
    res = {"file": stem, "pass": 0, "fail": 0, "skip": 0, "skipped": {}, "failures": [], "whole_skip": False}

    def skip(why):
        res["skipped"][why] = res["skipped"].get(why, 0) + 1

    try:
        mod = importlib.import_module(stem)
    except Skipped as e:
        # A module-level `needs(...)` — the whole file bows out, and says why.
        res["skip"] = 1
        res["whole_skip"] = True
        skip(str(e))
        print(f"  {stem}: skipped (needs {e})")
        return res
    except Exception:
        # An import error used to abort the ENTIRE run here, so every later file
        # silently never ran and the totals still looked plausible. Now it is one
        # loud failure and the suite carries on (review 2026-09-07).
        res["fail"] = 1
        res["failures"].append(f"{stem}::<import>")
        print(f"FAIL {stem}::<import>")
        traceback.print_exc()
        return res
    names = [n for n in dir(mod) if n.startswith("test_")]
    if chunk:
        names = names[chunk[0]::chunk[1]]
    for name in names:
        try:
            getattr(mod, name)()
            res["pass"] += 1
        except Skipped as e:
            res["skip"] += 1
            skip(str(e))
        except Exception:
            res["fail"] += 1
            res["failures"].append(f"{stem}::{name}")
            print(f"FAIL {stem}::{name}")
            traceback.print_exc()
    p, fl, sk = res["pass"], res["fail"], res["skip"]
    part = f" [{chunk[0] + 1}/{chunk[1]}]" if chunk else ""
    print(f"  {stem}{part}: {p}/{p + fl}" + (f"  ({sk} skipped)" if sk else ""))
    return res


def worker(stem: str, chunk: tuple[int, int] | None) -> None:
    """Child-process entry: run one file (or one chunk of it), then hand the parent its counts."""
    res = run_file(stem, chunk)
    sys.stdout.flush()
    sys.stderr.flush()
    print(RESULT_MARK + json.dumps(res), flush=True)
    # os._exit, not sys.exit: a test that leaves a non-daemon thread or a pending atexit hook behind
    # must not hold the whole parallel run hostage. The result line is already out.
    os._exit(0)


# Every live child, so an interrupted run (Ctrl-C, or test-all killing this process) takes its children with it.
# Each child leads its own session (see spawn), so a signal to this process's group does not reach them on its own.
LIVE: set[subprocess.Popen] = set()


def _kill_children_and_exit(signum, _frame):
    for proc in list(LIVE):
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(proc.pid, signal.SIGKILL)
    os._exit(128 + signum)


def spawn(stem: str, chunk: tuple[int, int] | None = None) -> tuple[dict, str, float]:
    """Parent side: run one file (or chunk) in a child process with its own BRX_MCP_HOME subdirectory."""
    env = dict(os.environ)
    label = stem + (f".{chunk[0]}" if chunk else "")
    home = pathlib.Path(os.environ["BRX_MCP_HOME"]) / label
    home.mkdir(parents=True, exist_ok=True)
    env["BRX_MCP_HOME"] = str(home)
    env["PYTHONUNBUFFERED"] = "1"
    t0 = time.monotonic()
    argv = [sys.executable, str(ROOT / "run_tests.py"), "--worker", stem] + (["--chunk", f"{chunk[0]}/{chunk[1]}"] if chunk else [])
    # start_new_session: a timeout kills the file's whole process group, including any server it spawned
    proc = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            start_new_session=True)
    LIVE.add(proc)
    try:
        stdout, _ = proc.communicate(timeout=FILE_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)
        stdout, _ = proc.communicate()
        stdout += f"\nFAIL {label}: killed after {FILE_TIMEOUT_S:.0f}s (RUN_TESTS_TIMEOUT_S)"
    finally:
        LIVE.discard(proc)
    took = time.monotonic() - t0
    out, res = [], None
    for line in stdout.splitlines():
        if line.startswith(RESULT_MARK):
            res = json.loads(line[len(RESULT_MARK):])
        else:
            out.append(line)
    if res is None:
        # The child died before it could report (a segfault, os._exit in a test, a hard kill).
        # That is a failure of the file, never a silent pass.
        res = {"file": stem, "pass": 0, "fail": 1, "skip": 0, "skipped": {}, "whole_skip": False,
               "failures": [f"{label}::<crashed exit={proc.returncode}>"]}
        out.append(f"FAIL {label}: the child process exited {proc.returncode} without a result")
    res["file"] = label
    return res, "\n".join(out), took


def main(argv: list[str]) -> int:
    if argv[:1] == ["--worker"]:
        chunk = tuple(int(x) for x in argv[3].split("/")) if argv[2:3] == ["--chunk"] else None
        worker(argv[1], chunk)  # type: ignore[arg-type]
    inline = "--inline" in argv
    jobs = os.cpu_count() or 4
    filters: list[str] = []
    excludes: list[str] = []
    it = iter(argv)
    for a in it:
        if a == "--inline":
            continue
        if a == "--exclude":            # skip files matching this substring (test-all runs `chaos` as its own job)
            excludes.append(next(it))
        elif a in ("-j", "--jobs"):
            jobs = int(next(it))
        elif a.startswith("-j") and a[2:].isdigit():
            jobs = int(a[2:])
        else:
            filters.append(a)

    files = sorted((ROOT / "tests").glob("test_*.py"))
    if filters:
        files = [f for f in files if any(s in f.stem for s in filters)]
    if excludes:
        files = [f for f in files if not any(s in f.stem for s in excludes)]
    stems = [f.stem for f in files]

    t0 = time.monotonic()
    results: list[dict] = []
    timings: list[tuple[float, str]] = []
    if inline:
        results = [run_file(s) for s in stems]
    else:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, _kill_children_and_exit)
        with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
            # SPLIT files first: they are the long poles, so they must not queue behind short files.
            jobs_list = [(s, (i, SPLIT[s])) for s in stems if s in SPLIT for i in range(SPLIT[s])]
            jobs_list += [(s, None) for s in stems if s not in SPLIT]
            futs = [pool.submit(spawn, s, c) for s, c in jobs_list]
            for fut in as_completed(futs):
                res, out, took = fut.result()
                results.append(res)
                timings.append((took, res["file"]))
                if out:
                    print(out, flush=True)

    total_pass = sum(r["pass"] for r in results)
    total_fail = sum(r["fail"] for r in results)
    # A whole-file skip in a SPLIT file is reported by every chunk; count it once per file.
    seen_whole: set[str] = set()
    for r in results:
        base = r["file"].split(".")[0]
        if r["whole_skip"] and base in seen_whole:
            r["skip"], r["skipped"] = 0, {}
        elif r["whole_skip"]:
            seen_whole.add(base)
    total_skip = sum(r["skip"] for r in results)
    failures = sorted(f for r in results for f in r["failures"])
    skipped: dict[str, int] = {}
    for r in results:
        for why, n in r["skipped"].items():
            skipped[why] = skipped.get(why, 0) + n

    wall = time.monotonic() - t0
    print(f"\n=== {total_pass} passed, {total_fail} failed"
          + (f", {total_skip} skipped" if total_skip else "")
          + f" across {len(files)} file(s) in {wall:.1f}s ===")
    if timings:
        print("slowest: " + ", ".join(f"{s} {t:.1f}s" for t, s in sorted(timings, reverse=True)[:5]))
    for why, n in sorted(skipped.items()):
        print(f"  skipped {n}: needs {why}")
    if failures:
        print("failed:\n  " + "\n  ".join(failures))
    return 1 if total_fail else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
