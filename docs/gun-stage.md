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
Then open **http://127.0.0.1:8790/**. Flags: `--gun ADDR` connect on start (or SCAN / CONNECT on the page; S11: the
connect runs in the background, so the page is up at once with NO GUN LINKED while a sleeping tagger is tried, and a
failed connect is one warn line in the log rather than a hung process) ·
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
3. **GAME** — ARM (head), SPAWN (T-0 tail + start flash; the gun body is taken 2.5 s later, blank then rest), RESPAWN, GAME END / TEARDOWN ONLY, PANIC (re-ARM after: F11, rule in gotchas.md). The tiles show
   what the gun reports (`$HP` / `$LCD` / `$ALCD`) and the phone-side model beside it. A second row is the **reload
   path** (F54): **RELOAD** injects the gun's own handle report `$BUT,2,1` through the same rx path a real pull
   arrives on, and the stage does what `engine.js` `_reloadPulled` does -- the pull is ignored with a full mag, a
   dry reserve, or a reserve the gun has never reported (`$ALCD` only arrives on a shot: fire once on a real gun, or
   press **REPORT AMMO**, which injects an `$ALCD` for the fake), else it repaints the last-moved pool SOLID at its
   current level for `reload_glance_s` (2 s day, 1 s night, from the bundle) and reverts. The glance cancels a drop
   animation in flight, a later drop cancels the glance's revert, and the hint beside the button says what the
   next pull will do before it is pressed. The MODEL tile shows `RELOADING slot n` until an `$ALCD` brings the mag
   back up.
4. **IR AT THE GUN** — SHOOT ME (25), KILL ME (200), EMP (proto 8), MEDIC HEAL (proto 1 pair), RESPAWN BEACON /
   STATION BUTTON (proto 15). Shooter team is a selector. With **AUTO-REACT** on (default) the stage plays what
   the phone would on the hit it sees back: the hit flash, the low-health alert, the death blink, the health band --
   and, on a pool RISE (a heal, an armour pickup, a shield grant), the `healed` / `armour_up` / `shield_up` event
   for the biggest rise, exactly as `engine.js` fires them (F58(b)): a frame that damages and grants in one tick is
   a HIT when the total fell and the gain is dropped (F14), and a rise inside 250 ms of a kill / respawn / down /
   match-over moment is dropped too (the phone's one HUD moment slot). The default profile attaches nothing to
   those events (F58(a) is the ears item), so the log says `pool rise: healed (health +20)` and then that the
   event has nothing configured. F57: the hit that arms the low-health alert plays the alert ONLY (no grunt under
   it) and stamps the 600 ms pain gate, so a hit inside that window is silent too; the log names both.
   **EMP** is the F15 stun when section 2's **STUN (EMP)** is on (off = the stock plain-damage cell; on = the
   compiled head carries the `<8,0>` fn-24 status row, so the word deals no damage): on a live gun the stage writes
   `$AMMO,<slot>,0,0,1,*` for every spawn slot and holds the LIVE mag/reserve per slot (the last `$ALCD`, else the
   spawn frame's); a second EMP extends the window and writes nothing; `$ALCD` is ignored while stunned; expiry
   writes the held counts back once; death cancels with no write (the revive's own `$AMMO` re-arms). The MODEL tile
   shows `STUNNED n s left`, the EMP button says which of the two it will be before it is pressed, and a STUN change
   lights RE-ARM (the row rides in the head). On the fake the EMP word is placed on the session as the gun would
   report it, since the fake knows nothing of `$SIR` functions.
4b. **CONTROL POINT** (F102) -- the phone station (kind 5) half of the hill, which the stage cannot hear over BLE, so
   the advert is **injected**: station id, team (owner while HELD, else the team building it up, or NEUTRAL 255),
   HELD / CONTESTED, direction (static / rising / falling / rising+falling, which the phone reads as UNKNOWN), progress
   0-100 and ON THE POINT. **SEND ADVERT** encodes those into the 16-byte advert and decodes them back through the
   phone's own byte layout (`beacon.js`: team byte 9, flags byte 10, value byte 11) before the hill model reads
   them, and the station keeps advertising (refreshed every poll, like a real one at ~4 Hz) until **STOP
   ADVERTISING**. The model only announces a CHANGE of hands, so rehearse as a sequence: neutral (adopted silently)
   -> held by me (Hill Captured, then the possession tick once per second) -> contested + falling (Hill Contested
   once, 10 s floor; the tick doubles to every 0.5 s) -> neutral (Hill Lost!) -> STOP (silence; the point expires on
   the 4 s presence rule, applied twice as on the phone: the entry stops being read after 4 s and the model expires
   4 s after that; a grenade point keeps its 12 s / two-missed-beacons window). The F70 gate is mirrored: section
   2's **OBJECTIVE SOURCE** (blank = as the config says; koth's row says grenade) decides which wire the phone
   listens to, a phone point is heard only under `phone`, the grenade's IR beacon only under `grenade`, and the
   section's first line says which is in force so a silent SEND is explained before it happens. The walkthrough
   adds the five control-point steps whenever the source is `phone`, and a RELOAD GLANCE step whenever the profile
   has a readout.
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
   header pill counts `<n> CHECKED · <m> WRONG` for the board's character. **THE GUN'S ONE (+ KILL + SPAWN LINE)** stays
   tied to the GAME voice: `painRelief` is now the only `$PSET` voice field still open to a pick (naming the event
   the firmware plays it on -- `healed`), plus the bundle's kill cue, and a
   **SPAWN LINE** card (A15.2, Tony 2026-09-06: "what if we dont rely on the firmware to make the sound on spawn and we
   just control it" -- bench-verified on the bench gun): the `$PSET` battleRespawnCry field is written EMPTY, so the firmware
   says nothing at `$SPAWN`, and the stage (like the phone) appends one take of the spawn pool to the spawn write and
   to the revive write -- `$SPAWN` then `$PLAY` in the same write plays clean, a `$PLAYX` between them clipped the
   firmware's line. The card lists the takes (Male player: VAI "There's nowhere for you to hide." · VAN "Hoorah!" ·
   VAO "Good to go."; other families their boast, one take) and the log names the draw
   (`spawn + spawn line (VAN: Hoorah!)`, `revive + spawn line (…)`); RESPAWN plays exactly one line, never two.
   Two more cards cover A15.3 (Tony, 2026-09-06 bench): a **DEATH SCREAM** card lists the family's takes and, once a
   life has started, "this life: `<id>`" -- one of `pset_pool` (a full `$PSET` per take) is written immediately before
   every `$SPAWN` (spawn and revive alike), so the firmware's own scream changes each life without a picker. A
   **PAIN · BY DAMAGE** card replaces the old meleeGrunt / shortPain / longPain pickers: SHORT (under the long-pain
   threshold, 40 dmg by default), LONG (at or above it -- shotgun / snipers / power weapons) and MELEE, each listing
   its takes -- the three `$PSET` pain fields ship empty and the stage plays one of these itself on every hit the
   player SURVIVES, gated to one grunt per 600 ms (dropped, never queued) and never on the hit that kills (the native
   scream plays there). Section 4's **SHOOT ME** (25 dmg) exercises the short-pain pool and **BIG HIT** (80 dmg) the
   long-pain pool; **KILL ME** (200) plays no pain line, only the native death scream. The lines are grouped
   **HIT SOUNDS** (death screams, gas death, pains, hurt loop, healed -- the firmware's own reactions) and
   **PERSONALITY MOMENTS** (intro, boast, kill confirms, taunts, defeat taunt, name -- lines we place with a
   `$PLAY`); a badge marks the family's default for each `$PSET` field and the kill cue. In GAME EVENTS a button
   whose sound is `voice:<role>` is drawn in the voice colour with the resolved id and words, and `hit_taken` /
   `died` / `healed` / `respawned` say which `$PSET` line the firmware itself plays there. The patch box takes
   `{"events": {"respawned": {"sound": "voice:boast"}}}` to hang a personality moment on an event.
   **ROLLED THIS ARM** (A15, Tony 2026-09-06: "they are all equal and should be picked at random to make the sounds
   more dynamic"; VAI / VAN / VAO "are all good at spawn picked randomly"): every ARM still draws a death scream into
   the head's `$PSET` and the strip shows the draw, but since A15.3 that draw never actually plays -- the DEATH
   SCREAM card's own per-life pick overwrites it before the first `$SPAWN` and every one after; **REROLL** draws
   again without writing (ARM writes, and draws again). A picker shows `ROLLED
   FROM n` while it is left to the draw and `PICKED` once a line is pinned, which the roll never overrides. The kill
   cue is a pool (`n TAKES, ONE PER KILL`: the three kill confirms + the two taunts) and every single kill plays one
   of them at random, on the phone and on the stage alike; the log names the take (`kill (V3K: Ooh, bet that
   hurt.)`). Lines that belong to a roll pool, the kill pool or the spawn pool carry a dashed **… POOL** badge on the
   board (from each line's `uses`, so the badge is the compiler's word, not the page's guess).

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

The gun holds ONE line per `$PSET` voice field, so "various hit sounds" is a draw made at ARM, not a rotation on
the gun: the death scream (slots 3/4/5) and the short pain (G/H/D/C) are rolled on every ARM (Mission Control does the
same per player on every push), or pinned in section 8's pickers; re-ARM, then get shot. Kill confirms and taunts are
`$PLAY` frames we send, so those really are picked at random per kill from `cue_pools` (the same on the phone), and
since A15.2 the spawn line is ours too: the `$PSET` cry field is empty and one take of the spawn pool (VAI / VAN / VAO
for the Male player, the boast elsewhere) rides in every spawn and revive write. Every family shares the 22-slot layout read off the gun (`docs/reference/sound-catalog.md`,
`mcp/brx_mcp/voices.py`); the walkthrough's second step plays the first spawn take so the voice is confirmed by ear before
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
