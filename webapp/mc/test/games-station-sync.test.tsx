// F401: a HELD station (e.g. a StickS3) can end a timed match on its own clock while out of Wi-Fi
// range, so MC only gets its result once it is brought back. LOAD warns -- on GAMES, the screen the
// operator sees before the next START -- for any station of the LAST FINISHED match MC has not heard
// from since that match's whistle (`Session._station_sync_warnings`, state.py). Advisory only.
import { describe, expect, it } from 'vitest';
import { Games } from '../src/screens/Games';
import { demo, mountScreen } from './harness';
import type { State } from '../src/api/types';

const SYNC_WARNING = 'RESPAWN 3 HAS NOT SYNCED THE LAST MATCH: BRING IT INTO WI-FI BEFORE YOU LOAD, OR ITS RESULT IS LOST';

const withWarnings = (base: State, warnings: string[]): State => ({ ...base, config_warnings: warnings });

describe('GAMES — the F401 station sync warning', () => {
  it('shows the amber warning for a station of the last match still unsynced', async () => {
    const d = await demo();
    const m = await mountScreen(<Games />, { ...d, state: withWarnings(d.state, [SYNC_WARNING]) });
    const row = m.find('[data-testid="games-station-not-synced"]')[0];
    expect(row, `expected the sync warning row, saw: ${m.text()}`).toBeTruthy();
    expect(row.textContent).toMatch(/RESPAWN 3/);
    expect(row.textContent).toMatch(/HAS NOT SYNCED THE LAST MATCH/);
    expect(row.getAttribute('data-sev')).toBe('amber');
    m.unmount();
  });

  it('CONTROL: no sync warning when config_warnings carries none', async () => {
    const d = await demo();
    const m = await mountScreen(<Games />, { ...d, state: withWarnings(d.state, []) });
    expect(m.find('[data-testid="games-station-not-synced"]').length).toBe(0);
    m.unmount();
  });

  it('does not mistake an unrelated warning for the sync line', async () => {
    const d = await demo();
    const m = await mountScreen(<Games />, { ...d, state: withWarnings(d.state, ['SETUP: PLACE THE GRENADE']) });
    expect(m.find('[data-testid="games-station-not-synced"]').length).toBe(0);
    m.unmount();
  });
});
