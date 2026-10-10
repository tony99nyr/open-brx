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

const walk = (d: string): string[] =>
  readdirSync(d).flatMap(f => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

/** A value worth guarding by content: a long or `$`-bearing string, or a list of two or more strings. */
function wanted() {
  const strings = new Map<string, string>();
  const lists = new Map<string, string>();
  const shapes = new Map<string, string>();   // an object or a list of objects/numbers, by its JSON: a renamed copy is still one
  for (const [name, v] of Object.entries(C)) {
    if (typeof v === 'string' && (v.length >= 12 || v.includes('$'))) strings.set(v, name);
    if (Array.isArray(v) && v.length >= 2 && v.every(x => typeof x === 'string')) lists.set(JSON.stringify(v), name);
    else if (v && typeof v === 'object' && (Array.isArray(v) ? v.length >= 2 : Object.keys(v).length >= 2)) shapes.set(JSON.stringify(v), name);
  }
  return { names: new Set(Object.keys(C)), strings, lists, shapes };
}

/** The plain value of a literal-only expression (strings, numbers, booleans, null, nested arrays and objects with plain
 *  keys, `as const` and `Object.freeze` unwrapped), or undefined when any part is computed. */
function literal(n: ts.Expression): unknown {
  if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n)) return literal(n.expression);
  if (ts.isCallExpression(n) && n.getText().startsWith('Object.freeze(') && n.arguments.length === 1) return literal(n.arguments[0]);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) return -Number(n.operand.text);
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (n.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(n)) {
    const out = n.elements.map(e => literal(e));
    return out.some(x => x === undefined) ? undefined : out;
  }
  if (ts.isObjectLiteralExpression(n)) {
    const out: Record<string, unknown> = {};
    for (const p of n.properties) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return undefined;
      const v = literal(p.initializer);
      if (v === undefined) return undefined;
      out[p.name.text] = v;
    }
    return out;
  }
  return undefined;
}

/** Every copy in `text`: a variable named like a generated export, a string literal equal to a generated string, an
 *  array literal equal to a generated string list. */
export function copiesIn(rel: string, text: string, w = wanted()): string[] {
  // only mock/data.ts carries generated blocks (gen_ui_catalog.py); a marker anywhere else hides nothing
  const body = rel === 'mock/data.ts' ? text.replace(/\/\/ GENERATED-START[\s\S]*?\/\/ GENERATED-END[^\n]*/g, m => m.replace(/[^\n]/g, ' ')) : text;
  const sf = ts.createSourceFile(rel, body, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isTypeNode(n)) return;   // a string in a type is a type, not a restated value
    // a name match counts when the value is written out: `const X = GEN_X` or a transform of the import is not a copy
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && w.names.has(n.name.text) && n.initializer && literal(n.initializer) !== undefined)
      hits.push(`${rel}: declares ${n.name.text}`);
    if ((ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n))) {
      const v = literal(n);
      if (v !== undefined && w.shapes.has(JSON.stringify(v))) hits.push(`${rel}: restates ${w.shapes.get(JSON.stringify(v))} as a literal`);
    }
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
    expect(all).toEqual([]);
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
    expect(copiesIn('foo.ts', generated), 'markers hide nothing outside mock/data.ts').toEqual(['foo.ts: declares GUN_LINK_LOST']);
    const renamed = `const LOCAL = ${JSON.stringify(C.HEALTH_PRESETS)};\nconst ALIAS_OK = C_HEALTH;\nexport const HEALTH_PRESETS = GEN_HEALTH_PRESETS;\ntype T = ${JSON.stringify(C.GUN_LINK_LOST)};`;
    expect(copiesIn('r.ts', renamed)).toEqual(['r.ts: restates HEALTH_PRESETS as a literal']);
  });
});
