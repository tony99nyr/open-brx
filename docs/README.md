# Docs index

Start here. Read `../CLAUDE.md` first for hard rules and environment, then this.

## Status & process
- **[HANDOFF.md](HANDOFF.md)** — current cross-machine state; read before a hardware session.
- **[experiment-log.md](experiment-log.md)** — the shared lab notebook. **Append after every session.**
- **[FOLLOWUPS.md](FOLLOWUPS.md)** — consolidated, prioritised open work (build / protocol / grenade / range).

## Plans & architecture
- **[brx-architecture-v0.2.md](brx-architecture-v0.2.md)** — the master plan (server, nodes, MQTT, roadmap).
- **[field-architecture.md](field-architecture.md)** — why field play needs a device per player (the range constraint).
- **[mission-control-spec.md](mission-control-spec.md)** — operator console: scan → roster → teams → weapons → scoreboard. Includes the deathmatch gap analysis.
- **[phone-app-spec.md](phone-app-spec.md)** — Callsign replacement (Web-Bluetooth PWA, per-player engine + HUD).
- **[../hardware/brx-companion-spec.md](../hardware/brx-companion-spec.md)** — the per-tagger ESP32-S3 accessory (offline engine + powerups + audio + WiFi).
- **[../hardware/print-files.md](../hardware/print-files.md)** — 3D print files: what exists (community-shared) vs the gap our `hardware/` can fill; asks tracked in FOLLOWUPS §Hardware.
- **[brx-mcp-spec.md](brx-mcp-spec.md)** — the MCP server spec.
- **[apk-investigation.md](apk-investigation.md)** — APK teardown plan (done; see results below).
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
- **[reference/lasertagmods.md](reference/lasertagmods.md)** — JEDGE/JBOX facts: protocol, IR encoding, stations, radios, hardware.
- **[reference/community-notes.md](reference/community-notes.md)** — repairs, headset re-pair, battery, game-mode ideas, cautions.

## The system in one paragraph
The BRX tagger is **dumb** — it fires a weapon we define (`$WEAP`), reads IR hits, tracks health,
and **keeps no game state**. So every real capability lives off-gun: a **per-player node** (the
**Companion** hardware or the **phone app**) is the game engine that drives spawn/respawn/score and
powerups over BLE; **Mission Control** is the operator console that assigns teams/weapons/modes and
shows the scoreboard; **objective stations** (QR codes or IR boxes) provide capture/respawn/pickup;
all glued by a local **MQTT** bus with store-and-forward. Nothing here is blocked on unknown
protocol — the APK teardown decoded the command set, the sound bank, and the game-mode model.
