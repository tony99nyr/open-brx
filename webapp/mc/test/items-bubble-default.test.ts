// The ITEMS DEFAULT button shows the threshold that 0 resolves to. A phone powerup station resolves to
// PHONE_POWERUP_THRESHOLD_DBM (-55) on the server (state.py `_wire_threshold`) and on the phone
// (beacon.js `phoneStationThreshold`), so the console must not show the -74 of the other kinds. F383
// (Tony, 2026-09-27): a control (hill) station resolves to its own -75, not the -74 either, until the
// outdoor walk measures a real one.
import { describe, expect, it } from 'vitest';
import { bubbleDefault } from '../src/screens/Items';
import { PHONE_CONTROL_THRESHOLD_DBM, PHONE_POWERUP_THRESHOLD_DBM, PHONE_RESPAWN_THRESHOLD_DBM, PHONE_STATION_THRESHOLD_DBM } from '../src/api/contract.gen';

describe('bubbleDefault', () => {
  it('shows the powerup threshold for a phone powerup station', () => {
    expect(bubbleDefault('powerup', false)).toEqual({ label: `DEFAULT (${PHONE_POWERUP_THRESHOLD_DBM}, phone)`, start: PHONE_POWERUP_THRESHOLD_DBM });
    expect(PHONE_POWERUP_THRESHOLD_DBM).not.toBe(PHONE_STATION_THRESHOLD_DBM);
  });
  it('keeps the respawn and generic phone values', () => {
    expect(bubbleDefault('respawn', false).start).toBe(PHONE_RESPAWN_THRESHOLD_DBM);
    expect(bubbleDefault('extraction', false).start).toBe(PHONE_STATION_THRESHOLD_DBM);
  });
  it('shows the hill\'s own -75 default for a control station, on both a phone and a Stick', () => {
    expect(PHONE_CONTROL_THRESHOLD_DBM).toBe(-75);
    expect(bubbleDefault('control', false).start).toBe(PHONE_CONTROL_THRESHOLD_DBM);
    expect(bubbleDefault('control', true).start).toBe(PHONE_CONTROL_THRESHOLD_DBM);
  });
  it('starts a Stick powerup edit at the Stick\'s own -45 (F434), and a Stick respawn at -57', () => {
    expect(bubbleDefault('powerup', true).start).toBe(-45);
    expect(bubbleDefault('respawn', true).start).toBe(-57);
  });
});
