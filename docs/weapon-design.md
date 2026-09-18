# Weapon design & balance

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
token it came from, because "reserve" alone is ambiguous even inside one arsenal (F253).


> ## ✅ FIXED 2026-09-18 — the Energy Launcher's zero damage had a one-line cause
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
> sensors, so the five weapons below no longer gain anything from a headset hit) — the GUN BODY lands the raw magnitude (×1) on all three functions, fn 1/36/37 alike. So
> five weapons — Burst Rifle, Bolt Rifle, AMR (fn 37), Force Rifle, Sniper Rifle (fn 36) — deal more
> than their `t5` on a HEADSET hit only; a body hit is exactly `t5`. This reconciles rather than
> overturns the two earlier readings: 2026-08-27's ×1.0 matrix was rig-pinned to the gun body
> (correct — body is always ×1) and 2026-09-02's ×1.25/×2 reading was taken on the headset at t7=50
> (also correct). §6.2.

What our weapons are, why their numbers are what they are, and where every one of them comes from.

**Rewritten 2026-08-26 (second pass).** The first version of this document was built on a
four-sample template system and a mis-read token map. Both are gone. **Every weapon is now based on
its own captured Callsign `$WEAP` frame**, and the balance below is written on top of those frames.
Where the earlier analysis was wrong, it is marked *retracted* rather than quietly deleted.

- **Roster:** `mcp/brx_mcp/mc/weapons.json` — each row carries `capture.frame` (the real frame Battle
  Company sent) plus a `wire` block listing only the tokens we deliberately overwrite.
- **Raw traces:** `protocol/captures/raw/` · decode with
  `python -m brx_mcp.weapmap protocol/captures/raw/*.btsnoop` · named table in
  `docs/reference/weapons.md`.
- **Token map:** `protocol/callsign-extract/protocol-classes.md` · **bench truth:**
  `protocol/session-findings-2026-08.md` §7r and the 2026-08-26 probe entries.
- **Sound bank:** `protocol/callsign-extract/sound-bank.md` (prefix legend credited to David Knox,
  shared by the owner community).

Protocol discovery credit: **LaserTagMods** (JEDGE/JBOX). Stock firmware is never modified — every
value here is a number we send in a `$WEAP` frame over BLE.

---

## 0. The damage model

Hardware-true, from `session-findings-2026-08.md` §7r and the 2026-08-26 damage experiment:

- The default pool is **115 = 45 HP + 70 armor** (`compile.py`, `health: {max_hp: 45, max_armor: 70}`).
- **Armor absorbs at face value and spills into HP** — 70 → 46 → 22 → 0, then into HP.
- ⚠ **"No multiplier, no reduction" was true only of the rows we had seen.** The IR work (**§6**)
  shows the victim's `$SIR` row can multiply the incoming magnitude (×1.25, ×2), bypass armor
  entirely, or apply it to a pool instead of subtracting it — and that a **shield** pool exists above
  armor. Everything in §0–§5 assumes a standard-damage row against a shieldless victim.
- **`t5` is the RAW magnitude, not the applied damage** — `$HIR` token 5 echoes the magnitude, and the
  victim's `$SIR` row decides what lands (§6.2). The earlier "applied damage, exactly, four weapons"
  reading held only because all four keyed to plain-damage rows.
- The stock Assault Rifle deals **9**, not the manual's 24. The manual is stale.
- Damage drains **shields → armor → HP**; armor overflow spills into shields (§6.1).

| term | formula |
|---|---|
| **htk** | `ceil(pool / dmg)`, where `pool` is the host's `max_hp + max_armor` (115 at the defaults, and the column used throughout this document) — it MOVES with the health config, see §2.5. Also see §6.2: this is the raw-`t5` reading and is wrong for five shipped weapons |
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
| 3-round burst timing | `t23` | Burst Rifle (275), Force Rifle (250) — nobody else |
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

> ⚠ **Read §6.2 with this section.** The table below is computed on raw `t5`. The `$SIR` table MC
> actually pushes multiplies two of the three subtypes in use, so **five weapons do not deal their
> `t5`** and four of them fall outside the band once that is applied. The numbers here are correct as
> *frame* values and as a balance skeleton; they are not the damage that lands.

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
   What DOES block is a weapon that cannot damage anyone at all (§6.2).
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
| Shotgun | cqb | 20 | 800 | 3 | **1.60** | 25.0 | 23.1 | 6 | 24 | 400 | 12% | — | **2026-09-18**: dmg 45→20 (`wire.dmg`, the gun word); OUR chosen 20-damage headset word (`wire.headset_dmg`, t12) stacks unconditionally on top, 40 real per pull; the second word itself is measured (Callsign's own 70, cap30), the 20 is a balance number we picked (htk/TTK unchanged, 2 pulls short, 3 kills either way), but `dmg`/`dps`/`sust`/one-mag % here are the GUN WORD ALONE, not the real per-pull total. Magazine deliberately left at 6/24: `test_ttk_band_and_no_strictly_dominant_weapon` fails (the AMR now dominates it), and that is left RED on purpose pending F254 rather than bought with an unexamined number; §7 |
| Plasma Sniper | marksman | 25 | 400 | 4 | **1.20** | 62.5 | 41.7 | 10 | 80 | 2000 | 95% | 30 | dmg 80→25, cycle 225→400; **2026-09-18**: htk 5→4, TTK 1.60→1.20s (our chosen 10-damage headset word, `wire.headset_dmg`/t12, stacks unconditionally, 35 real per pull; ⚠️ this weapon has NEVER been captured -- cap30 fired only a Shotgun -- so its second word rests on a sourced t12=80 and nothing else); `dmg`/`dps`/`sust`/one-mag % here are the gun word alone, same caveat as the Shotgun; §7 |
| AMR | support | 24 | 400 | 5 | **1.60** | 60.0 | 48.0 | 14 | 56 | 1400 | 100% | — | dmg 18→24, cycle 360→400 |
| Force Rifle | assault | 10 | 100 +250 | 12 | **1.65** | 66.7 | 50.7 | 36 | 144 | 1700 | 100% | — | dmg 9→10 |
| Burst Rifle | assault | 11 | 75 +275 | 11 | **1.42** | 77.6 | 58.2 | 36 | 216 | 1700 | 100% | — | **2026-09-17**: dmg 9→11 (`wire.dmg`) |
| Stinger | cqb | 15 | 250 | 8 | **1.75** | 60.0 | 43.5 | 18 | 144 | 1700 | 99% | — | cycle 120→250, res 72→144 |
| Bolt Rifle | assault | 13 | 225 | 9 | **1.80** | 57.8 | 38.7 | 18 | 180 | 2000 | 98% | — | **stock** |
| SMG | cqb | 8 | 95 | 15 | **1.33** | 84.2 | 61.7 | 72 | 288 | 2500 | 100% | 5 | **2026-09-17**: cycle 140→95 (`wire.fire_ms`) |
| Toxin Rifle | assault | 8 | 110 | 15 | **1.54** | 72.7 | 49.0 | 30 | 180 | 1600 | 99% | 5 | **2026-09-18, NOT FINISHED (hidden)**: the gun lands the direct hit and the POISON is a node tick clock that is not built (S16). 4 damage a second for 5 s, refreshed on each hit, never stacked: worth 20, so twelve hits make it lethal even if the target breaks contact, which is the same 1.21 s the Assault Rifle needs to finish outright. §7.5 |
| Suppressor | support | 8 | 140 | 15 | **1.96** | 57.1 | 48.0 | 75 | 384 | 2000 | 100% | — | **2026-09-17**: cycle 160→140 (`wire.fire_ms`); mag 48→75 (§2.3, family-scoped dominance) |
| Assault Rifle | assault | 9 | 100 | 13 | **1.20** | 90.0 | 62.6 | 32 | 192 | 1400 | 100% | — | **2026-09-17**: cycle 140→100 (`wire.fire_ms`, native Battle Company speed) |
| Energy Rifle | support | 9 | 150 | 13 | **1.80** | 60.0 | 57.0 | 300 | 600 | 2400 | 100% | 6 | **2026-09-17**: cycle 200→150 (`wire.fire_ms`); overheat switched ON (F229: `t38`=150 override, `t35`=D11) |
| Charge Rifle | support | 85 | 1250 | 3 | **0.57** | 68.0 | 45.3 | 40 | 80 | 2500 | 92% | 14 | **2026-09-17**: dmg 87→85 (`wire.dmg`, the CHARGE damage; tap damage `t37`=20 unchanged), mag/res 12/12→40/80, `rounds_per_charge`=10 (F225/F226/S43); `htk`/`ttk s` now count 1 charge + 2 taps (release-to-kill), not `ceil(pool/85)`. **2026-09-18 bench**: the tap cadence is **285 ms**, measured, not the 500 ms placeholder, so release-to-kill falls 1.00 s → **0.57 s**. The charge costing exactly 10 rounds, the 85 charge and the 20 tap were all confirmed on the wire in the same run |
| Rocket Launcher | power | 115 | 1000 | 1 | **0.00** | 115.0 | 50.0 | 2 | 2 | 2600 | 91% | — | res 8→2, reload 1200→2600 |
| Energy Launcher | power | 115 | 1600 | 1 | **0.00** | 71.9 | 50.0 | 2 | 2 | 1400 | 91% | — | cycle 360→1600, mag 1→2, res 6→2 |
| Ion Sniper | power | 115 | 1400 | 1 | **0.00** | 82.1 | 47.9 | 2 | 2 | 2000 | 91% | — | cycle 1000→1400, res 12→2 |
| Rail Gun | power | 115 | 1200 | 1 | **1.20** | 95.8 | 47.9 | 2 | 2 | 2400 | 91% | — | mag 1→2, res 6→2 |
| Laser Cannon | power | 115 | 1500 | 1 | **1.50** | 76.7 | 50.0 | 2 | 2 | 1600 | 91% | — | mag 4→2, res 8→2, reload 2000→1600 |
| Desert Eagle | sidearm | 26 | 480 | 5 | **1.92** | 54.2 | 32.7 | 7 | 48 | 2200 | 65% | — | **D2 2026-09-12** (Bolt Rifle frame) |
| USP-S | sidearm | 9 | 160 | 13 | **1.92** | 56.2 | 32.6 | 19 | 120 | 2200 | 67% | — | **D2 2026-09-12** (Bolt Rifle frame, suppressed); **2026-09-17**: mag 20→19 (§2.3, family-scoped dominance) |
| Glock-18 | sidearm | 13 | 240 | 9 | **1.92** | 54.2 | 34.4 | 16 | 64 | 2200 | 93% | — | **D2 2026-09-12** (Bolt Rifle frame) |

**"One-mag kill %"** (2026-09-17, replaces the old "mag/total kills" column) is `P(at least htk hits in
mag shots)` at a stated field accuracy `p=0.7`, binomial exact — the same formula the sidearm proposal
used (`docs/reference/ttk-model.md` §Sidearm proposal). Reserve ammo is no longer a balance axis: a
respawn refills the whole kit, so how many kills a full kit could theoretically produce said nothing
about any single life. The Charge Rifle's `mag`/`reserve` are ROUNDS of its 10-round cell
(`rounds_per_charge`), so its one-mag figure is computed on 4 charges (`40 / 10`), not 40 hits.

Three weapons ship **exactly as Battle Company sent them** (`verified: true`): the Burst Rifle, the
Bolt Rifle and Melee — their stock numbers already sat in the band.

**Role identities**

- **Assault Rifle** — the anchor, and the one weapon players arrive already attached to. **2026-09-17
  arsenal review: back to Battle Company's native 100 ms cycle** (`wire.fire_ms`), reversing the
  2026-08-30 retune to 140 ms; damage untouched at the captured 9. Tony's call, made with the
  historical dominance finding on the table (below): at 140/192 the AR dominated nothing under the old
  three-axis check; at native 100/192 it strictly dominates several other picker weapons under BOTH
  the old axes and the new one-magazine-kill-chance axis (§2.3). The planned equaliser was a
  node-driven accuracy/stance/flinch system (S42); Tony cut it on 2026-09-18 for BLE load
  (`spec/node.md` §3.15), so no equaliser is planned now. Under the family-scoped rule that shipped the same day (§2.3) the
  test is GREEN: the AR leads its family on time to kill and sustained DPS, and the SMG and Suppressor
  lead on kills per clip. ⚠️ **That is a paper lead, not a felt one.** A player who picks on feel has
  no reason to take anything else in this family, so the AR's cost is owed and unpaid.
- **Burst Rifle** — **2026-09-17: damage 9 → 11** (`wire.dmg`), 13 hits → 11, so the real three-round
  burst separates further from the SMG-class assault weapons on hits-to-kill, not only on cadence
  (75 ms intra-burst + 275 ms gap, unchanged). No longer ships byte-for-byte (`verified: false`).
- **Force Rifle** — hidden since the 2026-09-17 cuts, and its old "heavier twin" identity is gone:
  the Burst Rifle went to 11 damage that day while the Force Rifle stayed at 10, so it is now the
  lighter AND slower of the burst pair (12 hits and 1.65 s against 11 hits and 1.42 s), with half the
  reserve and a slower five-part reload. It is kept for custom games, not retuned.
- **Bolt Rifle** — stock. Single shot, 9 hits, 22 kills.
- **SMG** — **2026-09-17: cycle 140 → 95 ms** (`wire.fire_ms`), four kills a magazine, 24 across the
  kit, and a heat value (`t24 = 5`) — **inert as shipped: overheat requires t37/t38, which only the
  Charge Rifle carries (bench 2026-08-26)**.
- **Shotgun** — three hits, six shells, a **400 ms Shells-type reload** — the highest sustained
  output in the arsenal from its shallowest ammo pool. Unchanged in the 2026-09-17 pass; its numbers
  already matched Tony's target.
- **Stinger** — full auto, eight hits, 20 kills. Reserve doubled so it is not simply the SMG's worse
  sibling.
- **Sniper Rifle** — the only two-hit weapon outside the power tier, on a 1.5 s cycle. Unchanged in the
  2026-09-17 pass.
- **Plasma Sniper** — a marksman rifle that fires like a carbine and **overheats** (`t24 = 30`).
  Damage dropped hard (80 → 25) precisely so its cycle could stay fast enough for the heat mechanic
  to matter.
- **AMR** — the hardest-hitting automatic (24 a hit) and the shallowest (14 kills). Unchanged in the
  2026-09-17 pass.
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
  allow-lists 38 so nothing can key to it by accident again (`compile.py`). Damage is now two
  independent numbers: `t5` (charge) `85` via `wire.dmg`, `t37` (tap) `20` (already the captured
  value). A full charge costs 10 rounds of the cell and +56 heat; a tap costs 1 round and +14 heat;
  the lockout sits at about heat 103 for about 4.8 s. The new catalogue field `rounds_per_charge: 10`
  says so explicitly, and every place that used to read `mag`/`reserve` as hit counts (the one-magazine
  guard, the dominance table's kill-chance axis) now divides by it first. The design point (S43,
  Tony): nobody lands a second charge in a 1v1, so the intended kill is **one charge plus two taps**
  (85 + 20 + 20 = 125 ≥ 115), 12 rounds and 84 heat, safely under the lockout. Cell size raised
  100/200 → **40/80** rounds (4 charges up, 8 back) from the old 12/12 the first pass shipped, cutting
  the previous single-most-dominant weapon in the arsenal down to a magazine that holds one real kill
  combo with one charge spare.

  **2026-09-17, second pass: the model now counts the real combo.** `hits_to_kill()` used to publish
  `ceil(pool/85) = 2`, silently pretending every hit is a full charge; it now counts 1 charge plus
  however many taps close the rest of the pool — **`htk` = 3, `ttk_ms` = 1000** at the 115 pool. TTK is
  deliberately RELEASE-to-kill, not charge-to-kill: the charge is pre-built behind cover, so the ~3.5 s
  (by feel; `t14` itself reads 1250 ms, a separate and still-unreconciled number) it takes to build is
  SETUP, not combat time — that pre-charge is the weapon's whole identity (S43). The two taps that
  follow cost `WeaponCatalog.CHARGE_TAP_CADENCE_MS` (500 ms, a documented placeholder for "about 1 s"
  pending a bench-measured tap cadence) each. `rounds_to_kill()` is the ROUNDS version of the same
  combo (12: `rounds_per_charge` + 1 round per tap) for anything that must compare against a raw
  `mag`/`reserve` count — the one-magazine guard and kills-per-clip both use it, never `hits_to_kill()`
  directly. The SUSTAINED-DPS and one-magazine-kill-chance axes (§2.3) still model the weapon as
  repeated full charges (a charge is near-certain once released; no per-action accuracy model exists to
  mix that with a tap's p=0.7 trigger pull), so they keep the simpler `ceil(pool/85) = 2` — a different
  question ("how hard can this sustain fire") from "what does the one pre-built kill cost".
- **Sidearms (2026-09-04, rebalanced D2 2026-09-12)** — Glock-18, USP-S, Desert Eagle: slot-2 backups
  built on the Bolt Rifle's captured frame (the one captured semi-automatic: `t20 = 7`, one shot per
  trigger pull, magazine reload). Tony, 2026-09-11: "the sidearms should not kill fast, they should
  kill slower than rifles"; "rate of fire on the pistol usp should be quicker to match counter strike.
  less damage but faster rof." The original pass (2026-09-04) copied the Counter-Strike identity
  literally — Glock fastest+weakest, USP in the middle — but that left the Deagle and USP both
  killing faster than every rifle (docs/game-test-2026-09-11.md D2). The 2026-09-12 pass instead gives
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
- **Power tier** — Rocket, Rail, Laser, Energy Launcher, Ion Sniper. All 115 damage, all one-shot,
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
expected, not a balance failure: the MODEL does not see range (range ships on `t2`, so it does not
reach `weapons.json`'s derived columns), and a
Sniper Rifle's whole real identity IS range — the model simply cannot see the axis that would stop the
SMG winning. Checking dominance only within a family (weapons that already share a fire mode and a
damage type) keeps the check meaningful without pretending to referee a fight the model has no data
for. The same check on the STOCK roster, unscoped, returned **43** dominated pairs; scoped to family
and using the 2026-09-17 numbers, the roster is CLEAN — zero violations.

**3. The lead rule.** Every visible weapon must LEAD its family on at least one axis a player can
feel — the strict-dominance check alone allows a family where every OTHER member ties or loses to one
weapon on every axis without that one weapon quite crossing into "dominates" (no single strict edge on
any one axis). "Leads" means: achieves the family-best value (ties count) on one of the four numeric
axes above. ⚠️ **It does NOT mean a unique `range_band`.** Polish round 2 (2026-09-17) removed that
path (and a `recoil.floor` path, since cut with S42), because it does not reach a gun, so a lead
claimed on it would be satisfied by inert data and the rule could never fail. Add it back in the same
commit that wires the lever. A family of one (Burst Rifle, Energy Rifle, Charge Rifle: each alone in its
mode/class bucket) trivially leads: there is nothing to be out-led by. `range_band` is **declared
catalogue data that the COMPILER never writes**
(`test_range_is_declared_not_wired_and_accuracy_stays_native_off` is the guard). It is human-facing
intent, not the wire value. The wire value exists and does reach a gun: `wire.range_outdoor_pct` writes
`t2` outdoors:

- **`range_band`** (`"close" | "close-mid" | "mid" | "long"`, plus a `range_target_m` human string) —
  the per-venue metres Q15 will calibrate once `t2` is (F231): Shotgun/sidearms close (8-10 m indoor /
  15-18 m outdoor), SMG close-mid (12 / 25-30), Assault Rifle/Burst/Charge Rifle mid (18-20 / 40-45),
  Suppressor/Energy Rifle mid (15 / 30, the deep-mag "LMG" role), Sniper Rifle/AMR long (full reach /
  60 m+). The power tier is provisionally mid (a power weapon, not a marksman one) pending a real call.
- **`recoil`** was a second qualifier, the per-weapon S42 node-driven accuracy profile. Tony cut live
  accuracy on 2026-09-18 for BLE load, and the field is gone from `weapons.json`.

`resolve()` does not read `range_band`: `t41`/`t2` (range) still ship whatever the capture carries (F135,
F231; this is the single biggest missing design axis, §5, U2), and `t21`/`t22` (accuracy ceiling/
floor) ship 100/100 on every weapon (native walk off, F230). The field is declared now so that the NEXT
retune tunes it alongside the numbers above, and does not re-derive this whole argument once the lever
exists.

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
  as specified.

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
| Charge Rifle | 2 | **3** | 5 | 7 |
| Sniper Rifle | 2 | **2** | 3 | 4 |
| Shotgun | 3 | **3** | 4 | 5 |
| Plasma Sniper | 3 | **4** | 5 | 6 |
| AMR | 5 | **5** | 7 | 9 |
| Burst Rifle | 10 | **11** | 14 | 19 |
| Stinger | 7 | **8** | 10 | 14 |
| Bolt Rifle | 8 | **9** | 12 | 16 |
| Force Rifle | 10 | **12** | 15 | 20 |
| Assault Rifle / Energy Rifle | 12 | **13** | 17 | 23 |
| SMG / Suppressor | 13 | **15** | 19 | 25 |
| Desert Eagle | 4 | **5** | 6 | 8 |
| USP-S | 12 | **13** | 17 | 23 |
| Glock-18 | 8 | **9** | 12 | 16 |

**The Charge Rifle's `htk` in this table is trigger ACTIONS (1 charge + N taps), not equal-sized
hits** (2026-09-17, F225/F226/S43) — at 200 the pool needs 1 charge (85) plus 6 taps (20 each, the
last one overkilling by 5) to close, not `ceil(200/85) = 3`. Every other row is the plain
`ceil(pool/dmg)` every non-cell weapon uses.

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

Two overrides ship, both from the 2026-08-26 field range:

| weapon | token | change | why |
|---|---|---|---|
| Sniper Rifle, AMR, Force Rifle | `t33` reload part 3 | `D21` → `D02` | `D21` fires a "disable" chirp alongside the reload — reproduced on two guns. `D02` is the clean cocking beat the AR/Burst/Bolt chains already end on. |
| Energy Launcher | `t27` fire sound | `J15` → `O01` | `J15` is a **music sting** (`J` = music/SFX in the DK legend), inherited from the "unnamed secondary" frame. `O01` (1.45 s) is an ordnance report; the whole **O** family is otherwise unused by the stock arsenal. |

**Correction to the bench note:** the D21 weapons are the Sniper Rifle, the AMR and the **Force
Rifle** — not the Bolt Rifle. Bolt shares `D04+D03` but its captured chain already ends on `D02`, so
it needs no override; Force Rifle's chain is `D23+D22+D21`. Pinned by a test so the distinction
cannot quietly rot.

Other `O` candidates for a bench audition if `O01` does not sit right: `O05` 1.46 s, `O02` 1.71 s,
`O04` 1.79 s, `O06` 1.81 s, `O03` 2.51 s. Any of them fits the Energy Launcher's 1600 ms cycle.

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

### 4.2 `t2` is the range lever, not `t41` (corrected 2026-09-17)

**This section used to argue range was an unrecovered gap sitting at `t41`. That was wrong, and the
correction is recorded here rather than deleted.** The garden range test (2026-09-17,
`docs/experiment-log/2026-09.md`, evidence in `docs/evidence/2026-09-17-range-t41/`) ran two `$WEAP`
slots differing only in `t41` (5 vs 75) outdoors: the low slot scored **27 of 27** hits against the
stock slot's **55 of 57**, at 3 m, 10 m, 20 m, 40 m and about 200 ft. **`t41` is a null outdoors.**
The same session found the real emitted-power control at **`t2` (APK name `gunRangeOutdoor`)**:
`t2 = 5` landed **0 hits from 38 shots** at any distance, including muzzle on the dome; `t2 = 100`
(the value every captured gun ships) reaches about 200 ft. Between them the ladder showed a floor,
a real transition roughly **13 to 26**, and a flat shelf from about **31 to 100** where every value
behaved alike at any distance the garden could pace out.

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
| SMG | 30 | close | **Real guess**, sits at the shelf edge |
| Shotgun | 100 | close | **Moved onto the flat shelf, 2026-09-18** (Tony): the gun word now reaches full distance, off the unstable 13-26 knee it sat on until this change. See §7's dual-emitter write-up: the Shotgun's real close/far shape now lives in `wire.headset_dmg`'s reach (`t13`/`t42`), not in `t2` |
| Rocket Launcher | 22 | close | **Real guess.** A pickup-only one-shot heavy is meant to be earned at close range, not to out-reach the arsenal it out-damages (Tony, 2026-09-17). Same transition-band caveat as the Shotgun used to carry |
| Rail Gun | 22 | close | Same reasoning and caveat as the Rocket Launcher |

Every value from 55 up sits on the flat shelf the garden test found (roughly 31 to 100): they are
expected to behave alike until the shelf itself is mapped, so the ranking above the shelf is a design
intent, not yet a measured difference. **Only the SMG, Rocket Launcher and Rail Gun values are real
guesses** sitting at or inside the 13-26 transition band, where the method could not separate values
cleanly (F232's first-two-shots effect and the 8-shot groups); they are pending **S49**, the portable
IR receiver, which lets one person map the transition band properly (several fixed receivers at once,
full mags, first two shots discarded, dome shaded). The Shotgun moved off that band 2026-09-18; its own
open range question is now `t13`/`t42` (F254), not `t2`.

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
is a live per-shot accuracy value — not the "audio level" §6.3 used to call it (corrected there too).
It starts each life at `t21`, drops under sustained fire toward `t22` (five steps, each a fifth of the
ceiling-to-floor range per shot), holds at the floor, and resets to the ceiling on reload. A native
recovery races the drop, so `t14` (fire interval) decides how hard the model bites: a fast cycle
reached the floor on shot 8 (floor 0) or shot 11 (floor 50) in the only two walks run, a slow enough one never leaves the ceiling. Shots-per-step is not characterised (n=2).

That makes sustained-fire feel a **three-lever** design space, not two. `t5` (damage) and `t14` (rate of
fire) already tune a single burst; `t21`/`t22` now tune what *staying* on the trigger costs you. A
weapon with a wide ceiling-to-floor gap punishes mag-dumping without touching its damage or cycle
numbers at all — a different route to the same "don't just hold the trigger" goal the Assault Rifle's
cycle retune reached for by hand (§2, "Role identities").

**Every weapon in the catalog ships `t21 = t22 = 100`** — the captured Battle Company default, carried
through unchanged by `resolve()` (Appendix). The model is present on the wire and unused: turning it on
for any weapon is a deliberate balance decision, not something the current roster does today. No
per-weapon values are proposed here — that is future work, and it wants the recovery rate measured
first. F230 later found that the native walk decays on only one gun of three. S42 then drove both tokens
from the node during a life, with a `$WEAP` rewrite up to every 250 ms. Tony cut that on 2026-09-18
because it was the largest BLE load on a gun (`spec/node.md` §3.15). Nothing writes `t21`/`t22` during
a life now.

---

## 5. Open unknowns

| # | unknown | blocks | how to settle |
|---|---|---|---|
| **U2** | ~~`t41` range~~ **CORRECTED 2026-09-17: `t41` is a null outdoors** (garden test, 27/27 hits at t41=5 vs 55/57 at t41=75, every paced distance). **The real range lever is `t2` (`gunRangeOutdoor`, F231/F234), now §4.2's shipped table.** Still open: whether `t2` can fence a weapon to a chosen distance above its shelf (~31-100), and every indoor value (F231). | the range axis (outdoor, closed; indoor, open) | Indoor: run the same ladder indoors, dome shaded. Above the shelf: **S49**'s portable IR receiver, several fixed receivers at once, full mags, first two shots discarded. |
| **U1** | ~~`t20` confirmation~~ ✅ **CLOSED 2026-08-26: PROVEN by one-field flip** — sniper t20 7→0 went single-shot→full-auto on the bench; captured Burst Rifle fired true 3-round bursts (exp-log). | — | done |
| **U4** | **How the 3-part reload chain relates to `reload_ms`.** Six stock frames "overrun" a sequential model, so the model is wrong. | any future reload-sound work | One weapon, one long chain, one stopwatch. Also answers whether `t19` changes it. |
| **U5** | **Does a held trigger retrigger the fire sample from zero, or ring under the next shot?** Decides whether sample duration constrains anything at all. | custom weapon sound design | Fire the AR (1.76 s sample, 190 ms cycle) and listen. |
| **U6** | ~~victim behaviour per damage type~~ — **CLOSED 2026-08-26, then PARTLY REOPENED by the IR work (§6.2).** The hit-SFX half stands. The conclusion *"presentation only; damage is always t5"* does **not**: `t3`/`t4` are the `$SIR` composite key, and the table MC pushes maps two of the three subtypes in use to **multiplier** functions. Damage is `t5 × the row's multiplier`. The earlier test was sound — every row it exercised happened to be a standard-damage row. | §2's balance table (§6.2) | done — the multiplier values were confirmed 2026-09-02 (U10). |
| **U10** | ~~REOPENED 2026-08-27 — what switches the fn 36/37 multipliers on?~~ ✅ **CLOSED 2026-09-02, fully explained 2026-09-11 (F23): the multipliers are REAL but HEADSET-only and t7-scaled. fn 36 = floor(magnitude × (1 + t7/200)), fn 37 = floor(magnitude × (1 + 2·t7/100)); at t7=50, which was the default until the 2026-09-17 arsenal review set the compiled `crit_modifier` to **0**, so the multipliers are OFF today (§6.2) that is ×1.25 / ×2.** 16 trials across magnitudes 20/40/9/7 and 8 `$SIR` row-tail shapes, with an fn 1 control on subtype 0 in every trial. The ×1.25 **truncates** (7 × 1.25 = 8.75 → **8**). Row tails do not gate it. *Reconciled:* the 2026-08-27 matrix that read ×1.0 in all 24 cells was rig-pinned to the GUN BODY (always ×1); the ×1.25/×2 runs measured the HEADSET. Both were correct — different sensors. See §6.2. | §2's balance — the five multiplied weapons are real and §6.2's retune/flatten decision is live | done |
| **U11′** | **Which status function, if any, is a real STUN? — OPEN (reopened 2026-08-27).** fn 23 is eliminated as a stun: it **silences the gun AND zeroes its accuracy** — the silence was heard by ear (stands), while the `$ALCD` token 2 drop cited as its proof is live ACCURACY (bench-proven 2026-09-09, §4.4), not the audio level this row said. One number was doing duty for two claims; see F66. Getting hit with fn 23 forces it down and it recovers over ~6–8 s; the gun fires and emits IR normally, ammo and health preserved, `$SPAWN` clears it early. Category 10 remains unbuilt; next lead is capturing the native Sentinel EMP ability. The 2026-08-26 "it is an EMP" reading and its correction: `docs/experiment-log.md` 2026-08-26/27. | stun weapons | capture the Sentinel EMP |
| **U7** | ~~Damage ceiling in the IR payload~~ ✅ **CLOSED 2026-08-26** — read straight off the wire on our own VS1838B: the field is **8 bits (max 255)** and the rocket's 115 decoded exactly. A 2× powerup is expressible on anything up to 127. | future powerups | **Now directly readable** — the `D8` field on a VS1838B capture (bench-plan Session 1½b). |
| **U8** | **`t17` vs `t40`.** Every captured frame obeys `t17 == 2 × t40` and we preserve it, but *why* is unknown — is `t40` a per-magazine count and `t17` a total? | nothing today; would matter for a resupply powerup | Set them independently and watch `$ALCD`. |
| **U9** | ~~reserve via $AMMO on re-push~~ ✅ **CLOSED 2026-08-26**: a bare $WEAP re-push resets mag/reserve to the frame's baked-in values — pickups MUST re-send $AMMO (exp-log). | — | done |

**Closed since the first pass:** U0 (fire-mode token → `t20`, §4.1) · U3 (`t19` reload type →
captured, `Shells` on the shotgun) · the burst-token hunt (native burst is `t20 = 9` + `t23`) ·
`t3`/`t4` (captured, no longer guessed — and now known to be the `$SIR` key, **§6**, not just a
damage-type label).

---

## 6. The `$SIR` layer — damage is a negotiation, not a number

**Added 2026-08-26 (third pass), from the IR-emitter bench sessions.** Everything above this section
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
- Pools drain **shields → armor → HP**, and armor overflow spills into shields.
  > ⚠ **The third pool is discarded in our code, not just under-specified.** `protocol.py` parses only
  > `$HP` token 1, `app/src/engine.js` drops the shield token, and the phone engine — the thing that
  > actually scores a live game — has no concept of shields anywhere. Harmless until now because
  > nothing could fill the pool; it **fails open** the moment a shield charger exists, which is now an
  > evening's work. Pending decision: `docs/spec/node.md` §10-Q12 and FOLLOWUPS Q12.
- **Shields are not a BLE-writable pool.** They fill only from an IR function-11 event — which is
  what closed P16 after `$PSET` shield values had done nothing all session.

So a weapon is a **`<t5, t3, t4>` triple against a table we author**, not a damage number. Two guns
with identical `t5` can do entirely different things.

### 6.2 ⚠ What this supersedes in this document

> **2026-09-17 (arsenal review): the default `crit_modifier` (compiled `$GSET criticalShotModifier`,
> t7) is now 0, not 50.** BRX has 4 hit sensors on the headset and 1 on the tagger, and play aims at
> the head, so the headset is already the primary target and needs no bonus multiplier — a headset
> hit and a gun-body hit now land the same number. The ×1.25/×2 readings below are still a correct,
> bench-confirmed record of the FORMULA at `t7=50`; they no longer describe the MC-compiled default.
> `headset_multiplier(36, 0)` and `headset_multiplier(37, 0)` both return 1.0 (`compile.py`,
> `mcp/tests/test_headset_multiplier.py`, `mcp/tests/test_gameconfig.py`).

> **2026-09-17 (F225): fn 38, named "standard" below, is not.** Bench 2026-09-17, headset front dome
> with the gun sensor covered, proved fn 38 HALVES every hit (a Charge Rifle charge of magnitude 100
> landed 50, a tap of 20 landed 10), at `t7` 0 and 50 alike. Every row below that reads "`<8,0>` | 38 |
> standard | ... | 20 (×1)" is wrong; the shipped `_SIR_TABLE` no longer keys the Charge Rifle to fn 38
> at all (moved to fn 1, plain damage). Treat the Charge Rifle rows in the two tables just below as
> historical only — §2.2 carries the current numbers.

Four corrections, in descending order of how much they matter.

**1. §2's balance table is computed on raw `t5`, and five weapons do not deal `t5` — on a HEADSET
hit.** The table MC actually pushes assigns **multiplier functions** to two of the three subtypes in
use — `<0,1>` → fn 36 (**×1.25**) and `<0,3>` → fn 37 (**×2**) **[two-sided map]**. Every weapon whose
captured `t4` is 1 or 3 therefore lands more than its `t5` on the headset; on the GUN BODY every one
of them lands exactly `t5` (×1), same as any other row (bench 2026-09-11).

⚠ The ×1.25/×2 columns below are the HEADSET reading at `t7=50` (the MC-compiled `$GSET
criticalShotModifier` default); a gun-body hit is ×1 on all three functions (`compile.headset_multiplier()`).

| weapon | t3,t4 | `$SIR` fn | multiplier | t5 | effective | htk shipped | htk real | TTK shipped | **TTK real** |
|---|---|---|---|---|---|---|---|---|---|
| Assault Rifle | 0,0 | 1 | standard | 9 | 9 | 13 | 13 | 2.28 | **2.28** |
| Burst Rifle | 0,3 | 37 | **x2** | 9 | 18 | 13 | 7 | 1.70 | **0.85** ⚠ |
| Force Rifle | 0,1 | 36 | **x1.25** | 10 | 12 (floor) | 12 | 10 | 1.65 | **1.35** ⚠ |
| Bolt Rifle | 0,3 | 37 | **x2** | 13 | 26 | 9 | 5 | 1.80 | **0.90** ⚠ |
| SMG | 0,0 | 1 | standard | 8 | 8 | 15 | 15 | 1.96 | **1.96** |
| Shotgun | 0,0 | 1 | standard | 45 | 45 | 3 | 3 | 1.60 | **1.60** |
| Stinger | 0,0 | 1 | standard | 15 | 15 | 8 | 8 | 1.75 | **1.75** |
| Sniper Rifle | 0,1 | 36 | **x1.25** | 60 | 75 | 2 | 2 | 1.50 | **1.50** |
| Plasma Sniper | 0,0 | 1 | standard | 25 | 25 | 5 | 5 | 1.60 | **1.60** |
| AMR | 0,3 | 37 | **x2** | 24 | 48 | 5 | 3 | 1.60 | **0.80** ⚠ |
| Suppressor | 0,0 | 1 | standard | 8 | 8 | 15 | 15 | 2.24 | **2.24** |
| Energy Rifle | 0,0 | 1 | standard | 9 | 9 | 13 | 13 | 2.40 | **2.40** |
| Charge Rifle | 8,0 | 38 | standard | 100 | 100 | 2 | 2 | 2.50 | **2.50** |
| Rocket Launcher | 10,0 | 1 | standard | 115 | 115 | 1 | 1 | 0.00 | **0.00** |
| Rail Gun | 6,0 | 1 | standard | 115 | 115 | 1 | 1 | 1.20 | **1.20** |
| Laser Cannon | 0,0 | 1 | standard | 115 | 115 | 1 | 1 | 1.50 | **1.50** |
| Energy Launcher | 9,3 | 24 | **landed 0 — mechanism open** | 115 | — | 1 | — | 0.00 | **never kills** |
| Ion Sniper | 0,0 | 1 | standard | 115 | 115 | 1 | 1 | 0.00 | **0.00** |

**Four weapons fall out of the 1.5–3.5 s band once the multiplier is applied**, and the Energy
Launcher's cell `<9,3>` maps to **fn 24, which landed nothing on that key**, so as shipped it
**does no damage at all**. The `htk`/`ttk_ms` fields in `weapons.json` and the band/dominance test in
`test_mc_compile.py` all use raw `t5` and are wrong for those five rows.

**✅ CONFIRMED 2026-09-02 — this table stands.** It was taken through the real shipped `_SIR_TABLE`,
one IR word per row, three trials each, `hits == 1` verified, with a trailing known-good control
(experiment-log 2026-08-26), and it has since been reproduced independently: **16 trials, magnitudes
20/40/9/7, 8 different `$SIR` row-tail shapes, an fn 1 control on subtype 0 in every trial**
(`brx-protocol.md` §5). The rule is **fn 36 = floor(magnitude × 1.25)** and **fn 37 = magnitude × 2**;
the ×1.25 **truncates** (7 → 8, not 9), which is why the Force Rifle's 10 lands as 12, not 12.5. Row
tails do **not** gate the multiplier: `0,0,1,,` / `,,,,` / `0,0,0,,` / `0,0,2,,` / `0,1,1,,` / none /
`0,0,1,60` all produced ×1.25 and ×2.

✅ **RESOLVED 2026-09-11 (bench, F23): the 2026-08-27 ×1.0 matrix and the 2026-09-02 ×1.25/×2 reading
were BOTH correct — they measured different sensors, and neither was outvoted.** Everything in the
function map above was measured at the gun-body sensor (`$HIR` tok1 = 4, 20/20 at ~40 cm), which is
always ×1 for fn 1/36/37 alike; the 2026-09-02 reading was taken on the headset (sensor 0) at the
MC-compiled `t7=50`. A same-night sweep on gun Tactix-3D4F fired the same word sets at both sensors and at
`t7` = 0/50/100: the body held ×1 throughout every `t7`, and the headset scaled with `t7` exactly as
`fn 36 -> 1+t7/200`, `fn 37 -> 1+2·t7/100` predicts — a `t7=0` closing control on fn 37 read the
headset back to ×1, isolating `t7` (not the function alone) as the driver. The emitter is
function-agnostic (a fn 1 control read 20 while fn 37 read 40 in the same run), so the scaling
happens inside the gun, gated on which sensor caught the hit. The single non-reproduction of fn 24
dealing damage on protocol 7 is unrelated to this and stays open. The full narrative, including the
held-gun hypothesis that is no longer needed, is in the experiment log
(`docs/experiment-log/2026-09.md`, 2026-09-11 bench).

> **Method rule: record the protocol, the `$HIR` token 1, and the firing range beside every pool
> measurement.** All three started as unstated conditions discovered after the fact and each cost a re-run.
> The default question for any new claim is "under what conditions is this true?", asked at capture time.

| shipped row | function | magnitude 20 lands as (gun body / headset at t7=50) | weapons on that key |
|---|---|---|---|
| `<0,0>` | 1 | **20** (×1) / **20** (×1) | the other 12 weapons |
| `<0,1>` | 36 | **20** (×1) / **25** (floor ×1.25) | Force Rifle, Sniper Rifle |
| `<0,3>` | 37 | **20** (×1) / **40** (×2) | Burst Rifle, Bolt Rifle, AMR |
| `<8,0>` | 38 | **20** (×1) | Charge Rifle |
| `<6,0>` | 1 | **20** (×1) | Rail Gun |
| `<9,3>` | 24 | **0 — no damage at all** | **Energy Launcher** |

The multipliers behave identically through the shipped rows as through the synthetic protocol-5 row
they were first measured on, so the table above is the effective-damage table for the shipped game —
gated on which sensor caught the hit, per the resolution above.

> ⚠ **A measurement artifact worth remembering.** The first pass read the Burst Rifle as unaffected.
> It was not — the trial had counted *registered hits* rather than per-hit damage, and a ×2 multiplier
> is indistinguishable from two registered hits unless you check `hits == 1`. Bolt and AMR registered
> twice and looked wrong; Burst registered once and looked fine. Same bug, opposite appearance.

**Two fixes, and they are not independent.**

1. **Flatten `_SIR_TABLE` to fn 1** everywhere and make multipliers an explicit opt-in per-game
   modifier. This also fixes the Energy Launcher for free, since `<9,3>` would become a damage row.
2. **Retune `t5`** for the five multiplied weapons and separately move the Energy Launcher off `<9,3>`
   (an `overrides` entry on `t3`/`t4`), or change that row's function.

**The multipliers are real (U10, 2026-09-02), so this decision is live, and the recommendation is flatten**, and the deciding argument is
asymmetry: flattening restores exactly the §2 numbers, which are *already* band-checked and
dominance-checked, so it costs **zero retune**.
Retuning means recomputing five weapons and re-running the dominance check with multipliers folded in —
and leaves a weapon's real damage depending on *the other player's* config, which is a nasty class of
bug and invisible to every balance tool we have (`htk`, `ttk_ms` and the band/dominance tests all
compute on raw `t5`).

**Not applied here.** The Energy Launcher is a bug and must be fixed either way; *which* fix is right
depends on the flatten decision, so doing it now risks doing it twice. Tony's call — the numbers are
in.

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

Five levers that did not exist in the model above.

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
**Category 10 "Stun" remains UNBUILT**: no `$SIR` function has produced a stun, `$STUN`-over-BLE is a no-op, and
the live lead is to capture the native Sentinel EMP ability (U11′). The 2026-08-26 "fn 23 is an EMP / weapon
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
  > ⚠️ Note this list is no longer a "status function" list: **24, 25, 26 and 27 were later found to
  > deal damage on protocol 7**, having moved no pool on protocol 5. The DoT negative is unaffected —
  > none of them ticked — but do not read membership here as "inert".

### 6.3b Damage over time: the axis the catalogue does not have (S16)

Tony, 2026-09-17: "we don't have any damage over time weapons, like a poison gun". Correct, and the
mechanism for one has been unblocked since 2026-09-09. Nothing in the 22-weapon catalogue ticks.

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
bench fires single fn-24 shots and counts the ticks. There is a live reason to run that test anyway:
`$SIR,9,3,,24` is the **Energy Launcher** row, and MC ships it in every game
(`gameconfig._SIR_TABLE`), so a weapon we already list may be ticking victims a few seconds after every
hit, and nobody has ever watched for it.

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

§6.3 proves five levers. The 22-weapon catalogue uses one of them (armour piercing, on the AMR and the
Rail Gun). These are the weapons the other levers already allow. None needs firmware, and each names
the one thing it waits on.

| archetype | what the player does | mechanism | waits on |
|---|---|---|---|
| **Toxin Rifle** | tag someone and they keep losing health after you break contact | node tick clock on `$LIFE` negatives, keyed to the `$WEAP` t3 damage type echoed in `$HIR` token 2 (the enum already has 11 = gas) | S16: the node behaviour is specified (`spec/node.md` §3.17); what is left is kill credit for a lethal tick, then the code |
| **Medic gun** | heal a teammate by tagging them | `$SIR` fn 10, 9 or 14, by overflow flavour. The firmware enforces "allies only" by itself: a heal fired at an enemy is silently dropped | per-player `$SIR` keys, and a decision about whether a healer belongs in a team of eight |
| **Flux beam** | one weapon that heals a friend and hurts an enemy, decided by who you point it at | ONE `$SIR` row: fn 16, 17, 20, 21 or 22 are dual-polarity. No host logic at all | the same per-player key work, plus a damage number that is fair in both directions |
| **Jammer** | win a fight without taking any health | `$SIR` fn 23 silences the victim's gun and forces its live accuracy to zero for 6 to 8 s, while it keeps firing and emitting | F66: the silence was heard by ear and the number cited as proof was the accuracy field, so the mechanism is unconfirmed |
| **Crit weapon** | a shot that sometimes hits much harder | the IR crit bit is proven at x1.5 and echoes on `$HIR` token 6. `$WEAP` t6 (`primaryCritChance`) reads 0 on every stock weapon | F62, measured in `bench-perks-2026-09-18.md` §1: can a tagger roll its own crit, or is the bit emitter-only? |

Two cautions carry over from §6.2. A `$SIR` table is **game-wide**, so any archetype that needs its own
function needs per-player keys before it can ship beside the others. And a victim-side multiplier is
invisible at the weapon, so a weapon built on one reads as balanced in `weapons.json` and plays as
something else entirely.

### 6.3d ⚠️ This document's reserve columns are unproven (F253)

`resolve()` writes the catalogue's `reserve` to **t17** and `reserve // 2` to **t40**, which keeps
Battle Company's own captured invariant `t17 == 2 * t40`. F207 (field, 2026-09-13) proved the gun's
reported reserve mirrors **t40**, on three weapons and six acknowledgements. So the Assault Rifle's
catalogue `reserve: 192` reaches a gun as **t17 192 / t40 96**, and `spawn_ammo()` tells the phone
**192** at spawn. Those two disagree by construction, whatever the gun turns out to spend, and one of
them is wrong. That part is a display bug in MC, not a balance question.

**Scope.** The columns in doubt are the ones in THIS document: reserve, sustained fire, and anything
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
as a broken tagger. The node can detect it with no new wire support, because `$ALCD` already carries
the accuracy token: a `$HIR` that moves no pool plus live accuracy at 0. That is **S53**.

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
a table we wrote at game start. The practical consequence for this document is that **§2's single-axis
balance (damage × cadence × ammo) is now the *floor* of the design, not its ceiling**, and the next
rebalance should treat the `$SIR` table as a first-class part of a weapon's definition rather than a
fixed backdrop.

---

## 7. The triangle, and what belongs in which slot

Written 2026-09-18, after the bench turned four `$SIR` functions from guesses into measurements. Tony's
brief: "lets be thorough and balance and placement and rock paper scissor". This section is the answer,
and every number in it comes from a `$HP` delta.

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
| 32.4 to 38 kHz | inside the pass-band | Sniper 100, AMR and Charge 85, AR and Burst 70, Suppressor and Energy Rifle 55 | **seven weapons, all inside the receiver's window.** "Sniper 100 versus Suppressor 55" is probably not a difference a player can feel |
| 28.25 to 29.25 kHz | on the knee | SMG, Breacher and Haze 30, Shotgun and the heavies 22 | **six weapons in the steep region**, where sunlight, angle and reflection dominate and behaviour is unstable |

That is the worst of both: the long weapons are undifferentiated and the short ones are erratic. It also
means **range may not be a usable balance axis in the direction we assumed** — you can make a weapon
short by detuning it, but you cannot make a sniper reach further than an assault rifle, because both are
already inside the window.

**So calibration changes.** S49 was going to walk a portable receiver out and read metres per `t2` value.
The right experiment is now to measure the **receiver's response curve in kHz**, once, and then pick each
weapon's value from that curve. Values above the knee barely move, so the whole design question is which
weapons sit below it and by how much.

### 7.0 ⚠️ Three weapons fire TWO words per trigger pull, and one of them is 70

Named 2026-09-18 from Battle Company's own weapon sheets, via the LaserTagMods material. **`t1` is
`WeaponIRSource`**: 0 gun laser, 1 headset only, **2 gun AND headset**, 3 double gun, 4 double gun plus
headset, 5 dry fire. Exactly three stock weapons set 2, and for those **`t12` is a second word's damage**
with `t13`/`t42` its outdoor/indoor reach.

| weapon | gun laser (`t5`, range `t2`) | headset word (`t12`, range `t13`/`t42`) |
|---|---|---|
| Shotgun | 45 | **70** |
| Rocket Launcher | 115 | **115** |
| Plasma Sniper | 25 | **80** |

**It is the SHOOTER's headset that emits**, not the victim's that receives a bonus. Three things agree:
`t1` names an IR *source*; V4_30 builds an `$IRTX` frame and sends it to the gun's own headset to emit;
and the community scoring readme says a swap-in headset lacking the high-power LED "means no shotguns,
melee, explosions", which is a statement about the shooter's hardware. `t37`/`t38`
(`HeadsetDirection`/`HeadsetRepeat`) probably steer that word and set how many times it repeats.

**So one Shotgun pull may put two words in the air**, at 45 and at 70, with different ranges. A victim
can take either, or **both**. And 45 + 70 is **115**, which is exactly the standard pool: if both words
reach the same person, a single trigger pull kills them outright.

Our catalogue models one word of 45 and a ladder position of 3 hits at 1.60 s. Every bench run we have
done would have missed the second word, because at a bench the operator holds both guns and shoots a
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

⚠️ **Which emitter sent which word: SOURCED, not settled, 2026-09-18 (LaserTagMods, Jay).** One expert
statement, credited per this repo's hard rule on protocol discovery: "it actually is both ... so
there is a dual emitter fire. one from tagger, weaker damage and one from headset, greater damage." Read onto the cap30
capture that means the gun sent the 45 and the headset the 70. The capture ITSELF cannot show which
emitter fired which word, so this stays sourced until a bench covers one emitter at a time (F254's own
run does it for free). Our compiled Shotgun does NOT
mirror Callsign's own 45/70 split: it ships `wire.dmg` 20 and `wire.headset_dmg` 20 (40 together, a
3-pull kill at the weapon's existing 800 ms cycle, so no other weapon on the ladder moves), and locks
`t13`/`t42` (the headset word's own reach) at 100, the flat measured shelf of the range curve below, so
both words land at every range this game is played at. The band where the headset word would instead
cut out at short range (F231's unstable 13-26 transition) is still unmeasured for `t13` specifically.
See `docs/FOLLOWUPS.md` F71.

**What this means for range.** Callsign never shortens the Shotgun: its frame carries `t2` = 100, the
same as every Callsign gun. What varies with distance is only the 70-damage headset word, through
`t13` 80 outdoors and `t42` 30 indoors (35.5 and 29.25 kHz IF §6.5's formula extends to them -- ⚠️ it was
derived for `t2`/`t41`, the GUN word, and has never been checked against the headset word). So Callsign's Shotgun is
"45 at any range, 115 up close", not "short range". That is a better shape than our `t2` = 22, which
puts the Shotgun's only word on the unstable knee of the receiver curve.

### 7.1 There are only four ways to take someone down

| way | mechanism | what it is good against | what it is bad against |
|---|---|---|---|
| **Plain damage** | fn 1: drains shield, then armour, then health | a bare target: nothing is faster | anything wearing a big pool |
| **Armour piercing** | fn 2 or 6: straight to health, ignores armour | a heavily armoured target | a bare target, because its damage has to be cut |
| **Stripping** | fn 20: removes every protective layer and CANNOT kill | a big pool, with a teammate to finish | a bare target: it does literally nothing |
| **Denial** | fn 23: the target's accuracy falls to 0 for about 3 s | anyone who has to aim | anyone who simply walks away |

A fifth, **damage over time**, is node-driven and not built (S16). It is the answer to walking away,
which is what makes it the natural counter to denial.

### 7.2 The triangle, in seconds

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

Declared 2026-09-18, **hidden until the node tick clock exists** (S16). The gun lands the direct hit
today; the poison is a clock on the victim's own phone, and nothing on the wire can tick, because the
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

⚠️ It stays `hidden` until `spec/node.md` §3.17 is built. Enabled early it is simply a worse SMG, and
`caution` on the row says so.

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
| SMG | 8 at 95 ms | 5 at 184 ms | 0.14 s slower |
| Shotgun | 45 at 800 ms | 15 at 1000 ms | 0.40 s slower |
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

`resolve()` writes exactly these and nothing else. Doc `tokN` == `frame.split(",")[N+1]`.

| token | field | written? |
|---|---|---|
| `t0` | slot | ✅ set per call |
| `t5` | damage | ✅ when `wire.dmg` is present |
| `t14` | fire interval / charge time | ✅ when `wire.fire_ms` is present |
| `t16` / `t39` | max clip / clip start | ✅ always, kept equal |
| `t17` / `t40` | reserve / reserve-half | ✅ always, kept at `t17 == 2 × t40` |
| `t18` | reload ms | ✅ always |
| `t15` | the constant **850** in every captured frame | ❌ **never** — unidentified |
| `t3` `t4` | the **`$SIR` composite key** — selects the victim-side effect, including multipliers (§6) | ❌ inherited from the capture |
| `t19` `t20` `t23` `t24` `t25` `t26` `t27–36` `t41` `t42` | reload type, **fire mode**, burst, overheat, muzzle flash, all sounds, ranges | ❌ inherited from the capture |
| declared `overrides` | one named token per entry, with a stated reason (§3.2) | ✅ where declared |
| `t7–t13` | secondary fire | ❌ empty on all twenty stock weapons — no BRX weapon has an alt-fire |
