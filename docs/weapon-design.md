# Weapon design & balance

## Balance rules

The single place Tony's balance decisions live. Every other page links here instead of restating a
rule; only this table changes when a decision changes. "Enforced by" names a test, a bench id, or
says the rule is judgement only.

A proposed weapon, weapon change or perk change goes through the balance review first:
`python3 mcp/tools/balance_review.py --candidate <file.json>` (the `balance-review` skill is the loop).
It checks that the change adds value, dominates nothing, is viable, breaks no rule here and keeps one-shots
in the pickup tier. Each review and Tony's call is logged in [balance-decisions.md](balance-decisions.md).

| # | rule | decided | id | enforced by |
|---|---|---|---|---|
| 1 | Recoil rungs count ROUNDS PER TRIGGER PULL, scaled by calibre: a reference 8-damage weapon fires 5 clean rounds then degrades, 3 more then goes heavy, both counts scaled by `8 / dmg`. A trigger release resets the count while the weapon is still crisp; recovery from degraded or heavy needs 600 ms of quiet. | Tony, 2026-09-23 | S54/F268/F280 (`aa7b08b9`) | `app/test/engine.test.mjs` "S54: the round counts are derived from the row's dmg…"; `mcp/tests/test_balance_sim.py::test_recoil_profile_pins_the_shipped_ar_against_the_engine_test`. The release-reset half is bench-provisional (F308) |
| 2 | A one-press burst or single-shot trigger does not recoil at all — the Burst Rifle and the Charge Rifle both ship flat (`ceiling == floor == 100`). | Tony, 2026-09-23 | S54/F280 | `mcp/tests/test_balance_sim.py::test_recoil_profile_pins_the_engine_tests_synthetic_rows_too`, `::test_the_charge_rifle_carries_no_recoil_profile` |
| 3 | Recoil floors are 60 for the SMG and the Stinger. The Assault Rifle is the deliberate exception, deeper still at 100/70/45, degraded from round 6 and heavy from round 7 (tightened from round 8 the same day, R7 row 11; `heavy` eased 40 → 45 the following day, polish round 2 — "full auto point blank … too harsh") — only a player who holds past round 6 is punished. The Suppressor is the exception the OTHER way (R10, row 12): Tony — "it should be weaker since its silent but not too weak" — so its `heavy` is declared at 70, not the 60 floor; `degraded` derives between crisp and the new heavy, to 85 (was 80). | Tony, 2026-09-18 (floor raise); the AR exception 2026-09-23; tightened 2026-09-23 (R7); eased 2026-09-24 (F308, polish round 2); the Suppressor exception 2026-09-23 (R10) | F268; F291 (`1884c90e`); F308 | same two tests as row 1; the per-weapon table in `docs/spec/node.md` §3.15 |
| 4 | Three duel rules, each "most of the time" meaning **≥ 65%** in a stochastic 1v1 at full Standard health: (R1) a Charge Rifle with its charge already built beats an Assault Rifle; (R2) a skilled Assault Rifle (controlled 3-5 round bursts) that catches an uncharged Charge Rifle beats it; (R3) an Assault Rifle firing controlled bursts beats one held in full auto. | Tony, 2026-09-23 | F291 | `python3 mcp/tools/balance_sim.py --scenario recoil-duel`; gated in CI by `mcp/tests/test_balance_sim.py::test_recoil_duel_rules_clear_the_65_percent_bar` |
| 5 | Charge Rifle: charge damage 70 (`t5`), tap damage 16 (`t37`); a charged kill on Standard health is one charge plus three taps. The 285 ms tap cadence is the player's own trigger-pull speed, not a gun setting — no `$WEAP` field carries it. | Tony, 2026-09-23 | F280; F291 (`3759cd68`) | `weapons.json` `wire.dmg`/`wire.tap_dmg`, pinned by the row-4 CI gate; `CHARGE_TAP_CADENCE_MS`'s comment in `compile.py` |
| 6 | Shotgun: 3 pulls to kill on Standard health, still no recoil model — it has none. Its gap from the rifles was the 800 ms cadence until row 11's R8 tightened it to 700 ms. 2026-10-17: 700 → 400 ms, so it wins close range against the rifles and the SMG under the player-paced model (row 14). Its pull stayed at 40 (20 + 20) until F579 (2026-10-24) moved the gun word to 19, so a pull is 39: 45 or more would one-shot the 45-health presets, and the 4 pulls it needs at the AP check's armoured 140 pool keep Armour Piercing a trade (AP 15 at 500 ms). | Tony, 2026-09-18; retuned 2026-09-23 (R8), 2026-10-17 (R11/R12) and 2026-10-24 (F579) | F291; F308; F579 | 3-pull kill is judgement; the cadence is gated by row 11's test |
| 7 | One-shot heavies (Rocket Launcher, Rail Gun, Laser Cannon, Energy Launcher, Ion Sniper) are a pickup-only tier: 2-round magazine, 4 kills total, earned at close range rather than out-reaching the rest of the arsenal. On the Shields preset (150): the Rocket Launcher's headset word adds 35 (`wire.headset_dmg`), so a close hit still kills (the word's reach is unmeasured, F275); the Rail Gun does 149 (`wire.dmg`), a kill on Standard and Hardcore that leaves a full Shields player on 1 HP. | Tony, 2026-09-17; Shields 2026-09-23 (F310) | weapon-design.md §2.1 principle 7; §7.5f | `mcp/tests/test_weapon_derivations.py` §2.5 rows; the bench check in `bench-2026-09-24.md` 4.9 |
| 8 | The headset is the primary target: 4 of the tagger's 5 hit sensors sit there, so it carries no bonus multiplier. `criticalShotModifier` (`t7`) compiles to 0, and a headset hit lands the same as a gun-body hit. | Tony, 2026-09-17 (arsenal review) | — | `mcp/tests/test_gameconfig.py::test_crit_modifier_defaults_to_zero_and_headset_multiplier_is_1x` |
| 9 | Easy Reload is accessibility, not balance: it is never tuned or cut on balance grounds, and it lives beside the per-player pool handicap, independent of the perk slot. | Tony, 2026-09-17 ("my daughter cant reload the brx normally") | S50 | `mcp/tests/test_mc_loadout.py::test_easy_reload_is_refused_beside_a_chain_reload_weapon`, `::test_easy_reload_is_refused_beside_a_second_weapon_end_to_end` |
| 10 | The rebalance changes numbers, not feel: every weapon keeps Battle Company's captured fire mode, burst pattern, heat/overheat mechanic and sound; only the declared balance tokens move. | design principle, ongoing | weapon-design.md §2.1 principles 1-3 | judgement, not tested |
| 11 | R4-R9: six close/mid-range duel rules (close = gun + headset word, mid = gun word alone), each **≥ 65%** — except R7 (the Burst Rifle beats a full-auto AR), whose bar is **≥ 55%**. Modelling the Burst Rifle's 40% crit reopened R4b and R6; Tony kept the crit and moved the burst gap again, 410 → 550 ms, the smallest single-token value that clears all four affected cells — see §7.5d. **2026-09-24, polish round 2** (bench 4.3, "full auto point blank … too harsh"): Tony chose to ease the Assault Rifle's `heavy` recoil 40 → 45 and the Burst Rifle's burst gap 550 → 540 ms rather than hold the deeper numbers — "leave the AR at 45 … I like our rock paper scissor design": a bursting AR still beats a full-auto AR and the Burst Rifle, and the Burst Rifle still beats a full-auto AR, now **more often than not** (R7, ~57%) rather than most of the time. R3 and R6 stay at 65% (both clear it, ~67%/~66%). | Tony, 2026-09-23; eased 2026-09-24 | F308 | §7.5d; `mcp/tests/test_balance_sim.py::test_range_duel_rules_clear_their_bar` |
| 12 | R10: sidearms finish a kill, they do not compete with rifles — real-world Desert Eagle cadence and USP magazine levers, plus the Suppressor's own recoil exception. All fourteen checks clear their bars. See §7.5e. **2026-10-17:** the R10a finish bar moved 1.0 → 1.2 s (Tony: "1.2s on the pistol time to finish seems fine"), and the USP moved to 12 damage at 190 ms (Tony: "ok to finish a player on standard life if you hit 10/12 shots"). It now kills on one 12-round magazine, which ends the 2026-09-23 forced reload. **2026-10-24 (F579):** damage 12 → 10 (Tony: "sounds good"), so the rifles win the R10b duel at field pace; a kill is 12 hits, still one magazine. Tony also wants both pistols to "feel weak against the rifles". **2026-10-24 (F576):** the duel result (R10b) tests that, not the published TTK. The USP published 2.10 s then, faster than the Burst Rifle's 2.53 s; since F579 (10 damage) it publishes 2.56 s. | Tony, 2026-09-23; 2026-10-17; 2026-10-24 (F579) | F308; F579 | §7.5e; `mcp/tests/test_balance_sim.py::test_r10_sidearms_finish_a_kill_within_the_bar`, `::test_r10_primaries_beat_sidearms_at_65_percent` |
| 13 | Every rule R1-R12 also holds on the Shields preset (150 pool) at a looser **≥ 60%** bar; Hardcore is reported, not gated. **2026-10-17:** the pistols stay weak on Shields, with no shield-damage multiplier (they win 0 to 12% against a rifle there). Tony: "on shields you kinda have to win a gun battle, maybe a couple peek battles and then switch and run at them to finish them. the pistol is still good for that". | Tony, 2026-09-23 (F310: "looser but generally yes", then "60 is fine") | F310 | `mcp/tests/test_balance_sim.py::test_shields_preset_recoil_rules_r1_to_r3`, `::test_shields_preset_range_rules_r4_to_r9`, `::test_shields_preset_primaries_beat_sidearms_r10b`; detail §7.5f |
| 14 | An ordinary single-shot weapon (`t20` = 7) publishes the fight interval: `t14` plus about 43 ms, the expected overshoot from the 2026-10-17 field fit. The fit has a 36.67 ms median overshoot and log-sigma 0.56. The 300 ms mean pull still drives the Sniper bolt lever and its next press; its published cycle remains about 2705 ms. The earlier 300 ms renewal model remains in the legacy sim, while fights use the field fit. Retuned on 2026-10-17: Shotgun 400 ms; AMR 26 damage at 350 ms, then 450 ms on Standard and Shields (2026-10-25); USP 12 at 190 ms (10 since F579, row 12); hidden Bolt Rifle 15 at 150 ms. The Desert Eagle and Sniper Rifle kept their wire numbers. | Tony, 2026-10-17 ("all the single shot guns need sim", "average across players") | field 2026-10-17; F576, 2026-10-24 | `compile.FIGHT_OVERSHOOT_MS`; `mcp/tests/test_balance_sim.py::test_published_single_shot_cycle_matches_both_fight_sims` |
| 15 | R11/R12: the Shotgun wins close range against every rifle with a combatant (a full-auto AR, the AMR, beside R4's bursting AR and Burst Rifle) and loses past headset range to each of them, ≥ 65% (Shields 60%). | Tony, 2026-10-17 ("shotgun should win close range battles", "definitely lose out of headset range battles" against other rifles) | field 2026-10-17 | `mcp/tests/test_balance_sim.py::test_range_duel_rules_clear_their_bar` |
| 16 | Reserves are doubled across the loadout weapons (magazines and reload times unchanged; the pickup-only heavies, melee, the Stripper and the Smoke Gun unchanged): players ran dry in several field games. A compiled reserve never exceeds max(384, the row's own reserve), the largest ordinary reserve a gun has echoed, until `bench-field-1017.md` P1.0 lifts it. | Tony, 2026-10-17 ("could we keep the same balance but increase reserves across the whole armory?") | field 2026-10-17 | `compile.RESERVE_PROVEN_MAX`; `mcp/tests/test_mc_loadout.py::test_extended_mags_doubles_a_reserve_below_the_ceiling_and_stops_at_it` |
| 17 | The Sniper Rifle is a bolt action: one round in the magazine, a reload-lever pull per shot (`reload_ms` 2200 is the bolt; 1500 until 2026-10-18), 75 damage (two hits on 115, 140 and 150, under every preset's pool), swap delay (`t15`) 500. Perks leave the bolt and its magazine alone. It is out of the TTK band and has its own dominance family, because its fight is a peek, the bolt in cover, and a second peek. Its gate is the marksman rush counter: against players who do not rush, the peeking Sniper is strong (peek-kill at least 50%, near top at long range); against a rush from 20 m it loses at least half the time. At 75 damage the sim says it does not. With the 2.2 s bolt a rush from 20 m wins 35% against a plain Assault Rifle and 34% against one with Body Armor, so the rush counter fails; the Sniper is also not near the top in the strong column "1v1 long", so the strong half fails too. Both halves of `marksman_rush_counter` fail. Tony chose two hits over the rush counter, and on 2026-10-18 a 2.2 s bolt (F573: "Ok lets do 2.2s bolt and 75. Yes bench it.  Next real match ill play it and see how it feels"; the field match is the judge). The recorded verdict fails `marksman_rush_counter` and `balance_kept` (the AMR and CR+Sniper+BA lose their last near-top cell); see `docs/balance-decisions.md`. On Shields it wins only 35% of open mid-range fights, by design: it must peek. The published TTK uses `paced_cycle_ms`: a lever pull gap, the bolt, then the first press after it (about 2705 ms per round: 300 + 2200 + 205). The duel engine in `balance_review.py` waits a full pull gap after the bolt (about 2800 ms per round: 300 + 2200 + 300). A verdict therefore runs about 95 ms per round slower than the published TTK. The phone shows a short BOLT cue, not the RELOADING takeover. | Tony, 2026-10-17 ("we dont have any pure bolt action where you have to pull it back every shot", "the weakness is definitely rushing the sniper bc he must hit shots to get kills", "sniper should feel strong until players recognize the strat to rush the sniper. but balanced properly") | field 2026-10-17 | `compile.WeaponCatalog.paced_cycle_ms`'s bolt branch; `mcp/tools/balance_review.py` `marksman_rush_counter`; `bench-field-1017.md` P2.5 |
| 18 | Kits and perks: Fast Hands has no swap floor, and no kit rule limits the secondary. The 2026-10-17 team sim covered the earlier swap-only perk, so its result does not establish the new kit's balance. Add the long mid-range scenario before tuning the Burst Rifle, Suppressor, Energy Rifle or AMR. A new weapon or variant goes through `balance_review.py` and is recorded in [`balance-decisions.md`](balance-decisions.md). | Tony, 2026-10-17 ("we should have enough rock paper scissor in the sandbox that players find different good combinations for their play styles. nothing should be completely dominant at everything") | field 2026-10-17 | `mcp/tools/balance_review.py` |

## ⚠️ Three arsenals, and only one of them is ours

A weapon number in this repo means nothing until you know which arsenal it came from. Two sessions
argued past each other for two rounds on 2026-09-17 because one quoted a reserve figure from the
second list while diagnosing a bug in the third.

| name | what it is | where its numbers live |
|---|---|---|
| **gun-menu weapons** | the 5 to 7 presets the tagger's own firmware carries, for play with no phone at all (M-4, SMG-X3, MG-7, SR-100, TAC-87) | Battle Company's printed manual, quoted in `manual/gameplay.md` |
| **Callsign weapons** | the 19 weapons Battle Company's own app sends. We hold 20 captured `$WEAP` frames. These are MEASURED FACTS about someone else's product and we never change them | `reference/weapons.md`, `manual/gameplay.md`, and §1.2 below |
| **Open BRX weapons** | what OUR Mission Control compiles and pushes. Every row is BASED ON a captured Callsign frame, then a balance pass overwrites specific tokens. This is what a player on our field actually meets | `mcp/brx_mcp/mc/weapons.json`, and §2 onwards below |

So the same weapon carries two sets of numbers on purpose. The Assault Rifle is 9 damage at 100 ms in
both, because the rebalance kept those, but its spare ammunition, its range and its accuracy tokens
differ. **Every table in this document says which arsenal it is**, and every reserve figure names the
token it came from, because "reserve" alone is ambiguous even inside one arsenal (F255).

What our weapons are, why their numbers are what they are, and where every one of them comes from.

**Rewritten 2026-08-26 (second pass).** The first version of this document was built on a
four-sample template system and a mis-read token map. Both are gone. **Every weapon is now based on
its own captured Callsign `$WEAP` frame**, and the balance below is written on top of those frames.
Where the earlier analysis was wrong, it is marked *retracted* rather than quietly deleted.

- **Roster:** `mcp/brx_mcp/mc/weapons.json` — each row carries `capture.frame` (the real frame Battle
  Company sent) plus a `wire` block listing only the tokens we deliberately overwrite.
- **Adding one:** `docs/adding-weapons.md` is the implementation and field-proof checklist. A catalog row
  alone is not support; the victim SIR table, phone runtime, HUD, compatibility gate, and release APK are
  part of the same change when the behavior needs them.
- **Raw traces:** `protocol/captures/raw/` · decode with
  `python -m brx_mcp.weapmap protocol/captures/raw/*.btsnoop` · named table in
  `docs/reference/weapons.md`.
- **Token map:** `protocol/callsign-extract/protocol-classes.md` · **bench truth:**
  `docs/archive/session-findings-2026-08.md` §7r and the 2026-08-26 probe entries.
- **Sound bank:** `protocol/callsign-extract/sound-bank.md` (prefix legend credited to David Knox,
  shared by the owner community).

Protocol discovery credit: **LaserTagMods** (JEDGE/JBOX). Stock firmware is never modified — every
value here is a number we send in a `$WEAP` frame over BLE.

---

## 0. The damage model

Hardware-true, from `docs/archive/session-findings-2026-08.md` §7r and the 2026-08-26 damage experiment:

- The default pool is **115 = 45 HP + 70 armor** (`compile.py`, `health: {max_hp: 45, max_armor: 70}`).
- **Armor absorbs at face value and spills into HP** — 70 → 46 → 22 → 0, then into HP.
- ⚠ **"No multiplier, no reduction" was true only of the rows we had seen.** The IR work (**[ir-effects §6](ir-effects-design.md)**)
  shows the victim's `$SIR` row can multiply the incoming magnitude (×1.25, ×2), bypass armor
  entirely, or apply it to a pool instead of subtracting it — and that a **shield** pool exists above
  armor. Everything in §0–§5 assumes a standard-damage row against a shieldless victim.
- **`t5` is the RAW magnitude, not the applied damage** — `$HIR` token 5 echoes the magnitude, and the
  victim's `$SIR` row decides what lands ([ir-effects §6.2](ir-effects-design.md)). The earlier "applied damage, exactly, four weapons"
  reading held only because all four keyed to plain-damage rows.
- The stock Assault Rifle deals **9**, not the manual's 24. The manual is stale.
- Damage drains **shields → armor → HP**; armor overflow spills into shields ([ir-effects §6.1](ir-effects-design.md)).

| term | formula |
|---|---|
| **htk** | `ceil(pool / dmg)`, where `pool` is the host's `max_hp + max_armor` (115 at the defaults, and the column used throughout this document) — it MOVES with the health config, see §2.5. Also see [ir-effects §6.2](ir-effects-design.md): this is the raw-`t5` reading and is wrong for five shipped weapons |
| **cycle** | `t14`, ms between shots (for charge weapons, the charge time) |
| **TTK** | `(htk-1) × cycle`; burst weapons use the burst-average cycle, and a single-shot weapon (`t20` = 7) the player-paced cycle, about `t14` + 43 ms (Balance rules row 14, 2026-10-17 fit). ⚠️ **Charge weapons are the exception since 2026-09-17**: their kill is one held charge plus the taps that finish it, so TTK is measured from the RELEASE and the charge time is setup, not combat (§2.2, S43). |
| **burst average** | `(2 × t14 + t23) / 3` — three rounds at `t14` spacing, `t23` between bursts |
| **sustained DPS** | `mag × dmg / (mag × cycle + reload_ms)` |
| **total kills** | `(mag + reserve) // htk` |

TTK is the honest headline. DPS flatters weapons that need many hits, and every hit is a discrete IR
event that can miss.

---

## 1. Every weapon starts from its own captured frame

`resolve()` starts from the weapon's own captured Callsign frame and writes only the balance tokens.
The weapon keeps every behaviour we cannot synthesise: fire mode (`t20`, §4.1), burst timing, overheat,
damage type, reload type, charge sounds, reload chains and the real fire sound. The Callsign numbers
are in [reference/weapons.md](reference/weapons.md). The story of the re-base and the Callsign table
as first copied here are in `docs/archive/weapon-design-history.md`.

---

## 2. The rebalance (shipped)

> The table below is computed on raw `t5`. That is the damage that lands: MC compiles `t7 = 0`, so the
> fn 36/37 headset multipliers are ×1 ([ir-effects §6.2](ir-effects-design.md)).

### 2.1 Principles

1. **Never touch a token we cannot name.** Everything outside the balance set is emitted exactly as
   captured.
2. **Preserve the captured invariants.** `t39 == t16` (clip start == max clip) and `t17 == 2 × t40`
   hold on all 19 captured frames; `resolve()` maintains both. Pinned by a test.
3. **Tune damage and ammo before cycle.** Cycle carries fire feel — especially on burst weapons,
   where `t14` is the intra-burst spacing that `t23` is tuned against.
4. **`mag ≥ htk`, always.** Reported by `Compiler.validate()` as a **warning**, in every slot (round-2
   fix pass 2026-09-12, following F146): the operator cannot retune a weapon against the host's health
   model in the thirty seconds before the whistle, a reload still kills, and a guideline never blocks.
   The wording names the shape — the gun you fight with, a sidearm in the primary slot, or a backup.
   What DOES block is a weapon that cannot damage anyone at all ([ir-effects §6.2](ir-effects-design.md)).
5. **TTK band 1.20–3.50 s** at the 115 pool, except for a one-shot or charge weapon.
   The Shotgun has its own floor, 0.85 s: its 400 ms pump and fitted fight interval give 0.89 s (F576), and its
   kill waits 88 ms more for the last pull's headset word, so it publishes 0.97 s (F614).
   The band moved from 1.5 s on 2026-09-17 to admit the AR's native 100 ms cycle.
   A charge weapon is exempt because its setup is not combat time. Sidearms are exempt since 2026-10-17: with the
   earlier player-paced cycle they took about 3.6 s. The current field fit gives 2.26–2.97 s (the Glock to the Desert Eagle; the USP 2.56 s); Tony wants them weak against the rifles
   (Balance rules row 12).
6. **No strict dominance WITHIN A FAMILY, and every weapon leads somewhere.** Since 2026-09-17 the
   check runs per family (fire mode plus `weapon_class`) on four axes: ideal TTK, kills per clip,
   one-magazine kill chance at p = 0.7, and sustained DPS. "Total kills from a full kit" is retired,
   because a respawn refills the kit. Checked in a test, not by eye (§2.3).
7. **One-shot weapons are a pickup tier**: 2-round magazine, 4 total kills, and each differentiated
   by charge behaviour rather than by numbers.
8. **`htk` is the design unit, not DPS** — IR hits are discrete and misses are normal.

### 2.2 The table: the OPEN BRX arsenal (what Mission Control pushes)


The "cycle ms" column is the gun's own interval (t14). On a single-shot weapon the TTK uses the player-paced
cycle instead, about t14 + 43 ms (Balance rules row 14), so cycle × (htk − 1) does not add up there. A kill that needs
the last pull's headset word adds 88 ms (F614): the Shotgun at 115.

| weapon | role | dmg | cycle ms | htk | **TTK s** | DPS | sust | mag | reserve | reload | one-mag kill % (p=0.7) | heat | changed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| *Melee* | melee | 90 | 1000 | 2 | **1.00** | 90.0 | 90.0 | 1 | 0 | 0 | 0% | — | **2026-10-17**: outdoor range t2 90→60 (Tony, F567) |
| Sniper Rifle | marksman | 75 | 1500 | 2 | **2.71** | 50.0 | 20.3 | 1 | 48 | 2200 | 0% | — | dmg 80→60, cycle 300→1500; **2026-10-17/18**: bolt action, 75, 2.2 s bolt (Balance rules row 17, F573) |
| Shotgun | cqb | 19 | 400 | 3 | **0.97** | 47.5 | 40.7 | 6 | 48 | 400 | 0% | — | **2026-10-24** (F579): gun word 19 plus a 20 headset word (`wire.headset_dmg`, t12), 400 ms pump since 2026-10-17. `dmg`, `dps`, `sust` and one-mag % here are the GUN WORD ALONE |
| Plasma Sniper | marksman | 25 | 400 | 4 | **1.33** | 62.5 | 41.7 | 10 | 160 | 2000 | 95% | 30 | dmg 80→25, cycle 225→400. Headset word 10 (t12), never captured on this weapon. `dmg`, `dps`, `sust` and one-mag % here are the gun word alone |
| AMR | marksman | 26 | 450 | 5 | **1.97** | 57.8 | 47.3 | 14 | 112 | 1400 | 100% | — | **2026-10-25**: cycle 350→450 ms on both presets. 30% `crit_pct` (a crit is ×1.5, so 26→39) |
| Force Rifle | assault | 10 | 100 +250 | 12 | **1.65** | 66.7 | 50.7 | 36 | 288 | 1700 | 100% | — | dmg 9→10 |
| Burst Rifle | assault | 10 | 75 +540 | 12 | **2.53** | 43.5 | 36.1 | 36 | 384 | 1700 | 100% | — | **2026-09-24**: burst gap 540 ms (R6/R7, §7.5d); 40% `crit_pct` (a crit is ×1.5, so 10→15) |
| Stinger | cqb | 15 | 250 | 8 | **1.75** | 60.0 | 43.5 | 18 | 288 | 1700 | 99% | — | cycle 120→250, res 72→144 |
| Bolt Rifle | assault | 15 | 150 | 8 | **1.35** | 100.0 | 57.4 | 18 | 360 | 2000 | 99% | — | stock until **2026-10-17** (hidden; R10b, Balance rules row 14): dmg 13→15, cycle 225→150, htk 9→8 |
| SMG | cqb | 7 | 100 | 13 | **1.20** | 70.0 | 47.8 | 54 | 384 | 2500 | 100% | 5 | **2026-09-23** (R5, F308): 7 gun word + 2 headset word at carrier 100. `dmg`, `dps`, `sust` and one-mag % here are the GUN WORD ALONE |
| Toxin Rifle | assault | 8 | 110 | 15 | **1.54** | 72.7 | 49.0 | 30 | 360 | 1600 | 99% | 5 | In the picker since 2026-09-19. The gun lands the direct hit and POISON is a tick clock on the victim's node (S16, `spec/node.md` §3.17): 4 damage a second for 5 s, refreshed on each hit, never stacked. §7.5b |
| Suppressor | assault | 8 | 140 | 15 | **1.96** | 57.1 | 48.0 | 75 | 384 | 2000 | 100% | — | **2026-09-17**: cycle 160→140 (`wire.fire_ms`); mag 48→75 (§2.3, family-scoped dominance) |
| Assault Rifle | assault | 9 | 100 | 13 | **1.20** | 90.0 | 62.6 | 32 | 384 | 1400 | 100% | — | **2026-09-17**: cycle 140→100 (`wire.fire_ms`, native Battle Company speed) |
| Energy Rifle | assault | 9 | 150 | 13 | **1.80** | 60.0 | 57.0 | 300 | 600 | 2400 | 100% | 6 | **2026-09-17**: cycle 200→150 (`wire.fire_ms`); overheat switched ON (F229: `t38`=150 override, `t35`=D11) |
| Charge Rifle | marksman | 70 | 1250 | 4 | **0.85** | 56.0 | 37.3 | 40 | 160 | 2500 | 92% | 14 | **2026-09-23** (F280, F291): charge 70 (`wire.dmg`), tap 16 (`wire.tap_dmg`, t37), tap cadence 285 ms (bench-proven); the kill is one charge plus three taps. `dps` and `sust` count CHARGES only; `ttk s` reads the mixed kill |
| Rocket Launcher | power | 115 | 1000 | 1 | **0.00** | 115.0 | 50.0 | 2 | 2 | 2600 | 91% | — | res 8→2, reload 1200→2600 |
| Energy Launcher | power | 115 | 1600 | 1 | **0.00** | 71.9 | 50.0 | 2 | 2 | 1400 | 91% | — | cycle 360→1600, mag 1→2, res 6→2 |
| Ion Sniper | power | 115 | 1400 | 1 | **0.00** | 82.1 | 47.9 | 2 | 2 | 2000 | 91% | — | cycle 1000→1400, res 12→2 |
| Rail Gun | power | 149 | 1200 | 1 | **1.20** | 124.2 | 62.1 | 2 | 2 | 2400 | 91% | — | mag 1→2, res 6→2 |
| Laser Cannon | power | 115 | 1500 | 1 | **1.50** | 76.7 | 50.0 | 2 | 2 | 1600 | 91% | — | mag 4→2, res 8→2, reload 2000→1600 |
| Desert Eagle | sidearm | 26 | 700 | 5 | **2.97** | 37.1 | 25.6 | 7 | 96 | 2200 | 65% | — | **2026-09-23** (R10, F308): cadence 480→700 ms (.50 AE recoil), a finishing weapon (Balance rules row 10) |
| USP-S | sidearm | 10 | 190 | 12 | **2.56** | 52.6 | 26.8 | 12 | 240 | 2200 | 1% | — | **2026-10-24** (F579): dmg 12→10, so the rifles win the R10b duel at field pace. Mag 12 since 2026-09-23 (R10, F308; a USP .45 holds 12) |
| Glock-18 | sidearm | 13 | 240 | 9 | **2.26** | 54.2 | 34.4 | 16 | 128 | 2200 | 93% | — | **D2 2026-09-12** (Bolt Rifle frame) |

**"One-mag kill %"** (2026-09-17, replaces the old "mag/total kills" column) is `P(at least htk hits in
mag shots)` at a stated field accuracy `p=0.7`, binomial exact — the same formula the sidearm proposal
used (`docs/reference/ttk-model.md` §2). Reserve ammo is no longer a balance axis: a
respawn refills the whole kit, so how many kills a full kit could theoretically produce said nothing
about any single life. The Charge Rifle's `mag`/`reserve` are ROUNDS of its 10-round cell
(`rounds_per_charge`), so its one-mag figure is computed on 4 charges (`40 / 10`), not 40 hits.

No weapon ships **exactly as Battle Company sent it** (`verified: true`) any more. The last two, the Bolt Rifle and
Melee, were retuned on 2026-10-17 (15 at 150 ms; outdoor melee range 60). Both are hidden from the picker. The Burst Rifle shipped stock until its 2026-09-17 retune.

**Role identities**

- **Assault Rifle**: the anchor. Native 100 ms cycle, 9 damage, 13 hits. It leads its family on time to kill and sustained DPS (§2.3). The lead is on paper until stance and recoil ship.
- **Burst Rifle**: 10 damage, 12 hits, a real three-round burst (75 ms inside, 540 ms between bursts; R6/R7, §7.5d) and a 40% `crit_pct`.
- **Force Rifle**: hidden, kept for custom games. 10 damage, 12 hits, a shorter burst gap than the Burst Rifle (1.65 s against 2.53 s).
- **Bolt Rifle**: hidden. Single shot, 15 a hit at 150 ms, 8 hits.
- **SMG**: a 7 + 2 split, a gun word and a headset word at carrier 100, with a 54-round magazine. Its heat value (`t24 = 5`) is inert: overheat needs `t37`/`t38`, which only the Charge Rifle and the Energy Rifle carry.
- **Shotgun**: three hits, six shells, a 400 ms Shells-type reload. Each pull is a gun word plus a 20 headset word. The identity is the three-hit kill up close, not throughput.
- **Stinger**: hidden. Full auto, eight hits.
- **Sniper Rifle**: the only two-hit weapon outside the power tier. A bolt action with a 2.2 s bolt (F573).
- **Plasma Sniper**: hidden. A marksman rifle that fires like a carbine and overheats (`t24 = 30`).
- **AMR**: semi-automatic (`t20 = 7`), 26 a hit, 5 hits, a 14-round magazine and a 30% `crit_pct` (F62).
- **Suppressor**: quiet, no muzzle flash, a 75-round magazine, the slowest kill. The deep magazine gives it the lead on kills per clip against the SMG (§2.3).
- **Energy Rifle**: 150 ms cycle, overheat on (`t38 = 150` and `t35 = D11` as `overrides`). Full auto locks it out near heat 99; only a reload hold clears the lockout.
- **Charge Rifle**: charge 70 (`t5`) and tap 16 (`t37`) are separate numbers. A full charge costs 10 rounds (`rounds_per_charge`) of a 40-round cell. The intended kill is one charge plus three taps (70 + 16 + 16 + 16 = 118 ≥ 115). `hits_to_kill()` counts that combo, and `ttk_ms` is release-to-kill because the charge is built behind cover (S43). `rounds_to_kill()` is the round count of the same combo; the one-magazine guard and kills per clip use it. The sustained-DPS and one-magazine axes (§2.3) model repeated full charges.
- **Sidearms** (Glock-18, USP-S, Desert Eagle): slot-2 backups on the Bolt Rifle frame (`t20 = 7`). They are finish-a-kill weapons, deliberately dominated by the rifles (Balance rules row 12), and they are a family of their own for the dominance check (§2.3). Draw time is `wire.swap_ms = 500`; the gun applies the larger swap delay of the two slots. In hand a pistol kills slower than its wire TTK, because a semi-automatic fires no faster than the player pulls.
- **Power tier**: Rocket, Rail, Laser, Energy Launcher, Ion Sniper. 115 damage (the Rail Gun does 149, Balance rules row 7), one-shot on Standard, a 2 + 2 round cell, 4 kills. Charge behaviour and a cycle/reload ladder tell them apart (§2.4).

The full dated history of each role, with the reasoning of every retune, is in `docs/archive/weapon-design-history.md`.

### 2.3 Dominance, families, and the lead rule

Checked mechanically in `test_ttk_band_and_no_strictly_dominant_weapon`
(`mcp/tests/test_mc_compile.py`), rewritten 2026-09-17 after the Assault Rifle's return to its native
100 ms cycle reintroduced the exact cross-weapon dominance the 2026-08-30 retune existed to avoid — a
global three-axis check could no longer hold both "AR at native speed" and "nothing strictly beats
anything" at once, and re-throttling the AR again was explicitly off the table this time.

**1. The band.** Every non-one-shot, non-cell weapon except the sidearms (since 2026-10-17) lands between **1.20 s and 3.50 s** ideal TTK —
the band, not the old 1.50–3.50 s. The floor moved 2026-09-17 to admit the Assault Rifle's native
1.20 s rather than throttle the weapon again. A CELL weapon (`rounds_per_charge` > 1 with a tap
magnitude — today, only the Charge Rifle) is exempt the same way a one-shot weapon already is: its
`ttk_ms` is RELEASE-to-kill (§2.2), and the pre-built charge that makes that number small is exactly
its identity, not sustained-fire combat time the band is measuring.

**Tony's call, 2026-10-24 (F576).** The Shotgun's band floor is 0.85 s, not 1.20 s. "Pistols weak against
the rifles" is tested on the R10b duel result (`test_pistol_identities_keep_tonys_ordering`, 65% bar), not on
the published TTK. **2026-10-24 (F579):** the R10b duel runs at field pace, and the USP moved to 10 damage to
hold it. See [balance-decisions.md](balance-decisions.md).

**2. Dominance runs WITHIN A FAMILY, not globally.** Family = the `$WEAP` fire mode (`t20`) plus
`weapon_class`, except a sidearm, which is its own family regardless of mode or class (`_weapon_family()`
— a slot-2 backup was never meant to compete with a primary, so the old bespoke "primary beats sidearm"
exemption falls out of this for free: a primary and a sidearm are never in the same family to begin
with). This groups the roster into automatics split by ballistic/energy (`{assault_rifle, smg,
suppressor}`, `{energy_rifle}` alone), bursts (`{burst_rifle}` alone), semi-autos (`{shotgun,
amr}`), the bolt-action Sniper Rifle (alone, row 17), the Charge Rifle's own charge-mode family (alone), and the sidearms
(`{usp, deagle}`). **No weapon strictly dominates another IN ITS OWN FAMILY** on {ideal TTK, kills per
clip (`mag // rounds_to_kill`, deterministic, felt every reload), one-magazine kill chance at p=0.7
(binomial, `_one_mag_kill_p`), sustained DPS (one magazine dump plus one reload)}. "Total kills from a
full kit" is retired as an axis entirely (a respawn refills the kit, so it is not a fact about a single
life); kills-per-clip takes its place as the deterministic axis, alongside the probabilistic one-
magazine figure — Tony's call was to keep both, not pick one.

**Why per-family, not global.** An SMG beating a Sniper Rifle on every one of these four axes is
expected, not a balance failure: the MODEL sees neither range nor recoil (range now ships on `t2`, and
recoil is written by the node at runtime, so neither reaches `weapons.json`'s derived columns), and a
Sniper Rifle's whole real identity IS range — the model simply cannot see the axis that would stop the
SMG winning. Checking dominance only within a family (weapons that already share a fire mode and a
damage type) keeps the check meaningful without pretending to referee a fight the model has no data
for. The same check on the STOCK roster, unscoped, returned **43** dominated pairs; scoped to family
and using the 2026-09-17 numbers, the roster is CLEAN — zero violations.

**3. The lead rule.** Every visible weapon must LEAD its family on at least one axis a player can
feel — the strict-dominance check alone allows a family where every OTHER member ties or loses to one
weapon on every axis without that one weapon quite crossing into "dominates" (no single strict edge on
any one axis). "Leads" means: achieves the family-best value (ties count) on one of the four numeric
axes above. ⚠️ **It does NOT mean a declared `recoil.floor` or a unique `range_band`** — polish round
2 (2026-09-17) removed those two paths, because neither reaches a gun, so a lead claimed on either
would be satisfied by inert data and the rule could never fail. Add them back in the same commit that
wires the levers. A family of one (Burst Rifle, Energy Rifle, Charge Rifle: each alone in its
mode/class bucket) trivially leads — there is nothing to be out-led by. Two qualifiers used only for
this rule, both **declared catalogue data that the COMPILER never writes**
(`test_range_and_recoil_are_declared_not_wired` is the guard). Read that precisely: `range_band` and
`recoil` are human-facing intent, and neither is the wire value. The wire values exist and do reach a
gun: `wire.range_outdoor_pct` writes `t2` outdoors, and the node drives accuracy at runtime (`$TMP` t4, contracts A51):

- **`range_band`** (`"close" | "close-mid" | "mid" | "long"`, plus a `range_target_m` human string) —
  the per-venue metres Q15 will calibrate once `t2` is (F231): Shotgun/sidearms close (8-10 m indoor /
  15-18 m outdoor), SMG close-mid (12 / 25-30), Assault Rifle/Burst/Toxin Rifle mid (18-20 / 40-45),
  Suppressor/Energy Rifle mid (15 / 30, the deep-mag "LMG" role), Sniper Rifle/AMR/Charge Rifle long
  (full reach / 60 m+). The two picker power weapons (Rocket Launcher, Rail Gun) are close.
  `weapons.json` is the list; this paragraph only explains the bands.
- **`recoil`** — the S42 node-driven profile (legacy `{ceiling, floor, per_shot, recover_ms}` inputs plus
  optional explicit `{crisp, degraded, heavy, after_shots, after_heavy, settle_ms}` ladder fields; a harsh
  floor is a felt COST that offsets a fast TTK): SMG, Suppressor and Stinger harshest (100/60, S54/F268:
  Tony's 2026-09-18 floor raise, kept 2026-09-23), the Assault Rifle deeper STILL (100/70/45, its own
  explicit exception, §7.5c below), Energy Rifle medium (100/70), Force Rifle at 100/60, everything
  semi-automatic or one-shot none
  (100/100, no recoil model needed). The Burst Rifle is now one of those flat rows too: it is a
  one-press burst trigger and cannot be held in full auto, so S54/F280 (2026-09-23) dropped it to
  100/100 rather than leaving it a mild, unfireable ladder. A Sniper Rifle's future cost is a stance
  penalty, not recoil, and does not exist yet either. `after_shots` and `after_heavy` (how many ROUNDS a
  held trigger takes to reach `degraded`/`heavy`) no longer come from `per_shot` at all: S54/F280 derives
  them from rounds per trigger pull, scaled by calibre (a weapon dealing the reference 8 damage fires 5
  clean rounds and degrades on the 6th, then 3 more clean rounds and goes heavy on the 9th; a heavier
  round scales both counts down by `8 / dmg`). `per_shot` and `recover_ms` remain only as the legacy
  inputs for `crisp`/`heavy`/`settle_ms`. A trigger release (`$BUT,0,0`) while still CRISP also clears
  the round count, at no cost in writes; a DEGRADED or HEAVY weapon still only recovers on the settle
  clock (bench-provisional, S54).

Neither field is read by `resolve()`. Range reaches the wire through its own field, `wire.range_outdoor_pct`
(`t2` outdoors), and the node writes accuracy at runtime (S54/S55), while the frame keeps `t21`/`t22` at
100/100 (native walk off, F230). Calibrating range in metres is still the biggest missing design axis
(F135, F231, and the range axis in `post-mvp.md`). Both are declared now specifically
so the NEXT retune tunes them alongside the numbers above instead of re-deriving this whole argument
from scratch once the levers exist.

**Two number changes were needed to close the roster clean, both the smallest found:**

- **Suppressor mag 48 → 75.** Same family as the Assault Rifle and SMG; the SMG beat it on ideal TTK
  and sustained DPS outright, so the two ties left (pk, at 100 % for both) were not enough to earn a
  lead. Kills-per-clip is the one axis that responds to magazine size alone, and 75 is the SMALLEST
  integer mag that pushes it to 5 — strictly past the SMG's 4 (48 → 60 only ties it, and a tie is not
  a lead relative to a specific rival, only relative to the family maximum, which the SMG would already
  own outright at 4).
- **USP mag 20 → 19**, not Tony's suggested 14 (§2.2's sidearm paragraph has the full arithmetic): 14
  flips the dominance the other way (Deagle then beats USP on both sustained-DPS and one-magazine-kill
  chance), and 19 is the only integer in range that leaves neither pistol beating the other. This is a
  fragile equilibrium (margins under 0.1 dmg/s and 2 percentage points) and a smaller retune focus than
  a magazine count would be the more durable fix, but it is the smallest change that satisfies the rule
  as specified. **2026-09-23 (R10, F308): the more durable fix landed** — USP mag 19 → 12 (a real
  USP .45's own capacity) and Deagle cadence 480 → 700ms moved together, so the fragile one-mag-kill
  equilibrium above no longer needs to hold: see §2.2's sidearm paragraph.

### 2.4 The power tier

All five are one-shot kills, so TTK cannot separate them. They are separated by **behaviour** — what
the enemy hears, and whether the shot is yours to time — and by a cycle/reload ladder with no
strict winner:

| weapon | fire mode (`t20`) | cycle | reload | the tell |
|---|---|---|---|---|
| Rocket Launcher | 7 single shot | **1000 ms** (fastest) | 2600 ms (slowest) | none |
| Rail Gun | 2 charge, **auto-fires** | 1200 ms | 2400 ms | `C08` spool — and it fires whether you are ready or not |
| Ion Sniper | 7 single shot | 1400 ms | 2000 ms | none — a rifle body, the quiet one-shot |
| Laser Cannon | 3 charge, **must be held** | 1500 ms | 1600 ms | `C11` — and a tap fires nothing at all |
| Energy Launcher | 0 full auto | 1600 ms (slowest) | **1400 ms** (fastest) | none |

Fastest cycle has the slowest reload and vice versa; nothing leads on both.

### 2.5 Health-config sensitivity

`htk` moves with the host's health setting, and MC lets it change per game.

| weapon | 45/55 (100) | **45/70 (115)** | 50/100 (150) | 100/100 (200) |
|---|---|---|---|---|
| Power tier (115 dmg) | 1 | **1** | **2** | 2 |
| Rocket Launcher | 1 | **1** | 1 | 2 |
| Rail Gun | 1 | **1** | 2 | 2 |
| Charge Rifle | 3 | **4** | 6 | 10 |
| Sniper Rifle | 2 | **2** | 2 | 3 |
| Shotgun | 3 | **3** | 4 | 6 |
| Plasma Sniper | 3 | **4** | 5 | 6 |
| AMR | 4 | **5** | 6 | 8 |
| Burst Rifle | 10 | **12** | 15 | 20 |
| Stinger | 7 | **8** | 10 | 14 |
| Bolt Rifle | 7 | **8** | 10 | 14 |
| Force Rifle | 10 | **12** | 15 | 20 |
| Assault Rifle / Energy Rifle | 12 | **13** | 17 | 23 |
| SMG | 12 | **13** | 17 | 23 |
| Suppressor | 13 | **15** | 19 | 25 |
| Toxin Rifle | 13 | **15** | 19 | 25 |
| Desert Eagle | 4 | **5** | 6 | 8 |
| USP-S | 10 | **12** | 15 | 20 |
| Glock-18 | 8 | **9** | 12 | 16 |

The Rocket Launcher's 1 at 150 counts its headset word (35). How far that word reaches is unmeasured (F275);
wherever it does not land, the rocket needs 2 like the rest of the tier.

**The Charge Rifle's `htk` in this table is trigger ACTIONS (1 charge + N taps), not equal-sized
hits** (2026-09-17, F225/F226/S43): at 200 the pool needs 1 charge (70, F280) plus 9 taps (16 each,
F291, the last one overkilling by 14) to close, not `ceil(200/70) = 3`. Every other row is the plain
`ceil(pool/dmg)` every non-cell weapon uses.

**The Toxin Rifle's row counts direct hits only**, with the same `ceil(pool/dmg)`. Its poison is worth
20 when it runs out (§7.5b), so the hits that make a kill certain are `ceil((pool - 20)/8)`: 10, **12**,
17 and 23.

Two consequences carried over from the first pass and still true:

- **At a 150 pool the power tier stops one-shotting.** Their `mag: 2` keeps `mag ≥ htk` true to a
  230 pool — which is why they are 2+2 and not 1+3.
- **MC should show htk, not a damage bar.** `weapons.json` now carries `htk` and `ttk_ms` per weapon,
  and the `dmg` UI bar is defined as *the share of a 115 pool one hit removes* rather than an
  arbitrary 0–100 number. The `rng` bar is now the literal `t41` value, which means it reads 75 on
  every gun — correctly, if unhelpfully. It was previously decorative and misleading.

---

## 3. Sound

### 3.1 Battle Company already assigned them

Re-basing on captured frames means **every weapon now plays the sound Callsign gives it**, with its
own reload chain, charge cue and dry-fire click. We no longer choose fire sounds at all. That
resolves the bench's C3 by itself: the SMG reads as a heavy machine gun because `G10` was *our*
pick — the real SMG frame is **`G03`** (1.08 s, against `G10`'s 1.32 s).

Ten distinct reload chains ship where there was previously one. The Suppressor is the only
weapon with `t25`/`t26` set (quiet, no muzzle flash), and the Rail Gun and Laser Cannon carry charge
cues (`C08`, `C11`) that the old build silently blanked.

### 3.2 Sound overrides — the one sanctioned deviation

The byte-diff pinning test blocks *every* change outside the balance tokens, sound edits included.
That is the point, but the field range turned up two stock sounds that are genuinely wrong, so
`weapons.json` now supports a narrow, explicit escape hatch:

```json
"overrides": { "t33": { "value": "D02", "why": "bench 2026-08-26: captured D21 plays a 'disable' chirp …" } }
```

Applied after the capture base and the balance tokens. Deliberately awkward: an entry must name a
token `protocol-classes.md` has a **name** for, must carry a value, and must carry a `why` — enforced
in `resolve()` and pinned by tests. The pinning test then allows exactly the declared token for that
weapon and nothing else. An undeclared drift still fails.

`weapons.json` is the list of overrides that ship (29 entries across 14 weapons on 2026-09-24). The two below
are the first, from the 2026-08-26 field range; each later entry carries its own `why`.

| weapon | token | change | why |
|---|---|---|---|
| Sniper Rifle, AMR, Force Rifle | `t33` reload part 3 | `D21` → `D02` | `D21` fires a "disable" chirp alongside the reload — reproduced on two guns. `D02` is the clean cocking beat the AR/Burst/Bolt chains already end on. |
| Energy Launcher | `t27` fire sound | `J15` → `O06` | `J15` is a **music sting** (`J` = music/SFX in the DK legend), inherited from the "unnamed secondary" frame. The first pick was `O01` (1.45 s); `O06` (1.81 s) replaced it by ear on 2026-09-11. The whole **O** family is otherwise unused by the stock arsenal. |

**Correction to the bench note:** the D21 weapons are the Sniper Rifle, the AMR and the **Force
Rifle** — not the Bolt Rifle. Bolt shares `D04+D03` but its captured chain already ends on `D02`, so
it needs no override; Force Rifle's chain is `D23+D22+D21`. Pinned by a test so the distinction
cannot quietly rot.

### 3.3 Sound duration does not constrain cadence

Two early rules are void: a "duration over cadence ceiling" for fire sounds and a "reload parts play in
sequence inside `reload_ms`" budget. The AR plays a 1.76 s sample at a 100 ms cadence, and the firmware
truncates and retriggers by design. Reload-chain timing against `reload_ms` is an open bench question
(post-MVP row U4 in [post-mvp.md](post-mvp.md)). The retracted text is in `docs/archive/weapon-design-history.md`.

### 3.4 What the bank still tells us

Useful for *new* weapons we invent later, not for the stock 19. Durations, by family:

| prefix | meaning (DK legend) | n | range | shortest |
|---|---|---|---|---|
| **R** | rifle gunshots | 47 | 0.52–5.02 s | R122 0.52 |
| **G** | gun shots (SMG family) | 23 | 0.54–2.00 s | G02 0.54 |
| **P** | gun shots — **entirely unused by any stock weapon** | 18 | 0.69–2.13 s | P15 0.69 |
| **S** | gun shots (S16 = SR-100) | 19 | 1.12–4.13 s | S07 1.12 |
| **T** | gun shots (T14 = TAC-87) | 16 | 0.84–1.80 s | T02 0.84 |
| **O** | ordnance — **unused by any stock weapon** | 6 | 1.45–2.51 s | O01 1.45 |
| **Q** | silencers | 7 | 0.21–0.86 s | Q04 0.21 |
| **L** | electrical — **unused by any stock weapon** | 7 | 0.36–4.50 s | L04 0.36 |
| **E** | sci-fi (E01–E32) | 32 | 0.58–4.46 s | E27 0.58 |
| **C** | sci-fi + charge cues | 21 | 1.02–3.96 s | C14 1.02 |
| **D** | cocking / reload beats | 69 | 0.05–3.92 s | D18 0.12 |
| **W** | reloads — **unused by any stock weapon** | 74 | 0.27–8.72 s | W09 0.27 |
| **X** | grenades / explosions | 51 | 0.09–8.06 s | X37 0.09 |

Four whole families — **P, O, L and W** — are untouched by the stock arsenal. Those are the palette
for custom weapons. Two legend corrections: the **E_\*** ids are alternate takes, not part of the
E01–E32 weapon family, and **ST** ("sci-fi mortars/rockets") **has no group in `Sounds.json`** — no
`ST*` id exists.

---

## 4. Wire levers

Most of §4 in the first pass argued for setting fields we were leaving at template defaults. Re-basing
settles nearly all of them: the values are Battle Company's and we now preserve them. What remains is
one discovery and one genuine gap.

### 4.1 `t20` is the fire mode — and it explains the full-auto bench failure

The field map calls `t20` "(secondary/overheat)". It is neither: overheat is `t24`, independently
populated on exactly the four weapons described as overheating. Across all 19 captured frames `t20`
tracks the operator's own capture-time behaviour notes:

| `t20` | weapons | described as |
|---|---|---|
| **0** | Assault Rifle, SMG, Suppressor, Energy Rifle, Stinger | "full auto" (5/5) |
| | Energy Launcher | "single shot" — the lone outlier |
| **2** | Rail Gun | "charges, **auto-fires** after ~1 s" |
| **3** | Laser Cannon | "must be **held** to charge; a tap fires nothing" |
| **7** | AMR, Bolt Rifle, Sniper Rifle, Plasma Sniper, Ion Sniper, Rocket Launcher, Shotgun | "single shot" (7/7) |
| **9** | Burst Rifle, Force Rifle | "3-round burst" (2/2) — and the only two frames with `t23` |
| **13** | Melee | "gyro swing" |
| **14** | Charge Rifle | "hold to charge, **fires on release**" |

5/5 full-auto, 7/7 single-shot, 2/2 burst, and three distinct values for three distinct described
charge behaviours. The single outlier is explainable: the Energy Launcher has a **one-round
magazine**, so "single shot" is what any operator would write regardless of the underlying mode.

**This resolves C1.** `WEAPON_TAILS["ar"]` carries `t20 = 0`, so every weapon the old template built
inherited full auto — which is exactly why the sniper and shotgun fired full-auto on the bench. It
was never a missing field; we were overwriting the right one with the AR's value.

**It also resolves C2.** Native burst exists: the Burst Rifle's `t20 = 9` with `t23 = 275`. Our
`ar`-derived burst rifle did not burst because the `ar` sample carries neither token.

*Status: **PROVEN 2026-08-26** — one-field bench flip (sniper t20 7→0 single→auto; captured Burst Rifle = true 3-round bursts).*

### 4.2 `t2` is the range lever, not `t41` (corrected 2026-09-17; its mechanism corrected 2026-09-18)

**This section used to argue range was an unrecovered gap sitting at `t41`. That was wrong, and the
correction is recorded here rather than deleted.** The garden range test (2026-09-17,
`docs/experiment-log/2026-09.md`, evidence in `docs/evidence/2026-09-17-range-t41/`) ran two `$WEAP`
slots differing only in `t41` (5 vs 75) outdoors: the low slot scored **27 of 27** hits against the
stock slot's **55 of 57**, at 3 m, 10 m, 20 m, 40 m and about 200 ft. **`t41` is a null outdoors.**
The same session found the token that does move hits at **`t2` (APK name `gunRangeOutdoor`)**:
`t2 = 5` landed **0 hits from 38 shots** at any distance, including muzzle on the dome; `t2 = 100`
(the value every captured gun ships) reaches about 200 ft. Between them the ladder showed a floor,
a real transition roughly **13 to 26**, and a flat shelf from about **31 to 100** where every value
behaved alike at any distance the garden could pace out.

⚠️ **`t2` is a CARRIER FREQUENCY, not a power (V4_31 disassembly, 2026-09-18).** The measurements
above all stand. What they prove does not. A low `t2` does not shorten the beam: it detunes the word
out of the receiver's band-pass near 38 kHz. **Read the flat shelf as the pass-band and the 13-to-26
band as its edge**, and calibrate in kHz, not as a percentage ladder. The formula, the kHz
conversion of every shipped value and what it does to this section are in [ir-effects §6.5](ir-effects-design.md); the source of record
is `protocol/brx-protocol.md`, the `$WEAP` row headed "range is a CARRIER FREQUENCY".

**`t41` reads 75 on all eighteen guns (20 on melee) and is deliberately never written any more.**
`WeaponCatalog.resolve()` leaves it exactly as the capture carries it, because indoor behaviour is
still unmeasured (F231 open) and a guessed indoor value would be a false promise. `RANGE_ENV_OVERRIDE`
(`mcp/brx_mcp/mc/compile.py`) was the venue map that used to scale `t41`; it has moved to `t2`
(F234) and is now `gun_range_outdoor_pct`, fed by each weapon's `wire.range_outdoor_pct`.

The earlier draft also claimed the captured rocket carried `t41 = 30`. **That was wrong**: the 30
sits at `t42` (extra-headset range), present on the Rocket, Shotgun and Plasma Sniper. Corrected here.

**Shipped starting values, outdoor, from `weapons.json` `wire.range_outdoor_pct`:**

| Weapon | `t2` outdoor | `range_band` | Note |
|---|---|---|---|
| Sniper Rifle | 100 | full | On the shelf; matches the captured value |
| Marksman (AMR) | 85 | full | On the shelf |
| Charge Rifle | 85 | full | On the shelf |
| Assault Rifle | 70 | mid | On the shelf |
| Burst Rifle | 70 | mid | On the shelf |
| Suppressor | 55 | mid | On the shelf |
| Energy Rifle | 55 | mid | On the shelf |
| SMG | 40 | close | **Tony's F231 decision, 2026-09-25: "SMG and rockets should be like 40%."** Moved off the 13-26 transition band, just short of the pass-band. This is the gun word's carrier; the headset word (2 damage since 2026-09-23, R5) uses the known-good 100 carrier so it actually emits reliably |
| Shotgun | 30 | close | **Moved onto the flat shelf 2026-09-18, then corrected 2026-09-23** (Tony, R4/R5): 100 (full distance) let the gun word out-reach the game it is played at; set to match the SMG's OLD value of 30 so the two close-range weapons shared one outdoor reach. Left at 30 by the 2026-09-25 F231 decision (the SMG moved to 40, the Shotgun did not). See §7's dual-emitter write-up: the Shotgun's real close/far shape lives in `wire.headset_dmg`'s reach (`t13`/`t42`), which stays at 100 — the headset word's own real range is unmeasured, F275 |
| Rocket Launcher | 40 | close | **Tony's F231 decision, 2026-09-25: "and rockets should be like 40%."** A pickup-only one-shot heavy is meant to be earned at close range, not to out-reach the arsenal it out-damages (Tony, 2026-09-17); the 40 replaces the old close-range guess (22) with the same reach as the SMG |
| Melee | 60 | — | **Tony, 2026-10-17: 90 → 60** (the field's melee reached 15-20 ft). The melee word comes from the headset; 60 is about 32.4 kHz on the headset slope, still inside the pass-band by the bench model, so the felt change may be small: `bench-field-1017.md` P3.1 measures it. Indoor and an unknown venue keep the captured `t2` 90 and `t41` 20 |
| Rail Gun | 100 | close | **Tony's F231 decision, 2026-09-25: "railgun 100."** Moved onto the flat shelf, matching the Sniper Rifle; `range_band` stays `close` (declared catalogue copy, never wired) pending a re-pick, but the wire carrier is now full reach |

Every value from 40 up sits on or near the flat shelf the garden test found (roughly 31 to 100): they
are expected to behave alike until the shelf itself is mapped, so the ranking above the shelf is a
design intent, not yet a measured difference. **Only the SMG and Rocket Launcher values are real
guesses**, both moved by Tony's 2026-09-25 F231 decision to just above the 13-26 transition band
(previously they sat inside it); they are pending **S49**, the portable IR receiver, which lets one
person map the transition band properly (several fixed receivers at once, full mags, first two shots
discarded, dome shaded). The Shotgun moved off that band 2026-09-18; its own open range question is
now `t13`/`t42` (F275), not `t2`. The Rail Gun moved onto the shelf by the same 2026-09-25 decision, so
it no longer carries the transition-band caveat.

⚠️ **The 2026-09-18 carrier-frequency reading puts the whole table in question, and the call is
Tony's: [ir-effects §6.5](ir-effects-design.md) converts every row above into kHz and works through it.** In short, the nine weapons
at 55 and up (now including the Rail Gun) all sit inside the receiver's pass-band and probably play
alike; the Shotgun (30) sits on the knee, where the effect is not "shorter range" but "the receiver
drops words"; and the SMG and Rocket Launcher (both 40, since 2026-09-25) sit just above the knee,
unmeasured at that value. Keep the numbers until S49 measures the receiver's response curve; do not
read this table as a calibrated metre ladder. **The real reach at 40/100 outdoors is unmeasured;
bench Block 5.**

A weapon with no `wire.range_outdoor_pct` (every hidden/cut weapon, the sidearms) keeps its
captured `t2` unchanged at every venue. **Indoor stays honest**: no venue has an indoor range value.
Indoor and an unset venue both keep the weapon's captured `t2`, because nobody has run this ladder
indoors (F231 open). A floor guard refuses to compile any `t2` under **13**: F231 measured `t2 = 5`
landing on nobody at any distance, and a weapon compiled under the floor is a weapon that silently
cannot hit anyone.

`range_band` ('close'/'mid'/'full') and `range_target_m` are catalogue-only, human-facing copy for
the armoury screens (metres, outdoor). They are declared data, never wired: the frame builder never
reads them, only `wire.range_outdoor_pct` reaches `$WEAP` t2 (see `test_weapon_derivations.py`'s
declared-not-wired guard).

### 4.3 Resolved by the re-base

- **`t3` damage type** — no longer guessed. Rocket 10 (lethal explosive), Rail 6 (armor-piercing),
  Melee 13, Charge Rifle 8, Energy Launcher 9. The first pass proposed assigning ShottyPellets to
  the shotgun; Battle Company leaves it 0, and we now follow the capture.
- **`t19` reload type** — the Shotgun really is `2 = Shells` (which is why a 400 ms reload is sane:
  it is per shell). Everything else is 0. Never settable by the old template, now inherited.
- **`t14` charge time** — the "silent Laser Cannon" bug from the first pass is gone: the real frame
  carries `C11`, and the Rail Gun carries `C08`.
- **`t23` burst, `t24`/`t35` overheat, `t25`/`t26` muzzle flash** — all inherited.

### 4.4 `t21`/`t22`: a third lever — the accuracy ceiling and floor

Bench-proven 2026-09-09 (see `docs/manual/dev.md`'s `$WEAP` token table for the full writeup and the
measured walks): `t21` is the accuracy **ceiling** and `t22` is the accuracy **floor**. `$ALCD` token 2
is a live per-shot accuracy value — not the "audio level" [ir-effects §6.3](ir-effects-design.md) used to call it (corrected there too).
It starts each life at `t21`, drops under sustained fire toward `t22` (five steps, each a fifth of the
ceiling-to-floor range per shot), holds at the floor, and resets to the ceiling on reload. A native
recovery races the drop, so `t14` (fire interval) decides how hard the model bites: a fast cycle
reached the floor on shot 8 (floor 0) or shot 11 (floor 50) in the only two walks run, a slow enough one never leaves the ceiling. Shots-per-step is not characterised (n=2).

That makes sustained-fire feel a **three-lever** design space, not two. `t5` (damage) and `t14` (rate of
fire) already tune a single burst; `t21`/`t22` now tune what *staying* on the trigger costs you. A
weapon with a wide ceiling-to-floor gap punishes mag-dumping without touching its damage or cycle
numbers at all — a different route to the same "don't just hold the trigger" goal the Assault Rifle's
cycle retune reached for by hand (§2, "Role identities").

**Every weapon's frame still ships `t21 = t22 = 100`**, the captured Battle Company default, carried
through unchanged by `resolve()` (Appendix), so the native walk stays off (F230). Recoil ships another
way: the node drives accuracy at runtime from each weapon's declared `recoil` profile in `weapons.json`,
with one absolute `$TMP` t4 write (S54/S55, contracts A51; Balance rules rows 1-3).

---

## 5. Open unknowns

The three unknowns that are still open (U4 reload chain against `reload_ms`, U5 fire-sample retrigger, U8 `t17`
against `t40`) are rows in [post-mvp.md](post-mvp.md). None blocks the MVP. The closed rows, with their
evidence, are in `docs/archive/weapon-design-history.md`. The facts they settled live in §4,
[ir-effects-design.md](ir-effects-design.md) §6 and `protocol/brx-protocol.md`.

---

## 6. The `$SIR` layer: moved to its own page

The `$SIR` layer, the IR-effects study and the archetypes the catalogue does not have yet are in
[`ir-effects-design.md`](ir-effects-design.md). Its section numbers are unchanged (§6.1 to §6.5), so a
citation such as "§6.2" means that page. The damage rule that this page relies on is Balance rules row 8:
MC compiles `t7 = 0`, so every function lands ×1 on both sensors.

---

## 7. The triangle, and what belongs in which slot

Written 2026-09-18, after the bench turned four `$SIR` functions from guesses into measurements. Tony's
brief: "lets be thorough and balance and placement and rock paper scissor". This section is the answer,
and every number in it comes from a `$HP` delta.

### 7.0 ⚠️ Three stock weapons and the Open BRX SMG fire TWO words per trigger pull

Named 2026-09-18 from Battle Company's own weapon sheets, via the LaserTagMods material. **`t1` is
`WeaponIRSource`**: 0 gun laser, 1 headset only, **2 gun AND headset**, 3 double gun, 4 double gun plus
headset, 5 dry fire. Exactly three stock weapons set 2, and for those **`t12` is a second word's damage**
with `t13`/`t42` its outdoor/indoor reach. After the 2026-09-20 playtest, Open BRX deliberately gives
the SMG the same dual-emitter source with a priced 2-damage word (7 + 2 since R5); both t1 and t12 are explicit overrides
because neither exists in its captured frame.

| weapon (stock values; §2.2 has what we ship) | gun laser (`t5`, range `t2`) | headset word (`t12`, range `t13`/`t42`) |
|---|---|---|
| Shotgun | 45 | **70** |
| Rocket Launcher | 115 | **115** |
| Plasma Sniper | 25 | **80** |
| SMG (Open BRX deviation) | 7 | **2** |

**It is the SHOOTER's headset that emits**, not the victim's that receives a bonus. Three things agree:
`t1` names an IR *source*; V4_30 builds an `$IRTX` frame and sends it to the gun's own headset to emit;
and the community scoring readme says a swap-in headset lacking the high-power LED "means no shotguns,
melee, explosions", which is a statement about the shooter's hardware. `t37`/`t38`
(`HeadsetDirection`/`HeadsetRepeat`) probably steer that word and set how many times it repeats.

**So one Shotgun pull may put two words in the air**, at 45 and at 70, with different ranges. A victim
can take either, or **both**. And 45 + 70 is **115**, which is exactly the standard pool: if both words
reach the same person, a single trigger pull kills them outright.

When this was written, our catalogue modelled one word of 45 and a ladder position of 3 hits at 1.60 s.
Since 2026-09-18 it models both words: 20 on the gun and our chosen 20 on the headset (§2.2). Every bench
run before then would have missed the second word, because at a bench the operator holds both guns and shoots a
covered gun sensor at arm's length, and in a game you shoot a person across a field.

⚠️ **Sourced, not measured.** The test is which EMITTER sent which word, so it is run on the shooter:
fire once with the shooter's headset covered and the gun exposed, then once with the gun covered and the
headset exposed, reading the victim's `$HIR` magnitude, protocol and sensor each time. The IR rig
settles it faster still: one pull at the receiver, count the words. Until then, treat the Shotgun's
numbers here as the GUN-LASER case, which is the only one any bench has tested.

✅ **Seen on the wire once, 2026-09-18 (Callsign capture cap30, victim's gun).** One Shotgun pull from a
single shooter landed `$HIR,4,0,1,0,45,0,0` and then `$HIR,4,0,1,0,70,0,0` **88 ms later**, on the same
sensor, killing a player with 79 left. The cycle is 900 ms, so it was one pull. What the capture does not
say: the distance, and which emitter sent which word, so the §8 bench still decides the design.

✅✅ **The second word deals `t12`'s OWN magnitude, and the two STACK. Measured on two weapons,
2026-09-18 (playtest lane, F263, victim at 250 armour so nothing could die).** This is the assumption the
whole pricing model rests on, and until this run it was an inference from one capture. The victim's pool
was read between the two words:

| weapon | frame as fired | pool | first word | second word | one pull |
|---|---|---|---|---|---|
| Shotgun (stock) | t5 45 / t12 70 | 250 → 205 → 135 | 45 | 70 | **115** |
| Plasma Sniper (stock) | t5 25 / t12 80 | 126 → 101 → 21 | 25 | 80 | **105** |

⚠️ Those are CALLSIGN's captured values, not ours. We ship the Shotgun at 19 + 20 (39 a pull since F579, three
pulls) and the Plasma Sniper at 25 + 10. Callsign's own Shotgun is a one-pull kill at exactly the 115
pool; ours is deliberately not.

Three negatives from the same run, each worth a line so nobody re-tries them:

* **No token separates the two words.** Protocol, shooter id, team and both trailing tokens are
  identical. `$HIR,0,0,8,2,45,0,0` then `$HIR,4,0,8,2,70,0,0`.
* **The sensor is geometry, not a signal.** The Shotgun's pair landed on sensors 0 then 4, the Plasma
  Sniper's on 4 and 4, and cap30's on 4 and 4. It is where the player was standing.
* **The gap VARIES: 57 ms, 88 ms and 119 ms across three pulls.** So there is no fixed window that
  separates a second word from a second trigger pull, and the AR's 100 ms cycle sits inside that range.
  Any collapse keyed on time would delete real hits (F260).

Magnitude differs only because the catalogue prices the two words differently, and ours prices the
Shotgun's at 20 and 20, which erases even that. We are NOT making "never price two words equally" a rule
to prop up a statistic: a reporting concern must not dictate balance. The collapse belongs on the node,
which knows the live slot after a mid-life weapon swap, where Mission Control only knows the kit.

⚠️ **Which emitter sent which word: SOURCED, not settled, 2026-09-18 (LaserTagMods, Jay).** One expert
statement, credited per this repo's hard rule on protocol discovery: "it actually is both ... so
there is a dual emitter fire. one from tagger, weaker damage and one from headset, greater damage." Read onto the cap30
capture that means the gun sent the 45 and the headset the 70. The capture ITSELF cannot show which
emitter fired which word, so this stays sourced until a bench covers one emitter at a time (F275's own
run does it for free). Our compiled Shotgun does NOT
mirror Callsign's own 45/70 split: it ships `wire.dmg` 19 (20 until F579) and `wire.headset_dmg` 20 (39 together when
both words land, a 3-pull kill at the weapon's own pump gap (700 ms then, 400 ms since 2026-10-17), so no other weapon on the ladder
moves), and locks `t13`/`t42` (the headset word's own reach) at 100, the flat measured shelf of the
range curve below. **2026-09-23 correction (R4/R5, Tony):** the GUN word's own carrier (`t2`,
`wire.range_outdoor_pct`) was pulled back from that shelf to 30, matching the SMG — so the earlier
"both words land at every range this game is played at" was wrong. What actually ships is close range
(both words, 40) and past the gun word's 30% outdoor reach, the headset word alone (20) IF its own
unmeasured range genuinely carries further than the gun word's (F275 — the headset word's real range
has never been bench-measured; treat the 30/100 split as the edge of the close/mid duel band in the
Balance rules table's R4/R8 and R5/R9 rows, not a proven distance). The band where the headset word
would instead cut out at short range (F231's unstable 13-26 transition) is still unmeasured for `t13`
specifically. See `docs/FOLLOWUPS.md` F71 and F275.

**What this means for range.** Callsign never shortens the Shotgun: its frame carries `t2` = 100, the
same as every Callsign gun. What varies with distance is only the 70-damage headset word, through
`t13` 80 outdoors and `t42` 30 indoors (35.2 and 28.2 kHz on the headset's own formula, 38000 − 140 × (100 − r);
see `protocol/brx-protocol.md` §6). So Callsign's Shotgun is
"45 at any range, 115 up close", not "short range". ⚠️ **Superseded 2026-09-23 (R4/R5, see the
correction three paragraphs above): our `t2` was 22 when this comparison was written, on the unstable
13-26 knee it names. It now ships at 30, on the flat shelf's edge, matching the SMG — the comparison
below is historical, not current.**

### 7.1 There are only four ways to take someone down

| way | mechanism | what it is good against | what it is bad against |
|---|---|---|---|
| **Plain damage** | fn 1: drains shield, then armour, then health | a bare target: nothing is faster | anything wearing a big pool |
| **Armour piercing** | fn 2 or 6: straight to health, ignores armour | a heavily armoured target | a bare target, because its damage has to be cut |
| **Stripping** | fn 20: removes every protective layer and CANNOT kill | a big pool, with a teammate to finish | a bare target: it does literally nothing |
| **Denial** | fn 23: the target's accuracy falls to 0 for about 3 s | anyone who has to aim | anyone who simply walks away |

A fifth, **damage over time**, is node-driven (S16, `spec/node.md` §3.17). It is the answer to walking away,
which is what makes it the natural counter to denial.

### 7.2 The triangle, in seconds

> ⚠️ **Superseded by §7.7.** Armour Piercing is a perk priced per weapon (`ap_dmg`/`ap_fire_ms` in
> `weapons.json`), not a flat `t5` = 3 on the primary. This section is kept for the reasoning.

The Assault Rifle chassis at 9 damage and 100 ms, against the three pools we ship. Armour Piercing is
priced at **`t5` = 3**, one third of base. That number is not "about 60%": it is the integer that works.
0.4 x 9 is 3.6, and rounding it to 4 gives AP a 1.10 s kill that beats plain damage everywhere, which
is the exact failure the price exists to prevent.

| target | plain damage | armour piercing (t5 = 3) | winner |
|---|---|---|---|
| standard, 45 + 70 | **1.20 s** | 1.40 s | plain |
| Body Armor, 45 + 95 | 1.50 s | **1.40 s** | AP, narrowly |
| Shields preset, 45 + 105 | 1.60 s | 1.40 s | AP, and only because the preset moved to 45 health: see §7.3 |

The first two rows are the whole point: **the armoured player beats the plain rifle, and the plain
rifle beats the armour-piercing one.** Neither margin is large, which is what keeps the choice a
preference rather than a solved problem.

### 7.3 Measured: armour piercing ignores the shield too, so the Shields preset moves to 45 health

Bench 2026-09-18, the playtest session, two guns. Victim at **45 health / 70 armour / 120 shield** (the
shield granted with `$LIFE,0,0,120` after spawn, because a spawn shield is always 0), its `<4,0>` row on
fn 2, shooter keyed to that cell at magnitude 9. Five shots:

```
$HP,36,70,120   $HP,27,70,120   $HP,18,70,120   $HP,9,70,120   $HP,0,70,120  (died)
```

Every shot took exactly 9 off **health**. The armour never moved from 70 and the shield never moved from
120: **the victim died with a full shield and full armour standing.** So fn 2 does not drain the layers
in order, it ignores both of them. The protocol note that said so was right, but it had been a reading
rather than a run, and it is now a measurement.

**The consequence, and it is the branch that costs us a number.** With only 30 health under the shield,
bypassing the shield means bypassing almost everything: Armour Piercing would kill a Shields-preset
player in **0.90 s** against a plain rifle's 1.60 s. That is not a triangle, it is a hard counter.

**The Shields preset therefore carries 45 health, not 30**, keeping the pool at 150 (45 + 105). Armour
Piercing then needs the same 1.40 s against it as against anyone else, which is the design in one line:
**armour piercing does not care what you are wearing.** The plain rifle still beats it against a bare
target and still loses to it against armour, so the triangle closes.

⚠️ The preset is not a stored number: `is_shields_preset()` reads "this game's base armour is zero", and
the host sets the health. So this is guidance the host can override, which is why `validate()` now warns
when a shield-only game carries less health than an Armour Piercing weapon needs to face.

### 7.4 Placement: the slot is part of the balance

Three slots, and each one answers a different question.

| slot | the question it answers | what may go in it |
|---|---|---|
| **Primary** | how do you kill someone | anything lethal |
| **Secondary** | what do you do about what they are wearing, or what they are doing | the lethal backups, plus the two weapons that cannot kill |
| **Perk** | what are you willing to give up | see `perk-design.md` |

**The rule that falls out, and it is a real one: a weapon that cannot kill may never be a primary.**
A player whose primary cannot finish anyone is not playing a hard game, they are holding a broken
tagger. The stripper (fn 20) and smoke (fn 23) are both in that class: measured, useful, and unable to
take a single point of health. They are secondaries, and carrying one costs the player their backup gun,
which is the price that makes them fair. That rule wants a validator and a test, not a convention.

### 7.5 Where each new thing goes

| piece | slot | why |
|---|---|---|
| **Toxin Rifle** (DoT) | primary | it kills, slowly, and it punishes disengaging. Its direct damage is about half its family's, because the tick is the payload |
| **Armour Piercing** | primary | it kills, and at `t5` = 3 it is the answer to armour and nothing else |
| **Stripper** (fn 20) | secondary | it cannot kill. It undresses a target through EVERY layer and carries overflow between them, so one player strips and another finishes. A pure team weapon |
| **Smoke** (fn 23) | secondary | it cannot kill. It buys three seconds in which the target cannot hit anything |
| **Crit chance** (`t6`) | a weapon TRAIT, never a slot | it is variance, not power: it makes a slow weapon occasionally fast |

**Two hard rules on crit**, both measured. It is a straight percentage the gun rolls, and it multiplies
whatever the word would have done, **including an armour-piercing hit** (bench 2026-09-18: 13 damage
straight to health through untouched armour). When Armour Piercing is compiled, its primary crit chance
token (`t6`) is set to zero. The 0.4-to-0.33 price assumes every hit lands for the same cut amount.
A crit weapon must never be the
highest-damage weapon in its family, because variance on top of a big number is how a one-shot weapon
becomes a no-counterplay weapon.

### 7.5b The Toxin Rifle, and the number that makes it interesting

Declared 2026-09-18, in the picker since 2026-09-19 (S16). The gun lands the direct hit. The poison is
a clock on the victim's own phone (`spec/node.md` §3.17). Nothing on the wire can tick, because the
same bench proved the whole fn 24-27 family applies no damage at all.

| lever | value | why |
|---|---|---|
| direct damage | **8** at 110 ms | slower than the Assault Rifle on purpose: the rounds are not the payload |
| poison | **4 a second for 5 s**, refreshed on each hit, never stacked | worth 20 damage, which is more than two rifle hits |
| `$SIR` cell | `<11,0>` fn 1 | protocol 11 is the stock enum's "gas", and the node keys its clock off that protocol arriving in `$HIR` token 2 |

**The number that makes it interesting is 12.** Fired straight it kills in 1.54 s, clearly worse than
the rifle's 1.20 s. But the poison is worth 20, so **twelve hits are lethal even if the target breaks
contact**, and twelve hits take 1.21 s. It matches the anchor rifle's speed exactly, and pays for it in
a way no other weapon does: **you never see the kill land.** They may reach a respawn station, or a
medic, and you will not know until the scoreboard moves.

That is also what makes it the natural counter to the Haze (hidden since F577) and to any player who disengages: it is the
only weapon that keeps working after the shooting stops. Refresh rather than stack is deliberate; two
poison shooters must not double the clock, or a pair becomes an execution.

**Simulated 2026-09-19** (`mcp/tools/balance_sim.py --preset toxin`, two teams of 2 to 10, one toxin carrier a
side, every hit poisons; the numbers below are the shipped row's own line of that sweep, `dmg=8
dot.per_tick=4 dot.duration_ms=5000`, so this one command reproduces this page). The shipped row sits at
kill-rate near-parity with the Assault Rifle: 0.99 averaged over team sizes and accuracies, and 51% in a
1v1 (95% CI 48-54%). About 20% of its kills land after contact broke. It drifts from 1.06 in 2v2 (95% CI
1.00-1.13) to 0.95 in 10v10 (95% CI 0.91-1.00): bigger teams focus fire, the poison refreshes instead of
adding up, and a teammate's bullet finishes most poisoned targets first. Rows with 9 direct damage also
reach parity, but only about 8% of their kills come from the poison, so they play as a rifle. The two
numbers the result depends on most are invented, not measured: the focus-fire rate and the length of
a line-of-sight window (short peeks push the toxin to 1.13, long ones pull it to 0.87).

**The §2.3 dominance check carves it out.** The check's four axes see only damage that lands during
contact. With the poison counted at its 20, the Assault Rifle still covers the Toxin Rifle on all four:
1.20 s against 1.21 s, and a hair on the other three. So a poison weapon is its own family, the same way
a sidearm is, and this sim is its balance check. The carve-out works in one direction only: a poison
weapon that beats a weapon of its natural family on every axis, poison counted, still fails the check.

### 7.5c The balance sim, for every weapon

`mcp/tools/balance_sim.py` runs the same fight model as the toxin study for every weapon in the
catalogue. It reads each weapon's numbers from `WeaponCatalog`, and the pool and respawn delay from the
game default. Nothing is typed into the tool. It is a library too, so a test or a later MC feature can
call it.

Run it from any folder. The CSV and a short summary go to the current directory.

```
python3 mcp/tools/balance_sim.py                      # duel matrix + team table, visible weapons
python3 mcp/tools/balance_sim.py --include-hidden     # the hidden rows too
python3 mcp/tools/balance_sim.py --venue indoor --no-range
python3 mcp/tools/balance_sim.py --weapon amr --sweep dmg=18..24 crit_pct=0,30
python3 mcp/tools/balance_sim.py --preset toxin       # the §7.5b sweep, about 45 s
```

The team number is a kill-rate ratio against an anchor of the same slot kind, with one test weapon on
each side of 2 to 10 players. A sidearm is compared with the USP-S. Every other weapon is compared with
the Assault Rifle. `--anchor` sets one anchor for all weapons. The summary ranks weapons by their
distance from 1.00. It flags a weapon as dominant or dominated when the 95% interval stays on one side
of 1.00 at every team size. A pick-up-only heavy gets its ratio but no flag, because no loadout weapon
competes with it for a slot.

The answer moves most with these assumptions. All of them are invented, and each has a flag:

The current field defaults are hit probability 0.35, mean contact 3 s and ordinary mean gap 70 s. After a
respawn, the separate mean seek delay is 7 s. A player who waits for a defeated opponent's respawn seeks
that opponent first, while an old seek cannot replace a live engagement. These are the density refit values;
the toxin preset retains its historic 2 s contact and 3 s gap unless its options override them.

In a semi-auto fight, each round fires at `t14` plus a lognormal overshoot. The fitted median is
`FIGHT_OVERSHOOT_MS` 36.67 ms, from the USP, AMR and Desert Eagle field medians. The bolt lever and the
press after it use the 300 ms pull model. `compile.py` publishes the same fitted fight interval
for ordinary single shots. Its expected overshoot is about 43 ms after `t14`. Reloads and lever vents progress only
while the weapon is in hand. A swap credits a finished reload. It cancels an unfinished reload or vent.
When cooling is on, heat cools while holstered.

Heat cooling while firing is unproven pending bench check F575. The default is on, matching the catalogue
cooling rate. With `HEAT_COOL_WHILE_FIRING` off, heat does not cool; a lockout resets heat to zero.
A close-range melee swing uses `MELEE_HIT_P` 0.9 at aim 1, scaled by aim and blindness.
The published TTK remains gun-only.

- **Range** (`--no-range`, `--venue`). Each fight draws close, mid or long from the venue. A table
  (`BAND_FIT`) scales the hit chance by the weapon's `range_band` and that distance. Each band has
  the best hit chance at its own distance: a close weapon gains 30% up close, and a long gun loses
  20% there. The first version only penalised a weapon beyond its band, so a close weapon could never
  gain in the venue built for it.
- **Tactical reload** (`--no-tactical-reload`). A player below half a magazine reloads between
  fights. A long reload then costs less.
- **Focus fire and line of sight** (`--contact-mean-s`, `--gap-mean-s`). The toxin preset keeps the
  historic §7.5b contact and gap values; the field defaults use the refit above. Short peeks (1 s) lift
  the weapons with a big first hit: the Charge Rifle goes from 1.37 to
  1.60 and the Sniper Rifle from 0.75 to 0.89. They hurt the Rail Gun, which must charge first.
- **Hit chance** (`--hit-prob`). One number for every weapon: the sim has no recoil or stance.

Run on 2026-09-19 with range on:

| weapon | outdoor | indoor | note |
|---|---|---|---|
| Charge Rifle | **1.39** dominates | 1.07 | it opens every fight with a pre-built 85 |
| Shotgun | 0.50 dominated | 0.66 dominated | the catalogue, not the model: see below |
| Sniper Rifle | 0.76 dominated | 0.57 dominated | indoors it rarely gets its distance |
| Suppressor, Energy Rifle | about 0.7 dominated | about 0.7 dominated | |
| SMG | 0.85 dominated | 0.95 | |
| Burst Rifle, Desert Eagle | about 1.0 | about 1.0 | at parity with their anchors |

**The Shotgun finding is for the catalogue, not the sim.** Even at 100% accuracy with range off, the
Shotgun sits at 0.67 to 0.88: three pulls at 800 ms was 1.6 s against the rifle's 1.2 s (this run
predates R8, which moved the Shotgun to 700 ms on 2026-09-23; see the Balance rules table). When every
fight is close, it reaches 1.05 at 2v2 but falls to 0.89 at 10v10. One hit chance for every weapon
costs it most in a duel (53% at 100% accuracy, 29% at 50%), and much less in a team.

**Recoil duel mode (F291, 2026-09-23): three named rules, checked stochastically.** `mcp/tools/balance_sim.py
--scenario recoil-duel` runs a separate, purpose-built 1v1 (a discrete-event race over the same recoil
accuracy model `app/src/engine.js` runs, not the many-player skirmish above) to check three of Tony's
rules at full Standard health (115 pool): a Charge Rifle with a charge already built beats an Assault
Rifle; an AR that catches an uncharged CR beats it; and an AR firing controlled 3-5 round bursts (150-300
ms pauses) beats one held in full auto. The first pass, at the shipped 285 ms Charge Rifle tap cadence
and the shared 100/80/60 AR recoil ladder, found rules 1-2 comfortable (93%, 57-83% depending on cadence)
but rule 3 failing badly (29%): a burst short enough to stay crisp (at most 5 rounds, the AR's `after_shots`
was 6) earns back nothing from its own 150-300 ms dead time against a full-auto AR that does not go heavy
until round 9. A parameter sweep over the AR's own ladder found no combination that cleared 65% on all
three rules while the pause stayed real (150-300 ms, per Tony: do not shrink it to fix this): rule 2's own
AR combatant was, at that point, still modelled as full auto too, so deepening the ladder enough to help
rule 3 also weakened the AR's own showing in rule 2, and the two pulled the one shared dial in opposite
directions.

**A tap-cadence "fix" was tried and reverted the same day.** Moving `CHARGE_TAP_CADENCE_MS` 285 → 350 ms
changed rule 2's numbers in the sim, but that constant is the PLAYER'S OWN physical trigger-pull rate: no
`$WEAP` token encodes it, and the gun neither reads nor enforces it at all, so the move changed nothing a
real gun does — only what this module's own htk/ttk_ms arithmetic assumed a human could do. Reverted; 285
ms remains the only hardware-measured figure this constant has ever had.

**The fix that shipped is on the wire.** The Charge Rifle's tap damage moved 20 → **16** (`wire.tap_dmg`,
t37, independent of the charge magnitude on t5, bench-proven 2026-09-17: t37=30 changed only the tap
while t5 stayed put) — a real, gun-enforced lever. 16 still closes a 115 pool in exactly three taps
(3×16=48 ≥ the 45 left after the charge), so the combo stays charge + 3 taps and `htk`/`ttk_ms` are
unchanged from the pre-F291 row. The AR's own rule-2 combatant was also corrected to burst, matching rule
3 (Tony: the AR player who catches an uncharged CR is the skilled one, not a full-auto spray). With both
changes plus the deeper AR ladder (`degraded: 70, heavy: 40`, `after_heavy: 8` — heavy from round 8, one
round sooner than the shared 9; tightened again the same day to `after_heavy: 7` for R7, row 11), all
three rules clear 65% at 10,000 reps. The AR's `after_shots` (6) is unchanged, so a controlled burst
still never degrades at all — only full auto pays the deeper floor.

**The three rules are now a CI gate, not only a CLI report.** `mcp/tests/test_balance_sim.py::test_recoil_duel_rules_clear_the_65_percent_bar`
runs 10,000 reps a rule and fails with the rule's name and a pointer to the Balance rules table (top of
this document, row 4) if any of them drops below 65% — a catalogue edit that breaks a duel rule now
fails in CI, not only on the bench.

### 7.5d R4-R9: close/mid-range duel rules (row 11)

`--scenario range-duel` extends the recoil-duel engine with a range band: close (gun word + a declared
headset word) or mid (past the headset word's own reach, unmeasured — F275: the gun word alone). Six
rules, each "most of the time" meaning ≥ 65% at 10,000 reps. **(R4)** close range: the SMG (7+2=9/round,
full auto) and the Shotgun (20+20=40/pull then; 19+20 since F579) each beat a bursting AR and the Burst Rifle. **(R5)** past
headset range: a bursting AR beats the Shotgun, and the SMG — the SMG's own split moved 8+1 to 7+2
(close-range total unchanged at 9) so the gun word alone drops to 7, which first read only ~62% at 8.
**(R6)** a bursting AR beats the Burst Rifle. **(R7)** the Burst Rifle beats a full-auto AR — R6 and R7
first shared the Burst Rifle's own numbers as their only lever, pulled in OPPOSITE directions; the
Assault Rifle's own `after_heavy` tightening 8 → 7 (row 3) gave R7 a lever that never touches R6's
controlled-burst AR (it never reaches round 7). **(R8)** close range: the Shotgun beats the SMG on full
auto (row 6's 700 ms then; 400 ms since 2026-10-17). **(R9)** past headset range: the SMG beats the Shotgun.

**Crits reopened R4b and R6, then Tony closed them (2026-09-23, polish round 1, F308).** Crits were not
modelled in this engine until this pass; the Burst Rifle's own 40% (`crit_pct`, `int(magnitude x 1.5)`
truncated, same formula as `compile.py`'s `t6`) raises its average round damage about 20%. That closed
enough of R4's SMG-vs-Burst-Rifle margin and R6's margin that neither cleared 65% any more: **R4b ~48.8%,
R6 ~21.7%** at 10,000 reps (the shipped 700 ms Shotgun-vs-Burst-Rifle pairing, R4d, and R7 both stayed
clear at 68.8% and 87.8%). Three candidates were swept, each holding the other two at their shipped
values (10,000 reps a cell) — kept here as history, not a live table:

| lever | sweep | R4b | R4d | R6 | R7 | note |
|---|---|---|---|---|---|---|
| `crit_pct` | 40 → 0 | 48.8% → 81.2% | 68.8% → 87.9% | 21.7% → 68.3% | 87.8% → 67.0% | no partial value clears R4b AND R6; only removing the crit entirely does |
| `overrides.t23` (gap) | 410 → 700 ms | 48.8% → 93.3% | 68.8% → 93.1% | 21.7% → 89.9% | 87.8% → 41.6% | **chosen: 550** — the only candidate that clears all four alone (79%/86%/69%/65%; R7 is the tightest of the ten R4-R9 cells at 65.48%) |
| `wire.dmg` | 10 → 7 | 48.8% → 96.2% | 68.8% → 96.5% | 21.7% → 95.2% | 87.8% → 37.6% | dmg 8 clears R4b/R4d/R6 but drops R7 to 61%; no integer value clears all four |

**Tony's decision: keep the 40% crit, move the gap again** (`overrides.t23`, 410 → 550 ms — the
smallest single-token value of the three swept above that clears R4b, R4d, R6 and R7 together with the
crit modelled). Shipped 2026-09-23. All ten R4-R9 cells clear 65% again, but R7 (the Burst Rifle
beats a full-auto AR) is the **tightest of all ten, at 65.48%** — the smallest single-token gap that
clears the other three cells leaves R7 with almost no margin, since it is the one cell the gap moves
the opposite direction from R4b/R4d/R6 (a wider gap helps them and hurts R7).

**Polish round 2 (Tony, 2026-09-24, F308, bench 4.3): "full auto point blank … too harsh."** Rather
than hold the 100/70/40 AR ladder that made R7 a knife-edge, Tony chose to ease it — "leave the AR at
45 … I like our rock paper scissor design": `recoil.heavy` 40 → 45 (row 3), and the Burst Rifle's own
`overrides.t23` gap eased 550 → 540 ms alongside it. R7 settles at **~57.1%**, under the shared 65%
bar, so R7 alone gets its own bar, **55%** (`RANGE_BAR_OVERRIDES` in the test, row 11) — the
rock-paper-scissors triangle still holds (a bursting AR beats a full-auto AR and the Burst Rifle; the
Burst Rifle beats a full-auto AR), just "more often than not" for R7 rather than "most of the time".
R3 (~67.1%) and R6 (~66.2%) both still clear 65% at the eased numbers, unchanged. On Shields, R7 rises
to ~72.4%, comfortably inside `SHIELDS_BAR` (60%), so the Shields bar is untouched.
`python3 mcp/tools/balance_sim.py --scenario range-duel`; gated in CI by
`mcp/tests/test_balance_sim.py::test_range_duel_rules_clear_their_bar`. Bench item:
`docs/FOLLOWUPS.md` F308.

### 7.5e R10: sidearms finish a kill, they do not compete with rifles (row 12)

Tony: "the sidearms should be finish a kill weapons not competitive against rifles." Only the two LIVE
sidearms (USP, Desert Eagle; the Glock is `hidden`, untouched). Both levers are real-world, not invented
magazine cuts ("no pistol clip is that small"): Desert Eagle cadence 480 → 700 ms (`wire.fire_ms`, `.50
AE` recoil, magazine unchanged at 7); USP magazine 19 → 12 (a real USP .45's own capacity), so its own
13-hit kill no longer fits one magazine (`test_shipped_roster_satisfies_the_mag_invariant_at_the_
default_pool`'s named exemption). **2026-10-17:** the USP moved to 12 damage at 190 ms for the 1.2 s R10a
bar, so it kills in 10 hits on one magazine again and the exemption is gone (Tony: "ok to finish a player on
standard life if you hit 10/12 shots"). **2026-10-24 (F579):** the USP moved to 10 damage, so it kills in 12 hits,
exactly one magazine. At field pace (the duel engine since F579) its 35 HP finish is about 1.0 s.

Two halves, each ≥ 65% for (b): **(a)** each live sidearm finishes an undefended 35 HP target (health
only) within the R10a bar median, reaction delay included. The bar was 1.0 s (USP ~779 ms, Deagle ~974 ms
under the old gun-limited cycle); from 2026-10-17 it is 1.2 s, with the player-paced cycle (row 14): USP
(12 at 190 ms) ~1066 ms, Deagle ~1173 ms at 300 ms pulls.
**(b)** every primary this engine can model (Assault Rifle, Burst Rifle, Energy Rifle, Suppressor, AMR,
Bolt Rifle) beats each live sidearm from full Standard health — all twelve pairs clear it, including the
Suppressor against both pistols (99.8% USP, 77.9% Deagle). **2026-10-24 (F579):** those figures are the old
300 ms pull pace. At field pace, with the USP at 10 damage, the finishes are USP ~1008 ms and Deagle ~1017 ms, and
the Suppressor wins 83.9% against the USP and 85.6% against the Deagle (seed 7, 10,000 reps). The Toxin Rifle (DoT) and the Force Rifle
(burst mode + a real recoil ladder) are named, not modelled — neither mechanic exists in this engine.

**The Suppressor's own recoil exception (R10, row 3).** Tony: "it should be weaker since its silent but
not too weak." It first read ~62% against the Deagle; `recoil.heavy` moved 60 → 70 (declared, not
derived — every other reference-calibre weapon ships the 60 floor), so `degraded` derives to 85, not 80.
`after_shots`/`after_heavy` are unaffected (they derive off `dmg`, not `heavy`): still 7/10. It still
trails every other primary against a bursting AR (92.4%, the highest of the six), so it stays the
weakest primary by design.

`python3 mcp/tools/balance_sim.py --scenario r10-duel`; gated in CI by `mcp/tests/test_balance_sim.py::test_r10_sidearms_finish_a_kill_within_the_bar`
and `::test_r10_primaries_beat_sidearms_at_65_percent`; `test_mc_sidearms.py::test_pistol_identities_keep_tonys_ordering`.

### 7.5f F310: the rules on the Shields and Hardcore presets

Tony: the rules should hold on Shields "looser but generally yes". Every duel above runs from one pool number,
now set by `--health-preset` (Standard 45 + 70 armour = 115, Shields 45 + 105 shield = 150, Hardcore 45). Damage
drains shield, then armour, then health, and the shield refills only after 6.5 s with no damage, which no duel
allows, so the pool is treated as one number. 10,000 reps, seed 7:

| rule | Standard | Shields | Hardcore |
|---|---|---|---|
| R1 charged Charge Rifle beats an AR | 92.8% | 96.2% | 90.0% |
| R2 AR beats an uncharged Charge Rifle | 91.7% | 84.8% | 90.7% |
| R3 bursting AR beats full-auto AR | 67.1% | 79.4% | 20.0% |
| R4a SMG beats a bursting AR, close | 71.0% | 65.0% | 81.1% |
| R6 bursting AR beats the Burst Rifle | 66.2% | 67.4% | 64.6% |
| R7 Burst Rifle beats a full-auto AR | 57.1% | 72.4% | 10.1% |
| R8 Shotgun beats the SMG, close | 69.0% | **63.0%** | 4.7% |
| R10b Suppressor beats the Desert Eagle | 78.3% | 68.9% | 43.4% |

Every other R4-R9 and R10b cell reads 74% or more on Shields. On Hardcore a few rounds kill, so the rules
built on sustained fire (R3, R7, R8, most of R10b) collapse, which is that preset's point; it is reported, not
gated. **Shields bar: 60%, Tony 2026-09-23** (the lowest cell, R8, clears it by 3 points; the 95% interval at 10,000
reps is about ±1 point). `SHIELDS_BAR` in `balance_sim.py`; gated by `mcp/tests/test_balance_sim.py::
test_shields_preset_recoil_rules_r1_to_r3`, `::test_shields_preset_range_rules_r4_to_r9` and
`::test_shields_preset_primaries_beat_sidearms_r10b`.

**2026-09-24, polish round 2 (F308):** the AR's `heavy` eased 40 → 45 and the Burst Rifle's burst gap
eased 550 → 540 ms (Balance rules table, row 11). R3 moves 76.7→67.1% (Standard) and R7 moves
65.5→57.1% (Standard) — both stay on their own bar (R3 still 65%; R7 gets its own 55%, row 11). Every
Shields cell moves with them but stays clear of `SHIELDS_BAR` (R7 rises to 72.4% on Shields, R3 falls
to 79.4%, still well over 60%), so the Shields bar itself is untouched. R4a, R8 and R10b are unaffected
(neither weapon's recoil ladder is in scope for those cells at these bands).

**Decisions for Tony (F310).**
1. **The Shields bar: decided (Tony, 2026-09-23): 60%.** See the Balance rules table, row 13.
2. **The heavies on Shields: decided (Tony, 2026-09-23).** The Rocket Launcher's headset word adds 35, so a close
   hit makes 150 and kills a full Shields player. How far that word reaches is unmeasured (F275). The Rail Gun does 149: a
   kill on Standard and Hardcore, and a full Shields player left on 1 HP. The hidden heavies stay at 115. See the
   Balance rules table, row 7.

### 7.7 Armour Piercing takes two levers, not one

The perk shipped at `_AP_DAMAGE_MULT = 0.4`, described as a 60% cut. Worked across the catalogue on
2026-09-18, **that left Armour Piercing strictly better on 11 of 13 weapons**: the same time to kill or
faster, and it ignores every protective layer. It was not a counter-pick, it was the correct pick.

**Two reasons, and both matter.**

First, a multiplier cannot price this perk at all. Bypassing armour takes a standard target from a 115
pool down to 45 health, and **45/115 is 0.39**. Any multiplier near 0.4 therefore leaves hits-to-kill
unchanged, which is a perk that costs nothing. The number chosen to look like a heavy penalty was almost
exactly the number that makes the penalty vanish.

Second, **damage alone cannot price it either, because damage is an integer.** On an 8-damage weapon the
only choices are 3, which gives exactly the hits-to-kill its plain rounds already need and so is free,
and 2, which is useless. There is nothing in between. Priced on damage alone the perk fitted **two**
weapons in the whole arsenal.

**The fix is to drop the cycle as well** (Tony's suggestion, and it is the right one). That makes the
trade continuous instead of stepping in huge jumps, so every plain-damage weapon can carry the perk. It
is also what the perk should feel like: heavier rounds, fewer of them, slower. Armour Piercing changes
what your gun IS rather than just weakening it.

| weapon | plain | with Armour Piercing | against a bare target |
|---|---|---|---|
| Assault Rifle | 9 at 100 ms | 4 at 131 ms | 0.24 s slower |
| SMG | 7+2 at 100 ms | 4 at 131 ms | 0.24 s slower; the headset word is not carried by AP |
| Shotgun | 19+20 at 400 ms | 15 at 467 ms | 0.13 s slower; priced against the gun word alone |
| Suppressor | 8 at 140 ms | 6 at 314 ms | 0.24 s slower |
| Energy Rifle | 9 at 150 ms | 4 at 170 ms | 0.07 s slower |

The last column is the Armour Piercing time to kill minus the plain time to kill, against a standard 45 HP + 70 armour
target (a 115 pool). Plain uses `WeaponCatalog.hits_to_kill(wid, 115)` minus one, times `cycle_ms`. Armour Piercing uses
`ceil(45 / ap_dmg)` minus one, times `ap_fire_ms`. This is the same method as `test_armour_piercing_is_priced_fairly_on_every_weapon_that_carries_it`.
Tony approved these integer damage and cycle pairs after the fraction-arithmetic review. The compiler writes the listed values directly. The hidden Stinger carries 5 at 250 ms.

Tony also approved three more pairs on 2026-10-25: AMR 10 at 399 ms, Burst Rifle 7 at 430 ms and USP 5 at 277 ms.
They are not in the catalogue yet. The guard stays for those three weapons until the F618 bench row passes.

**What is still refused.** The AMR, Burst Rifle and USP stay refused until the F618 bench row passes, even though their
pairs are approved. A weapon
whose cell is already a headset-multiplier row (fn 36/37) otherwise remains refused, because re-keying it
would change what the weapon does rather than where its damage goes. A charge weapon remains refused
because its hits-to-kill is release-and-tap maths. A **one-shot weapon has no window at all**: the Rocket
Launcher kills a standard target in one hit, a time to kill of zero, and a bypass cannot be sold to a
weapon that already kills outright.

The decision log, with the rejected variants, is in [balance-decisions.md](balance-decisions.md) (2026-10-25). Under Armour Piercing a weapon's crit chance is zero.

Two guards hold all of this: `test_armour_piercing_is_priced_fairly_on_every_weapon_that_carries_it`
walks every priced weapon and checks both ends of the trade plus the cycle direction, and
`test_armour_piercing_is_refused_on_a_weapon_with_no_fair_price` proves the refusal. ⚠️ The test they
replace **asserted the bug**: it required the perk to beat a plain rifle against a BARE target, which is
the definition of a strict upgrade.

**Plasma Sniper's `ap_dmg`/`ap_fire_ms` were removed 2026-09-18.** The headset word (§7, `wire.headset_dmg`)
made the plain weapon's combined per-pull damage 35, not 25, so the old 9-damage/450ms pair (priced against
the 25-alone number) no longer bought anything: against an armoured 140 pool the plain weapon killed in
1200 ms and Armour Piercing needed 1800 ms, 600 ms SLOWER than not taking the perk. The weapon is hidden,
so a fresh price for nobody to pick is unfounded guesswork; `_refuse_if_ap_ineligible` now refuses it
cleanly, the same as any weapon with no pair. Needs a fresh `ap_dmg`/`ap_fire_ms` if the Plasma Sniper is
ever unhidden.

### 7.6 The support weapons, and why they publish zeros

Two weapons deliberately cannot kill. They are the only rows carrying `lethal: false`, they are refused
in the primary slot by `validate()` and kept out of the primary pool by `policy.pool()`, and carrying
one costs the player their backup gun. That cost is the whole balance.

| weapon | cell | what a hit does | measured |
|---|---|---|---|
| **Breacher** | `<5,0>` fn 20 | takes 9 off whatever the target is WEARING, through every layer in order, with the overflow carrying between them. It cannot touch health. Pointed at a teammate it does the opposite and grants armour, because fn 20 is dual-polarity | shield 120 to 0, then armour 70 to 0, health fixed at 999 throughout; eleven further hits on a bare target moved nothing |
| **Haze** | `<7,0>` fn 23 | the target's live accuracy falls to 0 for about three seconds. They keep firing and keep spending rounds, and every shot misses. It takes no health | accuracy 100 to 0 in the same millisecond as the hit, recovering 0, 2, 4, 7, 12 over about 3 s, nothing left behind |

**The EMP perk's cell is `<8,1>` fn 23** (2026-10-24, the perk that replaced the Haze as a weapon). No weapon fires
on it: the holder's phone writes a host `$IRTX` there, and every gun in a match with a holder carries the row. It sits
beside `<8,0>`, which stays the Charge Rifle's cell. `hitaudio.RESERVED_CELLS` keeps the allocator off it.

**They publish `dmg`, `htk` and `ttk_ms` of zero, and that is deliberate.** Their frames carry real
magnitudes, so the ordinary derivation would advertise the Breacher at an 8 damage bar and 13 hits to
kill. A player reading that would expect it to kill in 13 hits, and it cannot kill at all. The zeros are
the honest number, `test_a_support_weapon_publishes_zeros_and_is_documented` enforces them, and the same
guard requires each weapon to appear in this table so the exemption cannot be used to hide a row.

**What they are for.** The Breacher is a team weapon: one player undresses a target and another finishes,
and against a bare opponent it does nothing whatsoever. It is the answer to a big pool that is not simply
more damage, and it is the only answer that works identically against Body Armor and the Shields preset.
The Haze buys three seconds in which someone cannot shoot back: crossing open ground, breaking a firing
line, taking a point off a defender. Neither wins a duel, which is exactly why neither may be a primary.

⚠️ **The Haze needs the HUD before it ships to players** (S53). A player whose shots stop landing, with
no explanation on screen, will report a broken tagger. The tell needs no new wire support: a `$HIR` that
moves no pool, together with live accuracy at 0.

**The Haze is hidden (F577, Tony 2026-10-18: "Lets hide it").** Its row carries `hidden: true`, so it leaves
every picker, preset pool and type toggle, like the Glock. The 3 s blind beats AR + Body Armor at mid about
0.94 in the sim (0.29 at 1.5 s). It comes back when two things are done: a bench shows whether a `$SIR`
magnitude can shorten the blind, and S53 closes. The HUD tell is built (2026-09-19); the smoke sound and the
recovery steps are still open.

## Appendix — token positions

What `resolve()` writes, read from `WeaponCatalog._T` and `resolve()` in `mcp/brx_mcp/mc/compile.py` on
2026-09-24 (the code is canonical; re-read it before trusting this table). Doc `tokN` ==
`frame.split(",")[N+1]`.

| token | field | written? |
|---|---|---|
| `t0` | slot | ✅ set per call |
| `t2` | gun range, outdoor (carrier, [ir-effects §6.5](ir-effects-design.md)) | ✅ from `wire.range_outdoor_pct` outdoors |
| `t5` | damage | ✅ when `wire.dmg` is present (or an Armour Piercing price, §7.7) |
| `t6` | crit chance | ✅ when `crit_pct` is declared (F62) |
| `t12` / `t13` / `t42` | headset word: damage, outdoor and indoor range (§7.0) | ✅ from `wire.headset_dmg` / `headset_range_*` where the frame has a headset word |
| `t14` | fire interval / charge time | ✅ when `wire.fire_ms` is present (or an AP cycle) |
| `t15` | weapon swap delay | ✅ always: `wire.swap_ms`, else the captured value (850 on stock guns), scaled by a `switch_mult` perk |
| `t16` / `t39` | max clip / clip start | ✅ always, kept equal |
| `t17` / `t40` | reserve / reserve-half | ✅ always, kept at `t17 == 2 × t40` |
| `t18` | reload ms | ✅ always |
| `t37` | charge rifle tap damage | ✅ when `wire.tap_dmg` is present |
| `t3` `t4` | the **`$SIR` composite key**: selects the victim-side effect ([ir-effects §6](ir-effects-design.md)) | inherited, unless an override or a re-key (Armour Piercing, `--distinct-weapon-cells`) moves it |
| `t19` `t20` `t21` `t22` `t23` `t24` `t25` `t26` `t27–36` `t38` `t41` | reload type, **fire mode**, accuracy, burst, overheat, muzzle flash, sounds, indoor range | ❌ inherited from the capture |
| declared `overrides` | one named token per entry, with a stated reason (§3.2) | ✅ where declared |
| `t7–t11` | secondary fire | ❌ empty on every stock weapon; no BRX weapon has an alt-fire |
