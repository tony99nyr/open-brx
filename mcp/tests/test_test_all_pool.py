"""Cross-process tests for the shared test lease pool."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
POOL_MOD = REPO / "scripts" / "lib" / "pool.mjs"
TEST_ALL = REPO / "scripts" / "test-all.mjs"
NODE = shutil.which("node")


def _temporary_path(test):
    def run():
        with tempfile.TemporaryDirectory() as directory:
            return test(Path(directory))
    return run


def _child(pool_dir: Path, job: str, mb: int, cores: int = 1, hold_ms: int = 0,
           pool_mb: int = 1000, available: int = 100000, mem_file: Path | None = None,
           extra: str = "", acquired_file: Path | None = None,
           release_file: Path | None = None) -> subprocess.Popen:
    needs(NODE, "node")
    source = (f"Number(fs.readFileSync({json.dumps(str(mem_file))}, 'utf8'))"
              if mem_file else str(available))
    script = f"""
      import fs from 'node:fs';
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const pool = createPool({{
        dir: {json.dumps(str(pool_dir))}, poolMb: {pool_mb}, reserveMb: 100,
        poolCores: 4, pollMs: 15, heartbeatMs: 100, staleMs: 5000,
        readAvailableMb: () => {source}, taskHeadroom: () => null, {extra}
      }});
      const lease = await pool.acquire({{
        runId: String(process.pid), job: {json.dumps(job)}, mb: {mb}, cores: {cores},
        onTicket: n => console.log('ticket ' + n)
      }});
      console.log('acquired ' + Date.now());
      {f"fs.writeFileSync({json.dumps(str(acquired_file))}, 'acquired');" if acquired_file else ''}
      {f"while (!fs.existsSync({json.dumps(str(release_file))})) await new Promise(r => setTimeout(r, 10));" if release_file else f"await new Promise(r => setTimeout(r, {hold_ms}));"}
      console.log('released ' + Date.now());
      lease.release();
      pool.close();
    """
    return subprocess.Popen([NODE, "--input-type=module", "-e", script], cwd=REPO,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def _finish(proc: subprocess.Popen) -> dict:
    # A ceiling, not a wait: it returns as soon as the child exits. 5 s was too short for a Node start plus a reclaim
    # under the parallel suite's load (test_dead_owner_lease_is_reclaimed flaked twice on 2026-10-05).
    out, err = proc.communicate(timeout=20)
    assert proc.returncode == 0, f"stdout={out}\nstderr={err}"
    lines = [line.split() for line in out.splitlines()]
    assert [line[0] for line in lines] == ["ticket", "acquired", "released"], out
    return {key: int(value) for key, value in lines}


def _stop(*processes):
    for proc in processes:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


def _wait_entries(directory: Path, suffix: str, count: int = 1):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if directory.exists() and len(list(directory.glob(f"*{suffix}"))) >= count:
            return
        time.sleep(0.01)
    raise AssertionError(f"expected {count} {suffix} entries in {directory}")


def _wait_file(file: Path, timeout: float = 3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if file.exists():
            return
        time.sleep(0.01)
    raise AssertionError(f"expected file {file}")


def _run_pool_script(script):
    needs(NODE, "node")
    result = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=REPO,
                            capture_output=True, text=True, timeout=20)   # a ceiling, as in _finish
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"


def test_reservation_waits_for_every_dequeued_job_to_acquire_its_lease():
    runner = TEST_ALL.read_text()
    dequeued = runner.index("takeStartable(queue, ")   # lib/scheduler.mjs dequeues; the loop body below is per started job
    assert "let pendingAdmissions = 0;" in runner[:dequeued]
    assert "pendingAdmissions++;" in runner[dequeued:runner.index("(async () =>", dequeued)]
    admission = runner[runner.index("await acquireJobLease(j)", dequeued):runner.index("const runJob = admission.sized", dequeued)]
    assert re.search(r"finally\s*\{\s*pendingAdmissions--;\s*if \(!queue.length && pendingAdmissions === 0\) reservation.update\(0\);", admission), (
        "the reservation must cover every dequeued job awaiting its lease")


@_temporary_path
def test_task_headroom_blocks_pool_admission_until_room_returns(tmp_path):
    script = f"""
      import fs from 'node:fs';
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const dir = {json.dumps(str(tmp_path / 'pool'))};
      let free = 149;
      const pool = createPool({{ dir, poolMb: 1000, reserveMb: 0, poolCores: 4,
        readAvailableMb: () => 10000, taskHeadroom: () => ({{ max: 500, free }}),
        taskReserve: 100, pollMs: 10 }});
      const waiting = pool.acquire({{ runId: 'one', job: 'solo', mb: 100, cores: 1, tasks: 50 }});
      if (fs.readdirSync(dir).some(name => name.endsWith('.lease'))) throw new Error('task check admitted solo job');
      free = 150;
      const lease = await waiting;
      if (lease.tasks !== 50) throw new Error('lease did not record task allowance');
      lease.release(); pool.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_observed_tasks_reduce_pending_across_runs_without_time_limit(tmp_path):
    script = f"""
      import fs from 'node:fs';
      import path from 'node:path';
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const dir = {json.dumps(str(tmp_path / 'pool'))};
      let free = 600;
      const pool = createPool({{ dir, poolMb: 1000, reserveMb: 0, poolCores: 4,
        readAvailableMb: () => 10000, taskHeadroom: () => ({{ max: 1000, free }}),
        taskReserve: 0, pollMs: 10 }});
      const first = await pool.acquire({{ runId: 'checkout-a', job: 'first', mb: 100, cores: 1, tasks: 500 }});
      first.setTasks(100);
      free = 450;
      const small = pool.tryAcquire({{ runId: 'checkout-b', job: 'small', mb: 100, cores: 1, tasks: 50 }});
      if (!small) throw new Error('500 allowance minus 100 observed did not leave 50 tasks');
      small.release();
      const record = JSON.parse(fs.readFileSync(first.file, 'utf8'));
      record.admittedAt = Date.now() - 20001;
      fs.writeFileSync(first.file, JSON.stringify(record));
      if (pool.tryAcquire({{ runId: 'checkout-b', job: 'second', mb: 100, cores: 1, tasks: 100 }}) !== null)
        throw new Error('old lease lost its pending allowance');
      const second = pool.acquire({{ runId: 'checkout-b', job: 'second', mb: 100, cores: 1, tasks: 100 }});
      if (fs.readdirSync(dir).filter(name => name.endsWith('.lease')).length !== 1)
        throw new Error('measured lease allowance was ignored');
      first.setTasks(600);
      const admitted = await second;
      if (admitted.tasks !== 100) throw new Error('observed use above allowance did not count as zero pending');
      admitted.release(); first.release(); pool.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_late_raise_checks_live_tasks_and_recent_allowance(tmp_path):
    script = f"""
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const pool = createPool({{ dir: {json.dumps(str(tmp_path / 'pool'))}, poolMb: 1000,
        reserveMb: 0, poolCores: 4, readAvailableMb: () => 10000,
        taskHeadroom: () => ({{ max: 500, free }}), taskReserve: 100 }});
      let free = 250;
      const base = await pool.acquire({{ runId: 'one', job: 'screens', mb: 300, cores: 1, tasks: 100 }});
      const extra = {{ runId: 'one', job: 'screens-extra', mb: 240, cores: 1, tasks: 60 }};
      if (pool.tryAcquire(extra) !== null) throw new Error('late raise ignored recent allowance');
      free = 260;
      const raised = pool.tryAcquire(extra);
      if (!raised || raised.tasks !== 60) throw new Error('late raise did not admit with enough tasks');
      raised.release(); base.release(); pool.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_late_lease_is_nonblocking_and_respects_waiting_jobs(tmp_path):
    needs(NODE, "node")
    script = f"""
      import fs from 'node:fs';
      import path from 'node:path';
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const dir = {json.dumps(str(tmp_path / 'pool'))};
      let available = 100000;
      const pool = createPool({{ dir, poolMb: 1000, reserveMb: 0, poolCores: 4,
        readAvailableMb: () => available }});
      const first = await pool.acquire({{ runId: 'one', job: 'screens', mb: 700, cores: 1 }});
      const request = {{ runId: 'one', job: 'screens-extra', mb: 240, cores: 1 }};
      available = 900;
      if (pool.tryAcquire(request) !== null) throw new Error('pool ignored available memory');
      available = 100000;
      const extra = pool.tryAcquire(request);
      if (!extra || extra.mb !== 240) throw new Error('extra shard was not admitted');
      if (pool.tryAcquire(request) !== null) throw new Error('pool admitted beyond capacity');
      extra.release();
      const ticket = path.join(dir, '000000000000001-waiter.ticket');
      fs.writeFileSync(ticket, JSON.stringify({{ pid: process.pid, heartbeat: Date.now() }}));
      if (pool.tryAcquire(request) !== null) throw new Error('late shard bypassed a waiting job');
      fs.rmSync(ticket);
      if (!pool.tryAcquire(request)) throw new Error('late shard did not retry after capacity returned');
      first.release();
      pool.close();
    """
    result = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=REPO,
                            capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"


def test_extra_lease_accounting_helpers():
    needs(NODE, "node")
    script = f"""
      import {{ extraLeaseCores, extraLeasePss, splitLeaseTasks }} from {json.dumps(POOL_MOD.as_uri())};
      if (extraLeaseCores(3, 2) !== 2 || extraLeaseCores(2, 4) !== 2)
        throw new Error('extra lease core sizing does not match admitted shards');
      const pss = extraLeasePss(900, 700, 2);
      if (pss.length !== 2 || pss.reduce((a, b) => a + b, 0) !== 200)
        throw new Error('extra leases do not account for group PSS above the base lease');
      if (extraLeasePss(600, 700, 2).some(value => value !== 0))
        throw new Error('extra lease PSS must be zero below the base lease estimate');
      if (JSON.stringify(splitLeaseTasks(150, [100, 110])) !== JSON.stringify([100, 50]) ||
          JSON.stringify(splitLeaseTasks(50, [100, 110])) !== JSON.stringify([50, 0]))
        throw new Error('screen tasks were counted twice across leases');
    """
    result = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=REPO,
                            capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"


def _age(file: Path, seconds: int = 11):
    old = time.time() - seconds
    os.utime(file, (old, old))


@_temporary_path
def test_jobs_that_exceed_pool_capacity_serialise(tmp_path):
    directory = tmp_path / "pool"
    first_acquired, first_release = tmp_path / "first.acquired", tmp_path / "first.release"
    second_acquired, second_release = tmp_path / "second.acquired", tmp_path / "second.release"
    first = _child(directory, "first", 700, acquired_file=first_acquired,
                   release_file=first_release)
    second = None
    try:
        _wait_file(first_acquired)
        second = _child(directory, "second", 700, acquired_file=second_acquired,
                        release_file=second_release)
        _wait_entries(directory, ".ticket")
        time.sleep(2)
        assert not second_acquired.exists(), "second job entered while the first lease was held"
        first_release.touch()
        _wait_file(second_acquired)
        second_release.touch()
        a, b = _finish(first), _finish(second)
        assert a["ticket"] < b["ticket"]
        assert b["acquired"] >= a["released"]
    finally:
        _stop(first, *(p for p in [second] if p))


@_temporary_path
def test_jobs_that_fit_pool_capacity_run_together(tmp_path):
    directory = tmp_path / "pool"
    first_acquired, first_release = tmp_path / "first.acquired", tmp_path / "first.release"
    second_acquired, second_release = tmp_path / "second.acquired", tmp_path / "second.release"
    first = _child(directory, "first", 400, acquired_file=first_acquired,
                   release_file=first_release)
    second = None
    try:
        _wait_file(first_acquired)
        second = _child(directory, "second", 400, acquired_file=second_acquired,
                        release_file=second_release)
        # The overlap is a condition, not a timestamp compare: the second lease is granted while the first is still
        # held (its release file does not exist yet, and its process is still waiting on it). Comparing Date.now()
        # across two processes flaked under load (equal milliseconds, WSL clock steps).
        _wait_file(second_acquired, timeout=10)
        assert first.poll() is None and not first_release.exists(), "the first lease ended before the second began"
        first_release.touch()
        second_release.touch()
        _finish(first), _finish(second)
    finally:
        _stop(first, *(p for p in [second] if p))


@_temporary_path
def test_core_cap_blocks_even_when_memory_fits(tmp_path):
    directory = tmp_path / "pool"
    first_acquired, first_release = tmp_path / "first.acquired", tmp_path / "first.release"
    second_acquired, second_release = tmp_path / "second.acquired", tmp_path / "second.release"
    first = _child(directory, "first", 400, cores=4, acquired_file=first_acquired,
                   release_file=first_release)
    second = None
    try:
        _wait_file(first_acquired)
        second = _child(directory, "second", 100, acquired_file=second_acquired,
                        release_file=second_release)
        _wait_entries(directory, ".ticket")
        time.sleep(2)
        assert not second_acquired.exists(), "job exceeded the core cap"
        first_release.touch()
        _wait_file(second_acquired)
        second_release.touch()
        a, b = _finish(first), _finish(second)
        assert b["acquired"] >= a["released"]
    finally:
        _stop(first, *(p for p in [second] if p))


@_temporary_path
def test_fifo_acquisition_follows_ticket_order(tmp_path):
    directory = tmp_path / "pool"
    holder_acquired, holder_release = tmp_path / "holder.acquired", tmp_path / "holder.release"
    earlier_acquired, earlier_release = tmp_path / "earlier.acquired", tmp_path / "earlier.release"
    later_acquired, later_release = tmp_path / "later.acquired", tmp_path / "later.release"
    holder = _child(directory, "holder", 900, cores=4,
                    acquired_file=holder_acquired, release_file=holder_release)
    earlier = later = None
    try:
        _wait_file(holder_acquired)
        earlier = _child(directory, "earlier", 900, cores=4,
                         acquired_file=earlier_acquired, release_file=earlier_release)
        _wait_entries(directory, ".ticket")
        later = _child(directory, "later", 900, cores=4,
                       acquired_file=later_acquired, release_file=later_release)
        _wait_entries(directory, ".ticket", 2)
        holder_release.touch()
        _wait_file(earlier_acquired)
        time.sleep(2)
        assert not later_acquired.exists(), "later ticket passed the earlier ticket"
        earlier_release.touch()
        _wait_file(later_acquired)
        later_release.touch()
        a, b, c = _finish(holder), _finish(earlier), _finish(later)
        assert a["ticket"] < b["ticket"] < c["ticket"]
        assert a["acquired"] < b["acquired"] < c["acquired"]
        assert b["acquired"] >= a["released"]
        assert c["acquired"] >= b["released"]
    finally:
        _stop(*(p for p in [holder, earlier, later] if p))


@_temporary_path
def test_reserve_blocks_until_memavailable_rises(tmp_path):
    directory = tmp_path / "pool"
    mem_file = tmp_path / "available"
    mem_file.write_text("450")
    proc = _child(directory, "reserve", 400, mem_file=mem_file)
    try:
        _wait_entries(directory, ".ticket")
        time.sleep(0.15)
        assert not list(directory.glob("*.lease")), "job entered below the reserve"
        mem_file.write_text("650")
        result = _finish(proc)
        assert result["acquired"] >= int(mem_file.stat().st_mtime_ns / 1_000_000)
    finally:
        _stop(proc)


@_temporary_path
def test_pending_declared_memory_blocks_over_admission(tmp_path):
    directory = tmp_path / "pool"
    first_acquired, first_release = tmp_path / "first.acquired", tmp_path / "first.release"
    second_acquired, second_release = tmp_path / "second.acquired", tmp_path / "second.release"
    first = _child(directory, "first", 700, pool_mb=2000, available=1000,
                   acquired_file=first_acquired, release_file=first_release)
    second = None
    try:
        _wait_file(first_acquired)
        second = _child(directory, "second", 500, pool_mb=2000, available=1000,
                        acquired_file=second_acquired, release_file=second_release)
        _wait_entries(directory, ".ticket")
        time.sleep(2)
        assert not second_acquired.exists(), "job exceeded the pending declared-memory budget"
        first_release.touch()
        _wait_file(second_acquired)
        second_release.touch()
        a, b = _finish(first), _finish(second)
        assert b["acquired"] >= a["released"]
    finally:
        _stop(first, *(p for p in [second] if p))


@_temporary_path
def test_dead_owner_lease_is_reclaimed(tmp_path):
    directory = tmp_path / "pool"
    abandoned = _child(directory, "abandoned", 900, cores=4, hold_ms=60000)
    successor = None
    try:
        _wait_entries(directory, ".lease")
        abandoned.kill()
        abandoned.wait(timeout=5)
        lease_file = next(directory.glob("*.lease"))
        record = json.loads(lease_file.read_text())
        record["heartbeat"] -= 11_000
        lease_file.write_text(json.dumps(record))
        successor = _child(directory, "successor", 900, cores=4)
        assert _finish(successor)["acquired"] > 0
    finally:
        _stop(*(p for p in [abandoned, successor] if p))


@_temporary_path
def test_two_waiters_reclaim_one_dead_mutex(tmp_path):
    directory = tmp_path / "pool"
    mutex = directory / ".mutex"
    mutex.mkdir(parents=True)
    owner = mutex / "owner"
    owner.write_text("99999999")
    _age(owner)
    first = _child(directory, "first", 600, hold_ms=300)
    second = _child(directory, "second", 600)
    try:
        a, b = _finish(first), _finish(second)
        ordered = sorted([a, b], key=lambda item: item["acquired"])
        assert ordered[1]["acquired"] >= ordered[0]["released"]
    finally:
        _stop(first, second)


@_temporary_path
def test_live_process_group_keeps_dead_owner_lease(tmp_path):
    directory = tmp_path / "pool"
    directory.mkdir()
    group = subprocess.Popen(["sleep", "10"], start_new_session=True)
    lease = directory / "000000000000001-99999999-old.lease"
    lease.write_text(json.dumps({"pid": 99999999, "pgid": group.pid, "mb": 900,
                                 "pss": 0, "cores": 4, "heartbeat": 0}))
    waiter = _child(directory, "waiter", 900, cores=4)
    try:
        _wait_entries(directory, ".ticket")
        time.sleep(0.15)
        assert lease.exists(), "live process group lost its lease"
        assert not any(p.name != lease.name for p in directory.glob("*.lease"))
        os.killpg(group.pid, 9)
        group.wait(timeout=5)
        assert _finish(waiter)["acquired"] > 0
    finally:
        _stop(waiter)
        if group.poll() is None:
            os.killpg(group.pid, 9)
            group.wait(timeout=5)


@_temporary_path
def test_corrupt_counter_uses_highest_ticket_and_lost_ticket_returns(tmp_path):
    directory = tmp_path / "pool"
    first = _child(directory, "first", 900, cores=4, hold_ms=350)
    second = None
    try:
        _wait_entries(directory, ".lease")
        (directory / "next-ticket").write_text("bad counter")
        second = _child(directory, "second", 900, cores=4)
        _wait_entries(directory, ".ticket")
        for ticket in directory.glob("*.ticket"):
            ticket.unlink()
        _wait_entries(directory, ".ticket")
        a, b = _finish(first), _finish(second)
        assert b["ticket"] > a["ticket"]
        assert b["acquired"] >= a["released"]
    finally:
        _stop(first, *(p for p in [second] if p))


@_temporary_path
def test_live_owner_is_not_reclaimed_by_old_heartbeat(tmp_path):
    directory = tmp_path / "pool"
    directory.mkdir()
    lease = directory / "000000000000001-live.lease"
    lease.write_text(json.dumps({"pid": os.getpid(), "mb": 900, "pss": 0,
                                 "cores": 4, "heartbeat": 0}))
    waiter = _child(directory, "waiter", 900, cores=4)
    try:
        _wait_entries(directory, ".ticket")
        time.sleep(0.15)
        assert lease.exists(), "a live owner lost its lease due to heartbeat age"
        lease.unlink()
        assert _finish(waiter)["acquired"] > 0
    finally:
        _stop(waiter)


@_temporary_path
def test_waiting_head_stops_bypass_after_window(tmp_path):
    directory = tmp_path / "pool"
    holder_acquired, holder_release = tmp_path / "holder.acquired", tmp_path / "holder.release"
    head_acquired, head_release = tmp_path / "head.acquired", tmp_path / "head.release"
    later_acquired, later_release = tmp_path / "later.acquired", tmp_path / "later.release"
    holder = _child(directory, "holder", 300, extra="bypassMs: 100",
                    acquired_file=holder_acquired, release_file=holder_release)
    head = later = None
    try:
        _wait_file(holder_acquired)
        head = _child(directory, "head", 900, extra="bypassMs: 100",
                      acquired_file=head_acquired, release_file=head_release)
        _wait_entries(directory, ".ticket")
        time.sleep(0.25)
        later = _child(directory, "later", 200, extra="bypassMs: 100",
                       acquired_file=later_acquired, release_file=later_release)
        _wait_entries(directory, ".ticket", 2)
        time.sleep(2)
        assert not later_acquired.exists(), "a later job bypassed the head after its window"
        holder_release.touch()
        _wait_file(head_acquired)
        head_release.touch()
        _wait_file(later_acquired)
        later_release.touch()
        a, b, c = _finish(holder), _finish(head), _finish(later)
        assert b["ticket"] < c["ticket"]
        assert c["acquired"] >= a["released"]
        assert b["acquired"] >= a["released"]
    finally:
        _stop(*(p for p in [holder, head, later] if p))


@_temporary_path
def test_waiting_head_allows_bypass_within_window(tmp_path):
    directory = tmp_path / "pool"
    holder_acquired, holder_release = tmp_path / "holder.acquired", tmp_path / "holder.release"
    head_acquired, head_release = tmp_path / "head.acquired", tmp_path / "head.release"
    later_acquired, later_release = tmp_path / "later.acquired", tmp_path / "later.release"
    # The bypass window opens bypassMs after the head queued and closes at twice that. The later run starts
    # as soon as the head's ticket exists, so it is already polling when the window opens. It used to start
    # after a fixed 1.6 s sleep, and under a full test:all a slow Node start missed a 1.5-3 s window (brx3,
    # 2026-10-17). 3000 ms gives a start-up 3 s of slack.
    holder = _child(directory, "holder", 300, extra="bypassMs: 3000",
                    acquired_file=holder_acquired, release_file=holder_release)
    head = later = None
    try:
        _wait_file(holder_acquired)
        head = _child(directory, "head", 900, extra="bypassMs: 3000",
                      acquired_file=head_acquired, release_file=head_release)
        _wait_entries(directory, ".ticket")
        later = _child(directory, "later", 200, extra="bypassMs: 3000",
                       acquired_file=later_acquired, release_file=later_release)
        _wait_file(later_acquired, timeout=10)   # the window opens 3 s after the head queued
        assert not head_acquired.exists(), "the head entered without enough capacity"
        later_release.touch()
        holder_release.touch()
        _wait_file(head_acquired)
        head_release.touch()
        a, b, c = _finish(holder), _finish(head), _finish(later)
        assert b["ticket"] < c["ticket"]
        assert c["acquired"] < a["released"]
        assert b["acquired"] >= a["released"]
    finally:
        _stop(*(p for p in [holder, head, later] if p))


@_temporary_path
def test_ownerless_mutex_is_reclaimed_after_grace(tmp_path):
    directory = tmp_path / "pool"
    mutex = directory / ".mutex"
    mutex.mkdir(parents=True)
    _age(mutex)
    child = _child(directory, "ownerless", 100)
    try:
        assert _finish(child)["acquired"] > 0
    finally:
        _stop(child)


@_temporary_path
def test_empty_owner_file_is_reclaimed_after_grace(tmp_path):
    directory = tmp_path / "pool"
    mutex = directory / ".mutex"
    mutex.mkdir(parents=True)
    owner = mutex / "owner"
    owner.write_text("")
    _age(owner)
    child = _child(directory, "empty-owner", 100)
    try:
        assert _finish(child)["acquired"] > 0
    finally:
        _stop(child)


@_temporary_path
def test_stale_reclaim_marker_is_removed(tmp_path):
    directory = tmp_path / "pool"
    mutex = directory / ".mutex"
    mutex.mkdir(parents=True)
    owner = mutex / "owner"
    owner.write_text("99999999")
    _age(owner)
    marker = mutex / ".reclaim"
    marker.write_text("99999998")
    _age(marker)
    child = _child(directory, "stale-marker", 100)
    try:
        assert _finish(child)["acquired"] > 0
    finally:
        _stop(child)


@_temporary_path
def test_empty_reclaim_marker_is_removed(tmp_path):
    directory = tmp_path / "pool"
    mutex = directory / ".mutex"
    mutex.mkdir(parents=True)
    owner = mutex / "owner"
    owner.write_text("99999999")
    _age(owner)
    marker = mutex / ".reclaim"
    marker.write_text("")
    _age(marker)
    child = _child(directory, "empty-marker", 100)
    try:
        assert _finish(child)["acquired"] > 0
    finally:
        _stop(child)


@_temporary_path
def test_dead_pid_ticket_and_lease_need_old_heartbeat(tmp_path):
    directory = tmp_path / "pool"
    directory.mkdir()
    ticket = directory / "000000000000001-99999999-dead.ticket"
    ticket.write_text(json.dumps({"pid": 99999999, "mb": 900, "cores": 4,
                                  "heartbeat": int(time.time() * 1000)}))
    lease = directory / "000000000000002-99999998-dead.lease"
    lease.write_text(json.dumps({"pid": 99999998, "mb": 900, "pss": 0, "cores": 4,
                                 "heartbeat": int(time.time() * 1000)}))
    acquired, release = tmp_path / "waiter.acquired", tmp_path / "waiter.release"
    waiter = _child(directory, "waiter", 900, cores=4, acquired_file=acquired,
                    release_file=release)
    try:
        _wait_entries(directory, ".ticket")
        time.sleep(0.2)
        assert ticket.exists(), "fresh dead-pid ticket was reclaimed"
        assert lease.exists(), "fresh dead-pid lease was reclaimed"
        assert not acquired.exists(), "waiter passed a fresh dead-pid lease"
        ticket_record = json.loads(ticket.read_text())
        ticket_record["heartbeat"] -= 11_000
        ticket.write_text(json.dumps(ticket_record))
        lease_record = json.loads(lease.read_text())
        lease_record["heartbeat"] -= 11_000
        lease.write_text(json.dumps(lease_record))
        _wait_file(acquired)
        release.touch()
        _finish(waiter)
    finally:
        _stop(waiter)


@_temporary_path
def test_a_zero_task_request_is_never_task_blocked(tmp_path):
    """A request that asks for no tasks must not wait on task headroom: with free tasks under the reserve, the
    available figure goes negative, and `0 > available` used to block every zero-task request (a pool test whose
    child read the LIVE cgroup flaked in a loaded gate, 2026-10-05). Before the fix this child times out."""
    directory = tmp_path / "pool"
    low = "taskHeadroom: () => ({ max: 4915, current: 4500, free: 415 }),"   # far under the 1500 reserve
    child = _child(directory, "zero-tasks", 100, extra=low)
    try:
        assert _finish(child)["acquired"] > 0
    finally:
        _stop(child)


def _outside_pool(tmp_path, free_expr: str, wait_ms: int) -> str:
    """A pool whose task headroom is outside load only (it holds no leases of its own)."""
    return f"""
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const logs = [];
      let current = {free_expr};
      const pool = createPool({{ dir: {json.dumps(str(tmp_path / 'pool'))}, poolMb: 1000, reserveMb: 0, poolCores: 4,
        readAvailableMb: () => 10000, pollMs: 10,
        taskHeadroom: () => ({{ max: 4915, current, free: 4915 - current }}), taskReserve: 1500,
        outsideWaitMs: {wait_ms}, outsideNoticeMs: 50, log: m => logs.push(m),
        topConsumers: () => [{{ comm: 'codex', tasks: 654, procs: 16 }}, {{ comm: 'chrome', tasks: 400, procs: 9 }}] }});
    """


@_temporary_path
def test_outside_load_makes_a_job_wait_visibly_then_admits(tmp_path):
    # 2026-10-05 (brx1): outside load (other sessions, agents, browsers) must make a job WAIT, not crash the run.
    script = _outside_pool(tmp_path, "3300", 60_000).replace(
        "log: m => logs.push(m),",
        "log: m => { logs.push(m); if (m.startsWith('waiting on outside load for site:')) current = 2000; },",
    ) + """
      const lease = await pool.acquire({ runId: 'one', job: 'site', mb: 100, cores: 1, tasks: 660 });
      if (!lease) throw new Error('not admitted');
      const notice = logs.find(m => m.startsWith('waiting on outside load for site: pids.current 3300 of 4915, reserve 1500, need 660'));
      if (!notice || !notice.includes('biggest: codex 654 (16 procs)')) throw new Error('no outside-load notice: ' + JSON.stringify(logs));
      lease.release(); pool.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_outside_load_that_never_clears_errors_at_the_cap_naming_the_consumers(tmp_path):
    script = _outside_pool(tmp_path, "3300", 300) + """
      try {
        await pool.acquire({ runId: 'one', job: 'site', mb: 100, cores: 1, tasks: 660 });
        throw new Error('admitted under outside load');
      } catch (e) {
        if (!/outside load kept the task headroom below 660 for 0 min: pids.current 3300 of 4915, reserve 1500, need 660; biggest: codex 654/.test(e.message))
          throw new Error('wrong error: ' + e.message);
      }
      pool.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_a_request_bigger_than_the_cap_less_the_reserve_errors_at_once(tmp_path):
    script = _outside_pool(tmp_path, "0", 60_000) + """
      const t0 = Date.now();
      try {
        await pool.acquire({ runId: 'one', job: 'huge', mb: 100, cores: 1, tasks: 4000 });
        throw new Error('admitted');
      } catch (e) {
        if (!/can never hold 4000 tasks/.test(e.message)) throw new Error('wrong error: ' + e.message);
        if (Date.now() - t0 > 2000) throw new Error('waited before failing a request that can never fit');
      }
      pool.close();
    """
    _run_pool_script(script)


def _prio_pools(tmp_path) -> str:
    return f"""
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const common = {{ dir: {json.dumps(str(tmp_path / 'pool'))}, poolMb: 1000, reserveMb: 0, poolCores: 8,
        readAvailableMb: () => 100000, taskHeadroom: () => null,
        pollMs: 10 }};
      const lander = createPool({{ ...common, priority: true }});
      const local = createPool({{ ...common, priority: false }});
    """


@_temporary_path
def test_a_local_run_leaves_a_landers_reserved_memory_free(tmp_path):
    # 2026-10-10: lanes' local --ui runs took the memory the lander's gate needed (app-screens fell to 2-5 shards and a
    # gate took 33 min). A lander gate reserves its planned peak; other runs admit only from what is left.
    script = _prio_pools(tmp_path) + """
      lander.reserve(700);
      if (local.tryAcquire({ runId: 'l', job: 'x', mb: 400, cores: 1 }) !== null) throw new Error('local took reserved memory');
      const big = lander.tryAcquire({ runId: 'g', job: 'screens', mb: 600, cores: 1 });
      if (!big) throw new Error('the lander could not use its own reservation');
      // 100 MB of the reservation is still unused: the local run may take only 1000 - 600 - 100 = 300.
      if (local.tryAcquire({ runId: 'l', job: 'x', mb: 301, cores: 1 }) !== null) throw new Error('local took the unused reservation');
      const ok = local.tryAcquire({ runId: 'l', job: 'x', mb: 300, cores: 1 });
      if (!ok) throw new Error('local could not use what the lander does not need');
      ok.release(); big.release(); lander.close(); local.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_a_lander_ticket_does_not_queue_behind_a_local_runs_ticket(tmp_path):
    script = _prio_pools(tmp_path) + """
      const held = await local.acquire({ runId: 'l', job: 'held', mb: 900, cores: 1 });
      const waiting = local.acquire({ runId: 'l', job: 'waits', mb: 500, cores: 1 });   // queued, cannot fit
      await new Promise(r => setTimeout(r, 100));
      const t0 = Date.now();
      const g = await Promise.race([lander.acquire({ runId: 'g', job: 'gate', mb: 100, cores: 1 }),
                                    new Promise(r => setTimeout(() => r(null), 3000))]);
      if (!g) throw new Error('the lander queued behind a local ticket');
      g.release(); held.release(); (await waiting).release(); lander.close(); local.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_a_lander_late_lease_is_not_blocked_by_a_waiting_local_ticket(tmp_path):
    # Codex review: tryAcquire (the app-screens shard raise) refused while ANY ticket waited, so a local ticket held
    # back by the lander's own reservation also blocked the lander's late lease.
    script = _prio_pools(tmp_path) + """
      lander.reserve(600);
      const waiting = local.acquire({ runId: 'l', job: 'waits', mb: 500, cores: 1 });   // held back by the reservation
      await new Promise(r => setTimeout(r, 100));
      const extra = lander.tryAcquire({ runId: 'g', job: 'screens-extra', mb: 300, cores: 1 });
      if (!extra) throw new Error('the lander late lease was blocked by a local ticket');
      extra.release(); lander.close();
      (await waiting).release(); local.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_a_local_ticket_that_waited_past_fair_ms_stops_yielding(tmp_path):
    # Codex review: back-to-back lander reservations could starve a local run for ever.
    script = _prio_pools(tmp_path).replace("priority: false });", "priority: false, fairMs: 300 });") + """
      if (!local) throw new Error('the fairMs override did not apply');
      lander.reserve(900);
      const t0 = Date.now();
      const l = await Promise.race([local.acquire({ runId: 'l', job: 'x', mb: 500, cores: 1 }),
                                    new Promise(r => setTimeout(() => r(null), 3000))]);
      if (!l) throw new Error('the local run was starved by the reservation');
      if (Date.now() - t0 < 250) throw new Error('it did not yield to the reservation first');
      l.release(); lander.close(); local.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_a_pool_never_takes_priority_from_the_environment(tmp_path):
    # Codex review: BRX_LAND_GATE is inherited by every job, so a test-all started by a test inside a lander gate
    # would also have reserved memory. Priority is only ever passed in by test-all, from BRX_LAND_PRIORITY it removes.
    script = f"""
      process.env.BRX_LAND_GATE = 'x'; process.env.BRX_LAND_PRIORITY = '1';
      const fs = await import('node:fs');
      const {{ createPool }} = await import({json.dumps(POOL_MOD.as_uri())});
      const dir = {json.dumps(str(tmp_path / 'pool'))};
      const p = createPool({{ dir, taskHeadroom: () => null }});
      p.reserve(500);
      if (fs.readdirSync(dir).some(f => f.endsWith('.reserve'))) throw new Error('a pool took priority from the environment');
      p.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_a_lowered_reservation_frees_memory_for_local_runs(tmp_path):
    # Opus review: the reservation stayed at the full plan for the whole gate; test-all now lowers it as the gate drains.
    script = _prio_pools(tmp_path) + """
      const r = lander.reserve(900);
      if (local.tryAcquire({ runId: 'l', job: 'x', mb: 500, cores: 1 }) !== null) throw new Error('reservation not honoured');
      r.update(0);
      const ok = local.tryAcquire({ runId: 'l', job: 'x', mb: 500, cores: 1 });
      if (!ok) throw new Error('a dropped reservation still held memory');
      ok.release(); lander.close(); local.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_a_local_ticket_never_bypasses_a_waiting_priority_ticket(tmp_path):
    # Opus review: a local ticket judged a priority head by its own (reduced) fit and could bypass it after bypassMs.
    script = f"""
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const common = {{ dir: {json.dumps(str(tmp_path / 'pool'))}, poolMb: 1000, reserveMb: 0, poolCores: 8,
        readAvailableMb: () => 100000, taskHeadroom: () => null,
        pollMs: 10, bypassMs: 300 }};
      const lander = createPool({{ ...common, priority: true }});
      const local = createPool({{ ...common, priority: false }});
      const held = await local.acquire({{ runId: 'l', job: 'held', mb: 700, cores: 1 }});
      const head = lander.acquire({{ runId: 'g', job: 'gate', mb: 600, cores: 1 }});   // waits: only 300 free
      await new Promise(r => setTimeout(r, 100));
      const sneak = await Promise.race([local.acquire({{ runId: 'l', job: 'sneak', mb: 200, cores: 1 }}),
                                        new Promise(r => setTimeout(() => r(null), 1500))]);
      if (sneak) throw new Error('a local ticket bypassed the waiting priority head');
      held.release();
      (await head).release(); lander.close(); local.close();
    """
    _run_pool_script(script)


def test_darwin_memory_counts_inactive_and_speculative_pages():
    # F565: on macOS os.freemem() counts only free pages (206 MB on a MacBook whose vm_stat showed about 1.5 GB
    # inactive), so every job queued for ever. The Darwin branch reads vm_stat instead.
    script = f"""
      import {{ memAvailableMb, darwinAvailableMb }} from {json.dumps(POOL_MOD.as_uri())};
      const vmStat = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               13184.
Pages active:                            301213.
Pages inactive:                           96000.
Pages speculative:                         3200.
Pages wired down:                         98000.
`;
      const mb = darwinAvailableMb(vmStat);
      if (mb !== (13184 + 96000 + 3200) * 16384 / 1048576) throw new Error('wrong sum: ' + mb);
      if (darwinAvailableMb('no header here') !== null) throw new Error('a bad vm_stat must read as unknown');
      const read = memAvailableMb({{ platform: 'darwin', readMeminfo: () => {{ throw new Error('ENOENT'); }},
        readVmStat: () => vmStat }});
      if (read !== mb) throw new Error('darwin did not use vm_stat: ' + read);
      const fallback = memAvailableMb({{ platform: 'darwin', readMeminfo: () => {{ throw new Error('ENOENT'); }},
        readVmStat: () => {{ throw new Error('no vm_stat'); }} }});
      if (!(fallback > 0)) throw new Error('no fallback when vm_stat fails');
    """
    _run_pool_script(script)


@_temporary_path
def test_an_empty_pool_admits_one_job_when_memory_reads_too_low(tmp_path):
    # F565: with no starvation escape a run on a machine that under-reads its memory waited for ever, heartbeat alive.
    # The timed floor (macOS): the head of the queue, alone in an empty pool, is admitted after floorMs, and from then
    # on each empty-pool head at once.
    script = f"""
      import fs from 'node:fs';
      import path from 'node:path';
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const dir = {json.dumps(str(tmp_path / 'pool'))};
      const logs = [];
      const pool = createPool({{ dir, poolMb: 1000, reserveMb: 100, poolCores: 4, readAvailableMb: () => 50,
        taskHeadroom: () => null, pollMs: 10, floorMs: 300, memoryFloor: true, log: m => logs.push(m) }});
      const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
      // An older ticket from another run is ahead: the floor waits behind it.
      const other = path.join(dir, '000000000000001-1-waiter.ticket');
      fs.mkdirSync(dir, {{ recursive: true }});
      fs.writeFileSync(other, JSON.stringify({{ pid: process.pid, mb: 600, cores: 1, heartbeat: Date.now(), queuedAt: Date.now() }}));
      const queued = pool.acquire({{ runId: 'r', job: 'big', mb: 600, cores: 1 }});
      if (await within(queued, 600)) throw new Error('the floor admitted a job behind an older ticket');
      fs.rmSync(other);
      const started = Date.now();
      const lease = await within(queued, 3000);
      if (!lease) throw new Error('an empty pool never admitted the head job');
      if (Date.now() - started < 250) throw new Error('the floor admitted before floorMs');
      if (!logs.some(m => /alone/.test(m))) throw new Error('the floor admission was silent: ' + logs);
      // The floor is for an EMPTY pool only: a second job waits while the first holds its lease.
      const second = pool.acquire({{ runId: 'r', job: 'second', mb: 100, cores: 1 }});
      if (await within(second, 600)) throw new Error('the floor admitted a job beside a live lease');
      const freed = Date.now();
      lease.release();
      const next = await within(second, 3000);
      if (!next) throw new Error('the next job never ran');
      // Once the floor has opened, the next empty-pool head goes at once, not after another floorMs (Opus review).
      if (Date.now() - freed >= 250) throw new Error('every job waited the floor again');
      next.release();
      pool.close();
    """
    _run_pool_script(script)


@_temporary_path
def test_the_mac_floor_spends_the_reserve_at_once_and_linux_never_does(tmp_path):
    # F565, Opus review: on macOS an empty-pool head whose job fits the reading itself goes at once (it spends the
    # reserve, not memory the reading lacks). Linux keeps the hard limit: test_reserve_blocks_until_memavailable_rises.
    script = f"""
      import {{ createPool }} from {json.dumps(POOL_MOD.as_uri())};
      const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
      for (const memoryFloor of [true, false]) {{
        const pool = createPool({{ dir: {json.dumps(str(tmp_path))} + '/pool-' + memoryFloor, poolMb: 1000,
          reserveMb: 300, poolCores: 4, readAvailableMb: () => 700, taskHeadroom: () => null, pollMs: 10,
          floorMs: 60000, memoryFloor, log: () => {{}} }});
        const lease = await within(pool.acquire({{ runId: 'r', job: 'big', mb: 600, cores: 1 }}), 1000);
        if (memoryFloor && !lease) throw new Error('the mac floor did not spend the reserve');
        if (!memoryFloor && lease) throw new Error('Linux admitted into the reserve');
        lease?.release();
        pool.close();
      }}
    """
    _run_pool_script(script)
