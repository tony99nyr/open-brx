// The node<->MC envelope rule (contracts.md §5) against app/test/fixtures/envelope-cases.json (DRY review 2026-10-10 #1).
// mcp/tests/test_envelope_cases.py decodes the same frames through envelope.py, so the phone and MC accept and reject
// alike; a frame MC rejects for a reason the phone does not know is a malformed frame nobody can debug from one side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, EnvelopeError } from '../src/transport/envelope.js';
import { Transport } from '../src/transport/transport.js';
import { memoryStorage } from '../src/transport/ring.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'envelope-cases.json'), 'utf8'));

/** The case's wire text: `text` as written or `frame` as compact JSON, then each `fill` token expanded. */
export function wireText(c) {
  let text = 'text' in c ? c.text : JSON.stringify(c.frame);
  for (const f of c.fill ?? []) {
    assert.ok(text.includes(f.token), `${c.name}: fill token ${f.token} is not in the frame`);
    text = text.split(f.token).join(f.with.repeat(f.times));
  }
  return text;
}

/** "ok", or the EnvelopeError reason; any other throw is a validator bug and fails the case. */
function outcome(c) {
  try { decode(wireText(c), c.direction); return 'ok'; } catch (e) {
    if (e instanceof EnvelopeError) return e.reason;
    throw e;
  }
}

test('every envelope case decodes on the phone as the file says', () => {
  assert.ok(DOC.cases.length >= 60);
  const wrong = DOC.cases.map(c => [c.name, outcome(c), c.differs?.js ?? c.expect]).filter(([, got, want]) => got !== want);
  assert.deepEqual(wrong, []);
});

test('the cases reach every reason and both directions', () => {
  const reasons = new Set(DOC.cases.map(c => c.expect));
  for (const r of ['ok', 'not_object', 'version', 'unknown_kind', 'missing_field', 'bad_t', 'bad_event', 'oversize']) assert.ok(reasons.has(r), r);
  assert.ok(DOC.cases.some(c => c.direction === 'mc') && DOC.cases.some(c => c.direction === 'node'));
  assert.equal(new Set(DOC.cases.map(c => c.name)).size, DOC.cases.length, 'case names are unique');
});

test("the phone case is the frame the real Transport.send writes, so no check refuses what a phone sends", () => {
  // brx3 review: a stricter check (a bool is not an int) must not refuse a real frame. The case file's frame is held
  // to what send() builds: the fact from the golden trace hp-low-health-shield.json, stamped and wrapped by the phone.
  const c = DOC.cases.find(x => x.name === "a death fact as the phone's Transport.send writes it");
  assert.ok(c, 'the phone case is in the file');
  const t = new Transport({ storage: memoryStorage(), wsFactory: () => ({ send() {}, close() {} }), node: { node_id: 'n1' } });
  const sent = [];
  t._sendRaw = env => { sent.push(env); return true; };
  t.state = 'bound'; t.playerId = 'p1'; t.matchId = 'm1'; t.syncedNow = () => c.frame.t;
  t.send({ type: 'death', match_id: 'm1', shooter_num: 19, shooter_team: 2 });
  assert.equal(sent.length, 1);
  assert.deepEqual({ ...sent[0], id: c.frame.id }, c.frame);
});
