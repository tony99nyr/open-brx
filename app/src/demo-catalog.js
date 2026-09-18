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
    "pool": 115,
    "verified": false,
    "tags": [
      "marksman",
      "sniper"
    ],
    "role": "marksman",
    "htk": 6,
    "ttk_ms": 2000,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "crit_pct": 30,
    "ammo_total": 70,
    "bars": {
      "power": 56,
      "rof": 53,
      "ammo": 51,
      "ttk": 27
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
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "htk": 12,
    "ttk_ms": 1558,
    "recoil": {
      "ceiling": 100,
      "floor": 85,
      "per_shot": 5,
      "recover_ms": 150
    },
    "crit_pct": 40,
    "ammo_total": 252,
    "bars": {
      "power": 47,
      "rof": 100,
      "ammo": 82,
      "ttk": 64
    }
  },
  {
    "weapon_id": "charge_rifle",
    "name": "Charge Rifle",
    "cls": "5",
    "weapon_class": "energy",
    "desc": "Hold it, and it holds. A full charge and two taps ends anyone, which is why it belongs to whoever saw the other person first.",
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
      "marksman",
      "sniper"
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
    "desc": "Rounds that hit like a rifle, and not many of them. Miss twice and you are reloading in front of someone.",
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
      "ttk": 42
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
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
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
      "ttk": 49
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
    "desc": "Three pulls and it is over, if you were close enough to mean it. Shell by shell, and the fastest recovery on the board.",
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
      "ttk": 56
    }
  },
  {
    "weapon_id": "smg",
    "name": "SMG",
    "cls": "1",
    "weapon_class": "ballistic",
    "desc": "A hose. The magazine leaves faster than you meant it to, and getting it back means standing still for a long time.",
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
      "ttk": 78
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
      "ttk": 71
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
      "ttk": 85
    }
  },
  {
    "weapon_id": "suppressor",
    "name": "Suppressor",
    "cls": "1",
    "weapon_class": "ballistic",
    "desc": "Quiet, and no muzzle flash. The only weapon that does not tell the field where you are, bought with the slowest kill in the game.",
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
      "assault"
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
      "ttk": 35
    }
  },
  {
    "weapon_id": "usp",
    "name": "USP-S",
    "cls": "10",
    "weapon_class": "ballistic",
    "desc": "A steady sidearm. It will not win a fight you started badly, but it will finish one you nearly had.",
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
      "ttk": 42
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
