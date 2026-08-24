# Jay's DIY BRX ecosystem (Extreme Laser Tag And More!)

The single most valuable outside source for this project. **Jay** (YouTube
[@extremelasertag3602](https://www.youtube.com/@extremelasertag3602), "Extreme Laser Tag And More!")
has spent years building an ESP32-based DIY ecosystem around BRX — objective stations, in-gun
controllers, radio links, and a field host that ran **45 BRX rifles at once**. His "J" devices
(**JBOX, JCUBE, JBOX Mini, JTOWER, JHALO, JEDGE**) are, in effect, **a proven, shipped instance of
the exact architecture Open BRX is planning**: per-device nodes, IR objective stations, ESP-NOW/LoRa
field networking, browser-based config, store-and-forward.

This doc distills ~30 of his videos (transcript analysis; credit the channel — subscribe/support him).
It complements `grenade.md` (his grenade videos), `lasertagmods.md` (JEDGE/JBOX from LaserTagMods),
and `field-architecture.md` (our range design — now validated by his measured numbers §5).

> **What's ours vs. his:** Jay sells his boards and keeps his firmware his own. We **do not copy his
> code or resell his hardware.** We treat his work as *proof the architecture works* and as a source
> of hard numbers (ranges, timings, mode mechanics) to design our own MIT implementation against.
> Where a mode or device maps onto our plan, that's noted — it's convergent design, not a lift.

---

## 1. The device family (all ESP32-based)

| Device | What it is | Key hardware | Our equivalent |
|---|---|---|---|
| **JBOX** | Full-size IR objective "smart base" | ESP32, OLED, RGB strip, side button, battery+charge, **optional LoRa slot**, optional motion sensor; multiple PCB revs | objective-station node (`game-modes.md` Tier 1) |
| **JCUBE** | Cube "Target"-look base | ESP32, **RGB ring** + OLED, button, battery — best for Targets/KotH (ring shows owner) | objective station (display variant) |
| **JBOX Mini** | Minimum viable base | ESP32 + **IR receiver + 1 RGB LED + IR emitter + resistors**, **USB-powered only, no display/button/battery** → **web-config only** | the $5–10 reference BOM for our station |
| **JTOWER** | Domination/objective tower | ABS-pipe housing, side LED strips, top OLED, Li-ion + **key switch**, gear selector; cross-system | tall/visible objective station |
| **JHALO** | A **BRX headset turned into a respawn/utility box** | a spare **headset + ESP32** running custom firmware — no base hardware; drives the headset over BLE | **respawn station from a spare headset** (reuses gear you own!) |
| **JEDGE** | Field host / configurator | **ESP32 + LoRa**, broadcasts to all guns on one LoRa channel, **no server needed** | Mission Control host / field radio bridge |
| **Configurator** | In-gun controller | dual-MCU: **ESP32 (BLE to gun) + ESP8266 (Blynk phone UI)**, mounted **inside the BRX battery bay**, powered from the tagger's 5V port | the **Companion** (`hardware/brx-companion-spec.md`) |

**Common traits:** every board is an ESP32 (some + ESP8266 or + LoRa). Every base talks to taggers
over **IR** (emit + receive), coordinates with other devices over **ESP-NOW** (short range) or **LoRa**
(long range), and is configured from a phone browser over a **WiFi access point** (§3). Firmware is
distributed as **`.bin` files** and flashed **OTA over the web UI** (§4).

## 2. How a base interacts with taggers (IR)

- The base **emits and receives IR** — the same 980 nm/38 kHz BRX IR the guns use (`brx-extended-user-guide.md`).
- **Capture:** a player *shoots the base's IR receiver*; the base reads the hit's **team + player id** (decoded from the IR payload — only meaningful in hosted/Callsign games; offline ids are randomized) and flips ownership. LED color = current owner (red/blue/green/yellow; green limited to Supremacy offline).
- **Perks/effects:** to heal/boost/respawn/damage a player, the base **emits the matching IR tag back** at whoever shot it (medic tag, boost tag, respawn tag, even a hostile "death" tag).
- **Damage-weighted scoring:** each BRX IR hit carries a ~7–8-bit **damage value** (up to ~256); explosive/grenade tag types score more per hit — so "score by damage" rewards heavy weapons that are slower to bring to the point. (This is a useful, previously-undocumented detail about the BRX IR payload.)
- **IR power caveat (hardware):** on the small/simple board the IR circuit runs off the ESP's **3.3 V** pins (weaker range; "do the math," ~10 Ω resistor); the full board gives the IR emitter a **separate power port** for a stronger beam. The **Mini reportedly has slightly more IR output** than JCUBE depending on power config.

## 3. Configuration model — a phone browser is the UI

Every base is its own **WiFi AP + captive web app** — no app install:
- Join the base's WiFi (SSID e.g. **`JBox 100`**, which changes with the device's **JBox ID** so you can tell units apart), password **`123456789`** (same on all), browse to **`http://192.168.4.1`** (QR codes on the device for Join-WiFi / Access-Menu). **Chrome recommended** (Safari "stopped communicating properly").
- **Pages:** Base Scoring (live score, mirrored on the OLED; **auto-refreshes every 5 s** — deliberately throttled to keep the radio free for tagger comms), Settings (pick **game mode** + **platform** via dropdowns), Debug/Updates (firmware upload, **JBox ID** ~21 options, motion toggle, **RGB type** [strip vs. ring — must match hardware], **LoRa enable**).
- **Timing gotcha:** you have **~45 s** after power-on to reach the menu (each change adds ~20 s), because the device then **drops WiFi and switches to ESP-NOW** to talk to the host. The **JEDGE/host has WiFi always on → no time limit**.
- **Button model** (units with a button): **1 press = next game mode; hold ~5–10 s = change platform** (BRX / LTTO / Evolver-SWAPTX / Laser Ops Pro / Battle Rifle Pro / Laser War).

**→ This is a direct blueprint for our station + Mission Control:** an ESP32 hosting a captive
web UI is exactly how a phone (any phone, even iOS — it's plain HTTP) configures and monitors a node
with zero install. See §7 for the old-phone answer.

## 4. Firmware / OTA (over the web, no cables)

`.bin` files (on Jay's GitHub) → power/reset the device → join its WiFi within the timeout →
`192.168.4.1` → Debug/Updates → upload the `.bin`. **Gotcha:** progress races to **92 %** then crawls;
it is **not done until it says "OTA success"** (still installing) — don't close the page; it reboots
after. Flash **each device individually**. Version string shows at the top of the page.

## 5. Radio range — measured numbers (validates `field-architecture.md`)

Jay's field range tests (RYLR896 LoRa modules; ESP32 "minis" and ESP32-U with external **Molex
antennas**; obstructed trail, *not* clear line-of-sight; stop at first two-way packet loss). This is
the empirical data our field design was missing:

| Link | Range (obstructed) | Round-trip latency | Notes |
|---|---|---|---|
| ESP-NOW standard (bare ESP32) | **~243–251 ft** | **~3 ms** | fast, short |
| ESP-NOW long-range mode | **~343 ft** | ~6 ms | LR trades speed for reach |
| ESP-NOW LR **+ Molex antenna** | **~581 ft** | ~6 ms | external antenna ~doubles range; "covered most of the play area" |
| **LoRa standard/fast mode** | **~1,373 ft, ZERO loss** | **~3.5 s** | **Jay's pick for host↔gun field links** |
| LoRa max-range mode | ~3,321 ft (0.61 mi) | ~12.7 s | but **~1-in-7 packets lost** — not worth it |

**Conclusions (adopt these):**
- **ESP-NOW** for fast, frequent device chatter at arena scale (add an external antenna to ~2× it).
- **LoRa in *standard/fast* mode** for field-scale host↔node links — 1,373 ft with zero loss beat the
  max-range setting's distance-at-unreliability. LoRa is **too slow/narrow for live score sync**
  (multi-second round trips) → **time-sequence low-rate control** over LoRa, keep scoring local +
  reconcile (exactly our store-and-forward model).
- RYLR896 spec claims up to 15 km / ~4 km typical — real obstructed usable range is far lower; design
  to the **measured** ~1,400 ft, not the datasheet.

## 6. Game modes he actually runs (mechanics + numbers)

Validates and extends `game-modes.md`. All of these are BRX-real, not theory:

- **Domination (single base, standalone — no networking):** base boots armed (default 10-min BRX
  domination); shoot it to capture, owner scores **1 pt/s**; steal by shooting it. Score by **Time**
  (1 pt/s), **Shots** (hits/team), or **Damage** (weighted by IR damage value). Limits: none / 3-5-10-15
  min / 300-600-900 targets (900 shots ≈ 15 min). **Clock starts on first hit, not power-on.** BLE base
  keeps scoring even after the phone disconnects — reconnect and it catches up (proves standalone
  store-and-forward).
- **Multi-Point Domination (bases share state):** N bases = N pts/s when one team holds N. Bases
  **notify each other**; with JEDGE, in-gun ESP32s relay end-of-game over **ESP-NOW** — codes
  **`1410`** = game over (last digit = winning team) and **`1433`** = "closing in on victory" warning
  broadcast to all taggers.
- **Long-Range Multi-Base Domination (LoRa):** **1 master + up to 9 slaves (10 stations)**; master
  tallies all, tells slaves enable/disable, all stop at the limit. Demoed through a concrete building
  ~200 s walk apart — neighborhood scale.
- **Ultimate King of the Hill (host + up to 21 boxes):** roles assigned by base count and
  **randomized every round** — 1 base = the hill; 2 = hill + spawn; 3+ = adds Boost / Health / **Mystery**
  stations. Capture the **white glowing hill**, then **hold it (recapture within ~5 s window)**; holding
  **45 s = 1 point**, then **all bases swap role + location** (re-scout each round). Stations: Medic
  (heal if not full), Boost (weapon upgrade / ~20 s invuln shield), Respawn, **Mystery** (looks like a
  boost, actually a hostile/death base — risk/reward).
- **Tug of War:** holding a base adds your time and **drains opponents'** (floor 0, no negative); first
  to **5 min** wins; ESP-NOW cancel broadcast ends all taggers together.
- **Battle Royale:** 30 s start countdown → a **storm** deals damage every couple seconds; bases are
  **checkpoints emitting a "safe" IR** valid **30 s**, obtainable **once per 30 s** → keep returning or
  die. **Loot boxes** pulse a random weapon offer; tagger announces it, **~10 s to press SELECT** to
  accept; secondary weapons have **finite ammo**, pistol stays unlimited.
- **IR weapon pickups (standalone):** ESP32 + IR LED, select-to-confirm — adds a finite-ammo secondary
  slot, no host needed.
- **Utility / Smart Box (one reconfigurable station):** respawn / medic / armor / shield / **star power**
  (temp regen + rapid fire, from the KotH grenade code) / ammo / random weapon / **proximity mine** /
  gas / alarm / loot / control-point. Settings: **team alignment** (or shooter-gets-the-perk in FFA),
  **emit frequency** (1–30 s), **cooldown/lockout** (up to ~30 min), **capture tag-count to activate**
  (1–1000 shots), and an **activation/life limit** (e.g. a **team-wide life pool** — 30 respawns total
  — for offline BR/deathmatch). This one box is essentially our whole "objective-station primitive."
- **"All modes unlocked" (tagger-native list):** FFA/Deathmatch, Team, Supremacy, Survival (original
  four) **+ Generals, Commanders, The Swarm** (respawn-only roles). **General** ≈ +150 HP, respawns
  teammates who trigger at them; **Hive Queen** (Swarm) has a **chainsaw melee that pulses damage** to
  anyone nearby. Weapons: M4, SR-100 sniper, SMG X3, AT-87 shotgun, MG7, CAR-33, TAR-33 (+silenced).

**Standalone vs. networked:** single-base Domination, Utility-Box effects, and IR weapon pickups need
**no base↔base link**. Multi-Point Domination, Long-Range Domination (LoRa), Ultimate KotH, Tug of
War, and hosted Battle Royale need **base↔base networking** (ESP-NOW near, LoRa far). This maps
1:1 onto our infrastructure tiers in `game-modes.md`.

## 7. Feasibility in *our* tier system — and what an old phone can do

Jay's ecosystem is the proof-of-existence for our `build-tiers.md` spend ladder. Mapping:

| Our tier (`build-tiers.md`) | Jay's proof it works | What we build (MIT, our own code) |
|---|---|---|
| **$0 — phone/laptop + guns you own** | Callsign + BLE control; his BLE domination base scoring standalone | Web-Bluetooth per-player node + Mission Control (Tier 0 modes, incl. the new syphon/shield variants) |
| **+ objective stations** | **JBOX Mini** = ESP32 + IR rx/tx + 1 RGB + resistors (~$5–10) | our objective-station node — one primitive covers KotH/CTF/Domination/Assault/CS |
| **+ respawn stations** | **JHALO** — a **spare headset + ESP32** becomes a respawn box | reuse a headset you own as a respawn/data-mule station |
| **+ in-gun companion** | **Configurator** — ESP32(+ESP8266) inside the battery bay, BLE to the gun, 5 V from the tagger | our **Companion** (ESP32-S3) — offline engine + powerups + audio |
| **+ field radio** | **JEDGE** ran **45 guns on one LoRa channel, no server**; measured ESP-NOW/LoRa ranges (§5) | ESP-NOW (arena) + LoRa-standard (field) bridge with store-and-forward |

**Key validation:** one host reached **45 BRX rifles simultaneously** — our scale story isn't
hypothetical. And a **standalone base scores through a phone disconnect** — our store-and-forward
assumption is real hardware behavior.

### What can an old phone do? (direct answer)

A spare/old phone is genuinely useful at several jobs — with one hard platform split:

1. **Per-player node + HUD (Android only):** Android **Chrome supports Web Bluetooth**, so an old
   Android phone runs the browser-based player engine/HUD against its own gun — no app store, no
   install. **iOS Safari has NO Web Bluetooth** → an iPhone needs a wrapper browser (**Bluefy**) or a
   native app. (This is exactly `phone-app-spec.md`.) One browser tab reliably drives **one gun** (BLE
   central limits) → old phone = *per-player* node, not a 45-gun hub.
2. **Operator console / config screen (ANY phone, even iOS):** connect the phone to an ESP32 base's
   **WiFi AP** and open `192.168.4.1` — it's plain HTTP, so **any** browser works. An old phone is a
   zero-install config + live-score screen for any station (Jay's model, §3).
3. **Base status screen (your earlier idea — works):** tape an old phone to a base, load its web score
   page (auto-refreshes every 5 s) → a live objective display for free.
4. **Mission Control terminal:** an old phone/tablet on the field WiFi runs the browser Mission
   Control app (roster/teams/scoreboard) against the host — no BLE needed for this role.
5. **What it *can't* do well:** be the central hub for many guns at once (BLE central limits + iOS
   Web-BLE gap), or run heavy always-on radio bridging (that's an ESP32/Pi job, not a phone's).

**Bottom line for an old phone:** excellent as a **per-player node (Android)**, a **universal
zero-install config/score screen (any phone, via a base's web AP)**, and a **Mission Control
terminal** — which means the cheapest real deployment is *phones you already own for players +
a handful of ~$8 ESP32 stations*, with a Pi or JEDGE-style host only when you scale to field radio.

## 8. What this changes for us (open items)

- **Adopt LoRa-*standard* mode + ESP-NOW-with-antenna** as the field radio baseline (§5) — folded into
  `field-architecture.md`.
- **JBOX Mini BOM** (ESP32 + IR rx/tx + RGB + resistors, USB-powered) is our objective-station
  reference design; **JHALO** (spare headset + ESP32) is our respawn-station reference.
- **IR damage-value in the payload** (~7–8 bits, ≤256; explosive tags score higher) is a real BRX IR
  detail to confirm on capture and exploit for damage-weighted scoring.
- **Captive-web-AP config** (ESP32 hosts `192.168.4.1`) is our zero-install station/MC UI pattern.
- New followups tracked in `../FOLLOWUPS.md` (research-derived).

*Source: transcript analysis of ~30 videos from the "Extreme Laser Tag And More!" YouTube channel.
Numbers are Jay's stated/measured figures; treat as field-reported until we reproduce them.*
