## Open BRX phone app 0.4.17

This build installs over 0.4.6 or later. It includes everything in 0.4.16 (not published on its own), plus the
fixes from the 2026-10-02 bench.

### Fixed

- **A spawn that only half reached the gun is repaired (F416).** After a failed go-live write, the phone checks the
  gun's weapon slot and magazine, not just its pools, and sends the spawn again, so the trigger is never left dead.
- **A held pickup survives a reconnect (F418, F436).** A reconnect puts the pickup back on the trigger, and a
  pickup taken before your first shot of a life is repaired on that first shot.
- **ALT during a reload no longer shows a phantom switch.**
- **Your own shot never hurts you (F438).** An indoor bounce off a wall gives the damage back, and never counts as
  a death.
- **The death scream always plays (F439).** Nothing cuts it, and no heartbeat or health warning plays after it.
- **The go-live taunt plays whole (F437).**
- **King of the Hill is fair to every phone (F440).** Presence is a circle: you are in or out, and being closer
  gives no advantage. A brief signal gap no longer drops you, and a second team contests the point at once.
- **A station's Mission Control link is locked during play (F443).**

### Carried from 0.4.16

See `app-v0.4.16.md`: held pickups through backgrounding, stacked pickups fire every charge, a swap delay after
the last rocket, faster first connect, and the StickS3 powerup range.
