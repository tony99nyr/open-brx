import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as contract from '../src/transport/contract.gen.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('team colours and inks in both HTML files match the generated contract', () => {
  for (const file of ['www/index.html', 'www/utility.html']) {
    const html = readFileSync(`${root}/${file}`, 'utf8');
    contract.TEAM_KEYS.forEach((key, tid) => {
      const colour = new RegExp(`--team-${key}\\s*:\\s*(${contract.TEAM_COLOUR_HEX[tid]})\\b`, 'i');
      const ink = new RegExp(`\\[data-team=["']${key}["']\\][^}]*--team-ink\\s*:\\s*(${contract.TEAM_INK_HEX[tid]})\\b`, 'i');
      assert.match(html, colour, `${file}: --team-${key}`);
      assert.match(html, ink, `${file}: [data-team=${key}] --team-ink`);
    });
  }
});

const MODULES = ['src/engine.js', 'src/powerup-player.js', 'src/powerup.js', 'src/beacon.js', 'src/control.js', 'src/utility.js', 'src/app.js', 'src/announcer.js', 'src/ammo.js', 'src/play-queue.js',
  ...readdirSync(`${root}/src/hud`).filter(file => file.endsWith('.js')).map(file => `src/hud/${file}`)];

test('phone modules do not redeclare generated contract constants', () => {
  const names = Object.keys(contract).join('|');
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+(?:${names})\\s*=`, 'm');
  for (const file of MODULES) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    assert.doesNotMatch(source, declaration, `${file} declares a generated contract constant`);
  }
});

// DRY #4: app/src reads the generated names directly. A module may not give a generated value a second name, in any
// form: `const|let|var X = GEN`, a line with several declarators or statements, `const { a: X } = GEN`,
// `export { GEN as X }` or `import { GEN as X }` (from the contract or from a module that re-exports it). The scan
// walks the TypeScript AST, so layout and semicolons do not matter. A renamed import needs an entry in ALLOWED_RENAMES.
const ALLOWED_RENAMES = {
  // 'src/file.js': { 'GENERATED_NAME as LOCAL': 'why the local name must differ' },
};

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(`${dir}/${entry.name}`)
    : entry.name.endsWith('.js') && entry.name !== 'contract.gen.js' ? [`${dir}/${entry.name}`] : []);
}

export function aliasProblems(file, text, names = new Set(Object.keys(contract)), allowed = {}) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer) && names.has(node.initializer.text)) {
      found.push(node.getText(sf));   // covers const/let/var, destructuring, and every declarator on a shared line
    }
    if ((ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && node.propertyName && names.has(node.propertyName.text)) {
      const spec = node.getText(sf);
      if (!(allowed[file] || {})[spec]) found.push(spec);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

test('no app/src module aliases a generated contract export', () => {
  const files = sourceFiles(`${root}/src`);
  assert.ok(files.length > 20, 'the scan found the app/src modules');
  for (const file of files) {
    const rel = file.slice(root.length);
    const found = aliasProblems(rel, readFileSync(file, 'utf8'), undefined, ALLOWED_RENAMES);
    assert.deepEqual(found, [], `${rel} gives a generated export a second name (${found.join('; ')}): import the generated name and use it directly`);
  }
});

test('the alias scan catches every form of the second name', () => {
  const names = new Set(['GEN', 'OBJ']);
  const forms = [
    'const X = GEN;', 'let X = GEN;', 'var X = GEN;', 'const X = GEN', 'const A = 1, X = GEN;', 'foo(); const X = GEN;',
    'const { held: X } = OBJ;', 'const { held } = OBJ;', 'const [X] = OBJ;', "export { GEN as X };", "export { GEN as X } from './m.js';",
    "import { GEN as X } from './contract.gen.js';", "import { GEN as X } from './beacon.js';",
  ];
  for (const form of forms) assert.ok(aliasProblems('f.js', form, names).length > 0, `not caught: ${form}`);
  for (const ok of ['const X = GEN + 1;', 'const X = GEN.held;', 'const X = f(GEN);', "import { GEN } from './contract.gen.js';", 'export { Y };', 'const { a } = other;']) {
    assert.deepEqual(aliasProblems('f.js', ok, names), [], `false alarm: ${ok}`);
  }
  assert.deepEqual(aliasProblems('f.js', "import { GEN as X } from './m.js';", names, { 'f.js': { 'GEN as X': 'why' } }), []);
});
