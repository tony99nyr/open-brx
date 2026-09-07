#!/usr/bin/env python3
"""Zero-dependency test runner — discovers and runs every tests/test_*.py.

The system Python here has no pytest/pip, so this is the suite entry point:
    python3 run_tests.py            # run all
    python3 run_tests.py modes cs   # run only files matching these substrings

Each test is a top-level `test_*` function; a raised assertion/exception = fail.
Exits non-zero if anything fails (CI-friendly).
"""
import importlib
import pathlib
import sys
import traceback

ROOT = pathlib.Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]

from _skip import Skipped  # noqa: E402  (needs the tests dir on the path first)

filters = sys.argv[1:]
files = sorted((ROOT / "tests").glob("test_*.py"))
if filters:
    files = [f for f in files if any(s in f.stem for s in filters)]

total_pass = total_fail = total_skip = 0
failures: list[str] = []
skipped: dict[str, int] = {}
for f in files:
    try:
        mod = importlib.import_module(f.stem)
    except Skipped as e:
        # A module-level `needs(...)` — the whole file bows out, and says why.
        total_skip += 1
        skipped[str(e)] = skipped.get(str(e), 0) + 1
        print(f"  {f.stem}: skipped (needs {e})")
        continue
    except Exception:
        # An import error used to abort the ENTIRE run here, so every later file
        # silently never ran and the totals still looked plausible. Now it is one
        # loud failure and the suite carries on (review 2026-09-07).
        total_fail += 1
        failures.append(f"{f.stem}::<import>")
        print(f"FAIL {f.stem}::<import>")
        traceback.print_exc()
        continue
    fns = [n for n in dir(mod) if n.startswith("test_")]
    p = fl = sk = 0
    for name in fns:
        try:
            getattr(mod, name)()
            p += 1
        except Skipped as e:
            sk += 1
            skipped[str(e)] = skipped.get(str(e), 0) + 1
        except Exception:
            fl += 1
            failures.append(f"{f.stem}::{name}")
            print(f"FAIL {f.stem}::{name}")
            traceback.print_exc()
    total_pass += p
    total_fail += fl
    total_skip += sk
    print(f"  {f.stem}: {p}/{p + fl}" + (f"  ({sk} skipped)" if sk else ""))

print(f"\n=== {total_pass} passed, {total_fail} failed"
      + (f", {total_skip} skipped" if total_skip else "")
      + f" across {len(files)} file(s) ===")
for why, n in sorted(skipped.items()):
    print(f"  skipped {n}: needs {why}")
if failures:
    print("failed:\n  " + "\n  ".join(failures))
sys.exit(1 if total_fail else 0)
