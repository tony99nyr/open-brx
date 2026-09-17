// Bench 2026-09-17: MC restarted mid-match with no snapshot, and the phones played on in a match the new
// process did not start. `state.orphan_match` (state.py `orphan_match_view`) is present only while a bound
// phone reports that match. These assert what is on the screen:
//
//  * the MATCH tab shows ONE line with RESUME MATCH (primary) and END THEIR MATCH, and the MATCH nav tab a dot
//  * RESUME calls the server with the match id; END asks once, then calls it
//  * RESUME is hidden while MC runs its own match (`can_resume: false`), END is not
//  * with no such phones (MUSTER, KIT, LOBBY, RECAP) there is no prompt and no dot, and ARMORY never has one
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CommandBar } from '../src/frame/CommandBar';
import { Armory } from '../src/screens/Armory';
import { Live } from '../src/screens/Live';
import { Recap } from '../src/screens/Recap';
import { MockBackend } from '../src/mock/backend';
import type { OrphanMatchView, RecapView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const ORPHAN: OrphanMatchView = { match_id: 'm-lost', phones: 2, players: ['ALPHA', 'BRAVO'], arm_state: 'live', can_resume: true };
const RECAP: RecapView = { winner: { team_id: 'blue' }, score: { blue: 1 }, provisional: false, missing: [], honors: [], rows: [] };
const strip = (s: string) => s.replace(/\s+/g, ' ').toUpperCase();
const btn = (m: { find(sel: string): HTMLElement[] }, label: string) =>
  m.find('[data-testid="orphan-match"] button').find(b => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;

describe('bench 2026-09-17 · phones in a match this MC did not start', () => {
  it('the MATCH tab shows one line with RESUME MATCH and END THEIR MATCH', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'muster', live: undefined, recap: undefined, orphan_match: ORPHAN };
    const m = await mountScreen(<Live />, { ...d, state, view: 'live' });
    const el = m.find('[data-testid="orphan-match"]');
    expect(el.length).toBe(1);
    const t = strip(el[0].textContent ?? '');
    expect(t).toContain('2 PHONES ARE IN A MATCH THIS MC DID NOT START');
    expect(t).toContain('ALPHA, BRAVO');
    expect(btn(m, 'RESUME MATCH'), 'the primary action').toBeTruthy();
    expect(btn(m, 'END THEIR MATCH')).toBeTruthy();
    m.unmount();
  });

  it('the MATCH nav tab carries a dot while it is true, and only the MATCH tab', async () => {
    const d = await demo();
    const m = await mountScreen(<CommandBar />, { ...d, state: { ...d.state, phase: 'kit', orphan_match: ORPHAN }, view: 'kit' });
    const dots = m.find('[data-testid="match-tab-dot"]');
    expect(dots.length).toBe(1);
    expect(strip(dots[0].closest('button')?.textContent ?? '')).toContain('MATCH');
    m.unmount();
  });

  it('RESUME MATCH calls the server with the match id', async () => {
    const d = await demo();
    const resumeOrphan = vi.fn(async () => d.state);
    const state: State = { ...d.state, phase: 'muster', live: undefined, orphan_match: ORPHAN };
    const m = await mountScreen(<Live />, { ...d, state, view: 'live', api: { resumeOrphan } });
    await act(async () => { btn(m, 'RESUME MATCH')!.click(); });
    expect(resumeOrphan).toHaveBeenCalledWith('m-lost');
    m.unmount();
  });

  it('END THEIR MATCH asks once, then calls the server; CANCEL calls nothing', async () => {
    const d = await demo();
    const endOrphan = vi.fn(async () => d.state);
    const state: State = { ...d.state, phase: 'muster', live: undefined, orphan_match: ORPHAN };
    const m = await mountScreen(<Live />, { ...d, state, view: 'live', api: { endOrphan } });
    await act(async () => { btn(m, 'END THEIR MATCH')!.click(); });
    expect(endOrphan).not.toHaveBeenCalled();
    await act(async () => { btn(m, 'CANCEL')!.click(); });
    expect(btn(m, 'END THEIR MATCH')).toBeTruthy();
    await act(async () => { btn(m, 'END THEIR MATCH')!.click(); });
    await act(async () => { btn(m, 'END IT ON 2 PHONES')!.click(); });
    expect(endOrphan).toHaveBeenCalledTimes(1);
    expect(endOrphan).toHaveBeenCalledWith('m-lost');
    m.unmount();
  });

  it('RESUME is hidden while MC runs a match of its own; END is still there', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap', recap: RECAP, orphan_match: { ...ORPHAN, phones: 1, players: ['BRAVO'], can_resume: false } };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap' });
    expect(strip(m.find('[data-testid="orphan-match"]')[0].textContent ?? '')).toContain('1 PHONE IS IN A MATCH');
    expect(btn(m, 'RESUME MATCH')).toBeUndefined();
    expect(btn(m, 'END THEIR MATCH')).toBeTruthy();
    m.unmount();
  });

  it('ARMORY never shows the prompt, even while it is true', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, { ...d, state: { ...d.state, phase: 'muster', orphan_match: ORPHAN }, view: 'muster' });
    expect(m.find('[data-testid="orphan-match"]').length).toBe(0);
    expect(strip(m.text())).not.toContain('DID NOT START');
    m.unmount();
  });

  it('a normal MUSTER, KIT, LOBBY and RECAP render neither the prompt nor the dot', async () => {
    const d = await demo();
    for (const phase of ['muster', 'kit', 'lobby', 'recap'] as const) {
      const state: State = { ...d.state, phase, recap: phase === 'recap' ? RECAP : undefined, live: undefined };
      expect(state.orphan_match, 'the demo sends no orphan without ?orphan=1').toBeUndefined();
      const bar = await mountScreen(<CommandBar />, { ...d, state, view: phase });
      expect(bar.find('[data-testid="match-tab-dot"]').length, phase).toBe(0);
      bar.unmount();
      const screen = await mountScreen(phase === 'recap' ? <Recap /> : <Live />, { ...d, state, view: phase === 'recap' ? 'recap' : 'live' });
      expect(screen.find('[data-testid="orphan-match"]').length, phase).toBe(0);
      expect(strip(screen.text()), phase).not.toMatch(/RESUME|DID NOT START|END THEIR MATCH/);
      screen.unmount();
    }
  });
});

describe('bench 2026-09-17 · the mock mirrors state.py', () => {
  it('RESUME MATCH adopts it: the notice goes and the match is LIVE', async () => {
    const b = new MockBackend();
    expect((await b.getState()).orphan_match).toBeUndefined();
    b.setOrphan('m-lost');
    const before = await b.getState();
    expect(before.orphan_match?.can_resume).toBe(true);
    const after = await b.resumeOrphan('m-lost');
    expect(after.orphan_match).toBeUndefined();
    expect(after.phase).toBe('live');
    expect(after.live?.match_id).toBe('m-lost');
  });

  it('END THEIR MATCH clears it and moves no phase', async () => {
    const b = new MockBackend();
    b.setOrphan('m-lost');
    const phase = (await b.getState()).phase;
    const after = await b.endOrphan('m-lost');
    expect(after.orphan_match).toBeUndefined();
    expect(after.phase).toBe(phase);
    await expect(b.resumeOrphan('m-lost')).rejects.toThrow(/no phone reports/);
  });
});
