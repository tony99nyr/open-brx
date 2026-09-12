# Time-to-kill: the model shooters use, and how it applies to BRX

Reference for weapon balance work (docs/game-test-2026-09-11.md Block D item D2). Ground rules
below come from shipped-shooter community analysis and one probability-theory paper; BRX facts
come from `mcp/brx_mcp/mc/weapons.json`, `protocol/brx-protocol.md`, and `mcp/brx_mcp/mc/compile.py`.

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
140 ms/round gives `(13-1)*140 = 1680`, matching the catalog.

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
  `$ALCD` magnitude 0. **It ships OFF** (t21=t22=100, ceiling=floor, model disabled), so every weapon
  currently fires as if `p=1.0` regardless of a player's real aim. §2's accuracy-adjusted math is
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
