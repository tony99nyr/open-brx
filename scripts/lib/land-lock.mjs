// The lander lock (A11, the land.mjs split, stage 2). Entries are named like test-all's (`<start ms>-<pid>-<rand>`) and
// share scripts/lib/lock.mjs's stale rules: a dead pid is reclaimed after 10 s, a live but silent one after 60 s without
// a heartbeat. The first LIVE entry by name holds the lock. Unlike test-all, a lander never queues: if another lander
// holds the lock, the queue is already being served. One difference: this compares an entry's mtime with the wall
// clock, because a one-shot check (from `wait` or `status`) has no earlier sighting to measure a monotonic idle time from.
import fs from 'node:fs';
import path from 'node:path';
import { entryPid, isStale } from './lock.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The lock at `dir`. `onRelease()` runs on release before this lander's entry goes (land.mjs removes its scratch
 *  worktree there), so no other lander can take the lock while that worktree still exists. */
export function createLanderLock(dir, { onRelease = () => {}, heartbeatMs = 5000 } = {}) {
  let mine = null;
  let beat = null;

  function liveEntries(reap) {
    let names = [];
    try { names = fs.readdirSync(dir).sort(); } catch { return []; }
    const now = Date.now(), live = [];
    for (const name of names) {
      if (name === mine) { live.push(name); continue; }
      let mtime;
      try { mtime = fs.statSync(path.join(dir, name)).mtimeMs; } catch { continue; }
      if (isStale(name, mtime, now)) { if (reap) fs.rmSync(path.join(dir, name), { force: true }); continue; }
      live.push(name);
    }
    return live;
  }
  function holder() {
    const first = liveEntries(false)[0];
    return first ? { pid: entryPid(first), since: new Date(Number(first.split('-')[0])).toISOString() } : null;
  }
  /** Synchronous: land.mjs also calls it from its 'exit' handler. */
  function release() {
    if (beat) clearInterval(beat);
    beat = null;
    try { onRelease(); }
    finally {   // a throwing onRelease must not leave this entry holding the lock
      if (mine) fs.rmSync(path.join(dir, mine), { force: true });
      mine = null;
    }
  }
  /** Take the lock if it is free or stale. False if a live lander holds it. Two landers that start together: each
   *  checks twice, half a second apart, that it is first, so an entry named earlier but written later is seen. */
  async function acquire() {
    fs.mkdirSync(dir, { recursive: true });
    if (liveEntries(true).length) return false;
    mine = `${String(Date.now()).padStart(15, '0')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(path.join(dir, mine), '');
    for (let i = 0; i < 2; i++) {
      await sleep(500);
      if (liveEntries(true)[0] !== mine) { release(); return false; }
    }
    beat = setInterval(() => { try { const t = new Date(); fs.utimesSync(path.join(dir, mine), t, t); } catch { /* gone */ } }, heartbeatMs);
    return true;
  }
  const stillHolder = () => mine !== null && liveEntries(false)[0] === mine;

  return { acquire, release, holder, liveEntries, stillHolder, get entry() { return mine; } };
}
