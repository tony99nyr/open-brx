// F659: the shared MC address cases (fixtures/mc-url-cases.json) against the one normaliser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseMcUrl } from '../src/mcurl.js';
import { resolveTypedMc } from '../src/transport/utility-join.js';

const { cases } = JSON.parse(readFileSync(new URL('./fixtures/mc-url-cases.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`normaliseMcUrl: ${c.name}`, () => {
    const r = normaliseMcUrl(c.in);
    if (c.refused) { assert.ok(r.refused, `expected a refusal, got ${JSON.stringify(r)}`); assert.equal(r.url, undefined); return; }
    assert.equal(r.refused, undefined, `unexpected refusal: ${r.refused}`);
    assert.equal(r.url, c.url);
    assert.deepEqual(r.join, c.join);
  });
}

test('the utility page typed address uses the same normaliser', () => {
  for (const c of cases) {
    const r = resolveTypedMc(c.in);
    if (c.refused) { assert.ok(r === null || r.refused, c.name); continue; }
    assert.equal(r.url, c.url, c.name);
    assert.equal(r.secret, c.join.secret || null, c.name);
    assert.equal(r.pub, c.join.pub || null, c.name);
  }
});
