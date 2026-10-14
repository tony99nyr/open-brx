// ARCH-2 (architecture review 2026-10-10, candidate 2): the engine owns the takeover. `state().presented.takeover` says
// which takeover holds the centre and when it ends (`until`, on the engine clock); the HUD draws and removes its overlay
// from it, and the lanes hold the kill card by it. These tests run the real engine AND the real Hud (on the fake DOM of
// hud-html-harness.mjs), with the HUD's timers on the engine's clock, so a card the HUD ends on its own timer shows up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';
import { Hud } from '../src/hud/hud.js';
import { FakeDocument } from './hud-fake-dom.mjs';
import { LANE_HERO_MS } from '../src/lanes.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const RP = golden.respawn_profile;
const HELD = '$BMAP,0,98,,,,,*', LIVE = '$BMAP,0,0,,,,,*';
const TICK = 50;
// The Rockets pickup slot's head `$WEAP` (powerups.test.mjs WEAP[2]; the grant re-sends it verbatim).
const PU_WEAP = { 2: '$WEAP,2,2,100,10,0,115,0,,,,,,35,100,1000,850,2,2,2600,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,1,75,100,*' };
const ROCKETS = { kind: 'weapon', weapon_id: 'rocket_launcher', charges: 2, spawn_every_s: 120, first_at_s: 5, name: 'ROCKETS', color: '#ff7a1a' };
const PAGE = '<div id="stage"><div id="frame"><div id="hud"></div><div id="overlay"></div><div id="chips"></div>'
  + '<div id="diag"></div><button id="info"></button><button id="skin"></button></div></div>';

/** A live match on a clock-driven `delay` (the play queue really waits for the gun), drawn by a real Hud. The HUD's
 *  `setTimeout`s run on the same clock, so its fade ends when the engine clock passes them. */
function harness(bundle = golden, { stations = [], powerups = undefined } = {}) {
  const timed = [], timers = [], hudTimers = []; let clock = 1_000_000, hud = null;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: bundle.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'manual' }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams,
    ...(stations.length ? { stations } : {}), ...(powerups ? { powerups } : {}) };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] }, voice: 'male' };
  const eng = new E.Engine({ writer: fr => { for (const f of fr) timed.push([clock, f]); }, emit: () => {}, report: () => {}, now: () => clock, wallNow: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => timers.push({ at: clock + ms, fn }), rng: () => 0 });
  const runTimers = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  const doc = new FakeDocument(PAGE);
  const fakes = { document: doc, window: { innerWidth: 844, innerHeight: 390, addEventListener() {} }, getComputedStyle: () => ({ bottom: '8px' }),
    setTimeout: (fn, ms) => { hudTimers.push({ fn, at: clock + ms }); return hudTimers.length; },
    clearTimeout: id => { if (id && hudTimers[id - 1]) hudTimers[id - 1].fn = null; } };
  /** Run `fn` with the HUD's globals installed and `Date.now` on the engine clock. */
  const inHud = fn => {
    const prior = Object.fromEntries(Object.keys(fakes).map(k => [k, globalThis[k]])), now = Date.now;
    Object.assign(globalThis, fakes); Date.now = () => clock;
    try { return fn(); } finally { Date.now = now; for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
  };
  let paused = 0;   // renders skipped until this clock (a busy phone's rAF)
  const render = () => clock < paused ? undefined : inHud(() => {
    for (const t of hudTimers) if (t.fn && t.at <= clock) { const f = t.fn; t.fn = null; f(); }
    hud.render(eng.state());
  });
  hud = inHud(() => new Hud(doc, {}));
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  // a pickup slot is armed by a normal `$WEAP` in the head (compile.py A56), as powerups.test.mjs does
  const frames = { ...bundle, player_id: 'p1', ...(powerups ? { head: [...bundle.head, ...powerups.map(p => PU_WEAP[p.slot] || assert.fail(`no PU_WEAP row for slot ${p.slot}`))] } : {}) };
  eng.onMcMessage({ kind: 'config', body: { config, frames, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, timed, timers, hud,
    now: () => clock,
    /** Advance the clock a TICK at a time; the HUD renders after every tick, as app.js does every 250 ms (more often here). */
    async adv(ms, each = () => {}) {
      const end = clock + ms;
      while (clock < end) { clock = Math.min(end, clock + TICK); runTimers(); eng.tick(); runTimers(); render(); each(); await new Promise(r => setImmediate(r)); }
      return h;
    },
    render,
    /** Move the clock with no tick, no timer and no render: the gap between two ticks, where the HUD's rAF reads `state()`. */
    gap(ms) { clock += ms; return h; },
    pauseRenders(ms) { paused = clock + ms; return h; },
    /** A powerup station's advert as beacon.js Presence reports it (powerups.test.mjs `near`). */
    near(id, { state = 1, value = 0, taker = 0 } = {}) {
      eng.setStations([{ role: 'station', id, kind: 'powerup', team: 255, state, value, taker, seq: 0, game: 0, threshold: 0, rssi: -50, raw: -50, median: -50, present: true, ageMs: 0 }]);
      return h;
    },
    kill() { eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: clock, victim_team: 'yellow', victim: 'p2', victim_display: 'VIPER' } }); return h; },
    takeover: () => eng.state().presented.takeover,
    /** The REDEPLOYED card as the player sees it: 'up', 'out' (fading) or null. */
    card() { const el = doc.querySelector('#overlay .mo.redeploy'); return el ? (el.classList.contains('out') ? 'out' : 'up') : null; },
    frameTakeover: () => hud.frame.dataset.takeover || null,
    die() { eng.feedFrame('$HIR,4,0,19,2,106,0,3,*'); eng.feedFrame('$HP,0,0,0,*'); return h; },
    operatorRespawn() { eng.onMcMessage({ kind: 'control', body: { cmd: 'respawn', match_id: 'm1' } }); return h; },
  };
  return h;
}
const at = (w, frame) => { const e = w.filter(([, f]) => f === frame); return e.length ? e[e.length - 1][0] : null; };

async function deadInScream(bundle) {
  const h = harness(bundle);
  await h.adv(4000);
  assert.ok(h.eng.alive, 'setup: live after go-live');
  h.die(); await h.adv(100);
  assert.ok(!h.eng.alive, 'setup: down');
  return h;
}

// (a) F496 to F498 patched the engine's PREDICTION of the HUD's REDEPLOYED timer. A burst that goes out later than the
// play queue planned (here: the link was busy for 700 ms) moved the engine's end, but the HUD had already set its
// `setTimeout` from `weaponArming` at draw time, so the card faded before the trigger went live: WEAPONS HOT never showed.
test('ARCH-2: a revive burst sent LATER than planned: REDEPLOYED is up when the trigger goes live, and ends when the engine says', async () => {
  const h = await deadInScream();
  const t0 = h.now(); h.operatorRespawn();
  const job = h.eng._gun.waiting;
  assert.ok(job && job.life && job.sendAt > h.now(), 'setup: the burst waits behind the scream with a planned send');
  const timer = h.timers.find(x => x.at === job.sendAt);
  assert.ok(timer, 'setup: the play queue timer for the burst');
  timer.at += 700;   // the link was busy: the burst goes 700 ms after the plan
  const seen = [];   // [clock, card, takeover] after every render
  await h.adv(6000, () => seen.push([h.now(), h.card(), h.takeover()]));
  const liveAt = at(h.timed, LIVE), heldAt = at(h.timed, HELD);
  assert.ok(heldAt >= job.sendAt + 700, `setup: the burst went late (${heldAt - t0} ms in)`);
  assert.ok(liveAt - heldAt >= RP.trigger_ms, 'setup: the trigger went live after the weapon delay');
  // the card is drawn, and is never fading before the trigger is live
  for (const [t, card] of seen) if (t <= liveAt) assert.equal(card, 'up', `REDEPLOYED is ${card} at ${t - t0} ms, before the trigger went live at ${liveAt - t0} ms`);
  // while the burst waits, the end is not known yet: open, never a guess
  for (const [t, , tk] of seen) if (t < heldAt) assert.ok(tk && tk.kind === 'redeploy' && tk.until == null, `at ${t - t0} ms the takeover is open: ${JSON.stringify(tk)}`);
  // once the trigger is live, the end is a beat after it, and only grows
  const ends = seen.filter(([t, , tk]) => t >= liveAt && tk && tk.kind === 'redeploy').map(([, , tk]) => tk.until);
  assert.ok(ends.length && ends.every(u => u === ends[0]), `one end once the trigger is live: ${JSON.stringify(ends)}`);
  const until = ends[0];
  assert.equal(until, Math.max(t0 + 1700, liveAt + 400), 'the end: 400 ms after the trigger went live, at least 1.7 s after the revive');
  // the HUD's card fades exactly then (the first render at or after `until`), and the takeover is gone with it
  for (const [t, card, tk] of seen) {
    if (t < until) assert.equal(card, 'up', `up at ${t - t0} ms (end ${until - t0})`);
    else { assert.notEqual(card, 'up', `fading or gone at ${t - t0} ms (end ${until - t0})`); assert.equal(tk, null, 'and no takeover'); }
  }
});

test('ARCH-2 control: a revive long after the scream: REDEPLOYED ends at the weapon delay plus 400 ms (floor 1.7 s), as before', async () => {
  const h = await deadInScream();
  await h.adv(3000);
  const t0 = h.now(); h.operatorRespawn(); h.render();
  assert.deepEqual(h.takeover(), { kind: 'redeploy', at: t0, until: null }, 'open until the trigger goes live (review r1)');
  assert.equal(h.card(), 'up');
  await h.adv(RP.trigger_ms);
  const tk = h.takeover();
  assert.deepEqual(tk, { kind: 'redeploy', at: t0, until: t0 + Math.max(1700, RP.trigger_ms + 400) }, 'then the end is known');
  await h.adv(tk.until - h.now() - TICK);
  assert.equal(h.card(), 'up', 'up until the end');
  await h.adv(TICK);
  assert.equal(h.card(), 'out', 'fading at the end');
  assert.equal(h.takeover(), null);
});

// (b) "Which takeover holds the centre" was written three times (engine.js `_laneTakeover`, hud/moments.js `_moments`
// `tk`, hud/lanes.js `_lanes` reading the DOM), and the copies disagreed. Each case reads all three readers.
/** Two of the readers: the engine's takeover and the HUD frame's `data-takeover`. */
function readers(h) {
  const tk = h.takeover();
  return { engine: tk ? tk.kind : null, frame: h.frameTakeover() };
}

test('ARCH-2: a reconcile while DOWN is no takeover anywhere: the DOWN screen owns a dead phone', async () => {
  const h = await deadInScream();
  await h.adv(3000);
  h.eng.onBleDropped(); await h.adv(TICK);
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  h.render();
  assert.ok(h.eng.state().reconciling && !h.eng.alive, 'setup: a reconcile runs while I am down');
  assert.deepEqual(readers(h), { engine: null, frame: null });
});

test('ARCH-2 control: a reconcile while ALIVE is the reconcile takeover in every reader, and holds a kill card', async () => {
  const h = harness();
  await h.adv(6000);
  h.eng.onBleDropped(); await h.adv(TICK);
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  h.render();
  assert.ok(h.eng.state().reconciling && h.eng.alive, 'setup: a reconcile runs while I am alive');
  assert.deepEqual(readers(h), { engine: 'reconcile', frame: 'reconcile' });
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: h.now(), victim_team: 'yellow', victim: 'p2', victim_display: 'VIPER' } });
  h.render();
  assert.equal(h.hud.frame.querySelector('#lanes .lh'), null, 'the kill card waits behind SYNCING');
});

test('ARCH-2: a weapon switch inside REDEPLOYED replaces the card, and no reader holds a kill card behind it after', async () => {
  const h = await deadInScream({ ...golden, respawn_profile: { ...RP, trigger_ms: 3000 } });   // a long weapon delay: REDEPLOYED runs 3.4 s
  await h.adv(3000);
  const t0 = h.now(); h.operatorRespawn(); await h.adv(TICK);
  assert.equal(h.card(), 'up', 'setup: REDEPLOYED is up');
  h.eng.feedFrame('$BUT,1,1,*');   // ALT
  await h.adv(TICK);
  assert.equal(h.takeover() && h.takeover().kind, 'switch', 'setup: SWITCHING');
  assert.equal(h.card(), null, 'the SWITCHING overlay replaced the card');
  for (let i = 0; i < 80 && h.takeover(); i++) await h.adv(TICK);
  assert.equal(h.takeover(), null, 'REDEPLOYED does not come back as a takeover nobody sees');
  assert.ok(h.now() - t0 < 3400 - 2 * TICK, `setup: still inside the weapon delay's REDEPLOYED (${h.now() - t0} ms)`);
  assert.equal(h.card(), null, 'and is not drawn again');
  // a kill now: nothing holds the centre, so the HUD draws the card and the engine closes it on time
  const k = h.now();
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: k, victim_team: 'yellow', victim: 'p2', victim_display: 'VIPER' } });
  await h.adv(TICK);
  assert.ok(h.hud.frame.querySelector('#lanes .lh'), 'the HUD draws the kill card');
  assert.equal(h.eng.state().presented.lanes.heroUntil, k + LANE_HERO_MS, 'and the engine does not hold it open behind an unseen card');
});

// Review r1 (Codex sol, 07c58537): REDEPLOYED ended at the PLANNED trigger time (`tp.due`), so a card could fade with the
// trigger still held. It now follows the trigger going live (`_triggerLive`, after the burst reached the gun), and a cap
// (`_redeployUntil`: LIFE_BURST_HOLD_MAX_MS plus the weapon delay's own end, from the send or the revive) keeps it from hanging.
const CAP = E.LIFE_BURST_HOLD_MAX_MS + Math.max(1700, RP.trigger_ms + 400);
test('ARCH-2 r1: the link drops right after the burst: REDEPLOYED stays up while the trigger cannot go live', async () => {
  const h = await deadInScream();
  await h.adv(3000);
  const t0 = h.now(); h.operatorRespawn();
  assert.equal(at(h.timed, '$SPAWN,,*'), t0, 'setup: the burst went at once');
  h.eng.onBleDropped();   // before the weapon delay is over: `$BMAP,0,0` cannot go out
  const seen = [];
  await h.adv(3000, () => seen.push([h.now(), h.card(), h.takeover()]));
  assert.equal(h.timed.filter(([t, f]) => t > t0 && f === LIVE).length, 0, 'setup: the trigger did not go live');
  for (const [t, card, tk] of seen) {
    assert.equal(card, 'up', `REDEPLOYED is up at ${t - t0} ms with the trigger still held`);
    assert.ok(tk && tk.kind === 'redeploy' && tk.until == null, `and open: ${JSON.stringify(tk)}`);
  }
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.render();
  assert.equal(h.takeover() && h.takeover().kind, 'reconcile', 'the relink: SYNCING takes the centre, and replaces the card');
});

test('ARCH-2 r1: a burst held past LIFE_BURST_HOLD_MAX_MS: REDEPLOYED is up when $SPAWN goes, and ends after the trigger', async () => {
  const h = await deadInScream();
  h.eng._gun.add(E.LIFE_BURST_HOLD_MAX_MS - 400, 'synthetic backlog', h.now(), 'X');
  const t0 = h.now(); h.operatorRespawn();
  const seen = [];
  await h.adv(E.LIFE_BURST_HOLD_MAX_MS + 5000, () => seen.push([h.now(), h.card(), h.takeover()]));
  const spawnAt = at(h.timed, '$SPAWN,,*'), liveAt = at(h.timed, LIVE);
  assert.ok(spawnAt - t0 > E.LIFE_BURST_HOLD_MAX_MS && spawnAt - t0 < CAP, `setup: the burst went after the hold cap (${spawnAt - t0} ms)`);
  assert.ok(liveAt - spawnAt >= RP.trigger_ms, 'setup: the trigger went live after the burst');
  for (const [t, card] of seen) if (t <= liveAt) assert.equal(card, 'up', `REDEPLOYED is up at ${t - t0} ms (burst ${spawnAt - t0}, live ${liveAt - t0})`);
  // (the window stops short of the F272 lock verdict this silent fake gun earns later)
  const after = seen.filter(([t]) => t >= liveAt + 400 && t < liveAt + 1000);
  assert.ok(after.length > 0, 'review r2: the window after the end holds samples');
  for (const [t, card, tk] of after) { assert.notEqual(card, 'up', `ended at ${t - t0} ms`); assert.equal(tk, null); }
});

test('ARCH-2 r1: a trigger that never goes live: REDEPLOYED ends at the cap, never hangs', async () => {
  const h = await deadInScream();
  await h.adv(3000);
  const t0 = h.now(); h.operatorRespawn();
  h.eng.onBleDropped();
  const seen = [];
  await h.adv(CAP + 1000, () => seen.push([h.now(), h.card(), h.takeover()]));
  for (const [t, card, tk] of seen) {
    if (t < t0 + CAP) assert.ok(card === 'up' && tk && tk.kind === 'redeploy', `up before the cap, at ${t - t0} ms: ${card} ${JSON.stringify(tk)}`);
    else { assert.notEqual(card, 'up', `ended at the cap, ${t - t0} ms`); assert.equal(tk, null); }
  }
});

test('ARCH-2 r1: at night a revive draws no REDEPLOYED, and no reader holds the centre for it', async () => {
  const h = await deadInScream();
  await h.adv(3000);
  h.eng.setNight(true);
  h.operatorRespawn(); await h.adv(TICK);
  assert.ok(h.eng.alive && h.eng.moment && h.eng.moment.kind === 'redeploy', 'setup: revived');
  assert.equal(h.takeover(), null, 'the engine publishes no takeover');
  assert.equal(h.card(), null, 'and the HUD draws no card');
  h.eng.setNight(false); await h.adv(TICK);
  assert.equal(h.takeover(), null, 'a card the night never drew does not come back by day');
});

// Review r2 (Opus): `_takeover` ran inside `state()` and WROTE `card.over` the first time another takeover was up. A FORCE
// RESPAWN during an ALT swap cancels the swap, but its card span stays open until the next `_cardTick`, so a `state()`
// read before that tick (the HUD's rAF render, a debug read) saw `switched`, ended the new life's card, and it never drew.
/** A live player mid-swap gets an operator respawn; `reads` extra `state()` reads before each tick. Returns what the
 *  HUD showed and what the engine published after every tick. */
async function swapThenRespawn(reads) {
  const h = harness();
  await h.adv(6000);
  h.eng.feedFrame('$BUT,1,1,*');   // ALT
  await h.adv(TICK);
  assert.equal(h.takeover() && h.takeover().kind, 'switch', 'setup: SWITCHING');
  h.operatorRespawn();
  const out = [];
  for (let i = 0; i < 3000 / TICK; i++) {
    for (let k = 0; k < reads; k++) h.eng.state();
    await h.adv(TICK);
    out.push([h.card(), JSON.stringify(h.takeover())]);
  }
  return out;
}
test('ARCH-2 r2: a FORCE RESPAWN during an ALT swap, read before the next tick: REDEPLOYED still draws', async () => {
  const h = harness();
  await h.adv(6000);
  h.eng.feedFrame('$BUT,1,1,*');
  await h.adv(TICK);
  assert.equal(h.takeover() && h.takeover().kind, 'switch', 'setup: SWITCHING');
  const t0 = h.now(); h.operatorRespawn();
  assert.equal(h.eng.moment && h.eng.moment.kind, 'redeploy', 'setup: revived');
  const tk = h.takeover();   // the early read: before any tick
  assert.deepEqual(tk && { kind: tk.kind, at: tk.at }, { kind: 'redeploy', at: t0 }, 'the cancelled swap does not outrank the new life');
  await h.adv(TICK);
  assert.equal(h.card(), 'up', 'REDEPLOYED is drawn');
});
test('ARCH-2 r2: state() is pure: extra reads between ticks change nothing published or drawn', async () => {
  const once = await swapThenRespawn(0), many = await swapThenRespawn(5);
  assert.deepEqual(many, once);
});
test('ARCH-2 r2: state() is pure: a read while a takeover is over REDEPLOYED does not end the card', async () => {
  const h = await deadInScream();
  await h.adv(3000);
  h.operatorRespawn(); await h.adv(TICK);
  assert.equal(h.takeover().kind, 'redeploy', 'setup: REDEPLOYED');
  const card = () => JSON.stringify(h.eng._redeployCard);
  // a switch card that opened with no tick and no change seen yet (as the span a cancelled swap left once did)
  const now = h.now(); h.eng._cardSpans = [...(h.eng._cardSpans || []), { from: now, to: null, until: now + 1200 }];
  const before = card();
  for (let k = 0; k < 5; k++) assert.equal(h.eng.state().presented.takeover.kind, 'switched');
  assert.equal(card(), before, 'reading state() wrote nothing');
  h.eng._cardSpans.pop();
  assert.equal(h.takeover().kind, 'redeploy', 'so the card is still this life\'s takeover');
  // review r3: a kill card waiting behind the takeover is not held further by a read
  h.kill(); await h.adv(TICK);
  const hero = () => JSON.stringify(h.eng._lanes.hero);
  const held = hero(); h.gap(30);
  for (let k = 0; k < 5; k++) h.eng.state();
  assert.equal(hero(), held, 'reading state() between ticks did not move the hero\'s hold');
});

// Review r3 (Codex sol): `_heroUntil` wrote `h.heldTo` from inside `state()` (`_lanesShown`), so every read between two
// ticks while a kill card waited behind a takeover pushed its hold out. `_takeoverLatch` writes the hold now.
/** A kill, then an ALT swap over it; `reads` extra `state()` reads in each gap between ticks. The hero's published end
 *  after every tick, and once the switch card has gone. */
async function killThenSwap(reads) {
  const h = harness();
  await h.adv(6000);
  h.kill(); await h.adv(TICK);
  h.eng.feedFrame('$BUT,1,1,*');   // ALT
  const ends = [];
  for (let i = 0; i < 6000 / TICK; i++) {
    h.gap(30); for (let k = 0; k < reads; k++) h.eng.state();
    await h.adv(TICK - 30);
    const s = h.eng.state(); ends.push([s.presented.takeover && s.presented.takeover.kind, s.presented.lanes && s.presented.lanes.heroUntil, h.now()]);
  }
  return ends;
}
test('ARCH-2 r3: a kill waiting behind a swap: extra state() reads between ticks do not move its hold', async () => {
  const once = await killThenSwap(0), many = await killThenSwap(5);
  assert.ok(once.some(([k]) => k === 'switch') && once.some(([k]) => k == null), 'setup: the swap ran and ended');
  assert.deepEqual(many, once);
  // the behaviour kept: the kill gets a full LANE_HERO_MS once the takeover has gone
  const end = once.findIndex(([k], i) => i > 0 && k == null && once[i - 1][0] != null);
  assert.ok(end > 0, 'setup: the takeover ended');
  assert.ok(once[end][1] >= once[end][2] + LANE_HERO_MS, `a full hold from the end: ${once[end][1] - once[end][2]} ms`);
});

// Gate fix (screens.mjs #40c, F400 final, Tony 2026-09-26: "Not stacked. The weapon switch overlay is on top. When it
// finishes then the rest of ui is shown."): the ACTIVE bubble ran its own 900/1200 ms timers from its DRAW time, so it
// could outlive the engine's takeover, and the hero drew beside it. The switch overlays now end on the engine's end.
for (const offset of [100, 400, 700, 1000, 1300, 1600, 1900, 2200]) {
  test(`ARCH-2 gate: a kill ${offset} ms into the switch card never draws beside a switch overlay, and the overlay ends on the engine's end`, async () => {
    const h = harness();
    await h.adv(6000);
    h.eng.feedFrame('$BUT,1,1,*');   // ALT
    const t0 = h.now(), seen = [];
    const look = () => {
      const o = h.hud.overlay, sw = o.querySelector('.mo.switching'), bub = o.querySelector('.mo.switched');
      // r1 (Codex): a bubble with `out` is still on screen through its CSS fade, so it counts until it is removed
      seen.push({ t: h.now() - t0, overlay: !!sw || !!bub, bubble: !!(bub && !bub.classList.contains('out')), hero: [...h.hud.frame.querySelectorAll('#lanes .lh')].some(n => !n.classList.contains('out')), tk: h.takeover() });
    };
    await h.adv(offset, look);
    h.kill(); h.render(); look();
    await h.adv(5000, look);
    assert.ok(seen.some(s => s.tk && s.tk.kind === 'switch'), 'setup: SWITCHING ran');
    assert.ok(seen.some(s => s.hero), 'setup: the kill card drew once the card had gone');
    const up = seen.filter(s => s.bubble).map(s => s.t);
    assert.ok(up.length && up[up.length - 1] - up[0] >= 900 - 2 * TICK, `the ACTIVE bubble shows for its 900 ms before its fade: ${up[0]}..${up[up.length - 1]}`);
    for (const s of seen) {
      assert.ok(!(s.overlay && s.hero), `at ${s.t} ms the kill card drew beside a switch overlay`);
      if (!s.tk || (s.tk.kind !== 'switch' && s.tk.kind !== 'switched')) assert.ok(!s.overlay, `at ${s.t} ms a switch overlay outlived the engine's takeover: ${JSON.stringify(seen.filter(x => x.t > s.t - 300 && x.t < s.t + 300))}`);
    }
  });
}

// Tony 2026-10-13 (via brx1 and brx2): a kill card WAITS under the pickup switch card; it does not take over from it.
// The ALT gate above drives the switch by a button; this one drives it by a pickup grant (powerup-player.js `_switchCard`).
for (const offset of [100, 700, 1300, 1900]) {
  test(`pickup switch card: a kill ${offset} ms after a pickup grant waits under the card, then draws with a full hold`, async () => {
    const h = harness(golden, { stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
    await h.adv(6000);
    h.near(4); await h.adv(1100); h.near(4);
    assert.equal(h.eng.state().powerupClaim?.ready, true, 'setup: the claim is ready');
    h.near(4, { state: 0, value: 110, taker: 7 });   // the station names this player: the grant, and its switch card
    const t0 = h.now(), seen = [];
    const look = () => {
      const o = h.hud.overlay, sw = o.querySelector('.mo.switching'), bub = o.querySelector('.mo.switched');
      seen.push({ t: h.now() - t0, overlay: !!sw || !!bub, hero: [...h.hud.frame.querySelectorAll('#lanes .lh')].some(n => !n.classList.contains('out')), tk: h.takeover(), heroUntil: h.eng.state().lanes?.heroUntil || 0 });
    };
    h.render(); look();
    assert.equal(h.eng.state().powerup?.held?.name, 'ROCKETS', 'setup: the grant landed');
    assert.ok(seen[0].tk && (seen[0].tk.kind === 'switch' || seen[0].tk.kind === 'switched'), `setup: the pickup opened the switch card (${JSON.stringify(seen[0].tk)})`);
    await h.adv(offset, look);
    assert.ok(h.takeover(), `setup: the switch card is still up ${offset} ms in`);
    h.kill(); h.render(); look();
    const atKill = seen[seen.length - 1];
    assert.ok(atKill.overlay && !atKill.hero, 'when the kill lands the player sees the pickup switch card, not the kill card');
    await h.adv(5000, look);
    assert.ok(seen.some(s => s.hero), 'the kill card drew once the switch card had gone');
    for (const s of seen) {
      assert.ok(!(s.overlay && s.hero), `at ${s.t} ms the kill card drew beside the pickup switch card`);
      if (!s.tk || (s.tk.kind !== 'switch' && s.tk.kind !== 'switched')) assert.ok(!s.overlay, `at ${s.t} ms the pickup switch card outlived the engine's takeover`);
    }
    const end = seen.findIndex((s, i) => i > 0 && !s.tk && seen[i - 1].tk);
    assert.ok(end > 0, 'setup: the switch card ended');
    assert.ok(seen[end].heroUntil >= t0 + seen[end].t + LANE_HERO_MS - TICK, `a full hold from the card's end: ${seen[end].heroUntil - (t0 + seen[end].t)} ms`);
    const late = seen.find(s => s.t >= seen[end].t + LANE_HERO_MS - 2 * TICK);
    // Opus review: this harness never answers the gun's liveness probe, so the F272 lock takes over about 300 ms after
    // this sample. Name that cause if a timing change ever moves the lock inside the hold.
    assert.ok(!seen.some(s => s.t <= late.t && s.tk && s.tk.kind === 'gun_locked'), 'setup: the gun lock did not take over inside the hold');
    assert.ok(late && late.hero, `the player still sees the kill card ${LANE_HERO_MS - 2 * TICK} ms after the switch card ends`);
  });
}

test('ARCH-2 gate: an ACTIVE bubble drawn late (renders paused, as a busy phone) still ends on the engine\'s end', async () => {
  const h = harness();
  await h.adv(6000);
  h.eng.feedFrame('$BUT,1,1,*');   // ALT
  for (let i = 0; i < 80 && !(h.eng.moment && h.eng.moment.kind === 'switched'); i++) {
    const s = h.eng.state();
    if (s.switching && s.switchWindowMs - s.switchingMs <= 2 * TICK) h.pauseRenders(600);   // no render as the swap ends
    await h.adv(TICK);
  }
  assert.equal(h.eng.moment && h.eng.moment.kind, 'switched', 'setup: the swap ended');
  const until = h.eng.moment.at + E.PU_ACTIVE_CARD_MS;
  await h.adv(500);
  assert.ok(h.hud.overlay.querySelector('.mo.switching'), 'setup: the HUD has not drawn since the swap ended');
  const seen = [];
  await h.adv(1500, () => { const b = h.hud.overlay.querySelector('.mo.switched'); seen.push([h.now(), !!(b && !b.classList.contains('out')), h.takeover()]); });
  assert.ok(seen.some(([, up]) => up), 'setup: the bubble was drawn');
  for (const [t, up, tk] of seen) if (t >= until) { assert.equal(up, false, `the bubble is fading or gone at ${t - until} ms past the engine's end`); assert.equal(tk, null); }
});

// Gate fix r1 (Codex, 2ac71a1b): the bubble `_cardTick` had not seen yet was read off the shared `moment` slot. A hit
// overwrote it (the takeover was lost, the bubble faded early, a kill card could draw beside it), and a lethal self-hit
// revive left it (the PREVIOUS weapon's ACTIVE card reopened in the new life). The card has its own record now.
/** ALT, then on to the tick where the swap ran out before `_cardTick` saw the bubble (the span is closed). */
async function bubbleInTheGap() {
  const h = harness();
  await h.adv(6000);
  h.eng.feedFrame('$BUT,1,1,*');   // ALT
  for (let i = 0; i < 80 && !(h.eng.moment && h.eng.moment.kind === 'switched'); i++) await h.adv(TICK);
  const S = h.eng._cardSpans, last = S[S.length - 1];
  assert.ok(h.eng.moment.kind === 'switched' && !(last && last.to == null), 'setup: the bubble came after this tick closed the span: ' + JSON.stringify({ S, m: h.eng.moment, now: h.now() }));
  assert.ok(h.hud.overlay.querySelector('.mo.switched'), 'setup: the HUD drew the bubble');
  return h;
}
test('ARCH-2 gate r1: a hit inside the ACTIVE bubble keeps the switch takeover, and the bubble up', async () => {
  const h = await bubbleInTheGap();
  h.eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); h.eng.feedFrame('$HP,36,70,0,*');   // an enemy hit, before the next tick
  h.render();
  assert.notEqual(h.eng.moment.kind, 'switched', 'setup: the hit took the moment slot');
  assert.equal(h.takeover() && h.takeover().kind, 'switched', 'the switch card is still the takeover');
  const b = h.hud.overlay.querySelector('.mo.switched');
  assert.ok(b && !b.classList.contains('out'), 'and its bubble is not fading early');
});
test('ARCH-2 gate r1: a lethal self-hit revive inside the ACTIVE bubble does not reopen the old weapon\'s card', async () => {
  const h = await bubbleInTheGap();
  const deaths = h.eng.deaths;
  h.eng.feedFrame('$HIR,4,0,7,1,9,0,3,*'); h.eng.feedFrame('$HP,0,0,0,*'); h.eng.feedFrame('$LCD,0,0,0,1,1,1,*');   // our own shot (F438)
  assert.ok(h.eng.alive && h.eng.deaths === deaths, 'setup: the self-hit revived at once, with no death');
  const tk = h.takeover();
  assert.ok(!tk || tk.kind !== 'switched', `no ACTIVE takeover in the new life: ${JSON.stringify(tk)}`);
});
