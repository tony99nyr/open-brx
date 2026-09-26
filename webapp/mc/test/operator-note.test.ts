// F411 (docs/spec/design/games-redesign.md §9): the operator note is a pure function of the composed
// config — PLAY, LOBBY and ARMED all call the same one (screens/operatorNote.ts).
import { describe, expect, it } from 'vitest';
import { operatorNote } from '../src/screens/operatorNote';

const base = { mode: 'tdm', time_limit_s: 600, respawn: { type: 'auto' as const }, scoring: { frag_limit: null as number | null } };

describe('operatorNote', () => {
  it('KOTH: place the hill, hold it to score', () => {
    expect(operatorNote({ ...base, mode: 'koth' })).toEqual(['PLACE THE HILL BEFORE START · HOLD IT TO SCORE']);
  });
  it('TDM: team hits do not count', () => {
    expect(operatorNote({ ...base, mode: 'tdm' })).toEqual(["TEAM HITS DON'T COUNT"]);
  });
  it('FFA: no mode line at all', () => {
    expect(operatorNote({ ...base, mode: 'ffa' })).toEqual([]);
  });
  it('a kill limit set: WIN: PLAYERS CONFIRM AT MC', () => {
    expect(operatorNote({ ...base, mode: 'ffa', scoring: { frag_limit: 15 } })).toEqual(['WIN: PLAYERS CONFIRM AT MC']);
  });
  it('SPAWN station: RESPAWN AT STATIONS', () => {
    expect(operatorNote({ ...base, mode: 'ffa', respawn: { type: 'scanner' } })).toEqual(['RESPAWN AT STATIONS']);
  });
  it('no time limit: TIME: RUNS UNTIL YOU END IT', () => {
    expect(operatorNote({ ...base, mode: 'ffa', time_limit_s: null })).toEqual(['TIME: RUNS UNTIL YOU END IT']);
  });
  it('caps at two lines, even when more would apply', () => {
    const cfg = { mode: 'koth', time_limit_s: null, respawn: { type: 'scanner' as const }, scoring: { frag_limit: 15 } };
    expect(operatorNote(cfg)).toHaveLength(2);
    expect(operatorNote(cfg)).toEqual(['PLACE THE HILL BEFORE START · HOLD IT TO SCORE', 'RESPAWN AT STATIONS']);
  });
  it('empty when nothing applies', () => {
    expect(operatorNote({ ...base, mode: 'ffa' })).toEqual([]);
  });
});
