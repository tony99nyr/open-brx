# Docs index

Start here. Read `../CLAUDE.md` first for hard rules and environment, then this.

## Status & process
- **[FOLLOWUPS.md](FOLLOWUPS.md)** — **the single source of truth for open work** (build / protocol /
  grenade / range). The experiment-log A–G list and per-doc "open items" are historical snapshots;
  when they disagree, FOLLOWUPS wins.
- **[HANDOFF.md](HANDOFF.md)** — current cross-machine state; read before a hardware session.
- **[experiment-log.md](experiment-log.md)** — the shared lab notebook. **Append after every session.**

## Canonical sources (avoid restating — link to these)
To keep facts from drifting, each fact has one home; other docs should link, not re-argue:

| Fact | Canonical home |
|---|---|
| Gun-keeps-no-state proof | `../protocol/brx-protocol.md` §7n |
| `$GSET`/`$WEAP`/`$PSET` + command field maps | `../protocol/callsign-extract/protocol-classes.md` |
| Sound bank (2166 ids) + USB sound-swap | `sound-bank.md` / `reference/brx-extended-user-guide.md` |
| Grenade capability + `$GREN` fields | `game-modes.md` (analysis) / `callsign-extract/apk-harvest.md` (fields) |
| Edge/UBox parity + pricing | `reference/edge-brp.md` |
| Transport / field-range / reconciliation | `field-architecture.md` |
| Measured ESP-NOW/LoRa ranges + Jay's device family | `reference/jay-ecosystem.md` |
| Open work (all items) | `FOLLOWUPS.md` |
| QUERY/SETUP serial console + PlayerID | `../protocol/brx-protocol.md` §7c |

## Vision & strategy
- **[VISION.md](VISION.md)** — can we supersede Edge? BRX capability ceiling, BRP/Edge gaps, open-source + business analysis, naming guidance.

## Plans & architecture
- **[brx-architecture-v0.2.md](brx-architecture-v0.2.md)** — the master plan (server, nodes, MQTT, roadmap).
- **[field-architecture.md](field-architecture.md)** — why field play needs a device per player (the range constraint).
- **[build-tiers.md](build-tiers.md)** — what you can build at each investment level (starting from 4 BRX + 2 grenades + a laptop).
- **[game-modes.md](game-modes.md)** — catalog of every known game mode, classified by infrastructure tier (Mission Control alone / +props / +broadcast).
- **[mode-limits.md](mode-limits.md)** — the **constraints ledger**: for each designed mode (Extraction, CS, health variants, objective family, respawn, phone-objectives), what limits it **at each tier**, and whether each limit is a **hard ceiling** or a **pending hardware test**.
- **[mission-control-spec.md](mission-control-spec.md)** — operator console: scan → roster → teams → weapons → scoreboard. Includes the deathmatch gap analysis.
- **[phone-app-spec.md](phone-app-spec.md)** — Callsign replacement (Web-Bluetooth PWA, per-player engine + HUD).
- **[../hardware/brx-companion-spec.md](../hardware/brx-companion-spec.md)** — the per-tagger ESP32-S3 accessory (offline engine + powerups + audio + WiFi).
- **[../hardware/brx-station-spec.md](../hardware/brx-station-spec.md)** — the fixed **objective-station** node (JBOX-Mini-class ESP32 + IR: capture/hold/respawn/extraction, one primitive → many modes).
- **[../hardware/print-files.md](../hardware/print-files.md)** — 3D print files: what exists (community-shared) vs the gap our `hardware/` can fill; asks tracked in FOLLOWUPS §Hardware.
- **[brx-mcp-spec.md](brx-mcp-spec.md)** — the MCP server spec.
- **[apk-investigation.md](apk-investigation.md)** — APK teardown *plan/method* (done; results in `../protocol/callsign-extract/`).
- **[mac-capture-plan.md](mac-capture-plan.md)** — Mac-only PacketLogger capture plan (mostly superseded by the APK teardown).

## Protocol & reference (ground truth)
- **[../protocol/brx-protocol.md](../protocol/brx-protocol.md)** — the serial command reference (transport, framing, command tables, session findings).
- **[../protocol/callsign-extract/](../protocol/callsign-extract/)** — APK teardown:
  - `protocol-classes.md` — command/field maps, **$WEAP token positions**, enums.
  - `apk-harvest.md` — game modes, QR stations, weapon spawns, **grenade**.
  - `sound-bank.md` — the complete **2166-id** sound bank.
  - `config-facts.md` / `README.md` / `RAW_ASSETS_NOTE.md`.
- **[reference/brx-manual-notes.md](reference/brx-manual-notes.md)** — distilled official V7 quick manual (+ `BRX_Manual_V7.pdf`).
- **[reference/brx-extended-user-guide.md](reference/brx-extended-user-guide.md)** — the authoritative 2018 Extended User Guide: USB sound/firmware update process, IR specs (980nm/38kHz), accessory/grenade IR pairing, on-gun game variables, classes/perks/weapons.
- **[reference/edge-brp.md](reference/edge-brp.md)** — competitive study of Battle Company EDGE software + Battle Rifle Pro: features, UBox/Animatronics environmental effects, hardware, pricing, and parity targets for our platform.
- **[reference/lasertagmods.md](reference/lasertagmods.md)** — JEDGE/JBOX facts: protocol, IR encoding, stations, radios, hardware.
- **[reference/community-notes.md](reference/community-notes.md)** — repairs, headset re-pair, battery, game-mode ideas, cautions.
- **[reference/grenade.md](reference/grenade.md)** — the de-facto Smart Grenade manual (modes, on-grenade programming, respawn/KotH mechanics, pairing) — from the 2019 grenade videos.
- **[reference/jay-ecosystem.md](reference/jay-ecosystem.md)** — **Jay's DIY BRX ecosystem** (Extreme Laser Tag And More!): JBOX/JCUBE/JBOX Mini/JTOWER/JHALO/JEDGE devices, measured ESP-NOW/LoRa ranges, the game-mode mechanics he actually runs, and the **feasibility map to our tiers + the "what can an old phone do" answer**. Synthesized from ~30 of his videos.
- **[../protocol/captures/](../protocol/captures/)** — decoded BLE/HCI capture transcripts behind the findings (see its README).

## The system in one paragraph
The BRX tagger is **dumb** — it fires a weapon we define (`$WEAP`), reads IR hits, tracks health,
and **keeps no game state**. So every real capability lives off-gun: a **per-player node** (the
**Companion** hardware or the **phone app**) is the game engine that drives spawn/respawn/score and
powerups over BLE; **Mission Control** is the operator console that assigns teams/weapons/modes and
shows the scoreboard; **objective stations** (QR codes or IR boxes) provide capture/respawn/pickup;
all glued by a local **MQTT** bus with store-and-forward. Nothing here is blocked on unknown
protocol — the APK teardown decoded the command set, the sound bank, and the game-mode model.
