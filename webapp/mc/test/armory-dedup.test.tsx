// F-armory-dedup (operator, bench 2026-09-17): "a linked phone for a rostered player appears twice —
// once as the gun card, once under PHONES ON THE NET. Confusing." PHONES ON THE NET now lists only a
// phone with no bound player, or one bound to a player who is not on the readiness board — everything
// else already has a card above. Anything that used to live ONLY on the hidden node card (the LOGS
// button, the build chip) moved onto the gun card so nothing is lost.
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import type { State } from '../src/api/types';
import { demo, mountScreen } from './harness';

// GUN-B in the mock registry is tail 91C2 (mock/data.ts GUNS) — same fixture armory-claim.test.tsx uses.
const worn = { node_id: 'node_91C2', node_type: 'companion', gun_name: 'GUN-B-91C2', gun_tail: '91C2', arm_state: 'kitted', last_seen_ms: 300, synced: true } as unknown as State['nodes'][number];

describe('ARMORY · a bound phone renders once, not twice', () => {
  it('a rostered, linked phone gets no node card of its own', async () => {
    const d = await demo();
    // the demo's default roster (mock/data.ts) binds every green/amber gun to a player, so this is the
    // ordinary muster board Tony was looking at on the bench — no fixture rigging needed to reproduce it.
    const m = await mountScreen(<Armory />, { ...d, view: 'muster' });
    // every LINKED, rostered row on the board (GUN-D is unpowered and has no phone at all)
    const linkedRows = d.state.readiness.board.filter(g => g.node === 'linked');
    expect(linkedRows.length, 'the demo board has linked rows to test').toBeGreaterThan(0);
    // none of them gets a SEPARATE card under PHONES ON THE NET
    expect(m.find('[data-node-card]').length, 'no phone card duplicates a gun card').toBe(0);
    // the section still says where they went, rather than vanishing with no explanation
    const hidden = m.find('[data-hidden-phones]')[0];
    expect(hidden, 'a quiet line says the phones are on the cards above').toBeTruthy();
    expect(hidden.textContent).toContain(`${linkedRows.length}`);
    expect(hidden.textContent?.toUpperCase()).toContain('ON PLAYER CARDS ABOVE');
    m.unmount();
  });

  it('the gun card carries the LOGS button and the app version the node card used to own alone', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, { ...d, view: 'muster' });
    // LOGS is never gated (A25) and must exist SOMEWHERE for a linked phone now that its own card is hidden
    const pull = m.find('[data-pull-log]')[0];
    expect(pull, 'a LOGS button survives onto the gun card').toBeTruthy();
    expect(pull.getAttribute('data-pull-log'), 'wired to a real node id, not a placeholder').not.toBe('');
    // the build chip (A29) survives too, on the gun card
    const chip = m.find('[data-app-ver]')[0];
    expect(chip, 'a build chip survives onto the gun card').toBeTruthy();
    expect(chip.textContent).toMatch(/0\.1\.\d/);
    m.unmount();
  });
});

describe('ARMORY · an unclaimed phone is unaffected', () => {
  it('still renders under PHONES ON THE NET with its claim form', async () => {
    const d = await demo();
    const s: State = { ...d.state, players: d.state.players.filter(p => p.gun_id !== 'GUN-B'), standby: [], nodes: [worn] };
    const m = await mountScreen(<Armory />, { ...d, state: s, view: 'muster' });
    const cards = m.find('[data-node-card]');
    expect(cards.length, 'the unclaimed phone still gets its own card').toBe(1);
    expect(cards[0].getAttribute('data-node-card')).toBe('node_91C2');
    expect(cards[0].textContent).toContain('SET GAMERTAG');
    expect(m.find('[data-hidden-phones]').length, 'nothing is hidden when nothing duplicates').toBe(0);
    m.unmount();
  });
});
