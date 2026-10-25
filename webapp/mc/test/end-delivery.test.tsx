// A42 — the operator's half: did the END actually land on every player's HUD?
//
// Field 2026-09-12, twice: the operator ended the match and a player's tagger played on. The retry is
// only half the answer; the half that matters on the field is that the OPERATOR KNOWS, while they are
// still standing next to the player whose gun is still live. These assert what is on the screen:
//
//  * LIVE names the straggler while MC is re-delivering, and the board's STATUS column says so on that row
//  * RECAP names them as a DELIVERY fact — never anything that could be read as a score
//  * a clean end says so too ("ALL 4 NODES CONFIRMED THE END"), because that is what was asked for
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

/** `sync.end_unconfirmed` names the players whose row carries the END flag (the server's own `end_unconfirmed`). */
async function recapWith(end_delivery: EndDeliveryView | undefined, sync?: { end_unconfirmed: string[] }) {
  const d = await demo();
  const rows = ['p1', 'p2'].map(id => ({ kind: 'phone', id, name: id === 'p1' ? 'ALPHA' : 'BRAVO', team_id: 'blue', stage: 'received',
    transport: null, end_unconfirmed: !!sync?.end_unconfirmed.includes(id), idle_s: 0, stuck: false }));
  const state: State = { ...d.state, phase: 'recap', end_delivery,
    recap: sync ? ({ ...RECAP, sync: { pending: false, finalised: false, result_changed: false, rows } } as unknown as RecapView) : RECAP };
  return mountScreen(<Recap />, { state, view: 'recap' });
}

const strip = (s: string) => s.replace(/\s+/g, ' ').toUpperCase();

describe('A42 · LIVE tells the operator who has not confirmed the end', () => {
  it('names the straggler and says it is still trying', async () => {
    const m = await liveWith(STRAGGLER);
    const el = m.find('[data-testid="end-delivery"]')[0];
    expect(el, 'the notice is on the screen').toBeTruthy();
    const t = strip(el.textContent ?? '');
    expect(t).toContain('END STILL REACHING PHONES');
    await m.click('End still reaching phones');
    const detail = strip(m.find('[data-testid="chip-detail"]')[0].textContent ?? '');
    expect(detail).toContain('BRAVO');
    expect(detail).toMatch(/1 OF 2 NODES HAS NOT CONFIRMED THE END/);
    expect(t, 'F318: one noun, NODES, as RECAP says').not.toMatch(/HUDS?\b/);
    expect(detail).toContain('RE-DELIVERING');
  });

  it('says what the operator must DO once the re-delivery has given up', async () => {
    const m = await liveWith(SPENT);
    expect(strip(m.find('[data-testid="end-delivery"]')[0].textContent ?? '')).toContain('END DID NOT REACH PHONES');
    await m.click('Why? ▾');
    const detail = strip(m.find('[data-testid="fault-detail"]')[0].textContent ?? '');
    expect(detail).toContain('END IT ON THE GUN');
    expect(detail).toContain('TOLD 7 TIMES');
    expect(detail).not.toContain('RE-DELIVERING');
  });

  it('says so when every HUD confirmed — the thing that was actually asked for', async () => {
    const m = await liveWith(ALL_IN);
    const t = strip(m.find('[data-testid="end-delivery"]')[0].textContent ?? '');
    expect(t).toContain('ALL 2 NODES CONFIRMED THE END');
    expect(t, 'F318: one noun, NODES, as RECAP says').not.toMatch(/HUDS?\b/);
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
  it('flags the HUD that never confirmed with a small flag on its strip icon, and prints no sentence', async () => {
    // F596: the full-width END sentence is gone; `sync.rows[].end_unconfirmed` is the flag badge on that phone's icon.
    const m = await recapWith(SPENT, { end_unconfirmed: ['p2'] });
    expect(m.find('[data-testid="end-delivery-recap"]').length, 'no END block').toBe(0);
    expect(strip(m.text())).not.toContain('NEVER CONFIRMED THE END');
    expect(m.find('[data-strip-icon="p2"] [data-strip-end]').length, 'BRAVO wears the flag').toBe(1);
    expect(m.find('[data-strip-icon="p1"] [data-strip-end]').length, 'ALPHA does not').toBe(0);
    expect(m.find('[data-strip-icon="p2"]')[0].getAttribute('title')).toContain('END not confirmed');
  });

  it("leaves that player's score row completely alone", async () => {
    const m = await recapWith(SPENT);
    const inRows = m.find('[data-testid="end-delivery-recap"] [data-cell="k"]');
    expect(inRows.length, 'the delivery notice is not inside the board').toBe(0);
    expect(strip(m.text())).toContain('BRAVO');   // the player's own row is still there
    // BRAVO still scores exactly what they scored: the notice changes no number on the screen.
    const noNotice = await recapWith(undefined);
    const nums = (mm: typeof m) => mm.find('[data-cell="k"]').map(c => (c.textContent ?? '').trim());
    expect(nums(m)).toEqual(nums(noNotice));
  });

  it('a clean end prints no confirmation sentence and no flag', async () => {
    const m = await recapWith(ALL_IN, { end_unconfirmed: [] });
    expect(m.find('[data-testid="end-delivery-recap"]').length).toBe(0);
    expect(strip(m.text())).not.toContain('CONFIRMED THE END');
    expect(m.find('[data-strip-end]').length).toBe(0);
    expect(strip(m.find('[data-testid="all-synced"]')[0]?.textContent ?? ''), 'positive: the green line says every phone is in').toBe('2 OF 2 PHONES SYNCED');
  });

  it('renders nothing against a server that does not send it', async () => {
    const m = await recapWith(undefined);
    expect(m.find('[data-testid="end-delivery-recap"]').length).toBe(0);
  });
});
