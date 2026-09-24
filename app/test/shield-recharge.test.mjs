// F349: the shield RECHARGE feel (Tony, live match 2026-09-24, app 0.4.11): "the hud animation is kinda chunky",
// "it makes the sound like shields are full" before the pool is, and "shields online" came 3-4 s after the HUD
// showed full (and on the second phone not at all).
//  - Fewer, larger grants: a full pool in SHIELD_REGEN_GRANTS writes, and no readout animation or blink writes on
//    the gun while a recharge runs, so the BLE queue holds nothing in front of SHIELDS ONLINE.
//  - The phone's shield meter draws the recharge from the engine's own start and rate (`state().shieldRegen`).
//
// (The F348 header below is kept from the harness this file shares.)
// F348: the Shields preset spawns at FULL shield (Tony, live match 2026-09-24, app 0.4.11: "after spawn and after you
// are vulnerable then they power up. you can die from a couple hits right after spawn"). Halo's rule: every life
// starts with the shield up.
//
// On hardware `$SPAWN` leaves the shield POOL at 0 ($PSET t5 is a ceiling, never a starting value; bench 2026-08-27,
// and the field read-back `$LIFE,0,0,0,*` -> `$HP,45,0,0,*`). So the node writes one additive `$LIFE,0,0,<max>,*`
// at the end of every spawn and revive burst (the T-0 spawn, a timed revive, a station revive) in a shields game,
// and the pool is full from the first frame of the life. Ending spawn PROTECTION (t8 back to 0 and the headset
// protection light off) never touches the pool.
//
// "Shield" has two meanings in this file's neighbourhood: the shield POOL (`$PSET` t5, `$HP` t3), and the station's
// spawn-protection LIGHT (`respawn_profile.shield_on/shield_off`, a headset blink). These tests are about the POOL.
//
// Mirrors: mcp/tests/test_stage_mirror.py (the stage predicts this phone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, isPoolProbe } from '../src/engine.js';
import * as E from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const SHIELDS = { max_hp: 45, max_armor: 0, max_shield: 105 };   // compile.HEALTH_PRESETS['shields']
const STANDARD = { max_hp: 45, max_armor: 70, max_shield: 0 };
const FILL = '$LIFE,0,0,105,*';

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
/** Every `$PSET` the bundle carries, at THIS game's pools (the node reads its ceilings off the compiled head). */
function atPools(bundle, h) {
  const fix = f => (typeof f === 'string' && f.startsWith('$PSET,')
    ? f.split(',').map((tok, i) => (i === 3 ? String(h.max_hp) : i === 4 ? String(h.max_armor) : i === 5 ? String(h.max_shield) : tok)).join(',') : f);
  return { ...bundle, head: bundle.head.map(fix), pset_pool: (bundle.pset_pool || []).map(fix) };
}

function harness({ health = SHIELDS, respawn = 'auto' } = {}) {
  const writes = []; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const bundle = atPools(golden, health);
  const config = { config_id: bundle.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: respawn, delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: () => {}, report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  // The gun's side of every pool write: a `$SPAWN` empties the shield, a `$LIFE` grant adds and clamps, and the
  // gun answers the grant with `$HP` (bench 2026-09-09). Played after each tick, so the node sees what a real gun says.
  const gun = { hp: 0, armor: 0, shield: 0, seen: 0 };
  const answer = () => {
    while (gun.seen < writes.length) {
      const f = writes[gun.seen++];
      if (f === '$SPAWN,,*') { gun.hp = health.max_hp; gun.armor = health.max_armor; gun.shield = 0; }
      else if (f.startsWith('$LIFE,') && !isPoolProbe(f)) {
        const t = f.split(',');
        gun.shield = Math.max(0, Math.min(health.max_shield, gun.shield + (+t[3] || 0)));
        eng.feedFrame(`$HP,${gun.hp},${gun.armor},${gun.shield},*`);
      }
    }
  };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  const h = {
    eng, writes, gun,
    adv(ms, step = 50) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); eng.tick(); answer(); } return h; },
    frame(f) { eng.feedFrame(f); answer(); return h; },
    mark() { return writes.length; },
    since(n) { return writes.slice(n); },
    cues(n, key) { const f = bundle.cues[key]; return h.since(n).filter(w => w === f).length; },
    grants(n) { return h.since(n).filter(w => w.startsWith('$LIFE,') && !isPoolProbe(w)); },
    die() { h.frame('$HIR,4,0,19,2,9,0,3,*'); gun.hp = 0; gun.armor = 0; gun.shield = 0; h.frame('$HP,0,0,0,*'); return h; },
  };
  h.startAt = writes.length;
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: bundle.config_id, seq: 1, countdown_s: 0 } });
  answer();
  return h;
}
const stationEntry = () => ({ role: 'station', id: 5, kind: 'respawn', team: 1, state: 1, value: 0, seq: 0, game: 0, threshold: -60, rssi: -50, raw: -50, present: true });


/** A shields game, live, full from its spawn, with the shield then broken by a hit. Returns the write mark. */
function broken() {
  const h = harness();
  h.adv(3000);
  assert.equal(h.eng.shield, 105, 'setup: full from the spawn (F348)');
  h.gun.shield = 0; h.frame('$HIR,4,0,19,2,105,0,3,*'); h.frame('$HP,45,0,0,*');
  assert.equal(h.eng.shield, 0, 'setup: broken');
  return h;
}
const isReadout = f => f.startsWith('$GLED,');

test('F349: a full recharge stays inside its BLE write budget: a few large grants, no readout animation on the gun', () => {
  const h = broken();
  const n = h.mark();
  h.adv(14000);
  const w = h.since(n);
  const c = w.indexOf(golden.cues.shield_charging), o = w.findIndex(f => f.includes('VA6Y'));
  assert.ok(c >= 0 && o > c, `setup: the recharge ran, charging then online: ${JSON.stringify(w)}`);
  const during = w.slice(c, o + 1);
  const budget = E.SHIELD_REGEN_WRITE_BUDGET ?? 6;
  assert.ok(during.length <= budget, `the recharge wrote ${during.length} frames (budget ${budget}): ${JSON.stringify(during)}`);
  assert.deepEqual(during.filter(isReadout), [], 'no readout step or blink while the recharge runs');
  assert.equal(h.eng.shield, 105);
});

test('F349: every regen grant is a silent pool write: `$LIFE,0,0,<step>,*` with no sound token', () => {
  const h = broken();
  const n = h.mark();
  h.adv(14000);
  const grants = h.grants(n);
  assert.ok(grants.length >= 1 && grants.length <= 4, `setup: a few grants: ${JSON.stringify(grants)}`);
  for (const g of grants) assert.match(g, /^\$LIFE,0,0,\d+,\*$/, 'a `$LIFE` carries no sound id (a `$BUMP` would: token 5)');
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$BUMP')), [], 'no `$BUMP` at all');
});

test('F349: the engine publishes the recharge start and rate, so the phone can draw it smoothly', () => {
  const h = broken();
  h.adv(6600);
  const sr = h.eng.state().shieldRegen;
  assert.equal(sr.charging, true, 'setup: charging');
  assert.equal(typeof sr.startedAt, 'number');
  assert.equal(sr.from, 0);
  assert.ok(sr.fullAt > sr.startedAt, `a predicted full time: ${JSON.stringify(sr)}`);
  assert.ok(sr.step > 0, 'the grant size');
});

test('F349: the meter draws the recharge as a line from the engine clock, never a grant ahead of the gun', async () => {
  const { meterModel } = await import('../src/hud/shieldmeter.js');
  const sr = { on: true, charging: true, down: false, gaveUp: false, paused: false, delayMs: 6500, quietAt: 0, startedAt: 10_000, from: 0, step: 27, fullAt: 13_000 };
  const at = (now, shield) => meterModel({ phase: 'live', alive: true, shield, maxShield: 105, shieldRegen: sr }, now).fill;
  const xs = [10_000, 10_500, 11_000, 11_500, 12_000, 12_500, 13_000].map((t, i) => at(t, Math.min(105, 27 * (1 + Math.floor(i / 2)))));
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `the fill rises every sample: ${xs.join(', ')}`);
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  assert.ok(Math.max(...steps) - Math.min(...steps) < 0.02, `and at an even rate, not in grant-sized jumps: ${steps.join(', ')}`);
  assert.ok(at(12_900, 27) <= (27 + 27) / 105 + 1e-9, 'a slow link holds the bar one grant above what the gun reported');
  assert.equal(meterModel({ phase: 'live', alive: true, shield: 60, maxShield: 105, shieldRegen: { ...sr, charging: false } }, 11_000).fill, 60 / 105, 'at rest the fill is the pool');
});
