# 01 · Meet the BRX  (section slug: /manual/hardware)
**Last verified:** 2026-08-27
**Audience:** new owners, event hosts and tinkerers who want to know exactly what they are holding before they turn it on · **Goal of this section:** name every part of the tagger, headset and accessories, explain what each light and port means, and set the mental model (a dumb, stateless IR instrument) that every later section builds on.
**Provenance legend:** ✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the Callsign APK · 👥 community-reported — nothing unconfirmed is published; see Research backlog at the end.

**Credits used throughout this section:** Battle Company (BRX Manual V7, BRX Extended User Guide 2018 — linked, not rehosted) · LaserTagMods (JEDGE/JBOX — the original protocol discovery) · the BRX owners' community · Jay / Extreme Laser Tag And More! (grenade and accessory videos).

---

## Pages

### Page: The BRX at a glance  (`/manual/hardware/overview`)
_A rifle-form laser tagger, a wireless sensor headset, and a smart grenade — and everything they are not._

[hero] The Battle Company BRX is a rifle-form-factor infrared laser tagger paired with a wireless sensor headset. 📖 It fires a 980 nm, 38 kHz coded IR pulse, plays 2,000+ on-board sounds through its own speaker, and shows state on a small bank of LEDs — no screen, no WiFi, no memory of the game it just played. ✅ src: docs/reference/brx-extended-user-guide.md, docs/reference/edge-brp.md, protocol/brx-protocol.md §7n

[image HW-01] (see Images table)

[stat-row] Four numbers that define the BRX:
- **980 nm / 38 kHz** — the IR carrier every shot rides on 📖
- **~600 ft** — typical maximum range; better in shade and at night, roughly halved in bright sun 📖
- **~8 h** — play time per charge 📖
- **2,000+** — sound effects and voice lines stored on the tagger (2,166 ids catalogued) ✅
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, protocol/callsign-extract/ (sound bank)

[cards] "The system, in three objects" — 3 cards:
- **Tagger** — the rifle. Emits IR, carries a hit sensor on its body, the speaker, the sound bank, the battery, the radio (Bluetooth) and all the game logic for a stock game. 📖 ✅
- **Headset** — the head-worn sensor band. Catches most incoming tags (it is the bigger target), lights up for feedback, links wirelessly to its own tagger, and gates whether the tagger is allowed to fire. 📖 ✅
- **Smart Grenade** — an optional IR broadcaster with a button and a status LED. Throwable blast weapon *or* a portable objective (respawn point, hill, flag). ✅
src: docs/reference/brx-manual-notes.md, docs/reference/grenade.md

[callout:info] **What the BRX is NOT** — this shapes everything else in the manual.
- **No screen.** Ammo and health are shown only by LEDs and voice lines. The commercial Battle Rifle Pro has an LCD; the BRX does not. 📖
- **No WiFi.** The only radio to the outside world is Bluetooth (Classic on Gen1, BLE on Gen2/3). 📖 ✅
- **Keeps no game state.** A power-cycle wipes any configuration pushed to it, it never reports a score, and stock play is non-scoring out of the box — "how do I see my score?" is the first question at every game. ✅ 👥
- **No headset cable.** The headset is wireless; there is no headset jack on the tagger. 📖 ✅
- **No user-serviceable flash.** Firmware can be written over USB but never read back (write-only bootloader). ✅
src: docs/reference/edge-brp.md, protocol/brx-protocol.md §1 §7c §7n, docs/reference/community-notes.md

[quote] "A gun whose headset is off, unpaired or flat silently refuses to join — no error, no voice line." — the single most common cause of a wasted game start, from our field notes. ✅ src: docs/gotchas.md

---

### Page: The tagger, part by part  (`/manual/hardware/tagger`)
_Every button, port, emitter and light on the rifle — and what it is actually for._

[diagram HW-02] Annotated tagger anatomy — labels overlaid in HTML as hotspots (see Images table).

[cards] "Controls at a glance" — 6 cards:
- **Trigger** — fires; before a game it also cycles weapons/characters and confirms menu picks. Has a mechanical switch you can continuity-test if it stops firing. 📖 👥
- **Reload handle** (right side, screws on) — pull to reload; **pulling it is also how a stock game starts**. A small mechanical switch sits under two screws beneath it. 📖
- **ALT button** (orange) — cycles perks pre-game; **hold 3 s** toggles indoor/outdoor mode. 📖
- **SELECT** — advances settings menus; **hold while powering on** to enter USB disk mode for firmware/sound updates. 📖
- **LEFT / RIGHT** (directional pad) — cycle game modes and teams; **hold LEFT at power-on** = target (sighting) mode; **hold RIGHT at power-on** = accessory/headset pairing mode; **hold LEFT+RIGHT 5 s** in-game = reset to menu. 📖 👥
- **Power switch** — a slide switch by the barrel. A tagger that randomly powers on/off usually has a worn one. 📖 👥
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

[callout:tip] **There is no fire-mode selector.** Fire mode (full-auto, single-shot, 3-round burst, hold-to-charge, melee) is a property of the *weapon* you select, not a switch on the gun — it is stored inside the weapon definition. ✅ src: protocol/brx-protocol.md §"$WEAP t20 — FIRE MODE"

[table] Ports — columns: Port | Where | What it is | Confidence
- Charging port | body | DC input for the **8.4 V two-cell smart charger** that ships with the tagger; charger LED goes red → green when full | 📖
- micro-USB "Programing Port" | body | Two personalities: on a normal boot it is a **USB serial console** (the tagger's Teensy microcontroller shows up as a COM port — "PuTTY into the tagger"); with **SELECT held at power-on** it becomes a **USB disk** exposing the firmware `.BIN` and the `AUDIO` folder | ✅ 📖
- Headset jack | — | **None.** The headset links wirelessly | ✅
- Accessory port | — | **None** on Gen2/3 units we have opened up to the connector level — micro-USB only | ✅
src: protocol/brx-protocol.md §7c, docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

[accordion] "What's inside (for the curious — you do not need to open it)"
- **Microcontroller:** a PJRC **Teensy** (ARM). The USB port enumerates as "Teensyduino USB Serial". ✅
- **Radio:** a Bluetooth module bridged to the MCU's serial port — which is why BLE and a wired UART speak identical frames. Board label on our units: `PCB-5`, `BTchip-4`. ✅
- **Sound storage:** an SD card on the mainboard — it is never removed for sound updates (they go over USB). 👥 📖
- **Speaker:** a "pop" from the speaker at boot means speaker power is fine. 👥
- **Warning:** unplugging the battery before *any* internal work is mandatory — a live pack during a mod is the classic way to kill a mainboard. 👥
src: protocol/brx-protocol.md §7c, docs/experiment-log.md (QUERY dump), docs/reference/community-notes.md

[image HW-05] (ports close-up — see Images table)

---

### Page: The IR emitter, the sight, and the sensors  (`/manual/hardware/ir-and-sensors`)
_The invisible beam that carries every tag — its published specs and what we measured._

[spec-sheet] IR emitter (Class 1 laser, IEC 60825-1) — from Battle Company's Extended User Guide 📖:
- Wavelength: **980 nm** (note: many hobby IR parts are 940 nm — pick 980 nm-capable receivers for anything you build)
- Pulse width: **6.5 µs**
- Energy per pulse: **111 nJ**
- Pulse repetition (carrier): **38,000 Hz**
- Beam: **< 18 mm at the aperture**
- Factory record on one of our units reports the laser at **16.9 mW** ✅
src: docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7c

[table] What a shot looks like on the air (bench-measured) — columns: Property | Value | Confidence
- Frame | one ~25-bit word per shot, pulse-width encoded | ✅
- Sync pulse | ~1,990 µs | ✅
- "1" mark / "0" mark | ~990 µs / ~500 µs | ✅
- Carried in every shot | player id (0–63), team, damage, damage type, crit flag | ✅
- Receiver that decodes it | any 38 kHz demodulating IR receiver (community IDs the Vishay TSSP38 in the headset) | ✅ 👥
src: protocol/brx-ir-protocol.md, docs/reference/lasertagmods.md

[callout:info] **Range and light.** Typical maximum is ~600 ft; range *drops* in full sun and *improves* in shade or at night. Bright sunlight roughly **halves the gun's hit radius** because of IR-noise filtering. Indoor mode deliberately shrinks explosion/melee range. 📖 src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[callout:warn] **You cannot see the beam.** A phone camera will not show a low-power 38 kHz IR emitter — both cameras showing nothing is consistent with a working gun. Use a receiver (or another tagger) to test, never a camera. ✅ src: docs/gotchas.md

[cards] "Where you can be tagged" — 3 cards:
- **Headset domes** — the primary target. Our bench distinguishes a **front** and a **back** dome on the wire; Battle Company sells front/left/right sensor boards as spares. ✅ 👥
- **Gun body sensor** — a hit sensor on the rifle itself. ✅ 📖
- **Which sensor caught it is reported** — at field distance, the tagger knows whether a tag landed front, back or on the gun. Point-blank, IR floods every receiver and the distinction is unreliable. ✅
src: protocol/brx-protocol.md §"$HIR token 1 — sensor id map", docs/reference/community-notes.md

[accordion] "The sight"
- The tagger's sight carries a **green kill-confirm flash**: when you score a kill, the sight lights green for a few seconds. ✅
- **Sighting a scope** is done in **Target Mode** (hold LEFT while powering on): zero damage, unlimited ammo, and a direct hit flashes the target's headset green. Community practice: sight snipers long (300–400 ft), shotgun/SMG close (50–100 ft). 📖 👥
src: protocol/brx-protocol.md §7o, docs/reference/brx-manual-notes.md, docs/reference/community-notes.md

[image HW-09] (IR waveform illustration — see Images table)

---

### Page: Lights and what they mean  (`/manual/hardware/leds`)
_The gun's LED bank and the headset's ring — read them like a dashboard._

[callout:info] Two separate LED systems: the **gun** LEDs (a small bank on the rifle) and the **headset** LEDs (a ring of bright green hit LEDs plus addressable RGB). They answer different questions. ✅ src: docs/experiment-log.md (2026-08-27)

[table] Gun LEDs — columns: What you see | Meaning | Confidence
- Colour while in the menu | **Selected game mode**: Free For All white · Death Match red · Generals yellow · Supremacy blue · Commander pink · Survival green · The Swarm orange | 📖
- Colour during a game | **Your team / faction colour** (e.g. team 1 blue, team 2 yellow on our bench) — colour is team-derived, not a free-form RGB | ✅
- Colour palette available | 9 colours reported by the community: red · blue · yellow · green · purple · cyan · white · pink · orange | 👥
- Segments going out | **A life gauge**: the three LEDs act as a segmented bar that drains as you take damage | ✅
- Manual's description | "LED indicator shows ammo & health" | 📖
- Slow blink in team colour | An externally-hosted game that has not switched on the life gauge | ✅
src: docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7i, docs/experiment-log.md (LED life mode, 2026-08-27)

[diagram HW-10] (gun LED gauge states — see Images table)

[table] Headset LEDs — columns: Pattern | Meaning | Confidence
- **Slow rainbow cycling** | **Disconnected / not paired** to a tagger. Visible across a room — check every headset before a game starts | ✅
- **Solid / pulsing team colour** (red, blue…) | Paired and synced to the tagger — **pre-game only** | ✅
- **Dark** | **Normal during play.** The band goes dark once the game starts; dark is not a fault | ✅
- **Green blink** | Hit feedback | ✅
- **Holds green** | Kill feedback | ✅
- **Green flash in Target Mode** | A direct hit on the sighting target | 📖
- **Bright green burst** (4 directions) | The 3 W hit LEDs — meant to be visible in daylight; dimmed in indoor mode | 📖
src: docs/experiment-log.md (2026-08-27, "the HEADSET LED is autonomous"), docs/field-process.md, docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

[callout:warn] **An earlier version of our own notes had this wrong.** Green is *hit/kill feedback*, not a death signal, and team colour shows *only before* the game starts. If you read "green = dead" elsewhere, it came from the older reading. ✅ src: docs/experiment-log.md (2026-08-27 correction)

[callout:tip] The headset LEDs are **autonomous** — they do this on their own, in stock games and in externally-hosted ones alike. Nothing needs to be configured to get them. ✅ src: docs/experiment-log.md

[accordion] "For modders: what the headset LEDs are"
- The addressable RGB LEDs are **WS2812B 5050** (NeoPixel-compatible), wired as a **series** string on the BRX headset (parallel on the SwapTX variant). One data line, 5 V and ground. 👥
- Indoor mode dims the green hit LEDs and enables the RGB LEDs. 📖
src: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md

[image HW-04] (headset LED states strip — see Images table)

---

### Page: The headset  (`/manual/hardware/headset`)
_A wireless sensor band that decides whether your tagger is allowed to shoot._

[hero] The headset is not an accessory — it is half of the system. It catches most tags, gives visible feedback to the shooter, and the tagger **refuses to fire when its headset drops mid-game**. 📖 👥 src: docs/reference/brx-manual-notes.md, docs/reference/community-notes.md

[image HW-03] (see Images table)

[cards] "What's on the headset" — 6 cards:
- **Sensor domes** — IR receivers around the band; the wire reports **front** vs **back** dome hits separately. ✅
- **Green hit LEDs** — 3 W, four directions, daylight-visible. 📖
- **RGB ring** — WS2812B addressable LEDs for team colour, rainbow-when-unpaired and feedback. 👥 ✅
- **Front IR emitter** — the headset can *emit* too: the melee gesture (v2 "logo" units) and respawn-station requests fire from the front of the headset. 📖 ✅
- **Small button** — used in the Gen-3 re-pair procedure and in "install accessory" pairing. 👥
- **PROGRAM pin** — a recessed button held at power-on to put the headset into USB disk mode for firmware updates. 📖
src: protocol/brx-protocol.md §"$HIR token 1", docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/grenade.md

[table] Headset facts — columns: Item | Detail | Confidence
- Link to tagger | Wireless; pairs automatically after power-on. Can take **up to 3 minutes** with many taggers/BT devices around | 📖
- Anti-cheat lockout | Headset drops after game start → tagger locks until it reconnects. Booted with **no** headset → tagger shoots fine locally | 📖 ✅
- Apps need it | The official phone app silently disconnects a tagger that has no linked headset; an externally-hosted game cannot hold a link to a headset-less gun either | ✅
- Battery | Single **18650** lithium cell (v2 headsets); charges from **any USB 5 V** source; v1 has a slide compartment | 👥 📖
- Firmware | Reported by the tagger as `hds.59` on our units | ✅
- Extra functions | Offline short-range scoring and player-proximity detection | 📖
- Spares Battle Company sells | Speakers, sensor circuit boards (front/left/right, "HS 2.0"), a 19" 2-pin wire bundle | 👥
- Water | Taggers usually survive a soaking after days of drying; **headsets usually do not** | 👥
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7m §7r, docs/reference/community-notes.md

[callout:tip] **Before every game: look for rainbow.** A slowly rainbow-cycling headset is unpaired, and its tagger will silently refuse to join a hosted game. Five seconds of eyeballing saves the whole round. ✅ src: docs/gotchas.md, docs/field-process.md

---

### Page: Battery and power  (`/manual/hardware/battery`)
_A 7.4 V two-cell pack with one nasty surprise: the connector polarity is backwards._

[spec-sheet] Tagger battery 📖 👥:
- Chemistry / pack: **7.4 V Li-ion, ~2,200 mAh**, two cells
- Connector: **2-pin** (aftermarket 3-pin packs fit — the third pin is a thermistor the BRX ignores)
- Charger: the supplied **8.4 V two-cell smart charger**; LED red while charging → green when full
- Play time: **~8 h**
- Alternative: **6 × AA** alkaline. **Never rechargeable AAs.**
- Swap: one screw near the reload switch
- Live readout on the wire: a pack voltage, cell voltage and state-of-charge % every ~30 s (e.g. 7.52 V pack / 3.96 V cell / 43 %) ✅
src: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/experiment-log.md (2026-08-24)

[callout:warn] **POLARITY IS REVERSED.** Battle Company wires the pack connector opposite to the usual convention. Verify with a meter before wiring any replacement pack, external charger or adapter — getting it wrong can destroy the mainboard. 👥 src: docs/reference/community-notes.md

[image HW-06] (battery pack + connector — see Images table)

[cards] "Power habits that keep a fleet alive" — 4 cards:
- **Charge outside the gun** — community practice: splice a BRX AC adapter onto a spare connector, keep a stack of charged packs, swap in the field. 👥
- **Keep them topped up** — the stock firmware **stops re-pairing Bluetooth below a battery threshold**, which quietly drops players out of hosted games. 👥
- **Rest the guns between sessions** — a tagger left powered all day can enter the "screamer" state (loud buzz, refuses connections) until rebooted and rested. 👥 ✅
- **Riding electronics** — pulling under ~300 mA from the tagger for an add-on is fine (confirmed by Battle Company); anything bigger should carry its own power bank. 👥
src: docs/reference/community-notes.md, docs/gotchas.md, docs/experiment-log.md (2026-08-26 screamer)

[table] Headset power — columns: Item | Detail | Confidence
- Cell | one 18650 lithium cell (v2) | 👥
- Charging | any USB 5 V supply | 📖
- Voltage readout | reported through the tagger's USB console (e.g. "Head: 3.84 V") | ✅
src: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7c

---

### Page: Generations — which BRX do you have?  (`/manual/hardware/generations`)
_Gen1 speaks Bluetooth Classic; Gen2 and Gen3 speak BLE. Here is how to tell in 30 seconds._

[compare] Gen1 vs Gen2/3 — columns: Feature | Gen1 | Gen2 / Gen3
- Radio | **Bluetooth Classic (SPP)** via an HC-05-class module, 57,600 baud ✅ 👥 | **Bluetooth Low Energy**, Nordic UART Service, 115,200 baud ✅
- How it shows up | Pairs as a classic BT serial device; guide-era name `LTP-alpha`, pair code `0001` 📖 👥 | Advertises as `Tactix-XXXX` (XXXX = last two bytes of its address); the UART service is visible in a BLE scan ✅
- Phone support | v1 app was Android-only 📖 | iOS and Android
- Headset requirement for the radio | Headset must be connected for Bluetooth to work 👥 | A headset-less gun accepts a link then drops it within seconds ✅
- "Logo" vs "non-logo" | Non-logo units need extra steps after firmware/disk mode and a pair code 📖 | Logo units need no password and have the gesture (melee-swing) headset 📖
- Everything else | Same IR, same sounds, same game modes | Same
src: protocol/brx-protocol.md §1 §7a §7r, docs/reference/brx-extended-user-guide.md, docs/reference/lasertagmods.md

[steps] "Identify your generation"
1. Power on the tagger with its headset on and paired.
2. Run a BLE scan on a phone or laptop (any BLE scanner app). **A `Tactix-…` device advertising a Nordic UART service = Gen2/3.** ✅
3. Nothing on BLE, but the tagger appears as a classic Bluetooth serial device in your phone's Bluetooth settings = **Gen1**. ✅
4. For the exact firmware, plug the micro-USB port into a computer and open the serial console; the `QUERY` record lists gun firmware (ours: `v4.32`), headset firmware (`hds.59`), board revision (`PCB-5`) and Bluetooth chip (`BTchip-4`). ✅
src: protocol/brx-protocol.md §1 §7c

[callout:info] **Gen2 vs Gen3** are, to every tool we have, the same over the air — both are BLE/Nordic-UART. The distinguishing feature the community relies on is the **Gen-3 headset**, which has its own re-pair procedure (headset button held + RIGHT at tagger power-on → "PAIRING MODE"). Covered in the Pairing section. 👥 src: docs/reference/community-notes.md

[callout:warn] **Firmware note.** Firmware v4.30+ was a "makeover" update: it wipes configuration, breaks headset pairing until re-set-up, and needs a completely new audio file set. Our own units run `v4.32` with a `devhost` build string that the official Callsign app refuses ("supported version is until v2.01e"). Firmware **cannot be backed up** — the bootloader is write-only — so never reflash without Battle Company's original image in hand. 👥 ✅ src: docs/reference/community-notes.md, protocol/brx-protocol.md §7b §7c

[diagram HW-08] (two radios — see Images table)

---

### Page: Grenade and accessories  (`/manual/hardware/accessories`)
_What each add-on physically is. How to use them lives in the Accessories & Stations section._

[image HW-07] (see Images table)

[cards] "Smart Grenade — anatomy" — 6 cards ✅:
- **Top button** — power on, mode setup (hold), and manual detonation / respawn trigger.
- **Safety clip** — pop it to power up.
- **3 IR emitters + 1 emitter/receiver** — it *broadcasts* over IR (state beacons every few seconds) and *receives* shots (it flashes white when hit).
- **Status LED** — green at boot = ready; in setup it cycles **red · green · blue · yellow · white** (Frag · Assault · Hill · Respawn · CTF); white when a mode locks; on boot it flashes the stored mode's colour for ~1 s.
- **USB-C** — **charge/power only.** It exposes no data interface (tested off, on and in setup mode on a known-good cable) and has no PROGRAM pin.
- **No pairing for objective modes** — as a respawn point, hill or flag any tagger interacts with it over IR. IR pairing is only needed to use it as a *thrown* grenade tied to your headset.
src: docs/reference/grenade.md, docs/reference/brx-extended-user-guide.md

[callout:info] The grenade, like the tagger, **keeps no game state and cannot show a winner** — it is an IR objective/effect emitter. Everything you *hear* from a grenade event (explosion, "control point captured", the CTF music) is actually played by the taggers and headsets from their own sound banks. ✅ 👥 src: docs/reference/grenade.md

[table] Other accessories — columns: Item | What it is | Confidence
- **Hatchet, shield, sidearm** | IR-paired accessories (paired the same way as a thrown grenade); each has a PROGRAM button for USB firmware updates | 📖
- **Scope** | An optical sight; zeroed using the tagger's Target Mode. Snipers sight long, shotgun/SMG short | 📖 👥
- **Phone bracket** | Mounts a phone for the Callsign app. The community also uses it to carry an ESP32 + USB power bank rider (JEDGE-style) with **no permanent modification** to the tagger — a 5,000 mAh pack runs such a rider ~15 h | 👥
- **Sling mount** | Community drill size for a sling stud: **7/32"** (15/64" is too loose) | 👥
- **Utility Box (UBox)** | Battle Company's commercial station: one networked box reconfigured in software into 20+ roles (domination, CTF, bomb, respawn, dispensers, targets). Part of the EDGE commercial suite, not the BRX consumer kit | 📖
- **3D-printed skins** | The dominant cosmetic mod; paint is rare (black plastic primer base coat if you do) | 👥
src: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/lasertagmods.md, docs/reference/edge-brp.md

[accordion] "Known wear points (anatomy-level; fixes are in Repairs)"
- **D-pad buttons** — the plastic cracks with use; the most common failure. 👥
- **Power switch** — random power on/off almost always means the switch. 👥
- **Reload handle** — can bind; a thin nylon washer and silicone lube fix it. Its switch is testable with a pen. 👥 📖
- **IR emitters** — do eventually die; the emitter and headset receivers are separately replaceable parts. 👥 📖
src: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md

---

### Page: Spec sheet and what's in the box  (`/manual/hardware/spec-sheet`)
_One page to print._

[image HW-11] (what's-in-the-box flat lay — see Images table)

[spec-sheet] BRX tagger:
- Form factor: rifle-style, ABS shell, reload handle on the right 📖
- Controls: trigger · reload handle · ALT (orange) · SELECT · LEFT/RIGHT · power slide switch 📖
- Emitter: Class 1 IR laser, 980 nm, 38 kHz, 6.5 µs pulses, 111 nJ/pulse, <18 mm beam at aperture 📖
- Range: up to ~600 ft; best in shade/night 📖
- Sensors: hit sensor on the body + wireless headset 📖
- Indicators: LED bank (mode / team / life gauge) + green kill-confirm in the sight ✅ 📖
- Audio: on-board speaker; 2,000+ SFX and voice lines; sound pack replaceable over USB ✅ 📖
- Radio: Bluetooth Classic (Gen1) / BLE Nordic UART (Gen2/3) ✅
- Ports: charging port · micro-USB programming port ✅ 📖
- MCU: PJRC Teensy ✅
- Battery: 7.4 V ~2,200 mAh Li-ion (2-cell, reversed polarity) or 6×AA; ~8 h play 📖 👥
- Manufacturer: Laser Tag Pro / Battle Company, Oak Creek, WI 📖
src: all reference docs listed under Sources

[spec-sheet] BRX headset:
- Sensors: IR receiver domes around the band (front/back distinguished on the wire) ✅
- Feedback: 3 W green hit LEDs (4 directions) + WS2812B RGB ring 📖 👥
- Emitter: front IR emitter (melee gesture, respawn requests) 📖
- Link: wireless auto-pair to its tagger; up to 3 min in crowded RF 📖
- Battery: 1 × 18650; USB 5 V charging 👥 📖
- Firmware: USB disk mode via PROGRAM pin 📖

[spec-sheet] Smart Grenade:
- Top button · safety clip · 3 IR emitters + 1 emitter/receiver · RGB status LED · USB-C (charge only) ✅
- 5 modes: Frag · Assault · Hill · Respawn · CTF ✅

[table] What's in the box (typical retail kit) — columns: Item | Notes | Confidence
- Tagger | with reload handle (screws on) | 📖
- Wireless headset | pre-paired to its tagger at the factory (the tagger's record stores the headset's serial as its pairing PIN) | ✅ 📖
- 8.4 V two-cell smart charger | red → green LED | 📖
- Quick manual (V7) | link: Battle Company's BRX Manual V7 PDF | 📖
- Optional | 6×AA battery holder use, scope, phone bracket, smart grenade | 📖 👥
src: docs/reference/brx-manual-notes.md, protocol/brx-protocol.md §7c

[callout:info] **Official documents** (linked, not rehosted): Battle Company *BRX Manual V7* (battlecompany.com, 2021) and the *BRX Extended User Guide* (Laser Tag Pro, 2018). The PDFs are the manufacturer's word; where we mark ✅ we measured it ourselves. src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

---

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| HW-01 | Overview — hero | The full tagger, three-quarter view from the right (reload handle side), headset resting beside it on a dark surface; low key lighting so the LED bank and sight are visible. | REAL PHOTO | Owner shoot | — |
| HW-02 | Tagger, part by part — anatomy diagram | Clean unlabeled side-profile render of a rifle-style tagger; hotspots for trigger, reload handle, ALT, SELECT, LEFT/RIGHT, power switch, emitter, body sensor, LED bank, sight, speaker, charging port, micro-USB. Labels overlaid in HTML as hotspots. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a modern black rifle-style laser-tag tagger in exact side profile, right side facing the viewer, rendered as a crisp technical illustration with thin electric-blue edge highlights, a small three-LED bank on the receiver, a compact optical sight on top, a short charging-handle style lever on the side, and a barrel-tip emitter lens. Plenty of empty margin around the object for callout lines. |
| HW-03 | Headset — hero | The headset alone, front three-quarter, LEDs lit in a team colour (pre-game state) so the domes and RGB ring read clearly. | REAL PHOTO | Owner shoot | — |
| HW-04 | Lights — headset states strip | Five identical small headset icons in a row, each with a different LED state: rainbow cycle, solid blue, dark, green blink, green hold. Labels overlaid in HTML. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; wide 21:9 strip. Subject: five identical minimalist front-view icons of a black laser-tag headset with a ring of sensor domes, evenly spaced in a row. Left to right the ring glows: a soft rainbow gradient; solid electric blue; completely unlit; a bright green pulse with a subtle blur; steady bright green. Consistent flat lighting, generous spacing between icons. |
| HW-05 | Tagger — ports | Macro of the port area: charging jack and micro-USB programming port side by side, with the SELECT button in frame. | REAL PHOTO | Owner shoot | — |
| HW-06 | Battery — pack and connector | The removed 7.4 V pack with its 2-pin connector, laid next to the open battery bay and the 8.4 V charger plug; connector pins clearly visible for the polarity note. | REAL PHOTO | Owner shoot | — |
| HW-07 | Accessories — grenade | The smart grenade with safety clip, top button and IR windows visible; LED lit green (ready). USB-C port in frame. | REAL PHOTO | Owner shoot | — |
| HW-08 | Generations — two radios | Abstract diagram: two tagger silhouettes, one emitting a wide classic-Bluetooth wave pattern, one emitting sparse BLE-style pulses; a phone silhouette between them. Labels overlaid in HTML. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: two simplified silhouettes of a black rifle-style laser-tag tagger facing inward from the left and right edges, a minimalist smartphone outline centred between them. From the left tagger, dense continuous concentric amber radio arcs; from the right tagger, sparse short electric-blue radio pulses. Thin line-art, generous negative space. |
| HW-09 | IR and sensors — waveform | Illustration of a coded IR pulse train: one long sync pulse followed by a series of long and short marks, drawn as a clean oscilloscope-style trace. Labels overlaid in HTML. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a single horizontal oscilloscope-style digital trace in electric blue on a faint grid: starting with one wide pulse about four units long, then about twenty-five narrower pulses alternating between two widths (one unit and two units) with equal one-unit gaps, ending in a very short pulse. One amber highlight band over the wide first pulse. Crisp, minimal, no other elements. |
| HW-10 | Lights — gun LED gauge | Three-frame strip of the gun's three-LED bank: all three lit, then two, then one, same colour throughout; segment-gauge feel. Labels overlaid in HTML. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; wide 21:9 strip. Subject: three identical close-up crops of a small three-LED indicator bank set into matte black textured plastic, in a row. Frame one: all three LEDs glowing violet. Frame two: two LEDs glowing violet, the third dark. Frame three: one LED glowing violet, the other two dark. Soft realistic bloom around lit LEDs. |
| HW-11 | Spec sheet — what's in the box | Top-down flat lay: tagger, headset, charger, reload handle, quick manual, optional grenade and phone bracket arranged on a dark surface. | REAL PHOTO | Owner shoot | — |

## Interactive ideas (optional, ≤5)
1. **Hotspot anatomy** (HW-02): hover/tap each part for its one-line role and a "hold at power-on does…" table for the buttons.
2. **"What is my LED doing?" decoder**: pick gun or headset, pick the pattern you see (rainbow, dark, green blink…), get the meaning and the next thing to check.
3. **Generation identifier**: a three-question wizard (BLE scan shows `Tactix-…`? classic BT pairs? logo on the shell?) that ends on Gen1 / Gen2-3 with the right pairing page link.
4. **Spec sheet copy/print**: one-click copy of the spec block as plain text, and a print stylesheet for the page.
5. **Power planner**: enter number of taggers and hours of play; outputs packs to charge and a "rest the fleet" reminder based on the ~8 h / screamer facts.

## Sources used
- `docs/reference/brx-manual-notes.md` — distilled Battle Company BRX Manual V7 (controls, ports, battery, headset lockout, target mode)
- `docs/reference/brx-extended-user-guide.md` — distilled BRX Extended User Guide 2018 (IR specs, USB disk mode, headset LEDs, charger, indoor/outdoor, Gen1 BT name/PIN, manufacturer)
- `docs/reference/community-notes.md` — BRX owners' community (battery chemistry/polarity, 18650 headset, WS2812B, wear points, screamers, v4.30 firmware, sling drill, spares)
- `docs/reference/grenade.md` — grenade anatomy and comms model (credit Jay / Extreme Laser Tag And More! + our bench)
- `docs/reference/edge-brp.md` — BRX vs Battle Rifle Pro / UBox (what the BRX lacks)
- `docs/reference/lasertagmods.md` — LaserTagMods transport facts, phone-bracket rider
- `docs/gotchas.md` — field lore (rainbow check, camera can't see IR, screamers)
- `protocol/brx-protocol.md` §1, §2, §7a, §7b, §7c, §7h, §7i, §7m, §7n, §7o, §7r, sensor-id map, `$WEAP` fire-mode
- `protocol/brx-ir-protocol.md` — bench-measured IR frame timings and payload
- `docs/experiment-log.md` — 2026-08-24 battery telemetry; 2026-08-26 screamer; 2026-08-27 gun LED life gauge and headset LED correction
- `docs/field-process.md` — muster rainbow check
- `protocol/callsign-extract/` — sound-bank size

## Research backlog (held — NOT published)
Nothing below appears on the site. Each item is published only once confirmed; contradicted items list both values and pick neither.
- **Headset green — whose hit, whose kill?** The band blinks green on a hit and holds green on a kill; not yet pinned whether that is the *wearer's* hit or the wearer being hit. (Removed from the Headset LEDs table: the "details not fully pinned" qualifiers.) src: docs/experiment-log.md (2026-08-27)
- **Gun LED life-gauge colour shift.** Removed claim: "protective pools (shields/armor) drain first, the colour shifts when they are exhausted, then health drains to zero". The three-segment drain is confirmed by eye; whether the colour change means "protective pools gone" or simply reflects faction colour is not pinned (watch a red or green faction character drain). src: docs/experiment-log.md (LED life mode, 2026-08-27)
- **The full team → colour table.** Blue and yellow are pinned for teams 1 and 2; the community's 9-colour palette (still published as 👥) has not been walked end to end on our bench. src: docs/reference/community-notes.md
- **The second radio.** Removed accordion bullet: the factory record lists `NRFhost`/`NRFslave`; the community identifies an nRF24-class 2.4 GHz link between taggers for kill confirmation; not driven by any public tool and not characterised. src: docs/experiment-log.md (QUERY dump), docs/reference/community-notes.md
- **A visible aiming laser?** Removed sight bullet: our units aim by sight/scope; not confirmed whether any BRX revision ships a visible laser dot. src: docs/reference/community-notes.md
- **The sound SD card.** Contradicted — removed "hot-glued to the mainboard" and the "silence with a boot pop missing can mean a loose/corrupt card" diagnosis: owners report it as hot-glued *and* as swappable-for-diagnosis; we have not opened a unit to reconcile. src: docs/reference/community-notes.md
- **"No public schematic of the mainboard exists; only partial community traces."** Removed accordion bullet — an absence claim we cannot verify. src: docs/reference/community-notes.md
- **Tagger charge time.** Contradicted — removed from the battery spec-sheet, stat-row and spec sheet: **~2 h** (BRX Manual V7) vs **2–4 h** (Extended User Guide 2018). src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md
- **When the headset-drop firing lockout arrived.** Removed "since a 2018/2019 firmware revision" from the headset hero (the lockout itself stays). src: docs/reference/brx-manual-notes.md, docs/reference/community-notes.md
- **v2 headset = Battle Rifle Pro headset hardware, firmware-only difference.** Removed row from the Headset facts table — secondhand internals claim. src: docs/reference/community-notes.md
- **Gen2 vs Gen3 hardware differences** beyond the headset re-pair procedure — over the air they look identical to us. src: docs/reference/community-notes.md
- **Headset sensor count and placement.** Battle Company sells front/left/right sensor boards; our wire decode distinguishes front and back. A definitive dome map is still owed. src: protocol/brx-protocol.md §"$HIR token 1", docs/reference/community-notes.md
- **Grenade firmware updates.** Owners report `.bin` updates exist, but the grenade's USB-C exposed no data interface on our bench — the update path is unknown. src: docs/reference/grenade.md
- **Images:** no IDs removed. HW-10 (gun LED gauge) description and prompt edited to drop the "shifted colour in the last frame" (held, see life-gauge item above).
