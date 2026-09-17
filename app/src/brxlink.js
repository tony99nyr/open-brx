// BrxLink — the seed's hardware-proven BLE plumbing (node.md §7), behind a thin interface.
// Init exactly once; connect-with-retry (bounded on the first connect, then FOREVER with backoff in
// every phase, retired by a generation token); continuous
// low-latency scan picker; hardened reassembler; 20-byte chunked writes with pacing; per-device
// write queue; auto-reconnect that hands the engine a resync opportunity.
import { BleClient, BluetoothLe, textToDataView, dataViewToText, dataViewToHexString } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

export const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Bench 2026-09-17 (match 592e444eff, Pixel 5): the spawn write left the phone over 62 s, one chunk every
// 6-11 s, and the player could not shoot for a minute. Android logcat showed each native write done in
// 1-2 ms, and the JS ring stamped each chunk within 40 ms of its native call. The delay was the ANSWER:
// the plugin's reply reached JS 1 s late at T-10 and 11 s late by T+100 s, on the same native-to-JS
// channel as the low-latency beacon scan (57 results/s, the busiest scan of the day). The app skipped
// about 600 frames every 10 s until the scan restart dropped the backlog.
//  - BleClient's own queue made every call wait for the previous call's answer, so a slow answer to a
//    scan stop or an isEnabled() also held the gun write. Gun writes now call the plugin directly: the
//    bridge delivers calls in call order, and the native side runs them in that order.
//  - The write loop waits for an answer for at most WRITE_ACK_CAP_MS, then goes on at the normal pacing.
//    A healthy answer still holds the next chunk, so the GATT write permit is kept as before.
export const WRITE_ACK_CAP_MS = 50;

/** Writes one chunk to the gun's NUS RX characteristic through the plugin itself, not BleClient's queue.
 *  Native builds take a hex string (what BleClient sends); the web build takes the DataView. */
export function directWriter(plugin = BluetoothLe, platform = () => Capacitor.getPlatform()) {
  return (deviceId, dv) => plugin.writeWithoutResponse({
    deviceId, service: NUS, characteristic: RX, value: platform() === 'web' ? dv : dataViewToHexString(dv),
  });
}

// F210: docs/manual/dev.md's headset note — "the headset must be linked or the gun will connect,
// answer a quick $PING, then drop within seconds and echo nothing to config. After a gun-initiated
// $DISCONNECT,*, back off at least 5 s before reconnecting." A gun with no headset linked repeats
// this forever, and `_connectWithRetry`'s own backoff only grows on a FAILED `ble.connect()` call —
// a connect that SUCCEEDS and then drops seconds later never fails, so a single flap reconnects at
// once (as any ordinary drop should), but a REPEATING flap now backs off instead of spinning as fast
// as the hardware allows.
const FLAP_MS = 5000;
// Bench 2026-09-17: a flat 5 s wait still reconnected every 5-6 s forever, and the tagger says "phone
// connected" on every connect. Each further quick drop now waits longer: 5 s, 15 s, 30 s, then 60 s.
// The steps are multiples of `flapMs`, so a test can shrink the whole schedule with one option.
const FLAP_STEPS = [1, 3, 6, 12];
/** How long to wait after the `streak`th quick drop in a row (streak 2 is the first wait). */
export function flapDelay(streak, flapMs = FLAP_MS) {
  return flapMs * FLAP_STEPS[Math.min(Math.max(streak - 2, 0), FLAP_STEPS.length - 1)];
}

// Bench 2026-09-17 (match e6cbe0ae09): RELINK GUN in a LIVE match took the phone off the gun for 34 s. The
// phone log: the forced disconnect at once, then three plugin connects that each ran out the plugin's
// default 10 s timeout, with a growing retry backoff (443, 857, 1939 ms) between them, then a connect that
// took under a second. A relink now waits at most RELINK_DISCONNECT_CAP_MS for the disconnect, gives each
// connect RELINK_CONNECT_MS (a connect to a gun that is there took about 1 s on the bench), and waits only
// RELINK_GAP_MS between attempts. After RELINK_ATTEMPTS it ends, and the normal reconnect loop takes over.
const RELINK_DISCONNECT_CAP_MS = 2000;
const RELINK_CONNECT_MS = 5000;
const RELINK_GAP_MS = 250;
const RELINK_ATTEMPTS = 9;

/** Split an advert name "<sticker>-<tail>" → {name, basename, tail}. Never uses the BLE deviceId. */
export function splitAdvert(name, deviceId) {
  const m = /^(.*)-([0-9A-Fa-f]{4})$/.exec(name || '');
  if (m) return { name, basename: m[1], tail: m[2].toUpperCase() };
  const tail = String(deviceId || '').replace(/[^0-9a-fA-F]/g, '').slice(-4).toUpperCase() || '0000';
  return { name: name || 'Tactix', basename: name || 'Tactix', tail };
}

/** Hardened reassembler: splits on both '*' and '$' boundaries (merged notifies). */
export class Reassembler {
  constructor() { this.buf = ''; }
  pump(text) {
    this.buf += text; const out = [];
    for (;;) {
      const s = this.buf.indexOf('$');
      if (s < 0) { this.buf = ''; break; }
      if (s > 0) this.buf = this.buf.slice(s);
      const star = this.buf.indexOf('*', 1), nd = this.buf.indexOf('$', 1);
      let end;
      if (star >= 0 && (nd < 0 || star < nd)) end = star + 1;
      else if (nd >= 0) end = nd;
      else break;
      const f = this.buf.slice(0, end).trim(); this.buf = this.buf.slice(end);
      if (f) out.push(f);
    }
    return out;
  }
}

export class BrxLink {
  constructor({ ble = BleClient, log = () => {}, onFrame = () => {}, onDrop = () => {}, onUp = () => {},
                unbounded = () => false, chunkGapMs = 8, frameGapMs = 18, now = () => Date.now(), flapMs = FLAP_MS,
                onFlap = () => {}, onRelink = () => {}, relinkConnectMs = RELINK_CONNECT_MS, relinkAttempts = RELINK_ATTEMPTS,
                relinkGapMs = RELINK_GAP_MS, relinkDisconnectCapMs = RELINK_DISCONNECT_CAP_MS,
                writeChunk = null, ackCapMs = WRITE_ACK_CAP_MS } = {}) {
    // The real plugin gets the direct path; an injected test double keeps its own writeWithoutResponse.
    this.writeChunk = writeChunk || (ble === BleClient ? directWriter() : (id, dv) => ble.writeWithoutResponse(id, NUS, RX, dv));
    this.ackCapMs = ackCapMs;
    this.lateAcks = 0;     // chunks whose answer took longer than ackCapMs (diagnostics)
    this.onRelink = onRelink;
    this.relinkConnectMs = relinkConnectMs; this.relinkAttempts = relinkAttempts; this.relinkGapMs = relinkGapMs; this.relinkDisconnectCapMs = relinkDisconnectCapMs;
    this.ble = ble; this.log = log; this.onFrame = onFrame; this.onDrop = onDrop; this.onUp = onUp; this.onFlap = onFlap;
    this.unbounded = unbounded; this.chunkGapMs = chunkGapMs; this.frameGapMs = frameGapMs;
    this.now = now; this.flapMs = flapMs;
    this.deviceId = null; this.advert = null; this.connected = false; this.retries = 0; this.lastReason = null;
    this._init = null; this._q = Promise.resolve(); this._scanning = false; this._re = new Reassembler();
    this._scanOp = Promise.resolve(); this._scanTok = 0;   // scan start/stop run one at a time, in call order
    this._linkSeq = 0;     // bumps per native connect; a retired link's disconnect callback is ignored (relink)
    this._relinking = false;
    this.frames = [];      // last frames in/out (diagnostics)
    // Every connect()/disconnect() bumps the generation. A retry loop carries the generation it
    // started in and exits the moment it goes stale, so a loop chasing an abandoned gun can never
    // outlive its device — nor hold `_reconnecting` and block the next gun's reconnect.
    this._gen = 0;
    this._wake = null;     // resolves the pending backoff early (the TAP TO RECONNECT pill)
    this._upAt = 0;        // F210: when this device last connected successfully
    this._flapStreak = 0;  // F210: consecutive connect-then-quick-drop cycles for THIS device
    this._flapNextAt = 0;  // when the current flap wait ends (0 when no wait is running)
    this._stableTimer = null;   // clears the flap count once a link has stayed up for `flapMs`
  }
  /** `{count, next_retry_at}` while the gun keeps dropping the link (2+ quick drops in a row), else null.
   *  `next_retry_at` is this device's clock (`now()`), or null when no wait is running. */
  get flapping() {
    if (this._flapStreak < 2) return null;
    return { count: this._flapStreak, next_retry_at: this._flapNextAt || null };
  }
  _setFlap(streak, nextAt = 0) {
    const was = JSON.stringify(this.flapping);
    this._flapStreak = streak; this._flapNextAt = nextAt;
    if (JSON.stringify(this.flapping) !== was) { try { this.onFlap(this.flapping); } catch (_) { /* a listener must not break the link */ } }
  }
  /** A user action (RECONNECT NOW, RELINK, picking a gun) starts the backoff again from the start. */
  resetFlap() { this._setFlap(0); }
  /** True from a RELINK press until the link is back up or the relink gives up. The HUD disables RELINK GUN meanwhile. */
  get relinking() { return this._relinking; }
  _setRelinking(v) {
    if (this._relinking === v) return;
    this._relinking = v;
    try { this.onRelink(v); } catch (_) { /* a listener must not break the link */ }
  }
  _armStable() {
    clearTimeout(this._stableTimer);
    const seq = this._linkSeq;
    const t = this._stableTimer = setTimeout(() => {
      this._stableTimer = null;
      if (this.connected && seq === this._linkSeq && this._flapStreak) { this._log('gun link held: flap count cleared', 'li'); this._setFlap(0); }
    }, this.flapMs);
    if (t && typeof t.unref === 'function') t.unref();   // node tests: a held link must not keep the process open
  }
  ensureInit() { return (this._init ||= this.ble.initialize({ androidNeverForLocation: true })); }

  /** Continuous scan; calls onHit({deviceId, name, rssi, uuids}) for every advert until stop().
   *  scanMode 2 = low latency (the gun picker and the match-time beacon watch, scanwatch.js), 1 = balanced.
   *  Nameless adverts pass only when they carry a service UUID: utility items advertise no name on Android
   *  (the device name is not settable per app), their whole identity is the UUID (beacon.js).
   *  `onRaw()` runs for EVERY result the plugin delivers, before any filter: each one crossed the
   *  native-to-JS bridge that gun notifications share, so a flood guard must count them all (scanwatch.js). */
  async scan(onHit, { scanMode = 2, onRaw = null } = {}) {
    if (this._scanning) throw new Error('a scan is already open');
    this._scanning = true; const tok = ++this._scanTok;   // claim the radio before the first await
    return this._scanSerial(async () => {
      try {
        await this.ensureInit();
        await this.ble.requestLEScan({ allowDuplicates: true, scanMode }, res => {   // no service filter: Android misses taggers whose UUID rides in the scan response (bench 2026-08-25); the app filters by name instead
          if (onRaw) onRaw();
          const d = res.device || {}; if (!d.deviceId) return;
          const name = d.name || res.localName || '';
          const uuids = Array.isArray(res.uuids) ? res.uuids : [];
          if (!name && !uuids.length) return;
          onHit({ deviceId: d.deviceId, name, rssi: res.rssi, uuids, txPower: res.txPower });
        });
      } catch (e) { if (tok === this._scanTok) this._scanning = false; throw e; }   // a refused start is not an open scan
    });
  }
  /** Playtest 2026-09-13: `_scanning` was cleared when a stop RESOLVED, so a slow stop that overlapped a
   *  newer scan cleared the flag under it and the "already open" guard let a third scan in. Now the flag
   *  is the latest intent, set synchronously, and the native calls run strictly in call order. */
  stopScan() {
    this._scanning = false; this._scanTok++;
    return this._scanSerial(async () => { try { await this.ble.stopLEScan(); } catch (_) { /* ignore */ } });
  }
  get scanning() { return this._scanning; }
  _scanSerial(fn) { const p = this._scanOp.then(fn, fn); this._scanOp = p.catch(() => {}); return p; }

  // F211: adapter-off detection. `@capacitor-community/bluetooth-le` reports `true` on web, so the demo
  // and the desktop rig see an always-on adapter and behave exactly as before.
  /** Reports whether Bluetooth is on right now. */
  async isEnabled() { try { return !!(await this.ble.isEnabled()); } catch (_) { return true; } }
  /** Calls `cb(on)` whenever the adapter turns on or off; returns a stop function. A plugin build too
   *  old to carry the notification (or the web shim) yields a no-op stop, so a call site never has to
   *  branch on plugin version. */
  async watchEnabled(cb) {
    if (typeof this.ble.startEnabledNotifications !== 'function') return () => {};
    await this.ble.startEnabledNotifications(v => cb(!!v));
    return () => { try { this.ble.stopEnabledNotifications(); } catch (_) { /* ignore */ } };
  }
  /** Android only: show the system "turn on Bluetooth?" prompt. Resolves false where the plugin has no
   *  such call (iOS, web) so the HUD can decide whether to show the button at all. */
  async requestEnable() {
    if (typeof this.ble.requestEnable !== 'function') return false;
    try { await this.ble.requestEnable(); return true; } catch (e) { this._log('bluetooth enable request: ' + (e && e.message || e), 'le'); return false; }
  }
  /** Android only: open the OS Bluetooth settings page. */
  async openBluetoothSettings() {
    if (typeof this.ble.openBluetoothSettings !== 'function') return false;
    try { await this.ble.openBluetoothSettings(); return true; } catch (e) { this._log('open bluetooth settings: ' + (e && e.message || e), 'le'); return false; }
  }

  _log(m, cls) { this.log(m, cls); }
  _note(dir, f) { this.frames.push({ t: Date.now(), dir, f }); if (this.frames.length > 60) this.frames.shift(); }

  async connect(deviceId, advertName) {
    await this.ensureInit();
    this._gen++;                       // retires any loop still chasing the previous gun
    if (this._wake) this._wake();      // ...and WAKE it, or it sleeps out its backoff still holding
                                       // `_reconnecting`, which blocks the new gun's reconnect entirely
    this.advert = splitAdvert(advertName, deviceId);
    if (!await this._connectWithRetry(deviceId, 5, false, this._gen)) return false;   // a newer connect won (bench 2026-09-17): claiming the link here ran onUp with the gun down
    this.deviceId = deviceId; this.connected = true; this.retries = 0;
    this._upAt = this.now(); this._setFlap(0);   // F210: a freshly picked gun starts with a clean flap count
    this._armStable();
    this.onUp(this.advert);
  }
  /** `relink` (a user RELINK): a bounded plugin connect timeout, a short fixed gap instead of the growing
   *  backoff, and `attempts` is a hard limit even when `unbounded()` (armed/live) would retry forever. */
  async _connectWithRetry(id, attempts, forever = false, gen = this._gen, relink = false) {
    let last;
    for (let i = 1; ; i++) {
      if (gen !== this._gen) { this._log('reconnect abandoned — a different gun was selected', 'li'); return false; }
      const t0 = this.now();
      try {
        const seq = ++this._linkSeq;
        await this.ble.connect(id, () => { if (seq === this._linkSeq) this._dropped(); }, relink ? { timeout: this.relinkConnectMs } : undefined);
        if (gen !== this._gen) {                       // the gun came back AFTER we moved on: let it go,
          try { await this.ble.disconnect(id); } catch (_) { /* ignore */ }   // or two devices feed the engine
          return false;
        }
        await this.ble.startNotifications(id, NUS, TX, v => this._notify(v));
        return true;
      } catch (e) {
        last = e; this.retries = i;
        const keep = relink ? i < attempts : forever || this.unbounded() || i < attempts;
        if (!keep) throw last;
        const delay = relink ? this.relinkGapMs : Math.min(10000, 500 * 2 ** Math.min(i - 1, 5)) * (0.8 + 0.4 * Math.random());
        // the time the attempt took and the plugin's reason: a 10 s "Connection timeout." and a fast GATT error need different fixes
        this._log(`connect ${i}${!relink && (forever || this.unbounded()) ? '' : '/' + attempts} failed after ${this.now() - t0} ms (${e && e.message || e}) — retrying in ${Math.round(delay)} ms`, 'le');
        await this._waitOrWake(delay);
      }
    }
  }

  /** Backoff that a TAP can cut short — otherwise the reconnect button just waits out the sleep. */
  _waitOrWake(ms) {
    return new Promise(res => {
      const t = setTimeout(() => { this._wake = null; res(); }, ms);
      this._wake = () => { clearTimeout(t); this._wake = null; res(); };
    });
  }

  /** The user asked to reconnect NOW: skip the remaining backoff, or start a loop if none is running. */
  retryNow() {
    this.resetFlap();
    if (this._wake) { this._log('reconnect: retrying now', 'li'); this._wake(); return; }
    if (this.deviceId && !this.connected) this._reconnect();
  }
  /** RELINK GUN (playtest 2026-09-13): on a link the app believed was up, `retryNow()` did nothing, so the
   *  button was inert exactly when the operator needed it. Now a live link is really cycled: release the
   *  GATT link, then take the normal drop path, so the forever-reconnect loop reconnects and `onUp` runs
   *  the engine's relink (it re-writes the head only in the phases where that is safe, never mid-match). */
  /*  Bench 2026-09-17: the relink now runs its OWN reconnect, at once and bounded (see RELINK_CONNECT_MS), not
   *  the drop path's retry and flap backoff. It resolves true when the link is back, false when it gave up. A
   *  press while a relink runs is ignored (`relinking`), and a press on a link that is already down stays
   *  `retryNow()`. */
  async relink() {
    const id = this.deviceId; if (!id) return false;
    if (this._relinking) { this._log('relink: already relinking, press ignored', 'li'); return false; }
    this.resetFlap();
    if (!this.connected) { this.retryNow(); return true; }
    const gen = this._gen;
    this._setRelinking(true);
    try {
      this._log('relink: forcing a disconnect and a fresh connect', 'li');
      this._linkSeq++;                   // this link's own disconnect callback must not run the drop path a second time
      const t0 = this.now();
      let cap = null;
      const released = await Promise.race([
        this.ble.disconnect(id).then(() => true, () => true),   // best-effort
        new Promise(res => { cap = setTimeout(() => res(false), this.relinkDisconnectCapMs); }),
      ]);
      clearTimeout(cap);
      this._log(released ? `relink: gun released in ${this.now() - t0} ms` : `relink: no disconnect confirm in ${this.relinkDisconnectCapMs} ms, connecting anyway`, 'li');
      if (this.deviceId !== id || gen !== this._gen || !this.connected) return false;   // a new gun was picked, or it already dropped
      this._markDown();
      this._reconnecting = true; this._reconnectGen = gen;   // one loop per gun: a RECONNECT tap now cannot start a second one
      let ok = false;
      try { ok = await this._connectWithRetry(id, this.relinkAttempts, false, gen, true); }
      catch (e) { this._log(`relink: no link after ${this.relinkAttempts} attempts (${e && e.message || e}), back to the normal reconnect loop`, 'le'); }
      finally { if (this._reconnectGen === gen) this._reconnecting = false; }
      if (gen !== this._gen || this.deviceId !== id) return false;
      if (ok) { this.connected = true; this._upAt = this.now(); this._armStable(); this._log(`reconnected (relink, ${this.now() - t0} ms)`, 'lk'); this.onUp(this.advert); return true; }
      this._reconnect();
      return false;
    } finally { this._setRelinking(false); }
  }
  _markDown() {
    this.connected = false; this._log(`*** gun disconnected ***`, 'le'); this.onDrop();
    clearTimeout(this._stableTimer); this._stableTimer = null;
  }
  _dropped() {
    this._markDown();
    if (!this.deviceId) return;
    // F210: a quick drop right after connecting is normal ONCE (a manual relink, a genuine radio blip)
    // and retries at once, same as always. A REPEATING quick drop (headset not linked: the gun connects,
    // answers a $PING, then drops itself within seconds — forever) now backs off instead of reconnecting
    // as fast as the hardware allows, which used to spin the radio and re-run onUp()'s relink side effects
    // every cycle with no way out short of linking the headset.
    const flapped = this._upAt && (this.now() - this._upAt) < this.flapMs;
    const streak = flapped ? this._flapStreak + 1 : 0;
    if (streak >= 2) {
      const gen = this._gen, wait = flapDelay(streak, this.flapMs);
      this._setFlap(streak, this.now() + wait);
      this._log(`gun keeps dropping seconds after connecting (${streak} in a row). Is the headset on? Backing off ${wait} ms`, 'li');
      this._waitOrWake(wait).then(() => {
        if (this._flapStreak) this._setFlap(this._flapStreak);   // the wait is over (or cut short): no retry time to show
        if (this.deviceId && gen === this._gen) this._reconnect();
      });
    } else { this._setFlap(streak); this._reconnect(); }
  }
  /** B4: the engine's link watchdog calls this when the gun has gone silent for too long while we still
   *  read as `connected` — the native disconnect callback this whole file otherwise depends on may never
   *  fire for a link that is merely bad rather than actually gone (marginal RF, a supervision timeout
   *  that hasn't tripped yet). Best-effort `disconnect()` first so the OS actually releases the stale
   *  GATT handle — some stacks reuse it silently on the very next `connect()` otherwise — then run the
   *  exact same path a real disconnect takes, so the engine, the HUD pill and MC's status all learn about
   *  it exactly once, and the forever-reconnect loop takes over from here. */
  noteStale() {
    if (!this.connected || !this.deviceId) return;
    const id = this.deviceId;
    this._log('*** gun link silent — forcing a reconnect ***', 'le');
    this.ble.disconnect(id).catch(() => { /* best-effort: let the OS release the stale GATT link */ });
    this._dropped();
  }
  async _reconnect() {
    if (this._reconnecting && this._reconnectGen === this._gen) return;   // one loop per gun; a second
    this._reconnectGen = this._gen;                  // would double-subscribe notifications
    this._reconnecting = true;
    // FOREVER, in every phase. It used to stop after 6 tries (~25 s) outside armed/live, which is
    // exactly how long a gun that is simply switched OFF takes to burn them — so a gun powered on a
    // minute later was never retried, the HUD blinked GUN DISCONNECTED indefinitely and the MC board
    // stayed blocked until someone found RECONNECT GUN in the debug panel (field 2026-09-01).
    // A gun that is off fails cheaply and the backoff caps at 10 s, so this costs ~6 attempts/min.
    const gen = this._gen;
    try {
      if (await this._connectWithRetry(this.deviceId, 0, true, gen) && gen === this._gen) {
        this.connected = true; this._upAt = this.now(); this._armStable(); this._log('reconnected', 'lk'); this.onUp(this.advert);
      }
    }
    catch (e) { this._log('reconnect stopped: ' + (e && e.message || e), 'le'); }
    finally { this._reconnecting = false; }
  }
  async disconnect() {
    this._gen++;                       // stop any forever-loop before it re-adopts this gun
    if (this._wake) this._wake();
    clearTimeout(this._stableTimer); this._stableTimer = null; this._setFlap(0);
    const id = this.deviceId; this.deviceId = null; this.connected = false;
    if (id) { try { await this.ble.disconnect(id); } catch (_) { /* ignore */ } }
  }
  _notify(value) { for (const f of this._re.pump(dataViewToText(value))) { this._note('rx', f); this.onFrame(f); } }

  /** Write frames verbatim, in order, chunked at 20 bytes with pacing; serialized per device. Each chunk
   *  waits for the plugin's answer for at most `ackCapMs` (see WRITE_ACK_CAP_MS). */
  write(frames) {
    const id = this.deviceId; if (!id) return Promise.resolve(false);
    const list = Array.isArray(frames) ? frames : [frames];
    this._q = this._q.then(async () => {
      let late = 0, chunks = 0;
      for (const frame of list) {
        this._note('tx', frame);
        for (let o = 0; o < frame.length; o += 20) {
          chunks++;
          if (!await this._sendChunk(id, textToDataView(frame.substr(o, 20)))) late++;
          if (frame.length > 20) await sleep(this.chunkGapMs);
        }
        await sleep(this.frameGapMs);
      }
      if (late) { this.lateAcks += late; this._log(`write answers slow: ${late} of ${chunks} chunk(s) past ${this.ackCapMs} ms, sent on without them`, 'le'); }
      return true;
    }).catch(e => { this._log('write err: ' + (e && e.message || e), 'le'); return false; });
    return this._q;
  }
  /** Sends one chunk. Resolves true when the plugin answered within `ackCapMs`, false when the cap ran out
   *  first. An error inside the cap rejects (the batch stops, as before); a later error is only logged. */
  _sendChunk(id, dv) {
    let sent;
    try { sent = Promise.resolve(this.writeChunk(id, dv)); } catch (e) { return Promise.reject(e); }
    return new Promise((resolve, reject) => {
      let done = false;
      const t = setTimeout(() => { done = true; resolve(false); }, this.ackCapMs);
      sent.then(() => { if (done) return; done = true; clearTimeout(t); resolve(true); },
        e => {
          if (!done) { done = true; clearTimeout(t); reject(e); return; }
          this._log('write err (after the answer cap): ' + (e && e.message || e), 'le');
        });
    });
  }
}
