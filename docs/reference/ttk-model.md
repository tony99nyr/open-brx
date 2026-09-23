# Time-to-kill: the model shooters use, and how it applies to BRX

Reference for weapon balance work (docs/archive/game-test-2026-09-11.md Block D item D2). Ground rules
below come from shipped-shooter community analysis and one probability-theory paper; BRX facts
come from `mcp/brx_mcp/mc/weapons.json`, `protocol/brx-protocol.md`, and `mcp/brx_mcp/mc/compile.py`.

> ⚠️ **This page is a dated design log, not a live reference.** Every weapon number below is frozen at
> the date its own section was written (2026-09-11, then 12, then 17); none of it was updated for the
> 2026-09-23 sidearm and Burst Rifle changes (R6/R10, `docs/weapon-design.md`'s Balance rules table).
> **For the numbers a weapon ships with today, read `docs/weapon-design.md`'s Balance rules table and
> §2.2 — never this page.** Keeping two synchronised copies of the same wire values is how this page
> went stale the first time; it stays here for the REASONING (why a lever was chosen), which does not
> expire the way a number does.

## 1. The standard formulas

**Ideal (best-case) TTK**, the number every shooter community publishes first:

```
htk  = ceil(pool / dmg)                    hits to kill
ttk  = (htk - 1) * fire_ms                 first-shot-free convention
```

The first shot is assumed to land the instant the trigger is pulled, so it contributes zero delay;
only the *gaps between* shots count. This is the convention used across Modern Combat Wiki's and
the Game Balance Project's TTK writeups and every TTK calculator surveyed (xbitlabs, GameDevCalculators,
CalculatorsUniverse). BRX's own `ttk_ms` field already follows it exactly: `assault_rifle` htk 13 at
100 ms/round gives `(13-1)*100 = 1200`, matching the catalog (2026-09-17: native cycle, was 140 ms).

**Ideal vs practical/effective TTK.** Every source that goes beyond the raw formula makes the same
point: the number above assumes every shot lands. Destiny 2's community explicitly separates
"optimal TTK" (perfect accuracy, always headshots where relevant) from what a fight actually takes;
CS2/Halo-style TTK design writeups frame the same idea as "TTK doesn't consider accuracy, range or
the number of shots you miss" (Modern Combat Wiki; TTK Lab). Games with a simulated-recoil or bloom
model (Destiny, Apex, CoD) publish the ideal number as the headline stat and treat the accuracy-adjusted
number as a secondary, build- and skill-dependent figure, never the other way round.

## 2. Folding in accuracy

Treat each trigger pull as an independent Bernoulli trial with hit probability `p`. Hits accumulate
until `htk` of them have landed (a negative-binomial process); the expected number of *trigger
pulls* needed is:

```
expected_shots = htk / p
expected_ttk   = (expected_shots - 1) * fire_ms  =  (htk/p - 1) * fire_ms
```

This is the same reasoning laid out for gun/target engagements in Washburn's *Notes on Firing
Theory* (Naval Postgraduate School): hits-to-kill under a fixed per-shot kill probability follows a
geometric/negative-binomial law, and it is the model behind every community "TTK with X% accuracy"
table (Destiny's TTK-with-misses charts, the CoD "shots to kill at Y% hit rate" breakdowns).

A clean consequence: the **multiplier on expected shots is exactly `1/p`, independent of `htk`**.
What varies by weapon is the *cost* of that multiplier in milliseconds, because it scales with both
`htk` and `fire_ms`. The table below gives `htk/p - 1` (the "extra fire-cycles" term); multiply by a
weapon's `fire_ms` to get its expected TTK in ms.

| htk | p=1.0 (ideal) | p=0.8 | p=0.6 | p=0.4 |
|---|---|---|---|---|
| 5  | 4.00  | 5.25  | 7.33  | 11.50 |
| 9  | 8.00  | 10.25 | 14.00 | 21.50 |
| 13 | 12.00 | 15.25 | 20.67 | 31.50 |

Reading it: at 60% field accuracy every weapon takes roughly **1.7x** as long to kill as its ideal
number regardless of htk, but a 13-hit weapon loses ~8.7 fire-cycles to that multiplier while a
5-hit weapon loses ~3.3. This is the mechanism behind the community observation that low-damage,
high-rate-of-fire weapons are "punished more by misses" (repeatedly noted in CoD TTK/meta writeups):
they need more successes, so the same drop in accuracy costs them more absolute time and more
rounds out of the magazine, not just a proportionally equal tax.

Designers compensate for this the same few ways across every franchise surveyed: bigger magazines,
deeper reserve, forgiving hip-fire/spread at close range, or accepting that the weapon's role is
sustained suppression rather than dueling. BRX has no bloom/spread model of its own (see §3), so the
compensating knobs available here are magazine size and fire cadence, not aim assist.

## 3. BRX specifics

- **Pool.** 45 HP + 70 armour = **115**, confirmed in the current catalog and game-test sheet.
- **Damage per hit** is the `$WEAP` t5 magnitude (post any `wire.dmg` override), not the catalog's
  0-100 UI `dmg` bar, so `htk = ceil(115 / applied_dmg)`.
- **Cadence** is `$WEAP` t14, bench-calibrated 2026-09-10 as ~1:1 ms-per-round
  (`protocol/brx-protocol.md` t14 row). **No firmware floor has been measured**: how low t14 can go
  before rounds stop registering is open (tracked in `docs/bench-grenade.md` rung Z). 100 ms is
  proven reliable (the AR ships there); treat anything near it as similarly safe and don't propose
  going lower without a bench check.
- **Accuracy model.** BRX has a real one: t21/t22 (`maxAccuracy`/`singleShotAccuracy`) set a
  per-shot hit-probability ceiling/floor, bench-proven 2026-09-09, and a miss shows up on the wire as
  `$ALCD` magnitude 0. **The COMPILER ships it off** (t21=t22=100, ceiling=floor), because F230 found only one gun of
  three decays accuracy natively. The phone drives the same two tokens itself instead (S42, node-driven
  recoil), so a weapon fires at `p=1.0` until the player holds the trigger down, and the model's live
  value falls from there. §2's accuracy-adjusted math is
  therefore about **human aim**, not the gun's own model, until/unless t21/t22 get tuned deliberately.
- **Headset multiplier (footnote case).** A hit on the headset sensor multiplies the applied
  magnitude: `floor(magnitude * headset_multiplier(fn, crit_modifier))`, bench-confirmed
  2026-09-11 as `1 + cm/200` on one function and `1 + 2*cm/100` on another (`compile.py:147-158`),
  where `cm` is the compiled `$GSET criticalShotModifier`. This is per-hit-location, not a flat
  weapon-wide number, so it belongs in the catalog as a footnote ("all-headset TTK at the compiled
  crit modifier"), never folded into the headline ideal TTK.

## 4. Recommendation: how Open BRX should state weapon balance

1. **Ideal TTK** (current `ttk_ms`, first-shot-free, `p=1.0`) stays the headline catalog number, matching how every surveyed shooter publishes its own stat. Keep the name "ideal", not
   "TTK", so nobody reads it as a promise.
2. **Practical TTK** at one stated field accuracy, shown once BRX has real hit-rate data. There is
   no bench measurement of actual player accuracy yet. Do not publish a practical number sourced
   only from a guessed `p`; the §2 table lets a designer sanity-check relative weapon standing
   without needing that data, but a public "practical TTK" figure should wait on a bench gate.
3. **Headset TTK** as an explicit footnote per weapon, computed from `headset_multiplier` at the
   currently-compiled `crit_modifier`, labeled "all-headset" so it reads as a best case, not a
   second official number.
4. Any weapon whose ideal TTK depends on accuracy assumptions the arsenal doesn't yet enforce
   (t21/t22 off) should say so; the pool is currently accuracy-blind at the gun level.

## 5. Sidearm proposal

**Constraint check against the current rows.** `weapons.json`'s own `_note` already declares
sidearms "deliberately dominated by primaries," and `test_mc_sidearms.py`'s
`test_pistol_identities_keep_the_counter_strike_ordering` currently pins **glock = lowest damage
and fastest cadence, deagle = highest damage and slowest, usp in the middle of both** (the CS
`glock/usp/deagle` identity). ⚠ **The brief for this proposal, "Deagle most damage but slow, USP as
fast as the trigger with low damage, Glock in the middle," swaps glock and usp's rank on both axes.**
That is a real conflict with the existing test, not a rounding difference; flagging it rather than
silently picking a side. The table below follows the brief as given; landing it means updating that
test's three `assert` orderings to match, not just the catalog data.

Also: current `glock`/`bolt_rifle` both sit at ideal TTK 1800 ms, tied with, not slower than, the
slowest rifle. The brief requires strictly slower than every rifle (assault-class rifles run
1650-1800 ms), so the redesign below gives every sidearm the same **1920 ms** ideal TTK, about 7%
past the slowest rifle, and differentiates them entirely through how they degrade under real aim.

| | fire_ms | dmg | htk | mag | ideal ttk | expected ttk @ p=0.7 | one-mag kill @ p=0.7 |
|---|---|---|---|---|---|---|---|
| **USP** (fastest trigger, lowest dmg) | 160 | 9 | 13 | 16 | 1920 ms | ~2811 ms | ~24% |
| **Glock** (middle) | 240 | 13 | 9 | 16 | 1920 ms | ~2846 ms | ~93% |
| **Deagle** (most dmg, slowest) | 480 | 26 | 5 | 7 | 1920 ms | ~2949 ms | ~65% |

(`htk = ceil(115/dmg)`; `expected ttk = (htk/0.7 - 1) * fire_ms`; one-mag-kill is
`P(>= htk hits in mag shots)` at `p=0.7`, binomial exact for the Deagle, normal-approximated for the
other two.)

**Why nothing dominates.** All three share one ideal TTK, so the pick is never "which kills
fastest with perfect aim," it's "which trade-off matches your aim and situation":

- **Deagle** looks best on paper (fewest hits, most forgiving of any *single* miss) but its huge
  fire_ms means every miss is expensive: at 70% accuracy it is actually the **slowest** of the three
  in expected time, and a 7-round cylinder only closes the kill in one load about two times in three.
- **USP** needs 13 hits, so misses compound fast (the §2 mechanism directly), and a 16-round mag
  still runs out before finishing a kill roughly three fights in four at 70% accuracy. It wins on
  raw expected-TTK speed but is the least likely to close a fight without a reload.
- **Glock**, sitting in the middle of both axes, is also the safest bet on ammo: 93% one-mag kill at
  70% accuracy, with an expected TTK between the other two. It is not the fastest or the punchiest,
  but it is the hardest to be caught reloading with.

No row wins on every axis, which is the property `test_ttk_band` and the sidearm-dominance note ask
for (dominated by primaries, not dominant among themselves). Reserve ammo (not specified above)
should scale with mag the same way the current rows do, roughly 5-6x mag size.

## Shipped 2026-09-12

D2 (`docs/archive/game-test-2026-09-11.md`) landed with one change from §5's proposal: the **USP's mag went
16 → 20**. At `p=0.7` a 13-hit USP with a 16-round mag empties the magazine before landing the kill
roughly three fights in four (a 25% one-mag-kill rate); 20 rounds brings that to a more usable 77%
without moving its ideal TTK (the mag size never enters the ideal-TTK formula). Reserve for all three
rows was then chosen — not simply carried over at "5-6x mag" — specifically to avoid a hidden
domination: with all three sidearms tied on ideal TTK, `test_ttk_band_and_no_strictly_dominant_weapon`
compares them on sustained DPS and total kills too, and a naive "same mag multiplier for every row"
reserve gave the Glock the best sustained DPS **and** the most total kills at once (see below), which
is a strict win on every published axis. Deagle's reserve was raised (36 → 48) and Glock's cut
(120 → 64) so the three axes never agree.

| | wire (dmg / fire_ms / mag / reserve) | ideal ttk | expected ttk @ p=0.7 | one-mag kill @ p=0.7 | sustained dps | kills/kit |
|---|---|---|---|---|---|---|
| **USP** (fastest trigger, lowest dmg) | 9 / 160 / 20 / 120 | 1920 ms | ~2811 ms | ~77% | 33.3 | 10 |
| **Glock** (middle) | 13 / 240 / 16 / 64 | 1920 ms | ~2846 ms | ~93% | 34.4 | 8 |
| **Deagle** (most dmg, slowest) | 26 / 480 / 7 / 48 | 1920 ms | ~2949 ms | ~65% | 32.7 | 11 |

(`expected ttk` and `one-mag kill` as in §5, now binomial-exact for all three since every mag is
small enough to sum directly. **F255 (closed 2026-09-18):** the `reserve` and `kills/kit` figures here are the catalogue number, and the bench confirmed a player really carries it: `$AMMO,0,32,192` rides `frames.spawn` AND `frames.revive`, so the gun is set to the full catalogue reserve at every spawn and the HUD agrees with it; the halved `t40` is live only in the ~200 ms between the `$WEAP` and the `$SPAWN`. `sustained dps` and `kills/kit` are the two axes
`test_ttk_band_and_no_strictly_dominant_weapon` checks alongside TTK — `mag*dmg/(mag*fire_ms +
reload_ms)` and `(mag+reserve)//htk`.)

**No row wins on every axis, verified, not just argued.** Sustained DPS ranks Glock > USP > Deagle;
kills/kit ranks the exact opposite, Deagle > USP > Glock. The two axes invert end to end, so nothing
is a strict win: the Glock that out-sustains everyone also runs out of ammo first, and the Deagle
that carries the most rounds has the worst sustained output while it fires.
`test_ttk_band_and_no_strictly_dominant_weapon` passes across the full 22-weapon roster with this
table, not only among the three pistols.

> ⚠ **2026-09-17: this claim no longer holds as originally written.** Retiring "kills/kit" as a
> dominance axis (§Shipped 2026-09-17 below) retired the exact lever this section describes — with
> reserve out of the picture, **USP strictly dominated Deagle** until a second, smaller fix (USP mag
> 20 → 19) closed it again. The numbers in this table are historical; the current axes, the sidearm
> mag change and the full reasoning are in §Shipped 2026-09-17.

**Wire tokens changed** (`mcp/brx_mcp/mc/weapons.json`, `wire` block + top-level `mag`/`reserve`):

| weapon | dmg (t5) | fire_ms (t14) | mag (t16/t39) | reserve (catalogue, written to t17) |
|---|---|---|---|---|
| USP | 13 → **9** | 200 → **160** | 12 → **20** | 72 → **120** |
| Glock | 9 → **13** | 150 → **240** | 20 → **16** | 120 → **64** |
| Deagle | 24 → **26** | 375 → **480** | 7 (unchanged) | 36 → **48** |

`reload_ms` (2200) and `swap_ms` (500, tok15) are unchanged on all three. The captured-frame
invariants (`tok39 == tok16`, `tok17 == 2*tok40`) hold at every new value shown.

**Bench gate.** Try the three pistols back to back, then run one sidearm-only round
(`loadout_policy.primary.kinds = ["sidearm"]`) and ask: does any one pistol feel like the obvious
pick? The numbers say no (equal ideal TTK, inverted sustain/ammo trade-off), but this is exactly the
kind of claim the arsenal has been burned by before (§3's headset-multiplier and t21/t22 accuracy
notes) — it needs a body on the bench, not just a spreadsheet, before it ships as verified.

## Shipped 2026-09-17: family-scoped dominance, the lead rule, and the primaries retune

**Axis change (Tony's decision, first pass).** `test_ttk_band_and_no_strictly_dominant_weapon` used
to check {ideal TTK, sustained DPS, total kills from a full kit (`(mag+reserve)//htk`)} GLOBALLY.
Reserve ammo is retired as an axis entirely: a respawn refills the whole kit, so how many kills a
full kit could theoretically produce is not a fact about any single life a player actually fights.

**The retune.** Eight primaries were pulled toward new ideal-TTK targets (dmg/cycle `wire` overrides
only, mag/reserve/reload untouched except the Charge Rifle's cell and, in the second pass below,
Suppressor and USP):

| weapon | dmg (t5) | cycle ms | hits | ideal TTK | one-mag kill % @ p=0.7 |
|---|---|---|---|---|---|
| Assault Rifle | 9 | 100 | 13 | 1.20 s | 100% |
| SMG | 8 | 95 | 15 | 1.33 s | 100% |
| Burst Rifle | 11 | 75 +275 | 11 | 1.42 s | 100% |
| Shotgun | 45 | 800 | 3 | 1.60 s | 93% |
| AMR | 24 | 400 | 5 | 1.60 s | 100% |
| Sniper Rifle | 60 | 1500 | 2 | 1.50 s | 92% |
| Energy Rifle | 9 | 150 | 13 | 1.80 s | 100% |
| Suppressor | 8 | 140 | 15 | 1.96 s | 100% |
| Charge Rifle | 85 charge / 20 tap | 1250 | 3 (release-to-kill, see below) | 1.00 s | 92% |

Full table, every weapon, `docs/weapon-design.md` §2.2.

**⚠ First pass shipped RED, on purpose, with the conflict fully written up: two effects.** (1) The
Assault Rifle's native 100 ms cycle was already documented BEFORE this pass as failing the global
dominance check "by design" — the 2026-08-30 retune to 140 ms existed specifically to avoid it, and
reverting it (Tony's explicit instruction) reintroduced that dominance, with the Burst Rifle and SMG
picking up similar wins over slower, heavier-hitting weapons for the same reason (a fast, deep-magazine
automatic's one-magazine kill chance saturates near 100% almost regardless of `htk`). (2) Retiring
"total kills" also retired the lever §Shipped 2026-09-12 used to keep the sidearm trio non-dominant —
with it gone, **USP strictly dominated Deagle**.

**Second pass (same day, Tony's follow-up): four changes that closed it clean.**

1. **The dominance check now runs WITHIN A FAMILY**, not globally (`_weapon_family()`:
   fire mode `t20` + `weapon_class`, sidearms their own family regardless). An SMG beating a Sniper
   Rifle on every axis here is not a balance failure — neither range nor recoil exists on the wire yet
   (F231, S42), and a Sniper Rifle's whole identity IS range, which this model cannot see. Scoping to
   family removes cross-family "violations" that were never meaningful comparisons to begin with; full
   reasoning and the family list are in `docs/weapon-design.md` §2.3.
2. **Kills per clip** (`mag // rounds_to_kill`, deterministic) joins the axis set alongside ideal TTK,
   sustained DPS and the probabilistic one-magazine kill chance — Tony's call was BOTH the
   deterministic and the probabilistic framing, not one instead of the other.
3. **The lead rule**: every visible weapon must achieve its family's best value (ties count) on at
   least one of the four numeric axes. `recoil.floor` and `range_band` were part of this rule for one
   day and were removed in polish round 2 (2026-09-17): both are declared catalogue DATA for levers
   that do not reach the wire yet (`test_range_and_recoil_are_declared_not_wired` is the guard), so a
   lead claimed on either could be satisfied by inert data. The four numeric axes caught the two
   remaining gaps below on their own; strict dominance alone would have missed them.
4. **Two number changes, each the smallest found**: **Suppressor mag 48 → 75** (same family as the AR
   and SMG; the SMG beat it on ideal TTK and sustained DPS, and 75 is the smallest integer mag that
   gives Suppressor a strict kills-per-clip lead, 5 vs the SMG's 4 — 60 only ties it). **USP mag 20 →
   19**, not Tony's suggested 14: at 14 the sustained-DPS and one-magazine-kill-chance axes fall so far
   (a shallow magazine spends proportionally more time reloading) that **Deagle ends up dominating USP
   instead**, a reversal rather than a fix; 19 is the only integer in range where neither pistol beats
   the other (a thin margin — sustained DPS differs by about 0.1 dmg/s, kill chance by 2 points).

**The Charge Rifle's `htk`/`ttk_ms` also changed model, separately (F225/F226/S43).** The catalogue
used to publish `ceil(pool/85) = 2` "hits", silently treating every hit as a full charge. It now
counts the REAL combo — 1 charge plus however many taps close the rest of the pool (3 actions, 12
rounds, at the 115 pool) — and `ttk_ms` is RELEASE-to-kill (1.00 s: the two taps' cost,
`WeaponCatalog.CHARGE_TAP_CADENCE_MS` = 500 ms each, a documented placeholder pending a bench-measured
tap cadence), not charge-to-kill: the pre-built charge is setup behind cover, not combat time, and is
exempt from the TTK band for exactly that reason. The sustained-DPS and one-magazine-kill-chance axes
keep the simpler "repeated full charges" model (a charge is near-certain once released; there is no
per-action accuracy model to mix that with a tap's p=0.7 pull) — a deliberately different question
("how hard can this sustain fire") from "what does the one pre-built kill cost".

**Result: zero dominance violations, every visible weapon leads its family on at least one axis.**
`docs/weapon-design.md` §2.3 has the full family list and the per-weapon lead reasoning.

## Sources

- [Time-to-kill: Modern Combat Wiki](https://moderncombat.fandom.com/wiki/Time-to-kill)
- [Time to kill: The Game Balance Project Wiki](https://tgbp.fandom.com/wiki/Time_to_kill)
- [TTK Calculator: xbitlabs](https://www.xbitlabs.com/ttk-calculator/)
- [FPS TTK Calculator: GameDevCalculators](https://gamedevcalculators.com/tools/fps-ttk-calculator)
- [Destiny 2 TTK Chart: blueberries.gg](https://www.blueberries.gg/weapons/destiny-2-ttk/)
- [Game Agnostic TTK Calculator: protovision](https://protovision.github.io/ttk-calc/)
- [D2 TTK Cheatsheet](https://d2-ttk-cheatsheet.vercel.app/)
- [Notes on Firing Theory, A. Washburn: Naval Postgraduate School (PDF)](https://faculty.nps.edu/awashburn/Files/Notes/FiringTheory.pdf)
- [Damage accumulation and probability of kill for gun/target engagements: ResearchGate](https://www.researchgate.net/publication/324123854_Damage_accumulation_and_probability_of_kill_for_gun_and_target_engagements)
- [How TTK Works in MW3: Game8](https://game8.co/games/MW3/archives/435289)
- [Time to kill is the new aim assist: urscrubb (Substack)](https://urscrubb.substack.com/p/time-to-kill-is-the-new-aim-assist)
