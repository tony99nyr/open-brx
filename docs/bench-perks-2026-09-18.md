# Bench: crits, anti-armour, and the perk levers (2026-09-18)

About 50 minutes, two guns at the desk, no rig. It answers the questions the perk rework (S50) rests on. It
also answers the one that gates a poison weapon (S16). Every
step follows the method rules learned on 2026-09-17: cover the victim's gun sensor at close range (F228), give the
victim the `$SIR` row for the shooter's damage key, and expect about 3 s between a tool call and the gun.

Volume is `$VOL,65` on both guns. Keep `$GSET` token 2 at `0` (F162). Never end on a bare `$CLEAR` (F11).

## Roles and arming

**A = shooter** (player 1, team 1), **B = victim** (player 2, team 2, 999 HP so nothing dies mid-run).

Victim head, with the rows every step needs:

```
$VOL,65,0,*
$CLEAR,*
$START,*
$GSET,0,0,1,0,1,0,0,1,*
$PSET,2,0,999,0,0,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*
$SIR,0,0,,1,0,0,1,,*
$TID,2,*
```

then the shooter's `$WEAP`, the seven `$BMAP` rows, `$SPAWN,,*`, `$AMMO,0,32,384,1,*`, `$BMAP,0,0,,,,,*`.

## 1. Can a gun roll its own crits? ✅ ANSWERED 2026-09-18 (F62, closed and archived)

**YES, and t6 is a straight percentage the GUN rolls.** t6 = 20 gave 9 crits in 64 hits (14.1%); t6 = 50 gave 54
in 119 (45.4%). A crit is the magnitude **x1.5 truncated** and **`$HIR` token 6 reads 1** on it, so a proc is
visible to the victim's node. Shipped the same day on three weapons (Burst Rifle 40%, AMR 30%, Toxin Rifle 15%,
the last as the poison proc). Do not re-run. Original steps below, kept for method.

The crit bit in the IR word is proven: our own emitter sets it and the victim takes **x1.5** (magnitude 20 landed 30).
What is unknown is whether `$WEAP` **t6** (`primaryCritChance`, the app's name) makes a TAGGER roll it. It reads 0 on
every stock weapon.

Bench AR with `t6 = 20`:
`$WEAP,0,,100,0,0,9,20,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*`

1. Fire **50 single shots** at B's covered headset, about one a second.
2. Read every `$HIR`: the damage field and token 6 (the crit echo).

**Reading.** About 10 hits at 13 or 14 damage (9 x 1.5 truncates) means t6 is a percentage and crits are ours. All 50
at 9 means t6 does nothing, and the crit bit stays an emitter-only trick. Anything in between is a rate to measure: try
`t6 = 50` for a second run and compare the proportion.

**Why it matters:** a crit chance is the cleanest "variance instead of a flat buff" perk we could ship, and it would
also give weapons a proc mechanism (a poison round on 15% of shots, for example).

## 2. Is there a `$SIR` function that hits armour harder? ✅ ANSWERED 2026-09-18 (fn 20 strips armour only; fn 2 and fn 6 go straight to HP; `experiment-log/2026-09.md`, the perks bench entry item 5)

Perks need a counter to Body Armor. Today the only anti-armour tool is a function that bypasses armour entirely
(fn 2 and 6, straight to HP), which is too strong without a large damage cut. A function that damages ARMOUR harder, or
only armour, would be the better mechanism. Several enemy-side rows are unmapped: 24 to 28 and 35 moved no pool on one
protocol and dealt damage on another.

Method, one function at a time, three victim states per function:

| state | victim `$PSET` pools | what to watch |
|---|---|---|
| armour only | 45 HP, 70 armour, 0 shield | does armour fall faster than the magnitude? |
| shield only | 45 HP, 0 armour, 70 shield (grant with `$LIFE,0,0,70,*`) | does the shield fall faster? |
| bare | 45 HP, 0 armour, 0 shield | the control: what the same word does with no layer |

Functions to sweep, in this order: **24, 25, 26, 27, 28, 35**, then **2** and **6** as the known armour-piercing
controls. Point the shooter's damage key at each in turn by changing the VICTIM's row, not the weapon:
`$SIR,0,0,,<fn>,0,0,1,,*`, five shots per state, magnitude 9.

**Reading.** A function that takes more than 9 from armour, or takes from armour while leaving HP alone, is the
anti-armour primitive. A function that takes exactly 9 from whichever layer is outermost is plain damage. Nothing
moving means the row is inert on this protocol, which is also an answer worth writing down.

## 3. Does ONE fn-24 shot tick? ✅ ANSWERED 2026-09-18 (P18, closed): no tick; the native route is UNSETTLED (levers §8)

**NO.** A single fn-24 shot does no damage at all; it only manufactures a phantom hit every 5.07 s. ⚠ **Corrected
the same evening (`experiment-log/2026-09.md`, the drive entry §5):** the endless replay was the fuse re-injecting a
protocol-9 word while `<9,3>` was itself fn 24. With `<9,3>` on fn 1, V4_30 predicts ONE delayed hit, so the native
route is not dead: `bench-firmware-levers-2026-09-19.md` §8 re-times it. Build poison on the node tick clock
(`spec/node.md` §3.17) until then; the proc it wanted arrived the same day from §1's crit result. Do not re-run this
section. Original steps below, kept for method.

Tony 2026-09-17: the catalogue has no damage-over-time weapon. `$SIR` **fn 24** may already be one.
Bench 2026-09-11 saw a victim take 1 to 3 damage ticks, about 420 ms apart, about 4 s after the word,
but that ran against a **repeating** grenade beacon, and a 2026-08-26 sweep that fired each status
function **once** saw no ticks at all in 18 s. One hand-aimed shot settles it.

Keep the victim at 999 HP and 70 armour so a tick has room to land and cannot kill.

1. Give the victim the fn-24 row for the shooter's key: `$SIR,0,0,,24,0,0,1,,*`.
2. Fire **one** shot at the covered gun sensor. Then do not touch the trigger for **20 s**.
3. Log every `$HIR` and every `$HP` with its arrival time.

**Reading.** No pool movement at all in 20 s means fn 24 needs a repeating source and is not a poison
round; the node route (S16, `$LIFE` negatives) is then the only way to build one. Any late tick is the
answer we want: record how many, how large, and the gap between them. Repeat three times, because 1 to
3 ticks per word is a range, not a constant.

4. Then repeat the single shot with `$SIR,0,0,,25,...`, `26` and `27`. They share fn 24's clip and are
   presumed the same family, and none has ever been tested for the tick itself.

**Also worth 2 minutes:** `$SIR,9,3,,24,10,0,,,*` is the **Energy Launcher** row, and **MC ships it in every game**
(`gameconfig._SIR_TABLE`), not just the stock app. Arm
that weapon as it ships, take one hit, and watch the victim's pools for 10 s. If they move late, a
weapon in our own catalogue has been ticking victims all along and nobody watched for it (P18). Then ask the second
question straight away: **can a tick land during spawn protection?** Take the hit, die, respawn, and watch the
pools through the protected window. A tick that arrives after a respawn is a different bug from a tick that
arrives in a fight, and the playtest session owns that window.

## 4. The Charge Rifle's tap cadence ✅ ANSWERED 2026-09-18 (285 ms, not 500 ms; the perks bench entry item 7)

The shipped model assumes **500 ms** between finishing taps, which is a placeholder, not a measurement. It sets the
Charge Rifle's advertised time to kill.

1. Arm A with the Charge Rifle (40/80 cell).
2. Build one full charge, release at B, then tap as fast as you can, five times.
3. Read the `$ALCD` timestamps: the gap between taps is the real cadence.

If it is much faster than 500 ms, the Charge Rifle's kill is quicker than the catalogue claims and the number needs
updating in `weapons.json` and `docs/weapon-design.md`.

## 5. Does a stim-style write survive a reload? ✅ ANSWERED 2026-09-18 (yes: the write applies and the reload still completes; the perks bench entry item 6, S51)

S42's writer refuses to write during a reload, because the one case the 2026-09-17 bench could not place was a write
landing inside one. A stim pack has to revert on a timer, so it will meet that case.

1. Arm A with the bench AR.
2. Fire until the magazine is low, then pull the reload lever and, during the reload, ask for a `$WEAP` with a faster
   cycle plus an `$AMMO` restore.
3. Watch whether the reload completes, and what the magazine reads afterwards.

Run it three times. If the reload survives every time, the writer can relax its guard to a queue rather than a refusal.
If it does not, the stim pack must hold its revert until the reload finishes, which is a design constraint worth
knowing before it is built.

## 6. How many spare rounds does a gun ACTUALLY carry? ✅ ANSWERED 2026-09-18 (F255)

**Do not run this rung.** `$AMMO,0,32,192` rides `frames.spawn` AND `frames.revive`, so the gun is set to the full catalogue reserve at every spawn and the HUD agrees with it; the halved `t40` is live only in the ~200 ms between the `$WEAP` and the `$SPAWN`. The player carries the catalogue number, the HUD is right, and there is
nothing to count. Kept for the reasoning below, which is the trap: a value on the wire is not a value in play until
you check what overwrites it.

`resolve()` writes the catalogue's `reserve` to **t17** and half of it to **t40**, keeping Battle
Company's own captured invariant. F207 proved the gun's reported reserve mirrors **t40**. So the
Assault Rifle's catalogue says 192, the HUD tells the player 192, and the gun reports 96. One of those
is the number of rounds the player can really fire. Counting settles it, and nothing else will.

1. Arm A with the bench AR: mag 32, catalogue reserve 192.
2. Fire the magazine dry, pull the lever, repeat until the gun refuses to refill.
3. Count the FULL magazines the reserve paid for, and read the last `$ALCD` reserve.

**Reading.** Six full refills (192 rounds) means the gun spends t17, and only MC's reporting is wrong.
Three refills (96) means the gun spends t40 and an Open BRX player carries half of what the catalogue
intends, which also makes the Assault Rifle row's "17 kills without resupply" wrong, since that assumes
192. Worth knowing either way: Callsign's own captured frame gives the stock Assault Rifle `t17 384 /
t40 192`, so a stock player carries 192, and the catalogue's `reserve: 192` is exactly that carry.

Do not change the wire before this count. Doubling t40 doubles what every player carries in every
match, which is a balance decision, not a bug fix.

## 7. Two items handed back by the playtest session ✅ ANSWERED 2026-09-18 (the Charge Rifle ships `D11`; the reload "timeout" was a tap, which does nothing on an energy weapon; the perks bench entry item 8, F246)

1. **The Charge Rifle's overheat sound is wrong.** Its captured `t35` is `C19`, and Tony judged `C19` by ear on
   2026-09-17 as the sound a charge makes when you release it early, not an overheat. The Energy Rifle now uses `D11`
   (the SMG's captured overheat sound, ear-confirmed on a real overheat). Overheat the Charge Rifle twice: once as it
   ships, once with `t35 = D11`, and pick. If neither fits, the next candidates are the other `D` mechanical run.
2. **An energy-weapon reload timeout**, seen on the playtest branch at 14:51: a `$BUT,2` lever pull followed by an
   `$ALCD` that did not refill. Reproduce it on the Energy Rifle: pull the lever and hold for one second, two seconds,
   then four, and record which holds refill. The 2026-09-17 bench measured a refill 3.5 to 3.9 s after the pull starts,
   with taps of 0.2 s refilling nothing, so the boundary between "too short" and "works" is the thing to pin.

## 8. Does one pull fire TWO words? ✅ ANSWERED 2026-09-18 (F71 closed, F263) — SUPERSEDED BY **F276**

**YES, and each word carries its own magnitude.** Measured twice: Callsign capture cap30 (45 then 70, 88 ms
apart, one kill) and a bench with the victim at 250 armour (Shotgun 250 → 205 → 135; Plasma Sniper 126 → 101 →
21). Three negatives from the same run: no token separates the two words, the sensor is geometry not a signal,
and the gap VARIES (57, 88 and 119 ms), which straddles the AR's 100 ms cycle and kills any fixed-window
collapse. ⚠️ **What is NOT answered, and now matters more: F276.** Identical words may be deduped by the
receiving gun inside 159 ms, and our Shotgun shipped 20 + 20. Run F276's four steps instead of this section.
Original steps below, kept for method.

`$WEAP` **t1 is `WeaponIRSource`**: 0 = the gun emitter, 1 = the shooter's headset high-power LED,
2 = BOTH. When t1 is 2, **t12 is the second word's damage** and t13/t42 are its reach. Three shipped
weapons carry t1 = 2, and our balance pass writes t5 and never t12:

| weapon | t5 as we ship it | t12, untouched |
|---|---|---|
| Shotgun | 45 | 70 |
| Plasma Sniper | 25 (cut from the captured 80) | 80 |
| Rocket Launcher | 115 | 115 |

The Plasma Sniper is the sharper case. We priced it at 25 on purpose. If the headset word is live, it
also throws an 80 and the price never applied. For the Shotgun, 45 + 70 is 115, exactly the standard
pool, so one pull would kill outright.

**Run it at the IR receiver, not at a victim.** The emitter is the SHOOTER's, so a victim adds nothing
and costs a whole arming sequence. One gun, the receiver, one trigger pull:

1. Start `native_capture.py` on the receiver. No gun connection, no BLE.
2. Arm A with the stock Shotgun, point it at the receiver from about 3 ft, **pull once**.
3. Read the capture: how many 25-bit words, and the magnitude of each.
4. Repeat for the Plasma Sniper and the Rocket Launcher.

**Reading.** Two words at 45 and 70 proves the second emitter, and §2.2, the dominance check and the
close-range band all need redoing. One word at 45 means t12 is inert on this firmware and the ladder
stands. Watch for a split frame: a burst group can hold several frames and `stitch()` cuts at every
sync mark (F12), so count words after stitching, never raw fragments.

**Precedent that this is possible:** the Medic's heal pulse is already known to be a PAIR of
protocol-1 words about 50 ms apart at magnitudes 8 then 14 (2026-09-03). That was an alt-fire, so it
may be the t7-t11 block rather than t12, but one input producing two magnitudes is proven behaviour.

**If the receiver is not up:** the two-gun fallback is one shot at B with A's HEADSET covered, then one
with A's GUN emitter covered, reading B's `$HIR` magnitude each time. Cover the SHOOTER, not the
victim. An earlier draft of this step had that backwards and would have measured nothing.

## Close

1. Teardown both guns: `$CLEAR,*`, then `$SIR,0,0,,1,0,0,1,,*`.
2. One experiment-log entry with every table above, including the nulls.
3. Update S50 with what each answer changes, F62 with the crit result, and S16 with the fn-24 tick count.
