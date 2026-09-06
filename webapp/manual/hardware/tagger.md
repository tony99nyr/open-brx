# The tagger, part by part
_Every button, port, emitter and light on the rifle, and what each one is really for._
Last verified: 2026-09-06

_[diagram HW-02: Labelled tagger anatomy. The labels sit on top in HTML as hotspots (see Images table).]_

## Controls at a glance
- **Trigger**: fires the gun. Before a game it also flips through weapons and characters and picks menu items. A switch sits behind it, and you can test that switch with a meter if the gun stops firing. 📖 👥
- **Reload handle** (right side, screws on): pull it to reload. **Pulling it also starts a stock game.** A small switch sits under two screws beneath it. 📖
- **ALT button** (orange): flips through perks before a game. **Hold it 3 s** to switch between indoor and outdoor mode. 📖
- **SELECT**: moves you through the settings menus. **Hold it while you power on** to enter USB disk mode for firmware and sound updates. 📖
- **LEFT / RIGHT** (the direction pad): flip through game modes and teams. **Hold LEFT at power-on** = target (sighting) mode. **Hold RIGHT at power-on** = accessory and headset pairing mode. **Hold LEFT+RIGHT 5 s** in a game = back to the menu. 📖 👥
- **Power switch**: a slide switch by the barrel. A tagger that turns itself on and off usually has a worn one. 📖 👥
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

## There is no fire-mode selector.
Fire mode belongs to the *weapon* you pick, not to a switch on the gun. The modes are full-auto, single-shot, 3-round burst, hold-to-charge and melee. Each one is stored inside the weapon definition.
Source: protocol/brx-protocol.md §"$WEAP t20 - FIRE MODE"

Ports
| col 1 | col 2 | col 3 | col 4 |
|---|---|---|---|
| Charging port | body | Where the **8.4 V two-cell smart charger** in the box plugs in. Its LED goes red, then green when the pack is full | 📖 |
| micro-USB "Programing Port" | body | It does two jobs. On a normal boot it is a **USB serial console**. The tagger's Teensy microcontroller then shows up as a COM port ("PuTTY into the tagger"). Hold **SELECT at power-on** and it becomes a **USB disk** that shows the firmware `.BIN` and the `AUDIO` folder | ✅ 📖 |
| Headset jack | n/a | **There is none.** The headset links wirelessly | ✅ |
| Accessory port | n/a | **There is none** on the Gen2/3 units we have opened up and checked at the connector. Micro-USB is the only port | ✅ |
Source: protocol/session-findings-2026-08.md §7c, docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

## What's inside (for the curious, you do not need to open it)
- **Microcontroller:** a PJRC **Teensy** (ARM). Plug in USB and it shows up as "Teensyduino USB Serial". ✅
- **Radio:** a Bluetooth module wired to the microcontroller's serial port. That is why BLE and a wired serial cable send the exact same frames. Board label on our units: `PCB-5`, `BTchip-4`. ✅
- **Sound storage:** an SD card on the mainboard. You never take it out to change sounds, because sound updates go over USB. 👥 📖
- **Speaker:** a "pop" from the speaker when the gun boots means the speaker has power. 👥
- **Warning:** always unplug the battery before *any* work inside. A live pack during a mod is the classic way to kill a mainboard. 👥
Source: protocol/session-findings-2026-08.md §7c, docs/experiment-log.md (QUERY dump), docs/reference/community-notes.md

_[image HW-05: (ports close-up, see Images table)]_
