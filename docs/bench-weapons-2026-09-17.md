# Bench: weapon levers for the arsenal rework (2026-09-17)

Tony decided the arsenal rework on 2026-09-17: 13 picks, a ballistic/energy class, heavies as pickups
only, no headset multiplier, the Assault Rifle back to 100 ms, stance and flinch ON by default. Five
of those decisions rest on wire behaviour that nobody has measured. This session measures it.

Rig: Tony's office desktop (Windows Python drives BLE, the ESP32 breadboard has the IR receiver and
emitter), two taggers with powered headsets, the garden for step 3. Drive every step with the brx MCP
tools or one-line commands. Do not write an ad hoc script.

Gun roles: **A** is the shooter (player 1, team 1). **B** is the victim (player 2, team 2).

## Status (end of the first sitting, 2026-09-17)

Results are in `experiment-log/2026-09.md` (2026-09-17 entry); open work is F225-F229 and S42-S47 in `FOLLOWUPS.md`.

| Step | Status | Result |
|---|---|---|
| 1 Hit check | Done | Pass. A victim accepts 999 HP |
| 2 Mid-life `$WEAP` | Done | Pass with guards (S42). A write mid-reload is not measured |
| 3 `t41` range | Open | Use damage 21 on the stock slot (below) |
| 4 Charge Rifle | Done | 10 rounds per charge, lockout at heat 103 for 4.8 s, fn 38 halves damage (F225), under-filled cell locks (F226), `t37` = tap damage |
| 4c Energy Rifle heat | Done | `t38` = 150 alone turns overheat on: locks at heat 99 after about 30 shots, no passive cooling once locked: each lever pull vents about 35 heat (F229). 4d: `t38` = 75 |
| 5 Headset multiplier at t7 = 0 | Done | Pass. Control at t7 50 landed 18 (x2); t7 0 landed 9 (x1) |
| 6 Accuracy recovery | Done on `Tactix-E20D` | About 10 points per 0.15 s after release; full within 2 s. Walk-down varies by burst. `Tactix-3D4F` does not decay (F230) |
| 7 Shield `$LIFE` grants | Done | Maximum from `$PSET` t5, spawn at 0, grants 10-30 land and clamp, 0 → 70 in 3.6 s; recharge and "Shields Online" sounds must be played by the node (S45) |
| Extra: headset yellow flash | Seen | F227: characterise threshold and decay |

**Method rules learned in this sitting:**
- **Cover the victim's gun sensor** for any step that reads damage or the sensor field at close range. Uncovered, it
  catches headset shots at 2 m and reports sensor 4 (F228).
- **A victim needs the `$SIR` row for the shooter's damage key.** The Charge Rifle keys to `<8,0>`; without a row the
  victim ignores its hits.
- **The MCP tool loop takes about 3 s** from an event to the next write. Anything that must land inside a 2 s window
  (a reload) needs a small timing script.

## 0. Pre-flight (5 min)

1. Power-cycle both guns and headsets. Charge both. A sagging battery changes IR power.
2. No phone app may hold a gun. Kill any stale `brx_mcp` process. A connected gun does not advertise.
3. `scan`: both guns show `has_uart_service: true`. `connect` A and B.
4. Keep `$GSET` token 2 at `0` in every frame (F162: `1` cripples reception).
5. **Never end a step on a bare `$CLEAR`.** A gun with no `$SIR` table ignores every hit (F11). The
   teardown is `$CLEAR,*` then the `$SIR` rows again.

Common head, with `<pid>`, `<tid>` filled in. Token 7 of `$GSET` is `0`: that is the new default, and
step 5 checks it.

```
$VOL,65,0,*
$CLEAR,*
$START,*
$GSET,0,0,1,0,1,0,0,1,*
$SIR,0,0,,1,0,0,1,,*
$TID,<tid>,*
```

Then the button map (without it the trigger only produces `$BUT`, F16):
`$BMAP,0,0,,,,,*` `$BMAP,1,100,0,1,99,99,*` `$BMAP,2,97,,,,,*` `$BMAP,3,98,,,,,*` `$BMAP,4,98,,,,,*`
`$BMAP,5,98,,,,,*` `$BMAP,8,4,,,,,*`

## 1. Hit check at the desk (5 min)

- **B:** head (pid 2, tid 2), `$PSET,2,0,999,0,0,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*`,
  the stock AR frame below as slot 0, BMAP, `$SPAWN,,*`, `$AMMO,0,32,384,1,*`, `$BMAP,0,0,,,,,*`.
  Read the `$HP` echo. **If B reports less than 999 HP, write down the value it accepted** and use it.
- **A:** head (pid 1, tid 1), `$PSET,1,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*`,
  the stock AR, BMAP, `$SPAWN,,*`, `$AMMO,0,32,384,1,*`, `$BMAP,0,0,,,,,*`.

Stock AR: `$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*`

Tony fires A at B's headset from 2 m. **Pass:** B's `get_events` shows `$HIR` with magnitude 9 and B's
HP drops by 9.

## 2. Mid-match `$WEAP` is safe (15 min, gates stance and flinch)

A full config push to a live gun clears `spawned`, and nothing re-spawns it. A bare `$WEAP` has never
been sent to a spawned gun. Stance and flinch are not built until every row here passes. Use A, spawned,
with B as the target at 2 m. Poll A's `get_events` for `$ALCD` (token 1 magazine, token 2 live accuracy).

| # | Action | Pass |
|---|---|---|
| 2a | Fire 5 shots. Send `$WEAP` with t22 = 50 (frame below). Fire 5 shots at B. | A still fires, B still takes `$HIR`, no respawn or start sound |
| 2b | Same as 2a, then read the magazine in the next `$ALCD` | Record it. A reset to 32 is expected (a `$WEAP` re-push resets ammo) |
| 2c | Send `$AMMO,0,<live mag>,<live reserve>,1,*` straight after the `$WEAP` | The next `$ALCD` shows the live counts |
| 2d | Send the `$WEAP` while Tony holds the trigger (full auto) | Record what happens: shot drop, stall, or nothing |
| 2e | Send it during a reload, then during a weapon swap | Record the same |
| 2f | Let B hit A while A's `$WEAP` is being written | A still takes the hit |
| 2g | Time from the write to the first `$ALCD` that reflects it; then send 5 writes 200 ms apart | Record the delay; the gun keeps up and stays armed |

Accuracy frame (t21 = 100 ceiling, t22 = 50 floor):
`$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,50,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*`

**Fail = any write that leaves A unable to fire or be hit.** Recover with `$SPAWN,,*` plus `$AMMO`,
write the failure into the experiment log, and stop this step.

## 3. Does `t41` change range? (20 min, garden, gates close-range identities, Q15)

A carries **two slots that differ only in `t41`**, so ALT switches the A/B test on the spot, with the
same gun and battery. Each slot has its own damage, so B's `$HIR` magnitude names the slot.

- Slot 0, **low range**: t41 = 5, damage 1, SMG fire sound so you can hear which slot is live.
  `$WEAP,0,,100,0,0,1,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,G03,,,,D04,D03,D02,D18,,,,,32,192,5,*`
- Slot 1, **stock range**: t41 = 75, damage 21.
  `$WEAP,1,,100,0,0,21,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*`
- After `$SPAWN`: `$AMMO,0,32,384,1,*` and `$AMMO,1,32,384,1,*`.

Place B where the desktop still holds its BLE link (a windowsill facing the garden), so every `$HIR`
is logged with its magnitude. If B drops the link, count by ear and read B's HP when it is back:
HP lost = 21 × stock hits + 1 × low hits. Low hits stay under 21 across 4 distances, so the split is exact, and 999 HP covers every stock hit. Reading HP after each distance keeps the per-distance split.

At each distance (3 m, 10 m, 20 m, 40 m, then further while stock still hits), fire **single shots,
one every 1.5 s**, from a rest, at B's front dome, in this order: 5 stock, 5 low, 5 stock.

| Distance | Stock hits (first 5) | Low hits (5) | Stock hits (last 5) |
|---|---|---|---|
| 3 m | | | |
| 10 m | | | |
| 20 m | | | |
| 40 m | | | |

**Reading:** the two stock columns must agree, or that row is void (the rig drifted). If low matches
stock at every distance, `t41` does not change range: stop planning range identities. If low drops out
early while stock holds, range is a real lever. Note sun and shade for each row.

## 4. Overheat (15 min, gates the energy class)

Only the Charge Rifle carries `t37`/`t38` today. Record `$ALCD` token 5 (heat) on every frame.

| # | Weapon | Action | Record |
|---|---|---|---|
| 4a | Charge Rifle, 40/80 cell (frame below) | Two quick full charges | Heat per frame, the value at lockout, lockout length, whether a reload clears it |
| 4b | Charge Rifle | One tap; one full charge | Rounds spent per tap and per full charge (the "rounds per full charge" field) |
| 4c | Energy Rifle with **`t38` = 150 only** (frame below; `t37` is tap damage, F229) | Hold the trigger | Does it lock out now? Shots before lockout, lockout length |
| 4d | If 4c stays inert: add `t35`/`t36` from the Charge Rifle frame | Hold the trigger | Which token switches overheat on |

Charge Rifle, 40/80 cell:
`$WEAP,0,,100,8,0,100,0,,,,,,,,1250,850,40,80,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,C19,C04,20,150,40,40,75,*`

Energy Rifle with `t38` = 150:
`$WEAP,0,,100,0,0,9,0,,,,,,,,90,850,300,600,2400,0,0,100,100,,6,,,E12,,,,D17,D16,D15,A73,D122,,,150,300,300,75,*`

## 5. Headset multiplier is off at `$GSET` t7 = 0 (5 min)

A fires the **Burst Rifle** (subtype 3, fn 37, a ×2 row at t7 = 50) at B. Add `$SIR,0,3,,37,0,0,1,,*`
to B's table for this step.
`$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*`

**Pass:** 5 headset hits each take exactly 9 from B, the same as a gun-body hit.

## 6. Assault Rifle at 100 ms: what sustained fire costs (15 min, feeds S28)

A: stock AR (100 ms) with the accuracy frame from step 2 (t22 = 50). Tony holds the trigger at B for a
full magazine, then releases. Record `$ALCD` token 2 on every frame: the shot where accuracy leaves
100, the shot where it reaches the floor, and the time it takes to return to 100 after release. Repeat
with t22 = 20. Count how many rounds B registers as hits in each magazine.

## 7. Shield recharge by `$LIFE` grants (10 min, gates the Shields preset)

The Callsign app recharges shields from the app (class `DetectRecoverShieldCommand`), not in the gun.
Tony's target: **a full refill of 70 takes about 4 s**. Arm B with `$PSET,2,0,45,0,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*`.

| # | Action | Record |
|---|---|---|
| 7a | A empties B's shield (8 AR hits). Send `$LIFE,0,0,10,*` once | Shield rises by exactly 10 |
| 7b | Send `$LIFE,0,0,20,*`, then `$LIFE,0,0,25,*` | Which grant sizes apply (F58: 20 healed, 25 did nothing) |
| 7c | From 0, send `$LIFE,0,0,10,*` 7 times, 570 ms apart | The shield reaches 70 in about 4 s; every grant lands |
| 7d | From 60, send `$LIFE,0,0,20,*` | Does the gun clamp at the `$PSET` ceiling of 70, or overfill? |
| 7e | During 7c, A hits B once | The hit lands; the node must restart its timer (design check) |

Also play `A08`, then `A10`, then `VA8C` and `VA6Y` with `$PLAY`, and ask Tony which one sounds like
the recharge start, the hum and "Shields Online". If a real Callsign Halo game is available, time the
delay from the last hit to the hum with a stopwatch: that sets the default delay.

## 8. Close the session

1. Teardown both guns: `$CLEAR,*`, then `$SIR,0,0,,1,0,0,1,,*`.
2. One experiment-log entry with every table above, including the voids.
3. FOLLOWUPS: update Q15 with the step 3 result; add rows for anything that failed.
