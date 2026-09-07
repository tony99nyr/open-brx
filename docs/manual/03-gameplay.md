# 03 · Gameplay  (section slug: /manual/gameplay)
**Last verified:** 2026-08-27
**Audience:** BRX owners and hosts who want to know what the system can *play*. That means every weapon, and how health and kills really work. It also means every native mode and its settings, the classes and perks the app models, the grenade's objective modes, and a taste of what Open BRX adds on top. · **Goal of this section:** be the one place that lists the whole Callsign arsenal with real numbers. It explains the damage model in player words. It lists every stock mode and setting, so nobody has to scroll a carousel or dig through PDFs again.
**Provenance legend:** ✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the Callsign APK · 👥 community-reported. Only confirmed facts are published. See the Research backlog at the end.

> **Credit:** protocol discovery by **LaserTagMods** (JEDGE/JBOX); on-gun mode/weapon facts restated from Battle Company's V7 Quick Manual and 2018 Extended User Guide; grenade mode basics from *Extreme Laser Tag And More!*; sound-bank prefix map shared by the owner community. Facts are restated, never copied.

## Pages

### Page: What the BRX can play  (`/manual/gameplay/overview`)
_Two arsenals, three ways to run a game, and one damage model underneath all of it_

[hero] The BRX runs games three ways. You can play **from the gun's own menu**, with no phone at all. That gives you 7 modes, 5–7 stock guns and 9 Supremacy characters. You can play **from the Callsign app** (14 mode families, a 19-weapon arsenal, QR pickups, perks and killstreaks). Or you can play **from a host of your own**. That is Open BRX: any rule you can write over hits, teams, health and spawns. All three push the same basics into the same firmware. The gun keeps no game state, so the "mode" is always whoever is talking to it. ✅🔍📖 `src: docs/game-modes.md, protocol/callsign-extract/protocol-classes.md (§What's moddable), docs/reference/brx-manual-notes.md`

[stat-row]
- **19** weapons in the Callsign app arsenal, from **20** captured frames (every one read off the wire) ✅
- **7** gun-menu modes with no phone at all (FFA · Death Match · Generals · Supremacy · Commander · Survival · The Swarm) 📖
- **14** mode families built into the Callsign app 🔍
- **115** = the default health pool (45 HP + 70 armor) ✅
- **4** native hardware teams (team id is 2 bits in every shot) ✅
- **5** Smart Grenade objective modes, set by a button and a colour ✅
`src: docs/reference/weapons.md, docs/reference/brx-extended-user-guide.md, protocol/callsign-extract/apk-harvest.md, docs/weapon-design.md §0, docs/game-modes.md §Team structure, docs/reference/grenade.md`

[cards]
- **The arsenal**: all 19 Callsign weapons (20 captured frames) with damage, cycle, clip, reserve, heat, reload and fire mode. → `/manual/gameplay/weapons`
- **Health, armor & damage**: what a hit takes off, what armor does, and why nothing heals on its own. → `/manual/gameplay/health`
- **How a kill actually works**: the 25-bit word of light, the three sensors that catch it, the green flash that confirms it. → `/manual/gameplay/how-a-kill-works`
- **Native modes & settings**: every gun-menu and Callsign mode, with the exact setting values. → `/manual/gameplay/modes`
- **Classes, factions, perks & killstreaks**: Nexus/Resistance/Vanguard, the 9+ characters, the perk row, the streak rewards. → `/manual/gameplay/classes-and-perks`
- **The grenade's game modes**: Frag · Assault · Hill · Respawn · CTF, and how each one really behaves. → `/manual/gameplay/grenade-modes`
- **Beyond stock, the Open BRX catalog**: Extraction, Counter-Strike, Syphon, and the infrastructure tiers. → `/manual/gameplay/open-brx-modes`
✅ `src: this section`

[callout:info] **Two arsenals, one gun.** The gun-menu weapons (M-4, SMG-X3, MG-7, SR-100, TAC-87 …) are presets the firmware carries for play without a phone. The Callsign app's 19 weapons get *sent* to the gun over Bluetooth when the game starts. They fill the same 6 weapon slots with different numbers. This section covers the Callsign 19 in full, because we captured every one of them on the wire (20 frames). The five gun-menu weapons are listed from the manual. 📖✅ `src: docs/reference/brx-manual-notes.md §Stock weapons, docs/reference/weapons.md, protocol/callsign-extract/protocol-classes.md §What's moddable`

---

### Page: The complete Callsign arsenal  (`/manual/gameplay/weapons`)
_Every weapon the official app can hand you (19 weapons, 20 captured frames), with the numbers it actually sends_

[callout:info] **How to read the numbers.** *Damage* is the raw number the weapon puts in every shot. It is what your target's gun takes off before any class multiplier. *Cycle* is milliseconds between shots. For charge weapons it is the charge time. *Reserve* is your total spare rounds. The app shows it as magazines (mags × clip = reserve). *Heat* is added per shot, and only on weapons that can overheat. *Hits to kill* is against the default 115-point pool (45 HP + 70 armor). We give it only for weapons whose shots land as standard damage on the target's effect table. ✅ `src: docs/reference/weapons.md (column notes), docs/weapon-design.md §0–§1.2`

[data-table:filterable] **The Callsign 19**: filter by class, fire mode, overheats or one-shot. Sort by any column.

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

✅ (damage, cycle, clip, reserve, heat, fire mode, sound: captured frames + bench; range: the wire carries one range value for all 18 guns, see the note below; hits to kill: only where the weapon's damage type resolves as standard damage on the captured effect table) · 📖🔍 (reload s, mags: the app's weapon-select screen) `src: docs/reference/weapons.md, docs/weapon-design.md §1.2 + §4.1 + §4.2, docs/reference/callsign-ui.md §Weapon roster, mcp/brx_mcp/mc/weapons.json (role), protocol/brx-protocol.md §"$WEAP t20 - FIRE MODE"`

[callout:warn] **Range is not what the app's bar shows.** The app draws a different Range bar for each weapon. But the range field in the frames it sends reads the same value (75) on all 18 guns. Melee reads 20. A separate "extra headset range" value of 30 shows up on the Rocket, Shotgun and Plasma Sniper. ✅ `src: docs/weapon-design.md §4.2`

[callout:tip] **Stock Callsign hits soft and fast.** The standard-damage automatics deal 8–15 per hit every 75–120 ms. They need 8–15 hits, which is about a second of landed fire. The Rocket Launcher, Rail Gun, Laser Cannon and Ion Sniper deal 115. That drops a full-health player in one shot. The two snipers deal 80 every 225–300 ms and kill in two hits, in 0.23–0.30 s. ✅ `src: docs/weapon-design.md §1.2 "SHIPPED"`

[accordion] **Per-weapon cards**

- **Assault Rifle**: Assault · full auto · 9 dmg · 100 ms · 32/384 · reload 1.4 s. This is the baseline gun. It takes 13 hits to kill, and 1.2 s if every shot lands. (The gun-menu M-4 is printed at 24 damage in the manual. The app's Assault Rifle sends 9.) ✅📖 `src: docs/reference/weapons.md, docs/weapon-design.md §1.2`
- **Burst Rifle**: Assault · 3 rounds per trigger pull, 75 ms inside the burst, 275 ms between bursts · 9 dmg · 36/216 · reload 1.7 s. One of only two weapons with native burst timing. ✅ `src: docs/reference/weapons.md §What the operator's descriptions pinned down`
- **Force Rifle**: Assault · 3-round burst (100 ms / 250 ms between) · 9 dmg · 36/144 · 1.7 s. You reload it with a "pull back, let go" motion on the handle. ✅ `src: docs/reference/weapons.md`
- **Bolt Rifle**: Assault · single shot · 13 dmg · 225 ms · 18/180 · 2.0 s. The rifle with the biggest damage number. ✅ `src: docs/reference/weapons.md`
- **SMG**: CQB · full auto · 8 dmg · 90 ms · 72/288 · 2.5 s · **heat 5/shot**. Big clip, long reload. It empties a health pool faster than any other automatic, in 15 hits. ✅ `src: docs/reference/weapons.md`
- **Shotgun**: CQB · single shot · 45 dmg · 900 ms · 6/24 · **shell-by-shell reload at 0.4 s per shell**. Three hits to kill. It is the only weapon with the "Shells" reload type. ✅ `src: docs/weapon-design.md §1.1 + §4.3`
- **Stinger**: CQB · full auto · 15 dmg · 120 ms · 18/72 · 1.7 s. The hardest-hitting automatic: 8 hits, and 0.84 s to kill. ✅ `src: docs/weapon-design.md §1.2`
- **Sniper Rifle**: Marksman · bolt-action single shot · 80 dmg · 300 ms · 4/24 · 1.7 s. Two hits to kill. ✅ `src: docs/weapon-design.md §1.2 + §6.2, protocol/session-findings-2026-08.md §7r addendum`
- **Plasma Sniper**: Marksman · single shot · 80 dmg · 225 ms · 10/80 · 2.0 s · **heat 30/shot**. Spam it and it overheats. Fastest time-to-kill in the arsenal at 0.23 s. ✅ `src: docs/reference/weapons.md`
- **AMR**: Support · single shot only · 18 dmg · 360 ms · 14/56 · 1.4 s. A slow, deliberate pace. ✅ `src: docs/reference/weapons.md`
- **Suppressor**: Support · full auto · 8 dmg · 75 ms · 48/288 · 2.0 s. **Quiet (not silent) and no muzzle flash.** It is the only weapon with the stealth fields set. ✅ `src: docs/reference/weapons.md`
- **Energy Rifle**: Support · full auto · 9 dmg · 90 ms · **300-round clip**, 600 reserve · 2.4 s · heat 6/shot. You can fire a long time without reloading. Heat is what stops you. ✅ `src: docs/reference/weapons.md`
- **Charge Rifle**: Support · **hold to charge, fires when you let go** · 100 dmg · 1.25 s charge · 100/200 · 2.5 s · heat 14/shot. Two hits to kill. It is the one weapon with both a charge-up sound and a release sound. ✅ `src: docs/reference/weapons.md`
- **Rocket Launcher**: Power · single shot · 115 dmg (explosive damage type) · 1.0 s · 2/8 · 1.2 s. A one-shot kill. ✅ `src: docs/weapon-design.md §4.3`
- **Rail Gun**: Power · **charges and fires itself after ~1 s**, and a tap fires too · 115 dmg (armor-piercing type) · 1/6 · 2.4 s. A one-shot kill. It has no release sound, because it fires itself. ✅ `src: docs/reference/weapons.md`
- **Laser Cannon**: Power · **you must hold it to charge, and a tap does nothing** · 115 dmg · 1.5 s charge · 4/8 · 2.0 s. A one-shot kill. ✅ `src: docs/reference/weapons.md`
- **Energy Launcher**: Power · single shot from a 1-round clip · 115 magnitude · 360 ms · 1/6 · 1.4 s. Six spare rounds. ✅ `src: docs/reference/weapons.md`
- **Ion Sniper**: Power · single shot, alien-sounding · 115 dmg · 1.0 s · 2/12 · 2.0 s. A one-shot kill, with the most reserve in the power tier. ✅ `src: docs/reference/weapons.md`
- **Melee**: Melee · **gyro swing** with the butt of the gun · 90 dmg · 1.0 s · no ammo · no reload. Two swings kill. The hit comes from the front headset emitter. ✅📖 `src: docs/reference/weapons.md, docs/reference/brx-extended-user-guide.md §Modes/handling`

[table] **Fire-mode vocabulary**: the firmware's seven behaviours, all confirmed on the trigger. Every Callsign weapon uses one of them.

| Fire mode | What the trigger does | Callsign weapons |
|---|---|---|
| Full auto | hold it down to keep firing at the cycle rate | Assault Rifle, SMG, Suppressor, Energy Rifle, Stinger, Energy Launcher |
| Single shot / bolt | one round per pull | AMR, Bolt Rifle, Sniper, Plasma Sniper, Ion Sniper, Rocket Launcher, Shotgun |
| 3-round burst | one pull sends three rounds, then a burst gap | Burst Rifle, Force Rifle |
| Charge, auto-release | starts charging on the pull, then fires by itself (~1 s); a tap also fires | Rail Gun |
| Hold-to-charge | you must hold it through the whole charge; a tap is sound only | Laser Cannon |
| Charge, fire on release | charge while you hold, fire when you let go | Charge Rifle |
| Melee | a swing the gyro picks up | Melee |
✅ `src: protocol/brx-protocol.md §"$WEAP t20 - FIRE MODE", docs/weapon-design.md §4.1`

[callout:info] **The app's own weapon categories** (a UI grouping, not a wire field): Rifle · SMG · Sniper · Shotgun · Heavy · Energy · Support · Power · Exotic · Launcher · Stun, plus Ability and Melee. Nothing the gun receives says which category a weapon is in. So the table above uses Open BRX's role grouping instead. 🔍 `src: protocol/callsign-extract/config-facts.md`

[callout:tip] **No stock weapon has an alt-fire.** The secondary-fire fields are empty on all 20 captured frames. The orange ALT button cycles perks and abilities in the modes that have them. Every weapon is also just *data*. A host can send its own weapon into any of the gun's 6 slots: damage, rate, clip, reload, burst, overheat and sounds. That is exactly what Open BRX does. ✅🔍 `src: docs/reference/weapons.md (tokens 7–11), protocol/callsign-extract/protocol-classes.md §What's moddable`

[table] **The gun-menu weapons (phoneless play)**: the manual's stock presets, exactly as printed. The damage scale here is not the Callsign scale above. The manual's M-4 says 24; the app's Assault Rifle sends 9.

| Weapon | Damage | Rate of fire | Accuracy | Mag | Character |
|---|---:|---:|---|---:|---|
| M-4 | 24 | 545 | 96–91 | 30 | full auto, low damage, medium mag |
| SMG-X3 | 25 | 545 | 96–88 | 26 | 3-round burst |
| MG-7 | 38 | 342 | 66–45 | 75 | suppressing auto, low accuracy, overheats/jams on sustained fire |
| SR-100 | 140 | 44 | 100–90 | 4 | bolt, high damage, small mag |
| TAC-87 | 120–40 | 150 | 95–80 | 8 | semi shotgun; hold reload to load shells; full damage only at melee range |
Also described in the Extended Guide: **TAR-33** (semi-auto, medium) and a **Silenced AR**. The two accuracy numbers are the manual's simulated-recoil model. Fire fast and your accuracy drifts toward the lower number. A miss still reaches the enemy: their headset lights up and they hear a zip, but they take 0 damage. Fire in bursts. 📖 `src: docs/reference/brx-manual-notes.md §Stock weapons, docs/reference/brx-extended-user-guide.md §Weapons`

[image GAME-02] Weapon-class icon set (one per class present in the roster). `src: this section`

---

### Page: Health, armor & damage  (`/manual/gameplay/health`)
_What a hit takes away, what armor does, and why nothing comes back on its own_

[hero] Every player is a pool of points: **45 health and 70 armor by default, which is 115 in total**. A hit comes off your armor first. Whatever armor cannot soak up spills straight into your health. When your health hits zero you are out. Nothing in the stock firmware fills you back up until you respawn. ✅ `src: docs/weapon-design.md §0, protocol/session-findings-2026-08.md §7r addendum`

[diagram GAME-09] The three pools (shield → armor → health) draining under fire, with an 80-point standard hit splitting 70 into armor and 10 into health. `src: protocol/session-findings-2026-08.md §7r addendum`

[steps] **What happens when you get hit**
1. The shot's damage number lands on your gun. The IR word carries it (see *How a kill works*).
2. Your gun looks up the shot's damage type in its effect table. Most shots are "standard damage". Class abilities can be heals, shield grants or multipliers instead.
3. **Armor soaks damage 1 for 1, with no cap per hit.** An 80-point standard hit takes all 70 armor and 10 health at once.
4. Health takes the rest. Your headset and gun play the hit tone. The gun reports your new pool to any connected phone.
5. At 0 health the gun plays the death alarm, stops firing, and ignores every incoming shot until it respawns.
✅ `src: protocol/session-findings-2026-08.md §7r, §7r addendum, docs/weapon-design.md §6.1, docs/reference/grenade.md §Can we add new modes (dead gun accepts no IR)`

[table] **Health facts, in player terms**

| Question | Answer | Confidence |
|---|---|---|
| Default pool? | 45 HP + 70 armor = 115. Modes like Battle Royale offer Low / Medium / Full starting health. | ✅ 📖 |
| Does armor reduce damage? | No. It *is* extra hit points, and they drain first. Armor never makes a hit weaker. | ✅ |
| Do I heal over time? | **No.** On the bench we set the pools to 99/99 and shot armor down to 18. It sat there through 18 s, then another 12 s, with nothing happening. Any healing you see comes from a class ability, a medic, or a host that refills you. | ✅ |
| What is a shield? | A third pool that sits above armor. Nexus-style classes use it (Guardian 125, Marauder 150, Sentinel 175). It only fills from an IR "activate shield" event. A phone cannot just set it. | ✅ 📖 |
| Can a medic heal me? | Yes. The Supremacy Medic's medi-gel pulse is a heal *shot*, and the community confirms it heals by shooting teammates. A host can also grant health directly. | 📖 👥 ✅ |
| Do heals overfill? | No. A heal adds to your pool and stops at the maximum. | ✅ |
| Head shots? | The headset has four sensor domes, one of them at the back, and the gun body has a sensor of its own. Every shot carries a crit flag, but no stock weapon sets it. A crit multiplies damage by `1 + $GSET t7/100`. That is a per-game setting: ×1.5 at the shipped t7=50, and t7=0 turns crits off. | ✅ |
| Can friendly fire hurt me? | Only if the game turns it on. With friendly fire off, the gun itself blocks same-team damage (and blocks enemy "heals"). FFA is one team with friendly fire on. | ✅ 📖 |
`src: docs/weapon-design.md §0 + §6.1, docs/experiment-log.md #33 ("NO native regen"), docs/experiment-log.md 2026-08-27 (crit = magnitude × (1 + $GSET t7/100), exact at seven levels), docs/reference/brx-manual-notes.md §Supremacy characters, docs/game-modes.md §Health/regen variants + §Team structure, protocol/brx-ir-protocol.md (crit bit), protocol/session-findings-2026-08.md §7r (sensor map)`

[callout:info] **Heals and boosts "add", they never "set".** When a phone or host gives health to a live gun, the amount is *added* to your current pool and stops at the maximum. Nobody can set you to a lower number this way, and a grant to a full-health player does nothing. That is why Halo-style regenerating shields, health-on-kill and medic roles all work the same way. A host watches your pool and tops it up. ✅ `src: docs/experiment-log.md #33 "SEMANTICS + REGEN nailed", docs/game-modes.md §Health/regen variants`

[callout:warn] **A dead gun is deaf, unless a station armed it.** At 0 health a tagger that was never armed to a respawn station takes no IR at all, and a tagger in a host-driven game takes none either. A tagger armed by a station in a native game is the exception: it stays dead, refuses the trigger, says "revive at respawn point", and comes back the moment the station beacon reaches it. ✅ `src: docs/experiment-log.md 2026-09-04 (respawn station), docs/reference/grenade.md §Respawn Station mode, protocol/session-findings-2026-08.md §7r (Resync)`

[table] **Respawn & lives: the knobs every mode shares**

| Setting | Gun-menu values (V7 manual / Extended Guide) | Callsign app values |
|---|---|---|
| Lives | a count, or unlimited | a number, or **Unlimited** |
| Respawn time | Off · 15 · 30 · 60 s · **Ramp 45** · **Ramp 90** (the penalty grows with each death 👥) | a number in seconds (e.g. 15) |
| Respawn type | self-respawn on the gun, or at a **respawn station** (grenade) once armed | **Scanner** (respawn at a QR / station) · **Auto** (timed) |
| Game time | Off · 5 · 10 · 15 · 20 · 30 min | a number in minutes |
📖🔍👥 `src: docs/reference/brx-manual-notes.md §Game modes, docs/reference/brx-extended-user-guide.md ($GSET stream), docs/reference/callsign-ui.md §GAME SETTINGS, docs/reference/community-notes.md §Game-mode design ideas (ramps)`

[quote] "Taking damage while in the respawn state is disliked" is a balance note that comes up again and again in the owner community. The gun menu's Ramp 45 and Ramp 90 respawn options grow the wait with each death. 👥📖 `src: docs/reference/community-notes.md §Balance notes, docs/reference/brx-manual-notes.md §Game modes`

---

### Page: How a kill actually works  (`/manual/gameplay/how-a-kill-works`)
_From trigger pull to green flash in five steps (the developer section has the bit layout)_

[hero] A BRX "bullet" is a burst of infrared light 25 bits long, sent on a 38 kHz carrier. It carries **who fired (player id), which team, how much damage, and what kind of damage**. Your target's headset or gun catches it, looks it up, and takes off the damage. If that was the last of their health, your sight flashes green. ✅ `src: protocol/brx-ir-protocol.md, protocol/session-findings-2026-08.md §7o, §7r`

[diagram GAME-10] The kill pipeline: gun → 25-bit IR word → the receivers on the victim → pool subtraction → death → kill-confirm flash back on the shooter. `src: protocol/brx-ir-protocol.md, protocol/session-findings-2026-08.md §7r`

[steps] **The five steps**
1. **Fire.** The trigger pull sends the IR word: a 2 ms start pulse, then 25 bits (a long pulse is 1, a short one is 0). Damage type (4 bits) · player id (6 bits, 0–63) · team (2 bits, 4 teams) · damage (8 bits, up to 255) · crit flag · effect subtype · 2 check bits.
2. **Catch.** Your target has five receivers: **four domes on the headset**, one of them at the back, and a sensor on the **gun body**. Whichever one catches the word reports it, and the wire tells front from back from gun. Across the field that tells you where the shot came from. At point-blank range the IR floods every sensor, and the first one to see it wins.
3. **Resolve.** The target's gun checks the team bits first. Same team with friendly fire off means the shot is dropped. Then it looks up the damage type in its effect table and applies the damage: armor first, then health.
4. **Feedback.** The target's headset flashes green once on a hit, and blinks green steadily while they are out and plays the pain or death sound. The gun reports the hit and the new health to any connected phone. Melee, explosive and other damage types each get their own hit sound.
5. **Confirm.** On a kill the *shooter's* sight flashes green and the announcer says "kill". In a phoneless gun-menu game, the guns sort this out between themselves over their short-range radio. In an app-hosted game the phone scores the kill and drives the same flash and voice line.
✅ `src: protocol/brx-ir-protocol.md §Frame + §Field layout, protocol/session-findings-2026-08.md §7r (sensor map, FF), protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7o (native multikills), docs/experiment-log.md ("headset LED map" 2026-08-27 entries), protocol/callsign-extract/protocol-classes.md §FSET`

[callout:tip] **Why misses still make noise.** The manual's "simulated recoil" accuracy model means a rapid-fire miss still reaches the enemy. Their headset lights and they hear a zip, but 0 damage is applied. If someone's headset keeps flashing and they are not dying, you are missing. Fire in bursts. 📖 `src: docs/reference/brx-extended-user-guide.md §Weapons`

[table] **Feedback you will see and hear**

| Event | Victim | Shooter |
|---|---|---|
| Hit (non-lethal) | one green headset flash · hit tone (HP / armor / shield / crit each have their own) · gun LEDs | nothing (no radio path for a plain hit) |
| Kill | headset sustained green blink (the out state) · death alarm · gun stops firing | **green sight flash** + "kill" callout; in gun-menu games also "double kill" and other streak lines |
| Same team, FF off | nothing (the gun drops the shot) | nothing |
| Miss (accuracy roll) | headset lights + zip, 0 damage | – |
✅👥 `src: protocol/session-findings-2026-08.md §7o, protocol/brx-protocol.md §5, docs/experiment-log.md (LED map entries 2026-08-27), docs/reference/brx-extended-user-guide.md`

[callout:info] **Every shot names its shooter.** The 6-bit player id in the word is why a host can credit the *exact* killer, run free-for-all scoring, and build health-on-kill. All of it comes from what the target's gun reports. Stock BRX uses it too: that is how the kill-confirm and streak callouts find the right gun. For the full bit layout, the timings and the effect-table mechanism: → *Developer / IR protocol*. ✅ `src: protocol/brx-ir-protocol.md §Why this matters, docs/game-modes.md (P2 closed note)`

[image GAME-11] REAL PHOTO: a headset lit green mid-hit next to a tagger sight showing the kill-confirm flash. `src: this section`

---

### Page: Native game modes & their settings  (`/manual/gameplay/modes`)
_Everything the gun's own menu and the Callsign app will run, with the exact option values_

[hero] The gun's menu gives you seven modes with no phone at all. The Callsign app adds objective play (flags, control points, QR pickups, Battle Royale) plus premium unlocks. Under both, the tagger only fires, gets hit, tracks health and reports. The rules live in the gun menu's firmware presets or in the app. 📖🔍 `src: docs/reference/brx-extended-user-guide.md §Game modes, protocol/callsign-extract/apk-harvest.md §Game modes`

[table] **Gun-menu modes (no phone)**: the mode LED colour shows what you picked. Modes marked ★ are Callsign-Live unlocks on the gun.

| Mode | LED | Teams | How it plays | Weapons / perks |
|---|---|---|---|---|
| **Free For All** | white | none (everyone is one team with friendly fire **on**) | most kills wins | M-4, SMG-X3, MG-7, SR-100 · no perks |
| **Death Match / Team Death Match** ★ | red | Alpha vs Bravo | team kills | M-4, SMG-X3, MG-7, SR-100, TAC-87 · **the only stock mode with the perk row** |
| **Generals** ★ | yellow | two teams, each with a **General** | the General is your team's mobile respawn point, so pull the trigger at them to revive; it can be lives-limited for seek-and-destroy | TDM loadouts + perks |
| **Supremacy** ★ | blue | 3 factions: Resistance (red) · Vanguard (green) · Nexus (blue) | class-based; 9 characters are the loadout | no weapon picker, because the character *is* the loadout; abilities on ALT |
| **Commander** ★ | pink | faction wars | Supremacy plus a Commander respawn character | class loadouts |
| **Survival (Infection)** | green | Human vs Infected | a killed human turns infected; the last human wins | M-4, SMG-X3, MG-7, SR-100, TAC-87 · no perks |
| **The Swarm** ★ | orange | Human vs Infected + a **Hive Queen** | infection where the Queen is the infected respawn point | class loadouts |
📖 `src: docs/reference/brx-extended-user-guide.md §Game modes, docs/reference/brx-manual-notes.md §Game modes + §Per-mode weapons & perks`

[steps] **Starting a gun-menu game**
1. Power on (slide switch by the barrel). LEFT/RIGHT cycle the modes, and the **trigger selects**.
2. The D-pad picks your team or faction. The trigger cycles weapons or characters. **ALT cycles perks.**
3. The D-pad sets lives, time, respawn and volume. SELECT moves you on. Your settings stick as the new defaults.
4. **Pull the reload handle to start.** Headsets pair on their own after power-on (up to ~3 min with many taggers around).
📖 `src: docs/reference/brx-manual-notes.md §On-gun game flow + §Headset`

[spec-sheet] **Gun-menu settings: every value**
- **Lives:** a count, or unlimited
- **Game time:** Off · 5 · 10 · 15 · 20 · 30 min
- **Respawn:** Off · 15 · 30 · 60 s · Ramp 45 · Ramp 90
- **Volume:** 1–5
- **Indoor / outdoor:** hold ALT 3 s (it sticks across power-cycles; indoor dims the green hit LEDs, turns on the RGB LEDs, and shrinks explosion/melee range; bright sun cuts hit radius ~50 %)
- **Region:** USA / International (the app's `GunLaserRegion` setting). This is a factory setting, so leave it alone
📖🔍 `src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, protocol/callsign-extract/apk-harvest.md §Region`

[table] **Callsign app modes**: the complete list found in the app, with what each one is built from. The app screens group them under categories (Team Arena · Battle Royale · Battle Lines · Faction Wars · Infection) and mode tiles (Arena · Team Arena · Team Snipers · Capture the Flag).

| Mode | Win rule | Props | Notes |
|---|---|---|---|
| Free For All | most kills (Slayer) | – | everyone vs everyone |
| Team Death Match | team kills / elimination | – | |
| Supremacy | score / control | – | 3 factions, class-based |
| Survival / Infection | last human | – | a kill turns a human |
| Last Man Standing | last alive | – | limited lives |
| Capture the Flag | captures | **QR flags** | a flag carrier's headset blinks; "scary music" plays on the carrier's tagger |
| Domination | most control-point time | **QR / grenade control points** | |
| Assault | objectives armed/held | QR / grenade objectives | attackers arm, defenders hold |
| Territory (King of the Hill) | time held | one zone | |
| Team Arena | kills + captures | **QR weapon pickups + flags** | TDM with pickups |
| Battle Royale | last standing | **GPS** weapon/supply drops, shrinking zone | no-team option, Low/Medium/Full starting health, show/hide players remaining |
| Generals ★ | eliminate the General / kills | – | premium unlock |
| Commanders ★ | seek-and-destroy the Commander | – | premium unlock |
| Swarm ★ | last human | – | premium unlock |
🔍📖 (★ = paid unlock via the app's currency/subscription) `src: protocol/callsign-extract/apk-harvest.md §Game modes + §Win conditions + §QR-code stations + §Monetization, docs/reference/callsign-ui.md §Game categories + §Game modes, docs/reference/community-notes.md §Grenade notes (CTF music), docs/game-modes.md §Catalog`

[callout:info] **The app's "boxes" are paper.** Respawn points, weapon pickups, capture and control points, and supply drops are all printed **QR codes** you scan or fire at. They are the no-hardware answer to LaserTagMods' JBOX utility box. A weapon pickup simply pushes a new weapon into a slot on your gun. Pickup pool seen in the app: Auto Rifle, Burst Rifle, Sniper Rifle, Shotgun, SMG/SAW, Sticky, Rail Gun, Rocket Launcher, Energy Rifle, War Hammer, Strike Rifle (scoped/unscoped), and "other players". 🔍 `src: protocol/callsign-extract/apk-harvest.md §QR-code stations + §Weapon spawns`

[spec-sheet] **Callsign GAME SETTINGS: every field on the screen**
- **Primary weapon / Secondary weapon**: pickers from the roster, and you can remove the secondary
- **Weapon respawn:** 30 sec · 60 sec · 90 sec · 3 min
- **Weapon pick-up:** Scan · Player · Both
- **Weapon selection:** ON / OFF
- **Outdoor mode:** ON / OFF
- **Voice:** Male · Female (that is the whole announcer choice in the app)
- **Time:** minutes (e.g. 1)
- **Score to win:** a number (e.g. 25)
- **Respawn type:** Scanner · Auto
- **Respawn time:** seconds (e.g. 15)
- **Lives:** a count, or Unlimited
- **Create-game step (Battle Royale / no-team modes):** Allow Teams · No Teams; Starting Health Low · Medium · Full; Players Remaining Show · Hide
- **App settings (gear):** one Sound slider. That's it.
📖🔍 `src: docs/reference/callsign-ui.md §GAME SETTINGS + §CREATE GAME + §App settings`

[image GAME-08] Mode icon set: FFA, TDM, Generals, Supremacy, Survival/Infection, Swarm, CTF, Domination, KotH, Battle Royale, Extraction. `src: this section`

---

### Page: Classes, factions, perks & killstreaks  (`/manual/gameplay/classes-and-perks`)
_What Supremacy's characters are made of, what the ALT button cycles, and what the app hands out for streaks_

[hero] Supremacy swaps the weapon picker for **characters**. Each one has a fixed gun, a set health/armor/shield build, and an ALT-button ability. Three factions split the roster: **Nexus** (energy, shields, explode-on-death), **Resistance** (milsim, explosives) and **Vanguard** (exotic, long-range). 📖 `src: docs/reference/brx-manual-notes.md §Supremacy characters, docs/reference/brx-extended-user-guide.md §Character classes`

[table] **The 9 manual characters**: the exact health builds Battle Company prints. There are two pool shapes here: armor characters and shield characters.

| Character | Role | Mag | Damage | Health | Armor | Shield | Ability (ALT) |
|---|---|---:|---:|---:|---:|---:|---|
| Soldier | Offense | 30 | 22 | 100 | 50 | – | secondary shotgun (M4 + shotgun swap) |
| Medic | Support | 30 | 21 | 100 | 40 | – | **medi-gel heal pulse**: heals allies when you shoot them |
| Heavy | Tank | 75 | 38 | 100 | 75 | – | rally: an attack boost for allies |
| Guardian | Support | 50 | 20–100 | 75 | – | 125 | charge-up plasma + **shield regenerator** |
| Marauder | Offense | 32 | 23 | 75 | – | 150 | adrenaline: a rate-of-fire boost |
| Sentinel | Tank | 100 | 25 | 75 | – | 175 | **EMP blast**: stuns a group |
| Viper | Offense | 16 | 25 | 125 | 25 | – | poison burst rifle + poison grenades |
| Technician | Support | 8 | 28 | 125 | 30 | – | incendiary rifle + medi-gel heal-over-time |
| Wraith | Tank | 32 | 25 | 125 | 50 | – | cryo rifle + frost grenades (slows enemy attack speed) |
📖 `src: docs/reference/brx-manual-notes.md §Supremacy character ABILITIES + §Supremacy characters (V7 manual p.6)`

[cards] **Four more classes described in the Extended Guide** (not in the V7 table)
- **Grenadier**: laser beam + sticky grenade 📖
- **Mercenary**: silenced AR + healing/tracking dart 📖
- **Valkyrie**: burst SMG + mini-rockets 📖
- **Sniper**: armor-piercing bolt rifle, silencer on ALT 📖
`src: docs/reference/brx-extended-user-guide.md §Character classes`

[callout:info] **Status effects the app defines.** Here is the app's damage and ability list: Standard · MedicHeal · ActivateShield · RallyPulse · Radiation (poison) · Cryogenic (frost) · ArmorPiercing · EMP · Shrapnel · StickyBomb · lethal and non-lethal explosive · ShottyPellets · MeleeDamage · Plasma. Each one has its own hit-sound slot in the app's sound table (poison hit, cold hit, EMP start/loop/end, incendiary start/loop/stop …). 🔍 `src: protocol/callsign-extract/protocol-classes.md §Enums + §FSET`

[table] **Perks: what ALT cycles in Death Match / Generals** ("not all games have perks", and TDM is the only stock mode with the perk row)

| Perk | Effect | Source |
|---|---|---|
| Grenade Launcher | launcher alt-fire | V7 manual + Extended Guide 📖 |
| Med Kit | self-heal | V7 + EUG 📖 |
| Body Armor | extra armor | V7 + EUG 📖 · 👥 on a General it *lowers* total health (a known stock quirk) |
| Extended Mags | bigger magazines | V7 + EUG 📖 |
| Concussion Grenade | stun grenade | V7 + EUG 📖 |
| Critical Strike | crit chance | EUG only 📖 |
| Foregrip | less recoil drift | EUG only 📖 |
| Focus | laser designator | EUG only 📖 |
`src: docs/reference/brx-manual-notes.md §Per-mode weapons & perks, docs/reference/brx-extended-user-guide.md §Perks, docs/reference/community-notes.md §Balance notes`

[table] **Killstreak rewards in the Callsign app**: 🔍 the list in the app's config. None of them is a tagger command.

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
🔍 `src: protocol/callsign-extract/config-facts.md`

[accordion] **Post-game medals (21, from the app's config)** 🔍
- **MVP**: highest score on their team · **Top Gun**: most kills · **Sharp Shooter**: most accurate · **Trigger Happy**: most shots fired · **Grave Lover**: most deaths · **Highest K/D** · **Survivalist**: fewest deaths · **Top 3**: top three score on your team · **The Assistant**: most assists · **Objective King**: most flags/boxes
- **First Blood**: first kill of the game · **Double Kill / Triple Kill / Killtacular**: 2/3/4 kills, each within 4 s of the last · **Streaky**: a 5-kill streak · **Streakerten**: a 10-kill streak · **Streakernaut**: highest streak in the game
- **Ninja**: 3 melee kills in one life · **Assassin**: most melee kills · **Weapons Expert**: 3 kills with 2+ weapons · **Head Shot**: 5 kills by head shots only
`src: mcp/brx_mcp/data/medals.json`

[callout:info] **Where each fact on this page comes from.** ✅ On the bench: the character health/armor/shield shapes are real pools the gun tracks; medic heal and shield grant exist as IR effect functions; the gun announces "double kill" by itself in gun-menu games. 📖 From the manuals: the character table, the abilities, the factions and the perk list. 🔍 From the app's config: the 16 streak rewards and the 21 medals. `src: docs/experiment-log.md (#33, killstreak/multikill entries), docs/sound-architecture.md §Native multikills`

---

### Page: The Smart Grenade's game modes  (`/manual/gameplay/grenade-modes`)
_Five objective modes, one button, one colour, and which ones the guns can actually "see"_

[hero] The BRX Smart Grenade is more than a bomb. Hold its button and it turns into a **portable objective**: a respawn station, a King-of-the-Hill point, an assault objective, or a CTF flag base. It talks to every gun in range with an IR beacon, and the guns make the sounds. There is no app for this. You set the mode on the device itself, and it stays locked there. ✅👥 `src: docs/reference/grenade.md`

[table] **The five modes, by LED colour**

| Colour | Mode | How it plays | Guns can read its state live? |
|---|---|---|---|
| **Red** | **Frag** | a blast grenade; throw it or press it to detonate (it needs pairing to your headset), and it wipes everyone within ~30 ft | ❌ no beacon |
| **Green** | **Assault** | shoot it to capture it to your team's colour; attackers arm, defenders hold | ❌ captures silently (LED only) |
| **Blue** | **Hill (King of the Hill)** | starts neutral (white); shoot it to capture and you hear "control point captured"; each shot adds charge, so the other team must fire at least as much back to retake it; a thrown-grenade blast on the point captures it 100 % instantly; the holder gets a **rate-of-fire boost** | ✅ beacons owner every ~3–5 s |
| **Yellow** | **Respawn** | starts neutral; shoot it to claim it for a team; press the button to respawn everyone of that team nearby, or **face it with the front of your headset and pull the trigger** (~18–20 ft) | ✅ beacons owner every ~2.5 s |
| **White** | **CTF** | flag-base mode; shoot it to grab it, and the carrier's tagger plays the "scary" flag music | ❌ no passive beacon |
✅👥 `src: docs/reference/grenade.md §Exact setup procedure + §Respawn Station + §King of the Hill + §Assault, docs/reference/community-notes.md §Grenade notes`

[steps] **Setting a mode (the finicky part, exactly)**
1. Turn the grenade **off, then on**, and wait for the **green** LED (that means ready).
2. **Hold the top button ~4 s** → a long loud beep means you are in setup.
3. It beeps fast and **cycles colour** while you hold. (A tagger left in its own setup mode *says each mode's name* as you cycle, which is a free audio monitor.)
4. **Let go on the colour you want.** The LED turns **white** to confirm the lock.
5. The mode **survives a power-cycle**. On boot it flashes the current mode's colour for ~1 s so you can check it.
✅ `src: docs/reference/grenade.md §Exact setup procedure`

[callout:warn] **The Respawn-station catch that earns the grenade its "buggy" reputation.** Setting the grenade to Respawn is not enough. **Each tagger must also receive the station's IR** to switch from self-respawn to station-respawn. Either show every gun the station before the game, or press the grenade's button near each gun after the start. That second way is the reliable one. A gun that never got the signal just self-respawns as normal. ✅👥 `src: docs/reference/grenade.md §Respawn Station mode`

[table] **What each mode gives you for $0**

| You want | Grenade mode | Caveat |
|---|---|---|
| A respawn point per team | Yellow (Respawn) | arm every tagger; stations can be overtaken; "not always consistent" |
| King of the Hill / a checkpoint | Blue (Hill) | no winner display on the grenade, so someone has to keep score |
| Two hills or two respawn points | two grenades | each one is its own objective |
| A Counter-Strike bomb site | Blue (Hill) as the site | the plant/defuse timer runs on a host, not the grenade |
✅👥 `src: docs/reference/grenade.md §Known grenade quirks + §Resolved/still open, docs/game-modes.md §How much can the GRENADE do`

[callout:info] **Where the grenade sounds come from.** The detonation, the flashbang and gas effects, the CTF music, "control point captured": all of it plays from the **gun and headset**, triggered by the grenade's IR. The grenade itself only chirps and flashes for status. Swap the tagger's sound files and every grenade "sounds" different, without touching the accessory. ✅ `src: docs/reference/grenade.md §Can we put new audio on the grenade`

[image GAME-12] REAL PHOTO: the Smart Grenade with its top button and LED, ideally lit in one of the mode colours. `src: this section`
[diagram GAME-13] Colour-to-mode wheel: red Frag · green Assault · blue Hill · yellow Respawn · white CTF, with "beacons live" badges on Hill and Respawn. `src: docs/reference/grenade.md`

---

### Page: Beyond stock: the Open BRX mode catalog  (`/manual/gameplay/open-brx-modes`)
_The gun keeps no game state, so any rule you can write over hits, teams, health and spawns is a mode. This is a taste; the full catalog lives in the platform section._

[hero] Every mode above is host-side rules over the same four building blocks: the hit stream, team ids, the health pools, and respawn. Open BRX runs those rules on a laptop (Mission Control) and on a small node per player. So the same gear plays modes Battle Company never shipped, and modes that need props scale up through cheap tiers. → *Platform section* for the architecture. ✅ `src: docs/game-modes.md (incl. §Hard ceilings), protocol/callsign-extract/protocol-classes.md §What's moddable`

[compare] **Modes by what they need**

| Tier | What you add | Modes in the catalog |
|---|---|---|
| **Tier 0 · laptop-only with `brx-mcp`** (taggers + a laptop you own) | nothing | FFA · Team Death Match · Survival/Infection · The Swarm · Generals · Commander · Supremacy · Last Man Standing · **Syphon** (health on kill) · **Halo-style regenerating health** · overshield / medic roles · small-scale **Extraction** · grenade-site **Counter-Strike** |
| **Tier 1 · + props** (objective stations, flags, QR codes, or the grenade) | contested places | Domination · King of the Hill / Territory · Capture the Flag (standard, one-sided, centre-flag) · Assault · Team Arena · VIP escort · Hostage rescue · a real **Extraction point** |
| **Tier 2 · + broadcast** (a live field-wide downlink; location on each node) | live global awareness | Battle Royale · live scoreboards and "flag taken!" callouts on a big no-WiFi field · hidden multi-extracts |
✅ `src: docs/game-modes.md §The three infrastructure tiers + §Catalog + §Custom/advanced modes + §Hard ceilings`

[cards] **Three modes stock BRX doesn't ship**
- **Extraction**: drop in, loot, then reach an extraction point and *channel* it. That takes 30–60 s and it is loud, so everyone comes running. Survive and you bank the loot. Die and you drop all of it. You can play it for $0 with the grenade as the beacon and phones as loot wallets, and a rules engine already exists. ✅
- **Counter-Strike (plant / defuse)**: the grenade or a phone is the bomb. Attackers arm it (by dwell, IR, or an on-screen code) and defenders defuse it (by IR or a puzzle). The round ends on detonate, defuse or elimination. ✅
- **Syphon & regenerating health**: the host credits the exact killer (every shot names its shooter) and tops up their pool. Or it refills anyone who has gone T seconds without taking damage. Both are pure host rules on top of the "heals add, never set" write. ✅
`src: docs/game-modes.md §Extraction + §Custom/advanced modes + §Health/regen variants, mcp/brx_mcp/modes/extraction.py`

[callout:info] **Teams are more flexible than red vs blue.** The hardware supports four native teams, with on-gun friendly-fire protection and a per-team LED colour. For more squads, run everyone as one team with friendly fire on. Hand out armbands, and let Mission Control keep the real teams and scores. The owner community proved this trick with clipped ribbon "flags". ✅👥 `src: docs/game-modes.md §Team structure, docs/reference/community-notes.md §Game-mode design ideas`

[callout:tip] **Honest limits.** Phones have no IR, so shoot-the-point needs a station or the grenade. One phone can hold only a handful of gun links. A field without WiFi means live global state needs a radio tier. We design around all of it instead of ignoring it, and the constraints ledger is in the platform section. ✅ `src: docs/game-modes.md §Hard ceilings`

[diagram GAME-14] The tier ladder: Tier 0 (laptop + taggers) → Tier 1 (+ stations / grenade) → Tier 2 (+ field broadcast), with representative modes stacked on each rung. `src: docs/game-modes.md`

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| GAME-01 | overview / hero | Two silhouetted players in an indoor arena, one firing, with a faint beam of light between them and headset domes catching it | GENERATE | – | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting. Two silhouetted figures in a dim indoor arena holding futuristic rifle-shaped laser taggers, each wearing a slim headband headset with two small dome sensors; a thin electric-blue beam of light travels from one tagger toward the other's headset, which glows faintly at the point of impact; volumetric haze, low camera angle; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. |
| GAME-02 | weapons / class icon set | Six silhouette icons, one per class in the roster: Assault (rifle), CQB (compact SMG/shotgun), Marksman (long scoped rifle), Support (bulky energy rifle), Power (launcher/cannon), Melee (rifle butt in a swing arc) | GENERATE (set of 6, one prompt each with the class swapped) | – | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; a single electric-blue accent (#39b4ff). One flat silhouette-style icon of a generic futuristic [ASSAULT RIFLE / COMPACT SUBMACHINE GUN / LONG SCOPED MARKSMAN RIFLE / BULKY ENERGY RIFLE WITH GLOWING COIL / SHOULDER-FIRED LAUNCHER CANNON / RIFLE STOCK MID-SWING WITH A MOTION ARC], side profile facing right, centered, same scale and lighting across the set, clean vector-like edges with a thin blue rim light; NO text, NO labels, NO logos, NO brand names, NO watermarks; 1:1. |
| GAME-03 | weapons / hero | Row of five abstract weapon silhouettes at identical scale, cadence dots under each suggesting fire rate | GENERATE | – | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; cool desaturated palette, single electric-blue accent (#39b4ff), occasional amber (#ffb020). Five generic futuristic laser-tagger silhouettes in a horizontal row at identical scale, side profile, with an abstract row of small dots beneath each one at different spacings suggesting fire cadence; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. |
| GAME-04 | weapons / fire-mode table | Abstract timing strips: a continuous pulse train (full auto), single pulses, groups of three, and a rising charge curve ending in one pulse | GENERATE | – | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016); electric-blue (#39b4ff) waveform strokes with an amber (#ffb020) highlight on one. Four stacked horizontal timing strips: an even continuous pulse train, widely spaced single pulses, pulses in tight groups of three with gaps, and a smooth rising ramp that ends in a single tall pulse; clean vector-like lines, no axes; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. |
| GAME-05 | weapons / overheat callout | A weapon silhouette with a heat gauge climbing from blue to amber and a shimmer of heat at the barrel | GENERATE | – | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient. A generic futuristic laser-tagger silhouette in side profile with a vertical segmented gauge beside it filling from electric-blue (#39b4ff) at the bottom to amber (#ffb020) at the top, and subtle heat shimmer rising from the barrel; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. |
| GAME-06 | weapons / gun-menu table | REAL PHOTO: the tagger's rear display/LED area while cycling weapons in the on-gun menu | REAL PHOTO | owner shoots | – |
| GAME-07 | health / hero | REAL PHOTO: a tagger being hit, headset dome lit green, gun LED strip visible | REAL PHOTO | owner shoots | – |
| GAME-08 | modes / icon set | Eleven mode icons as one consistent set: FFA, TDM, Generals, Supremacy, Survival/Infection, Swarm, CTF, Domination, KotH, Battle Royale, Extraction | GENERATE (set of 11, one prompt each with the motif swapped) | – | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016); flat line-icon style with a single electric-blue accent (#39b4ff) and one amber (#ffb020) detail. One circular badge icon containing a simple abstract motif: [crossed swords for free-for-all / two opposing shield halves for team deathmatch / a star insignia with a small figure for generals / three interlocking hexagons for supremacy / a biohazard-like trefoil made of simple arcs for infection / a hive cell cluster for swarm / a flag on a pole for capture the flag / three linked map pins for domination / a hill contour with a crown for king of the hill / a shrinking concentric ring for battle royale / an upward arrow through a ring for extraction]; identical stroke weight and badge size across the set; NO text, NO labels, NO logos, NO brand names, NO watermarks; 1:1. |
| GAME-09 | health / diagram | Three stacked pools (shield, armor, health) draining top-down, with one large hit overflowing from the armor bar into the health bar | GENERATE (or inline SVG) | protocol/session-findings-2026-08.md §7r addendum | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient. Three horizontal capsule bars stacked vertically, the top one thin and pale, the middle one wide in electric-blue (#39b4ff), the bottom one in amber (#ffb020); a single glowing impact mark on the middle bar with a spill of light flowing down into the bottom bar; clean vector-like lines, generous spacing; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. |
| GAME-10 | how-a-kill-works / diagram | The kill pipeline: tagger emitting a coded burst of light → a headset with front and back domes plus a gun-body sensor → a pool bar dropping → a green sight flash on the shooter | GENERATE (or inline SVG) | protocol/brx-ir-protocol.md | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; single electric-blue accent (#39b4ff), occasional amber (#ffb020), a single green glow permitted for one element. Left-to-right flow: a stylised tagger silhouette emitting a short dashed beam made of long and short segments; the beam reaching a slim headband headset with two small dome sensors and a second sensor on a rifle body; a small capsule bar beneath them partly drained; and at the far left a rifle sight glowing green; connected by thin arrows; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. |
| GAME-11 | how-a-kill-works / feedback table | REAL PHOTO: a headset lit green mid-hit next to a tagger sight showing the kill-confirm flash | REAL PHOTO | owner shoots | – |
| GAME-12 | grenade-modes / hero | REAL PHOTO: the Smart Grenade, top button and LED visible, lit in a mode colour | REAL PHOTO | owner shoots | – |
| GAME-13 | grenade-modes / colour wheel | Five-segment colour wheel (red, green, blue, yellow, white) around a grenade silhouette, two segments marked with a small radiating "beacon" glyph | GENERATE | docs/reference/grenade.md | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient. A simple rounded grenade-like cylinder silhouette in the centre with a small button on top, surrounded by a ring divided into five equal segments coloured muted red, green, blue, yellow and white; two of the segments carry a tiny radiating-arcs glyph beside them; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 1:1. |
| GAME-14 | open-brx-modes / tier ladder | Three ascending platforms: a laptop with taggers; plus a small station and a grenade; plus a radio mast, with abstract mode badges stacked on each | GENERATE (or inline SVG) | docs/game-modes.md | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; single electric-blue accent (#39b4ff), occasional amber (#ffb020). Three ascending isometric platforms left to right: the first holding a laptop and a few tagger silhouettes, the second adding a small box with a ring of light and a grenade-like cylinder, the third adding a slim radio mast with concentric signal arcs; a few small circular badges stacked above each platform; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. |

## Interactive ideas (≤5)
1. **Weapon comparator**: pick any two or three weapons; side-by-side bars for damage, cycle, RPM, clip, reserve, reload, heat, hits-to-kill and time-to-kill, computed live from the table (TTK = (hits−1) × cycle; charge weapons hits × cycle; burst weapons use the burst-average cycle). `src: docs/weapon-design.md §0`
2. **Time-to-kill calculator**: sliders for the victim's HP/armor (defaults 45/70, presets for the Supremacy characters) and a toggle for a ×1.25 / ×2 class multiplier or a crit; shows hits-to-kill and TTK for every weapon at once. `src: docs/weapon-design.md §0 + §6.1, docs/reference/brx-manual-notes.md §Supremacy characters`
3. **"Shots left" ammo planner**: for a chosen weapon, how many kills one load (clip + reserve) buys at the current pool, and how many reloads that costs in seconds. `src: docs/weapon-design.md §0 (total kills)`
4. **IR word visualiser**: a live 25-bit word you can edit (player id, team, damage, type, crit) that re-renders the long/short pulse train and shows how the victim would resolve it. `src: protocol/brx-ir-protocol.md`
5. **Grenade mode picker**: tap a colour, see the mode, its behaviour, whether guns can read it live, and the exact button procedure; includes the Respawn "arm every tagger" checklist. `src: docs/reference/grenade.md`

## Sources used
- `docs/reference/weapons.md`: the captured Callsign arsenal (damage, cycle, clip, reserve, heat, sounds, behaviours)
- `docs/weapon-design.md` §0, §1, §4, §5, §6: damage model, stock table with reload/htk/TTK, fire-mode proof, range field, effect-table layer
- `docs/reference/callsign-ui.md`: the app's weapon screen (clip/mags/reload), categories, mode tiles, every GAME SETTINGS field
- `protocol/callsign-extract/apk-harvest.md`: the app's 14 modes, win conditions, QR stations, weapon pickup pool, grenade fields, region enum, where the data lives
- `protocol/callsign-extract/protocol-classes.md`: enums (damage/ability types, reload types, weapon categories), FSET sound slots, moddability bounds
- `protocol/callsign-extract/config-facts.md`: app categories, 16 streak rewards; `mcp/brx_mcp/data/medals.json`: 21 medals
- `docs/reference/brx-manual-notes.md`: V7 manual: on-gun flow, modes, settings ranges, stock weapons, per-mode perks, 9 Supremacy characters and abilities
- `docs/reference/brx-extended-user-guide.md`: 7 gun-menu modes with LED colours, factions, 13 classes, 8 perks, weapon descriptions, accuracy model, indoor/outdoor
- `docs/game-modes.md` (incl. §Hard ceilings): infrastructure tiers, catalog, custom modes, Extraction, health/regen variants, team structure, honest limits
- `docs/reference/grenade.md`, `docs/reference/community-notes.md`: the 5 grenade modes, setup procedure, beacon behaviour, respawn gotcha, quirks, CTF music, balance notes
- `docs/manual/04-sound.md`: who plays which sound; native multikill audio vs host-driven kill feedback
- `docs/experiment-log.md` #33 and the `$SFLASH` / LED-map entries: health-write semantics, no native regen, kill-confirm flash, headset green = hit/kill feedback
- `protocol/session-findings-2026-08.md` §7o, §7r + addenda, `$WEAP t20`, overheat: sensor map, armor model, fire modes, heat gauge
- `protocol/brx-ir-protocol.md`: the 25-bit IR word

## Research backlog (held, NOT published)
Items removed from the pages above under the known-facts rule, plus open questions. Nothing here appears on the site until confirmed.
- **Range field: what it physically does.** The app draws different Range bars per weapon, but the frames carry one range value (75; Melee 20) for every gun, and an "extra headset range" of 30 on Rocket, Shotgun and Plasma Sniper (that much is published). One data point says the field matters at all; an instrumented A/B is pending. *Removed:* "the range difference is presentation" + "we are still testing" from the weapons callout. `src: docs/weapon-design.md §4.2, §5 U2`
- **Hits-to-kill for non-standard damage types (5 weapons).** The captured 10-row `$SIR` effect table maps subtype 1 → fn 36 and subtype 3 → fn 37. **Those multipliers are confirmed (2026-09-02): fn 36 lands the floor of magnitude × 1.25, fn 37 lands magnitude × 2.** What still blocks publishing a hits-to-kill number is that this is measured through **our** `$SIR` table, and whether the Callsign app pushes the same table in every game is not established; the Energy Launcher's `<9,3>` maps to fn 24, a status function that changes no pool (0 damage, 3/3 trials). So what Burst Rifle, Force Rifle, Bolt Rifle and AMR actually take to kill in stock play is still unpublished, as is whether the Energy Launcher kills at all. *Removed:* the plain-damage hits-to-kill cells for Burst (13), Force (13), Bolt (9), AMR (7), Energy Launcher (1) and the Energy Launcher "one-shot kill"; the Sniper Rifle stays at 2 because 80 and 100 both need two hits. `src: docs/weapon-design.md §0 + §6.2, mcp/brx_mcp/gameconfig.py _SIR_TABLE, docs/experiment-log.md 2026-08-26 + 2026-09-02`
- **Which Lives list is current.** V7 manual prints ∞ · 1 · 3 · 5 · 10 · 15; the Extended Guide prints 1 · 3 · 5 · 10 · 25 · Unlimited. Both are official; a firmware-revision explanation is unproven. *Removed:* both lists from the Respawn & lives table and the gun-menu spec-sheet (now "a count, or unlimited"), and the whole "Which lives/time/respawn list is right?" callout on the modes page. `src: docs/reference/brx-manual-notes.md §Game modes, docs/reference/brx-extended-user-guide.md`
- **Rail Gun tap = weaker shot?** The fire-mode table said a tap gives a "weak shot"; the captured-roster note only says a tap also fires. *Rewritten* to "a tap also fires". `src: docs/reference/weapons.md`
- **Gun-menu presets vs Callsign weapons.** Whether the manual's M-4 (24 dmg) is the same preset the app sends as the Assault Rifle (9 dmg) is not established; the page now prints both numbers side by side without calling either stale. `src: docs/reference/brx-manual-notes.md §Stock weapons, docs/reference/weapons.md`
- **IR carrier wavelength.** `brx-ir-protocol.md` lists "940/980 nm"; one value has not been pinned. *Removed* from the how-a-kill hero (38 kHz stays). `src: protocol/brx-ir-protocol.md §Carrier`
- **Live-service balance.** Weapon stats are fetched from Battle Company's servers; the numbers published are what the app sent on capture day. Re-capture periodically. `src: docs/reference/weapons.md`
- **Class stats beyond the nine.** Grenadier, Mercenary, Valkyrie and Sniper are described in the Extended Guide but their health/armor/shield builds are not printed anywhere found so far. *Removed:* "the four extra classes' exact stats" from the provenance callout (they were never in the app config either). `src: docs/reference/brx-extended-user-guide.md §Character classes`
- **The native Sentinel EMP.** The manual says it "stuns a group"; the effect function first pinned is an audio suppressor, not a stun. Capturing the real EMP word is next. *Removed:* the ❓ sentence from the classes-page callout, and "EMP-style" from its bench-confirmed list. `src: docs/weapon-design.md §5 U11′`
- **Status-effect list as the bound on custom weapons.** The app's damage/ability enum is published as an app fact; the claim that it bounds what any custom weapon can do on the gun is *removed* pending an effect-table sweep. `src: protocol/callsign-extract/protocol-classes.md §Enums + §FSET`
- **Grenade CTF team assignment.** Shooting a CTF-mode grenade turned it red rather than the shooter's colour on the bench; the flag/team step has not been reproduced. *Removed:* the "Capture the Flag base" row of the "$0" table. `src: docs/reference/grenade.md §Known grenade quirks`
- **Thrown-grenade blast types.** FlashBang / Gas / Confusion / Molotov are configurable for a *paired* thrown grenade in the app's data; untested end-to-end on hardware. *Removed:* the "Area denial" row of the "$0" table. `src: docs/reference/grenade.md §Resolved/still open, protocol/callsign-extract/apk-harvest.md §Grenade`
- **Reserve accounting.** Every frame carries a reserve value exactly twice a second reserve value; which one the gun counts down from is known, why there are two is not. `src: docs/reference/weapons.md`
- **Streak rewards & medals in play.** All 16 rewards and 21 medals are published as app-config facts; none has been watched firing in a hosted game. `src: protocol/callsign-extract/config-facts.md, mcp/brx_mcp/data/medals.json`
- **Region setting.** `GunLaserRegion` = USA / International is published as the app's setting name; the "IR emitter power profile" reading of what it changes on the gun is *removed*. `src: protocol/callsign-extract/apk-harvest.md §Region`
- **Images:** none removed. No image slot illustrated a held claim (GAME-09's caption was reworded from "a sniper's 80-point hit" to "an 80-point standard hit").
