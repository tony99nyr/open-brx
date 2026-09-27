// F383 (Tony, 2026-09-27): a hill's default range is -75 dBm. The mock's demo phone must report the same per-kind
// platform default the server and the console use (`bubbleDefault`), not one -70 for every kind.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

describe('mock station armed at its platform default', () => {
  it('a defaulted control station reports -75', async () => {
    const b = new MockBackend();
    const view = await b.putStation('util-a1b2c3', { kind: 'control', team: 'any' });
    expect(view.report?.threshold).toBe(-75);
  });
});
