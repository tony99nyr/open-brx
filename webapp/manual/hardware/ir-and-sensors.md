# The IR emitter, the sight, and the sensors
_The invisible beam that carries every tag — its published specs and what we measured._
Last verified: 2026-08-27

IR emitter (Class 1 laser, IEC 60825-1) — from Battle Company's Extended User Guide 📖:
- Wavelength: **980 nm** (note: many hobby IR parts are 940 nm — pick 980 nm-capable receivers for anything you build)
- Pulse width: **6.5 µs**
- Energy per pulse: **111 nJ**
- Pulse repetition (carrier): **38,000 Hz**
- Beam: **< 18 mm at the aperture**
- Factory record on one of our units reports the laser at **16.9 mW** ✅
Source: docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7c

What a shot looks like on the air (bench-measured)
- Frame | one ~25-bit word per shot, pulse-width encoded | ✅
- Sync pulse | ~1,990 µs | ✅
- "1" mark / "0" mark | ~990 µs / ~500 µs | ✅
- Carried in every shot | player id (0–63), team, damage, damage type, crit flag | ✅
- Receiver that decodes it | any 38 kHz demodulating IR receiver (community IDs the Vishay TSSP38 in the headset) | ✅ 👥
Source: protocol/brx-ir-protocol.md, docs/reference/lasertagmods.md

## Range and light.
Typical maximum is ~600 ft; range *drops* in full sun and *improves* in shade or at night. Bright sunlight roughly **halves the gun's hit radius** because of IR-noise filtering. Indoor mode deliberately shrinks explosion/melee range.
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

## You cannot see the beam.
A phone camera will not show a low-power 38 kHz IR emitter — both cameras showing nothing is consistent with a working gun. Use a receiver (or another tagger) to test, never a camera.
Source: docs/gotchas.md

## Where you can be tagged
3 cards:
- **Headset domes** — the primary target. Our bench distinguishes a **front** and a **back** dome on the wire; Battle Company sells front/left/right sensor boards as spares. ✅ 👥
- **Gun body sensor** — a hit sensor on the rifle itself. ✅ 📖
- **Which sensor caught it is reported** — at field distance, the tagger knows whether a tag landed front, back or on the gun. Point-blank, IR floods every receiver and the distinction is unreliable. ✅
Source: protocol/brx-protocol.md §"$HIR token 1 — sensor id map", docs/reference/community-notes.md

## The sight
- The tagger's sight carries a **green kill-confirm flash**: when you score a kill, the sight lights green for a few seconds. ✅
- **Sighting a scope** is done in **Target Mode** (hold LEFT while powering on): zero damage, unlimited ammo, and a direct hit flashes the target's headset green. Community practice: sight snipers long (300–400 ft), shotgun/SMG close (50–100 ft). 📖 👥
Source: protocol/brx-protocol.md §7o, docs/reference/brx-manual-notes.md, docs/reference/community-notes.md

_[image HW-09: (IR waveform illustration — see Images table)]_
