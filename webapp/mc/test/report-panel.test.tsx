// "Report a problem" — reachable from the command bar menu in every phase, including live (a bug can
// happen mid-match) and even a phase the demo has never modelled (the control does not read `state`
// at all). Screen-truth per the ui-build-verify skill: every assertion here is what the operator SEES
// (the dialog's copy, the busy line, the download/issue controls, the error banner), never internal
// state, so a broken control fails the test.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { AuthError } from '../src/api/client';
import type { ReportResult } from '../src/api/types';
import { CommandBar } from '../src/frame/CommandBar';
import { StoreCtx, type Store } from '../src/store';
import { demo, fixtureApi, makeStore, mount, type Mounted } from './harness';

const RESULT: ReportResult = {
  file: 'mc-report-2026-09-18.zip',
  download: '/api/report/mc-report-2026-09-18.zip',
  issue_url: 'https://github.com/tony99nyr/open-brx/issues/new?title=Mission+Control+bug+report',
  summary: { phase: 'kit', players: 4 },
  removed: { names: 4, tagger_ids: 3, ip_addresses: 1, access_code: 1 },
  too_large: false,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const panel = (m: Mounted) => m.find('[data-testid="report-panel"]')[0];

async function openPanel(makeReport: () => Promise<ReportResult>, phase: 'muster' | 'live' = 'muster', base: Partial<Store> = {}) {
  const d = await demo();
  const api = fixtureApi({ makeReport });
  const state = { ...d.state, phase };
  const store = makeStore({ ...d, state, view: phase }, { api, ...base });
  const m = await mount(<StoreCtx.Provider value={store}><CommandBar /></StoreCtx.Provider>);
  await m.click('☰');
  await m.click('Report a problem');
  return Object.assign(m, { store });
}

describe('Report a problem', () => {
  it('is reachable from the menu in muster and in a live match alike', async () => {
    for (const phase of ['muster', 'live'] as const) {
      const m = await openPanel(async () => RESULT, phase);
      expect(panel(m), `the dialog opens from ${phase}`).toBeTruthy();
      m.unmount();
    }
  });

  it('idle: explains what happens, and what is NOT scrubbed, before anything is made', async () => {
    const m = await openPanel(async () => RESULT);
    const p = panel(m);
    expect(p.getAttribute('data-report-phase')).toBe('idle');
    const t = p.textContent ?? '';
    expect(t.toLowerCase()).toMatch(/names, tagger ids, ip addresses and the access code are removed/);
    expect(t.toLowerCase()).toMatch(/github issues are public/);
    // the scrub is not total: team/game names typed by the operator survive, and the panel says so
    expect(t.toLowerCase()).toMatch(/short names, numbers and text you typed/);
    expect(t.toLowerCase()).toMatch(/team and game names/);
    expect(m.find('[data-testid="report-panel"] button').some(b => (b.textContent ?? '').includes('MAKE REPORT'))).toBe(true);
    m.unmount();
  });

  it('busy: shows progress while the request is in flight, and nothing else yet', async () => {
    const d = deferred<ReportResult>();
    const m = await openPanel(() => d.promise);
    await m.click('MAKE REPORT');
    expect(panel(m).getAttribute('data-report-phase')).toBe('busy');
    expect(panel(m).textContent ?? '').toMatch(/MAKING REPORT/i);
    d.resolve(RESULT);
    m.unmount();
  });

  it('done: offers a download and a real, new-tab GitHub issue link, and names the removed facts', async () => {
    const m = await openPanel(async () => RESULT);
    await m.click('MAKE REPORT');
    const p = panel(m);
    expect(p.getAttribute('data-report-phase')).toBe('done');
    expect((p.textContent ?? '')).toMatch(/DOWNLOAD REPORT/i);
    const issueLink = p.querySelector('a[href*="github.com"]') as HTMLAnchorElement;
    expect(issueLink, 'a real anchor, not a synthetic window.open').toBeTruthy();
    expect(issueLink.getAttribute('href')).toBe(RESULT.issue_url);
    expect(issueLink.getAttribute('target')).toBe('_blank');
    expect(issueLink.getAttribute('rel')).toContain('noopener');
    expect((p.textContent ?? '')).toMatch(/drag the downloaded file into the issue/i);
    expect((p.textContent ?? '')).toMatch(/4 names/i);
    m.unmount();
  });

  it('done: an oversized report is never described as trimmed — the server does not trim it', async () => {
    const m = await openPanel(async () => ({ ...RESULT, too_large: true }));
    await m.click('MAKE REPORT');
    const t = (panel(m).textContent ?? '').toLowerCase();
    expect(t).toMatch(/larger than 25 mb/);
    expect(t).toMatch(/github's limit for an attachment/);
    expect(t).toMatch(/make the issue anyway/);
    expect(t).not.toMatch(/trim/);
    m.unmount();
  });

  it('error: an old server (404/405) shows a clear message, never a silent failure', async () => {
    const skew = new Error('This Mission Control is too old to make reports: update it with ./start.sh');
    const m = await openPanel(async () => { throw skew; });
    await m.click('MAKE REPORT');
    const p = panel(m);
    expect(p.getAttribute('data-report-phase')).toBe('error');
    expect(p.querySelector('[role="alert"]')?.textContent ?? '').toContain('too old to make reports');
    expect(m.find('[data-testid="report-panel"] button').some(b => (b.textContent ?? '').includes('TRY AGAIN'))).toBe(true);
    m.unmount();
  });

  it('error: any other rejection shows its own message, not a swallowed failure', async () => {
    const m = await openPanel(async () => { throw new Error('mc unreachable'); });
    await m.click('MAKE REPORT');
    expect(panel(m).querySelector('[role="alert"]')?.textContent ?? '').toContain('mc unreachable');
    m.unmount();
  });

  it('Escape closes the dialog', async () => {
    const m = await openPanel(async () => RESULT);
    expect(panel(m)).toBeTruthy();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(panel(m)).toBeFalsy();
    m.unmount();
  });

  it('the close button (✕) also dismisses it', async () => {
    const m = await openPanel(async () => RESULT);
    await m.click('✕');
    expect(panel(m)).toBeFalsy();
    m.unmount();
  });

  // A 401 mid-report used to land on "TRY AGAIN", which can only 401 again — the real fix (the
  // operator token) lives on a screen this modal covers. The panel must send the operator there
  // itself, not strand them behind an overlay pointed at a control they cannot reach.
  it('a 401 sends the operator to the token control instead of a dead-end retry', async () => {
    const seenViews: string[] = [];
    const m = await openPanel(async () => { throw new AuthError(); }, 'muster', { setView: v => seenViews.push(v) });
    await m.click('MAKE REPORT');
    const p = panel(m);
    expect(p.getAttribute('data-report-phase')).toBe('auth');
    expect((p.textContent ?? '').toLowerCase()).toMatch(/operator token required/);
    expect(m.find('[data-testid="report-panel"] button').some(b => (b.textContent ?? '').includes('TRY AGAIN'))).toBe(false);
    await m.click('ENTER OPERATOR TOKEN');
    expect(seenViews).toContain('debug');           // sent to the screen that holds the token control
    expect(panel(m)).toBeFalsy();                    // and the overlay that was hiding it is gone
    m.unmount();
  });

  it('Tab cycles inside the dialog instead of escaping it to the covered page behind', async () => {
    const m = await openPanel(async () => RESULT);
    const p = panel(m);
    const buttons = p.querySelectorAll('button');
    const first = buttons[0] as HTMLElement, last = buttons[buttons.length - 1] as HTMLElement;
    last.focus();
    expect(document.activeElement).toBe(last);
    await act(async () => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    expect(document.activeElement, 'Tab off the last control wraps to the first').toBe(first);
    await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement, 'Shift+Tab off the first control wraps to the last').toBe(last);
    m.unmount();
  });
});
