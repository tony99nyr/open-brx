// app-screens' elastic shards (A10, the test-all split, stage 3; moved out of scripts/test-all.mjs). Once every queued job
// has started, newly freed memory goes to more app-screens shards. The handshake with app/tools/screens.mjs is two files:
//   - `want` (SCREENS_WANT_FILE): the runner writes the shard target; screens.mjs creates it when it is ready to grow,
//     and rereads it whenever a shard ends.
//   - `ack` (SCREENS_ACK_FILE): screens.mjs writes the shards it has started, or `closed` when it will start no more.
// Each raise holds an extra pool lease for its shards. Everything outside (the pool, the memory tally, the clock, the
// log) is passed in, so test_test_all_split.py drives the whole cycle with a fake pool.
import fs from 'node:fs';
import { SCREENS_SHARD_MB, TASK_ALLOWANCES } from './budget.mjs';
import { extraShardsToKeep, screensRaise } from './scheduler.mjs';

/** `job` is the app-screens job (its env names the files, `screensCap` caps the shards). `tally` is the run's memory
 *  tally: `used()` and `add(mb)` (negative to free). `queued()` is the number of jobs not yet started, `stopping()` the
 *  run's stop flag. `tryAcquire(request)` is the pool's (a lease or null). */
export function createScreensRaise({ job, runId, ceilingMb, tally, queued, stopping, tryAcquire,
  now = () => Date.now(), log = message => console.log(message), logError = message => console.error(message) }) {
  const wantFile = job.env.SCREENS_WANT_FILE, ackFile = job.env.SCREENS_ACK_FILE;
  fs.rmSync(ackFile, { force: true });
  fs.rmSync(wantFile, { force: true });
  let running = false, ending = false, closed = false;
  let shards = 0, baseShards = 0, target = 0, pgid = null;
  let lastRaise = 0, belowTargetTicks = 0;
  const extraLeases = [];

  const writeWant = n => {
    const temp = `${wantFile}.${process.pid}`;
    fs.writeFileSync(temp, String(n));
    fs.renameSync(temp, wantFile);
  };
  const dropLease = lease => {
    const i = extraLeases.indexOf(lease);
    if (i < 0) return;
    extraLeases.splice(i, 1);
    tally.add(-lease.mb);
  };
  /** Releases the extra leases beyond the shards screens.mjs applied over its admitted count. */
  function releaseSurplus() {
    const keep = extraShardsToKeep(shards, baseShards);
    while (extraLeases.length && extraLeases.reduce((sum, lease) => sum + lease.shards, 0) > keep) {
      const lease = extraLeases[extraLeases.length - 1];
      lease.release(); dropLease(lease);
    }
  }

  /** One tick (every 500 ms, and after the scheduler starts jobs). */
  function tick() {
    if (!running || ending || stopping() || closed) return;
    if (now() - lastRaise < 500) return;
    let extraLease = null;
    try {
      if (fs.existsSync(ackFile)) {
        let ack;
        try { ack = fs.readFileSync(ackFile, 'utf8').trim(); } catch { ack = ''; }
        if (ack === 'closed') { closed = true; releaseSurplus(); return; }
        const applied = Number(ack);
        if (Number.isInteger(applied) && applied > shards && applied <= target) {
          const added = applied - shards;
          shards = applied;
          belowTargetTicks = 0;
          releaseSurplus();
          lastRaise = 0;
          log(`test-all: app-screens applied ${applied} shards (${added} added)`);
        } else if (target > shards && ++belowTargetTicks >= 10) {
          // Give the raise up: lower `want` first, so screens.mjs cannot start the shards whose leases go next.
          writeWant(shards);
          target = shards; belowTargetTicks = 0;   // a retry gets the full ten ticks again
          releaseSurplus();
        }
      }
      // Only spend newly freed memory after every queued job has started, and only when screens.mjs is ready.
      if (queued() || target > shards || !fs.existsSync(wantFile)) return;
      const more = Math.min(job.screensCap - shards, Math.floor((ceilingMb - tally.used()) / SCREENS_SHARD_MB));
      if (more <= 0) return;
      let admitted = 0;
      lastRaise = now();
      extraLease = tryAcquire({ runId, job: 'app-screens-extra', mb: SCREENS_SHARD_MB, cores: 1,
        tasks: TASK_ALLOWANCES.screensShard,
        size: free => { const raise = screensRaise(more, free); admitted = raise.admitted; return raise.request; } });
      if (!extraLease) { lastRaise = now() + 1500; return; }
      extraLease.setPgid(pgid);
      extraLease.shards = admitted;
      extraLeases.push(extraLease);
      tally.add(extraLease.mb);
      target = shards + admitted;
      writeWant(target);
      log(`test-all: app-screens requested ${target} shards`);
    } catch (error) {
      logError(`test-all: app-screens shard raise stopped: ${error.message}`);
      closed = true;
      if (extraLease) { extraLease.release(); dropLease(extraLease); }
    }
  }

  return {
    tick,
    /** The job was admitted at `admittedShards` and is about to start. */
    start(admittedShards) { running = true; shards = target = baseShards = admittedShards; },
    /** The job's process group (its extra leases are measured against it). */
    setPgid(pid) { pgid = pid; },
    /** The job's process exited: no more raises. */
    end() { ending = true; },
    /** The job is done: print the acknowledgement and release every extra lease. */
    finish() {
      const acknowledged = fs.existsSync(ackFile) ? Number(fs.readFileSync(ackFile, 'utf8')) : null;
      log(`test-all: app-screens shard acknowledgement: ${Number.isInteger(acknowledged) ? acknowledged : 'not applied'}`);
      running = false;
      for (const lease of [...extraLeases]) { lease.release(); dropLease(lease); }
    },
    get pgid() { return pgid; },
    get extraLeases() { return extraLeases; },
    get state() { return { running, ending, closed, shards, baseShards, target }; },
  };
}
