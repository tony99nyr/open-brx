import { describe, expect, it, vi } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { recapSync } from '../src/api/recapSync';
import { galleryState } from '../src/mock/gallery';

async function pendingMatch() {
  vi.useFakeTimers();
  const b = new MockBackend({ syncDemo: true });
  await b.pushLobby(true);
  await b.start(0, true);
  await vi.advanceTimersByTimeAsync(2000);
  await b.control('end');
  expect(recapSync((await b.getRecap()))?.pending).toBe(true);
  return b;
}

describe('mock released result', () => {
  it('the gallery can display a pending winner and a released late batch', async () => {
    const b = new MockBackend();
    try {
      const base = await b.getState();
      expect(galleryState(base, 'b').recap?.winner).toBeNull();
      const late = galleryState(base, 'late').recap!;
      expect(recapSync(late)?.pending).toBe(false);
      expect(recapSync(late)?.result_changed).toBe(true);
      expect(recapSync(late)?.rows.some(r => r.stage === 'sending')).toBe(true);
      expect(late.winner).toEqual({ team_id: 'red' });
    } finally { b.dispose(); }
  });
  it('hides pending stats and CSV, and refuses every roll from RECAP', async () => {
    const b = await pendingMatch();
    try {
      expect((await b.getRecap()).winner).toBeNull();
      expect((await b.getState()).recap?.winner).toBeNull();
      const history = await b.matchHistory();
      expect(history[0]).toMatchObject({ pending: true });
      expect(history[0]).not.toHaveProperty('recap');
      expect(history[0]).not.toHaveProperty('config');
      expect(() => b.recapCsvUrl()).toThrow('Finalise the result first.');
      expect(() => b.matchCsvUrl(history[0].match_id)).toThrow('Finalise the result first.');
      for (const roll of [() => b.nextMatch(), () => b.loadGame(), () => b.setPhase('lobby'), () => b.pushLobby(true), () => b.newSession(false)]) {
        await expect(roll()).rejects.toMatchObject({ status: 409, message: 'Finalise the result first.' });
        expect((await b.getState()).phase).toBe('recap');
      }
    } finally { b.dispose(); vi.useRealTimers(); }
  });

  it('keeps a released result while a late batch reopens a received row', async () => {
    const b = await pendingMatch();
    try {
      await b.finaliseRecap();
      await vi.advanceTimersByTimeAsync(20_000);
      const before = await b.getRecap();
      const received = recapSync(before)?.rows.find(r => r.kind === 'phone' && r.stage === 'received');
      expect(received).toBeDefined();
      const current = before.winner?.team_id;
      const changed = { team_id: current === 'yellow' ? 'blue' : 'yellow' };
      b.demoLateBatch(received!.id, changed);
      const after = await b.getRecap();
      expect(recapSync(after)?.rows.find(r => r.id === received!.id)?.stage).toBe('sending');
      expect(recapSync(after)?.pending).toBe(false);
      expect(recapSync(after)?.result_changed).toBe(true);
      expect(after.winner).toEqual(changed);
      expect((await b.matchHistory())[0].recap?.winner).toEqual(changed);
      expect(b.recapCsvUrl()).toMatch(/^data:text\/csv/);
      await vi.advanceTimersByTimeAsync(5000);
      expect(recapSync(await b.getRecap())?.rows.find(r => r.id === received!.id)?.stage).toBe('received');
    } finally { b.dispose(); vi.useRealTimers(); }
  });
});
