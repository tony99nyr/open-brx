# Open BRX — End-to-End Product Spec

- **Amendments are folded into the body of `contracts.md`**; its **§10 is the index**, newest first, and each
  amendment id stays as an anchor. The software (`mcp/brx_mcp/mc/`, `app/`, `webapp/mc/`) is built and tested
  against it (`cd mcp && python3 run_tests.py`).
- **Owners:** Tony (product) · multiple Claude sessions (parallel implementation).
- **Anchors:** ADR-0001 (per-player node), ADR-0002 (laptop MC + local host), ADR-0003 (native app). Ground truth
  for the gun: `protocol/brx-protocol.md`. Onboarding: `docs/architecture-topology.md`.

**Read `contracts.md` before touching any module** — it is the single point of coordination.

## 1. The product in one paragraph

A club/rental-grade system that turns stock BRX taggers into a hosted laser tag experience: a **MacBook Mission
Control** runs the event over a **local field Wi-Fi LAN** (no internet, no SIM, no cloud), enrolls and health-checks
the gear, lets a host build a game and kit each player out, pushes it to the taggers, starts a **synchronized
dispersed** match, tracks a live board and produces a recap. Each player carries a **phone (now) or Companion
(later)** as their **node**: it drives their one gun over BLE and shows a glare-legible HUD.

## 2. Key invariants (violating these breaks the architecture)

- **A node owns exactly one gun and runs autonomously.** Its own-gun loop (arm/damage/death/respawn/local
  feedback/timed end) works with the LAN dead. (`node.md`)
- **MC never holds BLE to guns during play.** Bench only (armory). Mid-match, MC talks to *nodes* over the LAN.
- **Cross-player truth (kills, assists, accuracy, score) is MC's**, assembled from node event reports;
  **eventually-consistent** via store-and-forward, never assumed real-time. (`contracts.md` §4, §5a)
- **The gun is host-blind about its own kills**: a kill is only observable from the *victim*, whose `$HIR` names
  the shooter **by player id** (`$PSET` token 1 ↔ `$HIR` token 3). Attribution is exact.
- **Frames are compiled in MC and written verbatim by nodes** (A4.2). One frame authority (`compile.py`), three
  runtimes (Python MC, JS phone, C++ Companion); only the first compiles. The node owns two literal templates.
- **The field is a large park; the LAN covers the base, not the match** (A4.8). Config, sync and start happen
  in range; the match runs on nodes; scores reconcile at sync points. Only `time_limit_s` can end a dispersed match.
- **Events are HUD-driven first** (A11.4): the node fires every event its own gun can witness from the bundle it
  holds; MC pushes only cross-player facts, best-effort, never waited on.
- **Never modify stock firmware.** Panic = `$CLEAR,*` then `$SP,99,*` (re-arm before play: no `$SIR` table).

## 3. The experience, phase by phase (the spine every module serves)

| # | Phase | What happens | Owner |
|---|---|---|---|
| 0 | **Armory** (one-time) | Per gun over USB: read headset PIN, bind BLE, write `$NAME` = sticker. | contracts §1.1 |
| 1 | **Muster** | Nodes connect to guns and report preflight; MC scans for unclaimed guns; red/amber/green board. Nothing starts on a red. | contracts §4 Readiness |
| 2 | **Games** | Host picks a saved game or a stock mode; venue (indoor/outdoor, night); time limit required. | modes.md, loadout.md §5 |
| 3 | **Kit** | `player_num` (1–63), display name, team, loadout (primary / secondary / perk), voice; a private **try-out** arms the weapon so the player feels it. Phones may self-serve within the policy. | loadout.md, modes.md §4 |
| 4 | **Lobby** | Players ready up; on all-ready MC pushes `config` + the per-player `FrameBundle`; nodes write the head (gun unspawned) and ack with the gun's echo. | contracts §5 |
| 5 | **Dispersed start** | MC issues `match_id` + a go-live wall-clock time; each node counts down locally and spawns its gun at T. No signal at T-0. | start-sequence.md |
| 6 | **Live play** | Nodes run the match; MC shows a board with staleness; feedback and K/A/ACC reach players in coverage zones. | node.md, API.md |
| 7 | **Recap** | Nodes flush; MC reconciles; winner, K/D, accuracy, medals, CSV. Provisional until every node has flushed. | API.md, contracts §4 |

## 4. Module map

| Module | Spec | Code | Owns |
|---|---|---|---|
| M-CONTRACTS | `contracts.md` | `mc/types.py`, `mc/envelope.py`, `app/src/transport/envelope.js` | data model, wire, lifecycle, clock, constants, store-and-forward, platform gates |
| M-ARMORY | `contracts.md` §1.1 | `mc/armory.py`, `usbconsole.py` | USB enrol + scan-only BLE presence |
| M-MODES | `modes.md`, `loadout.md`, `../weapon-design.md` | `mc/compile.py`, `mc/policy.py`, `mc/presentation.py`, `mc/weapons.json`, `mc/perks.json` | the frame compiler, catalogs, policy, presentation |
| M-NET | `contracts.md` §5 | `mc/net.py`, `app/src/transport/` | the WebSocket, ring, clock sync |
| M-MC | `mc/API.md`, `design/mission-control.md` | `mc/state.py`, `mc/api.py`, `mc/scoring.py`, `webapp/mc/` | the operator console and scoring |
| M-NODE | `node.md`, `design/phone-hud.md` | `app/src/engine.js`, `app/src/hud/` | the per-gun engine and HUD |
| M-START | `start-sequence.md` | `app/src/engine.js` (`startAt`, `resumeSchedule`) | the dispersed timed start and end |
| M-UTILITY | `utility.md`, `docs/utility-roadmap.md` | `app/src/beacon.js`, `app/src/utility.js`, `app/plugins/brx-beacon` | phones as stations |

Coordination rules: bind to the wire in `contracts.md` and the Interface section of any module you depend on,
never another module's internals; a gap is an amendment, not a fork; every module ships with its own fakes;
**sticker labels stay out of the repo** (examples use `Tactix-XXXX` / `GUN-A`).

## 5. Decisions on record

Field LAN = battery travel router, MC joins as a client (ADR-0002) · large park, coverage zones at bases (A4.8) ·
time-synced local countdown and local time-expiry end, `time_limit_s` required · exact BLE-native attribution
(A4.1/A5.2) · accuracy = victims' shooter-tagged hits over own shots (A4.4) · readiness is node-reported (A4.9)
and cannot deadlock (A5.4) · a live BLE rejoin reconciles from persisted state and never heals (A6.8) · after a
match nodes return to KITTED (A5.9) · runway default 120 s (A5.10) · MC = Python server + local web UI, node =
Capacitor · full `config` + bundle at lobby all-ready, then only `start` at go time · play volume 80 indoors /
90 outdoors, try-outs 69 (2026-08-30) · a perk is its own slot (A14).

Closed on the bench 2026-08-25 (`protocol/session-findings-2026-08.md` §7r): a 2-min hold-across-disperse then `$SPAWN` goes
live with config intact (5-min run still owed); the head write is silent; headset off drops the link, so link +
echo is the headset proof; an unspawned gun ignores IR; a live `$TID` write flips hit resolution immediately.

Still open (tracked in `docs/FOLLOWUPS.md`): the `$VOLTS` % token; the 5-min hold; a 20-min two-node soak;
iOS locked-phone BLE; the third (shield) pool in the node (node.md Q12).

## 6. Product qualities every module honours

Glare-legible + blackout HUD · autonomous nodes, store-and-forward everywhere · the phone is mounted and
foreground during ARMED/LIVE (A4.11) · stateless, interchangeable gear (any node clips to any gun; a dead unit
is a hot-swap) · diagnostics + log export on the node · credit **LaserTagMods (JEDGE/JBOX)** + **Jay Burden** in
public surfaces.
