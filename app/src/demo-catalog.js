// GENERATED for ?demo from mcp/brx_mcp/mc/weapons.json (shape = WeaponView / PerkView, docs/spec/loadout.md §1).
// A copy, not an import: the phone bundle must not depend on the server tree. Regenerate: see app/src/demo.js header.
export const DEMO_WEAPONS = [
 {
  "weapon_id": "assault_rifle",
  "name": "Assault Rifle",
  "desc": "The anchor \u2014 its frame is the one every other weapon is measured against. 13 hits at 190ms with 32 up and 384 in reserve: 32 kills without resupply, the deepest pool in the arsenal, and the slowest kill in it.",
  "cls": "0",
  "role": "assault",
  "tags": [
   "assault"
  ],
  "clip": 32,
  "reserve": 384,
  "reload_s": 1.4,
  "dmg": 8,
  "rpm": 39,
  "rng": 75,
  "htk": 13,
  "verified": false
 },
 {
  "weapon_id": "burst_rifle",
  "name": "Burst Rifle",
  "desc": "A real three-round burst \u2014 one pull, three rounds, and the gun enforces the gap. 13 hits from a 36-round mag with 216 behind it; the most total ammo of the burst pair, and the tighter of the two.",
  "cls": "0",
  "role": "assault",
  "tags": [
   "assault"
  ],
  "clip": 36,
  "reserve": 216,
  "reload_s": 1.7,
  "dmg": 8,
  "rpm": 100,
  "rng": 75,
  "htk": 13,
  "verified": true
 },
 {
  "weapon_id": "force_rifle",
  "name": "Force Rifle",
  "desc": "The burst rifle's heavier twin: same three-round pull, more per round. 12 hits instead of 13 and a faster kill, paid for with two-thirds the reserve and a slower five-part reload.",
  "cls": "0",
  "role": "assault",
  "tags": [
   "assault"
  ],
  "clip": 36,
  "reserve": 144,
  "reload_s": 1.7,
  "dmg": 9,
  "rpm": 75,
  "rng": 75,
  "htk": 12,
  "verified": false
 },
 {
  "weapon_id": "bolt_rifle",
  "name": "Bolt Rifle",
  "desc": "Single shot, deliberate cadence. 13 a hit every 225ms with 18 up and 180 back \u2014 22 kills from a full kit for operators who would rather aim than hold.",
  "cls": "0",
  "role": "assault",
  "tags": [
   "assault"
  ],
  "clip": 18,
  "reserve": 180,
  "reload_s": 2.0,
  "dmg": 11,
  "rpm": 33,
  "rng": 75,
  "htk": 9,
  "verified": true
 },
 {
  "weapon_id": "smg",
  "name": "SMG",
  "desc": "A hose that runs hot. 8 a hit every 140ms from a 72-round mag \u2014 four kills before you reload, 24 across the kit, and an overheat budget that punishes holding the trigger down forever.",
  "cls": "1",
  "role": "cqb",
  "tags": [
   "cqb"
  ],
  "clip": 72,
  "reserve": 288,
  "reload_s": 2.5,
  "dmg": 7,
  "rpm": 54,
  "rng": 75,
  "htk": 15,
  "verified": false
 },
 {
  "weapon_id": "shotgun",
  "name": "Shotgun",
  "desc": "Shell by shell, and the fastest recovery on the board. 45 a hit at 800ms, three hits to drop, six in the tube and a 400ms shell reload \u2014 sustained pressure from the shallowest ammo pool outside the power tier.",
  "cls": "3",
  "role": "cqb",
  "tags": [
   "cqb"
  ],
  "clip": 6,
  "reserve": 24,
  "reload_s": 0.4,
  "dmg": 39,
  "rpm": 9,
  "rng": 75,
  "htk": 3,
  "verified": false
 },
 {
  "weapon_id": "stinger",
  "name": "Stinger",
  "desc": "Fast, light, relentless. 15 a hit every 250ms with 18 up and 144 in reserve \u2014 eight hits to drop, twenty kills to spend, and nothing held back for range.",
  "cls": "6",
  "role": "cqb",
  "tags": [
   "cqb"
  ],
  "clip": 18,
  "reserve": 144,
  "reload_s": 1.7,
  "dmg": 13,
  "rpm": 30,
  "rng": 75,
  "htk": 8,
  "verified": false
 },
 {
  "weapon_id": "sniper_rifle",
  "name": "Sniper Rifle",
  "desc": "Two hits, one lane, a bolt between them. 60 a hit on a 1.5s cycle with four in the mag and 24 behind it \u2014 the fewest hits to a kill outside the power tier, and no margin for a miss.",
  "cls": "2",
  "role": "marksman",
  "tags": [
   "marksman",
   "sniper"
  ],
  "clip": 4,
  "reserve": 24,
  "reload_s": 1.7,
  "dmg": 52,
  "rpm": 5,
  "rng": 75,
  "htk": 2,
  "verified": false
 },
 {
  "weapon_id": "plasma_sniper",
  "name": "Plasma Sniper",
  "desc": "A marksman rifle that fires like a carbine and pays for it in heat. 25 a hit every 400ms, five to drop, ten up and 80 back \u2014 lean on it and it overheats.",
  "cls": "2",
  "role": "marksman",
  "tags": [
   "marksman",
   "sniper"
  ],
  "clip": 10,
  "reserve": 80,
  "reload_s": 2.0,
  "dmg": 22,
  "rpm": 19,
  "rng": 75,
  "htk": 5,
  "verified": false
 },
 {
  "weapon_id": "amr",
  "name": "AMR",
  "desc": "Anti-materiel weight at a rifle's cadence. 24 a hit every 400ms, five hits to a kill, 14 up and only 56 behind \u2014 the hardest-hitting automatic and the shallowest.",
  "cls": "4",
  "role": "support",
  "tags": [
   "support",
   "sniper"
  ],
  "clip": 14,
  "reserve": 56,
  "reload_s": 1.4,
  "dmg": 21,
  "rpm": 19,
  "rng": 75,
  "htk": 5,
  "verified": false
 },
 {
  "weapon_id": "suppressor",
  "name": "Suppressor",
  "desc": "Quiet, not silent, and no muzzle flash \u2014 the only weapon here that hides where you are. 8 a hit every 160ms with 384 in reserve: 28 kills, the deepest sustained pool, the slowest kill.",
  "cls": "1",
  "role": "support",
  "tags": [
   "support"
  ],
  "clip": 48,
  "reserve": 384,
  "reload_s": 2.0,
  "dmg": 7,
  "rpm": 47,
  "rng": 75,
  "htk": 15,
  "verified": false
 },
 {
  "weapon_id": "energy_rifle",
  "name": "Energy Rifle",
  "desc": "A 300-cell battery that barely stops. 9 a hit every 200ms, 23 kills on one magazine and 69 across the kit \u2014 the largest ammo pool in the game, on the smallest per-hit number.",
  "cls": "5",
  "role": "support",
  "tags": [
   "support"
  ],
  "clip": 300,
  "reserve": 600,
  "reload_s": 2.4,
  "dmg": 8,
  "rpm": 38,
  "rng": 75,
  "htk": 13,
  "verified": false
 },
 {
  "weapon_id": "charge_rifle",
  "name": "Charge Rifle",
  "desc": "Hold, release, hit hard. A 1.25s charge into 100 damage \u2014 two hits to a kill and a heat budget that ends the party if you rush it; twelve up, twelve back.",
  "cls": "5",
  "role": "support",
  "tags": [
   "support"
  ],
  "clip": 12,
  "reserve": 12,
  "reload_s": 2.5,
  "dmg": 87,
  "rpm": 6,
  "rng": 75,
  "htk": 2,
  "verified": false
 },
 {
  "weapon_id": "rocket_launcher",
  "name": "Rocket Launcher",
  "desc": "Point, pull, erase. 115 a hit \u2014 a full-health operator in one \u2014 on the fastest power-tier cycle, with the slowest reload behind it. Four rounds, four kills, no second chances.",
  "cls": "9",
  "role": "power",
  "tags": [
   "power",
   "heavy"
  ],
  "clip": 2,
  "reserve": 2,
  "reload_s": 2.6,
  "dmg": 100,
  "rpm": 8,
  "rng": 75,
  "htk": 1,
  "verified": false
 },
 {
  "weapon_id": "rail_gun",
  "name": "Rail Gun",
  "desc": "Charges and fires itself. A 1.2s wind-up that goes whether you are ready or not, 115 on impact, four rounds total \u2014 everyone within earshot hears the spool.",
  "cls": "7",
  "role": "power",
  "tags": [
   "power",
   "heavy"
  ],
  "clip": 2,
  "reserve": 2,
  "reload_s": 2.4,
  "dmg": 100,
  "rpm": 6,
  "rng": 75,
  "htk": 1,
  "verified": false
 },
 {
  "weapon_id": "laser_cannon",
  "name": "Laser Cannon",
  "desc": "Must be held to charge; a tap fires nothing at all. 1.5s of commitment for a guaranteed kill, and the fastest reload in the power tier for the trouble.",
  "cls": "4",
  "role": "power",
  "tags": [
   "power",
   "heavy"
  ],
  "clip": 2,
  "reserve": 2,
  "reload_s": 1.6,
  "dmg": 100,
  "rpm": 5,
  "rng": 75,
  "htk": 1,
  "verified": false
 },
 {
  "weapon_id": "energy_launcher",
  "name": "Energy Launcher",
  "desc": "No charge, no tell, no warning. 115 a hit with the fastest reload on the board and the slowest cycle in its tier \u2014 four kills, spent quietly.",
  "cls": "9",
  "role": "power",
  "tags": [
   "power",
   "heavy"
  ],
  "clip": 2,
  "reserve": 2,
  "reload_s": 1.4,
  "dmg": 100,
  "rpm": 5,
  "rng": 75,
  "htk": 1,
  "verified": false,
  "caution": "Known issue: deals no damage in our shipped config (weapon-design.md) \u2014 avoid until fixed"
 },
 {
  "weapon_id": "ion_sniper",
  "name": "Ion Sniper",
  "desc": "A one-shot kill in a rifle's body. 115 a hit on a 1.4s cycle with two up and two back \u2014 the power tier's only weapon that looks and sounds like a marksman rifle.",
  "cls": "2",
  "role": "power",
  "tags": [
   "power",
   "heavy",
   "sniper"
  ],
  "clip": 2,
  "reserve": 2,
  "reload_s": 2.0,
  "dmg": 100,
  "rpm": 5,
  "rng": 75,
  "htk": 1,
  "verified": false
 }
];
export const DEMO_PERKS = [
 {
  "perk_id": "body_armor",
  "name": "Body Armor",
  "desc": "Plate up. You start every life with +50 armor over the game default \u2014 more hits before your health takes a scratch.",
  "tags": [
   "passive"
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
  "desc": "Double-capacity magazines and twice the reserve for your primary. Reload half as often.",
  "tags": [
   "passive"
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
  "desc": "Your primary reloads in half the time.",
  "tags": [
   "passive"
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
  "desc": "The orange side button reloads \u2014 no need to work the pull-back lever.",
  "tags": [
   "passive"
  ],
  "mechanism": "passive",
  "effects": {
   "alt_reload": true
  },
  "verified": true,
  "hidden": false
 }
];
