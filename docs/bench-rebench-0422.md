# Bench sheet: the re-bench on APK 0.4.21

Updated: 2026-10-11. This sheet supersedes [`bench-rebench-0419.md`](bench-rebench-0419.md), which never ran. It runs
on APK 0.4.21, built on 2026-10-11 from `release/app-0.4.21` at `633a7679`, which is main `795e0ba3` plus the version
bump and notes (`dirty: false`). It carries every open MVP BENCH row in [`FOLLOWUPS.md`](FOLLOWUPS.md): each still-open
step of the 0.4.20 sheet, the rows the 2026-10-10/11 improvement push added, and a table of the rows that need
another setup (*Not in this sitting*, at the end). Each step has a control, a pass rule, its FOLLOWUPS row and the
**minimum build** it needs. The row holds the history and the fix; this sheet holds the procedure. How a bench run
works with Tony: the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md). The index is
[`bench-plan.md`](bench-plan.md).

**Order.** Sitting A is one gun, quick confirmation rows first. Sitting B is the Stick: one flash from main covers
F519, F521, F504 and F508. Sitting C is two guns and the phones, with the reds first: F438, F439, F416, F440, F464
and F434 (brx1 listed F464 before F440; a phone-hill ladder and F440 run first because F464 reads the circle
they measure).

**Minimum build.** "Min" names the oldest commit that carries the fix under test. 0.4.21 carries every commit on main
up to `795e0ba3`, so every Min on this sheet is in this APK, and a Stick flashed from main at `795e0ba3` or later
has every Stick Min. "Min: any" means the step probes the stock gun, so no build of ours changes the answer. A step
on a phone with an older APK is not a result: reinstall first.

**Time:** Sitting A about 2 h 45 min to its STOP POINT, plus about 55 min below it. Sitting B about 3 h 10 min.
Sitting C about 6 h to its STOP POINT, plus about 3 h below it, so it takes two days. Each sitting can run on its own day after the shared setup, but run B before C: C.8, C.15 to C.17 and C.32 need
B.0's flash.

## Kit

- Two guns with their headsets: Tactix-FE30 (player 1, red) and Tactix-9498 (player 2, blue). Sitting A needs one.
- Three Pixel 5s: the black Pixel is player 1, the green Pixel player 2, and the grey Pixel the phone station (the
  powerup station, then the KOTH hill), on its charger. Phones ride on the rail.
- Every M5StickS3 on USB, for Sitting B and F434. Optional: one player-sim board
  ([`hardware/player-sim/README.md`](../hardware/player-sim/README.md)).
- The IR rig: the receiver for F521 (a), and the emitter (the `ir-emit` CLI) as Sitting A's shooter, so a hit or a
  kill needs no second gun.
- This box: WSL for MC and the tools, Windows Python for anything that touches a gun
  (`/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`, [`wsl-dev-runbook.md`](wsl-dev-runbook.md)).
- A tape measure (the hill ladder needs 12 m), a stopwatch, a wall for the self-hit step, and a target for melee.

## Method (it worked on 2026-10-02; keep it)

- **Volume: `$VOL,65` for every laptop-armed gun, and MC runs at `--bench-volume 65`** (the bench-session skill: 30
  and 55 are barely audible here). Never use MC's venue play volume (80 or 90) at the bench. Log the level each audio
  step used. F437 and F446 were heard at 80 before: if a line is too quiet to judge at 65, say so and repeat that one
  step at 80, logged as such.
- **Drive MC through its API**, not by clicking, except where a step tests the console itself. Every non-GET
  `/api/*` call takes `Authorization: Bearer <token>` (the token is in MC's boot banner; `mcp/brx_mcp/mc/API.md`).
- **Read each phone's log over CDP** after each step, before the next one starts:
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe mcp/tools/webview_eval.py "window.brx.log.slice(-40)" --serial <ip:port>`.
- **Read a gun's pools with `$LIFE,0,0,0`** (a read probe). `$LIFE` and `$QUERY` both need `confirm=true`. The laptop MCP reaches a gun only while no
  phone holds it: force-stop that phone's app first. Arm a laptop-held gun from `compile.resolve()` or the CLI's
  compiled head (F515), never from a capture.
- Never end on a bare `$CLEAR`. Power-cycle any gun the laptop armed. Never restart MC while a match is ARMED or LIVE.

## Setup (about 40 min)

1. **Re-pair adb.** On each Pixel: Developer options, Wireless debugging, *Pair device with pairing code*. Tony reads
   out the pairing `ip:port` and code; run `adb pair <ip>:<pairing port> <code>`. Then Tony reads the connect
   `ip:port`; run `adb connect <ip:port>`. Check with `adb devices`: three phones, each `device`.
2. **Install 0.4.21 on all three.** Check the file first:
   `sha256sum /home/tony/apk-0.4.21/brx-companion-0.4.21-android-release.apk` must print
   `b80cbdb75fe6b63fa9956b85d31263866075bfc9b152d0287359ca96c67c0b63`. Then
   `adb -s <ip:port> install -r /home/tony/apk-0.4.21/brx-companion-0.4.21-android-release.apk` (the same release key
   installs over 0.4.20 with no uninstall). Log each phone's version:
   `adb -s <ip:port> shell dumpsys package com.openbrx.companion | grep versionName` (it reads 0.4.21).
   **F395, a glance:** on each phone's first cold launch, the splash is the plain background with no stretched logo.
   Close F395 if it is clean on all three. Min: `4fb379d8`.
3. **Run `./start.sh --setup-only` ONLINE once**, from the main checkout, before MC starts. Answer no to the update
   question (main is already pulled). **Pass:** "Mission Control package is installed".
4. **Start MC from main**, with no match ARMED or LIVE anywhere, detached from the agent shell:
   `cd mcp && setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume 65 > ~/mc-$(date +%Y%m%d-%H%M).log 2>&1 &`.
   Rebuild `webapp/mc/dist` first if it is older than main. **Pass:** the banner says "BENCH VOLUME 65". Log the
   banner, the token and MC's sha. MC runs from main, so an MC fix that lands after `795e0ba3` is in MC but not in the
   phone build: log MC's sha beside each MC-side result.
5. Each player phone joins MC and runs SET MY GUN with its own gun.
- **Log:** the three versions, the APK sha, the start.sh result, MC's sha and banner.

## Sitting A: one gun (about 2 h 45 min, then 55 min below the STOP POINT)

Tactix-9498 and the green Pixel. The IR rig emitter is the shooter wherever a step needs a hit or a kill (fire a
lethal word for a kill). Steps A.1 to A.6 use the laptop MCP alone: force-stop the green Pixel's app first,
arm from `compile.resolve()` at `$VOL,65`, and power-cycle the gun after each step.

**A.1. F509, the death `$LCD` on a non-zero slot (5 min; Min: any).** Alt-fire to slot 1, then kill the gun with one
hit. Record the frames. **Control:** the same kill on slot 0 gives a death `$LCD` with slot 0. **Pass:** the death
`$LCD` reads `0,0,0,1,<mag>,<reserve>`. Row: F509.

**A.2. F518, does a `$QUERY` reply's `$LCD` carry the live shield? (5 min; Min: any).** Arm with a `$PSET` whose t5
shield ceiling is 50, send `$SPAWN`, then `$LIFE,0,0,30,*` (expect `$HP,45,70,30`), then `$QUERY,*`. **Control:** the
`$HP` reply reads shield 30. **Read:** `$LCD` t3. If 30, the fakes (`mcp/brx_mcp/fake.py`, `app/src/fakegun.js`) are
wrong; if 0, the TraceGun twins are. Either way it is a result, not a fail: log the frame and hand it to brx4. Row:
F518.

**A.3. F510, does `$GLED` have a native blink mode? (10 min; Min: any).** Send the readout's level frame with an effect
token other than steady, at the A16 blink rate (400 ms). **Control:** the same frame with the steady token holds
still. **Pass:** the gun blinks the partial level by itself, with no further writes, until the next `$GLED`. Log each
effect token tried and what the gun did. Row: F510.

**A.4. F465, does the gun swap on ALT while stunned? (5 min; Min: any).** Write `$AMMO,0,0,0,1,*` and
`$AMMO,1,0,0,1,*` (the stun disarm), press ALT, then restore the counts and fire. **Control:** the same ALT with no
disarm swaps. **Pass:** the round leaves the slot the gun was on before the press. Row: F465.

**A.5. F466, does the stun disarm leave melee (slot 4) able to hit? (5 min; Min: any).** Write the stun's disarm rows
(A.4), then use melee on the target. **Control:** melee on an armed gun registers a hit. **Pass:** no hit registers.
Row: F466.

**A.6. F500, the refill of a class-energy weapon whose `cls` is not 5 (15 min; Min: any for the gun's timing; the
phone's watchdog is `d1d7fbce`).** Arm the Plasma Sniper (cls 2), empty the cell, hold the reload lever 1 s, and time
the refill `$ALCD` from the pull. Then the Rail Gun (cls 7). **Control:** the Energy Rifle (pl4) refills 3.5 to 3.9 s
after the pull. **Read:** if both refill on the held lever like the Energy Rifle, the watchdog fits them and the row
closes. If they reload like bullet weapons, the HUD's HOLD TO RECHARGE wording is the bug: log it for brx4. Row: F500.

**A.7. F515, a gun armed from the CLI matches MC (20 min; Min: `fa5b31d4`).** The CLI now arms MC's own compiled head.
Run `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp deathmatch <addr> 5 15 65` (Windows
Python, the default venue), then the same with `--venue indoor`; also try a
5-gun `arena` with five addresses and `3 15 65`. Pass the volume: both commands default to 69. **Control:** a
gun armed from `compile.resolve()` fires and takes hits at desk range. **Pass:** the gun shoots after the spawn and
after each respawn and can be hit; stop the run (Ctrl-C) while the gun is down, and its trigger is still released
(a cancelled respawn never leaves the trigger held); the VA3 and VA7 voice cues play; no shield hum;
the venue line prints; the 5-gun arena is refused before it connects. With no phone, a health hit is silent by design.
If the outdoor carrier (t2 70 or 85) misses at desk range, log the distance where hits start. The TDM teammate check
needs two guns: run it in C.1. Row: F515.

From here the green Pixel holds the gun in a live match, MC at 65.

**A.8. F501, a phone that reconnects into a new match (10 min; Min: `b8e68793`).** Start match A and play live. Kill
only the phone's Wi-Fi (the MC socket); keep Bluetooth up. End A on MC, then start B, and turn the phone's Wi-Fi back
on before B's T-0. **Control:** the same two matches with Wi-Fi up throughout. **Pass:** the HUD goes to B's
countdown with shots and deaths at 0, and at T-0 the gun respawns at full pools. **Fail:** the phone stays in A (no
`$PSET` or `$SPAWN` for B in its log, and A's deaths still show). 0.4.20 had this bug; 0.4.21 must pass. Row: F501.

**A.9. F511, a phone restart around a RECALL (15 min; Min: `9d3e064c`).**
1. Arm a match; close and reopen the app while ARMED, before T-0; press RECALL on MC; close and reopen the app again;
   let T-0 pass, then let the gun relink. **Pass:** the phone is in the lobby, and the gun gets no `$PSET` and no
   `$SPAWN`.
2. Restart the app while LIVE, press RECALL on MC (the abort_start case), then let the gun relink. **Pass:** the end
   frames reach the gun on relink.
3. A live player at 12 HP: restart the app twice before the gun relinks. **Pass:** the gun reads 12, not a heal to
   full.
**Control:** a RECALL with no restart sends the gun to the lobby. Row: F511.

**A.10. F493, an operator respawn about 100 ms after a death, the one-gun half (15 min; Min: `c7f08cf0`, and
`0e28ddbd` for the flash and LED timing).** A timed respawn with the normal 0.5 s weapon delay.
1. **Control (A).** Kill the player and wait out the respawn timer. **Pass:** after the weapon delay, the trigger
   fires.
2. **The bug (B), 5 times.** Kill the player, then press FORCE RESPAWN on MC within about 100 ms of the death, while
   the death scream still plays. **Pass:** a trigger pull FIRES after the respawn line and the 0.5 s weapon delay,
   5 of 5. The phone log shows the trigger-live `$BMAP,0,0` written AFTER the revive burst's `$SPAWN`. The white
   headset flash shows about 1 s after the respawn sound, not during the scream; the gun strip settles to its rest
   colour about 2.5 s after the respawn and stops breathing. The REDEPLOYED card reads ACTIVATING WEAPON SYSTEMS
   until the trigger is live, then WEAPONS HOT. A dead trigger on any try is a FAIL: log it and recover with RESYNC
   GUN.
3. **Control again (A).** One more timed respawn; the trigger fires.
The S57 half (the second gun's callout) is C.2. Row: F493.

**A.11. A late start has no phantom "armour up" (5 min; Min: `58c4d829`; carried from 0.4.20).** The match goes live
while the phone is not linked (close the app), then the phone links and its gun spawns late. **Control:** an on-time
start. **Pass:** in the first 5 s after the late spawn, no `VA1G` write in the phone log, no armour float, and the HUD
reads full health and armour. Row: none (found and fixed at the desk with the REDEPLOYED card).

**A.12. F507, the gun liveness probe at the EFF-3 count (10 min; Min: `cdd90010`).** Arm a quiet, alive player and
leave the gun untouched for 2 minutes. Count the `$LIFE,0,0,0,*` writes in the BLE frame ring. **Pass:** about 15,
all logged as `gun liveness probe`, with no `divergence poll` while the probes are answered. **Control:** no lock-up
warning while the probes are answered. Then power the gun off and log which comes first, `gun link lost` or the F272
lock-up warning (`*** gun locked: two all-zero LIFE probes went unanswered`). A powered-off gun usually drops Bluetooth first, and the lock-up check does not run with the link
down, so only a warning about 12 s after the last answer tests F272; a link that stays up while the gun goes silent
needs the screamer setup (F272 in *Not in this sitting*). Row: F507.

**A.13. F460, the gun's echo of the node's own `$AMMO` rows moves nothing (20 min; Min: `82426e56`).**
1. After a spawn and after a revive, the HUD shows slot 0 and the first ALT says SWITCHING to the secondary.
2. ALT straight after a relink re-arm (`window.brx.link.relink()`): the card stays up until the first shot.
3. ALT, a primary round inside the swap, then a secondary round, then ALT again: the HUD and the gun both go back to
   the primary.
4. `$QUERY` on the secondary reads its own counts, and the HUD keeps the trigger weapon's (the laptop reads the gun
   only after the app is force-stopped, so run 4 last).
**Control:** a plain spawn with no ALT reads slot 0 on `$QUERY` (`$LCD,45,0,105,0,52,360`-shaped). At most one round
may be missed to a lost echo; log any. Its station-revive check (X2) needs the grey Pixel: it is in Sitting C.
Row: F460.

**A.14. F308, the four recoil checks left (15 min; Min: any 0.4.21, the shipped catalogue).** (1) The Assault Rifle
at heavy 45: full auto at point blank on a second player or the target, and Tony says whether it still feels too
harsh. (2) The USP's reported magazine on a reload: `$ALCD` reads 12. (3) The Shotgun's outdoor range at t2 30 is the
field walk: not here (*Not in this sitting*). (4) Optional: a fixed-rhythm rig pull for the Burst Rifle's t23 (hand
pulls bound it at 540 to 615 ms). **Control:** the USP's magazine before the reload reads full. Row: F308.

**A.15. F349, the shield recharge feel (10 min; Min: `2c3ebb68`).** A Shields life. Take a hit that breaks part of the
shield and let it recharge. **Pass:** the Visor fills smoothly (no steps per grant), the recharge grants are silent,
N102 plays at full shield, and no "Shields Online" line plays. **Control:** the shield readout at rest before the hit.
Row: F349.

STOP POINT for Sitting A. The steps below are one-gun rows with lower value per minute.

**A.16. F50, the A17 pain gate in a real node path (10 min; Min: `3388362`; ears).** A phone-held gun, the rig
shooting. **Pass:** a hit that armour absorbs stays silent; a hit that reaches HEALTH grunts; a hit that spills
armour into health grunts; a lethal hit never grunts. **Control:** a rig word with magnitude 0 (a miss) moves no
pool and plays nothing. Row: F50.

**A.17. F226, a charge with fewer than 10 rounds (10 min; Min: any 0.4.21, `rounds_per_charge` 10).** The laptop MCP,
a charge weapon with 6 rounds in the cell. Hold a charge, then pull the reload lever twice. **Control:** from exactly
10 rounds a charge fires. **Read:** is the reload refused, or only delayed by the lockout? Log the heat and the time
to the first refill `$ALCD`. Row: F226.

**A.18. F277, a reload that never completes (15 min; Min: any 0.4.21).** The Energy Rifle on a phone-held gun.
Try to reproduce a timed-out partial reload on purpose ([`bench-plan.md`](bench-plan.md) Sitting 5 item 2). Read the
log against F445 and F436 first: a timeout is what a slot desync produces. **Pass:** a repro, or a clear "no repro
in N tries"; log every `reload partial` line. Row: F277.

**A.19. B26, does a gun with no headset fire in local play? (5 min; Min: any; Tony at the bench).** One gun, headset
removed, a local game. **Control:** the same gun with its headset fires. **Read:** fires or refuses; the answer
updates `docs/manual/fix.md` "Won't fire" step 1. Row: B26.

**A.20. S10, the L10 hold (5 min; Min: any; eyes).** On a spawned, blanked gun send `$GLED,3,3,9,0,1,,*`. **Pass:** two
clean green segments held 60 s, then the paint survives `$PLAY,VA81,4,6,,,,,*`, `$AMMO,0,30,90,1,*`,
`$HLED,6,0,,,10,,*` and `$LED,9,1,1,1,*`, sent one at a time. Never leave the gun there (F35): power-cycle it after.
Row: S10.

**A.21. F282, research: which of t25 and t26 kills the muzzle flash (10 min; Min: any; optional).** A dark room, one
gun armed from `compile.resolve()`. A/B/A each token on its own, then one try of an empty t27. **Read:** log which
token removes the flash and what an empty t27 plays. Not an MVP gate. Row: F282.

## Sitting B: the Stick (about 3 h 10 min)

**B.0. Reflash every Stick from main (15 min).** `python3 hardware/m5sticks3/tools/stick.py flash`, from a clean tree
at `795e0ba3` or later. Read each Stick's `app_ver` from `GET /api/stations`: it must be `h8-0.2+<sha>` with main's
sha, and not end in `_dirty`. This one flash carries every Stick Min below (`5c51eed7`, `0b8dc2ea`, `16a41771`,
`25aab005`, `60a52f03`, `da74ad23`, `c332b662`, `01050e27`, `214ef234`). **Control first, for any Stick still on
older firmware:** point it at MC (`python3 hardware/m5sticks3/tools/stick.py cmd 10 "MC ws://<laptop LAN address>:8766/ws"`)
and read its card or `GET /api/stations`: "STICK FIRMWARE TOO OLD: REFLASH IT". **Pass:** after the flash, that line is
gone. Log any new line in full ("STICK CANNOT SAVE TO FLASH", "ERR MC url refused", "ERR NVS"). F520 changes only
the host simulator, so it needs no reflash.

**B.1. F519, the Stick's buttons after the ButtonController refactor (20 min; Min: `5c51eed7`).** The button map, from
`hardware/m5sticks3/button_controller.h`: on STATS a 5 s A hold opens RANGE, and a B hold closes it; on home a B hold
arms the RESET confirm and a second B hold confirms it; an A click cancels a confirm; three quick B clicks REJOIN, but
only after a MUSTER drop. The Stick must be assigned for RESET (an unassigned one says "RESET: no station assigned").
Before B.1, have MC assign the Stick (any kind): RANGE and RESET both need an assignment and an MC link (an
unassigned Stick's 5 s A hold ends on home). The Stick boots to its home screen. Then, one at a time, with the
serial log on:
- (a) Unlocked, a 5 s A hold on STATS opens RANGE ("RANGE opened (A held 5 s on STATS)"). Under an MC lock the same
  hold is refused ("RANGE refused: station locked (N s left)"). A B hold closes RANGE ("RANGE closed (B hold)").
- (b) After a MUSTER drop, three quick B clicks REJOIN the Wi-Fi. Locked, they are refused ("REJOIN refused: station
  locked").
- (c) The RESET confirm arms (B hold), confirms (a second B hold sends the reset), cancels (A click), times out
  (5 s), and is refused when locked ("RESET refused: station locked (N s left)"), with the right screen for each.
- (d) A lock that arrives while the RESET confirm is armed cancels it.
- (e) Holding A and B at boot gives the "held at boot" line and no action.
- (f) Optional: with the RESET confirm armed, hold A for about 6 s and release. The firmware lets the confirm's 5 s
  timeout expire during the hold. **Pass:** no RANGE opens, no RESET is sent, and the screen ends on home or STATS
  (home if the gap between the B hold and the A press is about 0.8 s or more, STATS if it is shorter). Keep the hold
  near 6 s: a hold of 10 s or more can open RANGE legitimately, because the confirm is gone by then.
**Pass:** each sub-step shows the expected screen and serial line, and no action fires on a refusal. **Control:** an
unlocked 5 s A hold on STATS opens RANGE. Do not use a B hold on home as a control: it arms a RESET, and a second one
sends `station_action reset` to MC. Compare the serial lines with a pre-refactor build if one is to hand. Row: F519
(the row's "B hold opens RANGE" and "three A clicks" are wrong; brx4 corrects the row).

**B.2. F521, per-tick behaviour after the TickController refactor (20 min; Min: `0b8dc2ea`).**
- (a) In bench mode HILL, unassigned, the IR hill beacon goes out every 5 s (the rig receiver).
- (b) Assigned by MC as a RESPAWN station while its saved bench mode is HILL, it sends no periodic beacon for 30 s.
- (c) As a BLE hill, one capture sends exactly one capture word with the new owner's team, and a drain to neutral
  sends none.
- (d) The screen dims after its idle time, wakes on a button or an event, and does not wake on the countdown
  repaint.
- (e) The saved hill owner and clock survive a reboot mid-match.
**Control:** (a) is the control for (b). **Pass:** all five as written. Row: F521.

**B.3. F504, the saved state after the ARCH-4 refactor (10 min; Min: `16a41771`).** Arm the Stick from MC as a control
station with a lock: the MC-ARMED and lock lines show, and the heartbeat shows armed, `lock_s` and the hill. Reboot
it. **Pass:** it comes back with its config, hill and lock. Release it from MC: the RELEASED line shows. Reboot again.
**Pass:** it comes up unassigned and unlocked. **Control:** the first boot, before arming, is unassigned. Row: F504.

**B.4. F508, the Stick still redraws every live value after EFF-8 (10 min; Min: `25aab005`).** Walk the Stick through
a pickup countdown, a hill capture and hold, a lock countdown and the RANGE editor. **Pass:** every countdown second,
the battery, the link icon and the JOINING dots still update on screen, and nothing freezes. **Control:** the home
screen's battery reads the same as `stick.py status`. Row: F508.

**B.5. F388, RANGE refused under the lock (10 min; Min: `da74ad23`).** Lock the Stick at LOAD, then try a RANGE hold.
Repeat with the lock set mid-match. **Control:** unlocked, the same hold opens RANGE. **Pass:** both locked holds are
refused, and the threshold does not change. Row: F388.

**B.6. F397, the typed MC address survives a restart (5 min; Min: `60a52f03`).** Restart MC (no match ARMED or LIVE),
then restart the Stick. **Pass:** the Stick rejoins MC with no re-type. **Control:** a Stick restart with MC up
rejoins. Row: F397.

**B.7. F389, LINK OFF and MUSTER drop the socket (10 min; Min: `60a52f03`).** Once with the typed `MC ws://...` dial,
once with mDNS (mDNS cannot reach a WSL MC: run the mDNS half against a native Windows MC, or log it as not run).
`LINK MUSTER` plus a lobby push, then `LINK OFF`. **Pass:** each time the Stick's screen leaves MC, MC shows it
offline, and no socket to :8766 is left. **Control:** `LINK HELD` keeps the socket. Row: F389.

**B.8. F392, the unlocked click after LINK OFF, LINK HELD, LINK RECONNECT (10 min; Min: `60a52f03`, which logs every
PMIC write).** Run that sequence with the serial log on, then one single side click. **Control:** an unlocked click
restarts the Stick before the sequence. **Pass:** the click restarts it. On a fail, log the PMIC lines around it. Row:
F392.

**B.9. F386, MATCH OVER on the Stick (15 min; Min: `c332b662`, `01050e27`).** (a) END in a powerup match: the Stick
shows the item plus MATCH OVER and the countdown stops. (b) Stand at the Stick after END: no grant. (c) The
idle-timeout control: open STATS, wait about 18 s, then hold A; RANGE opens at 5 s. (d) After END, no phone sees the
pickup as available. Then the hill half: an early end, a MUSTER, and an offline restart each freeze the hill.
**Control:** a timed whistle freezes the hill (it passed 2026-09-26). Row: F386.

**B.10. F374, a HELD Stick carried out of Wi-Fi (10 min; Min: on main since 2026-09-25).** A second powerup arm,
carried out of Wi-Fi before START. **Pass:** it shows READY within a second, but no phone claims before
`first_at_s`. **Control:** an arm that stays in Wi-Fi shows EMPTY until START. Row: F374.

**B.11. F453, a claim lost after a successful send: a baseline (5 min; no fix yet).** `station_action` still has no
seq and no ack, so this records the loss, it does not test a fix. Pull the Stick's Wi-Fi in the second after a claim
is granted. **Read:** whether MC's feed gets the TOOK row, and the Stick's `actions_dropped` count. A lost claim is
the expected result: log it for the fix. Row: F453.

**B.12. F353, the phone side of the Stick's advert gaps (10 min; Min: any 0.4.21).** A Stick hill and one player phone
1 m away for 2 minutes. Over CDP:
`window.brx.presence.stations().map(s => ({id: s.id, kind: s.kind, gaps: s.gaps}))`. **Control:** the Stick's own
gaps measured at the desk (median 106 ms, max 953 ms). **Pass:** no phone-side gap over 1 s; log every gap over
1 s with its time. Row: F353.

**B.13. F383, the Stick hill ladder (20 min; Min: `2504d9b0` for the 3 dB exit band).** The Stick as a KOTH hill at
the -75 default (`stick.py status` reads `threshold=-75`). Each player phone, body between it and the Stick, stands
at 5, 7.5, 9 and 12 m, 3 times each, for 10 s at each mark. **Pass:** IN at 5 and 7.5 m every time, OUT at 12 m every
time, and 9 m recorded as the edge. A shortfall changes the default, never a per-phone value. Rows: F383, F440.

**B.14. H8, `held` against `muster` (20 min; Min: any 0.4.21).** Log the Stick's advert gaps (B.12's read) for 5 min in
`muster` and 5 min in `held`, and the battery percentage at the start and end of a 15 min match in each mode.
**Pass:** a measurement, not a gate: log both jitter numbers and both drains. Row: H8.

**B.15. F398, the countdown screen (5 min; Min: `60a52f03`).** On a Stick flashed in B.0 (log its sha), photograph the
countdown screen. **Pass:** the ring does not overlap NEXT SPAWN. Row: F398.

## Sitting C: two guns and the phones (about 6 h, then 3 h below the STOP POINT)

Both guns, both player phones, the grey Pixel as the station. MC at 65.

**C.1. F438, your own shot never hurts you, and Q13's team check (15 min; Min: `2ba25335`).** Indoors, a TDM match,
standard health. The victim stands 1 to 2 m from a wall and fires the sniper at it, 5 shots. **Control first:** the
other player hits the victim once, and the pools move. **Pass:** no damage to self on any of the 5 shots. Any self
`$HIR` that arrives logs `self-hit: own shot (...) took ..., restored` or `self-hit: own shot was lethal, revived
at ...`, and the HUD, MC's feed and the recap show no hit or death. A `... no revive (...): booked as a down by nobody`
line is a fail: log its reason. Then the firmware A/B: the same 5 wall shots in an FFA match (friendly fire on) and in
TDM (off). Log every `$HIR` with its shooter id and team (tokens 3 and 4). Then Q13's check 1 in the same TDM: a
teammate's shot does no damage. F515's TDM teammate check runs here too, on two CLI-armed guns, if A.7 ran. Rows:
F438, Q13.

**C.2. F493, the S57 half (10 min; Min: `0e28ddbd`).** A TDM match, the second gun nearby listening. Take a lethal hit
and press FORCE RESPAWN within about 0.1 s. **Control:** a death with no respawn names the victim on the second gun.
**Pass:** the second gun gets the DOWN_BY callout but never a DOWN naming the revived player. Row: F493.

**C.3. F439, death first (25 min; Min: `eb1541b4`).** Tony's rule: the death scream and the death stop are never cut,
and kill confirms, medals and alerts queue after it.
1. **Control.** A death on a quiet gun. **Pass:** the native scream plays, and the node log shows no `$PLAYX` at the
   death.
2. **The scream is never cut.** With two guns: A kills B; B respawns (FORCE RESPAWN), then B kills A within 1 s of
   A's next line starting (a kill confirm or a lead change). **Pass:** A hears the scream in full; a line that was
   cut plays after the scream; no `$PLAYX` is written before the scream ends. A stop after it, logged as
   `death: stop N for a body cue queued behind the scream`, is by design.
3. **The queue while dead.** While A is dead, let a lead change fire. **Pass:** it plays after the scream.
4. **Fast kills, standard health.** Bring the victim under 15 HP, then kill within about 1 s, three times. **Pass:**
   the scream is heard 3 of 3, "Health critical" never plays after it, and no `$PLAYX` is written at the death.
5. **Fast kills, Shields.** The same three times on a Shields life, the shield broken first. **Pass:** as 4, and no
   heartbeat after the scream.
6. **F3.** Empty a full-auto magazine with the trigger held. **Pass:** the RELOAD prompt shows. If not, press Share
   log before closing the app.
7. **F21.** Look at both player Pixels' status bar and display corners. **Pass:** nothing is hidden.
Log any `death: stop N for a body cue queued behind the scream` lines with their times. Rows: F439, F3, F21.

**C.4. F416, a lost spawn write at go-live (25 min; Min: `d6052bfb`).** The check closes only when the gun's `$LCD`
slot and magazine match the node's own trigger slot and live count.
- **C.4a, the gun side (laptop MCP, no phone).** Force-stop player 2's app. Power-cycle Tactix-9498, send the head
  (kit) frames from `compile.resolve()` and no `$SPAWN`. Read `$QUERY`'s `$LCD` and time its body. Then send `$SPAWN` 50 ms after the read
  and confirm it lands. **Control:** a spawned gun reads `$LCD,45,0,105,0,52,360`-shaped. **Pass:** the unspawned
  gun's `$LCD` does not match a live slot 0, and the late `$SPAWN` lands. Power-cycle the gun after.
- **C.4b, the phone side.** Three go-lives with player 2's phone about 10 m from its gun, then three with the phone
  beside it. Over CDP, call `window.brx.link.relink()` about 1 s before go-live on two starts. **Pass:** every start
  ends with a live trigger and reload. Any start that logs a `write err` also logs the spawn check's re-send and a
  closing `$LCD` match. A start with no `write err` does not test the fix: say so. **Fail:** a life with a dead
  trigger, or an undying player.
Row: F416.

**C.5. The phone-hill ladder (20 min; Min: `2504d9b0`; sets the phone hill's edge, once per station type).** The
grey Pixel on its stand as the KOTH hill (default threshold). Each player phone, body between it and the hill, stands
at 5, 7.5, 9 and 12 m, 3 times each, for 10 s at each mark. **Pass:** IN at 5 and 7.5 m every time, OUT at 12 m
every time, and 9 m recorded as the edge. If 7.5 m is not reliably IN, lower the default by the shortfall
(`STATION_DEFAULT_THRESHOLD_DBM["phone"]["control"]` in `mcp/brx_mcp/mc/types.py`, then regenerate the contract),
never per phone, and never move the Stick's value from a phone result. The steps after use this measured edge.
This ladder runs before F440 and F464 (brx1 listed F464 first) because both read the circle it measures.
Rows: F440, F383, F452.

**C.6. F440, fair presence on the phone hill (25 min; Min: `2504d9b0`, `180070a3`, `661c6a63`).** The grey Pixel stays
the KOTH hill. Read the hill's log (`player N (TEAM) IN THE CIRCLE` and `left the circle`) or
`window.brx.diag()` over CDP.
1. Player 1 alone captures within 15 s. 3 runs.
2. Both players together, on different teams: CONTESTED within about 1 s of the second arriving, and the hill's ticks
   stop. 3 runs, then swap the two phones' teams and 3 more.
3. Log each run's gap histogram for both phones from `diag()` (`gapHistogram`, `gapMedian`).
**Control:** player 2 alone captures within 15 s. Row: F440.

**C.7. F464, the hill's capture progress decays (20 min; Min: `09f55154`).** A neutral, part-built point drains at
the build rate (`HILL_DECAY_S` 10) once nobody has been counted for 0.5 s. A CONTESTED point neither builds nor
drains; an OWNED point never decays. Sample over CDP on the STATION phone:
`(()=>{window._s=[];const t=setInterval(()=>window._s.push([Date.now(),Math.round(window.brx.point.progress),window.brx.point.dir,window.brx.point.owner]),500);setTimeout(()=>clearInterval(t),60000);return 'sampling'})()`,
then `JSON.stringify(window._s)`.
1. **Control: the build.** Player 1 walks in alone. **Pass:** progress rises about 10 a second and captures; at the
   first sample after the capture, progress reads 100 and `dir` 0.
2. **An abandoned capture drains.** Walk in, then out past 12 m at about 50. **Pass:** after `left the circle`,
   progress holds about 0.5 s, then falls about 10 a second to 0; `dir` stays 0; the owner stays neutral.
3. **A contest freezes.** At about 50, player 2 walks in. **Pass:** progress holds while both are in.
4. **An owned point holds.** After a capture, both leave for 30 s. **Pass:** progress stays 100.
5. **Stray sightings, a measurement.** Player 2 alone stands 2 m outside the edge for 3 minutes. Log every capture
   and the phone's `gapMedian`. The decay does not remove every stray capture: the row's model still gives one for
   a sparse, noisy phone. So a capture here is data for the dense-advert decision, not a fail of the decay. The
   dense KOTH advert A/B (`fix/koth-dense-adverts`) is not in 0.4.21 and needs its own labelled APK.
6. **A slow-advertising phone inside the circle.** The fairness model: under 20% advert loss an inside phone loses
   about 0.15 s of capture at a 1.4 s advert interval, 0.27 s at 1.8 s and 1.07 s at 2.5 s. Read each phone's
   `gapMedian` first and use the slowest phone. A/B/A, same player, same spot: A is a capture with the phone in open
   air, B with it pocketed or behind the body. **Pass:** B's capture time is within about 1 s of A's, and the bar
   does not visibly drain while the player stands inside.
Tony's check: a player who steps out for a moment and comes back must not lose much. Row: F464.

**C.8. F434, the Stick powerup claim distance at -45 dBm (35 min; Min: `214ef234` on the Stick, B.0's flash).** Make
the Stick a Rockets powerup station with `threshold: 0`. **Control:** `stick.py cmd 3 "RANGE CLEAR" STATUS` reads
`threshold=-45 threshold_src=default`, and as a hill it reads -75. Then both phones on the rail, 30 s a rung, at 15,
30, 60 and 100 cm, 2 m and 3 m, then 30 cm and 3 m with the body between. Log the median dBm per rung. **Pass:** on
both phones, the weakest 30 cm median is at least 4 dB above -45, and the strongest 3 m median at least 4 dB below.
Owners: brx3 for the value, brx4 for the Stick. Row: F434.

**C.9. F452 (c), entry fairness across advert rates (15 min; Min: `b1645bea`; the phone hill).** Each player phone
starts at 12 m, walks to the 5 m mark and stops. Time from the stop to the hill's `IN THE CIRCLE` line, 3 runs per
phone. Read each phone's `gapMedian` from the hill's `diag()`. **Control:** a phone that stays at 12 m for 30 s is
never IN. **Pass:** a phone with a median gap of 500 ms or less enters within about 2.5 s of the stop; a slower phone
enters no slower than its pinned bound (1, 1.4 and 1.8 s: 3.75, 4.75 and 5.75 s). Row: F452.

**C.10. F444, the capture-begins alert, F448 and the hill across matches (25 min; Min: `a9e54d54`, `a13561c1`).**
- **F444.** One player walks into the empty hill. **Pass:** both HUDs show the neutral HILL CAPTURE STARTED badge with
  the capturing team's colour as capturing begins. Once that team HOLDS, the other player walks in: "Hill Contested"
  plays for the holding team only, once per contest. A DOWN player gets no hill badge. **Control:** a neutral hill
  shows no badge.
- **Across matches.** END, then NEXT MATCH. **Pass:** the hill assignment is still there, LOAD needs no reassignment,
  and in game N+1 a player still captures the same hill (F339).
- **F448.** In RECAP, press BACK TO HUD on the hill phone. **Pass:** MC's KOTH LOAD refusal and ITEMS name the hill
  that left ("WENT BACK TO HUD"); when the phone comes back as a utility node, ITEMS offers "RESTORE ▸ HILL", one tap
  restores it, and LOAD works. DISMISS clears the away line.
Rows: F444, F448, F339.

**C.11. F437, the go-live taunt plays whole (10 min; Min: `59fbaa92`).** Start a short match on both player phones,
three times. **Control:** the "3, 2, 1, GO" countdown plays. **Pass:** at go-live each gun plays the klaxon, then the
whole character line, 3 of 3. Each phone's spawn write line carries `+ klaxon (one two-slot frame)`; `+ klaxon`
without `(one two-slot frame)` is a fail. Row: F437.

**C.12. F446, the poison sounds, and F292's lethal tick (10 min; Min: `3d17791b`).** A Toxin Rifle hit on a victim.
**Control:** an ordinary hit plays its normal hit sound. **Pass:** the hit plays H12 "Bubble Acid" once, then H31 or
H32 bubbles on each tick, no voice and no cough, about 4 times, 1 s apart. A second Toxin hit during the poison plays
no second H12. Then poison a victim at low HP so a tick kills. **Pass:** one death, credited to the poisoner and booked once
on MC's feed with `dot: true`, and the scream heard. Rows: F446, F292.

**C.13. F436, a held heavy survives a resume (10 min; Min: `4c125973`).** Player 2 holds Rockets on the trigger.
**Control:** with the app in front, one pull fires a Rocket. Leave the app for Android Settings for 30 s, come back,
and call `window.brx.link.relink()`. **Pass:** the first pull after the re-arm fires a Rocket, and no
`powerup: gun fired slot 0 while ROCKETS was expected` line. Three trials. Then hold the trigger through the last
Rocket's switch-back window: log any primary round and its delay. Row: F436.

**C.14. F447, no take at the stack cap (10 min; Min: `74438c6d`).** Player 2 holds Rockets at 4. **Control:** under
the cap, a claim takes the item. **Pass:** with 4 held, a full dwell takes nothing: no `TOOK` in MC's feed, no HUD
hint, the station still offers the item. Fire one Rocket: the same claim then takes it. Row: F447.

**C.15. F417, a true race at the Stick (20 min; Min: B.0's flash).** The Stick as the Rockets station, RESPAWN 0:30,
both phones side by side at 30 cm, both PRESENT, the serial log on. At least five respawns. **Pass:** exactly one
grant per respawn; each follows an advert naming the winner; one `CLAIM station=… taker=…` serial line per grant.
For every respawn, line up the Stick's `CLAIM` lines with each phone's `powerup: station N advert state S taker T`
lines and its grant line: the taker in all three must be the same player. **Control:** one phone alone gets every
respawn. Log each phone's time to PRESENT. Row: F417.

**C.16. F399, F380 and F425 on the Stick (12 min; Min: B.0's flash; `58003151` for CONFIRMING).** Nine claims, RESPAWN
0:30. Time claim ready to the grant write. **Pass:** F399's target is a confirm within about 1 s (log all nine);
F380, a slow grant shows CONFIRMING and never NOT ANSWERING; F425, a player at the station after someone else's take
sees no countdown and no TAKEN hint. **Control:** the first claim with one phone alone. Rows: F399, F380, F425.

**C.17. F450, the Stick powerup station after the A2 alignment (10 min; Min: `daebbc42`).** Claim, then have MC
re-send `available:true` for that spawn. **Pass:** the Stick stays taken, and its advert's taken countdown floors at 1.
**Control:** a fresh spawn shows available. Row: F450.

**C.18. F461, the spawn fill's `$HP` (10 min; Min: `82426e56`).** A Shields match. Ten spawns on player 2. Count
`spawn shield fill: <n>/<max>` against `spawn shield fill: its ... was lost, so this frame is measured from the full
shield`. On three spawns, player 1 hits player 2 within 1 s. **Control:** a spawn with no hit logs the answered line.
**Pass:** every lost fill has the "measured from the full shield" line, and the HUD shield after the early hit
matches `$LIFE`. Row: F461.

**C.19. F298 and S57, a two-phone Shields fight and the callout bus (15 min; Min: `a5516c1b` for S57's 300 ms
gap).** A Shields match. **Pass (F298):** the recharge cues and the pool readout are right on both HUDs. **Pass
(S57):** each kill gives the victim's name on the other gun (the DOWN word 250 to 800 ms after DOWN_BY), with no
collision. **Control:** a single `$IRTX` callout word received alone. Rows: F298, S57.

**C.20. F459, an EMP inside a reconcile window (15 min; Min: `82426e56`).** In LOBBY, turn the stun on with
`PUT /api/config` `{"stun": {}}` (the 10 s default). Give player 1 the Charge Rifle (`charge_rifle`): with the stun on,
it is the EMP source. Player 2 is the victim.
1. **Control.** An EMP with the link up. **Pass:** the victim's log has `⚡ stunned` and, 10 s later, `stun over (`;
   the gun cannot fire in between, then fires with the magazine it had before the stun (not a refill).
2. **Inside the window.** Over CDP, call `window.brx.link.relink()`; EMP the victim within 3 s of the reconnect line in
   the log (the window opens at the reconnect, not at the call; a hit before the reconnect does not count).
   **Pass:** as the control, with one restore only. 3 trials.
3. **A stun that expires inside a window.** EMP, then call `relink()` about 7 s later. The window opens when the gun
   reconnects, not at the call, and lasts 3 s; log the `gun link lost` and reconnect times. If the reconnect takes
   over 3 s, the stun expires with the link down and the log has a plain `stun over (...)` with no re-arm clause: repeat the
   trial. **Pass:** the log has
   `stun over (...); the reconcile window's end re-arms`, and the gun fires with its live counts after the window.
4. **A held heavy.** Hold Rockets on the trigger, then repeat 2. **Pass:** the heavy cannot fire while stunned, and
   fires with its charges after the restore.
Turn the stun off (`{"stun": null}`) after. Row: F459.

**C.21. F460's X2 and F493's station profile, a station revive (10 min; Min: `82426e56`).** Make the grey Pixel a
respawn station for one life. **Pass (X2):** the trigger pull that revives a down player at the station is the revive
request, never a round: the new life shows the full magazine. **Pass (F493):** after the station revive, the
protection ends about 2 s in, and the player can be hit after that. **Control:** a timed respawn shows the full
magazine. Rows: F460, F493.

STOP POINT: the core is done. Everything below is lower value per minute.

**C.22. F463, clip timing and the hill sounds with the announcer off (15 min; Min: `eb37db15`).** (1) The baseline:
a stun, then a shield refill, then a kill line in a second voice family (set the killer's voice to heavy with
`PATCH /api/players/{id}` `{"voice":"heavy"}` in LOBBY). Record audio beside the gun and log each gap between a
clip's end and the next start. **Pass, for the clips the phone times** (the 87 ids in `app/src/clipms.gen.js`, which
include the male kill takes): each queued line starts when the clip before it ends, not early or late. The heavy
takes (V3A, V38, V39, V3K, V3L), the stun X17 (7.9 s) and VSF are not in that table and are timed at the 2.5 s default, so their gap is the
baseline for the generator change, not a fail. (2) A KOTH match with
`PUT /api/config` `{"presentation": {"preset": "silenced"}}`. **Pass:** Hill Captured, Hill Lost, Hill Contested and
the possession tick all play. **Control:** the same four on `standard`. The fifth hill sound, Hill Moved, is ungated
too but has no caller yet (rotating hills, F83), so it cannot be checked: log it as not run. Row: F463.

**C.23. F445, a USP reload just after an ALT swap (15 min; Min: `67807025`).** The USP-S as the secondary, five trials
each. A: reload the primary, ALT mid-reload, reload again 2 s later. B: ALT, then reload within 300 ms. Log the
`$ALCD` slot and magazine of every reload in every trial. **Pass:** no `reload did NOT take (timeout)` and no stuck
pips. If B times out, the `$ALCD` slot shows which slot the gun reloaded (the cure is to settle the reload on the
swap's target slot). **Control:** a reload with no ALT. Row: F445.

**C.24. F443 and F365, the station's holds (10 min; Min: `9c3f61d8`).** The phone station MC-locked in play.
**Control:** RANGE opens only after the 5 s hold. **Pass:** MC LINK also needs the 5 s hold. Then, with no match
loaded: a tap and a knock do nothing, a 1.5 s hold opens RANGE, and the edit reaches MC (EDITED ON STATION). Rows:
F443, F365.

**C.25. F442 and F396, the Rockets pip and timer (5 min; Min: `a9e54d54`, `e59df610`).** Hold Rockets and fire one.
**Control:** a primary dims, then shines green once when the next round is due. **Pass:** the Rockets' gauge does the
same. After a respawn with Rockets held, the timer does not jump. Rows: F442, F396.

**C.26. F379, the ALT pointer after a Rocket (5 min; Min: `58003151`).** ALT onto the secondary with no shot, take
Rockets, empty them, ALT once. **Control:** an ALT with no pickup lands where the phone expects. **Pass:** the gun's
next `$ALCD` slot matches the phone's target, and no stale switch-back re-send follows. Row: F379.

**C.27. NIGHT OPS from a LOBBY edit (5 min; Min: `aab05a8e`).** On a phone whose player has not tapped the skin switch
this session, set NIGHT in LOBBY. **Control:** before the edit, `engine.config.night` is false on both phones.
**Pass:** `engine.config.night` turns true
on both phones, and START turns the HUD to night at ARMED. Row: none (bench 2026-10-02's night note).

**C.28. F237, the Pixel 5 relink (5 min; Min: any 0.4.21).** With the app running (no force-stop), re-pick the gun 5
times. **Pass:** linked within 3 s every time; log the timer breakdown for any slow one. Row: F237.

**C.29. F152, the headset's out blink stops at each spawn (in any match; Min: `0d58d92f`).** Watch the headset over 5
respawns. **Pass:** the out blink stops at each `$SPAWN`. Row: F152.

**C.30. F342, the scan-flood baseline (20 min; Min: any 0.4.21; a measurement for Tony's decision).** A KOTH match,
every phone on the hill, 5 minutes. Per phone: adverts heard per second, scan restarts, flood-guard trips and hill
presence gaps; the gun's write latency and dropped writes. **Pass:** a measurement, not a gate: log every number,
every flood-guard trip and every dropped write. A trip alone is not a fail; the numbers go to Tony's F342 decision.
Row: F342.

**C.31. F294, first contact through the sweep (5 min; Min: `5609ac30`).** `adb -s <ip:port> shell pm clear
com.openbrx.companion` on one player phone (this wipes its saved MC address and gun pairing), then open the app and
type no address. **Pass:** "MISSION CONTROL FOUND BY SWEEP" and bound within about 10 s. A miss is a FAIL; its
`sweep` lines say whether a gun-connect pause or silent probes caused it. Re-pair the gun after. Row: F294.

**C.32. F345, the respawn radius is about 3 m on each platform (10 min; Min: any 0.4.21; B.0's flash).** The phone
station and the Stick as RESPAWN, MC's threshold left at 0. **Control:** the phone station's log reads `threshold -70
dBm`, and the Stick's STATUS reads `threshold=-57`. Walk a down player phone in from 6 m toward each. **Pass:** the
player log's `PRESENT at <rssi>` line appears at about 3 m (2.5 to 3.5 m), and the `left` line within about 1 m past
the edge on the way out. Row: F345.

**C.33. F293, a second phone's SCAN AGAIN during a headset join (20 min; Min: any 0.4.21).** A/B/A, one gun and its
headset, the second phone standing by ([`bench-2026-09-24.md`](bench-2026-09-24.md) step 1.5). A: power-cycle the
gun and headset; while the first phone connects and the headset still joins, the second phone taps SCAN AGAIN. B: the
same with the second phone idle. A again. Log loop yes or no and the headset join time per run. **Pass:** the question is answered only
if A differs from B. If any run loops, run step 1.3's bugreport A/B/A from that sheet. Do not close F293 here:
log the result, and brx2 (the owner) decides. Row: F293.

**C.34. F525, a silent hill point yields at once (15 min; Min: `38b02742`, so a build newer than 0.4.21).** Two
control points about 2 m apart: the grey Pixel and a Stick as a Bluetooth hill (B.0's flash). Point A is held by red,
point B by blue, so the HUD shows which point player 1 reads. Player 1 stands where both circles overlap, and reads A
first (A on, then B on). Stop A's adverts (force-stop the grey Pixel's app, or power off the Stick). 5 runs, start a
stopwatch at the stop. **Pass:** each run, player 1's HUD moves to B's owner between about 2 and 3 s after the stop,
and never later than 4 s. **Control:** with both points on, player 1 stays on A for 60 s without a flip. Row: F525.

**C.35. F526, a taken station does not hide a claimable one (15 min; Min: `13e94419`, so a build newer than 0.4.21).**
Two powerup stations 30 cm apart: the Stick as Rockets and the grey Pixel as a second item, both RESPAWN 0:30. Player 2
claims the Stick's item, so it is taken. Player 1 then stands in both circles, nearer the Stick. 5 runs. **Pass:** each
run, player 1's claim ring runs at the grey Pixel's station, the phone log says `powerup: claim ready at station <the
grey Pixel's id>`, and the item is granted. **Control:** with both items there, player 1 claims the nearer (Stick)
station. Row: F526.

**C.36. O1 and O2, the console's restore and armory banners (15 min; no gun; last, after END).** Stop the bench MC
first, then in a scratch home:
`mkdir -p ~/brx-o-check && printf '{"broken' > ~/brx-o-check/armory.json && printf '{"v":' > ~/brx-o-check/session.json`,
then `cd mcp && BRX_MCP_HOME=$HOME/brx-o-check ../.venv/bin/python -m brx_mcp.mc --no-auth`.
1. **O1.** **Pass:** the banner prints "session file could NOT be restored (" and "kept at <path>"; ARMORY shows
   "SESSION FILE COULD NOT BE RESTORED, THE ROSTER STARTED EMPTY"; `session.json.bad-<stamp>` exists.
2. **O2.** **Pass:** ARMORY shows "ARMORY FILE IS CORRUPT: BACKUP AT <path>: ...". It survives a restart. DISMISS
   clears it and leaves `armory.json.dismissed-<stamp>`.
**Control:** a scratch home with no files shows neither banner. Delete `~/brx-o-check` at the end. Row: none.

## Not in this sitting

These open MVP BENCH rows need a setup this sheet does not have. Each keeps its procedure where the row points.

| Row | Needs | Pass rule, in short | Procedure |
|---|---|---|---|
| B21 | the MacBook | `BrxDebugPlugin.swift` compiles and runs | [`bench-mac-2026-09-29.md`](bench-mac-2026-09-29.md) step 1 |
| F232 | the rig, outdoors or a range | misses do not cluster on pulls 1 and 2 | the row's probe |
| F264 | two guns, a stall repro | the two-frame revive cures a real stall, and the next death is not dark | [`bench-plan.md`](bench-plan.md) Sitting 5 item 1 |
| F269, F270 | the laptop, `raw-bytes` | the paced A7/A8 halves | [`bench-2026-09-24.md`](bench-2026-09-24.md) Block 2 |
| F272, F274 | screamer and soak runs | A1c, A13, three two-hour soaks | [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md) |
| F322 | the IR rig | what one protocol-9/10 hit sends from the victim's headset | [`bench-2026-09-24.md`](bench-2026-09-24.md) Block 2b |
| F449 | the IR rig | reflash board B, then `--gap` reads as a time | the row |
| F340 | the Android 11 Pixel | the picker shows TURN ON LOCATION and finds the gun once Location is on | [`bench-2026-09-24.md`](bench-2026-09-24.md) step 4.15 |
| F311, F309 | a no-internet field Wi-Fi, cellular | the phone stays bound on LAN; the transport counts | the rows |
| F296 | eyes, a down player | the slow re-arm reads as "down", not a hit | the row |
| F275, F231 | outdoor space | the t13 and t2 ladders (Tony picks t2 30 or 40) | [`bench-plan.md`](bench-plan.md) Sitting 10 |
| F308 (3) | outdoor space | the Shotgun's range at t2 30 | the row |
| F464 (dense adverts) | a labelled `fix/koth-dense-adverts` APK | capture rate against gun write latency; sets the KOTH scan budget | the row |
| F452 (b) | 64 advertisers | the Stick loop under a 64-player flood (the kit makes a lower bound only) | the row |

## Close

Follow the bench-session skill's close: a results table with each control, then the three writes (one log entry,
one FOLLOWUPS diff, the HANDOFF lane), and strike the steps that ran here and in [`bench-plan.md`](bench-plan.md).
