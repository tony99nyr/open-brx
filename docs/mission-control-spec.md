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

## Is Mission Control a web app? Yes — talking to the server, not Bluetooth

Browsers **can** do BLE (Web Bluetooth: Chrome/Edge/Chromium on Android/Windows/macOS/Linux; **not
iOS Safari, not Firefox**). But Mission Control should **not** drive BLE directly at scale — Web
Bluetooth requires a **user-gesture device-picker per tagger** (no silent bulk scan) and one radio
still tops out at ~7–10 links. So:

- **Scalable design:** Mission Control is a **standard web app** (served by the server) talking to
  the server over **WebSocket/MQTT**. The server and the per-player **nodes** (Companion / phone)
  own the Bluetooth. No Web Bluetooth in Mission Control at all — just normal web tech + the event
  bus. This is the recommended path.
- **Pilot shortcut (≤~8 taggers):** a Web-Bluetooth Mission Control can drive taggers directly from
  the operator's Chrome, at the cost of a click-to-pair step per tagger. Fine for a first demo;
  doesn't scale.

Either way it's buildable as a web app.

## Core features

### 1. Detect taggers, read firmware, pull all diagnostics

The operator's first screen: **find every tagger in the room, know exactly what each one is, and
confirm it's game-ready** — before assigning anyone.

**Detect (BLE scan, wireless):** `scan` lists Nordic-UART devices, flagged Gen2/3, with name
(`Tactix-XXXX` (stock) / `Tactix2-XXXX` (renamed by Callsign)), address, RSSI (proximity), and last-seen. One click adds a device to the roster.
Persistent registry (`~/.brx-mcp/known-devices.json`, built) maps address ↔ alias ↔ generation;
macOS gives UUIDs, Windows/BlueZ MACs — never assume format.

**Firmware + live diagnostics (BLE, per tagger, no cable):** connect briefly and pull:
| Field | Source |
|---|---|
| **Firmware version** + host image (e.g. `v4.32` / `devhost.03`) | `$VERSION` → `$VERSION,v4.32,?,4,,devhost.03,*` |
| **Battery** — pack mV, cell mV, charge % | `$VOLTS,<pack>,<cell>,<pct>,<pct>,*` (streams ~30 s in app mode) |
| **Reachability + latency** | `$PING` → `$PONG` (ms) |
| Generation, advertised name, RSSI | scan/advertisement |
| **Headset linked?** (blocks firing if not — `community-notes.md`) | infer from game-ready probe; recovery = Gen-3 re-pair procedure |
| Connection health — buffer depth, drops, last-seen | `list_connections` |
| Live sensor test — trigger/buttons, IR hits | `$BUT` / `$HIR` event stream (fire the trigger, tap the headset, watch events) |

**Full diagnostic dump (USB bench, richest):** when a tagger is cabled to the server, the Teensy
`QUERY` console (hold nothing — just the USB "Programing Port") returns the deep record:
**Serial Number / Head PIN** (e.g. `R0BQT`), all component **versions** + BT central version,
**voltages** (gun + head), **radio flags** `NRFhost`/`NRFslave`/`devHost`, **PCB revision**
(`PCB-5`), and factory `Tested by`. Mission Control parses this into the device record and saves it
to `~/.brx-mcp/device-backups/`. (This is bench prep, not in-field — BLE covers the field.)

**Fleet health dashboard** — the payoff of the above across the whole armory:
- **Battery levels** for every tagger at a glance (sort by lowest; flag &lt; threshold) — logged over
  time so you see drain trends and know which to charge before an event.
- **Firmware matrix** — every tagger's version; **flag mismatches** (e.g. a `devhost` unit vs a
  retail image) that could behave differently mid-game.
- **Readiness** — headset linked, responds to `$PING`, battery OK → green/red per tagger.
- **Identity** — serial/PIN/PCB-rev from the last USB `QUERY`, so a tagger is traceable across events.
- Snapshots persist to the registry + event log; a "re-scan armory" button refreshes live status.

New MCP surface this needs (transport-agnostic, on top of the existing tools): a `diagnostics(alias)`
that runs the BLE sweep (`$VERSION`+`$VOLTS`+`$PING`+status) and returns one record, and a
`fleet_status()` that scans, briefly connects to each, and returns the dashboard array. `QUERY`
parsing already exists for the USB path.

### 1b. Roster
- Bind a **player** (name, optional persistent id) to a tagger for the match. Show each tagger's
  readiness (from §1) and block start on any that isn't game-ready (dead battery, no headset, wrong
  firmware).
- **Gamertag / callsign (built).** Each player picks a **gamertag** which binds to a tagger. It's pushed
  to the gun at setup via **`$NAME,<gamertag>,*`** (so the gun shows the player's name) and echoed in the
  live snapshot (`snapshot()["callsigns"]`) so the **scoreboard labels players by gamertag, not MAC**.
  Data contract (backend done — `GameDriver(callsigns=…)` / `run_live(config, addrs, callsigns)`; CLI
  `play … <addr>@<Gamertag>`): `callsigns: {address → gamertag}`. Gamertags are sanitized
  (`clean_callsign`: drop `,`/`$`/`*`, cap 12 chars — the gun name field is short). The **UI picker**
  (players choose/claim a tag, assign to a gun) is the design-tool surface; the binding + `$NAME` push +
  snapshot echo are the contract it drives. A persistent gamertag registry (tag ↔ address, reused across
  matches) is the natural next step; ties into **P2** if/when a true per-player PlayerID lands.

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

## Can we build a full-featured Mission Control? — YES for team modes; one gap for FFA

Every capability above maps to something already decoded or built:
- discover/identify/connect/send/events → **`brx-mcp` exists**
- teams → `$TID` ✓ · weapons → `$WEAP`/`$AMMO`/`$BMAP` map ✓ · start/spawn/respawn → ✓ (arena)
- scoreboard inputs → `$HIR`/`$HP` parsing ✓ · powerups → decoded command sequences ✓
- sounds → full bank ✓ · modes/win-conditions/medals → APK harvest ✓

**One protocol gap remains, and it only bites free-for-all:** `$HIR` names the shooter's **team**,
not the individual player, so **per-player FFA scoring needs the still-unfound player-id set
command** (followup P2 — `QUERY` shows a device `PlayerID` we've never set; JEDGE numbers players
from 1901). Team-based modes (TDM, CTF, Domination, Supremacy) are fully unblocked today; FFA
per-player scoring waits on that short probe. Otherwise, what's left is engineering: the web UI,
the MQTT bus,
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

0. **Diagnostics & fleet health first** (§1) — the smallest useful slice and a natural starting
   point: add `diagnostics(alias)` + `fleet_status()` to `brx-mcp` (BLE sweep: `$VERSION`+`$VOLTS`+
   `$PING`+status), wire the USB `QUERY` parse into a device record, and a simple armory dashboard.
   The tool code is gun-off to write + unit-test (parse fixed `$VERSION`/`$VOLTS`/`QUERY` strings);
   only the live run needs a tagger.
1. SQLite event log + MQTT bus behind `brx-mcp` (make `arena` publish events).
2. Scoreboard web view (read the bus).
3. Admin: scan → roster → teams → mode → start/stop.
4. Weapon builder (`$WEAP`).
5. Companion node integration (out-of-range).
6. Objective stations; replay; medals.
