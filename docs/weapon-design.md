# Weapon design & balance

## Balance rules

The single place Tony's balance decisions live. Every other page links here instead of restating a
rule; only this table changes when a decision changes. "Enforced by" names a test, a bench id, or
says the rule is judgement only.

| # | rule | decided | id | enforced by |
|---|---|---|---|---|
| 1 | Recoil rungs count ROUNDS PER TRIGGER PULL, scaled by calibre: a reference 8-damage weapon fires 5 clean rounds then degrades, 3 more then goes heavy, both counts scaled by `8 / dmg`. A trigger release resets the count while the weapon is still crisp; recovery from degraded or heavy needs 600 ms of quiet. | Tony, 2026-09-23 | S54/F268/F280 (`aa7b08b9`) | `app/test/engine.test.mjs` "S54: the round counts are derived from the row's dmg…"; `mcp/tests/test_balance_sim.py::test_recoil_profile_pins_the_shipped_ar_against_the_engine_test`. The release-reset half is bench-provisional (F308) |
| 2 | A one-press burst or single-shot trigger does not recoil at all — the Burst Rifle and the Charge Rifle both ship flat (`ceiling == floor == 100`). | Tony, 2026-09-23 | S54/F280 | `mcp/tests/test_balance_sim.py::test_recoil_profile_pins_the_engine_tests_synthetic_rows_too`, `::test_the_charge_rifle_carries_no_recoil_profile` |
| 3 | Recoil floors are 60 for the SMG and the Stinger. The Assault Rifle is the deliberate exception, deeper still at 100/70/45, degraded from round 6 and heavy from round 7 (tightened from round 8 the same day, R7 row 11; `heavy` eased 40 → 45 the following day, polish round 2 — "full auto point blank … too harsh") — only a player who holds past round 6 is punished. The Suppressor is the exception the OTHER way (R10, row 12): Tony — "it should be weaker since its silent but not too weak" — so its `heavy` is declared at 70, not the 60 floor; `degraded` derives between crisp and the new heavy, to 85 (was 80). | Tony, 2026-09-18 (floor raise); the AR exception 2026-09-23; tightened 2026-09-23 (R7); eased 2026-09-24 (F308, polish round 2); the Suppressor exception 2026-09-23 (R10) | F268; F291 (`1884c90e`); F308 | same two tests as row 1; the per-weapon table in `docs/spec/node.md` §3.15 |
| 4 | Three duel rules, each "most of the time" meaning **≥ 65%** in a stochastic 1v1 at full Standard health: (R1) a Charge Rifle with its charge already built beats an Assault Rifle; (R2) a skilled Assault Rifle (controlled 3-5 round bursts) that catches an uncharged Charge Rifle beats it; (R3) an Assault Rifle firing controlled bursts beats one held in full auto. | Tony, 2026-09-23 | F291 | `python3 mcp/tools/balance_sim.py --scenario recoil-duel`; gated in CI by `mcp/tests/test_balance_sim.py::test_recoil_duel_rules_clear_the_65_percent_bar` |
| 5 | Charge Rifle: charge damage 70 (`t5`), tap damage 16 (`t37`); a charged kill on Standard health is one charge plus three taps. The 285 ms tap cadence is the player's own trigger-pull speed, not a gun setting — no `$WEAP` field carries it. | Tony, 2026-09-23 | F280; F291 (`3759cd68`) | `weapons.json` `wire.dmg`/`wire.tap_dmg`, pinned by the row-4 CI gate; `CHARGE_TAP_CADENCE_MS`'s comment in `compile.py` |
| 6 | Shotgun: 3 pulls to kill on Standard health, still no recoil model — it has none. Its gap from the rifles was the 800 ms cadence until row 11's R8 tightened it to 700 ms. | Tony, 2026-09-18; retuned 2026-09-23 (R8) | F291; F308 | 3-pull kill is judgement; the 700 ms cadence is gated by row 11's test |
| 7 | One-shot heavies (Rocket Launcher, Rail Gun, Laser Cannon, Energy Launcher, Ion Sniper) are a pickup-only tier: 2-round magazine, 4 kills total, earned at close range rather than out-reaching the rest of the arsenal. On the Shields preset (150): the Rocket Launcher's headset word adds 35 (`wire.headset_dmg`), so a close hit still kills (the word's reach is unmeasured, F275); the Rail Gun does 149 (`wire.dmg`), a kill on Standard and Hardcore that leaves a full Shields player on 1 HP. | Tony, 2026-09-17; Shields 2026-09-23 (F310) | weapon-design.md §2.1 principle 7; §7.5f | `mcp/tests/test_weapon_derivations.py` §2.5 rows; the bench check in `bench-2026-09-24.md` 4.9 |
| 8 | The headset is the primary target: 4 of the tagger's 5 hit sensors sit there, so it carries no bonus multiplier. `criticalShotModifier` (`t7`) compiles to 0, and a headset hit lands the same as a gun-body hit. | Tony, 2026-09-17 (arsenal review) | — | `mcp/tests/test_gameconfig.py::test_crit_modifier_defaults_to_zero_and_headset_multiplier_is_1x` |
| 9 | Easy Reload is accessibility, not balance: it is never tuned or cut on balance grounds, and it lives beside the per-player pool handicap, independent of the perk slot. | Tony, 2026-09-17 ("my daughter cant reload the brx normally") | S50 | `mcp/tests/test_mc_loadout.py::test_easy_reload_is_refused_beside_a_chain_reload_weapon`, `::test_easy_reload_is_refused_beside_a_second_weapon_end_to_end` |
| 10 | The rebalance changes numbers, not feel: every weapon keeps Battle Company's captured fire mode, burst pattern, heat/overheat mechanic and sound; only the declared balance tokens move. | design principle, ongoing | weapon-design.md §2.1 principles 1-3 | judgement, not tested |
| 11 | R4-R9: six close/mid-range duel rules (close = gun + headset word, mid = gun word alone), each **≥ 65%** — except R7 (the Burst Rifle beats a full-auto AR), whose bar is **≥ 55%**. Modelling the Burst Rifle's 40% crit reopened R4b and R6; Tony kept the crit and moved the burst gap again, 410 → 550 ms, the smallest single-token value that clears all four affected cells — see §7.5d. **2026-09-24, polish round 2** (bench 4.3, "full auto point blank … too harsh"): Tony chose to ease the Assault Rifle's `heavy` recoil 40 → 45 and the Burst Rifle's burst gap 550 → 540 ms rather than hold the deeper numbers — "leave the AR at 45 … I like our rock paper scissor design": a bursting AR still beats a full-auto AR and the Burst Rifle, and the Burst Rifle still beats a full-auto AR, now **more often than not** (R7, ~57%) rather than most of the time. R3 and R6 stay at 65% (both clear it, ~67%/~66%). | Tony, 2026-09-23; eased 2026-09-24 | F308 | §7.5d; `mcp/tests/test_balance_sim.py::test_range_duel_rules_clear_their_bar` |
| 12 | R10: sidearms finish a kill, they do not compete with rifles — real-world Desert Eagle cadence and USP magazine levers, plus the Suppressor's own recoil exception. All fourteen checks clear their bars. See §7.5e. | Tony, 2026-09-23 | F308 | §7.5e; `mcp/tests/test_balance_sim.py::test_r10_sidearms_finish_a_kill_under_a_second`, `::test_r10_primaries_beat_sidearms_at_65_percent` |
| 13 | Every rule R1-R10b also holds on the Shields preset (150 pool) at a looser **≥ 60%** bar; Hardcore is reported, not gated. | Tony, 2026-09-23 (F310: "looser but generally yes", then "60 is fine") | F310 | `mcp/tests/test_balance_sim.py::test_shields_preset_recoil_rules_r1_to_r3`, `::test_shields_preset_range_rules_r4_to_r9`, `::test_shields_preset_primaries_beat_sidearms_r10b`; detail §7.5f |

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
| **TTK** | `(htk-1) × cycle`; burst weapons use the burst-average cycle. ⚠️ **Charge weapons are the exception since 2026-09-17**: their kill is one held charge plus the taps that finish it, so TTK is measured from the RELEASE and the charge time is setup, not combat (§2.2, S43). |
| **burst average** | `(2 × t14 + t23) / 3` — three rounds at `t14` spacing, `t23` between bursts |
| **sustained DPS** | `mag × dmg / (mag × cycle + reload_ms)` |
| **total kills** | `(mag + reserve) // htk` |

TTK is the honest headline. DPS flatters weapons that need many hits, and every hit is a discrete IR
event that can miss.

---

## 1. Everything is now based on its own captured frame

### 1.1 What changed and why it matters

The old `WeaponCatalog` built 16 of 19 weapons from **four** sample tails (`ar`, `charge`, `laser`,
`rocket`) with a handful of tokens overwritten. Every weapon built on the `ar` sample inherited the
AR's behaviour in every token we did not explicitly write — which was most of them.

All 20 Callsign weapon frames are now captured and parsed. `resolve()` starts from the weapon's own
frame and writes **only** the balance tokens. That inherits, for free, every behaviour we could not
synthesise:

| behaviour | token | who has it |
|---|---|---|
| **fire mode** | `t20` | see §4.1 — this is the big one |
| 3-round burst timing | `t23` | Burst Rifle (captured 275, ships 540 since 2026-09-24 — R6/R7, row 11, §7.5d), Force Rifle (250) — nobody else |
| overheat + overheat sound | `t24`/`t35` | SMG (5), Energy Rifle (6), Charge Rifle (14), Plasma Sniper (30) |
| damage type | `t3` | Rocket 10 lethal-explosive, Rail 6 armor-piercing, Melee 13, Charge Rifle 8 |
| reload type | `t19` | Shotgun **2 = Shells**, Melee 10 — everything else 0 |
| charge-up / down sounds | `t28`/`t29` | Rail `C08`, Laser `C11`, Charge Rifle `C15`/`C17` |
| per-weapon reload chains | `t31–33` | 11 distinct chains, not one shared `D04+D03+D02` |
| muzzle flash / quiet | `t25`/`t26` | Suppressor only |
| the weapon's real fire sound | `t27` | e.g. the SMG is `G03`, not the `G10` we had chosen |

The old system wrote `t20 = 0` into everything built on the `ar` sample. That single token is why
the sniper and the shotgun full-autoed on the bench.

### 1.2 The CALLSIGN arsenal, as captured (not what we ship)

What Battle Company actually ships. `htk`/`TTK` computed against the default 115 pool (they move with
the host's health config — §2.5).

| weapon | t20 fire mode | dmg | cycle ms | mag | reserve | reload | heat | htk@115 | TTK s |
|---|---|---|---|---|---|---|---|---|---|
| Assault Rifle | 0 full auto | 9 | 100 | 32 | 384 | 1400 | 0 | 13 | 1.20 |
| Burst Rifle | 9 3-round burst | 9 | 75 +275 burst | 36 | 216 | 1700 | 0 | 13 | 1.70 |
| Force Rifle | 9 3-round burst | 9 | 100 +250 burst | 36 | 144 | 1700 | 0 | 13 | 1.80 |
| Bolt Rifle | 7 single shot | 13 | 225 | 18 | 180 | 2000 | 0 | 9 | 1.80 |
| SMG | 0 full auto | 8 | 90 | 72 | 288 | 2500 | 5 | 15 | 1.26 |
| Shotgun | 7 single shot | 45 | 900 | 6 | 24 | 400 | 0 | 3 | 1.80 |
| Stinger | 0 full auto | 15 | 120 | 18 | 72 | 1700 | 0 | 8 | 0.84 |
| Sniper Rifle | 7 single shot | 80 | 300 | 4 | 24 | 1700 | 0 | 2 | 0.30 |
| Plasma Sniper | 7 single shot | 80 | 225 | 10 | 80 | 2000 | 30 | 2 | 0.23 |
| AMR | 7 single shot | 18 | 360 | 14 | 56 | 1400 | 0 | 7 | 2.16 |
| Suppressor | 0 full auto | 8 | 75 | 48 | 288 | 2000 | 0 | 15 | 1.05 |
| Energy Rifle | 0 full auto | 9 | 90 | 300 | 600 | 2400 | 6 | 13 | 1.08 |
| Charge Rifle | 14 charge, on release | 100 | 1250 | 100 | 200 | 2500 | 14 | 2 | 2.50 |
| Rocket Launcher | 7 single shot | 115 | 1000 | 2 | 8 | 1200 | 0 | 1 | 0.00 |
| Rail Gun | 2 charge, auto-fires | 115 | 1200 | 1 | 6 | 2400 | 0 | 1 | 1.20 |
| Laser Cannon | 3 charge, hold | 115 | 1500 | 4 | 8 | 2000 | 0 | 1 | 1.50 |
| Energy Launcher | 0 full auto | 115 | 360 | 1 | 6 | 1400 | 0 | 1 | 0.00 |
| Ion Sniper | 7 single shot | 115 | 1000 | 2 | 12 | 2000 | 0 | 1 | 0.00 |
| Melee | 13 melee | 90 | 1000 | 1 | 0 | 0 | 0 | 2 | 1.00 |

### SHIPPED (rebalanced on top of those frames)

**Stock Callsign is a low-damage, high-rate design.** Automatics deal 8–15 a hit and fire at
75–120 ms; a kill is 13–15 hits landed in about a second. Five weapons deal exactly **115** — the
default pool — and one-shot a full-health player. The two snipers deal 80 at a 225–300 ms cycle,
which makes them the fastest killers in the game by a wide margin (0.23 s and 0.30 s).

That is a coherent design, but it is not the one we want: TTKs cluster far below a second, and the
one-shot tier has 4–12 kills of ammo. §2 keeps the *feel* — the fire modes, the burst, the heat, the
sounds — and moves the numbers.

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
5. **TTK band 1.20–3.50 s** at the 115 pool for everything that is not a one-shot weapon or a charge
   weapon (the band moved from 1.5 s on 2026-09-17 to admit the AR's native 100 ms cycle; a charge
   weapon is exempt because its setup is not combat time).
6. **No strict dominance WITHIN A FAMILY, and every weapon leads somewhere.** Since 2026-09-17 the
   check runs per family (fire mode plus `weapon_class`) on four axes: ideal TTK, kills per clip,
   one-magazine kill chance at p = 0.7, and sustained DPS. "Total kills from a full kit" is retired,
   because a respawn refills the kit. Checked in a test, not by eye (§2.3).
7. **One-shot weapons are a pickup tier**: 2-round magazine, 4 total kills, and each differentiated
   by charge behaviour rather than by numbers.
8. **`htk` is the design unit, not DPS** — IR hits are discrete and misses are normal.

### 2.2 The table: the OPEN BRX arsenal (what Mission Control pushes)

| weapon | role | dmg | cycle ms | htk | **TTK s** | DPS | sust | mag | reserve | reload | one-mag kill % (p=0.7) | heat | changed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| *Melee* | melee | 90 | 1000 | 2 | **1.00** | 90.0 | 90.0 | 1 | 0 | 0 | 0% | — | **stock** |
| Sniper Rifle | marksman | 60 | 1500 | 2 | **1.50** | 40.0 | 31.2 | 4 | 24 | 1700 | 92% | — | dmg 80→60, cycle 300→1500 |
| Shotgun | cqb | 20 | 700 | 3 | **1.40** | 28.6 | 26.1 | 6 | 24 | 400 | 12% | — | **2026-09-18**: dmg 45→20 (`wire.dmg`, the gun word); OUR chosen 20-damage headset word (`wire.headset_dmg`, t12) stacks unconditionally on top, 40 real per pull. **F276 asked whether two IDENTICAL words survive and the answer is yes** (bench 2026-09-18: five pulls, two `$HIR` of 20 every time, 60-75 ms apart, both registering even when they landed on the same sensor as byte-identical frames), so the 159 ms beacon block does not apply to this pair; the second word itself is measured (Callsign's own 70, cap30), the split is a balance number we picked (htk/TTK unchanged, 2 pulls short, 3 kills either way), but `dmg`/`dps`/`sust`/one-mag % here are the GUN WORD ALONE, not the real per-pull total. Magazine deliberately left at 6/24. **2026-09-23** (R8, F308): pump gap (t14, `wire.fire_ms`) tightened 800→700ms, the slowest of Tony's sweep {800,750,700,650,600} that gets the Shotgun to beat a full-auto SMG at close range most of the time — see the Balance rules table. That also took the Shotgun's TTK past the Sniper Rifle's, so `test_ttk_band_and_no_strictly_dominant_weapon` now also names `(shotgun, sniper_rifle)` in `KNOWN_DOMINANCE`, beside the now-empty `(amr, shotgun)` history. The suite is GREEN, not red, and the exemption fails the moment the pair stops dominating; §7 |
| Plasma Sniper | marksman | 25 | 400 | 4 | **1.20** | 62.5 | 41.7 | 10 | 80 | 2000 | 95% | 30 | dmg 80→25, cycle 225→400; **2026-09-18**: htk 5→4, TTK 1.60→1.20s (our chosen 10-damage headset word, `wire.headset_dmg`/t12, stacks unconditionally, 35 real per pull; ⚠️ this weapon has NEVER been captured -- cap30 fired only a Shotgun -- so its second word rests on a sourced t12=80 and nothing else); `dmg`/`dps`/`sust`/one-mag % here are the gun word alone, same caveat as the Shotgun; §7 |
| AMR | support | 21 | 400 | 6 | **2.00** | 52.5 | 42.0 | 14 | 56 | 1400 | 99% | — | dmg 18→24, cycle 360→400; **2026-09-18** (F62): dmg 24→21, htk 5→6, TTK 1.60→2.00s — 30% `crit_pct` (a crit is x1.5 truncated, so 21→31) pays for itself: average damage per hit holds at 24.15, but the published number is now the GUARANTEED five-hit-plus kill, six hits when unlucky. Mag/reserve untouched |
| Force Rifle | assault | 10 | 100 +250 | 12 | **1.65** | 66.7 | 50.7 | 36 | 144 | 1700 | 100% | — | dmg 9→10 |
| Burst Rifle | assault | 10 | 75 +540 | 12 | **2.53** | 43.5 | 36.1 | 36 | 216 | 1700 | 100% | — | **2026-09-17**: dmg 9→11 (`wire.dmg`); **2026-09-18** (F62): dmg 11→10, htk 11→12, TTK 1.42→1.56s — 40% `crit_pct` (a crit is x1.5 truncated, so 10→15) pays for itself: average damage per hit holds at 11.25, but the published number is now the guaranteed 4-pull kill; a 3-pull kill lands about 27% of the time. **2026-09-23** (R6, F308): burst gap (t23, `overrides.t23`) widened 275→410ms so a disciplined AR burst beats it most of the time. **2026-09-23, polish round 1** (F308): modelling the crit reopened R6 at 410ms, so the gap widened again, 410→550ms — see the Balance rules table §7.5d; htk unchanged, only cycle/TTK moved. **2026-09-24, polish round 2** (F308, "full auto point blank ... too harsh"): the gap eased 550→540ms alongside the AR's own `heavy` easing (see the AR row below); htk still unchanged. Mag/reserve untouched |
| Stinger | cqb | 15 | 250 | 8 | **1.75** | 60.0 | 43.5 | 18 | 144 | 1700 | 99% | — | cycle 120→250, res 72→144 |
| Bolt Rifle | assault | 13 | 225 | 9 | **1.80** | 57.8 | 38.7 | 18 | 180 | 2000 | 98% | — | **stock** |
| SMG | cqb | 7 | 100 | 13 | **1.20** | 70.0 | 47.8 | 54 | 216 | 2500 | 100% | 5 | **2026-09-20 playtest**: a covered gun emitter produced no headset hit because captured t12 was empty. Open BRX now deliberately adds a headset word at the known-good carrier 100; cycle 95→100 and mag/reserve 72/288→54/216 keep the added word priced and preserve the Suppressor's magazine lead. **2026-09-23** (R5, F308): the split moved 8+1→7+2 (close range still 9); `dmg`/`dps`/`sust`/one-mag % here are the GUN WORD ALONE (7), same caveat as the Shotgun |
| Toxin Rifle | assault | 8 | 110 | 15 | **1.54** | 72.7 | 49.0 | 30 | 180 | 1600 | 99% | 5 | **2026-09-18**, in the picker since 2026-09-19: the gun lands the direct hit and the POISON is a tick clock on the victim's node (S16, `spec/node.md` §3.17). 4 damage a second for 5 s, refreshed on each hit, never stacked: worth 20, so twelve hits make it lethal even if the target breaks contact, and twelve hits take 1.21 s -- close to the Assault Rifle's own 1.20 s (§7.5's own pair). §7.5 |
| Suppressor | support | 8 | 140 | 15 | **1.96** | 57.1 | 48.0 | 75 | 384 | 2000 | 100% | — | **2026-09-17**: cycle 160→140 (`wire.fire_ms`); mag 48→75 (§2.3, family-scoped dominance) |
| Assault Rifle | assault | 9 | 100 | 13 | **1.20** | 90.0 | 62.6 | 32 | 192 | 1400 | 100% | — | **2026-09-17**: cycle 140→100 (`wire.fire_ms`, native Battle Company speed) |
| Energy Rifle | support | 9 | 150 | 13 | **1.80** | 60.0 | 57.0 | 300 | 600 | 2400 | 100% | 6 | **2026-09-17**: cycle 200→150 (`wire.fire_ms`); overheat switched ON (F229: `t38`=150 override, `t35`=D11) |
| Charge Rifle | support | 70 | 1250 | 4 | **0.85** | 56.0 | 37.3 | 40 | 80 | 2500 | 92% | 14 | **2026-09-17**: dmg 87→85 (`wire.dmg`, the CHARGE damage; tap damage `t37`=20 unchanged), mag/res 12/12→40/80, `rounds_per_charge`=10 (F225/F226/S43); `htk`/`ttk s` now count 1 charge + 2 taps (release-to-kill), not `ceil(pool/85)`. **2026-09-18 bench**: the tap cadence is **285 ms**, measured, not the 500 ms placeholder, so release-to-kill falls 1.00 s → **0.57 s**. The charge costing exactly 10 rounds, the 85 charge and the 20 tap were all confirmed on the wire in the same run. **2026-09-23 (F280)**: charge damage 85→70 (`wire.dmg`), which pushes the kill to 1 charge + 3 taps and TTK 0.57→0.85 s. **2026-09-23 (F291, later the same day)**: the recoil duel sim's rule 2 (an AR catching an uncharged CR should win) failed. First tried moving the tap CADENCE 285→350 ms — reverted the same day: that constant is the player's own physical pull rate, no `$WEAP` field carries it and the gun neither reads nor enforces it, so it changed nothing the gun does. Fixed on the wire instead: tap damage 20→**16** (`wire.tap_dmg`, t37, independent of the charge magnitude on t5, bench-proven 2026-09-17). 16 still closes the pool in exactly three taps (3×16=48 ≥ the 45 left after the charge), so `htk`/`ttk s` at the 115 pool are unchanged from the pre-F291 row. `DPS` and `sust` count CHARGES only (70 / 1.25 s, and 4 charges a magazine against `4 × 1.25 + reload`); the tap is a second cadence and no single figure covers both, so `ttk s` is the column that reads the mixed kill |
| Rocket Launcher | power | 115 | 1000 | 1 | **0.00** | 115.0 | 50.0 | 2 | 2 | 2600 | 91% | — | res 8→2, reload 1200→2600 |
| Energy Launcher | power | 115 | 1600 | 1 | **0.00** | 71.9 | 50.0 | 2 | 2 | 1400 | 91% | — | cycle 360→1600, mag 1→2, res 6→2 |
| Ion Sniper | power | 115 | 1400 | 1 | **0.00** | 82.1 | 47.9 | 2 | 2 | 2000 | 91% | — | cycle 1000→1400, res 12→2 |
| Rail Gun | power | 149 | 1200 | 1 | **1.20** | 124.2 | 62.1 | 2 | 2 | 2400 | 91% | — | mag 1→2, res 6→2 |
| Laser Cannon | power | 115 | 1500 | 1 | **1.50** | 76.7 | 50.0 | 2 | 2 | 1600 | 91% | — | mag 4→2, res 8→2, reload 2000→1600 |
| Desert Eagle | sidearm | 26 | 700 | 5 | **2.80** | 37.1 | 25.6 | 7 | 48 | 2200 | 65% | — | **D2 2026-09-12** (Bolt Rifle frame). **2026-09-23** (R10, F308): cadence 480→700ms, the real-world lever (.50 AE recoil) Tony chose over touching the magazine — a finishing weapon, not a rifle-competitive one; see the Balance rules table row 10 |
| USP-S | sidearm | 9 | 160 | 13 | **1.92** | 56.2 | 26.2 | 12 | 120 | 2200 | 0% | — | **D2 2026-09-12** (Bolt Rifle frame, suppressed); **2026-09-17**: mag 20→19 (§2.3, family-scoped dominance). **2026-09-23** (R10, F308): mag 19→12, the real-world lever (a USP .45 holds 12) — its own 13-hit kill no longer fits one magazine on purpose, `test_shipped_roster_satisfies_the_mag_invariant_at_the_default_pool`'s narrow, named exemption; see the Balance rules table row 10 |
| Glock-18 | sidearm | 13 | 240 | 9 | **1.92** | 54.2 | 34.4 | 16 | 64 | 2200 | 93% | — | **D2 2026-09-12** (Bolt Rifle frame) |

**"One-mag kill %"** (2026-09-17, replaces the old "mag/total kills" column) is `P(at least htk hits in
mag shots)` at a stated field accuracy `p=0.7`, binomial exact — the same formula the sidearm proposal
used (`docs/reference/ttk-model.md` §Sidearm proposal). Reserve ammo is no longer a balance axis: a
respawn refills the whole kit, so how many kills a full kit could theoretically produce said nothing
about any single life. The Charge Rifle's `mag`/`reserve` are ROUNDS of its 10-round cell
(`rounds_per_charge`), so its one-mag figure is computed on 4 charges (`40 / 10`), not 40 hits.

Two weapons ship **exactly as Battle Company sent them** (`verified: true`): the Bolt Rifle and Melee.
Both are hidden from the picker. The Burst Rifle shipped stock until its 2026-09-17 retune.

**Role identities**

- **Assault Rifle** — the anchor, and the one weapon players arrive already attached to. **2026-09-17
  arsenal review: back to Battle Company's native 100 ms cycle** (`wire.fire_ms`), reversing the
  2026-08-30 retune to 140 ms; damage untouched at the captured 9. Tony's call, made with the
  historical dominance finding on the table (below): at 140/192 the AR dominated nothing under the old
  three-axis check; at native 100/192 it strictly dominates several other picker weapons under BOTH
  the old axes and the new one-magazine-kill-chance axis (§2.3) — the accuracy/stance/flinch system
  (S42, node-driven, not the native spray decay F230 showed is not usable) is the intended real-world
  equaliser, not this static check. Under the family-scoped rule that shipped the same day (§2.3) the
  test is GREEN: the AR leads its family on time to kill and sustained DPS, and the SMG and Suppressor
  lead on kills per clip. ⚠️ **That is a paper lead, not a felt one.** Until stance and recoil ship,
  a player who picks on feel has no reason to take anything else in this family, so the AR's cost is
  owed and unpaid.
- **Burst Rifle**: damage 10 (`wire.dmg`), 12 hits, a real three-round burst: 75 ms inside the burst,
  then a 540 ms gap between bursts (R6/R7, row 11 below, §7.5d), for a 2.53 s TTK. It carries a 40%
  `crit_pct`. The "changed" column holds its history. No longer ships byte-for-byte (`verified: false`).
- **Force Rifle**: hidden since the 2026-09-17 cuts, and kept for custom games, not retuned. Both burst
  weapons now land 10 damage and 12 hits, and the Force Rifle's shorter burst gap makes it the faster of
  the pair (1.65 s against 2.53 s), with a smaller reserve and a slower five-part reload.
- **Bolt Rifle** — stock. Single shot, 9 hits, 22 kills.
- **SMG**: **2026-09-20 playtest: the headset now emits a priced second word** (7 + 2 since R5, 2026-09-23;
  the history below is the first 8 + 1 pass). Covering
  the gun emitter produced no hit because the captured SMG frame had an empty t12; the Shotgun control
  did produce one. The second word uses carrier 100, which is known to pass the receiver, while the gun
  keeps its outdoor 30 carrier. To keep the combined 9-damage pull inside the balance band and preserve
  the Suppressor's magazine lead, cycle 95 → 100 ms and mag/reserve 72/288 → 54/216. Its heat value
  (`t24 = 5`) remains inert: overheat requires t37/t38, which only the Charge Rifle and the Energy Rifle
  (its `t38` override) carry.
- **Shotgun**: three hits, six shells, a **400 ms Shells-type reload**. Since 2026-09-18 each hit is a
  20-damage gun word plus our 20-damage headset word (was 45 on the gun alone), so its sustained output
  (26.1) is now among the lowest; its identity is the three-hit kill up close, not throughput.
- **Stinger** — full auto, eight hits, 20 kills. Reserve doubled so it is not simply the SMG's worse
  sibling.
- **Sniper Rifle** — the only two-hit weapon outside the power tier, on a 1.5 s cycle. Unchanged in the
  2026-09-17 pass.
- **Plasma Sniper** — a marksman rifle that fires like a carbine and **overheats** (`t24 = 30`).
  Damage dropped hard (80 → 25) precisely so its cycle could stay fast enough for the heat mechanic
  to matter.
- **AMR**: semi-automatic (`t20 = 7`), 21 a hit and 6 hits, a 14-round magazine and a 30% `crit_pct`
  (F62, 2026-09-18).
- **Suppressor** — **2026-09-17: cycle 160 → 140 ms** (`wire.fire_ms`); quiet, no muzzle flash, the
  deepest total pool, the slowest kill. **Mag 48 → 75** (a second 2026-09-17 change, §2.3): the
  family-scoped dominance test pairs it against the SMG (same fire mode, same `weapon_class`), which
  beat it on ideal TTK and sustained DPS; the deeper magazine gives Suppressor an outright lead on
  kills per clip (5 vs the SMG's 4) — the smallest number change that stops the SMG dominating it.
- **Energy Rifle** — **2026-09-17 (F229): cycle 200 → 150 ms** (`wire.fire_ms`), and overheat switched
  ON — `wire` cannot address `t38` directly, so it ships as an `overrides` entry: `t38 = 150` (the
  bench-proven "on" value) and `t35 = D11` (the SMG's captured overheat sound, ear-confirmed on a real
  overheat). Full auto locks it out near heat 99 after about 30 shots; unlike the Charge Rifle it does
  not cool on its own, and only the reload lever (a **hold**, not a tap) clears the lockout — the same
  hold that refills the 300-round cell. 23 kills on one magazine, 69 across the kit still hold; only
  the cycle moved.
- **Charge Rifle** — **2026-09-17 (F225/F226/S43): the balance-breaking bug and the ambush design.**
  `<8,0>` used to key `$SIR` function 38, which HALVES every hit (a 100-magnitude charge landed 50);
  re-keyed to function 1 (plain damage) in `gameconfig._SIR_TABLE`, and `_SIR_PLAIN_DAMAGE` no longer
  allow-lists 38 so nothing can key to it by accident again (`compile.py`). Damage is two
  independent numbers: `t5` (charge) `70` via `wire.dmg` and `t37` (tap) `16` via `wire.tap_dmg` (first
  shipped at 85 and 20; the "changed" column holds the steps). A full charge costs 10 rounds of the cell and +56 heat; a tap costs 1 round and +14 heat;
  the lockout sits at about heat 103 for about 4.8 s. The new catalogue field `rounds_per_charge: 10`
  says so explicitly, and every place that used to read `mag`/`reserve` as hit counts (the one-magazine
  guard, the dominance table's kill-chance axis) now divides by it first. The design point (S43,
  Tony): nobody lands a second charge in a 1v1, so the intended kill is **one charge plus three taps**
  (70 + 16 + 16 + 16 = 118 ≥ 115), 13 rounds and 98 heat, under the lockout. Cell size raised
  100/200 → **40/80** rounds (4 charges up, 8 back) from the old 12/12 the first pass shipped, cutting
  the previous single-most-dominant weapon in the arsenal down to a magazine that holds one real kill
  combo with one charge spare.

  **2026-09-17, second pass: the model now counts the real combo.** `hits_to_kill()` used to publish
  `ceil(pool/charge)`, silently pretending every hit is a full charge; it now counts 1 charge plus
  however many taps close the rest of the pool: **`htk` = 4, `ttk_ms` = 855** at the 115 pool. TTK is
  deliberately RELEASE-to-kill, not charge-to-kill: the charge is pre-built behind cover, so the ~3.5 s
  (by feel; `t14` itself reads 1250 ms, a separate and still-unreconciled number) it takes to build is
  SETUP, not combat time — that pre-charge is the weapon's whole identity (S43). The two taps that
  follow cost `WeaponCatalog.CHARGE_TAP_CADENCE_MS` (285 ms) each. `rounds_to_kill()` is the ROUNDS
  version of the same combo (13: `rounds_per_charge` + 1 round per tap) for anything that must compare against a raw
  `mag`/`reserve` count — the one-magazine guard and kills-per-clip both use it, never `hits_to_kill()`
  directly. The SUSTAINED-DPS and one-magazine-kill-chance axes (§2.3) still model the weapon as
  repeated full charges (a charge is near-certain once released; no per-action accuracy model exists to
  mix that with a tap's p=0.7 trigger pull), so they keep the simpler `ceil(pool/70) = 2`, a different
  question ("how hard can this sustain fire") from "what does the one pre-built kill cost".
- **Sidearms (2026-09-04, rebalanced D2 2026-09-12)** — Glock-18, USP-S, Desert Eagle: slot-2 backups
  built on the Bolt Rifle's captured frame (the one captured semi-automatic: `t20 = 7`, one shot per
  trigger pull, magazine reload). Tony, 2026-09-11: "the sidearms should not kill fast, they should
  kill slower than rifles"; "rate of fire on the pistol usp should be quicker to match counter strike.
  less damage but faster rof." The original pass (2026-09-04) copied the Counter-Strike identity
  literally — Glock fastest+weakest, USP in the middle — but that left the Deagle and USP both
  killing faster than every rifle (docs/archive/game-test-2026-09-11.md D2). The 2026-09-12 pass instead gives
  all three the SAME **1.92 s** ideal TTK, strictly slower than the slowest rifle (Bolt Rifle, 1.80 s),
  and reverses the Glock/USP identities to match Tony's brief directly: the **USP-S is now the
  fastest trigger and the weakest hit** (9 dmg / 160 ms / 13 hits), suppressed and flashless
  (`t25 = 2`, `t26 = 50`, the Suppressor's pair); the **Glock-18 sits in the middle** (13 dmg / 240 ms
  / 9 hits); the **Desert Eagle still hits hardest on the slowest cycle** (26 dmg / 480 ms / 5 hits).
  ⚠ **2026-09-17: USP mag 20 → 19 (glock/deagle unchanged).** Only USP and Deagle are visible today
  (Glock is `hidden`), and only they are checked against each other (§2.3's `sidearm` family). Retiring
  "total kills from a kit" as a dominance axis (§2.3) removed the exact lever the paragraph above
  relied on — with it gone, **USP strictly dominated Deagle** (equal ideal TTK, higher sustained DPS,
  higher one-magazine kill chance). Tony's ask was mag 20 → 14; at 14 the sustained-DPS and
  one-magazine-kill-chance axes both fall so far (a small magazine spends proportionally more of its
  time reloading) that **Deagle ends up dominating USP instead** — a straight reversal, not a fix. 19
  is the smallest cut off 20 that actually leaves neither pistol beating the other (USP still leads on
  one-magazine kill chance, 67% vs 65%; Deagle leads on sustained DPS, 32.7 vs 32.6 dmg/s) — a thin
  margin the next retune should treat as fragile, not settled.

  ⚠ **2026-09-23 (R10, F308): the next retune, and it moved both pistols, not just the fragile margin
  above.** Tony: "the sidearms should be finish-a-kill weapons, not competitive against rifles" — and
  rejected an unrealistic magazine cut ("no pistol clip is that small") for real-world levers instead.
  **USP mag 19 → 12** (a USP .45 holds 12): its 13-hit kill no longer fits one magazine at all, on
  purpose (a named, self-expiring exemption in `test_shipped_roster_satisfies_the_mag_invariant_at_
  the_default_pool`), so the fragile one-mag-kill-chance lead above is gone — 0% now, not 67%. **Deagle
  cadence 480 → 700ms** (`.50 AE` recoil, magazine left at 7): sustained DPS falls from 32.7 to 25.6,
  ideal TTK from 1.92s to 2.80s. Both still clear neither dominates the other
  (`test_ttk_band_and_no_strictly_dominant_weapon` stays green with no new sidearm-family exemption),
  because both weapons got weaker together. See the Balance rules table row 10 for the two new duel
  checks this adds: each pistol still finishes a 35-HP target in under a second, and every modelled
  primary rifle now beats each pistol from full health at least 65% of the time.

  Nothing dominates: with all three tied on ideal TTK, sustained DPS and total-kills rank in the SAME
  order (Glock highest sustain, USP middle, Deagle lowest) while reserve ammo runs the other way
  (Deagle 11 kills a kit, USP 10, Glock 8), so no sidearm beats another on every axis at once — see
  `docs/reference/ttk-model.md` §Shipped for the full 3×3 table and the accuracy-adjusted numbers
  (historical: this was the ORIGINAL 2026-09-12 reasoning, superseded for USP/Deagle by the paragraph
  above once the dominance axes changed).
  All three still sit inside the 1.5–3.5 s band and **are deliberately dominated by the primaries**
  (a sidearm has roughly two-thirds of a primary's sustained output) — primaries and sidearms are
  different families (§2.3) and are never compared for strict dominance either way; this is a design
  intent, not a mechanically-checked one. `test_ttk_band_and_no_strictly_dominant_weapon`
  still forbids one sidearm dominating another (`_weapon_family()`'s `sidearm` bucket). In a pistol
  round (`loadout_policy.primary.kinds = ["sidearm"]`) they only meet each other. Fire sounds `P16`
  (Glock) / `Q04` (USP) / `X14` (Deagle) and the `D08 D07 D06`
  reload run are on-gun ids no other weapon uses (ear-confirmed 2026-09-11, `docs/reference/sound-catalog.md`),
  so a custom `.LTP` copied over the data port replaces only that pistol's sound.
  Draw time `wire.swap_ms = 500` (tok15; the primaries keep the captured 850) — bench 2026-09-04
  proved tok15 is the swap delay AND that the gun applies the larger of the two slots, so a pistol
  only draws in 500 ms beside another quick weapon (a perk is its own slot since A14 and never
  occupies slot 1). The cycle numbers are the gun's floor: a semi-automatic fires no faster than the
  player pulls, so in hand every pistol kills slower than its wire TTK.
- **Power tier** — Rocket, Rail, Laser, Energy Launcher, Ion Sniper. 115 damage (the Rocket adds a 35 headset word, the
  Rail Gun does 149: Balance rules row 7), all one-shot on Standard,
  all **2 + 2 rounds = 4 kills**, differentiated by charge behaviour and a deliberate cycle/reload
  ladder (see §2.4).

### 2.3 Dominance, families, and the lead rule

Checked mechanically in `test_ttk_band_and_no_strictly_dominant_weapon`
(`mcp/tests/test_mc_compile.py`), rewritten 2026-09-17 after the Assault Rifle's return to its native
100 ms cycle reintroduced the exact cross-weapon dominance the 2026-08-30 retune existed to avoid — a
global three-axis check could no longer hold both "AR at native speed" and "nothing strictly beats
anything" at once, and re-throttling the AR again was explicitly off the table this time.

**1. The band.** Every non-one-shot, non-cell weapon lands between **1.20 s and 3.50 s** ideal TTK —
the band, not the old 1.50–3.50 s. The floor moved 2026-09-17 to admit the Assault Rifle's native
1.20 s rather than throttle the weapon again. A CELL weapon (`rounds_per_charge` > 1 with a tap
magnitude — today, only the Charge Rifle) is exempt the same way a one-shot weapon already is: its
`ttk_ms` is RELEASE-to-kill (§2.2), and the pre-built charge that makes that number small is exactly
its identity, not sustained-fire combat time the band is measuring.

**2. Dominance runs WITHIN A FAMILY, not globally.** Family = the `$WEAP` fire mode (`t20`) plus
`weapon_class`, except a sidearm, which is its own family regardless of mode or class (`_weapon_family()`
— a slot-2 backup was never meant to compete with a primary, so the old bespoke "primary beats sidearm"
exemption falls out of this for free: a primary and a sidearm are never in the same family to begin
with). This groups the roster into automatics split by ballistic/energy (`{assault_rifle, smg,
suppressor}`, `{energy_rifle}` alone), bursts (`{burst_rifle}` alone), semi-autos (`{shotgun,
sniper_rifle, amr}`), the Charge Rifle's own charge-mode family (alone), and the sidearms
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
(F135, F231, §5, U2). Both are declared now specifically
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
| Sniper Rifle | 2 | **2** | 3 | 4 |
| Shotgun | 3 | **3** | 4 | 5 |
| Plasma Sniper | 3 | **4** | 5 | 6 |
| AMR | 5 | **6** | 8 | 10 |
| Burst Rifle | 10 | **12** | 15 | 20 |
| Stinger | 7 | **8** | 10 | 14 |
| Bolt Rifle | 8 | **9** | 12 | 16 |
| Force Rifle | 10 | **12** | 15 | 20 |
| Assault Rifle / Energy Rifle | 12 | **13** | 17 | 23 |
| SMG | 12 | **13** | 17 | 23 |
| Suppressor | 13 | **15** | 19 | 25 |
| Toxin Rifle | 13 | **15** | 19 | 25 |
| Desert Eagle | 4 | **5** | 6 | 8 |
| USP-S | 12 | **13** | 17 | 23 |
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

### 3.3 – 3.4 Two retracted sound rules (provenance in git history)

The first pass (2026-08-26, first revision) derived a "duration ÷ cadence ceiling" for fire sounds and a
"three reload parts play in sequence inside `reload_ms`" budget. Both are void: the AR plays a 1.76 s sample at
a 100 ms cadence (the firmware truncates and retriggers by design), and six stock frames "overrun" the reload
model (the Shotgun's 0.82 s chain inside a 400 ms `Shells` reload). Sample duration constrains only weapons slow
enough to play a sample out; the chains ship unmodified; reload-chain timing is an open bench question (§5, U4).
The retracted text: `git log -- docs/weapon-design.md` before 2026-09-06.

### 3.5 What the bank still tells us

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

*Status: **PROVEN 2026-08-26** — one-field bench flip (sniper t20 7→0 single→auto; captured Burst Rifle = true 3-round bursts). See §5 U1.*

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
| SMG | 30 | close | **Real guess**, sits at the shelf edge. This is the gun word's carrier; the headset word (2 damage since 2026-09-23, R5) uses the known-good 100 carrier so it actually emits reliably |
| Shotgun | 30 | close | **Moved onto the flat shelf 2026-09-18, then corrected 2026-09-23** (Tony, R4/R5): 100 (full distance) let the gun word out-reach the game it is played at; set to match the SMG's own 30 so the two close-range weapons share one outdoor reach. See §7's dual-emitter write-up: the Shotgun's real close/far shape lives in `wire.headset_dmg`'s reach (`t13`/`t42`), which stays at 100 — the headset word's own real range is unmeasured, F275 |
| Rocket Launcher | 22 | close | **Real guess.** A pickup-only one-shot heavy is meant to be earned at close range, not to out-reach the arsenal it out-damages (Tony, 2026-09-17). Same transition-band caveat as the Shotgun used to carry |
| Rail Gun | 22 | close | Same reasoning and caveat as the Rocket Launcher |

Every value from 55 up sits on the flat shelf the garden test found (roughly 31 to 100): they are
expected to behave alike until the shelf itself is mapped, so the ranking above the shelf is a design
intent, not yet a measured difference. **Only the SMG, Rocket Launcher and Rail Gun values are real
guesses** sitting at or inside the 13-26 transition band, where the method could not separate values
cleanly (F232's first-two-shots effect and the 8-shot groups); they are pending **S49**, the portable
IR receiver, which lets one person map the transition band properly (several fixed receivers at once,
full mags, first two shots discarded, dome shaded). The Shotgun moved off that band 2026-09-18; its own
open range question is now `t13`/`t42` (F275), not `t2`.

⚠️ **The 2026-09-18 carrier-frequency reading puts the whole table in question, and the call is
Tony's: [ir-effects §6.5](ir-effects-design.md) converts every row above into kHz and works through it.** In short, the seven weapons
at 55 and up all sit inside the receiver's pass-band and probably play alike, and the six at 30 and
22 sit on the knee, where the effect is not "shorter range" but "the receiver drops words". Keep the
numbers until S49 measures the receiver's response curve; do not read this table as a calibrated
metre ladder.

A weapon with no `wire.range_outdoor_pct` (every hidden/cut weapon, the sidearms, melee) keeps its
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

| # | unknown | blocks | how to settle |
|---|---|---|---|
| **U2** | ~~`t41` range~~ **CORRECTED 2026-09-17: `t41` is a null outdoors** (garden test, 27/27 hits at t41=5 vs 55/57 at t41=75, every paced distance). **The token that does move hits is `t2` (`gunRangeOutdoor`, F231/F234), now §4.2's shipped table.** ⚠️ **2026-09-18: `t2` sets the emitter's CARRIER FREQUENCY, not its power** (V4_31 disassembly; `protocol/brx-protocol.md`). A low value detunes the word out of the receiver's band-pass instead of shortening the beam, so the shelf is the pass-band. Still open, and now harder: whether `t2` can fence a weapon to a chosen distance above its shelf (~31-100), and every indoor value (F231). | the range axis (outdoor, closed; indoor, open) | Indoor: run the same ladder indoors, dome shaded. Above the shelf: **S49**'s portable IR receiver, several fixed receivers at once, full mags, first two shots discarded. |
| **U1** | ~~`t20` confirmation~~ ✅ **CLOSED 2026-08-26: PROVEN by one-field flip** — sniper t20 7→0 went single-shot→full-auto on the bench; captured Burst Rifle fired true 3-round bursts (exp-log). | — | done |
| **U4** | **How the 3-part reload chain relates to `reload_ms`.** Six stock frames "overrun" a sequential model, so the model is wrong. | any future reload-sound work | One weapon, one long chain, one stopwatch. Also answers whether `t19` changes it. |
| **U5** | **Does a held trigger retrigger the fire sample from zero, or ring under the next shot?** Decides whether sample duration constrains anything at all. | custom weapon sound design | Fire the AR (1.76 s sample, 190 ms cycle) and listen. |
| **U6** | ~~victim behaviour per damage type~~ — **CLOSED 2026-08-26, then PARTLY REOPENED by the IR work ([ir-effects §6.2](ir-effects-design.md)).** The hit-SFX half stands. The conclusion *"presentation only; damage is always t5"* does **not**: `t3`/`t4` are the `$SIR` composite key, and the table MC pushes maps two of the three subtypes in use to **multiplier** functions. Damage is `t5 × the row's multiplier`. The earlier test was sound — every row it exercised happened to be a standard-damage row. | §2's balance table ([ir-effects §6.2](ir-effects-design.md)) | done — the multiplier values were confirmed 2026-09-02 (U10). |
| **U10** | ~~REOPENED 2026-08-27 — what switches the fn 36/37 multipliers on?~~ ✅ **CLOSED 2026-09-02, fully explained 2026-09-11 (F23): the multipliers are REAL but HEADSET-only and t7-scaled. fn 36 = floor(magnitude × (1 + t7/200)), fn 37 = floor(magnitude × (1 + 2·t7/100)); at t7=50, which was the default until the 2026-09-17 arsenal review set the compiled `crit_modifier` to **0**, so the multipliers are OFF today ([ir-effects §6.2](ir-effects-design.md)) that is ×1.25 / ×2.** 16 trials across magnitudes 20/40/9/7 and 8 `$SIR` row-tail shapes, with an fn 1 control on subtype 0 in every trial. The ×1.25 **truncates** (7 × 1.25 = 8.75 → **8**). Row tails do not gate it. *Reconciled:* the 2026-08-27 matrix that read ×1.0 in all 24 cells was rig-pinned to the GUN BODY (always ×1); the ×1.25/×2 runs measured the HEADSET. Both were correct — different sensors. See §6.2. | §2's balance — the five multiplied weapons are real and [ir-effects §6.2](ir-effects-design.md)'s retune/flatten decision is live | done |
| **U11′** | **Which status function, if any, is a real STUN? — CLOSED 2026-09-18.** fn 23 is not a classic stun (it deals no damage and the gun keeps firing), but it is a real, shippable effect: it drives the victim's LIVE ACCURACY to 0 in the same millisecond as the `$HIR`, no pool moves, every shot the victim fires misses, and it recovers on its own over a few seconds ([ir-effects §6.3e](ir-effects-design.md), "Smoke"). What changed the answer: the 2026-09-18 bench measured it against `$SIR,8,0,,23`, the same cell A20's host-driven stun uses, and found the accuracy-zero effect alone is enough to take a player out of a fight — no second mechanism needed. `config.stun` ships fn 23 for exactly this reason (F253, [ir-effects §6.3e](ir-effects-design.md)). Category 10 "Stun" (a `$SIR` function that disarms or drops HP directly) is still unbuilt; fn 23 is the primitive we ship instead. | stun weapons | none — see [ir-effects §6.3e](ir-effects-design.md) |
| **U7** | ~~Damage ceiling in the IR payload~~ ✅ **CLOSED 2026-08-26** — read straight off the wire on our own VS1838B: the field is **8 bits (max 255)** and the rocket's 115 decoded exactly. A 2× powerup is expressible on anything up to 127. | future powerups | **Now directly readable** — the `D8` field on a VS1838B capture (bench-plan Session 1½b). |
| **U8** | **`t17` vs `t40`.** Every captured frame obeys `t17 == 2 × t40` and we preserve it, but *why* is unknown — is `t40` a per-magazine count and `t17` a total? | nothing today; would matter for a resupply powerup | Set them independently and watch `$ALCD`. |
| **U9** | ~~reserve via $AMMO on re-push~~ ✅ **CLOSED 2026-08-26**: a bare $WEAP re-push resets mag/reserve to the frame's baked-in values — pickups MUST re-send $AMMO (exp-log). | — | done |

**Closed since the first pass:** U0 (fire-mode token → `t20`, §4.1) · U3 (`t19` reload type →
captured, `Shells` on the shotgun) · the burst-token hunt (native burst is `t20 = 9` + `t23`) ·
`t3`/`t4` (captured, no longer guessed — and now known to be the `$SIR` key, **[ir-effects §6](ir-effects-design.md)**, not just a
damage-type label).

---

## 6. The `$SIR` layer: moved to its own page

The `$SIR` layer, the IR-effects study and the archetypes the catalogue does not have yet now live in
[`ir-effects-design.md`](ir-effects-design.md). Its section numbers are unchanged (§6.1 to §6.5), so a
citation such as "§6.2" means that page. The short version, which the rest of this page relies on:

- **A weapon's `t5` is a magnitude, not damage.** The victim's `$SIR` row for the key `<t3,t4>` decides what
  lands: plain damage, armour-piercing damage, a heal, an armour or shield grant, or a status effect that
  moves no pool. Damage is a property of the weapon and the table together, and `Compiler.validate()`
  checks every loadout weapon against the table MC is about to push.
- **The damage formula.** A gun-body hit lands `t5 × 1`. A headset hit lands
  `t5 × headset_multiplier(fn, t7)`, and only fn 36 and fn 37 scale. MC compiles `t7 = 0` (Balance rules
  row 8), so every function lands ×1 on both sensors today. Pools drain shields, then armour, then HP; an
  armour-piercing row goes straight to HP.
- **Two shipped rows were live bugs, and both are fn 1 now:** `<8,0>` (the Charge Rifle, F225) and `<9,3>`
  (the Energy Launcher, fixed on the bench 2026-09-18). Never ship fn 24-27 on a cell a weapon can reach:
  they deal no damage and leave the victim's gun making a phantom `$HIR` every 5.07 s until the next
  `$SPAWN` (P18, `protocol/brx-protocol.md` §5).
- **The range tokens set the IR carrier frequency, not the emitter power** (§6.5 there). Of the
  §4.2 ladder, eight weapons sit inside the receiver's pass-band and six sit on its knee.

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

⚠️ Those are CALLSIGN's captured values, not ours. We ship the Shotgun at 20 + 20 (40 a pull, three
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
mirror Callsign's own 45/70 split: it ships `wire.dmg` 20 and `wire.headset_dmg` 20 (40 together when
both words land, a 3-pull kill at the weapon's own 700 ms pump gap, so no other weapon on the ladder
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
straight to health through untouched armour). So **Armour Piercing must never carry a crit chance**: the
0.4-to-0.33 price assumes every hit lands for the same cut amount. And a crit weapon must never be the
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

That is also what makes it the natural counter to the Haze and to any player who disengages: it is the
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

- **Range** (`--no-range`, `--venue`). Each fight draws close, mid or long from the venue. A table
  (`BAND_FIT`) scales the hit chance by the weapon's `range_band` and that distance. Each band has
  the best hit chance at its own distance: a close weapon gains 30% up close, and a long gun loses
  20% there. The first version only penalised a weapon beyond its band, so a close weapon could never
  gain in the venue built for it.
- **Tactical reload** (`--no-tactical-reload`). A player below half a magazine reloads between
  fights. A long reload then costs less.
- **Focus fire and line of sight** (`--contact-mean-s`, `--gap-mean-s`). These are the §7.5b numbers
  again. Short peeks (1 s) lift the weapons with a big first hit: the Charge Rifle goes from 1.37 to
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
full auto) and the Shotgun (20+20=40/pull) each beat a bursting AR and the Burst Rifle. **(R5)** past
headset range: a bursting AR beats the Shotgun, and the SMG — the SMG's own split moved 8+1 to 7+2
(close-range total unchanged at 9) so the gun word alone drops to 7, which first read only ~62% at 8.
**(R6)** a bursting AR beats the Burst Rifle. **(R7)** the Burst Rifle beats a full-auto AR — R6 and R7
first shared the Burst Rifle's own numbers as their only lever, pulled in OPPOSITE directions; the
Assault Rifle's own `after_heavy` tightening 8 → 7 (row 3) gave R7 a lever that never touches R6's
controlled-burst AR (it never reaches round 7). **(R8)** close range: the Shotgun beats the SMG on full
auto (row 6's 700 ms). **(R9)** past headset range: the SMG beats the Shotgun.

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
default_pool`'s named exemption).

Two halves, each ≥ 65% for (b): **(a)** each live sidearm finishes an undefended 35 HP target (health
only) in under 1.0 s median, reaction delay included — USP ~779 ms, Deagle ~974 ms, both clear.
**(b)** every primary this engine can model (Assault Rifle, Burst Rifle, Energy Rifle, Suppressor, AMR,
Bolt Rifle) beats each live sidearm from full Standard health — all twelve pairs clear it, including the
Suppressor against both pistols (99.8% USP, 77.9% Deagle). The Toxin Rifle (DoT) and the Force Rifle
(burst mode + a real recoil ladder) are named, not modelled — neither mechanic exists in this engine.

**The Suppressor's own recoil exception (R10, row 3).** Tony: "it should be weaker since its silent but
not too weak." It first read ~62% against the Deagle; `recoil.heavy` moved 60 → 70 (declared, not
derived — every other reference-calibre weapon ships the 60 floor), so `degraded` derives to 85, not 80.
`after_shots`/`after_heavy` are unaffected (they derive off `dmg`, not `heavy`): still 7/10. It still
trails every other primary against a bursting AR (92.4%, the highest of the six), so it stays the
weakest primary by design.

`python3 mcp/tools/balance_sim.py --scenario r10-duel`; gated in CI by `mcp/tests/test_balance_sim.py::test_r10_sidearms_finish_a_kill_under_a_second`
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
| Assault Rifle | 9 at 100 ms | 7 at 225 ms | 0.15 s slower |
| SMG | 7+2 at 100 ms | 5 at 184 ms | 0.27 s slower |
| Shotgun | 20 at 700 ms | 15 at 1000 ms | 0.40 s slower |
| Suppressor | 8 at 140 ms | 3 at 155 ms | 0.21 s slower |
| Energy Rifle | 9 at 150 ms | 8 at 405 ms | 0.23 s slower |

Each pair is chosen to land the time to kill in the **middle** of the window between plain-against-bare
and plain-against-armoured, so the cost is felt rather than technical, and `ap_fire_ms` is never faster
than the weapon's own cycle.

**What is still refused.** A weapon whose cell is already a headset-multiplier row (fn 36/37) is refused
by an older rule, because re-keying it would change what the weapon does rather than where its damage
goes. A charge weapon is refused because its hits-to-kill is release-and-tap maths. And a **one-shot
weapon has no window at all**: the Rocket Launcher kills a standard target in one hit, a time to kill of
zero, and you cannot sell a bypass to a weapon that already kills outright.

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
