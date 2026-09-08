# Bench run sheet — 2026-09-07 (evening), ~40 minutes

Written because the previous attempt wasted the operator's time by changing one variable at a time with
no control. Every item is a single command, a five-second listen, or a look at the gun with one question
attached. **Do them in order and
stop at the first FAIL** — item 1 gates the rest.
**The main event is item 5, the seven-level bar.** It is not first because item 5 needs hits to register
through the stage, and item 1 is the open question about why sometimes they do not. If shots are landing
fine when you start, skip to 5 and come back.

**Pre-flight** (`gotchas.md` "Before a bench session" is the full list; these are the ones that bit us tonight):
- **The gun must be ON and advertising.** It was not, at the end of the last session — `python.exe -m brx_mcp scan`
  must show a device with `has_uart_service: true`. Battery was ~53% and falling; charge it first if this will run long.
- **One driver at a time.** Say in the session channel that you are taking the gun (by sticker, in chat) + COM8, and say when you hand back.
  Two `brx_mcp stage` processes on the same gun is CONTENTION, not staleness — killing them cost us a false
  "the tagger has slept" diagnosis tonight. (The FOLLOWUPS preflight line about killing stale servers predates
  four sessions sharing one machine.)
- **Nothing else holding COM8.** The stage takes the port exclusively; a `ir-emit` from a second shell gets
  `PermissionError(13)`. If the stage is up, emit THROUGH it (`POST /api/do {"action":"ir","kind":"shot"}`).
- Note where the emitter points and how far. Every "it does not register" tonight came back to this or to item 1.

---

## 1. 🔴 F49 — a SAME-team shot registered and an ENEMY shot did not, and only through the stage (~10 min)

**The friendly-fire question is ANSWERED and it was not the cause.** `tools/ff_ab.py` ran the alternating
A/B on 2026-09-07 (FF ON / OFF / OFF / ON, six shots each, every other frame byte-identical):
**12/12 registered with FF on, 12/12 with FF off.** Friendly fire is innocent. Do not re-run that test.

**What it left open is stranger and is now F49.** With the gun on `$TID,1`, armed **by the stage**, a shot
claiming **team 1 (the gun's own team) REGISTERED** (armour 70 → 20) while a shot claiming **team 0 (an
enemy) did NOT** (no `$HIR` at all), twice each. The identical team-0 word fired through `ff_ab.py` — which
arms the gun **itself** — registered 24/24, then 12/12, then 4/4. Same gun, same `$TID`, same emitter, same
word. **Something other than the team field decides this and we have not found it.**

The job is to diff the two ARMS, not to shoot more:
```
/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.tools.ff_ab <ADDR> --port COM8 --shots 4
```
then arm the same gun from the stage and capture its head frames from the stage log. Compare frame by
frame. The one difference already spotted is the `$PSET` player number (1 from the stage, 7 from ff_ab;
the emitted word claims player 42 in both) — isolate that one first by forcing the stage's `$PSET` to 7.

⚠ **Do not build on "FF is irrelevant" or on any polarity rule until this is explained.** It cost most of
an evening and produced four wrong diagnoses. **Read registration as `$HIR`, never as damage and never by
ear.** No `$HIR` = the word never landed. `$HIR` with unchanged `$HP` = it landed and the row did nothing.
`$HIR` token 1 says which sensor: 0-3 headset, 4 gun body.

## 2. 🟠 The hit-to-reaction latency, on real hardware (~2 min)

The one number still owed. Before the stage was made event-driven this was **0.56–1.14 s** on this gun;
the fake-gun figure afterwards is ~36 ms, which must NOT be quoted as a hardware number. With the stage up
and hits landing, fire three spaced shots and read the gap between the `rx $HIR` and the first `tx` in the
stage log. ⚠ brx-sound saw one emitted word produce **two** `$HIR` ~19 ms apart (it floods the gun body and a
headset dome), which doubles damage and gives two "first reactions" — take the first.

## 3. 🟡 F42.1 — which `game_over` frame is right? (5 seconds, an ear)

`Compiler.cues()` and `presentation.cue_frames()` both carry VA33 for `game_over`, in DIFFERENT `$PLAY`
token slots (token 1 vs token 4). One of them is wrong on hardware and it cannot be told from the desk.
Play both on a spawned gun and say which speaks:
```
$PLAY,VA33,4,6,,,,,*      (token 1)
$PLAY,,4,6,VA33,,,,*      (token 4)
```

## 4. 🟡 The A16 gun-body rungs never run (L10–L14, ~10 min)

From `bench-flash-control-2026-09-05.md` §6 — the down-signal ladder is answered, these are not:
- **A metered A/B of `$HLOOP,2,750` against a native out-blink.** The "might be brighter" call was one
  operator, one session, no meter, and it is deliberately NOT pinned by a test until it is measured.
- The `$HLOOP` rate's usable range (750 and 2000 both work; the ends are unknown).
- **L10** dim 2-of-3 held 60 s: `$GLED,,,,5,,,*` then `$GLED,3,3,9,0,1,,*`, leave it, confirm it holds.
- **L11** `$TID,4` + `$HLED,4` + `$GLED,4,4,4` → purple on both surfaces. ⚠ **F35: do not leave the gun on
  tid ≥ 4** — teammates damage each other and a gun can kill itself off a nearby surface.

## 5. 🔴 THE SEVEN-LEVEL BAR (A16.3) — never seen on hardware (~10 min, the main event)

Built tonight across MC, the node and the stage; **nothing below has been observed on a gun.** Run the
stage (`python -m brx_mcp stage`, connect, ARM, SPAWN) and take hits through it. Judge with your eyes,
one question at a time, and say which of these is wrong rather than "it looks off":

1. **At rest the gun body is DARK.** Not team colour, not breathing. If it is lit at rest, stop here.
2. **A hit shows a bar, then it goes dark again after about 4 s.** The bar is the pool that MOVED, innermost
   first: armour PURPLE, then health GREEN → YELLOW → RED as it drains. Shield is WHITE.
3. **The drop is animated, not a jump.** You should see: the OLD level held for a beat, one all-off blink,
   then segments stepping down one at a time, settling on the new level.
4. **Half-steps BLINK.** Seven levels come out of three LEDs, so odd levels are N solid plus one blinking
   segment. Per-LED brightness does not exist — the brightness token is global — so if you ever see one
   segment genuinely DIMMER than its neighbours rather than blinking, that is a real finding, write it down.
5. **A fresh life starts from FULL.** Die, respawn, take one hit: the animation must start at three solid,
   not from where that pool ended the previous life. This is the exact bug the last fix of the night closed,
   and it is invisible on the stage's own screen — it needs the GUN.
6. **Rapid fire must not strobe.** Under a burst the bar steps down without replaying the all-off blink each
   time. The ceiling is 3 light-ups per second and it is a photosensitivity rule, not a taste one. If it
   flickers hard under automatic fire, that is a stop-the-line finding.

None of this reaches a PLAYER until an APK carrying A16 + A17 is built (0.1.7 predates both).

## 6. 🟢 See A16 for real (needs an APK carrying `role`, not built yet)

None of the node-side work reaches a player until an APK ships. At the stage, though, the new look is live:
the gun body rests DARK and shows the shield/armour/health bar on a hit (`GUN BODY READOUT` tile in section 3),
the hit flash is three even flashes again, the countdown survives to "GO", and the headset death flash is the
firmware's own — because we stopped switching it off with `$HLED,,6`.

**Close out:** never end on a bare `$CLEAR` (F11) — the stage's teardown and `tools/bench_common.teardown_frames()`
both restore the `$SIR` table. Log to `experiment-log/2026-09.md`, strike or add FOLLOWUPS rows, replace HANDOFF.
