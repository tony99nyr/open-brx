# The headset
_A wireless sensor band that decides whether your tagger is allowed to shoot._
Last verified: 2026-09-06

The headset is not an accessory. It is half of the system. It catches most tags and shows the shooter that they hit you. The tagger also **refuses to fire when its headset drops mid-game**.
Source: docs/reference/brx-manual-notes.md, docs/reference/community-notes.md

_[image HW-03: (see Images table)]_

## What's on the headset
- **Sensor domes**: IR receivers around the band. The wire reports **front** dome hits and **back** dome hits separately. ✅
- **Green hit LEDs**: 3 W, pointing four ways, bright enough to see in daylight. 📖
- **RGB ring**: WS2812B addressable LEDs. They show team colour, the rainbow when unpaired, and hit feedback. 👥 ✅
- **Front IR emitter**: the headset *sends* IR too. The melee swing (v2 "logo" units) and respawn-station requests fire from the front of the band. 📖 ✅
- **Small button**: used to re-pair a Gen-3 headset, and in "install accessory" pairing. 👥
- **PROGRAM pin**: a sunken button. Hold it at power-on to put the headset into USB disk mode for firmware updates. 📖
Source: protocol/brx-protocol.md §"$HIR token 1", docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/grenade.md

Headset facts
| col 1 | col 2 | col 3 |
|---|---|---|
| Link to tagger | Wireless, and it pairs by itself after power-on. It can take **up to 3 minutes** with many taggers and BT devices around | 📖 |
| Anti-cheat lockout | If the headset drops after game start, the tagger locks until it reconnects | 📖 |
| Apps need it | The official phone app quietly disconnects a tagger with no headset linked. A game hosted from outside cannot hold a link to a headset-less gun either | ✅ |
| Battery | One **18650** lithium cell in v2 headsets. It charges from **any USB 5 V** source. The v1 headset has a slide compartment | 👥 📖 |
| Firmware | Reported by the tagger as `hds.59` on our units | ✅ |
| Extra functions | Short-range scoring without an app, and sensing players who are close by | 📖 |
| Spares Battle Company sells | Speakers, sensor circuit boards (front/left/right, "HS 2.0"), a 19" 2-pin wire bundle | 👥 |
| Water | A soaked tagger usually survives after days of drying. **A soaked headset usually does not** | 👥 |
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, protocol/session-findings-2026-08.md §7m, §7r, docs/reference/community-notes.md

## Before every game, look for rainbow.
A headset cycling slowly through rainbow colours is unpaired. Its tagger will quietly refuse to join a hosted game. Five seconds of looking saves the whole round.
Source: docs/gotchas.md, docs/field-process.md
