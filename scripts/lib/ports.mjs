// Ports for the test jobs (F523). A port picked by listening on 0 and closing comes from the kernel's ephemeral range,
// so the kernel can give the same number to any other port-0 listen or outgoing connection before the job binds it.
// Under test-all's load that happened: mc-game-edit lost 127.0.0.1:42823 (a repro bound 300 port-0 listeners after
// each pick, and 11 of 200 picks were handed out again). The kernel never gives out a port below the ephemeral range,
// so test-all gives each job its own block of ports from there:
//   - jobBlockEnv() (test-all side) claims a block for the job and names MC_PORT, MC_WS_PORT and VITE_PORT from it.
//   - freePort() (job side) takes the next port of the job's block that a probe can bind. Outside test-all (no block in
//     the env) it falls back to a port-0 pick, which is fine for a run with nothing else on the box.
// Two test-all runs can be live at once (the checkout lock is per checkout; a lander gate runs beside a lane's run), so
// a block is claimed machine-wide, with claim files in claimDir (claim() says how). A run removes its claims when it
// exits; a dead or very old run's claim does not count. A block with any port that does not bind is skipped.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pidAlive } from './proc.mjs';

export const BLOCK_SIZE = 40;   // the most one script takes is 32: play.mjs's 3 named ports and 29 freePort() calls
export const PORT_LO = 20000;
const PORT_TOP = 32767;   // below Linux's default ephemeral range (32768-60999) and macOS's (49152-65535)

/** Where the ephemeral range starts on this box: Linux's ip_local_port_range, macOS's portrange sysctl, else 49152. */
export function ephemeralLo(rangeFile = '/proc/sys/net/ipv4/ip_local_port_range') {
  try { return Number(fs.readFileSync(rangeFile, 'utf8').trim().split(/\s+/)[0]) || 49152; } catch { /* not Linux */ }
  if (process.platform === 'darwin') {
    const r = spawnSync('sysctl', ['-n', 'net.inet.ip.portrange.first'], { encoding: 'utf8' });
    if (r.status === 0 && Number(r.stdout.trim())) return Number(r.stdout.trim());
  }
  return 49152;
}

/** The highest port the blocks may use: just below the ephemeral range. */
export function portHi(lo = ephemeralLo()) {
  const hi = Math.min(PORT_TOP, lo - 1);
  if (hi < PORT_LO + BLOCK_SIZE) throw new Error(`scripts/lib/ports.mjs: the ephemeral range starts at ${lo}, no room below it for test ports`);
  return hi;
}

/** True when a listener can bind `port` on `host` now. A host this machine lacks (no IPv6) counts as free. */
const bindsOn = (port, host) => new Promise(resolve => {
  const s = net.createServer(); s.unref();
  s.once('error', e => resolve(e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT'));
  s.listen(port, host, () => s.close(() => resolve(true)));
});
/** True when a listener can bind `port` on 127.0.0.1 and on ::1 now. F574: vite binds `localhost`, which is ::1 on a
 *  GitHub runner, so a port free on IPv4 alone can still be another test's (CI run 38268828276). */
export const canBind = async port => (await bindsOn(port, '127.0.0.1')) && bindsOn(port, '::1');

const pick0once = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
/** A port-0 pick that also binds on ::1 (canBind). */
const pick0 = async () => {
  for (let i = 0; i < 50; i++) { const port = await pick0once(); if (await canBind(port)) return port; }
  throw new Error('scripts/lib/ports.mjs: no port-0 pick bound on both loopbacks in 50 tries');
};

export const claimDirName = (uid = os.userInfo().uid) => path.join('/tmp', `brx-test-ports-${uid}`);

const CLAIM_MAX_AGE_MS = 3 * 3600_000;   // longer than any run (a job is capped at an hour); covers a reused pid
const claimLive = (dir, name, now) => {
  const pid = Number(name.split('.')[1]);
  try { return pidAlive(pid) && now - fs.statSync(path.join(dir, name)).mtimeMs < CLAIM_MAX_AGE_MS; }
  catch { return false; }   // removed meanwhile
};

/** Claims block `start` for this process, or returns null when another live run holds it. Each run creates its own
 *  file (`<start>.<pid>.<random>.claim`) first, then lists the block's claims, and keeps the block only when no other
 *  live claim exists. Two runs that race both see each other and both move on, so they never share a block. A claim
 *  from a dead pid, or older than CLAIM_MAX_AGE_MS, does not count, and whoever sees it removes it. */
function claim(dir, start) {
  const file = path.join(dir, `${start}.${process.pid}.${Math.random().toString(36).slice(2)}.claim`);
  fs.writeFileSync(file, '', { flag: 'wx' });
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(`${start}.`) || path.join(dir, name) === file) continue;
    if (claimLive(dir, name, now)) { fs.rmSync(file, { force: true }); return null; }
    fs.rmSync(path.join(dir, name), { force: true });
  }
  return file;
}

/** test-all side: a block allocator. It starts at a random block, so two runs rarely contend for the same claim, and
 *  it removes its claims when this process exits. */
export function blockAllocator({ lo = PORT_LO, hi = portHi(), rand = Math.random, probe = canBind, dir = claimDirName() } = {}) {
  const blocks = Math.floor((hi - lo + 1) / BLOCK_SIZE);
  let next = Math.floor(rand() * blocks);
  const mine = [];
  const releaseAll = () => { for (const file of mine.splice(0)) try { fs.unlinkSync(file); } catch { /* gone */ } };
  process.once('exit', releaseAll);
  /** The env for one job: three named ports from a newly claimed block whose every port binds, and the rest of the
   *  block for freePort(). */
  async function jobBlockEnv() {
    fs.mkdirSync(dir, { recursive: true });
    for (let tried = 0; tried < blocks; tried++) {
      const start = lo + (next++ % blocks) * BLOCK_SIZE;
      const file = claim(dir, start);
      if (!file) continue;
      let free = true;
      for (let p = start; p < start + BLOCK_SIZE && free; p++) free = await probe(p);
      if (!free) { fs.rmSync(file, { force: true }); continue; }
      mine.push(file);
      return { MC_PORT: String(start), MC_WS_PORT: String(start + 1), VITE_PORT: String(start + 2),
        BRX_PORT_NEXT: String(start + 3), BRX_PORT_END: String(start + BLOCK_SIZE) };
    }
    throw new Error(`scripts/lib/ports.mjs: no free port block of ${BLOCK_SIZE} in ${lo}-${hi}`);
  }
  jobBlockEnv.release = releaseAll;
  return jobBlockEnv;
}

let cursor = null;
/** Job side: the next free port of this job's block (BRX_PORT_NEXT up to BRX_PORT_END), or a port-0 pick outside
 *  test-all. A port it returns is never returned again by this process. */
export async function freePort({ env = process.env, probe = canBind } = {}) {
  const end = Number(env.BRX_PORT_END);
  if (!end) return pick0();
  if (cursor === null) cursor = Number(env.BRX_PORT_NEXT);
  for (; cursor < end; cursor++) if (await probe(cursor)) return cursor++;
  throw new Error(`no free test port left in this job's block (BRX_PORT_NEXT ${env.BRX_PORT_NEXT} to BRX_PORT_END ${end})`);
}
