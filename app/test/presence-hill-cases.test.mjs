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

// A fixture shape error is a plain Error, never an AssertionError, so a known_fail case can never swallow it.
const stateByte = (names) => names.reduce((m, n) => { if (!(n in PLAYER_STATE)) throw new Error(`unknown player state ${n}`); return m | PLAYER_STATE[n]; }, 0);
const hillByte = (names) => names.reduce((m, n) => { if (!(n in CONTROL_STATE)) throw new Error(`unknown hill state ${n}`); return m | CONTROL_STATE[n]; }, 0);

/** The sightings of a case in time order: its explicit `sightings`, then each `series` expanded. */
export function expandSightings(c) {
  const out = (c.sightings || []).map(s => ({ ...s }));
  for (const s of c.series || []) {
    for (let k = 0, t = s.from_ms; t <= s.to_ms; k++, t = s.from_ms + k * s.every_ms) out.push({ t, id: s.id, rssi: s.rssi[k % s.rssi.length] });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Structure a runner must reject, whatever the rules say: a checkpoint off the tick grid, past until_ms, repeated, or naming a player the case does not have. */
function validate(c) {
  const seen = new Set();
  for (const k of ['decay_s', 'decay_delay_ms']) assert.ok(Number.isFinite(c.setup[k]), `setup.${k} must be set: every runner reads it from the setup`);
  for (const p of Object.values(c.players)) stateByte(p.state);
  if (c.known_fail) {
    assert.ok(typeof c.known_fail.why === 'string' && /^F\d+/.test(c.known_fail.why), 'known_fail.why must start with a follow-up id');
    assert.ok(Array.isArray(c.known_fail.at) && c.known_fail.at.length, 'known_fail.at must list the checkpoints expected to fail');
    for (const t of c.known_fail.at) assert.ok((c.expect || []).some(e => e.t === t), `known_fail.at names t=${t}, which is not a checkpoint`);
  }
  for (const e of c.expect || []) {
    assert.ok(e.t <= c.until_ms && e.t % c.setup.tick_ms === 0, `checkpoint t=${e.t} must be a tick time within until_ms`);
    assert.ok(!seen.has(e.t), `duplicate checkpoint t=${e.t}`);
    seen.add(e.t);
    if (e.hill) hillByte(e.hill.state);
    for (const id of (e.same_in || [])) assert.ok(id in c.players, `checkpoint t=${e.t} same_in names player ${id}, which the case does not have`);
    for (const id of [...Object.keys(e.in || {}), ...Object.keys(e.present || {})]) assert.ok(id in c.players, `checkpoint t=${e.t} names player ${id}, which the case does not have`);
  }
}

/** Runs a case. With `collect`, a checkpoint whose assertions fail is recorded (its t) instead of thrown; returns those t's. */
function runCase(c, collect = false) {
  const failed = [];
  const s = c.setup;
  const presence = new Presence({ defaultThreshold: s.threshold_dbm, dwellMs: s.dwell_ms, hysteresisDb: s.exit_band_db,
    exitGraceMs: s.exit_grace_ms, expiryMs: s.expiry_ms, sightMs: s.sight_ms, alpha: s.alpha });
  const point = new ControlPoint({ captureS: s.capture_s, netCap: s.net_cap, decayS: s.decay_s, decayDelayMs: s.decay_delay_ms });
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
    const check = () => {
      const at = `t=${t}`;
      const inCircle = (id) => { const e = presence.players().find(x => x.id === +id); return !!(e && e.inCircle); };
      for (const [id, want] of Object.entries(ex.in || {})) assert.equal(inCircle(id), want, `${at} player ${id} in the circle`);
      if (ex.same_in) assert.deepEqual(ex.same_in.map(inCircle), ex.same_in.map(() => inCircle(ex.same_in[0])), `${at} players ${ex.same_in} must give the same answer`);
      for (const [id, want] of Object.entries(ex.present || {})) {
        const e = presence.players().find(x => x.id === +id);
        assert.equal(!!(e && e.present), want, `${at} player ${id} present`);
      }
      if (ex.hill) assert.deepEqual(adv, { team: ex.hill.team, state: hillByte(ex.hill.state), value: ex.hill.value }, `${at} hill advert`);
    };
    if (!collect) check();
    else try { check(); } catch (e) { if (!(e instanceof assert.AssertionError)) throw e; failed.push(t); }
  }
  return failed;
}

for (const c of FIXTURE.cases) {
  if (c.only && !c.only.includes('phone')) continue;
  test(`presence/hill cases: ${c.name}${c.known_fail ? ' [KNOWN FAIL]' : ''}`, () => {
    validate(c);
    if (!c.known_fail) { runCase(c); return; }
    // A known failure states the rule and names the checkpoints that fail today. EXACTLY those must fail and every
    // other checkpoint must pass. When a fix makes a named one pass, this test fails and says so, so the label cannot
    // outlive the bug; a shape error in the fixture is thrown by validate()/runCase() and is never excused.
    const failed = runCase(c, true);
    const want = [...c.known_fail.at].sort((a, b) => a - b);
    const stillFailing = want.filter(t => failed.includes(t));
    const nowPass = want.filter(t => !failed.includes(t));
    const unexpected = failed.filter(t => !want.includes(t));
    assert.deepEqual(unexpected, [], `checkpoints ${unexpected} fail but known_fail.at does not name them`);
    assert.deepEqual(nowPass, [], `known_fail "${c.known_fail.why}": checkpoint(s) ${nowPass} now PASS on the phone: remove known_fail (or those t's) from this case`);
    assert.ok(stillFailing.length > 0);
  });
}
