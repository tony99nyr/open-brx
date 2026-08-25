// Demo data from the design export (guns renamed GUN-A…GUN-H — real sticker ids never enter the repo).
import type { GameConfig, ModeInfo, Team, WeaponView } from '../api/types';

export const TEAMS: Team[] = [
  { team_id: 'blue', name: 'BLUE TEAM', color: 'blue', tid: 1 },
  { team_id: 'yellow', name: 'YELLOW TEAM', color: 'yellow', tid: 2 },
  { team_id: 'red', name: 'RED TEAM', color: 'red', tid: 0 },
  { team_id: 'green', name: 'GREEN TEAM', color: 'green', tid: 3 },
];

const W: [string, string, number, number, number, number, number, number][] = [
  ['Assault Rifle', 'AR', 32, 12, 1.4, 55, 85, 55], ['Burst Rifle', 'AR', 36, 6, 1.7, 65, 70, 80],
  ['Sniper Rifle', 'SNIPER', 4, 6, 1.7, 90, 20, 100], ['Shotgun', 'SHOTGUN', 6, 4, 0.4, 85, 25, 25],
  ['SMG', 'SMG', 72, 4, 2.5, 35, 95, 40], ['AMR', 'SNIPER', 14, 4, 1.4, 85, 55, 85],
  ['Energy Launcher', 'HEAVY', 1, 6, 1.4, 100, 10, 55], ['Rail Gun', 'HEAVY', 1, 6, 2.4, 100, 10, 85],
  ['Rocket Launcher', 'HEAVY', 2, 4, 1.2, 100, 12, 60], ['Laser Cannon', 'HEAVY', 4, 2, 2.0, 95, 18, 85],
  ['Charge Rifle', 'LMG', 100, 2, 2.5, 80, 60, 60], ['Bolt Rifle', 'AR', 18, 10, 2.0, 60, 50, 65],
  ['Plasma Sniper', 'SNIPER', 10, 8, 2.0, 85, 30, 90], ['Force Rifle', 'AR', 36, 4, 1.7, 55, 75, 60],
  ['Stinger', 'AR', 18, 4, 1.7, 80, 45, 70], ['Energy Rifle', 'LMG', 300, 2, 2.4, 40, 90, 50],
  ['Suppressor', 'SMG', 48, 6, 2.0, 75, 65, 55], ['Ion Sniper', 'SNIPER', 2, 6, 2.0, 85, 15, 90],
];
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
export const WEAPONS: WeaponView[] = W.map(([name, cls, clip, mags, reload_s, dmg, rpm, rng]) => ({
  weapon_id: slug(name), name, cls, clip, mags, reserve: clip * mags, reload_s, dmg, rpm, rng,
  verified: name === 'Assault Rifle' || name === 'Charge Rifle',
}));

const base = (mode: string, over: Partial<GameConfig> = {}): GameConfig => ({
  config_id: `cfg_${mode}`,
  mode,
  environment: 'outdoor',
  night: false,
  time_limit_s: 600,
  respawn: { type: 'auto', delay_s: 15 },
  scoring: { frag_limit: 25, win_by: 'kills' },
  health: { max_hp: 45, max_armor: 70 },
  teams: [TEAMS[0], TEAMS[1]],
  ...over,
});

export const MODES: ModeInfo[] = [
  { mode: 'tdm', name: 'TEAM DEATHMATCH', abbr: 'TDM', desc: 'Teams score per elimination',
    brief: 'Squads score a point per elimination. Downed players respawn after the delay and rejoin. First team to the score cap — or the highest score at the time limit — takes the match.',
    teams_text: '2–4 TEAMS', win_text: 'SCORE CAP / TIME', respawn_text: 'ON · TIMED', defaults: base('tdm') },
  { mode: 'ffa', name: 'FREE-FOR-ALL', abbr: 'FFA', desc: 'Every operator for themselves',
    brief: 'No teams — everyone is a target. Each elimination scores a point. First to the frag limit, or the top score when time expires, wins.',
    teams_text: 'NONE · ALL VS ALL', win_text: 'FRAG LIMIT / TIME', respawn_text: 'ON · TIMED',
    defaults: base('ffa', { teams: [{ team_id: 'ffa', name: 'FFA', color: 'ffa', tid: 1 }], scoring: { frag_limit: 15, win_by: 'kills' } }) },
  { mode: 'infection', name: 'INFECTION', abbr: 'INF', desc: 'One infected; survive the spread',
    brief: 'One operator starts infected. Survivors who go down switch sides and hunt their old squad. Survivors win by outlasting the clock; the infected win by converting everyone.',
    teams_text: 'SURVIVORS VS INFECTED', win_text: 'SURVIVE THE CLOCK', respawn_text: 'INFECTED ONLY',
    defaults: base('infection', { scoring: { frag_limit: null, win_by: 'survival' } }) },
  { mode: 'lms', name: 'LAST MAN STANDING', abbr: 'LMS', desc: 'Limited lives, last alive wins',
    brief: 'Every operator carries a fixed pool of lives. Once they are spent there is no respawn. The last operator — or last squad — still standing takes the match.',
    teams_text: 'SOLO OR SQUADS', win_text: 'LAST ALIVE', respawn_text: 'OFF · LIVES',
    defaults: base('lms', { respawn: { type: 'none', delay_s: 0 }, scoring: { frag_limit: null, win_by: 'survival' } }) },
  { mode: 'extraction', name: 'EXTRACTION', abbr: 'EXT', desc: 'Reach the objective and hold it',
    brief: 'Attackers push to the extraction point and hold it through the capture timer. Defenders deny until time expires. Sides swap between rounds.',
    teams_text: '2 TEAMS', win_text: 'HOLD TO CAPTURE', respawn_text: 'ON · TIMED',
    defaults: base('extraction', { scoring: { frag_limit: null, win_by: 'objective' } }) },
];

// guns: sticker, tail, readiness class (g=green, r=red, a1=battery unread, a2=stale link), batt, link age s
export const GUNS: [string, string, 'g' | 'r' | 'a1' | 'a2', number | null, number][] = [
  ['GUN-A', '3D4F', 'g', 87, 2], ['GUN-B', '91C2', 'g', 92, 1], ['GUN-C', '7A10', 'g', 64, 3],
  ['GUN-D', '22E8', 'r', null, 240], ['GUN-E', '5D77', 'g', 71, 2], ['GUN-F', 'A0B3', 'a1', null, 8],
  ['GUN-G', '4F19', 'g', 88, 1], ['GUN-H', 'C3E5', 'a2', 59, 52],
];
// players: callsign, team, gun index, kit state
export const PLAYERS: [string, string, number, 'kitted' | 'fitting' | 'trying' | 'waiting'][] = [
  ['REAPER', 'blue', 0, 'kitted'], ['VIPER', 'yellow', 1, 'fitting'], ['NOMAD', 'blue', 2, 'kitted'],
  ['GHOST', 'yellow', 4, 'trying'], ['HAVOC', 'blue', 6, 'kitted'], ['SABLE', 'yellow', 5, 'waiting'],
  ['ONYX', 'blue', 7, 'waiting'], ['DRIFT', 'yellow', 3, 'waiting'],
];
export const READY: Record<string, boolean> = { REAPER: true, VIPER: true, NOMAD: true, GHOST: true, HAVOC: true, SABLE: false, ONYX: true, DRIFT: false };
// live demo rows: name, k, d, a, acc, stk, status, sync s
export const LIVE: [string, number, number, number, number, number, 'alive' | 'down' | 'stale', number][] = [
  ['VIPER', 8, 2, 3, 42, 5, 'alive', 2], ['REAPER', 5, 3, 2, 35, 1, 'alive', 2], ['GHOST', 4, 4, 0, 33, 0, 'alive', 40],
  ['NOMAD', 4, 4, 1, 41, 2, 'alive', 3], ['HAVOC', 3, 4, 2, 31, 0, 'down', 1], ['SABLE', 3, 3, 2, 29, 1, 'alive', 5],
  ['ONYX', 2, 5, 1, 24, 0, 'alive', 2], ['DRIFT', 1, 5, 1, 22, 0, 'stale', 72],
];
export const RECAP: [string, number, number, number, number, number, string[]][] = [
  ['VIPER', 12, 4, 5, 38, 5, ['MVP', 'MOST KILLS', 'MULTIKILL']], ['REAPER', 8, 5, 2, 35, 3, ['BEST K/D']],
  ['GHOST', 7, 6, 2, 33, 2, ['FIRST BLOOD']], ['NOMAD', 6, 5, 2, 41, 2, ['SHARPSHOOTER']],
  ['HAVOC', 5, 6, 3, 31, 1, []], ['SABLE', 4, 5, 3, 29, 1, ['SURVIVOR']], ['ONYX', 2, 8, 1, 24, 0, []], ['DRIFT', 2, 7, 1, 22, 0, []],
];
