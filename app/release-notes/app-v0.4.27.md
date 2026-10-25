## Open BRX phone app 0.4.27

This build installs over 0.4.6 or later. It includes everything in 0.4.26, plus three fixes from the 2026-10-24 milestone review. Reflash every Stick from main: the Stick hill code changed.

### Fixed

- **A late station tick no longer banks a whole gap of hill time** (hill possession). A control station that ticked late, for example a throttled station phone, banked the whole gap from one presence sample, which could give or take minutes of KOTH hold. The phone station and the Stick (`presence.h`) both changed.
- **Arming a match wakes a gun reconnect that is waiting** (F563). After repeated drops in the lobby, the phone could wait up to 5 minutes before it tried the gun again, even once the match armed. In a match the wait now drops to the match quiet period, and a retry gap ends at once.
- **A stale `$LCD` or an old weapon's `$ALCD` no longer proves the config** (F549, round 2). Only an echo of the head just written proves that the gun took the config.

### Carried from 0.4.26

See `app-v0.4.26.md`.
