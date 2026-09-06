# 01 · Meet the BRX  (section slug: /manual/hardware)
**Last verified:** 2026-09-06
**Audience:** new owners, event hosts and tinkerers who want to know what they are holding before they switch it on · **Goal of this section:** name every part of the tagger, headset and accessories. Explain what each light and port means. Show why the BRX is a simple IR instrument that remembers nothing, which every later section builds on.
**Provenance legend:** ✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the Callsign APK · 👥 community-reported. Only confirmed facts are published; see Research backlog at the end.

**Credits used throughout this section:** Battle Company (BRX Manual V7, BRX Extended User Guide 2018, linked but not rehosted) · LaserTagMods (JEDGE/JBOX, the original protocol discovery) · the BRX owners' community · Jay / Extreme Laser Tag And More! (grenade and accessory videos).

---

## Pages

### Page: The BRX at a glance  (`/manual/hardware/overview`)
_A laser tagger shaped like a rifle, a wireless sensor headset, and a smart grenade. Plus what they are not._

[hero] The Battle Company BRX is a laser tagger shaped like a rifle, and it comes with a wireless sensor headset. 📖 It shoots a coded beam of invisible light at 980 nm and 38 kHz. It plays 2,000+ sounds through its own speaker, and a small bank of lights shows what it is doing. There is no screen, no WiFi, and no memory of the game you just played. ✅ src: docs/reference/brx-extended-user-guide.md, docs/reference/edge-brp.md, protocol/session-findings-2026-08.md §7n

[image HW-01] (see Images table)

[stat-row] Four numbers that sum up the BRX:
- **980 nm / 38 kHz**: the IR beam every shot rides on 📖
- **~600 ft**: how far a shot usually reaches. Shade and night are better, and bright sun cuts it about in half 📖
- **~8 h**: play time on one charge 📖
- **2,477**: sound files on the tagger, every one catalogued ✅
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/sound-catalog.md

[cards] "The system, in three objects"
- **Tagger**: the rifle. It fires the IR beam and carries a hit sensor on its body. Inside sit the speaker, the sound bank, the battery, the Bluetooth radio and all the logic for a stock game. 📖 ✅
- **Headset**: the sensor band you wear. It catches most incoming tags because it is the bigger target. It lights up for feedback, links to its own tagger without wires, and decides whether that tagger may fire. 📖 ✅
- **Smart Grenade**: an extra device that sends out IR, with a button and a status light. Throw it as a blast weapon, or drop it as an objective (respawn point, hill, flag). ✅
src: docs/reference/brx-manual-notes.md, docs/reference/grenade.md

[callout:info] **What the BRX is NOT.** This shapes everything else in the manual.
- **No screen.** Lights and voice lines are the only way to see your ammo and health. The commercial Battle Rifle Pro has an LCD. The BRX does not. 📖
- **No WiFi.** Bluetooth is the only radio that reaches the outside world (Classic on Gen1, BLE on Gen2/3). 📖 ✅
- **Keeps no game state.** Switch it off and on, and any settings you sent it are gone. It never reports a score, and a stock game keeps no score at all. "How do I see my score?" is the first question at every game. ✅ 👥
- **No headset cable.** The headset is wireless. There is no headset jack on the tagger. 📖 ✅
- **No firmware backup.** You can write firmware over USB, but you can never read it back (the bootloader is write-only). ✅
src: docs/reference/edge-brp.md, protocol/brx-protocol.md §1, protocol/session-findings-2026-08.md §7c, §7n, docs/reference/community-notes.md

[quote] "A gun whose headset is off, unpaired or flat just refuses to join. No error, no voice line." That is the number one cause of a wasted game start, straight from our field notes. ✅ src: docs/gotchas.md

---

### Page: The tagger, part by part  (`/manual/hardware/tagger`)
_Every button, port, emitter and light on the rifle, and what each one is really for._

[diagram HW-02] Labelled tagger anatomy. The labels sit on top in HTML as hotspots (see Images table).

[cards] "Controls at a glance"
- **Trigger**: fires the gun. Before a game it also flips through weapons and characters and picks menu items. A switch sits behind it, and you can test that switch with a meter if the gun stops firing. 📖 👥
- **Reload handle** (right side, screws on): pull it to reload. **Pulling it also starts a stock game.** A small switch sits under two screws beneath it. 📖
- **ALT button** (orange): flips through perks before a game. **Hold it 3 s** to switch between indoor and outdoor mode. 📖
- **SELECT**: moves you through the settings menus. **Hold it while you power on** to enter USB disk mode for firmware and sound updates. 📖
- **LEFT / RIGHT** (the direction pad): flip through game modes and teams. **Hold LEFT at power-on** = target (sighting) mode. **Hold RIGHT at power-on** = accessory and headset pairing mode. **Hold LEFT+RIGHT 5 s** in a game = back to the menu. 📖 👥
- **Power switch**: a slide switch by the barrel. A tagger that turns itself on and off usually has a worn one. 📖 👥
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

[callout:tip] **There is no fire-mode selector.** Fire mode belongs to the *weapon* you pick, not to a switch on the gun. The modes are full-auto, single-shot, 3-round burst, hold-to-charge and melee. Each one is stored inside the weapon definition. ✅ src: protocol/brx-protocol.md §"$WEAP t20 - FIRE MODE"

[table] Ports - columns: Port | Where | What it is | Confidence
- Charging port | body | Where the **8.4 V two-cell smart charger** in the box plugs in. Its LED goes red, then green when the pack is full | 📖
- micro-USB "Programing Port" | body | It does two jobs. On a normal boot it is a **USB serial console**. The tagger's Teensy microcontroller then shows up as a COM port ("PuTTY into the tagger"). Hold **SELECT at power-on** and it becomes a **USB disk** that shows the firmware `.BIN` and the `AUDIO` folder | ✅ 📖
- Headset jack | n/a | **There is none.** The headset links wirelessly | ✅
- Accessory port | n/a | **There is none** on the Gen2/3 units we have opened up and checked at the connector. Micro-USB is the only port | ✅
src: protocol/session-findings-2026-08.md §7c, docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

[accordion] "What's inside (for the curious, you do not need to open it)"
- **Microcontroller:** a PJRC **Teensy** (ARM). Plug in USB and it shows up as "Teensyduino USB Serial". ✅
- **Radio:** a Bluetooth module wired to the microcontroller's serial port. That is why BLE and a wired serial cable send the exact same frames. Board label on our units: `PCB-5`, `BTchip-4`. ✅
- **Sound storage:** an SD card on the mainboard. You never take it out to change sounds, because sound updates go over USB. 👥 📖
- **Speaker:** a "pop" from the speaker when the gun boots means the speaker has power. 👥
- **Warning:** always unplug the battery before *any* work inside. A live pack during a mod is the classic way to kill a mainboard. 👥
src: protocol/session-findings-2026-08.md §7c, docs/experiment-log.md (QUERY dump), docs/reference/community-notes.md

[image HW-05] (ports close-up, see Images table)

---

### Page: The IR emitter, the sight, and the sensors  (`/manual/hardware/ir-and-sensors`)
_The invisible beam that carries every tag. Here are the published specs and what we measured._

[spec-sheet] IR emitter (Class 1 laser, IEC 60825-1): from Battle Company's Extended User Guide 📖
- Wavelength: **980 nm** (note: many hobby IR parts are 940 nm, so pick 980 nm-capable receivers for anything you build)
- Pulse width: **6.5 µs**
- Energy per pulse: **111 nJ**
- Pulse repetition (carrier): **38,000 Hz**
- Beam: **< 18 mm at the aperture**
- Factory record on one of our units reports the laser at **16.9 mW** ✅
src: docs/reference/brx-extended-user-guide.md, protocol/session-findings-2026-08.md §7c

[table] What a shot looks like on the air (bench-measured) - columns: Property | Value | Confidence
- Frame | one ~25-bit word per shot, pulse-width encoded | ✅
- Sync pulse | ~1,990 µs | ✅
- "1" mark / "0" mark | ~990 µs / ~500 µs | ✅
- Carried in every shot | player id (0–63), team, damage, damage type, crit flag | ✅
- Receiver that decodes it | any 38 kHz demodulating IR receiver (the community IDs the Vishay TSSP38 in the headset) | ✅ 👥
src: protocol/brx-ir-protocol.md, docs/reference/lasertagmods.md

[callout:info] **Range and light.** A shot usually reaches about 600 ft. Range *drops* in full sun and *improves* in shade or at night. Bright sunlight roughly **halves the gun's hit radius**, because the gun filters out IR noise. Indoor mode shrinks explosion and melee range on purpose. 📖 src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[callout:warn] **You cannot see the beam.** A phone camera will not show a low-power 38 kHz IR emitter. If both cameras show nothing, the gun can still be perfectly fine. Test with a receiver or another tagger, never with a camera. ✅ src: docs/gotchas.md

[cards] "Where you can be tagged"
- **Headset domes**: the main target. There are **four sensor domes and four LEDs** on the headset, one of each at the back. Our bench can tell a **front** dome hit from a **back** dome hit on the wire. Battle Company sells front, left and right sensor boards as spares. ✅ 👥
- **Gun body sensor**: a hit sensor on the rifle itself. ✅ 📖
- **The tagger says which sensor caught it**: at normal range it knows whether a tag landed front, back or on the gun. Point-blank, IR floods every receiver and you cannot trust the answer. ✅
src: protocol/brx-protocol.md §"$HIR token 1 - sensor id map", docs/reference/community-notes.md

[accordion] "The sight"
- The tagger's sight has a **green kill-confirm flash**. Score a kill and the sight glows green for a few seconds. ✅
- **Sighting a scope** happens in **Target Mode** (hold LEFT while powering on). Shots do zero damage, ammo is unlimited, and a direct hit flashes the target's headset green. Owners sight snipers long (300–400 ft) and shotguns or SMGs close (50–100 ft). 📖 👥
src: protocol/session-findings-2026-08.md §7o, docs/reference/brx-manual-notes.md, docs/reference/community-notes.md

[image HW-09] (IR waveform illustration, see Images table)

---

### Page: Lights and what they mean  (`/manual/hardware/leds`)
_The gun's LED bank and the headset's ring. Read them like a dashboard._

[callout:info] There are two separate light systems. The **gun** has a small bank of LEDs on the rifle. The **headset** has a ring of bright green hit LEDs plus colour-changing RGB LEDs. Each one answers a different question. ✅ src: docs/experiment-log.md (2026-08-27)

[table] Gun LEDs - columns: What you see | Meaning | Confidence
- Colour while in the menu | **The game mode you picked**: Free For All white · Death Match red · Generals yellow · Supremacy blue · Commander pink · Survival green · The Swarm orange | 📖
- Colour during a game | **Your team or faction colour** (on our bench, team 1 is blue and team 2 is yellow). The colour comes from your team. You cannot set any colour you like | ✅
- Colour palette available | 9 colours reported by the community: red · blue · yellow · green · purple · cyan · white · pink · orange | 👥
- Segments going out | **Your health bar**: the three LEDs work like a bar that drains as you take damage | ✅
- Manual's description | "LED indicator shows ammo & health" | 📖
- Slow blink in team colour | A game run from an outside app that has not switched the health bar on | ✅
src: docs/reference/brx-extended-user-guide.md, protocol/session-findings-2026-08.md §7r (LEDs slow-blink team colour in an app-derived config), docs/experiment-log.md (LED life mode, 2026-08-27)

[diagram HW-10] (gun LED gauge states, see Images table)

[table] Headset LEDs - columns: Pattern | Meaning | Confidence
- **Slow rainbow cycling** | **Not connected, not paired** to a tagger. You can spot it across a room, so check every headset before a game starts | ✅
- **Solid or pulsing team colour** (red, blue…) | Paired and synced to the tagger. You see this **before the game only** | ✅
- **Dark** | **This is normal in play.** The band goes dark once the game starts, and dark is not a fault | ✅
- **One green flash** | A hit registered on this headset. The flash fires on its own, with no command from a phone or host | ✅
- **Sustained bright green blink** | This player is out (dead). It stops at respawn | ✅
- **Green flash in Target Mode** | A direct hit on the sighting target | 📖
- **Bright green burst** (4 directions) | The 3 W hit LEDs. They are built to show up in daylight, and indoor mode dims them | 📖
src: docs/experiment-log/2026-09.md (2026-09-02, the native headset state model: blank the headset, shoot it, one green flash from dark; out = sustained blink), docs/experiment-log/2026-08.md (2026-08-27), docs/field-process.md, docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

[callout:warn] **We got this wrong twice in our own notes.** One green flash means a hit landed on this headset. A sustained green blink means the wearer is out. Team colour shows *only before* the game starts. Earlier readings said "green = dead" and then "holds green = kill feedback"; the sustained blink is the out state, and it is the firmware's own, not a host command. ✅ src: docs/experiment-log/2026-09.md (2026-09-02)

[callout:tip] The headset LEDs work **on their own**. You get them in stock games and in games hosted by an outside app alike. Nothing needs to be set up first. ✅ src: docs/experiment-log.md

[accordion] "For modders: what the headset LEDs are"
- The addressable RGB LEDs are **WS2812B 5050** (NeoPixel-compatible). On the BRX headset they are wired as a **series** string (parallel on the SwapTX variant). One data line, 5 V and ground. 👥
- Indoor mode dims the green hit LEDs and switches the RGB LEDs on. 📖
src: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md

[image HW-04] (headset LED states strip, see Images table)

---

### Page: The headset  (`/manual/hardware/headset`)
_A wireless sensor band that decides whether your tagger is allowed to shoot._

[hero] The headset is not an accessory. It is half of the system. It catches most tags and shows the shooter that they hit you. The tagger also **refuses to fire when its headset drops mid-game**. 📖 👥 src: docs/reference/brx-manual-notes.md, docs/reference/community-notes.md

[image HW-03] (see Images table)

[cards] "What's on the headset"
- **Sensor domes**: IR receivers around the band. The wire reports **front** dome hits and **back** dome hits separately. ✅
- **Green hit LEDs**: 3 W, pointing four ways, bright enough to see in daylight. 📖
- **RGB ring**: WS2812B addressable LEDs. They show team colour, the rainbow when unpaired, and hit feedback. 👥 ✅
- **Front IR emitter**: the headset *sends* IR too. The melee swing (v2 "logo" units) and respawn-station requests fire from the front of the band. 📖 ✅
- **Small button**: used to re-pair a Gen-3 headset, and in "install accessory" pairing. 👥
- **PROGRAM pin**: a sunken button. Hold it at power-on to put the headset into USB disk mode for firmware updates. 📖
src: protocol/brx-protocol.md §"$HIR token 1", docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/grenade.md

[table] Headset facts - columns: Item | Detail | Confidence
- Link to tagger | Wireless, and it pairs by itself after power-on. It can take **up to 3 minutes** with many taggers and BT devices around | 📖
- Anti-cheat lockout | If the headset drops after game start, the tagger locks until it reconnects | 📖
- Apps need it | The official phone app quietly disconnects a tagger with no headset linked. A game hosted from outside cannot hold a link to a headset-less gun either | ✅
- Battery | One **18650** lithium cell in v2 headsets. It charges from **any USB 5 V** source. The v1 headset has a slide compartment | 👥 📖
- Firmware | Reported by the tagger as `hds.59` on our units | ✅
- Extra functions | Short-range scoring without an app, and sensing players who are close by | 📖
- Spares Battle Company sells | Speakers, sensor circuit boards (front/left/right, "HS 2.0"), a 19" 2-pin wire bundle | 👥
- Water | A soaked tagger usually survives after days of drying. **A soaked headset usually does not** | 👥
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, protocol/session-findings-2026-08.md §7m, §7r, docs/reference/community-notes.md

[callout:tip] **Before every game, look for rainbow.** A headset cycling slowly through rainbow colours is unpaired. Its tagger will quietly refuse to join a hosted game. Five seconds of looking saves the whole round. ✅ src: docs/gotchas.md, docs/field-process.md

---

### Page: Battery and power  (`/manual/hardware/battery`)
_A 7.4 V two-cell pack with one nasty surprise: the connector polarity is backwards._

[spec-sheet] Tagger battery 📖 👥:
- Chemistry / pack: **7.4 V Li-ion, ~2,200 mAh**, two cells
- Connector: **2-pin** (aftermarket 3-pin packs fit, because the third pin is a thermistor the BRX ignores)
- Charger: the supplied **8.4 V two-cell smart charger**. Its LED is red while charging and green when full
- Play time: **~8 h**
- Alternative: **6 × AA** alkaline. **Never rechargeable AAs.**
- Swap: undo one screw near the reload switch
- Live readout on the wire: pack voltage, cell voltage and charge % every ~30 s (e.g. 7.52 V pack / 3.96 V cell / 43 %) ✅
src: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/experiment-log.md (2026-08-24)

[callout:warn] **POLARITY IS REVERSED.** Battle Company wires the pack connector the opposite way to the usual convention. Check it with a meter before you wire any replacement pack, external charger or adapter. Getting it wrong risks damaging the tagger. 👥 src: docs/reference/community-notes.md (Battery / power)

[image HW-06] (battery pack + connector, see Images table)

[cards] "Power habits that keep a fleet alive"
- **Charge outside the gun**: owners splice a BRX AC adapter onto a spare connector. Keep a stack of charged packs and swap them in the field. 👥
- **Keep them topped up**: below a certain battery level the stock firmware **stops re-pairing Bluetooth**. That quietly drops players out of hosted games. 👥
- **Rest the guns between sessions**: a tagger left powered all day can enter the "screamer" state. It buzzes loudly and refuses connections until you reboot it and let it rest. 👥 ✅
- **Riding electronics**: an add-on may pull under ~300 mA from the tagger, and Battle Company confirmed that is fine. Anything bigger should carry its own power bank. 👥
src: docs/reference/community-notes.md, docs/gotchas.md, docs/experiment-log.md (2026-08-26 screamer)

[table] Headset power - columns: Item | Detail | Confidence
- Cell | one 18650 lithium cell (v2) | 👥
- Charging | any USB 5 V supply | 📖
- Voltage readout | shown in the tagger's USB console (e.g. "Head: 3.84 V") | ✅
src: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md, protocol/session-findings-2026-08.md §7c

---

### Page: Generations: which BRX do you have?  (`/manual/hardware/generations`)
_Gen1 speaks Bluetooth Classic; Gen2 and Gen3 speak BLE. Here is how to tell in 30 seconds._

[compare] Gen1 vs Gen2/3 - columns: Feature | Gen1 | Gen2 / Gen3
- Radio | **Bluetooth Classic (SPP)** via an HC-05-class module, 57,600 baud ✅ 👥 | **Bluetooth Low Energy**, Nordic UART Service, 115,200 baud ✅
- How it shows up | Pairs as a classic BT serial device; guide-era name `LTP-alpha`, pair code `0001` 📖 👥 | Advertises as `Tactix-XXXX` (XXXX = last two bytes of its address); the UART service is visible in a BLE scan ✅
- Phone support | v1 app was Android-only 📖 | iOS and Android
- Headset requirement for the radio | Headset must be connected for Bluetooth to work 👥 | A gun with no headset accepts a link, then drops it within seconds ✅
- "Logo" vs "non-logo" | Non-logo units need extra steps after firmware/disk mode and a pair code 📖 | Logo units need no password and have the gesture (melee-swing) headset 📖
- Everything else | Same IR, same sounds, same game modes | Same
src: protocol/brx-protocol.md §1, protocol/session-findings-2026-08.md §7a, §7r, docs/reference/brx-extended-user-guide.md, docs/reference/lasertagmods.md

[steps] "Identify your generation"
1. Power on the tagger with its headset on and paired.
2. Run a BLE scan on a phone or laptop (any BLE scanner app). **A `Tactix-…` device advertising a Nordic UART service = Gen2/3.** ✅
3. Nothing on BLE, but it shows up in your phone's Bluetooth settings as a classic serial device = **Gen1**. ✅
4. To read the exact firmware, plug the micro-USB port into a computer and open the serial console. The `QUERY` record lists gun firmware (ours: `v4.32`), headset firmware (`hds.59`), board revision (`PCB-5`) and Bluetooth chip (`BTchip-4`). ✅
src: protocol/brx-protocol.md §1, protocol/session-findings-2026-08.md §7c

[callout:info] **Gen2 vs Gen3** look the same over the air to every tool we have. Both use BLE with Nordic UART. The one difference the community relies on is the **Gen-3 headset**. It has its own re-pair steps (hold the headset button and RIGHT at tagger power-on → "PAIRING MODE"). The Pairing section covers it. 👥 src: docs/reference/community-notes.md

[callout:warn] **Firmware note.** Firmware v4.30+ was a "makeover" update. It wipes your settings and breaks headset pairing until you set it up again. It also needs a completely new audio file set. Our own units run `v4.32` with a `devhost` build string. The official Callsign app refuses that build ("supported version is until v2.01e"). Firmware **cannot be backed up**, because the bootloader is write-only. Never reflash without Battle Company's original image in hand. 👥 ✅ src: docs/reference/community-notes.md, protocol/session-findings-2026-08.md §7b, §7c

[diagram HW-08] (two radios, see Images table)

---

### Page: Grenade and accessories  (`/manual/hardware/accessories`)
_What each add-on physically is. How to use them lives in the Accessories & Stations section._

[image HW-07] (see Images table)

[cards] "Smart Grenade: anatomy" ✅
- **Top button**: powers it on, sets the mode (hold it), and sets off a blast or a respawn by hand.
- **Safety clip**: pop it off to power up.
- **3 IR emitters + 1 emitter/receiver**: it *broadcasts* over IR with a state beacon every few seconds. It also *receives* shots, and flashes white when hit.
- **Status LED**: green at boot means ready. In setup it cycles **red · green · blue · yellow · white** (Frag · Assault · Hill · Respawn · CTF). It turns white when a mode locks in. At boot it flashes the stored mode's colour for ~1 s.
- **USB-C**: **charge and power only.** It shows no data interface at all, and it has no PROGRAM pin. We tested it off, on and in setup mode with a known-good cable.
- **No pairing for objective modes**: as a respawn point, hill or flag, any tagger can work with it over IR. You only need IR pairing to throw it as a grenade tied to your headset.
src: docs/reference/grenade.md, docs/reference/brx-extended-user-guide.md

[callout:info] Like the tagger, the grenade **keeps no game state and cannot show a winner**. It is an IR emitter for objectives and effects. The taggers and headsets really play every sound you *hear* from a grenade event. That covers the explosion, "control point captured" and the CTF music, all from their own sound banks. ✅ 👥 src: docs/reference/grenade.md

[table] Other accessories - columns: Item | What it is | Confidence
- **Hatchet, shield, sidearm** | Accessories you pair over IR, the same way as a thrown grenade. Each has a PROGRAM button for USB firmware updates | 📖
- **Scope** | An optical sight. You zero it with the tagger's Target Mode. Sight snipers long and shotguns or SMGs short | 📖 👥
- **Phone bracket** | Holds a phone for the Callsign app. Owners also use it to carry an ESP32 and a USB power bank rider (JEDGE-style). That needs **no permanent modification** to the tagger. A 5,000 mAh pack runs such a rider ~15 h | 👥
- **Sling mount** | Community drill size for a sling stud: **7/32"** (15/64" is too loose) | 👥
- **Utility Box (UBox)** | Battle Company's commercial station. It is one networked box that software can switch into 20+ roles (domination, CTF, bomb, respawn, dispensers, targets). It belongs to the EDGE commercial suite, not the BRX consumer kit | 📖
- **3D-printed skins** | The most popular way to change how a tagger looks. Paint is rare (use a black plastic primer base coat if you do) | 👥
src: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/lasertagmods.md, docs/reference/edge-brp.md

[accordion] "Known wear points (anatomy-level; fixes are in Repairs)"
- **D-pad buttons**: the plastic cracks with use. This is the most common failure. 👥
- **Power switch**: a gun that turns itself on and off almost always needs a new switch. 👥
- **Reload handle**: it can bind. A thin nylon washer and silicone lube fix that, and you can test its switch with a pen. 👥 📖
- **IR emitters**: they do die in the end. The emitter and the headset receivers are separate replaceable parts. 👥 📖
src: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md

---

### Page: Spec sheet and what's in the box  (`/manual/hardware/spec-sheet`)
_One page to print. It lists the exact parts, numbers and kit contents for the tagger, the headset and the grenade._

[image HW-11] (what's-in-the-box flat lay, see Images table)

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
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md (IR specs, charger, manufacturer address), docs/reference/community-notes.md (battery pack, polarity), protocol/brx-protocol.md §1, protocol/session-findings-2026-08.md §7c + docs/experiment-log.md 2026-08-23 (USB console, Teensy MCU), protocol/session-findings-2026-08.md §7o (sight flash)

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

[table] What's in the box (typical retail kit) - columns: Item | Notes | Confidence
- Tagger | with reload handle (screws on) | 📖
- Wireless headset | pre-paired to its tagger at the factory (the tagger's record stores the headset's serial as its pairing PIN) | ✅ 📖
- 8.4 V two-cell smart charger | red → green LED | 📖
- Quick manual (V7) | link: Battle Company's BRX Manual V7 PDF | 📖
- Optional | 6×AA battery holder use, scope, phone bracket, smart grenade | 📖 👥
src: docs/reference/brx-manual-notes.md, protocol/session-findings-2026-08.md §7c

[callout:info] **Official documents** (linked, not rehosted): Battle Company *BRX Manual V7* (battlecompany.com, 2021) and the *BRX Extended User Guide* (Laser Tag Pro, 2018). The PDFs are the manufacturer's own word. Where we mark ✅, we measured it ourselves. src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

---

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| HW-01 | Overview: hero | The full tagger seen from the right at three-quarter view, with the headset resting beside it on a dark surface. Low lighting keeps the LED bank and the sight visible. | REAL PHOTO | Owner shoot | n/a |
| HW-02 | Tagger, part by part: anatomy diagram | A clean unlabelled side view of a rifle-style tagger, with hotspots for the trigger, reload handle, ALT, SELECT, LEFT/RIGHT, power switch, emitter, body sensor, LED bank, sight, speaker, charging port and micro-USB. | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a modern black rifle-style laser-tag tagger in exact side profile, right side facing the viewer, rendered as a crisp technical illustration with thin electric-blue edge highlights, a small three-LED bank on the receiver, a compact optical sight on top, a short charging-handle style lever on the side, and a barrel-tip emitter lens. Plenty of empty margin around the object for callout lines. |
| HW-03 | Headset: hero | The headset alone at front three-quarter view, LEDs lit in a team colour, so the domes and the RGB ring read clearly. | REAL PHOTO | Owner shoot | n/a |
| HW-04 | Lights: headset states strip | Five identical small headset icons in a row, each showing a different LED state: rainbow cycle, solid blue, dark, green blink and green hold. | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; wide 21:9 strip. Subject: five identical minimalist front-view icons of a black laser-tag headset with a ring of sensor domes, evenly spaced in a row. Left to right the ring glows: a soft rainbow gradient; solid electric blue; completely unlit; a bright green pulse with a subtle blur; steady bright green. Consistent flat lighting, generous spacing between icons. |
| HW-05 | Tagger: ports | A close-up of the port area, with the charging jack and the micro-USB programming port side by side and the SELECT button in frame. | REAL PHOTO | Owner shoot | n/a |
| HW-06 | Battery: pack and connector | The removed 7.4 V pack and its 2-pin connector, laid next to the open battery bay and the 8.4 V charger plug. The connector pins are clearly visible for the polarity note. | REAL PHOTO | Owner shoot | n/a |
| HW-07 | Accessories: grenade | The smart grenade with its safety clip, top button and IR windows visible, LED lit green for ready, USB-C port in frame. | REAL PHOTO | Owner shoot | n/a |
| HW-08 | Generations: two radios | A diagram of two tagger silhouettes, one sending a wide classic-Bluetooth wave pattern and one sending sparse BLE-style pulses, with a phone silhouette between them. | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: two simplified silhouettes of a black rifle-style laser-tag tagger facing inward from the left and right edges, a minimalist smartphone outline centred between them. From the left tagger, dense continuous concentric amber radio arcs; from the right tagger, sparse short electric-blue radio pulses. Thin line-art, generous negative space. |
| HW-09 | IR and sensors: waveform | A coded IR pulse train drawn as a clean oscilloscope-style trace: one long sync pulse followed by a series of long and short marks. | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a single horizontal oscilloscope-style digital trace in electric blue on a faint grid: starting with one wide pulse about four units long, then about twenty-five narrower pulses alternating between two widths (one unit and two units) with equal one-unit gaps, ending in a very short pulse. One amber highlight band over the wide first pulse. Crisp, minimal, no other elements. |
| HW-10 | Lights: gun LED gauge | A three-frame strip of the gun's three-LED bank in one colour: all three lit, then two, then one, like a segmented gauge. | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; wide 21:9 strip. Subject: three identical close-up crops of a small three-LED indicator bank set into matte black textured plastic, in a row. Frame one: all three LEDs glowing violet. Frame two: two LEDs glowing violet, the third dark. Frame three: one LED glowing violet, the other two dark. Soft realistic bloom around lit LEDs. |
| HW-11 | Spec sheet: what's in the box | A top-down flat lay of the tagger, headset, charger, reload handle, quick manual, and the optional grenade and phone bracket, arranged on a dark surface. | REAL PHOTO | Owner shoot | n/a |

## Interactive ideas (optional, ≤5)
1. **Hotspot anatomy** (HW-02): hover or tap each part for its one-line role, plus a "hold at power-on does…" table for the buttons.
2. **"What is my LED doing?" decoder**: pick gun or headset, pick the pattern you see (rainbow, dark, green blink…), and get the meaning and the next thing to check.
3. **Generation identifier**: a three-question wizard (BLE scan shows `Tactix-…`? classic BT pairs? logo on the shell?) that ends on Gen1 or Gen2-3 with the right pairing page link.
4. **Spec sheet copy/print**: one-click copy of the spec block as plain text, and a print stylesheet for the page.
5. **Power planner**: enter the number of taggers and hours of play; it outputs packs to charge and a "rest the fleet" reminder based on the ~8 h and screamer facts.

## Sources used
- `docs/reference/brx-manual-notes.md`: distilled Battle Company BRX Manual V7 (controls, ports, battery, headset lockout, target mode)
- `docs/reference/brx-extended-user-guide.md`: distilled BRX Extended User Guide 2018 (IR specs, USB disk mode, headset LEDs, charger, indoor/outdoor, Gen1 BT name/PIN, manufacturer)
- `docs/reference/community-notes.md`: BRX owners' community (battery chemistry/polarity, 18650 headset, WS2812B, wear points, screamers, v4.30 firmware, sling drill, spares)
- `docs/reference/grenade.md`: grenade anatomy and comms model (credit Jay / Extreme Laser Tag And More! + our bench)
- `docs/reference/edge-brp.md`: BRX vs Battle Rifle Pro / UBox (what the BRX lacks)
- `docs/reference/lasertagmods.md`: LaserTagMods transport facts, phone-bracket rider
- `docs/gotchas.md`: field lore (rainbow check, camera can't see IR, screamers)
- `protocol/brx-protocol.md` §1, §2, `protocol/session-findings-2026-08.md` §7a, §7b, §7c, §7h, §7i, §7m, §7n, §7o, §7r, sensor-id map, `$WEAP` fire-mode
- `protocol/brx-ir-protocol.md`: bench-measured IR frame timings and payload
- `docs/experiment-log.md`: 2026-08-24 battery telemetry; 2026-08-26 screamer; 2026-08-27 gun LED life gauge and headset LED correction
- `docs/field-process.md`: muster rainbow check
- `protocol/callsign-extract/`: sound-bank size

## Research backlog (held, NOT published)
Nothing below appears on the site. Each item is published only once confirmed; contradicted items list both values and pick neither.
- **Headset green in a hosted game.** The one-flash-on-hit and sustained-blink-when-out states are confirmed on a bare and on a host-armed gun (2026-09-02). Whether a hosted game shows them identically over a full match is a 12-minute eyeball check still owed (docs/HANDOFF.md, M2). src: docs/experiment-log/2026-09.md
- **Gun LED life-gauge colour shift.** Removed claim: "protective pools (shields/armor) drain first, the colour shifts when they are exhausted, then health drains to zero". The three-segment drain is confirmed by eye; whether the colour change means "protective pools gone" or simply reflects faction colour is not pinned (watch a red or green faction character drain). src: docs/experiment-log.md (LED life mode, 2026-08-27)
- **The full team → colour table.** Blue and yellow are pinned for teams 1 and 2; the community's 9-colour palette (still published as 👥) has not been walked end to end on our bench. src: docs/reference/community-notes.md
- **The second radio.** Removed accordion bullet: the factory record lists `NRFhost`/`NRFslave`; the community identifies an nRF24-class 2.4 GHz link between taggers for kill confirmation; not driven by any public tool and not characterised. src: docs/experiment-log.md (QUERY dump), docs/reference/community-notes.md
- **A visible aiming laser?** Removed sight bullet: our units aim by sight/scope; not confirmed whether any BRX revision ships a visible laser dot. src: docs/reference/community-notes.md
- **The sound SD card.** Contradicted, so we removed "hot-glued to the mainboard" and the "silence with a boot pop missing can mean a loose/corrupt card" diagnosis: owners report it as hot-glued *and* as swappable-for-diagnosis; we have not opened a unit to reconcile. src: docs/reference/community-notes.md
- **"No public schematic of the mainboard exists; only partial community traces."** Removed accordion bullet, an absence claim we cannot verify. src: docs/reference/community-notes.md
- **Tagger charge time.** Contradicted, so it was removed from the battery spec-sheet, stat-row and spec sheet: **~2 h** (BRX Manual V7) vs **2–4 h** (Extended User Guide 2018). src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md
- **When the headset-drop firing lockout arrived.** Removed "since a 2018/2019 firmware revision" from the headset hero (the lockout itself stays). src: docs/reference/brx-manual-notes.md, docs/reference/community-notes.md
- **v2 headset = Battle Rifle Pro headset hardware, firmware-only difference.** Removed row from the Headset facts table, a secondhand internals claim. src: docs/reference/community-notes.md
- **Gen2 vs Gen3 hardware differences** beyond the headset re-pair procedure: over the air they look identical to us. src: docs/reference/community-notes.md
- **Headset dome to sensor-id map.** The count is settled: **four domes and four LEDs**, one of each at the back (2026-09-02). What is still owed is the full map from each dome to its `$HIR` token-1 id; our wire decode distinguishes front and back today. src: protocol/brx-protocol.md §"$HIR token 1", docs/reference/community-notes.md
- **Grenade firmware updates.** Owners report `.bin` updates exist, but the grenade's USB-C exposed no data interface on our bench, so the update path is unknown. src: docs/reference/grenade.md
- **Images:** no IDs removed. HW-10 (gun LED gauge) description and prompt edited to drop the "shifted colour in the last frame" (held, see life-gauge item above).
- Whether a tagger booted with **no** headset fires locally: the manual says it does; owners report post-2018 firmware refuses. Contradicted, held (docs/reference/brx-manual-notes.md, docs/reference/community-notes.md).
