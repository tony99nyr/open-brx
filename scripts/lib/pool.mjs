import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pidAlive } from './lock.mjs';

export const poolDirName = (uid = os.userInfo().uid) => path.join('/tmp', `brx-test-pool-${uid}`);

export function memAvailableMb() {
  try {
    const match = /^MemAvailable:\s+(\d+)/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    if (match) return Number(match[1]) / 1024;
  } catch { /* macOS */ }
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
  pollMs = 200, heartbeatMs = 2_000, staleMs = 300_000, bypassMs = 60_000,
  log = message => console.error(`test pool: ${message}`) } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const mutex = path.join(dir, '.mutex');
  const ownTickets = new Map();
  const ownLeases = new Map();
  let closed = false;

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
    finally { fs.rmSync(mutex, { recursive: true, force: true }); }
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
    for (const [file, data] of [...ownTickets, ...ownLeases]) {
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

  async function acquire({ runId, job, mb, cores, size, onTicket } = {}) {
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
      ticketRecord = { pid: process.pid, runId, job, mb, cores, heartbeat: Date.now(), queuedAt: Date.now() };
      writeJson(ticket, ticketRecord);
      ownTickets.set(ticket, ticketRecord);
    });
    let lastNotice = Date.now();
    try {
      onTicket?.(Number(id.slice(0, 15)));
      while (!closed) {
        const admitted = withMutex(() => {
          if (!fs.existsSync(ticket)) writeJson(ticket, ticketRecord);
          const tickets = entries('ticket');
          const leases = entries('lease');
          const usedMb = leases.reduce((sum, item) => sum + item.data.mb, 0);
          const usedCores = leases.reduce((sum, item) => sum + item.data.cores, 0);
          const freeMb = Math.max(0, poolMb - usedMb);
          const freeCores = Math.max(0, poolCores - usedCores);
          const unused = leases.reduce((sum, item) => sum + Math.max(0, item.data.mb - (item.data.pss || 0)), 0);
          // Never admit beyond MemAvailable minus reserve, even with an empty pool.
          // The waiting notice below tells the operator why the job remains queued.
          const availableMb = Math.max(0, readAvailableMb() - reserveMb - unused);
          const fitMb = Math.min(freeMb, availableMb);
          const request = size ? size({ freeMb: fitMb, freeCores, usedMb, usedCores }) : { mb, cores };
          if (!request || !Number.isFinite(request.mb) || !Number.isFinite(request.cores) ||
              request.mb <= 0 || request.cores <= 0) throw new Error(`invalid pool request for ${job}`);
          ticketRecord.mb = request.mb;
          ticketRecord.cores = request.cores;
          writeJson(ticket, ticketRecord);
          const preceding = tickets.filter(item => item.file !== ticket && item.name < path.basename(ticket));
          const bypass = preceding.length > 0 && preceding.every(item =>
            Date.now() - (item.data.queuedAt || item.data.heartbeat) > bypassMs &&
            Date.now() - (item.data.queuedAt || item.data.heartbeat) < 2 * bypassMs &&
            (item.data.mb > fitMb || item.data.cores > freeCores));
          if (request.mb > freeMb || request.mb > availableMb || request.cores > freeCores ||
              (preceding.length && !bypass)) return { lease: null, usedMb, availableMb, requestMb: request.mb };
          const leaseFile = path.join(dir, `${id}.lease`);
          const record = { pid: process.pid, runId, job, mb: request.mb, cores: request.cores,
            pss: 0, pgid: null, heartbeat: Date.now() };
          writeJson(leaseFile, record);
          fs.rmSync(ticket, { force: true });
          ownTickets.delete(ticket);
          ownLeases.set(leaseFile, record);
          const update = values => { Object.assign(record, values); record.heartbeat = Date.now(); writeJson(leaseFile, record); };
          return { lease: { ...record, file: leaseFile, ticket: Number(id.slice(0, 15)),
            setPgid: pgid => update({ pgid }), setPss: pss => update({ pss }),
            release: () => releaseFile(leaseFile) } };
        });
        if (admitted.lease) return admitted.lease;
        if (Date.now() - lastNotice >= 30_000) {
          log(`waiting for ${Math.ceil(admitted.requestMb)} MB (pool ${Math.ceil(admitted.usedMb)}/${poolMb}, available ${Math.floor(admitted.availableMb)})`);
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
  }
  return { acquire, close };
}
