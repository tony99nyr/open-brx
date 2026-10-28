# Weapon design: history


Moved out of [`docs/weapon-design.md`](../weapon-design.md) on 2026-10-27 (doc-rot review). This is history, not a source of truth. The design of record is `weapon-design.md`. A fact that a living page still needs lives there, not here.


---

## Section 1 (was §1.1, §1.2 and "SHIPPED"): the re-base on captured frames

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

> The living copy of this table is [reference/weapons.md](../reference/weapons.md). This copy is frozen.

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

## Section 2.2: the full "changed" column, for the nine weapons whose history was long

**Shotgun.** **2026-10-24** (F579): gun word 20→19, headset word 20, Tony's call: past headset range a kill needs 7 gun hits, more than the tube; **2026-09-18**: dmg 45→20 (`wire.dmg`, the gun word); OUR chosen 20-damage headset word (`wire.headset_dmg`, t12) stacks unconditionally on top, 40 real per pull (39 since F579 moved the gun word to 19). **F276 asked whether two IDENTICAL words survive and the answer is yes** (bench 2026-09-18: five pulls, two `$HIR` of 20 every time, 60-75 ms apart, both registering even when they landed on the same sensor as byte-identical frames), so the 159 ms beacon block does not apply to this pair; the second word itself is measured (Callsign's own 70, cap30), the split is a balance number we picked (htk/TTK unchanged, 2 pulls short, 3 kills either way), but `dmg`/`dps`/`sust`/one-mag % here are the GUN WORD ALONE, not the real per-pull total. Magazine deliberately left at 6/24 (the reserve doubled to 48 on 2026-10-17, Balance rules row 16). **2026-09-23** (R8, F308): pump gap (t14, `wire.fire_ms`) tightened 800→700ms, the slowest of Tony's sweep {800,750,700,650,600} that gets the Shotgun to beat a full-auto SMG at close range most of the time — see the Balance rules table. That also took the Shotgun's TTK past the Sniper Rifle's, so `test_ttk_band_and_no_strictly_dominant_weapon` now also names `(shotgun, sniper_rifle)` in `KNOWN_DOMINANCE`, beside the now-empty `(amr, shotgun)` history. The suite is GREEN, not red, and the exemption fails the moment the pair stops dominating; §7 **2026-10-17** (Balance rules row 14): pump gap 700→400 ms, so it wins close range against every rifle under the player-paced model (R11) and still loses past headset range (R12); Armour Piercing 15 at 500 ms.

**Plasma Sniper.** dmg 80→25, cycle 225→400; **2026-09-18**: htk 5→4, TTK 1.60→1.20s (our chosen 10-damage headset word, `wire.headset_dmg`/t12, stacks unconditionally, 35 real per pull; ⚠️ this weapon has NEVER been captured -- cap30 fired only a Shotgun -- so its second word rests on a sourced t12=80 and nothing else); `dmg`/`dps`/`sust`/one-mag % here are the gun word alone, same caveat as the Shotgun; §7

**AMR.** dmg 18→24, cycle 360→400; **2026-09-18** (F62): dmg 24→21, htk 5→6, TTK 1.60→2.00s — 30% `crit_pct` (a crit is x1.5 truncated, so 21→31) pays for itself: average damage per hit holds at 24.15, but the published number is now the GUARANTEED five-hit-plus kill, six hits when unlucky. **2026-10-17** (the player-paced retune, Balance rules row 14): dmg 21→26, cycle 400→350, htk 6→5, a four-hit kill when one crit (39) lands. **2026-10-25:** cycle 350→450 ms on both Standard and Shields. Mag/reserve unchanged (the reserve doubled on 2026-10-17, Balance rules row 16)

**Burst Rifle.** **2026-09-17**: dmg 9→11 (`wire.dmg`); **2026-09-18** (F62): dmg 11→10, htk 11→12, TTK 1.42→1.56s — 40% `crit_pct` (a crit is x1.5 truncated, so 10→15) pays for itself: average damage per hit holds at 11.25, but the published number is now the guaranteed 4-pull kill; a 3-pull kill lands about 27% of the time. **2026-09-23** (R6, F308): burst gap (t23, `overrides.t23`) widened 275→410ms so a disciplined AR burst beats it most of the time. **2026-09-23, polish round 1** (F308): modelling the crit reopened R6 at 410ms, so the gap widened again, 410→550ms — see the Balance rules table §7.5d; htk unchanged, only cycle/TTK moved. **2026-09-24, polish round 2** (F308, "full auto point blank ... too harsh"): the gap eased 550→540ms alongside the AR's own `heavy` easing (see the AR row below); htk still unchanged. Mag/reserve untouched then (the reserve doubled on 2026-10-17, Balance rules row 16)

**SMG.** **2026-09-20 playtest**: a covered gun emitter produced no headset hit because captured t12 was empty. Open BRX now deliberately adds a headset word at the known-good carrier 100; cycle 95→100 and mag/reserve 72/288→54/216 keep the added word priced and preserve the Suppressor's magazine lead. **2026-09-23** (R5, F308): the split moved 8+1→7+2 (close range still 9); `dmg`/`dps`/`sust`/one-mag % here are the GUN WORD ALONE (7), same caveat as the Shotgun

**Toxin Rifle.** **2026-09-18**, in the picker since 2026-09-19: the gun lands the direct hit and the POISON is a tick clock on the victim's node (S16, `spec/node.md` §3.17). 4 damage a second for 5 s, refreshed on each hit, never stacked: worth 20, so twelve hits make it lethal even if the target breaks contact, and twelve hits take 1.21 s -- close to the Assault Rifle's own 1.20 s (§7.5's own pair). §7.5

**Charge Rifle.** **2026-09-17**: dmg 87→85 (`wire.dmg`, the CHARGE damage; tap damage `t37`=20 unchanged), mag/res 12/12→40/80, `rounds_per_charge`=10 (F225/F226/S43); `htk`/`ttk s` now count 1 charge + 2 taps (release-to-kill), not `ceil(pool/85)`. **2026-09-18 bench**: the tap cadence is **285 ms**, measured, not the 500 ms placeholder, so release-to-kill falls 1.00 s → **0.57 s**. The charge costing exactly 10 rounds, the 85 charge and the 20 tap were all confirmed on the wire in the same run. **2026-09-23 (F280)**: charge damage 85→70 (`wire.dmg`), which pushes the kill to 1 charge + 3 taps and TTK 0.57→0.85 s. **2026-09-23 (F291, later the same day)**: the recoil duel sim's rule 2 (an AR catching an uncharged CR should win) failed. First tried moving the tap CADENCE 285→350 ms — reverted the same day: that constant is the player's own physical pull rate, no `$WEAP` field carries it and the gun neither reads nor enforces it, so it changed nothing the gun does. Fixed on the wire instead: tap damage 20→**16** (`wire.tap_dmg`, t37, independent of the charge magnitude on t5, bench-proven 2026-09-17). 16 still closes the pool in exactly three taps (3×16=48 ≥ the 45 left after the charge), so `htk`/`ttk s` at the 115 pool are unchanged from the pre-F291 row. `DPS` and `sust` count CHARGES only (70 / 1.25 s, and 4 charges a magazine against `4 × 1.25 + reload`); the tap is a second cadence and no single figure covers both, so `ttk s` is the column that reads the mixed kill

**Desert Eagle.** **D2 2026-09-12** (Bolt Rifle frame). **2026-09-23** (R10, F308): cadence 480→700ms, the real-world lever (.50 AE recoil) Tony chose over touching the magazine — a finishing weapon, not a rifle-competitive one; see the Balance rules table row 10

**USP-S.** **2026-10-24** (F579): dmg 12→10, Tony's call, so the rifles win the R10b duel at field pace; **D2 2026-09-12** (Bolt Rifle frame, suppressed); **2026-09-17**: mag 20→19 (§2.3, family-scoped dominance). **2026-09-23** (R10, F308): mag 19→12, the real-world lever (a USP .45 holds 12) — a 13-hit kill outside one magazine on purpose, until 2026-10-17 (12 at 190 ms: a kill is 12 hits, one magazine, so the exemption in `test_shipped_roster_satisfies_the_mag_invariant_at_the_default_pool` ended). See the Balance rules table row 10



---

## Section 2.2: "Role identities", the long dated text


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
- **Bolt Rifle** — hidden. Single shot, 15 a hit at 150 ms, 8 hits, 24 kills (2026-10-17; it was stock 13 at 225 ms).
- **SMG**: **2026-09-20 playtest: the headset now emits a priced second word** (7 + 2 since R5, 2026-09-23;
  the history below is the first 8 + 1 pass). Covering
  the gun emitter produced no hit because the captured SMG frame had an empty t12; the Shotgun control
  did produce one. The second word uses carrier 100, which is known to pass the receiver, while the gun
  keeps its outdoor 30 carrier. To keep the combined 9-damage pull inside the balance band and preserve
  the Suppressor's magazine lead, cycle 95 → 100 ms and mag/reserve 72/288 → 54/216. Its heat value
  (`t24 = 5`) remains inert: overheat requires t37/t38, which only the Charge Rifle and the Energy Rifle
  (its `t38` override) carry.
- **Shotgun**: three hits, six shells, a **400 ms Shells-type reload**. Since 2026-09-18 each hit is a
  gun word plus our 20-damage headset word (was 45 on the gun alone); the gun word is 19 since F579
  (2026-10-24). Its identity is the three-hit kill up close, not throughput (sustained output in §2.2).
- **Stinger** — full auto, eight hits, 38 kills. Reserve doubled so it is not simply the SMG's worse
  sibling.
- **Sniper Rifle** — the only two-hit weapon outside the power tier: a bolt action since 2026-10-17, with a
  2.2 s bolt since 2026-10-18 (F573).
- **Plasma Sniper** — a marksman rifle that fires like a carbine and **overheats** (`t24 = 30`).
  Damage dropped hard (80 → 25) precisely so its cycle could stay fast enough for the heat mechanic
  to matter.
- **AMR**: semi-automatic (`t20 = 7`), 26 a hit and 5 hits (2026-10-17; 21 and 6 before), a 14-round
  magazine and a 30% `crit_pct` (F62, 2026-09-18).
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
  checks this adds: each pistol still finishes a 35-HP target within the R10a bar (1.0 s then, 1.2 s from
  2026-10-17), and every modelled
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


---

## Section 3.3 and 3.4: two retracted sound rules

### 3.3 – 3.4 Two retracted sound rules (provenance in git history)

The first pass (2026-08-26, first revision) derived a "duration ÷ cadence ceiling" for fire sounds and a
"three reload parts play in sequence inside `reload_ms`" budget. Both are void: the AR plays a 1.76 s sample at
a 100 ms cadence (the firmware truncates and retriggers by design), and six stock frames "overrun" the reload
model (the Shotgun's 0.82 s chain inside a 400 ms `Shells` reload). Sample duration constrains only weapons slow
enough to play a sample out; the chains ship unmodified; reload-chain timing is an open bench question (§5, U4).
The retracted text: `git log -- docs/weapon-design.md` before 2026-09-06.


---

## Section 5: the open-unknowns register

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

## Section 6: the `$SIR` layer stub

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
