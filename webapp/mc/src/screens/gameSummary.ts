// Shared game-summary helpers (GAMES cards, the DESIGNER rail, the KIT rules chip) — one generator everywhere.
import type { GameConfig, LoadoutPolicy, SlotRule } from '../api/types';

const rule = (over: Partial<SlotRule> = {}): SlotRule => ({ choice: 'player', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: null, ...over });
/** OPEN — what the server means by "no policy". A config from a session persisted before A10, or served by an older MC,
 *  has no `loadout_policy` at all; every page must tolerate that (Tony hit "cannot read 'preset' of undefined"). */
export const DEFAULT_POLICY = (): LoadoutPolicy => ({ preset: 'open', hud_select: true, primary: rule(), secondary: rule({ kinds: ['weapon', 'perk'] }) });
export const withPolicy = (c: GameConfig): GameConfig => (c.loadout_policy?.primary && c.loadout_policy.secondary ? c : { ...c, loadout_policy: DEFAULT_POLICY() });

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

