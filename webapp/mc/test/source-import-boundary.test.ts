import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const webapp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(webapp, 'mc/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [full] : [];
  });
}

function outsideImports(file: string, code: string): string[] {
  const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const bad: string[] = [];
  const check = (specifier: string) => {
    if (!specifier.startsWith('.') && !path.isAbsolute(specifier) && !specifier.startsWith('file:')) return;
    const target = specifier.startsWith('file:') ? fileURLToPath(specifier)
      : path.resolve(path.dirname(file), specifier);
    const rel = path.relative(webapp, target);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) bad.push(specifier);
  };
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && node.arguments.length && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return bad;
}

describe('MC source import boundary', () => {
  it('detects a cross-repository import in a source file', () => {
    expect(outsideImports(path.join(src, 'mock/data.ts'),
      "import catalogue from '../../../../mcp/brx_mcp/mc/weapons.json';"))
      .toEqual(['../../../../mcp/brx_mcp/mc/weapons.json']);
    const absolute = path.resolve(webapp, '../mcp/brx_mcp/mc/weapons.json');
    expect(outsideImports(path.join(src, 'mock/data.ts'), `import catalogue from '${absolute}';`))
      .toEqual([absolute]);
  });

  it('keeps every source import inside webapp', () => {
    const bad = sourceFiles(src).flatMap(file => outsideImports(file, readFileSync(file, 'utf8'))
      .map(specifier => `${path.relative(src, file)}: ${specifier}`));
    expect(bad).toEqual([]);
  });
});
