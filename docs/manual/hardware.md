# Meet the BRX
Last verified: 2026-09-09

This page names every part of the BRX tagger, headset and grenade. It explains what each button, port and light does, and it lists the specs for anyone building their own gear.

## The BRX at a glance

The Battle Company BRX is a laser tagger shaped like a rifle. It comes with a wireless sensor headset and can pair with a smart grenade. It shoots a coded beam of invisible light at 980 nm and 38 kHz. It plays 2,477 sounds through its own speaker, and a small bank of lights shows what it is doing. There is no screen, no WiFi, and no memory of the game you just played.

Four numbers that sum up the BRX:

- **980 nm / 38 kHz**: the IR beam every shot rides on.
- **~600 ft**: how far a shot usually reaches. Shade and night are better, and bright sun cuts it about in half.
- **~8 h**: play time on one charge.
- **2,477**: sound files on the tagger, every one indexed.

The system, in three objects:

- **Tagger**: the rifle. It fires the IR beam and carries a hit sensor on its body. Inside sit the speaker, the sound bank, the battery, the Bluetooth radio and all the logic for a stock game.
- **Headset**: the sensor band you wear. It catches most incoming tags because it is the bigger target. It lights up for feedback, links to its own tagger without wires, and its link is what lets that tagger take part in a hosted game.
- **Smart Grenade**: an extra device that sends out IR, with a button and a status light. Throw it as a blast weapon, or drop it as an objective (respawn point, hill, flag).

> **What the BRX is not.** This shapes everything else in the manual.
> - No screen. Lights and voice lines are the only way to see your ammo and health. The commercial Battle Rifle Pro has an LCD. The BRX does not.
> - No WiFi. Bluetooth is the only radio that reaches the outside world (Classic on Gen1, BLE on Gen2/3).
> - Keeps no game state. Switch it off and on, and any settings you sent it are gone. It never reports a score, and a stock game keeps no score at all. "How do I see my score?" is the first question at every game.
> - No headset cable. The headset is wireless. There is no headset jack on the tagger.
> - No firmware backup. You can write firmware over USB, but you can never read it back (the bootloader is write-only).

> A gun whose headset is off, unpaired or flat just refuses to join a hosted or app game. No error, no voice line. That is the number one cause of a wasted game start.

## The tagger, part by part

This section covers every button, port, emitter and light on the rifle, and what each one is really for.

Controls at a glance:

- **Trigger**: fires the gun. Before a game it also flips through weapons and characters and picks menu items. A switch sits behind it, and you can test that switch with a meter if the gun stops firing.
- **Reload handle** (right side, screws on): pull it to reload. Pulling it also starts a stock game. A small switch sits under two screws beneath it.
- **ALT button** (orange): flips through perks before a game. Hold it 3 s to switch between indoor and outdoor mode.
- **SELECT**: moves you through the settings menus. Hold it while you power on to enter USB disk mode for firmware and sound updates.
- **LEFT / RIGHT** (the direction pad): flip through game modes and teams. Hold LEFT at power-on for target (sighting) mode. Hold RIGHT at power-on for accessory and headset pairing mode. Hold LEFT+RIGHT for 5 s in a game to return to the menu.
- **Power switch**: a slide switch by the barrel. A tagger that turns itself on and off usually has a worn one.

> **There is no fire-mode selector.** Fire mode belongs to the weapon you pick, not to a switch on the gun. There are seven: full-auto, single-shot (bolt), 3-round burst, charge with auto-release, hold-to-charge with auto-fire, charge and fire on release, and melee. Each one is stored inside the weapon definition.

| Port | Where | What it is |
|---|---|---|
| Charging port | body | Where the 8.4 V two-cell smart charger in the box plugs in. Its LED goes red, then green when the pack is full. |
| micro-USB "Programing Port" | body | It does two jobs. On a normal boot it is a USB serial console: the tagger's Teensy microcontroller shows up as a COM port ("PuTTY into the tagger"). Hold SELECT at power-on and it becomes a USB disk that shows the firmware `.BIN` and the `AUDIO` folder. |
| Headset jack | n/a | There is none. The headset links wirelessly. |
| Accessory port | n/a | There is none on the Gen2/3 units checked at the connector. Micro-USB is the only port. |

### What's inside (for the curious, you do not need to open it)

- **Microcontroller**: a PJRC Teensy (ARM). Plug in USB and it shows up as "Teensyduino USB Serial".
- **Radio**: a Bluetooth module wired to the microcontroller's serial port. That is why BLE and a wired serial cable send the exact same frames. Board label on the units checked: `PCB-5`, `BTchip-4`.
- **Sound storage**: an SD card on the mainboard. Sound updates go over USB, so there is no reason to take it out. Whether the card can be removed at all has not been checked, and doing so would mean a teardown.
- **Speaker**: a "pop" from the speaker when the gun boots means the speaker has power.
- **Warning**: always unplug the battery before any work inside. A live pack during a mod is the classic way to kill a mainboard.

## The IR emitter, the sight, and the sensors

The invisible beam that carries every tag: here are the published specs and the bench measurements.

IR emitter (Class 1 laser, IEC 60825-1), from Battle Company's Extended User Guide:

| Item | Value |
|---|---|
| Wavelength | 980 nm (many hobby IR parts are 940 nm, so pick 980 nm-capable receivers for anything you build) |
| Pulse width | 6.5 µs |
| Energy per pulse | 111 nJ |
| Pulse repetition (carrier) | 38,000 Hz |
| Beam | < 18 mm at the aperture |
| Laser power (factory record, one unit) | 16.9 mW |

What a shot looks like on the air, bench-measured:

| Property | Value |
|---|---|
| Frame | one ~25-bit word per shot, pulse-width encoded |
| Sync pulse | ~1,990 µs |
| "1" mark / "0" mark | ~990 µs / ~500 µs |
| Carried in every shot | player id (0-63), team, damage, damage type, crit flag |
| Receiver that decodes it | any 38 kHz demodulating IR receiver (the community identifies the Vishay TSSP38 in the headset) |

> **Range and light.** A shot usually reaches about 600 ft. Range drops in full sun and improves in shade or at night. Bright sunlight roughly halves the gun's hit radius, because the gun filters out IR noise. Indoor mode shrinks explosion and melee range on purpose.

> **You cannot see the beam.** A phone camera will not show a low-power 38 kHz IR emitter. If both cameras show nothing, the gun can still be perfectly fine. Test with a receiver or another tagger, never with a camera.

Where you can be tagged:

- **Headset domes**: the main target. There are four sensor domes and four LEDs on the headset, one of each at the back. The bench can tell a front dome hit from a back dome hit on the wire. Battle Company sells front, left and right sensor boards as spares.
- **Gun body sensor**: a hit sensor on the rifle itself.
- **The tagger says which sensor caught it**: at normal range it knows whether a tag landed front, back or on the gun. Point-blank, IR floods every receiver and you cannot trust the answer.

### The sight

- The tagger's sight has a green kill-confirm flash. Score a kill and the sight goes green. In a hosted game the flash is one `$SFLASH` frame per kill, which arrives about 0.4 s after the trigger burst ends. That figure is the delay before the flash, not how long it lasts; the length of the flash is not documented anywhere.
- Sighting a scope happens in Target Mode (hold LEFT while powering on). Shots do zero damage, ammo is unlimited, and a direct hit flashes the target's headset green. Owners sight snipers long (300-400 ft) and shotguns or SMGs close (50-100 ft).

## Lights and what they mean

There are two separate light systems. The gun has a small bank of LEDs on the rifle. The headset has a ring of bright green hit LEDs plus colour-changing RGB LEDs. Each one answers a different question.

Gun LEDs:

| What you see | Meaning |
|---|---|
| Colour while in the menu | The game mode you picked: Free For All white, Death Match red, Generals yellow, Supremacy blue, Commander pink, Survival green, The Swarm orange. |
| Colour during a game | Your team or faction colour (on the bench, team 1 is blue and team 2 is yellow). The colour comes from your team. You cannot set any colour you like. |
| Colour palette available | Nine colours, measured on our own bench with a camera rig on 2026-09-02 (three trials per index, normalised R/G/B signatures): 0 red, 1 blue, 2 yellow, 3 green, 4 purple, 5 teal, 6 white, 7 pink, 8 orange. Indices 9 and 10 are dark. |
| Segments going out | Your health bar: the three LEDs work like a bar that drains as you take damage. |
| Manual's description | "LED indicator shows ammo & health." |
| Slow pulse in team colour | The firmware's own breathing loop. The firmware owns the gun strip and breathes it until a host sends the `$GLED` blank, which hands the strip over for the rest of that life. |

Headset LEDs:

| Pattern | Meaning |
|---|---|
| Slow rainbow cycling | Not connected, not paired to a tagger. You can spot it across a room, so check every headset before a game starts. |
| Solid or pulsing team colour (red, blue...) | Paired and synced to the tagger. You see this before the game only. |
| Dark | The RGB ring, once the game starts. It drops the team colour at game start, and dark is not a fault. This is what our own units do. Battle Company describes indoor mode as switching the RGB LEDs on, and whether an indoor-mode headset stays lit through play instead is unverified. |
| One green flash | A hit registered on this headset. The flash fires on its own, with no command from a phone or host. |
| Sustained bright green blink | This player is out (dead). It stops at respawn. |
| Green flash in Target Mode | A direct hit on the sighting target. |
| Bright green burst (4 directions) | The 3 W hit LEDs. They are built to show up in daylight, and indoor mode dims them. |

> **LED colours, precisely.** One green flash means a hit landed on this headset. A sustained green blink means the wearer is out. Team colour shows only before the game starts, and the sustained blink is the firmware's own state, not a host command.

> The headset LEDs work on their own. You get them in stock games and in games hosted by an outside app alike. Nothing needs to be set up first.

### For modders: what the headset LEDs are

- The addressable RGB LEDs are WS2812B 5050 (NeoPixel-compatible). On the BRX headset they are wired as a series string (parallel on the SwapTX variant). One data line, 5 V and ground.
- Indoor mode dims the green hit LEDs and switches the RGB LEDs on. That is Battle Company's wording for the setting itself. How it interacts with the ring going dark at game start is unverified: nobody has watched an indoor-mode headset through a running game.

## The headset

The headset is a wireless sensor band, and it is not an accessory: it is half of the system. It catches most tags and shows the shooter that they hit you. Its link also gates play. A gun whose headset is off, unpaired or flat will not join a hosted or app game, and a headset that drops after a game has started locks the tagger's trigger until it reconnects (anti-cheat).

> **One case is unsettled.** Whether a gun booted with no headset at all can still fire a local, on-gun game is not resolved. Battle Company's V7 manual says it can. Operators report guns that will not fire without a headset, which is what the anti-cheat lockout looks like from the outside. Nobody has run the test cleanly: one gun, headset removed before power-on, a local game. Until that is done, treat a headset-less gun as unplayable.

What's on the headset:

- **Sensor domes**: IR receivers around the band. The wire reports front dome hits and back dome hits separately.
- **Green hit LEDs**: 3 W, pointing four ways, bright enough to see in daylight.
- **RGB ring**: WS2812B addressable LEDs. They show team colour, the rainbow when unpaired, and hit feedback.
- **Front IR emitter**: the headset sends IR too. The melee swing (v2 "logo" units) and respawn-station requests fire from the front of the band.
- **Small button**: used to re-pair a Gen-3 headset, and in "install accessory" pairing.
- **PROGRAM pin**: a sunken button. Hold it at power-on to put the headset into USB disk mode for firmware updates.

Headset facts:

| Item | Detail |
|---|---|
| Link to tagger | Wireless, and it pairs by itself after power-on. It can take up to 3 minutes with many taggers and BT devices around. |
| Anti-cheat lockout | If the headset drops after game start, the tagger locks until it reconnects. Whether a gun that never had a headset can fire a local game is unresolved (see above). |
| Apps need it | The official phone app quietly disconnects a tagger with no headset linked. A game hosted from outside cannot hold a link to a headset-less gun either. |
| Battery | One 18650 lithium cell in v2 headsets. It charges from any USB 5 V source. The v1 headset has a slide compartment. |
| Firmware | Reported by the tagger as `hds.59` on the units checked. |
| Extra functions | Short-range scoring without an app, and sensing players who are close by. |
| Spares Battle Company sells | Speakers, sensor circuit boards (front/left/right, "HS 2.0"), a 19" 2-pin wire bundle. |
| Water | A soaked tagger usually survives after days of drying. A soaked headset usually does not. |

> **Before every game, look for rainbow.** A headset cycling slowly through rainbow colours is unpaired. Its tagger will quietly refuse to join a hosted game. Five seconds of looking saves the whole round.

## Battery and power

The tagger runs on a 7.4 V two-cell pack, with one surprise: the connector polarity is backwards.

Tagger battery:

| Item | Value |
|---|---|
| Chemistry / pack | 7.4 V Li-ion, ~2,200 mAh, two cells |
| Connector | 2-pin (aftermarket 3-pin packs fit, because the third pin is a thermistor the BRX ignores) |
| Charger | the supplied 8.4 V two-cell smart charger. Its LED is red while charging and green when full |
| Play time | ~8 h |
| Alternative | 6 x AA alkaline. Never rechargeable AAs. |
| Swap | undo one screw near the reload switch |
| Live readout on the wire | pack voltage, cell voltage and charge % every ~30 s (e.g. 7.52 V pack / 3.96 V cell / 43%) |

> **Polarity is reversed.** Battle Company wires the pack connector the opposite way to the usual convention. Check it with a meter before you wire any replacement pack, external charger or adapter. Getting it wrong risks damaging the tagger.

Power habits that keep a fleet alive:

- **Charge outside the gun**: owners splice a BRX AC adapter onto a spare connector. Keep a stack of charged packs and swap them in the field.
- **Keep them topped up**: below a certain battery level the stock firmware stops re-pairing Bluetooth. That quietly drops players out of hosted games.
- **Rest the guns between sessions**: a tagger left powered all day can enter the "screamer" state. It buzzes loudly and refuses connections until you reboot it and let it rest.
- **Riding electronics**: an add-on may pull under ~300 mA from the tagger, and Battle Company confirmed that is fine. Anything bigger should carry its own power bank.

Headset power:

| Item | Detail |
|---|---|
| Cell | one 18650 lithium cell (v2) |
| Charging | any USB 5 V supply |
| Voltage readout | shown in the tagger's USB console (e.g. "Head: 3.84 V") |

## Generations: which BRX do you have?

Gen1 speaks Bluetooth Classic. Gen2 and Gen3 speak BLE. Here is how to tell in 30 seconds.

| Feature | Gen1 | Gen2 / Gen3 |
|---|---|---|
| Radio | Bluetooth Classic (SPP) via an HC-05-class module, 57,600 baud | Bluetooth Low Energy, Nordic UART Service, 115,200 baud |
| How it shows up | Pairs as a classic BT serial device; guide-era name `LTP-alpha`, pair code `0001` | Advertises as `Tactix-XXXX` (XXXX = last two bytes of its address); the UART service is visible in a BLE scan |
| Phone support | v1 app was Android-only | iOS and Android |
| Headset requirement for the radio | Headset must be connected for Bluetooth to work | A gun with no headset accepts a link, then drops it within seconds |
| "Logo" vs "non-logo" | Non-logo units need extra steps after firmware/disk mode and a pair code | Logo units need no password and have the gesture (melee-swing) headset |
| Everything else | Same IR, same sounds, same game modes | Same |

Identify your generation:

1. Power on the tagger with its headset on and paired.
2. Run a BLE scan on a phone or laptop (any BLE scanner app). A `Tactix-...` device advertising a Nordic UART service means Gen2/3.
3. Nothing on BLE, but it shows up in your phone's Bluetooth settings as a classic serial device means Gen1.
4. To read the exact firmware, plug the micro-USB port into a computer and open the serial console. The `QUERY` record lists gun firmware (`v4.32` on the units checked), headset firmware (`hds.59`), board revision (`PCB-5`) and Bluetooth chip (`BTchip-4`).

> **Gen2 vs Gen3** look the same over the air to every tool available. Both use BLE with Nordic UART. The one difference the community relies on is the Gen-3 headset. It has its own re-pair steps (hold the headset button and RIGHT at tagger power-on for "PAIRING MODE").

> **Firmware note.** Firmware v4.30+ was a "makeover" update. It wipes your settings and breaks headset pairing until you set it up again. It also needs a completely new audio file set. The units checked run `v4.32` with a `devhost` build string. The official Callsign app refuses that build ("supported version is until v2.01e"). Firmware cannot be backed up, because the bootloader is write-only. Never reflash without Battle Company's original image in hand.

## Grenade and accessories

This section covers what each add-on physically is. How to use them lives in the Accessories & Stations section.

Smart Grenade, anatomy:

- **Top button**: powers it on, sets the mode (hold it), and sets off a blast or a respawn by hand.
- **Safety clip**: pop it off to power up.
- **3 IR emitters + 1 emitter/receiver**: it broadcasts over IR with a state beacon every few seconds. It also receives shots, and flashes white when hit.
- **Status LED**: green at boot means ready. In setup it cycles red, green, blue, yellow, white (Frag, Assault, Hill, Respawn, CTF). It turns white when a mode locks in. At boot it flashes the stored mode's colour for ~1 s.
- **USB-C**: charge and power only. It shows no data interface at all, and it has no PROGRAM pin. It was tested off, on and in setup mode with a known-good cable.
- **No pairing for objective modes**: as a respawn point, hill or flag, any tagger can work with it over IR. You only need IR pairing to throw it as a grenade tied to your headset.

> Like the tagger, the grenade keeps no game state and cannot show a winner. It is an IR emitter for objectives and effects. The taggers and headsets play every sound you hear from a grenade event, including the explosion, "control point captured" and the CTF music, all from their own sound banks.

Other accessories:

| Item | What it is |
|---|---|
| Hatchet, shield, sidearm | Accessories you pair over IR, the same way as a thrown grenade. Each has a PROGRAM button for USB firmware updates. |
| Scope | An optical sight. You zero it with the tagger's Target Mode. Sight snipers long and shotguns or SMGs short. |
| Phone bracket | Holds a phone for the Callsign app. Owners also use it to carry an ESP32 and a USB power bank rider (JEDGE-style). That needs no permanent modification to the tagger. A 5,000 mAh pack runs such a rider ~15 h. |
| Sling mount | Community drill size for a sling stud: 7/32" (15/64" is too loose). |
| Utility Box (UBox) | Battle Company's commercial station. It is one networked box that software can switch into 20+ roles (domination, CTF, bomb, respawn, dispensers, targets). It belongs to the EDGE commercial suite, not the BRX consumer kit. |
| 3D-printed skins | The most popular way to change how a tagger looks. Paint is rare (use a black plastic primer base coat if you do). |

### Known wear points (anatomy-level; fixes are in Repairs)

- **D-pad buttons**: the plastic cracks with use. This is the most common failure.
- **Power switch**: a gun that turns itself on and off almost always needs a new switch.
- **Reload handle**: it can bind. A thin nylon washer and silicone lube fix that, and you can test its switch with a pen.
- **IR emitters**: they do die in the end. The emitter and the headset receivers are separate replaceable parts.

## Spec sheet and what's in the box

One page to print. It lists the exact parts, numbers and kit contents for the tagger, the headset and the grenade.

BRX tagger:

| Item | Value |
|---|---|
| Form factor | rifle-style, ABS shell, reload handle on the right |
| Controls | trigger, reload handle, ALT (orange), SELECT, LEFT/RIGHT, power slide switch |
| Emitter | Class 1 IR laser, 980 nm, 38 kHz, 6.5 µs pulses, 111 nJ/pulse, < 18 mm beam at aperture |
| Range | up to ~600 ft; best in shade/night |
| Sensors | hit sensor on the body + wireless headset |
| Indicators | LED bank (mode / team / life gauge) + green kill-confirm in the sight |
| Audio | on-board speaker; 2,477 SFX and voice lines; sound pack replaceable over USB |
| Radio | Bluetooth Classic (Gen1) / BLE Nordic UART (Gen2/3) |
| Ports | charging port, micro-USB programming port |
| MCU | PJRC Teensy |
| Battery | 7.4 V ~2,200 mAh Li-ion (2-cell, reversed polarity) or 6xAA; ~8 h play |
| Manufacturer | Laser Tag Pro / Battle Company, Oak Creek, WI |

BRX headset:

| Item | Value |
|---|---|
| Sensors | IR receiver domes around the band (front/back distinguished on the wire) |
| Feedback | 3 W green hit LEDs (4 directions) + WS2812B RGB ring |
| Emitter | front IR emitter (melee gesture, respawn requests) |
| Link | wireless auto-pair to its tagger; up to 3 min in crowded RF |
| Battery | 1 x 18650; USB 5 V charging |
| Firmware | USB disk mode via PROGRAM pin |

Smart Grenade:

| Item | Value |
|---|---|
| Controls | top button, safety clip |
| IR | 3 emitters + 1 emitter/receiver |
| Status | RGB status LED |
| Port | USB-C (charge only) |
| Modes | Frag, Assault, Hill, Respawn, CTF (5 modes) |

What's in the box (typical retail kit):

| Item | Notes |
|---|---|
| Tagger | with reload handle (screws on) |
| Wireless headset | pre-paired to its tagger at the factory (the tagger's record stores the headset's serial as its pairing PIN) |
| 8.4 V two-cell smart charger | goes red, then green when full |
| Quick manual (V7) | Battle Company's BRX Manual V7 PDF |
| Optional | 6xAA battery holder use, scope, phone bracket, smart grenade |

> **Official documents.** Battle Company's [BRX Manual V7](https://battlecompany.com/wp-content/uploads/2021/01/BRX_Manual_V7_FINAL.pdf) (2021) is the manufacturer's
> own word, and it is linked here rather than rehosted. The BRX Extended User Guide (Laser Tag Pro
> and Battle Company, 2018) is richer than V7 and is the better document, but it circulates in the
> owner community and we have no official public address for it, so there is nothing to link. We do
> not host a copy of either.
