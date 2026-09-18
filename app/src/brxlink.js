// BrxLink — the seed's hardware-proven BLE plumbing (node.md §7), behind a thin interface.
// Init exactly once; connect-with-retry (bounded on the first connect, then FOREVER with backoff in
// every phase, retired by a generation token); continuous
// low-latency scan picker; hardened reassembler; 20-byte chunked writes with pacing; per-device
// write queue; auto-reconnect that hands the engine a resync opportunity.
import { BleClient, textToDataView, dataViewToText } from '@capacitor-community/bluetooth-le';

export const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

/** Write pacing (docs/spec/transport-hardening.md §3). The gun reads ONE serial byte per main-loop pass out of a
 *  1 KB UART buffer (V4_30/V4_31 disassembly, 2026-09-18), so a long burst can outrun it and a lost `*` corrupts
 *  the next frame. `chunkGapMs`/`frameGapMs` are the pacing the field has run on since 2026-08; the BLOCK pause
 *  is a lever for the screamers sheet A7/A8: after every `blockFrames` frames of one write, sleep `blockPauseMs`. It ships OFF
 *  (blockFrames = 0): the evidence for a value is not measured yet, and a slower arm is a real cost at the line. */
export const WRITE_PACING = Object.freeze({ chunkGapMs: 8, frameGapMs: 18, blockFrames: 0, blockPauseMs: 0 });

export class BrxLink {
  constructor({ ble = BleClient, log = () => {}, onFrame = () => {}, onDrop = () => {}, onUp = () => {},
                unbounded = () => false, chunkGapMs = WRITE_PACING.chunkGapMs, frameGapMs = WRITE_PACING.frameGapMs,
                blockFrames = WRITE_PACING.blockFrames, blockPauseMs = WRITE_PACING.blockPauseMs } = {}) {
    this.ble = ble; this.log = log; this.onFrame = onFrame; this.onDrop = onDrop; this.onUp = onUp;
    this.unbounded = unbounded; this.chunkGapMs = chunkGapMs; this.frameGapMs = frameGapMs;
    this.blockFrames = blockFrames; this.blockPauseMs = blockPauseMs;
    this.deviceId = null; this.advert = null; this.connected = false; this.retries = 0; this.lastReason = null;
    this._init = null; this._q = Promise.resolve(); this._scanning = false; this._re = new Reassembler();
    this.frames = [];      // last frames in/out (diagnostics)
    // Every connect()/disconnect() bumps the generation. A retry loop carries the generation it
    // started in and exits the moment it goes stale, so a loop chasing an abandoned gun can never
    // outlive its device — nor hold `_reconnecting` and block the next gun's reconnect.
    this._gen = 0;
    this._wake = null;     // resolves the pending backoff early (the TAP TO RECONNECT pill)
  }
  ensureInit() { return (this._init ||= this.ble.initialize({ androidNeverForLocation: true })); }

  /** Continuous scan; calls onHit({deviceId, name, rssi, uuids}) for every advert until stop().
   *  scanMode 2 = low latency (the gun picker), 1 = balanced (the beacon watch that stays open all match).
   *  Nameless adverts pass only when they carry a service UUID: utility items advertise no name on Android
   *  (the device name is not settable per app), their whole identity is the UUID (beacon.js). */
  async scan(onHit, { scanMode = 2 } = {}) {
    if (this._scanning) throw new Error('a scan is already open');
    await this.ensureInit(); this._scanning = true;
    await this.ble.requestLEScan({ allowDuplicates: true, scanMode }, res => {   // no service filter: Android misses taggers whose UUID rides in the scan response (bench 2026-08-25); the app filters by name instead
      const d = res.device || {}; if (!d.deviceId) return;
      const name = d.name || res.localName || '';
      const uuids = Array.isArray(res.uuids) ? res.uuids : [];
      if (!name && !uuids.length) return;
      onHit({ deviceId: d.deviceId, name, rssi: res.rssi, uuids, txPower: res.txPower });
    });
  }
  async stopScan() { try { await this.ble.stopLEScan(); } catch (_) { /* ignore */ } this._scanning = false; }

  _log(m, cls) { this.log(m, cls); }
  _note(dir, f) { this.frames.push({ t: Date.now(), dir, f }); if (this.frames.length > 60) this.frames.shift(); }

  async connect(deviceId, advertName) {
    await this.ensureInit();
    this._gen++;                       // retires any loop still chasing the previous gun
    if (this._wake) this._wake();      // ...and WAKE it, or it sleeps out its backoff still holding
                                       // `_reconnecting`, which blocks the new gun's reconnect entirely
    this.advert = splitAdvert(advertName, deviceId);
    await this._connectWithRetry(deviceId, 5, false, this._gen);
    this.deviceId = deviceId; this.connected = true; this.retries = 0;
    this.onUp(this.advert);
  }
  async _connectWithRetry(id, attempts, forever = false, gen = this._gen) {
    let last;
    for (let i = 1; ; i++) {
      if (gen !== this._gen) { this._log('reconnect abandoned — a different gun was selected', 'li'); return false; }
      try {
        await this.ble.connect(id, () => this._dropped());
        if (gen !== this._gen) {                       // the gun came back AFTER we moved on: let it go,
          try { await this.ble.disconnect(id); } catch (_) { /* ignore */ }   // or two devices feed the engine
          return false;
        }
        await this.ble.startNotifications(id, NUS, TX, v => this._notify(v));
        return true;
      } catch (e) {
        last = e; this.retries = i;
        const keep = forever || this.unbounded() || i < attempts;
        if (!keep) throw last;
        const delay = Math.min(10000, 500 * 2 ** Math.min(i - 1, 5)) * (0.8 + 0.4 * Math.random());
        this._log(`connect ${i}${forever || this.unbounded() ? '' : '/' + attempts} failed — retrying in ${Math.round(delay)} ms`, 'le');
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
    if (this._wake) { this._log('reconnect: retrying now', 'li'); this._wake(); return; }
    if (this.deviceId && !this.connected) this._reconnect();
  }
  _dropped() {
    this.connected = false; this._log(`*** gun disconnected ***`, 'le'); this.onDrop();
    if (this.deviceId) this._reconnect();
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
        this.connected = true; this._log('reconnected', 'lk'); this.onUp(this.advert);
      }
    }
    catch (e) { this._log('reconnect stopped: ' + (e && e.message || e), 'le'); }
    finally { this._reconnecting = false; }
  }
  async disconnect() {
    this._gen++;                       // stop any forever-loop before it re-adopts this gun
    if (this._wake) this._wake();
    const id = this.deviceId; this.deviceId = null; this.connected = false;
    if (id) { try { await this.ble.disconnect(id); } catch (_) { /* ignore */ } }
  }
  _notify(value) { for (const f of this._re.pump(dataViewToText(value))) { this._note('rx', f); this.onFrame(f); } }

  /** Write frames verbatim, in order, chunked at 20 bytes with pacing; serialized per device. A block pause
   *  (`blockFrames` > 0) sleeps `blockPauseMs` after every `blockFrames` frames of ONE write, so the gun's
   *  one-byte-per-loop parser can drain its buffer mid-arm (transport-hardening.md §3; off by default). */
  write(frames) {
    const id = this.deviceId; if (!id) return Promise.resolve(false);
    const list = Array.isArray(frames) ? frames : [frames];
    this._q = this._q.then(async () => {
      let n = 0;
      for (const frame of list) {
        this._note('tx', frame);
        for (let o = 0; o < frame.length; o += 20) {
          await this.ble.writeWithoutResponse(id, NUS, RX, textToDataView(frame.substr(o, 20)));
          if (frame.length > 20) await sleep(this.chunkGapMs);
        }
        await sleep(this.frameGapMs);
        n++;
        if (this.blockFrames > 0 && this.blockPauseMs > 0 && n % this.blockFrames === 0 && n < list.length) await sleep(this.blockPauseMs);
      }
      return true;
    }).catch(e => { this._log('write err: ' + (e && e.message || e), 'le'); return false; });
    return this._q;
  }
}
