// Swap and reload are P0 core gameplay (Tony, 2026-11-01): every ALT switches, the lever always reloads the weapon in
// hand, no reload card times out, and the desync counter stays at zero. The desync counter is the engine log line
// `gun was on slot N: the HUD showed slot M` (ammo.js `gunWasOn`): the gun's own slot report contradicted the phone.
//
// This is a seeded random torture run. It drives the REAL engine (src/engine.js) and a real Hud (on the fake DOM) on a
// mocked clock, against a two-slot gun MODEL written here. The model follows the bench facts the engine is built on:
//   - ALT toggles slot 0 and slot 1, and the gun ignores ALT while it is itself reloading (bench 2026-10-02, F650 M1).
//   - After an ALT it took, the gun ignores ALT for the `$WEAP` tok15 of the slot it moved to, and an ignored press does not
//     restart that lockout (bench 2026-11-08, SR1 on 0.4.37, ammo.js `altLockMs`). The trigger stays refused for the larger
//     tok15 of the two slots (bench 2026-09-04). The gun refuses ALT while the trigger is held (bench 2026-11-08, B2).
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
  if (sec === 'shotgun') return b;   // Codex pass r3 (brx1): the golden bundle's own slot 1, a shell-by-shell chain
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
    this.triggerLive = false; this.reload = null; this.swapUntil = 0; this.altTookAt = -1e9; this.altLock = 0; this.lastRoundAt = -1e9; this.lastSwingAt = -1e9;
    this.rounds = 0;                 // rounds fired while alive in the match: `eng.shots` must equal this
    this.pending = 0;                // replies still in flight
    this.chain = new Set();          // slots whose lever loads one shell per reload time (the Shotgun)
    this.failed = 0;                 // phone writes that failed before they left (Codex pass r3: `failAmmo`)
    this.crossEcho = true;           // bench 2026-11-08: an `$AMMO` write to a loadout slot is answered as the slot fired last (`wrote`)
  }
  slot(s) { return this.slots[s] || (this.slots[s] = { mag: 0, res: 0, clip: 0, carried: 0, t40: 0, fireMs: 0, swapMs: 0, reloadMs: 0 }); }
  later(ms, fn) { this.pending++; this.at(ms, () => { this.pending--; fn(); }); }
  alcd(s) { const x = this.slot(s); return `$ALCD,${x.mag},100,${s},${x.res},0,*`; }
  /** One write from the engine. */
  wrote(frames) {
    const answers = [];
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
        if (n(2) === 0 && n(3) === 0 && this.reload) this.reload = null;   // a disarm cuts the gun's reload (engine.js `_stun`)
        if (n(2) != null) x.mag = n(2);
        if (n(3) != null) x.res = n(3);
        // bench 2026-11-08 (SR5b, SR5c): a write to the other loadout slot than the one fired last is answered with the slot
        // fired last, at its own counts
        const e = this.crossEcho && s < 2 && this.latch !== s ? this.latch : s;
        // bench 2026-11-08 (SR11): the answer carries the counts as this write left them (a later row of the burst may still
        // be to come for that slot). The gun answers as it processes the write, so anything the gun did to that slot after
        // the burst (a shell, a round) is newer than the answer: then the current counts go out.
        answers.push({ e, line: this.alcd(e) });
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
    for (const a of answers) {   // bench 2026-11-08 (SR11): see `$AMMO` below
      a.end = this.alcd(a.e);
      this.later(40, () => { const now = this.alcd(a.e); this.feed(now !== a.end ? now : a.line); });
    }
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
    this.triggerDown = true;
    this.later(60, () => { this.triggerDown = false; this.feed('$BUT,0,0,*'); });
    return fired;
  }
  alt() {
    this.feed('$BUT,1,1,*');
    let took = false;
    if (this.live && !this.reload && !this.triggerDown && this.now() - this.altTookAt >= this.altLock) {   // B2: not while the trigger is held
      took = true; this.active = this.active ? 0 : 1; this.altTookAt = this.now(); this.altLock = this.slot(this.active).swapMs;
      this.swapUntil = this.now() + Math.max(this.slot(0).swapMs, this.slot(1).swapMs);   // bench 2026-09-04: the larger slot wins
    }
    this.later(80, () => this.feed('$BUT,1,0,*'));
    return took;
  }
  lever() {
    this.feed('$BUT,2,1,*');
    let s = null;
    if (this.live && !this.reload) {
      // F542: the lever reloads the slot fired last, whatever is in hand (a chain in hand is the phone's to load, Tony 2026-11-07)
      const room = k => { const z = this.slot(k); return z.mag < z.clip && z.res > 0; };
      const t = room(this.latch) ? this.latch : null;
      if (t != null) {
        s = t;
        const x = this.slot(t), life = this.reload = { slot: t };
        if (this.chain.has(t)) {
          // Codex pass r3 (brx1): a chain loads one shell per reload time until the tube is full or the reserve is out, and the
          // gun ignores ALT (and the trigger, in this model) until it ends
          const shell = () => this.later(Math.round(x.reloadMs * 1.2), () => {
            if (this.reload !== life) return;
            x.mag++; x.res--; this.feed(this.alcd(t));
            if (x.mag < x.clip && x.res > 0) shell(); else this.reload = null;
          });
          shell();
        } else {
          this.later(Math.round(x.reloadMs * 1.2), () => {
            if (this.reload !== life) return;   // a spawn or a death cancelled it
            this.reload = null;
            const take = Math.min(x.clip - x.mag, x.res); x.mag += take; x.res -= take;
            this.feed(this.alcd(t));
          });
        }
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

function harness(sec, seed, { failAmmo = 0 } = {}) {
  const bundle = bundleFor(sec);
  let clock = 1_000_000, lastTick = clock;
  const timers = [], hudTimers = [], logs = [];
  const at = (ms, fn) => timers.push({ at: clock + ms, fn, seq: timers.length ? timers[timers.length - 1].seq + 1 : 0 });
  let eng = null;
  const gun = new GunModel(at, f => eng.feedFrame(f), () => clock);
  if (sec === 'shotgun') gun.chain.add(1);
  // Codex pass r3 (brx1): `failAmmo`, the share of the phone's own reload writes (F650 soft reload, F226 charge lock) that fail
  // before they leave, settling false 30 ms later, as a chunk error with the link still up does. Its own PRNG, so the actions
  // of a seed stay the same.
  const failRng = mulberry32(seed * 7919 + 1);
  const writer = (fr, why) => {
    if (failAmmo > 0 && /^(F650|F226)/.test(String(why)) && fr.some(f => f.startsWith('$AMMO,')) && failRng() < failAmmo) {
      gun.failed++;
      return new Promise(r => at(30, () => r(false)));
    }
    gun.wrote(fr);
  };
  eng = new E.Engine({ writer, emit: () => {}, report: () => {}, now: () => clock, wallNow: () => clock,
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

const NAME = { suppressor: 'SUPPRESSOR', usp: 'USP-S', shotgun: 'SHOTGUN' };
const pad2 = n => String(n).padStart(2, '0');

/** One seeded run of `n` actions. Returns {counts, failures}: every invariant break, with its replay context. */
async function torture(sec, seed, n, { combos = false, failAmmo = 0 } = {}) {
  const h = harness(sec, seed, { failAmmo }), { eng, gun, rng } = h;
  await h.start();
  const done = [], fails = [], counts = { fire: 0, alt: 0, lever: 0, melee: 0, die: 0, relink: 0, leverAlt: 0, altSpam: 0, altSpamIgnored: 0, idle: 0, swings: 0, rounds: 0, chainHold: 0, phoneChain: 0 };
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
    if (combos && r < 99.5) return 'altSpam';
    return 'idle';
  };
  const fail = (i, what) => fails.push(`seed ${seed} (${sec}) action #${i} ${done[done.length - 1]}: ${what}\n  gun: active ${gun.active} latch ${gun.latch} slots ${JSON.stringify([0, 1].map(k => [gun.slot(k).mag, gun.slot(k).res]))}; engine prev ${JSON.stringify([eng.am.prevAmmo, eng.am.prevReserve])} lastShot ${JSON.stringify(eng.am.lastShot)}\n  last actions: ${done.slice(-20).join(' | ')}\n  last log: ${h.logs.slice(-12).map(l => `${l.at - 1_000_000} ${l.m}`).join('\n            ')}`);
  for (let i = 0; i < n && fails.length === 0; i++) {
    const kind = pick();
    const failed0 = gun.failed;
    const before = { active: gun.active, latch: gun.latch, mags: [gun.slot(0).mag, gun.slot(1).mag], res: [gun.slot(0).res, gun.slot(1).res],
      outcome: eng.am.reloadOutcome, shots: eng.shots, recoil: eng._recoil ? { burst: eng._recoil.burst, at: eng._recoil.lastShotAt } : null, swing: eng.am.lastSwing };
    let note = '', tookAlt = null, swung = false, leverExpect = null;
    if (kind === 'fire') { const f = gun.trigger(); note = f ? 'round' : 'no round'; counts.fire++; await h.settle(120); }
    else if (kind === 'burst') {
      const k = 2 + Math.floor(rng() * 5);
      for (let j = 0; j < k; j++) { gun.trigger(); await h.advance(gun.slot(gun.active).fireMs + 10); }
      note = `${k} pulls`; counts.fire += k; await h.settle(120);
    } else if (kind === 'alt') { tookAlt = gun.alt(); note = tookAlt ? `to ${gun.active}` : 'ignored'; counts.alt++; await h.settle(900); }
    else if (kind === 'altSpam') {   // bench 2026-11-08: 2 to 10 presses, 100 to 1200 ms apart, no settle between them
      const k = 2 + Math.floor(rng() * 9);
      let took = 0;
      for (let j = 0; j < k; j++) { if (j) await h.advance(100 + Math.floor(rng() * 1100)); if (gun.alt()) took++; }
      note = `${k} presses, the gun took ${took}`; counts.altSpam++; counts.altSpamIgnored += k - took;
      await h.settle(900);
    } else if (kind === 'lever' || kind === 'leverAlt') {
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
    if (fresh.some(l => /itself a shell every/.test(l.m))) counts.phoneChain++;   // Tony 2026-11-07: the phone loads a chain in hand
    if (altIgnored.length && tookAlt === false && gun.chain.size && fresh.some(l => /the gun reloads slot 1, the slot fired last/.test(l.m))) counts.chainHold++;
    if (kind === 'altSpam') {
      const spam = /the gun took (\d+)/.exec(note), presses = +/^(\d+)/.exec(note)[1];
      const windowIgnored = altIgnored.filter(l => /inside the swap lockout/.test(l.m)).length;
      if (windowIgnored > presses - +spam[1]) fail(i, `the engine ignored ${windowIgnored} presses inside the swap lockout, the gun ${presses - +spam[1]}`);
    }
    if (altIgnored.length && tookAlt !== false && kind !== 'altSpam') fail(i, `the gun took ALT but the engine logged: ${altIgnored.map(l => l.m).join('; ')}`);
    if (tookAlt === false && !altIgnored.length && eng.am.altEvidencePending != null) fail(i, 'the gun ignored ALT but the engine opened a swap');
    const timeouts = fresh.filter(l => /reload did NOT take \(timeout\)/.test(l.m));
    if (timeouts.length || (eng.am.reloadOutcome !== before.outcome && eng.am.reloadOutcome && eng.am.reloadOutcome.why === 'timeout')) fail(i, `a reload ended by timeout: ${JSON.stringify(eng.am.reloadOutcome)}`);
    if (!(eng.alive && gun.live && eng.phase === 'live')) continue;
    const st = eng.state(), g = gun.slot(gun.active);
    if (eng.activeSlot !== gun.active) fail(i, `trigger slot: engine ${eng.activeSlot}, gun ${gun.active}`);
    if (st.ammo !== g.mag || st.reserve !== g.res) fail(i, `held weapon counts: engine ${st.ammo}/${st.reserve}, gun ${g.mag}/${g.res} (slot ${gun.active})`);
    const o = gun.active ? 0 : 1;
    if (eng.am.prevAmmo[o] != null && eng.am.prevAmmo[o] !== gun.slot(o).mag) fail(i, `other slot ${o} magazine: engine ${eng.am.prevAmmo[o]}, gun ${gun.slot(o).mag}`);
    if (eng.shots !== gun.rounds) fail(i, `shots: engine ${eng.shots}, gun fired ${gun.rounds}`);
    if (gun.failed !== failed0) leverExpect = null;   // the phone's reload write failed: the gun kept its count, and so must the phone
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

// Bench 2026-11-08 (SR1, 0.4.37, Tactix-E20D, assault rifle + USP-S, swap_ms 850): every ALT run of the SR1b and SR1c
// captures, at the exact press times, then the trigger. `end` is the slot the gun's next `$ALCD` named. The phone used to
// toggle on every press: ten presses about 2 a second showed slot 1 while the gun fired slot 0, and a double press restarted
// the swap clock, so the shot 832 ms after the ignored press read as "ALT not taken by the gun". The gun ignores ALT for the
// tok15 of the slot it moved to (AR 850, USP-S 500; ammo.js `altLockMs`). The `jitter` run is the one press the rule
// misses: the gun took a press 457 ms after a swap to the USP-S, 43 ms inside the lockout, while 466 and 488 were ignored.
const SR1 = [
  { start: 0, presses: [0], shot: 1845, end: 1 },
  { start: 1, presses: [0, 400, 1010, 1522, 2090, 2702, 3256, 3724, 4338, 4848], shot: 7363, end: 0 },
  { start: 0, presses: [0, 129, 323, 507, 719, 908, 1119, 1319, 1509], shot: 4050, end: 1 },
  { start: 1, presses: [0], shot: 1515, end: 0 }, { start: 0, presses: [0], shot: 1145, end: 1 },
  { start: 1, presses: [0], shot: 1302, end: 0 }, { start: 0, presses: [0], shot: 1454, end: 1 },
  { start: 1, presses: [0], shot: 1483, end: 0 }, { start: 0, presses: [0], shot: 1351, end: 1 },
  { start: 1, presses: [0, 140], shot: 972, end: 0 }, { start: 0, presses: [0, 147, 177], shot: 971, end: 1 },
  { start: 1, presses: [0, 173], shot: 1189, end: 0 }, { start: 0, presses: [0, 163], shot: 926, end: 1 },
  { start: 1, presses: [0, 193], shot: 1062, end: 0 },
  // SR1c: double presses at varied spacing, each followed by a shot
  { start: 1, presses: [0, 652], shot: 1506, end: 0 },
  { start: 0, presses: [0, 729], shot: 1507, end: 0 },
  { start: 0, presses: [0, 183], shot: 969, end: 1 },
  { start: 1, presses: [0, 422], shot: 1368, end: 0 },
  { start: 0, presses: [0, 420], shot: 1194, end: 1 },
  { start: 1, presses: [0, 599], shot: 1475, end: 0 },
  { start: 0, presses: [0, 733], shot: 1553, end: 0 },
  { start: 0, presses: [0, 685], shot: 1509, end: 0 },
  { start: 0, presses: [0, 217], shot: 978, end: 1 },
  { start: 1, presses: [0, 671], shot: 1480, end: 0 },
  { start: 0, presses: [0, 575], shot: 1539, end: 0 },
  { start: 0, presses: [0, 713], shot: 1420, end: 0 },
  { start: 0, presses: [0, 457], shot: 1250, end: 0, jitter: true },
  { start: 0, presses: [0, 242], shot: 1026, end: 1 },
  { start: 1, presses: [0, 497], shot: 1307, end: 0 },
  { start: 0, presses: [0, 537], shot: 1109, end: 0 },
  { start: 0, presses: [0, 657], shot: 1255, end: 0 },
  { start: 0, presses: [0, 357], shot: 1386, end: 1 },
  { start: 1, presses: [0], shot: 1499, end: 0 },
  { start: 0, presses: [0, 258], shot: 2338, end: 1 },
  { start: 1, presses: [0, 278], shot: 1490, end: 0 },
  { start: 0, presses: [0, 284], shot: 1074, end: 1 },
  { start: 1, presses: [0, 320], shot: 1377, end: 0 },
  { start: 0, presses: [0, 488], shot: 1264, end: 1 },
  { start: 1, presses: [0, 591], shot: 1394, end: 0 },
  { start: 0, presses: [0, 733], shot: 1272, end: 0 },
  { start: 0, presses: [0, 503], shot: 1476, end: 0 },
  { start: 0, presses: [0, 466], shot: 1259, end: 1 },
  { start: 1, presses: [0, 435], shot: 1464, end: 0 },
  { start: 0, presses: [0, 215], shot: 1149, end: 1 },
  { start: 1, presses: [0, 590], shot: 1203, end: 0 },
  { start: 0, presses: [0, 377], shot: 1002, end: 1 },
  { start: 1, presses: [0, 827], shot: 1670, end: 0 },
  { start: 0, presses: [0, 811], shot: 1800, end: 0 },
];
test('swap/reload: the SR1 bench presses replayed, the gun ignores ALT inside the swap lockout (bench 2026-11-08)', async () => {
  const h = harness('usp', 1), { eng, gun } = h;
  await h.start();
  let ignored = 0;
  for (const [k, run] of SR1.entries()) {
    if (run.jitter) continue;
    if (gun.active !== run.start) { gun.alt(); await h.advance(1500); gun.trigger(); await h.settle(300); }
    if (gun.slot(gun.active).mag <= 2) { gun.lever(); await h.settle(4000); }   // the slot in hand fired last: the lever reloads it
    assert.equal(eng.activeSlot, run.start, `setup: run ${k} starts on slot ${run.start}`);
    let t = 0;
    for (const p of run.presses) { await h.advance(p - t); t = p; if (!gun.alt()) ignored++; }
    await h.advance(run.shot - t);
    while (h.now() < gun.swapUntil) await h.advance(20);   // the AR fires once its draw ends (the trigger was held)
    assert.equal(gun.active, run.end, `setup: run ${k}, the model gun ends where the bench gun did`);
    assert.ok(gun.trigger(), `setup: run ${k}, the gun fires`);
    await h.settle(300);
    assert.equal(eng.activeSlot, run.end, `run ${k} (${run.presses.join('/')} ms): the HUD shows the slot the gun fired`);
  }
  const bad = h.logs.filter(l => /^gun was on slot|ALT not taken by the gun/.test(l.m)).map(l => l.m);
  assert.deepEqual(bad, [], 'no desync and no "ALT not taken" verdict');
  assert.ok(ignored >= 30, `setup: the runs hold presses the gun ignored: ${ignored}`);
  assert.equal(h.logs.filter(l => /inside the swap lockout/.test(l.m)).length, ignored, 'the phone ignores exactly the presses the gun ignored');
});

// Bench 2026-11-08 (SR5, Tactix-E20D on 0.4.37; sr4b 14:38, sr5b 14:40, sr5c 14:42): the AR (slot 0) fired last, ALT went
// to the USP-S, and the lever made the phone reload the USP-S (`$AMMO,1,12,229`). The gun answered that write with
// `$ALCD,32,100,0,362,0`: the slot fired last, at its own unchanged count, 51 to 137 ms after the write (every `$AMMO,1`
// write in the day's captures got this answer). The HUD jumped to the AR while the gun held the USP-S. In sr5c the AR was
// part-used, so the gun's own lever refilled it first (a real gain) and the same answer followed our write. The gun model
// answers writes the same way (`crossEcho`). Each run also gets the literal bench frame once the write has been answered.
for (const v of [{ name: 'sr4b/sr5b, the AR full', usp: 5, arFull: true }, { name: 'the AR full, the USP-S empty', usp: 12, arFull: true },
  { name: 'sr5c, the AR part-used', usp: 2, arFull: false }]) {
  test(`swap/reload: SR5 (${v.name}), the gun's answer to our slot 1 write leaves the trigger on slot 1 (bench 2026-11-08)`, async () => {
    const h = harness('usp', 3), { eng, gun } = h;
    await h.start();
    assert.ok(gun.alt(), 'setup: ALT to the USP-S'); await h.settle(1500);
    for (let i = 0; i < v.usp; i++) { assert.ok(gun.trigger(), 'setup: the USP-S fires'); await h.advance(gun.slot(1).fireMs + 10); }
    await h.settle(300);
    assert.ok(gun.alt(), 'setup: ALT back to the AR'); await h.settle(1500);
    for (let i = 0; i < 3; i++) { assert.ok(gun.trigger(), 'setup: the AR fires, so it fired last'); await h.advance(gun.slot(0).fireMs + 10); }
    await h.settle(300);
    if (v.arFull) { assert.equal(gun.lever(), 0, 'setup: the lever refills the AR'); await h.settle(3000); }
    assert.equal(gun.slot(0).mag === gun.slot(0).clip, v.arFull, 'setup: the AR is full or part-used as the variant says');
    assert.ok(gun.alt(), 'setup: ALT to the USP-S'); await h.settle(1500);
    assert.equal(eng.activeSlot, 1, 'setup: the HUD is on the USP-S');
    const mark = h.logs.length;
    gun.lever(); await h.settle(4000);
    assert.ok(h.logs.slice(mark).some(l => /the gun answered the slot 1 write with slot 0 at the same count/.test(l.m)),
      `the answer to the phone's slot 1 write is booked as its echo: ${h.logs.slice(mark).map(l => l.m).join(' | ')}`);
    assert.equal(gun.slot(1).mag, 12, 'setup: the phone reloaded the USP-S to a full magazine');
    assert.equal(eng.state().ammo, 12, 'the HUD shows the written magazine');
    eng.feedFrame(`$ALCD,${gun.slot(0).mag},100,0,362,0,*`); await h.advance(200);   // the bench frame again, no write open
    assert.ok(h.logs.slice(mark).some(l => /slot 0 reported at the same count/.test(l.m)), 'with no write open it is booked and moves nothing');
    assert.equal(gun.active, 1, 'setup: the gun holds the USP-S');
    assert.equal(eng.activeSlot, 1, 'the trigger stays on the USP-S');
    assert.equal(eng.am.altPtr, 1, 'the ALT pointer stays on the USP-S');
    h.render();
    assert.equal(h.text('.wn .slot'), 'SECONDARY', 'the HUD names the weapon in hand');
    const before = gun.slot(1).mag, shots = eng.shots;
    assert.ok(gun.trigger(), 'setup: the USP-S fires'); await h.settle(300);
    assert.equal(eng.state().ammo, before - 1, 'the round is counted from the written magazine');
    assert.equal(eng.shots, shots + 1, 'one round, one shot');
    assert.deepEqual(h.logs.filter(l => /^gun was on slot/.test(l.m)).map(l => l.m), [], 'no desync');
  });
}

// Codex review 2026-11-08 (SR5 layer 1): the answer books the written count only while no frame for the written slot has
// come since the write. Two writes pending, a round reported on the written slot, then the late answer: the round stands.
test('swap/reload: SR5, a late answer to our write never overwrites a newer count on the written slot (Codex review)', async () => {
  const h = harness('usp', 5), { eng, gun } = h;
  await h.start();
  assert.ok(gun.alt(), 'setup: ALT to the USP-S'); await h.settle(1500);
  const a0 = [eng.am.prevAmmo[0], eng.am.prevReserve[0]];
  eng.am.acctWrote(1, 12, 200); eng.am.acctWrote(1, 12, 200);   // two writes in the air
  eng.feedFrame('$ALCD,11,100,1,200,0,*');                       // a round on the written slot
  assert.equal(eng.am.prevAmmo[1], 11, 'setup: the round is booked');
  eng.feedFrame(`$ALCD,${a0[0]},100,0,${a0[1]},0,*`);             // the late answer, named for slot 0
  assert.equal(eng.am.prevAmmo[1], 11, 'the round stands');
  const shots = eng.shots;
  eng.feedFrame('$ALCD,10,100,1,200,0,*');
  assert.equal(eng.shots, shots + 1, 'the next round is one shot, not two');
  assert.equal(eng.activeSlot, 1);
});

// Codex review 2026-11-08 (SR5 layer 2): an unchanged report is no reload progress, so it never stretches the ALT hold.
test('swap/reload: SR5, a same-count report from the other slot leaves the ALT hold alone (Codex review)', async () => {
  const h = harness('usp', 6), { eng, gun } = h;
  await h.start();
  assert.ok(gun.trigger(), 'setup: the AR fires'); await h.settle(300);
  assert.ok(gun.alt(), 'setup: ALT to the USP-S'); await h.settle(1500);
  const until = h.now() + 100;
  eng.am.gunOther = { slot: 0, until, life: eng._lifeSeq, energy: false };
  eng.feedFrame(`$ALCD,${eng.am.prevAmmo[0]},100,0,${eng.am.prevReserve[0]},0,*`);
  assert.ok(h.logs.some(l => /slot 0 reported at the same count/.test(l.m)), 'setup: the report took the same-count path');
  assert.equal(eng.am.gunOther && eng.am.gunOther.until, until, 'the hold is not stretched');
});

// Bench 2026-11-08 (B2): ALT pressed while the trigger is held (`$BUT,0,1` 15:07:39.616, ALT 39.669, release 39.674) is
// refused. The gun stayed on the empty USP-S while the HUD showed the AR.
test('swap/reload: ALT with the trigger held is refused by the gun, and by the phone (bench 2026-11-08 B2)', async () => {
  const h = harness('usp', 7), { eng, gun } = h;
  await h.start();
  assert.ok(gun.alt(), 'setup: ALT to the USP-S'); await h.settle(1500);
  for (let i = 0; i < 12; i++) { gun.trigger(); await h.advance(gun.slot(1).fireMs + 10); }
  await h.settle(300);
  assert.equal(gun.slot(1).mag, 0, 'setup: the USP-S is empty');
  gun.trigger(); await h.advance(53);
  assert.equal(gun.alt(), false, 'setup: the gun refuses ALT with the trigger held');
  await h.settle(1500);
  assert.equal(gun.active, 1, 'setup: the gun holds the USP-S');
  assert.ok(h.logs.some(l => /ALT ignored by the gun: trigger held/.test(l.m)), 'the phone logs the refusal');
  assert.equal(eng.activeSlot, 1, 'the HUD stays on the USP-S');
  assert.equal(eng.am.altPtr, 1);
  // CONTROL: the same press after the release swaps
  await h.advance(100);
  assert.ok(gun.alt(), 'setup: ALT after the release is taken'); await h.settle(1500);
  assert.equal(eng.activeSlot, 0, 'CONTROL: the press after the release swaps');
});

// Bench 2026-11-08 (SR5r): the USP-S fired dry, then an ALT the gun refused for a reason not modelled. The phone assumed the
// AR, and every pull after it clicked empty with no `$ALCD`, so no round ever came to correct it. Two unanswered loaded
// pulls while the other slot is empty move the HUD there (ammo.js `unansweredPulls`).
test('swap/reload: two unanswered pulls on a loaded HUD slot, with the other slot empty, put the HUD on the gun\'s slot (SR5r)', async () => {
  const h = harness('usp', 8), { eng, gun } = h;
  await h.start();
  assert.ok(gun.alt(), 'setup: ALT to the USP-S'); await h.settle(1500);
  for (let i = 0; i < 12; i++) { gun.trigger(); await h.advance(gun.slot(1).fireMs + 10); }
  await h.settle(300);
  assert.equal(gun.slot(1).mag, 0, 'setup: the USP-S is empty');
  eng.feedFrame('$BUT,1,1,*'); eng.feedFrame('$BUT,1,0,*');   // an ALT the gun refused: the model does not swap
  await h.settle(1500);
  assert.equal(eng.activeSlot, 0, 'setup: the phone assumed the swap to the AR');
  assert.equal(gun.active, 1, 'setup: the gun holds the USP-S');
  const mark = h.logs.length;
  assert.equal(gun.trigger(), false, 'setup: a dry pull'); await h.advance(1700);
  assert.equal(eng.activeSlot, 0, 'one unanswered pull is not proof');
  assert.equal(gun.trigger(), false, 'setup: a second dry pull'); await h.advance(1700);
  const fresh = h.logs.slice(mark).map(l => l.m);
  assert.ok(fresh.some(m => m.startsWith('gun was on slot 1 (dry pulls)')), `the correction is logged as a desync: ${fresh.join(' | ')}`);
  assert.equal(eng.activeSlot, 1, 'the HUD follows the gun');
  assert.equal(eng.am.altPtr, 1, 'and so does the ALT pointer');
  h.render();
  assert.equal(h.text('.wn .slot'), 'SECONDARY');
  assert.equal(h.text('#mag'), '00', 'the empty magazine is on screen');
  // Codex review: the slot is an inference, so a pull on it stays owed, and a gun that really is broken still reaches no_fire
  assert.equal(gun.trigger(), false, 'setup: a third dry pull'); await h.advance(1700);
  assert.ok(h.logs.some(l => /gun not firing: 3 trigger pulls/.test(l.m)), 'the stale-pool check is still reachable, and the cure reads the gun');
});

// Codex review 2026-11-08: dry-pull evidence belongs to the slot the pulls were judged on. One unanswered pull on slot 0,
// then the HUD moves to slot 1 with no word from the gun: one more unanswered pull there is not two in a row.
test('swap/reload: SR5r, an unanswered pull on another slot does not add to the run (Codex review)', async () => {
  const h = harness('usp', 10), { eng } = h;
  await h.start();
  eng.am.prevAmmo[0] = 0; eng.am.prevAmmo[1] = 5; delete eng.am.acct[0]; delete eng.am.acct[1];   // slot 0 empty, by the gun's last word
  eng.activeSlot = 0;
  assert.equal(eng.am.unansweredPulls(0), false, 'one pull on slot 0');
  eng.activeSlot = 1;   // a swap the gun never reported
  assert.equal(eng.am.unansweredPulls(1), false, 'one pull on slot 1 is the start of a new run');
  assert.equal(eng.activeSlot, 1);
  assert.equal(eng.am.unansweredPulls(1), true, 'CONTROL: a second pull on slot 1 is the run');
  assert.equal(eng.activeSlot, 0);
});

// CONTROL for SR5r: the other slot has rounds, so unanswered pulls prove nothing about the slot (a stale pool, F208).
test('swap/reload: unanswered pulls with rounds in both slots move nothing (SR5r control)', async () => {
  const h = harness('usp', 9), { eng, gun } = h;
  await h.start();
  gun.triggerLive = false;   // the gun stops answering the trigger
  for (let i = 0; i < 3; i++) { gun.trigger(); await h.advance(1700); }
  assert.equal(eng.activeSlot, 0);
  assert.ok(!h.logs.some(l => /dry pulls/.test(l.m)), 'no correction');
});

// Bench 2026-11-08 (SR11, Tactix-E20D on v4.32, the USP-S fired last at 9/224): a relink's reconcile, replayed. Each
// `$AMMO` write is answered as the slot fired last at its count at that moment. The disarm pair answered `slot 1 at 9`
// (slot 1 before its own disarm) then `slot 1 at 0`. The re-arm pair answered `slot 1 at 0` (the slot-0 write, slot 1
// still disarmed) then `slot 1 at 9`, and a late `slot 1 at 9` followed. Read as news, `slot 1 at 0` booked nine phantom
// rounds. The model gun is muted here; the answers are the capture's, at its offsets from the phone's own writes.
test('swap/reload: SR11 reconcile replayed, the answers to a two-slot re-arm book no rounds (bench 2026-11-08)', async () => {
  const h = harness('usp', 12), { eng, gun } = h;
  await h.start();
  for (let i = 0; i < 5; i++) { gun.trigger(); await h.advance(gun.slot(0).fireMs + 10); }
  await h.settle(300);
  assert.ok(gun.alt(), 'setup: ALT to the USP-S'); await h.settle(1500);
  for (let i = 0; i < 3; i++) { gun.trigger(); await h.advance(gun.slot(1).fireMs + 10); }
  await h.settle(300);
  assert.deepEqual([gun.slot(0).mag, gun.slot(1).mag], [27, 9], 'setup: the AR at 27, the USP-S at 9, fired last');
  const res1 = gun.slot(1).res, shots = eng.shots, writes = [];
  gun.wrote = fr => {   // the capture's answers, not the model's
    writes.push(...fr);
    const a0 = fr.find(f => f.startsWith('$AMMO,0,')), a1 = fr.find(f => f.startsWith('$AMMO,1,'));
    if (!a0 || !a1) return;
    if (a0.startsWith('$AMMO,0,0,0,')) {
      gun.later(84, () => gun.feed(`$ALCD,9,100,1,${res1},0,*`)); gun.later(176, () => gun.feed('$ALCD,0,100,1,0,0,*'));
    } else {
      gun.later(100, () => gun.feed('$ALCD,0,100,1,0,0,*')); gun.later(103, () => gun.feed(`$ALCD,9,100,1,${res1},0,*`));
      gun.later(1107, () => gun.feed(`$ALCD,9,100,1,${res1},0,*`));
    }
  };
  eng.onBleDropped(); await h.advance(1000);
  eng.onBleConnected(GUN); await h.advance(5000);
  assert.ok(writes.some(f => f.startsWith('$AMMO,0,0,0,')) && writes.some(f => /^\$AMMO,1,9,/.test(f)), `setup: a disarm and a re-arm went out: ${writes.filter(f => f.startsWith('$AMMO')).join(' ')}`);
  assert.equal(eng.shots, shots, 'no phantom rounds');
  assert.equal(eng.activeSlot, 1, 'the trigger stays on the USP-S');
  assert.equal(eng.am.prevAmmo[1], 9, 'the USP-S at 9');
  h.render();
  assert.equal(h.text('#mag'), '09', 'the HUD shows 9');
  assert.equal(h.text('#res'), `/${res1}`, 'and the reserve');
  assert.deepEqual(h.logs.filter(l => /^gun was on slot/.test(l.m)).map(l => l.m), [], 'no desync');
});

// Codex review 2026-11-08 (Medium 1 on F465): slot 1 fired last, a stun, ALT about 400 ms before it ends. The restore's
// slot-0 write is answered as slot 1 at its disarmed 0 while slot 1's restore is in the air. Read as news it booked a
// magazine of rounds and cancelled the swap as "ALT not taken".
test('swap/reload: a stunned ALT just before the restore keeps its swap and books no rounds (Codex review, F465)', async () => {
  const h = harness('usp', 14), { eng, gun } = h;
  await h.start();
  assert.ok(gun.alt(), 'setup: ALT to the USP-S'); await h.settle(1500);
  for (let i = 0; i < 2; i++) { gun.trigger(); await h.advance(gun.slot(1).fireMs + 10); }
  await h.settle(300);
  assert.equal(gun.latch, 1, 'setup: the USP-S fired last');
  const shots = eng.shots;
  eng._stun(3000); await h.advance(2600);
  assert.ok(eng.stunned, 'setup: still stunned');
  assert.ok(gun.alt(), 'setup: the stunned gun swaps to the AR');
  await h.settle(4000);
  assert.ok(!eng.stunned, 'setup: the stun is over');
  assert.equal(eng.shots, shots, 'no phantom rounds');
  assert.ok(!h.logs.some(l => /ALT not taken by the gun/.test(l.m)), 'the swap is not cancelled');
  assert.equal(gun.active, 0, 'setup: the gun holds the AR');
  assert.equal(eng.activeSlot, 0, 'the HUD follows');
  assert.ok(gun.trigger(), 'setup: the AR fires'); await h.settle(300);
  assert.deepEqual(h.logs.filter(l => /^gun was on slot/.test(l.m)).map(l => l.m), [], 'no desync');
});

// Codex review 2026-11-08 on the disarm rule: a real last round right after a restore keeps its reserve and counts; a
// second write while the restore is pending keeps the disarm's history.
test('swap/reload: after a restore, a real last round counts and a later write keeps the disarm guard (Codex review)', async () => {
  const h = harness('usp', 15), { eng, gun } = h;
  await h.start();
  assert.ok(gun.alt(), 'setup: ALT to the USP-S'); await h.settle(1500);
  gun.wrote = () => {};   // the gun answers nothing here: the frames are the test's
  // (1) restored to 1 round, then fired before the restore's echo: `0/200` is a real round
  eng.am.noteDisarm([1]); eng.am.acctWrote(1, 1, 200);
  let shots = eng.shots;
  eng.feedFrame('$BUT,0,1,*'); eng.feedFrame('$ALCD,0,100,1,200,0,*'); eng.feedFrame('$BUT,0,0,*');
  assert.equal(eng.shots, shots + 1, 'the last round counts');
  // CONTROL: the disarm's own `0/0` after a restore books nothing
  await h.advance(2000);
  eng.am.noteDisarm([1]); eng.am.acctWrote(1, 5, 200);
  shots = eng.shots;
  eng.feedFrame('$ALCD,0,100,1,0,0,*');
  assert.equal(eng.shots, shots, 'CONTROL: the disarm zero books nothing');
  // (2) a second write while the restore is pending keeps the guard
  await h.advance(2000);
  eng.am.noteDisarm([1]); eng.am.acctWrote(1, 1, 200); eng.am.acctWrote(1, 2, 199);
  shots = eng.shots;
  eng.feedFrame('$ALCD,0,100,1,0,0,*');
  assert.equal(eng.shots, shots, 'the disarm zero after two writes books nothing');
});

// Codex review 2026-11-08: a reload begun before the stun is cut by the disarm, so it holds no ALT inside the stun.
test('swap/reload: a reload begun before a stun does not hold ALT inside the stun (Codex review, F465)', async () => {
  const h = harness('usp', 11), { eng, gun } = h;
  await h.start();
  for (let i = 0; i < 3; i++) { gun.trigger(); await h.advance(gun.slot(0).fireMs + 10); }
  await h.settle(300);
  assert.equal(gun.lever(), 0, 'setup: the gun reloads the AR');
  await h.advance(100);
  assert.ok(eng.am.reloading, 'setup: the phone shows the reload');
  eng._stun(3000); await h.advance(200);
  assert.ok(eng.stunned, 'setup: stunned');
  assert.ok(gun.alt(), 'setup: the disarmed gun swaps');
  assert.ok(!h.logs.some(l => /ALT ignored by the gun mid-reload/.test(l.m)), 'the phone does not hold ALT for a reload the stun cut');
  await h.settle(4000);
  assert.equal(gun.active, 1, 'setup: the gun holds the USP-S');
  assert.equal(eng.activeSlot, 1, 'the HUD follows');
});

// Codex review 2026-11-08: and after a short stun, before the cut reload's own hold would have ended.
test('swap/reload: a reload cut by a short stun holds no ALT after the stun either (Codex review, F465)', async () => {
  const h = harness('usp', 13), { eng, gun } = h;
  await h.start();
  for (let i = 0; i < 3; i++) { gun.trigger(); await h.advance(gun.slot(0).fireMs + 10); }
  await h.settle(300);
  assert.equal(gun.lever(), 0, 'setup: the gun reloads the AR');
  await h.advance(100);
  eng._stun(300); await h.advance(500);
  assert.ok(!eng.stunned, 'setup: the stun is over');
  assert.ok(eng.am.reloading, 'setup: the phone still shows the cut reload');
  assert.ok(gun.alt(), 'setup: the gun, its reload cut, swaps');
  assert.ok(!h.logs.some(l => /ALT ignored by the gun mid-reload/.test(l.m)), 'the phone takes the press');
  await h.settle(4000);
  assert.equal(eng.activeSlot, 1, 'the HUD follows');
});

// F465 (bench 2026-10-16, Tony: by design): a stunned gun still swaps on ALT, under the same lockout. The phone ignored the
// press, so after the stun the HUD named the old weapon and the next round logged `gun was on slot`.
test('swap/reload: ALT while stunned swaps, as the gun does, under the same lockout (F465)', async () => {
  const h = harness('usp', 4), { eng, gun } = h;
  await h.start();
  assert.ok(gun.trigger(), 'setup: the AR fires'); await h.settle(300);
  eng._stun(3000); await h.advance(200);
  assert.ok(eng.stunned, 'setup: stunned');
  assert.ok(gun.alt(), 'setup: the stunned gun takes ALT');
  await h.advance(200);
  assert.equal(gun.alt(), false, 'setup: the gun ignores a press inside the lockout');
  await h.settle(4000);
  assert.ok(!eng.stunned, 'setup: the stun is over');
  assert.equal(gun.active, 1, 'setup: the gun holds the USP-S');
  assert.equal(eng.activeSlot, 1, 'the HUD follows the swap made while stunned');
  assert.equal(eng.am.altPtr, 1, 'the ALT pointer follows it too');
  assert.ok(gun.trigger(), 'setup: the USP-S fires'); await h.settle(300);
  assert.deepEqual(h.logs.filter(l => /^gun was on slot/.test(l.m)).map(l => l.m), [], 'no desync');
  assert.equal(h.logs.filter(l => /inside the swap lockout/.test(l.m)).length, 1, 'the second press is ignored, as the gun does');
});

// Codex review 2026-11-08: a round from the old slot proves the gun refused the press ("ALT not taken"). A refused press
// starts no lockout on the gun, so the next press is a swap.
test('swap/reload: a press the gun refused starts no ALT lockout (Codex review 2026-11-08)', async () => {
  const h = harness('usp', 2), { eng, gun } = h;
  await h.start();
  gun.trigger(); await h.settle(300);
  eng.feedFrame('$BUT,1,1,*'); eng.feedFrame('$BUT,1,0,*');   // the gun misses this press (no swap on the gun)
  assert.ok(eng.am.switching, 'setup: the phone opened a swap');
  await h.advance(300);   // past ALT_LATE_ROUND_MS (250), inside the USP-S lockout (500)
  assert.ok(gun.trigger(), 'setup: the gun fires the old slot');
  await h.advance(100);   // after the trigger's release (B2), still inside the lockout
  assert.ok(h.logs.some(l => /ALT not taken by the gun/.test(l.m)), 'setup: the round proved the press was refused');
  assert.ok(gun.alt(), 'setup: the gun takes the next press');
  assert.ok(!h.logs.some(l => /inside the swap lockout/.test(l.m)), 'the phone takes it too');
  await h.settle(900);
  assert.equal(eng.activeSlot, 1);
});

test('swap/reload torture: ALT pressed while the lever reload runs, both loadouts', async () => {
  for (const sec of ['suppressor', 'usp']) {
    for (const seed of [201, 202, 203, 204]) {
      const { fails } = await torture(sec, seed, ACTIONS, { combos: true });
      assert.deepEqual(fails, [], fails[0]);
    }
  }
});

// Codex pass 2026-11-07 r3 (brx1, P0 swap/reload): the cases the third review found, in the run the bench SR steps lean on.
// The Shotgun's chain on the slot fired last while the phone reloads the rifle (the ALT hold must last the whole chain), and
// the phone's own reload writes failing before they leave (the books must stay with the gun).
test('swap/reload torture: assault rifle + shotgun (a chain on the slot fired last), zero desync', async () => {
  let chainHold = 0, phoneChain = 0, altSpam = 0, altSpamIgnored = 0;
  for (const seed of [301, 302, 303, 304, 305, 306]) {
    const { counts, fails } = await torture('shotgun', seed, ACTIONS, { combos: true });
    assert.deepEqual(fails, [], fails.join('\n\n'));
    assert.ok(counts.lever > 20 && counts.alt > 20, `seed ${seed} exercised the lever and ALT: ${JSON.stringify(counts)}`);
    chainHold += counts.chainHold; phoneChain += counts.phoneChain; altSpam += counts.altSpam; altSpamIgnored += counts.altSpamIgnored;
  }
  assert.ok(altSpam >= 5 && altSpamIgnored >= 5, `the run pressed ALT in quick runs the gun partly ignored: ${altSpam} runs, ${altSpamIgnored} ignored`);
  assert.ok(chainHold >= 3, `the run held ALT through a chain on the slot fired last: ${chainHold}`);
  assert.ok(phoneChain >= 10, `the run had the phone load the chain in hand shell by shell: ${phoneChain}`);
});
test('swap/reload torture: a third of the phone\'s reload writes fail before they leave, zero desync', async () => {
  let failed = 0;
  let phoneChain = 0;
  for (const [sec, seed] of [['suppressor', 401], ['suppressor', 402], ['usp', 403], ['usp', 404], ['shotgun', 405], ['shotgun', 406], ['shotgun', 407]]) {
    const { fails, h, counts } = await torture(sec, seed, ACTIONS, { combos: true, failAmmo: 0.33 });
    assert.deepEqual(fails, [], fails.join('\n\n'));
    failed += h.gun.failed; phoneChain += counts.phoneChain;
  }
  assert.ok(phoneChain >= 5, `the phone loaded a chain shell by shell with failing writes: ${phoneChain}`);
  assert.ok(failed >= 5, `the run failed enough writes to mean something: ${failed}`);
});
