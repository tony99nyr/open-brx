# The Open BRX platform
Last verified: 2026-09-09

Open BRX is open-source software (MIT) for stock Battle Company BRX taggers. It ties the guns you
already own into one game system: game modes, live scoring and custom weapons. Stock firmware is
never modified, so everything goes over the tagger's documented Bluetooth serial protocol, and you
run the software yourself on your own laptop.

## What runs today

One part works on real hardware: `brx-mcp`, a Python package that is both a command-line tool and an
MCP server. It drives taggers over Bluetooth LE from whichever machine owns the radio (Windows,
macOS or Linux).

On 2026-08-25 a laptop ran a full scored Team Deathmatch on two real taggers: spawn, live hit and
death tracking, host-driven respawn, a frag limit, the correct winner, and the Bluetooth link held
for the whole match. A three-gun synced start is proven on hardware too.

Install it on the machine with the Bluetooth radio, then run a match:

```
pip install -e ./mcp
python -m brx_mcp play tdm <addr1> <addr2>
```

That is the command that ran the match above. With no guns to hand,
`python -m brx_mcp game-sim tdm` narrates one in your terminal.

`brx-mcp` also covers scan, identify and listen, per-tagger diagnostics (firmware, battery, health),
custom `$WEAP` weapons, sound packs over USB, and the ESP32 IR capture and emit rig.

## What runs, but is not finished

Mission Control (the laptop console that writes a game and adds up the results) and the BRX Combat
HUD (the phone app that holds the Bluetooth link to one gun) have run whole matches in the field: a
300 second free-for-all on 2026-08-30 with two iPhones and a MacBook host, and an outdoor Team
Deathmatch on 2026-09-01 with two Android phones. They work. They are not finished, and they change
week to week. Four things have never been run: a dispersed timed start with players out of range
before T-0, a store-and-forward recovery after real coverage loss, more than two phones, and a
20-minute soak.

Android debug builds exist for sideloading. They live on the
[releases page](https://github.com/tony99nyr/open-brx/releases), one release per version tagged
`app-v<version>`. That link goes to the list rather than to a particular file, so it keeps working as
new builds are cut. They are test builds, not releases, and a given build can be behind the current
game rules. Two things follow from "debug".
The build is **debuggable**: anything attached over USB debugging can inspect it and read its data.
That is fine on your own phone, and it is a reason not to hand the build to a stranger. It is also
signed with Android's throwaway debug key, so a future release-signed build **will not install over
it**: uninstall first.

## What does not exist yet

- BRX Companion: a small ESP32-S3 rider (~$15 in parts) that would take the phone's place on the
  gun. Specified, not built.
- Utility Box and objective stations: hill, flag, bomb site, extraction point, respawn. Design
  stage. Our ESP32 rig has put a synthetic IR shot into a stock tagger, so the emit side is real.
- Effect nodes: smoke, lights, DMX and music listening to the same event stream. No firmware is
  written.

## How it is wired

Three facts decide the shape of the whole system.

1. **The gun keeps no game state.** No clock, no score, no respawn timer, and it cannot report its
   own kills. A kill is only visible from the victim's side. So everything a game needs has to live
   off the gun.
2. **Bluetooth reaches about 1 to 30 m, and players spread out over 50 to 100 m.** So the Bluetooth
   link has to ride the player: one node per gun, carried by that player, holding the link all
   match.
3. **A laptop talks to those nodes over Wi-Fi, best effort.** It never holds a Bluetooth link to a
   gun during play. Events queue on a node while it is out of range and flush when it returns. In
   practice that means you always know you died straight away, but you may not learn you got a kill
   until you walk back into range. A scoreboard can be late. The final result is not wrong.

The limits that follow from this, measured on hardware except for the logical-teams row:

| Thing | Limit |
|---|---|
| Players in one game | 64 (the gun's player id runs 0-63; the app shows 1-64 and writes the id one lower) |
| Native hardware teams | 4 (the team field in each shot is 2 bits) |
| Teams beyond 4 | unlimited logical teams, scored by Mission Control's roster; no on-gun friendly-fire protection in that mode |
| Guns per node | exactly 1 |
| Guns on one laptop Bluetooth radio | 3 proven for a synced start; the maximum is untested |
