# Adding an Open BRX perk

A perk is the third slot of a player's kit, beside the two weapons ([`spec/loadout.md`](spec/loadout.md) §1.2).
A row in `perks.json` is only the first step. A perk is supported when the compiler writes its effect into the
right frames, both UIs describe its gain and its cost from the same source, and the effect is proven on a gun.
The sibling how-tos are [`adding-weapons.md`](adding-weapons.md) and [`adding-modes.md`](adding-modes.md).

## 1. Start from the design of record

[`perk-design.md`](perk-design.md) is the design of record. It says what a perk has to be here (§1), lists the
core set (§2) and the next wave (§3), and keeps every other idea with the reason it waits (§4 and the appendix).
Put the new perk there first, with its gain, its cost, and the lever it pulls. §1 has five rules. Two of them
decide most designs: the effect must survive a Mission Control blackout, and every perk pays for itself.

Then decide where the effect lives:

- **Compile time.** A head-frame change the compiler already knows how to write: `$PSET` armour or shield,
  `$AMMO` and the `$WEAP` ammo and reload tokens, the `$WEAP` swap delay (token 15), or a `$SIR` key swap.
- **Node-local.** The phone's own logic against its own gun, with `effects: {}` in the row. Motion Tracker and
  Second Wind are designed this way and stay hidden until the phone implements them.
- **Slot frame** (`mechanism: "slot_frame"`). A `$WEAP` whose effect lives in every victim's `$SIR` table.
  These rows stay hidden until the emit side is benched.

## 2. Add the catalogue row

The catalogue is `mcp/brx_mcp/mc/perks.json`. Each row carries:

| Field | What it does |
|---|---|
| `perk_id`, `name` | The stable id and the display name. |
| `desc` | The player-facing sentence. Say the gain and the cost plainly. |
| `tags` | Free labels, such as `passive` and `defense`. |
| `mechanism` | `passive` or `slot_frame`. |
| `effects` | The knobs the compiler acts on, and nothing else. |
| `verified` | True only when the effect is proven on hardware. |
| `hidden` | True keeps the row out of `GET /api/perks`, the pickers and the generated catalogues. |

Every key in `effects` must be in `EFFECT_KEYS` in `mcp/brx_mcp/mc/perks.py`. `PerkCatalog` refuses a row with
an unknown key when it loads, so a typo is an error, not a silent no-op. The keys today are `max_armor_add`,
`ammo_mult`, `ammo_mult_pistol`, `reload_mult`, `alt_reload`, `switch_mult`, `armor_piercing` and
`crit_pct_add`.

## 3. A new effect key

If no existing key fits, add one in all of these places:

1. `EFFECT_KEYS` in `perks.py`.
2. `PerkEffects` in `mcp/brx_mcp/mc/types.py`, then run `python3 mcp/tools/gen_contract.py` to regenerate the
   console and phone contracts.
3. `gain_cost_lines()` in `perks.py`. Both UIs render the gain and cost lines it returns and derive nothing
   themselves. Read the sign as well as the key: a `reload_mult` of 1.25 is a cost.
4. The compiler (next section).

## 4. The compiler

`Compiler.perk_effects()` in `mcp/brx_mcp/mc/compile.py` reads a player's perk from the catalogue.
`perk_effects_resolved()` turns it into the resolved numbers, and the compiled bundle carries them as
`perk_effects`, so the frame and the report the phone and the console show can never disagree. The existing
levers:

- `max_armor_add` is a flat grant or cost. The arithmetic reads `_MAX_ARMOR_ADD`, a table keyed by `perk_id`,
  not the JSON value. Add the new perk to that table, and keep the two numbers equal. `armed_armor()`,
  `armed_shield()` and `armed_pool()` apply it; in a game with no base armour the grant goes to the shield.
- `ammo_mult`, `ammo_mult_pistol` and `reload_mult` act on the primary through `WeaponCatalog._ammo()` and
  `WeaponCatalog._mods()`.
- `switch_mult` scales the swap delay in `WeaponCatalog.swap_ms()`.
- `armor_piercing` swaps the primary's key to the armour-piercing cell (`_AP_CELL`, function `_AP_FN`), and the
  damage is the weapon's own `ap_dmg` in `weapons.json`, not a multiplier. `assert_armor_piercing_armed()`
  refuses a head whose `$SIR` table lacks the row.
- `crit_pct_add` is refused on a weapon with a headset damage word (`_refuse_if_crit_perk_ineligible()`).

A new lever needs its own guard for every combination that would arm a silent, broken perk.

## 5. The loadout rules

The perk slot has its own rule in the loadout policy (`mc/policy.py`): `off`, `fixed` or the player's choice
from an allowed list. `loadout_pool()` in `state.py` builds the list the phone offers, and `game_brief()` writes
the perk line of the phone's BRIEFING screen. A visible row joins the pool on its own. Check that no policy
preset offers a perk its game cannot compile. Easy Reload is not a perk: it is a per-player accessibility
override (`loadout.overrides.easy_reload`), and it never competes with the perk slot.

## 6. The phone and the console

The phone and the console read the catalogue from the server during a real session. Two copies exist for the
demos, and both are generated:

- `app/src/demo-catalog.js` (`DEMO_PERKS`), which the phone's demo, stage and screen-truth suite read;
- `webapp/mc/src/mock/data.ts` (`PERKS`), which the console's `?mock` mode reads.

Run `python3 mcp/tools/gen_ui_catalog.py` after any change to `perks.json`. Only the text between the marker
comments changes. A phone screen guard reads `demo-catalog.js`, not `perks.json`, so a stale file tests the old
perk.

Each UI draws the perk's icon by hand. Add a glyph to `PERK_GLYPH` in `app/src/hud/shared.js` and a case to
`PerkGlyph` in `webapp/mc/src/screens/Kit.tsx`. Each falls back to a generic icon. A node-local effect goes in
`app/src/engine.js`, which finds the row with `perkRow()`. If a perk needs new phone behaviour, an older APK must
not start a game with it: follow the `min_app` pattern in [`adding-weapons.md`](adding-weapons.md) §3.

## 7. Prove it

Write the failing test first. At minimum, cover:

- the slot, the pool and the brief (`mcp/tests/test_mc_perk_slot.py`), including
  `test_every_effect_key_is_handled_by_gain_cost_lines` for a new key;
- the pool arithmetic for an armour or shield lever (`test_armed_pool_formula.py`);
- the compiled frames: the `$PSET` pools, the `$WEAP` tokens, the `$AMMO` counts and any `$SIR` row, on the
  primary and on the secondary;
- the generated files (`test_ui_catalog_generated.py`, and `test_contract_generated.py` if `types.py` changed);
- a node-local effect in the phone suites, and in the stage, because the stage must predict `engine.js`.

Run the focused suites while you iterate, then `pnpm run test:all`. If a UI changed, also run
`pnpm run test:all -- --ui`.

## 8. Field proof and docs

On a real gun, arm a game with the perk and read the pools, the magazine and the swap time back from the gun.
Set `verified: true` only after that. Record the result in `docs/experiment-log/`, update `perk-design.md` and
`spec/loadout.md` §1.2, and promote any new protocol fact into `protocol/` or `docs/manual/`.

## Dogfood: Body Armor

Body Armor is catalogue id `body_armor`. Its row carries `max_armor_add: 25` and `reload_mult: 1.25`: 25
more armour (about a fifth more pool), and reloads a quarter slower as the cost. `_MAX_ARMOR_ADD` holds the same 25, and
`armed_armor()` adds it to `$PSET` armour, or to the shield in a game with no base armour. `gain_cost_lines()`
prints the armour as the gain and the slower reload as the cost, and both UIs render those two lines. Each UI
has its own `body_armor` glyph.
