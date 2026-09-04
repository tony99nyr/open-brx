# M-LOADOUT — two slots, perks, loadout policy, phone self-serve kitting

- **Status:** §8 saved games server side BUILT 2026-08-27 (`presets.py`, `/api/presets*`, `Session.sanitize_config`). Server side BUILT 2026-08-27 (`policy.py`, `perks.py`/`perks.json`, `views.py`, state/compile/api/envelope; tests `tests/test_mc_loadout.py` + a real-stack e2e). UI lanes in progress. Amends `contracts.md` (**A10** — A9 was already `apply.preview`) — §2 `Loadout`, §3 `GameConfig`, §5 wire kinds.
  Binding for `mcp/brx_mcp/mc` (server), `webapp/mc` (MC UI) and `app/` (phone node). Field names are identical
  in Python TypedDicts, `API.md`, `types.ts` and the phone engine.
- **Owns:** the shape of a player's kit (primary + secondary-or-perk), the **loadout policy** a host sets per game
  (who may pick what, per slot), the **perk catalog**, and the phone's **self-serve pick / try** flow.
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
Weapon += { tags: string[] }      // "heavy" (role power), "sniper" (sniper_rifle, plasma_sniper, ion_sniper, amr), "cqb", "assault", "support"
```
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
    switch_mult?: number           // quick_switch (2026-09-04): ×0.5 the node's weapon-swap window (SWITCH_MAX_MS). NODE-SIDE ONLY for now: no $WEAP draw-time token is known, so the gun's real swap is unchanged — FOLLOWUPS F22
  },
  verified: boolean,               // effect proven on hardware
  hidden: boolean                  // true → never listed to UIs (med_kit, concussion until benched)
}
```
v1 rows: `body_armor` (verified), `extended_mags` (verified), `quick_hands` (unverified, listed), `easy_reload`
(verified — existing `alt_reload`), `med_kit` + `concussion` (`hidden: true`, `mechanism: "slot_frame"`).

## 2. Loadout (contracts §2, A10) — `weapons[]` stays canonical on the wire
```jsonc
Loadout {
  weapons: WeaponSel[],            // [primary] or [primary, secondary]; index == gun slot. NEVER empty (primary required).
  perk?: string | null,            // perk_id; mutually exclusive with a secondary WEAPON (slot 2 = weapon | perk | empty)
  overrides?: { max_hp?, max_armor? }
}
```
Validation (`state._check_loadout`): 1–2 weapons, ids from the catalog (visible only), `perk` from the visible perk
catalog, **`perk` set ⇒ `len(weapons) == 1`**. Then **policy enforcement** (§3.3) — a violating loadout is
`400 {error}` from the host API and a `loadout_ack {ok:false}` from the phone path; the server never stores it.

Compiler (`compile.py`): slot 1 `$WEAP`/`$AMMO,1` emitted **only when a secondary exists** (no more silent shotgun);
`melee` slot 4 unchanged. Perk effects: `max_armor_add` → `$PSET` armor; `ammo_mult` → `$AMMO,0` + primary frame
t16/t39 (mag) and t17/t40 (reserve; keep t17 == 2×t40 and t39 == t16); `reload_mult` → t18; `alt_reload` → `_bmap()`.
Tutorial frames are unaffected (a try-out is the raw weapon).

## 3. Loadout policy (contracts §3 `GameConfig`, A10)
```jsonc
GameConfig += { loadout_policy: LoadoutPolicy }
LoadoutPolicy {
  preset: "open" | "no_heavies" | "snipers" | "custom",
  hud_select: boolean,                       // may players pick from the phone at all (false ⇒ every slot is host-side)
  primary:   SlotRule,                       // choice never "off"
  secondary: SlotRule                        // choice may be "off" (slot 2 disabled for everyone)
}
SlotRule {
  choice: "player" | "host" | "fixed" | "off",
  kinds: ("weapon" | "perk")[],              // primary: always ["weapon"]; secondary default ["weapon","perk"]
  exclude_tags: string[], exclude_ids: string[], only_ids: string[],   // pool = catalog ∩ only_ids(if any) − exclude_*
  fixed_id?: string | null                   // when choice == "fixed": the weapon_id (primary) / weapon_id|perk_id (secondary)
}
```
### 3.1 Presets (server `policy.py`; the UI only names them)
| preset | primary | secondary | hud_select |
|---|---|---|---|
| `open` | player, all | player, weapon+perk, all | true |
| `no_heavies` | player, `exclude_tags:["heavy"]` | player, weapon+perk, `exclude_tags:["heavy"]` | true |
| `snipers` | `fixed` → `sniper_rifle` | `off` | false |
| `custom` | whatever the host set (editing any rule of another preset flips `preset` to `custom`) | | |

Mode defaults (`modes.default_config`): `ffa` → `no_heavies`; every other mode → `open`. Selecting a mode card in
BUILD applies its default preset (same rule as the other defaults — review #15: apply on *change* only).

### 3.2 Derived pool — computed ONCE, server-side, published in `State`
```jsonc
State += { loadout_pool: { primary: string[], secondary_weapons: string[], secondary_perks: string[] } }   // allowed ids, catalog order
```
Both UIs render from these lists + the catalog; **no rule logic in TypeScript/JS** (the `?mock` backend ships a
small mirror of `policy.py` for the demo only).

### 3.3 Enforcement + auto-apply (`state.apply_policy()`)
**Also (brx-opus2 review, 2026-08-27):** a player whose loadout the ruleset changed has any in-flight try-out
**cancelled** (`tutorial {end}` teardown), and the host is told: `config_warnings` carries a transient
`"N LOADOUTS RESET BY NO HEAVIES"` (preset label) until the next config PUT.
Runs on every `PUT /api/config` that touches `loadout_policy` or `mode`, on `POST /api/players`, and on session
reset. For every player: `fixed` → slot set to `fixed_id`; `off` → secondary cleared; an item not in the pool →
primary falls to the first allowed weapon (`assault_rifle` if allowed), secondary/perk cleared. Changes re-send
`assign` (and re-compile/re-push `config` if already pushed) exactly like `PATCH /api/players`.
Writers: `choice:"player"` → phone AND host may write (host is the override; last write wins and both see it in the
next `assign`/snapshot); `"host"` → host only (phone browser shows a lock); `"fixed"`/`"off"` → nobody (BUILD only).

## 4. Phone self-serve flow (contracts §5, A10 — new kinds)

### 4.1 `assign` (MC → node) gains the catalog + the player's slot rights
```jsonc
assign { player, team, roster,
         catalog: { weapons: WeaponView[], perks: PerkView[] },     // visible rows only; sent on every assign (≈8 KB)
         policy:  { hud_select, primary: { choice, allowed_ids }, secondary: { choice, kinds, allowed_weapon_ids, allowed_perk_ids } } }
```
`policy` also carries **`kit_open: boolean`** — true only while the host is on **KIT** and the lobby is not pushed
(Tony, 2026-08-27: phones show "Mission Control is setting up the game" until the game is chosen; then the kit
editor unlocks). MC re-sends `assign` to every bound node whenever the flag flips. `assign` also carries
**`game`** (§4.6) — what the BRIEFING screen shows.

### 4.2 `loadout_request` (node → MC) — NEW `NODE_KINDS` entry
```jsonc
loadout_request { node_id, player_id, slot: "primary"|"secondary", kind: "weapon"|"perk"|"none", id?: string, try?: boolean }
```
- MC validates against the policy (slot `choice == "player"`, `hud_select`, id in pool, `kind:"none"` only on secondary)
  **and `kit_open`** — before KIT the reason is "Mission Control is still setting up the game"; after the push,
  "Try-outs are closed — the game has been pushed to the guns".
- OK → applies to `Player.loadout`, re-sends `assign`, and if `try` (weapons only) starts the **existing** try-out
  (`tutorial` push, `kit.trying[pid] = id`). A try on a player already trying replaces it.
- Reply always: **`loadout_ack`** (MC → node, NEW `MC_KINDS` entry) `{ slot, ok: boolean, reason?: string, loadout }` —
  `reason` is human copy the HUD shows verbatim (`"Host locked this slot"`, `"Heavies are off for this game"`,
  `"Try-outs are closed — the game is being armed"`).
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
- KITTED plate strip becomes **two tappable slot plates** `PRIMARY` / `SECONDARY` (+ perk shown as a plate with a
  glyph). Locked slot → padlock + "Set by the host". `hud_select:false` → plates not tappable.
- **LOADOUT browser** (landscape 844×390): tab bar `PRIMARY | SECONDARY`; list **left** (rows ≥44 px: thumb, name,
  class chip, MAG; secondary tab has `WEAPONS · PERKS · NONE` filter chips), detail **right** (art, DMG/ROF/RNG bars,
  MAG/RESERVE, one-line desc); bottom action bar ≥44 px: `TRY IT` (weapons, sends `try:true`), `DONE`.
  **Tap a row = equip** (sends `loadout_request`, row shows ✓ on `loadout_ack`); perks equip on tap, no try.
- Try-out panel (existing) gains `DONE` → back to the browser. READY UP works from KITTED as before.

### 4.6 Phone: setting-up → BRIEFING → kit editor (Tony, 2026-08-27)
```jsonc
assign.game { name, desc,                       // saved-game name/desc when the live config matches one, else the stock mode
              mode, mode_name, abbr, teams_text, win_text, respawn_text,
              time_limit_s, respawn, health, environment, night,
              loadout_line,                     // one human sentence: "You pick your primary (13 to choose from), slot 2: a second weapon or a perk."
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
  Class chips are ON / ◐ partial (n/N) / OFF; a tile dimmed by a chip is still tappable (allows just that weapon). OPEN / NO HEAVIES / SNIPERS are starting templates
  inside the designer, not match-night choices.
- *(superseded)* **BUILD** — "LOADOUT RULES" panel under GLOBAL SETTINGS: preset Seg `OPEN · NO HEAVIES · SNIPERS · CUSTOM`,
  `PLAYERS PICK ON PHONE` toggle, per-slot rows (choice Seg + pool summary "15 OF 18 · NO HEAVIES" + fixed picker),
  CUSTOM exposes tag chips + per-weapon include/exclude.
- **KIT** — roster rows: live state (`PICKING…` / `TRYING SMG` / `READY ✓`) + two loadout chips. Detail: identity
  strip → **loadout rail** (PRIMARY / SECONDARY cards; secondary card cycles weapon | perk | empty) → arsenal for the
  selected slot (header carries the pool summary; out-of-pool tiles dimmed, no per-tile labels) → hero for the
  selected slot's item (perks: effects block instead of DMG/ROF/RNG). Fixed/off slots show a padlock and
  "SET IN BUILD". Tablet ≤ 900 px: roster becomes a chip strip, cards stack.

## 6. Tests / e2e (screen truth)
Server: policy presets + pool, `_check_loadout` matrix, compile (no slot 1 when empty; each perk effect on the
frames; golden bundle updated), `loadout_request` happy/reject paths with **delivery assertions** for `loadout_ack`
and the catalog in `assign`, all-ready advance, ready-ends-tryout. UI rig: Kit two-slot pick at desktop + tablet,
phone browser at 844×390 (+ short viewport), FFA hides heavies on BOTH UIs, snipers preset locks both, phone
TRY IT → MC roster shows TRYING → READY → MC shows READY.

## 7. Bench items (docs/bench-tomorrow.md)
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
