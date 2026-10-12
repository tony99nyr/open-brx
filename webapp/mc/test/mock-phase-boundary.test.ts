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
  const isPhase = (node: ts.Node): boolean =>
    (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === 'phase') ||
    (ts.isElementAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'phase');
  const hasPhase = (node: ts.Node): boolean => {
    if (isPhase(node)) return true;
    return ts.forEachChild(node, hasPhase) ?? false;
  };
  for (const member of backend.members) {
    const owner = ts.isConstructorDeclaration(member) ? 'constructor' :
      member.name?.getText(file) ?? 'static block';
    const visit = (node: ts.Node) => {
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
    const source = readFileSync(resolve('src/mock/backend.ts'), 'utf8');
    expect(phaseWrites(source)).toEqual(['setPhaseField']);
  });
});
