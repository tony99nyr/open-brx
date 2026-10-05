// F494 (CI red at 594870f9, 2026-10-05): ValueBox's commit armed a 1.5 s setTimeout that set state, and nothing
// cleared it. A test file that committed an edit and finished within 1.5 s left the timer to fire after its jsdom was
// torn down ("window is not defined" inside react-dom), which Vitest counts as a failure of whichever file ran last.
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ValueBox } from '../src/ui';
import { mount } from './harness';

async function commitAnEdit(el: HTMLElement, to: string) {
  const inp = el.querySelector('input') as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { inp.focus(); });
  await act(async () => { set.call(inp, to); inp.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { inp.blur(); });
}

/** Track ValueBox's own revert timer (the 1.5 s one) apart from React's scheduler timers. */
function revertTimers() {
  const armed = new Set<unknown>();
  const cleared = new Set<unknown>();
  const st = globalThis.setTimeout, ct = globalThis.clearTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...a: unknown[]) => {
    const id = st(fn, ms, ...a);
    if (ms === 1500) armed.add(id);
    return id;
  }) as typeof setTimeout);
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: unknown) => { cleared.add(id); ct(id as never); }) as typeof clearTimeout);
  return { live: () => [...armed].filter(id => !cleared.has(id)).length, armed: () => armed.size };
}

describe('F494: ValueBox leaves no timer behind', () => {
  it('unmounting after a commit clears the revert timer', async () => {
    const t = revertTimers();
    const sent: number[] = [];
    const m = await mount(<ValueBox value={5} onChange={v => sent.push(v)} />);
    await commitAnEdit(m.el, '9');
    expect(sent).toEqual([9]);                       // control: the commit happened and armed its timer
    expect(t.live()).toBe(1);
    m.unmount();
    expect(t.live()).toBe(0);
    vi.restoreAllMocks();
  });

  it('a second commit replaces the first timer instead of stacking another', async () => {
    const t = revertTimers();
    const m = await mount(<ValueBox value={5} onChange={() => {}} />);
    await commitAnEdit(m.el, '9');
    await commitAnEdit(m.el, '11');
    expect(t.armed()).toBe(2);                       // control: both commits armed one
    expect(t.live()).toBe(1);
    m.unmount();
    vi.restoreAllMocks();
  });
});
