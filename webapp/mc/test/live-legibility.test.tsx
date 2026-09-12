// S24 — the LIVE board's legibility, and the A24 row fields it must read.
//
// Game test 2026-09-11 (D4): the LIVE table's headers are 9 px `T.micro` under 14–16 px values, K/D/A
// are three identical 40 px columns with no grouping, and **STK shows the CURRENT streak** — the same
// defect as the HUD's B3: `streak` is 0 for whoever died last, so a 9-kill row reads "streak 0".
// `best_streak` is the number to show (A24). ACC has to say when it has not settled (F119) instead of
// presenting a spike as fact. And the digits must not jitter: no product font has tabular figures
// (A5 — the HUD made exactly this assumption with Saira Condensed and it was false), so `TAB` in
// tokens.ts is a lie and the numbers need a fixed-width cell of their own.
//
// Every assertion here is what the operator SEES — rendered text, computed font size, a measured cell
// width — not what the fixture holds.
import { describe, expect, it } from 'vitest';
import { Live } from '../src/screens/Live';
import { Recap } from '../src/screens/Recap';
import { Num } from '../src/ui/Num';
import type { FeedEntry, LiveRow, LiveView, RecapView, ScoreRow, State } from '../src/api/types';
import { demo, makeStore, mount, mountScreen } from './harness';
import { StoreCtx } from '../src/store';

const row = (over: Partial<LiveRow> = {}): LiveRow => ({
  player_id: 'p1', display: 'VIPER', team_id: 'blue',
  kills: 9, deaths: 3, assists: 2, shots: 40, hits: 14, accuracy: 35, kd: 3, streak: 0, medals: [],
  status: 'alive', sync_age_ms: 1200, ...over,
});
const liveView = (rows: LiveRow[]): LiveView => ({
  match_id: 'm1', go_live_t: Date.now() - 60_000, time_limit_s: 600,
  ends_t: Date.now() + 540_000, score: { blue: 9, yellow: 4 }, rows,
});

async function liveScreen(rows: LiveRow[], feed: FeedEntry[] = []) {
  const d = await demo();
  const state: State = { ...d.state, phase: 'live', live: liveView(rows) };
  const store = makeStore({ ...d, state, view: 'live' }, { feed });
  const m = await mount(<StoreCtx.Provider value={store}><Live /></StoreCtx.Provider>);
  return m;
}

describe('S24 · the LIVE board is readable', () => {
  it('every meaning-bearing header is at least 11px', async () => {
    const m = await liveScreen([row()]);
    const heads = m.find('[data-col-head]');
    expect(heads.length).toBeGreaterThan(5);
    for (const h of heads) {
      const px = parseFloat(getComputedStyle(h).fontSize);
      expect(px, `header "${h.textContent}" is ${px}px`).toBeGreaterThanOrEqual(11);
    }
    m.unmount();
  });

  it('the numeric block is grouped, not one undifferentiated run of columns', async () => {
    const m = await liveScreen([row()]);
    // K·D·A | K/D·ACC | STK — the groups are marked on the cells so a rule can be drawn between them
    // and a test can prove the grouping exists rather than eyeballing a screenshot.
    const groups = new Set(m.find('[data-col-head]').map(h => h.getAttribute('data-group')));
    groups.delete(null);
    expect(groups.size, `saw groups ${[...groups].join(',')}`).toBeGreaterThanOrEqual(3);
    m.unmount();
  });

  it('the group rule opens the same columns on a row as it does in the header', async () => {
    // The cells used to carry hand-written indexes into the column list (`groupEdge(5)` for ACC), so
    // inserting or reordering a column drew the rules in the wrong places with nothing to fail. Both
    // now come from the column model, and this is what says so: the rule is in the same place twice.
    const m = await liveScreen([row()]);
    const ruledHeads = m.find('[data-col-head]')
      .filter(h => parseFloat(getComputedStyle(h).borderLeftWidth || '0') > 0)
      .map(h => h.getAttribute('data-col-head'));
    const ruledCells = m.find('[data-cell]')
      .filter(c => parseFloat(getComputedStyle(c).borderLeftWidth || '0') > 0)
      .map(c => c.getAttribute('data-cell'));
    expect(ruledHeads.length, `headers opening a group: ${ruledHeads.join(',')}`).toBeGreaterThanOrEqual(3);
    // every ruled CELL is a ruled header (`status`/`sync` have no data-cell, so this is a subset)
    expect(ruledCells.filter(k => !ruledHeads.includes(k)), `cells ruled where the header is not`).toEqual([]);
    expect(ruledCells).toContain('kd');
    expect(ruledCells).toContain('stk');
    m.unmount();
  });

  it('STK shows best_streak, not the current streak', async () => {
    // The F116 shape exactly: 9 kills, and `streak` 0 because this player died last.
    const m = await liveScreen([row({ streak: 0, best_streak: 9 })]);
    expect(m.find('[data-cell="stk"]')[0].textContent).toBe('9');
    m.unmount();
  });

  it('STK falls back to the current streak on a server that has no best_streak', async () => {
    const { best_streak: _drop, ...noBest } = row({ streak: 4 });
    void _drop;
    const m = await liveScreen([noBest as LiveRow]);
    expect(m.find('[data-cell="stk"]')[0].textContent).toBe('4');
    m.unmount();
  });

  it('ACC is marked as settling while acc_provisional, and plain once it is not', async () => {
    const prov = await liveScreen([row({ accuracy: 140, acc_provisional: true })]);
    const cell = prov.find('[data-cell="acc"]')[0];
    expect(cell.getAttribute('data-provisional')).toBe('1');
    // "~35%" — the mark leads the number the way an approximate value is written everywhere else.
    // "35%~" was a unit nobody uses (review 2026-09-12).
    expect(cell.textContent).toBe('~140%');
    expect(cell.getAttribute('title') ?? '').toMatch(/settl/i);
    prov.unmount();

    const settled = await liveScreen([row({ accuracy: 35, acc_provisional: false })]);
    const c2 = settled.find('[data-cell="acc"]')[0];
    expect(c2.getAttribute('data-provisional')).toBe('0');
    expect(c2.textContent).toBe('35%');
    settled.unmount();
  });

  it('an alert feed row is styled apart from a kill row', async () => {
    const m = await liveScreen([row()], [
      { t_match_s: 90, text: 'RED takes the lead', kind: 'alert', tag: 'ALERT' },
      { t_match_s: 80, text: 'VIPER eliminated GHOST', kind: 'kill' },
    ]);
    const rows = m.find('[data-feed-kind]');
    expect(rows.map(r => r.getAttribute('data-feed-kind'))).toEqual(['alert', 'kill']);
    const alert = rows[0], kill = rows[1];
    expect(getComputedStyle(alert).borderLeftColor).not.toBe(getComputedStyle(kill).borderLeftColor);
    expect(alert.textContent).toContain('RED takes the lead');   // verbatim — F118: never re-word it
    m.unmount();
  });

  it('offers the spectator board in a new tab, carrying the query string', async () => {
    const m = await liveScreen([row()]);
    const link = m.find('[data-spectate-link]')[0] as HTMLAnchorElement;
    expect(link, 'a SPECTATE link on LIVE').toBeTruthy();
    expect(link.getAttribute('href')).toContain('#spectate');
    expect(link.getAttribute('target')).toBe('_blank');
    // a new tab reached through an anchor must not hand the opener over
    expect(link.getAttribute('rel')).toContain('noopener');
    m.unmount();
  });

  it('a WITHHELD alert says it did not reach the players', async () => {
    const m = await liveScreen([row()], [
      { t_match_s: 90, text: 'RED takes the lead', kind: 'alert', tag: 'WITHHELD' },
    ]);
    expect(m.text()).toContain('WITHHELD');
    m.unmount();
  });
});

describe('the digit cell', () => {
  it('gives every digit the same width, so a changing value cannot re-lay-out', async () => {
    const m = await mount(<Num value={188} />);
    const cells = m.find('[data-digit]');
    expect(cells.map(c => c.textContent)).toEqual(['1', '8', '8']);
    const widths = new Set(cells.map(c => c.style.width));
    expect(widths.size, `digit widths ${[...widths].join(',')}`).toBe(1);
    expect(cells[0].style.display).toBe('inline-block');
    expect(cells[0].style.textAlign).toBe('center');
    m.unmount();
  });

  it('keeps separators and units at their natural width', async () => {
    const m = await mount(<Num value="04:37" />);
    expect(m.text()).toBe('04:37');
    // the colon is NOT in a digit cell — a fixed cell around a colon reads as a gap
    expect(m.find('[data-digit]').map(c => c.textContent)).toEqual(['0', '4', '3', '7']);
    m.unmount();
  });

  it('renders the whole value as text for a screen reader', async () => {
    const m = await mount(<Num value={42} />);
    expect(m.el.textContent).toBe('42');
    m.unmount();
  });

  // The `aria-label` exists so a screen reader says "forty-two" instead of walking the digit cells.
  // On a BARE <span> it does nothing at all: a span maps to role `generic`, and accname §5.2 forbids
  // naming a generic element from the author, so the label is discarded and the name falls back to
  // the contents — the exact announcement it was added to prevent. jsdom computes no accessible
  // name, so the rule is spelled out here rather than asserted through a stub that agrees with us.
  const NAMEABLE = new Set(['img', 'button', 'link', 'status', 'group', 'region', 'heading', 'meter', 'progressbar', 'math']);
  const roleOfEl = (el: HTMLElement) => el.getAttribute('role')
    ?? (el.tagName === 'SPAN' || el.tagName === 'DIV' ? 'generic' : el.tagName.toLowerCase());
  const nameOf = (el: HTMLElement) => {
    const label = el.getAttribute('aria-label');
    return label && NAMEABLE.has(roleOfEl(el))
      ? { name: label, from: 'aria-label' }
      : { name: (el.textContent ?? '').trim(), from: 'contents' };
  };

  it('is named by its label, on a role that may actually carry one', async () => {
    const m = await mount(<Num value={42} />);
    const el = m.el.firstElementChild as HTMLElement;
    expect(el.getAttribute('aria-label')).toBe('42');
    expect(roleOfEl(el), 'role `generic` may not be named by the author').not.toBe('generic');
    expect(NAMEABLE.has(roleOfEl(el)), `role "${roleOfEl(el)}" allows a name from the author`).toBe(true);
    expect(nameOf(el)).toEqual({ name: '42', from: 'aria-label' });
    m.unmount();
  });

  it('does not turn the board into a field of images for a screen reader', async () => {
    // role="img" is the naming device, not a claim that there is a picture — it must stay on the
    // value itself and never wrap a whole row or cell.
    const m = await mount(<Num value="04:37" />);
    expect(m.find('[role="img"]').length, 'exactly one: the value, not its digit cells').toBe(1);
    expect(m.find('[data-digit][role="img"]').length, 'never the individual cells').toBe(0);
    m.unmount();
  });
});

describe('RECAP reads the A24 fields too', () => {
  const scoreRow = (over: Partial<ScoreRow> = {}): ScoreRow => ({
    player_id: 'p1', display: 'VIPER', team_id: 'blue', kills: 9, deaths: 3, assists: 2,
    shots: 40, hits: 14, accuracy: 35, kd: 3, streak: 0, medals: ['MVP'], ...over,
  });
  const recap = (over: Partial<RecapView> = {}): RecapView => ({
    winner: { team_id: 'blue' }, score: { blue: 9, yellow: 4 }, rows: [scoreRow({ best_streak: 9 })],
    honors: [{ award: 'MVP', player_id: 'p1', stat: '9 K' }], provisional: false, missing: [], ...over,
  });
  async function recapScreen(rc: RecapView) {
    const d = await demo();
    const state: State = { ...d.state, phase: 'recap', recap: rc, live: undefined };
    const m = await mountScreen(<Recap />, { ...d, state, view: 'recap', api: { matchHistory: async () => [] } });
    // the roster is the fresher source for a LIVE recap, so `p1` resolves to whatever the demo
    // session calls that player — the test asserts a NAME, not the id, without hard-coding it
    return Object.assign(m, { nameOfP1: state.players.find(p => p.player_id === 'p1')?.display ?? 'p1' });
  }

  it('STK is the longest streak of the match', async () => {
    const m = await recapScreen(recap());
    expect(m.find('[data-cell="stk"]')[0].textContent).toBe('9');
    m.unmount();
  });

  it('shows the after-the-whistle facts as recorded, not counted', async () => {
    const m = await recapScreen(recap({
      after_end: { facts: 3, by_player: { p1: { kills: 1, deaths: 0 } } },
    }));
    const block = m.find('[data-testid="after-end"]')[0];
    expect(block, 'the after_end block rendered').toBeTruthy();
    expect(block.textContent).toMatch(/AFTER THE WHISTLE/);
    expect(block.textContent).toMatch(/RECORDED, NOT COUNTED/i);
    expect(block.textContent).toContain(m.nameOfP1);   // the player by NAME
    expect(block.textContent).not.toMatch(/\bp1\b/);   // never the wire id
    m.unmount();
  });

  // "3 FACTS RECORDED" is what the SCORER calls a recorded event. The operator reading this screen
  // out loud is talking about kills and deaths that landed late (review 2026-09-12).
  it('counts what landed in words the operator uses, not wire vocabulary', async () => {
    const m = await recapScreen(recap({ after_end: { facts: 3, by_player: { p1: { kills: 1, deaths: 0 } } } }));
    const block = m.find('[data-testid="after-end"]')[0];
    expect(block.textContent).toContain('3 LATE KILLS / DEATHS');
    expect(block.textContent).not.toMatch(/FACTS? RECORDED/);
    m.unmount();
  });

  it('says it in the singular for one', async () => {
    const m = await recapScreen(recap({ after_end: { facts: 1, by_player: { p1: { kills: 1, deaths: 0 } } } }));
    expect(m.find('[data-testid="after-end"]')[0].textContent).toContain('1 LATE KILL / DEATH');
    m.unmount();
  });

  it('renders nothing at all when the server did not send the block', async () => {
    const m = await recapScreen(recap());
    expect(m.find('[data-testid="after-end"]').length).toBe(0);
    expect(m.find('[data-testid="after-end-count"]').length).toBe(0);
    m.unmount();
  });

  it('renders nothing when nothing landed late — not an empty titled block', async () => {
    // The ordinary case: the server sends the breakdown and it is empty. A section headed AFTER THE
    // WHISTLE saying NOTHING ATTRIBUTED TO A PLAYER is a paragraph about nothing having happened.
    const m = await recapScreen(recap({ after_end: { facts: 0, by_player: {} } }));
    expect(m.find('[data-testid="after-end"]').length).toBe(0);
    expect(m.text()).not.toMatch(/AFTER THE WHISTLE/);
    m.unmount();
  });

  it('an older MC that sends only the count still gets its count said', async () => {
    // `post_end_facts` is the field MC has always sent. Dropping it because the A6.1 breakdown is
    // absent threw away a fact the server HAD reported.
    const m = await recapScreen(recap({ post_end_facts: 2 }));
    const block = m.find('[data-testid="after-end-count"]')[0];
    expect(block, 'the bare count is still worth saying').toBeTruthy();
    expect(block.textContent).toContain('2 LATE KILLS / DEATHS');
    expect(block.textContent).toMatch(/RECORDED, NOT COUNTED/i);
    expect(m.find('[data-testid="after-end"]').length, 'and no per-player split is invented').toBe(0);
    m.unmount();
  });

  it('an older MC with nothing late renders nothing', async () => {
    const m = await recapScreen(recap({ post_end_facts: 0 }));
    expect(m.find('[data-testid="after-end-count"]').length).toBe(0);
    m.unmount();
  });
});
