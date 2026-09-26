## Open BRX phone app 0.4.14

This build installs over 0.4.6 or later. If you still have 0.4.5 or earlier, uninstall that once first: older builds
used a test key, and Android will not update across keys.

### Pickups (now on by default)

- **Powerups are on by default (F372).** The host starts Mission Control with `--no-powerups` to switch them off. The claim signal thresholds are still
  placeholders until the outdoor calibration walk.
- **A pickup weapon is no longer lost when you leave the app and come back mid-match (F418).** A held heavy weapon now
  ends only when you fire it empty, so a stray 0 from the gun no longer throws away your Rockets (F417).
- **The switch card sits on top for ALT and pickups (F400).** Kill cards, feed rows and badges wait underneath it and
  then get their full time. The card's labels are at the 11 px floor, and a pickup's ACTIVE tile reads CONFIRMED.
- **No pickup countdown any more (F425).** The HUD says "<ITEM> AVAILABLE · AT STATION N" when a pickup is ready, and
  never says that it was taken, or who took it.
- **The Overshield has its own magenta colour,** clear of the team colours.

### Fixed

- **A lost spawn write at go-live no longer kills you (F416).** The phone asks the gun, re-sends the spawn if it never
  landed, and books no death. If it cannot tell, the HUD says "GUN MAY NOT BE SPAWNED · HOST: FORCE RESPAWN".
  Station scanning pauses around spawns and pickup grants, so the radio is free for those writes.
- **After ALT, the ammo number, the reserve and the pips show the new weapon at once (F394).**
- **A phone released from station duty rejoins Mission Control as a player (F421).**
- **The ⓘ utility icon sits below the Android status bar and can be tapped (F420).**

### New on screen

- **The idle screen says MC JOINED or MC NOT JOINED after SET MY GUN (F422).**
- **In King of the Hill, the score board shows each team's hill hold time (F424).**
- **Team 3 is PURPLE, as the gun paints it (F423).**
- **New mode art** on the briefing, including King of the Hill.

### For testers

- **iOS:** the WebView debugging switch now has an iOS side (B21). It is untested until the first Mac build.
