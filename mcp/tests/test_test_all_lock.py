"""scripts/lib/lock.mjs: the machine-wide test-all lock's stale-entry logic.

WHY (2026-09-27). test-all.mjs used to lock `.test-all.lock` inside the checkout, so two worktrees on the same
box each got their own lock and ran full suites at once, starving each other's memory/CPU budget until jobs blew
their kill timeout. The lock moved to one machine-wide location (scripts/test-all.mjs), keyed by user; these
tests pin the one subtle part of that: a crashed run's entry (a confirmed-dead pid) must be reclaimed AT ONCE,
not after the 60 s heartbeat window a merely-wedged-but-alive run still needs.
"""
import json
import shutil
import subprocess
import time
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
LOCK_MOD = REPO / "scripts" / "lib" / "lock.mjs"
NODE = shutil.which("node")


def _call(fn: str, *args) -> str:
    needs(NODE, "node")
    js_args = ", ".join(json.dumps(a) for a in args)
    expr = f"import({json.dumps(LOCK_MOD.as_uri())}).then(m => console.log(JSON.stringify(m.{fn}({js_args}))))"
    res = subprocess.run([NODE, "--input-type=module", "-e", expr], cwd=REPO,
                          capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def _dead_pid() -> int:
    """A pid that is guaranteed not to exist any more: spawn `node -e ""` and let it exit."""
    p = subprocess.Popen([NODE, "-e", ""])
    pid = p.pid
    p.wait(timeout=10)
    time.sleep(0.05)   # let the kernel actually reap it
    return pid


def test_entry_pid_parses_the_name():
    assert _call("entryPid", "000000000000001-4242-ab12cd") == 4242
    assert _call("entryPid", "garbage") is None


def test_pid_alive_is_true_for_our_own_process():
    needs(NODE, "node")
    import os
    assert _call("pidAlive", os.getpid()) is True


def test_pid_alive_is_false_once_the_process_has_exited():
    assert _call("pidAlive", _dead_pid()) is False


def test_is_stale_reclaims_a_dead_pid_at_once():
    # changedAt == now: no heartbeat timeout has elapsed at all, yet a dead pid is still reclaimed immediately.
    dead = _dead_pid()
    name = f"000000000000001-{dead}-xxxxxx"
    now = 1_000_000
    assert _call("isStale", name, now, now) is True


def test_is_stale_waits_out_the_heartbeat_for_a_live_but_wedged_process():
    import os
    name = f"000000000000001-{os.getpid()}-xxxxxx"
    now = 1_000_000
    assert _call("isStale", name, now - 30_000, now) is False   # 30s idle, under the 60s window
    assert _call("isStale", name, now - 70_000, now) is True    # 70s idle: reclaim even though alive


def test_lock_dir_name_is_keyed_by_user():
    a, b = _call("lockDirName", "alice"), _call("lockDirName", "bob")
    assert a != b
    assert "alice" in a and "bob" in b
