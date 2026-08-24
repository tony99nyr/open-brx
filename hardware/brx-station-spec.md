# BRX Objective Station — fixed contested-point node (hardware spec)

**Status:** proposal, 2026-08-24. Sibling to `brx-companion-spec.md`. Where the Companion **rides the
player** and is the game engine, the **Station is fixed on the field** and is the *contested point* —
the flag, the hill, the control point, the respawn base, the extraction site. Reference design is
Jay's **JBOX Mini** (the minimal viable base identified in `docs/reference/jay-ecosystem.md`);
credit to **Jay / Extreme Laser Tag** and **LaserTagMods** (JBOX/JEDGE) for the concept — this is a
fresh, MIT design that never touches stock BRX firmware.

Design goal: **one cheap reconfigurable box that becomes any objective.** The whole custom-mode space
in `docs/game-modes.md` reduces to *IR receiver + LED + a local timer/owner-state + rules* — build
that once and Domination, KotH, CTF, Assault, respawn, utility/perk emitters, and the flagship
**Extraction** point all fall out of it.

## Why it has to exist (what the teardown + crawl proved)

1. **The gun keeps no game state** (`protocol/brx-protocol.md` §7n) — a *location* can't be authored
   by the guns; it needs a local authority that shows truth (LED/sound) on the spot.
2. **Objective modes need fixed contested points** (`docs/game-modes.md` Tier 1) — Domination/KotH/
   CTF/Assault all centre on *places*, not players.
3. **A base scores standalone, even through a phone disconnect** — proven on real hardware
   (`jay-ecosystem.md` §6). Store-and-forward isn't a hope; the box holds truth locally and syncs later.
4. **Every interaction is IR** — the station shoots and gets shot exactly like a player, using the same
   980 nm / 38 kHz BRX IR (`docs/reference/brx-extended-user-guide.md`). No BLE, no gun mod.

## Platform: ESP32

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
  (red/blue/yellow/green; the firmware's 9-colour index — `protocol/brx-protocol.md` §7i/§7j — maps
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

Cite `docs/field-architecture.md` and `jay-ecosystem.md` §5 for the numbers:

| Scope | Transport | Range (measured, obstructed) | Use |
|---|---|---|---|
| **Standalone** | none (local IR + web) | — | single Domination/KotH/CTF point; scores locally, syncs to a phone/host when in range (survives disconnect) |
| **Arena** | **ESP-NOW** | ~250 ft bare, **~581 ft with a Molex antenna** | multi-station Domination (bases share scores), tug-of-war, hosted KotH |
| **Field** | **LoRa (RYLR896), *standard* mode** | **~1,373 ft, zero loss** (max-range mode loses ~1-in-7 — avoid) | multi-base over a park, live HQ scoreboard; low-rate control only (LoRa is too slow for a live per-hit firehose — keep scoring local, time-sequence sync) |

Multi-point coordination uses the crawl-observed convention: **`1410`** = game over (last digit =
winning team), **`1433`** = "closing in on victory" warning broadcast. Master/slave domination scales
to **1 master + 9 slaves** (10 stations); hosted KotH to **~21 boxes**. Adopting LoRa-*standard* is
tracked as followup **D2**.

## Modes served (one primitive, many modes — cite `docs/game-modes.md`)

| Mode | Station behaviour | Networking |
|---|---|---|
| **Domination** | shoot to capture → owner scores **1 pt/s**; steal by shooting; score by Time/Shots/**Damage** | standalone (single) / ESP-NOW (multi-point) |
| **King of the Hill** | capture the white hill → **hold 45 s** for a point; **~5 s recapture window**; roles/locations can randomise each round | ESP-NOW/host |
| **Capture the Flag** | flag base: grab enemy flag, bank at your base | standalone / ESP-NOW |
| **Assault** | attack/hold objective in sequence *(quirk: friendly-capture bug — `grenade.md`)* | ESP-NOW |
| **Respawn station** | claim to a team; dead players trigger it (button or hands-free melee IR) to respawn | standalone; doubles as a **data-mule** sync point |
| **Utility / perk emitter** | emit medic/armor/shield/ammo/star-power/proximity-mine/loot tags; team-aligned or shooter-gets-it; emit freq 1–30 s, cooldown to ~30 min, capture 1–1000 shots, team life-pool cap | standalone |
| **Extraction point** ⭐ | initiate → **loud audio+LED alarm** ("extraction inbound") → **channel timer** (30–60 s) the player must defend; complete = the player's node banks its loot; the flagship mode Edge can't do | standalone (local) / broadcast (field-wide alarm) |

The Station is the **KotH/hold primitive**; Extraction is that primitive + a channel-and-alarm behaviour
+ the loot rules that live in the player node (`brx-companion-spec.md`) and the host engine.

## Relationship to the Companion & the rest of the system

| Piece | Role | Link |
|---|---|---|
| **BRX Station** (this) | fixed contested point — capture/hold/respawn/extraction, **loud/visible truth on the spot** | IR to guns; ESP-NOW/LoRa to other nodes |
| **BRX Companion** (`brx-companion-spec.md`) | rides the player — game engine + **loot wallet** + powerups + audio | BLE to its gun; ESP-NOW/LoRa to stations |
| **Mission Control** (`docs/mission-control-spec.md`) | operator console — assigns modes, aggregates score | Wi-Fi/MQTT |

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

- **P10** — confirm the BRX IR **damage-value** decode (~7–8 bits) so damage-weighted scoring is exact
  (`docs/FOLLOWUPS.md`).
- **D2** — adopt **LoRa-standard** + **ESP-NOW-with-antenna** as the field/arena baseline (measured).
- IR **emitter range** at each power option — SPL-style test: how far does a capture/respawn beacon
  reach indoors vs. outdoors, Mini (3.3 V) vs. full (5 V port)?
- **Capture debounce / anti-spam** — how many hits, over what window, should flip ownership (utility-box
  "capture tag-count" is 1–1000; pick sane defaults per mode).
- Extraction **channel-reset rule** — pause vs. full reset when the extracting player is killed or
  leaves the zone; tune against the KotH ~5 s recapture window.
