// Swap and reload are P0 core gameplay (Tony, 2026-11-01): every ALT switches, the lever always reloads the weapon in
// hand, no reload card times out, and the desync counter stays at zero. The desync counter is the engine log line
// `gun was on slot N: the HUD showed slot M` (ammo.js `gunWasOn`): the gun's own slot report contradicted the phone.
//
// This is a seeded random torture run. It drives the REAL engine (src/engine.js) and a real Hud (on the fake DOM) on a
// mocked clock, against a two-slot gun MODEL written here. The model follows the bench facts the engine is built on:
//   - The trigger fires the slot `$BMAP,0,<n>` binds (n of 11 or less), and `$BMAP,0,98` holds it (bench 2026-11-08, bm1-3).
//     With `$BMAP,1,98` ALT does nothing on the gun: the phone owns the swap (Tony 2026-11-08). The gun's own ALT (fn 100) is
//     modelled for an old head: it toggles slot 0 and 1, never while the gun reloads or the trigger is held.
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
    this.triggerLive = false; this.altFn = 100; this.reload = null; this.swapUntil = 0; this.altTookAt = -1e9; this.altLock = 0; this.lastRoundAt = -1e9; this.lastSwingAt = -1e9;
    this.rounds = 0;                 // rounds fired while alive in the match: `eng.shots` must equal this
    this.pending = 0;                // replies still in flight
    this.chain = new Set();          // slots whose lever loads one shell per reload time (the Shotgun)
    this.failed = 0;                 // phone writes that failed before they left (Codex pass r3: `failAmmo`)
    this.writes = [];                // every frame the phone wrote, in order
    this.crossEcho = true;           // bench 2026-11-08: an `$AMMO` write to a loadout slot is answered as the slot fired last (`wrote`)
  }
  slot(s) { return this.slots[s] || (this.slots[s] = { mag: 0, res: 0, clip: 0, carried: 0, t40: 0, fireMs: 0, swapMs: 0, reloadMs: 0 }); }
  later(ms, fn) { this.pending++; this.at(ms, () => { this.pending--; fn(); }); }
  alcd(s) { const x = this.slot(s); return `$ALCD,${x.mag},100,${s},${x.res},0,*`; }
  /** One write from the engine. */
  wrote(frames) {
    this.writes.push(...frames);
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
        // ASSUMED, not benched (Tony 2026-11-08 undo): an `$AMMO` write to the slot a CHAIN is loading ends the chain. The bench
        // (lv1-8) undid a magazine reload, which is one refill; a shotgun chain under an undo is still to bench.
        if (this.reload && this.reload.slot === s && this.chain.has(s) && n(2) != null && n(2) < x.mag) this.reload = null;
        if (n(2) != null) x.mag = n(2);
        if (n(3) != null) x.res = n(3);
        // bench 2026-11-08 (SR5b, SR5c): a write to the other loadout slot than the one fired last is answered with the slot
        // fired last, at its own counts
        const e = this.crossEcho && s < 2 && this.latch !== s ? this.latch : s;
        // bench 2026-11-08 (SR11): the answer carries the counts as this write left them (a later row of the burst may still
        // be to come for that slot). The gun answers as it processes the write, so anything the gun did to that slot after
        // the burst (a shell, a round) is newer than the answer: then the current counts go out.
        answers.push({ e, line: this.alcd(e) });
      } else if (cmd === '$BMAP' && t[1] === '0') {   // bench 2026-11-08 (bm1-3): fn 11 or less binds the trigger to that slot
        const fn = n(2);
        if (fn === 98) this.triggerLive = false; else if (fn != null && fn <= 11) { this.triggerLive = true; this.active = fn; }
      } else if (cmd === '$BMAP' && t[1] === '1') this.altFn = n(2);
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
    if (this.altFn === 100 && this.live && !this.reload && !this.triggerDown && this.now() - this.altTookAt >= this.altLock) {   // the gun's own ALT
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

function harness(sec, seed, { failAmmo = 0, easyOne = false } = {}) {
  const bundle = bundleFor(sec);
  if (easyOne) {   // a one-weapon kit with Easy Reload: compile.py keeps ALT on fn 97 (RELOAD), bench SR6
    const one = list => list.filter(f => !f.startsWith('$WEAP,1,') && !f.startsWith('$AMMO,1,')).map(f => (f.startsWith('$BMAP,1,') ? '$BMAP,1,97,,,,,*' : f));
    bundle.head = one(bundle.head); bundle.spawn = one(bundle.spawn); bundle.revive = one(bundle.revive);
    for (const k of ['spawn', 'revive', 'revive_station']) bundle.respawn_profile[k] = one(bundle.respawn_profile[k]);
  }
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
    // Codex 2026-11-08: the phone swap's own writes fail too (the hold, the bind, the undo, the repair), as a chunk error would
    const bind = /^(ALT:|undo |trigger binding repair|re-bind)/.test(String(why));
    if (failAmmo > 0 && (bind || (/^(F650|F226)/.test(String(why)) && fr.some(f => f.startsWith('$AMMO,')))) && failRng() < failAmmo) {
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
    loadout: easyOne ? { weapons: [{ weapon_id: 'assault_rifle' }], overrides: { easy_reload: true } } : { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: sec }] } };
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
        && !am.acctEchoing(0) && !am.acctEchoing(1) && !eng.rc.active && !eng.stunned && (!eng.alive || (gun.triggerLive && gun.active === eng.activeSlot));   // Codex 2026-11-08: a lost bind heals (`_bindTick`)
    },
    async settle(min = 0, cap = 9000) {
      const t0 = clock;
      await advance(min);
      while (clock - t0 < cap && !h.quiet()) await advance(TICK);
      await advance(200);   // a margin past the last reply
    },
    operatorRespawn() { eng.onMcMessage({ kind: 'control', body: { cmd: 'respawn', match_id: 'm1' } }); },
    /** ALT: the gun does nothing with it (`$BMAP,1,98`); true when the phone opened its swap (Tony 2026-11-08). */
    swap() { gun.alt(); return !!(eng.am.switching && !eng.am.switching.pu); },
  };
  return h;
}

const NAME = { suppressor: 'SUPPRESSOR', usp: 'USP-S', shotgun: 'SHOTGUN' };
const pad2 = n => String(n).padStart(2, '0');

/** One seeded run of `n` actions. Returns {counts, failures}: every invariant break, with its replay context. */
async function torture(sec, seed, n, { combos = false, failAmmo = 0 } = {}) {
  const h = harness(sec, seed, { failAmmo }), { eng, gun, rng } = h;
  await h.start();
  const done = [], fails = [], counts = { fire: 0, alt: 0, lever: 0, melee: 0, die: 0, relink: 0, leverAlt: 0, altSpam: 0, idle: 0, swings: 0, rounds: 0, undo: 0, phoneChain: 0 };
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
    } else if (kind === 'alt') { gun.alt(); note = eng.am.switching ? `phone to ${eng.am.switching.to}` : 'no swap'; counts.alt++; await h.settle(900); }
    else if (kind === 'altSpam') {   // bench 2026-11-08: 2 to 10 presses, 100 to 1200 ms apart, no settle between them
      const k = 2 + Math.floor(rng() * 9);
      for (let j = 0; j < k; j++) { if (j) await h.advance(100 + Math.floor(rng() * 1100)); gun.alt(); }
      note = `${k} presses`; counts.altSpam++;
      await h.settle(900);
    } else if (kind === 'lever' || kind === 'leverAlt') {
      const held = gun.active, x = gun.slot(held);
      if (gun.live && x.mag < x.clip && x.res > 0) leverExpect = { slot: held, mag: Math.min(x.clip, x.mag + x.res) };
      const s = gun.lever(); note = `gun reloads ${s == null ? 'nothing' : 'slot ' + s}, held ${held}`;
      if (kind === 'leverAlt') {
        await h.advance(150 + Math.floor(rng() * 500));
        gun.alt(); tookAlt = !!eng.am.switching; note += tookAlt ? `, ALT to ${eng.am.switching.to}` : ', no swap';
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
    // Tony 2026-11-08: the desync line is now `gun fired slot N, bound M` (ammo.js `onAmmo`); the old one must never come back
    const desync = fresh.filter(l => l.m.startsWith('gun was on slot') || l.m.startsWith('gun fired slot'));
    if (desync.length) fail(i, `desync: ${desync.map(l => l.m).join('; ')}`);
    if (fresh.some(l => /itself a shell every/.test(l.m))) counts.phoneChain++;   // Tony 2026-11-07: the phone loads a chain in hand
    if (fresh.some(l => /which the trigger is not bound to: put back/.test(l.m))) counts.undo++;   // bench lv1-8: a free refill undone
    if (fresh.some(l => /ALT ignored/.test(l.m))) fail(i, 'the phone ignored an ALT: it owns the swap');
    if (gun.altFn !== 98) fail(i, `the gun's ALT is bound to ${gun.altFn}, not 98`);
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

// Bench 2026-11-08 (lv1-8, brx1): the lever cannot be unbound, and it refills the LAST-FIRED slot whatever the trigger is bound
// to. A lever on a full weapon in hand gave the AR (fired last) a free refill. The phone puts the AR's counts back once that
// refill lands, decided at the lever, so a swap to the AR before it lands still gets no free rounds.
test('swap/reload: lever on a full weapon in hand refills nothing, even with ALT back to the slot fired last (bench lv1-8)', async () => {
  const h = harness('suppressor', 1), { eng, gun } = h;
  await h.start();
  for (let i = 0; i < 3; i++) { gun.trigger(); await h.settle(200); }   // slot 0 fires: 29 left, the gun's latch is slot 0
  assert.ok(h.swap(), 'setup: ALT to the secondary');
  await h.settle(900);
  assert.equal(eng.activeSlot, 1, 'setup: on the secondary, which is full');
  assert.equal(gun.lever(), 0, 'setup: the gun spends the lever on slot 0, the slot that fired last');
  await h.advance(300);
  assert.ok(h.swap(), 'ALT back to the AR while the gun reloads it');
  await h.settle(4000);
  assert.equal(gun.active, 0, 'the trigger is bound to the AR');
  assert.equal(gun.slot(0).mag, 29, 'the AR keeps its 29: the gun\'s free refill was put back');
  assert.equal(eng.activeSlot, 0);
  assert.equal(h.text('#mag') ?? (h.render(), h.text('#mag')), '29');
  assert.ok(h.logs.some(l => /refilled slot 0, which the trigger is not bound to: put back 29/.test(l.m)), 'the undo is logged');
  gun.trigger(); await h.settle(200);
  assert.deepEqual(h.logs.filter(l => /^gun (was on|fired) slot/.test(l.m)).map(l => l.m), [], 'no desync on the next round');
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
    assert.ok(h.swap(), 'setup: ALT to the USP-S'); await h.settle(1500);
    for (let i = 0; i < v.usp; i++) { assert.ok(gun.trigger(), 'setup: the USP-S fires'); await h.advance(gun.slot(1).fireMs + 10); }
    await h.settle(300);
    assert.ok(h.swap(), 'setup: ALT back to the AR'); await h.settle(1500);
    for (let i = 0; i < 3; i++) { assert.ok(gun.trigger(), 'setup: the AR fires, so it fired last'); await h.advance(gun.slot(0).fireMs + 10); }
    await h.settle(300);
    if (v.arFull) { assert.equal(gun.lever(), 0, 'setup: the lever refills the AR'); await h.settle(3000); }
    assert.equal(gun.slot(0).mag === gun.slot(0).clip, v.arFull, 'setup: the AR is full or part-used as the variant says');
    assert.ok(h.swap(), 'setup: ALT to the USP-S'); await h.settle(1500);
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
  assert.ok(h.swap(), 'setup: ALT to the USP-S'); await h.settle(1500);
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
  assert.ok(h.swap(), 'setup: ALT to the USP-S'); await h.settle(1500);
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
  assert.ok(h.swap(), 'setup: ALT to the USP-S'); await h.settle(1500);
  for (let i = 0; i < 2; i++) { gun.trigger(); await h.advance(gun.slot(1).fireMs + 10); }
  await h.settle(300);
  assert.equal(gun.latch, 1, 'setup: the USP-S fired last');
  const shots = eng.shots;
  eng._stun(3000); await h.advance(2600);
  assert.ok(eng.stunned, 'setup: still stunned');
  assert.ok(h.swap(), 'setup: the stunned gun swaps to the AR');
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
  assert.ok(h.swap(), 'setup: ALT to the USP-S'); await h.settle(1500);
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

// F465 (bench 2026-10-16, Tony: by design): a stunned gun still swaps on ALT, under the same lockout. The phone ignored the
// press, so after the stun the HUD named the old weapon and the next round logged `gun was on slot`.
test('swap/reload: ALT while stunned is a swap, and the trigger stays blocked until the stun ends (F465)', async () => {
  const h = harness('usp', 4), { eng, gun } = h;
  await h.start();
  assert.ok(gun.trigger(), 'setup: the AR fires'); await h.settle(300);
  eng._stun(3000); await h.advance(200);
  assert.ok(eng.stunned, 'setup: stunned');
  assert.ok(h.swap(), 'ALT while stunned swaps');
  await h.advance(1000);
  assert.equal(gun.active, 1, 'the trigger is bound to the USP-S inside the stun');
  assert.equal(gun.trigger(), false, 'the trigger is still blocked: the stun disarmed the gun');
  await h.settle(4000);
  assert.ok(!eng.stunned, 'setup: the stun is over');
  assert.equal(eng.activeSlot, 1, 'the HUD is on the USP-S');
  assert.ok(gun.trigger(), 'the USP-S fires after the stun'); await h.settle(300);
  assert.deepEqual(h.logs.filter(l => /^gun (was on|fired) slot/.test(l.m)).map(l => l.m), [], 'no desync');
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
// The Shotgun's chain on the slot fired last while the phone reloads the rifle (Tony 2026-11-08: the phone undoes the gun's
// free refill of the slot the trigger is not bound to), and the phone's own reload writes failing before they leave (the
// books must stay with the gun).
test('swap/reload torture: assault rifle + shotgun (a chain on the slot fired last), zero desync', async () => {
  let undo = 0, phoneChain = 0, altSpam = 0;
  for (const seed of [301, 302, 303, 304, 305, 306]) {
    const { counts, fails } = await torture('shotgun', seed, ACTIONS, { combos: true });
    assert.deepEqual(fails, [], fails.join('\n\n'));
    assert.ok(counts.lever > 20 && counts.alt > 20, `seed ${seed} exercised the lever and ALT: ${JSON.stringify(counts)}`);
    undo += counts.undo; phoneChain += counts.phoneChain; altSpam += counts.altSpam;
  }
  assert.ok(altSpam >= 5, `the run pressed ALT in quick runs: ${altSpam}`);
  assert.ok(undo >= 3, `the run undid the gun's free refill of the slot the trigger is not bound to: ${undo}`);
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

// Tony 2026-11-08: the PHONE owns the weapon swap (bench 2026-11-08, bm1-3 and swp1, on 0.4.39). ALT is unbound on the
// gun (`$BMAP,1,98`); on ALT the phone holds the trigger (`$BMAP,0,98`), then binds it to the target (`$BMAP,0,<slot>`) after
// that slot's tok15. Each of these was a desync under the gun's own ALT (SR17, SR18, B2).
const bindRows = h => h.gun.writes.filter(f => f.startsWith('$BMAP,0,') || f.startsWith('$BMAP,1,'));
test('phone swap: the head goes out with ALT unbound (98), and ALT binds the trigger only after the target\'s tok15', async () => {
  const h = harness('usp', 11), { eng, gun } = h;
  await h.start();
  assert.equal(gun.altFn, 98, 'the gun\'s ALT is unbound');
  gun.writes.length = 0;
  assert.ok(h.swap(), 'ALT swaps on the phone');
  assert.equal(eng.activeSlot, 1, 'the trigger slot moves at once');
  assert.ok(eng.am.switchingMs() != null, 'the HUD shows SWITCHING');
  await h.advance(20);
  assert.deepEqual(bindRows(h), ['$BMAP,0,98,,,,,*'], 'the trigger is held at once');
  assert.ok(gun.writes.some(f => f === '$PLAY,,4,6,D06,,,,*'), 'the USP-S rack plays');
  await h.advance(460);
  assert.equal(gun.triggerLive, false, 'still held inside the USP-S tok15 (500 ms)');
  await h.advance(100);
  assert.deepEqual(bindRows(h), ['$BMAP,0,98,,,,,*', '$BMAP,0,1,,,,,*'], 'bound to the USP-S after 500 ms');
  assert.equal(gun.active, 1);
});
test('phone swap: ALT with the trigger held, during a burst and after a dry pull is a swap (B2, SR17)', async () => {
  const h = harness('usp', 12), { eng, gun } = h;
  await h.start();
  gun.trigger(); await h.advance(20);   // the trigger is down (released at 60 ms)
  assert.ok(h.swap(), 'ALT with the trigger held');
  await h.settle(1500);
  assert.equal(gun.active, 1); assert.equal(eng.activeSlot, 1);
  for (let i = 0; i < 12; i++) { gun.trigger(); await h.advance(gun.slot(1).fireMs + 10); }   // empty the USP-S
  await h.settle(300);
  assert.equal(gun.slot(1).mag, 0, 'setup: the USP-S is empty');
  gun.trigger(); await h.advance(53);   // a dry pull
  assert.ok(h.swap(), 'ALT 53 ms after a dry pull');
  await h.settle(1500);
  assert.equal(gun.active, 0); assert.equal(eng.activeSlot, 0);
  assert.ok(gun.trigger(), 'the AR fires'); await h.advance(30);
  assert.ok(h.swap(), 'ALT during the AR\'s fire');
  await h.settle(1500);
  assert.equal(gun.active, 1); assert.equal(eng.activeSlot, 1);
  assert.deepEqual(h.logs.filter(l => /^gun (was on|fired) slot|ALT ignored/.test(l.m)).map(l => l.m), [], 'no desync, no refused ALT');
});
test('phone swap: a double ALT retargets; only the last target is bound', async () => {
  const h = harness('usp', 13), { eng, gun } = h;
  await h.start();
  gun.writes.length = 0;
  assert.ok(h.swap()); await h.advance(200);
  assert.ok(h.swap(), 'a second ALT inside the window');
  assert.equal(eng.activeSlot, 0, 'back to the AR');
  await h.settle(1500);
  assert.deepEqual(bindRows(h), ['$BMAP,0,98,,,,,*', '$BMAP,0,0,,,,,*'], 'one hold, then the AR bound; the USP-S never bound');
  assert.equal(gun.active, 0);
});
test('phone swap: a cure inside a swap keeps the trigger held, and RESYNC on slot 1 binds slot 1 (SR18)', async () => {
  const h = harness('usp', 14), { eng, gun } = h;
  await h.start();
  assert.ok(h.swap()); await h.advance(100);
  gun.writes.length = 0;
  eng._cureReassert(null, null);
  assert.deepEqual(bindRows(h), ['$BMAP,0,98,,,,,*'], 'the cure\'s `$BMAP,0,0` holds the trigger while the swap runs');
  await h.settle(1500);
  assert.equal(gun.active, 1, 'the swap still binds the USP-S');
  gun.writes.length = 0;
  eng._cureReassert(null, null);
  assert.deepEqual(bindRows(h), ['$BMAP,0,1,,,,,*'], 'the cure binds the slot in hand, never a literal 0');
  gun.writes.length = 0;
  eng.onMcMessage({ kind: 'control', body: { cmd: 'resync', match_id: 'm1' } });
  await h.settle(1500);
  assert.ok(bindRows(h).length > 0 && bindRows(h).every(f => f === '$BMAP,0,1,,,,,*'), `RESYNC binds slot 1: ${JSON.stringify(bindRows(h))}`);
  assert.equal(gun.active, 1);
  assert.ok(gun.trigger(), 'the USP-S fires'); await h.settle(300);
  assert.equal(eng.activeSlot, 1);
});
test('phone swap: a swap then a lever with no shot between gives no free refill of the old slot (bench lv1-8)', async () => {
  const h = harness('usp', 15), { eng, gun } = h;
  await h.start();
  for (let i = 0; i < 4; i++) { gun.trigger(); await h.settle(150); }   // the AR fires 4: 28 left, the gun's latch is the AR
  for (let i = 0; i < 3; i++) { assert.ok(h.swap()); await h.settle(1500); }   // ends on the USP-S
  assert.equal(gun.slot(1).mag, 12, 'setup: the USP-S is full');
  assert.equal(gun.lever(), 0, 'setup: the gun spends the lever on the AR, the slot fired last');
  await h.settle(5000);
  assert.equal(gun.slot(0).mag, 28, 'the AR keeps 28: no free refill');
  assert.equal(eng.am.prevAmmo[0], 28);
  assert.equal(gun.active, 1); assert.equal(eng.activeSlot, 1);
});
test('phone swap: a lever on the USP-S after a swap reloads the USP-S, with the trigger held through the reload (bench lv1-8)', async () => {
  const h = harness('usp', 16), { eng, gun } = h;
  await h.start();
  gun.trigger(); await h.settle(150);   // the AR fired last
  assert.ok(h.swap()); await h.settle(1500);
  for (let i = 0; i < 3; i++) { gun.trigger(); await h.advance(gun.slot(1).fireMs + 10); }
  await h.settle(300);
  assert.equal(gun.slot(1).mag, 9, 'setup: the USP-S at 9');
  // the USP-S fired last now, so the gun's own lever reloads it: the phone books it and writes nothing
  gun.writes.length = 0;
  assert.equal(gun.lever(), 1);
  await h.settle(5000);
  assert.equal(gun.slot(1).mag, 12, 'the USP-S reloaded');
  assert.ok(!gun.writes.some(f => f.startsWith('$AMMO,')), 'no write: the gun\'s reload of the bound slot is right');
  // swap to the AR (fired 1) and back: the lever goes to the USP-S, fired last, while the AR is bound
  assert.ok(h.swap()); await h.settle(1500);
  gun.writes.length = 0;
  assert.equal(gun.lever(), null, 'setup: the USP-S is full, so the gun reloads nothing');
  await h.advance(100);
  assert.deepEqual(bindRows(h), ['$BMAP,0,98,,,,,*'], 'the phone holds the trigger for its reload of the AR');
  await h.settle(5000);
  assert.equal(gun.slot(0).mag, 32, 'the phone reloaded the AR');
  assert.equal(gun.active, 0); assert.ok(gun.triggerLive, 'the trigger is bound again after the reload');
});
test('phone swap: a one-weapon Easy Reload kit keeps ALT on reload (fn 97), never 98 (accessibility)', async () => {
  const h = harness('usp', 17, { easyOne: true }), { eng, gun } = h;
  await h.start();
  assert.equal(eng._slotCount(), 1, 'setup: one weapon');
  assert.equal(gun.altFn, 97, 'the gun\'s ALT stays on reload');
  assert.ok(!gun.writes.includes('$BMAP,1,98,,,,,*'), 'ALT was never unbound');
  for (let i = 0; i < 5; i++) { gun.trigger(); await h.settle(150); }
  assert.equal(h.swap(), false, 'ALT opens no swap');
  assert.ok(eng.am.reloading, 'ALT is the reload');
  assert.equal(gun.active, 0);
  // the rewrite itself: a swap kit's ALT row is unbound, Easy Reload's 97 passes as written
  assert.deepEqual(eng._bindRows(['$BMAP,1,97,,,,,*', '$BMAP,1,100,0,1,99,99,*']), ['$BMAP,1,97,,,,,*', '$BMAP,1,98,,,,,*']);
});

// Codex review 2026-11-08 of the phone swap: the trigger must never be left held (98) or bound to a slot the phone does not
// show. `_bindTick` repairs the binding from what was really sent (`_noteBindSent`).
test('phone swap (Codex H1): a stun that cancels the phone\'s reload does not leave the trigger held', async () => {
  const h = harness('usp', 21), { eng, gun } = h;
  await h.start();
  gun.trigger(); await h.settle(150);                                    // the AR fired last
  assert.ok(h.swap()); await h.settle(1500);
  for (let i = 0; i < 3; i++) { gun.trigger(); await h.advance(gun.slot(1).fireMs + 10); }
  await h.settle(300);
  assert.ok(h.swap()); await h.settle(1500);                             // back on the AR, the USP-S fired last
  for (let i = 0; i < 2; i++) { gun.trigger(); await h.settle(150); }
  assert.ok(h.swap()); await h.settle(1500);                             // on the USP-S at 9; the AR fired last
  gun.lever(); await h.advance(100);
  assert.ok(eng.am.reloading && eng.am.reloading.soft, 'setup: the phone reloads the USP-S');
  assert.equal(gun.triggerLive, false, 'setup: the trigger is held for the reload');
  eng._stun(4000); await h.settle(6000);
  assert.ok(!eng.stunned && !eng.am.reloading, 'setup: the stun is over and the reload was cut');
  assert.equal(gun.triggerLive, true, 'the trigger is bound again');
  assert.equal(gun.active, 1);
  assert.ok(gun.trigger(), 'the USP-S fires');
});
test('phone swap (Codex H5): a respawn after a death on the secondary binds slot 0, never the old life\'s slot', async () => {
  const h = harness('usp', 22), { eng, gun } = h;
  await h.start();
  assert.ok(h.swap()); await h.settle(1500);
  assert.equal(gun.active, 1, 'setup: on the USP-S');
  gun.die(); await h.advance(2000);
  gun.writes.length = 0;
  h.operatorRespawn(); await h.settle(2500, 12000);
  assert.ok(eng.alive && gun.live, 'setup: respawned');
  assert.deepEqual(gun.writes.filter(f => /^\$BMAP,0,\d+,/.test(f) && f !== '$BMAP,0,98,,,,,*'), ['$BMAP,0,0,,,,,*'], 'only slot 0 is ever bound');
  assert.equal(gun.active, 0); assert.equal(eng.activeSlot, 0);
});
