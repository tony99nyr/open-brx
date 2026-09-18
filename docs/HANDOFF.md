# Handoff: Open BRX

**State as of 2026-09-18 (night).** Branch `fix/playtest-2026-09-13`, in the worktree
`.claude/worktrees/playtest-2026-09-13`, has just merged `origin/main`. Main carried the LaserTagMods
drive integration (stock firmware images, Jay's ESP32 sources, BC's command sheets, BC's 2018 app), a
Callsign capture (cap30), the `soak` tool and the community audio labels. This branch carried the
2026-09-16 and 2026-09-17 desk work, three polish rounds and the 2026-09-18 verification bench.
**Every firmware fact from the drive is a disassembly reading, not a measurement on v4.32.** The bench
that settles them is [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md)
(five sessions, a 21-claim checklist).

⚠️ **Top priority (Tony): screamers.** A gun locks up in play, a sound loops, and only a power cycle
recovers it. The plan is [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md). Its Phase C
tool is built: `python -m brx_mcp soak <address> <pattern> <minutes>`.

**Bench order:** [`bench-plan.md`](bench-plan.md) puts every bench test into one list of sittings. Open it first.

## What is wrong right now

1. **F264** a player can be dead on the gun and alive on the HUD. `pool_stale: no_fire` is detected
   correctly and **nothing acts on it**, so the player waits for an operator. Any perk asking "is this
   player alive" must read the gun, not the node's belief.
2. **F265** a bound phone's scoreboard froze for 161 s while the overlay labelled it LIVE.
3. **F261** a fresh Mission Control never offers to adopt a running match, because the orphan check
   needs a binding a fresh MC cannot have. That is the field case of MC on a different laptop.
4. **F257** the HUD says OUT OF ENERGY on a charge weapon that can still fire taps.
5. **F256** the coverage line claims an internet path that WiFi-only phones do not have.
6. **F262** the gun's native shield-hit sound tracks something other than the pool.
7. **F207** (the START echo false positive) and **F209** (the respawn burst) from the 2026-09-13
   playtest are still open on main's side of the merge; this branch closed F207 on 2026-09-16.

## What the merge brought

1. **F206 has a second, deeper fix** (`d0f4c729`). This branch closed F206 on the 2026-09-16 bench by
   re-sending `$TID` after every `$PSET`. Main's disassembly then found the cause: the gun keeps ONE
   team byte, and `$TID`, `$TEAM` and `$PSET` t2 all write it, last writer wins. Now every `$PSET`
   carries the `$TID` team and `assert_team_byte_consistent` refuses a bundle where the two disagree.
   **One bench run confirms that second fix** (levers sheet §1, runs a-f).
2. **Range is a CARRIER FREQUENCY, not a power.** `38000 - 125 * (100 - range)` Hz on the barrel, a
   steeper slope on the headset word; power comes from the indoor/outdoor level alone. The F231 ladder
   stands, but a low value detunes the word out of the receiver's 38 kHz band-pass rather than
   shortening the beam. Calibrate in kHz. `$GSET` t2 = 1 means INDOOR, and the indoor range token is
   read only indoors and only when non-zero.
3. **The stun cell is fn 23, not fn 24.** fn 23 drops live accuracy to 0, moves no pool and recovers in
   about 3 s (Tony calls it SMOKE). fn 24 to 27 are the phantom-hit family: no damage, but the victim's
   gun manufactures a fake `$HIR` every 5.07 s until the next `$SPAWN`. P18 is retracted and closed.
4. **The command rail has three tiers** (`cbd05419`): `KNOWN_COMMANDS`, `DENIED_COMMANDS` (refused even
   with confirm) and unknown = confirm. The phone gets the deny list as `NODE_DENIED_COMMANDS`.
5. **Transport hardening is designed, two parts built** (`spec/transport-hardening.md`). Built: the deny
   list, and `brxlink.WRITE_PACING` with the block pause OFF. Filed: F269 to F274.
6. **The second emitter is priced** (`9b7d2ae0`, `afe064c4`). One Shotgun pull lands two words, and the
   second word comes from the SHOOTER's headset, not the victim's. t12 is a declared `wire.headset_dmg`.
7. **The protocol reference is tagged by evidence** (`[disasm]` `[sheet]` `[apk2018]` `[jay]`; no tag =
   bench). The bench result was kept over the disassembly in three places: `$WEAP` t37/t38, the `$LIFE`
   token order, and the x1.5 crit at t7 = 0.

## Next actions, in order

1. **Finish this merge**, then `npm run test:all -- --ui` (known red on main: app-screens #53 and some
   app-e2e steps), push and open the PR.
2. **Screamers first** (top priority). Phase C runs unattended on one gun with `soak`. Do not turn the
   block pause on before Phase A gives F269/F270/F272 their numbers.
3. **Fix F264**, which is the one that costs a player their match.
4. **Fix F265 and F261**, both small and both about telling the truth: never print LIVE over a stale
   board, and record an orphan match whether or not a node is bound.
5. **Levers bench, session 1** (45 min, two guns): §1 F206, §2 melee, §4 step 1, §5 step 1, §13 `$DD`.
6. **Bench the shield recharge and its cues**, which has never run on hardware: `N101` on depletion,
   `N102` on the first grant, `VA6Y` at full, `N74` looping while down.
7. Tony decides **F220** (publish app 0.3.0 as a GitHub Release).

## Machine state

MC runs from the worktree's `mcp/` on 8765/8766 and serves this branch's `webapp/mc/dist`; rebuild that
before starting it, and restart MC **between matches only**. Check with `ss -ltn | grep 876`.

```
setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume
```

Both Pixels hold 0.3.0 built from this branch. The shield recharge only runs on the **Shields preset**
(armour 0), because every compiled head carries a shield ceiling regardless.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE instruments;
the MacBook is the field target. Never modify stock firmware.
