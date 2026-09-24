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

test('F348: the T-0 spawn of a Shields game starts at FULL shield (105), with no recharge and no "shields online"', () => {
  const h = harness();
  const n = h.startAt;
  h.adv(100);
  const burst = h.since(n);
  const s = burst.indexOf('$SPAWN,,*');
  assert.ok(s >= 0, 'setup: the T-0 spawn went out');
  assert.ok(burst.indexOf(FILL) > s, `the spawn burst fills the shield after $SPAWN: ${JSON.stringify(burst)}`);
  assert.equal(h.eng.shield, 105, 'the pool is full from the start of the life');
  h.adv(12000);
  assert.deepEqual(h.grants(n), [FILL], 'one fill, and no recharge grants afterwards');
  assert.equal(h.cues(n, 'shield_charging'), 0, 'no charge-up sound at spawn');
  assert.equal(h.cues(n, 'shield_online'), 0, 'a spawn is not a recharge: no SHIELDS ONLINE');
  assert.equal(h.eng.shield, 105);
});

test('F348: a timed revive starts at FULL shield too', () => {
  const h = harness();
  h.adv(5000).die();
  assert.equal(h.eng.alive, false, 'setup: down');
  h.adv(7900);
  const n = h.mark();
  h.adv(300);
  assert.equal(h.eng.alive, true, 'setup: revived by the timer');
  const burst = h.since(n);
  assert.ok(burst.indexOf(FILL) > burst.indexOf('$SPAWN,,*'), `the revive burst fills the shield: ${JSON.stringify(burst)}`);
  assert.equal(h.eng.shield, 105);
  h.adv(12000);
  assert.equal(h.cues(n, 'shield_online'), 0);
  assert.equal(h.cues(n, 'shield_charging'), 0);
  assert.equal(h.eng.shield, 105);
});

test('F348: a station revive starts at FULL shield and stays there when spawn protection ends', () => {
  const h = harness({ respawn: 'scanner' });
  h.adv(5000).die();
  h.adv(9000);
  h.eng.setStations([stationEntry()]);
  const n = h.mark();
  h.frame('$BUT,0,1,*'); h.frame('$BUT,0,0,*');
  assert.equal(h.eng.alive, true, 'setup: revived at the station');
  h.adv(100);
  assert.equal(h.eng.shield, 105, 'full at the revive');
  const p = h.mark();
  h.adv(2500);   // station protection is 2 s: t8 back to 0 and the protection light off
  const end = h.since(p);
  assert.ok(end.includes('$TMP,,,,,,,,0,,,,*'), 'setup: spawn protection ended');
  assert.deepEqual(h.grants(p), [], 'ending protection writes nothing to the pool');
  assert.equal(h.eng.shield, 105, 'the pool is still full after protection ends');
  h.adv(12000);
  assert.deepEqual(h.grants(n), [FILL], 'no recharge after it either');
  assert.equal(h.cues(n, 'shield_online'), 0);
});

test('F348 control: the Standard preset (no shield) spawns and revives exactly as before, with no pool write', () => {
  const h = harness({ health: STANDARD });
  const n = h.startAt;
  h.adv(100);
  h.adv(5000).die();
  h.adv(8300);
  assert.equal(h.eng.alive, true, 'setup: revived');
  assert.deepEqual(h.grants(n), [], 'no $LIFE grant in a game without a shield');
  assert.equal(h.eng.shield, 0);
});

test('F348 control: a shield broken in play still recharges the old way (and, Tony 2026-09-24, says no SHIELDS ONLINE)', () => {
  const h = harness();
  h.adv(3000);
  h.gun.shield = 0; h.frame('$HIR,4,0,19,2,105,0,3,*'); h.frame('$HP,45,0,0,*');
  assert.equal(h.eng.shield, 0, 'setup: the shield broke');
  const n = h.mark();
  h.adv(15000);
  assert.equal(h.eng.shield, 105, 'the recharge refilled it');
  assert.equal(h.cues(n, 'shield_charging'), 1);
  assert.equal(h.cues(n, 'shield_online'), 0, 'the shields-online line is gone (docs/announcer.md)');
});
