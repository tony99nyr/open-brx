// F590 part 2 (brx3 review 2026-10-24, P3-3): utility-hill-clock.test.mjs drives the phone station's `controlTick` alone, so
// its countdown and deadline cases never said what the player engine books for the same timeline. One timeline through both:
// nothing in the lobby or the countdown, the same live total within one tick, nothing after the whistle.
// Break-checked 2026-10-24: removing engine.js's `endT` expiry in `tick()` fails "engine accrued after the deadline", and
// removing utility.js's `hillEndsAt` step clamp in `controlTick` fails "phone accrued after the deadline". The engine's
// countdown gate is the `phase === 'live'` block in `tick()` (hill.js `accrue` repeats it), and go-live clears any earlier tally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ADVERT_CONTROL_STATE } from '../src/transport/contract.gen.js';
import { mkStorage, makeEl } from './_helpers.mjs';

const elements = new Map();
function elFor(id) { if (!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); }
global.document = { getElementById: elFor, querySelectorAll: () => [], documentElement: { dataset: {} }, activeElement: null };
global.window = {};
Object.defineProperty(global, 'navigator', { value: {}, configurable: true });
const local = new Map();
global.localStorage = { getItem: k => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)), removeItem: k => local.delete(k) };
global.location = { search: '?stage', href: 'http://stage/?stage', replace() {} };
const realSetInterval = global.setInterval, realSetTimeout = global.setTimeout;
global.setInterval = (...a) => { const h = realSetInterval(...a); h.unref?.(); return h; };
global.setTimeout = (...a) => { const h = realSetTimeout(...a); h.unref?.(); return h; };

await import('../src/utility.js');
const { Engine } = await import('../src/engine.js');
for (const until = Date.now() + 5000; !global.window.brxUtility && Date.now() < until;) await new Promise(r => realSetTimeout(r, 5));
const utility = global.window.brxUtility;
assert.ok(utility, 'utility.js did not publish its stage API');

const bundle = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const HELD = ADVERT_CONTROL_STATE.held;
function engineHarness() {
  let clock = 1_000_000;
  const config = { config_id: bundle.config_id, mode: 'koth', environment: 'outdoor', night: false, time_limit_s: 10,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const team = config.teams[0];
  const eng = new Engine({ writer: () => true, emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {}, delay: (_ms, fn) => fn() });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team, roster: [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster: [] } });
  return { eng, advance(ms) { clock += ms; return clock; }, get clock() { return clock; } };
}
const entry = () => ({ role: 'station', id: 9, kind: 'control', team: 1, state: HELD, value: 100, seq: 1, game: 1, threshold: -74, rssi: -50, raw: -50, present: true });

test('engine and phone accrue possession only within the same match window', async () => {
  const realNow = Date.now;
  let t0 = realNow();
  Date.now = () => t0;
  utility.useStationClock(() => t0);   // F590 (3): the station runs on its own clock, so drive that one too
  try {
    const h = engineHarness();
    const hill = { kind: 'control', team: 255, id: 9 };
    await utility.applyStationConfig({ ...hill, game: 190 });
    utility.settings.captureS = 10;
    utility.presence.players = () => [{ id: 7, team: 1, state: 1, present: true, inCircle: true, fading: false }];
    // BLUE (tid 1) stands on the point through the lobby, the countdown, the match and past the whistle.
    for (let ms = 0; ms <= 10_000; ms += 250) {
      t0 += 250; utility.controlTick(t0);   // one clock for both: the station's own `Date.now` moves with the ticks
      h.eng.setStations([entry()]); h.eng.tick();
      h.advance(250);
    }
    h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: h.clock + 5000, config_id: bundle.config_id, seq: 1, countdown_s: 5 } });
    await utility.applyStationConfig({ ...hill, game: 190, starts_in_ms: 5000, ends_in_ms: 15_000 });
    utility.settings.captureS = 0.25;   // START resets the point: a one-tick capture, so the station holds it from go-live as the engine's advert says
    const start = h.clock;
    assert.equal(h.eng.phase, 'armed');
    assert.equal((h.eng.hold['9'] || {})[1] || 0, 0, 'engine booked lobby possession');
    assert.equal(utility.point.holdMs[1] || 0, 0, 'phone booked lobby possession');

    for (let ms = 250; ms <= 5000; ms += 250) {
      t0 += 250; utility.controlTick(t0);
      h.advance(250); h.eng.setStations([entry()]); h.eng.tick();
    }
    assert.equal(h.eng.phase, 'live');
    const engineCountdown = (h.eng.hold['9'] || {})[1] || 0;
    assert.equal(engineCountdown, 0, 'engine booked countdown possession');
    assert.equal(utility.point.holdMs[1] || 0, 0, 'phone booked countdown possession');

    for (let ms = 250; ms <= 10_000; ms += 250) {
      t0 += 250; utility.controlTick(t0);
      h.advance(250); h.eng.setStations([entry()]); h.eng.tick();
    }
    const engineLive = (h.eng.hold['9'] || {})[1] || 0;
    const phoneLive = utility.point.holdMs[1] || 0;
    assert.ok(engineLive >= 9750 && engineLive <= 10_000, `engine live hold: ${engineLive}`);
    assert.ok(phoneLive >= 9750 && phoneLive <= 10_000, `phone live hold: ${phoneLive}`);
    assert.ok(Math.abs(engineLive - phoneLive) <= 250, `engine ${engineLive} ms, phone ${phoneLive} ms`);

    for (let ms = 250; ms <= 5000; ms += 250) {
      t0 += 250; utility.controlTick(t0);
      h.advance(250); h.eng.setStations([entry()]); h.eng.tick();
    }
    assert.equal((h.eng.hold['9'] || {})[1] || 0, engineLive, 'engine accrued after the deadline');
    assert.equal(utility.point.holdMs[1] || 0, phoneLive, 'phone accrued after the deadline');
    assert.equal(h.clock, start + 20_000);
  } finally { Date.now = realNow; utility.useStationClock(null); }
});
