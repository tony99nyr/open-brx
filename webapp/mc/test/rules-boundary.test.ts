// Round 2 candidate 10: the mock must not be built from the screens it tests, and the shared rules must
// stand alone. The walk follows every relative import transitively (static, `export from`, dynamic
// `import()` and `require()`), so a rule reached through src/api or src/ui still counts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = resolve('src');
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? filesUnder(path) : EXTENSIONS.some(ext => entry.name.endsWith(ext)) && !entry.name.endsWith('.d.ts') ? [path] : [];
});

/** Every module specifier in `source`, read from the TypeScript AST: static and side-effect imports,
 *  `export from`, and `import()` or `require()` with a string or plain template literal. Comments
 *  are not code, so a commented-out import is not counted. */
const specifiers = (source: string): string[] => {
  const out: string[] = [];
  const literal = (n: ts.Node | undefined) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const spec = literal(node.moduleSpecifier);
      if (spec) out.push(spec);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const spec = literal(node.arguments[0]);
      if (spec) out.push(spec);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return out;
};

/** A relative import that resolves to nothing is a failure, not the end of the walk. */
const resolveLocal = (from: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  const candidates = [base, ...EXTENSIONS.map(ext => base + ext), ...EXTENSIONS.map(ext => join(base, 'index' + ext))];
  const hit = candidates.find(c => existsSync(c) && statSync(c).isFile());
  if (!hit) throw new Error(`${relative(SRC, from)} imports ${spec}, which the boundary walk cannot resolve`);
  return hit;
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
  it('the walk sees every import form, and only real code', () => {
    const src = [
      "import type { A } from './a';", 'import b from "./b";', "export { c } from './c';", "const d = import('./d');",
      "const e = require( './e' );", "import {\n  f,\n} from './f';", 'export const x = 1;', "import './g';",
      'const h = import(`./h`);', "// import './commented';", "/* export { z } from './block'; */", "export const y = 'from';",
    ].join('\n');
    expect(specifiers(src)).toEqual(['./a', './b', './c', './d', './e', './f', './g', './h']);
  });
});
