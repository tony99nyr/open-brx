## Open BRX phone app 0.4.9

A hotfix. **Everyone should update.** If you have 0.4.6 or later, this build installs over it. If you still have
0.4.5 or earlier, uninstall that once first: older builds used a test key, and Android will not update across keys.

### Fixed

- **A crash while the link to Mission Control kept reconnecting.** When the phone's link to Mission Control
  dropped and reconnected over and over, the app could crash. The link now sends its events on one thread, so
  a reconnect loop no longer crashes it. The bug was present since 0.4.6.

### Confirmed

- **The headset-join fix from 0.4.8 is bench-confirmed.** The phone waits for the headset to join the gun before
  the gun link counts as up (F293). The bench test re-measured it.

### Not yet

- **Per-venue IR power (S48)**, the **close-range headset-damage setting (F275)** and **hearing your own
  team's hill capture (F312)** are still waiting on bench tests. They are not in this build.
- **Powerups** are still built but OFF by default.
