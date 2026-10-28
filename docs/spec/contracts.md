# Shared contracts (M-CONTRACTS) — the node↔MC wire and the game data model

- **Status:** Ratified (Wave 0, 2026-08-25) + amendments (the index in §10 is the list; do not restate the range
  here, it rots). Since 2026-09-06 the
  amendments are **folded into the body** where they apply, each tagged with its id (`A6.8`, `A11.7`, …) so the
  ids stay greppable. Changes are still amendments: add an index row in §10 and fold the text in.
- **Consumers:** every module (`mcp/brx_mcp/mc/`, `app/src/`, `webapp/mc/`). Bind to *these shapes*, never
  another module's internals. Field names are identical in `types.py`, `API.md`, `types.ts` and the phone engine.
- **Absorbed 2026-09-06:** the mechanism sections of the retired `net.md` (§5b store-and-forward, §7 clock, §8
  platform gates) and a short M-ARMORY note (§1.1). The originals are in `docs/archive/spec-net.md` and
  `docs/archive/spec-armory.md`.

Transport-agnostic where possible. JSON on the wire. All ids are opaque strings. Times are
**Unix ms** (`t`) unless noted; wall-clock coordination uses the synced clock in §7.

---

## 1. Identity & the armory

The permanent, bench-produced map. One record per gun. Lives in MC (`~/.brx-mcp/armory.json` today).

```jsonc
ArmoryRecord {
  gun_id:      string,   // stable internal id (e.g. headset PIN) — the primary key
  sticker:     string,   // physical label written as $NAME (e.g. "GUN-A" — real sticker ids never appear in the repo); advert = "<sticker>-<tail>"
  headset_pin: string,   // read over USB at enroll
  ble:         { address?: string, uuid?: string, tail: string }, // MAC (Android/Win) OR CoreBluetooth UUID (mac); tail = last 4
  gen:         "gen2_3" | "gen1",
  fw:          string | null,     // e.g. "v4.32"
  labeled:     boolean,           // physically stickered
  notes?:      string
}
ScanRow { tail, name, basename, gun_id: string|null, rssi, identity: "ok"|"unconfirmed"|"reverted"|"unknown", t }
```
- **`ble.address` is not portable across hosts/OS** (mac gives per-device UUIDs). Correlate by
  `sticker`/advert name, never a cached address. (iOS-findings §5.)
- Duplicate `sticker` is illegal (can't map two guns to one name).

### 1.1 M-ARMORY in forty lines (`mcp/brx_mcp/mc/armory.py`, `mcp/brx_mcp/usbconsole.py`)

Two jobs, one artifact. **Armory Setup** is one-time, per gun, over the USB Teensy console:
`python -m brx_mcp enroll <StickerId>` reads the USB identity (headset PIN, versions, voltages), binds the
BLE address by **isolation** (exactly one tagger powered, so the one advert is the one gun), writes `$NAME` =
sticker id (persists; the advert becomes `<sticker>-<tail>` on the next power-cycle), and marks it labeled. The
operator procedure is `docs/field-process.md`. **Scan** is per game, over BLE **adverts only**:
`scan(duration_s) → ScanRow[]` never connects, so it never competes with a phone for the gun's single central
and is safe to poll. `correlate()` rebinds each record's local address by advert basename, which is how an
`armory.json` enrolled on Windows self-heals on the MacBook (copy the file, scan once).

Interface MC composes: `list()`, `enroll(sticker)`, `rename(gun_id|address, name)`, `scan(duration_s?)`,
`bind_player(gun_id, player_id)` (validates only; the gun↔player link is session state on `Player.gun_id`,
never written back to the armory).

Rules and detectors:
- **Read-and-name only.** Armory Setup never writes the USB `PlayerID` or re-pairs a headset (FOLLOWUPS B7).
  Unnecessary since the per-match id goes over BLE in `$PSET` (§2).
- **Callsign wipes `$NAME`** back to `Tactix2` on connect. `scan()` flags an advert whose basename is `Tactix2`
  against a record that expects a sticker as `identity: "reverted"`; `name_confirmed` is the tripwire
  (`rename` clears it; a power-cycle + `scan()` flips it back). Never open Callsign on an enrolled fleet.
- **`$NAME` ≠ gamertag ≠ `player_num`.** The sticker is hardware identity; the gamertag is `Player.display`
  (MC display layer only); `player_num` is the per-match `$PSET` id.
- **No fleet reader.** MC never holds N BLE links to N guns (the 2026-08-24/25 sweep read battery on 1/4 guns
  and contended with the phones). Battery/firmware/headset come from the node (§4 readiness) [A4.9].
- **Headset gate.** Headset OFF drops the BLE link entirely (`$DISCONNECT`), so a live link plus the head echo
  IS the headset proof; a `$SPAWN` on a healthy headset echoes `$LCD,45,70,…`. Bench 2026-08-25
  (`docs/archive/session-findings-2026-08.md` §7r; `docs/experiment-log.md` 2026-08-25 late). Battery is **amber, not red**,
  when unsampled [A1].
- **Edge cases:** duplicate sticker → both rows red; unenrolled gun → `identity:"unknown"`, listed as unclaimed,
  never green; a gun that will not advertise (asleep, menu, flat) → red "not seen"; Gen1 (Bluetooth Classic)
  cannot be BLE-scanned → `identity:"manual"`, a hand-ticked checklist.
- Raw QUERY backups (`~/.brx-mcp/device-backups/`) and `armory.json` hold headset PINs: **never committed**.

## 2. People, teams, loadouts

```jsonc
Player {
  player_id:   string,       // session-stable
  player_num:  number,       // 1–63 — the gun's player id ON THE WIRE ($PSET token 1 / $HIR token 3, protocol §7p/§7q).
                             // Unique per match; MC assigns at kit-out. Displayed AS-IS (#1…#63). Wire 0 is RESERVED =
                             // "no identity" (tutorial arms, unknown/environmental shooter) and is never a player [A5.1].
  display:     string,       // vanity name the host types at kit-out (never written to the gun); trimmed +
                             // upper-cased, at most MAX_TAG_LEN (16), refused (never cut) past it; the
                             // console warns past SOFT_TAG_LEN (12) (F366)
  team_id:     string | null,
  node_id:     string | null,// the node currently bound to this player (§5)
  gun_id:      string | null,// assigned gun (ArmoryRecord.gun_id)
  loadout:     Loadout,
  voice:       "male" | "female" | string,  // sound-bank voice persona; the full pack is offered (GET /api/voices, compile.voice_options)
  voice_slots?: { [role]: sound_id },       // [A15] explicit picks for the `$PSET` voice fields (death_scream, respawn_cry, melee_grunt,
                             //   short_pain, long_pain, pain_relief) + `kill`; every id must be ON the gun (400 otherwise). Made on the
                             //   gun stage's soundboard. [A15.1] a field without a pick is ROLLED by MC from the family's pool on every push.
                             //   [A15.2] `respawn_cry` ships EMPTY (the firmware says nothing on $SPAWN); a pick here puts a firmware cry back.
                             //   [A15.3] so do `melee_grunt` / `short_pain` / `long_pain` (the node plays the pain by damage); a pick puts a
                             //   firmware pain back. `death_scream` stays the firmware's and is re-rolled per spawn (`pset_pool`) unless picked.
  ready:       boolean
}

Team { team_id: string, name: string, color: "blue"|"yellow"|"red"|"purple"|string, tid: number } // tid → $TID (LED colour + friendly-fire class); tid 3 is "purple" [A69, F423]: it paints purple, though it still fights as green ON THE WIRE (F35).
     // [A16.2] team COLOUR is decoupled from `$TID` (`poolgauge.display_colour`); FFA paints white; `$TID` is validated to 0..3.
     // `poolgauge.LED_PALETTE[3]` (the raw wire and LED palette) stays "green" on purpose. A preset, saved game or snapshot
     // that still says `green` migrates to purple on load.

Loadout {
  weapons: WeaponSel[],      // ordered; index maps to the gun's weapon slots: [primary] or [primary, secondary]. NEVER empty —
                             // a primary is required; an EMPTY slot 1 is legal (no $WEAP,1 / $AMMO,1; ALT falls back to reload) [A10.1]
  perk?: string | null,      // [A14.1] the PERK slot — a perk_id beside the weapons (AR + pistol + Fast Hands is a legal kit).
  overrides?: { max_hp?: number, max_armor?: number, easy_reload?: boolean }
                             // [S50] `easy_reload` is a per-player accessibility switch (ALT button = RELOAD), host-set only, not
                             // a perk pick. The one pairing the gun cannot do: `easy_reload` + a second weapon (loadout.md §2)
}
WeaponSel { weapon_id: string }   // references WeaponCatalog (M-MODES)

RosterEntry { player_id, player_num, display, team_id, weapons?: RosterWeapon[] }
                             // [A4.10] what nodes get (`assign.roster`, `config.roster`) so the HUD can name a killer. [S56 "what hit me", A52] `weapons`
                             // is that player's loadout in SLOT ORDER (index == gun slot); absent means an
                             // older MC, so the phone names no weapon. Compiled, not catalogue-only: a perk
                             // (Armour Piercing) moves the numbers, and `RosterEntry.weapons` follows it.
RosterWeapon { weapon_id: string, hir: number[], cells?: HirCell[] }
                             // [S56] the distinct `$HIR` token-5 magnitudes this weapon's words can carry
                             // (t5 `dmg`, t12 `headset_dmg`, t37 `tap`, each only when > 0), sorted, unique.
                             // A victim's `$HIR` fact carries only a raw magnitude, never a weapon id, so a
                             // phone matches it against the SHOOTER's roster row to name what hit it.
                             // [F315, A57] `cells`: the same words with the cell each one rides, one entry per
                             // `hir` magnitude, sorted by it, read from the compiled frame after any re-key
                             // (Armour Piercing, `--distinct-weapon-cells`). The phone matches cell + magnitude
                             // first. Absent = an older MC; the phone then matches `hir` alone.
HirCell { proto: number, subtype: number, mag: number }
                             // [F315] one `$HIR` word: the IR protocol (`$WEAP` t3, `$HIR` token 2), the subtype
                             // (t4) and the magnitude (t5, t12 or t37). All words of one `$WEAP` frame share its cell.

WeaponView.hir: number[]     // [S56] the same magnitude set, on the catalogue/kit-out `Weapon`/`WeaponView`
                             // shapes (`views.weapon_view()`), read off that weapon's own compiled `weap_frame`.
WeaponView.cells?: HirCell[] // [F315, A57] the same, with the catalogue frame's own cell. A match's re-key shows
                             // only in the roster's `cells`, never here.
```
- **≤ 63 players per match** (6-bit id, 0 reserved). `player_num` is *session* state, not armory state — the same gun
  gets a different number next game.
- **FFA** = one team (`tid`), friendly-fire ON, distinct `player_num`s. `$TID` is *only* team/LED; it is
  never used as a per-player identity [A4.1 retires the ≤4-player unique-`$TID` workaround of A3].
- **Native teams: four** (`$TID` masks to 2 bits; bench 2026-08-26). Beyond four, FFA + MC logical teams.
- **Loadout policy, sidearms, the perk slot** — the full rules are `loadout.md` [A10, A12, A14]. Summary:
  `GameConfig.loadout_policy` (presets `open`/`no_heavies`/`snipers`/`custom`, per-slot `choice`
  player|host|fixed|off + `kinds` + tag/id rules) is server-computed into `State.loadout_pool {primary,
  secondary_weapons, perks}` [A14.4 replaces `secondary_perks`]; `SlotRule.kinds` may be `"sidearm"` (pistols
  only) [A12.2]; Easy Reload and its conflicts are host-only (`loadout.md` §2.1 is canonical); a player's `ready` ends their try-out and kit → lobby
  auto-advances only when every rostered player is ready [A10.4].

## 3. Game config, frames, modes (authoring output of M-MODES)

`GameConfig` is the **complete, serializable description** of a match — the single object MC authors,
validates, and pushes. It MUST round-trip (author → JSON → frames) with no hidden state.

```jsonc
GameConfig {
  config_id:   string,
  mode:        "tdm" | "ffa" | "infection" | "lms" | "extraction" | string,
  environment: "indoor" | "outdoor",
  night:       boolean,               // [A16.2] a DIM, shorter-hold LED overlay. Only `presentation.blackout` empties the
                                      //   light tables, and the DOWN signal survives both.
  time_limit_s: number,               // REQUIRED and > 0 on the phone path [A4.8]: the only end condition
                                      // that reaches a dispersed node. (null allowed only when validate()
                                      // is told the venue is fully LAN-covered.)
  respawn:     { type: "auto"|"scanner"|"none", delay_s: number, gate?: "trigger"|"presence",   // gate: A13.1 (scanner only). NODE-SIDE
                 // ONLY: the node reads it (default trigger); MC has no `gate` field (types.Respawn) and drops it at PUT /api/config
                 protect_s?: 0|1|2, weapon_delay_ms?: 500|1000|1500|3000, station_protect_s?: 0|2|3 },  // [A49, A74] defaults 0 / 1500 / 2
  stations?:   [ { id: number, kind: "respawn"|"powerup"|"extraction"|"bomb"|"control",          // A13.1: the utility items valid in this game
                   item?: StationItem } ],   // [A56] a powerup station's item and schedule, the same object as
                                      //   `StationAssignment.item`: {kind: "weapon"|"overshield"|"ammo", weapon_id?, charges?, amount?,
                                      //   refill?, spawn_every_s, first_at_s, name, color} (A76: `refill: "spawn"` on ammo). Design and
                                      //   defaults: docs/spec/powerups.md.
  powerups?:   [ { weapon_id: string, slot: 2|3 } ],   // [A56] the pickup weapons armed at start (empty magazine, out of
                                      //   the ALT cycle); absent = none, or MC runs with `--no-powerups` (F372: on by default)
  game_byte?:  number,                // [A59] 1..255, the advert `game` byte MC arms its stations with this match
                                      //   (= station_config.game). Derived in `_wire_config`, never set by the operator.
                                      //   A player phone scopes presence and its own advert by it; absent (an older MC) = 0, any game.
  scoring:     { frag_limit: number|null, win_by: "kills"|"survival"|"objective" }, // frag_limit / survival ends are LAN-covered-only [A4.8]
  health:      { max_hp: number, max_armor: number, max_shield: number,
                 preset: "standard" | "shields" | "hardcore" | "custom" },
  // [A50, S45, weapon-design.md §7.3] `max_shield` IS the $PSET t5 CAPACITY now (a host field where there
  // used to be none — the compiler armed a fixed 70 on every game, preset or not); the pool itself
  // is 0 after $SPAWN and fills from an IR fn-11 grant or, over BLE, from $LIFE,0,0,<n>,* (bench-proven
  // 2026-09-11). F348: in a shields game the node's spawn and revive bursts end with that fill to the ceiling. `preset` is DERIVED, never authoritative on its own — `compile.resolve_health_preset()`
  // re-reads it from the three numbers on every PUT, mirroring `LoadoutPolicy.preset`. Named presets:
  // Standard 45/70/0 (no shield at all — the old free-for-everyone constant is gone), Shields 45/0/105
  // (armour 0 is what turns the S29 recharge on; 45, not 30, because armour piercing ignores the
  // shield too — §7.3), Hardcore 45/0/0. Per-player `loadout.overrides.max_hp/max_armor` still apply
  // on top of whichever preset the game carries; there is no per-player shield override (shield is a
  // fact about the game's design, not a handicap). A `health` patch missing `max_shield` entirely (a
  // saved game from before this field existed) loads as `preset: "custom"` — its shield intent is
  // unknown, never guessed at.
  teams:       Team[],
  led?:        object,                // indoor/outdoor/night LED customization (modes.md §6)
  loadout_policy: LoadoutPolicy,      // A10.2 — loadout.md §3
  presentation?: Presentation,        // A11.1 — below
  player_num_base?: number,           // A6.5: first player_num this session hands out (default 1). Two concurrent games on one
                                      // field use disjoint ranges (e.g. 1 and 32) — $HIR carries no match id.
  mode_params?: { [name: string]: number | string | boolean },   // [A18] the MODE's own rules — below
  vip_player_id?: string | null,      // [A19] who the VIP is; must be on the roster (validate()); MC pushes them the `vip`
                                      //   headset role via `alert.role` once live and after each of their respawns. Never in a saved game.
  stun?: { duration_s?: number },     // [A20] the host-driven STUN (EMP). Present = the `<8,0>` $SIR cell ships as fn 23 (P18/F253:
                                      //   fn 24 was tried first and shipped a phantom hit every 5.07 s; fn 23 drops the victim's
                                      //   live accuracy to 0 with no pool moved, and it recovers on its own) and a proto-8 $HIR
                                      //   disarms the victim's node for duration_s (default 10, 1..60). Absent = the stock
                                      //   charge-rifle damage row, byte-for-byte. Source: a $WEAP t3=8 slot (the charge rifle)
                                      //   or a proto-8 station. node.md §3.12.
  volume?:     number | null,         // [K8] the match head's $VOL, an integer 60..100 (on-gun L1..max). Absent or null = the
                                      //   venue volume (80 indoors, 90 outdoors); anything else is a 400. A saved game keeps it.
                                      //   MC's --bench-volume overrides it and try-outs; without that flag a try-out
                                      //   plays at 69, never this value.
  hill?:       {capture_s?: number, net_cap?: number} | null,  // [A77, F559] a control station's capture time (3..60 s) and
                                      //   net cap (1..6). A set key rides every station_config to a control station
                                      //   and wins over a station-side edit; an absent key keeps the station's own value.
                                      //   A mode change carries it, like volume; a game piece does not store it, but a favourite does, through the pick's
                                      //   `match.hill` (KOTH only, `MatchSettings`; the PLAY strip's HILL item sets it).
  // Six more fields ride here; types.py `GameConfigBase` is the full list and the comments there are canonical:
  siphon?:     { hp: number, armor: number },   // S14 heal-on-kill. Typed only: compile and the node do not act on it yet (modes.md §2)
  respawn_auto_teams?: number[],      // derived: teams with no station fall back to timed AUTO respawn
  station_source?: string,            // [F70] what emits the objective ("grenade" | "ir_station"); objective modes only
  coverage?:   "full" | "partial",    // [A31, A4.8] the venue's radio coverage
  recoil?:     boolean,               // [A48, S42] node-driven recoil; absent or true = on (node.md §3.15)
  hit_audio_class?: boolean, hit_audio_rekey?: boolean,   // [A17] per-weapon $SIR sounds; both default off
}
```

**`assign.game.mc_verify` [A31]: the "verify at MC" line.** The briefing `game` in `assign` carries one compiled
line (`compile.mc_verify`) when three things hold. MC decides the end (a `frag_limit`, an objective `win_by`, or
LMS or infection). The venue is not full coverage (`compile.full_coverage`: `opts.coverage` wins, then
`coverage`; absent = partial). At least one rostered phone has no backhaul (`state.py _off_grid`). The phone shows
the line on its ARMED screen. Presence is the rule: no key, nothing to show. The host's copy, which names the
off-grid phones, is `State.notices.mc_verify` (`mc/API.md`).

**`GameConfig.mode_params` [A18, E1] — the mode's own rules, declared by its engine.** The wire config used
to be mode-agnostic (`mode, health, respawn, scoring, teams, loadout_policy, presentation`), so an objective
mode's knobs lived only in the CLI dataclass and could not be set from MC at all
(`docs/archive/mode-extensibility.md` G1). Now each engine (`mcp/brx_mcp/modes/*.py`) declares a `PARAMS`
class attribute — `{name: Param(type, default, desc, lo?, hi?, choices?)}` (`modes/params.py`) — and
`modes/registry.py` maps a mode name to its engine, so ONE table answers "what may `koth` be told?". Rules:
- **The schema is served, not duplicated:** `GET /api/modes` → `params[]` (`{name, type: int|float|bool|str,
  default, desc, min?, max?, choices?}`). A UI renders controls from it; it never keeps its own list of knobs.
- **Present and COMPLETE, or absent.** `default_config(mode)` carries every default for a mode whose engine
  declares any (`koth`: `score_target`, `points_per_s` · `lms`: `lives` · `extraction`: `channel_s`,
  `win_target`, `loot_per_kill`, `drop_policy`, `extract_removes_player`); `tdm`/`ffa`/`infection` declare none
  and carry no key, so their configs are byte-identical to before (a saved game's identity is the whole config).
  A partial `PUT` merges onto the current values and stores the resolved set, so the wire form is
  self-describing and a node needs no schema to read it (§3's "no hidden state").
- **Refused, never dropped or clamped:** an unknown key or an out-of-range value is a `400` at `PUT
  /api/config` and an error from `validate()` (belt and braces for a fixture / CLI / stale preset), in the
  operator's voice naming the mode's real parameters. A mode with no params refuses ANY key ("a control that
  does nothing"). `control_points` is deliberately not a param (F88: a beacon carries no station id).
- **The engine reads them** (`params.resolve(cls, config)`), from `mode_params` on the wire form or the same-
  named attribute on the CLI dataclass, so the CLI/sim path is unchanged. `registry.register_mode(name, cls)`
  is the E2 seed: a registered engine is buildable and its schema/validation light up from that one call (the
  MC catalog row, presentation preset and scorer are still hand-registered — E2's other half).
- **The phone reads `config.mode_params` as-is** (the TS `GameConfig` type carries it); no phone-side
  consumer exists yet — the field is the contract the HUD's objective ladders will read.

**`GameConfig.presentation` [A11.1, A11.5, A11.6, A11.7, A11.8]** = `{ preset: standard|silenced|counter_strike|vip|
infection|last_stand|extraction|custom, announcer, voice, gun_flash, headset_team, sight_flash, hud_events, mc_events,
mc_confidence, headset, gun, events: { <event>: { sound?, gun_led?, headset?, flash?, slot? } } }`
**[A21] `slot` = `"queue"|"interrupt"|null`:** `$PLAY` token 1 interrupts what the gun plays, token 4 queues behind it, whatever
the id. `play_frame()` keeps the default (V-family ids to token 4, the rest to token 1); an explicit `slot` overrides it, and
`voice:<role>` sounds always queue. A queued tick's cadence must be at least the clip length. `merge()` refuses a bad value (400).
(`mcp/brx_mcp/mc/presentation.py`). A preset name replaces the profile; any field edit makes it `custom`. `sound`
must be an id physically on the gun (`data/sound_catalog.json`, read off the hardware 2026-09-03); colours are the
shared 9-entry palette. Mode defaults (`MODE_PRESET`): `cs` → `counter_strike`, `infection` → `infection`, `lms` →
`last_stand`, `extraction` → `extraction`; everything else `standard`. Validated in `PUT /api/config` [A8.3].
- `announcer:false` mutes the announcer + objective groups only (the player's own low-health alert and the
  countdown stay), except the five hill sounds, which are game information and no switch mutes (F463); `gun_flash:false` empties `leds`; `headset_team:false` removes the `$HLED` team-colour frames
  from `spawn`/`revive` and blanks `cues.team_led` [A11.2].
- **`voice`: `"on" | "hits_only" | "off"`, default `"on"` [A22].** Gates the player's OWN voice lines --
  independent of `announcer`, which gates MC/announcer feedback, not these. `"hits_only"` keeps the three
  pain cues; `"off"` drops those too. Both drop the spawn line (`cues.spawn` on the first life, `cues.respawned`
  on every revive after it -- the same line, played at a different moment). The native death scream and the
  material hit sounds are unchanged in all three; the node is unchanged. The `silenced` preset sets it `off`;
  every other preset keeps `on`.
- **Two event classes [A11.5].** Every event carries a `source`: **`hud`** (the node fires it from its own gun or
  clock: hits, death, respawn, pool gains, low health, clock callouts, the extraction ladder, its own infection
  turn), **`mc`** (only MC can know it: kill credit + medals, lead, next-kill-wins, last survivor, objective/VIP
  callouts) or **`both`**. `hud_events` / `mc_events` mute a class, except the five hill sounds, which are game information and no switch mutes (F463); **`mc_confidence`** (default on) lets MC push a
  GLOBAL-STATE event (`lead_taken`, `lead_lost`, `next_kill_wins`, `last_survivor`) **only while every rostered
  HUD has a live socket, was heard within 6 s and has nothing left to flush** (`Session.mc_confidence()`);
  otherwise the event is withheld and logged WITHHELD, never queued. `GET /api/presentation` returns the resolved
  rows for the MC's read-only ADVANCED view.
- **The headset [A11.6]** `presentation.headset = { pregame: team|off, start_flash, in_play: dark|team, hit:
  colour|null, death: native|colour, respawn_flash, carrier }`, defaults team / on / **dark** / null / **green
  blink** / on / on. `hit: null` = native (the firmware's own hit flash is far brighter than any BLE frame, so the
  node paints nothing). `death: native` writes nothing, and in a hosted game the firmware's own out-blink does
  NOT fire once the node has taken the headset, so the default is OUR green slow blink, re-asserted while a
  scanner-respawn player stays down.
- **The gun body [A11.7]** `presentation.gun = { in_play: native|team|dark|health, pregame: team|off }`, defaults
  `team` / `team`. Bench 2026-09-04: a spawned gun BREATHES its team colour and a plain `$GLED` only alternates
  with it, but **`$GLED,,,,5,,,*` (the blank) takes the LED out of the breathing loop** and any colour painted
  after it HOLDS; `$SPAWN` re-enables the breathing. So team / dark / health ship `bundle.gun` with `take` =
  `[blank, rest]` and `after_spawn_s` (2.5): the node writes `take` that long after every `$SPAWN`.
- **The headset's small flash LED [A11.8]** is a separate GREEN-ONLY LED driven by `$LED,9,1,1,1,*`.
  `events[ev].flash = green|null` puts that frame FIRST in `leds[ev]`; default green on the kill family.
  ⚠ **Event flashes only.** A11.8 also used this LED to imitate a death flash by pulsing `$LED` from the
  node; **A16 deleted that** (§4 `FrameBundle.headset.down`). The firmware runs its own out-flash and we were
  switching it off with an `$HLED,,6` rest frame; the down signal is now `$HLOOP`, driven by the firmware at
  native brightness. Nothing in play may send `$HLED,,6`.

**Frames are compiled by MC (M-MODES, Python) and shipped to the node as data — nodes never compile
or invent frames [A4.2].** The one frame authority is `compile.py` (over `gameconfig.py`) + its tests; the phone
(JS) and the Companion (C++) are verbatim frame writers.

```jsonc
FrameBundle {                       // per (config_id, player_id); pushed in `config`, re-pushed on assign change
  config_id, player_id,
  dual_emitters?: object[],          // paired body/headset emitter cells used to group one physical pull
  head:    string[],   // config head: $VOL → $CLEAR → $START → $GSET → $PSET,<player_num>,… → $WEAP×n → $SIR×n → $BMAP×n (trigger row HELD as $BMAP,0,98 until T-0, bench 2026-09-16) → LED frames → $TID,<tid> (last).
                       //   NO $SPAWN, NO countdown/start sound — written at lobby, the gun then sits unspawned (M-START).
                       //   The head write is SILENT on the gun (bench 2026-08-25, protocol §7r): the voice + cock belong to $SPAWN.
  spawn:   string[],   // go-live tail at T-0: $PLAYX,0 → $SPAWN,, → $TMP,,,,,,,,-100,,,,* → $TID → $AMMO per slot → $BMAP,0,0   [A23, A44; F121 rebuild 2026-09-18: no $SIR row]
  revive:  string[],   // respawn: $SPAWN,, → $TMP,,,,,,,,-100,,,,* → $TID (+ loadout-correct $AMMO) → $BMAP,0,0 (a live resync re-writes the held head first)   [A23, A44]
                       //   Spawn protection is $TMP t8 = -100: hits register ($HIR, $HP) with 0 damage (levers §23, bench 2026-09-18).
                       //   The order is fixed: $SPAWN zeroes every $TMP token, so t8 must follow it. The $SIR table survives
                       //   $SPAWN and death (only $CLEAR zeroes it), so neither list carries a $SIR row.
  spawn_protect_off?: string, // "$TMP,,,,,,,,0,,,,*": on the legacy path the node writes it on the gun's first shot, or
                       //   SPAWN_PROTECT_MAX_MS (2100 ms) after the spawn/revive write. With `respawn_profile` it writes it
                       //   when the profile's protection window ends. Always at a rejoin reconcile end or an operator resync.
                       //   Absent = an older bundle (the fn-28 twin rides spawn/revive); the node keeps that path.
                       //   `spawn` and `revive` above are the LEGACY lists: an app before 0.4.3 plays them. An app from
                       //   0.4.3 plays `respawn_profile` when the bundle carries it.
  respawn_profile?: {  // [A49] the respawn profiles (Tony, 2026-09-19). Field problem: a protected player's headset flashed
                       //   "hit" and took no damage, so shooters thought the game was broken, and the respawner could fire.
    protect_ms, trigger_ms, station_protect_ms: number,
    spawn:   string[], // GO-LIVE (T-0): $PLAYX,0 → $SPAWN,, → $TID → $AMMO → $BMAP,0,0. No t8, whatever the settings: at match
                       //   start everyone is equal. The node writes one live `sir_pool` take at T-3 s while the head still
                       //   holds every trigger (a late start puts it in front of $SPAWN), so every player is hittable and
                       //   can fire at go-live. The node arms nothing after it.
    revive:  string[], // TIMED respawn (in place; also an operator respawn and a turned player): $SPAWN,, → [$TMP t8 -100 when
                       //   protect_ms > 0] → $TID → $AMMO → $BMAP,0,98 (trigger HELD). The node writes `trigger_live` at
                       //   trigger_ms and `spawn_protect_off` at protect_ms, measured from when the revive burst is sent, not when it is
                       //   queued (F493). A queued life burst is never dropped, and a zero pool read while it waits is not a death. trigger_ms = max(weapon delay, protect_ms + 500
                       //   when protect_ms > 0): nobody fires while protected. A shot never ends protection.
    revive_station: string[], // STATION respawn (a scanner revive at a respawn station): $SPAWN,, → [$TMP t8 -100 when
                       //   station_protect_ms > 0] → $TID → $AMMO → $BMAP,0,0 (trigger LIVE, the spawner may clear
                       //   campers) → [shield_on]. At station_protect_ms the node writes `spawn_protect_off` then
                       //   `shield_off`. A shot never ends it. A registered hit repaints the shield (at most every 500 ms).
    team_flip?: { [tid: string]: string[] },   // infection: the flip bursts, timed profile
    trigger_live: string,   // "$BMAP,0,0,,,,,*"
    shield_on: string,      // a white $HLED blink for the window ("" when station protection is 0 or LEDs are off)
    shield_off: string,     // the headset's in-play rest frame
  },
  end:     string[],   // game-over teardown (END_SEQUENCE)
  panic:   string[],   // ["$CLEAR,*", "$SP,99,*"]
  team_flip?: { [tid: string]: string[] }, // infection: frames to move THIS gun to another team mid-match
  team_flip_take?: { [tid: string]: string[] }, // F86 (2026-09-11): per-tid [blank, rest] the node takes the gun body with after a flip -- `gun.take` is compiled for the ARMING team, so a flipped gun must not be re-taken with the old colour
  cues: { countdown: string, kill: string, game_over?, victory?, tick?, klaxon?, multi?, medal?,
          hurt?, hurt_led?, runway_30?, runway_20?, runway_10?, team_led?,
          // A11.2: one key per presentation EVENT that carries a sound — the medal kinds (every `types.MEDALS` key
          // with a clip; A61: every medal has one, 2 to 8 voiced), match state (lead_taken, lead_lost,
          // next_kill_wins, last_survivor, infected, survivors_win, victory, game_over), objectives
          // (objective_taken, objective_scored, flag_returned, point_captured, hill_captured, bomb_planted,
          // bomb_defused, bomb_detonated, vip_hit, vip_down), the King of the Hill sounds the NODE plays (hill_captured, hill_lost,
          // hill_contested, hill_moved, hill_tick: all five are ungated, no presentation switch mutes them; F463, only a row's own `sound: null` does), the player's own (hit_taken, died, respawned,
          // healed, armour_up, shield_up, low_health), the S29 shield recharge the NODE drives (shield_down,
          // shield_charging, shield_online, and shield_loop, which the node REPLAYS on its own length while the
          // shield is gone), reload_nag, the clock (time_60, time_30, time_10) and the extraction
          // ladder (extraction_called/open/alert/closing/complete/failed/tick, loot_picked, loot_dropped,
          // raid_ending, raid_over) — the full list is `presentation.EVENTS`. "" = deliberately MUTE
          // (announcer off): the node skips the sound but still flashes.
          [k: string]?: string },
  leds?: { [event: string]: [frame: string, hold_s: number][] },   // A11.2: the tuned $GLED burst (3 flashes back to
                       // the team colour; hardware-tuned 2026-09-03) + optional static $HLED, per event. Written
                       // verbatim with the holds; the node never repaints inside a burst and never plays two
                       // bursts inside one second. A static $HLED step is skipped while the player is DOWN (the
                       // out-blink owns the headset) and yields to any later headset sequence (hit flash, death).
                       // Absent/empty = no lights for that event (night, blackout, or the profile's gun_flash=false).
  presentation?: { preset, announcer, gun_flash, headset_team, sight_flash, hud_events, mc_events, mc_confidence,
                   custom_events, headset: { pregame, start_flash, in_play, hit, death, respawn_flash, carrier },
                   gun: { in_play, pregame } },   // A11 summary echo
  gun?: { in_play: "team"|"dark"|"health"|"native", blank: string, rest: string,   // A11.7/A16: the gun BODY when the game owns it
          readout?: { hold_s: number, reload_glance_s: number,   // A16: the TRANSIENT pool bar. [A16.4] The rest is the TEAM
                      // colour at DIM (`poolgauge.team_frame(..., dim=True)`, token 5 = 1); the readout paints FULL. That
                      // brightness gap separates a settled bar from the rest (F56); at NIGHT both are dim, so there is none.
                      lead_ms, blink_gap_ms, step_ms, blink_ms: number,   // A16.3: the drop animation's timings
                      min_gap_ms: number,                 // A16.3 SAFETY: a change inside this window skips the
                      // lead freeze and the all-off blink and steps straight down from where the strip is.
                      // Each all-off is a dark->lit transition; automatic fire is a burst of drops inside one
                      // second, and replaying them all would break the 3-light-ups-per-second ceiling.
                      // A16.3 [2026-09-07]: `levels` is SEVEN entries per pool, index 0..6, each
                      // [solid_frame, blink_frame|null]. A partial level (5/3/1) carries a blink frame = the
                      // same paint with its TOP segment dark; the node alternates the two at `blink_ms` so that
                      // segment blinks. Brightness on this hardware is GLOBAL (one token for all three LEDs), so
                      // a half-step CANNOT be a dim segment and must be a blinking one — measured on a gun.
                      // Node: level = clamp(round(fraction*6),0,6), floored to 1 while the pool is above zero;
                      // animate from the DISPLAYED level (show it for lead_ms, all off for blink_gap_ms, then one
                      // level per step_ms), settle, blink if partial, hold, revert to rest. A change mid-animation
                      // cancels and restarts from what is displayed; never queue two.
                      pools: [{ pool: "shield"|"armor"|"health", max: number,
                                bands: [fraction_above: number, frame: string][],
                                levels: [solid: string, blink: string|null][] }] },   // A16.3: EXACTLY 7, index 0..6
          // A16 [2026-09-07]: outermost pool FIRST (shield, armor, health); bands highest first; frames are 3/2/1 lit
          // segments in the pool's hue (shield TEAL, armour PURPLE, health GREEN/YELLOW/RED). MC ships each `max`
          // so the node never parses a frame. NODE RULE: on every $HP paint the band of the INNERMOST pool that
          // moved, write only on a frame change, coalesce changes inside 300 ms, restart the hold on every change,
          // and write `rest` when it expires. A reload repaints the last moved pool for `reload_glance_s`. An event
          // burst ends on the live readout frame if its hold is running, else on `rest`. Nothing is written to the
          // body during the 2.5 s hands-off window after $HP,0. [A16.5] An emptied pool HANDS OVER inward
          // (`poolgauge.handover_pool`): the drain animates to level 0, then the readout paints the next inward pool
          // that still has value. Health hands over to nothing (death). An EMPTY `$GLED` colour token is RED (0), not
          // "keep this LED", so blink frames write all three colours. Segments render per-LED only AFTER the blank
          // (bench 2026-09-04/07); a dark paint with no prior blank leaves the firmware breathing.
          // ⚠ The old whole-strip `bands` below is kept for older nodes.

          after_spawn_s: number, take: string[],                           // team). The node writes `take` (blank, rest) after_spawn_s
          bands?: [fraction_above: number, frame: string][] },             // after every $SPAWN. Absent for "native" (opt-in).
                                                                           // health: the node paints the first band whose
                                                                           // fraction hp/max exceeds, on band change + after bursts.
  headset?: { in_play: "dark"|"team", rest: string, blank: string,        // A11.6: the node's headset sequences, each a
              pregame: string[],                                          // list of [frame, hold_s] ending on an explicit
              start: [string, number][], hit: [string, number][],         // state frame. `rest` = the in-play frame the node
              death: [string, number][], respawn: [string, number][],     // returns to after every flash ("" never; dark or
              carrier: { [tid: string]: [string, number][] },             // team). death [] = the "native" opt-out.
              // A16 [2026-09-07, bench]: `rest`/`blank` are DARK BY COLOUR (`$HLED,9,0,,,10,,*`). ⚠ `$HLED,,6`
              // (effect 6) DISABLES the firmware's own death-flash loop for the rest of that life, so it is a
              // TEARDOWN frame only and must never be written in play; a colour write does not suppress it.
              down: { rearm: string, stop: string, rearm_after_ms: number },
              role?: { carrier, infected, vip, beacon, extracted: [string, number][] } },
              // A16: HELD role states the node re-asserts after every registered hit (a hit wipes the headset) and
              // clears on death. `carrier` is WHITE, never the flag's team colour — team colours are identity.
              // `infected` is the infected team's colour, `vip`/`extracted` solid white, `beacon` an orange blink.
              // ⚠ `vip`/`beacon`/`extracted` have NO trigger reaching the node yet (FOLLOWUPS S10 sub-item).

              // A16: the DOWN indication is the FIRMWARE's own bright flash (~0.75 s on the small LED), which
              // runs in a hosted game on its own. The node writes NOTHING to the headset at death; at
              // `rearm_after_ms` (2500) it writes `rearm` ONCE ($HLOOP,1,2500) as insurance for any life where a
              // blank slipped through, and `stop` ($HLOOP,0,0) before a revive ($SPAWN also clears the loop).
              // Present even when LEDs are off/blackout: it is the one signal other players must read.
              // This REPLACES A11.8's `death_flash` ($LED pulsed by the node at 750 ms, ≥2× dimmer, ~80 writes/min).
  // hurt/hurt_led = the victim-side low-health alert ($PLAY,VA8B + $HLED), fired ONCE PER LIFE
  // when HP drops BELOW 15 (A17.2, `engine.js LOW_HEALTH_HP`), independent of armour. It used to fire
  // when armour reached 0 and HP started dropping -- Callsign's own condition, byte-identical to
  // (protocol/captures/raw/2026-08-23-two-tagger-combat.btsnoop @340.5s, @361.5s) -- but that fires on
  // the FIRST health hit of a life, at 44/45 HP, so an alert named "low health" meant "armour failed".
  // `*_led` cues are $HLED, not $PLAY — every cue is still a complete frame written verbatim.
                       // A6.3: values are PRE-COMPOSED `$PLAY,…,*` FRAMES (slot placement decided by the compiler), e.g.
                       //   countdown: "$PLAY,VA81,4,6,,,,,*", kill: "$PLAY,,4,6,VAA,,,,*". Open map; a missing key is skipped, never guessed.
                       //   A $PLAY needs tokens 2-3 = `4,6` to be audible; the empty-token form is SILENT (bench 2026-08-25), so
                       //   there is no token-1-only SFX form (retracts the A5.10 note).
  swap_ms?: int,                     // 2026-09-04 (additive): the swap delay the gun enforces between slots 0/1 = max $WEAP tok15 after perks (850 stock; Fast Hands 425). The HUD's SWITCHING takeover runs for exactly this; older MCs omit it and the node assumes 850 × perk
  cue_pools?: { [event]: string[] }, // [A15.1] VARIETY: for an event whose sound is `voice:<role>` with several takes (kill = 3 kill confirms + 2 taunts,
                                     //   pain = 6), every frame it may play. The node picks ONE at random per event; `cues[event]` stays the
                                     //   deterministic first for a reader without pools. Absent for single-line roles and muted events.
  pset_pool?: string[],              // [A15.3] one full $PSET per death-scream take (only the deathScream token differs). The node writes ONE of
                                     //   them at random IMMEDIATELY before every $SPAWN (spawn and revive, same write), so the firmware screams a
                                     //   different take each life -- the scream stays native because our own $PLAY on the death landed a BLE hop
                                     //   late ("a little off", Tony, bench 2026-09-06). Re-sending $PSET mid-game keeps $SIR, does not heal, the
                                     //   gun still fires (all bench-verified). A pinned `death_scream` = one frame = head[4].
                                     //   [A17] each take ALSO carries its own hitHp / hitArrmor / hitShield / hitCrit draw
                                     //   (`hitaudio.MATERIAL_POOLS`), so the write that re-rolls the scream re-rolls what a hit
                                     //   on each POOL sounds like -- metal for armour, body for health, energy for shield.
  sir_pool?: string[][],             // [A17, A44] one full LIVE $SIR table per take; the rows differ ONLY in their sound tokens.
                                     //   A44: the ONLY carrier of the live table. One take (the fixed table) when class sounds are
                                     //   off, the rolled takes when on. The node writes ONE take in the same write as, and in front
                                     //   of, `spawn_protect_off`, but only when the gun's table may not be the live one (after any
                                     //   head or $CLEAR, an app restart, a rejoin reconcile, an operator resync) or class sounds are
                                     //   on. Otherwise the table from the last life stands. Re-sending $SIR rows is the F11 REPAIR path.
                                     //   Empty/absent with live rows in `revive` = a pre-A44 bundle; the node keeps the old path.
                                     //   [S57] every mode's table (not only the objective/hill ones) carries the silent
                                     //   `$SIR,15,0,,28,0,0,1,,*` beacon/callout row -- see `head` above and `callout_team` below.
  hit_audio?: { rekey: bool, cells: {[weapon_id]: "proto,sub"}, classes: {"proto,sub": family},
                shared: string[], material: string[] },   // [A17] what this gun was actually armed with, for the UI and the bench
                                     //   probes (F37/F38/F39). `rekey` false = nothing was moved off its stock cell (the default);
                                     //   `shared` names the families that had to share a cell and therefore share a clip.
  voice?: { id, family, pset: {role: id}, kill, rolled: {role: id}, pools: {role: string[]}, spawn: string[],
            pset_pool: string[], pain_long_min: int },
                                     // [A15] what the head's $PSET holds per voice field and the kill line; [A15.1] `rolled` = the fields MC drew
                                     //   from `pools` for THIS push (death scream, short pain); explicit `voice_slots` picks never roll.
                                     // [A15.2] THE SPAWN LINE IS OURS (bench 2026-09-06): `pset.respawn_cry` is "" -- an empty battleRespawnCry
                                     //   makes the firmware play NO voice line on $SPAWN -- and the node writes `cues.spawn` (one of
                                     //   `cue_pools.spawn`, a fresh random take per spawn; `voice.spawn` lists the ids) IMMEDIATELY after the
                                     //   spawn / revive frames, in the same write. `events.respawned.sound` defaults to `voice:spawn`.
                                     // [A15.3] THE PAINS ARE OURS (bench 2026-09-06): `pset.melee_grunt` / `short_pain` / `long_pain` are "" (a
                                     //   $PSET with the voice fields empty still registers hits) and the node plays `cues.pain_*` / one of
                                     //   `cue_pools.pain_*` on each $HIR, the pool chosen by the hit: proto 13 (melee) -> pain_melee; damage
                                     //   >= `voice.pain_long_min` (40: shotgun, snipers, power weapons) -> pain_long (slots E F);
                                     //   else pain_short (G H D C). At most one pain line per 600 ms; none on the lethal hit. `events.hit_taken`
                                     //   keeps no sound of its own. `voice.pset_pool` lists the scream id per `pset_pool` frame.
                                     // [A17.1] The pain line plays only when the hit reached HEALTH (`engine.js _pain`, A16's
                                     //   `movedPool`). A hit that armour or shield absorbs plays the gun's material sound instead.
                                     // [A17.3] The damage that sizes the pain is the TOTAL pools lost (hp + armour + shield), not
                                     //   the health part and not $HIR token 5. A hit that breaks through armour is a long pain.
  perk_effects?: { perk_id: string, mag?: ValuePair, reserve?: ValuePair, reload_ms?: ValuePair,
                    swap_ms?: ValuePair, max_hp?: ValuePair, max_armor?: ValuePair, max_shield?: ValuePair },
                                     // [S50 build 4] this player's compiled perk effect (loadout.md §1.2/§2), absent when they
                                     //   carry no perk. ValuePair = { base: int, resolved: int }; a field is present only when
                                     //   the perk actually moved it, `perk_id` present whenever they carry one (for an icon even
                                     //   with nothing else to show). `Compiler.perk_effects_resolved()` is the ONE arithmetic
                                     //   both this bundle (persisted, survives an app restart) and Mission Control's
                                     //   `State.perk_effects` (per player, the console's copy of the same numbers) read, so the
                                     //   node and the console can never disagree about what a perk did.
  dot?: { [ir_proto: string]: { weapon_id: string, per_tick: int, tick_ms: int, duration_ms: int } },
                                     // [S16] the damage-over-time table for THIS GAME, keyed by the IR protocol the shooter's
                                     //   `$WEAP` t3 puts on the wire (`$HIR` token 2). Game-wide, not per loadout: the victim
                                     //   needs the SHOOTER's numbers. `Compiler.dot_table()` builds it off the match plan and
                                     //   refuses a plan where another weapon shares a poison protocol. Absent = no such weapon.
                                     //   The rules the node runs with it are `node.md` §3.17.
  callout_team?: int | null,        // [A54, S57] the IR callout bus (docs/ir-callouts.md). The smallest team id in
                                     //   0..3 that no player in this match holds, or null when all four are in
                                     //   use. Every player's dead-man IR callout word (protocol 15, magnitude
                                     //   21-28) carries this team, so a receiving phone hears it without it
                                     //   ever landing on a real team's own id; null falls back to the victim's
                                     //   own team. `Compiler._callout_team(teams)`, same value for every
                                     //   player's bundle in one match, unaffected by friendly fire.
  emp?: {cooldown_s: int, duration_s: int},   // [A79] the hidden EMP perk. Present on EVERY bundle of a match where a
                                     //   player holds it (`perks.json` `emp`), absent otherwise. The holder's phone
                                     //   throws a host `$IRTX` on <8,1> on LEFT and waits `cooldown_s` on the match
                                     //   clock; a victim's phone runs the F15 stun for max(`duration_s`, SMOKE_MS = 6 s)
                                     //   on a `$HIR` there, never from a teammate (team match) and never inside spawn
                                     //   protection.
                                     //   Every live table then carries `$SIR,8,1,,23,0,0,1,,*`.
}
```
- **Volume** is the compiler's: the head carries `$VOL,<compile.head_volume(config)>`, the game's `volume` when set,
  else the venue volume `compile.play_volume(environment)` = **80 indoors / 90 outdoors** (`--bench-volume`
  overrides both) (field-corrected 2026-08-30: 69, the old default and iOS Callsign's value, measures as on-gun level
  2 and was inaudible outdoors); **try-outs stay at 69** (`VOL_TRYOUT`, fired at arm's length from the player's own
  head); the diagnostic default `30` is inaudible for game audio and stays a bench value only.
- **`$GSET` token 2 is always `0`**, independent of `environment`, in game heads, try-outs and utility paths.
  Field testing on 2026-09-13 showed that `1` cripples hit reception on the receiving gun. The gun's native ALT
  mode is a different control, and the theory that t2=1 rejects indoor reflections is untested. Venue still drives
  volume, presentation and the operator's physical-mode step.
- The node owns exactly **two literal templates** and nothing else: `$SFLASH,*` and `$PLAYX,0,*`
  (`app/src/engine.js`'s exported `SFLASH` / `PLAYX`; [A6.3] — `cues` are pre-composed frames, so there is no `$PLAY` template on the node).
  Everything else is written verbatim from the bundle. **Plus one pre-config probe set** [A5.4], allowed **only in
  CONNECTED/KITTED** (never after a head is written): `$PHONE,*` (starts `$VOLTS` telemetry) and the
  `$STOP,*`→`$PHONE,*`→`$VERSION,*` ritual (firmware).
- `tutorial` carries its own `frames: string[]` (M-MODES `tutorial_frames(weapon, environment)`).
- Bench 2026-08-25 (§7r): the config **survives a BLE drop and is wiped by a power-cycle** (the tell is a `$SPAWN`
  that echoes `$LCD,0,0,0,0,0,0`); an **unspawned-but-configured gun ignores IR** (so a try-out shot cannot hurt
  a LOBBY gun); a **live `$TID` write flips hit resolution immediately** (the LED repaints at respawn).

`WeaponCatalog` (static data owned by M-MODES: `mcp/brx_mcp/mc/weapons.json`, 22 rows incl. the three A12
sidearms; balance rationale in `docs/weapon-design.md`):
```jsonc
Weapon {
  weapon_id: string, name: string, class: string,
  stats: { damage:number, mag:number, reserve:number, rof:number, reload_ms:number, range?:string,
           htk?:number, ttk_ms?:number,          // at the DEFAULT 115 pool; the views recompute per game
           dmg_hit?:number, gun_hit?:number, cycle_ms?:number, charged?:boolean },   // the pool-INDEPENDENT chain, see below
  // ⚠ `damage` is the MAGNITUDE the weapon emits ($WEAP t5), not the damage that lands. What lands is
  // decided by the victim's $SIR row for this weapon's <t3,t4>: a multiplier row lands floor(x1.25) or x2, a
  // status row lands nothing, a missing row drops the hit. Damage is a property of the (weapon, $SIR
  // table) PAIR — see docs/ir-effects-design.md §6. `Compiler.validate()` warns on all three cases.
  // `dmg_hit`/`cycle_ms`/`charged` are what `weapon_view(w, pool)` re-derives htk and ttk_ms from
  // when the host changes `health` (weapon-design.md §2.5). dmg_hit is what one TRIGGER PULL delivers
  // (`WeaponCatalog.damage_per_pull()`): the t5 magnitude, plus a declared `wire.headset_dmg` on the
  // three weapons whose t1 (`WeaponIRSource`) is 2 and which therefore fire a SECOND word out of the
  // shooter's own headset ~88 ms behind the first (Shotgun, Plasma Sniper, Rocket Launcher; measured
  // 2026-09-18, weapon-design.md §7). It was t5 alone until then, which made a client re-deriving htk
  // from it disagree with the server. Armour Piercing zeroes the second word, so under that perk a pull
  // is worth its priced `ap_dmg` and no more; cycle_ms is the mean ms (player-paced on a single-shot
  // weapon: t14 + about 43 ms, the field fight fit since 2026-10-24 (F576); the gun interval stays in the $WEAP frame)
  // between landed hits (burst-aware: (2*t14 + t23)/3 on a 3-round burst); `charged` weapons pay for
  // their FIRST shot, so their ttk is htk cycles, not htk-1. A row WITHOUT them (a synthetic/demo
  // catalog) scales its published `htk` by the pool ratio and withholds `ttk_ms` at any non-default pool.
  // `gun_hit` is the gun word alone (t5, `damage()`): when the last pull's gun word does not finish the target, the
  // kill lands on the headset word and ttk_ms adds `HEADSET_WORD_LAG_MS` (88; F614, `compile.headset_lag_ms()`) [A82].
  // `weapon_view()` applies the same rule at the host's pool. No wire change.
  weap_frame: string,   // the $WEAP,... template (token positions per callsign-extract)
  icon?: string,
  tags: string[], role: string   // A10: policy vocabulary ("heavy", "sniper", "sidearm" + "pistol" [A12.1], + the role) — presets exclude by tag (loadout.md §1.1)
}
PerkView                // A10, loadout.md §1.2. The field list is `mcp/brx_mcp/mc/types.py` `PerkView` (and the generated contract);
                         // this sketch copies none of it. It carries `gain`, `cost`, `variants?`, `blocked_primary?`, `blocked_secondary?`
                         // and [A80] `blocked_presets?`: the `health.preset` values the perk is refused under (`Compiler.preset_block`).
                         // `LoadoutPool` drops such a perk; a fixed one empties the perk slot with `PoolEmptyCode` `preset_blocked`.
                         // A preset switch runs `apply_policy`, so the perk clears from every loadout with no warning.
```
- **A12.1 sidearms:** `glock`, `usp`, `deagle` (role `sidearm`, cls 10) are ordinary weapons on the wire; a row
  with `based_on {weapon_id, why}` ships a verbatim copy of that weapon's captured frame (the Bolt Rifle) and
  moves only named tokens; deliberately dominated by primaries.

## 4. The event model (the heart of scoring)

Nodes emit **facts they can observe**; MC derives **cross-player truth**. Never invent a fact a node
can't see. The gun is host-blind about its own kills — but **every hit it *takes* names the shooter**:
`$HIR` token 3 = shooter `player_num`, token 4 = shooter team (protocol §7q, hardware-verified both
directions 2026-08-25). So attribution is **exact, victim-side, BLE-native** — no IR receiver, no heuristic [A4.1].

**Node-observable events** (a node emits these about ITS gun/player):
```jsonc
Event =
 | { type:"hit_taken",   t, match_id, node_id, player_id, shooter_num, shooter_team, dmg, ir_proto?, sensor?, weapon_id? } // $HIR + the $HP delta it caused; weapon_id (S56) = the shooter's roster weapon whose $HIR magnitude matches, else the catalogue's; absent when none matches or two share it
 |   // weapon_id? [S56, A52]: the weapon the VICTIM's phone resolved from the shooter's roster row by
 |   // matching $HIR token 5 against that row's `hir` list; absent = unresolved or ambiguous (two of the
 |   // shooter's weapons share a magnitude). With no loadout match the phone tries the catalogue as a pickup,
 |   // leaving out the shooter's own weapon ids. MC forwards it verbatim in the `feedback{kind:"hit"}` relay
 |   // below and never resolves it itself.
 //   sensor = $HIR tok1: 0-3 are ALL HEADSET sensors (four of them), 4 = gun body. Added 2026-09-01;
 //   before that `ir_proto` was read from tok1 and so carried the SENSOR, with no version marker.
 |   // `dmg` = the drop in hp + armor + shield (`engine.js _hpTakePools`), so a hit a shield fully absorbs
 |   // still emits a hit_taken. Whether the shield delta also gets its own field is node.md §10-Q12.
 |   // `dmg` is deliberately NOT $HIR token 5: tok5 is the RAW magnitude and ignores the $SIR multiplier,
 |   // so the delta is the correct source and is multiplier-safe.
 | { type:"death",       t, match_id, node_id, player_id, shooter_num, shooter_team, desync?, dot?, melee?, credit? }   // $HP→0; shooter = last $HIR if fresher than DEATH_LATCH_MS, else 0. [S16] dot:true = the node's own poison tick killed; shooter = the last applier. [A62] melee:true = that fresh $HIR was the melee proto (13): the melee medal. [A65] credit:"team" = the damaging hit was lost and only a non-damaging word (smoke, EMP) was fresh: shooter_num 0, shooter_team = that word's team, and the TEAM gets the kill
 | { type:"respawn",     t, match_id, node_id, player_id, resync?, station?, operator?, protect_ms? }   // resync?: LEGACY (A6.8 retired it for the live path; still set by a lobby/armed resync revive). station?: A13.2 — the station id that revived the player (absent for a timer revive). operator?: A47, true = MC's FORCE RESPAWN, which keeps the streak
 | { type:"team_change", t, match_id, node_id, player_id, tid, protect_ms? }                           // infection: this gun moved to `tid` [A5.8]
 |   // protect_ms? [F289, A53]: on both, the ms of spawn protection the phone still owes the write that ends;
 |   // absent = none owed. Rule and MC's reading: the F289 paragraph under §5's Node → MC table.
 | { type:"operator_result", t, match_id, node_id, player_id, cmd:"resync"|"respawn"|"relink", ok, why? } // A47: what the phone did with an operator action; `why` on a refusal. Never scored
 | { type:"possession", t, match_id, node_id, player_id, site?, hold_ms:{"<tid>":ms}, observed_ms?, source?:"beacon"|"station" } // F70: the objective tally, cumulative, merged by max; rule in mc/API.md
 | { type:"pickup", t, match_id, station_id, item_kind:"weapon"|"overshield"|"ammo", weapon_id?, refilled?, next_spawn_in_s? } // `refilled?` (ammo only): `{"0": n0, "1": n1}`, the rounds added to slots 0 and 1. `next_spawn_in_s?`: whole seconds to the station's next spawn at the grant; absent when unknown or at the 255 cap (powerups.md 7b). A56: this player took a station's item (the grant is on the gun). Never scored; MC dedupes it against the station's `station_action taken` (the station's report wins a disagreement, powerups.md 7a)
 | { type:"status",      t, match_id?, node_id, player_id?, hp, armor, ammo, alive, shots, deadline_s?, battery?, fw?,
                         arm_state, t_minus_ms?, synced, dropped?, outbox_lost?, actions_dropped?, actions_dropped_game?, preflight?, protected?, transport?, game_byte?,
                         pending?, app_ver, platform?, device?, pool_stale?, pool_stale_ms? }
 |   // pending? [A78]: the phone's unsent fact count. An ack that empties an outbox of more than one fact sends a fresh status at once.
 |   // app_ver, platform? [A29] and device? [A75] ride every beat, as in `hello`. device? = "<manufacturer> <model>" (at most 64
 |   // characters), absent until Capacitor's Device.getInfo() answers, on the web, and on a Stick. MC keeps the last one per node
 |   // (`NodeView.device`); a beat without it changes nothing.
 |   // pool_stale? [A46]: "silent"|"no_fire"|"write_lost"|"pool_wrong", with pool_stale_ms? (`types.py` `NodeView`). Each beat
 |   // restates the claim, so a status without it clears it. MC shows it on the LIVE row and readiness card, never as a warning.
 |   // protected? [F289]: true only while the phone owes the write that ends spawn protection; absence clears it.
 |   // transport? [F309]: the phone's own connection claim, "wifi"|"cellular"|"none"|"unknown" (§5d has the bind rule).
 |   // game_byte? [X2]: the advert game byte (1..255) the phone holds from `config.game_byte`. MC takes it when it adopts
 |   // a match it did not start, so a station re-arm keeps that byte. Absent (an older phone) = MC keeps its own number.
```
- `shooter_num`/`shooter_team` are **always present** (from `$HIR` tokens 3/4). MC maps `shooter_num →
  player_id` via the match roster. `shooter_num = 0` means **unknown / environmental** (no `$HIR` fresher than
  `DEATH_LATCH_MS` before the `$HP,0`, a tutorial-armed gun, a desync); a number not in the roster (another
  game's gun) is recorded and **not** credited. Grenade/station beacons (`$HIR` token 2 = 15) never enter the latch.
- **`status` is live-only [A4.4]:** sent every `STATUS_HEARTBEAT_MS` while connected, **never queued or
  persisted** — it is a heartbeat + counters, not a fact to replay. `shots` = cumulative shots fired this
  match (from `$ALCD` decrements; reloads/pickups increase ammo and are ignored). `preflight` [A4.9] =
  `{ ssid_ok, mc_reachable, auto_join_ok, cellular_off, dnd_on, phone_batt, screen_on, foreground, gun_linked, headset_ok, gun_flapping }`.
  `gun_flapping` (bench 2026-09-17): true while the gun keeps dropping and re-taking the BLE link within
  seconds, again and again (a headset that is off does this). MC shows one steady amber line for it
  instead of the link cycling between GUN LINK LOST and HEADSET CONFIRMING — but only while the headset
  is unproven; a gun that already answered the config push and then goes dark still reads red.
  `headset_ok`/`screen_on`/`foreground` are **amber before the config push, never red at muster** [A5.4]. **[F550]** `headset_ok` = the gun link is up and the phone's `$VERSION` probe read the headset joined (`hds.N`); it is not the config echo. `fw` =
  `$VERSION` result from the pre-config probe set (§3). `arm_state ∈ idle|connected|kitted|lobby|armed|live`
  [A1, A3]; `t_minus_ms` only while ARMED; `synced` = clock-sync fresh (§7); `dropped` = events shed by ring
  overflow since last status [A3]. `outbox_lost?: {match_id, n}` [O6] = how many of match `match_id`'s facts the phone's outbox dropped, counted at the source (a bounded per-match map in its storage, the last 4 matches) and sent whenever the phone knows its match, 0 included. MC shows `n` as `NodeView.outbox_lost` only while `match_id` is the match in play, resumed or adopted (or in RECAP); another match's count is history. There is no baseline on MC, so a hot-joiner's old losses never show and a resume keeps the outage's losses. `actions_dropped?` + `actions_dropped_game?` [O10] = a Stick's CLAIM reports evicted from its full queue since it was armed for game byte `actions_dropped_game` (it resets when MC arms it for a new game byte or station; the Stick does not know MC's match id); MC shows it as `NodeView.claims_dropped` and a station attention line only while that game is the current one. A Stick pops a queued `station_action` after a successful `sendTXT` (the wire has no acknowledgement for it: `ack{seq_hi}` covers only seq'd facts, so a claim can still be lost if the socket dies before MC reads it; filed).
- Every type in `envelope.PERSISTED_EVENT_TYPES` (generated into `contract.gen.ts`/`contract.gen.js`; today
  `hit_taken`, `death`, `respawn`, `team_change`, `possession`, `operator_result`, `pickup`) is a **persisted fact**,
  idempotent by `(node_id, seq)` (§5 envelope). MC stores `operator_result` [A47] and `pickup` [A56] and writes the
  feed from them; no scorer reads them.
- **`match_id` on every fact [A4.3]** — minted by MC in `start`; a node stamps it on everything after
  `startAt()`. MC **parks** (does not score) events whose `match_id` isn't the current match — a phone that
  flushes match-1 deaths during match 2 must not pollute match 2. Parked events still reach that match's recap.
- There is **no per-bullet `shot` event** [A4.4] — shots ride the `status` counter.

**MC-derived facts** (computed, never sent by nodes):
```jsonc
Kill   { t, match_id, victim: player_id, killer: player_id, team: team_id, multi?: number, friendly?: boolean }
Assist { t, match_id, victim: player_id, assister: player_id, dmg }
ScoreRow { player_id, display, team_id, kills, deaths, assists, shots, hits, accuracy, kd, streak, medals[] }
```
- **Kill attribution (exact):** `death.shooter_num → killer` via the roster; `shooter_num = 0` → no killer
  (death only). **[A65] Team-only credit** (F354): a death with `credit: "team"` and `shooter_num = 0`, in a team
  mode, adds one to the score of the team whose `tid` is `shooter_team` (`Scorer.team_credit`, in `team_scores()`,
  so it counts toward the frag cap and the winner). No player gets the K, a streak, a chain, first blood, a medal,
  an assist or a kill confirm, and the WIRE 0 warning never counts a death that carries `credit`. The victim's own
  team, a tid not on the roster or FFA credits nobody (the phone applies the same rule and then sends no `credit`). The feed line reads "<TEAM> eliminated <victim>", tagged TEAM CREDIT. **Team-kill (`friendly:true`)** ⇔ killer and victim share a non-null roster `team_id` **and**
  `config.mode != "ffa"` — FFA is one `$TID` for everyone, so `$TID` equality must never define friendly [A5.2].
  A team-kill counts as a death and scores −1 for the killer (mode may override). Infection re-evaluates team
  membership from `team_change` facts. There is **no `approx` attribution** and no `ATTRIB_FUSE_MS` [A4.1].
- **Assist:** any *other* player whose `hit_taken` dmg on the victim lies within `ASSIST_WINDOW_MS`
  before the death. Player-level, always.
- **Accuracy** = `hits / shots`: `hits` = count of victims' `hit_taken` with `shooter_num == me` on a
  **non-friendly** target [A5.2], `shots` = the shooter's latest `status.shots`. If a node's last `status` is
  older than the match (phone died), accuracy is "—", not 0. MC number; nodes show "— MC" until told.
- **Winner:** `mode == "ffa"` → top `ScoreRow`; team modes → team kills (or `win_by`).
- **Time base [A4.7, A5.7]:** MC records `t_recv` on every inbound envelope. Cross-node windows (assist,
  multi-kill, first blood) use the node's synced `t` when the node was synced at lobby (`status.synced` true at
  its last pre-start heartbeat — drift ≪1 s over a match). For a **never-synced** node: live `event`s use
  `t_recv`; an `event_batch` is re-based once per flush (`offset = t_recv − t_newest`, applied to the whole batch,
  order preserved) and **window awards (multi-kill, first blood) are suppressed** for facts from such nodes.
  (A8.3 made the batch re-base path actually run on the real stack; it had been dead.)
  **[A71] Clock-step guard:** MC reads the drift `env.t - t_recv` of every live `status` and `time_req`. A drift that
  moves by more than `CLOCK_STEP_MS` (3 s) and holds for two samples at least 2 s apart marks the node clock-suspect from
  the first shifted sample: its facts then score at `t_recv` (live, replay and the powerup pickup path) until its drift is
  back near its old level for two such samples, and MC pushes `control{clock_resync}` (at most once per 10 s per node).
  MC takes no drift as a baseline until the phone's connect burst (five `time_req` in 1.5 s) is over, because a phone
  with a saved offset stamps that burst at a stale level. A fact dated more than `CLOCK_STEP_MS` after its arrival scores at arrival at once (F485: a phone cannot send from the future). That rule rests for `MC_STEP_QUIET_MS` (10 s) after an MC step. During a reconnect gate a fact keeps its own `t`. The two agreeing post-gate samples are compared with the pre-disconnect baseline. If they differ by more than `CLOCK_STEP_MS`, MC re-scores the gate's live facts at arrival (F476). Offline batches are excluded. A reconnect inside an unresolved gate check keeps the first hello for up to `GATE_CARRY_MS` (30 s) (F495). An ambiguous late fact (queued across a step, with nothing to prove it pre-dates it) scores at arrival, and a pickup from one takes nothing: the station decides. When MC confirms a step it re-derives the board from the stored
  facts (the resume path), so the live board and a replay agree, and a pickup from a node with an unconfirmed shifted
  sample is dated at `t_recv`. A fresh burst after the push gives the node a new stable level near MC time (drift within
  `CLOCK_STEP_MS` of 0): two samples after it, 2 s apart, end the window. MC's own wall clock stepping (its wall clock minus its monotonic clock moves) re-baselines every node:
  nobody is suspected. A closed window's stepped time band applies only to a fact that arrives after the window closes and is
  dated inside the window, so an offline fact from before the step keeps its own `t`.
- **Feedback freshness [A4.3]:** MC sends `feedback{kill}` only when `now − death.t ≤ FEEDBACK_MAX_AGE_MS`;
  a late-flushed kill scores but never flashes a sight minutes later. **[A65] No kill feedback after the whistle,
  any end** (F357, Tony 2026-09-25, superseding A64's frag-cap-only rule): MC sends no `feedback{kill}` (and so no
  medal cue) for a kill it processes after the end, whatever ended the match: after the frag cap froze the match
  (`end_t <= limit_reached_t`, or `cap_recv`; an adopted match past the draft cap plays on and keeps its confirms), after a host END, or once MC's clock is past the time limit (`end_t`), and never
  in RECAP (`Scorer._before_whistle`, `Session._feedback`). The capping kill itself is still cued. A kill stamped
  before the end that arrives after it still scores, with no confirm.
- **End freeze [A6.1]:** MC records `end_t` when it broadcasts `control{end}` (frag-limit / survival / objective /
  host end) or, for the timed end, `end_t = go_live_t + time_limit_s·1000`. Facts whose effective `t` is `> end_t`
  are **recorded but not scored** (`parked_reason: "post_end"`) — the announced winner never mutates as out-of-range

**Post-end facts are kept, shown and never counted [A24/M2, 2026-09-12]:** they ride the recap as `after_end` (`{facts, by_player}`) and as the last two CSV columns (`after_end_kills`, `after_end_deaths`), feeding nothing — not kills, streaks, medals or the winner. **[A65] "After the whistle" is defined by the stamp** (F357): a death whose effective `t` is after `end_t` is an after-whistle kill. It never counts in the results, the awards or the medals, and MC writes it to the feed tagged AFTER WHISTLE (kind `kill`), live, and again for each kill a frag-cap end that moves earlier un-scores. The recap shows it in the AFTER THE WHISTLE block. A frozen late team kill (below) carries the same tag. **[A64] A late team kill is frozen out** (F356): after the frag cap fires, a team kill that arrives late (stamped at or before the end) is frozen out: it does not lower the capping team's board; the recap marks it post-whistle (`post_end`). "Late" is judged by arrival (`t_recv` after the moment the cap's whistle blew, `Scorer.cap_recv`: a reconcile replay is handed it, the match snapshot carries it, and a resume from a snapshot older than the whistle derives it from the stored facts in arrival order), so the same facts give the same board in any arrival order and on any replay. An enemy kill that arrives late still scores. By design, the board can then show a team one point above its true net. **A frag-cap end is RE-DERIVED:** the match ends at the TIMESTAMP of the kill that reached the cap, not when MC learned of it, so a fact arriving with `t` within `end_t + CLOCK_TIE_MS` re-runs the recap as a pure function of (the stored facts, the end rule) — the end can move EARLIER and everything after it is un-scored; the `result` is re-pushed. A host END and a timed end never move.
  nodes flush kills they scored after the in-coverage end. Recap shows the count. `validate()` WARNS when
  `frag_limit` is set without `opts.coverage == "full"`.
- **Hot-swap shots [A6.2]:** `status.shots` is per node-session; MC keeps `shots_total = baseline + status.shots`,
  re-basing when a new `node_id` binds the player. Accuracy uses `shots_total`; `welcome.node.score.shots_total`
  seeds the swapped phone's display.
- **Recap results wait for sync** [A5.11/F596-F597]: after the whistle MC holds the winner and stats as
  RESULTS PENDING until every phone bound at the whistle reports zero pending facts and every control hill reports, or the
  operator chooses FINALISE, or **[A83]** `SYNC_STUCK_S` (120 s) passes on MC's monotonic clock since the whistle: then MC
  releases without the rows still missing, and a hill that is off or out of range blocks no longer than a phone. Only a
  zero-pending status the phone sent after its own end counts: it names this `match_id` and its `arm_state` is past
  `armed`/`live`.
  `hello.pending` and post-whistle status counts keep the phone row in sync; a later batch can reopen a received
  row. Once released, the result stays released through late batches and restarts. A lost link leaves a received row received and shows the link separately. FINALISE releases the held result
  and marks it finalised. A late fact that changes the winner sets
  `RESULT CHANGED` and updates the released result. While sync is pending, the console withholds the winner, team score
  and honours, and API winner fields are null. `/api/recap` and the snapshot retain per-player rows for the sync table.
  Recap history marks the current match pending without recap statistics or configuration, and both recap CSV routes
  return 409. Every path to a new match refuses a pending result with 409 until FINALISE or all receipts arrive.
  **The phone shows the same stages** (Tony 2026-10-25, `app/src/hud/synctrack.js`): after the whistle its results
  screen draws NOT LINKED/LINKED, SENDING N LEFT and RECEIVED, by MC's rule. RECEIVED needs a status with nothing pending
  sent after the whistle (`transport.drainedAt`), and it latches. A stuck stage adds one reason and one action: no Wi-Fi
  to MC, MC not answering (after 30 s off the link on Wi-Fi), mobile data, or no progress for `SYNC_STUCK_S`. The end
  needs no stage of its own, because that same status confirms it (A42). Back in the lobby, a compact chip above READY
  shows the same stage, RECEIVED included.
- **Which player a fact scores for [F481-F487, 2026-10-05].** Each stored fact carries its node's holder at arrival, and a replay binds by that holder, so a replay repeats the live decision. At the whistle the node-to-player map freezes. A late fact stays on the player who held that phone then, through a handover, an evict and the roll. A player with no phone at the whistle takes their latest binding after it. The RECAP connection dots follow the live holder (F486). **Evict:** during a match an evicted node keeps its earlier facts' player. Facts it sends after the evict score for nobody, take no powerup and add no possession tally, live and in replay (F482). The node-map fallback never rebinds it: only a hello by its own gun does (F487). An evict in RECAP keeps its late facts and its pre-live sync record, so they still count (F483, Tony 2026-10-24: they happened in play).
- **Medals [A11.4, A61]:** `feedback.medals: string[]` is a Halo-style stack: first_blood · ONE multi-kill medal, the
  highest of the ladder the chain has reached (double_kill 2 · triple_kill 3 · killtacular 4 · killtrocity 5 ·
  killamanjaro 6 · killtastrophe 7 · killionaire 8+, each kill within
  `MULTI_KILL_MS` of the last) · melee_kill · killjoy (the victim was on a streak of 5+, A63) · killing_spree at 5 ·
  unstoppable at 10. The one table is `types.MEDALS`
  (`contract.gen` `MEDALS`: key, kind, count, label, clip, clip_ms); `kind` stays `"kill"` so older nodes still play their kill
  line, while a current node plays the medal cues back to back INSTEAD of it, each after the one before has ended
  (`docs/announcer.md`). The old `multi`/`medal`
  kinds are legacy. **[A63] A re-scored recap** (a reconcile, a resume, a frag-cap end that moves earlier) scores the
  stored facts in effective-`t` order, so the final recap may list a streak medal, KILLJOY or a longer chain that
  nobody heard live, or leave one out; Tony accepted this on 2026-09-25. The scorer also emits lead changes (team modes by team totals, FFA by player), `next_kill_wins`
  once at cap-1, `last_survivor` once in lms/infection, `infected` on a team_change in infection (the turned node
  skips MC's copy), evaluated after EVERY scored death, team kills included; mode engines emit the objective/VIP
  kinds. **Clock callouts are the node's** (`time_60`/`time_30`/`time_10`, edge-triggered from its synced end).

**Readiness (MC-assembled [A4.9, A5.4, A5.11])** — the board shape M-MC builds from `status.preflight` + `ack_config` + M-ARMORY `scan()`:
```jsonc
ReadinessRow { gun_id?, sticker, tail, player_id?, player_num?, present, identity: "ok"|"unconfirmed"|"reverted"|"unknown"|"manual",
               node: "none"|"linked", headset: "proven"|"unknown"|"absent", battery_pct?, battery_age_ms?, fw?, phone_batt?,
               ssid_ok?, mc_reachable?, synced?, screen_on?, foreground?, status: "green"|"amber"|"red", blockers: string[] }
ReadinessSnapshot { t, roster_size, greens, board: ReadinessRow[], unclaimed: ScanRow[], roster_faults: string[],
                    unrostered_phones: int, go: boolean }
```
**[A39]** `unrostered_phones` counts connected phones that wear a gun nobody on the roster or on STANDBY claims.
It never blocks `go`. It feeds the KIT/LOBBY "N CONNECTED PHONES NOT IN THE ROSTER" banner, which links to the
ARMORY claim card. What counts (silent phones do not, A40): `mcp/brx_mcp/mc/API.md` → `readiness.unrostered_phones`.
Red (blocks the config push): no node, identity reverted/unknown, never synced, wrong SSID / MC unreachable.
Amber (shown): headset unknown, battery unsampled, phone battery low, screen/foreground off, fw unknown.
After the push: an empty `ack_config.gun_echo` is **red** (the gun did not answer: headset off or asleep) and
blocks `start`. **Bench 2026-08-25 (§7r): with the headset OFF the head write echoes nothing and the BLE link
dies (`$DISCONNECT`), so link + head echo IS the headset proof** and the pre-push amber cannot deadlock the board.
**[A32]** The board does not wait for the echo: `headset` is `proven` once `status.preflight.gun_linked` has held true for
`HEADSET_LINK_PROOF_MS` (a gun with no headset drops its link within seconds). It falls back to `unknown` when the link
drops, and `absent` still means the head echoed nothing.

## 5. Node ↔ MC protocol (M-NET)

**Transport:** WebSocket over the field LAN (one persistent socket per node to the MC process; no broker — the
MQTT rationale is in `docs/archive/spec-net.md` §1). **Discovery:** MC advertises `_openbrx._tcp` via mDNS/
Bonjour with TXT `{ ver, session_id, ws_path, server_name }`; nodes browse it, **or scan MC's QR** (`ws://ip:port`
+ session, the field default), or type the address (the mandatory floor: mDNS fails on hostile Wi-Fi, some
Android OEM stacks, and locked-down routers). Discovery is used only to find MC the first time and after a full
address change; a warm socket is never re-discovered. **Do not hard-code or cache an MC IP across sessions.** (A28: the public hostname is random per tunnel start and arrives in the QR/`welcome.join`; it is held for the session only.)
The LAN is a battery travel router (primary) or a Mac hotspot (small-game fallback; ~5-10 clients); MC must
never assume it is the AP (ADR-0002). All messages are JSON envelopes.

```jsonc
Envelope { v:1, kind:string, id:string, seq?:number, t:number, body:object }
```
`seq` is a per-node monotonic counter on **persisted** `Event` messages (every `PERSISTED_EVENT_TYPES` member, §4)
for idempotent replay. `status` carries no `seq`.

**Node → MC** (`kind`):
| kind | body | when |
|---|---|---|
| `hello` | `{ node_id, node_type:"phone"|"companion"|"utility", app_ver, platform?, device?, gun?: {name, tail, fw?}, seq_next, pending?, node_key?, prior_utility?: {node_id,node_key}, mc_challenge?, mc_enroll?: true }` | on connect. **A29:** `app_ver` = `"<package version>+<git sha>[-dirty]"` baked at build time, `platform` = `android`/`ios`/`web`; both repeat on every `status` so a phone that upgraded mid-session is seen. **`device?` [A75]** = `"<manufacturer> <model>"` from Capacitor's `Device.getInfo()` (at most 64 characters), absent until the plugin answers and on the web; it also rides every `status`. A Stick sends none. `gun.name` = the full **advert name** (`<sticker>-<tail>`); `tail` is parsed from it, **never from the platform deviceId** (iOS gives UUIDs) [A5.5]. `seq_next` = the node's next event seq (so MC can spot a wiped install) [A4.5]. **`pending` [A78, F595]** = the node's unsent fact count when it connects, so MC's sync board shows SENDING before the batch lands; an ack that empties an outbox of more than one fact sends a fresh `status` at once with `pending: 0` (A78). An older node omits it. `node_key` = the secret from a prior `welcome` [A8.2] — proves a re-claim of a still-live node_id/gun. `node_type:"utility"` = a station phone, no gun, never bound [A13.5]. **F184:** the first HUD hello after BACK TO HUD may carry `prior_utility`; MC validates the old utility takeover key, consumes that net identity and removes its ITEMS row. The proof is sent only to a trusted MC. **`via`/`secret?` [A28.2]**: which join URL this socket dialled and the QR's join secret (enforced only through the tunnel). **`mc_challenge?` / `mc_enroll?` / `mc_enroll_nonce?` [A60, F346]**: a proof dial (an address the player never named) sends `mc_challenge` (16 random bytes, base64url, new on every socket) and withholds `node_key`, `secret` and `prior_utility`; every other phone dial sends `mc_enroll: true` to ask for its trust key, with `mc_enroll_nonce` (16 random bytes, base64url, one per MC host:port, persisted until that host's trust key arrives). A utility sends neither. |
| `bind` | `{ node_id, player_id?, gun_name, gun_tail }` | node claims/confirms its gun & player. `gun_name`/`gun_tail` come from the advert name [A5.5] |
| `event` | one persisted `Event` (§4) | as they happen (queued if offline) |
| `event_batch` | `{ events: Event[] }` | store-and-forward flush on reconnect |
| `status` | one `status` body (§4) | every `STATUS_HEARTBEAT_MS` while connected; live-only, no seq. **`gun_locked?: true` [F272]** = while LIVE+alive the gun stayed silent through two all-zero `$LIFE` reads; each heartbeat restates it, and absence/false clears it. Optional means an older node and a healthy current node are deliberately indistinguishable. MC shows the current claim as `GUN STOPPED` (full copy in `webapp/mc/src/alerts/server.ts`/`live.ts`), but never promotes a stale/offline last-known snapshot to a current lock. **`reach: "lan"|"backhaul"` [A28.3]** = the live socket's path. **`transport?: "wifi"|"cellular"|"none"|"unknown"` [F309]** = the phone's own connection, a claim restated every beat; the bind rule and what MC does with it are in §5d. **`has_pub: boolean` [F595]** = the phone holds `pub` (the tunnel URL) as a fallback; always sent by a current app, so absent means an older app. A LAN phone on cellular counts toward A28.4 coverage only with `has_pub: true` (§5d). **`protected?: true` [F289]** = the phone still owes the write that ends spawn protection; absence clears it (the F289 paragraph below this table). **`config_id?: string` [A36]** = the head this phone is HOLDING right now (`engine.js statusBody`), optional so an older app simply makes no claim; MC flags a heartbeat naming an older config as the amber `HOLDING OLDER CONFIG (<id>)` until the node re-acks. The body's `hp`/`armor` are also read as a claim now: the first frame at least `POOL_CHECK_SETTLE_MS` into a life must not report MORE hp or armor than the `$PSET` MC pushed that player, or the row goes red with `GUN POOL ≠ CONFIG` (full copy in `state.py`/`mc/API.md`). **[A37]** EXCESS only: a pool at or below the compiled one is damage (the engine emits `hit_taken` only for a hit it could attribute, the pool moves on every `$LCD`/`$HP`), and the earlier equality-unless-hit rule went red on guns running the RIGHT head. **`pool_stale?: "silent"|"no_fire"|"write_lost"`, `pool_stale_ms?: int` [A45, A47]** = the node judges its pool stale, and how old the gun's last pool report is (see A45 for the rule); absent = no claim. `"silent"` = no gun frame for 185 s; `"no_fire"` = three trigger presses in a row got no shot back; `"write_lost"` [A47] = this life's spawn or revive write was lost and the phone did not repeat it, which RESYNC GUN clears. **`pool_src?: "gun"|"model"` [A37 R2-3]** = where those hp/armor came from THIS LIFE: `engine.js` fills them from `config.health` at spawn/revive (`"model"`) and overwrites them with the gun's own numbers on the first `$LCD`/`$HP` (`"gun"`). MC judges the pool ONLY on a `"gun"` frame — `$PSET` bakes `overrides.max_hp/max_armor` and the body_armor perk, so a player overridden DOWN reported the model's bigger number until the gun spoke. Optional: no field, no claim. And the RED is hp-above only; armour above the ceiling and a pool BELOW the ceiling on a clean first life are AMBER advisories (`GUN ARMOR ABOVE CONFIG` / `GUN POOL BELOW CONFIG`). **[A37 F5]** Both AMBERS need TWO CONSECUTIVE AGREEING gun-sourced frames past the settle window, neither with a hit that life; the RED still fires on one. `POOL_CHECK_SETTLE_MS` is 2000 ms and the replayed store has a body-armor pool landing at +2.0 s, so a correct gun can be sampled mid-application exactly once — nothing can ADD health, so one frame of excess health is already the whole claim **[A67] A station's range (F365):** a utility node's `status` carries `threshold` (int dBm, the value applied now), `threshold_src?` (`station`\|`mc`), `threshold_edit_age_ms?` (ms since the on-station edit; only when src is `station`), `tx_power?` and `tx_power_src?`/`tx_power_edit_age_ms?` the same (absent = the station cannot set its power, an iOS phone; MC then shows no STRENGTH), and `range_edits?`: the last up to 8 on-station edits, oldest first, each `{seq, field: threshold\|tx_power, from, to, locked, age_ms}`. `seq` rises per edit and persists across a reboot. MC dates an edit `t_recv - age` on its own clock. |
| `ack_config` | `{ config_id, ok:boolean, err?, gun_echo?: string, gun_config?: { player_id:int, team:int, hp:int, armor:int, shield:int } }` | after writing `FrameBundle.head`; `gun_echo` = the `$LCD`/`$ALCD` line the gun answered with — proof the gun **answered the head** (a headset-off gun answers nothing and drops the link, bench 2026-08-25 §7r) [A4.4, A6.7]. **[A36]** `config_id` is NOT decoration: MC keeps it and an ack naming a PREVIOUS config satisfies nothing — `all_acked()` requires the current id, the readiness row reads `ACKED AN OLDER CONFIG (<id>)` (full copy in `mc/API.md`), and `start()` refuses **even with `force`**. And `gun_echo` is now the **most informative** echo of the 1.5 s window, not the first: `$START` answers a head write with `$LCD,0,0,0,0,0,0,*` (which proves the gun answered and says nothing about the weapon), so `engine.js` keeps the slot-0 `$ALCD` that follows it and sends that when it has one. MC parses its mag/reserve and compares them to the `$WEAP,0` frame in the head it pushed THAT player (`frames.head_spawn_ammo`); a mismatch is the red `GUN ECHO ≠ CONFIG` (full copy in `mc/API.md`). A non-`$ALCD` echo makes NO claim. **[A37]** The echo is THREE-state on the readiness row (`echo: "proven"|"mismatch"|"not_echoed"|null`): `not_echoed` is rendered NEUTRAL — never red, never counted as proven. **[F549]** Superseded in part: on 2026-10-17 every healthy v4.32 gun answered its head with the slot-0 `$ALCD` (bug 3a captures, the F532 re-bench), and the two that sent only `$START`'s zeroed `$LCD` had a broken `$WEAP,0`. The node now acks `ok:false, err:"no_config"` for that (`err` values: `no_echo`, `no_config`, or a BLE write error). An `$ALCD` that arrives after the head's first `$BUT` is not the config echo (it carries the live magazine), but a slot-0 one still proves slot 0 loaded. **[F549 r2]** An `$LCD` never proves the config, and a slot-0 `$ALCD` proves it only after `$START`'s zeroed `$LCD` or after the whole head is written (a late report from the old weapon proves nothing). **[A37 F2]** START refuses a `mismatch` too, but `force` OPENS it (unlike the stale ack): the rule rests on an unbenched inference about what a v4.32 gun emits in the 1.5 s after a `$WEAP` write, and a reproducible mismatch would otherwise make a player unfieldable. **[A37 F6]** A RE-push mints a FRESH `config_id`, so an ack already in flight when `acks` were cleared is stale and says so, instead of being recorded as an ack for a head that gun never took. **[F271]** After the echo window the node sends one `$QUERY,*`; a valid reply's tokens 1–5 are reported as optional `gun_config`. MC compares those five values with the actual `$PSET` in the pushed head and shows a red `GUN CONFIG ≠ PUSHED HEAD` blocker for any difference; `start()` refuses it even with `force`. A missing, late, or malformed reply omits `gun_config`, preserving compatibility with older nodes and guns that do not answer. |
| `time_req` | `{ t_node }` | clock-sync ping (§7) |
| `log_offer` | `{ node_id, bytes, lines }` | node has a diagnostic log MC can pull |
| `log_data` | `{ node_id, seq, chunk, last:boolean }` | the log itself, chunked (≤ 48 KB/chunk), in reply to `pull_log` [A3] |
| `ready` | `{ node_id, player_id, ready:boolean }` | ready-up toggle in **KITTED** (phase 4) [A1]; **all-ready gates the `config` push**; a player's `ready` ENDS their try-out [A10.4] |
| `loadout_request` | `{ node_id, player_id, slot:"primary"\|"secondary"\|"perk", kind:"weapon"\|"perk"\|"none", id?, try?:boolean }` | A10.3: phone self-serve pick (loadout.md §4.2). MC validates vs `loadout_policy`, applies, re-sends `assign`, optionally starts the try-out, and ALWAYS answers `loadout_ack`. **[A30]** While `armed` or `live` the kit is locked: the ack is `ok:false` with a reason. A change after START belongs to the next match (loadout.md §4.4). |
| `loadout_browse` | `{ node_id, player_id, open:boolean }` | A10.3: HUD opened/closed its loadout browser → MC roster shows "PICKING…" (60 s server expiry) |
| `station_action` | `{ id, action, player_num?, t?, age_ms? }` | **[A56]** a **powerup** station → MC, live-only. `reset`: the operator asks for the item now (a Stick long press or its screen); the station applies nothing until MC's `station_update {available: true}` answers, and MC logs it. `taken`: the station awarded the item to `player_num` (first ready claim heard); MC records it and dedupes it against the player's `pickup` fact by station and spawn; if the two name different players the station's report wins whatever the order (F454, powerups.md 7a). `age_ms` is how long ago the station awarded it (a Stick has no synced clock): MC dates the take `t_recv - age_ms`, so a report queued while the link was down never takes a later spawn. Behind the powerups flag. |

F289 (2026-09-23): a `respawn` or infection `team_change` fact carries **`protect_ms?: int`** when the phone owes the
write that ends spawn protection, and **`status.protected?: true`** is restated on every heartbeat while that write is
owed; absence clears it. Only the phone lifts protection, so MC flags a STALE player whose newest evidence says it was
still owed (`LiveRow.possibly_protected`); a connected phone is never flagged.

F272 recovery nuance: while the replacement head is actively writing or retrying, the node omits
`gun_locked` so MC clears POWER-CYCLE while the phone says KEEP POWER ON. If the bounded retry budget is
exhausted, the node restates `gun_locked:true` because another power-cycle is actionable.

**MC → Node** (`kind`):
| kind | body | when |
|---|---|---|
| `welcome` | `{ session_id, server_t, seq_hi, node_key, prior_utility_consumed?, mc_trust?: { key }, mc_proof?, node?: { player, team, roster, config, frames, start?, match_id?, score? } }` | reply to hello. **Full re-hydration [A4.5, A5.5]: MC resolves the context by `hello.gun` (sticker/tail → the player bound to that gun) first, then by `node_id`** — so a hot-swapped phone with a brand-new `node_id` is hydrated on its first `hello`, before `bind`. `score?` = that player's current `ScoreRow`. **[A46]** A restarted MC restores the roster, config, teams, stations and game numbers but no delivery: it boots in `muster` with no lobby push, acks or start, so its `node` carries no `config`, `frames` or `start` and a restart never re-arms a gun in play. `seq_hi` = highest event seq MC has from this `node_id`; node sets `next_seq = max(own, seq_hi+1)`. `node_key` [A8.2]. `prior_utility_consumed:true` acknowledges the authenticated F184 role handoff; only then does the HUD erase its persisted proof. **`mc_trust` / `mc_proof` [A60]**: `mc_trust.key` = base64url(HMAC-SHA256(install_secret, `"open-brx node trust v1:" + node_id`)), sent only when the hello asked (`mc_enroll`) and only the first time for that node_id on this install, except to a hello whose `mc_enroll_nonce` matches the first one (F346, in A60). `mc_proof` answers a valid `mc_challenge`: base64url(HMAC-SHA256(decoded trust key, `"open-brx mc proof v1:" + mc_challenge + ":" + session_id`)). Neither goes to a utility. **F468 fallback:** when no gun lookup finds a player, MC binds the node to the player its match node map names, if that player is not evicted, is on no other phone and the node is that player's current phone. After an MC restart this also runs in RECAP, before the roll (F487). **F490:** a `hello` with `node_type:"utility"` drops the node's player, so a later HUD hello does not bind the old player to a gun nobody owns. **A81:** in RECAP `node.result` and `node.score` are left out until `match.released`. `node.recap` rides here too (built by the same body as `assign`); the phone ignores it on a welcome. **[A84]** The assign's `match_id` never rides here: `node.match_id` names only the start the welcome carries, as it always has. |
| `assign` | `{ player: Player, team: Team, roster: RosterEntry[], catalog: { weapons: WeaponView[], perks: PerkView[] }, policy: { hud_select, kit_open, primary: { choice, allowed_ids }, secondary: { choice, kinds, allowed_weapon_ids }, perk: { choice, allowed_perk_ids } }, game, standby?: boolean, match_id?: string, recap?: true }` | kit-out: set player+team → **KITTED** [A2]. Carries **no config**. **Re-sent on any change to the player** [A3] (loadout, name, team, player_num); the node's latest `player` is authoritative. **A10.3/A14.4:** `catalog` + this player's slot rights ride along (also in `welcome.node`) so the phone can browse/pick with no rule logic of its own; `kit_open` + `game` (the BRIEFING) per loadout.md §4.1/§4.6. **A38:** `standby: true` (absent/false otherwise) means the node is BENCHED — `engine.js` drops it to a KITTED-shaped SITTING OUT state with no frames written, whatever phase it was in; PLAY's ordinary follow-up `assign` (the field absent) clears it. **A40:** MC now STATES the field on every `assign` and every `welcome.node` — `true` or `false`, never absent — because the node PERSISTS it, so an absent key cannot mean "you are playing"; it means "keep believing whatever you last believed", which stranded a benched player whose phone was away when the operator tapped PLAY. `hydrate()` applies it. The key stays optional in the shape for an older server; MC always sends it. **F632 (2026-10-26):** an assign sent in RECAP (a debrief re-team or rename, F631) carries `recap: true`, and the phone keeps its results on it; any other assign after an end (NEW SESSION's re-assign) leaves them. **[A84]** Every assign names the match MC holds (`match_id`, while it is armed, live or in RECAP); a phone that has ended that match keeps its results and match id on it, which also covers an operator edit between the phone's own whistle and MC's RECAP. An assign naming another match or none leaves them. `recap: true` stays in RECAP as a deprecated alias, read by the phone only when no `match_id` is named. |
| `loadout_ack` | `{ slot, ok:boolean, reason?: string, dropped?: { slot, id, name }, loadout: Loadout }` | A10.3: reply to every `loadout_request`; `reason` is human copy the HUD shows verbatim. `ok:true` + `reason` = the pick applied but the try-out could not arm (lobby already pushed). A14.2: `ok:true` + `dropped` = the pick applied and knocked the other slot out. **[A80]** A phone WEAPON pick that drops the held perk under its `blocked_primary`/`blocked_secondary` is acked with no `dropped` and no `reason`. |
| `tutorial` | `{ weapon?: Weapon, frames: string[], end?: boolean }` | try-out arming (phase 3a; requires KITTED). Frames compiled by MC; `end` = the teardown push (design-review 2026-08-26: `weapon` optional on both sides or the envelope drops the frame). |
| `config` | `{ config: GameConfig, frames: FrameBundle, roster: RosterEntry[] }` | pushed on **all-ready** (phase 4) [A2] → node writes `frames.head` (no `$SPAWN`), replies `ack_config` → **LOBBY**. Re-pushed (new `frames`) if a player's loadout/num changes after the push. **[A35]** A config, team or loadout edit in KIT/LOBBY after the push re-pushes a fresh `config` to every bound node (`_repush_lobby_config`): `lobby_pushed` stays true and the acks re-collect. A team change while `armed`/`live` is refused (409, names RECALL), because the gun's `$TID` in the locked head cannot follow it. **[A30]** MC never pushes `config` to an `armed`/`live` node that already took this match's config (`_push_config_to`): it would clear `spawned`, and nothing re-spawns that gun. A node without that config still hot-joins (E5). |
| `start` | `{ match_id, go_live_t, config_id, seq, countdown_s }` | schedule the dispersed start (M-START) [A1]. MC mints `match_id` and stamps a **monotonic `seq` per session**. **Rules [A5.6]:** re-push of the *same* schedule (straggler, grace re-arm) = **same `seq` + same `match_id`** (no-op on a node that holds it); a **reschedule** = **new `seq` + new `match_id`** (supersedes). A late-joining player mid-match: `assign` → `config` → the same `start` re-pushed → hot-join (M-START E5). |
| `feedback` | `{ player_id, kind:"kill"|"victory"|"hit"|(legacy "multi"|"medal"), t, cue?:string, medals?:string[], victim?:player_id, victim_team?:team_id, victim_display?:string, victim_num?:number, dmg?:number, weapon_id?:string, shot_group?:number|string }` | MC scored you a kill → node `$SFLASH` + `$PLAY` (`cue` if present, else `frames.cues[kind]`; missing → flash only). `t` = the death time; node ignores it if older than `FEEDBACK_MAX_AGE_MS` [A4.3]. `medals` [A11.4]. The kill banner shows `victim_display` (else the roster name for the `victim` player_id); it never shows the id. **`kind:"hit"` [S56 "what hit me", A52]:** best-effort relay of a `hit_taken` fact BACK to the SHOOTER's own node, so a shooter can attribute the damage it just dealt without waiting on the victim's phone. `t` = the fact's own effective time; `victim`/`victim_num`/`victim_display` name who was hit; `dmg` = the hp+armor delta (same meaning as `Event.hit_taken.dmg`); `weapon_id?` and `shot_group?` ride straight through from a single fact; a fact that arrives in an `event_batch` relays without them, so the shooter's phone then names no weapon for it and pairs a two-word shot by time. The node books `kind:"hit"` whatever its age (the `FEEDBACK_MAX_AGE_MS` gate is for kill sounds). Same contract as every other feedback: best-effort, no queue, no retry — a shooter with no socket just misses it. MC relays only the FIRST ingest of a fact (persisted facts dedupe by `(node_id, seq)`, §5) and only while the match is LIVE; it never re-fires during a replay (recap, resume) or for a self-inflicted hit. **A81:** `victory` waits for `match.released`, and MC sends it only when both its monotonic and wall clocks put the release within 30 s of its own whistle, to the winners as frozen at the whistle. After an MC restart it never sends `victory`: a reboot or lid sleep makes the 30 s unknowable. |
| `alert` | `{ kind, text, player_id, t, hud?:boolean, player_id_subject?, carrier?, flag_tid?, role?: { name, on, tid? } }` | A11.4: a named game event (`player_id` = the recipient; `player_id_subject` = who turned / the last survivor); node plays its own `cues[kind]`/`leds[kind]` + shows `text` as a HUD alert (`hud:false` = sound/lights only); stale (> `FEEDBACK_MAX_AGE_MS`) → dropped. Scope is MC's: all / one team / one player. `carrier`/`flag_tid` start the flag-carrier headset blink [A11.6]. **`role` [A19]** = a HELD headset state (led-language.md §3.3: `carrier`\|`infected`\|`vip`\|`beacon`\|`extracted`) the recipient now holds (`on:true`) or stops holding; `tid` only for a tid-keyed role. The node routes it to `_setRole` (the same mechanism the carrier blink and the infection flip use), paints from ITS OWN `headset.role` table, and logs-and-ignores a name outside the five. Kind `role` is not a presentation event (no cue plays) and the push bypasses the profile's `mc_events` switch: a role is a rule, not a flourish. MC sends `vip` to `config.vip_player_id` **`ROLE_SETTLE_MS` (3 s) after go-live and after each of that player's `respawn` facts** — the node's own start/respawn flash (+1 s, ~1 s) would paint over anything sent at the whistle. `beacon`/`extracted` have no MC-side signal yet (no node→MC fact says who is extracting or extracted), so only the contract exists for them. |
| `control` | `{ cmd, seq?, match_id?, player_id?, ... }`, cmd ∈ `end`\|`panic`\|`abort_start`\|`recall`\|`release_utility`\|`clock_resync`\|`resync`\|`respawn`\|`relink` | **one meaning each [A2, A5.9]**: **[A34]** `match_id` (optional, on `end`/`recall`, and on an `abort_start` that MC re-tells, F529) names the match being ended; a node holding a DIFFERENT `matchId` ignores it (`engine.js control()`), so an end for a retired match can never stop a newer one. MC sets it when it ends a phone from that phone's own heartbeat (`state.py _check_stale_live`): a `status` reporting `armed`/`live` for a match MC has retired (frag cap, whistle, recall, panic, new session -- the `_ended` ledger) is answered with `control{end, match_id}`, that match's `result` if MC holds one for that player, and the CURRENT `start` if one is scheduled (E5 hot-join), at most once per `STALE_LIVE_RETELL_MS` per phone and match. Field 2026-09-12: a phone off the Wi-Fi at the whistle came back still LIVE and nothing told it. **F529:** an ABORTED start, or one a RESCHEDULE superseded (F531), never went live, so MC answers a phone still `armed`/`live` for it with `control{abort_start, seq, match_id}` (that start's `seq`, kept in the ledger and in `session.json`), not `end`. A restored MC raises its `seq` counter past every aborted `seq` it remembers. An `end` put the phone in RESULTS PENDING with no recap to come. That re-tell is not an A42 end delivery.  `abort_start`=cancel a *pending* schedule (by `seq`) while ARMED → LOBBY (gun still holds `head`); if the node is already LIVE for that `seq`, it behaves as `recall`. `recall`=stop a *live/armed* game → node writes `frames.end` (+ `cues.game_over`) → **KITTED**; `end`=normal match end → same → KITTED; `panic`=`frames.panic` → KITTED. In KITTED/LOBBY an `end`/`recall` writes `frames.end` iff a bundle is held, then → KITTED. **[A42]** the OPERATOR's `end` now carries `match_id` too (it never did), and MC **re-delivers** it to any bound HUD that has not confirmed — where "confirmed" is read off that phone's own ~2 s `status` heartbeat (`arm_state` reports `kitted` for that `match_id`, or names a DIFFERENT match -- `idle` and `connected` are NO claim either way, exactly like a MISSING `arm_state`. A phone that force-closes and relaunches mid-match restores as `idle` until its gun relinks (`engine.js`: "Phase is re-derived when the gun reconnects; until then we are idle"), so reading `idle` as confirmation marked it delivered PERMANENTLY, stopped the re-delivery, and printed ALL HUDS CONFIRMED over a tagger that may still be in the match -- the very false assurance A42 exists to remove), so there is no `ack` for `control` and an older app confirms exactly as well as a new one. `recall`/`panic` stay deliberately UNNAMED: they are the operator's stop-everything hammer. **`pause` is removed** [A4.6]. **`clock_resync` [A71]** goes to ONE phone in any phase, with no `player_id` or `match_id`: the phone runs a fresh 5-sample `time_req` burst that replaces its offset (`clock.js restart()`), and the engine never sees it. **`release_utility` [A41]** is unlike the four above: it targets ONE **utility** node (never a player), carries no `match_id` and touches no gun head at all -- `utility.js` takes it exactly as its own BACK TO HUD button (`brx.role` → `'hud'`, reload). It is MC's cure for a phone stuck in utility mode (`state.py release_station`, `POST /api/stations/{node_id}/release`), best-effort like `station_config` (no ack kind exists for `control`, so `ok` means only that a socket took the push) and never phase-gated. **`resync`/`respawn`/`relink` [A47]** are the operator's cures for ONE player in a bad state (the LIVE board's operator menu, `state.py operator_action`, `POST /api/players/{pid}/operator`). Each goes to that player's bound phone only and carries `player_id` and `match_id`; MC refuses it outside ARMED/LIVE, for a match that is not the current one, and for a phone with no heartbeat within `STALE_AFTER_MS`. The node ignores one that names another match, carries no `match_id`, or names another player. **F287:** `resync` first writes only `$LIFE,0,0,0,*` and waits up to 1500 ms for that probe's solicited `$HP`. Only a positive-health answer releases `$TID`, current `$AMMO` per slot, `$BMAP,0,0`, then one `sir_pool` take (left pending while A44 protection holds). `$HP,0`, no answer, a link/life/phase change, stun or reconcile cancels it with no re-arm burst. Its `operator_result` is likewise deferred: success means the confirmed burst started; those cancellation paths report `ok:false`, so MC never prints RESYNC DONE merely because the probe was sent. `respawn` = the node's normal revive (`frames.revive`, full pools, A44 protection), emitting `respawn{operator:true}` and no death or kill; it ends a down state at once. `relink` = the node drops and reconnects its gun as the HUD's RELINK GUN (its reconcile then runs as §3.10 of node.md). None is a `config` or head write, so none clears `spawned` (F11). `resync`/`respawn` need a linked, spawned gun in `live`, so MC refuses both outside LIVE (`relink` also runs in ARMED). MC also refuses `respawn` for a down player when `config.respawn.type` is `none`, and the same action for the same player inside 2 s (a double tap). The node answers each one with the persisted fact `operator_result{cmd, ok, why?}` (§4), and MC's feed line comes from that answer, not from the send. A pre-A47 app ignores all three silently. |
| `join` | `{ pub: string|null, secret: string }` | **A28.2**: the tunnel came up or went down — every connected node adopts `pub` as its fallback (A28.3: a node bound on the LAN does not re-dial; a node on `pub` that gets `pub:null` drops to the LAN). The same body rides in `welcome.join` on every welcome. |
| `apply` | `{ frames: string[], reason?: string, preview?: boolean }` | A6.4: best-effort "write these frames now" — coverage-zone runtime effects only (syphon heal, regen refill, extraction boost). Node writes verbatim, never persists, ignores unless LIVE. **A9.1:** `preview:true` with frames that are ALL `$PLAY`/`$SFLASH` may be written in `connected`/`kitted`/`lobby` too (the tagger speaks a voice sample when the host changes a voice or gamertag). |
| `score` | `ScoreRow` + `{ shots_total, board?, rows? }` | A7: MC pushes a player's current row to its node whenever it changes (best-effort, coverage-zone), **including status-heartbeat changes to shots and accuracy when no hit/death event occurred**. The HUD shows K/D/A (and ACC only once `hits ≥ 1` and `shots ≥ 10`); still "—" until the first push or `welcome.node.score`. **`board?`** (2026-09-03, additive) = `{ teams: [{ team_id, name, score }], cap }` — the race to the frag cap for the HUD's DOWN-screen recap; in FFA the top three players stand in for teams.  **`rows?` [A24]** (2026-09-11, additive) = EVERY player's `ScoreRow` (all modes), so a phone can show a leaderboard mid-match and at the end; a node that does not know the field ignores it. `ScoreRow` itself gained `best_streak`, `first_blood`, `multi_best`, `acc_provisional` [A24] — the HUD shows `best_streak` (the current `streak` is ~0 for whoever died last) and dims ACC while `acc_provisional`. `rows?` is sent on EVERY push, in EVERY mode (2026-09-12). |
| `result` | `{ match_id, outcome: "win"|"lose"|"draw"|"undecided", winner: { team_id?, player_id?, tie? }, mode, win_by, team_scores: [{ team_id, name, score }], rows: ScoreRow[], my: ScoreRow|null, honors: [{ medal, player_id, display, stat }], possession?: { by_team: {tid: s}, ... }, after_end?: { facts, by_player: { [player_id]: {kills, deaths} } }, provisional: boolean, t }` | **A24 (2026-09-11): the MATCH RESULT reaches EVERY player node, losers included.** MC sends it to every bound player node (best-effort, coverage-zone) at the release (A81: from `_finish()` when nothing is pending, else once every phone and control hill is in or the operator presses FINALISE), re-sends it while `provisional` whenever the recap changes (a parked flush moved a row), and carries the final one in `welcome.node.result` while the session is in `recap`, so a phone that comes back into coverage after the whistle still learns how it ended. `outcome` is computed per RECIPIENT by MC from `winner` (team match → my team; FFA → me; `tie` containing my team → `draw`; `undecided` → `undecided`). **The node NEVER infers win or lose**: before a `result` arrives the results screen says the match is over and the result is pending ("MC NOT REACHED" after the settle window), because a `victory` cue that did not arrive means "lost" and "out of coverage" identically (game test 2026-09-11 D3). `rows` is every player, so a team match shows per-player lines; `my` is the recipient's own row (null for a player MC never scored). Hill/possession and objective totals ride in `possession` / `team_scores` — the HUD's results screen is mode-aware from `mode`/`win_by` and never hard-codes five cells. The node also folds `outcome`, `team_scores`, `best_streak`, `medals` and its own hill hold into the `onEnd` history entry, so a match played before the phone learned this field has them missing, never wrong. **Built 2026-09-12 (M2):** `team_scores` is `[]` in FFA — `rows` is already the leaderboard there. In `honors`, `display` is the PLAYER's name, so a phone renders the roll with no roster. `winner` may carry `tie: string[]` (team_ids, or player_ids in FFA); a recipient inside it is told `outcome: "draw"`. `after_end` is the UNOFFICIAL after-the-whistle block (Tony 2026-09-12: kept, shown, never counted) and rides only when something landed late. **[F631]** A team edit in RECAP is for the next match: the recap and `result` keep the teams as played, while a display-name edit shows everywhere. **[F633]** MC tells only a phone that rejoins in RECAP, from a re-taken recap (welcome and push), never a stored copy and never as a broadcast, unless the re-take moved the result; once the result is released, a debrief rename re-sends it to every phone at once. **[A83]** The release can also come from the 120 s bound, and it re-takes the recap, so `provisional` is current and an unchanged late report sends nothing (F630). After the release MC may re-send `result` for the same match when a late sync changes it, and withholds it from a node until that node's own queue is empty; the phone decides what to show (RESULT UPDATED only when it already held a result for that match whose `winner` or `outcome` differs). |
| `station_config` | `{ kind, team, id, threshold?, threshold_age_ms?, tx_power?, tx_power_age_ms?, game?, valid_ids?, item?, lock_s?, starts_in_ms?, ends_in_ms?, duration_ms?, capture_s?, net_cap? }` | A13.5: MC → a **utility** node at muster (and on re-arm). The phone applies it to its advert, marks itself MC-ARMED and locks its on-device config. `game` absent = 0 (any); the authoritative allow-list players enforce stays `config.stations` in the bundle (utility.md §5c). **Server side built 2026-09-11 (F104):** MC sends it on the phone's hello (if assigned), on every `PUT /api/stations/{node_id}` and on every lobby push; `game` = MC's per-match byte (1-255, bumped on the first push after a match started — the phone resets its point when it changes); `valid_ids` = every id MC assigned this session. **[A66]** `id` is MC's: the operator never types one (below). It is in `types.MC_KINDS`; the phone reads the generated copy (`contract.gen.js`, A33). **[A58] `lock_s`** (0-7200 s from receipt; absent or 0 = unlocked; a later `station_config` replaces the running lock, a same-game one included) is the tamper lock: a pushed game in any pre-match phase (LOBBY, or back in KIT/BUILD/MUSTER) `time_limit_s + 1800 + 120`, ARMED/LIVE the time left `+ 120` (an adopted match: the cap), END/RECALL/abort, the operator's unlock and a new session 0 (`stations.py _station_lock_s`). A phone station keeps working under the lock, but its on-station RANGE and MC LINK edits then need the 5 s hold, not 1.5 s (`utility.js a58Locked`, F443). A same-game re-send that changes nothing else leaves its advert and drawer alone (F337). **[A67] Range, last edit wins (F365):** `threshold_age_ms` = ms since MC's threshold was last set (by the operator, or adopted from the station); `tx_power` (`ultra_low`\|`low`\|`medium`\|`high`) and `tx_power_age_ms` ride only once MC holds a strength. Per field, the station KEEPS its own on-station edit when that edit is younger than MC's age, and otherwise applies MC's value and reports src `mc`. Absent ages = an older MC: apply as before. RANGE edits work only while the Stick's A58 station lock is unlocked (Item 5 decision, 2026-09-25); MC still accepts `range_edits` with `locked: true` from older firmware. **The reboot rule:** a StickS3 has no clock across a reboot, so after one it reports a LARGE edit age (and `range_edits` ages). A large age is an OLD edit, so MC's value wins at the next `station_config`: an on-station edit that MC never heard before the Stick rebooted is lost. MC treats an age of 24 h or more as "time unknown" (`STATION_EDIT_AGE_UNKNOWN_MS`). A Stick RANGE hold or edit is refused while `lock_s` is active; a RANGE screen closes if the lock starts. MC keeps accepting `range_edits` with `locked: true` from older firmware. **[A68]** `starts_in_ms` is time to go-live relative to MC send time and can be negative after go-live; `ends_in_ms` is time to the known end. MC sends known times in ARMED/LIVE and sends start for untimed matches. `duration_ms` carries a known timed match length from LOAD onward and in ARMED/LIVE; adopted matches omit it. A Stick that missed START anchors go-live and its deadline on the first alive advert with the assigned game byte, at any RSSI, from a player it has already heard down in this game (a phone still alive from the last match cannot anchor); until then it shows WAITING and counts nothing. START timing overrides this fallback. A new game byte clears the anchor. The Stick saves the time left at the anchor, at most every 30 s and as 0 at the whistle, so an offline restart resumes the whistle late by at most 30 s plus the time off. End 0 after end, RECALL or PANIC freezes the hill; abort omits times so the same game can start again. The hill counts only from go-live to deadline, then freezes its owner and `hold_ms`. MC sends no hill `station_update`. A timed HELD Stick carried out before START ends on its local deadline; its go-live error is the delay until it first hears a spawned player. Untimed games and operator or objective ends cannot reach an offline Stick. **[A77, F559]** A control station also gets `capture_s` (integer, 3..60) and `net_cap` (integer, 1..6) when `GameConfig.hill` sets them; a sent value replaces a +/- edit on the hill, and an absent or out-of-range one leaves the hill its own. These two carry no ages, unlike A67's threshold. A Stick saves the pace with its assignment, so a restart keeps MC's pace. |
| `station_update` | `{ id, available, next_spawn_in_ms?, reset? }` | **[A56]** MC → a **powerup** station, on a pickup and at each spawn time, and again on a reconnect. `next_spawn_in_ms` is time remaining (a Stick has no synced clock). `reset: true` marks an operator reset: the station accepts it even for a spawn it already awarded, and refuses a plain `available: true` for that spawn (a re-send after a lost `taken` report). The station advertises state 1 (available, `value` 0) or 0 (taken, `value` = seconds to the next spawn, capped at 255). Behind the powerups flag (docs/spec/powerups.md). |
| `time_res` | `{ t_node, server_t }` | clock-sync reply |
| `pull_log` | `{ reason?: "recap"|"offer"|"manual"|"reconnect" }` | request the offered log. **A25 (2026-09-11) BACKGROUND LOG SYNC:** MC asks every player node at `_finish()` (`recap`), on each `log_offer` (`offer`), from the operator's LOGS button (`manual`) and on the `hello` of a node whose log for the last match never arrived (`reconnect`); the request is gated by the session option `log_sync` (`"auto"` default, `"manual"` = only the button). **The node answers only when it is safe:** never while ARMED or LIVE, and never while its store-and-forward ring holds unacked facts (`ring.pending() > 0`) — game sync has priority (Tony 2026-09-11). A deferred request is remembered and served when the ring drains (5 s → 60 s backoff), and a node that reconnects re-offers (`log_offer`) so MC can ask again; `log_data` chunks are sent one at a time and the next waits for the socket to drain, so a log never starves a fact. The operator sees per node: `log: "none"|"offered"|"pulling"|"held"|"complete"` in `State.nodes[]` (`NodeView.log = {state, reason?, lines?, bytes?, last_t}`). **Server built 2026-09-12:** MC refuses the ask for a utility node (F106(d): a station never binds a match) and once a node passes the ~1 MB per-node budget; only a complete `last`-terminated stream counts as delivered — a half-uploaded log still reads as owed, which is what the `reconnect` ask tests. |
| `ack` | `{ seq_hi }` | MC has durably ingested this node's events up to `seq_hi` (store-and-forward ring-prune signal) [A1] |

### 5a. Store-and-forward semantics (mandatory)

**The gun loop NEVER blocks on the WS.** The engine writes to the gun over BLE and emits `Event`s into an
in-process outbox; the WS layer drains it asynchronously. Two kinds of uplink [A4.4]: **persisted facts**
(every `PERSISTED_EVENT_TYPES` member, §4) get the node's next `Envelope.seq` at enqueue, are appended to a
**bounded, persisted ring** (`app/src/transport/ring.js`; ~500 facts or 2 h, whichever first; overflow drops
oldest and counts `dropped`) and are replayed until MC `ack`s them; **live-only** messages (`status` and the
other `NodeMessage`s) are sent iff bound and never queued (a queued heartbeat would flush minutes of stale
snapshots at reconnect).
- On reconnect the node sends all un-acked facts as `event_batch`es (≤200/batch, oldest first). MC dedups by
  `(node_id, seq)`: `seq ≤ last_applied` is a replay → dropped silently; `onEvent` fires only for facts that passed.
  The wiped-install hole (a fresh app restarting at seq 0 and having every real fact dropped) is closed by
  `hello.seq_next` / `welcome.seq_hi` [A4.5]; MC logs `seq_next < seq_hi` as "node storage reset".
- A fact MC refuses stays un-acked: the ack stops below its seq (for a fact whose seq MC can read), and the
  phone resends it with its other un-acked facts on the next reconnect. If MC refuses it twice,
  or it is not resent within 400 later facts, MC acks past it and marks it lost. The feed gets one ALERT line
  naming the player [A73, F513] (`net.py` `_ack_hi`, `_give_up_holes`).
- The ring may legitimately hold match-N facts when match N+1 starts; the node does not filter, MC **parks**
  by `match_id` [A4.3].
- `feedback`/`start`/`control`/`assign`/`config` are **best-effort and never ring-queued**; the node's own loop
  never depends on receiving them (start uses the pre-shared `go_live_t`; end uses `go_live_t + time_limit_s`).
  MC→node context (`assign`/`config`/`start`) **is persisted by the node** as its current context (node.md §3.7);
  `welcome` re-hydrates it anyway.
- **Heartbeat + staleness.** `status` every `STATUS_HEARTBEAT_MS` is the liveness signal; MC→node liveness rides
  server WS ping/pong. No frame for `STALE_AFTER_MS` → the node is **stale, not gone**: the board shows last-known
  + a staleness age; a node leaves the roster only on host removal or session end. On a large field most nodes
  are stale most of the match, and the board must read that as normal.
- **Reconnect / backoff.** Exponential backoff + jitter (base 500 ms, ×2, cap 10 s, ±20%; resets on `welcome`;
  `transport.js:21`). **While ARMED or LIVE the retry is unbounded.** Re-resolve via discovery only if the cached
  URL fails several times *while `ssid_ok`*.
- **Field reality [A4.8]:** on a large field most nodes are out of LAN range for most of the match. Config +
  start + sync happen at the lobby; kills/hits/assists/K-D reconcile at **sync points** (a base or respawn
  station inside router range, or recap); live kill-confirm and a live individual board are **coverage-zone
  features**. Nothing about the match outcome depends on coverage. A second mesh AP at a far base (same SSID) is
  the cheap way to add a coverage zone and needs no protocol change.

### 5b. Security on an open field LAN [A8]

Plain `ws://` on a private LAN (TLS deferred); defence is at the message layer. **Version gate:** an envelope
whose `v` MC cannot speak is refused with a close and a log line; unknown fields are ignored, only a `v` bump is
a hard gate. **Validation:** every inbound envelope is schema-checked (`envelope.js`, `envelope.py`); malformed →
dropped + counted, socket kept (> ~20/s malformed → closed). **Size cap** 64 KB per envelope. **Rogue clients:** a
socket that never sends a valid `hello` is quarantined. **Operator auth [A8.1]:** the MC HTTP API + `/ui-ws` gate
mutating requests behind a per-launch operator token (`Authorization: Bearer` or `?tok=`); read-only GETs stay
open for a spectator board, with headset PINs blanked unless MC runs with `--no-auth` (API.md → Operator auth); `State.lan.auth_required`. **Node re-claim key [A8.2]:** `welcome.node_key` is a
per-node secret; a `hello`/`bind` that takes over a **still-live** node_id or gun must present it, else `4003
in_use`. A stale holder (no frame for `STALE_AFTER_MS`) is displaced without a key (legitimate hot-swap of a
dead phone); the displaced owner's key is remembered so a returning keyed owner wins the gun back once the
displacer goes stale; the operator can `DELETE /api/nodes/{id}` either one. **Hardening [A8.3]:** config/roster/
start inputs are whitelisted + range-checked (a bad value is a 4xx, never a 500); CSV export neutralises
spreadsheet-formula injection; `ready`/`ack_config` trust the server's node↔player binding, not a client id;
pulled-log bytes and unbound hello-only node records are capped. Facts are claims a lying node can only use to
corrupt its own score line; there is no wire command that lets one node write another node's gun.

### 5c. Platform network gates (blocking; live in `app/scripts/*-setup.sh` + preflight)

| # | Gate | Symptom if missing | Fix |
|---|---|---|---|
| (a) | **iOS ATS** does not exempt `ws://` to an IP literal | WebView refuses the socket, silently | `NSAllowsLocalNetworking = true` via `ios-setup.sh` |
| (b) | **iOS Local Network privacy** | LAN + mDNS silently blocked; no prompt | `NSLocalNetworkUsageDescription` + `NSBonjourServices: ["_openbrx._tcp"]` via `ios-setup.sh` |
| (c) | **Android cleartext** blocked on API 28+ (`allowMixedContent` is not this) | `ws://` refused | `usesCleartextTraffic` / network_security_config via `android-setup.sh` |
| (d) | **No-internet Wi-Fi is deprioritised** — the default route may go to cellular | "connecting…" forever with full bars | **Never a player step** (Tony, 2026-09-23: players do not change connection settings). Android: the app opens the MC socket on the Wi-Fi network for a LAN URL (`app/plugins/brx-net`, per-socket network choice; in build 2026-09-23, unproven on a phone until its bench row). Until an app carries it, the HOST turns the tunnel on and the phone reaches MC over mobile data by itself. iOS keeps local-subnet traffic on Wi-Fi. Preflight `ssid_ok`, `mc_reachable` are diagnostics |
| (e) | **Auto-rejoin after walking out of range** may be off | nothing syncs at the base; recap empty | preflight `auto_join_ok`; per-OS muster step; MC's Network screen names the SSID |
| (f) | **Mobile data** re-routes on some OEMs | as (d) | as (d); preflight `cellular_off` is a best-effort DIAGNOSTIC for the board, never an instruction to the player |
| (g) | **Calls / notifications** suspend the webview | timers stop (node.md §3.11) | Do-Not-Disturb on; preflight `dnd_on`; the resume→reconcile path |

Any of (a)–(e) failing is a **red** on the readiness board for that node, with the gate named.

### 5d. Backhaul — a phone with its own data path reaches MC off the field Wi-Fi [A28]

**Why.** ADR-0002 §Context 5 named the two-radio phone and deferred it. A28 takes the half that costs a player
nothing: **a phone that has a data plan uses it to reach MC when the field Wi-Fi cannot**, so its kill confirms,
score, result and log pull keep landing across the whole park. Nothing about the match outcome depends on it (A4.8
still holds); a phone with no data plan behaves exactly as before. **No per-phone setup, ever:** the whole thing
rides in the join QR and `welcome`.

**A28.1 The public node socket.** MC may expose **the node socket port only** (never the operator API) through a
tunnel. `State.lan.public = { ws_url: string|null, status: "off"|"starting"|"up"|"error", provider:
"cloudflared"|"manual"|null, available: boolean, error?: string }`. `POST /api/tunnel {on: boolean}` (operator
token) starts or stops `cloudflared tunnel --url http://127.0.0.1:<ws-port> --no-autoupdate` as an MC **child
process** (dies with MC; nothing to clean up); MC reads the `https://<x>.trycloudflare.com` line from its output
and sets `public.ws_url = "wss://<x>.trycloudflare.com/ws"`. That is Cloudflare's **quick tunnel: no account, no
domain, no login** — the one path a stranger who cloned the repo can use; its hostname is random per start, which
is why the node holds the LAN URL as well (A28.2). `available` = the `cloudflared` binary was found on PATH at
launch; when it is not, the UI shows the install line, never hides the control. `--tunnel` (start on boot) and
`--public-url wss://…` (`provider:"manual"`, for a named Cloudflare tunnel, Tailscale Funnel or a port forward)
are the CLI forms. **F595 (Tony 2026-10-24): MC also starts it by itself, during kit and never at ARM,** on the
first config push with a phone bound and on a bound phone's first `status.transport: "cellular"` in KIT..LIVE. Each
trigger tries once a session, never blocks the push or ARM, and a refused start is one log line plus
`public.auto.error`. `public.auto? = {reason: "kit"|"cellular", cellular?: int, error?: string}` says why (the
count is bound, fresh phones on cellular now). An operator OFF holds until Mission Control restarts or a new session starts (NEXT MATCH keeps it; each new match gets fresh trigger tries); `--no-tunnel` turns the
triggers off and leaves the switch; `--demo`, `--ephemeral` and `--fake-net` never fire them. No `starting`→`up` within 20 s, or the process exiting, is `status:"error"` with the last output
line in `error`; `ws_url` goes back to null. The tunnel is **opt-in and additive**: the LAN path is untouched and
the host needs internet for it to come up; without internet it errors and phones stay on the game network.

**A28.2 The two-URL join.** `lan.qr` becomes `ws://<lan-ip>:<ws-port>/ws?s=<join_secret>[&pub=<url-encoded
public ws_url>]` — the LAN URL first, the join secret always, the public URL when `public.status == "up"`.
`Session.join_secret` is 8 url-safe chars, random per session and **persisted with the session snapshot** so a
restore keeps every printed QR valid. It is `secrets.token_urlsafe(6)`, about 48 bits: enough against guessing at the
rate a socket can connect, and it is not a password. The node splits the query off before dialling (`mcurl.parseMcJoin` →
`{ url, pub, secret }`; `parseMcQr` keeps returning the bare LAN URL for old callers) and stores all three.
`hello` gains `via: "lan"|"backhaul"` (which URL this socket dialled) and `secret?`. **`welcome.join = { pub:
string|null, secret }`** hands both to every node on every welcome, so a phone that joined over the LAN before
the tunnel existed, or typed the address, learns them without rescanning; a change of the USABLE public URL (up with a new hostname, or gone) is pushed to every
connected node as MC→node **`join {pub, secret}`** (same body); `starting`→`error` with no URL ever offered pushes nothing. **The secret is enforced only where it matters** (rule tightened by the 2026-09-12 review): a hello must carry
the current secret when (a) its peer address is **not private** (not loopback, RFC1918, link-local or ULA) — always,
so a `--public-url` fronted by a plain port forward is covered — or (b) its peer is loopback or carries a
`Cf-Connecting-Ip` header **while the gate is armed**, where armed = MC owns a tunnel child it has not confirmed dead,
or the provider is manual. The gate keys on the CHILD PROCESS being alive, never on `public.status`: a reader hiccup
that flips the status to `error` while cloudflared still routes must not disarm it, and MC only declares `error` after
`proc.wait()` returns. A failing hello is closed `4004 no_secret` and leaves no record. A LAN hello is never refused for
lacking a secret (typed address stays the mandatory floor, §5). On a hard MC crash the child is orphaned, so MC
records its pid and reaps a leftover at the next launch. Local tooling that dials the node socket over loopback while
MC was started with `--public-url` must present the secret. The secret is readable
by anyone on the LAN via `GET /api/state`, deliberately: the LAN is already the trust boundary (§5b); the secret's
one job is keeping internet strangers off the node socket.

**A28.3 Reach policy on the node: the LAN is primary, backhaul is the FALLBACK.** The Transport holds `{ url, pub }`.
Every dial pass starts on **`url`**. A LAN attempt fails when it gets no welcome. That covers four cases: no event
within `LAN_GIVEUP_MS = 8000`, a socket that cannot be created, a close other than a 4001/4003 refusal, and an open
socket with no welcome within the 5 s hello timeout (`helloTimeoutMs`). After a LAN failure the node dials `pub` at
once, with no backoff consumed. It does so only when it holds a `pub` and the dial is not an A60 verify dial. A `pub`
attempt fails the same way, with `BACKHAUL_GIVEUP_MS = 8000` as its bound. A `pub` failure ends the pass: the node
goes offline, waits the normal reconnect backoff, and starts the next pass on the LAN. A 4001/4003 over either leg
is terminal. With a `pub` held, the `connect()` deadline is at least `LAN_GIVEUP_MS + helloTimeoutMs + BACKHAUL_GIVEUP_MS + 2000`, so
a cold start off the Wi-Fi does not reject a dial that is about to bind. While bound on the LAN the node **never
probes `pub` and never drops the LAN for it**. A phone riding `pub` stays there until that socket drops, and its
next pass is LAN first. `join {pub:null}` while on `pub` still drops to the LAN. With no `pub` the loop is the plain
LAN loop. This rule replaced the 2026-09-12 pub-first rule and its 30 s `PUB_RETRY_MS` probe (F595, 2026-10-24).
The reason: MC now starts its tunnel during kit and pushes `join.pub` to every phone. A pub-first ladder would move
every phone's redial into the config-ack window, and a Wi-Fi-only phone (no data plan) cannot reach `pub` at all.
The ring covers the gap of any switch. Coverage stays **observed** (A28.4): a phone is on backhaul only while it
actually rides the tunnel, which now means it lost the LAN. Traffic is tiny (a status every `STATUS_HEARTBEAT_MS` plus events, well under 1 MB/h) and the added
round trip through the tunnel edge touches nothing time-critical (§7 start/end are pre-shared; feedback is
best-effort). `status.reach: "lan"|"backhaul"` reports the live socket's path as the phone sees it, but **MC stamps `NodeView.reach`
itself from the socket's arrival path** (the same test as the secret gate) and never from the claim: coverage and the
readiness amber are server facts. The node never opens a second socket to MC: the server's one-socket-per-node
takeover rule would kill the live link.
§5c gates (d) and (f) become **warnings, not reds**, for a node that reports `reach:"backhaul"`.

**A28.4 Coverage is derived, no longer asserted.** `Session.coverage()` counts the bound player nodes connected with
`reach == "backhaul"` (`on_backhaul`), and those that also report `status.transport == "cellular"` (`on_cellular`,
F309, below). **`level` is `"full"` iff every bound node is `on_cellular` (connected, so not stale)**, else `"zones"`. **[F595, 2026-10-24]** With A28.3's LAN-first fallback, `on_cellular` also counts a node on a live LAN socket that
reports `cellular` and whose last status said `has_pub: true`: it holds `pub`, so MC still hears it after it leaves the
Wi-Fi. The phone says so itself, so a phone that missed the `join` push does not count. An older app sends no
`has_pub` and does not count. A just-closed LAN socket has no `reach` and does not count. A node that reports `wifi`
proves no data plan and never counts. It rides on the snapshot
as `coverage: { level, on_backhaul, on_cellular, bound }` and is passed to `Compiler.validate(..., {coverage})` at config validation and at the lobby push. Full
coverage **clears the A6.1 frag-limit warning and makes frag-limit / survival ends authoritative** (`scoring.frag_limit`,
`win_by:"survival"`). It does **not** unlock `time_limit_s: null`: a cell signal is less trustworthy than a venue
assertion, and a phone that loses data mid-match must still hold an end it can reach alone — that clause of A4.8
stays a venue assertion, which nothing sets today. A mode may declare `requires_coverage: true` in its `PARAMS`
(A18); the lobby push refuses it (`409 {error, coverage}`) unless coverage is full at push time. No catalog mode
does yet; the hook is reserved for modes where MC knows something no gun can (bounties, VIP swaps, park-wide
zone control). **F256 (2026-09-23):** `reach` names only the URL a phone joined through, never the path it rides:
two phones on one Wi-Fi behind one tunnel read 2 of 2 on backhaul and are a single point of failure. `level` was therefore
always `"zones"` until a node reports an independent transport of its own; `on_backhaul` stays the count of phones that
joined through the tunnel, and the console shows it as that fact, never as coverage. **F309 (2026-09-23):** the node now
reports its own connection on every heartbeat, `status.transport?: "wifi"|"cellular"|"none"|"unknown"` (Capacitor
Network `connectionType`); absence or junk clears the last claim. **The bind rule** (`transport.js _claimedTransport`): a
bound socket keeps riding the network it opened on, and Android's "switch to mobile data" moves only the default
network. So the node claims `cellular` only when the network at bind time AND the current network are both cellular.
When the current network is cellular and the bind-time one is not, it reports the bind-time value (`unknown` if it has
none). Otherwise it reports the current value. A node never told its connection (web, tests) omits the field. An independent path is BOTH facts: `transport` (the phone's claim, the one fact only it has) is `cellular`, AND
the path is the tunnel: `reach` (MC's stamp from the socket) is `backhaul`, or `reach` is `lan` and the phone's last
status said `has_pub: true` (F595).
`Session._independent_path()` is the one test, and the A31 off-grid check (`_off_grid()`) uses it too. A phone could
lie about `transport`; the cost is a frag cap called on a phone that later misses it, and the time limit is still the
backstop. The console chip reads `Internet: N of M phones · K on cellular` and is green only at `"full"`.

**A28.5 Unchanged.** Kill confirm needs the victim's report and the shooter's feedback, each over whatever path
that phone has; `FEEDBACK_MAX_AGE_MS` still drops a late one. Autonomy (node.md §3.7) is untouched: a phone that
loses both paths plays on. Coverage-zone features are now simply "wherever this phone reaches MC".

## 6. Node lifecycle (state the HUD + MC both reason about)

```
IDLE ─setGun─► CONNECTED ─assign(player+team)─► KITTED ─[all-ready → config(bundle)]─► LOBBY ─start(seq,go_live_t)─► ARMED(countdown)
                                  ▲   (ready toggles in KITTED; tutorial here)   (head written, unspawned)              │
                                  └──── end / recall / panic / local time-expiry ◄──── LIVE ◄──────── T = go_live_t ────┘
LIVE: {ALIVE ⇄ DOWN(respawn timer)}. LIVE ends on `end`/`recall` OR local time-expiry (go_live_t + time_limit_s;
      none when time_limit_s == null, full-coverage venues only) — whichever first; teardown = frames.end +
      cues.game_over, idempotent.
ARMED ends early on `abort_start` → LOBBY (gun still holds head). `recall`/`panic` from ARMED → KITTED.
IDLE = no gun linked. CONNECTED = gun, no player. KITTED = gun + player, no game on the gun. **A finished, recalled or
      panicked match returns to KITTED** [A5.9, superseding A4.6] — the player is still kitted; a rematch is a new `config` push → LOBBY.
Link state (WS up/down) is orthogonal to all of the above [A2]; BLE link state is orthogonal too, with the
      reconcile rule below.
```

**BLE reconnect [A6.8, 2026-09-04, validated on hardware; supersedes A5.3/A6.6 for LIVE].** The node persists and
restores `alive/hp/armor/shield/deadAt/killedBy` across an app kill, so a live rejoin no longer probes the gun to
reconstruct state. It opens a 3 s disarmed `reconciling` window (`RECONCILE_MS`): disarm both slots
(`$AMMO,0,0,0,1`), keep the restored pools, then re-arm to the real spawn `$AMMO` **only if alive** — never
`$SPAWN`/`$PSET`, so a rejoin can never heal. **No death is inferred**; only a real `$HP,0` mid-window books
`death{desync:true}` (latched `$HIR` within `DEATH_LATCH_MS`, else `shooter_num:0`) with the true respawn timer.
This closes the force-close-at-low-HP free-respawn cheat. The A6.6 trigger-first evidence protocol (a `$BUT`
without `$ALCD` is also a dry-fire or an unconfigured gun, so it never means "dead" on its own) survives **only
for LOBBY/ARMED reconnects and resume** (head re-write). `respawn{resync:true}` is retired for the live path.
Details: node.md §3.10.

## 7. Clock sync (drives the dispersed start and the dispersed end)

- **Tie band (`CLOCK_TIE_MS`, 1 s) [A24/M2].** Clocks agree to well under a second after a lobby re-sync, so MC cannot order two kills inside that band and does not try: two sides reaching the frag cap within it are reported as `winner.tie`, never decided by MC's arrival order.

Nodes and MC agree on time so a pre-shared `go_live_t` fires together without a T-0 signal, and
`go_live_t + time_limit_s` ends the match without an end signal.
- On connect and periodically, node sends `time_req{t_node}`; MC replies `time_res{t_node, server_t}`.
  Node computes `rtt = local_now() − t_node`, `offset = server_t − (t_node + rtt/2)` (NTP-lite, symmetric path).
  `welcome.server_t` seeds the first estimate.
- **Smoothing** (`app/src/transport/clock.js`): a burst of ~5 `time_req` on connect, keep the smallest-rtt
  sample, then an EWMA (α≈0.2), rejecting any sample with rtt > 3× the running median. Full burst again at lobby;
  a single `time_req` every 5 s while connected (`syncIntervalMs`); re-burst after any reconnect, and on
  `control{clock_resync}` [A71] (a forced burst: the EWMA alone would take about ten samples to walk off a minute). A reconnect burst on a synced clock stays on the EWMA, except that a burst whose best sample differs from the held offset by more than `CLOCK_STEP_MS` snaps to it [F477], so a wall-clock step made while offline does not walk off over ten samples.
- **synced_now() = local_now() + offset.** All `go_live_t`, expiry, respawn and event-`t` math uses synced time.
  `synced()` = a sample fresher than `SYNC_FRESH_MS`; it gates ready-up (M-START §4) and rides `status.synced`.
- Phone clocks drift ≪1 s over a match; re-sync at lobby is enough, unless the phone's wall clock steps (an NTP
  correction, a user change): MC detects that and asks for a re-sync [A71]. A node that never synced falls back
  to counting `now + duration` from the moment it *received* `start` (degraded, logged, `status.synced=false`);
  MC scores its events on `t_recv` [A4.7] and suppresses its window awards [A5.7].

## 8. BRX frame contract (what a node writes to the gun)

Nodes write **`FrameBundle` frames verbatim** (§3) plus the two literal templates (`$SFLASH,*`, `$PLAYX,0,*`)
and the pre-config probe set. All frames are compiled by M-MODES in MC from the known-safe set
(`protocol.py`). Canonical references (do not restate — link): arm/spawn/respawn, `$WEAP`/`$GSET`/`$PSET`,
player id (`$PSET` token 1 / `$HIR` token 3, §7p/§7q), feedback (`$SFLASH` + token-4 `$PLAY`), battery
`$VOLTS`, hit `$HIR`, health `$HP`/`$LCD`/`$ALCD` — all in `protocol/brx-protocol.md` +
`protocol/callsign-extract/`. **Panic:** `$CLEAR,*` then `$SP,99,*` (leaves no `$SIR` table: re-arm before play).
Volume per §3. BLE writes chunk at 20 bytes (§app).

## 9. Versioning, identity tokens, constants

- `Envelope.v` gates protocol compatibility; `app_ver`/`server_ver` are informational.
- **Store versions [D15].** Three files MC persists carry `v`: `pieces.json` (`PIECES_STORE_V`), `favourites.json`
  (`FAVOURITES_STORE_V`) and the session snapshot `session.json` (`SESSION_STORE_V`), all in `types.py` and all in
  `~/.brx-mcp/`. The pieces and favourites loaders never guess a migration: a file whose `v` they do not know (one a
  newer MC saved, read after a downgrade) is kept whole as `<name>.v<v>-<UTC stamp>`, logged, and the store starts clean; a file
  they cannot parse goes to `<name>.corrupt-<UTC stamp>`. If that move fails, the store stops saving for the run and
  MC says so at startup (it never overwrites a file it could not keep). A file with no `v` is the first shape and loads. The session store
  is enforced too, by `SnapshotCodec` in `mcp/brx_mcp/mc/snapshot_codec.py`: a snapshot with no `v` loads, and one
  whose `v` is anything but the integer `SESSION_STORE_V` is kept as `session.json.v<v>-<stamp>`, the session starts
  clean, and `restore_failed` tells the operator why. Bump a store's `v` only when an older MC would misread the new
  shape. `armory.json` and the evidence database `session.sqlite`
  carry no version.
- **Phone store versions [A72].** The phone app's `localStorage` keys are indexed in `app/src/storekeys.js` (key, owner, what it holds, versioned or not); read the list there, this section copies none of it. The HUD uses the `brx.` prefix and the utility (station) page keeps its transport keys under `brxu.`. Two blobs carry `v`: `brx.engine` (`ENGINE_STORE_V` in `app/src/engine.js`, the match context a restart must survive) and `brx.outbox` (`RING_STORE_V` in `app/src/transport/ring.js`, the persisted fact outbox; `brxu.outbox` on the utility page). A blob with no `v` is version 1 (an older build) and restores as it was. A blob whose `v` the build does not know is not restored: the owner starts clean and logs one line naming the key and the `v`. Every other key is unversioned. Add a row to `storekeys.js` with any new key, and bump a `v` only when an older build would misread the new shape.
- **Three distinct `seq` namespaces** [A2] (do not conflate): `Envelope.seq` = per-node persisted-event counter
  (dedup); `start.seq` = MC's per-session schedule counter; `control.seq` = a reference *to* a `start.seq`
  (which schedule an `abort_start` targets).
- **Identity tokens:** `config_id` = identity of a pushed `GameConfig` (+ its `FrameBundle`); `match_id` =
  one scheduled play of a config (minted in `start`) [A4.3]. The same `config_id` can be played twice; `match_id`
  never repeats. A node keys "is my stored config current" on `config_id` and "which match are my events
  for" on `match_id`. `CONFIG_TTL_MS` bounds how long a stored config is trusted without a refresh.
- Post-freeze changes: add an index row in §10, fold the text in where it applies with its tag, and bump `v` only
  for wire-breaking changes once a consumer is deployed. Additive fields are non-breaking; consumers ignore
  unknown fields.
- **Constants.** The single source is `mcp/brx_mcp/mc/types.py`'s module-level block. `mcp/tools/gen_contract.py`
  generates it into `app/src/transport/contract.gen.js` (which `envelope.js` re-exports, and `engine.js` imports as
  `W`) and `webapp/mc/src/api/contract.gen.ts` [A33], and
  the Stick's `hardware/m5sticks3/contract.gen.h` [A70] (architecture review #4). Read the values there; this section names them and copies no
  numbers. The shared constants: `ASSIST_WINDOW_MS`, `MULTI_KILL_MS`, `FEEDBACK_MAX_AGE_MS`, `STATUS_HEARTBEAT_MS`,
  `STALE_AFTER_MS`, `SYNC_FRESH_MS`, `CLOCK_STEP_MS`, `LATE_ARM_GRACE_MS`, `CONFIG_TTL_MS`, `MAX_PLAYERS` (wire ids from 1; 0 is
  reserved), `DEATH_LATCH_MS`, `RESYNC_PROBE_S` (the LOBBY/ARMED observe window) and `DEFAULT_RUNWAY_S` (host-set per
  game [A5.10]). `MAX_HP`/`MAX_AR` come from the GameConfig. Two timings are local to one side and not on the wire:
  the node's rejoin window (`RECONCILE_MS` in `app/src/reconcile.js`, A6.8) and MC's role settle delay
  (`Session.ROLE_SETTLE_MS` in `mcp/brx_mcp/mc/state.py`). `test_contract_generated.py` checks that every shared name
  above is in the generated file.
  Since architecture review #4 (2026-10-04) [A70] the generator also carries tables, each opt-in by name (`_TABLES` in
  `gen_contract.py`): the station presence defaults (`STATION_DEFAULT_THRESHOLD_DBM`, by platform and kind, and
  `STICK_HILL_ADVERT_THRESHOLD_DBM`, the -57 a defaulted Stick hill advertises in byte 14), the team vocabulary
  (`TEAM_KEYS`, `TEAM_NAMES`, `TEAM_ABBRS`, colour and ink hex by `$TID`), `ROLE_LABELS`, the presence and hill
  numbers (`PRESENCE_*`, `HILL_*`), the config and powerup-override bounds, the `$SIR` function classes
  (`SIR_NO_POOL_FNS`, `SIR_GRANT_FNS`) and `PANIC_SEQUENCE`, which `mcp/brx_mcp/protocol.py` owns.

## 10. Amendment index (dates; what; where it now lives)

Rows dated before 2026-09-27 are one line each: the title and where the rule now lives. Their full text is in [`archive/contracts-amendments-2026-08-to-09.md`](../archive/contracts-amendments-2026-08-to-09.md). Ids are never reused.

| id | date | what | folded into |
|---|---|---|---|
| A84 | 2026-10-27 | AN ASSIGN NAMES THE MATCH IT BELONGS TO (F634, Tony via brx1: complete all tasks). F632 kept a phone's results only on an assign marked `recap: true`, sent in RECAP only. A timed match ends on each phone's own clock up to about 0.5 s before MC reaches RECAP (longer during an O8 tick failure), so an operator edit in that window left the results, cleared the match id and dropped the whistle's result as `no_match`. Now every assign carries `match_id` while MC holds a match (armed, live or RECAP), and the phone keeps its results only when that id equals the match it ended. NEW SESSION, RECALL and any assign outside a held match name none, and the results go as before. `recap: true` is kept in RECAP as a deprecated alias for a phone built between F632 and A84; the phone reads it only from an MC that names no match. A phone older than F632 ignores both and behaves as before. | §5 `assign`; `state.py` `_assign_body`; `engine.js` `_assign` |
| A83 | 2026-10-26 | THE RESULT WAIT IS BOUNDED (Tony via brx1). `SYNC_STUCK_S` (120 s, the FINALISE highlight) after the whistle, on MC's monotonic clock, MC releases the result without the phones and control hills still missing, so a hill that is off or out of range no longer blocks it. A restart keeps the time left, less the time MC was down by the wall clock (a forward step can release it early); a snapshot from before A83 is timed from `end_t`. FINALISE still releases at once. A late sync after the release merges in and re-sends `result`. A node that still owes facts for the match (its last beat still `armed`/`live`, a positive `pending`, or a late batch with no ended empty-queue claim after it) gets no `result` (push, `welcome.node.result` or the A34 stale-live answer) and no `victory` cue until its own queue drains (a winner that drains after the release gets the result, not a late cue); the beat that drains it sends the result, so a late phone's first result is the one its facts made. FINALISE and the bound do not override that: a phone whose outbox is wedged above zero stays on RESULT PENDING. After an MC restart only a hello's `pending` restates the debt, so a phone older than A78 (no `pending` in its hello) is not withheld; the phone shows RESULT UPDATED only if it already held a result for that match with a different `winner` or `outcome` (no new wire field), and the console keeps its match-level RESULT CHANGED. A pending-0 status counts as received only when it names this `match_id` with an `arm_state` past `armed`/`live`, so a beat the phone sent before its own end facts were booked cannot release the result. A phone that sends no `match_id` (older than A78) is therefore never received and waits for the bound. The console's `RecapSyncView` gains `released_by` (`sync`/`timeout`/`finalise`) and, while pending, `release_in_s`: RECAP and LIVE name the missing phones and hills while they wait (WAITING FOR ECHO, CONTROL POINT 1; past three names A, B, C +2 more; a count only when that is longer than 48 characters; SPECTATE keeps the count) and counts down FINAL IN m:ss (each second left is a snapshot change, so it moves on a silent field and a crash keeps the time left) and a bound release reads FINAL AFTER 2 MIN WITHOUT the rows missing. | §5 `result`, §4 recap sync; `state.py` `_release_on_timeout`, `_sync_status`; `types.py` `RecapSyncView`; `Recap.tsx`; node.md §3.13 |
| A82 | 2026-10-25 | TIME-TO-KILL WAITS FOR THE HEADSET WORD (F614, brx1's call from the F602 review). `WeaponCatalog.time_to_kill()` and `ttk_ms` add `HEADSET_WORD_LAG_MS` (88) when the last pull's gun word does not finish the target, so the kill lands on the headset word: the Shotgun at 115 (0.89 to 0.97 s), the SMG at the Hardcore 45. Catalogue `stats.gun_hit?: number` (the gun word alone) lets `weapon_view()` apply the same rule at the host's pool. No wire change. | §3 catalogue `stats`; `compile.py` `HEADSET_WORD_LAG_MS`, `headset_lag_ms`, `time_to_kill`; `views.py` `weapon_view`, `kill_ms` |
| A81 | 2026-10-25 | THE PHONE WAITS FOR THE RELEASED RESULT (Tony via brx1: phones show "Result pending" until MC releases the result, so no provisional winner shows at the whistle; a late phone after FINALISE can still move it, as RESULT CHANGED does on MC). MC withholds `result`, `feedback{kind:"victory"}` and `welcome.node.result` until `match.released`, and withholds `score` (push and `welcome.node.score`) in RECAP until release, which latches when every phone bound at the whistle and every control hill is received, or the operator presses FINALISE (F596). At the release edge MC pushes `result` once to every bound player node. It sends `victory` only when both its monotonic and wall clocks put the release within 30 s of the whistle, because a sting minutes late reads as a new event. A later move of the recap re-pushes `result` as before (RESULT CHANGED). A match with nothing pending releases at the whistle and behaves as before. After an MC restart MC never sends `victory`. A released match sends `result` and `score` to each phone as it reconnects (and in `welcome.node.result`); a match still pending sends them at its release. The phone needs no new field: with no `result` it shows its own stats under RESULT PENDING beside the sync track (A5.11), and says MC NOT REACHED only when it has not reached MC since the whistle and is off the link 30 s after it. Additive: an older phone sees the result later. | §5 `result`, `feedback`, `welcome`; `state.py` `_finish`, `_push_result`, `_recap_sync`; `app/src/hud/result.js`, `engine.js` `resultWait`; node.md §3.13 |
| A80 | 2026-10-25 | HONEST LOADOUT PICKERS (Tony via brx1: "picking Armour Piercing and then finding out at config push that the chosen weapon cannot carry it is not fun"). `PerkView.blocked_presets?: string[]` = the `health.preset` values the perk is refused under (`Compiler.preset_block`, read from its effects: `armor_piercing` or a positive `max_armor_add` on `shields`). `LoadoutPool` drops such a perk, and a fixed one empties the perk slot with the new `PoolEmptyCode` `preset_blocked`; a preset switch runs `apply_policy`, so the perk clears from every loadout with no warning. With a perk held, the phone and the console offer only the weapons outside its `blocked_primary`/`blocked_secondary`. A phone WEAPON pick that drops the held perk is acked with no `dropped` and no `reason`. Additive: an older phone ignores the field, and MC still clears the perk. | §3 `PerkView` note, §5 `loadout_ack`; `types.py` `PerkView`, `PoolEmptyCode` (generated contract); `compile.py` `preset_block`; `policy.py` `pool`; `app/src/hud/loadout.js` `_loRows`; `webapp/mc/src/rules/loadoutPolicy.ts` `computePool` |
| A79 | 2026-10-24 | THE EMP PERK (Tony via brx1: in place of the Haze weapon; hidden until `bench-0426.md` P2.5-P2.11 pass). `FrameBundle.emp?: {cooldown_s, duration_s}` on every bundle of a match with a holder, and the live `$SIR` table gains `$SIR,8,1,,23,0,0,1,,*`. The holder presses LEFT (`$BUT,4,1`, blocked by `$BMAP,4,98`) and the phone writes `$IRTX,100,8,<player>,<own tid>,1,0,1,100,1,,0,*`; a victim's phone treats a `$HIR` on <8,1> as the F15 stun for max(`duration_s`, SMOKE_MS), because fn 23 leaves the gun's accuracy at 0 for about 6 s (bench 2026-09-18) whatever the phone does; the placeholder is 6 s. A teammate's word (team match: the thrower's team from `$HIR` token 4, the roster only when token 4 is absent) and a word inside spawn protection jam nothing; in FFA only the thrower's own word is ignored. A failed `$IRTX` write gives the throw back only when the frame never left the phone. A late joiner whose match was pinned without an EMP gets no `emp` key and its HUD shows EMP OFF. Additive: an older phone ignores the key, and the row is inert with no thrower. **On an older victim phone** fn 23 still zeroes the gun's accuracy for about 6 s, and its smoke check may show a SMOKE readout with no jam. `validate()` warns when the live table passes `hitaudio.MAX_SIR_ROWS` (an EMP holder, a Breacher and a Toxin Rifle make 15). | body §3 (`FrameBundle`); `compile.py` `_EMP_SIR_ROW`; `engine.js` `_empThrow`; docs/perk-design.md §3 |
| A78 | 2026-10-24 | THE PHONE SAYS HOW MUCH IT HAS LEFT TO SEND (F595; field 2026-10-17: MC's sync board could not see SENDING, because the first `pending` arrived with the batch, and `pending: 0` reached MC one 2 s heartbeat late, because the beat that rode with the batch read the outbox before the ack pruned it). `hello.pending?` = the unsent fact count when the socket opens. An ack that empties an outbox of more than one fact sends a fresh `status` at once (the app's status body now, never a replay); a live fact's own ack does not, so play costs no extra frames. **2026-10-26 (F595, `Transport.setUrgent`):** from the end until the result arrives, the phone sends one `status` at the end if its outbox is empty, any ack that empties the outbox sends one, and the reconnect backoff caps at 2 s instead of 10 s, because A81 holds every phone's result until this phone reads pending 0. It lasts at most 10 minutes after the whistle (`SYNC_URGENT_MAX_MS`), and it never shortens the 4003 stale-holder wait. Additive: an older MC ignores the field, and MC falls back to "no status since the whistle yet" without it (F596). | §5 `hello`, §4 `status` sketch; `app/src/transport/transport.js` (`_helloBody`, the `ack` branch of `_onFrame`); `app/test/transport.test.mjs` |
| A77 | 2026-10-18 | MC CAN SET A HILL'S PACE (F559; field 2026-10-17: `capture_s` and `net_cap` were only +/- buttons on each hill phone, so the operator could not tune hill pace without walking to every point). `station_config` gains optional `capture_s` (integer seconds, 3-60) and `net_cap` (integer, 1-6) for a `control` station. Present: the station takes it on that arming, so MC's value wins on every arming that carries it. Absent or out of range: the station keeps its own, so an older MC changes nothing. No ages, unlike A67's threshold: the station keeps no edit record for these two, so MC cannot tell which side moved last; a phone station's +/- edit holds until the next arming that carries a value. A Stick saves the pace it runs with its assignment, so a restart keeps MC's pace. MC sends it from the game config (`hill: {capture_s?, net_cap?}`, F559's MC half). | §5 `station_config`, §3 `GameConfig.hill`; `app/src/stationconfig.js`; `app/src/utility.js` `applyStationConfig`; `hardware/m5sticks3/station_link.h` (`parse_station_config`, `apply_station_config`, the storage body); `app/test/fixtures/station-config-cases.json` (both runners); `utility.md` §5d (A67 note) |
| A76 | 2026-10-18 | AN AMMO PICKUP STATION ITEM (Tony, field 2026-10-17: "we need to add ammo pickups, i ran out of ammo in several games"). A powerup station can carry `{kind: "ammo", refill: "spawn", name: "AMMO", color: "#9be22d", spawn_every_s: 60, first_at_s: 60}`: a take tops the taker's held slots 0 and 1 up to their spawn reserve, never lower, and keeps the magazine. A player with every held slot full does not claim; the phone defers the grant through a reload or a stun. The `pickup` fact carries `item_kind: "ammo"`, no `weapon_id`, and optional `refilled: {"0": n0, "1": n1}`. Agreed with the phone owner (brx4). | §3 `StationAssignment.item`, `pickup`; `powerups.py`, docs/spec/powerups.md |
| A75 | 2026-10-18 | THE PHONE NAMES ITS DEVICE (F564; field 2026-10-17: status carried only `platform` and `app_ver`, so "this Pixel 4 drains fast" could not be tied to a node). `hello.device?` and `status.device?` carry the make and model from Capacitor's `Device.getInfo()` (`"<manufacturer> <model>"`, at most 64 characters), absent until the plugin answers and on the web. MC keeps the last one it heard per node (`NodeView.device`); a beat without it changes nothing, as with `app_ver`. Additive: an older phone or MC ignores it. A Stick sends none (`platform: "esp32"` already names the board). | §5 `hello`, §4 `status` sketch; `app/src/build.js` (`setDeviceModel`, `deviceModel`); `app/src/transport/transport.js`; `state.py` `_note_version`; `types.py` `NodeView`; `app/test/transport.test.mjs`; `mcp/tests/test_mc_logsync_versions.py` |
| A74 | 2026-10-17 | SPAWN WEAPON DELAY 1500 IS LEGAL AND THE DEFAULT (Tony, field 2026-10-17: "players should have to hide for spawn"). `respawn.weapon_delay_ms` is now `500\|1000\|1500\|3000`, default 1500 (`types.WEAPON_DELAY_MS_DEFAULT`, the `builtin:spawn:auto` piece, the console picker). 500 stays legal, so stored pieces and resumed sessions keep their value; a config that omits the key now gets 1500. The HUD's REDEPLOYED runs 1.9 s (`redeployOutMs(1500)`). A favourite that names `builtin:spawn:auto` resolves to 1500 on its next load, and the bench CLI (`deathmatch`, `arena`, `fieldstart`) holds the trigger 1.5 s too (it derives from the compiler). Restart MC between matches: a resumed LIVE session keeps its compiled 500, while a hot join after the resume would compile 1500. A LOBBY or KIT session saved before A74 also keeps its 500 after the upgrade: the AUTO pick wrote the piece's whole value into the config, and MC cannot tell that from a deliberate KIT edit to 500, so it does not rewrite it. The next PLAY pick re-composes spawn from the piece and gets 1500 (milestone review 2026-10-18). | §3 `respawn` (body), A49 row; `types.py`, `pieces.py`, `presets/editors.tsx`, `compile.respawn_settings` |
| A73 | 2026-10-11 | REFUSED FACTS STAY IN THE PHONE'S RING UNTIL MC CAN APPLY THEM (F513): an ack stops below a refused fact, so the phone resends it. After two refusals or 400 later facts without a resend, MC acks past it, records the loss, and emits one ALERT naming the player. | §5a; `net.py` (`_ack_hi`, `_give_up_holes`); `state.py`; `mcp/tests/test_mc_net.py` |
| A72 | 2026-10-10 | THE PHONE'S STORED BLOBS CARRY A SCHEMA VERSION (maintainability review M4, brx4, main `57ada0e2`). `brx.engine` and `brx.outbox` (and `brxu.outbox`) save `v`; no `v` loads as version 1, an unknown `v` is dropped with one log line and the owner starts clean. Every phone `localStorage` key is indexed in `app/src/storekeys.js`. | §9 |
| A71 | 2026-10-05 | A PHONE CLOCK STEP AFTER SYNC IS DETECTED AND CONTAINED (F474). MC trusted a synced node's own fact time `t`, so a wall-clock step of about one spawn interval made a powerup pickup name the wrong spawn and book a take in it. MC keeps a per-node drift baseline from live `status` and `time_req` (`clockwatch.py`). **Gate:** no drift is a baseline until the phone's connect burst (five `time_req` in 1.5 s, plus 1 s to settle) is over, because a phone with a saved offset stamps that burst at a stale level (10 s timeout). **Detect:** a drift step of more than `CLOCK_STEP_MS` = 3000 ms, confirmed by two samples at least `CLOCK_STEP_CONFIRM_GAP_MS` = 2 s apart, marks the node suspect from the first shifted sample. **Contain:** its facts score at `t_recv` (`Scorer._eff_t`, the replay, `PowerupLedger.pickup`; a pickup from a node with one unconfirmed shifted sample too), the match snapshot keeps the windows (`clock_suspect`), and MC pushes the new `control{cmd:"clock_resync"}` at most once per `CLOCK_RESYNC_MIN_GAP_MS` = 10 s. **Rebuild:** on confirmation MC re-derives the board from the stored facts through the resume path (`_settle_replayed`: alerts kept, a cap only the `t`-order replay passed is forgotten, a cap the final board really reaches ends the match), skipped when the gap holds no fact whose time moves. **Clear:** the drift is back within `CLOCK_STEP_MS` of its pre-step level for two samples 2 s apart, or, after the push and a fresh burst, two samples 2 s apart near MC time (drift within `CLOCK_STEP_MS` of 0; a phone whose replies never landed does not qualify). **MC's own step:** MC reads its wall clock minus its monotonic clock beside each `t_recv`; a change beyond `CLOCK_STEP_MS` re-baselines every node and suspects nobody. The phone runs a forced burst (`Clock.restart`; `newBurst` leaves a synced clock in EWMA mode). A fact dated more than `CLOCK_STEP_MS` after its arrival is scored at arrival at once, before the step is confirmed (F485: a phone cannot send from the future; the verdict is stored with the fact). The lead is measured against arrival itself, widened only by a positive node baseline, so a slow uplink (a negative baseline) never shrinks it; it holds with no baseline too (after an MC restart), and rests for `MC_STEP_QUIET_MS` = 10 s after MC's own wall clock stepped, when every genuine `t` leads. A reconnect costs nothing when its offset is sound: during the connect gate a fact keeps its own `t`. The two samples at least `CLOCK_STEP_CONFIRM_GAP_MS` apart that follow the gate, when they agree within `CLOCK_STEP_MS` (a split pair is a step after the gate, left to the normal check), are compared with the node's pre-disconnect level; when they differ by more than `CLOCK_STEP_MS`, the offset was unsafe during the gate, and a window from the hello to the gate's close re-scores the LIVE facts of the gate at arrival (F476). Facts flushed from the offline outbox (`event_batch`, stored with `_mc_batch`) keep their own time. An ambiguous late flush stays ambiguous (the window checks run first). A closed window's stepped time band applies only to a fact that arrives after the window closes and is dated inside it. An ambiguous late fact (queued offline across a phone clock step, with nothing to prove it was made before the step) is scored at arrival, and a pickup from one takes nothing: the station's own report settles the spawn. A second hello before the post-gate check resolves keeps the first gate, for at most 30 s (F495). A rescore edits the moved scorer feed rows in place (`feed_edit`, F475). | §4 time base, §5 `control`, §7; `types.py` (`CLOCK_STEP_MS`, `CONTROL_CMDS`); `clockwatch.py`; `scoring.py`; `state.py` (`_on_clock_sample`, `_rescore_clock_gap`); `net.py` (`on_clock`, `bind`); `app/src/transport` (`clock.js`, `transport.js`); `mcp/tests/test_mc_clock_step.py`; chaos `clock-step-after-sync` |
| A70 | 2026-10-04 | ONE GENERATED CONTRACT FOR EVERY LANGUAGE (architecture review #4). `gen_contract.py` also writes `hardware/m5sticks3/contract.gen.h`, and `types.py` owns the station presence defaults by platform and kind, the team vocabulary, role labels, presence and hill numbers, config bounds, the `$SIR` classes and (from `protocol.py`) the panic sequence. No wire change. Two visible fixes: the Stick names and paints team 3 PURPLE (finishing A69), and the console starts a Stick extraction or bomb station's range edit at the Stick's own -57. | §9 Constants |
| A69 | 2026-09-26 | TEAM 3 IS RENAMED PURPLE, END TO END | body §2 `Team`; `state.py` (`TEAM_DEFS`, KOTH's `teams` row), `stations.py` (`_keep_tally`); `app/src/engine.js`, `utility.js`, `hud/hud.js`, `hud/deathscreen.js`, `demo.js`; `webapp/mc/src/tokens.ts`, `screens/Items.tsx`, `screens/Recap.tsx`, `mock/data.ts`, `mock/backend.ts`; `protocol/brx-protocol.md` `$TID`/`$GLED`/`$HLED` rows (unchanged: already documented team 3 as painting purple); `mcp/tests/test_mc_state.py`, `test_mc_stations.py`, `test_team_color_consistency.py`, `test_station_lock.py`; `webapp/mc/test/*` (koth, live-board-qa, round3-2026-09-13, mode-switch-*, mock-mode-switch, games-confirm-contract, game-edit-*, e2e/koth.mjs, e2e/game-edit.mjs); `app/test/death-screen.test.mjs` |
| A68 | 2026-09-25 | A STICK HILL COUNTS ONLY BETWEEN ITS GO-LIVE AND DEADLINE | §5 `station_config`; `types.py` (`StationAssignment.duration_ms`); `state.py` (`_arm_station`); `station_link.h`, `mc_link_glue.h`; `mcp/tests/test_mc_stations.py`, `hardware/m5sticks3/test/test_link.cpp` |
| A67 | 2026-09-25 | A STATION'S RANGE CAN BE EDITED ON THE STATION, AND THE LAST EDIT WINS | body §5 `status` + `station_config`; `types.py` (`TxPower`, `RangeEdit`, `StationRange`, `StationAssignment`, `StationReport`, `StationView`); `stations.py` (`range_fields`, `_set_station_range_only`, `_note_range`, `_note_range_edits`, `_station_range_view`, `arm_station`); `mc/API.md`; `utility.md` §5c; `mcp/tests/test_station_range.py`; `webapp/mc/src/screens/Items.tsx`, `webapp/mc/test/station-range.test.tsx` |
| A66 | 2026-09-25 | MC ASSIGNS THE STATION ID | body §5 `station_config`; utility.md §5b; `stations.py` (`set_station`, `auto_station_id`), `snapshot_codec.py` (the snapshot); `mc/API.md`; `webapp/mc/src/screens/Items.tsx`, `webapp/mc/src/mock/backend.ts`; `mcp/tests/test_mc_stations.py`, `webapp/mc/test/items-station-id.test.tsx`, `webapp/mc/test/e2e/vqa2.mjs` (`station-ids`) |
| A65 | 2026-09-25 | NO KILL CUE AFTER THE WHISTLE, AND TEAM-ONLY CREDIT | body §4 `death`, kill attribution, feedback freshness, post-end facts; node.md §3.5; `types.py` (`Event.credit`); `scoring.py` (`_before_whistle`, `_credit_team`, `team_credit`, `_after_whistle_feed`); `state.py` (`_feedback`, `_reconcile_end`); `app/src/engine.js` (`_death`, `_lastHitFact.noPool`); `stage.py` (`_team_credit`); `webapp/mc` (`FeedTag`, LIVE feed); `chaos` (`team_credit_kill`, `team_score_equals_facts`, `no_kill_cue_after_end`, `after_whistle_kept_not_counted`); `tests/test_mc_after_whistle.py`, `app/test/poison.test.mjs`, `tests/test_stage_mirror.py` |
| A64 | 2026-09-24 | THE END FREEZES KILL CUES AND LATE TEAM KILLS | body §4 end freeze + feedback freshness; `scoring.py` (`_frozen_out`, `cap_recv`, `_death`); `state.py` (`_replay`, `_feedback`, `_end_on_frag_limit`, `_build_scorer`, `_arrival_cap_recv`, the match snapshot); `tests/test_mc_result.py`, `tests/test_mc_block_b.py`, `tests/test_mc_resume.py`; `chaos/scenarios/regressions.py` |
| A63 | 2026-09-24 | KILLJOY AND THE AWARDS TABLE | body §4 medals; `types.py` (`MEDALS`, `AWARDS`, `Honor.key`); `scoring.py`; `state.py` (snapshot `joined_t`, the result push); `presentation.py`; `mc/API.md`; `modes.md` §5b; `chaos/invariants.py` (`honors_from_ledger`) |
| A62 | 2026-09-24 | THE MELEE MEDAL | body §4 `death`; `types.py` (`MEDALS`, `Event.melee`); `scoring.py`; `app/src/engine.js` (the death fact) |
| A61 | 2026-09-24 | THE MULTI-KILL LADDER, EAR-CONFIRMED | body §4 medals; `types.py` (`MEDALS`); `scoring.py`; `presentation.py`; `mcp/tools/gen_contract.py` (record-list constants); `data/sound_catalog.json` |
| A60 | 2026-09-24 | MC IDENTITY PROOF: A PHONE REJOINS WITH NO TAP WHERE IT IS SAFE | body §5 `hello`/`welcome`; node.md §3.19; `mcp/brx_mcp/mc/mcid.py`, `net.py`, `report.py`, `api.py`; `app/src/transport/mcproof.js`, `autojoin.js`, `transport.js`, `app.js`, `hud/hud.js`; `mcp/tests/test_mc_trust.py`, `app/test/mc-autojoin.test.mjs`, `app/test/discover.test.mjs`, `app/tools/screens.mjs` (A60 steps); vector `app/test/fixtures/mc-proof-vector.json` |
| A59 | 2026-09-24 | F339 ONE GAME BYTE PER MATCH | body §3 `GameConfig`; `types.py`; `state.py` (`_wire_config`); `app/src/beacon.js`, `app.js`; `mcp/tests/test_mc_stations_game_byte.py`, `app/test/game-byte.test.mjs`; chaos invariant `game_byte_matches_stations` |
| A58 | 2026-09-24 | STATION TAMPER LOCK | body §5 `station_config`; `utility.md` (the lock and its restart rule, F391); `types.py`; `stations.py` (`_station_lock_s`, `_note_station_lock`, `_note_boot`, `station_tamper_flags`, `unlock_stations`); `mc/API.md`; `mcp/tests/test_station_lock.py` |
| A57 | 2026-09-24 | F315 HIT CELLS | body §2 (`RosterWeapon`, `HirCell`, `WeaponView.cells`); `types.py`; `state.py` (`_roster_weapons`); `views.py` (`weapon_view`) |
| A56 | 2026-09-24 | POWERUPS (on by default, F372) | body §3 (`stations[].item`, `powerups`), §4 (`pickup`), §5 (`station_config.item`, `station_action`, `station_update`); powerups.md; `types.py` (`StationItem`, `PowerupSlot`); `mcp/brx_mcp/mc/powerups.py` |
| A55 | 2026-09-24 | S57 NAMES THE VICTIM | No contracts body text (phone-to-phone IR only, no MC or wire change): `docs/ir-callouts.md`; `app/src/engine.js` (`CALLOUT_NAME_GAP_MS`, `CALLOUT_PAIR_MIN_MS`, `CALLOUT_PAIR_MS`) |
| A54 | 2026-09-23 | S57 THE IR CALLOUT BUS | body §3 (`FrameBundle`), docs/ir-callouts.md |
| A53 | 2026-09-23 | F289 POSSIBLY PROTECTED | §4 union, §5 `status` row + the F289 paragraph; `app/src/engine.js` (`_protectOwedMs`); `state.py` (`_with_pool_stale`); `types.py`; `mc/API.md` `LiveRow` |
| A52 | 2026-09-23 | S56 "WHAT HIT ME" | `mcp/brx_mcp/mc/compile.py` (`WeaponCatalog.hir_magnitudes`, `hir_from_weap`); `views.py` (`weapon_view`); `state.py` (`roster`, `_roster_weapons`, `_relay_hit_feedback`, `_relay_batch_hits`, `_compile_and_store`/`_send_config_to` split); `types.py RosterWeapon`, `RosterEntry.weapons`, `WeaponView.hir`, `Event.weapon_id`; `mc/API.md`; `mcp/tests/test_hir_magnitudes.py`, `test_hir_roster.py`, `test_hit_feedback_relay.py` |
| A51 | 2026-09-22 | S55 ONE ACCURACY OWNER | No contracts body text (node-only, no wire change): `docs/spec/node.md` §3.15, §3.18; `app/src/engine.js`; `app/src/hud/hud.js`; `mcp/brx_mcp/fake.py`; `mcp/brx_mcp/soak/patterns.py` |
| A50 | 2026-09-19 | LIFE PRESETS: `health.max_shield` AND `health.preset` (S45, weapon-design.md §7.3) | §3 `GameConfig.health`; `compile.py` (`HEALTH_PRESETS`, `resolve_health_preset`, `normalize_health`, `default_health`, `_base_health`, `_to_gc`, `perk_effects_resolved`); `types.py` (`Health`, `HealthPreset`); `state.py` (`default_config`, `_merge_config`, `restore_snapshot`, `resume_match`); `pieces.py` (F411, 2026-09-26: replaced the whole-game saved-game store this cited at the time); `stage.py`; `app/src/engine.js` (`maxShield`, `shieldRegenOn`) unchanged in behaviour — it already read the compiled `$PSET`, so the host field reaching the wire is the whole fix; `webapp/mc/src/screens/HealthPresetEditor.tsx`, `webapp/mc/src/ui/GameEditPanel.tsx`, `gameSummary.ts` (`HEALTH_PRESETS`, `healthPresetOf`); `mcp/tests/test_mc_compile.py`, `test_mc_api.py`, `test_mc_persist.py`, `test_armed_pool_formula.py`, `test_stage_mirror.py` |
| A49 | 2026-09-19 | RESPAWN PROFILES | §2 `respawn`, §4 `FrameBundle.respawn_profile`, `compile.respawn_settings`, `engine.js _armAfterSpawn` |
| A48 | 2026-09-17 | S42: NODE-DRIVEN RECOIL, AND THE F68 HEADSET FIX IT NEEDED FIRST | §3 `GameConfig.recoil`; `docs/spec/node.md` §3.15-3.16; `docs/weapon-design.md` §4.4; `mcp/brx_mcp/mc/weapons.json` (`recoil`), `compile.py` (`_T.acc_ceiling`/`acc_floor`), `types.py` (`Recoil`, `Weapon.recoil`, `WeaponView.recoil`, `GameConfigBase.recoil`), `views.py` (`weapon_view`), `state.py` (`default_config`, `_CONFIG_KEYS`, `_merge_config`); `app/src/engine.js` (`_recoilArm`/`_recoilStep`/`_recoilTick`/`_recoilFlush`/`_recoilWrite`/`_recoilVerify`, `_teamRepaintTick`); `mcp/tests/test_weapon_derivations.py`; `app/test/engine.test.mjs` |
| A47 | 2026-09-17 | THE OPERATOR CAN RESYNC, RESPAWN OR RELINK ONE PLAYER | §5 `control`; `types.py` (`CONTROL_CMDS`, `OperatorCmd`, `OperatorActionResult`, `Event.operator`); `state.py operator_action`; `scoring.py`; `api.py`; `mc/API.md`; `app/src/engine.js` (`_operator`, `_operatorResync`, `_liveTid`), `app/src/ammo.js` (`liveAmmo`), `app/src/app.js` (`onRelink`); `stage.py resync`; `webapp/mc` `OperatorMenu.tsx`, `Live.tsx`, `client.ts`, `mock/backend.ts`; `mcp/tests/test_mc_operator_actions.py`, `mcp/tests/test_stage_operator_resync.py`, `app/test/operator.test.mjs`, `webapp/mc/test/operator-menu.test.tsx` |
| A46 | 2026-09-16 | A STALE POOL IS VISIBLE ON MC, AND A RESTART CLAIMS NO DELIVERY | §4 `status` sketch, §5 `welcome`; `types.py` (`Event`, `NodeView`, `ReadinessRow`, `LiveRow`); `state.py _on_status`, `readiness()`, `_with_pool_stale`, `restore_snapshot`; `webapp/mc` `store.tsx`, `Live.tsx`, `Armory.tsx`; `mc/API.md` |
| A45 | 2026-09-16 | THE NODE SAYS WHEN ITS POOL IS STALE | §4 `status`; `app/src/engine.js` (`poolStale`, `_awaitShot`, `_noFireTick`, `_death`); `mcp/brx_mcp/stage/stage.py` (`pool_stale`); `app/test/pool-stale.test.mjs`, `app/test/death-once.test.mjs`; `mcp/tests/test_stage_pool_stale.py`, `mcp/tests/test_stage_death_once.py`; `types.py` (`Event`, `NodeView`, `ReadinessRow`, `LiveRow`) |
| A44 | 2026-09-16 | SPAWN PROTECTION HOLDS UNTIL THE GUN CAN FIRE | §3 FrameBundle (spawn / revive / sir_pool / spawn_protect_off); `compile.py` (`assert_arms_after_spawn`, `assert_rearms_every_life`); `fakes.py`; `golden_bundle.json`; `app/src/engine.js`; `mcp/brx_mcp/stage/stage.py`; `app/test/spawn-protect.test.mjs`; `mcp/tests/test_spawn_protection.py`, `mcp/tests/test_stage_spawn_protect.py` |
| A43 | 2026-09-16 | NEXT MATCH WITHOUT A MODE PICK | No contracts body text (MC HTTP API and console, not the node wire): `mc/API.md` (`POST /api/match/next`, `SyncRow.ack_state`); `state.py` (`_roll_forward_from_recap`, `next_match`, `_retire_scorer`, `_ingest_retired`, `new_session`, `sync_summary`, `_sync_ack_state`); `api.py`; `types.py SyncRow.ack_state` (+ `contract.gen.ts`); `mc/API.md`; `design/mission-control.md` A8; `Recap.tsx`, `Games.tsx`, `GameEditPanel.tsx`, `PreArmSummary.tsx`, `mock/backend.ts`; `mcp/tests/test_mc_next_match.py` |
| A42 | 2026-09-13 | THE END IS A DELIVERY, AND THE HEARTBEAT IS THE RECEIPT | §5 `control`; `state.py` (`_arm_end_delivery`, `_end_delivery_tried`, `_note_end_confirm`, `_retry_end_delivery`, `_say_end_unconfirmed`, `_end_delivery_view`, `_broadcast_control`, `END_RETRY_MS`); `API.md`; `webapp/mc/src/api/types.ts` (`EndDeliveryView`), `webapp/mc/src/api/derive.ts` (`endDeliveryLine`), `webapp/mc/src/screens/Live.tsx`, `webapp/mc/src/screens/Recap.tsx`; `mcp/tests/test_mc_end_delivery.py`; `webapp/mc/test/end-delivery.test.tsx`; `app/test/engine.test.mjs` |
| A41 | 2026-09-13 | A PLAYER CAN GET OUT OF UTILITY MODE ALONE | §5 `control` cmd table; `state.py release_station`; `types.py CONTROL_CMDS`; `api.py` `/api/stations/{nid}/release`; `API.md`; `app/src/utility.js` (`exitToHud`, `wireExit`, the `control`/`release_utility` branch in `connectMc`'s `onMessage`); `app/www/utility.html` (`#infoProg`, `#exitHud`); `docs/spec/utility.md` §1/§5c; `docs/platform/modes.md`; `mcp/tests/test_mc_stations.py`, `mcp/tests/test_mc_api.py`; `app/tools/screens.mjs`; `webapp/mc/src/screens/Items.tsx`, `webapp/mc/src/api/client.ts`, `webapp/mc/src/mock/backend.ts`, `webapp/mc/test/items.test.tsx` |
| A40 | 2026-09-13 | THE BENCH FACT IS STATED, NEVER INFERRED | §3 `assign`; `state.py` (`_assign_body`, `_hydrate`, `_schedule`, `_standby_node_ids`, `unrostered_phone_count`); `app/src/engine.js` (`hydrate`, `startAt`, `_assign`); `app/src/hud/hud.js` (the SITTING OUT sub-line); `API.md`; `mcp/tests/test_mc_standby.py`, `mcp/tests/test_mc_state.py`; `app/test/engine.test.mjs`; `app/tools/screens.mjs`; `webapp/mc/src/mock/backend.ts`, `webapp/mc/test/unrostered-phones.test.tsx` |
| A39 | 2026-09-13 | `ReadinessSnapshot` gains `unrostered_phones`: connected phones with a gun that no roster entry claims | `mcp/brx_mcp/mc/state.py` (`_find_player_for_gun`, `unrostered_phone_count`, `readiness`); `types.py ReadinessSnapshot` (+ `contract.gen.ts`); `webapp/mc/src/ui/UnrosteredPhones.tsx`, `webapp/mc/src/screens/Kit.tsx`, `webapp/mc/src/screens/Lobby.tsx`; `API.md`; `mcp/tests/test_mc_state.py`; `webapp/mc/test/unrostered-phones.test.tsx` |
| A38 | 2026-09-13 | THE BENCHED PHONE IS TOLD IT IS BENCHED | §3 `assign`; `state.py` (`stand_down`); `app/src/engine.js` (`standby`, `_assign`, `_applyConfig`, `state()`); `app/src/hud/hud.js` (`_structure`, `_lobby` 'standby' mode, the render signature); `API.md` STAND DOWN row; `mcp/tests/test_mc_standby.py`; `app/test/engine.test.mjs` |
| A37 | 2026-09-13 | A36's THREE PROOFS, CORRECTED BY REVIEW: each could go red on a gun running the right config | `state.py` (`_check_pool`, `_note_pool_life`, `cured_by_push`, `PUSH_CURES`, `push_config`, `_echo_fault`, `_refuse_echo_mismatch`, `_pool_ambers`, `_unroster`); `frames.py`; `API.md`; `types.py ReadinessRow.echo`, `Event.pool_src` (+ `contract.gen.ts`); `app/src/engine.js` (`butSinceHead`, `poolSrc`); `webapp/mc/src/api/derive.ts` (`PUSH_CURES`, `blocksPush`), `webapp/mc/src/screens/Lobby.tsx`, `webapp/mc/src/screens/Armory.tsx`, `webapp/mc/src/mock/backend.ts`; `api.py` (`diag_matches`, `_AuthMiddleware._TOKEN_GETS`); `diag.py` (`_pushed_pool`, `first_live_pool`); `app/src/logring.js`, `app/src/logsync.js`; `mcp/tests/test_mc_config_proof.py`, `mcp/tests/test_mc_api.py`, `webapp/mc/test/config-proof.test.tsx`, `webapp/mc/test/e2e/game-edit.mjs`, `app/test/engine.test.mjs`, `app/test/logring.test.mjs` |
| A36 | 2026-09-13 | MC PROVES THE CONFIG IT PUSHED IS THE CONFIG THE GUNS ARE RUNNING | `state.py` (`_ack_is_current`, `_stale_ack_id`, `_echo_fault`, `_refuse_stale_ack`, `_check_pool`, `_note_pool_life`, `all_acked`, `readiness`, `new_session`, `_merge_config`, `_check_stale_live`); `frames.py` (`head_spawn_ammo`, `head_pool`, `alcd_ammo`); `types.py POOL_CHECK_SETTLE_MS`; `app/src/engine.js` (`ammoEcho`, `_checkEcho`, `statusBody`); `fakes.py`/`mock_node.py` (echo + pool from the pushed head); `webapp/mc/src/screens/Lobby.tsx`; `mcp/tests/test_mc_config_proof.py`, `mcp/tests/test_mc_stale_live.py`; `webapp/mc/test/config-proof.test.tsx`; `app/test/engine.test.mjs` |
| A35 | 2026-09-12 | EDITING A LOADED GAME KEEPS THE GUNS CURRENT, AND A LIVE RE-TEAM IS REFUSED | §5 `config`; `state.py` (`set_config`, `_repush_lobby_config`, `patch_player`); `app/src/engine.js` (`_writeHead`, `_checkTeamVsHead`, `_assign`); `loadout.md` §4.4 / A30 |
| A34 | 2026-09-12 | MC ENDS A PHONE IT FINDS STILL LIVE IN A RETIRED MATCH | §5 `control`; `state.py` (`_record_ended`, `_check_stale_live`, `_reconcile_stale_live`, `_result_body(match_id=, roster=)`); `types.py STALE_LIVE_RETELL_MS`; `engine.js control()`; `mcp/tests/test_mc_stale_live.py`; `app/test/engine.test.mjs` |
| A33 | 2026-09-12 | ONE MACHINE SOURCE FOR THE NODE↔MC WIRE | `mcp/brx_mcp/mc/envelope.py` (`ACCEPT_MIN`, `REQUIRED`, `EVENT_REQUIRED`); `mcp/tools/gen_contract.py`; `mcp/tests/test_contract_generated.py`; `app/src/transport/envelope.js`; `webapp/mc/src/api/types.ts` |
| A32 | 2026-09-12 | A SUSTAINED BLE LINK PROVES THE HEADSET | §4 Readiness; `state.py readiness()`; `types.py HEADSET_LINK_PROOF_MS`; `mc/API.md` ReadinessRow.headset; `Armory.tsx`; `manual/hardware.md` (fact already there) |
| A31 | 2026-09-12 | THE "VERIFY AT MC" PRE-GAME WARNING | §3 `assign.game.mc_verify` (no `FrameBundle` field); `compile.py` (`mc_verify`, `full_coverage`; `GameConfig.coverage?: "full"\|"partial"`); `Lobby.tsx`/`Armed.tsx`; the HUD's ARMED screen and results (`moments.js`, `result.js`); `state.py _independent_path` (F309, F595: what counts as backhaul) |
| A30 | 2026-09-12 | THE KIT LOCKS AT START | §5 `loadout_request`/`loadout_ack`, `config`; `mc/API.md`; `state.py` (`_push_config_to`, `_on_loadout_request`, `_after_player_change`); `loadout.md` §4.4 |
| A29 | 2026-09-12 | PHONES REPORT THEIR REAL BUILD, AND MC WANTS ONE VERSION AT MUSTER | §5 `hello`/`status`; `mc/API.md` NodeView + ReadinessRow; `app/package.json` build script (esbuild define); `state.py readiness()`; `Armory.tsx` **Server built 2026-09-12:** `types.APP_MAJOR`/`APP_MINOR`, `parse_app_ver()`, `compatible()` (0.x compares `(major, minor)`, ≥1.0 compares `major`; build metadata after `+` ignored). Shipped wording: red `APP <x.y.z> INCOMPATIBLE WITH MC (NEEDS <tier>) — UPDATE THE APP` (one string for both regimes); amber `APP OLDER THAN THE FIELD (…)`, `APP OLDER THAN THE RELEASE (…)`, and `APP VERSION UNKNOWN (<raw>)` for an unparsable value (never red). An incompatible build is excluded from `newest`, so one rogue phone cannot amber every correct one. `State.versions = {field, newest, release, mc_major}` (`mc_major` is the tier string, `"0.1"` on 0.x). Phone side: `app/scripts/build.mjs` bakes `__APP_VER__` = `<package.json version>+<sha>[-dirty]`; `hello` and every `status` carry `app_ver` + `platform` (Capacitor's platform, `web` outside the app). |
| A28 | 2026-09-12 | BACKHAUL | §5 tables, **§5d** |
| A27 | 2026-09-11 | CONTINUE IS GUARDED ON BOTH SIDES | No contracts body text (MC HTTP API and the HUD, not the node wire): `mc/API.md` `POST /api/phase`; `state.py set_phase`; `Kit.tsx`; `engine.js`; `loadout.md` §4.4 **Server built 2026-09-12:** `Session.set_phase()` raises `NotReadyError` → `POST /api/phase` 409 `{error, not_ready, greens, roster_size}`; `greens` is the count of players who ARE ready (not the readiness board's green count); `force:true` passes. |
| A26 | 2026-09-11 | TRY-OUT COLLAPSES INTO SELECTION | No contracts body text (node-side timing and copy, no wire change): `loadout.md` §4.5; `engine.js`; `hud.js` |
| A25 | 2026-09-11 | BACKGROUND LOG SYNC | §5 `pull_log`; `node.md` §6; `state.py`; `app/src/app.js` **Server built 2026-09-12:** the option is `GET/PUT /api/options {log_sync}`; the operator's LOGS button is `POST /api/nodes/{nid}/pull_log` (`reason: "manual"`, never gated); `NodeView.log` carries the five states. Phone side: `app/src/logsync.js` (gate, 5→60 s backoff, tail-only resend, one chunk in flight behind `bufferedAmount`), `npm run ui:logsync` is its 17-check browser gate. |
| A24 | 2026-09-11 | THE MATCH RESULT REACHES EVERY NODE | §5 `result`, `score`; `node.md` §3.13; `scoring.py rows()`; `state.py _finish/_push_result`; `hud.js` **Server built 2026-09-12 (M2):** `+ after_end`, `winner.tie` (`CLOCK_TIE_MS`), `score.rows` in all modes, per-recipient `outcome`, `welcome.node.result` in recap, and the REPLAY reconciliation (§4). |
| A23 | 2026-09-11 | SPAWN PROTECTION | §3 FrameBundle (head / spawn / revive); `mcp/brx_mcp/mc/compile.py` (`sir_spawn_protected`, the three `assert_*` guards); `mcp/tests/test_spawn_protection.py`; `mc/API.md` `POST /api/lobby/push` |
| A22 | 2026-09-11 | PER-GAME VOICE SWITCH for the player's OWN voice lines (`presentation.voice`, default `"on"`) | §3 `GameConfig.presentation`; `mcp/brx_mcp/mc/presentation.py` (`_BASE`, `VOICE_VALUES`, `merge`, `resolve`, `summary`, `PRESETS["silenced"]`); `mcp/brx_mcp/mc/compile.py` (`voice_switch`, ~L994-1046) |
| A21 | 2026-09-11 | `$PLAY` SLOT SEMANTICS, and a per-event `slot`: `presentation.events.<event>.slot = "queue"\|"interrupt"\|null` | §3 `GameConfig.presentation` (`slot`); `mcp/brx_mcp/mc/presentation.py` (`play_frame`, `merge`); `protocol/brx-protocol.md` `$PLAY` row; `experiment-log/2026-09.md` → *the sound pass* |
| A20 | 2026-09-11 | HOST-DRIVEN STUN | §3 GameConfig; `node.md` §3.12; `mcp/brx_mcp/mc/compile.py` (`_STUN_SIR_ROW`); `protocol/brx-protocol.md` §5 fn 23 |
| A19 | 2026-09-11 | HELD ROLES REACH THE NODE | §3, §5 `alert`; `mc/presentation.py role_alert_body` |
| A18 | 2026-09-11 | MODE PARAMS | §3; `docs/spec/modes.md` §2.1 |
| A16.5 | 2026-09-09 | An emptied pool hands over inward (`poolgauge.handover_pool`); an empty `$GLED` colour token is red | §3 `FrameBundle.gun.readout` (NODE RULE) |
| A16.4 | 2026-09-09 | The gun body rests on the team colour at DIM brightness, and the readout paints FULL (F56) | §3 `FrameBundle.gun.readout` |
| A17 | 2026-09-07 | HIT AUDIO, **bench-confirmed**: what a hit sounds like to the player who took it (`mcp/brx_mcp/hitaudio.py`) | §2 GameConfig, §3 FrameBundle; `mcp/brx_mcp/hitaudio.py`; `protocol/brx-protocol.md` §`$PSET`; `docs/manual/sound.md` |
| A16.3 | 2026-09-07 | The gun-body pool bar has seven levels and a drop animation (`gun.readout.levels`); a half-step blinks | §3 |
| A16.2 | 2026-09-07 | LEDs part 2: `night` dims, only `blackout` empties the light tables, and team colour is apart from `$TID` | §2 `Team`, §3 `GameConfig.night` |
| A16 | 2026-09-07 | LEDs, bench-driven: `$HLED,,6` disables the firmware death flash for the life ⇒ in-play dark is `$HLED,9,0` and effect 6 is teardown-only | §3, §4 |
| A15 | 2026-09-06 | CHARACTER VOICES: `Player.voice_slots` picks for the six `$PSET` voice fields + the kill line (ids on the gun only) | §2 Player, §3 FrameBundle; `mcp/brx_mcp/voices.py`; `docs/gun-stage.md` §8 |
| A14 | 2026-09-04 | PERK SLOT: A14.1 its own slot beside a secondary, A14.2 a pick knocks the other out, A14.4 `loadout_pool` | §2, §5; `loadout.md` §2-§5 |
| A13 | 2026-09-04 | UTILITY: A13.1 `respawn.gate`, A13.2 `respawn.station`, A13.3 adverts, A13.4 node state, A13.5 `station_config` | §3, §4, §5; full text `utility.md` |
| A12 | 2026-09-04 | SIDEARMS: A12.1 `glock`/`usp`/`deagle` as ordinary weapons with role `sidearm`, A12.2 `SlotRule.kinds` gains `"sidearm"` | §2, §3; `loadout.md` §1.1 |
| A11 | 2026-09-04 | PRESENTATION: A11.1 profile, A11.2 `cues`+`leds`, A11.3 node events, A11.4-A11.8 alerts, classes, LEDs | §3, §4, §5 |
| A10 | 2026-08-27 | M-LOADOUT: A10.1 empty slot 1 is legal, A10.2 `loadout_policy`, A10.3 phone self-serve picks, A10.4 ready | §2, §5; full text `loadout.md` |
| A9 | 2026-08-26 | A9.1 `apply.preview` | §5 `apply` |
| A8 | 2026-08-25 | A8.1 operator auth, A8.2 node re-claim key, A8.3 input hardening | §5b |
| A7 | 2026-08-25 | MC→node `score` push | §5 |
| A6 | 2026-08-25 | A6.1 end freeze, A6.2 hot-swap shots, A6.3 pre-composed cues, A6.4 `apply`, A6.5-A6.8 resync and rejoin | §4, §3, §5, §6 |
| A5 | 2026-08-25 | A5.1-A5.11: wire id 0 reserved, roster friendly fire, resync, readiness, hydration, all lands in KITTED | §2, §4, §5, §6, §9 |
| A4 | 2026-08-25 | P2 closed over BLE (A4.1-A4.12); A4.11 mounted, foreground phone: README §6; A4.12: module Interfaces | §2-§6 throughout |
| A3 | 2026-08-25 | `status.dropped`, `arm_state:connected`, `log_data`, `assign` re-sent on change, multikill needs host `$PLAY` | §4, §5 |
| A2 | 2026-08-25 | `assign` split from `config` | §5, §6, §9 |
| A1 | 2026-08-25 | `ready`, `ack{seq_hi}`, `start.seq`/`countdown_s` + `abort_start`, `status.arm_state`, battery amber-not-red | §5 tables, §4, §1.1 |

The verbatim amendment texts as ratified are preserved in git history (`git log -- docs/spec/contracts.md`, up to
2026-09-06).
