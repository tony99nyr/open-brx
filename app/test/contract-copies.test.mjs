import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const MODULES = ['src/engine.js', 'src/powerup-player.js', 'src/powerup.js', 'src/beacon.js', 'src/control.js', 'src/utility.js', 'src/app.js',
  ...readdirSync(`${root}/src/hud`).filter(file => file.endsWith('.js')).map(file => `src/hud/${file}`)];

test('phone modules do not redeclare generated contract constants', () => {
  const names = Object.keys(contract).join('|');
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+(?:${names})\\s*=`, 'm');
  for (const file of MODULES) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    assert.doesNotMatch(source, declaration, `${file} declares a generated contract constant`);
  }
});

// DRY #4: app/src reads the generated names directly. A module that wants a shorter name for a generated value may not
// declare `const X = GENERATED_NAME;`, because every importer then learns two names for one number.
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(`${dir}/${entry.name}`)
    : entry.name.endsWith('.js') && entry.name !== 'contract.gen.js' ? [`${dir}/${entry.name}`] : []);
}

test('no app/src module aliases a generated contract export', () => {
  const alias = new RegExp(`^\\s*(?:export\\s+)?const\\s+\\w+\\s*=\\s*(?:${Object.keys(contract).join('|')})\\s*;`, 'm');
  const files = sourceFiles(`${root}/src`);
  assert.ok(files.length > 20, 'the scan found the app/src modules');
  for (const file of files) {
    const hit = alias.exec(readFileSync(file, 'utf8'));
    assert.equal(hit, null, `${file.slice(root.length)} aliases a generated export (${hit && hit[0].trim()}): import the generated name and use it directly`);
  }
});
