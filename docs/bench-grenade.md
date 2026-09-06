# Grenade IR bench (run sheet)

The deferred "grenade + emitter side by side" session (FOLLOWUPS star item, B12, G6, G9). Six timed
steps, about **25 minutes hands-on**, one gun, one grenade, the rig. Tool: `mcp/tools/grenade_bench.py`
(every phase is announced with its length; nothing waits on you, so read the phase text before it starts).

> ### ✅ Run 2026-09-04 (morning) — results
> Steps 1, 2 (partly), 3 and 4 answered with `native_capture.py` + `ir-emit` one-liners + the MCP tools; the
> scripted `respawn`/`hill` steps were not needed. Full write-up: `experiment-log.md` 2026-09-04
> "THE RESPAWN STATION IS ONE IR WORD". Short form: Respawn beacon / button / boot words captured (all
> 25-bit, proto 15); emitter arms + revives a native-game gun with the grenade out of the building (4/4,
> team-gated); hosted games ignore every station word (→ FOLLOWUPS B23); passthrough row works.
> **Still to run:** step 0 (BLE scan), step 1's Hill/Assault/CTF/Frag captures, step 5 (hill replay), and a
> receiver-on-the-HEADSET capture for the three unexplained emissions (death echo, self-hits after the
> button word, dead-trigger request bursts).

## What it answers

| # | Question | Decides |
|---|---|---|
| 0 | Does the grenade emit anything over Bluetooth? | RF vs IR-only. Everything observed so far is IR; nobody has scanned. |
| 1 | What does each grenade mode actually put on the air, receiver only, no gun? | The raw word for every mode and for the button press, the frame length (25-bit shot word or a longer accessory word), and the beacon period. Never done: the receiver has only ever seen the gun's `$GREN` word. |
| 2 | Does the beacon stop in a closed box, and does a gun's `$HIR` echo match the receiver's word? | Box = light blocked, radio not: quiet in the box means IR-only. The echo cross-check pins the replay word. |
| 3 | Does a **spawned** gun in one of our games still surface grenade beacons if we give it a `$SIR` row for protocol 15? | Whether MC games can read hill/respawn state at all (exp-log #38 said to build this row). |
| 4 | Can a **station-armed** dead gun be revived, and by what: grenade button, headset-front + trigger, our replayed beacon, host `$SPAWN`? | Respawn stations (B12). The 448-word brute force fired at a gun that was never armed; this is the missing half. |
| 5 | Does our emitter's Hill word make the gun react like the real grenade? | Whether the Utility Box can impersonate a hill, extraction site, or bomb site. |

## Setup (5 min)

1. **Power-cycle the gun AND its headset** (screamer rule). Use `Tactix-9498` (`DF:F5:DA:08:94:98`), last
   bench's victim. If it will not connect, `python.exe -m brx_mcp scan` and pick another.
2. **Rig:** receiver board on **COM7**, emitter on **COM8** (both enumerated 2026-09-04). Emitter LED
   pointed at a headset dome from **no more than 3 ft** (it reaches 6/6 at 3 ft, ceiling 8-9 ft).
   Receiver next to the headset, facing where the grenade will be.
3. **Grenade** charged and set to **RESPAWN (yellow)** before you start:
   off, on, wait for green; hold the top button about 4 s until the long beep; keep holding while it
   cycles colours; release on **yellow**; LED goes **white** = locked. Power-cycle it: the boot flash
   should be yellow for about 1 s. Leave it **neutral** (do not shoot it yet).
4. A **cardboard box with a lid** within reach.
5. A shell in WSL:

```bash
PY=/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe
cd /home/tony/gitrepos/battlecompany/mcp/tools
GUN=DF:F5:DA:08:94:98
```

## Steps

### 0. RF check (2 min, no gun)

```bash
$PY grenade_bench.py rf
```

Two BLE scans, grenade off then on, and it prints the difference. Follow the two prompts.
**Expect:** nothing new. Anything new is a finding: re-run once to make sure it is not a late gun.

### 1. Listen with the receiver only (5 min, no gun, no BLE)

The receiver alone, pointed at the grenade from about 1 ft. One capture per mode so the file name
says what it holds. Each writes `~/.brx-mcp/ir-captures/<time>-<label>.log` and prints every decoded
word as `WORD ... proto= player= team= mag= crit= sub= parity=`; a word longer than 25 bits is printed
raw, which is a finding, not an error.

```bash
$PY native_capture.py respawn-neutral COM7 30     # RESPAWN, untouched: the passive beacon
$PY native_capture.py respawn-button  COM7 30     # RESPAWN: press the button once at ~5 s, again at ~15 s
$PY native_capture.py hill-neutral    COM7 30     # set HILL (blue), untouched
$PY native_capture.py hill-button     COM7 30     # HILL: press the button at ~5 s and ~15 s
```

Then, only if a second gun is handy to shoot with (any native game on it, no BLE), one capture each
where you **shoot the grenade at ~10 s**, receiver still on the grenade, gun off to the side so its
own shot is not what the receiver sees:

```bash
$PY native_capture.py assault-shot COM7 30        # set ASSAULT (green)
$PY native_capture.py ctf-shot     COM7 30        # set CTF (white)
$PY native_capture.py frag-button  COM7 30        # set FRAG (red), press the button at ~10 s
```

**Expect:** Respawn beacons as `proto=15 team=2 mag=6` about every 2.5 s, Hill as `mag=8` about every
5 s, 52 edges each. Anything else is new: a button-press word, a longer frame, a claim acknowledgement
from Assault or CTF. If a mode shows **nothing at all** on the receiver but the gun reacts to it in
step 2, that is the RF question answered the other way, so say so.

Reset the grenade to **RESPAWN (yellow)** and power-cycle it before step 2.

### 2. Bare watch + box test (2 min)

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

### 3. Passthrough watch, gun spawned in a game (1.5 min)

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

### 4. Respawn station (5 min, the big one)

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

### 5. Hill impersonation (3 min)

Set the grenade to **HILL (blue)**: same setup procedure, release on blue, power-cycle, confirm the
blue boot flash. Grenade neutral, emitter at a dome.

```bash
$PY grenade_bench.py hill $GUN COM8 game
```

1. **REAL HILL (25 s):** shoot the grenade once, hold it facing the headset. Chime? "control point
   captured"? ticking? Fire 3 shots on the call: faster than normal?
2. **SILENCE (10 s):** box the grenade, fire 3 shots at the normal rate.
3. **REPLAY (25 s):** our emitter sends the Hill word every 4 s. Same reaction as phase 1?
4. **ENEMY HILL (12 s):** the Hill word owned by team 2. Different sound?

**If phase 1 got no reaction at all**, our game config does not react to a hill, and the replay says
nothing. Repeat in a **native** game: start a manual game on the gun, no BLE, and run

```bash
$PY -m brx_mcp ir-emit 1111000000010000100000010 COM8 6
```

### 6. Optional: Assault and CTF on the gun stream (3 min)

Grenade in **ASSAULT (green)**, then again in **CTF (white)**:

```bash
$PY grenade_bench.py watch $GUN 30 bare COM7
```

Shoot the grenade at about 10 s with a second gun, or re-run in `passthru` and shoot it with this one.
**Expect:** nothing on the gun stream (they do not beacon). Skip this if step 1's Assault and CTF
captures already showed what they emit on a shot.

## Afterwards

Paste the terminal output and your notes here in chat. I append the session to
`docs/experiment-log.md`, update `docs/reference/grenade.md`, and close or re-word B12, G6, G9 and the
star item in `docs/FOLLOWUPS.md`.

## Replay words (for `ir-emit` one-liners)

```
1111000000010000011000001  respawn beacon, owner team1/blue
1111000000100000011000001  respawn beacon, owner team2
1111000000000000011000010  respawn beacon, owner team0
1111000000010000100000010  hill beacon, owner team1/blue
1111000000100000100000010  hill beacon, owner team2
0000101010101100100000001  kill shot (team2, mag 200)
```

Passthrough rows (after the bench `$SIR` table, friendly fire ON so a same-team beacon is not discarded):
`$SIR,15,0,,24,0,0,1,,*` and the same for subtypes 1, 2, 3. fn 24 registers a `$HIR` and moves no pool
(unknowns.md U11').
