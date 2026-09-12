# Game modes — catalog, infrastructure tiers, hard ceilings

Every BRX game mode we know of, from all sources (V7 manual, Extended User Guide, the Callsign APK harvest,
community), classified by **what infrastructure each needs to run at scale**, plus the hard ceilings every
mode design has to respect. The flagship Extraction design has its own page, `extraction-design.md`.
**This page carries no status**: what is built today is `HANDOFF.md`, and what is still open is
`FOLLOWUPS.md`. The MC config schema per mode is `spec/modes.md` §2;
the grenade's own modes are `reference/grenade.md` and the public manual (`manual/gameplay.md`). Consolidated
2026-09-06: the constraints ledger (`mode-limits.md`) and the grenade section moved out; the ceilings that
survive are §Hard ceilings below.

Sources: `reference/brx-manual-notes.md`, `reference/brx-extended-user-guide.md`,
`callsign-extract/apk-harvest.md`. Win conditions (APK): Score, Death (elimination), Slayer (most
kills), CaptureTheFlag, SquadLeader.

> **Tier note:** these are **infrastructure tiers** (what gear a mode needs). They are a *different axis* from
> the **spend tiers** ($0 → phones → Companions → stations → radio) laid out in
> `docs/architecture-topology.md` §8 (the public platform page, `platform/index.md`, no longer carries
> that ladder). A mode's infrastructure tier maps to whatever spend tier supplies that gear.

## The three infrastructure tiers

- **Tier 0 — Mission Control alone.** Taggers + a host/per-player nodes. Scoring comes from the
  `$HIR`/`$HP` event stream (who hit whom, who died). No field props, no broadcast. Works today in
  BLE range (`play tdm` on the laptop); on a field, each player just needs a node (phone / Companion)
  running the engine, results sync via store-and-forward.
- **Tier 1 — + props.** Adds **fixed objective stations** (control points, flag bases, respawn points — a
  utility phone, an IR box, or the grenade). The mode centres on *contested locations*, so those locations
  need a local authority. Playable without any field radio: stations are self-authoritative (LED/sound show
  truth locally) + end-of-game log collection + near-live via respawn-station sync.
- **Tier 2 — + broadcast.** Adds a **live field-wide downlink** ("flag taken", zone shrinking, live
  scoreboard) for the full experience on a large no-WiFi field. Only needed when live global
  awareness matters; the Tier-1 modes still *function* without it.

## Catalog

| Mode | Source | Core mechanic | Scoring / win | Tier | Props | Broadcast | Notes |
|---|---|---|---|---|---|---|---|
| **Free For All** | manual, EUG, APK | everyone vs everyone, friendly fire on | most kills (Slayer) / K-D | **0** | – | – | per-player attribution is **EXACT over BLE** (`$HIR` tok3 = shooter id); FFA is **never-friendly**, scoring is roster-based (A5.2) |
| **Team Death Match** | manual, EUG, APK | two to four teams, weapons + perks | team kills / Death | **0** | – | – | ✅ played end to end on two guns 2026-08-25 |
| **Survival / Infection** | manual, EUG, APK | humans vs infected; a kill converts a human | last human / infection spread | **0** | – | – | node flips a killed human to the infected team on `$HP,0` (the live `$TID` flip is bench-proven) |
| **The Swarm** | EUG, APK | infection, but a **Hive Queen** is the infected respawn point | last human | **0** | – | – | respawn point is a **player role**, not a prop |
| **Generals** | EUG, APK | TDM where a **General** is the team's mobile respawn point | eliminate the General / kills | **0** | – | – | respawn = seek the General, pull trigger; node enforces the role |
| **Commander** | EUG, APK (GOTDLC) | Faction wars + a **Commander** respawn character | seek-and-destroy the Commander | **0** | – | – | same as Generals, faction flavour |
| **Supremacy** | manual, EUG, APK | 3 factions (Nexus/Resistance/Vanguard), class-based | score / control | **0** | – | – | class abilities are `$WEAP`/`$PSET` loadouts |
| **Last Man Standing** | APK | elimination, limited lives | last alive | **0** | – | – | nodes track lives; no props |
| **Domination** | APK | hold **control points** for score-over-time | most point-time / Score | **1** | control-point stations | optional (live board) | points self-authoritative (LED = owner); `DominationBoxes` in APK |
| **King of the Hill / Territory** | APK (`Territory`) | hold a **zone** | time held | **1** | zone/hill station | optional | ✅ built and proven end to end through the gun 2026-09-10 (the hill is a real grenade in hill mode); domination is the same primitive with more than one point |
| **Capture the Flag** | APK, Callsign Team Arena | grab enemy **flag**, return to base | captures / CaptureTheFlag win | **1** | flag bases (+ flag object / QR) | **wanted** ("flag taken!") | Callsign uses QR flags |
| **Assault** | APK | attack/defend **objectives** in sequence | objectives armed/held | **1** | objective stations | optional | attackers arm points, defenders hold |
| **Team Arena** (Callsign) | APK, EUG | TDM + **QR weapon pickups** + capturable flags | kills + captures | **1** | QR codes (pickups/flags) | optional | QR = cheap props; weapon pickup = `$WEAP` push |
| **Battle Royale** | APK, EUG | shrinking play area, **GPS weapon/supply drops**, last alive | last standing | **2** | drop points (GPS) | **required** | needs per-node **location** + live zone/drop broadcast — the most infra-heavy |

## How to read it for building

- **Tier 0 is the MVP** and is built: TDM works on hardware; FFA/Slayer get **EXACT per-player attribution
  over BLE** (`$PSET` tok1 sets player_num, `$HIR` tok3 reports the shooter), and FFA is never-friendly with
  roster-based scoring (A5.2); infection/Generals/Commander/Swarm are host-side rule modules over the same
  event stream + a designated player role.
- **Tier 1 unlocks the objective modes** — the **objective-station** primitive. Today that primitive is a
  **utility phone** (BLE advert presence + the trigger as the act; `spec/utility.md`); an IR box
  (`hardware/brx-station-spec.md`) and the grenade (via the B23 bridge) are the shoot-to-capture variants. Each
  of Domination/KotH/CTF/Assault is the same station primitive with different rules.
- **Tier 2 is the polish** — the broadcast downlink for live callouts, and Battle Royale additionally
  needs location on each node. Do this last.

**Respawn stations** are cross-cutting: any tier benefits from them as sync points on a large field, and they
double as the physical respawn point for modes that don't use a player-role respawn. The phone respawn
station is built and bench-proven (2026-09-04).

## Team structure — is it only all-red vs all-blue?

No. The gun resolves friend/enemy by **team id (`$TID`)** in the IR hit, so team layout is flexible:
- **Native hardware teams: FOUR** (bench 2026-08-26). `$TID` is masked to 2 bits (effective team = `$TID & 3`),
  giving four usable teams **0, 1, 2, 3**. **Hardware friendly-fire protection works**: with `$GSET`
  `friendlyFire=0` the gun blocks same-team damage (and cross-team heals), so native teams get real on-gun FF
  — MC layers scoring/policy on top. Native teams also give per-team LED colour + `$HIR` tok4 team attribution.
- **FFA + Mission-Control logical teams (any structure):** every gun on one team, **friendly fire ON**,
  players wear armbands for their real squad, **MC tracks the true teams and scores accordingly** (David
  Knox's proven "flag" technique). Supports duos/trios/free-form instantly. Trade-offs: **no on-gun
  friendly-fire protection** (MC alone penalizes team-kills) and no per-team LED colours.

## Hard ceilings (design around these; everything else is software or a pending bench test)

1. **The gun keeps no game state** (`protocol/session-findings-2026-08.md` §7n) and BLE reaches ~1–30 m → anything needing a
   clock, score or respawn needs a listener *on the player* out on a field. This is the whole reason for
   per-player nodes (ADR-0001/0002).
2. **One BLE central holds a handful of guns** (Android caps at 7 GATT connections; a laptop radio is
   undocumented, 3 held for a synced start is the proven figure) → "one phone hosts everyone" does not scale;
   past ~4–6 guns it is a node per player.
3. **Phones have no IR** → they cannot shoot, be shot, or emit a respawn/capture tag. Phone objectives work by
   **BLE presence + the trigger, touch, or camera**; any *shoot-the-point* mechanic needs an IR station or the
   grenade. IR is line-of-sight and directional (~30 ft grenade; range scales with indoor/outdoor mode).
4. **No venue WiFi on a field and LoRa is low-bandwidth** → live *global* consensus (a field-wide scoreboard,
   instant "flag taken" everywhere) needs a broadcast downlink (Tier 2); without it modes still *run* and sync
   store-and-forward. Never a live per-hit firehose over LoRa. Community caps: LoRa domination 1 master + 9
   slaves; hosted KotH ~21 boxes; ESP-NOW ~250 ft (~581 ft with antenna); LoRa-standard ~1,373 ft
   (`reference/jay-ecosystem.md` §5).
5. **"SCREAMERS" and link flakiness** (`reference/community-notes.md`): hosted guns can buzz-fail after ~1 h and
   BLE won't re-pair below a battery threshold; establishment is ~1-in-3 flaky (holding is fine). Budget for
   reboots, keep batteries topped, never assume a session-long link.
6. **A phone with its screen on drains fast** and is fragile outdoors → mount fixed objectives with power,
   case them.
7. **The shield pool is IR-only**: granted only by a `$SIR` function-11 event, never by `$PSET`/`$LIFE`
   (P16, 2026-08-26). Over BLE alone, armor + HP are the working pools; a station with an emitter can grant
   shields.

Facts that used to be listed as pending and are now settled: per-player id over BLE (P2, 2026-08-25); four
native teams and firmware FF (P9, 2026-08-26); `$HIR` tok5 = raw magnitude, damage = `$HP` delta (P10); no
native regen (P11); `$LIFE` additive-clamped and negatives drain, `$BUMP` INERT (bench 2026-09-09); grenade Hill/Respawn beacons readable, a
hosted gun ignores the grenade's station words (2026-09-04); a dead gun still reports the trigger (2026-09-04).

## Custom / advanced modes (all buildable — host rules over the same primitives)

| Mode | Tier | Needs | How |
|---|---|---|---|
| **Standard CTF** | 1 | 2 flag bases | grab enemy flag → return to own base |
| **Assault CTF** (one-sided) | 1 | 1 flag base | attackers steal/hold, defenders protect; asymmetric spawns/roles |
| **Center-flag CTF** | 1 | 1 neutral flag + 2 bases | both teams fight for a mid flag, return to own base |
| **King of the Hill** | 1 | hill station **or the grenade as zone emitter** | hold the zone for time |
| **VIP escort (A→B)** | 1 | 1 extraction station + **VIP player role** | VIP = special low-HP loadout (General-style role); escorts protect; VIP triggers the extraction station on arrival |
| **Hostage rescue + extract** | 1 | extraction station + hostage role | hostage = neutral/downed player freed by a teammate via IR (revive-style), then escorted to the extraction station |
| **Counter-Strike (plant/defuse)** | 1 | bomb-site **stations** (a utility phone, roadmap K4), **the grenade as the bomb**, or an IR box | attacker plants (present + hold the trigger) → the site runs the plant timer; defender defuses the same way → round ends on detonate / defuse / elimination; blast = each phone in radius applies `$BHIT` to its own gun |

**Key insight:** almost all of these are the **same objective-station primitive** (presence + a local
timer/owner state) with different rules — build that node once and CS bomb-sites, hills, flags, extraction
points, and control points all fall out of it. VIP/hostage add a **special player role**, which is the same
mechanism as the General/Commander/Hive-Queen respawn characters (Tier 0 role logic). So the whole custom-mode
space reduces to: **objective-station node + player-role support + host rule modules.**

## Extraction (raid-and-extract) — a flagship mode Edge can't do

The flagship mode: raid, loot, call a **loud** extraction, survive the channel, bank it — die and you
drop everything. It is Tier 1 (one station) and it is the single mode Battle Company's Edge has nothing
like. The full design — the ARC Raiders / Fortnite-Sprites event ladder, the BRX mechanic mapping, the
tier ladder, the variants and the genre research — is [`extraction-design.md`](extraction-design.md).
The rules engine is built and sim-proven (`mcp/brx_mcp/modes/extraction.py`,
`python -m brx_mcp extraction-sim`); the station and an MC loot scorer are what remain.

## Health / regen variants (all Tier 0 — no props)

These are rule tweaks on TDM/FFA, not new infrastructure. The gun exposes the write primitives
directly: **`$LIFE,addedHP,addedArmor,addedShields`**. ⚠️ **CORRECTED 2026-09-09 (bench): `$BUMP` is INERT
on v4.32 — it does nothing in either direction. Use `$LIFE` only.** `$LIFE` is additive and clamped at max, it
self-emits `$HP`, and it also **accepts NEGATIVES and drains** (per pool, floors at 0, no spill into the next
pool) — which is what makes damage-over-time buildable at all (S16). The live test
found **no native armor regen** (armor held through 30 s idle), so any "regen" must be **host-driven** (node
watches `$HP`, refills). The shield pool is IR-only (Hard ceilings #7), so over BLE alone armor + HP are the
working pools.

| Variant | Mechanic | How (Tier 0) | Caveat |
|---|---|---|---|
| **Syphon** (Fortnite/CoD "health-on-kill") | killer regains HP on each kill | MC routes `$LIFE` to the **exact** killer's node via `apply{frames}` (`$HIR` tok3 names the shooter) | reaches the killer only while their node is in coverage (contracts A6.4) |
| **Halo shields (regen after no-damage)** | health/armor refills to full after T s without taking damage | **node-driven** — the node watches its own gun's `$HP` stream and sends **`$LIFE`** (additive, clamped; `$BUMP` is inert) once no decrease for T s. Works offline. | refills armor + HP; a station with an emitter can refill shields too |
| **Overshield / powerup pickup** | grab an item → temporary extra pool | the node grants `$LIFE` armor on the pickup (roadmap K3) | an **armor** overshield over BLE; a true shield overshield needs fn-11 from a station |
| **Medic / Lifesteal support role** | a role heals teammates | `$SIR` dual-polarity functions heal allies and damage enemies in firmware (`weapon-design.md` §6.3), or the node grants `$LIFE` | role logic like General/VIP |

> **Corroboration (FB group crawl):** native shields + medic behaviour are real on stock BRX today —
> **energy weapons grant a temporary shield when you equip a new weapon**, and the Supremacy **Medic
> class takes 4 hits to kill and heals teammates by shooting them** (also Sniper, Viper classes). So
> the overshield-on-pickup and medic variants above have a stock precedent, not just a protocol
> inference. ([shield](https://www.facebook.com/groups/712027809192113/posts/1691552727906278/),
> [medic](https://www.facebook.com/groups/712027809192113/posts/1695715454156672/))

## The grenade

The Smart Grenade's five native objective modes (Frag / Assault / Hill / Respawn / CTF), what beacons over BLE,
and its limits are documented once in `reference/grenade.md` and published in `manual/gameplay.md`
(Grenade modes). In **native** games it is a $0 single-point Hill / Respawn / Assault / CTF / bomb site; in
**hosted** (MC) games the gun ignores its station words entirely (bench 2026-09-04), so the phone station
supersedes it, and the B23 bridge (`utility-roadmap.md` §7) is how it could come back as a readable IR station.

## What each needs, in one line

- **Mission Control alone:** FFA, TDM, Survival/Infection, Swarm, Generals, Commander, Supremacy,
  Last Man Standing, the health variants.
- **+ Props (utility phones / IR stations / grenade / QR):** Domination, King of the Hill/Territory, Capture
  the Flag, Assault, Team Arena, Counter-Strike, Extraction.
- **+ Broadcast (live field-wide) / location:** Battle Royale; and any Tier-1 mode when you want live
  callouts or a live scoreboard on a large no-WiFi field.
