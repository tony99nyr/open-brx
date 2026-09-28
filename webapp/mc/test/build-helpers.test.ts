// F411 BUILD lane's pure helpers (src/screens/presets/helpers.ts). These live under `test/`, not
// `src/screens/presets/`, because `vitest.config.ts` (a PLAY-lane file this lane does not own) only
// collects `test/**/*.test.{ts,tsx}` — a file under `src/screens/presets/*.test.ts` is invisible to
// `npx vitest run` no matter how it is invoked (checked directly: passing the path as a CLI filter
// still reports "No test files found", since `include` is fixed at collection time, not overridden by
// an explicit path). Reported in the BUILD lane's final report as the smallest sensible fix for that
// gap — the source stays in `src/screens/presets/`, only the spec moves.
import { describe, expect, it } from 'vitest';
import type { GamePiece } from '../src/api/contract.gen';
import {
  draftOf, guardSpawnDelay, idsForType, isDirty, proposeCopyName, slotNeedsFixedItem, spawnBuiltinValue,
  toggleTypeIds, typeChipState, typesOf,
} from '../src/screens/presets/helpers';

describe('guardSpawnDelay (QA-15: a typed 1 or 2 always snaps UP to 3, never down to 0)', () => {
  it('a typed 1 or 2 snaps up to 3, whatever the delay used to be', () => {
    expect(guardSpawnDelay(1)).toBe(3);
    expect(guardSpawnDelay(2)).toBe(3);
  });
  it('leaves every other value alone', () => {
    expect(guardSpawnDelay(0)).toBe(0);
    expect(guardSpawnDelay(3)).toBe(3);
    expect(guardSpawnDelay(15)).toBe(15);
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

describe('typesOf / idsForType (F411 type-toggle snapshot, replaces the old class shortcut)', () => {
  const cat = [
    { id: 'assault_rifle', types: ['rifle'] },
    { id: 'burst_rifle', types: ['rifle'] },
    { id: 'bolt_rifle', types: ['rifle', 'long'] },
    { id: 'melee', types: ['close'] },
  ];
  it('lists the types present, in WEAPON_TYPES order (not catalogue order)', () => {
    expect(typesOf(cat)).toEqual(['rifle', 'close', 'long']);
  });
  it('a type toggle fills only_ids from every item of that type', () => {
    expect(idsForType(cat, 'rifle')).toEqual(['assault_rifle', 'burst_rifle', 'bolt_rifle']);
  });
  it('is a snapshot: a weapon added to the catalogue after the fact is not retroactively included', () => {
    const before = idsForType(cat, 'rifle');
    const grown = [...cat, { id: 'force_rifle', types: ['rifle'] }];
    expect(idsForType(grown, 'rifle')).not.toEqual(before);   // the LIVE catalogue would include it...
    expect(before).toEqual(['assault_rifle', 'burst_rifle', 'bolt_rifle']);   // ...but the snapshot does not
  });
});

describe('typeChipState / toggleTypeIds (F411 follow-up 2026-09-28: the TYPE chip is a SHORTCUT over ' +
  'only_ids, not a rule -- no selection is stored anywhere but the plain id list)', () => {
  const cat = [
    { id: 'assault_rifle', types: ['rifle'] },
    { id: 'burst_rifle', types: ['rifle'] },
    { id: 'bolt_rifle', types: ['rifle', 'long'] },
    { id: 'amr', types: ['long'] },
    { id: 'shotgun', types: ['close'] },
  ];

  it('reads OFF when none of the type\'s ids are selected', () => {
    expect(typeChipState(cat, 'rifle', [])).toBe('off');
    expect(typeChipState(cat, 'rifle', ['shotgun'])).toBe('off');
  });

  it('reads PARTIAL when some but not all of the type\'s ids are selected', () => {
    expect(typeChipState(cat, 'rifle', ['assault_rifle'])).toBe('partial');
  });

  it('reads ON only when every one of the type\'s ids is selected', () => {
    expect(typeChipState(cat, 'rifle', ['assault_rifle', 'burst_rifle', 'bolt_rifle'])).toBe('on');
  });

  it('clicking an OFF chip ticks every id of that type, unioned with what is already selected', () => {
    expect(toggleTypeIds(['shotgun'], cat, 'rifle').sort()).toEqual(['assault_rifle', 'bolt_rifle', 'burst_rifle', 'shotgun']);
  });

  it('clicking a PARTIAL chip fills in the rest of that type\'s ids (still a union, not a replace)', () => {
    expect(toggleTypeIds(['assault_rifle'], cat, 'rifle').sort()).toEqual(['assault_rifle', 'bolt_rifle', 'burst_rifle']);
  });

  it('clicking an ON chip unticks every id of that type, even one another type also covers', () => {
    // bolt_rifle is both rifle and long -- turning RIFLE off drops it too, because nothing here
    // remembers "long also wanted it"; that is the point of a shortcut, not a rule.
    const onlyIds = ['assault_rifle', 'burst_rifle', 'bolt_rifle', 'amr'];
    expect(toggleTypeIds(onlyIds, cat, 'rifle').sort()).toEqual(['amr']);
  });

  it('unticking one weapon by hand leaves its type reading PARTIAL, not locked', () => {
    const afterClick = toggleTypeIds([], cat, 'rifle');                          // RIFLES -> on
    const afterUntick = afterClick.filter(id => id !== 'assault_rifle');        // hand-untick one
    expect(typeChipState(cat, 'rifle', afterUntick)).toBe('partial');
  });
});

describe('slotNeedsFixedItem (QA-14: SAVE must never reach the server with FIXED and no item)', () => {
  it('blocks FIXED with no item', () => {
    expect(slotNeedsFixedItem('fixed', null)).toBe(true);
    expect(slotNeedsFixedItem('fixed', undefined)).toBe(true);
    expect(slotNeedsFixedItem('fixed', '')).toBe(true);
  });
  it('allows FIXED once an item is picked', () => {
    expect(slotNeedsFixedItem('fixed', 'assault_rifle')).toBe(false);
  });
  it('never blocks a non-FIXED choice, item or not', () => {
    expect(slotNeedsFixedItem('player', null)).toBe(false);
    expect(slotNeedsFixedItem('host', null)).toBe(false);
    expect(slotNeedsFixedItem('off', null)).toBe(false);
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
