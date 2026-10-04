// F458 (mc-vqa2 "no console/page errors" flaked in the land lane): an Alert whose severity changes on a re-render
// changed its `font` shorthand while `lineHeight` sat beside it, and React warns ("Updating font ... when a
// conflicting property is set (lineHeight)"). The line height now rides inside the font shorthand.
import { describe, expect, it, vi } from 'vitest';
import { Alert } from '../src/ui/Alert';
import { mount } from './harness';

const conflict = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.some(c => c.map(String).join(' ').includes('conflicting property'));

describe('an Alert re-rendered at another severity', () => {
  it('raises no shorthand/longhand style warning', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = await mount(<Alert sev="neutral">SAVING</Alert>);
    await m.update(<Alert sev="amber">NOT SAVING: CHECK THE DISK</Alert>);
    await m.update(<Alert sev="neutral">SAVING</Alert>);
    expect(conflict(spy)).toBe(false);
    spy.mockRestore();
  });
  it('raises none when the caller passes its own line height either', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = await mount(<Alert sev="neutral" style={{ lineHeight: 1.45 }}>A</Alert>);
    await m.update(<Alert sev="amber" style={{ lineHeight: 1.45 }}>B</Alert>);
    expect(conflict(spy)).toBe(false);
    spy.mockRestore();
  });
});
