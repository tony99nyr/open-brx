// MC visual QA 2026-09-23, M1 and M23: what RECAP claims about the END, and how long the match ran.
//
// M1: one screen carried "8 HUDS NEVER CONFIRMED THE END" (five seconds after the whistle, while MC
// was still re-delivering), the command bar's "REACHED 8 OF 8 NODES", and eight "SYNCED ✓" chips.
// M23: the header printed the 10:00 time limit over a match that was ended early.
import { describe, expect, it } from 'vitest';
import { Recap } from '../src/screens/Recap';
import { recapDeliveryText } from '../src/screens/recapDelivery';
import type { EndDeliveryView, LiveView, RecapView, State } from '../src/api/types';
import { demo, mountScreen } from './harness';

const RECAP: RecapView = {
  winner: { team_id: 'blue' }, score: { blue: 3, yellow: 1 }, provisional: false, missing: [], honors: [],
  rows: [{ player_id: 'p1', display: 'ALPHA', team_id: 'blue', kills: 3, deaths: 1, assists: 0,
    shots: 20, hits: 8, accuracy: 40, kd: 3, streak: 3, medals: [] }],
};
const T_NOW = 5_000_000;
const GO = T_NOW - 200_000;           // the whistle blew 200 s ago
const LIVE: LiveView = { match_id: 'm-1', go_live_t: GO, time_limit_s: 600, ends_t: GO + 600_000, score: {}, rows: [] };

const row = (player_id: string, display: string, over: Partial<EndDeliveryView['unconfirmed'][0]> = {}) =>
  ({ player_id, display, node_id: `n-${player_id}`, tries: 2, since_ms: 5_000, reached: true, retrying: true, ...over });
/** 5 s after the whistle: nobody has confirmed yet, and MC is still on its retry ladder. */
const EARLY: EndDeliveryView = { match_id: 'm-1', total: 2, confirmed: 0, retrying: true,
  unconfirmed: [row('p1', 'ALPHA'), row('p2', 'BRAVO')] };
/** The ladder is spent: one HUD still has not answered. */
const SPENT: EndDeliveryView = { match_id: 'm-1', total: 2, confirmed: 1, retrying: false,
  unconfirmed: [row('p2', 'BRAVO', { tries: 7, retrying: false, reached: false })] };

const strip = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

async function recap(over: Partial<State>, rc: Partial<RecapView> = {}) {
  const d = await demo();
  const players = d.state!.players.slice(0, 2).map((p, i) => ({ ...p, player_id: i ? 'p2' : 'p1', display: i ? 'BRAVO' : 'ALPHA' }));
  const state: State = { ...d.state!, phase: 'recap', t: T_NOW, players, recap: { ...RECAP, ...rc },
    config: { ...d.state!.config, time_limit_s: 600 }, ...over };
  return mountScreen(<Recap />, { ...d, state, view: 'recap' });
}

describe('M1 · RECAP says one consistent thing about the END', () => {
  it('never says NEVER while MC is still re-delivering', async () => {
    const m = await recap({ end_delivery: EARLY });
    const el = m.find('[data-testid="end-delivery-recap"]')[0];
    const t = strip(el.textContent ?? '');
    expect(t).not.toContain('NEVER');
    expect(t).toContain('2 OF 2 NODES HAVE NOT CONFIRMED THE END YET (ALPHA, BRAVO)');
    expect(t).toContain('STILL RE-DELIVERING');
    expect(el.getAttribute('data-end-state')).toBe('retrying');
    expect(el.getAttribute('role'), 'a retry in progress is a status, not an alarm').toBe('status');
  });

  it('separates REACHED (the link took it) from CONFIRMED (the HUD answered)', async () => {
    const m = await recap({ end_delivery: EARLY });
    const t = strip(m.find('[data-testid="end-delivery-recap"]')[0].textContent ?? '');
    expect(t).toContain('THE END REACHED 2 OF THOSE 2 NODES, AND REACHING A NODE IS NOT A CONFIRMATION');
  });

  it('says NEVER, red, only once the ladder is spent', async () => {
    const m = await recap({ end_delivery: SPENT });
    const el = m.find('[data-testid="end-delivery-recap"]')[0];
    const t = strip(el.textContent ?? '');
    expect(t).toContain('1 OF 2 NODES NEVER CONFIRMED THE END (BRAVO)');
    expect(t).toContain('TOLD IT 7 TIMES AND HAS STOPPED');
    expect(t).toContain('THE END HAS NOT REACHED THAT NODE');
    expect(el.getAttribute('role')).toBe('alert');
  });

  it('no DATA SYNC chip says a bare SYNCED next to an unconfirmed END', async () => {
    const m = await recap({ end_delivery: SPENT });
    const alpha = strip(m.find('[data-sync-chip="p1"]')[0].textContent ?? '');
    const bravo = strip(m.find('[data-sync-chip="p2"]')[0].textContent ?? '');
    expect(alpha).toContain('DATA SYNCED ✓');
    expect(alpha).not.toContain('END NOT CONFIRMED');
    expect(bravo).toMatch(/DATA SYNCED ✓ ?· END NOT CONFIRMED/);
  });

  it('a phone MC has not heard from since the whistle is not called synced', async () => {
    const m = await recap({}, { settling: true, awaiting: ['p2'], since_end_ms: 3_000 });
    expect(strip(m.find('[data-sync-chip="p2"]')[0].textContent ?? '')).toContain('NO REPORT SINCE THE WHISTLE');
    expect(strip(m.find('[data-sync-chip="p2"]')[0].textContent ?? '')).not.toContain('SYNCED');
  });

  it('the text helper names the spent ladder for one phone, and returns null when all confirmed', () => {
    expect(recapDeliveryText({ ...SPENT, unconfirmed: [], confirmed: 2 })).toBeNull();
  });
});

describe('M23 · the RECAP header shows how long the match actually ran', () => {
  it('an early END reads as the real length, out of the limit', async () => {
    // the END froze the scorer 40 s ago, 160 s after the whistle
    const m = await recap({ live: LIVE }, { since_end_ms: 40_000 });
    const t = strip(m.find('[data-testid="recap-length"]')[0].textContent ?? '');
    expect(t).toBe('· 2:40 OF 10:00');
    expect(strip(m.text())).not.toMatch(/MATCH COMPLETE · TDM · 10:00 \]/);
  });

  it('a match that ran to its limit reads as the limit', async () => {
    const live = { ...LIVE, go_live_t: T_NOW - 605_000 };
    const m = await recap({ live }, { since_end_ms: 5_000 });
    expect(strip(m.find('[data-testid="recap-length"]')[0].textContent ?? '')).toBe('· 10:00');
  });

  it('without the fields to measure it (an older MC), the header says LIMIT, not a length', async () => {
    const m = await recap({ live: undefined });
    expect(strip(m.find('[data-testid="recap-length"]')[0].textContent ?? '')).toBe('· LIMIT 10:00');
  });
});
