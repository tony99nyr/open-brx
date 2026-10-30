# Bench plan: every open bench step, and the desk work that gates it

Updated: 2026-10-30. **Open this file first at the bench.** How a live bench run works with Tony (who drives
the tools, the "1" reply, the recorder at the end): the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md).

The next bench is the Sunday AM sheet ([below](#sunday-am-the-bench-before-the-game-on-2026-11-01)): gameplay first,
for a game that afternoon. NEXT ([below](#next-the-bench-after-0430-2026-10-26)) is every MVP bench row, in rig order.

This file holds the ORDER only. Each step points to the sheet section or the FOLLOWUPS row that holds the procedure.
Do not copy a procedure into this file. When a sitting ends, strike its steps here (the skill's close, step 4).

## Sunday AM: the bench before the game on 2026-11-01

Tony benches in the morning and wants to play a game in the afternoon. This sheet puts gameplay first and the Stick
last. It re-orders NEXT ([below](#next-the-bench-after-0430-2026-10-26)) and cites its steps; the procedures stay
where NEXT points. Tier 0 and Tier 1 together take about 3 h. Every phone runs 0.4.30 (`288d69597`, which holds
`11107dbdf`, `6e0a6391`, `87e3dca82`, `3d07b60f` and `644d8a89`), and MC runs from current main.

### Pre-flight, before Tony arrives (about 30 min)

| # | step | who |
|---|---|---|
| P1 | Fast-forward the main checkout to `origin/main` (`git merge --ff-only`). The Windows venv runs that checkout, so steps 3 and 33 need it. First check that no session has uncommitted work there. | an agent, on Tony's go |
| P2 | Check the APK: `sha256sum` of `brx-companion-0.4.30-android-release.apk` (from the local 0.4.30 release worktree, `webapp/download/`) reads `2ac7e64e…`, as its build.json says. | an agent |
| P3 | Install that APK on both player Pixels and on the grey Pixel (the hill). Open the app once; its build reads 0.4.30. | Tony, or an agent over wireless adb if Tony says so |
| P4 | Start MC from the main checkout, detached, with `pnpm mc -- --bench-volume 65`. Check that the banner shows the main sha and the BENCH VOLUME line. | an agent |
| P5 | Charge every gun, headset and phone. Pick two guns and their headsets (Tactix-FE30 and Tactix-9498, as Group E pins them). | Tony |
| P6 | `$VOL,65` on every gun for the laptop MCP steps (the bench-session skill). | an agent |

### Tier 0: go or no-go for the afternoon (about 85 min)

Both guns, both player phones, MC, and the grey Pixel as the hill. Run in this order.

| step | minutes | what it proves | control and pass |
|---|---|---|---|
| AM1 | 5 | the build | Each phone's build.json `git` reads `288d69597`. Before any result counts, run the build gate below (`git merge-base --is-ancestor`). |
| AM2 | 10 | phone-to-gun connect | Control: phone 1 links its gun. A/B/A: phone 1, phone 2, phone 1, then the 5 re-picks of 0422 C.28 on each phone. Pass: each link within 20 s, with no loop and no "No guns found". Fail: log the time and the phone log. |
| AM3 | 15 | the catalogue on the guns | NEXT step 19 (the SMG through MC, 5 min), then NEXT step 37 (the AR, Shotgun and USP on the gun, 10 min). Pass: as those steps write them. A weapon that fails comes out of the afternoon kits. It does not stop the game. |
| AM4 | 20 | TDM, start to result | A 5 min TDM match from a preset (MC arm, START). Control: the first kill of the match scores on both HUDs and on the MC board. Then each player: 3 kills, a timed respawn after each, and 5 ALT swaps with a shot after each. Pass: every kill scores once, the down player stays down until the respawn (no HUD cards, F296's down loop on the headset), each respawn fires, no life starts at 0/0 (F533), and no swap leaves the HUD on a weapon that does not fire (F542). At the whistle: RESULT PENDING, then the result on both phones and the debrief on MC. |
| AM5 | 20 | KOTH and the hill | A KOTH match with the grey Pixel as the hill, 5 min, every phone on the hill (this also gives NEXT step 52's F342 numbers: read them from this match). Control: one player alone captures and the hill banks HELD time. Then a contest, then the owner killed on the hill (1017 L4: no banking while down). Pass: capture, contest and bank as L4 writes them; at the whistle the console shows WAITING FOR CONTROL POINT 1 until the hill reports, and the result counts the hill. |
| AM6 | 10 | FFA and the result wait (A83) | A 3 min FFA match. At the whistle, put phone 2 in airplane mode. Pass: the console names phone 2 with FINAL IN, phone 1 shows RESULT PENDING, and at 2 min the console shows FINAL AFTER 2 MIN WITHOUT. Airplane mode off: phone 2 gets the current result, never PROVISIONAL (the F630 and F633 fixes). Then in the debrief, rename one player and move one to the other team: no result changes or clears (the F631, F632 and F634 fixes). |
| AM7 | 5 | outdoor play volume | Stop MC (no match ARMED or LIVE), restart it with plain `pnpm mc`, and check that the BENCH VOLUME line is gone. Arm one gun for an outdoor match: its head sends `$VOL,90`. Outdoors at about 10 m, Tony hears the shot and the kill sounds. Control: the same gun on the bench MC at 65. Then restart MC with `--bench-volume 65` for Tier 1. |

**GO / NO-GO for the afternoon.** GO for TDM and FFA when AM2, AM4 and AM7 pass. GO for KOTH when AM5 passes too.
NO-GO for every mode when a phone cannot link its gun (AM2), or a match will not arm or start, or kills do not score
(AM4). A failed AM5 removes KOTH only: play TDM or FFA. A failed AM6 does not stop the game: the host reads the MC
board and presses FINALISE. A weapon that fails AM3 comes out of the kits. Inaudible play at 90 (AM7) needs Tony's
call before any game.

### Tier 1: gameplay rows by value per minute (about 95 min)

Each step is the NEXT step it names, run as NEXT writes it. Steps 3 and 7 move to the laptop MCP (Group A's rig);
step 18 needs the IR rig boards.

| order | NEXT step | minutes | why it is here |
|---|---|---|---|
| 1 | 20 (F533, F416, F541's tap) | 20 | a lost spawn write at go-live starts a player with no ammo |
| 2 | 22 (F530) | 15 | the host's FORCE RESPAWN in a real game |
| 3 | 21 (F532) | 10 | a gun power-cycled mid-match must not book a death |
| 4 | 3 (F226 and the F575 heat read) | 25 | the heat table is F575's input to Tony; a lock below one charge takes the Charge Rifle out of the kits |
| 5 | 18 (F264) | 15 | how a dead gun leaves its dead state; RESYNC GUN depends on it |
| 6 | 52 (F342) | 5 | read only: the numbers come from AM5's match; 5 min is the log read |
| 7 | 7 (B26) | 5 | local play with no headset; not an MC game blocker |

**Past 3 h, in this order:** step 23 (F542, 45 min), step 33 (F618, 30 min), then NEXT in its own order. Step 33 does
not gate the game: the compiler refuses Armour Piercing on the AMR, the Burst Rifle and the USP until it passes.

### Tier 2: optional

Group G (the Sticks, NEXT steps 63 to 84) and Group H (the field network, steps 85 to 87). Run them only after Tier
1, and only if Tony wants to.

### The afternoon game

- **Mode:** TDM or FFA; KOTH only if AM5 passed (the GO line above).
- **Venue:** outdoors, so play volume is 90. MC runs with no `--bench-volume`: the console header shows no BENCH VOL
  tag.
- **MC:** from the main checkout root, `pnpm mc`. Restart it only between matches, never while a match is ARMED or
  LIVE.
- **Phones and guns:** each player's Pixel on 0.4.30 with the gun it linked in AM2; the grey Pixel is the hill for
  KOTH. Use only guns that passed AM2 and AM3. Do not open the Callsign app on any of them.
- **A phone drops mid-match:** the player keeps playing. Reopen the app; the link comes back by itself within about
  20 s, or tap TO RECONNECT. If the gun is dead and the HUD shows alive, the host uses RESYNC GUN, then FORCE
  RESPAWN. After the whistle the result waits for that phone for up to 2 min; the host can press FINALISE sooner.
- **Never push config to a gun after START.** Change kits in the lobby only.

## NEXT: the bench after 0.4.30 (2026-10-26)

Every open bench row in [`FOLLOWUPS.md`](FOLLOWUPS.md) (91 on 2026-10-26, after Q13 and F537 closed) in one ordered
list, plus the unrun fix checks of the 0.4.24 and 0.4.26 sheets. The groups run in
rig order, one-gun groups first, so the rig changes as few times as possible. The Stick group (G) and the network
group (H) need one gun only, but they come after the two-gun groups because each replaces the rig: the Sticks on USB
with their own MC set-up, and a field router with no uplink. Each step gives its minutes, its control, its A/B/A, the
result that closes the row, and the result that reopens it. A step marked "read only" is a measurement with no A/B/A,
and says why. The procedure stays in the sheet each step cites. Short names: 0422, 0424, 0426 and 1017 are
[`bench-rebench-0422.md`](bench-rebench-0422.md), [`bench-rebench-0424.md`](bench-rebench-0424.md),
[`bench-0426.md`](bench-0426.md) and [`bench-field-1017.md`](bench-field-1017.md); runbook is
[`bench-2026-09-24.md`](bench-2026-09-24.md); levers and screamers are in the Equipment key. Runnable total: about 23
h 45 min (steps 1 to 95), so it takes several sittings. The optional fix checks (35 min) and the blocked steps (30
min) are not in it.

**Build gate: run on the newest APK, and check the fix each step tests.** The newest APK is 0.4.30, built locally
on 2026-10-28 from `288d69597` (not published). It holds the balance set of 25 October (`11107dbdf`), F532's
down-player reboot check (`6e0a6391`), F530's operator-respawn hold until 2.5 s after the death (`87e3dca82`), and
F542's old-slot round and post-spawn ALT rule (`3d07b60f`, after the `$LCD`-slot fix `644d8a89`). Steps 21, 22 and 23
test the last three. Step 33 (F618) runs from the laptop MCP, not a phone: it needs the AP re-key in
`compile.resolve()`, so run the MCP from a checkout at or after `11107dbdf` (the Windows venv runs the main checkout's
code). Before a result counts, check the step's commit against the installed APK's build.json `git` with
`git merge-base --is-ancestor`.

**Start here (about 2 h 20 min).** Steps 1, 2, 3 and 7 (Group A), step 18 on the rig (Group B), then steps 19, 20, 21
and 23 (Group C). This cut covers the red rows F548, F226, B26, F264, F533 and F542. Every other step stays in the
list below.

**Before every group.** Install the newest release APK on every phone, and log its `versionName` and the `git` in its
build.json: a step on an older APK is not a result. `$VOL,65` on every gun, and MC with `--bench-volume 65` (the
bench-session skill). Arm every gun from `compile.resolve()`, the MC push or the CLI's compiled head, never from a
capture. End every step re-armed, or power-cycle the gun: never end on a bare `$CLEAR` (F11). Do not hold the trigger
while a gun powers on (F545), except in step 28. Guns, as the source sheets pin them: Tactix-9498 is the player gun
(0426, 1017, 0422 Sitting A), Tactix-E20D is 0426's second gun and outdoor target, and Tactix-FE30 is player 1 in 0422
Sitting C. Tactix-XXXX marks a gun no sheet pins.

### Group A: one gun alone on the laptop MCP (1 gun, no phone, about 225 min)

Tactix-9498 and its headset. Force-stop any phone app that holds the gun. Arm from the 0422 Sitting A recipe.

1. **F548**, the SMG frame with its terminator (5 min). Control: an Assault Rifle frame from the same compile echoes
   `$ALCD`. A/B/A: the AR frame, the SMG frame with `,*` appended, the AR frame. Closes: the SMG echoes
   `$ALCD,54,100,0,108,0,*` (step 19 then checks the MC push). Reopens: no echo; send it with t42 dropped and report
   to brx3. (1017 P1.1)
2. A large reserve counts down (10 min; no open row). Control: the shipped Energy Rifle frame with
   `$AMMO,0,300,384,1,*` echoes 384. A/B/A: shipped, then t17 1200 with t40 600, then t17 2400 with t40 1200, then
   shipped. Closes: each echo reads the reserve sent and falls by the rounds loaded; then raise `RESERVE_PROVEN_MAX`
   in compile.py. Reopens: a 600 echo after `$AMMO` alone means `$AMMO` clamps to t17. (0426 P2.2, 1017 P1.0)
3. **F226**, the Charge Rifle below one charge, with F575's heat read (25 min). Control: from exactly 10 rounds a
   charge fires. A/B/A: 10 rounds; about 4 rounds, hold a charge, pull the lever twice, read the `$ALCD` magazine and
   heat; refill with the recipe's `$AMMO,0,...` and fire 10 again. For F575: a full charge, then 6 fast taps, heat
   after each round, 3 times. Closes F226: the read says whether the reload is refused or only delayed by the lockout.
   The heat table goes to Tony (F575: keep 70/16 or 73/14). (0426 P1.5)
4. **F562**, is t14 a floor between pulls? (5 min). Control: the Assault Rifle held fires about 10 rounds a second.
   A/B/A: the AMR held for 10 s, taps at 250 ms, taps at 400 ms, held again. Closes: 250 ms taps give no more rounds
   than 400 ms taps. Reopens: they give more, so the player-paced TTK (Balance rules row 14) goes back to brx2. (1017
   P3.2)
5. **F277**, a slot change during a reload (10 min). Control: a reload with no slot change ends with `$ALCD` on its
   own slot. A/B/A: control; start a reload, press ALT before it ends, read `$LCD` and the `$ALCD` slot after it;
   control. The 2026-10-17 bench found the gun ignores ALT during a reload, so log whether the ALT took at all.
   Result: says whether the reload undoes a slot change; the row stays open for step 25 and the detector. (FOLLOWUPS
   F277, code read 2026-10-26)
6. **F592** part 2, `$AMMO,0,...` with a heavy held on slot 2 (5 min). Control: with the heavy equipped after the
   life's first pull (F436), one pull fires slot 2. A/B/A: control; send the recipe's `$AMMO,0,...` row and pull;
   re-equip and pull. Closes part 2: the `$ALCD` slot after the write says whether `$AMMO,0` moves the trigger.
   (FOLLOWUPS F592)
7. **B26**, a gun with no headset in local play (5 min). Control: the same gun with its headset fires. A/B/A: headset
   on, removed, on. Closes: fires or refuses; the answer updates `docs/manual/fix.md` "Won't fire" step 1. (0422 A.19)
8. **S10**, the L10 hold (5 min, eyes). Control: on a spawned gun with the strip blanked (`$GLED,,,,5,,,*`),
   `$GLED,3,3,9,0,1,,*` paints two dim green segments and a dark third. A/B/A: the paint; each of the four frames of
   0422 A.20 sent one at a time; the paint re-read after each. Closes: it holds 60 s and survives all four. Reopens: a
   frame paints over it. Power-cycle after (F35). (0422 A.20)
9. **F128**, the Shotgun tap and hold (5 min). The 1017 P1.2 match-3 loadout (the AMR in slot 0, the Shotgun in slot
   1). Control: the AMR, part-empty, refills with one lever pull. A/B/A: AMR; Shotgun emptied with
   `$AMMO,1,0,<reserve>,1,*`, then the lever under 200 ms, 1 s and 3 s, three times each; AMR. Read: shells per pull
   from `$ALCD` (expect 0, about 2 and 6, at about 420 ms a shell), for the HOLD state; the `easy_reload` hold
   question stays open. (1017 P2.2)
10. **F282**, optional research, the muzzle flash tokens (10 min, a dark room). Control: the compiled AR shows its
   normal flash. A/B/A: t25 alone, compiled, t26 alone, compiled; then one try of an empty t27. Result: which token
   removes the flash and what an empty t27 plays; not an MVP gate. (0422 A.21)
11. **F308** part 4, optional: the Burst Rifle's t23 with a fixed-rhythm trigger puller (10 min). Control: the
   Shotgun's interval reads about 720 ms against 700 configured (the gun's 20 ms overhead). A/B/A: Shotgun, Burst
   Rifle, Shotgun. Closes: the gap between bursts reads about 540 ms plus that overhead (hand pulls bound it at 540 to
   615 ms). (FOLLOWUPS F308)
12. **F272**, screamers A1c, the nonblocking loop control (10 min). The run is its own control: `$PLAY,A10,4,6,,,,,*`
   with `$PING,*` running 10 s, then `$PLAYX,0,*`, three times. Closes A1c: the loop plays and every ping answers.
   Reopens: an unanswered ping is a stable-radio screamer that F272's detector must catch. F272 stays open for step 15
   and field evidence. (screamers A1c)
13. **F269** and **F270**, the paced A7 and A8 (60 min). One exception to the screamers sheet: A8 streams the env
   file's stock `$WEAP` frames, so use the compiled AR `$WEAP` from `compile.resolve()` instead, at two magazine
   sizes. Control: the as-shipped `--phone-pacing` runs (A7 `QUERY=10` in all three; A8 last `$ALCD` = the second
   magazine minus the count). A/B/A: shipped pacing; zero gap, then the block pause, then `--with-response`; shipped
   again. Re-arm from `compile.resolve()` after each run. Closes F269's pause: switch on blocks of 10 with 300 ms only
   if the shipped pacing loses frames and the pause does not. Closes F270: write with response only if A8 loses
   frames. A run can lock the gun: power-cycle and re-arm. (screamers, runbook Block 2)
14. **F269**, the runt `$SIR` rows, screamers A8b (20 min). Control: 50 arms with the compiled rows as shipped. A/B/A:
   50 shipped, 50 trimmed (trailing empty tokens dropped, one 20-byte packet a row), 10 shipped. Read: BAD FRAME per
   variant, which says whether the runt can go (`$SIR` is positional, F11). (screamers A8b)
15. **F272** and **F274**, screamers A13, our peak writer (40 min). Control: a 20 min run of `$PING,*` alone at the
   same throttle, no lock-up. A/B/A: pings; the shipped recoil writer (`$TMP` t4 only) at its throttle for up to 20
   min; pings again only if the writer run ends clean. Read: the time and frame count at any lock-up, the per-gun
   traffic budget. F274 still needs its three soaks (*Unattended*, below). (screamers A13)

### Group B: one gun and both IR rig boards (1 gun, the laptop MCP, about 31 min)

16. **F449** and **F538**, the rig itself (10 min). Control: a single `ir-emit` word at a hit-ready headset hits (4/4
   on 2026-10-16). A/B/A: single word; one word with a gap, reading the ack's `bits=`; single word. Closes both: if
   the ack reads 29, reflash the emitter from hardware/esp32-ir-bridge on main, and `--repeat 4 --gap 600` then hits
   4/4. (FOLLOWUPS F449, F538)
17. **F322**, what one protocol-9 or -10 hit sends (6 min). The victim armed from `compile.resolve()` (its table ships
   `$SIR,9,3` and `$SIR,10,0`). Control: protocol 0, 3 emits, board A sees one word per emit. A/B/A: protocol 0,
   protocol 9 then 10, protocol 0. Closes: one word per emit. Reopens: a second word from the victim's headset, so one
   shot can land twice on a neighbour. (runbook 2b.3)
18. **F264**, how a dead gun leaves its dead state (15 min). A: a live gun's pull fires. B: kill it with a rig word
   and log every frame (expect one `$LCD` with HP 0, never repeated); re-send the recipe's `$SIR` table (a pull fires
   nothing); send `$LIFE,<hp>,0,0,1,*` then `$HLED,,6,*` (the row: without `$HLED,,6` the headset keeps the death
   flash), and a pull fires. A: re-arm from `compile.resolve()` (`$HLED,,6` turns off the native death flash for the
   life, A16), and a pull fires. Closes the 2026-10-26 code read: a positive `$LIFE` frees the trigger and `$SIR` does
   not. F264 stays open for step 39. Keep `$GSET` t8 at its compiled value. (FOLLOWUPS F264)

### Group C: one gun, its phone, MC and the rig emitter (1 gun, a second phone in steps 30-32, about 175 min)

Tactix-9498 with the green Pixel 5. The rig emitter is the shooter wherever a step needs a hit or a kill (0422 Sitting
A).

19. **F548**, the SMG through MC (5 min). Control: an AR primary kit acks first try. A/B/A: AR kit, SMG kit, AR kit.
   Closes: the SMG push acks first try with a real `$ALCD` echo, and the SMG fires and reloads. (1017 L1)
20. **F533**, **F416** and the tap half of **F541**, a lost spawn write at go-live (20 min). F541's relink half passed
   on 2026-10-17 (5 of 5 back inside 20 s); only the tap is open. In one start that hits the slow timeout ladder, tap
   TO RECONNECT mid-relink. Closes F541: the log shows the restart line. Open for F533: no start yet hit the repair
   path. Control: a start with no relink. A/B/A: control; 5 starts with
   `window.brx.link.relink()` about 1 s before go-live, then 3 with the phone about 10 m from its gun; control. Closes
   F533: each start that logs `write err` fires at go-live or heals once, and no life starts at 0/0. F416: a lost
   write logs the re-send and a closing match. A start with no `write err` tests neither: say so. (0426 P1.3, 0424
   P1.1, 0422 C.4b)
21. **F532**, a power-cycle mid-match (10 min). Control: a life with no power-cycle. A/B/A: control; power-cycle while
   alive (no death, it fires at its pools after the relink); kill, power-cycle at once, let the timed respawn run with
   the gun off, relink (the respawn fires and the headset lights); control. Reopens: a death booked on the reboot, or
   a respawn with no weapon. (0426 P1.3)
22. **F530**, five fast operator respawns (15 min). Control: a timed respawn before and after. B: FORCE RESPAWN within
   about 100 ms of a death, 5 times; each press logs its hold until 2.5 s after the death. Closes: the headset goes
   dark 5/5 and the trigger fires 5/5. Reopens: a stuck flash; try a settle gap before the respawn `$HLED` first.
   (0424 P1.4, 0422 A.10)
23. **F542**, the ALT swallow matrix (45 min). Control: ALT on a settled life, six times, at the start and the end.
   Six trials of each of the five conditions, at swap 500 (the two pistols), then 1105 (the AMR and the Shotgun), with
   L2's HUD checks, the lever on a full magazine (no `$ALCD`) and the Desert Eagle's reload time (expect 2.7 to 2.8 s;
   the AR is its control). Closes: ALT with no shot moves the HUD, a shot on the old slot snaps it back with GUN WAS
   ON, and ALT then the lever settles on the gun's slot. Reopens: a HUD weapon that does not fire; the swap counts
   pick the fix. (0426 P1.2, 1017 P1.2, P1.3, P2.3 and L2)
24. The Sniper's 2.2 s bolt (10 min; no open row). Control: the AMR fires its magazine with no lever between shots.
   A/B/A: AMR; the Sniper three times, then with Quick Hands and with Extended Mags; AMR. Pass: one lever pull a shot,
   a press during the bolt fires nothing, the HUD shows BOLT, and the bolt stays 2.2 s with a magazine of 1. (0426
   P2.1)
25. **F277**, a reload that never completes (15 min). Control: a normal Energy Rifle reload completes. Ten tries to
   time out a partial reload on purpose; log every `reload partial` line against the gun's slot. Closes: a repro (brx4
   builds the detector and its `$QUERY` cure), or a clear "no repro in 10 tries". (0422 A.18)
26. **F511**, a phone restart around an ABORT (10 min). Control: an ABORT with no restart sends the phone to the
   lobby. A/B/A: control; part 1, then part 2 of 0424 P2.11; control. Closes: part 1 leaves the phone in the lobby
   with no `$PSET` or `$SPAWN` on the gun; in part 2 the abort frames reach the gun on relink and it does not spawn.
   (0424 P2.11)
27. **F50**, the A17 pain gate (10 min, ears). Control: a rig word with magnitude 0 moves no pool and plays nothing.
   A/B/A: control; an armour-absorbed hit, a health hit, a spill from armour into health, a lethal hit; control.
   Closes: silent, grunt, grunt, no grunt. (0422 A.16)
28. **F545**, a trigger held at power-on (5 min). Control: a normal power-on links and arms. A/B/A: normal; trigger
   held at power-on (the gun says "Game host"), then the phone connects and arms; normal. Read: whether the connect
   and `$START` recover the gun. Result: Tony decides whether the setup warns a player. (FOLLOWUPS F545)
29. **F3**, the reload prompt on sustained full auto (5 min). Control: the empty-magazine prompt after a magazine
   emptied in single taps. A/B/A: taps, one sustained full-auto hold, taps; Share log before closing the app. Closes:
   the prompt shows on the hold. Reopens: it does not; the frame ring goes to the HUD lane. (FOLLOWUPS F3)
30. **F340**, the picker with Location off on Android 11 (5 min). The grey Pixel 5, the gun on and unlinked. Control:
   Location on lists the gun within 5 s. A/B/A: on; off (TURN ON LOCATION TO FIND YOUR TAGGER, never "No guns found",
   and OPEN LOCATION SETTINGS opens the page); on (the gun lists within 10 s, no tap). Closes: all three. (runbook
   4.15)
31. **F293**, a second phone's SCAN AGAIN during a headset join (20 min). A/B/A: the second phone taps SCAN AGAIN
   while the headset joins; the second phone idle; SCAN AGAIN again. Log a loop or none, and the join time, per run.
   Result: brx2 decides with steps 99-100 (blocked); no loop in any run closes the load-triggered shape. Reopens: a
   loop; run the runbook's 1.3 bugreport A/B/A. (0422 C.33, runbook 1.5)
32. **F563**, the reconnect's battery cost (up to 30 min, beside steps 23-25, so not in the total). The second phone
   on the lobby, outside a match. Control: the same phone for the same time with its gun on and linked. B: its gun
   off. Closes: the log's waits stay at about 10 s or less for 12 tries, then 30 s and 60 s, and the link rests after
   30 tries (expect about 20 min). Read: the battery drop per hour. (0426 P2.3)

### Group D: two guns on the laptop MCP and the rig receiver (2 guns, no phone, about 90 min)

33. **F618**, AP on the AMR, the Burst Rifle and the USP after the re-key (30 min). A Tactix-XXXX victim with
   identical fn 1 rows at `<0,3>` and `<4,0>`, t7 = 0. Control: frames on the old key `<0,3>`. A/B/A per weapon: old
   key, AP key `<4,0>`, old key, frames differing only in t3/t4; log the emitter, word count, decoded key, magnitude,
   crit bit, shot timing and `$HIR` sensor. Then the full AP frames against HP, armour and shield, with t6 = 0 on the
   AMR and the Burst, and t6 = 100 once. Closes: emission and trigger unchanged, every AP word registers, fn 2 drains
   HP alone, and no crit lands under AP; brx3 then lifts the compiler's AP guard and adds the three pairs. Reopens: a
   lost word or a crit under AP; the guard stays. (FOLLOWUPS F618)
34. **F515**, the CLI's teammate check (5 min). Two CLI-armed guns, TDM. Control: on different teams a hit does
   damage. A/B/A: different teams, same team (no damage), different teams. Closes F515's last open check. (FOLLOWUPS
   F515, 0422 C.1)
35. **S57**, the callout bus (55 min). Both guns with the `<15,0>` row from `compile.resolve()`; the rig receiver at
   A's domes is the emit control. A/B/A as Block 7 writes each step (a live, dead, live sender; field 4 per team; fn
   28, fn 34, fn 28). Closes: B hears 5/5 from a dead sender, field 4 = 2 answers whether the callout team is a
   constant 2, duplicates land within 600 ms, and fn 34 answers whether dead players hear callouts. Restore fn 28,
   then power-cycle both. (runbook Block 7 steps 1-10)

### Group E: two guns, both phones, MC and the grey Pixel as a station (2 guns, 3 in step 53, about 215 min)

Tactix-FE30 is player 1 and Tactix-9498 player 2 (0422 Sitting C).

36. **F395** and **F21**, glances at install (5 min, eyes; the Pixel 4 and the Pixel 10 too). No control: both close
   on sight. F395: the first cold launch shows the plain background, no stretched logo, on every phone. F21: nothing
   sits under the status bar or the display corner on the Pixel 4 and the Pixel 10. (FOLLOWUPS F395, F21)
37. The F579 weapons on the gun (10 min; no open row). Control: the AR's `$HIR` reads 8 a round. A/B/A: AR; the
   Shotgun (`$HIR` 19, then 20 about 88 ms later; three pulls kill a full Standard target) and the USP (10 a hit,
   magazine 12); AR. Taps for 5 s: no two rounds closer than t14 (USP 190 ms, Shotgun 400 ms). Ask Tony how each
   feels. A mismatch goes back to the F579 caveat in balance-decisions.md. (0426 P1.4)
38. **F438**, the self-hit restore path (15 min). Control: the other player's hit moves the victim's pools. A/B/A: 5
   sniper shots at a wall 1 to 2 m away in TDM, then FFA, then TDM; log every `$HIR` shooter id. Closes: an own word
   comes back and logs `self-hit: own shot ... restored` (or revived), with no hit or death on the HUD, MC or the
   recap. Reopens: a `booked as a down by nobody` line. No own word in the room: say so; the row stays open. (0422
   C.1)
39. **F264**, a live stall (opportunistic: only if a gun stalls in this group, no extra minutes). Control: MC shows
   `pool_stale: no_fire` on the stalled gun. Before any force respawn, send `$LIFE,<hp>,0,0,1,*` then `$HLED,,6,*` and
   watch for a trigger answer. Closes: the two frames cure a real stall, and the next death still shows the native
   flash (A16). (FOLLOWUPS F264)
40. **F298** and **S57**, a two-phone Shields fight (15 min). Read only: the pass is a read of a live match, so there
   is no B to change. Control: a single `$IRTX` callout word received alone. Closes F298: the recharge cues and the
   pool readout are right on both HUDs. S57: each kill names the victim on the other gun (DOWN 250 to 800 ms after
   DOWN_BY), with no collision. (0422 C.19)
41. **F461**, the spawn fill's `$HP` (10 min). Ten Shields spawns on player 2. Control: a spawn with no hit logs the
   answered line. A/B/A: a spawn with no hit, three spawns hit within 1 s, a spawn with no hit. Closes: every lost
   fill logs "measured from the full shield", and the HUD shield matches `$LIFE`. No lost fill in 10: INCONCLUSIVE
   again. (0422 C.18)
42. **F459**, an EMP inside a reconcile window (15 min). Stun on (`{"stun": {}}`), the Charge Rifle as the source.
   Control: an EMP with the link up (no fire for 10 s, then the old magazine). A/B/A: control; 3 EMPs within 3 s of a
   relink's reconnect, one stun expiring inside the window, one with Rockets held; control. Closes: one restore, no
   fire while stunned, live counts after. Stun off after. (0422 C.20)
43. **F460**, X2: a station revive (10 min). Control: a timed respawn shows the full magazine. A/B/A: timed, station
   revive, timed. Closes: the reviving pull is not a round (full magazine), and protection ends about 2 s in. (0422
   C.21)
44. **F436**, a held heavy survives a resume (10 min). Control: with the app in front, a pull fires a Rocket. A/B/A:
   control; 30 s in Android Settings, back, `relink()` (the first pull fires a Rocket, no `gun fired slot 0` line);
   control. Three trials: hold enough Rockets. Then hold through the last Rocket's switch-back and log any primary
   round. (0422 C.13)
45. **F447**, no take at the stack cap (10 min). Control: under the cap a claim takes the item. A/B/A: under the cap
   (a take); at 4, a full dwell takes nothing (no TOOK, the item stays); fire one Rocket, back under the cap, and the
   same claim takes it. (0422 C.14)
46. **F442** and **F396**, the Rockets pip and timer (5 min). Control: a primary dims, then shines green once when the
   next round is due. A/B/A: the primary, Rockets, the primary. Closes: the Rockets gauge does the same, and the timer
   does not jump after a respawn with Rockets held. (0422 C.25)
47. **F379**, the ALT pointer after a Rocket (5 min). Control: an ALT with no pickup lands where the phone expects.
   A/B/A: ALT with no pickup; ALT onto the secondary, Rockets, empty, ALT; ALT with no pickup. Closes: the next
   `$ALCD` slot matches the phone's target, with no stale switch-back re-send. (0422 C.26)
48. **F463**, clip timing and the hill sounds (15 min). Control: the four hill sounds on `standard`. A/B/A: standard,
   the silenced preset, standard. Closes: each line in the 87-id table starts when the one before ends (the heavy
   takes, X17 and VSF at the 2.5 s default are the baseline, not a fail), and all four hill sounds play under
   silenced. (0422 C.22)
49. **F536**, VA7 while down (10 min). Read only: the fault has never reproduced, so there is no change to make.
   Control: an ordinary death plays no VA7. A Toxin Rifle lethal tick, three times, with the victim gun's rx stream
   captured. The row names no closing result: a captured VA7 goes to brx4. (0422 C.12, FOLLOWUPS F536)
50. **F296**, the down pattern (5 min, eyes). Control: a hit flash on a live player. A/B/A: hit, down, hit. Closes:
   Tony reads the slow down loop as "down". Reopens: it still reads as a hit; the steady, dim pattern of
   led-language.md is needed. (FOLLOWUPS F296)
51. **F592** part 1, `$ALCD` latency under load (10 min). Full capture on both guns. Control: the station not
   scanning. A/B/A: off, scanning, off. Read: the `$ALCD` notification latency, which says whether the 250 ms
   late-round bound can close a swap the gun took. (FOLLOWUPS F592)
52. The F342 scan-flood baseline (20 min; a decision row). Read only: a baseline for Tony's decision, with no change
   to test. A KOTH match, every phone on the hill, 5 min. Read per phone: adverts a second, scan restarts, flood-guard
   trips, presence gaps, gun write latency and dropped writes. (0422 C.30)
53. The EMP perk (45 min, 3 guns; no open row). Thrower Tactix-9498 with the EMP perk, a Tactix-XXXX victim and a
   Tactix-XXXX teammate, friendly fire off. Controls as 0426 writes them: a blocked LEFT sends no IR; a Charge Rifle
   hit with the stun off does plain damage; a cloth at 3 m gives no `$HIR`. Pass: P2.5 to P2.11 of 0426. The perk
   stays hidden until they pass. (0426 P2.5-P2.11)

### Group F: hills and stations in a 12 m hall (2 guns, both player phones, the grey Pixel and the Pixel 10 Pro as stations, about 125 min)

54. **F525**, two hill points (15 min). F537 closed on 2026-10-26 from the 2026-10-17 bench. Control: both points on,
   player 1 on A for 60 s with no "different point" line. 5 runs. Closes F525: `different point` 2 to 3 s after A
   stops (never over 4 s), and the HUD moves to B's owner. (0424 P2.1)
55. **F526**, a taken station beside a claimable one (15 min). Control: with both items there, player 1 claims the
   louder station. 5 runs. Closes: player 1's claim ring runs at station 1, and the item is granted. (0422 C.35)
56. **F440** and **F383**, the hill off the ground (20 min). Control: 1 m clear reads IN at the start and end of each
   pass. A/B/A: flat on the ground, 20-30 cm up on a box, flat; each at the default (-78 since 2026-10-17) and at -80
   dBm. Log the build and the player's advert tx power each pass. Read: IN or OUT and dBm at 1, 5, 7.5, 9 and 12 m
   clear, and 2.5 and 5 m body-blocked. Result: to Tony, with the 8 dB advert-power asymmetry. (1017 P2.1)
57. **F383**, the 10% larger hill (10 min). Control: as step 56. Read the flat phone's edge at 5, 5.5, 7.5 and 8.25 m.
   Closes: the lone player's edge moves out about 10% (from about 5.2 m to 5.7 m). Reopens: under 5% or over 20%; the
   ladder goes back to brx5. (1017 L5)
58. **F452** (c), entry fairness (15 min). Control: a phone at 12 m for 30 s is never IN. 3 runs per phone from 12 m
   to 5 m. Closes: a phone with a median gap of 500 ms or less enters within about 2.5 s; a slower one within its
   pinned bound (3.75, 4.75, 5.75 s). (0422 C.9)
59. **F345**, the respawn radius on the phone station (10 min). Control: the station logs `threshold -70 dBm`. A/B/A:
   in from 6 m, out, in. Closes: PRESENT at 2.5 to 3.5 m, and `left` within about 1 m past the edge. (0422 C.32)
60. **F443** and **F365**, the station's holds (10 min). Control: locked, RANGE opens only after the 5 s hold. Closes
   F443: MC LINK also needs the 5 s hold. F365: with no match, a tap and a knock do nothing, a 1.5 s hold opens RANGE,
   and the edit reaches MC as EDITED ON STATION. (0422 C.24)
61. **F448**, a hill that left (10 min). Control: LOAD works with the hill present. A/B/A: present, BACK TO HUD in
   RECAP, restored. Closes: the KOTH LOAD refusal and ITEMS name the hill, RESTORE restores it in one tap, LOAD works,
   and DISMISS clears the line. (0422 C.10)
62. **F464**, dense KOTH adverts (20 min; only with a labelled dense-advert APK, else skip). Control: the shipped
   advert rate. A/B/A: shipped, dense (about 100 ms), shipped. Read: capture rate against gun write latency, which
   sets the KOTH scan budget. (0422 *Not in this sitting*)

### Group G: the Sticks (every Stick on USB, MC, both player phones, one gun, the rig receiver, about 327 min)

The procedure is 0422 Sitting B; run it with the m5stick-bench skill.

63. Reflash every Stick from main (15 min). Control: a Stick on its old build shows STICK FIRMWARE TOO OLD in MC's
   station list. Pass: `app_ver` reads `h8-0.3+` and the checkout's 10-character sha, no `_dirty`, and the line is
   gone. Unplug each Stick when done. (0426 P1.0, 0422 B.0)
64. **F434**, the powerup claim distance at -45 dBm (35 min). Control: STATUS after `RANGE CLEAR` reads `threshold=-45
   threshold_src=default`. Closes: on both phones the weakest 30 cm median is at least 4 dB above -45, and the
   strongest 3 m median at least 4 dB below. (0422 B.16)
65. **F383** and **F440**, the Stick hill ladder (20 min). Every mark runs body-blocked (the body between the phone
   and the Stick), as B.13 does. Control: STATUS shows the default on its `LINK` line: -78 since 2026-10-17 (B.13 was
   written at -75). Closes: IN at 5 and 7.5 m, OUT at 12 m, every time; 9 m is the edge. A shortfall moves the
   default, never a per-phone value. (0422 B.13)
66. **F399**, **F380** and **F425**, nine claims (12 min). Control: the first claim with one phone alone. Closes: each
   confirm within about 1 s; a slow grant shows CONFIRMING, never NOT ANSWERING; after another player's take, no
   countdown and no TAKEN hint. (0422 B.18)
67. **F417**, a true race (20 min). Control: one phone alone gets every respawn. Closes: one grant per respawn, after
   an advert naming the winner, with the same taker in the Stick's `CLAIM` line and both phones' logs. (0422 B.17)
68. **F450**, after the A2 alignment (10 min). Control: a fresh spawn shows available. Closes: the Stick stays taken,
   and its taken countdown floors at 1. A TOOK row before the reconnect means the run does not test F450. (0422 B.19)
69. **F345**, the Stick respawn radius (10 min). Control: STATUS shows `threshold=-57`. Closes: as step 59. (0422
   B.20)
70. **F388**, RANGE refused under the lock (10 min). Control: unlocked, the hold opens RANGE. A/B/A: unlocked; locked
   at LOAD, then mid-match (both refused, threshold unchanged); unlocked. (0422 B.5)
71. **F504** and **F391**, the saved state (10 min). Control: the first boot is unassigned. Closes F504: a reboot
   keeps config, hill and lock; released and rebooted, it is unassigned and unlocked. F391: the lock comes back as it
   was, not cut to 120 s (B.3's 120 s line predates the F391 build); log `lock_s`. (0422 B.3)
72. **F397**, the typed MC address (5 min). Control: a Stick restart with MC up rejoins. Closes: after an MC restart
   (no match ARMED or LIVE), a Stick restart rejoins with no re-type; then drop the re-type lines from this file.
   (0422 B.6)
73. **F389**, LINK OFF and MUSTER (10 min). Control: LINK HELD keeps the socket. Closes: MUSTER with a lobby push,
   then LINK OFF, each drops the socket (MC shows it offline). The mDNS half needs a native Windows MC: log it as not
   run otherwise. (0422 B.7)
74. **F386**, MATCH OVER (15 min). Control: a timed whistle freezes the hill (passed 2026-09-26). Closes: B.9 (a) to
   (d), the hill freezes on an early end, MUSTER and an offline restart, and a phone hill stops at a timed whistle
   too. (0422 B.9)
75. **F374**, a HELD Stick carried out of Wi-Fi (10 min). Control: an arm that stays in Wi-Fi shows EMPTY until START.
   Closes: the carried arm shows READY within a second, and no phone claims before `first_at_s`. (0422 B.10)
76. **F453**, a baseline (5 min). Read only: no fix exists yet, so the step records the loss. Pull the Stick's Wi-Fi
   in the second after a grant. Read: whether MC gets TOOK, and `actions_dropped`. A lost claim is expected; the row
   closes only with the acked claim. (0422 B.11)
77. **F353**, the phone side of the advert gaps (10 min). Control: the Stick's own gaps (median 106 ms, max 953 ms).
   Closes: no phone-side gap over 1 s in 2 min at 1 m. (0422 B.12)
78. **F519**, the buttons (20 min). Control: an unlocked 5 s A hold on STATS opens RANGE (never a B hold on home: it
   arms a RESET). Closes: B.1 (a) to (e), each with its screen and serial line. (0422 B.1)
79. **F521**, the per-tick behaviour (20 min). Control: (a), the IR beacon every 5 s in bench HILL on the rig
   receiver. Closes: (b) to (e) of B.2. (0422 B.2)
80. **F508**, the live redraw (10 min). Control: a forced repaint by a button. Closes: every countdown second, the
   link icon and the JOINING dots update, and nothing freezes. (0422 B.4)
81. **F392**, the unlocked click (10 min). Control: an unlocked click restarts the Stick before the sequence. Closes:
   after LINK OFF, LINK HELD, LINK RECONNECT, one click restarts it; on a fail, log the PMIC lines. (0422 B.8)
82. **F398**, the countdown screen (5 min, eyes). Control: the simulator's layout clears NEXT SPAWN by 9 px. Closes: a
   photo (sha logged) shows the ring clear of NEXT SPAWN. (0422 B.15)
83. **H8**, `held` against `muster` (45 min). A/B: 5 min of advert gaps in each mode, and the drain over a 15 min
   match in each, with a USB power meter. A measurement: with no meter, log the drain as not measured. (0422 B.14)
84. **F452** (b), optional: the Stick loop under a flood (20 min). Time the loop during a scan flood (the player-sim
   board gives a lower bound only). Closes: it stays under its tick budget. (FOLLOWUPS F452)

### Group H: the field network (1 gun, two phones with mobile data, MC, a router with no uplink, about 50 min)

85. The backhaul is a fallback (15 min; F595 is a desk row). Control: before the match, with the tunnel up, every
   phone stays on the LAN and MC logs no new hello. Pass: as 0426 P2.4 and its two variants. (0426 P2.4)
86. **F311**, the MC link on a no-internet field Wi-Fi (20 min). Mobile data on, tunnel off. Control: the phone binds
   on a Wi-Fi with internet. A/B/A: uplink in, uplink pulled, uplink in. Closes: the phone binds over the LAN and
   stays bound for a full match, the sweep finds MC, and a Wi-Fi drop mid-match redials. (FOLLOWUPS F311)
87. **F309**, the transport on two Pixels (15 min). Control: read (1), what the plugin reports with Wi-Fi and data
   both on. Closes: (2) two phones on cellular through the tunnel read `2 of 2 phones · 2 on cellular`; (3) one on the
   field Wi-Fi drops to zones; (4) data off mid-lobby drops the count within one heartbeat; and a Wi-Fi-only match
   names no phone OFF-GRID. (FOLLOWUPS F309)

### Group I: outdoors, 25 m or more in shade (2 guns and headsets, the rig, a 30 m tape, about 165 min)

Tactix-9498 shoots and Tactix-E20D is the target (0426 P3), both from `compile.resolve()`, the target at full Standard
health, a full capture. Indoor range is bounce: no range claim indoors.

88. **F232**, the first two pulls (15 min). Same value, same mark. Control: 10 shots 2 s apart. A/B/A: 2 s apart, as
   fast as possible, 2 s apart; then groups of 4 with 10 s between. Closes: misses do not cluster on pulls 1 and 2.
   Reopens: they cluster; every ladder below discards the first two pulls of a full magazine. (FOLLOWUPS F232)
89. **F580** and **F308** part 3, the Shotgun's two words (20 min). Control: a cloth over the target headset at 5 m
   gives 0. Five pulls at 5, 10, 15, 20 and 30 m. Read: where a pull drops from 39 to 19 (the headset word stops) and
   to 0 (the gun word at t2 30 stops). Closes F580's Shotgun half and F308 part 3. If the headset word lands as far as
   the gun word, F579's Shotgun call reopens. (0426 P3.1)
90. **F580** and **F567**, melee at t2 60 (20 min). Control: a cloth at 1 m gives 0. Five strikes at 1, 2, 3, 5 and 7
   m: the longest distance that hits. Then at that edge, A/B/A: t2 60, t2 40, t2 60. Closes F580's melee half, and
   F567 (does a lower t2 cut reach on a real headset; the U002 proxy said no). (0426 P3.2, 1017 P3.1)
91. **F606**, hit odds against t2 and distance (20 min). Control: a cloth at 10 m, t2 100, gives 0. The AR at 10, 20
   and 30 m, t2 100, 60 and 30 (only `range_outdoor_pct` changed), t2 100 again last, ten pulls a cell. Read: hits per
   cell; brx2 models the curve from it. (0426 P3.3)
92. **F275**, the headset word against t13 (60 min). The Shotgun with t13 edited, at 5 m and 25 m. A/B/A: t13 100
   first and last. Closes: a t13 that lands at 5 m and not at 25 m, with the closing 100 matching the opening one.
   (runbook Block 5)
93. **F231**, the shaded t2 ladder (30 min). t2 30, 40 and 100, full magazines, the first two pulls discarded (step
   88). A/B/A: t2 100 first and last. Closes: the reach at 40 and 100; Tony then keeps the Shotgun, Breacher and Haze
   at 30 or moves them to 40. (levers §20)
94. **F157**, after the next field match (opportunistic: only after a real field match, no bench minutes). Control:
   the 2026-10-17 bundle's 49 to 130 offers a minute. Read the MC log. Closes: no `log_offer` burst, and the LOGS
   button works after the match. (FOLLOWUPS F157)

### Group J: the MacBook (no gun, about 20 min)

95. **B21**, `BrxDebugPlugin.swift` compiles and runs (about 20 min). Control: the Android toggle shows its state in
   the diag panel. Closes: the iOS switch builds and shows its state, or UNSUPPORTED below iOS 16.4; Tony then picks
   the iOS distribution path. (bench-mac step 1, the iphone-build skill)

**Unattended (no sitting).** F274's three two-hour `recoil-oscillate` soaks, screamers Phase C runs 1 to 3: one gun
and the laptop.

#### Optional fix checks (closed rows or no row, about 35 min, not in the total)

96. The console's restore and armory banners, O1 and O2 (15 min, no gun, after END; no row). Control: a scratch home
   with no files shows neither banner. Pass: as 0422 C.36. (0422 C.36)
97. No config and the headset (10 min; closed rows, Group C's kit). Control: a normal push acks with an `$ALCD` echo.
   Pass: as 1017 L3. (1017 L3)
98. A hill banks only with a living owner (10 min; a closed row, Group F's kit). Control: a hill with a living owner
   on it banks HELD time. Pass: as 1017 L4. (1017 L4)

#### Blocked: needs a scope and Tony's decision (1 gun and its headset, about 30 min, not in the total)

Needs a scope on the radio module's reset line and an opened gun; `hardware/inventory.md` lists no scope. Tony decides
first.

99. **F293** (a), the radio reset from cold boot (15 min). Control: with the headset linked, the line shows no reset.
   A/B/A: linked; cold boot with no phone and no headset in range, timing each reset; linked. Closes the lead: a reset
   about every 6 s with no headset answer matches the 5-12 s drop loop. Reopens: no resets, so the loop has another
   cause. (FOLLOWUPS F293, code read 2026-10-26)
100. **F293** (b), a `$DPLAY` clip over 6 s with the headset linked (15 min). Warning: a long `$DPLAY` clip is the
   screamers A1 lock-up recipe, and it may lock the gun. Read [`manual/sound.md`](manual/sound.md) first, and Tony
   decides. Control: a clip under 6 s on the same channel, no reset. A/B/A: short, long, short, scoping the same line.
   Closes: a reset during the long clip only ties the gun lock-ups to the link drops. Power-cycle after any lock.
   (FOLLOWUPS F293)

F444 is blocked too: it waits for the enemy-captured card build.

**Not in this sheet.** Q13 and F537 closed on 2026-10-26 (brx2, from the 2026-10-16 and 2026-10-17 logs).
F595 is a desk row; its bench half is step 85.

## History

Parts 1 and 2 ran on 2026-09-26 and 2026-09-28, and the Part 3 standard sheet ran on 2026-10-02; the results are in
the experiment log under those dates. The 0.4.24 re-bench ran its P1 on 2026-10-17, and the 0.4.26 sheet never ran:
NEXT carries every open step of both. The run sheets that NEXT no longer needs are archived. The levers and screamers
research sittings, with the list of what already ran, moved to [`post-mvp.md`](post-mvp.md) §9 on 2026-10-27: they
gate post-MVP rows, or MVP rows that NEXT now runs. Older order text: `git log -p -- docs/bench-plan.md`.

## Rules for every sitting

Run the pre-flight in [`gotchas.md`](gotchas.md) → *Before a bench session* first. The bench volume, the MC restart
rule and the close: the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md).

## Equipment key

- **2 guns**: shooter A and victim B, armed as in [levers "Roles and arming"](bench-firmware-levers-2026-09-19.md#roles-and-arming).
- **Rig**: the ESP32 IR rig (its ports: [`gotchas.md`](gotchas.md) → *Before a bench session*).
- **Outdoor**: a range of 25 m or more, in shade.
- **Ears**: Tony listens and judges a sound.
- **Phones + MC**: both Pixels and Mission Control, for a real match.

Short names: **levers** = [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md),
**screamers** = [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md).

## Desk work (no gun)

The HANDOFF lanes point here. Each item names its row, its lane, and what blocks it.

| row | lane | the work | blocked by |
|---|---|---|---|
| **F300** | levers and screamers | decode the remaining `$QUERY` sound/gyro/per-slot loop before extending arming read-back | stock-image/capture decode |
| **F269** | levers and screamers | switch the block pause on, and decide the runt `$SIR` rows | NEXT steps 13 and 14 (A7, A8, A8b) |
| screamers Phase B: **F270**, plus one new row per trigger that Phase A reproduces | levers and screamers | one rule in code per reproduced trigger (write with response; the `$PB*`/`$AS` deny list) | NEXT steps 12 to 15 |
| **F285** | levers and screamers | desk table is done; replace its UNMEASURED cells only from recorded bench results | post-mvp §9 research sitting 2, steps 1 and 3-5 |
| **F274** | playtest and node | measure the recoil writer's BLE write budget and complete the hardware soaks | NEXT step 15 (A13) and the three two-hour hardware runs; S55 is shipped |
| **F277** | playtest and node | a detector for a reload that never completes | NEXT step 25 (a repro) |
| **F281** | weapons and perks | move Quick Hands onto `$TMP` t6 in one piece, or not at all | post-mvp §9 research sitting 2, step 4 (t6 absolute or additive) |
| **S50** | weapons and perks | Extended Mags on `$TMP` t9 (one write per life, after `$SPAWN`, then an `$AMMO` fill) | post-mvp §9 research sitting 2, step 2 (per slot or not) |

## Preconditions (build these first)

| tool or change | blocks | row |
|---|---|---|
| Screamers Phase B rules in code | Phase D | after NEXT steps 12 to 15 |
| The lock-up detector's bench validation (built) | Phase E | F272 |
| Block pacing switched on, at the A7/A8 values | Phase C and D results that count | F269 |

## Which sheet owns what

| sheet | status | owns |
|---|---|---|
| [`bench-rebench-0422.md`](bench-rebench-0422.md) | live, ran in part 2026-10-16 | the procedure of most NEXT steps (Sittings A, B and C) |
| [`bench-0426.md`](bench-0426.md), [`bench-field-1017.md`](bench-field-1017.md), [`bench-rebench-0424.md`](bench-rebench-0424.md) | live, procedure only | the NEXT steps that cite 0426, 1017 and 0424 |
| [`bench-2026-09-24.md`](bench-2026-09-24.md) (runbook) | live, procedure only | Blocks 1.5, 2, 2b.3, 5 and 7, as NEXT cites them |
| [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md) | live, P0 | the screamers: Phases A-E (A1, A2 done) |
| [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md) | live | §20 for NEXT; the rest is post-MVP research (post-mvp §9) |
| [`bench-mac-2026-09-29.md`](bench-mac-2026-09-29.md) | live, never ran | B21's iPhone steps (NEXT, the Mac group) |
| [`bench-sticks3-2026-09-23.md`](bench-sticks3-2026-09-23.md) | method | the M5StickS3 bring-up gates; run with the `m5stick-bench` skill |
| [`bench-grenade.md`](bench-grenade.md) | post-MVP method | the grenade and hill rungs (every open rung gates a post-MVP row) |
| [`capture-runbook.md`](capture-runbook.md) | method | how to take a capture; no status |
| [`FOLLOWUPS.md`](FOLLOWUPS.md) MVP BENCH, and [`post-mvp.md`](post-mvp.md) | register | the ids (MVP, then post-MVP); this plan is the order |

Every other bench sheet is archived: grep `docs/archive/`, and open no step from it.
