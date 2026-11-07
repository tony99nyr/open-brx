// A88 (Tony 2026-11-07): the phone relays each hill's Domination tally to MC, and an ended phone tells the hills the game
// ended. The hill's own rules run in the shared case file (presence-hill-cases.json); this file pins the phone's half:
// the relay (hilltally.js), the hill's republish rule for its tally (control.js ControlAdvertiser, tallyPayload), the
// end info on the player advert (advert-director.js) and the walk-back scan (scanwatch.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HillTallyRelay, tallyListening, HILL_TALLY_SEND_MS, HILL_TALLY_LISTEN_MS } from '../src/hilltally.js';
import { ControlAdvertiser, tallyPayload } from '../src/control.js';
import { AdvertGate, encodeUuid, decodeUuid, encodeTally, endAgeCode } from '../src/beacon.js';
import { directAdvert, newAdvertDirector } from '../src/advert-director.js';
import { BeaconWatch } from '../src/scanwatch.js';
import { ADVERT_TALLY_COMPANY, HILL_TALLY_ROTATE_MS, HILL_TALLY_REFRESH_MS } from '../src/transport/contract.gen.js';

const hill = (id = 3, game = 7) => encodeUuid({ role: 'station', id, kind: 'control', team: 0, state: 1, value: 100, game });
const md = bytes => ({ [String(ADVERT_TALLY_COMPANY)]: new DataView(Uint8Array.from(bytes).buffer) });
const hit = (tally, { id = 3, uuid } = {}) => ({ uuids: [uuid || hill(id, tally.game)], manufacturerData: md(encodeTally(tally)) });

function relay() {
  const sent = [];
  const r = new HillTallyRelay({ emit: f => sent.push(f) });
  r.noteMatch(7, 'm7');
  return { r, sent };
}

test('a live tally goes to MC at once the first time, then at most every 30 s per site', () => {
  const { r, sent } = relay();
  r.observe(hit({ game: 7, ownMs: { 0: 12000 } }), 1000, true);
  assert.deepEqual(sent, [{ type: 'hill_tally', match_id: 'm7', site: '3', game_byte: 7, own_s: { 0: 12 }, final: false, partial: false, heard_age_ms: 0 }]);
  r.observe(hit({ game: 7, ownMs: { 0: 20000 } }), 5000, true);
  assert.equal(sent.length, 1, 'a changed live tally waits out the 30 s');
  r.tick(1000 + HILL_TALLY_SEND_MS - 1);
  assert.equal(sent.length, 1);
  r.tick(1000 + HILL_TALLY_SEND_MS);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].own_s, { 0: 20 });
  assert.equal(sent[1].heard_age_ms, HILL_TALLY_SEND_MS - 4000, 'the age of the hearing it sends');
  r.tick(1000 + 3 * HILL_TALLY_SEND_MS);
  assert.equal(sent.length, 2, 'nothing new: nothing sent');
});

test('a final tally goes at once, and a later live tally never replaces it', () => {
  const { r, sent } = relay();
  r.observe(hit({ game: 7, ownMs: { 0: 50000 } }), 1000, true);
  r.observe(hit({ game: 7, final: true, ownMs: { 0: 20000 } }), 2000, true);
  assert.equal(sent.length, 2, 'the final does not wait out the 30 s');
  assert.deepEqual([sent[1].final, sent[1].own_s], [true, { 0: 20 }], 'the trimmed final, smaller than the live tally before it');
  r.observe(hit({ game: 7, ownMs: { 0: 60000 } }), 40000, true);
  r.tick(100000);
  assert.equal(sent.length, 2, 'an untrimmed live tally (another hill phone, an old ring copy) never follows a final');
  r.observe(hit({ game: 7, final: true, ownMs: { 0: 18000 } }), 41000, true);
  assert.equal(sent.length, 3, 'a final that trimmed further goes at once');
  assert.deepEqual(sent[2].own_s, { 0: 18 });
});

test('only our own control point, only this match or the last, only when MC asks', () => {
  const { r, sent } = relay();
  r.observe(hit({ game: 7, ownMs: { 0: 9000 } }), 1000, false);
  assert.equal(sent.length, 0, 'MC did not ask (an older MC, or not Domination)');
  r.observe(hit({ game: 8, ownMs: { 0: 9000 } }), 1000, true);
  assert.equal(sent.length, 0, 'a game byte this phone never played');
  r.observe({ uuids: [encodeUuid({ role: 'station', id: 3, kind: 'respawn', team: 0, state: 1 })], manufacturerData: md(encodeTally({ game: 7, ownMs: { 0: 9000 } })) }, 1000, true);
  r.observe({ uuids: ['0000feaa-0000-1000-8000-00805f9b34fb'], manufacturerData: md(encodeTally({ game: 7, ownMs: { 0: 9000 } })) }, 1000, true);
  assert.equal(sent.length, 0, 'the unregistered company id counts only beside a control-point UUID');
  r.observe({ uuids: [hill()], manufacturerData: { 76: new DataView(new ArrayBuffer(6)) } }, 1000, true);
  assert.equal(sent.length, 0, 'another company');
  r.noteMatch(8, 'm8');
  r.observe(hit({ game: 7, ownMs: { 0: 9000 } }), 2000, true);
  assert.equal(sent.at(-1).match_id, 'm7', 'the previous match keeps its id');
  r.noteMatch(9, 'm9');
  r.observe(hit({ game: 7, ownMs: { 0: 19000 } }), 99000, true);
  assert.equal(sent.length, 1, 'two matches back is forgotten');
});

test('the hill rotates two tallies and re-keys seconds alone at most every refresh', () => {
  const a = { game: 8, final: false, ownMs: { 1: 5000 } }, b = { game: 7, final: true, ownMs: { 0: 9000 } };
  assert.deepEqual(tallyPayload([a, b], 0), encodeTally(a));
  assert.deepEqual(tallyPayload([a, b], HILL_TALLY_ROTATE_MS), encodeTally(b));
  assert.equal(tallyPayload([], 0), null);
  const adv = new ControlAdvertiser();
  const view = { team: 1, state: 1, value: 100 };
  assert.equal(adv.due(view, 0, encodeTally(a)), 'first');
  adv.published(view, 0, encodeTally(a));
  const later = encodeTally({ ...a, ownMs: { 1: 9000 } });
  assert.equal(adv.due(view, HILL_TALLY_REFRESH_MS - 1, later), null, 'seconds alone wait');
  assert.equal(adv.due(view, HILL_TALLY_REFRESH_MS, later), 'tally');
  assert.equal(adv.due(view, 1, encodeTally(b)), 'tally', 'another game goes at once');
  assert.equal(adv.due(view, 1, encodeTally({ ...a, final: true })), 'tally', 'a final goes at once');
  assert.equal(adv.due(view, 1, null), 'tally', 'a tally that went away re-keys');
});

test('an ended phone advertises how long ago it ended, and drops it past what the byte can say', () => {
  const gate = new AdvertGate();
  const config = { stations: [{ id: 3, kind: 'control' }], game_byte: 7 };
  const st = { phase: 'kitted', playerNum: 5, alive: false, ended: true, powerupClaim: null };
  const d = directAdvert({ st, config, tid: 0, scanOpens: 0, dir: newAdvertDirector(), gate, now: 1000, endAgeMs: 30000 });
  const p = decodeUuid(d.uuid);
  assert.equal(p.value, endAgeCode(30000));
  assert.equal(p.value, 8);
  assert.equal(p.state & 128, 0, 'not live');
  const old = directAdvert({ st, config, tid: 0, scanOpens: 0, dir: newAdvertDirector(), gate: new AdvertGate(), now: 1000, endAgeMs: 2e6 });
  assert.equal(decodeUuid(old.uuid).value, 0);
  const playing = directAdvert({ st: { ...st, phase: 'live', ended: false, alive: true }, config, tid: 0, scanOpens: 0, dir: newAdvertDirector(), gate: new AdvertGate(), now: 1000, endAgeMs: null });
  assert.equal(decodeUuid(playing.uuid).value, 0, 'a live phone has no end info');
});

test('after the end the scan stays open on the way back while MC wants tallies', async () => {
  let clock = 0; const calls = [];
  const link = { scan: () => { calls.push('start'); return Promise.resolve(); }, stopScan: () => { calls.push('stop'); return Promise.resolve(); } };
  const watch = new BeaconWatch({ link, now: () => clock, native: () => true, log: () => {}, onHit: () => {} });
  const config = { mode: 'domination', station_source: 'phone', hill_tally: true, stations: [{ id: 3, kind: 'control' }] };
  const ended = { phase: 'kitted', alive: false, ended: true };
  const walk = age => tallyListening(ended, config, age);
  assert.equal(walk(1000), true);
  assert.equal(walk(HILL_TALLY_LISTEN_MS), false);
  assert.equal(tallyListening(ended, { ...config, hill_tally: false }, 1000), false, 'an MC that does not ask');
  assert.equal(tallyListening({ ...ended, ended: false }, config, 1000), false);
  watch.tick(ended, { config, walkBack: walk(1000) });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['start'], 'the walk back keeps the scan');
  clock += 2000;
  watch.tick(ended, { config, walkBack: walk(HILL_TALLY_LISTEN_MS) });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, ['start', 'stop'], 'and closes it when the listening ends');
});
