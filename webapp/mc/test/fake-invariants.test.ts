import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import invariants from '../../../mcp/brx_mcp/mc/fake_invariants.json';

type Case = (b: MockBackend) => Promise<void>;
type Ack = { ok: boolean; config_id?: string; gun_echo?: string; err?: string };
const internals = (b: MockBackend) => b as unknown as { acks: Record<string, Ack> };

const cases: Record<string, Case> = {
  gun_binding: async b => {
    const s = await b.getState();
    const bound = s.players.filter(p => p.node_id);
    expect(bound.length).toBeGreaterThan(0);
    expect(new Set(bound.map(p => p.node_id)).size).toBe(bound.length);
    expect(bound.every(p => p.gun_id)).toBe(true);
  },
  push_acks: async b => {
    await b.pushLobby(true);
    const before = await b.getState();
    const ready = before.players.filter(p => p.ready).map(p => p.player_id);
    const id = before.players.find(p => p.node_id)!.player_id;
    internals(b).acks[id] = { ok: true, gun_echo: '$ALCD', config_id: 'retired' };
    internals(b).acks.orphan = { ok: true, gun_echo: '$ALCD', config_id: 'retired' };
    await b.pushLobby(true);
    const after = await b.getState();
    expect(after.players.filter(p => p.ready).map(p => p.player_id)).toEqual(ready);
    expect(after.lobby.acks[id].config_id).not.toBe('retired');
    expect(after.lobby.acks.orphan).toBeUndefined();
  },
  current_ack: async b => {
    await b.pushLobby(true);
    const s = await b.getState();
    const id = s.players.find(p => p.node_id)!.player_id;
    for (const p of s.players.filter(p => p.node_id)) {
      internals(b).acks[p.player_id] = { ok: true, gun_echo: '$ALCD', config_id: s.config.config_id };
    }
    internals(b).acks[id] = { ok: true, gun_echo: '$ALCD', config_id: 'older' };
    expect((await b.getState()).lobby.all_acked).toBe(false);
    internals(b).acks[id] = { ok: true, config_id: s.config.config_id };
    expect((await b.getState()).lobby.all_acked).toBe(false);
    internals(b).acks[id] = { ok: true, gun_echo: '$ALCD', config_id: s.config.config_id };
    expect((await b.getState()).lobby.all_acked).toBe(true);
  },
  fresh_repush: async b => {
    await b.pushLobby(true);
    const old = (await b.getState()).config.config_id;
    const result = await b.pushLobby(true);
    expect(result.config_id).not.toBe(old);
    expect(Object.values((await b.getState()).lobby.acks).every(a => a.config_id !== old)).toBe(true);
  },
  updating: async b => {
    await b.pushLobby(true);
    await b.readyAll();
    const s = await b.getState();
    const ids = s.players.filter(p => p.node_id).slice(0, 2).map(p => p.player_id);
    delete internals(b).acks[ids[0]];
    internals(b).acks[ids[1]] = { ok: false, err: 'no_echo', config_id: s.config.config_id };
    expect((await b.getState()).lobby.updating).toBe(1);
    internals(b).acks[ids[0]] = { ok: true, gun_echo: '$ALCD', config_id: 'older' };
    expect((await b.getState()).lobby.updating).toBe(1);
    internals(b).acks[ids[0]] = { ok: true, gun_echo: '$ALCD', config_id: s.config.config_id };
    expect((await b.getState()).lobby.updating).toBe(0);
  },
  coverage_zones: async b => {
    expect((await b.getState()).coverage?.level).toBe('zones');
  },
  stale_start: async b => {
    await b.pushLobby(true);
    const s = await b.getState();
    const id = s.players.find(p => p.node_id)!.player_id;
    internals(b).acks[id] = { ok: true, gun_echo: '$ALCD', config_id: 'older' };
    await expect(b.start(10, true)).rejects.toThrow('OLDER config');
  },
};

describe('shared node fake invariants', () => {
  it('has exactly one case for every declared invariant', () => {
    const ids = invariants.map(row => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(cases).sort()).toEqual(ids.sort());
  });
  for (const { id, rule } of invariants) {
    it(`${id}: ${rule}`, async () => {
      const b = new MockBackend();
      try { await cases[id](b); }
      finally { b.dispose(); }
    });
  }
});
