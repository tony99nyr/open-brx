## Open BRX phone app 0.4.18

This build installs over 0.4.6 or later. It includes 0.4.16 and 0.4.17 (neither published on their own), plus the
fixes and polish from 2026-10-02 to 2026-10-04.

### New

- **HILL CAPTURE STARTED.** When a team starts capturing a hill, everyone sees one neutral badge with that team's
  colour stripe. The holding team hears "Hill Contested" whenever its scoring stops because of the other team.
- **No game alerts while you are down.** HUD alert badges and cards that arrive while you are down are dropped.
  Voice lines still play after the death scream.
- **Poison sounds like poison.** A Toxin hit plays a bubbling acid sound, then a bubble on each tick, with no voice.

### Fixed

- **Pickups are steadier.** A pickup at the stack cap is no longer wasted. The Rockets show their ready shine.
  A pickup survives a reconnect and a self-hit revive.
- **Spawn checks are stricter (F416).** A reconnect is never mistaken for a lost spawn, and no spawn repair runs
  after the whistle.
- **King of the Hill presence is fairer.** A quiet phone leaves the circle as fast as a busy one, a short dip
  behind a body does not drop you, and a hill never narrows its own scan under load.
- **Stations stay with their Mission Control during play.**

### Carried from 0.4.16 and 0.4.17

See `app-v0.4.16.md` and `app-v0.4.17.md`.
