"""The bench rig arms every tagger the same way, or its numbers are not comparable.

Closes the polish-loop 2026-08-26 deferred low: the AR frame was copy-pasted into five bench tools,
the `$PSET` template into nine and the `$SIR` table into five. That is not a style problem — a run
that re-tunes the arming config in one tool and not the others measures two different games and
reports one number, which is exactly the class of mistake `docs/gotchas.md` "check the control before
the result" exists to stop. These tests fail if a frame ever gets pasted back in.
"""
import ast
import pathlib
import sys

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import bench_common as B  # noqa: E402

# The literals that must live in exactly ONE place, and the token that identifies each on sight.
SHARED = {"$WEAP,0,,100,0,0,9,": "AR", "$PSET,": "PSET", "$SIR,0,1,,36": "SIRS",
          "$GSET,0,0,1,0,1,0,50,1,*": "GSET", "$GSET,1,0,1,0,1,0,50,1,*": "GSET_FF"}


# `ally_remeasure.py` arms with a DELIBERATELY different control — a 190 ms AR and a shield-150
# $PSET — and says why in the file: the shield is a third pool to open headroom in, and a shield
# grant appearing there is then real evidence rather than the value we wrote. Sharing those two
# frames would destroy the experiment, so they are exempt and must stay documented.
#
# Exemptions are PER FRAME, not per file: a blanket file exemption let its `$GSET` drift unguarded,
# which is not part of the experiment at all (review 2026-09-01).
DELIBERATE_VARIANTS = {"ally_remeasure.py": {"AR", "PSET"}}


def _sources():
    return [p for p in sorted(TOOLS.glob("*.py")) if p.name != "bench_common.py"]


def test_no_bench_tool_redeclares_a_shared_frame():
    bad = []
    for p in _sources():
        src = p.read_text()
        exempt = DELIBERATE_VARIANTS.get(p.name, set())
        if exempt:
            assert "deliberate" in src, f"{p.name} is exempt from the no-paste rule and must say why"
        for needle, name in SHARED.items():
            if name in exempt:
                continue
            if needle in src:
                bad.append(f"{p.name}: pasted a {name} frame — import it from bench_common instead")
    assert not bad, "\n  ".join(bad)


def test_the_shared_frames_are_the_ones_the_bench_measured_with():
    """Pinned literally. These are the CONTROL: if one changes, every historical bench number in
    `docs/experiment-log.md` was taken against a different setup and has to be re-read."""
    assert B.AR.startswith("$WEAP,0,,100,0,0,9,") and B.AR.split(",")[15] == "100", "AR is the STOCK 100 ms frame"
    assert B.BURST.split(",")[21] == "9", "BURST is fire mode 9 (3-round burst)"
    assert B.PSET.format(pid=7).startswith("$PSET,7,0,45,70,70,50,"), "45 HP / 70 armour / 70 shield / crit 50"
    assert len(B.SIRS) == 10 and B.SIRS[0] == B.SIR_PLAIN
    assert B.GSET.split(",")[1] == "0" and B.GSET_FF.split(",")[1] == "1", "GSET token1 is friendly fire"


def test_arming_frames_still_equal_the_sequence_the_tools_used_to_inline():
    """The hoist must not have changed a single frame or their order — every historical bench number
    in `docs/experiment-log.md` was taken against this exact sequence."""
    want = (["$VOL,60,0,*", "$CLEAR,*", "$START,*", "$GSET,0,0,1,0,1,0,50,1,*", B.PSET.format(pid=5)]
            + B.SIRS + ["$TID,2,*"])
    assert B.arming_frames(5, 2) == want


def test_arming_frames_are_in_the_order_the_gun_needs():
    fr = B.arming_frames(5, 2)
    assert fr[0].startswith("$VOL") and fr[1] == "$CLEAR,*" and fr[2] == "$START,*"
    assert fr[3] == B.GSET and fr[4] == B.PSET.format(pid=5)
    assert fr[5:5 + len(B.SIRS)] == B.SIRS
    assert fr[-1] == "$TID,2,*", "the head ends with $TID (contracts §1.1)"
    assert "$SPAWN,,*" not in fr, "arming stops short of SPAWN — the caller owns the last frames"
    assert B.arming_frames(5, 2, ff=True)[3] == B.GSET_FF
    assert B.arming_frames(5, 2, sirs=[B.SIR_PLAIN])[5] == B.SIR_PLAIN


def test_every_bench_tool_still_parses_and_imports_its_frames():
    """A hoist that leaves a tool referencing a name it no longer imports fails at the bench, in the
    dark, with two taggers in hand."""
    exported = {n for n in dir(B) if not n.startswith("_")}
    bad = []
    for p in _sources():
        tree = ast.parse(p.read_text(), p.name)
        imported = {a.name                      # the SOURCE name; `PSET as _PSET` is fine
                    for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module == "bench_common"
                    for a in n.names}
        missing = imported - exported
        if missing:
            bad.append(f"{p.name} imports {sorted(missing)} from bench_common, which does not export them")
    assert not bad, "\n  ".join(bad)


def _module_level_unbound(path: pathlib.Path) -> set[str]:
    """Names this module reads at import time that nothing has bound yet.

    Deliberately import-time only: a name used inside a `def` may legitimately be bound later, but a
    name read at module scope must already exist or the file dies on `import`. Walks statements in
    source order so `FRAMES = [AR]` ABOVE `from bench_common import AR` is caught — which is exactly
    how `damage_bench.py` was broken by the hoist (review 2026-09-01).
    """
    import builtins
    tree = ast.parse(path.read_text(), path.name)
    bound: set[str] = set(dir(builtins)) | {"__name__", "__file__", "__doc__"}
    unbound: set[str] = set()
    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(stmt.name)                # the body runs at CALL time, not import time
            continue
        for n in ast.walk(stmt):
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in bound:
                unbound.add(n.id)
        for n in ast.walk(stmt):                # bind after reading: a name cannot define itself
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
                bound.add(n.id)
            elif isinstance(n, ast.alias):
                bound.add((n.asname or n.name).split(".")[0])
    return unbound


def test_no_bench_tool_reads_a_name_before_it_is_bound():
    """The hoist's real failure mode, and the one the check above missed.

    `damage_bench.py` used the shared `AR` in a module-level list that sat ABOVE the import line, so
    it raised `NameError` before it opened a BLE link — a bench trip wasted on a typo. Checking that
    the imports resolve is not the same as checking the file runs.
    """
    bad = []
    for p in _sources():
        for name in sorted(_module_level_unbound(p)):
            bad.append(f"{p.name}: reads {name!r} at module scope before anything binds it")
    assert not bad, "a bench tool will die on import:\n  " + "\n  ".join(bad)


def test_connected_always_disconnects():
    """The whole point of the helper: a raise inside the block must still hand the tagger back.

    A bench tool that died holding an open BLE link left a gun that would not accept the next
    connection until it was power-cycled."""
    from _async import run as _run

    class FakeMgr:
        def __init__(self, fail_disconnect=False):
            self.opened, self.closed, self.fail = [], [], fail_disconnect

        async def connect(self, addr, alias):
            self.opened.append(alias)

        async def disconnect(self, alias):
            self.closed.append(alias)
            if self.fail:
                raise RuntimeError("link already gone")

    async def run(fail_disconnect=False, boom=False):
        mgr = FakeMgr(fail_disconnect)
        try:
            async with B.connected(mgr, ("aa", "shooter"), ("bb", "victim")):
                if boom:
                    raise ValueError("probe failed")
        except ValueError:
            pass
        return mgr

    m = _run(run())
    assert m.opened == ["shooter", "victim"] and m.closed == ["victim", "shooter"], "closed in reverse order"
    m = _run(run(boom=True))
    assert m.closed == ["victim", "shooter"], "a raise inside the block must not skip the teardown"
    # a teardown that itself fails must not replace the real exception with its own
    m = _run(run(fail_disconnect=True, boom=True))
    assert m.closed == ["victim", "shooter"]

    # a connect that fails part way must still close what it DID open
    class HalfMgr(FakeMgr):
        async def connect(self, addr, alias):
            if alias == "victim":
                raise OSError("out of range")
            self.opened.append(alias)

    async def half():
        mgr = HalfMgr()
        try:
            async with B.connected(mgr, ("aa", "shooter"), ("bb", "victim")):
                pass
        except OSError:
            pass
        return mgr

    m = _run(half())
    assert m.opened == ["shooter"] and m.closed == ["shooter"], "the first gun must not be left connected"


def test_arming_frames_is_actually_used():
    """A shared helper nothing calls is not a hoist, it is a second copy waiting to drift.

    Review 2026-09-01: `arming_frames()` was exported and tested but called by no tool, so the
    send-ORDER half of the hoist was still duplicated inline in every file.
    """
    users = [p.name for p in _sources() if "arming_frames(" in p.read_text()]
    assert len(users) >= 3, f"arming_frames() is called by {users or 'nothing'} — inline the callers or drop it"
