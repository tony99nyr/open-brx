# The headset
_A wireless sensor band that decides whether your tagger is allowed to shoot._
Last verified: 2026-08-27

The headset is not an accessory — it is half of the system. It catches most tags, gives visible feedback to the shooter, and the tagger **refuses to fire when its headset drops mid-game**.
Source: docs/reference/brx-manual-notes.md, docs/reference/community-notes.md

_[image HW-03: (see Images table)]_

## What's on the headset
- **Sensor domes** — IR receivers around the band; the wire reports **front** vs **back** dome hits separately. ✅
- **Green hit LEDs** — 3 W, four directions, daylight-visible. 📖
- **RGB ring** — WS2812B addressable LEDs for team colour, rainbow-when-unpaired and feedback. 👥 ✅
- **Front IR emitter** — the headset can *emit* too: the melee gesture (v2 "logo" units) and respawn-station requests fire from the front of the headset. 📖 ✅
- **Small button** — used in the Gen-3 re-pair procedure and in "install accessory" pairing. 👥
- **PROGRAM pin** — a recessed button held at power-on to put the headset into USB disk mode for firmware updates. 📖
Source: protocol/brx-protocol.md §"$HIR token 1", docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/grenade.md

Headset facts
| col 1 | col 2 | col 3 |
|---|---|---|
| Link to tagger | Wireless; pairs automatically after power-on. Can take **up to 3 minutes** with many taggers/BT devices around | 📖 |
| Anti-cheat lockout | Headset drops after game start → tagger locks until it reconnects | 📖 |
| Apps need it | The official phone app silently disconnects a tagger that has no linked headset; an externally-hosted game cannot hold a link to a headset-less gun either | ✅ |
| Battery | Single **18650** lithium cell (v2 headsets); charges from **any USB 5 V** source; v1 has a slide compartment | 👥 📖 |
| Firmware | Reported by the tagger as `hds.59` on our units | ✅ |
| Extra functions | Offline short-range scoring and player-proximity detection | 📖 |
| Spares Battle Company sells | Speakers, sensor circuit boards (front/left/right, "HS 2.0"), a 19" 2-pin wire bundle | 👥 |
| Water | Taggers usually survive a soaking after days of drying; **headsets usually do not** | 👥 |
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7m §7r, docs/reference/community-notes.md

## Before every game: look for rainbow.
A slowly rainbow-cycling headset is unpaired, and its tagger will silently refuse to join a hosted game. Five seconds of eyeballing saves the whole round.
Source: docs/gotchas.md, docs/field-process.md
