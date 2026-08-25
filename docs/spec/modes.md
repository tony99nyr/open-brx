# M-MODES — mode catalog, config authoring, weapon catalog, tutorial arming

- **Status:** Draft (Wave 1, parallel). Binds to `contracts.md` §3 (GameConfig + WeaponCatalog)
  and §8 (frame contract). Owner of the `M-MODES` lane in `README.md` §4 (phases 2 / 3a).
- **Reuses:** `mcp/brx_mcp/gameconfig.py` (the config→frame builder) + `mcp/brx_mcp/modes/`
  (the pure rules engines). This spec **does not re-derive frames** — it wraps and extends what
  `gameconfig.py` already ships, and states the interface the other lanes bind to.
- **Ground truth (link, don't restate):** `protocol/brx-protocol.md`,
  `protocol/callsign-extract/protocol-classes.md` ($WEAP/$GSET/$PSET token maps),
  `protocol/callsign-extract/sound-bank.md` (voice families), `docs/game-modes.md` (mode catalog),
  `docs/reference/callsign-ui.md` (the operator-facing knob set + weapon roster).

M-MODES is **pure and transport-free** (per §M0): data in → frames out, no BLE, no LAN, no clock.
M-NODE executes the frames; M-MC authors the config; M-MODES owns the *shapes and the compiler*.

---

## 1. The authoring model — data in, frames derived

The **one rule**: `GameConfig` (contracts §3) is the *complete, serializable* description of a
match. Everything a node writes to a gun is **derived** from it — there is no hidden state, no
side-channel, nothing the JSON doesn't capture. Author → JSON → frames must round-trip.

```
 host UI (M-MC)          M-MODES (this module)                     M-NODE
 ┌──────────────┐  JSON  ┌───────────────────────────────┐ frames ┌──────────┐  BLE
 │ mode author  ├───────►│ GameConfig  (contracts §3)     │        │ node     ├──────► gun
 │ + kit-out    │        │  ├─ WeaponCatalog.resolve()    ├───────►│ writes   │
 └──────────────┘        │  ├─ voiceSet → $PSET tail      │        │ verbatim │
        ▲                │  └─ armFrames(config, player)  │        └──────────┘
        │ WeaponCatalog  └───────────────────────────────┘
        └── (visual weapon select data)
```

Two GameConfig representations, one meaning:

- **Wire form** — the `contracts.md` §3 JSONC object (`mode`, `environment`, `night`, `respawn`,
  `scoring`, `health`, `teams`, `led?`, …). This is what crosses the LAN in `assign`/`welcome`.
- **Compiler form** — the `gameconfig.py` `GameConfig` dataclass (every knob mapped to its frame).
  M-MODES provides `fromWire(json) → GameConfig` and `toWire(GameConfig) → json` so the two stay
  in lockstep. The dataclass is a superset (it carries objective/extraction knobs the base wire
  shape folds into `scoring`/`led`/mode-specific extras); unknown wire fields are ignored (§9
  additive rule), and compiler-only knobs default.

**Frame derivation** is exactly today's two-stage build, re-exposed player-scoped:

- `setup_frames()` → per-**game** config (sent once): `$VOL,$CLEAR,$START,$GSET,$PSET`, the
  `$WEAP` slots, `$SIR` table, `$BMAP`, LED frames, game-start sound. Identical across a team.
- `player_frames(team)` → per-**gun**: `$TID,<team>` + `spawn_frames()` (`$SPAWN` + loadout-correct
  `$AMMO` per slot + `$BMAP,0`).
- `armFrames(config, player)` = **`setup_frames()` ++ player_frames(player.team.tid)`**, with the
  weapon slots resolved from `player.loadout.weapons` via the WeaponCatalog and `$PSET` HP/armor
  taken from `health` (or `player.loadout.overrides`). This is the single call M-NODE makes to arm
  a real game. Volume defaults to **69** for play (30 is inaudible — house rule); the low `$VOL,30`
  default stays for bench probing only.

Nothing in `armFrames` reads a clock or the network — the dispersed-start timing (M-START) wraps
these frames, it does not live inside them.

## 2. Mode catalog → config schema

`docs/game-modes.md` is the **infrastructure-tier catalog** (what gear each mode needs). This
section is the **config schema** for the five modes M-MODES ships as `mode` values — how each mode's
knobs sit in `GameConfig` and which map to *frames* vs the *host engine*. The gun keeps **no game
state** (no mode/clock/score/respawn — protocol §7n); so mode logic is host-side, and only the
combat-surface knobs (weapon, team, HP, FF, crit, indoor/outdoor, LED) become frames.

| `mode` | Engine (`modes/`) | Config knobs that matter | → Frames | → Host engine |
|---|---|---|---|---|
| **tdm** | `deathmatch.py` | `teams[]` (2), `scoring.frag_limit`, `time_limit_s`, `respawn`, `health`, `friendly_fire` | `$TID` per team, `$GSET` FF, `$PSET` HP/armor, `$WEAP` loadout | frag/time limit, respawn timer, team-kill scoring |
| **ffa** | `deathmatch.py` (FFA path) | all guns one team, **FF forced ON**, `scoring.frag_limit` | `$TID` all-same, `$GSET` friendlyFire=1 | 1:1 kill attribution (needs P2 for exact killer; else team-level) |
| **infection** | `survival.py` | starting infected count, `respawn` (auto), win = last human | `$TID` (human vs infected teams); on death the node re-arms victim with `$TID`=infected | flip killed human → infected team; last-human win |
| **lms** | `lms.py` | `scoring.win_by:"survival"`, lives (`respawn.type:"none"` or finite), `time_limit_s` | `$PSET` HP; no respawn frames after last life | lives counter, last-alive win |
| **extraction** | `extraction.py` (+ adapter) | `channel_s`, `win_target`, `loot_per_kill`, `drop_policy`, `extract_removes_player` | base combat frames + `$LIFE`/`$WEAP` boost writes on bank | loot wallet, loud channel, drop-on-death, bank→boost |

Notes that shape the schema:

- **Teams → `$TID`.** `Team.tid` (contracts §2) is the numeric id written as `$TID,<tid>`. Native
  hardware teams confirmed at 2 (TDM) + 3 (factions); max-N is UNTESTED. FFA + MC-logical teams
  (all one `$TID`, FF on, MC scores true squads) is the always-works fallback (game-modes §Team).
- **Respawn** (`respawn.type`): `auto` = host timer (`respawn_s`, optional ramp 15/30/45/90),
  `scanner` = respawn at a station/grenade (host defers to the objective device), `none` = LMS.
  No gun token exists — the node owns the delay and re-sends `spawn_frames()` at T.
- **Objective modes** (domination/koth/ctf/cs) are in `gameconfig.py`/`modes/` but need a station
  event source (Tier 1). They are **out of M-MODES' arming scope** here — the engines exist; M-MODES
  only guarantees the *combat* frames. List them as valid `mode` strings, mark station-gated.
- **Health variants** (syphon/regen) are `GameConfig` booleans that add **host-driven** `$LIFE`
  writes at runtime (additive, clamped — exp-log #33); they are not arm-time frames.

## 3. WeaponCatalog

Static data owned by M-MODES; the source behind M-MC's visual weapon-select. Each entry is the
`contracts.md` §3 `Weapon` shape: `weapon_id`, `name`, `class` (WeaponCategory enum, protocol-classes
§Enums), `stats`, `weap_frame` (the `$WEAP,<slot>` **tail** template), `icon?`.

The **~18-weapon roster + printed ammo/reload** comes from `callsign-ui.md`; the **$WEAP token
positions** from `protocol-classes.md` §WEAP (44-token frame, key positions: `5`=primaryDamage,
`15`=rateOfFire, `16`=maxClip, `18`=reloadSpeed ms, `27`=primaryFire sound, `31–33`=reload sounds,
`39`=clipStartingAmmo, `40`=ammoReserv, `41`=gunRange%). Two frames are hardware-fired today (`ar`,
`charge` in `WEAPON_TAILS`); the rest are **templated from those two + the roster stats** and flagged
provisional until a one-field capture pins them.

`stats` per weapon (from `callsign-ui.md`; damage/range qualitative→numeric via the bar fill):

| weapon_id | name | class | mag | reserve | reload_ms | rof | dmg | range |
|---|---|---|---:|---:|---:|---|---|---|
| assault_rifle | Assault Rifle | 0 Rifle | 32 | 384 | 1400 | high | mid | mid |
| burst_rifle | Burst Rifle | 0 Rifle | 36 | 216 | 1700 | mid | mid-hi | hi |
| sniper_rifle | Sniper Rifle | 2 Sniper | 4 | 24 | 1700 | low | hi | max |
| shotgun | Shotgun | 3 Shotgun | 6 | 24 | 400 | low | hi | short |
| smg | SMG | 1 SMG | 72 | 288 | 2500 | v.high | low | short-mid |
| amr | AMR | 4 Heavy | 14 | 56 | 1400 | high | hi | hi |
| energy_launcher | Energy Launcher | 9 Launcher | 1 | 6 | 1400 | low | v.high | mid |
| rail_gun | Rail Gun | 7 Power | 1 | 6 | 2400 | low | v.high | hi |
| rocket_launcher | Rocket Launcher | 9 Launcher | 2 | 8 | 1200 | low | v.high | — |
| laser_cannon | Laser Cannon | 4 Heavy | 4 | 8 | 2000 | low | v.high | hi |
| charge_rifle | Charge Rifle | 5 Energy | 100 | 200 | 2500 | high | hi | — |
| bolt_rifle | Bolt Rifle | 0 Rifle | 18 | 180 | 2000 | mid | mid | — |
| plasma_sniper | Plasma Sniper | 2 Sniper | 10 | 80 | 2000 | mid | hi | — |
| force_rifle | Force Rifle | 0 Rifle | 36 | 144 | 1700 | mid | mid | — |
| stinger | Stinger | 6 Support | 18 | 72 | 1700 | mid | hi | — |
| energy_rifle | Energy Rifle | 5 Energy | 300 | 600 | 2400 | high | low-mid | — |
| suppressor | Suppressor | 1 SMG | 48 | 288 | 2000 | high | hi | — |
| ion_sniper | Ion Sniper | 2 Sniper | 2 | 12 | 2000 | low | hi | hi |

- `reserve` = mag × mags from the roster (e.g. AR 32×12). Unlimited-reserve presets (`ar`,`charge`
  today) keep the big sentinel value in the tail; a finite catalog reserve overrides token 40.
- `WeaponCatalog.resolve(weapon_id, slot) → "$WEAP,<slot>,<tail>"` — the tail is the template with
  `{damage}`/`{rof}`/`{mag}`/`{reserve}`/`{reload}` substituted at tokens 5/15/16/40/18. Sounds
  (tokens 27, 31–33) default to the AR block unless the weapon defines its own (sound-bank families).
- `spawnAmmo(weapon_id) → (mag, reserve)` drives `$AMMO` in `spawn_frames()` — ammo comes from the
  **selected** weapon, never hardcoded (already true in `gameconfig.py`).
- **Melee** is always loaded to slot 4 (the app does; `gameconfig.py` matches). Catalog carries it as
  a hidden entry, not offered in the visual picker.

**Provenance discipline:** each entry tags `verified: true|false`. Only `ar`/`charge` (and the
`primary`/`secondary`/`melee` fired frames) are `true`; the other ~15 ship `false` and are pinned by
a targeted Callsign capture (change one field, diff the frame — protocol-classes §Method).

## 4. Silent tutorial arming (phase 3a)

When the host changes a player's weapon at kit-out, M-MC sends the node a `tutorial{weapon}` message
(contracts §5). The node arms **that one weapon, privately, as silently as possible**, so the player
can pull the trigger and reload to *feel* it — **no game starts, no scoring team, audio limited to
the weapon's own fire/reload.**

`tutorialFrames(weapon) → string[]` — a deliberately reduced arm, differing from `armFrames` by:

| | Real arm (`armFrames`) | Tutorial arm (`tutorialFrames`) |
|---|---|---|
| Volume | `$VOL,69` | `$VOL,69` (audible — the try-out exists to *hear* fire+reload; MC §6b) |
| Game start | `$START` + `$PLAY,VA81` game-start voice | **no `$START`, no start voice** (the `$SPAWN` chirp is silenced by `$PLAYX,0`) |
| Team | `$TID,<team>` | **no scoring `$TID`** — but the gun still lights a colour (a spawned gun always shows one; `0`=RED default, exp-log) — no friend/enemy is wired |
| `$GSET` | full game settings | minimal (indoor, FF off) so a stray shot is inert |
| Weapon slots | primary+secondary+melee | **the single tried weapon in slot 0 only** |
| `$SIR` / scoring | full incoming-IR table | omitted — incoming hits do nothing |
| Sound | full weapon+voice pack | just the weapon's own fire/reload sounds (tokens 27,31–33) |

Sequence (silent single-weapon try-out):

```
$VOL,69,0,*                     ; audible — the try-out is to be heard (MC §6b)
$CLEAR,*                        ; wipe any prior arm
$GSET,0,<outdoor>,1,0,1,0,50,1,* ; FF off, env from config; NO $START
$WEAP,0,<catalog tail for weapon> ; the one weapon, slot 0
$SPAWN,,*                       ; make it live so the trigger works (self-plays the "GET SOME" spawn voice)
$PLAYX,0,*                      ; silence that spawn chirp (exp-log: confirmed no voice) — as in END_SEQUENCE
$AMMO,0,<mag>,<reserve>,1,*     ; loadout-correct ammo to feel reloads
$BMAP,0,0,,,,,*                 ; trigger + reload handle armed
```

- **Enter:** node is in `KITTED` (contracts §6). Tutorial is a transient overlay — the node records
  it was tutoring and does **not** report events (§4) upstream (a try-out shot is not a game shot).
- **Exit (clean):** on the next `tutorial{weapon}` (re-arm the new weapon), or on `config`/`start`
  (the lobby `config{GameConfig}` push — separate from `assign` per contracts A2 — or the arm that
  overwrites slots), or on a `control{cmd:"end"}`.
  A bare exit with no follow-up sends `$CLEAR,*` then `$PLAYX,0,*` to silence and disarm.
- **Panic still applies:** `$CLEAR,*` then `$SP,99,*` at any time.
- Dropping `$PLAY,VA81` (the game-start voice) and the scoring `$TID` is the whole trick — those are
  what make a real arm *feel* like a game starting; without them the try-out feels like a dry-fire
  range. The `$SPAWN` chirp is muted by `$PLAYX,0`; the gun still pulses a colour (a spawned gun
  always shows one — exp-log), but no friend/enemy scoring is wired.

## 5. Voice sets → sound-bank / $PSET

`Player.voice` (contracts §2) selects a **voice family**; M-MODES maps it to the positional voice-pack
tail of `$PSET` (protocol-classes §PSET: `maxHP,maxShields,critBonus,` then the ordered sound slots
`deathAlarm,…,deathScream,battleRespawnCry,…,painRelief,…`). The `gameconfig.py` `_PSET_TAIL` is the
male (`VA`) pack today; a voice set swaps the `V*`-family ids in those slots.

Families come from `sound-bank.md` §Voice prefixes — each provides a consistent slot set (move line,
~4 gasps, ~3 death screams, kill line):

| voice value | family | example ids |
|---|---|---|
| `male` (default) | VA | move `VAQ`, death `VA3/4/5`, kill `VAA` |
| `female` | VM / VD | (clean female / female sniper) |
| `scout` | VB | move `VBI`, death `VB3/4/5`, kill `VBA` |
| `heavy` | V3 | respawn `V3I` "Get Some", gasps `V3G/H/E/F`, death `V33/34/35` |
| `medic` | V8 | `V8W`, death `V83/84/85`, kill `V8S` |
| `valkyrie` | VH | `VHT` "weapons hot", kill `VHR` |
| … | VC/VE/VJ/VK/VN/VQ/VR/… | the full character/faction set (Sentinel, Viper, Wraith, Nexus…) |

- `voiceOptions() → VoiceSet[]` exposes `{id, label, family, sample_id}` for M-MC (the app offers
  only male/female; **we offer the full pack** — callsign-ui §UX, followup B14/P3).
- `pset(config, voice) → "$PSET,…"` substitutes HP/armor/shield (tokens 3–5) **and** the voice
  family into the tail. The exact per-slot id map per family is **partially known** (the examples
  above); families beyond VA are pinned by the server `voice-profiles` endpoint or a one-profile BLE
  capture (apk-harvest §voice). Ship VA fully, others as best-effort with the known kill/death lines.

## 5b. Medal catalog & feedback sounds

`ScoreRow.medals[]` (contracts §4) is filled from M-MODES' **medal catalog**; M-MC's recap consumes it.
M-MODES owns the award *rules* — MC hands it the final `ScoreRow[]` + `Kill[]`, and gets back the medal
ids each player earned. Names track the stock BRX set (`callsign-extract/game-medals-config.json`) so a
recap reads familiar; the predicates are ours. One winner per medal per game unless the row says per-player.

```jsonc
Medal { medal_id: string, name: string, predicate: string }   // ScoreRow.medals[] carries medal_id
```

| medal | award predicate (per game) |
|---|---|
| **MVP** | top score (`kills − deaths`; tie → higher K/D) across all players |
| **Top Gun** | most `kills` |
| **Highest K/D** | highest `kd` (floor: min deaths/shots so a 1–0 isn't crowned) |
| **Sharp Shooter** | highest `accuracy`, above a min-shots threshold |
| **Survivalist** | fewest `deaths` |
| **First Blood** | first `Kill` by `t` in the match (one-shot) |
| **Double / Triple Kill** | any player with a `Kill` where `multi ≥ 2` / `≥ 3` (within `MULTI_KILL_MS`, contracts §9) — **per-player, repeatable** |

Stock BRX carries ~21 medals (Trigger Happy, Grave Lover, Assistant, Ninja, streak tiers…); the full
key→name map is in `game-medals-config.json`. The table above is the launch subset M-MODES scores from
**node-observable events** — objective/headshot/melee medals need a P2 source (station/IR-decode) and
stay out until then.

**Feedback sounds** — `feedbackSound(kind)` is the lookup M-NODE's `feedback()` uses to turn a
`feedback{kind}` (contracts §5) into `$SFLASH` (green sight) + a token-4 `$PLAY,<id>`:

| kind | sound id | source |
|---|---|---|
| `kill` | `VAA` | VA-family kill line (§5 / sound-bank); id swaps with the player's voice set |
| `multi` | *native* | the gun's firmware announces "double/triple kill" itself (exp-log 2026-08) — no host `$PLAY` needed; any id we add is **provisional** |
| `medal` | **provisional** | no confirmed medal SFX id in the sound bank yet — mark unverified until captured |

## 6. LED / environment — the `led` object

`GameConfig.led?` (contracts §3, "M-MODES defines shape"). Environment is three combos over two
knobs — `environment` (indoor/outdoor) and `night` — plus explicit LED control:

```jsonc
led {
  mode:   "team" | "off" | "custom",   // team = $TID-derived colour (default)
  effect: "solid" | "glow" | "chase" | "stopIR",  // GLED effect enum (protocol-classes)
  brightness?: number,                 // 0–100 if supported (UNCONFIRMED)
}
```

| Environment | `environment` / `night` / `led` | Frames |
|---|---|---|
| **Indoor** | `indoor` / false / `{mode:"team"}` | `$GSET,…,outdoorMode=0,…`; LED = team colour via `$TID` (no `$GLED`) |
| **Outdoor (day)** | `outdoor` / false / `{mode:"team"}` | `$GSET,…,outdoorMode=1,…` (longer IR range profile) |
| **Night** | `outdoor` / true / `{mode:"off"}` | `$GSET` outdoor + LED-off `$GLED` — **⚠ UNCONFIRMED** (`_led_frames` best-effort `$GLED,0,4,…`, followup P17) |

- LED colour is **team-derived** (`$TID` → firmware picks blue/yellow/red/green); we do **not** send
  r,g,b (`$GLED` is `mid,effect,optionA,optionB`, protocol-classes §GLED). "Off" is the only
  non-team state we attempt, and it is unverified — `night` drives the node's HUD blackout regardless
  (that part is reliable; the gun LED-off is the risky bit).
- `is_night_mode() = outdoor && led.mode=="off"` (mirrors `gameconfig.is_night_mode`). Night also
  informs M-NODE's glare/blackout HUD (README §7).

## 7. Interface M-MODES exposes

The frozen surface other lanes bind to (never reach into `gameconfig.py` internals):

```
// Config
fromWire(json)            -> GameConfig        // contracts §3 JSON → compiler dataclass
toWire(GameConfig)        -> json              // round-trips; toWire(fromWire(x)) == x
GameConfig.builder()      -> fluent authoring  // mode + env + respawn + scoring + health + teams + led
GameConfig.validate()     -> {ok, errors[]}    // e.g. dup team tid, mode needs station, bad weapon_id

// Frames (pure; no clock, no BLE)
armFrames(config, player) -> string[]          // setup_frames ++ player_frames(player.team.tid), vol 69
setupFrames(config)       -> string[]          // per-game (team-invariant)
spawnFrames(config, player) -> string[]        // initial arm: player_frames ($SPAWN + loadout $AMMO + $BMAP)
reviveFrames(config, player) -> string[]       // respawn re-arm (loadout-correct $AMMO); node.md binds this on respawn
tutorialFrames(weapon)    -> string[]          // §4 silent single-weapon try-out
endFrames()               -> string[]          // game-over teardown (END_SEQUENCE)
panicFrames()             -> ["$CLEAR,*","$SP,99,*"]

// Data
WeaponCatalog.all()       -> Weapon[]          // §3 roster (for M-MC visual select)
WeaponCatalog.resolve(id, slot) -> string      // "$WEAP,<slot>,<tail>"
WeaponCatalog.spawnAmmo(id) -> [mag, reserve]
voiceOptions()            -> VoiceSet[]         // §5, {id,label,family,sample_id}
medalCatalog()            -> Medal[]            // §5b award rules (for M-MC recap)
feedbackSound(kind)       -> string             // §5b  kind ∈ kill|multi|medal → $PLAY sound id
```

- **Every frame emitter is on the known-safe list** (`protocol.py`); unknown commands need explicit
  confirm (house rule). M-MODES never emits a frame outside `armFrames`/`setup`/`spawn`/`revive`/
  `tutorial`/`end`/`panic`.
- Frames are **strings, verbatim** — M-NODE chunks at 20 bytes (contracts §8) and writes; it never
  parses or edits them. This keeps the frame authority in one place.

## 8. Task breakdown

1. **Wire↔compiler bridge** — `fromWire`/`toWire` mapping contracts §3 GameConfig ↔ `gameconfig.py`
   dataclass; property test the round-trip. Fold `scoring`/`respawn`/`led`/`environment` onto the
   flat dataclass fields.
2. **WeaponCatalog data** — encode the §3 table as `weapons.json` (+ loader); template `weap_frame`
   from `ar`/`charge`, substitute stat tokens; `verified` flag per entry; `resolve`/`spawnAmmo`.
3. **`armFrames(config, player)`** — player-scoped wrapper over `setup_frames + player_frames`;
   resolve loadout weapons through the catalog; default volume 69; unit-test frame order vs a golden.
4. **`tutorialFrames(weapon)`** — §4 reduced sequence + enter/exit/panic semantics; test it omits
   `$START`/`$TID`/`$SIR` and never emits an event upstream.
5. **Voice sets** — `voiceOptions()` + `pset(config, voice)`; encode the known families; VA complete,
   others best-effort; capture-plan doc for the unknown per-slot ids.
6. **`led` object** — parse into `outdoor`/`leds` + effect; wire the 3 environment presets; keep the
   night `$GLED` path flagged UNCONFIRMED.
7. **Mode schema validation** — `validate()`: dup `tid`, station-gated modes, unknown `weapon_id`,
   FFA-forces-FF, LMS-vs-respawn coherence.
8. **Mocks/fakes** — a `FakeCatalog` + sample `GameConfig`s so M-NODE/M-MC build without live data.

## 9. Open questions

- **WEAP token pinning** — ~15 roster weapons are templated, not captured. Which stat tokens are
  safe to interpolate vs need a per-weapon frame? (One-field Callsign capture settles it —
  protocol-classes §WEAP.) Until then, ship `verified:false` + fall back to `ar` behaviour.
- **primaryDamageType vs primaryPowerType order (tok 3/4)** — unresolved in the teardown; both read
  0 on the AR. A one-field capture decides. Low risk for standard weapons.
- **Voice per-slot map** beyond VA — do we pull the `voice-profiles` endpoint (apk-harvest) or
  capture-diff each family? Endpoint is faster if reachable offline-cached.
- **Night LED-off (P17)** — `$GLED` "off" is a guess; `$TID` may always drive some LED. Verify on
  hardware before promising a dark gun; HUD blackout is independent and reliable.
- **Max native team count** — 2+3 confirmed; N-team (duos/trios with hardware FF) UNTESTED. Affects
  how many `Team.tid` values the mode schema may legally emit.
- ~~**Tutorial `$TID`** — omit entirely or send `$TID,0`?~~ **RESOLVED (exp-log):** there is no
  "no team" colour — a spawned gun always shows one (`0`=RED default). Send no scoring `$TID`; the
  try-out still fires inertly (no `$SIR`/no FF) and the leftover colour is cosmetic (§4).
- **Shield pool (P16)** — inactive until activated; `$PSET` shield token stays best-effort. Health
  overrides use armor+HP only for now.

