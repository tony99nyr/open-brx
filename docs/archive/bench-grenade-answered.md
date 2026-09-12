# Grenade IR bench — the answered half

The commands in Appendix B were copied back into `../bench-grenade.md` Setup on 2026-09-12; the living
sheet is the one to run from.

Archived 2026-09-12 out of `docs/bench-grenade.md`, which now carries only what is still to run, the
setup and the traps. Nothing here is re-run. The WIRE facts these runs produced live in
`protocol/brx-ir-protocol.md` §"The grenade beacon" — that is the canonical home, not this file.

## Run history

| run | what it answered | write-up |
|---|---|---|
| **2026-09-04 (morning)** | the respawn station is ONE IR word: beacon / button / boot words captured (all 25-bit, proto 15); the emitter arms and revives a native-game gun with the grenade out of the building (4/4, team-gated); hosted games ignore every station word (→ B23); the passthrough row works | [`experiment-log/2026-09.md`](../experiment-log/2026-09.md) 2026-09-04 "THE RESPAWN STATION IS ONE IR WORD" |
| **2026-09-10 (early)** | the HILL is decoded: the beacon carries the owner, neutral is team 2, shooting a neutral hill claims it, and one `$SIR` row makes a hosted game see it (answering step 3's Q3 **yes**, and explaining B23) | [`experiment-log/2026-09.md`](../experiment-log/2026-09.md) 2026-09-10 |
| **2026-09-10 (evening)** | capture proven end to end over BLE; every hosted callout confirmed by ear (rung S); fn 28 confirmed on a real beacon and shown to ignore `<soundID>` (rung Y); the rate-of-fire null (rung D, hosted half); range by estimate (rung R) | [`experiment-log/2026-09.md`](../experiment-log/2026-09.md) 2026-09-10 (evening, cont.) |

🔴 **The one hazard to carry to the bench:** a hill also emits an ordinary `proto=0 mag=8` damage word, which
our standard `$SIR,0,0,,1` row applies in full. It killed the operator in ~106 s with nothing in the event
stream naming the cause (**F69**), and the victim's phone names the WRONG team as the killer (**F81**).

## Answered rungs — here for the METHOD and the traps they cost, not for re-running

**S. ✅ ANSWERED 2026-09-10 (evening) — every hosted callout confirmed BY EAR, one catalogue entry was wrong.**
Driven over BLE at `$VOL,80` (one gun, `Tactix-E20D`, no grenade needed):

| id | catalogued | actually heard | verdict |
|---|---|---|---|
| `VA23` | "Control Point Captured." | as catalogued | ✅ |
| `VA22` | "Control Point Lost." | as catalogued | ✅ |
| `VA21` | "Control Point Contested." | as catalogued | ✅ |
| `VA93` | "King of the hill!" | as catalogued | ✅ |
| **`V8Q`** | **"Hill Confirmed"** | **"KILL Confirmed"** | 🔴 **wrong** |
| `VB0N/O/P/Q` | Hill Captured / Contested / Lost! / Moved | as catalogued | ✅ **preferred** |
| `U100`, `U104` | ui ticks | both tick; U100 more clock-like | ✅ `U100` chosen |

`V8Q` was filed under `voice:objective_hill` off its Whisper transcript, so a hill mode picking callouts BY
CATEGORY would have announced "Kill Confirmed" when someone took a point. Fixed at source in a new
`BY_EAR_CORRECTIONS` table in `mcp/tools/soundbank_classify.py` — **that table is the source of truth for
`V8Q` now, not a hand-edit to the generated catalog**, which the next regeneration would silently revert.
Tony's preference, unprompted: the **`VB0*` set** ("like the Halo announcer, and they have dramatic music"),
one female objectives announcer covering all four states, over the three male "Control Point" lines. `VB0Q`
"Hill Moved" is only meaningful in a rotating-hill mode (several grenades, node picks which is live) — see
FOLLOWUPS F83.

The full chain was then proven live on real hardware: armed by hand with `$SIR,15,0,,28,0,0,1,,*`, `$GSET`
t1=1 and `$TID,1` (not 2 — neutral broadcasts team 2, F82). The beacon arrived as `$HIR,4,15,0,2,8,0,0`,
20+ consecutive beacons, period 5.0 s, no drift, zero misses — grenade beacons, gun registers silently, host
reads it over BLE, host plays the cue.

✅ **The CAPTURE half is now also proven end to end (2026-09-10, later the same evening).** The first pass of
this rung could not fire — the gun was armed to RECEIVE but carried no `$WEAP`, so its magazine was 0 (kept
below as a trap for next time). Re-armed with ammo: one AR round (`mag=24`) took a neutral hill, read live
over BLE as `$HIR,4,15,0,1,50,0,0` (new owner = team 1) ~50 ms after the shot, followed 5 s later by
`$HIR,0,15,0,2,53,0,0` (state left = team 2, on the next beacon cycle, sensor 0 not sensor 4). Operator
confirmed by eye: the grenade turned blue and beeped. Full detail and the "same burst" correction this run
also produced: see the 2026-09-10 (evening) log entry and `protocol/brx-ir-protocol.md`.
⚠ **Trap that cost the first pass: a receive-only arm cannot shoot.** Include a `$WEAP` row with ammo whenever
this rung is repeated.

**Y. ✅ ANSWERED 2026-09-10 (evening) — the GUN cannot play the beacon: fn 28 ignores the `$SIR` `<soundID>` field.**
Armed live (`arm_sequence()`, `$GSET` t1=1, AR in slot 0, grenade set to HILL):
`$SIR,15,0,U100,28,0,0,1,,*` — fn 28 with a known-audible sound (`U100`, confirmed by ear the same evening via
`$PLAY` at the same `$VOL,80`) in the `<soundID>` field. Over a run of several beacons, the row registered
repeatedly and unambiguously (`$HIR,4,15,0,0,8,0,0`, ~5 s apart, no misses) and produced **no sound at all**.
Operator, verbatim: *"havent heard a tick yet."*

**So F73's "zero player feedback" is a property of the FUNCTION, not of leaving the sound slot empty** — fn 28
ignores `<soundID>` outright. Reasoning from the protocol docs alone predicted (a) would play; it does not.
**Design consequence: a gun-native beacon cue is not available through fn 28**, and the alternatives that do
give feedback (fn 8: flash+vibrate, silent; fn 24-27: a long grenade-ish clip) trade away exactly the silence
that makes fn 28 the row to ship. **All hill audio is therefore node/phone work** — `docs/utility-roadmap.md`
"Where the hill audio has to live" updated to this measured answer.

⚠ Scope: measured for **fn 28 only**. (b)/(c) polarity-with-sound and the `$PSET`-override side effect are
both still untested — no sound played at all, so there was nothing to observe an override on or gate by
polarity. Full detail: `docs/experiment-log/2026-09.md` 2026-09-10 (evening, cont.).

**R. ✅ ANSWERED 2026-09-10 (evening), by estimate rather than tape measure.** Close in (desk range) the
beacon is solid, zero misses across 20+ consecutive reads at a clean 5.0 s. At the operator's estimated
~30 ft it turned intermittent — long dropouts (85 s and 145 s of silence) interleaved with brief runs of
clean 5 s beacons. So the reliable range is well under 30 ft and the useful outer edge is around there.
**The hill beacon reaches further than the respawn station** (documented ~18-20 ft). ⚠ Not a hard number:
one operator estimate, no tape measure, and the beacon is AIM-SENSITIVE (`reference/grenade.md`), so
orientation was an uncontrolled variable. **Design consequence:** presence is not a clean in/out at the
range boundary — do not call a player "left the hill" on one missed beacon; with a 5 s period, a grace of
at least two missed beacons (~12 s) is the floor.

## Appendix B. Answered steps


#### 2. Bare watch + box test (2 min) — ✅ **ANSWERED 2026-09-04**

```bash
$PY grenade_bench.py watch $GUN 40 bare COM7
```

Grenade emitter side facing the headset front, 1 ft. Hands off. At the **BOX IT NOW** call, put the
grenade in the closed box.
**Expect:** a beacon every ~2.5 s shown as `GRENADE RESPAWN owner=team2`, the witness reporting
**52 edges** per beacon, and both stopping in the box. At the end it prints the **replay word** for
each distinct beacon. Write the word down if it differs from the predicted
`1111000000100000011000001` (owner team2) or `1111000000010000011000001` (owner team1).

If the witness reports **more than 54 edges** per beacon the grenade uses a longer word than a shot,
and the replay in steps 4 and 5 must use the raw word from step 1's log, not the gun echo. Say so before step 4.

#### 3. Passthrough watch, gun spawned in a game (1.5 min) — ✅ **ANSWERED** (Q3 = yes, 2026-09-10; the row is `$SIR,15,0,,28`, see above)

```bash
$PY grenade_bench.py watch $GUN 30 passthru
```

Same placement. At about 10 s, **shoot the grenade once** with this gun (it should chime and turn
blue). No box this time; ignore the BOX call.
**Expect:** beacons still visible while spawned, flipping from `owner=team2` to `owner=team1/blue` after
your shot. **If none appear**, run the control to confirm the row is the variable, then move on:

```bash
$PY grenade_bench.py watch $GUN 20 game
```

#### 4. Respawn station (5 min, the big one) — ✅ **ANSWERED 2026-09-04** (emitter arms and revives a native-game gun, 4/4, team-gated)

**Power-cycle the grenade first** so it is neutral again. Emitter at a dome, ≤ 3 ft.

```bash
$PY grenade_bench.py respawn $GUN COM8 passthru COM7
```

Phases, each announced on screen with its length:

1. **CLAIM + ARM (30 s):** shoot the grenade once, hold it facing the headset front, press its button
   once at the 15 s call. Listen for what the gun says.
2. **KILL:** the emitter shoots the gun dead. If it prints NOT killed, move the emitter closer and re-run.
3. **GRENADE BUTTON (15 s):** press the button next to the dead headset, twice on the calls.
4. **HEADSET-FRONT + TRIGGER (15 s):** only if still dead. Face the grenade with the headset front, pull
   the trigger twice.
5. **REPLAY (about 25 s):** only if still dead. Box the real grenade; our emitter sends the beacon words.
6. **HOST `$SPAWN`:** kills the gun again if something revived it, then sends the host respawn.
7. **AFTERMATH (10 s):** hands off.

It ends with a verdict table. **Write next to each phase what the gun and headset said and lit.** The
stream cannot hear that, and your ears have out-scored the readings every time.
