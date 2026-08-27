# Range & Line of Sight
_What the numbers on the box mean once the sun comes out._
Last verified: 2026-08-27

- **~600 ft** — rated maximum reach of the IR beam in daylight (Battle Company). 📖
- **~50 %** — how much bright direct sunlight shrinks the gun's hit radius. 📖
- **980 nm / 38 kHz** — the IR wavelength and carrier; a Class 1 device, safe for eyes. 📖
- **~18–20 ft** — how far a respawn station "hears" a headset-and-trigger request outdoors. ✅
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/grenade.md

## Line-of-sight rules of thumb
- **IR is light.** It needs a clear path to a sensor dome; it does not go through people, walls or dense foliage. Shade and dusk **improve** range; full noon sun reduces it. 📖
- **It bounces.** In small rooms and near walls a shot can reflect back onto your own headset. Use indoor mode indoors. ✅
- **The headset is the bigger target.** Head-height domes on four sides catch far more than the gun's own sensor; snipers aim for the head. 👥
- **Close range is chaos.** Point-blank, every dome reports; at distance the facing dome reports. Neither changes the damage. ✅
- **Feedback fades in sun.** The headset's green hit LEDs are hard to read in direct sun, so long-range tags look like misses. Listen for the target's hit sound instead. 👥
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/gotchas.md, protocol/brx-protocol.md §7r

Bluetooth range is not IR range. The phone hosting a game must stay within Bluetooth reach of its gun — in practice mounted on it. IR shots still land at hundreds of feet; the *game logic* is what stops working when the phone is out of range.
Source: protocol/brx-protocol.md §7n
