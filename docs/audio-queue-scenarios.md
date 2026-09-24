# Audio queue scenarios: what the gun plays, under the app today and under the 0.4.12 rule

2026-09-24. A deterministic simulator of the gun's audio channel, built from tonight's bench, and eight game
situations run through it twice: (A) the app as it is (0.4.11, `app/src/engine.js`) and (B) the planned 0.4.12 rule
(brx4's announcer queue, `docs/announcer.md` on branch `brx4/announcer-queue`). B's rule lives in the harness as a
spec, so brx4's code can be checked against it.

- Simulator: `app/tools/gun-audio-sim.mjs` (pure; the rules are named constants in `GUN_RULES`).
- Policies A and B, the game model and the scenarios: `app/tools/audio-scenarios.mjs`.
  `node app/tools/audio-scenarios.mjs` prints every table below.
- Tests: `app/test/audio-queue.test.mjs` (50 pass, 5 `todo`). A `todo` test is an outcome we want that B does not
  deliver yet. It runs and reports, and it does not fail the suite. Make it a plain test once B delivers it.

## The gun model

| Rule | Status | What the model does |
|---|---|---|
| FIFO | Measured | `$PLAY,,4,6,<id>` clips queue first in, first out. A second clip never cuts in. |
| `$PLAYX,0,*` | Measured | Stops only what plays now; the next queued clip starts. N stops flush N clips. The stopped clip leaves a fragment as long as it played. |
| Shield hum | Measured | While the shield is above 0 and `$PSET` t23 names a sound, a hum holds the channel. A queued clip waits indefinitely (60+ s seen). A stop ends the hum; the queue then plays in order. The hum resumes once the queue drains. Shield 0 = no hum. |
| Silent frames | Measured | `$LIFE` grants and `$HLOOP` make no sound (nor do `$SFLASH`, `$HLED`, `$SPAWN`). |
| `humRestartMs` = 50 | Assumption | The idle gap before the hum restarts. A `$PLAY` inside the gap plays first. See question 1. |
| `humWaitsForQueue` | Assumption | A shield rising above 0 while a clip plays lets the queue finish before the hum starts. |
| `playxOnIdle` = no-op | Assumption | A stop with nothing playing does nothing. |
| `writeFrameGapMs` = 10 | Estimate | The spacing of the frames of one BLE write, so a tight flush leaves fragments of about 10 ms. |
| `audibleFragmentMs` = 80 | Estimate | A shorter piece is not heard as a word. Tonight's 150 ms pieces were heard. |

Clip lengths come from `mcp/brx_mcp/data/sound_catalog.json` (the test checks them). They agree with tonight's ear
timings: VAA "kill" 636 ms, VA6Y "shields online" 2026 ms, N74 heartbeat 1940 ms. The native death scream and the
`$SIR` hit sounds are outside the model (question 5).

Delivery lags in the scenarios are estimates: the victim's S57 `DOWN_BY` word reaches the killer 200 ms after the
death, and MC's `feedback{kill}` (with any lead alert from the same scoring pass) 500 ms after it.

## How the phone sends audio today (A)

- **Kill confirm.** The S57 IR word (`_irKillConfirmed`, alive only) and MC's `feedback{kind:'kill'}` pair inside
  3 s: whichever lands first writes `$SFLASH`, then the line 120 ms later. MC's medals replace the plain line and play
  at 120 + i x 2000 ms, even when the IR word already said the kill line. Feedback plays dead or alive.
- **MC alerts** (`lead_taken`, `lead_lost`, `next_kill_wins`, clock warnings): `alert()` writes the cue at once. MC
  sends the lead alert in the same scoring pass as the kill feedback, so the lead line reaches the gun about 120 ms
  BEFORE the kill's medal line.
- **MC announcer sounds.** MC never writes `$PLAY` itself. It sends the medal names and alert kinds; the phone writes
  its own bundle's cue for each. So every announcer line goes through the same gun FIFO.
- **Hill.** `_hillSay` writes the line at once. A newer hill word within the older line's length sends `$PLAYX` first,
  on the belief that the hill line is what plays. The possession tick (U100) plays every 1 s while we hold the point.
- **Shield.** The break writes `shield_down` (N101, 2.6 s) at once. The heartbeat N74 starts one period later and
  repeats every 1.94 s until the refill starts 6.5 s after the last hit. The refill writes `shield_charging` (N102)
  and then, at full, `shield_online` (VA6Y).
- **Body.** A pain grunt per health hit (one per 600 ms). The low-health line (VA86) after a 400 ms debounce. At death,
  one `$PLAYX` (F149) if the low-health line was sent this life. The spawn line rides the `$SPAWN` write.
- **`$PLAYX` uses:** only the hill preempt, the F149 death stop, and the pre-match abort.

## The scenarios

Latency is from the event (the kill, the alert, the hit) to the clip starting on the gun. "Never" means not played by
the scenario's horizon. "Dropped" means the phone did not send it (B shows the card without the line).

### 1. Halo, shield up (hum): a kill, a double kill, then a killing spree

| Cue (event) | A | B |
|---|---|---|
| kill (1.2 s) | never | 130 ms, full |
| kill (3.2 s) | never | 230 ms, full |
| double kill (3.5 s) | never | 1730 ms, full |
| kill (9.2 s, 14.2 s, 20.2 s) | never | 130 ms each, full |
| killing spree (20.5 s) | never | 1630 ms, full |

Under A the hum holds the channel for the whole 30 s. Every kill line and medal waits behind it and is still queued at
the end: the next shield break would release all seven at once, late.

### 2. Halo, shield broken: a kill confirm mid-heartbeat, then the recharge

| Cue (event) | A | B |
|---|---|---|
| shield down (0.9 s) | 0 ms, full | 0 ms, full |
| kill (5.0 s) | 3601 ms, full | 130 ms, full (cuts the heartbeat) |
| shield charging (7.4 s) | 3777 ms, full | dropped: waits behind the heartbeat, then the hum blocks |
| shields online (10.4 s) | 2875 ms, full | removed |

A plays the pain grunt 2.6 s late behind the break line, then two heartbeats, then the kill. B plays the grunt
2.6 s late as well (finding B4).

### 3. A teammate down during a firefight (hits break the shield)

| Cue (event) | A | B |
|---|---|---|
| shield down (1.8 s) | 0 ms, full | 0 ms, full |
| teammate down (2.0 s) | card only, no sound | card only, no sound |
| "Target down" (2.6 s) | 3021 ms, full | dropped: would start 2 s late |
| shield charging (8.8 s) | 3655 ms, full | dropped: the hum blocks |
| shields online (11.8 s) | 2753 ms, full | removed |

### 4. KOTH, shield up: hill captured, a kill confirm and a lead change inside 1 s

| Cue (event) | A | B |
|---|---|---|
| hill captured (1.0 s) | never | dropped: the hum blocks |
| kill (1.3 s) | never | 130 ms, full |
| lead taken (1.6 s) | never | 1810 ms, full |
| possession ticks (x6) | never | not sent (the hum blocks) |

### 5. Match start: first blood, lead taken and the kill confirm at once

The player spawns at 0 s with shield 0; the refill starts at 6.5 s; the first kill is at 12 s.

| Cue (event) | A | B |
|---|---|---|
| spawn line (0 s) | 20 ms, full | 20 ms, full |
| shield charging (6.5 s) | 0 ms, full | 0 ms, full |
| shields online (9.5 s) | never | removed |
| kill (12.2 s) | never | 140 ms, full |
| lead taken (12.5 s) | never | dropped: expired after 4 s in the queue |
| first blood (12.5 s) | never | 1630 ms, full |

This is tonight's first kill with no cue at all: under A, "shields online" at 9.5 s is already stuck behind the hum,
and everything after it joins the queue.

### 6. I die while my own kill confirm is queued (low health fired)

| Cue (event) | A | B |
|---|---|---|
| shield down (0.5 s) | cut at 1.5 s by the death stop | cut at 1.1 s by the kill's flush |
| low health (1.1 s) | 2150 ms, full, AFTER the death | cut after 10 ms by the kill's flush |
| kill (1.5 s) | 3734 ms, full, after the death | 150 ms, then CUT after 350 of 636 ms by the death stop |

Under A the F149 stop hits the break line that is playing, and the low-health line it was meant to stop plays in full
after the death, then the kill. Under B the kill line is on air when the death lands, and the same stop cuts it.

### 7. Standard: a kill confirm, then the hill captured and lost 300 ms apart

| Cue (event) | A | B |
|---|---|---|
| kill (0.8 s) | 120 ms, CUT after 380 ms by the hill preempt | 120 ms, full |
| hill captured (1.0 s) | 300 ms, full (stale: the hill is already lost) | never said (replaced by the newer word) |
| hill lost (1.3 s) | 1924 ms, full | 1600 ms, full |

### 8. Standard preset (no shield, no hum), control

| Cue (event) | A | B |
|---|---|---|
| kill (1.2 s) | 120 ms, full | 120 ms, full |
| lead taken (1.5 s) | 456 ms, full | dropped: expired after 4.2 s in the queue |
| first blood (1.5 s) | 2399 ms, full | 1620 ms, full |
| kill (3.2 s) | 3155 ms, full | not said: the double-kill line replaces it |
| double kill (3.5 s) | 3491 ms, full | 2350 ms, full |
| hill captured (6.0 s) | 2778 ms, full | 1790 ms, full |

## Findings under A

1. **With the shield up, nothing plays.** The hum holds the channel, and every `$PLAY` waits behind it: kill lines,
   medals, the lead change, the hill lines, and a possession tick per second. When the shield next breaks, the whole
   backlog plays at once, seconds or minutes late (scenarios 1, 4, 5).
2. **The FIFO makes every line late behind the long ones.** "Shield down" (2.6 s), a pain grunt and two heartbeats
   put a kill line 3.6 s late (scenario 2). "Target down" plays 3 s late (scenario 3).
3. **Every `$PLAYX` hits the wrong clip.** The hill preempt cuts my kill line and then plays the stale "Hill Captured"
   (scenario 7). The F149 death stop cuts the break line, and the low-health line it was meant to stop plays after
   the death (scenario 6).

## Findings under B

B fixes all three: every must-hear line plays in full, at once, with the hum up or down. What B still loses:

- Finding B1: the lead change expires. It waits behind the kill line's card and the medal item (together about 4 s), then
  its 4 s TTL drops it (scenarios 5 and 8). Tony asked for the lead change to be heard.
- Finding B2: with the shield up, no line that is not must-hear is ever said. Rule 3 drops them while the hum blocks:
  "Hill Captured", "Hill Lost", "Target down", "next kill wins", the clock warnings and the possession tick
  (scenario 4). In a Halo game the shield is up most of the time.
- Finding B3: my own death cuts my kill line. The F149 death stop is still sent, and it stops whatever plays (scenario 6).
- Finding B4: body sounds skip the one-outstanding rule. A pain grunt in the same hit as the shield break queues 2.6 s
  behind it (scenarios 2, 3, 6).
- Finding B5: "Target down" is lost behind the break line. N101 runs 2.6 s, so the callout passes its 2 s late limit.
- Finding B6: "shields charging" is lost behind a heartbeat that is still playing, then behind the hum. The hum itself
  says the shield is back, so this may not matter.
- Finding B7: medal lines wait about 1.7 s behind the kill line's 1.8 s card. They are heard in full.
- B depends on question 1. B writes the stops first and the line last. If the hum restarts inside the 10 ms before
  the line arrives, every must-hear line under the hum sticks until the NEXT flush (sensitivity test).

## Which cues must be heard

- **Must hear (never dropped, flushes the gun):** my kill line, the medal lines, and the lead change. These are the
  news the player cannot get any other way mid-fight, and a medal is a kill confirm (it replaces the plain line).
- **Worth hearing while still true (droppable when stale):** hill captured and lost, "Target down", shield down, low
  health, "next kill wins", the clock warnings, shields charging, the spawn line. Each describes a state that can
  change within seconds, so a late line can be false.
- **Filler (cut or drop freely):** the heartbeat, the possession tick, the pain grunts. They repeat, or they echo
  what the player already felt.

## Proposed changes to the priority order

The order of record is `ANNOUNCE_PRIORITY` in `app/src/announcer.js` (brx4). The harness mirrors it with a TODO to
import it. The proposed change, against that list:

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

This fixes B1: the lead line plays after the kill line, and the medal follows it. Three rule changes go with it:

1. **For B2:** when the hum is the ONLY thing the gun holds, a line that is not must-hear may stop it with one `$PLAYX`
   and play. Stopping the hum cuts nothing anyone wants to hear, and it resumes by itself.
2. **For B3:** send the F149 death stop only when the model says the low-health line is the clip on air.
3. **For B4:** apply the one-outstanding rule to the pain grunts (drop a grunt while the gun holds a clip).

## Open questions for the bench

1. After `$PLAYX,0` stops the hum with nothing queued, how soon does the hum restart? Does a `$PLAY` sent in the same
   write, right after the stop, play before it? B depends on this. The alternative order (the line first, then the
   stops) does not, but one stop too many would then cut the line itself.
2. Does a tight burst of N `$PLAYX` in one write flush N clips, as 150 ms spacing did? Are the fragments silent?
3. Does a `$PLAYX` with nothing playing do nothing, or does it stop the next clip?
4. When the shield rises above 0 while a clip plays, does the hum wait for the queue, or cut in?
5. Do the gun's own sounds (the native death scream, the `$SIR` and `$PSET` hit sounds) go through the same FIFO?
   Does `$PLAYX` stop the native scream (F149)?
6. Does a token-1 clip (`$PLAY,U100,4,6,,,,,*`, the possession tick) queue like a token-4 clip?

MC's announcer lines are already answered by the code: MC sends only the medal names and the alert kinds, and the
phone writes the lines, so they share the gun's one FIFO.
