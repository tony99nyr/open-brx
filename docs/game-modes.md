# Game modes — catalog & infrastructure tiers

Every BRX game mode we know of, from all sources (V7 manual, Extended User Guide, the Callsign
APK harvest, and community), enumerated and classified by **what infrastructure each needs to run
at scale**. The classifying question is: *does it need only Mission Control + the per-player nodes,
or also physical props (stations/flags), or also a live field broadcast?*

Sources: `reference/brx-manual-notes.md`, `reference/brx-extended-user-guide.md`,
`callsign-extract/apk-harvest.md`. Win conditions (APK): Score, Death (elimination), Slayer (most
kills), CaptureTheFlag, SquadLeader.

> **Tier note:** these are **infrastructure tiers** (what gear a mode needs). They are a *different
> axis* from `build-tiers.md`'s **spend tiers** ($0 → phones → Companions → stations → radio). A mode's
> infrastructure tier here maps to whatever spend tier supplies that gear.
>
> **For the honest constraints** — what limits each mode *at each tier*, and which limits are hard
> ceilings vs. pending hardware tests — see **[mode-limits.md](mode-limits.md)**.

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
| **Counter-Strike (plant/defuse)** | 1 | bomb-site **stations**, **the grenade as the bomb**, or **a phone as the bomb** | attacker plants (dwell/IR, or **touch a phone's screen: enter arm code**) → the site runs the plant timer; defender defuses (via IR, or **solves an on-screen puzzle**) → round ends on detonate / defuse / elimination. The **phone-as-bomb** version (arm code + defuse puzzle on the touchscreen) needs no IR — see `phone-app-spec.md` §"Phones as screen-equipped objectives" |

**Key insight:** almost all of these are the **same objective-station primitive** (IR receiver + LED +
a local timer/owner state) with different rules — build that node once and CS bomb-sites, hills,
flags, extraction points, and control points all fall out of it. VIP/hostage add a **special player
role**, which is the same mechanism as the General/Commander/Hive-Queen respawn characters (Tier 0
role logic). So the whole custom-mode space reduces to: **objective-station node + player-role support
+ host rule modules.**

## Extraction (raid-and-extract) — a flagship mode Edge can't do

The extraction-shooter genre (Escape from Tarkov, Hunt: Showdown, CoD DMZ, The Cycle, Marathon) is the
hottest shape in shooters right now, and **it maps beautifully onto laser tag** — the signature tension
is *"channel a loud extraction while exposed and everyone converges on you,"* which is exactly what this
hardware is good at. **Battle Company's Edge has nothing like it**, so this is a marquee differentiator.

**Genre core loop:** insert with your gear → **loot** valuables (risk/reward: push deeper for better
loot vs. leave now) → reach an **extraction point** and **summon/channel** it (a timer; it's **loud and
alerts everyone**) → **survive the channel** → if you extract you **keep/bank** the loot (points +
persistent boosts); **if you die you drop it all** (others can grab it). Loss-on-death is the whole
point — it's what gives every decision real stakes. (Sources below.)

### The BRX mechanic (what maps to what)

| Genre element | BRX / Open BRX implementation |
|---|---|
| **Your carried loot** | The gun keeps no state, so the player's **node (Companion/phone) is the loot wallet.** Loot value accrues from kills, IR **loot boxes** (Jay's prototype — `reference/jay-ecosystem.md`), and objective pickups. Optional **physical loot** = a printed QR/RFID/IR "briefcase" token you actually carry — makes the drop-on-death moment tangible. |
| **Extraction point + "summon it, takes a while"** | The **KotH/hold primitive** with a channel: reach the extraction station (or **the grenade as the beacon**), **initiate** (shoot/press/dwell) → a **30–60 s channel timer** starts. Same charge-and-hold mechanic as King of the Hill, re-skinned as "extraction inbound." |
| **"It's loud" (alerts everyone)** | On channel start, the station + nearby nodes fire an **audio + LED alarm** ("Extraction inbound at Alpha!"). *Local* loudness works at **any tier** (station/gun audio); **field-wide** "everyone hears it" needs the broadcast downlink (Tier 4). This is the genre's defining risk — and it also **counters extract-camping**, since attackers get the same callout. |
| **Survive the channel** | If the extracting player is killed or leaves the zone, the channel **pauses/resets** (host rule on `$HP,0` + presence). Channel completes → loot is **banked**. |
| **"If kicked you drop your loot"** | On `$HP,0`, the victim's node **transfers its wallet out** — either to a **dropped token** at the death spot (physical/beacon) or back to the **pool / to the killer** (virtual). Pure host-side rule on the death event — Tier 0 logic. |
| **Extracted loot → points or boosts** | Banked value converts to **score** (win condition) and/or **`$WEAP`/`$LIFE` boosts** on your next life/raid — a persistent **"stash"** across rounds (the genre's meta-progression). Uses the same `$LIFE`/`$WEAP` writes as the health variants below. |

### Tiers — it scales from gear-you-own up to full field

- **Minimum ($0, gear you already own):** the **grenade is the extraction beacon** (its KotH charge already does summon + the ~3–4 s "who holds it" callout + it's loud), loot tracked by **phone nodes**, drop/bank/boost as host rules. A playable Extraction mode with **no custom hardware** — a killer free story.
- **Tier 1 (one station):** a purpose-built **extraction station** (the objective-station primitive) — cleaner channel, proper LED/alarm, multiple loot pickups. This is the sweet spot.
- **Tier 3–4 (full experience):** **multiple, optionally *hidden* extraction points** (Hunt's "Devil's Trail" hidden-extract idea), a **field-wide "extraction inbound" broadcast**, **dropped-loot beacons** you can hunt for, and a live **stash/scoreboard** — needs stations + the broadcast downlink.

### Variants

- **PvPvE (solo/small squad):** add "AI" pressure with **utility-box hostile emitters** (proximity mines / turret tags — `reference/jay-ecosystem.md`) so even a few players face environmental threat between fights.
- **Boss / bounty (Hunt-style):** a high-value **boss role** (a tanky player, General-style) or a heavily-defended station drops a **bounty token** that makes its carrier **loud/marked** — their node pulses a detectable IR/LED beacon — until they extract. Classic "kill the holder, take the prize."
- **Storm timer (BR crossover):** a closing zone (reuse the Battle Royale storm) forces the push-vs-extract decision on a clock.

### What we actually have to build

Very little that's new: Extraction is **the King-of-the-Hill station + a loot wallet in the node + three
host rules** (channel-under-fire, drop-on-death, bank→boost). The station primitive, the `$HP,0` kill
hook, and the `$LIFE`/`$WEAP` boost writes all already exist for other modes. So a **flagship,
genre-defining mode that Edge can't touch is mostly a rules module over primitives we're building
anyway** — and a $0 grenade+phones version ships first.

**Prototype (built):** a pure, transport-free rules engine lives at `mcp/brx_mcp/modes/extraction.py`
— loot wallet, loud channel, drop-on-death, dropped-loot pickup, bank→`$LIFE` boost, win target — with
tests (`mcp/tests/test_extraction.py`) and a narrated demo you can run with **no hardware**:
`python -m brx_mcp extraction-sim`. It emits `Action`s (frames/callouts/score) that a BLE driver
executes, matching the "host rules over the event stream" architecture.

**A phone can be the extraction site itself** (no IR station needed): it holds the channel state and,
on summon, plays the alarm on taggers via `$PLAY` (the guns scream) and respawns/boosts via
`$LIFE`/`$SPAWN`. At small scale (~4 guns) **one Android phone connected to all of them is the whole
site, $0**; at scale the summon is a mesh event each player-node renders on its own gun. A phone can't
do the IR "shoot the site to interact" part — that needs an IR station or the grenade. Full breakdown:
`phone-app-spec.md` §"A phone as an objective / respawn / extraction node".

*Genre research sources:* [What is an extraction shooter? (Antihero Studios)](https://antiherostudios.com/blog/what-is-an-extraction-shooter),
[Extraction shooter (Wikipedia)](https://en.wikipedia.org/wiki/Extraction_shooter),
[Why DMZ gets the formula right (The Loadout)](https://www.theloadout.com/call-of-duty-warzone-2/dmz-extraction-shooter-formula-right),
[Hunt: Showdown "Devil's Trail" (ixbt.games)](https://ixbt.games/en/news/2026/03/18/hunt-showdown-1896-prevratilas-v-escape-from-tarkov-nacalos-xardkornoe-sobytie-tropa-diavola.html).

## Health / regen variants (all Tier 0 — no props)

These are rule tweaks on TDM/FFA, not new infrastructure. The gun exposes the write primitives
directly: **`$LIFE,addedHP,addedArmor,addedShields`** (grant) and **`$BUMP,hP,armor,shields`**
(adjust current pools), and the APK confirms **shields + regeneration are native firmware concepts**
(`maxShields`, `RepairRegenTick`, `RegenHit`, `ShieldOnHeal`, `ShieldOffExpire`, `MedicHeal`,
`ActivateShield`, `energyShieldLoop`). So health mechanics need **only Mission Control + the
per-player nodes** — no stations, no broadcast.

| Variant | Mechanic | How (Tier 0) | Caveat |
|---|---|---|---|
| **Syphon** (Fortnite/CoD "health-on-kill") | killer regains HP on each kill | node watches the `$HIR`→`$HP,0` kill attribution, then sends `$LIFE`/`$BUMP` to the **killer's** gun | needs **per-player id (P2)** — you must heal the *specific* killer, and `$HIR` alone gives only the shooter **team**. Team play without P2 can't route the heal to the right teammate. |
| **Halo shields (regen after no-damage)** | shield refills to full after T s without taking damage | **two paths:** (a) *native* — set a shield regen delay/rate in the weapon profile (`$WEAP`/`$PSET`), zero host logic, since the firmware has `RepairRegenTick`/`ShieldOnHeal`; (b) *host-driven* — node watches its own gun's `$HP` stream and sends `$LIFE`/`$BUMP` to refill once no decrease for T s | no P2 needed — each node manages its own gun. Confirm whether regen delay/rate is a settable weapon field (followup) — if so, path (a) is free. |
| **Overshield / powerup pickup** | grab an item → temporary extra shields | node grants `$LIFE,0,0,<shields>` on the pickup event (IR pickup or objective) | overshield decay = host timer or native `ShieldOffExpire` |
| **Medic / Lifesteal support role** | a role heals teammates | `MedicHeal`/`ActivateShield` are native ability types; node grants `$LIFE` to the healed gun | role logic like General/VIP |

**Bottom line:** syphon, Halo-style regenerating shields, overshield pickups, and medic roles are all
**Tier 0** — they ride the `$LIFE`/`$BUMP` writes + native shield/regen support over the existing
event stream. Syphon is the only one that wants **P2** (to credit the exact killer); the rest work
per-node today.

> **Corroboration (FB group crawl):** native shields + medic behaviour are real on stock BRX today —
> **energy weapons grant a temporary shield when you equip a new weapon**, and the Supremacy **Medic
> class takes 4 hits to kill and heals teammates by shooting them** (also Sniper, Viper classes). So
> the overshield-on-pickup and medic variants above have a stock precedent, not just a protocol
> inference. ([shield](https://www.facebook.com/groups/712027809192113/posts/1691552727906278/),
> [medic](https://www.facebook.com/groups/712027809192113/posts/1695715454156672/))

## How much can the GRENADE do without a custom station?

The Smart Grenade is a paired IR accessory (`$GREN`: iRType, operationMode, **channel**, GrenadeType
= FlashBang/Gas/Confusion/Molotov, **MaxCount**) that emits an area IR "explosion" (~30 ft) and can
be **placed** (not just thrown). Grenades are hardware you already buy, so any mode they cover is
**props-free** (no custom station to build). Caveat: **mostly untested** — we've never driven a
grenade (followups F/G); the CTF-base capability below is community-reported, the rest is inference
from `$GREN` + the emitter behaviour.

**The grenade reportedly does Assault, CTF, and King of the Hill (no station) — config is the problem.**
See `reference/grenade.md` for the full grenade manual (modes, programming, mechanics). *(Community-reported; we've decoded the `GrenadeType` enum — FlashBang/Gas/Confusion/Molotov — but the
Assault/CTF/KotH ↔ `operationMode` mapping is unverified by us; followups F/G.)*
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
