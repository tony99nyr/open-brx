# Bench sheet: the re-bench on APK 0.4.19

Updated: 2026-10-05. This sheet supersedes [`bench-rebench-2026-10-04.md`](bench-rebench-2026-10-04.md) once 0.4.19
exists. The 0.4.18 sheet never ran, so every one of its steps is carried here, marked "carried from 0.4.18", next to
every bench-gated fix that landed after 0.4.18 (`1b0f6dca`). It stands alone: kit, setup, steps in priority order,
each with a control, a pass rule and its FOLLOWUPS row. The row holds the history and the fix; this sheet holds the
procedure. How a bench run works with Tony: the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md).
The index is [`bench-plan.md`](bench-plan.md).

**Time:** about 5 h 5 min for the core (setup and steps 1-16), plus about 1 h 50 min below the STOP POINT.

## Kit

- Two guns with their headsets: Tactix-FE30 (player 1, red) and Tactix-9498 (player 2, blue).
- Three Pixel 5s, in the 2026-10-02 roles: the black Pixel is player 1, the green Pixel player 2, and the grey Pixel
  the phone station (the powerup station, then the KOTH hill), on its charger. Phones ride on the rail.
- The iPhone X, only for steps 5 and 24, and only with a build of the same main
  ([`bench-mac-2026-09-29.md`](bench-mac-2026-09-29.md) holds the Mac side).
- Every M5StickS3 on USB, for the firmware floor (setup step 4) and step 17. Optional: one player-sim board
  ([`hardware/player-sim/README.md`](../hardware/player-sim/README.md)) for step 17.
- This box: WSL for MC and the tools, Windows Python for anything that touches a gun
  (`/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`, [`wsl-dev-runbook.md`](wsl-dev-runbook.md)).
- A tape measure (the hill ladder needs 12 m), a stopwatch, and a wall for the self-hit step.

## Method (it worked on 2026-10-02; keep it)

- **Drive MC through its API**, not by clicking, except where a step tests the console itself. Every non-GET
  `/api/*` call takes `Authorization: Bearer <token>` (the token is in MC's boot banner; `mcp/brx_mcp/mc/API.md`).
- **Read each phone's log over CDP** after each step, before the next one starts:
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe mcp/tools/webview_eval.py "window.brx.log.slice(-40)" --serial <ip:port>`.
- **Read a gun's pools with `$LIFE,0,0,0`** (a read probe). The laptop MCP reaches a gun only while no phone
  holds it: force-stop that phone's app first. Arm a laptop-held gun from `compile.resolve()`, never from a capture.
- **Volume: MC runs the whole sheet at `--bench-volume 80`** (Tony's level since 2026-10-02, ears at arm's length).
  A step whose row names another level says so; log the level each audio step used.
- Never end on a bare `$CLEAR`. Power-cycle any gun the laptop armed. Never restart MC while a match is ARMED or
  LIVE.

## Setup (about 40 min)

1. **Re-pair adb.** The phones were off overnight, so the old `ip:port` pairs are gone. On each Pixel: Developer
   options → Wireless debugging → *Pair device with pairing code*. Tony reads out the pairing `ip:port` and code;
   run `adb pair <ip>:<pairing port> <code>`. Then Tony reads the connect `ip:port` from the Wireless debugging
   screen; run `adb connect <ip:port>`. Check with `adb devices`: three phones, each `device`.
2. **Install 0.4.19 on all three:**
   `adb -s <ip:port> install -r /home/tony/apk-0.4.19/brx-companion-0.4.19-android-release.apk`. The same
   release key installs over 0.4.18 with no uninstall. Log each phone's version:
   `adb -s <ip:port> shell dumpsys package com.openbrx.companion | grep versionName`. Log the APK's sha (the `git`
   field of `/home/tony/apk-0.4.19/build.json`). **Build check:** three fixes were not on main when this sheet was
   written. For each, run the check against that sha from the main checkout and log yes or no:
   - Step 6 (F464, the hill decay): `git grep -c HILL_DECAY_S <sha> -- app/src/transport/contract.gen.js`.
   - Step 10 (F473, the pickup names its spawn): `git grep -c next_spawn_in_s <sha> -- app/src/powerup-player.js`.
   - Step 16 (F463, Tony's hill-sound ruling, MC side): `git grep -n '"hill_captured".*ungated=True' HEAD -- mcp/brx_mcp/mc/presentation.py`
     in the checkout MC runs from.

   A fix that is not in the build: skip its step, or run it as a baseline and say so in the log.
3. **Run `./start.sh --setup-only` ONLINE once**, from the main checkout, before MC starts. O19 (`45375f94`,
   `4fe5b122`, `c9343eb2`, `71bd2f24`) pins every Python dependency in `mcp/constraints.txt` (bleak 3.0.2 and the
   rest) and installs with `pip install -c mcp/constraints.txt`. The install stamp hashes that file, so the first
   run after the pins reinstalls. The update question now defaults to no: answer no (main is already pulled).
   **Pass:** the run prints "Mission Control package is installed". **Fail:** "could not update Python packages,
   starting with the installed ones": fix the network and run it again before the session.
4. **Reflash every Stick from main, and see the firmware floor.** MC's floor is `STATION_MIN_FW` "h8-0.2"
   (`mcp/brx_mcp/mc/types.py`). **Control first, for any Stick still on older firmware:** start MC (step 5), point
   that Stick at it (`python3 hardware/m5sticks3/tools/stick.py cmd 10 "MC ws://<laptop LAN address>:8766/ws"`)
   and read its station card, or `GET /api/stations` → `attention`. **Pass:** "STICK FIRMWARE TOO OLD: REFLASH IT".
   Then flash it: `python3 hardware/m5sticks3/tools/stick.py flash`. Read its `app_ver` from `GET /api/stations`:
   it must be `h8-0.2+<sha>` and match main's sha. Reflash from a clean tree if it ends in `_dirty`. **Pass:** the
   TOO OLD line is gone. A Stick already on h8-0.2 is still reflashed from main; log its string. Log any other new
   line with its full text: "STICK CANNOT SAVE TO FLASH [N FAILED WRITE(S)], A RESTART LOSES ITS SETTINGS: REPLACE
   IT" on the console, "ERR MC url refused: <why> (saved url unchanged)" and "ERR NVS <key> write failed (<got> of
   <want> bytes)" on the Stick's serial port ([`bench-stick-2026-09-29.md`](bench-stick-2026-09-29.md) step 3).
   This build carries two Stick changes from 2026-10-05: a claim is matched on the low byte of the station id, as
   the phone does (`244a71e7`), and a powerup `station_config` with an id outside 1..255 is refused (`a317bb37`) with
   "station_config REFUSED: powerup station id outside 1..POWERUP_STATION_ID_MAX". MC never sends such an id, so
   that line is a fail if it appears. Optional check: assign the Stick as a powerup station with MC's normal id; it
   arms, and a claim is granted.
5. **Start MC from the latest `main`**, with no match ARMED or LIVE anywhere, detached from the agent shell:
   `cd mcp && setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume 80 > ~/mc-$(date +%Y%m%d-%H%M).log 2>&1 &`.
   Rebuild `webapp/mc/dist` first if it is older than main. Powerups are on by default. **Pass:** the banner says
   "BENCH VOLUME 80". Log the banner, the token and MC's sha.
6. Each player phone joins MC and runs SET MY GUN with its own gun. The station Pixel becomes the phone powerup
   station: in ARMORY, **Rockets, RESPAWN 0:30**.
- **Log:** the three versions, the APK sha and the three build checks, the start.sh result, every Stick's
  `app_ver`, MC's sha and banner, the station's id and item.

## Steps, in priority order

**1. F416, a lost spawn write at go-live (P0; 25 min; carried from 0.4.18).** The fix: positive pools no longer close
the spawn check; it closes only when the gun's `$LCD` slot and magazine match the node's own trigger slot and live
count.
- **1a, the gun side (one gun, the laptop MCP, no phone).** Force-stop player 2's app. Power-cycle Tactix-9498, send
  the head (kit) frames and no `$SPAWN`. Read `$QUERY`'s `$LCD` and time its body. Then send `$SPAWN` 50 ms after the
  read and confirm it lands. **Control:** a spawned gun reads `$LCD,45,0,105,0,52,360`-shaped (slot 0, full mag).
  **Pass:** the unspawned gun's `$LCD` shows a slot or magazine that does not match a live slot 0, and the late
  `$SPAWN` lands. Power-cycle the gun at the end.
- **1b, the phone side.** Three go-lives with player 2's phone about 10 m from its gun (the distance that gave the
  2026-09-26 write error), then three with the phone beside it. Over CDP, call `window.brx.link.relink()` about 1 s
  before go-live on two of the starts, to force a drop mid-burst. **Pass:** every start ends with a live trigger
  and reload (one shot, one reload). Any start that logs a `write err` must also log the spawn check's re-send and
  a closing `$LCD` match. A start with no `write err` does not test the fix: say so in the log. **Fail:** any life
  with a dead trigger, or an undying player (a 0 pool must still book a death).
Row: F416.

**2. F438, your own shot never hurts you, and the team-damage check (15 min; carried from 0.4.18).** Indoors, a TDM
match, standard health. The victim stands 1-2 m from a wall and fires the sniper at it, 5 shots. **Control first:**
the other player hits the victim once, and the pools move. **Pass:** no damage to self on any of the 5 shots. Any
self `$HIR` that arrives logs `self-hit: own shot (...) took ..., restored` or
`self-hit: own shot was lethal, revived at ...`, and the HUD, MC's feed and the recap show no hit or death. A
`... no revive (...): booked as a down by nobody` line is a fail: log its reason. Then the firmware A/B: the same 5
wall shots in an FFA match (friendly fire on) and in TDM (off). Log every `$HIR` with its shooter id and team
(tokens 3 and 4), and whether the gun applied it. Then Q13's check 1 in the same TDM: a teammate's shot does no
damage. Rows: F438, Q13.

**3. F439, 11.8 in full: death first (25 min; carried from 0.4.18).** Tony's rule: the death scream and the death
stop are never cut, and kill confirms, medals and alerts queue after it.
1. **Control.** A death on a quiet gun (no line playing). Pass: the native scream plays, and the node log shows no
   `$PLAYX` at the death.
2. **The scream is never cut.** B kills A while A's own kill confirm plays (A kills C, then B kills A within 1 s).
   Pass: A hears the scream in full; A's kill line, if cut, plays after the scream; no `$PLAYX` after the death
   until the respawn.
3. **The queue while dead.** While A is dead, let a lead change fire. Pass: it plays after the scream, not over it.
4. **Fast kills, standard health.** Bring the victim under 15 HP, then kill within about 1 s, three times, so the
   low-health alert is in flight at the death. Pass: the scream is heard 3 of 3, "Health critical" never plays
   after it, and no `$PLAYX` is written at the death.
5. **Fast kills, Shields.** The same three times on a Shields life, the shield broken first, so the shield-down
   heartbeat is in flight. Pass: as 4, and no heartbeat after the scream.
6. **F3.** Empty a full-auto magazine with the trigger held. Pass: the RELOAD prompt shows. If not, press Share
   log before closing the app.
7. **F21.** Look at both player Pixels' status bar and display corners on the HUD. Pass: nothing is hidden.
- **Log:** a pass or fail per sub-step, and any `death: stop N for a body cue queued behind the scream` lines with
  their times. Rows: F439, F3, F21.

**4. F440, fair presence on the phone hill (25 min; carried from 0.4.18).** Release the station Pixel from the
powerup role and assign it as the KOTH hill (default threshold). Read the hill's log
(`player N (TEAM) IN THE CIRCLE` and `left the circle` lines) or `window.brx.diag()` over CDP, and each player's
`advertising as player` lines. The entry is now time-based (F452(c), step 5), so log entry times here too.
1. Player 1 alone at the hill captures within 15 s. 3 runs.
2. Both players together, on different teams: CONTESTED at once (within about 1 s of the second arriving), and the
   hill's ticks stop. 3 runs, then swap the two phones' teams and 3 more.
3. Record each run's gap histogram for both phones from `diag()` (`gapHistogram`, `gapMedian`).
**Control:** player 2 alone captures within 15 s (the 2026-10-02 fault followed the black Pixel). Row: F440.

**5. F452 (c), entry fairness across advert rates (15 min; same hill).** The fix: the entry EMA is time-based with a
500 ms cap (`PRESENCE_ALPHA_REF_MS` 250, `PRESENCE_ALPHA_DT_CAP_MS` 500), so a phone that advertises less often
enters about as fast. The row has no phone-bench text; this step is derived from its pinned numbers: "100, 250 and
500 ms enter within one tick; 1, 1.4 and 1.8 s enter no slower than 3.75, 4.75 and 5.75 s". Each player phone (and
the iPhone, if it has a build of the same main) starts at 12 m, walks to the 5 m mark at a steady pace and stops.
Start the stopwatch at the stop; stop it at the hill's `IN THE CIRCLE` line. 3 runs per phone. Read each phone's
`gapMedian` from the hill's `diag()`. **Control:** a phone that stays at 12 m for 30 s is never IN. **Pass:** a phone
whose median gap is 500 ms or less enters within about 2.5 s of the stop (the pinned 2250 ms plus one 250 ms tick);
a slower phone enters no slower than the pinned bound for its gap. The walk adds its own fading, so compare phones
on the same walk and log both numbers. Row: F452.

**6. F464, the hill's capture progress decays, and the exit grace (20 min; same hill; only if the build check
found `HILL_DECAY_S`).** Pending Tony's pick: this step tests option 1. A neutral, part-built point drains at
the build rate (`HILL_DECAY_S` 10, so 10 points a second) once nobody has been counted for 0.5 s. There is no
separate exit rule. A CONTESTED point neither builds nor drains; an OWNED point never decays; the advert's direction
bits stay 0 while it drains. If Tony picks another option, rewrite this step before the run. Sample the hill over CDP
on the STATION phone (`window.brx.point` exists only there), then read the samples after the run:
`(()=>{window._s=[];const t=setInterval(()=>window._s.push([Date.now(),Math.round(window.brx.point.progress),window.brx.point.dir,window.brx.point.owner]),500);setTimeout(()=>clearInterval(t),60000);return 'sampling'})()`,
then `JSON.stringify(window._s)`.
1. **Control: the build.** Player 1 walks in alone. Pass: once counted, progress rises about 10 a second and
   captures. **F456 in the same run:** at the first sample after the capture, progress reads exactly 100 and `dir`
   reads 0 (held and still, not rising). The old bug needed a step that landed just under 100, so a real run rarely
   hits it: a pass means no counter-example. The desk gates are `app/test/control.test.mjs` and the Stick's
   `test_presence.cpp`.
2. **An abandoned capture drains.** Player 1 walks in, then walks out past 12 m at about 50. Pass: after the
   `left the circle` line, progress holds for about 0.5 s, then falls about 10 a second to 0 (about 5.5 s from 50).
   `dir` stays 0, and the owner stays neutral. **F456's bottom half:** the sample where progress reads 0 has `dir` 0,
   not -1.
3. **A contest freezes.** At about 50, player 2 (the other team) walks in. Pass: progress holds still while both
   are in.
4. **An owned point holds.** After a capture, both players leave for 30 s. Pass: progress stays 100 and the owner
   does not change.
5. **Stray sightings (the bug).** Player 2 alone stands 2 m outside the edge the ladder measured (12 m until step 18
   runs) for 3 minutes. Pass: no capture; progress falls back to 0 between sightings.
- **Tony's check at the bench:** a player who steps out for a moment and comes back must not lose much. If the
  0.5 s delay feels wrong on the hill, log what he wants instead. Rows: F464 (on its branch until it lands), F456 (closed at the desk; this is its first bench).

**7. F444 the capture-begins alert, then F448 and the hill across matches (25 min; same setup; carried from
0.4.18).**
- **F444.** One player walks into the empty hill. **Pass:** both HUDs show the neutral HILL CAPTURE STARTED badge
  with the capturing team's colour (by day a block with the team token and initial; at night the initial in a red
  outline), at the moment capturing begins. Once that team HOLDS the hill, the other player walks in: the "Hill
  Contested" voice plays for the holding team only, once per contest. A DOWN player gets no hill badge; a hill voice
  line still queues after the scream. **Control:** a neutral hill (players in another room) shows no badge.
- **The hill across matches.** End the match, then NEXT MATCH. **Pass:** the hill assignment is still there, and
  LOAD needs no reassignment (pinned on main at `c5840639`).
- **F448, RESTORE.** In RECAP, press BACK TO HUD on the hill phone. **Pass:** MC's KOTH LOAD refusal and the ITEMS
  panel name the hill that left (its label and why: "WENT BACK TO HUD"). When the same phone comes back as a utility
  node, its ITEMS card offers "RESTORE ▸ HILL"; one tap restores the hill with its old id, and LOAD works. RESTORE
  never happens by itself. DISMISS clears the away line. Rows: F444, F448.

**8. F459, an EMP inside a reconcile window (15 min).** In LOBBY, turn the stun on with `PUT /api/config`
`{"stun": {}}` (the 10 s default), and give player 1 the Charge Rifle (`charge_rifle`): with the stun on, it is
the EMP source and deals no damage. Player 2 is the victim. The row's bench step: "kill the link, relink, EMP the
player inside the 3 s window, check the gun cannot fire until the stun ends and then fires with its live counts."
1. **Control.** An EMP with the link up. Pass: player 2's log has `⚡ stunned` and, 10 s later, `stun over (`; the gun
   cannot fire in between, then fires with the magazine it had before the stun (not a refill).
2. **Inside the window.** Over CDP on player 2, call `window.brx.link.relink()`; player 1 EMPs player 2 within 3 s.
   Pass: as the control, with one restore only. 3 trials.
3. **A stun that expires inside a window.** EMP player 2, then call `relink()` about 9 s later. Pass: the log has
   `stun over (...); the reconcile window's end re-arms`, and the gun fires with its live counts after the window.
4. **A held heavy.** Player 2 holds Rockets on the trigger, then repeat 2. Pass: the heavy cannot fire while
   stunned, and fires with its charges after the restore (the row: it goes back on the trigger at zero charges until
   the expiry restore).
Turn the stun off (`{"stun": null}`) before step 9. Row: F459.

**9. F460, the gun's echo of the node's own `$AMMO` rows moves nothing (20 min).** One gun and a phone. The row's
checks, quoted:
1. "after a spawn and after a revive, the HUD shows slot 0 and the first ALT says SWITCHING to the secondary";
2. "ALT straight after a relink re-arm, the card stays up until the first shot" (`window.brx.link.relink()`);
3. "ALT, a primary round inside the swap, then a secondary round, then ALT again: the HUD and the gun both go back
   to the primary";
4. "`$QUERY` on the secondary reads its own counts, and the HUD keeps the trigger weapon's" (the laptop reads the
   gun only after the phone app is force-stopped, so run 4 last).
5. **X2, a station revive.** Make the grey Pixel a respawn station for one life: "the trigger pull that revives a
   down player at a respawn station is the revive request, never a round". Pass: the new life shows the full
   magazine.
**Control:** a plain spawn with no ALT reads slot 0 on `$QUERY` (`$LCD,45,0,105,0,52,360`-shaped). Watch for a lost
echo: at most one round may be missed; log any. Row: F460.

**10. F473, a real pickup with the phone clock skewed; F454, one TOOK row per take (15 min; only if the build
check found `next_spawn_in_s`).** The grey Pixel back as the Rockets station, RESPAWN 0:30. The fix: a phone's
`pickup` fact carries `next_spawn_in_s`, and MC credits the spawn nearest the fact's event time plus that countdown,
within `PU_NAMED_SPAWN_TOL_MS` (8 s). The row has no bench text; this step is derived from the code. To make the
phone's fact the only one MC sees, turn the station Pixel's Wi-Fi off (Bluetooth stays on) just before each take,
and turn it back on inside the 30 s interval. The sheet assumes the station queues its `taken` report while off
Wi-Fi; nobody has read that code, so log what happens when Wi-Fi returns.
1. **Control, no skew.** Player 2 takes Rockets with the station off Wi-Fi. Pass: within a few seconds MC's feed has
   one `<player> TOOK ROCKETS · STATION #<id>` row, and `GET /api/stations` shows `taken_by` = player 2's number and
   no `item_available`. Turn the station's Wi-Fi back on: its report adds no row.
2. **The phone clock trails MC at the respawn (the bug).** The old code lost a take only when the grant landed within
   the skew AFTER a respawn, so a mid-interval take proves nothing. Player 2 stays in range after step 1. About 4 s
   before the next spawn, over CDP on player 2: `window.brx.transport.clock.offset -= 5000;
   window.brx.transport.clock.offset` (the 8 s tolerance still covers 5 s; the clock pulls the skew back by about a
   fifth every 5 s). The item respawns, player 2 claims (1 s dwell) and is granted about 1 to 2 s later, station
   still off Wi-Fi. Then add the 5000 back. Pass: one TOOK row naming player 2, `taken_by` 2, and no
   `powerup pickup at station ... names no spawn ...: refused` line in MC's log. Skip the step if the phone does not
   log `powerup: claim ready`. On a build without the fix this take is lost: no TOOK row, and MC still shows the item
   available.
3. **The phone clock leads MC (a control).** The same with `+= 3000`. MC clamps a future time to its receive time, so
   this cannot fail on either build. Pass: as 2.
4. **F454, one TOOK row per take.** A phone grants only when the station's advert names that player, so the phone's
   fact and the station's report agree at the bench, and MC then sends no `feed_edit`. Pass, on every take in this
   sheet: exactly one TOOK row for that spawn, naming the player whose HUD got the grant; `taken_by` is that player;
   the station's later report adds no row. After the recap, restart MC (never mid-match) and read the feed: still
   one row. The "station wins on disagreement" case is a desk pass only (`powerup-station-cases.json`, `mc` cases);
   do not claim it here.
Rows: F473 (on its branch until it lands), F454 (closed at the desk; this is its first bench).

**11. F436, a held heavy survives a resume (10 min; carried from 0.4.18).** Player 2 claims Rockets and holds them on
the trigger. **Control:** with the app in front, one pull fires a Rocket. Then leave the app for Android Settings
for 30 s and come back, and force the reconcile with `window.brx.link.relink()`. **Pass:** the first pull after the
re-arm fires a Rocket, and the log has no `powerup: gun fired slot 0 while ROCKETS was expected` line. Three trials.
**Then the open question:** hold the trigger on the last Rocket and keep holding through the empty switch-back's
swap window. Does the primary fire by itself when the window ends? Log any primary round and its delay. Row: F436.

**12. F447, no take at the stack cap (10 min; carried from 0.4.18).** Player 2 holds Rockets at the cap of 4 (two
claims; RESPAWN 0:30 brings the item back). **Control:** under the cap, a claim takes the item (to 4). Then stand on
the station for the full dwell with 4 held. **Pass:** no take, no `TOOK` line in MC's feed, no HUD approach hint, and
the station still offers the item. Fire one Rocket: the same claim now takes it (back to 4). Camping stays allowed
under the cap. Row: F447.

**13. F437, the go-live taunt plays whole at volume 80 (10 min; carried from 0.4.18).** MC is already at 80 from
setup. Start a short match on both player phones, three times. **Control:** the "3, 2, 1, GO" countdown plays.
**Pass:** at go-live each gun plays the klaxon, then the whole character line (for example "no where to hide", not
"no.."), 3 of 3 starts. Log each phone's spawn write line: it must carry `+ klaxon (one two-slot frame)`; a line with `+ klaxon`
but without `(one two-slot frame)` is a fail. Row: F437.

**14. F446, the poison sounds (10 min; carried from 0.4.18).** A Toxin Rifle hit on a victim. **Control:** an
ordinary hit plays its normal hit sound. **Pass:** the hit plays H12 "Bubble Acid" once. Then H31 or H32 bubbles
play on each tick, with no voice and no cough, about 4 times, 1 s apart (the first tick may yield to H12 still
playing). A second Toxin hit during the poison plays no second H12. Log whether a tick cut another clip (it must
not). Then F292's lethal tick: poison a victim at low HP so a tick kills. **Pass:** one death, booked once on MC's
feed, with the scream heard. Rows: F446, F292.

**15. F461, does the gun ever drop the spawn fill's `$HP`? (10 min).** A Shields match. The row's bench step: "On a
Shields spawn, log how often the fill's `$HP` is missing, and whether a hit can arrive before the gun applies the
fill." Ten spawns (deaths and respawns) on player 2. Count the two log lines: `spawn shield fill: <n>/<max>` (the fill
answered) and `spawn shield fill: its` ... `was lost, so this frame is measured from the full shield` (it did not).
On three of the spawns, player 1 hits player 2 within 1 s of the respawn. **Control:** a Shields spawn with no hit
logs the answered line and the HUD shows a full shield. **Pass:** every lost fill is followed by the "measured from
the full shield" line, and the HUD shield after the early hit matches `$LIFE`. Log the lost count of 10. Row: F461.

**16. F463 (A8), time every clip on the gun, and the hill sounds with the announcer off (15 min).**
1. **The clip timing, a baseline on today's build.** The row's bench step: "one gun at `$VOL,65`, a stun then a
   shield refill, then a kill line in a second voice family. Pass: each queued line starts when the clip before it
   ends, not early or late." This sheet runs at 80; log that. No build times the whole catalogue yet:
   `app/src/clipms.gen.js` holds only the golden bundle's ids plus `EXTRAS`, and every other id is timed at the
   2.5 s default. So this run records the baseline for the generator change, not a pass against the real lengths.
   - **Setup.** In the LOBBY, set the killer's voice to heavy: the console KIT select `voice for <name>`, or
     `PATCH /api/players/{id}` `{"voice":"heavy"}` (it returns 409 once armed; `GET /api/voices` lists the
     options). Keep the `standard` preset (`silenced` mutes the kill line). A Shields match, the step 8 stun setup.
   - **Run.** Kill 5 to 8 times. The node picks one kill take each time, so read the `$PLAY` id from the phone log
     for each kill. Heavy takes and their real lengths: V3A 0.79 s, V38 1.01 s, V39 1.21 s, V3K 1.72 s, V3L 1.83 s.
     Record audio on a phone beside the gun to time each line's real start against the `write` lines.
   - **Control.** The male voice (VA, the default): its kill takes are timed, so back-to-back lines start with no
     gap or overlap.
   - **Expected.** After a heavy kill line, the next queued line starts late by 2.5 s minus the clip (about 1.7 s
     after V3A, 0.8 s after V3K). That gap is the baseline, not a failure. The stun X17 is 7.9 s but is timed at
     2.5 s, so "Shields charging" goes out about 5.4 s before the stun ends: log by ear whether the gun queues it
     or plays it over the stun. Log every gap.
2. **The hill sounds with the announcer off.** A KOTH match with `PUT /api/config`
   `{"presentation": {"preset": "silenced"}}`. Play Hill Captured, Hill Lost, Hill Contested and the possession
   tick (Hill Moved has no caller yet). **Control:** the same four on the `standard` preset. **Pass:** Tony ruled on
   2026-10-05 that the hill sounds are game information, so all of them play with the announcer off, Hill Captured
   too. The ruling landed on main as `eb37db15` (Hill Captured is now `source="hud"`, `ungated=True`), so a 0.4.19
   cut after it plays all four with the announcer off; setup step 2's third check confirms the build has it. If
   the check does not match, the APK predates the ruling: only Hill Lost, Hill Contested and the tick play. That is
   the old build's expected behaviour, not a failure: log the build and move on. Log what played. Row: F463.

STOP POINT: the core is done. Everything below is lower value per minute.

**17. F452 (b), the Stick's time-weighted median under load (15 min).** The row's bench check: "time a 64-player scan
flood on the Stick and confirm the loop stays under its tick budget before anything is optimised." This kit cannot
make 64 players (a player-sim board sends one advert), and the Stick has no loop timer, so run the lower bound and
say so in the log. Assign a reflashed Stick as the KOTH hill. Log its serial:
`python3 hardware/m5sticks3/tools/stick.py cmd 120 PING > ~/stick-f452b.log`. **Control:** player 1 alone captures;
time from the hill's entry to the Stick's `OWNER team=` line. **Then** the same with every phone and the player-sim
board advertising beside the Stick. **Pass:** the capture time is within 1 s of the control's, and
`stick.py status` afterwards reads progress 100 and dir 0 for the owned hill (F456 on the Stick). Row: F452.

**18. 10c, the hill ladder (20 min; sets the hill threshold once per station type; carried from 0.4.18).** The hill
phone on its stand. Each player phone, body between it and the hill, stands at 5, 7.5, 9 and 12 m, 3 times each, for
10 s at each mark. **Pass:** IN at 5 and 7.5 m every time, OUT at 12 m every time, and 9 m recorded as the edge. If
7.5 m is not reliably IN, lower the default threshold by the measured shortfall (`beacon.js`, `station_range.h`),
never per phone. This ladder also measures F452(a)'s real fading. Rows: F440, F383, F452.

**19. F445, a USP reload just after an ALT swap (15 min; carried from 0.4.18).** A loadout with the USP-S as the
secondary. Five trials each, reading the `$ALCD` slot and magazine. **A:** reload the primary, press ALT mid-reload,
then reload again 2 s later. **B:** press ALT, then pull the reload within 300 ms. **Pass:** no
`reload did NOT take (timeout)` line and no stuck pips in either. A is expected to pass (`67807025`); if B times out,
log the wire: the cure is to settle the reload on the swap's target slot. Row: F445.

**20. F443 and F365, the station's holds (10 min; carried from 0.4.18).** With the phone station MC-locked in play.
**Control:** RANGE opens only after the 5 s locked hold. **Pass:** MC LINK also needs the same 5 s hold. Then F365's
unlocked half, with no match loaded: a tap and a knock do nothing, a 1.5 s hold opens RANGE, and the edit reaches MC
(EDITED ON STATION). Rows: F443, F365.

**21. F442, the ACTIVE pip shine for Rockets (5 min; carried from 0.4.18).** Hold Rockets on the trigger and fire
one. **Control:** a primary with 400 ms or more between rounds dims, then shines green once when the next round is
due. **Pass:** the Rockets' gauge does the same. Row: F442.

**22. NIGHT OPS from a LOBBY edit (5 min; carried from 0.4.18).** Use a phone whose player has not tapped the HUD skin
switch in this MC session. In LOBBY, set NIGHT on MC. **Control, before any push:** over CDP, `engine.game.night` is
true. **Pass:** `engine.config.night` turns true on both phones (pinned on main at `aab05a8e`), and START turns the
HUD to the night skin at ARMED. Row: bench 2026-10-02's night note.

**23. F379, the ALT pointer after a Rocket (5 min; carried from 0.4.18).** Player 2 presses ALT onto the secondary with
no shot, takes Rockets at the station, empties them, then presses ALT once. **Control:** an ALT with no pickup in the
life lands on the slot the phone expects. **Pass:** the gun's next `$ALCD` slot matches the phone's assumed target,
and no stale switch-back re-send follows. Row: F379.

**24. F464 part 3, dense KOTH adverts against gun writes (20 min; carried from 0.4.18; only with a build of
`fix/koth-dense-adverts`).** That branch makes every player phone advertise at lowLatency (about 10 adverts a second)
during a live KOTH match. It is held because the scan flood guard (`scanwatch.js` `SCAN_BUDGET_PER_S` = 25, F342)
may trip, and a flooded scan once starved gun GATT writes. Set up a KOTH match with the hill station and one gun,
and every player phone available (the kit has three Pixels and the iPhone; the target is 4-8, so log the count as a
limit of the result). **Control:** all phones on balanced advertising (main's build), 5 minutes: log the gun's write
latency and any dropped writes from the gun's phone log, and every flood-guard trip the HUD log names. **Then** the
same 5 minutes with every phone on lowLatency (the branch build, or the mode forced). **Pass:** no extra write drops,
and write latency within the balanced run's spread. Log both runs' numbers; they set the KOTH scan budget. Row: F464.

**25. O1 and O2, the console's restore and armory banners (15 min; no gun; last, after END).** The operator review's
O1 and O2 (2026-10-03, `4a9c2ecc` and `73f4b868`, after 0.4.18). Run them in a scratch home, so the real armory
and session are never touched. Stop the bench MC first (no match ARMED or LIVE), then:
`mkdir -p ~/brx-o-check && printf '{"broken' > ~/brx-o-check/armory.json && printf '{"v":' > ~/brx-o-check/session.json`,
then `cd mcp && BRX_MCP_HOME=$HOME/brx-o-check ../.venv/bin/python -m brx_mcp.mc --no-auth`.
1. **O1, restore_failed.** Pass: the banner prints "session file could NOT be restored (", then "kept at <path>",
   and ARMORY shows "SESSION FILE COULD NOT BE RESTORED, THE ROSTER STARTED EMPTY" with "REBUILD THE ROSTER" and a
   detail line ending "KEPT AT <path>". `ls ~/brx-o-check` shows `session.json.bad-<stamp>`.
2. **O2, a corrupt armory.** Open ARMORY (its list reads the armory). Pass: "ARMORY FILE IS CORRUPT: BACKUP AT
   <path>: GUNS BELOW ARE NOT YOUR FULL ARMORY AND NO GUN CAN BE SAVED UNTIL YOU DISMISS. DISMISS MOVES THE CORRUPT
   FILE ASIDE AND STARTS A FRESH ARMORY". Stop and restart the scratch MC: the banner is still there (it is sticky).
   Press DISMISS: the banner clears, and `armory.json` is now `armory.json.dismissed-<stamp>`.
**Control:** a scratch home with no files shows neither banner. Delete `~/brx-o-check` at the end. Rows: none (the
review's O1 and O2; F468 holds the open restart bug beside it).

## Close

Follow the bench-session skill's close: a results table with each control, then the three writes (one log entry,
one FOLLOWUPS diff, the HANDOFF lane), and strike the steps that ran here and in [`bench-plan.md`](bench-plan.md).
