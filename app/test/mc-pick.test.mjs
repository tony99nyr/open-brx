// F659: two MCs on one LAN. The shared pick cases against pickMc, then the policy that uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickMc, McAutoJoin, CANDIDATE_TTL_MS } from '../src/transport/autojoin.js';
import { discoveredStartedAt, discoveredUrl } from '../src/transport/mclink.js';
import { _statusLine } from '../src/hud/lobby.js';

const { cases } = JSON.parse(readFileSync(new URL('./fixtures/mc-pick-cases.json', import.meta.url), 'utf8'));
for (const c of cases) {
  test(`pickMc: ${c.name}`, () => {
    const got = pickMc(c.found.map(f => ({ url: f.url, startedAt: f.started_at })), c.last_good);
    assert.equal(got ? got.url : null, c.pick);
  });
}

const A = 'ws://192.0.2.10:8766/ws', B = 'ws://192.0.2.20:8766/ws';
const ctx = (o = {}) => ({ bound: false, dialling: null, verifying: false, hasTrustKey: false, remembered: null, userDialPending: false, ...o });

test('the TXT started_at rides with an mDNS result', () => {
  const res = { action: 'resolved', service: { ipv4Addresses: ['192.0.2.10'], port: 8766, txtRecord: { started_at: '1700000000123' } } };
  assert.equal(discoveredUrl(res), A);
  assert.equal(discoveredStartedAt(res), 1700000000123);
  assert.equal(discoveredStartedAt({ ...res, service: { ...res.service, txtRecord: {} } }), undefined);
});

test('two MCs, no trust key: the SEVERAL row offers the newest, and offers the newer one when it appears', () => {
  const aj = new McAutoJoin({ now: () => 1000 });
  assert.equal(aj.onFound(A, 'mdns', ctx(), 100).do, 'wait');
  const d = aj.onFound(B, 'mdns', ctx(), 900);
  assert.deepEqual([d.do, d.reason, d.url], ['offer', 'several', B]);
  const again = aj.onFound(A, 'mdns', ctx(), 100);
  assert.equal(again.url, B, 'a re-sighting of the older MC still offers the pick');
});

test('two MCs, with a trust key: the proof dial goes to the pick, and the remembered MC beats a newer one', () => {
  const aj = new McAutoJoin({ now: () => 1000 });
  aj.onFound(A, 'mdns', ctx({ hasTrustKey: true }), 100);
  const d = aj.onFound(B, 'mdns', ctx({ hasTrustKey: true }), 900);
  assert.deepEqual([d.do, d.url], ['verify', B]);
  const aj2 = new McAutoJoin({ now: () => 1000 });
  aj2.onFound(A, 'mdns', ctx({ hasTrustKey: true, remembered: A }), 100);
  const e = aj2.onFound(B, 'mdns', ctx({ hasTrustKey: true, remembered: A, welcomeOpen: true }), 900);
  assert.equal(e.do, 'ignore', 'the last-good MC is already being dialled; the newer one does not pull the phone away');
});

test('the join count is the MCs seen in the last TTL, bound or not, so it does not flip', () => {
  let now = 1000;
  const aj = new McAutoJoin({ now: () => now });
  aj.onFound(A, 'mdns', ctx(), 100); aj.onFound(B, 'mdns', ctx(), 900);
  assert.equal(aj.foundCount(), 2);
  aj.onBound(A);
  assert.equal(aj.lastFound, 2);
  assert.equal(aj.foundCount(), 2, 'a join does not reset the count');
  aj.onFound(A, 'mdns', ctx({ bound: true }), 100);   // a re-sighting of the same MC
  aj.onBound(A);
  assert.equal(aj.lastFound, 2, 'the same MC seen again is not a third');
  now += CANDIDATE_TTL_MS + 1;
  aj.onBound('ws://192.0.2.99:8766/ws');
  assert.equal(aj.lastFound, 1, 'old sightings expire; the MC joined by QR counts itself');
});

test('F659 review: a pick that failed its proof is skipped, so the trusted MC on a new IP is still dialled', () => {
  let now = 1000;
  const aj = new McAutoJoin({ now: () => now });
  const key = ctx({ hasTrustKey: true });
  aj.onFound(A, 'mdns', key, 100);                              // our trusted MC, back on a new IP, but older
  const first = aj.onFound(B, 'mdns', key, 900);                // a newer stranger
  assert.deepEqual([first.do, first.url], ['verify', B]);
  aj.onVerifyFailed(B, true);                                   // B did not prove it is ours: cooling
  const next = aj.onFound(A, 'mdns', key, 100);
  assert.deepEqual([next.do, next.url], ['verify', A], 'the cooling MC is not the pick any more');
  const again = aj.onFound(B, 'mdns', key, 900);
  assert.deepEqual([again.do, again.url], ['verify', A], 'a cooling MC is never re-dialled: the sighting leads to the pick');
});

test('F659 review: the SEVERAL row never offers a cooling MC while another is in view', () => {
  const aj = new McAutoJoin({ now: () => 1000 });
  aj.onFound(A, 'mdns', ctx(), 100); aj.onFound(B, 'mdns', ctx(), 900);
  aj.onVerifyFailed(B, false);
  const d = aj.onFound(A, 'mdns', ctx(), 100);
  assert.deepEqual([d.do, d.reason, d.url], ['offer', 'several', A]);
});

test('the HUD status line names the server and the count only when more than one MC was found', () => {
  const st = { wsState: 'bound', synced: true };
  assert.match(_statusLine.call({ mcFound: { n: 2, name: 'TONY-LAPTOP' } }, st, 'connected'), /JOINED TONY-LAPTOP<\/b> \(2 FOUND\)/);
  assert.match(_statusLine.call({ mcFound: { n: 1, name: 'TONY-LAPTOP' } }, st, 'connected'), /HOST ✓/);
  assert.match(_statusLine.call({ mcFound: null }, st, 'connected'), /HOST ✓/);
  assert.match(_statusLine.call({ mcFound: { n: 2, name: null } }, st, 'connected'), /JOINED HOST<\/b> \(2 FOUND\)/);
});
