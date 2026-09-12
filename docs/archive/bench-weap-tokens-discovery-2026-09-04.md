# `$WEAP` blind tokens: discovery before the bench (2026-09-04)

Four research lenses ran in parallel over everything we hold before spending bench time on the
tokens listed at the end of this file (carried in from the 2026-09-04 plan sheet that proved tok15 = swap delay, now `docs/archive/bench-weap-tokens-2026-09-04.md`):

- **APK** — the Callsign IL2CPP teardown (`protocol/callsign-extract/`): field names in declaration
  order, enum member lists. No types, no defaults, no UI; weapon data is server-fetched so no APK
  file carries a preset value.
- **Wire** — all 78 real `$WEAP` frames in `protocol/captures/` (23 btsnoop + 10 transcripts) and
  the 21 `capture.frame`s in `weapons.json`, plus every `$HIR`/`$GSET` in the combat captures.
- **Community + vendor** — LaserTagMods' JEDGE source (124 literal `$WEAP` frames tabulated), the
  Battle Rifle Pro instruction PDF, battlecompany.com, the BRX manual mirrors, the App Store notes.
- **IR link + instruments** — `protocol/brx-ir-protocol.md`, the ESP32 rig's real capabilities,
  the extended user guide.

Token numbering is the doc's: `$WEAP,<t0 slot>,<t1>,…`; `frame.split(',')[N+1]` is tok N.

## Two corrections to the earlier plan

1. **t19 = 2 is the SHOTGUN (T01), not the Plasma Sniper.** The Plasma Sniper's `2` sits at t1
   (iRSource). Our manual (`dev.md`) already had this right.
2. **The arming block in the plan uses `$GSET,0,1,…` = outdoor profile; the golden bundle (and the
   actual tok15 bench) used `$GSET,0,0,…` = indoor.** Every Callsign capture we hold is indoor
   (28/28 `$GSET` frames). A t41 sweep under the outdoor profile would test the inert pair. Range
   tests below are a 2×2 against `$GSET` t2 for exactly this reason.

## What the IR word can and cannot say (this bounds every hypothesis)

25 bits, fully accounted for: protocol (= t3, echoed `$HIR` tok2) · player id · team · **magnitude
(= t5, `$HIR` tok5)** · **one crit bit (`$HIR` tok6)** · subtype (= t4, `$HIR` tok7) · 2-bit trailer.
**No spare bits.** So:

- a **crit** is expressible and already proven both ways on the bench (emitting C=1 → `$HIR …,1,…`
  and damage × (1 + `$GSET` t7/100)); stock weapons always emit C=0. A crit-chance token can only be
  a **shooter-side per-shot roll that sets C**.
- a **miss cannot be flagged**. It can only be: no word, a spoiled word (bad trailer / no sync — both
  proven rejected), or **magnitude 0**. The receiver in RAW mode distinguishes all three.
- **range is not in the word** and the VS1838B rig cannot measure intensity, only decode at a
  distance / through an attenuator / off-axis, and every mark/space duration in RAW mode.

Consequence: every token below except t19 must act on the shooter's **emission** (crit bit, D=0
misses, power) or on nothing. None can be a victim-side filter.

## The tokens

### t6 = `primaryCriticalChance` — confidence HIGH, cheapest test, do first

- APK: the name. `$GSET` t7 (`criticalShotModifier`, %) is bench-proven as the multiplier on a
  crit hit; `$PSET` criticalDamageBonus is inert.
- Wire: t6 = 0 on all 78 frames; `$HIR` tok6 = 0 on all 23 captured hits. Never exercised by Callsign.
- **Community (decisive):** JEDGE's "Respawn" special weapon ships `$WEAP,6,1,90,15,0,6,100,…`
  (t6 = 100) and its receiver identifies a respawn tag by `$HIR` tok2 == 15 **and tok6 == 1**.
  LaserTagMods depend on t6 = 100 forcing the crit bit on every shot, in the field, on 45-gun events.
  Jay: "space 6 is 'is critical' — a damage multiplier would apply, rare". Battle Company sells a
  "Critical Strike" perk as DLC.
- Hypothesis: percent chance per shot that the word carries C = 1; multiplier from `$GSET` t7.

**Bench (10 min).** AR base frame, victim with the full `$SIR` table, `$PSET` armour 200, `$GSET`
t7 = 100 so a crit exactly doubles. Runs: t6 = 0 (control) → 100 → 50 → 0 (closing control), 10
single pulls each (20 at 50). Read: rig C bit per word; victim `$HIR` tok6 and applied damage (9 vs
18). True: 100 → 10/10 crits; 50 → 6–14 of 20; 0 → 0/10. If 100 gives 0 crits try 1 and 255 before
calling it inert (0–1 or 0–255 scale).

### t21 / t22 = `maxAccuracy` / `singleShotAccuracy` — confidence MEDIUM on mechanism, LOW on which is which

- APK: names only.
- **Vendor text exists for the feature.** The extended user guide describes a simulated-recoil
  model: rapid fire drifts accuracy toward a minimum, **a miss still reaches the enemy — headset
  lights, "zip" sound, 0 damage** — every gun has a minimum accuracy, fire in bursts. The printed BRX
  manual gives two accuracy numbers per stock weapon (M-4 96/91, SMG 96/88, MG-7 66/45, SR-100
  100/90, TAC-87 95/80). The victim side has a `missShothit` sound slot in `$PSET` and
  MissBullet / ArrowMiss in the bank.
- Wire: 100/100 on every frame we and JEDGE have ever sent. **The model is dormant in app play.**
  No capture holds both sides of a fight, so misses are invisible in our data.
- IR: a miss must travel as **magnitude 0** (or not at all). Hypothesis: t21 = the ceiling the recoil
  model recovers to, t22 = the per-shot / first-shot chance; stock 100/100 disables it.

**Bench (15 min), the three-count design.** Extreme first: t22 = 0, then t21 = 0, then t22 = 50,
control 100/100 between. 10 pulls each, log three counts per run: pulls (`$ALCD` mag), words on the
rig (RAW: length, trailer, magnitude), victim `$HIR` with tok5. Readings: 10 pulls / 0 words →
shooter suppresses emission; 10 words with mag 0 → the D=0 miss (listen for the zip on the victim);
10 clean words + 10 `$HIR` at 9 → inert. Then t22 = 0 under t20 = 0 (auto) vs t20 = 7 (single) to
split "max" from "single-shot". Design value: accuracy perks and debuffs, a "jammed" status.

### t2 / t41 = `gunRangeOutdoor` / `gunRangeIndoor` — confidence HIGH on identity, MEDIUM on mechanism

- APK: the declared order is `slotType, iRSource, gunRangeOutdoor, primaryDamageType …` and ends
  `… ammoReserv, gunRangeIndoor, extraHeadsetRangeIndoor`. The "(scale/enable const)" label on t2 is
  a leftover of the two-frame diff. `$GSET` t2 `outdoorMode` "selects the indoor(0)/outdoor(1)
  profile".
- Wire: t2 = 100 on every gun, **90 on melee**; t41 = 75 on every gun, **20 on melee** — the same
  shape as the headset pair t13/t42 (80 / 30–40 on the three headset-emitting weapons). Every
  capture is indoor, so **t2 has never been exercised on the wire**. `$HIR` carries nothing range-like.
- Vendor (decisive on the feature): the Battle Rifle Pro manual has **"[Shot Range] adjusts the
  distance a weapon can fire: 5, 10, 20 … 100 %"** with defaults Shotgun 20, SMG 40, Battle Rifle 60,
  HMG 70, Cannon 80, Sniper 100. battlecompany.com: "range values can be scaled up and down to fit
  your battlefield". JEDGE ships 75 on normal weapons, 30 on melee variants, 20 on its
  respawn/medic/shield specials — deliberately short-range effects.
- Earlier bench: one positive (t41 = 100 sniper killed from max indoor distance); the t41 = 5 zeros
  were contaminated by rig degradation (U2 stays open). `$GSET` t2 did not change RECEIVE sensitivity,
  consistent with range being emit power.
- Hypothesis: t41 = indoor emit range %, t2 = outdoor emit range %, `$GSET` t2 picks which is live.
  Unknown: LED drive vs pulse count/width (RAW durations will tell).

**Bench (25 min), 2×2 against `$GSET` t2.** Receiver at 6 ft for the fast pass, victim `$HIR` for
game truth, 10 shots per cell. Positive control: t41 = 75 / t2 = 100 under outdoor = 0 and = 1
(10/10 both). Then t41 = 5 @ outdoor 0 (extreme; should die at 6 ft), t2 = 5 @ outdoor 1, then the
crossed cells (t41 = 5 @ outdoor 1, t2 = 5 @ outdoor 0 — expected inert if the profile hypothesis
holds), closing control. If 6 ft does not discriminate: tissue-layer attenuator ladder over the dome
until the control drops to ~50 %, then swap tokens at that layer count. Diff RAW mark/space between
75 and 5 (power vs timing). Keep lighting constant — the manual says light changes range. Closes U2
and Q15 (sub-indoor power for small venues).

### t19 = `reloadType` — confidence HIGH; the wire already proves it

- APK enum: Magazine 0, Quiver 1, Shells 2, SingleBolt 3, BoltWithMagazine 4, AutoReload 5.
- **Wire (proof):** the Shotgun (t19 = 2, t18 = 400) reloads shell by shell: after `$BUT,2,1` the
  `$ALCD` mag climbs 1→2→…→6 at 417/423/390/420/420 ms per shell, reserve decremented per shell
  (`2026-08-26-weapons-sniper.btsnoop`, again in `solo-game-full-arm`). Magazine weapons emit ONE
  `$ALCD` after t18 (AR 1557 ms for t18 = 1400). So **t19 = 2 → per-shell reload with t18 as the
  per-shell interval.** Melee carries t19 = 10 (outside the enum).
- Community: JEDGE's "unlimited rounds" ammo mode rewrites every weapon to **t19 = 10, t17 = 0**
  (voice line "Unlimited"); its medic/shield/armour specials are t19 = 10, t18 = 0. Jay's comment:
  "maybe 10 is for unlimited". Earlier bench: t19 = 5 (AutoReload) did nothing on an empty mag.
- Hypothesis: 0 magazine, 2 shells, **10 = no reload / bottomless** (a real design lever: an
  "infinite ammo" mode without touching the reserve).

**Bench (8 min).** AR with t19 = 2 only: expect 32 `$ALCD` frames ~1400 ms apart on a reload (or
~400 ms with t18 = 400); pull the trigger mid-reload to see whether it is interruptible. Then AR with
t19 = 10 and t17 = 0: fire past 32 rounds without touching the handle — does the mag never decrement,
or refill itself? Values 1/3/4 only if time allows.

### t7–t11 (+ t30) = the secondary-fire block — confidence LOW, last

- APK names: secondaryFireChance, secondaryDamageType, secondaryPowerType, secondaryDamage,
  secondaryCriticalChance; t30 = secondary_Mix_SoundName. t8 mirrors t3 (the DamageType enum = IR
  protocol: rocket 10, rail 6, launcher 9, gas 11, melee 13); t9 mirrors t4, which on the wire is
  the `$SIR` subtype (the "powerType" name is wrong on the wire). GunWeaponType has no secondary
  member and `$GSET` t6 "secondaryBluetoothWeapons" is a separate accessory concept, so "fireChance"
  reads as a **per-shot proc probability**, not an ALT-fire mode.
- Wire + community: empty on all 78 of ours and all 124 of JEDGE's. Nothing external. The vendor's
  "secondary weapon" is the second SLOT, not this block.
- Hypothesis: with t7 = 100 each pull emits an extra or replacement word with B = t8, U = t9, D = t10.
  If real: random-proc weapons (a 10 % stun on hit). If dormant: a clean "never".

**Bench (12 min).** AR with t7 = 100, **t8 = 10 and t9 = 10** (so either alignment lands on protocol
10, which the victim's rocket `$SIR,10,…` row accepts), t10 = 50, t11 = 0, t30 = a distinct sound.
Expect words with proto 10 / mag 50 and `$HIR,…,10,…,50`; then t7 = 50 (mixture) and t7 = 0
(control). Also ALT on a one-slot gun with t7 = 0 to rule out "secondary = alt-fire". t30 is the ear
on the same run.

## ⭐ Not a token, but the wire says it: applied damage depends on the SENSOR

`2026-08-23-ios-callsign-two-tagger-combat.txt`, one Burst Rifle shooter (t5 = 9, subtype 3 → fn 37),
crit 0 on all 23 hits, same victim, same life: the **3 hits on headset sensor 0 took 18 each**
(armour 70→52→34→16); the **20 hits on gun-body sensor 4 took 9 each**. This is the unresolved
fn 36/37 "×1.0 vs ×2" dispute: the 2026-08-27 ×1.0 matrix was measured with the rig pinned to the
gun body (20/20 tok1 = 4); the 2026-09-02 ×2 result was Tony firing, sensor not recorded. The 09-02
log entry calls the sensor hypothesis "unsupported" — this capture contradicts that.

**Why it matters more than any token above:** hits-to-kill in the catalog, the compiler's mag ≥ htk
gate and the HUD's HITS TO KILL number all assume one multiplier per weapon. If body hits are ×1 and
headset hits ×2, a body-shot kill takes twice the rounds we print.

**Bench (10 min), do it the same session:** fn 37 row, one magnitude, armour 200, 5 shots aimed at
a headset dome, 5 at the gun body, log `$HIR` tok1 with each `$HP` delta. Then fn 36 (×1.25 claim)
the same way.

## Order at the bench (~80 min + pre-flight)

Pre-flight: kill stale `brx_mcp`, `loopback.py`, `range_step.py` at 3 ft; receiver ~3 ft from the
muzzle on a soft background, `native_capture.py` with RAW on (F12 fragments stitched host-side);
emitter board B ≤ 6 ft. Shooter Tactix-9498, victim Tactix-3D4F or Tactix-E20D. Base frame = the AR line in the plan
doc, ONE token changed per run; victim armed from the golden head (full `$SIR`, `$PSET` armour 200,
`$GSET` t7 = 100). Controls before results, extreme before subtle, closing control on every set.

1. **Sensor damage** (headset vs body, fn 37 then fn 36) — 10 min — corrects the damage model.
2. **t6 crit** — 10 min — feeds crit perks directly; JEDGE says it works.
3. **t21/t22 accuracy** — 15 min — three-count design decides the mechanism in one pass.
4. **t41 × t2 × `$GSET` t2** — 25 min — closes U2/Q15 and the indoor/outdoor question.
5. **t19** — 8 min — confirm shells on the AR and the t19 = 10 bottomless mode.
6. **t7–t11 + t30** — 12 min — proc weapons or a clean dormant.
7. **F16 · reload timing per weapon** (5 min, same arming): pull the handle on each weapon, time `$BUT,2,1` → the
   `$ALCD` refill, and correct `weapons.json` `reload_ms` where the gun disagrees — the RELOADING takeover runs
   for the catalog value.
8. **F15 · accuracy attribution** (two guns, ten shots): confirm `$HIR` tok3 → `player_num` so the ACCURACY tile
   can be trusted.

Every result goes into `docs/experiment-log.md`, then the token table in
`protocol/callsign-extract/protocol-classes.md` and `docs/manual/dev.md`.

## External references worth keeping

- Battle Rifle Pro instructions (same vendor firmware family; Shot Range %, unlimited mags/rounds,
  RPM, overheat): https://lasertagpro.com/wp-content/uploads/2014/11/Battle-Rifle-Pro-Instructions.pdf
- battlecompany.com equipment page (range scaling, editable stats): https://battlecompany.com/laser-tag-equipment/
- BRX manual mirror with the accuracy pairs: https://www.readkong.com/page/laser-tag-rifle-battle-company-6612525
- Callsign App Store notes (Critical Strike / Foregrip / Laser Focus perks): https://apps.apple.com/us/app/callsign-live/id1117100222
- JEDGE source (the t6 = 100 respawn weapon, the `$HIR` tok6 receiver check, the three ammo modes):
  https://github.com/LaserTagMods/JEDGE and https://github.com/LaserTagMods/LoRa-Controlled-Taggers

## The blind tokens: sent identical on every weapon, no compile key, no verified meaning

(Carried in from `bench-weap-tokens-2026-09-04.md` on 2026-09-06 when that sheet was archived; the tok15 = swap delay result it held is in `experiment-log.md` 2026-09-04 and `protocol/callsign-extract/protocol-classes.md`.)

| tok | we send | documented guess (APK field order) | cheapest probe |
|---|---|---|---|
| t2 | `100` | **gunRangeOutdoor** (discovery pass: APK field order; melee 90) | 2×2 with t41 against `$GSET` t2 — see the discovery doc |
| t6 | `0` | primaryCriticalChance | send 100: do hits land as crits (bigger `$HIR` dmg / different sound)? |
| t7–t11 | `∅` | the secondary-fire block (fireChance, damageType, powerType, damage, critChance) | empty in every Callsign capture too; fill t7=100,t10=5 and see whether ALT-fire changes behaviour — low priority, ALT is our swap button |
| **t15** | `850` | **weaponSwapDelay — PROVEN 2026-09-04** | done, see Result |
| t21 | `100` | maxAccuracy | send 0 or 50: do shots stop registering / register less? (needs a target gun + the IR rig) |
| t22 | `100` | singleShotAccuracy | same probe as t21, one token at a time |
| t30 | `∅` | secondary mix sound | inert until t7–t11 do something |

Two more that are constant on the wire but are NOT blind: t41 `75` is gun range % (documented, we
never vary it — a range perk would live here), and t19 reloadType is `0` on 20 weapons and `2` on
one (the SHOTGUN's shells — not the Plasma Sniper, corrected by the 2026-09-04 discovery pass) — and the wire already shows the gun honours it: the Shotgun reloads shell by shell, one `$ALCD` per ~400 ms. See `docs/bench-weap-tokens-discovery-2026-09-04.md`.

Everything else we send either varies per weapon under a compile key (t3 t4 t5 t14 t16 t17 t18 t20
t23 t24 t27–t29 t31–t34 t39 t40) or is a per-weapon flag we copy from the capture (t1 t12 t13 t25 t26
t35–t38 t42). Frames are 42 tokens long; there is no t43/t44.
