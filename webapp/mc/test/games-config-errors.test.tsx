// GAMES' `config_errors` strip, pinned as a fast test.
//
// `test/e2e/koth.mjs`'s `f88-multipoint-refused` step is the ONLY thing that has ever exercised this
// strip -- it intercepts both REST and the WebSocket to inject a fake F88 refusal and checks the rail
// keeps the reason, keeps the remedy, and stays legible. koth.mjs is the one suite a parallel lane
// cannot run (it hardcodes :8765), so a regression here -- the join separator swallowed, the text
// case-mangled past readability, the strip shrunk below the console's 11px floor -- would sit invisible
// until an operator hit a real refusal in the field and could not read why. This is the cheap half:
// it does not need a route interceptor or a browser, only `state.config_errors`.
import { describe, expect, it } from 'vitest';
import { Games } from '../src/screens/Games';
import { demo, mountScreen } from './harness';

// The exact string mcp/brx_mcp/mc/state.py sends for F88 (docs/spec/contracts.md), reason and remedy
// both load-bearing: an operator reads this line to know what to fix.
const F88 = 'F88: 3 control points on a grenade source is not buildable — a hill beacon carries no '
  + 'station id, so two grenades in range are indistinguishable on the wire and would fight over the '
  + 'same point. Run ONE point (koth), or supply a station source that names its point';

describe('the GAMES config_errors strip', () => {
  it('renders a server refusal with its reason and remedy intact, legibly', async () => {
    const d = await demo();
    const state = { ...d.state, config_errors: [F88] };
    const m = await mountScreen(<Games />, { ...d, state });

    const alert = m.find('[role="alert"]').find(el => /F88/.test(el.textContent ?? ''));
    expect(alert, 'a config_errors alert is on screen').toBeTruthy();
    const txt = (alert!.textContent ?? '').toUpperCase();
    expect(txt).toMatch(/NOT BUILDABLE/);          // the reason
    expect(txt).toMatch(/ONE POINT/);              // the remedy

    const px = parseFloat(getComputedStyle(alert!).fontSize);
    expect(px, `the refusal is legible (${px}px)`).toBeGreaterThanOrEqual(11);
    m.unmount();
  });

  it('joins MULTIPLE refusals visibly (not just the first, not silently dropped)', async () => {
    const d = await demo();
    const state = { ...d.state, config_errors: ['first refusal here', 'second refusal here'] };
    const m = await mountScreen(<Games />, { ...d, state });
    const alert = m.find('[role="alert"]').find(el => /REFUSAL/i.test(el.textContent ?? ''));
    expect(alert, 'the alert is on screen').toBeTruthy();
    const txt = (alert!.textContent ?? '').toUpperCase();
    expect(txt).toMatch(/FIRST REFUSAL HERE/);
    expect(txt).toMatch(/SECOND REFUSAL HERE/);
    m.unmount();
  });

  it('CONTROL: no config_errors, no alert -- the strip is not always-on noise', async () => {
    const d = await demo();
    const state = { ...d.state, config_errors: [] };
    const m = await mountScreen(<Games />, { ...d, state });
    const alert = m.find('[role="alert"]').find(el => /REFUSAL|F88|NOT BUILDABLE/i.test(el.textContent ?? ''));
    expect(alert, 'no refusal alert when config_errors is empty').toBeFalsy();
    m.unmount();
  });
});
