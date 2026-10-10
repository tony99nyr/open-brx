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
const PAGE = '<div id="stage"><div id="frame"><div id="hud"></div><div id="overlay"></div><div id="chips"></div>'
  + '<div id="diag"></div><button id="info"></button><button id="skin"></button></div></div>';

/** A live match on a clock-driven `delay` (the play queue really waits for the gun), drawn by a real Hud. The HUD's
 *  `setTimeout`s run on the same clock, so its fade ends when the engine clock passes them. */
function harness(bundle = golden) {
  const timed = [], timers = [], hudTimers = []; let clock = 1_000_000, hud = null;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: bundle.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'manual' }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
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
  const render = () => inHud(() => {
    for (const t of hudTimers) if (t.fn && t.at <= clock) { const f = t.fn; t.fn = null; f(); }
    hud.render(eng.state());
  });
  hud = inHud(() => new Hud(doc, {}));
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster: [] } });
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
  const job = h.eng._playWaiting;
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
  const tk = h.takeover();
  assert.deepEqual({ kind: tk.kind, at: tk.at, until: tk.until }, { kind: 'redeploy', at: t0, until: t0 + Math.max(1700, RP.trigger_ms + 400) });
  assert.equal(h.card(), 'up');
  await h.adv(tk.until - t0 - TICK);
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
