import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pidAlive } from './lock.mjs';
import { taskHeadroom as systemTaskHeadroom, topTaskConsumers as systemTopConsumers } from './tasks.mjs';
import { TASK_RESERVE, taskBlocked } from './budget.mjs';

export const poolDirName = (uid = os.userInfo().uid) => path.join('/tmp', `brx-test-pool-${uid}`);

export function extraLeaseCores(admitted, freeCores) {
  return Math.max(0, Math.min(Math.floor(admitted), Math.floor(freeCores)));
}

export function extraLeasePss(groupPss, baseMb, count) {
  const total = Math.max(0, groupPss - baseMb);
  return Array(count).fill(total / count);
}

export function splitLeaseTasks(groupTasks, allowances) {
  let remaining = Math.max(0, groupTasks);
  return allowances.map(allowance => {
    const observed = Math.min(remaining, allowance);
    remaining -= observed;
    return observed;
  });
}

/** Free, inactive and speculative pages from `vm_stat`, in MB, or null when the text does not parse. */
export function darwinAvailableMb(vmStat) {
  const page = Number(/page size of (\d+) bytes/.exec(vmStat)?.[1]);
  const pages = ['free', 'inactive', 'speculative'].map(name => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, 'm').exec(vmStat)?.[1]));
  if (!(page > 0) || pages.some(count => !Number.isFinite(count))) return null;
  return pages.reduce((sum, count) => sum + count, 0) * page / 1048576;
}

// macOS has no /proc/meminfo, and there os.freemem() counts only free pages: 206 MB on a MacBook whose vm_stat showed
// about 1.5 GB inactive, so every job queued for ever (F565). The Darwin branch counts inactive and speculative pages
// too. Inactive pages can hold anonymous memory that macOS must compress or swap to reclaim, so the reading can run
// high; the pool's reserve covers that.
const readVmStatOnce = () => execFileSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
// Every waiting ticket reads memory each poll, inside the pool mutex: one vm_stat a second is enough (Opus review).
let vmStatCache = { at: 0, text: '' };
const readVmStatCached = () => {
  if (Date.now() - vmStatCache.at >= 1000) vmStatCache = { at: Date.now(), text: readVmStatOnce() };
  return vmStatCache.text;
};
export function memAvailableMb({ platform = process.platform,
  readMeminfo = () => fs.readFileSync('/proc/meminfo', 'utf8'),
  readVmStat = readVmStatCached } = {}) {
  try {
    const match = /^MemAvailable:\s+(\d+)/m.exec(readMeminfo());
    if (match) return Number(match[1]) / 1024;
  } catch { /* macOS */ }
  if (platform === 'darwin') {
    try {
      const mb = darwinAvailableMb(readVmStat());
      if (mb !== null) return mb;
    } catch { /* no vm_stat: fall back */ }
  }
  return os.freemem() / 1048576;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pause = new Int32Array(new SharedArrayBuffer(4));
const groupAlive = pgid => {
  if (!Number.isInteger(pgid) || pgid <= 0) return false;
  try { process.kill(-pgid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
};
const writeJson = (file, value) => {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
};
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const positive = (value, fallback) => value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const nonnegative = (value, fallback) => value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;

export function createPool({ dir = poolDirName(), poolMb = positive(process.env.BRX_TEST_POOL_MB, 10000),
  reserveMb = nonnegative(process.env.BRX_TEST_POOL_RESERVE_MB, 3000),
  poolCores = positive(process.env.BRX_TEST_POOL_CORES, 24), readAvailableMb = memAvailableMb,
  taskHeadroom = systemTaskHeadroom, taskReserve = TASK_RESERVE,
  pollMs = 200, heartbeatMs = 2_000, staleMs = 300_000, bypassMs = 60_000,
  outsideWaitMs = 60 * 60_000, outsideNoticeMs = 60_000,
  topConsumers = systemTopConsumers,
  // A lander gate has priority (test-all passes it; it never comes from the environment here, so a nested run cannot
  // inherit it): its tickets do not queue behind other runs', and it reserves its planned peak, which other runs leave
  // free, so local gates slow down instead of the lander, whose throughput every lane waits on (2026-10-10). A local
  // ticket that has waited `fairMs` stops yielding to reservations, so back-to-back gates cannot starve it.
  priority = false, fairMs = 20 * 60_000,
  // The floor (F565), on macOS only. The head of the queue, alone in an EMPTY pool with no live lander reservation,
  // and blocked only by the memory reading, may spend the reserve: it is admitted at once when the reading itself
  // holds it. When the reading is still too low, it is admitted after `floorMs` even so, and from then on this pool
  // admits each empty-pool head at once: a run goes one job at a time instead of not at all. Linux keeps the hard
  // limit, because there MemAvailable is exact and the outside load it sees is real (Opus review).
  floorMs = 60_000, memoryFloor = process.platform === 'darwin',
  log = message => console.error(`test-all: ${message}`) } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const mutex = path.join(dir, '.mutex');
  const ownTickets = new Map();
  const ownLeases = new Map();
  const ownReserves = new Map();
  let closed = false;
  let floorOpen = false;

  function withMutex(fn) {
    const deadline = Date.now() + 60_000;
    while (true) {
      let candidate;
      try {
        candidate = fs.mkdtempSync(`${mutex}.${process.pid}.`);
        fs.writeFileSync(path.join(candidate, 'owner'), String(process.pid));
        // Every new mutex is nonempty before rename, so another rename cannot replace it.
        if (fs.existsSync(mutex)) { const error = new Error('pool mutex exists'); error.code = 'EEXIST'; throw error; }
        fs.renameSync(candidate, mutex);
        candidate = null;
        break;
      }
      catch (error) {
        if (candidate) fs.rmSync(candidate, { recursive: true, force: true });
        if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
        try {
          const ownerFile = path.join(mutex, 'owner');
          let owner = null;
          let ownerless = false;
          let ownerText = null;
          try {
            ownerText = fs.readFileSync(ownerFile, 'utf8');
            owner = Number(ownerText);
            ownerless = !ownerText.trim() || !Number.isInteger(owner) || owner <= 0;
          }
          catch (readError) { if (readError.code === 'ENOENT') ownerless = true; else throw readError; }
          const aged = file => Date.now() - fs.statSync(file).mtimeMs > 10_000;
          const stale = ownerless ? aged(ownerText === null ? mutex : ownerFile)
            : Number.isInteger(owner) && owner > 0 && !pidAlive(owner) && aged(ownerFile);
          if (stale) {
            const marker = path.join(mutex, '.reclaim');
            for (let attempt = 0; attempt < 2; attempt++) try {
              const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
              fs.writeFileSync(marker, token, { flag: 'wx' });
              let renamed = false;
              try {
                // Writing the marker changes an ownerless directory's mtime.
                const sameOwner = ownerless ? (ownerText === null ? !fs.existsSync(ownerFile)
                  : fs.readFileSync(ownerFile, 'utf8') === ownerText)
                  : Number(fs.readFileSync(ownerFile, 'utf8')) === owner && !pidAlive(owner) && aged(ownerFile);
                if (sameOwner && fs.readFileSync(marker, 'utf8') === token) {
                  const discarded = `${mutex}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
                  fs.renameSync(mutex, discarded);
                  renamed = true;
                  fs.rmSync(discarded, { recursive: true, force: true });
                }
              } finally {
                if (!renamed) {
                  try {
                    if (fs.readFileSync(marker, 'utf8') === token) fs.rmSync(marker, { force: true });
                  } catch (markerError) { if (markerError.code !== 'ENOENT') throw markerError; }
                }
              }
              break;
            } catch (reclaimError) {
              if (reclaimError.code === 'EEXIST') {
                try {
                  const contents = fs.readFileSync(marker, 'utf8');
                  const breaker = Number(/^\d+/.exec(contents)?.[0]);
                  if (Date.now() - fs.statSync(marker).mtimeMs > 10_000 &&
                      (!contents.trim() || !Number.isInteger(breaker) || breaker <= 0 || !pidAlive(breaker))) {
                    fs.rmSync(marker, { force: true });
                    continue;
                  }
                } catch (markerError) {
                  if (markerError.code === 'ENOENT') continue;
                  try {
                    if (aged(marker)) { fs.rmSync(marker, { force: true }); continue; }
                  }
                  catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
                }
              } else if (reclaimError.code !== 'ENOENT') throw reclaimError;
              break;
            }
          }
        } catch (readError) {
          if (readError.code !== 'ENOENT') throw readError;
        }
        if (Date.now() >= deadline) throw new Error(`test pool mutex timed out after 60 s: ${mutex}`);
        Atomics.wait(pause, 0, 0, 35);
      }
    }
    try { return fn(); }
    finally { releaseMutex(); }
  }
  // Release in ONE step: rename our own, still non-empty mutex away, then delete the copy. Deleting `owner` and then
  // the directory left it EMPTY in between, and Linux lets a stalled waiter's rename land on an empty directory, so
  // the rmdir then failed ENOTEMPTY and closed this run's pool (2026-10-04). A rename cannot replace a non-empty
  // directory, so a waiter now always sees either our full mutex or none.
  function releaseMutex() {
    const discarded = `${mutex}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.released.tmp`;   // .tmp: the stale pruner removes a copy a crash left
    try { fs.renameSync(mutex, discarded); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    fs.rmSync(discarded, { recursive: true, force: true });
  }

  function entries(kind) {
    const files = fs.readdirSync(dir).filter(name => name.endsWith(`.${kind}`)).sort();
    const live = [];
    for (const name of files) {
      const file = path.join(dir, name);
      const data = readJson(file);
      if (!data || !Number.isInteger(data.pid) || data.pid <= 0) {
        try { if (Date.now() - fs.statSync(file).mtimeMs > staleMs) fs.rmSync(file, { force: true }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      } else if (!pidAlive(data.pid) && Date.now() - data.heartbeat > 10_000 &&
                 !(kind === 'lease' && groupAlive(data.pgid))) {
        fs.rmSync(file, { force: true });
      } else live.push({ name, file, data });
    }
    return live;
  }

  const heartbeat = setInterval(() => {
    for (const [file, data] of [...ownTickets, ...ownLeases, ...ownReserves]) {
      try {
        if (ownLeases.has(file) && data.released && !groupAlive(data.pgid)) {
          ownLeases.delete(file);
          fs.rmSync(file, { force: true });
          continue;
        }
        data.heartbeat = Date.now();
        writeJson(file, data);
      } catch { /* retry on the next heartbeat */ }
    }
  }, heartbeatMs);
  heartbeat.unref();

  function releaseFile(file) {
    ownTickets.delete(file);
    const lease = ownLeases.get(file);
    if (lease?.pgid && groupAlive(lease.pgid)) { lease.released = true; return; }
    ownLeases.delete(file);
    try { fs.rmSync(file, { force: true }); } catch { /* already gone */ }
  }

  function taskCapacity(leases) {
    const headroom = taskHeadroom();
    if (!headroom) return null;
    const pending = leases.reduce((sum, item) => sum +
      Math.max(0, (item.data.tasks || 0) - (item.data.observedTasks || 0)), 0);
    return { free: headroom.free, available: headroom.free - taskReserve - pending,
      max: headroom.max, current: headroom.current, pending };
  }

  function validRequest(request, job) {
    if (!request || !Number.isFinite(request.mb) || !Number.isFinite(request.cores) ||
        !Number.isFinite(request.tasks) || request.mb <= 0 || request.cores <= 0 || request.tasks < 0)
      throw new Error(`invalid pool request for ${job}`);
  }

  // Late work must not queue behind a job that already holds memory while waiting for more.
  // Give existing tickets priority and make the capacity check and lease write atomic.
  /** The memory a non-priority run must leave free: each live lander reservation less what that lander already
   *  leases. A priority run itself owes nothing. */
  function reservedForPriority(leases) {
    if (priority) return 0;
    let owed = 0;
    for (const r of entries('reserve')) {
      const leased = leases.filter(l => l.data.priority && l.data.pid === r.data.pid).reduce((s, l) => s + l.data.mb, 0);
      owed += Math.max(0, (r.data.mb || 0) - leased);
    }
    return owed;
  }
  /** A priority run announces the memory its plan needs (test-all's planned peak). Heartbeated; removed on close. */
  function reserve(mb) {
    const none = { update() {} };
    if (!priority) return none;
    const file = path.join(dir, `${process.pid}-${crypto.randomBytes(6).toString('hex')}.reserve`);
    const record = { pid: process.pid, mb: Math.max(0, Math.round(mb || 0)), heartbeat: Date.now() };
    writeJson(file, record);
    ownReserves.set(file, record);
    // Shrink (or grow) it as the plan changes: a gate whose queue has drained owes local runs nothing (Opus review).
    return { update(next) { record.mb = Math.max(0, Math.round(next || 0)); record.heartbeat = Date.now(); try { writeJson(file, record); } catch { /* the heartbeat retries */ } } };
  }

  function tryAcquire({ runId, job, mb, cores = 1, tasks = 0, size } = {}) {
    if (closed) return null;
    return withMutex(() => {
      if (entries('ticket').some(item => !priority || item.data.priority)) return null;   // a priority run ignores local tickets
      const leases = entries('lease');
      const usedMb = leases.reduce((sum, item) => sum + item.data.mb, 0);
      const usedCores = leases.reduce((sum, item) => sum + item.data.cores, 0);
      const owedMb = reservedForPriority(leases);
      const freeMb = Math.max(0, poolMb - usedMb - owedMb);
      const freeCores = Math.max(0, poolCores - usedCores);
      const unused = leases.reduce((sum, item) => sum + Math.max(0, item.data.mb - (item.data.pss || 0)), 0);
      const availableMb = Math.max(0, readAvailableMb() - reserveMb - unused - owedMb);
      const taskCap = taskCapacity(leases);
      const request = { tasks, ...(size ? size({ freeMb: Math.min(freeMb, availableMb), freeCores,
        freeTasks: taskCap?.available ?? Infinity, usedMb, usedCores }) : { mb, cores }) };
      validRequest(request, job);
      if (request.mb > freeMb || request.mb > availableMb || request.cores > freeCores) return null;
      if (taskBlocked(request.tasks, taskCap)) return null;
      const id = `extra-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
      const file = path.join(dir, `${id}.lease`);
      const record = { pid: process.pid, runId, job, mb: request.mb, cores: request.cores,
        tasks: request.tasks, observedTasks: 0, admittedAt: Date.now(), pss: 0, priority,
        pgid: null, heartbeat: Date.now() };
      writeJson(file, record);
      ownLeases.set(file, record);
      const update = values => { Object.assign(record, values); record.heartbeat = Date.now(); writeJson(file, record); };
      return { ...record, file, setPgid: pgid => update({ pgid }), setPss: pss => update({ pss }),
        setTasks: observedTasks => update({ observedTasks }),
        release: () => releaseFile(file) };
    });
  }

  async function acquire({ runId, job, mb, cores, tasks = 0, size, onTicket } = {}) {
    if (closed) throw new Error('test pool is closed');
    let id, ticket, ticketRecord;
    withMutex(() => {
      for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.tmp'))) {
        const file = path.join(dir, name);
        try { if (Date.now() - fs.statSync(file).mtimeMs > staleMs) fs.rmSync(file, { recursive: true, force: true }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const counter = path.join(dir, 'next-ticket');
      const highest = Math.max(0, ...fs.readdirSync(dir).map(name => Number(/^\d+/.exec(name)?.[0] || 0)));
      let previous = 0;
      try { previous = Number(fs.readFileSync(counter, 'utf8')); } catch { /* first ticket */ }
      const next = Number.isSafeInteger(previous) && previous >= highest ? previous + 1 : highest + 1;
      if (!Number.isSafeInteger(next)) throw new Error('invalid pool ticket counter');
      writeJson(counter, next);
      id = `${String(next).padStart(15, '0')}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
      ticket = path.join(dir, `${id}.ticket`);
      ticketRecord = { pid: process.pid, runId, job, mb, cores, tasks, priority, heartbeat: Date.now(), queuedAt: Date.now() };
      writeJson(ticket, ticketRecord);
      ownTickets.set(ticket, ticketRecord);
    });
    let lastNotice = Date.now();
    let taskWaitAt = null;
    let lastOutsideNotice = 0;
    let memoryWaitAt = null;
    try {
      onTicket?.(Number(id.slice(0, 15)));
      while (!closed) {
        const admitted = withMutex(() => {
          if (!fs.existsSync(ticket)) writeJson(ticket, ticketRecord);
          const tickets = entries('ticket');
          const leases = entries('lease');
          const usedMb = leases.reduce((sum, item) => sum + item.data.mb, 0);
          const usedCores = leases.reduce((sum, item) => sum + item.data.cores, 0);
          const owedMb = Date.now() - ticketRecord.queuedAt > fairMs ? 0 : reservedForPriority(leases);
          const freeMb = Math.max(0, poolMb - usedMb - owedMb);
          const freeCores = Math.max(0, poolCores - usedCores);
          const unused = leases.reduce((sum, item) => sum + Math.max(0, item.data.mb - (item.data.pss || 0)), 0);
          // Never admit beyond MemAvailable minus reserve, except by the floor below (an empty pool only).
          // The waiting notice below tells the operator why the job remains queued.
          const readingMb = readAvailableMb();
          const availableMb = Math.max(0, readingMb - reserveMb - unused - owedMb);
          const fitMb = Math.min(freeMb, availableMb);
          const taskCap = taskCapacity(leases);
          const request = { tasks, ...(size ? size({ freeMb: fitMb, freeCores,
            freeTasks: taskCap?.available ?? Infinity, usedMb, usedCores }) : { mb, cores }) };
          validRequest(request, job);
          ticketRecord.mb = request.mb;
          ticketRecord.cores = request.cores;
          ticketRecord.tasks = request.tasks;
          writeJson(ticket, ticketRecord);
          // A priority ticket waits only behind other priority tickets; every other ticket waits behind all.
          const preceding = tickets.filter(item => item.file !== ticket && item.name < path.basename(ticket) &&
            (!priority || item.data.priority));
          const bypass = preceding.length > 0 && preceding.every(item => !item.data.priority &&
            Date.now() - (item.data.queuedAt || item.data.heartbeat) > bypassMs &&
            Date.now() - (item.data.queuedAt || item.data.heartbeat) < 2 * bypassMs &&
            (item.data.mb > fitMb || item.data.cores > freeCores ||
              taskBlocked(item.data.tasks, taskCap)));
          // A request for no tasks never waits on task headroom: under a loaded box `available` goes negative, and
          // `0 > available` used to block it (2026-10-05).
          const blockedByTasks = taskBlocked(request.tasks, taskCap);
          const head = preceding[0];
          const blockedFor = item => [
            item.mb > fitMb ? 'memory' : null,
            item.cores > freeCores ? 'cores' : null,
            taskBlocked(item.tasks, taskCap) ? 'tasks' : null,
          ].filter(Boolean).join(', ');
          const blocker = head ? { ticket: Number(head.name.slice(0, 15)),
            job: head.data.job, pid: head.data.pid } : null;
          const reason = blockedFor(head?.data || request) || blockedFor(request) || 'queue order';
          // reservedForPriority, not owedMb: a ticket past fairMs ignores reservations, but the floor never does (Codex).
          const alone = memoryFloor && leases.length === 0 && !preceding.length && reservedForPriority(leases) === 0 &&
            request.mb <= freeMb && request.cores <= freeCores && !blockedByTasks && request.mb > availableMb;
          const spendReserve = alone && request.mb <= readingMb;
          if (!alone || spendReserve) memoryWaitAt = null;
          else memoryWaitAt ??= Date.now();
          const timed = alone && !spendReserve && (floorOpen || Date.now() - memoryWaitAt >= floorMs);
          const floor = spendReserve || timed;
          if (!floor && (request.mb > freeMb || request.mb > availableMb || request.cores > freeCores ||
              blockedByTasks || (preceding.length && !bypass))) return { lease: null, usedMb, availableMb,
                requestMb: request.mb, taskCap, requestTasks: request.tasks, taskBlocked: blockedByTasks,
                blocker, reason, liveLeases: leases.length };
          if (timed && !floorOpen) {
            floorOpen = true;
            log(`admitting ${job} alone in an empty pool: it needs ${request.mb} MB, the memory reading is ` +
              `${Math.round(readingMb)} MB, and it waited ${Math.round(floorMs / 1000)} s. While the reading stays low, one job runs at a time (F565)`);
          }
          const leaseFile = path.join(dir, `${id}.lease`);
          const record = { pid: process.pid, runId, job, mb: request.mb, cores: request.cores,
            tasks: request.tasks, observedTasks: 0, admittedAt: Date.now(), pss: 0, priority,
            pgid: null, heartbeat: Date.now() };
          writeJson(leaseFile, record);
          fs.rmSync(ticket, { force: true });
          ownTickets.delete(ticket);
          ownLeases.set(leaseFile, record);
          const update = values => { Object.assign(record, values); record.heartbeat = Date.now(); writeJson(leaseFile, record); };
          return { lease: { ...record, file: leaseFile, ticket: Number(id.slice(0, 15)),
            setPgid: pgid => update({ pgid }), setPss: pss => update({ pss }),
            setTasks: observedTasks => update({ observedTasks }),
            release: () => releaseFile(leaseFile) } };
        });
        if (admitted.lease) return admitted.lease;
        // The "cannot fit" timeout counts only while the pool is otherwise EMPTY: a run that waits while other runs
        // (any checkout, or its own earlier jobs) hold leases is queueing, not stuck (2026-10-04: a run that waited
        // behind other lanes' gates hit the limit the moment it was admitted).
        if (admitted.taskBlocked && admitted.liveLeases === 0) {
          const cap = admitted.taskCap;
          const box = () => {
            const top = topConsumers(3).map(c => `${c.comm} ${c.tasks} (${c.procs} proc${c.procs === 1 ? '' : 's'})`).join(', ');
            return `pids.current ${cap.current} of ${cap.max}, reserve ${taskReserve}, need ${admitted.requestTasks}${top ? `; biggest: ${top}` : ''}`;
          };
          // A request bigger than the whole cap less the reserve can never fit: say so at once.
          if (admitted.requestTasks > cap.max - taskReserve)
            throw new Error(`task cap ${cap.max} less reserve ${taskReserve} can never hold ${admitted.requestTasks} tasks`);
          // Otherwise the pool holds nothing of ours, so the blocker is OUTSIDE load (other sessions, agents,
          // browsers). Wait for it, visibly, up to a cap: a silent gate that hangs for hours is worse than an error.
          taskWaitAt ??= Date.now();
          if (Date.now() - taskWaitAt >= outsideWaitMs)
            throw new Error(`outside load kept the task headroom below ${admitted.requestTasks} for ${Math.round(outsideWaitMs / 60_000)} min: ${box()}`);
          if (Date.now() - lastOutsideNotice >= outsideNoticeMs) {
            log(`waiting on outside load for ${job}: ${box()}`);
            lastOutsideNotice = Date.now();
          }
        } else taskWaitAt = null;
        if (Date.now() - lastNotice >= 30_000) {
          const own = admitted.blocker && admitted.blocker.pid === process.pid;
          const behind = admitted.blocker ? ` behind ${own ? 'this run\'s own earlier' : ''} ticket ${admitted.blocker.ticket} (job ${admitted.blocker.job}${own ? '' : `, pid ${admitted.blocker.pid}`})` : '';
          log(`waiting${behind}: ${admitted.reason}`);
          lastNotice = Date.now();
        }
        await delay(pollMs);
      }
      throw new Error('test pool is closed');
    } finally { releaseFile(ticket); }
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const file of [...ownTickets.keys(), ...ownLeases.keys()]) releaseFile(file);
    for (const file of ownReserves.keys()) { try { fs.rmSync(file, { force: true }); } catch { /* gone */ } }
    ownReserves.clear();
  }
  return { acquire, tryAcquire, reserve, close };
}
