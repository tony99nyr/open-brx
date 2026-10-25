## Open BRX phone app 0.4.23

This build installs over 0.4.6 or later. It includes everything in 0.4.22, plus the fixes from the 2026-10-16 bench.

### Fixed

- **An aborted start no longer ends the match on the phone** (F529). The phone ignores an end that names the start
  it aborted. A failed head write is written again before the match goes live, and healed if it fails while live.
- **A fast operator respawn stops the headset death flash** (F530).
- **A phone that missed a reschedule drops the old start** (F531).
- **A gun power-cycled mid-match is set up again on the relink, with no death** (F532).
- **A spawn on a gun with no weapon setup is repaired** (F533). The phone writes the head again and re-arms, so the
  player does not play with no ammo.
- **An energy weapon's prompt says RECHARGE** (F500).
- **The hill captures only for close players** (F464). A player at the edge still contests, but builds no capture.
