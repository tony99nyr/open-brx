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
