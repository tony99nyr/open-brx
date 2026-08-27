# `$WEAP` — the weapon definition
_Forty-odd comma-separated tokens that make a weapon out of data: damage, cadence, fire mode, ammo, sounds, IR type_
Last verified: 2026-08-27

## A weapon is data, not firmware.
The gun has no weapons baked in; the host sends a full `$WEAP` frame into one of **six slots (0–5)**. The field *names* come from the Callsign app's metadata (declaration order = wire order); the *positions and meanings* below were then pinned by capturing the 19 stock weapons (20 frames) with the operator naming each one, and by flipping single tokens on a live gun.
Source: protocol/callsign-extract/protocol-classes.md (WEAP), protocol/brx-protocol.md §6, §6.1

```text
# Two known-good frames (slot 0 Assault Rifle, slot 1 Charge Rifle):
$WEAP,0,,100,0,0,24,0,,,,,,,,100,850,32,32768,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,9999999,75,,*
$WEAP,1,,100,8,0,150,0,,,,,,,,1250,850,100,32768,2500,0,14,100,100,,14,,,E03,C15,C17,,D30,D29,D37,A73,C19,C04,20,150,100,9999999,75,,*
# A captured Shotgun (slot 1) — the only stock weapon with the extra-headset block populated:
$WEAP,1,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*
```
Source: protocol/brx-protocol.md §6; mcp/brx_mcp/__main__.py (captured frames)

_[diagram DEV-05: Token ruler t0–t42 colour-coded by block: identity · damage/IR · secondary (dormant) · extra-headset · cadence/ammo · fire mode/overheat · sounds · tail.]_

## Token map (0-indexed: `$WEAP,<t0>,<t1>,…,*`; the slot is t0)
| tok | Field | AR | Charge Rifle | Meaning | Conf |
|---|---|---|---|---|---|
| 0 | slot | 0 | 1 | Weapon slot 0–5. Slot 4 = melee by convention (gyro swing, `$BMAP,8,4`). | ✅ |
| 1 | slotType / mode flag | — | — | `2` on exactly the three weapons carrying an extra-headset payload (t12/t13/t42 populated); `1` on melee; `0` rail gun; empty otherwise. Not fire mode. | ✅ |
| 2 | — | 100 | 100 | — (unknown) | — |
| 3 | primaryDamageType | 0 | 8 | **The IR word's B field / `$SIR` protocol key.** Writing a type here is echoed by the victim in `$HIR` token 2 and selects its `$SIR` row. DamageType enum: 0 Standard · 1 MedicHeal · 2 ActivateShield · 3 RallyPulse · 4 Radiation · 5 Cryogenic · 6 ArmorPiercing · 7 EMP · 8 Shrapnel · 9 StickyBomb · 10 StandardLethalExplosive · 11 NonLethalExplosive · 12 ShottyPellets · 13 MeleeDamage · 14 Plasma. Stock: 8 charge, 10 rocket, 11 gas, 13 melee. | ✅ (position) 🔍 (enum names) |
| 4 | primaryPowerType | 0 | 0 | IRSource enum: DeviceCommand, IRSource, GunLaser, HeadSetOnly, GunAndHead, DoubleGun, DoubleGunAndHead, DRY_FIRE, MuzzleFlash, MuzOnly, VibOnly, MuzAndVib. Order relative to t3 was settled by t3 behaving as damageType. | 🔍 |
| 5 | primaryDamage | 24 | 150 | **The raw magnitude put in the IR word** (= `$HIR` token 5). Applied damage depends on the victim's `$SIR` row. The stock AR actually emits 9; the sample's 24 is the manual's stale anchor (§7r addendum). | ✅ |
| 6 | primaryCriticalChance | 0 | 0 | Crit chance. 0 on every stock weapon; the IR crit bit *can* be set (×1.5). | 🔍 |
| 7–11 | secondaryFireChance, secondaryDamageType, secondaryPowerType, secondaryDamage, secondaryCriticalChance | — | — | **Dormant**: empty on all 20 captured stock frames. No stock BRX weapon has a secondary fire mode. | 🔍 |
| 12 | extraHeadsetDamage | — | — | Populated with t1=2: Shotgun 70, Rocket 115, Plasma Sniper 80. | ✅ (correlation) |
| 13 | extraHeadsetRangeOutdoor | — | — | 80 on the same three weapons. | ✅ (correlation) |
| 14 | **fire interval / charge time (ms)** | 100 | 1250 | **Proven by one-field flip**: a sniper with t14=1250 slowed to one shot every 1.25 s (timed by ear as roughly one per second). Stock cadences read from the captured frames (🔍): burst 75 · SMG 90 · AR 100 · sniper 300 · AMR 360 · launcher 360 · shotgun 900 · melee 1000 · rail gun 1200 · charge rifle 1250. For charge weapons this is the hold time. | ✅ (flip) 🔍 (cadence list) |
| 15 | — | 850 | 850 | — (unknown) | — |
| 16 | maxClip | 32 | 100 | Magazine size. | ✅ |
| 17 | maxAmmo | 32768 | 32768 | Always `2 × t40` in captured frames (or 32768 as an unlimited flag). Not an independent knob. | ✅ (correlation) |
| 18 | reloadSpeed (ms) | 1400 | 2500 | Reload time. | 🔍 |
| 19 | — | 0 | 0 | — (unknown) | — |
| 20 | **fire mode** | 0 | 14 | **Proven by one-field flip**: `0` full-auto · `7` single-shot/bolt · `9` burst (cycle in t23) · `2` charge, auto-release (tap = weak shot) · `3` hold-to-charge, auto-fire (tap = sound only) · `14` tap-fire OR charge-release · `13` melee. | ✅ |
| 21 | maxAccuracy | 100 | 100 | | 🔍 |
| 22 | singleShotAccuracy | 100 | 100 | | 🔍 |
| 23 | burstWeaponTime (ms) | — | — | Burst cycle: 275 Burst Rifle, 250 Force Rifle, empty on everything else. | ✅ |
| 24 | overheat (heat per shot) | 0 | 14 | SMG 5 · Energy Rifle 6 · Charge Rifle 14 · Plasma Sniper 30. **Inert unless t37/t38 are set.** | ✅ |
| 25 | — | — | — | — (unknown) | — |
| 26 | — | — | — | — (unknown) | — |
| 27 | primaryFire_SoundName | R01 | E03 | Fire sound id. **A sound, not an identity** — Rocket Launcher and Rail Gun both fire `C03` with different stat lines. | ✅ |
| 28 | extra action sound A | — | C15 | Engage sound. `C…` ids = charge (rail gun C08, laser cannon C11, charge rifle C15); `D…` ids = extra reload parts on five-part reloads (sniper/AMR/force rifle D20, ion sniper D32). | ✅ |
| 29 | extra action sound B | — | C17 | Release sound. Present exactly when the weapon has a distinct release event (charge rifle C17, bolt weapons D19/D31); absent on auto-firing chargers. | ✅ |
| 30 | secondary_Mix_SoundName | — | — | | 🔍 |
| 31 | reloadPart1_SoundName | D04 | D30 | | ✅ |
| 32 | reloadPart2_SoundName | D03 | D29 | | ✅ |
| 33 | reloadPart3_SoundName | D02 | D37 | | ✅ |
| 34 | noAmmo_SoundName | D18 | A73 | | 🔍 |
| 35 | weaponFeatureA | — | C19 | **Overheat sound** (SMG D11, CR C19, Plasma Sniper/Energy Rifle D122). | ✅ |
| 36 | weaponFeatureB | — | C04 | Second feature sound. | 🔍 |
| 37 | overheat param A | — | 20 | **Gate for the overheat system** (with t38): transplanting `20,150` onto the SMG brought its dead heat gauge alive (28→52 through a mag dump) and the trigger gated at the top like an empty clip — at these values the 72-round magazine empties before a hard lockout. | ✅ (gate) |
| 38 | overheat param B | — | 150 | See t37. | ✅ (gate) |
| 39 | clipStartingAmmo | 32 | 100 | Equals t16 in every captured frame. | ✅ (correlation) |
| 40 | ammoReserv | 9999999 | 9999999 | Reserve; 9999999 = unlimited. `t17 == 2 × t40` in stock frames. | 🔍 |
| 41 | — | 75 | 75 | — (unknown) | — |
| 42 | extraHeadsetRangeIndoor | — | — | 30/30/40 on the three t1=2 weapons. | ✅ (correlation) |
Source: protocol/callsign-extract/protocol-classes.md (WEAP exact token positions + cap14–cap24 sections; t14 cadence list), protocol/brx-protocol.md §6.1 and the t20 / overheat sections, §7r addendum (stock AR emits 9, manual's 24 stale), docs/experiment-log.md (2026-08-26 $WEAP token probes; charge modes; overheat solved)

## Two positions that bit us.
(1) The metadata's field order has `rateOfFire` before `weaponSwapDelay`; the wire has the *rate* at **t14** and the constant 850 at t15 — a compiler that trusted the field order shipped every weapon at 10 shots/s. (2) Keying weapons by their fire sound (t27) silently merges distinct weapons.
Source: protocol/brx-protocol.md §6.1; protocol/callsign-extract/protocol-classes.md (cap17, cap18)

## Stock weapon signatures
(fire sound → weapon → behaviour, as named by the operator at capture)
| t27 | Weapon | Fire mode / notes |
|---|---|---|
| `R01` | Assault Rifle | full auto |
| `R18` | Burst Rifle | 3-round burst (t20=9, t23=275) |
| `R23` | Force Rifle | 3-round burst (t23=250), five-part reload |
| `R12` | Bolt Rifle | single shot; carries no t28/t29 |
| `G03` | SMG | full auto, overheat mechanic (t24=5) |
| `Q06` | Suppressor | full auto, quiet, no muzzle flash (t25=2, t26=50) |
| `E11` | Stinger | full auto |
| `E12` | Energy Rifle | full auto, overheat (t24=6), 300-round clip |
| `S16` | Sniper | single shot, bolt action (t28/t29 = D20/D19) |
| `S07` | AMR | single shot, same bolt pair |
| `E07` | Ion Sniper | single shot, 2-round clip (D32/D31) |
| `E17` | Plasma Sniper | single shot, overheat (t24=30), shell reload |
| `T01` | Shotgun | single shot (t20=7), t19=2, extra-headset block, magnitude 45 |
| `J15` | Energy Launcher | clip 1 / reserve 3 |
| `C03` | Rail Gun | charges on hold, auto-fires ~1.2 s (t20=2, t28=C08) |
| `C03` | Rocket Launcher | single shot, protocol 10, magnitude 115 |
| `C06` | Laser Cannon | must be held (t20=3, t28=C11) |
| `E03` | Charge Rifle | hold, fires on release; overheats (t20=14) |
| `M92` | Melee | gyro swing, protocol 13, magnitude 90 |
Source: protocol/callsign-extract/protocol-classes.md (weapon signatures, cap14–cap22); docs/experiment-log.md (2026-08-26 melee capture, damage bench)

## Overheat is a balance lever on any weapon.
Set t24 (heat per shot) + t35 (overheat sound) + t37/t38 (enable/params, stock `20,150`), and the live heat gauge streams in `$ALCD` token 5 — climbing ~8/shot on the Charge Rifle, crossing 100 into lockout and decaying on idle. A HUD heat bar needs no new protocol.
Source: protocol/brx-protocol.md §7j, overheat section; docs/experiment-log.md (overheat mechanism solved)

- **Can I build a semi-auto rifle?** Yes — t20=7 is single-shot per pull. (An earlier note that semi-auto "may not exist" predates the t20 proof.)
- **What bounds a custom weapon?** The firmware's behaviour vocabulary: the DamageType and PowerType enums, ReloadType, six slots, and the 2166 sound ids. Any *combination* with arbitrary numbers is buildable; a brand-new damage *behaviour* is not.
- **Does a `$WEAP` re-push mid-game keep the ammo count?** No — it resets mag/reserve to the frame's values. Re-send `$AMMO`.
Source: protocol/brx-protocol.md t20 section · protocol/callsign-extract/protocol-classes.md ("What's moddable") · docs/gotchas.md
