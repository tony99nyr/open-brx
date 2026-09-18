// The gun picker's list: what a player sees while the phone says SCANNING FOR TAGGERS.
//
// F258 (bench 2026-09-18, Pixel 5). The picker listed every Bluetooth device in the room in signal
// order: two televisions, a QLED, a Hatch Rest, bare MAC addresses, and the two real taggers at
// positions 7 and 12. It was also untappable. The list was rebuilt and re-sorted on every scan hit
// (`allowDuplicates: true`, about two dozen devices), so four samples a second apart gave 12 rows,
// 12 rows, 2 rows, then 5 rows in a different order. The row under a finger was replaced between
// touchstart and touchend, so no tap and no scroll ever landed.
//
// The raw scan stays unfiltered. `BrxLink.scan()` deliberately sends no service filter, because
// Android misses taggers whose service UUID rides in the scan response (bench 2026-08-25, the
// comment is on that line). So the ranking and the churn control belong here, in the picker.
//
// Two rules hold this file together:
//  - ORDER IS STABLE. A row sits at its rank, and inside a rank in first-seen order. A live RSSI
//    reading never decides a position. A signal that moves must not move a row.
//  - A SCAN HIT NEVER PAINTS. `observe()` only records, and raises `dirty` when the visible list
//    changed. The caller paints on a timer (`PAINT_MS`), so the list holds still under a finger.
import { NUS, splitAdvert } from './brxlink.js';

/** Rank values. A lower rank sorts first; `RANK_OTHER` is the "other devices" fold. */
export const RANK_ASSIGNED = 0, RANK_TAGGER = 1, RANK_NAMED = 2, RANK_OTHER = 3;

/** The picker paints at most this often. At 2 Hz the list reads as live and a tap gets 500 ms of
 *  still rows, which is longer than the 100-200 ms a touchstart-to-touchend takes. */
export const PAINT_MS = 500;

// A tagger advertises `<sticker>-XXXX` (the shape `splitAdvert` parses) or the stock name `Tactix2`.
// This is a NAME heuristic and nothing more: it ranks a likely tagger above a television when the
// advert carried no service UUID. The service UUID (RANK_TAGGER) is the fact; this is the guess.
const TAGGERISH = /-[0-9A-Fa-f]{4}$|^tactix/i;

/** True when this advert carried the Nordic UART service, which every BRX tagger runs. */
function hasNus(uuids) {
  return (uuids || []).some(u => String(u).toLowerCase() === NUS);
}

export class GunPicker {
  /** `assigned`: the gun this phone is meant to carry, by advertised name. */
  constructor({ assigned = null } = {}) {
    this._rows = new Map();   // deviceId → row, held in first-seen order
    this._seq = 0;
    this._assigned = null;
    this.dirty = false;
    this.setAssigned(assigned);
  }

  /** Tells the picker which gun to offer first. Mission Control gives the phone `player.gun_id` in
   *  its assign, and the engine persists both that player and the gun this phone last linked, so a
   *  phone that has been kitted once in this session knows the answer before the scan opens. A
   *  first-ever boot does not: there is no such fact yet, and the list simply ranks by service UUID. */
  setAssigned(name) {
    const v = name ? String(name).trim().toUpperCase() : null;
    if (v === this._assigned) return;
    this._assigned = v;
    for (const r of this._rows.values()) this._rank(r);
    this.dirty = true;
  }
  get assigned() { return this._assigned; }

  /** Forgets every device. The picker starts again from an empty list on each SET MY GUN. */
  clear() { this._rows.clear(); this._seq = 0; this.dirty = true; }
  get size() { return this._rows.size; }
  get(deviceId) { return this._rows.get(deviceId) || null; }

  /** Records one scan hit: `{deviceId, name, rssi, uuids}`. It sorts nothing and paints nothing. It
   *  raises `dirty` only when what the player would SEE changed. */
  observe(hit) {
    const id = hit && hit.deviceId;
    if (!id) return;
    const name = hit.name || '';
    let row = this._rows.get(id);
    if (!row) {
      // A nameless advert is a utility beacon, not a tagger: its whole identity is one service UUID
      // (beacon.js), and 25 of them were in the room on the bench. It earns a row only when it
      // carries the Nordic UART service, because on Android a tagger's name and its UUID ride in
      // different packets and the UUID can arrive first.
      if (!name && !hasNus(hit.uuids)) return;
      const s = splitAdvert(name, id);
      row = { deviceId: id, name, basename: s.basename, tail: s.tail, rssi: hit.rssi != null ? hit.rssi : null,
              uuids: hit.uuids || [], seq: this._seq++, rank: RANK_OTHER };
      this._rows.set(id, row);
      this._rank(row);
      this.dirty = true;
      return;
    }
    if (name && name !== row.name) {
      const s = splitAdvert(name, id);
      row.name = name; row.basename = s.basename; row.tail = s.tail;
      this.dirty = true;
    }
    if (hit.uuids && hit.uuids.length) row.uuids = hit.uuids;
    if (hit.rssi != null && hit.rssi !== row.rssi) { row.rssi = hit.rssi; this.dirty = true; }
    this._rank(row);
  }

  /** A rank only ever IMPROVES. Android splits an advert in two: the name arrives in the advertising
   *  packet and the service UUID in the scan response, so a tagger is often seen as a plain device
   *  first and promoted a moment later. A promotion lifts the row, which is the whole point. A
   *  demotion would drop a row for a reason no player could see, so there is none. */
  _rank(row) {
    const want = this._matchesAssigned(row) ? RANK_ASSIGNED
      : hasNus(row.uuids) ? RANK_TAGGER
      : TAGGERISH.test(row.name) ? RANK_NAMED
      : RANK_OTHER;
    if (want < row.rank) { row.rank = want; this.dirty = true; }
  }

  /** Mission Control's `gun_id` is the gun's own `$NAME`, which is the sticker on the headset. The
   *  advert adds a `-XXXX` tail, so the sticker matches the row's basename; a remembered gun matches
   *  the whole advertised name. Accept either. */
  _matchesAssigned(row) {
    if (!this._assigned || !row.name) return false;
    return row.name.toUpperCase() === this._assigned || String(row.basename || '').toUpperCase() === this._assigned;
  }

  /** The list to paint, and `dirty` back to false. Rank first, then first-seen order, never RSSI.
   *  `other: true` marks the rows the HUD puts behind the "other devices" fold. */
  list() {
    this.dirty = false;
    return [...this._rows.values()]
      .sort((a, b) => a.rank - b.rank || a.seq - b.seq)
      .map(r => ({ deviceId: r.deviceId, name: r.name, basename: r.basename, tail: r.tail,
                   rssi: r.rssi, rank: r.rank, other: r.rank === RANK_OTHER }));
  }
}
