# Utility items: the implementation plan

The utility role turns a spare phone into an item on the field. This is the **order of work** for everything
the utility path still owes, written so any session can pick up a row and know what to build, on which
surface, and what proves it. It carries no status: what is built, what is open and what is next live in
[`FOLLOWUPS.md`](FOLLOWUPS.md) and [`HANDOFF.md`](HANDOFF.md).

The spec of record stays [`spec/utility.md`](spec/utility.md) (advert format, presence, the respawn rule, MC
arming, the control point); mode rules stay [`game-modes.md`](game-modes.md); the frame compiler and the MC
mode catalog are [`spec/modes.md`](spec/modes.md). **If a row here disagrees with the spec, the spec wins.**
§7 is the grenade-as-control-point evidence the hill design rests on; §8 holds two designs that are specified
in full but not built.

## 0. Principles every row obeys

- **Same app, one role at a time.** `brx.role` = `hud` | `utility`. No third app to install or keep in step.
- **Adverts are the wire between phones.** A station advertises its 16-byte identity + state; player phones
  advertise id / team / alive / intent bits. Nobody connects to anybody; any number of phones read the air.
- **Presence = smoothed RSSI against the station's own advertised threshold**, with dwell and hysteresis
  (`beacon.js Presence`). Bench-tuned default -74 dBm / 0.8 s at high TX ≈ 10 ft.
- **Stations are self-authoritative and MC is not live mid-match.** A station decides its own state from the
  adverts it hears; player phones decide their own actions from the station adverts they hear; both report
  facts at recap. Two phones can disagree for a moment and reconcile later; nothing waits on the laptop.
- **Setup needs Wi-Fi, play does not.** MC arms a phone at muster (`station_config`); after that a station is
  a passive beacon. Placement happens BEFORE start, never inside the countdown. Stations do not walk back
  between games unless their role changes.
- **Anti-cheat by construction.** A station's screen is a status display; its controls sit behind seven taps
  on the ⓘ; MC arming is the primary lock. Player phones enforce `config.stations` (the allow-list) so a stray
  phone cannot revive, plant or score.
- **The station never touches a gun.** It reads adverts and shows state; the player's own node writes to the
  player's own gun. The exception is the bomb's blast, which every player node applies to its own gun.

## 1. Cross-cutting work first

These unblock every kind and are cheap relative to the kinds themselves. Row ids are permanent — other
documents cite them.

**A · The arming loop (MC ↔ station)** — MC server + console, plus the phone half.

| id | what | surface |
|---|---|---|
| A1 | `station_config` push over M-NET (`{kind, team, id, threshold?, game?, valid_ids?}`); accept `hello node_type "utility"` with no gun, never bind. Both sides need the kind in their table | MC + `utility.js` |
| A2 | ITEMS panel at muster: one row per utility phone from its heartbeat (kind, team, id, threshold, live, revives, armed, battery, last seen, app version); assign + ARM; assignments kept per session | MC UI |
| A3 | Battery + app version in the utility heartbeat | `utility.js` |
| A4 | Attention flags on the row: bring back to re-arm · battery low · not seen since last match · app behind | MC UI |
| A5 | `config.stations` from the compiler = the ids MC armed this game; the utility phone displays `valid_ids` | compiler + `utility.js` |
| A6 | Recap stations row: revives per station from player facts vs the station's own count; ✓ when they agree, ⚠ when the station was never heard | MC scoring + recap UI |

**B · Radio hardening.**

| id | what | done when |
|---|---|---|
| B1 | Station scan starvation while advertising | a 10-minute two-phone soak where the player list never empties while a player phone stands there |
| B2 | Android opportunistic-scan demotion: restart the HUD's beacon scan every 25 min | soak |
| B3 | iOS: build `BrxBeaconPlugin.swift` on the MacBook, verify advertise + scan | an iPhone station revives a Pixel |
| B4 | RSSI-vs-distance at each TX level, phone-to-phone; per-kind default thresholds (a zone is bigger than a respawn point) | a table in `spec/utility.md` §3 |

**C · Match scoping.**

| id | what | done when |
|---|---|---|
| C1 | `game` byte from `station_config`; MC bumps it per match and re-arms every station | an edit at muster stays the same game; a station that missed the push gets it on its next hello |
| C2 | Player phones filter presence by the bundle's game byte (`Presence` already supports `game`) | engine test |

## 2. The kinds, in build order

Each kind = a station state machine (what it advertises in `state`/`value`), a player-node rule
(engine + HUD copy), an MC mode/scoring, tests, and a bench gate. The order is by (game value × how
much of the respawn primitive it reuses). **The rules live in `spec/utility.md` §5; what follows is the
work.**

### K1 · Control point → Territories, Domination and King of the Hill (first)

**➡ The rule is now specified: `docs/spec/utility.md` §5d** (Tony's design, 2026-09-10) — capture rate is the
**net difference between the leading team and its largest single rival** (2v1 counts as the 1; 2v0 goes twice
as fast; 2v1v1 still converts, slowly; a tie for the lead nets zero), a
**two-phase conversion** (drain an enemy point to neutral, then build it for the claimant, on one 0-100 scale in
advert byte 11), an **animated** station screen that shows which way the point is going and who is contributing,
per-team gun callouts (`VB0N` captured / `VB0P` lost / `VB0O` contested / `U100` tick) played **by each player
phone off the station's own advert, with no LAN**, and progress persisted on the station, which stays
self-authoritative and reports at recap. The opt-in LAN-coupled variant (points-to-win, roaming hills) is in §8 below
and is a deliberate exception to A4.8. The rows below are the surfaces; the spec wins on the rule.
Build items: **F94** (§5d), **F95** (roaming hills, §8 below) and **F98** (Territories, §8 below).

**Territories (§8 below, F98) is the strongest case for building this row**, and it needs nothing beyond §5d: several
points, each scoring for its owner **whether or not anyone stands on it**, win on the total. It kills camping by
construction (owning a point you already hold earns nothing extra, so the play is always to go take another — no
decay rule, no bonus, no multiplier to tune), and because each station keeps its own books and reports at recap it
needs **no LAN at all**, which shrank the A4.8 exception to roaming hills alone. It also cannot be done on
grenades: a grenade holds its owner unattended fine, but ownership travels only over IR and only a gun hears IR
(F92), so an unwatched grenade point has no scorekeeper.

**The grenade is complementary, not a substitute.** The shortcut below is real for a single hill, and it does not
replace the phone point: a grenade gives **shoot-to-capture and physical feedback** that a phone cannot, and a
phone gives **a head count** that a grenade cannot. The grenade's charge mechanic counts the **magnitude fired
into it**, so one shotgun shell can outweigh four rifle rounds and a lone player with the right weapon out-caps
two with the wrong one — it can never say *how many living players of each team are standing here*, which is
exactly what §5d's rule is made of. And **F88**: a grenade beacon carries **no station id**, so two grenades in
range are indistinguishable on the wire. **So multi-point Domination needs phones** (advert bytes 6-7 are the
station id), and **F92** is why the two sources cannot be coupled into one point: a grenade's ownership travels
only over IR, a station has no gun to hear it, and a mid-match relay through MC contradicts §5c. Run them as
separate objectives, or run the phone point.

| surface | work |
|---|---|
| station (`utility.js`) | state machine per **spec §5d.3** (this row's older sketch is superseded where they differ): `team` = owner tid (255 neutral) · `value` = progress 0-100 **always** (hold time is node-side, never in the advert) · `state` carries phase / `toward` / contested · byte 15 carries the signed net rate. Inputs: player adverts (team, alive) present at the station. Rule: **net difference** of living present players sets the rate (§5d.1 — leader minus the **largest single other team**: 2v1 = the 1, 2v0 = double, 2v1v1 = 1, a tie for the lead = no movement, empty = the owner holds and keeps scoring). ⚠ **Not a contested freeze** — the older wording here said "mixed → frozen" and that is explicitly not the design. Screen: **animated** per §5d.4 (owner colour, two-toned progress bar, direction arrow + rate, CONTESTED band, the roster marked counts / does not count, transition flashes). Tally per team persisted (§5d.6) for recap. |
| player node (`engine.js`) | `state().objective` = the nearest control station `{id, owner, progress, contested, mine}`; facts `capture` (station, team) when the owner flips while this player is present. No gun writes. |
| HUD (`hud.js`) | a live-screen OBJECTIVE line: HOLD THE HILL · 32 s / CONTESTED / LOST — reuses the alert banner (`point_captured`, `hill_captured` already exist) and the DOWN recap's "race to the cap". |
| MC | modes `hill` (win: hold total ≥ N s or most hold time at time-limit), `domination` (points per second, cap) and **`territories`** (§5f: several points, each scoring for its owner unattended, **linear in the count** — Tony's decision, no multiplier and no majority threshold — win on the total summed from the stations' own tallies at recap); the ITEMS panel arms kind `control`; scoring from `capture` facts + the station's tally at recap. Alerts `point_captured` / `hill_captured` / `lead_taken` already wired in A11. |
| tests | engine: owner flips, **net-difference arithmetic (1v0 · 2v0 · 2v1 · 1v1 · 2v1v1 · 2v2v1 · 3v2v1 — the multi-team cases are the only ones that distinguish largest-single-rival from summing the others)**, the two-phase drain-then-build crossing, dead players don't count, allow-list, one callout per transition (never per advert). screens: an OBJECTIVE line stage. utility: a fake-player script drives the state machine in the harness. |
| bench gate | two phones + two guns: capture, contest, recapture; hold timer matches a stopwatch within 1 s. |
| needs | B1 (the station must hear player adverts reliably) — this is the first kind that depends on it, and §5d's whole rule is a head count of player adverts. §5e additionally needs A1/A2 (MC arming + the ITEMS panel) for its setup warnings. |

### K2 · Extraction zone

A player carrying loot who is present at the zone channels for `channel_s`; leaving resets; dying drops the
loot. The rule is `spec/utility.md` §5. What is left to build: the station state machine (idle / channelling /
extracted / failed, seconds left in `value`, the alarm on its own speaker), an `extracting` intent bit and
`state().objective` on the node, the CHANNELLING bar on the HUD, and the station as the zone source in MC's
extraction mode (today the zone is a phone/host). The loot wallet already lives in
`mcp/brx_mcp/modes/extraction.py`; the node needs it mirrored or MC pushes `loot` in `score`.
**Bench gate:** one phone channels, walks out, walks back; a second gun kills mid-channel → failed + loot
dropped. **Needs:** K1's presence plumbing, B1.

### K3 · Powerup

A present player takes the powerup (armour / HP grant, ammo refill, or weapon swap); the station goes depleted
for a cooldown. The rule is `spec/utility.md` §5. What is left to build: the ready/depleted state machine with
the payload code in `value` and the taker marked so the same player cannot re-take before cooldown; the node's
write to its own gun from the bundle's `powerups[]` frames plus a `pickup` fact; AMMO and WEAPON variants of
the existing GAIN moment; `bundle.powerups` in the compiler.
**Bench gate:** take an armour powerup and read the pool in the `$LCD` echo; take a weapon swap and fire the
new weapon. **Needs:** nothing beyond the respawn primitive. Shields stay IR-only (fn-11) and are out of scope.

### K4 · Bomb site (last: the most moving parts)

An attacker present with the `planting` intent for `plant_s` plants; the site counts down `fuse_s`; a defender
present with `defusing` for `defuse_s` defuses; on detonation every player phone within blast radius applies
host-inflicted damage to its own gun. The rule is `spec/utility.md` §5. What is left to build: the four-state
station with the fuse in `value` and the beeps on its speaker; intent reading (present + trigger held, the
respawn gesture); the blast write on the node; and the round-based `cs` mode in MC (win by detonate / defuse /
elimination, sides swap). The alerts already exist.
**Bench gate:** plant with one phone, defuse with another, let one detonate and read the `$HP` drop on a gun in
radius against a gun outside it. **Needs:** K1 presence, B1, and **a decision on blast damage** (proposal: 45 HP
— a kill — inside the threshold, half out to threshold −10 dB).

### K5 · Flag base (later; a new kind id)

CTF needs `kind 6 flag` (grab by presence + trigger, carry = a player intent bit, return = present at own
base) and a player-advert `carrying` bit. Designed in `game-modes.md`; not in the advert table yet. Do it
after K1–K4 prove the intent-bit path.

## 3. Shared player-side surfaces (build once, in K1)

- `state().objective` on the engine: the nearest relevant station for the current mode with its state,
  progress and whether it is ours. One shape for hill / zone / site / powerup.
- A live-screen OBJECTIVE line under the clock: mode-specific copy, progress bar, colour by ownership.
- The DOWN recap already shows the race; add the objective state (HILL: BLUE 30 s · BOMB PLANTED 22 s).
- Intents: present + trigger held (plant/defuse/extract/take), the same gesture the respawn taught; the
  player advert's intent bits follow the engine state.
- Alerts: `point_captured`, `hill_captured`, `bomb_*`, `extraction_*`, `lead_taken` are already rendered.

## 4. Bench gates, in order

1. **S6** (station hears players reliably) — nothing objective works without it.
2. RSSI-vs-distance per TX level; per-kind thresholds (B4).
3. K1 capture / contest / recapture with a stopwatch.
4. K3 grants land on the gun (`$LCD` echo).
5. K2 channel + loot drop.
6. K4 plant / defuse / blast radius.
7. iOS station (B3) once a Mac is at hand.

## 5. Ownership

| who | rows |
|---|---|
| **brx-grenade** (spec, plugin, radio) | spec updates for each kind (`utility.md` §5 → real sections), B1–B3, station state machines' spec text, S7 |
| **brx** (MC server + console) | A1, A2, A4, A5 (compiler), A6, C1, the `hill` / `domination` / `cs` modes and scoring, E1-E2 (FOLLOWUPS §2) |
| **brx-hud** (phones) | A3, A5 (phone), C2, every `utility.js` state machine and screen, every engine rule + HUD copy per kind, harness stages and screen-truth steps |
| **Tony** | bench gates (§4), thresholds, the blast-damage decision, which kind after K1 |

## 6. Rough size

K1 is about a day across the three surfaces once A1/A2 exist (the presence primitive is done). K3 half a day.
K2 a day (loot mirroring is the tricky part). K4 a day and a half plus its bench. A1–A6 a day for the MC side.
B1 is an hour of code and an evening of soak. Total: about a week of sessions, with K1 playable first.

## 7. The grenade as a control point: what the bench established

The hill design in `spec/utility.md` §5d rests on these measurements. Keep them together: several are
retractions of things that were believed and are not true.

### The grenade shortcut to K1

**A grenade is already a working control point, and two small changes make a hosted game read it** (a `$SIR` row, and stopping the phone discarding protocol 15). K1 was
scoped as building a station; for Hill and Respawn the hardware exists and the protocol is decoded:

| what K1 needs | the grenade already does it |
|---|---|
| a capturable point | shoot it to claim; **neutral is team 2**, then the beacon carries the owner |
| possession broadcast | `proto=15 team=<owner> mag=8` every ~5 s (respawn: `mag=6`, ~2.5 s) |
| the node knowing | **`$SIR,15,0,,28,0,0,1,,*`** → `$HIR,<sensor>,15,0,<owner>,8,0,0`, no pool change and **no player feedback at all** (F73). Both halves have SHIPPED: the compiler emits the row for every objective mode (`_OBJECTIVE_SIR_ROW`, guarded by F79) and the phone parses the beacon (F72, closed 2026-09-10). ⚠ **fn 28, not fn 24** — 24 proved the mechanism first and makes the gun flash, buzz and play a long clip on every beacon |
| holder feedback | the firmware already loops a tick on the owner's gun |
| punishing intruders | the hill emits an ordinary `proto=0 mag=8` damage word (see the hazard below) |

**So K1's station hardware is optional for Hill/Respawn.** What remains is node work — read the beacon, track
the owner, score possession — plus an MC catalog entry and scorer, which K1 needed anyway. That is a materially
shorter path to the first playable objective mode than building a station first.

**The "$30 grenade" that used to open this section was WRONG, by about 7x.** Tony, who bought it, 2026-09-10:
*"pretty sure i paid $200 for the grenade from BC."* That is a first-hand purchase report and it inverts the
argument: a grenade is the **expensive** way to get a control point, not the cheap one, and what the money buys is
shoot-to-capture plus native-game compatibility, not capability. A second-hand Android phone is a small fraction of
that and you can run several. Quote it as **what was paid** ("about $200 when we bought ours"), never as a current
price.

📖 **The reader-facing grenade-vs-phone comparison now lives in the manual**: `docs/manual/gameplay.md` "Control
points: the grenade or a phone" (2026-09-10), phone column marked designed-not-built, and it carries the price
above. Keep it in step when K1 lands or F91/F82 resolve.

**Three constraints the bench found, which any design here must respect:**
1. **The damage word lands in hosted games TODAY** (F69). Protocol 0 is our standard damage row, so a hill
   chips and kills players while MC cannot say why. Ship the protocol-15 row so the node can name it, or
   document the hazard loudly, before anyone takes a grenade to a match.
2. **The row is SILENT, and that took choosing the right function.** fn **24** — the one this mechanism was
   first proved with — makes the gun acknowledge every beacon with a vibration, a headset flash and a long
   grenade-ish clip, for as long as anyone stands on the point: unbearable within a minute. fn **28** registers
   with nothing at all, and **ignores the row's `<soundID>` outright** (rung Y), so a gun-native beacon cue is
   not available and all hill audio is node work. That is what ships (F73).
3. **Any weapon can capture, and the contest tunes itself** (F70, settled 2026-09-10). It is CHARGE, not a
   special emission, so a rifleman plays the objective and no weapon needs special tokens. **That much is
   multiply-sourced** — the bench run, `reference/grenade.md`'s prior hardware-confirmed charge mechanic, and
   Tony's own native play, which a three-weapon mechanism could never explain.

   ⚠ **The EXCHANGE RATE is where the design must not get ahead of the bench.** "1:1 and linear" rests on
   **two points** (seeded 1 → retaken with 1; seeded 5 → retaken with 5), and two points define a line by
   construction rather than by measurement. "The currency is MAGNITUDE" rests on **one** discriminating trial
   (one shotgun shell at 70 retook a hill holding five AR rounds at 45). The logic of that trial is sound — a
   rounds model predicts it should have failed — but **F76 records a standing contradiction**: this page's own
   `reference/grenade.md`, equally hardware-confirmed, makes the shotgun the SLOWEST capturer where magnitude
   makes it among the fastest. **So the shape is settled and the rate is not.** Design the mode on "any weapon
   captures"; do NOT yet build economy or scoring that assumes capture power equals damage, and do not assume
   linearity beyond the two points measured. Max charge is also unmeasured (rung M).

### How a hosted hill actually works

**What the node gets.** With the `$SIR` proto-15 row and the phone-side parse (both shipped, F72/F79), every node in range receives
`$HIR,<sensor>,15,0,<owner>,8,0,0` about every 5 s. One frame, two facts: **who owns the point**, and **that
this player is near it**.

**NEVER ASSIGN TEAM 2 IN A HILL MODE.** A neutral hill broadcasts **team 2** (F70), and the firmware's
polarity gate compares that against the receiving gun's own `$TID`. So a roster that actually contains team 2
reads every NEUTRAL hill as *its own team's*: under an enemy-only row those players go **deaf to neutral
points** entirely, and the `proto=0` damage word — the enemy-only one that punishes intruders — **cannot land
on them**, handing team 2 free run of any uncaptured point. This falls straight out of "neutral is team 2" and
nothing anywhere said it. **MC now refuses it at three layers and this paragraph is the WHY, not open work,
answered (F82, archive)**
(**F82**): `mc/state.py`'s validate rejects a hill config containing tid 2 at all, `DominationEngine.add_player`
rejects the player, and `assign_teams` defaults domination/koth to 1/3 — one `NEUTRAL_TEAM` constant imported
from `modes/hillbeacon.py` drives all three. ⚠ What is still open in F82 is the **measurement**: the consequence
above is predicted from two measured facts and has never been observed on hardware.

**Presence is a heartbeat, and timing is node-side.** Beacons arriving = in range; beacons stopping = gone. The
node runs its own clock, accumulates "seconds in range while my team owned it", and reports totals to MC when it
has coverage — so possession scoring **works offline**, which matches the node-is-the-engine architecture.
Ownership scoring does not even need presence: any node in range can report "owned by team X at time T", so MC
can build the ownership timeline from whoever is nearby.

**Three limits to design around:**
1. **Granularity is one beacon period (~5 s).** Entry and exit cannot be resolved finer, so a player dipping in
   and out carries ±5 s. Fine for a hold timer, not for anything needing precise moments.
2. **The hill's beacon RANGE is known only by estimate** (rung R, 2026-09-10 evening): solid at desk range,
   zero misses across 20+ consecutive 5.0 s reads; **intermittent by ~30 ft**, with 85 s and 145 s dropouts.
   Further than the respawn station's documented ~18-20 ft. That number IS the physical size of the objective,
   and it is still one operator estimate with no tape measure and an uncontrolled aim variable, so a proper
   measurement is worth having before a mode ships. **Design consequence already taken:** presence expires on
   ≥ 2 missed beacons (~12 s), never one.
3. **A node knows only about itself.** The beacon cannot say an enemy is also standing there, so "contested"
   exists only once MC has several nodes' reports: best-effort, and possibly late.

**What we control on the gun, and what we do not.** Ours: whether the beacon reports at all (the row exists),
what it does (the function), and what it sounds like (the row's `<soundID>`, which REPLACES the `$PSET` pool
sound). **Not ours:** the ~5 s beacon rate, and the fact that a *registered* hit drags a **headset flash and
vibration** with it — the firmware's response to any registered IR event. Tony, standing in a hill with an fn-24
row loaded: flash, hit sound and buzz every 5 s, **and it queues** (acknowledgements kept arriving after the
grenade was switched off).

**Answered (F73, archive): `$SIR` fn 28 registers with ZERO player feedback** — no sound, no headset flash, no
vibration — so a node can read a hill beacon every ~5 s and the player perceives nothing. **That is the row to
ship on protocol 15**, and it removes the "a control point buzzes at you" objection entirely (F73).
**One `$GSET` bit decides how much the node can see.** fn 28 is **enemy-only** with FF off, so you hear only
hills you do NOT own — cheap, but "no beacon" is then ambiguous between out-of-range and we-own-it, and you miss
your own captures. With **FF on** every beacon and capture registers and the owner arrives in `$HIR` token 4, so
the node has complete information; the cost is same-team IR registering elsewhere. **KotH wants FF on.**
**The U11′ sweep that used to sit here is mostly answered** (F73, 2026-09-10): enemy 8, 24, 25, 26, 27 and 28
were swept and characterised — fn 8 is silent but still flashes and buzzes, 24-27 fire one long grenade-ish
clip, and **only fn 28 gives the player nothing**. Still unswept, and kept only as the fallback if fn 28 turns
out to have a side effect nobody has looked for: enemy **35** and the ally side **31 / 32 / 34**
(`bench-queue-2026-09-09.md` D6). **Polarity is a mode-level decision, and it is made: KotH runs FF on.** With
`$GSET` t1 = 0 a gun registers only hills it does NOT own, so a holder cannot see their own point; t1 = 1 lifts
the gate and the owner arrives in `$HIR` token 4.

### The four native hill callouts, and whether a hosted game can reproduce them

Tony's description of native play: a ticking timer while you hold it; silence when the other team holds it and
you step in; "control point contested" when you shoot an enemy-held point without taking it; and a callout when
it changes hands. Mapped against what the wire actually carries:

| native behaviour | hosted? | how |
|---|---|---|
| ticking while YOU hold it | direct | beacon owner == my team → node plays a tick; the ~5 s beacon is a ready-made cadence |
| silence while THEY hold it | direct | beacon owner != my team → play nothing; purely a node decision |
| "hill lost" on a switch | direct | the `mag=50` capture word carries the NEW owner |
| **"control point contested"** | ⚠️ **inferred, no signal exists** | node reasons: *I fired* (`$ALCD` decrement) + *enemy hill in range* + *no capture word followed* |

**A non-capturing hit produces NO DECODABLE WORD** — checked across four runs where a hill was shot and did not
change hands (single rounds into a 45-charge hill, and a shotgun shell): the only protocol-15 traffic decoded is
the ordinary `mag=8` beacon. So the grenade appears to announce CAPTURES, not HITS.
⚠️ **This null has a known blind spot and is NOT "nothing".** The same session established that the grenade
replies essentially instantaneously, inside the SHOOTER's burst — which is precisely where a hit-acknowledgement
word would live, and *"any word that only occurs inside a shot's burst has been invisible to every capture ever
taken"*. Four captures with that blind spot cannot distinguish "no word" from "a word we structurally cannot
see". **Gated on rung B0** (move the receiver so it sees the GRENADE and not the SHOOTER); until B0 runs, design
for the event and do not treat the silence as proven.

So "contested" is a guess, and it fails in one specific way: **the node cannot tell whether the shot hit the
grenade**, so firing past it while standing in an enemy hill produces a false "contested". Probably acceptable
(you are on the point, shooting, and the game agrees something is happening) but it is inference, not
observation, and it will misbehave exactly there.

⚠ **Worth checking rather than assuming:** does NATIVE know about hits directly? If a native gun says "contested"
even when you miss, it is inferring too and we lose nothing. If it only says it when you connect, the grenade is
telling it something we have not captured, and that word is worth finding.

**This is also the concrete case for FF on** (F73): three of the four need to know the hill is YOURS, and with
`$GSET` t1=0 a gun cannot see its own hill at all. The tick and the "hill lost" callout are both impossible
without it.

### Where the hill audio has to live

**Measured (evening, archive) — the gun CANNOT speak on a beacon, at least not through fn 28.** The
reasoning below was the prediction going in (a `$SIR` row's `<soundID>` field plays on the victim when that
cell fires, so `$SIR,15,0,<soundID>,28,0,0,1,,*` should make every hill beacon audible with no node involved);
it does not hold. Armed live with `$SIR,15,0,U100,28,0,0,1,,*` — `U100` known audible, confirmed by ear the
same evening — the row registered repeatedly (`$HIR,4,15,0,0,8,0,0`, no misses) and produced **no sound at
all**. **fn 28 ignores the `<soundID>` field outright** — F73's "zero player feedback" is a property of the
function, not of an empty sound slot. Full detail: `docs/bench-grenade.md` rung Y,
`docs/experiment-log/2026-09.md` 2026-09-10 (evening, cont.).

The keying limit below still stands as the reason no OTHER protocol-15 function is a better candidate, even
though it never got exercised: **`$SIR` is keyed on `<irProtocol, subtype>` alone** — the B/U fields, 4 bits +
2 bits, 64 cells total (`protocol/brx-ir-protocol.md` "the `$SIR` composite key"; `protocol/brx-protocol.md`
§5). Every captured hill beacon decodes as the same key, `<15,0>` — owner and mode ride in the IR word's
team/magnitude fields, and **neither is part of the lookup**. One cell, one sound at best: the gun could never
have played a different clip for captured / contested / lost / neutral, because it cannot key on any of those.
⚠ Still untested, because no sound played at all to observe it on: whether fn 28 or any other protocol-15
function honours polarity WITH a sound loaded, and `docs/spec/contracts.md`'s `$PSET` note (also §5) that a
non-empty `$SIR` `<soundID>` overrides the `$PSET` pool sound on the row that fired.

**So the four team-aware callouts (`VB0N` Hill Captured, `VB0O` Hill Contested, `VB0P` Hill Lost, `U100` the
possession tick) are phone work, not gun work** — they need to distinguish four+ states from one wire fact
(owner) that changes over time, and a single `$SIR` cell cannot hold four sounds. **The node algorithm is now
normative in [`spec/utility.md`](spec/utility.md) §5d.7** (`hill_owner` / `last_beacon_at`, the separate ~1 s
tick, presence expiring on two missed beacons, announcing on `mag=50` alone, the listener's team choosing the
callout, and the ban on queueing anything off a beacon). `engine.js:_hillCallout` implements it.

**And a mode primitive we did not have: shield the holder.** Both grenade words carry the OWNER's team, and the
firmware gates by polarity — damage lands only from an enemy, grants only from your own team. So `<0,0>` on fn 1
punishes challengers while `<15,0>` on a grant function (fn 11/18) shields holders, with the firmware doing the
team logic. Untested (see `bench-grenade.md` programme D), and it would be the first shield our stack can fill
at all (F60).
⚠ **But you cannot have both halves in one cell** — a grant on `<15,0>` costs you the READ of every enemy-held
hill, which is the whole mode. The conflict is worked through in the next section; it applies to any
firmware-granted hill reward, shield included, not just to rate of fire.

### Rewarding the holder: a hosted rate-of-fire boost

**The design F87 builds against, and the reason it cannot be a firmware grant.**

**Why the firmware cannot grant it: one cell, two jobs.** `$SIR` is keyed on `<irProtocol, subtype>` alone, and
every hill word — the beacon, the capture, the damage — decodes to the same key. So the protocol-15 cell can be
a silent READ of the hill (fn 28, what ships) **or** a grant to the holder (fn 11/18), never both. Taking the
grant costs the read of every enemy-held hill, which is the whole mode. The same conflict applies to a
firmware-granted shield (F60), not just to rate of fire.

**The mechanism (node-side, so it has neither problem).** The holder's own node pushes a `$WEAP` with a lower
token 14 (the inter-round interval, calibrated at ~1 ms/round) and reverts it when possession is lost. The node
already knows possession from the beacon, so nothing new goes on the wire. The push must preserve ammo exactly —
a `$WEAP` write is the moment a magazine can be silently refilled or truncated.

**What is unmeasured, and gates the build (`bench-grenade.md` rung Z).** How low token 14 can go before the
firmware clamps or the IR stops keying; whether the push/revert preserves ammo; whether it fires correctly off a
real beacon. A faster cadence also interacts with the t21/t22 recoil model (F46), so a boost may cost accuracy as
a side effect. Do not price the boost before the floor is measured.

## 8. Designs specified but not built

Both were written in full as `spec/utility.md` §5e and §5f and moved here when the spec was cut back to what
ships. They are complete designs, not sketches: build them from this text, and promote the parts that survive
contact with hardware back into the spec.

### 5e · Roaming hills: the LAN-coupled variant (opt-in)

**It buys its feature with an architectural exception.** Tony asked for this
explicitly as a second mode, for a small field where every point really is on one Wi-Fi — his example: one hill in
the garage, another on the porch across the house, both on the house AP. §5d is the mode for a field; §5e is the
mode for a house.

⚠ **Read §5f first if you have not.** This section used to claim points-to-win as a second LAN-coupled feature,
and **it is not one** — §5f.2 shows a
Territories station scoring itself offline and reporting at recap, which is plain §5c. What is left needing a live
LAN is **one** feature, plus one optional flavour of the score:

| feature | why it needs the LAN |
|---|---|
| **Roaming hills** (the live point moves during the match) | somebody must **choose** which point is hot and tell the others. That is MC, mid-match, which is the exception. `VB0Q` "Hill Moved" (2.42 s, confirmed by ear, already in `HILL_CUES` with no caller) exists for exactly this, and **F83** already proposes the mode on the grenade side |
| ~~a points race that ENDS the match early on crossing a target~~ | 🔴 **DECLINED (Tony, 2026-09-10) and not being built.** The points target is read **at the horn** (§5f.2), which is fully offline. The early-end form is the only other thing that would have needed coverage, and it is now deliberately off the table — **not** "allowed but unbuilt". Anyone reviving it is opening a second A4.8 exception and must say so |

Mechanically: MC pushes the hot point to the stations (`station_config`, §5c, extended with the hot flag — advert
byte 10 bit 5). On a move, each player phone plays `VB0Q` off the hot bit changing, by the §5d.5 rule. Stations
still run §5d locally and still keep their own books; the LAN adds the rotation, it does not replace the local
rule.

#### 5e.1 This is a DELIBERATE EXCEPTION to A4.8, and that is the most important line in this design

`docs/spec/contracts.md` §5 [**A4.8**] says: *on a large field most nodes are out of LAN range for most of the
match … live kill-confirm and a live individual board are coverage-zone features.* **Nothing about the match
outcome depends on coverage.**

**§5e breaks that last sentence on purpose.** A roaming hill is a match rule taking its orders from the laptop
mid-match: a control point out of Wi-Fi range is not merely invisible, it is **not in the game**, because it cannot
be told whether it is the live one. There is no way to have that feature and keep A4.8 — the exception is the
feature. **Roaming hills is the whole of the exception** — an early end on a points target would have been a
second one, and Tony declined it (see the table above), so it is not in the system and not reserved for later.

⚠ **The exception is NARROWER than this section first claimed**, and that is worth noticing rather than quietly
fixing: points-to-win was listed here as a second reason, on the reasoning that no station knows another station's
contribution. True — and irrelevant, because nothing has to add them up *during* the match. Territories (§5f.2)
scores offline and MC sums at recap. The rule that looked like it needed breaking twice needs breaking once.

We take it knowingly and we fence it:

- it applies **only** to modes explicitly flagged **`lan_coupled`** in the mode catalog;
- it **never** applies to §5d, which stays fully offline-capable and is the default for any field bigger than a house;
- it is the **only** place in the system where coverage decides an outcome; everything else A4.8 protects (facts
  queued in the ring and replayed, kills reconciled at sync points, a node whose own loop never waits on MC) stays
  exactly as it is;
- and because the requirement is physical, **both screens must say so before the match starts** (§5e.2, §5e.3).

If §5e is ever built, `contracts.md` A4.8 gains a pointer to this section. An exception that is not written next to
the rule it breaks is just a bug waiting to be rediscovered.

#### 5e.2 MC must say the phones need a connection (setup surface)

The requirement is a **physical setup step**, which MC already has a channel for. `mcp/brx_mcp/mc/API.md`: a
`config_warnings` entry whose text starts **`SETUP: `** is a physical step the operator must do on the field
before the push, and the **GAMES rail renders those verbatim**. `lan_coupled` modes emit one, with live counts:

```
SETUP: this mode needs every control point on the match Wi-Fi for the whole game - 1 of 2 items linked
```

Reuse that channel; do not invent a second warning surface. Alongside it, the **ITEMS panel** (roadmap A2) shows a
link state per utility phone and raises an A4-style attention flag on any `kind 5` phone that is not linked while a
`lan_coupled` mode is selected. **Proposal:** MC should also **refuse to start** a `lan_coupled` game with an
unlinked control point (a 4xx naming the phone), the same way `compile.py` refuses `koth` with no `station_source`
— the mode cannot be scored correctly, so starting it is a guaranteed bad match rather than a risk.

#### 5e.3 The utility screen must make the Wi-Fi requirement clear during setup

`utility.js` already renders an MC link state — **`MISSION CONTROL ✓ LINKED` / `· OFFLINE` / `· NO ADDRESS`**
and the arming banner **`MC-ARMED · GAME N`** / `NOT ARMED BY MISSION CONTROL`, both written by `render()`. Build on
those; add no new indicator.

- a station armed into a `lan_coupled` mode shows **`MC-ARMED · GAME N · LAN-COUPLED`**;
- while such a station is not linked, the existing MC line is **promoted from a footnote to a blocking band**:
  **`THIS GAME NEEDS WI-FI — MISSION CONTROL OFFLINE`**, in the alert treatment, above the fold, unmissable by
  whoever is propping the phone up. The point of putting it here is that the person who can fix it is standing in
  front of this screen and not in front of MC;
- when it is linked, the band is replaced by a quiet confirmation carrying the thing an operator actually wants to
  know: **`WI-FI OK · REPORTING TO MISSION CONTROL`**.

#### 5e.4 LAN loss mid-match

This is the failure the exception buys, so it gets a written behaviour rather than whatever the code happens to do.
All four points below are **Tony's decision**, taken as they were proposed:

1. **Grace, then degrade.** A link down for more than **15 s** (a few reconnect backoffs, `contracts.md` §5) puts
   the station into **degraded** mode. It **keeps running §5d locally on the last known owner** — presence,
   net-difference capture, per-team possession seconds, the local callouts, all of which need no LAN — and stops
   contributing to the points race.
2. **Roaming freezes.** The hot point stays where it last was. A station never promotes itself; a hill that moved
   because a phone lost Wi-Fi would be worse than a hill that stopped moving.
3. **Both screens say it, in the words above.** The station: **`OFFLINE — POSSESSION ONLY, NOT SCORING`**. MC: the
   ITEMS row flagged, and the points race shown as **incomplete**, with the gap in seconds.
4. **At the time limit MC will not award a points win it cannot stand behind.** If any `lan_coupled` point was
   degraded for more than **10%** of the match, MC declines the points target and falls back to **most possession
   time from the facts it does hold**, saying so on the recap. Degraded seconds are collected from the station at
   recap and shown as a separate, clearly-marked column — they are real possession, they were simply never in the
   live race.

**The rationale for (4), in one line, because it is the one somebody will want to soften:** a win computed from
data we know is incomplete is not a win, and **failing loudly beats quietly crowning the wrong team.** The
friendlier alternative — award it anyway from partial data and put a warning on the recap — produces a scored
result nobody can check, which is the thing A4.8 exists to prevent.

### 5f · TERRITORIES: the multi-point scoring model, and the mode that needs no LAN at all

**Tony, 2026-09-10:** *"the other option for koth, is territories. You tick points whether you are there or not.
You turn it your colour and then you go find the next territory."*

Several `kind 5` points on the field. Capture one the §5d way, it turns your colour, and it **accrues score for
your team whether or not anyone is standing on it**. Then you leave it and go take the next one. Conquest scoring,
not possession scoring.

**§5d needs no change to support this.** §5d.2 already scores **ownership**, not presence — *"only the team named
in byte 9 scores"*, and an empty point holds its progress while the owner keeps scoring. So Territories is §5d
**configured with several points and a total to win**, which is why it is cheap: the capture rule, the advert, the
callouts and the station screen are all the same. What changes is the number of stations and what MC does with
their tallies.

#### 5f.1 It solves camping by construction

The camping worry is real in single-point possession KotH: standing on your point is *how you earn*, so a 1-1
split settles into a stable, boring equilibrium where both teams sit on their own point and nothing happens.

In Territories, **standing on a point you already own earns you nothing extra.** The point is already ticking. The
only way to increase your rate is to go own another one, so the optimal play is always to leave and push. The
incentive comes out of the scoring model, which means **none of the anti-camp machinery is needed for this mode**:
no ownership decay, no capture bonus, no superlinear "holding both" multiplier, no timer that punishes standing
still. Every one of those is a rule that has to be tuned, explained to players, and then defended when it
misfires. Territories needs none of them, and that is the main argument for the mode.

#### 5f.2 It removes the A4.8 exception for scoring: a station is its own scorekeeper

**A Territories point can score itself, offline, with no LAN at any point in the match.** It knows who owns it
(it decided), it is physically present for the whole match, and it already persists its tally across a reboot
(§5d.6). So it accrues its own ownership-seconds locally and hands MC the total **at recap** — which is not a
concession, it is exactly §5c: *stations are self-authoritative and report at recap; MC is not live mid-match*.
Add up the stations at recap and you have the score.

⚠ **This means §5e over-claimed, and the correction matters.** §5e originally listed **points to win** as needing
the LAN. That is only true of one *form* of it:

| form of "points to win" | needs coverage? |
|---|---|
| **the target decides the winner at the horn** — the match runs its full clock, MC sums each station's tally at recap, and the team past the target (or with the most territory-seconds if nobody reached it) wins | **No.** Fully offline. No A4.8 exception, no Wi-Fi requirement, nothing to warn the operator about |
| ~~**a live race that ENDS THE MATCH the moment someone crosses the target**~~ | **Yes**, and only this. Somebody must hold the running sum *during* the match to blow the horn early, and no station knows another station's contribution. 🔴 **DECLINED (Tony, 2026-09-10): not being built** |

**Tony took the first: the target is read AT THE HORN.** To players the two are nearly
indistinguishable — a BRX match runs a clock anyway, and the runway is the normal one — and the first costs nothing
architecturally. So the §5e exception narrows to **roaming hills alone** (a match rule taking orders from the
laptop mid-match, which genuinely cannot be done offline), with no second exception held in reserve.

#### 5f.3 Territories does NOT work on grenades, and the reason is observation, not memory

A grenade **does** hold its ownership when unattended: F70 measured a captured hill reading the same owner for ten
straight beacons with nobody shooting it, and rung R's range walk still read the same owner from the far edge
(`docs/bench-grenade.md` rung R). The grenade remembers fine.

**The problem is that nobody observes it.** A grenade's ownership travels **only over IR**, and only a **gun**
receives IR (**F92**). So an unattended grenade territory is **unverifiable**: a rival can flip a far point and
nobody — no station, no node, not MC — learns of it until a player happens to wander into range, which rung R puts
at *solid close in, intermittent by ~30 ft* (85 s and 145 s dropouts at the edge). That is **eventually-consistent
scoring**: the score is right whenever someone last looked. Acceptable as flavour. Not acceptable as the thing
that decides who won.

This is the same sensor gap as F92, seen from a third angle — F92 saw it as "a station cannot learn who owns a
grenade hill", F88 as "a grenade carries no point id", and Territories sees it as "an unwatched point has no
scorekeeper."

➡ **So Territories is the strongest case in this document for building K1 phone control points.** A phone station
*is* the observer the grenade lacks: it sits on the point for the whole match, it decides ownership from adverts it
hears directly, and it keeps its own books. A grenade can only ever be a **contested** point that someone is
present for — a good objective, and never a territory.

#### 5f.4 Scoring is LINEAR per owned territory

**Tony, 2026-09-10: *"sounds like linear is the way to go."*** Two territories tick at twice the rate of one.
**No superlinear multiplier for holding more, and no majority threshold.** The rate is `n_owned * tick_rate`.

Both alternatives were considered, and the arguments against them are worth keeping, because each will be
proposed again by somebody:

| model | why not |
|---|---|
| **superlinear** in the count (a multiplier for holding two, three…) | the mode **already** rewards spreading out by construction (§5f.1: sitting on a point you own earns nothing extra), so a multiplier is not needed to create the push incentive — it pays twice for the same behaviour. And in a 10-minute game it risks a first-capture lead **snowballing out of reach** before the other team can answer |
| **a majority threshold** (score only while you hold 2 of 3) | genuinely good design — losing one point drops you to **zero**, so the scoring itself shouts *get help* — and **wrong for our point counts.** A threshold needs **three** points to mean anything: with two, "majority" is *both*, so a 1-1 split pays nobody and a 2v2 match can sit scoreless for minutes. ➡ **Revisit this if a three-point Territories game is ever built**, where the threshold is strictly better than linear |

⚠ **Do not attribute a single canonical answer to "Halo":** it shipped both. Halo 4's *Dominion* ticked per
captured base (linear-ish); *Strongholds* in Halo 5 / Infinite is the majority threshold. The reference is useful
for the shape of each model and settles nothing by itself.

⬜ **And a third option that is still open: scale ADVANTAGE, not points** — holding more territories shortens your
respawn delay, *Dominion*'s approach. It answers the superlinear objection (board control compounds, the score does
not snowball) and it is the one item here Tony has not ruled on. Written up in **§5f.7**.

#### 5f.5 The two rates, and both are CONFIGURABLE

**Tony, 2026-09-10: *"3 needs to be configurable with a good default."*** Neither number is hard-coded; both live in
game config beside the other tunables. **They are two different quantities and are easy to conflate, so they are
named separately here and must stay separate in config:**

| # | what | unit | default |
|---|---|---|---|
| **conversion rate** | how fast a point *changes hands* (§5d.1) | progress points per second **per net player** | **10** = a lone player takes a neutral point in 10 s and steals a held one in 20 s (two phases); `capture_s` = 10 s. ⚠ **This is already `DEFAULT_CAPTURE_S = 10` in `app/src/control.js` — the spec value and the code constant must agree, and a change to one is a change to both.** *(Corrected 2026-09-11: this row said `DEFAULT_RATE`, the constant's name before it was renamed to read as seconds-to-capture at net 1 rather than as a percent-per-second rate — F98 recorded the rename and the spec did not follow. The line number it gave, `:49`, is `REFUSED_TID`.)* |
| **score tick** | how fast an *owned* territory **pays** (§5f) | score points per second **per owned territory** | **1/s proposed** (see the arithmetic below) |

**The arithmetic an operator actually needs, for a 10-minute match at 1 point/s per territory:**

| held all match | total |
|---|---|
| one territory | ~600 |
| two territories | ~1200 |
| three territories | ~1800 |

So **the target chosen decides whether holding a single point can ever win**: a target of 1000 means one territory
is never enough and a team must take a second; 500 means one territory held cleanly wins, which turns the mode back
into KotH. That relationship, not the constant, is the thing to tune — which is why the rate is configurable and why
this table is here rather than a bare number.

⚠ **Both numbers are proposals.** Tony asked for *a good default*, not for these values; 10 is what the
implementation already ships and 1/s is chosen so the totals above are round and readable. Neither has been
playtested.

#### 5f.6 Neutral pays nobody, and a dead station keeps what it earned

Both **Tony, 2026-09-10**:

- **A neutral point ticks for NOBODY.** (§5d.2 said this already — but that was the spec's own sentence, not a
  ruling, and an earlier draft wrongly cited it as settled. Now it is his, so §5d.2 is backed rather than
  self-referential.) An **owned** point ticks whether or not anyone is present; that is the mode.
- **A station powered off mid-match KEEPS the seconds it accrued up to its last advert, then stops.** The tally
  is **not** voided. Rationale, recorded because the opposite is the tidier-looking choice: voiding everything
  punishes a dead battery far more harshly than the information loss warrants, and **the seconds up to the last
  advert were genuinely earned**. What is lost is only the dark interval — an owner is silently under-paid for it,
  and a rival who flipped the point while it was dark gets no credit either. Trust caveat unchanged: the phone is
  assumed untampered, per §3's security posture.

#### 5f.7 Open question: scale ADVANTAGE rather than points

The one item Tony has **not** ruled on. Repeated here rather than left buried in §5f.4: instead of (or alongside)
scaling the score with territory count, let holding more territories **shorten your respawn delay** — *Dominion*'s
approach. `respawn_s` is host-driven, already fully in our control, already the lever §4/§5d use, so it is
buildable today with no new mechanism; it compounds board control without the score itself snowballing; and it
composes with the linear score rather than replacing it. **Needs his sign-off before anyone builds it.**

