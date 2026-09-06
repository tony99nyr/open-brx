# Shared contracts (M-CONTRACTS) — the node↔MC wire and the game data model

- **Status:** Ratified (Wave 0, 2026-08-25) + amendments **A1–A14** (index in §10). Since 2026-09-06 the
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
}
```

**`GameConfig.presentation` [A11.1, A11.5, A11.6, A11.7, A11.8]** = `{ preset: standard|silenced|counter_strike|vip|
infection|last_stand|extraction|custom, announcer, gun_flash, headset_team, sight_flash, hud_events, mc_events,
mc_confidence, headset, gun, events: { <event>: { sound?, gun_led?, headset?, flash? } } }`
(`mcp/brx_mcp/mc/presentation.py`). A preset name replaces the profile; any field edit makes it `custom`. `sound`
must be an id physically on the gun (`data/sound_catalog.json`, read off the hardware 2026-09-03); colours are the
shared 9-entry palette. Mode defaults (`MODE_PRESET`): `cs` → `counter_strike`, `infection` → `infection`, `lms` →
`last_stand`, `extraction` → `extraction`; everything else `standard`. Validated in `PUT /api/config` [A8.3].
- `announcer:false` mutes the announcer + objective groups only (the player's own low-health alert and the
  countdown stay); `gun_flash:false` empties `leds`; `headset_team:false` removes the `$HLED` team-colour frames
  from `spawn`/`revive` and blanks `cues.team_led` [A11.2].
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

**Frames are compiled by MC (M-MODES, Python) and shipped to the node as data — nodes never compile
or invent frames [A4.2].** The one frame authority is `compile.py` (over `gameconfig.py`) + its tests; the phone
(JS) and the Companion (C++) are verbatim frame writers.

```jsonc
FrameBundle {                       // per (config_id, player_id); pushed in `config`, re-pushed on assign change
  config_id, player_id,
  head:    string[],   // config head: $VOL → $CLEAR → $START → $GSET → $PSET,<player_num>,… → $WEAP×n → $SIR×n → $BMAP×n → LED frames → $TID,<tid> (last).
                       //   NO $SPAWN, NO countdown/start sound — written at lobby, the gun then sits unspawned (M-START).
                       //   The head write is SILENT on the gun (bench 2026-08-25, protocol §7r): the voice + cock belong to $SPAWN.
  spawn:   string[],   // go-live tail at T-0: $PLAYX,0 → $SPAWN,, → $AMMO per slot → $BMAP,0,0
  revive:  string[],   // respawn re-arm: $SPAWN,, (+ loadout-correct $AMMO)
  end:     string[],   // game-over teardown (END_SEQUENCE)
  panic:   string[],   // ["$CLEAR,*", "$SP,99,*"]
  team_flip?: { [tid: string]: string[] }, // infection: frames to move THIS gun to another team mid-match
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
  gun?: { in_play: "team"|"dark"|"health", blank: string, rest: string,   // A11.7: the gun BODY when the game owns it (default
          after_spawn_s: number, take: string[],                           // team). The node writes `take` (blank, rest) after_spawn_s
          bands?: [fraction_above: number, frame: string][] },             // after every $SPAWN. Absent for "native" (opt-in).
                                                                           // health: the node paints the first band whose
                                                                           // fraction hp/max exceeds, on band change + after bursts.
  headset?: { in_play: "dark"|"team", rest: string, blank: string,        // A11.6: the node's headset sequences, each a
              pregame: string[],                                          // list of [frame, hold_s] ending on an explicit
              start: [string, number][], hit: [string, number][],         // state frame. `rest` = the in-play frame the node
              death: [string, number][], respawn: [string, number][],     // returns to after every flash ("" never; dark or
              carrier: { [tid: string]: [string, number][] } },           // team). death [] = the "native" opt-out. {} when LEDs are off.
  // hurt/hurt_led = the victim-side low-health alert ($PLAY,VA8B + $HLED), fired ONCE PER LIFE
  // when armour reaches 0 and HP starts dropping. Byte-identical to Callsign
  // (protocol/captures/raw/2026-08-23-two-tagger-combat.btsnoop @340.5s, @361.5s).
  // `*_led` cues are $HLED, not $PLAY — every cue is still a complete frame written verbatim.
                       // A6.3: values are PRE-COMPOSED `$PLAY,…,*` FRAMES (slot placement decided by the compiler), e.g.
                       //   countdown: "$PLAY,VA81,4,6,,,,,*", kill: "$PLAY,,4,6,VAA,,,,*". Open map; a missing key is skipped, never guessed.
                       //   A $PLAY needs tokens 2-3 = `4,6` to be audible; the empty-token form is SILENT (bench 2026-08-25), so
                       //   there is no token-1-only SFX form (retracts the A5.10 note).
  swap_ms?: int,                     // 2026-09-04 (additive): the swap delay the gun enforces between slots 0/1 = max $WEAP tok15 after perks (850 stock; quick_switch 425). The HUD's SWITCHING takeover runs for exactly this; older MCs omit it and the node assumes 850 × perk
}
```
- **Volume** is the compiler's: the head carries `$VOL,<compile.play_volume(environment)>` = **80 indoors / 90
  outdoors** (field-corrected 2026-08-30: 69, the old default and iOS Callsign's value, measures as on-gun level
  2 and was inaudible outdoors); **try-outs stay at 69** (`VOL_TRYOUT`, fired at arm's length from the player's own
  head); the diagnostic default `30` is inaudible for game audio and stays a bench value only.
- The node owns exactly **two literal templates** and nothing else: `$SFLASH,*` and `$PLAYX,0,*`
  (`app/src/engine.js:18-19`; [A6.3] — `cues` are pre-composed frames, so there is no `$PLAY` template on the node).
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
address change; a warm socket is never re-discovered. **Do not hard-code or cache an MC IP across sessions.**
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
| `hello` | `{ node_id, node_type:"phone"|"companion"|"utility", app_ver, gun?: {name, tail, fw?}, seq_next, node_key? }` | on connect. `gun.name` = the full **advert name** (`<sticker>-<tail>`); `tail` is parsed from it, **never from the platform deviceId** (iOS gives UUIDs) [A5.5]. `seq_next` = the node's next event seq (so MC can spot a wiped install) [A4.5]. `node_key` = the secret from a prior `welcome` [A8.2] — proves a re-claim of a still-live node_id/gun. `node_type:"utility"` = a station phone, no gun, never bound [A13.5]. |
| `bind` | `{ node_id, player_id?, gun_name, gun_tail }` | node claims/confirms its gun & player. `gun_name`/`gun_tail` come from the advert name [A5.5] |
| `event` | one persisted `Event` (§4) | as they happen (queued if offline) |
| `event_batch` | `{ events: Event[] }` | store-and-forward flush on reconnect |
| `status` | one `status` body (§4) | every `STATUS_HEARTBEAT_MS` while connected; live-only, no seq |
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
| `alert` | `{ kind, text, player_id, t, hud?:boolean, player_id_subject?, carrier?, flag_tid? }` | A11.4: a named game event (`player_id` = the recipient; `player_id_subject` = who turned / the last survivor); node plays its own `cues[kind]`/`leds[kind]` + shows `text` as a HUD alert (`hud:false` = sound/lights only); stale (> `FEEDBACK_MAX_AGE_MS`) → dropped. Scope is MC's: all / one team / one player. `carrier`/`flag_tid` start the flag-carrier headset blink [A11.6]. |
| `control` | `{ cmd, seq?, ... }`, cmd ∈ `end`\|`panic`\|`abort_start`\|`recall` | **one meaning each [A2, A5.9]**: `abort_start`=cancel a *pending* schedule (by `seq`) while ARMED → LOBBY (gun still holds `head`); if the node is already LIVE for that `seq`, it behaves as `recall`. `recall`=stop a *live/armed* game → node writes `frames.end` (+ `cues.game_over`) → **KITTED**; `end`=normal match end → same → KITTED; `panic`=`frames.panic` → KITTED. In KITTED/LOBBY an `end`/`recall` writes `frames.end` iff a bundle is held, then → KITTED. **`pause` is removed** [A4.6]. |
| `apply` | `{ frames: string[], reason?: string, preview?: boolean }` | A6.4: best-effort "write these frames now" — coverage-zone runtime effects only (syphon heal, regen refill, extraction boost). Node writes verbatim, never persists, ignores unless LIVE. **A9.1:** `preview:true` with frames that are ALL `$PLAY`/`$SFLASH` may be written in `connected`/`kitted`/`lobby` too (the tagger speaks a voice sample when the host changes a voice or gamertag). |
| `score` | `ScoreRow` + `{ shots_total, board? }` | A7: MC pushes a player's current row to its node whenever it changes (best-effort, coverage-zone). The HUD shows K/D/A (and ACC only once `hits ≥ 1` and `shots ≥ 10`); still "—" until the first push or `welcome.node.score`. **`board?`** (2026-09-03, additive) = `{ teams: [{ team_id, name, score }], cap }` — the race to the frag cap for the HUD's DOWN-screen recap; in FFA the top three players stand in for teams. |
| `station_config` | `{ kind, team, id, threshold?, game?, valid_ids? }` | A13.5: MC → a **utility** node at muster (and on re-arm). The phone applies it to its advert, marks itself MC-ARMED and locks its on-device config. `game` absent = 0 (any); the authoritative allow-list players enforce stays `config.stations` in the bundle (utility.md §5c). Server side not yet built (utility-roadmap A1). |
| `time_res` | `{ t_node, server_t }` | clock-sync reply |
| `pull_log` | `{}` | request the offered log |
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
- **Constants** (single source `mcp/brx_mcp/mc/types.py:11-27` and `app/src/engine.js:31`; modules reference
  by name, never redefine): `ASSIST_WINDOW_MS = 4000`, `MULTI_KILL_MS = 4000`, `FEEDBACK_MAX_AGE_MS = 3000`,
  `STATUS_HEARTBEAT_MS = 2000`, `STALE_AFTER_MS = 8000`, `SYNC_FRESH_MS = 10000`, `LATE_ARM_GRACE_MS = 8000`,
  `CONFIG_TTL_MS = 1800000`, `MAX_PLAYERS = 63` (wire ids 1–63; 0 reserved), `DEATH_LATCH_MS = 2000`,
  `RESYNC_PROBE_S = 10` (the LOBBY/ARMED observe window), `RECONCILE_MS = 3000` (the LIVE rejoin window, A6.8),
  `DEFAULT_RUNWAY_S = 120` (walk time on a park [A5.10]), `MAX_HP`/`MAX_AR` from GameConfig. All are tunable defaults.

## 10. Amendment index (dates; what; where it now lives)

| id | date | what | folded into |
|---|---|---|---|
| A1 | 2026-08-25 | `ready`, `ack{seq_hi}`, `start.seq`/`countdown_s` + `abort_start`, `status.arm_state`, battery amber-not-red | §5 tables, §4, §1.1 |
| A2 | 2026-08-25 | `assign` split from `config`; `recall` vs `abort_start`; `t_minus_ms`/`synced`; three `seq` namespaces; link state orthogonal | §5, §6, §9 |
| A3 | 2026-08-25 | `status.dropped`, `arm_state:connected`, `log_data`, `assign` re-sent on change, native multikill is NOT free under BLE (host-`$PLAY`, LAN-gated) | §4, §5 |
| A4 | 2026-08-25 | **P2 closed over BLE**: A4.1 exact `shooter_num` (no `approx`), A4.2 frames compiled by MC (`FrameBundle`), A4.3 `match_id` + parking, A4.4 `shot` removed / `status` live-only / `gun_echo`, A4.5 `welcome` re-hydration + `seq_next`, A4.6 lifecycle (superseded by A5.9), A4.7 `t_recv`, A4.8 field reality (`time_limit_s` required), A4.9 node-reported readiness, A4.10 `roster` to nodes, A4.11 mounted + foreground phone, A4.12 module interfaces | §2-§6 throughout |
| A5 | 2026-08-25 | A5.1 wire id 0 reserved, A5.2 roster-based friendly (never in FFA), A5.3 observe-before-write resync, A5.4 readiness cannot deadlock + probe set, A5.5 hydration keyed by the gun, A5.6 `seq`/`match_id` rules, A5.7 batched time base, A5.8 `team_change`, A5.9 everything lands in KITTED, A5.10 `cues.game_over` + `DEFAULT_RUNWAY_S`, A5.11 bookkeeping | §2, §4, §5, §6, §9 |
| A6 | 2026-08-25 | A6.1 end freeze, A6.2 hot-swap shots, A6.3 cues are pre-composed frames (two node templates), A6.4 `apply{frames}`, A6.5 `player_num_base`, A6.6 positive-evidence resync, A6.7 doc fixes, **A6.8 (2026-09-04)** live-rejoin reconcile | §4, §3, §5, §6 |
| A7 | 2026-08-25 | MC→node `score` push | §5 |
| A8 | 2026-08-25 | A8.1 operator auth, A8.2 node re-claim key, A8.3 input hardening | §5b |
| A9 | 2026-08-26 | A9.1 `apply.preview` | §5 `apply` |
| A10 | 2026-08-27 | M-LOADOUT: two slots + perks, `loadout_policy`, `loadout_request`/`browse`/`ack`, ready semantics, saved games (`/api/presets*`) | §2, §5; full text `loadout.md` |
| A11 | 2026-09-04 | PRESENTATION: A11.1 profile, A11.2 bundle `cues`+`leds`, A11.3 node plays its own events, A11.4 HUD-driven events + `alert` + medals, A11.5 event classes + `mc_confidence`, A11.6 headset, A11.7 gun body, A11.8 small flash LED | §3, §4, §5 |
| A12 | 2026-09-04 | SIDEARMS: three pistols; `SlotRule.kinds` gains `"sidearm"` | §2, §3; `loadout.md` §1.1 |
| A13 | 2026-09-04 | UTILITY: A13.1 `respawn.gate` + `stations[]`, A13.2 `respawn.station`, A13.3 the station/player advert, A13.4 node `state().station`/`respawnGate`/`respawnHint`, A13.5 `station_config` | §3, §4, §5; full text `utility.md` |
| A14 | 2026-09-04 | PERK SLOT: a perk is its own slot beside a secondary; the ALT-button exception; `loadout_pool.perks`; `loadout_request.slot:"perk"` (no backwards path, FOLLOWUPS S6) | §2, §5; `loadout.md` §2-§5 |

The verbatim amendment texts as ratified are preserved in git history (`git log -- docs/spec/contracts.md`, up to
2026-09-06).
