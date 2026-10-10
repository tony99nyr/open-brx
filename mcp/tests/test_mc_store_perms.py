"""OP11 (maintainability review 2026-10-10): session stores were created 0644 in a 0755 folder (readable by every local
user; they hold PINs and node keys in raw facts) and `~/.brx-mcp/mc` was never pruned (4,373 files, 630 MB on the dev
box). A store is 0600 in a 0700 folder now, and `prune_session_stores` mirrors scripts/lib/evidence.mjs: a store goes
only when it is beyond the newest `keep` AND older than `days`, never the one session.json points at (a resume reads it),
and orphaned -wal/-shm files go with their database."""
from __future__ import annotations

import os
import pathlib
import stat
import tempfile
import time

from _skip import needs


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
