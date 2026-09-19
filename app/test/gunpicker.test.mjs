// F258 (bench 2026-09-18, Pixel 5). The gun picker listed every Bluetooth device in the room in signal
// order -- two televisions, a QLED, a Hatch Rest, bare MAC addresses -- with the two real taggers at
// positions 7 and 12, and it re-sorted on every scan hit, so no tap ever landed on a row.
//
// These are the rules the fix depends on. The room below is the bench's own room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GunPicker, RANK_ASSIGNED, RANK_TAGGER, RANK_NAMED, RANK_OTHER, COALESCE_MS, PAINT_MS, isHeadset } from '../src/gunpicker.js';
import { NUS } from '../src/brxlink.js';

const tagger = (name, id, rssi) => ({ deviceId: id, name, rssi, uuids: [NUS] });
const thing = (name, id, rssi) => ({ deviceId: id, name, rssi, uuids: ['0000fe9f-0000-1000-8000-00805f9b34fb'] });

/** The bench's room, in the order the adverts arrived: the loud noise first, the guns last. */
function room(p) {
  p.observe(thing('Samsung Q80 TV', 'tv1', -41));
  p.observe(thing('[LG] webOS TV', 'tv2', -44));
  p.observe(thing('Hatch Rest', 'hatch', -48));
  p.observe(thing('WL_SCU', 'scu', -52));
  p.observe(thing('4C:11:AE:90:22:01', 'mac1', -55));
  p.observe(tagger('ALPHA-FE30', 'gun1', -70));
  p.observe(tagger('BRAVO-9498', 'gun2', -74));
  return p;
}
const ids = p => p.list().map(r => r.deviceId);

test('a tagger ranks above a television, however loud the television is', () => {
  const p = room(new GunPicker());
  assert.deepEqual(ids(p).slice(0, 2), ['gun1', 'gun2'], 'the two taggers must be the first two rows');
  assert.equal(p.get('gun1').rank, RANK_TAGGER);
  assert.equal(p.get('tv1').rank, RANK_OTHER);
});

test('everything that is not a tagger goes behind the fold', () => {
  const p = room(new GunPicker());
  const list = p.list();
  assert.deepEqual(list.filter(r => !r.other).map(r => r.deviceId), ['gun1', 'gun2']);
  assert.equal(list.filter(r => r.other).length, 5);
});

test('the list does not reorder when the signal readings change', () => {
  const p = room(new GunPicker());
  const before = ids(p);
  // The guns walk away and a television gets louder: every RSSI moves, some by 30 dB.
  p.observe(tagger('ALPHA-FE30', 'gun1', -91));
  p.observe(tagger('BRAVO-9498', 'gun2', -33));
  p.observe(thing('Samsung Q80 TV', 'tv1', -20));
  p.observe(thing('Hatch Rest', 'hatch', -99));
  assert.deepEqual(ids(p), before, 'a signal reading moved a row');
  assert.equal(p.get('gun1').rssi, -91, 'the reading itself must still update in place');
});

test('a row keeps its first-seen place inside its rank, whatever order the adverts repeat in', () => {
  const p = room(new GunPicker());
  const before = ids(p);
  for (let i = 0; i < 20; i++) {                    // `allowDuplicates: true` repeats every device, forever
    p.observe(thing('Hatch Rest', 'hatch', -48 - i));
    p.observe(tagger('BRAVO-9498', 'gun2', -74 + i));
    p.observe(thing('Samsung Q80 TV', 'tv1', -41));
    p.observe(tagger('ALPHA-FE30', 'gun1', -70));
  }
  assert.deepEqual(ids(p), before);
});

test('the assigned gun is offered first, ahead of the other tagger', () => {
  const p = room(new GunPicker({ assigned: 'BRAVO' }));   // MC gives the phone the sticker, not the advert
  assert.equal(ids(p)[0], 'gun2', 'the gun MC assigned to this player must be the first row');
  assert.equal(p.get('gun2').rank, RANK_ASSIGNED);
  assert.equal(p.get('gun1').rank, RANK_TAGGER);
});

test('the assigned gun also matches the whole advertised name (a remembered gun)', () => {
  const p = room(new GunPicker({ assigned: 'ALPHA-FE30' }));
  assert.equal(ids(p)[0], 'gun1');
});

test('naming the assigned gun after the scan opened re-ranks the list', () => {
  const p = room(new GunPicker());
  assert.equal(ids(p)[0], 'gun1');
  p.setAssigned('BRAVO-9498');
  assert.equal(ids(p)[0], 'gun2');
});

test('a tagger-shaped name outranks a television even with no service UUID in the advert', () => {
  const p = new GunPicker();
  p.observe(thing('Samsung Q80 TV', 'tv1', -41));
  p.observe({ deviceId: 'gun1', name: 'ALPHA-FE30', rssi: -80, uuids: [] });
  p.observe({ deviceId: 'stock', name: 'Tactix2', rssi: -85, uuids: [] });
  assert.deepEqual(ids(p), ['gun1', 'stock', 'tv1']);
  assert.equal(p.get('gun1').rank, RANK_NAMED);
});

test('a rank only improves: the Android scan response promotes a gun, it never demotes one', () => {
  const p = new GunPicker();
  p.observe({ deviceId: 'gun1', name: 'ALPHA-FE30', rssi: -70, uuids: [] });   // the advertising packet
  assert.equal(p.get('gun1').rank, RANK_NAMED);
  p.observe({ deviceId: 'gun1', name: '', rssi: -70, uuids: [NUS] });          // the scan response
  assert.equal(p.get('gun1').rank, RANK_TAGGER);
  p.observe({ deviceId: 'gun1', name: 'ALPHA-FE30', rssi: -70, uuids: [] });   // ...and back again
  assert.equal(p.get('gun1').rank, RANK_TAGGER, 'an advert with no UUID at all must not demote a known tagger');
  p.observe({ deviceId: 'gun1', name: 'ALPHA-FE30', rssi: -70, uuids: ['0000fe9f-0000-1000-8000-00805f9b34fb'] });
  assert.equal(p.get('gun1').rank, RANK_TAGGER, 'an advert carrying some OTHER service must not demote a known tagger');
});

test('a nameless advert is a utility beacon, not a row -- unless it carries the Nordic UART service', () => {
  const p = new GunPicker();
  p.observe({ deviceId: 'beacon', name: '', rssi: -50, uuids: ['1234abcd-0000-1000-8000-00805f9b34fb'] });
  assert.equal(p.size, 0);
  p.observe({ deviceId: 'gun1', name: '', rssi: -70, uuids: [NUS] });
  assert.deepEqual(ids(p), ['gun1']);
});

test('a scan hit raises `dirty` only when the player would SEE a change', () => {
  const p = room(new GunPicker());
  p.list();                                                    // paint: dirty clears
  assert.equal(p.dirty, false);
  p.observe(tagger('ALPHA-FE30', 'gun1', -70));                // the same reading again
  assert.equal(p.dirty, false, 'an unchanged advert must not ask for a paint');
  p.observe(tagger('ALPHA-FE30', 'gun1', -69));                // the reading moved
  assert.equal(p.dirty, true);
  p.list();
  p.observe(tagger('CHARLIE-E20D', 'gun3', -80));                // a new device
  assert.equal(p.dirty, true);
});

test('names and tails come from the advert, split the way BrxLink splits them', () => {
  const p = new GunPicker();
  p.observe(tagger('ALPHA-fe30', 'gun1', -70));
  const [row] = p.list();
  assert.equal(row.basename, 'ALPHA');
  assert.equal(row.tail, 'FE30');
});

// Game day 2026-09-19: the BRX IR headset advertises as BC-HEADSET. A phone that connects to it can take
// it from the gun, so the picker must never list it.
test('the IR headset (BC-HEADSET...) is never listed, in any case', () => {
  const p = room(new GunPicker());
  p.observe(tagger('BC-HEADSET', 'hs1', -40));
  p.observe(thing('bc-headset-7A21', 'hs2', -40));
  p.observe({ deviceId: 'hs3', name: 'Bc-Headset', rssi: -40, uuids: [] });
  assert.equal(p.get('hs1'), null); assert.equal(p.get('hs2'), null); assert.equal(p.get('hs3'), null);
  assert.ok(!ids(p).some(id => id.startsWith('hs')));
  assert.ok(isHeadset('bc-HEADSET') && !isHeadset('ALPHA-FE30'));
  p.observe({ deviceId: 'hs4', name: '', rssi: -40, uuids: [NUS] });   // nameless first, the name arrives later
  p.observe({ deviceId: 'hs4', name: 'BC-HEADSET', rssi: -40, uuids: [] });
  assert.equal(p.get('hs4'), null, 'a row that turns out to be the headset is removed');
});

// Game day 2026-09-19 (the Pixel 5 froze in SET MY GUN): a busy room floods the scan callback. With
// coalescing on, a device already listed costs one recorded hit per COALESCE_MS, and a paint every PAINT_MS.
test('a flood of 2000 hits in 1 s from 50 devices records a bounded number and paints at most 2 times', () => {
  let t = 1000;
  const p = new GunPicker({ now: () => t, coalesceMs: COALESCE_MS });
  let paints = 0, lastPaint = t;
  for (let i = 0; i < 2000; i++) {
    t = 1000 + Math.floor(i / 2);                     // 2000 results across 1000 ms
    const d = i % 50;
    p.observe(d % 2 ? tagger(`GUN${d}-${String(1000 + d).slice(-4)}`, 'd' + d, -50 - (i % 30)) : thing('TV ' + d, 'd' + d, -40 - (i % 30)));
    if (t - lastPaint >= PAINT_MS && p.dirty) { p.list(); paints++; lastPaint = t; }   // app.js's paint timer
  }
  assert.equal(p.size, 50);
  assert.ok(p.kept <= 50 * 3, `recorded ${p.kept} of 2000 hits`);
  assert.ok(paints <= 2, `painted ${paints} times in 1 s`);
});

test('coalescing never holds back a name or a service UUID', () => {
  let t = 0;
  const p = new GunPicker({ now: () => t, coalesceMs: 500 });
  p.observe({ deviceId: 'g', name: 'ALPHA-FE30', rssi: -60, uuids: [] });
  t = 10; p.observe({ deviceId: 'g', name: '', rssi: -60, uuids: [NUS] });   // the scan response, 10 ms later
  assert.equal(p.get('g').rank, RANK_TAGGER);
  t = 20; p.observe({ deviceId: 'g', name: 'ALPHA-FE30', rssi: -90, uuids: [] });
  assert.equal(p.get('g').rssi, -60, 'a bare signal reading inside the window is coalesced');
  t = 600; p.observe({ deviceId: 'g', name: 'ALPHA-FE30', rssi: -90, uuids: [] });
  assert.equal(p.get('g').rssi, -90, 'and recorded once the window has passed');
});
