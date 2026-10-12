// How the lander runs a command in its candidate worktree, and its gate (A11, the land.mjs split, stage 4). Each run's
// whole output goes to a log in <state>/logs (the newest LOG_KEEP kept); land.mjs prints a summary. lib/land-gate.mjs
// reads the gate's verdict.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readGate } from './land-gate.mjs';
import { reapByEnv } from './reap.mjs';

// Everything a gate starts carries this token (lib/reap.mjs): if test-all itself is killed hard, its jobs' detached
// MCs, vite servers and browsers are still found and stopped, here or after the gate returns.
export const GATE_KEY = 'BRX_LAND_GATE';
const LOG_KEEP = 200;   // the newest logs kept in <state>/logs; older ones are deleted at each new run

/** The job names in a `test-all --list` output. */
export const listJobs = out => out.split('\n').map(l => l.trim()).filter(Boolean).filter(l => /^[a-z][a-z0-9-]*$/.test(l));

/** The first failing test named in a job's log, when the log says (run_tests.py's `FAIL file::test`). A browser
 *  gate's log never says that -- it throws instead -- so falls back to the first line naming the actual error
 *  (an "Error:" line, or Playwright's own "closed" wording, e.g. "Target page, context or browser has been
 *  closed"), so flakes.jsonl still records SOMETHING to look at instead of `step: null` (2026-09-27, F429/F430:
 *  two OOM-killed browser jobs both logged a `step: null` flake). */
export function stepOf(log) {
  let text;
  try { text = fs.readFileSync(log, 'utf8'); } catch { return null; }
  const fail = /^FAIL (\S+)/m.exec(text);
  if (fail) return fail[1];
  const line = /^.*(?:Error:|closed).*$/m.exec(text);
  return line ? line[0].trim() : null;
}

/** A runner for one lander process. `worktree()` is the candidate worktree now (it changes per lock entry); `stub` is
 *  LAND_GATE_STUB's command (test-only) or ''. `child` is the live command, for the signal handlers. */
export function createGateRunner({ state, worktree, stub = '', token = `${process.pid}-${Date.now()}` }) {
  let child = null, runs = 0;

  /** One command (default cwd: the candidate worktree). Resolves { code, out, log }. */
  function runLogged(cmd, cwd = worktree(), env = {}) {
    const logDir = path.join(state, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    if (runs === 0) {
      try { for (const f of fs.readdirSync(logDir).sort().slice(0, -LOG_KEEP)) fs.rmSync(path.join(logDir, f), { force: true }); }
      catch { /* nothing to prune */ }
    }
    const log = path.join(logDir, `${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}-${++runs}.log`);
    return new Promise(resolve => {
      let out = '';
      // BRX_LAND_PRIORITY: the gate's test-all gets pool priority over local runs (it removes the variable from its jobs).
      const c = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, [GATE_KEY]: token, BRX_LAND_PRIORITY: '1', ...env },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      child = c;
      const take = d => { out += d; };
      c.stdout.on('data', take);
      c.stderr.on('data', take);
      c.on('error', e => { out += `\nspawn failed: ${e.message}\n`; });
      c.on('close', async code => {
        child = null;
        const left = await reapByEnv(GATE_KEY, token);
        if (left.length) out += `\nland: the gate left ${left.length} process(es) behind; reaped: ${left.map(p => `${p.comm} ${p.pid}`).join(', ')}\n`;
        fs.writeFileSync(log, `$ ${cmd.join(' ')}\n${out}`);
        resolve({ code, out, log });
      });
    });
  }

  /** test-all in the candidate worktree with `args`, and its verdict (lib/land-gate.mjs readGate). */
  async function runGate(args) {
    const resultsPath = path.join(state, 'logs', `${process.pid}-${crypto.randomUUID()}.results.json`);
    const run = await runLogged(stub ? [...JSON.parse(stub), ...args] : ['node', 'scripts/test-all.mjs', ...args],
      worktree(), { BRX_RESULTS_JSON: resultsPath, BRX_FOLLOWUPS_INDEX_FRESH: '1' });   // A15: the gate checks the block
    try { return { ...run, result: readGate(resultsPath, run.out) }; }
    finally { try { fs.rmSync(resultsPath, { force: true, recursive: true }); } catch { /* cleanup only: never replaces the verdict */ } }
  }

  return { runLogged, runGate, token, get child() { return child; } };
}
