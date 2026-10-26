// health.js -- the ONE phone-side rule for "this game is on the Shields preset", and the perk row it selects.
// The server decides the same thing from the same three numbers (`compile.derived_health_preset`, which also drives the
// Body Armor / Armour Piercing refusal), and the console does too (`webapp/mc/src/rules/health.ts`). The preset
// numbers come from the generated contract, never a copy here. A health blob with no `max_shield` is a legacy
// (custom) pool, so it is never Shields.
import { HEALTH_PRESETS } from './transport/contract.gen.js';

/** True when `health`'s numbers ARE the Shields preset (45 HP, 0 armour, 105 shield), whatever its `preset` string says. */
export const isShieldsHealth = health => {
  const s = HEALTH_PRESETS.shields;
  return !!health && health.max_shield !== undefined && health.max_hp === s.max_hp && health.max_armor === s.max_armor && health.max_shield === s.max_shield;
};

/** MC's game health: the briefing (`st.game`, from `game_brief()`) carries it at the top level; a bundle config carries it too. */
export const gameHealth = st => (st && st.game && st.game.health) || (st && st.config && st.config.health) || null;

/** A perk row with its Shields variant (gain, cost AND effects) laid over it when the game is on Shields. */
export const perkForHealth = (perk, health) => (isShieldsHealth(health) && perk && perk.variants && perk.variants.shields ? { ...perk, ...perk.variants.shields } : perk);
