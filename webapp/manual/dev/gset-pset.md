# `$GSET` and `$PSET`: game and player settings
_The two frames that set on-gun rules and the player's pools, identity and voice pack. Read this page to give each player their health, armor and id._
Last verified: 2026-09-06

## `$GSET,<t1>,…,<t8>,*`, validated against the captured `$GSET,0,0,1,0,1,0,50,1,*`
| # | Field | Captured | Meaning | Conf |
|---|---|---|---|---|
| 1 | friendlyFire | 0 / 1 | **Firmware-enforced, both directions.** 0 blocks same-team damage *and* heals from enemies; 1 opens the gate. Replicated 2× with alternating values plus control. | ✅ |
| 2 | outdoorMode | 0 | The **indoor/outdoor** setting, the same one the gun toggles natively on a 3 second ALT hold. Outdoor raises IR range, hit-LED brightness and blast radius; indoor shrinks them. See [Indoor vs Outdoor Mode](/manual/operate/indoor-outdoor). Field name and mapping are APK-decoded and **we have not yet set it over BLE and observed the change**. | 🔍 |
| 3 | gunLaserRegion | 1 | **IR transmit power, as a regional legal limit** (USA vs International). This is the one field that looks like a direct power control, so it is the first thing to try if you want a weaker beam for indoor play. APK-decoded; **untested on the bench**, and we do not know whether it is two coarse levels or finer. | 🔍 |
| 4 | autoAmbientLight | 0 | Ambient-light compensation, presumably the sunlight IR-noise filtering the user guide describes. APK field name; not exercised on the bench. | 🔍 |
| 5 | gyroscope | 1 | APK field name; not exercised on the bench. | 🔍 |
| 6 | secondaryBluetoothWeapons | 0 | APK field name; not exercised on the bench. | 🔍 |
| 7 | criticalShotModifier | 50 | APK field name. **Not** score-to-win (byte-identical across captures with different win conditions). | 🔍 ✅ |
| 8 | gameMods | 1 | APK field name; not exercised on the bench. | 🔍 |
Source: protocol/callsign-extract/protocol-classes.md (GSET), protocol/brx-protocol.md §3, protocol/session-findings-2026-08.md §7n; docs/experiment-log.md (FF enforcement table)

## There is no respawn, time, lives or score token.
Three captures at respawn 5/15/30 s and different clocks produced byte-identical `$GSET` and `$PSET`, and the 8-field map from the app metadata contains none of them. Those live in the host. Stop looking.
Source: protocol/session-findings-2026-08.md §7n

## `$PSET,<t1>,…,*`, sample `$PSET,6,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*`
| tok | Field | Sample | Meaning | Conf |
|---|---|---|---|---|
| 1 | **player id** | 6 | **0-based, 0–63 (6 bits)**. The app's UI shows 1–64 and writes id−1 (app 7 → wire 6, app 64 → 63, an out-of-range 69 clamps to 63). Ends up in every IR shot's P field and comes back as `$HIR` token 3 on whoever you hit. | ✅ |
| 2 | n/a | 0 | 0 in every capture; 0/1/7 gave byte-identical behaviour. Inert. | ✅ |
| 3 | HP | 45 | Starting/max HP. Echoed as `$LCD` token 1 after `$SPAWN`. | ✅ |
| 4 | armor | 70 | Armor pool (`$LCD` token 2, `$HP` token 2). | ✅ |
| 5 | shield | 70 | Shield **maximum**. The pool starts at 0 and only fills via an IR `$SIR` grant function. It is not BLE-writable as a value. | ✅ |
| 6 | n/a | 50 | (unknown) | n/a |
| 7 | (empty) | n/a | | n/a |
| 8+ | **positional voice pack** | H44 JAD V33 V3I V3C V3G V3E V37 H06 H55 H13 H21 H02 U15 W71 A10 | Sixteen sound ids on the wire. The app's metadata declares these voice-pack fields: deathAlarm, stealthDeathScream, musicMixOnDeath, deathScream, battleRespawnCry, meleeGrunt, shortPain, longPain, painRelief, missShothit, hitHp, hitArrmor, hitShield, hitCrit, emptyUnboundButtonSound, ammoOrGearPickUp, energyShieldLoop. Which wire slot carries which name: (unknown). | 🔍 |
Source: protocol/brx-protocol.md §3, protocol/session-findings-2026-08.md §7e, §7p, §7r; protocol/callsign-extract/protocol-classes.md (PSET); mcp/brx_mcp/gameconfig.py; docs/FOLLOWUPS.md (P3)

## Numbering a fleet is one token.
Give every gun a distinct `$PSET` token 1 at arm time and per-player kill attribution is BLE-native: no cable, no IR receiver. Show operators 1-based ids; write `id − 1`.
Source: protocol/session-findings-2026-08.md §7p, §7q
