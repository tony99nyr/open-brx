# Bench plan: every open bench step, and the desk work that gates it

Updated: 2026-09-24. **Open this file first at the bench.** How a live bench run works with Tony (who drives
the tools, the "1" reply, the recorder at the end): the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md).

This file holds the ORDER only. Each step points to the sheet section or the FOLLOWUPS row that holds the procedure.
Do not copy a procedure into this file. When a sitting ends, strike its steps here (the skill's close, step 4).

Rules for every sitting: the preflight in [`gotchas.md`](gotchas.md) ("Before a bench session", which holds the rig
check), `$VOL,65`, and never end on a bare `$CLEAR` (F11). Close every
sitting with the three writes in [`README.md`](README.md) ("Session close is three writes").

## Equipment key

- **2 guns**: shooter A and victim B, armed as in [levers "Roles and arming"](bench-firmware-levers-2026-09-19.md#roles-and-arming).
- **Rig**: the ESP32 IR rig (board A receiver COM7, board B emitter COM8).
- **Outdoor**: a range of 25 m or more, in shade.
- **Ears**: Tony listens and judges a sound.
- **Phones + MC**: both Pixels and Mission Control, for a real match.

Short names: **levers** = [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md),
**screamers** = [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md).

## Done: do not re-run

Levers session 1 ran in three sittings on 2026-09-18 (the log's three "firmware levers session 1" entries):
§1 runs a-e, §4 step 1, §5 (all, including the shield flag and the sound token), §6 step 4 and §10 fn 34 (both
answered by §16), §12 steps 1 and 3 (answered by §23), §13 step 1 and step 3 (magnitudes 1-39), §16 steps 1-3 and
6.1-6.2, §18, §19 step 15 (answered by F71 and F263: one Shotgun pull sends two words), §21 steps 1-10 and 15-18 (t4,
t5, t6, t7, t8, t9), §22 steps 1-6, and §23 (all five steps). Screamers A1 and A2. F276 (the Shotgun words). The whole perks sheet
([`bench-perks-2026-09-18.md`](bench-perks-2026-09-18.md), §1-§8). F230 closed, so levers §19 step 18 is dropped.

**Pre-game check, run 2026-09-19 (Saturday morning office test).** Tony installed the 0.4.0-0.4.2 APKs across the
session. Levers §1 run f (a real TDM through Mission Control with two guns) **PASSED**: cross-team hits
registered on both sides, closing F206's last open gate. The spawn-protection check found a real bug instead of
confirming the design: on 0.4.2 a hit landed damage 0.73 s after a respawn even though the same window blocked
other hits cleanly. That result, plus a shooter seeing a protected player flash "hit" with no damage and a
respawner firing while still protected, drove the 0.4.3 respawn-profile rebuild the same day (F121/F209 closed,
superseded). See `docs/experiment-log/2026-09.md` (2026-09-19 pre-game entry) for the full write-up.

## Sittings, in priority order

### Next sitting: [`bench-2026-09-24.md`](bench-2026-09-24.md) (MUST: about 4 h 30 min in three setups)

**Block 0 (preflight), Block 1 (F297/F293 connect reliability), Block 1.4 (the F293 fix re-check, PASS except
step 5), and Block 3.1-3.3 (F308: release order, fire intervals; S58: pickup slots, buttons, overshield) are
DONE, 2026-09-24** (see the experiment log's 2026-09-24 bench entry). Step 1.3 was not needed as a planned step:
the loop was reproduced on demand, without a btsnoop capture. Step 1.4's step 5 (a headset power-cycle
mid-match) did not run, since it needs MC; it moves into Block 4 below. **The next sitting starts at Block 4.**
S58's 3.3 open items: 4.11's RSSI pickup-range calibration (not run), item 7's untested hits-draining-the-shield
and dead-gun `$LIFE` mode-2 cases, item 4's reload-targets-last-slot-fired confounder, and item 8's `$BMAP,0,0`
weapon-reset confounder, both needing a disassembly read rather than a bench re-run. What remains otherwise: the
rest of F308's bench items in `docs/weapon-design.md`'s Balance rules table, the screamers transport steps A4,
A7, A7b, A7c and A8 with `raw-bytes` (F269/F270), the native kill word and the R4 readings (Block 2b:
F320-F322), S56, F292, F298, F296, F309, F293's step 5 (the mid-match headset power-cycle), F275
outdoors, S48's super-indoor grid in Tony's house, and S57's IR callout bus, with the 0.4.6 loop (Block 4.0).
Its sitting plan orders them: MUST sittings A-C, a stop point, then LATER by setup.

### Sitting 1: screamers Phase A, transport half (about 55 min; 1 gun, a laptop)

Screamers are P0. Screamers A1c (the nonblocking loop control, **F272**), A3, A5, A6, A11, A12; A4, A7, A7b, A7c and A8 run in the runbook's Block 2. A7 and A8 give the block-pacing
numbers (**F269**, **F270**); a lock-up feeds **F272**. Keep the block pause off until A7 and A8 give a number.
A3 repeats A1 on other channels and can lock the gun: power-cycle and re-arm before the next step.

### Sitting 2: the rest of levers session 1 (about 100 min; 2 guns, ears, the rig for steps 8 and 9)

1. Levers §21 step 19, `$TMP` t10 crit chance, including the same-value re-send control (10 min). **S50**, **F285**.
2. Levers §21 step 11, and one run that asks whether t9 applies per slot or once for every slot (10 min). Extended
   Mags on `$TMP` waits on this. **S50**.
3. Levers §21 steps 12-14, t1-t3 pool maxima, repeating each same non-zero write before the second read (15 min). **S50**, **F285**.
4. `$TMP` t6 re-send: send t6 = 50 twice, then time one reload (5 min; method in the row). **F285**, **F281**.
5. Complete the F285 table: repeat same non-zero t5 and t7 writes and compare fire timing/damage; for t11 first
   prove the missing-row default sound, then write two distinct ids and identify which one plays (15 min). **F285**.
6. Levers §12 step 2 (does `$STOP` gate the trigger?), then §4 step 2 (a `$SIR` p5 stun on hit) (10 min). **U11′**.
7. **F262**: the shield-hit sound by sensor, ten shots at the headset and ten at the gun body (10 min, ears).
8. Levers §2, melee (15 min; `$BMAP,8,7` and `$BMAP,8,4`; step 4 needs the rig). **K4**.
9. Levers §16 step 6.3: does `$CLEAR` stop a headset `$IRTX` loop? (5 min, the rig). **S57**, **B23**.
10. **F282**: the compiled Suppressor against the compiled AR in a dark room: does either flash, and which is quieter?
   Then `$WEAP` t25/t26 at 0 and at a large value on one weapon (10 min; eyes, ears; method in the row).

### Sitting 3: the recoil numbers, groups A and B (about 30 min; 2 guns on a fixed mount)

Levers §26 groups A and B, pinned with `$TMP` t4 (§21 answered how; see "If §21 moves the mechanism"): the
measured recoil numbers behind the shipped rungs. Groups C, D, E and F go into sitting 8.

### Sitting 4: screamers Phase A, IR half (about 50 min; 1 gun, the rig)

Screamers A8b, A9, A10, A13. A13 gives the per-gun traffic budget (**F274**). A13 replays the shipped recoil writer,
which writes `$TMP` t4 only (S55, shipped).

### Runbook Block 2b: the native kill word and the R4 readings (70 min, plus 20 optional)

The old sittings 4a and 4b. Kit: 2 guns and their headsets, the rig, a laptop and a camera, plus Phones + MC for
the hosted trials. The procedure is [Block 2b of `bench-2026-09-24.md`](bench-2026-09-24.md): native
Death Match kills N1-N3, and the short R4 checks (**F320**, **F321**, **F322**, fn 36/37 on domes 1-3, fn 18/22 on
an enemy, the stored-ID compare, native Survival and FFA). The hosted trials H1-H3 ride on Block 4.2's kills, so
they need both Pixels and Mission Control. Do not send `$AS,1`.

### Sitting 5: match verification (about 60 min; 2 guns, Phones + MC, film)

Levers §1 run f (F206's proof) **already ran and passed**, 2026-09-19; do not re-run it here.
1. **F264** in a live match. If a gun stalls, send `$LIFE,<hp>,0,0,1,*` then `$HLED,,6,*` BEFORE any force respawn,
   and watch for a trigger answer. The row holds the gate.
2. Levers §22 step 7: reproduce the timed-out partial reload on the Energy Rifle. **F277**.
3. **F237** (a slow Pixel 5 re-pick): the row holds its repro.
4. The stun cue: hit a player with the EMP and listen for `X17` on the victim's gun (commit `273e949a`; FOLLOWUPS §9).
5. The shield recharge cues on the Shields preset (**S29**: `N101`, `N102`, `VA6Y`, `N74`). If the runbook's Block 4.6
   already ran the Shields preset in a match, do not re-run it here; note the result instead.

### Sitting 6: levers session 2 (two sittings; 2 guns, the rig for §9 step 5)

- 6a (about 50 min): §3 `$BHIT`, §6 steps 1-3 (**S29**), §7 (**S50**), §8 the fuse; use the levers sheet as the procedure source.
- 6b (about 40 min): §9 the crit bonus (**S50**), §10 fn 35, 38, 30, 33, 50-52 (**U11′**), §15 a headless gun (**B26**).

### Sitting 7: levers session 4, the IR rig (two sittings; 2 guns, the rig)

- 7a (about 50 min): §11 splash, §16 step 4 (field 4 = 1) (**B23**), §17 station words (**B23**).
- 7b (about 45 min): §20 indoor half (**S48**, **Q15**), §24 the proc block (**F63**). §13 steps 2 and 3
  (magnitudes 40-63) are optional now (**S57**).

### Sitting 8: the recoil numbers, groups C to F (about 35 min; 2 guns, Phones + MC)

Levers §26 groups C, D, E and F, on the phone's node. The rung basis is settled (S54, `aa7b08b9`); the rungs to
expect are the recoil table in `spec/node.md` §3.15.

### Sitting 9: levers gap sweep (two sittings; 2 guns, the rig for two steps)

- 9a (about 45 min): §19 steps 1-9.
- 9b (about 40 min): §19 steps 10, 11, 14, 16 and 17. Step 17 (`$AS,4`) runs only after sittings 1 and 4. Steps 12
  and 13 moved to §21 and §22; step 15 is answered (F71, F263; the emitter and its reach are F275, sitting 10); step
  18 is dropped.

### Sitting 10: outdoor (about 60 min; 2 guns, outdoor, the rig or the S49 receiver)

**F275** (the `t13` ladder: where the headset word stops arriving). Then the outdoor half of levers §20. Then **F171**
and **F195** (aim tolerance in degrees) if time allows. ⚠ F254 is CLOSED (the eleven-row `$SIR` table). The outdoor
headset-word row was F254 before its renumber and is F275 now.

### Unattended and long runs (no sitting)

- **Screamers Phase C** runs 1-4, 2 h each, one gun and a laptop (now unblocked with `soak --phone-pacing` built). Run 3 soaks the `$TMP` t4 recoil writer (S55, shipped).
- **Screamers Phase D** (3 h, all guns, Phones + MC, the rig), after the Phase B rules are built.
- **Screamers Phase E** (20 min), after the lock-up detector (**F272**) passes its bench validation.

### Backlog (no fixed order; pick by setup)

- [`bench-sticks3-2026-09-23.md`](bench-sticks3-2026-09-23.md): the M5StickS3 gates, gate 2 (IR receive, **F314**) first.
  Kit: a Stick, the rig, a laptop, one gun for gates 4 and 5.
- [`bench-grenade.md`](bench-grenade.md) "Still to run": B0 first, then X, Z1-Z3, D, B, E, F (C is answered).
- The unrun rungs of [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) that the table below does not mark as
  moved. Do not run BQ-A2 (`$AS,1`): it starts a native game, a screamer path.
- FOLLOWUPS §9 rows with their own method and no sheet: F164, F167, F168, F169, F183, F232.

## Desk work (no gun)

The HANDOFF lanes point here. Each item names its row, its lane, and what blocks it.

| row | lane | the work | blocked by |
|---|---|---|---|
| **F300** | levers and screamers | decode the remaining `$QUERY` sound/gyro/per-slot loop before extending arming read-back | stock-image/capture decode |
| **F269** | levers and screamers | switch the block pause on, and decide the runt `$SIR` rows | sittings 1 and 4 (A7, A8, A8b) |
| screamers Phase B: **F270**, plus one new row per trigger that Phase A reproduces | levers and screamers | one rule in code per reproduced trigger (write with response; the `$PB*`/`$AS` deny list) | sittings 1 and 4 |
| **F285** | levers and screamers | desk table is done; replace its UNMEASURED cells only from recorded bench results | sitting 2 steps 1, 3-5 |
| **F274** | playtest and node | measure the recoil writer's BLE write budget and complete the hardware soaks | A13 and the three two-hour hardware runs; S55 is shipped |
| **F277** | playtest and node | a detector for a reload that never completes | sitting 5 step 2 (a repro) |
| **F281** | weapons and perks | move Quick Hands onto `$TMP` t6 in one piece, or not at all | sitting 2 step 4 (t6 absolute or additive) |
| **S50** | weapons and perks | Extended Mags on `$TMP` t9 (one write per life, after `$SPAWN`, then an `$AMMO` fill) | sitting 2 step 2 (per slot or not) |

## Preconditions (build these first)

| tool or change | blocks | row |
|---|---|---|
| Screamers Phase B rules in code | Phase D | after sittings 1 and 4 |
| The lock-up detector's bench validation (built) | Phase E | F272 |
| Block pacing switched on, at the A7/A8 values | Phase C and D results that count | F269 |

## Which sheet owns what

| sheet | status | owns |
|---|---|---|
| [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md) | live | claims 1-27, §1-§26 |
| [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md) | live, P0 | the screamers: Phases A-E (A1, A2 done) |
| [`bench-perks-2026-09-18.md`](bench-perks-2026-09-18.md) | history | every section answered 2026-09-18 |
| [`bench-sticks3-2026-09-23.md`](bench-sticks3-2026-09-23.md) | live | the M5StickS3 bring-up gates (**F314**, H7); run with the `m5stick-bench` skill, no fixed sitting |
| [`bench-grenade.md`](bench-grenade.md) | open, backlog | the grenade and hill rungs |
| [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) | superseded as the order | the method of its unrun rungs. Moved: BQ-C2 answered (perks §1); BQ-C3 is levers §24; BQ-D2 is levers §2; BQ-D6 is levers §10; BQ-C8 is levers §19 step 11 |
| the 2026-09-05 flash-control, 2026-09-07 super-indoor and 2026-09-11 critical sheets | history | archived 2026-09-24: grep only. Critical: BC-A2 is levers §21 step 16 (done) plus grenade Z1; BC-B3 is grenade X; BC-C1 is levers §6; BC-C2 is answered (perks §2). Super-indoor: Q15; Tony defined S48 on 2026-09-23, and its sweep is Block 6 of the runbook. Flash-control: L1-L9 answered; BQ-D8 cites its rungs 9-10 |
| [`capture-runbook.md`](capture-runbook.md) | method | how to take a capture; no status |
| the 2026-09-13 runbook and the 2026-09-17 weapons sheet | history | already archived: grep only, open no step from them |
| [`FOLLOWUPS.md`](FOLLOWUPS.md) §9 | register | the ids; this plan is the order |

## Decisions for Tony

| decision | what it blocks |
|---|---|
| The ALT indoor/outdoor wording in `manual/fix.md` "IR isn't registering hits" step 4. The page says the field test found no emitted-range change, but V4_31 shows the mode sets emitter power (F171) | no sitting; a manual edit |
