# BRX protocol — command classes & field maps (from Callsign IL2CPP metadata)

Recovered 2026-08-24 from the Callsign app's `global-metadata.dat` by reading the plaintext
identifier blob (the metadata's structural tables are obfuscated — version bumped to 39 and
index tables encrypted — but the **field names survive in declaration order**, which is the
token map). Each command is a C# class in `LaserTag.CallSign.Hardware.Guns.Domain.Messages.*`
whose fields serialize to the `$…,*` frame in order.

> **Confidence:** field *names and sets* are certain (read straight from the binary). Exact
> wire *position* is declaration order, which normally equals serialization order — **GSET is
> numerically confirmed against a live capture** (below). Others marked (source-derived);
> confirm a specific token by differential capture (now trivial — we know what each field is).

## Complete command vocabulary

**Requests (host→gun):** AMMO ASKDLC ASSIST BHIT BMAP BUMP CLEAR DLC FSET GLED GREN GSET
HFIRE IRTX LIFE MELEE NAME PLAY PLAYX PSET SIR SPAWN START STOP STUN VERSION VIB VOL WEAP ZOOM
**Headset requests:** BLINK CHASE HLED HLOOP LED
**Notifications (gun→host):** ALCD BUT GOTDLC HIR HP LCD SFLASH TIME VERSION VOLTS

New vs our prior doc: **FSET, GREN, HFIRE, IRTX, LIFE, MELEE, STUN, VIB, ZOOM, BHIT, BUMP,
ASSIST, ASKDLC, DLC/GOTDLC**, headset **BLINK/CHASE/HLED/HLOOP/LED**, notifications **TIME/SFLASH**.

This list is the app's `Requests` namespace only. A few commands we use come from other sources and
are **not** in it — notably `$PING`/`$PONG` (keepalive), `$TID` (team id, hardware-verified — drives
LED colour), `$SP`/`$SPAWN` lifecycle, and the `$RV`/`$RP`/`$UR`/`$KK`/`$DD` host-side family
(LaserTagMods). See `protocol/brx-protocol.md` §3/§4 for the full union. Absence here ≠ undecoded.

## GSET — game settings ✅ CONFIRMED

`$GSET,friendlyFire,outdoorMode,gunLaserRegion,autoAmbientLight,gyroscope,secondaryBluetoothWeapons,criticalShotModifier,gameMods,*`

Validated against capture `$GSET,0,0,1,0,1,0,50,1,*`:

| # | field | example | meaning |
|---|---|---|---|
| 1 | friendlyFire | 0 | friendly fire off/on |
| 2 | outdoorMode | 0 | indoor(0)/outdoor(1) IR range profile |
| 3 | gunLaserRegion | 1 | gun-laser region/zone |
| 4 | autoAmbientLight | 0 | auto ambient-light compensation |
| 5 | gyroscope | 1 | gyro enable |
| 6 | secondaryBluetoothWeapons | 0 | allow BT secondary weapons |
| 7 | criticalShotModifier | 50 | crit modifier (%) |
| 8 | gameMods | 1 | game-mods flags |

**Key consequence:** there is **no respawn / game-time / lives field** — proving (again) those
are app-side, not on the gun. Settles experiment-log #17 from the source side.

## WEAP — weapon definition (source-derived)

The metadata gives ~38 named members; the wire frame is 44 comma-separated tokens (the extra ~6
are the always-empty secondary/extra-headset positions noted below). Counts differ because empties
occupy token slots without a distinct populated field in these two samples.

Ordered fields (the `$WEAP,<slot>,…` ~44-token frame). Leading slot + IR-signature tokens,
then:

`slotType, iRSource, gunRangeOutdoor, primaryDamageType, primaryPowerType, primaryDamage,
primaryCriticalChance, secondaryFireChance, secondaryDamageType, secondaryPowerType,
secondaryDamage, secondaryCriticalChance, extraHeadsetDamage, extraHeadsetRangeOutdoor,
rateOfFire, weaponSwapDelay, maxClip, maxAmmo, reloadSpeed, reloadType, maxAccuracy,
singleShotAccuracy, burstWeaponTime, overheat, muzzleFlash, primaryFire_SoundName,
chargeUp_SoundName, chargeDown_SoundName, secondary_Mix_SoundName, reloadPart1_SoundName,
reloadPart2_SoundName, reloadPart3_SoundName, noAmmo_SoundName, weaponFeatureA, weaponFeatureB,
headsetDirection, headsetRepeat, clipStartingAmmo, ammoReserv, gunRangeIndoor,
extraHeadsetRangeIndoor`

Anchor check: manual's M-4 damage 24 ↔ `primaryDamage`; rate-of-fire, clip, reload all present.
This is the field map that was the "highest reverse-engineering priority" — recovered without
per-token capture diffing.

### WEAP — hardware-confirmed positions and weapon identities (2026-08-26, cap14)

Captured with the operator **naming the weapon in each slot**, which is what turns a frame into
evidence. Run `python -m brx_mcp.weapmap <captures…>` to regenerate the token × weapon table.

**Weapon signatures on the wire** (token 27, `primaryFire_SoundName`):

| sound | weapon | behaviour |
|---|---|---|
| `R01` | **Assault Rifle** | full auto |
| `R18` | **Burst Rifle** | 3-round burst, one trigger pull per burst |
| `T01` | (secondary/pistol-class) | only weapon so far with `extraHeadset*` populated |
| `J15` | Launcher-class | clip 1 / reserve 3 |
| `M92` | Melee | gyro swing |
| `S16` | **Sniper** | single shot; **bolt action** — pull back, release |
| `S07` | **AMR** | single shot, no full auto; same bolt pair as the Sniper |
| `G03` | **SMG** | full auto with an **overheat** mechanic (sound fires if held too long) |
| `J15` | **Energy Launcher** | clip 1 / reserve 3 |
| `C03` | **Rail Gun** *(slot-1 stat line)* | charges on hold, **auto-fires** after ~1 s; also fires on a tap |
| `C03` | **Rocket Launcher** *(different stat line, same sound)* | standard single shot |
| `C06` | **Laser Cannon** | **must be held** to charge; a tap fires nothing |
| `E03` | **Charge Rifle** | hold to charge, **fires on RELEASE**; also overheats |
| `R12` | **Bolt Rifle** | single shot (operator: "like the AMR") — but **no** `t28`/`t29` |

**`t23` = `burstWeaponTime` — CONFIRMED.** `275` on the Burst Rifle and **empty on the full-auto AR
and on every other weapon captured**. A field that is populated on exactly the weapon whose named
behaviour it describes, and empty elsewhere, is about as clean as a positional decode gets.

**`t28`/`t29` are TWO-STAGE ACTION sounds, not charge-specific (cap15).** They were named
`chargeUp_SoundName`/`chargeDown_SoundName` because the only weapon that had ever populated them was
the Charge Rifle (`C15`/`C17`). The **Sniper** (`S16`) populates them too — `D20`/`D19` — matching
the operator's description of the bolt: *pull back, then let it go*. So the pair means "a weapon
whose action has a distinct engage and release phase", of which charging is one case.

### `t28`/`t29` — engage / release, across four charge behaviours

Every charge-style weapon we have, sorted by what the operator physically observed:

| weapon | behaviour | `t28` | `t29` |
|---|---|---|---|
| Rocket Launcher (`C03` s0) | single shot, nothing to charge | — | — |
| Rail Gun (`C03` s1) | charges, **auto-fires**; a tap also fires | `C08` | — |
| Laser Cannon (`C06`) | **must be held**; a tap fires nothing | `C11` | — |
| **Charge Rifle (`E03`)** | hold to charge, **fires on RELEASE** | `C15` | **`C17`** |
| Sniper (`S16`) / AMR (`S07`) | bolt: pull back, **let go** | `D20` | `D19` |

**`t29` is present exactly when the weapon has a distinct RELEASE event** and absent when the
weapon completes the action by itself. Four behaviours, four matching frames, including two
predicted-then-confirmed absences.

⚠ **Caveat:** the **Bolt Rifle** (`R12`) carries *neither*, despite the name and despite the
operator reporting it behaves "like the AMR". So the pair tracks a weapon's **audible two-stage
action**, not its name or its single-shot-ness.

### Tokens 7–11 (the secondary-fire block) are DORMANT in every stock weapon

Empty across **all 14 distinct weapon frames** — AR, Burst Rifle, Bolt Rifle, SMG, Sniper, AMR,
`T01`, Energy Launcher, Rail Gun, Rocket Launcher, Laser Cannon, Charge Rifle and Melee. That is
effectively the whole stock arsenal.

**Conclusion: no stock BRX weapon has a secondary fire mode**, so these positions cannot be pinned
by capture and their order stays source-derived only. Consistent with `apk-harvest.md`'s note that
weapon stats are **server-fetched** — the block is presumably there for definitions the app can be
sent. **Stop capturing weapons to fill 7–11**; our own weapon definitions don't need them either.

**⚠ Token 27 is a SOUND, not a weapon identity (cap18).** The Rocket Launcher and the Rail Gun both
fire `C03` while carrying completely different stat lines. Any analysis that keys weapons by their
fire sound will silently merge distinct weapons — `weapmap` keys on the full stat line instead.

**⚠ `t14` and `t15` are SWAPPED in the field-order derivation (cap17).** The metadata order reads
`… rateOfFire, weaponSwapDelay …`, and the 2-frame table assigned `t14` = chargeUp and `t15` =
rateOfFire. The wire says otherwise:

- **`t15` = `850` on every gun** captured (melee alone differs at `100`). A rate-of-fire identical
  for an SMG and a sniper is meaningless — this is the **weapon-swap delay**, which *should* be
  constant.
- **`t14` tracks each weapon's actual cadence**: burst 75 · SMG 90 · AR 100 · sniper 300 · AMR 360 ·
  launcher 360 · shotgun 900 · melee 1000 · **rail gun 1200** · charge rifle 1250. For charge
  weapons this *is* the charge time — the Rail Gun's 1200 ms is the ~1 s hold the operator measured
  by feel before it auto-fired.

So **`t14` = per-shot cycle/charge time (ms)** and **`t15` = weaponSwapDelay**.

**The `t28`/`t29` pair is engage/release, and the Rail Gun proves it by omission.** It populates
`t28` (`C08`) and leaves **`t29` empty** — it charges and fires *itself*, so there is no release.
The Sniper and AMR, which the operator must release, carry both (`D20`/`D19`); the Charge Rifle
carries both (`C15`/`C17`). A field absent exactly where the behaviour is absent is strong evidence.

**`t24` = `overheat` — CONFIRMED (cap16).** `5` on the SMG (`G03`), whose named mechanic is exactly
that, and `0` on all nine other weapons captured. **`t35` (`weaponFeatureA`) = `D11` on the SMG
alone** — the overheat sound — so `weaponFeatureA`/`B` are sound slots for a weapon's *special
mechanic*, not generic extras.

**`t17` is NOT independent of `t40`.** Across all six weapon frames we hold, **`t17 == 2 × t40`**
without exception:

| weapon | t16 clip | t17 | t39 start | t40 reserve |
|---|---|---|---|---|
| R01 (AR) | 32 | 384 | 32 | 192 |
| R18 (Burst) | 36 | 216 | 36 | 108 |
| T01 | 6 | 24 | 6 | 12 |
| J15 | 1 | 6 | 1 | 3 |
| M92 (melee) | 1 | 0 | 1 | 0 |

So `t17`/`t40` are the same quantity in different units (or one is derived on send) — **do not treat
them as two independent knobs.** Likewise `t39 == t16` in every frame (clip starts full).

⚠ **`t5` (`primaryDamage`) does not match the earlier 2-frame derivation.** That table read the AR's
`t5` as **24** (anchored to the manual's M-4 damage); cap14's `R01` carries **9**, as does `R18`.
Either the app now sends a server-fetched value, the earlier alignment was off, or `t5` is not
damage. Treat `t5` as **unresolved** rather than ✓.

### WEAP exact token positions (metadata field names × 2 live frames)

Cross-validated: the 38-member metadata field list aligned against the two known-good frames
(Assault Rifle slot 0, Charge Rifle slot 1) by diffing them token-by-token. `$WEAP,<t0..t43>,*`
(44 tokens). ✓ = validated by value semantics; ~ = inferred from field order.

| tok | AR | ChargeRifle | field | conf |
|---|---|---|---|---|
| 0 | 0 | 1 | **slot** | ✓ |
| 2 | 100 | 100 | (scale/enable const) | ~ |
| 3 | 0 | 8 | primaryPowerType (IRSource enum) | ~ |
| 4 | 0 | 0 | primaryDamageType (DamageType enum) | ~ |
| 5 | **24** | **150** | **primaryDamage** | ✓ (M-4=24) |
| 6 | 0 | 0 | primaryCriticalChance | ~ |
| 7–13 | — | — | secondary* fields (fireChance,damageType,powerType,damage,critChance) | ~ |
| 14 | 100 | 1250 | chargeUp time (CR charges) | ~ |
| 15 | 850 | 850 | rateOfFire / fire delay (ms) | ~ |
| 16 | **32** | **100** | **maxClip** | ✓ (mag) |
| 17 | 32768 | 32768 | maxAmmo / unlimited flag | ~ (identical in both frames — a 2-frame diff can't validate a position that doesn't change) |
| 18 | 1400 | 2500 | reloadSpeed (ms) | ~ |
| 19 | 0 | 0 | reloadType (Magazine/Quiver/Shells…) | ~ |
| 20 | 0 | 14 | (secondary/overheat) | ~ |
| 21 | 100 | 100 | maxAccuracy | ~ |
| 22 | 100 | 100 | singleShotAccuracy | ~ |
| 24 | 0 | 14 | overheat | ~ |
| 27 | **R01** | **E03** | **primaryFire_SoundName** | ✓ |
| 28 | — | **C15** | **chargeUp_SoundName** | ✓ (empty on AR!) |
| 29 | — | **C17** | **chargeDown_SoundName** | ✓ (empty on AR!) |
| 30 | — | — | secondary_Mix_SoundName | ~ |
| 31 | D04 | D30 | reloadPart1_SoundName | ✓ |
| 32 | D03 | D29 | reloadPart2_SoundName | ✓ |
| 33 | D02 | D37 | reloadPart3_SoundName | ✓ |
| 34 | D18 | A73 | noAmmo_SoundName | ~ |
| 35–36 | — | C19,C04 | weaponFeatureA/B sounds | ~ |
| 39 | 32 | 100 | clipStartingAmmo (= maxClip here) | ~ |
| 40 | 9999999 | 9999999 | ammoReserv (unlimited) | ~ (identical in both frames — not discriminable by the diff) |
| 41 | 75 | 75 | gunRange % | ~ |

The always-empty positions (secondary-fire ~7–13 and extra-headset ~42–43) are the **~6 named fields
left unpinned** by the two samples (44 wire tokens − 38 named members ≈ 6; they occupy a few adjacent
empty slots) — secondary-fire / extra-headset fields,
default in both samples — pin them with a one-field Callsign capture (now trivial: change exactly
that field). Note the **primaryDamageType vs primaryPowerType order (tok 3/4) is unresolved**: the
field-declaration list orders damageType-before-powerType, the table has the reverse, and both read
`0` on the AR so the diff can't decide — another one-field capture settles it. The charge-sound
validation (28/29 present only on the charging weapon) makes the sound block certain.

## PSET — player settings (source-derived)

`maxHP, maxShields, criticalDamageBonus,` then a **positional voice pack**: `deathAlarm,
stealthDeathScream, musicMixOnDeath, deathScream, battleRespawnCry, meleeGrunt, shortPain,
longPain, painRelief, missShothit, hitHp, hitArrmor, hitShield, hitCrit, emptyUnboundButtonSound,
ammoOrGearPickUp, energyShieldLoop`.

Confirms the Mac session's hypothesis that PSET's trailing tokens (`H44,JAD,V33,…`) are a
positional sound set — each slot is a named game-event sound. Note fields are HP/**shields**
(+criticalDamageBonus); reconcile the armor token against §7e's live `$LCD` echo when testing.

## Other command field maps (source-derived)

| Command | Fields (in order) | Notes |
|---|---|---|
| **BMAP** | buttonNumber, function, swapSlot0..3 | button remap + 4 weapon-swap slots |
| **AMMO** | metadata fields = `clip, functionToApply` (partial parse) | **Wire form is `$AMMO,<slot>,<clip>,<reserve>,<flag>,*` — hardware-verified** from the §7e iOS capture that ran a live game (e.g. `$AMMO,0,36,108,1,*`). The metadata field list is incomplete (missing the leading slot and the reserve); trust the captured wire form. |
| **GLED** | mid, effect, optionA, optionB | gun LED — **not** r,g,b (see LedEffect enum); colour is team-derived |
| **GREN** | iRType, crit, modifier, indoorMode, operationMode, channel, (GrenadeType, MaxCount) | **Smart Grenade config** — a whole command we hadn't mapped |
| **HFIRE** | Range, CountIRPulses, RateOfFire, FlashLED | "hyper/heavy fire" IR burst |
| **IRTX** | iRPower, soundOnHit, rangeOutdoor, rangeIndoor | raw IR transmit |
| **LIFE** | addedHP, addedArmor, addedShields | grant health/armor/shields |
| **BHIT** | damage, isCriticalShot, powerLevel | apply a hit to the gun (host-inflicted damage!) |
| **BUMP** | hP, armor, shields | adjust current pools |
| **MELEE** | intensity | melee event |
| **VIB** | isEnableVibration | haptics toggle |
| **PLAY** | (soundName,) addToQue1, addToQue2, loopingTime, stun, isNeedQueue | richer than we used |
| **ASSIST** | soundName | + SetVolume |
| **DLC / ASKDLC / GOTDLC** | hiddenFeatures | premium-content unlock handshake |
| **FSET** | (sound-event slot table — see below) | assigns a sound to every game event |

### FSET — per-event sound slots

Assigns sounds to game events: `ActionKey, CameraKey, SquadReviveKey, PingKey, DeathAlarm,
TickTock, RepairRegenTick, AlertNotify, HitHp, HitArmor, HitShield, HitCrit, HitHealing,
RegenHit, PingedHit, ArrowHit, ArrowMiss, MissBullet, MeleeStabHit, MeleeBash, MeleeCritHit,
HitStandardExplosive, HitSmallExplosive, ShieldOnHeal, ShieldOffExpire, ShieldLoop, EmpStart,
EmpLoop, EmpEnd, IncendiaryStart, IncendiaryLoop, IncendiaryStop, ColdHit, PoisonHit, APHit,
FlashHit, TearGasHit, TypeFourteenHit`. This is the audio-design surface for the whole game.

## Enums (give the above their values)

- **DamageType / AbilityType:** Standard, MedicHeal, ActivateShield, RallyPulse, Radiation,
  Cryogenic, ArmorPiercing, EMP, Shrapnel, StickyBomb, StandardLethalExplosive,
  NonLethalExplosive, ShottyPellets, MeleeDamage, Plasma
- **PowerType / IRSource:** DeviceCommand, IRSource, GunLaser, HeadSetOnly, GunAndHead,
  DoubleGun, DoubleGunAndHead, DRY_FIRE, MuzzleFlash, MuzOnly, VibOnly, MuzAndVib
- **ReloadType:** Magazine, Quiver, Shells, SingleBolt, BoltWithMagazine, AutoReload
- **LedEffect (GLED `effect`):** Solid, Glow, ChaseBack, ChaseForward, StopIR
- **WeaponCategory (id):** 0 Rifle,1 SMG,2 Sniper,3 Shotgun,4 Heavy,5 Energy,6 Support,
  7 Power,8 Exotic,9 Launcher,10 Stun,11 Ability,12 Melee (from weapon-categories-config.json)
- **Headset LED (HLED/BLINK/etc.):** LedColorType = White, Pink, Orange (+ green via
  `isUsedGreenLed`); BlinkLoopType = Once, ThreeTimes, Infinite; LedEffectType includes Heartbeat.
- **ButtonCode (`$BUT` notification):** Trigger, AltFire, Analog (plus the numeric ids 0–5 we
  verified on hardware).

## Premium / DLC game modes (GOTDLC)

The `$GOTDLC` notification and DLC handshake reference three **premium game modes** not in the
base manual: **Generals** (`generalsGameMode`), **Commanders** (`commandersGameMode`), and
**Swarm** (`swarmGameMode`). These are BattleCoins/subscription unlocks. Relevant because a
self-hosted platform can implement equivalents host-side for free — the gun primitives are the
same.

## What's moddable — new guns, new game types, new sounds?

**New guns: YES — a weapon is data, not firmware.** The gun has no weapons baked in; the host
*sends* a full `$WEAP` definition into one of **6 slots (0–5)**. We already ran our own game
with a weapon we defined. You freely set damage, rate of fire, clip/reserve, reload speed,
accuracy, burst, overheat, per-fire sounds, and IR behaviour. The **bounds** are the firmware's
behaviour vocabulary, not a preset list:
- damage/ability behaviours = the **DamageType** enum (~15: Standard, Plasma, Cryogenic, EMP,
  ArmorPiercing, Radiation, Shrapnel, MedicHeal, ActivateShield, RallyPulse, StickyBomb,
  explosives, ShottyPellets, MeleeDamage)
- emission model = **PowerType/IRSource** enum (GunLaser, HeadSetOnly, GunAndHead, DoubleGun…)
- reload model = **ReloadType** enum (Magazine, Quiver, Shells, SingleBolt, BoltWithMagazine,
  AutoReload)
- sounds = any of the 2166 bank ids.
So you can invent any weapon that is a *combination* of these primitives with arbitrary numbers
— an enormous space — but you cannot add a brand-new damage *behaviour* the firmware doesn't
implement. The manual's stock guns are just presets over this same parameter set.

**New game types: YES — essentially unbounded.** The tagger keeps **no game state** (no mode,
clock, score, respawn — proven three ways, experiment-log #13/17/18). "Game mode" lives
entirely in the host. The gun only: fires the loaded weapon, interprets incoming IR per the
**`$SIR` table** (≤14 distinguishable IR recognitions), tracks HP/armor/shields, assigns team
via `$TID`, and reports `$HIR`/`$HP`. Any rules expressible over {hits, teams, health, spawn,
IR signatures} is a game mode you can build — TDM, CTF, Domination, Infection, Juggernaut, or
something new. Callsign's own modes (BattleRoyale, Supremacy…) are *app* classes, not firmware
modes. The only hard primitives that bound gameplay: 6 weapon slots, ≤14 IR recognitions, and
the fixed damage/power behaviour enums above.

**New sounds ON THE TAGGER: YES — via the data port (corrected 2026-08-24).** Earlier we wrongly
concluded "no" from the BLE vocabulary (no `$`-command uploads audio — `$PLAY`/`$PLAYX`/`$VOL`/
`$ASSIST` are playback-only, and that part is still true). But the community confirms the tagger's
**sound files are swappable over the micro-USB data port**: the SD card stays in place (hot-glued to
the mainboard, not removed), and you enter a **mass-storage / file-transfer mode by holding SELECT
while powering the gun on with the USB cable connected** to a computer (it does NOT enumerate as a
drive on a normal boot). People install custom packs (e.g. a Star Wars sound pack) this way. See
`docs/reference/community-notes.md`. This reconciles the earlier "no SD card" note, which was about
*firmware* backup via HalfKay — the *sound storage* is separate and IS accessible.
- Caveat vs prime directive: this changes stored **content**, not firmware; Battle Company's own
  updater does the same, and it's reversible (swap files back / factory-restore). Acceptable, but
  keep originals.
**Also OFF the tagger: YES, unlimited** — a DFPlayer Mini + speaker on the ESP32 bridge (~$5) for
dynamic/unlimited custom audio, plus effect/announcer nodes for arena sound. On-tagger swap is best
for static per-gun packs; the bridge for anything dynamic or unlimited.

## Backend (for context — not tagger protocol)

- REST API: `ltp-prod-v4.us-east-1.elasticbeanstalk.com` (AWS Elastic Beanstalk).
- Multiplayer coordination: **AWS SQS/SNS** (the phone-to-phone lobby; ~1-min lobby delay is a
  cloud round-trip). ECS creds endpoint `169.254.170.2`. IP geo via `ip-api.com`.
- A self-hosted platform replaces this entire cloud layer with the local MQTT bus.

## Method (reproduce / extend)

`global-metadata.dat` version is 39 (anti-dump bump) with encrypted index tables, so
Il2CppDumper fails ("duplicate key 0x09090909"). But identifier strings are plaintext and
stored per-type in declaration order, so field maps come from reading the blob directly:
`strings`/regex around each command name. To recover exact WEAP/PSET token positions, do a
differential Callsign capture (change one field, diff the frame) — now targeted, since we know
every field. Deeper (method bodies, constants): Il2CppInspector with a custom deobfuscator, or
Ghidra on `libil2cpp.so`.
