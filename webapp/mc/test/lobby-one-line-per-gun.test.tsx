// Bench 2026-11-01 (Tony, "lots of warnings here. too many"): two guns acked `no_config` after a push,
// and LOBBY said so about six times (the PRE-ARM CHECK verdict and its WHAT TO DO rows, the text beside
// ARM, GUNS READY with "CHECK IT IS ON AND RECONNECT IT", the fault rows, "N GUNS HAVE NOT CONFIRMED"
// above the override). After a push the rail now carries ONE summary line (GUNS READY n/m), ONE line
// per gun with the server's own words for it, and the HOST OVERRIDE.
import { describe, expect, it } from 'vitest';
import type { ReadinessRow, State } from '../src/api/types';
import { GUN_DID_NOT_TAKE_CONFIG } from '../src/api/contract.gen';
import { Lobby } from '../src/screens/Lobby';
import { demo, mountScreen } from './harness';

/** A pushed LOBBY where the first `bad` players' guns acked `no_config`, as on the bench. */
async function noConfigLobby(bad = 2) {
  const d = await demo();
  await d.api.pushLobby(true);
  const s = await d.api.getState();
  const players = s.players.map(p => ({ ...p, ready: true }));
  const badIds = new Set(players.slice(0, bad).map(p => p.player_id));
  const acks = Object.fromEntries(players.map(p => [p.player_id, badIds.has(p.player_id)
    ? { ok: false, err: 'no_config', config_id: s.config.config_id }
    : { ok: true, gun_echo: '$ALCD,32,100,0,192,0,*', config_id: s.config.config_id }]));
  // one board row per rostered player, green unless its gun acked no_config
  const board = players.map(p => {
    const row = s.readiness.board.find(r => r.gun_id === p.gun_id)!;
    return { ...row, player_id: p.player_id, player_num: p.player_num, present: true, ambers: [],
      status: badIds.has(p.player_id) ? 'red' : 'green', blockers: badIds.has(p.player_id) ? [GUN_DID_NOT_TAKE_CONFIG] : [] } as ReadinessRow;
  });
  const rows = (s.sync?.rows ?? []).map(r => ({ ...r, phone_game: true, bound: true, gun_sent: true,
    gun_acked: !badIds.has(r.player_id), ack_state: badIds.has(r.player_id) ? 'failed' : 'acked',
    gun_echo: badIds.has(r.player_id) ? null : 'proven' })) as NonNullable<State['sync']>['rows'];
  const state = { ...s, phase: 'lobby', players,
    game: { ...(s.game ?? {}), loaded: true },
    sync: { ...s.sync!, rows },
    readiness: { ...s.readiness, board, go: false, roster_faults: [] },
    lobby: { ...s.lobby, acks, ready: players.length, pushed: true, all_acked: false } } as State;
  return { d, state, bad: players.slice(0, bad), board };
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe('LOBBY after a push: one line per gun, one summary, the override', () => {
  it('names each no_config gun exactly once, in the server\'s words, never "check it is on"', async () => {
    const { d, state, bad, board } = await noConfigLobby(2);
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const text = m.text().toUpperCase();
    expect(count(text, 'GUN DID NOT TAKE THE CONFIG'), 'one line per gun, nothing else repeats it').toBe(2);
    expect(text).not.toContain('CHECK IT IS ON AND RECONNECT IT');
    const lines = m.find('[data-not-ready-gun]');
    expect(lines.map(l => l.getAttribute('data-not-ready-gun')).sort())
      .toEqual(board.filter(r => r.status === 'red').map(r => r.sticker).sort());
    for (const p of bad) {
      const sticker = board.find(r => r.player_id === p.player_id)!.sticker;
      const line = lines.find(l => l.getAttribute('data-not-ready-gun') === sticker)!;
      expect(line.textContent, `${p.display}'s line names the player`).toContain(p.display);
      expect(line.textContent).toContain(GUN_DID_NOT_TAKE_CONFIG);
    }
    m.unmount();
  });

  it('keeps one summary line and drops the other copies of the same fact', async () => {
    const { d, state, bad } = await noConfigLobby(2);
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const text = m.text().toUpperCase();
    const n = state.players.length;
    expect(count(text, `GUNS READY ${n - 2}/${n}`), 'the one summary line').toBe(1);
    expect(text, 'the PRE-ARM verdict').not.toContain('NEED ACTION');
    expect(m.find('[data-testid="pre-arm-row"]').length, 'PRE-ARM rows wait for ALL').toBe(0);
    expect(m.find('[data-arm-why]').length, 'no sentence beside ARM repeating the list').toBe(0);
    expect(text, 'no "N guns cannot start" line').not.toContain('CANNOT START');
    expect(m.find('[data-testid="override-risk"]').length, 'the override button already names them').toBe(0);
    const override = (m.find('[data-override] button') as HTMLButtonElement[])[0];
    expect(override?.textContent, 'the HOST OVERRIDE stays').toContain(bad[0].display);
    const arm = (m.find('[data-lobby-primary] button') as HTMLButtonElement[])[0];
    expect(arm.disabled, 'ARM stays refused').toBe(true);
    expect(arm.title, 'and says why on its title: the re-push that cures them').toMatch(/2 guns need config re-pushed: RE-PUSH CONFIG/);
    m.unmount();
  });

  it('a no_config gun is cured by an ORDINARY re-push, never "OVER N BLOCKED" (state.py PUSH_CURES)', async () => {
    const { d, state } = await noConfigLobby(2);
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const repush = m.find('[data-repush="1"]')[0] as HTMLButtonElement | undefined;
    expect(repush, 'RE-PUSH is on screen').toBeTruthy();
    expect(repush!.textContent).not.toContain('BLOCKED');
    expect(repush!.getAttribute('data-repush-force'), 'and it is not about to force').toBeNull();
    expect(repush!.disabled).toBe(false);
    m.unmount();
  });

  it('PRE-ARM rows still open on ALL', async () => {
    const { d, state } = await noConfigLobby(2);
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    await m.click(`ALL ${state.players.length}`);
    expect(m.find('[data-testid="pre-arm-row"]').length).toBe(state.players.length);
    m.unmount();
  });

  it('a gun with no answer yet is a neutral line, and is not counted ready', async () => {
    const { d, state: base } = await noConfigLobby(0);
    const [pending] = base.players;
    const acks = { ...base.lobby.acks };
    delete acks[pending.player_id];
    const state = { ...base, lobby: { ...base.lobby, acks } } as State;
    const m = await mountScreen(<Lobby />, { ...d, state, view: 'lobby' });
    const n = state.players.length;
    expect(m.text().toUpperCase()).toContain(`GUNS READY ${n - 1}/${n}`);
    const line = m.find('[data-not-ready-gun]').find(l => (l.textContent ?? '').includes(pending.display));
    expect(line?.textContent).toContain(pending.display);
    expect(line?.textContent?.toUpperCase()).toContain('WAITING FOR THE GUN TO CONFIRM');
    m.unmount();
  });
});
