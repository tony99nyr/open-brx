// The HUD skin is each player's own (Tony, bench 2026-09-17). NIGHT OPS (`config.night`) dims the gun and headset
// LEDs; on the phone it only sets the default skin at ARMED/LIVE, for a player who has not picked one in this MC
// session. A pick lasts for the MC session: across matches and app restarts. A fresh MC session lets NIGHT OPS lead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
function mkStorage() { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
const cfg = night => ({ config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night, time_limit_s: 600,
  respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams });

function harness({ storage = mkStorage(), session = 's1' } = {}) {
  let clock = 1_000_000; let seq = 0;
  const eng = new Engine({ writer: () => {}, emit: () => {}, report: () => {}, now: () => clock, synced: () => true,
    storage, log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  const h = { eng, storage, session };
  eng.sessionOf = () => h.session;
  h.persisted = null;
  eng.persistedSessionOf = () => h.persisted;
  h.adv = ms => { clock += ms; eng.tick(); return h; };
  h.join = () => {
    eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
    eng.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' }, team: teams[0], roster: [] } });
    return h;
  };
  h.config = night => { eng.onMcMessage({ kind: 'config', body: { config: cfg(night), frames: { ...golden, player_id: 'p1' }, roster: [] } }); eng.feedFrame('$LCD,0,0,0,0,0,0,*'); return h; };
  /** A countdown start: ARMED now, LIVE after `countdown_s`. */
  h.start = () => { seq++; eng.onMcMessage({ kind: 'start', body: { match_id: 'm' + seq, go_live_t: clock + 3000, config_id: golden.config_id, seq, countdown_s: 3 } }); return h; };
  h.live = () => { h.adv(3010); assert.equal(eng.phase, 'live', 'setup: the match is live'); return h; };
  h.end = () => { eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } }); assert.notEqual(eng.phase, 'live', 'setup: the match ended'); return h; };
  return h;
}

test('NIGHT OPS on: the HUD goes night at ARMED and stays night at LIVE; the config push alone does not switch it', () => {
  const h = harness().join().config(true);
  assert.equal(h.eng.night, false, 'loading a NIGHT OPS game does not blank the kit screens');
  h.start();
  assert.equal(h.eng.phase, 'armed');
  assert.equal(h.eng.night, true, 'the countdown is already on the night skin');
  h.live();
  assert.equal(h.eng.night, true);
  assert.equal(h.eng.state().nightOps, true);
});

test('NIGHT OPS off: nothing switches, at ARMED or LIVE', () => {
  const h = harness().join().config(false).start().live();
  assert.equal(h.eng.night, false);
  assert.equal(h.eng.state().nightOps, false);
});

test('a player pick overrides NIGHT OPS both ways mid-match, and persists into the next match', () => {
  // NIGHT OPS on, the player wants day.
  const a = harness().join().config(true).start().live();
  assert.equal(a.eng.night, true, 'setup: NIGHT OPS put the HUD on night');
  a.eng.setNight(false);
  assert.equal(a.eng.night, false, 'the tap wins mid-match');
  a.adv(1000); assert.equal(a.eng.night, false, 'and a tick does not undo it');
  a.end().config(true).start();
  assert.equal(a.eng.night, false, 'next match, same session: still day at ARMED');
  a.live(); assert.equal(a.eng.night, false, 'and at LIVE');
  // NIGHT OPS off, the player wants night.
  const b = harness().join().config(false).start().live();
  b.eng.setNight(true);
  assert.equal(b.eng.night, true, 'the tap wins mid-match');
  b.end().config(false);
  assert.equal(b.eng.night, true, 'a config push with night:false does not turn it back to day');
  b.start().live();
  assert.equal(b.eng.night, true, 'next match: still night');
});

test('the pick is remembered on the phone across an app restart, and a fresh MC session lets NIGHT OPS lead again', () => {
  const storage = mkStorage();
  const a = harness({ storage }).join().config(true).start().live();
  a.eng.setNight(false);
  // The app restarts in the same MC session. The match context is dropped so the next start is a real transition;
  // only the skin keys carry over.
  storage.removeItem('brx.engine');
  const b = harness({ storage, session: 's1' });
  assert.equal(b.eng.night, false, 'the skin is restored from storage');
  assert.equal(b.eng.ownNightChoice(), true, 'and so is the pick');
  b.join().config(true).start();
  assert.equal(b.eng.night, false, 'the pick still outranks NIGHT OPS');
  // MC starts a fresh session: NIGHT OPS sets the default again.
  storage.removeItem('brx.engine');
  const c = harness({ storage, session: 's2' });
  assert.equal(c.eng.ownNightChoice(), false);
  c.join().config(true).start();
  assert.equal(c.eng.night, true, 'a fresh session goes night at ARMED');
});

test('a restart before MC re-welcomes (transport session still unknown) does not let NIGHT OPS override an already-chosen day skin', () => {
  const storage = mkStorage();
  const a = harness({ storage }).join().config(true).start().live();
  a.eng.setNight(false);   // day pick, tied to session 's1'
  // The app restarts. The gun relinks over BLE (fast, local) before MC's welcome (a network round trip)
  // has told the node its session id back -- `sessionOf()` reads null in that window.
  storage.removeItem('brx.engine');
  const b = harness({ storage, session: null });
  assert.equal(b.eng.night, false, 'the skin is restored from storage');
  b.join().config(true).start();   // ARMED while the session is still unknown -- this is what used to fire _autoNight
  assert.equal(b.eng.phase, 'armed');
  assert.equal(b.eng.night, false, 'NIGHT OPS must not override the pick while the session is unknown');
  // The welcome finally arrives: same session as before the restart.
  b.session = 's1';
  assert.equal(b.eng.ownNightChoice(), true, 'once the session resolves to the same one, the pick still holds');
  b.adv(3010);
  assert.equal(b.eng.phase, 'live');
  assert.equal(b.eng.night, false, 'and stays day into LIVE');
});

test('pl3: before the welcome, the transport\'s last persisted MC session wins over the session stored with the pick', () => {
  const storage = mkStorage();
  const a = harness({ storage }).join().config(true).start().live();
  a.eng.setNight(false);   // day pick, tied to session 's1'
  // Later MC restarted as 's2' and welcomed this phone (the transport stored 's2'); no new pick was made.
  // Then the app restarts, and the gun relinks before the welcome arrives.
  storage.removeItem('brx.engine');
  const b = harness({ storage, session: null });
  b.persisted = 's2';
  assert.equal(b.eng.ownNightChoice(), false, 'the pick belongs to s1, and the last session MC gave us is s2');
  b.join().config(true).start();
  assert.equal(b.eng.night, true, 'NIGHT OPS leads, as it does for any fresh MC session');
  // the same restart with the pick's own session persisted keeps the pick
  const storage2 = mkStorage();
  const c = harness({ storage: storage2 }).join().config(true).start().live();
  c.eng.setNight(false);
  storage2.removeItem('brx.engine');
  const d = harness({ storage: storage2, session: null });
  d.persisted = 's1';
  d.join().config(true).start();
  assert.equal(d.eng.night, false, 'same session: the pick holds');
});

test('a blocked store never throws: the engine starts on day with no pick', () => {
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  const h = harness({ storage: bad });
  assert.equal(h.eng.night, false);
  h.eng.setNight(true);
  assert.equal(h.eng.night, true, 'the tap still works for this run');
});

test('the shipped page carries the switch beside the ⓘ, outside the diagnostics panel', () => {
  const html = readFileSync(fileURLToPath(new URL('../www/index.html', import.meta.url)), 'utf8');
  const m = html.match(/<button id="skin"[^>]*>/);
  assert.ok(m, 'index.html has a #skin button');
  assert.match(m[0], /data-act="onToggleNight"/);
  assert.match(m[0], /role="switch"/);
  const body = html.slice(html.indexOf('<body'));
  assert.ok(body.indexOf('id="skin"') < body.indexOf('id="diag"'), 'it is not inside #diag');
});
