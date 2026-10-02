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

// ---- Tony, 2026-10-02: HILL CAPTURE STARTED (engine.js `_hillBegins`). ONE badge, tinted in the CAPTURING team's colour,
// shown to everyone, whenever any team's capture progress starts rising: a team building a neutral point, or draining a
// point another team holds or is building. A phone control point's advert (utility.md §5d), as app.js pushes
// `presence.stations()`. Me: BLUE (tid 1). The other team is RED (tid 0): YELLOW is tid 2, the neutral sentinel, which can
// never own a point (F82), so `redBlue` gives the game RED and BLUE, which is also what lets the phone name a drainer.
const { CONTROL_STATE: CS } = await import('../src/control.js');
const BLUE = 1, RED = 0;
function point(h, o) {
  h.eng.setStations([{ role: 'station', id: 11, kind: 'control', team: 255, state: 0, value: 0, seq: 0, game: 0, threshold: -74, rssi: -50, raw: -50, present: true, ageMs: 0, ...o }]);
  return h;
}
/** Hold one advert for `ms`, re-sent every 250 ms like the presence loop. */
function hold(h, ms, o) { for (let t = 0; t < ms; t += 250) { h.adv(250); point(h, o); } return h; }
/** Every HILL CAPTURE STARTED the engine put on the badge, as the capturing team's key, in order. */
const started = h => h.logs.filter(l => l.startsWith('hill capture started: ')).map(l => /team (\w+)/.exec(l)[1]);
const badge = h => h.eng.state().lanes && h.eng.state().lanes.obj.hill;
const redBlue = h => { h.eng.config.teams = [{ team_id: 'red', name: 'RED', color: 'red', tid: 0 }, { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }]; return h; };
const koth = (o = {}) => redBlue(harness({ mode: 'koth', ...o }).live());

test('capture started: our team`s bar leaves 0, one badge in OUR colour, and a stall that resumes is the same episode', () => {
  const h = koth();
  point(h, { team: 255, state: 0, value: 0 });                       // first advert: a neutral point, adopted silently
  assert.deepEqual(started(h), []);
  point(h, { team: BLUE, state: CS.rising, value: 4 });
  assert.deepEqual(started(h), ['blue']);
  assert.equal(badge(h).kind, 'hill_capture_started', 'one generic badge, the same lane item as HILL CAPTURED');
  assert.equal(badge(h).team, 'blue', 'tinted in the capturing team`s colour');
  for (let v = 8; v <= 60; v += 4) { h.adv(250); point(h, { team: BLUE, state: CS.rising, value: v }); }
  hold(h, 11000, { team: BLUE, state: 0, value: 60 });                // we stepped off: it stalls (past the 10 s floor)
  hold(h, 3000, { team: BLUE, state: CS.rising, value: 70 });         // and resumes
  hold(h, 2000, { team: BLUE, state: CS.contested, value: 70 });      // an even fight stalls it too
  assert.deepEqual(started(h), ['blue'], 'never twice in one episode');
  hold(h, 500, { team: BLUE, state: CS.held, value: 100 });
  assert.equal(badge(h).kind, 'hill_captured', 'the capture replaces it, and that ends the episode');
});

test('capture started: the enemy`s capture is shown to us too, in THEIR colour (a neutral point they build)', () => {
  const h = koth();
  point(h, { team: 255, state: 0, value: 0 });
  point(h, { team: RED, state: CS.rising, value: 4 });
  assert.deepEqual(started(h), ['red'], 'everyone sees it, not only the capturing side');
  assert.equal(badge(h).team, 'red');
  hold(h, 11000, { team: RED, state: 0, value: 30 });
  hold(h, 1000, { team: RED, state: CS.rising, value: 40 });
  assert.deepEqual(started(h), ['red'], 'one episode');
});

test('capture started: draining a held point is a capture starting, for the defenders AND the attackers', () => {
  const def = koth();                                                // we hold it; RED starts to drain it
  hold(def, 1000, { team: BLUE, state: CS.held, value: 100 });
  point(def, { team: BLUE, state: CS.held | CS.falling, value: 96 });
  assert.deepEqual(started(def), ['red'], 'the advert names the owner; in a two-team game the drainer is the other team');
  assert.equal(badge(def).team, 'red');
  const att = koth();                                                // RED holds it; WE start to drain it
  hold(att, 1000, { team: RED, state: CS.held, value: 100 });
  point(att, { team: RED, state: CS.held | CS.falling, value: 96 });
  assert.deepEqual(started(att), ['blue'], 'the attackers see their own capture start too (storyboard question 2)');
  assert.equal(badge(att).team, 'blue');
});

test('capture started: a steal is ONE episode, from the first drain through the thief`s build', () => {
  const h = koth();
  hold(h, 1000, { team: BLUE, state: CS.held, value: 100 });
  point(h, { team: BLUE, state: CS.held | CS.falling, value: 95 });
  hold(h, 11000, { team: BLUE, state: CS.held, value: 60 });          // RED left: the drain stalls (past the floor)
  hold(h, 2000, { team: BLUE, state: CS.held | CS.falling, value: 5 });
  hold(h, 2000, { team: RED, state: CS.rising, value: 20 });          // it went neutral and RED builds on
  assert.deepEqual(started(h), ['red'], 'one capture, however it stalls or crosses 0');
  hold(h, 3000, { team: RED, state: CS.held, value: 100 });
  hold(h, 3000, { team: RED, state: CS.held | CS.falling, value: 97 });
  assert.deepEqual(started(h), ['red', 'blue'], 'our counter-attack is a new capture, in our colour');
});

test('capture started: a new episode only after the progress returned to 0, never inside the 10 s floor per team', () => {
  const h = koth();
  point(h, { team: 255, state: 0, value: 0 });
  point(h, { team: BLUE, state: CS.rising, value: 10 });
  hold(h, 1000, { team: BLUE, state: CS.falling, value: 4 });         // RED pushes our build back down: RED`s capture
  hold(h, 500, { team: RED, state: CS.rising, value: 3 });            // through 0 and on for RED: the same RED episode
  point(h, { team: BLUE, state: CS.rising, value: 2 });               // ours again 2 s after our first badge
  assert.deepEqual(started(h), ['blue', 'red'], 'the floor holds back our second badge');
  hold(h, 1000, { team: RED, state: CS.rising, value: 5 });
  hold(h, 9000, { team: RED, state: 0, value: 5 });
  hold(h, 500, { team: RED, state: CS.falling, value: 0 });
  hold(h, 500, { team: BLUE, state: CS.rising, value: 3 });
  assert.deepEqual(started(h), ['blue', 'red', 'blue'], 'past the floor, our capture that began again is news again');
});

test('capture started: walking into range mid-capture is silent, as the owner is', () => {
  const h = koth();
  point(h, { team: BLUE, state: CS.rising, value: 40 });
  hold(h, 1000, { team: BLUE, state: CS.rising, value: 45 });
  const g = koth();
  point(g, { team: BLUE, state: CS.held | CS.falling, value: 70 });
  hold(g, 1000, { team: BLUE, state: CS.held | CS.falling, value: 65 });
  assert.deepEqual([...started(h), ...started(g)], [], 'we did not see either begin');
});

test('capture started: with three teams a drain names nobody, so the badge waits for the thief`s own build', () => {
  const h = koth();
  h.eng.config.teams.push({ team_id: 'purple', name: 'PURPLE', color: 'purple', tid: 3 });
  point(h, { team: 255, state: 0, value: 0 });
  hold(h, 1000, { team: BLUE, state: CS.rising, value: 50 });
  assert.deepEqual(started(h), ['blue']);
  hold(h, 1000, { team: BLUE, state: CS.falling, value: 20 });
  assert.deepEqual(started(h), ['blue'], 'RED or PURPLE is draining our build: the advert does not say which');
  hold(h, 500, { team: 3, state: CS.rising, value: 4 });
  assert.deepEqual(started(h), ['blue', 'purple'], 'the thief`s own build names them');
});

test('capture started: a badge while I am DOWN waits on the lane, and is there when I am back', () => {
  const h = koth();
  hold(h, 1000, { team: BLUE, state: CS.held, value: 100 });
  h.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); h.eng.feedFrame('$HP,0,0,0,*'); h.adv(300);
  assert.equal(h.eng.state().alive, false, 'setup: I am down (the HUD draws no lane while I am down)');
  hold(h, 500, { team: BLUE, state: CS.held | CS.falling, value: 97 });
  assert.deepEqual(started(h), ['red']);
  const at = badge(h).at;
  for (let t = 0; t < 8000 && !h.eng.state().alive; t += 250) hold(h, 250, { team: BLUE, state: CS.held | CS.falling, value: 90 });
  assert.equal(h.eng.state().alive, true, 'setup: the timed respawn brought me back');
  assert.equal(badge(h).kind, 'hill_capture_started', 'still up after the respawn');
  assert.equal(badge(h).at, at, 'the same card, not a second one');
});

test('capture started: a badge during a weapon switch card waits under it, as every hill badge does', () => {
  const h = koth(TWO);
  hold(h, 1000, { team: BLUE, state: CS.held, value: 100 });
  const end = altCard(h); h.adv(300);
  point(h, { team: BLUE, state: CS.held | CS.falling, value: 97 });
  assert.equal(h.eng.state().switchCard, true, 'the card is up (the HUD hides the lanes under it)');
  assert.equal(badge(h).kind, 'hill_capture_started');
  hold(h, 2500, { team: BLUE, state: CS.held | CS.falling, value: 90 }); const cardEnd = end();
  h.adv(cardEnd + LANE_HILL_CLEAR_MS - 300 - h.now());
  point(h, { team: BLUE, state: CS.held | CS.falling, value: 60 });
  assert.equal(badge(h).kind, 'hill_capture_started', 'its full time runs after the card');
});
