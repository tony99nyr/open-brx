# Shared contracts (M-CONTRACTS) — the node↔MC wire and the game data model

- **Status:** Ratified (Wave 0, 2026-08-25) + amendments **A1–A22** (index in §10). Since 2026-09-06 the
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
  (`protocol/session-findings-2026-08.md` §7r; `docs/experiment-log.md` 2026-08-25 late). Battery is **amber, not red**,
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
  display:     string,       // vanity name the host types at kit-out (never written to the gun)
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

Team { team_id: string, name: string, color: "blue"|"yellow"|"red"|"green"|string, tid: number } // tid → $TID (LED colour + friendly-fire class)

Loadout {
  weapons: WeaponSel[],      // ordered; index maps to the gun's weapon slots: [primary] or [primary, secondary]. NEVER empty —
                             // a primary is required; an EMPTY slot 1 is legal (no $WEAP,1 / $AMMO,1; ALT falls back to reload) [A10.1]
  perk?: string | null,      // [A14.1] the PERK slot — a perk_id beside the weapons (AR + pistol + Quick Switch is a legal kit). The one pairing
                             // the gun cannot do: a perk that takes the ALT button (`effects.alt_reload`, Easy Reload) + a second weapon (loadout.md §2)
  overrides?: { max_hp?: number, max_armor?: number }
}
WeaponSel { weapon_id: string }   // references WeaponCatalog (M-MODES)

RosterEntry { player_id, player_num, display, team_id }   // what nodes get so the HUD can name a killer
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
  only) [A12.2]; the host API refuses Easy Reload beside a second weapon (400), a phone pick applies and knocks
  the other slot out (`loadout_ack.dropped`) [A14.2]; a player's `ready` ends their try-out and kit → lobby
  auto-advances only when every rostered player is ready [A10.4].

## 3. Game config, frames, modes (authoring output of M-MODES)

`GameConfig` is the **complete, serializable description** of a match — the single object MC authors,
validates, and pushes. It MUST round-trip (author → JSON → frames) with no hidden state.

```jsonc
GameConfig {
  config_id:   string,
  mode:        "tdm" | "ffa" | "infection" | "lms" | "extraction" | string,
  environment: "indoor" | "outdoor",
  night:       boolean,               // drives LED/HUD blackout choices
  time_limit_s: number,               // REQUIRED and > 0 on the phone path [A4.8]: the only end condition
                                      // that reaches a dispersed node. (null allowed only when validate()
                                      // is told the venue is fully LAN-covered.)
  respawn:     { type: "auto"|"scanner"|"none", delay_s: number, gate?: "trigger"|"presence" },   // gate: A13.1 (scanner only)
  stations?:   [ { id: number, kind: "respawn"|"powerup"|"extraction"|"bomb"|"control" } ],          // A13.1: the utility items valid in this game
  scoring:     { frag_limit: number|null, win_by: "kills"|"survival"|"objective"|string }, // frag_limit / survival ends are LAN-covered-only [A4.8]
  health:      { max_hp: number, max_armor: number },   // mode defaults; Loadout may override
  // No `max_shield`, deliberately: the shield pool is NOT BLE-writable. It is granted only by an IR
  // $SIR function-11 event (P16, closed 2026-08-26). Damage drains shields -> armor -> HP.
  teams:       Team[],
  led?:        object,                // indoor/outdoor/night LED customization (modes.md §6)
  loadout_policy: LoadoutPolicy,      // A10.2 — loadout.md §3
  presentation?: Presentation,        // A11.1 — below
  player_num_base?: number,           // A6.5: first player_num this session hands out (default 1). Two concurrent games on one
                                      // field use disjoint ranges (e.g. 1 and 32) — $HIR carries no match id.
  mode_params?: { [name: string]: number | string | boolean },   // [A18] the MODE's own rules — below
  vip_player_id?: string | null,      // [A19] who the VIP is; must be on the roster (validate()); MC pushes them the `vip`
                                      //   headset role via `alert.role` once live and after each of their respawns. Never in a saved game.
  stun?: { duration_s?: number },     // [A20] the host-driven STUN (EMP). Present = the `<8,0>` $SIR cell ships as fn 24 (status,
                                      //   no damage) and a proto-8 $HIR disarms the victim's node for duration_s (default 10, 1..60).
                                      //   Absent = the stock charge-rifle damage row, byte-for-byte. Source: a $WEAP t3=8 slot
                                      //   (the charge rifle) or a proto-8 station. node.md §3.12.
}
```

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
(`mcp/brx_mcp/mc/presentation.py`). A preset name replaces the profile; any field edit makes it `custom`. `sound`
must be an id physically on the gun (`data/sound_catalog.json`, read off the hardware 2026-09-03); colours are the
shared 9-entry palette. Mode defaults (`MODE_PRESET`): `cs` → `counter_strike`, `infection` → `infection`, `lms` →
`last_stand`, `extraction` → `extraction`; everything else `standard`. Validated in `PUT /api/config` [A8.3].
- `announcer:false` mutes the announcer + objective groups only (the player's own low-health alert and the
  countdown stay); `gun_flash:false` empties `leds`; `headset_team:false` removes the `$HLED` team-colour frames
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
  callouts) or **`both`**. `hud_events` / `mc_events` mute a class; **`mc_confidence`** (default on) lets MC push a
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
  head:    string[],   // config head: $VOL → $CLEAR → $START → $GSET → $PSET,<player_num>,… → $WEAP×n → $SIR×n → $BMAP×n → LED frames → $TID,<tid> (last).
                       //   NO $SPAWN, NO countdown/start sound — written at lobby, the gun then sits unspawned (M-START).
                       //   The head write is SILENT on the gun (bench 2026-08-25, protocol §7r): the voice + cock belong to $SPAWN.
  spawn:   string[],   // go-live tail at T-0: LIVE $SIR×n → $PLAYX,0 → $SPAWN,, → $AMMO per slot → $BMAP,0,0   [A23: the head's $SIR rows are the same cells on fn 28 — DISARMED; the live table lands here]
  revive:  string[],   // respawn re-arm: LIVE $SIR×n (or the sir_pool take under hit_audio_class) → $SPAWN,, (+ loadout-correct $AMMO)   [A23]
  end:     string[],   // game-over teardown (END_SEQUENCE)
  panic:   string[],   // ["$CLEAR,*", "$SP,99,*"]
  team_flip?: { [tid: string]: string[] }, // infection: frames to move THIS gun to another team mid-match
  team_flip_take?: { [tid: string]: string[] }, // F86 (2026-09-11): per-tid [blank, rest] the node takes the gun body with after a flip -- `gun.take` is compiled for the ARMING team, so a flipped gun must not be re-taken with the old colour
  cues: { countdown: string, kill: string, game_over?, victory?, tick?, klaxon?, multi?, medal?,
          hurt?, hurt_led?, runway_30?, runway_20?, runway_10?, team_led?,
          // A11.2: one key per presentation EVENT that carries a sound — the medal kinds (first_blood, double_kill,
          // triple_kill, killtacular, killing_spree, unstoppable), match state (lead_taken, lead_lost,
          // next_kill_wins, last_survivor, infected, survivors_win, victory, game_over), objectives
          // (objective_taken, objective_scored, flag_returned, point_captured, hill_captured, bomb_planted,
          // bomb_defused, bomb_detonated, vip_hit, vip_down), the player's own (hit_taken, died, respawned,
          // healed, armour_up, shield_up, low_health), the clock (time_60, time_30, time_10) and the extraction
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
          readout?: { hold_s: number, reload_glance_s: number,   // A16: the TRANSIENT pool bar. Default rest is now DARK.
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
          // body during the 2.5 s hands-off window after $HP,0. Segments render per-LED only AFTER the blank
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
              // `rearm_after_ms` (2500) it writes `rearm` ONCE ($HLOOP,2,750) as insurance for any life where a
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
  swap_ms?: int,                     // 2026-09-04 (additive): the swap delay the gun enforces between slots 0/1 = max $WEAP tok15 after perks (850 stock; quick_switch 425). The HUD's SWITCHING takeover runs for exactly this; older MCs omit it and the node assumes 850 × perk
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
  sir_pool?: string[][],             // [A17] one full $SIR table per take; the rows differ ONLY in their sound tokens. The node
                                     //   writes one on the REVIVE path (not the first spawn: that write is on the critical path and
                                     //   the headset needs its F13 settling gap), so the sound a given WEAPON makes on you changes
                                     //   between lives. Re-sending $SIR rows is the F11 REPAIR path, so the write cannot cost the
                                     //   table. Absent = the head's own table stands, as before A17.
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
                                     //   (token 5) >= `voice.pain_long_min` (40: shotgun, snipers, power weapons) -> pain_long (slots E F);
                                     //   else pain_short (G H D C). At most one pain line per 600 ms; none on the lethal hit. `events.hit_taken`
                                     //   keeps no sound of its own. `voice.pset_pool` lists the scream id per `pset_pool` frame.
}
```
- **Volume** is the compiler's: the head carries `$VOL,<compile.play_volume(environment)>` = **80 indoors / 90
  outdoors** (field-corrected 2026-08-30: 69, the old default and iOS Callsign's value, measures as on-gun level
  2 and was inaudible outdoors); **try-outs stay at 69** (`VOL_TRYOUT`, fired at arm's length from the player's own
  head); the diagnostic default `30` is inaudible for game audio and stays a bench value only.
- The node owns exactly **two literal templates** and nothing else: `$SFLASH,*` and `$PLAYX,0,*`
  (`app/src/engine.js`'s exported `SFLASH` / `PLAYX`; [A6.3] — `cues` are pre-composed frames, so there is no `$PLAY` template on the node).
  Everything else is written verbatim from the bundle. **Plus one pre-config probe set** [A5.4], allowed **only in
  CONNECTED/KITTED** (never after a head is written): `$PHONE,*` (starts `$VOLTS` telemetry) and the
  `$STOP,*`→`$PHONE,*`→`$VERSION,*` ritual (firmware).
- `tutorial` carries its own `frames: string[]` (M-MODES `tutorialFrames(weapon, environment)`).
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
           dmg_hit?:number, cycle_ms?:number, charged?:boolean },   // the pool-INDEPENDENT chain, see below
  // ⚠ `damage` is the MAGNITUDE the weapon emits ($WEAP t5), not the damage that lands. What lands is
  // decided by the victim's $SIR row for this weapon's <t3,t4>: a multiplier row lands floor(x1.25) or x2, a
  // status row lands nothing, a missing row drops the hit. Damage is a property of the (weapon, $SIR
  // table) PAIR — see docs/weapon-design.md §6. `Compiler.validate()` warns on all three cases.
  // `dmg_hit`/`cycle_ms`/`charged` are what `weapon_view(w, pool)` re-derives htk and ttk_ms from
  // when the host changes `health` (weapon-design.md §2.5). dmg_hit is the real t5 magnitude; cycle_ms is the mean ms
  // between landed hits (burst-aware: (2*t14 + t23)/3 on a 3-round burst); `charged` weapons pay for
  // their FIRST shot, so their ttk is htk cycles, not htk-1. A row WITHOUT them (a synthetic/demo
  // catalog) scales its published `htk` by the pool ratio and withholds `ttk_ms` at any non-default pool.
  weap_frame: string,   // the $WEAP,... template (token positions per callsign-extract)
  icon?: string,
  tags: string[], role: string   // A10: policy vocabulary ("heavy", "sniper", "sidearm" + "pistol" [A12.1], + the role) — presets exclude by tag (loadout.md §1.1)
}
PerkView { perk_id, name, desc, tags, mechanism: "passive"|"slot_frame", effects: {...}, verified, hidden }   // A10, loadout.md §1.2
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
 | { type:"hit_taken",   t, match_id, node_id, player_id, shooter_num, shooter_team, dmg, ir_proto?, sensor? } // $HIR + the $HP delta it caused
 //   sensor = $HIR tok1: 0-3 are ALL HEADSET sensors (four of them), 4 = gun body. Added 2026-09-01;
 //   before that `ir_proto` was read from tok1 and so carried the SENSOR, with no version marker.
 |   // ⚠ `dmg` = the hp+armor delta, so it is BLIND TO SHIELDS: a hit a shield fully absorbs moves
 |   // neither pool and, strictly read, emits no event at all. Latent until a shield-granting station
 |   // exists (now buildable). Decision pending — node.md §10-Q12. NB `dmg` is deliberately NOT $HIR
 |   // token 5: tok5 is the RAW magnitude and ignores the $SIR multiplier, so the delta is the correct
 |   // source and happens to be multiplier-safe already.
 | { type:"death",       t, match_id, node_id, player_id, shooter_num, shooter_team, desync? }         // $HP→0; shooter = last $HIR if fresher than DEATH_LATCH_MS, else 0
 | { type:"respawn",     t, match_id, node_id, player_id, resync?, station? }                          // resync?: LEGACY (A6.8 retired it for the live path; still set by a lobby/armed resync revive). station?: A13.2 — the station id that revived the player (absent for a timer revive)
 | { type:"team_change", t, match_id, node_id, player_id, tid }                                        // infection: this gun moved to `tid` [A5.8]
 | { type:"status",      t, match_id?, node_id, player_id?, hp, armor, ammo, alive, shots, deadline_s?, battery?, fw?,
                         arm_state, t_minus_ms?, synced, dropped?, preflight? }
```
- `shooter_num`/`shooter_team` are **always present** (from `$HIR` tokens 3/4). MC maps `shooter_num →
  player_id` via the match roster. `shooter_num = 0` means **unknown / environmental** (no `$HIR` fresher than
  `DEATH_LATCH_MS` before the `$HP,0`, a tutorial-armed gun, a desync); a number not in the roster (another
  game's gun) is recorded and **not** credited. Grenade/station beacons (`$HIR` token 2 = 15) never enter the latch.
- **`status` is live-only [A4.4]:** sent every `STATUS_HEARTBEAT_MS` while connected, **never queued or
  persisted** — it is a heartbeat + counters, not a fact to replay. `shots` = cumulative shots fired this
  match (from `$ALCD` decrements; reloads/pickups increase ammo and are ignored). `preflight` [A4.9] =
  `{ ssid_ok, mc_reachable, auto_join_ok, cellular_off, dnd_on, phone_batt, screen_on, foreground, gun_linked, headset_ok }`.
  `headset_ok`/`screen_on`/`foreground` are **amber before the config push, never red at muster** [A5.4]. `fw` =
  `$VERSION` result from the pre-config probe set (§3). `arm_state ∈ idle|connected|kitted|lobby|armed|live`
  [A1, A3]; `t_minus_ms` only while ARMED; `synced` = clock-sync fresh (§7); `dropped` = events shed by ring
  overflow since last status [A3].
- `hit_taken`/`death`/`respawn`/`team_change` are **persisted facts**, idempotent by `(node_id, seq)` (§5 envelope).
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
  (death only). **Team-kill (`friendly:true`)** ⇔ killer and victim share a non-null roster `team_id` **and**
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
- **Feedback freshness [A4.3]:** MC sends `feedback{kill}` only when `now − death.t ≤ FEEDBACK_MAX_AGE_MS`;
  a late-flushed kill scores but never flashes a sight minutes later.
- **End freeze [A6.1]:** MC records `end_t` when it broadcasts `control{end}` (frag-limit / survival / objective /
  host end) or, for the timed end, `end_t = go_live_t + time_limit_s·1000`. Facts whose effective `t` is `> end_t`
  are **recorded but not scored** (`parked_reason: "post_end"`) — the announced winner never mutates as out-of-range

**Post-end facts are kept, shown and never counted [A24/M2, 2026-09-12]:** they ride the recap as `after_end` (`{facts, by_player}`) and as the last two CSV columns (`after_end_kills`, `after_end_deaths`), feeding nothing — not kills, streaks, medals or the winner. **A frag-cap end is RE-DERIVED:** the match ends at the TIMESTAMP of the kill that reached the cap, not when MC learned of it, so a fact arriving with `t` within `end_t + CLOCK_TIE_MS` re-runs the recap as a pure function of (the stored facts, the end rule) — the end can move EARLIER and everything after it is un-scored; the `result` is re-pushed. A host END and a timed end never move.
  nodes flush kills they scored after the in-coverage end. Recap shows the count. `validate()` WARNS when
  `frag_limit` is set without `opts.coverage == "full"`.
- **Hot-swap shots [A6.2]:** `status.shots` is per node-session; MC keeps `shots_total = baseline + status.shots`,
  re-basing when a new `node_id` binds the player. Accuracy uses `shots_total`; `welcome.node.score.shots_total`
  seeds the swapped phone's display.
- **Recap is provisional until every rostered node has flushed** [A5.11] (kills exist only in victims' reports): the
  recap shows "N victims missing — kills provisional" and export is marked provisional until finalized.
- **Medals [A11.4]:** `feedback.medals: string[]` is a Halo-style stack (first_blood · double_kill / triple_kill /
  killtacular · killing_spree at 5 · unstoppable at 10); `kind` stays `"kill"` so older nodes still play their kill
  line, while a current node plays the medal cues back to back INSTEAD of it (2 s apart). The old `multi`/`medal`
  kinds are legacy. The scorer also emits lead changes (team modes by team totals, FFA by player), `next_kill_wins`
  once at cap-1, `last_survivor` once in lms/infection, `infected` on a team_change in infection (the turned node
  skips MC's copy), evaluated after EVERY scored death, team kills included; mode engines emit the objective/VIP
  kinds. **Clock callouts are the node's** (`time_60`/`time_30`/`time_10`, edge-triggered from its synced end).

**Readiness (MC-assembled [A4.9, A5.4, A5.11])** — the board shape M-MC builds from `status.preflight` + `ack_config` + M-ARMORY `scan()`:
```jsonc
ReadinessRow { gun_id?, sticker, tail, player_id?, player_num?, present, identity: "ok"|"unconfirmed"|"reverted"|"unknown"|"manual",
               node: "none"|"linked", headset: "proven"|"unknown"|"absent", battery_pct?, battery_age_ms?, fw?, phone_batt?,
               ssid_ok?, mc_reachable?, synced?, screen_on?, foreground?, status: "green"|"amber"|"red", blockers: string[] }
ReadinessSnapshot { t, roster_size, greens, board: ReadinessRow[], unclaimed: ScanRow[], go: boolean }
```
Red (blocks the config push): no node, identity reverted/unknown, never synced, wrong SSID / MC unreachable.
Amber (shown): headset unknown, battery unsampled, phone battery low, screen/foreground off, fw unknown.
After the push: an empty `ack_config.gun_echo` is **red** (the gun did not answer: headset off or asleep) and
blocks `start`. **Bench 2026-08-25 (§7r): with the headset OFF the head write echoes nothing and the BLE link
dies (`$DISCONNECT`), so link + head echo IS the headset proof** and the pre-push amber cannot deadlock the board.

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
`seq` is a per-node monotonic counter on **persisted** `Event` messages (`hit_taken`/`death`/`respawn`/`team_change`)
for idempotent replay. `status` carries no `seq`.

**Node → MC** (`kind`):
| kind | body | when |
|---|---|---|
| `hello` | `{ node_id, node_type:"phone"|"companion"|"utility", app_ver, platform?, gun?: {name, tail, fw?}, seq_next, node_key? }` | on connect. **A29:** `app_ver` = `"<package version>+<git sha>[-dirty]"` baked at build time, `platform` = `android`/`ios`/`web`; both repeat on every `status` so a phone that upgraded mid-session is seen. `gun.name` = the full **advert name** (`<sticker>-<tail>`); `tail` is parsed from it, **never from the platform deviceId** (iOS gives UUIDs) [A5.5]. `seq_next` = the node's next event seq (so MC can spot a wiped install) [A4.5]. `node_key` = the secret from a prior `welcome` [A8.2] — proves a re-claim of a still-live node_id/gun. `node_type:"utility"` = a station phone, no gun, never bound [A13.5]. **`via`/`secret?` [A28.2]**: which join URL this socket dialled and the QR's join secret (enforced only through the tunnel). |
| `bind` | `{ node_id, player_id?, gun_name, gun_tail }` | node claims/confirms its gun & player. `gun_name`/`gun_tail` come from the advert name [A5.5] |
| `event` | one persisted `Event` (§4) | as they happen (queued if offline) |
| `event_batch` | `{ events: Event[] }` | store-and-forward flush on reconnect |
| `status` | one `status` body (§4) | every `STATUS_HEARTBEAT_MS` while connected; live-only, no seq. **`reach: "lan"|"backhaul"` [A28.3]** = the live socket's path |
| `ack_config` | `{ config_id, ok:boolean, err?, gun_echo?: string }` | after writing `FrameBundle.head`; `gun_echo` = the `$LCD`/`$ALCD` line the gun answered with — proof the gun **answered the head** (it reads `$LCD,0,0,0,0,0,0`; a headset-off gun answers nothing and drops the link, bench 2026-08-25 §7r) [A4.4, A6.7] |
| `time_req` | `{ t_node }` | clock-sync ping (§7) |
| `log_offer` | `{ node_id, bytes, lines }` | node has a diagnostic log MC can pull |
| `log_data` | `{ node_id, seq, chunk, last:boolean }` | the log itself, chunked (≤ 48 KB/chunk), in reply to `pull_log` [A3] |
| `ready` | `{ node_id, player_id, ready:boolean }` | ready-up toggle in **KITTED** (phase 4) [A1]; **all-ready gates the `config` push**; a player's `ready` ENDS their try-out [A10.4] |
| `loadout_request` | `{ node_id, player_id, slot:"primary"\|"secondary"\|"perk", kind:"weapon"\|"perk"\|"none", id?, try?:boolean }` | A10.3: phone self-serve pick (loadout.md §4.2). MC validates vs `loadout_policy`, applies, re-sends `assign`, optionally starts the try-out, and ALWAYS answers `loadout_ack` |
| `loadout_browse` | `{ node_id, player_id, open:boolean }` | A10.3: HUD opened/closed its loadout browser → MC roster shows "PICKING…" (60 s server expiry) |

**MC → Node** (`kind`):
| kind | body | when |
|---|---|---|
| `welcome` | `{ session_id, server_t, seq_hi, node_key, node?: { player, team, roster, config, frames, start?, match_id?, score? } }` | reply to hello. **Full re-hydration [A4.5, A5.5]: MC resolves the context by `hello.gun` (sticker/tail → the player bound to that gun) first, then by `node_id`** — so a hot-swapped phone with a brand-new `node_id` is hydrated on its first `hello`, before `bind`. `score?` = that player's current `ScoreRow`. `seq_hi` = highest event seq MC has from this `node_id`; node sets `next_seq = max(own, seq_hi+1)`. `node_key` [A8.2]. |
| `assign` | `{ player: Player, team: Team, roster: RosterEntry[], catalog: { weapons: WeaponView[], perks: PerkView[] }, policy: { hud_select, kit_open, primary: { choice, allowed_ids }, secondary: { choice, kinds, allowed_weapon_ids }, perk: { choice, allowed_perk_ids } }, game }` | kit-out: set player+team → **KITTED** [A2]. Carries **no config**. **Re-sent on any change to the player** [A3] (loadout, name, team, player_num); the node's latest `player` is authoritative. **A10.3/A14.4:** `catalog` + this player's slot rights ride along (also in `welcome.node`) so the phone can browse/pick with no rule logic of its own; `kit_open` + `game` (the BRIEFING) per loadout.md §4.1/§4.6. |
| `loadout_ack` | `{ slot, ok:boolean, reason?: string, dropped?: { slot, id, name }, loadout: Loadout }` | A10.3: reply to every `loadout_request`; `reason` is human copy the HUD shows verbatim. `ok:true` + `reason` = the pick applied but the try-out could not arm (lobby already pushed). A14.2: `ok:true` + `dropped` = the pick applied and knocked the other slot out. |
| `tutorial` | `{ weapon?: Weapon, frames: string[], end?: boolean }` | try-out arming (phase 3a; requires KITTED). Frames compiled by MC; `end` = the teardown push (design-review 2026-08-26: `weapon` optional on both sides or the envelope drops the frame). |
| `config` | `{ config: GameConfig, frames: FrameBundle, roster: RosterEntry[] }` | pushed on **all-ready** (phase 4) [A2] → node writes `frames.head` (no `$SPAWN`), replies `ack_config` → **LOBBY**. Re-pushed (new `frames`) if a player's loadout/num changes after the push. |
| `start` | `{ match_id, go_live_t, config_id, seq, countdown_s }` | schedule the dispersed start (M-START) [A1]. MC mints `match_id` and stamps a **monotonic `seq` per session**. **Rules [A5.6]:** re-push of the *same* schedule (straggler, grace re-arm) = **same `seq` + same `match_id`** (no-op on a node that holds it); a **reschedule** = **new `seq` + new `match_id`** (supersedes). A late-joining player mid-match: `assign` → `config` → the same `start` re-pushed → hot-join (M-START E5). |
| `feedback` | `{ player_id, kind:"kill"|"victory"|(legacy "multi"|"medal"), t, cue?:string, medals?:string[] }` | MC scored you a kill → node `$SFLASH` + `$PLAY` (`cue` if present, else `frames.cues[kind]`; missing → flash only). `t` = the death time; node ignores it if older than `FEEDBACK_MAX_AGE_MS` [A4.3]. `medals` [A11.4]. |
| `alert` | `{ kind, text, player_id, t, hud?:boolean, player_id_subject?, carrier?, flag_tid?, role?: { name, on, tid? } }` | A11.4: a named game event (`player_id` = the recipient; `player_id_subject` = who turned / the last survivor); node plays its own `cues[kind]`/`leds[kind]` + shows `text` as a HUD alert (`hud:false` = sound/lights only); stale (> `FEEDBACK_MAX_AGE_MS`) → dropped. Scope is MC's: all / one team / one player. `carrier`/`flag_tid` start the flag-carrier headset blink [A11.6]. **`role` [A19]** = a HELD headset state (led-language.md §3.3: `carrier`\|`infected`\|`vip`\|`beacon`\|`extracted`) the recipient now holds (`on:true`) or stops holding; `tid` only for a tid-keyed role. The node routes it to `_setRole` (the same mechanism the carrier blink and the infection flip use), paints from ITS OWN `headset.role` table, and logs-and-ignores a name outside the five. Kind `role` is not a presentation event (no cue plays) and the push bypasses the profile's `mc_events` switch: a role is a rule, not a flourish. MC sends `vip` to `config.vip_player_id` **`ROLE_SETTLE_MS` (3 s) after go-live and after each of that player's `respawn` facts** — the node's own start/respawn flash (+1 s, ~1 s) would paint over anything sent at the whistle. `beacon`/`extracted` have no MC-side signal yet (no node→MC fact says who is extracting or extracted), so only the contract exists for them. |
| `control` | `{ cmd, seq?, ... }`, cmd ∈ `end`\|`panic`\|`abort_start`\|`recall` | **one meaning each [A2, A5.9]**: `abort_start`=cancel a *pending* schedule (by `seq`) while ARMED → LOBBY (gun still holds `head`); if the node is already LIVE for that `seq`, it behaves as `recall`. `recall`=stop a *live/armed* game → node writes `frames.end` (+ `cues.game_over`) → **KITTED**; `end`=normal match end → same → KITTED; `panic`=`frames.panic` → KITTED. In KITTED/LOBBY an `end`/`recall` writes `frames.end` iff a bundle is held, then → KITTED. **`pause` is removed** [A4.6]. |
| `join` | `{ pub: string|null, secret: string }` | **A28.2**: the tunnel came up or went down — every connected node adopts `pub` (and re-dials per the A28.3 preference). The same body rides in `welcome.join` on every welcome. |
| `apply` | `{ frames: string[], reason?: string, preview?: boolean }` | A6.4: best-effort "write these frames now" — coverage-zone runtime effects only (syphon heal, regen refill, extraction boost). Node writes verbatim, never persists, ignores unless LIVE. **A9.1:** `preview:true` with frames that are ALL `$PLAY`/`$SFLASH` may be written in `connected`/`kitted`/`lobby` too (the tagger speaks a voice sample when the host changes a voice or gamertag). |
| `score` | `ScoreRow` + `{ shots_total, board?, rows? }` | A7: MC pushes a player's current row to its node whenever it changes (best-effort, coverage-zone). The HUD shows K/D/A (and ACC only once `hits ≥ 1` and `shots ≥ 10`); still "—" until the first push or `welcome.node.score`. **`board?`** (2026-09-03, additive) = `{ teams: [{ team_id, name, score }], cap }` — the race to the frag cap for the HUD's DOWN-screen recap; in FFA the top three players stand in for teams.  **`rows?` [A24]** (2026-09-11, additive) = EVERY player's `ScoreRow` (all modes), so a phone can show a leaderboard mid-match and at the end; a node that does not know the field ignores it. `ScoreRow` itself gained `best_streak`, `first_blood`, `multi_best`, `acc_provisional` [A24] — the HUD shows `best_streak` (the current `streak` is ~0 for whoever died last) and dims ACC while `acc_provisional`. `rows?` is sent on EVERY push, in EVERY mode (2026-09-12). |
| `result` | `{ match_id, outcome: "win"|"lose"|"draw"|"undecided", winner: { team_id?, player_id?, tie? }, mode, win_by, team_scores: [{ team_id, name, score }], rows: ScoreRow[], my: ScoreRow|null, honors: [{ medal, player_id, display, stat }], possession?: { by_team: {tid: s}, ... }, after_end?: { facts, by_player: { [player_id]: {kills, deaths} } }, provisional: boolean, t }` | **A24 (2026-09-11): the MATCH RESULT reaches EVERY player node, losers included.** MC sends it from `_finish()` to every bound player node (best-effort, coverage-zone), re-sends it while `provisional` whenever the recap changes (a parked flush moved a row), and carries the final one in `welcome.node.result` while the session is in `recap`, so a phone that comes back into coverage after the whistle still learns how it ended. `outcome` is computed per RECIPIENT by MC from `winner` (team match → my team; FFA → me; `tie` containing my team → `draw`; `undecided` → `undecided`). **The node NEVER infers win or lose**: before a `result` arrives the results screen says the match is over and the result is pending ("MC NOT REACHED" after the settle window), because a `victory` cue that did not arrive means "lost" and "out of coverage" identically (game test 2026-09-11 D3). `rows` is every player, so a team match shows per-player lines; `my` is the recipient's own row (null for a player MC never scored). Hill/possession and objective totals ride in `possession` / `team_scores` — the HUD's results screen is mode-aware from `mode`/`win_by` and never hard-codes five cells. The node also folds `outcome`, `team_scores`, `best_streak`, `medals` and its own hill hold into the `onEnd` history entry, so a match played before the phone learned this field has them missing, never wrong. **Built 2026-09-12 (M2):** `team_scores` is `[]` in FFA — `rows` is already the leaderboard there. In `honors`, `display` is the PLAYER's name, so a phone renders the roll with no roster. `winner` may carry `tie: string[]` (team_ids, or player_ids in FFA); a recipient inside it is told `outcome: "draw"`. `after_end` is the UNOFFICIAL after-the-whistle block (Tony 2026-09-12: kept, shown, never counted) and rides only when something landed late. |
| `station_config` | `{ kind, team, id, threshold?, game?, valid_ids? }` | A13.5: MC → a **utility** node at muster (and on re-arm). The phone applies it to its advert, marks itself MC-ARMED and locks its on-device config. `game` absent = 0 (any); the authoritative allow-list players enforce stays `config.stations` in the bundle (utility.md §5c). **Server side built 2026-09-11 (F104):** MC sends it on the phone's hello (if assigned), on every `PUT /api/stations/{node_id}` and on every lobby push; `game` = MC's per-match byte (1-255, bumped on the first push after a match started — the phone resets its point when it changes); `valid_ids` = every id MC assigned this session. ⚠ It is in BOTH kind whitelists (`types.MC_KINDS` and the phone's `envelope.js`); `test_mc_stations.py` pins them equal. |
| `time_res` | `{ t_node, server_t }` | clock-sync reply |
| `pull_log` | `{ reason?: "recap"|"offer"|"manual"|"reconnect" }` | request the offered log. **A25 (2026-09-11) BACKGROUND LOG SYNC:** MC asks every player node at `_finish()` (`recap`), on each `log_offer` (`offer`), from the operator's LOGS button (`manual`) and on the `hello` of a node whose log for the last match never arrived (`reconnect`); the request is gated by the session option `log_sync` (`"auto"` default, `"manual"` = only the button). **The node answers only when it is safe:** never while ARMED or LIVE, and never while its store-and-forward ring holds unacked facts (`ring.pending() > 0`) — game sync has priority (Tony 2026-09-11). A deferred request is remembered and served when the ring drains (5 s → 60 s backoff), and a node that reconnects re-offers (`log_offer`) so MC can ask again; `log_data` chunks are sent one at a time and the next waits for the socket to drain, so a log never starves a fact. The operator sees per node: `log: "none"|"offered"|"pulling"|"held"|"complete"` in `State.nodes[]` (`NodeView.log = {state, reason?, lines?, bytes?, last_t}`). **Server built 2026-09-12:** MC refuses the ask for a utility node (F106(d): a station never binds a match) and once a node passes the ~1 MB per-node budget; only a complete `last`-terminated stream counts as delivered — a half-uploaded log still reads as owed, which is what the `reconnect` ask tests. |
| `ack` | `{ seq_hi }` | MC has durably ingested this node's events up to `seq_hi` (store-and-forward ring-prune signal) [A1] |

### 5a. Store-and-forward semantics (mandatory)

**The gun loop NEVER blocks on the WS.** The engine writes to the gun over BLE and emits `Event`s into an
in-process outbox; the WS layer drains it asynchronously. Two kinds of uplink [A4.4]: **persisted facts**
(`hit_taken`/`death`/`respawn`/`team_change`) get the node's next `Envelope.seq` at enqueue, are appended to a
**bounded, persisted ring** (`app/src/transport/ring.js`; ~500 facts or 2 h, whichever first; overflow drops
oldest and counts `dropped`) and are replayed until MC `ack`s them; **live-only** messages (`status` and the
other `NodeMessage`s) are sent iff bound and never queued (a queued heartbeat would flush minutes of stale
snapshots at reconnect).
- On reconnect the node sends all un-acked facts as `event_batch`es (≤200/batch, oldest first). MC dedups by
  `(node_id, seq)`: `seq ≤ last_applied` is a replay → dropped silently; `onEvent` fires only for facts that passed.
  The wiped-install hole (a fresh app restarting at seq 0 and having every real fact dropped) is closed by
  `hello.seq_next` / `welcome.seq_hi` [A4.5]; MC logs `seq_next < seq_hi` as "node storage reset".
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
open for a spectator board; `State.lan.auth_required`. **Node re-claim key [A8.2]:** `welcome.node_key` is a
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
| (d) | **No-internet Wi-Fi is deprioritised** — the default route may go to cellular | "connecting…" forever with full bars | Android: native `requestNetwork(WIFI)` + `bindProcessToNetwork`; iOS: Wi-Fi Assist off. Preflight `ssid_ok`, `mc_reachable` |
| (e) | **Auto-rejoin after walking out of range** may be off | nothing syncs at the base; recap empty | preflight `auto_join_ok`; per-OS muster step; MC's Network screen names the SSID |
| (f) | **Mobile data** re-routes on some OEMs | as (d) | muster checklist; preflight `cellular_off` best-effort |
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
are the CLI forms. No `starting`→`up` within 20 s, or the process exiting, is `status:"error"` with the last output
line in `error`; `ws_url` goes back to null. The tunnel is **opt-in and additive**: the LAN path is untouched and
the host needs internet only if they turn it on.

**A28.2 The two-URL join.** `lan.qr` becomes `ws://<lan-ip>:<ws-port>/ws?s=<join_secret>[&pub=<url-encoded
public ws_url>]` — the LAN URL first, the join secret always, the public URL when `public.status == "up"`.
`Session.join_secret` is 8 url-safe chars, random per session and **persisted with the session snapshot** so a
restore keeps every printed QR valid. The node splits the query off before dialling (`mcurl.parseMcJoin` →
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

**A28.3 Reach policy on the node — backhaul is PREFERRED when offered.** The Transport holds `{ url, pub }`.
When `pub` is set it dials **`pub` first**; on failure (`BACKHAUL_GIVEUP_MS = 8000` without a welcome, or an
immediate error) it dials `url`; while on the LAN with a `pub` in hand it re-tries `pub` every `PUB_RETRY_MS =
30000` and switches when it welcomes (close + reconnect; the ring covers the gap). With no `pub` the loop is
exactly today's. Rationale: the URL that works everywhere is the primary; the LAN is the fallback for phones with
no data path. This is what makes coverage **observed** (A28.4): a phone that can use backhaul is on it from the
lobby, one that cannot is visibly on the LAN, and an MC whose internet dies sees every node fall back within a
reconnect. Traffic is tiny (a status every `STATUS_HEARTBEAT_MS` plus events, well under 1 MB/h) and the added
round trip through the tunnel edge touches nothing time-critical (§7 start/end are pre-shared; feedback is
best-effort). `status.reach: "lan"|"backhaul"` reports the live socket's path as the phone sees it, but **MC stamps `NodeView.reach`
itself from the socket's arrival path** (the same test as the secret gate) and never from the claim: coverage and the
readiness amber are server facts. The 30 s re-try from the LAN is a **reachability probe, not a second session**: the
node opens a socket to `pub`, and on a successful open closes it without a hello and re-dials pub-first on its ONE
socket (the server's one-socket-per-node takeover rule would otherwise kill the LAN link on every probe).
§5c gates (d) and (f) become **warnings, not reds**, for a node that reports `reach:"backhaul"`.

**A28.4 Coverage is derived, no longer asserted.** `Session.coverage()` → `"full"` iff **every bound player node
is connected with `reach == "backhaul"`**, else `"zones"`; it rides on the snapshot as `coverage: { level, on_backhaul,
bound }` and is passed to `Compiler.validate(..., {coverage})` at config validation and at the lobby push. Full
coverage **clears the A6.1 frag-limit warning and makes frag-limit / survival ends authoritative** (`scoring.frag_limit`,
`win_by:"survival"`). It does **not** unlock `time_limit_s: null`: a cell signal is less trustworthy than a venue
assertion, and a phone that loses data mid-match must still hold an end it can reach alone — that clause of A4.8
stays a venue assertion, which nothing sets today. A mode may declare `requires_coverage: true` in its `PARAMS`
(A18); the lobby push refuses it (`409 {error, coverage}`) unless coverage is full at push time. No catalog mode
does yet; the hook is reserved for modes where MC knows something no gun can (bounties, VIP swaps, park-wide
zone control).

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
  a single `time_req` every ~30 s while connected; re-burst after any reconnect.
- **synced_now() = local_now() + offset.** All `go_live_t`, expiry, respawn and event-`t` math uses synced time.
  `synced()` = a sample fresher than `SYNC_FRESH_MS`; it gates ready-up (M-START §4) and rides `status.synced`.
- Phone clocks drift ≪1 s over a match; re-sync at lobby is enough. A node that never synced falls back
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
- **Constants** (single source: `mcp/brx_mcp/mc/types.py`'s module-level block on the server side and
  `app/src/transport/envelope.js` on the node side, which `engine.js` imports wholesale as `W`; modules reference
  by name, never redefine): `ASSIST_WINDOW_MS = 4000`, `MULTI_KILL_MS = 4000`, `FEEDBACK_MAX_AGE_MS = 3000`,
  `STATUS_HEARTBEAT_MS = 2000`, `STALE_AFTER_MS = 8000`, `SYNC_FRESH_MS = 10000`, `LATE_ARM_GRACE_MS = 8000`,
  `CONFIG_TTL_MS = 1800000`, `MAX_PLAYERS = 63` (wire ids 1–63; 0 reserved), `DEATH_LATCH_MS = 2000`,
  `RESYNC_PROBE_S = 10` (the LOBBY/ARMED observe window), `RECONCILE_MS = 3000` (the LIVE rejoin window, A6.8),
  `DEFAULT_RUNWAY_S = 120` (walk time on a park [A5.10]), `MAX_HP`/`MAX_AR` from GameConfig. All are tunable defaults.

## 10. Amendment index (dates; what; where it now lives)

| id | date | what | folded into |
|---|---|---|---|
| A32 | 2026-09-12 | A SUSTAINED BLE LINK PROVES THE HEADSET (Tony 2026-09-12: "a strong and valid connection to BLE on the phone means the headset is connected"). Bench facts already in the manual (`manual/hardware.md`, `manual/dev.md`): a gun with no headset accepts a link, answers a `$PING`, then drops within seconds; switching a linked headset off makes the gun send `$DISCONNECT,*` and drop. So the readiness board no longer waits for the config echo: `headset` becomes **`proven`** once the node's `status.preflight.gun_linked` has been true continuously for `HEADSET_LINK_PROOF_MS` (10 s — the drop is ~6 s, with margin), falls back to `unknown` when the link drops (and re-proves after another sustained 10 s), and `absent` still means the head echoed nothing (`GUN DID NOT ANSWER CONFIG — HEADSET OFF?` stays red). The amber `HEADSET UNPROVEN UNTIL CONFIG PUSH` is replaced by a short-lived `HEADSET · CONFIRMING (LINK 4 s)` that clears itself; the Armory card reads `HEADSET · PROVEN BY LINK` and, after the echo, `CONNECTED`. | `state.py readiness()`; `types.py HEADSET_LINK_PROOF_MS`; `mc/API.md` ReadinessRow.headset; `Armory.tsx`; `manual/hardware.md` (fact already there) |
| A31 | 2026-09-12 | THE "VERIFY AT MC" PRE-GAME WARNING (Tony 2026-09-12): a game whose END STATE is decided by MC — `scoring.frag_limit` set, an objective `win_by`, a survival win — carries a compiled `briefing.mc_verify` line when the venue is NOT full-coverage and at least one rostered phone has no backhaul (A28). The compiler emits it ONCE (`assign.game.mc_verify` / `FrameBundle.briefing`), so MC and the phones cannot disagree: the HOST sees it on LOBBY and ARMED (`WIN IS CONFIRMED AT MC · 3 PHONES OFF-GRID · TELL PLAYERS TO RETURN AFTER THE WHISTLE`, naming the phones), every PLAYER sees it on the ARMED screen after the config lands and before the countdown (`A WIN IS CONFIRMED AT MISSION CONTROL · RETURN AFTER THE WHISTLE`), and the DOWN screen at cap−1 and the results screen repeat the same fact (A24). Absent when full coverage or every phone has backhaul. | §3 `assign.game` / `FrameBundle`; `compile.py`; `Lobby.tsx`/`Armed.tsx`; `hud.js` armed screen **Server built 2026-09-12:** `compile.mc_verify()` / `full_coverage()` (one coverage model; `GameConfig.coverage?: "full"|"partial"`, absent = partial, `opts.coverage` still wins), `assign.game.mc_verify` (presence IS the rule), `State.notices.mc_verify` names the phones. ⚠ `backhaul` is unreported until A28 lands, so every phone counts as off-grid today. |
| A30 | 2026-09-12 | THE KIT LOCKS AT START. While the session is `armed` or `live`, a phone `loadout_request` is answered `loadout_ack {ok:false, reason:"THE MATCH HAS STARTED — YOUR KIT IS LOCKED UNTIL THE NEXT ONE"}`, the host's `PATCH /api/players/{id}` loadout/voice/number edits are refused (409), and `_push_config_to` refuses as a backstop — the same guard `POST /api/lobby/push` gained (no `force` past it). **Why:** a `config` to a live node writes the head, clears `spawned` and keeps the phase, and `resumeSchedule()` returns early for `live`, so nothing re-spawns that gun: it cannot fire and, after A23, cannot be hurt. `assign` (roster/display, no frames) still flows, and a node that has not yet taken this match's config (no ack for it, not reporting armed/live) still hot-joins per E5 — it receives `config` + the same `start`, because the head it is missing is the one that puts it IN the match. A loadout change after START belongs to the next match. | §5 `loadout_request`/`loadout_ack`; `mc/API.md`; `state.py` (`_push_config_to`, `_on_loadout_request`, `_after_player_change`); `loadout.md` §4.4 |
| A29 | 2026-09-12 | PHONES REPORT THEIR REAL BUILD, AND MC WANTS ONE VERSION AT MUSTER (Tony 2026-09-12): `hello.app_ver` and `status.app_ver` carry `"<package version>+<git sha>[-dirty]"` baked into the bundle at build time (the app had sent a hard-coded `hud-0.2`, so MC could not tell APK 0.1.8 from today's tree — game test 2026-09-11), plus `platform: "android"|"ios"|"web"`. MC keeps it per node (`NodeView.app_ver`, `.platform`), shows it on the Armory card and the readiness row, and summarises the field in muster (`PHONES · 3 × 0.1.9 · 1 × 0.1.8`). **Versions are SEMVER and the tiers carry meaning (Tony 2026-09-12): MAJOR = anything the game or the wire depends on (protocol, engine rules, bundle shape); MINOR = HUD-facing features with no game impact; PATCH = fixes.** MC holds `APP_MAJOR`, the app major it is compatible with, as one constant beside the protocol version (`types.py`); a phone on another major is a **RED** readiness blocker `APP MAJOR 1 ≠ MC 2 — UPDATE THE APP` (it can misplay the match), while MINOR/PATCH may differ per phone: two AMBER flags, never red (A1: amber never blocks) — `APP OLDER THAN THE FIELD (1.1.8 < 1.2.0)` when behind the newest player node, and `APP OLDER THAN THE RELEASE` when behind `webapp/download/build.json`, the card carrying the release URL. **While the app is on 0.x, semver's own rule applies: MINOR is the breaking tier (0.1 ≠ 0.2 is RED) and only PATCH may differ**, until 1.0.0 is cut. Utility phones report the same way. Followup (store builds): a phone behind gets a one-tap UPDATE THE APP screen into the store listing. | §5 `hello`/`status`; `mc/API.md` NodeView + ReadinessRow; `app/package.json` build script (esbuild define); `state.py readiness()`; `Armory.tsx` **Server built 2026-09-12:** `types.APP_MAJOR`/`APP_MINOR`, `parse_app_ver()`, `compatible()` (0.x compares `(major, minor)`, ≥1.0 compares `major`; build metadata after `+` ignored). Shipped wording: red `APP <x.y.z> INCOMPATIBLE WITH MC (NEEDS <tier>) — UPDATE THE APP` (one string for both regimes); amber `APP OLDER THAN THE FIELD (…)`, `APP OLDER THAN THE RELEASE (…)`, and `APP VERSION UNKNOWN (<raw>)` for an unparsable value (never red). An incompatible build is excluded from `newest`, so one rogue phone cannot amber every correct one. `State.versions = {field, newest, release, mc_major}` (`mc_major` is the tier string, `"0.1"` on 0.x). Phone side: `app/scripts/build.mjs` bakes `__APP_VER__` = `<package.json version>+<sha>[-dirty]`; `hello` and every `status` carry `app_ver` + `platform` (Capacitor's platform, `web` outside the app). |
| A28 | 2026-09-12 | BACKHAUL (B30): a phone with a data plan reaches MC off the field Wi-Fi, no per-phone setup. A28.1 MC exposes the NODE SOCKET ONLY through a tunnel (`lan.public`, `POST /api/tunnel`, cloudflared quick tunnel = no account/domain/login; `--tunnel`, `--public-url`); A28.2 two-URL join QR `ws://lan/ws?s=<secret>&pub=<wss>`, `hello.via/secret`, `welcome.join` + MC→node `join`, secret enforced only through the tunnel; A28.3 the node PREFERS backhaul when offered and falls back to the LAN (`status.reach`); A28.4 coverage is DERIVED (`Session.coverage()`, every bound node on backhaul ⇒ `full`): frag/survival ends authoritative, `time_limit_s` still required, `PARAMS.requires_coverage` reserved. (A26/A27 are taken by uncommitted 2026-09-11 work; numbered past them on purpose.) | §5 tables, **§5d** |
| A27 | 2026-09-11 | CONTINUE IS GUARDED ON BOTH SIDES (F127): `POST /api/phase {phase:"lobby", force?}` from `kit` is refused (409, `{error, not_ready: [display…], greens, roster_size}`) while any rostered player is not ready unless `force:true`; the MC UI's CONTINUE reads `CONTINUE · greens / roster_size READY` and needs a second tap that names who is not ready. On the node, a host advance that lands while a player is mid-kit is NOT silent: the engine raises `moment {kind: "kit_locked_by_host"}` and the lobby screen leads with "THE HOST LOCKED KITS — you play what you had" (loadout.md §4.4). | `mc/API.md` `POST /api/phase`; `state.py set_phase`; `Kit.tsx`; `engine.js`; `loadout.md` §4.4 **Server built 2026-09-12:** `Session.set_phase()` raises `NotReadyError` → `POST /api/phase` 409 `{error, not_ready, greens, roster_size}`; `greens` is the count of players who ARE ready (not the readiness board's green count); `force:true` passes. |
| A26 | 2026-09-11 | TRY-OUT COLLAPSES INTO SELECTION (S20): in the LOADOUT browser **tapping a weapon row equips it AND arms it for test-firing** (`loadout_request {try:true}`) after a **400 ms debounce** on the node (scrolling through rows never spams MC or `$WEAP`); the ✓ marks the row MC acked, an ⟳ the one still arming. `TRY IT` is gone; the action bar reads **`REVIEW KIT ▸`** (opens the three-plate kit summary with READY UP) and a row's ⓘ opens its detail. Perks still equip on tap with no try. Wire unchanged — the collapse is node-side timing plus copy. | `loadout.md` §4.5; `engine.js`; `hud.js` |
| A25 | 2026-09-11 | BACKGROUND LOG SYNC (S26): `pull_log {reason?}` gains a reason and a gate — MC asks at recap / on offer / from the button / on the reconnect of a node whose match log never arrived, under the session option `log_sync: "auto"|"manual"` (`PUT /api/options`); the NODE answers only when not ARMED/LIVE and its fact ring is empty, defers with backoff otherwise, chunks wait for socket drain, `State.nodes[].log` shows the state. The phone's `pull_log` handler did not exist before this (MC had asked at every recap since A3 and no phone ever answered). | §5 `pull_log`; `node.md` §6; `state.py`; `app/src/app.js` **Server built 2026-09-12:** the option is `GET/PUT /api/options {log_sync}`; the operator's LOGS button is `POST /api/nodes/{node_id}/pull_log` (`reason: "manual"`, never gated); `NodeView.log` carries the five states. Phone side: `app/src/logsync.js` (gate, 5→60 s backoff, tail-only resend, one chunk in flight behind `bufferedAmount`), `npm run ui:logsync` is its 17-check browser gate. |
| A24 | 2026-09-11 | THE MATCH RESULT REACHES EVERY NODE (S23): new MC→node `result` (outcome per recipient, winner, team scores, EVERY row, honors, possession, provisional) at `_finish()`, re-sent while provisional, carried in `welcome.node.result` during recap; `score.rows?` = every row mid-match; `ScoreRow` gains `best_streak`, `first_blood`, `multi_best`, `acc_provisional` (F116/F119). The node never infers win/lose; the HUD's FINAL RESULTS screen is mode-aware (team + player views) and the history entry keeps outcome + objective stats. | §5 `result`, `score`; `node.md` §3.13; `scoring.py rows()`; `state.py _finish/_push_result`; `hud.js` **Server built 2026-09-12 (M2):** `+ after_end`, `winner.tie` (`CLOCK_TIE_MS`), `score.rows` in all modes, per-recipient `outcome`, `welcome.node.result` in recap, and the REPLAY reconciliation (§4). |
| A23 | 2026-09-11 | SPAWN PROTECTION (F121): **the pregame head must not arm hit reception.** Per F11 the `$SIR` table IS the arming, and until tonight `frames.head` shipped the live table beside the pregame team colour at the lobby push — so a player took real hits (sounds, LEDs, the gun's own pool decrements) through the countdown and before their `$SPAWN`, while software correctly booked nothing (game test 2026-09-11 C1: "the team colour on the headset is the visible marker that you have become hittable"). Now `compile.sir_spawn_protected(rows)` writes the head's `$SIR` table as the SAME cells in the SAME order with every function replaced by **fn 28** (a STATUS function: the `$HIR` fires, nothing moves, no sound, no flash — the bench-proven silent row the hill beacon already uses), and the REAL table leads `frames.spawn` (ahead of `$PLAYX,0` + `$SPAWN`) and `frames.revive` — or, with `hit_audio_class` on, the `sir_pool` take the node writes before every revive (exactly one carrier, or the take's rolled sounds are clobbered). Three compile-time guards make the failure modes loud: `assert_spawn_protected(head)` (no head row may move a pool), `assert_arms_at_spawn(head, spawn)` (every disarmed cell is re-armed at `$SPAWN` — a cell left on fn 28 all match is F11 wearing a different hat: an immortal player both ends report as healthy) and `assert_rearms_every_life(bundle)` (a revive re-arms too, because `engine.js _resyncNotLive` re-writes the HEAD on a live node and then revives). The stun row (A20) keeps its swap in the live table; the hill row `$SIR,15,0,,28` is fn 28 in both. **The node is unchanged**: the rows sit inside frame lists it already writes verbatim, and swapping `$SIR` mid-game was already proven by `_revive`. Utility nodes hold no `$SIR` and are untouched. ⚠ Bench gate open (F121 🟡): push, take a hit during the countdown — the headset must NOT react and the pool must not move; after `$SPAWN` the same shot must land. | §3 FrameBundle (head / spawn / revive); `mcp/brx_mcp/mc/compile.py` (`sir_spawn_protected`, the three `assert_*` guards); `mcp/tests/test_spawn_protection.py`; `mc/API.md` `POST /api/lobby/push` |
| A20 | 2026-09-11 | HOST-DRIVEN STUN (F15): `GameConfig.stun = {duration_s?}` (default 10 s, 1..60). **The gun does not stun itself** — the proven chain is a proto-8 IR word → the victim's `$SIR,8,0,,24` row (fn 24: a STATUS function, `$HIR` fires, no pool moves, no `$HP` follows) → the NODE writes `$AMMO,<slot>,0,0,1,*` for every live slot → the node restores the **LIVE** counts (last `$ALCD` per slot, else the frame's spawn values; F87: a re-push refills, a stun must not) when the timer runs out. **The cell is the charge rifle's** (`<8,0>`, stock fn 38), so with stun on the charge rifle IS the EMP source and deals no damage; the other source is a proto-8 station. `compile.sir_table(stun=True)` swaps the row's function in place (stock order kept, sound token carried over — F43, never invented) on the head AND on every `sir_pool` take (a revive that re-wrote the stock row would un-stun the game). **Rules the node keeps** (`engine.js _stun`/`_stunRestore`, mirrored in `stage.py`): only under `config.stun`, only LIVE and spawned and alive; a second EMP EXTENDS the window (no second disarm write, never a double restore); death CANCELS with no write (`frames.revive` re-arms); a rejoin reconcile takes the stun over (coarse: it re-arms with the frame's counts); a link that is down at expiry gets no write and the relink reconcile re-arms it; `$ALCD` while stunned is ignored (a gun that cannot fire has nothing to count, and the echo of our own `$AMMO,0` must not become the count we restore — hardware-UNVERIFIED whether it echoes). HUD: `moment {kind: stunned, data:{ms}}` / `stun_over`, `state().stunned = {until, leftMs}`; presentation hooks `stunned` / `stun_over` (no profile carries them yet). No wire fact (a status row moves no pool, so there is no `hit_taken`; MC does not learn of stuns — open). `validate()`: shape, range, refused with `hit_audio_rekey` (the re-key would move the charge rifle off the EMP cell with its damage intact), a WARNING naming the rostered weapons that become stunners, and a WARNING when nothing in the game can stun. Exposed at `PUT /api/config` (`stun: {duration_s?}` or `null` to clear; the shape is a 400, the range and the source warning are `validate()`'s). **The native stun is not relied on** (2/5 singles, lasts until death). | §3 GameConfig; `node.md` §3.12; `mcp/brx_mcp/mc/compile.py` (`_STUN_SIR_ROW`); `protocol/brx-protocol.md` §5 fn 24 |
| A21 | 2026-09-11 | `$PLAY` SLOT SEMANTICS, and a per-event `slot`: `presentation.events.<event>.slot = "queue" | "interrupt" | null`. **Bench-proven 2026-09-11 (six trials, one gun): `$PLAY` token 1 INTERRUPTS whatever the gun is playing, in either slot, mid-word; token 4 QUEUES behind it (depth ≥ 3 observed) — and that is a property of the SLOT, not of the id: an fx id sent in token 4 queues like a voice line.** `play_frame()` keeps the old rule by default (V-family ids → token 4, everything else → token 1); an explicit `slot` overrides it, and `voice:<role>` sounds always queue. First use: `extraction_tick` ships `JAS` (a 10.7 s track) with `slot: "queue"`, so the ~10 s tick becomes a seamless loop that never cuts a call — which also means a queued tick's cadence must be ≥ the clip length or the queue accumulates (S3 design note). `merge()` validates the value (400 at `PUT /api/config`); the ADVANCED table and `GET /api/presentation` carry it. The node is unchanged: it writes the pre-composed frame verbatim. | §3 `GameConfig.presentation`; `mcp/brx_mcp/mc/presentation.py` (`play_frame`, `merge`); `protocol/brx-protocol.md` `$PLAY` row; `experiment-log/2026-09.md` → *the sound pass* |
| A22 | 2026-09-11 | PER-GAME VOICE SWITCH for the player's OWN voice lines: `presentation.voice = "on" \| "hits_only" \| "off"` (default `"on"`). **Tony, 2026-09-11: "let the config drive it. silenced snipers no grunts could be legit."** `"on"` plays everything (today's behaviour); `"hits_only"` keeps the three pain cues (`cues.pain_short`/`pain_long`/`pain_melee` + their `cue_pools`) but drops the spawn line; `"off"` drops both. The spawn line is TWO bundle keys for ONE line — `cues.spawn` (played by `engine.js _spawn()` on the first life) and `cues.respawned` (played by `_revive()` on every life after that, `presentation.EVENTS["respawned"]`, source `hud`) — both are withheld together, or the recurring respawn line would keep speaking under `"hits_only"`/`"off"` while only the very first spawn went quiet. `announcer` is untouched and independent (it gates MC/announcer feedback, not the player's own cues); the native death scream (`pset_pool`) and the A17 material hit sounds are unchanged in all three — the scream is firmware, not a `$PLAY`, and a death already gives no position away. `merge()`/`resolve()` validate and carry the field (400 at `PUT /api/config` on any other value); the `silenced` preset sets it `off`, every other preset `on`; any field edit still makes the preset `custom`. The node is unchanged: a missing `cues[kind]`/`cue_pools[kind]` already reads as silence. | §3 `GameConfig.presentation`; `mcp/brx_mcp/mc/presentation.py` (`_BASE`, `VOICE_VALUES`, `merge`, `resolve`, `summary`, `PRESETS["silenced"]`); `mcp/brx_mcp/mc/compile.py` (`voice_switch`, ~L994-1046) |
| A19 | 2026-09-11 | HELD ROLES REACH THE NODE (S10): `alert.role = {name, on, tid?}` routed to `engine.js _setRole`; `GameConfig.vip_player_id` (rostered, never in a saved game) — MC pushes `vip` 3 s after go-live and after each VIP respawn (`Session._push_role`, `ROLE_SETTLE_MS`), bypassing `mc_events`; `beacon`/`extracted` have the contract but no MC-side signal yet | §3, §5 `alert`; `mc/presentation.py role_alert_body` |
| A18 | 2026-09-11 | MODE PARAMS (E1): `GameConfig.mode_params`, declared per engine as `PARAMS` (`modes/params.py`), resolved through `modes/registry.py` (the E2 seed: `register_mode`), served as `GET /api/modes .params`, refused-not-dropped at PUT and in `validate()`; complete-or-absent on the wire; engines read `score_target`/`points_per_s`/`cap_target`/`detonation_s`/`rounds_to_win`/team sides/`channel_s`/`win_target`/`loot_per_kill`/`drop_policy`/`extract_removes_player`/`lives` instead of literals | §3; `docs/spec/modes.md` §2.1 |
| A1 | 2026-08-25 | `ready`, `ack{seq_hi}`, `start.seq`/`countdown_s` + `abort_start`, `status.arm_state`, battery amber-not-red | §5 tables, §4, §1.1 |
| A2 | 2026-08-25 | `assign` split from `config`; `recall` vs `abort_start`; `t_minus_ms`/`synced`; three `seq` namespaces; link state orthogonal | §5, §6, §9 |
| A3 | 2026-08-25 | `status.dropped`, `arm_state:connected`, `log_data`, `assign` re-sent on change, native multikill is NOT free under BLE (host-`$PLAY`, LAN-gated) | §4, §5 |
| A4 | 2026-08-25 | **P2 closed over BLE**: A4.1 exact `shooter_num` (no `approx`), A4.2 frames compiled by MC (`FrameBundle`), A4.3 `match_id` + parking, A4.4 `shot` removed / `status` live-only / `gun_echo`, A4.5 `welcome` re-hydration + `seq_next`, A4.6 lifecycle (superseded by A5.9), A4.7 `t_recv`, A4.8 field reality (`time_limit_s` required), A4.9 node-reported readiness, A4.10 `roster` to nodes, A4.11 mounted + foreground phone, A4.12 module interfaces | §2-§6 throughout |
| A5 | 2026-08-25 | A5.1 wire id 0 reserved, A5.2 roster-based friendly (never in FFA), A5.3 observe-before-write resync, A5.4 readiness cannot deadlock + probe set, A5.5 hydration keyed by the gun, A5.6 `seq`/`match_id` rules, A5.7 batched time base, A5.8 `team_change`, A5.9 everything lands in KITTED, A5.10 `cues.game_over` + `DEFAULT_RUNWAY_S`, A5.11 bookkeeping | §2, §4, §5, §6, §9 |
| A6 | 2026-08-25 | A6.1 end freeze, A6.2 hot-swap shots, A6.3 cues are pre-composed frames (two node templates), A6.4 `apply{frames}`, A6.5 `player_num_base`, A6.6 positive-evidence resync, A6.7 doc fixes, **A6.8 (2026-09-04)** live-rejoin reconcile | §4, §3, §5, §6 |
| A7 | 2026-08-25 | MC→node `score` push | §5 |
| A8 | 2026-08-25 | A8.1 operator auth, A8.2 node re-claim key, A8.3 input hardening | §5b |
| A9 | 2026-08-26 | A9.1 `apply.preview` | §5 `apply` |
| A10 | 2026-08-27 | M-LOADOUT: A10.1 an empty slot 1 is legal, A10.2 `loadout_policy`, A10.3 phone self-serve picks (`loadout_request`/`browse`/`ack`), A10.4 ready semantics; two slots + perks, saved games (`/api/presets*`) | §2, §5; full text `loadout.md` |
| A17 | 2026-09-07 | HIT AUDIO, **bench-confirmed**: what a hit sounds like to the player who took it (`mcp/brx_mcp/hitaudio.py`). **MATERIAL** — the `$PSET` foot's hit slots are chosen by EAR, not from the catalog: armour rings metal (`H02`/`H36`/`H37`, three complementary takes rolled per `pset_pool` write), shield fizzes (`H22`), **health ships EMPTY and is deliberately SILENT** — the node's pain grunt (A17.1) is the only thing that speaks when damage is real, so the signal is the metal STOPPING. `energyShieldLoop` also ships empty (Callsign's `A10` LOOPS a geiger tick while the shield is up). ⚠️ An empty EFFECT field is NOT silence: it falls through OUTWARD to the neighbouring pool's clip (empty `hitShield` plays the armour clip); health can ship empty only because it is innermost. This differs from the A15.2/A15.3 voice-field rule. The APK slot ORDER is correct (an intermediate "swapped" reading was retracted). **CLASS** — the `$SIR` `<soundID>`, keyed by the shooter's `$WEAP` tok3/tok4, is per WEAPON. **It ships OFF** (`GameConfig.hit_audio_class`, default false; `sir_pool` empty, stock rows keep their empty sound token) because `$SIR` REPLACES the `$PSET` pool sound rather than layering: the two layers compete for one hit, and the material layer is ear-confirmed while `CLASS_POOLS` has never been auditioned. `GameConfig.hit_audio_rekey` (also default false) would additionally give each (family, function) its own free cell; `compile.assert_sir_covers_weapons` guards every head, since an unmatched cell is silently ignored (the F11 shape). **A17.2 LOW HEALTH IS A THRESHOLD** — the `low_health` alert fires once per life when HP drops below 15 (`engine.js LOW_HEALTH_HP`, mirrored in `stage.py`), NOT when armour reaches 0; the old condition fired on the first health hit of a life and A17's silence made it the only sound on that transition. The `maxArmor > 0` guard went with it (an HP threshold is meaningful with or without armour; see F47 -- `get maxArmor()` turns an explicit 0 into 70, so that guard could never have been false). **A17.3 THE GRUNT IS SIZED ON TOTAL DAMAGE** — long-vs-short uses the TOTAL pools lost, not the HP portion, on purpose: a round that strips your plating and reaches you is a heavy hit. The one place the A17 gate and the pain sizing deliberately disagree. **A17.1 CHARACTER** — the pain grunt plays only when the hit reached HEALTH (`engine.js _pain(dmg, proto, pool)`, `stage.py` mirrored, both reading A16's `movedPool`); short vs long still by damage from the same pools (A15.3). ⚠️ Sound ids picked by ACOUSTIC SHAPE are unreliable: shape cannot separate metal from electronic, an impact from a near-miss, or a player from a creature — every shape pick was rejected on hardware. Ear-confirm before shipping any id. | §2 GameConfig, §3 FrameBundle; `mcp/brx_mcp/hitaudio.py`; `protocol/brx-protocol.md` §`$PSET`; `docs/manual/sound.md` |
| A16.5 | 2026-09-09 | **An emptied pool HANDS OVER inward** (`poolgauge.handover_pool`): the drain still animates to level 0, then the readout paints the next pool inward that still has value (shield → armour → health) instead of holding an all-dark strip for `hold_s`. Found on the gun: a shot took armour 35 → 0 while health was untouched at 45/45 and the body went DARK for four seconds, i.e. the strip read "nothing left" at 100% health. Health emptying hands over to nothing (that is death, and death is hands-off). ⚠ **Protocol retraction the same night: an EMPTY `$GLED` colour token is RED (0), not "keep this LED"** — measured on a purple strip, `$GLED,,9,,0,10` gave red · dark · red. A16.3's partial-level blink was built on the wrong reading and painted red into every bar; blink frames now write all three colours explicitly | §3 |
| A16.4 | 2026-09-09 | **The gun body rests on the TEAM COLOUR at DIM brightness** (`GUN_DEFAULT.in_play` back to `team`, painted via `poolgauge.team_frame(..., dim=True)` — token 5 = 1). **The brightness split is the load-bearing half and a reader must not miss it:** the rest is DIM while the readout paints FULL, and that gap is what separates a settled bar from the resting gun, because three of the four team colours share a hue with a pool (F56). Rebuilding this as "team colour" alone reintroduces F56. Event bursts flash full and hand back to the DIM rest (`event_burst`, fixed 2026-09-09 — `modes/driver` drops its gauge-revert and trusts that end frame). ⚠ At NIGHT both rest and readout are dim, so the separation does not exist there. the pool readout is TRANSIENT (~4 s), so a dark rest left the gun unlit for nearly all of a match, losing team identity at a glance and reading as a dead gun rather than a quiet one. **Shield is TEAL, not white** — the `shield_up` burst was already teal, so the bar and the burst disagreed about one fact, and white already carries FFA (Q19), carrier and extracted. ⚠ A team rest makes the burst/rest colour-collision path REACHABLE for the first time (a red event on a red team); the existing guard alternates against dark and still ends on the true rest. ⚠ Teal vs green on the body strip has never been bench-checked for distinguishability at a glance | §3 |
| A16.3 | 2026-09-07 | The gun-body pool bar becomes SEVEN levels with a drop animation: `gun.readout.levels` (7 x [solid, blink|null] per pool) + `lead_ms`/`blink_gap_ms`/`step_ms`/`blink_ms`/`min_gap_ms`. Half-steps are a BLINKING top segment, not a dim one — the gun's brightness token is global, measured 2026-09-07 | §3 |
| A16.2 | 2026-09-07 | LEDs part 2: `presentation.lights` groundwork — `night` becomes a DIM/shorten overlay and a separate `blackout` switch is the only thing that empties the light tables (the DOWN signal survives both); the gun body rests DARK with a transient per-pool `readout`; `headset.role` replaces carrier-only; team COLOUR is decoupled from `$TID` (`poolgauge.display_colour`, so team 3 keeps its green wire identity and paints purple); FFA paints white; `$TID` validated to 0-3 (F35) | §3, §4 |
| A16 | 2026-09-07 | LEDs, bench-driven: `$HLED,,6` disables the firmware death flash for the life ⇒ in-play dark is `$HLED,9,0` and effect 6 is teardown-only; `headset.down` ($HLOOP rearm/stop) REPLACES A11.8 `death_flash`; gun-body team colour uses the tid as the palette index (was an offset table); `respawn.delay_s` floored at 3 s (F13) | §3, §4 |
| A11 | 2026-09-04 | PRESENTATION: A11.1 profile, A11.2 bundle `cues`+`leds`, A11.3 node plays its own events, A11.4 HUD-driven events + `alert` + medals, A11.5 event classes + `mc_confidence`, A11.6 headset, A11.7 gun body, A11.8 small flash LED | §3, §4, §5 |
| A12 | 2026-09-04 | SIDEARMS: A12.1 `glock`/`usp`/`deagle` as ordinary weapons with role `sidearm`, A12.2 `SlotRule.kinds` gains `"sidearm"` | §2, §3; `loadout.md` §1.1 |
| A13 | 2026-09-04 | UTILITY: A13.1 `respawn.gate` + `stations[]`, A13.2 `respawn.station`, A13.3 the station/player advert, A13.4 node `state().station`/`respawnGate`/`respawnHint`, A13.5 `station_config` | §3, §4, §5; full text `utility.md` |
| A15 | 2026-09-06 | CHARACTER VOICES: `Player.voice_slots` picks for the six `$PSET` voice fields + the kill line (ids on the gun only); `presentation.events[ev].sound = "voice:<role>"` resolves per player to that character's line (kill, boast, taunt, intro, gas_death, death_scream, hurt_loop, healed, kill_confirm, defeat_taunt, pain, name); `low_health` defaults to the player's own hurt loop. **A15.1** VARIETY: `FrameBundle.cue_pools` (the node rolls one frame per event), MC rolls the un-picked `$PSET` fields from curated pools on every push (`FrameBundle.voice.rolled`). **A15.2** THE SPAWN LINE IS OURS: `$PSET` battleRespawnCry ships empty (firmware silent on `$SPAWN`, bench-verified); the node writes `cues.spawn` / one of `cue_pools.spawn` right after the spawn and revive frames; `respawned` = `voice:spawn` (VAI / VAN / VAO for the Male player). **A15.3** THE PAINS ARE OURS, THE SCREAM STAYS NATIVE: the three `$PSET` pain fields ship empty and the node plays `cues.pain_short` / `pain_long` / `pain_melee` (`cue_pools.*`) on each `$HIR`, chosen by damage (`voice.pain_long_min` = 40) or the melee word, one per 600 ms, none on the lethal hit; `FrameBundle.pset_pool` = one `$PSET` per death-scream take, the node writes one at random before every `$SPAWN` so the firmware's scream changes per life. Voice packs extended to 24 characters (`gameconfig.VOICE_PACKS`; VE = Soldier, VP = clean male). | §2 Player, §3 FrameBundle; `mcp/brx_mcp/voices.py`; `docs/gun-stage.md` §8 |
| A14 | 2026-09-04 | PERK SLOT: A14.1 a perk is its own slot beside a secondary, A14.2 a phone pick knocks the other slot out (`loadout_ack.dropped`), A14.4 `loadout_pool` replaces `secondary_perks`; the ALT-button exception; `loadout_request.slot:"perk"` (no backwards path, FOLLOWUPS S6) | §2, §5; `loadout.md` §2-§5 |

The verbatim amendment texts as ratified are preserved in git history (`git log -- docs/spec/contracts.md`, up to
2026-09-06).
