"""No bench tool may sign off on a bare `$CLEAR`.

F11 (bench-proven 2026-09-02): `$CLEAR` wipes the `$SIR` table, and a gun with no rows silently
ignores EVERY hit while reporting alive and healthy. A tool that ends its run on a lone `$CLEAR`
hands the NEXT experiment a victim that cannot be hit, with no error anywhere -- very likely how
"deaf taggers" kept appearing between runs during the session that found this.

Scope note: sending `$CLEAR` while ARMING is correct and normal (the `$SIR` rows follow it in the
same bundle). Only a `$CLEAR` with NO restore after it is the bug.

⚠ WHY THIS CHECK WAS REWRITTEN (2026-09-07). It used to scan `finally:` blocks only, on the
reasoning that a broader scan produced 19 false positives. That narrowing was the bug: it silently
assumed every teardown lives in a `finally`, and FIVE tools whose teardown sat in the plain body of
`main()` -- `tid_bench`, `sensor_bench`, `damage_bench`, `ff_probe`, `weapon_range` -- were invisible
to it for as long as it existed. They all ended on a bare `$CLEAR`: the exact fault this file exists
to prevent, sailing past the guard that was supposed to catch it. A safety net with a shape
assumption in it is worse than none, because it is trusted.

The false positives that motivated the narrowing were real but were never a reason to look at
`finally` only -- they came from matching `$CLEAR` in COMMENTS, DOCSTRINGS and PRINTED PROSE (four
tools mention it in exactly those places, including the "never sign off on a bare $CLEAR" comment on
the correct fix), and from a restore held in a constant the old substring match did not know about
(`SIR_PLAIN`). Matching real frame LITERALS via the AST, and recognising any SIR-ish name as a
restore, gives zero false positives across all 66 tools while catching all five. Keep it that way:
if this check ever starts over-firing, tighten what counts as a restore -- do not narrow where it
looks.
"""
import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOLS_DIR = ROOT / "tools"
TOOLS = sorted(TOOLS_DIR.glob("*.py"))
# The package too (2026-09-07): pointing this only at tools/ was the same "assumption about where to
# look" that let the five tools through. `test_clear_safety.py` already checks the package's NAMED
# frame sequences and owns the reasoned allowlist for them -- but it can only see what has a name,
# which is exactly how `diag/runner.py`'s inline `("$STOP,*", "$CLEAR,*")` teardown stayed invisible
# inside a `finally:` block. This scan reads code rather than constants, so it catches the inline ones.
PACKAGE = sorted((ROOT / "brx_mcp").rglob("*.py"))

# A real frame literal ('$CLEAR,*'), never prose that merely mentions the command.
CLEAR_FRAME = re.compile(r"^\$CLEAR\b.*\*$")
# Any SIR-ish name restores the table: SIRS, SIR_PLAIN, SIR_TABLE, ...
SIRISH = re.compile(r"SIR")
RESTORE_CALLS = {"teardown_frames", "arming_frames"}

# These deliberately leave the gun stranded, or strand it on purpose as a phase of the experiment.
# `clear_spawn_repro.py` and `desync_fuzz.py` used to be here too (they reproduced the fault on
# purpose); both were deleted 2026-09-12 (doc-rot review) once F11 was closed, so their exemption
# went with them.
EXEMPT = {
    # Strands the gun in PHASE 2 ("the F11 fault") and proves GameDriver.setup() RECOVERS it in
    # PHASE 3. The restore is real but goes through driver.setup(), which no static check can see.
    "mc_driver_bench.py",
}

# Package sequences that deliberately leave the gun inert. Each of these is ALSO declared, with its
# reason, in `test_clear_safety.INTENTIONAL_TEARDOWNS` -- that file is the authority on WHY each one
# is allowed; this set only stops the code scan double-reporting them. If you add one here without
# adding it there, `test_clear_safety` will fail, which is the intended coupling.
PACKAGE_EXEMPT = {
    "protocol.py",     # PANIC_SEQUENCE -- making the gun unhittable is the entire point
    "state.py",        # TRYOUT_TEARDOWN -- the gun stays idle until the real game is pushed
    "__main__.py",     # cli.END_SEQUENCE -- game over, the app's own captured tail
}


def audit(path):
    """(line of the last `$CLEAR` frame, line of the first restore at/after it or None).

    (None, None) when the file never SENDS a `$CLEAR` at all."""
    tree = ast.parse(path.read_text())
    clears, restores = [], []
    for n in ast.walk(tree):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            v = n.value.strip()
            if CLEAR_FRAME.match(v):
                clears.append(n.lineno)
            elif v.startswith("$SIR"):
                restores.append(n.lineno)
        elif isinstance(n, (ast.Name, ast.Attribute)):
            nm = getattr(n, "id", None) or getattr(n, "attr", "")
            if SIRISH.search(nm) or nm in RESTORE_CALLS:
                restores.append(n.lineno)
    if not clears:
        return None, None
    last = max(clears)
    after = [r for r in restores if r >= last]
    return last, (min(after) if after else None)


def test_no_tool_ends_on_a_bare_CLEAR():
    """The check that matters — and it looks at the WHOLE file, not just `finally:` blocks."""
    bad = []
    for f in TOOLS:
        if f.name in EXEMPT:
            continue
        clear_line, restore_line = audit(f)
        if clear_line is not None and restore_line is None:
            bad.append(f"{f.name}:{clear_line}")
    assert not bad, (
        "these tools send a $CLEAR with no $SIR restore after it, leaving the gun unhittable for "
        "whatever runs next (F11): " + ", ".join(sorted(bad)))


def test_no_package_module_ends_on_a_bare_CLEAR():
    """The same rule inside `brx_mcp/`, where a stranded gun reaches a real player rather than a bench.

    This found `diag/runner.py`'s `finally:` teardown, which ran after EVERY diagnostic run and left
    the gun deaf on the way out -- so the tool whose job is answering "can this gun be hit?" was
    creating the fault it exists to detect."""
    bad = []
    for f in PACKAGE:
        if f.name in PACKAGE_EXEMPT:
            continue
        clear_line, restore_line = audit(f)
        if clear_line is not None and restore_line is None:
            bad.append(f"{f.relative_to(ROOT)}:{clear_line}")
    assert not bad, (
        "these ship a $CLEAR with no $SIR restore after it, leaving the gun unhittable (F11): "
        + ", ".join(sorted(bad)))


def test_the_package_exemptions_all_still_exist_and_are_declared():
    """A stale exemption is a hole, and one that is not also declared in test_clear_safety is an
    undocumented one."""
    names = {f.name for f in PACKAGE}
    missing = sorted(PACKAGE_EXEMPT - names)
    assert not missing, f"PACKAGE_EXEMPT names modules that no longer exist: {missing}"


def test_every_exemption_is_still_a_real_file():
    """A stale exemption is a hole: it would silently excuse a NEW tool that reused the name."""
    names = {f.name for f in TOOLS}
    missing = sorted(EXEMPT - names)
    assert not missing, f"EXEMPT names tools that no longer exist: {missing}"


def test_teardown_frames_clears_then_restores_the_table():
    sys.path.insert(0, str(TOOLS_DIR))
    import bench_common as B
    frames = B.teardown_frames()
    assert frames[0].startswith("$CLEAR")
    sir_at = [i for i, f in enumerate(frames) if f.startswith("$SIR")]
    assert sir_at, "teardown leaves the gun unhittable"
    assert frames.index("$CLEAR,*") < min(sir_at), "$SIR must come AFTER the $CLEAR"


def _audit_source(src: str):
    """audit() over a source string, via a temp file — used by the self-tests below."""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as fh:
        fh.write(src)
        p = pathlib.Path(fh.name)
    try:
        return audit(p)
    finally:
        p.unlink()


def test_the_checker_can_actually_fail():
    """A guard that cannot fail is worthless."""
    clear_line, restore = _audit_source('send("$CLEAR,*")\n')
    assert clear_line == 1 and restore is None, "a bare $CLEAR must be flagged"


def test_the_checker_catches_a_teardown_that_is_not_in_a_finally_block():
    """THE REGRESSION THAT MOTIVATED THE REWRITE. This exact shape — a teardown in the plain body of
    a function, no try/finally anywhere — was invisible to the previous check, and five real tools
    were sitting in it."""
    src = ('async def main():\n'
           '    for fr in ["$CLEAR,*"] + SIRS:\n'
           '        await send(fr)\n'
           '    await send("$PLAYX,0,*")\n'
           '    await send("$CLEAR,*")\n')
    clear_line, restore = _audit_source(src)
    assert clear_line == 5, f"expected the teardown $CLEAR on line 5, got {clear_line}"
    assert restore is None, "a teardown outside a finally: block must still be flagged"


def test_the_checker_accepts_a_proper_restore_however_it_is_spelled():
    """SIRS, SIR_PLAIN and teardown_frames() are all valid restores — the old substring match knew
    only the first, which is why two correct tools looked broken."""
    for restore in ('SIRS', 'SIR_PLAIN', 'B.teardown_frames()'):
        src = f'send("$CLEAR,*")\nsend({restore})\n'
        _clear, got = _audit_source(src)
        assert got is not None, f"a restore spelled {restore!r} should count"


def test_the_checker_ignores_the_command_named_in_prose():
    """Comments, docstrings and printed text mention $CLEAR constantly — including in the comment on
    the CORRECT fix. Matching those was the whole source of the 19 false positives."""
    for prose in ('"""Ends with $CLEAR."""\n',
                  '# never sign off on a bare $CLEAR (F11)\n',
                  'print("=== STRAND it ($CLEAR then $SPAWN) ===")\n'):
        clear_line, _r = _audit_source(prose)
        assert clear_line is None, f"prose mentioning $CLEAR must not count as a sent frame: {prose!r}"
