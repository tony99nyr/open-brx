# `$SIR` — the incoming-IR effects matrix
_What an IR hit does to this gun is decided by the victim's table, not by the shooter's weapon_
Last verified: 2026-08-27

## The key idea.
An incoming IR word carries a 4-bit protocol (B) and a 2-bit subtype (U). The victim looks up the `$SIR` row with that `<protocol, subtype>` key; the row's **function** decides what the word's 8-bit magnitude is applied to — damage, heal, armor, shield, or a status. **No matching row → the hit is silently ignored.** 16 × 4 = 64 addressable cells, all writable per game over BLE.
Source: protocol/brx-protocol.md §5; protocol/brx-ir-protocol.md

## Format:
`$SIR,<irProtocol>,<subtype>,<soundID>,<function>,<p5>,<p6>,<p7>,<p8>,*`
- `<soundID>` plays **on the victim** when the row fires (`VA16` "armor suit", `VA8C` "shields online", `H29` stim-pack).
- `<p5>–<p8>` do **not** scale damage (`0,0,1`, `0,50,1`, `0,100,2,60`, `0,200,2,60`, `50,100,2,60` all landed exactly the magnitude).
- Max distinct IR recognitions per game: 14 (community figure).
Source: protocol/brx-protocol.md §5; docs/experiment-log.md (clean negatives)

```text
# The stock 10-row table the official app sends (Team Arena):
$SIR,0,0,,1,0,0,1,,*        standard weapons (AR, SMG, snipers, shotgun…) — plain damage
$SIR,0,1,,36,0,0,1,,*       Force Rifle / Sniper Rifle — ×1.25 damage
$SIR,0,3,,37,0,0,1,,*       AMR / Bolt Rifle / Burst Rifle — ×2 damage
$SIR,1,0,H29,10,0,0,1,,*    respawn + add HP
$SIR,2,1,VA8C,11,0,0,1,,*   add shields
$SIR,3,0,VA16,13,0,0,1,,*   add armor
$SIR,6,0,H02,1,0,90,1,40,*  Rail Gun
$SIR,8,0,,38,0,0,1,,*       Charge Rifle
$SIR,9,3,,24,10,0,,,*       Energy Launcher (fn 24 is a no-pool status — deals zero damage as shipped)
$SIR,10,0,X13,1,0,100,2,60,* Rocket Launcher
$SIR,11,0,VA2,28,0,0,1,,*   Tear gas
$SIR,13,0,H50,… / 13,1,H57 / 13,3,H49   Energy Blade / Rifle Bash / War Hammer (melee)
```
Source: protocol/brx-protocol.md §5; docs/experiment-log.md (shipped-table consequence)

## Function map (measured at magnitude 20 on protocol 5, baseline HP 45 / armor 70 / shield 0)
| Class | Function ids | Measured behaviour | Polarity | Conf |
|---|---|---|---|---|
| Standard damage | 1, 4, 5, 7, 29, 30, 33, 38 | −20 per hit, drains shields → armor → HP | enemy only | ✅ |
| **Armor-piercing** | 2, 6 (+17, 21 enemy-side) | HP 45→25→5 with armor **and shields** untouched | enemy only | ✅ |
| ×1.25 damage | 36 | magnitude 20 lands as 25 | enemy only | ✅ |
| ×2 damage | 37 | magnitude 20 lands as 40 | enemy only | ✅ |
| Add HP, overflow → armor | 9, 12, 16, 19 | 15→35→45, then +armor | ally only (16/19 also damage enemies) | ✅ |
| Add HP, clamp | 10, 17 | 15→35→45, no overflow | ally only (17 also AP-damages enemies) | ✅ |
| Add HP, overflow → shield | 14, 21 | 15→35→45, then +shield | ally only | ✅ |
| Add armor | 13, 15, 20, 22 | 0→20→40; overflow spills to shields | ally only (20 also strips enemy armor) | ✅ |
| Add shield | 11, 18 | 0→20→40 | ally only | ✅ |
| **`$ALCD` token-2 drop** | 23 | Registers a hit, no pool change; `$ALCD` token 2 drops 100→0 and recovers over ~6–8 s while the gun keeps firing. The state clears on `$SPAWN,,*`. | enemy | ✅ |
| Registers, no pool change | enemy 3, 8, 24, 25, 26, 27, 28, 35 · ally 31, 32, 34 | `$HIR` fires, pools unchanged, no other frame. | — | ✅ |
| No registration | 0, 39–45 (and 28/45 on protocol 5) | — | — | ✅ |
Source: docs/experiment-log.md (2026-08-26 complete two-sided $SIR map; 2026-08-27 fn 23)

## Support functions are team-gated in firmware.
With `$GSET` friendlyFire = 0, heals/armor/shield grants register **only from a same-team source**, and damage registers only from another team. Set friendlyFire = 1 and everything lands from anyone. A medic gun enforces "allies only" with zero host logic.
Source: protocol/brx-protocol.md §5; docs/experiment-log.md (dual-polarity, FF table)

_[diagram DEV-07: Damage pipeline: IR word (B,U,D,C) → victim `$SIR[B,U]` → function multiplier → ×1.5 if crit → drain shields → armor → HP → emit `$HIR` + `$HP`.]_

- **applied = magnitude × fn multiplier × (1.5 if crit)** — fn 1 ×1 · fn 36 ×1.25 · fn 37 ×2; crit stacks (fn 37 + crit = ×3). ✅
- **Drain order: shields → armor → HP.** Armor absorbs 1:1 with no per-hit cap; overflow spills into HP (a sniper's 80 split exactly 70/10). ✅
- **Heals clamp** at the pool max — magnitude 200 is a fill, not a stack. ✅
- **No function is a damage-over-time.** 18 s watched after each status hit: no ticks. ✅
- **Dead guns accept no IR at all.** ✅
Source: protocol/brx-protocol.md §7r addendum; docs/experiment-log.md (tok5 raw magnitude, AP, heals clamp, DoT negative, 448-word brute force)

- **Is there a stun?** None found. `$STUN` over BLE is a no-op, and fn 23 — the only function that visibly changes anything without touching a pool — leaves the gun firing.
- **Can I read a native game's `$SIR` table?** No — the gun never reports it. Capturing an ability's IR word tells you its protocol, not what a native victim binds to it.
- **Which protocols are free?** Stock uses 0, 8, 10, 11, 13 and 15 (grenade beacon); the app's table also ships rows on 1, 2, 3, 6, 9. Truly unused: 4, 5, 7, 12, 14 — but every cell is re-definable per game since you push the table.
Source: docs/experiment-log.md (2026-08-27) · docs/experiment-log.md (2026-08-27 reframe) · protocol/brx-ir-protocol.md
