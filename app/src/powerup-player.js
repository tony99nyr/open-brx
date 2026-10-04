// powerup-player.js -- the PLAYER's side of the powerups (docs/spec/powerups.md, contracts A56). A powerup STATION's own
// decision is the other side, in powerup.js; this file is never loaded by a station phone.
//
// Why a module: the rule "a held heavy keeps its charges and goes back on the trigger" was written three times in
// engine.js (the F416 burst re-send, the reconcile re-arm, the self-hit revive), and the copies drifted (F418, F381,
// F436). It is now ONE pure function, `burstWithHeld`, and every powerup field lives in ONE class, `PlayerPowerups`.
// The engine holds one instance (`engine.pu`), calls its entry points and reads its accessors; nothing outside this
// file reads or writes a `_` field of it.
//
// PUBLIC SURFACE
//   burstWithHeld(frames, held, zero?)  PURE: a burst with the held heavy's `$AMMO` row at its charges
//   puSpawnIndex, puSpawnAt             PURE: the spawn schedule on the match clock
//   PlayerPowerups(host)
//     state       reset() · snapshot() · restore(p) · setPset(frame)
//     clock       tickAnnounce(now) · tick(now)
//     stations    onStations(now) · items() · claimable(id, item, now) · claimView(now) · view(now)
//     grants      grantWeapon(id, item, now) · grantShield(id, item, now) · end(why)
//     the gun     onAmmo(slot, mag, prev) · repairUnpulled(slot, mag, prev) · lostEquip(slot, mag, prev, expectedBefore,
//                 altPending) · repairLostEquip(held, slot, mag) · onSelect() · onAltPressed() · onAssumedSwap(to) ·
//                 onConfirmedSwap(slot) · onHp() · onShieldFrame(shield)
//     life        onDeath(inRevive?) · onReviveStart() · onRevive(burst) · keepHeld(held)
//     reconcile   disarmRows() · reconcileRearm(rows) · reequipInRearm(ammo) · afterRearm() · restoreRows(rows, pu)
//     queries     isHeldSlot(slot) · heavyOnTrigger() · heavyMatches(slot, mag) · overshieldPset() · psetWithShieldMax(max)
//     accessors   held (rw) · overshield (rw) · grant (rw) · back · backPending · protectUntil · psetNow · spawnCard ·
//                 swapCard (the setters exist for tests that stage a state without a grant)
//
// HOST INTERFACE (engine.js `powerupHost`; every member looks the engine up at call time)
//   services    now() · log(line, cls) · save() · changed() · write(frames, why) · quietWrite(frames, why) ·
//               writeMust(frames, why, still, actExempt) · emitFact(fact)
//   presentation show(channel, item) · presentable(channel) · laneAge(at, now) · laneFeed(item) · announce(item) ·
//               announceStatus(kind)
//   lookups     weaponRow(id) · slotCount() · switchWindowMs() · stationAllowed(entry) · liveAmmo() · acctLive(slot) ·
//               prevReserve(slot) · recentPull(slot, now)
//   read-only   phase · alive · bleUp · ended · stunned · reconciling · resync · tutorial · gunLocked · frames · config ·
//               player · matchId · stations · goLiveT · lifeSeq · pulledLife · armPending · actSeq · activeSlot ·
//               switching · weaponName · hp · armor · shield · maxShield · latch · lastHitAt
//   writes      acctWrote(slot, mag, res, weap) · setPrev(slot, mag, res) · setMag(slot, mag) · equipped(slot, mag, res) · setSwitching(card) ·
//               recoilArm(why) · setShield(v) · setWriteLost(life)
//   Each write is one named door into the engine: `equipped` is the engine's side of a phone equip (the swap and reload
//   end, `activeSlot`, the ammo block), `setShield` is the overshield grant's pools, `setWriteLost` asks MC for RESYNC GUN.

import { PHONE_POWERUP_THRESHOLD_DBM } from './transport/contract.gen.js';   // #4: the generated contract owns the claim threshold

// ---------- A56 (S58): powerups (docs/spec/powerups.md) ----------
// Everything below is INERT unless the pushed config carries a powerup station with an `item` (MC sends one
// unless it was started with `--no-powerups`; powerups are ON by default, F372). Tony's defaults (2026-09-24),
// each a named constant so a change is one line:

export const PU_RESERVE = 0;                // a weapon item grants its charges as the MAGAZINE and no reserve
export const PU_LOST_AT_DEATH = true;       // a weapon item's unused charges do not carry into the next life
export const PU_ACTIVE_CARD_MS = 1200;      // F400: the ACTIVE confirm bubble's life after SWITCHING (hud.js `_swap('switched', el, 900, 1200)`)
export const PU_WEAPON_SWAPS = true;        // lead 2026-09-24: a second WEAPON pickup replaces the first (never refused)
export const PU_STACK_CAP_X = 2;            // F381 (Tony, 2026-09-25): the same weapon stacks up to this many times the item's own charges
export const OVERSHIELD_AMOUNT = 75;        // the fallback when an item carries no `amount` (MC normally expands it)
export const OVERSHIELD_DECAY_PER_S = 0;    // Tony: no decay. Not read yet: a non-zero value needs a decay writer first
// `charges` falls back to the weapon's own catalogue magazine (`clip`) when the item carries none: the fifth default.
// Tony 2026-09-24: "straight to trigger. id prefer trigger fires it", then "select should equip it if possible". A mid-life
// `$WEAP,<slot>,…` equips that slot on the trigger at once (bench 2026-09-24, powerups.md "Sitting A 3.3"), so the phone
// equips the heavy itself and no `$BMAP` is ever written: ALT keeps its job, SELECT stays at the head's `$BMAP,3,98`.
export const PU_SELECT_DEBOUNCE_MS = 400;   // a second SELECT press inside this is the same press (a double press toggles once)
export const PU_ANNOUNCE_MS = 2400;         // the spawn card's hold, and the gap between two announcements that land together
export const PU_ANNOUNCE_LATE_MS = 5000;    // a spawn noticed later than this (a frozen webview) is not announced
export const PU_READY_MS = 2500;            // how long the station hint names the item after a grant
export const PU_NEAR_DB = 10;               // GET CLOSER shows only within this of the station's own threshold
// The claim (Tony 2026-09-24, via the brx5 lead): stand about a foot from the station for 1 s, no button. Range is the
// MEDIAN of the last three samples of the station's advert (beacon.js `median`), never the respawn path's EMA.
export const POWERUP_THRESHOLD_DEFAULT = PHONE_POWERUP_THRESHOLD_DBM;   // byte 14 = 0: a placeholder for ~1 ft until the bench calibrates it
export const POWERUP_EXIT_DB = 3;               // out of range = the median below the threshold minus this
export const POWERUP_DWELL_MS = 1000;           // continuously in range this long = `claim_ready`; leaving range resets it
export const POWERUP_NO_ANSWER_MS = 15000;      // Bench B: Stick confirmation took up to 13 s; no answer at 15 s still allows a later taker advert.
export const POWERUP_READY_LATCH_MS = 15000;    // a `taker` advert still counts this long after the phone was last ready
export const PU_ADVERT_STALE_MS = 8000;     // an advert older than this says nothing about the item
// Tony 2026-09-24: "in halo if you get hit while you are getting overshield the damage is ignored". The grant is one burst
// (spawn protection on, a `$PSET` with the shield max raised, the absolute `$LIFE`), and protection ends this long after it.
export const OVERSHIELD_GRANT_MS = 1000;
export const OVERSHIELD_HIR_WAIT_MS = 1000;  // polish M1: a `$HIR` with no `$HP` after it holds the grant this long at most (a lethal hit in flight)
export const PU_BACK_RETRY_MS = 1500;       // polish M3: a switch-back the gun has not answered with an `$ALCD` for that slot is re-sent after this
export const OVERSHIELD_OFF_RETRIES = 3;   // r2: a protection-off that keeps failing is retried this often, then left to RESYNC GUN
export const PU_BACK_TRIES = 3;             // ...at most this many times
export const OVERSHIELD_ECHO_MS = 1500;     // a pre-grant `$HP` still in flight must not read as the overshield breaking
/** The spawn index at `elapsedMs` on the match clock (0 = the first spawn at `first_at_s`), or -1 before the first. PURE. */
export function puSpawnIndex(item, elapsedMs) {
  const every = Number(item && item.spawn_every_s) * 1000, first = Number(item && item.first_at_s) * 1000;
  if (!(every > 0) || !Number.isFinite(first) || !(elapsedMs >= first)) return -1;
  return Math.floor((elapsedMs - first) / every);
}
/** The match-clock time (ms after go-live) of spawn `k`. PURE. */
export function puSpawnAt(item, k) { return (Number(item.first_at_s) + k * Number(item.spawn_every_s)) * 1000; }

// F417/F418 (bench 2026-09-26): a held heavy's slot reading 0 with no trigger pull is the gun holding counts the node did
// not give it (a lost grant `$AMMO`, a lost or late reconcile write), never a round. The node re-sends the held counts
// this many times before it believes the 0 and ends the item, as it always did.
export const PU_COUNT_REPAIRS = 2;

/** "A held heavy keeps its charges": `frames` with the held heavy's `$AMMO` row carrying its charges (`held.left`,
 *  PU_RESERVE) in place of whatever the frame said, and every other slot in `zero` (a Set of pickup slots) at 0/0.
 *  Every other frame, `$AMMO` or not, is passed through verbatim, in order. `held` null (nothing held) changes only the
 *  `zero` slots. Used by the F416 burst re-send, the reconcile re-arm, the self-hit revive and the stun restore: each
 *  writes a spawn-shaped burst whose compiled pickup row is the empty one, and a separate restore after it would open
 *  the echo window after the zero had gone out (polish H1). PURE: frames in, frames out. */
export function burstWithHeld(frames, held, zero = null) {
  return frames.map(f => {
    if (typeof f !== 'string' || !f.startsWith('$AMMO,')) return f;
    const s = +f.split(',')[1];
    if (held && s === held.slot) return `$AMMO,${s},${held.left},${PU_RESERVE},1,*`;
    return zero && zero.has(s) ? `$AMMO,${s},0,0,1,*` : f;
  });
}

/** The player's powerup state: one instance per Engine (`engine.pu`). It owns every powerup field; the engine reaches it
 *  only through the methods and accessors below, and it reaches the engine only through `host` (see the file header). */
export class PlayerPowerups {
  constructor(host) {
    this.host = host;
    this.reset();
  }
  /** Every powerup state field back to empty: a new match, a new config, a reset. */
  reset() {
    this.host.show('puLost', null);   // HUD QA R2-17: {name, color, at} the weapon item a death took; cleared by the next life
    this._held = null;          // the weapon item: {station, weapon_id, slot, charges, left, name, color, at, back: {slot, mag, res}, trig}
    this._overshield = null;    // {station, base, amount, name, color, at}: the shield at the grant is `base`
    this._claim = null;         // {station, since, readyAt}: standing in range of a station whose item is there
    this._readyFor = null;      // {station, at}: the last station this phone was claim_ready for (the grant needs it)
    this._osProtectUntil = 0;   // now() at which the overshield grant's spawn protection ends (0 = none owed)
    this._advert = {};          // station id -> {state, value, taker, at}: the station's own last advert
    this._seen = {};            // station id -> the last spawn index the announcer has dealt with
    this._back = null;          // {name, to, at}: a weapon item ran dry and the saved weapon is returning
    this._reequip = false;      // a heavy was held at the death: re-equip slot 0 behind the revive burst
    this._selectAt = 0;         // now() of the last SELECT that acted (the debounce)
    this._backPending = null;   // {slot, mag, res, at, readyAt, equipped, tries}: an empty switch-back waiting for its swap window or a gun answer
    this._going = null;         // F400: {slot, name, color, weapon_id, charges, until} -- a slot losing its identity THIS call
                                // (the empty switch-back's heavy), kept for the HUD's SWITCHING card past the moment `_held` moves on
    this._hpAt = 0;             // now() of the last `$HP` (polish M1: a `$HIR` after it holds the overshield grant)
    this._psetNow = null;       // the `$PSET` the gun holds (the life's pool take); the next spawn sets it
    this._spawnCard = null;     // {name, color, at, station}: the "<ITEM> AVAILABLE" card (presentation only)
    this._grant = null;         // {name, color, kind, at, replaced?}: the grant, for the HUD's READY hint (state, at once)
    this._swapCard = null;      // {name, color, replaced, at}: the "<NEW> REPLACES <OLD>" card, set when the announcer reaches it
  }
  /** The `pu` block of the engine's persisted context (an app restart mid-match must still end a held item, re-equip
   *  slot 0 after a death with a heavy held, and keep the overshield out of the S29 refill's way), or null. */
  snapshot() {
    return this._held || this._overshield || this._reequip || this._backPending ? { held: this._held, overshield: this._overshield, seen: this._seen, reequip: !!this._reequip, osProtectUntil: this._osProtectUntil || 0, psetNow: this._psetNow || null, backPending: this._backPending || null } : null;
  }
  /** `_load`: the `pu` block `snapshot` wrote. */
  restore(p) { this._held = p.held || null; this._overshield = p.overshield || null; this._seen = p.seen || {}; this._reequip = !!p.reequip; this._osProtectUntil = +p.osProtectUntil || 0; this._psetNow = p.psetNow || null; this._backPending = p.backPending || null; }
  /** A spawn or revive wrote this life's `pset_pool` take: the overshield raises THIS frame's shield max, and restores it. */
  setPset(frame) { this._psetNow = frame; }

  // ---- the claim and the spawn announcements (Tony 2026-09-24, via the brx5 lead) ----
  /** `{id: item}` for every powerup station in this game's config, or null when there is none (the inert case). */
  items() {
    const cfg = this.host.config, st = cfg && Array.isArray(cfg.stations) ? cfg.stations : [];
    let out = null;
    for (const s of st) {
      if (!s || typeof s !== 'object' || s.kind !== 'powerup' || !s.item || typeof s.item !== 'object') continue;
      if (s.item.kind !== 'weapon' && s.item.kind !== 'overshield') continue;
      (out || (out = {}))[s.id] = s.item;
    }
    return out;
  }
  /** ms since go-live on the synced match clock, or null outside a live match. */
  _elapsed(now) { const h = this.host; return h.phase === 'live' && h.goLiveT ? now - h.goLiveT : null; }
  /** The station's own advert, when it is fresh and says something: state 1 (available) or state 0 with a
   *  countdown. State 0 with value 0 is a station that does not know yet (no `station_update` since it was armed),
   *  and reads as no advert at all, so the phone's own schedule decides. */
  _advertOf(id, now) {
    const a = this._advert[id];
    if (!a || now - a.at > PU_ADVERT_STALE_MS) return null;
    if (a.state === 0 && !a.value) return null;
    return a;
  }
  /** Bench 2026-10-02 (ROBP1): a re-claim of the same weapon at the stack cap took the station's item and gave nothing.
   *  At the cap the player does not claim, so the item stays for someone else. Same cap rule as the stack grant. PURE. */
  _atCap(item) {
    const h = this._held;
    if (!h || !item || item.kind !== 'weapon' || h.weapon_id !== item.weapon_id) return false;
    const c = this._itemCharges(item);
    return h.left >= PU_STACK_CAP_X * Math.max(c, h.base || c);   // the stack grant's own formula, byte for byte
  }
  /** Is the item at station `id` there to claim? The station owns taken and untaken, so its advert decides; only a
   *  station with nothing to say yet falls back to the phone's own schedule (and then decides nothing: it names the taker). */
  claimable(id, item, now) {
    if (this._atCap(item)) return false;
    const el = this._elapsed(now); if (el == null) return false;
    const a = this._advertOf(id, now);
    if (a) return a.state === 1 && puSpawnIndex(item, el) >= 0;   // F374: never before the first spawn, whatever a station says
    return puSpawnIndex(item, el) >= 0;
  }
  /** The claim's range reading for a station entry: the median of its last three samples (beacon.js). */
  _median(e) { return Number.isFinite(e.median) ? e.median : Number.isFinite(e.raw) ? e.raw : e.rssi; }
  _threshold(e) { return e.threshold || POWERUP_THRESHOLD_DEFAULT; }
  /** The powerup station this player reads: the one being claimed while it is still heard, else the loudest median. */
  _station(items = this.items()) {
    if (!items) return null;
    const h = this.host;
    const mine = h.stations.filter(e => e && e.kind === 'powerup' && items[e.id] && h.stationAllowed(e)
      && !(Number.isFinite(e.ageMs) && e.ageMs > PU_ADVERT_STALE_MS));
    const held = this._claim ? mine.find(e => e.id === this._claim.station) : null;
    return held || mine.sort((a, b) => this._median(b) - this._median(a))[0] || null;
  }
  /** Called from `setStations`: remember each powerup station's advert (the "taken early" relay reaches phones this way). */
  onStations(now) {
    const h = this.host;
    for (const e of h.stations) {
      if (!e || e.kind !== 'powerup') continue;
      const at = now - (Number.isFinite(e.ageMs) ? e.ageMs : 0);
      const prev = this._advert[e.id];
      if (!prev || at >= prev.at) {
        // F417 (bench 2026-09-26): two phones both granted themselves one Stick's Rockets, and nothing on either phone said
        // which taker it had heard, or when. One line per CHANGE of state or taker (not per advert: a flood is 50/s).
        if (!prev || prev.state !== e.state || prev.taker !== (e.taker || 0)) h.log(`powerup: station ${e.id} advert state ${e.state} taker ${e.taker || 0} value ${e.value} seq ${e.seq != null ? e.seq : '-'} (${Number.isFinite(e.median) ? e.median : e.rssi} dBm, ${Math.round(e.ageMs || 0)} ms old)`, 'li');
        this._advert[e.id] = { state: e.state, value: e.value, taker: e.taker || 0, at };
      }
    }
    this._claimTick(now);
  }
  /** The claim: 1 s continuously within range of a station whose item is there. `state().powerupClaim` carries it to
   *  the player advert (app.js: `claiming`, then `claim_ready`, with the station id in `value`) and to the HUD's ring.
   *  The STATION picks the winner; the grant waits for its `taker` byte (`_takerCheck`). */
  _claimTick(now) {
    const h = this.host;
    const items = this.items(); if (!items) { this._claim = null; return; }
    const ok = h.phase === 'live' && h.alive && h.bleUp && !h.resync && !h.reconciling && !h.gunLocked && !h.tutorial;
    // Polish M2: a STUNNED gun is disarmed and `_stunRestore` rewrites its ammo, which would erase a weapon grant. The claim
    // is not dropped: the ready latch is kept warm, so the station's answer is taken the moment the stun ends.
    // F331: but only while the player stays in range; walking out drops the claim, so no claim_ready goes out.
    if (ok && h.stunned) {
      const cl = this._claim, st = cl ? this._station(items) : null;
      const held = st && st.id === cl.station && Number.isFinite(this._median(st)) && this._median(st) >= this._threshold(st) - POWERUP_EXIT_DB;
      if (!held) { this._claim = null; this._readyFor = null; } else if (this._readyFor) this._readyFor.at = now;
      return;
    }
    if (!ok) { this._claim = null; this._readyFor = null; return; }
    this._takerCheck(items, now);
    const st = this._station(items);
    if (!st) { this._claim = null; return; }
    const c = this._claim && this._claim.station === st.id ? this._claim : null;
    const med = this._median(st), thr = this._threshold(st);
    const inRange = Number.isFinite(med) && (c ? med >= thr - POWERUP_EXIT_DB : med >= thr);   // enter at the threshold, leave 3 dB under it
    if (!inRange || !this.claimable(st.id, items[st.id], now)) { this._claim = null; return; }
    if (!c) this._claim = { station: st.id, since: now, readyAt: null };
    const cl = this._claim;
    if (cl.readyAt == null && now - cl.since >= POWERUP_DWELL_MS) { cl.readyAt = now; h.log(`powerup: claim ready at station ${st.id}`, 'li'); }
    if (cl.readyAt != null) this._readyFor = { station: st.id, at: now };
  }
  /** The grant happens only when a station's advert names THIS player as `taker` and this phone was claim_ready for it. */
  _takerCheck(items, now) {
    const h = this.host;
    const me = h.player ? h.player.player_num : null;
    for (const id of Object.keys(items)) {
      const a = this._advert[id]; if (!a || now - a.at > PU_ADVERT_STALE_MS) continue;
      if (a.state !== 0 || !a.taker || a.taker !== me) continue;
      const r = this._readyFor;   // cleared by the grant: one ready claim, one grant
      if (!r || String(r.station) !== String(id) || now - r.at > POWERUP_READY_LATCH_MS) continue;
      const item = items[id];
      // Never to a dead gun, and never over a hit whose `$HP` is still in flight (polish M1: a lethal one would be revived by
      // the absolute `$LIFE`). The claim latch stays warm, so the grant goes out on the next tick once the `$HP` is in.
      if (item.kind === 'overshield' && (h.hp <= 0 || (h.latch && h.latch.at > this._hpAt && now - h.latch.at < OVERSHIELD_HIR_WAIT_MS))) continue;
      this._readyFor = null; this._claim = null;
      const granted = item.kind === 'weapon' ? this.grantWeapon(+id, item, now) : this.grantShield(+id, item, now);
      if (!granted) continue;
      h.emitFact({ type: 'pickup', match_id: h.matchId, station_id: +id, item_kind: item.kind, ...(item.kind === 'weapon' ? { weapon_id: item.weapon_id } : {}) });
      h.save();
      h.changed();
    }
  }
  /** tick(), early: the spawn announcements, from the phone's own schedule and the match clock. Presentation only. */
  tickAnnounce(now) {
    const h = this.host;
    const items = this.items(); if (!items) return;
    const el = this._elapsed(now); if (el == null) return;
    const batch = [];
    for (const id of Object.keys(items)) {
      const item = items[id], k = puSpawnIndex(item, el);
      const seen = this._seen[id] != null ? this._seen[id] : -1;
      if (k <= seen) continue;
      this._seen[id] = k;
      if (el - puSpawnAt(item, k) > PU_ANNOUNCE_LATE_MS) continue;   // a resumed webview does not replay old news
      // Skipped when the phone KNOWS nobody took the last one: the station advertised it available after that spawn.
      const a = this._advert[id];
      if (k >= 1 && a && a.state === 1 && a.at >= h.goLiveT + puSpawnAt(item, k - 1)) continue;
      if (!batch.some(b => b.name === item.name)) batch.push({ name: String(item.name || '').toUpperCase(), color: item.color || null, station: +id });
    }
    // docs/announcer.md: each spawn is one announcer item (the lowest priority), so two that land together show one at a
    // time, PU_ANNOUNCE_MS each, and never on top of a kill confirm or a lead change.
    for (const next of batch) h.laneFeed({ kind: 'powerup_spawn', text: `${next.name} AVAILABLE`, sub: next.station != null ? `AT STATION ${next.station}` : null, color: next.color, src: null });   // no source line: the phone's own schedule; the station names it   // HUD QA R2-16: name the station   // the FEED lane, at once
    for (const next of batch) h.announce({ kind: 'powerup_spawn', key: `pu:${next.name}`, bannerMs: PU_ANNOUNCE_MS,
      play: () => { this._spawnCard = { ...next, at: h.now() }; h.log(`powerup: ${next.name} AVAILABLE (station ${next.station})`, 'li'); h.changed(); } });
    if (this._spawnCard && now - this._spawnCard.at > PU_ANNOUNCE_MS + 1000) this._spawnCard = null;
    if (this._swapCard && now - this._swapCard.at > PU_ANNOUNCE_MS + 1000) this._swapCard = null;
    if (this._grant && h.laneAge(this._grant.at, now) > PU_READY_MS + 1000) this._grant = null;   // F400 r1: past the card, then the hint
  }
  /** tick(), after the announcer: the claim's dwell (it runs on the clock too, not only on a fresh advert), the end of the
   *  overshield grant's spawn protection, and a switch-back the gun never answered (polish M3). */
  tick(now) {
    this._claimTick(now);
    this._osTick(now);
    this._backTick(now);
  }
  /** `state().powerupClaim`: {station, claiming, ready, progress} while standing in a claim, else null. PURE. */
  claimView(now) {
    const cl = this._claim;
    return cl && this.items() ? { station: cl.station, claiming: true, ready: cl.readyAt != null,
      progress: Math.min(1, (now - cl.since) / POWERUP_DWELL_MS) } : null;
  }
  /** The HUD's powerup view (`state().powerup`), or null when the game has no powerup items (the inert case). PURE. */
  view(now) {
    const h = this.host;
    const items = this.items(); if (!items) return null;
    const hd = this._held, o = this._overshield;
    const held = hd ? { name: hd.name, color: hd.color, weapon_id: hd.weapon_id, slot: hd.slot, charges: hd.charges, left: hd.left, active: this._onHeavy(), back: hd.back ? { ...hd.back } : null } : null;
    const overshield = o ? { name: o.name, color: o.color, amount: o.amount, left: Math.max(0, Math.min(o.amount, h.shield - o.base)), base: o.base } : null;
    // F400: a slot that lost its identity to a switch-back THIS life, so the HUD's switch card can still name it
    // on the render after `_held` moved on (see `_switchCard`). Gone once its own card's window has passed.
    const going = this._going && now < this._going.until
      ? { slot: this._going.slot, name: this._going.name, color: this._going.color, weapon_id: this._going.weapon_id, charges: this._going.charges } : null;
    let hint = null;
    if (h.presentable('hint')) {   // #5: the presentation gate's rule for the hint (live and alive)
      const st = this._station(items), g = this._grant, cl = this._claim;
      const nameOf = item => String(item.name || '').toUpperCase();
      const b = this._back;
      // F400 final: the hint's own PU_READY_MS runs only while no switch card is up (its own card, and any after it)
      if (b && h.laneAge(b.at, now) < PU_READY_MS) hint = { kind: 'switched_back', name: b.name, to: b.to, color: null };
      else if (g && h.laneAge(g.at, now) < PU_READY_MS && !(h.lastHitAt > g.at)) hint = { kind: 'granted',   // HUD QA R2-18: a hit retires the pickup card: the hit stack owns the centre
        name: g.name, color: g.color, itemKind: g.kind, ...(g.charges != null ? { charges: g.charges } : {}), ...(g.replaced ? { replaced: g.replaced } : {}) };
      else if (cl && items[cl.station]) {
        const item = items[cl.station], base = { name: nameOf(item), color: item.color || null, station: cl.station };
        hint = cl.readyAt != null && now - cl.readyAt >= POWERUP_NO_ANSWER_MS ? { kind: 'no_answer', ...base }
          : { kind: 'claiming', ...base, progress: Math.min(1, (now - cl.since) / POWERUP_DWELL_MS), ready: cl.readyAt != null };
      } else if (st) {
        // F425 (Tony, 2026-09-26): drop the always-on TAKEN/countdown hint here -- an unclaimable near station
        // now shows nothing; the left-side "<ITEM> AVAILABLE" feed alert (unchanged) is the only spawn signal.
        const item = items[st.id], base = { name: nameOf(item), color: item.color || null, station: st.id };
        const med = this._median(st), near = Number.isFinite(med) && med >= this._threshold(st) - PU_NEAR_DB;
        if (near && this.claimable(st.id, item, now)) hint = { kind: 'approach', ...base };
      }
    }
    return { hint, held, overshield, going };
  }

  // ---- the weapon item: a heavy straight onto the trigger (Tony, 2026-09-24) ----
  // Tony 2026-09-24: "straight to trigger. id prefer trigger fires it", then "select should equip it if possible". A mid-life
  // `$WEAP,<slot>,…` equips that slot on the trigger at once (bench 2026-09-24, powerups.md "Sitting A 3.3"), so the phone
  // equips the heavy itself and no `$BMAP` is ever written: ALT keeps its job, SELECT stays at the head's `$BMAP,3,98`.
  /** Is `slot` the held heavy's pickup slot? False with nothing held. PURE. */
  isHeldSlot(slot) { return !!this._held && slot === this._held.slot; }
  /** `{name, weapon_id, charges}` of the held heavy while it is on the trigger, else null (the HUD's weapon name, ammo
   *  denominator and weapon id follow it). PURE. */
  heavyOnTrigger() { const h = this._held; return this._onHeavy() ? { name: h.name, weapon_id: h.weapon_id, charges: h.charges } : null; }
  /** A weapon item's charges: the station's own CHARGES, else the weapon's clip, else 1. PURE. */
  _itemCharges(item) {
    const row = this.host.weaponRow(item.weapon_id);
    return Number.isFinite(+item.charges) && +item.charges > 0 ? +item.charges : (row && row.clip > 0 ? row.clip : 1);
  }
  /** The head's own `$WEAP` row for `slot`, verbatim, or null. Re-sending it mid-life equips that slot on the trigger
   *  at once (and refills it, so an `$AMMO` always follows): bench 2026-09-24, powerups.md "Sitting A 3.3". */
  _headWeap(slot) {
    const fr = this.host.frames, head = (fr && fr.head) || [];
    return head.find(f => typeof f === 'string' && f.startsWith(`$WEAP,${slot},`)) || null;
  }
  /** F381 polish r2: an `$AMMO` set-mode write clamps to the `$WEAP` clip (docs/manual/dev.md, the `$TMP` row), so a held
   *  count above the head's clip (a stack: Rockets 4 on a 2-round clip) raises the clip tokens in the equip's own `$WEAP`:
   *  split index 17 is t16 maxClip, 18 is t17 maxAmmo, 40 is t39 clipStartingAmmo. Without it the gun holds 2 whatever we send. */
  _weapFor(slot, n) {
    const weap = this._headWeap(slot); if (!weap) return null;
    const t = weap.split(',');
    if (slot < 2 || t.length < 41 || !(+t[17] > 0) || !(n > +t[17])) return weap;   // pickup slots only: a loadout weapon keeps its compiled clip
    t[17] = String(n); t[40] = String(n);
    t[18] = String(Math.max(+t[18] || 0, n));   // t17 maxAmmo: every stock frame has t17 >= t16; t40 (the spare reserve) stays as compiled
    return t.join(',');
  }
  /** Is the held heavy on the trigger? `held.trig` is fed by `$ALCD` for slots 0-3 and by the node's own equips;
   *  melee's slot 4 never moves it (it is its own button, not the trigger). PURE. */
  _onHeavy() { const h = this._held; return !!(h && h.trig === h.slot); }
  /** The loadout slot the trigger is on, for the switch-back target: 0 or 1, else 0 (slot 4 is melee). PURE. */
  _loadoutSlot(s) { return s === 0 || (s === 1 && this.host.slotCount() >= 2) ? s : 0; }
  /** [mag, reserve] the gun holds in `slot` now: the node's magazine account (`liveAmmo`), else the spawn row. PURE. */
  _counts(slot) {
    const h = this.host, l = h.liveAmmo()[slot]; if (l) return l;
    const m = h.acctLive(slot), r = h.prevReserve(slot);
    return [m != null ? m : 0, r != null ? r : 0];
  }
  /** Put `slot` on the trigger: `pre` (a swap's zeroing), its head `$WEAP`, then `$AMMO` with the counts it must hold.
   *  The `$WEAP` refills the slot, so the `$AMMO` is what makes the counts right; both go in one write, in that order. */
  _equip(slot, mag, res, why, pre = []) {
    const h = this.host;
    const weap = this._weapFor(slot, mag);
    if (!weap) { h.log(`powerup: the head carries no $WEAP for slot ${slot}; nothing equipped (${why})`, 'le'); return false; }
    h.acctWrote(slot, mag, res, true);   // F259: the gun's `$WEAP` reset and our `$AMMO` echo are bookkeeping, never a shot (bug 3 r1: a `$WEAP`-bearing window)
    h.setPrev(slot, mag, res);     // what the slot holds now, should the echo never come back
    const frames = [...pre, weap, `$AMMO,${slot},${mag},${res},1,*`], act = h.actSeq, held = this._held;
    Promise.resolve(h.quietWrite(frames, why)).then(ok => {   // F416 part 2: a grant is a must-land write too
      if (ok !== false) return;
      // F417 (bench 2026-09-26): a lost equip left the gun on the old weapon ("ON TRIGGER" but the sniper fired) or
      // without its counts. It is safe to repeat while nothing moved: no round, no hit, the same item on the same slot.
      if (h.actSeq !== act || this._held !== held || h.activeSlot !== slot || (h.switching && !h.switching.pu) || !h.bleUp || h.phase !== 'live') { h.log(`write ${why} failed -- the game moved on, not re-sent`, 'li'); return; }
      h.log(`*** write ${why} failed -- re-sending once (F417) ***`, 'le');
      h.quietWrite(frames, `${why} (retry)`);
    });
    h.equipped(slot, mag, res);   // the trigger is on `slot` now (the engine's side: the swap, the reload, the ammo block)
    if (this._held) this._held.trig = slot;
    // F436 (bench 2026-10-02, 0/6 vs 4/4 + 9/9): after `$SPAWN` the gun ignores a `$WEAP`/`$AMMO` slot change until the
    // first trigger pull of the life, while its `$ALCD` echo still reports the new slot. No cure is bench-proven yet, so an
    // equip before that pull is logged as unconfirmed; the slot-0-shot backstop (`lostEquip`) is the working cure.
    if (slot >= 2 && this._held && this._held.slot === slot) {
      this._held.unconfirmed = h.pulledLife !== h.lifeSeq;
      if (this._held.unconfirmed) h.log(`powerup: ${this._held.name} equipped before the first trigger pull of this life: unconfirmed (F436); a slot-0 shot triggers the re-send`, 'li');
    }
    h.recoilArm('powerup equip');   // S42: as a confirmed ALT swap, the slot's own profile
    return true;
  }
  /** F400 (docs/spec/powerups.md "The switch card"): a pickup-driven equip (a grant, a same-weapon stack, a SELECT
   *  toggle either way, or the empty switch-back) shows the SAME full weapon-switch card an ALT press does, with
   *  ALT's own timing -- it sets the engine's `switching` verbatim, so the gun's own echo of the equip write confirms it
   *  through ammo.js `onAmmo`'s ALT-confirm code, or its `switchTick` assumed-timeout does, exactly as ALT.
   *  That also makes it a `data-takeover` (hud.js `switchUp`), which is what makes it a takeover for F368's clash
   *  rule (docs/announcer.md) with no HUD change at all. Immediate equips call this after `_equip`; an empty
   *  switch-back opens the card before its delayed equip. `going`, when given, is `{name, color, weapon_id, charges}` for `from`: a slot
   *  about to lose its identity this call (the empty switch-back's heavy, cleared before the equip), kept on
   *  `state().powerup.going` so the HUD's tile can still name it after `_held` is gone. */
  _switchCard(from, to, going = null) {
    const h = this.host, now = h.now();
    h.setSwitching({ at: now, from, to, pu: true });   // pickup card: only an empty switch-back still owes its delayed equip
    if (going) this._going = { slot: from, ...going, until: now + h.switchWindowMs() + 1400 };
  }
  /** A weapon item goes STRAIGHT ONTO THE TRIGGER (Tony, 2026-09-24): save the slot the trigger is on and its counts
   *  (the switch-back target), then the pickup slot's head `$WEAP` and `$AMMO` with the charges. No ALT or SELECT write,
   *  so an Easy Reload player is granted like anyone. A second weapon item SWAPS (PU_WEAPON_SWAPS): the old slot is
   *  zeroed first, and the switch-back target stays the loadout weapon. */
  grantWeapon(id, item, now) {
    const h = this.host, cfg = h.config;
    const armed = ((cfg && cfg.powerups) || []).find(p => p && p.weapon_id === item.weapon_id);
    if (!armed || !Number.isFinite(+armed.slot)) { h.log(`powerup: ${item.weapon_id} has no armed slot in this game (config.powerups)`, 'le'); return false; }
    const slot = +armed.slot;
    if (!this._headWeap(slot)) { h.log(`powerup: the head carries no $WEAP for slot ${slot} (${item.weapon_id})`, 'le'); return false; }
    this._backPending = null;
    const charges = this._itemCharges(item);
    const old = this._held;
    if (old && old.weapon_id === item.weapon_id) {
      if (old.trig !== old.slot) {
        const t = this._loadoutSlot(old.trig), [mag, res] = this._counts(t);
        old.back = { slot: t, mag, res };
      }
      // Per-station CHARGES (1-4) means two stations can hand out the same weapon with different charges: the cap is
      // the larger item's, and a stack never shrinks what is held (4 held + a CHARGES-1 pickup stays 4, not min(2, 5)).
      const base = Math.max(charges, old.base || charges);
      const stacked = Math.max(old.left, Math.min(PU_STACK_CAP_X * base, old.left + charges));   // Rockets (2): 1 + 2 = 3; 3 + 2 = 4, capped
      old.left = stacked; old.charges = stacked; old.base = base; old.station = id; old.at = now;
      old.repairs = 0; old.equipRepairs = 0; old.suspect = false;   // a new grant has a fresh repair budget
      this._equip(old.slot, stacked, PU_RESERVE, `powerup: ${old.name} charges stacked (${stacked})`);
      this._switchCard(old.slot, old.slot);   // F400: a re-equip still shows the full card (Tony's decision 1), the ACTIVE tile carrying the new count
      this._grant = { kind: 'weapon', name: old.name, color: old.color, charges: stacked, at: now };
      return true;
    }
    if (old && !PU_WEAPON_SWAPS) { h.log(`powerup: already holding ${old.name}`, 'li'); return false; }
    // The switch-back target. A swap keeps the first grant's, unless the trigger has since gone back to a loadout
    // weapon (ALT or SELECT), whose counts are newer.
    let back = old && old.trig === old.slot && old.back ? old.back : null;
    if (!back) { const t = this._loadoutSlot(old ? old.trig : h.activeSlot), [mag, res] = this._counts(t); back = { slot: t, mag, res }; }
    const pre = old && old.slot !== slot ? [`$AMMO,${old.slot},0,0,1,*`] : [];
    if (pre.length) h.acctWrote(old.slot, 0, 0);
    const name = String(item.name || item.weapon_id).toUpperCase();
    this._held = { station: id, weapon_id: item.weapon_id, slot, charges, base: charges, left: charges, name, color: item.color || null, at: now, back, trig: back.slot };
    this._back = null;
    this._equip(slot, charges, PU_RESERVE, `powerup: ${name} on the trigger (${charges} in slot ${slot}; back to slot ${back.slot} at ${back.mag}/${back.res})${old ? ` replaces ${old.name}` : ''}`, pre);
    this._switchCard(back.slot, slot);   // F400: the same full weapon-switch card an ALT press shows, ALT's own timing
    this._grant = { kind: 'weapon', name, color: item.color || null, charges, at: now, ...(old ? { replaced: old.name } : {}) };
    if (old) {   // docs/announcer.md: "<NEW> REPLACES <OLD>" is an announcer card, so it waits its turn like the rest
      const swap = { name, color: item.color || null, replaced: old.name };
      h.laneFeed({ kind: 'powerup_swap', text: name, sub: `REPLACES ${old.name}`, color: swap.color, src: 'BLE' });   // the FEED lane, at once
      h.announce({ kind: 'powerup_swap', key: 'pu_swap', play: () => { this._swapCard = { ...swap, at: h.now() }; h.changed(); } });
    }
    return true;
  }
  /** Every `$ALCD` that reached the ordinary path: the slot is the trigger's (melee's slot 4 is not, and an unheld pickup
   *  slot is only our own zeroing echo). The heavy's own magazine reaching 0 ends the item. Returns the slot to keep
   *  active while the empty heavy waits for its delayed switch-back, else null. */
  onAmmo(slot, mag, prev) {
    const h = this.host, bp = this._backPending;
    // Polish M3: the gun answered the switch-back. Never the reconcile disarm's echo (r2 M1): `rc.end()` re-sends it.
    // A real round from a loadout slot means the player is shooting something else by choice: stop re-sending (r2 low).
    if (bp && !h.reconciling && ((bp.equipped !== false && (slot === bp.slot || slot < 2)) || (slot < 2 && prev != null && mag < prev))) this._backPending = null;   // a loadout shot is a player choice, even before the delayed write
    const held = this._held; if (!held || slot === 4 || (slot >= 2 && slot !== held.slot) || h.reconciling) return null;   // polish H1: the disarm's echo is not a shot
    // Only a round leaving (or a slot's first report) says which weapon is on the trigger: the echo of our own `$AMMO`
    // for another slot is not the trigger moving (bench: `$AMMO` alone never switches).
    const shot = prev == null || mag < prev;
    if (shot) held.trig = slot;
    if (slot !== held.slot) return null;
    if (mag > 0 && mag === held.left && held.suspect) { held.suspect = false; h.save(); }   // the count is confirmed; `equipRepairs` stays per grant (an `$AMMO` echo proves the count, not the trigger)
    held.left = mag;
    if (mag > 0 || !shot) return null;
    this.end('empty');
    return h.activeSlot;   // keep the empty heavy active until the delayed switch-back; ammo.js `onAmmo` must not move it
  }
  /** Repair a held count that fell without a credible heavy shot. This includes an old positive count after a stack.
   *  After one mismatch, a pull is not proof that the gun switched to the heavy. A matching read-back clears that doubt.
   *  True when the report was a stale pickup count (not a round) and has been answered. */
  repairUnpulled(slot, mag, prev) {
    const h = this.host, held = this._held;
    if (!held || slot !== held.slot || !(held.left > mag) || h.reconciling) return false;
    if (prev != null && mag >= prev) return false;
    const now = h.now();
    if (!held.suspect && h.recentPull(held.slot, now)) return false;
    held.repairs = (held.repairs || 0) + 1;
    if (held.repairs > PU_COUNT_REPAIRS) { h.log(`*** powerup: ${held.name} still reads ${mag} after ${PU_COUNT_REPAIRS} re-sends; accepting the gun count ***`, 'le'); return false; }
    held.suspect = true;
    h.log(`*** powerup: ${held.name} read ${mag} without a confirmed heavy shot; re-sending ${held.left} (${held.repairs}/${PU_COUNT_REPAIRS}) ***`, 'le');
    const why = `powerup: ${held.name} counts re-sent (${held.repairs}/${PU_COUNT_REPAIRS})`;
    if (held.trig === held.slot) this._equip(held.slot, held.left, PU_RESERVE, why);
    else { h.acctWrote(held.slot, held.left, PU_RESERVE); h.setPrev(held.slot, held.left, PU_RESERVE); h.quietWrite([`$AMMO,${held.slot},${held.left},${PU_RESERVE},1,*`], why); }
    h.changed();
    return true;
  }
  /** F436, measured BEFORE `onAmmo` moves anything: a loadout shot without ALT or SELECT proves that a recent phone equip
   *  did not put the held weapon on the trigger. A read-back with no count drop could be an old echo, so only a shot
   *  warrants another equip. Returns the held item (the token for `repairLostEquip`), or null. */
  lostEquip(slot, mag, prev, expectedBefore, altPending) {
    const h = this.host, held = this._held;
    const lost = held && slot < 2 && h.activeSlot === held.slot && held.trig === held.slot
      && (prev != null || expectedBefore != null) && mag < (prev != null ? prev : expectedBefore)
      && !(h.switching && !h.switching.pu) && altPending == null;
    return lost ? held : null;
  }
  /** F436 backstop, after the engine has booked the shot: re-send the equip, while the same item is still held. */
  repairLostEquip(held, slot, mag) {
    if (!held || this._held !== held) return;
    const h = this.host;
    held.suspect = true;
    if (held.back && held.back.slot === slot) held.back = { slot, mag, res: h.prevReserve(slot) || 0 };
    held.equipRepairs = (held.equipRepairs || 0) + 1;
    h.log(`powerup: gun fired slot ${slot} while ${held.name} was expected in slot ${held.slot}; equip repair ${held.equipRepairs}/${PU_COUNT_REPAIRS}`, 'le');
    if (held.equipRepairs <= PU_COUNT_REPAIRS && this._equip(held.slot, held.left, PU_RESERVE, `powerup: ${held.name} equip re-sent after slot ${slot} shot`)) this._switchCard(slot, held.slot);   // the player sees the move onto the heavy, so SELECT is not pressed blind
    h.save();
  }
  /** An ALT swap the engine took as done without a shot: ALT took the trigger off the heavy (the heavy keeps its charges). */
  onAssumedSwap(to) { if (this._held) this._held.trig = to; }
  /** An ALT swap the gun confirmed with a shot (A56 r2 M2): the trigger is off the heavy, and the player's own swap
   *  supersedes a pending switch-back (r3). */
  onConfirmedSwap(slot) { if (this._held) this._held.trig = slot; this._backPending = null; }
  /** An ALT press that opens a swap: a pending switch-back never follows it. */
  onAltPressed() { this._backPending = null; }
  /** SELECT (`$BUT,3,1`) with a heavy held TOGGLES the trigger (Tony, 2026-09-24: "select should equip it if possible"):
   *  on the heavy -> the saved weapon with its saved counts; on a loadout weapon -> the heavy with its charges left, the
   *  weapon's counts saved first. The PHONE equips (a native `$BMAP` fires a slot, never equips it), so SELECT stays at
   *  the head's `$BMAP,3,98` and nothing but `$WEAP` + `$AMMO` is written. */
  onSelect() {
    const h = this.host, held = this._held;
    if (!held) { if (this._backPending && this._backPending.equipped !== false) this._backPending = null; return; }
    this._backPending = null;   // F379 (bench B): a SELECT press is the player's choice, so a stale switch-back never follows it
    if (h.phase !== 'live' || !h.alive || h.tutorial || !h.bleUp || h.stunned || h.reconciling || h.resync || (h.switching && !h.switching.pu)) {
      h.log('SELECT ignored (dead, stunned, reconciling or a swap pending)', 'li'); return;
    }
    const now = h.now();
    if (this._selectAt && now - this._selectAt < PU_SELECT_DEBOUNCE_MS) return;
    this._selectAt = now;
    if (this._onHeavy()) {
      held.left = this._counts(held.slot)[0];
      const b = held.back || { slot: 0, mag: this._counts(0)[0], res: this._counts(0)[1] };
      this._equip(b.slot, b.mag, b.res, `SELECT: ${held.name} off the trigger (${held.left} left), slot ${b.slot} back at ${b.mag}/${b.res}`);
      this._switchCard(held.slot, b.slot);   // F400 decision 2: every SELECT toggle shows the switch card, naming the player's own weapon
    } else {
      const t = this._loadoutSlot(held.trig), [mag, res] = this._counts(t);
      held.back = { slot: t, mag, res };
      this._equip(held.slot, held.left, PU_RESERVE, `SELECT: ${held.name} on the trigger (${held.left} left), slot ${t} saved at ${mag}/${res}`);
      this._switchCard(t, held.slot);   // F400 decision 2: the same card, this direction naming the heavy
    }
    h.save();
  }
  /** Send the empty switch-back after its swap window, then retry if the gun never answers for that slot. */
  _backResend(now, why) {
    const h = this.host, bp = this._backPending; if (!bp) return;
    if (bp.equipped === false) {
      if (now < bp.readyAt) return;
      bp.equipped = true; bp.at = now;
      [bp.mag, bp.res] = this._counts(bp.slot);
      const card = h.switching && h.switching.pu ? h.switching : null;
      this._equip(bp.slot, bp.mag, bp.res, `powerup: switch-back to slot ${bp.slot} after swap window`);
      if (card) h.setSwitching(card);   // the existing card still closes into its ACTIVE state
      return;
    }
    if (bp.tries >= PU_BACK_TRIES) { this._backPending = null; h.log(`powerup: switch-back to slot ${bp.slot} never answered after ${bp.tries} re-sends`, 'le'); return; }
    bp.tries++; bp.at = now; [bp.mag, bp.res] = this._counts(bp.slot);
    this._equip(bp.slot, bp.mag, bp.res, `powerup: switch-back to slot ${bp.slot} re-sent (${why}, ${bp.tries}/${PU_BACK_TRIES})`);
  }
  /** tick(): the delayed switch-back, then a retry every PU_BACK_RETRY_MS while the gun can take it. */
  _backTick(now) {
    const h = this.host, bp = this._backPending; if (!bp || (bp.equipped === false ? now < bp.readyAt : now - bp.at < PU_BACK_RETRY_MS)) return;
    if (h.phase !== 'live' || !h.alive) { this._backPending = null; return; }
    if (!h.bleUp || h.stunned || h.reconciling || (h.switching && !h.switching.pu)) return;   // r3: never fight an ALT swap in flight (F400 r1: a pickup card is no swap)
    this._backResend(now, 'no answer');
  }
  /** The end of a weapon item. Empty: wait swap_ms, then restore the saved weapon with `$WEAP` and `$AMMO`.
   *  Death: nothing now (compile's revive re-empties the pickup slot); `onRevive`
   *  re-equips slot 0 behind the revive burst, since the trigger slot after `$SPAWN` is unproven. */
  end(why) {
    const h = this.host, held = this._held; if (!held) return;
    this._held = null;
    if (why === 'death' && PU_LOST_AT_DEATH) { this._reequip = true; h.show('puLost', { name: held.name, color: held.color, at: h.now() }); h.log(`powerup: ${held.name} lost at the death`, 'li'); h.save(); return; }   // HUD QA R2-17: the DOWN screen says so
    const b = held.back || { slot: 0, mag: this._counts(0)[0], res: this._counts(0)[1] };
    h.log(`powerup: ${held.name} over (${why}), slot ${b.slot} returns after ${h.switchWindowMs()}ms at ${b.mag}/${b.res}`, 'li');
    // F400 decision 2: the empty switch-back plays the full card too, naming the player's own weapon on the ACTIVE tile;
    // `going` keeps the heavy's name/colour on the STOWING tile past this call, since `_held` is already gone above.
    this._switchCard(held.slot, b.slot, { name: held.name, color: held.color, weapon_id: held.weapon_id, charges: 0 });
    this._backPending = { slot: b.slot, mag: b.mag, res: b.res, at: h.now(), readyAt: h.now() + h.switchWindowMs(), equipped: false, tries: 0 };
    const pl = h.player, bw = pl && pl.loadout && pl.loadout.weapons && pl.loadout.weapons[b.slot];
    const br = bw && h.weaponRow(bw.weapon_id);   // the slot going back, not `weaponName`: the trigger is still on the heavy until the delayed equip
    this._back = { name: held.name, to: bw ? (br && br.name ? br.name : String(bw.weapon_id).replace(/_/g, ' ')).toUpperCase() : h.weaponName, at: h.now() };
    h.save();
  }
  /** Death: a weapon item's charges are lost, and the overshield is gone. */
  onDeath(inRevive = false) {
    if (this._held) this.end('death');
    if (this._backPending?.equipped === false) this._reequip = true;   // death before the delayed return still needs slot 0 behind the revive burst
    // The revive burst's pool `$PSET` (A15.3) lands before its `$SPAWN` at the preset max; an older bundle has none, so the
    // max goes back now, or the `$SPAWN` would refill the shield to the raised one. X10: from `_revive` the restore
    // belongs to the life the revive is about to start, so its one retry is not refused as "the game moved on".
    const h = this.host, fr = h.frames, pool = fr && Array.isArray(fr.pset_pool) && fr.pset_pool.length;
    if (this._overshield && !pool) this._osRestore('death', inRevive ? (h.lifeSeq || 0) + 1 : h.lifeSeq);
    this._overshield = null; this._back = null; this._osProtectUntil = 0; this._backPending = null;
  }
  /** `_revive`, before its burst (not a self-hit revive, F438 r4: a self-kill never happened, so it loses no pickup): a
   *  live respawn retires a held item, the overshield and a delayed empty switch-back as a death does. */
  onReviveStart() { if (this._overshield || this._held || this._backPending?.equipped === false) this.onDeath(true); }
  /** `_revive`, after its burst: an item still held (an operator respawn of a LIVE player skips `_death`) is lost the same
   *  way, and slot 0 is re-equipped with its head `$WEAP` and the burst's own `$AMMO,0,…` (a safe re-equip). */
  onRevive(burst) {
    const h = this.host;
    h.show('puLost', null);   // HUD QA R2-17: the DOWN screen's ITEM LOST line belongs to the life that ended
    if (this._held) { this._held = null; this._reequip = true; }
    if (!this._reequip) return;
    this._reequip = false;
    const fr = h.frames;
    const row = (burst || []).find(f => typeof f === 'string' && f.startsWith('$AMMO,0,')) || ((fr && fr.spawn) || []).find(f => f.startsWith('$AMMO,0,'));
    const t = row ? row.split(',') : null;
    if (t) this._equip(0, +t[2] || 0, +t[3] || 0, 'powerup: slot 0 re-equipped after the revive');
    h.save();
  }
  /** F438 r4 (and F416 r2, after a re-sent burst): the held heavy keeps its charges (the burst's own row carried them,
   *  `burstWithHeld`). A heavy that was on the trigger goes back on it, as the reconcile re-arm does (F436). The `$SPAWN`
   *  refills the loadout weapons and puts the gun on slot 0: accepted for loadout weapons, since a self-kill costs nothing
   *  and the refill is the gun's own. `held` is the item the caller built the burst from. */
  keepHeld(held) {
    const h = this.host;
    h.acctWrote(held.slot, held.left, PU_RESERVE); h.setPrev(held.slot, held.left, PU_RESERVE);
    if (held.trig === held.slot && this._headWeap(held.slot)) this._equip(held.slot, held.left, PU_RESERVE, `F438 r4: ${held.name} back on the trigger after the self-hit revive`);
    else held.trig = 0;
    h.save();
  }
  /** The stun restore's `$AMMO` rows: a pickup slot (in `pu`) is restored to the held heavy's count as it is NOW, 0/0 for
   *  one not held, never the snapshot's (`burstWithHeld`). */
  restoreRows(rows, pu) { const held = this._held; return burstWithHeld(rows, held && pu.has(held.slot) ? held : null, pu); }
  /** The reconcile disarm's extra row: a held heavy's slot at 0 too (no shots count while we reconcile). */
  disarmRows() { const held = this._held; return held ? [`$AMMO,${held.slot},0,0,1,*`] : []; }
  /** The reconcile re-arm. F436 (bench 2026-10-02): a heavy ON the trigger is re-equipped in the re-arm itself: an
   *  `$AMMO` row never moves the trigger, and after the disarm the gun was on slot 0 while the engine kept slot 2, so the
   *  first pull fired the loadout weapon. Then `reequip` is true and `ammo` is the loadout rows, written first in the
   *  heavy's own equip (`reequipInRearm`). Otherwise `ammo` is the spawn rows with a held heavy's zero row swapped for its
   *  charges, in the SAME write (`burstWithHeld`): a separate restore opened the echo window after the zero had gone
   *  out, so the gun's echo of 0 read as the charges fired and ended the item (polish H1). The held slot's account is
   *  booked here; the engine books every other row. */
  reconcileRearm(rows) {
    const h = this.host, held = this._held, sw = h.switching;
    const reequip = !!(held && held.trig === held.slot && this._headWeap(held.slot) && !(sw && !sw.pu));   // an ALT swap in flight is the player's choice: leave the trigger to it
    if (reequip) return { reequip, ammo: rows.filter(f => !f.startsWith(`$AMMO,${held.slot},`)) };
    if (held) { h.acctWrote(held.slot, held.left, PU_RESERVE); h.setMag(held.slot, held.left); }
    return { reequip, ammo: burstWithHeld(rows, held) };
  }
  /** The re-arm write when `reconcileRearm` said `reequip`: the loadout rows, then the heavy's `$WEAP` + `$AMMO`, in one write. */
  reequipInRearm(ammo) { const held = this._held; this._equip(held.slot, held.left, PU_RESERVE, `reconcile: re-arm + ${held.name} back on the trigger`, ammo); }
  /** After the re-arm (A56 r2 M1): the re-arm is not the switch-back, so a pending one is sent again with a fresh budget. */
  afterRearm() { const bp = this._backPending; if (bp) { bp.tries = 0; this._backResend(this.host.now(), 'after the reconcile'); } }
  /** F416 r4: does the gun's `$QUERY` weapon state match a held heavy? Before the first pull (F436) it may read the
   *  heavy's own slot or the switch-back slot; both match, at that slot's live count only (r2: or the bench P0, slot 2
   *  at 2/1, would close as landed). */
  heavyMatches(gs, gm) {
    const hv = this._held, hl = this.host.liveAmmo()[gs], hc = hl ? hl[0] : hv && gs === hv.slot ? hv.left : null;
    return !!hv && (gs === hv.slot || (hv.back && gs === hv.back.slot)) && hc != null && gm === hc;
  }

  // ---- the overshield (Tony, 2026-09-24) ----
  /** The `$PSET` the gun holds now (the life's `pset_pool` take, else the head's), with its shield max (token 5) set to
   *  `max`. Everything else is the frame verbatim: the bench raised ONLY the shield max (70 -> 145) and the gun kept
   *  firing and cycling ALT. `_write` puts the team back behind it (F206). Null when there is no `$PSET` to copy.
   *  The engine's F341 pool repair writes it too. */
  psetWithShieldMax(max) {
    const fr = this.host.frames, head = (fr && fr.head) || [];
    const f = this._psetNow || head.find(x => typeof x === 'string' && x.startsWith('$PSET,'));
    if (!f) return null;
    const t = f.split(','); if (t.length < 6) return null;
    t[5] = String(max);
    return t.join(',');
  }
  /** F438 r4, the self-hit revive: the `$PSET` with the overshield's raised max, or null when no overshield is up. */
  overshieldPset() { const o = this._overshield; return o ? this.psetWithShieldMax(o.max) : null; }
  /** The spawn-protection pair the bundle compiles (`$TMP` t8 = -100, then `spawn_protect_off`), or null for an older
   *  bundle without it (then the grant simply goes without protection). */
  _osProtectFrames() {
    const f = this.host.frames; if (!f || typeof f.spawn_protect_off !== 'string' || !f.spawn_protect_off.startsWith('$TMP,')) return null;
    const on = [...(f.spawn || []), ...(f.revive || [])].find(x => typeof x === 'string' && /^\$TMP,(?:[^,]*,){7}-100,/.test(x)) || '$TMP,,,,,,,,-100,,,,*';
    return { on, off: f.spawn_protect_off };
  }
  /** tick(): the grant's protection ends OVERSHIELD_GRANT_MS after it. A death or a new life owns `$TMP` itself (`$SPAWN`
   *  clears it), so only a live, linked gun gets the write; a lost link waits for the relink. */
  _osTick(now) {
    const h = this.host;
    if (!this._osProtectUntil || now < this._osProtectUntil) return;
    if (!h.alive || h.phase !== 'live') { this._osProtectUntil = 0; return; }
    if (!h.bleUp) return;
    const pf = this._osProtectFrames(); this._osProtectUntil = 0;
    if (!pf || h.armPending) return;   // a life still owed its own protection end keeps it
    const life = h.lifeSeq;
    const r = h.write([pf.off], 'overshield: grant window over, spawn protection off');
    // Polish H2, as `_armLife` does: a false resolve re-arms the end, so the next tick retries it on a live link. A lost
    // write would otherwise leave the player unhittable for the life.
    Promise.resolve(r).then(ok => {
      if (ok !== false || h.lifeSeq !== life || !h.alive || h.phase !== 'live' || h.ended || this._osProtectUntil) return;
      if ((this._osOffTries = (this._osOffTries || 0) + 1) > OVERSHIELD_OFF_RETRIES) {
        h.setWriteLost(life);   // r3: as `_writeLife` does, so the pool reads `write_lost` and MC offers RESYNC GUN
        h.log(`*** overshield: spawn protection off failed ${OVERSHIELD_OFF_RETRIES + 1} times -- the player may be unhittable (RESYNC GUN) ***`, 'le'); return;
      }
      h.log(`overshield: spawn protection off was lost, retrying (${this._osOffTries}/${OVERSHIELD_OFF_RETRIES})`, 'le');
      this._osProtectUntil = h.now();
    });
  }
  /** The overshield (Tony, 2026-09-24): one burst of spawn protection on, the `$PSET` with its shield max raised to the
   *  preset max plus `amount` (bench: the gun clamps a shield past the `$PSET` max back within 0.75 s, and holds it once
   *  the max is raised), and the absolute `$LIFE` at the pools as they stand now. A hit in flight is overwritten and a hit
   *  inside the window does nothing: "the damage is ignored". Protection ends OVERSHIELD_GRANT_MS later (`_osTick`). It
   *  stacks beside a weapon item. */
  grantShield(id, item, now) {
    const h = this.host;
    const amount = Number.isFinite(+item.amount) && +item.amount > 0 ? +item.amount : OVERSHIELD_AMOUNT;
    const base = this._overshield ? this._overshield.base : h.shield;
    const to = h.shield + amount, max = Math.max(h.maxShield, to);
    const pset = this.psetWithShieldMax(max), pf = h.armPending ? null : this._osProtectFrames();   // a life still protected keeps its own
    h.write([...(pf ? [pf.on] : []), ...(pset ? [pset] : []), `$LIFE,${h.hp},${h.armor},${to},2,*`],
      `powerup: ${item.name} +${amount} (shield ${h.shield} -> ${to}, max ${h.maxShield} -> ${max}${pf ? ', protected' : ''})`);
    if (pf) { this._osProtectUntil = now + OVERSHIELD_GRANT_MS; this._osOffTries = 0; }
    h.setShield(to);   // S29: and no refill may be in flight under it
    const name = String(item.name || 'OVERSHIELD').toUpperCase();
    this._overshield = { station: id, base, amount: to - base, name, color: item.color || null, at: now, max, hp: h.hp, armor: h.armor };   // hp/armor: the pools the grant wrote (R2-21: its echo is no pickup)
    this._grant = { kind: 'overshield', name, color: item.color || null, at: now };
    // F400 decision 5: the Overshield is not a weapon (no switch card); it plays the SAME clip the ordinary S29 recharge
    // plays on its first grant (`shield_charging`, N102 in the golden bundle -- F349: its own loud tail already reads as
    // "shields full", and Tony's decision there was no separate "Shields Online" voice). The Visor's shield bar (the
    // existing gain animation, shieldmeter.js `.svos`) already grows from `state().powerup.overshield` on the next render.
    h.announceStatus('shield_charging');
    return true;
  }
  /** The overshield is over: the `$PSET` back at the preset shield max, so no later spawn or refill fills to the raised one. */
  _osRestore(why, life = this.host.lifeSeq) {
    const h = this.host, pset = this.psetWithShieldMax(h.maxShield);
    if (pset) h.writeMust([pset], `overshield over (${why}): shield max back to ${h.maxShield}`, () => h.lifeSeq === life && !this._overshield, true);   // polish M2 (a `$PSET` carries no counts: safe to repeat after a shot or a hit)
  }
  /** `$HP` arrived: the pools a `$HIR` moved have been reported (polish M1: a `$HIR` after it holds the overshield grant). */
  onHp() { this._hpAt = this.host.now(); }
  /** `$HP`: the overshield is gone once the shield is back to where it started (a stale pre-grant frame excepted). */
  onShieldFrame(shield) {
    const o = this._overshield; if (!o) return;
    const h = this.host;
    if (h.now() - o.at < OVERSHIELD_GRANT_MS) return;   // inside the grant window a lower `$HP` is a pre-grant hit reported late: ignored
    if (shield < o.base || (shield <= o.base && h.now() - o.at > OVERSHIELD_ECHO_MS)) { this._overshield = null; h.log(`powerup: ${o.name} gone`, 'li'); this._osRestore('drained'); }
  }

  // ---- read accessors (the engine, the golden-trace runner and tests read these; nothing writes the fields directly) ----
  /** The held weapon item, or null. A setter exists for tests that stage a held item without a grant. */
  get held() { return this._held; }
  set held(v) { this._held = v; }
  /** The overshield record, or null. A setter exists for tests. */
  get overshield() { return this._overshield; }
  set overshield(v) { this._overshield = v; }
  /** The grant card ({name, color, kind, at, replaced?}), or null. A setter exists for tests. */
  get grant() { return this._grant; }
  set grant(v) { this._grant = v; }
  get back() { return this._back; }
  get backPending() { return this._backPending; }
  get protectUntil() { return this._osProtectUntil; }
  get psetNow() { return this._psetNow; }
  get spawnCard() { return this._spawnCard; }
  get swapCard() { return this._swapCard; }
}
