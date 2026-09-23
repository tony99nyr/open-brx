# Bench: verify the firmware findings (2026-09-19)

This sheet verifies, on our v4.32 guns, every claim that the 2026-09-18 analysis of Jay's Drive produced. It runs as
five sessions. Run them in order. Session 1 decides how much the rest is worth: if `$STUN` and `$BUMP` do nothing,
v4.32 has drifted from V4_30, and the later sessions shrink.

| session | time | needs | sections |
|---|---|---|---|
| 1. Core | 145 min | two guns, the IR rig for §16 step 6 | §1 (F206, confirms the shipped fix), §21 (`$TMP`, the native modifier system), §18 then §22 (the dead-gun probe), §2 (melee), §4 steps 1-2, §5 (all of it, one session: each step starts from the one before), §12 (`$STOP`/`$START`), §13 step 1, §16 step 6 (the looped headset `$IRTX`; with no rig, it moves to the top of session 4) |
| 2. Levers | 80 min | two guns, the IR rig for §9 step 5 | §3, §6, §7, §8, §9, §10, §15, §23 (spawn protection, after §12 and §21) |
| 3. Transport | see the screamers sheet | one gun, a laptop | §14 (now `bench-screamers-2026-09-19.md` Phase A), §25 (the `$*` parser reset, Phase A step A4) |
| 4. IR rig | 100 min | two guns, the ESP32 IR rig | §16 step 6 first if session 1 had no rig, then §11, §13 steps 2-3, §16, §17, §20, §24 |
| 5. Gap sweep | 90 min | two guns, the IR rig for two steps | §19 |

**Status, 2026-09-18 night.** Session 1 ran in three sittings. What is left of it, and every later session, is in one running order in [`bench-plan.md`](bench-plan.md). Do not plan from the session table above.

**Claim checklist.** Tick each claim in the experiment log as CONFIRMED, REFUTED or DIFFERENT (and how). A claim
reaches `docs/manual/` only when it is CONFIRMED here.

| # | claim (source) | § | status (2026-09-18 session 1) |
|---|---|---|---|
| 1 | One team byte; `$PSET` t2 overwrites `$TID`; our re-sent `$PSET` caused F206 (V4_31) | 1 | **CONFIRMED at the wire level** (runs a-e: run a reproduces F206 with 0 hits, run b fixes it with 6 hits and `$HIR` token 4 = 2). Run f, a real TDM through Mission Control, is still open. |
| 2 | Melee (t1 = 1) is emitted by the headset through `$IRTX`, at range t2; `$FIREX` fires a slot (sheets, V4_31) | 2 | **CODE-READ ONLY (v4.32, 2026-09-21): DIFFERENT/UNRESOLVED.** No `$MELEE` command name; `$BHIT` consumes one event byte; `$FIREX` consumes five fields, not one slot. The gyro-map-fire chain and emitter remain bench questions. |
| 3 | `$BHIT` injects a hit through the full `$SIR` path (V4_30, sheets) | 3 | **CODE-READ ONLY (v4.32, 2026-09-21): CONTRADICTED.** The corrected dispatcher consumes only token 1 as an event byte, not seven hit fields. Bench still decides runtime behaviour. |
| 4 | `$STUN,<ms>` stuns; `$SIR` p5 of 64 or more stuns on hit (V4_30) | 4 | **CONFIRMED.** A controlled redo (control 5/5 fired; `$STUN,6000,*` blocked the next two pulls, fired again at +6.08 s) shows a native timed stun of about 6 s. It is SILENT on the gun; the node must play the cue itself (`X17`, Tony's pick, matches BC's concussion-grenade entry). |
| 5 | `$BUMP,<amount>,<hp>,<armour>,<shield>,<sound>` cascades across pools (V4_30, sheets) | 5 | **CONFIRMED IN FULL (2026-09-18).** A negative amount takes armour first and overflows into HP; a positive amount heals HP first and overflows into armour; each of the hp/armour flags gates its own pool independently, and with both flags 0 the gun does nothing and sends no `$HP` reply at all (explains F65). **The shield flag and the sound token are now confirmed too**: the shield flag gates the shield pool the same independent way, a negative amount drains it first and cascades into whichever other selected pool is open, and the sound token plays the named id (silent when empty). |
| 6 | `$LIFE` token 4: 0 add, 1 set, 2 set past max; set revives a dead gun (V4_30, sheets, BC app) | 6 | **CONFIRMED for the revive half (2026-09-18, §16).** `$LIFE,30,0,0,1,*` (set mode) on a dead gun gave `$HP,30,0,0` twice, and a follow-up `$LIFE,*` read back 30: the gun is alive again, takes hits normally, AND fires (`$ALCD` moved on a trigger pull). The magazine survives the death (unchanged across it) and `$TMP` survives death plus this revive (unlike `$SPAWN`, which clears `$TMP`). The headset death flash does NOT stop on its own: send `$HLED,,6,*` after the revive. Tested only on a gun killed over BLE, not on a gun in the F264 stall state (dead on the gun, alive on the HUD); do not assume this recipe cures F264 without a separate bench run. |
| 7 | `$SPAWN,<n>` spawns with shield n (V4_30) | 6 | **CODE-READ ONLY (v4.32, 2026-09-21): CONTRADICTED.** The v4.32 branch consumes no argument; existing v4.32 bench/product evidence also starts shield at zero. The A/B bench check remains. |
| 8 | `$PRES` scales damage per cell; `$INVU` blocks damage (V4_30) | 7 | **CODE-READ ONLY (v4.32, 2026-09-21): UNRESOLVED.** Optimized adjacent-string references do not establish either handler; bench must separate zero-damage, filtering and no-op outcomes. |
| 9 | fn 24-27 are 5/4/3/2 s fuses; p5 is the cell the fuse fires (V4_30, sheets) | 8 | **BENCH DIFFERENT for fn 24; CODE-READ UNRESOLVED for the sequence.** On 2026-09-11 fn 24 generated persistent fake `$HIR` ticks about every 5.07 s until `$SPAWN`, with no pool damage. The v4.32 gun image only exposes `$SIR` forwarding, not the timer/effect owner. |
| 10 | The crit bonus is `$PSET` t6 (we ship 50), scaled by `$GSET` t7 (V4_31, sheets) | 9 | |
| 11 | fn 34/35 register on a dead gun; fn 38 halves HP damage; fn 30 back x2; fn 33 silent kill; fn 50-52 colour only (V4_30) | 10 | **CONFIRMED for fn 34 (2026-09-18, §16).** A `$SIR,14,0,NULL,34,,,,,*` row on a gun killed over BLE (`$HP,0,0,0`) still registered `$HIR` from an `$IRTX` type-14 revive beam. fn 35, 38, 30 and 33 untested this session. |
| 12 | `$SIR` p6/p8 make the victim re-emit the hit (splash) (V4_30, sheets) | 11 | **CODE-READ ONLY (v4.32, 2026-09-21): UNRESOLVED.** The gun-side `$SIR` path forwards values but contains no re-emit branch; the effect may live downstream. |
| 13 | `$STOP` closes and `$START` opens IR reception; the same flag gates the trigger (inferred); both clear `$GSET`'s app-mode flags (V4_30, V4_31) | 12 | **DIFFERENT (2026-09-18, §23 step 2).** `$STOP` blocks a hit's damage but not the `$HIR`, and it survives `$SPAWN`; `$START,*` plus a `$GSET`/`$TID` re-send reopens it. §12 step 2 (does `$STOP` gate the trigger?) is open. |
| 14 | The gun sends `$DD,<killer>,<team>` when it dies (Jay's code); a kill confirmation is a protocol-15 subtype-0 IR word (BC's UART sheet) | 13 | **REFUTED, both halves, for this gun.** A gun killed by one hit gave `$HP,0,0,0` then `$LCD,0,0,0,0,6,24`, with NO `$DD`. §13 step 3's sweep of protocol-15 magnitudes 1-39 found no native audible callout on any of them, though every one registered silently (fn 28 on `<15,0>`, team-gated). So the gun does not announce a kill on its own in app mode; Callsign's kill voice is an app-side `$PLAY`. The node must not build on `$DD`. **A DEAD gun still forwards a host `$IRTX` frame out through its headset and emits the exact word**, confirmed with a control (a dying gun itself emits no IR on death). So a protocol-15 word sent via `$IRTX` through the dead gun's headset IS a usable, silent, firmware-free carrier for a host-defined kill-confirm signal. |
| 15 | Split frames get lost; bursts overflow; `$DPLAY` on a loop sound hangs the gun (V4_31) | 14 (screamers sheet Phase A) | **PARTLY CONFIRMED.** A1: `$DPLAY,A10,4,*` got no `$PONG`, no reply and no audio, and the link dropped about 15 s later; it recovered on reconnect with no power cycle needed, so this is a partial screamer rather than a proven full lock. A2 control (`$DPLAY,U37,4,*`, one-shot) answered `$PING` at once. `$DPLAY` stays on the never-send list either way. |
| 16 | `$RADSK` every 4 s keeps a headless gun linked (Jay's code, V4_31) | 15 | **CODE-READ ONLY (v4.32, 2026-09-21): UNRESOLVED.** The name occurs in headset/native message machinery, but no clean inbound timer refresh was established. |
| 17 | `$IRTX` type 14 to a downed ally is a revive beam, read via fn 34 (BC app) | 16 | **CONFIRMED (2026-09-18, §16 steps 1-3).** A dead gun with `$SIR,14,0,NULL,34,,,,,*` registered `$HIR,4,14,1,2,1,0,0` from a live gun's `$IRTX,100,14,1,2,1,0,0,100,1,,0,*` (field 4 = the dead gun's own team), and `$LIFE,30,0,0,1,*` then revived it. A live or dead gun forwards a host `$IRTX` through its headset. Still open: step 4 (field 4 = 1) and step 6.3 (does `$CLEAR` stop a headset loop). |
| 18 | Protocol-15 station words: magnitude 6 respawn, 8 perk, 10 proximity, 50 capture (Jay's code) | 17 | **PARTLY BENCH-PROVEN; CODE-READ UNRESOLVED AS A SET.** Native magnitude 6 already revives a station-armed, same-team gun on one pulse (4/4); real hill traffic establishes magnitude 8 as its beacon and 50 as its capture event. The broader “perk,” proximity-10 and generic station meanings are not established. No v4.32 gun-side switch on 6/8/10/50 was found. |
| 19 | `$LCD` t3 = shield, t4 = slot; `$QUERY` t2 = team; `$VERSION` t3/t5 meanings (V4_30, BC app) | 18 | **CONFIRMED**, with a timing note: `$QUERY` on a dead gun returns `$LCD` at once, then the rest of the body about 2 s later with no trailing `*`, so `$QUERY` holds the gun's print loop busy for that long. |
| 20 | Every other open item the triage of FOLLOWUPS against the new sources found untested | 19 | |
| 21 | Range tokens set the IR carrier frequency: 38000 - 125 x (100 - range) Hz on the gun, 140 Hz steps on the headset; indoor/outdoor sets power (V4_31) | 20 | |
| 22 | `$TMP` works over BLE: t4 accuracy, t9 magazine, t1-t3 pool maxima, t8 damage taken, t5 fire interval, t6 reload time, t7 outgoing damage, t10 crit chance, each without a magazine reset; `$SPAWN` and `$CLEAR` zero it (V4_30, V4_31; fn 23 writes t4) | 21 | **CONFIRMED for t4, t8 and t9.** t9 (magazine) tops the clip up by clip x t9 / 100 RAW ROUNDS at once, and sets the reload cap to clip + t9; a re-send of the same t9 write adds again rather than replacing, so it wants one write per life. Whether t9 applies per slot or as one flat count across every slot is untested. ⚠️ **The `$AMMO` set mode ignores a t9 bonus**: `$AMMO,0,9,24,1,*` on a gun already carrying a t9 that raises the cap to 9 read back magazine 6, the base clip, not 9. So a t9-raised cap survives a reload but not an `$AMMO` set write; re-assert t9 after any `$AMMO` set. t4 drops `$ALCD` accuracy at once (absolute, not cumulative), holds with no walk-back, and leaves the magazine alone; a `$WEAP` push does not clear it either. t8 (incoming damage) at -50 and -100 both held: -100 took a `$HIR` and no damage at all. `$SPAWN,,*` zeroes t8, confirmed (two full-damage hits right after). **Last-writer-wins on t4 is CONFIRMED, with a second effect**: a controlled redo (fn 23 smoke, control run: accuracy 0 for about 6 s then 100 in one step; test run: `$TMP,,,,-30,...,*` 1.8 s into the smoke read 70 at +1.8 s and +4.5 s) shows the `$TMP` write cancels the active smoke AND the smoke's own ~6 s timer later resets t4 to 0 regardless, erasing the write. Rule for a single accuracy owner (S55): never write t4 while a smoke is active (about 6 s from a fn 23 `$HIR`); once it ends, re-send the owner's current value. **t5 (fire interval): CONFIRMED on a full-auto weapon.** On the bench AR (t14 = 100 ms), `$TMP,,,,,100,,,,,,,*` slowed a held-trigger burst from a round every 105 ms to a round every about 205 ms, matching `t14 × (100 + t5) / 100` exactly. On the Shotgun (shell-fed reload, t14 = 800 ms) a `$TMP` t5 = -50 write produced no `$ALCD` echo and no measurable change in fire spacing (800-840 ms both before and after). So t5 governs the automatic cycle but shows no effect on a shell-reload weapon's cycle. **t7 (outgoing damage): CONFIRMED.** `$TMP,,,,,,,50,,,,,*` on the shooter raised a 9-damage AR hit to 13 per `$HIR` (9 × 1.5, truncated); a control of 3 taps at 9 damage each preceded it. The word the victim receives already carries the scaled number, so t7 is applied by the shooter before the word leaves the gun. **t4 and the REAL hit rate: CONFIRMED.** At accuracy 100 (`$TMP` unset) a 20-round burst gave 20 `$HIR` of 9 (full connect); after `$TMP,,,,-50,,,,,,,,*` (`$ALCD` accuracy 50) a similar burst gave 7 `$HIR` of 9 from 17 rounds, 41%, matching the 2026-09-17 `$WEAP`-based reading (7/18 at 50-60). So `$TMP` t4 changes the real hit rate, not just the displayed number, and the recoil writer can move fully onto one 20-byte `$TMP` frame with no magazine reset and no `$AMMO` restore needed. **t6 (reload time): CONFIRMED (2026-09-18, §21 step 17).** Timed from the reload lever to the refill `$ALCD`: a control of 1784 ms became 2756 ms at t6 = 50, x1.55, close to the x1.5 prediction, and returned to 1800 ms at t6 = 0. An unexplained "disabled trigger" sound heard on the t6 = 50 run is recorded separately, not as a t6 effect. |
| 23 | A dead gun answers `$QUERY` with `$LCD` health 0, and answers a bare or all-zero `$LIFE` with `$HP,0,0,0` (bench 2026-09-09; V4_31; the 2018 BC app) | 22 | **CONFIRMED**, with the same `$QUERY` timing note as claim 19. Poll a gun's state with `$LIFE,*`; reserve `$QUERY` for a one-off correction. |
| 24 | Only `$CLEAR` zeroes the `$SIR` table; `$STOP` until spawn, then `$SPAWN,,*` and `$TMP` t8 = -100, protect a spawn with no fn-28 table (V4_30, V4_31) | 23 | **CONFIRMED, full §23 run (2026-09-18).** The `$SIR` `<0,0>` fn 1 row sent once at arm survived a `$SPAWN` with no re-send, and post-spawn hits (t8 back at 0) still landed for full damage. `$TMP` t8 = -100 after `$SPAWN` registered every hit as `$HIR` with no pool movement: spawn protection with no fn-28 twin table. **§23 steps 1-5 run clean (2026-09-18, third sitting) and add two refinements.** Step 2: `$STOP` blocks the pool effect of a hit but NOT the hit itself (`$HIR` still arrives, with no `$HP`), which refutes the sheet's "expect no `$HIR`" prediction on that point. Step 3: `$STOP` SURVIVES `$SPAWN` (a first attempt stayed blocked through `$SPAWN` + the t8 write + a t8 = 0 write, and only `$START,*` plus a `$GSET`/`$TID` re-send restored damage); the clean redo, from a live gun, confirmed the design as written (`$SPAWN,,*`, `$TMP,,,,,,,,-100,,,,*`, `$TID`, three hits registered at zero damage). Step 5 confirms the write order (`$SPAWN` zeroes any t8 written before it). **Design rule: anything that sends `$STOP` must send `$START` before the next life.** |
| 25 | `$WEAP` t7-t11 is a secondary-fire proc: t7 chance %, t8/t9 the `<proto,sub>` key, t10 damage, t11 crit % (V4_31) | 24 | |
| 26 | `$` resets only token 0 and the token index, so a frame sent after a lost `*` lands on stale tokens; a `$*` first clears them (V4_30) | 25 | |
| 27 | The headset loops a host `$IRTX` word by itself: field 9 = 100 loops for ever, 0 stops, field 10 = the period in ms (V4_31, headset V1_35) | 16 | **CONFIRMED (2026-09-18).** `$IRTX,100,15,1,1,5,0,0,100,100,1000,0,*` (field 9 = 100, field 10 = 1000 ms) to a live gun made the OTHER gun register the same `$HIR` once a second by itself, 8 times, with no further host frame; `$IRTX,...,0,0,100,0,1000,0,*` (field 9 = 0) stopped it at once, with nothing arriving in the next 5 s. The headset does emit a forwarded `$IRTX` on a live OR a dead gun (§13 step 3 addendum). |

Jay (LaserTagMods) shared his "Everything BRX" Drive on 2026-09-18. It holds the stock gun firmware image
**V4_30**, the closest image we have to our v4.32. A disassembly of that image shows several commands we
called "inert" and several we never knew. The 2018 Battle Company "Battle Royale" app sends some of them. **Nothing
below is proven on v4.32.** Each experiment asks one question: does v4.32 do what the V4_30 code says?

The claims come from reading code, so check the control before you believe a result:
- A null result counts only after the same setup has moved a pool with a plain fn-1 row.
- Read `$HIR` token 2 (the protocol) before you trust a hit. On 09-18, a Charge Rifle key that was still armed
  wasted one run.

Rules:
- Use `$VOL,65` on both guns.
- Cover the victim's gun sensor at close range (F228).
- Allow about 3 s between a tool call and the gun.
- Do not end on a bare `$CLEAR` (F11).
- **Power-cycle both guns at the end.** Some of these commands set state that `$CLEAR` may not reset
  (the team flag that `$INVU` sets, a headset `$IRTX` loop).

## Roles and arming

**A = shooter**, player 1, team 1. **B = victim**, player 2, team 2.

Arm B with the victim head from `bench-perks-2026-09-18.md` ("Roles and arming"). Arm A with that doc's bench
AR frame, with t6 left empty. The damage key is `<0,0>` and the magnitude is 9, unless a step says otherwise.

The victim head sets HP 999, armour maximum 0 and shield maximum 0. `$PSET` t3, t4 and t5 set the pool **maxima**
only. The pools fill at `$SPAWN,,*`. A `$PSET` re-send also rewrites the team byte (claim 1), so `$TID` must follow
it. A `$LIFE` shield grant stops at `$PSET` t5. The sections below use three recipes:

- **Re-arm B (h, a, s)** gives B HP maximum h, armour maximum a and shield maximum s. Send these frames to B:
  1. `$PSET,2,0,<h>,<a>,<s>,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*` (the victim
     head's row with new maxima).
  2. `$SPAWN,,*`. B now has HP h, armour a and shield 0.
  3. `$TID,2,*`.
  4. The `$SIR` row that the section needs. If the section names none, send `$SIR,0,0,,1,0,0,1,,*`.
- **Kill B**: re-arm B (9, 0, 0), then A hits B once (9 damage).
- **Respawn B**: send `$SPAWN,,*`, then `$TID,2,*`. B keeps the maxima of its last re-arm.

## 1. F206: the team is overwritten at spawn (15 min, red blocker, confirms the shipped fix)

Team games registered no hits while FFA games registered normally, and every hit in the F206 store shows
`shooter_team: 0`. The V4_31 disassembly gives a static root cause:
- The gun keeps **one team byte**. The outgoing IR word reads it, and the friendly-fire check compares against it.
- `$TID`, `$TEAM` and `$PSET` t2 all write that byte, so the last one sent wins.
- Before the fix, MC's head sent `$PSET` (t2 = 0), then `$TID`, so the gun was right after arming. But the phone
  wrote a fresh `$PSET` from `pset_pool` before every `$SPAWN` (`app/src/engine.js`, `_spawn()` and `_revive()`), and
  `gameconfig._pset` hard-coded t2 = 0. **So at go-live every gun became team 0.** With `$GSET` t1 = 0, every enemy
  hit then looked like a same-team hit and was dropped. FFA ships t1 = 1, so hits passed there.

The fix shipped on 2026-09-18 (`d0f4c729`): every `$PSET` carries the `$TID` team, and `$TID` follows every
`$SPAWN`. MC no longer produces the frame order of run a, so send runs a to e as hand-sent frames from the
instrument. Run f is the end-to-end check of the fix.

Keep `$GSET` t1 = 0 on both guns. For each run, send the frames in the order shown, then fire 3 shots at B. Record
whether B registers, `$HIR` token 4 (the shooter's team as B sees it), and `$QUERY` reply token 2 on both guns.

| run | order of team frames on each gun (A team 1, B team 2) | expect |
|---|---|---|
| a | `$PSET` t2 = 0, `$TID`, then `$PSET` t2 = 0 again, then `$SPAWN,,*` (what MC and the phone sent before the fix; hand-sent) | **no hits** (F206 reproduced) |
| b | as run a, but both `$PSET` frames carry the real team in t2 | hits, `$HIR` token 4 = 1 |
| c | as run a, then `$TID` again after `$SPAWN,,*` | hits |
| d | `$PSET` t2 = 0, `$TID`, `$SPAWN,,*` (no second `$PSET`) | hits: the control that shows `$TID` works when nothing overwrites it |
| e | run b, but both guns on team 1 | no hits: t1 = 0 still blocks a real same-team hit |
| f | a real TDM match armed by MC and the phones, with the F206 fix built in | hits on both teams: the fix works end to end |

**Reading.** Run a dead and run b alive confirms the root cause. Run f alive confirms the shipped fix (`_pset` and
`pset_frames` put the player's team in t2, and `$TID` is re-sent after `$SPAWN`). If `$QUERY` token 2 tracks the team,
MC can check every gun's team after arming.

## 2. Melee (K4, 10 min)

Three facts from the new material:
- The 2018 BC app puts melee in `$WEAP` **slot 7** and binds the swing with `$BMAP,8,7`. We use slot 4 and `$BMAP,8,4`.
- V4_30 has **no `$MELEE` command**. Our note that `$MELEE,255` returned `$BUT,4,0` may be a coincidence.
- The scoring readme says melee, shotguns and explosions leave through the **headset's** high-power IR LED, at
  about 80-85% range.

A fourth fact, from the V4_31 range trace: `$WEAP` t1 = 1 ("headset only") means the gun does not fire its barrel.
It sends its own headset an `$IRTX` frame, and the **headset** emits the swing. The range of that word comes from t2
(t41 indoors), not from the extra-headset pair t13/t42, which only a t1 = 2 or 3 weapon reads. Our melee ships t2 = 90.
So melee depends on the gun-to-headset link, and a swing can only land from the headset's domes.

**Code-read target (v4.32, 2026-09-21).** The corrected gun image has no `$MELEE` name. Its `$BHIT` branch reads
one event byte, while `$FIREX` reads five fields; the old `$FIREX,<slot>` shortcut is not supported by this read.
After the physical-swing runs, inject `$BHIT,8,*` with button 8 mapped to the melee slot, unbound/99 and slot 0.
Only mapping-dependent emitted words prove this event reaches the button map. Then repeat the working path with
otherwise identical `$WEAP` rows at t1 = 0 and t1 = 1 while independent sensors watch the barrel and headset.

Steps:
1. **Control.** Send `$MELEE,255,*`, then `$XYZZY,255,*`. Does each one give `$BUT,4,0`? If the unknown command
   also answers, `$MELEE` proves nothing.
2. Re-arm A with our melee `$WEAP` as MC ships it, but in slot 7. Send `$BMAP,8,7`. Swing at B's headset from
   30 cm. Watch A for `$BUT,8` and B for a `$HIR` with token 2 = 13.
3. Repeat with slot 4 and `$BMAP,8,4` (today's frames), so the two runs compare directly.
4. Watch the headset during a swing. Does it flash or emit? Point the IR rig at the headset domes, not the barrel,
   and count words per swing. No word from the headset means the `$IRTX` hand-off to the headset fails.
5. **Event-path control:** inject `$BHIT,8,*` with button 8 mapped in turn to the melee slot, unbound/99 and slot 0.
   Before each mapping, restore the same ammo and cooldown state; record `$BUT`, IR and `$HIR`. Do not infer damage
   semantics from the command name.
6. **Emitter-source A/B:** from identical re-arms, alternate otherwise identical melee `$WEAP` rows with t1 = 0 and
   t1 = 1. Trigger the proven path while independent sensors watch the barrel and headset domes; repeat three times
   per value. Mapping-dependent words are not emitter proof without this physical observation.
7. **`$FIREX` arity control (blocked until a real frame is captured):** record any complete `$FIREX` frame seen
   during steps 2-5 and preserve its five fields. Do not improvise the field order or interpret `$FIREX,4,*` as a
   slot-fire proof. Once a complete frame exists, replay it against the short form from identical armed states.


**Reading.** A headset word on the rig with no `$HIR` on B points at aim or range (the swing leaves the head, not the
gun). No headset word at all points at the gun-to-headset hand-off. A hit in slot 7 and none in slot 4 closes K4 another
way. `$BUT,8` with no `$HIR` on either slot points at the
emitter (the headset LED or its range), not the binding.

## 3. `$BHIT`: can the host inject a hit? (10 min)

V4_30 parses `$BHIT,<proto>,<shooterId>,<team>,<damage>,<crit>,<subtype>,<sensor>,*` and runs it through the same
hit handler as a real IR word. A dead gun drops it. If v4.32 does the same, MC or the phone can apply any `$SIR`
row with no IR. That covers zone damage, a poison tick with attribution, and a recovery after a desync (F208).

**Code-read target (v4.32, 2026-09-21).** Corrected v4.32 consumes only token 1 as an event byte and does not parse
the alleged seven-field hit tail. Before each discriminator trial, restore the same pools, button maps, slot, ammo
and cooldown state. Compare `$BHIT,8,*` with
`$BHIT,8,1,2,255,1,3,100,*`, then change only token 1 to 0. Equal behaviour for the equal-first-token pair and a
change only with token 1 supports the event reading; damage controlled by the tail supports the older hit reading.
For 2 seconds after each frame, record `$BUT`, emitted IR, `$HIR`, `$HP`, ammo and sound.

Send each frame to B only:
1. `$BHIT,0,1,1,9,0,0,0,*`. Expect `$HIR` with shooter 1 and team 1, and HP down by 9.
2. `$BHIT,0,1,1,9,1,0,0,*`, with B's `$GSET` t7 = 0 (as MC compiles it). The crit bit is set, but a host `$BHIT`
   gets only the victim's t7 bonus: in V4_31 the x1.5 from 09-18 is the shooter's `$PSET` t6, applied before the
   word leaves the gun. So expect 9, not 13. A 13 means v4.32 applies a crit bonus on the victim side at t7 = 0,
   and the V4_31 reading of the crit does not hold for v4.32.
3. `$BHIT,0,1,2,9,0,0,0,*`. B is team 2 and t1 = 0, so expect a block. This also tests §1 from the host side.
4. Re-arm B (45, 70, 0) with the fn 20 row `$SIR,0,0,,20,0,0,1,,*`, then repeat step 1. Expect armour 61 and HP 45
   (armour only).

**Reading.** A `$HIR` that looks like a real hit means the host can deal damage. Record whether the gun plays the
hit sound and vibrates.

## 4. `$STUN` takes milliseconds (F65 family, 10 min)

We called `$STUN` a no-op because we sent `$STUN,*`, and V4_30 reads that as 0 ms. The code runs a timer and sets a
"stunned" flag. It also stuns the victim for p5 ms when a `$SIR` row has **p5 of 64 or more**.

1. Send `$STUN,3000,*` to A. Pull the trigger once a second for 5 s. Record which pulls fire (`$ALCD`), and anything
   you hear, see or feel.
2. **Session 1.** Set `$SIR,0,0,,1,3000,0,1,,*` on B (plain damage, with p5 = 3000). Hit B once, then have B pull
   its trigger for 5 s at once. If B stops firing for about 3 s, the native stun can replace the node stun (`_stun` and
   `_stunRestore` in `app/src/engine.js`), and it works with no BLE at all.

**Reading.** A gun that stops firing for about 3 s is a native stun. This gives a real stun grenade and the
"busy while unpacking" state the 2018 app used. It is a different thing from the fn-23 flashbang.

## 5. `$BUMP` with its real shape (F65, 10 min)

V4_30 reads `$BUMP,<amount>,<hp>,<armour>,<shield>,<sound>,*`. Tokens 2-4 are on/off flags that pick the pools. A
negative amount drains the shield, then the armour, then the HP, and kills at 0. A positive amount heals the HP, then
spills into the armour, then the shield. F65 sent all three flags as 0.

Re-arm B (45, 70, 0), so B starts at HP 45 and armour 70. Each step starts from the result of the step before it,
so run all five steps in one session, in order. Read the current pools from `$HP` (or `$LCD`) after each step. Do
not use `$QUERY`: V4_30 builds its pool fields from the maxima, not the current pools.
1. `$BUMP,-20,1,1,1,,*`. Expect armour 50, HP 45.
2. `$BUMP,-80,1,1,1,,*`. Armour is 50, so expect armour 0 and HP 15 (the cascade).
3. `$BUMP,-10,1,0,0,,*`. Expect HP 5 and nothing else.
4. `$BUMP,50,1,1,0,,*`. Expect HP back to the maximum (45), with the other 10 going into armour (armour 10).
5. `$BUMP,-5,1,1,1,N94,*`. Expect armour 5, HP 45. Does N94 (the 2018 app's out-of-bounds sound) play?

**Reading.** A cascade gives one-command zone damage that respects armour, which `$LIFE` cannot do.

**Shield flag and sound token, result 2026-09-18: both CONFIRMED**, closing the two gaps this section's earlier
run left open. Re-armed with `$PSET` shield maximum 60, `$LIFE,0,0,40,*` gave shield 40. `$BUMP,-10,0,0,1,,*`
(shield flag alone) gave `$HP,999,0,30`: the shield flag gates the shield pool independently, same as hp/armour.
`$BUMP,-50,1,0,1,,*` (hp and shield, no armour) gave `$HP,979,0,0`: 30 emptied the shield and the remaining 20
cascaded into HP, matching the V4_30-read cascade order at the top of this section. `$BUMP,-1,1,0,0,X17,*` sent
twice played an audible sound both times; the control `$BUMP,-1,1,0,0,,*` played nothing. `$BUMP` is now
confirmed in full on every field.

## 6. `$LIFE` set mode, and `$SPAWN` shield (K7, 10 min)

- `$LIFE` has a 4th token: 0 adds (what we use), 1 sets the pools to exact values with a clamp, 2 sets them with no
  clamp.
- `$SPAWN,<n>,*` spawns with **shield n**. K7 is blocked because no BLE command grants a shield (P16, F60).

**Code-read target (v4.32, 2026-09-21).** The `$SPAWN` branch consumes no token before the common spawn routine,
so v4.32 predicts that its shield argument is ignored. Run step 3 as two complete, independently re-armed trials,
one with `$SPAWN,0,*` and one with `$SPAWN,50,*`; alternate the order on a repeat. Argument-dependent `$LCD`
shield values disprove the read.

Before this section, re-arm B (45, 70, 60). Set mode needs an armour maximum above 0, and step 3 needs a shield
maximum of 50 or more.

1. On B, send `$LIFE,30,10,0,1,*`. Expect HP 30 and armour 10 exactly, whatever the start values.
2. Send `$LIFE,500,0,0,2,*`. Does HP go above the maximum?
3. From a fresh (45, 70, 60) re-arm, send `$SPAWN,0,*`, then `$TID,2,*`, and read `$LCD`. Restore the identical
   re-arm, send `$SPAWN,50,*`, then `$TID,2,*`, and read again. Repeat in the opposite order. If token 3 is 50 only
   after the nonzero frame, fire three 9-damage hits and require shield 23 before calling the argument live.
4. Kill B. Then, on the **dead** B, send `$LIFE,30,0,0,1,*`, which is the 2018 app's revive. Does B come back to life?
   The kill left an HP maximum of 9, and set mode clamps, so a revive shows HP 9. **Answered 2026-09-18 by §16 step 3
   (claim 6): yes.** Skip this step.

**Reading.** If step 3 works, K7 (shields as a game option) is unblocked. If step 4 works, a revive can happen with
no respawn.

## 7. `$PRES` and `$INVU` (S50, 10 min)

- `$PRES,<proto>,<sub>,<pct>,*` multiplies damage for one cell by (100 + pct)/100.
- `$INVU,*` sets incoming damage to x0 (it writes `$TMP` token 8 to -100; §21 covers `$TMP`).

**Code-read target (v4.32, 2026-09-21).** The corrected image does not safely bind either name to the claimed
local effect: the apparent `$INVU` reference belongs to an adjacent command, and a nearby formatter is not a
damage multiplier. In step 3 classify `$HIR` with zero loss, no `$HIR`, or normal loss separately. Then clear
`$TMP` t8 and repeat; restored damage would support shared t8 state. Also compare same-team and enemy hits across a
reset/spawn before and after `$INVU`, then power-cycle, to isolate the claimed persistent team side effect.

Isolated team sequence for step 3: re-arm B on team 2; record one enemy-team and one same-team control hit; restore
the pools; send `$INVU,*`; repeat the enemy hit; send `$TMP,,,,,,,,0,,,,*`; restore the pools and repeat it; then
`$SPAWN,,*`, `$TID,2,*`, `$QUERY,*` and repeat both enemy/same-team hits. Power-cycle B and repeat the two-hit
baseline before returning it to service. Never mix this sequence into a live team game.

B arrives from §6 step 4 with a 9 HP maximum. Before step 1, re-arm B (999, 0, 0), so the hits below
cannot kill it.

1. On B: `$PRES,0,0,-50,*`. Fire 3 hits. Expect 4 each (9 x 0.5, truncated).
2. On B: `$PRES,0,0,100,*`. Expect 18 each. Then send `$PRES,0,0,0,*` to reset it.
3. On B: `$INVU,*`. Fire 3 hits. Do they register (`$HIR`) with no damage? Then send `$TMP,,,,,,,,0,,,,*` (t8 = 0).
   Does damage return? If it does not, note it and power-cycle B. ⚠️ V4_31 shows `$INVU` also sets a flag that forces
   team 2 on a later reset: power-cycle B after this step, and never send `$INVU` in a team game.

**Reading.** `$PRES` is the Body Armor and Armour Piercing lever for each weapon family.

## 8. The fn 24-27 fuse, timed (P18, S16, 10 min)

V4_30 gives fn 24, 25, 26 and 27 fuses of 5.0, 4.0, 3.0 and 2.0 s. On 09-18, fn 24 replayed forever every 5.07 s.
The code explains the loop: in app mode an expired fuse injects a **protocol-9** word, and `<9,3>` was fn 24 at the
time. Also, `$SIR` p5 on these rows is a cell key (low nibble = protocol, high nibble = subtype).

**Code-read target (v4.32, 2026-09-21).** The gun-side `$SIR` routine formats and forwards five values but has no
function switch, timer or cell decode, so it cannot confirm the old timing sequence. Use a distinct target cell
(`<10,0>` = fn 1) for the timed runs and reserve a self-referential source/target run for the recursion control.
Three runs per function must produce one delayed event near 5/4/3/2 s before the claim advances.

1. For each N in 24, 25, 26 and 27, freshly re-arm B with `$SIR,0,0,,N,10,0,1,,*` and
   `$SIR,10,0,,1,0,0,1,,*`, fire **one** shot, and log every `$HIR`/`$HP` for 8 s. Run three independent re-arms
   per N. A single delayed protocol-10 hit distinguishes the target from the source; time its gap from the real hit.
2. **Recursion control:** set `<0,0>` to fn 24 with p5 = 0, so its target is itself. Repetition here but not with
   the distinct `<10,0>` target proves table recursion rather than a periodic fuse.
3. **Packing control:** set p5 = 58 (`0x3a`), `<10,3>` to fn 1 and `<10,0>` to fn 28. The delayed `$HIR` subtype
   distinguishes low-nibble protocol/high-nibble subtype packing from a decimal protocol-only interpretation.

**Reading.**
- If a delayed hit lands once and then stops, we have a native delayed hit (a sticky bomb) and P18's loop is
  explained.
- If the gaps are 4, 3 and 2 s, correct the 09-18 note "25, 26 and 27 do the same".
- If the replay still repeats, v4.32 differs from V4_30. Stop and write that down.

## 9. Where the x1.5 crit comes from (F62, 10 min)

On 09-18 we measured a crit as x1.5 with `$GSET` t7 = 0. V4_30 adds no crit bonus at t7 = 0. Battle Company's own
sheets name `$PSET` t6 `CriticalDamageBonus`, and we ship it as **50**. So the x1.5 is probably our own `$PSET` t6,
not a fixed firmware value. The 2026-09-07 sweep of t6 had no crits in it, so it could not see this.

Arm A with the bench AR at `$WEAP` t6 = 100 (every shot a crit). Fire 3 shots per run and read the damage:
1. A's `$PSET` t6 = 50 (as shipped). Expect 13.
2. A's `$PSET` t6 = 0. Expect 9. Then repeat on B's `$PSET` instead of A's, in case the victim applies it.
3. A's `$PSET` t6 = 100. Expect 18.
4. With t6 = 50, set B's `$GSET` t7 = 100. Does the crit grow again?
5. **Rig control (needs the IR rig).** Set B's `$GSET` t7 = 0. Emit one rig word with C = 1 and magnitude 20 at B.
   Expect 20 (x1) if the crit is shooter-side. A 30 means the victim applies x1.5 on the C bit at t7 = 0, which
   is what our emitter's earlier x1.5 would mean if that victim's t7 was 0 (it was not recorded).

**Reading.** If the damage follows t6, the crit bonus is a per-player number that MC sets, which makes a "Critical
Strike" perk a single token.

## 10. The small `$SIR` functions (15 min)

Change B's `<0,0>` row for each function. Fire 3 shots per state. Before each row, re-arm B (999, 0, 0) with that
row's `$SIR`, unless the row says otherwise.

| fn | V4_30 says | how to test |
|---|---|---|
| 34 | Registers (`$HIR` only) **on a dead gun**, and never causes a death. **Ally-only** (V4_30) | Kill B first (A is still on team 1). Then put A on B's team (`$TID,2,*` on A, as §16 does), set the fn 34 row, and hit B. Does `$HIR` arrive? This would be the base for a revive beam. After this run, send `$TID,1,*` to A before fn 35. |
| 35 | Same, but **enemy-only** (V4_30) | A is back on team 1 (`$TID,1,*` after the fn 34 run). Kill B, set the fn 35 row, then hit B. Does `$HIR` arrive? |
| 38 | Shield, then armour, then **half** of the rest goes to HP | B has 0 armour after the re-arm. 9 should take 4 HP. The 09-17 bench saw plain damage only because armour was 70. |
| 30 | Double damage from sensor 1 (the back of the headset). A kill from there is silent. | Hit the front, then the back, and compare. |
| 33 | Normal damage, but a kill is silent (no death alarm) | Re-arm B (9, 0, 0) with the fn 33 row. Listen for the death alarm. |
| 50 / 51 / 52 | Repaints the team colour only, with no `$HIR` | Watch B's LEDs. |

## 11. Splash re-emit (optional, needs the IR rig, 10 min)

A `$SIR` row with p6 above 0 makes the **victim** send the hit on to everyone around it. The stock Rocket row uses
p6 = 100. On B, send `$SIR,0,0,,1,0,100,1,,*` and put the receiver rig beside B. Hit B once. Does the rig decode a
second word, 0 to 250 ms after the hit, with A's id and crit = 1?

**Code-read target (v4.32, 2026-09-21).** The gun-side `$SIR` forwarding path has no visible p6/p8 re-emit branch;
the headset may own it. First prove the rig can receive a known B-emitted word in the same geometry. Shield the rig
from A's direct beam, re-arm B to a nonlethal baseline before every trial, and counterbalance p6 = 0/1/50/100 at
0.25 m and 2 m, five trials per cell. Repeat indoors with p6 = 0 while varying p8 = 0/1/50/100. Require a
treatment-only second air word after B's `$HIR`, and record its crit rather than assuming 1. Repeat one working
cell with B at incoming-damage -100: re-emission without pool loss separates scheduling from damage.

## 12. Reception gate (F121, 10 min, session 1)

V4_30 drops every IR word while the gun is not `$START`ed ("not start"). `$START` and `$STOP` set and clear one
"started" flag. About 30 reads of that flag in the button and trigger paths suggest that `$STOP` also gates the
trigger (inferred). V4_31 also shows that `$START` and `$STOP` clear the app-mode flags that `$GSET` sets.

1. Send `$STOP,*` to armed B and fire at B. Expect no `$HIR`. **Answered 2026-09-18 by §23 step 2: DIFFERENT.** `$HIR` still arrives, with no damage. Skip this step.
2. With B still stopped, pull B's trigger 3 times. Does `$ALCD` move? Does IR leave the barrel?
3. Send `$START,*` to B, then re-send B's `$GSET`. Fire at B. Expect a normal hit. **Answered 2026-09-18 by §23 step 3's
   first attempt:** `$START,*` plus a `$GSET` and `$TID` re-send restored full damage. Skip this step.

If step 1 registers nothing and step 3 registers, MC can close F121 by sending `$STOP` until spawn (§23 builds on
this). **Re-send `$GSET` after any mid-match `$START`**, because the `$START` cleared its app-mode flags.

## 13. Kill confirmation: a discovery phase (30 min, needs the IR rig)

We do not yet know how a stock game confirms a kill, so this section discovers it before anything is built on it.

What the sources say:
- Battle Company's own UART sheet lists **"Kill confirmation"** and **"Player Respawn Request"** among the protocol-15
  callouts of its `$SIR,15,0` row ("call out for audio"), next to control point, respawn station, capture the flag
  and the grenade types. So a kill confirmation is most likely a **protocol-15, subtype-0 IR word**, and the gun that
  receives it needs a `<15,0>` `$SIR` row. Jay (LaserTagMods) told Tony the same: the kill-confirm IR "has to be `$SIR`
  setup".
- The sheet's Callsign death sample shows the app side: the victim's gun reports `$HP,0,0,0`, the app credits the last
  `$HIR` shooter, and the app tells the killer's gun to play the kill-confirmation voice (`V3A` male, `VBA` female).
- Jay's ESP32 code reads a `$DD,<killer>,<team>` frame from the gun when its player dies.
- The V4_31 disassembly found no IR send in the gun's own death routine.
- Known protocol-15 magnitudes from Jay's JBOX code: 6 respawn, 8 perk or KOTH pulse, 10 proximity, 50 capture. The
  kill-confirmation magnitude is not in any source we hold.

Steps:
1. **Listen for `$DD`.** Kill B (the recipe above). Log every frame B sends for 5 s after the death.
2. **Passive capture at death.** Point the IR rig at B's headset domes, then at A, and kill B again. Record every word
   (protocol, player, team, magnitude, crit, subtype) in the 5 s after the death. Repeat with B carrying the full stock
   Callsign `$SIR` table (from the sheet) instead of ours.
3. **Magnitude sweep.** Give B the row `$SIR,15,0,,28,0,0,1,,*` (registers, no pool change). From the rig, emit
   protocol-15, subtype-0 words at every magnitude from 0 to 63 except 6, 8, 10 and 50, one per second, with player 1
   and team 1. For each, log B's `$HIR` and listen for a callout. A kill-confirmation voice (`V3A`/`VBA`) or a named
   callout marks the magnitude.
4. **Ask Jay** which magnitude and fields the kill confirmation uses. His answer turns step 3 into one shot.

⚠️ Do not run Callsign on our own guns to capture a reference: it resets an enrolled gun's name. Use a spare gun, or
rename it afterwards.

**Reading.** Step 1 or 2 shows who produces the confirmation. Step 3 gives the word. Together they tell us whether the
killer's gun can hear its own kill confirmed with no phone or MC in the loop.

## 14. How the transport fails (moved to the screamers sheet)

The transport steps now run as Phase A of [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md), so the
two sheets do not overlap. The old step numbers map like this: §14.1 lost frames = A8, §14.2 bursts = A7, §14.3
lock-up under the S42 recoil writer = A13, §14.4 `$DPLAY` = A1-A3, §14.5 recovery = the recovery rule in that sheet's
rules.

**Reading.** A13 gives the per-gun traffic budget that the hardening work designs to. If it locks up in minutes,
the recoil writer's current rate is a screamer cause, and the writer must drop below that rate before it ships (F274).

## 15. A headless gun and `$RADSK` (10 min)

Our docs say a gun with no headset answers `$PING` and then drops the phone link within about 6 s. Jay's ESP32 code
sends `$RADSK,*` every 4 s as a stand-in headset, and the V4_31 gun sends `$RADSK` to its own headset every 3 s as a
link check.

**Code-read target (v4.32, 2026-09-21).** The name participates in headset/native message machinery, but no clean
inbound timer refresh was found. Measure at least three no-injection drop times, then inject every 4 s for 2 minutes
and stop without changing anything else. Survival only during injection plus a repeatable post-stop drop proves an
inbound lease. A simultaneous real-headset sniff separately establishes the outbound direction.

1. Power B with its headset switched off. Connect and time how long the link holds. Do it at least three times.
2. Reconnect, and send `$RADSK,*` to B every 4 s for 2 minutes. Stop the writes without another state change and
   time the disconnect for `max(3 × the longest baseline, 30 s)`; record “no drop by cap” if it stays connected.
   Power-cycle/reconnect, then repeat the whole inject→stop treatment once.

**Reading.** Survival during injection plus a repeatable, baseline-like timeout after the writes stop proves an
inbound lease refresh. Survival alone may instead be a one-shot mode transition. A real-headset sniff proving the
gun sends periodic `$RADSK` establishes the outbound direction separately.

## 16. The revive beam (15 min, needs the IR rig or a second gun as emitter)

BC's 2018 app revives a downed teammate like this: the reviver's gun sends `$IRTX,0,14,<pid>,<team>,1,0,0,<range>,1,,1,*`
once a second while it is stunned, and the downed gun carries `$SIR,14,0,NULL,34,,,,,*`. The app counts the `$HIR`
type-14 reports and revives after 8 s with `$LIFE,30,0,0,1,*`.

1. Kill B. Then give B the row `$SIR,14,0,NULL,34,,,,,*`.
2. Put A and B on one team for this run: send `$TID,2,*` to A. Then, from A, send `$IRTX,0,14,1,2,1,0,0,100,1,,1,*` once a second for 10 s, pointed at B.
3. Log B's `$HIR` frames. Then send B `$LIFE,30,0,0,1,*`.
4. `$IRTX` field 4 is `ImmuneTeamColor` (`protocol/brx-protocol.md`), not the shooter's team. The value 2 in step 2
   equals B's team, so it may make B immune to the word. Kill B again, give B the row again, and repeat steps 2
   and 3 with field 4 = 1 (`$IRTX,0,14,1,1,1,0,0,100,1,,1,*`).
5. Send `$TID,1,*` to A to put it back on team 1 before the next section.
6. **The looped headset word (session 1; with no IR rig there, run it at the top of session 4).** V4_31 shows that
   the gun passes a host `$IRTX` to its headset, and the headset repeats the word by itself: field 9 = 100 loops for
   ever, field 9 = 0 stops, and field 10 is the period in ms (200 or more). Respawn B, and put the IR rig at B's headset domes.
   1. Send B `$IRTX,100,15,63,1,8,0,0,100,100,1000,0,*`. Expect one protocol-15 word per second on the rig (player
      63, team 1, magnitude 8). Player 63 is there so the wearer cannot hit themself. Count the words for 10 s.
   2. Send B the same frame with field 9 = 0: `$IRTX,100,15,63,1,8,0,0,100,0,1000,0,*`. Does the loop stop?
   3. Start the loop again, then send `$CLEAR,*`. Does the loop stop? Then re-arm B (F11). A loop that nobody stops
      jams the field, so the answer decides whether the stop frame must join the death, end and panic sequences.

**Reading.** Type-14 `$HIR` frames on a dead B mean a teammate revive runs through the taggers themselves. Also note
whether A's `$IRTX` leaves the gun or the headset. If step 6 loops, one frame starts a player-worn beacon and one
frame stops it, and the revive beam needs no host write every second.

## 17. Station words (15 min, needs the IR rig)

Jay's JBOX code sends protocol-15 words whose magnitude selects the station function. Emit each one with `ir-emit`
at an armed B that carries our current station rows, and record B's `$HIR`, pools and sounds:

**Code-read target (v4.32, 2026-09-21).** No inspected gun-side path switches on magnitudes 6, 8, 10 or 50. The
hosted/app discriminator is executable: arm `<15,0>` with fn 28, emit each exact row below from the rig, and require
one `$HIR` carrying the sent magnitude with no pool, ammo, LED or start-state change. That proves generic table
receipt, not a native station effect. For the native control, use the proven setup in `reference/grenade.md`: start
a stock native TDM after the magnitude-56 pre-game arm, kill same-team B, and emit one magnitude-6 beacon. Immediate
revival, with a wrong-team pulse as the negative control, reconfirms the one known native effect. The phrases
“perk” for 8 and “proximity” for 10 name no observable state and are **blocked as bench claims** until their source
defines the expected gun change. A generic injected magnitude-50 native-callout test is also blocked until the
source names the exact stock objective mode, starting ownership and arming transition; the real grenade capture
already proves that word, but a vague “native objective game” would make any synthetic null uninterpretable.

| word (protocol, player, team, magnitude, crit, subtype) | Jay's meaning |
|---|---|
| 15, 63, B's team, 6, 1, 0 | respawn |
| 15, 0, B's team, 50, 0, 0 | control point captured |
| 15, 63, B's team, 8, 0, 0 | perk or KOTH pulse |
| 15, 63, B's team, 10, 0, 0 | proximity |

The older two-pulses-within-9-seconds changelog rule is already contradicted by the native station bench: one
same-team magnitude-6 beacon revived 4/4. Do not spend another session treating it as the expected v4.32 behavior.

**Reading.** Each word that does what Jay's code says becomes a station function MC can arm with no new hardware.

## 18. Reply decodes (10 min)

Read these on an armed gun, change one thing, and read again:

1. `$LCD` token 3: re-arm B (45, 0, 40), then grant a shield (`$LIFE,0,0,40,*`). Does t3 read 40?
   Token 4: swap the weapon. Does t4 follow the slot?
2. `$QUERY` tokens 1 to 7: change `$PSET` player id, team (t2) and pools. Do tokens 1 to 5 follow? Is token 7 the
   gyro flag?
3. `$VERSION`: record all tokens with and without the headset. Is token 3 always `4`?

## 19. Gap sweep: open items with a new lead (90 min)

A triage of every open FOLLOWUPS row against the new sources found these untested leads. One step each. Record every
result, including nulls, against the row id.

1. **fn 38 at real armour (F225).** Re-arm B (45, 70, 0) with the row `$SIR,0,0,,38,0,0,1,,*`. Hit B once at
   magnitude 100. V4_30 predicts 70 from armour plus 15 from HP (the HP remainder halved),
   which is the playtest's unexplained 85.
2. **fn 3, 4, 5 and 7 (pool order).** Our 70-armour baseline could not tell these apart. For each function,
   re-arm B (45, 5, 20) with that function's row. The `$SPAWN` gives HP 45 and armour 5. Then grant the shield with
   `$LIFE,0,0,20,*`. One hit of 40 per function. Record each pool.
3. **fn 31 and 32 (U11).** With `$GSET` t1 = 1, hit a live B once on each. Watch the LEDs and `$HIR`.
4. **`$GSET` t2 on one side only (F162, F198).** Shooter t2 = 1 and victim t2 = 0, then swap. Count hits at 10 m.
5. **t41 in indoor mode (Q15).** With `$GSET` t2 = 1 on the SHOOTER only (as §20 step 2 does; t2 = 1 on the
   receiving gun made it deaf at 30 ft on the bench), compare `$WEAP` t41 = 5 against 75 indoors.
   V4_30 applies the indoor fields only when t2 is not 0, which would explain why t41 was inert outdoors.
6. **The ALT cycle list (F233).** Load four slots, send `$BMAP,1,100,0,1,2,3,*`, press ALT four times. V4_31 fills a
   four-entry cycle from tokens 3-6.
7. **Reload type (K1).** Set `$WEAP` t19 = 6, then 10 (BC sheet: "no reload", "bottomless"). Fire the magazine dry and
   watch `$ALCD`. A kid-friendly auto-reload may need no node logic at all.
8. **`$AMMO` modes.** `$AMMO,0,5,10,0,*` (add), then `$AMMO,0,5,10,1,*` (set), then mode 2 past the maximum. Read
   `$ALCD` after each.
9. **`$SPAWN,*` against `$SPAWN,,*`.** V4_30 parses both to the same value, but our bench says only the empty-token
   form arms. Kill B, send one form, check it fires; repeat with the other form. Include a control.
10. **Voice slot alignment (B29).** V4_30 reads 17 sound ids in `$PSET` t7-t23. Put a distinct voice id at t19 only,
    take a shield hit and listen. Then move it to t20.
11. **The `$SIR` row ceiling (F39).** V4_30 stores all 64 cells. Push a 20-row table and hit each row once.
12. **`$TMP` t5, t6, t7 and t10 (S50, F87).** Moved to §21 steps 16-19 (session 1), which now trace each token.
13. **A bare `$LIFE,*` (F208, F163).** Moved to §22 step 4 (session 1), the dead-gun probe.
14. **fn 23 by ear (B27, F66).** V4_30 says fn 23 only changes accuracy. Take one hit and listen: is any audio cut?
15. **Two-emitter weapons (F71).** Fire the Shotgun (t1 = 2, gun and headset) at the IR rig. Count words per pull.
    **Answered 2026-09-18 (F71, F263 closed): two words a pull, each with its own magnitude.** Skip this step. Which
    emitter sends which word, and at what reach, is F275.
16. **Melee extras (K4).** Log every frame A sends during a swing. Confirm B's `<13,1>` row is a damage function.
17. **`$AS` lock (P4), with care.** Send `$AS,4,0,0,0,0,0,75,*` only (Jay's "lock between games"). Does the menu lock?
    **Do not send `$AS,1`**, which starts a native game.
18. **The factory menu (F230), read only.** ⛔ Dropped 2026-09-18: `SETUP` is only the headset pairing prompt, and F230 is closed (shipped frames keep `t21` = `t22`). On the gun whose accuracy walks and one steady gun, open the USB `SETUP`
    menu, photograph every option, and power-cycle out. **Change nothing.** V4_30 lists recoil-device, gyro and
    DLC options there that could explain why one gun differs.

## 20. Range is carrier frequency (20 min, needs the IR rig)

The V4_31 trace shows that the range tokens (t2, t41, t13, t42, and `$IRTX` field 8) do not set emitter power. They
detune the IR carrier (formulas: `protocol/brx-protocol.md` §6, the `2, 41` row). The gun barrel (t2, t41) uses
125 Hz per step below 100, so range 100 is 38 kHz and range 5 is 26.1 kHz. A word the headset emits (t13, t42 and
`$IRTX` field 8) uses 140 Hz per step, so t13 = 13 is 25.8 kHz on the headset, not 27.1 kHz. Gun barrel power changes only with the indoor/outdoor level
(the headset uses a fixed duty): duty about 20 % indoors, 38 % outdoors. A receiver
filters around 38 kHz, so a low range value is simply off-frequency. That explains the 2026-09-17 garden ladder: no hits
at 5 (26.1 kHz), a transition between 13 and 26 (27.1 to 28.75 kHz), and a flat shelf above about 31 (29.4 kHz).
t41 and t42 replace t2 and t13 only in indoor mode, and only when they are not 0.

1. Measure the carrier with the rig (or a scope on the emitter) at t2 = 100, 75, 50 and 13. Does it move as predicted?
2. Indoors (`$GSET` t2 = 1 on the shooter), compare t41 = 5 against t41 = 75 at the same distance. Now t41 must matter.
3. `$GSET` t3 is stored and never read in V4_31. Toggle it once and confirm nothing changes.

**Reading.** If step 1 holds, range tuning becomes a frequency table calibrated against the receiver's band-pass, and
values above the knee are not worth tuning.

## 21. `$TMP`: the native modifier system (55 min, run it before any recoil soak)

The V4_30 and V4_31 disassemblies read `$TMP,<t1>,...,<t11>,*` as a set of per-player modifiers. Every token is
optional, and an empty token leaves its field alone. The token that holds the `*` is stored as 0 (see "Frame shape"
below). The stock King of the Hill buff writes t4, t5, t6 and t10, which is how the V4_31 trace found them:

| token | V4_30/V4_31 reading | the feature it could carry |
|---|---|---|
| t1 / t2 / t3 | HP / armour / shield maximum bonus, added to `$PSET` t3-t5 in the clamps (a change that leaves HP at 0 or below kills) | Body Armor, Overshield |
| t4 | accuracy modifier: live accuracy = clamp(`$WEAP` t22 + t4) to 0-100, on the active slot (fn 23 writes it and stamps a recovery timer) | recoil, flinch, stance |
| t5 | fire interval %: `$WEAP` t14 x (100 + t5)/100, with a 65 ms floor | Overclock, Adrenaline Rush, F87's hill fire-rate boost |
| t6 | reload time %: `$WEAP` t18 x (100 + t6)/100, with a floor of 0 | Quick Hands, the `reload_mult` of Body Armor |
| t7 | outgoing damage % on the barrel word, clamped to 0-255; the headset word (`$WEAP` t12) does not get it | Heavy Barrel, a damage handicap |
| t8 | incoming damage %, damage x (100 + t8)/100 (`$INVU` writes -100) | a damage-reduction perk, spawn protection (§23) |
| t9 | magazine bonus: the write tops up every slot by clip x t9/100, and a reload fills to t16 + t9, one flat round count for every slot | Extended Mags, but not "x2 on the primary" |
| t10 | crit chance points, added to `$WEAP` t6 and to the secondary crit chance `$WEAP` t11 | Critical Strike chance |
| t11 | the default hit sound when a row has none | |

The two traces disagree on the base of the t4 sum: one reads `$WEAP` t22, the other t21. The bench AR ships
t21 = t22 = 100, so both give the same number on this sheet.

Why it matters: today recoil changes accuracy with a full `$WEAP` (about 101 bytes, 6 packets) that also resets the
magazine, so an `$AMMO` must follow it, which is the root of the F259 family. Body Armor and Extended Mags are built by
rewriting `$PSET` and `$WEAP`. `$TMP,,,,-30,,,,,,,,*` is 20 bytes, one packet. Flinch and stance (Tony's request, not
built yet) and fn 23's smoke are accuracy modifiers too, so if t4 is the lever, four effects share one field. Step 3
decides the design: if the effects stack, each can write its own value; if the last writer wins, one owner on the node
must compute a single value and be the only thing that writes t4.

Each step below carries a "V4_31 predicts" line, so the bench confirms a static reading instead of discovering one.
Record every value you read (`$ALCD` token 2 for accuracy, the magazine, the pools from `$HP`/`$LCD`), not only pass
or fail. If effects add, the wire shows only the sum. Keep B's HP healthy for the pool steps: a bonus change that
leaves HP at 0 or below kills.

**Frame shape.** Always send the full 12-comma vector: `$TMP`, eleven token places, and the `*` in the twelfth.
Wherever the `*` lands, the gun stores that token as 0. So a short form such as `$TMP,,,,-30,*` also zeroes t5, and
a `*` on t11 makes the default hit sound "*". Every `$TMP` frame on this sheet has 12 commas.

**t4, accuracy.** Arm A with the bench AR. Fire a few rounds so the magazine is not full.
1. Send `$TMP,,,,-30,,,,,,,,*` (only token 4 set). Did `$ALCD` token 2 move? Did the magazine stay the same?
   V4_31 predicts: the gun answers with an `$ALCD` at once when t4 or t9 is set, with no shot. Token 2 reads 70
   and the magazine is unchanged.
2. **Does a `$WEAP` clear it?** With t4 at -30, push the bench AR `$WEAP` again and read token 2.
   V4_31 predicts: the `$WEAP` does not clear t4. It recomputes accuracy as clamp(t22 + t4), so token 2 reads 70
   again.
3. **Smoke collision.** With t4 at -30, take one fn 23 hit (put `$SIR,0,0,,23,0,0,1,,*` on A; fire at A from B or the
   IR rig). Read the accuracy. Then send `$TMP,,,,-30,,,,,,,,*` again, as the recoil writer's next write would, and read
   it again, then again after 3 s. They stack, the last writer wins (a recoil write cancels the smoke early, a bug we
   would introduce), or the gun clamps. fn 23 stamps a recovery timer, so also note whether the smoke recovery still
   runs after our write.
   V4_31 predicts: the last writer wins. The smoke writes t4 = -150 and ramps it back up to 0 (token 2 reads 0,
   then climbs). Our write replaces it at once (token 2 reads 70), which ends the smoke early. A 6000 ms timer then
   writes t4 = 0; that this timer is fn 23's recovery is inferred. **So the recoil writer must stand down while smoke
   is active.**
4. Send `$TMP,,,,-60,,,,,,,,*`. Absolute (reads 40) or additive (reads 10)?
   V4_31 predicts: absolute. t4 replaces the old value, so token 2 reads 40.
5. Wait 8 s without firing. Does accuracy stay, or walk back by itself?
   V4_31 predicts: it stays, unless the 6000 ms timer of step 3 also runs after a host write. Then accuracy returns
   to 100 at about 6 s. Record the time of any change.
6. Fire 10 rounds. Does the modifier change the hit rate the way a lower t21/t22 does (2026-09-17: 38/40 hits at 90,
   7/18 at 50-60)?
   V4_31 predicts: yes, because t4 moves the same live accuracy, and the walk floor moves by t4 too.
7. Send `$TMP,,,,0,,,,,,,,*`. Does accuracy return to its ceiling?
   V4_31 predicts: yes, token 2 reads 100.
8. Kill A and respawn it. Does the modifier survive a death?
   V4_31 predicts: no. `$SPAWN` and `$CLEAR` zero every `$TMP` token, so every modifier must ride the spawn and
   revive writes.

**t9, magazine.** The bench AR's clip (t16) is 32.
9. On A, send `$TMP,,,,,,,,,50,,,*` (magazine +50 %). Read `$ALCD`: did the magazine grow by half a clip?
   V4_31 predicts: yes, +16 at once, on every slot, and the gun answers with an `$ALCD` with no shot.
10. Reload. Does the bigger magazine survive the reload?
    V4_31 predicts: the reload fills to t16 + t9 = 82, not 48. t9 is one flat round count for every slot, so
    Extended Mags "x2 on the primary" cannot live in t9.
11. Push the bench AR `$WEAP` again. Does the bonus survive, or does the `$WEAP` clear it? This decides whether
    Extended Mags can live here.
    V4_31 predicts: no static reading. Do not re-send t9 to restore it: each t9 write tops up every slot again.

**t1 / t2 / t3, pool maxima.** Re-arm B (45, 70, 0).
12. On B, send `$TMP,50,,,,,,,,,,,*` (HP maximum +50), then `$BUMP,999,1,0,0,,*`. Does HP heal above 45?
    V4_31 predicts: HP reaches 95.
13. Send `$TMP,,25,,,,,,,,,,*` (armour maximum +25), then `$BUMP,999,0,1,0,,*`. Does armour reach 95?
    V4_31 predicts: yes.
14. Re-send B's `$PSET`, then `$TID,2,*`, with no `$SPAWN`. Do the bonuses survive a `$PSET`? Then send `$SPAWN,,*`,
    `$TID,2,*` and `$BUMP,999,1,1,0,,*`.
    V4_31 predicts: the bonuses survive the `$PSET` (no static reading says otherwise), and the `$SPAWN` zeroes them,
    so the heal stops at HP 45 and armour 70.

**t8, incoming damage.** Re-arm B (999, 0, 0).
15. On B, send `$TMP,,,,,,,,-50,,,,*`. Fire 3 hits. Expect 4 or 5 each (9 x 0.5). Then send `$TMP,,,,,,,,0,,,,*`.
    V4_31 predicts: 4 each (truncated).

**t5, t6, t7 and t10, the traced tokens.** Arm A with the bench AR and re-arm B (999, 0, 0). After each step, send
the same frame with that token at 0, before the next step.
16. **t5, fire interval.** Hold full auto on A (bench AR, t14 = 100 ms per round). Send `$TMP,,,,,100,,,,,,,*` and time
    the `$ALCD` magazine decrements. Then send `$TMP,,,,,-50,,,,,,,*` and time them again.
    V4_31 predicts: about 200 ms per round at t5 = 100. At t5 = -50 the formula gives 50 ms, but the 65 ms floor holds.
17. **t6, reload time.** Fire A's magazine dry and time the reload, from the lever pull to the last `$ALCD` of the
    reload burst. Send `$TMP,,,,,,50,,,,,,*` and time it again.
    V4_31 predicts: x1.5, so the bench AR's t18 of 1400 ms becomes about 2100 ms.
    **Result 2026-09-18: CONFIRMED.** Timed from the lever pull (`$BUT,2,1`) to the refill `$ALCD` (magazine 3 to
    32): control (t6 unset) 1784 ms; t6 = 50 gave 2756 ms, x1.55, close to the x1.5 prediction; t6 back to 0 gave
    1800 ms, matching the control. Tony heard a "disabled trigger" style sound on the t6 = 50 reload; he says that
    happens sometimes on reloads regardless, and the wire shows only the lever press and release either side, so
    record it as unexplained, not a t6 effect.
18. **t7, outgoing damage.** On A, send `$TMP,,,,,,,50,,,,,*` and hit B 3 times.
    V4_31 predicts: `$HIR` damage (token 5) 13 each, not 9 (9 x 150/100, truncated). t7 scales the barrel word only,
    so a two-emitter weapon's headset word keeps its t12 damage.
19. **t10, crit chance.** The bench AR has `$WEAP` t6 empty, so it never crits. On A, send `$TMP,,,,,,,,,,50,,*` and
    fire 20 single shots at B, about one a second.
    V4_31 predicts: about half the hits carry `$HIR` token 6 = 1 and read 13 (A's `$PSET` t6 = 50); the rest read 9.
    The bench measured 45 % crits at `$WEAP` t6 = 50 (2026-09-18).

**Reading.** If t4, t9 and t1-t3 work and a `$WEAP` or `$PSET` does not clear them, recoil, Extended Mags and Body
Armor move to one short frame each, with no magazine reset, and the screamers sheet's recoil soak must measure the
`$TMP` form instead. Anything that a `$WEAP` or `$PSET` clears needs a re-send after it. If t5, t6, t7 and t10 work,
Overclock, Adrenaline Rush, Heavy Barrel, Quick Hands and a crit-chance perk are each one packet on and one off. If
`$SPAWN` zeroes `$TMP`, every modifier rides the spawn and revive writes. If `$TMP` does nothing, the current writers
stay and F274's soak runs as written.

## 22. Dead-gun probe (F264, 10 min, session 1)

F264: a gun can die while the HUD still shows the player alive. The node needs positive evidence of a dead gun before
it acts, so it never revives a healthy player whose magazine is simply empty. Two probes, sent to the SAME dead gun in
the same minute:
- `$QUERY,*`: it answers with a `$LCD` that carries the current pools (bench 2026-09-09), so it is positive evidence
  either way.
- `$LIFE,0,0,0,*` and the bare `$LIFE,*`: a zero add that changes nothing. A live gun answers `$HP` (bench
  2026-09-09). V4_31 shows that the `$LIFE` handler also sends `$HP` on the dead path when t1 = 0. So a dead gun
  should answer `$HP,0,0,0`, not silence, and this probe is positive evidence too. The 2018 BC app polled with a bare
  `$LIFE,*` after 5 s of gun silence.

⚠️ **Keep the `$LIFE` probe bare or all-zero.** A dead gun applies a `$LIFE` whose t1 is not 0: that is the §6 revive.
A probe that carries HP brings a dead player back.

Run §18 (reply decodes, claim 19) in the same session first: the `$QUERY` token map is confirmed by shape only.

1. Kill B (the recipe above). Log `$VOLTS` continuously from here to the end of the section.
2. Send `$QUERY,*` to B. Record the full reply, or silence within 2 s.
3. Send `$LIFE,0,0,0,*` to B. Expect `$HP,0,0,0`. Record the reply, anything else, or silence within 2 s.
4. Send the bare `$LIFE,*` to B (moved here from §19 step 13). Expect `$HP,0,0,0` again, with no pool change.
5. Respawn B and repeat steps 2-4 on the live gun as the control. Expect `$HP` with B's pools, unchanged.
6. Listen for `$DD` from B at the moment of death (the §13 step 1 reading).
7. **The second F264 stall: an empty magazine after a timed-out partial reload** (found 2026-09-18 on the playtest
   branch; no detector yet). Arm B with the Energy Rifle. Fire it dry, then pull the reload lever for 1 s only, so the
   reload times out (`bench-perks-2026-09-18.md` §7 item 2). If the magazine stays at 0, repeat steps 2-4 on this
   live, empty gun. Expect the "alive, stuck another way" row: the node must not revive it. ⚠ The perks bench
   (2026-09-18, log item 8) found that a short pull on an energy weapon does nothing, and a held pull refills 3.8 s
   after it starts. So a 1 s pull may not reproduce the field's `reload partial: 0 -> 12 of 32 (timeout)`. Record what
   the pull does before you read the probes.

Read the result against this table:

| `$VOLTS` ticking | `$QUERY` reply | `$LIFE,0,0,0` / `$LIFE,*` reply | reading |
|---|---|---|---|
| yes | `$LCD` health 0 | `$HP,0,0,0` | dead gun: the node can book the death |
| yes | `$LCD` health above 0 | `$HP` with HP above 0 | alive, stuck another way: do not revive |
| yes | silent | silent | on the radio but answering nothing |
| no | silent | silent | a link problem, not a gun problem |

A dead gun that answers `$QUERY` but stays silent to `$LIFE` means v4.32 differs from V4_31 here. Record it: the node
then uses `$QUERY` alone.

**Reading.** If a dead gun answers `$LIFE,*` with `$HP,0,0,0`, the node has a 7-byte probe that returns state. On
`pool_stale: no_fire`, or after silence while LIVE, it sends `$LIFE,*`, and an `$HP,0,...` reply runs the existing
death and respawn path. If neither probe answers, the node falls back to inference, and the agreed rule is that it
does nothing on its own and escalates to the operator. Do not build on `$DD` unless it comes from the gun itself.

## 23. Spawn protection without the fn-28 twin table (F121, F209, F269, 15 min, session 2)

Today every life writes a fn-28 twin `$SIR` table (registers, no pool change) for spawn protection, then the live
table: **28 frames / 629 B / 49 packets per life**. The V4_30 disassembly shows that only `$CLEAR` zeroes the `$SIR`
table. `$SPAWN` and death do not. `$SPAWN` does zero every `$TMP` token, so t8 must follow the `$SPAWN` in the same
write. The protected life then costs `$SPAWN,,*`, `$TMP,,,,,,,,-100,,,,*`, `$TID`, `$AMMO` and `$BMAP,0,0`, and later
`$TMP,,,,,,,,0,,,,*`: **7 frames / 108 B / 8 packets**. `$STOP` covers the dead window, from the end of the head until
the spawn write. Run §12 and §21 first: this section builds on both.

Do not use `$INVU` for this: it sets the flag that forces team 2 later (§7).

1. **The table survives a death.** Kill B. Respawn B with `$SPAWN,,*` and `$TID,2,*` only, and re-send no `$SIR` rows.
   A hits B once. Expect `$HIR` and HP 9 to 0: the table outlived the death and the spawn.
2. **`$STOP` covers the dead window.** Re-arm B (999, 0, 0), then send `$STOP,*` to B. Hit B. Expect no `$HIR`.
   **Result 2026-09-18: DIFFERENT.** A hit still gave `$HIR,0,0,5,3,9,0,0`, but no `$HP` and no pool change
   (`$LIFE,*` read HP 990, i.e. the control's earlier hit, unmoved). `$STOP` blocks the damage, not the `$HIR`:
   refuted on the "expect no `$HIR`" point.
3. **The spawn write.** Send B `$SPAWN,,*`, then at once `$TMP,,,,,,,,-100,,,,*`, then `$TID,2,*`. Hit B 3 times.
   Expect `$HIR` for each hit and no pool change. If no `$HIR` arrives, the `$SPAWN` did not reopen reception: send
   `$START,*`, re-send B's `$GSET` (§12), and repeat. Record which case you saw, because the second case adds two
   frames to every life.
   **Result 2026-09-18: first attempt CONFOUNDED by step 2's `$STOP`, which `$SPAWN` did not lift** (`$HIR`
   arrived with no `$HP` here and after step 4's t8 = 0 write too; only `$START,*` plus a `$GSET`/`$TID` re-send
   restored damage). `$HIR` token 1 read 0 while stopped and 4 once live again, same rig word: unexplained,
   recorded as an observation only. **Clean redo, from a live gun: CONFIRMED.** `$SPAWN,,*`,
   `$TMP,,,,,,,,-100,,,,*`, `$TID,2,*`, three hits: each gave `$HIR,4,0,5,3,9,0,0` and `$HP,999,0,0`, registered
   with zero damage. This is the record.
4. Send `$TMP,,,,,,,,0,,,,*`. Hit B once. Expect 9 damage. **Result 2026-09-18: CONFIRMED**, on the clean-redo gun:
   `$HP,990` (999 to 990).
5. **Order control.** Send `$TMP,,,,,,,,-100,,,,*` first, then `$SPAWN,,*` and `$TID,2,*`. Hit B once. Expect 9
   damage: the spawn zeroed t8. **Result 2026-09-18: CONFIRMED**, `$HP,990` (999 to 990). **Design rule, from
   steps 2 and 3's confounded run: anything that sends `$STOP` must send `$START` before the next life**, because
   `$STOP` survives `$SPAWN` and keeps blocking damage until explicitly lifted.

Notes for the design, from the disassembly:
- There is a window of 1 to 2 frames after `$SPAWN`, because t8 cannot go first.
- Protected hits still flash and sound. A splash row (p6) on a protected player still re-emits the hit.
- t8 does not block a p5 stun, the fn 23 smoke or a fuse.
- The S50 damage-resist perk also wants t8, so one owner on the node must compute t8.
- The A17 per-life sound re-roll is lost. Keep a `sir_pool` take only when `hit_audio_class` is on.

**Reading.** If steps 1, 3 and 4 hold, the live table goes out once per arm. `sir_spawn_protected()` in `compile.py`
and the per-life `sir_pool` take in `engine.js` can go, and the per-life write falls from 49 packets to 8.

## 24. The secondary-fire proc block, `$WEAP` t7-t11 (10 min, needs the IR rig)

V4_31 shows live code for a secondary fire on every shot: t7 is the chance in %, t8/t9 the `<proto,sub>` key, t10 the
damage and t11 the crit %. When the roll hits, that shot goes out on the secondary key instead. The bench AR ships
t7-t11 empty. A proc of this kind (a taser, poison or burn round) costs no node writes and works with MC off line. The
trace notes "+60 damage in one fire mode", so use a plain full-auto weapon: the bench AR.

1. Push A's bench AR with t7 = 100, t8 = 12, t9 = 0, t10 = 5 (t11 empty). Fire 10 single shots at the IR rig. Expect
   every word to read protocol 12, damage 5.
2. Push it again with t7 = 50. Fire 20 single shots. Expect about half on protocol 12 (damage 5) and the rest on
   protocol 0 (damage 9).
3. Push it again with t7 = 0. Fire 5 shots. Expect protocol 0 only: the control.

Record the crit bit on every secondary word.

**Reading.** If step 1 holds, a random proc per shot is a compile-time `$WEAP` field, and Jay's JEDGE ideas ("chance
to poison", "chance to TASE") need no node logic.

## 25. The `$*` parser reset (screamers A4, 10 min, session 3)

**CODE-READ, NOT BENCH-PROVEN (v4.32, 2026-09-21):** the parser resets only token 0 and the token index when it
reads `$`; tokens 1..59 remain. On `*` it snapshots the working set, dispatches, and the common return path clears
all 60 working tokens. A bare `$*` therefore dispatches an unmatched empty command and reaches that full cleanup.
There is no inter-byte timeout. So a frame that loses its `*` leaves stale tokens behind, and the next frame, even a
resend of the same frame, lands on them unless `$*` closes and cleans the partial frame. The old
screamers A4 used `$QUERY`, which ignores its tokens, so it could not see this. This section replaces it, on one gun
armed with the bench AR.

1. **Control.** Send `$AMMO,0,10,50,1,*`, then `$AMMO,0,23,50,1,*`. Read the magazine from the next `$ALCD` (fire one
   round if the gun sends none, and add one back). Expect 23.
Steps 2 and 3 are blocked until F269's raw-byte helper records each chunk after the GATT write completes. The
stage's current TX log records intent before connection/write admission and is not transport proof.

2. **No reset.** Send `$AMMO,0,10,50,1,*`. With that helper, write `$AMMO,0,17,50,1` and require its post-write
   chunk record, then send `$AMMO,0,23,50,1,*` normally and read the magazine. V4_30 predicts a BAD FRAME: not 23.
3. **With the reset.** Repeat step 2, then use a separate helper write for `$*` before the complete 23-round frame.
   Require post-write chunk records for the incomplete write and `$*` in that order. Expect 23.

Run steps 2 and 3 three times each (the screamers sheet's rule for a result that counts).

**Reading.** If step 2 fails and step 3 passes, the link sends `$*` (2 B) before each burst and before every resend in
`brxlink.write`, and a lost packet costs one frame, not two. This becomes a Phase B rule in the screamers sheet.

## Close

1. Power-cycle both guns. Then re-arm with `$SIR,0,0,,1,0,0,1,,*` if they stay on the desk.
2. Write one experiment-log entry with every table, including the null results and the control runs.
3. Mark every row of the claim checklist in the log entry.
4. Update the FOLLOWUPS rows: F206, K4, F65, K7, F121, P18/S16, F62, S50, F264, F209, F269 and the
   transport-hardening rows. Correct
   `protocol/brx-protocol.md` for each confirmed claim, and move it into `docs/manual/` only when it is CONFIRMED.
   Credit LaserTagMods (Jay).

## 26. The recoil NUMBERS: is the shipped ladder good to play with? (65 min, run §21 FIRST)

⚠ **SUPERSEDED 2026-09-23.** This section's table and its "twice `after_shots`" derivation predate S54/F268/F280:
the ladder now keys off ROUNDS PER TRIGGER PULL, scaled by calibre, not off the ladder's depth, and the Assault
Rifle carries its own deeper exception (F291). Current numbers and tests are `docs/weapon-design.md`'s Balance
rules table (rows 1 and 3) and `docs/spec/node.md` §3.15's table. The bench QUESTION below (does the shipped
ladder feel right) is still open; only the numbers it was written against are stale.

⚠ **Run §21 before this section.** §21 asks what writes accuracy. If `$TMP` t4 is the lever, and if it self-decays the
way fn 23's accuracy penalty does, the recovery write leaves the ladder and `settle_ms` stops being a number we
choose. Every step below still runs, but four of them change. "If §21 moves the mechanism", at the end of this
section, says which.

§21 tests the MECHANISM. The screamers sheet tests the ENDURANCE (A13, and Phase C's `recoil-oscillate` soak, which is
F274's gate). This section tests neither. It asks the one question with no bench behind it: are the numbers the node
ships today good to play with? Nobody has yet fired a magazine at them.

**What ships today** (`spec/node.md` §3.15). Accuracy is CRISP, then DEGRADED once one burst reaches `after_shots`
rounds, then HEAVY at `after_heavy`. `settle_ms` of quiet (600 ms) returns it to crisp in one step. Every row below is
DERIVED, because `weapons.json` declares none of these fields (S54): `degraded` is the midpoint of the old ladder and
`after_heavy` is twice `after_shots`. The last two columns are not in the spec. They come from the same catalogue, and
they are the reason this section exists:

| weapon | crisp / degraded / heavy | after_shots / after_heavy | magazine | ms a round | rounds at heavy |
|---|---|---|---|---|---|
| assault_rifle | 100 / 85 / 70 | 3 / 6 | 32 | 100 | 27 of 32 |
| burst_rifle | 100 / 92 / 85 | 3 / 6 | 36 | 75 | 31 of 36 |
| smg | 100 / 77 / 55 | 3 / 6 | 72 | 95 | 67 of 72 |
| suppressor | 100 / 77 / 55 | 3 / 6 | 75 | 140 | 70 of 75 |
| energy_rifle | 100 / 85 / 70 | 3 / 6 | 300 | 150 | 295 of 300 |
| force_rifle | 100 / 80 / 60 | 4 / 8 | 36 | 100 | 29 of 36 |
| stinger | 100 / 72 / 45 | 7 / 14 | 18 | 250 | 5 of 18 |
| toxin_rifle | 100 / 82 / 65 | 4 / 8 | 30 | 110 | 23 of 30 |

**Two judgements ship in that table, and neither has evidence (F268).** The first: three floors are PROPOSED at 60 and
are not shipped. The SMG and the Suppressor derive 55 and the Stinger derives 45, on the reading that a weapon which
lands 39 % of its rounds is removed from the fight rather than penalised. The second: `after_heavy` is twice
`after_shots` on no evidence at all, only on an honest reading of what the two stages mean ("you are holding the
trigger", then "you are still holding it").

### Setup

**A = shooter**, **B = victim**, as in "Roles and arming". Rest both guns on a fixed mount at close range with the
victim's sensor exposed, so aim is not a variable in any run. Groups C, D and E need the phone running the node,
armed by MC with the weapon under test, because the phone is what drives the ladder.

Rules for this section, on top of the sheet's rules:

1. Count rounds FIRED from `$ALCD` magazine decrements, never from trigger pulls: fire mode 14 can release two rounds
   on one press.
2. Count hits from B's `$HIR`, and read `$HIR` token 2 before you trust one.
3. Start each group with its accuracy-100 control run. Throw the group away if the control does not land nearly every
   round. The 2026-09-17 reading of 7 hits in 18 rounds came from the native WALK across a band of values, so it is
   not a control for a pinned floor.
4. Keep the mount, the distance and the battery pack the same for the whole section. A pack change moves the emitter.
5. If the IR rig is on the bench, fire at the rig as well as at B for groups A and D. The rig reports the
   magnitude-0 words, so it separates a firmware miss from a beam that missed the sensor. B alone cannot tell those
   two apart.
6. Record the value, not pass or fail. Every run gets rounds fired, hits, and the seconds it took.

### Group A: what does an accuracy number buy? (18 min)

Arm A with the bench AR. Pin accuracy the way the node does: push the AR `$WEAP` with t21 and t22 both set to the
value, then restore the magazine with `$AMMO`, because a `$WEAP` push resets it.

1. Control: pin 100. Fire 20 rounds at B and count `$HIR`. Expect 20. Do not go on until it reads 20.
2. Pin 85, then 70, then 60, then 55, then 45. Fire 20 rounds at each value, twice at each.
3. Write the pairs down as a curve: pinned accuracy against hits in 20.

**Reading.** This is the exchange rate every floor trades in, and we have never measured it on our own guns. F268
proposes raising three floors from 55 and 45 to 60, so read what those rows differ by. If 55 lands about half the
rounds and 60 lands a little more, the premise that a 55 floor removes a weapon from the fight does not hold, and the
floors stay where they are. If the curve falls away sharply below 60, the raise is right and the curve also says where
the knee is, which no guess can.

### Group B: what does a floor cost in kills? (10 min)

A hit percentage is not a feeling. Time on target is.

4. Re-arm B (100, 0, 0). With A pinned at 100, hold the trigger and record the rounds and the seconds it takes to kill
   B. Twelve hits of 9 kill that pool. Respawn B and repeat three times.
5. Repeat at 70, then at 55.

**Reading.** Report each floor as rounds per kill and seconds per kill, against the 100 control. A floor that adds
under a second to a kill penalises a player. A floor that needs more than half a magazine for one kill removes the
weapon, which is exactly F268's claim, now with a number under it.

### Group C: can the shooter tell the two rungs apart? (12 min, blind)

This is the second judgement, and only Tony can answer it. He fires. A second person arms the profile, and he does not
see which.

6. Prepare two profiles on the AR: **L**, the shipped ladder, driven by the phone as it is in a match; and **F**, flat
   crisp, the control.
7. Fire eight magazines, trigger held, at B: four L and four F, in a shuffled order the shooter does not know. After
   each magazine, and before anyone says which was armed, write down his answers. Did it degrade, yes or no? At about
   which round did he first notice? Did he notice a SECOND change, and at about which round?
8. Show him the order only after the eighth magazine.

**Reading.** Record how many of the eight he called correctly, and his round numbers in his own words. Fewer than six
correct means the ladder is not perceptible, and no number under it is worth tuning at a bench. A shooter who calls
the first change every time but never a second means the two rungs are too close: either `after_heavy` sits too near
`after_shots`, or 85 and 70 are too near each other to hear. The round numbers he names are the real answer to
"is double the right ratio", because they say where he feels each step against the derived 3 and 6.

### Group D: where do the rungs sit in a magazine? (6 min)

9. Fire one full magazine, trigger held, on each of the AR (32 rounds), the SMG (72) and the Stinger (18). Log each
   write with the round number that caused it, from the phone's log or from `$ALCD` token 2.

**Reading.** Compare the round numbers with the table at the top of this section. On today's derivation the AR reaches
heavy at round 6 of 32 and the SMG at round 6 of 72, so HEAVY is not the bottom of a ladder: it is what a held trigger
feels like for the rest of the magazine. Only the Stinger spends most of its magazine above the floor. If that is
wrong for play, the lever is `after_heavy` and the magazine it is measured against, not the floor value.

### Group E: does the ladder pay for trigger discipline? (9 min)

The ladder exists so that short bursts beat a held trigger. Nothing has measured whether they do.

10. Three firing styles on the AR at the shipped ladder, against B re-armed (999, 0, 0). One magazine each, twice:
    hold the trigger for the whole magazine; five rounds then release for 1 s, repeated; single shots at about one a
    second.
11. Record rounds fired, hits, and the seconds from the first round to the last. Work out hits a second for each style.

**Reading.** If the held trigger still wins on hits a second, the floor is too kind to change anyone's behaviour. If
single shots win by a wide margin, full auto is not worth firing and the floor is too harsh. `settle_ms` is what makes
the middle style work, so note as well whether the 1 s gap was enough for the first rounds of the next burst to land.

### Group F: Tony's own words (5 min)

Write the answers into the log verbatim, after the runs and before anyone reads the numbers back:

- Does a degraded weapon feel penalised, or broken?
- Is 600 ms of quiet the right price for full accuracy: too generous, or too slow?
- Should the second rung come later, bite harder, or go?

### If §21 moves the mechanism

**§21 answered 2026-09-18:** t4 is absolute, it does not decay by itself (it held 60 s), and a `$WEAP` push does not clear it. So only the first bullet below applies: pin groups A and B with `$TMP` t4. Groups C, D and E run on the phone's node. Run them after Tony settles the rung basis (F268, F280), so that they measure the numbers that will ship.

- Groups A and B pin accuracy with one `$TMP` t4 write instead of a `$WEAP` push, so there is no magazine reset and no
  `$AMMO` restore. The numbers themselves do not change: they are about the VALUE, not about the writer.
- If t4 is additive (§21 step 4), send `$TMP,,,,0,*` before each pin in group A, or the values stack.
- If t4 self-decays (§21 step 5), `settle_ms` is not ours to choose. Group E stops asking whether 600 ms is right and
  starts measuring what the gun does: fire to heavy, stop, and read `$ALCD` token 2 every second until it returns.
- If t4 self-decays, group C's second rung can also recover during a magazine, so read the rungs from `$ALCD` token 2
  rather than from the node's log.
- If a `$WEAP` clears t4 (§21 step 2), group D must re-pin after every weapon swap, and the node gets a free re-arm at
  crisp on each swap.
- If `$TMP` does nothing, every step above runs as written, on `$WEAP` t21 and t22.

### What this bench cannot settle

Every run here shoots a target that does not move, does not shoot back and does not take cover. The bench gives what a
number buys in hits, in seconds and in kills, and whether a player can feel the two rungs at all. It cannot say
whether a floor is fair in a game. Take that last part to the next playtest: log rounds per kill by weapon for each
player, and ask each player which weapon felt broken. The bench numbers plus one playtest answer close F268. The bench
alone does not.

## Close

1. Power-cycle both guns. Then re-arm with `$SIR,0,0,,1,0,0,1,,*` if they stay on the desk.
2. Write one experiment-log entry with every table, including the null results and the control runs.
3. Mark every row of the claim checklist in the log entry.
4. Update the FOLLOWUPS rows: F206, K4, F65, K7, F121, P18/S16, F62, S50, F268 and the transport-hardening rows. Correct
   `protocol/brx-protocol.md` for each confirmed claim, and move it into `docs/manual/` only when it is CONFIRMED.
   Credit LaserTagMods (Jay).
14:| 6. Recoil numbers | 65 min | two guns, a phone running the node, a static mount (the IR rig helps) | §23, and only after §21 |
