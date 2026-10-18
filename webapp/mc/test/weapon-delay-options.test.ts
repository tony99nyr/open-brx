import { describe, expect, it } from 'vitest';
import { WEAPON_DELAY_MS_DEFAULT, WEAPON_DELAY_MS_OPTIONS } from '../src/api/contract.gen';
import { weaponDelayOptions } from '../src/screens/presets/editors';

describe('WEAPON DELAY picker', () => {
  it('offers exactly the generated legal values, labelled in seconds', () => {
    const opts = weaponDelayOptions();
    expect(opts.map(o => Number(o.value))).toEqual([...WEAPON_DELAY_MS_OPTIONS]);
    expect(opts.map(o => o.label)).toEqual(['0.5 S', '1 S', '1.5 S', '3 S']);
  });
  it('has the default among its options, so one option is always pressed', () => {
    expect(weaponDelayOptions().map(o => Number(o.value))).toContain(WEAPON_DELAY_MS_DEFAULT);
  });
});
