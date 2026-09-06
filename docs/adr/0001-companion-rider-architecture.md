# ADR-0001 — Per-player Companion (BLE rider) for live in-game feedback & scoring

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** Tony (owner)
- **Related:** `hardware/brx-companion-spec.md`,
  `protocol/session-findings-2026-08.md` §7o/§7n, FOLLOWUPS **B1/B18/B18b/P2/D1**,
  memory `mc-not-live-during-gameplay`, `docs/reference/lasertagmods.md` (JEDGE),
  `docs/reference/jay-ecosystem.md`.

---

## Context — why we are blocked

The platform controls **stock** BRX taggers. Five hard facts box in the design:

1. **Never modify stock tagger firmware** (project hard rule). All control is over the
   **BLE serial** protocol (+ IR/nRF *observation*). Reflashing the gun's own MCU is off the
   table: brick/warranty risk, and it would fork us from stock + community gear. *(Note: Jay/
   LaserTagMods did **not** reflash taggers either — JEDGE is ESP32 **rider** firmware that
   drives stock guns over BLE. "Custom tagger firmware" is a myth; the community controls stock
   guns from an external rider.)*

2. **The tagger is host-blind about its own kills.** It keeps no host-readable game state
   (§7n) and emits **no shooter-side kill event over BLE** (D4). A kill is host-visible ONLY
   from the **victim** (`$HP,0` + the victim's last `$HIR` = shooter *team*). So *something
   external* must be the scorekeeper — the gun cannot self-report a score.

3. **Two mutually-exclusive game modes**, selected by how the game is set up:
   - **Native (gun-menu) game:** the guns nRF-peer and **self-fire** the green-sight flash +
     killstreak audio — but it is manual per-gun setup, **no synced start, no custom
     modes/loadouts, no host control or scoring**.
   - **Host-configured (BLE-armed) game:** the mode we get when we arm over BLE (byte-identical
     to Callsign's arm). The guns do **not** self-fire feedback; a **live host must drive it**
     (`$SFLASH` + token-4 `$PLAY`, §7o). Proven two ways: Callsign *sends* `$SFLASH` precisely
     because the guns won't in this mode, and our bench sight stayed **red** for the same reason.

4. **The full native feel IS BLE-drivable** (§7o, the `cap8` finding): a connected host can
   drive the green-sight flash (`$SFLASH,*`) **and** the killstreak/multikill audio
   (`$PLAY,,4,6,<id>,,,,*`, token-4 slot). The visual is **not** nRF-locked — the old "nRF-only"
   call was a wrong-command (`$GLED`) probe. **But this requires a host connected to the gun at
   the instant of the kill.**

5. **The field is offline and dispersed.** Mission Control is a **stationary base**: its BLE
   reaches guns only when players are **at the base** — i.e. **setup/start** and **recap**.
   During play the players run around the arena, **out of MC's BLE range**; MC holds **zero**
   gun links mid-match. **MC therefore cannot be the live feedback/scoring driver.**

**The squeeze:** we want MC-controlled setup + **custom** modes + the full native feel
(flash + audio) + scoring — on **stock** firmware, in an **offline, dispersed** field. Native
mode gives *feel without control*; host mode gives *control but needs a live host*; and MC
*cannot be that live host in the field*. Nothing we already have closes this gap.

## Decision

Adopt a **per-player Companion**: a small **ESP32(-S3) rider** that mounts to each gun, stays
BLE-connected to **that gun** for the whole match, and is the **live host during play**. It:

- runs **our** custom game-mode logic and scoring (the `KillAnnouncer`/engine logic from B18
  lives here at runtime — see `mc-not-live-during-gameplay`);
- drives the gun's feedback over stock BLE — `$SFLASH` (flash) + `$PLAY` (kill/streak/medal);
- **networks with the other Companions** (ESP-NOW / LoRa) to share kills — the cross-player link
  Callsign does over its lobby network;
- optionally decodes the shot's **6-bit player-id off the IR** (an onboard receiver) → solves
  per-player attribution (**P2**) with no nRF tap.

**Mission Control's role is setup → synced-start → recap; the Companion owns live play.** This
is the proven Jay/JEDGE pattern (ESP32 tagger-rider, no gun mod). **Companion = our JEDGE.**

> **Addendum 2026-08-25 — P2 closed over BLE (protocol §7p/§7q).** The gun's player id is set by `$PSET`
> token 1 and returned in `$HIR` token 3 on every hit, so **per-player attribution needs no IR decode and no
> nRF tap** — the fourth bullet above is no longer a reason for the Companion. What the Companion still
> uniquely adds on a large field: a **node↔node mesh** (ESP-NOW/LoRa) for *instant, field-wide* kill-confirm
> and scoreboard where the phone path only gets them in Wi-Fi coverage zones (spec README §3), plus
> ruggedness/fleet ops. See `docs/spec/contracts.md` A4.

## Alternatives considered (and why rejected)

| Alternative | Verdict | Why |
|---|---|---|
| **Reflash the tagger firmware** | ❌ rejected | Violates the hard rule; brick/warranty risk; forks from stock + community gear; **and unnecessary** — a rider gets ~everything. Jay didn't do it either. |
| **MC-only, live over BLE** | ❌ rejected | MC is stationary; cannot hold BLE to guns scattered across a field. Viable only for a pilot/lobby game where everyone stays in range. |
| **Lean on the firmware's native gun-menu mode** (guns self-fire) | ❌ not primary | No synced start, no MC setup control, no custom modes/loadouts, manual per-gun. Kept only as a fallback for the simplest phoneless play. |
| **Per-player phone app (B2)** | ◐ BYOD option — **native, not PWA** | A dedicated rider beats phones for a rental/club fleet (no BYOD, cheap to replace, ruggedizable, fleet-manageable). **The Web-Bluetooth PWA path is ruled out** (ADR-0003): Chrome reported "Web Bluetooth globally disabled" + needed flags on the test phone, and **iOS has no Web Bluetooth at all**. So the phone option is a **native app** (Capacitor/RN, native BLE) reusing the shared web UI/engine — kept for personal/BYOD, not primary. |
| **nRF mesh tap only (D1)** | ❌ not for feedback | Observes native traffic / could give attribution, but does **not drive** host-mode feedback, and native-mode feedback isn't customizable. nRF work **re-scoped to P2 only**. |

**Why the Companion wins:** it is the only thing that is simultaneously (a) **connected to the
gun during live, dispersed play**, (b) running **our** logic (custom modes + scoring), (c) able
to **drive the full native feel over stock BLE**, and (d) **extensible** (own speaker, IR emit,
inter-Companion mesh, IR player-id decode) — all **without touching the tagger firmware**.

## Consequences

**Positive**
- Full native feel (flash + audio) in **our** custom modes, over stock BLE, in the field.
- MC keeps clean setup/start/recap control; Companions own live play.
- Companion mesh solves offline scoring + kill-sharing; IR decode solves P2.
- Stays within "never modify stock firmware"; compatible with stock + community gear.

**Negative / cost (the real burden)**
- A **second powered device per gun** — attach, charge, monitor, update. Fleet-management
  overhead that scales with gun count.
- BLE link reliability ("SCREAMERS": drops ~1 h, won't re-pair below a battery threshold) must
  be engineered around.
- A physical mount that must survive rough play.

**Mitigations (become requirements in `hardware/brx-companion-spec.md`)**
- **Mount:** a **slim, light, purpose-built package** (dedicated ESP32-S3 PCB + right-sized LiPo)
  — explicitly **NOT** the community's phone-bracket + USB-power-bank brick, which is proven but
  bulky/heavy. Prefer a **slim clip to the gun body** (side / under-barrel) or the sling hard
  point, **kept out of the sight line**; the **top Picatinny rail is only viable if thin + low +
  offset** (the sight lives there — anything tall blocks aim). No gun mod; positive-lock + tether;
  mass low and centered; **BLE-only, no wire to the gun** (removes the top failure mode). Exact
  location + fit needs **caliper measurements on the real gun** (the CAD blocker in `print-files.md`).
- **Power:** sized to outlast the gun (~2 battery cycles); USB-C **fleet charging** or swappable
  18650; battery % surfaced in MC's **muster/readiness board** (alongside the B18b headset gate).
- **Updates:** **OTA** over MC's WiFi AP ("update all"); dual-partition **auto-rollback**;
  USB-C recovery. Firmware version shown/gated in the readiness board.
- **Reliability:** rugged gasketed case; aggressive auto-reconnect; power-on **status-LED
  self-test**; **graceful degradation** — a dead Companion must never disable the stock gun.
- **Ops principle — STATELESS & INTERCHANGEABLE:** any charged Companion clips to any gun,
  self-IDs the gun over BLE (`tagger-naming-architecture`), and configures at muster. A dead
  unit is a **hot-swap**, not a re-pair. The spare pool is "a bin of charged Companions."

The operational loop: **charge the rack overnight → clip any Companion on any gun → MC's board
OTA-updates them and shows every gun green (gun batt / headset / Companion batt+fw / link) →
start.** Reuses the muster/readiness pattern already designed for the headset gate.

## Confirmations still owed (honesty)

This ADR rests partly on **strong inference**, not yet fully bench-confirmed:
1. **Host-mode requires a live host.** Test: arm a game our way, **disconnect**, play a couple
   of kills, watch the sight — prediction: it stays **red/silent** (confirming a live host is
   needed). If instead it self-fires, the native-mode fallback widens.
2. ✅ **`$SFLASH` from *our* stack greens the sight — CONFIRMED 2026-08-25.** Our native Capacitor
   app (native BLE, no Web Bluetooth) sent `$SFLASH,*` and the sight went green (bench gate G4). Also
   confirmed from our stack: `$PLAY` speak (G3) and a full config+spawn arm with chunked >20-byte
   frames (G5, countdown live). See exp-log "NATIVE app validated on hardware."

If (1) reverses, revisit the native-mode fallback; the Companion decision otherwise stands on
the offline-dispersed-field fact alone (MC can't be live in the field regardless).
