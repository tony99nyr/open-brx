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
`--ir COM7|auto` the emitter's serial port -- it is PINGed on attach and a port that does not answer is refused (auto-detect once picked a different USB device); without an emitter the IR buttons only log the word · `--mc http://ip:8765
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
3. **GAME** — ARM (head), SPAWN (T-0 tail + start flash; the gun body is taken 2.5 s later, blank then rest), RESPAWN, GAME END / TEARDOWN ONLY, PANIC (re-ARM after: F11). The tiles show
   what the gun reports (`$HP` / `$LCD` / `$ALCD`) and the phone-side model beside it.
4. **IR AT THE GUN** — SHOOT ME (25), KILL ME (200), EMP (proto 8), MEDIC HEAL (proto 1 pair), RESPAWN BEACON /
   STATION BUTTON (proto 15). Shooter team is a selector. With **AUTO-REACT** on (default) the stage plays what
   the phone would on the hit it sees back: the hit flash, the low-health alert, the death blink, the health band.
5. **GAME EVENTS** — one button per event **in this config's profile** (HUD-driven green, MC-driven amber), greyed
   when the profile carries nothing for it. Plays the cue + burst with the real holds and the one-burst-per-second
   gate. KILL buttons play the shooter-side stack (`$SFLASH` + medal lines, or the kill line).
6. **HEADSET SEQUENCES** — start / hit / death / respawn / carry-flag per team / scored.
7. **LOG** — `tx` written to the gun, `rx` what it said, `ir` emitted, with the reason for each write.
8. **SOUNDBOARD** — the character voices (Tony, 2026-09-06: "pick the voice for the player ... the sounds that
   are related to the chosen voice indicated ... various hit sounds and various personality moments", then "act as
   the character selection and let me hear and test all of these to make sure they are correct per character").
   The game's VOICE selector sits in GAME CONFIG; it rides in the head's `$PSET`, so a change lights a **RE-ARM:
   VOICE CHANGED** pill until ARM is pressed again. The section has its own **CHARACTER** select, independent of the
   game voice (**USE AS THE GAME VOICE** copies it to section 2), **PLAY ALL** (every line in slot order, its
   duration + 0.5 s apart, the playing line highlighted; **STOP** cancels) and, per line, **✓ / ✗** verdicts that
   append to `~/.brx-mcp/voice-verdicts.jsonl` (the walkthrough note box is the note) and colour the line; the
   header pill counts `<n> CHECKED · <m> WRONG` for the board's character. **THE GUN'S SIX (+ KILL)** stay tied to the
   GAME voice: one picker per `$PSET` voice field (deathScream, battleRespawnCry, meleeGrunt, shortPain, longPain,
   painRelief) plus the bundle's kill cue, each naming the event the firmware plays it on. The lines are grouped
   **HIT SOUNDS** (death screams, pains, hurt loop, healed, long death -- the firmware's own reactions) and
   **PERSONALITY MOMENTS** (intro, idle, boast, kill confirms, taunts, defeat taunt, name -- lines we place with a
   `$PLAY`); a badge marks the family's default for each `$PSET` field and the kill cue. In GAME EVENTS a button
   whose sound is `voice:<role>` is drawn in the voice colour with the resolved id and words, and `hit_taken` /
   `died` / `healed` / `respawned` say which `$PSET` line the firmware itself plays there. The patch box takes
   `{"events": {"respawned": {"sound": "voice:boast"}}}` to hang a personality moment on an event.

## Rules it enforces (so a bench run cannot fake a result)
- Every button's frames come from `Compiler.compile()` of the chosen config. The one exception is the **RAW** action (used by
  the bench scripts, not a page button): literal frames, refused unless on the known-safe list or sent with `confirm` (logged UNKNOWN).
- A dropped BLE link is noticed on the next poll and a write reconnects once; walkthrough verdicts append to
  `~/.brx-mcp/stage-verdicts.jsonl`.
- Actions are a whitelist (`server.ACTIONS`); a bad value is a 400 with the validator's message.
- PANIC leaves the gun with no `$SIR` table — the log says so; ARM again before expecting hits.
- No gun linked = dry run: the frames are logged, not written (useful to read a profile).

Tests: `mcp/tests/test_stage.py` (engine, fake gun end-to-end), `test_stage_server.py` (routes).

## Voice

The gun holds ONE line per `$PSET` voice field, so "various hit sounds" is a choice made before ARM, not a rotation:
pick the death scream (slots 3/4/5), the pains (C-H) and the respawn cry (I, or an intro / taunt) in section 8, re-ARM,
then get shot. Every family shares the 22-slot layout read off the gun (`docs/reference/sound-catalog.md`,
`mcp/brx_mcp/voices.py`); the walkthrough's second step plays the respawn cry so the voice is confirmed by ear before
the first spawn. The three commander packs are not player voices (their slots do not follow the layout) and are not
offered.

## Running it from WSL (how the 2026-09-04 session drove it)

The stage must run on Windows Python (Bluetooth). From WSL: `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m
brx_mcp stage --gun <addr> --ir COM8 --host 0.0.0.0 --port 8790` in the background. Reach it from WSL at the Windows
host address (`ip route | awk '/default/ {print $3}'`, e.g. `http://192.168.16.1:8790`), from a Windows browser at
`http://localhost:8790/`. To stop it, do NOT `pkill -f "brx_mcp stage"` from a shell whose own command line contains that
text (it kills the shell); use PowerShell: `Get-CimInstance Win32_Process -Filter "name='python.exe'" | ? CommandLine
-match 'brx_mcp stage' | % { Stop-Process -Id $_.ProcessId -Force }`. A restart drops the gun link; the next write
reconnects once. The emitter port: `--ir COM8` here (COM3 is a different USB device; auto-detect picked it once and the
stage now refuses a port that does not answer PING). Bench scripts drive `POST /api/do {"action":"raw", "frames":[...],
"confirm":true, "delay_s":N}`; give the operator a lead ("fires in 3 s") and repeat a probe three times 3 s apart when
they are judging by eye.
