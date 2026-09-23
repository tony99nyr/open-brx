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
    "desc": "Anti-materiel, and it reads like it. Heavy hits at a pace nothing else at that range can match.",
    "clip": 14,
    "mags": 4,
    "reserve": 56,
    "reload_s": 1.4,
    "reload_ms": 1400,
    "dmg": 18,
    "rpm": 19,
    "rng": 75,
    "dmg_per_hit": 21,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "marksman",
      "sniper"
    ],
    "role": "marksman",
    "htk": 6,
    "ttk_ms": 2000,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "crit_pct": 30,
    "hir": [
      21
    ],
    "ammo_total": 70,
    "bars": {
      "power": 56,
      "rof": 49,
      "ammo": 49,
      "ttk": 40
    }
  },
  {
    "weapon_id": "assault_rifle",
    "name": "Assault Rifle",
    "cls": "0",
    "weapon_class": "ballistic",
    "desc": "The one everything else is measured against. Nothing it does is remarkable, and there is no fight it cannot hold.",
    "clip": 32,
    "mags": 6,
    "reserve": 192,
    "reload_s": 1.4,
    "reload_ms": 1400,
    "dmg": 8,
    "rpm": 75,
    "rng": 75,
    "dmg_per_hit": 9,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 13,
    "ttk_ms": 1200,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 70,
      "per_shot": 10,
      "recover_ms": 150,
      "degraded": 70,
      "heavy": 40,
      "after_heavy": 7
    },
    "hir": [
      9
    ],
    "ammo_total": 224,
    "bars": {
      "power": 38,
      "rof": 93,
      "ammo": 77,
      "ttk": 93
    }
  },
  {
    "weapon_id": "burst_rifle",
    "name": "Burst Rifle",
    "cls": "0",
    "weapon_class": "ballistic",
    "desc": "Three rounds a pull, and the gun decides the gap rather than your finger. Slower to the kill than the rifle, and far harder to waste.",
    "clip": 36,
    "mags": 6,
    "reserve": 216,
    "reload_s": 1.7,
    "reload_ms": 1700,
    "dmg": 9,
    "rpm": 100,
    "rng": 75,
    "dmg_per_hit": 10,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 12,
    "ttk_ms": 2567,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "crit_pct": 40,
    "hir": [
      10
    ],
    "ammo_total": 252,
    "bars": {
      "power": 47,
      "rof": 100,
      "ammo": 83,
      "ttk": 33
    }
  },
  {
    "weapon_id": "charge_rifle",
    "name": "Charge Rifle",
    "cls": "5",
    "weapon_class": "energy",
    "desc": "Hold it, and it holds. A full charge and three taps ends anyone, which is why it belongs to whoever saw the other person first.",
    "clip": 40,
    "mags": 2,
    "reserve": 80,
    "reload_s": 2.5,
    "reload_ms": 2500,
    "dmg": 61,
    "rpm": 6,
    "rng": 75,
    "dmg_per_hit": 70,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "marksman",
      "sniper"
    ],
    "role": "marksman",
    "htk": 4,
    "ttk_ms": 855,
    "rounds_per_charge": 10,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      16,
      70
    ],
    "ammo_total": 120,
    "bars": {
      "power": 91,
      "rof": 27,
      "ammo": 54,
      "ttk": 100
    }
  },
  {
    "weapon_id": "deagle",
    "name": "Desert Eagle",
    "cls": "10",
    "weapon_class": "ballistic",
    "desc": "Rounds heavy enough to end a fight your rifle already started, not many of them and slow between pulls. Miss twice and you are reloading in front of someone.",
    "clip": 7,
    "mags": 6,
    "reserve": 48,
    "reload_s": 2.2,
    "reload_ms": 2200,
    "dmg": 23,
    "rpm": 11,
    "rng": 75,
    "dmg_per_hit": 26,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "sidearm",
      "pistol"
    ],
    "role": "sidearm",
    "htk": 5,
    "ttk_ms": 2800,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      26
    ],
    "ammo_total": 55,
    "bars": {
      "power": 64,
      "rof": 42,
      "ammo": 43,
      "ttk": 27
    }
  },
  {
    "weapon_id": "energy_rifle",
    "name": "Energy Rifle",
    "cls": "5",
    "weapon_class": "energy",
    "desc": "The cell barely stops. When it finally does, the recharge is long enough to lose the fight you were winning.",
    "clip": 300,
    "mags": 2,
    "reserve": 600,
    "reload_s": 2.4,
    "reload_ms": 2400,
    "dmg": 8,
    "rpm": 50,
    "rng": 75,
    "dmg_per_hit": 9,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 13,
    "ttk_ms": 1800,
    "rounds_per_charge": 1,
    "caution": "Overheats after about 30 rounds of full auto, and it does not cool on its own: work the reload lever to vent the heat (about three pulls, or one held pull), then keep holding to recharge the cell.",
    "recoil": {
      "ceiling": 100,
      "floor": 70,
      "per_shot": 10,
      "recover_ms": 150
    },
    "hir": [
      9
    ],
    "ammo_total": 900,
    "bars": {
      "power": 38,
      "rof": 64,
      "ammo": 100,
      "ttk": 60
    }
  },
  {
    "weapon_id": "rail_gun",
    "name": "Rail Gun",
    "cls": "7",
    "weapon_class": "energy",
    "desc": "A single charged slug that ends whoever it finds. Two shots, and then it is scrap.",
    "clip": 2,
    "mags": 1,
    "reserve": 2,
    "reload_s": 2.4,
    "reload_ms": 2400,
    "dmg": 130,
    "rpm": 6,
    "rng": 75,
    "dmg_per_hit": 149,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "power",
      "heavy"
    ],
    "role": "power",
    "htk": 1,
    "ttk_ms": 1200,
    "rounds_per_charge": 1,
    "pickup_only": true,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      149
    ],
    "ammo_total": 4,
    "bars": {
      "power": 100,
      "rof": 27,
      "ammo": 20,
      "ttk": 93
    }
  },
  {
    "weapon_id": "rocket_launcher",
    "name": "Rocket Launcher",
    "cls": "9",
    "weapon_class": "ballistic",
    "desc": "One round, one player, no argument. Two in the tube and nothing to reload from.",
    "clip": 2,
    "mags": 1,
    "reserve": 2,
    "reload_s": 2.6,
    "reload_ms": 2600,
    "dmg": 130,
    "rpm": 8,
    "rng": 75,
    "dmg_per_hit": 150,
    "dual_emitter": true,
    "pool": 115,
    "verified": false,
    "tags": [
      "power",
      "heavy"
    ],
    "role": "power",
    "htk": 1,
    "ttk_ms": 0,
    "rounds_per_charge": 1,
    "pickup_only": true,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      35,
      115
    ],
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
    "desc": "Three pulls and it is over, if you were close enough to mean it. Shell by shell, and the fastest recovery on the board.",
    "clip": 6,
    "mags": 4,
    "reserve": 24,
    "reload_s": 0.4,
    "reload_ms": 400,
    "dmg": 35,
    "rpm": 11,
    "rng": 75,
    "dmg_per_hit": 40,
    "dual_emitter": true,
    "pool": 115,
    "verified": false,
    "tags": [
      "cqb"
    ],
    "role": "cqb",
    "htk": 3,
    "ttk_ms": 1400,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      20
    ],
    "ammo_total": 30,
    "bars": {
      "power": 73,
      "rof": 42,
      "ammo": 31,
      "ttk": 80
    }
  },
  {
    "weapon_id": "smg",
    "name": "SMG",
    "cls": "1",
    "weapon_class": "ballistic",
    "desc": "A close-combat hose. The barrel hits for 7 and the headset adds 2, so a target reached by both emitters takes 9; the magazine leaves faster than you meant it to.",
    "clip": 54,
    "mags": 4,
    "reserve": 216,
    "reload_s": 2.5,
    "reload_ms": 2500,
    "dmg": 8,
    "rpm": 75,
    "rng": 75,
    "dmg_per_hit": 9,
    "dual_emitter": true,
    "pool": 115,
    "verified": false,
    "tags": [
      "cqb"
    ],
    "role": "cqb",
    "htk": 13,
    "ttk_ms": 1200,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 60,
      "per_shot": 15,
      "recover_ms": 150
    },
    "hir": [
      2,
      7
    ],
    "ammo_total": 270,
    "bars": {
      "power": 38,
      "rof": 93,
      "ammo": 89,
      "ttk": 93
    }
  },
  {
    "weapon_id": "smoke_gun",
    "name": "Haze",
    "cls": "7",
    "weapon_class": "ballistic",
    "desc": "It cannot kill either. What it takes is a player's aim, for a few seconds, which is often worse.",
    "clip": 8,
    "mags": 3,
    "reserve": 24,
    "reload_s": 2.4,
    "reload_ms": 2400,
    "dmg": 0,
    "rpm": 60,
    "rng": 75,
    "dmg_per_hit": 6,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 20,
    "ttk_ms": 13300,
    "rounds_per_charge": 1,
    "caution": "The Haze needs the HUD that tells a flashed player why nothing is landing (S53) before players meet it.",
    "lethal": false,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      6
    ],
    "ammo_total": 32,
    "bars": {
      "power": 20,
      "rof": 78,
      "ammo": 37,
      "ttk": 20
    }
  },
  {
    "weapon_id": "sniper_rifle",
    "name": "Sniper Rifle",
    "cls": "2",
    "weapon_class": "ballistic",
    "desc": "Two hits from anywhere on the field, with a long moment in between to think about the first one.",
    "clip": 4,
    "mags": 6,
    "reserve": 24,
    "reload_s": 1.7,
    "reload_ms": 1700,
    "dmg": 52,
    "rpm": 5,
    "rng": 75,
    "dmg_per_hit": 60,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "marksman",
      "sniper"
    ],
    "role": "marksman",
    "htk": 2,
    "ttk_ms": 1500,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      60
    ],
    "ammo_total": 28,
    "bars": {
      "power": 82,
      "rof": 20,
      "ammo": 26,
      "ttk": 73
    }
  },
  {
    "weapon_id": "stripper",
    "name": "Breacher",
    "cls": "5",
    "weapon_class": "ballistic",
    "desc": "It cannot kill. It takes every layer of armour and shield off whoever you hit, and leaves the finishing to someone else.",
    "clip": 40,
    "mags": 3,
    "reserve": 120,
    "reload_s": 2.0,
    "reload_ms": 2000,
    "dmg": 0,
    "rpm": 60,
    "rng": 75,
    "dmg_per_hit": 9,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 13,
    "ttk_ms": 1320,
    "rounds_per_charge": 1,
    "lethal": false,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      9
    ],
    "ammo_total": 160,
    "bars": {
      "power": 20,
      "rof": 78,
      "ammo": 66,
      "ttk": 87
    }
  },
  {
    "weapon_id": "suppressor",
    "name": "Suppressor",
    "cls": "1",
    "weapon_class": "ballistic",
    "desc": "Its own fire sound, and the slowest kill in the game. It is the quiet option for a player who would rather not announce the fight.",
    "clip": 75,
    "mags": 5,
    "reserve": 384,
    "reload_s": 2.0,
    "reload_ms": 2000,
    "dmg": 7,
    "rpm": 54,
    "rng": 75,
    "dmg_per_hit": 8,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 15,
    "ttk_ms": 1960,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 60,
      "heavy": 70,
      "per_shot": 15,
      "recover_ms": 150
    },
    "hir": [
      8
    ],
    "ammo_total": 459,
    "bars": {
      "power": 29,
      "rof": 71,
      "ammo": 94,
      "ttk": 47
    }
  },
  {
    "weapon_id": "toxin_rifle",
    "name": "Toxin Rifle",
    "cls": "11",
    "weapon_class": "ballistic",
    "desc": "Hits lightly and keeps hitting. The damage arrives after you have stopped shooting, which is the whole point.",
    "clip": 30,
    "mags": 6,
    "reserve": 180,
    "reload_s": 1.6,
    "reload_ms": 1600,
    "dmg": 7,
    "rpm": 68,
    "rng": 75,
    "dmg_per_hit": 8,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 15,
    "ttk_ms": 1540,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 65,
      "per_shot": 10,
      "recover_ms": 150
    },
    "hir": [
      8
    ],
    "ammo_total": 210,
    "bars": {
      "power": 29,
      "rof": 85,
      "ammo": 71,
      "ttk": 67
    }
  },
  {
    "weapon_id": "usp",
    "name": "USP-S",
    "cls": "10",
    "weapon_class": "ballistic",
    "desc": "A steady sidearm. It will not win a fight you started badly, but it will finish one you nearly had.",
    "clip": 12,
    "mags": 10,
    "reserve": 120,
    "reload_s": 2.2,
    "reload_ms": 2200,
    "dmg": 8,
    "rpm": 47,
    "rng": 75,
    "dmg_per_hit": 9,
    "dual_emitter": false,
    "pool": 115,
    "verified": false,
    "tags": [
      "sidearm",
      "pistol"
    ],
    "role": "sidearm",
    "htk": 13,
    "ttk_ms": 1920,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      9
    ],
    "ammo_total": 132,
    "bars": {
      "power": 38,
      "rof": 56,
      "ammo": 60,
      "ttk": 53
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
    "desc": "Start every life with 25 extra armor, about a fifth more health pool. Armor soaks hits before your health does. The rig is heavier though: your reload takes a quarter longer.",
    "tags": [
      "passive",
      "defense"
    ],
    "mechanism": "passive",
    "effects": {
      "max_armor_add": 25,
      "reload_mult": 1.25
    },
    "gain": [
      "+25 ARMOR"
    ],
    "cost": [
      "RELOADS 1.2× SLOWER"
    ],
    "verified": true,
    "hidden": false
  },
  {
    "perk_id": "extended_mags",
    "name": "Extended Mags",
    "desc": "Double the magazine and double the reserve on your primary. Fewer reloads, longer fights, more rounds to burn -- but the bulkier magazine slows your draw: switching to your other weapon takes 30% longer.",
    "tags": [
      "passive",
      "ammo"
    ],
    "mechanism": "passive",
    "effects": {
      "ammo_mult": 2,
      "switch_mult": 1.3
    },
    "gain": [
      "×2 AMMO"
    ],
    "cost": [
      "SWAPS 1.3× SLOWER"
    ],
    "verified": true,
    "hidden": false
  },
  {
    "perk_id": "quick_hands",
    "name": "Quick Hands",
    "desc": "Reload in half the time. Your primary is back in the fight before theirs is -- the trade is a lighter magazine, 20% fewer rounds carried.",
    "tags": [
      "passive",
      "handling"
    ],
    "mechanism": "passive",
    "effects": {
      "ammo_mult": 0.8,
      "reload_mult": 0.5
    },
    "gain": [
      "RELOADS 2× FASTER"
    ],
    "cost": [
      "×0.8 AMMO"
    ],
    "verified": false,
    "hidden": false
  },
  {
    "perk_id": "quick_switch",
    "name": "Quick Switch",
    "desc": "Draw your second weapon in half the time: the gun's swap delay drops from 0.85 s to 0.43 s. A lighter rig means less padding though -- 20 less armor.",
    "tags": [
      "passive",
      "handling"
    ],
    "mechanism": "passive",
    "effects": {
      "max_armor_add": -20,
      "switch_mult": 0.5
    },
    "gain": [
      "SWAPS 2× FASTER"
    ],
    "cost": [
      "-20 ARMOR"
    ],
    "verified": true,
    "hidden": false
  },
  {
    "perk_id": "armor_piercing",
    "name": "Armor Piercing",
    "desc": "Your primary ignores armor and shields and goes straight to health. The rounds are heavier: fewer of them, and the gun cycles slower. Against a bare target a normal weapon still kills faster, and against an armored or shielded one this wins. It fits any plain-damage primary; the host is told if the chosen weapon cannot carry it.",
    "tags": [
      "passive",
      "offense"
    ],
    "mechanism": "passive",
    "effects": {
      "armor_piercing": true
    },
    "gain": [
      "IGNORES ARMOR & SHIELDS"
    ],
    "cost": [
      "FIXED DAMAGE, SLOWER CYCLE"
    ],
    "verified": false,
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
  scoring: { frag_limit: null, win_by: 'kills' },
  health: { max_hp: 45, max_armor: 70, max_shield: 0, preset: 'standard' },   // S45: the Standard preset
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
    "brief": "Squads score a point per elimination. Downed players respawn after the delay and rejoin. The highest score at the time limit takes the match; the operator can also set an optional score cap.",
    "teams_text": "2–4 TEAMS",
    "win_text": "TIME · OPTIONAL SCORE CAP",
    "respawn_text": "ON · TIMED"
  },
  "ffa": {
    "mode": "ffa",
    "name": "FREE-FOR-ALL",
    "abbr": "FFA",
    "desc": "Every operator for themselves",
    "brief": "No teams — everyone is a target. Each elimination scores a point. The top score when time expires wins; the operator can also set an optional frag limit.",
    "teams_text": "NONE · ALL VS ALL",
    "win_text": "TIME · OPTIONAL FRAG LIMIT",
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
    defaults: base('ffa', { teams: [{ team_id: 'ffa', name: 'FFA', color: 'ffa', tid: 1 }] }) },
  { ...MODE_TEXT.infection, params: [],
    defaults: base('infection', { respawn: { type: 'auto', delay_s: 10 }, scoring: { frag_limit: null, win_by: 'survival' } }) },
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
