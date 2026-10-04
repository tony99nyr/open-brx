// The team colour rules PLAY needs on the client, mirroring mcp/brx_mcp/mc/gamepick.py
// (`legal_colours`, `carry_teams`). One module so the mock backend and the TEAMS chooser agree.
import type { TeamColour } from './api/types';
import { TEAM_KEYS } from './api/contract.gen';

/** The strip's own order: the order a swapped-in colour is chosen in. */
export const ALL_TEAM_COLOURS: TeamColour[] = [...TEAM_KEYS];

/** A hill mode never uses yellow: tid 2 is the team a NEUTRAL hill broadcasts (F82). */
const OBJECTIVE_MODES = new Set(['domination', 'koth']);

export function legalColours(mode: string): TeamColour[] {
  return ALL_TEAM_COLOURS.filter(c => !(OBJECTIVE_MODES.has(mode) && c === 'yellow'));
}

/** Bench 2026-09-28 (Tony): a mode change keeps the operator's teams when the new mode's default has
 *  the same count, and swaps only a colour the new mode cannot use for a free legal one (the default's
 *  colours first). A different count, or nothing to carry, takes the new mode's own default. */
export function carryTeams(prev: TeamColour[] | undefined | null, def: TeamColour[], mode: string): TeamColour[] {
  if (!prev?.length || prev.length !== def.length) return [...def];
  const legal = legalColours(mode);
  const kept = prev.map(c => (legal.includes(c) ? c : null));
  const free = [...new Set([...def, ...legal])].filter(c => legal.includes(c) && !kept.includes(c));
  return kept.map(c => c ?? free.shift()!);
}
