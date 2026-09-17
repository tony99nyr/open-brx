# Handoff: Open BRX

**State as of 2026-09-17.** Branch `fix/playtest-2026-09-13`, in the worktree
`.claude/worktrees/playtest-2026-09-13`, holds tonight's bench work. It is **NOT merged to main and NOT
pushed**. Both Pixels run app 0.3.0 built from this branch.

## What tonight's bench pass proved

Two-gun bench for F206, then a Pixel 4 + Pixel 5 game through Mission Control. Full write-up:
`docs/experiment-log/2026-09.md` (2026-09-16 entry). Closed: **F206** (a `$PSET` write clears the gun's
team; `$TID` now follows the last `$PSET` of any write), **F207** (the START echo check now reads the
gun's reserve against `$WEAP` t40, not t17), **F201** (answered by F207), **F212** (the respawn gate
label), **F213** (the armour ceiling), **F210** (link flap backoff, built but not reproduced on hardware),
**F211** (the HUD now says when Bluetooth is off). A Pixel 5 scan storm (about 8 stop/start cycles per
second) explained the countdown gap, the white flash, missed taps and the late kill sound; fixed.

Built and desk-verified, **bench gate still open**: A44 spawn protection (2.1 s cap), A45/A46 stale-pool
reporting, F209 one death per life, app 0.3.0 (`APP_MINOR` 3), A43 next match without a mode pick, a
pre-arm check, the ALT procedure correction, HUD press feedback, lobby READY green. New bench ids:
**F217** (A44 on hardware), **F218** (A45 must not fire on a charge-rifle hold or an empty-slot swap),
**F219** (does a trigger held on `$BMAP` fn 98 report `$BUT` in scanner respawn mode).

Polish loop: 3 iterations, no Critical. Validation: app 548 pass, MCP 1886 pass (2 expected failures: stale
site shots, published build still 0.2.1), console 539 pass, HUD screen-truth 346 pass.

Separately, contract-DRY phases 1-3, all five F42.9 batches, F42.12 and F42.14 are implemented, reviewed and
validated (log entries 2026-09-15/16); only the coverage/runtime-input audit remains (see below).

## Machine state right now

MC is **stopped**. Start it from the worktree's `mcp/` with:
```
../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume
```
(the Windows portproxy forwards 8765/8766). **Rebuild `webapp/mc/dist` first.**

## Next actions, in order

1. Run the bench checklist against the new ids: **F217** (A44), **F218** (A45 no_fire), **F219** (fn 98
   `$BUT` in scanner mode), plus the green READY, pre-arm check, NEXT MATCH, Bluetooth-off and RELINK
   behaviour built tonight.
2. Tony decides: **F220** publish app 0.3.0 as a GitHub Release, and **F221** the warning-audit page
   (`docs/mc-warning-audit-2026-09-16.md`, keep/quieter/remove per item).
3. Done 2026-09-17: main 89dd1c3d (`test-suite-speed`) is merged into this branch, `fakegun.js` echoes t40,
   and the site shots are refreshed (F222). `npm run test:all -- --ui` passes 15 of 16 jobs; the one failure
   is `test_published_build` until F220 is decided. After the bench, merge this branch to main and push.
4. Later: the contract-DRY coverage/runtime-input audit is the one item still open from that work.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments; the
MacBook is the field target. Never modify stock firmware.
