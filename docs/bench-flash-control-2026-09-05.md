# Bench 2026-09-05 -- can BLE reach the headset's native camera flash?

One question: can any BLE frame drive the small green flash LED as hard, or as long, as the firmware does on
an IR hit in a native game? If not, prove where the drive lives. Gun Tactix-E20D, stage `raw` action, emitter on
COM8 (PING it first), phone camera on a dark wall.

Standing numbers (2026-09-04): ours `$LED,9,1,1,1,*` wall peak 41-44, w-sum 135-156, 4 frames, no clipping.
Native hit: peak 94 with the wall clipping (true peak higher), w-sum 331-348, 4 frames. Tony by eye "100x".

## 1. Hypotheses, ranked

(a) An untried `$LED` token or value raises the drive or the duration. Decisive: rungs 1-6, any wall peak above
54 (control spread ~3, so 10 is the smallest real change) or a flash longer than 4 frames.
(b) A different request owns the flash: `$HLOOP` (Callsign sends `$HLOOP,0,0,*` 1.7 s after every death, so it
plausibly starts or stops a headset loop), `$CHASE`, `$STUN`, `$VIB`. Decisive: rungs 9-12, a small-LED flash
in the native class (peak above 90 with clipping).
(c) The flash is internal to the firmware's IR-hit path; BLE only gets the low-drive pulse. Decisive: rung 8,
our frame and an emitter hit in the SAME take in a native game. Native still 2x with the gun in the same state
means the path, not the mode or the frame. Rung 11 closes the last door.

## 2. Pre-flight (10 min)

1. Stage up: `python.exe -m brx_mcp stage --gun <Tactix-E20D> --ir COM8`, ARM, SPAWN. SHOOT ME once and see a `$HIR`
   in the log (F11).
2. Camera per the `mcp/tools/ledcam.py` header: brightness and timeout pinned, exposure at minimum, aimed at
   the dark wall, BOTH LEDs out of frame, propped. Every other headset off (a respawn blink contaminated a
   take last night). Room lights as last night, or note the change.
3. Quiet baseline: 10 s recording, wall column below 1.0 (was 0.5).
4. Control pair, same camera position, before any rung:
   - Hosted: `led_flashcam.py run --frames '$LED,9,1,1,1,*' '$LED,9,1,1,1,*' '$LED,9,1,1,1,*' --gap 3`.
     Expect peak 41-44, w-sum 135-156, zero clipped. Outside 34-54: fix the setup before the ladder.
   - Native: stage `disconnect`, power the gun off and on, start a quick game from the gun's own menu, wait
     for the spawn (the flash needs the player alive; a dead headset blinks instead). Record 20 s, three
     emitter hits on the headset dome 3 s apart. Expect peak about 94; write the clip count down, a clipped
     wall makes every native number a floor.
   - An ND filter or sunglasses lens over the camera, if at hand: redo both, keep it on all day. Only an
     unclipped native take bounds the ratio from above.
   - Back to hosted: power cycle, CONNECT, ARM, SPAWN, SHOOT ME, see the `$HIR`.
5. Reading a rung: `wall` at the peak, `w-sum`, `frames`, clip count. Real change = peak outside 34-54 or more
   than 4 frames; native class = peak above 90 with clipping. Tony's call of WHICH LED lit is primary.

## 3. Rungs (one variable each, three repeats 3 s apart unless noted)

Hosted, armed and spawned, unless stated. Frames go through `led_flashcam.py --frames`: measured, not watched.

1. Token 4 (pulses), tok3 = 1: `$LED,9,1,1,<v>,*`, v in 0, 1, 2, 3, 5, 10, 50, 100, 255, 1000, 65535. Pass:
   peak or duration change. A value that refuses to flash is a finding. 8 min.
2. Token 3 (effect), tok4 = 1: `$LED,9,1,<v>,1,*`, same eleven values. The metadata's ledEffectType has a
   Heartbeat member: look for a multi-pulse or held shape in the frames column. 8 min.
3. Token 2 (green flag): `$LED,9,<v>,1,1,*`, v in 2, 3, 255. Pass: anything different from v = 1. 3 min.
4. More tokens: `$LED,9,1,1,1,1,*`, `$LED,9,1,1,1,255,*`, `$LED,9,1,1,1,1,1,1,*`, `$LED,9,1,1,1,,,10,*`. 4 min.
5. Fewer tokens: `$LED,9,1,*`, `$LED,9,1,1,*`. Pass: fires at all, and peak. 2 min.
6. Integration: stage `raw` with five `$LED,9,1,1,1,*` at `delay_s` 0, 0.02, 0.05, one recording each. Does
   w-sum scale ~5x with the peak flat (a longer flash at our drive, a design fallback) or does the peak climb
   (the driver accumulates, push the count)? 6 min.
7. Gun state, `$LED,9,1,1,1,*` x3 in each: after ARM before SPAWN; spawned (control); dead (after KILL ME,
   before RESPAWN). Pass: any state differs. Never test the after-`$CLEAR` state. 6 min.
8. Native game, same take (decisive for (c)): gun in a native quick game as in pre-flight, then stage CONNECT
   while it runs. A refused connection is an answer, record it. If it connects: `$LED,9,1,1,1,*` x3, then
   three emitter hits, one recording. Pass for (a): ours within 0.8x of native. 8 min.
9. `$HLOOP` (known-safe): `$HLOOP,0,0,*`, `$HLOOP,1,0,*`, `$HLOOP,0,1,*`, `$HLOOP,1,1,*`, `$HLOOP,3,1,*`,
   `$HLOOP,1,255,*`, `$HLOOP,1,1,1,*`, 5 s apart since a loop may run. After each: `$HLOOP,0,0,*` then
   `$HLED,,6,,,,,*`. Pass: any small-LED flash and its peak. 6 min.
10. `$CHASE` (off-list, confirm): `$CHASE,1,1,*`, `$CHASE,100,1,*`, `$CHASE,100,10,*`, `$CHASE,3,1,1,*`,
    `$CHASE,1,1,1,1,*`. The eye saw nothing last night; the camera catches a faint pulse. 5 min.
11. `$SIR` shape vs the hosted hit flash. Control: SHOOT ME under the compiled table (blue big-LED flash).
    Re-ARM before EACH variant so one row differs, send it, SHOOT ME x3: Callsign's captured row
    `$SIR,0,0,,1,0,0,1,,*`; a sound in token 3 `$SIR,0,0,H02,1,0,0,1,,*`; tails `0,0,1,1`, `1,0,1,0`, `0,90,1,40`;
    the full captured 10-row table (protocol §5). Pass: Tony calls a GREEN small-LED flash on a hit, native-class
    peak. Fail across all: note `$GSET`/`$PSET` flags as the next suspect, not run today. 12 min.
12. `$STUN` / `$VIB` (off-list, Tony says go at the moment of sending): `$STUN,*`, `$STUN,1,*`, then `$VIB,1,*`
    followed by `$VIB,0,*`. After: pull the trigger and see a shot, a stun may lock the gun. Pass: a
    native-class green flash from a non-LED request. 4 min.

About 75 min of rungs. Re-run the hosted control after rung 6 and at the end; a drift outside 34-54 means the
headset or camera moved, and the rungs between are re-run.

## 4. Stopping rule and write-up

Stop the ladder the moment a rung gives a small-LED peak above 90 and spend the rest on that frame: smallest
form, repeat cadence, the gun states of rung 7, a native side-by-side. Otherwise run all twelve and stand on (c)
with rung 8 as the evidence. Stop and fix if SHOOT ME stops producing `$HIR`. Do not pass 100 min; unfinished
rungs go to FOLLOWUPS as written.

Write-up, same evening:
1. `docs/experiment-log.md`: `### 2026-09-05 (bench) -- FLASH CONTROL LADDER: <verdict in one line>`. Method
   (wall, ND yes/no), the control pair with clip counts, one table row per rung (frame, peak, w-sum, frames,
   clipped, Tony's call), verdict against (a)/(b)/(c), retractions.
2. `protocol/brx-protocol.md`: the `$LED` row (tokens 2/3/4, extra tokens, state dependence), the `$HLOOP`
   row, rows for `$CHASE`/`$STUN`/`$VIB` with what was seen, "nothing" included.
3. `docs/FOLLOWUPS.md` S2 6b: close it, or replace it with the one remaining lever. HANDOFF gets one line.

## 5. Safety

- Off the known-safe list, need `confirm`: `$CHASE`, `$STUN`, `$VIB`. `led_flashcam.py` passes `confirm:true`
  on every frame, so the confirm is the frame list read aloud before `run`. `$LED`, `$HLED`, `$HLOOP`, `$SIR`
  are on the list.
- Never end a run on a bare `$CLEAR` (F11). After PANIC, ARM again and land a SHOOT ME before trusting anything.
- End every loop rung with `$HLOOP,0,0,*` and `$HLED,,6,,,,,*`. End the day armed and blanked, or powered off.
- Never open the Callsign app on our guns (it wipes `$NAME`).
- A clipped wall is a floor, not a measurement. Never rank two clipped signals.


## Appendix A -- the wire layouts, READ from the APK metadata (not guessed), 2026-09-04 late

Source: `global-metadata.dat` type/field/attribute tables (parser: `protocol/callsign-extract/tools/il2cpp_meta*.py`).
Token order = `[MessageParameter(index)]` on each field, calibrated on `$HLED` (Color, Effect, OptionA=on_ms,
OptionB=off_ms, Intensity, Number) and `$GLED` (Left, Mid, Right, Effect, OptionA, OptionB). Palette `LedColorType`:
Red 0, Blue 1, Yellow 2, Green 3, Purple 4, Cyan 5, White 6, Pink 7, Orange 8, Disabled 9. `LedEffect`: Solid 0, Glow 1,
Blink 2, ChaseBack 3, ChaseForward 4, Stop 5, StopIR 6. Level fields carry `[Range(0,10)]` -- that is why 10 = 255.

- `$LED,<Color>,<IsUsedGreenLed>,*` -- exactly two fields. Tokens 3/4 were padding the firmware ignored. **No
  intensity, duration or count lever exists in LED.** Rung 1 below proves the 2-token form.
- `$BLINK,<Color>,<RateBlinkOn>,<RateBlinkOff>,<BlinkLevel 0-10>,<Loop>,*` with Loop = Off 0, Once 1, ThreeTimes 3,
  Infinite 100 (a blink COUNT). Our bench `$BLINK,3,0,300,300,10` was on=0 / off=300 / level=300 (clamped) / loop=10,
  which is why it looked solid.
- `$CHASE,<Color>,<Rate>,<Level 0-10>,<Loop>,*`. `$HLOOP,<LedEffectType: Disable 0 | Enable 1 | Heartbeat 2>,<RateOfPulses>,*`
  (the post-death `$HLOOP,0,0` is Disable; `$HLOOP,2,<rate>` is an untested looping heartbeat).
- **`$BHIT,<BulletType>,<PlayerId>,<Team>,<Damage>,<IsCriticalShot>,<PowerLevel>,<Direction>,*`** -- the `$HIR` field
  set, i.e. it INJECTS a hit through the firmware's own path. The 2026-08-26 "echoed, not applied" result used a
  3-token shape; untested in its real shape. Enums: BulletType Standard 0, MedicHeal 1, EMP 7, MeleeDamage 13;
  TeamType Red 0 Blue 1 Yellow 2 Green 3 Purple 4 Cyan 5; IRDirection Front 0 Back 1 Left 2 Right 3 Gun 4 All 100.
- `$IRTX` (11): Direction, BulletType, PlayerId, Team, Damage, IsCriticalShot, Power, IrRange, LoopFire, IrPulse,
  FlashLED. `$HFIRE` (11): Direction, BulletType, PlayerId, Team, Damage, IsCriticalShot, PowerLevel, Range,
  CountIRPulses, RateOfFire, FlashLED. Earlier zero-IR probes used the old 4-field shape.
- No request carries a flash intensity or duration; STUN = {DeploySpeed}, VIB = {IsEnableVibration}, SFLASH is a
  0-field notification in this build. `libil2cpp.so` is not in the base APK (a split APK), so method bodies are unread.

**Hypotheses re-ranked by the metadata:** (1) LED cannot reach native drive, high confidence (metadata + bench
agree). (2) **`$BHIT` in the 7-token shape runs the firmware hit path, native flash included** -- medium; it also
applies damage, so expect `$HP` to drop, and it is a candidate mechanism for F15 (host-driven stun / EMP) too.
(3) `$HLOOP,2,…` heartbeat or `$CHASE` may loop the flash LED, low. (4) `$HFIRE` / `$IRTX` with FlashLED=1, low, gun-side.

**Appendix frames (blank first; Tony calls the SMALL LED unless noted; `$BHIT`/`$CHASE`/`$IRTX`/`$HFIRE` need `confirm`):**
1. `$LED,3,1,*` -- same small flash as the 4-token form (tokens 3/4 were padding).
2. `$LED,9,0,*` -- control, expect nothing.
3. `$BLINK,3,100,100,10,3,*` -- exactly three green blinks on the big LED (Loop = count).
4. `$BLINK,3,300,300,10,100,*` then `$BLINK,3,300,300,10,0,*` -- infinite, then Off stops it.
5. `$BLINK,3,300,300,5,100,*` vs level 10 -- the 0-10 scale, A/B.
6. `$CHASE,3,100,10,100,*` then `$CHASE,3,100,10,0,*` -- both LEDs; first correctly shaped CHASE.
7. `$HLOOP,2,500,*` then `$HLOOP,0,0,*` -- heartbeat: which LED, how bright, cadence.
8. `$HLOOP,1,500,*` then `$HLOOP,0,0,*` -- Enable variant.
9. `$BHIT,0,1,<enemy team>,5,0,1,0,*` on a spawned gun -- native small-LED flash? hit sound? `$HP` drop? any `$HIR`?
10. `$BHIT,0,1,<enemy team>,5,0,10,4,*` -- PowerLevel 10, Direction Gun; compare the flash.
11. `$HFIRE,0,0,1,0,5,0,1,50,3,100,1,*` on the receiver-first rig (FlashLED=1) -- any emission or flash.
12. `$IRTX,0,0,1,0,5,0,1,50,0,1,1,*` same rig, same question.
If rung 9 flashes native-bright, the design question becomes whether MC/node may inject hits (a `$BHIT` with Damage 0?)
purely for the flash -- and F15 gets a second mechanism.
