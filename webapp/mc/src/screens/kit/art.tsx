// KIT's artwork: the padlock, weapon art, perk glyphs and a perk's trade line. Split out of Kit.tsx
// (round-2 candidate 11).
import { useState, type CSSProperties } from 'react';
import type { PerkView } from '../../api/types';
import { PERK_COLOR, T } from '../../tokens';

// F221 polish r2 (Low): a lock icon is not inherently a warning -- every call site passes its own
// colour (amber only for a real fault); the default is the ordinary data colour, not T.warn.
export function Lock({ color = T.micro, size = 10 }: { color?: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" fill={color} /><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke={color} strokeWidth="2.5" /></svg>;
}

/** A weapon photo, with a visible fallback. `background: url(...)` has no error event, so a missing
 *  jpg used to show an empty coloured box with nothing on screen saying why (`stripper`/`smoke_gun`
 *  have none yet, and it read as a UI bug, not a missing asset — field 2026-09-18). An <img> DOES
 *  fire `onError`: swap it for a generic weapon glyph, the same precedent `PerkGlyph` sets for a
 *  perk. `key={weapon_id}` at each call site resets the fallback when the weapon changes. */
export function WeaponArt({ id, size = 24, style, testId }: { id: string; size?: number; style?: React.CSSProperties; testId?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return (
    <span data-testid={testId} data-art="fallback" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.dim, ...style }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="8" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" strokeLinecap="round" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
  return <img data-testid={testId} data-art="photo" src={`assets/weapons/${id}.jpg`} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', ...style }} onError={() => setBroken(true)} />;
}

export function PerkGlyph({ id, size = 24, color = PERK_COLOR }: { id: string; size?: number; color?: string }) {
  const c = { fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'body_armor': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path {...c} d="M12 3v18M4 12h16" opacity=".5" /></svg>;
    case 'extended_mags': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M8 3h8v18H8zM8 8h8M8 13h8M8 18h8" /><path {...c} d="M4 6v12M20 6v12" opacity=".5" /></svg>;
    case 'fast_hands': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M13 2 5 13h6l-1 9 9-12h-6z" /><path {...c} d="M3 7h4M17 18h4" /></svg>;
    case 'easy_reload': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M20 12a8 8 0 1 1-2.3-5.7" /><path {...c} d="M20 4v5h-5" /><circle cx="12" cy="12" r="2" fill={color} stroke="none" /></svg>;
    case 'med_kit': return <svg width={size} height={size} viewBox="0 0 24 24"><rect {...c} x="3" y="6" width="18" height="14" rx="2" /><path {...c} d="M12 10v6M9 13h6M9 6V4h6v2" /></svg>;
    default: return <svg width={size} height={size} viewBox="0 0 24 24"><circle {...c} cx="12" cy="12" r="8" /><path {...c} d="M12 8v4l3 2" /></svg>;
  }
}

// S50 (2026-09-19): a perk's GAIN and COST used to be derived here from `effects`, and disagreed with
// the phone's own copy of the same arithmetic — every `reload_mult` printed "FASTER" regardless of
// which side of 1 it fell on (body_armor's 1.25 is a COST), and Armour Piercing's slower cycle had no
// line at all. Both now come from the server (`mcp/brx_mcp/mc/perks.py` `gain_cost_lines`, on every
// `PerkView` as `gain`/`cost`) — this file only renders the two lists, never derives them.
/** `k.gain`/`k.cost` as one inline run of text: gain in the perk colour, cost in an ordinary data tone
 *  (F221 polish, 2026-09-25: T.body, not the alert amber — never a team colour, never red — S50 desc F)
 *  so the two kinds of fact read as different at a glance, not just by word order. Renders 'PASSIVE'
 *  plain when a perk (a node-local one with nothing compiled, or a stale server that has not shipped
 *  the two lists yet) carries neither. */
export function PerkTrade({ k, style, health }: { k: PerkView; style?: CSSProperties; health?: { max_armor?: number; max_shield?: number } }) {
  k = perkForHealth(k, health);
  const gain = k.gain ?? [], cost = k.cost ?? [];
  if (!gain.length && !cost.length) return <span style={style}>PASSIVE</span>;
  return (
    <span style={style}>
      {gain.length > 0 && <span style={{ color: PERK_COLOR }}>{gain.join(' · ')}</span>}
      {gain.length > 0 && cost.length > 0 && ' · '}
      {cost.length > 0 && <span style={{ color: T.body }}>{cost.join(' · ')}</span>}
    </span>
  );
}

export function perkForHealth(k: PerkView, health?: { max_armor?: number; max_shield?: number }): PerkView {
  return health?.max_armor === 0 && (health.max_shield ?? 0) > 0 && k.variants?.shields
    ? { ...k, ...k.variants.shields }
    : k;
}
