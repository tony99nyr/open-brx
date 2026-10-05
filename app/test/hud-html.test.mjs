// Exact HTML from the pre-split HUD, across engine states driven by demo.js's stage fixtures.
// First test: the template methods. Second test: the whole Hud (render, patchers, moments, lanes, diagnostics) on a fake DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml, domGolden, loadStates } from './hud-html-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures', file), 'utf8'));
const fixtures = loadStates(path.join(root, 'test/fixtures/hud-html-states.json'));
const writing = process.argv.includes('--write-golden');
const write = (file, data) => {
  console.warn('Warning: --write-golden replaces the HUD HTML golden. Use it only for a deliberate HTML change.');
  fs.writeFileSync(path.join(root, 'test/fixtures', file), JSON.stringify(data, null, 2) + '\n');
};

test('HUD screen and diagnostics HTML match the old renderer for stage states', async () => {
  const timezone = process.env.TZ;
  const priorDocument = globalThis.document;
  globalThis.document = { activeElement: null, querySelector: () => null };
  process.env.TZ = 'America/New_York';
  try {
    const actual = Object.fromEntries(Object.entries(fixtures).map(([name, fixture]) => [name, renderHtml(fixture)]));
    if (writing) return write('hud-html-golden.json', actual);
    assert.deepEqual(actual, read('hud-html-golden.json'));
    await new Promise(resolve => setTimeout(resolve, 0));
  } finally {
    if (timezone === undefined) delete process.env.TZ;
    else process.env.TZ = timezone;
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test('the whole HUD (patchers, moments, lanes, scores, diagnostics, picker rows) leaves the same page as the old HUD', () => {
  const actual = domGolden(fixtures);
  if (writing) return write('hud-dom-golden.json', actual);
  const golden = read('hud-dom-golden.json');
  assert.deepEqual(Object.keys(actual), Object.keys(golden));
  for (const name of Object.keys(golden)) assert.deepEqual(actual[name], golden[name], name);
});
