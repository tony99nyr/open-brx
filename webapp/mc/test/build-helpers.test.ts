// F411 BUILD lane's pure helpers (src/screens/build/helpers.ts). These live under `test/`, not
// `src/screens/build/`, because `vitest.config.ts` (a PLAY-lane file this lane does not own) only
// collects `test/**/*.test.{ts,tsx}` — a file under `src/screens/build/*.test.ts` is invisible to
// `npx vitest run` no matter how it is invoked (checked directly: passing the path as a CLI filter
// still reports "No test files found", since `include` is fixed at collection time, not overridden by
// an explicit path). Reported in the BUILD lane's final report as the smallest sensible fix for that
// gap — the source stays in `src/screens/build/`, only the spec moves.
import { describe, expect, it } from 'vitest';
import type { GamePiece } from '../src/api/contract.gen';
import {
  classesOf, draftOf, guardSpawnDelay, isDirty, onlyIdsForClass, proposeCopyName, spawnBuiltinValue,
} from '../src/screens/build/helpers';

describe('guardSpawnDelay (Designer.tsx\'s own 1-2s wedge guard, kept byte-for-byte)', () => {
  it('stepping up from 0 skips 1-2 and lands on 3', () => {
    expect(guardSpawnDelay(1, 0)).toBe(3);
    expect(guardSpawnDelay(2, 0)).toBe(3);
  });
  it('stepping down from 3 skips 1-2 and lands on 0', () => {
    expect(guardSpawnDelay(2, 3)).toBe(0);
    expect(guardSpawnDelay(1, 3)).toBe(0);
  });
  it('leaves every other value alone', () => {
    expect(guardSpawnDelay(0, 3)).toBe(0);
    expect(guardSpawnDelay(3, 0)).toBe(3);
    expect(guardSpawnDelay(15, 10)).toBe(15);
  });
});

describe('isDirty', () => {
  const base = { name: 'STANDARD', note: 'the default', value: { max_hp: 45 } };
  it('is false against an identical draft', () => {
    expect(isDirty(draftOf({ ...base }), draftOf({ ...base }))).toBe(false);
  });
  it('catches a name change', () => {
    expect(isDirty({ ...base, name: 'CUSTOM' }, base)).toBe(true);
  });
  it('catches a note change', () => {
    expect(isDirty({ ...base, note: 'edited' }, base)).toBe(true);
  });
  it('catches a value change nested inside the object', () => {
    expect(isDirty({ ...base, value: { max_hp: 46 } }, base)).toBe(true);
  });
});

describe('proposeCopyName', () => {
  it('appends COPY', () => {
    expect(proposeCopyName('STANDARD')).toBe('STANDARD COPY');
  });
  it('never exceeds the 24-char piece name limit', () => {
    const proposed = proposeCopyName('A VERY LONG NAME INDEED');
    expect(proposed.length).toBeLessThanOrEqual(24);
    expect(proposed.endsWith('COPY')).toBe(true);
  });
});

describe('classesOf / onlyIdsForClass (games-presets.md §14 class-shortcut snapshot)', () => {
  const cat = [
    { id: 'assault_rifle', role: 'assault' },
    { id: 'burst_rifle', role: 'assault' },
    { id: 'sniper_rifle', role: 'marksman', tags: ['marksman', 'sniper'] },
    { id: 'melee', role: 'melee' },
  ];
  it('lists the distinct roles present, sorted', () => {
    expect(classesOf(cat)).toEqual(['assault', 'marksman', 'melee']);
  });
  it('a class shortcut fills only_ids from every item of that role', () => {
    expect(onlyIdsForClass(cat, 'assault')).toEqual(['assault_rifle', 'burst_rifle']);
  });
  it('is a snapshot: a weapon added to the catalogue after the fact is not retroactively included', () => {
    const before = onlyIdsForClass(cat, 'assault');
    const grown = [...cat, { id: 'force_rifle', role: 'assault' }];
    expect(onlyIdsForClass(grown, 'assault')).not.toEqual(before);   // the LIVE catalogue would include it...
    expect(before).toEqual(['assault_rifle', 'burst_rifle']);        // ...but the snapshot already taken does not
  });
});

describe('spawnBuiltinValue', () => {
  const builtins = [
    { piece_id: 'builtin:spawn:auto', kind: 'spawn', builtin: true, name: 'AUTO', note: '', post_mvp: false, created_t: 0, updated_t: 0,
      value: { type: 'auto', delay_s: 15, protect_s: 0, weapon_delay_ms: 500 } },
    { piece_id: 'builtin:spawn:station', kind: 'spawn', builtin: true, name: 'STATION', note: '', post_mvp: false, created_t: 0, updated_t: 0,
      value: { type: 'scanner', delay_s: 10, station_protect_s: 2, gate: 'trigger' } },
  ] as unknown as GamePiece[];

  it('finds the AUTO builtin by its value.type, not its id slug', () => {
    expect(spawnBuiltinValue(builtins, 'auto')).toEqual({ type: 'auto', delay_s: 15, protect_s: 0, weapon_delay_ms: 500 });
  });
  it('finds the STATION builtin (value.type is "scanner", brief §3)', () => {
    expect(spawnBuiltinValue(builtins, 'scanner')).toEqual({ type: 'scanner', delay_s: 10, station_protect_s: 2, gate: 'trigger' });
  });
  it('returns null for a type with no builtin (never throws)', () => {
    expect(spawnBuiltinValue(builtins, 'none')).toBeNull();
  });
});
