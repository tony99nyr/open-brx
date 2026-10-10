// The console twin of app/test/contract-copies.test.mjs (seams review 2026-10-10): src/api/contract.gen.ts is the one
// copy of every constant MC shares with the console, so no other src/ module may restate one. It reads CODE, through the
// TypeScript AST, never text: a comment that names a value can neither trip it nor satisfy it. The GENERATED blocks in
// src/mock/data.ts are generated output and are skipped.
import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as C from '../src/api/contract.gen';

const SRC = path.resolve(__dirname, '../src');

/** Copies another branch is removing (chore/mc-console-generated-constants, brx3's Batch B follow-up). Each entry must
 *  still be a real hit: once that branch lands, the test below fails until the entry is deleted. */
const PENDING: ReadonlySet<string> = new Set([
  'mock/backend.ts: declares POWERUP_PRESETS',
  'screens/Recap.tsx: declares STATION_KIND_LABEL',
  'screens/gameSummary.ts: declares HEALTH_PRESETS',
  'screens/gameSummary.ts: declares SOLO_MODES',
  'teamColours.ts: declares OBJECTIVE_MODES',
]);

const walk = (d: string): string[] =>
  readdirSync(d).flatMap(f => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

/** A value worth guarding by content: a long or `$`-bearing string, or a list of two or more strings. */
function wanted() {
  const strings = new Map<string, string>();
  const lists = new Map<string, string>();
  for (const [name, v] of Object.entries(C)) {
    if (typeof v === 'string' && (v.length >= 12 || v.includes('$'))) strings.set(v, name);
    if (Array.isArray(v) && v.length >= 2 && v.every(x => typeof x === 'string')) lists.set(JSON.stringify(v), name);
  }
  return { names: new Set(Object.keys(C)), strings, lists };
}

/** Every copy in `text`: a variable named like a generated export, a string literal equal to a generated string, an
 *  array literal equal to a generated string list. */
export function copiesIn(rel: string, text: string, w = wanted()): string[] {
  const body = text.replace(/\/\/ GENERATED-START[\s\S]*?\/\/ GENERATED-END[^\n]*/g, m => m.replace(/[^\n]/g, ' '));
  const sf = ts.createSourceFile(rel, body, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && w.names.has(n.name.text)) hits.push(`${rel}: declares ${n.name.text}`);
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && w.strings.has(n.text)) hits.push(`${rel}: restates ${w.strings.get(n.text)}`);
    if (ts.isArrayLiteralExpression(n) && n.elements.length >= 2 && n.elements.every(e => ts.isStringLiteral(e))) {
      const key = JSON.stringify(n.elements.map(e => (e as ts.StringLiteral).text));
      if (w.lists.has(key)) hits.push(`${rel}: restates ${w.lists.get(key)} as a list`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('contract copies in the console', () => {
  const all = walk(SRC)
    .filter(f => !f.endsWith(path.join('api', 'contract.gen.ts')))
    .flatMap(f => copiesIn(path.relative(SRC, f).split(path.sep).join('/'), readFileSync(f, 'utf8')));

  test('no src/ module restates a generated contract constant (read it from api/contract.gen)', () => {
    expect(all.filter(h => !PENDING.has(h))).toEqual([]);
  });

  test('every PENDING entry is still a real copy: delete it once its branch has removed the copy', () => {
    expect([...PENDING].filter(h => !all.includes(h))).toEqual([]);
  });

  test('the scan reads code, not comments, and finds a planted copy of each kind', () => {
    const plant = [
      `const GUN_LINK_LOST = 'x';`,
      `const a = { text: ${JSON.stringify(C.GUN_LINK_LOST)} };`,
      `const b = ${JSON.stringify([...C.TEAM_NAMES])};`,
      `// ${C.GUN_LINK_LOST} in a comment is not a copy`,
      `/* const GUN_LINK_LOST = 1; */`,
    ].join('\n');
    expect(copiesIn('plant.ts', plant)).toEqual([
      'plant.ts: declares GUN_LINK_LOST',
      'plant.ts: restates GUN_LINK_LOST',
      'plant.ts: restates TEAM_NAMES as a list',
    ]);
    const generated = `// GENERATED-START weapons\nconst GUN_LINK_LOST = 'x';\n// GENERATED-END weapons\n`;
    expect(copiesIn('mock/data.ts', generated)).toEqual([]);
  });
});
