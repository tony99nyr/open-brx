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
    "role": "marksman",
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
      "power": 56,
      "rof": 53,
      "ammo": 51,
      "ttk": 52
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
      "power": 38,
      "rof": 87,
      "ammo": 75,
      "ttk": 92
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
      "power": 47,
      "rof": 100,
      "ammo": 82,
      "ttk": 68
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
    "role": "marksman",
    "htk": 3,
    "ttk_ms": 570,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 120,
    "bars": {
      "power": 91,
      "rof": 27,
      "ammo": 57,
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
      "power": 64,
      "rof": 47,
      "ammo": 45,
      "ttk": 36
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
    "role": "assault",
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
      "power": 38,
      "rof": 67,
      "ammo": 100,
      "ttk": 44
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
      "ttk": 92
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
      "rof": 33,
      "ammo": 20,
      "ttk": null
    }
  },
  {
    "weapon_id": "shotgun",
    "name": "Shotgun",
    "cls": "3",
    "weapon_class": "ballistic",
    "desc": "Shell by shell, and the fastest recovery on the board. One pull sends two words: 20 from the gun and 20 from the shooter's own headset, both landing at any range this game is played at, 40 together. Three hits drop a target, six in the tube and a 400ms shell reload. Sustained pressure from the shallowest ammo pool outside the power tier.",
    "clip": 6,
    "mags": 4,
    "reserve": 24,
    "reload_s": 0.4,
    "reload_ms": 400,
    "dmg": 35,
    "rpm": 9,
    "rng": 75,
    "dmg_per_hit": 40,
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
      "power": 73,
      "rof": 40,
      "ammo": 32,
      "ttk": 52
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
      "power": 29,
      "rof": 93,
      "ammo": 88,
      "ttk": 76
    }
  },
  {
    "weapon_id": "smoke_gun",
    "name": "Haze",
    "cls": "7",
    "weapon_class": "ballistic",
    "desc": "A three-second blackout. The target keeps firing and keeps spending rounds, and every shot misses: their own gun goes quiet and the person they are aiming at hears the shots whizz past. It takes no health at all, and it wears off on its own. Use it to break a firing line, cross open ground, or take a point off someone who cannot afford three seconds. Bench 2026-09-18: live accuracy 100 to 0 in the same millisecond as the hit, recovering 0, 2, 4, 7, 12 over about three seconds, with nothing left behind.",
    "clip": 8,
    "mags": 3,
    "reserve": 24,
    "reload_s": 2.4,
    "reload_ms": 2400,
    "dmg": 0,
    "rpm": 60,
    "rng": 75,
    "dmg_per_hit": 6,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 20,
    "ttk_ms": 13300,
    "caution": "The Haze needs the HUD that tells a flashed player why nothing is landing (S53) before players meet it.",
    "lethal": false,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 32,
    "bars": {
      "power": 20,
      "rof": 80,
      "ammo": 38,
      "ttk": 20
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
      "power": 82,
      "rof": 20,
      "ammo": 26,
      "ttk": 60
    }
  },
  {
    "weapon_id": "stripper",
    "name": "Breacher",
    "cls": "5",
    "weapon_class": "ballistic",
    "desc": "Strips armour and shields and cannot take a single point of health. Nine a hit off whatever they are wearing, through every layer in order, and the overflow carries: a full shield and a full plate come off in one magazine. Point it at a teammate instead and it REPAIRS them, because the same function that strips an enemy grants armour to an ally. You give up your backup gun to carry it, and you need someone else to finish what you start. Bench 2026-09-18: shield 120 to 0 then armour 70 to 0, health fixed at 999 the whole way, and eleven further hits on a bare target moved nothing at all.",
    "clip": 40,
    "mags": 3,
    "reserve": 120,
    "reload_s": 2.0,
    "reload_ms": 2000,
    "dmg": 0,
    "rpm": 60,
    "rng": 75,
    "dmg_per_hit": 9,
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "htk": 13,
    "ttk_ms": 1320,
    "lethal": false,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "ammo_total": 160,
    "bars": {
      "power": 20,
      "rof": 80,
      "ammo": 69,
      "ttk": 84
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
    "role": "assault",
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
      "power": 29,
      "rof": 73,
      "ammo": 94,
      "ttk": 28
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
      "power": 38,
      "rof": 60,
      "ammo": 63,
      "ttk": 36
    }
  }
];
// GENERATED-END weapons
// GENERATED-START perks
export const DEMO_PERKS = [
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
    "verified": false,
    "hidden": false
  }
];
// GENERATED-END perks
