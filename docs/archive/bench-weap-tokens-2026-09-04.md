# Bench plan: the weapon-swap delay token, and every `$WEAP` token we write blind

Written 2026-09-04 for the next bench session. Two things in here: **experiment 1**, a one-frame test that
may make the Quick Switch perk real (and close FOLLOWUPS F4 + F22 in one go), and the **list Tony asked
for**: every `$WEAP` token we send with the same value on all 21 weapons without knowing what it does.

Read `docs/experiment-log.md` and the measurement rules in `docs/HANDOFF.md` first. Check the control
before the result. `$WEAP` is on the known-safe list; nothing here needs a confirm.

## Experiment 1: is `t15` (the constant 850) the weapon-swap delay?

**Why we think so.** Every captured Callsign frame carries `850` at token 15 (melee alone has `100`);
the APK's field-order metadata reads `… rateOfFire, weaponSwapDelay …` and the frame-diff put the
rate at t14 (bench-proven 2026-08-26), which leaves t15 as `weaponSwapDelay`. The token table in
`protocol/callsign-extract/protocol-classes.md` still says "constant 850, function unknown — do not
write" from before that reasoning; this experiment settles it. The compiler never writes t15.

**What we measure.** ALT → first `$ALCD` on the new slot, with the trigger HELD from the moment ALT is
pressed, so the first shot goes out the instant the gun allows it and the player's reaction time is
out of the number. The phone logs it already: `slot 0->1 confirmed Nms after ALT (incl. reaction)`
(engine.js `lastSwitchMs`, visible in the ⓘ diagnostics log), or read the `$BUT,1,1` → `$ALCD,…,1,…`
gap straight off `python.exe -m brx_mcp listen`.

**Frames.** ⚠ Superseded by the Result below — this block arms `$GSET,0,1,…` (OUTDOOR profile) and lacks `$PSET`, so a gun armed from it spawns at 0 HP; the bench used the golden-bundle head (`$GSET,0,0,…` indoor). Kept for the record:

```
$VOL,30,0,*
$CLEAR,*
$START,*
$GSET,0,1,1,0,1,0,50,1,*
$SIR,0,0,,1,0,0,1,,*
$TID,1,*
$BMAP,1,100,0,1,99,99,*          ← ALT = weapon-cycle (captured Callsign mapping)
$WEAP,0,,100,0,0,9,0,,,,,,,,140,850,32,192,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,96,75,*
$WEAP,1,,100,0,0,8,0,,,,,,,,140,850,72,288,2500,0,0,100,100,,5,,,G03,,,,D26,D25,D24,D18,D11,,,,72,144,75,*
$SPAWN,,*
$PLAYX,0,*
$AMMO,0,32,192,1,*
$AMMO,1,72,288,1,*
```

(the two `$WEAP` lines are exactly what MC sends today for the Assault Rifle and the SMG — copied from
`WeaponCatalog.resolve()` on 2026-09-04; regenerate them if the catalog moves.)

Runs, five ALT presses each, trigger held, note every gap:

| run | slot 0 t15 | slot 1 t15 | expect if t15 is the swap delay |
|---|---|---|---|
| A control | 850 | 850 | ~850 ms + BLE latency, tight spread |
| B doubled | 1700 | 1700 | ~1700 — the positive control; a doubled delay is unmistakable, do this BEFORE the halved run |
| C halved | 425 | 425 | ~425 |
| D incoming only | 850 | 425 | tells us whether the delay belongs to the weapon being drawn… |
| E outgoing only | 425 | 850 | …or the one being stowed |
| F melee value | 100 | 100 | the floor: does the gun clamp? |

Swap both directions (0→1 and 1→0) in each run; the gap for 1→0 uses slot 1's value if D/E say
"outgoing". Re-run A at the end so drift is visible.

**Decision.** If B ≈ 1700 and C ≈ 425: t15 is the swap delay. Then (1) `compile._mods` scales t15 by
`switch_mult` exactly as it scales t18 by `reload_mult`, and `perks.json` flips `quick_switch` to
`verified: true`; (2) the node's `SWITCH_MAX_MS` guess goes away — MC carries the resolved swap delay
per weapon into the bundle (or the HUD reads t15 off the frame) and the SWITCHING takeover runs for the
real number; (3) F4 and F22 close. If B ≈ 850: t15 is not the delay, mark it "tested, inert for swap"
in the token table, and Quick Switch falls back to the phone-driven swap idea (F22).

## Result (bench 2026-09-04, gun Tactix-9498, Tony on the trigger, trigger held through every ALT)

ALT press → first `$ALCD` on the new slot, ms:

| run | slot 0 / slot 1 t15 | 0→1 | 1→0 | verdict |
|---|---|---|---|---|
| A control | 850 / 850 | 871 · 870 | 871 · 840 | baseline 850 + ~20 ms BLE |
| B doubled | 1700 / 1700 | 1711 · 1771 · 1711 | 1710 · 1711 | **the token is the delay** |
| C halved | 425 / 425 | 421 · 421 · 451 · 451 · 421 | 450 · 421 · 451 · 450 | linear |
| D | 850 / 425 | 871 · 871 · 840 · 841 | 870 · 871 · 870 · 840 | not "incoming" |
| E | 425 / 850 | 871 · 871 · 841 · 870 · 841 | 871 · 841 · 841 · 870 | not "outgoing" → **the LARGER value wins, both directions** |
| F floor | 100 / 100 | 120 · 120 · 120 · 120 · 121 | 119 · 120 · 121 · 90 | no floor |

Two things the try-out frames taught us on the way: a gun armed without `$PSET` spawns at 0 HP and
silently refuses to fire (trigger events, no `$ALCD`), and `$VOL,30` is inaudible for weapon audio —
the arming sequence in this doc is now the golden-bundle head, and try-outs use 69.

**Wired in the same day:** `compile._T["swap"] = 15`, `WeaponCatalog.swap_ms()` (captured value or a
`wire.swap_ms` override, × `switch_mult` on EVERY slot because the larger wins), `FrameBundle.swap_ms`
(the enforced max of slots 0/1) → the node's `switchWindowMs()` reads it, so the SWITCHING takeover is
exactly as long as the gun's refusal. `quick_switch` is `verified: true`. F4 and F22 closed.

## The list: tokens we send identical on every weapon, with no compile key and no verified meaning

From `WeaponCatalog.resolve(id, 0)` across all 21 catalog weapons (2026-09-04). `∅` = empty field.

| tok | we send | documented guess (APK field order) | cheapest probe |
|---|---|---|---|
| t2 | `100` | **gunRangeOutdoor** (discovery pass: APK field order; melee 90) | 2×2 with t41 against `$GSET` t2 — see the discovery doc |
| t6 | `0` | primaryCriticalChance | send 100: do hits land as crits (bigger `$HIR` dmg / different sound)? |
| t7–t11 | `∅` | the secondary-fire block (fireChance, damageType, powerType, damage, critChance) | empty in every Callsign capture too; fill t7=100,t10=5 and see whether ALT-fire changes behaviour — low priority, ALT is our swap button |
| **t15** | `850` | **weaponSwapDelay — PROVEN 2026-09-04** | done, see Result |
| t21 | `100` | maxAccuracy | send 0 or 50: do shots stop registering / register less? (needs a target gun + the IR rig) |
| t22 | `100` | singleShotAccuracy | same probe as t21, one token at a time |
| t30 | `∅` | secondary mix sound | inert until t7–t11 do something |

Two more that are constant on the wire but are NOT blind: t41 `75` is gun range % (documented, we
never vary it — a range perk would live here), and t19 reloadType is `0` on 20 weapons and `2` on
one (the SHOTGUN's shells — not the Plasma Sniper, corrected by the 2026-09-04 discovery pass) — and the wire already shows the gun honours it: the Shotgun reloads shell by shell, one `$ALCD` per ~400 ms. See `docs/bench-weap-tokens-discovery-2026-09-04.md`.

Everything else we send either varies per weapon under a compile key (t3 t4 t5 t14 t16 t17 t18 t20
t23 t24 t27–t29 t31–t34 t39 t40) or is a per-weapon flag we copy from the capture (t1 t12 t13 t25 t26
t35–t38 t42). Frames are 42 tokens long; there is no t43/t44.

## Order of work at the bench

1. Experiment 1 runs A → B → C → D → E → F → A (B before C: the doubled value is the control that
   proves the token is read at all).
2. If time: t2 = 50, then t6 = 100, one token per run, control frame between runs.
3. Log every run in `docs/experiment-log.md`; promote confirmed meanings into the token table in
   `protocol/callsign-extract/protocol-classes.md` and `docs/manual/`.

**Next:** the pre-bench discovery pass on the remaining tokens (four research lenses, ranked plan, ~80 min) is
`docs/bench-weap-tokens-discovery-2026-09-04.md`.
