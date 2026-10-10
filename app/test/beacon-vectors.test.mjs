// The shared advert vectors (app/test/fixtures/advert-vectors.json) against beacon.js. mcp/tests/test_advert_vectors.py
// and hardware/m5sticks3/test/test_advert_vectors.cpp read the same file, so the three codecs agree byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeUuid, decodeUuid, PLAYER_STATE } from '../src/beacon.js';
import { ADVERT_PLAYER_STATE } from '../src/transport/contract.gen.js';

const doc = JSON.parse(readFileSync(new URL('./fixtures/advert-vectors.json', import.meta.url), 'utf8'));
const fields = c => ({ role: c.role, id: c.id, kind: c.kind_name, team: c.team, state: c.state, value: c.value, seq: c.seq,
  game: c.game, threshold: c.threshold, taker: c.taker });

test('every vector encodes to its uuid and decodes back to its fields', () => {
  for (const c of doc.cases) {
    assert.equal(encodeUuid({ ...c, kind: c.kind }), c.uuid, `encode: ${c.name}`);
    assert.deepEqual(decodeUuid(c.uuid), fields(c), `decode: ${c.name}`);
  }
});

test('other spellings (upper case, no dashes) decode to the same advert', () => {
  for (const v of doc.variants.filter(x => x.runners.includes('app'))) {
    const c = doc.cases.find(x => x.name === v.decodes_as);
    assert.deepEqual(decodeUuid(v.uuid), fields(c), v.name);
  }
});

test('every reject vector decodes to null', () => {
  for (const r of doc.reject) assert.equal(decodeUuid(r.uuid), null, r.name);
});

test('each PLAYER_STATE bit vector carries the generated bit, and the phone sets all but revived', () => {
  const named = doc.cases.filter(c => c.bit);
  assert.deepEqual(named.map(c => c.bit), Object.keys(ADVERT_PLAYER_STATE), 'one vector per generated bit, in order');
  for (const c of named) {
    assert.equal(c.state, ADVERT_PLAYER_STATE[c.bit], c.name);
    if (c.bit === 'revived') assert.equal(PLAYER_STATE.revived, undefined, 'F344: the phone never sets revived');
    else assert.equal(PLAYER_STATE[c.bit], c.state, c.name);
  }
});
