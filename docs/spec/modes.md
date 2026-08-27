# M-MODES — mode catalog, config authoring, weapon catalog, the frame compiler, tutorial arming

- **Status:** Draft (Wave 1, parallel), **bound to contracts A6**. Binds to `contracts.md` §3
  (GameConfig + `FrameBundle` + WeaponCatalog), §8 (frame contract), A4.2 (frames compiled by MC).
  Owner of the `M-MODES` lane in `README.md` §4 (phases 2 / 3a / 4).
- **Runs in MC (Python).** M-MODES is the **frame compiler**: it wraps `mcp/brx_mcp/gameconfig.py`
  (config→frame builder) + `mcp/brx_mcp/modes/` (pure rules engines). **Nodes never call it** — a
  phone (JS) or Companion (C++) writes the compiled `FrameBundle` verbatim. One frame authority, one
  runtime that compiles.
- **Ground truth (link, don't restate):** `protocol/brx-protocol.md` (§7e arm, §7p/§7q player id,
  §7o feedback), `protocol/callsign-extract/protocol-classes.md` ($WEAP/$GSET/$PSET token maps),
  `protocol/callsign-extract/sound-bank.md` (voice families), `docs/game-modes.md` (mode catalog),
  `docs/reference/callsign-ui.md` (the operator-facing knob set + weapon roster).

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
 │ mode author  ├───────►│ GameConfig  (contracts §3)          ├────────────►│ WS  ├─►│ node     ├──────► gun
 │ + kit-out    │        │  ├─ WeaponCatalog.resolve()         │  in `config`│     │  │ writes   │
 └──────────────┘        │  ├─ voiceSet → $PSET tail           │  (per       └─────┘  │ verbatim │
        ▲                │  ├─ player_num → $PSET token 1      │   player)            └──────────┘
        │ WeaponCatalog  │  └─ compile(config, player)         │
        └── (visual      └────────────────────────────────────┘
             weapon select data)
```

Two GameConfig representations, one meaning:

- **Wire form** — the `contracts.md` §3 JSONC object (`mode`, `environment`, `night`, `time_limit_s`,
  `respawn`, `scoring`, `health`, `teams`, `led?`, …). This crosses the LAN in the **`config`** message
  (and in `welcome` on reconnect) **together with the compiled `FrameBundle`** — not `assign`, which
  carries only the `Player`/`Team`/roster (contracts §5).
- **Compiler form** — the `gameconfig.py` `GameConfig` dataclass (every knob mapped to its frame).
  M-MODES provides `fromWire(json) → GameConfig` and `toWire(GameConfig) → json` so the two stay
  in lockstep. The dataclass is a superset (it carries objective/extraction knobs the base wire
  shape folds into `scoring`/`led`/mode-specific extras); unknown wire fields are ignored (§9
  additive rule), and compiler-only knobs default.

### 1.1 `compile(config, player) → FrameBundle` — the per-player build

There is **no team-invariant setup any more**: `$PSET` token 1 is the player's `player_num`
(**1–63**, contracts §2 A5.1, protocol §7p — wire **0 is reserved** for "no identity"), so the config head is **per player**. `compile` maps today's
`gameconfig.py` builders onto the contracts §3 `FrameBundle` fields exactly like this:

| bundle field | built from (`gameconfig.py`) | contents / rules |
|---|---|---|
| `head` | `setup_frames()` **minus its trailing `$PLAYX,0` + `$PLAY,VA81`**, then `$TID,<player.team.tid>` | `$VOL,69,0` → `$CLEAR` → `$START` → `$GSET` → **`$PSET,<player_num>,0,<HP>,<armor>,<shield>,…`** → `$WEAP` ×3 (loadout slots via `WeaponCatalog.resolve`, melee in slot 4) → `$SIR` ×10 → `$BMAP` ×7 → LED frames → `$TID`. **Silent by construction** — the lobby push must not count down. **Never contains `$SPAWN`.** ⚠ Whether the `$START` inside `head` is *audible* at the lobby write is **UNVERIFIED** (tonight's bench wrote a head with no report of sound, but nobody was listening for it — §9). |
| `spawn` | `["$PLAYX,0,*"] + spawn_frames()` | `$PLAYX,0` → `$SPAWN,,` → `$AMMO,<slot>,<mag>,<reserve>,1` per loaded slot → `$BMAP,0,0`. The T-0 tail (M-START §3 wraps it with `VA81` + `$SFLASH`). |
| `revive` | `["$SPAWN,,*"] + the $AMMO frames of spawn_frames()` | Respawn re-arm. **Replaces today's `RESPAWN_SEQUENCE` (`$HLOOP,0,0` + `$SPAWN`)**: protocol §7f shows `$SPAWN,,` already restores the magazine (`$LCD …,36,216`), the explicit `$AMMO`s make the *reserve* loadout-correct after a mid-life reload, and `$HLOOP,0,0` is a headset-LED blanking side effect that belongs in `end`, not in a mid-match revive. |
| `end` | `END_SEQUENCE` | `$SPAWN,,` → `$PLAYX,0` → `$STOP` → `$CLEAR` → `$HLOOP,0,0` → `$HLED,0,0,0,0,0,0` (revives a dead gun so it isn't stuck in death-glow, silences the spawn voice, blanks the headset; `$TID` deliberately untouched — exp-log 2026-08-25). The node then plays **`cues.game_over`** so the match audibly ends (A5.10). |
| `panic` | `PANIC_SEQUENCE` | `$CLEAR,*` → `$SP,99,*` |
| `team_flip?` | `$TID,<tid>` (+ `revive`) per other team | **infection** only: the frames that move *this* gun to the infected team on death. Node writes `team_flip[<tid>]` then `revive` and emits a **`team_change{tid}`** fact (contracts §4, A5.8) so MC's roster follows the gun. |
| `cues` | `sounds.py` `Cue`s, voice-family aware (§5) | `countdown: "VA81"` (**confirmed**), `kill` (`VAA`/`V3A` family kill line, **confirmed**), **`game_over`** (Callsign's end: `$PLAY,VSF,4,6,JAY,,,,*` — `VSF` sting on slot 1 + `JAY` outro on slot 4, §7o; **provisional until pinned by ear**), `tick`/`klaxon`/`multi`/`medal` **provisional** (real bank ids, meaning by-ear). **A6.3: every value is a pre-composed `$PLAY,…,*` frame** (the compiler decides token-1 SFX vs token-4 announcer); the node writes it verbatim. |

- `_PSET_HEAD` becomes `["PSET", str(player_num), "0"]` with `player_num ∈ 1..63` — **token 2 stays `0`**; it
  has read `0` in every capture and its meaning is unknown (§9). Token 1 = `0` is written **only** by
  `tutorialFrames` (§4): "no identity", which MC never credits — consistent with contracts A5.1.
- HP/armor/shield come from `health` (or `player.loadout.overrides`); the voice tail from `player.voice`
  (§5). Volume is **69** for play (30 is inaudible — house rule); the low `$VOL,30` default stays for
  bench probing only.
- Nothing in `compile` reads a clock or the network — the dispersed-start timing (M-START) wraps
  `spawn`, it does not live inside it.
- `compile` is re-run (and the bundle re-pushed) whenever `player.loadout`, `player_num`, `team` or
  `voice` changes after the lobby push (contracts §5 `config`).

## 2. Mode catalog → config schema

`docs/game-modes.md` is the **infrastructure-tier catalog** (what gear each mode needs). This
section is the **config schema** for the five modes M-MODES ships as `mode` values — how each mode's
knobs sit in `GameConfig`, which map to *frames* vs the *host engine*, and — new in A4.8 — **which
end condition actually reaches a dispersed node**. The gun keeps **no game state** (no mode/clock/
score/respawn — protocol §7n); mode logic is host-side, and only the combat-surface knobs (weapon,
team, player id, HP, FF, crit, indoor/outdoor, LED) become frames.

**End-condition reachability (A4.8).** On a large field most nodes are out of LAN range for most of
the match. The only end that reaches every node is the **local time-expiry** at `go_live_t +
time_limit_s` (M-NODE §3.9), so **`time_limit_s` is required**. Every other end — frag limit,
last-alive, last-human, extraction target — is *decided by MC* from reconciled events and delivered
as `control{end}` **best-effort**: nodes in coverage stop early, dispersed nodes keep playing until
the time limit. Modes list both below; hosts should read "score-to-win" as "in-coverage early end".
`time_limit_s == null` is legal **only** when `validate(roster, {coverage: "full"})` is asserted by the host
(a fully LAN-covered venue); then there is **no local expiry** and the match ends only on `control{end}`.

| `mode` | Engine (`modes/`) | Config knobs that matter | → Frames | → Host engine | End that reaches everyone / in-coverage early end |
|---|---|---|---|---|---|
| **tdm** | `deathmatch.py` | `teams[]` (2), `time_limit_s`, `scoring.frag_limit`, `respawn`, `health`, `friendly_fire` | `$TID` per team, `$PSET` player id + HP/armor, `$GSET` FF, `$WEAP` loadout | exact per-player kills/assists (`$HIR` tok3), respawn timer, team-kill scoring | time limit / `frag_limit` (MC → `end`) |
| **ffa** | `deathmatch.py` (FFA path) | **one `$TID`, FF forced ON, distinct `player_num`s**, `time_limit_s`, `scoring.frag_limit` | `$TID` all-same, `$GSET` friendlyFire=1, `$PSET,<player_num>` | **exact 1:1 attribution** — every hit names the shooter (P2 closed, protocol §7q). **Never friendly** (contracts A5.2: friendly is roster-team-based and disabled in FFA — `$TID` equality must not score −1). **Winner = top `ScoreRow`**, not team kills. | time limit / `frag_limit` (MC → `end`) |
| **infection** | `survival.py` | starting infected count, `respawn` (auto), `time_limit_s` | `$TID` (human vs infected); **`team_flip[<infected tid>]`** in the bundle | **node-local**: a killed human writes `team_flip` + `revive`, emits **`team_change{tid}`** (A5.8), and is infected — works offline; MC updates the roster from `team_change` and tallies last-human. ⚠ Whether a **mid-match `$TID` write changes the gun's own friendly-fire resolution** is **UNTESTED** (§9). | time limit / last-human (MC → `end`) |
| **lms** | `lms.py` | `scoring.win_by:"survival"`, lives (`respawn.type:"none"` or finite), `time_limit_s` | `$PSET` HP; no `revive` after last life | lives counter (node-local), last-alive (MC) | time limit / last-alive (MC → `end`) |
| **extraction** | `extraction.py` (+ adapter) | `channel_s`, `win_target`, `loot_per_kill`, `drop_policy`, `extract_removes_player`, `time_limit_s` | base combat frames + `$LIFE`/`$WEAP` boost writes on bank (coverage-only) | loot wallet, loud channel, drop-on-death, bank→boost — all MC-side, so **coverage-zone gameplay** | time limit / `win_target` (MC → `end`) |

Notes that shape the schema:

- **Teams → `$TID`.** `Team.tid` (contracts §2) is the numeric id written as `$TID,<tid>`. **`$TID` is
  team + LED colour + friendly-fire class, nothing else** — per-player identity is `$PSET` token 1
  (contracts A4.1), so the old "unique `$TID` per player for FFA" workaround is **retired**. Native
  hardware fired `$TID,1`/`$TID,2` in 2-team play; `$TID,0`=RED seen in teardown; **3+ hardware teams
  UNTESTED** — that is now purely a duos/trios question (§9), not an attribution one.
- **Player id → `$PSET` token 1.** `player_num` **1–63**, displayed as-is (wire 0 reserved, A5.1). MC assigns; `compile` writes it;
  `$HIR` token 3 reports it to every victim (protocol §7q). Uniqueness across the roster is a
  `validate()` rule (§7).
- **Respawn** (`respawn.type`): `auto` = node timer (`delay_s`, optional ramp 15/30/45/90) → writes
  `revive`; `scanner` = respawn at a station/grenade (node defers to the objective device, B12);
  `none` = LMS. No gun token exists — the node owns the delay.
- **Objective modes** (domination/koth/ctf/cs) are in `gameconfig.py`/`modes/` but need a station
  event source (Tier 1). They are **out of M-MODES' arming scope** here — the engines exist; M-MODES
  only guarantees the *combat* bundle. List them as valid `mode` strings, mark station-gated.
- **Health variants** (syphon/regen) are `GameConfig` booleans that add **host-driven** `$LIFE`
  writes at runtime (additive, clamped — exp-log #33); they are not arm-time frames. They reach a node only via
  the MC→node **`apply{frames}`** kind (contracts A6.4) — i.e. **coverage-zone only** on the phone path. Syphon now
  routes the heal to the **exact killer** (`$HIR` tok3) — but only when that killer's node is in
  coverage to receive it.

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
- `WeaponCatalog.resolve(weapon_id, slot) → "$WEAP,<slot>,<tail>"` (called inside `compile`, §1.1) —
  **as built, the base is the weapon's OWN captured Callsign frame**, not a shared template, and only
  the balance tokens are overwritten: `{damage}`/`{fire interval}`/`{mag}`/`{reserve}`/`{reload}` at
  tokens **5 / 14 / 16+39 / 17+40 / 18**. Sounds (27, 28–29, 31–34) come from the capture, so no weapon
  defaults to the AR block any more.
  > ⚠ **Corrected 2026-08-26.** This line previously read "tokens 5/15/16/40/18". **Token 14 is the
  > fire interval** — bench-proven by a one-field flip; token 15 is an unidentified constant (850 in
  > every captured frame) and must never be written. **Reserve is token 17**; token 40 is a
  > half-reserve that every captured frame keeps at `t17 == 2 × t40`. See `docs/weapon-design.md`
  > appendix for the full written/not-written table.
- `spawnAmmo(weapon_id) → (mag, reserve)` drives the `$AMMO` frames in `spawn`/`revive` — ammo comes
  from the **selected** weapon, never hardcoded (already true in `gameconfig.py`).
- **Melee** is always loaded to slot 4 (the app does; `gameconfig.py` matches). Catalog carries it as
  a hidden entry, not offered in the visual picker.

**Provenance discipline:** each entry tags `verified: true|false`. Only `ar`/`charge` (and the
`primary`/`secondary`/`melee` fired frames) are `true`; the other ~15 ship `false` and are pinned by
a targeted Callsign capture (change one field, diff the frame — protocol-classes §Method).

## 4. Tutorial arming (phase 3a) — private try-out, compiled by MC

When the host changes a player's weapon at kit-out, M-MC calls `tutorialFrames(weapon, environment)`
and sends the node **`tutorial{weapon, frames}`** (contracts §5) — the node writes `frames` verbatim,
it does not compile. The gun arms **that one weapon, privately**, so the player can pull the trigger
and reload to *feel* it — **no game starts, no scoring team, audio limited to the weapon's own
fire/reload** (audible — "silent" means *no announcements*, not muted).

`tutorialFrames(weapon, environment) → string[]` — a deliberately reduced arm, differing from the
real `head`+`spawn` by:

| | Real arm (`compile`) | Tutorial arm (`tutorialFrames`) |
|---|---|---|
| Volume | `$VOL,69` | `$VOL,69` (audible — the try-out exists to *hear* fire+reload; MC §6b) |
| Game start | `$START`; `$PLAY,VA81` in the T-0 tail | **no `$START`, no start voice** (the `$SPAWN` chirp is silenced by `$PLAYX,0`) |
| Player id | `$PSET,<player_num>,…` | `$PSET,0,…` — no identity; a stray try-out hit reports shooter 0, which MC never credits |
| Team | `$TID,<team>` | **no `$TID` written** — the gun keeps its **last `$TID` colour** (a spawned gun always shows one; teardown doesn't reset it) — no friend/enemy is wired |
| `$GSET` | full game settings | minimal (env from `environment`, FF off) so a stray shot is inert |
| Weapon slots | primary+secondary+melee | **the single tried weapon in slot 0 only** |
| `$SIR` / scoring | full incoming-IR table | omitted — incoming hits do nothing to *this* gun |
| Sound | full weapon+voice pack | just the weapon's own fire/reload sounds (tokens 27,31–33) |

Sequence (single-weapon try-out):

```
$VOL,69,0,*                       ; audible — the try-out is to be heard (MC §6b)
$CLEAR,*                          ; wipe any prior arm
$GSET,0,<outdoor>,1,0,1,0,50,1,*  ; FF off, env from `environment`; NO $START
$PSET,0,0,45,70,70,50,,<voice tail>,*  ; identity 0
$WEAP,0,<catalog tail for weapon> ; the one weapon, slot 0
$SPAWN,,*                         ; make it live so the trigger works (self-plays the spawn voice)
$PLAYX,0,*                        ; silence that spawn chirp (exp-log: confirmed no voice) — as in END_SEQUENCE
$AMMO,0,<mag>,<reserve>,1,*       ; loadout-correct ammo to feel reloads
$BMAP,0,0,,,,,*                   ; trigger + reload handle armed
```

- **Enter:** node is in `KITTED` (contracts §6). Tutorial is a transient overlay — the node records
  it was tutoring and does **not** report events upstream (a try-out shot is not a game shot).
- **Exit (clean):** on the next `tutorial{…}` (re-arm the new weapon), or on `config` (the lobby
  bundle's `head` overwrites everything), or on `control{end}` — the node writes `frames.end` if it
  already holds a bundle, else `$CLEAR,*` then `$PLAYX,0,*` to silence and disarm.
- **Panic still applies:** `$CLEAR,*` then `$SP,99,*` at any time.
- **⚠ Bench-unverified safety point:** the try-out gun *emits* real IR. Other kitted players' guns are
  either unconfigured (CONNECTED/KITTED — inert) or hold a written `head` but are **unspawned** (LOBBY).
  Whether an **unspawned-but-configured gun takes damage** from a try-out shot is **untested** (§9).
  Until confirmed, MC disables try-outs once any node is in LOBBY, and the kit-out UI says "point
  away from other players".
- Dropping `$PLAY,VA81` (the game-start voice), `$START` and the scoring `$TID`/`$PSET` id is the whole
  trick — those are what make a real arm *feel* like a game starting; without them the try-out feels
  like a dry-fire range.

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
- `pset(config, voice, player_num) → "$PSET,…"` writes `player_num` at token 1, substitutes
  HP/armor/shield (tokens 3–5) **and** the voice
  family into the tail. The exact per-slot id map per family is **partially known** (the examples
  above); families beyond VA are pinned by the server `voice-profiles` endpoint or a one-profile BLE
  capture (apk-harvest §voice). Ship VA fully, others as best-effort with the known kill/death lines.

## 5b. Medal catalog & feedback cues

`ScoreRow.medals[]` (contracts §4) is filled from M-MODES' **medal catalog**; M-MC's recap consumes it.
M-MODES owns the award *rules* — MC hands it the final `ScoreRow[]` + `Kill[]`, and gets back the medal
ids each player earned. Names track the stock BRX set (`callsign-extract/game-medals-config.json`) so a
recap reads familiar; the predicates are ours. One winner per medal per game unless the row says per-player.
**Attribution is exact (A4.1)**, so every medal below is per-player with no caveat.

```jsonc
Medal { medal_id: string, name: string, predicate: string }   // ScoreRow.medals[] carries medal_id
```

| medal | award predicate (per game) |
|---|---|
| **MVP** | top score (`kills − deaths`; tie → higher K/D) across all players |
| **Top Gun** | most `kills` |
| **Highest K/D** | highest `kd` (floor: min deaths/shots so a 1–0 isn't crowned) |
| **Sharp Shooter** | highest `accuracy` (victims' shooter-tagged **non-friendly** `hit_taken` ÷ `status.shots`, A5.2), above a min-shots threshold |
| **Survivalist** | fewest `deaths` |
| **First Blood** | first `Kill` by `t` in the match (one-shot) |
| **Double / Triple Kill** | any player with a `Kill` where `multi ≥ 2` / `≥ 3` (within `MULTI_KILL_MS`, contracts §9) — **per-player, repeatable** |
| **Assistant** | most `Assist`s (`ASSIST_WINDOW_MS`) |

Stock BRX carries ~21 medals (Trigger Happy, Grave Lover, Ninja, streak tiers…); the full key→name map
is in `game-medals-config.json`. Objective/headshot/melee medals need a station/IR-effect source and
stay out until then.

**Feedback cues — shipped in the bundle, not looked up on the node.** `cues(voice)` produces the
`FrameBundle.cues` block (contracts §3); the node turns MC's `feedback{kind, t, cue?}` into `$SFLASH,*` +
the pre-composed `cues[kind]` frame (or the frame carried in `cue`) — A6.3, no id lookup on the node:

| cue | id | source / status |
|---|---|---|
| `countdown` | `VA81` | **confirmed** 3-2-1-GO (2.97 s); M-START fires it at T-3 |
| `kill` | `VAA` / family kill line (`V3A` = "kill") | **confirmed** on hardware (§7o, G3); swaps with the player's voice set |
| `multi` | host `$PLAY`, id **provisional** | native multikill audio is nRF-peer, silent under BLE config (ADR-0001 #4) — MC announces it |
| `medal` | **provisional** | no confirmed medal SFX id yet |
| `game_over` | `VSF` + `JAY` (Callsign's end frame `$PLAY,VSF,4,6,JAY,,,,*`, §7o) | **provisional** until pinned by ear; played by the node after `frames.end` (A5.10) |
| `tick` / `klaxon` | **provisional** (`U16` tick candidate) | M-START runway dressing; real bank ids, meaning by-ear |

Feedback is **best-effort and coverage-zone-only on the phone path** (contracts §5 field reality):
it needs the victim's `death` to reach MC *and* MC's `feedback` to reach the shooter, which on a large
field happens at bases/recap, not mid-field. MC also drops any `feedback` older than
`FEEDBACK_MAX_AGE_MS` — a kill flushed minutes later scores but never flashes a sight late.

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

The frozen surface other lanes bind to (never reach into `gameconfig.py` internals). **All of it runs
in MC**; M-NODE binds only to the `FrameBundle` / `tutorial.frames` *data* it receives (contracts §3).

```
// Config (M-MC)
fromWire(json)            -> GameConfig        // contracts §3 JSON → compiler dataclass
toWire(GameConfig)        -> json              // round-trips; toWire(fromWire(x)) == x
GameConfig.builder()      -> fluent authoring  // mode + env + respawn + scoring + health + teams + led + time_limit
GameConfig.validate(roster, opts?) -> {ok, errors[]}
   // rules: time_limit_s required (> 0) unless opts.coverage == "full"; player_num unique + 1..63 across
   //        the roster (≤ MAX_PLAYERS = 63; wire 0 reserved, A5.1); dup team tid; ffa ⇒ one tid + friendly_fire on; lms ⇔ respawn none/
   //        finite lives; station-gated modes rejected without a station source; unknown weapon_id.

// Frames (pure; no clock, no BLE) — the compiler
compile(config, player)   -> FrameBundle       // §1.1: head | spawn | revive | end | panic | team_flip? | cues
tutorialFrames(weapon, environment) -> string[] // §4 single-weapon try-out (carried in `tutorial{frames}`)
cues(voice)               -> Cues              // §5b {key: pre-composed $PLAY frame} (countdown/kill confirmed; game_over + rest provisional) — A6.3

// Data
WeaponCatalog.all()       -> Weapon[]          // §3 roster (for M-MC visual select)
WeaponCatalog.resolve(id, slot) -> string      // "$WEAP,<slot>,<tail>"  (used by compile)
WeaponCatalog.spawnAmmo(id) -> [mag, reserve]
voiceOptions()            -> VoiceSet[]         // §5, {id,label,family,sample_id}
medalCatalog()            -> Medal[]            // §5b award rules (for M-MC recap)
awardMedals(rows, kills)  -> {player_id: medal_id[]}
```

- `setup_frames`/`spawn_frames`/`player_frames`/`END_SEQUENCE`/`PANIC_SEQUENCE` are **internals of
  `compile`** (`gameconfig.py`), not a public surface — nobody outside M-MODES assembles a frame list.
- **Every frame emitter is on the known-safe list** (`protocol.py`); unknown commands need explicit
  confirm (house rule). M-MODES never emits a frame outside `compile`/`tutorialFrames`.
- Frames are **strings, verbatim** — M-NODE chunks at 20 bytes (contracts §8) and writes; it never
  parses or edits them. Its only self-composed frames are the three contracts §3 templates
  (`$PLAY` two-slot from `cues`, `$SFLASH,*`, `$PLAYX,0,*`). This keeps the frame authority in one place.

## 8. Task breakdown

1. **Wire↔compiler bridge** — `fromWire`/`toWire` mapping contracts §3 GameConfig ↔ `gameconfig.py`
   dataclass; property test the round-trip. Fold `scoring`/`respawn`/`led`/`environment`/`time_limit_s`
   onto the flat dataclass fields.
2. **`player_num` in `$PSET`** — `_PSET_HEAD` takes the id (1–63; token 2 stays `0`); `pset(config,
   voice, player_num)`; wire-level test pins `$PSET,6,0,45,70,70,…` for player 6 and rejects 0 / >63.
3. **WeaponCatalog data** — encode the §3 table as `weapons.json` (+ loader); template `weap_frame`
   from `ar`/`charge`, substitute stat tokens; `verified` flag per entry; `resolve`/`spawnAmmo`.
4. **`compile(config, player)` + golden tests** — assemble the §1.1 bundle; goldens assert: `head` has
   **no `$SPAWN` and no `$PLAY,VA81`**, ends with `$TID,<tid>`, carries `$PSET,<1..63>`; `spawn`
   starts `$PLAYX,0` and ends `$BMAP,0,0`; `revive` = `$SPAWN,,` + loadout `$AMMO`s; `end` =
   `END_SEQUENCE`; `panic` = `PANIC_SEQUENCE`. Update `gameconfig.py`'s `RESPAWN_SEQUENCE` users.
5. **`team_flip`** — infection: per-other-team `$TID` frames; sim test that a killed human's bundle
   moves it to the infected tid **and** that the node's `team_change{tid}` fact re-teams it in MC's roster.
6. **`cues(voice)`** — the cue block from `sounds.py` incl. `game_over`; `test_sounds.py` asserts every id is a
   real bank id; confirmed vs provisional tagged.
7. **`tutorialFrames(weapon, environment)`** — §4 reduced sequence; test it omits `$START`/`$TID`/
   `$SIR`, uses `$PSET,0`, and takes `environment` for `$GSET`.
8. **Voice sets** — `voiceOptions()` + `pset(...)`; encode the known families; VA complete,
   others best-effort; capture-plan doc for the unknown per-slot ids.
9. **`led` object** — parse into `outdoor`/`leds` + effect; wire the 3 environment presets; keep the
   night `$GLED` path flagged UNCONFIRMED.
10. **`validate(roster, opts)`** — the §7 rule set incl. required `time_limit_s` and unique `player_num`.
11. **Medals** — `medalCatalog()` + `awardMedals()` over `ScoreRow[]`/`Kill[]`; per-player, exact.
12. **Mocks/fakes** — a `FakeCatalog` + sample `GameConfig`s + a sample `FrameBundle` so M-NODE/M-MC
    build without live data.

## 9. Open questions

- **WEAP token pinning** — ~15 roster weapons are templated, not captured. Which stat tokens are
  safe to interpolate vs need a per-weapon frame? (One-field Callsign capture settles it —
  protocol-classes §WEAP.) Until then, ship `verified:false` + fall back to `ar` behaviour.
- **primaryDamageType vs primaryPowerType order (tok 3/4)** — unresolved in the teardown; both read
  0 on the AR. A one-field capture decides. Low risk for standard weapons.
- **`$PSET` token 2** — always `0` in every capture (incl. cap10/cap11); meaning unknown. Keep `0`.
- **Does an unspawned-but-configured gun take damage?** (tutorial safety, §4). Bench: write a `head`
  to gun A, no `$SPAWN`; shoot it with a try-out-armed gun B; watch for `$HIR`/`$HP` on A.
- **Voice per-slot map** beyond VA — do we pull the `voice-profiles` endpoint (apk-harvest) or
  capture-diff each family? Endpoint is faster if reachable offline-cached.
- **Night LED-off (P17)** — `$GLED` "off" is a guess; `$TID` may always drive some LED. Verify on
  hardware before promising a dark gun; HUD blackout is independent and reliable.
- **Max native team count** — 2-team play confirmed; 3 distinct `$TID` colours observed but 3+-team
  UNTESTED. Now purely a duos/trios question (attribution no longer depends on it).
- ~~**Tutorial `$TID`**~~ **RESOLVED:** no "no team" colour exists; send no `$TID`, the leftover colour is
  cosmetic (§4).
- **Mid-match `$TID` change → friendly-fire resolution?** (infection `team_flip`, A5.8). Bench: two guns on
  team 1, write `$TID,2` to one mid-game, shoot — does the other now take damage / does FF flip?
- **Is the `$START` in `head` audible at the lobby write?** Bench: write a head, listen. If it announces,
  the lobby push isn't silent and `head` needs a `$PLAYX,0` tail (or `$START` moves to the T-0 tail).
- **Pin `cues.game_over` by ear** — `VSF`+`JAY` is what Callsign sends (§7o); confirm it reads as "match
  over" on our guns, else pick another end sting.
- **`revive` vs `$HLOOP`** — §1.1 drops `$HLOOP,0,0` from the mid-match revive; confirm on hardware
  that a respawned gun's headset LED comes back correctly without it.
- **Shield pool (P16 — CLOSED 2026-08-26)** — the pool is granted **only by an IR `$SIR` function-11 event**, never by a BLE write; the `$PSET` shield token does nothing on its own. Drain order is shields → armor → HP. Health
  overrides use armor+HP only for now.
