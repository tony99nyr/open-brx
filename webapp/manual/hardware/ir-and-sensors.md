# The IR emitter, the sight, and the sensors
_The invisible beam that carries every tag. Here are the published specs and what we measured._
Last verified: 2026-08-27

## IR emitter (Class 1 laser, IEC 60825-1)
from Battle Company's Extended User Guide 📖
- Wavelength: **980 nm** (note: many hobby IR parts are 940 nm, so pick 980 nm-capable receivers for anything you build)
- Pulse width: **6.5 µs**
- Energy per pulse: **111 nJ**
- Pulse repetition (carrier): **38,000 Hz**
- Beam: **< 18 mm at the aperture**
- Factory record on one of our units reports the laser at **16.9 mW** ✅
Source: docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7c

What a shot looks like on the air (bench-measured)
| col 1 | col 2 | col 3 |
|---|---|---|
| Frame | one ~25-bit word per shot, pulse-width encoded | ✅ |
| Sync pulse | ~1,990 µs | ✅ |
| "1" mark / "0" mark | ~990 µs / ~500 µs | ✅ |
| Carried in every shot | player id (0–63), team, damage, damage type, crit flag | ✅ |
| Receiver that decodes it | any 38 kHz demodulating IR receiver (the community IDs the Vishay TSSP38 in the headset) | ✅ 👥 |
Source: protocol/brx-ir-protocol.md, docs/reference/lasertagmods.md

## Range and light.
A shot usually reaches about 600 ft. Range *drops* in full sun and *improves* in shade or at night. Bright sunlight roughly **halves the gun's hit radius**, because the gun filters out IR noise. Indoor mode shrinks explosion and melee range on purpose.
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

## You cannot see the beam.
A phone camera will not show a low-power 38 kHz IR emitter. If both cameras show nothing, the gun can still be perfectly fine. Test with a receiver or another tagger, never with a camera.
Source: docs/gotchas.md

## Where you can be tagged
- **Headset domes**: the main target. Our bench can tell a **front** dome hit from a **back** dome hit on the wire. Battle Company sells front, left and right sensor boards as spares. ✅ 👥
- **Gun body sensor**: a hit sensor on the rifle itself. ✅ 📖
- **The tagger says which sensor caught it**: at normal range it knows whether a tag landed front, back or on the gun. Point-blank, IR floods every receiver and you cannot trust the answer. ✅
Source: protocol/brx-protocol.md §"$HIR token 1 - sensor id map", docs/reference/community-notes.md

## The sight
- The tagger's sight has a **green kill-confirm flash**. Score a kill and the sight glows green for a few seconds. ✅
- **Sighting a scope** happens in **Target Mode** (hold LEFT while powering on). Shots do zero damage, ammo is unlimited, and a direct hit flashes the target's headset green. Owners sight snipers long (300–400 ft) and shotguns or SMGs close (50–100 ft). 📖 👥
Source: protocol/brx-protocol.md §7o, docs/reference/brx-manual-notes.md, docs/reference/community-notes.md

_[image HW-09: (IR waveform illustration, see Images table)]_
