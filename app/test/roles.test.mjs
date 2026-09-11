// A19 / S10 — a held headset ROLE named by MC reaches `_setRole` through `alert.role`.
//
// The node's role mechanism (A16 §3.3) was general and wired for `carrier` (objective alerts) and `infected`
// (the death/team_flip path); `vip` / `beacon` / `extracted` had no signal that reached the node. MC now sends
// `alert{kind:'role', role:{name, on, tid?}}`. These tests pin the node half: the role is painted from THIS
// bundle's `headset.role` table and held in `_activeRole`; an unknown name is logged and ignored (CONTROL);
// a body without `role` changes nothing (CONTROL); and `on:false` ends only the role that is active.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

const VIP = '$HLED,5,0,,,10,,*';        // distinct from rest / hit / carrier so a paint is unambiguous
const BEACON = '$HLED,8,2,300,300,10,200,*';

function live() {
  const writes = []; const logs = []; let clock = 1_000_000;
  const eng = new Engine({ writer: f => writes.push(...f), emit: () => {}, report: () => {}, now: () => clock, synced: () => true,
    storage: mkStorage(), log: (m, l) => logs.push([m, l]), delay: (ms, fn) => fn() });
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'indoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const bundle = { ...golden, player_id: 'p1', headset: { ...golden.headset, hit: [], role: { ...golden.headset.role, vip: [[VIP, 0]], beacon: [[BEACON, 0]] } } };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team, roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick(); eng.feedFrame('$LCD,45,70,0,0,36,216,*');
  assert.equal(eng.phase, 'live');
  const alert = body => eng.onMcMessage({ kind: 'alert', body: { kind: 'role', text: 'X', player_id: 'p1', t: clock, ...body }, t: clock });
  return { eng, writes, logs, alert, adv: ms => { clock += ms; } };
}

test('A19 role: alert.role {vip, on} paints this bundle\'s vip frame and holds the role', () => {
  const h = live();
  h.writes.length = 0;
  h.alert({ role: { name: 'vip', on: true } });
  assert.ok(h.writes.includes(VIP), 'the vip frame from headset.role is written');
  assert.deepEqual(h.eng._activeRole, { name: 'vip', tid: null });
  assert.equal(h.eng.moment && h.eng.moment.kind, 'alert', 'the HUD banner shows the role text');
  // the role survives a hit exactly like the carrier blink (A16 §3.3) -- proves it went through _setRole, not a one-off paint
  h.writes.length = 0; h.adv(1100);
  h.eng.feedFrame('$HIR,4,0,19,2,9,0,0,*'); h.eng.feedFrame('$HP,45,61,0,*');
  assert.ok(h.writes.includes(VIP), 're-asserted after the hit');
});

test('A19 role: a tid-keyed role takes its tid, and on:false ends only the active role', () => {
  const h = live();
  h.alert({ role: { name: 'carrier', on: true, tid: 2 } });
  assert.deepEqual(h.eng._activeRole, { name: 'carrier', tid: 2 });
  assert.equal(h.eng.carrying, 2, 'the pre-A16 carrying field stays in sync');
  // CONTROL: ending a role that is NOT the active one is a no-op (a stale off must not clobber a newer role)
  h.writes.length = 0;
  h.alert({ role: { name: 'vip', on: false } });
  assert.deepEqual(h.eng._activeRole, { name: 'carrier', tid: 2 });
  assert.equal(h.writes.length, 0);
  // ending the active one returns the headset to rest
  h.alert({ role: { name: 'carrier', on: false } });
  assert.equal(h.eng._activeRole, null);
  assert.ok(h.writes.includes(h.eng.frames.headset.rest), 'back to rest');
  // a new role simply supersedes the old (at most one held)
  h.alert({ role: { name: 'vip', on: true } });
  h.alert({ role: { name: 'beacon', on: true } });
  assert.deepEqual(h.eng._activeRole, { name: 'beacon', tid: null });
});

test('A19 role CONTROL: an unknown role name is logged and ignored; a body with no role changes nothing', () => {
  const h = live();
  h.alert({ role: { name: 'vip', on: true } });
  h.writes.length = 0; h.logs.length = 0;
  h.alert({ role: { name: 'king', on: true } });
  assert.deepEqual(h.eng._activeRole, { name: 'vip', tid: null }, 'the held role is untouched');
  assert.ok(!h.writes.some(f => f.startsWith('$HLED')), 'nothing painted for a name the lamp cannot express');
  assert.ok(h.logs.some(([m]) => /alert role king unknown/.test(m)), 'the ignore is logged, not silent');
  // a role-less alert (every pre-A19 kind) leaves the role alone
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'lead_taken', text: 'LEAD', player_id: 'p1', t: h.eng.now() }, t: h.eng.now() });
  assert.deepEqual(h.eng._activeRole, { name: 'vip', tid: null });
  // a role the bundle has no sequence for (headset.role switched off) is not held either
  h.eng.frames.headset = { ...h.eng.frames.headset, role: {} };
  h.alert({ role: { name: 'extracted', on: true } });
  assert.deepEqual(h.eng._activeRole, { name: 'vip', tid: null });
});

test('A19 role CONTROL: dropped before the match like every alert, and cleared by death like every role', () => {
  const h = live();
  h.alert({ role: { name: 'vip', on: true } });
  h.eng.feedFrame('$HIR,4,0,19,2,60,0,0,*'); h.eng.feedFrame('$HP,0,0,0,*');
  assert.equal(h.eng._activeRole, null, 'death clears the role on the node (MC re-sends after the respawn)');
  // a stale alert (older than FEEDBACK_MAX_AGE_MS) is ignored like any other
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'role', text: 'X', player_id: 'p1', t: h.eng.now() - 60_000, role: { name: 'vip', on: true } }, t: h.eng.now() - 60_000 });
  assert.equal(h.eng._activeRole, null);
});
