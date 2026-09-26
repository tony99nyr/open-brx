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
  deriveTypeSelection, draftOf, guardSpawnDelay, idsCoveredByActiveTypes, idsForType, isDirty,
  proposeCopyName, spawnBuiltinValue, toggleManualId, toggleType, typeSelectionIds, typesOf,
  type TypeSelection,
} from '../src/screens/presets/helpers';

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

describe('TypeSelection (F411 type toggles: union, and toggle-off keeps hand picks)', () => {
  const cat = [
    { id: 'assault_rifle', types: ['rifle'] },
    { id: 'burst_rifle', types: ['rifle'] },
    { id: 'bolt_rifle', types: ['rifle', 'long'] },
    { id: 'amr', types: ['long'] },
    { id: 'shotgun', types: ['close'] },
  ];

  it('turning a type on unions its ids into only_ids', () => {
    const sel = toggleType({ manual: [], active: [] }, 'rifle');
    expect(typeSelectionIds(sel, cat).sort()).toEqual(['assault_rifle', 'bolt_rifle', 'burst_rifle']);
  });

  it('several active types union together', () => {
    let sel: TypeSelection = { manual: [], active: [] };
    sel = toggleType(sel, 'rifle');
    sel = toggleType(sel, 'long');
    expect(typeSelectionIds(sel, cat).sort()).toEqual(['amr', 'assault_rifle', 'bolt_rifle', 'burst_rifle']);
  });

  it('toggling a type off removes only the weapons that only that type had selected', () => {
    let sel: TypeSelection = { manual: [], active: [] };
    sel = toggleType(sel, 'rifle');
    sel = toggleType(sel, 'long');           // rifle+long active: bolt_rifle covered by both
    sel = toggleType(sel, 'rifle');          // rifle off again: long still covers bolt_rifle and amr
    expect(typeSelectionIds(sel, cat).sort()).toEqual(['amr', 'bolt_rifle']);
  });

  it('a hand-picked weapon survives its type being switched off', () => {
    let sel: TypeSelection = { manual: ['shotgun'], active: [] };
    sel = toggleType(sel, 'rifle');
    expect(typeSelectionIds(sel, cat).sort()).toEqual(['assault_rifle', 'bolt_rifle', 'burst_rifle', 'shotgun']);
    sel = toggleType(sel, 'rifle');          // rifle off: the hand pick stays, the type's own ids go
    expect(typeSelectionIds(sel, cat)).toEqual(['shotgun']);
  });

  it('toggleManualId adds/removes one id from the hand-picked set', () => {
    let sel: TypeSelection = { manual: [], active: [] };
    sel = toggleManualId(sel, 'shotgun');
    expect(typeSelectionIds(sel, cat)).toEqual(['shotgun']);
    sel = toggleManualId(sel, 'shotgun');
    expect(typeSelectionIds(sel, cat)).toEqual([]);
  });

  it('idsCoveredByActiveTypes names ids an individual chip cannot remove on its own', () => {
    const sel = toggleType({ manual: [], active: [] }, 'rifle');
    const covered = idsCoveredByActiveTypes(sel, cat);
    expect(covered.has('assault_rifle')).toBe(true);
    expect(covered.has('shotgun')).toBe(false);
  });

  it('deriveTypeSelection reads a fully-covered type back as active, and reproduces the same ids', () => {
    // `close` has only one member here (shotgun), so a fully-selected `close` and a hand-picked
    // shotgun are the same only_ids -- genuinely ambiguous with no provenance, and the deriver
    // reasonably reads it as the type being active rather than a hand pick.
    const onlyIds = ['assault_rifle', 'burst_rifle', 'bolt_rifle', 'shotgun'];
    const sel = deriveTypeSelection(onlyIds, cat);
    expect(sel.active.slice().sort()).toEqual(['close', 'rifle']);
    expect(sel.manual).toEqual([]);
    expect(typeSelectionIds(sel, cat).sort()).toEqual([...onlyIds].sort());
  });

  it('deriveTypeSelection treats a partial type match as all hand-picked (no active type)', () => {
    const onlyIds = ['assault_rifle'];   // only one of the two plain rifles -- not the whole type
    const sel = deriveTypeSelection(onlyIds, cat);
    expect(sel.active).toEqual([]);
    expect(sel.manual).toEqual(['assault_rifle']);
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
