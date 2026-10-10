"""OP11 (maintainability review 2026-10-10): session stores were created 0644 in a 0755 folder (readable by every local
user; they hold PINs and node keys in raw facts) and `~/.brx-mcp/mc` was never pruned (4,373 files, 630 MB on the dev
box). A store is 0600 in a 0700 folder now, and `prune_session_stores` mirrors scripts/lib/evidence.mjs: a store goes
only when it is beyond the newest `keep` AND older than `days`, never the one session.json points at (a resume reads it),
and orphaned -wal/-shm files go with their database."""
from __future__ import annotations

import errno
import os
import pathlib
import stat
import tempfile
import time

from _skip import needs

import importlib.util
HAVE_UVICORN = importlib.util.find_spec("uvicorn") is not None


def _home():
    old = os.environ.get("BRX_MCP_HOME")
    home = pathlib.Path(tempfile.mkdtemp())
    os.environ["BRX_MCP_HOME"] = str(home)
    return home, old


def _restore(old):
    if old is None:
        os.environ.pop("BRX_MCP_HOME", None)
    else:
        os.environ["BRX_MCP_HOME"] = old


def test_a_new_store_is_private():
    needs(os.name != "nt", "POSIX modes")
    from brx_mcp.mc.store import Store, mc_dir
    home, old = _home()
    try:
        st = Store("perm1")
        st.log("n1", "status", 1, None, 0, None, False, {"x": 1})
        assert stat.S_IMODE(os.stat(st.path).st_mode) == 0o600, oct(os.stat(st.path).st_mode)
        assert stat.S_IMODE(os.stat(mc_dir()).st_mode) == 0o700, oct(os.stat(mc_dir()).st_mode)
        for side in ("-wal", "-shm"):
            p = pathlib.Path(str(st.path) + side)
            if p.exists():
                assert stat.S_IMODE(os.stat(p).st_mode) & 0o077 == 0, (side, oct(os.stat(p).st_mode))
        st.close()
    finally:
        _restore(old)


def test_prune_keeps_the_newest_the_recent_and_the_resumed_store():
    from brx_mcp.mc.store import mc_dir, prune_session_stores
    home, old = _home()
    try:
        d = mc_dir()
        now = time.time()
        day = 86400
        made = []
        for i in range(40):
            p = d / f"session-s{i:02d}.sqlite"
            p.write_bytes(b"x")
            age = (40 - i) * day          # s00 is 40 days old, s39 one day old
            os.utime(p, (now - age, now - age))
            made.append(p)
        (d / "session-gone.sqlite-wal").write_bytes(b"x")   # an orphan: no database beside it
        resumed = made[0]                                    # the oldest, but session.json points at it
        removed = prune_session_stores(keep=30, days=30, protect={str(resumed)}, now=now)
        left = {p.name for p in d.iterdir()}
        assert resumed.name in left, "the store a resume reads is never pruned"
        assert all(made[i].name in left for i in range(10, 40)), "the newest 30 stay"
        assert all(made[i].name not in left for i in range(1, 10)), "beyond the newest 30 AND older than 30 days goes"
        assert "session-gone.sqlite-wal" not in left, "an orphaned -wal goes"
        assert len(removed) == 10, removed
    finally:
        _restore(old)


def test_prune_never_removes_a_store_younger_than_the_window():
    from brx_mcp.mc.store import mc_dir, prune_session_stores
    home, old = _home()
    try:
        d = mc_dir()
        for i in range(50):
            (d / f"session-y{i:02d}.sqlite").write_bytes(b"x")   # all brand new
        assert prune_session_stores(keep=30, days=30) == []
        assert len(list(d.iterdir())) == 50
    finally:
        _restore(old)


def test_prune_ages_a_store_by_its_wal_and_survives_a_vanished_file():
    """OP11 review (Codex r1): the age came from the database file alone, so a long-lived store whose recent writes sit
    in its -wal could go; and a file removed between the listing and its stat() raised out of the prune."""
    from brx_mcp.mc import store as store_mod
    home, old = _home()
    try:
        d = store_mod.mc_dir()
        now = time.time()
        for i in range(32):   # 32 old stores, so the two oldest are beyond keep=30
            p = d / f"session-w{i:02d}.sqlite"
            p.write_bytes(b"x")
            os.utime(p, (now - (60 - i) * 86400,) * 2)
        wal = d / "session-w00.sqlite-wal"
        wal.write_bytes(b"w")             # the oldest database, written to a minute ago
        os.utime(wal, (now - 60,) * 2)
        real_stat = pathlib.Path.stat
        def flaky(self, *a, **k):         # w01 vanishes after the listing, before its stat
            if self.name == "session-w01.sqlite":
                raise FileNotFoundError(errno.ENOENT, "gone", str(self))
            return real_stat(self, *a, **k)
        pathlib.Path.stat = flaky
        try:
            gone = store_mod.prune_session_stores(now=now)
        finally:
            pathlib.Path.stat = real_stat
        assert "session-w00.sqlite" not in gone and (d / "session-w00.sqlite").exists(), gone
    finally:
        _restore(old)


def test_mc_dir_does_not_chmod_through_a_symlink():
    needs(os.name != "nt", "POSIX modes")
    from brx_mcp.mc.store import mc_dir
    home, old = _home()
    try:
        shared = home / "shared"
        shared.mkdir(mode=0o755)
        os.chmod(shared, 0o755)
        (home / "mc").symlink_to(shared)
        mc_dir()
        assert stat.S_IMODE(os.stat(shared).st_mode) == 0o755, oct(os.stat(shared).st_mode)
    finally:
        _restore(old)


def test_build_prunes_at_a_persistent_start_and_never_for_a_demo():
    """OP11 review (Opus r1, Low): the build() wiring had no test. A persistent start prunes but keeps the store that
    session.json's match resumes from (named by a different spelling of the same path); a demo prunes nothing."""
    needs(HAVE_UVICORN, "uvicorn")
    import json
    import shutil
    from brx_mcp.mc.__main__ import build, parser
    from brx_mcp.mc.store import mc_dir
    home, old = _home()
    old_tmp = tempfile.tempdir
    tempfile.tempdir = str(home)        # a demo build's scratch folder lands here and goes with it
    try:
        d = mc_dir()
        now = time.time()
        for i in range(35):
            p = d / f"session-b{i:02d}.sqlite"
            p.write_bytes(b"x")
            os.utime(p, (now - (70 - i) * 86400,) * 2)
        spelled = os.path.join(str(home), "mc", "..", "mc", "session-b00.sqlite")   # the oldest, a different spelling
        (home / "session.json").write_text(json.dumps({"match": {"store_path": spelled}}), encoding="utf-8")
        built = [build(parser().parse_args(["--demo", "--fake-net", "--no-auth"]))[0]]
        assert all((d / f"session-b{i:02d}.sqlite").exists() for i in range(35)), "a demo prunes nothing"
        built.append(build(parser().parse_args(["--fake-net", "--no-auth"]))[0])
        assert (d / "session-b00.sqlite").exists(), "the store session.json resumes from stays"
        assert not (d / "session-b01.sqlite").exists(), "an old store beyond the newest 30 goes"
        for s in built:
            if s.store:
                s.store.close()
    finally:
        tempfile.tempdir = old_tmp
        _restore(old)
        shutil.rmtree(home, ignore_errors=True)
