// F522: with `setup.stations_age`, the golden-trace runner ages a site that drops out of a `stations` step as
// beacon.js `Presence` ages a silent advert. Each check runs the runner's StationAger and a real Presence on the
// same sightings, so the ager cannot drift from the phone without failing here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Presence, encodeUuid } from '../src/beacon.js';
import { PRESENCE_EXPIRY_MS as E } from '../src/transport/contract.gen.js';
import { StationAger } from './golden-trace-runner.mjs';

const STEP = 250;
const site = (id, median = -50, extra = {}) => ({ id, kind: 'control', team: 255, state: 0, value: 0, threshold: -74, median, ...extra });

/** Run `script` (time -> the list heard at that time) through both, one sub-step at a time, and compare each tick. */
function both(script, endMs) {
  const ager = new StationAger(), presence = new Presence();
  const rows = [], wasPresent = new Set();
  let heard = [];
  for (let t = 0; t <= endMs; t += STEP) {
    if (script[t]) heard = script[t];
    ager.heard(heard, t);
    for (const o of heard) presence.observe([encodeUuid({ role: 'station', id: o.id, kind: o.kind, team: o.team, threshold: o.threshold })], o.median, t);
    presence.tick(t);
    const a = ager.list(t), p = presence.stations();
    for (const e of p) if (e.ageMs === 0) { if (e.present) wasPresent.add(e.id); else wasPresent.delete(e.id); }
    assert.deepEqual(a.map(e => e.id), p.map(e => e.id), `t=${t}: the same sites, in the same order`);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].ageMs, p[i].ageMs, `t=${t} site ${a[i].id}: ageMs`);
      assert.equal(a[i].rssi, p[i].rssi, `t=${t} site ${a[i].id}: rssi`);
      // a silent site: the ager keeps the step's present, Presence keeps the present it had reached (dwell aside)
      if (p[i].ageMs > 0 && wasPresent.has(a[i].id)) assert.equal(a[i].present, p[i].present, `t=${t} site ${a[i].id}: present`);
      if (p[i].ageMs > E) assert.equal(a[i].present, false, `t=${t} site ${a[i].id}: past expiry it is not present`);
    }
    rows.push({ t, a });
  }
  return rows;
}

test('a dropped site keeps its last fields to the expiry, is listed absent to twice that, then goes', () => {
  const rows = both({ 0: [site(11)], 2000: [] }, 2000 + 2 * E + 2 * STEP);
  const at = t => rows.find(r => r.t === t).a;
  assert.deepEqual(at(2000).map(e => [e.id, e.ageMs, e.present]), [[11, 250, true]], 'silent for one step: present, ageing');
  assert.deepEqual(at(1750 + E).map(e => [e.ageMs, e.present]), [[E, true]], 'at the expiry exactly: still present');
  assert.deepEqual(at(2000 + E).map(e => [e.ageMs, e.present]), [[E + 250, false]], 'past it: listed, not present');
  assert.deepEqual(at(1750 + 2 * E).map(e => e.ageMs), [2 * E], 'at twice the expiry: still listed');
  assert.deepEqual(at(2000 + 2 * E), [], 'past twice the expiry: gone');
});

test('a site heard again is fresh, and the list is strongest first with ties in first-heard order', () => {
  const rows = both({ 0: [site(3, -60), site(4, -60), site(5, -40)], 500: [site(4, -60)], 1500: [site(3, -60), site(4, -60)] }, 2500);
  const at = t => rows.find(r => r.t === t).a.map(e => [e.id, e.ageMs]);
  assert.deepEqual(at(1250), [[5, 1000], [3, 1000], [4, 0]], 'the strongest first; equal rssi keeps first-heard order');
  assert.deepEqual(at(1500), [[5, 1250], [3, 0], [4, 0]], 'site 3 heard again: fresh');
});

// Without the opt-in the runner is unchanged; every golden trace replaying byte-identical is that guard.
