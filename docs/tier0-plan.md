# Tier 0 — the maximized plan & milestone roadmap

The plan to squeeze **every mode possible out of gear Tony already owns** (4 BRX + 2 grenades + phones
+ a laptop), and the **software-development priority** that follows from it. This is the *sequencing*
layer over `game-modes.md` (mechanics), `build-tiers.md` (spend), `mode-limits.md` (constraints), and
`phone-app-spec.md` (the app).

**Guiding principle (drives priority):** build what we **know how to build now**; wherever a **knowledge
gap blocks** a mode or milestone, the **test/research to close that gap becomes the highest priority for
that branch.** We never build on an unknown — we resolve it first. So the near-term backlog is:
*(1) ship the no-gap core, (2) run the gating tests that unblock the earliest/most value, in that order.*

---

## 1. Device functions at Tier 0 (the raw materials)

**Taggers (×4 BRX)** — the dumb endpoints (keep no game state, `protocol/brx-protocol.md` §7n):
configurable weapons (`$WEAP`), health/armor/shields (`$PSET`/`$LIFE`/`$BUMP`), fire + receive IR
(`$HIR`/`$HP`), buttons/battery telemetry (`$BUT`/`$VOLTS`), play any of 2166 sounds (`$PLAY`), LEDs
(`$GLED`/`$HLED`), remote start + host respawn (`$SPAWN`/`$PB*`/`$AMMO`), custom on-tagger sound packs
(USB swap).

**Headsets** — IR hit sensors + ARGB (WS2812B) + audio; receive grenade/accessory IR.

**Grenades (×2)** — IR-paired objective accessories: native modes **Respawn / KotH / Checkpoint-
Domination / Assault**; blast types FlashBang/Gas/Confusion/Molotov; placeable or thrown; shoot-to-
capture / hold / blast-instant-capture; config on-grenade or via `$GREN`. **The only Tier-0 IR objective
nodes** (`reference/grenade.md`).

**Phones** — by capability:
- **Android (Pixel 10 Pro / OnePlus 7 Pro / Pixel 4):** Web-Bluetooth (drive a gun), WiFi, **GPS**,
  **camera**, screen, speaker, IndexedDB. The Pixel 10 Pro (SIM) also = cellular backhaul/hotspot.
- **iOS (iPhone X ×2, iPad Air):** **no browser BLE** → screens/MC/relay/objective roles only (web);
  full WiFi/GPS/camera/screen. (Native later makes them full nodes — still Tier 0.)
- **Phone roles:** player **HUD/engine node** (Android) · **Mission Control** console (any) · **MC relay/
  aggregator** (SIM primary; any opt-in) · **bomb/hack/hostage touch-terminal** (any) · **GPS geofence
  objective** (any) · **QR scanner objective** (any) · **status/scoreboard screen** (any) · **siren**
  (drive `$PLAY` on a connected gun).
- **Phone limits:** no IR (can't be shot / emit IR); Web BT can't scan-by-address (native only); ~7
  simultaneous BLE links.

**Laptop (Mac/Windows)** — runs `brx-mcp` (bleak), direct-drives ~4–7 taggers over BLE; hosts the CLI,
the Mission Control server, and the MQTT broker.

---

## 2. Tier-0 mode catalog — known vs. needs-a-test

✅ = buildable now (proven or pure software, no BRX unknown) · 🧪 = blocked by a knowledge gap (the
gating test named).

| Mode / family | Status | Enabled by | Gap (if any) |
|---|---|---|---|
| **TDM, FFA (team scoring)** | ✅ | laptop/CLI host — proven (`arena`/`deathmatch`) | — |
| **Deathmatch + host respawn, custom weapons** | ✅ | proven on hardware | — |
| **Survival/Infection, Last Man Standing** | ✅ | host rule module over `$HP,0` | — |
| **Generals / Commander / The Swarm** (respawn roles) | ✅ | role module + designated player | — |
| **Supremacy** (3 factions) | ✅ | `$WEAP`/`$PSET` loadouts | — |
| **FFA *per-player* scoring; Syphon (credit killer)** | 🧪 | needs a player id in the hit | **P2** — set `PlayerID` via `SETUP` (USB serial) |
| **Halo shields / overshield / medic** | 🧪 | `$LIFE`/`$BUMP` writes exist | **P11** — confirm health-grant works **mid-life** over BLE |
| **Grenade objective: CTF / KotH / Checkpoint / Assault** | 🧪 | grenade native modes | **G1** — map each mode ↔ `$GREN` (or use on-grenade button, unaided) |
| **Live grenade-objective state on a screen; auto-detect at site** | 🧪 | gun's BLE stream | **G6** — what `$`-events the gun emits during a grenade game |
| **Counter-Strike (grenade bomb / phone touch-terminal)** | ✅ touch / 🧪 grenade | phone touch = software; grenade bomb = G1/G6 | phone path ✅; grenade path 🧪 |
| **Extraction (grenade hold + phone display)** | ✅ engine / 🧪 grenade hold | rules engine built (`mcp/brx_mcp/modes/extraction.py`) | grenade-hold path 🧪 G1/G6; phone-summon ✅ |
| **Hack terminal / hostage rescue (touch)** | ✅ | phone touchscreen | — |
| **Outdoor objectives (flag/hill/extraction/BR-zone/domination) via GPS** | ✅ | phone geolocation (unlimited points) | — (outdoor only) |
| **Checkpoints / pickups via QR** | ✅ | phone camera | — |
| **Full-field roaming for all of the above** | 🧪 | phone-as-node | **Android BLE hold test** (gates the phone milestone) |
| **Field-wide live status without WiFi** | ✅ software / 🧪 delivery | distributed MC (gossip) | needs the phone/relay app (M2), not a BRX unknown |

**Reading it:** the **elimination / role / health-ish / custom-weapon** modes have **no BRX unknowns** —
buildable now on the laptop. The **objective family** (the biggest Tier-0 maximization) is gated on the
**grenade-over-BLE** unknowns. **Field roaming** is gated on the **Android BLE** test. GPS/QR/touch
objectives are **pure software**, no gap.

---

## 3. Milestone ladder

Each milestone is a software artifact that unlocks a band of modes. Annotated with its knowledge gaps.

### M0 — CLI game host (Claude/laptop-driven, in BLE range) — *foundation, ~half-exists*
Already here: `scan/identify/diagnose/fleet/deathmatch/arena/fieldstart/startgame`, the protocol layer,
the **Extraction rules engine + tests**. To finish:
- **M0.1 Mode-module framework** — port TDM/FFA/Survival/LMS/roles into transport-free engines like
  `extraction.py` (each with tests).
- **M0.2 Live driver** — bind a mode engine's `Action`s to the BLE `ConnectionManager` (generalise
  `_deathmatch`), so **any** module runs live from the CLI. *(Highest-leverage single task.)*
- **M0.3 Health/regen modules** — shields/overshield/medic (Syphon behind P2).
- **M0.4 Grenade config push** — `$GREN` per mode (after **G1**).
- **Unlocks (no-gap parts):** TDM, FFA, Deathmatch+respawn, Survival/Infection, LMS, Generals/Commander/
  Swarm, Supremacy, Extraction (small), custom weapons — **Claude can run a real orchestrated game.**
- **Gaps:** health modules (P11), grenade modes (G1/G6), FFA per-player (P2).

### M1 — Mission Control UI (laptop-served, still in BLE range) — *the pilot product*
- **M1.1** brx-mcp → a local **service** (REST/WebSocket) wrapping the M0 engine.
- **M1.2 Operator UI:** scan → roster → assign teams → weapons/loadouts → pick mode+params → **Start** →
  **live scoreboard + kill-feed** → End → results/export. Reliable, repeatable, **no Claude in the loop**.
- **M1.3 Grenade config UI** (followup **B8**) folded in.
- **Unlocks:** everything in M0, **human-operated + repeatable + team-assigned + live scoreboard** — the
  real 4-player pilot on the laptop.
- **Gaps:** same as M0 (inherited); none *new*.

### M2 — Phone apps (field roaming + richer objectives) — *scales beyond the laptop*
- **GATE: the Android BLE hold test** before 2a.
- **M2.0** Extract the **transport-free core to JS/TS** (mode engines + protocol) — shared by web now,
  native later.
- **M2a HUD / player-node PWA (Android):** phone drives its own gun; per-player engine + HUD; offline-
  first → **full-field roaming for every mode** + per-player HUD/scoring. (iOS HUD = native later.)
- **M2b MC relay/aggregator app:** distributed MC — SIM aggregator + opt-in relays, gossip event log,
  cellular backhaul → **field-wide live status without venue WiFi** (`field-architecture.md`). Runs on
  iOS as web (no BLE needed).
- **M2c Accessory/objective app:** bomb-arm touch-terminal, **GPS geofence objectives**, QR scanner,
  status screens, phone-siren → CS plant/defuse, hack, hostage, **unlimited outdoor GPS objectives**, QR
  checkpoints, extraction display. Runs on iOS as web.
- **Gaps:** Android BLE hold (2a); auto-detect-at-site (G6, optional).

*(M3+ = Companion hardware, IR stations, LoRa — the higher tiers; out of scope here but this plan feeds
them.)*

---

## 4. Gating tests — the highest-priority research (the principle in action)

Where the maximized plan is blocked by a knowledge gap, **the test to close it is the priority for that
branch.** Ordered by *how early / how much Tier-0 value it unblocks*:

| # | Gating test | Unblocks | Effort / how |
|---|---|---|---|
| **G-1** | **Grenade-over-BLE session** (G1 + G6 + `$GREN` push) | the **entire Tier-0 objective family** (CTF/KotH/Checkpoint/Assault/CS/Extraction-hold) + live objective state + auto-detect — *the single biggest maximization of Tier 0* | **hardware session + BLE capture** with a grenade; drive `$GREN`, watch the gun's stream. Highest unknown, highest payoff. |
| **G-2** | **Health-write live test** (P11) | the **health/regen family** (shields/overshield/medic; Syphon mechanic) | quick BLE probe: send `$LIFE`/`$BUMP` mid-game, confirm HP/shields change live. |
| **G-3** | **Per-player identity via `SETUP`** (P2) | **FFA per-player scoring + Syphon crediting** | USB serial console (PuTTY): set `PlayerID`, verify via `QUERY`, check `$HIR` carries it. |
| **G-4** | **Android BLE hold test** | the **phone milestone (M2)** — field roaming, HUD, relay | ~30 min: `webapp/ble-test.html` (Chrome) vs nRF Connect (native), side-by-side. Cheap; also decides web-vs-hybrid. |

**Non-blocking (build without; refine later):** P10 (damage-weighted scoring), P9 (native small teams —
workaround exists), G7 (grenade audio), P15 (exact BLE connection counts). These don't gate any Tier-0
mode's existence, only its polish.

---

## 5. Software-development priority (the backlog the plan dictates)

Interleaves *no-gap builds* (do now) with *gating tests* (unblock the next band):

1. **M0.2 live driver** — bind engines→BLE so any mode module runs live. *(Extends what exists; unlocks running everything.)*
2. **M0.1 core mode modules** (TDM/FFA/Survival/LMS/roles) + tests. *(No gaps — pure build.)*
3. **G-1 grenade-over-BLE session** — the biggest unknown gating the biggest mode family. *(Hardware session; schedule when a grenade + capture rig is on hand.)*
4. **G-2 health-write test** + **M0.3 health modules**. *(Quick test → a whole mode family.)*
5. **M1 Mission Control UI** (service + operator UI + scoreboard) — the repeatable pilot. *(No new gaps.)*
6. **G-4 Android BLE hold test** — cheap spike; do opportunistically, must pass before M2a.
7. **G-3 per-player identity** (P2) — unlocks FFA scoring/Syphon; do with a USB session.
8. **M2.0 core→JS** + **M2a HUD PWA** (after G-4), then **M2b relay**, **M2c accessory**.

---

## 6. So — is the Android BLE stack test the *first* thing?

**No.** Under your own framing (CLI-first), the Android test gates the **phone milestone (M2)**, which is
*third*. Two things come before it:

1. **Build the no-gap core (M0/M1).** The elimination / role / custom-weapon modes and the Mission
   Control UI have **no BRX unknowns** — they're proven or pure software. Start here; it's the fastest
   path to actually playing an orchestrated game, and it needs **no phone at all** (laptop BLE).
2. **Run the gating tests that unblock the *earliest/biggest* value first** — and that's the **grenade-
   over-BLE session (G-1)**, because the objective family is the heart of maximized Tier 0 and it gates
   M0/M1-era modes, *earlier* than the phone milestone the Android test gates.

The Android BLE test is **still important and cheap** (30 min), so do it opportunistically as a
de-risking spike — it decides web-vs-hybrid for M2. But it is **not the first thing, and not the
highest-priority test.** First: build the known core + resolve the grenade unknown.
