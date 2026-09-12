// F129 — what the console does at 393 px, the width Tony's phone actually is.
//
// The round-2 review walked the whole console at 393 px in a real browser and found three things
// that a desk never shows, each measured:
//
//   · the LIVE board is 783 px of columns in a 345 px box and the spectator board 613 px in 325 px.
//     Both simply stopped at K/D with no edge, no scrollbar (a touch scrollbar is invisible until
//     you drag) and nothing saying there was more. Now a hint says which way to go and the cut edge
//     fades — `<ScrollX>` in `ui/index.tsx`.
//   · a notice in the command bar took the width of the one nowrap row it shared with the phase tag
//     and NEW MATCH, squeezing "NEW MATCH ▸" onto three lines: a 72 px button. The toasts take a row
//     of their own on a phone now (`.cb-notices`).
//   · the KIT roster becomes a horizontal strip of 210 px rows, and `min-width:auto` let a row grow
//     to its content — so the first row's READY tag sat at x=407 on a 393 px screen, off the edge.
//
// jsdom LAYS NOTHING OUT: `scrollWidth` is 0, no media query applies, and every box is 0×0. So each
// test here asserts the MECHANISM that fixes the measured defect — the hint element exists, the
// toasts are not in the row with the primary button, the tag cannot shrink, the media rules are in
// the stylesheet — and `test/e2e/m2-ui.mjs` re-measures the pixels at 393 px in Chromium. Neither
// half is the proof on its own.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandBar } from '../src/frame/CommandBar';
import { clearNotice, setNotice } from '../src/notice';
import { Kit } from '../src/screens/Kit';
import { Live } from '../src/screens/Live';
import { Spectate } from '../src/screens/Spectate';
import type { LiveRow, LiveView, State } from '../src/api/types';
import { demo, makeStore, mount } from './harness';
import { StoreCtx } from '../src/store';

// The stylesheet itself, read as text: jsdom applies no media query and computes no mask, so the
// RULE is the only artefact a unit test can hold. (vitest runs with the project root as cwd.)
const CSS = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');

const row = (over: Partial<LiveRow> = {}): LiveRow => ({
  player_id: 'p1', display: 'VIPER', team_id: 'blue',
  kills: 9, deaths: 3, assists: 2, shots: 40, hits: 14, accuracy: 35, kd: 3, streak: 1,
  best_streak: 5, medals: [], status: 'alive', sync_age_ms: 1200, ...over,
});
const live = (): LiveView => ({
  match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 600,
  ends_t: Date.now() + 540_000, score: { blue: 9, yellow: 4 }, rows: [row()],
});
async function screen(which: 'live' | 'spectate') {
  const d = await demo();
  const state: State = { ...d.state, phase: 'live', live: live() };
  const store = makeStore({ ...d, state, view: 'live' }, { feed: [] });
  return mount(<StoreCtx.Provider value={store}>{which === 'live' ? <Live /> : <Spectate />}</StoreCtx.Provider>);
}

describe('F129 · a board that scrolls sideways says so', () => {
  it('LIVE carries a scroll hint that names what was cut off', async () => {
    const m = await screen('live');
    const hint = m.find('[data-scroll-hint]');
    expect(hint.length, 'one hint, on the board container').toBe(1);
    // it must name the columns past the fold, not just say "scroll" — the operator is looking for
    // a number, and the hint is what tells them it exists
    expect(hint[0].textContent).toMatch(/ACC/);
    expect(hint[0].textContent).toMatch(/STK/);
    m.unmount();
  });

  it('and hides it while there is nothing to scroll to', async () => {
    // jsdom measures 0/0, which is the "it fits" case: the hint is in the DOM (so this test can see
    // it at all) and hidden. A fade or a hint on a table that fits dims its own last column.
    const m = await screen('live');
    expect(m.find('[data-scroll-hint]')[0].hasAttribute('hidden')).toBe(true);
    expect(m.find('[data-scroll-hint]')[0].getAttribute('data-scroll-hint')).toBe('0');
    m.unmount();
  });

  it('the spectator board carries one too, at the size the rest of that board uses', async () => {
    // Everything on the projector board is ≥16px (the legibility rule) and the hint is no exception:
    // it is text a person has to read, on the same screen.
    const m = await screen('spectate');
    const hint = m.find('[data-scroll-hint]');
    expect(hint.length).toBe(1);
    expect(parseFloat(getComputedStyle(hint[0]).fontSize)).toBeGreaterThanOrEqual(16);
    m.unmount();
  });

  it('the cut edge fades only while it is cut', async () => {
    // The class is applied by <ScrollX> when it overflows; the rule that draws the fade has to exist.
    expect(CSS).toMatch(/\.scroll-x\s*\{[^}]*mask-image/);
    const m = await screen('live');
    const box = m.find('[data-scroll-hint]')[0].nextElementSibling as HTMLElement;
    expect(box.style.overflowX, 'the sibling of the hint is the scrolling box').toBe('auto');
    expect(box.className, 'nothing to scroll to in jsdom, so no fade').not.toContain('scroll-x');
    m.unmount();
  });
});

describe('F129 · the command bar toast does not squeeze the primary button', () => {
  async function bar() {
    const d = await demo();
    const store = makeStore({ ...d, state: { ...d.state, phase: 'recap' }, view: 'recap' });
    return mount(<StoreCtx.Provider value={store}><CommandBar /></StoreCtx.Provider>);
  }

  it('the toasts sit in their own group, not in the row with NEW MATCH', async () => {
    setNotice('ASKED FOR THE LOG — THE PHONE ANSWERS WHEN IT IS SAFE TO');
    try {
      const m = await bar();
      const toasts = m.find('.cb-notices');
      expect(toasts.length, 'the toast group exists').toBe(1);
      expect(toasts[0].textContent).toContain('ASKED FOR THE LOG');
      const newMatch = m.find('button').find(b => (b.textContent ?? '').includes('NEW MATCH'));
      expect(newMatch, 'the recap phase offers NEW MATCH').toBeTruthy();
      expect(toasts[0].contains(newMatch!), 'a notice must not share a row with the primary button').toBe(false);
      m.unmount();
    } finally { clearNotice(); }
  });

  it('and take a full row of their own at phone width', async () => {
    // The media query is the fix; jsdom applies no media queries, so the rule itself is the artefact
    // to assert. `flex: 1 1 100%` is what puts them on a line of their own, `order` puts that line
    // under the bar.
    const at = CSS.slice(CSS.indexOf('@media (max-width: 820px)'));
    expect(at).toMatch(/\.cb-notices\s*\{[^}]*flex:\s*1 1 100%/);
    expect(at).toMatch(/\.cb-notices\s*\{[^}]*order:/);
  });

  it('the controls beside them wrap instead of compressing', async () => {
    const m = await bar();
    const newMatch = m.find('button').find(b => (b.textContent ?? '').includes('NEW MATCH'))!;
    const rowEl = newMatch.parentElement as HTMLElement;
    expect(rowEl.style.flexWrap, 'the row holding NEW MATCH may wrap').toBe('wrap');
    m.unmount();
  });
});

describe('F129 · the KIT roster tag stays on the screen', () => {
  it('the READY tag never gives up its width to the callsign beside it', async () => {
    const d = await demo();
    const store = makeStore({ ...d, state: d.state, view: 'kit', selPlayer: 'p1' });
    const m = await mount(<StoreCtx.Provider value={store}><Kit /></StoreCtx.Provider>);
    const rows = m.find('.kit-row');
    expect(rows.length, 'the demo roster renders').toBeGreaterThan(0);
    for (const r of rows) {
      const tag = r.lastElementChild as HTMLElement;
      expect((tag.textContent ?? '').trim(), 'the last cell of a roster row is its status tag').not.toBe('');
      expect(tag.style.flex, `"${tag.textContent}" must not shrink`).toBe('0 0 auto');
      expect(tag.style.whiteSpace).toBe('nowrap');
    }
    m.unmount();
  });

  it('a 210px strip row is 210px wide, content and all', () => {
    // `flex: 0 0 210px` set the BASIS; `min-width:auto` then let the row grow to its content and
    // pushed the tag off a 393px screen. The max-width is what actually pins it.
    const media = CSS.slice(CSS.indexOf('.kit-roster-rows .kit-row'));
    expect(media).toMatch(/\.kit-roster-rows \.kit-row\s*\{[^}]*max-width:\s*210px/);
    expect(media).toMatch(/\.kit-roster-rows \.kit-row\s*\{[^}]*min-width:\s*0/);
  });
});
