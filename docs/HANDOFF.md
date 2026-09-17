# Handoff: Open BRX

**State as of 2026-09-17, evening.** Branch `fix/playtest-2026-09-13`, in the worktree
`.claude/worktrees/playtest-2026-09-13`, holds the 2026-09-16 and 2026-09-17 work. It is **NOT merged to
main and NOT pushed**. It last merged with main at commit 7d179b97.

The `brx-weapons` session has **uncommitted work on main**: arsenal cuts, plus followup ids F225-F229
and S42-S47. That work will need merging alongside this branch.

## What today's bench pass proved

Two guns (Tactix-3D4F, Tactix-E20D) plus a Pixel 4 and a Pixel 5 through Mission Control, with
`--bench-volume`. Full write-up: `docs/experiment-log/2026-09.md` (2026-09-17 entry). Closed on the
bench: **F215** (sniper HUD numbers matched the gun), **F217** (A44 spawn protection confirmed, and
Tony's decision that a respawned player must not get an advantage), **F218** (the charge-rifle false
GUN NOT FIRING was an overheat-lockout bug, now fixed; the swap-to-empty-slot half continues as F242).
Found and fixed today: a Pixel 5 double-tap connect hang, a headset-off reconnect loop (now backs off),
a bounded RELINK mid-match, a 62 s spawn write caused by a flooded plugin reply channel (writes no
longer wait; the beacon scan and player advert now run only when stations are in play), a charge-rifle
cell that spent the wrong amount per charge (now 40/80), an ALT that reloaded a one-weapon loadout, a
HUD kill banner that showed a player id, and an amber warning for an unread firmware version. Open:
**F240** the charge rifle has no overheat sound (`$PLAY,C19` sounds like the charge-cancel cue).

Built at the desk, not yet benched: MC match resume/adopt, the operator menu (RESYNC GUN, FORCE
RESPAWN, RELINK GUN, A47), HARDWARE READY + ENABLE BACKHAUL, MARK ALL READY, the energy gauge (cell
pills, NOT ENOUGH ENERGY, HOLD TO RECHARGE), the heat bar and full-screen OVERHEAT, a shot-ready cue, a
results overlay, a night skin per player, NIGHT OPS dimming LEDs, and a bench volume of 65. New
verification-bench ids: **F230-F242** (see `docs/FOLLOWUPS.md`).

Polish loop: 3 rounds, no Critical finding. Fixes in commits b7c095c4, 0003df1a, 16a8f72f, 3a02e263,
476d5b17, faa64843, f8f7006a. Validation: `npm run test:all -- --ui` gives 17 jobs passing; the mcp
suite gives only the two expected failures (published build still reads 0.2.1; site shots refreshed in
commit 272e009b).

## Machine state right now

MC is **stopped**. Phones need the next build from this branch before the verification bench. Start MC
from the worktree's `mcp/`:
```
setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume
```
(detached; the Windows portproxy forwards 8765/8766). **Rebuild `webapp/mc/dist` first.** Restart Mission
Control only between matches, never mid-match.

## Next actions, in order

1. Run the verification bench against the new rows: **F230-F242** (operator menu, match resume, the
   Pixel 5 BLE fix, the energy gauge, OVERHEAT, NIGHT OPS, the shot-ready cue, the results overlay,
   HARDWARE READY/backhaul, MARK ALL READY, the charge-rifle overheat sound, the energy-weapon reload
   timeout, and the swap-to-empty-slot no_fire check).
2. Tony decides: **F220** (publish app 0.3.0 as a GitHub Release) and **F221** (the warning-audit page).
3. Merge main (the `brx-weapons` work, F225-F229, S42-S47) and this branch, then push.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments;
the MacBook is the field target. Never modify stock firmware.
