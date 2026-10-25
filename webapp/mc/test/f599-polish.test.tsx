import { describe, expect, it } from 'vitest';
import { CommandBar } from '../src/frame/CommandBar';
import { InPlayBanner } from '../src/screens/Lobby';
import { SlotCard } from '../src/screens/kit/cards';
import { StoreCtx } from '../src/store';
import { demo, makeStore, mount } from './harness';

describe('F599 screen copy', () => {
  it('opens the in-play reason on a tap', async () => {
    const m = await mount(<InPlayBanner screen="kit" phase="live" headline="ROSTER LOCKED" why="MC refuses a team move." onGo={() => {}} />);
    expect(m.text()).not.toContain('MC refuses a team move.');
    await m.click('Why?');
    expect(m.text()).toContain('MC refuses a team move.');
    m.unmount();
  });

  it('keeps the empty player slot clear and gives the required primary a fault pill', async () => {
    const m = await mount(<SlotCard label="PRIMARY" slot="primary" active={false} onClick={() => {}} rule={{ choice: 'player' }} kind="none" required />);
    expect(m.text()).not.toContain('PLAYER PICKS · YOU CAN OVERRIDE');
    const fault = m.find('[data-alert="kit-primary-required"]')[0];
    expect(fault?.getAttribute('data-sev')).toBe('red');
    expect(fault?.textContent).toContain('Primary required');
    m.unmount();
  });

  it('shows one tunnel failure in the command bar when auto backhaul also failed', async () => {
    const d = await demo();
    const pub = { ...d.state.lan.public!, status: 'error' as const, error: 'tunnel refused', auto: { reason: 'kit' as const, cellular: 0, error: 'tunnel refused' } };
    const state = { ...d.state, lan: { ...d.state.lan, public: pub } };
    const m = await mount(<StoreCtx.Provider value={makeStore({ ...d, state })}><CommandBar /></StoreCtx.Provider>);
    expect(m.find('[data-alert="frame-tunnel-down"]')).toHaveLength(1);
    expect(m.find('[data-testid="backhaul-status"]')).toHaveLength(0);
    m.unmount();
  });
});
