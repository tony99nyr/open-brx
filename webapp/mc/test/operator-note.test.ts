// F411 (docs/spec/design/games-redesign.md §9): the operator note is a pure function of the composed
// config — PLAY, LOBBY and ARMED all call the same one (screens/operatorNote.ts).
import { describe, expect, it } from 'vitest';
import { operatorNote } from '../src/screens/operatorNote';

const base = { mode: 'tdm', respawn: { type: 'auto' as const }, scoring: { frag_limit: null as number | null } };

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
  // VQA round 1 QA-28: "TIME: RUNS UNTIL YOU END IT" is retired -- PLAY's TIME control can never be
  // set to no limit, so the line could never show. See screens/operatorNote.ts.
  it('caps at two lines, even when more would apply', () => {
    const cfg = { mode: 'koth', respawn: { type: 'scanner' as const }, scoring: { frag_limit: 15 } };
    expect(operatorNote(cfg)).toHaveLength(2);
    expect(operatorNote(cfg)).toEqual(['PLACE THE HILL BEFORE START · HOLD IT TO SCORE', 'RESPAWN AT STATIONS']);
  });
  it('empty when nothing applies', () => {
    expect(operatorNote({ ...base, mode: 'ffa' })).toEqual([]);
  });
  // F415 (games-presets.md §7): a KOTH hold target names itself, minutes:seconds.
  it('KOTH with a hold target: FIRST TO HOLD m:ss WINS, alongside the setup line', () => {
    expect(operatorNote({ ...base, mode: 'koth', scoring: { frag_limit: null, hold_target_s: 300 } }))
      .toEqual(['PLACE THE HILL BEFORE START', 'FIRST TO HOLD 5:00 WINS']);
  });
  it('KOTH with a hold target under a minute pads the seconds', () => {
    expect(operatorNote({ ...base, mode: 'koth', scoring: { frag_limit: null, hold_target_s: 65 } }))
      .toEqual(['PLACE THE HILL BEFORE START', 'FIRST TO HOLD 1:05 WINS']);
  });
  it('KOTH with no hold target keeps the plain setup line', () => {
    expect(operatorNote({ ...base, mode: 'koth', scoring: { frag_limit: null, hold_target_s: null } }))
      .toEqual(['PLACE THE HILL BEFORE START · HOLD IT TO SCORE']);
  });
});
