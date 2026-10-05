// A14: the `?mock` backend reads MC's operator-facing lines from the generated contract, never from a
// hand copy. `types.py` owns the words, `contract.gen.ts` carries them, and a literal copy in
// `mock/backend.ts` would drift the day the server's wording changes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as gen from '../src/api/contract.gen';

const OPERATOR_LINES = [
  'STALE_ACK_FAULT', 'ECHO_FAULT', 'POOL_FAULT', 'GUN_CONFIG_FAULT', 'GUN_FLAPPING_LINE', 'GUN_LINK_LOST',
  'STATION_REARM', 'STATION_BRING_BACK', 'STATION_ARMED_OLDER', 'STATION_NOT_ARMED', 'STATION_BATTERY_LOW',
] as const;

describe('A14 · the mock backend holds no hand copy of a server operator line', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/mock/backend.ts'), 'utf8');

  for (const name of OPERATOR_LINES) {
    it(`${name} is imported, not retyped`, () => {
      const text = gen[name];
      expect(typeof text, `contract.gen.ts must export ${name}`).toBe('string');
      expect(src.includes(text), `backend.ts retypes ${name} = ${JSON.stringify(text)}: import it from contract.gen`).toBe(false);
    });
  }
});
