# Phone app — Callsign replacement (spec)

**Status:** proposal, 2026-08-24. An open per-player app that replaces Battle Company's **Callsign**
— the same role (the phone *is* the per-player game engine + HUD), minus the AWS cloud dependency,
the iOS-only restriction, and the buggy connection handling. It is the **software twin of the BRX
Companion** (`hardware/brx-companion-spec.md`): same engine role, one for BYOD phones, the other a
purpose-built device.

## Why replace Callsign

From the teardown and the field:
- Callsign is **iOS-only** and connection-flaky; its lobby is **AWS SQS/SNS** (a cloud round-trip).
- The gun keeps **no game state** — Callsign runs the clock, respawn, and score on the phone
  (its offline "Edge" engine). So a replacement only needs to do what we already understand.
- We have the **full command/field maps, the 2166-id sound bank, and the game-mode/win-condition
  intel** — everything the app needs is decoded (`protocol/callsign-extract/`).

## Platform: Web-Bluetooth PWA on Android

**Yes, a browser can do this.** The Web Bluetooth API (Chrome/Edge/Chromium) connects to the BRX's
Nordic UART GATT: connect → subscribe TX notify → write RX. This is an **ideal** Web Bluetooth use
case because each player's app connects to exactly **one** tagger (their own) — one device-chooser
pick, one link, ~1 m away.

- **Chrome/Edge on Android support Web Bluetooth** → the app can *be* the repo's `webapp/` served
  as an installable PWA. No app store, no provisioning, no Apple developer account, no build
  toolchain per player. Update everyone by redeploying a static site.
- **iOS is out** (Safari has no Web Bluetooth; Firefox too) — matches Callsign's own limitation but
  from the other side. iOS users would need Bluefy or the Companion hardware instead.
- **Requirements:** served over **HTTPS** (or localhost), and a **user gesture** launches the device
  chooser (can't scan silently). Newer Chrome remembers granted devices
  (`navigator.bluetooth.getDevices()`) so reconnection doesn't re-prompt — good for match rejoins.
- **Offline-first:** log events to **IndexedDB**; sync to Mission Control over WiFi when available.
- **Gate to test first (from `field-architecture.md`):** confirm Android Chrome actually holds a
  BRX NUS link (nRF Connect: connect `Tactix-XXXX` (stock) / `Tactix2-XXXX` (renamed by Callsign), subscribe TX `…0003`, write `$PING,*` to RX
  `…0002`, expect `$PONG`). The whole plan rests on this 10-minute check.

## What the app does (per player)

### Connect & game-ready
- Web-Bluetooth scan → connect to the player's tagger (NUS). Do the connect ritual we captured:
  `$STOP` → `$PLAYX,0` → `$VOL,<n>` → `$PLAY,VA20` ("connection established").
- **Check headset link** and surface it prominently — an unpaired headset silently blocks firing
  (`community-notes.md`); show the Gen-3 re-pair steps in-app when it's missing.

### The game engine (the core — because the gun has none)
- Receive `$HIR`/`$HP`/`$BUT`; drive **spawn/respawn** (`$SPAWN,,*` + `$AMMO`), enforce the
  **clock**, **lives**, and **score** locally.
- Apply the **loadout** Mission Control assigned (`$WEAP` + `$AMMO` + `$BMAP`) and **team**
  (`$TID`).
- Run **powerups** as command sequences: extra life, faster fire (`$WEAP` re-push), damage boost,
  overshield/heal (`$LIFE`/`$BUMP`), infinite ammo (`$AMMO`).

### HUD (what players always ask for — "how do I see my score?")
- Health/armor/shield bars (from `$LCD`/`$ALCD`), ammo, lives, respawn countdown, team, K/D,
  streaks, kill feed. This directly fills the stock BRX **scoring gap** that the community cites
  as the #1 complaint.
- Custom sounds/announcer via the phone speaker (unlimited, unlike the gun's fixed bank).

### Lobby & sync (no AWS)
- Join a match hosted by **Mission Control** over the **local network / MQTT** (not a cloud queue).
  Store-and-forward the event log; upload on reconnect. Degrades gracefully — no network just means
  results sync later.

## Relationship to the other pieces

| Piece | Role | For |
|---|---|---|
| **Phone app** (this) | per-player engine + HUD, software | players who carry a phone (BYOD, casual) |
| **BRX Companion** | per-player engine + HUD, hardware | owned fleets, no phones, louder/rugged |
| **Mission Control** | operator console (roster/teams/weapons/scoreboard) | the game master |

The phone app and Companion are interchangeable per-player nodes; a match can mix them. All three
share the decoded protocol, the command layer, and the MQTT bus.

## A phone as an objective / respawn / extraction node

A phone can **be** an objective authority — not just a player node. What it can and can't do splits
cleanly on **IR**:

- **What it CAN do (over BLE):** hold the objective state (owner, extraction channel, respawn queue),
  and drive taggers directly — **play the alarm on a gun** via `$PLAY,<soundID>` (grenade/explosion
  ids from `../protocol/callsign-extract/sound-bank.md`), **respawn** a player via `$LIFE`/`$SPAWN`,
  push weapons/boosts. So "**summon extraction from the phone → nearby guns scream**" is real, and the
  Extraction rules engine (`../mcp/brx_mcp/modes/extraction.py`) runs unmodified on a phone node.
- **What it CANNOT do:** **IR.** A phone has no 980 nm emitter/receiver, so it can't do the native
  "shoot the station to capture it" interaction, can't emit an IR respawn/"safe-zone" tag, and can't be
  shot. Those need a real **IR station** (`../hardware/brx-station-spec.md`) or the **grenade** (which
  has IR). Physical "you're at the point" detection on a phone is approximate (BLE **RSSI** proximity,
  or "come to base"), not a crisp IR hit.
- **The scale limit — "broadcast to all taggers":** a phone is a BLE **central** and holds only a
  **handful of simultaneous connections (~3–7, hardware-dependent)**, so one phone makes scream the
  guns it's connected to — not an arbitrary crowd.
  - **Small kit (≈4 taggers): one Android phone connected to all of them *is* the extraction/respawn
    site**, and a summon makes them all scream — **$0, no extra hardware.**
  - **At scale (20+):** the summon is an **event on the mesh** (MQTT/ESP-NOW/LoRa) and **each player's
    own node plays the alarm on its own gun** — every gun screams, not just those near one phone. This
    is what the engine's `Callout(scope="all")` models.
- **Platform:** the BLE-driving role needs **Android Chrome** (Web Bluetooth) or a wrapped/native iOS
  app; the pure *authority-over-WiFi* role (phone decides, each node does its own BLE) runs on any
  phone. A **SIM/cellular** phone adds cloud backhaul (remote objective → cloud scoreboard); it doesn't
  change how it reaches taggers (always local BLE).

**Rule of thumb:** *phone = brain + audio + UI; IR interactions = a cheap IR station or the grenade.*

### Phones as *screen-equipped* objectives (what an IR box can't do)

An old Android phone as an objective isn't just a cheaper JBOX — it has a **touchscreen, speaker,
vibration, and camera**, which unlock objectives an ESP32+LED box can't. The screen turns the soft
spot (no IR) into a strength: **interact-at-the-site** modes don't need to sense a laser hit — the
player physically walks up and **touches the screen**, which *is* proof of presence.

Three objective-node types, each with a different strength — a match can mix all three:

| Node | Strength | Best for |
|---|---|---|
| **IR station** (`../hardware/brx-station-spec.md`) | cheap, rugged, native **shoot-to-capture**, salt many across a field | Domination/KotH/CTF capture-by-fire |
| **Phone objective** (old Android) | **rich screen + touch + audio + camera**, free if you have phones | interact-at-the-site: plant/defuse, hack-terminal, hostage rescue, extraction summon, utility box with **visual state** |
| **Grenade** (`reference/grenade.md`) | the only **portable** IR objective you already own | mobile hills/flags/bomb |

**Flagship example — Counter-Strike with the phone as the bomb:**
- The phone sits at bomb site A/B running a PWA page. **Plant:** an attacker reaches it and holds/enters
  an **arm code** → a hold-to-plant bar (~3 s) → screen shows **ARMED** + a countdown (e.g. 40 s), and
  the phone screams (own speaker) and pushes `$PLAY` "bomb planted" to guns it's linked to.
- **Defuse:** a CT reaches it and **solves a small puzzle** — a wire-cut / Simon sequence / code entry /
  with-kit-vs-without-kit hold bar. Solve before zero = **defused (CT win)**; timer hits zero =
  **detonate (T win)** — the phone detonates loudly and can push damage/death (`$BUMP`/`$LIFE,0`) to the
  guns still linked in blast range, or just call the round.
- **Who's touching it?** The screen proves *presence* but not *team*. Options, cheapest first:
  (a) **team-gated knowledge** — Ts know the arm code, CTs get the defuse puzzle (honor/knowledge, zero
  build); (b) **camera scans the player's QR badge** to identify team on interaction; (c) **BLE-proximity
  handshake** with the interacting player's node over the mesh. Start with (a).

Other screen-objectives that fall out for free: a **hack/upload terminal** (hold-to-progress with
interrupts), a **hostage/rescue terminal**, a **King-of-the-Hill / Domination point with a full-screen
owner colour + live timer + scoreboard**, and a **utility box** whose current mode (medic/armor/ammo/
mystery) is shown and chosen on screen.

**Honest limits:** no IR (so *shoot-the-point* modes still want an IR station/grenade — the phone is
for *touch/proximity/camera* interaction); an always-on screen **drains an old phone fast** (mount with
power, or accept a couple hours — old phones are expendable); phones are **fragile outdoors** (case/
enclosure). Android for the BLE-to-gun link; the screen-objective role itself is just a web page, so it
runs on nearly any old phone. Prototype target: a **self-contained bomb PWA** (keypad + timer + defuse
puzzle), the same way `extraction-sim` demos the extraction rules.

## Build order

1. Web-Bluetooth connect + live console (validate the Android gate).
2. Configure + spawn a single tagger (port `startgame`'s sequence to JS).
3. HUD from `$LCD`/`$ALCD`/`$HIR`/`$HP`.
4. Local game engine (clock/respawn/lives/score) + IndexedDB log.
5. Loadout/team from Mission Control; powerups.
6. MQTT sync + lobby; PWA install; custom audio.

## Open items

- Android BLE ↔ BRX hold test (the gate).
- Per-player identity for FFA (P2) — shared with Mission Control.
- Web Bluetooth reconnection UX (establishment is ~1-in-3 flaky; retry transparently).
