# Bench sheet: the re-bench on APK 0.4.24

Updated: 2026-10-16. This short sheet follows the 2026-10-16 bench (`experiment-log/2026-10.md`, the 2026-10-16
bench entry). It runs on APK 0.4.24 (versionCode 424, not published), built from main `581c9e57` (release commit
`36f4f7f2` on `release/app-0.4.24`, `dirty: false`). It holds three parts, in this order:

1. **The re-tests**: the fixes that 0.4.22 and 0.4.23 failed, or that landed after the bench.
2. **The open Sitting C steps**: they keep their procedure in [`bench-rebench-0422.md`](bench-rebench-0422.md).
3. **Sitting B, optional**: also in the 0422 sheet.

Each step has a control, a pass rule and its FOLLOWUPS row. The row holds the history and the fix; this sheet holds
the procedure. How a bench run works with Tony: the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md).
The index is [`bench-plan.md`](bench-plan.md). Every commit a step needs is in 0.4.24, so this sheet names no
minimum build.

## Before you start

Use the 0422 sheet's *Before you start* and *Setup*, with these changes:

- **The APK** is `/home/tony/apk-0.4.24/brx-companion-0.4.24-android-release.apk`. Its sha256 must be
  `6d11a76a8a1fbaf5561c7b66bb1271a2df90b6c0ed9e6ea24fe5bd25df91295d` (the `sha256` in `/home/tony/apk-0.4.24/build.json`, which also reads `"dirty": false` and
  `"git": "36f4f7f2"`). Each phone's `versionName` reads 0.4.24.
- **The volume is 80 for this sheet** (Tony, 2026-10-16). Start MC with `--bench-volume 80`, and arm a laptop-held
  gun with `volume=80` in the arming recipe. The banner says "BENCH VOLUME 80: not for a real game".
- **Setup step 2 installs 0.4.24**, not 0.4.22: `adb -s <ip:port> install -r` this APK on all four Pixels, and check
  the sha256 above first.
- **The 0422 sheet's RECALL is ABORT** on the console.

## Kit

- Two guns with their headsets: Tactix-E20D with the grey Pixel 5 (player 1, red), and Tactix-9498 with the green
  Pixel 5 (player 2, blue). Part 1's one-gun steps use Tactix-9498 and the green Pixel.
- The hills and stations: the black Pixel 5 (station 1) and the Pixel 10 Pro (station 2). Each lies flat on the
  ground, on its charger, with *Stay awake* on (Developer options) and its screen unlocked. A game hill lies on the
  ground; never measure a hill on a stand.
- **The 0422 sheet's phones map like this.** Where it says the black Pixel or Tactix-FE30 (player 1), use the grey
  Pixel and Tactix-E20D. Where it says the grey Pixel (station 1), use the black Pixel.
- The IR rig emitter as the shooter (single `ir-emit` shots: `--repeat 4 --gap 600` hit 0/4 on 2026-10-16, F538), a
  tape measure (12 m), a stopwatch, and a USB cable for the player phone a step must read (F544).

## Lessons from 2026-10-16

- **A player phone's adb port changes on every Wi-Fi reconnect** (F544). Read the connect `ip:port` again from
  *Wireless debugging* and run `adb connect` and `adb.exe connect` again, before the next CDP read.
- **MC refuses to push or start while a phone is offline.** Bring every phone back before PUSH and START. A step that
  needs a phone closed closes it after START (during the countdown) or once LIVE.
- **MC accepts ABORT only while ARMED**, before T-0. Once LIVE, the operator's end is END.
- **One person holding both guns shadows one phone.** In a presence step, each player phone has its own holder, or
  stands on its own mark.
- **Only the phones under test are in the room.** A third phone, or an unassigned Stick on USB, moved a reading
  (C.5 runs A and B; the stray `$HIR` every 5 s). Unplug any Stick that is not in the step.
- **Do not hold the trigger while a gun powers on.** It opens the stock gun's "Game host" menu (F545).
- **Log the time at each mark** in a presence step. Without it, the log cannot be matched to the mark.

## Part 1: the re-tests

**1. F530, five fast operator respawns (15 min).** The 0422 sheet's A.10, on Tactix-9498 and the green Pixel. Kill
the player with the rig, then send FORCE RESPAWN about 100 ms after the death (the ready `curl` in A.10), 5 times.
**Control:** a timed respawn, before and after. **Pass:** each press logs `operator respawn held <N> ms: the F13
floor after a death` on the phone, and the revive lands about 2.5 s after the death. MC's `operator_result` arrives
when the hold fires, not at the press. Then the headset goes dark, 5 of 5, and the trigger fires after the 0.5 s
weapon delay. Log the stuck count. Row: F530.

**2. F532, a gun power-cycled mid-match (10 min).** A live match on Tactix-9498 and the green Pixel. Read the pools
first (`({hp: window.brx.engine.hp, armor: window.brx.engine.armor, ammo: window.brx.engine.ammo})`), then power-cycle the gun and let it relink, 3 times. **Control:** a
relink with no power-cycle (toggle the phone's Bluetooth). **Pass:** no "down — by UNKNOWN" line and no death on MC.
After the relink, the gun fires, and its pools are the last-known values, not full. A failed or silent reboot check
retries up to 3 times, then heals, still with no death: log the retries. Then once while the player is down.
**Pass:** the player stays down until the respawn. Row: F532.

**3. F533 and the relink reconnect, a spawn with a write error (20 min).** The 0422 sheet's C.4b, on Tactix-9498 and
the green Pixel, the phone beside the gun. Call `window.brx.link.relink()` over CDP about 1 s before go-live, on 5
starts. Time each relink from the call to the link coming back (F541). **Pass (F533):** each start that logs a
`write err` either fires at go-live or heals once (the heal line, then a live trigger at the spawn ammo). No life
starts with 0/0. A start with no `write err` does not test F533: say so, and do more starts. **Pass (F541):** every
relink returns within about 20 s (the fix's estimate; the row's first target was 10 s, so log each time). A tap on
TAP TO RECONNECT during a relink logs `relink: queued tap restarting with a fresh scan` (or ends the wait), never
"press ignored". **Control:** a start with no relink. Rows: F533, F541.

**4. F542: swap, reload and equip (30 min).** F542 now takes the slot from the gun, not from a guess.

1. **F445 trial B** (the 0422 sheet's C.23). The USP-S as the secondary. ALT, then reload: 5 trials at about 300 ms,
   and 5 at about 0.7 s (the 2026-10-16 failure). Log the `$ALCD` slot and magazine of each reload. **Pass:** no
   `reload did NOT take (timeout)`, no stuck pips, the reload is on the new slot (the gun's `$ALCD`), the HUD's ALT
   slot follows the gun's `$QUERY` read-back, and no reload screen shows while the gun fires. **Control:** a reload
   with no ALT. Rows: F445, F542.
2. **The Rockets first-equip probe** (laptop MCP, the green Pixel's app force-stopped; a measurement, not a gate).
   Arm Tactix-9498 from the recipe at `volume=80`. The equip batch is the pickup-rockets head row from the golden
   trace, then the slot's `$AMMO`:

       $WEAP,2,2,100,10,0,115,0,,,,,,35,100,1000,850,2,2,2600,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,1,75,100,*
       $AMMO,2,2,0,1,*

   On each fresh life: `$SPAWN`, wait 3 s, send the batch, wait 1 s, `$QUERY`, then one trigger pull. Log the
   `$LCD` slot and whether a rocket fired. Do 5 lives. Then 5 more lives with the batch sent twice, 300 ms apart.
   **Read:** how often the first equip of a life takes, with one send and with two (C.13 saw it ignored twice).
   **Control:** a second equip on the same life takes. Power-cycle the gun after.
3. **F542 on the phone.** A TDM match with powerups, the Pixel 10 Pro as the Rockets station (RESPAWN 0:30).
   (a) The 0422 sheet's A.13 part 2: one ALT straight after `window.brx.link.relink()`. (b) ALT then fire, 5 times.
   (c) A Rockets pickup just after a spawn, 3 times; if a write error occurs in step 3, note what the equip did.
   After an ALT the gun confirms, the switch card reads CONFIRMED BY YOUR GUN. READY means the swap was assumed: log
   it, and the next `$QUERY`. A pickup reads CONFIRMED. **Pass:** the HUD is on the weapon that fires, every time,
   and a wrong equip slot logs one re-send and a read-back. **Control:** an ALT on a settled life, long after a
   spawn. Row: F542.

**5. C.34 and C.35 with F537 (30 min).** The 0422 sheet's C.34 and C.35, with the black Pixel 5 as station 1 and
the Pixel 10 Pro as station 2, both on the ground. A player phone's Presence now pauses while its own scan is closed.
In C.34, read `window.brx.presence.stations()` over CDP at any "left" line, and log the gap. **Pass (F537):** in the
60 s control and in each run's contested stand (before A stops), no "left" line on player 1's phone. A run with no
`ble scan flood: ... scan closed` line on player 1's phone does not test F537: say so. The C.34 and C.35 pass rules
are unchanged. Rows: F525, F526, F537.

**6. C.25 and C.26 (10 min).** As in the 0422 sheet, on the green Pixel and Tactix-9498. Rows: F442, F396, F379.

**7. The C.5 ground-hill ladder, two more passes (30 min).** The black Pixel 5 lies flat as the KOTH hill at the
default threshold (-75). One player phone at a time; the other is out of the room. Stand 10 s at each mark, and log
the time at each mark: 1, 5, 7.5, 9 and 12 m clear, then 2.5 and 5 m with the body between the phone and the hill.
**Read:** IN or OUT and the hill's dBm at each mark. 2026-10-16's pass: IN at 1 and 5 m clear (-74), OUT at 7.5 m
(-86) and past, OUT body-blocked (-88, -89). **Control:** 1 m clear reads IN at the start and at the end of each
pass. Tony keeps -75; a different edge goes to Tony, not into `types.py`. Rows: F440, F452.

**8. A.9 parts 1 and 2 (10 min).** The 0422 sheet's A.9, with ABORT for RECALL and a 60 s countdown. Part 1: close
and reopen the app while ARMED; press ABORT before T-0; close and reopen the app again; let the planned T-0 pass,
then let the gun relink. **Pass:** the phone is in the lobby, and the gun gets no `$PSET` and no `$SPAWN`. Part 2:
close the app while ARMED, press ABORT, and reopen the app after the planned T-0. **Pass:** the abort frames reach
the gun on the relink, and the gun does not spawn. **Control:** an ABORT with no restart sends the phone to the
lobby (`phase armed → lobby`). Row: F511.

## Part 2: the open Sitting C steps

Run them from [`bench-rebench-0422.md`](bench-rebench-0422.md), with this sheet's kit and lessons, in this order:
C.9, C.14, C.18 (F461: it needs a spawn that loses its fill), C.19, C.20, C.21, C.22, C.24, C.30, C.32, C.33, and
C.36 last, after END. C.4b's three far starts, C.13's three trials and C.10's F448, if time allows. Sitting A's
A.16 to A.21 did not run either: they are one-gun steps, so run them at the start of a sitting, before the hills go down.

## Part 3: Sitting B (optional, last)

The 0422 sheet's Sitting B, unchanged. Reflash both Sticks from the bench sha first (B.0).

## Not in this sitting

The 0422 sheet's table, unchanged.

## Close

Follow the bench-session skill's close: a results table with each control, then the three writes (one log entry,
one FOLLOWUPS diff, the HANDOFF lane), and strike the steps that ran here and in [`bench-plan.md`](bench-plan.md).
