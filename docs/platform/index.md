# The BRX, unlocked.

Open source software that turns stock Battle Company BRX taggers into a hosted game system. A laptop writes the match. A phone rides each tagger. No subscription, no venue Wi-Fi during play, and the taggers stay exactly as they shipped.

- [Get the app](/download/)
- [Read the BRX manual](/manual/)

![A BRX tagger with a phone mounted on the rail, headset beside it](/photos/hero.jpg)

```data
counts
```

## Mission Control

### Write the game. Muster the taggers. Start. Recap.

Mission Control runs on the laptop. It sees every tagger's headset, battery and link before anyone walks out, holds your saved games, arms the phones and counts down the start. Then it steps back. Each phone runs its own tagger, so the laptop can be out of range and the match keeps going.

![Mission Control readiness board: eight taggers with headset, battery and link state for each](/shots/mc-armory.jpg)

- **Readiness board.** A headset that is off, a battery that is low or a phone that is missing shows up before the match, not during it.
- **Pick or write the game.** Start from a stock mode. Set the rules, the venue and who carries what. Save it under a name.
- **The match, added up.** Scores, kills and the winner, collected from every phone as it comes back into range. Export the sheet.

![Pick the game: stock modes and saved games](/shots/mc-games.jpg) ![Kit: assign taggers, teams and loadout policy](/shots/mc-kit.jpg)

## The HUD

### Your phone, on the tagger.

The Companion app holds the Bluetooth link to one tagger and shows what the tagger cannot: health and armor, ammo and reserve, the clock, the weapon in hand, who is on the net. It picks the loadout, calls the hits, and tells you when you redeploy.

![Live HUD: health, rounds, the match clock, weapons hot](/shots/hud-live.jpg)

![Loadout picker: browse the arsenal and try a weapon on the real tagger](/shots/hud-loadout.jpg) ![Down screen: who got you and the redeploy count](/shots/hud-down.jpg)

- **Loadout.** Primary, secondary and a perk. Browse the arsenal, read the numbers, and fire a try-out on the real tagger before you commit.
- **Down.** Who got you and how long until you redeploy. The headset goes dark and the tagger stays silent until the count ends.

## Game modes

### Six modes. Every rule yours.

Play the defaults or change the cap, the clock, respawn, health, armor and what each slot may carry. Save it. Modes are Python, and new ones are welcome.

```data
modes
```

## Arsenal

### Twenty-two weapons. Three slots.

A primary, a secondary and a perk. Sidearms that swap fast. Every weapon is written to the tagger as its own definition: fire mode, rate of fire, damage, magazine, reload and swap delay, so a shotgun, a bolt rifle and a charge rifle feel like different taggers on the same tagger.

```data
roles
```

![Kitted: an assault rifle in the primary slot, secondary and perk plates open](/shots/hud-kitted.jpg)

## brx-mcp

### Talk to your tagger.

brx-mcp is the instrument underneath everything. A Python command line and an MCP server that drive a BRX over Bluetooth from Windows, macOS or Linux. Scan, identify, listen. Read firmware, battery and health. Write custom weapons. Load sound packs over USB. Capture and replay the IR word with the ESP32 rig.

```
# find every tagger in range, then read one
$ python -m brx_mcp scan
Tactix-XXXX   FE:AD:FD:XX:XX:XX   -58 dBm
Tactix-XXXX   FE:AD:FD:XX:XX:XX   -71 dBm
$ python -m brx_mcp diagnose FE:AD:FD:XX:XX:XX
firmware v4.32 · battery 7.9 V · ping answered

# or let an agent drive the bench over MCP
> scan for taggers and read every battery
tools: scan · connect · send · wait_for · diagnostics · panic
```

brx-mcp also speaks MCP, the protocol AI agents use to call tools. So an agent can run the bench with you: find the taggers, read the batteries, fire a test shot and read what came back.

## Objectives

### A grenade is a control point.

![A BRX smart grenade in hill mode, lit](/photos/grenade.jpg)

Set a BRX smart grenade to hill mode and it becomes a king-of-the-hill objective. The taggers already see its beacon, so possession is read off the player's own tagger. No base, no extra hardware, no firmware change. The same idea gives you respawn points: a spare phone works as one today, and a pocket station follows the same beacon design.

## The BRX manual

### Everything known about the BRX. One place.

Hardware, operation, gameplay, sound, repairs and the full developer protocol, gathered from Battle Company's documents, the community and the bench, and written once. Searchable, including by command.

```data
manual
```

- [Open the manual](/manual/)

## Open source

### Open source. Stock firmware. Yours to run.

- **MIT licensed.** Run it yourself, change it, ship your own modes and sound packs.
- **Nothing flashed.** Everything goes over the tagger's Bluetooth serial protocol. Your taggers still work with everything else.
- **Field ready.** Start on a laptop hotspot. Players walk out of range and the game keeps running on the phones.
- **Credit.** Protocol discovery: LaserTagMods (JEDGE / JBOX). Open BRX is independent and not endorsed by Battle Company.

## Get it

### Two downloads and a repository.

```data
release
```
