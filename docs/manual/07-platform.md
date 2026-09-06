# 07 · The Open BRX platform  (section slug: /platform)
**Last verified:** 2026-09-06
**Audience:** BRX owners, clubs, meetups and small operators choosing whether to run games on this instead of (or alongside) Edge; makers and modders looking for a place to help. · **Goal of this section:** show what Open BRX is, how it is wired, and what it can do at each budget. Compare it to Edge in a fair way. Show, with dates, what is proven on real guns and what is only software or a plan.
**Status legend:** ✅ proven on real hardware · 🧪 built + software-tested, not yet run on hardware · 📐 specified only

> **Editorial rules for this section (for the site builder):** never overclaim. Every claim carries the status emoji of its *weakest* link. The public project name is **Open BRX**; the one-line pitch is **"Video game inspired tactical laser tag: open and self-hosted."** No gun sticker labels, no BLE addresses, no business-brand candidates anywhere on the page. Credit **LaserTagMods (JEDGE / JBOX)** for protocol discovery and the tagger-rider concept, and **Jay / Extreme Laser Tag** for the JBOX objective-node reference design, wherever the platform is introduced. Open BRX is an independent project with no affiliation to Battle Company.

---

## Pages

### Page: The Open BRX platform  (`/platform`)
_Video game inspired tactical laser tag: open and self-hosted._

[hero] **Video game inspired tactical laser tag: open and self-hosted.** Open BRX is free, open-source (MIT) software for stock Battle Company BRX taggers. It ties your guns together into one game system. Today a laptop runs the game modes, live scoring and custom weapons. A laptop Mission Control and a phone HUD are still under construction. There is no subscription, no location lock and no venue Wi-Fi to set up. Stock firmware is never touched. ✅ src: `docs/VISION.md` §Naming, `README.md`
[image PLAT-01]
- See what's proven → `/platform/status`
- What can I build for $0? → `/platform/build-tiers`

[stat-row]
- **$0** to run your first full scored match (a laptop plus the guns you own) ✅
- **2 taggers** played a full scored Team Deathmatch on 2026-08-25; a **3-gun** synced start is proven ✅
- **63** player slots per game (wire ids 1–63; the gun accepts 0–63, 0 reserved) · **4** native hardware teams ✅
- **~$15** in parts for the Companion rider (specified, not built) 📐
- **2,477** sound files on the tagger, every one catalogued ✅
src: `docs/architecture-topology.md` §3 + §7, `hardware/brx-companion-spec.md`, `docs/reference/sound-catalog.md`

[callout:info] **The problem we're solving.** The official Edge engine costs **$599.99 / 6 months to $1,599.99 / year**. It is licensed to **one computer at one location**. It also expects the taggers to reach it over **venue Wi-Fi**. The BRX gun itself **keeps no game state**: no clock, no score, no respawn, no self-reported kills. So *everything* fun has to live off the gun. Open BRX puts that "everything" in open software you host yourself, on gear you already own. ✅ src: `docs/reference/edge-brp.md` §Pricing, `docs/VISION.md`, `protocol/session-findings-2026-08.md` §7n

[cards] **Three things the BRX can't do alone, and where Open BRX puts them**
- **Keep score.** The gun cannot tell a host about its own kills. A kill is only visible from the victim's side (`$HP,0` plus its last `$HIR`). → A per-player **node** on each gun is the scorekeeper. ✅
- **Run a clock or a respawn.** Respawn time and game length are not in the protocol at all. The official app keeps them on the phone. → The node runs the match loop. **Mission Control** writes the game and adds up the results. ✅
- **Reach a laptop across a field.** BLE reaches about 1–30 m. Players spread out 50–100 m. → So the BLE link *rides the player*: a phone today, a Companion later. The laptop talks to the nodes over Wi-Fi, best-effort. ✅ (constraint) / 🧪 (phone tier)
src: `docs/adr/0001-companion-rider-architecture.md` §Context, `docs/HANDOFF.md` §ANSWERED, `docs/adr/0002-laptop-mission-control-host.md`

[diagram PLAT-05] **How it's wired at match time**: laptop Mission Control at the base, one phone (node) per gun in the field. The solid BLE line node↔gun must hold. The dashed Wi-Fi line node↔MC is allowed to drop. **No line from the laptop to any gun during play**. ✅ (Tier 0) / 🧪 (Tier 1) src: `docs/architecture-topology.md` §2

[cards] **The pieces**: one works today, the rest are 🚧 under construction (brief §10)
- **brx-mcp**: the CLI / MCP "lab instrument". Scan, identify, listen, diagnose, and `play tdm …` a real match from a laptop. ✅ **Use it now** → `/manual/dev/brx-mcp`
- **Mission Control** 🚧: the laptop console that writes a game and runs the match. Under construction.
- **BRX Combat HUD** 🚧: the native phone app, one gun per phone. Under construction, and there is an Android test build to sideload → `/platform/app`
- **BRX Companion** 🚧: a small ESP32-S3 rider (~$15 in parts), designed to rebuild the gun's native kill flash and audio with no phone. Specified; bench kit in hand.
- **Utility Box / stations** 🚧: the open objective node (hill, flag, bomb site, extraction point, respawn). Design stage. Our ESP32 rig has already put a synthetic IR shot into a stock tagger.
- **Effect nodes** 🚧: smoke, lights, DMX and music as peers on the event stream. Design stage.
src: `README.md` §Repo layout, `docs/spec/README.md` §2, `hardware/*.md`

[callout:tip] **Start in one command.** On the machine with the Bluetooth radio, run `pip install -e ./mcp`. Then run `python -m brx_mcp play tdm <addr1> <addr2> volume=69`. That exact command ran a full, scored Team Deathmatch on two real taggers. No guns to hand? `python -m brx_mcp game-sim tdm` narrates a match in your terminal. ✅ src: `README.md` §brx-mcp quickstart, `docs/experiment-log.md` "FIRST LIVE M0 GAME"

[quote] "A green test suite is not a working field." The project's own rule for what counts as proven. ✅ src: `docs/architecture-topology.md` §7, `docs/FOLLOWUPS.md` B15

---

### Page: How it's wired  (`/platform/architecture`)
_Three tiers of hardware that never all talk at once, and why._

[callout:info] **Read this before you trust any diagram.** Open BRX is not one program. Four hard facts shape every awkward part of the design. Stock firmware is never modified. The gun cannot report its own kills. Native feel and host control cannot both happen unless a live host drives the feel. And the field is offline and spread out. ✅ src: `docs/architecture-topology.md` §1, `docs/adr/0001-companion-rider-architecture.md`

[diagram PLAT-06] **The squeeze**: flow: *We want host-controlled custom modes + full native feel + scoring on stock firmware, offline, dispersed* → **Native game** (guns self-fire the green-sight flash + killstreak audio ✅; but no synced start, no custom modes, no host control, no scoring ❌) and **Host-configured game** (custom modes, synced start, scoring ✅; but the guns go quiet, so a live host must drive feedback ❌) → *Could Mission Control be that live host?* **No, players scatter out of BLE range** → *Something must hold a BLE link to each gun, in the field, all match* → **Decision: a per-player node, a phone today, an ESP32 Companion later.** ✅ src: `docs/architecture-topology.md` §1

[diagram PLAT-05] **Match-time topology** (the same diagram as the overview hero, full size, with the legend). **Solid line = must hold. Dashed line = allowed to drop.** The BLE link rides the player and must survive the match. The Wi-Fi link can come and go. Events queue on the node until it returns. ✅/🧪 src: `docs/architecture-topology.md` §2

[table] **Every link, and what limits it**
| Link | Transport | Limit | Status |
|---|---|---|---|
| Gun ↔ headset | vendor link | headset must be present or the gun drops BLE entirely | ✅ bench |
| **Node (phone) ↔ gun** | **BLE** | **exactly one gun per node**; link must hold all match | ✅ single-gun bench |
| Node ↔ Mission Control | Wi-Fi (WebSocket) | best-effort; buffered when down | ✅ two phones over field Wi-Fi, two whole matches (2026-08-30, 2026-09-01) |
| Operator ↔ Mission Control | HTTP on localhost / LAN | `:8765` UI, `:8766` node socket | 🧪 |
| Gun → gun | **IR**, line of sight | the only player-to-player channel | ✅ |
| Laptop ↔ gun | BLE | **setup and recap only**, never during play (Tier 0 excepted) | ✅ |
| Laptop ↔ gun | USB | one-time armory setup per gun | ✅ |
src: `docs/architecture-topology.md` §2, `protocol/session-findings-2026-08.md` §7r, `docs/spec/contracts.md` §5

[table] **Counting limits**
| Thing | Limit | Why | Status |
|---|---|---|---|
| Guns per BLE radio | **3 proven**. Three guns held on one laptop radio for a synced start. The maximum is untested | one central radio shares connection events | ✅ 3 guns (FOLLOWUPS B10) · max unmeasured |
| Guns per phone node | **exactly 1** | the link rides one player | ✅ design |
| Players per game | **63** | the gun accepts `$PSET` ids 0–63 (✅ bench); Open BRX reserves wire id 0, so a match has ids 1–63 (`docs/spec/contracts.md` A5.1) | ✅ |
| Native hardware teams | **4** | `$TID` is masked to 2 bits | ✅ bench 2026-08-26 |
| Teams beyond 4 | unlimited *logical* teams | MC scores by roster; players wear armbands; no on-gun friendly-fire protection in that mode | 🧪 |
src: `docs/architecture-topology.md` §2 + §7, `docs/FOLLOWUPS.md` B10, `docs/spec/contracts.md` A5.1, `protocol/session-findings-2026-08.md` §7p, `docs/game-modes.md` §Team structure

[diagram PLAT-07] **Two deployment shapes and the wall between them**: on the left, **Tier 0, laptop only** ✅ (laptop ↔ 4 guns over BLE). On the right, **Tier 1, phones as nodes** 🧪 (laptop = Mission Control + field Wi-Fi, dashed to phones; each phone solid BLE to one gun). The wall between them is labelled *"everyone must stay within ~10–30 m of the laptop."* src: `docs/architecture-topology.md` §3

[callout:warn] **Tier 0 is real today. Tier 1 has run two whole matches on real hardware, at two phones.** A full Team Deathmatch ran end to end on two real taggers from a laptop on 2026-08-25, with scoring, respawn, a frag limit, the correct winner, and BLE holding the whole match. A three-gun synced start is hardware-proven too. The phone-node path then ran a 300 s Free For All on 2026-08-30 (two phones, two taggers, one MacBook hosting over field Wi-Fi: 12 kills, 126 landed hits, 12 deaths, 12 respawns, a winner) and an outdoor Team Deathmatch with two Android HUDs on 2026-09-01. What has not been run: a dispersed timed start with players out of Wi-Fi range before T-0, more than two phones, a 20-minute soak, and a store-and-forward recovery after real coverage loss. ✅/🧪 src: `docs/architecture-topology.md` §3 + §7, `docs/experiment-log/2026-08.md` (2026-08-30, MacBook), `docs/field-issues.md` (Session 2, 2026-09-01), `docs/FOLLOWUPS.md` "System proofs"

[timeline] **Which links are up, phase by phase** ([diagram PLAT-08])
0. **Armory**: USB to each gun, one time, at home. ✅
1. **Muster**: node↔gun BLE up, node↔MC Wi-Fi up, readiness board (gun battery, firmware, headset, phone battery, clock sync). 🧪
2. **Build**: the host writes the game. No guns involved. 🧪
3. **Kit**: assign player number, name, team, weapon and voice. A weapon try-out pushes real frames so the player can feel it. ✅ (try-out fired a real gun from MC, 2026-08-25)
4. **Lobby**: players ready up. MC pushes the per-player FrameBundle. Each node writes it to its gun and acks with the gun's echo. 🧪
5. **Dispersed start**: MC sets a go-live wall-clock time. Players walk out of range. **Each node counts down on its own, so no signal is needed at T-0.** 🧪
6. **Live play**: node↔gun BLE up, node↔MC Wi-Fi best-effort, **MC↔gun BLE: never.** 🧪
7. **Recap**: players return, nodes flush, MC works out winner, K/D, accuracy and medals. CSV export. 🧪
src: `docs/architecture-topology.md` §4, `docs/spec/README.md` §3, `mcp/brx_mcp/mc/API.md`

[diagram PLAT-09] **Coverage honesty: a kill needs two hops.** A kill happens in the field → the **victim's** node sees it right away (`$HP,0` + its last `$HIR`) → the victim's own HUD, death audio and respawn timer fire at once, with no network → the victim's node must then reach MC over field Wi-Fi → MC gives the kill to the shooter and sends feedback to the **shooter's** node → the shooter's green-sight flash and killstreak audio land *only when both hops finish*. 🧪 src: `docs/architecture-topology.md` §5, `docs/spec/README.md` §3 "Coverage honesty"

[callout:info] **So on a large field: you always know you died. You may not learn you got a kill until you walk back into range.** Final results are never wrong, only late. Kills live in the victims' reports, so a scoreboard stays provisional until every node has flushed. Put respawn and base points inside Wi-Fi coverage, so every death becomes a sync point. Instant field-wide feedback is the Companion mesh (M6). 🧪/📐 src: `docs/architecture-topology.md` §5, `docs/spec/README.md` §3

[table] **What happens when things break**
| Failure | What happens | Status |
|---|---|---|
| Field Wi-Fi drops | Nodes keep playing; events queue locally and flush on return | 🧪 |
| BLE drops mid-match | The node re-probes on reconnect; **the gun's config survives a BLE drop** | ✅ bench |
| Gun is power-cycled | Config is **wiped**; a zeroed `$LCD` echo is the node's tell to re-push | ✅ bench |
| Phone dies | That player is out. One phone = one gun = one node, with no backup | design |
| Node never returns | Recap stays provisional; that player's kills are missing | design |
| Headset off or asleep | The gun quietly refuses to join. A disconnected headset slow-blinks rainbow, which is a free visual muster check | ✅ 2026-08-25 / 27 |
src: `docs/architecture-topology.md` §6, `protocol/session-findings-2026-08.md` §7r, `docs/HANDOFF.md` 2026-08-27

---

### Page: The pieces  (`/platform/pieces`)
_Six parts, one decoded protocol, one event stream._

[callout:info] **One of these you can run today. Five are under construction.** `brx-mcp` is documented in full. Mission Control, the phone HUD, the Companion, the Utility Box and effect nodes are still being built. Each gets a 🚧 card here and nothing more until it has run on real hardware. (brief §10) ✅🚧

[callout:info] All six pieces share the decoded BRX protocol, the `brx-mcp` command layer, and the node↔MC WebSocket contract (`docs/spec/contracts.md`). Everything listens to the same event stream. Scoreboard, lights, smoke and announcer are all peers. ✅ (protocol) / 🧪 (contracts) src: `README.md` §Prime directives, `docs/spec/contracts.md`

[spec-sheet] **brx-mcp: the lab instrument** ✅
- **What:** a Python package that is both a CLI and an MCP server. It gives you direct BLE control of taggers from whichever machine owns the Bluetooth radio (Windows / macOS / Linux; `bleak`).
- **Commands:** `scan` · `identify` · `listen` · `probe` · `diagnose` / `fleet` (firmware, battery, per-tagger health) · `play <mode> <addrs…>` (modes: tdm ffa infection lms cs domination koth ctf extraction) · `game-sim` / `extraction-sim` (no hardware) · `usb-query` (armory record over USB) · `ir-capture` / `ir-emit` / `ir-range` (the ESP32 IR rig) · `panic`.
- **Safety:** it refuses malformed frames. Commands outside the known-safe list need `confirm=true`. `panic` sends `$CLEAR,*` then `$SP,99,*`.
- **Proven:** a full TDM on 2 taggers; a 3-gun synced arm; diagnostics; custom `$WEAP` loadouts; native kill flash and announcer over BLE from our stack.
src: `README.md`, `mcp/brx_mcp/`, `docs/archive/verification-checklist.md` Session A/C½/D

[under-construction spec-sheet] **Mission Control: the operator console** 🚧. Public site renders ONLY: title · one line · status badge · "details when it's on the bench". Full draft below is retained for later, not published. 🧪 (single-gun chain ✅)
- **What:** a Python server (`python -m brx_mcp.mc`) that serves a local React web UI. The laptop is the author, the host and the coordinator. It runs on the field LAN (a battery travel router, or a laptop hotspot for small games). No cloud, no internet, no SIM.
- **Phases:** **Muster** (readiness board: gun link, battery, firmware, headset, phone battery, Wi-Fi, clock sync; nothing starts on a red) → **Build / Games** (pick a mode or a saved game; loadout policy presets like OPEN / NO HEAVIES / SNIPERS; Game Designer) → **Kit** (player number 1–63, display name, team, weapon with a private try-out, voice, perks) → **Lobby** (ready-up, FrameBundle push, gun-echo acks) → **Live** (board with staleness, kill feed, end / recall / panic) → **Recap** (winner, K/D, accuracy, medals, CSV export).
- **Key design:** MC compiles every player's BRX frames (`FrameBundle`), and nodes write them word for word. MC never holds BLE to a gun during play.
- **Operator auth**, session persistence across restarts, mDNS + subnet sweep + in-app QR discovery for phones, device-first muster (claim a phone + gun in one gesture).
- **Proven:** phone hello → MC roster bind → kit-out try-out fired a real gun (2026-08-25). The rest is built and tested in software only (mcp ~500 tests, 42 full-stack e2e as of 2026-08-26).
src: `mcp/brx_mcp/mc/API.md`, `docs/spec/README.md` §3, `docs/adr/0002-laptop-mission-control-host.md`, `docs/HANDOFF.md`, `docs/experiment-log.md` 2026-08-25 night

[under-construction spec-sheet] **BRX Combat HUD: the phone node** 🚧. Public site renders ONLY: title · one line · status badge · "details when it's on the bench". Full draft below is retained for later, not published. ✅ single-gun bench · 🧪 field
- **What:** a native Capacitor app (one codebase for Android and iOS) that uses native BLE (CoreBluetooth on iOS, no Web Bluetooth). One phone drives **one** gun. It shows a landscape, rail-mounted video game HUD, and reports to MC over Wi-Fi with a store-and-forward outbox.
- **HUD:** readable in direct sun (numerals, never bars alone), **full blackout night mode**, hit-confirm / down / redeploy states, respawn countdown, ammo pips, briefing screen, in-app loadout picking when the game's rules allow it, and match history.
- **Runs on its own:** arm, damage, death, respawn, local audio and the timed end all work with the LAN dead.
- **Why native:** Web Bluetooth is off by default on Android and missing on iOS (ADR-0003). The cost is a one-time install (APK sideload; iOS via free 7-day signing, sideload, or TestFlight).
- **Field rule:** phone mounted, in the foreground, Do-Not-Disturb on, never locked. Locking or backgrounding suspends the engine and drops the MC socket (it reconnects within ~10 s when foreground again).
- **Proven:** it connected, spoke BLE, drove `$SFLASH`, armed a full game, and ran a stable session. One phone → MC → gun at the bench.
src: `app/README.md`, `docs/spec/node.md` §4, `docs/adr/0003-native-app-over-web-bluetooth.md`, `docs/experiment-log.md` 2026-08-25

[under-construction spec-sheet] **BRX Companion: the ESP32-S3 rider** 🚧. Public site renders ONLY: title · one line · status badge · "details when it's on the bench". Full draft below is retained for later, not published. 📐 specified · bench kit in hand
- **What:** a slim, clip-on, BLE-only node for one gun. It would replace the phone for rental and club fleets: offline game engine, power-ups, Wi-Fi sync, store-and-forward. It is designed to rebuild **the gun's own native feel** (green-sight kill flash via `$SFLASH`, kill and killstreak audio via the `$PLAY` announcer slot, team LED via `$TID`). No speaker or screen needed: the gun is the speaker and the display.
- **Core BOM (~$12–15):** ESP32-S3 module · 1000–2000 mAh LiPo · TP4056 charger · button · WS2812 status LED · optional VS1838B IR receiver · printed clip. **ESP-NOW mesh built in**, so Companions share kills with each other with no extra radio.
- **Optional tiers:** +$5–7 audio (MAX98357A + speaker + microSD for unlimited custom sounds); +$8–12 HUD (OLED/TFT + LEDs). Full unit ~$25.
- **Ops principle:** stateless and interchangeable. Any charged Companion clips to any gun, self-IDs it over BLE, and configures at muster. A dead unit is a hot-swap. OTA over MC's Wi-Fi with auto-rollback.
- **Power-ups as command sequences:** extra life (`$SPAWN`), faster fire / damage boost (`$WEAP` re-push), heal / overshield (`$LIFE` / `$BUMP`), refilled ammo (`$AMMO`), loadout swap, juggernaut (`$PSET`).
- **Status:** ADR-0001 accepted; `$SFLASH` from our stack confirmed; the "host-mode needs a live host" confirmation still owed; pairing/binding handshake, mount (needs caliper measurements) and OTA flow are open design questions. Not built.
src: `hardware/brx-companion-spec.md`, `docs/adr/0001-companion-rider-architecture.md`, `docs/VISION.md` §Companion as flagship, `docs/FOLLOWUPS.md` B1

[under-construction spec-sheet] **BRX Utility Box: the objective station** 🚧. Public site renders ONLY: title · one line · status badge · "details when it's on the bench". Full draft below is retained for later, not published. 📐 design · ✅ IR emit proven
- **What:** a fixed or placeable ESP32 node (IR receiver, IR emitter, RGB LED, and a local timer and owner state). Mission Control would set it to **any** objective on command: Domination point (1 pt/s), King of the Hill (hold 45 s), Assault, CTF base, respawn station (it doubles as a data-mule sync point), **Extraction point** (loud alarm plus a 30–60 s defended channel), **bomb site** (plant / defuse countdown), or a utility / perk emitter (medic, armor, shield, ammo, proximity mine, loot).
- **Why:** it is the open answer to the stock Smart Grenade, which is button-locked to a few modes and cannot be configured over BLE.
- **BOM:** S0 Mini $5–15 (USB-powered) → S1 Base +$8–12 (OLED, button, LiPo) → S2 Networked +$5–12 (ESP-NOW antenna and/or LoRa) → S3 Tower (LED strips, weatherproof housing).
- **Range (community-measured, obstructed):** ESP-NOW ~250 ft bare / ~581 ft with antenna; LoRa-standard ~1,373 ft zero loss.
- **Talks IR, not serial:** the box shoots and gets shot exactly like a player (980 nm / 38 kHz, the 25-bit BRX word).
- **Proven:** the BRX IR word is bench-decoded (sync, marks, field offsets, parity), and **a stock tagger accepted a fully synthetic shot from our ESP32 + LED rig** (2026-08-26). The emit side is real. The box itself is "a packaging exercise, not a research one." Credit: JBOX Mini (Jay / Extreme Laser Tag) is the reference design.
src: `hardware/brx-station-spec.md`, `docs/FOLLOWUPS.md` B4/B13, `docs/experiment-log.md` "LANDMARK", `docs/reference/jay-ecosystem.md`

[under-construction spec-sheet] **Effect nodes: smoke, lights, DMX, music** 🚧. Public site renders ONLY: title · one line · status badge · "details when it's on the bench". Full draft below is retained for later, not published. 📐 (music/stingers from the laptop ~free 🧪)
- **Model:** the engine already emits every event (spawn, kill, death, respawn, clock, capture), and effects just listen. This is the same model Edge uses via its Utility Box + "Animatronics".
- **Cheapest:** laptop audio → speakers for per-mode music and event stingers (kill streak, capture, last 10 seconds, game over) with a priority queue.
- **Next:** a Wi-Fi smart plug or ESP32 + relay (~$8–12) for "respawn → flash a light" or "smoke every 10 min"; WLED strips (~$15–25/zone) for team-colour or chase lighting via MQTT; DMX stage lighting via a DMX interface.
- **Differentiator:** native, open DMX and scripting (Edge's is UBox-mediated and closed) and no per-location licence.
- **Status:** the subscriber bus and the events exist. No effect-node firmware is written (`firmware/` is empty).
src: `docs/reference/edge-brp.md` §UBox, `README.md` §Repo layout

[image PLAT-10] Real photo: the ESP32 IR transceiver rig on a breadboard next to a tagger. This is the instrument that proved synthetic shots. ✅ src: `hardware/esp32-ir-bridge/`, `hardware/ir-breadboard.svg`

---

### Page: Game modes  (`/platform/modes`)
_Every mode we know the BRX can run, sorted by the gear it needs._

[callout:info] **Two tier axes, kept separate.** *Infrastructure* tiers say what gear a mode needs (laptop-only → + props → + broadcast). *Spend* tiers (next page) say what each budget adds. A mode's infrastructure tier maps to whichever spend tier buys that gear. src: `docs/game-modes.md` §Three infrastructure tiers

[cards] **Laptop-only with `brx-mcp`, no props, no broadcast** (engines built 🧪; TDM ✅ on 2 guns; FFA / Infection / LMS engines sim-proven, not yet run on real guns)
- **Team Deathmatch**: two to four teams. Team kills or elimination. ✅ 2026-08-25
- **Free For All**: everyone against everyone. Exact per-player attribution over BLE (the shooter id rides in every hit). 🧪
- **Survival / Infection**: a kill turns a human into the infected team (the live `$TID` flip is bench-proven). 🧪 (flip ✅)
- **Last Man Standing**: limited lives, last one alive wins. 🧪
- **Generals / Commander / The Swarm**: one player *is* the team's mobile respawn point. 📐
- **Supremacy**: three factions, class loadouts as `$WEAP`/`$PSET`. 📐
- **Health variants**: Syphon (health-on-kill to the exact killer), Halo-style regen (host-driven; armor does not regen on its own), medic, armor overshield. 🧪 (`$LIFE`/`$BUMP` writes ✅)
src: `docs/game-modes.md` §Catalog + §Health/regen, `docs/archive/verification-checklist.md`, `mcp/brx_mcp/modes/`

[cards] **+ Props: a contested place needs a local authority** (engines built 🧪; need a station or a grenade to emit the IR events)
- **Domination**: hold control points to score over time. Multi-point wants linked stations. 🧪 engine
- **King of the Hill / Territory**: hold one zone. The Smart Grenade can be the hill for $0. 🧪 engine / ✅ grenade Hill mode
- **Capture the Flag**: standard, assault (one-sided) and centre-flag variants. 🧪 engine (grenade CTF team-assign still open)
- **Assault**: attack and defend objectives in order. 📐
- **Counter-Strike (plant / defuse)**: the grenade, a station, or *a phone's touchscreen* is the bomb. 🧪 engine
- **Team Arena**: TDM plus QR weapon pickups and capturable flags (paper QR = ~$0 props). 📐
- **VIP escort / Hostage rescue**: a special player role plus one extraction station. 📐
src: `docs/game-modes.md` §Catalog + §Custom modes + §Hard ceilings

[cards] **+ Broadcast / location**
- **Battle Royale**: shrinking zone, GPS supply drops, last one alive. It needs per-node location and a live field-wide downlink (Tier 4 radio). 📐
- **Any prop mode with live callouts**: "flag taken!" everywhere, plus a live HQ scoreboard, on a large park with no Wi-Fi. 📐
src: `docs/game-modes.md` §Catalog

[hero] **Extraction: the flagship mode Edge doesn't have** ([image PLAT-04])
Extraction shooters (Tarkov, Hunt: Showdown, DMZ) fit laser tag perfectly. Drop in → **loot** → reach an extraction point and **start the channel, loudly, so everyone runs at you** → survive the channel → bank the loot. **Die and you drop everything.** 🧪 engine src: `docs/game-modes.md` §Extraction

[table] **How Extraction maps onto the BRX**
| Genre element | Open BRX implementation | Status |
|---|---|---|
| Your carried loot | the player's node is the **loot wallet** (kills, IR loot boxes, pickups), plus an optional printed QR "briefcase" you carry | 🧪 |
| Extraction point + "summon it, takes a while" | the King-of-the-Hill hold primitive with a **30–60 s channel timer**. Use a station, or the Smart Grenade as the beacon | 🧪 / 📐 |
| "It's loud" | the station and nearby nodes fire an audio/LED alarm; the guns themselves scream via `$PLAY`; field-wide needs the broadcast tier | 🧪 |
| Survive the channel | get killed or leave the zone and the channel pauses or resets | 🧪 |
| Drop it all on death | on `$HP,0` the wallet moves out, to a dropped token, the pool, or the killer | 🧪 |
| Extracted loot → power | banked value becomes score and/or `$LIFE`/`$WEAP` boosts on your next raid, so the stash carries over | 🧪 |
src: `docs/game-modes.md` §Extraction, `mcp/brx_mcp/modes/extraction.py`

[callout:tip] **Try Extraction with no hardware.** `python -m brx_mcp extraction-sim` runs the pure rules engine as a narrated demo (loot wallet, loud channel, drop-on-death, pickup, bank → boost, win target). A $0 version with the grenade as the beacon and phones as wallets is designed. The full version wants stations and the broadcast tier. 🧪 src: `docs/game-modes.md` §Extraction, `mcp/tests/test_extraction.py`

[table] **What the stock Smart Grenade gives you for $0** ✅ hardware-characterised
| Mode (set by the on-grenade button, LED colour) | Live state readable over BLE? | Notes |
|---|---|---|
| Red = Frag | no | thrown blast |
| Green = Assault | no | shoot to capture to team colour |
| Blue = Hill (KotH) | **yes**, beacon `$HIR,0,15,0,<team>,<mode>` | holder gets a rate-of-fire perk |
| Yellow = Respawn | **yes** | disables self-respawn; respawn via grenade button |
| White = CTF | no | turned red, not team colour; team assignment unresolved |
`$GREN` over BLE does **not** set the mode (button-locked, anti-tamper), so config stays a printed cheat-sheet. Two grenades = two objectives. src: `docs/game-modes.md` §Grenade, `docs/reference/grenade.md`, `docs/HANDOFF.md` 2026-08-27

---

### Page: What you can build at each budget  (`/platform/build-tiers`)
_Start at $0 with the gear you own. Every step after that is optional._

[callout:info] Starting inventory assumed: **4 BRX taggers (+ headsets), 2 Smart Grenades, a laptop or phone you already own.** No mods, no builds, no purchases. These are *spend* tiers. src: this page's pricing tiers below

[pricing-tiers]
**Tier 0: $0 · exactly what you own** ✅ (the pilot)
- A laptop in BLE range drives the guns directly, so a room, a yard or a small field works
- Set up and start a game, spawn, live hit and death tracking, host-driven respawn, synced start ✅
- TDM ✅; FFA / Infection / LMS engines 🧪; laptop scoreboard 🧪
- Custom weapons (`$WEAP`: damage, rate, mag, reload type, per-fire sounds; all 19 Callsign weapons captured (20 frames) and rebalanced) ✅
- Diagnostics (firmware, battery, per-tagger health) ✅
- Custom on-tagger sound packs over USB ✅
- Grenade objectives: Hill / Respawn / Assault / CTF / CS bomb ✅ (CTF team-assign open)
- Outdoor: a phone GPS geofence gives unlimited free objective points 📐; indoor: grenades + paper QR + phone touch-terminals 📐
- **Limit:** everyone stays in the laptop's BLE range, and there is no per-player HUD

**Tier 1: old Android / iOS phones as nodes · ~$0 if you have them (else ~$30–50 used)** 🧪
- The biggest jump in what you can do for the least money, because the link rides the player
- Full-field roaming for every Tier-0 mode; a **per-player HUD** ("your score / ammo / lives", the #1 thing players ask for); offline play with results syncing at the base
- Native app on Android + iOS (ADR-0003), one phone per gun
- **Status:** two phones, two whole matches on real hardware outdoors (2026-08-30, 2026-09-01); more than two phones not yet run

**Tier 2: ESP32 Companion per tagger · ~$12–25 each** 📐
- A purpose-built, rugged, phone-free node that rebuilds the native kill flash and audio
- Power-ups (extra life, faster fire, damage boost, shields) as decoded command sequences
- ESP-NOW mesh between Companions for instant field-wide kill-confirm
- Optional +$5–7 loud custom audio, +$8–12 on-gun HUD

**Tier 3: objective stations · ~$5–15 each (+ paper QR ~$0)** 📐 design · ✅ IR emit proven
- Domination (multi-point + live scoreboard), KotH, CTF variants, Assault, Extraction point, bomb site, respawn stations (data-mule sync)
- Grenades cover single-objective modes for $0. Stations are for multi-point play, live ownership and scoring, and respawn

**Tier 4: field radio · LoRa ~$10/node (or the gun's own nRF, unprobed, maybe free)** 📐
- Live coordination on a large park with no Wi-Fi: "flag taken!" broadcast, live HQ scoreboard, station status screens, Battle Royale
src: `docs/game-modes.md` §Hard ceilings

[table] **The Tier-0 objective toolkit (no bought hardware)**
| Mechanism | Interaction | Good for | Limit |
|---|---|---|---|
| **Grenade ×2** ✅ | shoot it (IR) | flag, hill, extraction hold, bomb site, respawn | only 2; finicky button config |
| **Phone GPS geofence** 📐 | automatic | outdoor flag / hill / extraction / BR zone, unlimited points | outdoor only (~5–10 m) |
| **Printed QR + phone camera** 📐 | scan it | checkpoints, plant sites, pickups | needs an active scan |
| **Phone touch-terminal** 📐 | touch the screen | bomb plant/defuse, hack, hostage | needs a screen at the site |
| **Spare gun as a point** 📐 | shoot it (IR) | an extra capture point | uses up a gun |
src: this page's Tier 0 above

[table] **Environmental effects: a listener layer, gated by devices not by tier**
| Effect | Trigger | Controller | ~Cost | Status |
|---|---|---|---|---|
| Music during the game | engine playlist | laptop audio → speakers | ~free | 🧪 |
| Stingers on events (streak, capture, last 10 s, game over) | engine event | same speakers, priority queue | ~free | 🧪 |
| Respawn → flash a light | respawn event | Wi-Fi smart plug or ESP32 + relay | ~$8–12 | 📐 |
| Last 10 s → red pulse lighting | clock | WLED strip or smart plug | ~$8–25 | 📐 |
| Smoke every 10 min / proximity smoke | timer or PIR / station | ESP32 + relay on the machine's remote jack | ~$8 + machine | 📐 |
| Team-colour / chase lighting, blacklights | MQTT events | WLED ESP32 + addressable strip | ~$15–25/zone | 📐 |
src: this page's Environmental effects above

[callout:tip] **Cheapest high-value path:** run the Tier-0 software on your laptop today. Later, put the phone app on the Android or iOS phones you already own. That alone gets you hosted, custom, multi-mode games for 4 taggers + 2 grenades with **no hardware spend**. Everything after that is optional. ✅/🧪 src: this page's Tier ladder above

---

### Page: Open BRX vs Edge  (`/platform/vs-edge`)
_What we match, what we beat, and what we can't do. Honestly._

[callout:info] Battle Company's **EDGE** (v7.0, Jan 2026) is a mature commercial Windows engine with years of polish, ~6M players and daily arena use. Open BRX is specs plus working software plus a bench-proven Tier 0. The facts below are paraphrased from Battle Company's public pages, and nothing is copied. Open BRX is not affiliated with Battle Company. src: `docs/reference/edge-brp.md`, `docs/VISION.md` §Can we supersede Edge

[compare]
| | **Edge + BRP** | **Open BRX** |
|---|---|---|
| **Price** | $599.99 / 6 mo · $1,199.99 / yr · $1,599.99 / yr (Enemies) | **$0 · MIT, self-hosted** ✅ |
| **Licence scope** | one computer, one location | any laptop, any field ✅ |
| **Venue network** | taggers connect to Edge over venue Wi-Fi (infrastructure spec unpublished) | **no venue Wi-Fi assumed**. The field is an island, and nodes store-and-forward 🧪 |
| **Cloud** | global accounts, matchmaking, cross-venue leaderboards | none in the loop; a hosted service is a future idea ❌ |
| **Game modes** | 35 preset + unlimited custom | TDM ✅ · FFA / Infection / LMS / CS / Domination / KotH / CTF / **Extraction** engines 🧪 |
| **Novel modes** | Battle Royale, Arcade | **Extraction (raid-and-extract)**: Edge has nothing like it 🧪; BR specified 📐 |
| **Weapons / classes / abilities** | 90+ weapons, 15 abilities, 9 melee, classes | full `$WEAP` control; all 19 Callsign weapons captured (20 frames) and rebalanced; perks (Body Armor, Extended Mags, Quick Hands, Easy Reload) ✅/🧪 |
| **Killstreaks / medals / announcer** | 15+ COD-style streaks | first-blood, multikill and streaks driven to the gun's own speaker and green-sight flash ✅ (mechanism) / 🧪 (in-match) |
| **Live scoring + recap** | real-time, leaderboards, history | live board with staleness + recap/CSV 🧪; results settle a little late by design |
| **Per-player HUD** | CallSign phone app (iOS + Android) | BRX Combat HUD: native, blackout night mode ✅ single-gun |
| **Props / objectives** | Utility Box: one unit, 20+ roles; "Order Activation" chaining | Utility Box design: one box, every objective, MC-programmable 📐; IR emit proven ✅ |
| **Environmental effects** | Animatronics: lights, smoke, DMX, moving props (closed) | same event model; **native open DMX + scripting** 📐 |
| **Custom sounds** | 2000+ on-gun SFX, SD card on BRP | 2,477-file bank catalogued ✅; USB sound-pack swap on the BRX ✅; unlimited via Companion audio 📐 |
| **Marketing / monetisation** | Battle Coin, EDGE Store, Message Center, Themes | none ❌ |
| **"Enemies" module** | headsets that fight unpaired from a gun | not built ❌ (a differentiating target) |
| **Hardware niceties (BRP)** | on-gun LCD scoring, hot-swap batteries, flip mag, recoil, sunlight-visible sensors | can't retrofit, the BRX is what it is ❌; the phone or Companion adds the HUD |
| **Maturity / support** | shipping product, daily commercial use | bench-proven Tier 0, software-tested Tier 1, no field seasons yet ❌ |
| **Moddability** | closed | open protocol docs, open firmware, open STLs, MIT ✅ |
| **Firmware** | Battle Company's | **stock BRX firmware, never modified** ✅ |
src: `docs/reference/edge-brp.md`, `docs/VISION.md`, `docs/HANDOFF.md`

[callout:warn] **The honest verdict.** For BRX owners, clubs, meetups and small operators this is very viable. We match Edge in software, beat it on cost, openness and no-Wi-Fi field play, and add modes it does not have. As a full replacement for Edge in large commercial arenas: no, not any time soon. Maturity, cloud accounts, monetisation tooling and hardened prop hardware are real gaps. Edge itself notes the BRX can be used commercially, so the software tier is the gate, not the gun. src: `docs/VISION.md` §Can we supersede Edge

---

### Page: Status & roadmap  (`/platform/status`)
_What is proven on hardware, what is only software, what is only a spec. With dates._

[callout:info] **How to read this page.** ✅ means a human ran it on a real tagger and wrote it in the experiment log. 🧪 means it is built, has tests, and has *not* been run on hardware. 📐 means there is a spec and nothing else. The project's own rule: *a green test ≠ works on real guns. That is earned on the bench.* src: `docs/architecture-topology.md` §7, `docs/FOLLOWUPS.md` B15

[table] **Status board**
| Element | Status | Date / evidence |
|---|---|---|
| Remote game start over BLE (config → spawn → live → timed match → respawn) | ✅ | multiple sessions, 2026-08-23 → 25 |
| Full Team Deathmatch: scoring, respawn, frag limit, correct winner, BLE held all match | ✅ 2 guns | 2026-08-25 "FIRST LIVE M0 GAME" |
| Synced start across guns (config-all-then-spawn barrier) | ✅ 3 guns | 2026-08-25, FOLLOWUPS B10 |
| Exact per-player attribution over BLE (`$PSET` id → `$HIR` shooter) | ✅ | 2026-08-25, `protocol/session-findings-2026-08.md` §7p/§7q |
| Native kill feedback from our stack: green-sight flash (`$SFLASH`) + announcer (`$PLAY` slot 4) | ✅ | 2026-08-25 / 26 |
| Four native teams; firmware-enforced friendly fire; live team flip | ✅ | 2026-08-26 |
| `$WEAP` map: damage, fire interval, fire modes (auto / single / burst / charge / melee), overheat; all 19 Callsign weapons captured (20 frames) | ✅ | 2026-08-26 |
| Config survives a BLE drop; a power-cycle wipes it (re-push tell) | ✅ | 2026-08-25 |
| Headset must be on or the gun won't join; rainbow blink = disconnected | ✅ | 2026-08-25 / 27 |
| Smart Grenade: 5 native modes, Hill/Respawn beacons readable, no BLE config | ✅ | exp-log #33–40 |
| BRX IR word decoded (25 bits, timings, parity); **stock tagger accepts synthetic shots from our ESP32 rig** | ✅ | 2026-08-26 |
| `$SIR` effects matrix (16 protocols × 4 subtypes) mapped: damage, heal, armor, shield, audio suppression | ✅ | 2026-08-26 / 27 |
| The ×1.25 / ×2 multiplier rows (functions 36 and 37): fn 36 lands the **floor** of magnitude ×1.25, fn 37 lands magnitude ×2 | ✅ 16 trials, 4 magnitudes, 8 row-tail shapes, fn 1 control in every trial | 2026-09-02 |
| Native phone app: connects, drives `$SFLASH`, arms a full game, stable session | ✅ single gun | 2026-08-25 |
| Phone → Mission Control → gun: hello, roster bind, try-out fired a real gun | ✅ single node, bench | 2026-08-25 night |
| Mission Control full stack (Muster → Recap), FrameBundle compiler, operator auth, discovery, loadout policy, saved games | 🧪 | ~500 Python tests, 42 e2e, 2026-08-26 / 27 |
| FFA / Infection / LMS / CS / Domination / KotH / CTF / Extraction engines | 🧪 | 156 sim scenarios; objective modes wait on a station |
| **MC ↔ two phones over a real field Wi-Fi, a whole match** | ✅ 2 phones | 2026-08-30 FFA (300 s, 12 kills) and 2026-09-01 outdoor TDM; more than two phones untested |
| **Dispersed timed start on a real field** (players out of range before T-0) | 🧪 never run | n/a |
| **Store-and-forward recovery after real coverage loss** | 🧪 never run | n/a |
| 20-minute two-node soak (screen-lock, backgrounding, out of Wi-Fi range) | 🧪 open | verification-checklist §NEXT 4 |
| Loadout v2 (three slots: primary, secondary, perk; policy presets, phone picks) | 🧪 | 2026-08-27 and 2026-09-04, not bench-verified |
| BRX Companion (ESP32-S3 rider) | 📐 | ADR-0001 accepted 2026-08-25; bench kit arrived 2026-08-26 |
| Utility Box / objective station | 📐 design, ✅ emit | build is "a packaging exercise" |
| Effect nodes (relay, WLED, DMX) | 📐 | `firmware/` empty |
| Field radio (LoRa / the gun's nRF) | 📐 | nRF unprobed (D1) |
src: `docs/architecture-topology.md` §7, `docs/archive/verification-checklist.md`, `docs/FOLLOWUPS.md`, `docs/HANDOFF.md`, `docs/experiment-log.md`

[timeline] **Roadmap: the project ladder**
- **M1 · Identify**: scan, identify and listen to real taggers. ✅ done
- **M2 · Control**: remote game start, weapons, respawn, timed matches. ✅ done
- **M3 · Protocol depth**: the `$WEAP` map, the sound bank, the game-mode model, **per-player id over BLE**, and the IR word. ✅ done (2026-08-25 / 26)
- **M4 · Pilot game**: per-player node + Mission Control + live scoreboard. 🧪 built and tested in software. The MC↔phone field path is the next hardware muster (`docs/field-runbook-mc.md`)
- **M5 · Arena**: objectives, items, stations (Domination / KotH / CTF / Extraction points / bomb sites). 🧪 engines · ✅ IR emit · 📐 the box
- **M6 · Companion + scale**: ESP32 Companions on the same contracts, a mesh for instant field-wide feedback, 20+ guns. 📐
src: `README.md` §Roadmap

[callout:info] **Mission Control and the phone HUD: 🚧 under construction. Details when they have run on a real field.** src: `docs/spec/README.md` §8

[callout:warn] **What we will not claim yet.** Two phones is the most that have played a whole match together; nobody has run more. Nobody has run a dispersed start where players walk out of range before T-0. Nobody has run a store-and-forward recovery after real coverage loss, a 20-minute soak, a phone auto-rejoin to the field SSID, or a locked iPhone's BLE through a match. Three guns on one laptop radio is the most we have held at once, and the maximum is untested. FFA has been played on real guns (2026-08-30); Infection / LMS have not, and their logic is only sim-proven. The Companion and the Utility Box are not built. See *Honest gaps* below for the full list. src: `docs/architecture-topology.md` §7, `docs/FOLLOWUPS.md` B10, `docs/archive/verification-checklist.md`

---

### Page: Get the app  (`/platform/app`)
_The Android test build of the phone HUD: one phone, one gun, over Bluetooth._

[callout:warn] **This is a test build, not a release.** The BRX Combat HUD is still being built, and what is below is a **debug build**. It sideloads and runs, but it is signed with Android's throwaway debug key, so a future release-signed build will not install over it (uninstall first). It is also **debuggable**, which is what `debug` means to Android: anything attached over USB debugging can inspect it and read its data. Fine on your own phone at the bench; a reason not to hand this build to a stranger. It never touches the tagger's firmware: everything it does goes over the documented Bluetooth serial protocol, and a power-cycle restores any gun. 🚧 src: `app/README.md`, `CLAUDE.md` §Hard rules

[download] **BRX Combat HUD for Android** One phone drives one BRX tagger over native Bluetooth LE, runs the match loop (spawn, ammo, lives, respawn clock) and reports to Mission Control over the field Wi-Fi. On the phone it installs as **BRX Companion**. 🚧 src: `app/README.md`, `docs/spec/node.md` §3

[callout:info] **What is already proven on real guns.** On 2026-08-25 this app, built from this codebase, passed every core gate on a bench tagger over native Bluetooth: connect, stream trigger and ammo frames, speak (`$VOL` + `$PLAY`), green the sight (`$SFLASH`), push a full config and arm a game (the gun counted 3-2-1 and went live), and hold a link for 5+ minutes with no drops. Later that night a phone talked to Mission Control and an MC-pushed kit-out fired the real gun. What is *not* finished is the game and HUD layer around that. ✅ (BLE path) / 🚧 (app) src: `docs/experiment-log.md` 2026-08-25 "NATIVE app validated on hardware", `docs/adr/0001-companion-rider-architecture.md`

[steps] **Install it**
1. **Get the APK onto the phone.** Tap the download button above on the phone itself, or download on a computer and copy the file across. Any transfer works.
2. **Open the file and allow the install.** Android asks whether the app doing the opening (your browser or file manager) may install apps. Allow it, then confirm. This is the normal prompt for any app that does not come from the Play Store, and you can switch the permission back off afterwards.
3. **Expect one scary-looking prompt.** Play Protect warns about any app it has not seen before and offers to send it for scanning. Choosing "install anyway" is the normal path for a sideload. 🚧
4. **Launch it and grant "Nearby devices".** That is the Bluetooth permission. On **Android 12 and newer** that is all you need: the scan is flagged `neverForLocation`, so it finds guns with the system Location toggle off. On **Android 7 to 11** the system has no such flag, so the app asks for Location as well **and the Location toggle has to be on**, or the gun list stays empty. We do not use your location either way. ✅
5. **Pick your gun.** Turn the tagger **and its headset** on: a gun whose headset is off or unpaired is silent over Bluetooth and never appears, which looks exactly like a broken app. A headset that is slow-blinking rainbow has not paired yet. Then the tagger appears in the list by name. ✅ Connecting proves the link: the app can speak through the gun and flash its sight.
6. **Optional, and needed for a scored match: point it at Mission Control.** Start MC on the laptop (`python -m brx_mcp.mc`), then scan the QR it shows or type the `ws://<ip>:8766/ws` address on the app's CONNECTED screen. 🚧
src: `app/README.md`, `app/scripts/android-setup.sh`, `mcp/brx_mcp/mc/API.md`

[spec-sheet] **What it needs**
- **Android**: 7.0 (API 24) or newer. There is no Play Store listing; this is a sideload.
- **A tagger**: BRX gen 2/3 (Bluetooth LE). Gen 1 uses Bluetooth Classic serial and is not supported.
- **Permissions**: Nearby devices (Bluetooth) to reach the gun. Camera, for the Mission Control QR scan and the optional CAM look-through in the HUD. **Location** is needed only on Android 7 to 11 (see the install steps); on 12 and newer the scan is flagged `neverForLocation` and works with Location off. Either way the app never reads your position.
- **Wi-Fi**: only to reach Mission Control, and only if you are running a hosted match. The field LAN is a laptop and a travel router with no internet behind it.
- **What it does on that Wi-Fi**: to find Mission Control it listens for its mDNS advert, and if that is blocked (many routers filter multicast) it probes the usual home ranges (`192.168.0/1/86.x`, `10.0.0.x`, `172.20.10.x`) on port 8765 until something answers as MC. That scan stops the moment it binds, and it is the only thing the app sends anywhere. Nothing leaves the LAN: no cloud, no account, no telemetry. 🚧
- **Screen**: landscape, mounted on the rail. The app locks the orientation itself.
📐 (the Android floor is the build's `minSdk`, not a tested device matrix) / ✅ (the permissions are read from the shipped manifest)
src: `app/README.md`, `app/scripts/android-setup.sh`, `docs/adr/0002-laptop-mission-control-host.md`

[callout:warn] **Field rule the bench taught us.** Locking the phone, pulling down the notification shade or switching apps suspends the web view and drops the Mission Control socket (it reconnects within about 10 seconds once the app is in front again). Keep the phone mounted, awake, in the foreground and on Do Not Disturb. The app's keep-awake stops auto-lock only, it cannot stop you. ✅ src: `docs/experiment-log.md` 2026-08-25 (night) §3.11

[callout:info] **On an iPhone?** There is no download. iOS is first-class in the code (the same codebase ran on an iPhone X against real taggers), but Apple has no sideload-a-file path: you build it yourself with Xcode and a free Apple ID, which gives a 7-day on-device build. `app/README.md` has the steps. ✅ (it runs) / 🚧 (no distribution) src: `app/README.md` §Prerequisites, `docs/adr/0003-native-app-over-web-bluetooth.md`

[callout:tip] **Prefer to build it yourself?** `git clone`, then `npm ci && npm run android:apk` in `app/` builds the same app from the same source (JDK 21 and the Android SDK required). It will **not** be byte-identical to the file above: Android signs a debug build with a keystore unique to the machine that built it, so your checksum will differ. The SHA-256 on this page is there to tell you the download arrived intact, not to prove where it came from. The whole project is MIT. src: `app/README.md`, `app/scripts/android-apk.sh`

---

### Page: Get involved  (`/platform/get-involved`)
_Open source, open hardware, open protocol, and one hard rule._

[callout:info] **The hard rule: stock BRX firmware is never modified.** All control goes over the documented Bluetooth serial protocol (plus IR and nRF *observation*). A power-cycle always restores a tagger, and Battle Company's USB updater is the factory-restore path. This is also why the project stays compatible with stock and community gear. ✅ src: `README.md` §Prime directives, `CLAUDE.md` §Hard rules, `docs/adr/0001-companion-rider-architecture.md`

[cards] **Ways in**
- **Play**: you own guns. Read *How it's wired* §Two deployment shapes, then *Build tiers*, then the `brx-mcp` quickstart. ✅
- **Run a match**: the match-day operator runbook (`docs/field-runbook-mc.md`) and the Armory Setup + Muster processes (`docs/field-process.md`). 🧪
- **Change the code**: `docs/spec/README.md` → `docs/spec/contracts.md` (the node↔MC wire is the single point of coordination; interface changes go through documented amendments, not silent edits). 🧪
- **Bench**: the "Needs Tony at the bench" and "System proofs" sections of `docs/FOLLOWUPS.md` list everything still blocked on a human with a tagger. Append to `docs/experiment-log.md` after every session. ✅ process
- **Print**: no public BRX print library exists. `hardware/print-files.md` lists the asks (reload-handle push-button mod, D-pad buttons, Companion mount, station enclosures). Clean-room, version-tagged, MIT. 📐
- **Sound**: the 2,477 on-gun sounds are catalogued by category and transcript, and custom on-tagger packs swap over USB. ✅
src: `docs/README.md`, `docs/FOLLOWUPS.md` §Hardware / 3D printing, `hardware/print-files.md`

[callout:tip] **GitHub:** https://github.com/tony99nyr/open-brx. Licence: **MIT** (`LICENSE`, © 2026 BRX Open Battle System contributors). Register the MCP server with Claude Code: `claude mcp add brx -- python -m brx_mcp`. src: `LICENSE`, `README.md`

[quote] **Credit where it's due.** Protocol discovery and the tagger-rider ESP32 concept originate with **LaserTagMods** (JEDGE / JBOX). The objective-node reference design is **Jay / Extreme Laser Tag's JBOX Mini**. Owner-community knowledge (including David Knox's audio map) informed the sound bank. Open BRX is a fresh, independent, clean-room implementation. Facts are restated with credit, no code is copied, and official PDFs are linked rather than rehosted. ✅ src: `README.md` §Credit, `docs/VISION.md` §Sourcing/policy, `docs/spec/README.md` §7

[callout:info] **Sequencing: prove → open-source → let demand pull.** The project builds the four units its owner needs, hardens them in real games, and open-sources everything. Assembled Companions, kits and fleet bundles only follow if people ask *and* it is proven reliable. src: `docs/VISION.md` §Companion as flagship

---

### Page: FAQ  (`/platform/faq`)
_Short answers, each pointing at the doc that proves it._

[faq]
- **Will this brick my gun?** No. Stock firmware is never touched, and everything is sent over the documented Bluetooth serial protocol. A power-cycle restores any tagger, and Battle Company's USB updater is the factory-restore path. The tools refuse malformed frames and ask for explicit confirmation for anything outside the known-safe command list. A `panic` command (`$CLEAR,*` then `$SP,99,*`) silences and stops a gun. Note it leaves the gun with no `$SIR` table, so it cannot be hit until it is re-armed or power cycled, which is intended for a panic stop but is not a playable state. ✅ src: `README.md` §Safety, `mcp/brx_mcp/protocol.py`
- **Do I need to solder?** Not for Tier 0 or Tier 1, which use a laptop and the phones you own. The Companion prototype builds with **zero soldering** on a breadboard kit. A wearable unit is about 7 easy through-hole joints, or none if you pick an ESP32-S3 board with onboard LiPo charging. There is also an off-the-shelf route (an M5StickC-class module + IR unit + battery, ~$30–35, no fabrication). 📐 src: `hardware/brx-companion-spec.md` §Sourcing
- **Does it work on iPhone?** Yes. The player app is native (Capacitor + CoreBluetooth), so iOS is first-class. What does *not* work is Web Bluetooth in any iOS browser, which is exactly why the app is native. Install is a one-time step: a free Apple ID gives 7-day on-device builds, then sideload or TestFlight for sharing. ✅ (the app ran on an iPhone X against real taggers on 2026-08-25) src: `docs/adr/0003-native-app-over-web-bluetooth.md`, `docs/reference/ios-ble-notes.md`, `app/README.md`, `docs/game-modes.md` §Hard ceilings
- **How many guns can one laptop run?** In laptop-only Tier 0, two things are proven. One laptop radio held a 2-gun scored match, and a 3-gun synced start. The maximum number of BLE links per radio is untested. On any real field, give each gun its own phone. The laptop then holds zero gun links during play. ✅ src: `docs/architecture-topology.md` §2 + §7, `docs/FOLLOWUPS.md` B10
- **How many players and teams?** Up to **63** player slots per game (wire ids 1–63; the gun accepts 0–63 and Open BRX reserves 0) and **4** native hardware teams (with on-gun friendly-fire protection). More squads than four? Put everyone on one team, wear armbands, and let Mission Control score logical teams. There is no on-gun friendly-fire protection in that mode. ✅ src: `docs/game-modes.md` §Team structure
- **Do I need internet or venue Wi-Fi?** No. The field is an island: a laptop and a $20 battery travel router (or a laptop hotspot for small games) make the LAN. No SIM, no cloud, no internet. Nodes keep playing with the Wi-Fi dead and sync when they are back in range. 🧪 src: `docs/adr/0002-laptop-mission-control-host.md`
- **Why don't I see my kill instantly on a big field?** Because a kill is only visible from the victim's gun. It has to reach Mission Control and come back to the shooter's phone. You always know you died right away. Your kill confirm can wait until you are back in coverage. The Companion mesh (M6) is the fix for instant field-wide feedback. 🧪/📐 src: `docs/architecture-topology.md` §5
- **Does the gun still play its own kill sounds and green sight flash?** In a host-configured game the gun goes quiet by itself. But the flash (`$SFLASH`) and the announcer audio (`$PLAY`) are BLE-drivable, and our stack drives them exactly the way the official app does. ✅ src: `protocol/session-findings-2026-08.md` §7o, `docs/experiment-log.md` 2026-08-26 "$SFLASH validated from OUR stack"
- **Can I still use the official Callsign app afterwards?** Yes, because nothing on the gun changes. One caution: opening Callsign resets a renamed gun's `$NAME` back to the default. Re-stamp it with `python -m brx_mcp rename`. ✅ src: `docs/HANDOFF.md` §Fleet ops rules
- **Which BRX generations work?** Gen 2/3 (BLE, Nordic UART) are the supported path. Gen 1 taggers use Bluetooth Classic serial, which the BLE-only library does not speak. A serial-port guide is still to do. ✅/📐 src: `README.md` §Platform notes
- **Do my Smart Grenades work with it?** Yes, for $0: five native objective modes set by the on-grenade button (Frag / Assault / Hill / Respawn / CTF). Hill and Respawn state is readable live over BLE. The mode itself cannot be set over BLE. ✅ src: `docs/reference/grenade.md`, `docs/game-modes.md` §Grenade
- **Can I add my own sounds?** Yes. The tagger's 2,477-file sound bank is catalogued. Custom packs swap over the USB port (hold SELECT at boot → `AUDIO` folder). A Companion with a microSD would give unlimited custom audio. ✅/📐 src: `docs/reference/sound-catalog.md`, this page's Tier 0 above
- **Does the gun show my score?** The BRX has no screen. The phone HUD (or later a Companion HUD) is your score, ammo, lives and respawn timer. The gun's own sight flash and speaker give you the hit and kill feel. ✅ src: `docs/VISION.md` §How much can we get out of the BRX
- **Is this affiliated with Battle Company?** No. Open BRX is an independent open-source project, and "BRX" is used descriptively to name the hardware it serves. Protocol discovery credit goes to LaserTagMods. ✅ src: `docs/VISION.md` §Naming, `README.md` §Credit
- **What's the licence?** MIT, covering software, specs, and (as they land) firmware and STLs. ✅ src: `LICENSE`

---

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| PLAT-01 | `/platform` hero background | Night game: players scattered across a dark field, a dim HUD glow from phones on rifle forearms, faint IR-sight glints | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a wide night-time field seen low from behind a crouching player holding a modern black rifle-style laser-tag tagger with a phone mounted on the forearm, its screen a dim electric-blue glow; four or five other silhouetted players scattered at different distances across dark grass, each with a faint blue phone glow; a single amber light at a distant base; cold moonlight rim-lighting, mist near the ground, cinematic depth. |
| PLAT-02 | `/platform/build-tiers` header, and a homepage secondary hero | Daylight outdoor field: a small group in a sunlit park with taggers, one player checking a forearm-mounted phone | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: an overcast daylight park edge with trees, a small group of adults in casual outdoor clothing holding modern black rifle-style laser-tag taggers with slim head-sensor headbands; the nearest player glances at a phone mounted on the tagger's forearm rail; muted desaturated greens and greys, one electric-blue accent on the phone screen, restrained photoreal light, shallow depth of field. |
| PLAT-03 | `/platform/pieces` Mission Control spec-sheet; homepage "mission control" scene | Laptop on a folding table at the edge of a field at dusk, a dark operator console on screen, a small battery router beside it, taggers racked behind | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a laptop open on a folding camp table at dusk at the edge of a field, its screen showing an abstract dark dashboard of blue rows and bars (no readable text), a small pocket-sized battery Wi-Fi router with one amber LED beside it, several black rifle-style laser-tag taggers leaning on a rack behind, an operator's hands at the keyboard, cool blue screen glow against a deep navy sky. |
| PLAT-04 | `/platform/modes` Extraction hero | Extraction mood: one player kneeling at a glowing beacon in the open, channelling, while distant silhouettes converge | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: night, a lone player kneeling beside a small box-shaped beacon pulsing amber light on open ground, holding a black rifle-style laser-tag tagger and looking over their shoulder; three or four silhouetted figures converging from the treeline in the distance with faint blue glows; tense, exposed, cinematic, ground mist, strong amber-vs-blue contrast. |
| PLAT-05 | `/platform` overview + `/platform/architecture` "Match-time topology" | The match-time topology diagram | SVG (build in site) | `docs/architecture-topology.md` §2 | Two regions side by side. LEFT region titled "BASE: Mission Control (a laptop)": a laptop box labelled "Mission Control · python -m brx_mcp.mc · HTTP UI :8765 / node WS :8766" and a person box "Host / operator in a browser" joined by a solid double-arrow. RIGHT region titled "FIELD: players scatter": two player groups, each a rounded box containing a phone box "Phone node · BRX Combat HUD" and a gun box "BRX tagger + headset" joined by a SOLID double-arrow labelled "BLE · ONE gun per phone". From the laptop to each phone: a DASHED double-arrow labelled "field Wi-Fi · WebSocket · best-effort, store-and-forward". Between the two gun boxes: a thin one-way arrow each direction labelled "IR shot · line of sight". No line of any kind from the laptop to any gun. Legend at the bottom: "Solid line = must hold · Dashed line = allowed to drop · No laptop↔gun line during play". Electric-blue solid lines, dimmed dashed lines, amber for the IR arrows. |
| PLAT-06 | `/platform/architecture` "The squeeze" | The decision flow that forces a per-player node | SVG (build in site) | `docs/architecture-topology.md` §1 | Vertical flow of six rounded boxes with down-arrows. 1 (top, wide): "We want: host-controlled custom modes + the full native feel + scoring, on STOCK firmware, offline, dispersed". Branches to two boxes side by side: 2a "NATIVE game (set on the gun's own menu): ✓ guns self-fire the green-sight flash + killstreak audio · ✗ no synced start, no custom modes, no host control, no scoring"; 2b "HOST-configured game (armed over BLE): ✓ custom modes, synced start, scoring · ✗ the guns go quiet, so a live host must drive the feedback". From 2b: 3 "Could Mission Control be that live host? ✗ NO, players scatter out of BLE range. MC holds ZERO gun links mid-match". 4 "⇒ Something must hold a BLE link to each gun, in the field, for the whole match". 5 (bottom, highlighted electric-blue border): "DECISION: a per-player NODE, a phone today, an ESP32 Companion later". Checks in blue, crosses in amber. |
| PLAT-07 | `/platform/architecture` "Two deployment shapes" | Tier 0 vs Tier 1 side-by-side with the wall | SVG (build in site) | `docs/architecture-topology.md` §3 | Two panels. LEFT panel header "TIER 0: laptop only ✅ PROVEN ON HARDWARE": one laptop box "Laptop · python -m brx_mcp play tdm …" with four SOLID lines labelled "BLE" fanning to four small gun icons. RIGHT panel header "TIER 1: phones as nodes ✅ TWO-PHONE MATCHES RUN; LARGER FLEETS 🧪": one laptop box "Laptop = Mission Control + field Wi-Fi" with three DASHED lines labelled "Wi-Fi" to three phone icons, each phone with a SOLID line labelled "BLE" to one gun icon. Between the panels a vertical wall/divider with the caption "the wall: everyone must stay within ~10–30 m of the laptop" and a small arrow from left to right. Left panel status badge green check; right panel badge a lab-flask. |
| PLAT-08 | `/platform/architecture` phase timeline | Which links are up, phase by phase | SVG (build in site) | `docs/architecture-topology.md` §4 | Horizontal chain of eight numbered chips connected by arrows: "0 · ARMORY: USB to each gun, one time, at home" → "1 · MUSTER: node↔gun BLE UP · node↔MC Wi-Fi UP" → "2 · BUILD: host authors the game · no guns involved" → "3 · KIT: Wi-Fi UP · BLE UP · try-out pushes real frames" → "4 · LOBBY: MC pushes the FrameBundle; each node writes it to its gun" → "5 · DISPERSED START: players walk out of range; each node counts down LOCALLY; no signal needed at T-0" → "6 · LIVE PLAY: node↔gun BLE UP · node↔MC Wi-Fi best-effort · MC↔gun BLE: NEVER" → "7 · RECAP: players return, nodes flush, MC reconciles". Under each chip, three tiny link indicators (BLE / Wi-Fi / MC↔gun) rendered as filled (up), hollow (best-effort) or struck-through (never). Chip 5 highlighted amber. |
| PLAT-09 | `/platform/architecture` "Coverage honesty" | The two-hop kill path | SVG (build in site) | `docs/architecture-topology.md` §5 | Top box "A kill happens out in the field". Arrow down to "The VICTIM's node sees it locally ($HP,0 + its last $HIR), INSTANT, no network needed". From there two branches: left (solid blue, short) to "Victim's own HUD, death audio, respawn timer: all immediate"; right (dashed) to "Victim's node must reach MC over the field Wi-Fi" → (dashed) "MC attributes the kill and sends feedback to the SHOOTER's node" → (dashed) "Shooter's green-sight flash + killstreak audio arrive ONLY when both hops complete". Caption: "You always know you died. You may not learn you got a kill until you walk back into range." |
| PLAT-10 | `/platform/pieces` Utility Box spec-sheet | The real ESP32 IR transceiver rig on a breadboard next to a tagger | REAL PHOTO | owner shoots (`hardware/esp32-ir-bridge/`, `hardware/ir-breadboard.svg`) | (shoot on a dark surface, side light; keep sticker labels out of frame) |
| PLAT-11 | `/platform/pieces` Combat HUD spec-sheet; homepage | A phone mounted on the tagger's forearm/rail showing the HUD (landscape), ideally in blackout night mode | REAL PHOTO | owner shoots (the app's `?demo` mode works with no MC) | (shoot at dusk or indoors dark; HUD in night mode; no gun stickers visible) |
| PLAT-12 | `/platform` "The pieces" cards; `/platform/status` | Laptop + several taggers + headsets on a table with a phone or two. The Tier-0 kit as it actually is | REAL PHOTO | owner shoots | (overhead or 3/4 view; laptop showing Mission Control; sticker labels covered or out of frame) |
| PLAT-13 | `/platform/pieces` Companion spec-sheet | Generic product render of a small slim module clipped to the side of a rifle-style tagger body, one status LED | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: close-up three-quarter product render of a modern black rifle-style laser-tag tagger body with a small slim matte-black clip-on electronics module attached low on the side, out of the sight line, a single electric-blue status LED lit, a tiny USB-C port visible, no wires between module and tagger; studio rim light, restrained, premium hardware-catalogue feel. |

## Interactive ideas (≤5)
1. **Phase-aware topology**: the PLAT-05 diagram with a phase scrubber (Armory → Recap). Each step lights the links that are up, dims best-effort ones, and strikes MC↔gun in Live. Data: `docs/architecture-topology.md` §4.
2. **"What can I build for $X?" ladder**: a slider across Tiers 0–4 that reveals the modes, features and status emojis unlocked at each rung, with a running BOM. Data: this page's pricing tiers, `docs/game-modes.md` §Hard ceilings.
3. **Mode picker by gear**: checkboxes for "laptop / phones / grenades / stations / radio". The mode cards filter to what you can run, each showing ✅/🧪/📐. Data: `docs/game-modes.md` §Catalog + §Hard ceilings.
4. **Edge cost comparator**: years × Edge tier ($599.99 / 6 mo · $1,199.99 / yr · $1,599.99 / yr) vs Open BRX ($0 + optional hardware from the ladder). Data: `docs/reference/edge-brp.md` §Pricing.
5. **Live status board**: the `/platform/status` table rendered from a JSON the repo can regenerate, so ✅/🧪/📐 and dates stay honest as bench sessions close items. Data: `docs/archive/verification-checklist.md`, `docs/FOLLOWUPS.md`.

## Sources used
- `docs/VISION.md`: pitch, Edge verdict, Companion-as-flagship, naming, sourcing policy
- `docs/architecture-topology.md`: §1–§7, the ✅/⬜ discipline preserved as ✅/🧪
- this page's own pricing-tiers section: spend tiers, Tier-0 objective toolkit, environmental effects table
- `docs/game-modes.md`: catalog, team structure, custom modes, Extraction, health variants, grenade, hard ceilings vs pending tests, per-mode tier tables
- `docs/spec/README.md`: architecture, phases 0–7, invariants, milestones M1–M6
- `docs/adr/0001-companion-rider-architecture.md`, `0002-laptop-mission-control-host.md`, `0003-native-app-over-web-bluetooth.md`
- `hardware/brx-companion-spec.md`, `hardware/brx-station-spec.md`
- `docs/reference/edge-brp.md`: Edge features, pricing, UBox, parity targets
- `README.md`: prime directives, quickstart, roadmap, credit, safety, licence
- `docs/README.md`: index, canonical-sources table
- `docs/HANDOFF.md` (2026-08-27 top; "Where the project stands"), `docs/FOLLOWUPS.md` (B1–B18b, K1–K6, Q12), `docs/archive/verification-checklist.md`
- `docs/experiment-log.md`: "FIRST LIVE M0 GAME", "first phone→MC→gun path on real hardware" (2026-08-25 night), "$SFLASH validated from OUR stack", "B13 CLOSED", "LANDMARK" (2026-08-26)
- `app/README.md`, `mcp/brx_mcp/mc/API.md` (phase list), `mcp/brx_mcp/modes/` (engine list), `LICENSE`

## Honest gaps (what is NOT proven yet)
From `docs/architecture-topology.md` §7 and `docs/archive/verification-checklist.md`:
- **Mission Control ↔ more than two phones over a real field Wi-Fi**: two phones have played two whole matches (2026-08-30, 2026-09-01); larger fleets have not.
- **A dispersed timed start on a real field** (players out of range before T-0): never run.
- **Store-and-forward recovery after real coverage loss**: never run.
- **20-minute two-node soak** with a screen-lock and a backgrounding, out of Wi-Fi range: open.
- **Phone auto-rejoin** to a no-internet SSID after walking out of range: open, per OS.
- **iOS locked-phone BLE**: do queued hits reach the engine on resume? Open.
- **Hold-across-disperse**: a 2-minute hold is proven. The 5-minute run was interrupted and needs a re-run.
- **Guns per BLE radio**: three held at once is the proven figure. The maximum has not been measured.
- **FFA / Infection / LMS on real guns**: the logic is sim-proven (156 scenarios). On-gun LED colours, sounds, health and scoreboard are not yet confirmed live. The attribution fuse is not exercised.
- **Objective modes (Domination / KotH / CTF / CS / Extraction) live**: the engines wait on a station or grenade to emit the IR events. Grenade CTF team-assign (G9) and thrown-blast `$GREN` (G10) are open.
- **Health variants live** (Syphon, regen): `$LIFE` writes are confirmed, but the modes on top are not run live. The shield pool is IR-only (fn-11), and the node/app currently drop the shield token (Q12). A hit fully absorbed by a shield would go unreported.
- **Config knobs on-gun**: outdoor mode, kid mode, volume levels, HP/armor start values; none flipped on the bench yet. (Night-mode LEDs-off is **done**: we ship Callsign's own frame `$GLED,,,,5,,,*`, verified 2026-08-30. It blanks all three body LEDs because its colour tokens are empty and token 4 = 5 applies them, which was measured 2026-09-02.)
- **Loadout v2** (three slots: primary, secondary and a perk of its own; policy presets, phone picks): built 2026-08-27 and 2026-09-04, not bench-verified.
- **Melee in a compiled game**: it did not work on the bench, even though our frames match Callsign's byte for byte (K4). A runtime or state question.
- **ADR-0001 confirmation still owed**: that a host-armed game does *not* self-fire feedback once disconnected.
- **Companion**: not built. Open items are the pairing/binding handshake, the mount (needs caliper measurements), the OTA flow, Wi-Fi + BLE coexistence, and the ESP-NOW mesh end to end.
- **Utility Box**: emit is proven from the rig. The box itself is not built (enclosure, captive web config, ESP-NOW/LoRa coordination, IR range at each drive level, capture debounce). Station-arming persistence for respawn (B12) is open.
- **Effect nodes**: no firmware. Music and stingers from the laptop are untested beyond design.
- **Field radio / nRF**: the gun's built-in nRF is unprobed (D1). LoRa-standard adoption (D2) comes from community measurements, not ours.
- **Gen 1 taggers** (Bluetooth Classic): unsupported. Guide to do.
- **MacBook holds a BRX link**: prior sessions worked. Re-confirm before match day.
- **Objective callout sound ids**: provisional (a by-ear session is needed). Medal and streak ids beyond "kill" are not yet heard on the bench.

## Research backlog (held, NOT published)
- **Guns per BLE radio: "~5–7 links at ~10–30 m" (ADR-0002) and "7–10".** Both are planning numbers, not measurements; nobody has run the test. Published only as "3 proven, maximum untested" (architecture counting-limits table, status page, FAQ). src: `docs/architecture-topology.md` §2 (documented disagreement), `docs/adr/0002-laptop-mission-control-host.md`
- **Mission Control milestones M1–M6 (HUD, QR join, readiness board, compiler, lobby, tutorial, recap + medals + export).** Feature/phase lists for under-construction pieces are held under brief §10 until they have run on a real field; the status page carries one 🚧 line instead. src: `docs/spec/README.md` §8
