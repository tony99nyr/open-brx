// F658 (the static hill): the `?mock` backend mirrors stations.py station_view. A hill that reports `follows` gets
// the note in place of ARMED FOR AN OLDER GAME / BRING IT BACK, and an amber line when its pace is not this game's.
import { describe, expect, it } from 'vitest';
import { STATION_ARMED_OLDER, STATION_BRING_BACK, STATION_FOLLOWS } from '../src/api/contract.gen';
import { MockBackend } from '../src/mock/backend';

type Views = { node_id: string; attention: string[] }[];
function hillAt(b: MockBackend, control: Record<string, unknown>, armedId = 3) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = b as any;
  m.config = { ...m.config, mode: 'koth', hill: { capture_s: 15 } };
  m.stations['util-hill'] = { assigned: { kind: 'control', team: 255, id: 3 }, armed: { game: m.gameNo - 1, at: 0, kind: 'control', team: 255, id: armedId }, arm_pending: true,
    report: { kind: 'control', station_id: 3, armed: true, control }, seen: Date.now() };
  return (m.stationViews() as Views).find(v => v.node_id === 'util-hill')!.attention;
}

describe('F658 the static hill in the mock station view', () => {
  it('an old hill still says bring it back and armed for an older game', () => {
    const lines = hillAt(new MockBackend(), { owner: 255, capture_s: 10 });
    // A86: the demo phones (0.1.x) send no scope, so the old-app line shows on any hill, following or not
    expect(lines.slice(0, 2)).toEqual([STATION_BRING_BACK, STATION_ARMED_OLDER]);
    expect(lines.length).toBe(3);
  });
  it('a following hill gets the note once, the pace line, and the old-app count', () => {
    const lines = hillAt(new MockBackend(), { owner: 255, capture_s: 10, net_cap: 3, follows: true });
    expect(lines.slice(0, 2)).toEqual([STATION_FOLLOWS, 'HILL SET FOR 10 S CAPTURE, THIS GAME USES 15 S: BRING IT INTO WI-FI TO UPDATE']);
    // the demo phones run 0.1.x, older than LIVE_BIT_MIN_APP: as stations.py, the hill says it cannot count them
    expect(lines.length).toBe(3);
    expect(lines.slice(2).every(l => /^\d+ PHONES? ON AN OLD APP: THIS HILL CANNOT COUNT (IT|THEM)$/.test(l))).toBe(true);
  });
  it('a following hill that missed a new id still needs it brought back', () => {
    const lines = hillAt(new MockBackend(), { owner: 255, follows: true }, 4);
    expect(lines.slice(0, 2)).toEqual([STATION_BRING_BACK, STATION_ARMED_OLDER]);
  });
});

describe('F658 the static powerup in the mock station view, as stations.py', () => {
  function powerupAt(b: MockBackend, powerup?: Record<string, unknown>, armedId = 4) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = b as any;
    m.stations['util-pu'] = { assigned: { kind: 'powerup', team: 255, id: 4 }, armed: { game: m.gameNo - 1, at: 0, kind: 'powerup', team: 255, id: armedId }, arm_pending: true,
      report: { kind: 'powerup', station_id: 4, armed: true, ...(powerup ? { powerup } : {}) }, seen: Date.now() };
    return (m.stationViews() as Views).find(v => v.node_id === 'util-pu')!.attention;
  }
  it('a powerup that does not follow still says bring it back and armed for an older game', () => {
    expect(powerupAt(new MockBackend()).slice(0, 2)).toEqual([STATION_BRING_BACK, STATION_ARMED_OLDER]);
  });
  it('a following powerup gets the note once, and one that missed a new id still needs it brought back', () => {
    const lines = powerupAt(new MockBackend(), { follows: true, game: 9 });
    expect(lines[0]).toBe(STATION_FOLLOWS);
    // the demo phones run 0.1.x (no A86 scope): as stations.py, the powerup says they cannot take its pickup
    expect(lines.length).toBe(2);
    expect(lines[1]).toMatch(/^\d+ PHONES? ON AN OLD APP: (IT|THEY) CANNOT TAKE THIS PICKUP$/);
    expect(powerupAt(new MockBackend(), { follows: true, game: 9 }, 5).slice(0, 2)).toEqual([STATION_BRING_BACK, STATION_ARMED_OLDER]);
  });
});

describe('A86 station ids in the mock, as stations.py', () => {
  it('refuses an id that shares id % 16, skips one in the auto id, and caps a match at 16 stations', async () => {
    const b = new MockBackend();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = b as any;
    for (const n of Object.keys(m.stations)) delete m.stations[n];
    m.stationIdOf = {};
    await b.putStation('util-a', { kind: 'control', team: 'any', id: 1 });
    await expect(b.putStation('util-b', { kind: 'respawn', team: 'any', id: 17 }))
      .rejects.toThrow('STATION ID 17 CLASHES WITH util-a (ID 1): PICK ANOTHER ID, OR CLEAR THE ID SO MC ASSIGNS ONE');
    await b.putStation('util-b', { kind: 'respawn', team: 'any', id: 18 });
    m.stationIdOf['util-c'] = 17;   // a remembered id that clashes is passed over
    await b.putStation('util-c', { kind: 'respawn', team: 'any' });
    expect(m.stations['util-c'].assigned.id % 16).not.toBe(1);
    expect(m.stations['util-c'].assigned.id % 16).not.toBe(2);
    for (let k = 0; k < 13; k++) await b.putStation(`util-x${k}`, { kind: 'respawn', team: 'any' });
    const bits = Object.values(m.stations).map((s: any) => s.assigned.id % 16);   // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(new Set(bits).size).toBe(16);
    await expect(b.putStation('util-17th', { kind: 'respawn', team: 'any' }))
      .rejects.toThrow('16 STATIONS IS THE MOST ONE MATCH TAKES: CLEAR A STATION BEFORE YOU ADD ANOTHER');
  });
});
