# How it's wired
_Three tiers of hardware that never all talk at once, and why._
Last verified: 2026-09-06

## Read this before you trust any diagram.
Open BRX is not one program. Four hard facts shape every awkward part of the design. Stock firmware is never modified. The gun cannot report its own kills. Native feel and host control cannot both happen unless a live host drives the feel. And the field is offline and spread out.
Source: docs/architecture-topology.md §1, docs/adr/0001-companion-rider-architecture.md

_[diagram PLAT-06: flow: *We want host-controlled custom modes + full native feel + scoring on stock firmware, offline, dispersed* → **Native game** (guns self-fire the green-sight flash + killstreak audio ✅; but no synced start, no custom modes, no host control, no scoring ❌) and **Host-configured game** (custom modes, synced start, scoring ✅; but the guns go quiet, so a live host must drive feedback ❌) → *Could Mission Control be that live host?* **No, players scatter out of BLE range** → *Something must hold a BLE link to each gun, in the field, all match* → **Decision: a per-player node, a phone today, an ESP32 Companion later.**]_

_[diagram PLAT-05: (the same diagram as the overview hero, full size, with the legend). **Solid line = must hold. Dashed line = allowed to drop.** The BLE link rides the player and must survive the match. The Wi-Fi link can come and go. Events queue on the node until it returns. ✅/🧪]_

## Every link, and what limits it
| Link | Transport | Limit | Status |
|---|---|---|---|
| Gun ↔ headset | vendor link | headset must be present or the gun drops BLE entirely | ✅ bench |
| **Node (phone) ↔ gun** | **BLE** | **exactly one gun per node**; link must hold all match | ✅ single-gun bench |
| Node ↔ Mission Control | Wi-Fi (WebSocket) | best-effort; buffered when down | ✅ two phones over field Wi-Fi, two whole matches (2026-08-30, 2026-09-01) |
| Operator ↔ Mission Control | HTTP on localhost / LAN | `:8765` UI, `:8766` node socket | 🧪 |
| Gun → gun | **IR**, line of sight | the only player-to-player channel | ✅ |
| Laptop ↔ gun | BLE | **setup and recap only**, never during play (Tier 0 excepted) | ✅ |
| Laptop ↔ gun | USB | one-time armory setup per gun | ✅ |
Source: docs/architecture-topology.md §2, protocol/session-findings-2026-08.md §7r, docs/spec/contracts.md §5

## Counting limits
| Thing | Limit | Why | Status |
|---|---|---|---|
| Guns per BLE radio | **3 proven**. Three guns held on one laptop radio for a synced start. The maximum is untested | one central radio shares connection events | ✅ 3 guns (FOLLOWUPS B10) · max unmeasured |
| Guns per phone node | **exactly 1** | the link rides one player | ✅ design |
| Players per game | **63** | the gun accepts `$PSET` ids 0–63 (✅ bench); Open BRX reserves wire id 0, so a match has ids 1–63 (`docs/spec/contracts.md` A5.1) | ✅ |
| Native hardware teams | **4** | `$TID` is masked to 2 bits | ✅ bench 2026-08-26 |
| Teams beyond 4 | unlimited *logical* teams | MC scores by roster; players wear armbands; no on-gun friendly-fire protection in that mode | 🧪 |
Source: docs/architecture-topology.md §2 + §7, docs/FOLLOWUPS.md B10, docs/spec/contracts.md A5.1, protocol/session-findings-2026-08.md §7p, docs/game-modes.md §Team structure

_[diagram PLAT-07: on the left, **Tier 0, laptop only** ✅ (laptop ↔ 4 guns over BLE). On the right, **Tier 1, phones as nodes** 🧪 (laptop = Mission Control + field Wi-Fi, dashed to phones; each phone solid BLE to one gun). The wall between them is labelled *"everyone must stay within ~10–30 m of the laptop."*]_

## Tier 0 is real today. Tier 1 has run two whole matches on real hardware, at two phones.
A full Team Deathmatch ran end to end on two real taggers from a laptop on 2026-08-25, with scoring, respawn, a frag limit, the correct winner, and BLE holding the whole match. A three-gun synced start is hardware-proven too. The phone-node path then ran a 300 s Free For All on 2026-08-30 (two phones, two taggers, one MacBook hosting over field Wi-Fi: 12 kills, 126 landed hits, 12 deaths, 12 respawns, a winner) and an outdoor Team Deathmatch with two Android HUDs on 2026-09-01. What has not been run: a dispersed timed start with players out of Wi-Fi range before T-0, more than two phones, a 20-minute soak, and a store-and-forward recovery after real coverage loss. ✅/🧪
Source: docs/architecture-topology.md §3 + §7, docs/experiment-log/2026-08.md (2026-08-30, MacBook), docs/field-issues.md (Session 2, 2026-09-01), docs/FOLLOWUPS.md "System proofs"

## Which links are up, phase by phase
([diagram PLAT-08])
0. **Armory**: USB to each gun, one time, at home. ✅
1. **Muster**: node↔gun BLE up, node↔MC Wi-Fi up, readiness board (gun battery, firmware, headset, phone battery, clock sync). 🧪
2. **Build**: the host writes the game. No guns involved. 🧪
3. **Kit**: assign player number, name, team, weapon and voice. A weapon try-out pushes real frames so the player can feel it. ✅ (try-out fired a real gun from MC, 2026-08-25)
4. **Lobby**: players ready up. MC pushes the per-player FrameBundle. Each node writes it to its gun and acks with the gun's echo. 🧪
5. **Dispersed start**: MC sets a go-live wall-clock time. Players walk out of range. **Each node counts down on its own, so no signal is needed at T-0.** 🧪
6. **Live play**: node↔gun BLE up, node↔MC Wi-Fi best-effort, **MC↔gun BLE: never.** 🧪
7. **Recap**: players return, nodes flush, MC works out winner, K/D, accuracy and medals. CSV export. 🧪
Source: docs/architecture-topology.md §4, docs/spec/README.md §3, mcp/brx_mcp/mc/API.md

_[diagram PLAT-09: A kill happens in the field → the **victim's** node sees it right away (`$HP,0` + its last `$HIR`) → the victim's own HUD, death audio and respawn timer fire at once, with no network → the victim's node must then reach MC over field Wi-Fi → MC gives the kill to the shooter and sends feedback to the **shooter's** node → the shooter's green-sight flash and killstreak audio land *only when both hops finish*.]_

## So on a large field: you always know you died. You may not learn you got a kill until you walk back into range.
Final results are never wrong, only late. Kills live in the victims' reports, so a scoreboard stays provisional until every node has flushed. Put respawn and base points inside Wi-Fi coverage, so every death becomes a sync point. Instant field-wide feedback is the Companion mesh (M6). 🧪/📐
Source: docs/architecture-topology.md §5, docs/spec/README.md §3

## What happens when things break
| Failure | What happens | Status |
|---|---|---|
| Field Wi-Fi drops | Nodes keep playing; events queue locally and flush on return | 🧪 |
| BLE drops mid-match | The node re-probes on reconnect; **the gun's config survives a BLE drop** | ✅ bench |
| Gun is power-cycled | Config is **wiped**; a zeroed `$LCD` echo is the node's tell to re-push | ✅ bench |
| Phone dies | That player is out. One phone = one gun = one node, with no backup | design |
| Node never returns | Recap stays provisional; that player's kills are missing | design |
| Headset off or asleep | The gun quietly refuses to join. A disconnected headset slow-blinks rainbow, which is a free visual muster check | ✅ 2026-08-25 / 27 |
Source: docs/architecture-topology.md §6, protocol/session-findings-2026-08.md §7r, docs/HANDOFF.md 2026-08-27
