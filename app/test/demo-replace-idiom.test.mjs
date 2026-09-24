// S59 Low: demo.js rewrote `$PSET` with `.replace(re, '$145,0,')`, which works only because `$14` (no group 14) falls
// back to `$1` + "4". A replacer function says what it means. No replacement string in the demo may put a digit after `$1`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('demo.js uses no "$1<digit>" replacement string', () => {
  const src = readFileSync(new URL('../src/demo.js', import.meta.url), 'utf8');
  const hits = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\.replace\([^)]*\)?[^;]*,\s*'\$\d\d/.test(l)).map(([n]) => n);
  assert.deepEqual(hits, [], `lines ${hits.join(', ')}`);
});
