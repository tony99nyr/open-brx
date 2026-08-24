# What can we build — by investment

Starting inventory: **4 BRX taggers (+ headsets), 2 Smart Grenades, a laptop/phone you already
own.** No mods, no builds, no purchases. Then each rung up the ladder adds capability. "Built" =
works in `brx-mcp` today; "to build" = software we write (no purchase); "untested" = needs a
hardware check first.

> **Tier note:** these are **spend tiers** (what each budget adds). Distinct from `game-modes.md`'s
> **infrastructure tiers** (MC-alone / +props / +broadcast) — that doc classifies *modes*, this one
> classifies *spend*.

## Tier 0 — $0: exactly what you own (4 BRX + 2 grenades + laptop)

Everything here needs **only a laptop in BLE range** (one radio reaches ~7–10 taggers, so 4 is easy)
— i.e. a room, yard, or small field where players stay near the laptop. This is the **pilot**.

**Works today** (`brx-mcp` CLI, proven on hardware):
- Configure + start a game, spawn, live **hit/death tracking**, **host-driven respawn**, 2-tagger
  **arena with teams + synchronized start** (`arena`/`deathmatch`).
- **Custom weapons** — push `$WEAP` loadouts (damage, rate of fire, mag, reload type, per-fire
  sounds); the token map is decoded.
- **Diagnostics** — `diagnose`/`fleet`: firmware, battery, per-tagger health.
- **Custom on-tagger sound packs** — swap the `AUDIO` folder over USB (hold SELECT at boot); e.g. a
  Star Wars pack. Free (just a USB cable).

**We build (software only, runs on your laptop) → the real pilot:**
- The **game engine + a Mission Control UI + mode rule modules**, turning the CLI into a polished
  4-player system. Unlocks, in BLE range: **Team Deathmatch, Free For All, Survival/Infection, Last
  Man Standing, Generals / Commander / The Swarm** (respawn-character modes), plus a **live laptop
  scoreboard / kill-feed**.

**Your 2 grenades already do objective modes — the problem is config, not capability:**
- The grenade **reportedly supports Assault, Capture the Flag, and King of the Hill** (community-
  reported; the objective-mode↔`$GREN` mapping is unverified by us — followups F/G) — and it's
  **super hard to configure** from the on-gun menu.
- **Highest-value free build → a grenade config + state app** (phone/web, uses owned gear only):
  - **Config:** a clean UI that sends the `$GREN` setup over BLE (pick Assault/CTF/KotH, channel,
    options) — replaces the painful on-gun menu, making the grenade's existing modes actually usable.
  - **State display:** read objective events from the **gun's BLE stream** (the gun knows the state —
    it plays CTF flag music) and show a live "who holds the flag / point / KotH timer" screen.
  - With **2 grenades = 2 flags / 2 hills / 2 objectives**, this gets you Assault + CTF + KotH for
    **$0**, no stations. (Untested — followups F/G; free to work out the exact `$GREN` per mode and
    what state the gun reports.)
- Also props-free: **Counter-Strike** with a grenade as the **bomb**, and **gas/Molotov/confusion
  hazard zones**.

**Tier-0 limit:** players must stay in the laptop's BLE range. No field roaming, no live scoreboard
away from the laptop, per-player FFA scoring is approximate until per-player id (P2) is set.

## Tier 1 — old Android phones as player nodes (~$0 if you have them, else ~$30–50 used each)

The **biggest capability jump for the least money.** A Web-Bluetooth PWA on each player's phone
becomes their game engine + HUD → **breaks the BLE-range limit** (the link rides the player).
- Unlocks: **full-field roaming** for every Tier-0 mode, a **per-player HUD** ("your score/ammo/
  lives" — the #1 thing players ask for), offline play with results syncing at HQ WiFi.
- Gated on a **free 10-min test**: does Android Chrome hold a BRX BLE link? (followup, no purchase).
- iOS can't do the **web** path (no Safari Web Bluetooth) — use Android for zero-install, a wrapper
  browser (Bluefy/beacio), or a **native/hybrid iOS app** (full BLE via CoreBluetooth). The app is
  **still Tier 0/1** — software on phones you own, no hardware spend (only an optional $99/yr Apple
  account for App Store distribution). See `phone-app-spec.md` §"Common core, platform shells".

## Tier 2 — ESP32 "Companion" per tagger (~$8–25 each)

Purpose-built player node (rugged, no phone, louder): `hardware/brx-companion-spec.md`.
- **$8 "Brain":** offline engine + Wi-Fi sync + **powerups** (extra life, faster fire, damage boost,
  shields — all via decoded `$LIFE`/`$WEAP`/`$AMMO`).
- **+$5 audio:** unlimited custom sounds (DFPlayer + speaker).
- **+$8–12 HUD:** on-gun health/ammo/lives screen + team LEDs.
- Also brings **WiFi/ESPNOW natively** (transport for the field).

## Tier 3 — objective stations (~$10–15 each: ESP32 + IR receiver + LED ring)

Unlocks the **objective modes that need fixed contested points** — one primitive, many modes:
**Domination (multi-point + live scoreboard), King of the Hill, standard / assault / center-flag
CTF, Assault**, and **respawn stations** (which also double as **data-mule sync points**).
- Note: grenades already cover *single-objective* CTF/CS/hazard for $0 — stations are for
  **multi-point + live ownership/scoring + respawn**, which grenades can't do.
- **QR codes (paper, ~$0)** are the zero-cost prop for weapon pickups + capturable flags, if the
  gun's QR path works.
- **Proven reference designs (`reference/jay-ecosystem.md`):** Jay's **JBOX Mini** *is* this node —
  ESP32 + IR receiver + IR emitter + 1 RGB LED + resistors, USB-powered, configured entirely from a
  phone browser (its own WiFi AP at `192.168.4.1`). His **JHALO** turns **a spare headset + ESP32**
  into a respawn station — reuse gear you already own. Both run Domination (1 pt/s), KotH (hold 45 s),
  CTF, and utility/perk effects on real BRX hardware today.

## Tier 4 — field radio (LoRa RYLR ~$10/node, or FREE via the gun's nRF if usable)

Unlocks **live coordination on a large no-WiFi park**: the **"flag taken!" broadcast**, a **live HQ
scoreboard**, station **status screens**, and **Battle Royale** (needs broadcast + per-node location).
- The gun's built-in **nRF** (`NRFhost`/`NRFslave`) *might* provide this for free — unprobed
  (followup D1), highest upside.

## Environmental effects (smoke, music, lighting) — a subscriber layer

This is the Battle Company **Edge**-style venue immersion (props, lighting, sound). It's an
**"everything is a subscriber" layer** (architecture prime directive #4): the game engine emits
events (spawn, kill, death, respawn, clock, capture), and effect nodes **react**. The **brain is free
at Tier 0** — the engine already knows every event — so effects are gated by owning the *devices* +
cheap controllers, **not** by the player-node tier. Effects live at the venue near power, so they fit
an indoor/set-piece arena perfectly (Tier-0's "stay near the laptop" limit is a non-issue — the
effects are near the laptop too).

| Effect | Trigger | Controller | ~Cost |
|---|---|---|---|
| **Music during the game** | engine plays a playlist while the match runs | laptop audio → your speakers | ~free |
| **Stingers on events** (kill streak, capture, last-10-sec, game over) | engine fires a clip on the event | same speakers (priority queue: game-state > kills > flavor) | ~free |
| **Respawn → flash a light** | engine catches the respawn event | WiFi smart plug (Kasa/Tasmota) or ESP32+relay | ~$8–12 |
| **Last 10 sec → lighting** (red pulse) | engine watches the clock | WLED strip or smart plug | ~$8–25 |
| **Smoke every 10 min** | engine timer (fits the machine's warm-up/duty cycle) | ESP32 + relay on the machine's remote jack | ~$8 + machine |
| **Proximity-tripped smoke** | PIR/IR at the machine, or a game event | + PIR (~$2) or a co-located objective station | +$2–15 |
| **Team-color / chase lighting, blacklights** | WLED reacts to MQTT events (native WLED-MQTT) | WLED ESP32 + addressable strip | ~$15–25/zone |

**This is exactly Battle Company EDGE's model** (`reference/edge-brp.md`): EDGE drives smoke/lights/
DMX/speakers/props through its **Utility Box + "Animatronics"** feature, tied to game events. Their
UBox is *one hardware unit reconfigured in software into 20+ roles* — which validates our
single-effect-node/station-primitive design. We match it by shipping effect nodes with relay + DMX
out; we can differentiate with **native open DMX/scripting** (theirs is closed) and **no
per-location subscription** (theirs is $600–1,600/yr).

**Cheapest immersion (Tier 0–1):** laptop → speakers for **music + event stingers is ~free today**;
add one ~$8 relay/smart-plug per device (smoke, blacklights) and the engine drives them live. As you
grow, effects are just more MQTT subscribers (WLED zones, DMX stage lighting via a DMX interface,
sirens, servos). **On a large field**, a remote effect (e.g. proximity smoke at an objective) is a
**station+relay co-located there**, self-triggered on the local event over the field mesh — no
central needed. This matches what Edge does; our engine emits the same events, so parity is a matter
of adding subscriber nodes.

| Tier | Spend | Unlocks |
|---|---|---|
| **0** | **$0 (own gear + laptop)** | TDM/FFA/Infection/LMS/Generals-Commander-Swarm in BLE range; custom weapons + sounds; laptop scoreboard; diagnostics; grenade CTF/CS/hazard (untested) |
| **1** | old Android phones | breaks range → full-field roaming + per-player HUD |
| **2** | ESP32 Companion ($8–25/tagger) | powerups, custom audio, rugged node, WiFi/ESPNOW |
| **3** | stations ($10–15 each) / QR (paper) | Domination, KotH, CTF variants, Assault, respawn stations |
| **4** | LoRa ($10/node) / nRF (maybe free) | large-park live play, broadcasts, status screens, Battle Royale |

**Cheapest high-value path:** build the **Tier-0 software** (engine + Mission Control) on your
laptop, test **grenade CTF/CS** for free, and check the **Android-BLE gate** — that alone gets you
orchestrated, custom, multi-mode games for your 4 taggers + 2 grenades with **no hardware spend**.
Every rung after is optional and additive.

**What each rung actually unlocks per mode — and the hard limits vs. pending tests at each tier — is
in [mode-limits.md](mode-limits.md).**
