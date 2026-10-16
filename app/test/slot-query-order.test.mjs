import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';
import { mkStorage } from './_helpers.mjs';
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
function harness() {
  const writes = []; const reports = []; const q = []; let hold = false; let clock = 1_000_000;
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] }, voice: 'male' };
  const team = config.teams[0];
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }];
  const writer = (fr, why, o) => {
    if (String(why).startsWith('gun liveness probe')) return false;
    if (!hold) { writes.push(...fr); if (o?.onStart) o.onStart(); return true; }
    return new Promise(res => q.push(() => { writes.push(...fr); if (o?.onStart) o.onStart(); res(true); }));
  };
  const eng = new Engine({ writer, emit: () => {}, report: (k, b) => reports.push({ k, b }), now: () => clock, synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn() });
  const api = { eng, writes, reports, q, setHold: v => { hold = v; }, flush: () => { while (q.length) q.shift()(); }, adv: t => { clock += t; },
    frame: f => eng.feedFrame(f) };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team, roster } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1' }, roster } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*'); clock += 1600; eng.tick(); eng.feedFrame('$QUERY,7,1,45,70,0,,1,0,,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  eng.tick(); eng.feedFrame('$LCD,45,70,0,0,32,384,*');
  return api;
}

// F542 review: a `$LIFE` probe asked while a `$QUERY` waits in the write queue must keep its own `$HP` reply. The
// query's start-up used to mark `$HP` as already seen, so the spawn read-back's answer was taken as unsolicited and
// the F341 pool check stayed open until the next solicited read (up to 20 s).
test('F542 review: a spawn read-back asked behind a queued slot query still gets its $HP as the answer', () => {
  const h = harness();
  h.eng._probedLife = null; h.adv(3000);
  h.setHold(true);
  assert.equal(h.eng._askSlot('ALT slot confirmation', () => {}, () => {}), true, 'setup: the slot query is queued');
  h.eng._spawnProbeTick(h.eng.now());
  assert.ok(h.eng._poolCheck, 'setup: the read-back went out and waits for its answer');
  h.flush(); h.adv(20); h.frame('$LCD,45,70,0,1,32,384,*'); h.adv(10); h.frame('$HP,45,70,0,*');
  assert.equal(h.eng._poolCheck, null, 'the $HP answered the read-back');
});

