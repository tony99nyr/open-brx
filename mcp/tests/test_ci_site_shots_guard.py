"""F433 (2026-09-26): `.github/workflows/ci.yml`'s `site-shots` job re-lands its own screenshot-refresh
commit onto a moving `main` (`sync_onto_main`). Reading a moved UI source dir's hash back out of a manifest
value of JSON `null` prints as the Python string "None" -- non-empty, so it slid past the old `[ -z ... ]`
blank check and straight into the "a UI moved under this job, drop the capture and stay green" branch
(`return 2`) as if "None" vs. a real 40-hex commit were a genuine hash mismatch, rather than a manifest the
job could not actually read (which must fail red, `return 1`).

This extracts the guard's own bash text out of ci.yml (a plain-text read, no workflow runner, same
technique `test_team_color_consistency.py` uses on Python/JS sources) and executes JUST that guard, as a
real bash function, against synthetic `captured`/`tip` values -- so a regression is caught by running the
actual shipped text, not a hand-written copy of it that could drift from the real fix.
"""
from __future__ import annotations

import pathlib
import re
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[2]
CI_YML = REPO / ".github" / "workflows" / "ci.yml"

_REAL_SHA = "a" * 40   # any string matching ^[0-9a-f]{40}$: this test only cares about the SHAPE check


def _extract_guard() -> str:
    text = CI_YML.read_text(encoding="utf-8")
    # Anchored on the F433 comment (proves this IS the fixed guard, not some other `if`), then DOTALL up
    # to the guard's own closing `fi` -- the first one after the anchor, since the guard is a single
    # un-nested `if ... fi`.
    m = re.search(
        r'# F433:.*?(?P<if>\s*if !\s*\[\[\s*"\$captured".*?\bfi\b)',
        text, re.DOTALL,
    )
    assert m, ("F433's hash-shape guard is gone from ci.yml's site-shots job -- FIX the guard (a captured "
               "or tip value that is not a real 40-hex SHA-1 must return 1, never fall through to a hash "
               "compare), do not delete this pin")
    return m.group("if")


def _run_guard(captured: str, tip: str) -> int:
    """Runs the extracted guard as a bash FUNCTION (so its `return` exits the function, not the shell),
    with `captured`/`tip` pre-set to the values under test, and reports the guard's own exit code. A
    `return 1` INSIDE the guard means the shape check refused the value; a fall-through (no return at all,
    since the guard's own `fi` is this snippet's last line) means it passed the shape check."""
    guard = _extract_guard()
    script = f'''
set -u
check() {{
  local captured="$1" tip="$2" HOWTO="see ci.yml" dir="app/src"
{guard}
  echo "PASSED_SHAPE_CHECK"
  return 0
}}
check "$1" "$2"
'''
    r = subprocess.run(["bash", "-c", script, "bash", captured, tip], capture_output=True, text=True)
    return r.returncode, r.stdout


def test_f433_a_null_manifest_value_is_refused_not_treated_as_a_hash_mismatch():
    # the exact bug: a JSON `null` prints as the Python string "None", paired with a real SHA-1 tip
    rc, out = _run_guard("None", _REAL_SHA)
    assert rc == 1, f"a manifest value that prints 'None' must be refused (return 1), got rc={rc} out={out!r}"
    assert "PASSED_SHAPE_CHECK" not in out


def test_f433_an_empty_captured_or_tip_is_still_refused():
    assert _run_guard("", _REAL_SHA)[0] == 1
    assert _run_guard(_REAL_SHA, "")[0] == 1


def test_f433_two_real_shas_clear_the_shape_check_and_reach_the_hash_compare():
    rc, out = _run_guard(_REAL_SHA, _REAL_SHA)
    assert rc == 0 and "PASSED_SHAPE_CHECK" in out, (rc, out)
    rc, out = _run_guard(_REAL_SHA, "b" * 40)
    assert rc == 0 and "PASSED_SHAPE_CHECK" in out, (rc, out)


def test_f433_an_uppercase_or_short_hash_is_refused_not_silently_compared():
    # git SHA-1s are always lowercase hex; anything else is not a hash this guard should trust
    assert _run_guard("A" * 40, _REAL_SHA)[0] == 1
    assert _run_guard("a" * 39, _REAL_SHA)[0] == 1
