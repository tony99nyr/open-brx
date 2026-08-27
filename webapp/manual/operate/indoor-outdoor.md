# Indoor vs Outdoor Mode
_One three-second hold that changes range, LEDs and blast radius._
Last verified: 2026-08-27

## Switching modes
1. Hold **ALT for 3 seconds** at any time; the gun announces the new mode. 📖
2. The setting **persists across power cycles** — set it once per venue. 📖
3. If you host from the Callsign app, its per-game **Outdoor mode** toggle sets the same thing. ✅
Source: docs/reference/brx-extended-user-guide.md, docs/reference/callsign-ui.md, protocol/brx-protocol.md §7g

## What changes
| | Indoor | Outdoor |
|---|---|---|
| Green hit LEDs | dimmed 📖 | full brightness 📖 |
| RGB headset LEDs | enabled 📖 | (bright-sun visibility is poor on any headset) 👥 |
| Explosion / melee range | shrunk 📖 | full 📖 |
| Station / respawn-signal reach | shorter — the forward IR projection scales with mode ✅ | ~18–20 ft to a respawn station ✅ |
| Gun hit radius | — | bright sunlight cuts it roughly in half (IR noise filtering) 📖 |
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/grenade.md

Use indoor mode indoors even if the room is big. Full-power IR in a small space bounces off walls, and a bounce can register on your own headset — we have watched a gun drain its own armor firing at a wall a few feet away.
Source: docs/gotchas.md (Capturing IR), docs/experiment-log.md

_[image OPS-04: ]_
