#!/usr/bin/env node
// Runs the generators listed in scripts/generated.json: `node scripts/regen.mjs --check|--write [name...]`.
//   --check  runs each entry's `check` argv (writes nothing); --write runs its `write` argv (rewrites the outputs).
// Exit 0: every generator is fresh (or was written). Exit 1: at least one is stale; each stale name and its write
// command are printed. Exit 2: a generator itself failed (crashed, missing interpreter, unknown name); the name is printed.
// A generator reports "stale" by exiting 1 with the word "stale" in its output. Any other non-zero exit, and an exit 1
// that says nothing about being stale (a Python traceback also exits 1), counts as a failure.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Mirrors findPython() in scripts/test-all.mjs (that file is a script and exports nothing): MC_PY, else this
 *  checkout's .venv, else the main checkout's .venv (git's common dir), else system python3. */
function findPython() {
  if (process.env.MC_PY) return process.env.MC_PY;
  const candidates = [path.join(ROOT, '.venv/bin/python')];
  try {
    const git = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' });
    if (git.status !== 0) throw new Error(git.stderr || git.error?.message);
    candidates.push(path.join(path.dirname(git.stdout.trim()), '.venv/bin/python'));
  } catch { /* not a git checkout */ }
  return candidates.find(p => fs.existsSync(p)) || 'python3';
}

const argv = process.argv.slice(2);
const mode = argv.includes('--write') ? 'write' : argv.includes('--check') ? 'check' : null;
const names = argv.filter(a => !a.startsWith('--'));
if (!mode || (argv.includes('--write') && argv.includes('--check'))) {
  console.error('usage: node scripts/regen.mjs --check|--write [name...]');
  process.exit(2);
}
const { generators } = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'generated.json'), 'utf8'));
const unknown = names.filter(n => !generators.some(g => g.name === n));
if (unknown.length) { console.error(`regen: unknown generator(s): ${unknown.join(', ')}`); process.exit(2); }
const chosen = names.length ? generators.filter(g => names.includes(g.name)) : generators;

const py = findPython();
const resolve = argv0 => argv0.map(a => a === '{python}' ? py : a === 'node' ? process.execPath : a);
const stale = [], failed = [];
for (const g of chosen) {
  const [cmd, ...args] = resolve(g[mode]);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.error || r.status === null || (r.status !== 0 && r.status !== 1)) {
    failed.push(g.name); console.error(`regen: ${g.name} FAILED (${r.error?.message || `exit ${r.status ?? r.signal}`})\n${out.trim().slice(-2000)}`);
  } else if (r.status === 1 && mode === 'check') {
    if (/stale/i.test(out) && !/Traceback \(most recent|^\s+at .*\(node:/m.test(out)) { stale.push(g); console.error(`regen: ${g.name} is STALE`); }
    else { failed.push(g.name); console.error(`regen: ${g.name} FAILED (exit 1, not a stale report)\n${out.trim().slice(-2000)}`); }
  } else if (r.status === 1) {
    failed.push(g.name); console.error(`regen: ${g.name} FAILED (exit 1)\n${out.trim().slice(-2000)}`);
  } else console.log(`regen: ${g.name} ${mode === 'check' ? 'fresh' : 'written'}`);
}
if (failed.length) { console.error(`regen: generator(s) failed: ${failed.join(', ')}`); process.exit(2); }
if (stale.length) {
  for (const g of stale) console.error(`regen: stale ${g.name}: run ${resolve(g.write).join(' ')}   (or: node scripts/regen.mjs --write ${g.name})`);
  process.exit(1);
}
