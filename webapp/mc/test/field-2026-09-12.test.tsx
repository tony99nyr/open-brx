// Screen-truth regression tests for the 2026-09-12 field-test fixes (F138, F141, F142, F143, F144,
// F151, F155, S38, S41; 27b lives in reach.test.tsx beside the rest of the REACH panel). Each test
// reproduces the exact condition Tony hit in the field, against a real MockBackend fixture, and would
// have failed on the pre-fix code (ui-build-verify skill: a test is worth having only if it can fail).
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Armory } from '../src/screens/Armory';
import { Designer } from '../src/screens/Designer';
import { Games } from '../src/screens/Games';
import { Recap } from '../src/screens/Recap';
import type { RecapView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

describe('F141 — Designer class chip toggle', () => {
  it('a chip left PARTIAL by another chip\'s exclusion still toggles fully OFF on tap, and back ON on the next', async () => {
    const d = await demo();
    const m = await mountScreen(<Designer />, d);
    const chipsSel = '[aria-label="primary slot rules"] button';
    const chip = (label: string) => m.find(chipsSel).find(b =>
      (b.getAttribute('title') ?? '').includes('class') && (b.textContent ?? '').trim().endsWith(label));

    // AMR is tagged support+sniper (mock/data.ts): excluding SUPPORT leaves SNIPER PARTIAL, not OFF —
    // exactly the state that used to make the SNIPER chip look "stuck" (field 2026-09-12).
    const support = chip('SUPPORT');
    expect(support, 'the SUPPORT class chip is on screen').toBeTruthy();
    await act(async () => { support!.click(); });

    const sniperMixed = chip('SNIPER');
    expect(sniperMixed, 'the SNIPER class chip is on screen').toBeTruthy();
    expect(sniperMixed!.getAttribute('aria-pressed'), 'AMR going off via SUPPORT leaves SNIPER partial, not fully on').toBe('mixed');

    // Tap SNIPER once: it must go fully OFF, not silently stay partial (the bug: tapping a "mixed"
    // chip used to always turn everything back ON, so a partial chip could never be switched off).
    await act(async () => { sniperMixed!.click(); });
    const sniperOff = chip('SNIPER');
    expect(sniperOff!.getAttribute('aria-pressed')).toBe('false');

    // Tap it again: back on (still partial, since AMR is still excluded via SUPPORT) — never stuck.
    await act(async () => { sniperOff!.click(); });
    const sniperBack = chip('SNIPER');
    expect(sniperBack!.getAttribute('aria-pressed')).not.toBe('false');
    m.unmount();
  });

  it('a primary slot filtered down to nothing says so in place, instead of silently degrading', async () => {
    const d = await demo();
    const m = await mountScreen(<Designer />, d);
    const chipsSel = '[aria-label="primary slot rules"] button';
    const chip = (label: string) => m.find(chipsSel).find(b =>
      (b.getAttribute('title') ?? '').includes('class') && (b.textContent ?? '').trim().endsWith(label));
    for (const label of ['HEAVY', 'SNIPER', 'ASSAULT', 'CLOSE RANGE', 'SUPPORT', 'SIDEARM']) {
      const c = chip(label);
      if (c && c.getAttribute('aria-pressed') !== 'false') await act(async () => { c.click(); });
    }
    expect(m.find('[data-testid="primary-empty-pool"]').length, 'excluding every class shows the empty-pool warning, not a bare "0 OF N"').toBe(1);
    expect(m.text()).toContain('THIS EXCLUDES EVERY');
    m.unmount();
  });
});

describe('F151 — Games settings lock past kit', () => {
  it('says why controls do nothing once the match has moved past kit, and never calls putConfig silently', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'lobby' };
    const putConfig = vi.fn(async () => ({ ok: true, errors: [], config: state.config }));
    const m = await mountScreen(<Games />, { ...d, state, api: { putConfig } });
    expect(m.find('[data-testid="games-locked"]').length, 'a visible banner explains the lock').toBe(1);
    expect(m.text()).toContain('GAME SETTINGS ARE LOCKED');
    expect(m.text()).toContain('LOBBY');
    const continueBtn = m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE'));
    expect((continueBtn as HTMLButtonElement).disabled).toBe(true);
    // tapping a stock-mode card must never reach the server silently
    await m.click('TEAM DEATHMATCH').catch(() => {});
    expect(putConfig).not.toHaveBeenCalled();
    m.unmount();
  });

  it('is fully interactive in kit/build/muster (unaffected by the lock)', async () => {
    const d = await demo();
    const state: State = { ...d.state, phase: 'build' };
    const m = await mountScreen(<Games />, { ...d, state });
    expect(m.find('[data-testid="games-locked"]').length).toBe(0);
    const continueBtn = m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE'));
    expect((continueBtn as HTMLButtonElement).disabled).toBe(false);
    m.unmount();
  });
});

describe('F142 — restored-session banner', () => {
  it('shows RESTORED FROM with a FRESH SESSION control, and the roster keeps the ghost rows dimmed', async () => {
    const d = await demo();
    const restoredAt = Date.now() - 60 * 60 * 1000;
    const ghost = { player_id: 'p_ghost', player_num: 9, display: 'ALPHA', team_id: 'blue', node_id: null, gun_id: null,
      loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: null }, voice: 'male', ready: false };
    const state: State = { ...d.state, restored_from: { at: restoredAt, players: 1 }, players: [...d.state.players, ghost] };
    const newSession = vi.fn(async () => state);
    const m = await mountScreen(<Armory />, { ...d, state, api: { newSession } });
    expect(m.find('[data-testid="restored-banner"]').length).toBe(1);
    expect(m.text()).toContain('RESTORED FROM');
    expect(m.text()).toContain('1 PLAYER');
    await m.click('FRESH SESSION');
    expect(newSession).toHaveBeenCalledWith(false);
    m.unmount();
  });

  it('renders nothing when the session was not restored', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, d);
    expect(m.find('[data-testid="restored-banner"]').length).toBe(0);
    m.unmount();
  });
});

describe('F144/F155 — Armory gun card reach', () => {
  it('a connected node on the internet path shows an INTERNET tag beside READY, never CHECK/amber for that alone', async () => {
    const d = await demo();
    const greenRow = d.state.readiness.board.find(b => b.status === 'green' && b.node === 'linked');
    expect(greenRow, 'the demo fixture has at least one green, linked gun').toBeTruthy();
    const nodes = d.state.nodes.map(n => n.gun_tail === greenRow!.tail ? { ...n, reach: 'backhaul' as const } : n);
    const state: State = { ...d.state, nodes };
    const m = await mountScreen(<Armory />, { ...d, state });
    expect(m.text()).toContain('INTERNET');
    // the row's own status tag must still read READY, not CHECK — the tag rides BESIDE it
    const card = m.find('div').find(div => (div.textContent ?? '').includes(greenRow!.sticker) && (div.textContent ?? '').includes('INTERNET'));
    expect(card, 'found the gun card carrying both the sticker and the INTERNET tag').toBeTruthy();
    expect(card!.textContent).toContain('READY');
    m.unmount();
  });

  it('a stale node whose last path was the internet reads NOT REACHED FOR <age>, never WRONG WI-FI', async () => {
    const d = await demo();
    const redRow = d.state.readiness.board.find(b => b.status === 'red');
    expect(redRow, 'the demo fixture has a red (no-phone) gun to attach the stale node to').toBeTruthy();
    // give that row a synthetic blocker in the old wifi-worded style, AND a node with a known
    // internet-path history — the honest reason must replace the wifi wording, not sit beside it.
    const board = d.state.readiness.board.map(b => b.sticker === redRow!.sticker
      ? { ...b, blockers: ['WRONG WI-FI / MC UNREACHABLE — BLOCKS START'] } : b);
    const nodes = [...d.state.nodes, { node_id: 'node_ghost_stale', node_type: 'phone', gun_tail: redRow!.tail,
      last_reach: 'backhaul' as const, last_seen_ms: 95_000, arm_state: 'connected' as const, synced: false }];
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board }, nodes };
    const m = await mountScreen(<Armory />, { ...d, state });
    expect(m.text()).toContain('NOT REACHED FOR');
    expect(m.text()).not.toContain('WRONG WI-FI');
    m.unmount();
  });
});

describe('F143 — REACH network row never prints a placeholder word', () => {
  it('prints the SSID when known', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, d);
    expect(m.text()).toContain('BRX-FIELD');
    m.unmount();
  });

  it('falls back to the generic "LAN", never a mode word like UNKNOWN/ROUTER/HOTSPOT', async () => {
    const d = await demo();
    const state: State = { ...d.state, lan: { ...d.state.lan, mode: 'unknown', ssid: null } };
    const m = await mountScreen(<Armory />, { ...d, state });
    expect(m.text()).toContain('LAN ·');
    expect(m.text()).not.toContain('UNKNOWN ·');
    m.unmount();
  });
});

describe('F138 — join QR is large and tells the operator how to use it', () => {
  it('renders at least 280px and the hold-the-phone hint once SHOW QR CODES is open', async () => {
    const d = await demo();
    const m = await mountScreen(<Armory />, d);
    await m.click('SHOW QR CODES');
    const img = m.find('img[alt="node join QR"]')[0] as HTMLImageElement | undefined;
    expect(img, 'the join QR image is on screen').toBeTruthy();
    expect(img!.width).toBeGreaterThanOrEqual(280);
    expect(m.text()).toContain('HOLD THE PHONE 20');
    m.unmount();
  });
});

describe('S38 — Armory gun card shows the bound player\'s gamertag', () => {
  it('shows the display name once a player is bound to the gun', async () => {
    const d = await demo();
    const boundRow = d.state.readiness.board.find(b => b.player_id);
    expect(boundRow, 'the demo fixture has at least one bound player').toBeTruthy();
    const player = d.state.players.find(p => p.player_id === boundRow!.player_id);
    const m = await mountScreen(<Armory />, d);
    expect(m.text()).toContain(player!.display);
    m.unmount();
  });
});

describe('S41 — Recap hides AFTER THE WHISTLE when it has nothing to show', () => {
  const base = async (): Promise<{ d: Awaited<ReturnType<typeof demo>>; recap: RecapView }> => {
    const d = await demo();
    const recap: RecapView = { winner: { player_id: d.state.players[0].player_id }, score: {},
      rows: d.state.players.map(p => ({ player_id: p.player_id, display: p.display, team_id: p.team_id, kills: 1, deaths: 1,
        assists: 0, shots: 10, shots_total: 10, hits: 5, accuracy: 50, kd: 1, streak: 0, medals: [],
        best_streak: 1, multi_best: 0, first_blood: false, acc_provisional: false })),
      honors: [], provisional: false, missing: [] };
    return { d, recap };
  };

  it('hidden when facts is zero (already fixed, kept as a guard)', async () => {
    const { d, recap } = await base();
    const state: State = { ...d.state, phase: 'recap', recap: { ...recap, after_end: { facts: 0, by_player: {} } } };
    const m = await mountScreen(<Recap />, { ...d, state });
    expect(m.text()).not.toContain('AFTER THE WHISTLE');
    m.unmount();
  });

  it('hidden when facts landed but none could be attributed to a player — a titled empty box was worse than nothing', async () => {
    const { d, recap } = await base();
    const state: State = { ...d.state, phase: 'recap', recap: { ...recap, after_end: { facts: 2, by_player: {} } } };
    const m = await mountScreen(<Recap />, { ...d, state });
    expect(m.text()).not.toContain('AFTER THE WHISTLE');
    m.unmount();
  });

  it('shown when there is a real per-player breakdown', async () => {
    const { d, recap } = await base();
    const pid = d.state.players[0].player_id;
    const state: State = { ...d.state, phase: 'recap', recap: { ...recap, after_end: { facts: 1, by_player: { [pid]: { kills: 1, deaths: 0 } } } } };
    const m = await mountScreen(<Recap />, { ...d, state });
    expect(m.text()).toContain('AFTER THE WHISTLE');
    m.unmount();
  });

  it('shown as a bare count when an older MC sends only post_end_facts (no breakdown at all)', async () => {
    const { d, recap } = await base();
    const state: State = { ...d.state, phase: 'recap', recap: { ...recap, post_end_facts: 3 } };
    const m = await mountScreen(<Recap />, { ...d, state });
    expect(m.text()).toContain('AFTER THE WHISTLE');
    expect(m.text()).toContain('WITHOUT THE PER-PLAYER SPLIT');
    m.unmount();
  });
});
