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

## Target decision — Android-first, iOS-ready

**Build for Android first** (Tony's kit, by role): **Pixel 10 Pro** (SIM) = **host / hotspot /
backhaul + Mission Control** — its cellular hotspot is the local network on a no-WiFi field, and the
optional cloud-sync path; **OnePlus 7 Pro** (2019, BT 5.0) + **Pixel 4** (WiFi/BT-only, no SIM) = **local
player nodes** (BLE to their gun; join the Pixel's/laptop's WiFi for coordination — SIM-less phones
usually can't host a useful hotspot, so they join one). **SIM affects only internet backhaul, never BLE**
— all three are full BLE nodes. It's all local mesh + store-and-forward; no internet needed mid-game.
Delivery: an **installable Web-Bluetooth PWA** (`webapp/`) — the **primary and preferred** path.

**Web or native? — resolved:** the **player-node role** (one phone ↔ its own gun, HUD + engine) is the
core, and Web Bluetooth handles it perfectly; everything layered on top (objectives via IR/touch/GPS/QR,
distributed MC over WiFi/cellular) needs **no** phone-side BLE scanning. So the **PWA is the foundation.**
Native/hybrid is an **additive** layer for the few things Web BT can't do (scan-by-address / auto-adopt /
background / MTU control) — added later behind the same transport-free core, never a rewrite. And note the
**gate test settles it**: native BLE and Web BT ride the *same* Android stack, so `webapp/ble-test.html`
(Chrome) vs nRF Connect (native) side-by-side shows whether Web BT is good enough (→ PWA) or specifically
flaky here (→ go hybrid). **Decided: PWA
over a packaged APK**, because *updates ship by redeploying a static site — everyone gets the new version
on next load, no reinstall churn.* (An APK/TWA wrap stays an optional fallback if a store listing is ever
wanted; not the plan.)

**Field-play practicality (important):** Web Bluetooth needs a **secure context (HTTPS or localhost)** and
a **user gesture** to open the device chooser — both fine. An **installed PWA on Android Chrome supports
Web Bluetooth**, and its **service worker caches the app shell**, so: *install it once at home over HTTPS
(a free static host — GitHub Pages/Netlify/Vercel — or a laptop's local HTTPS), then it launches and
plays fully offline in the field* (BLE is local; no internet needed mid-game). Updates land the next time
a phone is online. This offline-install-then-play-anywhere property is exactly why the PWA wins for field
use.

**But architect so iOS is a later drop-in, not a rewrite** (§"Common core, platform shells"). Concretely,
five rules keep the iOS path cheap:
1. **All BLE behind a `Transport` interface** — the mode engines + protocol never call
   `navigator.bluetooth` directly. One Web-Bluetooth impl now; a CoreBluetooth impl (via a hybrid BLE
   plugin) drops in later behind the same interface.
2. **The core stays pure** (already true: `mcp/brx_mcp/modes/` + `protocol.py` are transport-free) — no
   platform globals leak into rules/protocol.
3. **UI in a portable web layer** (HTML/CSS/JS) so a Capacitor wrap reuses it verbatim on iOS. Avoid
   Android-only native UI unless we deliberately choose RN/Flutter later.
4. **Feature-detect capabilities at runtime** — if BLE is absent (iOS Safari today), degrade gracefully
   to the **screen/objective/Mission-Control** role rather than assuming BLE exists.
5. **Portable persistence** (IndexedDB) — works in a browser and in a WebView shell on both platforms.

Result: the same codebase runs as an Android PWA/APK today and wraps to a first-class iOS app whenever
the $99 TestFlight step is justified — with only the `Transport` shell swapped.

## Platform: Web-Bluetooth PWA on Android

**Yes, a browser can do this.** The Web Bluetooth API (Chrome/Edge/Chromium) connects to the BRX's
Nordic UART GATT: connect → subscribe TX notify → write RX. This is an **ideal** Web Bluetooth use
case because each player's app connects to exactly **one** tagger (their own) — one device-chooser
pick, one link, ~1 m away.

- **Chrome/Edge on Android support Web Bluetooth** → the app can *be* the repo's `webapp/` served
  as an installable PWA. No app store, no provisioning, no Apple developer account, no build
  toolchain per player. Update everyone by redeploying a static site.
- **iOS is out *for the browser path*** (Safari has no Web Bluetooth; Firefox too) — matches Callsign's
  own limitation but from the other side. iOS users would use Bluefy/beacio (wrapper browsers), the
  Companion hardware, **or a native/hybrid app** (next section) which makes iOS fully first-class.
- **Requirements:** served over **HTTPS** (or localhost), and a **user gesture** launches the device
  chooser (can't scan silently). Newer Chrome remembers granted devices
  (`navigator.bluetooth.getDevices()`) so reconnection doesn't re-prompt — good for match rejoins.
- **⚠️ Web Bluetooth can't "MC-pushes-addresses → auto-connect" (spec-level):** it **never exposes the
  BLE/MAC address** to the page (opaque, origin-scoped ids — a privacy measure) and has **no
  connect-by-address**; the first connect to any device *must* go through the user-gesture chooser
  (`requestDevice`). The experimental `requestLEScan` is flag-gated, off by default, and still hides
  addresses. **This is a browser limit, not a phone limit — native/hybrid BLE can scan, read addresses,
  and connect by address**, so MC-hands-out-addresses auto-adopt is a **native feature** (the
  transport-free core lets us add a native scanning shell later, no rewrite).
- **Web-BT-friendly ways to get the same end:** (1) **grant-once, then auto-reconnect** — tap each of a
  *fixed owned fleet* once, ever; `getDevices()` + `watchAdvertisements()` reconnects hands-free
  thereafter. (2) **IR through your own gun** — objective proximity arrives over the *single link you
  already have* — confirmed for **Hill/Respawn** grenade modes (the gun surfaces their beacon as
  `$HIR,0,15,0,<team>,<mode>` on a bare/`$SIR`-passthrough listen; G6). No scanning/address needed. (3)
  **GPS geofence / QR** for location objectives. So auto-adopt-by-address = native; everything else stays
  Tier-0 web.
- **Offline-first:** log events to **IndexedDB**; sync to Mission Control over WiFi when available.
- **Gate to test first (from `field-architecture.md`):** confirm Android Chrome actually holds a
  BRX NUS link (nRF Connect: connect `Tactix-XXXX` (stock) / `Tactix2-XXXX` (renamed by Callsign), subscribe TX `…0003`, write `$PING,*` to RX
  `…0002`, expect `$PONG`). The whole plan rests on this 10-minute check.

## FAIL-FAST — the Web Bluetooth gate spike (do this BEFORE building the PWA)

The nRF Connect check above proves **native** Android BLE reaches the gun. It does **not** prove
**Web Bluetooth** (Chrome) can drive it well enough to run a game — and if Web Bluetooth can't, the
whole browser-PWA path collapses and we go native (Capacitor) or lean on the Companion. So spend **one
afternoon** on a throwaway spike that answers it decisively, before any PWA investment.

**Deliverable:** a single-file **`webapp/ble-test.html`** — no framework, no build — served over
**HTTPS or `localhost`**, run on an **Android Chrome** phone with a BRX (headset on). The frames are
already known-good (mirror `mcp/brx_mcp/gameconfig.py` `setup_frames()`/`spawn_frames()`); the *only*
question is whether the **browser** can send/receive them reliably.

**Escalating gates — each must pass to proceed; the FIRST failure is the answer:**

| Gate | Test | PASS |
|---|---|---|
| **G1 Connect** | `requestDevice` (NUS filter) → connect | link established |
| **G2 Notify** | subscribe TX `…0003`; pull trigger → `$BUT`; take a hit → `$HIR`/`$HP` | frames stream in |
| **G3 Write** | write `$VOL,69,0,*` then `$PLAY,VA20,4,6,,,,,*` to RX `…0002` | the gun speaks |
| **G4 Feedback** | write **`$SFLASH,*`** | **sight greens** — the load-bearing primitive for our design (§7o) |
| **G5 Arm** | send `setup_frames` + `$TID` + `spawn_frames` (incl. **MTU chunking** for long `$WEAP`) | gun goes live (countdown/`$LCD`) |
| **G6 Stability** | hold the link ~3 min while walking; survive/auto-reconnect the ~6.6 s client drop (`getDevices()` + `watchAdvertisements()`); no dropped frames | stable enough for a match |

**Decision:**
- **All pass →** Web Bluetooth PWA is viable. **Build it** (Android now; iOS via the Capacitor wrap /
  Bluefy later). This is the cheap, no-install path.
- **Fails G1–G3 (connect / notify / write) →** Web Bluetooth is inadequate on this stack. **Pivot to
  native/hybrid** (Capacitor + a BLE plugin — same transport-free core, just a native shell) or lean on
  the **Companion**. Fail fast, no PWA sunk cost.
- **Writes work but G6 flaky →** it's the connection-interval/MTU sensitivity (§7b, often client-fixable):
  try requesting a larger MTU + a slower connection interval; if still unstable, go native.

**Cost:** an afternoon, zero purchase (a phone + a gun you already have). This one spike greenlights or
kills the entire phone path — and it exercises the exact `$SFLASH`/`$PLAY` mechanism the ADR-0001
confirmations need, so it doubles as the "does `$SFLASH` fire from our stack" test on the phone side.

## Common core, platform shells (and first-class iOS)

The iOS "limit" is a **browser** limit, not an iOS limit — **native iOS apps have full BLE via
CoreBluetooth**. So iOS is only second-class on the *zero-install web path*; a native/hybrid app makes
it first-class. And crucially, **an app is still Tier 0** — it's software running on phones you already
own, **no hardware spend** (distribution options + costs in the next section).

This works because the design is **transport-free at the core** (already true of the mode engines in
`../mcp/brx_mcp/modes/` and the protocol layer in `../mcp/brx_mcp/protocol.py`):

- **Common core (write once):** the rules engines (Extraction, health/regen, objective logic) + the BRX
  protocol build/parse. Pure logic, no I/O — the same code the desktop tools and the Companion use.
- **Thin platform shells (per platform):** BLE transport + UI. **Web Bluetooth** on Android/Chrome,
  **CoreBluetooth** on iOS native, **bleak** on desktop Python.

Three ways to ship the wrap, most code-reuse first:
1. **Hybrid (highest reuse):** the same PWA wrapped in **Capacitor/Cordova** with a BLE plugin, or a
   `navigator.bluetooth` **polyfill → CoreBluetooth** (i.e. "build our own Bluefy"). The web app *is* the
   common core; only the transport shim is native.
2. **React Native / Flutter:** one app codebase for both platforms, native BLE via a plugin
   (`react-native-ble-plx` / `flutter_blue_plus`). One codebase, native feel.
3. **Fully native UIs over a shared logic core** (TS/Rust/C++ core, Swift/Kotlin shells): most work, most
   polish — overkill until there's demand.

**Roadmap stays:** ship the Android PWA first (zero-install, validates the core), then wrap the *same
core* for iOS when you want the iPhones to be full player nodes instead of just screens. The tradeoff is
only **zero-install vs. app-distribution overhead**, never a capability gap.

### Distribution — how players actually get the app

**Decision (initial): installable Android PWA; free iOS sideload later; skip the Apple fee until it's
justified.**

- **Android — installable PWA (primary, preferred):** serve `webapp/` over HTTPS (free static host);
  players open the link once and "Add to Home screen." **Updates = redeploy the site → everyone gets it
  on next load, no reinstall.** Works offline after install (service worker). This is the path — chosen
  specifically to avoid APK reinstall churn.
- **Android — APK/TWA (optional fallback):** wrap the PWA as an `.apk` only if a home-screen app icon
  without "Add to Home screen," or a future Play listing (one-time **$25**), is ever wanted. Not the plan.
- **iOS — the honest options** (a native/hybrid build; the *browser* PWA can't do BLE on iOS):
  | Path | Cost | Sharing | Catch |
  |---|---|---|---|
  | **AltStore / SideStore** | **free** (free Apple ID) | each person self-installs the sideloader | app **re-signs every ~7 days**; free-ID limits (≤3 apps); needs a helper/pairing setup |
  | free-provisioning (Xcode) | free | plug into a Mac | **7-day expiry**, per-device — doesn't scale to "folks" |
  | **TestFlight** | **$99/yr (required)** | public link, up to 10k testers, 90-day builds | needs the **paid** Apple Developer Program — **TestFlight is *not* free** |
- **⚠️ Correction to a common assumption:** **TestFlight requires the $99/yr paid account** — a free
  Apple ID cannot upload to App Store Connect / TestFlight. The truly-free iOS route is
  **AltStore/SideStore** (with the 7-day re-sign hassle).
- **Recommendation:** start free — **installable PWA for Android** (the primary path; APK only if a
  home-screen icon or Play listing is ever wanted), **AltStore/SideStore for the iPhones/iPad**. If we
  ever share with more than a couple of non-technical people, **pay the $99/yr for TestFlight** (still
  Tier 0, no hardware) — it's dramatically smoother than asking each person to run AltStore and reinstall
  weekly. Document the PWA install + AltStore setup steps in the release notes when the app ships.

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

**Interaction principle — players NEVER pair to an objective.** A player interacts with any objective
exactly two ways: **shoot it (gun IR)** or **touch its screen** — never by connecting their phone to it.
So the *device must match the interaction*:
- **Shoot-it / hold-the-area objectives (flag, hill, extraction *hold*, domination)** → an **IR node**
  (grenade or station). A phone is the *wrong* device here — it can't be shot (no IR) and can't cheaply
  sense who's holding an area. You already own **two grenades** that do this.
- **Touch-a-terminal objectives (bomb plant/defuse, hack, hostage rescue)** → a **phone** touchscreen.
- A phone can sit *beside* an IR node as its **display**, but it can't *be* a shoot/hold objective.

The objective device has its **own one-time setup connection** to the game backend (placed/configured
once before the round), **never a per-player pairing**. This is the whole reason objectives are separate
nodes: so no player ever pairs to a flag/hill/bomb mid-game.

**Flagship example — Counter-Strike with the phone as the bomb (a touch-terminal, so it fits):**
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

**Grenade as the bomb site (proximity + alive-gating):** the grenade is a *better* physical site than a
phone because it has **IR**. Model: grenade = the site (IR presence beacon + the physical bomb); a site
phone/host = the plant/defuse timer + rules.
- **Auto-enable Plant in range:** if the site is a **Hill/Respawn-mode** grenade, its IR beacon reaches
  the player's gun and the gun surfaces it as `$HIR,0,15,0,<team>,<mode>` → the (Android) node sees "at
  site A" and enables Plant. **Confirmed (G6)** for Hill/Respawn — but note a **spawned gun with a `$SIR`
  table swallows the beacon**, so read it on a bare/`$SIR`-passthrough listen. Assault/CTF/Frag modes
  don't beacon, so for those fall back to a manual tap or the shoot-the-grenade path. Auto-detect is
  **Android-only** (reading the BLE stream in a browser).
- **Preventing an eliminated player from arming — two gates, one free:** (1) **hardware** — a downed BRX
  disables its trigger ("disabled" chirp) until respawn, so if arming = *shoot the grenade*, a dead
  player physically can't interact (needs no per-player node — good for a small Android-phone count);
  (2) **software** — the node greys out Plant while its own `$HP`=0, and the host cross-checks the
  planter's last-known-alive state before accepting the plant. The shoot-the-grenade path makes
  eligibility a **hardware fact**.
- **"Are nearby players alive?"** the arming player: trivial/local (above). *Other* players near the
  site: a node only knows its own gun, so the host must aggregate each node's alive+proximity over the
  mesh — doable at small scale but more than CS needs; ship the planter-alive version first.
- **Device fit (Tony's kit):** grenades = sites A/B; **Pixel 4 + OnePlus** = the Android nodes that
  drive guns / authorize plant; **iPhone X ×2 + iPad Air** = site screens / scoreboards / Mission
  Control (iOS = web pages only, no BLE-to-gun without a wrapper/native app).

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
