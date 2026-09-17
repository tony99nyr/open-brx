// GENERATED for ?demo from mcp/brx_mcp/mc/weapons.json + perks.json (shapes = WeaponView / PerkView,
// docs/spec/loadout.md §1). A copy, not an import: the phone bundle must not depend on the server tree.
// Regenerate: python3 mcp/tools/gen_ui_catalog.py - never hand-edit between the markers.
// GENERATED-START weapons
export const DEMO_WEAPONS = [
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
    "ammo_total": 70,
    "bars": {
      "power": 43,
      "rof": 64,
      "ammo": 56,
      "ttk": 82
    }
  },
  {
    "weapon_id": "assault_rifle",
    "name": "Assault Rifle",
    "cls": "0",
    "weapon_class": "ballistic",
    "desc": "The anchor, and the closest thing to the stock M4. 13 hits at 140ms with 32 up and 192 in reserve: 17 kills without resupply and a 1.68s kill. Battle Company cycles it at 100ms; at that speed with this magazine it out-classes ten other weapons outright, so it gives up some depth and a little rate to leave the rest of the arsenal a reason to exist.",
    "clip": 32,
    "mags": 6,
    "reserve": 192,
    "reload_s": 1.4,
    "reload_ms": 1400,
    "dmg": 8,
    "rpm": 54,
    "rng": 75,
    "dmg_per_hit": 9,
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 13,
    "ttk_ms": 1680,
    "ammo_total": 224,
    "bars": {
      "power": 31,
      "rof": 91,
      "ammo": 71,
      "ttk": 73
    }
  },
  {
    "weapon_id": "burst_rifle",
    "name": "Burst Rifle",
    "cls": "0",
    "weapon_class": "ballistic",
    "desc": "A real three-round burst: one pull, three rounds, and the gun enforces the gap. 13 hits from a 36-round mag with 216 behind it; the most total ammo of the burst pair, and the tighter of the two.",
    "clip": 36,
    "mags": 6,
    "reserve": 216,
    "reload_s": 1.7,
    "reload_ms": 1700,
    "dmg": 8,
    "rpm": 100,
    "rng": 75,
    "dmg_per_hit": 9,
    "pool": 115,
    "verified": true,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 13,
    "ttk_ms": 1700,
    "ammo_total": 252,
    "bars": {
      "power": 31,
      "rof": 100,
      "ammo": 78,
      "ttk": 64
    }
  },
  {
    "weapon_id": "charge_rifle",
    "name": "Charge Rifle",
    "cls": "5",
    "weapon_class": "energy",
    "desc": "Hold, release, hit hard. A 1.25s charge into 100 damage: two hits to a kill and a heat budget that ends the party if you rush it. Twelve up, twelve back.",
    "clip": 12,
    "mags": 1,
    "reserve": 12,
    "reload_s": 2.5,
    "reload_ms": 2500,
    "dmg": 87,
    "rpm": 6,
    "rng": 75,
    "dmg_per_hit": 100,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 2,
    "ttk_ms": 2500,
    "ammo_total": 24,
    "bars": {
      "power": 89,
      "rof": 29,
      "ammo": 27,
      "ttk": 20
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
    "ammo_total": 55,
    "bars": {
      "power": 54,
      "rof": 56,
      "ammo": 49,
      "ttk": 56
    }
  },
  {
    "weapon_id": "energy_rifle",
    "name": "Energy Rifle",
    "cls": "5",
    "weapon_class": "energy",
    "desc": "A 300-cell battery that barely stops. 9 a hit every 200ms, 23 kills on one magazine and 69 across the kit. The largest ammo pool in the game, on the smallest per-hit number.",
    "clip": 300,
    "mags": 2,
    "reserve": 600,
    "reload_s": 2.4,
    "reload_ms": 2400,
    "dmg": 8,
    "rpm": 38,
    "rng": 75,
    "dmg_per_hit": 9,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 13,
    "ttk_ms": 2400,
    "ammo_total": 900,
    "bars": {
      "power": 31,
      "rof": 73,
      "ammo": 100,
      "ttk": 29
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
    "ammo_total": 4,
    "bars": {
      "power": 100,
      "rof": 29,
      "ammo": 20,
      "ttk": 100
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
    "ammo_total": 4,
    "bars": {
      "power": 100,
      "rof": 38,
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
    "ammo_total": 30,
    "bars": {
      "power": 66,
      "rof": 47,
      "ammo": 42,
      "ttk": 82
    }
  },
  {
    "weapon_id": "smg",
    "name": "SMG",
    "cls": "1",
    "weapon_class": "ballistic",
    "desc": "A hose that runs hot. 8 a hit every 140ms from a 72-round mag: four kills before you reload, 24 across the kit, and an overheat budget that punishes holding the trigger down forever.",
    "clip": 72,
    "mags": 4,
    "reserve": 288,
    "reload_s": 2.5,
    "reload_ms": 2500,
    "dmg": 7,
    "rpm": 54,
    "rng": 75,
    "dmg_per_hit": 8,
    "pool": 115,
    "verified": false,
    "tags": [
      "cqb"
    ],
    "role": "cqb",
    "htk": 15,
    "ttk_ms": 1960,
    "ammo_total": 360,
    "bars": {
      "power": 20,
      "rof": 91,
      "ammo": 85,
      "ttk": 47
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
    "ammo_total": 28,
    "bars": {
      "power": 77,
      "rof": 20,
      "ammo": 35,
      "ttk": 91
    }
  },
  {
    "weapon_id": "suppressor",
    "name": "Suppressor",
    "cls": "1",
    "weapon_class": "ballistic",
    "desc": "Quiet, not silent, and no muzzle flash. It is the only weapon here that hides where you are. 8 a hit every 160ms with 384 in reserve: 28 kills, the deepest sustained pool, the slowest kill.",
    "clip": 48,
    "mags": 8,
    "reserve": 384,
    "reload_s": 2.0,
    "reload_ms": 2000,
    "dmg": 7,
    "rpm": 47,
    "rng": 75,
    "dmg_per_hit": 8,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 15,
    "ttk_ms": 2240,
    "ammo_total": 432,
    "bars": {
      "power": 20,
      "rof": 82,
      "ammo": 93,
      "ttk": 38
    }
  },
  {
    "weapon_id": "usp",
    "name": "USP-S",
    "cls": "10",
    "weapon_class": "ballistic",
    "desc": "The quiet one. Suppressed and flashless: 9 a hit, as fast as you can pull the trigger, 13 hits to drop, 20 in the mag with 120 behind it: 10 kills across the kit. Low damage, but nobody hears where it came from.",
    "clip": 20,
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
    "ammo_total": 140,
    "bars": {
      "power": 31,
      "rof": 82,
      "ammo": 64,
      "ttk": 56
    }
  }
];
// GENERATED-END weapons
// GENERATED-START perks
export const DEMO_PERKS = [
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
