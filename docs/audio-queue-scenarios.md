# Audio queue scenarios: what the gun plays, under the app on main and under the 0.4.12 rule

2026-09-24. A deterministic simulator of the gun's audio channel, built from the bench, and eight game situations run
through it twice: (A) the app on main (`app/src/engine.js`: 0.4.11 plus F348's spawn at full shield and F349's
four-grant recharge) and (B) the planned 0.4.12 rule (brx4's announcer queue, `docs/announcer.md` on branch
`brx4/announcer-queue`). B's rule lives in the harness as a spec, so brx4's code can be checked against it.

- Simulator: `app/tools/gun-audio-sim.mjs` (pure; every rule is a named constant in `GUN_RULES`, marked MEASURED
  with its date or ASSUMPTION).
- Policies A and B, the game model and the scenarios: `app/tools/audio-scenarios.mjs`.
  `node app/tools/audio-scenarios.mjs` prints every table below.
- Tests: `app/test/audio-queue.test.mjs` (76 pass, 5 `todo`). A `todo` test is an outcome we want that B does not
  deliver yet. It runs and reports, and it does not fail the suite. Make it a plain test once B delivers it.
- The last section is the bench plan that settles the assumptions the fix depends on.

## The gun model

| Rule | Status | What the model does |
|---|---|---|
| FIFO | Measured 2026-09-24 | `$PLAY,,4,6,<id>` clips queue first in, first out. A second clip never cuts in. |
| Interrupt slot | Measured 2026-09-11 | A token-1 clip (`$PLAY,<id>,4,6,,,,,*`, the possession tick) cuts the clip playing and starts at once. Token-4 clips wait behind it. |
| `$PLAYX,0,*` | Measured 2026-09-24 | Stops only what plays now; the next queued clip starts. N stops flush N clips. The stopped clip leaves a fragment as long as it played. |
| Shield hum blocks the queue | Measured 2026-09-24 | While the shield is above 0 and `$PSET` t23 names a sound, the gun plays it and a queued clip waits: 9 s in one trial, 60+ s in another. A stop ends the hum and the queue plays in order. Shield 0 = no hum. |
| Hum resumes | Measured 2026-09-24 | After a stop and the queue, the hum comes back by itself with the shield still up. |
| Silent frames | Measured 2026-09-24 | `$LIFE` grants and `$HLOOP`. |
| Silent frames | Assumption | `$SFLASH`, `$HLED`, `$SPAWN`, `$PSET`, `$SIR`, `$TMP`, `$TID`, `$AMMO`, `$BMAP`. Any other frame is reported, not guessed. |
| `humYield` = `firstLoopEnd` | Assumption | See "The hum" below. |
| `humClipMs` | Assumption | One hum play is the t23 clip's catalogue length (A10 = 14.952 s). |
| `humStartMs` = 0 | Assumption | Delay from the shield rising to the hum starting. Decides whether a line 20 ms behind the F348 fill is heard. |
| `humRestartMs` = 50 | Assumption | The idle gap before the hum restarts after a stop. A `$PLAY` inside the gap plays first. |
| `humWaitsForQueue` | Assumption | A shield rising while a clip plays lets the queue finish before the hum starts. |
| `interruptOverHum` = `mix` | Assumption | A token-1 clip plays over the hum, which carries on. The only hint: on 2026-09-07 A10 was heard "under every shield-band hit". |
| `playxOnIdle` = no-op | Assumption | A stop with nothing playing does nothing. |
| `writeFrameGapMs` = 10 | Estimate | The spacing of the frames of one BLE write, so a tight flush leaves fragments of about 10 ms. |
| `audibleFragmentMs` = 80 | Estimate | A shorter piece is not heard as a word. The 150 ms pieces of 2026-09-24 were heard. |

Clip lengths come from `mcp/brx_mcp/data/sound_catalog.json` (the test checks them). They agree with the ear timings
of 2026-09-24: VAA "kill" about 0.6 s, VA6Y "shields online" about 2 s. The gun's own sounds (the native death scream,
the `$SIR` and `$PSET` hit sounds) are outside the gun model.

### The hum: one model for both trials

The first version of this simulator encoded "a queued clip waits indefinitely" as measured fact. That ignored the
trial where VAA played 9 s late. The catalogue says A10 is a 14.952 s clip, "sustained / loop-like", so the model now
treats the hum as that clip, played again and again while the shield is up. The open question is when a queued clip
gets the channel:

| `humYield` | A queued clip plays | 9 s trial | 60+ s trial |
|---|---|---|---|
| `everyLoopEnd` | at the end of the current A10 play (at most 15 s late) | fits | does not fit |
| `never` | only after a stop or shield 0 (A10 re-queues ahead of waiting clips) | does not fit | fits |
| `firstLoopEnd` (default) | at the end of the FIRST play after the hum starts; later plays loop with no break | fits, if the line went in during the first play | fits, if it went in later |

Only `firstLoopEnd` fits both trials, and only if the timing reading is right: the notes do not record how long the hum
had run before each VAA. It also fits the field: Tony's match on 2026-09-24 had lines 10 to 15 s late (one A10 play)
and a first kill with no cue at all. Bench step 2 separates the three.

The choice matters for A (how late the stuck lines are) and for the t23 fix. It does not matter for B: B's must-hear
lines stop the hum and play at once under all three (a test checks this).

**What a near-silent t23 would do.** brx5 proposes t23 = EMPTY or a near-silent id (N1A 0.044 s, N89, N87). Under
`everyLoopEnd` N1A frees the queue within 44 ms. Under `firstLoopEnd` or `never`, N1A blocks the queue forever and
SILENTLY, which is worse than A10. EMPTY is the safe choice if an empty t23 plays no loop at all (bench step 2 checks
it).

## How the phone sends audio on main (A)

Read against `app/src/engine.js` and `app/src/app.js` on main. The harness checks the mirrored numbers and the spawn
frames against the source and the golden bundle.

- **The engine tick is 250 ms** (`app.js`). The heartbeat, the hill tick, the recharge and brx4's announcer tick run on
  it. Timers (`delay`) are exact.
- **Kill confirm.** The S57 IR word (`_irKillConfirmed`, alive only) and MC's `feedback{kind:'kill'}` pair inside
  3 s: whichever lands first writes `$SFLASH`, then the line 120 ms later. MC's medals replace the plain line and play
  at 120 + i x 2000 ms, even when the IR word already said the kill line. Feedback plays dead or alive.
- **MC alerts** (`lead_taken`, `lead_lost`, `next_kill_wins`): `alert()` writes the cue at once. MC scores the kill
  first and sends the lead alert right after the feedback (`scoring.py`), so the lead line reaches the gun about
  120 ms BEFORE the kill's medal line.
- **MC announcer sounds.** MC never writes `$PLAY` itself. It sends the medal names and alert kinds; the phone writes
  its own bundle's cue for each, into the same gun FIFO.
- **Hill.** `_hillSay` writes the line at once. A newer hill word within the older line's length sends `$PLAYX` first.
  The possession tick `$PLAY,U100,4,6,,,,,*` is a TOKEN-1 clip: it cuts whatever plays. `_hillTick` waits only for
  our own hill line, so the tick cuts kill lines and medals that the FIFO pushed back.
- **Shield.** The break writes `shield_down` (N101, 2.6 s). The heartbeat N74 starts one period later and repeats on
  the engine tick until the refill starts 6.5 s after the last hit. The refill writes `shield_charging` (N102), then
  four `$LIFE,0,0,27,*` grants one second apart (F349), then `shield_online` (VA6Y) on the echo of the last grant.
- **Spawn.** One write: the life's `$PSET` take (t23 = A10), then the golden `spawn` frames, which START WITH
  `$PLAYX,0,*`, then F348's `$LIFE,0,0,<max>,*` fill, `$SFLASH` and the spawn line. The fill is 20 ms ahead of the line,
  so on a Shields game the hum can start before the line arrives.
- **Body.** A pain grunt per health hit (one per 600 ms). The low-health line (VA86) after a 400 ms debounce. At death,
  one `$PLAYX` (F149) if the low-health line was sent this life.
- **`$PLAYX` uses:** the hill preempt, the F149 death stop, the head of every spawn write, and the pre-match abort.

## The scenarios

Latency is from the event (the kill, the alert, the hit) to the clip starting on the gun. "Never" means not played by
the scenario's horizon. "Dropped" means the phone did not send it (B shows the card without the line). Default gun
rules throughout (`humYield` = `firstLoopEnd`).

### 1. Halo, shield up (hum): a kill, a double kill, then a killing spree

| Cue (event) | A | B |
|---|---|---|
| kill (1.2 s) | 13752 ms | 130 ms, full |
| kill (3.2 s) | 12388 ms | replaced by the double-kill line |
| double kill (3.5 s) | 12724 ms | 130 ms, full |
| kill (9.2 s) | 8811 ms | 130 ms, full |
| kill (14.2 s) | 4447 ms | 130 ms, full |
| kill (20.2 s) | never | 130 ms, full |
| killing spree (20.5 s) | never | 630 ms, full |

Under A the first A10 play ends at 15 s and releases the backlog, 4 to 14 s late. The hum then restarts, and the
lines after it never play. With `humYield` = `never`, all seven never play.

### 2. Halo, shield broken: a kill confirm mid-heartbeat, then the recharge

| Cue (event) | A | B |
|---|---|---|
| shield down (0.9 s) | 0 ms, full | 0 ms, full |
| kill (5.0 s) | 3601 ms, full | 130 ms, full (cuts the heartbeat) |
| shield charging (7.5 s) | 3677 ms, full | 0 ms, full |
| shields online (10.5 s) | 2775 ms, full | removed |

A plays the pain grunt 2.6 s late behind the break line, then heartbeats, then the kill. B plays the grunt 2.6 s late
as well (finding B4). B's heartbeat stops in time for the refill, so "shields charging" is heard.

### 3. A teammate down during a firefight (hits break the shield)

| Cue (event) | A | B |
|---|---|---|
| shield down (1.8 s) | 0 ms, full | 0 ms, full |
| teammate down (2.0 s) | card only, no sound | card only, no sound |
| "Target down" (2.6 s) | 3021 ms, full | dropped: would start 2.15 s late |
| shield charging (9.0 s) | 3455 ms, full | 0 ms, full |
| shields online (12.0 s) | 2553 ms, full | removed |

### 4. KOTH, shield up: hill captured, a kill confirm and a lead change inside 1 s

| Cue (event) | A | B |
|---|---|---|
| hill captured (1.0 s) | 13952 ms (end of the first A10 play) | dropped: the hum blocks |
| kill (1.3 s) | never | 130 ms, full |
| lead taken (1.6 s) | never | 1910 ms, full |
| possession ticks | played over the hum (token 1, assumption `mix`) | not sent (the hum blocks) |

### 5. Match start (a Shields spawn at full shield, F348): first blood, lead taken and the kill confirm at once

| Cue (event) | A | B |
|---|---|---|
| spawn line (0 s) | 15032 ms (behind the first A10 play) | stuck, then cut after 10 ms by the kill's flush |
| kill (12.2 s) | 4618 ms | 140 ms, full |
| first blood (12.5 s) | 6897 ms | 630 ms, full |
| lead taken (12.5 s) | 4954 ms | 3260 ms, full |

The spawn line loses a 20 ms race with the fill (bench step 4). Under B the phone's model marks the line as stuck when
the shield rises, so the kill's flush spends two stops and the stuck line leaves a 10 ms fragment: the "stuck VAA"
of 2026-09-24 in another form.

### 6. I die while my own kill confirm is queued (low health fired)

| Cue (event) | A | B |
|---|---|---|
| shield down (0.5 s) | cut at 2.0 s by the death stop | cut at 1.6 s by the kill's flush |
| low health (1.1 s) | 2150 ms, full, AFTER the death | cut after 10 ms by the kill's flush |
| kill (1.5 s) | 3734 ms, full, after the death | 150 ms, then CUT after 350 of 636 ms by the death stop |

### 7. Standard: a kill confirm, then the hill captured and lost 300 ms apart

| Cue (event) | A | B |
|---|---|---|
| kill (0.8 s) | 120 ms, CUT after 380 ms by the hill preempt | 120 ms, full |
| hill captured (1.0 s) | 300 ms, full (stale: the hill is already lost) | never said (replaced by the newer word) |
| hill lost (1.3 s) | 1924 ms, full | 1700 ms, full |

### 8. Standard preset (no shield, no hum), control

| Cue (event) | A | B |
|---|---|---|
| kill (1.2 s) | 120 ms, full | 120 ms, full |
| lead taken (1.5 s) | 456 ms, full | dropped: expired after 4.25 s in the queue |
| first blood (1.5 s) | 2399 ms, full | 620 ms, full |
| kill (3.2 s) | 3155 ms, full | not said: the double-kill line replaces it |
| double kill (3.5 s) | 3491 ms, then CUT after 1009 ms by the possession tick | 1370 ms, full |
| hill captured (6.0 s) | 2114 ms, full | 1000 ms, full |

## Findings under A (main)

1. **With the shield up, the lines are 4 to 15 s late or never play.** The hum holds the channel. Under the default
   model it releases the backlog once, at the end of its first A10 play; after that the queue waits for the next shield
   break (scenarios 1, 4, 5).
2. **The FIFO makes every line late behind the long ones.** "Shield down" (2.6 s), a pain grunt and the heartbeats put
   a kill line 3.6 s late (scenario 2). "Target down" plays 3 s late (scenario 3).
3. **Every `$PLAYX` hits the wrong clip.** The hill preempt cuts my kill line and then plays the stale "Hill Captured"
   (scenario 7). The F149 death stop cuts the break line, and the low-health line it was meant to stop plays after
   the death (scenario 6).
4. **The possession tick cuts medals.** It is a token-1 clip, and `_hillTick` guards only our own hill line
   (scenario 8: the double-kill line is cut after 1 s).
5. **F348 buries the spawn line.** The fill goes 20 ms ahead of the line in one write, and the hum can win the race
   (scenario 5). Put the spawn line before the fill in the spawn write, if bench step 4 confirms the race.

## Findings under B

B fixes findings 1 to 4 for every must-hear line: each plays in full, at once, with the hum up or down, and under all
three hum models. What B still loses:

- Finding B1: the lead change can expire. Back-to-back medal lines (brx4's round 3) fixed it in scenario 5 (heard,
  3.3 s late). In scenario 8 it still waits behind two kill items and expires at 4.25 s.
- Finding B2: with the shield up, no line that is not must-hear is ever said: "Hill Captured", "Hill Lost", "Target
  down", "next kill wins", the clock warnings and the possession tick (scenario 4).
- Finding B3: my own death cuts my kill line. The F149 death stop still goes out and stops whatever plays (scenario 6).
- Finding B4: body sounds skip the one-outstanding rule. A pain grunt in the same hit as the shield break queues 2.6 s
  behind it (scenarios 2, 3, 6).
- Finding B5: "Target down" is lost behind the break line. N101 runs 2.6 s, past the callout's 2 s late limit.
- Finding B8: on a Shields spawn the spawn line is lost (scenario 5; the same fix as A finding 5).
- B depends on bench step 1 (the hum's restart delay). B writes the stops first and the line last. If the hum
  restarts inside the 10 ms before the line arrives, every must-hear line under the hum sticks (sensitivity test).

## What the review of 2026-09-24 changed

The first version of this harness (27b7e489) was reviewed against the bench facts, `engine.js` on main and brx4's
working tree. What was wrong, and is fixed:

- The simulator stated "a queued clip waits indefinitely" as measured. It omitted the 9 s trial. Now the hum is a clip
  with three named yield models.
- The simulator treated token 1 like token 4. The 2026-09-11 bench measured it as an interrupt slot.
- Three `GUN_RULES` constants did nothing (`playxOnIdle`, `humWaitsForQueue`, `silentPrefixes`). All are live now,
  and a test changes each one and sees an outcome move. `$SFLASH`, `$HLED` and `$SPAWN` were labelled measured silent;
  they are assumptions.
- A ran every 10 ms; the engine ticks every 250 ms. A spawned at shield 0 with a 10-per-300-ms recharge; main spawns
  at full shield (F348) and recharges in four grants (F349). A's spawn write lacked the `$PSET`, the leading `$PLAYX`
  and the fill.
- B put medal lines on the 2 s grid (brx4 now plays them back to back), sent unlimited stops (brx4 caps them at 4),
  gave the IR card 1800 ms (brx4: 2000), and lacked brx4's round 3 hold, the refill guard on the heartbeat, the death
  scream in the phone model and the `stopsOwn` preempt rule. B held the queue for the possession tick; brx4 does not.
- The test "no heartbeat while a must-hear line waits" could never fail: its counter sat behind a guard that excluded
  the case. It now counts heartbeats and ticks written while a must-hear line is due.

Not yet covered by any test (breaking them changes no outcome in these scenarios): the stop cap of 4, brx4's round 3
hold, and B's drop of an exempt `$PLAY` while the hum blocks. brx4's model also counts the `$SIR` hit sounds and
folds a spree of waiting kills; the harness does neither.

## Which cues must be heard

- **Must hear (never dropped, flushes the gun):** my kill line, the medal lines, and the lead change. These are the
  news the player cannot get any other way mid-fight, and a medal is a kill confirm (it replaces the plain line).
- **Worth hearing while still true (droppable when stale):** hill captured and lost, "Target down", shield down, low
  health, "next kill wins", the clock warnings, shields charging, the spawn line. Each describes a state that can
  change within seconds, so a late line can be false.
- **Filler (cut or drop freely):** the heartbeat, the possession tick, the pain grunts. They repeat, or they echo
  what the player already felt.

## Proposed changes

The order of record is `ANNOUNCE_PRIORITY` in `app/src/announcer.js` (brx4). The harness mirrors it with a TODO to
import it. Against that list:

```diff
 kill_confirmed      (my kill line only)
 lead_taken
 lead_lost
+medal               (the medal lines, split out of kill_confirmed; must-hear, TTL Infinity, late limit 6 s)
 hill_captured
 hill_lost
 powerup_swap
 alert
 teammate_down
 enemy_down
 powerup_spawn
 status
```

This fixes what is left of B1. With it:

1. **For B2:** when the hum is the ONLY thing the gun holds, a line that is not must-hear may stop it with one `$PLAYX`
   and play. Stopping the hum cuts nothing anyone wants to hear, and it resumes by itself. Or set t23 EMPTY (bench
   step 2), which removes the block at its source.
2. **For B3:** send the F149 death stop only when the model says the low-health line is the clip on air.
3. **For B4:** apply the one-outstanding rule to the pain grunts (drop a grunt while the gun holds a clip).
4. **For B8 and A5:** in the spawn write, put the spawn line before F348's `$LIFE` fill.
5. **For A4:** gate the possession tick on the whole FIFO (brx4 already does), since it is a token-1 clip.

## Bench plan

One gun, the laptop MCP, `$VOL,65`. Tony times by ear with a phone stopwatch (a phone video with sound is better for
steps 2 and 3: the waveform gives the times). Each step lists the frames, the control first, the pass rule and what
it decides. About 15 minutes in total. Send each frame with `send`; send a multi-frame "burst" with `send_batch` and
no delay between frames.

**Setup (1 min).** Arm the gun with the golden head, then `$VOL,65,*`, then the Shields pools with t23 = A10 (the golden
`$PSET` with t4 armour 0 and t5 shield 105):
`$PSET,7,1,45,0,105,50,,H44,JAD,VA3,,,,,VA7,H06,,H36,H22,X49,U15,W71,A10,*`. Step 2 swaps only the token before `*`:
`...,W71,,*` (EMPTY) and `...,W71,N1A,*`. Check the control: `$LIFE,45,0,0,2,*` (shield 0), wait 3 s, send `$PLAY,,4,6,VAA,,,,*`. Pass: VAA at once,
no hum. If VAA is late here, stop: something other than the hum holds the queue.

**Step 1. The hum's restart delay after `$PLAYX,0` (3 min). Decides whether B's "stops first, line last" works.**
1. `$LIFE,0,0,105,*`. Wait 20 s (the hum is past its first play).
2. Burst `$PLAYX,0,*` then `$PLAY,,4,6,VAA,,,,*` (one write). Pass: the hum stops, VAA plays at once and in full, then
   the hum returns. Note the gap between VAA's end and the hum's return.
3. Send `$PLAYX,0,*` alone. Wait 1 s. Send `$PLAY,,4,6,VAA,,,,*`. If the hum is back inside 1 s, VAA waits: this gives
   an upper bound for the restart delay.
Fail rule for step 2: VAA does not play, or plays only after the next shield change. Then B must send the line first
and the stops after it, and the harness needs `humRestartMs` = 0.

**Step 2. The hum as a clip that yields, or a channel that never does, and the t23 variants (6 min).** For each t23
variant (A10, EMPTY, N1A), write its `$PSET` from the setup, then:
- (a) Control: `$LIFE,45,0,0,2,*` (shield 0). Send VAA. Pass: at once.
- (b) `$LIFE,0,0,105,*` at a stopwatch zero. Listen for 20 s: does the hum play, and does it pause about every 15 s?
- (c) At 3 s, send VAA. Note when it plays.
- (d) At 25 s (the hum past its first play), send VAA again. Note when it plays, or that it does not by 60 s.
- (e) `$LIFE,45,0,0,2,*` then `$LIFE,0,0,105,*` (shield 0 then back to 105). Does the hum restart? Send VAA 3 s later.

| t23 | (c) VAA at 3 s plays at | (d) VAA at 25 s plays at | Reading |
|---|---|---|---|
| A10 (control) | about 15 s | about 30 s | `everyLoopEnd` |
| A10 | about 15 s | never by 60 s | `firstLoopEnd` (the default) |
| A10 | never | never | `never` |
| EMPTY | at once | at once | empty t23 = no block: the safe fix |
| N1A | at once | at once | yields every loop: N1A is also a fix |
| N1A | at once | never | the silent block: do NOT ship N1A |

(e) decides whether a shield arriving restarts the "first play", which is what makes `firstLoopEnd` bite in a match.

**Step 3. A tight `$PLAYX` burst (2 min). Decides whether N stops in one write flush N clips.**
1. Control: shield 0. Burst four lines in one write: `$PLAY,,4,6,VA6D,,,,*`, `$PLAY,,4,6,VA6E,,,,*`,
   `$PLAY,,4,6,VB0P,,,,*`, `$PLAY,,4,6,VAA,,,,*`. Pass: all four in order (FIFO holds for a burst).
2. Send the same four again. After 1 s, burst three `$PLAYX,0,*` in one write. Pass (the model's reading): VA6D is cut,
   VA6E and VB0P make at most a click each, VAA plays in full. If VA6E or VB0P plays in full, the gun drops stops that
   arrive too close together, and B must space its stops.
3. With nothing playing, send `$PLAYX,0,*`, then `$PLAY,,4,6,VAA,,,,*` 200 ms later. Pass: VAA plays in full (`playxOnIdle`
   = no-op). If VAA is silent, the gun remembers an idle stop, and B's over-count would cut its own line.

**Step 4. A must-hear cue under rule B, end to end (2 min). The exact frames the app sends.**
1. `$LIFE,0,0,105,*`, wait 20 s (the hum only). Send `$SFLASH,*`, then 120 ms later burst `$PLAYX,0,*` and
   `$PLAY,,4,6,VAA,,,,*`. Pass: VAA within about 0.2 s of the flash, in full; the hum returns after it.
2. The same with one stuck line first: send `$PLAY,,4,6,VA6D,,,,*`, wait 3 s (it is stuck), then the flash and, 120 ms
   later, burst `$PLAYX,0,*`, `$PLAYX,0,*`, `$PLAY,,4,6,VAA,,,,*`. Pass: a short VA6D fragment at most, then VAA in full.
3. The F348 spawn race: shield 0, then burst `$LIFE,0,0,105,*`, `$SFLASH,*`, `$PLAY,,4,6,VAI,,,,*`. Pass (the line wins):
   VAI plays at once. Fail: VAI waits for the hum; then move the line ahead of the fill (A finding 5).

**Step 5. The token-1 slot under the hum (1 min). Decides `interruptOverHum`.**
With the hum on (shield 105, 20 s in), send `$PLAY,U100,4,6,,,,,*`. Mix: the tick plays over the hum and the hum
carries on. Cut: the hum stops. Queue: no tick. The priority tokens (`4,6`) are the same in every frame the app sends,
so their effect does not change any result here; leave them for a later sitting.

**Close.** `$LIFE,45,0,0,2,*` (shield 0), then restore the golden `$PSET`
(`$PSET,7,1,45,70,0,50,,H44,JAD,VA3,,,,,VA7,H06,,H36,H22,X49,U15,W71,A10,*`). Do not end on a bare `$CLEAR`.
