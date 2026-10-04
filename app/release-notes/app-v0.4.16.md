## Open BRX phone app 0.4.16

This build installs over 0.4.6 or later. If you still have 0.4.5 or earlier, uninstall that once first: older builds
used a test key, and Android will not update across keys.

### Fixed

- **A held pickup survives the app going to the background (F418).** After a reconnect, the phone repairs the
  pickup's count instead of ending it on one bad read.
- **A stacked pickup fires every charge (F381).** A second Rockets pickup now raises the gun's magazine to the held
  count, so a stack of 4 fires 4. A stack never shrinks the count you already hold.
- **A short wait after the last rocket (F381).** The gun waits the normal weapon-swap time before the primary fires
  again, so a rocket and a primary shot no longer land back to back.
- **A pickup that did not reach the trigger is fixed (F436).** If the gun fires the primary while a pickup should be
  on the trigger, the phone switches it back to the pickup.
- **Faster first connect to the gun (F297).** When the gun misses the first connect, the phone retries after 200 ms
  instead of waiting up to several seconds.
- **The StickS3 powerup station claims at about arm's length (F434).** Its default range is now -45 dBm, so a
  player no longer claims from about 3 m.

### Works with the new Mission Control

- **Per-station powerup charges, overshield amount and respawn time** set in ARMORY need no phone change beyond
  this build.
