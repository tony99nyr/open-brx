# Extraction (raid-and-extract) — the flagship mode design

The design of the Extraction mode, split out of `game-modes.md` on 2026-09-12 because it is a mode
*design* and that file is the infrastructure-tier *catalog*. The catalog entry, the tier it needs and
the props it needs stay there; everything below is the mechanic. The rules engine that implements it is
`mcp/brx_mcp/modes/extraction.py` (`python -m brx_mcp extraction-sim`).

The extraction-shooter genre (Escape from Tarkov, Hunt: Showdown, CoD DMZ, The Cycle, Marathon) is the
hottest shape in shooters right now, and **it maps beautifully onto laser tag** — the signature tension
is *"channel a loud extraction while exposed and everyone converges on you,"* which is exactly what this
hardware is good at. **Battle Company's Edge has nothing like it**, so this is a marquee differentiator.

**Genre core loop:** insert with your gear → **loot** valuables (risk/reward: push deeper for better
loot vs. leave now) → reach an **extraction point** and **summon/channel** it (a timer; it's **loud and
alerts everyone**) → **survive the channel** → if you extract you **keep/bank** the loot (points +
persistent boosts); **if you die you drop it all** (others can grab it). Loss-on-death is the whole
point — it's what gives every decision real stakes. (Sources below.)

## The shape Tony is picturing (2026-09-04): ARC Raiders + Fortnite's Sprite extraction

Two references sharpen the loop above into an **event ladder** (sources at the end of this section):

| beat | ARC Raiders | Fortnite: Runners / Sprites | our event |
|---|---|---|---|
| call the extract | one player activates the console; 60-90 s timer (elevator / metro), airshaft ~60 s, keyed hatch 15 s | interact with the site: a ~45 s "rifting the crate in" sequence | `extraction_called` (LOUD: "Black Hawk inbound") · others: `extraction_alert` |
| the window | leave the zone and the timer restarts; the whole squad in the zone extracts together | crate lands and stays ~70 s; drops to **10 s** once someone banks | `extraction_open` → `extraction_tick` → `extraction_closing` |
| success | out of the raid, loot kept; downed squadmates revive on extraction | Sprite banked permanently, Sprite Dust earned | `extraction_complete` (banked score + next-life boosts) |
| failure | die → lose everything except the safe pocket | die / leave → the Sprite is dropped for others | `extraction_failed`, `loot_dropped` |
| the hard end | 30-min raid, then an orbital strike kills everyone still out | match end | `raid_ending` ("Incoming air raid, find cover") → `raid_over` (bombardment kills everyone not extracted) |

**HUD-driven by design** (`docs/spec/contracts.md` A11.4): the extractor's own HUD owns its channel --
"in the zone" is the station's presence landing on its own phone, the timers are local, the wallet is local --
so every beat above except `extraction_alert` works with MC out of range. The alert to everyone else is MC
best-effort (or, at Tier 2, the field radio). The **hard end** is the node's own clock: at time-expiry any
player not extracted is killed by the bombardment and scores nothing.

*Refs:* [ARC Raiders extraction mechanics (brokenbuilds.gg)](https://brokenbuilds.gg/arc-raiders/guides/arc-raiders-extraction-mechanics-guide),
[all extract types (arcmaps.com)](https://arcmaps.com/arc-raiders-extraction-points),
[the 30-minute timer + meteor (PC Gamer)](https://www.pcgamer.com/games/third-person-shooter/arc-raiders-punishes-players-who-fail-to-extract-in-time-by-simply-dropping-a-meteor-on-their-heads-but-there-is-one-way-to-survive-the-blast/),
[Fortnite Extraction Sites (wiki)](https://fortnite.fandom.com/wiki/Extraction_Sites),
[Fortnite Runners: extract Sprites (Epic)](https://www.fortnite.com/news/extract-and-collect-sprites-on-a-new-map-in-fortnite-runners),
[Hunt: Showdown extraction (wiki)](https://huntshowdown.fandom.com/wiki/Extraction).

## The BRX mechanic (what maps to what)

| Genre element | BRX / Open BRX implementation |
|---|---|
| **Your carried loot** | The gun keeps no state, so the player's **node (Companion/phone) is the loot wallet.** Loot value accrues from kills, IR **loot boxes** (Jay's prototype — `reference/jay-ecosystem.md`), and objective pickups. Optional **physical loot** = a printed QR/RFID/IR "briefcase" token you actually carry — makes the drop-on-death moment tangible. |
| **Extraction point + "summon it, takes a while"** | The **KotH/hold primitive** with a channel: reach the extraction station (a utility phone, roadmap K2; or the grenade as the beacon), **initiate** (present + hold the trigger) → a **30–60 s channel timer** starts. |
| **"It's loud" (alerts everyone)** | On channel start, the station + nearby nodes fire an **audio + LED alarm** ("Extraction inbound at Alpha!"). *Local* loudness works at **any tier** (station/gun audio); **field-wide** "everyone hears it" needs the broadcast downlink (Tier 2). This is the genre's defining risk — and it also **counters extract-camping**, since attackers get the same callout. |
| **Survive the channel** | If the extracting player is killed or leaves the zone, the channel **pauses/resets** (host rule on `$HP,0` + presence). Channel completes → loot is **banked**. |
| **"If kicked you drop your loot"** | On `$HP,0`, the victim's node **transfers its wallet out** — either to a **dropped token** at the death spot (physical/beacon) or back to the **pool / to the killer** (virtual). Pure host-side rule on the death event — Tier 0 logic. |
| **Extracted loot → points or boosts** | Banked value converts to **score** (win condition) and/or **`$WEAP`/`$LIFE` boosts** on your next life/raid — a persistent **"stash"** across rounds (the genre's meta-progression). |

## Tiers — it scales from gear-you-own up to full field

- **Minimum ($0, gear you already own):** a **utility phone is the extraction beacon** (or the grenade's KotH
  charge, which already does summon + the "who holds it" callout), loot tracked by **phone nodes**,
  drop/bank/boost as host rules. A playable Extraction mode with **no custom hardware**.
- **Tier 1 (one station):** a purpose-built **extraction station** — cleaner channel, proper LED/alarm,
  multiple loot pickups. This is the sweet spot.
- **Tier 2 (full experience):** **multiple, optionally *hidden* extraction points** (Hunt's "Devil's Trail"
  hidden-extract idea), a **field-wide "extraction inbound" broadcast**, **dropped-loot beacons** you can hunt
  for, and a live **stash/scoreboard** — needs stations + the broadcast downlink.

## Variants

- **PvPvE (solo/small squad):** add "AI" pressure with **utility-box hostile emitters** (proximity mines /
  turret tags — `reference/jay-ecosystem.md`) so even a few players face environmental threat between fights.
- **Boss / bounty (Hunt-style):** a high-value **boss role** (a tanky player, General-style) or a heavily-defended
  station drops a **bounty token** that makes its carrier **loud/marked** — their node pulses a detectable
  beacon — until they extract. Classic "kill the holder, take the prize."
- **Storm timer (BR crossover):** a closing zone (reuse the Battle Royale storm) forces the push-vs-extract
  decision on a clock.

## What we actually have to build

Very little that's new: Extraction is **the King-of-the-Hill station + a loot wallet in the node + three
host rules** (channel-under-fire, drop-on-death, bank→boost). The rules engine is built and sim-proven
(`mcp/brx_mcp/modes/extraction.py`, `python -m brx_mcp extraction-sim`); the station (K2) and an MC loot scorer
are what remain (`utility-roadmap.md` §7).

*Genre research sources:* [What is an extraction shooter? (Antihero Studios)](https://antiherostudios.com/blog/what-is-an-extraction-shooter),
[Extraction shooter (Wikipedia)](https://en.wikipedia.org/wiki/Extraction_shooter),
[Why DMZ gets the formula right (The Loadout)](https://www.theloadout.com/call-of-duty-warzone-2/dmz-extraction-shooter-formula-right),
[Hunt: Showdown "Devil's Trail" (ixbt.games)](https://ixbt.games/en/news/2026/03/18/hunt-showdown-1896-prevratilas-v-escape-from-tarkov-nacalos-xardkornoe-sobytie-tropa-diavola.html).
