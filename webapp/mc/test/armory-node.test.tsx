// ARMORY's phone cards, against the snapshots a real session actually produces.
//
// Found by the F127 e2e walk (2026-09-11) and filed separately: for the first few hundred
// milliseconds of a session a node has said HELLO but has not yet sent a `status`, so it arrives
// with no `arm_state` — and `Armory.tsx` did `n.arm_state.toUpperCase()`, which threw and took the
// WHOLE console to its crash boundary. `NodeView` types the field as required, which is why nobody
// caught it reading the code; the server is simply a step ahead of the type.
//
// The e2e walk had been sleeping 900 ms to get past it. A sleep is not a test — this is.
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import type { NodeView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

/** a node as it arrives between HELLO and its first STATUS: no arm_state, no synced, no battery */
const helloOnly = (node_id: string) => ({ node_id, node_type: 'companion' } as unknown as NodeView);

async function armoryWith(nodes: NodeView[]) {
  const d = await demo();
  const state: State = { ...d.state, nodes };
  return mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
}

describe('ARMORY · a phone that has not reported yet', () => {
  it('renders the card instead of crashing the console', async () => {
    const m = await armoryWith([helloOnly('node-fresh-1')]);
    expect(m.find('[data-node-card]'), 'the node still gets a card').toHaveLength(1);
    expect(m.text(), 'an absent arm_state reads as UNKNOWN, not as a blank tag').toContain('UNKNOWN');
    expect(m.text()).toContain('PHONES ON THE NET // 1');
    m.unmount();
  });

  it('a mix of reported and unreported phones renders every card', async () => {
    const reported = { ...helloOnly('node-armed-2'), arm_state: 'armed', last_seen_ms: 120, synced: true, gun_name: 'ALPHA' } as unknown as NodeView;
    const m = await armoryWith([helloOnly('node-fresh-1'), reported]);
    const cards = m.find('[data-node-card]');
    expect(cards).toHaveLength(2);
    // the section's own count and the cards it rendered must agree — that pair is what the e2e
    // walk waits on instead of sleeping through the first snapshots
    expect(m.find('[data-nodes]')[0].getAttribute('data-nodes')).toBe('2');
    expect(m.text()).toContain('ARMED');
    expect(m.text()).toContain('UNKNOWN');
    m.unmount();
  });

  it('a readiness row with no blockers array does not crash the board either', async () => {
    const d = await demo();
    const board = d.state.readiness.board.map(g => { const { blockers: _drop, ...rest } = g; return rest as typeof g; });
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    expect(m.text()).toContain('Readiness Board');
    m.unmount();
  });
});
