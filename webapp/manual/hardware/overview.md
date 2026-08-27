# The BRX at a glance
_A rifle-form laser tagger, a wireless sensor headset, and a smart grenade — and everything they are not._
Last verified: 2026-08-27

The Battle Company BRX is a rifle-form-factor infrared laser tagger paired with a wireless sensor headset. 📖 It fires a 980 nm, 38 kHz coded IR pulse, plays 2,000+ on-board sounds through its own speaker, and shows state on a small bank of LEDs — no screen, no WiFi, no memory of the game it just played.
Source: docs/reference/brx-extended-user-guide.md, docs/reference/edge-brp.md, protocol/brx-protocol.md §7n

_[image HW-01: (see Images table)]_

Four numbers that define the BRX:
- **980 nm / 38 kHz** — the IR carrier every shot rides on 📖
- **~600 ft** — typical maximum range; better in shade and at night, roughly halved in bright sun 📖
- **~8 h** — play time per charge 📖
- **2,000+** — sound effects and voice lines stored on the tagger (2,166 ids catalogued) ✅
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, protocol/callsign-extract/ (sound bank)

## The system, in three objects
3 cards:
- **Tagger** — the rifle. Emits IR, carries a hit sensor on its body, the speaker, the sound bank, the battery, the radio (Bluetooth) and all the game logic for a stock game. 📖 ✅
- **Headset** — the head-worn sensor band. Catches most incoming tags (it is the bigger target), lights up for feedback, links wirelessly to its own tagger, and gates whether the tagger is allowed to fire. 📖 ✅
- **Smart Grenade** — an optional IR broadcaster with a button and a status LED. Throwable blast weapon *or* a portable objective (respawn point, hill, flag). ✅
Source: docs/reference/brx-manual-notes.md, docs/reference/grenade.md

## What the BRX is NOT
this shapes everything else in the manual.
- **No screen.** Ammo and health are shown only by LEDs and voice lines. The commercial Battle Rifle Pro has an LCD; the BRX does not. 📖
- **No WiFi.** The only radio to the outside world is Bluetooth (Classic on Gen1, BLE on Gen2/3). 📖 ✅
- **Keeps no game state.** A power-cycle wipes any configuration pushed to it, it never reports a score, and stock play is non-scoring out of the box — "how do I see my score?" is the first question at every game. ✅ 👥
- **No headset cable.** The headset is wireless; there is no headset jack on the tagger. 📖 ✅
- **No user-serviceable flash.** Firmware can be written over USB but never read back (write-only bootloader). ✅
Source: docs/reference/edge-brp.md, protocol/brx-protocol.md §1 §7c §7n, docs/reference/community-notes.md

## A gun whose headset is off, unpaired or flat silently refuses to join — no error, no voice line.
the single most common cause of a wasted game start, from our field notes.
Source: docs/gotchas.md
