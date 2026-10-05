"""Releasing the pool mutex must never leave the live `.mutex` directory empty. The old release deleted the owner
file, then the directory: in between it was EMPTY, and Linux lets another process's rename land on an empty
directory, so a waiter that stalled between its exists-check and its rename took the mutex, and the releaser's
rmdir failed ENOTEMPTY, which closed its pool (a gate on 2026-10-04 lost six jobs to "test pool is closed").
The release now renames its own non-empty mutex away in one step, then deletes the copy."""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

from _skip import needs

REPO = pathlib.Path(__file__).resolve().parents[2]
POOL_MOD = REPO / "scripts" / "lib" / "pool.mjs"
NODE = shutil.which("node")


def test_the_hazard_is_real_rename_lands_on_an_empty_directory():
    with tempfile.TemporaryDirectory() as d:
        live, mine = pathlib.Path(d) / ".mutex", pathlib.Path(d) / "candidate"
        live.mkdir(); mine.mkdir(); (mine / "owner").write_text("2")
        os.rename(mine, live)   # succeeds on Linux because `live` is empty: the window the old release opened
        assert (live / "owner").read_text() == "2"


def test_release_never_removes_the_live_mutex_in_place():
    needs(NODE, "node")
    with tempfile.TemporaryDirectory() as d:
        pool_dir = pathlib.Path(d) / "pool"
        mutex = pool_dir / ".mutex"
        script = f"""
          import fs from 'node:fs';
          const live = {json.dumps(str(mutex))};
          const rm = fs.rmSync, rmdir = fs.rmdirSync, unlink = fs.unlinkSync;
          fs.rmSync = (p, o) => {{ if (String(p) === live) throw new Error('rmSync on the live mutex'); return rm(p, o); }};
          fs.rmdirSync = (p, o) => {{ if (String(p) === live) throw new Error('rmdirSync on the live mutex'); return rmdir(p, o); }};
          fs.unlinkSync = p => {{ if (String(p).startsWith(live + '/')) throw new Error('unlink inside the live mutex'); return unlink(p); }};
          const {{ createPool }} = await import({json.dumps(POOL_MOD.as_uri())});
          const pool = createPool({{ dir: {json.dumps(str(pool_dir))}, poolMb: 100000, reserveMb: 0, poolCores: 100,
            oldLockDir: {json.dumps(str(pathlib.Path(d) / 'old-lock'))}, pollMs: 1, heartbeatMs: 100000,
            staleMs: 600000, readAvailableMb: () => 100000, taskHeadroom: () => null }});
          for (let i = 0; i < 5; i++) {{ const l = pool.tryAcquire({{ runId: 'r', job: 'j' + i, mb: 1 }}); if (l) l.release(); }}
          pool.close();
          if (fs.existsSync(live)) throw new Error('the mutex was left behind');
          console.log('ok');
        """
        r = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True,
                           timeout=60)
        assert r.returncode == 0 and "ok" in r.stdout, (r.returncode, r.stderr[-400:])
