"""Cross-process tests for the shared test lease pool."""
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from _skip import needs

REPO = Path(__file__).resolve().parents[2]
POOL_MOD = REPO / "scripts" / "lib" / "pool.mjs"
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
        readAvailableMb: () => {source}, {extra}
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
    out, err = proc.communicate(timeout=5)
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
      import {{ extraLeaseCores, extraLeasePss }} from {json.dumps(POOL_MOD.as_uri())};
      if (extraLeaseCores(3, 2) !== 2 || extraLeaseCores(2, 4) !== 2)
        throw new Error('extra lease core sizing does not match admitted shards');
      const pss = extraLeasePss(900, 700, 2);
      if (pss.length !== 2 || pss.reduce((a, b) => a + b, 0) !== 200)
        throw new Error('extra leases do not account for group PSS above the base lease');
      if (extraLeasePss(600, 700, 2).some(value => value !== 0))
        throw new Error('extra lease PSS must be zero below the base lease estimate');
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
        _wait_file(second_acquired)
        first_release.touch()
        second_release.touch()
        a, b = _finish(first), _finish(second)
        assert max(a["acquired"], b["acquired"]) < min(a["released"], b["released"])
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
    holder = _child(directory, "holder", 300, extra="bypassMs: 1500",
                    acquired_file=holder_acquired, release_file=holder_release)
    head = later = None
    try:
        _wait_file(holder_acquired)
        head = _child(directory, "head", 900, extra="bypassMs: 1500",
                      acquired_file=head_acquired, release_file=head_release)
        _wait_entries(directory, ".ticket")
        time.sleep(1.6)
        later = _child(directory, "later", 200, extra="bypassMs: 1500",
                       acquired_file=later_acquired, release_file=later_release)
        _wait_file(later_acquired)
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
