// Demo data from the design export (guns renamed GUN-A…GUN-H — real sticker ids never enter the repo).
import type { ConfigView, GameConfig, ModeInfo, ModeParamSpec, PerkView, Team, WeaponView } from '../api/types';
import { defaultPolicy } from './policy';

export const TEAMS: Team[] = [
  { team_id: 'blue', name: 'BLUE TEAM', color: 'blue', tid: 1 },
  { team_id: 'yellow', name: 'YELLOW TEAM', color: 'yellow', tid: 2 },
  { team_id: 'red', name: 'RED TEAM', color: 'red', tid: 0 },
  { team_id: 'green', name: 'GREEN TEAM', color: 'green', tid: 3 },
];

// GENERATED-START weapons
// Regenerate: python3 mcp/tools/gen_ui_catalog.py - never hand-edit between the markers.
export const WEAPONS: WeaponView[] = [
  {
    "weapon_id": "amr",
    "name": "AMR",
    "cls": "4",
    "weapon_class": "ballistic",
    "desc": "Anti-materiel weight at a rifle's cadence. 24 a hit every 400ms, five hits to a kill, 14 up and only 56 behind. The hardest-hitting automatic, and the shallowest.",
    "clip": 14,
    "mags": 4,
    "reserve": 56,
    "reload_s": 1.4,
    "reload_ms": 1400,
    "dmg": 21,
    "rpm": 19,
    "rng": 75,
    "dmg_per_hit": 24,
    "pool": 115,
    "verified": false,
    "tags": [
      "support",
      "sniper"
    ],
    "role": "support",
    "htk": 5,
    "ttk_ms": 1600,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 70,
    "bars": {
      "power": 50,
      "rof": 56,
      "ammo": 49,
      "ttk": 50
    }
  },
  {
    "weapon_id": "assault_rifle",
    "name": "Assault Rifle",
    "cls": "0",
    "weapon_class": "ballistic",
    "desc": "The anchor, and the real stock M4 cadence. 13 hits at 100ms with 32 up and 192 in reserve: 17 kills without resupply and a 1.20s kill. 2026-09-17 arsenal review: cycle is back to Battle Company's native 100ms (it was throttled to 140ms so a deep reserve could not also out-cycle the field); the dominance test now grades on one-magazine kill chance rather than total kills, so the reserve alone no longer has to carry the whole weight of keeping the AR in check.",
    "clip": 32,
    "mags": 6,
    "reserve": 192,
    "reload_s": 1.4,
    "reload_ms": 1400,
    "dmg": 8,
    "rpm": 75,
    "rng": 75,
    "dmg_per_hit": 9,
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 13,
    "ttk_ms": 1200,
    "recoil": {
      "ceiling": 100,
      "floor": 70,
      "per_shot": 10,
      "recover_ms": 150
    },
    "ammo_total": 224,
    "bars": {
      "power": 30,
      "rof": 85,
      "ammo": 71,
      "ttk": 90
    }
  },
  {
    "weapon_id": "burst_rifle",
    "name": "Burst Rifle",
    "cls": "0",
    "weapon_class": "ballistic",
    "desc": "A real three-round burst: one pull, three rounds, and the gun enforces the gap. 11 hits from a 36-round mag with 216 behind it; the most total ammo of the burst pair, and the tighter of the two. 2026-09-17 arsenal review: damage raised 9 to 11 so the burst pair separates further from the SMG-class assault weapons on hits-to-kill, not only on cadence.",
    "clip": 36,
    "mags": 6,
    "reserve": 216,
    "reload_s": 1.7,
    "reload_ms": 1700,
    "dmg": 10,
    "rpm": 100,
    "rng": 75,
    "dmg_per_hit": 11,
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 11,
    "ttk_ms": 1417,
    "recoil": {
      "ceiling": 100,
      "floor": 85,
      "per_shot": 5,
      "recover_ms": 150
    },
    "ammo_total": 252,
    "bars": {
      "power": 40,
      "rof": 100,
      "ammo": 78,
      "ttk": 70
    }
  },
  {
    "weapon_id": "charge_rifle",
    "name": "Charge Rifle",
    "cls": "5",
    "weapon_class": "energy",
    "desc": "Pre-charge it behind cover, then the kill is one release and two taps: an 85-damage charge (held indefinitely, 3.5s by feel to build although the wire's t14 reads 1250ms) plus two 20-damage taps drops a 115 pool in about 1s from release -- 3 trigger actions, 12 of the 40 rounds up, 84 of the roughly-103 heat budget (S43). The charge time is setup, not combat time: that is the weapon's identity. Forty up, eighty back -- three combo kills a magazine, ten across the kit.",
    "clip": 40,
    "mags": 2,
    "reserve": 80,
    "reload_s": 2.5,
    "reload_ms": 2500,
    "dmg": 74,
    "rpm": 6,
    "rng": 75,
    "dmg_per_hit": 85,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 3,
    "ttk_ms": 1000,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 120,
    "bars": {
      "power": 90,
      "rof": 27,
      "ammo": 56,
      "ttk": 100
    }
  },
  {
    "weapon_id": "deagle",
    "name": "Desert Eagle",
    "cls": "10",
    "weapon_class": "ballistic",
    "desc": "The hand cannon. 26 a hit, five hits to drop — the most damage of any sidearm, if you land them. Seven in the mag, 48 behind it: 11 kills across the kit. A slow cycle that punishes every miss.",
    "clip": 7,
    "mags": 6,
    "reserve": 48,
    "reload_s": 2.2,
    "reload_ms": 2200,
    "dmg": 23,
    "rpm": 16,
    "rng": 75,
    "dmg_per_hit": 26,
    "pool": 115,
    "verified": false,
    "tags": [
      "sidearm",
      "pistol"
    ],
    "role": "sidearm",
    "htk": 5,
    "ttk_ms": 1920,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 55,
    "bars": {
      "power": 60,
      "rof": 49,
      "ammo": 42,
      "ttk": 30
    }
  },
  {
    "weapon_id": "energy_rifle",
    "name": "Energy Rifle",
    "cls": "5",
    "weapon_class": "energy",
    "desc": "A 300-cell battery that barely stops. 9 a hit every 150ms, 23 kills on one magazine and 69 across the kit. The largest ammo pool in the game, on the smallest per-hit number. 2026-09-17 bench (F229): now genuinely overheats — full auto locks it out around heat 99 after about 30 shots, and unlike the Charge Rifle it does not cool on its own; only the reload lever (a hold, not a tap) vents it.",
    "clip": 300,
    "mags": 2,
    "reserve": 600,
    "reload_s": 2.4,
    "reload_ms": 2400,
    "dmg": 8,
    "rpm": 50,
    "rng": 75,
    "dmg_per_hit": 9,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 13,
    "ttk_ms": 1800,
    "caution": "Overheats after about 30 rounds of full auto, and it does not cool on its own: work the reload lever to vent the heat (about three pulls, or one held pull), then keep holding to recharge the cell.",
    "recoil": {
      "ceiling": 100,
      "floor": 70,
      "per_shot": 10,
      "recover_ms": 150
    },
    "ammo_total": 900,
    "bars": {
      "power": 30,
      "rof": 71,
      "ammo": 100,
      "ttk": 40
    }
  },
  {
    "weapon_id": "rail_gun",
    "name": "Rail Gun",
    "cls": "7",
    "weapon_class": "energy",
    "desc": "Charges and fires itself. A 1.2s wind-up that goes whether you are ready or not, 115 on impact, four rounds total. Everyone within earshot hears the spool.",
    "clip": 2,
    "mags": 1,
    "reserve": 2,
    "reload_s": 2.4,
    "reload_ms": 2400,
    "dmg": 100,
    "rpm": 6,
    "rng": 75,
    "dmg_per_hit": 115,
    "pool": 115,
    "verified": false,
    "tags": [
      "power",
      "heavy"
    ],
    "role": "power",
    "htk": 1,
    "ttk_ms": 1200,
    "pickup_only": true,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 4,
    "bars": {
      "power": 100,
      "rof": 27,
      "ammo": 20,
      "ttk": 90
    }
  },
  {
    "weapon_id": "rocket_launcher",
    "name": "Rocket Launcher",
    "cls": "9",
    "weapon_class": "ballistic",
    "desc": "Point, pull, erase. 115 a hit (a full-health operator in one) on the fastest power-tier cycle, with the slowest reload behind it. Four rounds, four kills, no second chances.",
    "clip": 2,
    "mags": 1,
    "reserve": 2,
    "reload_s": 2.6,
    "reload_ms": 2600,
    "dmg": 100,
    "rpm": 8,
    "rng": 75,
    "dmg_per_hit": 115,
    "pool": 115,
    "verified": false,
    "tags": [
      "power",
      "heavy"
    ],
    "role": "power",
    "htk": 1,
    "ttk_ms": 0,
    "pickup_only": true,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 4,
    "bars": {
      "power": 100,
      "rof": 35,
      "ammo": 20,
      "ttk": null
    }
  },
  {
    "weapon_id": "shotgun",
    "name": "Shotgun",
    "cls": "3",
    "weapon_class": "ballistic",
    "desc": "Shell by shell, and the fastest recovery on the board. 45 a hit at 800ms, three hits to drop, six in the tube and a 400ms shell reload. Sustained pressure from the shallowest ammo pool outside the power tier.",
    "clip": 6,
    "mags": 4,
    "reserve": 24,
    "reload_s": 0.4,
    "reload_ms": 400,
    "dmg": 39,
    "rpm": 9,
    "rng": 75,
    "dmg_per_hit": 45,
    "pool": 115,
    "verified": false,
    "tags": [
      "cqb"
    ],
    "role": "cqb",
    "htk": 3,
    "ttk_ms": 1600,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 30,
    "bars": {
      "power": 70,
      "rof": 42,
      "ammo": 35,
      "ttk": 50
    }
  },
  {
    "weapon_id": "smg",
    "name": "SMG",
    "cls": "1",
    "weapon_class": "ballistic",
    "desc": "A hose that runs hot. 8 a hit every 95ms from a 72-round mag: four kills before you reload, 24 across the kit, and an overheat budget that punishes holding the trigger down forever.",
    "clip": 72,
    "mags": 4,
    "reserve": 288,
    "reload_s": 2.5,
    "reload_ms": 2500,
    "dmg": 7,
    "rpm": 79,
    "rng": 75,
    "dmg_per_hit": 8,
    "pool": 115,
    "verified": false,
    "tags": [
      "cqb"
    ],
    "role": "cqb",
    "htk": 15,
    "ttk_ms": 1330,
    "recoil": {
      "ceiling": 100,
      "floor": 55,
      "per_shot": 15,
      "recover_ms": 150
    },
    "ammo_total": 360,
    "bars": {
      "power": 20,
      "rof": 93,
      "ammo": 85,
      "ttk": 80
    }
  },
  {
    "weapon_id": "sniper_rifle",
    "name": "Sniper Rifle",
    "cls": "2",
    "weapon_class": "ballistic",
    "desc": "Two hits, one lane, a bolt between them. 60 a hit on a 1.5s cycle with four in the mag and 24 behind it. The fewest hits to a kill outside the power tier, and no margin for a miss.",
    "clip": 4,
    "mags": 6,
    "reserve": 24,
    "reload_s": 1.7,
    "reload_ms": 1700,
    "dmg": 52,
    "rpm": 5,
    "rng": 75,
    "dmg_per_hit": 60,
    "pool": 115,
    "verified": false,
    "tags": [
      "marksman",
      "sniper"
    ],
    "role": "marksman",
    "htk": 2,
    "ttk_ms": 1500,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 28,
    "bars": {
      "power": 80,
      "rof": 20,
      "ammo": 27,
      "ttk": 60
    }
  },
  {
    "weapon_id": "suppressor",
    "name": "Suppressor",
    "cls": "1",
    "weapon_class": "ballistic",
    "desc": "Quiet, not silent, and no muzzle flash. It is the only weapon here that hides where you are. 8 a hit every 140ms with 75 up and 384 in reserve: 30 kills, the deepest magazine AND the deepest sustained pool, the slowest kill. 2026-09-17: mag 48→75 -- the family-scoped dominance test (§2.3) paired it against the SMG (same fire mode, same weapon_class), which beat it on every other axis; the deeper magazine gives the Suppressor an outright lead on kills-per-clip (5 vs the SMG's 4), which is the smallest change that stops the SMG strictly dominating it.",
    "clip": 75,
    "mags": 5,
    "reserve": 384,
    "reload_s": 2.0,
    "reload_ms": 2000,
    "dmg": 7,
    "rpm": 54,
    "rng": 75,
    "dmg_per_hit": 8,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 15,
    "ttk_ms": 1960,
    "recoil": {
      "ceiling": 100,
      "floor": 55,
      "per_shot": 15,
      "recover_ms": 150
    },
    "ammo_total": 459,
    "bars": {
      "power": 20,
      "rof": 78,
      "ammo": 93,
      "ttk": 20
    }
  },
  {
    "weapon_id": "usp",
    "name": "USP-S",
    "cls": "10",
    "weapon_class": "ballistic",
    "desc": "The quiet one. Suppressed and flashless: 9 a hit, as fast as you can pull the trigger, 13 hits to drop, 19 in the mag with 120 behind it: 10 kills across the kit. Low damage, but nobody hears where it came from. 2026-09-17: mag 20→19 -- Tony's ask was 20→14, but 14 leaves the Deagle strictly dominating the USP (its sustained DPS and one-magazine kill chance both fall too far once the mag is that shallow); 19 is the smallest cut off 20 that actually leaves neither pistol beating the other on every axis (a thin margin: sustained DPS differs by about 0.1 dmg/s, kill chance by 2 points).",
    "clip": 19,
    "mags": 6,
    "reserve": 120,
    "reload_s": 2.2,
    "reload_ms": 2200,
    "dmg": 8,
    "rpm": 47,
    "rng": 75,
    "dmg_per_hit": 9,
    "pool": 115,
    "verified": false,
    "tags": [
      "sidearm",
      "pistol"
    ],
    "role": "sidearm",
    "htk": 13,
    "ttk_ms": 1920,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 139,
    "bars": {
      "power": 30,
      "rof": 64,
      "ammo": 64,
      "ttk": 30
    }
  }
];
// GENERATED-END weapons

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');

// GENERATED-START perks
// Visible perks only, exactly as `GET /api/perks` serves them.
export const PERKS: PerkView[] = [
  {
    "perk_id": "body_armor",
    "name": "Body Armor",
    "desc": "Start every life with 50 extra armor. Armor soaks hits before your health does — you survive one or two more shots in every fight.",
    "tags": [
      "passive",
      "defense"
    ],
    "mechanism": "passive",
    "effects": {
      "max_armor_add": 50
    },
    "verified": true,
    "hidden": false
  },
  {
    "perk_id": "extended_mags",
    "name": "Extended Mags",
    "desc": "Double the magazine and double the reserve on your primary. Fewer reloads, longer fights, more rounds to burn.",
    "tags": [
      "passive",
      "ammo"
    ],
    "mechanism": "passive",
    "effects": {
      "ammo_mult": 2
    },
    "verified": true,
    "hidden": false
  },
  {
    "perk_id": "quick_hands",
    "name": "Quick Hands",
    "desc": "Reload in half the time. Your primary is back in the fight before theirs is.",
    "tags": [
      "passive",
      "handling"
    ],
    "mechanism": "passive",
    "effects": {
      "reload_mult": 0.5
    },
    "verified": false,
    "hidden": false
  },
  {
    "perk_id": "easy_reload",
    "name": "Easy Reload",
    "desc": "Press the orange ALT button to reload — no pump needed. For anyone who finds the pull-back reload hard to work.",
    "tags": [
      "passive",
      "handling",
      "assist"
    ],
    "mechanism": "passive",
    "effects": {
      "alt_reload": true
    },
    "verified": true,
    "hidden": false
  },
  {
    "perk_id": "quick_switch",
    "name": "Quick Switch",
    "desc": "Draw your second weapon in half the time: the gun's swap delay drops from 0.85 s to 0.43 s.",
    "tags": [
      "passive",
      "handling"
    ],
    "mechanism": "passive",
    "effects": {
      "switch_mult": 0.5
    },
    "verified": true,
    "hidden": false
  }
];
// GENERATED-END perks

const base = (mode: string, over: Partial<GameConfig> = {}): ConfigView => ({
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

// GENERATED-START modes
// Prose only; `params` and `defaults` below stay hand-written.
const MODE_TEXT: Record<string, Omit<ModeInfo, 'params' | 'defaults'>> = {
  "tdm": {
    "mode": "tdm",
    "name": "TEAM DEATHMATCH",
    "abbr": "TDM",
    "desc": "Teams score per elimination",
    "brief": "Squads score a point per elimination. Downed players respawn after the delay and rejoin. First team to the score cap — or the highest score at the time limit — takes the match.",
    "teams_text": "2–4 TEAMS",
    "win_text": "SCORE CAP / TIME",
    "respawn_text": "ON · TIMED"
  },
  "ffa": {
    "mode": "ffa",
    "name": "FREE-FOR-ALL",
    "abbr": "FFA",
    "desc": "Every operator for themselves",
    "brief": "No teams — everyone is a target. Each elimination scores a point. First to the frag limit, or the top score when time expires, wins.",
    "teams_text": "NONE · ALL VS ALL",
    "win_text": "FRAG LIMIT / TIME",
    "respawn_text": "ON · TIMED"
  },
  "infection": {
    "mode": "infection",
    "name": "INFECTION",
    "abbr": "INF",
    "desc": "One infected; survive the spread",
    "brief": "One operator starts infected. Survivors who go down switch sides and hunt their old squad. Survivors win by outlasting the clock; the infected win by converting everyone.",
    "teams_text": "SURVIVORS VS INFECTED",
    "win_text": "SURVIVE THE CLOCK",
    "respawn_text": "INFECTED ONLY"
  },
  "lms": {
    "mode": "lms",
    "name": "LAST MAN STANDING",
    "abbr": "LMS",
    "desc": "Limited lives, last alive wins",
    "brief": "Every operator carries a fixed pool of lives. Once they are spent there is no respawn. The last operator — or last squad — still standing takes the match.",
    "teams_text": "SOLO OR SQUADS",
    "win_text": "LAST ALIVE",
    "respawn_text": "OFF · LIVES"
  },
  "extraction": {
    "mode": "extraction",
    "name": "EXTRACTION",
    "abbr": "EXT",
    "desc": "Loot, reach the extract, survive the channel",
    "brief": "Gather loot, then reach an extraction point and channel the extract. It is loud: everyone hears the chopper coming and converges on you. Survive the timer and your loot is banked. Die and you drop it all for someone else to take.",
    "teams_text": "SOLO OR SQUADS",
    "win_text": "BANKED LOOT",
    "respawn_text": "ON · TIMED"
  },
  "koth": {
    "mode": "koth",
    "name": "KING OF THE HILL",
    "abbr": "KOTH",
    "desc": "Hold the hill; possession scores",
    "brief": "One hill, and it is a real grenade on the field. Shoot the point and it flips to your team; every second your side holds it banks possession. A point your team does not own damages anyone standing on it, so taking one is a fight, and a defended hill costs an attacker exactly what the defenders put into it. Most possession time when the clock runs out takes the match.",
    "teams_text": "2 TEAMS",
    "win_text": "POSSESSION TIME · HOST CALL",
    "respawn_text": "ON · TIMED"
  }
};
// GENERATED-END modes

export const MODES: ModeInfo[] = [
  { ...MODE_TEXT.tdm, params: [], defaults: base('tdm') },
  { ...MODE_TEXT.ffa, params: [],
    defaults: base('ffa', { teams: [{ team_id: 'ffa', name: 'FFA', color: 'ffa', tid: 1 }], scoring: { frag_limit: 15, win_by: 'kills' } }) },
  { ...MODE_TEXT.infection, params: [],
    defaults: base('infection', { scoring: { frag_limit: null, win_by: 'survival' } }) },
  { ...MODE_TEXT.lms, params: LMS_PARAMS,
    defaults: base('lms', { respawn: { type: 'none', delay_s: 0 }, scoring: { frag_limit: null, win_by: 'survival' }, mode_params: { lives: 3 } }) },
  { ...MODE_TEXT.extraction, params: EXTRACTION_PARAMS,
    defaults: base('extraction', { scoring: { frag_limit: null, win_by: 'objective' },
      mode_params: { channel_s: 45.0, win_target: 0, loot_per_kill: 10, drop_policy: 'ground', extract_removes_player: true } }) },
  // F82: BLUE + GREEN (tids 1 and 3). Yellow is tid 2, which is what a NEUTRAL hill broadcasts, so a
  // yellow roster would read every uncaptured point as its own — the server refuses it outright.
  { ...MODE_TEXT.koth, params: KOTH_PARAMS,
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
