# Handoff — Open BRX

**State as of 2026-09-17 (night).** The arsenal rework is **shipped on main** (`08aec5b7`, `npm run test:all -- --ui`
17/17): 13 visible weapons, a new time-to-kill ladder, node-driven recoil, and the range lever moved to the token the
bench proved. The day before it, the same session benched the levers it rests on. Tomorrow's first job is a short bench
(crit emission, and the hunt for an anti-armour `$SIR` function), then the perk rework.

⚠️ **Two commits from this morning (`61b1074e`, `e20c7136`) recorded the range finding against `t41`.** That was the
`t2` result written against the wrong token. Q15 carries the correction; the per-venue targets in it still stand.

## What shipped today

1. **The catalogue is 13 visible picks** (was 22). Hidden, not deleted: Force Rifle, Bolt Rifle, Stinger, Plasma
   Sniper, Laser Cannon, Ion Sniper, Energy Launcher, Glock. Rocket and Rail are `pickup_only`: catalogue-visible,
   never in a loadout, pending a station pickup mechanism (S46).
2. **`weapon_class`** on every row: ballistic weapons reload, energy weapons overheat or charge.
3. **The ladder** at the 115 pool: AR 1.20 s, SMG 1.33 s, Burst 1.42 s, Sniper 1.50 s, Shotgun and Marksman 1.60 s,
   LMG 1.80 s, Suppressor 1.96 s, sidearms 1.92 s. SMG and Shotgun are held a notch slower until range is calibrated.
4. **The Charge Rifle is a pre-charge ambusher:** one charge plus two taps, about 1 s from release. `t5` is the charge
   damage and `t37` the tap damage, `rounds_per_charge` is 10, and its `$SIR` key moved off the function that halved
   every hit (F225).
5. **The Energy Rifle overheats** (`t38` = 150, sound `D11`), does not cool on its own, and carries a caution.
6. **No headset multiplier:** `$GSET` t7 defaults to 0, because BRX players aim at the headset (4 of the 5 sensors).
7. **Recoil is node-driven** (S42), default on, with F68 fixed first: the team colour repaints every 5 s, because an
   accuracy miss sends nothing over the wire and would otherwise leave the headset dark for the life.
8. **Range moved from `t41` to `t2`** (F234) with starting values: Sniper 100, Marksman and Charge 85, AR and Burst 70,
   Suppressor and LMG 55, SMG 30, Shotgun and both heavies 22. A floor guard refuses anything under 13. Indoor keeps the
   captured value, because indoor is unmeasured.

## What the bench proved (2026-09-17, two guns, office)

- **Mid-match `$WEAP` is safe**: the gun keeps firing and taking hits, applies in 30 to 90 ms, does not revive a dead
  gun, but resets the magazine and accuracy, so an `$AMMO` restore must follow.
- **Accuracy is a hit probability**: 90 lands about 92 to 95%, 50 about 38 to 40%. A miss sends no `$HIR`; the victim
  hears a near-miss.
- **Only one of three guns decays accuracy natively** (F230), and it is the gun the 2026-09-09 model was measured on.
  That is why recoil is ours, not the firmware's.
- **Shields work from `$LIFE` grants**: `$PSET` token 5 is the maximum, a player spawns at 0, grants of 10 to 30 land
  and clamp, and 0 to 120 refills in 4.1 s. The gun plays no recharge cue, so the node must.
- **`t41` is inert outdoors; `t2` is the lever** (F231): t2=5 landed 0 of 38 even muzzle to dome, t2=100 reaches 200 ft,
  with a transition around 13 to 26 and a flat shelf above about 31.

## Tomorrow

1. **Bench, about 20 minutes.** (a) **F62, crit emission**: set `$WEAP` t6 (`primaryCritChance`) to 20 on one gun, fire
   50 shots, count how many land at 1.5 times the magnitude. The crit bit itself is proven (our rig emits it, ×1.5); what
   is unknown is whether a tagger will roll it. (b) **An anti-armour `$SIR` function**: fire one known word at a victim
   with armour only, then shields only, then neither, and watch which pool moves. Several enemy-side rows moved no pool
   on one protocol and dealt damage on another, so a "hits armour harder" function may exist unmapped.
2. **The perk rework (S50).** Decided with Tony tonight: Body Armor drops from +50 to **+25** (about 20% of the pool,
   granted as shield in the Shields preset, and it must not add an armour layer there); every perk gains a cost on the
   lever its opposite buys; Armour Piercing joins as the counter-pick but at about **60% less damage**, not 20%, or it
   is simply the best gun in the game; Motion Tracker is buildable today from the presence list the phones already
   receive, as a proximity list with no direction; the slot may hold more than four perks. Easy Reload leaves the perk
   set for the per-player accessibility block: it exists because Tony's daughter cannot work the lever.
3. **Range calibration** when the M5Sticks arrive (S49): several portable receivers staked out, one group of shots per
   `t2` value, and the close-band guesses (SMG 30, Shotgun and heavies 22) become measurements.

## Open, not moved today

The 2026-09-13 playtest criticals (F206 to F209) are untouched. The playtest session is merging main into
`fix/playtest-2026-09-13` tonight and is renumbering its own rows to F235-F247 (main keeps F230-F234); **file no new F
ids until it reports the merge green**. Heat display on the HUD belongs to that session.
