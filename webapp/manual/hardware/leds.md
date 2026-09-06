# Lights and what they mean
_The gun's LED bank and the headset's ring. Read them like a dashboard._
Last verified: 2026-09-06

There are two separate light systems. The **gun** has a small bank of LEDs on the rifle. The **headset** has a ring of bright green hit LEDs plus colour-changing RGB LEDs. Each one answers a different question.
Source: docs/experiment-log.md (2026-08-27)

Gun LEDs
| col 1 | col 2 | col 3 |
|---|---|---|
| Colour while in the menu | **The game mode you picked**: Free For All white · Death Match red · Generals yellow · Supremacy blue · Commander pink · Survival green · The Swarm orange | 📖 |
| Colour during a game | **Your team or faction colour** (on our bench, team 1 is blue and team 2 is yellow). The colour comes from your team. You cannot set any colour you like | ✅ |
| Colour palette available | 9 colours reported by the community: red · blue · yellow · green · purple · cyan · white · pink · orange | 👥 |
| Segments going out | **Your health bar**: the three LEDs work like a bar that drains as you take damage | ✅ |
| Manual's description | "LED indicator shows ammo & health" | 📖 |
| Slow blink in team colour | A game run from an outside app that has not switched the health bar on | ✅ |
Source: docs/reference/brx-extended-user-guide.md, protocol/session-findings-2026-08.md §7r (LEDs slow-blink team colour in an app-derived config), docs/experiment-log.md (LED life mode, 2026-08-27)

_[diagram HW-10: (gun LED gauge states, see Images table)]_

Headset LEDs
| col 1 | col 2 | col 3 |
|---|---|---|
| **Slow rainbow cycling** | **Not connected, not paired** to a tagger. You can spot it across a room, so check every headset before a game starts | ✅ |
| **Solid or pulsing team colour** (red, blue…) | Paired and synced to the tagger. You see this **before the game only** | ✅ |
| **Dark** | **This is normal in play.** The band goes dark once the game starts, and dark is not a fault | ✅ |
| **One green flash** | A hit registered on this headset. The flash fires on its own, with no command from a phone or host | ✅ |
| **Sustained bright green blink** | This player is out (dead). It stops at respawn | ✅ |
| **Green flash in Target Mode** | A direct hit on the sighting target | 📖 |
| **Bright green burst** (4 directions) | The 3 W hit LEDs. They are built to show up in daylight, and indoor mode dims them | 📖 |
Source: docs/experiment-log/2026-09.md (2026-09-02, the native headset state model: blank the headset, shoot it, one green flash from dark; out = sustained blink), docs/experiment-log/2026-08.md (2026-08-27), docs/field-process.md, docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

## We got this wrong twice in our own notes.
One green flash means a hit landed on this headset. A sustained green blink means the wearer is out. Team colour shows *only before* the game starts. Earlier readings said "green = dead" and then "holds green = kill feedback"; the sustained blink is the out state, and it is the firmware's own, not a host command.
Source: docs/experiment-log/2026-09.md (2026-09-02)

The headset LEDs work **on their own**. You get them in stock games and in games hosted by an outside app alike. Nothing needs to be set up first.
Source: docs/experiment-log.md

## For modders: what the headset LEDs are
- The addressable RGB LEDs are **WS2812B 5050** (NeoPixel-compatible). On the BRX headset they are wired as a **series** string (parallel on the SwapTX variant). One data line, 5 V and ground. 👥
- Indoor mode dims the green hit LEDs and switches the RGB LEDs on. 📖
Source: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md

_[image HW-04: (headset LED states strip, see Images table)]_
