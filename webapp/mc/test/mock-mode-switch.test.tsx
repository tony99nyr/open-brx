// F-10 (2026-09-13). `state.py set_config` rebuilds the WHOLE config from `default_config(mode)`
// whenever the mode changes, then merges the patch on top — so nothing belonging to the OLD mode can
// survive the switch. The mock instead spread a bare `{ mode }` patch onto the PREVIOUS config, so
// `teams` (declared per-mode: TDM is BLUE/YELLOW, KOTH is BLUE/PURPLE) stayed the old mode's list.
// `GameEditPanel`'s inline mode Seg sends exactly this bare patch (`putGame({ mode: v })`) — the
// full-defaults spread only `Games.tsx`'s mode tile does (`{ ...m.defaults, ...venue }`) does not hit
// this path, so a demo of the inline KIT/LOBBY editor predicted the wrong roster.
import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';

describe('mock putConfig — a bare {mode} patch mirrors default_config(mode)', () => {
  it('TDM -> KOTH rebuilds teams to KOTH’s own declared pair, not stale TDM leftovers', async () => {
    const b = new MockBackend();
    // the FRESH demo starts on TDM already (its own construction-time override, blue/yellow -- a
    // session already in progress, mock/backend.ts's own comment) -- tdm -> tdm is not a mode CHANGE at
    // all, so this leaves it exactly as constructed rather than rebuilding to TDM's own red+blue.
    await b.putConfig({ mode: 'tdm' });
    const tdm = await b.getState();
    expect(tdm.config.teams.map(t => t.team_id).sort()).toEqual(['blue', 'yellow']);
    // the bare patch GameEditPanel actually sends — no spread of the mode's defaults. F413 (2026-09-27):
    // every team mode's own `defaults.teams` is red+blue now (matching the server) -- this genuinely IS
    // a mode change, so it rebuilds to KOTH's own declared pair, whatever that is, never TDM's leftovers.
    await b.putConfig({ mode: 'koth' });
    const koth = await b.getState();
    expect(koth.config.teams.map(t => t.team_id).sort(), 'KOTH declares its own pair, not TDM leftovers').toEqual(['blue', 'red']);
    expect(koth.config.station_source, 'KOTH needs its objective source too').toBe('phone');
  });

  it('a venue fact set before the switch survives it, exactly like the server carries it forward', async () => {
    const b = new MockBackend();
    await b.putConfig({ mode: 'tdm', environment: 'outdoor', night: true });
    await b.putConfig({ mode: 'koth' });
    const st = await b.getState();
    expect(st.config.environment, 'venue is a fact about the site, not the game').toBe('outdoor');
    expect(st.config.night).toBe(true);
  });

  it('TDM -> FFA drops the stale station_source the way the server does', async () => {
    const b = new MockBackend();
    await b.putConfig({ mode: 'koth' });
    expect((await b.getState()).config.station_source).toBe('phone');
    await b.putConfig({ mode: 'ffa' });
    expect((await b.getState()).config.station_source, 'FFA has no objective source; the old key must not survive').toBeUndefined();
  });
});
