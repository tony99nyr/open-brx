// S25 — the spectator board.
//
// "spectators might watch the score screen. it should be espn quality." (game test 2026-09-11, D4).
// Two things had to be resolved before any of that: `Live.tsx` mixes the score with END MATCH EARLY
// and RECALL, and the command bar carries PANIC — none of which may sit on a screen pointed at a
// room. So the spectator view is its OWN route, read-only by construction. This is the safe, legible
// v1; the broadcast treatment is a later pass.
//
// The load-bearing test is the LAST one: no control that changes the match may exist on this screen.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Spectate } from '../src/screens/Spectate';
import type { LiveRow, LiveView, State } from '../src/api/types';
import { demo, makeStore, mount } from './harness';
import { StoreCtx, type Store } from '../src/store';

// jsdom's window is 1024x768 — a projector as far as the fit rule is concerned. Each test that moves
// it puts it back, so the order tests run in cannot change what they measure.
const JSDOM_VP = { w: 1024, h: 768 };

const row = (over: Partial<LiveRow> = {}): LiveRow => ({
  player_id: 'p1', display: 'VIPER', team_id: 'blue',
  kills: 9, deaths: 3, assists: 2, shots: 40, hits: 14, accuracy: 35, kd: 3, streak: 1,
  best_streak: 5, medals: [], status: 'alive', sync_age_ms: 1200, ...over,
});

async function spectate(over: Partial<State> = {}, base: Partial<Store> = {}) {
  const d = await demo();
  const live: LiveView = {
    match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 600,
    ends_t: Date.now() + 540_000, score: { blue: 9, yellow: 4 },
    rows: [row(), row({ player_id: 'p2', display: 'GHOST', team_id: 'yellow', kills: 4, best_streak: 2 })],
  };
  const state: State = { ...d.state, phase: 'live', live, ...over };
  const store = makeStore({ ...d, state, view: 'live' }, {
    feed: [{ t_match_s: 90, text: 'VIPER eliminated GHOST', kind: 'kill' }],
    ...base,
  });
  return mount(<StoreCtx.Provider value={store}><Spectate /></StoreCtx.Provider>);
}

/** A roster of `n`, which is what the fit rule is for. */
const manyRows = (n: number): LiveRow[] => Array.from({ length: n }, (_, i) =>
  row({ player_id: `p${i}`, display: `OPERATOR ${i}`, team_id: i % 2 ? 'yellow' : 'blue', kills: n - i }));

/** Pretend the browser window is this tall, and let the resize listener see it. */
async function resizeTo(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true });
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}
const fontOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize);

afterEach(async () => { await resizeTo(JSDOM_VP.w, JSDOM_VP.h); });

describe('S25 · the spectator board', () => {
  it('shows the two team scores, the clock and the leaderboard', async () => {
    const m = await spectate();
    const t = m.text();
    expect(t).toContain('BLUE');
    expect(t).toContain('YELLOW');
    expect(m.find('[data-spectate="clock"]').length).toBe(1);
    expect(m.find('[data-spectate="row"]').length).toBe(2);
    expect(t).toContain('VIPER');
    expect(t).toContain('GHOST');
    m.unmount();
  });

  it('carries the event feed', async () => {
    const m = await spectate();
    expect(m.text()).toContain('VIPER eliminated GHOST');
    m.unmount();
  });

  it('is legible across a room: nothing meaningful under 16px, the score far bigger', async () => {
    const m = await spectate();
    const small = m.find('[data-spectate] *')
      .filter(el => (el.textContent ?? '').trim() && el.children.length === 0)
      .map(el => ({ t: (el.textContent ?? '').trim(), px: parseFloat(getComputedStyle(el).fontSize) }))
      .filter(x => x.px < 16);
    expect(small.map(x => `${x.t}@${x.px}px`).join(' | ')).toBe('');
    const score = parseFloat(getComputedStyle(m.find('[data-spectate="score"]')[0]).fontSize);
    expect(score).toBeGreaterThanOrEqual(56);
    m.unmount();
  });

  it('stays over 16px on a short screen with a full roster', async () => {
    // The fit rule scales the type with the viewport. The floor is the point: it may shrink to fit
    // twelve rows onto a 1280x800 projector, and it may not shrink past what the back of a hall can
    // read. (jsdom lays nothing out, so "does it FIT" is the e2e's measurement, not this one.)
    await resizeTo(1280, 800);
    const m = await spectate({ live: { match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 600,
                                       ends_t: Date.now() + 540_000, score: { blue: 40, yellow: 32 }, rows: manyRows(12) } } as Partial<State>);
    expect(m.find('[data-spectate="row"]').length, 'all twelve are rendered, none dropped').toBe(12);
    const small = m.find('[data-spectate] *')
      .filter(el => (el.textContent ?? '').trim() && el.children.length === 0)
      .map(el => ({ t: (el.textContent ?? '').trim(), px: fontOf(el) }))
      .filter(x => !(x.px >= 16));      // NaN (a size jsdom could not parse) fails this too
    expect(small.map(x => `${x.t}@${x.px}px`).join(' | ')).toBe('');
    m.unmount();
  });

  it('the board region is sized to the viewport, not to the roster', async () => {
    await resizeTo(1280, 800);
    const m = await spectate();
    const frame = m.find('[data-spectate="board"]')[0];
    // one viewport tall, and what does not fit is not there — a projector cannot be scrolled
    expect(frame.style.height).toBe('100vh');
    expect(getComputedStyle(frame).overflow).toBe('hidden');
    const rows = m.find('[data-spectate="rows"]')[0];
    expect(rows.style.flex, 'the rows take the space that is left').toBe('1 1 0px');
    expect(rows.style.minHeight, 'and may shrink below their content').toBe('0px');
    expect(getComputedStyle(rows).overflow).toBe('hidden');
    m.unmount();
  });

  it('a phone still scrolls — the fit rule is for a projector', async () => {
    await resizeTo(393, 830);
    const m = await spectate();
    const frame = m.find('[data-spectate="board"]')[0];
    expect(frame.style.height, 'clipping a phone at one viewport would hide the feed').toBe('');
    expect(frame.style.minHeight).toBe('100vh');
    m.unmount();
  });

  it('the type shrinks with the screen and stops at its floor', async () => {
    await resizeTo(1920, 1080);
    const tall = await spectate();
    const bigRow = fontOf(tall.find('[data-spectate="row"] span')[0]);
    tall.unmount();
    await resizeTo(1280, 800);
    const short = await spectate();
    const smallRow = fontOf(short.find('[data-spectate="row"] span')[0]);
    short.unmount();
    expect(bigRow, `1080p row ${bigRow}px vs 800p ${smallRow}px`).toBeGreaterThan(smallRow);
    expect(smallRow).toBeGreaterThanOrEqual(16);
    expect(bigRow).toBeLessThanOrEqual(26);
  });

  it('MC going offline freezes the WHOLE board, not just the clock', async () => {
    // A room reads a full-strength scoreboard as the live score. When the link drops, every number on
    // it is whatever was true when it dropped — so the treatment belongs on all of them, and the
    // reason has to be readable from the back (review 2026-09-12).
    const m = await spectate({}, { connected: false });
    const tag = m.find('[data-spectate="frozen"]')[0];
    expect(tag, 'a tag that says why').toBeTruthy();
    expect(tag.textContent).toContain('FROZEN · MC OFFLINE');
    expect(fontOf(tag), 'and it is legible across the room too').toBeGreaterThanOrEqual(16);
    const frame = m.find('[data-spectate="board"]')[0];
    expect(frame.getAttribute('data-frozen')).toBe('1');
    const content = m.find('[data-spectate="content"]')[0];
    expect(parseFloat(getComputedStyle(content).opacity), 'the scores are dimmed, all of them').toBeLessThan(0.75);
    // the tag itself must NOT be inside the dimming, or the explanation is the faintest thing on screen
    expect(content.contains(tag)).toBe(false);
    m.unmount();
  });

  it('and looks normal while MC is there', async () => {
    const m = await spectate();
    expect(m.find('[data-spectate="frozen"]').length).toBe(0);
    expect(m.find('[data-spectate="board"]')[0].getAttribute('data-frozen')).toBe('0');
    expect(parseFloat(getComputedStyle(m.find('[data-spectate="content"]')[0]).opacity)).toBe(1);
    m.unmount();
  });

  it('holds NO control that can touch the match', async () => {
    const m = await spectate();
    // Not "no END button" — NO button at all that posts anything. The screen is a projector target:
    // a stranger will touch it, and the operator will not be standing there.
    const clickable = m.find('button, a[href], input, [role="button"]');
    expect(clickable.map(c => (c.textContent ?? '').trim()).join(' | ')).toBe('');
    expect(m.text()).not.toMatch(/END MATCH|RECALL|PANIC|ABORT|NEW MATCH/);
    m.unmount();
  });

  it('shows the RESULT after the whistle, not a live table with a stopped clock', async () => {
    // Both MCs keep sending `live` through the recap phase, so "no live block" never arrives: the
    // board has to read the PHASE. Without this the room watched a frozen scoreboard and the result
    // card was only ever seen in tests (review 2026-09-12).
    const d = await demo();
    const live: LiveView = { match_id: 'm1', go_live_t: Date.now() - 600_000, time_limit_s: 600,
                             ends_t: Date.now(), score: { blue: 9, yellow: 4 }, rows: [row()] };
    const recap = {
      winner: { team_id: 'blue' }, score: { blue: 9, yellow: 4 },
      rows: [{ player_id: 'p1', display: 'VIPER', team_id: 'blue', kills: 9, deaths: 3, assists: 2,
               shots: 40, hits: 14, accuracy: 35, kd: 3, streak: 0, best_streak: 9, medals: ['MVP'] }],
      honors: [], provisional: false, missing: [],
    };
    const store = makeStore({ ...d, state: { ...d.state, phase: 'recap', live, recap } as State, view: 'live' });
    const m = await mount(<StoreCtx.Provider value={store}><Spectate /></StoreCtx.Provider>);
    expect(m.find('[data-spectate="final"]').length, 'the result card').toBe(1);
    expect(m.text()).toMatch(/WINS|TIE/);
    expect(m.find('[data-spectate="clock"]').length, 'and no clock still counting a finished match').toBe(0);
    m.unmount();
  });

  it('and keeps showing the live table while the match is still live', async () => {
    // The control: a real MC sends `recap` during `live` too (it is the running result), and that
    // must not take the live board away mid-match.
    const d = await demo();
    const m = await spectate({ recap: { winner: {}, score: {}, rows: [], honors: [], provisional: true, missing: [] } } as Partial<State>);
    void d;
    expect(m.find('[data-spectate="final"]').length).toBe(0);
    expect(m.find('[data-spectate="clock"]').length).toBe(1);
    m.unmount();
  });

  it('renders with no match live instead of blanking the projector', async () => {
    const d = await demo();
    const store = makeStore({ ...d, state: { ...d.state, phase: 'lobby', live: undefined }, view: 'live' });
    const m = await mount(<StoreCtx.Provider value={store}><Spectate /></StoreCtx.Provider>);
    expect(m.text().trim().length).toBeGreaterThan(0);
    m.unmount();
  });

  it('survives a snapshot with no rows and no teams (an older or starved server)', async () => {
    const d = await demo();
    const live: LiveView = { match_id: 'm1', go_live_t: Date.now(), time_limit_s: 600, ends_t: Date.now() + 1000, score: {}, rows: [] };
    const store = makeStore({ ...d, state: { ...d.state, phase: 'live', live, teams: [] }, view: 'live' });
    const m = await mount(<StoreCtx.Provider value={store}><Spectate /></StoreCtx.Provider>);
    expect(m.text().trim().length).toBeGreaterThan(0);
    m.unmount();
  });
});
