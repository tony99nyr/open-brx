# Indoor vs Outdoor Mode
_One three-second hold changes your range, your LEDs and your blast radius._
Last verified: 2026-08-27

## Switching modes
1. Hold **ALT for 3 seconds** at any time. The gun announces the new mode. 📖
2. Leave it. The setting **persists across power cycles**, so you set it once per venue. 📖
3. Host from the Callsign app instead? Its per-game **Outdoor mode** toggle sets the same thing. ✅
4. Driving a gun from your own code? It is `$GSET` **token 2**, `outdoorMode`. A second field,
   token 3 `gunLaserRegion`, carries the IR power limit. Both are in the
   [developer reference](/manual/dev/gset-pset). 🔍
Source: docs/reference/brx-extended-user-guide.md, docs/reference/callsign-ui.md, protocol/session-findings-2026-08.md §7g

## What changes
| | Indoor | Outdoor |
|---|---|---|
| Green hit LEDs | dimmed 📖 | full brightness 📖 |
| RGB headset LEDs | enabled 📖 | (bright-sun visibility is poor on any headset) 👥 |
| Explosion / melee range | shrunk 📖 | full 📖 |
| Station / respawn-signal reach | shorter, because the forward IR projection scales with mode ✅ | ~18–20 ft to a respawn station ✅ |
| Gun hit radius | n/a | bright sunlight cuts it roughly in half (IR noise filtering) 📖 |
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/grenade.md

Use indoor mode indoors, even in a big room. Full-power IR in a small space bounces off walls, and a bounce can land on your own headset. We have watched a gun drain its own armor by firing at a wall a few feet away.
Source: docs/gotchas.md (Capturing IR), docs/experiment-log.md

_[image OPS-04: ]_
