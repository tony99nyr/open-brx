#!/usr/bin/env node
// Runs the generators listed in scripts/generated.json: `node scripts/regen.mjs --check|--write [name...]`.
//   --check  runs each entry's `check` argv (writes nothing); --write runs its `write` argv (rewrites the outputs).
// Exit 0: every generator is fresh (or was written). Exit 1: at least one is stale; each stale name is printed with
// the command that fixes it. Exit 2: a generator itself failed, or the command line is wrong; the name is printed.
// The exit contract of a `check` argv is in generated.json's _comment: 0 fresh, 3 stale, anything else a failure.
// Only the exit code is read, never the output, so a crash that mentions "stale" is still a failure.
// `--registry <file>` reads another registry (the tests use it).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython } from './lib/python.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STALE = 3;
const USAGE = 'usage: node scripts/regen.mjs --check|--write [name...] [--registry <file>]';
const refuse = msg => { console.error(`regen: ${msg}\n${USAGE}`); process.exit(2); };

const argv = process.argv.slice(2);
let registry = path.join(ROOT, 'scripts', 'generated.json');
const flags = new Set(), names = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--registry') { registry = argv[++i]; if (!registry || registry.startsWith('-')) refuse('--registry needs a file'); }
  else if (a === '--check' || a === '--write') flags.add(a);
  else if (a.startsWith('-')) refuse(`unknown flag ${a}`);
  else names.push(a);
}
if (flags.size !== 1) refuse('give exactly one of --check and --write');
const mode = flags.has('--write') ? 'write' : 'check';
const { generators } = JSON.parse(fs.readFileSync(registry, 'utf8'));
const unknown = names.filter(n => !generators.some(g => g.name === n));
if (unknown.length) refuse(`unknown generator(s): ${unknown.join(', ')}`);
const chosen = names.length ? generators.filter(g => names.includes(g.name)) : generators;

const { python } = findPython(ROOT);
const resolve = args => args.map(a => a === '{python}' ? python : a === 'node' ? process.execPath : a);
const stale = [], failed = [];
for (const g of chosen) {
  const [cmd, ...args] = resolve(g[mode]);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().slice(-2000);
  if (r.error || r.status === null || (r.status !== 0 && !(mode === 'check' && r.status === STALE))) {
    failed.push(g.name);
    console.error(`regen: ${g.name} FAILED (${r.error?.message || `exit ${r.status ?? r.signal}`})${out ? `\n${out}` : ''}`);
  } else if (r.status === STALE) {
    stale.push(g.name);
    console.error(`regen: ${g.name} is STALE`);
  } else console.log(`regen: ${g.name} ${mode === 'check' ? 'fresh' : 'written'}`);
}
if (failed.length) { console.error(`regen: generator(s) failed: ${failed.join(', ')}`); process.exit(2); }
if (stale.length) {
  for (const name of stale) console.error(`regen: stale ${name}: run node scripts/regen.mjs --write ${name}`);
  process.exit(1);
}
