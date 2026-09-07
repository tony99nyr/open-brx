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
`WeaponView` (API.md `GET /api/weapons`, and `assign.catalog`) gains `tags: string[]`, `role: string`, **`htk: number`**
(hits to drop **the host's pool** — `config.health.max_hp + max_armor` plus any per-player override and
the `body_armor` perk, 115 at the defaults; it moves with the health config, so a UI showing it must show
`pool` beside it — see `weapon-design.md` §2.5. The UIs show HITS TO KILL instead of the decorative RANGE
bar: t41 is 75 on every gun),
`ttk_ms`, and optional **`caution?: string`** — human copy for a weapon with a known live problem (new optional
`caution` field in `weapons.json`; set on `energy_launcher`). `cls` stays the raw class id.

### 1.2 Perks — NEW `mcp/brx_mcp/mc/perks.json`, `GET /api/perks → PerkView[]`
```jsonc
PerkView {
  perk_id: string,                 // "body_armor" | "extended_mags" | "quick_hands" | "easy_reload" | "med_kit" | "concussion"
  name: string, desc: string,      // house-written, human (no protocol jargon)
  tags: string[],                  // "passive" | "utility"
  mechanism: "passive" | "slot_frame",
  effects: {                       // passive knobs the compiler understands (all optional)
    max_armor_add?: number,        // body_armor: +50 armor on $PSET
    ammo_mult?: number,            // extended_mags: ×2 mag + reserve on the PRIMARY ($AMMO,0 + t16/t39/t17/t40)
    reload_mult?: number,          // quick_hands: ×0.5 reload_ms on the PRIMARY (t18)
    alt_reload?: boolean,          // easy_reload: ALT button = RELOAD ($BMAP,1,97) — for players who can't work the lever
    switch_mult?: number           // quick_switch (2026-09-04): ×0.5 the gun's weapon-swap delay — $WEAP tok15 on EVERY slot (the gun takes the larger of slots 0/1; bench-proven, linear, no floor). MC puts the resolved value in FrameBundle.swap_ms for the HUD's SWITCHING takeover
  },
  verified: boolean,               // effect proven on hardware
  hidden: boolean                  // true → never listed to UIs (med_kit, concussion until benched)
}
```
v1 rows: `body_armor` (verified), `extended_mags` (verified), `quick_hands` (unverified, listed), `easy_reload`
(verified — existing `alt_reload`), `med_kit` + `concussion` (`hidden: true`, `mechanism: "slot_frame"`).

## 2. Loadout (contracts §2, A10 + A14) — `weapons[]` stays canonical on the wire
```jsonc
Loadout {
  weapons: WeaponSel[],            // [primary] or [primary, secondary]; index == gun slot. NEVER empty (primary required).
  perk?: string | null,            // A14: the PERK slot — rides BESIDE a secondary weapon (AR + pistol + Quick Switch is a legal kit)
  overrides?: { max_hp?: 1..999, max_armor?: 0..999 }   // per-player POOL: the handicap knob
}
```
**A14 (Tony, 2026-09-04): "non-activated perks should be an extra thing outside of the secondary slot."** The v1 perks
are passive head-frame knobs, so nothing about them competes with slot 1 — the old "slot 2 = weapon OR perk" rule was a
UI convention, not a hardware fact. **The one hardware exception:** a perk that takes the **ALT button**
(`effects.alt_reload` — Easy Reload maps ALT to RELOAD via `$BMAP,1,97`) leaves no button to switch weapons with, so it
**cannot ride with a second weapon**. The host API refuses the pair; a phone pick applies and knocks the other slot out
(§4.2 `dropped`); both UIs warn with a two-tap confirm before sending ("EASY RELOAD TAKES THE ALT BUTTON — DROPS YOUR SMG ·
TAP AGAIN"). A new perk that claims a button in future joins the rule by setting `alt_reload` (or a sibling key the
compiler names) — the UIs test the effect, not the perk id.

Validation (`state._check_loadout`): 1–2 weapons, ids from the catalog (visible only), `perk` from the visible perk
catalog. Then **policy enforcement** (§3.3) — a violating loadout (out of pool, or the ALT-button pair) is
`400 {error}` from the host API and a `loadout_ack {ok:false}` from the phone path; the server never stores it.

Compiler (`compile.py`): slot 1 `$WEAP`/`$AMMO,1` emitted **only when a secondary exists** (no more silent shotgun);
`melee` slot 4 unchanged. Perk effects: `max_armor_add` → `$PSET` armor; `ammo_mult` → `$AMMO,0` + primary frame
t16/t39 (mag) and t17/t40 (reserve; keep t17 == 2×t40 and t39 == t16); `reload_mult` → t18; `alt_reload` → `_bmap()`.
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
primary falls to the first allowed weapon (`assault_rifle` if allowed), secondary / perk cleared. A14: a fixed ALT-button
perk (Easy Reload) beside a second weapon keeps the perk (the host's rule put it there) and drops the weapon. Changes re-send
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
  **A14 `dropped`:** the pick applied AND knocked the other slot out — Easy Reload over a loaded SMG → `{slot:"secondary",
  id:"smg", name:"SMG"}` + `reason "Easy Reload takes the ALT button — SMG dropped"`; a second weapon over Easy Reload →
  `{slot:"perk", …}` + `"Shotgun needs the ALT button to switch — Easy Reload dropped"`. The pick that arrives last wins.
### 4.3 `loadout_browse` (node → MC) — NEW, presence only
```jsonc
loadout_browse { node_id, player_id, open: boolean }        // HUD opened/closed the loadout browser
State.kit += { browsing: { [player_id]: t_ms } }             // MC roster shows "PICKING…" (expires server-side after 60 s)
```
### 4.4 Ready-up semantics (fixes, `state.py`)
- `ready` from a player **ends that player's try-out** (existing `tutorial {end}` teardown) — the gun must not stay
  armed with an uncredited identity.
- **kit → lobby auto-advance only when every rostered player is ready** (was: first ready — brx-opus2 S1). The host's
  CONTINUE ▸ is unaffected.
- `tryout()` refuses only when **the lobby has been pushed** (`lobby_pushed`) — no longer "any node in LOBBY". Its
  error text is the `loadout_ack.reason` / the MC toast.
### 4.5 Phone screens (B0 KITTED grows one screen)
- KITTED plate strip is **three tappable slot plates** `PRIMARY` / `SECONDARY` / `PERK` (A14; 250 px each on the 844 px
  frame — HP · ARMOR moved up into the header line). Locked slot → padlock + "Set by the host". `hud_select:false` →
  plates not tappable. An empty PERK plate reads "NONE · NO PERK"; an empty SECONDARY "NONE · NO ALT-FIRE".
- **LOADOUT browser** (landscape 844×390): tab bar `PRIMARY | SECONDARY | PERK`; list **left** (rows ≥44 px: thumb, name,
  class chip, MAG; the secondary tab has `WEAPONS · NONE` chips, the perk tab `PERKS · NONE`), detail **right** (art,
  DMG/ROF/RNG bars, MAG/RESERVE, one-line desc); bottom action bar ≥44 px: `TRY IT` (weapons, sends `try:true`), `CLOSE`.
  A12: when `policy.secondary.kinds` holds `"sidearm"` and not `"weapon"` the weapons chip reads `SIDEARMS · n`
  (the pool already holds only pistols) and the hint reads "Pick a sidearm"; role label `SIDEARM`.
  **Tap a row = equip** (sends `loadout_request`, row shows ✓ on `loadout_ack`); perks equip on tap, no try.
  **A14 ALT-button warning:** tapping Easy Reload while a second weapon is loaded (or a weapon while Easy Reload is on)
  does NOT send — the row turns amber and the action bar says "EASY RELOAD TAKES THE ALT BUTTON — DROPS YOUR SMG · TAP
  AGAIN"; the second tap sends, and the ack chip then reads "EQUIPPED ✓ · SMG DROPPED". Tapping anything else cancels.
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
- Mode art on the phone: downscaled copies of `webapp/mc/public/assets/modes/*.jpg` in `app/www/assets/modes/`.

## 5. MC screens

Moved 2026-09-06 to `design/mission-control.md` (A2 GAMES + GAME DESIGNER, A3 KIT) — the one place the console's
screens are described. The rules those screens render are §3 (policy, presets, pool) and §4 (the phone flow).

<!-- superseded text follows for grep provenance only; the design brief is authoritative -->
<details><summary>Superseded 2026-08-27 screen notes</summary>

- **GAMES** (replaces BUILD in the stepper; Tony 2026-08-27 — "pick tonight's game" is a different job from
  "define a game"): `YOUR GAMES` row (saved cards: name, base-mode art, one-line summary, EDIT / DUPLICATE; `+ CREATE
  A GAME`) and `STOCK MODES` row (TDM / FFA / … with defaults; CUSTOMIZE opens the designer with that base). Tap a
  card → it is the game; a summary panel shows what players get; **VENUE** chips (indoor/outdoor, night — about
  where you play, not saved into the game; re-asserted after a game is applied); `CONTINUE ▸` to KIT. No forms.
  `State.active_preset_id` (set by `POST /api/presets/{id}/apply`, cleared by any non-venue `PUT /api/config`) is
  how GAMES knows which saved game is PLAYING — never by config content (a copy is identical to its source).
  Verbs: CUSTOMIZE (stock mode) · EDIT (your game) · COPY / MAKE MY OWN (open a draft named after the source;
  nothing is written until SAVE). Playing another card while the draft is TUNED — NOT SAVED asks once.
- **GAME DESIGNER** (a full-width page opened from GAMES via CREATE / EDIT / CUSTOMIZE — authoring, not a phase):
  one scrolling page — BASE (mode) → RULES (teams, time, score, respawn, health) → LOADOUT (PRIMARY / SECONDARY as
  two columns: who picks, the allowed pool as a tappable weapon grid with class quick-filters, fixed pick, perks) →
  NAME & NOTES — with a sticky summary rail (reads like the card will) holding `SAVE` / `SAVE AS NEW` / `PLAY THIS
  NOW ▸` (saves and jumps to KIT; an unnamed draft plays without being saved, and says so). Edits a DRAFT: nothing
  touches the live config until PLAY. The pool is computed ON THE CLIENT from the rules being edited (instant,
  server-independent — the same engine as `policy.py`); `POST /api/loadout/pool` only re-confirms the preset name.
  Class chips are ON / ◐ partial (n/N) / OFF; a tile dimmed by a chip is still tappable (allows just that weapon).
  A12: the secondary column's kind chips are `WEAPONS · SIDEARMS` (pistols only; mutually exclusive since "weapon"
  already admits pistols — the PERKS chip left with A14), the class chips gain `SIDEARM`, and the summary reads
  `SIDEARMS ONLY · 3 PISTOLS`. KIT's arsenal header Seg reads `SIDEARMS · n` for the same rule. OPEN / NO HEAVIES / SNIPERS are starting templates
  inside the designer, not match-night choices.
- *(superseded)* **BUILD** — "LOADOUT RULES" panel under GLOBAL SETTINGS: preset Seg `OPEN · NO HEAVIES · SNIPERS · CUSTOM`,
  `PLAYERS PICK ON PHONE` toggle, per-slot rows (choice Seg + pool summary "15 OF 18 · NO HEAVIES" + fixed picker),
  CUSTOM exposes tag chips + per-weapon include/exclude.
- **KIT** — roster rows: live state (`PICKING…` / `TRYING SMG` / `READY ✓`) + the loadout line `PRIMARY + SECONDARY ◆ PERK`.
  Detail: identity strip → **loadout rail** (PRIMARY / SECONDARY / PERK cards — A14; secondary is weapon | empty, perk is
  perk | empty) → arsenal for the selected slot (header carries the pool summary; out-of-pool tiles dimmed, no per-tile
  labels; the PERK slot shows the perk grid) → hero for the selected slot's item (perks: effects block instead of
  DMG/ROF/RNG). Fixed/off slots show a padlock and "SET IN BUILD". A14: picking Easy Reload over a loaded secondary (or
  the reverse) is a two-tap confirm on the tile ("DROPS THEIR SMG — TAP AGAIN"). Tablet ≤ 900 px: roster becomes a chip
  strip, cards stack.
- **GAME DESIGNER** LOADOUT section (A14): three columns PRIMARY / SECONDARY / PERK. The PERK column has WHO PICKS
  (player / host / fixed / off) and the perk grid; the SECONDARY column's kind chips are `WEAPONS · SIDEARMS` only.

</details>

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
  `fixed` → `sniper_rifle`, secondary `fixed` → `extended_mags`, `hud_select: false`, `health.max_armor: 0`
  (one shot kills on raw magnitude alone: the sniper's 52 beats 45 HP without needing the fn 36 ×1.25, which is confirmed as floor(magnitude × 1.25) but not relied on here), desc notes that "silenced" (fire-sound override) is
  pending the weapon-tuning spec.
- API (`API.md`): `GET /api/presets → SavedGame[]` · `POST /api/presets {name, desc?, config?}` (default
  `config` = the current draft) `→ SavedGame`, `409` on a name clash unless `{replace: true}` · `PUT
  /api/presets/{id} {name?, desc?, config?}` · `DELETE /api/presets/{id}` (`403` for builtin) ·
  `POST /api/presets/{id}/apply → {ok, errors, config}` (same as `PUT /api/config` with the preset's config —
  runs `apply_policy`, posts the reset notice). Presets are not part of `State` (fetched on demand).
- BUILD UI: a **SAVED GAMES** shelf above the mode cards — cards (name, mode abbr, rules summary, desc), tap to
  apply, `SAVE AS…` (name + desc inline form) on the current build, delete behind the two-step confirm; the
  applied preset's card shows ACTIVE until the config is edited (then "MODIFIED — SAVE AS…").
