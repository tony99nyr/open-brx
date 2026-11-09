// The HUD's SWITCHING timer against the gun model (src/gunmodel.js). Tony 2026-11-09 (option 1): the phone keeps the gun's
// own rule and adds no swap write, so SWITCHING lasts until the gun can fire the target: the later of the bind (ALT plus the
// target's tok15, as the phone holds the trigger) and the gun's rebind delay (the release of the last pull that fired plus
// the fired slot's tok15). The model gets each write at the hand-off; the gun reads it one air time later
// (E.GUN_SPAWN_AIR_MS), so a bind-limited swap closes no sooner than the model's `readyAt()` plus that.
//
// The bench rows: the Assault Rifle (slot 0) tok15 850, full auto; the USP-S (slot 1) tok15 500, semi auto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import { GunModel } from '../src/gunmodel.js';
import { fixtureNames, loadFixture, benchFrames } from './bench-gun-drive.mjs';
import { base, buildConfig } from './golden-trace-runner.mjs';
import { mkStorage, flush } from './_helpers.mjs';

const STEP = 5, AIR = E.GUN_SPAWN_AIR_MS;

/** A fresh live life on the bench loadout, the gun model as the gun. `script` is [[ms, edge]] from the first edge (`down`,
 *  `up` for the trigger, `alt`). Returns the ALT times, when SWITCHING closed after each, the model's ready time for it,
 *  and the HUD bar's window. */
async function drive(script, { runMs = 3000, queueBindMs = 0 } = {}) {
  const model = new GunModel({ auto: 'timed' });
  let clock = base.clock0_ms;
  const timers = [], logs = [];
  // `queueBindMs`: a swap's bind waits that long in the link's queue, then leaves (`onFrameSent`) and reaches the model
  const writer = (fr, why, opts) => {
    const late = queueBindMs > 0 && /^ALT: swap/.test(String(why)) && fr.some(f => /^\$BMAP,0,[0-9],/.test(f));
    if (!late) { for (const f of fr) model.write(f, clock); return undefined; }
    return new Promise(res => timers.push({ at: clock + queueBindMs, fn: () => {   // as brxlink.js `write`: settles once sent
      for (const f of fr) { model.write(f, clock); if (opts && opts.onFrameSent) opts.onFrameSent(f); }
      res(true);
    } }));
  };
  const eng = new E.Engine({ writer, emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(),
    log: m => logs.push(String(m)), delay: (ms, fn) => timers.push({ at: clock + ms, fn }), rng: () => 0 });
  const runTimers = () => { for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > clock) return; timers.shift().fn(); } };
  const pump = () => { for (let n = 0; n < 50; n++) { const o = model.take(); if (!o.length) return; for (const x of o) eng.feedFrame(x.f); } };
  const swaps = [];
  let open = [];   // the swaps on screen: a retarget keeps the first one open with the second
  const watch = () => {
    const st = eng.state();
    if (open.length && !st.switching) { for (const s of open) s.closeAt = clock; open = []; }
    // ready: the model's earliest pull on the target, with the trigger up (`readyAt` reads a NEW pull)
    for (const s of open) s.window = st.swapWindowMs;
    for (const s of swaps) if (s.readyAt == null && !model.trigger && model.bound === s.to && model.readyAt(clock) <= clock) s.readyAt = model.readyAt(clock);
  };
  const until = async end => {
    while (clock < end) {
      clock = Math.min(end, clock + STEP);
      runTimers(); model.advance(clock); pump(); eng.tick(); runTimers(); pump();
      await flush(); pump(); watch();
    }
  };
  const fx = loadFixture(fixtureNames()[0]), frames = benchFrames(fx), config = buildConfig();
  const team = config.teams.find(t => t.team_id === base.player.team_id);
  const player = { ...base.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'usp' }] } };
  eng.onBleConnected({ ...base.gun_name });
  eng.onMcMessage({ kind: 'assign', body: { player, team, roster: base.roster } });
  eng.onMcMessage({ kind: 'config', body: { config, frames, roster: base.roster } });
  await flush(); pump();
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: config.config_id, seq: 1, countdown_s: 0 } });
  await until(clock + 5000);
  assert.equal(eng.state().weaponArming, null, 'setup: the gun is ready');
  const t0 = clock;
  const edge = (id, s) => { eng.feedFrame(`$BUT,${id},${s},*`); model.button(id, s, clock); pump(); };
  for (const [ms, what] of script) {
    await until(t0 + ms);
    if (what === 'down') edge(0, 1);
    else if (what === 'up') edge(0, 0);
    else if (what === 'alt') {
      edge(1, 1); edge(1, 0);
      const sw = { altAt: clock - t0, to: eng.activeSlot, closeAt: null, readyAt: null, window: null };
      for (const s of open) s.to = sw.to;   // retargeted: the open display now shows the new target
      open.push(sw); swaps.push(sw);
    }
    await flush(); pump(); watch();
  }
  await until(clock + runMs);
  drive.logs = logs;
  return swaps.map(s => ({ ...s, closeAt: s.closeAt == null ? null : s.closeAt - t0, readyAt: s.readyAt == null ? null : s.readyAt - t0 }));
}

/** The HUD closes no sooner than the model's ready time, and within the air time and two steps of it. The bind edge carries
 *  the air time (the gun reads the write one air time after it leaves: checked per test); the release edge needs none,
 *  because the phone hears `$BUT,0,0` after the gun's own release. */
function closesWithTheGun(s, msg) {
  assert.ok(s.readyAt != null && s.closeAt != null, `${msg}: ${JSON.stringify(s)}`);
  assert.ok(s.closeAt >= s.readyAt, `${msg}: SWITCHING closed before the gun could fire: ${JSON.stringify(s)}`);
  assert.ok(s.closeAt <= s.readyAt + AIR + 2 * STEP, `${msg}: SWITCHING stayed up after the gun could fire: ${JSON.stringify(s)}`);
}

test('swap timer: a cold swap to the USP-S shows its tok15 (500 ms), plus the air time', async () => {
  const [s] = await drive([[0, 'alt']]);
  assert.equal(drive.logs.filter(l => /held pull hit the 5 s cap/.test(l)).length, 0, 'no cap on a swap with no held pull');
  assert.equal(s.to, 1);
  closesWithTheGun(s, 'cold swap');
  assert.ok(s.closeAt >= s.readyAt + AIR, `the gun reads the bind one air time after it leaves: ${JSON.stringify(s)}`);
  assert.ok(s.closeAt - s.altAt >= 500 + AIR && s.closeAt - s.altAt <= 500 + AIR + 2 * STEP, `about 500 ms: ${JSON.stringify(s)}`);
  assert.equal(s.window, s.closeAt - s.altAt - STEP, 'the bar fills over the swap\'s own window');
});

test('swap timer: AR fire, release, then ALT to the USP-S shows the AR\'s rebind delay (about 850 ms), not the USP-S\'s 500', async () => {
  const [s] = await drive([[0, 'down'], [300, 'up'], [320, 'alt']]);
  assert.equal(s.to, 1);
  closesWithTheGun(s, 'fire then swap');
  assert.ok(s.closeAt >= 300 + 850, `the release plus the AR's tok15: ${JSON.stringify(s)}`);
  assert.ok(s.closeAt - s.altAt >= 800, `about 850 ms on screen: ${JSON.stringify(s)}`);
});

test('swap timer: an AR burst held through the ALT ends at the release: the delay counts from it', async () => {
  const [s] = await drive([[0, 'down'], [200, 'alt'], [700, 'up']]);
  closesWithTheGun(s, 'held burst');
  assert.ok(s.closeAt >= 700 + 850, `the release plus the AR's tok15: ${JSON.stringify(s)}`);
  assert.ok(s.window > 850, `the window grew while the burst was held: ${JSON.stringify(s)}`);
});

test('swap timer: a double ALT retargets: the timer runs from the second press to the final target\'s tok15', async () => {
  const swaps = await drive([[0, 'alt'], [200, 'alt']]);
  assert.equal(swaps.length, 2);
  const [a, b] = swaps;
  assert.equal(b.to, 0, 'the second ALT goes back to the AR');
  assert.equal(a.closeAt, b.closeAt, 'one SWITCHING display, closed once');
  closesWithTheGun(b, 'retarget');
  assert.ok(b.closeAt >= b.readyAt + AIR, `the gun reads the bind one air time after it leaves: ${JSON.stringify(b)}`);
  assert.ok(b.closeAt - 200 >= 850 + AIR && b.closeAt - 200 <= 850 + AIR + 2 * STEP, `the AR's 850 from the second ALT: ${JSON.stringify(b)}`);
});


test('swap timer: a bind that waits 300 ms in the link\'s queue moves the close 300 ms later (the frame-sent stamp)', async () => {
  const [a] = await drive([[0, 'alt']]);
  const [b] = await drive([[0, 'alt']], { queueBindMs: 300 });
  closesWithTheGun(b, 'queued bind');
  assert.ok(b.closeAt >= b.readyAt + AIR, `the gun reads the bind one air time after it leaves: ${JSON.stringify(b)}`);
  assert.ok(Math.abs(b.closeAt - a.closeAt - 300) <= STEP, `300 ms later: ${JSON.stringify({ a, b })}`);
});

test('swap timer: a live pull whose release the link lost stops holding SWITCHING up SWAP_HELD_MAX_MS after its last round', async () => {
  const [s] = await drive([[0, 'down'], [200, 'alt']], { runMs: E.SWAP_HELD_MAX_MS + 2000 });
  assert.ok(s.closeAt != null, `SWITCHING closed: ${JSON.stringify(s)}`);
  assert.ok(s.closeAt > E.SWAP_HELD_MAX_MS && s.closeAt <= 200 + E.SWAP_HELD_MAX_MS + 850 + 2 * STEP, `about SWAP_HELD_MAX_MS plus the AR's tok15: ${JSON.stringify(s)}`);
  assert.equal(drive.logs.filter(l => /held pull hit the 5 s cap/.test(l)).length, 1, 'the cap is logged once');
});
