// Demo data from the design export (guns renamed GUN-A…GUN-H — real sticker ids never enter the repo).
import type { GameConfig, ModeInfo, ModeParamSpec, PerkView, Team, WeaponView } from '../api/types';
import { defaultPolicy } from './policy';

export const TEAMS: Team[] = [
  { team_id: 'blue', name: 'BLUE TEAM', color: 'blue', tid: 1 },
  { team_id: 'yellow', name: 'YELLOW TEAM', color: 'yellow', tid: 2 },
  { team_id: 'red', name: 'RED TEAM', color: 'red', tid: 0 },
  { team_id: 'green', name: 'GREEN TEAM', color: 'green', tid: 3 },
];

// GENERATED from mcp/brx_mcp/mc/weapons.json (python: see git log) — the demo must show the SHIPPED numbers, not the design-export ones (review 2026-08-27 #3).
const RAW = [
 {
  "weapon_id": "assault_rifle",
  "name": "Assault Rifle",
  "desc": "The anchor \u2014 its frame is the one every other weapon is measured against. 13 hits at 190ms with 32 up and 384 in reserve: 32 kills without resupply, the deepest pool in the arsenal, and the slowest kill in it.",
  "role": "assault",
  "mag": 32,
  "reserve": 384,
  "reload_ms": 1400,
  "dmg": 8,
  "rof": 39,
  "rng": 75,
  "htk": 13,
  "verified": false,
  "cls": "0",
  "tags": [
   "assault"
  ]
 },
 {
  "weapon_id": "burst_rifle",
  "name": "Burst Rifle",
  "desc": "A real three-round burst \u2014 one pull, three rounds, and the gun enforces the gap. 13 hits from a 36-round mag with 216 behind it; the most total ammo of the burst pair, and the tighter of the two.",
  "role": "assault",
  "mag": 36,
  "reserve": 216,
  "reload_ms": 1700,
  "dmg": 8,
  "rof": 100,
  "rng": 75,
  "htk": 13,
  "verified": true,
  "cls": "0",
  "tags": [
   "assault"
  ]
 },
 {
  "weapon_id": "force_rifle",
  "name": "Force Rifle",
  "desc": "The burst rifle's heavier twin: same three-round pull, more per round. 12 hits instead of 13 and a faster kill, paid for with two-thirds the reserve and a slower five-part reload.",
  "role": "assault",
  "mag": 36,
  "reserve": 144,
  "reload_ms": 1700,
  "dmg": 9,
  "rof": 75,
  "rng": 75,
  "htk": 12,
  "verified": false,
  "cls": "0",
  "tags": [
   "assault"
  ]
 },
 {
  "weapon_id": "bolt_rifle",
  "name": "Bolt Rifle",
  "desc": "Single shot, deliberate cadence. 13 a hit every 225ms with 18 up and 180 back \u2014 22 kills from a full kit for operators who would rather aim than hold.",
  "role": "assault",
  "mag": 18,
  "reserve": 180,
  "reload_ms": 2000,
  "dmg": 11,
  "rof": 33,
  "rng": 75,
  "htk": 9,
  "verified": true,
  "cls": "0",
  "tags": [
   "assault"
  ]
 },
 {
  "weapon_id": "smg",
  "name": "SMG",
  "desc": "A hose that runs hot. 8 a hit every 140ms from a 72-round mag \u2014 four kills before you reload, 24 across the kit, and an overheat budget that punishes holding the trigger down forever.",
  "role": "cqb",
  "mag": 72,
  "reserve": 288,
  "reload_ms": 2500,
  "dmg": 7,
  "rof": 54,
  "rng": 75,
  "htk": 15,
  "verified": false,
  "cls": "1",
  "tags": [
   "cqb"
  ]
 },
 {
  "weapon_id": "shotgun",
  "name": "Shotgun",
  "desc": "Shell by shell, and the fastest recovery on the board. 45 a hit at 800ms, three hits to drop, six in the tube and a 400ms shell reload \u2014 sustained pressure from the shallowest ammo pool outside the power tier.",
  "role": "cqb",
  "mag": 6,
  "reserve": 24,
  "reload_ms": 400,
  "dmg": 39,
  "rof": 9,
  "rng": 75,
  "htk": 3,
  "verified": false,
  "cls": "3",
  "tags": [
   "cqb"
  ]
 },
 {
  "weapon_id": "stinger",
  "name": "Stinger",
  "desc": "Fast, light, relentless. 15 a hit every 250ms with 18 up and 144 in reserve \u2014 eight hits to drop, twenty kills to spend, and nothing held back for range.",
  "role": "cqb",
  "mag": 18,
  "reserve": 144,
  "reload_ms": 1700,
  "dmg": 13,
  "rof": 30,
  "rng": 75,
  "htk": 8,
  "verified": false,
  "cls": "6",
  "tags": [
   "cqb"
  ]
 },
 {
  "weapon_id": "sniper_rifle",
  "name": "Sniper Rifle",
  "desc": "Two hits, one lane, a bolt between them. 60 a hit on a 1.5s cycle with four in the mag and 24 behind it \u2014 the fewest hits to a kill outside the power tier, and no margin for a miss.",
  "role": "marksman",
  "mag": 4,
  "reserve": 24,
  "reload_ms": 1700,
  "dmg": 52,
  "rof": 5,
  "rng": 75,
  "htk": 2,
  "verified": false,
  "cls": "2",
  "tags": [
   "marksman",
   "sniper"
  ]
 },
 {
  "weapon_id": "plasma_sniper",
  "name": "Plasma Sniper",
  "desc": "A marksman rifle that fires like a carbine and pays for it in heat. 25 a hit every 400ms, five to drop, ten up and 80 back \u2014 lean on it and it overheats.",
  "role": "marksman",
  "mag": 10,
  "reserve": 80,
  "reload_ms": 2000,
  "dmg": 22,
  "rof": 19,
  "rng": 75,
  "htk": 5,
  "verified": false,
  "cls": "2",
  "tags": [
   "marksman",
   "sniper"
  ]
 },
 {
  "weapon_id": "amr",
  "name": "AMR",
  "desc": "Anti-materiel weight at a rifle's cadence. 24 a hit every 400ms, five hits to a kill, 14 up and only 56 behind \u2014 the hardest-hitting automatic and the shallowest.",
  "role": "support",
  "mag": 14,
  "reserve": 56,
  "reload_ms": 1400,
  "dmg": 21,
  "rof": 19,
  "rng": 75,
  "htk": 5,
  "verified": false,
  "cls": "4",
  "tags": [
   "support",
   "sniper"
  ]
 },
 {
  "weapon_id": "suppressor",
  "name": "Suppressor",
  "desc": "Quiet, not silent, and no muzzle flash \u2014 the only weapon here that hides where you are. 8 a hit every 160ms with 384 in reserve: 28 kills, the deepest sustained pool, the slowest kill.",
  "role": "support",
  "mag": 48,
  "reserve": 384,
  "reload_ms": 2000,
  "dmg": 7,
  "rof": 47,
  "rng": 75,
  "htk": 15,
  "verified": false,
  "cls": "1",
  "tags": [
   "support"
  ]
 },
 {
  "weapon_id": "energy_rifle",
  "name": "Energy Rifle",
  "desc": "A 300-cell battery that barely stops. 9 a hit every 200ms, 23 kills on one magazine and 69 across the kit \u2014 the largest ammo pool in the game, on the smallest per-hit number.",
  "role": "support",
  "mag": 300,
  "reserve": 600,
  "reload_ms": 2400,
  "dmg": 8,
  "rof": 38,
  "rng": 75,
  "htk": 13,
  "verified": false,
  "cls": "5",
  "tags": [
   "support"
  ]
 },
 {
  "weapon_id": "charge_rifle",
  "name": "Charge Rifle",
  "desc": "Hold, release, hit hard. A 1.25s charge into 100 damage \u2014 two hits to a kill and a heat budget that ends the party if you rush it; twelve up, twelve back.",
  "role": "support",
  "mag": 12,
  "reserve": 12,
  "reload_ms": 2500,
  "dmg": 87,
  "rof": 6,
  "rng": 75,
  "htk": 2,
  "verified": false,
  "cls": "5",
  "tags": [
   "support"
  ]
 },
{
 "weapon_id": "glock",
 "name": "Glock-18",
 "desc": "The starting pistol. 9 a hit as fast as you can pull, 20 in the mag and 120 behind it: 13 hits to drop, 10 kills across the kit. Weak per shot, deep for a sidearm, and always ready.",
 "role": "sidearm",
 "mag": 20,
 "reserve": 120,
 "reload_ms": 2200,
 "dmg": 8,
 "rof": 50,
 "rng": 75,
 "htk": 13,
 "verified": false,
 "cls": "10",
 "tags": [
  "sidearm",
  "pistol"
 ]
},
{
 "weapon_id": "usp",
 "name": "USP-S",
 "desc": "The quiet one. Suppressed and flashless: 13 a hit at a measured cadence, 9 hits to drop, 12 in the mag with 72 behind it. Nobody hears where it came from.",
 "role": "sidearm",
 "mag": 12,
 "reserve": 72,
 "reload_ms": 2200,
 "dmg": 11,
 "rof": 38,
 "rng": 75,
 "htk": 9,
 "verified": false,
 "cls": "10",
 "tags": [
  "sidearm",
  "pistol"
 ]
},
{
 "weapon_id": "deagle",
 "name": "Desert Eagle",
 "desc": "The hand cannon. 24 a hit, five hits to drop, and the fastest kill a sidearm gets \u2014 if you land them. Seven in the mag, 36 behind it, and a slow cycle that punishes a miss.",
 "role": "sidearm",
 "mag": 7,
 "reserve": 36,
 "reload_ms": 2200,
 "dmg": 21,
 "rof": 20,
 "rng": 75,
 "htk": 5,
 "verified": false,
 "cls": "10",
 "tags": [
  "sidearm",
  "pistol"
 ]
},
 {
  "weapon_id": "rocket_launcher",
  "name": "Rocket Launcher",
  "desc": "Point, pull, erase. 115 a hit \u2014 a full-health operator in one \u2014 on the fastest power-tier cycle, with the slowest reload behind it. Four rounds, four kills, no second chances.",
  "role": "power",
  "mag": 2,
  "reserve": 2,
  "reload_ms": 2600,
  "dmg": 100,
  "rof": 8,
  "rng": 75,
  "htk": 1,
  "verified": false,
  "cls": "9",
  "tags": [
   "power",
   "heavy"
  ]
 },
 {
  "weapon_id": "rail_gun",
  "name": "Rail Gun",
  "desc": "Charges and fires itself. A 1.2s wind-up that goes whether you are ready or not, 115 on impact, four rounds total \u2014 everyone within earshot hears the spool.",
  "role": "power",
  "mag": 2,
  "reserve": 2,
  "reload_ms": 2400,
  "dmg": 100,
  "rof": 6,
  "rng": 75,
  "htk": 1,
  "verified": false,
  "cls": "7",
  "tags": [
   "power",
   "heavy"
  ]
 },
 {
  "weapon_id": "laser_cannon",
  "name": "Laser Cannon",
  "desc": "Must be held to charge; a tap fires nothing at all. 1.5s of commitment for a guaranteed kill, and the fastest reload in the power tier for the trouble.",
  "role": "power",
  "mag": 2,
  "reserve": 2,
  "reload_ms": 1600,
  "dmg": 100,
  "rof": 5,
  "rng": 75,
  "htk": 1,
  "verified": false,
  "cls": "4",
  "tags": [
   "power",
   "heavy"
  ]
 },
 {
  "weapon_id": "energy_launcher",
  "name": "Energy Launcher",
  "desc": "No charge, no tell, no warning. 115 a hit with the fastest reload on the board and the slowest cycle in its tier \u2014 four kills, spent quietly.",
  "role": "power",
  "mag": 2,
  "reserve": 2,
  "reload_ms": 1400,
  "dmg": 100,
  "rof": 5,
  "rng": 75,
  "htk": 1,
  "verified": false,
  "cls": "9",
  "tags": [
   "power",
   "heavy"
  ]
 },
 {
  "weapon_id": "ion_sniper",
  "name": "Ion Sniper",
  "desc": "A one-shot kill in a rifle's body. 115 a hit on a 1.4s cycle with two up and two back \u2014 the power tier's only weapon that looks and sounds like a marksman rifle.",
  "role": "power",
  "mag": 2,
  "reserve": 2,
  "reload_ms": 2000,
  "dmg": 100,
  "rof": 5,
  "rng": 75,
  "htk": 1,
  "verified": false,
  "cls": "2",
  "tags": [
   "power",
   "heavy",
   "sniper"
  ]
 }
] as const;
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
const SNIPERS = new Set(['sniper_rifle', 'plasma_sniper', 'ion_sniper', 'amr']);
const CAUTION: Record<string, string> = { energy_launcher: 'Known issue: deals no damage in our shipped config (weapon-design.md) — avoid until fixed' };
export const WEAPONS: WeaponView[] = RAW.map(r => ({
  weapon_id: r.weapon_id, name: r.name, desc: r.desc, cls: r.cls, role: r.role,
  tags: r.tags.length ? [...r.tags] : [r.role === 'power' ? 'heavy' : r.role, ...(SNIPERS.has(r.weapon_id) ? ['sniper'] : [])],
  clip: r.mag, mags: Math.max(1, Math.round(r.reserve / Math.max(r.mag, 1))), reserve: r.reserve, reload_s: Math.round(r.reload_ms / 100) / 10,
  dmg: r.dmg, rpm: r.rof, rng: r.rng, htk: r.htk, verified: r.verified, caution: CAUTION[r.weapon_id],
}));

// mirrors mcp/brx_mcp/mc/perks.json (loadout.md §1.2) — v1 is passive-only; slot-frame perks stay hidden until benched.
export const PERKS: PerkView[] = [
  { perk_id: 'body_armor', name: 'Body Armor', desc: 'Start every life with 50 extra armor. Armor soaks hits before health does.', tags: ['passive'], mechanism: 'passive', effects: { max_armor_add: 50 }, verified: true },
  { perk_id: 'extended_mags', name: 'Extended Mags', desc: 'Double the magazine and the reserve on your primary. Fewer reloads, longer fights.', tags: ['passive'], mechanism: 'passive', effects: { ammo_mult: 2 }, verified: true },
  { perk_id: 'quick_hands', name: 'Quick Hands', desc: 'Reload your primary in half the time.', tags: ['passive'], mechanism: 'passive', effects: { reload_mult: 0.5 }, verified: false },
  { perk_id: 'easy_reload', name: 'Easy Reload', desc: 'The orange alt-fire button reloads — no lever pull. For players who struggle with the mechanic.', tags: ['passive'], mechanism: 'passive', effects: { alt_reload: true }, verified: true },
  { perk_id: 'quick_switch', name: 'Quick Switch', desc: 'Draw your second weapon in half the time: the gun\'s swap delay drops from 0.85 s to 0.43 s.', tags: ['passive'], mechanism: 'passive', effects: { switch_mult: 0.5 }, verified: true },
];

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
  loadout_policy: defaultPolicy(mode),
  ...over,
});

// A18 (F105, 2026-09-11): the real schema shapes from `params_schema_json` for the three modes that declare
// tunables, so the mock's demo of the params UI is truthful rather than empty — tdm/ffa/infection get `[]`
// (they declare none, same as the server).
const KOTH_PARAMS: ModeParamSpec[] = [
  { name: 'score_target', type: 'int', default: 0, desc: 'point-seconds a team needs to win; 0 = most possession when the clock runs out', min: 0, max: 36000 },
  { name: 'points_per_s', type: 'float', default: 1.0, desc: 'points a held point earns its owner every second', min: 0.1, max: 60 },
];
const LMS_PARAMS: ModeParamSpec[] = [
  { name: 'lives', type: 'int', default: 3, desc: 'lives per player; the last one standing wins', min: 1, max: 20 },
];
const EXTRACTION_PARAMS: ModeParamSpec[] = [
  { name: 'channel_s', type: 'float', default: 45.0, desc: 'seconds a player must hold the extraction point', min: 5, max: 600 },
  { name: 'win_target', type: 'int', default: 0, desc: 'banked loot that wins the raid outright; 0 = the clock decides', min: 0, max: 100000 },
  { name: 'loot_per_kill', type: 'int', default: 10, desc: 'loot a killer picks up per kill', min: 0, max: 1000 },
  { name: 'drop_policy', type: 'str', default: 'ground', desc: "where a downed player's loot goes", choices: ['ground', 'killer', 'pool'] },
  { name: 'extract_removes_player', type: 'bool', default: true, desc: "an extracted player is out of the raid (off: they respawn clean)" },
];

export const MODES: ModeInfo[] = [
  { mode: 'tdm', name: 'TEAM DEATHMATCH', abbr: 'TDM', desc: 'Teams score per elimination',
    brief: 'Squads score a point per elimination. Downed players respawn after the delay and rejoin. First team to the score cap — or the highest score at the time limit — takes the match.',
    teams_text: '2–4 TEAMS', win_text: 'SCORE CAP / TIME', respawn_text: 'ON · TIMED', params: [], defaults: base('tdm') },
  { mode: 'ffa', name: 'FREE-FOR-ALL', abbr: 'FFA', desc: 'Every operator for themselves',
    brief: 'No teams — everyone is a target. Each elimination scores a point. First to the frag limit, or the top score when time expires, wins.',
    teams_text: 'NONE · ALL VS ALL', win_text: 'FRAG LIMIT / TIME', respawn_text: 'ON · TIMED', params: [],
    defaults: base('ffa', { teams: [{ team_id: 'ffa', name: 'FFA', color: 'ffa', tid: 1 }], scoring: { frag_limit: 15, win_by: 'kills' } }) },
  { mode: 'infection', name: 'INFECTION', abbr: 'INF', desc: 'One infected; survive the spread',
    brief: 'One operator starts infected. Survivors who go down switch sides and hunt their old squad. Survivors win by outlasting the clock; the infected win by converting everyone.',
    teams_text: 'SURVIVORS VS INFECTED', win_text: 'SURVIVE THE CLOCK', respawn_text: 'INFECTED ONLY', params: [],
    defaults: base('infection', { scoring: { frag_limit: null, win_by: 'survival' } }) },
  { mode: 'lms', name: 'LAST MAN STANDING', abbr: 'LMS', desc: 'Limited lives, last alive wins',
    brief: 'Every operator carries a fixed pool of lives. Once they are spent there is no respawn. The last operator — or last squad — still standing takes the match.',
    teams_text: 'SOLO OR SQUADS', win_text: 'LAST ALIVE', respawn_text: 'OFF · LIVES', params: LMS_PARAMS,
    defaults: base('lms', { respawn: { type: 'none', delay_s: 0 }, scoring: { frag_limit: null, win_by: 'survival' }, mode_params: { lives: 3 } }) },
  { mode: 'extraction', name: 'EXTRACTION', abbr: 'EXT', desc: 'Reach the objective and hold it',
    brief: 'Attackers push to the extraction point and hold it through the capture timer. Defenders deny until time expires. Sides swap between rounds.',
    teams_text: '2 TEAMS', win_text: 'HOLD TO CAPTURE', respawn_text: 'ON · TIMED', params: EXTRACTION_PARAMS,
    defaults: base('extraction', { scoring: { frag_limit: null, win_by: 'objective' },
      mode_params: { channel_s: 45.0, win_target: 0, loot_per_kill: 10, drop_policy: 'ground', extract_removes_player: true } }) },
  // F82: BLUE + GREEN (tids 1 and 3). Yellow is tid 2, which is what a NEUTRAL hill broadcasts, so a
  // yellow roster would read every uncaptured point as its own — the server refuses it outright.
  { mode: 'koth', name: 'KING OF THE HILL', abbr: 'KOTH', desc: 'Hold the hill; possession scores',
    brief: 'One hill, and it is a real grenade on the field. Shoot the point and it flips to your team; every second your side holds it banks possession. A point your team does not own damages anyone standing on it, so taking one is a fight. Most possession time when the clock runs out takes the match.',
    teams_text: '2 TEAMS', win_text: 'POSSESSION TIME · HOST CALL', respawn_text: 'ON · TIMED', params: KOTH_PARAMS,
    defaults: base('koth', { teams: [TEAMS[0], TEAMS[3]], scoring: { frag_limit: null, win_by: 'objective' }, station_source: 'grenade',
      mode_params: { score_target: 0, points_per_s: 1.0 } }) },
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
