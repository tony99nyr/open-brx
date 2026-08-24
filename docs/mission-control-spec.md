# Mission Control — operator console (spec)

**Status:** proposal, 2026-08-24. Mission Control is the **operator's brain** for running a BRX
event: discover taggers, build a roster, assign teams/weapons, pick a mode, start/stop, and watch
a live scoreboard. It sits above the per-player nodes (a **BRX Companion** or a **phone app**) and
the objective stations. Complements `docs/brx-architecture-v0.2.md`; grounded in the now-decoded
protocol (`protocol/callsign-extract/protocol-classes.md`).

## Where it runs & how it reaches taggers

Mission Control is a **web app served by the server** (Pi/laptop) — the `webapp/` scoreboard +
admin from the architecture doc. Two control paths, chosen by scale:

- **Direct BLE (pilot, ≤~7 taggers):** the server's own radio drives taggers via `brx-mcp`. This
  is what `deathmatch`/`arena` already do. Simple; range-bound.
- **Via nodes (real events, 20+):** each tagger carries a **Companion** (or the player a **phone**)
  that holds the BLE link and relays over **WiFi/MQTT**. Mission Control publishes intents to
  `brx/tagger/{alias}/cmd`; nodes execute and report on `.../event`. This is the scalable path and
  the reason the gun-keeps-no-state finding (§7n) forces a per-player device.

The **MCP tool layer is transport-agnostic from day one** (spec §M4): the same `send`/`get_events`
tools work whether the backend is local BLE or the MQTT proxy.

## Core features

### 1. Scan & roster
- **Scan** for taggers (`scan` → Nordic-UART devices, flagged Gen2/3). Show name (`Tactix2-XXXX`),
  RSSI, battery (`$VOLTS`), firmware (`$VERSION`), and last-seen.
- **Persistent registry** (`~/.brx-mcp/known-devices.json`, already built) — address ↔ alias ↔
  generation. macOS gives UUIDs, Windows/BlueZ MACs — never assume format.
- **Roster:** bind a **player** (name, optional persistent id) to a tagger for the match. Show
  headset link state (critical — an unpaired headset **blocks firing**, `community-notes.md`) and
  flag any tagger that isn't game-ready.

### 2. Assign teams
- Assign each player a **team** via `$TID,<n>,*`. Team drives the gun's LED colour automatically
  (verified: team 1 blue, team 2 yellow; `$GLED` does **not** set colour). `$TID,0` = candidate
  neutral/FFA.
- Drag-and-drop team builder; auto-balance; lock teams before start.

### 3. Assign / build weapons
- **Loadout picker** per player or per team: choose from presets, or the **weapon builder** — now
  possible because the `$WEAP` token map is decoded (`protocol-classes.md`). Expose the meaningful
  fields: `primaryDamage`, `rateOfFire`, `maxClip`/`maxAmmo`, `reloadType` (Magazine/Quiver/Shells/
  SingleBolt/BoltWithMagazine/AutoReload), `primaryDamageType` (Standard/Plasma/Cryogenic/EMP/
  ArmorPiercing/…), `primaryPowerType` (GunLaser/HeadSetOnly/GunAndHead/DoubleGun/…), and the
  per-fire **sound names** (from the 2166-id `sound-bank.md`). Push into slots 0–5 with `$WEAP` +
  `$AMMO`; map buttons with `$BMAP`.
- Validate against the DamageType/PowerType/ReloadType enums; save named loadouts.

### 4. Pick game mode & settings
- Modes are **host-side rule modules** (the gun enforces none): TDM, FFA, Supremacy, Survival,
  Infection, Domination, CTF, KotH, Assault, custom. Win conditions = Score / Death(elimination) /
  Slayer(most kills) / CaptureTheFlag / SquadLeader (from `apk-harvest.md`).
- Settings the **host** owns (NOT on the gun): clock, respawn time (fixed or RAMP 45/90),
  lives/score limit, friendly fire. `$GSET` sets on-gun things (friendlyFire, region, gyro,
  crit modifier) — Mission Control writes it, but respawn/clock/scoring live in the engine.
- Configure objective stations (respawn/capture/pickup) for the chosen mode.

### 5. Run the match
- **Synchronised start:** configure all taggers concurrently, fire the countdown (`$PLAY,VA81`) in
  unison, spawn together (`$SPAWN,,*` + `$AMMO`) — exactly the fix `arena` already implements.
- **Live scoreboard / mission map:** per-player hits/deaths/K-D/streaks, team score, objective
  ownership, clock. Kill feed from `$HIR`+`$HP` (cache shooter team from `$HIR`, credit on
  `$HP,0`). TV mode.
- **Powerups / interventions:** operator can grant extra life, damage boost, ammo, shields, or
  swap a loadout mid-game — each is a command sequence (`$LIFE`/`$WEAP` re-push/`$AMMO`/`$BUMP`),
  the same primitives the Companion uses.
- **Panic:** `$CLEAR,*`+`$SP,99,*` to any/all taggers; power-cycle always restores.

### 6. After the match
- **Replay** from the event log (SQLite): kill feed, damage graphs, streaks, medals (MVP/Top Gun/
  Sharp Shooter/… from `config-facts.md`). Store-and-forward means late-syncing nodes complete the
  record.

## Data model (server)

`Player`, `Tagger` (+ Companion), `Loadout` (`$WEAP` set), `Station`, `Match` (mode + roster +
settings + event log). Everything is an event on the MQTT bus; the engine is the single source of
truth for rules; nodes stay dumb (architecture prime directives).

## Can we build a full-featured Mission Control? — YES

Every capability above maps to something already decoded or built:
- discover/identify/connect/send/events → **`brx-mcp` exists**
- teams → `$TID` ✓ · weapons → `$WEAP`/`$AMMO`/`$BMAP` map ✓ · start/spawn/respawn → ✓ (arena)
- scoreboard inputs → `$HIR`/`$HP` parsing ✓ · powerups → decoded command sequences ✓
- sounds → full bank ✓ · modes/win-conditions/medals → APK harvest ✓

**Nothing is blocked on unknown protocol.** What's left is engineering: the web UI, the MQTT bus,
the SQLite event log, the per-player node (Companion/phone) for out-of-range, and objective
stations. See the gap analysis below.

## Gap analysis — what the `deathmatch`/`arena` demo is missing

`arena` proves the protocol end-to-end (configure N taggers, distinct teams, synced start, live
hit/death tracking, host-driven respawn, teardown). To become a real Mission Control it needs:

| Gap | Why | Have the protocol? |
|---|---|---|
| **Per-player node** (Companion/phone) | host-driven respawn only works in BLE range (§7n) | ✅ commands known |
| **MQTT event bus** | decouple engine from nodes; scale past one radio | n/a (infra) |
| **Persistence (SQLite event log)** | scores/replay survive; store-and-forward | ✅ events parse |
| **Web UI** (admin + scoreboard) | operator console + TV view | ✅ |
| **Player roster / identity** | FFA per-player scoring; `$HIR` gives team only | 🟡 P2 — find the player-id set command (JEDGE uses 1901+) |
| **Weapon builder UI** | custom loadouts | ✅ `$WEAP` map decoded |
| **Objective stations** | Domination/CTF/KotH need capture points | ✅ QR + IR (25-bit/38 kHz) known |
| **Announcer / custom audio** | game feedback | ✅ bank + Companion DFPlayer |
| **Mode rule modules** | TDM/CTF/Dom/etc. as engine plugins | ✅ win-conditions known |
| **Replay viewer** | post-match analysis | ✅ from event log |

**Do we need more Bluetooth snooping?** Mostly no — see `docs/FOLLOWUPS.md`. Only a few targeted
one-setting captures remain (`$WEAP` empty tokens, `$PSET` voice pack, grenade). The APK teardown
replaced the broad capture work. The one genuinely open protocol item that affects Mission Control
is **P2 (per-player identity)** for FFA scoring — worth a short probe (try setting a player id;
JEDGE numbers from 1901).

## Build order

1. SQLite event log + MQTT bus behind `brx-mcp` (make `arena` publish events).
2. Scoreboard web view (read the bus).
3. Admin: scan → roster → teams → mode → start/stop.
4. Weapon builder (`$WEAP`).
5. Companion node integration (out-of-range).
6. Objective stations; replay; medals.
