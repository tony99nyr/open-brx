# BRX Open Battle System — Architecture & Handoff Spec (v0.2)

**Working name:** ~~BRX Open Battle System~~ → **Open BRX** (repo `open-brx`).

> **Note (2026-08-24):** this is the original v0.2 planning/vision doc. Some specifics have moved on —
> the **repo layout** here (§9 `brx-open-battle/`) is superseded by the actual tree in the root
> `README.md`; the **sound-bank mapping** (§5/§10) is **done** (`callsign-extract/sound-bank.md`);
> and **open work** is tracked in `FOLLOWUPS.md`. Kept for the architecture rationale + roadmap.
**Goal:** An open-source (MIT), community-friendly platform that turns Battle Company BRX taggers into a fully orchestrated laser tag system: forced game modes, live scoring, objectives, items/power-ups, effects, and a "mission control" home base — scaling from 4 taggers to 20+.
**Companion docs (same handoff package):**
- `brx-protocol.md` — BRX serial command reference (transport, framing, command tables)
- `brx-mcp-spec.md` — MCP server spec giving Claude Code direct Bluetooth access to taggers

**Credit:** Protocol discovery and the tagger-rider ESP32 concept originate with **LaserTagMods** (JEDGE/JBOX, github.com/LaserTagMods). This project is a fresh implementation; credit prominently in README. No code copied (his repos carry no license).

**Prime directives:**
1. Stock BRX firmware is never modified. All control is via the documented Bluetooth serial protocol. Power-cycle always restores a tagger; Battle Company's USB updater is the factory-restore path.
2. Store-and-forward everywhere: every node buffers timestamped events locally and syncs when in coverage. Live feed is best-effort; final results are always complete.
3. Server is the single source of truth for rules; nodes stay dumb.
4. Everything is a subscriber: scoreboard, lights, smoke, announcer are peers on the event bus, never special-cased in the engine.

---

## 1. System overview

```
                       ┌──────────────────────────────┐
                       │  SERVER (Pi/laptop)          │
                       │  Mosquitto MQTT broker       │
                       │  Game Engine (rules, score,  │
                       │   items, teams, announcer     │
                       │   logic, event log/SQLite)   │
                       │  Web: scoreboard + admin      │
                       │  (opt) Cloudflare relay for   │
                       │   remote spectators           │
                       └───────┬──────────────────────┘
                               │ WiFi / MQTT
   ┌──────────┬────────────┬───┴────────┬─────────────┬────────────┐
   │          │            │            │             │            │
 BRIDGE ×N  ITEM PACKS   OBJECTIVE    EFFECT        ANNOUNCER   WEB APP
 (on each   (backpacks,  STATIONS     NODES         NODE        (Web BT
  tagger)    flags)      (hills,      (WLED lights, (speaker,   scanner/
   │ BLE/HC-05            dom points)  relay: smoke, TTS+clips)  config/
   ▼                        ▲ IR       siren, servo)             flasher)
 BRX TAGGER  ──── shoots ───┘
```

## 2. Entity model (game engine)

- **Player** — profile: name, team, entitlements (e.g. premium item unlocks). Bound to a tagger for a match.
- **Tagger** — physical BRX + its bridge. Generation (1 vs 2/3), address, alias.
- **Item** — possessable thing with a beacon: backpacks, carryable flags. Profile (JSON) defines: visuals (LED pattern), buff (`$WEAP`/`$PSET` deltas), acquisition mode (`capture` | `entitlement` | `hybrid`), drop-on-death (bool), announcer lines.
- **Station** — fixed objective with IR receiver: hill, domination point, fixed flag base. Profile defines capture rules, scoring rate, effects.
- **Effect node** — output-only subscriber (lights/relay/audio).
- **Match** — mode + roster + settings + event log. Modes are server-side rule modules: TDM, FFA, Domination, KotH, CTF, Survival/Infection, custom.

**Item possession rule:** bridges report heard item beacons + RSSI; server assigns possession to strongest sustained signal (threshold must hold 1–2 s; hysteresis so ownership doesn't flap). On possessor death (`$HP,0`), item is released → "loose" state (pack LEDs flash) → claimable. Buffs applied on gain (`$WEAP`/`$PSET` push), reverted on loss.

**Team-targeted broadcast:** server can push command sequences to all taggers, a team, or one player (e.g. CTF: blue team gets alert sound + warning LEDs when red takes the flag).

**Kill attribution:** per protocol doc — cache shooter id/team from last `$HIR`; on `$HP,0` credit the cached shooter. Server-side streak/assist logic feeds announcer.

## 3. MQTT topic tree (draft)

```
brx/
  tagger/{alias}/event        # bridge→server: raw+parsed tagger msgs ($HIR,$HP,$BUT…), seq, ts
  tagger/{alias}/cmd          # server→bridge: commands to forward to tagger
  tagger/{alias}/status       # online, rssi, battery, buffer depth, gen
  tagger/{alias}/sync         # store-and-forward bulk replay (JSONL chunks)
  item/{id}/status            # beacon health, battery
  item/{id}/possession        # server-published: holder, state (held|loose|home)
  station/{id}/event          # IR capture hits: {team, player, ts}
  station/{id}/cmd            # LED state, lock/unlock
  game/state                  # retained: mode, phase, clock, score snapshot
  game/events                 # normalized feed: kill, capture, pickup, drop, spawn…
  announce                    # {priority, clip|tts, text} for audio nodes
  effects/{node}/cmd          # relay/light commands (WLED nodes use native WLED-MQTT)
```
QoS 1 for events; retained messages for `game/state` so late joiners render instantly. All events carry `{seq, node_ts, server_ts}` for replay reconstruction.

## 4. Firmware flavors (shared PlatformIO monorepo, common core)

Common core: WiFi/MQTT client, store-and-forward ring buffer (flash-backed), OTA via ESP Web Tools manifest + AP-mode fallback, config portal (SSID, server, alias), status LED.

1. **`bridge/`** — rides each tagger. BLE central (NUS) for Gen2/3 @115200; UART to HC-05 for Gen1 @57600. Forwards `$` traffic both ways; parses key events locally (so offline rules like power-up pickups still work); scans item beacons + reports RSSI.
2. **`item-pack/`** — BLE advertisement beacon (item id), addressable LED patterns, small LiPo. Flags = same firmware, different server profile.
3. **`objective-station/`** — TSOP IR receiver (players shoot to capture), LED ring (owner color), optional beacon. Publishes capture events; store-and-forward when out of coverage.
4. **`effect-node/`** — relay channel(s) (smoke machine remote-trigger, siren, servo) and/or DFPlayer Mini audio. Lights preferentially use stock **WLED** (no custom firmware).

**Announcer node** (not ESP32): Python service on the server or a Pi w/ powered speaker. Priority queue (game-state interrupts > kills > flavor), de-dupe/throttle, clip library + TTS fallback (any event speaks immediately; clips added over time). Ship an original "arena announcer" voice pack — do NOT ship copyrighted game audio (no actual Halo clips in the public repo).

## 5. Tagger audio strategy

- On-tagger speaker: built-in sound bank only, via `$PLAY,<id>`. **Task: map the bank** (loop candidate IDs via MCP, human logs what plays; publish as `sound-bank.md` + soundboard page in web app).
- Unlimited custom audio at the player: optional DFPlayer Mini + speaker on the bridge (~$5).
- Never attempt to modify tagger firmware/sound storage via the USB updater path.

## 6. Web app (one-stop shop) — static site, Cloudflare

- **Scanner/diagnostics:** Web Bluetooth scan → detect gen (BLE+NUS visible = Gen2/3; absent = Gen1 flow) → connect → `$PING` → live raw console. Chrome/Edge/Android only (no iOS Safari); state this in UI.
- **Config console:** presets from protocol doc — LEDs, sounds (soundboard once bank is mapped), weapon builder (once `$WEAP` map is cracked), mode forcing.
- **Flasher:** ESP Web Tools — browser USB flashing/restore for all firmware flavors. This is the community "restore and apply" story.
- **Scoreboard/Mission Control:** live map of objectives + possession, kill feed, clock, per-player stats; TV mode. Served locally by the server; optional Cloudflare Worker + Durable Object relay for remote spectators.
- **Replay viewer:** post-match timeline from the event log (kill feeds, damage graphs, streaks).

## 7. MCP integration (see brx-mcp-spec.md)

- Phase now: local BLE backend — Claude Code as lab instrument (protocol reverse-engineering, sound-bank mapping, `$WEAP` field cracking via capture diffing).
- Phase M4: same MCP tools, second backend proxying the server's API — Claude Code as game master over 20 taggers. Tool layer must be transport-agnostic from day one.
- No other MCPs needed; everything else is CLI-driven (esptool/PlatformIO, mosquitto clients, git).

## 8. Hardware BOM

**Phase 0 — $0:** taggers + any computer with BLE (or ~$12 dongle). Runs scanner + MCP M1. First action: BLE scan to determine generation → drives all purchasing.
**Phase 1 — pilot (~$40–60):** 4× ESP32-WROOM dev boards ($6–8 ea); power per bridge (1000–2000 mAh LiPo + TP4056 ~$5, or mini USB power banks); printed mounts (publish STLs). If Gen1: + HC-05 ($4 ea) + USB-TTL adapter ($8).
**Phase 2 — arena:** WLED ESP32 + LED strips; relay boards ($8) for smoke/siren; DFPlayer Minis ($4) + speakers; TSOP IR receivers (~$1) for stations; item packs (ESP32-C3 ok here — beacon only); Pi for dedicated server; RYLR896 LoRa modules (~$10/node) for big-field live coverage (design transport pluggable; ship WiFi first).
**Scale note:** direct-BLE-from-server maxes ~7–10 stable connections; the bridge architecture is what makes 20 taggers work. For 4-tagger pilot, direct BLE from the server is an acceptable interim while bridges are built.

## 9. Repo layout

```
brx-open-battle/            (MIT license)
  README.md                 (credit LaserTagMods prominently)
  protocol/
    brx-protocol.md
    sound-bank.md           (todo)
    weap-field-map.md       (todo)
  mcp/                      (brx-mcp, pip installable)
  firmware/                 (PlatformIO monorepo: common/, bridge/, item-pack/,
                             objective-station/, effect-node/)
  server/                   (game engine, modes/, items/, announcer/, api)
  webapp/                   (scanner, config, flasher manifests, scoreboard, replay)
  hardware/                 (STLs, wiring diagrams, BOM.md)
  docs/                     (gen identification, HC-05/Gen1 guide, venue setup,
                             grenade findings)
```

## 10. Roadmap

- **M1 — Identify (weekend):** MCP scan/identify/connect/send/get_events. Learn tagger generation. Web scanner page v0.
- **M2 — Control:** 4 concurrent sessions; force modes/settings end-to-end; session_log + wait_for; probe Smart Grenade (BLE scan w/ grenade on → document findings either way).
- **M3 — Protocol depth:** `$WEAP` field map via capture diffing vs official app; sound-bank mapping; protocol doc v0.2; weapon builder + soundboard in web app.
- **M4 — Pilot game:** bridge firmware on 4 taggers; server engine w/ TDM+FFA; live scoreboard; store-and-forward proven (walk out of range, return, verify reconstruction).
- **M5 — Arena:** objective stations (KotH/Dom/CTF), item packs w/ possession + drop-on-death, effect nodes (WLED, relay, announcer), mission control UI, replay viewer.
- **M6 — Scale + community:** 20-tagger load test, LoRa transport option, MCP server-backend (game master mode), docs polish, demo video, public launch.

## 11. Testing & safety

- Every firmware flavor: HIL smoke test = boots, joins MQTT, survives WiFi loss (buffer), OTA works.
- Engine: replay-driven unit tests (feed recorded event logs; assert scores/possession).
- Command safety: known-safe list enforcement in MCP + server; `panic` sequence (`$CLEAR,*` + `$SP,99,*`) exposed everywhere; document power-cycle restore in README.
- Kids-first: volume caps configurable; no PII in public relay feeds (aliases only).
