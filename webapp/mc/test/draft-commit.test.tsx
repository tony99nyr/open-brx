import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftText } from '../src/ui';
import { Kit } from '../src/screens/Kit';
import { demo, mount, mountScreen } from './harness';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function editAndCommit(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  });
}

async function checkSecondCommit(input: HTMLInputElement) {
  await editAndCommit(input, input.getAttribute('aria-label') === 'player number (1–63)' ? '8' : 'second');
  await act(async () => { vi.advanceTimersByTime(900); });
  await editAndCommit(input, input.getAttribute('aria-label') === 'player number (1–63)' ? '9' : 'third');
  await act(async () => { vi.advanceTimersByTime(600); });
  expect(input.value).toBe(input.getAttribute('aria-label') === 'player number (1–63)' ? '9' : 'third');
}

async function expectUnmountClearsTimer(input: HTMLInputElement, unmount: () => void) {
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  await editAndCommit(input, input.getAttribute('aria-label') === 'player number (1–63)' ? '8' : 'second');
  unmount();
  expect(clear).toHaveBeenCalled();
}

describe('shared draft commit timer', () => {
  it('DraftText replaces the earlier revert after a second commit', async () => {
    vi.useFakeTimers();
    const m = await mount(<DraftText value="first" onCommit={() => {}} />);
    await checkSecondCommit(m.find('input')[0] as HTMLInputElement);
    m.unmount();
  });

  it('PlayerNum replaces the earlier revert after a second commit', async () => {
    vi.useFakeTimers();
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: 'p1' });
    const input = m.find('input[aria-label="player number (1–63)"]')[0] as HTMLInputElement;
    await checkSecondCommit(input);
    m.unmount();
  });

  it('DraftText clears its revert on unmount', async () => {
    vi.useFakeTimers();
    const m = await mount(<DraftText value="first" onCommit={() => {}} />);
    await expectUnmountClearsTimer(m.find('input')[0] as HTMLInputElement, m.unmount);
  });

  it('PlayerNum clears its revert on unmount', async () => {
    vi.useFakeTimers();
    const d = await demo();
    const m = await mountScreen(<Kit />, { ...d, view: 'kit', selPlayer: 'p1' });
    const input = m.find('input[aria-label="player number (1–63)"]')[0] as HTMLInputElement;
    await expectUnmountClearsTimer(input, m.unmount);
  });
});
