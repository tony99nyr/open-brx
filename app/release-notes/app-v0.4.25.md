## Open BRX phone app 0.4.25

This build installs over 0.4.6 or later. It includes everything in 0.4.24, plus two fixes from the 2026-10-17 bench.

### Fixed

- **An ALT switch shows the right weapon on the HUD** (F542). The gun's `$QUERY` reply gives the slot of the last
  shot, not the selected slot, so 0.4.24 read every ALT as ignored. The phone now assumes the swap after the swap
  delay, and the next shot corrects the slot. A reload during a swap books on the old slot. The Rockets equip
  read-back is removed.
- **A gun rebooted while its player is down is set up again with no new death** (F532, the down case). The
  player stays down until the respawn.

### Carried from 0.4.24

See `app-v0.4.24.md`.
