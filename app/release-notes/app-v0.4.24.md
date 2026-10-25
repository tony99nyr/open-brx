## Open BRX phone app 0.4.24

This build installs over 0.4.6 or later. It includes everything in 0.4.23, plus the fixes from the 2026-10-16 bench.

### Fixed

- **A fast operator respawn waits until 2.5 s after the death** (F530), so the headset leaves the death flash.
- **A rebooted gun is set up again with no death** (F532). The pools go back to the last-known values. A failed or
  silent reboot check retries up to 3 times, then heals.
- **The healing head's own echo is not a death** (F532).
- **A hill phone left assigned after KOTH no longer runs in FFA** (F535).
- **A hill does not flap while the phone's own scan is closed** (F537).
- **A relink at go-live reconnects from a fresh scan** (F541). A tap on TAP TO RECONNECT during a relink restarts it.
- **The phone takes the weapon slot from the gun** (F542). After an ALT, the switch card reads CONFIRMED BY YOUR GUN.
  A reload during a swap reloads the new slot, and a Rockets equip is read back and re-sent once if the gun missed it.

### Carried from 0.4.23

See `app-v0.4.23.md`.
