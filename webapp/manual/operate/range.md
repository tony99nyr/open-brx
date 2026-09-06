# Range & Line of Sight
_What the numbers on the box mean once the sun comes out._
Last verified: 2026-08-27

- **~600 ft**: the rated maximum reach of the IR beam in daylight (Battle Company). 📖
- **~50 %**: how much bright direct sunlight shrinks the gun's hit radius. 📖
- **980 nm / 38 kHz**: the IR wavelength and carrier. It is a Class 1 device, safe for eyes. 📖
- **~18–20 ft**: how far a respawn station "hears" a headset-and-trigger request outdoors. ✅
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/grenade.md

## Line-of-sight rules of thumb
- **IR is light.** It needs a clear path to a sensor dome. It does not go through people, walls or dense foliage. Shade and dusk **improve** range, and full noon sun cuts it. 📖
- **It bounces.** In small rooms and near walls a shot can reflect back onto your own headset. Use indoor mode indoors. ✅
- **The headset is the bigger target.** Head-height domes on four sides catch far more than the gun's own sensor, so snipers aim for the head. 👥
- **Close range is chaos.** Point-blank, every dome reports. At distance the facing dome reports. Neither changes the damage. ✅
- **Feedback fades in sun.** The headset's green hit LEDs are hard to read in direct sun, so long-range tags look like misses. Listen for the target's hit sound instead. 👥
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/gotchas.md, protocol/session-findings-2026-08.md §7r

Bluetooth range is not IR range. The phone hosting a game has to stay within Bluetooth reach of its gun. In practice that means mounted on it. IR shots still land at hundreds of feet. It is the *game logic* that stops working when the phone is out of range.
Source: protocol/session-findings-2026-08.md §7n
