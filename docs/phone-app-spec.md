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
