## Open BRX phone app 0.4.13

This build installs over 0.4.6 or later. If you still have 0.4.5 or earlier, uninstall that once first: older builds
used a test key, and Android will not update across keys.

### Pickups (still off by default)

- **A pickup weapon now shows the full weapon-switch screen, the same as ALT (F400).** It shows when the weapon lands on
  the trigger, on every SELECT between it and your own weapon, and when its charges run out. The card carries the
  item's colour and its charges. The Overshield shows no card: the shield bar fills and the shield recharge sound plays.
- **Picking up the same weapon again adds its charges, up to double the station's drop (F381).** Rockets hold at most 4.
- **The briefing names the game's pickups before it starts (F403),** each in its own colour.
- **A pickup claim waits up to 15 s for the station and says CONFIRMING meanwhile (F380),** instead of reporting
  STATION NOT ANSWERING after 3 s.
- **ALT stays in step with the gun after a pickup (F379).** The phone tracks the gun's own ALT position apart from the
  weapon on the trigger, so ALT no longer names the wrong weapon after a rocket shot.
- **The powerup timer keeps its place after a spawn (F396).**

### Fixed

- **A hill taken from the other team now plays its capture sound and HUD event (F384),** and the HILL CAPTURED card
  clears after a few seconds (F385).
- **The hill tick stops while the hill is contested, and plays every 3 s while held and 1.5 s while losing (F382).**
- **Poison's tick sound waits for a quiet gun (F393);** the damage itself is unchanged.
- **The launch splash no longer looks stretched (F395).**

### For the host

- **The phone's utility drawer offers only the MVP station kinds: respawn, pickup and hill (F405).**

### Not yet

- **Powerups (F372)** are still off by default; they turn on once the full powerup bench sitting passes.
- **iOS** has no distribution build yet, and the WebView debugging switch is Android only (B21).
