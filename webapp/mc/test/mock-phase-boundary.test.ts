import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function phaseWrites(source: string): string[] {
  const file = ts.createSourceFile('backend.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const backend = file.statements.find((node): node is ts.ClassDeclaration =>
    ts.isClassDeclaration(node) && node.name?.text === 'MockBackend');
  if (!backend) throw new Error('MockBackend class is missing');
  const writes: string[] = [];
  // `this`, also through parentheses, `as`/`<T>` casts, `!`, and a local alias (`const self = this`).
  const aliases = new Set<string>();
  const unwrap = (node: ts.Expression): ts.Expression => {
    let e = node;
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) ||
           ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
    return e;
  };
  const isThis = (node: ts.Expression): boolean => {
    const e = unwrap(node);
    return e.kind === ts.SyntaxKind.ThisKeyword || (ts.isIdentifier(e) && aliases.has(e.text));
  };
  const isPhaseKey = (node: ts.Expression): boolean =>
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === 'phase';
  const isPhase = (node: ts.Node): boolean =>
    (ts.isPropertyAccessExpression(node) && isThis(node.expression) && node.name.text === 'phase') ||
    (ts.isElementAccessExpression(node) && isThis(node.expression) && isPhaseKey(node.argumentExpression));
  const assignsPhase = (node: ts.Node): boolean =>   // Object.assign(this, { phase }) / { ...x, phase: y }
    ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'assign' && ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Object' && node.arguments.length > 1 && isThis(node.arguments[0]) &&
    // A source the guard cannot read (a spread, a variable, a call) could carry `phase`, so it counts as a write too.
    node.arguments.slice(1).some(arg => !ts.isObjectLiteralExpression(arg) || arg.properties.some(p =>
      ts.isSpreadAssignment(p) ||
      ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === 'phase')));
  const hasPhase = (node: ts.Node): boolean => {
    if (isPhase(node)) return true;
    return ts.forEachChild(node, hasPhase) ?? false;
  };
  for (const member of backend.members) {
    const owner = ts.isConstructorDeclaration(member) ? 'constructor' :
      member.name?.getText(file) ?? 'static block';
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isThis(node.initializer))
        aliases.add(node.name.text);
      if (assignsPhase(node)) writes.push(owner);
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        if (hasPhase(node.initializer)) writes.push(owner);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && hasPhase(node.left)) writes.push(owner);
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
          hasPhase(node.operand)) writes.push(owner);
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(member, visit);
  }
  return writes;
}

describe('mock phase write boundary', () => {
  it('assigns the phase field only in its funnel', () => {
    const source = readFileSync(resolve(__dirname, '../src/mock/backend.ts'), 'utf8')   // test-file relative, not cwd;
    expect(phaseWrites(source)).toEqual(['setPhaseField']);
  });

  it('sees a write through a cast, an alias, a template key or Object.assign', () => {
    const wrap = (body: string) => `class MockBackend { private phase = 'muster'; private setPhaseField(p) { this.phase = p; } f() { ${body} } }`;
    for (const body of ["(this as any).phase = 'live';", "this!.phase = 'live';", "const self = this; self.phase = 'live';",
                        "this[`phase`] = 'live';", "Object.assign(this, { phase: 'live' });",
                        "Object.assign(this, { ...{ phase: 'live' } });", "Object.assign(this, patch);", "(this).phase += 'x';"]) {
      expect(phaseWrites(wrap(body)), body).toEqual(['setPhaseField', 'f']);
    }
  });
});
