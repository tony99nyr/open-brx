# The BRX at a glance
_A laser tagger shaped like a rifle, a wireless sensor headset, and a smart grenade. Plus what they are not._
Last verified: 2026-09-06

The Battle Company BRX is a laser tagger shaped like a rifle, and it comes with a wireless sensor headset. 📖 It shoots a coded beam of invisible light at 980 nm and 38 kHz. It plays 2,000+ sounds through its own speaker, and a small bank of lights shows what it is doing. There is no screen, no WiFi, and no memory of the game you just played.
Source: docs/reference/brx-extended-user-guide.md, docs/reference/edge-brp.md, protocol/session-findings-2026-08.md §7n

_[image HW-01: (see Images table)]_

Four numbers that sum up the BRX:
- **980 nm / 38 kHz**: the IR beam every shot rides on 📖
- **~600 ft**: how far a shot usually reaches. Shade and night are better, and bright sun cuts it about in half 📖
- **~8 h**: play time on one charge 📖
- **2,477**: sound files on the tagger, every one catalogued ✅
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/sound-catalog.md

## The system, in three objects
- **Tagger**: the rifle. It fires the IR beam and carries a hit sensor on its body. Inside sit the speaker, the sound bank, the battery, the Bluetooth radio and all the logic for a stock game. 📖 ✅
- **Headset**: the sensor band you wear. It catches most incoming tags because it is the bigger target. It lights up for feedback, links to its own tagger without wires, and decides whether that tagger may fire. 📖 ✅
- **Smart Grenade**: an extra device that sends out IR, with a button and a status light. Throw it as a blast weapon, or drop it as an objective (respawn point, hill, flag). ✅
Source: docs/reference/brx-manual-notes.md, docs/reference/grenade.md

## What the BRX is NOT.
This shapes everything else in the manual.
- **No screen.** Lights and voice lines are the only way to see your ammo and health. The commercial Battle Rifle Pro has an LCD. The BRX does not. 📖
- **No WiFi.** Bluetooth is the only radio that reaches the outside world (Classic on Gen1, BLE on Gen2/3). 📖 ✅
- **Keeps no game state.** Switch it off and on, and any settings you sent it are gone. It never reports a score, and a stock game keeps no score at all. "How do I see my score?" is the first question at every game. ✅ 👥
- **No headset cable.** The headset is wireless. There is no headset jack on the tagger. 📖 ✅
- **No firmware backup.** You can write firmware over USB, but you can never read it back (the bootloader is write-only). ✅
Source: docs/reference/edge-brp.md, protocol/brx-protocol.md §1, protocol/session-findings-2026-08.md §7c, §7n, docs/reference/community-notes.md

## A gun whose headset is off, unpaired or flat just refuses to join. No error, no voice line.
That is the number one cause of a wasted game start, straight from our field notes.
Source: docs/gotchas.md
