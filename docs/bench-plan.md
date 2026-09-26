# Bench plan: every open bench step, and the desk work that gates it

Updated: 2026-09-26. **Open this file first at the bench.** How a live bench run works with Tony (who drives
the tools, the "1" reply, the recorder at the end): the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md).

**The next sitting: [below](#next-sitting-after-games-and-014), once the MC GAMES tab redesign lands and app
0.4.14 is cut.** It supersedes the 2026-09-25 read of sitting C; see "Superseded" under "Sittings, in priority
order" for the pointer.

This file holds the ORDER only. Each step points to the sheet section or the FOLLOWUPS row that holds the procedure.
Do not copy a procedure into this file. When a sitting ends, strike its steps here (the skill's close, step 4).

## Next sitting: after GAMES and 0.4.14

Waits on two things landing: the MC GAMES tab redesign (`docs/spec/design/games-redesign.md`, which may still be
landing) and app 0.4.14 (carries F394's ammo-HUD fix and F400's two HUD lows). The cut itself waits on brx1's GO
after a polish loop, so this plan names no date, only "after 0.4.14 is cut". Powerups ship on by default once
F372 lands (already landing): pass no `--powerups` flag to MC anywhere below.

**Kit.** Two guns and headsets. Player phones: a **Pixel 5** (0.4.14; this is "the grey Pixel" below, whose
first open is a test in its own right) and an **iPhone X**, built fresh from `main` on the MacBook (the
`iphone-build` skill, or `npm run ios:push`; `docs/mac-dev-runbook.md`, `app/README.md` "To build for iOS").
The green and black Pixels are extras and stations only (the black one is the phone powerup station). Bench
volume 75. The Stick is COM10; after any MC restart in WSL, `stick.py cmd 10 "MC ws://<laptop>:8766/ws"` (the
node ws port; mDNS cannot reach MC in WSL).

**About 3 h, in strict priority order.** Stop at any STOP POINT if time runs out: earlier groups are worth more
per minute than later ones. Groups are ordered so hardware changes as little as possible.

**A note on iOS.** Several steps read a phone's own log or JS state over adb/CDP
(`mcp/tools/webview_eval.py`), which is Android-only. That still works on the Pixel 5. There is no equivalent
tool here for the iPhone X, so those reads are marked **Pixel-side only** below; Tony's eyes on the HUD are the
iPhone's substitute, and MC's own session log (`python -m brx_mcp.mc.diag <session.sqlite>`) covers anything MC
itself receives from either phone.

### Step 0: setup (about 20 min)

1. Tony re-enables wireless debugging on the grey and green Pixels; the agent `adb connect`s both.
2. **The iPhone X build.** On the MacBook, build and install `main` on the paired iPhone X (`npm run ios:push`
   or the `iphone-build` skill). Log the iOS version it reports (Settings > General > About): the iPhone X tops
   out at iOS 16, and the app wants Safari 16.2 for `color-mix()` (`app/README.md`), so a phone stuck below
   16.2 is a real risk, not a formality.
3. `adb install -r` `app-v0.4.14` on the grey Pixel, the green Pixel and the black station Pixel (today on
   0.4.13; the same release key installs over 0.4.12/0.4.13 with no uninstall). **Do not open the app on the
   grey Pixel**: its first open is step 3 of the GAMES CHECK below (11.7).
4. Restart Mission Control from the latest `main`, with no match ARMED or LIVE. Powerups are on by default
   (F372): pass no `--powerups` flag. Countdown default 30 s.
5. The Stick: `stick.py cmd 10 "MC ws://<laptop LAN address>:8766/ws"`.
- **Log:** each phone's `APP_VER` or iOS build marker, the Stick's STATUS line, MC's boot banner.

Running total: 20 min.

### IPHONE block: does the fresh build work at all (about 15 min; the iPhone X, one gun)

Gate for the rest of the sitting: if this fails, fall back to the green Pixel as player 2 for everything below,
and tell brx1.

1. **Install and open.** Pass: the app installs and opens to the picker with no crash. Log: the iOS version.
2. **BLE connect.** Pass: SET MY GUN finds a gun and links within the usual few seconds.
3. **A match.** Join an MC lobby, arm, go live, take one hit, die, respawn. Pass: every HUD screen appears, as
   on Android.
4. **The ⓘ DEVELOPER debug toggle.** Open the ⓘ panel and flip WebView/remote debugging. Pass: it flips and
   holds after a re-open. brx1 is landing the iOS side now: log INCONCLUSIVE, not a fail, if the control is not
   there yet.
- **Log:** a pass/fail per step and the iOS version, in the experiment log.

STOP POINT 1: if the iPhone failed, run everything below on the green Pixel as player 2 instead. If it passed,
keep the iPhone as player 2 throughout, and flag any step below that needed a Pixel-only read.

Running total: 35 min.

### GAMES CHECK: the new console (about 20 min; both phones, MC)

The MC GAMES tab redesign, `docs/spec/design/games-redesign.md` (may still be landing at this sitting).

1. **PICK GAME in 2-3 taps.** Start a game from the new picker. Pass: 2-3 taps from idle to LOADED, no dead end.
2. **PLAY AGAIN in 4 taps.** After 15 kills, use PLAY AGAIN. Pass: back to LIVE in 4 taps, same settings.
3. **KOTH with no hill assigned (F402, closed at the desk: confirm on hardware).** Try to LOAD a KOTH game with
   no station assigned as the hill. Pass: LOAD is blocked, and the jump to ARMORY fixes it in 1-2 clicks. This
   is also the grey Pixel's first open (11.7): pass also means it joins MC and binds within about 3 s, no tap.
4. **LAST MATCH.** Restart MC, then open the console. Pass: LAST MATCH restores the previous settings.
5. **The countdown default.** Start a game with no countdown override. Pass: it reads 30 s.
- **Log:** a pass/fail per step and tap counts, in the experiment log.

STOP POINT 2: if cut here, the new console's core flow, F402's fix and 11.7's auto-join are proven. Everything
below (powerups, Shields, KOTH, the Stick) is next.

Running total: 55 min.

### Group 1: two phones, two guns, powerups (about 120 min; the highest value)

Kit: both guns and headsets, the Pixel 5 and the iPhone X (or the green Pixel, per STOP POINT 1), MC as
restarted at setup, the black Pixel and the Stick as stations, a tape measure.

1. **F348 (🔴), a Shields spawn starts at full shield (10 min).** Arm a Shields-preset match (45/0/105).
   Control: a Standard-preset spawn shows no shield line. Pass: every spawn and revive's log ends `+ shield pool
   105`, and the meter is full from the first second. Log: `bench-2026-09-24.md` 4.18; the phone log (Pixel-side)
   or Tony's eyes on the meter (either phone).
2. **F394, ammo pips match the number after ALT and after a reload (0.4.14 fix; 5 min).** ALT-switch twice, then
   reload once, on either phone. Control: fire one shot first and confirm the pips and the number agree. Pass:
   after ALT and after the reload, the number and the pips agree with no shot needed. Log: which phone, per
   `bench-2026-09-24.md`'s F394 row.
3. **4.0, the 0.4.14 release loop (20 min).** First launch in day mode, then night mode, on both phones. Then one
   short match through MC: lobby, arm, live, a death and its death screen, the recap. Pass: every screen appears
   in order on both phones, Android and iOS alike, with no stuck or blank state. Log: a screenshot of any defect.
4. **11.6, MC-assigned station ids (F364, closed: confirm; 5 min).** Assign the black Pixel and the Stick on
   ITEMS with no id. Pass: MC gives them two different ids that survive a Stick restart. Log: both ids.
5. **The powerup setup, in order (S58, the now-shipped F372 default; 80 min).**
   - 4.11, the claim calibration (25 min): the ladder at 15/30/60/100 cm against the phone station and the
     Stick, both player phones. Control: 3 m gives no ring. Pass: one threshold per station type, in range at
     30 cm and out at 60 cm on both phones (RSSI reads are Pixel-side; judge the iPhone's ring by eye).
   - 11.2, the claim, the winner, TAKEN and the respawn (15 min). Control: 2 m gives no ring. Pass: a 1 s dwell
     at 30 cm claims; two players racing gives exactly one winner; the item respawns on schedule; death loses it.
   - 3.4, the heavy on the trigger, end to end (25 min). Pass: SELECT toggles it, running dry restores the saved
     weapon, a death re-equips the saved weapon, Easy Reload still gets the grant.
   - 3.5, the overshield, protected (15 min). Pass: a hit during the 1 s grant is ignored, a hit after it drains
     the overshield first, it survives a respawn's `spawned` state.
   - Log: a pass/fail per item, in `bench-2026-09-24.md`'s own tables.

STOP POINT 3: if cut here, the new console, the iPhone build, the release loop, F348, F394, station ids and the
whole powerup setup (S58, the shipped F372 default) are all proven, the single biggest and most valuable block.
**KOTH is next, ahead of the rest of sitting C's tail**: it is MVP, being built right now (F382-F386), and costs
only 15 min for high value, so it must land inside the 3 h rather than after it.

Running total: 175 min.

### Group 2: KOTH, phone hill then Stick hill (about 15 min; same hardware, no change)

1. **Game 1, phone hill (5 min).** MC: mode koth, station_source phone. Control: the point sits NEUTRAL with no
   tick before anyone approaches. Pass: the capture sound and HUD event fire; the tick runs every 3 s held, 1.5 s
   losing, silent while CONTESTED; the score pauses while CONTESTED; MC's recap names a winner.
2. **Game 2, Stick hill (10 min).** Same config, the Stick as the station. Pass: as game 1, plus F384 (a
   recapture is announced), F385 (the HUD card clears within 8 s on both phones), F386 (at the whistle the Stick
   freezes on the final owner and shows MATCH OVER), F353 (log the phone's Stick-advert arrivals during the
   hold; Pixel-side).
- **Log:** the times to CAPTURING, HELD, CONTESTED and neutral; both phones' read of the point.

STOP POINT 4: KOTH is proven on both hill sources. The Stick-alone checks share this setup and are next.

Running total: 190 min.

### Group 3: the Stick alone (about 15 min; no guns, no match)

1. **F387, the RANGE hold gesture, with the serial log running (5 min).** Hold A on STATS with `stick.py`'s
   serial log open (brx4's line prints the hold time in ms). Pass: RANGE opens at 5 s, not about 2 s.
2. **F333, walk every screen at arm's length (10 min).** EMPTY, the countdown, READY, TAKEN, CAPTURING, HELD,
   CONTESTED, LOSING (MATCH OVER was already seen in Group 2, game 2). Pass: each reads clearly, no clipped text.
- **Log:** a pass/fail per screen and per gesture.

STOP POINT 5, THE 3 H LINE: the new console, the release, F348, F394, station ids, the whole powerup setup and
KOTH on both hill sources are all proven, plus the Stick's range-edit gesture and its screen walk. Everything
after this is next sitting's priority list, already ordered below.

Running total: 205 min.

### Group 4: two phones, two guns, the rest of sitting C (about 70 min; same hardware, no change)

Kit: as Group 1.

1. **11.4, the phone station's range edit (F365; 10 min).** Control: a tap and a knock do nothing. Pass: a 1.5 s
   hold opens RANGE, the edit reaches MC (EDITED ON STATION) and the walking phone's threshold changes. Log:
   MC's feed lines; the walk-in RSSI is Pixel-side, or judge the iPhone's own screen by eye.
2. **F400, the pickup switch card (10 min).** Take a heavy pickup. Pass: the full switch-card callout shows on
   the grant, on both SELECT directions and on the empty switch-back; ALT still holds its own time; SELECT works
   at once while the card is up. Then the two 0.4.14 lows: the STOWING/DRAWING/ACTIVE label reads at a legible
   size (was 10 px, under the 11 px floor); the ACTIVE bubble closes on the equip echo, not just its timer (was
   stuck on READY). **Ask Tony** whether a kill card should wait under the switch card (his lean, unconfirmed;
   see "Decisions for Tony" below). Log: a pass/fail per sub-check, and Tony's answer.
3. **F381, a same-weapon pickup stacks (5 min).** Take Rockets, fire once, take Rockets again. Pass: 3 held, a
   third take caps at 4 (`PU_STACK_CAP_X`). Log: the count after each take.
4. **F380, pickup timings with the phone log on (10 min).** Repeat several claims with MC's session log running
   (`python -m brx_mcp.mc.diag <session.sqlite>`; this reads MC's own record, so it works for both phones).
   Pass: no claim reads NOT ANSWERING while a grant is still on its way (the `POWERUP_NO_ANSWER_MS` window).
   Log: each claim's dwell-to-grant time.
5. **F399, the Stick claim-latency re-run (10 min).** Nine claims at the Stick station. Pass: claim-ready to
   grant lands close to 1 s, not the old 2-13 s, median 9 s. Log: MC's session log, same tool as F380.
6. **F374, the HELD Stick carried out of Wi-Fi before START (10 min).** Arm the Stick as a pickup, carry it out
   of Wi-Fi, then push START. Control: part 1 (LOBBY/countdown) already CONFIRMED. Pass: the Stick reads READY
   within a second of `first_at_s`, and no phone claims before it.
7. **11.8, death first (F158, F3, F21, F375 step 6; 15 min).** The scream and the death stop are never cut; a
   kill confirm, a medal or a hill line queues after it. Step 6 (F375, fixed in code, bench pending): take a
   player under 15 HP, then kill within about 1 s, three times normal and three times with a Shields life
   broken first. Pass: "Health critical" never plays after the scream.
- **Log:** each item against its own pass rule, in `docs/experiment-log/2026-09.md`.

STOP POINT 6: sitting C's higher-value checks are all done. The Shields fight, the kill-cue retest and the
voice audition are the lowest value per minute of the two-phone work and are next.

Running total: 275 min.

### Group 5: the Shields fight, the kill-cue retest and the voice audition (about 30 min; same hardware, no change)

1. **The pickup voice audition (10 min).** `$VOL,69`, arm's length, one gun. Play VA56 "Rocket Launcher!" and
   VX0S "Weapon Swap" alone, each twice. Then take a real Rockets pickup in a match and listen for what actually
   plays on the equip (today suspected to be the shotgun-like sound riding in the captured `$WEAP` head). Take
   an Overshield and confirm it plays the shield-charge cue (N102) with no voice line. Log: Tony's pick, and
   what actually played on each real pickup.
2. **The kill-cue A/B/A (F347, closed: confirm on 0.4.14; 10 min).** t23 EMPTY. A kill confirm with the shield
   up, then at 0, then up again. Pass: on time, all three.
3. **F298, a real Shields fight (10 min), the announcer and medal audio (S57).** A kill confirm, first blood, a
   double kill, a lead change. Watch for a wrong IR magnitude (S57: 22 read as 28).
- **Log:** each item against its own pass rule, in `docs/experiment-log/2026-09.md`.

STOP POINT 7.

Running total: 305 min.

### Group 6: a field walk (about 15 min; the Stick and one phone)

1. **F383, Stick-hears-phone at 3, 5 and 7 m (15 min).** The -75 dBm default. Walk a phone in from beyond 7 m.
   Pass: a clean present/absent read at each of 3, 5 and 7 m, with no flapping. Log: the RSSI at each mark.

STOP POINT 8.

Running total: 320 min.

### Group 7: one gun, no phone (about 15 min; lowest priority)

1. **The `$PLAY` spacing check (5 min).** One gun on the laptop MCP, the phone app force-stopped. `send_batch` at
   `gap_ms=150`, then `gap_ms=300`. Pass: all four clips play, in order, at both gaps.
2. **F282, silenced vs standard, eyes and ears (10 min).** A dark room, one weapon armed silenced then normal
   then silenced again (`compile.resolve()` with the preset, never a hand-built frame). Pass: a clear
   muzzle-flash and loudness difference, or none, is agreed on both readings, not just the first.
- **Log:** what Tony saw and heard, per pass.

**Total across every group: about 335 min (5 h 35 min). The 3 h line is STOP POINT 5, at the end of Group 3
(the Stick alone), right after KOTH.**

Rules for every sitting: the preflight in [`gotchas.md`](gotchas.md) ("Before a bench session", which holds the rig
check), `$VOL,65`, and never end on a bare `$CLEAR` (F11). Close every
sitting with the three writes in [`README.md`](README.md) ("Session close is three writes").

## Equipment key

- **2 guns**: shooter A and victim B, armed as in [levers "Roles and arming"](bench-firmware-levers-2026-09-19.md#roles-and-arming).
- **Rig**: the ESP32 IR rig (board A receiver COM7, board B emitter COM8).
- **Outdoor**: a range of 25 m or more, in shade.
- **Ears**: Tony listens and judges a sound.
- **Phones + MC**: both Pixels and Mission Control, for a real match.

Short names: **levers** = [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md),
**screamers** = [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md).

## Done: do not re-run

Levers session 1 ran in three sittings on 2026-09-18 (the log's three "firmware levers session 1" entries):
§1 runs a-e, §4 step 1, §5 (all, including the shield flag and the sound token), §6 step 4 and §10 fn 34 (both
answered by §16), §12 steps 1 and 3 (answered by §23), §13 step 1 and step 3 (magnitudes 1-39), §16 steps 1-3 and
6.1-6.2, §18, §19 step 15 (answered by F71 and F263: one Shotgun pull sends two words), §21 steps 1-10 and 15-18 (t4,
t5, t6, t7, t8, t9), §22 steps 1-6, and §23 (all five steps). Screamers A1 and A2. F276 (the Shotgun words). The whole perks sheet
([`bench-perks-2026-09-18.md`](bench-perks-2026-09-18.md), §1-§8). F230 closed, so levers §19 step 18 is dropped.

**Pre-game check, run 2026-09-19 (Saturday morning office test).** Tony installed the 0.4.0-0.4.2 APKs across the
session. Levers §1 run f (a real TDM through Mission Control with two guns) **PASSED**: cross-team hits
registered on both sides, closing F206's last open gate. The spawn-protection check found a real bug instead of
confirming the design: on 0.4.2 a hit landed damage 0.73 s after a respawn even though the same window blocked
other hits cleanly. That result, plus a shooter seeing a protected player flash "hit" with no damage and a
respawner firing while still protected, drove the 0.4.3 respawn-profile rebuild the same day (F121/F209 closed,
superseded). See `docs/experiment-log/2026-09.md` (2026-09-19 pre-game entry) for the full write-up.

**The 2026-09-24 runbook, [`bench-2026-09-24.md`](bench-2026-09-24.md)** (the experiment log's 2026-09-24 bench
entries). Done: Block 0; Block 1 (F297's laptop control, 10/10 at a median of 1.37 s; F293's loop reproduced on
demand, so step 1.3's capture was not needed); Block 1.4 including step 5 (a mid-match headset power-cycle
reconnected in 2 s with no loop); Block 3.1-3.3 (F308's release order and fire intervals; S58's pickup slots,
button map and overshield clamp); Block 4.3 (the AR ladder passed the spec but felt too harsh, so the balance lane
eased `heavy` 40 to 45 and the Burst Rifle gap 550 to 540 ms, F308); Block 7 step 11 (S57: the victim-name word was
lost inside the headset's rate guard, and the wider gap is on main); and the evening audio A/B/A on one gun (F347:
the native shield hum blocks the gun's audio queue). Off the plan the same day: melee (K4, closed) and F336.

**The 2026-09-25 sitting, [`bench-2026-09-25.md`](bench-2026-09-25.md), sittings A and B and stop point 2.**
Sitting A closed the 0.4.12 gate: A4, F341, F347 (t23 ships EMPTY, no restart delay needed), and F350 (H21 picked,
playtest confirmation left to sitting C's 11.1(c)); 4.19 parts 2-3 and the Burst Rifle gap stayed INCONCLUSIVE.
Sitting B closed F332, the Stick pickup online and offline (S58, found F380 and F381), F333 (reopened by Tony for a deliberate walk; F398 filed),
and Block 9 steps 3 and 4 (H9, H8, found F383-F386); it left F374's carry-out A/B/A un-run, F353 not logged, and
F365's Stick half PARTIAL (RADIUS/STRENGTH confirmed, the 5 s gesture REFUTED as F387, F388 filed; the phone
station half, 11.4, did not run). **Stop point 2 is DONE**: all three Pixels are on app 0.4.12; the grey Pixel
has not been opened since that install, so 11.7's auto-join must be sitting C's first step; MC runs from `main`
with `--powerups`.

## Sittings, in priority order

### Superseded: [`bench-2026-09-25.md`](bench-2026-09-25.md), sitting C

Folded into "Next sitting: after GAMES and 0.4.14" at the top of this file, which supersedes the list below, the
"Carry into sitting C" list and the "Awaiting Tony" note that used to sit here. Kept only for the sheet's own
history; do not run from this section.

### Sitting 1: screamers Phase A, transport half (about 55 min; 1 gun, a laptop)

Screamers are P0. Screamers A1c (the nonblocking loop control, **F272**), A3, A5, A6, A11, A12; A4, A7, A7b, A7c and A8 run in the runbook's Block 2. A7 and A8 give the block-pacing
numbers (**F269**, **F270**); a lock-up feeds **F272**. Keep the block pause off until A7 and A8 give a number.
A3 repeats A1 on other channels and can lock the gun: power-cycle and re-arm before the next step.

### Sitting 2: the rest of levers session 1 (about 100 min; 2 guns, ears, the rig for steps 8 and 9)

1. Levers §21 step 19, `$TMP` t10 crit chance, including the same-value re-send control (10 min). **S50**, **F285**.
2. Levers §21 step 11, and one run that asks whether t9 applies per slot or once for every slot (10 min). Extended
   Mags on `$TMP` waits on this. **S50**.
3. Levers §21 steps 12-14, t1-t3 pool maxima, repeating each same non-zero write before the second read (15 min). **S50**, **F285**.
4. `$TMP` t6 re-send: send t6 = 50 twice, then time one reload (5 min; method in the row). **F285**, **F281**.
5. Complete the F285 table: repeat same non-zero t5 and t7 writes and compare fire timing/damage; for t11 first
   prove the missing-row default sound, then write two distinct ids and identify which one plays (15 min). **F285**.
6. Levers §12 step 2 (does `$STOP` gate the trigger?), then §4 step 2 (a `$SIR` p5 stun on hit) (10 min). **U11′**.
7. **F262**: the shield-hit sound by sensor, ten shots at the headset and ten at the gun body (10 min, ears).
8. ~~Levers §2, melee.~~ **K4** closed 2026-09-24: melee works in our compiled game (bench 2026-09-24 entry, `archive/followups-closed.md`). Steps 5 and 7 (the `$BHIT`/`$FIREX` controls) stay optional, not blocking.
9. Levers §16 step 6.3: does `$CLEAR` stop a headset `$IRTX` loop? (5 min, the rig). **S57**.
10. **F282**: the compiled Suppressor against the compiled AR in a dark room: does either flash, and which is quieter?
   Then `$WEAP` t25/t26 at 0 and at a large value on one weapon (10 min; eyes, ears; method in the row).

### Sitting 3: the recoil numbers, groups A and B (about 30 min; 2 guns on a fixed mount)

Levers §26 groups A and B, pinned with `$TMP` t4 (§21 answered how; see "If §21 moves the mechanism"): the
measured recoil numbers behind the shipped rungs. Groups C, D, E and F go into sitting 8.

### Sitting 4: screamers Phase A, IR half (about 50 min; 1 gun, the rig)

Screamers A8b, A9, A10, A13. A13 gives the per-gun traffic budget (**F274**). A13 replays the shipped recoil writer,
which writes `$TMP` t4 only (S55, shipped).

### Runbook Block 2b: the native kill word and the R4 readings (70 min, plus 20 optional)

The old sittings 4a and 4b. Kit: 2 guns and their headsets, the rig, a laptop and a camera, plus Phones + MC for
the hosted trials. The procedure is [Block 2b of `bench-2026-09-24.md`](bench-2026-09-24.md): native
Death Match kills N1-N3, and the short R4 checks (**F320**, **F321**, **F322**, fn 36/37 on domes 1-3, fn 18/22 on
an enemy, the stored-ID compare, native Survival and FFA). The hosted trials H1-H3 ride on Block 4.2's kills, so
they need both Pixels and Mission Control. Do not send `$AS,1`.

### Sitting 5: match verification (about 60 min; 2 guns, Phones + MC, film)

Levers §1 run f (F206's proof) **already ran and passed**, 2026-09-19; do not re-run it here.
1. **F264** in a live match. If a gun stalls, send `$LIFE,<hp>,0,0,1,*` then `$HLED,,6,*` BEFORE any force respawn,
   and watch for a trigger answer. The row holds the gate.
2. Levers §22 step 7: reproduce the timed-out partial reload on the Energy Rifle. **F277**.
3. **F237** (a slow Pixel 5 re-pick): the row holds its repro.
4. The stun cue: hit a player with the EMP and listen for `X17` on the victim's gun (commit `273e949a`; the row is **U11′** in [`post-mvp.md`](post-mvp.md)).
5. The shield recharge cues on the Shields preset (**F349**: `N101`, `N102`, `VA6Y`, `N74`). If the runbook's 4.19
   already ran them, do not re-run them here; note the result instead.

### Sitting 6: levers session 2 (two sittings; 2 guns, the rig for §9 step 5)

- 6a (about 50 min): §3 `$BHIT`, §6 steps 1-3 (the shield levers), §7 (**S50**), §8 the fuse; use the levers sheet as the procedure source.
- 6b (about 40 min): §9 the crit bonus (**S50**), §10 fn 35, 38, 30, 33, 50-52 (**U11′**), §15 a headless gun (**B26**).

### Sitting 7: levers session 4, the IR rig (two sittings; 2 guns, the rig)

- 7a (about 50 min): §11 splash, §16 step 4 (field 4 = 1), §17 station words (research: the MVP respawn station runs over Bluetooth).
- 7b (about 45 min): §20 indoor half (**S48**, **Q15**), §24 the proc block (**F63**). §13 steps 2 and 3
  (magnitudes 40-63) are optional now (**S57**).

### Sitting 8: the recoil numbers, groups C to F (about 35 min; 2 guns, Phones + MC)

Levers §26 groups C, D, E and F, on the phone's node. The rung basis is settled (S54, `aa7b08b9`); the rungs to
expect are the recoil table in `spec/node.md` §3.15.

### Sitting 9: levers gap sweep (two sittings; 2 guns, the rig for two steps)

- 9a (about 45 min): §19 steps 1-9.
- 9b (about 40 min): §19 steps 10, 11, 14, 16 and 17. Step 17 (`$AS,4`) runs only after sittings 1 and 4. Steps 12
  and 13 moved to §21 and §22; step 15 is answered (F71, F263; the emitter and its reach are F275, sitting 10); step
  18 is dropped.

### Sitting 10: outdoor (about 60 min; 2 guns, outdoor, the rig or the S49 receiver)

**F275** (the `t13` ladder: where the headset word stops arriving). Then the outdoor half of levers §20. Then **F171**
and **F195** (aim tolerance in degrees) if time allows. ⚠ F254 is CLOSED (the eleven-row `$SIR` table). The outdoor
headset-word row was F254 before its renumber and is F275 now.

### Unattended and long runs (no sitting)

- **Screamers Phase C** runs 1-4, 2 h each, one gun and a laptop (now unblocked with `soak --phone-pacing` built). Run 3 soaks the `$TMP` t4 recoil writer (S55, shipped).
- **Screamers Phase D** (3 h, all guns, Phones + MC, the rig), after the Phase B rules are built.
- **Screamers Phase E** (20 min), after the lock-up detector (**F272**) passes its bench validation.

### Backlog (no fixed order; pick by setup)

- [`bench-sticks3-2026-09-23.md`](bench-sticks3-2026-09-23.md): the M5StickS3 gates. Gate 2 (IR receive, **F314**) is
  post-MVP (**F338**, Tony 2026-09-24); the Stick MVP runs over Bluetooth, Block 9 of the runbook.
  Kit: a Stick, the rig, a laptop, one gun for gates 4 and 5.
- [`bench-grenade.md`](bench-grenade.md) "Still to run": B0 first, then X, Z1-Z3, D, B, E, F (C is answered).
- The unrun rungs of [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) that the table below does not mark as
  moved. Do not run BQ-A2 (`$AS,1`): it starts a native game, a screamer path.
- Rows whose method is in the row itself: **F232** and the other "Later" rows of the FOLLOWUPS MVP BENCH group
  that no sheet names yet, and the post-MVP **F167**, **F168** and **F169**.

## Desk work (no gun)

The HANDOFF lanes point here. Each item names its row, its lane, and what blocks it.

| row | lane | the work | blocked by |
|---|---|---|---|
| **F300** | levers and screamers | decode the remaining `$QUERY` sound/gyro/per-slot loop before extending arming read-back | stock-image/capture decode |
| **F269** | levers and screamers | switch the block pause on, and decide the runt `$SIR` rows | sittings 1 and 4 (A7, A8, A8b) |
| screamers Phase B: **F270**, plus one new row per trigger that Phase A reproduces | levers and screamers | one rule in code per reproduced trigger (write with response; the `$PB*`/`$AS` deny list) | sittings 1 and 4 |
| **F285** | levers and screamers | desk table is done; replace its UNMEASURED cells only from recorded bench results | sitting 2 steps 1, 3-5 |
| **F274** | playtest and node | measure the recoil writer's BLE write budget and complete the hardware soaks | A13 and the three two-hour hardware runs; S55 is shipped |
| **F277** | playtest and node | a detector for a reload that never completes | sitting 5 step 2 (a repro) |
| **F281** | weapons and perks | move Quick Hands onto `$TMP` t6 in one piece, or not at all | sitting 2 step 4 (t6 absolute or additive) |
| **S50** | weapons and perks | Extended Mags on `$TMP` t9 (one write per life, after `$SPAWN`, then an `$AMMO` fill) | sitting 2 step 2 (per slot or not) |

## Preconditions (build these first)

| tool or change | blocks | row |
|---|---|---|
| Screamers Phase B rules in code | Phase D | after sittings 1 and 4 |
| The lock-up detector's bench validation (built) | Phase E | F272 |
| Block pacing switched on, at the A7/A8 values | Phase C and D results that count | F269 |

## Which sheet owns what

| sheet | status | owns |
|---|---|---|
| [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md) | live | claims 1-27, §1-§26 |
| [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md) | live, P0 | the screamers: Phases A-E (A1, A2 done) |
| [`bench-perks-2026-09-18.md`](bench-perks-2026-09-18.md) | history | every section answered 2026-09-18 |
| [`bench-sticks3-2026-09-23.md`](bench-sticks3-2026-09-23.md) | live | the M5StickS3 bring-up gates (**F314**, H7); run with the `m5stick-bench` skill, no fixed sitting |
| [`bench-grenade.md`](bench-grenade.md) | open, backlog | the grenade and hill rungs |
| [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) | superseded as the order | the method of its unrun rungs. Moved: BQ-C2 answered (perks §1); BQ-C3 is levers §24; BQ-D2 is levers §2; BQ-D6 is levers §10; BQ-C8 is levers §19 step 11 |
| the 2026-09-05 flash-control, 2026-09-07 super-indoor and 2026-09-11 critical sheets | history | archived 2026-09-24: grep only. Critical: BC-A2 is levers §21 step 16 (done) plus grenade Z1; BC-B3 is grenade X; BC-C1 is levers §6; BC-C2 is answered (perks §2). Super-indoor: Q15; Tony defined S48 on 2026-09-23, and its sweep is Block 6 of the runbook. Flash-control: L1-L9 answered; BQ-D8 cites its rungs 9-10 |
| [`capture-runbook.md`](capture-runbook.md) | method | how to take a capture; no status |
| the 2026-09-13 runbook and the 2026-09-17 weapons sheet | history | already archived: grep only, open no step from them |
| [`FOLLOWUPS.md`](FOLLOWUPS.md) MVP BENCH, and [`post-mvp.md`](post-mvp.md) | register | the ids (MVP, then post-MVP); this plan is the order |

## Decisions for Tony

| decision | what it blocks |
|---|---|
| The ALT indoor/outdoor wording in `manual/fix.md` "IR isn't registering hits" step 4. The page says the field test found no emitted-range change, but V4_31 shows the mode sets emitter power (F171) | no sitting; a manual edit |
| **F400**: should a kill card wait under the pickup switch card, or take over it? Tony's lean is wait, unconfirmed | the switch-card clash fix, checked in the "after GAMES and 0.4.14" sitting above |
