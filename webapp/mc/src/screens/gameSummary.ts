// Shared game-summary helpers (GAMES cards, the DESIGNER rail, the KIT rules chip) — one generator everywhere.
import type { GameConfig } from '../api/types';

const PRESET_LABEL: Record<string, string> = { open: 'OPEN', no_heavies: 'NO HEAVIES', snipers: 'SNIPERS ONLY', custom: 'CUSTOM RULES' };

/** identity of a game = everything but the per-apply id and the VENUE (environment / night are about where you play) */
export const gameSig = (c: GameConfig) => { const { config_id: _c, environment: _e, night: _n, ...rest } = c; void _c; void _e; void _n; return JSON.stringify(rest); };

/** one human line for a saved game / the live config — the same generator everywhere (cards, summary, HUD-like) */
export function rulesLine(cfg: GameConfig, weapons: { weapon_id: string; name: string }[], perks: { perk_id: string; name: string }[]) {
  const lp = cfg.loadout_policy; if (!lp) return '';
  const nm = (id?: string | null) => weapons.find(w => w.weapon_id === id)?.name ?? perks.find(k => k.perk_id === id)?.name ?? id ?? '';
  const out: string[] = [];
  if (lp.preset !== 'custom') out.push(PRESET_LABEL[lp.preset]);
  out.push(lp.primary.choice === 'fixed' ? `${nm(lp.primary.fixed_id).toUpperCase()} FOR EVERYONE` : `PRIMARY: ${lp.primary.choice.toUpperCase()} PICKS`);
  out.push(lp.secondary.choice === 'off' ? 'NO SLOT 2' : lp.secondary.choice === 'fixed' ? `SLOT 2: ${nm(lp.secondary.fixed_id).toUpperCase()}` : `SLOT 2: ${lp.secondary.kinds.map(k => k === 'weapon' ? 'WEAPON' : 'PERK').join(' OR ')}`);
  if (!lp.hud_select) out.push('NO PHONE PICKS');
  return out.join(' · ');
}

