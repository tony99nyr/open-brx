# The complete Callsign arsenal
_Every weapon the official app can hand you (19 weapons, 20 captured frames), with the numbers it actually sends_
Last verified: 2026-08-27

## How to read the numbers.
*Damage* is the raw number the weapon puts in every shot. It is what your target's gun takes off before any class multiplier. *Cycle* is milliseconds between shots. For charge weapons it is the charge time. *Reserve* is your total spare rounds. The app shows it as magazines (mags × clip = reserve). *Heat* is added per shot, and only on weapons that can overheat. *Hits to kill* is against the default 115-point pool (45 HP + 70 armor). We give it only for weapons whose shots land as standard damage on the target's effect table.
Source: docs/reference/weapons.md (column notes), docs/weapon-design.md §0–§1.2

## The Callsign 19
filter by class, fire mode, overheats or one-shot. Sort by any column.
| Weapon | Class (Open BRX role) | Fire mode | Damage | Cycle ms | RPM (derived) | Clip | Reserve (mags) | Heat/shot | Reload s | Range | Hits to kill @115 | Fire sound |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| Assault Rifle | Assault | full auto | 9 | 100 | 600 | 32 | 384 (12) | 0 | 1.4 | standard | 13 | R01 |
| Burst Rifle | Assault | 3-round burst (275 ms between bursts) | 9 | 75 | ~424 burst-avg | 36 | 216 (6) | 0 | 1.7 | standard | – | R18 |
| Force Rifle | Assault | 3-round burst (250 ms between bursts); pull-back/let-go reload | 9 | 100 | ~400 burst-avg | 36 | 144 (4) | 0 | 1.7 | standard | – | R23 |
| Bolt Rifle | Assault | single shot | 13 | 225 | 267 | 18 | 180 (10) | 0 | 2.0 | standard | – | R12 |
| SMG | CQB | full auto · **overheats** | 8 | 90 | 667 | 72 | 288 (4) | 5 | 2.5 | standard | 15 | G03 |
| Shotgun | CQB | single shot · shell reload (per shell) | 45 | 900 | 67 | 6 | 24 (4) | 0 | 0.4 | standard (+extra headset range) | 3 | T01 |
| Stinger | CQB | full auto | 15 | 120 | 500 | 18 | 72 (4) | 0 | 1.7 | standard | 8 | E11 |
| Sniper Rifle | Marksman | single shot · bolt (pull back, release) | 80 | 300 | 200 | 4 | 24 (6) | 0 | 1.7 | standard | 2 | S16 |
| Plasma Sniper | Marksman | single shot · **overheats** if fired fast · shell reload | 80 | 225 | 267 | 10 | 80 (8) | 30 | 2.0 | standard (+extra headset range) | 2 | E17 |
| AMR | Support | single shot, no full auto | 18 | 360 | 167 | 14 | 56 (4) | 0 | 1.4 | standard | – | S07 |
| Suppressor | Support | full auto · **quiet, no muzzle flash** | 8 | 75 | 800 | 48 | 288 (6) | 0 | 2.0 | standard | 15 | Q06 |
| Energy Rifle | Support | full auto · **overheats** · 300-round clip | 9 | 90 | 667 | 300 | 600 (2) | 6 | 2.4 | standard | 13 | E12 |
| Charge Rifle | Support | hold to charge, **fires on release** · **overheats** | 100 | 1250 (charge) | 48 | 100 | 200 (2) | 14 | 2.5 | standard | 2 | E03 |
| Rocket Launcher | Power | single shot · explosive damage type | 115 | 1000 | 60 | 2 | 8 (4) | 0 | 1.2 | standard (+extra headset range) | 1 | C03 |
| Rail Gun | Power | charges, **auto-fires** after ~1 s (a tap also fires) · armor-piercing type | 115 | 1200 (charge) | 50 | 1 | 6 (6) | 0 | 2.4 | standard | 1 | C03 |
| Laser Cannon | Power | **must be held** to charge; a tap fires nothing | 115 | 1500 (charge) | 40 | 4 | 8 (2) | 0 | 2.0 | standard | 1 | C06 |
| Energy Launcher | Power | single shot (1-round clip) | 115 | 360 | 167 | 1 | 6 (6) | 0 | 1.4 | standard | – | J15 |
| Ion Sniper | Power | single shot, alien-sounding | 115 | 1000 | 60 | 2 | 12 (6) | 0 | 2.0 | standard | 1 | E07 |
| Melee | Melee | gyro swing (butt of the gun) | 90 | 1000 | 60 | 1 | 0 | 0 | – | short (melee) | 2 | M92 |

*19 weapons come out of 20 captured frames. The 20th frame is the app's unnamed default secondary (`T01`, 45 dmg, 6-round clip, 4 mags, 0.4 s shell reload). That is the Shotgun itself, slotted as your sidearm before you pick one.*

✅ (damage, cycle, clip, reserve, heat, fire mode, sound: captured frames + bench; range: the wire carries one range value for all 18 guns, see the note below; hits to kill: only where the weapon's damage type resolves as standard damage on the captured effect table) · 📖🔍 (reload s, mags: the app's weapon-select screen)
Source: docs/reference/weapons.md, docs/weapon-design.md §1.2 + §4.1 + §4.2, docs/reference/callsign-ui.md §Weapon roster, mcp/brx_mcp/mc/weapons.json (role), protocol/brx-protocol.md §"$WEAP t20 - FIRE MODE"

## Range is not what the app's bar shows.
The app draws a different Range bar for each weapon. But the range field in the frames it sends reads the same value (75) on all 18 guns. Melee reads 20. A separate "extra headset range" value of 30 shows up on the Rocket, Shotgun and Plasma Sniper.
Source: docs/weapon-design.md §4.2

## Stock Callsign hits soft and fast.
The standard-damage automatics deal 8–15 per hit every 75–120 ms. They need 8–15 hits, which is about a second of landed fire. The Rocket Launcher, Rail Gun, Laser Cannon and Ion Sniper deal 115. That drops a full-health player in one shot. The two snipers deal 80 every 225–300 ms and kill in two hits, in 0.23–0.30 s.
Source: docs/weapon-design.md §1.2 "SHIPPED"

## Per-weapon cards
- **Assault Rifle**: Assault · full auto · 9 dmg · 100 ms · 32/384 · reload 1.4 s. This is the baseline gun. It takes 13 hits to kill, and 1.2 s if every shot lands. (The gun-menu M-4 is printed at 24 damage in the manual. The app's Assault Rifle sends 9.)
- **Burst Rifle**: Assault · 3 rounds per trigger pull, 75 ms inside the burst, 275 ms between bursts · 9 dmg · 36/216 · reload 1.7 s. One of only two weapons with native burst timing.
- **Force Rifle**: Assault · 3-round burst (100 ms / 250 ms between) · 9 dmg · 36/144 · 1.7 s. You reload it with a "pull back, let go" motion on the handle.
- **Bolt Rifle**: Assault · single shot · 13 dmg · 225 ms · 18/180 · 2.0 s. The rifle with the biggest damage number.
- **SMG**: CQB · full auto · 8 dmg · 90 ms · 72/288 · 2.5 s · **heat 5/shot**. Big clip, long reload. It empties a health pool faster than any other automatic, in 15 hits.
- **Shotgun**: CQB · single shot · 45 dmg · 900 ms · 6/24 · **shell-by-shell reload at 0.4 s per shell**. Three hits to kill. It is the only weapon with the "Shells" reload type.
- **Stinger**: CQB · full auto · 15 dmg · 120 ms · 18/72 · 1.7 s. The hardest-hitting automatic: 8 hits, and 0.84 s to kill.
- **Sniper Rifle**: Marksman · bolt-action single shot · 80 dmg · 300 ms · 4/24 · 1.7 s. Two hits to kill.
- **Plasma Sniper**: Marksman · single shot · 80 dmg · 225 ms · 10/80 · 2.0 s · **heat 30/shot**. Spam it and it overheats. Fastest time-to-kill in the arsenal at 0.23 s.
- **AMR**: Support · single shot only · 18 dmg · 360 ms · 14/56 · 1.4 s. A slow, deliberate pace.
- **Suppressor**: Support · full auto · 8 dmg · 75 ms · 48/288 · 2.0 s. **Quiet (not silent) and no muzzle flash.** It is the only weapon with the stealth fields set.
- **Energy Rifle**: Support · full auto · 9 dmg · 90 ms · **300-round clip**, 600 reserve · 2.4 s · heat 6/shot. You can fire a long time without reloading. Heat is what stops you.
- **Charge Rifle**: Support · **hold to charge, fires when you let go** · 100 dmg · 1.25 s charge · 100/200 · 2.5 s · heat 14/shot. Two hits to kill. It is the one weapon with both a charge-up sound and a release sound.
- **Rocket Launcher**: Power · single shot · 115 dmg (explosive damage type) · 1.0 s · 2/8 · 1.2 s. A one-shot kill.
- **Rail Gun**: Power · **charges and fires itself after ~1 s**, and a tap fires too · 115 dmg (armor-piercing type) · 1/6 · 2.4 s. A one-shot kill. It has no release sound, because it fires itself.
- **Laser Cannon**: Power · **you must hold it to charge, and a tap does nothing** · 115 dmg · 1.5 s charge · 4/8 · 2.0 s. A one-shot kill.
- **Energy Launcher**: Power · single shot from a 1-round clip · 115 magnitude · 360 ms · 1/6 · 1.4 s. Six spare rounds.
- **Ion Sniper**: Power · single shot, alien-sounding · 115 dmg · 1.0 s · 2/12 · 2.0 s. A one-shot kill, with the most reserve in the power tier.
- **Melee**: Melee · **gyro swing** with the butt of the gun · 90 dmg · 1.0 s · no ammo · no reload. Two swings kill. The hit comes from the front headset emitter.
Source: docs/reference/weapons.md, docs/weapon-design.md §1.2 · docs/reference/weapons.md §What the operator's descriptions pinned down · docs/reference/weapons.md · docs/reference/weapons.md · docs/reference/weapons.md · docs/weapon-design.md §1.1 + §4.3 · docs/weapon-design.md §1.2 · docs/weapon-design.md §1.2 + §6.2, protocol/brx-protocol.md §7r addendum · docs/reference/weapons.md · docs/reference/weapons.md · docs/reference/weapons.md · docs/reference/weapons.md · docs/reference/weapons.md · docs/weapon-design.md §4.3 · docs/reference/weapons.md · docs/reference/weapons.md · docs/reference/weapons.md · docs/reference/weapons.md · docs/reference/weapons.md, docs/reference/brx-extended-user-guide.md §Modes/handling

## Fire-mode vocabulary
the firmware's seven behaviours, all confirmed on the trigger. Every Callsign weapon uses one of them.
| Fire mode | What the trigger does | Callsign weapons |
|---|---|---|
| Full auto | hold it down to keep firing at the cycle rate | Assault Rifle, SMG, Suppressor, Energy Rifle, Stinger, Energy Launcher |
| Single shot / bolt | one round per pull | AMR, Bolt Rifle, Sniper, Plasma Sniper, Ion Sniper, Rocket Launcher, Shotgun |
| 3-round burst | one pull sends three rounds, then a burst gap | Burst Rifle, Force Rifle |
| Charge, auto-release | starts charging on the pull, then fires by itself (~1 s); a tap also fires | Rail Gun |
| Hold-to-charge | you must hold it through the whole charge; a tap is sound only | Laser Cannon |
| Charge, fire on release | charge while you hold, fire when you let go | Charge Rifle |
| Melee | a swing the gyro picks up | Melee |
Source: protocol/brx-protocol.md §"$WEAP t20 - FIRE MODE", docs/weapon-design.md §4.1

## The app's own weapon categories
(a UI grouping, not a wire field): Rifle · SMG · Sniper · Shotgun · Heavy · Energy · Support · Power · Exotic · Launcher · Stun, plus Ability and Melee. Nothing the gun receives says which category a weapon is in. So the table above uses Open BRX's role grouping instead.
Source: protocol/callsign-extract/weapon-categories-config.json, protocol/callsign-extract/config-facts.md

## No stock weapon has an alt-fire.
The secondary-fire fields are empty on all 20 captured frames. The orange ALT button cycles perks and abilities in the modes that have them. Every weapon is also just *data*. A host can send its own weapon into any of the gun's 6 slots: damage, rate, clip, reload, burst, overheat and sounds. That is exactly what Open BRX does.
Source: docs/reference/weapons.md (tokens 7–11), protocol/callsign-extract/protocol-classes.md §What's moddable

## The gun-menu weapons (phoneless play)
the manual's stock presets, exactly as printed. The damage scale here is not the Callsign scale above. The manual's M-4 says 24; the app's Assault Rifle sends 9.
| Weapon | Damage | Rate of fire | Accuracy | Mag | Character |
|---|---:|---:|---|---:|---|
| M-4 | 24 | 545 | 96–91 | 30 | full auto, low damage, medium mag |
| SMG-X3 | 25 | 545 | 96–88 | 26 | 3-round burst |
| MG-7 | 38 | 342 | 66–45 | 75 | suppressing auto, low accuracy, overheats/jams on sustained fire |
| SR-100 | 140 | 44 | 100–90 | 4 | bolt, high damage, small mag |
| TAC-87 | 120–40 | 150 | 95–80 | 8 | semi shotgun; hold reload to load shells; full damage only at melee range |
Also described in the Extended Guide: **TAR-33** (semi-auto, medium) and a **Silenced AR**. The two accuracy numbers are the manual's simulated-recoil model. Fire fast and your accuracy drifts toward the lower number. A miss still reaches the enemy: their headset lights up and they hear a zip, but they take 0 damage. Fire in bursts.
Source: docs/reference/brx-manual-notes.md §Stock weapons, docs/reference/brx-extended-user-guide.md §Weapons

_[image GAME-02: Weapon-class icon set (one per class present in the roster).]_
