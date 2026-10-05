"""scripts/lib/reap.mjs: a gate's leftovers are found by an environment token and stopped (2026-10-05: six demo MCs,
started `detached` by e2e scripts that died on SIGTERM, ran for 15 h after their lander worktree was deleted)."""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
REAP_MOD = REPO / "scripts" / "lib" / "reap.mjs"
NODE = shutil.which("node")


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # A zombie still answers kill(0); it is gone for our purpose.
    try:
        return Path(f"/proc/{pid}/stat").read_text().split(") ")[1][0] != "Z"
    except (OSError, IndexError):
        return False


def _orphan(token: str, ignore_term: bool) -> int:
    """Start a process in a session of its own (as an e2e script starts MC), carrying the token. Returns its pid."""
    body = ("import signal, time\n"
            + ("signal.signal(signal.SIGTERM, signal.SIG_IGN)\n" if ignore_term else "")
            + "time.sleep(60)\n")
    proc = subprocess.Popen([sys.executable, "-c", body], env={**os.environ, "BRX_TEST_REAP": token},
                            start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return proc.pid


def _reap(token: str, prefix: bool = False) -> list:
    needs(NODE, "node")
    script = (f"const m = await import({json.dumps(REAP_MOD.as_uri())});"
              f"console.log(JSON.stringify(await m.reapByEnv('BRX_TEST_REAP', {json.dumps(token)}, "
              f"{{ prefix: {'true' if prefix else 'false'}, waitMs: 500 }})));")
    out = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=REPO, capture_output=True, text=True,
                         timeout=20)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_detached_leftover_with_the_job_token_is_reaped_and_others_are_not():
    if not Path("/proc/self/environ").exists():
        return   # Linux only, like the reaper
    token = f"t{os.getpid()}-{time.time_ns()}"
    mine = _orphan(f"{token}:mc-play", ignore_term=False)
    stubborn = _orphan(f"{token}:mc-play", ignore_term=True)     # ignores SIGTERM: needs the SIGKILL
    other = _orphan(f"{token}:mc-koth", ignore_term=False)       # another job's: must survive this job's reap
    try:
        time.sleep(0.3)
        got = _reap(f"{token}:mc-play")
        assert sorted(p["pid"] for p in got) == sorted([mine, stubborn]), got
        time.sleep(0.2)
        assert not _alive(mine) and not _alive(stubborn)
        assert _alive(other), "a reap of one job stopped another job's process"
        got = _reap(f"{token}:", prefix=True)                    # the run-wide reap on a signal
        assert [p["pid"] for p in got] == [other], got
    finally:
        for pid in (mine, stubborn, other):
            try:
                os.kill(pid, 9)
            except ProcessLookupError:
                pass
