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
const SWITCH_MAX_MS = 1200;
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
                storage = null, log = () => {}, onChange = () => {}, delay = (ms, fn) => setTimeout(fn, ms) } = {}) {
    this.writer = writer; this.emitFact = emit; this.report = report; this.now = now; this.isSynced = synced;
    this.storage = storage; this.log = log; this.onChange = onChange; this.delay = delay;
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
    this.latch = null;              // {shooter_num, shooter_team, at, ir_proto}
    this.deadAt = 0; this.killedBy = null; this.lastHitAt = 0;
    this.score = null;              // ScoreRow from MC (kills/assists/accuracy) — null until synced
    this.scoreAt = 0;
    this.headEcho = null; this.headWrittenAt = 0; this.awaitingEcho = false;
    this.spawned = false; this.ended = false;
    this.cuesFired = new Set();
    this.tutorial = false; this.tutorialWeapon = null;
    // A10 — self-serve kitting (docs/spec/loadout.md §4)
    this.catalog = null;            // {weapons: WeaponView[], perks: PerkView[]} — arrives in `assign`
    this.policy = null;             // {hud_select, primary:{choice, allowed_ids}, secondary:{choice, kinds, allowed_weapon_ids, allowed_perk_ids}}
    this.browsing = false;          // the HUD's LOADOUT browser is open (reported to MC as loadout_browse)
    this.game = null;               // A10 §4.6: assign.game — what the BRIEFING screen shows
    this.briefSeen = false;         // the player tapped BUILD MY KIT ▸ on the briefing (reset when kit_open flips true)
    this.loadoutAck = null;         // MC's verdict on the last pick: {slot, ok, reason, t} — tick() clears it after ~4 s
    this.pendingPick = null;        // optimistic highlight until the ack lands: {slot, kind, id, at}
    this.tryoutSeen = null;         // weapon_id of a try-out panel the player dismissed with DONE (panel hides, gun stays armed)
    this.resync = null;             // §3.10 state machine: {step, since, lastAmmo, lastReserve}
    this.rewriteHeadAtT10 = false;  // start-sequence §3 fallback (bench-gated)
    this._headRewritten = false;
    this.moment = null;             // transient HUD moment: {kind, at, data}
    this.probeSent = false;
    this.night = false;
    this.lastVoltsAt = 0;
    this.switching = null;          // {at, from} while an ALT weapon swap is in flight (field 2026-08-30)
    this.lastSwitchMs = null;       // measured duration of the last completed swap
    this._prevAmmo = {};            // per weapon slot ($ALCD token 3): last mag seen
    this.activeSlot = 0;
    this.magBySlot = {};
    this.endedMatches = [];         // match_ids already ended locally — a re-hydrated `start` for them is a no-op
    this.endAck = false;            // result screen shown until the player taps OK (then the 'over' screen)
    this.onEnd = null;              // app hook: called once per ended match with a stats summary (history)
    this.configPending = false;     // config arrived while the gun was unlinked → write head on relink
    this.pendingTeardown = null;    // 'end' | 'panic' owed to the gun once it relinks
  }

  // ---------- persistence (§3.7) ----------
  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify({
        phase: this.phase, gun: this.gun, player: this.player, team: this.team, roster: this.roster,
        config: this.config, frames: this.frames, start: this.start, matchId: this.matchId,
        deaths: this.deaths, shots: this.shots, spawned: this.spawned, ended: this.ended, savedAt: this.now(),
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
    } else if (this.phase === 'lobby' || this.phase === 'armed' || this.phase === 'live') this._beginResync('ble-reconnect');
    if (first) this.log(`gun ${this.gun ? this.gun.name : '?'} linked`, 'lk');
    // A restored/held schedule is reconciled against the clock now (E5: grace / hot-join / already over).
    // MC-first late joiner: the running `start` arrived while idle and the relink landed in LOBBY — reconcile from there too.
    if (this.start && (this.phase === 'lobby' || this.phase === 'armed')) this.resumeSchedule();
    this._changed();
  }
  onBleDropped() { this.bleUp = false; this.log('gun link lost', 'le'); this._changed(); }
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
      case 'control': return this.control(body);
      case 'apply': {
        const fr = body.frames || [];
        if (this.phase === 'live') return this._write(fr, 'apply');
        // A9.1 preview: sound-only applies may play OFF-live (voice/gamertag preview at the bench) —
        // restricted to $PLAY/$SFLASH so A6.4's no-state-writes-off-live safety holds.
        if (body.preview && ['connected', 'kitted', 'lobby'].includes(this.phase) && fr.length && fr.every(f => f.startsWith('$PLAY') || f.startsWith('$SFLASH'))) return this._write(fr, 'apply preview');
        return undefined;
      }
      case 'score': if (body && typeof body === 'object') { this.score = body; this.scoreAt = this.now(); this._changed(); } return;
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
    if (this.browsing && !this.canPick('primary') && !this.canPick('secondary')) this.browse(false);   // A10: rules locked both slots while the browser was open
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
    return slot === 'primary' ? p.primary : p.secondary;
  }
  canPick(slot) {
    const p = this.policy, r = this.slotRule(slot);
    return !!(p && p.hud_select && r && r.choice === 'player' && this.phase === 'kitted' && !this.ended && this.kitOpen());
  }
  /** Tap a row = equip. `tryIt` (weapons only) also asks MC for the try-out. Returns false if the slot isn't ours. */
  requestLoadout(slot, kind, id = null, tryIt = false) {
    if (!this.canPick(slot)) { this.log(`pick refused locally: ${slot} is not player-choice`, 'le'); return false; }
    if (slot === 'primary' && kind !== 'weapon') return false;
    if (kind === 'none' && slot !== 'secondary') return false;
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
  _loadoutAck({ slot, ok, reason, loadout }) {
    if (loadout && this.player) this.player.loadout = loadout;   // MC's echo is the truth (applies on ok AND on a reject → reverts the optimistic row)
    const pk = this.pendingPick;
    this.loadoutAck = { slot, ok: !!ok, reason: reason || null, t: this.now(), key: pk ? (pk.kind === 'none' ? 'none' : `${pk.kind}:${pk.id}`) : null };
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
    let secondary = null;
    if (ws[1]) secondary = wrow(ws[1].weapon_id);
    else if (lo.perk) secondary = { kind: 'perk', ...(this.perkRow(lo.perk) || { perk_id: lo.perk, name: String(lo.perk).replace(/_/g, ' '), effects: {} }) };
    return { primary, secondary };
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
    this.matchId = body.match_id; this.cuesFired = new Set(); this.shots = 0; this.deaths = 0; this.ended = false; this._resyncRevive = false;
    if (this.phase === 'lobby' || this.phase === 'kitted' || this.phase === 'armed') this._set('armed');
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

  _cue(key) {
    const f = this.frames && this.frames.cues && this.frames.cues[key];
    if (f && !this.cuesFired.has(key)) { this.cuesFired.add(key); this._write([f], `cue ${key}`); }
  }
  _spawn(withCountdown) {
    if (!this.frames) return;
    if (withCountdown && !this.cuesFired.has('countdown')) this._cue('countdown');
    this._write([...this.frames.spawn, SFLASH], 'spawn');
    this._prevAmmo = {}; this.activeSlot = 0; this.magBySlot = {};   // config echoes carry WEAP clip caps, not spawn mags — never let them set the denominator   // assumption (hardware-UNVERIFIED): a fresh spawn puts the gun on slot 0
    this._cue('klaxon');
    // Spawn shield is ALWAYS 0 on hardware -- $PSET t5 is a capacity filled by an fn-11
    // grant, never a starting pool (bench 2026-08-27).
    this.spawned = true; this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.killedBy = null; this.deadAt = 0;
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
      if (!this.alive && this.deadAt && this.respawnType === 'auto' && now - this.deadAt >= this.respawnDelayMs && this.bleUp && !this.resync) {
        const rs = !!this._resyncRevive; this._resyncRevive = false; this._revive(rs);   // §3.10: a resync re-arm is flagged respawn{resync:true}
      }
      if (this.moment && now - this.moment.at > 4000) { this.moment = null; }
      this._changed();
    }
    if (this.resync) this._resyncTick();
  }

  _revive(resync) {
    if (!this.frames) return;
    this._write(this.frames.revive, 'revive');
    this._prevAmmo = {}; this.activeSlot = 0;   // assumption (hardware-UNVERIFIED): a revive puts the gun back on slot 0
    this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.deadAt = 0; this.killedBy = null;
    this.emitFact({ type: 'respawn', match_id: this.matchId, ...(resync ? { resync: true } : {}) });
    this.moment = { kind: 'redeploy', at: this.now() };
    this.log(resync ? 'resync respawn' : 'respawned', 'lk');
    this._changed();
  }

  _endLocal(why) {
    if (this.ended) return;
    this.ended = true; this._panicked = null; this.endAck = false;
    try { if (this.onEnd) this.onEnd({ t: this.now(), match_id: this.matchId, kills: this.score ? this.score.kills : null,
      deaths: this.deaths, assists: this.score ? this.score.assists : null,
      accuracy: this.score ? this.score.accuracy : null, shots: this.shots, mode: this.config ? this.config.mode : null }); } catch (_) { /* history is best-effort */ }
    if (this.matchId && !this.endedMatches.includes(this.matchId)) this.endedMatches.push(this.matchId);
    if (this.bleUp) this._writeTeardown('end', why); else { this.pendingTeardown = 'end'; this.log(`end (${why}) owed to the gun — link down`, 'le'); }
    this.spawned = false; this.alive = false; this.resync = null; this.start = null; this._resyncRevive = false;
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
    if (this.frames) { this._write(this.frames.end, `end (${why})`); const f = this.frames.cues && this.frames.cues.game_over; if (f) this._write([f], 'cue game_over'); }
  }

  // ---------- control ----------
  control({ cmd, seq }) {
    switch (cmd) {
      case 'end': case 'recall':
        if (this.phase === 'live' || this.phase === 'armed' || this.phase === 'lobby') this._endLocal(cmd);
        return;
      case 'abort_start':
        if (this.phase === 'armed' && (seq == null || (this.start && this.start.seq === seq))) { this.start = null; this.cuesFired = new Set(); this._write([PLAYX], 'abort'); this._set('lobby'); }
        else if (this.phase === 'live' && this.start && this.start.seq === seq) this._endLocal('abort_start(live)=recall');
        return;
      case 'panic':
        if (this.bleUp) this._writeTeardown('panic', 'control'); else { this.pendingTeardown = 'panic'; this.log('panic owed to the gun — link down', 'le'); }
        this._resyncRevive = false;   // a panic does NOT retire the match_id — a NEWER start (higher seq) is still accepted later
        // …but a WS welcome re-delivering the SAME schedule must not re-arm a gun the operator just cleared.
        this._panicked = this.start ? { match_id: this.start.match_id, seq: this.start.seq } : null;
        this.spawned = false; this.alive = false; this.start = null; this.resync = null;
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
    const cue = body.cue || (this.frames && this.frames.cues && this.frames.cues[body.kind]);
    this._write([SFLASH], `feedback ${body.kind}`);
    if (cue) this.delay(120, () => this._write([cue], `feedback cue ${body.kind}`));   // hardware-proven gap (seed): flash, then the line
    if (body.kind === 'kill') {
      if (this.score) this.score = { ...this.score, kills: (this.score.kills || 0) + 1 };
      else this.score = { kills: 1 };
      this.scoreAt = this.now();
      this.moment = { kind: 'kill', at: this.now(), data: { victim_team: body.victim_team, victim: body.victim } };
    }
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
        if (!Number.isNaN(team)) { this.latch = { shooter_num: Number.isNaN(num) ? 0 : num, shooter_team: team, at: this.now(), ir_proto: parseInt(t[1], 10) }; this.lastHitAt = this.now(); }
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
        break;
      }
      default: break;
    }
    this._changed();
  }

  /** ALT pressed: a weapon swap has begun. Shooting is disabled until the gun finishes it. */
  _altPressed() {
    if (this.phase !== 'live' || !this.alive || this.tutorial) return;
    if (this._slotCount() < 2) return;            // empty slot 1: ALT falls back to reload (loadout.md §2)
    this.switching = { at: this.now(), from: this.activeSlot };
    this._changed();
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
    return ms > SWITCH_MAX_MS ? null : ms;
  }

  /** $ALCD,<mag>,100,<slot>,<reserve>,0 — counts are per weapon SLOT; a weapon swap is never a shot. */
  _onAmmo(mag, reserve, slot = 0) {
    slot = Number.isFinite(slot) ? slot : 0;
    const prev = this._prevAmmo[slot];
    if (prev != null && mag < prev && this.phase === 'live') this.shots += (prev - mag);
    if (this.resync && prev != null && mag < prev) this._resyncEvidence('alcd-dec');
    if (this.resync && prev != null && mag > prev) this._resyncEvidence('alcd-inc');
    if (this.switching && slot !== this.switching.from && slot < 2) {
      // slot 4 is MELEE and arrives on its own $ALCD — it is not the weapon swap we were waiting for.
      // NB this interval is ALT-press -> next SHOT, so it includes the player's reaction time. It is a
      // lower bound on "the swap had finished by", NOT a measurement of the swap itself (FOLLOWUPS F4).
      this.lastSwitchMs = this.now() - this.switching.at;
      this.log(`slot ${this.switching.from}->${slot} confirmed ${this.lastSwitchMs}ms after ALT (incl. reaction)`, 'li');
      this.switching = null;
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
    this.hp = hp; this.armor = armor; this.shield = shield;
    const dmg = Math.max(0, before - (hp + armor + shield));
    if (this.phase === 'live' && this.spawned && this.latch && this.now() - this.latch.at <= 1000 && dmg > 0 && !this.tutorial) {
      this.emitFact({ type: 'hit_taken', match_id: this.matchId, shooter_num: this.latch.shooter_num, shooter_team: this.latch.shooter_team, dmg, ir_proto: this.latch.ir_proto });
      this.lastHitAt = this.now();
    }
    const wasResync = !!this.resync;
    if (this.resync) this._resyncEvidence('hp');
    if (hp === 0 && this.alive && this.phase === 'live') this._death(wasResync);   // a death learned during resync is a desync death
  }

  _death(desync) {
    const fresh = this.latch && this.now() - this.latch.at <= C.DEATH_LATCH_MS;
    const shooter_num = fresh ? this.latch.shooter_num : 0;
    const shooter_team = fresh ? this.latch.shooter_team : (this.latch ? this.latch.shooter_team : 0);
    this.alive = false; this.deaths++; this.deadAt = this.now();
    this.killedBy = { num: shooter_num, team: shooter_team, name: this.nameOf(shooter_num), teamName: TEAM_NAME[shooter_team] || `TEAM ${shooter_team}`, teamKey: TEAM_KEY[shooter_team] || 'red' };
    this.emitFact({ type: 'death', match_id: this.matchId, shooter_num, shooter_team, ...(desync ? { desync: true } : {}) });
    if (this.config && this.config.mode === 'infection' && this.frames && this.frames.team_flip) {
      const tids = Object.keys(this.frames.team_flip).filter(k => Number(k) !== this.teamTid);
      // Whether a mid-match $TID write changes the gun's own friendly-fire resolution is UNTESTED (modes §9); MC scores via team_change regardless.
      if (tids.length) {
        const tid = Number(tids[0]); this._write(this.frames.team_flip[tids[0]], 'team_flip'); this.emitFact({ type: 'team_change', match_id: this.matchId, tid });
        const tm = ((this.config && this.config.teams) || []).find(x => Number(x.tid) === tid);
        this.team = tm ? { ...tm } : { ...(this.team || {}), tid, team_id: `tid-${tid}`, name: TEAM_NAME[tid] || `TEAM ${tid}` };
      }
    }
    this.switching = null;          // a swap indicator must not outlive the player
    this.moment = { kind: 'down', at: this.now() };
    this.log(`☠ down — by ${this.killedBy.name || this.killedBy.teamName}`, 'le');
    this._changed();
  }

  // ---------- §3.10 resync: trigger first, then reload, then trigger ----------
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
    if (kind === 'hp' || kind === 'lcd') { this._resyncDone('state line'); return; }
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
      respawnType: this.respawnType, killedBy: this.killedBy, underFire: this.alive && this.lastHitAt > 0 && (now - this.lastHitAt) < 2000, respawnIn: (!this.alive && this.deadAt) ? Math.max(0, Math.ceil((r - (now - this.deadAt)) / 1000)) : 0,
      tMinusMs: this.phase === 'armed' && this.goLiveT ? Math.max(0, this.goLiveT - now) : null,
      clockMs: this.endT ? Math.max(0, this.endT - now) : (this.timeLimitMs || 0),
      ready: !!this.ready, tutorial: this.tutorial, tutorialWeapon: this.tutorialWeapon,
      // follows the LIVE slot, not always the primary (field 2026-08-30)
      weaponId: (() => { const ws = this.player && this.player.loadout && this.player.loadout.weapons; const w = ws && (ws[this.activeSlot] || ws[0]); return w ? w.weapon_id : null; })(),
      resync: this.resync ? { step: this.resync.step, prompt: this.resync.prompt } : null,
      // read ONCE: two calls could straddle the expiry and disagree (switching:true, switchingMs:null)
      ...(ms => ({ switching: ms != null, switchingMs: ms }))(this.switchingMs()),
      switchWindowMs: SWITCH_MAX_MS, lastSwitchMs: this.lastSwitchMs, activeSlot: this.activeSlot,
      moment: this.moment, ended: this.ended, endAck: this.endAck, matchId: this.matchId, synced: this.isSynced(), headEcho: this.headEcho,
      rejoin: !!(this.start && !this.bleUp && this.phase === 'idle'), pendingTeardown: this.pendingTeardown,
      // A10 self-serve kitting
      catalog: this.catalog, policy: this.policy, loadout: this.loadoutView(), browsing: this.browsing, loadoutAck: this.loadoutAck, pendingPick: this.pendingPick,
      canPickPrimary: this.canPick('primary'), canPickSecondary: this.canPick('secondary'), tryoutSeen: this.tryoutSeen,
      game: this.game, kitOpen: this.kitOpen(), briefSeen: this.briefSeen,
    };
  }
}
