// Swap and reload are P0 core gameplay (Tony, 2026-11-01): every ALT switches, the lever always reloads the weapon in
// hand, no reload card times out, and the desync counter stays at zero. The desync counter is the engine log line
// `gun was on slot N: the HUD showed slot M` (ammo.js `gunWasOn`): the gun's own slot report contradicted the phone.
//
// This is a seeded random torture run. It drives the REAL engine (src/engine.js) and a real Hud (on the fake DOM) on a
// mocked clock, against a two-slot gun MODEL written here. The model follows the bench facts the engine is built on:
//   - ALT toggles slot 0 and slot 1, and the gun ignores ALT while it is itself reloading (bench 2026-10-02, F650 M1).
//   - The lever reloads the LAST-FIRED slot, not the slot in hand (F542, bench 2026-11-01); after a spawn that is slot 0.
//     The reload takes the weapon's `$WEAP` reload time (token 18) times 1.2 (F27: hardware runs 1.22x to 1.29x slower).
//   - `$AMMO` sets a slot's magazine and reserve and the gun echoes it as `$ALCD` 40 ms later (fake.py, fakegun.js).
//   - A `$WEAP` write resets the slot to its clip and t40 reserve; `$SPAWN` refills every slot and puts the gun on slot 0.
//   - Melee is button 8 (`$BMAP,8,4`): `$ALCD,1,100,4,0,0` 3 to 18 ms after the press (F665), at most one swing per
//     melee `$WEAP` token 14.
//   - `$QUERY` answers `$LCD` with the slot of the LAST SHOT (bench 2026-10-17, ammo.js `switchTick`).
// Simplified against the real gun: one round per trigger pull (no automatic fire), the trigger is refused while the
// gun reloads either slot, a melee swing does not move the last-fired latch, and every reply is lossless and in order.
//
// Each action settles before the next one (the clock runs past the reload time, the swap window and the echo window),
// and then the invariants are checked. A failure prints the seed, the action index and the last 20 actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';
import { Hud } from '../src/hud/hud.js';
import { FakeDocument } from './hud-fake-dom.mjs';
import { mkStorage, flush } from './_helpers.mjs';
import { DEMO_WEAPONS, DEMO_PERKS } from '../src/demo-catalog.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const TICK = 100;   // the engine's tick on this clock (app.js ticks every 250 ms; finer is stricter)
const GUN = { name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' };
const PAGE = '<div id="stage"><div id="frame"><div id="hud"></div><div id="overlay"></div><div id="chips"></div>'
  + '<div id="diag"></div><button id="info"></button><button id="skin"></button></div></div>';

// The slot-1 `$WEAP` rows and spawn `$AMMO` rows compile.py writes for these secondaries (Compiler.compile, indoor TDM,
// assault_rifle in slot 0). The golden bundle's own slot 1 is the Shotgun, whose chain reload keeps the gun's own
// reload (ammo.js `softReloadNeeded`), so it is swapped out here. The catalogue has no SMG.
const SECONDARY = {
  suppressor: { weap: '$WEAP,1,,100,0,0,8,0,,,,,,,,140,850,75,384,2000,0,0,100,100,,0,2,50,Q06,,,,D26,D25,D24,D18,,,,,75,192,75,*', ammo: '$AMMO,1,75,384,1,*' },
  usp: { weap: '$WEAP,1,,100,0,3,10,0,,,,,,,,190,500,12,240,2200,0,7,100,100,,0,2,50,Q04,,,,D08,D07,D06,D18,,,,,12,120,75,*', ammo: '$AMMO,1,12,240,1,*' },
};
function bundleFor(sec) {
  const b = JSON.parse(JSON.stringify(golden));
  const s = SECONDARY[sec];
  const fix = list => list.map(f => (f.startsWith('$AMMO,1,') ? s.ammo : f));
  b.head = b.head.map(f => (f.startsWith('$WEAP,1,') ? s.weap : f));
  b.spawn = fix(b.spawn); b.revive = fix(b.revive);
  for (const k of ['spawn', 'revive', 'revive_station']) b.respawn_profile[k] = fix(b.respawn_profile[k]);
  assert.ok(b.head.some(f => /^\$BMAP,8,4,/.test(f)), 'setup: the head binds button 8 to melee');
  return b;
}

/** mulberry32: a small deterministic PRNG, so a seed replays the same run. */
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** The gun model. `at(ms, fn)` schedules on the shared mocked clock; `feed(frame)` is the gun talking to the engine. */
class GunModel {
  constructor(at, feed, now) {
    Object.assign(this, { at, feed, now });
    this.slots = {};                 // slot -> {mag, res, clip, carried, t40, fireMs, swapMs, reloadMs}
    this.active = 0; this.latch = 0; this.spawned = false;
    this.hp = 0; this.armor = 0; this.shield = 0; this.max = [45, 70, 0];
    this.triggerLive = false; this.reload = null; this.swapUntil = 0; this.lastRoundAt = -1e9; this.lastSwingAt = -1e9;
    this.rounds = 0;                 // rounds fired while alive in the match: `eng.shots` must equal this
    this.pending = 0;                // replies still in flight
  }
  slot(s) { return this.slots[s] || (this.slots[s] = { mag: 0, res: 0, clip: 0, carried: 0, t40: 0, fireMs: 0, swapMs: 0, reloadMs: 0 }); }
  later(ms, fn) { this.pending++; this.at(ms, () => { this.pending--; fn(); }); }
  alcd(s) { const x = this.slot(s); return `$ALCD,${x.mag},100,${s},${x.res},0,*`; }
  /** One write from the engine. */
  wrote(frames) {
    for (const f of frames) {
      const t = f.replace(/,?\*$/, '').split(','), cmd = t[0], n = i => (/^-?\d+$/.test(t[i] || '') ? +t[i] : null);
      if (cmd === '$PSET') { for (let i = 0; i < 3; i++) if (n(i + 3) != null) this.max[i] = n(i + 3); }
      else if (cmd === '$WEAP') {
        const s = n(1); if (s == null) continue;
        const x = this.slot(s);
        x.clip = n(17) ?? x.clip; x.carried = n(18) ?? x.carried; x.t40 = n(41) ?? Math.floor(x.carried / 2);
        x.fireMs = n(15) ?? 0; x.swapMs = n(16) ?? 0; x.reloadMs = n(19) ?? 1500;
        x.mag = x.clip; x.res = x.t40;
        this.later(40, () => this.feed(this.alcd(s)));
      } else if (cmd === '$AMMO') {
        const s = n(1); if (s == null) continue;
        const x = this.slot(s);
        if (n(2) != null) x.mag = n(2);
        if (n(3) != null) x.res = n(3);
        this.later(40, () => this.feed(this.alcd(s)));
      } else if (cmd === '$BMAP' && t[1] === '0') this.triggerLive = t[2] !== '98';
      else if (cmd === '$SPAWN') {
        this.spawned = true; [this.hp, this.armor] = this.max; this.shield = 0;
        this.active = 0; this.latch = 0; this.reload = null; this.swapUntil = 0;
        for (const s of Object.keys(this.slots)) { const x = this.slots[s]; if (+s < 2) { x.mag = x.clip; x.res = x.carried; } }
        const x = this.slot(0);
        this.later(0, () => this.feed(`$LCD,${this.hp},${this.armor},0,0,${x.mag},${x.res},*`));
      } else if (cmd === '$LIFE') {
        const d = [1, 2, 3].map(i => n(i) ?? 0), mode = n(4);
        if (!this.spawned && d.every(v => v === 0)) { this.later(0, () => this.feed('$HP,0,0,0,*')); continue; }
        if (mode === 1 || mode === 2) [this.hp, this.armor, this.shield] = d.map((v, i) => Math.max(0, Math.min(mode === 1 ? this.max[i] : 1e6, v)));
        else { this.hp = Math.max(0, Math.min(this.max[0], this.hp + d[0])); this.armor = Math.max(0, Math.min(this.max[1], this.armor + d[1])); this.shield = Math.max(0, Math.min(this.max[2], this.shield + d[2])); }
        this.spawned = this.hp > 0;
        const x = this.slot(0);
        this.later(0, () => this.feed(this.spawned ? `$HP,${this.hp},${this.armor},${this.shield},*` : `$LCD,0,0,0,0,${x.mag},${x.res},*`));
      } else if (cmd === '$QUERY') {
        const x = this.slot(this.latch);
        this.later(0, () => { this.feed(`$QUERY,7,1,${this.max[0]},${this.max[1]},${this.max[2]},,1,*`); this.feed(`$LCD,${this.hp},${this.armor},${this.shield},${this.latch},${x.mag},${x.res},*`); });
      }
    }
    if (frames.includes('$CLEAR,*') && frames.some(f => f.startsWith('$SP,99'))) this.spawned = false;
  }
  get live() { return this.spawned && this.hp > 0; }
  // ---- the player's hands ----
  trigger() {
    this.feed('$BUT,0,1,*');
    const x = this.slot(this.active), now = this.now();
    let fired = false;
    if (this.live && this.triggerLive && !this.reload && now >= this.swapUntil && x.mag > 0 && now - this.lastRoundAt >= x.fireMs) {
      fired = true; this.lastRoundAt = now;
      const s = this.active;
      this.later(4, () => { x.mag--; this.latch = s; this.rounds++; this.feed(this.alcd(s)); });
    }
    this.later(60, () => this.feed('$BUT,0,0,*'));
    return fired;
  }
  alt() {
    this.feed('$BUT,1,1,*');
    let took = false;
    if (this.live && !this.reload) {
      took = true; this.active = this.active ? 0 : 1;
      this.swapUntil = this.now() + Math.max(this.slot(0).swapMs, this.slot(1).swapMs);   // bench 2026-09-04: the larger slot wins
    }
    this.later(80, () => this.feed('$BUT,1,0,*'));
    return took;
  }
  lever() {
    this.feed('$BUT,2,1,*');
    let s = null;
    if (this.live && !this.reload) {
      const x = this.slot(this.latch);
      if (x.mag < x.clip && x.res > 0) {
        s = this.latch;
        const life = this.reload = { slot: s };
        this.later(Math.round(x.reloadMs * 1.2), () => {
          if (this.reload !== life) return;   // a spawn or a death cancelled it
          this.reload = null;
          const take = Math.min(x.clip - x.mag, x.res); x.mag += take; x.res -= take;
          this.feed(this.alcd(s));
        });
      }
    }
    this.later(60, () => this.feed('$BUT,2,0,*'));
    return s;
  }
  melee(rng) {
    this.feed('$BUT,8,1,*');
    const now = this.now(); let swung = false;
    if (this.live && now - this.lastSwingAt >= this.slot(4).fireMs) {
      swung = true; this.lastSwingAt = now;
      this.later(3 + Math.floor(rng() * 16), () => this.feed('$ALCD,1,100,4,0,0,*'));
    }
    this.later(120, () => this.feed('$BUT,8,0,*'));
    return swung;
  }
  die() {
    this.hp = 0; this.armor = 0; this.shield = 0; this.spawned = false; this.reload = null;
    const x = this.slot(0);
    this.feed('$HIR,4,0,19,2,106,0,3,*'); this.feed('$HP,0,0,0,*'); this.feed(`$LCD,0,0,0,0,${x.mag},${x.res},*`);
  }
}

function harness(sec, seed) {
  const bundle = bundleFor(sec);
  let clock = 1_000_000, lastTick = clock;
  const timers = [], hudTimers = [], logs = [];
  const at = (ms, fn) => timers.push({ at: clock + ms, fn, seq: timers.length ? timers[timers.length - 1].seq + 1 : 0 });
  let eng = null;
  const gun = new GunModel(at, f => eng.feedFrame(f), () => clock);
  eng = new E.Engine({ writer: fr => { gun.wrote(fr); }, emit: () => {}, report: () => {}, now: () => clock, wallNow: () => clock,
    synced: () => true, storage: mkStorage(), log: m => logs.push({ at: clock, m: String(m) }), delay: (ms, fn) => at(ms, fn), rng: () => 0 });
  eng._opReviveFloorMs = 0;   // F530: the operator respawn's F13 hold has its own tests
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: bundle.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 3600,
    respawn: { type: 'manual' }, scoring: { frag_limit: 0, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', voice: 'male',
    loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: sec }] } };
  const runDue = () => {
    for (;;) {
      let i = -1;
      for (let j = 0; j < timers.length; j++) if (timers[j].at <= clock && (i < 0 || timers[j].at < timers[i].at || (timers[j].at === timers[i].at && timers[j].seq < timers[i].seq))) i = j;
      if (i < 0) return;
      timers.splice(i, 1)[0].fn();
    }
  };
  /** Run the clock to `clock + ms`: every timer at its own time, and the engine's tick every TICK. */
  const advance = async ms => {
    const end = clock + ms;
    while (clock < end) {
      let next = Math.min(end, lastTick + TICK);
      for (const t of timers) if (t.at > clock && t.at < next) next = t.at;
      clock = Math.max(clock, next);
      runDue();
      if (clock >= lastTick + TICK) { lastTick = clock; eng.tick(); runDue(); await flush(); runDue(); }
    }
  };
  // the real Hud on the fake DOM, its timers and `Date.now` on the engine clock (takeover.test.mjs)
  const doc = new FakeDocument(PAGE);
  const fakes = { document: doc, window: { innerWidth: 844, innerHeight: 390, addEventListener() {} }, getComputedStyle: () => ({ bottom: '8px' }),
    setTimeout: (fn, ms) => { hudTimers.push({ fn, at: clock + ms }); return hudTimers.length; },
    clearTimeout: id => { if (id && hudTimers[id - 1]) hudTimers[id - 1].fn = null; } };
  const inHud = fn => {
    const prior = Object.fromEntries(Object.keys(fakes).map(k => [k, globalThis[k]])), now = Date.now;
    Object.assign(globalThis, fakes); Date.now = () => clock;
    try { return fn(); } finally { Date.now = now; for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
  };
  const hud = inHud(() => new Hud(doc, {}));
  const render = () => inHud(() => {
    for (const t of hudTimers) if (t.fn && t.at <= clock) { const f = t.fn; t.fn = null; f(); }
    hud.render(eng.state());
  });
  const text = sel => { const el = doc.querySelector(sel); return el ? el.textContent : null; };

  const h = {
    eng, gun, logs, render, text, advance, rng: mulberry32(seed), now: () => clock,
    async start() {
      eng.onBleConnected(GUN);
      eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [], catalog: { weapons: DEMO_WEAPONS, perks: DEMO_PERKS } } });
      eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster: [] } });
      eng.feedFrame('$LCD,0,0,0,0,0,0,*');   // F549: `$START` answers a zeroed `$LCD`
      await advance(500);
      eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: bundle.config_id, seq: 1, countdown_s: 0 } });
      await h.settle(4000);
    },
    /** Quiet: no gun reply in flight, no gun reload, no reload or swap open on the phone, the trigger live. */
    quiet() {
      const am = eng.am;
      return gun.pending === 0 && !gun.reload && !am.reloading && !am.switching && clock >= gun.swapUntil
        && !am.acctEchoing(0) && !am.acctEchoing(1) && !eng.rc.active && !eng.stunned && (!eng.alive || gun.triggerLive);
    },
    async settle(min = 0, cap = 9000) {
      const t0 = clock;
      await advance(min);
      while (clock - t0 < cap && !h.quiet()) await advance(TICK);
      await advance(200);   // a margin past the last reply
    },
    operatorRespawn() { eng.onMcMessage({ kind: 'control', body: { cmd: 'respawn', match_id: 'm1' } }); },
  };
  return h;
}

const CAP = { 0: 32, 1: { suppressor: 75, usp: 12 } };
const NAME = { suppressor: 'SUPPRESSOR', usp: 'USP-S' };
const pad2 = n => String(n).padStart(2, '0');

/** One seeded run of `n` actions. Returns {counts, failures}: every invariant break, with its replay context. */
async function torture(sec, seed, n, { combos = false } = {}) {
  const h = harness(sec, seed), { eng, gun, rng } = h;
  await h.start();
  const done = [], fails = [], counts = { fire: 0, alt: 0, lever: 0, melee: 0, die: 0, relink: 0, leverAlt: 0, idle: 0, swings: 0, rounds: 0 };
  let logMark = 0, lastSwingAtEng = null;
  const pick = () => {
    const r = rng() * 100;
    if (r < 32) return 'fire';
    if (r < 40) return 'burst';
    if (r < 58) return 'alt';
    if (r < 76) return 'lever';
    if (r < 86) return 'melee';
    if (r < 89) return 'die';
    if (r < 91) return 'relink';
    if (combos && r < 97) return 'leverAlt';
    return 'idle';
  };
  const fail = (i, what) => fails.push(`seed ${seed} (${sec}) action #${i} ${done[done.length - 1]}: ${what}\n  last actions: ${done.slice(-20).join(' | ')}\n  last log: ${h.logs.slice(-12).map(l => `${l.at - 1_000_000} ${l.m}`).join('\n            ')}`);
  for (let i = 0; i < n && fails.length === 0; i++) {
    const kind = pick();
    const before = { active: gun.active, latch: gun.latch, mags: [gun.slot(0).mag, gun.slot(1).mag], res: [gun.slot(0).res, gun.slot(1).res],
      shots: eng.shots, recoil: eng._recoil ? { burst: eng._recoil.burst, at: eng._recoil.lastShotAt } : null, swing: eng.am.lastSwing };
    let note = '', tookAlt = null, swung = false, leverExpect = null;
    if (kind === 'fire') { const f = gun.trigger(); note = f ? 'round' : 'no round'; counts.fire++; await h.settle(120); }
    else if (kind === 'burst') {
      const k = 2 + Math.floor(rng() * 5);
      for (let j = 0; j < k; j++) { gun.trigger(); await h.advance(gun.slot(gun.active).fireMs + 10); }
      note = `${k} pulls`; counts.fire += k; await h.settle(120);
    } else if (kind === 'alt') { tookAlt = gun.alt(); note = tookAlt ? `to ${gun.active}` : 'ignored'; counts.alt++; await h.settle(900); }
    else if (kind === 'lever' || kind === 'leverAlt') {
      const held = gun.active, x = gun.slot(held);
      if (gun.live && x.mag < x.clip && x.res > 0) leverExpect = { slot: held, mag: Math.min(x.clip, x.mag + x.res) };
      const s = gun.lever(); note = `gun reloads ${s == null ? 'nothing' : 'slot ' + s}, held ${held}`;
      if (kind === 'leverAlt') {
        await h.advance(150 + Math.floor(rng() * 500));
        tookAlt = gun.alt(); note += tookAlt ? `, ALT to ${gun.active}` : ', ALT ignored by the gun';
        if (tookAlt) leverExpect = null;   // the player swapped away: the reload of the old weapon may be cut short
        counts.leverAlt++;
      } else counts.lever++;
      await h.settle(400);
    } else if (kind === 'melee') { swung = gun.melee(rng); note = swung ? 'swing' : 'refused (cooldown)'; counts.melee++; if (swung) counts.swings++; await h.settle(150); }
    else if (kind === 'die') {
      gun.die(); await h.advance(1500 + Math.floor(rng() * 2000));
      if (eng.alive) fail(i, 'the engine is still alive after the gun died');
      h.operatorRespawn(); counts.die++;
      await h.settle(2500, 12000);
      if (!eng.alive || !gun.live) fail(i, `no respawn (engine alive ${eng.alive}, gun live ${gun.live})`);
    } else if (kind === 'relink') {
      eng.onBleDropped(); await h.advance(300 + Math.floor(rng() * 1500)); eng.onBleConnected(GUN); counts.relink++;
      await h.settle(1500, 12000);
    } else { await h.advance(200 + Math.floor(rng() * 3000)); counts.idle++; }
    done.push(`${i}:${kind}${note ? '(' + note + ')' : ''}`);

    // ---- the invariants ----
    const fresh = h.logs.slice(logMark); logMark = h.logs.length;
    const desync = fresh.filter(l => l.m.startsWith('gun was on slot'));
    if (desync.length) fail(i, `desync: ${desync.map(l => l.m).join('; ')}`);
    const altIgnored = fresh.filter(l => /ALT ignored/.test(l.m));
    if (altIgnored.length && tookAlt !== false) fail(i, `the gun took ALT but the engine logged: ${altIgnored.map(l => l.m).join('; ')}`);
    if (tookAlt === false && !altIgnored.length && eng.am.altEvidencePending != null) fail(i, 'the gun ignored ALT but the engine opened a swap');
    const timeouts = fresh.filter(l => /reload did NOT take \(timeout\)/.test(l.m));
    if (timeouts.length || (eng.am.reloadOutcome && eng.am.reloadOutcome.why === 'timeout')) fail(i, `a reload ended by timeout: ${JSON.stringify(eng.am.reloadOutcome)}`);
    if (!(eng.alive && gun.live && eng.phase === 'live')) continue;
    const st = eng.state(), g = gun.slot(gun.active);
    if (eng.activeSlot !== gun.active) fail(i, `trigger slot: engine ${eng.activeSlot}, gun ${gun.active}`);
    if (st.ammo !== g.mag || st.reserve !== g.res) fail(i, `held weapon counts: engine ${st.ammo}/${st.reserve}, gun ${g.mag}/${g.res} (slot ${gun.active})`);
    const o = gun.active ? 0 : 1;
    if (eng.am.prevAmmo[o] != null && eng.am.prevAmmo[o] !== gun.slot(o).mag) fail(i, `other slot ${o} magazine: engine ${eng.am.prevAmmo[o]}, gun ${gun.slot(o).mag}`);
    if (eng.shots !== gun.rounds) fail(i, `shots: engine ${eng.shots}, gun fired ${gun.rounds}`);
    if (leverExpect && gun.active === leverExpect.slot && gun.slot(leverExpect.slot).mag !== leverExpect.mag) fail(i, `the lever did not reload the held weapon: slot ${leverExpect.slot} at ${gun.slot(leverExpect.slot).mag}, want ${leverExpect.mag}`);
    if (kind === 'melee') {
      if (eng.shots !== before.shots) fail(i, `a melee swing counted as a shot (${before.shots} -> ${eng.shots})`);
      if (gun.active !== before.active || eng.activeSlot !== before.active) fail(i, 'a melee swing moved the trigger slot');
      if (gun.slot(0).mag !== before.mags[0] || gun.slot(1).mag !== before.mags[1] || eng.am.prevAmmo[0] !== before.mags[0] || eng.am.prevAmmo[1] !== before.mags[1]) fail(i, 'a melee swing changed a slot 0/1 magazine');
      if (before.recoil && eng._recoil && (eng._recoil.burst !== before.recoil.burst || eng._recoil.lastShotAt !== before.recoil.at)) fail(i, 'a melee swing stepped recoil');
      if (!st.melee) fail(i, 'no melee cooldown in a live match');
      else if (swung && !(st.melee.at != null && st.melee.leftMs > 0)) fail(i, `the swing did not start the melee cooldown: ${JSON.stringify(st.melee)}`);
      if (swung) lastSwingAtEng = st.melee && st.melee.at;
    }
    // engine.js `meleeCooldown`: the cooldown runs on through DOWN and a respawn (the gun's own timer does not stop)
    if (kind === 'die' && before.swing && eng.am.lastSwing !== before.swing) fail(i, 'a respawn cleared the melee cooldown');
    if (lastSwingAtEng != null && st.melee && st.melee.at !== lastSwingAtEng) fail(i, `melee cooldown moved with no swing: ${st.melee.at} vs ${lastSwingAtEng}`);
    // the HUD the player reads
    h.render();
    const label = h.text('.wn .slot'), wn = h.text('.wn');
    if (h.text('#mag') !== pad2(g.mag)) fail(i, `HUD magazine ${h.text('#mag')}, gun ${g.mag}`);
    if (h.text('#res') !== `/${g.res}`) fail(i, `HUD reserve ${h.text('#res')}, gun ${g.res}`);
    if (label !== (gun.active ? 'SECONDARY' : 'PRIMARY')) fail(i, `HUD label ${label}, gun slot ${gun.active}`);
    if (!wn || !wn.endsWith(gun.active ? NAME[sec] : 'ASSAULT RIFLE')) fail(i, `HUD weapon "${wn}", gun slot ${gun.active}`);
  }
  counts.rounds = gun.rounds;
  return { counts, fails, h };
}

const SEEDS = { suppressor: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], usp: [101, 102, 103, 104, 105, 106] };
const ACTIONS = 300;

for (const sec of Object.keys(SEEDS)) {
  test(`swap/reload torture: assault rifle + ${sec}, ${SEEDS[sec].length} seeds x ${ACTIONS} actions, zero desync`, async t => {
    const total = {};
    for (const seed of SEEDS[sec]) {
      const { counts, fails } = await torture(sec, seed, ACTIONS);
      assert.deepEqual(fails, [], fails[0]);
      for (const [k, v] of Object.entries(counts)) total[k] = (total[k] || 0) + v;
    }
    // the run must really exercise what it claims to
    assert.ok(total.alt > 100 && total.lever > 100 && total.swings > 20 && total.die >= 5 && total.relink >= 3 && total.rounds > 300, `coverage: ${JSON.stringify(total)}`);
    t.diagnostic(`coverage: ${JSON.stringify(total)}`);
  });
}

test('swap/reload torture: a new MATCH clears the melee cooldown (ammo.js forgetShown)', async () => {
  const h = harness('suppressor', 7);
  await h.start();
  assert.ok(h.gun.melee(h.rng), 'setup: the gun swings');
  await h.settle(150);
  assert.ok(h.eng.state().melee && h.eng.state().melee.at != null, 'setup: the swing started the cooldown');
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  await h.settle(1000);
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.now(), config_id: golden.config_id, seq: 2, countdown_s: 0 } });
  await h.settle(4000);
  assert.equal(h.eng.phase, 'live', 'setup: the second match is live');
  assert.deepEqual(h.eng.state().melee, { at: null, ms: 3000, leftMs: 0 }, 'no swing carried into the new match');
});

// ENGINE BUG (found by this file, 2026-11-06). The lever on a FULL weapon in hand: the phone refuses the pull (ammo.js
// `reloadPulled`: `ammo >= cap`), but the gun still spends it on the LAST-FIRED slot (F542) and ignores ALT while that
// reload runs. The phone takes the ALT, assumes the swap after the window, and the HUD names the weapon the gun left.
// The next round from the held weapon logs `gun was on slot N`. ammo.js `altPressed` asks `gunReloadsOther` only of an
// open soft reload; with no takeover open (`this.reloading` null) nothing checks `leverAt` against the last-fired slot.
// Review 2026-11-06: this run found that a lever on a full weapon in hand, which the phone refuses and the gun spends on the
// slot that fired last, left ALT open on the phone while the gun ignored it (ammo.js `noteGunOther`, `altPressed`).

test('swap/reload: lever on a full weapon in hand, ALT while the gun reloads the last-fired slot (minimal repro)', async () => {
  const h = harness('suppressor', 1), { eng, gun } = h;
  await h.start();
  for (let i = 0; i < 3; i++) { gun.trigger(); await h.settle(200); }   // slot 0 fires: 29 left, the gun's latch is slot 0
  assert.ok(gun.alt(), 'setup: the gun takes ALT');
  await h.settle(900);
  assert.equal(eng.activeSlot, 1, 'setup: on the secondary, which is full');
  assert.equal(gun.lever(), 0, 'setup: the gun spends the lever on slot 0, the slot that fired last');
  await h.advance(300);
  assert.equal(gun.alt(), false, 'setup: the gun ignores ALT while it reloads');
  await h.settle(900);
  assert.equal(gun.active, 1, 'setup: the gun is still on the secondary');
  assert.equal(eng.activeSlot, 1, 'the HUD stays on the secondary, the weapon the gun holds');
  gun.trigger(); await h.settle(200);
  assert.deepEqual(h.logs.filter(l => l.m.startsWith('gun was on slot')).map(l => l.m), [], 'no desync on the next round');
});

test('swap/reload torture: ALT pressed while the lever reload runs, both loadouts', async () => {
  for (const sec of ['suppressor', 'usp']) {
    for (const seed of [201, 202, 203, 204]) {
      const { fails } = await torture(sec, seed, ACTIONS, { combos: true });
      assert.deepEqual(fails, [], fails[0]);
    }
  }
});
