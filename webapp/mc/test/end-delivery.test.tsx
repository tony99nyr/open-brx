// A42 — the operator's half: did the END actually land on every player's HUD?
//
// Field 2026-09-12, twice: the operator ended the match and a player's tagger played on. The retry is
// only half the answer; the half that matters on the field is that the OPERATOR KNOWS, while they are
// still standing next to the player whose gun is still live. These assert what is on the screen:
//
//  * LIVE names the straggler while MC is re-delivering, and the board's STATUS column says so on that row
//  * RECAP names them as a DELIVERY fact — never anything that could be read as a score
//  * a clean end says so too ("ALL 4 HUDS CONFIRMED THE END"), because that is what was asked for
//  * an ARCHIVED match never shows it, and a server that does not send it renders nothing at all
import { describe, expect, it } from 'vitest';
import { Live } from '../src/screens/Live';
import { Recap } from '../src/screens/Recap';
import type { EndDeliveryView, LiveRow, LiveView, RecapView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const row = (player_id: string, display: string, kills: number): LiveRow => ({
  player_id, display, team_id: 'blue', kills, deaths: 1, assists: 0, shots: 20, hits: 8, shots_total: 20,
  accuracy: 40, kd: 2, streak: 1, best_streak: 1, multi_best: 0, first_blood: false, acc_provisional: false,
  medals: [], status: 'alive', sync_age_ms: 1000, respawn_in_s: null,
});

const LIVE: LiveView = {
  match_id: 'm-41', go_live_t: Date.now() - 60_000, time_limit_s: 600, ends_t: Date.now() + 540_000,
  score: { blue: 3, yellow: 1 }, rows: [row('p1', 'ALPHA', 3), row('p2', 'BRAVO', 1)],
};

const RECAP: RecapView = {
  winner: { team_id: 'blue' }, score: { blue: 3, yellow: 1 }, provisional: false, missing: [], honors: [],
  rows: [row('p1', 'ALPHA', 3), row('p2', 'BRAVO', 1)],
};

/** `state.py _end_delivery_view()`: one straggler out of two, still being re-delivered to. */
const STRAGGLER: EndDeliveryView = {
  match_id: 'm-41', total: 2, confirmed: 1, retrying: true,
  unconfirmed: [{ player_id: 'p2', display: 'BRAVO', node_id: 'node1', tries: 3, since_ms: 12_000,
                  reached: true, retrying: true }],
};
const SPENT: EndDeliveryView = {
  ...STRAGGLER, retrying: false,
  unconfirmed: [{ ...STRAGGLER.unconfirmed[0], tries: 7, since_ms: 140_000, retrying: false }],
};
const ALL_IN: EndDeliveryView = { match_id: 'm-41', total: 2, confirmed: 2, unconfirmed: [], retrying: false };

async function liveWith(end_delivery: EndDeliveryView | undefined) {
  const d = await demo();
  const state: State = { ...d.state, phase: 'recap', live: LIVE, end_delivery };
  return mountScreen(<Live />, { state, view: 'live' });
}

async function recapWith(end_delivery: EndDeliveryView | undefined) {
  const d = await demo();
  const state: State = { ...d.state, phase: 'recap', recap: RECAP, end_delivery };
  return mountScreen(<Recap />, { state, view: 'recap' });
}

const strip = (s: string) => s.replace(/\s+/g, ' ').toUpperCase();

describe('A42 · LIVE tells the operator who has not confirmed the end', () => {
  it('names the straggler and says it is still trying', async () => {
    const m = await liveWith(STRAGGLER);
    const el = m.find('[data-testid="end-delivery"]')[0];
    expect(el, 'the notice is on the screen').toBeTruthy();
    const t = strip(el.textContent ?? '');
    expect(t).toContain('BRAVO');
    expect(t).toMatch(/1 OF 2 HUDS? HAS NOT CONFIRMED THE END/);
    expect(t).toContain('RE-DELIVERING');
  });

  it('says what the operator must DO once the re-delivery has given up', async () => {
    const m = await liveWith(SPENT);
    const t = strip(m.find('[data-testid="end-delivery"]')[0].textContent ?? '');
    expect(t).toContain('END IT ON THE GUN');
    expect(t).toContain('TOLD 7 TIMES');
    expect(t).not.toContain('RE-DELIVERING');
  });

  it('says so when every HUD confirmed — the thing that was actually asked for', async () => {
    const m = await liveWith(ALL_IN);
    const t = strip(m.find('[data-testid="end-delivery"]')[0].textContent ?? '');
    expect(t).toContain('ALL 2 HUDS CONFIRMED THE END');
  });

  it("marks that player's own row in the STATUS column, and nobody else's", async () => {
    const m = await liveWith(STRAGGLER);
    const cells = m.find('[data-cell="status"]').map(c => strip(c.textContent ?? ''));
    expect(cells.length, 'every row has a STATUS cell').toBe(2);
    expect(cells.filter(c => c.includes('END NOT CONFIRMED')).length).toBe(1);
    expect(m.find('[data-end-confirm="pending"]').length).toBe(1);
    const straggler = m.find('[data-end-unconfirmed="p2"]');
    expect(straggler.length, "the straggler's row is marked").toBe(1);
    expect(m.find('[data-end-unconfirmed="p1"]').length, 'the HUD that confirmed is not').toBe(0);
  });

  it('renders nothing at all against a server that does not send it', async () => {
    const m = await liveWith(undefined);
    expect(m.find('[data-testid="end-delivery"]').length).toBe(0);
    expect(strip(m.text())).not.toContain('NOT CONFIRMED THE END');
  });
});

describe('A42 · RECAP names it as a delivery fact, never as a score', () => {
  it('names the HUD that never confirmed', async () => {
    const m = await recapWith(SPENT);
    const el = m.find('[data-testid="end-delivery-recap"]')[0];
    expect(el).toBeTruthy();
    const t = strip(el.textContent ?? '');
    expect(t).toContain('BRAVO');
    expect(t).toContain('NEVER CONFIRMED THE END');
    // The one thing this line must never be mistaken for. It is about a phone, not about a player.
    expect(t).toContain('DELIVERY');
    expect(t).not.toMatch(/KILL|SCORE ?:|PENAL|CHEAT|DISQUALIF/);
  });

  it("leaves that player's score row completely alone", async () => {
    const m = await recapWith(SPENT);
    const inRows = m.find('[data-testid="end-delivery-recap"] [data-cell="k"]');
    expect(inRows.length, 'the delivery notice is not inside the board').toBe(0);
    expect(strip(m.text())).toContain('BRAVO');
    // BRAVO still scores exactly what they scored: the notice changes no number on the screen.
    const noNotice = await recapWith(undefined);
    const nums = (mm: typeof m) => mm.find('[data-cell="k"]').map(c => (c.textContent ?? '').trim());
    expect(nums(m)).toEqual(nums(noNotice));
  });

  it('confirms a clean end', async () => {
    const m = await recapWith(ALL_IN);
    expect(strip(m.find('[data-testid="end-delivery-recap"]')[0].textContent ?? ''))
      .toContain('ALL 2 HUDS CONFIRMED THE END');
  });

  it('renders nothing against a server that does not send it', async () => {
    const m = await recapWith(undefined);
    expect(m.find('[data-testid="end-delivery-recap"]').length).toBe(0);
  });
});
