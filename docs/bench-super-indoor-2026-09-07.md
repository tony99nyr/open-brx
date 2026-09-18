# Bench (MacBook) — "Super Indoor": can we emit BELOW factory indoor power?

**For the MacBook session.** One question: **is there a software lever that makes the gun's IR beam
weaker than factory indoor mode?** Tony's rooms bounce full-power IR off the walls and players take
hits from everywhere. If a lever exists, it becomes a venue preset; if it does not, we go physical
(aperture) and the field guidance stays "play team modes indoors" (friendly fire off is
firmware-enforced both ways, so your own and your teammates' bounces are already discarded).

This sheet exists because **the rig has never run on macOS** and because getting far enough from the
receiver needs the laptop, not the Windows box. Read `gotchas.md` ("Before a bench session"),
[`mac-dev-runbook.md`](mac-dev-runbook.md) and [`FOLLOWUPS.md`](FOLLOWUPS.md) §9 first.

## 1. What is already known — do not re-derive it

> **Rewritten 2026-09-17.** The garden ladder (F231/F234) answered the range question outdoors, and it
> moved the lever. This section used to open with t41 and with U2's "one prior positive"; both are
> retracted below. Lever 1 is now `$WEAP` **t2**.

- **Lever 1 is `$WEAP` token 2 `gunRangeOutdoor`**, the proven emitted-power control (bench 2026-09-17,
  F231/F234, `manual/dev.md` t2 row). Every captured gun reads **100** and melee reads 90. Outdoors:
  **t2 = 5 landed 0 hits from 38 shots**, muzzle on the dome included; **13 to 26** is a real
  attenuation band; **about 31 to 100 is a flat shelf** at every distance a garden can pace. The whole
  ladder was shot into a dome in direct sun with the light moving, so treat every low number as a
  lower bound. **What this sheet must add is the INDOOR half**: whether a t2 in the 13-26 band gives a
  usable short-range beam in a bouncy room. MC refuses to compile a value under 13.
- **`$WEAP` token 41 `gunRangeIndoor` is a measured null. Do not sweep it.** Two slots differing only
  in t41, 5 against 75, scored 27 of 27 and 55 of 57 from 3 m to about 200 ft in outdoor mode
  (2026-09-17, F231). The **U2 "prior positive"** (`weapon-design.md` §5, 2026-08-26, t41 = 100 killed
  at max indoor distance) was uncontrolled and is **retracted as evidence**: it never had a closing
  control, and the t41 = 5 zeros beside it were rig degradation. t41 stays at its captured 75 and is
  worth one confirmation rung indoors, not a ladder.
- **`$GSET` token 3 `gunLaserRegion`** (captured `1`) is the regional IR power limit — lever 2, one
  token, two minutes, still untested. We hardcode `1` in `mc/compile.py` and `gameconfig.py`.
- **`$IRTX` and `$HFIRE` are dead ends.** They carry literal `iRPower` / `rangeIndoor` fields and
  produced **zero IR** on v4.32 across five shapes each, with a receiver control passing either side.
  Do not spend the session there.
- **Keep `$GSET` token 2 at `0` for every rung.** The 2026-09-13 field control found that `1`
  cripples hit reception. The former claim that it selects the t41 profile was unsupported; see
  [the token reference](manual/dev.md) and F198.
  `bench_common.GSET` already uses `0`.

## 2. Bring the rig up on the Mac FIRST (do this before Tony sets anything up)

The IR rig has only ever run on Windows (board A = receiver COM7, board B = emitter COM8). **None of
that is portable.** Prove the instrument on macOS before the experiment, or the session dies on
plumbing:

1. **pyserial is NOT a declared dependency** (`mcp/pyproject.toml` lists only `bleak` and `mcp`), and
   `mac-dev-runbook.md` §1's install line does not include it:
   `.venv/bin/pip install pyserial`
2. **Ports are `/dev/cu.*`, never `COM*`.** Every tool here defaults to `COM7`/`COM8`; pass the mac
   device explicitly, always. `ls /dev/cu.*` **before and after** plugging the board in — the new
   entry is the board.
3. **The USB-C hub is a real risk.** The board enumerates as a **CH343** (`USB-Enhanced-SERIAL CH343`
   on Windows). `find_esp32_port()` matches it by VID `1a86`, so auto-detect *should* work — but
   macOS needs a CH34x driver and some hubs drop these bridges entirely. **If `ls /dev/cu.*` gains
   nothing when you plug in, try the board directly into the MacBook before blaming anything else.**
   A board that works direct but not through the hub is a hub finding: write it down and use a
   different port or a powered hub.
4. **`$PING` both boards** before trusting either — a port that does not answer is not the board
   (auto-detect has picked a different USB device before).
5. **Calibrate the instrument:** `python mcp/tools/loopback.py <emitter> <receiver> 10`.
   **Anything below 100% bit-exact means no IR result from this rig is trustworthy.** Fix it first.
6. Unlike Windows there is **no interop dance** — the Mac has CoreBluetooth, so `.venv/bin/python`
   drives both BLE and serial. Remember macOS gives BLE **UUIDs, not MACs**; never pattern-match the
   address format.

If the board will not come up on the Mac at all, **stop and report that** — it is a finding worth a
FOLLOWUPS row, and the experiment moves back to Windows with a long USB extension instead.

## 3. Measurement design — read this or the numbers will be worthless

**The instrument is `python -m brx_mcp ir-range <port> <secs> <shots>`.** It reports:

| reading | meaning |
|---|---|
| `detect_rate` | detected / shots fired — **did the shot reach at all** (coverage) |
| `decode_rate` | clean 25-bit frames / detected — **how clean the signal is** (margin) |
| `overflow` | buffer overruns — you are **too close** |
| `unique_patterns` | must be **1** for one weapon; more means contamination |

`decode_rate` is the gift here: it is a **graded** margin readout, not a pass/fail. It degrades before
coverage does, so you can see the beam weaken without standing exactly on the cliff.

**Find the margin before you sweep.** At point-blank, t2 = 31 and t2 = 100 will both read 100% and
you will learn nothing — that is the shape of a threshold measurement. So:

1. Tape a mark, put the receiver on it, aimed and fixed.
2. At **stock t2 = 100**, walk back until `decode_rate` sits around **50–80%**. That is the working
   distance. Tape it. Every rung is fired from that mark, and **nothing about the geometry moves for
   the rest of the session.**
3. If you run out of room before the margin appears, do not give up — **attenuate instead of
   retreating**: shoot from a fixed **off-axis angle** (this doubles as Q16 divergence data), or put a
   known attenuator over the receiver. Note exactly what you did; it becomes part of the method.

**Distance is not limited by Bluetooth.** Config, alive/dead, ammo and `$TID` all survive a BLE drop,
so you can arm and spawn at the laptop, walk out of range with the gun, and fire. The receiver does
the counting; the gun does not need to report anything. (Indoor range is community-sighted at ~20 ft,
so BLE probably reaches anyway — but you are not stuck if it does not.)

**Two witnesses, because our decoder is a proxy for a headset, not a headset.** Sit a **second gun's
powered headset beside the receiver on the same mark** and have Tony count its flashes on the very
same shots. What we actually care about is whether a headset registers a hit; if the ESP32 and the
headset disagree, **the headset is primary** and the disagreement is itself the finding.

## 4. Pre-flight

1. Power-cycle gun **and** headset (screamers after ~a day powered). Charge the gun — a sagging
   battery is a power variable we cannot separate from t2.
2. Kill stale `brx_mcp` processes at the OS level; a forgotten server holds a gun.
3. `loopback.py` clean (§2.5), receiver taped and aimed, `unique_patterns` = 1 on a test burst.
4. **Rest the gun.** Handheld aim wobble at 5 m swamps everything else in this experiment. Sandbag,
   box, tripod — anything fixed, with a visible aiming mark. Re-check the rest between rungs.
5. **Fire slow: one shot every ~1.5 s.** The firmware simulates recoil and drags accuracy down under
   rapid fire; a "miss" still emits and still flashes the headset, so a mag-dump muddies the headset
   witness and tells you nothing about range.
6. Note the room lighting and any sunlight, and do not change it. `autoAmbientLight` is 0.
7. Arm with `bench_common.arming_frames()` + `AR` + `BMAP` + `$SPAWN` + `spawn_tail()`. **Without
   `BMAP` the trigger only produces `$BUT` and the gun cannot fire** (F16 — "you didn't give me a gun").

## 5. The ladder — one variable, 10 shots per rung, from the taped mark

Only **t2** changes (rewritten 2026-09-17: the old ladder swept t41, which the garden proved inert).
Same weapon (the bench AR), same distance, same rest, same aim point.
**After every `$WEAP` re-push, re-send `$AMMO`** — a re-push resets mag and reserve to the frame's
baked-in values (U9).

| # | t2 | why |
|---|---|---|
| 1 | **100** | **opening control** = stock. Records the baseline detect%/decode% at the mark. |
| 2 | **13** | **the bottom of the measured band, tested second on purpose.** Outdoors 13 gave 3 of 8 at 15 m on precise aim. If 13 is indistinguishable from 100 at this mark, the room is inside the shelf and the ladder stops here. |
| 3 | **5** | **the measured floor.** Outdoors it landed nothing at any distance, muzzle on the dome included. If 5 still kills across the room, that is a big finding and the outdoor floor does not transfer indoors. |
| 4–7 | **18 · 22 · 26 · 31** | only if rung 2 or 3 moved. Shape the curve through the transition band. Outdoors the groups stopped being monotonic below 26, so use **20 shots** a rung here, not 10. |
| 8 | **100** | **closing control.** It must reproduce rung 1. If it does not, the rig drifted and **every rung between them is void** — that is exactly what spoiled U2, so do not skip it. |
| 9 | **t41 = 5**, t2 back at 100 | one confirmation rung, not a ladder: indoors is the one place t41 has never been tested. One rung, then move on. |

**Rung 10 (2 min, if anything moved):** re-push a new t2 **mid-life without respawning** and fire
again. Does the gun read t2 at `$WEAP` time or at fire time? Decides whether a super-indoor preset
can be switched during a match or only at arming. (A mid-life `$WEAP` write applies in 30-90 ms and
resets mag, reserve and live accuracy: bench 2026-09-17.)

## 6. Lever 2 — `$GSET` token 3 `gunLaserRegion` (10 min, run regardless of the outcome above)

Same mark, same rest, same everything, t2 back to stock 100. Sweep **`$GSET,0,0,<0|1|2>,0,1,0,0,1,*`**
— that is token 3 = 0, then 1 (control, the captured value), then 2. (Token 7 is 0, the value MC now
compiles.) 10 shots each, closing control at
1. Expect coarse steps, possibly only two. Even a null here is worth recording: it retires the one
field in `$GSET` that is *named* like a power control.

## 7. Traps that have each cost a session

- **A `$WEAP` re-push resets ammo.** Re-send `$AMMO` or the gun runs dry mid-rung and you record a
  low detect% as a range result.
- **`overflow > 0` means too close.** Those readings are not measurements; move back.
- **The receiver fragments frames** (F12) — one arriving frame prints as 2–4 RAW bursts. `ir-range`
  counts bursts, so fragmentation **inflates `detected` and deflates `decode_rate`**. If the numbers
  look strange, capture the same rung with `native_capture.py`, which stitches properly, and compare.
- **A clipped or saturated reading is a floor, not a value.** Never rank two saturated rungs.
- **State the shooter TEAM.** Damage needs an enemy team or the shot is discarded with no `$HIR`. Not
  strictly needed for a receiver-only count, but it matters the moment the headset witness is in play.
- **Do not advance an operator-in-the-loop sweep on a timer.** Wait for Tony to say the rung is done.
- **Record a refuted rung as loudly as a confirmed one.**

## 8. Stopping rule

Stop the ladder if rung 2 (t2 = 13) and rung 3 (t2 = 5) are both indistinguishable from rung 1 at the margin — run the closing
control, then spend the time on §6 and on Q16 divergence (0/10/20/30/40/50° at 3 m), which is the
physical route to the same goal. Stop and fix if the closing control does not reproduce the opening
one. Do not pass 90 minutes; unfinished rungs become FOLLOWUPS rows as written.

## 9. Safety

- **Never end a run on a bare `$CLEAR`** — it wipes the `$SIR` table and the next session gets a gun
  that silently ignores every hit while reporting healthy (F11). End with `bench_common.teardown_frames()`.
- Panic is `$CLEAR,*` then `$SP,99,*`, and it leaves the gun unhittable. Re-ARM and land a hit before
  trusting anything after a panic.
- **Never open the Callsign app on our guns** — it wipes `$NAME`.
- `$WEAP` and `$GSET` are both on the known-safe list; nothing here needs `confirm`.

## 10. Write-up — the three writes, same evening

1. **`experiment-log/2026-09.md`**: `### 2026-09-07 (bench, Mac) — SUPER INDOOR: <verdict in one line>`.
   Method (mac ports, hub yes/no, taped distance, how the margin was found, attenuator if any), the
   control pair, **one table row per rung** (t2, shots, detected, decoded, decode%, headset flashes,
   overflow), the closing control, and the verdict on the indoor half of F231.
2. **`FOLLOWUPS.md`**: strike or rewrite **Q15**, **§9 bench 2.1**, and **`weapon-design.md` §5 U2** —
   they are three statements of the same open question and should close together. All three are
   written around t41, which 2026-09-17 answered as a null outdoors; **this sheet supersedes them**,
   so make them agree on t2. If Q16 divergence data got taken, feed it to 2.4.
3. **`HANDOFF.md`**: replace, do not stack. Update the t2 and t41 rows in `protocol/brx-protocol.md`
   with the indoor numbers (both left that file's "unknown or unverified" list on 2026-09-17) and,
   **only if confirmed**, promote
   the fact into `manual/operate.md` → *Indoor vs Outdoor Mode* per `manual/README.md`
   (**no em dashes in `manual/`**).

## 11. If it works — what gets built (do NOT build it at the bench)

A third venue value beside `indoor` / `outdoor` — `indoor_tight` — resolved the way
`compile.play_volume()` resolves volume, writing a lower t2 across every weapon in the compiled
bundle. **Most of the plumbing now exists**: `compile.gun_range_outdoor_pct()` already writes t2 from
`wire.range_outdoor_pct` at an outdoor venue and refuses a value under 13 (F234). So the work is a
third `environment` value in `spec/contracts.md`, `PUT /api/config` validation, the MC venue picker,
and a decision on whether the indoor value is per-weapon or one venue-wide master. It touches **no
weapon balance** — t2 is 100 on every captured gun and is deliberately not a stats bar in any UI.
Bring the numbers home first; the build is a WSL session.
