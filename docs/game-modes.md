# Game modes — catalog & infrastructure tiers

Every BRX game mode we know of, from all sources (V7 manual, Extended User Guide, the Callsign
APK harvest, and community), enumerated and classified by **what infrastructure each needs to run
at scale**. The classifying question is: *does it need only Mission Control + the per-player nodes,
or also physical props (stations/flags), or also a live field broadcast?*

Sources: `reference/brx-manual-notes.md`, `reference/brx-extended-user-guide.md`,
`callsign-extract/apk-harvest.md`. Win conditions (APK): Score, Death (elimination), Slayer (most
kills), CaptureTheFlag, SquadLeader.

## The three infrastructure tiers

- **Tier 0 — Mission Control alone.** Taggers + a host/per-player nodes. Scoring comes from the
  `$HIR`/`$HP` event stream (who hit whom, who died). No field props, no broadcast. Works today in
  BLE range (`arena`/`deathmatch` already do TDM/FFA); on a field, each player just needs a node
  (Companion/phone) running the engine, results sync via store-and-forward.
- **Tier 1 — + props.** Adds **fixed objective stations** (control points, flag bases, respawn
  points — the JBOX/QR model). The mode centres on *contested locations*, so those locations need a
  local authority. Playable without any field radio: stations are self-authoritative (LED/sound show
  truth locally) + end-of-game log collection + near-live via respawn-mule sync
  (`field-architecture.md`).
- **Tier 2 — + broadcast.** Adds a **live field-wide downlink** ("flag taken", zone shrinking, live
  scoreboard) for the full experience on a large no-WiFi field. Only needed when live global
  awareness matters; the Tier-1 modes still *function* without it.

## Catalog

| Mode | Source | Core mechanic | Scoring / win | Tier | Props | Broadcast | Notes |
|---|---|---|---|---|---|---|---|
| **Free For All** | manual, EUG, APK | everyone vs everyone, friendly fire on | most kills (Slayer) / K-D | **0** | – | – | needs **per-player id (P2)** for individual scoring; team-based fallback otherwise |
| **Team Death Match** | manual, EUG, APK | two teams, weapons + perks | team kills / Death | **0** | – | – | works today — `$HIR` gives shooter **team** (no P2 needed) |
| **Survival / Infection** | manual, EUG, APK | humans vs infected; a kill converts a human | last human / infection spread | **0** | – | – | host/node flips a killed human to the infected team on `$HP,0` |
| **The Swarm** | EUG, APK | infection, but a **Hive Queen** is the infected respawn point | last human | **0** | – | – | respawn point is a **player role**, not a prop (revive at the Queen via trigger/IR) |
| **Generals** | EUG, APK | TDM where a **General** is the team's mobile respawn point | eliminate the General / kills | **0** | – | – | respawn = seek the General, pull trigger (local IR); node enforces the role |
| **Commander** | EUG, APK (GOTDLC) | Faction wars + a **Commander** respawn character | seek-and-destroy the Commander | **0** | – | – | same as Generals, faction flavour |
| **Supremacy** | manual, EUG, APK | 3 factions (Nexus/Resistance/Vanguard), class-based | score / control | **0** | – | – | class abilities are `$WEAP`/`$PSET` loadouts; no props for base Supremacy |
| **Last Man Standing** | APK | elimination, limited lives | last alive | **0** | – | – | nodes track lives; no props |
| **Domination** | APK | hold **control points** for score-over-time | most point-time / Score | **1** | control-point stations | optional (live board) | points self-authoritative (LED = owner); `DominationBoxes` in APK |
| **King of the Hill / Territory** | APK (`Territory`) | hold a **zone** | time held | **1** | zone/hill station | optional | one contested point; same as domination with 1 point |
| **Capture the Flag** | APK, Callsign Team Arena | grab enemy **flag**, return to base | captures / CaptureTheFlag win | **1** | flag bases (+ flag object / QR) | **wanted** ("flag taken!") | Callsign uses QR flags; win-condition class exists |
| **Assault** | APK | attack/defend **objectives** in sequence | objectives armed/held | **1** | objective stations | optional | attackers arm points, defenders hold |
| **Team Arena** (Callsign) | APK, EUG | TDM + **QR weapon pickups** + capturable flags | kills + captures | **1** | QR codes (pickups/flags) | optional | QR = cheap props; weapon pickup = `$WEAP` push |
| **Battle Royale** | APK, EUG | shrinking play area, **GPS weapon/supply drops**, last alive | last standing | **2** | drop points (GPS) | **required** | needs per-node **location** + live zone/drop broadcast — the most infra-heavy |

## How to read it for building

- **Tier 0 is the MVP** and is essentially built (`arena`/`deathmatch`): TDM works now; FFA/Slayer
  need per-player identity (**followup P2**, set `PlayerID` via `SETUP`); infection/Generals/
  Commander/Swarm are host-side rule modules over the same event stream + a designated player role.
- **Tier 1 unlocks the objective modes** — build the **objective-station** node (IR receiver + LED
  ring, self-authoritative, JBOX-style; QR codes are the zero-cost alternative). Each of Domination/
  KotH/CTF/Assault is the same station primitive with different rules.
- **Tier 2 is the polish** — the broadcast downlink (`field-architecture.md`) for live callouts, and
  Battle Royale additionally needs location on each node. Do this last.

**Respawn stations** (`field-architecture.md`) are cross-cutting: any tier benefits from them as
data-mule sync points on a large field, and they double as the physical respawn point for modes that
don't use a player-role respawn.

## Team structure — is it only all-red vs all-blue?

No. The gun resolves friend/enemy by **team id (`$TID`)** in the IR hit, so team layout is flexible:
- **Native hardware teams:** confirmed 2 (TDM) + 3 factions (Supremacy); **max native team count is
  UNTESTED** (followup — see below). If the firmware allows N teams, you get N small teams (e.g.
  duos) with hardware friendly-fire protection.
- **FFA + Mission-Control logical teams (works today, any structure):** every gun on one team,
  **friendly fire ON**, players wear armbands/flags for their real squad, **MC tracks the true teams
  and scores accordingly** (David Knox's proven "flag" technique). Supports duos/trios/free-form
  instantly; the only cost is no hardware friendly-fire protection (MC penalizes team-kills).

## Custom / advanced modes (all buildable — host rules over the same primitives)

| Mode | Tier | Needs | How |
|---|---|---|---|
| **Standard CTF** | 1 | 2 flag bases | grab enemy flag → return to own base |
| **Assault CTF** (one-sided) | 1 | 1 flag base | attackers steal/hold, defenders protect; asymmetric spawns/roles |
| **Center-flag CTF** | 1 | 1 neutral flag + 2 bases | both teams fight for a mid flag, return to own base |
| **King of the Hill** | 1 | hill station **or the grenade as zone emitter** | hold the zone for time |
| **VIP escort (A→B)** | 1 | 1 extraction station + **VIP player role** | VIP = special low-HP loadout (General-style role); escorts protect; VIP triggers the extraction station on arrival |
| **Hostage rescue + extract** | 1 | extraction station + hostage role | hostage = neutral/downed player freed by a teammate via IR (revive-style), then escorted to the extraction station |
| **Counter-Strike (plant/defuse)** | 1 | **several bomb-site stations** (or the grenade as the bomb) | attacker plants (dwell/IR at a site) → **station runs the plant timer locally**; defender defuses via IR; round ends on detonate / defuse / elimination |

**Key insight:** almost all of these are the **same objective-station primitive** (IR receiver + LED +
a local timer/owner state) with different rules — build that node once and CS bomb-sites, hills,
flags, extraction points, and control points all fall out of it. VIP/hostage add a **special player
role**, which is the same mechanism as the General/Commander/Hive-Queen respawn characters (Tier 0
role logic). So the whole custom-mode space reduces to: **objective-station node + player-role support
+ host rule modules.**

## How much can the GRENADE do without a custom station?

The Smart Grenade is a paired IR accessory (`$GREN`: iRType, operationMode, **channel**, GrenadeType
= FlashBang/Gas/Confusion/Molotov, **MaxCount**) that emits an area IR "explosion" (~30 ft) and can
be **placed** (not just thrown). Grenades are hardware you already buy, so any mode they cover is
**props-free** (no custom station to build). Caveat: **mostly untested** — we've never driven a
grenade (followups F/G); the CTF-base capability below is community-reported, the rest is inference
from `$GREN` + the emitter behaviour.

**The grenade natively does Assault, CTF, and King of the Hill (no station) — config is the problem.**
Per the owner community, the grenade firmware has **Assault, Capture the Flag, and King of the Hill**
built in; the pain is the on-gun configuration ("super hard to configure"), and CTF-base is confirmed
(the tagger plays CTF flag music). So these three objective modes need **zero custom hardware** — just
grenades you already own.
- **The free unlock → a grenade config + state app** (phone/web, owned gear only):
  - **Config:** send the `$GREN` setup over BLE (mode = Assault/CTF/KotH, channel, options) from a
    clean UI — replaces the buggy on-gun menu. Makes the existing modes usable. (Followup F: nail the
    exact `$GREN` per mode.)
  - **State display:** read objective events from the **gun's BLE stream** (the gun knows the state)
    and render a live objective screen (flag held / point owner / KotH timer). If the grenade is
    BLE-visible itself (followup G2), even more direct.
  - `channel` + `MaxCount` hint **multiple grenades = multiple objectives** — your 2 grenades = 2
    flags / 2 hills / 2 assault points.
- **Counter-Strike plant/defuse** — the **grenade IS the bomb**: place + arm (its detonation timer),
  defenders defuse in the window. 2 grenades = 2 bomb sites.
- **Hazard / area-denial zones** — Gas / Molotov / Confusion modes make a placed grenade a damage/
  effect zone. Native behaviour.
- **Status:** the modes exist in firmware; what's **untested by us** is the exact `$GREN` config
  sequence and what objective state the gun exposes over BLE (followups F/G) — both free to work out.

**Still wants a purpose-built station:**
- **Domination** with several points, **live per-team ownership + time-scoring + LED-ring feedback** —
  the grenade has no ownership display or persistent scoreboard role.
- **Respawn stations** — respawn authorization + data-mule sync + (optional) status screen. Not a
  grenade job.
- Anything needing **local status display** (grenade has no LED ring / screen).

**Bottom line:** grenades can plausibly cover **CTF, Counter-Strike (bomb), hazard zones, and maybe
KotH/Assault with zero custom hardware** — pending a hardware test of the grenade's objective
behaviour (F/G). **Domination-with-scoreboard and respawn/sync still want purpose-built stations.**
So the cheapest path to the objective modes is: **test what the grenade already does before building
stations.**

## What each needs, in one line

- **Mission Control alone:** FFA, TDM, Survival/Infection, Swarm, Generals, Commander, Supremacy,
  Last Man Standing.
- **+ Props (stations/flags/QR):** Domination, King of the Hill/Territory, Capture the Flag,
  Assault, Team Arena.
- **+ Broadcast (live field-wide) / location:** Battle Royale; and any Tier-1 mode when you want live
  callouts or a live scoreboard on a large no-WiFi field.
