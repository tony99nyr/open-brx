## Open BRX phone app 0.4.19

This build installs over 0.4.6 or later. It holds the fixes and polish from 2026-10-04 to 2026-10-05.

### Changed

- **A half-taken hill drains back.** When nobody is on a neutral hill, its capture bar starts to empty after half a
  second and empties fully in ten seconds. A player who brushes the edge of the circle can no longer creep a hill
  into their team's hands. A player standing on the hill keeps their progress, and an owned hill never drains.
- **The hill sounds always play.** The five hill sounds tell players what the hill is doing, so a sound setting no
  longer silences them. "Hill Captured" now plays in every game.

### Fixed

- **Scores survive a phone whose clock jumps.** If a phone's clock jumps after it has synced with Mission Control,
  Mission Control now scores that phone's kills and pickups at the time they arrive. Before, a kill could be dated
  after the whistle and lost, or a pickup could name the wrong spawn. Mission Control also asks the phone to re-sync.
  A phone whose clock jumped while it was offline catches up as soon as it reconnects. The host's feed shows the
  corrected times too.
- **Pickups are counted once, and never lost.**
  - A pickup names the item it took by the station's own countdown, so a late or replayed pickup no longer takes the
    next item.
  - An item the host restores before the first spawn can be picked up.
  - When a station and a phone disagree about who took an item, the station wins.
  - A phone that has left the match no longer takes a powerup or scores hill time.
- **Restarts and the recap keep the game straight.**
  - A Mission Control restart keeps kill credit, the King of the Hill target and who holds each phone.
  - A picked game that clears the hill target clears it for real.
  - The recap's connection dots follow the phone each player holds now.
- **A stun or poison survives an app restart.** The phone saves the time left on a stun or a poison and carries on
  from there after a restart.
- **The gun picker holds still.** It no longer resets itself a second after the app opens, so your first tap always
  lands.
- **Your tagger fires again after a quick respawn.** It fires straight away and no longer stays locked for the whole life, even if the link drops. Spawn protection counts from the moment your
  tagger is re-armed, so at a respawn station you get all of it.

### Carried from 0.4.18

See `app-v0.4.18.md`.
