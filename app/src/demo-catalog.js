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
    "mags": 8,
    "reserve": 112,
    "reload_s": 1.4,
    "reload_ms": 1400,
    "dmg": 23,
    "rpm": 17,
    "rng": 75,
    "dmg_per_hit": 26,
    "dual_emitter": false,
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "marksman",
      "sniper"
    ],
    "role": "marksman",
    "types": [
      "long"
    ],
    "htk": 5,
    "ttk_ms": 1972,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "crit_pct": 30,
    "hir": [
      26
    ],
    "cells": [
      {
        "proto": 0,
        "subtype": 3,
        "mag": 26
      }
    ],
    "ammo_total": 126,
    "bars": {
      "power": 60,
      "rof": 47,
      "ammo": 45,
      "ttk": 49
    }
  },
  {
    "weapon_id": "assault_rifle",
    "name": "Assault Rifle",
    "cls": "0",
    "weapon_class": "ballistic",
    "desc": "The one everything else is measured against. Nothing it does is remarkable, and there is no fight it cannot hold.",
    "clip": 32,
    "mags": 12,
    "reserve": 384,
    "reload_s": 1.4,
    "reload_ms": 1400,
    "dmg": 8,
    "rpm": 75,
    "rng": 75,
    "dmg_per_hit": 9,
    "dual_emitter": false,
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "types": [
      "rifle"
    ],
    "htk": 13,
    "ttk_ms": 1200,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 70,
      "per_shot": 10,
      "recover_ms": 150,
      "degraded": 70,
      "heavy": 45,
      "after_heavy": 7
    },
    "hir": [
      9
    ],
    "cells": [
      {
        "proto": 0,
        "subtype": 0,
        "mag": 9
      }
    ],
    "ammo_total": 416,
    "bars": {
      "power": 40,
      "rof": 93,
      "ammo": 75,
      "ttk": 85
    }
  },
  {
    "weapon_id": "burst_rifle",
    "name": "Burst Rifle",
    "cls": "0",
    "weapon_class": "ballistic",
    "desc": "Three rounds a pull, and the gun decides the gap rather than your finger. Slower to the kill than the rifle, and far harder to waste.",
    "clip": 36,
    "mags": 10,
    "reserve": 384,
    "reload_s": 1.7,
    "reload_ms": 1700,
    "dmg": 9,
    "rpm": 100,
    "rng": 75,
    "dmg_per_hit": 10,
    "dual_emitter": false,
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "types": [
      "rifle"
    ],
    "htk": 12,
    "ttk_ms": 2530,
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
    "cells": [
      {
        "proto": 0,
        "subtype": 3,
        "mag": 10
      }
    ],
    "ammo_total": 420,
    "bars": {
      "power": 50,
      "rof": 100,
      "ammo": 82,
      "ttk": 42
    }
  },
  {
    "weapon_id": "charge_rifle",
    "name": "Charge Rifle",
    "cls": "5",
    "weapon_class": "energy",
    "desc": "Hold it, and it holds. A full charge and three taps ends a standard player (more health takes five taps), which is why it belongs to whoever saw the other person first.",
    "clip": 40,
    "mags": 4,
    "reserve": 160,
    "reload_s": 2.5,
    "reload_ms": 2500,
    "dmg": 61,
    "rpm": 6,
    "rng": 75,
    "dmg_per_hit": 70,
    "dual_emitter": false,
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "marksman",
      "sniper"
    ],
    "role": "marksman",
    "types": [
      "rifle",
      "long"
    ],
    "htk": 4,
    "ttk_ms": 855,
    "rounds_per_charge": 10,
    "caution": "A full charge spends 10 rounds. With fewer than 10 left a charge fires nothing, and the reload may not take until your next life.",
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
    "cells": [
      {
        "proto": 8,
        "subtype": 0,
        "mag": 16
      },
      {
        "proto": 8,
        "subtype": 0,
        "mag": 70
      }
    ],
    "ammo_total": 200,
    "bars": {
      "power": 80,
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
    "desc": "Rounds heavy enough to end a fight your rifle already started, not many of them and slow between pulls. Miss twice and you are reloading in front of someone.",
    "clip": 7,
    "mags": 13,
    "reserve": 96,
    "reload_s": 2.2,
    "reload_ms": 2200,
    "dmg": 23,
    "rpm": 11,
    "rng": 75,
    "dmg_per_hit": 26,
    "dual_emitter": false,
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "sidearm",
      "pistol"
    ],
    "role": "sidearm",
    "types": [
      "sidearm",
      "close"
    ],
    "htk": 5,
    "ttk_ms": 2972,
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
    "cells": [
      {
        "proto": 0,
        "subtype": 3,
        "mag": 26
      }
    ],
    "ammo_total": 103,
    "bars": {
      "power": 60,
      "rof": 40,
      "ammo": 38,
      "ttk": 20
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
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "types": [
      "rifle"
    ],
    "htk": 13,
    "ttk_ms": 1800,
    "rounds_per_charge": 1,
    "caution": "Overheats after about 30 rounds of full auto, and it does not cool on its own: work the reload lever to vent the heat (about three pulls, or one held pull), then work the lever to recharge the cell.",
    "recoil": {
      "ceiling": 100,
      "floor": 70,
      "per_shot": 10,
      "recover_ms": 150
    },
    "hir": [
      9
    ],
    "cells": [
      {
        "proto": 0,
        "subtype": 0,
        "mag": 9
      }
    ],
    "ammo_total": 900,
    "bars": {
      "power": 40,
      "rof": 67,
      "ammo": 100,
      "ttk": 64
    }
  },
  {
    "weapon_id": "rail_gun",
    "name": "Rail Gun",
    "cls": "7",
    "weapon_class": "energy",
    "desc": "A single charged slug that ends almost anyone it finds; a full Shields player is left on 1 HP. Two shots, and then it is scrap.",
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
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "power",
      "heavy"
    ],
    "role": "power",
    "types": [],
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
    "cells": [
      {
        "proto": 6,
        "subtype": 0,
        "mag": 149
      }
    ],
    "ammo_total": 4,
    "bars": {
      "power": 100,
      "rof": 27,
      "ammo": 20,
      "ttk": 85
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
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "power",
      "heavy"
    ],
    "role": "power",
    "types": [],
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
    "cells": [
      {
        "proto": 10,
        "subtype": 0,
        "mag": 35
      },
      {
        "proto": 10,
        "subtype": 0,
        "mag": 115
      }
    ],
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
    "mags": 8,
    "reserve": 48,
    "reload_s": 0.4,
    "reload_ms": 400,
    "dmg": 34,
    "rpm": 19,
    "rng": 75,
    "dmg_per_hit": 39,
    "dual_emitter": true,
    "reload_type": "chain",
    "pool": 115,
    "verified": false,
    "tags": [
      "cqb"
    ],
    "role": "cqb",
    "types": [
      "close"
    ],
    "htk": 3,
    "ttk_ms": 886,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      19,
      20
    ],
    "cells": [
      {
        "proto": 0,
        "subtype": 0,
        "mag": 19
      },
      {
        "proto": 0,
        "subtype": 0,
        "mag": 20
      }
    ],
    "ammo_total": 54,
    "bars": {
      "power": 70,
      "rof": 53,
      "ammo": 32,
      "ttk": 93
    }
  },
  {
    "weapon_id": "smg",
    "name": "SMG",
    "cls": "1",
    "weapon_class": "ballistic",
    "desc": "A close-combat hose. The barrel hits for 7 and the headset adds 2, so a target reached by both emitters takes 9; the magazine leaves faster than you meant it to.",
    "clip": 54,
    "mags": 7,
    "reserve": 384,
    "reload_s": 2.5,
    "reload_ms": 2500,
    "dmg": 8,
    "rpm": 75,
    "rng": 75,
    "dmg_per_hit": 9,
    "dual_emitter": true,
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "cqb"
    ],
    "role": "cqb",
    "types": [
      "close"
    ],
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
    "cells": [
      {
        "proto": 0,
        "subtype": 0,
        "mag": 2
      },
      {
        "proto": 0,
        "subtype": 0,
        "mag": 7
      }
    ],
    "ammo_total": 438,
    "bars": {
      "power": 40,
      "rof": 93,
      "ammo": 88,
      "ttk": 85
    }
  },
  {
    "weapon_id": "sniper_rifle",
    "name": "Sniper Rifle",
    "cls": "2",
    "weapon_class": "ballistic",
    "desc": "One round, then the bolt. Two hits drop anyone from anywhere on the field, and you work the lever between them.",
    "clip": 1,
    "mags": 48,
    "reserve": 48,
    "reload_s": 2.2,
    "reload_ms": 2200,
    "dmg": 65,
    "rpm": 5,
    "rng": 75,
    "dmg_per_hit": 75,
    "dual_emitter": false,
    "reload_type": "bolt",
    "pool": 115,
    "verified": false,
    "tags": [
      "marksman",
      "sniper"
    ],
    "role": "marksman",
    "types": [
      "rifle",
      "long"
    ],
    "htk": 2,
    "ttk_ms": 2705,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      75
    ],
    "cells": [
      {
        "proto": 0,
        "subtype": 1,
        "mag": 75
      }
    ],
    "ammo_total": 49,
    "bars": {
      "power": 90,
      "rof": 20,
      "ammo": 26,
      "ttk": 27
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
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "support"
    ],
    "role": "support",
    "types": [
      "support",
      "close"
    ],
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
    "cells": [
      {
        "proto": 5,
        "subtype": 0,
        "mag": 9
      }
    ],
    "ammo_total": 160,
    "bars": {
      "power": 20,
      "rof": 80,
      "ammo": 51,
      "ttk": 78
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
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "types": [
      "rifle"
    ],
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
    "cells": [
      {
        "proto": 0,
        "subtype": 0,
        "mag": 8
      }
    ],
    "ammo_total": 459,
    "bars": {
      "power": 30,
      "rof": 73,
      "ammo": 94,
      "ttk": 56
    }
  },
  {
    "weapon_id": "toxin_rifle",
    "name": "Toxin Rifle",
    "cls": "11",
    "weapon_class": "ballistic",
    "desc": "Hits lightly and keeps hitting. The damage arrives after you have stopped shooting, which is the whole point.",
    "clip": 30,
    "mags": 12,
    "reserve": 360,
    "reload_s": 1.6,
    "reload_ms": 1600,
    "dmg": 7,
    "rpm": 68,
    "rng": 75,
    "dmg_per_hit": 8,
    "dual_emitter": false,
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "assault"
    ],
    "role": "assault",
    "types": [
      "rifle"
    ],
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
    "cells": [
      {
        "proto": 11,
        "subtype": 0,
        "mag": 8
      }
    ],
    "ammo_total": 390,
    "bars": {
      "power": 30,
      "rof": 87,
      "ammo": 69,
      "ttk": 71
    }
  },
  {
    "weapon_id": "usp",
    "name": "USP-S",
    "cls": "10",
    "weapon_class": "ballistic",
    "desc": "A steady sidearm. It will not win a fight you started badly, but it will finish one you nearly had.",
    "clip": 12,
    "mags": 20,
    "reserve": 240,
    "reload_s": 2.2,
    "reload_ms": 2200,
    "dmg": 9,
    "rpm": 39,
    "rng": 75,
    "dmg_per_hit": 10,
    "dual_emitter": false,
    "reload_type": "magazine",
    "pool": 115,
    "verified": false,
    "tags": [
      "sidearm",
      "pistol"
    ],
    "role": "sidearm",
    "types": [
      "sidearm",
      "close"
    ],
    "htk": 12,
    "ttk_ms": 2562,
    "rounds_per_charge": 1,
    "recoil": {
      "ceiling": 100,
      "floor": 100,
      "per_shot": 0,
      "recover_ms": 0
    },
    "hir": [
      10
    ],
    "cells": [
      {
        "proto": 0,
        "subtype": 3,
        "mag": 10
      }
    ],
    "ammo_total": 252,
    "bars": {
      "power": 50,
      "rof": 60,
      "ammo": 63,
      "ttk": 35
    }
  }
];
// GENERATED-END weapons
// GENERATED-START perks
export const DEMO_PERKS = [
  {
    "perk_id": "body_armor",
    "name": "Body Armor",
    "desc": "Start every life with 20 extra armour, about a sixth more total health in Standard. Armour soaks hits before your health does. The rig is heavier though: your reload takes a quarter longer (not the Sniper Rifle's bolt).",
    "tags": [
      "passive",
      "defense"
    ],
    "mechanism": "passive",
    "effects": {
      "max_armor_add": 20,
      "reload_mult": 1.25
    },
    "gain": [
      "+20 ARMOR"
    ],
    "cost": [
      "RELOADS 1.2× SLOWER"
    ],
    "verified": true,
    "hidden": false,
    "blocked_primary": [],
    "blocked_secondary": [],
    "blocked_presets": [
      "shields"
    ]
  },
  {
    "perk_id": "extended_mags",
    "name": "Extended Mags",
    "desc": "In Standard, double the magazine on your primary. In Shields, increase it by 50%. Your reserve grows up to 384 rounds; some rifles already reach that limit. A pistol primary gains 50%, rounded down. The Sniper Rifle is exempt: its bolt keeps one round. The larger magazine slows your weapon swap by 30%.",
    "tags": [
      "passive",
      "ammo"
    ],
    "mechanism": "passive",
    "effects": {
      "ammo_mult": 2,
      "ammo_mult_pistol": 1.5,
      "switch_mult": 1.3
    },
    "gain": [
      "×2 MAG"
    ],
    "cost": [
      "SWAPS 1.3× SLOWER"
    ],
    "verified": true,
    "hidden": false,
    "variants": {
      "shields": {
        "effects": {
          "ammo_mult": 1.5,
          "ammo_mult_pistol": 1.5,
          "switch_mult": 1.3
        },
        "gain": [
          "×1.5 MAG"
        ],
        "cost": [
          "SWAPS 1.3× SLOWER"
        ]
      }
    },
    "blocked_primary": [],
    "blocked_secondary": [],
    "blocked_presets": []
  },
  {
    "perk_id": "fast_hands",
    "name": "Fast Hands",
    "desc": "Reload and swap weapons in half the time. The Sniper Rifle's bolt keeps its normal speed.",
    "tags": [
      "passive",
      "handling"
    ],
    "mechanism": "passive",
    "effects": {
      "ammo_mult": 1.0,
      "reload_mult": 0.5,
      "switch_mult": 0.5
    },
    "gain": [
      "RELOADS 2× FASTER",
      "SWAPS 2× FASTER"
    ],
    "cost": [],
    "verified": false,
    "hidden": false,
    "blocked_primary": [],
    "blocked_secondary": [],
    "blocked_presets": []
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
    "hidden": false,
    "blocked_primary": [
      "burst_rifle",
      "sniper_rifle",
      "amr",
      "charge_rifle",
      "usp",
      "deagle",
      "rocket_launcher",
      "rail_gun",
      "stripper",
      "toxin_rifle"
    ],
    "blocked_secondary": [],
    "blocked_presets": [
      "shields"
    ]
  }
];
// GENERATED-END perks
