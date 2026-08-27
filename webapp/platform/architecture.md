# How it's wired
_Three tiers of hardware that never all talk to each other at once — and why._
Last verified: 2026-08-27

## Read this before trusting any diagram.
Open BRX is not one program. Every awkward part of the design follows from four non-negotiable facts: stock firmware is never modified; the gun is host-blind about its own kills; native feel and host control are mutually exclusive unless a live host drives the feel; and the field is offline and dispersed.
Source: docs/architecture-topology.md §1, docs/adr/0001-companion-rider-architecture.md

_[diagram PLAT-06: flow: *We want host-controlled custom modes + full native feel + scoring on stock firmware, offline, dispersed* → **Native game** (guns self-fire the green-sight flash + killstreak audio ✅; but no synced start, no custom modes, no host control, no scoring ❌) and **Host-configured game** (custom modes, synced start, scoring ✅; but the guns go quiet — a live host must drive feedback ❌) → *Could Mission Control be that live host?* **No — players scatter out of BLE range** → *Something must hold a BLE link to each gun, in the field, all match* → **Decision: a per-player node — a phone today, an ESP32 Companion later.**]_

_[diagram PLAT-05: (the same diagram as the overview hero, full size, with the legend). **Solid line = must hold. Dashed line = allowed to drop.** The BLE link rides the player and must survive the match; the Wi-Fi link may come and go, and events queue locally until it returns. ✅/🧪]_

## Every link, and what limits it
| Link | Transport | Limit | Status |
|---|---|---|---|
| Gun ↔ headset | vendor link | headset must be present or the gun drops BLE entirely | ✅ bench |
| **Node (phone) ↔ gun** | **BLE** | **exactly one gun per node**; link must hold all match | ✅ single-gun bench |
| Node ↔ Mission Control | Wi-Fi (WebSocket) | best-effort; buffered when down | 🧪 one node at the bench; never a field |
| Operator ↔ Mission Control | HTTP on localhost / LAN | `:8765` UI, `:8766` node socket | 🧪 |
| Gun → gun | **IR**, line of sight | the only player-to-player channel | ✅ |
| Laptop ↔ gun | BLE | **setup and recap only** — never during play (Tier 0 excepted) | ✅ |
| Laptop ↔ gun | USB | one-time armory setup per gun | ✅ |
Source: docs/architecture-topology.md §2, protocol/brx-protocol.md §7r, docs/spec/net.md

## Counting limits
| Thing | Limit | Why | Status |
|---|---|---|---|
| Guns per BLE radio | **3 proven** — three guns held on one laptop radio for a synchronised start; the maximum is untested | one central radio shares connection events | ✅ 3 guns (FOLLOWUPS B10) · max unmeasured |
| Guns per phone node | **exactly 1** | the link rides one player | ✅ design |
| Players per game | **63** | the gun accepts `$PSET` ids 0–63 (✅ bench); Open BRX reserves wire id 0, so a match has ids 1–63 (`docs/spec/contracts.md` A5.1) | ✅ |
| Native hardware teams | **4** | `$TID` is masked to 2 bits | ✅ bench 2026-08-26 |
| Teams beyond 4 | unlimited *logical* teams | MC scores by roster; players wear armbands; no on-gun friendly-fire protection in that mode | 🧪 |
Source: docs/architecture-topology.md §2 + §7, docs/FOLLOWUPS.md B10, docs/spec/contracts.md A5.1, protocol/brx-protocol.md §7p, docs/game-modes.md §Team structure

_[diagram PLAT-07: left: **Tier 0, laptop only** ✅ (laptop ↔ 4 guns over BLE); right: **Tier 1, phones as nodes** 🧪 (laptop = Mission Control + field Wi-Fi, dashed to phones; each phone solid BLE to one gun). The wall between them is labelled *"everyone must stay within ~10–30 m of the laptop."*]_

## Tier 0 is real today; Tier 1 is what buys you a field — and it has never been run on one.
A full Team Deathmatch ran end to end on two real taggers on 2026-08-25 (scoring, respawn, frag limit, correct winner, BLE holding the whole match), and a three-gun synchronised start is hardware-proven. The phone-node path has been proven only as *one phone → Mission Control → one gun at the bench* (2026-08-25 night); a multi-phone match over a real field Wi-Fi, a dispersed timed start, and store-and-forward recovery after real coverage loss have not been run. ✅/🧪
Source: docs/architecture-topology.md §3 + §7, docs/experiment-log.md "first phone→MC→gun path on real hardware"

## Which links are up, phase by phase
([diagram PLAT-08])
0. **Armory** — USB to each gun, one time, at home. ✅
1. **Muster** — node↔gun BLE up; node↔MC Wi-Fi up; readiness board (gun battery, firmware, headset, phone battery, clock sync). 🧪
2. **Build** — host authors the game; no guns involved. 🧪
3. **Kit** — assign player number, name, team, weapon, voice; a weapon try-out pushes real frames so the player can feel it. ✅ (try-out fired a real gun from MC, 2026-08-25)
4. **Lobby** — players ready up; MC pushes the per-player FrameBundle; each node writes it to its gun and acks with the gun's echo. 🧪
5. **Dispersed start** — MC issues a go-live wall-clock time; players walk out of range; **each node counts down locally — no signal is needed at T-0.** 🧪
6. **Live play** — node↔gun BLE up; node↔MC Wi-Fi best-effort; **MC↔gun BLE: never.** 🧪
7. **Recap** — players return; nodes flush; MC reconciles winner, K/D, accuracy, medals; exportable CSV. 🧪
Source: docs/architecture-topology.md §4, docs/spec/README.md §3, mcp/brx_mcp/mc/API.md

_[diagram PLAT-09: A kill happens in the field → the **victim's** node sees it instantly (`$HP,0` + its last `$HIR`) → the victim's own HUD, death audio and respawn timer are immediate, no network → the victim's node must reach MC over field Wi-Fi → MC attributes the kill and sends feedback to the **shooter's** node → the shooter's green-sight flash + killstreak audio arrive *only when both hops complete*.]_

## So on a large field: you always know you died. You may not learn you got a kill until you walk back into range.
Final results are never wrong, only late — kills live in the victims' reports, so a scoreboard is provisional until every node has flushed. Put respawn/base points inside Wi-Fi coverage so every death is a sync point. Instant field-wide feedback is the Companion mesh (M6). 🧪/📐
Source: docs/architecture-topology.md §5, docs/spec/README.md §3

## What happens when things break
| Failure | What happens | Status |
|---|---|---|
| Field Wi-Fi drops | Nodes keep playing; events queue locally and flush on return | 🧪 |
| BLE drops mid-match | The node re-probes on reconnect; **the gun's config survives a BLE drop** | ✅ bench |
| Gun is power-cycled | Config is **wiped**; a zeroed `$LCD` echo is the node's tell to re-push | ✅ bench |
| Phone dies | That player is out — one phone = one gun = one node, no failover | design |
| Node never returns | Recap stays provisional; that player's kills are missing | design |
| Headset off or asleep | The gun silently refuses to join; a disconnected headset slow-blinks rainbow — a free visual muster check | ✅ 2026-08-25 / 27 |
Source: docs/architecture-topology.md §6, protocol/brx-protocol.md §7r, docs/HANDOFF.md 2026-08-27
