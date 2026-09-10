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
> **Still to run:** step 0 (BLE scan), step 1's Assault/CTF/Frag captures, step 5 (hill replay), and a
> receiver-on-the-HEADSET capture for the three unexplained emissions (death echo, self-hits after the
> button word, dead-trigger request bursts).

> ### ✅ Run 2026-09-10 (early) — the HILL is decoded, and it changes what a hosted game can do
> **The beacon carries the owner.** Hill = `proto=15 team=<owner> mag=8` every ~5 s (respawn is `mag=6` at
> ~2.5 s), and **neutral is team 2**. Shooting a neutral hill claims it: a red gun fired
> `proto=0 player=5 team=0 mag=22` and the next ten beacons read `team=0`.
> **A hosted game CAN see it — with one row, plus an engine fix (F72: `engine.js` drops proto 15 today).**
> `$SIR,15,0,,24,0,0,1,,*` and beacons arrive as
> `$HIR,<sensor>,15,0,<owner>,8,0,0`, no pool change. That answers Q3 **yes** and explains B23: our compiled
> table ships no protocol-15 row, so the firmware discards every station word in silence.
> **🔴 And a hosted game is already exposed to the damage.** A hill also emits an ordinary `proto=0 mag=8`
> word, which our standard `$SIR,0,0,,1` row applies in full — it killed the operator in ~106 s with nothing
> in the event stream naming the cause (FOLLOWUPS **F69**).
> **Unsettled (2026-09-10):** whether charge is priced in MAGNITUDE or something weapon-specific — the
> discriminating trial is confounded, because the shotgun's `mag=70` IS its extra-headset payload (**F70/F76**,
> rung X below); and whether the `proto=0` damage word is continuous or conditional, which has never had a
> dual-instrument control (**rung C** below).

## Programme (rewritten 2026-09-10 after the hill sessions)

### ✅ Answered today — do not re-run

| | finding |
|---|---|
| **Beacon** | `proto=15 team=<owner> mag=8` every ~5 s. **Neutral = team 2.** Respawn is `mag=6` at ~2.5 s, boot `mag=56`. Magnitude is a fixed MODE id, **not** a charge level. **Recounted from the capture logs 2026-09-10** (an earlier "84 decodes, three values" here was both miscounted and wrong about the spread): across every session, unambiguous proto-15 decodes are **mag=8 x96** (hill), **mag=6 x63** (respawn), **53 x4 / 50 x3** (capture announcement), **56 x1** (boot, a whole word), plus two lone stitched decodes -- **55** and **2** -- that are probably stitch artefacts; the mag=2 one carries `player=42`, which no other beacon does. The MODE values are the ones with hundreds of repeats behind them |
| **Capture** | shoot it; **ANY weapon** (settled). Charge accumulates and **the attacker wins ties** — 1 AR took 9; 5 took 45; one shotgun shell (70) took 45. That the currency is MAGNITUDE is 🟠 only: ⚠ **The discriminating trial is CONFOUNDED:** the shotgun's `mag=70` is its `t12` **extraHeadsetDamage** (a `t1=2` weapon), so magnitude and weapon-block varied together and it cannot separate "magnitude is the currency" from "an extra-headset word captures out of proportion". ⚠ And both AR flips were at **exact equality** (9 v 9, 45 v 45), so what is measured is **the attacker wins ties**, not "the higher total owns the point". See F70/F76. |
| **Announcement** | **NOT a pair in the same burst — corrected 2026-09-10 evening, confirmed cleanly on BLE.** `mag=50` (new owner) arrives ~50 ms after the capturing shot; `mag=53` (state left) arrives ~5 s later, on the NEXT beacon cycle. A node must not wait for both — `mag=50` alone is the capture signal. **Very likely** why guns say "hill captured" — the pair is measured, the causal link to the callout is not |
| **Reading it in a hosted game** | `$SIR,15,0,,28` — **fn 28 registers with ZERO player feedback** (no sound, flash or vibration) + the `engine.js` fix (F72). Both now confirmed on a real beacon over BLE, not only the ESP32 rig |
| **Polarity** | fn 28 is enemy-only at `$GSET` t1=0; **t1=1 lifts the gate** and ownership arrives in `$HIR` token 4. **KotH wants FF on** |
| **Capture, end to end** | ✅ proven live: one AR round flipped a neutral hill, read over BLE, grenade confirmed blue + beeping by eye (2026-09-10 evening) |
| **Non-capturing hit** | no **DECODABLE** word — the grenade appears to announce captures, not hits (F75). ⚠ NOT a proven silence: a reply inside the shooter's own burst is invisible to every capture taken so far, and that is exactly where a hit word would sit. Gated on **B0** |

### Still to run, in value order

**B0. Geometry: receiver sees the GRENADE, not the SHOOTER (free, do first).**
`mag=50`'s reply is essentially instantaneous (~50 ms), so on the IR rig alone it overlaps the gun's own word
and only ever arrives stitched — a BLE stream sidesteps this by reading the host's decoded interpretation
directly, which is how the capture pair timing got corrected (2026-09-10 evening: `mag=53` turned out to
arrive 5 s later on the next beacon cycle, not in the same burst at all). For anyone repeating this on the IR
rig alone, geometry still matters for `mag=50`: no decoder separates two simultaneous transmitters. Put board A
behind the grenade, or have the shooter fire across the receiver's view. ⚠ **Any word that only occurs inside a
shot's burst has been invisible to every capture ever taken on the rig**, which is exactly where F75's "hit but
not captured" signal would hide. Gates B and F75.

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

**F75. Does a non-capturing hit emit anything?** In a NATIVE game, stand in an enemy hill and deliberately MISS.
Still says "contested" ⇒ native infers it too and we lose nothing. Silent ⇒ there is a hit word, and B0's
geometry is what will catch it.

**C. Both instruments on ONE window (10 min, board A + a gun on BLE).** ⚠ **Restored 2026-09-10 — the
2026-09-10 rewrite deleted this rung, and it is the named missing control for F69, which is still 🔴 and still
kills players.** Board A beside the headset AND the gun on BLE at the same time, while a NON-OWNER stands in
the hill. Settles whether the `proto=0 mag=8` damage word is continuous or conditional on ownership — the
comparison this session made across two different windows and therefore could not make at all.

**D. The contest, and Tony's shield design (20 min, TWO guns).** ⚠ **Also restored — `HANDOFF.md` and
`utility-roadmap.md` both still depend on this rung.** Both guns armed by us, both carrying a protocol-15 row,
on opposing teams, alternately capturing; watch each gun's view of the same beacon. Then the design test:
`<15,0>` on a **grant** function (fn 11 add shield, or 18) with friendly fire OFF, so ally polarity should
shield the HOLDER while `<0,0>` on fn 1 damages the challenger. ⚠ Arm from `$CLEAR` — an in-place `$SIR` row
replacement is unverified and probably voided the first attempt.

**X. Settle the capture currency (15 min, one gun).** The one trial that discriminates and has never been run.
Every reading so far confounds magnitude with the extra-headset block, because the only high-magnitude word
fired was a shotgun's `t12`. **Fire a HIGH-MAGNITUDE word from a NON-`t1=2` weapon** — boost an AR's `$WEAP`
t5 to ~70 — into a hill seeded with 45. If it takes the point, the currency is magnitude and F76's per-weapon
counts are wrong. If it does NOT, the extra-headset block is doing the work and F76's counts may be right for
ordinary weapons. Either way F70 and F76 both resolve. ⚠ Verify the magnitude on the wire before trusting the
run — `$WEAP` t5 is the raw IR magnitude (`$HIR` tok5), so board A should read ~70.

**R. ✅ ANSWERED 2026-09-10 (evening), by estimate rather than tape measure.** Close in (desk range) the
beacon is solid, zero misses across 20+ consecutive reads at a clean 5.0 s. At the operator's estimated
~30 ft it turned intermittent — long dropouts (85 s and 145 s of silence) interleaved with brief runs of
clean 5 s beacons. So the reliable range is well under 30 ft and the useful outer edge is around there.
**The hill beacon reaches further than the respawn station** (documented ~18-20 ft). ⚠ Not a hard number:
one operator estimate, no tape measure, and the beacon is AIM-SENSITIVE (`reference/grenade.md`), so
orientation was an uncontrolled variable. **Design consequence:** presence is not a clean in/out at the
range boundary — do not call a player "left the hill" on one missed beacon; with a 5 s period, a grace of
at least two missed beacons (~12 s) is the floor.

**M. Max charge.** Does a hill cap, and how long does a full one take to build? Needed only to tune contest
difficulty.

**B. The missing hill words (15 min).** Respawn has boot (`mag=56`, arms guns pre-game) and button (beacon +
crit bit) words. **Only the hill BEACON and its capture pair are captured.** Look for a hill boot word on
power-up and a button word on a press — a boot word would let a Utility Box announce a point.

**E. The three silent modes (20 min, receiver only).** `reference/grenade.md` says Assault (green), CTF (white)
and Frag (red) do not beacon. Verify, and find what they DO emit: a capture word when shot, a blast word when
detonated (**G10**), CTF team assignment (**G9**). If Assault/CTF are truly silent a hosted game cannot read
them, which is worth knowing before anyone designs a mode around them.

**F. Never run.** Q0: does the grenade emit over Bluetooth/RF at all (`grenade_bench.py rf`)?

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

## Replay words

The `ir-emit` one-liners (respawn beacons per owner team, hill beacons, the kill shot) and the
protocol-15 passthrough rows moved to `docs/reference/grenade.md` → *Replay words* on 2026-09-06.
