# Bench run sheet — 2026-09-07 (evening), ~15 minutes

Written because the previous attempt wasted the operator's time by changing one variable at a time with
no control. Everything below is either a single command or a five-second listen. **Do them in order and
stop at the first FAIL** — item 1 gates the rest.

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

## 1. 🔴 Does `$GSET` friendlyFire gate whether an IR word registers? (~3 min, one command)

**Why it matters more than it looks.** Two sessions shot this gun with this emitter within an hour.
brx-sound landed ~30/30 with `$GSET,1,0,…` (FF **ON**). brx-led landed ~3/18 with `$GSET,0,…` (FF **OFF**),
and the three did not reproduce. FF should be irrelevant here — the word claims team 0, the gun is `$TID,1`,
so it is an ENEMY shot and friendly fire only gates SAME-team shots. **If FF decides it, our reading of the
flag is wrong and every hosted TDM game ships FF=0**, i.e. we would be silently discarding hits in real matches.

```
/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.tools.ff_ab <ADDR> --port COM8 --shots 6
```
Arms FF ON / OFF / OFF / ON with every other frame byte-identical, fires six each, counts `$HIR`, prints a verdict.
The alternation is the control the first attempt lacked.

- **FF ON registers, FF OFF does not** → real bug. File it, and re-read the flag before the next match.
- **Both register** → FF is innocent; it was aim/distance all along. Say so plainly and move on.
- **Neither registers** → the emitter is not reaching a sensor. Fix aim (≤ 6 ft, at the gun body or a headset
  dome) before believing anything else. `$HIR` token 1 tells you which sensor: 0-3 headset, 4 gun body.

**Read registration as `$HIR`, never as damage and never by ear.** No `$HIR` = the word never landed.
`$HIR` with unchanged `$HP` = it landed and the row did nothing. Different faults, two seconds apart.

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

## 5. 🟢 See A16 for real (needs an APK carrying `role`, not built yet)

None of the node-side work reaches a player until an APK ships. At the stage, though, the new look is live:
the gun body rests DARK and shows the shield/armour/health bar on a hit (`GUN BODY READOUT` tile in section 3),
the hit flash is three even flashes again, the countdown survives to "GO", and the headset death flash is the
firmware's own — because we stopped switching it off with `$HLED,,6`.

**Close out:** never end on a bare `$CLEAR` (F11) — the stage's teardown and `tools/bench_common.teardown_frames()`
both restore the `$SIR` table. Log to `experiment-log/2026-09.md`, strike or add FOLLOWUPS rows, replace HANDOFF.
