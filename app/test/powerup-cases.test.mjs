// The phone's powerup station against the cases it shares with the Stick firmware (A2, maintainability review
// 2026-10-03). hardware/m5sticks3/test/test_powerup_cases.cpp reads the same file, so the two cannot drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PowerupStation, PowerupFollower } from '../src/powerup.js';
import { PLAYER_STATE } from '../src/beacon.js';
import { ADVERT_SCOPE_KIND, ADVERT_SCOPE_ID_BITS, PRESENCE_EXPIRY_MS } from '../src/transport/contract.gen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'powerup-station-cases.json'), 'utf8'));

// A86: a player's scope defaults to one that names this station (the powerup bit and its id bit); `scope_kinds` and
// `scope_stations` override it ([] and [] = a zero scope, an older APK). `game` defaults to 0 (any).
const toPlayer = (c) => (p) => (p.state.forEach(n => assert.ok(n in PLAYER_STATE && ['alive', 'claiming', 'claim_ready', 'live'].includes(n), `unknown player state ${n}`)), {
  role: 'player', id: p.id, value: p.value, ageMs: p.age_ms ?? 0, game: p.game ?? 0,
  state: p.state.reduce((m, n) => m | PLAYER_STATE[n], 0),
  scopeKinds: (p.scope_kinds ?? ['powerup']).reduce((m, n) => { assert.ok(n in ADVERT_SCOPE_KIND, `unknown scope kind ${n}`); return m | ADVERT_SCOPE_KIND[n]; }, 0),
  scope: (p.scope_stations ?? [c.setup.id]).reduce((m, id) => m | (1 << (id % ADVERT_SCOPE_ID_BITS)), 0),
});
const evKey = (e) => (typeof e === 'string' ? { type: e } : e);

for (const c of FIXTURE.cases) {
  if (c.only && !c.only.includes('phone')) continue;
  test(`powerup cases: ${c.name}`, () => {
    const item = c.setup.spawn_every_s ? { spawn_every_s: c.setup.spawn_every_s, ...(c.setup.first_at_s != null ? { first_at_s: c.setup.first_at_s } : {}) } : null;
    let s = new PowerupStation({ id: c.setup.id, item });
    // F658: a `follow` case runs the station as utility.js does, its PowerupFollower first on every tick
    let f = new PowerupFollower();
    let armed = c.setup.armed_game || 0;
    const follow = !!c.setup.follow;
    for (const step of c.steps) {
      let events = [];
      if (step.do === 'update') { if (follow) f.noteMc(armed, step.body, step.t); if (!follow || f.acceptsMc(armed)) s.update(step.body, step.t); }
      else if (step.do === 'arm') armed = step.game;   // F658: MC's next station_config; a following station keeps its item
      else if (step.do === 'tick') {
        const players = (step.players || []).map(toPlayer(c));
        if (follow) f.step(s, players, step.t, { expiryMs: PRESENCE_EXPIRY_MS, armedGame: armed, stationId: c.setup.id });
        events = s.tick(players, step.t).events;
      } else if (step.do === 'restart') {   // utility.js: both saved to localStorage and restored on load
        const snap = JSON.parse(JSON.stringify(s.snapshot())), fsnap = JSON.parse(JSON.stringify(f.snapshot()));
        s = new PowerupStation({ id: c.setup.id, item }).restore(snap); f = new PowerupFollower().restore(fsnap);
      } else if (step.do !== 'advance') assert.fail(`unknown step ${step.do}`);
      const at = `t=${step.t} ${step.do}`;
      if (step.expect && step.expect.advert) assert.deepEqual(s.advert(step.t), step.expect.advert, at);
      if (step.expect && step.expect.events) assert.deepEqual(events, step.expect.events.map(evKey), `${at} events`);
      if (step.expect && step.expect.follows != null) assert.equal(f.follows, step.expect.follows, `${at} follows`);
      if (step.expect && step.expect.game != null) assert.equal(f.game(armed), step.expect.game, `${at} game`);
    }
  });
}
