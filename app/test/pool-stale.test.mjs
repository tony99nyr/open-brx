// F208 (field 2026-09-13, 18:47:34): ROCCO's status stayed byte-identical for 105 s while the HUD held him alive.
// The link was up the whole time ($BUT pairs and a $VOLTS arrived), so "any frame" was never the signal: the
// trigger was pulled and no shot came back. The node now says when its pool is stale, on engine state and in
// the status heartbeat, and a healthy idle gun (a $VOLTS every ~60 s, sometimes one missed) never trips it.
// Mirrors: mcp/tests/test_stage_pool_stale.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';

const { Engine } = E;
const QUIET = E.GUN_QUIET_STALE_MS ?? 185000;   // `??` so this file loads (and fails) against an engine without F208
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const VOLTS = '$VOLTS,8428,4164,100,100,*';

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

function harness() {
  let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }];
  const config = { config_id: golden.config_id, mode: 'ffa', environment: 'outdoor', night: false, time_limit_s: 1800,
    respawn: { type: 'auto', delay_s: 15 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'ROCCO', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: () => {}, emit: () => {}, report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng,
    adv(ms, step = 250) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); eng.tick(); } return h; },
    f(fr) { eng.feedFrame(fr); return h; },
    shot(mag) { return h.f('$BUT,0,1,*').f(`$ALCD,${mag},100,0,192,0,*`).adv(200).f('$BUT,0,0,*'); },
    dryPull() { return h.f('$BUT,0,1,*').adv(200).f('$BUT,0,0,*').adv(1800); },
    stale() { return eng.state().poolStale; },
    status() { return eng.statusBody(); },
  };
  h.adv(10);
  h.f('$LCD,45,70,0,0,30,90,*').adv(3000).shot(29);   // live, the gun has spoken, one shot fired
  assert.equal(eng.phase, 'live'); assert.equal(eng.alive, true);
  return h;
}

test('F208 not stale: a healthy idle gun that sends only $VOLTS, with one sample missed, for ten minutes', () => {
  const h = harness();
  for (let i = 0; i < 10; i++) {
    h.adv(i === 4 ? 120300 : 60150);                    // ~60 s cadence; sample 4 went missing (120.3 s, 2026-08-23 capture)
    assert.equal(h.stale(), null, `idle minute ${i}, just before the $VOLTS`);
    h.f(VOLTS);
  }
  h.adv(QUIET - 1000);
  assert.equal(h.stale(), null, 'still fresh just under the quiet threshold');
  assert.equal('pool_stale' in h.status(), false, 'the heartbeat makes no claim');
});

test('F208 not stale: a firing gun, a dry magazine, a reload and a charge-style late shot', () => {
  const h = harness();
  for (let i = 28; i > 20; i--) h.adv(2000).shot(i);
  assert.equal(h.stale(), null, 'every pull answered');
  h.f('$ALCD,0,100,0,192,0,*');                         // the magazine runs dry
  for (let i = 0; i < 5; i++) h.dryPull();
  assert.equal(h.stale(), null, 'an empty magazine dry-fires: no shot is owed');
  h.f('$ALCD,10,70,0,192,0,*');                        // back in the fight, then the handle: reloading
  h.f('$BUT,2,1,*').adv(100).f('$BUT,2,0,*');
  assert.ok(h.eng.reloading, 'setup: a reload is running');
  for (let i = 0; i < 3; i++) h.f('$BUT,0,1,*').adv(100).f('$BUT,0,0,*').adv(100);   // pulls during the reload owe no shot
  h.adv(1600);
  assert.equal(h.eng._noFirePulls, 0, 'no pull counted while reloading');
  h.f('$ALCD,30,70,0,192,0,*');
  h.f('$BUT,0,1,*').adv(1600).f('$BUT,0,0,*').adv(400).f('$ALCD,29,70,0,192,0,*');   // a held pull whose shot comes late
  h.dryPull();
  assert.equal(h.stale(), null, 'a late shot resets the count; one unanswered pull is not enough');
});

test('F208 not stale: a dead player pulling the trigger owes no shot', () => {
  const h = harness();
  h.f('$HIR,4,0,19,2,9,0,3,*').f('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false);
  for (let i = 0; i < 5; i++) h.dryPull();
  assert.equal(h.stale(), null);
});

test('F208 not stale (match 592e444eff, bench 2026-09-17): OVERHEAT-locked pulls owe no shot', () => {
  // The 02dd94 log: heat rose 55 -> 108 across five shots, then ten $BUT pulls with no $ALCD at all --
  // and the engine still logged "gun not firing... the pool is stale" at pull 3, a false positive. The
  // gun refusing to fire past HEAT_LOCKOUT is the mechanic working, not a stale pool.
  const h = harness();
  h.f('$ALCD,3,100,0,192,108,*');
  assert.equal(h.eng.state().overheating, true, 'setup: overheating');
  for (let i = 0; i < 5; i++) h.dryPull();
  assert.equal(h.stale(), null, 'overheat-locked pulls must never book a stale pool');
  assert.equal(h.eng._noFirePulls, 0, 'and must never even be counted towards it');
  h.f('$ALCD,3,100,0,192,0,*');                          // the gun cools (or a reload clears heat)
  assert.equal(h.eng.state().overheating, false, 'setup: cooled');
  h.dryPull(); h.dryPull();
  assert.equal(h.stale(), null, 'two unanswered pulls, cooled, are not yet a claim');
  h.dryPull();
  const s = h.stale();
  assert.equal(s && s.why, 'no_fire', 'once cooled, three REAL unanswered pulls still book stale -- the exemption must not leak past the lockout');
});

test('F208 stale (no_fire): the 2026-09-13 replay, pulls and a $VOLTS but no shot', () => {
  const h = harness();
  h.adv(30000);
  h.dryPull(); h.f(VOLTS); h.dryPull();
  assert.equal(h.stale(), null, 'two unanswered pulls are not yet a claim');
  h.dryPull();
  const s = h.stale();
  assert.equal(s && s.why, 'no_fire', 'three unanswered pulls in a row: the pool is stale');
  assert.ok(s.ms >= 36000, `ms since the last pool report (${s.ms})`);
  const st = h.status();
  assert.equal(st.pool_stale, 'no_fire'); assert.equal(st.pool_stale_ms, s.ms);
  h.f('$HP,0,0,0,*');                                   // the gun finally reports: dead
  assert.equal(h.stale(), null, 'a pool report clears it');
});

test('F208 stale (silent): nothing at all from the gun past the quiet threshold, cleared by any frame', () => {
  const h = harness();
  h.adv(QUIET + 250);
  const s = h.stale();
  assert.equal(s && s.why, 'silent');
  assert.equal(h.status().pool_stale, 'silent');
  h.f(VOLTS);
  assert.equal(h.stale(), null, 'any frame proves the link');
  h.eng.onBleDropped();
  h.adv(QUIET + 250);
  assert.equal(h.stale(), null, 'a dropped link is its own state, not a stale pool');
});
