// A18 guard: a test file must import a shared helper from ./_helpers.mjs, not declare its own copy.
// Copies drift: 22 files once carried their own mkStorage. The names are read from _helpers.mjs itself,
// so a helper added there is covered with no edit here.
//
// Only top-level declarations count: a helper nested inside a function is local by construction.
// A file may keep a deliberately different local version. Add its name to EXCEPTIONS as
// 'file.test.mjs': ['helperName'] and say in a comment why the copy differs in substance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const EXCEPTIONS = {};

const names = [...readFileSync(dir + '_helpers.mjs', 'utf8').matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(m => m[1]);

test('A18: _helpers.mjs exports helpers and is not itself a test file', () => {
  assert.ok(names.length >= 1, 'no helper names found in _helpers.mjs');
  assert.ok(!'_helpers.mjs'.endsWith('.test.mjs'));
});

test('A18: no test file declares a function or const named after a shared helper', () => {
  const found = [];
  for (const f of readdirSync(dir).filter(x => x.endsWith('.test.mjs'))) {
    const src = readFileSync(dir + f, 'utf8');
    for (const n of names) {
      if ((EXCEPTIONS[f] || []).includes(n)) continue;
      if (new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\s*\\(|^(?:export\\s+)?(?:const|let|var)\\s+${n}\\s*=`, 'm').test(src)) found.push(`${f}: ${n}`);
    }
  }
  assert.deepEqual(found, [], 'import these from ./_helpers.mjs, or add an EXCEPTIONS entry:\n' + found.join('\n'));
});

// A1 (maintainability review 2026-10-10): the HUD's screens import hud/shared.js; a private copy drifts (the DOWN screen's
// `mmss` printed 5:03 against the live HUD's 05:03, and its TEAM_COLOR had lost F432's `green` alias).
test('A1: no app/src/hud file declares its own copy of a hud/shared.js export', () => {
  const hud = fileURLToPath(new URL('../src/hud/', import.meta.url));
  const shared = [...readFileSync(hud + 'shared.js', 'utf8').matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(m => m[1]);
  assert.ok(shared.length >= 10, 'shared.js exports found');
  const found = [];
  for (const f of readdirSync(hud).filter(x => x.endsWith('.js') && x !== 'shared.js')) {
    const src = readFileSync(hud + f, 'utf8');
    for (const n of shared) if (new RegExp(`^(?:export\\s+)?(?:const|let|var|function)\\s+${n}\\b`, 'm').test(src)) found.push(`hud/${f}: ${n}`);
  }
  assert.deepEqual(found, [], 'import these from ./shared.js:\n' + found.join('\n'));
});
