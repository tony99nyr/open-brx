"""The checkout lock uses real paths and reclaims stale tickets."""
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
LOCK_MOD = REPO / "scripts" / "lib" / "lock.mjs"
NODE = shutil.which("node")


def _temporary_path(test):
    def run():
        with tempfile.TemporaryDirectory() as directory:
            return test(Path(directory))
    return run


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
    # The heartbeat has not lapsed when changedAt equals now.
    dead = _dead_pid()
    name = f"000000000000001-{dead}-xxxxxx"
    now = 1_000_000
    assert _call("isStale", name, now, now) is False


def test_is_stale_reclaims_a_dead_pid_after_the_grace_period():
    dead = _dead_pid()
    name = f"000000000000001-{dead}-xxxxxx"
    now = 1_000_000
    assert _call("isStale", name, now - 5_000, now) is False
    assert _call("isStale", name, now - 15_000, now) is True


def test_is_stale_waits_out_the_full_heartbeat_for_a_live_but_wedged_process():
    import os
    name = f"000000000000001-{os.getpid()}-xxxxxx"
    now = 1_000_000
    assert _call("isStale", name, now - 30_000, now) is False
    assert _call("isStale", name, now - 70_000, now) is True


@_temporary_path
def test_checkout_lock_dir_is_keyed_by_uid(tmp_path):
    a, b = _call("checkoutLockDir", str(tmp_path), 501), _call("checkoutLockDir", str(tmp_path), 1000)
    assert a != b
    assert "501" in a and "1000" in b


@_temporary_path
def test_checkout_lock_dir_uses_realpath_and_separates_checkouts(tmp_path):
    checkout_lock_dir = tmp_path / "checkout"
    checkout_lock_dir.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(checkout_lock_dir, target_is_directory=True)
    other_root = tmp_path / "other"
    other_root.mkdir()
    a, same, other = _call("checkoutLockDir", str(checkout_lock_dir), 1000), _call(
        "checkoutLockDir", str(alias), 1000
    ), _call("checkoutLockDir", str(other_root), 1000)
    assert a == same
    assert a != other
    assert "1000" in a


@_temporary_path
def test_checkout_lock_serialises_same_checkout_but_admits_another(tmp_path):
    needs(NODE, "node")
    root_a = tmp_path / "checkout-a"
    root_b = tmp_path / "checkout-b"
    root_a.mkdir()
    root_b.mkdir()
    # The first child holds checkout A. A second child for A must wait, while B can acquire at once.
    holder = _lock_child(root_a, hold_ms=1200)
    try:
        assert holder.stdout is not None
        assert holder.stdout.readline().strip() == "acquired"
        blocked = _lock_child(root_a, hold_ms=0)
        parallel = _lock_child(root_b, hold_ms=0)
        try:
            assert parallel.communicate(timeout=5)[0].strip() == "acquired"
            time.sleep(0.15)
            assert blocked.poll() is None
            assert blocked.communicate(timeout=5)[0].strip() == "acquired"
        finally:
            if blocked.poll() is None:
                blocked.kill()
                blocked.wait(timeout=5)
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)


def _lock_child(root: Path, hold_ms: int) -> subprocess.Popen:
    script = f"""
      import {{ acquireCheckoutLock }} from {json.dumps(LOCK_MOD.as_uri())};
      const release = await acquireCheckoutLock({json.dumps(str(root))}, {{ pollMs: 20,
        oldLockDir: {json.dumps(str(root.parent / 'old-lock'))} }});
      console.log('acquired');
      await new Promise(r => setTimeout(r, {hold_ms}));
      await release();
    """
    return subprocess.Popen(
        [NODE, "--input-type=module", "-e", script], cwd=REPO,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
