# `$SIR`: the incoming-IR effects matrix
_What an IR hit does to this gun is decided by the victim's table, not by the shooter's weapon. This page shows how to write that table._
Last verified: 2026-08-27

## The key idea.
An incoming IR word carries a 4-bit protocol (B) and a 2-bit subtype (U). The victim looks up the `$SIR` row with that `<protocol, subtype>` key; the row's **function** decides what the word's 8-bit magnitude is applied to: damage, heal, armor, shield, or a status. **No matching row → the hit is silently ignored.** The same is true of a **wrongly-teamed** shot: damage applies only from an enemy team and support only from your own, and a rejected frame emits **no `$HIR` at all**. It never reaches BLE. 16 × 4 = 64 addressable cells, all writable per game over BLE.
Source: protocol/brx-protocol.md §5; protocol/brx-ir-protocol.md

## Format:
`$SIR,<irProtocol>,<subtype>,<soundID>,<function>,<p5>,<p6>,<p7>,<p8>,*`
- `<soundID>` plays **on the victim** when the row fires (`VA16` "armor suit", `VA8C` "shields online", `H29` stim-pack).
- `<p5>–<p8>` do **not** scale damage (`0,0,1`, `0,50,1`, `0,100,2,60`, `0,200,2,60`, `50,100,2,60` all landed exactly the magnitude).
- Max distinct IR recognitions per game: 14 (community figure).
Source: protocol/brx-protocol.md §5; docs/experiment-log.md (clean negatives)

```text
# The stock 10-row table the official app sends (Team Arena):
$SIR,0,0,,1,0,0,1,,*        standard weapons (AR, SMG, snipers, shotgun…): plain damage
$SIR,0,1,,36,0,0,1,,*       Force Rifle / Sniper Rifle: fn 36 (floor of magnitude ×1.25)
$SIR,0,3,,37,0,0,1,,*       AMR / Bolt Rifle / Burst Rifle: fn 37 (magnitude ×2)
$SIR,1,0,H29,10,0,0,1,,*    respawn + add HP
$SIR,2,1,VA8C,11,0,0,1,,*   add shields
$SIR,3,0,VA16,13,0,0,1,,*   add armor
$SIR,6,0,H02,1,0,90,1,40,*  Rail Gun
$SIR,8,0,,38,0,0,1,,*       Charge Rifle
$SIR,9,3,,24,10,0,,,*       Energy Launcher (fn 24 is a no-pool status; deals zero damage as shipped)
$SIR,10,0,X13,1,0,100,2,60,* Rocket Launcher
$SIR,11,0,VA2,28,0,0,1,,*   Tear gas
$SIR,13,0,H50,… / 13,1,H57 / 13,3,H49   Energy Blade / Rifle Bash / War Hammer (melee)
```
Source: protocol/brx-protocol.md §5; docs/experiment-log.md (shipped-table consequence)

## Function map
measured at magnitude 20, baseline HP 45 / armor 70 / shield 0, **at the gun-body sensor (`$HIR` tok1 = 4) from ~40 cm**. Protocol independence is measured for 10 of the 41 functions (fn 1, 3, 8, 23, 24, 25, 26, 27, 28, 35). Those ran on the enemy team at subtype 0 only, across protocols 0, 5, 7, 9 and 10. That is 50 cells, none of which varied. Applying the result to the grant and ally functions is an extrapolation, not a measurement. Whether a **headset-dome** hit behaves the same is **untested**. The two multiplier functions, 36 and 37, were measured again on 2026-09-02 across magnitudes 20, 40, 9 and 7 and across 8 different `$SIR` row-tail shapes, 16 trials, each with an fn 1 control that had to read the magnitude exactly. The row tail does not change the multiplier.
| Class | Function ids | Measured behaviour | Polarity | Conf |
|---|---|---|---|---|
| Standard damage | 1, **3**, 4, 5, 7, 29, 30, 33, 38 | −20 per hit, drains shields → armor → HP | enemy only | ✅ |
| **Armor-piercing** | 2, 6 (+17, 21 enemy-side) | HP 45→25→5 with armor **and shields** untouched | enemy only | ✅ |
| **×1.25 damage (truncated)** | 36 | magnitude 20 lands as **25**, 40 as **50**, 9 as **11**, 7 as **8**. The result is the **floor**: 7 × 1.25 = 8.75 lands as 8, not 9 | enemy only | ✅ |
| **×2 damage** | 37 | magnitude 20 lands as **40**, 40 as **80**, 9 as **18**, 7 as **14** | enemy only | ✅ |
| Add HP, overflow → armor | 9, 12, 16, 19 | 15→35→45, then +armor | ally only (16/19 also damage enemies) | ✅ |
| Add HP, clamp | 10, 17 | 15→35→45, no overflow | ally only (17 also AP-damages enemies) | ✅ |
| Add HP, overflow → shield | 14, 21 | 15→35→45, then +shield | ally only | ✅ |
| Add armor | 13, 15, 20, 22 | 0→20→40; overflow spills to shields | ally only (20 also strips enemy armor) | ✅ |
| Add shield | 11, 18 | 0→20→40 | ally only | ✅ |
| **`$ALCD` token-2 drop** | 23 | Registers a hit, no pool change; `$ALCD` token 2 drops 100→0 and recovers over ~6–8 s while the gun keeps firing. The state clears on `$SPAWN,,*`. | enemy | ✅ |
| Registers, no pool change | enemy 8, 24, 25, 26, 27, 28, 35 · ally 31, 32, 34 | `$HIR` fires, pools unchanged, no other frame. The enemy functions were verified identical on protocols 0/5/7/9/10, including **fn 28 on protocol 5**, which an earlier draft of the row below listed as non-registering. The ally functions were not protocol tested. **Two measurement artifacts apply to this row.** The victim started every trial at full health: HP 45, armour 70. A heal or armour grant into full pools is clamped, so it reads as "no pool change". That is what mis-binned **fn 10**, which is separately confirmed as respawn plus add HP. The shield started at zero, so a function that drains only shield also read as no change. **That second artifact has since been closed by re-testing with a shield granted first, and it caught one wrong entry: fn 3 drains shield exactly as plain damage does, so it has moved to the damage class.** The seven functions left in this row moved no pool with 150 shield available, so for them the reading is real. | n/a | ⚠️ scoped |
| No registration | 0, 39–45 | n/a | n/a | ✅ 0/39/40 re-measured 2026-08-27; 41–45 not re-tested |
Source: docs/experiment-log.md (2026-08-26 complete two-sided $SIR map; 2026-08-27 fn 23; 2026-09-02 fn 36/37 multipliers)

## Support functions are team-gated in firmware.
With `$GSET` friendlyFire = 0, heals/armor/shield grants register **only from a same-team source**, and damage registers only from another team. Set friendlyFire = 1 and everything lands from anyone. A medic gun enforces "allies only" with zero host logic.
Source: protocol/brx-protocol.md §5; docs/experiment-log.md (dual-polarity, FF table)

_[diagram DEV-07: Damage pipeline: IR word (B,U,D,C) → victim `$SIR[B,U]` → function multiplier → ×(1 + `$GSET` t7/100) if crit → drain shields → armor → HP → emit `$HIR` + `$HP`.]_

- **applied = magnitude × fn multiplier × (1 + `$GSET` t7/100 if crit)**: the crit modifier is a **per-game tunable**, not a fixed ×1.5: t7=0 disables crits, t7=100 doubles. ×1.5 is simply the shipped t7=50. Exact at seven levels, 3/3 each. ✅
- **Drain order: shields → armor → HP.** Armor absorbs 1:1 with no per-hit cap; overflow spills into HP (a sniper's 80 split exactly 70/10). ✅
- **Heals clamp** at the pool max. Magnitude 200 is a fill, not a stack. ✅
- **No function is a damage-over-time.** 18 s watched after each status hit: no ticks. ✅
- **Dead guns accept no IR at all.** ✅
Source: protocol/brx-protocol.md §7r addendum; docs/experiment-log.md (tok5 raw magnitude, AP, heals clamp, DoT negative, 448-word brute force)

- **Is there a stun?** None found. `$STUN` over BLE is a no-op, and fn 23 (the only function that visibly changes anything without touching a pool) leaves the gun firing.
- **Can I read a native game's `$SIR` table?** No. The gun never reports it. Capturing an ability's IR word tells you its protocol, not what a native victim binds to it.
- **Which protocols are free?** Stock uses 0, 8, 10, 11, 13 and 15 (grenade beacon); the app's table also ships rows on 1, 2, 3, 6, 9. Truly unused: 4, 5, 7, 12, 14. Every cell is still re-definable per game, since you push the table.
Source: docs/experiment-log.md (2026-08-27) · docs/experiment-log.md (2026-08-27 reframe) · protocol/brx-ir-protocol.md
