# ADR-0002 — Laptop is Mission Control + local host; phones are companions/HUDs

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** Tony (owner)
- **Related:** `docs/adr/0001-companion-rider-architecture.md`, `mcp/brx_mcp/mc/API.md` + `docs/spec/design/mission-control.md` (the MC spec, formerly `docs/spec/mission-control.md`),
  `docs/adr/0003-native-app-over-web-bluetooth.md`, memory `mc-not-live-during-gameplay`.

---

## Context

ADR-0001 settled *what runs the gun during play* (a per-player node — Companion or phone). It
left open *what "Mission Control" runs on* and *how the field network is shaped*. Working through
the constraints surfaced a chain of facts:

1. **BLE does not fan out and players scatter.** One BLE central holds ~5-7 links at ~10-30 m;
   an 8+ gun field spreads players 50-100 m apart. **No single device can drive all guns over
   BLE** — each gun needs its own node in-hand. (This is the ADR-0001 premise, restated because
   it also kills "one phone runs everybody.")

2. **Coordination is a *local* network, not the internet.** Nodes share game state (mode push,
   kills, scoreboard) over a **field LAN** — WiFi from a router or a hosted hotspot. This needs
   **no SIM, no cell service, no internet.** SIM-less phones join a local WiFi fine.

3. **Nodes are autonomous; the coordination link is not real-time-critical.** Each node runs its
   own gun's full loop (spawn/damage/death/respawn/feedback) locally over BLE with no server in
   the loop. MC only (a) **pushes the mode once** at start and (b) **aggregates the scoreboard**
   via **store-and-forward** — tolerant of dropouts and eventual-consistent. A game runs with the
   LAN fully dead; you just lose the *shared* scoreboard until nodes resync.

4. **There is no cloud backend in a game — the host *is* the backend.** The game server runs
   **locally on the MC machine**; nodes connect to it on the LAN. Nothing in a running game
   reaches past the LAN, so the host being internet-offline is irrelevant to gameplay. Internet is
   a **home-only** convenience (install the app, optional post-game stat sync, updates).

5. **One WiFi radio can't host an AP and be a WiFi client at once.** A laptop hosting the field
   AP is therefore offline from the internet during a game (fine, per #4). A *phone* escapes this
   — cellular/satellite modem for backhaul **and** WiFi AP concurrently (two radios) — so a SIM'd
   phone *could* be MC + AP + live uplink together. That capability is real but **not needed for
   gameplay** and adds load/battery/complexity.

## Decision

**Primary path: a laptop runs the Mission Control software and hosts the field.** The laptop is:

- **Author** — create game modes (weapons, health, teams, respawn rules); this is just config.
- **Local host/server** — run the game server process **on the laptop**; nodes connect to it over
  the LAN. The laptop **is** the backend. No cloud, no internet required.
- **Access point (or LAN client)** — host the field WiFi directly, *or* (cleaner at scale) join a
  cheap battery **travel router** that hosts the LAN, so the AP burden is off the laptop.
- **Coordinator** — push the mode at start; collect node events (store-and-forward); own the
  scoreboard; recap afterward. **Not BLE-connected to guns during play** (`mc-not-live-during-gameplay`).

**Phones are simple companions/HUDs** — a phone is a **node**: it holds BLE to **one** gun, runs
that player's local loop, shows the player's HUD, and reports events to MC over the LAN. Phones do
**not** author or host in this path.

**Deferred (not rejected): phone-as-MC.** A SIM/satellite phone acting as MC + AP + uplink (§Context
5) is a legitimate low-infra / connected-telemetry option the community may want. **We defer it** —
the owner's setup is a laptop, and collapsing MC onto a phone adds load and battery cost we don't
need now. Revisit if community demand or a connected-spectator feature justifies it.

## Alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| **Laptop MC + local host (this ADR)** | ✅ primary | Matches the owner's kit; big screen for roster/teams/scoreboard; ample compute for the server; no infra beyond an optional $20 router. |
| **Phone as MC + AP + backhaul** | ◐ deferred | Genuinely capable (two radios → local + uplink at once), good for low-infra or live cloud telemetry, but heavier on one device (AP + cell + BLE + server) and unnecessary for the owner. Kept as a documented option. |
| **Cloud-hosted backend** | ❌ rejected | Would make gameplay depend on field internet, which the field doesn't have. The design is local-first by necessity; cloud is at most an at-home sync target. |
| **One phone/laptop drives all guns over BLE** | ❌ rejected | BLE fan-out + range (ADR-0001). Only works for a lobby game where everyone stays in range. |

## Consequences

**Positive**
- Zero gameplay dependence on internet, SIM, or cell coverage — the field is an island.
- Clean role split: **laptop = author + host + coordinator; phone = one-gun node + HUD.**
- The node↔MC protocol is transport-simple (local LAN, store-and-forward) and identical whether a
  node is a phone or (later) a Companion — so the same server serves BYOD phones and the ADR-0001
  Companion fleet interchangeably.
- Defers phone-as-MC without burning it — a documented upgrade path for the community.

**Negative / cost**
- The laptop hosting the AP is internet-offline during a game (acceptable — no cloud in the loop;
  use a travel router if simultaneous uplink is ever wanted).
- A laptop is one more thing to bring/charge to the field (vs an all-phone kit).
- Requires building the **local game server** (mode-push + store-and-forward scoreboard) and the
  **node↔MC protocol** — see "Next" below.

## Next (implementation implied by this decision)

1. **Autonomous node first** — the phone app runs **one** gun's full loop offline over BLE (arm,
   damage, death, respawn, feedback), no server needed. This is usable solo on day one.
2. **Node↔MC protocol** — a local-LAN event/command channel (mode-push down; hit/death/score up),
   store-and-forward, node-type-agnostic (phone or Companion).
3. **Laptop MC server** — game create/author, push mode to nodes, aggregate scoreboard, recap.
4. Same protocol later carries the ADR-0001 Companions with no node-side change.
