// The ITEMS DEFAULT button shows the threshold that 0 resolves to. A phone powerup station resolves to
// PHONE_POWERUP_THRESHOLD_DBM (-55) on the server (state.py `_wire_threshold`) and on the phone
// (beacon.js `phoneStationThreshold`), so the console must not show the -74 of the other kinds.
import { describe, expect, it } from 'vitest';
import { bubbleDefault } from '../src/screens/Items';
import { PHONE_POWERUP_THRESHOLD_DBM, PHONE_RESPAWN_THRESHOLD_DBM, PHONE_STATION_THRESHOLD_DBM } from '../src/api/contract.gen';

describe('bubbleDefault', () => {
  it('shows the powerup threshold for a phone powerup station', () => {
    expect(bubbleDefault('powerup', false)).toEqual({ label: `DEFAULT (${PHONE_POWERUP_THRESHOLD_DBM}, phone)`, start: PHONE_POWERUP_THRESHOLD_DBM });
    expect(PHONE_POWERUP_THRESHOLD_DBM).not.toBe(PHONE_STATION_THRESHOLD_DBM);
  });
  it('keeps the respawn and generic phone values', () => {
    expect(bubbleDefault('respawn', false).start).toBe(PHONE_RESPAWN_THRESHOLD_DBM);
    expect(bubbleDefault('control', false).start).toBe(PHONE_STATION_THRESHOLD_DBM);
  });
});
