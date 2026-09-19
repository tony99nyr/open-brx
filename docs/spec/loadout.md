# M-LOADOUT — three slots (primary, secondary, perk), loadout policy, phone self-serve kitting

- **Status:** **A14 perk slot (2026-09-04): a perk is its OWN slot beside PRIMARY / SECONDARY** — server (`policy.py`,
  `tests/test_mc_perk_slot.py`), MC KIT/DESIGNER and the phone HUD built the same day; no backwards path (FOLLOWUPS S6). A12 sidearms (three pistols + `sidearm` slot kind) BUILT server-side 2026-09-04 (`weapons.json`, `policy.py`, `tests/test_mc_sidearms.py`; UI lanes in progress). §8 saved games server side BUILT 2026-08-27 (`presets.py`, `/api/presets*`, `Session.sanitize_config`). Server side BUILT 2026-08-27 (`policy.py`, `perks.py`/`perks.json`, `views.py`, state/compile/api/envelope; tests `tests/test_mc_loadout.py` + a real-stack e2e). UI lanes in progress. Amends `contracts.md` (**A10** — A9 was already `apply.preview`) — §2 `Loadout`, §3 `GameConfig`, §5 wire kinds.
  Binding for `mcp/brx_mcp/mc` (server), `webapp/mc` (MC UI) and `app/` (phone node). Field names are identical
  in Python TypedDicts, `API.md`, `types.ts` and the phone engine.
- **Owns:** the shape of a player's kit (primary + optional secondary + optional perk), the **loadout policy** a host
  sets per game (who may pick what, per slot), the **perk catalog**, and the phone's **self-serve pick / try** flow.
- **Decided with Tony 2026-08-27:** v1 perks are **passive** (compile from existing head-frame knobs); slot-frame
  perks (Med Kit heal-gun, Concussion/EMP) stay catalogued but `hidden` until the emit-side bench (their effect
  lives in the *victim's* `$SIR` table — game-wide, not per-player). Players may pick **both** slots from the phone
  when policy allows; a phone pick **auto-applies** (host may override / lock — `policy.choice` is the lock, one
  writer per slot). Rulesets are **orthogonal to mode** (presets). **Primary required; secondary optional** — an
  empty slot 1 is hardware-verified harmless (ALT falls back to reload, protocol §… `brx-protocol.md:48`).
  "Heavy" = `weapons.json role == "power"` (rocket, rail, laser cannon, energy launcher, ion sniper); AMR stays.

---

## 1. Catalog (server-owned static data)

### 1.1 Weapons — `mcp/brx_mcp/mc/weapons.json` gains `tags`
```jsonc
Weapon += { tags: string[] }      // "heavy" (role power), "sniper" (sniper_rifle, plasma_sniper, ion_sniper, amr), "cqb", "assault", "support",
                                  // "sidearm" + "pistol" (A12, 2026-09-04: glock / usp / deagle, role "sidearm", cls 10)
```
**Sidearms (A12, 2026-09-04).** Three Counter-Strike-style pistols — `glock` (Glock-18), `usp` (USP-S), `deagle`
(Desert Eagle) — are ordinary catalog weapons: `WeaponSel` on the wire, `kind:"weapon"` in a `loadout_request`,
try-out as any weapon. They have no capture of their own: a row with **`based_on: {weapon_id, why}`** copies that
weapon's `capture` block verbatim (`captured: false`) and moves only named `wire`/`overrides` tokens — the Bolt
Rifle frame, the one captured semi-automatic (`t20 = 7`). Balance, sound ids (`P09` / `Q04` / `P16`, reload
`D08 D07 D06`, all unused elsewhere so a data-port `.LTP` swap changes one pistol) and the "dominated by
primaries by design" rule: `docs/weapon-design.md` §2.2. Art: `assets/weapons/<id>.jpg` in both UIs.
**2026-09-17 (arsenal review): `glock` is `hidden`** (see the catalog-cut paragraph below) — only `usp` and
`deagle` are pickable sidearms today; the row, frame and `based_on` linkage stay for custom games.
`WeaponView` (API.md `GET /api/weapons`, and `assign.catalog`) gains `tags: string[]`, `role: string`, **`htk: number`**
(hits to drop **the host's pool** — `config.health.max_hp + max_armor` plus any per-player override and
the `body_armor` perk, 115 at the defaults; it moves with the health config, so a UI showing it must show
`pool` beside it — see `weapon-design.md` §2.5. The UIs show HITS TO KILL instead of the decorative RANGE
bar: t41 is 75 on every gun),
`ttk_ms`, and optional **`caution?: string`** — human copy for a weapon with a known live problem (new optional
`caution` field in `weapons.json`; set on `energy_launcher`). `cls` stays the raw class id.

**`class` / `weapon_class` (2026-09-17, arsenal review).** Every `weapons.json` row now carries `class:
"ballistic" | "energy" | "melee"` — the rule it encodes: ballistic weapons reload, energy weapons overheat
or charge. On the wire (`WeaponView`, `GET /api/weapons`, `assign.catalog`) the field is named
**`weapon_class`**, not `class`: `class` is a reserved word in Python, and the `Weapon`/`WeaponView`
TypedDicts use class-body syntax, so the wire name differs from the `weapons.json` source key by design —
this is a deliberate exception to "field names are identical in Python TypedDicts, `API.md`, `types.ts` and
the phone engine" above, not a drift. `class`/`weapon_class` is unrelated to `cls` (the raw protocol class
byte, t9).

**Hidden weapons (2026-09-17, arsenal review).** `force_rifle`, `bolt_rifle`, `stinger`, `plasma_sniper`,
`laser_cannon`, `ion_sniper`, `energy_launcher` and `glock` joined `melee` as `hidden: true` in
`weapons.json`, cutting overlap in a 22-weapon catalogue. Visible primaries: `assault_rifle`,
`burst_rifle`, `smg`, `shotgun`, `amr`, `sniper_rifle`, `suppressor`, `energy_rifle`, `charge_rifle`.
Visible sidearms: `usp`, `deagle`. **Three counts, and they are all different:** the catalogue holds **22** rows, **13** are not hidden, and **11** can be picked into a starting loadout, because `rocket_launcher` and `rail_gun` are visible but `pickup_only`. Say which one you mean; `test_presets_and_pools` pins the pickable 11. A hidden row's data (capture frame, `based_on` linkage, `class`, stats)
is untouched — custom games, and the pistols' `based_on: bolt_rifle` copy, still resolve normally; only
`WeaponCatalog.all()` (the picker-facing list) drops it.

**`pickup_only` (2026-09-17, arsenal review).** `rocket_launcher`, `rail_gun`, `laser_cannon`, `ion_sniper`
and `energy_launcher` — the `heavy`-tagged weapons — carry `pickup_only: true`. `rocket_launcher` and
`rail_gun` stay in the catalogue (`WeaponView`, so MC can show them); the other three are also `hidden`.
A `pickup_only` weapon is **never in a starting-loadout pool**, whatever the preset: `open`, `no_heavies`,
`custom`, and a `fixed_id`/`only_ids` naming one is refused exactly like an id that is not in the pool at
all. This makes `no_heavies` and `open` land on the same pool today, since the only visible `heavy`-tagged
rows were already excluded by `pickup_only`. **The pickup/station mechanism itself — a player picking up a
heavy weapon from a physical station mid-match — is future work** (see `hardware/brx-station-spec.md`);
`pickup_only` only says these weapons are catalogue-visible and never player-selectable at kit-out.

### 1.2 Perks — NEW `mcp/brx_mcp/mc/perks.json`, `GET /api/perks → PerkView[]`

**S50 (2026-09-17, perk balance pass).** The v1 set was a ladder, not a choice: `body_armor` was a
flat +50 armour (+43% effective health on the 45+70 default) at zero cost, while every other perk
bought convenience that was often worth nothing (`docs/FOLLOWUPS.md` S50, the balance analysis it
cites). Every perk below now costs on the SAME lever its opposite buys, so the set trades instead of
stacking, and `easy_reload` left the slot entirely (§2) — it is accessibility, not balance.

```jsonc
PerkView {
  perk_id: string,                 // "body_armor" | "extended_mags" | "quick_hands" | "quick_switch" | "armor_piercing" | "motion_tracker" | "second_wind" | "med_kit" | "concussion"
  name: string, desc: string,      // house-written, human (no protocol jargon)
  tags: string[],                  // "passive" | "utility"
  mechanism: "passive" | "slot_frame",
  effects: {                       // passive knobs the compiler understands (all optional)
    max_armor_add?: number,        // a FLAT armour grant/cost (docs/perk-design.md §2, decided
                                    // 2026-09-17): `mc/compile.py` `_MAX_ARMOR_ADD`, keyed by perk_id,
                                    // is the one table the compiled arithmetic reads; this field is its
                                    // wire-visible documentation, kept a plain integer. `gain`/`cost`
                                    // below (S50, 2026-09-19) turn it into the "+N ARMOR" line either UI
                                    // renders — neither reads this field directly any more. body_armor
                                    // +25 (was a flat +50), quick_switch
                                    // -20. Capped at 255, floored at 0. In a game whose BASE
                                    // health.max_armor is 0 (the Shields preset, `mc/compile.py`
                                    // `is_shields_preset`), the grant compiles into the SHIELD ceiling
                                    // instead of armour — adding an armour layer to a preset built with
                                    // none would defeat its design.
    ammo_mult?: number,            // extended_mags: ×2 mag + reserve on the PRIMARY ($AMMO,0 + t16/t39/t17/t40); quick_hands: ×0.8 (the cost of a faster reload)
    reload_mult?: number,          // quick_hands: ×0.5 reload_ms on the PRIMARY (t18); body_armor: ×1.25 (armour is heavier in the hands)
    alt_reload?: boolean,          // unused by any current row (S50: moved to `overrides.easy_reload`, §2) — kept for a future ALT-button perk
    switch_mult?: number,          // quick_switch (2026-09-04): ×0.5 the gun's weapon-swap delay — $WEAP tok15 on EVERY slot (the gun takes the larger of slots 0/1; bench-proven, linear, no floor). MC puts the resolved value in FrameBundle.swap_ms for the HUD's SWITCHING takeover. extended_mags: ×1.3 (a bulkier magazine draws slower)
    armor_piercing?: boolean       // S50 NEW (armor_piercing perk): the PRIMARY's $SIR key is swapped, compile-time, to
                                    // a fixed cell (mc/compile.py `_AP_CELL`, `(4,0)`) permanently wired in
                                    // `gameconfig._SIR_TABLE` to fn 2 (bench-proven to bypass armour AND
                                    // shields, straight to HP). Damage is cut to `_AP_DAMAGE_MULT` (~40%,
                                    // a 60% reduction) via `dmg_mult`. PRIMARY ONLY, and refused (compile
                                    // raises) on a weapon whose damage key is already special: a charge
                                    // weapon (the Charge Rifle), or a stock grant/heal/status cell.
                                    // ⚠ THE KEY IS GAME-WIDE, FOR THE WHOLE MATCH, NOT PER PLAYER: a
                                    // $SIR cell's function is the victim's table, compiled the same way
                                    // for every player (the mechanism `hit_plan`/A17's class layer
                                    // already relies on) — two players can never give `_AP_CELL` two
                                    // different meanings in the same match. `assert_armor_piercing_armed`
                                    // refuses to arm a player carrying the perk if the compiled head has
                                    // no row for the cell (the F11 shape: a gun with no matching row eats
                                    // the hit silently while both ends report healthy).
  },
  gain: string[],                  // S50 (2026-09-19): player-facing GAIN lines, e.g. "+25 ARMOR",
                                    // "IGNORES ARMOR & SHIELDS" — `mc/perks.py` `gain_cost_lines` is the
                                    // ONE place either UI reads a perk's trade from; app/src/hud/hud.js
                                    // and webapp/mc/src/screens/Kit.tsx render these two lists rather
                                    // than deriving their own from `effects` (the earlier bug: a
                                    // `reload_mult` over 1 printed "FASTER" regardless of sign). A
                                    // node-local perk (motion_tracker, second_wind: `effects: {}`) still
                                    // carries a named gain line here.
  cost: string[],                  // the same perk's COST lines, e.g. "RELOADS 1.2× SLOWER" — empty
                                    // when the perk carries none. armor_piercing's cost is WORDED, not a
                                    // figure ("FIXED DAMAGE, SLOWER CYCLE"): the actual numbers
                                    // (`ap_dmg`/`ap_fire_ms`) live on the WEAPON (`weapons.json` §7.7),
                                    // not the perk, and vary per primary.
  verified: boolean,               // effect proven on hardware
  hidden: boolean                  // true → never listed to UIs (med_kit, concussion until benched)
}
```
v1 rows: `body_armor` (verified), `extended_mags` (verified), `quick_hands` (unverified, listed),
`quick_switch` (verified — A14, 2026-09-04), `armor_piercing` (unverified, new — S50), `motion_tracker`
+ `second_wind` (unverified, new — S50, node-local: `effects: {}`, no compile-time lever, docs/perk-design.md
§2), `med_kit` + `concussion` (`hidden: true`, `mechanism: "slot_frame"`).

## 2. Loadout (contracts §2, A10 + A14) — `weapons[]` stays canonical on the wire
```jsonc
Loadout {
  weapons: WeaponSel[],            // [primary] or [primary, secondary]; index == gun slot. NEVER empty (primary required).
  perk?: string | null,            // A14: the PERK slot — rides BESIDE a secondary weapon (AR + pistol + Quick Switch is a legal kit)
  overrides?: { max_hp?: 1..999, max_armor?: 0..999, easy_reload?: boolean }   // per-player POOL + accessibility (§2.1)
}
```
**A14 (Tony, 2026-09-04): "non-activated perks should be an extra thing outside of the secondary slot."** The v1 perks
are passive head-frame knobs, so nothing about them competes with slot 1 — the old "slot 2 = weapon OR perk" rule was a
UI convention, not a hardware fact.

### 2.1 Easy Reload — a per-player accessibility switch, not a perk (S50, 2026-09-17)

Easy Reload maps the **ALT button** to RELOAD (`$BMAP,1,97`). It exists because a player may not be able to work the
reload lever (Tony: his daughter), so it is accessibility, not balance: it moved OUT of the perk slot and INTO
`loadout.overrides.easy_reload`, beside the per-player pool handicap (§2), the other accessibility control. The two
switches are independent: a player may take Easy Reload with no extra pool, or the pool handicap with no Easy Reload.

The hardware exception rides WITH it: the ALT button leaves no button to switch weapons with, so `easy_reload` still
**cannot ride with a second weapon**, nor with a weapon whose reload is a held per-shell chain (F123, the Shotgun's
`reload_type: "chain"`, where one ALT tap fires one reload event and the magazine never comes back). Both are host-side
**policy rejects** (`policy.validate_loadout`), never a phone pick: `easy_reload` is set only by the host
(`state._check_loadout`), and `apply()`'s auto-fix resolves a conflict by dropping the SECOND WEAPON first (the override
is the host's explicit accessibility setting) or, if the primary itself chain-reloads, by dropping the override instead
(a primary is mandatory, so the weapon that already resolved is the one that stands).

Validation (`state._check_loadout`): 1–2 weapons, ids from the catalog (visible only), `perk` from the visible perk
catalog. Then **policy enforcement** (§3.3) — a violating loadout (out of pool, or the ALT-button pair) is
`400 {error}` from the host API and a `loadout_ack {ok:false}` from the phone path; the server never stores it.

Compiler (`compile.py`): slot 1 `$WEAP`/`$AMMO,1` emitted **only when a secondary exists** (no more silent shotgun);
`melee` slot 4 unchanged. Perk effects: `max_armor_add` → `$PSET` armor; `ammo_mult` → `$AMMO,0` + primary frame
t16/t39 (mag) and t17/t40 (reserve; keep t17 == 2×t40 and t39 == t16); `reload_mult` → t18. S50: `overrides.easy_reload`
→ `_bmap()` (`$BMAP,1,97`); no current perk row sets `effects.alt_reload` (§1.2), so that key compiles nothing today.
Tutorial frames are unaffected (a try-out is the raw weapon).

### The per-player pool (the handicap knob)

`loadout.overrides` is the one part of a kit that changes the player rather than the gun. The compiler
reads it in `_to_gc()` and it goes out on **that player's `$PSET`**, so one player can be armed at a
different pool from everyone else in the same match: a younger player at double health, or the solo
side of a 2v1. `max_armor` may be **0** (the game's own health block allows 0 armour, so a handicap
must be able to take a pool away, not only add one); `max_hp` may not, because 0 HP is not a pool.

It is deliberately loud in the console (KIT, the POOL card): the card states the game's numbers beside
the player's, names the player in the "on purpose" line, and the roster marks them so a host sees who
is handicapped without selecting anyone. Screen-truth steps: `webapp/mc/test/kit-pool.test.tsx`.

## 3. Loadout policy (contracts §3 `GameConfig`, A10)
```jsonc
GameConfig += { loadout_policy: LoadoutPolicy }
LoadoutPolicy {
  preset: "open" | "no_heavies" | "snipers" | "custom",
  hud_select: boolean,                       // may players pick from the phone at all (false ⇒ every slot is host-side)
  primary:   SlotRule,                       // choice never "off"
  secondary: SlotRule,                       // choice may be "off" (slot 2 disabled for everyone); kinds weapons-only
  perk:      SlotRule                        // A14: the perk slot; kinds always ["perk"]; choice may be "off" (no perks this game)
}
SlotRule {
  choice: "player" | "host" | "fixed" | "off",
  kinds: ("weapon" | "sidearm" | "perk")[],  // primary/secondary: ["weapon"] (default) or ["sidearm"] (pistol round / pistols-only slot 2);
                                             // perk: ["perk"]. A12: "sidearm" admits ONLY the `sidearm`-tagged weapons. "weapon" already
                                             // includes the pistols, so ["weapon","sidearm"] ≡ ["weapon"]. A POLICY kind, never a request
                                             // kind (a pistol is a "weapon"). A14: "perk" inside a WEAPON slot's kinds is a 400 — no legacy read.
  exclude_tags: string[], exclude_ids: string[], only_ids: string[],   // pool = catalog ∩ only_ids(if any) − exclude_*
  fixed_id?: string | null                   // when choice == "fixed": the weapon_id (primary / secondary) or perk_id (perk)
}
```
### 3.1 Presets (server `policy.py`; the UI only names them)
| preset | primary | secondary | perk | hud_select |
|---|---|---|---|---|
| `open` | player, all | player, all weapons | player, all | true |
| `no_heavies` | player, `exclude_tags:["heavy"]` | player, `exclude_tags:["heavy"]` | player, all | true |
| `snipers` | `fixed` → `sniper_rifle` | `off` | `off` | false |
| `custom` | whatever the host set (editing any rule of another preset flips `preset` to `custom`) | | | |

The builtin saved game **Silenced Sniper** (§8) is `primary fixed sniper_rifle`, `secondary off`, `perk fixed extended_mags`.

**2026-09-17 (arsenal review):** `pickup_only` (§1.1 above) now excludes `rocket_launcher`/`rail_gun`
from every preset's pool BEFORE `exclude_tags:["heavy"]` is even applied — they were the only visible
`heavy`-tagged rows left once the arsenal cut also hid `laser_cannon`/`ion_sniper`/`energy_launcher`.
So `open` and `no_heavies` currently land on the **same pool**: `no_heavies`'s `exclude_tags` rule has
nothing left to exclude that `pickup_only` had not already excluded. This is a real, deliberate
consequence, not a bug — but a class chip/preset that can never change the pool it names may read as
broken in the DESIGNER (its HEAVY chip permanently reads PARTIAL, never fully on). Worth a second look
once the pickup/station mechanism exists: either give `no_heavies` a new distinguishing exclusion, or
retire it as redundant with `open`.

Mode defaults (`modes.default_config`): `ffa` → `no_heavies`; every other mode → `open`. Selecting a mode card in
BUILD applies its default preset (same rule as the other defaults — review #15: apply on *change* only).

### 3.2 Derived pool — computed ONCE, server-side, published in `State`
```jsonc
State += { loadout_pool: { primary: string[], secondary_weapons: string[], perks: string[] } }   // allowed ids, catalog order (A14: `perks`, not `secondary_perks`)
```
Both UIs render from these lists + the catalog; **no rule logic in TypeScript/JS** (the `?mock` backend ships a
small mirror of `policy.py` for the demo only).

### 3.3 Enforcement + auto-apply (`state.apply_policy()`)
**Also (brx-opus2 review, 2026-08-27):** a player whose loadout the ruleset changed has any in-flight try-out
**cancelled** (`tutorial {end}` teardown), and the host is told: `config_warnings` carries a transient
`"N LOADOUTS RESET BY NO HEAVIES"` (preset label) until the next config PUT.
Runs on every `PUT /api/config` that touches `loadout_policy` or `mode`, on `POST /api/players`, and on session
reset. For every player: `fixed` → slot set to `fixed_id`; `off` → that slot cleared; an item not in the pool →
primary falls to the first allowed weapon (`assault_rifle` if allowed), secondary / perk cleared. S50: `overrides.easy_reload`
beside a second weapon keeps the override (the host's own accessibility setting) and drops the weapon; beside a
chain-reload primary it is the override that gives way instead, since a primary is mandatory (§2.1). Changes re-send
`assign` (and re-compile/re-push `config` if already pushed) exactly like `PATCH /api/players`.
Writers: `choice:"player"` → phone AND host may write (host is the override; last write wins and both see it in the
next `assign`/snapshot); `"host"` → host only (phone browser shows a lock); `"fixed"`/`"off"` → nobody (BUILD only).

## 4. Phone self-serve flow (contracts §5, A10 — new kinds)

### 4.1 `assign` (MC → node) gains the catalog + the player's slot rights
```jsonc
assign { player, team, roster,
         catalog: { weapons: WeaponView[], perks: PerkView[] },     // visible rows only; sent on every assign (≈8 KB)
         policy:  { hud_select, primary: { choice, allowed_ids }, secondary: { choice, kinds, allowed_weapon_ids },
                    perk: { choice, allowed_perk_ids } } }                        // A14: the perk rights are their own rule
```
`policy` also carries **`kit_open: boolean`** — true only while the host is on **KIT** and the lobby is not pushed
(Tony, 2026-08-27: phones show "Mission Control is setting up the game" until the game is chosen; then the kit
editor unlocks). MC re-sends `assign` to every bound node whenever the flag flips. `assign` also carries
**`game`** (§4.6) — what the BRIEFING screen shows.

### 4.2 `loadout_request` (node → MC) — NEW `NODE_KINDS` entry
```jsonc
loadout_request { node_id, player_id, slot: "primary"|"secondary"|"perk", kind: "weapon"|"perk"|"none", id?: string, try?: boolean }
```
- MC validates against the policy (slot `choice == "player"`, `hud_select`, id in pool, `kind:"none"` on secondary / perk only;
  A14: a perk sent to `secondary` → "Perks have their own slot this game", a weapon sent to `perk` → "Only a perk goes in the perk slot")
  **and `kit_open`** — before KIT the reason is "Mission Control is still setting up the game"; after the push,
  "Try-outs are closed — the game has been pushed to the guns".
- OK → applies to `Player.loadout`, re-sends `assign`, and if `try` (weapons only) starts the **existing** try-out
  (`tutorial` push, `kit.trying[pid] = id`). A try on a player already trying replaces it.
- Reply always: **`loadout_ack`** (MC → node, NEW `MC_KINDS` entry) `{ slot, ok: boolean, reason?: string, dropped?: {slot, id, name}, loadout }` —
  `reason` is human copy the HUD shows verbatim (`"Host locked this slot"`, `"Heavies are off for this game"`,
  `"Try-outs are closed — the game is being armed"`, A12: `"Only sidearms go in the secondary slot this game"`).
  **`dropped`:** the pick applied AND knocked the other slot out. **S50: `easy_reload` moved to the host-only
  `loadout.overrides`, which this channel never writes, so a `loadout_request` can no longer create or resolve the
  ALT-button conflict**: `policy.dropped_by()` now always returns `(None, None)`. The field stays on the wire for a
  future conflict of this shape; none exists today.
### 4.3 `loadout_browse` (node → MC) — NEW, presence only
```jsonc
loadout_browse { node_id, player_id, open: boolean }        // HUD opened/closed the loadout browser
State.kit += { browsing: { [player_id]: t_ms } }             // MC roster shows "PICKING…" (expires server-side after 60 s)
```
### 4.4 Ready-up semantics (fixes, `state.py`)
- `ready` from a player **ends that player's try-out** (existing `tutorial {end}` teardown) — the gun must not stay
  armed with an uncredited identity.
- **kit → lobby auto-advance only when every rostered player is ready** (was: first ready — brx-opus2 S1). **A27 (F127,
  2026-09-11): the host's CONTINUE ▸ is guarded too** — `POST /api/phase {phase:"lobby"}` from `kit` is refused (409,
  `not_ready` names) unless `force:true`; the MC button shows `greens / roster_size READY` and forces only on a second
  tap that names who is not ready. A player moved out of the kit editor by a forced advance sees "THE HOST LOCKED KITS —
  you play what you had" on the lobby screen (`moment kit_locked_by_host`), never a silent screen swap.
- **A30 (2026-09-12): the kit LOCKS at START** — in `armed`/`live` a phone pick is refused (`loadout_ack ok:false`, reason above) and host edits are 409; a `config` to a live gun un-spawns it and nothing re-spawns it (engine.js `_applyConfig` + `resumeSchedule`). Picks before START still re-push in LOBBY as before.
- `tryout()` refuses only when **the lobby has been pushed** (`lobby_pushed`) — no longer "any node in LOBBY". Its
  error text is the `loadout_ack.reason` / the MC toast.
### 4.5 Phone screens (B0 KITTED grows one screen)
- KITTED plate strip is **three tappable slot plates** `PRIMARY` / `SECONDARY` / `PERK` (A14; 250 px each on the 844 px
  frame — HP · ARMOR moved up into the header line). Locked slot → padlock + "Set by the host". `hud_select:false` →
  plates not tappable. An empty PERK plate reads "NONE · NO PERK"; an empty SECONDARY "NONE · NO ALT-FIRE".
- **LOADOUT browser** (landscape 844×390): tab bar `PRIMARY | SECONDARY | PERK`; list **left** (rows ≥44 px: thumb, name,
  class chip, MAG; the secondary tab has `WEAPONS · NONE` chips, the perk tab `PERKS · NONE`), detail **right** (art,
  DMG/ROF/RNG bars, MAG/RESERVE, one-line desc); bottom action bar ≥44 px: **`REVIEW KIT ▸`** (A26: opens the three-plate
  kit summary with READY UP) and `CLOSE`. **A26 (S20, 2026-09-11): `TRY IT` is gone — tapping a weapon row equips it AND
  arms it for test-firing** (`loadout_request {try:true}`) after a 400 ms node-side debounce, so scrolling never spams MC or
  `$WEAP`; ✓ = MC acked the pick, ⟳ = still arming. The row's ⓘ opens its detail.
  A12: when `policy.secondary.kinds` holds `"sidearm"` and not `"weapon"` the weapons chip reads `SIDEARMS · n`
  (the pool already holds only pistols) and the hint reads "Pick a sidearm"; role label `SIDEARM`.
  **Tap a row = equip** (sends `loadout_request`, row shows ✓ on `loadout_ack`); perks equip on tap, no try. **S50:**
  Easy Reload is no longer a row in the perk tab; it is a host-only override (§2.1), so the phone browser has no
  ALT-button warning flow to show and no two-tap confirm to send.
- Try-out panel (existing) gains `DONE` → back to the browser. READY UP works from KITTED as before.

### 4.6 Phone: setting-up → BRIEFING → kit editor (Tony, 2026-08-27)
```jsonc
assign.game { name, desc,                       // saved-game name/desc when the live config matches one, else the stock mode
              mode, mode_name, abbr, teams_text, win_text, respawn_text,
              time_limit_s, respawn, health, environment, night,
              loadout_line,                     // one human sentence: "You pick your primary (16 to choose from), slot 2: a second weapon, a perk of your choice (5)."
              ruleset, hud_select }             // preset label (OPEN / NO HEAVIES / …) + whether phones may pick
```
- **`kit_open:false`** (ARMORY / GAMES): the KITTED screen shows **"MISSION CONTROL IS SETTING UP THE GAME"** —
  name + number + gun, no plates, no READY UP. Calm, not an error.
- **flip to `kit_open:true`**: a **BRIEFING** screen — the game's name big, the mode art, `desc`, the rule lines
  (teams · win · respawn · time · HP/armor · venue) and the `loadout_line` — read at the player's own pace, with one
  button **`BUILD MY KIT ▸`** that reveals the slot plates + READY UP (§4.5). A `BRIEFING` button on the KITTED
  screen reopens it any time. Locked rulesets (`hud_select:false` / fixed slots) still get the briefing; the button
  reads **`SEE MY KIT ▸`** and the plates are padlocked.
- Mode art on the phone: `app/www/assets/modes/` holds copies of `webapp/mc/public/assets/modes/*.jpg` — the
  same bytes in both trees, not a downscale.

## 5. MC screens

Moved 2026-09-06 to `design/mission-control.md` (A2 GAMES + GAME DESIGNER, A3 KIT) — the one place the console's
screens are described. The rules those screens render are §3 (policy, presets, pool) and §4 (the phone flow).

*The superseded 2026-08-27 screen notes that used to sit here are `docs/archive/spec-loadout-superseded-notes.md`.*

## 6. Tests / e2e (screen truth)
Server: policy presets + pool, `_check_loadout` matrix, compile (no slot 1 when empty; each perk effect on the
frames; golden bundle updated), `loadout_request` happy/reject paths with **delivery assertions** for `loadout_ack`
and the catalog in `assign`, all-ready advance, ready-ends-tryout. UI rig: Kit two-slot pick at desktop + tablet,
phone browser at 844×390 (+ short viewport), FFA hides heavies on BOTH UIs, snipers preset locks both, phone
TRY IT → MC roster shows TRYING → READY → MC shows READY.

## 7. Bench items (docs/FOLLOWUPS.md, "Needs Tony at the bench", A10a-e)
Body Armor: push head with $PSET armor +50 → `$LCD` shows it → a hit absorbs. Extended Mags: HUD max matches
`$AMMO`. Easy Reload: ALT reloads. Empty slot 1: ALT press → reload, no crash. Quick Hands: reload chain timing.

## 8. Saved games (presets) — *added 2026-08-27, Tony's ask: "build a silenced-sniper game and save it to replay"*

A **saved game** is a whole `GameConfig` (mode + settings + health + `loadout_policy`) under a name, persisted on
the MC host. It is the "mode creation" flow: start from a stock mode card, tune it, **SAVE AS…**, replay it next
week from the SAVED GAMES shelf. (Per-game *weapon tuning* — damage / fire-sound / rate overrides — is
**deferred** to its own spec; the preset shape reserves `weapon_tuning` so it slots in without a schema change.)

```jsonc
SavedGame {
  preset_id: string,               // opaque; builtin ones are "builtin:<slug>"
  name: string, desc: string,      // host-typed; name unique (case-insensitive)
  builtin: boolean,                // shipped example — not deletable, apply/copy only
  created_t: number, updated_t: number,
  config: GameConfig,              // config_id stripped on save; assigned fresh on apply
  weapon_tuning?: {}               // RESERVED (future spec) — always absent today
}
```
- Storage: `~/.brx-mcp/presets.json` (`storage.BASE_DIR`, same place as `armory.json`). Never committed.
- One builtin example ships so the shelf is never empty on first use: **"Silenced Sniper"** — `ffa`, primary
  `fixed` → `sniper_rifle`, secondary `off`, perk `fixed` → `extended_mags` (A14 — the perk is its own
  slot; `presets.py::_builtin_configs`), `hud_select: false`, `health.max_armor: 0`
  (one shot kills on raw magnitude alone: the sniper's applied magnitude of 60 — `weapons.json` `wire.dmg`, not the
  0-100 UI bar of 52 — beats 45 HP without needing the fn 36 ×1.25, which is confirmed as floor(magnitude × 1.25)
  but not relied on here), desc notes that "silenced" (fire-sound override) is
  pending the weapon-tuning spec.
- API (`API.md`): `GET /api/presets → SavedGame[]` · `POST /api/presets {name, desc?, config?}` (default
  `config` = the current draft) `→ SavedGame`, `409` on a name clash unless `{replace: true}` · `PUT
  /api/presets/{id} {name?, desc?, config?}` · `DELETE /api/presets/{id}` (`403` for builtin) ·
  `POST /api/presets/{id}/apply → {ok, errors, config}` (same as `PUT /api/config` with the preset's config —
  runs `apply_policy`, posts the reset notice). Presets are not part of `State` (fetched on demand).
- BUILD UI: a **SAVED GAMES** shelf above the mode cards — cards (name, mode abbr, rules summary, desc), tap to
  apply, `SAVE AS…` (name + desc inline form) on the current build, delete behind the two-step confirm; the
  applied preset's card shows ACTIVE until the config is edited (then "MODIFIED — SAVE AS…").
