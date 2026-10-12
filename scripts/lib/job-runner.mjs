// scripts/test-all.mjs's job runner (A10, the test-all split, stage 2): it starts a job in its own process group, logs
// it, times it out, and takes down everything the job left behind. The run's stop and signal policy stays in
// test-all.mjs, which calls killAll() and reapRun().
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { reapByEnv } from './reap.mjs';

export const REAP_KEY = 'BRX_TEST_REAP';
const groupAlive = pid => { try { process.kill(-pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Every job imports brx_mcp from THIS checkout: <root>/mcp goes first on PYTHONPATH (the dev venv's editable install
 *  points at the main checkout), and BRX_MCP_EXPECT_DIR makes brx_mcp/__init__.py refuse any other copy. */
export function ownBrxMcpEnv(ownMcp, env = {}) {
  const rest = (env.PYTHONPATH ?? process.env.PYTHONPATH ?? '').split(path.delimiter).filter(p => p && p !== ownMcp);
  return { PYTHONPATH: [ownMcp, ...rest].join(path.delimiter), BRX_MCP_EXPECT_DIR: ownMcp };
}

/** A runner for one test-all run. `baseEnv` is every job's environment before its own; `runToken` makes each job's
 *  reap token (`<runToken>:<job>`); `onStart(name, pid)` and
 *  `onEnd(name, pid)` let the run follow a job's process group (test-all uses them for app-screens). */
export function createJobRunner({ root, logs, baseEnv, runToken = `${process.pid}-${Date.now()}`, onStart = () => {}, onEnd = () => {},
  logError = message => console.error(message) }) {
  const groups = new Set();
  const groupLeases = new Map();
  const kills = [];   // every kill in progress; awaited before the run exits, so the SIGKILL fallback really fires
  const ownMcp = path.join(root, 'mcp');

  /** SIGTERM first, SIGKILL 2 s later if anything in the group is still there. The TERM matters: mcp/run_tests.py puts
   *  each test file in its own session, out of reach of a signal to the job's group, and only its SIGTERM handler can
   *  take those children down. The returned promise settles when the group is gone or has had its SIGKILL. */
  const killGroup = pid => {
    const p = (async () => {
      try { process.kill(-pid, 'SIGTERM'); } catch { return; }
      for (let i = 0; i < 20 && groupAlive(pid); i++) await new Promise(r => setTimeout(r, 100));
      try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
    })();
    kills.push(p);
    return p;
  };
  const killAll = () => { for (const g of groups) killGroup(g); };

  // Every job carries REAP_KEY=<run>:<job> in its environment, and so does everything it starts. A job's MC or vite is
  // often spawned `detached` (its own session), out of reach of killGroup, and an e2e script killed by a signal skips
  // its `finally`: so when a job ends, by any path, whatever still carries its token is reaped (lib/reap.mjs).
  const reapJob = async name => {
    const left = await reapByEnv(REAP_KEY, `${runToken}:${name}`);
    if (left.length) logError(`test-all: ${name} left ${left.length} process(es) behind; reaped: ${left.map(p => `${p.comm} ${p.pid}`).join(', ')}`);
  };
  const reapAll = () => { const p = reapByEnv(REAP_KEY, `${runToken}:`, { prefix: true }); kills.push(p); return p; };

  /** Runs one job. Resolves {name, code, secs, log}: `code` is the exit code, the signal name, or 'TIMEOUT'. */
  function run(name, cwd, cmd, env = {}, timeoutS, lease = null) {
    if (!(timeoutS > 0)) throw new Error(`job-runner: ${name} needs a timeout in seconds, got ${timeoutS}`);
    const log = path.join(logs, `${name}.log`);
    const jobHome = path.join(logs, `${name}-brx-mcp-home`);
    fs.rmSync(jobHome, { recursive: true, force: true });
    fs.mkdirSync(jobHome, { recursive: true });
    const out = fs.openSync(log, 'w');
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      // detached: the job leads its own process group, so a timeout kills its browsers and servers too
      const child = spawn(cmd[0], cmd.slice(1), { cwd: path.join(root, cwd), env: { ...baseEnv, ...env, BRX_MCP_HOME: jobHome,
        ...ownBrxMcpEnv(ownMcp, env), [REAP_KEY]: `${runToken}:${name}` }, stdio: ['ignore', out, out], detached: true });
      if (child.pid) {
        groups.add(child.pid);
        onStart(name, child.pid);
        if (lease) { lease.setPgid(child.pid); groupLeases.set(child.pid, lease); }
      }
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { fs.writeSync(out, `\ntest-all: killed after ${timeoutS}s (JOB_TIMEOUT_S, or three times the job's typical time)\n`); }
        catch (error) { reject(error); }
        killGroup(child.pid);
      }, timeoutS * 1000);
      child.on('error', e => {
        try { fs.writeSync(out, `\nspawn failed: ${e.message}\n`); }
        catch { /* preserve the spawn error */ }
        reject(e);
      });
      child.on('close', async code => {
        try {
          clearTimeout(timer);
          if (child.pid && groupAlive(child.pid)) await killGroup(child.pid);
          await reapJob(name);
          groups.delete(child.pid);
          onEnd(name, child.pid);
          groupLeases.delete(child.pid);
          fs.closeSync(out);
          resolve({ name, code: timedOut ? 'TIMEOUT' : child.signalCode || code, secs: (Date.now() - t0) / 1000, log });
        } catch (error) { reject(error); }
      });
    });
  }

  return { run, groups, groupLeases, kills, killGroup, killAll, reapRun: reapAll, ownBrxMcpEnv: env => ownBrxMcpEnv(ownMcp, env) };
}
