// Ports for the test jobs (F523). A port picked by listening on 0 and closing comes from the kernel's ephemeral range,
// so the kernel can give the same number to any other port-0 listen or outgoing connection before the job binds it.
// Under test-all's load that happened: mc-game-edit lost 127.0.0.1:42823 (a repro bound 300 port-0 listeners after
// each pick, and 11 of 200 picks were handed out again). The kernel never gives out a port below the ephemeral range,
// so test-all gives each job its own block of ports from there:
//   - jobBlockEnv() (test-all side, one process) hands each job a block no other job in the run holds, and names
//     MC_PORT, MC_WS_PORT and VITE_PORT from it.
//   - freePort() (job side) takes the next port of the job's block that a probe can bind. Outside test-all (no block in
//     the env) it falls back to a port-0 pick, which is fine for a run with nothing else on the box.
// test-all's machine-wide lock means one run at a time, so the blocks of two runs never meet. A port that something
// outside the run binds by number is skipped by the probe.
import fs from 'node:fs';
import net from 'node:net';

export const BLOCK_SIZE = 32;   // play.mjs takes 5 more after the named 3; an mc-harness restart takes 2 each
export const PORT_LO = 20000;
const PORT_TOP = 32767;   // below Linux's default ephemeral range (32768-60999) and macOS's (49152-65535)

/** The highest port the blocks may use: just below this box's ephemeral range when the kernel reports one. */
export function portHi(rangeFile = '/proc/sys/net/ipv4/ip_local_port_range') {
  let lo = PORT_TOP + 1;
  try { lo = Number(fs.readFileSync(rangeFile, 'utf8').trim().split(/\s+/)[0]) || lo; } catch { /* not Linux */ }
  const hi = Math.min(PORT_TOP, lo - 1);
  if (hi < PORT_LO + BLOCK_SIZE) throw new Error(`scripts/lib/ports.mjs: the ephemeral range starts at ${lo}, no room below it for test ports`);
  return hi;
}

/** True when a listener can bind `port` on 127.0.0.1 now. */
export const canBind = port => new Promise(resolve => {
  const s = net.createServer(); s.unref();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

const pick0 = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** The first ports in [from, end) that `probe` can bind, `count` of them, or an error that names the block. */
async function bindable(from, end, count, probe) {
  const got = [];
  for (let p = from; p < end && got.length < count; p++) if (await probe(p)) got.push(p);
  if (got.length < count) throw new Error(`no free test port left in ${from}-${end - 1} (BRX_PORT_NEXT/BRX_PORT_END)`);
  return got;
}

/** test-all side: a block allocator. Blocks start at a random block of the range (so a port that a stale process from an
 *  earlier run still holds is unlikely to be the first one tried) and are never reused in one run. */
export function blockAllocator({ lo = PORT_LO, hi = portHi(), rand = Math.random, probe = canBind } = {}) {
  const blocks = Math.floor((hi - lo + 1) / BLOCK_SIZE);
  let next = Math.floor(rand() * blocks), used = 0;
  /** The env for one job: three named ports from a fresh block, and the rest of the block for freePort(). */
  return async function jobBlockEnv() {
    if (used++ >= blocks) throw new Error(`scripts/lib/ports.mjs: all ${blocks} port blocks are used in this run`);
    const start = lo + (next++ % blocks) * BLOCK_SIZE, end = start + BLOCK_SIZE;
    const [mc, ws, vite] = await bindable(start, end, 3, probe);
    return { MC_PORT: String(mc), MC_WS_PORT: String(ws), VITE_PORT: String(vite),
      BRX_PORT_NEXT: String(vite + 1), BRX_PORT_END: String(end) };
  };
}

let cursor = null;
/** Job side: the next free port of this job's block (BRX_PORT_NEXT up to BRX_PORT_END), or a port-0 pick outside
 *  test-all. A port it returns is never returned again by this process. */
export async function freePort({ env = process.env, probe = canBind } = {}) {
  const end = Number(env.BRX_PORT_END);
  if (!end) return pick0();
  if (cursor === null) cursor = Number(env.BRX_PORT_NEXT);
  const [port] = await bindable(cursor, end, 1, probe);
  cursor = port + 1;
  return port;
}
