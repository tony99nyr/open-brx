# Generations — which BRX do you have?
_Gen1 speaks Bluetooth Classic; Gen2 and Gen3 speak BLE. Here is how to tell in 30 seconds._
Last verified: 2026-08-27

Gen1 vs Gen2/3
| col 1 | col 2 | col 3 |
|---|---|---|
| Radio | **Bluetooth Classic (SPP)** via an HC-05-class module, 57,600 baud ✅ 👥 | **Bluetooth Low Energy**, Nordic UART Service, 115,200 baud ✅ |
| How it shows up | Pairs as a classic BT serial device; guide-era name `LTP-alpha`, pair code `0001` 📖 👥 | Advertises as `Tactix-XXXX` (XXXX = last two bytes of its address); the UART service is visible in a BLE scan ✅ |
| Phone support | v1 app was Android-only 📖 | iOS and Android |
| Headset requirement for the radio | Headset must be connected for Bluetooth to work 👥 | A headset-less gun accepts a link then drops it within seconds ✅ |
| "Logo" vs "non-logo" | Non-logo units need extra steps after firmware/disk mode and a pair code 📖 | Logo units need no password and have the gesture (melee-swing) headset 📖 |
| Everything else | Same IR, same sounds, same game modes | Same |
Source: protocol/brx-protocol.md §1 §7a §7r, docs/reference/brx-extended-user-guide.md, docs/reference/lasertagmods.md

## Identify your generation
1. Power on the tagger with its headset on and paired.
2. Run a BLE scan on a phone or laptop (any BLE scanner app). **A `Tactix-…` device advertising a Nordic UART service = Gen2/3.** ✅
3. Nothing on BLE, but the tagger appears as a classic Bluetooth serial device in your phone's Bluetooth settings = **Gen1**. ✅
4. For the exact firmware, plug the micro-USB port into a computer and open the serial console; the `QUERY` record lists gun firmware (ours: `v4.32`), headset firmware (`hds.59`), board revision (`PCB-5`) and Bluetooth chip (`BTchip-4`). ✅
Source: protocol/brx-protocol.md §1 §7c

## Gen2 vs Gen3
are, to every tool we have, the same over the air — both are BLE/Nordic-UART. The distinguishing feature the community relies on is the **Gen-3 headset**, which has its own re-pair procedure (headset button held + RIGHT at tagger power-on → "PAIRING MODE"). Covered in the Pairing section.
Source: docs/reference/community-notes.md

## Firmware note.
Firmware v4.30+ was a "makeover" update: it wipes configuration, breaks headset pairing until re-set-up, and needs a completely new audio file set. Our own units run `v4.32` with a `devhost` build string that the official Callsign app refuses ("supported version is until v2.01e"). Firmware **cannot be backed up** — the bootloader is write-only — so never reflash without Battle Company's original image in hand.
Source: docs/reference/community-notes.md, protocol/brx-protocol.md §7b §7c

_[diagram HW-08: (two radios — see Images table)]_
