// F258 (bench 2026-09-18, Pixel 5). The gun picker listed every Bluetooth device in the room in signal
// order -- two televisions, a QLED, a Hatch Rest, bare MAC addresses -- with the two real taggers at
// positions 7 and 12, and it re-sorted on every scan hit, so no tap ever landed on a row.
//
// These are the rules the fix depends on. The room below is the bench's own room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GunPicker, RANK_ASSIGNED, RANK_TAGGER, RANK_NAMED, RANK_OTHER } from '../src/gunpicker.js';
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
