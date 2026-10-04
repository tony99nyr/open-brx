import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('phone modules do not redeclare generated contract constants', () => {
  const names = Object.keys(contract).join('|');
  const declaration = new RegExp(`\\bconst\\s+(?:${names})\\s*=`, 'm');
  for (const file of ['src/engine.js', 'src/beacon.js', 'src/control.js', 'src/utility.js']) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    assert.doesNotMatch(source, declaration, `${file} declares a generated contract constant`);
  }
});
