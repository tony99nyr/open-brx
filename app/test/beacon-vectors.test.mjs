// The shared advert vectors (app/test/fixtures/advert-vectors.json) against beacon.js. mcp/tests/test_advert_vectors.py
// and hardware/m5sticks3/test/test_advert_vectors.cpp read the same file, so the three codecs agree byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeUuid, decodeUuid, PLAYER_STATE, encodeTally, decodeTally, endAgeCode, endAgeMs } from '../src/beacon.js';
import { ADVERT_PLAYER_STATE } from '../src/transport/contract.gen.js';

const doc = JSON.parse(readFileSync(new URL('./fixtures/advert-vectors.json', import.meta.url), 'utf8'));
const fields = c => ({ role: c.role, id: c.id, kind: c.kind_name, team: c.team, state: c.state, value: c.value, seq: c.seq,
  game: c.game, threshold: c.threshold, taker: c.taker, scopeKinds: c.scope_kinds, scope: c.scope });

test('every vector encodes to its uuid and decodes back to its fields', () => {
  for (const c of doc.cases) {
    assert.equal(encodeUuid({ ...c, kind: c.kind, scopeKinds: c.scope_kinds }), c.uuid, `encode: ${c.name}`);
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

// A88: the hill's tally payload and the player's end info, shared with brx_advert.h
test('every tally vector encodes to its bytes and decodes back', () => {
  for (const v of doc.tallies) {
    assert.deepEqual(encodeTally({ game: v.game, final: v.final, ownMs: v.own_ms }), v.bytes, v.name);
    const d = decodeTally(v.bytes);
    assert.equal(d.game, v.game, v.name); assert.equal(d.final, v.final, v.name);
  }
});
test('end ages: an age gives its code, and a code reads back as the middle of its step', () => {
  for (const v of doc.end_codes) assert.equal(endAgeCode(v.age_ms), v.code, `age ${v.age_ms}`);
  for (const v of doc.end_reads) assert.equal(endAgeMs(v.code), v.age_ms, `code ${v.code}`);
});
