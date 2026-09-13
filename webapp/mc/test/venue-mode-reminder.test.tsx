// T1-C item 3 — the ALT-hold backstop.
//
// The gun's indoor/outdoor setting (hold ALT 3 s) changes IR range and hit-LED brightness and
// PERSISTS ACROSS POWER CYCLES (docs/manual/operate.md). MC cannot drive it yet — every candidate
// command is unverified (compile.py `DRIVE_IO_MODE`, FOLLOWUPS F162) — so the only thing standing
// between the venue the operator picked and the guns actually being in that mode is a person walking
// the rack. The 2026-09-12 field session ran outdoors at ~7-32% hit rate; nobody had touched ALT.
//
// A physical field step belongs on screen at the moment it is actionable (the `SetupSteps`
// precedent, ui/SetupSteps.tsx), so this renders on GAMES (where the venue is picked) and KIT (where
// guns are handed out), dismissable once per session and RE-ARMED when the venue changes.
import { beforeEach, describe, expect, it } from 'vitest';
import { Games } from '../src/screens/Games';
import { Kit } from '../src/screens/Kit';
import { VenueModeReminder, resetVenueModeDismissal } from '../src/ui/VenueModeReminder';
import { demo, mountScreen } from './harness';
import type { State } from '../src/api/types';

function atVenue(base: State, environment: 'indoor' | 'outdoor'): State {
  return { ...base, config: { ...base.config, environment } };
}

describe('venue-mode reminder', () => {
  beforeEach(() => { resetVenueModeDismissal(); });

  it('names the venue the operator picked, and says the setting sticks', async () => {
    const d = await demo();
    for (const env of ['outdoor', 'indoor'] as const) {
      resetVenueModeDismissal();
      const m = await mountScreen(<VenueModeReminder />, { state: atVenue(d.state, env) });
      const box = m.find('[data-testid="venue-mode-reminder"]')[0];
      expect(box, `${env}: no reminder rendered`).toBeTruthy();
      const t = box.textContent ?? '';
      expect(t).toContain(env.toUpperCase());
      expect(t).toMatch(/ALT/);
      expect(t).toMatch(/3 S/);
      // WHY it matters at both venues: a gun left outdoor last night is still outdoor tonight.
      expect(t).toMatch(/POWER CYCLE/);
      m.unmount();
    }
  });

  it('the dismiss control actually removes it, and is a real tap target', async () => {
    const d = await demo();
    const m = await mountScreen(<VenueModeReminder />, { state: atVenue(d.state, 'outdoor') });
    const btn = m.find('[data-testid="venue-mode-dismiss"]')[0];
    expect(btn, 'no dismiss control').toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    // ui-build-verify §2: tap targets >= 36px. jsdom has no layout, so assert the declared minimum.
    expect(parseInt(btn.style.minHeight || '0', 10)).toBeGreaterThanOrEqual(36);
    expect(parseInt(btn.style.minWidth || '0', 10)).toBeGreaterThanOrEqual(36);
    await m.click(/DISMISS|✕/);
    expect(m.find('[data-testid="venue-mode-reminder"]').length).toBe(0);
    m.unmount();
  });

  it('a dismissal is remembered across screens — and re-armed when the venue changes', async () => {
    const d = await demo();
    const m = await mountScreen(<VenueModeReminder />, { state: atVenue(d.state, 'outdoor') });
    await m.click(/DISMISS|✕/);
    m.unmount();

    // same session, a different screen: still dismissed (it is one reminder, not one per screen)
    const again = await mountScreen(<VenueModeReminder />, { state: atVenue(d.state, 'outdoor') });
    expect(again.find('[data-testid="venue-mode-reminder"]').length).toBe(0);
    again.unmount();

    // ...but switching venue is a NEW physical step on every gun, so it comes back

    const flipped = await mountScreen(<VenueModeReminder />, { state: atVenue(d.state, 'indoor') });
    expect(flipped.find('[data-testid="venue-mode-reminder"]').length).toBe(1);
    expect(flipped.text()).toContain('INDOOR');
    flipped.unmount();
  });

  it('renders on GAMES and on KIT', async () => {
    const d = await demo();
    for (const Screen of [Games, Kit]) {
      resetVenueModeDismissal();
      const m = await mountScreen(<Screen />, {
        state: atVenue(d.state, 'outdoor'), weapons: d.weapons, perks: d.perks, api: d.api,
      });
      expect(m.find('[data-testid="venue-mode-reminder"]').length,
        `${Screen.name}: reminder missing`).toBe(1);
      expect(m.text()).toContain('OUTDOOR');
      m.unmount();
    }
  });

  it('says nothing when the server predates this UI (no environment on the config)', async () => {
    const d = await demo();
    const cfg = { ...d.state.config } as Record<string, unknown>;
    delete cfg.environment;
    const stale = { ...d.state, config: cfg } as unknown as State;
    const m = await mountScreen(<VenueModeReminder />, { state: stale });
    expect(m.find('[data-testid="venue-mode-reminder"]').length).toBe(0);
    m.unmount();
  });
});
