// NTP-lite clock sync (contracts §7, net.md §7): burst of samples, keep min-rtt, then EWMA (α .2),
// reject rtt > 3× running median. synced() = a real round-trip sample fresher than SYNC_FRESH_MS.
import { SYNC_FRESH_MS } from './envelope.js';

export class Clock {
  constructor({ storage = null, key = 'brx.clock', now = () => Date.now(), burst = 5, alpha = 0.2, freshMs = SYNC_FRESH_MS } = {}) {
    this.storage = storage; this.key = key; this.now = now; this.burst = burst; this.alpha = alpha; this.freshMs = freshMs;
    this.offset = 0; this.lastSyncAt = 0; this.sampleCount = 0; this.rtts = []; this._burstBest = null; this.seededAt = 0;
    this._load();
  }
  _load() {
    try { const raw = this.storage?.getItem(this.key); if (!raw) return; const d = JSON.parse(raw); if (Number.isFinite(d.offset)) this.offset = d.offset; if (Number.isFinite(d.lastSyncAt)) this.lastSyncAt = d.lastSyncAt; if (Number.isInteger(d.sampleCount)) this.sampleCount = d.sampleCount; } catch (_) { /* ignore */ }
  }
  _save() { try { this.storage?.setItem(this.key, JSON.stringify({ offset: this.offset, lastSyncAt: this.lastSyncAt, sampleCount: this.sampleCount })); } catch (_) { /* ignore */ } }
  /** welcome.server_t: a zeroth estimate before any round trip (one-way latency error). Does not count as synced. */
  seed(serverT, now = this.now()) {
    if (!Number.isFinite(serverT)) return;
    if (this.sampleCount === 0) { this.offset = serverT - now; this.seededAt = now; this._save(); }
  }
  /** One time_req/time_res round trip. Returns the accepted offset or null if rejected as an outlier. */
  sample(tNode, serverT, now = this.now()) {
    const rtt = now - tNode;
    if (!Number.isFinite(rtt) || rtt < 0) return null;
    const off = serverT - (tNode + rtt / 2);
    const median = this._median();
    if (median != null && this.rtts.length >= 3 && rtt > 3 * median) { this.lastSyncAt = now; return null; } // buffered outlier: keep offset, but the link is alive
    this.rtts.push(rtt); if (this.rtts.length > 32) this.rtts.shift();
    this.sampleCount++;
    if (this.sampleCount <= this.burst) {
      if (this._burstBest == null || rtt < this._burstBest.rtt) this._burstBest = { rtt, off };
      this.offset = this._burstBest.off;
    } else {
      this.offset = this.offset + this.alpha * (off - this.offset);
    }
    this.lastSyncAt = now; this._save();
    return this.offset;
  }
  _median() { if (!this.rtts.length) return null; const s = [...this.rtts].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  /** Start a fresh burst (on every (re)connect). */
  newBurst() { this._burstBest = null; if (this.sampleCount >= this.burst) this.sampleCount = this.burst; }
  syncedNow(now = this.now()) { return Math.round(now + this.offset); }
  synced(now = this.now()) { return this.sampleCount > 0 && now - this.lastSyncAt <= this.freshMs; }
}
