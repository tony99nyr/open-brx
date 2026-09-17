// F162 supersedes the dismissable venue reminder (bench, 2026-09-16): a banner that had to be
// dismissed on every screen, every session, was "obnoxious" (Tony's word). It is gone. In its place
// GAMES carries one small, quiet link beside the venue setting that opens the manual page explaining
// how to set the gun's own native ALT mode, in a new tab. There is no dismiss state and no storage
// to test any more: a link needs none.
import { describe, expect, it } from 'vitest';
import { Games } from '../src/screens/Games';
import { Kit } from '../src/screens/Kit';
import { demo, mountScreen } from './harness';

const MANUAL_ALT_MODE_URL = 'https://open-brx.iamrossi.workers.dev/manual/operate#indoor-vs-outdoor-mode';

describe('the venue-mode manual link', () => {
  it('sits beside the venue setting on GAMES, points at the manual anchor, and opens in a new tab', async () => {
    const d = await demo();
    const m = await mountScreen(<Games />, { state: d.state, weapons: d.weapons, perks: d.perks, api: d.api });
    const link = m.find('[data-testid="venue-mode-manual-link"]')[0] as HTMLAnchorElement | undefined;
    expect(link, 'no manual link rendered beside the venue setting').toBeTruthy();
    expect(link!.getAttribute('href')).toBe(MANUAL_ALT_MODE_URL);
    expect(link!.getAttribute('target')).toBe('_blank');
    // `noopener` is required; a page may also add `noreferrer`, so check the token rather than the
    // whole attribute string.
    expect((link!.getAttribute('rel') ?? '').split(/\s+/)).toContain('noopener');
    // it lives inside the same venue control group, not floating elsewhere on the page
    const venueGroup = m.find('[role="group"][aria-label="venue"]')[0];
    expect(venueGroup, 'no venue control group found').toBeTruthy();
    expect(venueGroup!.contains(link!)).toBe(true);
    m.unmount();
  });

  it('renders no venue warning or dismiss control on GAMES or KIT', async () => {
    const d = await demo();
    for (const Screen of [Games, Kit]) {
      const m = await mountScreen(<Screen />, { state: d.state, weapons: d.weapons, perks: d.perks, api: d.api });
      expect(m.find('[data-testid="venue-mode-reminder"]').length, `${Screen.name}: a reminder banner still renders`).toBe(0);
      expect(m.find('[data-testid="venue-mode-dismiss"]').length, `${Screen.name}: a dismiss control still renders`).toBe(0);
      expect(m.find('[role="status"][data-testid*="venue"]').length, `${Screen.name}: something venue-shaped still uses role="status"`).toBe(0);
      m.unmount();
    }
  });
});
