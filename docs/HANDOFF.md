# Handoff: Open BRX, state on the morning of bench part 2
**State as of 2026-09-27.** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-09-27)
**App 0.4.14 is published** (`app-v0.4.14`, release-signed, main 56fbece4) and installed on the three bench Pixel 5s.
It carries powerups on by default (F372), the go-live spawn check (F416), held pickups that survive a resume (F418,
F417 part 1), the switch card with paused lanes (F400), no pickup countdown (F425), F394, F420-F424 and mode art C.
Three polish rounds ran before the cut. **MC GAMES (F411) is on main** (c2c51679, review fixes 222b1a81), with PLAY,
BUILD, MATCH SETTINGS, FAVOURITES and the weapon-type toggles; F413 (teams) and F415 (per-mode items, the KOTH hold
target) are in progress (brx3). The Stick firmware is b79de96d + RANGE CLEAR (6f042126); the hill default is -75/6. The iPhone X build (B21 iOS half, uncompiled Swift) is Tony's MacBook
step, `.claude/skills/iphone-build`. Bench part 2 is at the top of [`bench-plan.md`](bench-plan.md).
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: brx1, orchestration
2026-09-26 close: 0.4.14 cut and published (e52f965e bump, 56fbece4 sidecar), CI green. Polish loop: 3 rounds over
bb361d82..cb8413a6; every Critical/High/Medium fixed (4da60f94, 2ae27937, ece991b1, 0191cc8a); Lows are in the F416 row.
Site shots: CI alone owns staleness now (858b4d1e), and an overlap race exits green. Decided today (do not re-ask):
melee always on, gyro only, never a pick (F412 post-mvp for a toggle); teams red + blue by default (F413); per-mode
MATCH SETTINGS and the KOTH hold target (F415); FAVOURITES in F411; mode art C; F425 option A (the HUD never says a
pickup was taken, or by whom); the lead badge hides under the switch card; USP-S keeps Q04; iOS is MVP.
- **Next:** land F411 (brx3), then F413 + F415 (brx3); re-run brx2's desk-prep audit; Tony builds the iPhone.
- **Open:** F414 (a Codex delegation that reports back: background Codex jobs vanished today).
- **Decided:** the station phone may show TAKEN and a NEXT countdown; F425's rule covers the player HUD only.
## Lane: brx2, bench, audio, utility and docs
**2026-09-26, short bench part 1 DONE** (1.5 h, [`bench-plan.md`](bench-plan.md) "NOW: part 1"; the Stick and app
0.4.13, MC `main`). KOTH's Stick-hill half ran clean (F382, F384, F385 CONFIRMED and closed); the phone-hill half
(S1) did not run, blocked by F420 below. Powerups core: F372's default confirmed; a P0 stayed open, **F416** (a
failed spawn write at go-live leaves the gun unspawned, 1 of 3 starts today; brx5 shipped a fix the same day,
moved to MVP BENCH for its check), and it surfaced two more: **F417** (one Stick station granted the same pickup
to two players; part 1 fixed, part 2 traced) and **F418** (backgrounding the app mid-match drops a held pickup,
built) — all three moved to MVP BENCH, owner brx5. The Stick alone:
F387 and F333 CONFIRMED and closed; **F386's timed-whistle half PASSED**, but its match surfaced a NEW half of the
same row, the powerup screen still counting after END; brx4 already shipped both fixes (the powerup-screen freeze
and the idle-timeout cause of F387's confounded control) on `26084fcf`, bench check in part 2. One gun, no phone:
F282's A/B/A CONFIRMED (its t25/t26 isolation stays open); the `$PLAY` queue slot drops and reorders clips fed
faster than they play (**F419**, links F378/F347, brx5). Also filed at the desk, all bugs seen in passing: the ⓘ
utility-mode icon sits behind the Android status bar (**F420**, blocked S1); `release_utility` does not rejoin MC
(**F421**); SET MY GUN shows no join feedback (**F422**); team 3 read GREEN TEAM while the gun painted purple
(**F423**, closed: now PURPLE #bf4ce6, the wire keeps green, F35/A69); the KOTH HUD has no hill-hold score panel (**F424**); Tony decided the always-on
pickup countdown should become a left-side "X AVAILABLE" alert (**F425**, storyboard first); a phantom team-2 hill
total (**F426**). The hill default is decided: -75 dBm, hysteresis 6 (Tony, until the outdoor walk); a "-75 counts phones at 20 m" reading is VOID (the
phones never left the room). Full write-up: `experiment-log/2026-09.md`'s 2026-09-26 entry.
- **Next bench task:** part 2 of [`bench-plan.md`](bench-plan.md): 0.4.14 is cut and F411 IS on main (`c2c51679`),
  CI green. Part 2 now opens with a 3 h cut (172 min, 8 min slack): Step 0, IPHONE, a trimmed GAMES CHECK, the P0
  block, F348, KOTH plus F420/F421/F424, F399+F380 on an Overshield Stick, F386 a/b/d, F394, then 4.0's day/night
  launch; everything else (PLAY AGAIN, LAST MATCH, 11.6, the powerup setup, F386 c, Groups 4-7) is the tomorrow
  list. Reflash the Stick from `6f042126` or later and `RANGE CLEAR` it at setup.
- **Next desk task:** none open: F420-F425 are built in 0.4.14 (F423 closed); their bench checks are in part 2. R4/T5 read-only research is
  authorised; flashing stays decision first.
- **Blocked:** F270 on A8; F274 on its three 2-hour soaks; F275 on outdoor space.
## Lane: brx3, releases and Mission Control
APK 0.4.14 is current. MC GAMES is PLAY + BUILD (F411), with FAVOURITES, LAST MATCH, teams (F413) and the KOTH hold
target (F415), all on main at `4275fad2` with green CI. The phone tid-0 kill-confirm fix (`f52d34dd`) rides the next APK.
- **Next:** Tony's GAMES check at the bench (PLAY, BUILD, TEAMS, HOLD); the next APK cut for the phone fix.
- **Tools:** Codex returns 401 until `codex login`; Sonnet lanes in worktrees did the build, Opus reviewed.
## Lane: brx4, the StickS3
Stick stations are Bluetooth-only for MVP (hill, pickup, respawn); Stick IR receive, the grenade hill, revive
counting and the SETTINGS screen are post-MVP (F338, F314, F344). HELD is the MVP mode and the boot default (Tony,
2026-09-25). On main: A68 (the hill counts from go-live to the whistle; `duration_ms` ends a Stick carried out of Wi-Fi
before START), the -75 dBm hill default, the locked-RANGE refusal, and F389-F392, F397, F398. Flashed from main, unlocked.
- **Next bench task:** bench part 2: reflash from `6f042126`, then F386's a-d (END freezes the powerup screen, no
  post-END grant, STATS + 18 s wait + hold opens RANGE at 5 s, no phone sees the pickup after END; serial log on).
  Step 0.6 clears a stale on-Stick range: `python3 hardware/m5sticks3/tools/stick.py cmd 3 "RANGE CLEAR" STATUS`
  (WSL python3; refused while locked). Then sitting C: the carried-out timed hill, F388,
  the F383 3 m and 7 m readings, F399's claim latency, F391's restart, F392's repro with the serial log, F397's MC
  restart.
- **Decided:** the hill default is -75 dBm, hysteresis 6, until the outdoor walk (F383) (Tony, 2026-09-27).
- **Next desk task:** F342 (a powerup or control-point game still floods the scan: a slower advert or a native filter).
- **Resume:** a fresh worktree off `origin/main` (the old `/home/tony/brx4-l3` and `/home/tony/brx4-f333` are
  disposable). Native Windows MC for mDNS:
  `cd mcp && /mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.mc --host 0.0.0.0 --port 8785 --ws-port
  8786 --ephemeral`.
## Lane: brx5, powerups, the HUD and gun audio
On main: S58 powerups ON by default (F372 closed, `--no-powerups` is the opt-out); S59 Visor; F348/F349; death first; the three-lane alerts; F347, F350, F378.
2026-09-25: sitting B's F379, F380, F381 (a same-weapon stack capped at 2x the drop) and F393; F400, the pickup switch
card (ALT's card and timing for a weapon pickup, SELECT and the switch-back; display only; the Overshield gets N102
and no card). 2026-09-26: F403, the BRIEFING's PICKUPS line (MC's brief carries `pickups`); F394, the ammo number and pips after ALT (built, bench check left). F400 final: the switch card is on top and every lane waits (ALT too); the lead badge hides too (Tony: "it should behave like the KC and events"). F416 (P0): a lost spawn write is checked and re-sent only to an unspawned gun; the station scan closes around go-live. F417 part 1 and F418: a held heavy ends only on a trigger pull; lost equip writes and lost counts are re-sent.
- **Next desk task:** B21's iOS half on the MacBook; `PLAY_GAP_MS` from sitting C's spacing check (F372 closed).
- **Next bench task:** part 2: F418 (hold Rockets, visit Settings, return), F417 (a two-phone race with the Stick serial on; F381 re-run), F416 (go-live with the Stick hill scanning; the three `$LIFE,0,0,0` reads on its row); sitting C: F394 (ALT to the secondary with no shot: number, pips and a reload pull), the powerup setup (11.3), F381 (Rockets twice: 3, then 4), F400 on the gun (the card
  holds ALT's time, SELECT works while it is up), the shield-up kill-cue A/B/A, the spacing check, 11.1 (c), 11.8.

## Start here

1. **Next sitting:** [`bench-plan.md`](bench-plan.md) part 2, the 3 h cut first; record evidence and promote or close
   each row from the result.
2. **Desk:** F413 and F415 (brx3), then B21's iOS compile on the MacBook (`.claude/skills/iphone-build`).
3. **Decisions for Tony:** the FOLLOWUPS MVP DECISION group.
4. **Only after MVP:** [`post-mvp.md`](post-mvp.md) is the roadmap; nothing there is scheduled.

If Tony is not at the bench, prepare the decision packet and read the exact FOLLOWUPS methods; do not invent a new
implementation for a bench-gated row.

## Machine state

MC is `mcp/` on 8765/8766 serving `webapp/mc/dist`; rebuild before starting and restart between matches
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume`
(S58 powerups are on by default; add `--no-powerups` to turn them off). Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC,
Windows drives BLE, and the MacBook is the field target. Never modify stock firmware.
