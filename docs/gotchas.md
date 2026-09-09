# Gotchas — the field lore

**Everything that will waste an hour if you don't know it.** Organised **by symptom**, because when one
of these bites you, you search for *what you're seeing* — not for what you should have known.

Each entry: **what it looks like → what it actually is → what to do.** Nearly all of these were learned
by losing a session to them.

---


## Before a bench session (pre-flight)

Four checks, in order, every time. Two of them would each have saved hours in the sessions that
produced them (carried in from the 2026-09-03 session sheet when it was archived).

1. **Kill stale `brx_mcp` processes** (see below: a forgotten server silently owns a gun).
2. **Power-cycle the gun AND the headset**, and use guns that have been powered off (screamer rule).
3. **Check the emitter reaches** at the distance you will work at:
   `$PY mcp/tools/range_step.py <addr> "range check" COM8 6 COM7` (`$PY` = the Windows venv python;
   on the Mac, native `python3` and the Mac's serial device paths). Then `$PY mcp/tools/loopback.py
   COM8 COM7 12` to confirm both boards are ALIVE (it is not a decode benchmark, the receiver
   fragments frames).
4. **Never conclude "deaf" without reading the pools.** A dead gun and a `$SIR`-less gun are
   indistinguishable through `$HIR`. Tony: *"it isn't going to register a hit while dead. thats dead
   not deaf."* The tools check this themselves; a hand-run probe must too.

And never end a run on a bare `$CLEAR` (it wipes the `$SIR` table, under Sending commands below).


**🔴 A STALE `brx_mcp` SERVER SILENTLY OWNS A GUN — it looks like broken hardware (2026-09-02)**
**Symptom:** a powered-on tagger never appears in `scan` (three scans, one 25 s), and the moment you
power-cycle it the gun announces **"phone connected"** with no phone anywhere near it.

**Cause:** MCP server processes from previous sessions were still running — two from 2026-08-26, two
from 2026-08-30, six days and three days old. One of them reconnects to the gun the instant it
advertises. **A connected gun stops advertising**, so it is invisible to every scan while being held.

**Check:**

```powershell
Get-CimInstance Win32_Process -Filter "Name like '%python%'" |
  Where-Object { $_.CommandLine -like '*brx_mcp*' } |
  Select-Object ProcessId, CreationDate
```

Anything whose `CreationDate` is not from this session is stale. Kill it (`Stop-Process -Id <pid>
-Force`); the tagger says **"phone disconnected"** and starts advertising again immediately. Confirmed
2026-09-02: killing four stale servers made a gun that had been invisible all evening appear on the
next scan.

⚠️ `list_connections` on the server you happen to be attached to is **NOT** a sufficient check — it
reported `connected: false` while a *different* process held the gun. You can only see inside one
process; enumerate them at the OS level.

**Why this matters beyond a missing scan result:** a second process holding a gun can arm, configure
or spawn it underneath you. That WAS a candidate for **F11** (F11 is now solved: `$CLEAR` wipes the `$SIR` table). It is still a real trap ("a gun arms, spawns and looks
healthy while registering no hits") and it fits Tony's instinct at the time — *"you must be doing
SOMETHING which puts it in this cant get hit state."* Something was. It just was not this session.

**Rule: enumerate and kill stale `brx_mcp` processes BEFORE any bench session.** A gun held by a
process you forgot about is indistinguishable from a broken gun, and it will cost you an afternoon.

---

## Before you start

**"Only 2 of 3 guns joined the game."**
A gun whose **headset is off, unpaired or flat silently refuses to join** — no error, no voice line.
This is the single most common cause of a wasted muster. **A headset slow-blinks RAINBOW when
disconnected** — eyeball every headset before arming (`field-process.md` §Muster step 0). Note a settled
headset shows team colour **pre-game only** and goes **dark during play** — dark in a game is normal.

**"The gun advertises but won't connect" / "connects then immediately drops."**
A **"screamer"** — the documented failure of a tagger left powered all day. **POWER-REST the guns
between sessions.** Never bench-marathon a match-day fleet. Also: BC firmware won't re-pair below a
battery threshold, so keep them charged.

**"The gun is called Tactix2 again."**
**Opening the Callsign app wipes an enrolled gun's `$NAME`.** Never open it on our guns. Re-stamp with
`python -m brx_mcp rename`.

**"The gun says `phone connected` so the app must be fine."**
Two different signals. The tagger saying **"phone connected"** means a central attached; the app saying
**"connection established"** means its ritual succeeded, and only the second is a health check.
**You cannot create a game in Callsign unless its top-right icon is green and reads "connected"**; that
icon is both the gate and the source of truth, the voice lines are not. This is the whole explanation
for the "app is flaky then suddenly works" pattern: nothing was intermittent, the headset was linked
sometimes and not others.

**Hardware facts worth knowing before a session.** Both taggers run fw **`v4.32` / `devhost.03`**
(developer images, not retail; Callsign's "supported until v2.01e" warning is soft, games run). The
MCU is a **Teensy**: the micro-USB "Programing Port" enumerates as `USB Serial` / `Teensyduino`; console
commands are **`QUERY`** (read-only dump of versions, serial, voltages, flags) and **`SETUP`** (factory
provisioning, asks for the headset SN); everything else is `ERROR`. **Firmware cannot be backed up**
(HalfKay is write-only; the sound storage IS writable over USB, that is a different thing). Settings
backups live in `~/.brx-mcp/device-backups/`, out of the repo.


---

## Connecting

**"Connection failed."**
Establishing a BLE link succeeds roughly **1 attempt in 3** — the official app behaves the same. `ble.py`
retries 5×, and that retry *is* the fix. **This is not a broken stack**; hours were once lost to that
theory.

**"Reconnect right after a disconnect comes up dead (NUS TX char missing)."**
After a **gun-initiated** `$DISCONNECT`, back off **≥5 s** before reconnecting.

**"The board vanished from the bus entirely."**
A **charge-only USB-C cable**. The board powers up and looks alive while being invisible to the PC. Use
a cable you have *seen* enumerate.

**"The port is there but nothing answers."**
You're on the ESP32-S3's **native USB** port (`VID_303A`), which enumerates from ROM whether or not the
sketch uses it — so it looks healthy while `Serial` is actually bound to UART0. **Use the UART port**
(`CH343`, `VID_1A86`), or set *USB CDC On Boot → Enabled*.

**`PermissionError(13, 'Access is denied.')` on a COM port.**
Windows serial ports are **exclusive**. **Close the Arduino Serial Monitor.**

**`UnicodeEncodeError: 'charmap' codec can't encode ...` from a bench script.**
The **Windows console is cp1252**. Any non-ASCII character in a `print()` — a prime, an arrow, an
em-dash, a box-drawing glyph — **kills the script mid-run**, usually after it has already reconfigured a
gun. **Keep bench-script output ASCII-only.** (`mcp/tools/weapon_range.py` says so in its docstring;
the lesson does not travel unless you look.)

**🔴 ENVIRONMENT VARIABLES DO NOT CROSS THE WSL -> WINDOWS BOUNDARY (2026-09-03)**
`FOO=1 /mnt/c/.../python.exe script.py` arrives with `os.environ["FOO"]` **unset**. There is no error;
the flag silently does nothing.

This faked a hardware result within 24 hours of being written: a `PAINT_HZ=25` repaint test was
judged "pretty good" when the option had never applied and a single frame was actually being sent.
**Use `sys.argv`, not env vars, for anything a Windows-side bench tool reads.** And the general rule:
**if a knob does not visibly change behaviour, check it is being READ before believing the result.**

**"That IR function does nothing" / "my emitter fired but the victim never reacted."**
**Check the SHOOTER TEAM in the IR word before believing any negative result.** The receiver gates IR
by the function's polarity and **discards the frame outright when the team is wrong — emitting no
`$HIR` at all**. A wrongly-teamed shot is therefore *indistinguishable* from a dead emitter, a
misaimed LED, or a function that genuinely does nothing.

| testing | fire from |
|---|---|
| damage, armour-pierce | an **enemy** team |
| heal, shield, armour, respawn, any grant | the victim's **own** team |
| an unknown function | **both**, and compare — that is how you learn its polarity |

This voided several previously "confirmed" negatives (fn 24-27, and the whole stun hunt across
fn 3/8/23-28/35), all of which had been fired from an enemy team only. **Every IR experiment must state its shooter team, its firing range, the `$HIR` tok1 sensor, and
whether the victim's pools had headroom** — a grant into a full pool clamps and looks inert, and a
drain against an empty one does too. **Carry a known-good control at both ends** — without a control you cannot
tell "rejected" from "broken".

**A same-length edit written in the same second leaves Python running STALE BYTECODE.**
CPython decides a `__pycache__/*.pyc` is current by the source's **mtime (1-second granularity) and
size**. Flip `4.0` to `5.0` and back inside one second and both are unchanged, so the interpreter
keeps the *first* compile. Seen 2026-09-07: a test was deliberately broken to prove it could fail,
reverted, and then kept failing against a constant that read correctly on disk and showed no
`git diff`. If a test's verdict disagrees with the file in front of you,
`find . -name __pycache__ -type d -exec rm -rf {} +` before believing either. Same trap when a probe
script edits a module and re-imports it in the same run: writing a byte-length-different value (or
`touch`ing the file afterwards) is enough to dodge it.

**A purge of `main` frees nothing while any other ref still holds the blobs.**
`git filter-repo` rewrites every ref it can see, but the objects only go away once *nothing* points at
them. Two things kept the 2026-09-07 purge at 0 bytes reclaimed until they were dealt with, and neither
announced itself: (1) a **dead remote branch** (`origin/bench/…`) still carried the PDF and all ten old
apks, and the next `git fetch` pulled every one of them straight back into the local object store;
(2) the **release tag** `app-v0.1.6`, created minutes earlier by `gh release create`, pointed at a
*pre-purge* commit and pinned that whole history. Translate such a tag through
`.git/filter-repo/commit-map` (old sha → new sha), force it, delete and re-push it; the GitHub Release
and its uploaded assets survive that, they hang off the release, not the tag. Only then do
`git remote prune`, `git reflog expire --expire=now --all` and `git gc --prune=now` shrink anything.
Symptom to watch for: `git count-objects -vH` still large while `git rev-list --objects --all` lists
blobs you thought you purged. Ask **which ref reaches them**:
`for r in $(git for-each-ref --format='%(refname)'); do git log --oneline "$r" -- <path>; done`.

**`git filter-repo --replace-text` reports success but silently SKIPS binary blobs.**
A scrub that greps clean afterwards in text and commit messages can still leave the value inside
`.btsnoop` captures, images or any other binary — `--replace-text` does not touch them. Reaching those
needs a **`--blob-callback`** doing raw byte replacement. Verified 2026-08-27: after a clean-looking
pass, both `protocol/captures/raw/2026-08-25-*.btsnoop` still carried the gun's advertised BLE name.
Two further traps in the same area: **commit messages** need `--replace-message` (a blob filter never
sees them), and any replacement inside a **btsnoop** must be **byte-length-neutral** — the format
stores per-packet length fields, so a longer string desynchronises every following packet and the
capture stops parsing. **Closed in the working tree 2026-09-07:** both files were patched in place with
an equal-length alias (5 chars for 5), byte count unchanged, and both still decode identically under
`python -m brx_mcp.btsnoop`. The blobs in git *history* are untouched, so a history purge still needs
the `--blob-callback` route.

**"`$QUERY` says the config changed" — check the reply LENGTH before believing it.**
`$QUERY,*` replies are **variable-length across reads for identical state**: long replies span several
BLE notification chunks and a fixed capture window does not always catch them all. Observed 15 / 29 /
33 tokens for the same unchanged gun. **Never diff `$QUERY` as a raw string** — parse fields, and
require two identical consecutive reads before treating a sample as valid. A raw-string diff
manufactures false positives and will happily "detect" an effect that is not there.

**"I covered the emitter in black plastic and it still fires."**
**Most black plastic is IR-TRANSPARENT at 980 nm.** Black ABS, PLA and many black caps block visible
light and pass near-IR almost unchanged, so a 3D-printed shroud or a black cover can look like it is
working and do nothing at all. **Test any material by firing through it at the receiver before
trusting it.** The same applies in reverse when building a snoot: the inside must be genuinely
non-reflective (flocking, matte black paint, felt) or the tube becomes a light pipe and widens the
very skirt you were trying to kill. And note the **headset has its own front IR emitter** (melee
swings, respawn-station requests), so a muzzle attachment never covers the whole system.

**A timed sweep + a human observer = data bound to the wrong cell.**
If an operator is calling out what they see while the script advances on a **timer**, their replies
arrive asynchronously and an observation gets logged against the *next* frame, not the one that caused
it. This produced two contradictory `$GLED` tables and four failed predictions on 2026-08-30, which
were then wrongly blamed on the LEDs "animating". **Never advance an operator-in-the-loop sweep on a
timer.** Send one frame, wait for the call, then send the next. If a timer is unavoidable, have the
script announce a cell id the operator repeats back.

**A sweep of a field that can NO-OP reads differently depending on what you do between rows.**
`$GLED` token 4 is an *apply gate*: some values apply the frame's colour tokens, and **1-4 do nothing
at all**, leaving whatever the previous row lit. Four sweeps of that one token disagreed with each
other on identical hardware for exactly this reason — a sweep that blanks between rows reports
"nothing is lit", one that does not reports "everything is lit". Worse, a sweep started from **dark**
cannot tell "applied a colour" apart from "did nothing"; the discriminator is to start from a known
**lit** state and send a *different* colour, so apply / no-op / off are three visibly distinct
outcomes. Blank between rows, verify the pre-state before every trial, and never let a sweep print a
verdict for a row whose setup state was not confirmed.

**A correct frame can carry a wrong reason, and the reason is what gets reused.**
`$GLED,,,,5,,,*` blanks a gun and is the right night-mode frame; but "t4 = 5 is the off value" was
wrong — it blanks because its **colour tokens are empty** and t4=5 *applies* them. The frame worked
throughout, so nothing failed to warn us, while the false rule ("5 means off") was the part that would
have been generalised into the next design. **When a frame is verified, verify the sentence explaining
it separately** — they are two different claims and only one of them was tested.

**Never write a headset sticker id into the repo.**
The stickers on our headsets are the **headset serials/PINs**, not just friendly names. In committed
docs, code and logs use the PIN-free `Tactix-XXXX` (BLE name = last MAC bytes) or "gun 1/2"; the
sticker labels belong in conversation only. This leaked 42 times across 8 files before it was caught
in review, while `webapp/mc/README.md` simultaneously promised "real sticker ids never enter the
repo" -- grep for the pattern before publishing anything.

**Address formats.** macOS gives BLE **UUIDs**, Windows/BlueZ give **MACs**. **Never pattern-match on
address format** — a bug exactly like that shipped once.

---

## Sending commands

**"The gun went live with no ammunition."**
**`$AMMO` must follow `$SPAWN`.** A magazine loads into a *just-spawned* gun; there is nothing to load
into otherwise.

**"A weapon pickup silently gave the player a full load."**
A bare **`$WEAP` re-push RESETS mag/reserve to the frame's baked-in values.** Every pickup/powerup must
**re-send `$AMMO`** with the intended counts.

**"The trigger just chirps."**
**`$BMAP` is mandatory** — without it the firmware reports the trigger as *disabled*.

**"I set health and nothing happened."**
`$LIFE` and `$BUMP` are **additive grants clamped at max**, not absolute sets. And **writes don't
self-emit `$HP`** — the new value appears on the next hit or HUD refresh.

**"`$SPAWN` cleared the effect, so I'll use it as a reset."**
It also **restores health**. It is not a clean "clear one thing" tool.

**🔴 `$CLEAR` WIPES THE `$SIR` TABLE, AND A GUN WITH NO `$SIR` ROWS IGNORES EVERY HIT (2026-09-02)**
**Symptom:** the gun arms, spawns, reports full pools, answers `$QUERY` normally, is alive and in
game, and **registers nothing**. No `$HIR`, no headset flash, pools never move, every dome AND the
gun body silent. It looks exactly like a dead headset or a broken sensor.

**Cause:** `$CLEAR` clears the `$SIR` matrix, and unmatched `$SIR` cells are silently ignored. With no
rows, every incoming hit matches nothing and is discarded above the sensor layer.

**Cure:** re-send the `$SIR` rows. That alone restores it (4/4 immediately). `$START`, `$GSET`,
`$PSET`, `$TID` and any number of `$SPAWN`s do NOT.

**Rule: never send `$CLEAR` without sending `$SIR` behind it.** The arm sequence already does this;
the danger is a PARTIAL bundle, or a bare `$CLEAR` sent by a probe or a panic sequence mid-session.

⚠️ **Table size is not the issue — absence is.** A one-row table and the full ten-row table both
registered 24/24 in an interleaved A/B. Do not "fix" this by making tables longer.

⚠️ **When a tagger seems deaf, check that it is ALIVE first.** A dead gun and a `$SIR`-less gun are
indistinguishable through `$HIR`, and a whole session was lost to reading corpses as deafness. Read
`$LCD`/`$QUERY` pools before concluding anything.

Bench-proven deterministic 5/5, and independent of the `$CLEAR`→`$SPAWN` gap (0.05 s to 1.0 s).
Repro: `mcp/tools/clear_spawn_repro.py`.

**🔴 "THE EMITTER IS FIRING AND NOTHING REGISTERS" — check these IN THIS ORDER (2026-09-07)**
This cost most of an evening and produced four confident wrong diagnoses (aim, friendly fire, outdoor mode, the
emitter itself). Each step below DISCRIMINATES; guessing between them does not.

1. **Read registration as `$HIR`, never as damage and never by ear.** No `$HIR` = the word never landed
   (emitter, aim, or polarity). `$HIR` with unchanged `$HP` = it landed and the row did nothing. Different
   faults. Drain `mcp__brx__get_events` after each shot; it is two seconds per shot and it keeps you honest.
2. **Is the gun ALIVE and SPAWNED?** A dead gun accepts no IR at all. Armed-but-never-spawned is a state nobody
   has characterised. Check `$LCD` pools, do not assume.
3. **Does the word physically leave?** Capture it on the receiver board (`ir-capture COM7`) while the emitter
   fires. If the receiver decodes it with `parity=ok`, emission is PROVEN and everything downstream is
   registration, not transmission. ⚠ `SENT bits=25` from the emitter proves the CALL, not the effect.
4. **Is something else holding the port or the link?** The stage owns `--ir COM8` exclusively; a second
   `ir-emit` gets `PermissionError(13)`. ⚠ And never redirect the emit command's output to `/dev/null` — that
   is how an error becomes an invisible "shot fired" (done twice in one evening).
5. **Team polarity.** With `$GSET` t1 = 0 (friendly fire OFF) a same-team shot is discarded SILENTLY, with no
   `$HIR` — which presents exactly as "the emitter is broken". The stage's own IR buttons pick an enemy tid for
   you; a hand-rolled word does not. **This is the one that got us: every shot was forced to `team 0`.**
6. ⚠ **F49 is OPEN and it contradicts step 5.** On a `$TID,1` gun with FF off, a team-1 (SAME team) shot
   REGISTERED and a team-0 (enemy) shot did NOT, twice each — while the same team-0 word fired from
   `tools/ff_ab.py` registered 40/40. Something other than the team field is involved. Until that is explained,
   do not conclude anything from polarity alone; use `tools/ff_ab.py`, which arms and fires a known-good
   combination and prints a verdict.
Ruled OUT as causes, measured, do not re-chase: friendly fire on/off (12/12 either way), outdoor vs indoor mode
(6/6 either way), emitter repeat count (1 is fine), and the `$SIR` sound token (empty or filled, irrelevant to
whether a hit lands).

---

**🟠 FOUR SESSIONS SHARE ONE BENCH: two processes on a gun is CONTENTION, not staleness (2026-09-07)**
**Symptom:** your BLE connects fail, the gun answers nothing, and it looks exactly like a tagger that has
slept or died. Or `ir-emit` returns `PermissionError(13, 'Access is denied.')` on COM8.

**Cause:** another session holds it. Windows serial ports are exclusive, and a second BLE session to the same
gun simply will not connect. On 2026-09-07 this produced a wrong diagnosis ("the tagger has slept") and an
operator was asked to power-cycle a gun that was fine the whole time — `$VOLTS` heartbeats ran unbroken
throughout. The other session then read two `brx_mcp stage` processes as stale and killed them, which is the
mirror image of the same mistake.

**Rule: say in the session channel that you are taking the gun and COM8, and say again when you hand back.**

**And two traps that come with a SHARED WORKING TREE, both hit on 2026-09-07:**
- ⚠ **`git commit --only <path>` does NOT mean "only my changes to that file".** It means "that file, WHOLE,
  including anyone else's in-flight hunks". Tonight it swept one lane's uncommitted A16.3 LED work into another
  lane's commit about hit audio (`e5539de`), and earlier the reverse. Nothing is lost, but the commit message
  stops describing the contents — which is exactly what someone relies on months later. **Before committing a
  shared file, `git diff <path>` and read it**: if there are hunks you did not write, either wait, or say so in
  your commit message and name the symbols so a later `git log -S` lands somewhere that explains itself.
- ⚠ **A one-character revert can leave Python running the OLD bytecode.** `.pyc` invalidation is
  (source mtime, source SIZE). Flipping `BURST_FLASHES = 3` to `4` to prove a guard fires, then copying
  the good file back within the same second, changes NEITHER: same size, same mtime second, so the
  interpreter keeps serving the sabotaged `.pyc` from a source that greps correctly. It cost half an
  hour on 2026-09-09 — the file said 3, `import` said 4, and `git diff` was empty. **The dangerous
  direction is the other one**: the same trap can make a test PASS against code you already reverted.
  After any copy-back proof, `find . -name __pycache__ -type d -exec rm -rf {} +` before believing the
  result, or check `python -c "import m; print(m.THING)"` rather than grepping the file.
- ⚠ **NEVER `git stash` in this tree, not even scoped to one path.** It reverts whatever is uncommitted in that
  path — including your own in-flight work and any other lane's. Done twice on 2026-09-07: once by a subagent
  (four files of another agent's half-finished migration went back to HEAD) and once by the main session, which
  stashed the very fix it was trying to test and then read the resulting red suite as the test working. To prove
  a test fails without its fix: **copy the file to the scratchpad, edit the original, run, copy back.** No stash,
  no `checkout`, no `restore`, no `reset`. Read-only git only, and put that line in every subagent brief.
- ⚠ **A red suite here is not evidence of a failure until it reproduces.** A full run reported 2 failures and an
  immediate re-run reported 0, with no change from the runner — another lane's edits landed mid-run. Re-run
  before chasing anything, or you will debug a ghost.

Two processes on the SAME gun and port is the tell that someone is using it — the FOLLOWUPS preflight line
about killing stale `brx_mcp` processes predates four sessions sharing one machine and is now actively
misleading. If the stage is up it owns COM8 exclusively; emit THROUGH it
(`POST /api/do {"action":"ir","kind":"shot"}`) rather than opening the port from a second shell.

---

**🔴 `$HLED,,6` IN PLAY SILENTLY KILLS THE NATIVE DEATH FLASH (2026-09-07)**
**Symptom:** downed players' headsets are dark in our games, while native play flashes them brightly. It looks
like "hosted games don't get the out-blink" — that reading was wrong and cost a whole design.

**Cause:** `$HLED,,6,,,,,*` (effect 6, the blank) **disables the firmware's own death-flash loop for the rest of
that life.** The same gun killed after a *colour* write flashes normally. Effect 6 was our `in_play: dark` rest
frame, so every hosted game was switching its own death flash off, once per life, and we then built an `$LED`
pulser to replace what we had just disabled.

**Rule:** never send `$HLED,,6` while a match is running. **Dark on the headset is `$HLED,9,0,,,10,,*`** (colour
9). Effect 6 is a teardown frame only. If something did blank it, `$HLOOP,2,750,*` restores the flash on a dead
gun at native drive or better; `$HLOOP,0,0,*` stops it, and `$SPAWN` clears it by itself.

**The native HIT flash is not affected by any of this** — it fires from the firmware's own IR path even on a
blanked headset (2026-09-02). Only the death loop is fragile.

---

**🟠 THE GREEN DEATH BLINK STICKS ON if you respawn within ~2 s of the kill (2026-09-02)**
**Symptom:** a player's headset keeps flashing the out/respawning green after they are back. The gun
is fine — alive, full pools, registering hits normally (8/8 measured while it was blinking). Only the
presentation is wrong, so the player looks dead to everyone while playing normally.

**Cause:** the headset is a second device behind a relay. `$SPAWN` has to reach the gun, be relayed,
then be received, processed and executed by the headset. Sent while the death sequence is still
running there, it is lost; the gun's own state updates regardless.

**Threshold, measured:** 1.0 s and 2.0 s stick; 2.5 s, 3.0 s and 6.0 s are clean. **Leave ≥ 3 s
between a death and a respawn.** `GameConfig.respawn_s` defaults to 15 s so normal matches are safe —
this bites fast respawns and bench tooling.

**Generalises:** any command that must be executed by the tagger AND the headset (`$SPAWN`, `$HLOOP`,
`$HLED`) needs a settling gap. Note the gun QUEUES commands and drains them serially, so an echo back
proves the GUN received it, not that the headset executed it.

---

## Capturing IR

**"The IR LED isn't lighting — I checked with my phone camera."**
**A phone camera cannot see a ~5 mA IR LED.** From 3V3 through 100 Ω with a 50% carrier the average is a
few mA; a TV remote runs 100–500 mA. **Both cameras showing nothing is consistent with a perfectly
working circuit.** Use the VS1838B to judge, never a camera.

**"Frames arrive as fragments — 16, 17, 20, 21 bits, all prefixes of the real word."**
The capture sketch's per-frame **`RAW` print takes ~15–20 ms at 115200**, long enough for the next frame
to start mid-print. **Send `r` to turn the RAW dump OFF for any capture that matters.** This silently
cost four captures before it was found. (`IDLE_GAP_US` is now 30 ms.)

⚠️ **RETRACTED 2026-09-02: this is NOT fixed.** `IDLE_GAP_US` 30 ms + RAW off did not cure it -- our emitter decoded whole only 4/20 and a REAL BRX GUN only 3/44, with every frame arriving as a full 52 edges. See `FOLLOWUPS.md` **F12**. ⚠️ And that retraction is itself superseded (2026-09-03): `native_capture.py` re-joins split frames (an odd-length fragment lost a space, an even-length one lost a mark; parity picks), so captures are UNBLOCKED. The board still fragments; the host fixes it.

**"The receiver drops out mid-burst at close range."**
**VS1838B AGC saturates point-blank.** For loopback work, **attenuate** — aim the emitter away, or add
distance. Counter-intuitive but firm: a gun at 1 m decodes cleanly where an LED at 5 cm does not.

**"My armor is draining and I keep dying while testing."**
**You are shooting yourself.** Firing toward a bench receiver reflects your own IR back onto your own
headset. It drains armor, kills you mid-window, and leaves the gun dead for the next round. **Never fire
toward the capture rig** — for audio/pool tests, fire away, or don't fire at all.

**"A TV remote decoded as a BRX frame."**
The `>1500 µs` sync gate is **not BRX-unique** — Sony SIRC's 2390 µs header passes it. BRX sync is
~1990 µs. For a station in a room with TVs, bound the sync and require 25 bits **plus** the parity rule.

---
---

## Reading results

**"Silence means nothing changed."**
No. **`$ALCD` only streams on ammo events** — if nobody fires, you learn nothing. A read-probe that
*forces* a frame may also **mutate what you're measuring** (`$AMMO` re-push resets the magazine).

**"Zero hits, so the effect didn't register."**
Check the gun is **alive first** — a **dead gun accepts NO IR at all** (448-word brute force). Silence
from a corpse is not evidence about your word.

**"Same word, but the player id doubled and so did the damage."**
A **one-bit misalignment**. If two decodes differ by exactly 2×, you are reading the same frame at two
offsets — usually from stitching fragments. Fix the capture, don't trust the decode.

---
**🔴 `$HIR` NEVER REACHES BLE IN A GUN'S OWN NATIVE GAME (2026-09-02)**
A gun running its **native** game registers hits, flashes its headset and takes damage while sending
**nothing at all** over Bluetooth. Measured 0/11 while the operator watched it get hit every time.

**So BLE silence has never meant "not hit".** Any "deaf tagger" conclusion drawn from an absent
`$HIR` on a gun that is not in OUR game state is measuring our blindness, not the gun. This is
exactly how hours were lost. Score a native game BY EYE (headset flash) or with the camera.

**🟠 A LIT LED WASHES ITS NEIGHBOURS: luminance cannot tell lit from dark (2026-09-02)**
A lit LED bathes the whole housing in its colour, so a **dark** neighbour's camera ROI fills with
reflected light. Painting armour 2-of-3 measured the dark LED3 at 170 against a 134 dark baseline,
and BOTH a flat threshold and a nearest-reference classifier called it lit. Cropping the strip and
LOOKING settled it in seconds -- LED3 was visibly dark, merely washed.

**Discriminate by SATURATED-PIXEL FRACTION, not luminance.** A lit LED core blows out to white
(255/254/255); reflected wash does not (that LED3 peaked at G=203). The two populations then do not
overlap: lit 0.108-0.509, dark 0.000-0.025. Cost three attempts and two retractions.

---

## Interpreting — the discipline that actually mattered

**A control that is merely *present* is not a control.** It has to be **checked before the result is
read**. A run whose baseline was empty produced sixteen clean-looking negatives once, and a "verdict"
line that was pure fiction.

**One well-controlled-looking run is not a result.** Two separate findings survived a careful run each
and died on the second. Everything that has held was measured **3× with alternating conditions**, or
came from a human's senses.

**A host-visible field that correlates with a state is not evidence of that state.** `$ALCD` t2 hitting
0 looked exactly like a weapon disable, had a plausible source-derived mechanism, and was wrong. The
proxy was never tested against the behaviour it stood in for.

**Damage is a property of the (weapon, victim's `$SIR` table) PAIR — never of the weapon alone.**
`$HIR` tok5 is the **raw magnitude**; applied = magnitude × the row's function multiplier × (1 + `$GSET` t7/100) if crit (×1.5 only at the shipped t7=50; **fn 36 = floor(magnitude × 1.25) and fn 37 = magnitude × 2, confirmed 2026-09-02** — the ×1.25 truncates, so 7 lands as 8).
Anything that validates a weapon in isolation is blind to a whole class of bug.

**Close a question in EVERY file in the same commit, or it is not closed.** Two independent cold-read
handoff tests both scored this repo down for the same thing, and it was never a wrong fact — it was a
*right* fact that only landed in one or two places. When `$GLED` was solved on 2026-08-30 the answer went
into the protocol doc and the manual, while the **spec of record** (`docs/spec/modes.md`) still published
the disproven `mid,effect,optionA,optionB` field map, `unknowns.md` still listed it as unknown, two bench
plans still queued the closed test, and `gameconfig.py` still **shipped a frame built on the retracted
reading** — night mode was sending colour index 0, which is *red*, believing it meant "off". A stale
retraction is worse than an open question: an open question warns you, a stale answer recruits you.

**When you retract something, say what still stands.** A blanket "this was wrong" makes a reader discard
the good half too. The `$TID`-sets-a-default-colour half of the team-derived claim was always correct;
only "and `$GLED` cannot override it" was wrong.

**Your filter can lie.** A `$HIR` filter matching `,42,` reported zero hits on a run that had actually
killed the player, because the sweep varied the player id.

**A saturated camera core is a floor, not a measurement.** At the phone camera's minimum exposure both our
`$LED` flash and the native hit flash pinned the sensor to 255, so every core/mid/energy number was a sum of
clipped values and read "equal" while the wall reflection said the native flash was several times brighter.
Aim the camera at a dark WALL away from the LEDs (reflected light does not clip), or use an ND filter, before
ranking two lights (2026-09-04, `mcp/tools/led_flashcam.py`).

**Record `$HIR` tok1 (the sensor struck) and the firing distance beside every pool number.** Range and sensor
are both unstated conditions that surfaced after the fact; the unattended rig lands 20/20 on the gun body at
~40 cm and cannot produce a dome hit, and a Callsign capture shows different applied damage on sensor 0 than
on sensor 4 (F23). A dataset without tok1 and range cannot answer that question retrospectively (2026-08-27).

**Over CDP, push the config before the start.** Injecting `start` into a `kitted` engine spawns the state model
but does not re-arm a gun that lost its head (fresh app process, power cycle): the gun cannot shoot or reload
and it looks like a corrupt `$CLEAR`. Send `onMcMessage({kind:'config'})`, wait ~2.5 s for the paced head
write, then `start` (2026-09-04, `docs/wsl-cdp-phone-engine` memory + experiment-log 2026-09-04 S7.1).

---
---

## See also
`docs/FOLLOWUPS.md` (**"Needs Tony at the bench"** is the bench queue; one dated run sheet at a time) ·
`hardware/esp32-ir-bridge/README.md` (board identities and wiring) · `docs/field-process.md` (muster) ·
`docs/HANDOFF.md` (state as of the last session).
