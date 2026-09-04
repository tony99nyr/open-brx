# The GUN STAGE — click-to-try bench page for one gun

`python -m brx_mcp stage` serves a page where every button plays the frames the phone would write for the
chosen **game config** (the compiled bundle: arm / spawn / respawn / end, every A11 event with its sound +
LED burst, the medal stacks, the A11.6 headset sequences, the A11.7 gun body), and the IR buttons make the
ESP32 emitter shoot the gun so the **firmware reacts for real** while our overlay plays on top. It exists so
LED and sound behaviour can be judged on a bench, one click at a time, before a game ships it.

## Run it (on the machine with Bluetooth — Windows here)

```
/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp stage --gun <addr> --ir auto
# or from a Windows shell: python -m brx_mcp stage --gun <addr> --ir COM7
```
Then open **http://127.0.0.1:8790/**. Flags: `--gun ADDR` connect on start (or SCAN / CONNECT on the page) ·
`--ir COM7|auto` the emitter's serial port (without it the IR buttons only log the word) · `--mc http://ip:8765
--token …` pull a running MC's applied config so the stage plays exactly that game · `--mode` start mode ·
`--fake` no Bluetooth, one emulated gun (for trying the page itself; `SHOOT ME` / `KILL ME` hit it directly).

## The walkthrough (Tony: "pick a game mode and then verify all states")

Section 0. Pick the game (mode / preset / gun body / headset / night, or pull the MC's config), press **START
WALKTHROUGH**. The stage builds the checklist **from that config's compiled bundle** -- pre-game, start, a hit,
low health, death, respawn, carrying each team's flag, every kill-feedback stack, every event the profile
carries a sound or a burst for, game end -- and plays the first step. Each step says what to look and listen
for. **✓ PASS / ✗ FAIL (+ a note) / SKIP** records the verdict and plays the next step; **▶ REPLAY** plays the
current one again. Steps that need the emitter say so when none is attached. Verdicts append to
`~/.brx-mcp/stage-verdicts.jsonl` with the mode / preset / gun / headset they were given under, so a "FAIL"
is tied to the exact profile. A silenced preset has no sound steps; night has no LED steps.

## The page, top to bottom

1. **LINK** — scan, pick, connect. One gun at a time.
2. **GAME CONFIG** — the source of truth for everything below. Mode · preset · gun body (`native` = firmware
   breathing, `team`, `dark`, `health`) · headset in play · my team · night. **PULL THE MC'S APPLIED CONFIG**
   replaces all of that with what a running MC has; **the patch box** merges a `presentation` patch (the same
   shape `PUT /api/config` takes) and recompiles, so an event's sound or colour can be changed and tried in the
   same minute. Anything the server would refuse is refused here with the same message.
3. **GAME** — ARM (head), SPAWN (T-0 tail + start flash), RESPAWN, END, PANIC (re-ARM after: F11). The tiles show
   what the gun reports (`$HP` / `$LCD` / `$ALCD`) and the phone-side model beside it.
4. **IR AT THE GUN** — SHOOT ME (25), KILL ME (200), EMP (proto 8), MEDIC HEAL (proto 1 pair), RESPAWN BEACON /
   STATION BUTTON (proto 15). Shooter team is a selector. With **AUTO-REACT** on (default) the stage plays what
   the phone would on the hit it sees back: the hit flash, the low-health alert, the death blink, the health band.
5. **GAME EVENTS** — one button per event **in this config's profile** (HUD-driven green, MC-driven amber), greyed
   when the profile carries nothing for it. Plays the cue + burst with the real holds and the one-burst-per-second
   gate. KILL buttons play the shooter-side stack (`$SFLASH` + medal lines, or the kill line).
6. **HEADSET SEQUENCES** — start / hit / death / respawn / carry-flag per team / scored.
7. **LOG** — `tx` written to the gun, `rx` what it said, `ir` emitted, with the reason for each write.

## Rules it enforces (so a bench run cannot fake a result)
- Every frame comes from `Compiler.compile()` of the chosen config; nothing on the page hand-rolls a frame.
- Actions are a whitelist (`server.ACTIONS`); a bad value is a 400 with the validator's message.
- PANIC leaves the gun with no `$SIR` table — the log says so; ARM again before expecting hits.
- No gun linked = dry run: the frames are logged, not written (useful to read a profile).

Tests: `mcp/tests/test_stage.py` (engine, fake gun end-to-end), `test_stage_server.py` (routes).
