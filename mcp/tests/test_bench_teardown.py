"""No bench tool may sign off on a bare `$CLEAR`.

F11 (bench-proven 2026-09-02): `$CLEAR` wipes the `$SIR` table, and a gun with no rows silently
ignores EVERY hit while reporting alive and healthy. A tool that ends its run on a lone `$CLEAR`
hands the NEXT experiment a victim that cannot be hit, with no error anywhere -- very likely how
"deaf taggers" kept appearing between runs during the session that found this.

Scope note: sending `$CLEAR` while ARMING is correct and normal (the `$SIR` rows follow it in the
same bundle). Only a TEARDOWN that ends on `$CLEAR` is the bug, so this looks at `finally:` blocks
rather than at the file as a whole -- a broader scan produced 19 false positives and a test nobody
would trust.
"""
import ast
import pathlib
import sys

TOOLS_DIR = pathlib.Path(__file__).resolve().parents[1] / "tools"
TOOLS = sorted(TOOLS_DIR.glob("*.py"))
# These REPRODUCE the fault deliberately; leaving the gun stranded is their whole point.
EXEMPT = {"clear_spawn_repro.py", "desync_fuzz.py"}


def _finally_source(path):
    """Source text of every `finally:` block in the file."""
    src = path.read_text()
    lines = src.split("\n")
    out = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Try) and node.finalbody:
            a = node.finalbody[0].lineno - 1
            b = max(getattr(n, "end_lineno", n.lineno) for n in node.finalbody)
            out.append("\n".join(lines[a:b]))
    return out


def test_no_teardown_ends_on_a_bare_CLEAR():
    bad = []
    for f in TOOLS:
        if f.name in EXEMPT:
            continue
        for block in _finally_source(f):
            if "$CLEAR" in block and not ("$SIR" in block or "SIRS" in block or "teardown_frames" in block
                                          or "arming_frames" in block):
                bad.append(f.name)
    assert not bad, ("these tools end a run on a bare $CLEAR, leaving the gun unhittable for "
                     "whatever runs next: " + ", ".join(sorted(set(bad))))


def test_teardown_frames_clears_then_restores_the_table():
    sys.path.insert(0, str(TOOLS_DIR))
    import bench_common as B
    frames = B.teardown_frames()
    assert frames[0].startswith("$CLEAR")
    sir_at = [i for i, f in enumerate(frames) if f.startswith("$SIR")]
    assert sir_at, "teardown leaves the gun unhittable"
    assert frames.index("$CLEAR,*") < min(sir_at), "$SIR must come AFTER the $CLEAR"


def test_the_checker_can_actually_fail():
    """A guard that cannot fail is worthless."""
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as fh:
        fh.write("try:\n    pass\nfinally:\n    send('$CLEAR,*')\n")
        p = pathlib.Path(fh.name)
    try:
        blocks = _finally_source(p)
        assert blocks and "$CLEAR" in blocks[0] and "$SIR" not in blocks[0]
    finally:
        p.unlink()
