// The phone's powerup station against the cases it shares with the Stick firmware (A2, maintainability review
// 2026-10-03). hardware/m5sticks3/test/test_powerup_cases.cpp reads the same file, so the two cannot drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PowerupStation } from '../src/powerup.js';
import { PLAYER_STATE } from '../src/beacon.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'powerup-station-cases.json'), 'utf8'));

const toPlayer = (p) => (p.state.forEach(n => assert.ok(n in PLAYER_STATE && ['alive', 'claiming', 'claim_ready'].includes(n), `unknown player state ${n}`)), {
  role: 'player', id: p.id, value: p.value, ageMs: p.age_ms ?? 0,
  state: p.state.reduce((m, n) => m | PLAYER_STATE[n], 0),
});
const evKey = (e) => (typeof e === 'string' ? { type: e } : e);

for (const c of FIXTURE.cases) {
  if (c.only && !c.only.includes('phone')) continue;
  test(`powerup cases: ${c.name}`, () => {
    const item = c.setup.spawn_every_s ? { spawn_every_s: c.setup.spawn_every_s } : null;
    const s = new PowerupStation({ id: c.setup.id, item });
    for (const step of c.steps) {
      let events = [];
      if (step.do === 'update') s.update(step.body, step.t);
      else if (step.do === 'tick') events = s.tick((step.players || []).map(toPlayer), step.t).events;
      else if (step.do !== 'advance') assert.fail(`unknown step ${step.do}`);
      const at = `t=${step.t} ${step.do}`;
      if (step.expect && step.expect.advert) assert.deepEqual(s.advert(step.t), step.expect.advert, at);
      if (step.expect && step.expect.events) assert.deepEqual(events, step.expect.events.map(evKey), `${at} events`);
    }
  });
}
