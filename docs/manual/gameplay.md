# Gameplay
Last verified: 2026-09-10

This page covers every weapon the BRX can fire, how health and damage work, every native game mode and its settings, the classes and perks the Callsign app models, and the Smart Grenade's objective modes.

## What the BRX can play

The BRX runs games three ways. You can play from the gun's own menu, with no phone at all. That gives you 7 modes, 5 to 7 stock guns and 9 Supremacy characters. You can play from the Callsign app (14 mode families, a 19-weapon arsenal, QR pickups, perks and killstreaks). Or you can play from a host of your own: that is Open BRX, any rule you can write over hits, teams, health and spawns. All three push the same basics into the same firmware. The gun keeps no game state, so the mode is always whoever is talking to it.

- 19 weapons in the Callsign app arsenal, from 20 captured frames (every one read off the wire)
- 7 gun-menu modes with no phone at all: FFA, Death Match, Generals, Supremacy, Commander, Survival, The Swarm
- 14 mode families built into the Callsign app
- 115 is the default health pool (45 HP + 70 armor)
- 4 native hardware teams (team id is 2 bits in every shot)
- 5 Smart Grenade objective modes, set by a button and a colour

- The arsenal: all 19 Callsign weapons (20 captured frames) with damage, cycle, clip, reserve, heat, reload and fire mode.
- Health, armor and damage: what a hit takes off, what armor does, and why nothing heals on its own.
- How a kill actually works: the 25-bit word of light, the sensors that catch it, the green flash that confirms it.
- Native modes and settings: every gun-menu and Callsign mode, with the exact setting values.
- Classes, factions, perks and killstreaks: Nexus/Resistance/Vanguard, the 9+ characters, the perk row, the streak rewards.
- The grenade's game modes: Frag, Assault, Hill, Respawn, CTF, and how each one really behaves.

> **Two arsenals, one gun.** The gun-menu weapons (M-4, SMG-X3, MG-7, SR-100, TAC-87 and others) are presets the firmware carries for play without a phone. The Callsign app's 19 weapons get sent to the gun over Bluetooth when the game starts. They fill the same 6 weapon slots with different numbers. This section covers the Callsign 19 in full, because we captured every one of them on the wire (20 frames). The five gun-menu weapons are listed from Battle Company's manual.

## The complete Callsign arsenal

> **How to read the numbers.** The table's columns are Weapon, Role, Damage, Cycle ms, Mag, Reserve, Reload ms, Heat/shot and Fire sound. Damage is the raw number the weapon puts in every shot. It is what your target's gun takes off before any class multiplier. Cycle ms is milliseconds between shots; for charge weapons it is the charge time. Mag is the magazine size, and Reserve is your total spare rounds (the app shows reserve as magazines: mags x clip = reserve). Heat/shot is the value the frame's heat token carries. Four weapons set it: SMG 5, Energy Rifle 6, Charge Rifle 14, Plasma Sniper 30. A heat number on its own does nothing, because the two tokens that switch the overheat system on are set only on the Charge Rifle, so it is the only stock weapon whose gauge actually climbs. Hits to kill is against the default 115-point pool (45 HP + 70 armor), given only for weapons whose shots land as standard damage on the target's effect table. It is in the per-weapon notes below, not in the table. Two caveats on those numbers: hits to kill assumes damage does not depend on which sensor is struck (a Callsign capture shows 18 per hit on headset sensor 0 against 9 per hit on gun body sensor 4, same victim, same life), and Reserve is the frame's `t17` token, which is exactly twice its other spare-ammo token (`t40`), so which of the two is a player's true spare-round count is unsettled.

The table below lists every weapon the Callsign app can hand you, with the numbers it actually sends. The search box does a plain text match across all nine columns, so type part of a weapon name, a role or a sound name to narrow the list.

```data
weapons
```

19 weapons come out of 20 captured frames. The 20th frame is the app's unnamed default secondary (`T01`, 45 dmg, 6-round clip, 4 mags, 0.4 s shell reload). That is the Shotgun itself, slotted as your sidearm before you pick one.

> **Range is not what the app's bar shows.** The app draws a different range bar for each weapon, but the range field in the frames it sends reads the same value (75) on all 18 guns. Melee reads 20. A separate "extra headset range" value shows up on three weapons: 30 on the Shotgun and the Rocket Launcher, 40 on the Plasma Sniper.

> **Stock Callsign hits soft and fast.** The standard-damage automatics deal 8 to 15 per hit every 75 to 120 ms. They need 8 to 15 hits, which is about a second of landed fire. The Rocket Launcher, Rail Gun, Laser Cannon and Ion Sniper deal 115: that drops a full-health player in one shot. The two snipers deal 80 every 225 to 300 ms and kill in two hits, in 0.23 to 0.30 s.

### Assault Rifle

Assault, full auto, 9 dmg, 100 ms, 32/384, reload 1.4 s. This is the baseline gun. It takes 13 hits to kill, and 1.2 s if every shot lands. (The gun-menu M-4 is printed at 24 damage in Battle Company's manual. The app's Assault Rifle sends 9.)

### Burst Rifle

Assault, 3 rounds per trigger pull, 75 ms inside the burst, 275 ms between bursts, 9 dmg, 36/216, reload 1.7 s. One of only two weapons with native burst timing.

### Force Rifle

Assault, 3-round burst (100 ms / 250 ms between), 9 dmg, 36/144, 1.7 s. You reload it with a "pull back, let go" motion on the handle.

### Bolt Rifle

Assault, single shot, 13 dmg, 225 ms, 18/180, 2.0 s. The rifle with the biggest damage number.

### SMG

CQB, full auto, 8 dmg, 90 ms, 72/288, 2.5 s, heat 5/shot. 8 damage is the lowest in the arsenal, so the SMG is the slowest automatic to empty a health pool: 15 hits and 1.26 s, against the Stinger's 8 hits in 0.84 s, the Suppressor's 15 in 1.05 s, the Energy Rifle's 13 in 1.08 s and the Assault Rifle's 13 in 1.2 s. What you buy for that is staying power. 72 rounds is the biggest magazine of any automatic bar the Energy Rifle, nearly five kills without reloading, and the price is the longest reload in the game at 2.5 s (tied with the Charge Rifle). Its heat token reads 5, but the overheat gate is not set, so it never overheats.

### Shotgun

CQB, single shot, 45 dmg, 900 ms, 6/24, shell-by-shell reload at 0.4 s per shell. Three hits to kill. It is the only weapon with the "Shells" reload type.

### Stinger

CQB, full auto, 15 dmg, 120 ms, 18/72, 1.7 s. The hardest-hitting automatic: 8 hits, and 0.84 s to kill.

### Sniper Rifle

Marksman, bolt-action single shot, 80 dmg, 300 ms, 4/24, 1.7 s. Two hits to kill.

### Plasma Sniper

Marksman, single shot, 80 dmg, 225 ms, 10/80, 2.0 s, heat 30/shot. The fastest multi-hit time-to-kill in the arsenal at 0.23 s: the 115-damage weapons kill outright in one shot. Its heat token reads 30, the highest number in the arsenal, but the two gate tokens are empty in its captured frame, so as Callsign sends it there is no heat lockout. What limits you is the 10-round magazine and the 2 s reload.

### AMR

Support, single shot only, 18 dmg, 360 ms, 14/56, 1.4 s. A slow, deliberate pace.

### Suppressor

Support, full auto, 8 dmg, 75 ms, 48/288, 2.0 s. Quiet (not silent) and no muzzle flash. It is the only weapon with the stealth fields set.

### Energy Rifle

Support, full auto, 9 dmg, 90 ms, 300-round clip, 600 reserve, 2.4 s, heat 6/shot. 300 rounds is the biggest magazine in the arsenal by a wide margin, and 13 hits kill, so that is roughly 23 kills before you reload. Its heat token reads 6, but like the SMG and the Plasma Sniper it ships without the gate tokens, so nothing stops the burst except the magazine.

### Charge Rifle

Support, hold to charge and fire when you let go, 100 dmg, 1.25 s charge, 100/200, 2.5 s, heat 14/shot. Two hits to kill. It is the one weapon with both a charge-up sound and a release sound, and the one weapon whose overheat gate is actually set, so its heat gauge is the only stock gauge that climbs and locks out.

### Rocket Launcher

Power, single shot, 115 dmg (explosive damage type), 1.0 s, 2/8, 1.2 s. A one-shot kill.

### Rail Gun

Power, charges and fires itself after about 1.2 s (a tap also fires), 115 dmg (armor-piercing type), 1/6, 2.4 s. A one-shot kill. It has no release sound, because it fires itself.

### Laser Cannon

Power, you must hold it to charge, and a tap does nothing. 115 dmg, 1.5 s charge, 4/8, 2.0 s. A one-shot kill.

### Energy Launcher

Power, full auto on the wire, but with a 1-round clip every shot is followed by a reload. 115 magnitude, 360 ms, 1/6, 1.4 s. Six spare rounds.

### Ion Sniper

Power, single shot, alien-sounding, 115 dmg, 1.0 s, 2/12, 2.0 s. A one-shot kill, with the most reserve in the power tier.

### Melee

Melee, gyro swing with the butt of the gun, 90 dmg, 1.0 s, no ammo, no reload. Two swings kill. The hit comes from the front headset emitter.

The firmware has seven fire-mode behaviours, all confirmed on the trigger. Every Callsign weapon uses one of them.

| Fire mode | What the trigger does | Callsign weapons |
|---|---|---|
| Full auto | hold it down to keep firing at the cycle rate | Assault Rifle, SMG, Suppressor, Energy Rifle, Stinger, Energy Launcher |
| Single shot / bolt | one round per pull | AMR, Bolt Rifle, Sniper, Plasma Sniper, Ion Sniper, Rocket Launcher, Shotgun |
| 3-round burst | one pull sends three rounds, then a burst gap | Burst Rifle, Force Rifle |
| Charge, auto-release | starts charging on the pull, then fires by itself (about 1.2 s); a tap also fires | Rail Gun |
| Hold-to-charge | you must hold it through the whole charge; a tap is sound only | Laser Cannon |
| Charge, fire on release | charge while you hold, fire when you let go | Charge Rifle |
| Melee | a swing the gyro picks up | Melee |

> **The app's own weapon categories** (a UI grouping, not a wire field): Rifle, SMG, Sniper, Shotgun, Heavy, Energy, Support, Power, Exotic, Launcher, Stun, plus Ability and Melee. Nothing the gun receives says which category a weapon is in, so this manual uses a role grouping instead (Assault, CQB, Marksman, Support, Power, Melee).

> **No stock weapon has an alt-fire.** The secondary-fire fields are empty on all 20 captured frames. The orange ALT button cycles perks and abilities in the modes that have them. Every weapon is also just data: a host can send its own weapon into any of the gun's 6 slots, with its own damage, rate, clip, reload, burst, overheat and sounds. That is exactly what Open BRX does.

Battle Company's stock presets below are for phoneless play. The damage scale here is not the Callsign scale above: the printed M-4 says 24, and the app's Assault Rifle sends 9.

| Weapon | Damage | Rate of fire | Accuracy | Mag | Character |
|---|---:|---:|---|---:|---|
| M-4 | 24 | 545 | 96-91 | 30 | full auto, low damage, medium mag |
| SMG-X3 | 25 | 545 | 96-88 | 26 | 3-round burst |
| MG-7 | 38 | 342 | 66-45 | 75 | suppressing auto, low accuracy, overheats/jams on sustained fire |
| SR-100 | 140 | 44 | 100-90 | 4 | bolt, high damage, small mag |
| TAC-87 | 120-40 | 150 | 95-80 | 8 | semi shotgun; hold reload to load shells; full damage only at melee range |

Also described in the Extended Guide: the TAR-33 (semi-auto, medium) and a Silenced AR. The two accuracy numbers are that weapon's ceiling and floor: fire fast and your accuracy drifts down from the first number toward the second. A miss still reaches the enemy (their headset lights up and they hear a zip), but they take 0 damage. Fire in bursts, or reload, to bring your accuracy back up. See *How a kill actually works* for the mechanism.

## Health, armor and damage

Every player is a pool of points: 45 health and 70 armor by default, which is 115 in total. A hit comes off your armor first. Whatever armor cannot soak up spills straight into your health. When your health hits zero you are out. Nothing in the stock firmware fills you back up until you respawn.

**What happens when you get hit:**

1. The shot's damage number lands on your gun. The IR word carries it (see *How a kill actually works*).
2. Your gun looks up the shot's damage type in its effect table. Most shots are "standard damage". Class abilities can be heals, shield grants or multipliers instead.
3. Armor soaks damage 1 for 1, with no cap per hit. An 80-point standard hit takes all 70 armor and 10 health at once.
4. Health takes the rest. Your headset and gun play the hit tone. The gun reports your new pool to any connected phone.
5. At 0 health the gun plays the death alarm, stops firing, and ignores every incoming shot until it respawns.

| Question | Answer |
|---|---|
| Default pool? | 45 HP + 70 armor = 115. Modes like Battle Royale offer Low / Medium / Full starting health. |
| Does armor reduce damage? | No. It is extra hit points, and it drains first. Armor never makes a hit weaker. |
| Do I heal over time? | No. Armor shot down to 18 stayed at 18 for 30 s. Any healing you see comes from a class ability, a medic, or a host that refills you. |
| What is a shield? | A third pool that sits above armor. Nexus-style classes use it (Guardian 125, Marauder 150, Sentinel 175). It only fills from an IR "activate shield" event. A phone cannot just set it. |
| Can a medic heal me? | Yes. The Supremacy Medic's medi-gel pulse is a heal shot, and the community confirms it heals by shooting teammates. A host can also grant health directly. |
| Do heals overfill? | No. A heal adds to your pool and stops at the maximum. |
| Head shots? | The headset has four sensor domes, one of them at the back, and the gun body has a sensor of its own. Every shot carries a crit flag, but no stock weapon sets it. A crit multiplies damage by `1 + $GSET t7/100`. That is a per-game setting: x1.5 at the shipped t7=50, and t7=0 turns crits off. |
| Can friendly fire hurt me? | Only if the game turns it on. The documented rule: with friendly fire off, the gun itself blocks same-team damage (and blocks enemy "heals"). One bench result contradicts that rule (see the note below). FFA is one team with friendly fire on. |

> **Friendly-fire polarity is not settled.** The rule above is the documented one: with friendly fire off, a gun drops a shot that names the gun's own team. One bench run on 2026-09-07 came out backwards. With friendly fire off, a shot claiming the gun's own team registered and a shot claiming an enemy team did not, each reproduced twice. Nothing has explained it yet, so treat same-team behaviour as unproven until something does.

> **Heals and boosts "add", they never "set".** When a phone or host gives health to a live gun, the amount is added to your current pool and stops at the maximum. Nobody can set you to a lower number this way, and a grant to a full-health player does nothing. That is why Halo-style regenerating shields, health-on-kill and medic roles all work the same way: a host watches your pool and tops it up.

> **A dead gun is deaf, unless a station armed it.** At 0 health a tagger that was never armed to a respawn station takes no IR at all, and a tagger in a host-driven game takes none either. A tagger armed by a station in a native game is the exception: it stays dead, refuses the trigger, says "revive at respawn point", and comes back the moment the station beacon reaches it.

| Setting | Gun-menu values (V7 manual / Extended Guide) | Callsign app values |
|---|---|---|
| Lives | a count, or unlimited | a number, or Unlimited |
| Respawn time | Off, 15, 30, 60 s, Ramp 45, Ramp 90 (the penalty grows with each death) | a number in seconds (e.g. 15) |
| Respawn type | self-respawn on the gun, or at a respawn station (grenade) once armed | Scanner (respawn at a QR / station) or Auto (timed) |
| Game time | Off, 5, 10, 15, 20, 30 min | a number in minutes |

> "Taking damage while in the respawn state is disliked" is a balance note that comes up again and again in the owner community. The gun menu's Ramp 45 and Ramp 90 respawn options grow the wait with each death.

## How a kill actually works

A BRX "bullet" is a burst of infrared light 25 bits long, sent on a 38 kHz carrier. It carries who fired (player id), which team, how much damage, and what kind of damage. Your target's headset or gun catches it, looks it up, and takes off the damage. If that was the last of their health, your sight flashes green.

**The five steps:**

1. **Fire.** The trigger pull sends the IR word: a 2 ms start pulse, then 25 bits (a long pulse is 1, a short one is 0). Damage type (4 bits), player id (6 bits, 0-63), team (2 bits, 4 teams), damage (8 bits, up to 255), crit flag, effect subtype, 2 check bits.
2. **Catch.** Your target has five receivers: four domes on the headset, one of them at the back, and a sensor on the gun body. Whichever one catches the word reports it, and the wire tells front from back from gun. Across the field that tells you where the shot came from. At point-blank range the IR floods every sensor, and the first one to see it wins.
3. **Resolve.** The target's gun checks the team bits first. Same team with friendly fire off means the shot is dropped, which is the documented rule that one unexplained bench result contradicts (see *Health, armor and damage*). Then it looks up the damage type in its effect table and applies the damage: armor first, then health.
4. **Feedback.** The target's headset flashes green once on a hit, and blinks green steadily while they are out, and plays the pain or death sound. The gun reports the hit and the new health to any connected phone. Melee, explosive and other damage types each get their own hit sound.
5. **Confirm.** On a kill the shooter's sight flashes green and the announcer says "kill". In a phoneless gun-menu game the guns do this on their own, with no phone involved. In an app-hosted game the phone scores the kill and drives the same flash and voice line.

> **Why misses still make noise.** Every weapon carries a live accuracy model. It has a ceiling and a floor, and you start each life at the ceiling. Keep firing and your accuracy drifts down toward the floor, a bit more with every shot. Reload and you are back at the ceiling. A natural recovery races the drop, so firing slower keeps your accuracy higher: on the harshest setting we tested, single shots about 2 seconds apart held steady one step below the ceiling, while holding the trigger ran it all the way to the floor. How fast it recovers has not been measured. A miss under this model still reaches the enemy: their headset lights and they hear a zip, but the hit carries 0 damage. If someone's headset keeps flashing and they are not dying, you are missing. Fire in bursts, and reload to reset your accuracy outright.

| Event | Victim | Shooter |
|---|---|---|
| Hit (non-lethal) | one green headset flash, hit tone (HP / armor / shield / crit each have their own), gun LEDs | nothing (a plain hit is never confirmed back to the shooter) |
| Kill | headset sustained green blink (the out state), death alarm, gun stops firing | green sight flash + "kill" callout; in gun-menu games also "double kill" and other streak lines |
| Same team, FF off | nothing (the gun drops the shot, by the documented rule one bench result contradicts) | nothing |
| Miss (accuracy roll) | headset lights + zip, 0 damage | (none) |

> **Every shot names its shooter.** The 6-bit player id in the word is why a host can credit the exact killer, run free-for-all scoring, and build health-on-kill. All of it comes from what the target's gun reports. Stock BRX uses it too: that is how the kill-confirm and streak callouts find the right gun. The full bit layout, the timings and the effect-table mechanism are in the developer reference.

## Native game modes and their settings

The gun's menu gives you seven modes with no phone at all. The Callsign app adds objective play (flags, control points, QR pickups, Battle Royale) plus premium unlocks. Under both, the tagger only fires, gets hit, tracks health and reports. The rules live in the gun menu's firmware presets or in the app.

The mode LED colour shows what you picked. Modes marked with a star are Callsign-Live unlocks on the gun.

| Mode | LED | Teams | How it plays | Weapons / perks |
|---|---|---|---|---|
| Free For All | white | none (everyone is one team with friendly fire on) | most kills wins | M-4, SMG-X3, MG-7, SR-100, no perks |
| Death Match / Team Death Match | red | Alpha vs Bravo | team kills | M-4, SMG-X3, MG-7, SR-100, TAC-87, the only stock mode with the perk row |
| Generals (*) | yellow | two teams, each with a General | the General is your team's mobile respawn point, so pull the trigger at them to revive; it can be lives-limited for seek-and-destroy | TDM loadouts + perks |
| Supremacy | blue | 3 factions: Resistance (red), Vanguard (green), Nexus (blue) | class-based; 9 characters are the loadout | no weapon picker, because the character is the loadout; abilities on ALT |
| Commander (*) | pink | faction wars | Supremacy plus a Commander respawn character | class loadouts |
| Survival (Infection) | green | Human vs Infected | a killed human turns infected; the last human wins | M-4, SMG-X3, MG-7, SR-100, TAC-87, no perks |
| The Swarm (*) | orange | Human vs Infected + a Hive Queen | infection where the Queen is the infected respawn point | class loadouts |

(*) = Callsign-Live unlock on the gun.

> **More than four teams.** The hardware supports four native teams, with on-gun friendly-fire protection (subject to the polarity caveat under *Health, armor and damage*) and a per-team LED colour. For more squads, run everyone as one team with friendly fire on. Hand out armbands, and let Mission Control keep the real teams and scores. There is no on-gun friendly-fire protection in that mode.

**Starting a gun-menu game:**

1. Power on (slide switch by the barrel). LEFT/RIGHT cycle the modes, and the trigger selects.
2. The D-pad picks your team or faction. The trigger cycles weapons or characters. ALT cycles perks.
3. The D-pad sets lives, time, respawn and volume. SELECT moves you on. Your settings stick as the new defaults.
4. Pull the reload handle to start. Headsets pair on their own after power-on (up to about 3 min with many taggers around).

**Gun-menu settings, every value:**

| Item | Value |
|---|---|
| Lives | a count, or unlimited |
| Game time | Off, 5, 10, 15, 20, 30 min |
| Respawn | Off, 15, 30, 60 s, Ramp 45, Ramp 90 |
| Volume | 1-5 |
| Indoor / outdoor | hold ALT 3 s (it sticks across power-cycles; indoor dims the green hit LEDs, turns on the RGB LEDs, and shrinks explosion/melee range; bright sun cuts hit radius about 50%) |
| Region | USA / International (the app's `GunLaserRegion` setting). This is a factory setting, so leave it alone |

The Callsign app's modes are the complete list found in the app, with what each one is built from. The app screens group them under categories (Team Arena, Battle Royale, Battle Lines, Faction Wars, Infection) and mode tiles (Arena, Team Arena, Team Snipers, Capture the Flag).

| Mode | Win rule | Props | Notes |
|---|---|---|---|
| Free For All | most kills (Slayer) | (none) | everyone vs everyone |
| Team Death Match | team kills / elimination | (none) | |
| Supremacy | score / control | (none) | 3 factions, class-based |
| Survival / Infection | last human | (none) | a kill turns a human |
| Last Man Standing | last alive | (none) | limited lives |
| Capture the Flag | captures | QR flags | a flag carrier's headset blinks; "scary music" plays on the carrier's tagger |
| Domination | most control-point time | QR / grenade control points | |
| Assault | objectives armed/held | QR / grenade objectives | attackers arm, defenders hold |
| Territory (King of the Hill) | time held | one zone | |
| Team Arena | kills + captures | QR weapon pickups + flags | TDM with pickups |
| Battle Royale | last standing | GPS weapon/supply drops, shrinking zone | no-team option, Low/Medium/Full starting health, show/hide players remaining |
| Generals (*) | eliminate the General / kills | (none) | premium unlock |
| Commanders (*) | seek-and-destroy the Commander | (none) | premium unlock |
| Swarm (*) | last human | (none) | premium unlock |

(*) = paid unlock via the app's currency/subscription.

> **The app's "boxes" are paper.** Respawn points, weapon pickups, capture and control points, and supply drops are all printed QR codes you scan or fire at. A weapon pickup simply pushes a new weapon into a slot on your gun. Pickup pool seen in the app: Auto Rifle, Burst Rifle, Sniper Rifle, Shotgun, SMG/SAW, Sticky, Rail Gun, Rocket Launcher, Energy Rifle, War Hammer, Strike Rifle (scoped/unscoped), and "other players".

**Callsign GAME SETTINGS, every field on the screen:**

| Item | Value |
|---|---|
| Primary weapon / Secondary weapon | pickers from the roster, and you can remove the secondary |
| Weapon respawn | 30 sec, 60 sec, 90 sec, 3 min |
| Weapon pick-up | Scan, Player, Both |
| Weapon selection | ON / OFF |
| Outdoor mode | ON / OFF |
| Voice | Male, Female (the whole announcer choice in the app) |
| Time | minutes (e.g. 1) |
| Score to win | a number (e.g. 25) |
| Respawn type | Scanner, Auto |
| Respawn time | seconds (e.g. 15) |
| Lives | a count, or Unlimited |
| Create-game step (Battle Royale / no-team modes) | Allow Teams / No Teams; Starting Health Low / Medium / Full; Players Remaining Show / Hide |
| App settings (gear) | one Sound slider, that's it |

## Classes, factions, perks and killstreaks

Supremacy swaps the weapon picker for characters. Each one has a fixed gun, a set health/armor/shield build, and an ALT-button ability. Three factions split the roster: Nexus (energy, shields, explode-on-death), Resistance (milsim, explosives) and Vanguard (exotic, long-range).

These are the 9 manual characters, the exact health builds Battle Company prints. There are two pool shapes here: armor characters and shield characters.

| Character | Role | Mag | Damage | Health | Armor | Shield | Ability (ALT) |
|---|---|---:|---:|---:|---:|---:|---|
| Soldier | Offense | 30 | 22 | 100 | 50 | - | secondary shotgun (M4 + shotgun swap) |
| Medic | Support | 30 | 21 | 100 | 40 | - | medi-gel heal pulse: heals allies when you shoot them |
| Heavy | Tank | 75 | 38 | 100 | 75 | - | rally: an attack boost for allies |
| Guardian | Support | 50 | 20-100 | 75 | - | 125 | charge-up plasma + shield regenerator |
| Marauder | Offense | 32 | 23 | 75 | - | 150 | adrenaline: a rate-of-fire boost |
| Sentinel | Tank | 100 | 25 | 75 | - | 175 | EMP blast: stuns a group |
| Viper | Offense | 16 | 25 | 125 | 25 | - | poison burst rifle + poison grenades |
| Technician | Support | 8 | 28 | 125 | 30 | - | incendiary rifle + medi-gel heal-over-time |
| Wraith | Tank | 32 | 25 | 125 | 50 | - | cryo rifle + frost grenades (slows enemy attack speed) |

Four more classes are described in the Extended Guide but are not in the V7 table:

- Grenadier: laser beam + sticky grenade
- Mercenary: silenced AR + healing/tracking dart
- Valkyrie: burst SMG + mini-rockets
- Sniper: armor-piercing bolt rifle, silencer on ALT

> **Status effects the app defines:** Standard, MedicHeal, ActivateShield, RallyPulse, Radiation (poison), Cryogenic (frost), ArmorPiercing, EMP, Shrapnel, StickyBomb, lethal and non-lethal explosive, ShottyPellets, MeleeDamage, Plasma. Each one has its own hit-sound slot in the app's sound table (poison hit, cold hit, EMP start/loop/end, incendiary start/loop/stop, and others).

Perks are what ALT cycles in Death Match / Generals. Not all games have perks, and TDM is the only stock mode with the perk row.

| Perk | Effect |
|---|---|
| Grenade Launcher | launcher alt-fire |
| Med Kit | self-heal |
| Body Armor | extra armor (on a General it lowers total health, a known stock quirk) |
| Extended Mags | bigger magazines |
| Concussion Grenade | stun grenade |
| Critical Strike (Extended Guide only) | crit chance |
| Foregrip (Extended Guide only) | less recoil drift |
| Focus (Extended Guide only) | laser designator |

Killstreak rewards in the Callsign app, from the app's config. None of them is a tagger command.

| Reward | Warns the enemy? |
|---|---|
| UAV | yes |
| Counter UAV | no |
| Power Weapon | no |
| Body Armor | no |
| Second Life | no |
| Care Package | no |
| System Hack | yes |
| Mortar Strike | yes |
| Weapons Crate | no |
| Mystery Box | no |
| MEDEVAC | no |
| Support Package | no |
| Air Strike | yes |
| Chopper | yes |
| Air Raid (bombing run) | yes |
| Nuke | yes |

### Post-game medals

21 medals, from the app's config:

- MVP: highest score on their team
- Top Gun: most kills
- Sharp Shooter: most accurate
- Trigger Happy: most shots fired
- Grave Lover: most deaths
- Highest K/D
- Survivalist: fewest deaths
- Top 3: top three score on your team
- The Assistant: most assists
- Objective King: most flags/boxes
- First Blood: first kill of the game
- Double Kill / Triple Kill / Killtacular: 2/3/4 kills, each within 4 s of the last
- Streaky: a 5-kill streak
- Streakerten: a 10-kill streak
- Streakernaut: highest streak in the game
- Ninja: 3 melee kills in one life
- Assassin: most melee kills
- Weapons Expert: 3 kills with 2+ weapons
- Head Shot: 5 kills by head shots only

## The Smart Grenade's game modes

The BRX Smart Grenade is more than a bomb. Hold its button and it turns into a portable objective: a respawn station, a King-of-the-Hill point, an assault objective, or a CTF flag base. It talks to every gun in range with an IR beacon, and the guns make the sounds. There is no app for this. You set the mode on the device itself, and it stays locked there.

| Colour | Mode | How it plays | Guns can read its state live? |
|---|---|---|---|
| Red | Frag | a blast grenade; throw it or press it to detonate (it needs pairing to your headset), and it wipes everyone within about 30 ft | no beacon |
| Green | Assault | shoot it to capture it to your team's colour; attackers arm, defenders hold | captures silently (LED only) |
| Blue | Hill (King of the Hill) | starts neutral (white); shoot it to capture and you hear "control point captured"; each shot adds charge, so the other team must fire at least as much back to retake it; a thrown-grenade blast on the point captures it 100% instantly; the holder gets a rate-of-fire boost | beacons owner every ~3-5 s |
| Yellow | Respawn | starts neutral; shoot it to claim it for a team; press the button to respawn everyone of that team nearby, or face it with the front of your headset and pull the trigger (~18-20 ft) | beacons owner every ~2.5 s |
| White | CTF | flag-base mode; shoot it to grab it, and the carrier's tagger plays the "scary" flag music | no passive beacon |

**Setting a mode (the finicky part, exactly):**

1. Turn the grenade off, then on, and wait for the green LED (that means ready).
2. Hold the top button for about 4 s: a long loud beep means you are in setup.
3. It beeps fast and cycles colour while you hold. (A tagger left in its own setup mode says each mode's name as you cycle, which is a free audio monitor.)
4. Let go on the colour you want. The LED turns white to confirm the lock.
5. The mode survives a power-cycle. On boot it flashes the current mode's colour for about 1 s so you can check it.

> **The Respawn-station catch that earns the grenade its "buggy" reputation.** Setting the grenade to Respawn is not enough. Each tagger must also receive the station's IR to switch from self-respawn to station-respawn. Either show every gun the station before the game, or press the grenade's button near each gun after the start (the reliable way). A gun that never got the signal just self-respawns as normal.

| You want | Grenade mode | Caveat |
|---|---|---|
| A respawn point per team | Yellow (Respawn) | arm every tagger; stations can be overtaken; not always consistent |
| King of the Hill / a checkpoint | Blue (Hill) | no winner display on the grenade, so someone has to keep score |
| Two hills or two respawn points | two grenades | each one is its own objective |
| A Counter-Strike bomb site | Blue (Hill) as the site | the plant/defuse timer runs on a host, not the grenade |

> **Where the grenade sounds come from.** The detonation, the flashbang and gas effects, the CTF music, "control point captured": all of it plays from the gun and headset, triggered by the grenade's IR. The grenade itself only chirps and flashes for status. Swap the tagger's sound files and every grenade "sounds" different, without touching the accessory.

## Beyond stock: modes Open BRX adds

The gun keeps no game state, so any rule you can write over hits, teams, health and spawns is a mode. Open BRX runs those rules on a laptop (Mission Control) and on a small node per player. So the same gear plays modes Battle Company never shipped, and modes that need props scale up through cheap tiers.

| Tier | What you add | Modes in the catalog |
|---|---|---|
| Tier 0: laptop-only with `brx-mcp` (taggers plus a laptop you own) | nothing | FFA, Team Death Match, Survival/Infection, The Swarm, Generals, Commander, Supremacy, Last Man Standing, Syphon (health on kill), Halo-style regenerating health, overshield / medic roles, small-scale Extraction, grenade-site Counter-Strike |
| Tier 1: plus props (objective stations, flags, QR codes, or the grenade) | contested places | Domination, King of the Hill / Territory, Capture the Flag (standard, one-sided, centre-flag), Assault, Team Arena, VIP escort, Hostage rescue, a real Extraction point |
| Tier 2: plus broadcast (a live field-wide downlink; location on each node) | live global awareness | Battle Royale, live scoreboards and "flag taken!" callouts on a big no-WiFi field, hidden multi-extracts |

Two Tier 0 entries carry a caveat. Syphon (health on kill) and small-scale Extraction exist only in the laptop's `brx-mcp` CLI path. Neither has run on hardware, and neither the phone node nor the node/MC bundle knows anything about them, so neither is playable in a real match yet.

Three modes stock BRX does not ship:

- **Extraction**: drop in, loot, then reach an extraction point and channel it. That takes 30 to 60 s and it is loud, so everyone comes running. Survive and you bank the loot. Die and you drop all of it. You can play it for $0 with the grenade as the beacon and phones as loot wallets. A rules engine exists, but only on the laptop CLI path, and it has not run on hardware.
- **Counter-Strike (plant / defuse)**: the grenade or a phone is the bomb. Attackers arm it (by dwell, IR, or an on-screen code) and defenders defuse it (by IR or a puzzle). The round ends on detonate, defuse or elimination.
- **Syphon and regenerating health**: the host credits the exact killer (every shot names its shooter) and tops up their pool. Or it refills anyone who has gone T seconds without taking damage. Both are host rules on top of the "heals add, never set" write. Syphon is written for the laptop CLI path and has never run on hardware, so today it is a design rather than a mode you can play.

> **Honest limits.** Phones have no IR, so shoot-the-point needs a station or the grenade. One phone can hold only a handful of gun links. A field without WiFi means live global state needs a radio tier.

## Control points: the grenade or a phone

A control point is a place on the field a team can own: a King of the Hill point, a Domination point, a bomb site. There are two ways to put one on your field and they are good at different things. The grenade is the cheapest way to have a control point at all, and it is the only one you can shoot. A phone is what you reach for when you want more than one point, or want the point to count people, or want it to keep scoring after you walk away.

A Smart Grenade in Hill mode is a complete control point on its own: no phone, no host, no app, and it works in native games. You shoot it to capture it, and nothing else replicates that. Capture is by charge, so any weapon can take a point and the attacker wins ties: on the bench one Assault Rifle round took a neutral point, and about four rounds' worth of charge took one an enemy team was holding. It beacons its owner to every gun in range every 5 seconds, it changes colour and beeps so everyone nearby knows what just happened, and it holds its owner with nobody standing there (ten straight beacons on one owner with no one shooting it).

A phone can be a control point too, and everything in the phone column below is designed and specified but **not built yet**. Read it as the plan, not as something you can play this weekend.

| | Smart Grenade, Hill mode | A phone as a control point |
|---|---|---|
| Status | works today, in native games too | designed, not built |
| How you capture it | shoot it. Charge accumulates, any weapon counts | stand on it |
| More than one point | no. A beacon carries no point id, so two grenades cannot be told apart on the wire | yes. Every point carries its own station id |
| Do more attackers capture faster | no. It counts the charge fired into it, not the people | yes. It counts living players present per team, and nets the leading team against the largest single rival team |
| Downed players | no idea they are there | ignored, so reviving on the point matters |
| Contested | not readable. A non-capturing hit emits nothing we can decode | a real state it can see and announce |
| Progress you can watch | the LED colour and a beep | a percentage on the air for other phones and stations, and an animated bar on its own screen, so a defender can see the point going |
| A point nobody is standing on | ownership travels only over IR and only a gun receives IR, so nobody learns that a far point flipped until a player walks into range. Reception is solid close in and intermittent by about 30 feet, with dropouts of 85 and 145 seconds measured at the edge | the phone sits on the point all match and keeps its own clock, so it keeps scoring for its owner with nobody there. That is what makes a Territories game possible |
| Points talking to each other | no | yes, with no network at all. The adverts are broadcast, so a respawn station can read a control point |
| Presence range | you aim a gun at it | a bubble of roughly 10 feet at the tuned default, with no direction at all |
| It fights back | yes. An enemy-held hill emits an ordinary damage word, so pushing onto a point you do not own costs you health | no |
| Security | a beacon is unauthenticated | an advert is unauthenticated too. Fine for friends on a private network, not a guarantee |

**The hill chips you, and that is measured.** An unattended enemy hill killed a player in about 106 seconds on the bench, 8 damage every 5 seconds, with no host involved. In a native game that is the mode working: it punishes standing on someone else's point. In an Open BRX game it is currently indistinguishable from being shot. A fix is under investigation (moving our own weapons off the IR protocol the hill uses, which would make the hill's damage land in a cell nothing is listening to) and it has not been tested.

**Do not put a player on team 2 in a hill game.** A neutral hill broadcasts team 2, which is measured. The gun's own filter compares that against the gun's team, so a player on team 2 should read every neutral point as already theirs and take no hill damage at all. Use teams 0, 1 and 3. The consequence follows from two measured facts but has not been tested directly.

A second hand Android phone is an inexpensive way to add an objective to your field, and unlike a grenade you can add several of them. What you give up is the shot: you cannot shoot a phone, you stand on it. For a single point that everybody fights over by aiming at it, the grenade is still the better prop.
