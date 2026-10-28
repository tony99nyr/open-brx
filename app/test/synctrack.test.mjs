// Phone sync track (Tony 2026-10-25: "MC shows your phone not synced and you wonder wait im right here why"; gallery
// brx-phone-sync, not in the repo, option A). After the whistle the phone shows MC's own F596 stages, by MC's own rule
// (state.py `_sync_stage`): RECEIVED only once a status with nothing pending reached MC after the whistle, and it latches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncTrack, trackHtml, chipHtml, SYNC_STUCK_MS, MC_SILENT_MS } from '../src/hud/synctrack.js';

const END = 1_000_000;
const base = { bound: true, pending: 0, drainedAt: 0, connType: 'wifi', reach: 'lan', pendingChangedAt: END };
const at = (sync, now = END + 5000, endedAt = END) => syncTrack(sync, { ended: true, endedAt }, now);

test('no track before the whistle or without a sync reading', () => {
  assert.equal(syncTrack(base, { ended: false, endedAt: 0 }, END), null);
  assert.equal(syncTrack(null, { ended: true, endedAt: END }, END), null);
});

test('RECEIVED needs a zero-pending status sent after the whistle, and it latches through a later drop', () => {
  assert.equal(at({ ...base, drainedAt: END - 1 }).stage, 'linked', 'a drained status from before the whistle is not the receipt');
  const r = at({ ...base, drainedAt: END + 10 });
  assert.equal(r.stage, 'received'); assert.equal(r.tone, 'ok'); assert.equal(r.action, null);
  assert.equal(at({ ...base, bound: false, connType: 'cellular', drainedAt: END + 10 }).stage, 'received', 'MC latches it too');
  assert.equal(at({ ...base, pending: 1, drainedAt: END + 10 }).stage, 'sending', 'a fact queued after the receipt reopens it, as MC does');
});

test('SENDING N LEFT while bound with facts queued; mobile data says so; no progress for 2 min is stuck', () => {
  const s = at({ ...base, pending: 12 });
  assert.deepEqual([s.stage, s.n, s.via, s.reason, s.action], ['sending', 12, 'wifi', null, null]);
  const c = at({ ...base, pending: 12, connType: 'cellular', reach: 'backhaul' });
  assert.equal(c.via, 'cell'); assert.equal(c.reason, 'Over mobile data, slower than the Wi-Fi');
  const k = at({ ...base, pending: 12, pendingChangedAt: END }, END + SYNC_STUCK_MS);
  assert.equal(k.tone, 'warn'); assert.equal(k.reason, 'No progress for 2 min'); assert.equal(k.action, 'Walk back towards Mission Control');
  assert.equal(at({ ...base, pending: 12, pendingChangedAt: END }, END + SYNC_STUCK_MS - 1).reason, null, 'control: under 2 min');
  assert.equal(at({ ...base, pending: 12, pendingChangedAt: END - 600_000 }, END + 1000).reason, null, 'a count still since play is not stuck at the whistle');
  assert.equal(at({ ...base, pending: 12, pendingChangedAt: END, boundAt: END + 300_000 }, END + 301_000).reason, null, 'nor the moment it relinks');
});

test('NOT LINKED names the reason the phone can see, and one action', () => {
  const w = at({ ...base, bound: false, pending: 3, connType: 'wifi', unboundAt: END }, END + MC_SILENT_MS);
  assert.deepEqual([w.stage, w.reason, w.action], ['unlinked', 'Mission Control is not answering', 'Tell the host']);
  const r = at({ ...base, bound: false, pending: 3, connType: 'wifi', unboundAt: END + 1000 }, END + MC_SILENT_MS);
  assert.deepEqual([r.reason, r.action, r.tone], ['Reconnecting to Mission Control', null, 'mut'], 'a short drop on Wi-Fi is the reconnect backoff, not MC (review)');
  for (const connType of ['cellular', 'none', 'unknown', null]) {
    const n = at({ ...base, bound: false, pending: 3, connType });
    assert.deepEqual([n.reason, n.action], ['No Wi-Fi to Mission Control', 'Walk back towards Mission Control'], String(connType));
  }
  assert.equal(at({ ...base, bound: false, pending: 0 }).stage, 'unlinked', 'nothing queued but no receipt yet: MC still has no report');
});

test('the markup: three steps, sentence-case reason, no capitalised warning sentence', () => {
  const html = trackHtml(at({ ...base, pending: 12, pendingChangedAt: END }, END + SYNC_STUCK_MS));
  assert.match(html, /LINKED/); assert.match(html, /SENDING 12 LEFT/); assert.match(html, /RECEIVED/);
  assert.match(html, /No progress for 2 min/); assert.match(html, /Walk back towards Mission Control/);
  assert.doesNotMatch(html, /NO PROGRESS|WALK BACK/);
  assert.match(trackHtml(at({ ...base, bound: false, pending: 3 })), /NOT LINKED/);
  assert.equal(trackHtml(null), '');
  assert.match(chipHtml(at({ ...base, drainedAt: END + 10 })), /✓ RECEIVED/);
  assert.match(chipHtml(at({ ...base, pending: 4 })), /SENDING · 4 LEFT/);
  assert.equal(chipHtml(null), '');
});
