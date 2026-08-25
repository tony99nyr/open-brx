// BrxLink — the seed's hardware-proven BLE plumbing (node.md §7), behind a thin interface.
// Init exactly once; connect-with-retry (unbounded with backoff while armed/live); continuous
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

export class BrxLink {
  constructor({ ble = BleClient, log = () => {}, onFrame = () => {}, onDrop = () => {}, onUp = () => {},
                unbounded = () => false, chunkGapMs = 8, frameGapMs = 18 } = {}) {
    this.ble = ble; this.log = log; this.onFrame = onFrame; this.onDrop = onDrop; this.onUp = onUp;
    this.unbounded = unbounded; this.chunkGapMs = chunkGapMs; this.frameGapMs = frameGapMs;
    this.deviceId = null; this.advert = null; this.connected = false; this.retries = 0; this.lastReason = null;
    this._init = null; this._q = Promise.resolve(); this._scanning = false; this._re = new Reassembler();
    this.frames = [];      // last frames in/out (diagnostics)
  }
  ensureInit() { return (this._init ||= this.ble.initialize({ androidNeverForLocation: true })); }

  /** Continuous low-latency scan; calls onHit({deviceId, name, rssi}) for every advert until stop(). */
  async scan(onHit) {
    if (this._scanning) throw new Error('a scan is already open');
    await this.ensureInit(); this._scanning = true;
    await this.ble.requestLEScan({ allowDuplicates: true, scanMode: 2 }, res => {
      const d = res.device || {}; if (!d.deviceId) return;
      const name = d.name || res.localName || ''; if (!name) return;
      onHit({ deviceId: d.deviceId, name, rssi: res.rssi });
    });
  }
  async stopScan() { try { await this.ble.stopLEScan(); } catch (_) { /* ignore */ } this._scanning = false; }

  _log(m, cls) { this.log(m, cls); }
  _note(dir, f) { this.frames.push({ t: Date.now(), dir, f }); if (this.frames.length > 60) this.frames.shift(); }

  async connect(deviceId, advertName) {
    await this.ensureInit();
    this.advert = splitAdvert(advertName, deviceId);
    await this._connectWithRetry(deviceId, 5);
    this.deviceId = deviceId; this.connected = true; this.retries = 0;
    this.onUp(this.advert);
  }
  async _connectWithRetry(id, attempts) {
    let last;
    for (let i = 1; ; i++) {
      try {
        await this.ble.connect(id, () => this._dropped());
        await this.ble.startNotifications(id, NUS, TX, v => this._notify(v));
        return true;
      } catch (e) {
        last = e; this.retries = i;
        const more = this.unbounded() || i < attempts;
        if (!more) throw last;
        const delay = Math.min(10000, 500 * 2 ** Math.min(i - 1, 5)) * (0.8 + 0.4 * Math.random());
        this._log(`connect ${i}${this.unbounded() ? '' : '/' + attempts} failed — retrying in ${Math.round(delay)} ms`, 'le');
        await sleep(delay);
        if (!this.unbounded() && i >= attempts) throw last;
      }
    }
  }
  _dropped() {
    this.connected = false; this._log(`*** gun disconnected ***`, 'le'); this.onDrop();
    if (this.deviceId) this._reconnect();
  }
  async _reconnect() {
    try { await this._connectWithRetry(this.deviceId, 6); this.connected = true; this._log('reconnected', 'lk'); this.onUp(this.advert); }
    catch (e) { this._log('reconnect failed — tap Set my gun', 'le'); }
  }
  async disconnect() {
    const id = this.deviceId; this.deviceId = null; this.connected = false;
    if (id) { try { await this.ble.disconnect(id); } catch (_) { /* ignore */ } }
  }
  _notify(value) { for (const f of this._re.pump(dataViewToText(value))) { this._note('rx', f); this.onFrame(f); } }

  /** Write frames verbatim, in order, chunked at 20 bytes with pacing; serialized per device. */
  write(frames) {
    const id = this.deviceId; if (!id) return Promise.resolve(false);
    const list = Array.isArray(frames) ? frames : [frames];
    this._q = this._q.then(async () => {
      for (const frame of list) {
        this._note('tx', frame);
        for (let o = 0; o < frame.length; o += 20) {
          await this.ble.writeWithoutResponse(id, NUS, RX, textToDataView(frame.substr(o, 20)));
          if (frame.length > 20) await sleep(this.chunkGapMs);
        }
        await sleep(this.frameGapMs);
      }
      return true;
    }).catch(e => { this._log('write err: ' + (e && e.message || e), 'le'); return false; });
    return this._q;
  }
}
