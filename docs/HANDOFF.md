# Handoff — Open BRX

**State as of 2026-09-17 (night).** The arsenal rework shipped this morning (`08aec5b7`). Tonight fixed
two defects in it, designed the damage-over-time weapon we never had, and wrote the perk catalogue.
Tomorrow's first job is a 40-minute bench (`bench-perks-2026-09-18.md`), then the perk build.

⚠️ **Two commits from yesterday morning (`61b1074e`, `e20c7136`) recorded the range finding against
`t41`.** That was the `t2` result written against the wrong token. Q15 and `weapon-design.md` §4.2 carry
the correction; the per-venue targets in them still stand.

## Tonight

1. **Two defects, both found by READING, not by a test** (`f4e7e263`, `test:all --ui` 17/17). The recoil
   accuracy writer's overheat guard read `this.overheatLocked`, which nothing ever set, so it could
   write into a lockout; it now reads the gun's heat from `$ALCD` token 5 (F229). And `weapons.json`
   carried **two `recoil` blocks in 13 of 22 weapons**, one per merge lane: JSON keeps the last, so the
   first was dead. Nothing shipping moved, because the surviving values are the documented ones. Both
   now have a guard that goes red when broken. The playtest session found both.
2. **Damage over time is designed** (`e934502b`, `weapon-design.md` §6.3b, S16). The node route is
   certain: `$LIFE` takes negatives and the victim's phone keys off the `$WEAP` t3 damage type echoed in
   `$HIR` token 2. The native route (fn 24) is written up as UNPROVEN, because its ticks were measured
   against a repeating beacon. The weapon is a Toxin Rifle: half the direct damage, a small tick,
   refresh rather than stack, and the first weapon that punishes turtling.
3. **The perk catalogue** (`6f039f90`, `perk-design.md`). Seven core picks, each buying on the lever its
   neighbour sells: Body Armor +25 and preset-aware, Armour Piercing at about -60% damage, Quick Hands,
   Extended Mags, Quick Switch, Motion Tracker, Second Wind. The next wave and every rejected idea are
   in the same document, with reasons. §6.3c lists the four other archetypes the levers already allow
   and the catalogue does not have: a medic gun, a flux beam, a jammer and a crit weapon.

## Tomorrow

1. **Bench, about 40 minutes** (`bench-perks-2026-09-18.md`): can a gun roll its own crits (F62, `$WEAP`
   t6); is there a `$SIR` function that hits ARMOUR harder (the counter Body Armor needs); **does one
   fn-24 shot tick** (this gates the poison weapon, and checks whether the stock Energy Launcher row has
   been ticking victims all along); the Charge Rifle's real tap cadence; whether a stim-style write
   survives a reload; and two sound items handed back by the playtest session.
2. **The perk build.** A compile-time lane is running now (perk costs, the preset-aware `armed_armor()`,
   Armour Piercing, `perk_effects`, and Easy Reload moved to the accessibility block). The node-local
   pair, Motion Tracker and Second Wind, is not started; the HUD half belongs to the `brx-hud` session.
3. **Range calibration** when the M5Sticks arrive (S49): the close-band guesses (SMG 30, Shotgun and
   heavies 22) become measurements.

## Open, not moved

The 2026-09-13 playtest criticals (F206 to F209) are untouched. The playtest session is merging main
into `fix/playtest-2026-09-13` and has renumbered its own rows to F235-F247; **file no new F ids until
it reports that merge green**. Heat on the HUD belongs to that session, and when it lands, `overheated()`
becomes a game rule and should move to the stage (the pin in `test_stage_mirror.py` says so).
