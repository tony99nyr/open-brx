# Bench run sheet — the six readings that gate the KotH build

Updated: 2026-09-11. **Read this file and nothing else.** It is self-contained: every command below was
run against its own source on 2026-09-10 (the generator ones were executed; the hardware ones are
quoted from tools that exist). Links are for mechanism only — you do not need them to run the session.

Six rungs in three SETUP blocks, about **two hours** plus a 15-minute pre-flight. Blocks are ordered so
the gun is re-armed as little as possible and so the cheapest rung that can kill the most expensive plan
runs first. **Finish a block before starting the next one.**

| block | setup | rungs | time |
|---|---|---|---|
| **A** | one gun on BLE + board A (receiver), **no grenade** | A1 protocol move · A2 rate-of-fire floor | ~35 min |
| **B** | same, **plus the grenade in HILL** | B1 the hill's damage word · B2 can we still capture · B3 the currency | ~55 min |
| **C** | one gun on BLE + board B (emitter) at 3 ft, no grenade | C1 the shield grant · C2 the last status functions | ~30 min |

---

## Seven traps that fake a result

All seven cost real bench time on 2026-09-10. Numbers 1-4 each produce a reading that looks like data.

1. **Do not hand-roll an arm sequence.** Three arms in a row spawned a gun that showed HP and armour,
   looked armed, and fired nothing: missing `$START`, missing `$AMMO`, missing `$BMAP`, or `$SPAWN,*`
   written for `$SPAWN,,*`. Every arm in this sheet comes from **`mcp/tools/armgen.py`**, which calls
   `gameconfig.arm_sequence()` and runs `assert_arm_sequence_complete()` on the result, so a broken
   bundle fails at the desk instead of reading as a dead trigger. If you build one by hand anyway, run
   it past `assert_arm_sequence_complete()` — it names the symptom, not just the missing frame.
2. **`$WEAP,0` is the PRIMARY the trigger fires. `$WEAP,1` is the secondary.** A weapon loaded into
   slot 1 with nothing in slot 0 gives the same dead trigger as trap 1.
3. **A STITCHED IR word can be parity-valid and WRONG in the exact field you are measuring.** Board A
   fragments frames and `native_capture.py` stitches them; during rig qualification the stitcher's
   `AMBIGUOUS 2` lines offered impostors reading `proto=4`, `proto=1`, `mag=137`, `mag=41`. **A1 and B3
   measure the protocol and magnitude fields, which is precisely what an ambiguous stitch invents.**
   Count only `WORD` lines (whole, ~51-52 edges) or an unambiguous `STITCH`; discard every `AMBIGUOUS`.
   Budget for the rate: **7 whole words out of 45 bursts** in that qualification, so fire 20-30 rounds
   per reading, not 5.
4. **F74's phantom replay.** A gun can latch an IR event and replay it — `$HIR` + `$HP`, headset flash
   and all — every ~5 s with **nothing in the air**; board A recorded zero bursts across 18 s while the
   gun reported a hit every 5.07 s. `$PLAYX,0,*` does not clear it; **`$SPAWN,,*` does**. Every arm in
   this sheet ends in `$SPAWN,,*`, so a full re-arm is also the phantom guard. **Before you believe any
   drain, look at board A.**
5. **3 ft of separation, minimum.** A point-blank emitter floods the sensors and **corrupts the protocol
   nibble**: three emissions produced nine `$HIR`, six of them decoded as protocol 0 instead of the
   protocol under test, and one of those took 20 armour off a gun in a test that was meant to move no
   pools. The emitter reaches 6/6 at 3 ft and 10/10 at 6 ft, so distance costs nothing.
6. **Count `$ALCD` magazine decrements, never trigger pulls.** Under this gun's fire mode 14 one `$BUT`
   press sometimes releases **two** rounds (`$ALCD` 25→24 across two frames from one press). Every
   ms/round and every seeded-charge number in this sheet is decrements over elapsed `t_ms`, or it is not
   a number.
7. **Work within a few feet of the PC.** A gun at RSSI -74 drops the BLE link partway through a long
   `$WEAP` write, which leaves a half-configured gun that reads like a firmware quirk.

**And two standing rules:** one `$SIR` row change at a time, with the `$HIR` **protocol field** read back
per trial (a word that mis-decodes lands in another cell and you attribute its effect to your row); and
**never end a run on a bare `$CLEAR`** — it wipes the `$SIR` table and the gun then silently discards
every hit while reporting healthy (F11). Close with the teardown in §Close-out.

---

## Setup (15 min, do all of it)

**Pre-flight, in order, every time** (`gotchas.md` §"Before a bench session"):

1. **Kill stale `brx_mcp` processes.** A forgotten server holds a gun, and a held gun stops advertising,
   so it is invisible to `scan` and indistinguishable from broken hardware. In PowerShell:
   `Get-CimInstance Win32_Process -Filter "Name like '%python%'" | Where-Object { $_.CommandLine -like '*brx_mcp*' } | Select ProcessId, CreationDate`
   — anything not from this session, `Stop-Process -Id <pid> -Force`. `list_connections` is **not** a
   sufficient check: it reports `connected: false` while another process holds the gun.
2. **Power-cycle the gun AND its headset** (screamer rule).
3. **Check the rig reaches**, with the gun **out of the beam** (six live magnitude-20 words once killed a
   gun parked between the boards, and then read as a marginal link because the gun was occluding the
   receiver):
   `$PY mcp/tools/loopback.py COM8 COM7 12`.
4. **Never conclude "deaf" without reading the pools.** A dead gun and a `$SIR`-less gun look identical
   through `$HIR`.

**Shell** (WSL):

```bash
PY=/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe     # anything touching BLE or a COM port
WPY=/home/tony/gitrepos/battlecompany/.venv/bin/python     # frame generation only, no hardware
cd /home/tony/gitrepos/battlecompany
GUN=D8:AE:5F:60:E2:0D                                      # Tactix-E20D; confirm with `$PY -m brx_mcp scan`
```

**How every arm in this sheet is sent.** Generate, eyeball, send, keep the connection:

```bash
$WPY mcp/tools/armgen.py 1 5 ar                            # prints 32 frames to stdout, notes to stderr
```

Then `mcp__brx__connect(address=$GUN, alias="g")` once for the whole session, and
`mcp__brx__send_batch(alias="g", commands=[...those frames...], gap_ms=250)`. Read with
`mcp__brx__get_events(alias="g", since_seq=<last>)`. **Keep the one connection open across a whole
block** — that is the only way to read the shooter's own `$ALCD` while it fires (`sendframes.py` and
`firemode_probe.py` both disconnect when they finish).

⚠ **`$QUERY,*` is not on the known-safe list**, so the MCP `send` tool refuses it **silently unless you
pass `confirm=true`**. On 2026-09-09 two such refusals were read as the gun ignoring a frame and produced
a false finding. Confirm a frame was SENT before concluding anything about how the gun answered.
`$VOL $CLEAR $START $GSET $PSET $WEAP $SIR $BMAP $GLED $TID $SPAWN $AMMO $PLAY $PLAYX $HLED` are all safe.

**Two things armgen gives you that matter.** Token overrides are in **doc numbering** (`t3=7`), and it
prints the raw index it used (`doc t3 = raw index 4`) — the off-by-one that once wrote the rate of fire
into the swap-delay token and shipped every weapon at 10 shots/s. And `-sir=<p>,<s>` / `-sir=all` edit the
`$SIR` table, failing loudly if a row you asked to drop is not there or survives the edit.

**Defaults you are running with, so you do not have to look them up:** `armgen … ar` puts the **full-auto
AR** in slot 0 (`t3`=0 protocol, `t5`=24 magnitude, `t14`=100 ms/round, `t21/t22`=100/100 = recoil model
OFF), the stock **10-row `$SIR` table**, `$VOL,80`, and **`$GSET` friendly fire ON** (`t1=1`, which lifts
the IR polarity gate — a KotH mode wants this, and it changes what B1 reads). `$TID` is the first
argument, `$PSET` player id the second. **Never use team 2: a neutral hill broadcasts team 2** (F82).

**The phone is not in the loop for any rung tonight.** Everything is read off the wire over BLE, so the
installed APK version does not matter and no `engine.js` fix is needed to take these readings.

---

## Block A — one gun on BLE + board A, no grenade (~35 min)

Board A (**COM7**) about 3 ft in front of the muzzle, soft background behind it, grenade out of the room.

### A1 — does `$WEAP` t3 actually change the transmitted IR protocol? (15 min) 🔴 F91

**Why this is first.** A grenade hill emits an ambient `proto=0 mag=8` damage word that our
`$SIR,0,0,,1` row applies in full, so an enemy-held hill **chips the attacker** — it punishes exactly the
pushing a KotH mode needs. The fix is to move our weapons off cell `<0,0>` so the hill's word lands in an
unmatched cell and is silently discarded. **t3 = `primaryDamageType` is believed to BE the IR word's
protocol field** (a 15-value enum; stock weapons already ship 8, 10, 11, 13) and protocol independence
for fn 1 is measured across 0, 5, 7, 9 and 10 — but **nobody has ever set a non-stock t3 on our gun and
watched the wire.** If t3 does not move the transmitted protocol, the whole F91 plan is dead and B1's
second half and B2 do not need running.

**Control first.** Arm stock and confirm the rig decodes this gun correctly tonight:

```bash
$WPY mcp/tools/armgen.py 1 5 ar                            # t3 = 0, the stock AR
$PY  mcp/tools/native_capture.py A1-control-proto0 COM7 60  # start this, then fire
```

Fire **25-30 rounds** in bursts of 5 with a second between bursts (trap 3: whole words are rare).

**Then the test.** Re-arm with one token changed, and **read the printed `$WEAP,0` line before sending**:

```bash
$WPY mcp/tools/armgen.py 1 5 ar t3=7
# stderr says: $WEAP,0 (PRIMARY, the trigger) doc t3 = raw index 4: '0' -> '7'
$PY  mcp/tools/native_capture.py A1-test-proto7 COM7 60
```

Same 25-30 rounds, same distance, same session.

| | |
|---|---|
| **Reads** | the `proto=` field of every **`WORD`** line in each capture (discard `AMBIGUOUS`). Magnitude should stay 24 in both — t3 must not move it. |
| **Decides** | every clean word in the second capture reading `proto=7` ⇒ **t3 IS the wire protocol**, and F91's route is live. |
| **Control** | the first capture. Its words must read `proto=0 mag=24`: that proves rig, geometry and decode are sound tonight, so a `proto=7` reading afterwards is the token and not the room. Without it a `proto=7` is uninterpretable. |
| **Falsifies** | words still reading `proto=0` after t3=7 ⇒ either t3 is not the wire protocol or the write did not land. Check the `$WEAP,0` frame in the session log before believing it; if it was sent correctly, **write F91 up as refuted, skip B1's part 3 and B2, and go straight to B3.** |
| **Also record** | any word whose magnitude is 0 — that is the recoil-model miss (t21/t22 are 100/100 here, so there should be none; one appearing means something else moved). |

### A2 — how low can t14 go? (20 min) 🟠 F87 / F100, blocks both

t14 is milliseconds per round, calibrated at **one point only**: t14=100 measured 101.6 and 102.0
ms/round. Every rate-of-fire reward (hill buff, worn powerup) needs the **floor** — the value at which
measured ms/round stops tracking t14, because the firmware clamps it or the IR stops keying reliably. No
boost ratio can be chosen without it, and nobody has measured it.

Board A stays pointed at the muzzle for this rung: the number of bursts it sees per magazine is the
second half of the answer (a round the firmware fires but the emitter cannot key is a round that cannot
hit anyone).

For each value **in this order — 100, 70, 50, 30, then 100 again** — one capture per value, so the file
name says what it holds:

```bash
$WPY mcp/tools/armgen.py 1 5 ar t14=<value>            # confirm stderr says raw index 15
$PY  mcp/tools/native_capture.py A2-t14-<value> COM7 30
```

send the arm, start the capture, then **hold the trigger** through a full magazine (32 rounds) pointed at
board A. A magazine at t14=100 takes ~3.3 s; at t14=30 under a second, so start firing promptly.

| | |
|---|---|
| **Reads** | from `get_events`: the `$ALCD` frames' first token (magazine). ms/round = `(t_ms of the last $ALCD − t_ms of the first) ÷ (decrements between them)`. Also `$ALCD` token 2 (live accuracy) and, on board A, bursts seen per magazine. |
| **Decides** | the value where measured ms/round stops falling with t14. Expect ~102 at 100; if 50 gives ~50 and 30 gives ~30, there is no floor in this range and the answer is "linear to at least 30". |
| **Control** | **the closing 100 must reproduce the opening 100** (101.6-102.0 ms/round). It is an A-B-A: if the bookend disagrees with the opening, the method drifted and the whole sweep is void. |
| **Falsifies** | ms/round flat across 100→30 ⇒ t14 is not the rate at these values (or is clamped above 100) and the F87/F100 lever is not t14 at all. Bursts on board A falling behind `$ALCD` decrements ⇒ the IR emitter, not the firmware, is the floor — and that is the number that matters, because a round that does not key is a round that cannot hit anyone. |
| **Watch for** | `$ALCD` token 2 must stay pinned at 100 (t21=t22=100 disables the recoil model). **If it moves, stop and record it** — it would mean cadence alone drives the accuracy walk. |
| **Optional, if time** | one extra pass at t14=100 and t14=50 with `t22=50`, counting rounds to floor. F46 predicts a faster cadence bites harder; this is the cheapest place anyone will see it. Mark it optional and do not let it eat block B. |

⚠ Each step is a **full re-arm** (armgen always ends `$SPAWN,,*` + `$AMMO`), which is deliberate: a
`$WEAP` re-push resets ammo anyway, and the `$SPAWN` clears any latched phantom (trap 4).

---

## Block B — the same, plus the grenade in HILL (~55 min)

**Grenade setup:** off, on, wait for green; hold the top button ~4 s until the long beep; keep holding
through the colour cycle; release on **blue (HILL)**; white LED = locked. Power-cycle it and confirm a
blue boot flash. Leave it **neutral** (unshot). Stand it 3-6 ft from the gun with **board A facing the
grenade**, so board A witnesses the grenade and not only the gun's own muzzle.

### B1 — is the hill's damage word continuous or conditional, and does dropping `<0,0>` stop it? (25 min) 🔴 F69 + F91

This is **rung C of `bench-grenade.md` merged with F91's second half**, because C is the control F91's
"confirm a hill no longer drains an intruder" needs: "no drain" only means something if you can show the
damage word was in the air during the window. Board A shows that; the gun alone cannot. The experiment
log admits this dual-instrument control was never taken — every previous comparison spanned two
different windows.

⚠ **Expect the gun to DIE in windows 1, 2 and 4, and that is fine.** 8 damage every ~5 s against 70
armour + 45 HP is death in **70-105 s** (F69 measured ~106 s), so a 60 s window may end in a green
out-flash. **A dead gun takes no IR**, so count only up to the death and treat time-to-death as one of the
numbers. **Re-arm before every window** (each arm below ends in `$SPAWN,,*` + `$AMMO`, which restores the
pools and clears any latched phantom) — do not try to carry pools across windows.

Four windows of 60 s, **one capture each** so the counts are per window with no boundaries to find, and
**hands off the trigger except where it says to fire**. Note the `last_seq` from `get_events` at each
window boundary so the gun-side counts split the same way the captures do.

1. **Owner.** Arm team 1 with the stock table plus the beacon row:
   `$WPY mcp/tools/armgen.py 1 5 ar '+sir=$SIR,15,0,,28,0,0,1,,*'`. Fire **one** round at the neutral
   hill to claim it; from the next beacon on, the gun is the owner. Then
   `$PY mcp/tools/native_capture.py B1-w1-owner COM7 60` and hands off.
2. **Intruder.** Re-arm identically but on **team 0**:
   `$WPY mcp/tools/armgen.py 0 5 ar '+sir=$SIR,15,0,,28,0,0,1,,*'`. The hill still belongs to team 1, so
   the gun is now an intruder standing in it, with full pools. `native_capture.py B1-w2-intruder COM7 60`,
   hands off. **Do not fire** — a shot would re-capture the hill and end the intruder condition.
3. **The deaf test.** Re-arm with `<0,0>` gone and a protocol-7 damage row in its place, still on
   **team 0** so the gun stays an intruder:

   ```bash
   $WPY mcp/tools/armgen.py 0 5 ar t3=7 -sir=0,0 \
       '+sir=$SIR,7,0,,1,0,0,1,,*' '+sir=$SIR,15,0,,28,0,0,1,,*'
   ```

   `native_capture.py B1-w3-deaf COM7 60`, hands off, do not fire.
4. **The closing control.** Re-arm **exactly as window 2**
   (`$WPY mcp/tools/armgen.py 0 5 ar '+sir=$SIR,15,0,,28,0,0,1,,*'`),
   `native_capture.py B1-w4-control COM7 60`, and confirm the drain **comes back**. Windows 2-3-4 are an
   A-B-A on one changed thing: the `$SIR` table.

| | |
|---|---|
| **Reads** | **board A:** the count of `proto=0 mag=8` words and `proto=15 mag=8` beacons per window. **The gun:** `$HIR` rows grouped by protocol, every `$HP` drop with its size, and the time to death if it dies (or `$LCD,0,0,...`, which is the shape a lethal write announces instead of `$HP,0,0,0`). |
| **Decides** | (a) the `proto=0` word present on board A in **both** windows 1 and 2 ⇒ it is **ambient and continuous**, and only the receiving gun's polarity decides whether it lands. Present only in window 2 ⇒ conditional on a non-owner, which would need a mechanism nobody has proposed. (b) Window 3 showing the `proto=0` word **still on board A** while the gun logs **no proto-0 `$HIR` and no `$HP` drop** ⇒ dropping `<0,0>` makes the hill harmless, F91 confirmed end to end. |
| **Control** | board A and the gun are each other's control — that is the whole point of one window. Window 4 is the second control: if the drain does not return, window 3's silence was the grenade going flat or drifting out of range, not the table. |
| **Falsifies** | window 3 still draining ⇒ read the `$HIR` protocol on each drop. **Protocol 7 means you shot yourself** — friendly fire is ON and a reflected own round now lands on your new `<7,0>` row (which is itself a finding worth recording). Protocol 0 with `<0,0>` removed would mean the word is matching some other row, and the table in the session log says which. |
| **The reading nobody has written down** | friendly fire is **ON** in every arm here, so the polarity gate is lifted — **does the OWNER take the chip damage too** (window 1)? F69 only ever measured a non-owner. If the owner bleeds as well, then "FF on" (which F73 says a KotH mode wants, so it can read every beacon) chips **everyone** standing on the point, and F91 stops being an optimisation and becomes the only way to ship the mode. |
| **Record either way** | the tradeoff: dropping `<0,0>` makes our guns **deaf to any native BRX gun**, which is fine for an all-hosted match and fatal for mixing hosted and native players in one game. |

### B2 — can a gun on protocol 7 still capture a hill? (10 min) 🔴 F91, and it can kill the plan

**Not in anybody's queue, and it is the question that decides whether F91 is shippable at all.** Capture
is "shoot the grenade", and every capture ever measured was a **protocol-0** word. If the grenade's own
receiver only accepts protocol 0, then moving our weapons to protocol 7 buys immunity to the chip damage
by **giving up shoot-to-capture** — which deletes the mode F91 exists to protect.

Power-cycle the grenade back to neutral HILL. The gun is still armed from B1 window 3 (t3=7).

1. Fire **one** round at the neutral hill. Watch for the capture announcement.
2. **Control:** re-arm stock (`armgen.py 0 5 ar '+sir=$SIR,15,0,,28,0,0,1,,*'`), power-cycle the grenade
   to neutral again, fire one round, and confirm it captures — the known-good case, proven 2026-09-10.

| | |
|---|---|
| **Reads** | `$HIR,<sensor>,15,0,<new owner>,50,0,0` within ~50 ms of the shot (the `mag=50` capture word), the following `mag=8` beacons carrying your team, and **your own eyes**: the grenade turns your colour and beeps. |
| **Decides** | proto-7 round captures ⇒ F91 is safe end to end, ship it. Does not capture ⇒ F91's fix costs shoot-to-capture, and the write-up must say so: either keep `<0,0>` and eat the chip damage, or find a protocol the grenade accepts, or drop `<0,0>` **only** for modes with no capture objective. |
| **Control** | step 2. Without it, "no capture" could be a flat grenade, a bad angle or an empty magazine. |
| **Falsifies** | no `mag=50` in either step ⇒ the geometry or the grenade is the problem, not the protocol; nothing is learned. Check `$ALCD` actually decremented — a receive-only arm cannot shoot, which is exactly what cost the first pass of this rung on 2026-09-10. |

### B3 — what is capture charge priced in? (20 min) 🔴 F70 / F76

Charge accumulates and the attacker wins ties. What it is **priced in** is unsettled, because the one
discriminating trial ran two variables at once: the shotgun's `mag=70` **is** its `t12`
extraHeadsetDamage, so magnitude and weapon-block moved together. `reference/grenade.md`'s per-weapon
round counts (which make a shotgun the *slowest* capturer) contradict the magnitude reading outright, and
both cannot be right. **The clean trial: a high-magnitude word from a weapon with no extra-headset
block.** The AR is that weapon — `t1` (weapon class) and `t12` are both **empty** on it, so `t5=70` is a
pure magnitude-70 ordinary round. Confirm both are empty in the frame armgen prints.

⚠ **Arm with `-sir=0,0` for every step of this rung.** The gun has to survive several minutes beside an
enemy-held hill, and without that row it cannot be chipped (B1 proves it). **What a gun RECEIVES has no
bearing on what it TRANSMITS**, so its rounds are still ordinary `proto=0` words that capture normally —
this changes nothing the rung measures and removes the only reason the run could die halfway.

1. **Seed.** `$WPY mcp/tools/armgen.py 1 5 ar t5=9 -sir=0,0` (magnitude 9, matching the existing
   seeded-charge numbers).
   Fire **one** round at board A first and confirm the wire reads `mag=9`. Power-cycle the grenade to
   neutral HILL. Fire **5 rounds** at it, one at a time, reading a beacon between each: the hill flips to
   team 1 on the first and accumulates to **45**. Count by `$ALCD` deltas (trap 6).
2. **Become the attacker and re-weapon in one step, then verify on the wire.**
   `$WPY mcp/tools/armgen.py 0 5 ar t5=70 -sir=0,0` — team 0 now, one weapon token changed (the re-arm sets `$TID`
   for you, so no separate `$TID` write). Fire **one** round at **board A**, not the grenade, and confirm
   it decodes `mag=70` on a whole `WORD` line. **If you cannot see 70 on the wire, the rung is void** —
   do not fire at the hill.
3. **The trial.** Fire **one** round at the hill. Read the next beacon's team field.
4. **Closing control.** With the hill still holding ~45 for whoever owns it, go back to `t5=9` and count
   how many rounds a flip costs. Roughly 5 reproduces the known result and proves the seed was real.

| | |
|---|---|
| **Reads** | the team bits of the first `mag=8` beacon after each shot, plus the `mag=50` capture word. Magnitude of each fired round on board A. `$ALCD` deltas for every count. |
| **Decides** | one magnitude-70 AR round flips a hill holding 45 ⇒ **the currency is magnitude**, `reference/grenade.md`'s per-weapon counts are wrong, and a weapon's capture power equals its damage for free. It does **not** flip ⇒ the extra-headset block is doing the work, F76's counts may be right for ordinary weapons, and the whole "capture power = damage" design consequence comes off the table. |
| **Control** | step 2's wire check is the control for the treatment (magnitude really was 70); step 4 is the control for the seed (the hill really held ~45). Both are required — step 1's five rounds mean nothing if the hill was not neutral when you started, which is what the power-cycle guarantees. |
| **Falsifies** | a flip on step 3 that the beacon does not confirm (grenade colour only) is not a result; read the wire. If step 4 needs 1 round rather than ~5, the hill was not holding 45 and step 3's outcome is uninterpretable in either direction. |
| **Also worth one line** | whether the hill **caps**. If step 4 takes far fewer rounds than step 1 seeded, a ceiling is the obvious explanation (open as rung M, do not chase it tonight). |

---

## Block C — one gun + board B emitter at 3 ft, no grenade (~30 min)

Grenade off and out of the room. Emitter board B (**COM8**) aimed at a headset dome from **3 ft** (trap
5). Close any Arduino serial monitor: Windows COM ports are exclusive and the monitor steals the port
silently.

### C1 — can anything put a shield on a gun? (20 min) 🟠 F60 / P16, plus the D6 ally remainder

**Nothing shield-shaped has ever been on a gun.** Shield is IR-only (fn 11 / 18, ally polarity) and no
compiled mode of ours ships a grant row, so the teal shield bar and A16.5's shield→armour handover are
**unverifiable today** — not unverified, unverifiable. One tool answers it, and it already carries the
method fixes this rung needs (grants clamp on a full pool, so it depletes first; fns 10 and 11 are its
built-in positive controls; it re-spawns to full between rows; it tears down without a bare `$CLEAR`):

```bash
$PY mcp/tools/ally_remeasure.py $GUN COM8 10,11,18,31,32,34
```

That one line also clears the **D6 remainder** on the ally side (31, 32, 34) — same harness, same run,
one extra argument. It arms the victim with `$SIR,1,0,,<fn>` (one function at a time) plus a plain-damage
row to deplete with, and fires ally-polarity words from board B.

| | |
|---|---|
| **Reads** | the tool's printed pool triples, `hp/armour/shield`, before and after each function's words. **A non-zero third number is the finding** — `$PSET`'s shield token reads back 0 (P16), so a shield that appears came from the IR word. Useful corollary: the shield pool **starts empty**, so unlike a heal a shield grant can never be hidden by clamping, and "no change" here is a real null. |
| **Decides** | fn 11 or 18 granting shield ⇒ the first shield ever on a gun, the teal bar becomes testable, and the F99 M5Stack "only thing that can grant a shield" argument gains its hardware proof. Both landing and moving no pool ⇒ record it: shield may be unreachable on v4.32, which is a design decision, not a bug. |
| **Control** | **fn 10 is a known heal and must show a grant.** If it does not, the aim, the polarity or the connection is wrong and **nothing else in the run counts** — re-aim board B and re-run before reading a single other row. Check the control before the result. |
| **Falsifies** | rows reading "did not register (no `$HIR`)" ⇒ team polarity, not the function: the tool fires ally words and support functions land only from your own team. |
| **Fallback, 5 min** | if fn 10 grants but 11 and 18 do not, try the **official app's own cell** before concluding. The stock Team Arena table ships `$SIR,2,1,VA8C,11,0,0,1,,*` for add-shields, so arm `$WPY mcp/tools/armgen.py 1 5 ar -sir=all '+sir=$SIR,2,1,VA8C,11,0,0,1,,*'` and emit a matching ally word: `$WPY -c "from brx_mcp.irbridge import encode_word; print(encode_word(proto=2, player=42, team=1, damage=50, subtype=1))"` then `$PY -m brx_mcp ir-emit <bits> COM8 1`, three times ~6 s apart. Read `$HP` token 3. |
| ⚠ **Cannot be checked tonight** | even a proven shield will not show on a phone: the published APK predates A16/A17. Read it on the wire, never on the HUD. |

### C2 — enemy fn 35, the last unswept status function (10 min) 🟡 D6

Enemy 8, 24, 25, 26, 27 and 28 are swept; **35 is the last one open**, and it is the fallback if fn 28
turns out to have a side effect. This is a *human* reading — what a person holding the gun hears, sees or
cannot do.

**One row in the table, and only one** (a mis-decoded word then has no cell and is discarded instead of
scoring somewhere you are not looking):

```bash
$WPY mcp/tools/armgen.py 1 5 ar -sir=all '+sir=$SIR,5,0,,35,0,0,1,,*'
$WPY -c "from brx_mcp.irbridge import encode_word; print(encode_word(proto=5, player=42, team=2, damage=20))"
# -> 0101101010100001010000010
$PY -m brx_mcp ir-emit 0101101010100001010000010 COM8 1     # three times, 6 s apart
```

Hold the gun. **6 s between words** — the long grenade-ish clip on fns 24-27 turned out to be one clip
truncated by the next event, and closer spacing is what faked "varied sounds" last time.

| | |
|---|---|
| **Reads** | does `$HIR,<sensor>,5,42,2,20,0,0` arrive (registers?), does `$HP` move (pool change?), and **what the holder reports**: sound, headset flash, vibration, a trigger that stops working. |
| **Decides** | fn 35's row in the function map: registers silently, registers with feedback, or does not register. |
| **Control** | run **fn 1** on the same cell first (`-sir=all '+sir=$SIR,5,0,,1,0,0,1,,*'`) — a pool drop proves cell, geometry and polarity, so a later silence is the function and not the rig. **fn 28** is the reference for "registers with nothing at all". |
| **Falsifies** | zero `$HIR` ⇒ polarity (the word is enemy-team 2 against a team-1 gun, which should land) or aim; not a property of fn 35. Any `$HIR` whose protocol is not 5 is a trap-5 corruption — discard the trial, do not average it in. |
| **If there is time** | ally 31/32/34 are covered by C1; nothing else in D6 remains after this. |

---

## What is blocked, and what is not

**Nothing in this sheet is blocked on code.** `armgen.py` landed with it, `ally_remeasure.py` and
`native_capture.py` already existed, and every frame is generated by `arm_sequence()`.

Blocked, and deliberately not on tonight's list:

| item | what has to land first |
|---|---|
| Shipping F91 (weapons off protocol 0) | code, not bench: `gameconfig._SIR_TABLE` + `mc/compile.py` must move the weapon catalog's `t3` and the compiled table together, or a game arms guns that cannot hit each other. A1/B1/B2 are the evidence that decides whether to write it. |
| The hill rate-of-fire buff (F87) | A2's floor number, then the push/revert `$AMMO` work (`bench-grenade.md` rungs Z2/Z3). Not a reading, a build. |
| The teal shield bar · A16.5's handover · `$LCD` token 3 (B20) | an APK carrying A16/A17. C1 can prove a shield exists on the wire; it cannot show it on a phone. |
| F81's "killed by the wrong team" copy | the DOWN-screen wording belongs to the brx-hud session; B1 will make the hill damage reproducible for it. |

---

## Close-out

**Teardown, every time.** Never sign off on a bare `$CLEAR` — re-arm the table:

```bash
$WPY -c "import sys; sys.path.insert(0,'mcp/tools'); import bench_common; print('\n'.join(bench_common.teardown_frames()))"
```

Send those, then `mcp__brx__disconnect(alias="g")`. If the gun has been left odd, the panic sequence is
`$CLEAR,*` then `$SP,99,*` — ⚠ that leaves it with **no `$SIR` table**, so it cannot be hit until
re-armed.

**Then the three writes** (the session close, in this order):

1. **One entry** appended to `docs/experiment-log/2026-09.md`, dated, with the numbers and the controls —
   including the rungs that returned nulls, which are results.
2. **One `FOLLOWUPS.md` diff**: strike or add rows, no prose. F91 resolves or is refuted; F70/F76 resolve
   together on B3; F60 moves on C1; F87 gets its floor from A2. A closed item becomes one dated line in
   `docs/archive/followups-closed.md`, and ids are never renumbered or reused.
3. **One `HANDOFF.md` replacement** — overwrite it, never stack banners; it must stay ≤ 150 lines.

Anything a rung raised but did not settle goes in as a new followup row rather than into this file: this
sheet is spent once it has been run.

**Mechanism, if you need it:** `bench-grenade.md` (the grenade programme, rungs C/D/X/Z in full) ·
`FOLLOWUPS.md` (F69, F70, F73, F74, F76, F87, F91, F92, F100) · `../protocol/brx-protocol.md`
(§5 `$SIR` functions, §6 `$WEAP` tokens) · `reference/weapons.md` · `gotchas.md` ·
`experiment-log/2026-09.md` (2026-09-10, four entries).
