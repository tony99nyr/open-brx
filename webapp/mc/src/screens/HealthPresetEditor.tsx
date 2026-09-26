// LIFE PRESET + ADVANCED (Tony 2026-09-19, FOLLOWUPS S45, weapon-design.md §7.3). Shared by DESIGNER
// and GameEditPanel's inline edit of a loaded game, so the two screens can never drift into different
// pools or a different idea of what counts as CUSTOM.
//
// Replaces the old free "custom health"/"armour" fields (no shield at all) with three named presets
// (STANDARD 45/70/0 · SHIELDS 45/0/105, a recharging shield · HARDCORE 45/0/0) and an ADVANCED
// section carrying the raw numbers for a hand-tuned game. The preset shown is always DERIVED from the
// three numbers (`healthPresetOf`, mirroring the server's own `compile.resolve_health_preset`), never a
// separate stored choice the two could disagree about — editing any Advanced number shows CUSTOM at once.
import { useState } from 'react';
import type { Health, HealthPreset } from '../api/types';
import { F, T } from '../tokens';
import { BTN_RESET, ValueBox } from '../ui';
import { colourOf } from '../alerts';
import { HEALTH_PRESETS, HEALTH_PRESET_COPY, healthPresetOf } from './gameSummary';

export function HealthPresetEditor({ health, onChange }: { health: Health; onChange: (h: Health) => void }) {
  const preset = healthPresetOf(health);
  // Starts open on a CUSTOM game (an already hand-tuned pool should not hide its own numbers), closed
  // otherwise. Not re-derived after mount — same one-shot pattern `GameEditPanel`'s own toggles use.
  const [open, setOpen] = useState(preset === 'custom');

  const pickPreset = (name: Exclude<HealthPreset, 'custom'>) => onChange({ ...HEALTH_PRESETS[name], preset: name });
  const editNumber = (patch: Partial<Pick<Health, 'max_hp' | 'max_armor' | 'max_shield'>>) => {
    const next = { max_hp: health.max_hp, max_armor: health.max_armor, max_shield: health.max_shield, ...patch };
    onChange({ ...next, preset: healthPresetOf(next) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span role="group" aria-label="life preset" style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {HEALTH_PRESET_COPY.map(p => (
          <button key={p.value} type="button" data-testid={`health-preset-${p.value}`} title={p.hint}
            aria-pressed={preset === p.value} onClick={() => pickPreset(p.value)} className="hov-acc"
            style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.12em', padding: '7px 12px', minHeight: 36, cursor: 'pointer',
                     background: preset === p.value ? T.acc : 'transparent', color: preset === p.value ? T.accInk : T.dim,
                     border: `1px solid ${preset === p.value ? T.acc : T.line}` }}>
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          // F221: an editorial-choice indicator (a hand-tuned pool), not a warning — the amber fill it
          // used to share with a genuine warning chip made it read as an alert when it is not one (NOT-ALERT).
          <span data-testid="health-preset-custom" style={{ font: F.chk(700, 11), letterSpacing: '.12em', padding: '7px 12px',
                   minHeight: 36, display: 'inline-flex', alignItems: 'center', background: 'transparent', color: colourOf('frame-health-preset-custom'), border: `1px solid ${T.line2}` }}>
            CUSTOM
          </span>
        )}
      </span>
      <button type="button" data-testid="health-advanced-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ ...BTN_RESET, alignSelf: 'flex-start', font: F.mono(600, 11), letterSpacing: '.2em', color: T.acc, minHeight: 36, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
        {open ? '▾' : '▸'} ADVANCED
      </button>
      {open && (
        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <ValueBox value={health.max_hp} unit="HP" min={1} max={255} label="health" onChange={v => editNumber({ max_hp: v })} />
          <ValueBox value={health.max_armor} unit="AR" min={0} max={255} label="armor" onChange={v => editNumber({ max_armor: v })} />
          <ValueBox value={health.max_shield} unit="SH" min={0} max={255} label="shield" onChange={v => editNumber({ max_shield: v })} />
          <span style={{ font: F.mono(500, 11), letterSpacing: '.1em', color: T.micro, maxWidth: 340 }}>
            the shield recharges only in a game with no armour · a player's own POOL override (on KIT) still wins over HP/armour
          </span>
        </span>
      )}
    </div>
  );
}
