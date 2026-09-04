// A11: the read-only ADVANCED — SOUNDS & LIGHTS panel. Mounted with the mock backend (the same one ?mock
// uses) and with the two failure shapes a real server produces: no such route (older MC) and an error.
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { AdvancedPresentation } from '../src/screens/AdvancedPresentation';
import { Designer } from '../src/screens/Designer';
import { demo, mountScreen } from './harness';

describe('ADVANCED — sounds & lights (read only)', () => {
  it('starts collapsed, opens to the table with sources, words and the confidence line, and collapses again', async () => {
    const d = await demo();
    const m = await mountScreen(<AdvancedPresentation />, { state: d.state, weapons: d.weapons, perks: d.perks });
    expect(m.find('[data-testid^="pres-row-"]').length).toBe(0);
    expect(m.find('button[aria-expanded="false"]').length).toBe(1);
    await m.click('ADVANCED');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });   // let the fetch effect settle
    expect(m.find('button[aria-expanded="true"]').length).toBe(1);
    const hit = m.find('[data-testid="pres-row-hit_taken"]')[0];
    expect(hit).toBeTruthy();
    const src = (row: HTMLElement) => row.querySelectorAll('td')[1].textContent?.trim();   // the SOURCE cell, not the whole row
    expect(src(hit)).toBe('HUD');
    const lead = m.find('[data-testid="pres-row-lead_taken"]')[0];
    expect(src(lead)).toBe('MC');
    expect(lead.textContent).toMatch(/VA6D/);
    expect(lead.textContent).toMatch(/takes the lead/i);
    expect(m.find('[data-testid="presentation-preset"]')[0].textContent).toMatch(/standard/i);
    expect(m.find('[data-testid="mc-confidence"]')[0].textContent).toMatch(/MC NOT CONFIDENT — OFFLINE 1/);
    const hs = m.find('[data-testid="headset-block"]')[0].textContent ?? '';          // A11.6 block, read only
    expect(hs).toMatch(/PRE-GAME TEAM COLOUR/); expect(hs).toMatch(/AT THE WHISTLE WHITE FLASH, THEN DARK/);
    expect(hs).toMatch(/ON HIT RED FLASH/); expect(hs).toMatch(/WHILE OUT NATIVE GREEN OUT-BLINK/); expect(hs).toMatch(/CARRYING THE FLAG BLINK THE FLAG COLOUR/);
    expect(m.find('input, select').length).toBe(0);           // read only
    await m.click('ADVANCED');
    expect(m.find('[data-testid^="pres-row-"]').length).toBe(0);
    m.unmount();
  });

  it('says the server predates the UI when the route 404s, and shows nothing else', async () => {
    const d = await demo();
    const err = Object.assign(new Error('not found'), { status: 404 });
    const m = await mountScreen(<AdvancedPresentation />, { state: d.state, api: { getPresentation: async () => { throw err; } } });
    await m.click('ADVANCED');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    const alert = m.find('[role="alert"]')[0];
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/PREDATES THIS UI/);
    expect(alert.textContent).toMatch(/brx_mcp\.mc/);           // the restart command is on screen
    expect(m.find('[data-testid^="pres-row-"]').length).toBe(0);
    m.unmount();
  });

  it('shows any other error with its message instead of a blank panel', async () => {
    const d = await demo();
    const m = await mountScreen(<AdvancedPresentation />, { state: d.state, api: { getPresentation: async () => { throw new Error('boom'); } } });
    await m.click('ADVANCED');
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    expect(m.find('[role="alert"]')[0].textContent).toMatch(/COULD NOT LOAD.*BOOM/);
    m.unmount();
  });

  it('is part of the Designer, collapsed, so the editing flow is unchanged', async () => {
    const d = await demo();
    const m = await mountScreen(<Designer />, { state: d.state, weapons: d.weapons, perks: d.perks, view: 'build' });
    expect(m.find('[data-testid="advanced-presentation"] button[aria-expanded="false"]').length).toBe(1);
    expect(m.text()).toMatch(/ADVANCED — SOUNDS & LIGHTS/);
    m.unmount();
  });
});
