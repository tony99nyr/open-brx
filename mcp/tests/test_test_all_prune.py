"""scripts/lib/prune.mjs: old test-all log dirs are removed at start-up (2026-10-05: 1,722 of them, 19 GB, in /tmp)."""
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
PRUNE_MOD = REPO / "scripts" / "lib" / "prune.mjs"
NODE = shutil.which("node")
DEAD = 4_000_000   # above the default pid_max range in use here; never a live pid in this test


def _dir(root: Path, pid: int, age_h: float) -> Path:
    d = root / f"brx-test-all-{pid}"
    d.mkdir()
    (d / "mcp.log").write_text("x")
    t = time.time() - age_h * 3600
    os.utime(d, (t, t))
    return d


def test_only_old_dead_runs_are_pruned_and_the_newest_are_kept():
    needs(NODE, "node")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        live_old = _dir(root, os.getpid(), 48)          # a live pid: never pruned, however old
        fresh = _dir(root, DEAD + 1, 2)                  # dead but young
        olds = [_dir(root, DEAD + 10 + i, 30 + i) for i in range(8)]   # dead and old; the newest 5 stay
        other = root / "brx-test-all-notapid"
        other.mkdir()
        script = (f"const m = await import({json.dumps(PRUNE_MOD.as_uri())});"
                  f"console.log(JSON.stringify(m.pruneRunLogs({json.dumps(str(root))}, {{ keep: 5, self: 1 }})));")
        out = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True,
                             timeout=20)
        assert out.returncode == 0, out.stderr
        gone = sorted(json.loads(out.stdout))
        assert gone == sorted(str(d) for d in olds[5:]), gone   # the three oldest
        assert live_old.exists() and fresh.exists() and other.exists()
        assert all(d.exists() for d in olds[:5])
