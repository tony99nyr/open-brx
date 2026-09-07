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

- **`$WEAP` token 41 `gunRangeIndoor`** reads **75 on all eighteen guns and 20 on melee**
  (`manual/06-developer.md` t41 row). Melee at 20 is the encouraging part: 20 on a weapon that must
  only reach arm's length is what a real range-percent should look like.
- **There is one prior positive** (`weapon-design.md` §5 **U2**, 2026-08-26): **t41 = 100 killed at
  max indoor distance**; the **t41 = 5 zeros were CONTAMINATED by rig degradation** and do not count
  as a negative. So the direction is plausible and the job is a clean, controlled repeat.
- **`$GSET` token 3 `gunLaserRegion`** (captured `1`) is the regional IR power limit — the second
  lever, one token, two minutes. We hardcode `1` in `mc/compile.py` and `gameconfig.py`.
- **`$IRTX` and `$HFIRE` are dead ends.** They carry literal `iRPower` / `rangeIndoor` fields and
  produced **zero IR** on v4.32 across five shapes each, with a receiver control passing either side.
  Do not spend the session there.
- **t41 is only live in INDOOR mode** — `$GSET` token 2 (`outdoorMode`) selects the profile. Keep it
  `0` for every rung. `bench_common.GSET` already does.

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

**Find the margin before you sweep.** At point-blank, t41 = 5 and t41 = 100 will both read 100% and
you will learn nothing — that is the shape of a threshold measurement. So:

1. Tape a mark, put the receiver on it, aimed and fixed.
2. At **stock t41 = 75**, walk back until `decode_rate` sits around **50–80%**. That is the working
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
   battery is a power variable we cannot separate from t41.
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

Only t41 changes. Same weapon (the bench AR), same distance, same rest, same aim point.
**After every `$WEAP` re-push, re-send `$AMMO`** — a re-push resets mag and reserve to the frame's
baked-in values (U9).

| # | t41 | why |
|---|---|---|
| 1 | **75** | **opening control** = stock. Records the baseline detect%/decode% at the mark. |
| 2 | **5** | **the extreme, tested second on purpose.** If 5 is indistinguishable from 75, no middle value will differ and the ladder stops here — that is an efficient null, and a null is an answer. |
| 3 | **100** | does it go **up**? Cheap, and it repeats U2's one prior positive under control. |
| 4–7 | **50 · 30 · 20 · 10** | only if rung 2 moved. Shape the curve: linear, stepped, or a cliff. **t41 = 20 is melee's value — predict arm's-length range.** That prediction landing is strong confirmation. |
| 8 | **75** | **closing control.** It must reproduce rung 1. If it does not, the rig drifted and **every rung between them is void** — that is exactly what spoiled U2, so do not skip it. |

**Rung 9 (2 min, if anything moved):** re-push a new t41 **mid-life without respawning** and fire
again. Does the gun read t41 at `$WEAP` time or at fire time? Decides whether a super-indoor preset
can be switched during a match or only at arming.

## 6. Lever 2 — `$GSET` token 3 `gunLaserRegion` (10 min, run regardless of the outcome above)

Same mark, same rest, same everything, t41 back to stock 75. Sweep **`$GSET,0,0,<0|1|2>,0,1,0,50,1,*`**
— that is token 3 = 0, then 1 (control, the captured value), then 2. 10 shots each, closing control at
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

Stop the ladder if rung 2 (t41 = 5) is indistinguishable from rung 1 at the margin — run the closing
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
   control pair, **one table row per rung** (t41, shots, detected, decoded, decode%, headset flashes,
   overflow), the closing control, and the verdict on U2 and Q15.
2. **`FOLLOWUPS.md`**: strike or rewrite **Q15**, **§9 bench 2.1**, and **`weapon-design.md` §5 U2** —
   they are three statements of the same open question and should close together. Note §9 2.1 says
   "100 → 5 → 100" and Q15 says "75 → 30 → 20 → 10 → 75"; **this sheet supersedes both**, so make them
   agree. If Q16 divergence data got taken, feed it to 2.4.
3. **`HANDOFF.md`**: replace, do not stack. Also add the t41 row to `protocol/brx-protocol.md` (it is
   currently in the "unknown or unverified" list at the end of §6) and, **only if confirmed**, promote
   the fact into `manual/02-operation.md` → *Indoor vs Outdoor Mode* per `manual/README.md`
   (**no em dashes in `manual/`**).

## 11. If it works — what gets built (do NOT build it at the bench)

A third venue value beside `indoor` / `outdoor` — `indoor_tight` — resolved the way
`compile.play_volume()` resolves volume, writing a lower t41 across every weapon in the compiled
bundle. The plumbing is cheap: **t41 passes through byte-for-byte from the captured frames today**
(only tokens named in each weapon's `wire` block are overwritten), so it is a new override token plus
the `environment` enum in `spec/contracts.md`, `PUT /api/config` validation, and the MC venue picker.
It touches **no weapon balance** — t41 is identical on all 18 guns and is deliberately not a stats bar
in any UI. Bring the numbers home first; the build is a WSL session.
