// A32 — the three ways the ARMORY card can talk about a headset, and the one it must never invent.
//
// The rule (contracts §10 A32): a gun with NO headset accepts a BLE link and drops it within ~6 s, so a
// link the phone has HELD for 10 s is itself the proof. The server decides that and says HOW in
// `headset_proof`; the console only renders it. That split is the point of these tests — a card that did
// its own arithmetic on `last_seen` would drift out of step with the board's own amber and tell the
// operator two different things about the same gun.
import { describe, expect, it } from 'vitest';
import { Armory } from '../src/screens/Armory';
import type { ReadinessRow, State } from '../src/api/types';
import { demo, mountScreen } from './harness';
import { T } from '../src/tokens';

/** Mount ARMORY with the demo session's board, with row 0 replaced by `row`. */
async function boardWith(row: Partial<ReadinessRow>) {
  const d = await demo();
  const [first, ...rest] = d.state.readiness.board;
  const board = [{ ...first, ...row } as ReadinessRow, ...rest];
  const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
  const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
  return { m, cell: () => m.find('[data-headset]')[0] };
}

describe('ARMORY · how a headset was proven (A32)', () => {
  it('a link that has held says CONNECTED (LINK)', async () => {
    const { m, cell } = await boardWith({ headset: 'proven', headset_proof: 'link', gun_linked: true });
    expect(cell().getAttribute('data-headset')).toBe('link');
    // Both proofs mean the headset is ON. `PROVEN BY LINK` next to a bare `CONNECTED` read as two
    // different states rather than one fact with two provenances (round-2 review 2026-09-12).
    expect(cell().textContent, 'the operator must be able to tell the two proofs apart').toBe('CONNECTED (LINK)');
    m.unmount();
  });

  it('the config echo says CONNECTED (ECHO) — the same word, a different proof', async () => {
    const { m, cell } = await boardWith({ headset: 'proven', headset_proof: 'echo', gun_linked: true });
    expect(cell().getAttribute('data-headset')).toBe('echo');
    expect(cell().textContent).toBe('CONNECTED (ECHO)');
    m.unmount();
  });

  it('a link still counting up reads UNKNOWN, and the COUNT comes from the server, not the clock', async () => {
    const { m, cell } = await boardWith({
      headset: 'unknown', headset_proof: null, gun_linked: true,
      ambers: ['HEADSET · CONFIRMING (LINK 4 s)'], status: 'amber',
    });
    expect(cell().textContent).toBe('UNKNOWN');
    expect(cell().getAttribute('data-headset')).toBe('unknown');
    // rendered verbatim: the seconds are the server's, so the card and the board can never disagree
    expect(m.text()).toContain('HEADSET · CONFIRMING (LINK 4 s)');
    expect(m.text(), 'A32 retired the old push-me amber').not.toContain('HEADSET UNPROVEN');
    m.unmount();
  });

  it('a head that echoed nothing is still the red one', async () => {
    const { m, cell } = await boardWith({
      headset: 'absent', headset_proof: null, status: 'red',
      blockers: ['GUN DID NOT ANSWER CONFIG — HEADSET OFF? BLOCKS START'],
    });
    expect(cell().getAttribute('data-headset')).toBe('absent');
    expect(m.text()).toContain('GUN DID NOT ANSWER CONFIG');
    m.unmount();
  });

  it('an older server that sends no headset_proof still reads as connected, not a blank', async () => {
    const { m, cell } = await boardWith({ headset: 'proven', headset_proof: undefined, gun_linked: true });
    expect(cell().textContent).toBe('CONNECTED (ECHO)');
    m.unmount();
  });

  it('the ?mock demo shows both proofs at once — one confirming, the rest proven by link', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, { state: d.state, view: 'muster', weapons: d.weapons, perks: d.perks });
    const kinds = m.find('[data-headset]').map(e => e.getAttribute('data-headset'));
    expect(kinds, 'the demo board must not be all one state').toContain('link');
    expect(kinds).toContain('unknown');
    expect(m.text()).toContain('CONNECTED (LINK)');
    expect(m.text()).toContain('HEADSET · CONFIRMING (LINK 4 s)');
    m.unmount();
  });
});

// A29 — the build chip on a phone card. `-dirty` means this phone is running somebody's working tree
// rather than a build that can be reproduced; it is the one thing on the row worth interrupting a match
// for. It used to be sliced off the visible text and kept only in a `title`, which the match-day touch
// console has no way to show: on a tablet the flag simply did not exist.
describe('ARMORY · the build chip shows the whole stamp (A29)', () => {
  const node = (app_ver: string) => ({ node_id: 'node-x', node_type: 'phone', app_ver, platform: 'android',
                                       arm_state: 'kitted', last_seen_ms: 100, synced: true, gun_name: 'GUN-A-3D4F' });

  async function chip(app_ver: string) {
    const d = await demo();
    const state = { ...d.state, nodes: [node(app_ver)] } as unknown as State;
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    return { m, el: m.find('[data-app-ver]')[0] };
  }

  it('a -dirty build says so in the text, not only in a tooltip', async () => {
    const { m, el } = await chip('0.1.8+28c9e76-dirty');
    // the version and its build metadata read as ONE run, the way the app stamps them
    expect(el.textContent, 'the flag must survive into what a touch console can read')
      .toBe('0.1.8+28c9e76-dirtyANDROID');
    m.unmount();
  });

  it('a clean build shows its sha and invents no flag', async () => {
    const { m, el } = await chip('0.1.9+ab12cd3');
    expect(el.textContent).toContain('+ab12cd3');
    expect(el.textContent).not.toContain('-dirty');
    m.unmount();
  });

  it('every part of the chip is at least 11px', async () => {
    // The sha ran at 10 px, and the e2e tiny-text sweep failed on it at 1280 AND 393 — "+ab12cd3" is
    // how "0.1.9 from the release" is told apart from "0.1.9 from your tree", so it is not decoration
    // (review 2026-09-12). It wraps instead of shrinking.
    const { m, el } = await chip('0.1.8+28c9e76-dirty');
    // every element that draws text OF ITS OWN — "+28c9e76" sits in a span that also holds the
    // `-dirty` child, so a childless-leaf rule would skip exactly the run that was too small
    const parts = (Array.from(el.querySelectorAll('*')) as HTMLElement[])
      .map(n => ({
        t: Array.from(n.childNodes).filter(c => c.nodeType === 3).map(c => c.textContent ?? '').join('').trim(),
        px: parseFloat(getComputedStyle(n).fontSize),
      }))
      .filter(x => x.t);
    expect(parts.map(x => x.t).join(' '), 'the chip has parts to measure').toContain('28c9e76');
    expect(parts.filter(x => !(x.px >= 11)).map(x => `"${x.t}"@${x.px}px`).join(' | ')).toBe('');
    expect(parts.length).toBeGreaterThan(2);
    m.unmount();
  });

  it('keeps the -dirty flag in the warning colour', async () => {
    const { m, el } = await chip('0.1.8+28c9e76-dirty');
    const flag = (Array.from(el.querySelectorAll('span')) as HTMLElement[])
      .find(n => (n.textContent ?? '').trim() === '-dirty');
    expect(flag, 'the flag is its own element, so it can be coloured').toBeTruthy();
    // compared through the same normalisation the browser applies, so a hex token and an rgb()
    // computed value are not reported as a difference
    const probe = document.createElement('span');
    probe.style.color = T.warn;
    expect(flag!.style.color, 'warning colour, not the faint one the sha uses').toBe(probe.style.color);
    expect(flag!.style.color).not.toBe('');
    m.unmount();
  });

  it('a phone that reported no build still reads UNKNOWN', async () => {
    const d = await demo();
    const bare = { node_id: 'node-y', node_type: 'phone', arm_state: 'kitted', last_seen_ms: 100 };
    const state = { ...d.state, nodes: [bare] } as unknown as State;
    const m = await mountScreen(<Armory />, { state, view: 'muster', weapons: d.weapons, perks: d.perks });
    expect(m.find('[data-app-ver]')[0].textContent).toBe('UNKNOWN');
    m.unmount();
  });
});
