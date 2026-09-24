## Open BRX phone app 0.4.11

If you have 0.4.6 or later, this build installs over it. If you still have 0.4.5 or earlier, uninstall that once first:
older builds used a test key, and Android will not update across keys.

### Fixed

- **Each game is now scoped to itself (F339).** In 0.4.10, players and Bluetooth stations (respawn points and
  hills) already saw each other, but nothing tied them to one game, so two games at the same venue could hear each
  other's stations and players. Now every phone and every station Mission Control arms carries the game's own
  number, and each one ignores the other game. Update Mission Control too; with an older Mission Control the phone
  behaves as 0.4.10 did.

### For the host

- **King of the Hill defaults to a Bluetooth hill.** The stock King of the Hill game now uses a spare phone in the
  utility role as the hill, taken by standing on it. The BRX Smart Grenade hill is post-MVP: you can still pick it
  in the game designer (it is marked POST-MVP), and a game you saved with the grenade keeps it.
- **A hill station the game would ignore is named.** If you assign a hill (CONTROL) station while the game's
  objective source is the grenade or an IR station, every phone ignores the station. Mission Control now says so
  and tells you to set OBJECTIVE SOURCE to PHONE.
- **A restarted station keeps its count.** If a station restarts during a match, its hill time and respawn count
  in Mission Control no longer drop back to what it last saved.

### Not yet

- **Per-venue IR power (S48)**, the **close-range headset-damage setting (F275)** and **hearing your own
  team's hill capture (F312)** are still waiting on bench tests. They are not in this build.
- **StickS3 Bluetooth hills and respawn points** are built but not yet bench-tested over the air, and a Stick
  needs new firmware for them.
- **Powerups** are still built but OFF by default.
