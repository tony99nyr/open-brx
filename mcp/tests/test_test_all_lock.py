"""scripts/lib/lock.mjs: the machine-wide test-all lock's stale-entry logic.

WHY (2026-09-27). test-all.mjs used to lock `.test-all.lock` inside the checkout, so two worktrees on the same
box each got their own lock and ran full suites at once, starving each other's memory/CPU budget until jobs blew
their kill timeout. The lock moved to one machine-wide location, keyed by uid under a FIXED /tmp path (not
$XDG_RUNTIME_DIR/$TMPDIR, which can differ between session types for the same account and so defeat the whole
point). These tests pin the two subtle parts: a crashed run's entry (a confirmed-dead pid) is reclaimed almost
at once, not after the full 60 s heartbeat window a merely-wedged-but-alive run still needs, but NOT instantly
either -- an independent review (2026-09-27) flagged that an instant reclaim trusts a pid read the moment its
heartbeat lapses, which pid namespacing/reuse can make say "alive" or "dead" about the WRONG process; a ~10 s
grace past the missed heartbeat removes that coincidence at negligible cost when the holder really is gone.
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


def test_is_stale_does_not_trust_a_dead_pid_the_instant_the_heartbeat_lapses():
    # changedAt == now: no idle time has passed at all. Even though the pid is confirmed dead, this must NOT
    # reclaim yet -- a bare "is it dead" check taken at this exact instant is exactly what pid reuse could fool.
    dead = _dead_pid()
    name = f"000000000000001-{dead}-xxxxxx"
    now = 1_000_000
    assert _call("isStale", name, now, now) is False


def test_is_stale_reclaims_a_dead_pid_after_the_grace_period():
    dead = _dead_pid()
    name = f"000000000000001-{dead}-xxxxxx"
    now = 1_000_000
    assert _call("isStale", name, now - 5_000, now) is False    # 5s idle: still inside the ~10s grace
    assert _call("isStale", name, now - 15_000, now) is True    # 15s idle: past the grace, reclaim


def test_is_stale_waits_out_the_full_heartbeat_for_a_live_but_wedged_process():
    import os
    name = f"000000000000001-{os.getpid()}-xxxxxx"
    now = 1_000_000
    assert _call("isStale", name, now - 30_000, now) is False   # 30s idle, under the 60s window
    assert _call("isStale", name, now - 70_000, now) is True    # 70s idle: reclaim even though alive


def test_lock_dir_name_is_keyed_by_uid():
    a, b = _call("lockDirName", 501), _call("lockDirName", 1000)
    assert a != b
    assert "501" in a and "1000" in b
