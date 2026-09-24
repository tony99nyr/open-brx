## Open BRX phone app 0.4.8

If you have 0.4.6 or 0.4.7, this build installs over it. If you still have 0.4.5 or earlier, uninstall that once first:
older builds used a test key, and Android will not update across keys.

### New in play

- **The shield meter.** Your shield is now a bar along the top edge of the HUD, in the style of Halo. It is
  blue when full, and turns red, with a red tint on the frame, when it is low or broken. An overshield shows
  as a lime layer on top by day. The bar has no words or numbers. Health stays in the bottom left, and a game
  without armour shows no armour number or bar (S59).

### Better connections

- **The headset joins before the gun counts as linked.** The phone now waits for the headset to join the gun
  before the gun link counts as up, instead of connecting in a loop. If the headset has not joined after
  60 s, the HUD says HEADSET NOT JOINED · POWER-CYCLE THE HEADSET (F293). The timing is provisional until the
  next bench test re-measures it.

### Older phones

- **An Update page instead of a blank app.** On an Android phone whose Android System WebView is older than
  version 111, the app now shows a page asking you to update WebView from the Play Store. Before, the app
  opened blank (F334).
- **iOS needs 16.2 or newer.**

### Not yet

- **Per-venue IR power (S48)**, the **close-range headset-damage setting (F275)** and **hearing your own
  team's hill capture (F312)** are still waiting on bench tests. They are not in this build.
- **Powerups** are still built but OFF by default, as in 0.4.7.
