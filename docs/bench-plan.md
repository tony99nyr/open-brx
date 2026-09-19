# Bench plan: every open bench step, and the desk work that gates it

Updated: 2026-09-18 (night). **Open this file first at the bench.** How a live bench run works with Tony (who drives
the tools, the "1" reply, the recorder at the end): the [`bench-session` skill](../.claude/skills/bench-session/SKILL.md).

This file holds the ORDER only. Each step points to the sheet section or the FOLLOWUPS row that holds the procedure.
Do not copy a procedure into this file. When a sitting ends, strike its steps here (the skill's close, step 4).

Rules for every sitting: the preflight in [`gotchas.md`](gotchas.md) ("Before a bench session"), `$VOL,65`, and never
end on a bare `$CLEAR` (F11). Run `loopback.py COM8 COM7 6` before any sitting that uses the IR rig. Close every
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

## Sittings, in priority order

### Pre-game check (Saturday 2026-09-19)

Run this before the first sitting below.

1. Tony installs the 0.4.0 APK on every phone (`npm run android:install` per phone, or the `app-v0.4.0` release
   download).
2. Levers §1 run f: a real TDM through Mission Control with two guns.
3. One spawn-protection check in a real MC match: after a respawn, hits register with no damage until the first
   shot or about 2 s, then damage returns.

### Sitting 1: screamers Phase A, transport half (about 55 min; 1 gun, a laptop)

Screamers are P0. Screamers A3, A4 (run as levers §25), A5, A6, A7, A8, A11, A12. A7 and A8 give the block-pacing
numbers (**F269**, **F270**); a lock-up feeds **F272**. Keep the block pause off until A7 and A8 give a number.
A3 repeats A1 on other channels and can lock the gun: power-cycle and re-arm before the next step.

### Sitting 2: the rest of levers session 1 (about 85 min; 2 guns, ears, the rig for steps 7 and 8)

1. Levers §21 step 19, `$TMP` t10 crit chance (10 min). **S50**, **F278**.
2. Levers §21 step 11, and one run that asks whether t9 applies per slot or once for every slot (10 min). Extended
   Mags on `$TMP` waits on this. **S50**.
3. Levers §21 steps 12-14, t1-t3 pool maxima (15 min). **S50**, **F285**.
4. `$TMP` t6 re-send: send t6 = 50 twice, then time one reload (5 min; method in the row). **F285**, **F281**.
5. Levers §12 step 2 (does `$STOP` gate the trigger?), then §4 step 2 (a `$SIR` p5 stun on hit) (10 min). **F121**, **U11′**.
6. **F262**: the shield-hit sound by sensor, ten shots at the headset and ten at the gun body (10 min, ears).
7. Levers §2, melee (15 min; `$BMAP,8,7` and `$BMAP,8,4`; step 4 needs the rig). **K4**.
8. Levers §16 step 6.3: does `$CLEAR` stop a headset `$IRTX` loop? (5 min, the rig). **B31**, **B23**.
9. **F282**: the compiled Suppressor against the compiled AR in a dark room: does either flash, and which is quieter?
   Then `$WEAP` t25/t26 at 0 and at a large value on one weapon (10 min; eyes, ears; method in the row).

### Sitting 3: the recoil numbers, groups A and B (about 30 min; 2 guns on a fixed mount)

Levers §26 groups A and B, pinned with `$TMP` t4 (§21 answered how; see "If §21 moves the mechanism"). **F268**,
**F280**. Groups C, D, E and F wait until Tony settles the rung basis; they go into sitting 8.

### Sitting 4: screamers Phase A, IR half (about 50 min; 1 gun, the rig)

Screamers A8b, A9, A10, A13. A13 gives the per-gun traffic budget (**F274**). A13 replays today's `$WEAP` + `$AMMO`
recoil writer. If the writer has moved to `$TMP` t4 by then, replay the `$TMP` form as well.

### Sitting 5: match verification (about 60 min; 2 guns, Phones + MC, film)

Run it after the desk fixes for F265 and F261 land.
1. Levers §1 run f: a real TDM through MC, hits on both teams (F206, closed 2026-09-16; run f proves main's fix).
2. **F264** in a live match. If a gun stalls, send `$LIFE,<hp>,0,0,1,*` then `$HLED,,6,*` BEFORE any force respawn,
   and watch for a trigger answer. The row holds the gate.
3. Levers §22 step 7: reproduce the timed-out partial reload on the Energy Rifle. **F277**.
4. **F265** (scoreboard freeze), **F261** (adopt from a fresh MC), **F257** (charge weapon HUD), **F256** (coverage
   line), **F237** (a slow Pixel 5 re-pick): each row holds its repro.
5. The stun cue: hit a player with the EMP and listen for `X17` on the victim's gun (commit `273e949a`; FOLLOWUPS §9, F15 rung 9).
6. The shield recharge cues on the Shields preset (**S29**: `N101`, `N102`, `VA6Y`, `N74`).

### Sitting 6: levers session 2 (two sittings; 2 guns, the rig for §9 step 5)

- 6a (about 50 min): §3 `$BHIT` (**S16**), §6 steps 1-3 (**S29**), §7 (**S50**), §8 the fuse (**S16**).
- 6b (about 40 min): §9 the crit bonus (**S50**), §10 fn 35, 38, 30, 33, 50-52 (**U11′**), §15 a headless gun (**B26**).

### Sitting 7: levers session 4, the IR rig (two sittings; 2 guns, the rig)

- 7a (about 50 min): §11 splash, §16 step 4 (field 4 = 1) (**B23**), §17 station words (**B23**).
- 7b (about 45 min): §20 indoor half (**S48**, **Q15**), §24 the proc block (**F63**). §13 steps 2 and 3
  (magnitudes 40-63) are optional now (**B31**).

### Sitting 8: the recoil numbers, groups C to F (about 35 min; 2 guns, Phones + MC)

Levers §26 groups C, D, E and F, on the phone's node, after Tony settles the rung basis (**F268**, **F280**).

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

- **Screamers Phase C** runs 1-4, 2 h each, one gun and a laptop (now unblocked with `soak --phone-pacing` built). Run 3 soaks the `$TMP` form of the recoil writer once it exists.
- **Screamers Phase D** (3 h, all guns, Phones + MC, the rig), after the Phase B rules are built.
- **Screamers Phase E** (20 min), after the lock-up detector (**F272**) is built.

### Backlog (no fixed order; pick by setup)

- [`bench-grenade.md`](bench-grenade.md) "Still to run": B0 first, then X, C, Z1-Z3, D, B, E, F.
- The unrun rungs of [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) that the table below does not mark as
  moved. Do not run BQ-A2 (`$AS,1`): it starts a native game, a screamer path.
- FOLLOWUPS §9 rows with their own method and no sheet: F164, F167, F168, F169, F183, F232.

## Desk work (no gun)

The HANDOFF lanes point here. Each item names its row, its lane, and what blocks it.

| row | lane | the work | blocked by |
|---|---|---|---|
| **F272** | levers and screamers | the lock-up detector on the phone and in MC (poll with the bare `$LIFE,*`) | nothing. Gates Phase E |
| **F271** | levers and screamers | the `$QUERY` read-back after arming (team, player id, pools) | nothing |
| **F269** | levers and screamers | switch the block pause on, and decide the runt `$SIR` rows | sittings 1 and 4 (A7, A8, A8b) |
| screamers Phase B: **F270**, **F273**, plus one new row per trigger that Phase A reproduces | levers and screamers | one rule in code per reproduced trigger (write with response; the `$PB*`/`$AS` deny list) | sittings 1 and 4 |
| **F285** | levers and screamers | a per-token absolute/additive column for `$TMP` in `protocol/brx-protocol.md` | sitting 2 for t1-t3, t6, t10 |
| **S55**, then **F274** | playtest and node | one accuracy owner (never write t4 during a smoke, re-send when it ends, re-send after `$SPAWN` but not after a `$LIFE` revive), then move the recoil writer onto one `$TMP` t4 frame | S55 first |
| **B31** | playtest and node | the kill confirm: the victim's node sends a protocol-15 `$IRTX` through its own (dead) gun's headset | choose the IR design or the advert design (the row weighs both) |
| **F277** | playtest and node | a detector for a reload that never completes | sitting 5 step 3 (a repro) |
| **F256** | playtest and node | the coverage line | nothing |
| **F268**, **F280**, then **S54** | weapons and perks | settle the rung basis with Tony (the time-to-kill proposal), then wire the six recoil fields once | a decision (Tony). The floors are settled at 60 |
| **F281** | weapons and perks | move Quick Hands onto `$TMP` t6 in one piece, or not at all | sitting 2 step 4 (t6 absolute or additive) |
| **S50** | weapons and perks | Extended Mags on `$TMP` t9 (one write per life, after `$SPAWN`, then an `$AMMO` fill) | sitting 2 step 2 (per slot or not) |
| **S16**, **S53** | weapons and perks | the toxin tick clock in `app/src/engine.js` (all three decisions made), with the HUD poison and smoke tells | nothing; `engine.js` is shared with the playtest lane |

## Preconditions (build these first)

| tool or change | blocks | row |
|---|---|---|
| The desk fixes for F265 and F261 | sitting 5 | F265, F261 |
| Tony's rung basis for the recoil ladder | sitting 8 | F268, F280 |
| Screamers Phase B rules in code | Phase D | after sittings 1 and 4 |
| The lock-up detector on the phone and in MC | Phase E | F272 |
| Block pacing switched on, at the A7/A8 values | Phase C and D results that count | F269 |

## Which sheet owns what

| sheet | status | owns |
|---|---|---|
| [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md) | live | claims 1-27, §1-§26 |
| [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md) | live, P0 | the screamers: Phases A-E (A1, A2 done) |
| [`bench-perks-2026-09-18.md`](bench-perks-2026-09-18.md) | history | every section answered 2026-09-18 |
| [`bench-grenade.md`](bench-grenade.md) | open, backlog | the grenade and hill rungs |
| [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) | superseded as the order | the method of its unrun rungs. Moved: BQ-C2 answered (perks §1); BQ-C3 is levers §24; BQ-D2 is levers §2; BQ-D6 is levers §10; BQ-C8 is levers §19 step 11 |
| [`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md) | superseded | BC-A2 is levers §21 step 16 (done) plus grenade Z1; BC-B3 is grenade X; BC-C1 is levers §6; BC-C2 is answered (perks §2) |
| [`bench-super-indoor-2026-09-07.md`](bench-super-indoor-2026-09-07.md) | parked | Q15. The range lever is a carrier frequency (levers §20), so the sheet waits for Tony's S48 decision |
| [`bench-flash-control-2026-09-05.md`](bench-flash-control-2026-09-05.md) | history | L1-L9 answered. BQ-D8 cites its rungs 9-10 |
| [`capture-runbook.md`](capture-runbook.md) | method | how to take a capture; no status |
| the 2026-09-13 runbook and the 2026-09-17 weapons sheet | history | already archived: grep only, open no step from them |
| [`FOLLOWUPS.md`](FOLLOWUPS.md) §9 | register | the ids; this plan is the order |

## Decisions for Tony

| decision | what it blocks |
|---|---|
| **F268**, **F280**: the recoil rung basis (the time-to-kill proposal). The floors are settled at 60 | S54, sitting 8 |
| **S48**: does "super indoor" mean less power, or a detuned carrier (levers §20)? | the super-indoor sheet (Q15) |
| **F284**: the 180 s offline give-up policy for a phone (find its source first) | sitting 5's offline checks |
| The ALT indoor/outdoor wording in `manual/fix.md` "IR isn't registering hits" step 4. The page says the field test found no emitted-range change, but V4_31 shows the mode sets emitter power (F171) | no sitting; a manual edit |
