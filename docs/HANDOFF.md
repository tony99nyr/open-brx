# Handoff: Open BRX

**State as of 2026-09-18, morning.** Branch `fix/playtest-2026-09-13`, in the worktree
`.claude/worktrees/playtest-2026-09-13`, holds the 2026-09-16 and 2026-09-17 work, **both merges of
`origin/main`** (the arsenal rework, then the perk work at `fae46b5b`), a doc-rot apply, a
maintainability and DRY pass, and three polish rounds. `npm run test:all -- --ui`: 17 of 18 jobs green,
the one failure being the published APK version (**F220**, Tony decides).

**CI on main is fixed and green.** 15 of the last 19 runs failed on `test_site_shots`, a guard no CI job
could satisfy: the capture needs a built `app/www`, a built `webapp/mc/dist` and a browser. The new
`site-shots` job (main `d44f4a29`, `190ec4eb`) builds both UIs, captures with the Playwright build the
lockfile pins, and pushes the shots back as `github-actions[bot]`. It refuses rather than forces: if a UI
moved while it ran, it goes red and the queued run fixes the shots. The staleness pair in
`mcp/tests/test_site_shots.py` skips inside Actions only, and is unchanged locally.

## What today's bench pass proved

Two guns (Tactix-3D4F, Tactix-E20D) plus a Pixel 4 and a Pixel 5 through Mission Control, with
`--bench-volume`. Full write-up: `docs/experiment-log/2026-09.md` (2026-09-17 entry). Closed on the
bench: **F215** (sniper HUD numbers matched the gun), **F217** (A44 spawn protection confirmed, and
Tony's decision that a respawned player must not get an advantage), **F218** (the charge-rifle false
GUN NOT FIRING was an overheat-lockout bug, now fixed; the swap-to-empty-slot half continues as F247).
Found and fixed today: a Pixel 5 double-tap connect hang, a headset-off reconnect loop (now backs off),
a bounded RELINK mid-match, a 62 s spawn write caused by a flooded plugin reply channel (writes no
longer wait; the beacon scan and player advert now run only when stations are in play), a charge-rifle
cell that spent the wrong amount per charge (now 40/80), an ALT that reloaded a one-weapon loadout, a
HUD kill banner that showed a player id, and an amber warning for an unread firmware version. Open:
**F245** the charge rifle has no overheat sound (`$PLAY,C19` sounds like the charge-cancel cue).

Built at the desk, not yet benched: MC match resume/adopt, the operator menu (RESYNC GUN, FORCE
RESPAWN, RELINK GUN, A47), HARDWARE READY + ENABLE BACKHAUL, MARK ALL READY, the energy gauge (cell
pills, NOT ENOUGH ENERGY, HOLD TO RECHARGE), the heat bar and full-screen OVERHEAT, a shot-ready cue, a
results overlay, a night skin per player, NIGHT OPS dimming LEDs, and a bench volume of 65. New
verification-bench ids: **F235-F247** (see `docs/FOLLOWUPS.md`).

## What the merge brought from main

The arsenal rework (A48): `weapon_class` and `rounds_per_charge` on the wire, the Charge Rifle at fn 1 /
85 charge / 20 tap / cell 40/80, the Energy Rifle's overheat switched on (t38 150, sound D11) with a
`caution` string, weapons cut from the pickers, `$GSET` t7 = 0, and **node-driven recoil** (`node.md`
§3.15, S42) with the F68 team repaint (§3.16). The venue range lever moved from `$WEAP` t41 to **t2**
(`gunRangeOutdoor`); t41 is inert outdoors. Main's own open ids stay as they are: **F230-F234, S48-S51**. Main also shipped the 13-pick
catalogue (Rocket and Rail `pickup_only`, S46), the new time-to-kill ladder, and the poison weapon design;
its next bench is crit emission (F62) and the hunt for an anti-armour `$SIR` function
(`docs/bench-perks-2026-09-18.md`).
Main's ids came first, so this branch's thirteen verification rows moved from F230-F242 to **F235-F247**.

## What the second merge brought from main (2026-09-18)

The perk work: the **compile half of S50** (`armed_armor()` redirects the grant to shield under the
Shields preset and floors at 0; Armour Piercing re-keys the primary onto a new permanent fn-2 `$SIR` row
and refuses to arm without it; `perk_effects` rides the FrameBundle and the State from one resolver), the
**perk catalogue** (`docs/perk-design.md`, seven picks, each buying on the lever its neighbour sells), and
**Easy Reload out of the perk slot** into `loadout.overrides`. The HUD's perk line printed every cost as a
buff and is fixed. **Damage over time is designed** (`weapon-design.md` §6.3b, S16): the Toxin Rifle, with
the native fn-24 route written up as unproven. **S52** is open: the HUD has no notion of `overrides`, so a
player whose host switched Easy Reload on is never told that ALT reloads their gun.

⚠ **The fn-2 armour-piercing row is now in every compiled head.** A protected player can take an
armour-piercing word that goes straight to health, so it meets this branch's spawn protection: check that
at the bench alongside **F254**.

Amendment ids collided again, the same shape as the F ids: main numbered node-driven recoil **A43**, which
this branch had already used for NEXT MATCH. The recoil amendment keeps this branch's **A48**, and
`node.md`'s sections are main's numbering (recoil §3.15, the F68 repaint §3.16).

## What tonight's desk pass changed

A doc-rot review (four lanes), a maintainability and DRY review (two lanes) and two polish rounds were
applied and committed. What matters for the bench:

- **The site published twice every weapon's spare rounds.** Reserve came from `$WEAP` t17; the player
  carries t40, which is half of it (F207). The site, its test and the manual are corrected, and they
  describe the CAPTURED Callsign gun. The shipped weapon looked wrong too, but the bench closed that
  (**F255**): `$AMMO,0,32,192` rides both the spawn and the revive, so the gun is set to the full
  catalogue reserve every life and the HUD agrees with it.
- **One overheat reading, not two.** The merge brought a gun-wide `overheated()`; this branch keeps the
  per-slot `_heatBlocksFire()` with its staleness window, because a locked gun stops sending `$ALCD`.
  The HUD's bar and word now read the same field, so the bar can no longer sit hot for 19 s after the
  word clears.
- **The node's stand-down set is one table.** Eight call sites re-typed it and no two agreed. Each site
  keeps its own subset; equivalence was proven over all 8192 input states, not argued.
- **Mission Control asks "is this match in play" once**, through `in_play()`, `current_match_id()`,
  `is_adopted()` and `_promote_phase()`. No behaviour change.
- **F248 closed**: the ammo gauge follows `rounds_per_charge > 1`, not `weapon_class`, so the Rail Gun
  shows two pips instead of "50%".
- Six sheets whose work ran are in `docs/archive/`, the retracted t37/t38, t2/t41 and t7 readings are
  corrected in `protocol/` and the manual, and six new hygiene guards cover the rot the review found by
  hand.

## Machine state right now

MC runs on this box from the worktree's `mcp/`, on ports 8765 and 8766, and it serves the branch's
`webapp/mc/dist`. Rebuild that and restart MC **between matches only** before the verification bench.
Check whether it is up with `ss -ltn | grep 876`. The start line is:
```
setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume
```
(detached; the Windows portproxy forwards 8765/8766.) The phones still need the next build from this
branch.

⚠ **Two commits from main's morning (`61b1074e`, `e20c7136`) recorded the range finding against `t41`.**
That was the `t2` result written against the wrong token. Q15 carries the correction, and the per-venue
targets in it still stand.

⚠ **Gun state from main's garden session:** shooter `Tactix-E20D` went out of BLE range before its
teardown landed and still carries the t2 18/22 test slots. Its `$SIR` table was never cleared, so it is
not in the F11 state, but **re-arm it before real use**.

## Next actions, in order

1. **Count the `$SIR` rows (F254, open).** S50's armour-piercing perk made every table **eleven** rows,
   and ten is the most ever proven on a gun. `$QUERY` the table back after a head write and after a
   `sir_pool` take, count them, then fire an AP shot: HP should move and armour should not. A capped
   table drops the eleventh row silently, and the compile-side guard cannot see it.
2. Run the verification bench against the new rows: **F235-F247** (operator menu, match resume, the
   Pixel 5 BLE fix, the energy gauge, OVERHEAT, NIGHT OPS, the shot-ready cue, the results overlay,
   HARDWARE READY/backhaul, MARK ALL READY, the charge-rifle overheat sound, the energy-weapon reload
   timeout, and the swap-to-empty-slot no_fire check).
3. Bench the merged recoil writer against spawn protection and the operator resync: the accuracy writer
   stands down for `ACC_HOLD_MS` after any spawn, revive, resync or stun write (**F235**, **F247**).
4. Re-run main's **F231** range ladder with the dome shaded, full 32-round mags, and the first two shots
   of every mag discarded (**F232**).
5. Tony decides: **F220** (publish app 0.3.0 as a GitHub Release) and **F221** (the warning-audit page).
6. Open the PR (the branch is pushed).

## Validation

`npm run test:all`: 5 of 6 jobs green, and the one failure is expected: the published APK reads 0.2.1
against the app's 0.3.0 (**F220**, Tony decides). The site shots are captured against this branch's UI.
⚠ Capture AFTER committing a UI change, never before: the manifest records HEAD's tree hash, so a
capture taken on a dirty tree is stale the moment you commit (`docs/gotchas.md`).

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments;
the MacBook is the field target. Never modify stock firmware.
