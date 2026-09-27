// docs/announcer.md "The three lanes" (F351/F352, Tony 2026-09-24): the engine writes each HUD lane the moment its event
// ARRIVES, apart from the announcer queue, which still says one line at a time. These drive the real Engine on a mocked
// clock and read `state().lanes`, the one thing the HUD draws the alerts from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, IR_CALLOUT } from '../src/engine.js';
import { LANE_HERO_MS, LANE_HILL_CLEAR_MS, LANE_FEED_MS } from '../src/lanes.js';
import { PU_ACTIVE_CARD_MS } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

// the harness of announcer.test.mjs: me p1 (7, BLUE), VIPER p2 (19, YELLOW)
function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

// Me: p1, player_num 7, BLUE (tid 1). VIPER: 19, YELLOW (tid 2).
function harness({ num = 7, mode = 'tdm', shieldMax = null, weapons = [{ weapon_id: 'assault_rifle' }] } = {}) {
  const writes = [], logs = []; let clock = 1_000_000; const timers = [];
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode, environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 5 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: num, display: 'REAPER', team_id: 'blue', loadout: { weapons }, voice: 'male' };
  const roster = [{ player_id: 'p1', player_num: num, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' },
    { player_id: 'p3', player_num: 20, display: 'GHOST', team_id: 'blue' }, { player_id: 'p4', player_num: 21, display: 'SABLE', team_id: 'yellow' }];
  // `delay` is the engine's own timer seam: here it runs on the mocked clock, so a 120 ms flash-then-line gap is real
  const eng = new Engine({ writer: fr => fr.forEach(f => writes.push({ f, t: clock })), emit: () => {}, report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: m => logs.push(String(m)), delay: (ms, fn) => timers.push({ at: clock + ms, fn }), rng: () => 0 });
  const bundle = { ...golden, player_id: 'p1', callout_team: 0 };
  if (shieldMax != null) {   // a shield ceiling on every $PSET the gun is armed with (F341 repairs a pool above its ceiling)
    const t5 = f => f.split(',').map((tok, i) => (i === 5 ? String(shieldMax) : tok)).join(',');
    bundle.head = bundle.head.map(f => (f.startsWith('$PSET,') ? t5(f) : f));
    if (Array.isArray(bundle.pset_pool)) bundle.pset_pool = bundle.pset_pool.map(t5);
  }
  const run = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  const h = {
    eng, writes, logs, now: () => clock,
    adv(ms, step = 50) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); run(); eng.tick(); run(); } return h; },
    live() {
      eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
      eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster } });
      eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } });
      eng.feedFrame('$LCD,0,0,0,0,0,0,*');
      eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
      h.adv(3000); eng.feedFrame('$LCD,45,70,0,0,30,90,*'); h.adv(3000); writes.length = 0; logs.length = 0; return h;
    },
    kill(extra = {}) { eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: clock, victim_team: 'yellow', victim: 'p2', victim_display: 'VIPER', ...extra } }); run(); return h; },
    alert(kind, text) { eng.onMcMessage({ kind: 'alert', body: { kind, text: text || kind, t: clock } }); run(); return h; },
    irWord(p, magnitude) { eng.feedFrame(`$HIR,4,15,${p},0,${magnitude},0,0,*`); run(); return h; },
    plays(id) { return writes.filter(w => w.f.startsWith('$PLAY,') && w.f.split(',')[4] === id); },
  };
  return h;
}


test('lanes: my kill, the lead and the hill on the same tick are all in the lanes at once', () => {
  const h = harness().live();
  h.kill({ medals: ['first_blood'] }); h.alert('lead_taken', 'YOUR TEAM TAKES THE LEAD'); h.alert('hill_captured', 'HILL CAPTURED');
  const L = h.eng.state().lanes;
  assert.equal(L.hero.kills.length, 1);
  assert.deepEqual([L.hero.kills[0].victim, L.hero.kills[0].src, L.hero.kills[0].medals], ['VIPER', 'MC', ['first_blood']]);
  assert.equal(L.obj.lead.kind, 'lead_taken', 'the lead badge is up at once, not after the kill line');
  assert.equal(L.obj.hill.kind, 'hill_captured');
  assert.equal(h.eng.state().announcer.kind, 'kill_confirmed', 'the voice still says the kill first');
});

test('lanes: a spree builds one hero, and a kill after the hold starts a new one', () => {
  const h = harness().live();
  h.kill({ medals: ['first_blood'] }); h.adv(1000); h.kill({ medals: ['double_kill'] }); h.adv(1000); h.kill({ medals: ['triple_kill'] });
  let L = h.eng.state().lanes;
  assert.equal(L.hero.kills.length, 3, 'three kills 1 s apart are one spree');
  assert.deepEqual(L.hero.kills.flatMap(k => k.medals), ['first_blood', 'double_kill', 'triple_kill']);
  assert.ok(L.heroUntil >= h.now() + LANE_HERO_MS - 1, `the hero holds ${LANE_HERO_MS} ms after the last kill`);
  h.adv(8000); h.kill();
  L = h.eng.state().lanes;
  assert.equal(L.hero.kills.length, 1, 'a kill after the hero has gone starts a new one');
});

test('lanes: the lead badge stays until the next lead alert replaces it', () => {
  const h = harness().live();
  h.alert('lead_taken', 'YOUR TEAM TAKES THE LEAD'); h.adv(30000);
  assert.equal(h.eng.state().lanes.obj.lead.kind, 'lead_taken', 'still up 30 s later');
  h.alert('lead_lost', 'YOUR TEAM LOST THE LEAD');
  assert.equal(h.eng.state().lanes.obj.lead.kind, 'lead_lost');
});

test('lanes: the hill badge clears after its hold, while the lead badge stays', () => {
  const h = harness().live();
  h.alert('lead_taken', 'YOUR TEAM TAKES THE LEAD'); h.alert('hill_captured', 'HILL CAPTURED');
  h.adv(LANE_HILL_CLEAR_MS - 1);
  assert.ok(h.eng.state().lanes.obj.hill, 'the hill badge remains before the clear time');
  assert.ok(h.eng.state().lanes.obj.lead, 'the lead badge remains before the clear time');
  h.adv(2);
  assert.equal(h.eng.state().lanes.obj.hill, undefined, 'the hill badge is removed after the clear time');
  assert.ok(h.eng.state().lanes.obj.lead, 'the lead badge keeps its stay-until-replaced behaviour');
});

test('lanes: the IR word and MC confirm for one kill are ONE hero row, named by MC', () => {
  const h = harness().live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(300); h.kill();
  const k = h.eng.state().lanes.hero.kills;
  assert.equal(k.length, 1, 'one kill, one row');
  assert.deepEqual([k[0].victim, k[0].src], ['VIPER', 'IR · MC']);
});

test('lanes: another alert is a FEED row; downs are FEED rows; a new match clears every lane', () => {
  const h = harness().live();
  h.alert('bomb_planted', 'BOMB PLANTED'); h.irWord(20, IR_CALLOUT.DOWN_BY + 2);
  const f = h.eng.state().lanes.feed;
  assert.deepEqual(f.map(x => x.kind), ['enemy_down', 'alert']);
  assert.deepEqual([f[1].alert, f[1].text, f[1].src], ['bomb_planted', 'BOMB PLANTED', 'MC']);
  assert.equal(f[0].by, 'GHOST');
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.now() + 5000, config_id: golden.config_id, seq: 2, countdown_s: 5 } });
  assert.equal(h.eng.state().lanes, null);
});

test('HUD QA R2-11: kills folded in the queue keep the newest multi-kill AND the newest streak line', () => {
  const h = harness().live();
  h.kill({ medals: ['double_kill'] }); h.kill({ medals: ['triple_kill'] }); h.kill({ medals: ['killtrocity', 'killing_spree'] });
  const waiting = h.eng._ann.queue.filter(q => q.src === 'mc').map(q => (q.medals || []).map(x => x.m));
  assert.deepEqual(waiting, [['killtrocity', 'killing_spree']], 'one folded item that says both the multi-kill and the streak');
});

// ---- F400 final (Tony, 2026-09-26): "Not stacked. The weapon switch overlay is on top. When it finishes then the rest of
// ui is shown. ... Anything which has a temporary show should have their timer adjusted since the user was in that
// overlay. This should be true for regular alt weapon switches too." The card is SWITCHING, then its ACTIVE bubble. ----
const TWO = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] };
/** ALT on a two-weapon loadout; returns when the card (SWITCHING + ACTIVE) ends, from the engine's own moment. */
function altCard(h) {
  h.eng.feedFrame('$BUT,1,1,*'); h.eng.feedFrame('$BUT,1,0,*');
  return () => { const m = h.eng.state().moment; assert.equal(m && m.kind, 'switched', 'the swap was taken'); return m.at + PU_ACTIVE_CARD_MS; };
}
const age = (h, f) => h.now() - f.at;

test('F400 final: a feed row that arrives 0.5 s into an ALT card gets its full time after the card', () => {
  const h = harness(TWO).live();
  const end = altCard(h); h.adv(500); h.alert('bomb_planted', 'BOMB PLANTED');
  h.adv(2500); const cardEnd = end();
  h.adv(cardEnd + LANE_FEED_MS - 100 - h.now());
  assert.ok(age(h, h.eng.state().lanes.feed[0]) < LANE_FEED_MS, `still up ${LANE_FEED_MS - 100} ms after the card: age ${age(h, h.eng.state().lanes.feed[0])}`);
  h.adv(200);
  assert.ok(age(h, h.eng.state().lanes.feed[0]) >= LANE_FEED_MS, 'and done once its full time has run after the card');
});

test('F400 final: a feed row already up when the card starts keeps the time it had left', () => {
  const h = harness(TWO).live();
  h.alert('bomb_planted', 'BOMB PLANTED'); h.adv(1000);
  const end = altCard(h); h.adv(2500); const cardEnd = end();
  h.adv(cardEnd + (LANE_FEED_MS - 1000) - 100 - h.now());
  assert.ok(age(h, h.eng.state().lanes.feed[0]) < LANE_FEED_MS, 'its last 3 s run after the card, not under it');
  h.adv(200);
  assert.ok(age(h, h.eng.state().lanes.feed[0]) >= LANE_FEED_MS);
});

test('F400 final: the hill badge clear waits out the card too', () => {
  const h = harness(TWO).live();
  h.alert('hill_captured', 'HILL CAPTURED'); h.adv(1000);
  const end = altCard(h); h.adv(2500); const cardEnd = end();
  h.adv(cardEnd + (LANE_HILL_CLEAR_MS - 1000) - 100 - h.now());
  assert.ok(h.eng.state().lanes.obj.hill, 'the badge has not had its time yet');
  h.adv(200);
  assert.equal(h.eng.state().lanes.obj.hill, undefined);
});

test('F400 final: a kill 0.5 s into an ALT card holds the hero open for its full time after the card', () => {
  const h = harness(TWO).live();
  const end = altCard(h); h.adv(500); h.kill();
  h.adv(2500); const cardEnd = end();
  assert.ok(h.eng.state().lanes.heroUntil >= cardEnd + LANE_HERO_MS - 60, `hero until ${h.eng.state().lanes.heroUntil - cardEnd} ms after the card`);
  h.adv(cardEnd + LANE_HERO_MS - 100 - h.now()); const id = h.eng.state().lanes.hero.id;
  h.kill();
  assert.equal(h.eng.state().lanes.hero.id, id, 'a second kill inside that time joins the same card');
});

test('F400 final r1: a death mid-card closes the card at once, so the down time is never counted as paused', () => {
  const h = harness(TWO).live();
  h.alert('hill_captured', 'HILL CAPTURED');
  altCard(h); h.adv(300);
  h.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); h.eng.feedFrame('$HP,0,0,0,*'); h.adv(100);
  assert.equal(h.eng.state().switchCard, false, 'no card on a dead player');
  const t = h.now(); h.adv(5000);
  assert.ok(h.eng._lanePaused(t) === 0, `nothing paused after the death: ${h.eng._lanePaused(t)} ms`);
});

test('F400 final r2: a hit during the ACTIVE bubble does not end the card early', () => {
  const h = harness(TWO).live();
  const end = altCard(h); h.adv(1100); const cardEnd = end();   // the swap is taken; the ACTIVE bubble is up
  h.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); h.eng.feedFrame('$HP,45,61,0,*');   // a hit: `moment` becomes 'hit'
  assert.notEqual(h.eng.state().moment.kind, 'switched', 'setup: the hit replaced the switched moment');
  h.adv(cardEnd - 150 - h.now());
  assert.equal(h.eng.state().switchCard, true, 'the bubble still holds the card until its own end');
  h.adv(300);
  assert.equal(h.eng.state().switchCard, false);
});
