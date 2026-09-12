# One laptop. One phone per tagger.

The Open BRX platform is three pieces of software that run a laser tag match on stock Battle Company BRX taggers: Mission Control on a laptop, the BRX Companion on each player's phone, and brx-mcp underneath. Nothing is flashed to the tagger. Everything goes over the tagger's own Bluetooth serial protocol.

- [Get the app](/download/)
- [Read the docs](/docs/)

![Mission Control's readiness board beside the HUD on a phone](/shots/mc-armory.jpg)

## What is this?

### Software that keeps score and lets you write your own game types.

The BRX is a laser tag gun by [Battle Company](https://battlecompany.com/). On its own it plays the games built into its menu, and nobody keeps score for you. The Open BRX platform is free, open-source software that does: Mission Control on a laptop sets the rules and adds up the match, the BRX Companion on each player's phone shows health, ammo and the clock, and brx-mcp underneath talks to the tagger over Bluetooth. Custom modes, custom weapons, real scoring, stock hardware.

## Kit up

### Every tagger on one board before anyone walks out.

Mission Control scans the armory and shows each tagger's headset, battery and link. A tagger that cannot join a game says so here, in the room, not on the field.

- **Headset.** A tagger with its headset off silently refuses to enter a game. The board catches it first.
- **Battery.** Every pack's charge, read off the tagger, with the low ones in amber and red.
- **Link.** Which phone holds which tagger, and how long since it last spoke.

## Write the game

### Pick a mode. Set the rules. Save it under a name.

![Pick the game: stock modes and your saved games](/shots/mc-games.jpg)

Start from a stock mode. Change the score cap, the clock, respawn, health and armor, the venue and what each loadout slot may carry. Save it, and next time it is one tap.

## Arm and start

### Kit each player, then count everyone down together.

![Kit each player: taggers, teams and loadout policy](/shots/mc-kit.jpg) ![The lobby: who is kitted, who is ready](/shots/mc-lobby.jpg)

- **Kit.** Assign taggers and teams. Decide who may pick their own weapons and perks, and who gets what the host says.
- **Lobby.** Every phone reports kitted and ready. Nobody starts until the board is green.
- **Start.** One countdown, pushed to every phone. Weapons go hot on all of them at the same second.

## Play

### The phone runs the tagger. The laptop can go dark.

![Armed: the countdown on the phone](/shots/hud-armed.jpg) ![Taking fire: health falling, the hit called](/shots/hud-hit.jpg) ![Down: who got you, and the redeploy count](/shots/hud-down.jpg)

- **Weapons hot.** Health, armor, ammo and the clock, on the rail where you can see them.
- **Taking fire.** Every hit is called on the phone as the tagger reports it, with the damage it did.
- **Down.** Who got you and how long until you redeploy. The tagger stays silent until the count ends.

Each phone holds the Bluetooth link to its own tagger and runs the match from the bundle it already has. Players walk out of the laptop's range and nothing stops.

## Topology

### Three links. Only one has to hold.

Each phone holds a Bluetooth link to one tagger. Taggers hit each other by infrared, line of sight. Phones talk to Mission Control over the field Wi-Fi, and that is the link allowed to drop. The laptop holds no link to any tagger while the match runs.

- **Bluetooth rides the player.** One phone, one tagger, in the same pocket. The link never leaves range, so the match runs from the bundle the phone already holds.
- **The laptop goes dark on purpose.** Mission Control pushes the game, then talks to no tagger until the recap. Players scatter across a park and nothing stops.
- **Wi-Fi is allowed to drop.** Kills, deaths and objective time queue on the phone and flush the next time it reaches Mission Control. Results are never wrong, only late.
- **No signal at go.** The start is a clock time agreed in advance. Every phone counts itself down, so the first second of the match needs no network at all.
- **Backhaul for phones with data.** Turn the tunnel on in Mission Control and any phone with a data plan reaches it from wherever it has signal. Nothing to install or set up on the phone: the join code carries both addresses.
- **Full coverage unlocks more.** When every phone on the board is on backhaul, Mission Control knows it, and the score cap and last-one-standing ends become live across the whole park.

What the shape costs, stated plainly:

- **You always know you died. You may learn the kill later.** A kill is seen by the tagger that took it. The confirm reaches the shooter through Mission Control, so out of coverage it lands when both phones next have a path.
- **One phone, one tagger.** A dead phone takes its player out of the match. There is no spare link.
- **Backhaul needs the host online.** The tunnel needs internet at the laptop, and the phone needs a plan and a signal. A park with no cell service plays exactly as it does without it.
- **The board settles when everyone is home.** Kills live in the victims' reports, so the scoreboard is provisional until every phone has flushed.

## Recap

### Scores come home when the phones do.

Every phone keeps its own tally. As each one comes back into range, Mission Control collects kills, deaths and objective time, names the winner, and lets you export the sheet.

## brx-mcp

### The instrument underneath.

```
$ python -m brx_mcp scan
Tactix-XXXX   FE:AD:FD:XX:XX:XX   -58 dBm
$ python -m brx_mcp diagnose FE:AD:FD:XX:XX:XX
firmware v4.32 · battery 7.9 V · ping answered
```

A Python command line and an MCP server for the tagger itself. Scan, diagnose, write a custom weapon, load a sound pack, capture the IR word. It is also the protocol AI agents use to call tools, so an agent can run the bench with you.

## Get it

### Two downloads and a repository.

```data
release
```
