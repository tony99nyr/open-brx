# M-MODES — mode catalog, config authoring, weapon catalog, the frame compiler, tutorial arming

- **Status:** built (`mcp/brx_mcp/mc/compile.py` over `gameconfig.py`; `mc/policy.py`, `mc/presentation.py`,
  `mc/weapons.json`, `mc/perks.json`). Binds to `contracts.md` §3 (GameConfig + `FrameBundle` + WeaponCatalog),
  §8 (frame contract), A4.2 (frames compiled by MC). Pruned 2026-09-06: the hand-typed weapon table moved out (the
  catalog is `weapons.json`, the rationale `docs/weapon-design.md`); closed bench questions moved to git history.
- **Runs in MC (Python).** M-MODES is the **frame compiler**: it wraps `gameconfig.py` (config→frame builder) +
  `mcp/brx_mcp/modes/` (pure rules engines, the CLI/sim path). **Nodes never call it** — a phone (JS) or Companion
  (C++) writes the compiled `FrameBundle` verbatim. One frame authority, one runtime that compiles.
- **Ground truth (link, don't restate):** `protocol/brx-protocol.md` (§7e arm, §7p/§7q player id, §7o feedback,
  §7r bench 2026-08-25), `protocol/callsign-extract/protocol-classes.md` ($WEAP/$GSET/$PSET token maps),
  `protocol/callsign-extract/sound-bank.md` (voice families), `docs/game-modes.md` (mode catalog),
  `docs/manual/03-gameplay.md` (the public arsenal page).

M-MODES is **pure and transport-free**: data in → frames out, no BLE, no LAN, no clock. M-MC authors
the config and pushes what M-MODES compiles; M-NODE writes it; M-MODES owns the *shapes and the compiler*.

---

## 1. The authoring model — data in, frames derived (in MC)

The **one rule**: `GameConfig` (contracts §3) is the *complete, serializable* description of a
match. Everything a node writes to a gun is **derived** from it by M-MODES **inside MC** — there is no
hidden state, no side-channel, nothing the JSON doesn't capture. Author → JSON → frames must round-trip.

```
 host UI (M-MC)          M-MODES (in MC, Python)                         M-NET        M-NODE
 ┌──────────────┐  JSON  ┌────────────────────────────────────┐ FrameBundle ┌─────┐  ┌──────────┐  BLE
 │ games / kit  ├───────►│ GameConfig  (contracts §3)          ├────────────►│ WS  ├─►│ node     ├──────► gun
 │              │        │  ├─ WeaponCatalog.resolve()         │  in `config`│     │  │ writes   │
 └──────────────┘        │  ├─ voice → $PSET tail              │  (per       └─────┘  │ verbatim │
        ▲                │  ├─ player_num → $PSET token 1      │   player)            └──────────┘
        │ WeaponCatalog  │  ├─ policy / perks / presentation   │
        └── (visual      │  └─ compile(config, player)         │
             weapon select data)└───────────────────────────────┘
```

Two GameConfig representations, one meaning: the **wire form** (contracts §3 JSON, crossing the LAN in
`config` and `welcome` together with the compiled `FrameBundle`) and the **compiler form** (the
`gameconfig.py` dataclass, a superset carrying the CLI/sim knobs). ⚠ They have drifted: the dataclass has
objective/extraction/regen knobs the wire cannot carry (FOLLOWUPS E1–E3, `docs/utility-roadmap.md` §9).

### 1.1 `compile(config, player) → FrameBundle` — the per-player build

There is **no team-invariant setup**: `$PSET` token 1 is the player's `player_num` (**1–63**, wire **0
reserved**), so the config head is **per player**. `compile` maps the `gameconfig.py` builders onto the
contracts §3 `FrameBundle` fields like this:

| bundle field | built from | contents / rules |
|---|---|---|
| `head` | `setup_frames()` **minus its trailing `$PLAYX,0` + `$PLAY,VA81`**, then the presentation paints, then `$TID,<player.team.tid>` | `$VOL,<play_volume(environment)>` → `$CLEAR` → `$START` → `$GSET` → **`$PSET,<player_num>,0,<HP>,<armor>,<shield>,…`** → `$WEAP` per loaded slot (melee in slot 4; `$WEAP,1` only when a secondary exists, A10.1) → `$SIR` ×n → `$BMAP` ×n (Easy Reload → `$BMAP,1,97`) → LED / headset pregame frames (A11.6/A11.7) → `$TID`. **Silent by construction and silent on the gun** (bench 2026-08-25 §7r). **Never contains `$SPAWN`.** |
| `spawn` | `["$PLAYX,0,*"] + spawn_frames()` | `$PLAYX,0` → `$SPAWN,,` → `$AMMO,<slot>,<mag>,<reserve>,1` per loaded slot (perk `ammo_mult` applied) → `$BMAP,0,0` → the headset team tail when `headset_team` (A11.2). The T-0 tail. |
| `revive` | `["$SPAWN,,*"] + the $AMMO frames of spawn_frames()` | Respawn re-arm; explicit `$AMMO`s make the *reserve* loadout-correct after a mid-life reload. |
| `end` | `END_SEQUENCE` | `$SPAWN,,` → `$PLAYX,0` → `$STOP` → `$CLEAR` → `$HLOOP,0,0` → `$HLED,0,0,0,0,0,0` (revives a dead gun so it isn't stuck in death-glow, silences the spawn voice, blanks the headset; `$TID` untouched). The node then plays **`cues.game_over`** (A5.10). |
| `panic` | `PANIC_SEQUENCE` | `$CLEAR,*` → `$SP,99,*` |
| `team_flip?` | `$TID,<tid>` per other team | **infection** only: the frames that move *this* gun to the infected team on death. Node writes `team_flip[<tid>]` then `revive` and emits **`team_change{tid}`** (A5.8). A live `$TID` write flips hit resolution immediately (bench 2026-08-25). |
| `cues` / `leds` / `gun` / `headset` / `presentation` | `mc/presentation.py` (A11) | one pre-composed `$PLAY` per event that carries a sound (`""` = mute), the tuned `$GLED` burst per event, the gun-body and headset sequences — contracts §3. |
| `swap_ms` | `max($WEAP tok15)` after perks | 850 stock, 425 with `quick_switch` (2026-09-04). |

- `_PSET_HEAD` is `["PSET", str(player_num), "0"]` with `player_num ∈ 1..63` — **token 2 stays `0`** (bench
  2026-08-25: inert). Token 1 = `0` is written **only** by `tutorialFrames` (§4): "no identity", which MC never
  credits (A5.1).
- HP/armor come from `health` (+ `player.loadout.overrides` + the `body_armor` perk); the voice tail from
  `player.voice` (§5). ⚠ The `$PSET` **shield** token is written but **inert** — the pool is granted only by an
  IR `$SIR` function-11 event (P16). Keep writing it for frame fidelity; do not treat it as a setting.
- **Volume** = `compile.play_volume(environment)`: **80 indoors / 90 outdoors** (2026-08-30: 69 was inaudible
  outdoors); try-outs `VOL_TRYOUT = 69`; the diagnostic `30` never reaches a game head.
- Nothing in `compile` reads a clock or the network — the dispersed-start timing (M-START) wraps `spawn`.
- `compile` is re-run (and the bundle re-pushed) whenever `player.loadout`, `player_num`, `team` or
  `voice` changes after the lobby push (contracts §5 `config`).

## 2. Mode catalog → config schema

`docs/game-modes.md` is the **infrastructure-tier catalog** (what gear each mode needs). This section is the
**config schema** for the modes the MC path ships (`mc/state.py` `MODES`: `tdm`, `ffa`, `infection`, `lms`,
`extraction`) — how each mode's knobs sit in `GameConfig`, which map to *frames* vs the *host engine*, and
**which end condition actually reaches a dispersed node**. The gun keeps **no game state** (no mode/clock/
score/respawn — protocol §7n); mode logic is host-side, and only the combat-surface knobs (weapon, team,
player id, HP, FF, crit, indoor/outdoor, LED) become frames.

**End-condition reachability (A4.8).** The only end that reaches every node is the **local time-expiry** at
`go_live_t + time_limit_s` (node.md §3.9), so **`time_limit_s` is required**. Every other end — frag limit,
last-alive, last-human, extraction target — is *decided by MC* from reconciled events and delivered as
`control{end}` **best-effort**: nodes in coverage stop early, dispersed nodes keep playing until the time
limit. `time_limit_s == null` is legal **only** when `validate(roster, {coverage: "full"})` is asserted.

| `mode` | Engine (`modes/`, CLI/sim) | Config knobs that matter | → Frames | → Host engine | End that reaches everyone / in-coverage early end |
|---|---|---|---|---|---|
| **tdm** | `deathmatch.py` | `teams[]` (2–4), `time_limit_s`, `scoring.frag_limit`, `respawn`, `health`, `friendly_fire` | `$TID` per team, `$PSET` player id + HP/armor, `$GSET` FF, `$WEAP` loadout | exact per-player kills/assists (`$HIR` tok3), respawn timer, team-kill scoring | time limit / `frag_limit` (MC → `end`) |
| **ffa** | `deathmatch.py` (FFA path) | **one `$TID`, FF forced ON, distinct `player_num`s**, `time_limit_s`, `scoring.frag_limit`; policy default `no_heavies` | `$TID` all-same, `$GSET` friendlyFire=1, `$PSET,<player_num>` | **exact 1:1 attribution**. **Never friendly** (A5.2). **Winner = top `ScoreRow`**. | time limit / `frag_limit` |
| **infection** | `survival.py` | starting infected count, `respawn` (auto), `time_limit_s` | `$TID` (human vs infected); **`team_flip[<infected tid>]`** in the bundle | **node-local**: a killed human writes `team_flip` + `revive`, emits **`team_change{tid}`** — works offline; MC updates the roster from `team_change`, tallies last-human, pushes `infected`/`last_survivor` alerts (A11.4). | time limit / last-human (MC → `end`) |
| **lms** | `lms.py` | `scoring.win_by:"survival"`, lives (`respawn.type:"none"` or finite), `time_limit_s` | `$PSET` HP; no `revive` after last life | lives counter (node-local), last-alive (MC) | time limit / last-alive |
| **extraction** | `extraction.py` (+ adapter) | `channel_s`, `win_target`, `loot_per_kill`, `drop_policy`, `extract_removes_player`, `time_limit_s` (CLI dataclass only today, E1) | base combat frames + `$LIFE`/`$WEAP` boost writes on bank (coverage-only, `apply`) | loot wallet, loud channel, drop-on-death, bank→boost — MC-side, so **coverage-zone gameplay**; the HUD owns its own extraction ladder events (A11.5) | time limit / `win_target` |

Notes that shape the schema:

- **Teams → `$TID`.** `Team.tid` is the numeric id written as `$TID,<tid>`. **`$TID` is team + LED colour +
  friendly-fire class, nothing else** — per-player identity is `$PSET` token 1 (A4.1). **Four native teams**
  (`$TID` masks to 2 bits; bench 2026-08-26); beyond four, FFA + MC logical teams.
- **Player id → `$PSET` token 1.** `player_num` **1–63**, displayed as-is. MC assigns; `compile` writes it;
  `$HIR` token 3 reports it to every victim. Uniqueness across the roster is a `validate()` rule (§7).
- **Respawn** (`respawn.type`): `auto` = node timer (`delay_s`) → writes `revive`; `scanner` = revive at a
  utility-phone station (BLE advert presence + the `gate`, utility.md §4; A13.1); `none` = LMS. No gun token
  exists — the node owns the delay.
- **Objective modes** (domination/koth/ctf/cs) exist as engines in `modes/` but are **not in the MC catalog**
  and have no wire-carried parameters (E1/E2) — `docs/utility-roadmap.md` §8 is the status per mode.
- **Health variants** (syphon/regen) are `gameconfig.py` booleans that add **host-driven** `$LIFE` writes at
  runtime (additive, clamped); they reach a node only via **`apply{frames}`** (A6.4) — coverage-zone only.

## 3. WeaponCatalog

Static data owned by M-MODES: **`mcp/brx_mcp/mc/weapons.json`** (22 rows: the 19 captured Callsign weapons,
the three A12 sidearms, melee), each row carrying `capture.frame` (the real frame Battle Company sent), a `wire`
block naming only the balance tokens we overwrite, optional declared `overrides`, `htk`/`ttk_ms`, `tags`, `role`.
**Why the numbers are what they are is `docs/weapon-design.md`** (the damage model, the rebalance table, the
`$SIR` layer, the token appendix); the public arsenal page is `docs/manual/03-gameplay.md`.

- `WeaponCatalog.resolve(weapon_id, slot) → "$WEAP,<slot>,<tail>"` — the base is the weapon's **own captured
  frame**, and only the balance tokens are overwritten: `t5` damage, `t14` fire interval, `t16`+`t39` mag,
  `t17`+`t40` reserve (`t17 == 2 × t40` preserved), `t18` reload, plus `t15` swap delay where `wire.swap_ms` is
  set (sidearms 500). Sounds, fire mode (`t20`), burst (`t23`), overheat, ranges come from the capture.
  **Token 15 is the swap delay** (bench 2026-09-04) — the 2026-08-26 note that it must never be written is retired.
- `spawnAmmo(weapon_id) → (mag, reserve)` drives the `$AMMO` frames in `spawn`/`revive`; perks scale it.
- **Melee** is always loaded to slot 4; hidden from the picker.
- **Provenance discipline:** `verified: true` only where the shipped row equals the capture byte for byte
  (Burst Rifle, Bolt Rifle, Melee); the byte-diff pinning test (`test_mc_compile.py`) blocks every change outside
  the balance tokens and declared overrides.
- ⚠ **Damage is a property of the (weapon, `$SIR` table) pair.** `Compiler.validate()` cross-checks each
  weapon's `<t3,t4>` against the table MC pushes and warns on: no row (hits silently dropped), a no-pool function
  (the Energy Launcher lands 0 — a live bug, weapon-design.md §6.2), a multiplier function (×1.25/×2 lands more
  than `t5`). Warning-only until the Energy Launcher fix; promote the first two to errors in that commit.

## 4. Tutorial arming (phase 3a) — private try-out, compiled by MC

When a weapon is picked at kit-out (host on KIT, or a phone `loadout_request{try:true}`), MC calls
`tutorialFrames(weapon, environment)` and sends the node **`tutorial{weapon, frames}`** — the node writes
`frames` verbatim. The gun arms **that one weapon, privately**, so the player can pull the trigger and reload to
*feel* it — **no game starts, no scoring team, audio limited to the weapon's own fire/reload**.

`tutorialFrames(weapon, environment) → string[]` differs from the real `head`+`spawn` by:

| | Real arm (`compile`) | Tutorial arm (`tutorialFrames`) |
|---|---|---|
| Volume | `$VOL,80|90` | `$VOL,69` (`VOL_TRYOUT`: fired at arm's length from the player's own head) |
| Game start | `$START`; `$PLAY,VA81` in the T-0 tail | **no `$START`, no start voice** (the `$SPAWN` chirp is silenced by `$PLAYX,0`) |
| Player id | `$PSET,<player_num>,…` | `$PSET,0,…` — no identity; a stray try-out hit reports shooter 0, which MC never credits |
| Team | `$TID,<team>` | **no `$TID` written** — the gun keeps its last colour (no "no team" colour exists) |
| `$GSET` | full game settings | minimal (env from `environment`, FF off) so a stray shot is inert |
| Weapon slots | primary+secondary+melee | **the single tried weapon in slot 0 only** (a try-out is the raw weapon; perks are not applied) |
| `$SIR` / scoring | full incoming-IR table | omitted — incoming hits do nothing to *this* gun |

```
$VOL,69,0,*                       ; audible at arm's length
$CLEAR,*                          ; wipe any prior arm
$GSET,0,<outdoor>,1,0,1,0,50,1,*  ; FF off, env from `environment`; NO $START
$PSET,0,0,45,70,70,50,,<voice tail>,*  ; identity 0
$WEAP,0,<catalog tail for weapon> ; the one weapon, slot 0
$SPAWN,,*                         ; make it live so the trigger works (self-plays the spawn voice)
$PLAYX,0,*                        ; silence that spawn chirp
$AMMO,0,<mag>,<reserve>,1,*       ; loadout-correct ammo to feel reloads
$BMAP,0,0,,,,,*                   ; trigger + reload handle armed
```

- **Enter:** node is in `KITTED`. The tutorial is a transient overlay — the node does **not** report events
  upstream (a try-out shot is not a game shot).
- **Exit:** the next `tutorial{…}` (re-arm), `tutorial{end}` (the teardown push: host END TRY-OUT, a
  `ready`, a policy reset — A10.4), `config` (the lobby head overwrites everything), or `control{end}`.
- **Panic still applies:** `$CLEAR,*` then `$SP,99,*` at any time.
- **Safety:** the try-out gun *emits* real IR. Other players' guns are unconfigured (inert) or hold a written
  `head` but are unspawned — and **an unspawned-but-configured gun ignores IR** (bench 2026-08-25 §7r). So the
  only rule left is the human one: `tryout()` refuses once the lobby has been **pushed** (`lobby_pushed`), with a
  human reason (A10.4), and the kit-out UI says "point away from other players".

## 5. Voice sets → sound-bank / $PSET

`Player.voice` selects a **voice persona**; M-MODES maps it to the positional voice-pack tail of `$PSET`
(protocol-classes §PSET: `maxHP,maxShields,critBonus,` then the ordered sound slots `deathAlarm,…,deathScream,
battleRespawnCry,…,painRelief,…`). `gameconfig.VOICE_PACKS` holds the families; `compile.voice_options()` (served
as `GET /api/voices`) is the selectable list — **the full pack is offered**, not just male/female. Only HEAVY (`V3`)
is confirmed by ear; the others carry the per-slot ids the bank legend implies. `apply{preview:true}` (A9.1) lets
the tagger speak a sample when the host changes a voice.

## 5b. Medal catalog & feedback cues

Medals are awarded per player from exact attribution (A4.1). Kill-moment medals ride `feedback.medals` (A11.4:
first_blood · double_kill / triple_kill / killtacular · killing_spree at 5 · unstoppable at 10) with their own
cues; recap honors (`scoring.honors()` + `compile.award_medals`): MVP (top `kills − deaths`, tie → K/D), Top Gun
(most kills), Highest K/D, Sharp Shooter (accuracy above a min-shots threshold), Survivalist (fewest deaths),
First Blood, multi-kills, Assistant. No honors under 3 scored players; MVP and Top Gun require kills > 0
(design-review 2026-08-26). Names track the stock BRX set (`mcp/brx_mcp/data/medals.json`, restated from the app's own
game-medals-config.json; raw file removed 2026-09-07, `protocol/callsign-extract/RAW_ASSETS_NOTE.md`).

**Feedback cues are shipped in the bundle, not looked up on the node** (A6.3): the node turns MC's
`feedback{kind, t, cue?, medals?}` into `$SFLASH,*` + the pre-composed `cues[kind]` (or the carried `cue`) +
`leds[kind]`. Confirmed ids: `countdown` `VA81`, `kill` `VAA`/family kill line, `game_over` `VA33`, victory
`VSF`+`JAY` (bench 2026-08-25); everything else in `presentation.EVENTS` is a real bank id chosen by descriptor.
Feedback is **best-effort and coverage-zone-only** on the phone path; MC drops any `feedback` older than
`FEEDBACK_MAX_AGE_MS`.

## 6. LED / environment — the `led` object and the presentation profile

Environment is two knobs — `environment` (indoor/outdoor → `$GSET` outdoorMode) and `night` — plus the
presentation profile's `gun` / `headset` blocks (contracts §3, A11.6/A11.7), which have replaced the earlier
free-form `led` object for everything but the night blank.

```jsonc
// Palette (bench-verified 2026-08-30, completed 2026-09-02): nine colours, 0-8 —
// 0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink · 8 orange (9/10 dark).
// $GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>: three independently addressable body LEDs.
// Token 4 is an APPLY GATE, not an off value (corrected 2026-09-02): 0/6/7/8/9/10 apply the colour tokens at full
// brightness; 5 applies them at ~1/3; 1/2/3/4 are no-ops. $GLED,,,,5,,,* blanks because its colour tokens are
// EMPTY and t4=5 applies them — and (A11.7, 2026-09-04) that blank also takes the LED OUT of the spawned gun's
// breathing loop, so any colour painted after it HOLDS until $SPAWN re-enables the breathing.
// Token 5 (brightness) is three-state: 0 off, 1 dim (~70%), >=2 full.
```

| Environment | `environment` / `night` | Frames |
|---|---|---|
| **Indoor** | `indoor` / false | `$GSET,…,outdoorMode=0,…`; body + headset per `presentation` (default team) |
| **Outdoor (day)** | `outdoor` / false | `$GSET,…,outdoorMode=1,…` (longer IR range profile) |
| **Night** | any / true | `$GLED,,,,5,,,*` (✅ confirmed 2026-08-30) + no `leds` bursts; the HUD blackout |

`is_night_mode()` mirrors `gameconfig.is_night_mode`; `night` also drives the node's blackout HUD.

## 7. Interface M-MODES exposes

```
// Config (M-MC)
default_config(mode) / MODES     -> GameConfig            // mc/state.py: the catalog + per-mode defaults (incl. loadout_policy, presentation preset)
validate(config, roster, opts?)  -> {ok, errors[], warnings[]}
   // rules: time_limit_s required (> 0) unless opts.coverage == "full"; player_num unique + 1..63; dup team tid;
   //        ffa ⇒ one tid + friendly_fire on; lms ⇔ respawn none/finite lives; station-gated modes rejected without a
   //        station source (extraction exempt); unknown weapon_id / perk_id; loadout vs policy; the $SIR cross-check (§3);
   //        frag_limit without full coverage → warning (A6.1)
apply_policy()                   -> re-fixes every loadout to the ruleset (loadout.md §3.3)

// Frames (pure; no clock, no BLE) — the compiler
compile(config, player)          -> FrameBundle        // §1.1
tutorialFrames(weapon, environment) -> string[]        // §4
play_volume(environment)         -> 80 | 90            // VOL_TRYOUT = 69

// Data
weapon_catalog() / weapon_views(catalog, pool) -> Weapon[] / WeaponView[]   // §3; views re-derive htk/ttk at the host's pool
perks / PerkView[]               -> mc/perks.py
voice_options()                  -> VoiceOption[]      // §5
award_medals(rows, kills) / scoring.honors()            // §5b
presentation.resolve(config)     -> rows for GET /api/presentation (A11.5)
```

- `setup_frames`/`spawn_frames`/`player_frames`/`END_SEQUENCE`/`PANIC_SEQUENCE` are **internals of
  `compile`** (`gameconfig.py`), not a public surface — nobody outside M-MODES assembles a frame list.
- **Every frame emitter is on the known-safe list** (`protocol.py`); unknown commands need explicit confirm.
- Frames are **strings, verbatim** — M-NODE chunks at 20 bytes and writes; it never parses or edits them. Its
  only self-composed frames are the two contracts §3 templates (`$SFLASH,*`, `$PLAYX,0,*`).

## 8. Open questions (still open on 2026-09-06)

- **`t41` range** — reads 75 on every gun; not differentiated; the IR-instrument A/B is weapon-design.md U2.
- **`$SIR` table: flatten to fn 1 or retune the five multiplied weapons** — weapon-design.md §6.2, Tony's call;
  the Energy Launcher bug is fixed either way in the same commit.
- **Voice per-slot map** beyond HEAVY — by ear or the `voice-profiles` endpoint (apk-harvest).
- **Pin the runway lines + klaxon by ear** (start-sequence §2; `compile.py:663-669` ships runway_30/20 silent).
- **`revive` vs `$HLOOP`** — the mid-match revive drops `$HLOOP,0,0`; the headset comes back through the A11.6
  `respawn` sequence instead. Confirm on hardware that nothing else needed it.
- **Wire-carried mode parameters** (`mode_params`) so objective modes are configurable through MC — E1
  (`docs/utility-roadmap.md` §9).

Closed on the bench and folded above: night LED-off (2026-08-30, mechanism 2026-09-02); the shield pool is
IR-only (P16, 2026-08-26); four native teams (2026-08-26); `$PSET` tok2 inert, `$START` silent at the head
write, unspawned guns ignore IR, live `$TID` flips hit resolution (all 2026-08-25, §7r); `t20` is the fire mode
and `t15` the swap delay (2026-08-26, 2026-09-04).
