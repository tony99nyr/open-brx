// MC visual QA 2026-09-23, M1 and M23: what RECAP claims about the END, and how long the match ran.
//
// M1: one screen carried "8 HUDS NEVER CONFIRMED THE END" (five seconds after the whistle, while MC
// was still re-delivering), the command bar's "REACHED 8 OF 8 NODES", and eight "SYNCED ✓" chips.
// M23: the header printed the 10:00 time limit over a match that was ended early.
import { describe, expect, it } from 'vitest';
import { Recap } from '../src/screens/Recap';
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

/** F596: the server's `sync` view. The END is a FLAG on the phone's strip icon now, never a sentence. */
const sync = (over: Record<string, Partial<Record<string, unknown>>> = {}, pending = false) => ({ sync: { pending, finalised: false, result_changed: false,
  rows: ['p1', 'p2'].map(id => ({ kind: 'phone', id, name: id === 'p1' ? 'ALPHA' : 'BRAVO', team_id: 'blue', stage: 'received', transport: null,
    end_unconfirmed: false, idle_s: 0, stuck: false, ...(over[id] ?? {}) })) } } as unknown as Partial<RecapView>);

describe('M1 · RECAP says one consistent thing about the END', () => {
  it('prints no END sentence while MC is still re-delivering: one flag on the phone that has not confirmed', async () => {
    const m = await recap({ end_delivery: EARLY }, sync({ p1: { end_unconfirmed: true }, p2: { end_unconfirmed: true } }));
    expect(m.find('[data-testid="end-delivery-recap"]').length, 'the END block is gone').toBe(0);
    expect(strip(m.text())).not.toContain('HAVE NOT CONFIRMED THE END');
    expect(m.find('[data-strip-end]').length, 'one flag per unconfirmed phone').toBe(2);
  });

  it('a REACHED / CONFIRMED sentence is not on the screen either', async () => {
    const m = await recap({ end_delivery: EARLY }, sync({ p1: { end_unconfirmed: true } }));
    expect(strip(m.text())).not.toContain('REACHING A NODE IS NOT A CONFIRMATION');
  });

  it('colours the flag amber while re-delivering and red only once the ladder is spent', async () => {
    const retry = await recap({ end_delivery: EARLY }, sync({ p2: { end_unconfirmed: true } }));
    const spent = await recap({ end_delivery: SPENT }, sync({ p2: { end_unconfirmed: true } }));
    const col = (m: typeof retry) => (m.find('[data-strip-end]')[0] as HTMLElement).style.color;
    expect(col(retry)).not.toBe(col(spent));
    expect(spent.find('[data-testid="end-delivery-recap"]').length, 'a spent ladder prints no sentence either').toBe(0);
  });

  it('no per-player DATA SYNC chip is drawn; a phone with a flag says END not confirmed in its title', async () => {
    const m = await recap({ end_delivery: SPENT }, sync({ p2: { end_unconfirmed: true } }));
    expect(m.find('[data-sync-chip]').length).toBe(0);
    expect(m.find('[data-strip-icon="p2"]')[0].getAttribute('title')).toContain('END not confirmed');
    expect(m.find('[data-strip-icon="p1"]').length, 'a clean phone has no kept icon once all are in').toBe(0);
  });

  it('a phone MC has not heard from since the whistle is an unlinked icon, not a NO REPORT sentence', async () => {
    const m = await recap({}, sync({ p2: { stage: 'unlinked' } }, true));
    expect(m.find('[data-strip-icon="p2"]')[0].getAttribute('data-stage')).toBe('unlinked');
    expect(m.find('[data-strip-icon="p2"] [data-strip-unlinked]').length).toBe(1);
    expect(strip(m.text())).not.toContain('NO REPORT SINCE THE WHISTLE');
    expect(m.find('[data-sync-chip]').length).toBe(0);
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
