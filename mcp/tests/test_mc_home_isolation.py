"""BRX_MCP_HOME: the operator's real ~/.brx-mcp is field evidence, not a test scratch pad.

2026-09-13: test runs (every e2e boot's `python -m brx_mcp.mc --demo/--ephemeral`, the app's
fake-game e2e runner, `run_tests.py` itself) were littering `~/.brx-mcp/mc/session-*.sqlite` --
hundreds of them, mostly empty -- because `build()` constructed the session `Store` unconditionally,
never checking `--demo`/`--ephemeral` the way the pieces shelf and the tunnel pidfile already did.
After a field night Tony had to filter them by size and timestamp to find the four real games.

`storage.home_dir()` resolves `BRX_MCP_HOME` when set (fresh on every call, not baked in at import),
`store.mc_dir()` builds on it, and a demo/ephemeral boot falls back to a throwaway tempdir even when
BRX_MCP_HOME is unset. This file proves both halves, and that `run_tests.py` wires the env var before
any test can import brx_mcp.

**DO NOT delete anything under the real ~/.brx-mcp** -- these tests never touch it; they redirect
Path.home() (via HOME/USERPROFILE) to a throwaway stand-in and prove that stand-in stays empty.
"""
from __future__ import annotations

import os
import pathlib
import tempfile
import types


def _args(**kw):
    """The subset of argparse.Namespace attributes `build()` reads."""
    base = dict(host="127.0.0.1", port=0, ws_port=0, fake_net=True, ephemeral=True,
                session_file=None, demo=True, demo_speed=1.0, public_url=None, tunnel=False)
    base.update(kw)
    return types.SimpleNamespace(**base)


class _FakeRealHome:
    """Redirect Path.home() (HOME/USERPROFILE) to a throwaway stand-in for the "operator's real
    home" for the test body, then restore -- so a regression is caught by finding a file in a
    directory nobody but this test knows about, never by touching Tony's actual ~/.brx-mcp."""
    def __enter__(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix="brx-fake-real-home-"))
        self._saved = {k: os.environ.get(k) for k in ("HOME", "USERPROFILE", "BRX_MCP_HOME")}
        os.environ["HOME"] = str(self.dir)
        os.environ["USERPROFILE"] = str(self.dir)
        os.environ.pop("BRX_MCP_HOME", None)
        return self.dir

    def __exit__(self, *exc):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _sqlite_files(root: pathlib.Path) -> list[pathlib.Path]:
    return list(root.rglob("*.sqlite"))


def test_demo_ephemeral_boot_never_writes_a_session_db_under_the_real_home():
    """The exact shape of the bug: `--demo --fake-net --ephemeral` (what every e2e boot and
    run_tests.py's own subprocess runs use) with NO BRX_MCP_HOME set -- the case every one of those
    callers was actually in before this fix."""
    from brx_mcp.mc.__main__ import build
    with _FakeRealHome() as fake_home:
        session, net, extra = build(_args())
        try:
            assert session.store is not None, "store disabled entirely -- can't prove isolation"
            store_path = pathlib.Path(session.store.path).resolve()
            assert not str(store_path).startswith(str(fake_home.resolve())), (
                f"a demo/ephemeral boot's session store landed under the (stand-in) real home: {store_path}")
            session.store.log("n1", "hit", 1, 0, 0, None, 0, "{}")   # actually write, don't just open
        finally:
            session.store.db.close()
        found = _sqlite_files(fake_home)
        assert found == [], f"a demo/ephemeral boot wrote into the real home: {found}"


def test_BRX_MCP_HOME_overrides_storage_home_dir_and_store_mc_dir():
    from brx_mcp import storage
    from brx_mcp.mc import store as mc_store
    with _FakeRealHome() as fake_home:
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="brx-mcp-home-"))
        os.environ["BRX_MCP_HOME"] = str(tmp)
        assert storage.home_dir() == tmp
        assert mc_store.mc_dir() == tmp / "mc"
        assert _sqlite_files(fake_home) == []


def test_BRX_MCP_HOME_unset_falls_back_to_the_real_dotfile_path():
    """Real (non-demo, non-ephemeral, no BRX_MCP_HOME) behaviour is unchanged: a bench run still
    lands in ~/.brx-mcp, not silently redirected somewhere the operator would never find it."""
    from brx_mcp import storage
    from brx_mcp.mc import store as mc_store
    with _FakeRealHome() as fake_home:
        assert storage.home_dir() == fake_home / ".brx-mcp"
        assert mc_store.mc_dir() == fake_home / ".brx-mcp" / "mc"


def test_run_tests_py_sets_BRX_MCP_HOME_before_importing_any_test_module():
    """run_tests.py is the suite's own entry point, so it is the one place that can guarantee EVERY
    test file (and every subprocess one of them spawns) inherits an isolated home, even a test that
    never mentions BRX_MCP_HOME itself. Guard against the env var getting set after test discovery
    starts importing brx_mcp-adjacent code."""
    src = (pathlib.Path(__file__).resolve().parent.parent / "run_tests.py").read_text()
    set_at = src.find('os.environ["BRX_MCP_HOME"] = _tmp_home')
    first_import = src.find("from _skip import")
    assert set_at != -1, "run_tests.py no longer sets BRX_MCP_HOME"
    assert first_import != -1, "run_tests.py's structure changed -- update this test's anchor"
    assert set_at < first_import, "BRX_MCP_HOME is wired AFTER test-module imports can start"


def test_the_tunnel_pidfile_and_the_stage_verdict_log_follow_BRX_MCP_HOME_too():
    """Two more writers that hardcoded `Path.home() / ".brx-mcp"` and so ignored the isolation entirely:
    the cloudflared pidfile (any `Tunnel()` built without an explicit `pid_dir` -- every test that
    constructs one) and the bench stage's verdict sink. Neither is a session store, and both landed in
    the operator's real home whatever BRX_MCP_HOME said."""
    from brx_mcp.mc.tunnel import Tunnel
    from brx_mcp.stage import stage as _stage
    with _FakeRealHome() as fake_home:
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="brx-mcp-home-"))
        os.environ["BRX_MCP_HOME"] = str(tmp)
        assert Tunnel()._pid_dir == tmp
        _stage._append_verdict({"ok": True}, "home-isolation-test.jsonl")
        assert (tmp / "home-isolation-test.jsonl").exists()
        strays = [p for p in fake_home.rglob("*") if p.is_file()]
        assert strays == [], f"something still wrote into the (stand-in) real home: {strays}"


def test_no_mission_control_module_hardcodes_the_dotfile_path():
    """The rule, checked where it can be broken. `storage.home_dir()` is the one place `~/.brx-mcp` is
    spelled, so anything that re-spells it is a writer the isolation cannot move -- which is exactly how
    `mc/api.py` (the bench verdict log, the staged APK) and `mc/tunnel.py` (the pidfile) kept writing
    into the real home after BRX_MCP_HOME landed.

    Scope: the MC server package, which is what a test run boots. The bench CLI's own paths
    (`brx_mcp/__main__.py`'s sound-audit log, and `usbconsole.py` / `mc/pieces.py` through the legacy
    import-time `storage.BASE_DIR`) are the same shape and are NOT covered here -- see storage.py's note
    on BASE_DIR."""
    root = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc"
    bad = []
    for f in sorted(root.rglob("*.py")):
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if ".brx-mcp" not in line or line.lstrip().startswith("#"):
                continue
            if "home()" in line or "expanduser" in line:
                bad.append(f"{f.name}:{i}: {line.strip()}")
    assert not bad, "hardcoded dotfile path instead of storage.home_dir(): " + "; ".join(bad)


def _broken(module: str, name: str):
    """Make `from .<module> import <name>` raise inside build(), as a broken install would."""
    import importlib
    mod = importlib.import_module(f"brx_mcp.mc.{module}")
    real = getattr(mod, name)

    class _Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("weapons.json is broken")
    setattr(mod, name, _Boom)
    return lambda: setattr(mod, name, real)


def test_a_real_run_that_cannot_build_the_compiler_or_the_net_exits_2_instead_of_using_the_fakes():
    """DRY review H1: a real MC fell back to FakeCompiler (whose try-out frames lack $START and $TID) or FakeNet on any
    error, with a log line. Now no run builds without the real compiler, and a real run refuses a broken net; --demo
    keeps the fake net."""
    import contextlib
    import io
    from brx_mcp.mc.__main__ import build
    from brx_mcp.mc.fakes import FakeNet
    for module, name, kw in (("compile", "Compiler", {"fake_net": True}), ("compile", "Compiler", {"fake_net": True, "demo": True}),
                             ("net", "NetServer", {"fake_net": False, "demo": False})):
        undo = _broken(module, name)
        try:
            err = io.StringIO()
            with _FakeRealHome(), contextlib.redirect_stderr(err):
                try:
                    build(_args(**{"demo": False, **kw}))
                except SystemExit as e:
                    assert e.code == 2, e.code
                else:
                    raise AssertionError(f"a run built with a broken {module}.{name} ({kw})")
            assert "cannot start" in err.getvalue() and "weapons.json is broken" in err.getvalue(), err.getvalue()
            if module == "net":         # --demo still runs, on the fake net
                with _FakeRealHome():
                    session, net, _extra = build(_args(demo=True, fake_net=False))
                    try:
                        assert isinstance(net, FakeNet)
                    finally:
                        if session.store is not None:
                            session.store.db.close()
        finally:
            undo()


def test_a_store_that_stopped_saving_is_announced_at_startup():
    """DRY H2 review: a store whose bad file could not be moved aside stops saving; MC must say so where the operator
    looks (the session snapshot already does), or a preset made today vanishes at the next restart."""
    import contextlib
    import io
    import brx_mcp.mc.favourites as F
    from brx_mcp.mc.__main__ import build
    real = F.FavouriteStore

    class _Off(real):
        def _load(self):
            self.path = None
    F.FavouriteStore = _Off
    out = io.StringIO()
    try:
        with _FakeRealHome(), contextlib.redirect_stdout(out):
            session, _net, _extra = build(_args())
            if session.store is not None:
                session.store.db.close()
    finally:
        F.FavouriteStore = real
    assert "saving favourites is OFF" in out.getvalue(), out.getvalue()
    assert "saving pieces is OFF" not in out.getvalue(), out.getvalue()


def test_a_compile_module_that_will_not_import_is_an_exit_2_not_a_traceback():
    """Codex r1 on DRY H1: fakes.py and state.py import compile.py at load, so an import failure there crashed build()
    before its own refusal. Simulated by blocking the module in sys.modules for a fresh import of build's imports."""
    import contextlib
    import io
    import sys
    from brx_mcp.mc.__main__ import build
    saved = {k: sys.modules.pop(k) for k in list(sys.modules) if k in ("brx_mcp.mc.compile", "brx_mcp.mc.fakes", "brx_mcp.mc.state")}
    sys.modules["brx_mcp.mc.compile"] = None     # `from . import compile` now raises ImportError
    err = io.StringIO()
    try:
        with _FakeRealHome(), contextlib.redirect_stderr(err):
            try:
                build(_args())
            except SystemExit as e:
                assert e.code == 2, e.code
            else:
                raise AssertionError("build() ran without compile.py")
    finally:
        for k in ("brx_mcp.mc.compile", "brx_mcp.mc.fakes", "brx_mcp.mc.state"):
            sys.modules.pop(k, None)
        sys.modules.update(saved)
    assert "cannot start" in err.getvalue(), err.getvalue()


def test_a_real_run_with_a_broken_armory_exits_2_and_keeps_the_real_session():
    """brx5's landed-late review (High, reproduced with armory_overwrite.py): a real run fell back to the demo armory on
    ANY armory error, marked the session demo, and the operator's first change wrote a demo snapshot over the real
    session.json. The real roster was lost without a warning. A real run now refuses to build, and the file is untouched."""
    import contextlib
    import io
    import json
    from brx_mcp.mc.__main__ import build
    real = dict(demo=False, fake_net=True, ephemeral=False)
    with _FakeRealHome() as home:
        session, _net, _extra = build(_args(**real))          # seed a real session with two players
        try:
            session.add_player("Alice", team_id="red")
            session.add_player("Bob", team_id="blue")
            session.persist_now()
        finally:
            if session.store is not None:
                session.store.db.close()
        path = home / ".brx-mcp" / "session.json"
        seeded = path.read_bytes()
        assert json.loads(seeded)["demo"] is False and len(json.loads(seeded)["players"]) == 2
        undo = _broken("armory", "LocalArmory")
        err = io.StringIO()
        try:
            with contextlib.redirect_stderr(err):
                try:
                    build(_args(**real))
                except SystemExit as e:
                    assert e.code == 2, e.code
                else:
                    raise AssertionError("a real run built on a broken armory")
        finally:
            undo()
        assert "the armory" in err.getvalue() and "weapons.json is broken" in err.getvalue(), err.getvalue()
        assert path.read_bytes() == seeded, "the real session.json changed"


def test_a_demo_session_never_writes_over_a_real_session_file():
    """The second guard for the same loss: whatever marks a session demo, its snapshot must not replace a file that
    holds a real session (an explicit --session-file pointed at a real snapshot, or any future path to demo)."""
    import json
    import random
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
    from brx_mcp.mc.state import Session
    d = pathlib.Path(tempfile.mkdtemp(prefix="brx-demo-over-real-"))
    path = d / "session.json"
    path.write_text(json.dumps({"v": 1, "demo": False, "players": [{"player_id": "p1", "display": "REAL"}]}))
    before = path.read_bytes()
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), voice_rng=random.Random(1))
    s.demo_session = True
    s._persist_path = path
    s.add_player("Ghost", team_id="red")
    s.persist_now()
    assert path.read_bytes() == before, "a demo snapshot replaced the real session file"
    path.write_text(json.dumps({"v": 1, "demo": True, "players": []}))
    s.add_player("Ghost2", team_id="blue")          # a new change, so there is something to save
    s.persist_now()
    assert json.loads(path.read_text())["players"], "a demo session still saves over its own demo file"
    real = json.dumps({"v": 1, "demo": False, "players": [{"player_id": "p1", "display": "REAL"}]})
    path.write_text(real)
    s.new_session(keep_roster=False)                # NEW MATCH > fresh session removes its own file, never a real one
    assert path.exists() and path.read_text() == real, "a demo session's fresh start deleted the real session file"
    # a file the demo cannot read is protected too (Codex r1): unparseable, and from another store version
    for content in ("{not json", json.dumps({"v": 999, "players": [{"player_id": "p9"}]})):
        path.write_text(content)
        s2 = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), voice_rng=random.Random(2))
        s2.demo_session, s2._persist_path = True, path
        assert s2.restore_snapshot() == 0 and path.read_text() == content, "a demo restore moved a file it could not prove demo"
        s2.add_player("Ghost3", team_id="red")
        s2.persist_now()
        s2.new_session(keep_roster=False)
        assert path.exists() and path.read_text() == content, "a demo session replaced or deleted a file it could not read"


def test_a_bad_armory_file_still_starts_a_real_mc_with_the_banner():
    """brx1's field-safety check on the fix above: only a LocalArmory that cannot be CONSTRUCTED exits 2. A missing,
    corrupt (O2: banner + DISMISS) or unreadable armory.json is match-day data, read after start, so a real MC still
    starts on the real armory and the console shows armory_corrupt for the two bad files."""
    import os
    import brx_mcp.storage as storage
    from brx_mcp.mc.__main__ import build
    from brx_mcp.mc.armory import LocalArmory
    cases = ["missing", "corrupt"] + (["unreadable"] if hasattr(os, "geteuid") and os.geteuid() != 0 else [])
    for case in cases:
        base = pathlib.Path(tempfile.mkdtemp(prefix=f"brx-armory-{case}-"))
        inv = base / "armory.json"
        if case == "corrupt":
            inv.write_text("{not json")
        elif case == "unreadable":
            inv.write_text("{}")
            inv.chmod(0)
        saved = storage.BASE_DIR
        storage.BASE_DIR = base
        try:
            with _FakeRealHome():
                try:
                    session, _net, _extra = build(_args(demo=False, fake_net=True, ephemeral=True))
                except SystemExit as e:
                    raise AssertionError(f"a {case} armory.json stopped a real MC (exit {e.code})") from None
                try:
                    assert isinstance(session.armory, LocalArmory) and session.demo_session is False, case
                    session.armory.list()                          # the first read, as a muster does
                    banner = session.snapshot().get("armory_corrupt")
                    if case == "missing":
                        assert banner is None, (case, banner)
                    else:
                        assert banner and banner.get("error"), (case, banner)
                finally:
                    if session.store is not None:
                        session.store.db.close()
        finally:
            storage.BASE_DIR = saved
            if case == "unreadable":
                inv.chmod(0o600)
