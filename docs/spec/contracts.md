# Shared contracts (M-CONTRACTS) — freeze before building anything

- **Status:** Ratified (Wave 0) + amendments **A1–A11**. Changes are **amendments** (§9), not edits.
- **A4/A5 (2026-08-25) are coherence passes** — P2 closed over BLE, frames compiled by MC, `match_id`,
  `status` counters, `welcome` re-hydration, lifecycle fixes. Read §9 A4–A6 first if you knew the pre-A4 shape.
- **A7** adds the MC→node `score` push; **A8** adds operator auth, the node re-claim key and input
  hardening — both §9, both additive except A8's takeover rule.
- **Consumers:** every module. Bind to *these shapes*, never another module's internals.

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
```
- **`ble.address` is not portable across hosts/OS** (mac gives per-device UUIDs). Correlate by
  `sticker`/advert name, never a cached address. (iOS-findings §5.)
- Duplicate `sticker` is illegal (can't map two guns to one name).

## 2. People, teams, loadouts

```jsonc
Player {
  player_id:   string,       // session-stable
  player_num:  number,       // 1–63 — the gun's player id ON THE WIRE ($PSET token 1 / $HIR token 3, protocol §7p/§7q).
                             // Unique per match; MC assigns at kit-out. Displayed AS-IS (#1…#63). Wire 0 is RESERVED =
                             // "no identity" (tutorial arms, unknown/environmental shooter) and is never a player (A5.1).
  display:     string,       // vanity name the host types at kit-out (never written to the gun)
  team_id:     string | null,
  node_id:     string | null,// the node currently bound to this player (§5)
  gun_id:      string | null,// assigned gun (ArmoryRecord.gun_id)
  loadout:     Loadout,
  voice:       "male" | "female" | string,  // sound-bank voice set
  ready:       boolean
}

Team { team_id: string, name: string, color: "blue"|"yellow"|"red"|"green"|string, tid: number } // tid → $TID (LED colour + friendly-fire class)

Loadout {
  weapons: WeaponSel[],      // ordered; index maps to the gun's weapon slots: [primary] or [primary, secondary]. NEVER empty —
                             // a primary is required; an EMPTY slot 1 is legal (no $WEAP,1 / $AMMO,1; ALT falls back to reload) (A10)
  perk?: string | null,      // A10: perk_id in slot 2 INSTEAD of a secondary weapon — mutually exclusive with weapons[1] (loadout.md §2)
  // per-player tunables the mode allows (health/armor caps come from the mode, not here, unless overridden)
  overrides?: { max_hp?: number, max_armor?: number }
}
WeaponSel { weapon_id: string }   // references WeaponCatalog (M-MODES)

RosterEntry { player_id, player_num, display, team_id }   // what nodes get so the HUD can name a killer
```
- **≤ 63 players per match** (6-bit id, 0 reserved). `player_num` is *session* state, not armory state — the same gun
  gets a different number next game.
- **FFA** = one team (`tid`), friendly-fire ON, distinct `player_num`s. `$TID` is *only* team/LED; it is
  never used as a per-player identity (A4 retires the ≤4-player unique-`$TID` workaround).

## 3. Game config, frames, modes (authoring output of M-MODES)

`GameConfig` is the **complete, serializable description** of a match — the single object MC authors,
validates, and pushes. It MUST round-trip (author → JSON → frames) with no hidden state.

```jsonc
GameConfig {
  config_id:   string,
  mode:        "tdm" | "ffa" | "infection" | "lms" | "extraction" | string,
  environment: "indoor" | "outdoor",
  night:       boolean,               // drives LED/HUD blackout choices
  time_limit_s: number,               // REQUIRED and > 0 on the phone path (A4.8): the only end condition
                                      // that reaches a dispersed node. (null allowed only when validate()
                                      // is told the venue is fully LAN-covered.)
  respawn:     { type: "auto"|"scanner"|"none", delay_s: number, gate?: "trigger"|"presence" },   // gate: A13 (scanner only)
  stations?:   [ { id: number, kind: "respawn"|"powerup"|"extraction"|"bomb"|"control" } ],          // A13: the utility items valid in this game
  scoring:     { frag_limit: number|null, win_by: "kills"|"survival"|"objective"|string }, // frag_limit / survival ends are LAN-covered-only (A4.8)
  health:      { max_hp: number, max_armor: number },   // mode defaults; Loadout may override
  // No `max_shield`, deliberately: the shield pool is NOT BLE-writable. It is granted only by an IR
  // $SIR function-11 event (P16, closed 2026-08-26). Damage drains shields -> armor -> HP.
  teams:       Team[],
  led?:        object,                // indoor/outdoor/night LED customization (M-MODES defines shape)
  player_num_base?: number,           // A6.5: first player_num this session hands out (default 1). Two concurrent games on one
                                      // field use disjoint ranges (e.g. 1 and 32) — $HIR carries no match id.
}
```

**Frames are compiled by MC (M-MODES, Python) and shipped to the node as data — nodes never compile
or invent frames (A4.2).** The one frame authority is `gameconfig.py` + its sim/tests; the phone (JS)
and the Companion (C++) are verbatim frame writers.

```jsonc
FrameBundle {                       // per (config_id, player_id); pushed in `config`, re-pushed on assign change
  config_id, player_id,
  head:    string[],   // config head: $VOL,<80 indoor|90 outdoor> → $CLEAR → $START → $GSET → $PSET,<player_num>,… → $WEAP×n → $SIR×n → $BMAP×n → LED frames → $TID,<tid> (last).
                       //   NO $SPAWN, NO countdown/start sound — written at lobby, the gun then sits unspawned (M-START).
                       //   Whether `$START` itself is audible at the lobby write is UNVERIFIED (checklist NEXT #11).
  spawn:   string[],   // go-live tail at T-0: $PLAYX,0 → $SPAWN,, → $AMMO per slot → $BMAP,0,0
  revive:  string[],   // respawn re-arm: $SPAWN,, (+ loadout-correct $AMMO)
  end:     string[],   // game-over teardown (END_SEQUENCE)
  panic:   string[],   // ["$CLEAR,*", "$SP,99,*"]
  team_flip?: { [tid: string]: string[] }, // infection: frames to move THIS gun to another team mid-match
  cues: { countdown: string, kill: string, game_over?, victory?, tick?, klaxon?, multi?, medal?,
          hurt?, hurt_led?, runway_30?, runway_20?, runway_10?, team_led?,
          // A11: one key per presentation EVENT that carries a sound — the medal kinds (first_blood, double_kill,
          // triple_kill, killtacular, killing_spree, unstoppable), match state (lead_taken, lead_lost,
          // next_kill_wins, last_survivor, infected, survivors_win, victory, game_over), objectives
          // (objective_taken, objective_scored, flag_returned, point_captured, hill_captured, bomb_planted,
          // bomb_defused, bomb_detonated, vip_hit, vip_down), the player's own (hit_taken, died, respawned,
          // healed, armour_up, shield_up, low_health), the clock (time_60, time_30, time_10) and the extraction
          // ladder (extraction_called/open/alert/closing/complete/failed/tick, loot_picked, loot_dropped,
          // raid_ending, raid_over) — the full list is `presentation.EVENTS`. "" = deliberately MUTE
          // (announcer off): the node skips the sound but still flashes.
          [k: string]?: string },
  leds?: { [event: string]: [frame: string, hold_s: number][] },   // A11: the tuned $GLED burst (3 flashes back to
                       // the team colour; hardware-tuned 2026-09-03) + optional static $HLED, per event. Written
                       // verbatim with the holds; the node never repaints inside a burst and never plays two
                       // bursts inside one second. A static $HLED step is skipped while the player is DOWN (the
                       // out-blink owns the headset) and yields to any later headset sequence (hit flash, death).
                       // Absent/empty = no lights for that event (night, blackout, or
                       // the profile's gun_flash=false).
  presentation?: { preset, announcer, gun_flash, headset_team, sight_flash, hud_events, mc_events, mc_confidence,
                   custom_events, headset: { pregame, start_flash, in_play, hit, death, respawn_flash, carrier } },   // A11/A11.5/A11.6 summary
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
  swap_ms?: int,                     // 2026-09-04 (additive): the swap delay the gun enforces between slots 0/1 = max $WEAP tok15 after perks (850 stock; quick_switch 425). The HUD's SWITCHING takeover runs for exactly this; older MCs omit it and the node assumes 850 × perk
}
```
- The node owns exactly **two literal templates** and nothing else: `$SFLASH,*` and `$PLAYX,0,*` (A6.3 — `cues` are
  frames, so no `$PLAY` template on the node). Everything else is written verbatim from the bundle. **Plus one pre-config probe set** (A5.4), allowed **only in CONNECTED/KITTED** (never
  after a head is written): `$PHONE,*` (starts `$VOLTS` telemetry) and the `$STOP,*`→`$PHONE,*`→`$VERSION,*` ritual (firmware).
- `tutorial` carries its own `frames: string[]` (M-MODES `tutorialFrames(weapon, environment)`).

`WeaponCatalog` (static data owned by M-MODES; see `reference/callsign-ui.md`):
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
  // when the host changes `health` (§2.5). dmg_hit is the real t5 magnitude; cycle_ms is the mean ms
  // between landed hits (burst-aware: (2*t14 + t23)/3 on a 3-round burst); `charged` weapons pay for
  // their FIRST shot, so their ttk is htk cycles, not htk-1. A row WITHOUT them (a synthetic/demo
  // catalog) scales its published `htk` by the pool ratio — honest arithmetic, htk being
  // proportional to the pool, though ±1 hit from the published rounding — and withholds `ttk_ms`
  // entirely at any non-default pool rather than publish a figure it cannot derive.
  weap_frame: string,   // the $WEAP,... template (token positions per callsign-extract)
  icon?: string,
  tags: string[], role: string   // A10: policy vocabulary ("heavy", "sniper", + the role) — presets exclude by tag (loadout.md §1.1)
}
PerkView { perk_id, name, desc, tags, mechanism: "passive"|"slot_frame", effects: {...}, verified, hidden }   // A10, loadout.md §1.2
```

## 4. The event model (the heart of scoring)

Nodes emit **facts they can observe**; MC derives **cross-player truth**. Never invent a fact a node
can't see. The gun is host-blind about its own kills — but **every hit it *takes* names the shooter**:
`$HIR` token 3 = shooter `player_num`, token 4 = shooter team (protocol §7q, hardware-verified both
directions 2026-08-25). So attribution is **exact, victim-side, BLE-native** — no IR receiver, no heuristic.

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
 | { type:"respawn",     t, match_id, node_id, player_id, resync? }                                    // resync?: true when forced by the BLE resync policy (node.md §3.10)
 | { type:"team_change", t, match_id, node_id, player_id, tid }                                        // infection: this gun moved to `tid` (A5.8)
 | { type:"status",      t, match_id?, node_id, player_id?, hp, armor, ammo, alive, shots, deadline_s?, battery?, fw?,
                         arm_state, t_minus_ms?, synced, dropped?, preflight? }
```
- `shooter_num`/`shooter_team` are **always present** (from `$HIR` tokens 3/4). MC maps `shooter_num →
  player_id` via the match roster. `shooter_num = 0` means **unknown / environmental** (no `$HIR` fresher than
  `DEATH_LATCH_MS` before the `$HP,0`, a tutorial-armed gun, a desync); a number not in the roster (another
  game's gun) is recorded and **not** credited. Grenade/station beacons (`$HIR` token 2 = 15) never enter the latch.
- **`status` is live-only (A4.4):** sent every `STATUS_HEARTBEAT_MS` while connected, **never queued or
  persisted** — it is a heartbeat + counters, not a fact to replay. `shots` = cumulative shots fired this
  match (from `$ALCD` decrements; reloads/pickups increase ammo and are ignored). `preflight` (A4.9) =
  `{ ssid_ok, mc_reachable, auto_join_ok, cellular_off, dnd_on, phone_batt, screen_on, foreground, gun_linked, headset_ok }`.
  `headset_ok`/`screen_on`/`foreground` are **amber before the config push, never red at muster** (A5.4): the only
  hardware-proven headset detector is the `$LCD,45,70,…` echo on **`$SPAWN`**; whether an unspawned head echoes with
  the headset off is UNVERIFIED. `fw` = `$VERSION` result from the pre-config probe set (§3).
  `arm_state ∈ idle|connected|kitted|lobby|armed|live`; `t_minus_ms` only while ARMED; `synced` = clock-sync
  fresh (§7); `dropped` = events shed by ring overflow since last status.
- `hit_taken`/`death`/`respawn` are **persisted facts**, idempotent by `(node_id, seq)` (§5 envelope).
- **`match_id` on every fact (A4.3)** — minted by MC in `start`; a node stamps it on everything after
  `startAt()`. MC **parks** (does not score) events whose `match_id` isn't the current match — a phone that
  flushes match-1 deaths during match 2 must not pollute match 2. Parked events still reach that match's recap.
- There is **no per-bullet `shot` event** (A4.4) — shots ride the `status` counter. Accuracy needs no
  per-shot timing.

**MC-derived facts** (computed, never sent by nodes):
```jsonc
Kill   { t, match_id, victim: player_id, killer: player_id, team: team_id, multi?: number, friendly?: boolean }
Assist { t, match_id, victim: player_id, assister: player_id, dmg }
ScoreRow { player_id, display, team_id, kills, deaths, assists, shots, hits, accuracy, kd, streak, medals[] }
```
- **Kill attribution (exact):** `death.shooter_num → killer` via the roster; `shooter_num = 0` → no killer
  (death only). **Team-kill (`friendly:true`)** ⇔ killer and victim share a non-null roster `team_id` **and**
  `config.mode != "ffa"` — FFA is one `$TID` for everyone, so `$TID` equality must never define friendly (A5.2).
  A team-kill counts as a death and scores −1 for the killer (mode may override). Infection re-evaluates team
  membership from `team_change` facts. There is **no `approx` attribution** and no `ATTRIB_FUSE_MS` (A4.1).
- **Assist:** any *other* player whose `hit_taken` dmg on the victim lies within `ASSIST_WINDOW_MS`
  before the death. Player-level, always.
- **Accuracy** = `hits / shots`: `hits` = count of victims' `hit_taken` with `shooter_num == me` on a
  **non-friendly** target (A5.2), `shots` = the shooter's latest `status.shots`. If a node's last `status` is
  older than the match (phone died), accuracy is "—", not 0. MC number; nodes show "— MC" until told.
- **Winner:** `mode == "ffa"` → top `ScoreRow`; team modes → team kills (or `win_by`).
- **Time base (A4.7, A5.7):** MC records `t_recv` on every inbound envelope. Cross-node windows (assist,
  multi-kill, first blood) use the node's synced `t` when the node was synced at lobby (`status.synced` true at
  its last pre-start heartbeat — drift ≪1 s over a match). For a **never-synced** node: live `event`s use
  `t_recv`; an `event_batch` is re-based once per flush (`offset = t_recv − t_newest`, applied to the whole batch,
  order preserved) and **window awards (multi-kill, first blood) are suppressed** for facts from such nodes.
- **Feedback freshness (A4.3):** MC sends `feedback{kill}` only when `now − death.t ≤ FEEDBACK_MAX_AGE_MS`;
  a late-flushed kill scores but never flashes a sight minutes later.
- **End freeze (A6.1):** MC records `end_t` when it broadcasts `control{end}` (frag-limit / survival / objective /
  host end) or, for the timed end, `end_t = go_live_t + time_limit_s·1000`. Facts whose effective `t` is `> end_t`
  are **recorded but not scored** (`parked_reason: "post_end"`) — the announced winner never mutates as out-of-range
  nodes flush kills they scored after the in-coverage end. Recap shows the count.
- **Hot-swap shots (A6.2):** `status.shots` is per node-session; MC keeps `shots_total = baseline + status.shots`,
  re-basing when a new `node_id` binds the player. Accuracy uses `shots_total`; `welcome.node.score.shots_total`
  seeds the swapped phone's display.
- **Recap is provisional until every rostered node has flushed** (kills exist only in victims' reports): the
  recap shows "N victims missing — kills provisional" and export is marked provisional until finalized.

**Readiness (MC-assembled, A4.9/A5.4)** — the board shape M-MC builds from `status.preflight` + `ack_config` + M-ARMORY `scan()`:
```jsonc
ReadinessRow { gun_id?, sticker, tail, player_id?, player_num?, present, identity: "ok"|"unconfirmed"|"reverted"|"unknown"|"manual",
               node: "none"|"linked", headset: "proven"|"unknown"|"absent", battery_pct?, battery_age_ms?, fw?, phone_batt?,
               ssid_ok?, mc_reachable?, synced?, screen_on?, foreground?, status: "green"|"amber"|"red", blockers: string[] }
ReadinessSnapshot { t, roster_size, greens, board: ReadinessRow[], unclaimed: ScanRow[], go: boolean }
```
Red (blocks the config push): no node, identity reverted/unknown, never synced, wrong SSID / MC unreachable.
Amber (shown): headset unknown, battery unsampled, phone battery low, screen/foreground off, fw unknown.
After the push: an empty `ack_config.gun_echo` is **red** (headset absent / gun asleep) and blocks `start`.

## 5. Node ↔ MC protocol (M-NET)

**Transport:** WebSocket over the field LAN. **Discovery:** MC advertises `_openbrx._tcp` via mDNS/
Bonjour; nodes resolve it, **or scan MC's QR** (`ws://ip:port`), or type it. Node opens one WS to MC and
keeps it warm; all messages are JSON envelopes.

```jsonc
Envelope { v:1, kind:string, id:string, seq?:number, t:number, body:object }
```
`seq` is a per-node monotonic counter on **persisted** `Event` messages (`hit_taken`/`death`/`respawn`)
for idempotent replay. `status` carries no `seq`.

**Node → MC** (`kind`):
| kind | body | when |
|---|---|---|
| `hello` | `{ node_id, node_type:"phone"|"companion", app_ver, gun?: {name, tail, fw?}, seq_next, node_key? }` | on connect. `gun.name` = the full **advert name** (`<sticker>-<tail>`); `tail` is parsed from it, **never from the platform deviceId** (iOS gives UUIDs, A5.5). `seq_next` = the node's next event seq (so MC can spot a wiped install). `node_key` = the secret from a prior `welcome` (A8) — proves a re-claim of a still-live node_id/gun. |
| `bind` | `{ node_id, player_id?, gun_name, gun_tail }` | node claims/confirms its gun & player. `gun_name`/`gun_tail` come from the advert name (A5.5) |
| `event` | one persisted `Event` (§4) | as they happen (queued if offline) |
| `event_batch` | `{ events: Event[] }` | store-and-forward flush on reconnect |
| `status` | one `status` body (§4) | every `STATUS_HEARTBEAT_MS` while connected; live-only, no seq |
| `ack_config` | `{ config_id, ok:boolean, err?, gun_echo?: string }` | after writing `FrameBundle.head`; `gun_echo` = the `$LCD`/`$ALCD` line the gun answered with — proof the gun **answered the head** (it reads `$LCD,0,0,0,0,0,0`). Whether a headset-less gun stays silent here is **UNVERIFIED** (checklist NEXT #10); the proven headset detector is the `$LCD,45,70` echo on `$SPAWN` |
| `time_req` | `{ t_node }` | clock-sync ping (§7) |
| `log_offer` | `{ node_id, bytes, lines }` | node has a diagnostic log MC can pull |
| `log_data` | `{ node_id, seq, chunk, last:boolean }` | the log itself, chunked (≤ 48 KB/chunk), in reply to `pull_log` |
| `ready` | `{ node_id, player_id, ready:boolean }` | ready-up toggle in **KITTED** (phase 4); **all-ready gates the `config` push** |
| `loadout_request` | `{ node_id, player_id, slot:"primary"\|"secondary", kind:"weapon"\|"perk"\|"none", id?, try?:boolean }` | A10: phone self-serve pick (loadout.md §4.2). MC validates vs `loadout_policy`, applies, re-sends `assign`, optionally starts the try-out, and ALWAYS answers `loadout_ack` |
| `loadout_browse` | `{ node_id, player_id, open:boolean }` | A10: HUD opened/closed its loadout browser → MC roster shows "PICKING…" (60 s server expiry) |

**MC → Node** (`kind`):
| kind | body | when |
|---|---|---|
| `welcome` | `{ session_id, server_t, seq_hi, node_key, node?: { player, team, roster, config, frames, start?, match_id?, score? } }` | reply to hello. **Full re-hydration (A4.5, A5.5): MC resolves the context by `hello.gun` (sticker/tail → the player bound to that gun) first, then by `node_id`** — so a hot-swapped phone with a brand-new `node_id` is hydrated on its first `hello`, before `bind`. `score?` = that player's current `ScoreRow` (so a swapped phone's D/K/A start right). `seq_hi` = highest event seq MC has from this `node_id`; node sets `next_seq = max(own, seq_hi+1)`. |
| `assign` | `{ player: Player, team: Team, roster: RosterEntry[], catalog: { weapons: WeaponView[], perks: PerkView[] }, policy: { hud_select, primary: { choice, allowed_ids }, secondary: { choice, kinds, allowed_weapon_ids, allowed_perk_ids } } }` | kit-out: set player+team → **KITTED**. Carries **no config**. **Re-sent on any change to the player** (loadout, name, team, player_num); the node's latest `player` is authoritative. **A10:** `catalog` + this player's slot rights ride along (also in `welcome.node`) so the phone can browse/pick with no rule logic of its own (loadout.md §4.1). |
| `loadout_ack` | `{ slot, ok:boolean, reason?: string, loadout: Loadout }` | A10: reply to every `loadout_request`; `reason` is human copy the HUD shows verbatim. `ok:true` + `reason` = the pick applied but the try-out could not arm (lobby already pushed). |
| `tutorial` | `{ weapon: Weapon, frames: string[] }` | silent try-out arming (phase 3a; requires KITTED). Frames compiled by MC. |
| `config` | `{ config: GameConfig, frames: FrameBundle, roster: RosterEntry[] }` | pushed on **all-ready** (phase 4) → node writes `frames.head` (no `$SPAWN`), replies `ack_config` → **LOBBY**. Re-pushed (new `frames`) if a player's loadout/num changes after the push. |
| `start` | `{ match_id, go_live_t, config_id, seq, countdown_s }` | schedule the dispersed start (§M-START). MC mints `match_id` and stamps a **monotonic `seq` per session**. **Rules (A5.6):** re-push of the *same* schedule (straggler, grace re-arm) = **same `seq` + same `match_id`** (no-op on a node that holds it); a **reschedule** = **new `seq` + new `match_id`** (supersedes). A late-joining player mid-match: `assign` → `config` → the same `start` re-pushed → hot-join (M-START E5). |
| `feedback` | `{ player_id, kind:"kill"|"victory"|(legacy "multi"|"medal"), t, cue?:string, medals?:string[] }` | MC scored you a kill → node `$SFLASH` + `$PLAY` (`cue` if present, else `frames.cues[kind]`; missing → flash only). `t` = the death time; node ignores it if older than `FEEDBACK_MAX_AGE_MS` (A4.3) |
| `alert` | `{ kind, text, player_id, t, hud?:boolean, player_id_subject?, carrier?, flag_tid? }` | A11.4: a named game event (`player_id` = the recipient; `player_id_subject` = who turned / the last survivor); node plays its own `cues[kind]`/`leds[kind]` + shows `text` as a HUD alert; stale (> `FEEDBACK_MAX_AGE_MS`) → dropped |
| `control` | `{ cmd, seq?, ... }`, cmd ∈ `end`\|`panic`\|`abort_start`\|`recall` | **one meaning each (A5.9)**: `abort_start`=cancel a *pending* schedule (by `seq`) while ARMED → LOBBY (gun still holds `head`); if the node is already LIVE for that `seq`, it behaves as `recall`. `recall`=stop a *live/armed* game → node writes `frames.end` (+ `cues.game_over`) → **KITTED**; `end`=normal match end → same → KITTED; `panic`=`frames.panic` → KITTED. In KITTED/LOBBY an `end`/`recall` writes `frames.end` iff a bundle is held, then → KITTED. **`pause` is removed** (A4.6). |
| `apply` | `{ frames: string[], reason?: string }` | A6.4: best-effort "write these frames now" — coverage-zone runtime effects only (syphon heal, regen refill, extraction boost). Node writes verbatim, never persists, ignores if not LIVE. |
| `score` | `ScoreRow` + `{ shots_total, board? }` | A7: MC pushes a player's current row to its node whenever it changes (best-effort, coverage-zone). The HUD shows K/D/A (and ACC only once `hits ≥ 1` and `shots ≥ 10` — accuracy is hits-from-victims over own shots, so it reads 0% for anyone whose victims had no phone in range); still "—" until the first push or `welcome.node.score`. **`board?`** (2026-09-03, additive) = `{ teams: [{ team_id, name, score }], cap }` — the race to the frag cap for the HUD's DOWN-screen recap; in FFA the top three players stand in for teams. Older MCs omit it and the HUD shows its local `CAP` only. |
| `time_res` | `{ t_node, server_t }` | clock-sync reply |
| `pull_log` | `{}` | request the offered log |
| `ack` | `{ seq_hi }` | MC has durably ingested this node's events up to `seq_hi` (store-and-forward ring-prune signal) |

**Store-and-forward semantics (mandatory):**
- A node **runs its own gun with the WS down.** Persisted events queue locally (bounded ring, persisted)
  and flush as `event_batch` on reconnect. MC dedups by `(node_id, seq)`.
- `feedback`/`start`/`control` are **best-effort**; the node's own loop never depends on receiving them
  (start uses the pre-shared `go_live_t`; end uses `go_live_t + time_limit_s`, §7).
- MC→node context (`assign`/`config`/`start`) is **not queued in the outbox ring** but **is persisted by the
  node** as its current context (node.md §3.7); `welcome` re-hydrates it anyway.
- MC treats missing nodes as **stale, not gone** — the scoreboard shows last-known + a staleness age.
- **Field reality (A4.8):** on a large field most nodes are out of LAN range for most of the match. Design
  the *common* case as: config + start + sync happen at the lobby; kills/hits/assists/K-D reconcile at
  **sync points** (a base or respawn station inside router range, or recap); live kill-confirm and a live
  individual board are **coverage-zone features**. Nothing about the match outcome depends on coverage.

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
      panicked match returns to KITTED** (A5.9) — the player is still kitted; a rematch is a new `config` push → LOBBY.
Link state (WS up/down) is orthogonal to all of the above; BLE link state is orthogonal too, with the
      observe-before-write resync rule in M-NODE §3.10 (A5.3).
```

## 7. Clock sync (drives the dispersed start and the dispersed end)

Nodes and MC agree on time so a pre-shared `go_live_t` fires together without a T-0 signal, and
`go_live_t + time_limit_s` ends the match without an end signal.
- On connect and periodically, node sends `time_req{t_node}`; MC replies `time_res{t_node, server_t}`.
  Node computes `offset = server_t - (t_node + rtt/2)` (NTP-lite) and keeps a smoothed offset.
- **synced_now() = local_now() + offset.** All `go_live_t`, expiry, respawn and event-`t` math uses synced time.
- Phone clocks drift <<1 s over a match; re-sync at lobby is enough. A node that never synced falls back
  to counting `now + duration` from the moment it *received* `start` (degraded, logged, `status.synced=false`).
- MC stamps `t_recv` on every envelope and uses it for cross-node windows from unsynced nodes (§4).

## 8. BRX frame contract (what a node writes to the gun)

Nodes write **`FrameBundle` frames verbatim** (§3) plus the three literal templates (`$PLAY` two-slot,
`$SFLASH,*`, `$PLAYX,0,*`). All frames are compiled by M-MODES in MC from the known-safe set
(`protocol.py`). Canonical references (do not restate — link): arm/spawn/respawn, `$WEAP`/`$GSET`/`$PSET`,
player id (`$PSET` token 1 / `$HIR` token 3, §7p/§7q), feedback (`$SFLASH` + token-4 `$PLAY`), battery
`$VOLTS`, hit `$HIR`, health `$HP`/`$LCD`/`$ALCD` — all in `protocol/brx-protocol.md` +
`protocol/callsign-extract/`. **Panic:** `$CLEAR,*` then `$SP,99,*`. Volume **69** for real games (30 is
inaudible). BLE writes chunk at 20 bytes (§app).

## 9. Versioning & amendments

- `Envelope.v` gates protocol compatibility; `app_ver`/`server_ver` are informational.
- **Three distinct `seq` namespaces** (do not conflate): `Envelope.seq` = per-node persisted-event counter
  (dedup); `start.seq` = MC's per-session schedule counter; `control.seq` = a reference *to* a `start.seq`
  (which schedule an `abort_start` targets). Different counters, different owners.
- **Identity tokens:** `config_id` = identity of a pushed `GameConfig` (+ its `FrameBundle`); `match_id` =
  one scheduled play of a config (minted in `start`). The same `config_id` can be played twice; `match_id`
  never repeats. A node keys "is my stored config current" on `config_id` and "which match are my events
  for" on `match_id`. Optional `CONFIG_TTL_MS` bounds how long a stored config is trusted without a refresh.
- Post-freeze changes: add an **Amendment** entry here (date, what, why, migration) and bump `v` only for
  wire-breaking changes once a consumer is deployed. Additive fields are non-breaking; consumers ignore
  unknown fields.
- **Constants** (single source — modules reference by name, never redefine): `ASSIST_WINDOW_MS = 4000`,
  `MULTI_KILL_MS = 4000`, `FEEDBACK_MAX_AGE_MS = 3000`, `STATUS_HEARTBEAT_MS = 2000`,
  `STALE_AFTER_MS = 8000`, `SYNC_FRESH_MS = 10000` (clock-sync considered fresh; gates ready-up in
  M-START), `LATE_ARM_GRACE_MS = 8000` (window a late/hot-joined node may still self-arm after
  `go_live_t`), `CONFIG_TTL_MS = 1800000` (how long a stored `config_id` is trusted without refresh),
  `MAX_PLAYERS = 63` (wire ids 1–63; 0 reserved), `DEATH_LATCH_MS = 2000` (a `$HIR` older than this at `$HP,0` → `shooter_num` 0),
  `RESYNC_PROBE_S = 10` (observe window after a BLE reconnect before the node re-writes, node.md §3.10),
  `DEFAULT_RUNWAY_S = 120` (walk time on a park), `MAX_HP`/`MAX_AR` from GameConfig. All are tunable defaults.

### Amendments
- **A1 (2026-08-25, additive, non-breaking, no `v` bump):** module drafts surfaced four missing
  shapes, all additive (unknown fields are ignored by older consumers):
  - Node→MC **`ready`** — lobby ready-up toggle (was implied by phase 4, unspecified). *(M-MC)*
  - MC→Node **`ack {seq_hi}`** — lets a node prune its store-and-forward ring once MC has durably
    ingested events, instead of holding them forever. *(M-NET)*
  - **`start`** gains **`seq`** + **`countdown_s`**, and **`control`** gains **`abort_start`** — a
    scheduled dispersed start must be reschedulable/abortable, keyed by `seq`. *(M-START)*
  - **`status`** event gains **`arm_state`** (`idle|kitted|lobby|armed|live`) so MC's board can show
    per-node lifecycle (contracts §6) without inferring it. *(M-START/M-MC)*
  - Policy: readiness battery is **amber, not red**, on a missed `$VOLTS` — a missing reading is not a
    flat pack. *(M-ARMORY)*
- **A2 (2026-08-25, review polish-loop, additive/clarifying):**
  - **Split `assign` (kit-out, no config → KITTED) from a new `config` message (lobby push → LOBBY)** so
    phase-3 kit-out and phase-4 config-push don't collide and the phase-3a tutorial has a legal KITTED
    precondition. *(consistency review, Critical)*
  - **`recall` vs `abort_start` disambiguated** (control table): `abort_start`=cancel a pending schedule,
    `recall`=stop a live game. *(consistency/completeness)*
  - `status` gains **`t_minus_ms`**/**`synced`**; `start.seq` clarified **MC-stamped**; link state declared
    **orthogonal** to game phase; three `seq` namespaces named; `config_id` = staleness key. *(all reviews)*
  - Attribution note: individual `shooter_id` may also come from a **native per-player `$TID`** (§7k),
    not IR-decode alone. *(feasibility)*
- **A3 (2026-08-25, iteration-2 verification, additive/clarifying):**
  - `status` gains **`dropped`** (ring-overflow counter) and `arm_state` gains **`connected`** (CONNECTED
    was un-expressible). *(consistency)*
  - New Node→MC **`log_data`** kind (chunked) so `pull_log` has an actual transfer, not just `log_offer`.
  - **`assign` is re-sent on any player/loadout change** and is the sole carrier of the committed
    `Player.loadout`; the node arms from its latest `player` + the `config` (closes the post-split loadout
    gap). *(consistency)*
  - `shooter_id`-via-native-`$TID` narrowed to **≤4-player FFA, never with teams** (`$TID` = the LED/team
    colour). *(feasibility)*
  - Constants **`SYNC_FRESH_MS`/`LATE_ARM_GRACE_MS`/`CONFIG_TTL_MS`** promoted here (were only in M-START).
  - **Native multikill is NOT free** — it is nRF-peer, invisible to BLE, and silent under our BLE config
    (ADR-0001 #4, exp-log 2026-08-24/25); `feedback.multi` is host-`$PLAY`-driven and **LAN-gated like all
    feedback**, not native. *(feasibility, Critical — was overstated in modes §5b)*
  - `recall` also stops an **ARMED** game (not only LIVE); `net.md` interfaces must surface the non-Event
    Node→MC messages (`ready`/`ack_config`/`log_offer`/`log_data`) and `bind.gun_tail`. *(consistency)*
- **A4 (2026-08-25, P2 closure + field-reliability review; pre-deployment so `v` stays 1 — but NOT
  purely additive: `shot` and `pause` are removed, `shooter_id?` becomes mandatory `shooter_num`):**
  - **A4.1 Identity is BLE-native.** `Player.player_num` (0–63; narrowed to 1–63 by A5.1) is written as `$PSET` token 1 and read back
    as `$HIR` token 3 on every hit (protocol §7p/§7q, bench-verified both directions). `hit_taken`/`death`
    carry mandatory `shooter_num` + `shooter_team`; attribution is exact; **`approx` attribution and
    `ATTRIB_FUSE_MS` are deleted**; FFA = one `$TID` + FF on + distinct `player_num`s; the unique-`$TID`
    workaround (A3) is retired. IR-decode on a Companion is no longer a prerequisite for anything.
  - **A4.2 Frames compiled by MC, shipped as `FrameBundle`.** M-MODES (`gameconfig.py`, Python) cannot run
    on a phone or an ESP32; the node was specified to call `armFrames()`. Now `config` carries the compiled
    per-player bundle (`head`/`spawn`/`revive`/`end`/`panic`/`team_flip`/`cues`) and `tutorial` carries its
    frames. Nodes own three literal templates only. `$PSET` is per-player (it holds `player_num`), so the
    "setup is team-invariant" assumption is gone — the bundle is per player.
  - **A4.3 `match_id`** minted in `start`, stamped on every persisted event; MC parks foreign-match events;
    `feedback` only for kills fresher than `FEEDBACK_MAX_AGE_MS`.
  - **A4.4 Event cleanup.** `shot` event removed → `status.shots` counter; `status` is live-only (no seq,
    never persisted/queued); `ack_config` gains `gun_echo` (the spawn/config echo = headset + config proof).
  - **A4.5 `welcome` re-hydrates the whole node context** (player, team, roster, config, frames, pending
    start, match_id) and returns `seq_hi`; `hello` sends `seq_next`. A reinstalled node cannot silently have
    its events dropped by the dedup high-water mark.
  - **A4.6 Lifecycle fixes.** `end`/`recall`/`panic`/time-expiry → CONNECTED (IDLE = no gun); `abort_start`
    after a T-0 panic → KITTED. **Superseded by A5.9** (everything lands in KITTED; no panic on abort). `pause` removed.
  - **A4.7 Time base.** MC stamps `t_recv`; cross-node windows use `t_recv` for unsynced nodes.
  - **A4.8 Field reality.** Large-park play: most nodes are out of LAN range most of the match.
    `time_limit_s` is REQUIRED on the phone path (the only end condition that reaches a dispersed node);
    frag-limit / survival / objective ends and live kill-confirm are LAN-coverage-zone features. Stated in §5.
  - **A4.9 Node preflight** rides `status.preflight` (SSID, MC reachable, phone battery, screen/foreground,
    gun link, headset) — readiness is **node-reported**; M-ARMORY's BLE muster becomes scan-only presence
    for guns with no node (armory.md A4). Removes the N-persistent-links-from-one-Mac build item.
  - **A4.10 `roster`** (player_num → display/team) goes to nodes in `assign`/`config`/`welcome` so the HUD
    can show "☠ by REAPER" and the node can stamp `shooter_num` meaningfully in its own log.
  - **A4.11 Node-side hard requirements** (node.md): phone **mounted** on the gun/forearm; app **foreground,
    screen on** during ARMED/LIVE (JS timers suspend otherwise) with a resume→reconcile path; BLE
    **resync-after-drop** policy; platform network gates (ATS/Local-Network/cleartext/bind-to-Wi-Fi/
    auto-rejoin) in `net.md` §8.
  - **A4.12 Module-interface additions ratified with A4** (live in each module's Interface section):
    `Transport.connect()` resolves to the `welcome` hydration (net.md §6); `NetServer.hydrate()`/`joinInfo()`;
    M-START `resumeSchedule()` (start-sequence §7, used by node.md §3.11); M-MODES `validate(roster, opts)`,
    `compile()`, `tutorialFrames(weapon, environment)`, `cues(voice)`, `awardMedals()`; M-ARMORY `scan()`
    replaces `readiness()` (rollup is M-MC's).
- **A5 (2026-08-25, post-A4 adversarial + consistency review; pre-deployment, `v` stays 1):**
  - **A5.1 Wire id 0 reserved.** `player_num` is 1–63 and displayed as-is; 0 = no identity (tutorial arms,
    unknown/environmental shooter). `MAX_PLAYERS = 63`. (Player #1 = wire 0 collided with the tutorial's
    "never credited" id.)
  - **A5.2 Friendly-fire scoring is roster-based, never `$TID`-based**, and FFA is never friendly (one `$TID`
    for all made every FFA kill −1). Accuracy counts non-friendly hits only. FFA winner = top `ScoreRow`.
  - **A5.3 BLE resync = observe before write.** The head's echo after `$CLEAR` is `$LCD,0,0,0,0,0,0` on a
    healthy gun (bench 2026-08-25), so it cannot reveal a missed death; forced respawn on every reconnect was a
    free heal and an erased death. The node now *observes* for `RESYNC_PROBE_S` (HUD: "gun relinked — pull the
    trigger"): `$ALCD` decrement = alive+configured; `$BUT` without `$ALCD` = dead (→ DOWN, `death{desync:true,
    shooter_num:0}`); `$HP`/`$LCD` = trust it; silence = unconfigured → re-write `head` (+`spawn` if LIVE,
    `respawn{resync:true}`). `DEATH_LATCH_MS` guards a stale `$HIR` latch at `$HP,0`.
  - **A5.4 Readiness cannot deadlock.** Headset/screen/foreground are amber before the config push; the only
    proven headset detector is the `$LCD,45,70` echo on `$SPAWN` (head-echo-as-proof is UNVERIFIED → bench);
    empty `gun_echo` after the push is red. Node pre-config probe set (`$PHONE`, `$STOP→$PHONE→$VERSION`) added
    to §3 so `$VOLTS`/`fw` exist at muster; `hello.gun.fw?` / `status.fw?`. Muster checklist adds Do-Not-Disturb
    (`preflight.dnd_on`).
  - **A5.5 Hydration keyed by the gun.** `hello.gun.name`/`tail` come from the advert name (iOS has no MAC);
    MC resolves `welcome.node` by gun first, `node_id` second, and includes `score?` so a hot-swapped phone
    starts with the right deaths/kills. `bind` carries `gun_name` + `gun_tail`.
  - **A5.6 `seq`/`match_id` rules:** same schedule → same `seq` + same `match_id`; reschedule → new both. Late
    joiner mid-match: `assign` → `config` → same `start` → hot-join.
  - **A5.7 Batched time base:** never-synced nodes' batches are re-based once per flush; window awards from
    them are suppressed. Lobby-synced nodes keep their `t` for the whole match.
  - **A5.8 `team_change` fact** (infection) so MC's roster follows the gun's `$TID`. Whether a mid-match `$TID`
    write changes friendly-fire resolution on the gun is UNTESTED → bench.
  - **A5.9 Lifecycle:** end/recall/panic/expiry → **KITTED** (gun + player retained; rematch = new `config`);
    `abort_start` on an already-LIVE node = `recall` (no panic); `end`/`recall` in KITTED/LOBBY defined;
    `time_limit_s == null` (full coverage only) = no local expiry.
  - **A5.10 `cues.game_over`** (Callsign ends with `$PLAY,VSF,4,6,JAY`) played after `frames.end`; the `$PLAY`
    template allows a token-1-only SFX (`tick`). `DEFAULT_RUNWAY_S = 120` ("walk time", not 30 s).
  - **A5.11 Bookkeeping:** `ReadinessRow`/`ReadinessSnapshot` defined here (MC-assembled); recap provisional
    until all victims flushed; accuracy "—" when the shooter's `status` is stale; `death.desync?`,
    `respawn.resync?`; `status.match_id?`/`fw?`; `$START` audio at the lobby head write is UNVERIFIED (bench);
    design packages realigned (READY-UP is a KITTED action; no team self-select; labels; killer name; #num).
- **A6 (2026-08-25, peer four-lens review of 0aa90d7 — sim + feasibility; pre-deployment, `v` stays 1):**
  - **A6.1 End freeze.** `end_t` recorded at `control{end}` / timed end; later facts are parked `post_end`, never
    scored. (FFA "first to N" on a park was otherwise re-decided by out-of-range players' later kills.) `validate()`
    WARNS when `frag_limit` is set without `opts.coverage == "full"`.
  - **A6.2 Hot-swap shots.** `shots_total` baseline per player; `welcome.node.score.shots_total`.
  - **A6.3 `cues` are pre-composed `$PLAY` frames.** Slot placement (token 1 SFX vs token 4 announcer) lives in the
    compiler, not on the node; the node keeps two templates (`$SFLASH,*`, `$PLAYX,0,*`) + the probe set.
  - **A6.4 `apply{frames}`** MC→node kind for coverage-zone runtime effects (syphon/regen/extraction boosts), which
    otherwise had no downlink. Marked coverage-only in modes.md.
  - **A6.5 `GameConfig.player_num_base?`** so two concurrent games on one field use disjoint id ranges.
  - **A6.6 BLE resync classifier redesigned (node.md §3.10): positive evidence only.** A `$BUT`-without-`$ALCD` is
    *also* an empty-mag dry-fire (protocol §7a) or an **unconfigured** gun (pre-game trigger emits `$BUT` but does
    not fire) — so it never means "dead" on its own, and silence never means "unconfigured". New protocol (peer review r2: **trigger first, then reload** — a full-mag reload is silent): HUD asks
    for trigger, then reload handle, then trigger: `$BUT,2` → `$ALCD` refill ⇒ configured (with last-known reserve > 0);
    then trigger → `$ALCD` decrement ⇒ alive; trigger → `$BUT`-only after a good reload ⇒ dead (`death{desync}`);
    reload silent with reserve > 0 ⇒ unconfigured ⇒ re-write `head` and — in LIVE — the reboot costs a
    `death{desync:true}` before `respawn{resync:true}` (no free heal); a gap-death is credited to a latched `$HIR`
    within `DEATH_LATCH_MS`. **No branch writes `spawn` without positive evidence; in LMS nothing is written unless
    the gun is provably dead.** Recap counts desync deaths. Known limitation: a station revive (`respawn.type: scanner`) inside a gap can hide a death.
  - **A6.7 Doc fixes:** `gun_echo` is "the gun answered", not "headset present" (unverified, NEXT #10); `$START`
    audibility at lobby unverified (NEXT #11); node lifecycle arrows → KITTED; runway text = `DEFAULT_RUNWAY_S`;
    first blood from a re-based never-synced batch is flagged provisional; module headers → A6.
- **A7 (2026-08-25, HUD v2 integration; additive):** MC→node **`score{ScoreRow, shots_total}`** — pushed on every change while
  the node is in coverage, so the HUD's K/A/ACC ("✓MC") update mid-match instead of only on rejoin (`welcome.node.score`).
  Node treats it as display-only truth; never derives kills locally.
- **A8 (2026-08-25, polish-loop iteration 1 — security + robustness; additive except the takeover rule):**
  - **A8.1 Operator auth.** The MC HTTP API + `/ui-ws` gate mutating requests behind a per-launch operator
    token (`Authorization: Bearer` or `?tok=`); read-only GETs stay open for a spectator board. `State.lan`
    gains `auth_required`. (On a shared field LAN any phone could otherwise `panic`/`end`/edit the roster.)
  - **A8.2 Node re-claim key.** `welcome.node_key` is a per-node secret; a `hello`/`bind` that takes over a
    **still-live** node_id or gun must present the matching `node_key`, else it is refused (`4003 in_use`).
    A stale holder (no frame for `STALE_AFTER_MS`) is still displaced without a key — legitimate hot-swap of
    a dead phone. Stops a rogue client kicking a live player by echoing their id.
    The displaced owner's key is remembered: if the displacer later goes stale the returning keyed owner wins the
    gun back; while the displacer is fresh it keeps the gun (it is the phone mounted on the player — a dead phone
    rebooting in a pocket must not yank the binding mid-match). The operator can `DELETE /api/nodes/{id}` (EVICT)
    either one.
  - **A8.3 Hardening (no wire change):** config/roster/start inputs are whitelisted + range-checked (a bad
    value is a 4xx, never a 500 or a crashed tick loop); CSV export neutralises spreadsheet-formula
    injection; `ready`/`ack_config` trust the server's node↔player binding, not a client-supplied id;
    pulled-log bytes and unbound hello-only node records are capped; the `event_batch` re-base path (A5.7)
    is now actually invoked on the real stack (it was dead — batches fell through the single-event path).

- **A9 (2026-08-26, additive):**
  - **A9.1 `apply.preview`.** An `apply` whose body carries `preview: true` and whose frames are ALL
    `$PLAY`/`$SFLASH` may be written by the node in `connected`/`kitted`/`lobby` too (bench previews: the
    tagger speaks a voice sample when the host changes a player's voice or gamertag). Everything else about
    A6.4 stands: non-preview applies, and any frame that is not pure sound/flash, still write only when LIVE.

- **A10 (2026-08-27, M-LOADOUT — `docs/spec/loadout.md` is the full spec; additive, no `v` bump):**
  - **A10.1 Two slots + perks.** `Loadout.weapons` = `[primary]` or `[primary, secondary]`; new `Loadout.perk`
    (slot 2 = weapon | perk | empty). The compiler emits `$WEAP,1`/`$AMMO,1` **only when a secondary exists** —
    the silent default shotgun in slot 1 is gone (an empty slot 1 is hardware-verified harmless). v1 perks are
    passive head tweaks (`body_armor` → `$PSET` armor, `extended_mags` → `$AMMO,0` + t16/t39/t17/t40,
    `quick_hands` → t18, `easy_reload` → `$BMAP,1,97`); `slot_frame` perks stay `hidden` until benched.
  - **A10.2 `GameConfig.loadout_policy`** (presets `open`/`no_heavies`/`snipers`/`custom`; per-slot `choice`
    player|host|fixed|off + tag/id rules). `ffa` defaults to `no_heavies`. The derived pool is server-computed
    and published (`State.loadout_pool`, `assign.policy`) — no rule logic in the UIs. MC auto-applies the policy
    to every loadout on config change / add player / restore.
  - **A10.3 Wire.** Node→MC `loadout_request` + `loadout_browse`; MC→node `loadout_ack`; `assign`/`welcome.node`
    gain `catalog` + `policy`; `Weapon` gains `tags`/`role`; `GET /api/perks`.
  - **A10.4 Ready semantics fixed.** A player's `ready` ENDS their try-out (`tutorial {end}` teardown); kit → lobby
    auto-advances only when **every** rostered player is ready (was: the first ready, which then disabled everyone
    else's try-outs); `tryout` refuses only once the lobby has been **pushed**, with a human reason.
  - **A10.5 Saved games** (loadout.md §8, HTTP only — no wire change): `SavedGame {preset_id, name, desc, builtin,
    created_t, updated_t, config: GameConfig, weapon_tuning?: RESERVED}` on the MC host (`~/.brx-mcp/presets.json`);
    `/api/presets*`; applying one is `PUT /api/config` with that config (fresh `config_id`).
- **A11 (2026-09-04, PRESENTATION — `mcp/brx_mcp/mc/presentation.py`; additive, no `v` bump):**
  - **A11.1 `GameConfig.presentation`** = `{ preset: standard|silenced|counter_strike|vip|infection|last_stand|
    extraction|custom, announcer, gun_flash, headset_team, sight_flash, hud_events, mc_events, mc_confidence,
    headset (A11.6), events: { <event>: { sound?, gun_led?, headset? } } }`. A preset name
    replaces the profile; any field edit makes it `custom` (the A10.2 rule). `sound` must be an id physically on
    the gun (`data/sound_catalog.json`, read off the hardware 2026-09-03 — the app's list has 157 ids the gun lacks);
    colours are the shared 9-entry palette. Mode defaults (`MODE_PRESET`): `cs` → `counter_strike`, `infection` →
    `infection`, `lms` → `last_stand`, `extraction` → `extraction`; `tdm`, `ffa` and anything unlisted → `standard`.
    Validated in `PUT /api/config` like every other key (A8.3).
  - **A11.2 Bundle.** The compiler expands it into `cues` (per-event pre-composed `$PLAY`, A6.3 — V-family ids
    on the announcer slot, everything else on the SFX slot; `""` = mute) and the new **`leds`** table (above),
    and echoes a `presentation` summary. `announcer:false` mutes the announcer + objective groups only (the
    player's own low-health alert and the countdown stay); `gun_flash:false` empties `leds`; `headset_team:false`
    removes the `$HLED` team-colour frames from `spawn`/`revive` and blanks `cues.team_led`.
  - **A11.4 The event system — HUD-DRIVEN FIRST.** The rule (Tony, 2026-09-04: *"this has to be an offline
    supported system. huds can disconnect during game. these events have to be hud driven"*): the node fires
    every event its own gun can witness itself, from the bundle it already holds — hit_taken, died, respawned,
    healed / armour_up / shield_up, low_health, the clock callouts, and `infected` on its own team flip. Nothing
    on the node waits for MC. MC pushes exist ONLY for facts no single gun can know (a kill credited to you and
    its medals; lead changes; next-kill-wins; last survivor; another player turning), they are best-effort
    while in coverage, and a stale one is dropped — exactly the standing `feedback` has had since A4.3.
    MC→node **`alert { kind, text, player_id, t, hud?, player_id_subject?, carrier?, flag_tid? }`**: a NAMED game
    event (lead_taken / lead_lost / next_kill_wins / last_survivor / infected / survivors_win / objective_taken /
    objective_scored / flag_returned / point_captured / hill_captured / bomb_planted / bomb_defused /
    bomb_detonated / vip_hit / vip_down …). MC sends only the name (+ `text`, the HUD banner); the node plays
    `cues[kind]` + `leds[kind]` from its OWN bundle, so the presentation profile is honoured per player, and shows
    `text` as an `alert` HUD moment (`hud:false` = sound/lights only). Same freshness rule as `feedback`
    (`FEEDBACK_MAX_AGE_MS`). Scope is MC's: all / one team / one player. The scorer emits lead changes (team
    modes by team totals, FFA by player), `next_kill_wins` once at cap-1, `last_survivor` once in lms/infection
    (in infection the survivors are the alive players still OFF the team the turns flip to, evaluated on every
    death and every turn), `infected` on a team_change in infection (the turned node itself skips MC's copy, it
    already played its own); mode engines emit the objective/VIP kinds. The scorer evaluates these after EVERY
    scored death, team kills included.
    **`feedback` gains `medals: string[]`** (Halo-style stack: first_blood · double_kill / triple_kill /
    killtacular · killing_spree at 5 / unstoppable at 10 — one kill can carry several); `kind` stays `"kill"` so
    older nodes still play their kill line, while a current node plays the medal cues back to back INSTEAD of
    it (2 s apart) and shows them on the kill moment. The old `multi`/`medal` kinds are legacy.
    **Clock callouts are the node's**: `time_60` / `time_30` / `time_10`, edge-triggered once each from its
    synced end time, so they work out of MC range.
  - **A11.5 Two event classes, both in the game config.** Every event carries a `source`: **`hud`** (the node
    fires it from its own gun/clock -- hits, death, respawn, pool gains, low health, clock callouts, the whole
    extraction ladder, its own infection turn), **`mc`** (only MC can know it -- kill credit + medals, lead,
    next-kill-wins, last survivor, objective/VIP callouts, the extraction alert to others) or **`both`**.
    `presentation` gains three switches: `hud_events`, `mc_events` (mute a whole class; per-event `sound`/
    `gun_led`/`headset` nulls still tune individual events) and **`mc_confidence`** (default on): MC pushes a
    GLOBAL-STATE event (`lead_taken`, `lead_lost`, `next_kill_wins`, `last_survivor` — `GLOBAL_STATE_EVENTS`;
    `survivors_win` is HUD-sourced, fired by the node at time-expiry, and is not gated) **only
    while every rostered player's HUD has a live socket, was heard from within 6 s, and reports nothing left
    to flush** (`Session.mc_confidence()`); otherwise the event is withheld and logged to the feed as
    WITHHELD. A withheld event is never queued -- a stale "takes the lead" is worse than silence. `GET
    /api/presentation` returns the resolved profile as rows (event · source · sound + words · colours ·
    enabled) plus the live confidence, for the MC's read-only ADVANCED view.
  - **A11.6 The headset (2026-09-04, Tony).** `presentation.headset = { pregame: team|off, start_flash, in_play:
    dark|team, hit: colour|null, death: native|colour, respawn_flash, carrier }`, defaults team / on / **dark** /
    red / **green** / on / on. (`death: native` writes nothing -- and in a hosted game the firmware's own
    out-blink does NOT fire once the node has taken the headset, so the player stays dark; Tony, phones,
    2026-09-04. The default is therefore OUR green slow blink, re-asserted by the node while a scanner-respawn
    player stays down.) The compiler emits **`bundle.headset`** = `{ in_play, rest, blank, pregame: string[],
    start, hit, death, respawn: [frame, hold_s][], carrier: { [tid]: [frame, hold_s][] } }`. The node drives the
    headset from it: the lobby paint is `head`'s `$HLED` (`pregame`); at T-0 it writes `start` (a white double
    flash, then `rest` -- dark by default); on every damaging hit `hit` then `rest` (the low-health alert's own
    `hurt_led` wins on that hit); while out, our slow blink in `death`'s colour (green by default); on revive `respawn` then `rest`; while carrying the flag a blink in the FLAG team's colour
    (`alert{kind:"objective_taken", carrier, flag_tid}` starts it, `objective_scored`/`flag_returned`/death end it),
    and that blink survives hits. `in_play: team` restores the A11 behaviour (team colour held, repainted after
    spawn/revive/hit; `cues.team_led` and the spawn/revive `$HLED` tails exist only then). Every flash sequence
    ends on an explicit state frame because a count-limited `$HLED` blink ending dark on its own is UNVERIFIED
    (bench item).
  - **A11.3 Node.** Plays `leds[event]` + `cues[event]` on its OWN events — `hit_taken` (alive, HP>0), `died`,
    `respawned`, `healed`/`armour_up`/`shield_up` (the pool that rose most) — and on MC pushes (`feedback` kinds
    `kill`/`multi`/`medal`/`victory` already resolve their cue from the bundle; objective/VIP pushes are the
    mode engines' to emit as they are built). Two LED bursts never start inside one second (three flashes per
    second is the ceiling; a fourth is the photosensitive line). The sound of a suppressed burst still plays.
- **A13 (2026-09-04, UTILITY — `docs/spec/utility.md`; additive, no `v` bump):** phones as items on the field.
  - **A13.1 `GameConfig.respawn.gate`** (`"trigger"` default | `"presence"`) — how a **scanner** respawn fires once the
    player is present at their team's respawn station: on a trigger pull (a dead gun still reports `$BUT,0,1`) or by
    dwelling there. `GameConfig.stations[]` (optional) = the allow-list of station ids valid in this game; absent =
    any Open BRX station in range counts. Team and threshold come from the station's **advert**, not the bundle.
  - **A13.2 `respawn` fact gains `station?: number`** — the id of the station that revived the player (absent for a
    timer/resync revive). MC counts revives per station at recap.
  - **A13.3 The station/player advert** — one 128-bit service UUID (`OBRX` magic, version 1, role, id, kind, team, state,
    value, seq, game, threshold); layout and codec in `utility.md` §2 / `app/src/beacon.js`. Between phones only; the
    gun never sees it.
  - **A13.4 Node state** — `state().station` (the respawn station this player would use, with its smoothed RSSI and
    threshold), `respawnGate`, `respawnHint` (`timer | find_station | approach | pull_trigger | reviving | out`).
- **A12 (2026-09-04, SIDEARMS — `docs/spec/loadout.md` §1.1/§3; additive, no `v` bump):**
  - **A12.1 Three pistols in the catalog** — `glock`, `usp`, `deagle` (role `sidearm`, tags `sidearm`+`pistol`, cls 10).
    Ordinary weapons on the wire (`WeaponSel`; `loadout_request kind:"weapon"`; try-out as any weapon). A row with
    `based_on {weapon_id, why}` ships a verbatim copy of that weapon's captured frame (the Bolt Rifle, the one
    captured semi-automatic) and moves only named tokens; `captured:false`. Deliberately dominated by primaries.
  - **A12.2 `SlotRule.kinds` gains `"sidearm"`** — admits only `sidearm`-tagged weapons, the way `["perk"]` admits only
    perks: secondary `["sidearm","perk"]` = pistol or perk; primary `["sidearm"]` = a pistol round. `"weapon"` already
    includes the pistols (`["weapon","sidearm"]` ≡ `["weapon"]`). A policy kind only — never a request kind. Rejection
    copy: `"Only sidearms go in the secondary slot this game"`. `assign.policy.secondary.kinds` carries it unchanged;
    the HUD relabels its weapons chip `SIDEARMS · n` when the rule holds `sidearm` and not `weapon`.
