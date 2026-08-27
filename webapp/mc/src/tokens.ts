// Design tokens — from the Claude Design handoff README ("military armory" system).
export const T = {
  // ground & structure
  page: '#07090d', panel: '#0c1016', panelAlt: '#090d12', inset: '#05070a',
  line: '#1c2733', row: '#131c26', line2: '#25313f', slot: '#141c26', panelSoft: '#0e141b', panelDeep: '#0a0e13',
  // ink
  ink: '#e8eef5', body: '#c7d3de', dim: '#8aa0b4', micro: '#71879c', faint: '#3a4a5c',
  // accent
  acc: '#39b4ff', accHover: '#7fd0ff', accInk: '#04121e',
  // semantic
  ok: '#2ecc71', warn: '#ffb020', bad: '#ff5252',
} as const;

export const TEAM: Record<string, string> = {
  blue: '#3a86ff', yellow: '#ffd23f', red: '#ff5252', green: '#2ecc71', ffa: '#e8eef5',
};
export const teamColor = (id: string | null | undefined) => (id ? TEAM[id] ?? TEAM.ffa : TEAM.ffa);

export const CLS_COLOR: Record<string, string> = {
  AR: '#39b4ff', SMG: '#7fd0ff', SNIPER: '#ffd23f', SHOTGUN: '#ff8c42', HEAVY: '#ff5252', LMG: '#2ecc71',
};
/** weapons.json `role` → the human class label + colour (review round 3: no raw class ids on screen) */
export const ROLE: Record<string, { label: string; color: string }> = {
  assault: { label: 'ASSAULT', color: '#39b4ff' }, cqb: { label: 'CLOSE RANGE', color: '#ff8c42' }, marksman: { label: 'SNIPER', color: '#ffd23f' },
  support: { label: 'SUPPORT', color: '#2ecc71' }, power: { label: 'HEAVY', color: '#ff5252' }, melee: { label: 'MELEE', color: '#8aa0b4' },
};
export const roleOf = (role?: string, cls?: string) => ROLE[role ?? ''] ?? { label: (cls ?? '?').toUpperCase(), color: CLS_COLOR[cls ?? ''] ?? '#39b4ff' };
export const PERK_COLOR = '#c48bff';

// font shorthands (React accepts the CSS `font` shorthand as a string)
export const F = {
  osw: (w: number, px: number) => `${w} ${px}px 'Oswald','Arial Narrow',Impact,sans-serif`,
  chk: (w: number, px: number) => `${w} ${px}px 'Chakra Petch','Segoe UI',system-ui,sans-serif`,
  mono: (w: number, px: number) => `${w} ${px}px ui-monospace,monospace`,
};
export const TAB = { fontVariantNumeric: 'tabular-nums' } as const;
// clip-paths
export const CHAMFER = {
  tr12: 'polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)',
  tr14: 'polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)',
  br8: 'polygon(0 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%)',
  br10: 'polygon(0 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%)',
  tl10: 'polygon(10px 0,100% 0,100% 100%,0 100%,0 10px)',
  tl8: 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)',
  tl14: 'polygon(14px 0,100% 0,100% 100%,0 100%,0 14px)',
} as const;

export const STRIPES = (a = 8, b = 16) => `repeating-linear-gradient(45deg,${T.slot} 0 ${a}px,${T.panel} ${a}px ${b}px)`;
export const HAZARD = 'repeating-linear-gradient(135deg,#ff5252 0 5px,#0c0507 5px 10px)';
export const SEG_OVERLAY = (cell: number) => `repeating-linear-gradient(90deg,transparent 0 ${cell}px,${T.page} ${cell}px ${cell + 2}px)`;

export const fmtClock = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
export const fmtAge = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
};
