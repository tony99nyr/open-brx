# M0 — the game engine (customizable config + modes + live driver)

The Tier-0 software foundation: a fully-**customizable** game setup, a set of **mode engines**, and a
**driver** that runs them live on real taggers. Built transport-free (no hardware to build/test) — the
live run needs a tagger; everything else is pure and unit-tested. Code: `mcp/brx_mcp/gameconfig.py` +
`mcp/brx_mcp/modes/`.

## Customize everything — `GameConfig`

Every operator-settable knob, mapped to the BRX frame(s) that apply it:

| Setting | Field | Applied via |
|---|---|---|
| Mode | `mode` (tdm/ffa/infection/lms/cs/domination/koth/ctf/extraction) | host engine |
| Game time | `game_time_s` (0=unlimited) | host |
| Respawn time | `respawn_s`, `respawn_ramp` (15→30→45→90) | host |
| Number of respawns / lives | `respawns` (→ lives = respawns+1) | host |
| Frag limit | `frag_limit` | host |
| Volume | `volume` (0–100; 1–5 ≈ 60/70/80/90/100) | `$VOL` |
| Indoor/outdoor | `outdoor` | `$GSET` token 2 |
| **Night mode** (outdoor + LEDs off) | `outdoor=True, leds=False` | `$GSET` + `$GLED` ⚠ (P17) |
| Kid mode | `kid_mode` (health floor, no FF, soft crits) | preset |
| Friendly fire | `friendly_fire` | `$GSET` token 1 |
| Crit modifier | `crit_modifier` | `$GSET` token 7 |
| Starting HP / armor / shield | `hp`, `armor`, `shield` | `$PSET` tokens 3–5 (shield ⚠ P16) |
| Primary / secondary weapon | `primary`, `secondary` | `$WEAP` slots 0/1 (+ melee slot 4) |
| Class | `game_class` (assault/heavy/scout/guardian) | preset loadout |
| Teams | `teams` (player→team) | `$TID` |

`setup_frames()` → the per-game config; `spawn_frames()` → spawn with **loadout-correct `$AMMO`**;
`player_frames(team)` → team + spawn. Presets are applied **class-first, then kid-mode floors** (so a
low-HP class can't drop below the kid minimum; kid-mode deliberately forces friendly-fire off).

⚠ **Unconfirmed:** LEDs-off (`$GLED`) is a best-effort guess (P17); shields are inactive until
activated (P16) — set `armor`/`hp`, not `shield`, for now.

## Modes (`modes/`)

Pure rules engines — consume the parsed event stream + clock ticks, emit `Action`s. **Full catalog:**
- **`deathmatch.py`** — **TDM** (score by team) + **FFA** (credits the specific killer). Kill attribution
  from `$HIR` shooter-team + `$HP,0`, with a **6 s fuse** so a stale non-fatal hit can't steal a late
  kill. Host respawn, frag/time limits. **+ health variants:** Syphon (heal on kill) and Halo-style
  regen (refill after no damage) via additive `$LIFE`.
- **`survival.py`** — **Infection**: a dead human respawns onto the infected team; last human wins.
- **`lms.py`** — **Last Man Standing**: finite lives; last player/team in wins.
- **`cs.py`** — **Bomb / plant-defuse**: attackers plant a site, detonation countdown, defenders defuse;
  best-of-N rounds. Site device feeds `PLANT`/`DEFUSE`.
- **`objectives.py`** — **Domination** (N points, 1 pt/s per held point), **King of the Hill**
  (single-point domination), **Capture the Flag** (grab→return; per-team possession, a CAP only scores
  if that team is carrying; DROP returns the flag). Station device feeds `CAPTURE`/`GRAB`/`CAP`/`DROP`
  with the team as an explicit token (garbage/zero team ignored — never fabricates a phantom team).
- **`extraction.py`** — the flagship raid-and-extract engine (own richer action set + narrated sim).
  **`extraction_adapter.py`** wraps it behind the uniform interface so `play extraction <guns…>` runs it
  on the same live driver as every other mode (FFA teams → 1:1 kill attribution; station feeds
  `ZONE`/`LEAVE`/`LOOT`/`PICKUP`; its actions translate to base Score/PlaySound/GameOver).

**Combat modes** (TDM/FFA/infection/LMS) score off the gun `$HIR`/`$HP` stream — playable today.
**Objective modes** (CS/Domination/KotH/CTF/Extraction) additionally need a station device (Utility Box /
grenade / phone) to emit the objective events (zones/loot/capture) — the engines are done; the event
source is the hardware piece.

Engine interface: `add_player(id, team)`, `on_event(id, ev, now)`, `tick(now)`, `snapshot()`. Actions
(`base.py`): `SendFrame, Respawn, Heal, SetTeam, PlaySound, Callout, Score, Eliminate, GameOver`.

## The driver (`modes/driver.py`)

`GameDriver` is the one I/O touchpoint. It applies the config (config-all-then-spawn-all barrier so guns
start together — B10), feeds each gun's events into the engine, ticks the clock, and executes the
emitted Actions (Respawn→sequence, Heal→`$LIFE`, PlaySound→`$PLAY`, …). Every send is **guarded** — one
gun's BLE error can't abort the game. The `sender` is injected → the driver is unit-tested with a fake;
`run_live()` wires the real BLE `ConnectionManager`.

## Run it

```
python -m brx_mcp game-sim <mode>     # narrated demo of ANY mode to game-over, NO hardware
   # tdm ffa infection lms cs domination koth ctf extraction
python -m brx_mcp play <mode> <addr...> [k=v ...]          # LIVE on taggers
   e.g. play tdm FE:AD:.. D8:AE:.. game_time_s=180 respawn_s=10 volume=85 outdoor=1
        play ffa <a> <b> <c> primary=charge frag_limit=15
        play infection <a> <b> <c> kid_mode=1
        play extraction <a> <b> <c> channel_s=30 win_target=100 drop_policy=ground
```

## Status
Built + polish-looped; **112 unit tests** green (config, modes, driver, extraction + adapter, sounds, diag, irbridge,
diagnostics). **Not yet run on hardware** — that's the next step (needs 1–2 taggers; the live path is
`run_live`/`play`). Native multikill/streak sounds come from the firmware (D4); custom announcers layer
on via `PlaySound`/`Callout`. What each mode needs + its limits: `mode-limits.md`; the sequencing:
`tier0-plan.md`.
