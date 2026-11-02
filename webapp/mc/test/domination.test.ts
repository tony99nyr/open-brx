// Domination (mode id `domination`): the console's mirrors of the server's hill-mode rules, and the
// mock backend's matching refusals. KOTH's behaviour is checked alongside, so a hill-mode edit cannot
// quietly change it.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { isHillMode, isOwnershipScored, objectiveUnit } from '../src/rules/scoring';
import { operatorNote } from '../src/screens/operatorNote';
import { hillReadoutText } from '../src/ui/HillReadout';
import { legalColours } from '../src/teamColours';
import { fmtObjective } from '../src/screens/objective';

const cfg = (mode: string, hold: number | null) =>
  ({ mode, respawn: { type: 'auto' as const }, scoring: { frag_limit: null, hold_target_s: hold } });

describe('Domination: mode helpers', () => {
  it('isHillMode covers koth and domination only', () => {
    expect(isHillMode('koth')).toBe(true);
    expect(isHillMode('domination')).toBe(true);
    expect(isHillMode('tdm')).toBe(false);
    expect(isHillMode('ffa')).toBe(false);
  });

  it('only domination is ownership scored, and its unit is POINTS', () => {
    expect(isOwnershipScored('domination')).toBe(true);
    expect(isOwnershipScored('koth')).toBe(false);
    expect(objectiveUnit('domination')).toBe('POINTS');
    expect(objectiveUnit('koth')).toBe('TIME');
    expect(objectiveUnit('tdm')).toBe('TIME');
  });

  it('never offers yellow, as koth', () => {
    expect(legalColours('domination')).not.toContain('yellow');
    expect(legalColours('tdm')).toContain('yellow');
  });

  it('shows hill tallies as whole points for domination and m:ss for koth', () => {
    expect(fmtObjective('domination', 125)).toBe('125');
    expect(fmtObjective('koth', 125)).toBe('2:05');
  });
});

describe('Domination: operator note and hill readout', () => {
  it('names the hills and the points target', () => {
    expect(operatorNote(cfg('domination', 1000), 3)).toEqual(['PLACE THE HILLS BEFORE START', 'FIRST TO 1000 HILL POINTS WINS']);
  });

  it('with no target, says to own the hills', () => {
    expect(operatorNote(cfg('domination', null), 3)).toEqual(['PLACE THE HILLS BEFORE START · OWN THEM TO SCORE']);
  });

  it('keeps the koth lines unchanged', () => {
    expect(operatorNote(cfg('koth', 300), 1)).toEqual(['PLACE THE HILL BEFORE START', 'FIRST TO HOLD 5:00 WINS']);
    expect(operatorNote(cfg('koth', null), 1)).toEqual(['PLACE THE HILL BEFORE START · HOLD IT TO SCORE']);
  });

  it('shows the hill pace for domination, and nothing for tdm', () => {
    expect(hillReadoutText({ mode: 'domination', hill: { capture_s: 15, net_cap: 4 } })).toBe('HILL: CAPTURE 15 S · NET CAP 4');
    expect(hillReadoutText({ mode: 'domination' })).toBe('HILL: PACE SET ON EACH HILL');
    expect(hillReadoutText({ mode: 'tdm' })).toBeNull();
  });
});

describe('Domination: mock backend rules', () => {
  it('is exactly 2 teams, with the server words', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:domination' } });
    const bad = await b.pick({ match: { teams: ['blue', 'purple', 'red'] } });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toEqual(['DOMINATION IS EXACTLY 2 TEAMS: PICK TWO COLOURS']);
  });

  it('never allows yellow', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:domination' } });
    const bad = await b.pick({ match: { teams: ['blue', 'yellow'] } });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toEqual(["YELLOW IS DOMINATION'S NEUTRAL TEAM: PICK RED, BLUE OR PURPLE"]);
  });

  it('allows a hold target in domination, and refuses one in tdm with the hill-mode words', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:domination' } });
    const ok = await b.pick({ match: { hold_target_s: 500 } });
    expect(ok.ok).toBe(true);
    expect((await b.getState()).config.scoring.hold_target_s).toBe(500);
    await expect(b.putConfig({ mode: 'tdm', scoring: { hold_target_s: 500 } } as never))
      .rejects.toThrow('A HOLD TARGET ONLY APPLIES TO KING OF THE HILL OR DOMINATION: CLEAR IT OR PICK A HILL MODE');
  });

  it('cannot be loaded with no hill, and names Domination', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:domination' } });
    await expect(b.loadGame()).rejects.toThrow('DOMINATION NEEDS A HILL: ASSIGN A PHONE OR STICK AS A HILL IN THE ARMORY');
  });

  it('koth keeps its own no-hill words', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:koth' } });
    await expect(b.loadGame()).rejects.toThrow('KING OF THE HILL NEEDS A HILL: ASSIGN A PHONE OR STICK AS A HILL IN THE ARMORY');
  });

  it('warns amber when fewer than 3 hills are assigned', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:domination' } });
    await b.putStation('util-a1b2c3', { kind: 'control', team: 'any' });
    const w = (await b.getState()).config_warnings ?? [];
    expect(w).toContain('SETUP: DOMINATION IS DESIGNED FOR 3 HILLS AND 1 IS ASSIGNED: ASSIGN MORE HILLS IN THE ARMORY, OR PLAY ON');
  });

  it('does not compare the points target with the time limit', async () => {
    const b = new MockBackend();
    await b.pick({ pieces: { mode: 'builtin:mode:domination' }, match: { hold_target_s: 1000, time_limit_s: 600 } });
    expect(((await b.getState()).config_warnings ?? []).some(x => x.includes('HOLD TARGET'))).toBe(false);
  });
});
