## Open BRX phone app 0.4.15

This build installs over 0.4.6 or later. If you still have 0.4.5 or earlier, uninstall that once first: older builds
used a test key, and Android will not update across keys.

### Fixed

- **A kill on a RED player now confirms with the right team.** Red is team 0 and now the default in every game, and
  the phone used to treat team 0 as "unknown" when it paired a kill confirm, so a red victim's confirm could pair
  with any team's.
- **The phone hill uses the same default range as the Stick and Mission Control: -75 dBm (F383).** The outdoor walk
  will set the final value.

### Works with the new Mission Control

- **Mission Control's new GAMES screen (PLAY and BUILD), teams and the King of the Hill hold target** need no
  phone change beyond this build: the phone reads the new game briefing, team names and weapon types from Mission
  Control.

### For testers

- **The Android splash** setup now also upgrades an older checkout (build scripts only; nothing changes on screen).
