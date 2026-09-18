# Bench plan: every bench test, in one order

Updated: 2026-09-18. **Open this file first at the bench.** It holds the order only. Each step points to the sheet
section or the FOLLOWUPS row that holds the procedure. Do not copy a procedure into this file.

Rules for every sitting: the preflight in [`gotchas.md`](gotchas.md) ("Before a bench session"), `$VOL,65`, and never
end on a bare `$CLEAR` (F11). Run `loopback.py COM8 COM7 6` before any sitting that uses the IR rig. Close every
sitting with the three writes in [`README.md`](README.md) ("Session close is three writes").

## Equipment key

- **2 guns**: shooter A and victim B, armed as in [levers "Roles and arming"](bench-firmware-levers-2026-09-19.md#roles-and-arming).
- **Rig**: the ESP32 IR rig (board A receiver COM7, board B emitter COM8).
- **Outdoor**: a range of 25 m or more, in shade.
- **Ears**: Tony listens and judges a sound.
- **Film**: a phone films the gun or the HUD.
- **Phones + MC**: both Pixels and Mission Control, for a real match.

## Sittings, in priority order

Short names: **levers** = [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md),
**screamers** = [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md),
**perks** = [`bench-perks-2026-09-18.md`](bench-perks-2026-09-18.md).

### Sitting 1: the most critical (about 65 min; 2 guns, ears)

1. **F276 Shotgun words** (10 min): FOLLOWUPS F276, the four bench steps. Hand-build the 20/20 frame first (the
   catalogue now ships 21/19). Order: 20/20, then 21/19, then the 45/70 control, then one emitter alone.
2. **Screamers A1 then A2** (10 min): the `$DPLAY` hang loop and its control. A1 can lock the gun: power-cycle and
   re-arm before step 3.
3. **Levers §1, runs a-e** (15 min): F206, the team byte. Run f needs Phones + MC; it moves to sitting 9.
4. **Levers §18, then §22** (20 min): reply decodes, then the dead-gun probe, including §22 step 7 (the second F264
   stall). §22 step 6 is also the §13 step 1 reading (`$DD`). The F264 auto-cure design reads these results.
5. **Levers §21 steps 1-3** (10 min): `$TMP` t4 accuracy, and the smoke collision.

### Sitting 2: screamers Phase A, transport half (about 55 min; 1 gun, a laptop)

Screamers A3, A4 (run as levers §25), A5, A6, A7, A8, A11, A12. A7 and A8 give the block-pacing numbers
(F269, F270). Keep the block pause off until they exist.

### Sitting 3: the `$TMP` system (about 55 min; 2 guns)

Levers §21 steps 4-19. Then levers §26 (the recoil numbers), if it is on main (see Preconditions).

### Sitting 4: rest of levers session 1 (about 50 min; 2 guns, the rig for the last step)

Levers §2 (melee, K4), §4 steps 1-2, §5 (all steps, in order), §12, §16 step 6 (the looped headset word; needs the rig).

### Sitting 5: perks leftovers (about 45 min; 2 guns, ears)

Perks §2 (armour-harder function), §4 (Charge Rifle tap cadence), §5 (stim write against a reload), §7 (the two ear
items). Then FOLLOWUPS F262 (shield-hit sound per sensor, ten shots each side).

### Sitting 6: screamers Phase A, IR half (about 50 min; 1 gun, the rig)

Screamers A8b, A9, A10, A13. A13 gives the per-gun traffic budget for F274.

### Sitting 7: levers session 2 (two sittings; 2 guns, the rig for §9 step 5)

- 7a (about 50 min): levers §3, §6, §7, §8, §9.
- 7b (about 40 min): levers §10, §15, §23. Run §23 only after §12 and §21 have results.

### Sitting 8: levers session 4, the IR rig (two sittings; 2 guns, the rig)

- 8a (about 55 min): levers §11, §13 steps 2-3, §16 steps 1-5.
- 8b (about 45 min): levers §17, §20, §24.

### Sitting 9: match verification (about 45 min; 2 guns, Phones + MC, film)

Run after the playtest fixes land. Levers §1 run f (F206 end to end). The F264 auto-cure in a live match. F265
(scoreboard freeze), F261 (adopt from a fresh MC), F257 (charge weapon HUD), F256 (coverage line): each row holds its
repro. The shield recharge cues (S29: `N101`, `N102`, `VA6Y`, `N74`) on the Shields preset.

### Sitting 10: levers gap sweep (two sittings; 2 guns, the rig for two steps)

- 10a (about 45 min): levers §19 steps 1-9.
- 10b (about 45 min): levers §19 steps 10-18. Step 17 (`$AS,4`) runs only after sitting 1 step 2 and sitting 2.

### Sitting 11: outdoor (about 60 min; 2 guns, outdoor, the rig or the S49 receiver)

FOLLOWUPS F275 (the `t13` ladder: where the headset word stops arriving; this was F254 before the renumber). Then
the outdoor half of levers §20. Then F171 and F195 (aim tolerance in degrees) if time allows.

### Unattended and long runs (no sitting; a laptop and one gun, or all guns)

- **Screamers Phase C** runs 1-4, 2 h each. A run counts only with `soak --phone-pacing`. Run levers §21 before run 3.
- **Screamers Phase D** (3 h, all guns, Phones + MC, the rig), after the Phase B rules are built.
- **Screamers Phase E** (20 min), after the lock-up detector (F272) is built.

### Backlog (no fixed order; pick by setup)

- [`bench-grenade.md`](bench-grenade.md) "Still to run": B0 first, then X, C, Z1-Z3, D, B, E, F.
- The unrun rungs of [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) that the table below does not mark as
  moved. Do not run BQ-A2 (`$AS,1`): it starts a native game, a screamer path.
- FOLLOWUPS §9 rows with their own method and no sheet: F164, F167, F168, F169, F183, F232.

## Preconditions (build these first)

| tool or change | blocks | owner |
|---|---|---|
| `soak --phone-pacing` in `mcp/brx_mcp/soak/runner.py` | every screamers Phase C run | not built |
| Levers §26 (the recoil numbers) ported to main | §26 in sitting 3 | brx-latest-playtest |
| The F264 auto-cure (`$QUERY` probe) committed | sitting 9, F264 | brx-latest-playtest; its design waits for sitting 1 step 4 |
| A detector for the second F264 stall (empty magazine after a timed-out reload) | sitting 9 | no FOLLOWUPS row yet |
| Screamers Phase B rules in code | Phase D | after sittings 1, 2 and 6 |
| The lock-up detector (F272) on the phone and in MC | Phase E | not built |
| Block pacing (F269) switched on, at the A7/A8 values | Phase C and D results that count | off until sitting 2 |

## Which sheet owns what

| sheet | status | owns |
|---|---|---|
| [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md) | live | claims 1-27, §1-§25 (§26 pending) |
| [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md) | live, P0 | the screamers: Phases A-E |
| [`bench-perks-2026-09-18.md`](bench-perks-2026-09-18.md) | live | §2, §4, §5, §7 only; §1, §3, §6 answered; §8 moved to F276 |
| [`bench-grenade.md`](bench-grenade.md) | open, backlog | the grenade and hill rungs |
| [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) | superseded as the order | the method of its unrun rungs. Moved: BQ-C2 answered (perks §1); BQ-C3 is levers §24; BQ-D2 is levers §2; BQ-D6 is levers §10; BQ-C8 is levers §19 step 11 |
| [`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md) | superseded | BC-A2 is levers §21 step 16 plus grenade Z1; BC-B3 is grenade X; BC-C1 is levers §6; BC-C2 is perks §2 |
| [`bench-super-indoor-2026-09-07.md`](bench-super-indoor-2026-09-07.md) | parked | Q15. The range lever is a carrier frequency (levers §20), so the sheet waits for Tony's S48 decision |
| [`bench-flash-control-2026-09-05.md`](bench-flash-control-2026-09-05.md) | history | L1-L9 answered. BQ-D8 cites its rungs 9-10 |
| [`capture-runbook.md`](capture-runbook.md) | method | how to take a capture; no status |
| the 2026-09-13 runbook and the 2026-09-17 weapons sheet | history | already archived: grep only, open no step from them |
| [`FOLLOWUPS.md`](FOLLOWUPS.md) §9 | register | the ids; this plan is the order |

## Decisions for Tony

| decision | what it blocks |
|---|---|
| S48: does "super indoor" mean less power, or a detuned carrier (levers §20)? | the super-indoor sheet (Q15) |
| The 180 s offline give-up policy for a phone. No FOLLOWUPS row holds it yet | the sitting 9 offline checks |
| The ALT indoor/outdoor wording in `manual/fix.md` "IR isn't registering hits" step 4. The page says the field test found no emitted-range change, but V4_31 shows the mode sets emitter power (F171) | no sitting; a manual edit |
| The toxin weapon design (S16). A decision, not a bench item | no sitting |
| F220: publish app 0.3.0 as a GitHub Release | no sitting |
