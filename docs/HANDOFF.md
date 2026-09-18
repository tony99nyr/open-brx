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
4. **The compile half of S50 is built and merged** (`5f9e2620`, `181fc506`, `test:all --ui` 17/17).
   `armed_armor()` redirects the grant to SHIELD under the Shields preset and floors at 0; Armour
   Piercing re-keys the primary to a new permanent fn-2 `$SIR` row and refuses to arm if the compiled
   head lacks it; `perk_effects` rides the FrameBundle and State from one resolver, pinned equal by a
   test; Easy Reload now lives in `loadout.overrides`. The HUD's perk line printed every COST as a buff
   (`reload_mult: 1.25` read as "RELOADS 0.8x FASTER"), which is fixed, and the kit plate takes the gain
   alone so it stops overflowing.

## Tomorrow

1. **Bench, about 40 minutes** (`bench-perks-2026-09-18.md`): can a gun roll its own crits (F62, `$WEAP`
   t6); is there a `$SIR` function that hits ARMOUR harder (the counter Body Armor needs); **does one
   fn-24 shot tick** (this gates the poison weapon, and checks whether the stock Energy Launcher row has
   been ticking victims all along); the Charge Rifle's real tap cadence; whether a stim-style write
   survives a reload; and two sound items handed back by the playtest session.
2. **The perk build, what is left.** The node-local pair, Motion Tracker and Second Wind, is not
   started, and neither is the Motion Tracker range measurement (`perk-design.md` §5 item 5: the RSSI
   bubble was tuned for walking up to a station, not for a fight). **S52** is the one that matters for a
   real player: the HUD never tells someone their host switched Easy Reload on, and the conflict with a
   second weapon is enforced only on the server, so out of coverage there is no warning at all.
3. **Range calibration** when the M5Sticks arrive (S49): the close-band guesses (SMG 30, Shotgun and
   heavies 22) become measurements.

## Open, not moved

The 2026-09-13 playtest criticals (F206 to F209) are untouched. The playtest branch merged main, has
renumbered its own rows and has filed every F id below **F253**, so main resumes there. That branch
replaced `overheated()` with a per-slot `_overheating()` carrying a staleness window, which is the
better design: a locked gun stops sending `$ALCD`, so a single gun-wide 99 would sit above the line for
ever. When it lands, heat becomes a game rule and belongs on the stage. Main no longer has
`overheated()`: its only reader was the S42 accuracy writer, which Tony cut on 2026-09-18.
