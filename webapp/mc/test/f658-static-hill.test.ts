// F658 (the static hill): the `?mock` backend mirrors stations.py station_view. A hill that reports `follows` gets
// the note in place of ARMED FOR AN OLDER GAME / BRING IT BACK, and an amber line when its pace is not this game's.
import { describe, expect, it } from 'vitest';
import { STATION_ARMED_OLDER, STATION_BRING_BACK, STATION_FOLLOWS } from '../src/api/contract.gen';
import { MockBackend } from '../src/mock/backend';

type Views = { node_id: string; attention: string[] }[];
function hillAt(b: MockBackend, control: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = b as any;
  m.config = { ...m.config, mode: 'koth', hill: { capture_s: 15 } };
  m.stations['util-hill'] = { assigned: { kind: 'control', team: 255, id: 3 }, armed: { game: m.gameNo - 1, at: 0 }, arm_pending: true,
    report: { kind: 'control', station_id: 3, armed: true, control }, seen: Date.now() };
  return (m.stationViews() as Views).find(v => v.node_id === 'util-hill')!.attention;
}

describe('F658 the static hill in the mock station view', () => {
  it('an old hill still says bring it back and armed for an older game', () => {
    const lines = hillAt(new MockBackend(), { owner: 255, capture_s: 10 });
    expect(lines).toEqual([STATION_BRING_BACK, STATION_ARMED_OLDER]);
  });
  it('a following hill gets the note once, and the pace line', () => {
    const lines = hillAt(new MockBackend(), { owner: 255, capture_s: 10, net_cap: 3, follows: true });
    expect(lines).toEqual([STATION_FOLLOWS, 'HILL SET FOR 10 S CAPTURE, THIS GAME USES 15 S: BRING IT INTO WI-FI TO UPDATE']);
  });
});
