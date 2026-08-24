# BRX Companion — per-tagger accessory module (hardware spec)

**Status:** proposal, 2026-08-24. This is the full hardware realization of the `firmware/bridge/`
node in `docs/brx-architecture-v0.2.md`, informed by everything the protocol teardown proved.
Working name **BRX Companion** (aka "the rider" — the tagger-rider ESP32 concept is credited to
LaserTagMods; this is a fresh design). Design goal: **the one cheap accessory every BRX modder
wants** — clips on, never touches stock firmware, and turns a dumb tagger into a fully
autonomous, customizable, networked game unit.

## Why it has to exist (what the teardown proved)

Four hard facts from `docs/experiment-log.md` drive every design decision:

1. **The gun keeps no game state** — no clock, score, lives, or self-respawn (experiment #13/17/18).
   Something on the player must be the game engine.
2. **BLE cannot reach a moving player from a courtside laptop** (#12/19) — the link must be
   *on the player*, ~1 cm away, where it is rock-solid.
3. **The gun's sound bank is fixed** — no SD, no upload command. Custom audio needs off-gun hardware.
4. **Every game action is now a known BLE command** — `$SPAWN`, `$LIFE`, `$WEAP`, `$AMMO`, `$BUMP`,
   `$BHIT` (see `protocol/callsign-extract/protocol-classes.md`). Powerups are just command sequences.

The official system solves #1/#2 by making every player carry a phone. The Companion **is that
phone**, purpose-built, cheaper, open, and without the AWS cloud dependency.

## Platform: ESP32-S3

One chip covers every requirement:

- **BLE 5 central** → holds the tagger's NUS link (the control channel).
- **Wi-Fi** → syncs to the lobby/server; coexists with BLE via 2.4 GHz time-slicing (fine for our
  low bandwidth: bursty commands + periodic sync).
- **Dual-core 240 MHz + PSRAM option** → game engine on one core, audio/Wi-Fi on the other.
- **I2S** (audio out), **SDMMC/SPI** (SD card), plenty of GPIO (LEDs, buttons, HUD).
- **~$3 module / ~$6–8 dev board.** Cheap enough to put one on every tagger.

## The seven firmware roles

| Role | What it does | Uses |
|---|---|---|
| **BLE central** | connect tagger NUS, send commands, receive `$HIR`/`$HP`/`$BUT`/`$VOLTS` | protocol §1 |
| **Game engine** | lives, score, respawn timer, game clock, powerup state — **runs fully offline** | fact #1 |
| **Powerup executor** | translates rules → command sequences (below) | decoded §3 commands |
| **Store-and-forward** | timestamped event log to flash; replays to server on reconnect | architecture §"prime directive 2" |
| **Wi-Fi/MQTT client** | live feed + final sync to lobby; best-effort, never blocking | topic tree §3 |
| **Audio engine** | SD → I2S amp → speaker, priority queue (game-state > kill > flavor) | fact #3 |
| **HUD / status** | health/ammo/lives/respawn countdown + team color + hit flash | replaces phone HUD |

## Powerups — concrete, using decoded commands

Each is a small command sequence the Companion sends over BLE. This is the payoff of the teardown:

| Powerup | Mechanism |
|---|---|
| **Extra life / auto-respawn** | on `$HP,0` → wait respawn timer → `$SPAWN,,*` + `$AMMO` reload |
| **Faster rate of fire** | re-push `$WEAP` for the active slot with a lower fire-delay token (WEAP tok ~15) |
| **Damage boost** | re-push `$WEAP` with higher `primaryDamage` (WEAP tok 5) |
| **Overshield / heal** | `$LIFE,addedHP,addedArmor,addedShields,*` or `$BUMP` current pools |
| **Infinite / refilled ammo** | `$AMMO,<slot>,<clip>,<reserve>,1,*` on demand |
| **Loadout swap** | push a different `$WEAP` into a slot mid-game |
| **Handicap / juggernaut** | per-player `$PSET` max HP/shields at spawn |
| **Custom hit effects** | `$BHIT`/`$MELEE`/`$VIB` + a custom SD sound |

Because the gun holds no rules, **any powerup that is expressible as "change the weapon/health/ammo
and play a sound" works today** — no firmware mod, no waiting on Battle Company.

## Audio — getting loud in a small package

The concern is real: the tagger's built-in speaker is deliberately loud. To match it:

- **Amp: MAX98357A** — I2S Class-D, ~10×15 mm, digital in (no separate DAC), ~$1.50. **Power it from
  the 5 V/VBAT rail, not the 3.3 V logic rail** — its 3.2 W-into-4 Ω rating needs ~5 V; at 3.3 V it
  delivers roughly half the power (~3 dB quieter). So the boost/battery rail feeds the amp, the
  regulator feeds the ESP32.
- **Driver: a high-sensitivity 4 Ω 3–4 W** full-range (pick ≥90 dB/1 W/1 m). In a small **3D-printed
  ported enclosure**, driven from the 5 V rail, this reaches ~95–100 dB at arm's length — comparable
  to the tagger. (At 3.3 V, expect ~3 dB less.)
- **The cheat code for outdoors:** add a **piezo horn tweeter** (tiny, extremely loud, pennies) for
  piercing alert SFX (spawn, powerup, low-health) that cut through open air; use the full-range for
  voice/flavor.
- **Storage:** microSD holds WAV (zero-CPU) or MP3 (S3 decodes in software). Unlimited custom sound.
- **Priority queue + throttle** so game-state audio interrupts flavor, matching the announcer design.
- Louder still (rare): swap MAX98357A for an 8–10 W class-D (e.g. a TAS-series) + bigger driver +
  more battery. Not needed for most.

## Power

- **1000–2000 mAh LiPo + TP4056 charger + 3.3 V regulator** (ESP32) **+ a small boost to 5 V** for
  the audio amp rail, ~$4–5. Many hours of play. (A USB power bank, as the community's JEDGE mount
  uses, already provides regulated 5 V — feed the amp from it directly and regulate 3.3 V for logic.)
- Companion carries its **own** battery — no wires into the tagger (keeps stock hardware untouched,
  the prime directive). USB-C for charge + flashing.

## Mounting

- **3D-printed clip** to the tagger's accessory rail or body; publish STLs in `hardware/`.
- **Zero physical connection to the tagger** — the only link is BLE. Power-cycling either device is
  always safe.

## Build tiers (start cheap, grow) — the modder adoption path

| Tier | Adds | ~BOM | What you get |
|---|---|---|---|
| **T0 — Brain** | ESP32-S3 + LiPo + mount | **$8–12** | BLE link, offline game engine, powerups, Wi-Fi sync, store-and-forward. Replaces the phone; solves range + state + powerups. |
| **T1 — +Audio** | MAX98357A + speaker (+ piezo horn) + microSD | **+$5–7** | unlimited custom sounds |
| **T2 — +HUD** | SSD1306 OLED or ST7789 TFT + WS2812 LEDs + bigger LiPo + printed shell | **+$8–12** | health/ammo/lives/respawn HUD, team color, hit flash |

A modder can start at **~$10** and end at a **~$28** full unit — all the same firmware, features
toggled by what's populated.

## Full BOM (Tier 2, per tagger)

| Part | ~$ |
|---|---|
| ESP32-S3 module/dev board | 6 |
| MAX98357A I2S amp | 1.5 |
| 4 Ω 3 W speaker + piezo horn | 3 |
| microSD card (custom sounds) | 3 |
| SSD1306 / ST7789 display | 3 |
| WS2812 LED strip (short) | 1 |
| 2000 mAh LiPo + TP4056 | 4 |
| Buttons / misc / wiring | 1.5 |
| 3D-printed enclosure + mount | 2 |
| **Total** | **~$25** |

## What this unlocks for the platform

- **Real field play** — respawn, clock, and score survive out of BLE range (T0 fixes the #12/19 wall).
- **Custom everything** — sounds, weapons, powerups, game modes, all host/Companion-side, no gun mods.
- **Scales to 20+** — each player is autonomous; the server aggregates over Wi-Fi/MQTT, never holding
  20 direct BLE links.
- **Reuses the whole stack** — same `brx-mcp` command layer, same MQTT topic tree, same decoded
  protocol. The Companion firmware lives in `firmware/bridge/` (this spec supersedes the bare
  "bridge" sketch in the architecture doc).

## How it fits the system (the three pieces)

The Companion is one of three complementary pieces — see `docs/mission-control-spec.md` and
`docs/phone-app-spec.md`:

| Piece | Role | For |
|---|---|---|
| **BRX Companion** (this) | per-player engine + powerups + audio, **hardware** | owned fleets, no phones, rugged/loud, out-of-range play |
| **Phone app** | per-player engine + HUD, **software** (Web-Bluetooth PWA) | BYOD / casual players |
| **Mission Control** | operator console: scan → roster → teams → weapons → scoreboard | the game master |

The Companion and the phone app are **interchangeable per-player nodes** — a match can mix them.
All three share the decoded protocol (`protocol/callsign-extract/`), the `brx-mcp` command layer,
and the MQTT bus. Mission Control assigns loadout/team/mode; the Companion executes and reports.

**Community validation:** LaserTagMods' proven mount is exactly this shape — a USB power bank +
ESP32 riding the phone bracket, no permanent gun modification, ~15 h on a 5000 mAh pack
(`docs/reference/lasertagmods.md`, `community-notes.md`). The Companion adds audio, HUD, and the
decoded-powerup layer on top of that validated base. It also fills the community's #1 complaint —
no on-device scoring / "how do I see my score?" — by being the score-keeper and HUD per player.

## Open hardware questions (before a build)

- Wi-Fi + BLE coexistence throughput under real load — measure; may want BLE-priority.
- Speaker/enclosure acoustic tuning to actually match the tagger — prototype and SPL-measure.
- Does re-pushing `$WEAP` mid-game glitch the active weapon (reload/ammo reset)? Test on hardware.
- BLE re-establishment reliability on the S3 (establishment is ~1-in-3 flaky per §experiment-log;
  holding is fine) — the Companion reconnects transparently, but validate.
