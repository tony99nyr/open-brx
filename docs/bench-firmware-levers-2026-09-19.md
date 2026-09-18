# Bench: verify the firmware findings (2026-09-19)

This sheet verifies, on our v4.32 guns, every claim that the 2026-09-18 analysis of Jay's Drive produced. It runs as
five sessions. Run them in order. Session 1 decides how much the rest is worth: if `$STUN` and `$BUMP` do nothing,
v4.32 has drifted from V4_30, and the later sessions shrink.

| session | time | needs | sections |
|---|---|---|---|
| 1. Core | 45 min | two guns | §1 (F206, confirms the shipped fix), §2 (melee), §4 step 1, §5 (all of it, one session: each step starts from the one before), §13 step 1 |
| 2. Levers | 75 min | two guns, the IR rig for §9 step 5 | §3, §4 step 2, §6, §7, §8, §9, §10, §12, §15, §18 |
| 3. Transport | see the screamers sheet | one gun, a laptop | §14 (now `bench-screamers-2026-09-19.md` Phase A) |
| 4. IR rig | 90 min | two guns, the ESP32 IR rig | §11, §13 steps 2-3, §16, §17, §20 |
| 5. Gap sweep | 90 min | two guns, the IR rig for two steps | §19 |

**Claim checklist.** Tick each claim in the experiment log as CONFIRMED, REFUTED or DIFFERENT (and how). A claim
reaches `docs/manual/` only when it is CONFIRMED here.

| # | claim (source) | § |
|---|---|---|
| 1 | One team byte; `$PSET` t2 overwrites `$TID`; our re-sent `$PSET` caused F206 (V4_31) | 1 |
| 2 | Melee (t1 = 1) is emitted by the headset through `$IRTX`, at range t2; `$FIREX` fires a slot (sheets, V4_31) | 2 |
| 3 | `$BHIT` injects a hit through the full `$SIR` path (V4_30, sheets) | 3 |
| 4 | `$STUN,<ms>` stuns; `$SIR` p5 of 64 or more stuns on hit (V4_30) | 4 |
| 5 | `$BUMP,<amount>,<hp>,<armour>,<shield>,<sound>` cascades across pools (V4_30, sheets) | 5 |
| 6 | `$LIFE` token 4: 0 add, 1 set, 2 set past max; set revives a dead gun (V4_30, sheets, BC app) | 6 |
| 7 | `$SPAWN,<n>` spawns with shield n (V4_30) | 6 |
| 8 | `$PRES` scales damage per cell; `$INVU` blocks damage; `$TMP` bonuses (V4_30) | 7 |
| 9 | fn 24-27 are 5/4/3/2 s fuses; p5 is the cell the fuse fires (V4_30, sheets) | 8 |
| 10 | The crit bonus is `$PSET` t6 (we ship 50), scaled by `$GSET` t7 (V4_31, sheets) | 9 |
| 11 | fn 34/35 register on a dead gun; fn 38 halves HP damage; fn 30 back x2; fn 33 silent kill; fn 50-52 colour only (V4_30) | 10 |
| 12 | `$SIR` p6/p8 make the victim re-emit the hit (splash) (V4_30, sheets) | 11 |
| 13 | `$STOP` closes and `$START` opens IR reception (V4_30) | 12 |
| 14 | The gun sends `$DD,<killer>,<team>` when it dies (Jay's code); a kill confirmation is a protocol-15 subtype-0 IR word (BC's UART sheet) | 13 |
| 15 | Split frames get lost; bursts overflow; `$DPLAY` on a loop sound hangs the gun (V4_31) | 14 (screamers sheet Phase A) |
| 16 | `$RADSK` every 4 s keeps a headless gun linked (Jay's code, V4_31) | 15 |
| 17 | `$IRTX` type 14 to a downed ally is a revive beam, read via fn 34 (BC app) | 16 |
| 18 | Protocol-15 station words: magnitude 6 respawn, 8 perk, 10 proximity, 50 capture (Jay's code) | 17 |
| 19 | `$LCD` t3 = shield, t4 = slot; `$QUERY` t2 = team; `$VERSION` t3/t5 meanings (V4_30, BC app) | 18 |
| 20 | Every other open item the triage of FOLLOWUPS against the new sources found untested | 19 |
| 21 | Range tokens set the IR carrier frequency: 38000 - 125 x (100 - range) Hz on the gun, 140 Hz steps on the headset; indoor/outdoor sets power (V4_31) | 20 |

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
  (`$INVU`, `$TMP`).

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

Steps:
1. **Control.** Send `$MELEE,255,*`, then `$XYZZY,255,*`. Does each one give `$BUT,4,0`? If the unknown command
   also answers, `$MELEE` proves nothing.
2. Re-arm A with our melee `$WEAP` as MC ships it, but in slot 7. Send `$BMAP,8,7`. Swing at B's headset from
   30 cm. Watch A for `$BUT,8` and B for a `$HIR` with token 2 = 13.
3. Repeat with slot 4 and `$BMAP,8,4` (today's frames), so the two runs compare directly.
4. Watch the headset during a swing. Does it flash or emit? Point the IR rig at the headset domes, not the barrel,
   and count words per swing. No word from the headset means the `$IRTX` hand-off to the headset fails.
5. **Control with no gyro:** send `$FIREX,4,*`. V4_30 has this command. If the headset emits and B registers, the
   IR path works and any fault is in the swing detection.


**Reading.** A headset word on the rig with no `$HIR` on B points at aim or range (the swing leaves the head, not the
gun). No headset word at all points at the gun-to-headset hand-off. A hit in slot 7 and none in slot 4 closes K4 another
way. `$BUT,8` with no `$HIR` on either slot points at the
emitter (the headset LED or its range), not the binding.

## 3. `$BHIT`: can the host inject a hit? (10 min)

V4_30 parses `$BHIT,<proto>,<shooterId>,<team>,<damage>,<crit>,<subtype>,<sensor>,*` and runs it through the same
hit handler as a real IR word. A dead gun drops it. If v4.32 does the same, MC or the phone can apply any `$SIR`
row with no IR. That covers zone damage, a poison tick with attribution, and a recovery after a desync (F208).

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
2. Set `$SIR,0,0,,1,3000,0,1,,*` on B (plain damage, with p5 = 3000). Hit B once, then have B pull its trigger for
   5 s at once.

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

## 6. `$LIFE` set mode, and `$SPAWN` shield (K7, 10 min)

- `$LIFE` has a 4th token: 0 adds (what we use), 1 sets the pools to exact values with a clamp, 2 sets them with no
  clamp.
- `$SPAWN,<n>,*` spawns with **shield n**. K7 is blocked because no BLE command grants a shield (P16, F60).

Before this section, re-arm B (45, 70, 60). Set mode needs an armour maximum above 0, and step 3 needs a shield
maximum of 50 or more.

1. On B, send `$LIFE,30,10,0,1,*`. Expect HP 30 and armour 10 exactly, whatever the start values.
2. Send `$LIFE,500,0,0,2,*`. Does HP go above the maximum?
3. Send `$SPAWN,50,*`, then `$TID,2,*`. Read `$LCD`: is token 3 (shield) 50, with HP 45 and armour 70? Then fire
   three hits. Does the shield absorb them first (shield 23)?
4. Kill B. Then, on the **dead** B, send `$LIFE,30,0,0,1,*`, which is the 2018 app's revive. Does B come back to life?
   The kill left an HP maximum of 9, and set mode clamps, so a revive shows HP 9.

**Reading.** If step 3 works, K7 (shields as a game option) is unblocked. If step 4 works, a revive can happen with
no respawn.

## 7. `$PRES`, `$INVU` and `$TMP`: the native perk system (S50, 15 min)

- `$PRES,<proto>,<sub>,<pct>,*` multiplies damage for one cell by (100 + pct)/100.
- `$INVU,*` sets incoming damage to x0.
- `$TMP` holds maximum-pool bonuses (t1 HP, t2 armour, t3 shield), incoming damage % (t8) and a magazine % bonus
  (t9).

B arrives from §6 step 4 with a 9 HP maximum. Before step 1, re-arm B (999, 0, 0), so the hits below
cannot kill it.

1. On B: `$PRES,0,0,-50,*`. Fire 3 hits. Expect 4 each (9 x 0.5, truncated).
2. On B: `$PRES,0,0,100,*`. Expect 18 each. Then send `$PRES,0,0,0,*` to reset it.
3. On B: `$INVU,*`. Fire 3 hits. Do they register (`$HIR`) with no damage? Then send `$TMP,,,,,,,,0,,,,*` (t8 = 0).
   Does damage return? If it does not, note it and power-cycle B.
4. On B: `$TMP,50,,,,,,,,,,,*` (HP maximum +50). Then `$BUMP,999,1,0,0,,*`. Does HP heal above the old maximum?
5. On A: `$TMP,,,,,,,,,50,,,*` (magazine +50%). Read `$ALCD`: did the magazine grow by half a clip?

**Reading.** Each command that works replaces a perk that we now fake with extra `$WEAP` or `$LIFE` traffic.
`$PRES` is the Body Armor and Armour Piercing lever for each weapon family.

## 8. The fn 24-27 fuse, timed (P18, S16, 10 min)

V4_30 gives fn 24, 25, 26 and 27 fuses of 5.0, 4.0, 3.0 and 2.0 s. On 09-18, fn 24 replayed forever every 5.07 s.
The code explains the loop: in app mode an expired fuse injects a **protocol-9** word, and `<9,3>` was fn 24 at the
time. Also, `$SIR` p5 on these rows is a cell key (low nibble = protocol, high nibble = subtype).

1. On B, send `$SIR,0,0,,24,0,0,1,,*` and `$SIR,9,3,,1,0,0,1,,*` (as MC ships `<9,3>` today). Fire **one** shot. Log
   every `$HIR` and `$HP` for 20 s, with times.
2. Repeat with fn 25, fn 26 and fn 27. Time the gap from the real hit to the delayed one.
3. On B, send `$SIR,0,0,,24,10,0,1,,*` (p5 = 10, which points at cell `<10,0>`) and `$SIR,10,0,,1,0,0,1,,*`. Fire
   once. Does the delayed hit land as protocol 10?

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

## 12. Reception gate (F121, 5 min)

V4_30 drops every IR word while the gun is not `$START`ed ("not start"). Send `$STOP,*` to armed B and fire. Then
send `$START,*` and fire. If the first shot registers nothing and the second registers, MC can close F121 by
sending `$STOP` until spawn.

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
lock-up under the old S42 writer = A13, §14.4 `$DPLAY` = A1-A3, §14.5 recovery = the recovery rule in that sheet's
rules.

**Reading.** A13 gives the per-gun traffic budget that the hardening work designs to. If it locks up in minutes,
the removed S42 writer's rate was a screamer cause, and no future writer may come near that rate.

## 15. A headless gun and `$RADSK` (10 min)

Our docs say a gun with no headset answers `$PING` and then drops the phone link within about 6 s. Jay's ESP32 code
sends `$RADSK,*` every 4 s as a stand-in headset, and the V4_31 gun sends `$RADSK` to its own headset every 3 s as a
link check.

1. Power B with its headset switched off. Connect and time how long the link holds. Do it twice.
2. Reconnect, and send `$RADSK,*` to B every 4 s. Does the link now hold for 2 minutes?

**Reading.** If it holds, a Companion or the bench can drive a gun with no headset, and the node has a cheap
keepalive.

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

**Reading.** Type-14 `$HIR` frames on a dead B mean a teammate revive runs through the taggers themselves. Also note
whether A's `$IRTX` leaves the gun or the headset.

## 17. Station words (15 min, needs the IR rig)

Jay's JBOX code sends protocol-15 words whose magnitude selects the station function. Emit each one with `ir-emit`
at an armed B that carries our current station rows, and record B's `$HIR`, pools and sounds:

| word (protocol, player, team, magnitude, crit, subtype) | Jay's meaning |
|---|---|
| 15, 63, B's team, 6, 1, 0 | respawn |
| 15, 0, B's team, 50, 0, 0 | control point captured |
| 15, 63, B's team, 8, 0, 0 | perk or KOTH pulse |
| 15, 63, B's team, 10, 0, 0 | proximity |

Also test Jay's changelog rule for respawn stations: a dead gun needs **two** respawn pulses within 9 s. Send one
pulse, wait 10 s, send one more; then send two pulses 3 s apart.

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
12. **`$TMP` untraced tokens (S50, F87).** `$TMP` t4 = -100, then t5 = 50, t6 = 50 and t7 = 50, one at a time. Time the
    fire interval, the reload and the damage dealt after each. Reset with a power cycle.
13. **A bare `$LIFE,*` (F208, F163).** The 2018 BC app polls with it after 5 s of gun silence. Does an armed gun answer
    with `$HP`? If so, the node has a side-effect-free health probe.
14. **fn 23 by ear (B27, F66).** V4_30 says fn 23 only changes accuracy. Take one hit and listen: is any audio cut?
15. **Two-emitter weapons (F71).** Fire the Shotgun (t1 = 2, gun and headset) at the IR rig. Count words per pull.
16. **Melee extras (K4).** Log every frame A sends during a swing. Confirm B's `<13,1>` row is a damage function.
17. **`$AS` lock (P4), with care.** Send `$AS,4,0,0,0,0,0,75,*` only (Jay's "lock between games"). Does the menu lock?
    **Do not send `$AS,1`**, which starts a native game.
18. **The factory menu (F230), read only.** On the gun whose accuracy walks and one steady gun, open the USB `SETUP`
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

## Close

1. Power-cycle both guns. Then re-arm with `$SIR,0,0,,1,0,0,1,,*` if they stay on the desk.
2. Write one experiment-log entry with every table, including the null results and the control runs.
3. Mark every row of the claim checklist in the log entry.
4. Update the FOLLOWUPS rows: F206, K4, F65, K7, F121, P18/S16, F62, S50 and the transport-hardening rows. Correct
   `protocol/brx-protocol.md` for each confirmed claim, and move it into `docs/manual/` only when it is CONFIRMED.
   Credit LaserTagMods (Jay).
