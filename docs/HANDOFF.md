# Handoff: Open BRX

**State as of 2026-09-18, evening.** Branch `fix/playtest-2026-09-13`, in the worktree
`.claude/worktrees/playtest-2026-09-13`, is **pushed** and about 100 commits ahead of main. It holds the
2026-09-16 and 2026-09-17 work, two merges of `origin/main` (the arsenal rework, then the perk work), a
doc-rot apply, a maintainability and DRY pass, three polish rounds, and **today's verification bench**.
CI on main is green and fixes its own screenshots.

## What the bench proved (2026-09-18, two guns, two Pixels, MC)

Twelve rows closed on hardware: the operator menu (**F235**), the MC restart under a live match
(**F236**), the energy gauge and OVERHEAT and its sound (**F238**, **F239**, **F245**), the results
overlay (**F242**), HARDWARE READY against a real tunnel (**F243**), MARK ALL READY (**F244**), night ops
(**F240**), the shot-ready cue (**F241**), the empty-slot ALT check (**F247**), the eleven-row `$SIR`
table (**F254**), and the reserve question answered (**F255**). Full write-up with the frames:
`docs/experiment-log/2026-09.md`, the 2026-09-18 evening entry.

**Recoil (F259) is fixed and proven.** It erased shots, then oscillated, then worked: the gun confirmed
the degraded accuracy and held it for a whole burst, recovering on release. Tony's design, one step not a
walk; a lane is extending it to two steps with the catalogue owner's numbers.

**Armour piercing bypasses armour AND shields** (measured: a victim died with a full 120 shield standing),
so the Shields preset moves from 30 health to 45. **A two-word weapon deals `t5` plus `t12`**, measured on
two weapons.

## What is open and serious

1. **F264** a player can be dead on the gun and alive on the HUD. `pool_stale: no_fire` is detected
   correctly and **nothing acts on it**, so the player waits for an operator. Any perk asking "is this
   player alive" must read the gun, not the node's belief.
2. **F265** a bound phone's scoreboard froze for 161 s while the overlay labelled it LIVE.
3. **F261** a fresh Mission Control never offers to adopt a running match, because the orphan check needs
   a binding a fresh MC cannot have. That is the field case of MC on a different laptop.
4. **F257** the HUD says OUT OF ENERGY on a charge weapon that can still fire taps.
5. **F256** the coverage line claims an internet path that WiFi-only phones do not have.
6. **F262** the gun's native shield-hit sound tracks something other than the pool.

## Machine state

MC runs from the worktree's `mcp/` on 8765/8766 and serves this branch's `webapp/mc/dist`; rebuild that
before starting it, and restart MC **between matches only**. Check with `ss -ltn | grep 876`.

```
setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume
```

Both Pixels hold 0.3.0 built from this branch. The shield recharge only runs on the **Shields preset**
(armour 0), because every compiled head carries a shield ceiling regardless.

## Next actions, in order

1. **Land the branch.** Merge `origin/main` (its owner says main is quiet), run `pnpm run test:all -- --ui`,
   push and open the PR.
2. **Fix F264**, which is the one that costs a player their match.
3. **Fix F265 and F261**, both small and both about telling the truth: never print LIVE over a stale
   board, and record an orphan match whether or not a node is bound.
4. **Bench the two-step recoil** when it lands: a magazine on full auto at 60 and at 55 for the three
   weapons whose floors were raised, counting `$HIR`.
5. **Bench the shield recharge and its cues**, which has never run on hardware: `N101` on depletion,
   `N102` on the first grant, `VA6Y` at full, `N74` looping while down.
6. Tony decides **F220** (publish app 0.3.0 as a GitHub Release).

## Validation

`npm run test:all -- --ui`: 17 of 18 jobs. The one failure is `test_published_build`, the published APK
reading 0.2.1 against the app's 0.3.0, which is F220. ⚠ Capture the site screenshots AFTER committing a UI
change, never before (`docs/gotchas.md`).

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments;
the MacBook is the field target. Never modify stock firmware.
