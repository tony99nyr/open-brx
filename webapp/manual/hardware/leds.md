# Lights and what they mean
_The gun's LED bank and the headset's ring — read them like a dashboard._
Last verified: 2026-08-27

Two separate LED systems: the **gun** LEDs (a small bank on the rifle) and the **headset** LEDs (a ring of bright green hit LEDs plus addressable RGB). They answer different questions.
Source: docs/experiment-log.md (2026-08-27)

Gun LEDs
| col 1 | col 2 | col 3 |
|---|---|---|
| Colour while in the menu | **Selected game mode**: Free For All white · Death Match red · Generals yellow · Supremacy blue · Commander pink · Survival green · The Swarm orange | 📖 |
| Colour during a game | **Your team / faction colour** (e.g. team 1 blue, team 2 yellow on our bench) — colour is team-derived, not a free-form RGB | ✅ |
| Colour palette available | 9 colours reported by the community: red · blue · yellow · green · purple · cyan · white · pink · orange | 👥 |
| Segments going out | **A life gauge**: the three LEDs act as a segmented bar that drains as you take damage | ✅ |
| Manual's description | "LED indicator shows ammo & health" | 📖 |
| Slow blink in team colour | An externally-hosted game that has not switched on the life gauge | ✅ |
Source: docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7r (LEDs slow-blink team colour in an app-derived config), docs/experiment-log.md (LED life mode, 2026-08-27)

_[diagram HW-10: (gun LED gauge states — see Images table)]_

Headset LEDs
| col 1 | col 2 | col 3 |
|---|---|---|
| **Slow rainbow cycling** | **Disconnected / not paired** to a tagger. Visible across a room — check every headset before a game starts | ✅ |
| **Solid / pulsing team colour** (red, blue…) | Paired and synced to the tagger — **pre-game only** | ✅ |
| **Dark** | **Normal during play.** The band goes dark once the game starts; dark is not a fault | ✅ |
| **Green blink** | Hit feedback | ✅ |
| **Holds green** | Kill feedback | ✅ |
| **Green flash in Target Mode** | A direct hit on the sighting target | 📖 |
| **Bright green burst** (4 directions) | The 3 W hit LEDs — meant to be visible in daylight; dimmed in indoor mode | 📖 |
Source: docs/experiment-log.md (2026-08-27, "the HEADSET LED is autonomous"), docs/field-process.md, docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

## An earlier version of our own notes had this wrong.
Green is *hit/kill feedback*, not a death signal, and team colour shows *only before* the game starts. If you read "green = dead" elsewhere, it came from the older reading.
Source: docs/experiment-log.md (2026-08-27 correction)

The headset LEDs are **autonomous** — they do this on their own, in stock games and in externally-hosted ones alike. Nothing needs to be configured to get them.
Source: docs/experiment-log.md

## For modders: what the headset LEDs are
- The addressable RGB LEDs are **WS2812B 5050** (NeoPixel-compatible), wired as a **series** string on the BRX headset (parallel on the SwapTX variant). One data line, 5 V and ground. 👥
- Indoor mode dims the green hit LEDs and enables the RGB LEDs. 📖
Source: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md

_[image HW-04: (headset LED states strip — see Images table)]_
