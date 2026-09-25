import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { Designer } from '../src/screens/Designer';
import { gameSettingRows } from '../src/ui/LoadedGame';
import { StoreCtx } from '../src/store';
import { makeStore, mount } from './harness';
import { STATION_SOURCES } from '../src/screens/gameSummary';

describe('team damage host copy', () => {
  it('states the hill announcement capability for every source', () => {
    const copy = Object.fromEntries(STATION_SOURCES.map(s => [s.value, s.hint]));
    expect(copy.phone).toMatch(/HILL CAPTURED, HILL LOST and HILL CONTESTED/);
    expect(copy.grenade).toMatch(/HILL CAPTURED and HILL LOST.*never HILL CONTESTED/);
    expect(copy.ir_station).toMatch(/announcement behaviour is unknown/i);
  });
  it('shows the setting on loaded game rows for teams and omits it in FFA', async () => {
    const api = new MockBackend();
    const modes = await api.getModes(); const weapons = await api.getWeapons(); const perks = await api.getPerks();
    for (const mode of ['tdm', 'ffa']) {
      await api.putConfig({ mode });
      const state = await api.getState();
      const labels = gameSettingRows(state.config, modes.find(m => m.mode === mode), weapons, perks).map(([label]) => label);
      expect(labels.includes('TEAM DAMAGE'), `${mode} row`).toBe(mode !== 'ffa');
    }
  });

  it('shows the setting on the Designer rail for teams and omits it in FFA', async () => {
    const api = new MockBackend(); const modes = await api.getModes();
    for (const mode of ['tdm', 'ffa']) {
      await api.putConfig({ mode });
      const state = await api.getState();
      const m = await mount(<StoreCtx.Provider value={makeStore({ state, view: 'build' }, { api, modes })}><Designer /></StoreCtx.Provider>);
      expect(m.text().includes('TEAM DAMAGE'), `${mode} rail`).toBe(mode !== 'ffa');
      m.unmount();
    }
  });

  it('does not simulate team kills', async () => {
    const api = new MockBackend() as any;
    await api.putConfig({ mode: 'tdm' });
    api.live_ = { rows: [
      { player_id: 'a', display: 'A', team_id: 'blue', status: 'alive', kills: 0, deaths: 0, streak: 0, hits: 0, shots: 0 },
      { player_id: 'b', display: 'B', team_id: 'blue', status: 'alive', kills: 0, deaths: 0, streak: 0, hits: 0, shots: 0 },
      { player_id: 'c', display: 'C', team_id: 'yellow', status: 'alive', kills: 0, deaths: 0, streak: 0, hits: 0, shots: 0 },
    ], go_live_t: Date.now() };
    api.feed = () => {};
    for (let i = 0; i < 20; i++) api.simKill('a');
    expect(api.live_.rows.find((r: any) => r.player_id === 'b')?.deaths).toBe(0);
  });
});
