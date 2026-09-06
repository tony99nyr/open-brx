# Spec sheet and what's in the box
_One page to print. It lists the exact parts, numbers and kit contents for the tagger, the headset and the grenade._
Last verified: 2026-09-06

_[image HW-11: (what's-in-the-box flat lay, see Images table)]_

## BRX tagger
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
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md (IR specs, charger, manufacturer address), docs/reference/community-notes.md (battery pack, polarity), protocol/brx-protocol.md §1, protocol/session-findings-2026-08.md §7c + docs/experiment-log.md 2026-08-23 (USB console, Teensy MCU), protocol/session-findings-2026-08.md §7o (sight flash)

## BRX headset
- Sensors: IR receiver domes around the band (front/back distinguished on the wire) ✅
- Feedback: 3 W green hit LEDs (4 directions) + WS2812B RGB ring 📖 👥
- Emitter: front IR emitter (melee gesture, respawn requests) 📖
- Link: wireless auto-pair to its tagger; up to 3 min in crowded RF 📖
- Battery: 1 × 18650; USB 5 V charging 👥 📖
- Firmware: USB disk mode via PROGRAM pin 📖

## Smart Grenade
- Top button · safety clip · 3 IR emitters + 1 emitter/receiver · RGB status LED · USB-C (charge only) ✅
- 5 modes: Frag · Assault · Hill · Respawn · CTF ✅

What's in the box (typical retail kit)
| col 1 | col 2 | col 3 |
|---|---|---|
| Tagger | with reload handle (screws on) | 📖 |
| Wireless headset | pre-paired to its tagger at the factory (the tagger's record stores the headset's serial as its pairing PIN) | ✅ 📖 |
| 8.4 V two-cell smart charger | red → green LED | 📖 |
| Quick manual (V7) | link: Battle Company's BRX Manual V7 PDF | 📖 |
| Optional | 6×AA battery holder use, scope, phone bracket, smart grenade | 📖 👥 |
Source: docs/reference/brx-manual-notes.md, protocol/session-findings-2026-08.md §7c

## Official documents
(linked, not rehosted): Battle Company *BRX Manual V7* (battlecompany.com, 2021) and the *BRX Extended User Guide* (Laser Tag Pro, 2018). The PDFs are the manufacturer's own word. Where we mark ✅, we measured it ourselves.
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md
