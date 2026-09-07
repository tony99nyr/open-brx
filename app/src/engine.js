// BRX node engine — docs/spec/node.md (contracts A6). DOM-free, BLE-free, transport-free.
//
// Inputs:  BRX frames (feedFrame), MC messages (onMcMessage), hydration (hydrate), clock ticks (tick),
//          BLE link events (onBleConnected / onBleDropped), app-lifecycle (resume).
// Outputs: frames to write (writer(frames[])), persisted facts (emit(fact)), non-fact reports
//          (report(kind, body)), and a render-able snapshot (state()) with a change callback.
//
// Every write to the gun goes through `writer`; the engine never composes a frame except the two
// literal templates (`$SFLASH,*`, `$PLAYX,0,*`) and the pre-config probe set (contracts §3/§8).

import * as W from './transport/envelope.js';   // single source for the contracts §9 constants
import { stationView, TEAM_ANY } from './beacon.js';   // utility-item presence (docs/spec/utility.md)
export const C = {
  STATUS_HEARTBEAT_MS: W.STATUS_HEARTBEAT_MS, SYNC_FRESH_MS: W.SYNC_FRESH_MS, FEEDBACK_MAX_AGE_MS: W.FEEDBACK_MAX_AGE_MS,
  LATE_ARM_GRACE_MS: W.LATE_ARM_GRACE_MS, DEATH_LATCH_MS: W.DEATH_LATCH_MS, RESYNC_PROBE_S: W.RESYNC_PROBE_S,
  CONFIG_TTL_MS: 1_800_000,
};
export const SFLASH = '$SFLASH,*';
export const PLAYX = '$PLAYX,0,*';
export const PROBE_VOLTS = ['$PHONE,*'];
export const PROBE_FW = ['$STOP,*', '$PHONE,*', '$VERSION,*'];

const PHASES = ['idle', 'connected', 'kitted', 'lobby', 'armed', 'live'];
const TEAM_NAME = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'GREEN' };
// How long the HUD shows the ALT indicator before giving up on a confirmation.
// The gun only volunteers $ALCD on a SHOT, so a swap is confirmed by the next trigger pull and this
// window is a display timeout, nothing more. On expiry the indicator simply clears — the HUD keeps
// showing the slot the GUN last reported. It deliberately does NOT guess a new slot: $BUT,1 is
// "alt-fire", which is also the native 3s indoor/outdoor toggle and is remapped to RELOAD by the
// easy_reload perk, so a press is not proof a weapon changed (review 2026-08-31).
const RECONCILE_MS = 3000;           // rejoin: hold the gun disarmed this long while we reconcile state (anti-cheat: a restart is slow + gains nothing; a real crash costs 3 s, which is rare and fine — Tony 2026-09-04)
const HEADSET_REBLINK_MS = 120000;   // re-paint the DOWN out-blink every 2 min (< the ~160 s blink count) so a long scanner walk stays lit
const SWITCH_MAX_MS = 850;       // the stock $WEAP tok15 (bench 2026-09-04: 850 ms, linear, no floor) — a fallback; the bundle carries the real value in frames.swap_ms
const EVENT_MIN_GAP_MS = 1000;
const PAIN_GAP_MS = 600;            // A15.3: at most one pain grunt per 600 ms (drop, never queue)
const MEDAL_GAP_MS = 2000;       // A11.4: medal lines are 1.5-2.5 s; play them back to back, not on top of each other   // A11: no two LED bursts inside a second (three flashes per second is the ceiling)
const RELOAD_GRACE_MS = 600;     // a reload the gun never echoed still clears the takeover this long after reload_s
const TEAM_KEY = { 0: 'red', 1: 'blue', 2: 'yellow', 3: 'green' };

export function toks(f) {
  let s = String(f).trim();
  if (s[0] === '$') s = s.slice(1);
  if (s.endsWith('*')) s = s.slice(0, -1);
  if (s.endsWith(',')) s = s.slice(0, -1);
  return s.split(',');
}

/** Persisted context keys (localStorage-like `storage`). */
const KEY = 'brx.engine';

export class Engine {
  /**
   * @param {object} o
   * @param {(frames:string[]) => (void|Promise<void>)} o.writer   write frames verbatim to the gun
   * @param {(fact:object) => void} [o.emit]                        persisted fact sink (Transport.send)
   * @param {(kind:string, body:object) => void} [o.report]         non-fact uplink (Transport.report)
   * @param {() => number} [o.now]                                  synced clock (Transport.syncedNow)
   * @param {() => boolean} [o.synced]
   * @param {object} [o.storage]                                    localStorage-like
   * @param {(line:string, cls?:string) => void} [o.log]
   */
  constructor({ writer, emit = () => {}, report = () => {}, now = () => Date.now(), synced = () => false,
                storage = null, log = () => {}, onChange = () => {}, delay = (ms, fn) => setTimeout(fn, ms), rng = Math.random } = {}) {
    this.writer = writer; this.emitFact = emit; this.report = report; this.now = now; this.isSynced = synced;
    this.storage = storage; this.log = log; this.onChange = onChange; this.delay = delay; this.rng = rng;   // rng: the A15 cue-pool pick (tests seed it)
    this.reset();
    this._load();
  }

  reset() {
    this.phase = 'idle';            // idle|connected|kitted|lobby|armed|live
    this.gun = null;                // {name, tail, fw?}
    this.bleUp = false; this.wsState = 'offline';
    this.player = null; this.team = null; this.roster = []; this.config = null; this.frames = null;
    this.start = null;              // {match_id, go_live_t, seq, countdown_s}
    this.matchId = null;
    this.hp = 0; this.armor = 0; this.shield = 0; this.ammo = 0; this.reserve = null; this.mag = null;
    this.alive = false; this.deaths = 0; this.shots = 0; this.battery = null; this.fw = null;
    this.carrying = null;   // A11.6: flag team whose colour the headset is blinking while this player carries it
    this.latch = null;              // {shooter_num, shooter_team, at, ir_proto}
    this.deadAt = 0; this.killedBy = null; this.lastHitAt = 0;
    this._deathBlinkAt = 0;         // when the headset out-blink was last (re)painted, so a long DOWN doesn't outlast the count
    this._downRearmSent = false;    // §3.2: `down.rearm` sent for THIS death — one write per death, reset on death and revive
    this._lightGen = 0;             // bumped on teardown (end/panic/BLE drop) so a stray delayed $GLED/$HLED/cue write can't land after it
    this.score = null;              // ScoreRow from MC (kills/assists/accuracy) — null until synced
    this.scoreAt = 0;
    this.headEcho = null; this.headWrittenAt = 0; this.awaitingEcho = false;
    this.spawned = false; this.ended = false;
    this.cuesFired = new Set();
    this.tutorial = false; this.tutorialWeapon = null;
    // A10 — self-serve kitting (docs/spec/loadout.md §4)
    this.catalog = null;            // {weapons: WeaponView[], perks: PerkView[]} — arrives in `assign`
    this.policy = null;             // {hud_select, primary:{choice, allowed_ids}, secondary:{choice, kinds, allowed_weapon_ids}, perk:{choice, allowed_perk_ids}} (A14)
    this.browsing = false;          // the HUD's LOADOUT browser is open (reported to MC as loadout_browse)
    this.game = null;               // A10 §4.6: assign.game — what the BRIEFING screen shows
    this.briefSeen = false;         // the player tapped BUILD MY KIT ▸ on the briefing (reset when kit_open flips true)
    this.loadoutAck = null;         // MC's verdict on the last pick: {slot, ok, reason, t} — tick() clears it after ~4 s
    this.pendingPick = null;        // optimistic highlight until the ack lands: {slot, kind, id, at}
    this.tryoutSeen = null;         // weapon_id of a try-out panel the player dismissed with DONE (panel hides, gun stays armed)
    this.resync = null;             // §3.10 state machine: {step, since, lastAmmo, lastReserve}
    this.reconciling = null;        // {since} — a rejoin's disarmed reconcile window (S7.1); no death is inferred here
    this.rewriteHeadAtT10 = false;  // start-sequence §3 fallback (bench-gated)
    this._headRewritten = false;
    this.moment = null;             // transient HUD moment: {kind, at, data}
    this.probeSent = false;
    this.night = false;
    this.lastVoltsAt = 0;
    this.hurtFired = false;         // low-health alert already sent this life
    this.switching = null;          // {at, from} while an ALT weapon swap is in flight (field 2026-08-30)
    this.reloading = null;          // {at, ms, slot} from the reload-handle pull ($BUT,2) until the mag comes back ($ALCD up) — HUD takeover (review 2026-09-03 #15)
    this.lastSwitchMs = null;       // measured duration of the last completed swap
    this._prevAmmo = {};            // per weapon slot ($ALCD token 3): last mag seen
    this.activeSlot = 0;
    this.magBySlot = {};
    this.endedMatches = [];         // match_ids already ended locally — a re-hydrated `start` for them is a no-op
    this.endAck = false;            // result screen shown until the player taps OK (then the 'over' screen)
    this.onEnd = null;              // app hook: called once per ended match with a stats summary (history)
    this.configPending = false;     // config arrived while the gun was unlinked → write head on relink
    this.pendingTeardown = null;    // 'end' | 'panic' owed to the gun once it relinks
    this.stations = [];             // utility items in radio range (beacon.js Presence entries), newest snapshot from the app
    this._stationSig = '';
  }

  // ---------- persistence (§3.7) ----------
  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify({
        phase: this.phase, gun: this.gun, player: this.player, team: this.team, roster: this.roster,
        config: this.config, frames: this.frames, start: this.start, matchId: this.matchId,
        deaths: this.deaths, shots: this.shots, spawned: this.spawned, ended: this.ended, savedAt: this.now(),
        // combat state — WITHOUT this a rejoin defaults alive:false/hp:0, the recovery guard stamps a
        // death, and auto-respawn HEALS you to full: force-close at 1 hp, reopen, get a free respawn
        // (bench 2026-09-04, Tony — a real cheat). Restoring the real pools closes it; the resync still
        // corrects anything that changed while the link was down.
        alive: this.alive, hp: this.hp, armor: this.armor, shield: this.shield, deadAt: this.deadAt, killedBy: this.killedBy,
        endedMatches: this.endedMatches.slice(-8), configPending: this.configPending, pendingTeardown: this.pendingTeardown,
        catalog: this.catalog, policy: this.policy, game: this.game, briefSeen: this.briefSeen,
      }));
    } catch (_) { /* ignore */ }
  }
  _load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(KEY); if (!raw) return;
      const s = JSON.parse(raw);
      if (s.savedAt && this.now() - s.savedAt > C.CONFIG_TTL_MS) { this.log('persisted context expired', 'li'); return; }
      Object.assign(this, { gun: s.gun, player: s.player, team: s.team, roster: s.roster || [], config: s.config,
        frames: s.frames, start: s.start, matchId: s.matchId, deaths: s.deaths || 0, shots: s.shots || 0,
        spawned: !!s.spawned, ended: !!s.ended, endedMatches: s.endedMatches || [], configPending: !!s.configPending, pendingTeardown: s.pendingTeardown || null,
        alive: !!s.alive, hp: s.hp || 0, armor: s.armor || 0, shield: s.shield || 0, deadAt: s.deadAt || 0, killedBy: s.killedBy || null,
        catalog: s.catalog || null, policy: s.policy || null, game: s.game || null, briefSeen: !!s.briefSeen });
      // Phase is re-derived when the gun reconnects (resumeSchedule); until then we are idle.
      this._pendingPhase = s.phase;
    } catch (_) { /* ignore */ }
  }
  clearPersisted() { try { this.storage && this.storage.removeItem(KEY); } catch (_) { /* ignore */ } }

  // ---------- helpers ----------
  _set(phase) {
    if (this.phase === phase) return;
    this.log(`phase ${this.phase} → ${phase}`, 'lk');
    this.phase = phase; this._changed();
  }
  _changed() { this._save(); try { this.onChange(this); } catch (_) { /* ignore */ } }
  _write(frames, why) {
    if (!frames || !frames.length) return;
    this.log(`write ${why}: ${frames.length} frame(s)`, 'li');
    try { return this.writer(frames); } catch (e) { this.log(`write ${why} failed: ${e && e.message || e}`, 'le'); }
  }
  teamOf(num) { const r = this.roster.find(x => x.player_num === num); return r ? r.team_id : null; }
  nameOf(num) { const r = this.roster.find(x => x.player_num === num); return r ? r.display : null; }
  get teamTid() { return this.team ? this.team.tid : null; }
  get teamKey() { return this.team ? (TEAM_KEY[this.team.tid] || String(this.team.color || 'blue')) : 'blue'; }
  get maxHp() { return (this.config && this.config.health && this.config.health.max_hp) || 45; }
  get maxArmor() { return (this.config && this.config.health && this.config.health.max_armor) || 70; }
  get respawnDelayMs() { return ((this.config && this.config.respawn && this.config.respawn.delay_s) || 10) * 1000; }
  get respawnType() { return (this.config && this.config.respawn && this.config.respawn.type) || 'auto'; }
  /** scanner respawn: 'trigger' = at the station AND pull the trigger (default); 'presence' = being at the station is enough */
  get respawnGate() { return (this.config && this.config.respawn && this.config.respawn.gate) || 'trigger'; }
  get timeLimitMs() { const s = this.config && this.config.time_limit_s; return s ? s * 1000 : null; }
  get goLiveT() { return this.start ? this.start.go_live_t : null; }
  get endT() { return (this.goLiveT && this.timeLimitMs) ? this.goLiveT + this.timeLimitMs : null; }
  get weaponName() {
    const ws = this.player && this.player.loadout && this.player.loadout.weapons;
    const w = ws && (ws[this.activeSlot] || ws[0]);
    if (!w) return 'PRIMARY';
    const row = this.weaponRow(w.weapon_id);
    return (row && row.name ? row.name : String(w.weapon_id).replace(/_/g, ' ')).toUpperCase();
  }
  weaponRow(id) { const c = this.catalog; return (c && c.weapons && c.weapons.find(w => w.weapon_id === id)) || null; }
  perkRow(id) { const c = this.catalog; return (c && c.perks && c.perks.find(w => w.perk_id === id)) || null; }
  armState() { return this.phase; }

  // ---------- BLE link ----------
  onBleConnected(gun) {
    const first = !this.bleUp && !this.gun;
    this.gun = gun || this.gun; this.bleUp = true;
    if (this.phase === 'idle') {
      // Re-derive the phase from persisted context (§3.7 / §3.11).
      const p = this._pendingPhase; this._pendingPhase = null;
      if (p && p !== 'idle' && this.player) { this.phase = p; this.log(`restored phase ${p} from storage`, 'li'); }
      else this.phase = this.player ? 'kitted' : 'connected';   // MC-first hydrate: player known → KITTED, not CONNECTED
    }
    let justPanicked = false;
    if (this.pendingTeardown) { justPanicked = this.pendingTeardown === 'panic'; this._writeTeardown(this.pendingTeardown, 'relink'); this.pendingTeardown = null; }
    if (this.phase === 'connected' || this.phase === 'kitted') this._probe();
    // A head we hold but never wrote (config/hydrate arrived with the gun unlinked) is written now —
    // never over a match-over screen (`ended`) and never right after a panic we just delivered.
    if (!justPanicked && !this.ended && this.frames && this.frames.head && (this.phase === 'kitted' || (this.phase === 'lobby' && !this.headEcho))) {
      this.configPending = false; this._applyConfig({ config: this.config, frames: this.frames, roster: this.roster }, 'relink');
    } else if (this.phase === 'live') this._beginReconcile();   // S7.1: a rejoin RECONCILES (disarm, keep real pools) — never the infer-death resync that healed on restart
    else if (this.phase === 'lobby' || this.phase === 'armed') this._beginResync('ble-reconnect');
    if (first) this.log(`gun ${this.gun ? this.gun.name : '?'} linked`, 'lk');
    // A restored/held schedule is reconciled against the clock now (E5: grace / hot-join / already over).
    // MC-first late joiner: the running `start` arrived while idle and the relink landed in LOBBY — reconcile from there too.
    if (this.start && (this.phase === 'lobby' || this.phase === 'armed')) this.resumeSchedule();
    this._changed();
  }
  onBleDropped() { this.bleUp = false; this.reloading = null; this.switching = null; this._lightGen = (this._lightGen || 0) + 1; this.log('gun link lost', 'le'); this._changed(); }   // no link, no reload echo: the takeover would be fiction (pass-2 UX review 2026-09-03); the gen bump means a stray delayed write can't reach a gun that relinks mid-flight either
  setWsState(s, info) { this.wsState = s; this.wsReason = s === 'rejected' && info ? `${info.reason || 'refused'} (${info.code})` : null; this._changed(); }

  /** Pre-config probe set: only in CONNECTED/KITTED, never after a head is written (contracts §3). */
  _probe() {
    if (this.probeSent || !(this.phase === 'connected' || this.phase === 'kitted')) return;
    this.probeSent = true;
    this._write([...PROBE_FW], 'probe');
  }

  // ---------- MC context ----------
  hydrate(node) {
    if (!node) return;
    if (node.player) this.player = node.player;
    if (node.team) this.team = node.team;
    if (node.roster) this.roster = node.roster;
    if (node.config) this.config = node.config;
    if (node.frames) this.frames = node.frames;
    if (node.catalog) this.catalog = node.catalog;   // A10: a welcome may re-hydrate the catalog/policy too
    if (node.policy) this.policy = node.policy;
    if (node.game) this.game = node.game;
    if (node.score) { this.score = node.score; this.scoreAt = this.now(); }
    if (node.match_id) this.matchId = node.match_id;
    if (node.config && node.config.night != null) this.night = !!node.config.night;
    if (this.player && this.phase === 'connected') this._set('kitted');
    if (node.frames && node.config && (this.phase === 'kitted')) {
      // A rejoining node that missed the push: apply the head like a fresh `config`.
      this._applyConfig({ config: node.config, frames: node.frames, roster: node.roster || this.roster }, 'hydrate');
    }
    if (node.start && !(node.start.match_id && this.endedMatches.includes(node.start.match_id))) this.startAt(node.start);
    this._changed();
  }

  onMcMessage({ kind, body, t }) {
    switch (kind) {
      case 'assign': return this._assign(body);
      case 'config': return this._applyConfig(body, 'config');
      case 'tutorial': return this._tutorial(body);
      case 'loadout_ack': return this._loadoutAck(body);
      case 'start': return this.startAt(body);
      case 'feedback': return this.feedback(body, t);
      case 'alert': return this.alert(body, t);
      case 'control': return this.control(body);
      case 'apply': {
        const fr = body.frames || [];
        if (this.phase === 'live') return this._write(fr, 'apply');
        // A9.1 preview: sound-only applies may play OFF-live (voice/gamertag preview at the bench) —
        // restricted to $PLAY/$SFLASH so A6.4's no-state-writes-off-live safety holds.
        if (body.preview && ['connected', 'kitted', 'lobby'].includes(this.phase) && fr.length && fr.every(f => f.startsWith('$PLAY') || f.startsWith('$SFLASH'))) return this._write(fr, 'apply preview');
        return undefined;
      }
      case 'score': if (body && typeof body === 'object') { this.score = body; this.scoreAt = this.now(); this._changed(); } return;   // may carry `board` {teams:[{team_id,name,score}], cap} for the DOWN recap
      default: return;
    }
  }

  _assign({ player, team, roster, catalog, policy, game }) {
    const wasOpen = this.kitOpen();
    if (catalog) this.catalog = catalog;
    if (policy) this.policy = policy;
    if (game) this.game = game;
    if (!wasOpen && this.kitOpen()) this.briefSeen = false;   // §4.6: the kit just opened — show the BRIEFING, the player taps through
    if (!this.kitOpen()) this.browse(false);                   // MC went back to setting up: no browser while the kit is closed
    if (this.ended) { this.ended = false; this.endAck = false; this.matchId = null; this.start = null; this.log('new match from MC — leaving the match-complete screen', 'lk'); }
    this.player = player || this.player; this.team = team || this.team; if (roster) this.roster = roster;
    if (this.phase === 'connected' || this.phase === 'idle') { if (this.bleUp) this._set('kitted'); }
    this._changed();
    if (this.browsing && !this.canPick('primary') && !this.canPick('secondary') && !this.canPick('perk')) this.browse(false);   // A10: rules locked every slot while the browser was open
  }

  _applyConfig({ config, frames, roster }, why) {
    this.config = config || this.config;
    this.browse(false);   // the LOADOUT browser is a KITTED-phase screen; a config push ends kit-out
    this.frames = frames || this.frames; if (roster) this.roster = roster;
    if (config && config.night != null) this.night = !!config.night;
    this.tutorial = false; this.tutorialWeapon = null;
    if (!this.frames || !this.frames.head) { this.log('config without frames — ignored', 'le'); return; }
    if (!this.bleUp) { this.configPending = true; this.log('config stored; gun not linked yet — head will be written on relink', 'li'); this._changed(); return; }
    this.configPending = false; this._panicked = null;
    this.headEcho = null; this.awaitingEcho = true; this.headWrittenAt = this.now();
    this._writeHead(why === 'hydrate' ? 'head (rehydrate)' : 'head');
    this.spawned = false; this.ended = false;
    if (this.phase !== 'armed' && this.phase !== 'live') this._set('lobby');
    this._changed();
  }
  /** Called by tick(): 1.5 s after the head write, report the echo (or its absence). */
  _checkEcho() {
    if (!this.awaitingEcho || this.now() - this.headWrittenAt < 1500) return;
    this.awaitingEcho = false;
    const cid = this.config && this.config.config_id;
    if (this.headEcho) this.report('ack_config', { config_id: cid, ok: true, gun_echo: this.headEcho });
    else this.report('ack_config', { config_id: cid, ok: false, err: 'no_echo' });
  }

  _tutorial({ frames, weapon, end }) {
    if (this.phase !== 'kitted' || !frames) return;
    if (end) {                               // host ended the try-out: quiet the gun, drop the panel
      this.tutorial = false; this.tutorialWeapon = null;
      this._write(frames, 'tutorial end');
      this._changed();
      return;
    }
    this.tutorial = true;
    this.tutorialWeapon = weapon || null;    // shown on the HUD: image + details of what's being tried
    this.tryoutSeen = null;                  // a fresh try-out always shows its panel
    this._write(frames, 'tutorial');
    this._changed();
  }

  // ---------- A10 self-serve kitting (docs/spec/loadout.md §4) ----------
  /** §4.1: MC opens the kit only while the host is on KIT before the push. No flag (older MC) = open. */
  kitOpen() { const p = this.policy; return !p || p.kit_open !== false; }
  /** §4.6: BUILD MY KIT ▸ / BRIEFING */
  closeBriefing() { if (!this.briefSeen) { this.briefSeen = true; this._changed(); } }
  openBriefing() { if (this.briefSeen) { this.briefSeen = false; this.browse(false); this._changed(); } }
  /** The player's rights on a slot, from MC's per-player policy (never computed locally). */
  slotRule(slot) {
    const p = this.policy; if (!p) return null;
    return (slot === 'primary' || slot === 'secondary' || slot === 'perk') ? (p[slot] || null) : null;   // A14: three rules
  }
  canPick(slot) {
    const p = this.policy, r = this.slotRule(slot);
    return !!(p && p.hud_select && r && r.choice === 'player' && this.phase === 'kitted' && !this.ended && this.kitOpen());
  }
  /** A14: what a pick would knock out of the OTHER slot, or null. Easy Reload (any perk with `effects.alt_reload`) takes the
   *  ALT button, so it cannot ride with a second weapon: picking it drops the secondary; picking a secondary drops it.
   *  The HUD asks for a second tap before sending (Tony 2026-09-04: "we should warn on that"). */
  conflictFor(slot, kind, id) {
    const lo = this.loadoutView();
    const alt = row => !!(row && row.effects && row.effects.alt_reload);
    if (slot === 'perk' && kind === 'perk' && lo.secondary && alt(this.perkRow(id))) return { slot: 'secondary', id: lo.secondary.weapon_id, name: lo.secondary.name };
    if (slot === 'secondary' && kind === 'weapon' && lo.perk && alt(lo.perk)) return { slot: 'perk', id: lo.perk.perk_id, name: lo.perk.name };
    return null;
  }
  /** Tap a row = equip. `tryIt` (weapons only) also asks MC for the try-out. Returns false if the slot isn't ours. */
  requestLoadout(slot, kind, id = null, tryIt = false) {
    if (!this.canPick(slot)) { this.log(`pick refused locally: ${slot} is not player-choice`, 'le'); return false; }
    if (slot === 'primary' && kind !== 'weapon') return false;
    if (slot === 'secondary' && kind !== 'weapon' && kind !== 'none') return false;   // A14: perks have their own slot
    if (slot === 'perk' && kind !== 'perk' && kind !== 'none') return false;
    if (kind === 'none' && slot === 'primary') return false;
    const body = { player_id: this.player && this.player.player_id, slot, kind };
    if (kind !== 'none') body.id = id;
    if (tryIt && kind === 'weapon') body.try = true;
    this.pendingPick = { slot, kind, id: kind === 'none' ? null : id, at: this.now() };
    this.loadoutAck = null;
    this.report('loadout_request', body);
    this._changed(); return true;
  }
  browse(open) {
    open = !!open;
    if (this.browsing === open) return;
    this.browsing = open;
    this.report('loadout_browse', { player_id: this.player && this.player.player_id, open });
    this._changed();
  }
  _loadoutAck({ slot, ok, reason, dropped, loadout }) {
    if (loadout && this.player) this.player.loadout = loadout;   // MC's echo is the truth (applies on ok AND on a reject → reverts the optimistic row)
    const pk = this.pendingPick;
    this.loadoutAck = { slot, ok: !!ok, reason: reason || null, dropped: dropped || null, t: this.now(), key: pk ? (pk.kind === 'none' ? 'none' : `${pk.kind}:${pk.id}`) : null };   // A14: `dropped` = the other slot this pick knocked out
    if (dropped) this.log(`pick ${slot} dropped ${dropped.slot} ${dropped.id}: ${reason || ''}`, 'lk');
    this.pendingPick = null;
    this._changed();
  }
  /** DONE on the try-out panel: hide it (the gun stays armed until MC ends the try-out or the player readies). */
  dismissTryout() { if (this.tutorial && this.tutorialWeapon) { this.tryoutSeen = this.tutorialWeapon.weapon_id; this._changed(); } }
  /** Structured loadout for the HUD: catalog rows (or id-only stubs when the catalog hasn't arrived). */
  loadoutView() {
    const lo = (this.player && this.player.loadout) || {};
    const ws = lo.weapons || [];
    const stub = id => ({ weapon_id: id, name: String(id).replace(/_/g, ' ') });
    const wrow = id => ({ kind: 'weapon', ...(this.weaponRow(id) || stub(id)) });
    const primary = ws[0] ? wrow(ws[0].weapon_id) : null;
    const secondary = ws[1] ? wrow(ws[1].weapon_id) : null;
    // A14: the perk is its own slot beside the weapons
    const perk = lo.perk ? { kind: 'perk', ...(this.perkRow(lo.perk) || { perk_id: lo.perk, name: String(lo.perk).replace(/_/g, ' '), effects: {} }) } : null;
    return { primary, secondary, perk };
  }

  setReady(ready) {
    if (this.phase !== 'kitted') return false;
    if (ready && !this.isSynced()) { this.log('cannot ready: clock not synced', 'le'); return false; }
    this.ready = !!ready;
    if (this.ready) this.browse(false);   // READY UP commits the kit — the browser closes (loadout.md §4.5)
    this.report('ready', { player_id: this.player && this.player.player_id, ready: this.ready });
    this._changed(); return true;
  }

  // ---------- start (M-START) ----------
  startAt(body) {
    this.browse(false);
    if (!body || !body.go_live_t) return { ok: false, reason: 'bad_start' };
    if (body.match_id && this.endedMatches.includes(body.match_id)) { this.log('start for an already-ended match — ignored', 'li'); return { ok: false, reason: 'match_ended' }; }
    if (this.start && body.seq != null && this.start.seq != null && body.seq < this.start.seq) return { ok: false, reason: 'stale_seq' };
    if (this.start && body.seq === this.start.seq && body.match_id === this.start.match_id) return { ok: true, state: this.phase, reason: 'noop' };
    if (this._panicked && body.match_id === this._panicked.match_id && (body.seq == null || this._panicked.seq == null || body.seq <= this._panicked.seq)) { this.log('start for a schedule I panicked out of — ignored (needs a newer seq)', 'li'); return { ok: false, reason: 'panicked' }; }
    this._panicked = null;
    if (this.config && body.config_id && body.config_id !== this.config.config_id) { this.log('start for a config I do not hold', 'le'); return { ok: false, reason: 'stale_config' }; }
    this.start = { match_id: body.match_id, go_live_t: body.go_live_t, config_id: body.config_id, seq: body.seq, countdown_s: body.countdown_s };
    this._prevRem = null;               // fresh schedule: runway cue edges re-arm
    const newMatch = body.match_id !== this.matchId;
    if (newMatch) { this.score = null; this.scoreAt = null; }   // a new match: last match's K/A/board must not show on the first DOWN
    this.matchId = body.match_id; this.cuesFired = new Set(); this.shots = 0; this.deaths = 0; this.ended = false; this._resyncRevive = false;
    // A NEW match supersedes any in-flight reconnect resync of the OLD one. Without this the resync
    // stays set, the T-0 spawn (guarded on `!this.resync`) never runs, and the gun sits alive-with-0-hp
    // until the player pulls the trigger (bench 2026-09-04, S7). Clear it so the new match spawns clean.
    if (this.resync) { this.log('new match — clearing the old resync so it spawns clean', 'li'); this.resync = null; }
    if (this.reconciling) { this.log('new match — clearing the in-flight rejoin reconcile', 'li'); this.reconciling = null; }
    // A new match must SPAWN even if the node is already `live` from a rejoin of the OLD match. Without
    // this reset, startAt skipped re-arming from `live` and resumeSchedule returned `live` early — the
    // T-0 spawn never ran and the gun sat alive-with-0-hp (bench 2026-09-04, S7, on hardware). Drop the
    // stale live/down state so the new match re-arms → spawns.
    if (newMatch) { this.spawned = false; this.alive = false; this.deadAt = 0; this.killedBy = null; }
    this._turned = false;               // last match's infection flip must not score this one as "turned" (polish 2026-09-04)
    if (this.phase === 'lobby' || this.phase === 'kitted' || this.phase === 'armed' || (newMatch && this.phase === 'live')) this._set('armed');
    this._save();
    return this.resumeSchedule();
  }

  /** E1/E5/E9: reconcile the persisted schedule against synced time (never spawn a possibly-live gun blindly). */
  resumeSchedule() {
    if (!this.start) return { ok: false, reason: 'no_schedule' };
    // No gun linked: leave the phase alone (IDLE keeps its SET MY GUN screen); onBleConnected re-derives it.
    if (!this.bleUp) return { ok: false, reason: 'gun_not_linked' };
    const now = this.now(), T = this.goLiveT;
    if (this.phase === 'live') return { ok: true, state: 'live' };
    if (now < T) { if (this.phase !== 'armed') this._set('armed'); return { ok: true, state: 'armed' }; }
    if (this.endT && now >= this.endT) { this.log('match already over on resume', 'li'); this._endLocal('expired-on-resume'); return { ok: false, reason: 'match_over' }; }
    if (this.spawned) { this._set('live'); return { ok: true, state: 'live' }; }
    // T-0 passed and we never spawned: grace / hot-join (E5).
    const late = now - T;
    this.log(late <= C.LATE_ARM_GRACE_MS ? `late spawn (+${late} ms, grace)` : `hot-join (+${Math.round(late / 1000)} s)`, 'lk');
    this._spawn(late <= C.LATE_ARM_GRACE_MS);
    return { ok: true, state: 'live', reason: late <= C.LATE_ARM_GRACE_MS ? 'grace' : 'hot_join' };
  }

  /** A11.6 headset: write a [frame, hold_s] sequence to the headset (frames.headset.*), each step after
   *  the previous one's hold. A newer sequence supersedes an older one: a hit flash that lands while the
   *  start flash is still running simply takes over (the last frame written wins on the hardware). */
  _headset(seq, why) {
    if (!seq || !seq.length) return;
    const gen = (this._hsGen = (this._hsGen || 0) + 1);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: a delayed step checks this too, alongside `gen`'s supersession check
    let t = 0;
    for (const step of seq) {
      const frame = step[0], hold = Math.max(0, Math.round((step[1] || 0) * 1000));
      if (t === 0) this._write([frame], `headset ${why}`);
      else this.delay(t, () => { if (this._hsGen === gen && this._lightGen === lg) this._write([frame], `headset ${why}`); });
      t += hold;
    }
  }
  /** A11.7: take the gun body `after_spawn_s` after a spawn/revive: blank (stops the firmware breathing), then the
   *  rest frame. Inside the spawn burst the blank does not take -- the spawn animation re-enables the breathing
   *  (bench ladder 2026-09-04: +1.0 s and +1.5 s breathing, +2.0 s solid; 2.5 s shipped). Cancelled by a death or
   *  another spawn before it fires. */
  _gunTake() {
    const g = this.frames && this.frames.gun;
    this._gunTaken = false; this._gunBand = null;
    if (!g || !Array.isArray(g.take) || !g.take.length) return;
    const life = (this._gunLife = (this._gunLife || 0) + 1);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: a blank+paint must not land after _endLocal/panic writes $CLEAR/$SP,99
    this.delay(Math.round((g.after_spawn_s || 2.5) * 1000), () => {
      if (life !== this._gunLife || this._lightGen !== lg || !this.alive) return;
      this._write(g.take, 'gun take'); this._gunTaken = true; this._gunBand = g.rest;
    });
  }
  /** A11.7: the gun body's resting frame when the game owns it (frames.gun; absent = firmware breathing).
   *  team/dark: a fixed frame; health: the band for the current hp (bands highest-first, [fraction, frame]). */
  _gunRest() {
    const g = this.frames && this.frames.gun; if (!g || !g.rest) return null;
    if (g.in_play !== 'health' || !Array.isArray(g.bands) || !g.bands.length) return g.rest;
    const frac = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    const band = g.bands.find(b => frac > b[0]) || g.bands[g.bands.length - 1];
    return band[1];
  }
  /** Repaint the health hue when the band changed (one write per band, never per hit). */
  _gunHealthPaint(why) {
    const g = this.frames && this.frames.gun; if (!g || g.in_play !== 'health' || !this._gunTaken) return;
    if (this.phase !== 'live' || !this.alive || !this.spawned) return;
    const f = this._gunRest(); if (!f || f === this._gunBand) return;
    this._gunBand = f; this._write([f], `gun health ${why}`);
  }
  /** The headset's resting frame between events (dark by default, or the team colour). */
  _headsetRest() { const h = this.frames && this.frames.headset; return h && h.rest ? [[h.rest, 0]] : null; }
  /** Carrier blink: on while this player holds the flag/objective of team `tid`; off returns to rest. */
  _carrier(on, tid) {
    const h = this.frames && this.frames.headset; if (!h) return;
    if (on) { const seq = h.carrier && h.carrier[String(tid)]; if (seq) { this.carrying = tid; this._headset(seq, `carrier ${tid}`); } }
    else if (this.carrying != null) { this.carrying = null; this._headset(this._headsetRest(), 'carrier off'); }
  }

  /** A11 presentation event: the bundle's `leds[kind]` burst (frames with holds) + `cues[kind]` sound.
   *  The burst is the hardware-tuned three-flash pattern (2026-09-03) and MUST NOT be repainted or
   *  extended -- a fourth flash in a second is the epilepsy line; so events closer than
   *  EVENT_MIN_GAP_MS apart drop their lights (the sound still plays). */
  _event(kind) {
    const f = this.frames; if (!f) return;
    const pick = this._pickCue(kind);
    if (pick.frame) this._write([pick.frame], `event cue ${kind}${pick.tag}`);
    this._eventLeds(kind);
  }
  /** A15 (Tony 2026-09-06: "the kill confirm sound and taunts should be selected on single kill at random"):
   *  an event whose sound is a `voice:<role>` with several takes ships them all in `cue_pools[kind]`;
   *  pick one at random per event so the gun does not say the same line every time. `cues[kind]` (one
   *  frame) is the pre-A15 shape and the fallback, so an older bundle plays exactly as before. */
  _pickCue(kind) {
    const f = this.frames; if (!f) return { frame: null, tag: '' };
    const single = f.cues && f.cues[kind];
    if (single === '') return { frame: null, tag: '' };   // deliberately mute (announcer off): the pool does not override the profile
    const pool = f.cue_pools && f.cue_pools[kind];
    if (Array.isArray(pool) && pool.length > 1) {
      const i = Math.min(pool.length - 1, Math.max(0, Math.floor(this.rng() * pool.length)));
      return { frame: pool[i], tag: ` (${i + 1}/${pool.length})` };
    }
    return { frame: (f.cues && f.cues[kind]) || null, tag: '' };
  }
  /** `' + spawn line (VAN 2/3)'` for a write reason: the take's id (token 4 of the $PLAY) and its place in the pool. */
  _lineTag(pick) {
    if (!pick || !pick.frame) return '';
    const id = (pick.frame.split(',')[4] || pick.frame.split(',')[1] || '').trim();
    return ` + spawn line (${id}${pick.tag ? ' ' + pick.tag.trim().slice(1, -1) : ''})`;
  }
  /** A15.3: one random frame of `frames[kind]` (a LIST of full frames -- `pset_pool`: one $PSET per death-scream
   *  take). `{frame: null}` when the bundle has no such pool (pre-A15.3), so nothing extra is written. */
  _pickFrame(kind) {
    const pool = this.frames && this.frames[kind];
    if (!Array.isArray(pool) || !pool.length) return { frame: null, tag: '', id: '' };
    const i = pool.length > 1 ? Math.min(pool.length - 1, Math.max(0, Math.floor(this.rng() * pool.length))) : 0;
    const frame = pool[i];
    const id = kind === 'pset_pool' ? (frame.split(',')[10] || '').trim() : '';   // $PSET token 10 = deathScream
    return { frame, tag: pool.length > 1 ? ` ${i + 1}/${pool.length}` : '', id };
  }
  /** A15.3 (Tony 2026-09-06: "The long vs short pain should be used depending on the amount of damage. A big sniper
   *  shot -> long pain. A normal round -> short pain."): the $PSET pain fields ship EMPTY and WE play the grunt on
   *  each registered hit -- `pain_melee` on a melee word (proto 13), `pain_long` when the hit took at least
   *  `voice.pain_long_min` (40: shotgun / snipers / power weapons), else `pain_short`; one random take of that pool.
   *  Gated to one grunt per PAIN_GAP_MS (a burst of rifle hits must not queue six grunts in the gun); never on a
   *  lethal hit (the native death scream plays). `dmg` is what the pools actually lost (crit included). */
  _pain(dmg, proto) {
    const f = this.frames; if (!f) return;
    const kind = proto === 13 ? 'pain_melee' : dmg >= ((f.voice && f.voice.pain_long_min) || 40) ? 'pain_long' : 'pain_short';
    if (!((f.cues && f.cues[kind]) || (f.cue_pools && f.cue_pools[kind]))) return;   // pre-A15.3 bundle: the firmware's own pains
    const now = this.now();
    if (this._lastPainAt != null && now - this._lastPainAt < PAIN_GAP_MS) return;   // drop, never queue
    this._lastPainAt = now;
    const pick = this._pickCue(kind);
    if (pick.frame) this._write([pick.frame], `pain ${kind.slice(5)} (${(pick.frame.split(',')[4] || '').trim()}${pick.tag}) ${dmg} dmg`);
  }
  /** The lights of an event without its sound (feedback plays the medal lines itself). */
  _eventLeds(kind) {
    const f = this.frames; if (!f) return;
    const seq = f.leds && f.leds[kind];
    if (!seq || !seq.length) return;
    const now = this.now();
    if (this._lastEventLed != null && now - this._lastEventLed < EVENT_MIN_GAP_MS) return;
    this._lastEventLed = now;
    let t = 0;
    const gen = (this._hsGen = this._hsGen || 0);   // an event's static $HLED must not land over a later headset sequence (death blink, hit flash); seed the counter so the check is not undefined === 0 after a reload
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: every delayed step below (headset AND gun) checks this
    for (const step of seq) {
      const frame = step[0], hold = Math.max(0, Math.round((step[1] || 0) * 1000));
      if (frame.startsWith('$HLED')) {
        if (!this.alive) { t += hold; continue; }   // down: the out-blink owns the headset (polish 2026-09-04)
        if (t === 0) this._write([frame], `event led ${kind}`); else this.delay(t, () => { if (this._hsGen === gen && this._lightGen === lg && this.alive) this._write([frame], `event led ${kind}`); });
      } else if (t === 0) this._write([frame], `event led ${kind}`); else this.delay(t, () => { if (this._lightGen === lg) this._write([frame], `event led ${kind}`); });
      t += hold;
    }
    const g = f.gun;
    if (g && g.in_play === 'health' && this._gunTaken) this.delay(t, () => { if (this._lightGen !== lg) return; const r = this._gunRest(); if (r && this.alive) { this._gunBand = r; this._write([r], `gun health after ${kind}`); } });   // A11.7: the burst ended on the full-health frame; restore the real band
  }
  _cue(key) {
    const f = this.frames && this.frames.cues && this.frames.cues[key];
    if (f && !this.cuesFired.has(key)) { this.cuesFired.add(key); this._write([f], `cue ${key}`); }
  }
  _spawn(withCountdown) {
    if (!this.frames) return;
    if (withCountdown && !this.cuesFired.has('countdown')) this._cue('countdown');
    // A15.2 (Tony 2026-09-06, bench-verified): the $PSET cry field ships EMPTY so the firmware says nothing at $SPAWN,
    // and WE play one take of the spawn pool in the SAME write ($SPAWN then $PLAY plays clean; a $PLAYX between
    // them clipped the firmware's line). A pre-A15.2 bundle has no cues.spawn: nothing is appended.
    const sp = this._pickCue('spawn');
    // A15.3: the death scream stays NATIVE but is rolled per LIFE -- one of the bundle's pre-composed $PSET frames
    // (one per scream take) goes out first, in the same write (bench 2026-09-06: a $PSET re-sent in play keeps $SIR,
    // does not heal, the gun fires). No pset_pool (pre-A15.3): nothing prepended, the head's $PSET stands.
    const ps = this._pickFrame('pset_pool');
    this._write([...(ps.frame ? [ps.frame] : []), ...this.frames.spawn, SFLASH, ...(sp.frame ? [sp.frame] : [])], 'spawn' + this._lineTag(sp) + (ps.frame ? ` + scream ${ps.id}${ps.tag}` : ''));
    if (this.frames.headset) this._headset(this.frames.headset.start, 'start');   // A11.6: white flash marks the start, then dark (or team)
    this.hurtFired = false;        // the low-health alert is once per LIFE
    this._prevAmmo = {}; this.activeSlot = 0; this.magBySlot = {};   // config echoes carry WEAP clip caps, not spawn mags — never let them set the denominator   // assumption (hardware-UNVERIFIED): a fresh spawn puts the gun on slot 0
    this._cue('klaxon');
    // Spawn shield is ALWAYS 0 on hardware -- $PSET t5 is a capacity filled by an fn-11
    // grant, never a starting pool (bench 2026-08-27).
    this.spawned = true; this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.killedBy = null; this.deadAt = 0; this.reloading = null;
    this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield;
    this._gunTake();   // A11.7
    this.moment = { kind: 'go', at: this.now() };
    this._set('live');
  }

  // ---------- clock tick (call every ~250 ms) ----------
  tick() {
    const now = this.now();
    this._checkEcho();
    if (this.loadoutAck && now - this.loadoutAck.t > 4000) { this.loadoutAck = null; this._changed(); }
    if (this.pendingPick && now - this.pendingPick.at > 6000) { this.pendingPick = null; this._changed(); }   // MC never answered — drop the optimistic row
    if (this.phase === 'armed' && this.start) {
      const rem = this.goLiveT - now;
      // Runway cues are EDGE-triggered: fire only when crossing the threshold from above. With a runway shorter
      // than a threshold the stale cue is skipped — firing them all at arm time stacked three copies of the
      // counting track on the gun ("10, 9, 8, 10, …", bench 2026-08-25).
      const prevRem = this._prevRem != null ? this._prevRem : rem;
      this._prevRem = rem;
      const edge = (ms) => prevRem > ms && rem <= ms;
      if (edge(30000)) this._cue('runway_30');
      if (edge(20000)) this._cue('runway_20');
      if (edge(10000)) this._cue('runway_10');
      if (rem <= 9000 && rem > 3000) { const s = Math.ceil(rem / 1000); const k = `tick${s}`; if (!this.cuesFired.has(k) && this.frames && this.frames.cues && this.frames.cues.tick) { this.cuesFired.add(k); this._write([this.frames.cues.tick], 'tick'); } }
      if (rem <= 3000) this._cue('countdown');
      // Hold-across-disperse is bench-UNVERIFIED (start-sequence §3 / checklist NEXT #1): if the gun drops its
      // config while parked unspawned, enable rewriteHeadAtT10 to re-write frames.head at T-10 s.
      if (this.rewriteHeadAtT10 && rem <= 10000 && !this._headRewritten && this.frames && this.bleUp) { this._headRewritten = true; this._writeHead('T-10 head re-write'); }
      if (rem <= 0 && this.bleUp && !this.resync) this._spawn(false);
      this._changed();
    }
    if (this.phase === 'live') {
      if (this.endT && now >= this.endT) { this._endLocal('time-expiry'); return; }
      // Recovery: a cold boot / resync can land us DOWN (alive false) with no death time — deadAt is not
      // persisted, and resync observes a dead gun without stamping one. Without a deadAt the respawn logic
      // (timer, scanner hint, revive gate) all bail, so a recovered player is stuck with no way back
      // (bench 2026-09-04: "it isn't sensing the respawn station"). Stamp it: they are down as of now.
      if (this.reconciling && now - this.reconciling.since >= RECONCILE_MS) this._endReconcile();
      if (!this.alive && !this.deadAt && !this.resync && !this.reconciling) { this.deadAt = now; this.log('recovered while down — respawn clock started', 'li'); }
      if (this.endT) {   // A11.4 clock callouts from the node's own synced end time: edge-triggered, once each
        const left = this.endT - now, prev = this._prevLeft != null ? this._prevLeft : left; this._prevLeft = left;
        for (const [ms, k] of [[60000, 'time_60'], [30000, 'time_30'], [10000, 'time_10']]) {
          if (prev > ms && left <= ms && !this.cuesFired.has(k)) { this.cuesFired.add(k); this._event(k); this.moment = { kind: 'alert', at: now, data: { kind: k, text: k === 'time_60' ? 'ONE MINUTE LEFT' : k === 'time_30' ? '30 SECONDS' : '10 SECONDS' } }; }
        }
      }
      if (!this.alive && this.deadAt && this.respawnType === 'auto' && now - this.deadAt >= this.respawnDelayMs && this.bleUp && !this.resync && !this.reconciling) {
        const rs = !!this._resyncRevive; this._resyncRevive = false; this._revive(rs);   // §3.10: a resync re-arm is flagged respawn{resync:true}
      }
      // utility.md §4: a scanner respawn with the presence gate revives the moment the player has dwelt at
      // their team's respawn station past the delay. The trigger gate (default) waits for $BUT,0,1 instead.
      if (this.respawnType === 'scanner' && this.respawnGate === 'presence') {
        const st = this._stationRevivable(now); if (st) { this._resyncRevive = false; this._revive(false, st.id); }
      }
      this._reassertDeathBlink(now);   // A11.6: keep the headset out-blink lit through a long DOWN (colour opt-in only)
      this._downRearm(now);            // §3.2: one $HLOOP rearm after the hands-off window (belt-and-braces; the native flash is already running)
      if (this.moment && now - this.moment.at > 4000) { this.moment = null; }
      // A swap the gun never confirmed with a shot: past the assumed window we TAKE the swap as done (the real
      // duration has never been timed — FOLLOWUPS F4; the next $ALCD corrects activeSlot if the gun disagrees).
      if (this.switching && now - this.switching.at > this.switchWindowMs()) {
        const to = this.switching.from === 0 ? 1 : 0; this.switching = null; this.activeSlot = to;
        this.moment = { kind: 'switched', at: now, data: { slot: to, assumed: true } };
        this.log(`swap to slot ${to} assumed after ${this.switchWindowMs()}ms (no shot yet)`, 'li');
      }
      this._changed();
    }
    if (this.resync) this._resyncTick();
  }

  _revive(resync, stationId = null) {
    this.reloading = null;                          // a reload that started in the last life does not follow you into this one
    if (!this.frames) return;
    const down = this.frames.headset && this.frames.headset.down;
    if (down && down.stop) this._write([down.stop], 'down stop');   // §3.2: `$HLOOP,0,0,*` before $SPAWN — belt-and-braces, $SPAWN clears the loop on its own
    this._downRearmSent = false;   // §3.2: fresh rearm gate for the next life
    const sp = this._pickCue('respawned');   // A15.2: the spawn line rides in the revive write (one line, never two)
    const ps = this._pickFrame('pset_pool');   // A15.3: a fresh death scream for this life, written before $SPAWN
    this._write([...(ps.frame ? [ps.frame] : []), ...this.frames.revive, ...(sp.frame ? [sp.frame] : [])], 'revive' + this._lineTag(sp) + (ps.frame ? ` + scream ${ps.id}${ps.tag}` : ''));
    this.hurtFired = false;
    this._prevAmmo = {}; this.activeSlot = 0;   // assumption (hardware-UNVERIFIED): a revive puts the gun back on slot 0
    this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.deadAt = 0; this.killedBy = null;
    this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield;
    this._gunTake();   // A11.7
    this.emitFact({ type: 'respawn', match_id: this.matchId, ...(resync ? { resync: true } : {}), ...(stationId != null ? { station: stationId } : {}) });
    this.moment = { kind: 'redeploy', at: this.now() };
    this.log(resync ? 'resync respawn' : stationId != null ? `respawned at station ${stationId}` : 'respawned', 'lk');
    this._eventLeds('respawned');   // A11 lights only (after the revive frames, so the burst ends on the fresh team colour); the sound went out with the revive write above
    if (this.frames.headset) { this.carrying = null; this._headset(this.frames.headset.respawn, 'respawn'); }   // A11.6
    this._changed();
  }

  _endLocal(why) {
    if (this.ended) return;
    this.ended = true; this._panicked = null; this.endAck = false;
    this._lightGen = (this._lightGen || 0) + 1;   // no delayed $GLED/$HLED/cue step from before teardown may land after it
    try { if (this.onEnd) this.onEnd({ t: this.now(), match_id: this.matchId, kills: this.score ? this.score.kills : null,
      deaths: this.deaths, assists: this.score ? this.score.assists : null,
      accuracy: this.score ? this.score.accuracy : null, shots: this.shots, mode: this.config ? this.config.mode : null }); } catch (_) { /* history is best-effort */ }
    if (this.matchId && !this.endedMatches.includes(this.matchId)) this.endedMatches.push(this.matchId);
    if (this.bleUp) this._writeTeardown('end', why); else { this.pendingTeardown = 'end'; this.log(`end (${why}) owed to the gun — link down`, 'le'); }
    this.spawned = false; this.alive = false; this.resync = null; this.reconciling = null; this.start = null; this._resyncRevive = false; this.reloading = null;
    this.ready = false;
    this.moment = { kind: 'match_over', at: this.now() };
    this._set('kitted');
    this.log(`match ended: ${why}`, 'lk');
  }

  /** True per-slot mags from the bundle's spawn $AMMO frames — the display/warn denominator. */
  _ammoBySlot() {
    const out = {};
    for (const f of (this.frames && this.frames.spawn) || []) {
      if (f.startsWith('$AMMO,')) { const t = f.split(','); out[+t[1]] = +t[2] || null; }
    }
    return out;
  }

  /** Loadout ammo for slot 0 straight from the bundle's spawn frames (display truth for the lobby plate). */
  _loadAmmo() {
    const f = this.frames && this.frames.spawn && this.frames.spawn.find(x => x.startsWith('$AMMO,0,'));
    if (!f) return [null, null];
    const t = f.split(',');
    return [+t[2] || null, +t[3] || null];
  }

  /** Player tapped OK on the result screen → fall through to the 'MATCH COMPLETE' over screen. */
  ackEnd() { if (this.ended) { this.endAck = true; this._changed(); } }

  _writeTeardown(kind, why) {
    if (kind === 'panic') { if (this.frames && this.frames.panic) this._write(this.frames.panic, `panic (${why})`); else this._write(['$CLEAR,*', '$SP,99,*'], `panic (${why})`); return; }
    if (this.frames) {
      this._write(this.frames.end, `end (${why})`);
      // A11.4 HUD-driven ending: in infection a survivor whose clock ran out KNOWS it survived -- it never
      // turned -- so it plays "the survivors have held their ground" itself; everyone else gets game_over.
      const c = this.frames.cues || {};
      const survived = why === 'time-expiry' && this.config && this.config.mode === 'infection' && !this._turned && c.survivors_win;
      const f = survived ? c.survivors_win : c.game_over;
      if (f) this._write([f], survived ? 'cue survivors_win' : 'cue game_over');
    }
  }

  // ---------- control ----------
  control({ cmd, seq }) {
    switch (cmd) {
      case 'end': case 'recall':
        if (this.phase === 'live' || this.phase === 'armed' || this.phase === 'lobby') this._endLocal(cmd);
        // Silently ignoring it is why "END MATCH EARLY did not reach the HUDs" was undiagnosable:
        // both phones were already in `kitted`, where this is a no-op, and nothing said so anywhere.
        else this.log(`control ${cmd} ignored — phase is ${this.phase}`, 'li');   // correct on an unkitted phone: info, not error
        return;
      case 'abort_start':
        if (this.phase === 'armed' && (seq == null || (this.start && this.start.seq === seq))) { this.start = null; this.cuesFired = new Set(); this._write([PLAYX], 'abort'); this._set('lobby'); }
        else if (this.phase === 'live' && this.start && this.start.seq === seq) this._endLocal('abort_start(live)=recall');
        return;
      case 'panic':
        this._lightGen = (this._lightGen || 0) + 1;   // same as _endLocal: cut off any pending delayed light/cue step immediately, not just once delivered
        if (this.bleUp) this._writeTeardown('panic', 'control'); else { this.pendingTeardown = 'panic'; this.log('panic owed to the gun — link down', 'le'); }
        this._resyncRevive = false;   // a panic does NOT retire the match_id — a NEWER start (higher seq) is still accepted later
        // …but a WS welcome re-delivering the SAME schedule must not re-arm a gun the operator just cleared.
        this._panicked = this.start ? { match_id: this.start.match_id, seq: this.start.seq } : null;
        this.spawned = false; this.alive = false; this.start = null; this.resync = null; this.reconciling = null;
        if (this.phase !== 'idle' && this.phase !== 'connected') this._set('kitted');
        this.ready = false;
        return;
      default: return;
    }
  }

  // ---------- feedback (§3.6) ----------
  feedback(body, envT) {
    const t = body.t != null ? body.t : envT;
    if (t != null && this.now() - t > C.FEEDBACK_MAX_AGE_MS) { this.log('feedback too old — ignored', 'li'); return; }
    const pick = body.cue ? { frame: body.cue, tag: '' } : this._pickCue(body.kind);   // A15: a random take from the pool (kill confirms + taunts)
    const cue = pick.frame;
    this._write([SFLASH], `feedback ${body.kind}`);
    // A11.4 Halo-style medals: a kill can carry several ("killtacular" + "killing_spree"); each plays
    // its cue from THIS node's bundle, back to back, and replaces the plain kill line. A cue that is
    // "" is deliberately mute (announcer off) and is skipped; a missing one is skipped too.
    const medalCues = (Array.isArray(body.medals) ? body.medals : [])
      .map(m => ({ m, f: this.frames && this.frames.cues && this.frames.cues[m] })).filter(x => x.f);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: neither a medal line nor the feedback cue may land after the match ended
    if (medalCues.length) {
      medalCues.forEach((x, i) => this.delay(120 + i * MEDAL_GAP_MS, () => { if (this._lightGen === lg) this._write([x.f], `medal ${x.m}`); }));
      this.medals = body.medals.slice();
    } else if (cue) this.delay(120, () => { if (this._lightGen === lg) this._write([cue], `feedback cue ${body.kind}${pick.tag}`); });   // hardware-proven gap (seed): flash, then the line
    this._eventLeds(medalCues.length ? medalCues[0].m : body.kind);   // A11.8: the headset's small LED flash (+ any burst) for the top medal
    if (body.kind === 'kill') {
      if (this.score) this.score = { ...this.score, kills: (this.score.kills || 0) + 1 };
      else this.score = { kills: 1 };
      this.scoreAt = this.now();
      this.moment = { kind: 'kill', at: this.now(), data: { victim_team: body.victim_team, victim: body.victim, medals: Array.isArray(body.medals) ? body.medals.slice() : [] } };
    }
    this._changed();
  }

  /** A11.4 named game event from MC (lead change, next kill wins, flag captured, bomb planted, VIP down…):
   *  play this node's own cue + LED burst for it and show the text as a HUD alert. Stale ones are dropped
   *  like feedback. `hud: false` on the body suppresses the banner (sound/lights still play). */
  alert(body, envT) {
    if (!body || !body.kind) return;
    const t = body.t != null ? body.t : envT;
    if (t != null && this.now() - t > C.FEEDBACK_MAX_AGE_MS) { this.log(`alert ${body.kind} too old — ignored`, 'li'); return; }
    if (this.phase !== 'live' && this.phase !== 'armed') return;
    const me = this.player && this.player.player_id;
    if (body.kind === 'infected' && this._turned && body.player_id_subject && body.player_id_subject === me) return;   // already played on the flip (HUD-driven); MC's copy is for the others
    this._event(body.kind);
    // A11.6 carrier blink: MC names who holds it (`carrier`) and whose flag it is (`flag_tid`)
    if (body.kind === 'objective_taken' && me && body.carrier === me) this._carrier(true, body.flag_tid != null ? body.flag_tid : (this.team ? this.team.tid : 0));
    if ((body.kind === 'objective_scored' || body.kind === 'flag_returned') && this.carrying != null && (!body.carrier || body.carrier === me)) this._carrier(false);
    if (body.hud !== false) this.moment = { kind: 'alert', at: this.now(), data: { kind: body.kind, text: body.text || body.kind, player_id: body.player_id_subject || null } };
    this.log(`alert ${body.kind}`, 'lk');
    this._changed();
  }

  // ---------- BRX frames (§3.2) ----------
  feedFrame(f) {
    const t = toks(f), cmd = t[0];
    switch (cmd) {
      case 'HP': this._onHp(+t[1] || 0, +t[2] || 0, t[3] !== undefined && t[3] !== '' ? (+t[3] || 0) : this.shield); break;
      case 'LCD': {
        this.hp = +t[1] || 0; this.armor = +t[2] || 0;
        // NOTE: do NOT write this.shield from $LCD token 3. Unlike $HP, $LCD's tokens 3-4 are
        // UNDOCUMENTED (docs/manual/06-developer.md, protocol/brx-protocol.md "semantics TBD") and
        // read 0 in every observed frame -- so writing it can only ZERO a live shield, never set one,
        // which silently recreates the Q12 bug this file just fixed. Re-add only once t3 is
        // bench-confirmed as the shield.
        if (t[5] !== undefined) this._onAmmo(+t[5] || 0, t[6] !== undefined ? +t[6] : null, this.activeSlot);
        if (this.awaitingEcho && !this.headEcho) this.headEcho = f;
        const wasResync = !!this.resync;
        if (this.resync) this._resyncEvidence('lcd');
        if (this.phase === 'live' && this.hp === 0 && this.alive) this._death(wasResync);
        break;
      }
      case 'ALCD': {
        if (this.awaitingEcho && !this.headEcho) this.headEcho = f;
        this._onAmmo(+t[1] || 0, t[4] !== undefined ? +t[4] : null, t[3] !== undefined && t[3] !== '' ? +t[3] : 0);
        break;
      }
      case 'HIR': {
        if (t[2] === '15') break; // grenade / station beacon
        const num = parseInt(t[3], 10), team = parseInt(t[4], 10);
        // $HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<damage>,,<subtype> — with t[0] the command
        // word, sensor is t[1] and irProto is t[2]. `ir_proto` read t[1], so it had been reporting
        // the SENSOR all along; every hit_taken fact ever recorded carries that mix-up.
        if (!Number.isNaN(team)) { this.latch = { shooter_num: Number.isNaN(num) ? 0 : num, shooter_team: team, at: this.now(), ir_proto: parseInt(t[2], 10), sensor: parseInt(t[1], 10) }; this.lastHitAt = this.now(); }
        break;
      }
      case 'VOLTS': { const b = parseInt(t[3], 10); if (!Number.isNaN(b)) this.battery = b; this.lastVoltsAt = this.now(); break; }
      case 'VERSION': { if (t[1]) this.fw = t[1]; break; }
      case 'BUT': {
        if (this.resync) this._resyncButton(+t[1], +t[2]);
        // $BUT id 1 = ALT (protocol §$BUT: 0=trigger 1=alt-fire 2=reload 3=select 4/5=left/right).
        // Field 2026-08-30: the HUD only ever learned the live slot from $ALCD, which the gun sends on a
        // SHOT -- so after an ALT swap it kept showing the old weapon "until you press trigger". The
        // button event is the earliest evidence a swap started; $ALCD's slot still gets the last word.
        if (+t[1] === 1 && +t[2] === 1) this._altPressed();
        if (+t[1] === 2 && +t[2] === 1) this._reloadPulled();
        if (+t[1] === 0 && +t[2] === 1) this._triggerPulled();   // a DEAD gun still reports the pull (bench 2026-09-04): the station-revive gate
        break;
      }
      default: break;
    }
    this._changed();
  }

  // ---------- utility items: station presence (docs/spec/utility.md) ----------
  /** The app's latest presence snapshot (beacon.js Presence entries, strongest first). Re-renders only when the
   *  respawn station the HUD shows actually changed (id / present / rounded RSSI), not on every advert. */
  setStations(list) {
    this.stations = Array.isArray(list) ? list : [];
    const v = stationView(this._respawnStation()); const sig = v ? `${v.id}:${v.present}:${v.rssi}:${v.team}` : '';
    if (sig !== this._stationSig) { this._stationSig = sig; this._changed(); }
  }
  /** My team's respawn station: a present one first, else the strongest (the HUD shows how close you are).
   *  A station admits me when it is neutral or on my gun's $TID team; `config.stations`, when given, is the
   *  allow-list of station ids valid in this game (a stray phone from another game cannot revive anyone). */
  _respawnStation() {
    const tid = this.team ? this.team.tid : null;
    const allow = this.config && Array.isArray(this.config.stations) && this.config.stations.length
      ? new Set(this.config.stations.map(x => (x && typeof x === 'object') ? x.id : x)) : null;
    const mine = this.stations.filter(e => e && e.kind === 'respawn' && e.state !== 0 && (e.team === TEAM_ANY || e.team === tid) && (!allow || allow.has(e.id)));
    return mine.find(e => e.present) || mine[0] || null;
  }
  /** The station a scanner revive may use RIGHT NOW, or null: dead, past the delay, link up, not resyncing, present. */
  _stationRevivable(now) {
    if (this.alive || !this.deadAt || this.respawnType !== 'scanner' || !this.bleUp || this.resync || this.reconciling || this.phase !== 'live') return null;
    if (now - this.deadAt < this.respawnDelayMs) return null;
    const st = this._respawnStation();
    return st && st.present ? st : null;
  }
  /** Trigger pulled: on a DEAD gun in scanner mode with the trigger gate, this is the revive request. */
  _triggerPulled() {
    if (this.respawnType !== 'scanner' || this.respawnGate !== 'trigger') return;
    const st = this._stationRevivable(this.now());
    if (!st) { if (!this.alive && this.phase === 'live') this.log('trigger while down: not at a respawn station', 'li'); return; }
    this._resyncRevive = false; this._revive(false, st.id);
  }
  /** The headset out-blink frame list from the bundle (A11.6), or [] when the game opted out ('native'). */
  _headsetDeath() { const h = this.frames && this.frames.headset; return (h && h.death) || []; }
  /** Re-assert the out-blink while a player stays DOWN, so a count-limited blink (~160 s) can't die before
   *  they reach a station (scanner respawn can be a long walk). No-op when the game has no death frame, and
   *  never within a few seconds of the death/revive writes (F13: the headset is a relay, back-to-back writes
   *  to it stick). Called from tick(). */
  /** §3.2 (led-language.md, bench 2026-09-07): the firmware runs its OWN bright out-flash on the headset's
   *  small LED for the whole life, for free — UNLESS an `$HLED,,6` blank was sent during it, which disables
   *  the loop. We write NOTHING to the headset at death any more (the old node-driven pulse was ≥2x dimmer
   *  and cost ~80 writes/min). This is belt-and-braces only: `down.rearm` (`$HLOOP,2,750,*`) restores the
   *  flash at native drive or better for any life where a blank slipped through (an older node, a teardown
   *  race, a mode that still paints effect 6). One write per death, past the hands-off window, never during
   *  resync — same gate as the deleted `_deathFlash`. */
  _downRearm(now) {
    const down = this.frames && this.frames.headset && this.frames.headset.down;
    if (!down || !down.rearm || this.alive || !this.deadAt || this.resync || this._downRearmSent) return;
    if (now - this.deadAt < (down.rearm_after_ms != null ? down.rearm_after_ms : 2500)) return;
    this._downRearmSent = true;
    this._write([down.rearm], 'down rearm');
  }
  /** The `death: <colour>` opt-in ONLY (a big-LED blink held alongside the native flash) re-asserts through
   *  a long DOWN so a count-limited blink (~160 s) can't die before a scanner-mode walk reaches a station.
   *  Never during resync (the gun is disarmed/unverified there), and a no-op when the game didn't opt in. */
  _reassertDeathBlink(now) {
    if (this.alive || !this.deadAt || this.resync || !this._headsetDeath().length) return;
    if (now - this.deadAt < 5000) return;                          // the _die write is still fresh
    if (now - this._deathBlinkAt < HEADSET_REBLINK_MS) return;     // not due yet
    this._headset(this._headsetDeath(), 'death (re-assert)');
    this._deathBlinkAt = now;
  }

  /** What the DOWN screen should tell a scanner-mode player (utility.md §4.3). */
  respawnHint(now) {
    if (this.alive || !this.deadAt || this.phase !== 'live') return null;
    if (this.respawnType === 'auto') return 'timer';
    if (this.respawnType === 'none') return 'out';
    // Scanner: guide to a station from the instant of death (Tony 2026-09-04: a blank STAND BY for the
    // whole respawn delay leaves a first-timer with no idea what to do). The delay only gates the actual
    // revive (_stationRevivable), never the instructions. 'hold' = at your station, revive arms in a beat.
    const st = this._respawnStation();
    if (!st) return 'find_station';
    if (!st.present) return 'approach';
    if (now - this.deadAt < this.respawnDelayMs) return 'hold';
    return this.respawnGate === 'trigger' ? 'pull_trigger' : 'reviving';
  }

  /** ALT pressed: a weapon swap has begun. Shooting is disabled until the gun finishes it. */
  _altPressed() {
    if (this.phase !== 'live' || !this.alive || this.tutorial) return;
    if (this._slotCount() < 2) { this._reloadPulled(); return; }   // empty slot 1: ALT falls back to reload (loadout.md §2) — same takeover as the handle
    this.switching = { at: this.now(), from: this.activeSlot };
    this._changed();
  }

  /** Reload handle pulled: the gun refuses fire for the weapon's reload time (catalog reload_s; 1.5 s when unknown). */
  _reloadPulled() {
    if (this.phase !== 'live' || !this.alive || this.tutorial || this.resync || this.reconciling) return;   // resync/reconcile: the gun is disarmed and unverified, no takeover
    const cap = this._ammoBySlot()[this.activeSlot] ?? this.mag;                 // the spawn $AMMO cap, not the biggest count seen so far
    if (cap && this.ammo >= cap && (this.reserve || 0) > 0) return;             // nothing to reload — the gun ignores the pull
    if (!(this.reserve > 0)) return;                                           // dry reserve: no reload happens (whatever is in the mag)
    const ws = this.player && this.player.loadout && this.player.loadout.weapons; const w = ws && (ws[this.activeSlot] || ws[0]);
    const row = w && this.weaponRow(w.weapon_id); let secs = row && row.reload_s != null ? +row.reload_s : 1.5;
    // The perk's reload multiplier is applied to the gun's $WEAP reload token by MC (compile.py apply_perks), so the
    // takeover must shrink with it too — quick_hands halves the reload (Tony, 2026-09-04).
    const pk = this.player && this.player.loadout && this.player.loadout.perk ? this.perkRow(this.player.loadout.perk) : null;
    const rm = pk && pk.effects && pk.effects.reload_mult ? +pk.effects.reload_mult : 1;
    if (rm > 0 && rm !== 1 && this.activeSlot === 0) secs *= rm;   // compile applies reload_mult to slot 0 only (slot 1 gets swap_mods)
    this.reloading = { at: this.now(), ms: Math.max(300, Math.round(secs * 1000)), slot: this.activeSlot };
    this._changed();
  }
  /** Milliseconds into the current reload, or null when none is running (PURE, read by state()). */
  reloadingMs() {
    if (!this.reloading) return null;
    const ms = this.now() - this.reloading.at;
    return ms > this.reloading.ms + RELOAD_GRACE_MS ? null : ms;
  }

  _slotCount() {
    const ws = this.player && this.player.loadout && this.player.loadout.weapons;
    return ws ? ws.length : 0;
  }

  /** How long the ALT indicator has been up, or null once it has expired.
   *  PURE — it is read from state() on every render and must never mutate engine state. */
  switchingMs() {
    if (!this.switching) return null;
    const ms = this.now() - this.switching.at;
    return ms > this.switchWindowMs() ? null : ms;
  }
  /** The swap window: MC's `frames.swap_ms` (the tok15 the gun was actually given, perks applied — bench 2026-09-04);
   *  an older MC without it falls back to the stock 850 scaled by an equipped `switch_mult` perk. */
  switchWindowMs() {
    if (this.frames && Number(this.frames.swap_ms) > 0) return Number(this.frames.swap_ms);
    const pk = this.player && this.player.loadout && this.player.loadout.perk ? this.perkRow(this.player.loadout.perk) : null;
    const sm = pk && pk.effects && pk.effects.switch_mult ? +pk.effects.switch_mult : 1;
    return Math.round(SWITCH_MAX_MS * (sm > 0 ? sm : 1));
  }

  /** $ALCD,<mag>,100,<slot>,<reserve>,0 — counts are per weapon SLOT; a weapon swap is never a shot. */
  _onAmmo(mag, reserve, slot = 0) {
    slot = Number.isFinite(slot) ? slot : 0;
    const prev = this._prevAmmo[slot];
    if (prev != null && mag < prev && this.phase === 'live') this.shots += (prev - mag);
    if (this.resync && prev != null && mag < prev) this._resyncEvidence('alcd-dec');
    if (this.resync && prev != null && mag > prev) this._resyncEvidence('alcd-inc');
    if (this.reloading && prev != null && mag > prev && slot === this.reloading.slot) { this.reloading = null; }   // the mag is back: the gun fires again
    if (this.switching && slot !== this.switching.from && slot < 2) {
      // slot 4 is MELEE and arrives on its own $ALCD — it is not the weapon swap we were waiting for.
      // NB this interval is ALT-press -> next SHOT, so it includes the player's reaction time. It is a
      // lower bound on "the swap had finished by", NOT a measurement of the swap itself (FOLLOWUPS F4).
      this.lastSwitchMs = this.now() - this.switching.at;
      this.log(`slot ${this.switching.from}->${slot} confirmed ${this.lastSwitchMs}ms after ALT (incl. reaction)`, 'li');
      this.switching = null;
      this.moment = { kind: 'switched', at: this.now(), data: { slot } };   // the HUD flips SWITCHING → ACTIVE
    }
    this._prevAmmo[slot] = mag; this.activeSlot = slot;
    this.magBySlot[slot] = Math.max(this.magBySlot[slot] || 0, mag);
    this.ammo = mag; this.mag = this.magBySlot[slot];
    if (reserve != null && !Number.isNaN(reserve)) this.reserve = reserve;
  }

  _onHp(hp, armor, shield) {
    // Damage drains shield -> armor -> HP (bench 2026-08-27). Omitting shield from the
    // total made every shield-absorbed hit compute dmg === 0, which the guard below then
    // dropped entirely -- no hit_taken fact, no HUD feedback, no score. See FOLLOWUPS Q12.
    if (shield === undefined) shield = this.shield;
    const before = this.hp + this.armor + this.shield;
    if (this._prevHp === undefined) { this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield; }
    this.hp = hp; this.armor = armor; this.shield = shield;
    const dmg = Math.max(0, before - (hp + armor + shield));
    // Victim-side low-health alert. Callsign sends $PLAY,VA8B + $HLED,7,4,90,90,10,15 once per life
    // shortly after ARMOUR reaches 0 and HP starts dropping (capture 2026-08-23-two-tagger-combat:
    // 2 deaths, 2 alerts, both at $HP,34,0,0). We sent neither, which is why our headsets stayed dark.
    let hurtNow = false;
    if (this.phase === 'live' && this.spawned && this.alive && !this.tutorial
        // maxArmor 0 means the player never HAD armour, so "armour is gone" is not a state change —
        // without this the alert fires on the first scratch of such a loadout (review 2026-09-01).
        && !this.hurtFired && this.maxArmor > 0 && this.armor === 0 && this.hp > 0 && this.hp < this.maxHp) {
      this.hurtFired = true; hurtNow = true;
      const c = this.frames && this.frames.cues;
      const fr = c ? [c.hurt, c.hurt_led].filter(Boolean) : [];
      // logged explicitly: after the last field session we could not tell whether the alert had
      // fired at all, because the frame ring only holds 60 frames and had rolled past it.
      this.log(`low-health alert: armour 0, hp ${this.hp} — ${fr.length} frame(s)`, 'lk');
      if (fr.length) { this._hsGen = (this._hsGen || 0) + 1; this._write(fr, 'low health'); }   // cancels a pending hit-flash rest step (polish 2026-09-04)
    }
    if (this.phase === 'live' && this.spawned && this.alive && this.hp > 0 && dmg > 0 && !this.tutorial) {
      // A registered hit WIPES the headset: the native flash runs, then it goes dark and our team
      // colour never comes back (bench 2026-09-03, hled_spawned.py). Re-send it so other players
      // keep seeing the team for the rest of the life. Skipped on the hit that fired the low-health
      // alert -- that alert IS the headset for the next ~3 s and a repaint would cut it short. A
      // static frame, one write per hit, never hammered. Empty cue = LEDs off or unknown colour.
      const hs = this.frames && this.frames.headset;
      if (hs && !hurtNow) {
        if (this.carrying != null && hs.carrier && hs.carrier[String(this.carrying)]) this._headset(hs.carrier[String(this.carrying)], 'carrier after hit');   // the flag blink survives a hit
        else if (hs.hit && hs.hit.length) this._headset(hs.hit, 'hit');                                     // A11.6: flash, then back to rest
        else if (hs.rest && hs.in_play === 'team') this._write([hs.rest], 'team led');                     // no flash configured: just restore
      } else {
        const tl = this.frames && this.frames.cues && this.frames.cues.team_led;   // pre-A11.6 bundle
        if (tl && !hurtNow) this._write([tl], 'team led');
      }
    }
    if (this.phase === 'live' && this.spawned && this.latch && this.now() - this.latch.at <= 1000 && dmg > 0 && !this.tutorial) {
      // `sensor` is $HIR tok1: 0-3 are ALL HEADSET sensors (it has four; 0 = front and 1 = back are
      // bench-mapped, 2 and 3 are not), 4 = gun body. It was parsed
      // and dropped, so MC could not see WHICH sensor caught a hit — answering that took the phone's
      // raw frame ring (field 2026-09-01). One field, and the question becomes readable live.
      this.emitFact({ type: 'hit_taken', match_id: this.matchId, shooter_num: this.latch.shooter_num,
        shooter_team: this.latch.shooter_team, dmg, ir_proto: this.latch.ir_proto, sensor: this.latch.sensor });
      this.lastHitAt = this.now();
      if (this.alive && hp > 0) { this._event('hit_taken'); this._pain(dmg, this.latch.ir_proto); }   // A11: a death is its own event; A15.3: our pain grunt by damage
    }
    // HUD moments. The gun's own LED strip cannot hold a steady colour in game (the firmware
    // animates it, and winning that fight needs ~30Hz repaints which STROBE), so the phone carries
    // the detailed feedback — it is the one surface we fully control. See experiment-log 2026-09-02.
    if (this.phase === 'live' && this.spawned && this.alive && !this.tutorial) {
      // A hit must not overwrite a rarer, more important moment that is still on screen. There is
      // ONE moment slot and `hit` is by far the most frequent producer, so without this a kill
      // confirm landing in the same tick as a hit is silently lost -- verified, it rendered only the
      // hit. Kill/redeploy/down own the screen for their own duration.
      // ONE RENDER TICK, not the overlay's display duration. The race is only that a rarer moment
      // set in the same tick is overwritten before the HUD has rendered it -- once rendered, the
      // kill/redeploy overlay is its own DOM node and a later hit does not disturb it.
      // Guarding for the full display duration was worse than the bug: a player shot while a kill
      // banner was up would never be told they were hit, and being hit is the one thing they cannot
      // afford to miss.
      const RARE_GUARD_MS = 250;
      const m = this.moment;
      const busy = m && ['kill', 'redeploy', 'down', 'match_over'].includes(m.kind)
        && (this.now() - m.at) < RARE_GUARD_MS;
      if (busy) { /* let the rarer moment survive long enough to be rendered */ }
      else if (dmg > 0 && hp > 0) {
        // A death sets its own 'down' moment; a hit that kills must not flash "hit" first.
        this.moment = { kind: 'hit', at: this.now(),
          data: { dmg, shooter_team: this.latch ? this.latch.shooter_team : 0,
                  // the KEY, not the tid: the engine already owns tid->key (TEAM_KEY), and a second
                  // copy of that mapping in the HUD is a divergence waiting to happen
                  shooter_key: TEAM_KEY[this.latch ? this.latch.shooter_team : 0] || 'red',
                  sensor: this.latch ? this.latch.sensor : null, hp, armor, shield } };
      } else if (before > 0) {
        // Pools went UP: a heal, an armour pickup, or a shield grant. `before > 0` keeps the
        // spawn/respawn refill out of it — that has its own 'redeploy' moment.
        const gains = [['health', hp - this._prevHp], ['armor', armor - this._prevArmor],
                       ['shield', shield - this._prevShield]].filter(g => g[1] > 0);
        if (gains.length) {
          gains.sort((a, b) => b[1] - a[1]);
          this.moment = { kind: 'gain', at: this.now(),
            data: { pool: gains[0][0], amount: gains[0][1], hp, armor, shield } };
          this._event(gains[0][0] === 'health' ? 'healed' : gains[0][0] === 'armor' ? 'armour_up' : 'shield_up');   // A11
        }
      }
    }
    this._prevHp = hp; this._prevArmor = armor; this._prevShield = shield;
    if (hp > 0) this._gunHealthPaint('hp');   // A11.7 (a hit does not clear a held paint, bench 2026-09-04; only the band change is written)
    const wasResync = !!this.resync || !!this.reconciling;
    if (this.resync) this._resyncEvidence('hp');
    if (hp === 0 && this.alive && this.phase === 'live') this._death(wasResync);   // a death learned during resync/reconcile is a desync death
  }

  _death(desync) {
    this.reloading = null; this.switching = null;   // the gun stops the reload/swap when you drop; so does the HUD
    const fresh = this.latch && this.now() - this.latch.at <= C.DEATH_LATCH_MS;
    const shooter_num = fresh ? this.latch.shooter_num : 0;
    const shooter_team = fresh ? this.latch.shooter_team : (this.latch ? this.latch.shooter_team : 0);
    this.alive = false; this.deaths++; this.deadAt = this.now(); this._downRearmSent = false;   // §3.2: fresh rearm gate for this life
    this.killedBy = { num: shooter_num, team: shooter_team, name: this.nameOf(shooter_num), teamName: TEAM_NAME[shooter_team] || `TEAM ${shooter_team}`, teamKey: TEAM_KEY[shooter_team] || 'red' };
    this.emitFact({ type: 'death', match_id: this.matchId, shooter_num, shooter_team, ...(desync ? { desync: true } : {}) });
    if (this.config && this.config.mode === 'infection' && this.frames && this.frames.team_flip) {
      const tids = Object.keys(this.frames.team_flip).filter(k => Number(k) !== this.teamTid);
      // Whether a mid-match $TID write changes the gun's own friendly-fire resolution is UNTESTED (modes §9); MC scores via team_change regardless.
      if (tids.length) {
        const tid = Number(tids[0]); this._write(this.frames.team_flip[tids[0]], 'team_flip'); this.emitFact({ type: 'team_change', match_id: this.matchId, tid });
        this._turned = true;
        this._event('infected');   // A11.4: HUD-driven -- this gun just turned; MC's broadcast only tells the OTHERS
        const tm = ((this.config && this.config.teams) || []).find(x => Number(x.tid) === tid);
        this.team = tm ? { ...tm } : { ...(this.team || {}), tid, team_id: `tid-${tid}`, name: TEAM_NAME[tid] || `TEAM ${tid}` };
      }
    }
    this.switching = null;          // a swap indicator must not outlive the player
    this.moment = { kind: 'down', at: this.now() };
    this._event('died');   // A11
    if (this._headsetDeath().length) { this._headset(this._headsetDeath(), 'death'); this._deathBlinkAt = this.now(); }   // A11.6 out-blink (empty = the 'native' opt-out; nothing to paint)
    this.carrying = null;
    this.log(`☠ down — by ${this.killedBy.name || this.killedBy.teamName}`, 'le');
    this._changed();
  }

  // ---------- §3.10 resync: trigger first, then reload, then trigger ----------
  // ---------- S7.1 reconnect reconcile: disarm, keep the real pools, re-arm — never infer death ----------
  /** A rejoin into a LIVE match. The gun keeps its config + pools across a BLE drop, and `_load` restored
   *  the real alive/hp — so we DON'T guess. Hold a disarmed window (anti-cheat: a restart is slow and
   *  gains nothing), then re-arm to the restored pools with NO $SPAWN/$PSET (so HP is never reset to full).
   *  This replaces the old trigger-first resync, which mis-concluded "dead" on reconnect and let the
   *  auto-respawn HEAL the player — a free respawn on restart (bench 2026-09-04, Tony). */
  _beginReconcile() {
    if (this.reconciling) return;
    this.reconciling = { since: this.now() };
    this.resync = null;                                   // never run the infer-death machine on a rejoin
    this._write(['$AMMO,0,0,0,1,*', '$AMMO,1,0,0,1,*'], 'reconcile: disarm');   // no shots count while we reconcile
    this.log('reconnect — reconciling (gun held ' + RECONCILE_MS + ' ms)', 'li');
    this._changed();
  }
  /** End the reconcile: re-arm to the RESTORED pools. Alive → restore the loadout mags so the gun fires
   *  again at its real HP. Down → leave it disarmed (it is out, awaiting a real respawn). Never writes
   *  $SPAWN or $PSET, so a rejoin can never heal. */
  _endReconcile() {
    this.reconciling = null;
    if (this.alive) {
      const ammo = ((this.frames && this.frames.spawn) || []).filter(f => f.startsWith('$AMMO,'));
      if (ammo.length) this._write(ammo, 'reconcile: re-arm');
    }
    this.log(`reconcile done — ${this.alive ? 'live' : 'down'} at hp ${this.hp}`, 'lk');
    this._changed();
  }

  _beginResync(why) {
    if (!(this.phase === 'lobby' || this.phase === 'armed' || this.phase === 'live')) return;
    if (this.phase === 'lobby') { this.log(`resync (${why}): LOBBY → re-write head`, 'li'); this._applyConfig({ config: this.config, frames: this.frames, roster: this.roster }, 'hydrate'); return; }
    if (this.phase === 'armed') { this.log(`resync (${why}): ARMED → re-write head, T-0 spawns as scheduled`, 'li'); if (this.frames) this._writeHead('resync head (armed)'); return; }
    this.resync = { step: 1, since: this.now(), prompt: 'pull the trigger', reserve: this.reserve, probes: 0 };
    this.log(`resync (${why}): evidence protocol started`, 'li');
    this._changed();
  }
  _resyncEvidence(kind) {
    const r = this.resync; if (!r) return;
    if (kind === 'hp' || kind === 'lcd') {
      // Polish 2026-09-04: `alive` is not persisted and a reload mid-match restores it false. A state line
      // with hp > 0 IS the evidence the gun is up; without this, tick() stamped deadAt on a healthy gun and
      // auto-revive wrote $SPAWN + $AMMO (full heal, refill, a bogus respawn fact) 10 s later.
      if (this.hp > 0 && !this.alive) this.alive = true;
      this._resyncDone('state line'); return;
    }
    if (kind === 'alcd-dec') { this._resyncDone('alive (shot went out)'); if (!this.alive) { this.alive = true; } return; }
    if (kind === 'alcd-inc' && r.step === 2) { r.step = 3; r.since = this.now(); r.prompt = 'pull the trigger'; this._changed(); }
  }
  _resyncButton(id, state) {
    const r = this.resync; if (!r || state !== 1) return;
    if (id === 0 && r.step === 1) { r.step = 2; r.since = this.now(); r.prompt = 'now the reload handle'; r.trigNoAlcd = true; this._changed(); return; }
    if (id === 2 && r.step === 2) { r.reloadAt = this.now(); return; }
    if (id === 0 && r.step === 3) { r.trig3At = this.now(); return; }
  }
  _resyncTick() {
    const r = this.resync, now = this.now();
    // step 2: a reload pull happened but no $ALCD followed within 1.5 s
    if (r.step === 2 && r.reloadAt && now - r.reloadAt > 1500) {
      const reserveKnown = r.reserve != null ? r.reserve : (this.reserve != null ? this.reserve : 1);
      if (reserveKnown > 0 || r.probes >= 1) return this._resyncNotLive('reload silent');
      // reserve == 0: ambiguous (out of ammo vs unconfigured) — wait one more probe window, then escalate (non-LMS)
      r.probes++; r.reloadAt = null; r.since = now; r.escalateAt = now + C.RESYNC_PROBE_S * 1000; r.prompt = 'out of reserve? wait…'; this._changed(); return;
    }
    if (r.step === 2 && r.escalateAt && now >= r.escalateAt) {
      if (this.respawnType === 'none') { r.escalateAt = null; r.prompt = 'out of reserve — stay put'; this._changed(); return; }   // LMS: stay last-known
      return this._resyncNotLive('reserve 0 timeout');
    }
    // step 3: trigger pulled after a good reload, no $ALCD within 1.5 s → dead
    if (r.step === 3 && r.trig3At && now - r.trig3At > 1500) {
      this.resync = null;
      if (this.alive) { this.log('resync: dead (trigger after reload, no fire)', 'le'); this._death(true); }
      this._changed(); return;
    }
    if (now - r.since > C.RESYNC_PROBE_S * 1000) { r.since = now; /* keep prompting; never write */ this._changed(); }
  }
  _resyncNotLive(why) {
    const lms = this.respawnType === 'none';
    this.log(`resync: not a live configured gun (${why})${lms ? ' — LMS: marked dead, nothing written' : ''}`, 'le');
    this.resync = null;
    if (lms) { if (this.alive) this._death(true); this._changed(); return; }
    if (this.phase === 'live') {
      if (this.alive) this._death(true);
      if (this.frames) this._writeHead('resync head');
      // normal respawn timer then revive (flagged resync)
      this._resyncRevive = true;
      this._changed(); return;
    }
    if (this.phase === 'armed' && this.frames) this._writeHead('resync head (armed)');
    this._changed();
  }
  /** Every head write goes through here: the head starts with $CLEAR, so its $LCD,0,0,… echo must read as a
   *  reset (prev=0 per slot), never as a magazine dump into `shots`. */
  /** Every head write starts with $CLEAR → the gun is back on weapon slot 0 (so $LCD, which carries no slot, books to slot 0). */
  _writeHead(label) { this._prevAmmo = {}; this.activeSlot = 0; this._write(this.frames.head, label); }
  _resyncDone(why) { this.log(`resync: ${why}`, 'lk'); this.resync = null; this._changed(); }

  // ---------- app lifecycle (§3.11) ----------
  resume() {
    this.log('app resumed — reconciling', 'li');
    if (this.phase === 'live') {
      if (this.endT && this.now() >= this.endT) { this._endLocal('expired-while-suspended'); return; }
      if (this.bleUp) this._beginResync('resume');   // §3.10/§3.11: observe BEFORE any schedule-driven write
    }
    if (this.start) this.resumeSchedule();
    this._changed();
  }

  // ---------- status body (contracts §4) ----------
  statusBody(preflight = {}) {
    const now = this.now();
    return {
      hp: this.hp, armor: this.armor, shield: this.shield, ammo: this.ammo, alive: this.alive, shots: this.shots,
      ...(this.phase === 'live' && !this.alive && this.deadAt ? { deadline_s: Math.max(0, Math.ceil((this.respawnDelayMs - (now - this.deadAt)) / 1000)) } : {}),
      ...(this.battery != null ? { battery: this.battery } : {}), ...(this.fw ? { fw: this.fw } : {}),
      arm_state: this.phase, ...(this.phase === 'armed' && this.goLiveT ? { t_minus_ms: Math.max(0, this.goLiveT - now) } : {}),
      synced: this.isSynced(), wsReason: this.wsReason || null, ...(this.matchId ? { match_id: this.matchId } : {}),
      preflight: { gun_linked: this.bleUp, headset_ok: !!this.headEcho, ...preflight },
    };
  }

  // ---------- render snapshot ----------
  state() {
    const now = this.now();
    const r = this.respawnDelayMs;
    return {
      phase: this.phase, bleUp: this.bleUp, wsState: this.wsState, gun: this.gun, night: this.night,
      player: this.player, team: this.team, teamKey: this.teamKey, teamName: this.team ? (this.team.name || TEAM_NAME[this.team.tid] || '').toUpperCase() : '',
      callsign: this.player ? this.player.display : '', playerNum: this.player ? this.player.player_num : null,
      mode: this.config ? String(this.config.mode || '').toUpperCase() : '', weapon: this.weaponName,
      hp: this.hp, armor: this.armor, shield: this.shield, maxHp: this.maxHp, maxArmor: this.maxArmor, ammo: this.ammo, reserve: this.reserve, mag: (this._ammoBySlot()[this.activeSlot] ?? this.mag),
      loadMag: this._loadAmmo()[0], loadReserve: this._loadAmmo()[1],
      alive: this.alive, deaths: this.deaths, shots: this.shots, battery: this.battery,
      kills: this.score ? this.score.kills : null, assists: this.score ? this.score.assists : null, accuracy: this.score ? this.score.accuracy : null, scoreAt: this.scoreAt,
      respawnType: this.respawnType, killedBy: this.killedBy, underFire: this.alive && this.lastHitAt > 0 && (now - this.lastHitAt) < 2000, respawnIn: (!this.alive && this.deadAt && this.respawnType === 'auto') ? Math.max(0, Math.ceil((r - (now - this.deadAt)) / 1000)) : 0,   // scanner/none modes have no countdown
      // utility.md: the respawn station this player would use, how close it reads, and what the DOWN screen should say
      station: stationView(this._respawnStation()), respawnGate: this.respawnGate, respawnHint: this.respawnHint(now),
      tMinusMs: this.phase === 'armed' && this.goLiveT ? Math.max(0, this.goLiveT - now) : null,
      clockMs: this.endT ? Math.max(0, this.endT - now) : (this.timeLimitMs || 0),
      ready: !!this.ready, tutorial: this.tutorial, tutorialWeapon: this.tutorialWeapon,
      // follows the LIVE slot, not always the primary (field 2026-08-30)
      weaponId: (() => { const ws = this.player && this.player.loadout && this.player.loadout.weapons; const w = ws && (ws[this.activeSlot] || ws[0]); return w ? w.weapon_id : null; })(),
      resync: this.resync ? { step: this.resync.step, prompt: this.resync.prompt } : null,
      reconciling: !!this.reconciling,
      // read ONCE: two calls could straddle the expiry and disagree (switching:true, switchingMs:null)
      ...(ms => ({ switching: ms != null, switchingMs: ms }))(this.switchingMs()),
      switchWindowMs: this.switchWindowMs(), lastSwitchMs: this.lastSwitchMs, activeSlot: this.activeSlot,
      switchFrom: this.switching ? this.switching.from : null, switchTo: this.switching ? (this.switching.from === 0 ? 1 : 0) : null,
      ...(ms => ({ reloading: ms != null, reloadMs: ms, reloadTotalMs: this.reloading ? this.reloading.ms : null }))(this.reloadingMs()),
      hits: this.score ? this.score.hits : null, board: this.score ? this.score.board : null,
      fragLimit: this.config && this.config.scoring ? this.config.scoring.frag_limit : null,
      lives: (this.config && this.config.respawn && this.config.respawn.lives != null) ? Math.max(0, this.config.respawn.lives - this.deaths) : null,
      moment: this.moment, ended: this.ended, endAck: this.endAck, matchId: this.matchId, synced: this.isSynced(), headEcho: this.headEcho,
      rejoin: !!(this.start && !this.bleUp && this.phase === 'idle'), pendingTeardown: this.pendingTeardown,
      // A10 self-serve kitting
      catalog: this.catalog, policy: this.policy, loadout: this.loadoutView(), browsing: this.browsing, loadoutAck: this.loadoutAck, pendingPick: this.pendingPick,
      canPickPrimary: this.canPick('primary'), canPickSecondary: this.canPick('secondary'), canPickPerk: this.canPick('perk'), tryoutSeen: this.tryoutSeen,
      game: this.game, kitOpen: this.kitOpen(), briefSeen: this.briefSeen,
    };
  }
}
