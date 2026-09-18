# Handoff: Open BRX

**State as of 2026-09-17, evening.** Branch `fix/playtest-2026-09-13`, in the worktree
`.claude/worktrees/playtest-2026-09-13`, holds the 2026-09-16 and 2026-09-17 work **and now the merge of
`origin/main` at f4e7e263** (the `brx-weapons` arsenal rework). It is **NOT pushed**.

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
§3.16, S42) with the F68 team repaint (§3.17). The venue range lever moved from `$WEAP` t41 to **t2**
(`gunRangeOutdoor`); t41 is inert outdoors. Main's own open ids stay as they are: **F230-F234, S48-S51**. Main also shipped the 13-pick
catalogue (Rocket and Rail `pickup_only`, S46), the new time-to-kill ladder, and the poison weapon design;
its next bench is crit emission (F62) and the hunt for an anti-armour `$SIR` function
(`docs/bench-perks-2026-09-18.md`).
Main's ids came first, so this branch's thirteen verification rows moved from F230-F242 to **F235-F247**.

## Machine state right now

MC is **stopped**. Phones need the next build from this branch before the verification bench. Start MC
from the worktree's `mcp/`:
```
setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume
```
(detached; the Windows portproxy forwards 8765/8766). **Rebuild `webapp/mc/dist` first.** Restart Mission
Control only between matches, never mid-match.

⚠ **Two commits from main's morning (`61b1074e`, `e20c7136`) recorded the range finding against `t41`.** That was
the `t2` result written against the wrong token; Q15 carries the correction, and the per-venue targets still stand.

⚠ **Gun state from main's garden session:** shooter `Tactix-E20D` went out of BLE range before its
teardown landed and still carries the t2 18/22 test slots. Its `$SIR` table was never cleared, so it is
not in the F11 state, but **re-arm it before real use**.

## Next actions, in order

1. Run the verification bench against the new rows: **F235-F247** (operator menu, match resume, the
   Pixel 5 BLE fix, the energy gauge, OVERHEAT, NIGHT OPS, the shot-ready cue, the results overlay,
   HARDWARE READY/backhaul, MARK ALL READY, the charge-rifle overheat sound, the energy-weapon reload
   timeout, and the swap-to-empty-slot no_fire check).
2. Bench the merged recoil writer against spawn protection and the operator resync: the accuracy writer
   stands down for `ACC_HOLD_MS` after any spawn, revive, resync or stun write (**F235**, **F247**).
3. Re-run main's **F231** range ladder with the dome shaded, full 32-round mags, and the first two shots
   of every mag discarded (**F232**).
4. Tony decides: **F220** (publish app 0.3.0 as a GitHub Release) and **F221** (the warning-audit page).
5. Push the branch and open the PR.

## Validation

`npm run test:all -- --ui` after the merge: 17 jobs, green except the two expected failures (the
published build still reads 0.2.1; the site shots need a refresh after the HUD and weapon changes).

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments;
the MacBook is the field target. Never modify stock firmware.
