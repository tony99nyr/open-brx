import { describe, expect, it } from 'vitest';
import { MockBackend } from '../src/mock/backend';
import { WEAPON_MOCK_FIELDS } from '../src/api/contract.gen';
import { apply } from '../src/mock/policy';
import { mergeModeParams } from '../src/rules/modeParams';
import { defaultPresentation, mergePresentation, presentationView, profileFromPreset } from '../src/rules/presentation';
import { perkEffectsResolved, roundHalfEven } from '../src/rules/perkEffects';

describe('generated server rule inputs', () => {
  it('keeps an unchanged headset and gun preset, and merges a nested readout', () => {
    const current = profileFromPreset('standard');
    const unchanged = mergePresentation(current, { headset: structuredClone(current.headset), gun: structuredClone(current.gun) });
    expect(unchanged.preset).toBe('standard');
    const edited = mergePresentation(current, { gun: { readout: { hold_s: 3 } } });
    expect(edited.preset).toBe('custom');
    expect(edited.gun).toMatchObject({ readout: { pools: ['shield', 'armor', 'health'], hold_s: 3, reload_glance_s: 2 } });
    expect(defaultPresentation('cs').preset).toBe('counter_strike');
  });

  it('keeps a picked preset named when its full profile is sent (F527, as presentation.merge)', () => {
    for (const preset of ['infection', 'extraction', 'vip', 'counter_strike']) {
      const picked = mergePresentation(profileFromPreset('standard'), profileFromPreset(preset));
      expect(picked.preset, preset).toBe(preset);
      const [event, spec] = Object.entries(picked.events as Record<string, { sound?: string }>)[0];
      const changed = mergePresentation(picked, { events: { [event]: { sound: spec.sound === 'H29' ? 'X12' : 'H29' } } });
      expect(changed.preset, `${preset}: a real event edit`).toBe('custom');
      const back = mergePresentation(changed, { preset, events: { [event]: { ...spec } } });
      expect(back.preset, `${preset}: an edit back to the preset's own value`).toBe(preset);
    }
  });

  it('refuses bad presentation without changing the config or the roster', async () => {
    const backend = new MockBackend();
    const before = await backend.getState();
    await expect(backend.putConfig({ presentation: { voice: 'unknown' } as never })).rejects.toThrow(/presentation.voice/);
    await expect(backend.putConfig({ presentation: { events: { fake_event: { sound: 'VA7H' } } } as never }))
      .rejects.toThrow(/unknown presentation event/);
    const after = await backend.getState();
    expect(after.config).toEqual(before.config);
    expect(after.players).toEqual(before.players);
  });

  it('serves the generated presentation event catalogue', async () => {
    const backend = new MockBackend();
    const config = (await backend.getState()).config;
    const view = presentationView(config);
    expect(view.events.length).toBeGreaterThan(50);
    expect(view.events.find(row => row.event === 'lead_taken')?.sound).toBe('VA6D');
    expect(view.presets).toContain('silenced');
  });

  it('refuses unknown and out-of-range mode parameters', async () => {
    const backend = new MockBackend();
    const mode = (await backend.getModes()).find(row => row.mode === 'koth')!;
    expect(() => mergeModeParams(mode, undefined, { score_target: 36001 })).toThrow(/at most 36000/);
    expect(() => mergeModeParams(mode, undefined, { unknown: 1 })).toThrow(/has no parameter 'unknown'/);
    expect(() => mergeModeParams(mode, undefined, { score_target: null }), 'an explicit null is refused, as params.py').toThrow(/must be a number/);
  });

  it('drops an empty perk key and rounds exact midpoints to even', async () => {
    const backend = new MockBackend();
    const state = await backend.getState();
    const pool = state.loadout_pool!;
    const loadout = apply(state.config.loadout_policy, { weapons: [{ weapon_id: 'assault_rifle' }], perk: null },
      pool, await backend.getWeapons());
    expect(loadout).not.toHaveProperty('perk');
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
  });

  it('keeps a hidden primary from throwing during a state snapshot', async () => {
    const backend = new MockBackend();
    const state = await backend.getState();
    const hidden = WEAPON_MOCK_FIELDS.find(row => row.weapon_id === 'bolt_rifle')!;
    const player = structuredClone(state.players[0]);
    player.loadout = { weapons: [{ weapon_id: hidden.weapon_id }], perk: 'quick_hands' };
    const weapons = await backend.getWeapons(), perks = await backend.getPerks();
    expect(() => perkEffectsResolved(state.config, player, weapons, perks)).not.toThrow();
  });
});
