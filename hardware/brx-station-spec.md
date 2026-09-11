# BRX Utility Box — the open, MC-programmable objective node (hardware spec)

*(aka the Objective Station — a fixed/placeable contested-point node.)*

**Status:** proposal, 2026-08-24. Sibling to `brx-companion-spec.md`. Where the Companion **rides the
player** and is the game engine, the **Station is fixed on the field** and is the *contested point* —
the flag, the hill, the control point, the respawn base, the extraction site. Reference design is
Jay's **JBOX Mini** (the minimal viable base identified in `docs/reference/jay-ecosystem.md`);
credit to **Jay / Extreme Laser Tag** and **LaserTagMods** (JBOX/JEDGE) for the concept — this is a
fresh, MIT design that never touches stock BRX firmware.

Design goal: **an open-source, Mission-Control-programmable utility box for BRX — a platform, not a
fixed appliance.** One cheap reconfigurable node that becomes any objective on command, and an **open
base for future modes** we haven't designed yet. The whole custom-mode space in `docs/game-modes.md`
reduces to *IR receiver + IR emitter + LED + a local timer/owner-state + rules* — build that once and
Domination, KotH, CTF, Assault, respawn, extraction, bomb/plant-defuse, and utility/perk emitters all
fall out of it, with room for whatever comes next. This is the **open answer to the stock grenade**
(sealed, button-locked, a few fixed modes, no remote config — G7/G8): same objective role, but open,
reliable, any-mode, and driven live by Mission Control.

## Why it has to exist (what the teardown + crawl proved)

1. **The gun keeps no game state** (`protocol/session-findings-2026-08.md` §7n) — a *location* can't be authored
   by the guns; it needs a local authority that shows truth (LED/sound) on the spot.
2. **Objective modes need fixed contested points** (`docs/game-modes.md` Tier 1) — Domination/KotH/
   CTF/Assault all centre on *places*, not players.
3. **A base scores standalone, even through a phone disconnect** — proven on real hardware
   (`jay-ecosystem.md` §6). Store-and-forward isn't a hope; the box holds truth locally and syncs later.
4. **Every interaction is IR** — the station shoots and gets shot exactly like a player, using the same
   980 nm / 38 kHz BRX IR (`docs/reference/brx-extended-user-guide.md`). No BLE, no gun mod.

## Platform: ESP32

> **First concrete build (2026-09-11): the M5StickS3**, `m5sticks3/` (README there). It is this spec's S1 tier
> bought as a finished kit: IR both ways, screen, battery, BLE advert to the phones. It does not yet do the Wi-Fi
> captive config, ESP-NOW or LoRa tiers below; those stay design. Parts and orders: `inventory.md`.

One chip covers it (same family as the Companion, so shared firmware libraries):

- **IR RX + IR TX** → the tagger interface (capture in, perk/effect out).
- **Wi-Fi (SoftAP)** → hosts the captive config web UI; **ESP-NOW** → arena multi-station coordination;
  **+ optional LoRa module** → field-scale multi-base.
- **1× WS2812B RGB (or a ring/strip)** → owner colour, at-a-glance truth.
- **~$3 module / ~$6–8 dev board.** Cheap enough to salt a field with them.

> **The Station's tagger interface is IR, not serial.** The 5 ms-per-char / 3.0–3.4 V / diode-on-pin-17
> UART gotchas in `brx-companion-spec.md` + `docs/reference/community-notes.md` apply to the *in-gun
> Companion's* wired link to the tagger board — **not** to this box, which only speaks IR across the
> air. Don't cross the two.

## Build tiers (start cheap, grow)

| Tier | Adds | ~BOM | What you get |
|---|---|---|---|
| **S0 — Mini** (JBOX-Mini class) | ESP32 + IR receiver + IR emitter + 1× WS2812B + resistors, **USB-powered** (power bank) | **$5–15** | a full objective: capture in, owner LED, perk/effect out, standalone scoring, captive web config. No display/button/battery. |
| **S1 — Base** (JBOX class) | + OLED (live score) + on-box button (quick mode/platform change) + internal LiPo + charge | **+$8–12** | field-standalone (no power bank), on-box score readout + one-press mode change |
| **S2 — Networked** | + external ESP-NOW antenna and/or a LoRa module (RYLR896) | **+$5–12** | multi-station Domination, field-scale multi-base, live HQ scoreboard |
| **S3 — Tower** (JTOWER class) | + LED strips + weatherproof housing (ABS pipe) + key switch | cosmetic | tall, visible, rugged field objective |

A builder starts at **~$8** with a Mini and grows the same firmware by populating parts — exactly the
JBOX Mini → JBOX → JTOWER path Jay shipped.

## IR circuit — the one thing to get right

The station both **receives** hits (capture) and **emits** tags (perks, respawn, "safe" beacons).

- **Receiver:** a 38 kHz IR demodulator (TSOP-class) on a GPIO with an interrupt; decode the BRX hit
  to get **team**, and **player id** in hosted/Callsign games (offline ids are randomised — team-only).
  The BRX hit payload also carries a **~7–8-bit damage value** (explosive/grenade tags score higher),
  which enables **damage-weighted scoring** — see followup **P10** to confirm the exact decode.
- **Emitter — two power options (this is the range knob):**
  1. **Mini/simple:** drive the IR LED from the ESP's **3.3 V** GPIO path through a **~10 Ω** series
     resistor + a switching transistor. Simplest, but a **weaker beam / shorter capture range**
     (Jay's Mini runs this way).
  2. **Full/stronger:** give the IR emitter a **separate power port** off the USB/battery **5 V** rail
     (transistor-switched), so the LED gets more current for a **stronger, longer beam** — the
     full-JBOX approach. Size the transistor and PCB traces for the emitter current (traces should
     carry the amps comfortably). Recommended for respawn/extraction beacons that must reach players
     hands-free at ~18–20 ft.

  *(Both options and the ~10 Ω detail are community-reported via the FB crawl — `community-notes.md`.)*
  Match indoor/outdoor beam mode the way the guns do (forward IR projection scales with mode).

## LED / ownership model

- **1× WS2812B** (Mini) or a **ring/strip** (Base/Tower) shows the **current owner's team colour**
  (red/blue/yellow/green; the firmware's 9-colour index — `protocol/session-findings-2026-08.md` §7i, §7j — maps
  cleanly to the LED). White/neutral = unclaimed.
- **On capture:** flash + (Base tier) a sound; hold shows accumulation (e.g. a per-second pulse while
  a Domination point scores). This is the "truth on the spot" that makes objective play legible without
  any screen.

## Config & OTA — a phone browser is the whole UI

Adopt Jay's captive-AP model (`jay-ecosystem.md` §3) — **zero app install, any phone incl. iOS**
(it's plain HTTP, not Web-Bluetooth):

- The station is its **own Wi-Fi AP** — SSID per device id (so you can tell units apart), open the
  page at **`192.168.4.1`**.
- **Pages:** live **score**, **mode/platform** pick (dropdowns), **Debug/Updates** (device id, LED
  type, LoRa enable).
- **Timing:** ~**45 s** menu window after power-on, then the radio **drops Wi-Fi and switches to
  ESP-NOW** to coordinate — so configure first, deploy second.
- **OTA:** upload a `.bin` over the web page. **Gotcha:** progress races to **92 %** then crawls —
  it's **not done until it says "OTA success"** (still installing); don't close the page. Flash each
  box individually.

## Networking tiers (measured, from the crawl + range tests)

Cite ADR-0001/ADR-0002 and `jay-ecosystem.md` §5 for the numbers:

| Scope | Transport | Range (measured, obstructed) | Use |
|---|---|---|---|
| **Standalone** | none (local IR + web) | — | single Domination/KotH/CTF point; scores locally, syncs to a phone/host when in range (survives disconnect) |
| **Arena** | **ESP-NOW** | ~250 ft bare, **~581 ft with a Molex antenna** | multi-station Domination (bases share scores), tug-of-war, hosted KotH |
| **Field** | **LoRa (RYLR896), *standard* mode** | **~1,373 ft, zero loss** (max-range mode loses ~1-in-7 — avoid) | multi-base over a park, live HQ scoreboard; low-rate control only (LoRa is too slow for a live per-hit firehose — keep scoring local, time-sequence sync) |

Multi-point coordination uses the crawl-observed convention: **`1410`** = game over (last digit =
winning team), **`1433`** = "closing in on victory" warning broadcast. Master/slave domination scales
to **1 master + 9 slaves** (10 stations); hosted KotH to **~21 boxes**. Adopting LoRa-*standard* is
tracked as followup **D2**.

## Modes served — ONE box, every objective, Mission-Control-programmable

**This is the design target (Tony, 2026-08-24):** a single reconfigurable **utility box** that Mission
Control assigns a mode + params to **over the radio** (WiFi/ESP-NOW/LoRa) — no on-device menu, no
button-timing. It is the **open answer to the stock grenade's limits**: the grenade is button-locked,
does only a few modes, and can't be driven remotely (G8); this box does **all** the modes below and MC
programs it live. (No throwable/grenade form factor — a placeable box drops all the throw/pairing
complexity.) Every mode is the **same primitive** — IR receiver + IR emitter + LED + a local timer/owner
state — with different firmware rules:

| Mode | Box behaviour | Adds |
|---|---|---|
| **Domination / control point** | shoot to capture → owner scores **1 pt/s**; steal by shooting; score by Time/Shots/**Damage** | — |
| **King of the Hill** | capture the neutral hill → **hold 45 s** for a point; **~5 s recapture**; charge mechanic; beacons possession | — |
| **Assault** | attack/hold an objective in sequence (our code — no stock-grenade friendly-capture quirk) | — |
| **Capture the Flag** | a team's home base (**2 boxes** = 2 bases); grab enemy flag → return to yours. We own the logic, so no stock-grenade team-assign issue (G9) | 2 boxes |
| **Respawn station** | claim to a team; respawns nearby dead teammates (on IR/command); doubles as a **data-mule** sync point | — |
| **Extraction point** ⭐ | initiate → **loud LED/buzzer alarm** + MC "extraction inbound" callout → **channel timer (30–60 s)** the player must defend → complete = the player's node banks its loot | **a defended countdown** (box runs it locally) |
| **Bomb / plant-defuse (CS)** ⭐ | attacker arms it (shoot/dwell) → **detonation countdown** (LED + beacon) → defender defuses (interact) → resolve round. 2 boxes = 2 sites | **a defended countdown** |
| **Utility / perk emitter** | emit medic/armor/shield/ammo/star-power/proximity-mine/loot tags; team-aligned or shooter-gets-it; emit freq 1–30 s, cooldown to ~30 min, capture N shots, team life-pool cap | — |

The box is the **capture/hold primitive** (IR RX = who shot me + which team; IR TX = beacon owner + push
perks; LED = owner). **Extraction and Bomb** are that primitive **+ a defended countdown timer** (run on
the box, reported to MC) + the loot/round rules that live in the host engine (`extraction.py`) and the
player node (`brx-companion-spec.md`). **Team identity** comes free from the IR hit. Note **P2 is now
solved on the BLE side** (per-player attribution is BLE-native/exact: `$PSET` tok1 / `$HIR` tok3) — but
a **station has no BLE-to-gun link**, so decoding the player-id from the IR hit stays a legitimate
**station-local B13 task** here (the box only ever speaks IR across the air).

## The BRX IR the box must emit (the one reverse-engineering task)

The box has to **emit BRX-compatible IR** so stock guns register its captures/respawns/perks, and
**receive** gun IR to read hits. What we know vs. what's left:

- **Optical (✅ known — `reference/brx-extended-user-guide.md`):** **980 nm** wavelength (NOT 940 nm —
  use 980 nm-capable emitters/receivers), **38 kHz** carrier, ~6.5 µs pulses. A TSOP-class 38 kHz
  demodulator on the RX side.
- **Bit encoding (✅ known — LaserTagMods, `reference/lasertagmods.md`):** **25-bit protocol, 38 kHz
  carrier**; **logic-1 ≈ 1000 µs mark, logic-0 ≈ 500 µs**, ~500 µs inter-bit spacing, ~13 µs carrier
  half-period, start bit opens the frame. This is the on-air waveform.
- **Payload semantics (✅ decoded meaning):** the IR carries a **protocol/type id** (the first field of
  `$SIR`/token 1 of `$HIR`) that routes the effect — e.g. type→{standard hit, respawn+HP, add shields,
  add armor, …} per the `$SIR` table (`protocol/brx-protocol.md` §5); a grenade beacon reads as type 15
  carrying team + mode.
- **Bit layout (✅ solved 2026-08-26, `protocol/brx-ir-protocol.md`):** B (4 bits) protocol · P (6) player id ·
  T (2) team · D (8) magnitude · C (1) crit · U (2) subtype · Z (2) parity; ~2 ms sync, 1000/500 µs marks. A stock
  tagger accepted a fully synthetic word from our ESP32 rig, and on 2026-09-04 the rig replayed the grenade's three
  Respawn-station words. The emit side is real.

**Everything else is standard ESP32 work.** The emit format is confirmed, so the box can produce any
capture/respawn/perk/heal tag on command — which is exactly what makes it programmable where the stock
grenade is locked.

### The box does NOT need to clone the grenade — sounds are OURS to assign

A common misread: "we must capture the grenade's exact IR blast so the gun plays the right sounds." **No.**
The gun decides its **reaction (sound + effect) from its `$SIR` table** — which our node sets over BLE:
`$SIR,<type>,<subtype>,<soundID>,<function>,…` maps an incoming IR type → a sound (any of the 2166-id
bank) + an effect (damage / add-HP / add-armor / respawn / …; see `protocol/brx-protocol.md` §5). So we
control **both halves**: the **IR type the box emits** and the **`$SIR` mapping** of that type. The IR
type is just a *key*; the sound/effect is a *lookup we own*.

Consequences:
- We only need the IR **encoding format** (above) so the box emits a *valid typed frame* the gun reads —
  **not** a byte-for-byte copy of the grenade's beacon.
- To reproduce a stock reaction (e.g. "control point captured", the respawn chime), set `$SIR` to the
  same type→sound the app uses; to invent our own (a custom capture jingle, mode callouts), map any bank
  id. The platform can trigger sounds the grenade never used.
- Caveat: these sounds only play while the gun is **running our config** (our `$SIR` loaded at game
  start). A bare/unconfigured gun just emits a raw `$HIR` with no sound — fine, since the box is always
  used inside a hosted game.

## Relationship to the Companion & the rest of the system

| Piece | Role | Link |
|---|---|---|
| **BRX Station** (this) | fixed contested point — capture/hold/respawn/extraction, **loud/visible truth on the spot** | IR to guns; ESP-NOW/LoRa to other nodes |
| **BRX Companion** (`brx-companion-spec.md`) | rides the player — game engine + **loot wallet** + powerups + audio | BLE to its gun; ESP-NOW/LoRa to stations |
| **Mission Control** (`mcp/brx_mcp/mc/API.md`, `docs/spec/design/mission-control.md`) | operator console — assigns modes, aggregates score | Wi-Fi (WebSocket) |

Station and Companion talk over the **same ESP-NOW/LoRa mesh** — e.g. the Station announces "point A →
red" or "extraction started", the Companion adjusts the player's HUD/loot. QR codes (paper, ~$0) remain
the zero-cost alternative for weapon-pickup / flag props where a powered box is overkill
(`protocol/callsign-extract/apk-harvest.md`).

## Build & print notes

- **3D-printed enclosure** — Mini fits a tiny box (IR window + LED diffuser + USB pigtail); Base adds
  an OLED window + button; Tower is an ABS-pipe upright. Publish STLs in `hardware/` and index them in
  `hardware/print-files.md` (the community print-file gap is tracked in `docs/FOLLOWUPS.md` §Hardware).
- **IR window:** use IR-pass (or clear) material in front of the emitter/receiver; keep the emitter's
  cone aimed where players approach.
- **Power:** Mini = any USB power bank (the community's proven pattern); Base = internal LiPo + TP4056.

## Open hardware questions (before a build)

- **IR bit layout: done** (2026-08-26; see above). The gating task is now packaging, not research.
- **P10** — confirm the BRX IR **damage-value** decode (~7–8 bits) so damage-weighted scoring is exact
  (`docs/FOLLOWUPS.md`).
- **D2** — adopt **LoRa-standard** + **ESP-NOW-with-antenna** as the field/arena baseline (measured).
- IR **emitter range** at each power option — SPL-style test: how far does a capture/respawn beacon
  reach indoors vs. outdoors, Mini (3.3 V) vs. full (5 V port)?
- **Capture debounce / anti-spam** — how many hits, over what window, should flip ownership (utility-box
  "capture tag-count" is 1–1000; pick sane defaults per mode).
- Extraction **channel-reset rule** — pause vs. full reset when the extracting player is killed or
  leaves the zone; tune against the KotH ~5 s recapture window.
