# Field architecture — how a real match actually works

**Status:** proposal, 2026-08-23. Written after the findings in `protocol/brx-protocol.md`
§7n forced a rethink. Complements `docs/brx-architecture-v0.2.md` (master plan) — this doc
is specifically about **what happens on a field, out of Bluetooth range of any laptop.**

## The constraint we are designing around

Tonight established, empirically:

1. **The tagger keeps no game state.** It has no clock, no score, no rules, and it does not
   revive itself. It reports events (`$HIR`, `$HP`, `$ALCD`) to whoever is listening.
2. **Respawn and game time are not in the protocol stream.** Three captures with different
   respawn values produced byte-identical `$GSET` and `$PSET`. Callsign keeps the clock and
   drives respawn itself.
3. **Nothing is recoverable after the fact.** The app never queries the gun at end of game,
   because there is nothing to query.

**Therefore: anything needing respawn, a clock, or scoring requires a listener in BLE range
for the whole match.** A single laptop at the edge of a field cannot work. This is a design
property of the BRX, not a gap in our knowledge.

## The proposal: one cheap device per player

This is what the official system does — every player carries a phone, so the BLE link is
always about a metre away. We replace Callsign, not the topology.

```
  tagger ──BLE/NUS──> phone (on the player)  ──WiFi, later──> server ──> results
   (dumb)              game engine + HUD                       aggregate + score
                       logs offline                            (repo: server/)
```

- **In the field:** the phone is the game engine — drives spawn/respawn, enforces the
  clock, tracks score, and shows the player a HUD. No network needed.
- **Out of the field:** when the phone reaches WiFi it uploads its log. The server merges
  every player's log into the match result.
- **Degrades gracefully:** no WiFi just means results sync later. Nothing is lost, because
  the authoritative record is on the phone, written as events happen.

### Why Android, and why the web app

**Chrome on Android supports Web Bluetooth.** That means the repo's already-planned
`webapp/` (§6 of the master plan) can *be* the player client:

- No app store, no provisioning, no build toolchain, no Apple developer account
- Log offline to IndexedDB; upload when WiFi returns
- Updating every player's client = redeploying a static site

**iOS is materially harder**: Safari does not support Web Bluetooth at all. It would need
Bluefy or a real native app plus a paid developer account. Ironic given Callsign is
iOS-only — but we are not using Callsign.

Old Android handsets are cheap, and a screen in the player's hand is most of what makes the
official system feel finished.

## THE test that gates all of this

**Does Android BLE actually talk to a BRX?** Callsign has never worked on Android, and we
have assumed that is Callsign's problem rather than Android's — **but we have never checked.**
The entire proposal rests on it.

**Ten-minute test, no code, no purchase:**

1. Install **nRF Connect** (free) on any Android phone.
2. Scan → connect to `Tactix2-XXXX`.
3. Subscribe to notifications on NUS TX `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`.
4. Write `$PING,*` to NUS RX `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`.
5. Expect `$PONG,*` back.

**Do this before buying any hardware.** If it fails, investigate before concluding — it may
be the connection-interval / MTU sensitivity that makes NUS peripherals fussy on Android
(§7b), which is often fixable from the client side.

## Alternatives considered

| Option | Verdict |
|---|---|
| **ESP32 per player** | Cheaper, better battery, purpose-built — but **no HUD**. Best if the player-facing screen does not matter. LaserTagMods build exactly this. |
| **nRF radio** | `QUERY` reports `NRFhost 1` / `NRFslave 1`, and LaserTagMods ship `NRFL-Bases` / `LoRa-Controlled-Taggers`. **If the guns already carry a long-range radio, the range problem may not need solving at all** — no per-player device. Highest upside, entirely unprobed, needs reverse engineering. |
| **One laptop, in range** | Works today (`arena` does it) but only across a small area. Fine for a garage, useless on a field. |
| **On-gun menu config, no central scoring** | Set respawn/time by hand per gun, play, no results. Fine casually; does not scale to 20 taggers. |

**Recommendation:** run the Android BLE test first — it is free and decides between the two
leading options. Pursue the nRF thread in parallel, since it has the highest upside and is
Windows-friendly work (no iOS captures needed).

## Do we need a long-range radio (LoRa/nRF/ESPNOW)?

**No — not for the core game.** The per-player node (Companion/phone) rides the player, holds the
BLE link (~1 m, reliable), and runs the game engine **locally**: respawn, lives, clock, score, and
powerups all work with zero field radio. Final results sync via store-and-forward when the player
returns to WiFi. Basic per-player play needs no long-range transport at all.

A field transport is only needed for **live, real-time coordination across a field with no WiFi**:
a live scoreboard/spectator feed *during* the match, or cross-player/objective events that must
propagate instantly mid-game (a flag captured, a domination point flipping, a team-wide powerup).
Reach for options in this order:

1. **WiFi APs covering the field** — simplest where the venue allows; full bandwidth, live everything.
2. **The tagger's own nRF radio** — `QUERY` reports `NRFhost`/`NRFslave`; if usable, field range for
   **free** with no added hardware. Unprobed (followup D1) — highest upside.
3. **ESPNOW** — peer mesh, medium range, no infrastructure.
4. **LoRa (RYLR896)** — longest range but **low bandwidth**: periodic score sync + critical events
   only, never a live per-hit firehose (LaserTagMods note it's slow). The last resort for big
   outdoor fields with nothing else.

Build the node↔server link as a **pluggable transport interface** and ship **WiFi/MQTT first**
(architecture doc §"prime directives"); LoRa/nRF/ESPNOW are optional backends for the
big-field case. So: **LoRa is optional, not required.**

## Limits of offline reconciliation (store-and-forward)

Store-and-forward reconciles cleanly for **locally-authoritative** events and struggles with
**shared/contested** state. The dividing line drives the data model:

**Reconciles fine offline** — each node owns the truth about *itself*: my hits taken, my deaths, my
respawns, my ammo/pickups. Merge on reconnect, dedup by seq/nonce.

**Does NOT reconcile cleanly offline:**
- **Kill *attribution* across players.** `$HIR` carries the shooter's **team, not the player** (the
  P2 gap). Until each tagger has a unique `PlayerID` (set via the `SETUP` serial console — see
  `../protocol/brx-protocol.md` §QUERY/SETUP), a kill can't be credited to an individual even after
  sync. **P2 is a prerequisite for accurate offline scoring.**
- **Clock skew.** Merging two nodes' timelines needs a common time base. Node clocks drift; the
  `{seq, node_ts, server_ts}` scheme helps, but a **game-start time broadcast** (or NTP on WiFi) is
  needed or the merged kill-feed order is fuzzy.
- **Contested shared state.** Who owns a domination point contested out of coverage? A "last extra
  life" grabbed by two players at once? Global "first to N" counters? These are races that **cannot
  be resolved after the fact** — they need an authority in range at decision time. Fix: make the
  **objective station the local referee** for its point (it's a node too; it decides, buffers, and
  syncs its own authoritative events).
- **Lost buffers.** A node that dies (battery/crash) before syncing loses its unsynced events; the
  record is only as durable as each node's flash persistence.

**Design rules that follow:**
1. Model state as **per-player-authoritative events** wherever possible — those reconcile.
2. Give **contested objectives a co-located authority** (the station decides and buffers).
3. Reserve a **field transport** only for modes needing real-time global consensus out of WiFi range.
4. Establish a **common clock at game start**; require **per-player identity (P2)** for kill credit.
Live feed is best-effort; final results are always complete — exactly prime directive #2.
