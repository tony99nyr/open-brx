## Open BRX phone app 0.4.10

If you have 0.4.6 or later, this build installs over it. If you still have 0.4.5 or earlier, uninstall that once first:
older builds used a test key, and Android will not update across keys.

### Fixed

- **The shield meter after a stun.** If you were hit while stunned, the shield meter's slow refill bar could
  stay frozen at its old width. It now clears when the hit lands (S59).

### Powerups (still OFF by default)

Powerups stay off unless the host starts Mission Control with `./start.sh -- --powerups`. These fixes come from
the bench tests of the pickup (F331):

- **A steadier pickup signal.** At the edge of a station's range, the phone could restart its Bluetooth signal
  up to four times a second. Restarts are now at least 0.3 s apart, and a failed restart waits 1 s.
- **Walking away while stunned drops the claim.** A stunned player who left a station's range still claimed its
  item. The claim now holds only while you stay in range.
- **Mission Control hides the powerups strip when powerups are off.**

### For the host

- **Stations resist tampering during a match (A58).** Mission Control now locks each StickS3 station's own
  buttons from the lobby push until the match ends, so a player cannot reset or reassign it mid-game. If a
  station restarts during the match (the side button is not locked yet), Mission Control shows STATION #N
  RESTARTED, and it catches a restart even when the station was out of Wi-Fi. A connected station that goes
  quiet mid-match shows STATION #N OFFLINE. If the lobby runs so long that a station's lock would run out
  mid-match, LOBBY says so. ARMED and LIVE have a two-tap UNLOCK STATIONS. Phone stations are not locked.

### Not yet

- **Per-venue IR power (S48)**, the **close-range headset-damage setting (F275)** and **hearing your own
  team's hill capture (F312)** are still waiting on bench tests. They are not in this build.
