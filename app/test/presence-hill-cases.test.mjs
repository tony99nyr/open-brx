// The phone's presence tracker and hill against the cases it shares with the Stick firmware and the stage
// (architecture review 2026-10-04, item 3). hardware/m5sticks3/test/test_presence_cases.cpp and
// mcp/tests/test_presence_hill_cases.py read the same file, so F440's fairness rules have ONE statement.
// Set CASES_TRACE=1 to print what every tick did (for writing a new case).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Presence, PLAYER_STATE, encodeUuid } from '../src/beacon.js';
import { ControlPoint, CONTROL_STATE } from '../src/control.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'presence-hill-cases.json'), 'utf8'));

const stateByte = (names) => names.reduce((m, n) => { assert.ok(n in PLAYER_STATE, `unknown player state ${n}`); return m | PLAYER_STATE[n]; }, 0);
const hillByte = (names) => names.reduce((m, n) => { assert.ok(n in CONTROL_STATE, `unknown hill state ${n}`); return m | CONTROL_STATE[n]; }, 0);

/** The sightings of a case in time order: its explicit `sightings`, then each `series` expanded. */
export function expandSightings(c) {
  const out = (c.sightings || []).map(s => ({ ...s }));
  for (const s of c.series || []) {
    for (let k = 0, t = s.from_ms; t <= s.to_ms; k++, t = s.from_ms + k * s.every_ms) out.push({ t, id: s.id, rssi: s.rssi[k % s.rssi.length] });
  }
  return out.sort((a, b) => a.t - b.t);
}

for (const c of FIXTURE.cases) {
  if (c.only && !c.only.includes('phone')) continue;
  test(`presence/hill cases: ${c.name}`, () => {
    const s = c.setup;
    const presence = new Presence({ defaultThreshold: s.threshold_dbm, dwellMs: s.dwell_ms, hysteresisDb: s.exit_band_db,
      exitGraceMs: s.exit_grace_ms, expiryMs: s.expiry_ms, sightMs: s.sight_ms, alpha: s.alpha });
    const point = new ControlPoint({ captureS: s.capture_s, netCap: s.net_cap });
    const sightings = expandSightings(c);
    const expects = new Map((c.expect || []).map(e => [e.t, e]));
    let next = 0;
    for (let t = 0; t <= c.until_ms; t += s.tick_ms) {
      while (next < sightings.length && sightings[next].t <= t) {
        const h = sightings[next++];
        const p = c.players[String(h.id)];
        presence.observe([encodeUuid({ role: 'player', id: h.id, team: p.team, state: stateByte(p.state) })], h.rssi, h.t);
      }
      presence.tick(t);
      point.update(presence.players(), t);
      const adv = point.advert();
      if (process.env.CASES_TRACE) {
        const ins = presence.players().map(e => `${e.id}:${e.inCircle ? 'IN' : 'out'}${e.present ? '+P' : ''}`).join(' ');
        console.log(`${c.name} t=${t} ${ins} hill team=${adv.team} state=${adv.state} value=${adv.value}`);
      }
      const ex = expects.get(t);
      if (!ex) continue;
      const at = `t=${t}`;
      for (const [id, want] of Object.entries(ex.in || {})) {
        const e = presence.players().find(x => x.id === +id);
        assert.equal(!!(e && e.inCircle), want, `${at} player ${id} in the circle`);
      }
      for (const [id, want] of Object.entries(ex.present || {})) {
        const e = presence.players().find(x => x.id === +id);
        assert.equal(!!(e && e.present), want, `${at} player ${id} present`);
      }
      if (ex.hill) assert.deepEqual(adv, { team: ex.hill.team, state: hillByte(ex.hill.state), value: ex.hill.value }, `${at} hill advert`);
    }
    for (const e of c.expect || []) assert.ok(e.t <= c.until_ms && e.t % s.tick_ms === 0, `checkpoint t=${e.t} must be a tick time within until_ms`);
  });
}
