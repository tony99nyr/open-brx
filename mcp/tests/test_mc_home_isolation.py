"""BRX_MCP_HOME: the operator's real ~/.brx-mcp is field evidence, not a test scratch pad.

2026-09-13: test runs (every e2e boot's `python -m brx_mcp.mc --demo/--ephemeral`, the app's
fake-game e2e runner, `run_tests.py` itself) were littering `~/.brx-mcp/mc/session-*.sqlite` --
hundreds of them, mostly empty -- because `build()` constructed the session `Store` unconditionally,
never checking `--demo`/`--ephemeral` the way the presets shelf and the tunnel pidfile already did.
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
    (`brx_mcp/__main__.py`'s sound-audit log, and `usbconsole.py` / `mc/presets.py` through the legacy
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
