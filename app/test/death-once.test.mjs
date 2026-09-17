// F209 burst half (field 2026-09-13): the MC store showed five deaths and five respawns inside one second in a
// `delay_s: 5` game. One death per life, and the respawn clock runs from that death: a burst of lethal frames
// books ONE death fact, starts ONE clock, and the respawn is never earlier than the delay. The next life can die.
// Mirrors: mcp/tests/test_stage_death_once.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const DELAY = 5000;

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

function harness({ mode = 'ffa', teamFlip } = {}) {
  const writes = []; const facts = []; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode, environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: DELAY / 1000 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: f => facts.push({ ...f, at: clock }), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1', ...(teamFlip ? { team_flip: teamFlip } : {}) }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, facts,
    adv(ms, step = 250) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); eng.tick(); } return h; },
    kind(k) { return facts.filter(f => f.type === k); },
    // One lethal hit as the gun reports it: the $HIR, then $HP at zero (and an $LCD echo, which some frames carry too).
    lethal() { eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*'); eng.feedFrame('$LCD,0,0,0,0,30,90,*'); return h; },
    get clock() { return clock; },
  };
  h.adv(10); h.eng.feedFrame('$LCD,45,70,0,0,30,90,*');   // live, and the gun has confirmed the life
  assert.equal(h.eng.phase, 'live'); assert.equal(h.eng.alive, true);
  return h;
}

test('F209: a burst of lethal frames books one death and one respawn clock', () => {
  const h = harness();
  const t0 = h.clock;
  for (let i = 0; i < 5; i++) h.lethal();            // five kills in the same millisecond
  assert.equal(h.kind('death').length, 1, 'one death fact');
  assert.equal(h.eng.deaths, 1, 'one death counted');
  assert.equal(h.eng.deadAt, t0, 'the clock runs from the first death');
  h.adv(1000); h.lethal(); h.adv(2000); h.lethal();   // more lethal frames while down
  assert.equal(h.kind('death').length, 1, 'still one death while down');
  assert.equal(h.eng.deadAt, t0, 'a later lethal frame does not restart the clock');
  h.adv(DELAY - 3000 - 250);
  assert.equal(h.kind('respawn').length, 0, 'no respawn before the delay');
  h.adv(500);
  const rs = h.kind('respawn');
  assert.equal(rs.length, 1, 'one respawn');
  assert.ok(rs[0].at - t0 >= DELAY, `respawn at +${rs[0].at - t0} ms, never earlier than ${DELAY}`);
  h.adv(20000);
  assert.equal(h.kind('respawn').length, 1, 'and never a second one for the same death');
});

test('F209: the next life can die again, with its own clock', () => {
  const h = harness();
  h.lethal(); h.adv(DELAY + 250);
  assert.equal(h.eng.alive, true, 'revived');
  h.eng.feedFrame('$LCD,45,70,0,0,30,90,*');          // the gun confirms the new life
  const t1 = h.clock;
  h.lethal(); h.lethal();
  assert.equal(h.kind('death').length, 2, 'the second life dies once');
  h.adv(DELAY + 250);
  const rs = h.kind('respawn');
  assert.equal(rs.length, 2);
  assert.ok(rs[1].at - t1 >= DELAY);
});

test('F209: infection flips once per death, not once per lethal frame', () => {
  const flip = { 1: ['$TID,1,*'], 2: ['$TID,2,*'] };
  const h = harness({ mode: 'infection', teamFlip: flip });
  h.lethal(); h.lethal(); h.lethal();
  assert.equal(h.kind('death').length, 1);
  assert.equal(h.kind('team_change').length, 1, 'one flip');
});
