# IR effects design

**What this is.** The `$SIR` layer and the IR-effects study: what a victim's `$SIR` row does to an
incoming IR word, the weapon axes that opens, the archetypes the catalogue does not have yet, and why the
range tokens are a carrier frequency. It was §6 of [`weapon-design.md`](weapon-design.md) until
2026-09-24 and moved here so that page stays about the shipped arsenal. The section numbers are
unchanged, so an older citation of `weapon-design.md` §6.x means the same section here.

**What stays in `weapon-design.md`.** The [Balance rules](weapon-design.md#balance-rules) table, the
damage model (§0), the arsenal table and its derivations (§2), the wire levers (§4), the open unknowns
(§5) and the triangle (§7). A bare §0 to §5 or §7 below means that page. §7r means
`session-findings-2026-08.md` §7r, the archived August notebook.

## Status

This note was the banner at the top of `weapon-design.md`. It concerns this page only.

> **✅ FIXED 2026-09-18 — the Energy Launcher's zero damage had a one-line cause**
> Its `$WEAP` key `<t3,t4> = <9,3>` landed on `$SIR,9,3,,24` in `gameconfig._SIR_TABLE`, which MC pushes
> into **every** game head, and **fn 24 applies no damage at all**. Reproduced and fixed on hardware in
> one minute, same weapon, same word, one row changed: on **fn 24** a magnitude-115 word moved the victim
> **999 → 999**; on **fn 1** it moved **999 → 884**. The row now ships as `$SIR,9,3,,1,0,0,1,,*` and the
> weapon deals its full 115.
>
> The same bench showed fn 24 is worse than inert: it leaves the victim's gun **manufacturing a phantom
> `$HIR` every 5.07 s until the next `$SPAWN`**, with sound, vibration and a headset flash, so one hit
> reads to the player as being shot every five seconds for the rest of the life. 25, 26 and 27 do the
> same. **Never ship fn 24-27 on a cell a weapon can reach** (P18, closed; `protocol/brx-protocol.md` §5).
>
> ✅ **SETTLED (2026-09-11, bench): the ×1.25 / ×2 multipliers are REAL, and HEADSET-ONLY.** **fn 36
> lands floor(magnitude × (1 + t7/200)), fn 37 lands floor(magnitude × (1 + 2·t7/100))** on the
> HEADSET sensor (t7 = the compiled `$GSET criticalShotModifier`; ×1.25 / ×2 at t7=50, which WAS the
> MC default until the 2026-09-17 arsenal review set it to **0**, because BRX players aim at the
> headset: 4 of the 5 sensors are on it. At t7=0 every function lands the raw magnitude on both
> sensors, so the five weapons named next no longer gain anything from a headset hit) — the GUN BODY lands the raw magnitude (×1) on all three functions, fn 1/36/37 alike. So
> five weapons — Burst Rifle, Bolt Rifle, AMR (fn 37), Force Rifle, Sniper Rifle (fn 36) — deal more
> than their `t5` on a HEADSET hit only; a body hit is exactly `t5`. This reconciles rather than
> overturns the two earlier readings: 2026-08-27's ×1.0 matrix was rig-pinned to the gun body
> (correct — body is always ×1) and 2026-09-02's ×1.25/×2 reading was taken on the headset at t7=50
> (also correct). §6.2.

---

## 6. The `$SIR` layer — damage is a negotiation, not a number

**Added 2026-08-26 (third pass), from the IR-emitter bench sessions.** Everything in `weapon-design.md` §0 to §5
treats a weapon's damage as `t5` and the victim as a passive 115-point pool. That model is now known
to be incomplete, and in four places actively wrong. This section covers what the IR work opens up
and what it supersedes.

**Sources.** All of it is bench-measured, in `docs/experiment-log.md` (2026-08-26) and
`protocol/brx-ir-protocol.md`. The load-bearing entry is **"the COMPLETE two-sided `$SIR` function
map + crit multiplier + FF enforcement"** — cited below as **[two-sided map]**. It supersedes the
earlier *"`$SIR` FUNCTION MAP enumerated"* sweep, which fired same-team with FF off and therefore
silently blocked the entire damage family; the two entries are one experiment run at both
polarities. Also drawn on: *"THE SPECIAL-WEAPONS TIER IS REAL"* and *"a stock BRX tagger accepted a
FULLY SYNTHETIC shot"*.

Every function-class result carries a **trailing known-good control**, added after an earlier run
produced sixteen clean-looking negatives that were a configuration artifact — worth knowing when
reading any negative result in this area.

> ✅ **Scope: resolved — the classes travel.** An earlier revision of this note warned that each class
> had been measured at a single IR protocol and might not generalise. A controlled matrix across
> protocols **0, 5, 7, 9 and 10** has since found **no cell varying by protocol** (`fad28f2`), with fn 1
> holding a correct 40 as control throughout. So "fn 6 is armor-piercing" can be read plainly, and a
> weapon designed on protocol 9 gets the same behaviour as one on protocol 0. The caveat was
> over-cautious and is withdrawn.
>
> The one thing that is **not** settled is the fn 36/37 **multiplier magnitude** — see §6.2.

### 6.1 The model

The 8-bit field in the IR word we have been calling "damage" is a **magnitude**. What it is applied
to is decided by the **`$SIR` row** the victim looks up — and that table is ours, pushed over BLE in
every game head (`gameconfig._SIR_TABLE`, sent by `Compiler.compile()`).

- The row is indexed by the composite key **`<protocol, subtype>`** = `$WEAP` **`t3`,`t4`** =
  IR-word fields **B**,**U** (`brx-ir-protocol.md`). 4 bits × 2 bits = **64 addressable effect
  cells**. A hit with no matching row is **silently dropped**.
- The row's **function** decides the effect: damage, add-HP, add-armor, add-shield, or a status
  event that touches no pool (experiment-log, *"SPECIAL-WEAPONS TIER"* — *"`D8` is not 'damage' — it
  is the MAGNITUDE"*).
- Pools drain **shields → armor → HP**, and armor overflow spills into shields. The phone engine
  counts the shield in `hit_taken.dmg` and the HUD shows it; what is still open is `docs/spec/node.md`
  §10 Q12 (FOLLOWUPS Q12′).
- **Shield fill.** `$PSET` t5 sets the shield CAPACITY, not a fill (P16). The pool fills from an IR
  function-11 event or over BLE with `$LIFE,0,0,<n>,*` (F109, bench 2026-09-11), which is how the Shields
  preset recharges (§7.3).

So a weapon is a **`<t5, t3, t4>` triple against a table we author**, not a damage number. Two guns
with identical `t5` can do entirely different things.

### 6.2 The multiplier functions, and what the shipped table does now

The function on a victim's `$SIR` row decides what a hit lands (§6.1). Two stock rows carry multiplier
functions: `<0,1>` → fn 36 and `<0,3>` → fn 37. Bench 2026-09-02, then F23 on 2026-09-11: both are real,
they act only on a HEADSET hit, and they scale with `$GSET` t7 (`criticalShotModifier`): fn 36 lands
`floor(magnitude × (1 + t7/200))`, fn 37 lands `magnitude × (1 + 2·t7/100)`. A gun-body hit is ×1 on
every function. Row tails do not gate the multiplier (`brx-protocol.md` §5).

**This is fixed for the shipped game.** MC compiles t7 = 0 (2026-09-17 arsenal review: the headset is
already the primary target), so fn 36 and fn 37 both land ×1 (`compile.headset_multiplier()`,
`mcp/tests/test_headset_multiplier.py`). The two cells that were live bugs are fn 1 in
`gameconfig._SIR_TABLE`: `<8,0>` (the Charge Rifle; fn 38 halved every hit, F225) and `<9,3>` (the Energy
Launcher; fn 24 landed nothing, bench 2026-09-18). The flatten-or-retune question is moot at t7 = 0.
The per-weapon tables, the confirmation trials and the resolution narrative are in git history and in
`docs/experiment-log/2026-09.md` (2026-09-02 and 2026-09-11).

> **Method rule: record the protocol, the `$HIR` token 1, and the firing range beside every pool
> measurement.** All three started as unstated conditions discovered after the fact and each cost a re-run.
> The default question for any new claim is "under what conditions is this true?", asked at capture time.

> ⚠ **A measurement artifact worth remembering.** The first pass read the Burst Rifle as unaffected.
> It was not — the trial had counted *registered hits* rather than per-hit damage, and a ×2 multiplier
> is indistinguishable from two registered hits unless you check `hits == 1`.

### 6.2b The worse bug: `validate()` passed it

Before the bench found it, an Energy Launcher loadout returned this from `Compiler.validate()`:

```
{'ok': True, 'errors': [], 'warnings': []}
```

A weapon that provably cannot kill anyone armed a live game with **no signal at all** — from the very
function whose job is to catch that. The `mag ≥ htk` invariant computes on raw `t5`, and the Energy
Launcher satisfies it (htk 1, mag 2) while dealing nothing. That blind spot is arguably worse than the
bug it missed.

The root cause is a modelling error, not a missing rule: **damage is a property of the
`(weapon, $SIR table)` pair, never of the weapon alone.** Every tool we had validated the weapon in
isolation, so the entire class was invisible.

`validate()` now cross-checks each loadout weapon's `<t3,t4>` against the table MC is about to push.
Three of the four cases below are **errors** — the unkillable ones — and the multiplier case is a
warning:

| case | signature | why it matters |
|---|---|---|
| **no row** for that key | every hit **silently dropped** | the quietest failure of the four — it looks exactly like the hardware refusing, and cost several wasted bench trials |
| function in the **no-pool** family | registers a `$HIR`, moves nothing | the Energy Launcher |
| **zero damage on a damage row** | registers a `$HIR`, takes nothing off the pool | round-3 FIELD-4 (2026-09-13): a catalog row or override at `dmg: 0` is unkillable by a different door, and `hits_to_kill` returns 0 for zero damage so the magazine guard skips it entirely. Grant rows (heals/armour/shields) are exempt — they are not meant to deal damage |
| function is a **multiplier** (36/37) | lands ×1.25 or ×2 | not broken, but `htk`/`ttk_ms` in `weapons.json` are computed on raw `t5` and are wrong for that weapon |

> 🔴 **The first three cases are ERRORS** (round-2 fix pass 2026-09-12; the zero-damage row added by
> round-3 FIELD-4, 2026-09-13). They are the definition of unkillable, and none is reachable by the
> `mag ≥ htk` guard — `hits_to_kill` returns 0 for zero damage, so that check skips such a weapon
> entirely. The severity ordering used to be inverted: the RELOAD case, a kit that can still win, was
> the only hard error while these were advisories.
> A clean pass exists now because the one row that trips it — the Energy Launcher — is excluded from
> every pool (`policy.UNPLAYABLE_IDS`), so no operator pick can be blocked at the whistle. The
> multiplier case stays a warning: under *flatten* it goes quiet on its own; under *retune* it is the
> prompt to recompute the published numbers.

**2. §0's "no multiplier, no reduction" is wrong.** It holds only for a standard-damage row against a
shieldless victim, and the row multiplier is SENSOR-gated (bench 2026-09-11), not a flat "if crit"
factor — the `$HIR` crit bit read 0 on all 15 headset hits in that session, so it is not what is
driving the fn 36/37 scaling; that is the compiled `$GSET criticalShotModifier` (t7), via
`compile.headset_multiplier()`. The full expression is:

```
applied (gun body)  = t5 × 1                                  → the guaranteed-kill number
applied (headset)   = t5 × headset_multiplier(fn, t7)          → fn 36/37 only scale; every other fn is ×1
                                                                → drains shields, then armor, then HP
                                                                ...unless the row is armor-piercing,
                                                                which goes straight to HP
```

**3. `htk = ceil(pool / dmg)` — quoted here at the default 115 pool (§2.5) — assumes a standard row, no crit, no shields, and armor present.** Against
an armor-piercing row the effective pool is **45 (HP only)**; against a shielded target it is larger
than 115. The `mag ≥ htk` invariant in `validate()` uses the raw-`t5` reading, which is the
*conservative* direction for standard weapons (it over-estimates htk) but **under**-estimates it for
armor-piercing — worth revisiting if AP ever ships.

**4. §5's U6 ("damage is always t5") held only for standard-damage rows** (`<0,0>`, `<10,0>`, `<6,0>`), which
is all that test exercised; `t3`/`t4` are the `$SIR` lookup key and two of the three subtypes in use are
multiplier rows. The hit-SFX half of U6 stands. Reopened as **U10**, closed 2026-09-02.

One thing this *vindicates*: the first pass recommended reverting every weapon's `t4` to 0 because the
field was unpinned. We never did — re-basing on captured frames preserved it — and `t4` turns out to
be half the `$SIR` key. Reverting it would have collapsed three distinct effect classes into one.

### 6.3 New weapon axes

Five levers that did not exist in the `weapon-design.md` §0 model.

**Armor-piercing — a real defensive-layer bypass.** Functions **2, 6** (and **17, 21** on their enemy
side) hit HP directly: measured **HP 45 → 25 → 5 with armour untouched at 70** **[two-sided map]**. That turns armour from a flat +70 into
something a weapon class can be built to ignore, and it makes the effective pool weapon-dependent:
115 for a standard weapon, **45** for an AP one. An AP weapon wants a *lower* `t5` than its TTK
suggests. Natural fits: the AMR (already `armor-piercing` in its `t3` semantics), the Rail Gun
(`t3 = 6`), and a dedicated anti-armor pickup.

**Damage multipliers live victim-side.** Fn 36 (×1.25) and 37 (×2) **[two-sided map]** mean a weapon's
punch can be changed **without touching its frame** — by pushing a different `$SIR` table. That is a
per-game modifier surface: a "hardcore" table where everything is ×2, a "juggernaut" table where one
player's protocol is ×0.5. It is also a trap (see §6.2) — the multiplier is invisible at the weapon.

**Dual-polarity weapons: one row, two behaviours.** Functions **16, 17, 20, 21, 22, 23** heal allies
and damage enemies **[two-sided map]**. This is not a fire-mode toggle and needs no host logic: the same
emitted word does opposite things depending on the target's team. A "flux beam" — point at a
teammate to top them up, at an enemy to hurt them — is **one table row**.

It composes with the firmware's own friend/foe gating. Support functions (10/11/13) register **only
from a same-team source** — heal fired at an enemy is silently dropped (experiment-log,
*"SPECIAL-WEAPONS TIER"*: 3/3 same-team, 0/N cross-team) — while **damage is not team-gated at all**
(bench exp 4). `$GSET` token 1 is firmware-enforced, replicated with alternating values **[two-sided map]**:

| `$GSET` t1 | damage same-team | damage enemy | heal from ally | heal from enemy |
|---|---|---|---|---|
| **0** (FF off) | **blocked** | lands | lands | **blocked** |
| **1** (FF on) | lands | lands | lands | lands |

(This also reconciles bench exp 4, which recorded "FF is not firmware-enforced": that run was at
**t1 = 1** and saw same-team damage land — exactly this table's second row. The evidence agreed all
along; only the generalisation to t1 = 0 was unsupported.) **A medic gun enforces "allies only" in hardware, with zero host
logic.**

**Crit is a live mechanic, and it is NOT the same axis as `$GSET criticalShotModifier`.** The IR word's
**C** bit is emittable and echoes on `$HIR` tok6 (`brx-ir-protocol.md`, bench-verified) — **×1.5
damage**, replicated with alternating legs: at magnitude 20, `crit=0` gave per-hit armor deltas of 20
and `crit=1` gave 30 **[two-sided map]**. It reads 0 on every stock weapon: not dead, just never set.
That is a whole unused axis — a weapon with a crit chance, a headshot bonus (recall `$HIR` tok1 == 1
is a headset hit, §7r), or a "marked target" perk. ⚠ **Bench 2026-09-11 confirmed `$HIR` tok6 stayed 0
across all 15 headset hits** in that session (across `$GSET` t7 = 0/50/100), so the fn 36/37 headset
scaling documented in §6.2 runs through `criticalShotModifier` (t7) directly, not through this bit —
the two "crit" names are separate mechanisms, and F62 (`docs/FOLLOWUPS.md`) plans the probe that
isolates t6 (`primaryCritChance`) from t7 cleanly.

**Three overflow flavours make support weapons distinct.** The add-HP functions differ *only* in
where the overflow goes — **nowhere** (10, 17), **into armor** (9, 12, 16, 19), or **into shields**
(14, 21) (experiment-log, *"FUNCTION MAP enumerated"*). That is a genuine class distinction rather
than a number tweak:

| medic type | function | what a full-health ally gets |
|---|---|---|
| **Field medic** | 10 | nothing — pure top-up, no waste, no reward for overhealing |
| **Armorer** | 9 / 12 / 16 / 19 | plate: healthy allies gain armor |
| **Overshielder** | 14 / 21 | overshield: healthy allies gain a shield buffer that drains first |

Plus **fn 13/15/20/22** (armour only), **fn 11** (shields only — the sole way shields enter the game),
and **fn 18**, a further shields-only grant. (⚠️ An earlier draft called fn 18 a conversion costing
4 HP; re-measured on a clean baseline it leaves **HP and armour untouched** — the apparent cost was a
shifted baseline.)

**Status effects — one has an observable effect, and it is not a stun.** A whole family registers a `$HIR`
and moves no pool: enemy-side **3, 8, 23, 24, 25, 26, 27, 28, 35**; friendly-side **31, 32, 34** **[two-sided
map]**. **`$SIR,<proto>,<sub>,,23` SILENCES THE GUN *AND* ZEROES ITS ACCURACY** (2026-08-27, Tony on the trigger;
relabelled 2026-09-09 — §4.4). ⚠️ Read the relabel carefully rather than swapping one single-cause story for
another. TWO things were observed in 2026-08-27 and only one of them was quantified: the gun **was heard** to
go silent (by ear, and it stands), and `$ALCD` token 2 **was measured** dropping to 0. That number was cited as
the proof of the audio effect, and it is now known to be live ACCURACY, so it never evidenced the silence at
all. Both effects are real; what is gone is the belief that one number demonstrated both. Whether fn 23 has one
mechanism with two symptoms or two separate effects is open (F66): the victim keeps
firing and emitting IR (magazine decremented shot by shot; 14 / 21 / 14 IR frames before / during / after) but
its accuracy is forced down for ~6–8 s — `$ALCD` token 2 driven 0 → 100 (2.5 s, 5.3 s, back to 100
by 8.0 s, 3/3 reps); `$AMMO`/`$WEAP` re-pushes do not move it, `$SPAWN` clears it early; with a real loadout the
frame is `$ALCD,32,0,0,192,0` (ammo and health preserved). A **sensory-disruption** weapon: no fire sound, no
reload chain, no overheat cue, but it forces your accuracy to zero without a shot fired, below whatever
the weapon's own `t22` floor is. It works under protocols 0/5/7/10 alike, so it belongs to the function.
**Category 10 ships as fn 23** (U11′, closed 2026-09-18): no pool moves and the victim's live accuracy goes to 0,
which is the effect §6.3e describes. `$STUN`-over-BLE is still a no-op, and the native Sentinel EMP capture is no
longer needed. The 2026-08-26 "fn 23 is an EMP / weapon
disable" reading and its retraction are in `docs/experiment-log.md` 2026-08-26/27.

**Three clean negatives worth carrying** — each one closes a design direction someone would otherwise
spend a session on:

- **All 16 protocols accept damage** given a fn-1 row, so there is no protocol whitelist and the 4-bit
  field is not a scarce resource **[two-sided map]**.
- **`$SIR` row parameters p5–p8 do not scale damage** — five different shapes all landed exactly the
  magnitude **[two-sided map]**. Whatever they do, it is not a multiplier.
- **No function tested is a damage-over-time.** Each of 3/8/23/24–28/35 and 31/32/34 was fired once and
  watched for 18 s: **no HP ticks without further shots** (IR bench, 2026-08-26). So poison, cryo and
  incendiary — all named in the `DamageType` enum and in the manual's perk list — are **not** `$SIR`
  functions that tick a pool. If we want a DoT it has to be host-driven (repeat emissions from a
  station, or a Companion applying `$BHIT` on a timer), not a fire-and-forget effect.
  > ⚠️ fn 24-27 are not inert. One unreproduced reading had them dealing damage on protocol 7; the
  > 2026-09-18 re-measure (two guns, single hand-aimed shots) found **no damage at all** and a phantom
  > `$HIR` every 5.07 s until `$SPAWN`. The re-measure is the current record (`protocol/brx-protocol.md`
  > §5, "Phantom hit generator"). Never ship fn 24-27 on a cell a weapon can reach.

### 6.3b Damage over time: the axis the catalogue does not have (S16)

Tony, 2026-09-17: "we don't have any damage over time weapons, like a poison gun". Correct, and the
mechanism for one has been unblocked since 2026-09-09. **Shipped 2026-09-19 as the Toxin Rifle** (S16
closed; every hit poisons; the node tick clock is `spec/node.md` §3.17). The design record follows.

**The certain route is the node.** `$LIFE,<hp>,<armour>,<shield>,*` takes negatives, so the victim's
own phone can drain the victim's own pools on a timer, with no firmware change and no IR frame per
tick. The chain is: the shooter's weapon carries a distinctive `$WEAP` **t3** damage type (the stock
enum already has **11 = gas**), the word lands, the victim's gun raises `$HIR` with that protocol key
echoed in token 2, and the victim's node starts its own tick clock. Everything after the first hit is
local to one phone. It therefore keeps working with no Mission Control coverage, which is the test
every mid-match mechanic has to pass.

Three bench facts the design must respect, all from the 2026-09-09 `$LIFE` session:

- A negative is **per-pool with no spill**, so the node walks shield, then armour, then health itself.
- A pool **floors at 0**, so overkill is silent and a tick cannot carry into the next pool by itself.
- A **lethal** tick emits no `$HP`, only `$LCD` (F64). The node books the death through the `$LCD`
  path, and there is **no `hit_taken` fact and no attribution**, so S16 must decide who is credited
  with a kill that a tick finishes.

**The native route is a maybe, not a fact.** `$SIR` function **24** is the delayed blast: the hit
registers with no immediate pool change, then about 4 s later the victim takes 1 to 3 ticks equal to
the original magnitude, about 420 ms apart (bench 2026-09-11). That looks exactly like a poison round.
⚠️ It was measured against a **repeating** grenade beacon, and the same bench recorded **no self-replay**
once the source stopped; a separate 2026-08-26 sweep fired each status function **once** and watched
for 18 s with no ticks at all. So "one hand-aimed fn-24 shot produces several ticks" is **unproven**,
and the two results may simply mean one delayed tick per word. Do not build a weapon on it until a
bench fires single fn-24 shots and counts the ticks. The Energy Launcher's `<9,3>` row no longer uses
fn 24: it is fn 1 since the 2026-09-18 bench (§6.2), and fn 24-27 ship on no cell a weapon can reach.

**The weapon it buys: a Toxin Rifle.** Low direct damage, a poison stack on hit, and a real weakness.
The shape that fits the ladder:

| lever | value | why |
|---|---|---|
| direct damage (`t5`) | about half its family | the poison is the payload, not the bullet |
| poison per tick | small, for example 2 | a tick must never feel like a second gun |
| duration | a few seconds, refreshed by a new hit, never stacked twice | refresh rewards staying on target |
| counter | anyone who kills the carrier fast, and any pool big enough to outlast it | it loses every short fight |

It is the first weapon in the catalogue that punishes **turtling** rather than out-damaging it, which
is the hole the perk analysis (S50) found: a large armour pool has no natural enemy. A tick does not
care how many plates are in front of it, it just keeps arriving.

**What the HUD owes the player.** A DoT that a player cannot see is a bug report. The node shows the
stack, counts it down, and gives it a sound of its own, because the gun plays nothing for a `$LIFE`
write. The phone HUD belongs to the `brx-hud` session, so the cue set is agreed there, not here.

Open questions before code, all filed under **S16**: kill credit for a lethal tick, whether a stack
survives a respawn (it should not), whether two poison shooters stack or refresh (refresh), and what
the shooter sees, given the shooter's gun never learns that it hit anyone.

### 6.3c Archetypes the catalogue does not have

§6.3 proves five levers. These are the weapons they allow. None needs firmware. Two rows have shipped
since this table was written (Toxin Rifle, crit); armour piercing is now a perk (§7.7). The rest name the
one thing they wait on.

| archetype | what the player does | mechanism | waits on |
|---|---|---|---|
| **Toxin Rifle** | tag someone and they keep losing health after you break contact | node tick clock on `$LIFE` negatives, keyed to the `$WEAP` t3 damage type echoed in `$HIR` token 2 (the enum already has 11 = gas) | shipped 2026-09-19 (S16 closed, `spec/node.md` §3.17) |
| **Medic gun** | heal a teammate by tagging them | `$SIR` fn 10, 9 or 14, by overflow flavour. The firmware enforces "allies only" by itself: a heal fired at an enemy is silently dropped | per-player `$SIR` keys, and a decision about whether a healer belongs in a team of eight |
| **Flux beam** | one weapon that heals a friend and hurts an enemy, decided by who you point it at | ONE `$SIR` row: fn 16, 17, 20, 21 or 22 are dual-polarity. No host logic at all | the same per-player key work, plus a damage number that is fair in both directions |
| **Jammer** | win a fight without taking any health | `$SIR` fn 23 silences the victim's gun and forces its live accuracy to zero for 6 to 8 s, while it keeps firing and emitting | F66: the silence was heard by ear and the number cited as proof was the accuracy field, so the mechanism is unconfirmed |
| **Crit weapon** | a shot that sometimes hits much harder | the IR crit bit is proven at x1.5 and echoes on `$HIR` token 6. `$WEAP` t6 (`primaryCritChance`) reads 0 on every stock weapon | shipped: F62 closed 2026-09-18 (`t6` is a percentage the gun rolls); `crit_pct` 40 on the Burst Rifle, 30 on the AMR |

Two cautions carry over from §6.2. A `$SIR` table is **game-wide**, so any archetype that needs its own
function needs per-player keys before it can ship beside the others. And a victim-side multiplier is
invisible at the weapon, so a weapon built on one reads as balanced in `weapons.json` and plays as
something else entirely.

### 6.3d The reserve columns in `weapon-design.md` are proven (F255, closed 2026-09-18)

**Answered on the bench, 2026-09-18.** `$AMMO,0,32,192` rides `frames.spawn` AND `frames.revive`, so the gun is set to the full catalogue reserve at every spawn and the HUD agrees with it; the halved `t40` is live only in the ~200 ms between the `$WEAP` and the `$SPAWN`. The reserve columns in `weapon-design.md` stand as written. What follows is the
reasoning that made them look wrong, kept because it is the trap, not the answer.

`resolve()` writes the catalogue's `reserve` to **t17** and `reserve // 2` to **t40**, which keeps
Battle Company's own captured invariant `t17 == 2 * t40`. F207 (field, 2026-09-13) proved the gun's
reported reserve mirrors **t40**, on three weapons and six acknowledgements. So the Assault Rifle's
catalogue `reserve: 192` reaches a gun as **t17 192 / t40 96**, and `spawn_ammo()` tells the phone
**192** at spawn. Those two disagree by construction, whatever the gun turns out to spend, and one of
them is wrong. That part is a display bug in MC, not a balance question.

**Scope.** The columns in doubt are the ones in `weapon-design.md`: reserve, sustained fire, and anything
per-kit, because they describe the weapon MC ships and they assume the catalogue number reaches the
player intact. `docs/manual/` and the public site are NOT in doubt: they publish each weapon's own
CAPTURED Callsign frame, which is a measured description of the stock gun (the Assault Rifle's capture
is `t16 32 / t17 384 / t39 32 / t40 192`, so a Callsign player carries 192).

**One piece of evidence for intent, not a conclusion.** The catalogue's `reserve: 192` is exactly the
capture's **t40**, the stock carry, not half of it. That reads as an author writing down what a player
should carry, which the compile step then halved a second time. The count in
`bench-perks-2026-09-18.md` §6 settles it, and nothing else should.

Two fixes, and they are not the same game. Writing the catalogue number to t40 **doubles what every
player carries** in every match, which is a balance decision. Halving what the HUD and the host are
told leaves the balance exactly as it is and makes the reported number honest. Do not take either
before the count.

### 6.3e Smoke: the one status effect that is real, and measured (fn 23)

Bench 2026-09-18. A single fn-23 word does this to the victim, and nothing else:

| what | measured |
|---|---|
| damage | **none**, at any pool. Health did not move on any hit |
| live accuracy | **100 → 0 in the same millisecond** as the `$HIR` |
| the victim's gun | still fires, still spends rounds, and **every shot misses** |
| what the shooter hears | near-miss whizz-bys, because the misses are real IR going past them |
| recovery | automatic and gradual: 0 → 2 → 4 → 7 → 12 over about 3 s |
| after it | nothing. No phantom, no residue, 12 s later the gun was silent |

**Call it smoke, not a flashbang** (Tony, on seeing it): a flashbang should sting, and this deals zero
damage. A weapon carries ONE `<t3,t4>` key and therefore lands on ONE function, so "blind them and take
a little health" cannot come from a single word. A real flashbang needs two words, which means two
shots or a station firing twice, and that is a design with a cost rather than a swap.

What it buys us, all with no firmware change:

- **A weapon that wins a fight without damage.** The jammer of §6.3c, now measured rather than assumed.
- **The stun we already ship, fixed.** `config.stun` used fn 24 and inherited its phantom bug; it ships
  fn 23 since F253, so the wire now does half the work and the node's disarm rides on a real effect.
- **Area denial**, if a station can emit it: walk through the cloud and you cannot shoot for 3 s.

⚠️ The player must be TOLD. Pulling the trigger, hearing your own gun, and watching nothing land reads
as a broken tagger. The node can detect it with no new wire support, because the accuracy token is
already parsed for recoil: a `$HIR` that moves no pool plus live accuracy at 0. That is **S53**.

### 6.3f Two axes the firmware has and we have never used

Both from the 2026-09-18 V4_31 trace (LaserTagMods session). Traces, not bench proof, but both are
concrete enough to design against.

**A real alt-fire.** `$WEAP` tokens 7 to 11 are live: **t7 is a chance percentage, t8/t9 are the `$SIR`
key that roll uses, t10 is its damage, t11 its crit chance**. They are empty on all 20 captured frames
because no stock weapon uses them, not because the firmware ignores them. When the roll hits, the barrel
word AND any headset word switch to the t8/t9 key. So "one shot in eight is a different kind of shot,
answered by a different row of the victim's table" is buildable with no firmware change. That was listed
as blocked in `perk-design.md` §4 and is not.

Combined with the crit finding it gives a clean proc mechanism: `t7` decides how often, `t8/t9` decides
what it is. A poison round on 15% of shots is exactly this shape.

**Crit damage is one token, and it is not the one we thought.** `$PSET` **t6** is the crit damage
multiplier: on a crit roll the shooter multiplies by `(100 + t6)/100`. We ship 50, which is the whole of
the x1.5 we measured. The pair is:

| token | what it is | who owns it |
|---|---|---|
| `$WEAP` t6 | crit CHANCE, a percentage of shots | the weapon |
| `$PSET` t6 | crit DAMAGE, `(100 + t6)/100` | the player |

⚠️ This also closes an old dead end. `$PSET` t6 was recorded as "unknown, 0 to 200 swept, no effect",
and the reason is now obvious: every stock weapon ships `$WEAP` t6 = 0, so a crit never rolled and there
was nothing for the multiplier to scale. **A crit-damage perk is one `$PSET` token**, and it is a
per-player lever rather than a per-weapon one, which is exactly what a perk wants.

### 6.4 What a weapon is now

The design space widened from one number to five independent choices:

| choice | token / field | what it decides |
|---|---|---|
| magnitude | `$WEAP` `t5` | how much |
| effect class | `$SIR` row function for `<t3,t4>` | damage / AP / multiplied / heal / armour / shield / status |
| polarity | function (dual-polarity set) | whether allies and enemies get different outcomes |
| crit | IR word **C** bit | ×1.5, per shot, ours to set |
| fire behaviour | `$WEAP` `t20`, `t23`, `t24`, `t37`/`t38` | full-auto / single / burst / charge / overheat |

None of it needs a Companion or host logic in the loop — the tagger applies the effect natively from
a table we wrote at game start. The practical consequence for `weapon-design.md` is that **§2's single-axis
balance (damage × cadence × ammo) is now the *floor* of the design, not its ceiling**, and the next
rebalance should treat the `$SIR` table as a first-class part of a weapon's definition rather than a
fixed backdrop.

### 6.5 Range is a carrier frequency, so our range ladder is largely fiction

⭐ **2026-09-18, V4_31 disassembly via the LaserTagMods session** (trace, not bench proof). The range tokens set the IR
carrier frequency, not the emitter power. The barrel and headset formulas are in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) §6 (the `2, 41` row); this section uses the barrel one.

So a low `t2` does not shorten the beam. It **detunes the carrier out of the receiver's roughly 38 kHz
band-pass**, and the "range" we have been tuning is really "how far out of tune is this shot". That
explains both of our measurements exactly: `t2` = 5 is 26.1 kHz and landed 0 of 38 shots even muzzle to
dome, and the knee we found near 31 is 29.4 kHz, the edge of the pass-band. **The knee belongs to the
receiver, not the firmware.**

⚠️ **What that does to the shipped ladder.** Converting our own values:

| band | carrier | weapons | what it means |
|---|---|---|---|
| 32.4 to 38 kHz | inside the pass-band | Sniper 100, AMR and Charge 85, AR, Burst and Toxin 70, Suppressor and Energy Rifle 55 | **eight weapons, all inside the receiver's window.** "Sniper 100 versus Suppressor 55" is probably not a difference a player can feel |
| 28.25 to 29.25 kHz | on the knee | SMG, Shotgun, Breacher and Haze 30, Rocket Launcher and Rail Gun 22 | **six weapons in the steep region**, where sunlight, angle and reflection dominate and behaviour is unstable |

That is the worst of both: the long weapons are undifferentiated and the short ones are erratic. It also
means **range may not be a usable balance axis in the direction we assumed** — you can make a weapon
short by detuning it, but you cannot make a sniper reach further than an assault rifle, because both are
already inside the window.

**So calibration changes.** S49 was going to walk a portable receiver out and read metres per `t2` value.
The right experiment is now to measure the **receiver's response curve in kHz**, once, and then pick each
weapon's value from that curve. Values above the knee barely move, so the whole design question is which
weapons sit below it and by how much.
