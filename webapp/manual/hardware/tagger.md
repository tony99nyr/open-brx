# The tagger, part by part
_Every button, port, emitter and light on the rifle — and what it is actually for._
Last verified: 2026-08-27

_[diagram HW-02: Annotated tagger anatomy — labels overlaid in HTML as hotspots (see Images table).]_

## Controls at a glance
6 cards:
- **Trigger** — fires; before a game it also cycles weapons/characters and confirms menu picks. Has a mechanical switch you can continuity-test if it stops firing. 📖 👥
- **Reload handle** (right side, screws on) — pull to reload; **pulling it is also how a stock game starts**. A small mechanical switch sits under two screws beneath it. 📖
- **ALT button** (orange) — cycles perks pre-game; **hold 3 s** toggles indoor/outdoor mode. 📖
- **SELECT** — advances settings menus; **hold while powering on** to enter USB disk mode for firmware/sound updates. 📖
- **LEFT / RIGHT** (directional pad) — cycle game modes and teams; **hold LEFT at power-on** = target (sighting) mode; **hold RIGHT at power-on** = accessory/headset pairing mode; **hold LEFT+RIGHT 5 s** in-game = reset to menu. 📖 👥
- **Power switch** — a slide switch by the barrel. A tagger that randomly powers on/off usually has a worn one. 📖 👥
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

## There is no fire-mode selector.
Fire mode (full-auto, single-shot, 3-round burst, hold-to-charge, melee) is a property of the *weapon* you select, not a switch on the gun — it is stored inside the weapon definition.
Source: protocol/brx-protocol.md §"$WEAP t20 — FIRE MODE"

Ports
| col 1 | col 2 | col 3 | col 4 |
|---|---|---|---|
| Charging port | body | DC input for the **8.4 V two-cell smart charger** that ships with the tagger; charger LED goes red → green when full | 📖 |
| micro-USB "Programing Port" | body | Two personalities: on a normal boot it is a **USB serial console** (the tagger's Teensy microcontroller shows up as a COM port — "PuTTY into the tagger"); with **SELECT held at power-on** it becomes a **USB disk** exposing the firmware `.BIN` and the `AUDIO` folder | ✅ 📖 |
| Headset jack | — | **None.** The headset links wirelessly | ✅ |
| Accessory port | — | **None** on Gen2/3 units we have opened up to the connector level — micro-USB only | ✅ |
Source: protocol/brx-protocol.md §7c, docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

## What's inside (for the curious — you do not need to open it)
- **Microcontroller:** a PJRC **Teensy** (ARM). The USB port enumerates as "Teensyduino USB Serial". ✅
- **Radio:** a Bluetooth module bridged to the MCU's serial port — which is why BLE and a wired UART speak identical frames. Board label on our units: `PCB-5`, `BTchip-4`. ✅
- **Sound storage:** an SD card on the mainboard — it is never removed for sound updates (they go over USB). 👥 📖
- **Speaker:** a "pop" from the speaker at boot means speaker power is fine. 👥
- **Warning:** unplugging the battery before *any* internal work is mandatory — a live pack during a mod is the classic way to kill a mainboard. 👥
Source: protocol/brx-protocol.md §7c, docs/experiment-log.md (QUERY dump), docs/reference/community-notes.md

_[image HW-05: (ports close-up — see Images table)]_
