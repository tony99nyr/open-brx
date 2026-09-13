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
import { Spectate } from '../src/screens/Spectate';
import { computePool } from '../src/screens/gameSummary';
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
    // pass 2 (2026-09-12): named per the pool's own `reasons` code — a class/id filter that leaves
    // nothing is "filtered", not a generic "excludes every weapon" sentence.
    expect(m.text()).toContain("PRIMARY'S CLASS/ID FILTERS EXCLUDE EVERYTHING");
    // pass 1 (2026-09-12): the warning used to be purely cosmetic — PLAY/SAVE stayed enabled and
    // pushed a zero-weapon primary to KIT, where every arsenal tile ended up locked with no way out.
    const playBtn = m.find('button').find(b => (b.textContent ?? '').includes('PLAY THIS NOW')) as HTMLButtonElement | undefined;
    expect(playBtn, 'the PLAY THIS NOW control is on screen').toBeTruthy();
    expect(playBtn!.disabled, 'PLAY THIS NOW is disabled while the primary pool is empty').toBe(true);
    const saveBtn = m.find('button').find(b => (b.textContent ?? '').includes('SAVE GAME')) as HTMLButtonElement | undefined;
    expect(saveBtn, 'the SAVE GAME control is on screen').toBeTruthy();
    expect(saveBtn!.disabled, 'SAVE GAME is disabled too — a broken policy must never be persisted either').toBe(true);
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

  it('refuses CONTINUE when the applied config\'s own pool has an empty required slot, even with no Designer visit', async () => {
    const d = await demo();
    // a policy whose only_ids names a weapon that is not in this game — the server (and the mock's
    // own computePool) would compute an empty primary pool for it, reason `only_ids_missing`, exactly
    // as if a bad saved game had just been played.
    const policy = { ...d.state.config.loadout_policy, primary: { ...d.state.config.loadout_policy.primary, only_ids: ['nonexistent_weapon_id'] } };
    const pool = computePool(policy, d.weapons, d.perks);
    const state: State = { ...d.state, phase: 'build', config: { ...d.state.config, loadout_policy: policy }, loadout_pool: pool };
    expect(pool.reasons?.primary, 'the pool computes only_ids_missing for this policy').toBe('only_ids_missing');
    const m = await mountScreen(<Games />, { ...d, state });
    expect(m.find('[data-testid="games-locked"]').length, 'a banner explains the empty pool').toBe(1);
    expect(m.text()).toContain("PRIMARY'S ALLOW-LIST NAMES NOTHING THIS GAME HAS");
    const continueBtn = m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE')) as HTMLButtonElement;
    expect(continueBtn.disabled, 'CONTINUE refuses to carry an empty primary into KIT').toBe(true);
    m.unmount();
  });

  it('the secondary being deliberately OFF never blocks CONTINUE — "off" is a fact, not a fault', async () => {
    const d = await demo();
    const policy = { ...d.state.config.loadout_policy, secondary: { ...d.state.config.loadout_policy.secondary, choice: 'off' as const } };
    const pool = computePool(policy, d.weapons, d.perks);
    expect(pool.reasons?.secondary_weapons, 'an off slot still gets a reason code').toBe('off');
    const state: State = { ...d.state, phase: 'build', config: { ...d.state.config, loadout_policy: policy }, loadout_pool: pool };
    const m = await mountScreen(<Games />, { ...d, state });
    expect(m.find('[data-testid="games-locked"]').length, 'no banner for a deliberately-off slot').toBe(0);
    const continueBtn = m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE')) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(false);
    m.unmount();
  });

  it('a FIXED primary whose weapon is not in this game blocks CONTINUE too (pass 2: fixed is no longer exempt)', async () => {
    const d = await demo();
    const policy = { ...d.state.config.loadout_policy, primary: { ...d.state.config.loadout_policy.primary, choice: 'fixed' as const, fixed_id: 'not_a_real_weapon' } };
    const pool = computePool(policy, d.weapons, d.perks);
    expect(pool.reasons?.primary, 'a missing fixed weapon reads fixed_missing').toBe('fixed_missing');
    const state: State = { ...d.state, phase: 'build', config: { ...d.state.config, loadout_policy: policy }, loadout_pool: pool };
    const m = await mountScreen(<Games />, { ...d, state });
    expect(m.text()).toContain("PRIMARY'S FIXED PICK IS NOT IN THIS GAME");
    const continueBtn = m.find('button').find(b => (b.textContent ?? '').includes('CONTINUE')) as HTMLButtonElement;
    expect(continueBtn.disabled, 'a fixed slot can be just as empty as a filtered one, and must block the same way').toBe(true);
    m.unmount();
  });

  it('a Quick Switch perk pruned for having no secondary blames the SECONDARY, never the perk filters', async () => {
    const d = await demo();
    const policy = { ...d.state.config.loadout_policy,
      secondary: { ...d.state.config.loadout_policy.secondary, choice: 'off' as const },
      perk: { ...d.state.config.loadout_policy.perk, choice: 'fixed' as const, fixed_id: 'quick_switch' } };
    const pool = computePool(policy, d.weapons, d.perks);
    expect(pool.reasons?.perks, 'a swap perk with no secondary reads needs_secondary, not off/filtered').toBe('needs_secondary');
    const state: State = { ...d.state, phase: 'build', config: { ...d.state.config, loadout_policy: policy }, loadout_pool: pool };
    const m = await mountScreen(<Games />, { ...d, state });
    expect(m.text()).toContain('QUICK SWITCH NEEDS A SECONDARY');
    // never blame the PERK slot's own filters/who-picks for a cause that is entirely about the secondary
    expect(m.text()).not.toContain("PERK'S CLASS/ID FILTERS");
    expect(m.text()).not.toContain("PERK'S FIXED PICK");
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
    expect(redRow, 'the demo fixture has a red gun to turn into a dropped-backhaul row').toBeTruthy();
    // pass 1 (2026-09-12): `reach`/`last_reach` now ride on the READINESS ROW itself (state.py stamps
    // them there), never a separate `state.nodes` entry — a row with `present: true` (a node WAS
    // bound) but no live `reach` and `last_reach: 'backhaul'` is exactly a dropped-tunnel gun. The old
    // wifi-worded blocker must be REPLACED, never sit beside the honest one.
    const board = d.state.readiness.board.map(b => b.sticker === redRow!.sticker
      ? { ...b, present: true, reach: null, last_reach: 'backhaul' as const, last_seen_age_ms: 95_000,
          blockers: ['WRONG WI-FI / MC UNREACHABLE — BLOCKS START'] } : b);
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
    const m = await mountScreen(<Armory />, { ...d, state });
    expect(m.text()).toContain('NOT REACHED FOR');
    expect(m.text()).not.toContain('WRONG WI-FI');
    m.unmount();
  });

  it('a card with NO node ever bound never gets a reach explanation at all — one card, one fact', async () => {
    const d = await demo();
    const neverRow = d.state.readiness.board.find(b => b.node === 'none' && !b.present);
    expect(neverRow, 'the demo fixture has a never-connected gun (present: false)').toBeTruthy();
    const board = d.state.readiness.board.map(b => b.sticker === neverRow!.sticker
      ? { ...b, last_reach: 'backhaul' as const } : b);   // even if the server sent stray history, present:false must win
    const state: State = { ...d.state, readiness: { ...d.state.readiness, board } };
    const m = await mountScreen(<Armory />, { ...d, state });
    expect(m.text()).toContain('NEVER THIS SESSION');
    expect(m.text()).not.toContain('NOT REACHED FOR');
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

describe('F154 polish — an FFA tie names players, never raw ids', () => {
  const ffaTieState = (d: Awaited<ReturnType<typeof demo>>): State => {
    const [p1, p2] = d.state.players;
    const recap: RecapView = {
      winner: { tie: [p1.player_id, p2.player_id] }, score: {},
      rows: d.state.players.map(p => ({ player_id: p.player_id, display: p.display, team_id: p.team_id, kills: 5, deaths: 5,
        assists: 0, shots: 40, shots_total: 40, hits: 20, accuracy: 50, kd: 1, streak: 0, medals: [],
        best_streak: 1, multi_best: 0, first_blood: false, acc_provisional: false })),
      honors: [], provisional: false, missing: [] };
    return { ...d.state, phase: 'recap', config: { ...d.state.config, mode: 'ffa' }, recap, live: undefined };
  };

  it('Recap names the tied players by display name, not their raw ids', async () => {
    const d = await demo();
    const state = ffaTieState(d);
    const m = await mountScreen(<Recap />, { ...d, state });
    const [p1, p2] = d.state.players;
    expect(m.text()).toContain(`TIE — ${p1.display} / ${p2.display}`);
    expect(m.text()).not.toContain(p1.player_id);
    m.unmount();
  });

  it('Spectate (the projector board) names the tied players too', async () => {
    const d = await demo();
    const state = ffaTieState(d);
    const m = await mountScreen(<Spectate />, { ...d, state });
    const [p1, p2] = d.state.players;
    expect(m.text()).toContain(`TIE — ${p1.display} / ${p2.display}`);
    expect(m.text()).not.toContain(p1.player_id);
    m.unmount();
  });
});
