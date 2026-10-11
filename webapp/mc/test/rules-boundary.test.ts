// Round 2 candidate 10: the mock must not be built from the screens it tests, and the shared rules must
// stand alone. The walk follows every relative import transitively (static, `export from`, dynamic
// `import()` and `require()`), so a rule reached through src/api or src/ui still counts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve('src');
const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? filesUnder(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
});

const SPECIFIER = /(?:\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const specifiers = (source: string): string[] => [...source.matchAll(SPECIFIER)].map(m => m[1]);

const resolveLocal = (from: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, ...['.ts', '.tsx', '.js', '.mjs'].map(ext => base + ext), join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
};

/** Every file reached from `roots`, with the chain that reached it, for the failure message. */
const reach = (roots: string[]): Map<string, string[]> => {
  const seen = new Map<string, string[]>(roots.map(r => [r, [r]]));
  const queue = [...roots];
  while (queue.length) {
    const file = queue.shift()!;
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      const next = resolveLocal(file, spec);
      if (!next || seen.has(next)) continue;
      seen.set(next, [...seen.get(file)!, next]);
      queue.push(next);
    }
  }
  return seen;
};

const violations = (rootDir: string, forbidden: string[]): string[] =>
  [...reach(filesUnder(join(SRC, rootDir))).entries()]
    .filter(([file]) => forbidden.some(dir => file.startsWith(join(SRC, dir) + '/') || file === join(SRC, dir)))
    .map(([, chain]) => chain.map(f => relative(SRC, f)).join(' -> '));

describe('rules module boundaries', () => {
  it('the mock reaches no screen and no UI module, directly or through another module', () => {
    expect(violations('mock', ['screens', 'ui'])).toEqual([]);
  });
  it('the rules reach no screen, UI module, mock or store', () => {
    expect(violations('rules', ['screens', 'ui', 'mock', 'store.tsx'])).toEqual([]);
  });
  it('the walk sees every import form', () => {
    const src = `import type { A } from './a';\nimport b from "./b";\nexport { c } from './c';\nconst d = import('./d');\nconst e = require( './e' );\nimport {\n  f,\n} from './f';`;
    expect(specifiers(src)).toEqual(['./a', './b', './c', './d', './e', './f']);
  });
});
