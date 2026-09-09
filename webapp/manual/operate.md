# Operating the BRX
Last verified: 2026-09-09

This page covers stock BRX gear: a tagger, a headset, maybe a grenade, and the Callsign app. It
gets you from box on the table to a game running, using no laptop, cable, or BLE protocol; that
is covered in the developer reference.

## Quick Start

Go from box to your first "TARGET MODE" voice line in about fifteen minutes, plus a charge.

Charge it, pair it, sight it, play.

> **What you are holding.** The BRX is a rifle-style infrared tagger (Class 1, 980 nm IR laser).
> The wireless headset carries the hit sensors, and the gun has a sensor too. Out of the box it
> is a non-scoring system: the gun keeps no score and no clock, so scoring comes from the on-gun
> game or the phone app.

**First power-on checklist:**

1. Charge the gun first. Plug the two-cell 8.4 V smart charger into the round charging port. Do
   not use the micro-USB "Programing Port" next to it. The charger LED is red, then green when
   full. A full charge gives you roughly 8 h of play. The headset takes any USB 5 V supply.
2. Power on the gun with the slide switch by the barrel. You should hear a startup sound. A
   "pop" from the speaker at boot means audio is alive. If it boots silently, you were holding
   SELECT: that is USB disk mode, so power off and try again.
3. Power on the headset. Its LEDs cycle through colours ("rainbow") while it is unpaired, then
   settle. Pairing is automatic. It can take up to 3 minutes when lots of taggers and Bluetooth
   devices are around.
4. Watch the headset settle. A slow rainbow blink that never stops means it is not paired: see
   Pairing the Headset below. Once paired it shows the gun's team colour.
5. Set indoor or outdoor mode for where you will play (hold ALT 3 s). It changes IR range and
   LED brightness, and it sticks across power cycles.
6. Sight the laser in target mode before your first real game (hold LEFT while powering on).
7. Pick a game on the gun with LEFT/RIGHT, pull the trigger to select, then pull the reload
   handle to start.

**The controls, in one glance:**

- **Trigger**: fire. In menus it selects, and it cycles weapons or characters.
- **ALT (orange)**: cycles perks and abilities in the modes that have them, in the menu and in
  play. No stock weapon has an alt-fire. Hold 3 s to toggle indoor/outdoor.
- **SELECT**: steps through settings. Hold it at power-on for USB disk mode (firmware and
  sounds).
- **LEFT / RIGHT (D-pad)**: cycle modes and teams. Hold LEFT at power-on for target mode. Hold
  RIGHT at power-on for accessory/headset pairing.
- **Reload handle**: reloads in play. Pulling it starts an on-gun game.
- **Slide power switch**: by the barrel.

> **Tip.** Label each gun and its headset as a pair. Put a strip of tape or a sticker with the
> same mark on both. Stock taggers look identical and come unlabeled. A mixed-up pair is the
> number one reason for "my gun won't fire" at a party.

## Charging and Batteries

Two ports on the gun, two kinds of charger, one polarity trap.

**Power at a glance:**

| Item | Value |
|---|---|
| Gun pack | 7.4 V Li-ion, ~2200 mAh, two cells, 2-pin connector |
| Gun charger | the supplied 8.4 V two-cell smart charger; the LED is red while charging and green when done |
| Run time | roughly 8 h of play per full charge |
| Headset | charges from any USB 5 V source; the v2 headset runs on a single 18650 cell |
| Fallback | the gun can run on an optional 6xAA holder; use alkaline only, never rechargeable AAs |

> **Warning.** Battery polarity is reversed from the usual convention. Replacing the pack,
> building spares, or wiring an external charger? Check polarity with a meter before you connect
> anything. A reversed pack risks damaging the tagger. Some aftermarket packs have a 3-pin
> connector, and the BRX ignores the third (thermistor) pin.

> **Warning.** Two ports, and you must not confuse them. The round charging port takes the
> charger. The micro-USB "Programing Port" next to it is only for firmware and sound updates
> (see Firmware and Sounds). It is not a charging input.

**Swapping the gun battery:**

1. Power off and unplug the charger.
2. Remove the single screw near the reload switch to open the battery bay.
3. Disconnect the old pack. Check the new pack's polarity against the old one before you plug it
   in.
4. Close it up, power on, and listen for the startup sound.

> **Tip.** Field practice from the owner community: keep a stack of charged spare packs and swap
> them in the field. That beats trying to top up a gun from a power bank. A spliced BRX AC
> adapter can charge packs outside the gun.

> **Low battery has a hidden cost.** Below a certain charge the BRX firmware will not
> re-establish its Bluetooth link to a phone. If the app suddenly cannot reconnect late in a day
> of play, blame the battery before the phone.

## The On-Gun Menu

Everything you can set without a phone, and what the gun remembers.

> **The gun's LED shows the mode.** White is Free For All, red is Death Match, yellow is
> Generals, blue is Supremacy, pink is Commander, green is Survival, orange is The Swarm. During
> play the same LED shows ammo and health.

**Navigating the root menu:**

1. Power on. You land at the root menu. LEFT / RIGHT cycle game modes and the LED colour changes
   with each one. Trigger selects.
2. Pick your team or faction with the D-pad. Trigger cycles weapons (or characters in
   Supremacy). ALT cycles perks, but only in modes that have them.
3. Press SELECT to step through the game variables: lives, game time, respawn, volume. The
   D-pad changes each value and SELECT moves you on.
4. Pull the reload handle to start. Anything you changed becomes the new default for that mode.

**Game variables on the gun:**

| Setting | Values | Notes |
|---|---|---|
| Game time | Off, 5, 10, 15, 20, 30 min | |
| Respawn | Off, 15, 30, 60 s, Ramp 45, Ramp 90 | "Ramp" grows the penalty with each death, up to the cap |
| Volume | 1-5 | |

> **These variables live on the gun, per game mode.** They are not the numbers the Callsign app
> uses. The app keeps its own clock and respawn timer on the phone, and it never writes these to
> the gun.

**Button holds worth memorising:**

- **ALT, hold 3 s**: toggle indoor / outdoor (it sticks).
- **LEFT at power-on**: target mode, for sighting.
- **RIGHT at power-on**: "install accessory" pairing mode (headset, grenade, sidearm and
  friends).
- **SELECT at power-on**: USB disk mode. No startup sound.
- **LEFT + RIGHT, hold 5 s in a game**: soft reset back to the menu.
- **LEFT + RIGHT, hold 3 s at the root menu**: the primary admin lock. It blocks mode changes
  and reset, and nothing else. Weapon, team and perk cycling still work under it.
- **LEFT + RIGHT + SELECT, hold 3 s at the root menu**: the stronger lock. On top of mode changes
  and reset it also freezes indoor/outdoor, weapon, team and perk. A gun that will not cycle
  weapons is under this lock, not the primary one. Either lock stops the gun hosting. Unlock with
  the same hold that set it.
- **Swing your elbow (gesture-enabled "logo" guns)**: melee from the headset's front emitter.
  Other guns use RIGHT.

**Stock modes selectable on the gun:**

| Mode | Teams | Weapons | Perks |
|---|---|---|---|
| Free For All | none, friendly fire on | M-4, SMG-X3, MG-7, SR-100 | none |
| Team Death Match | Alpha / Bravo | + TAC-87 | Grenade Launcher, Med Kit, Concussion Grenade, Extended Mags, Body Armor |
| Supremacy | Resistance (red) / Vanguard (green) / Nexus (blue) | 9 characters are the loadout | per-character abilities |
| Survival | Human / Infected | M-4, SMG-X3, MG-7, SR-100, TAC-87 | none |

Generals, Commander and The Swarm show up on newer firmware as Callsign-Live unlocks. Full stats
and abilities are in the Gameplay section.

## Indoor vs Outdoor Mode

One three-second hold changes your range, your LEDs and your blast radius.

**Switching modes:**

1. Hold ALT for 3 seconds at any time. The gun announces the new mode.
2. Leave it. The setting persists across power cycles, so you set it once per venue.
3. Host from the Callsign app instead? Its per-game Outdoor mode toggle sets the same thing.
4. Driving a gun from your own code? The field looks like `$GSET` token 2, `outdoorMode`, with
   token 3 `gunLaserRegion` carrying the IR power limit. Both names and mappings come from
   decoding the app: setting either over Bluetooth and watching the gun change is untested. Both
   are in the developer reference.

**What changes:**

| | Indoor | Outdoor |
|---|---|---|
| Green hit LEDs | dimmed | full brightness |
| RGB headset LEDs | enabled | bright-sun visibility is poor on any headset |
| Explosion / melee range | shrunk | full |
| Station / respawn-signal reach | shorter, because the forward IR projection scales with mode | ~18-20 ft to a respawn station |
| Gun hit radius | n/a | bright sunlight cuts it roughly in half (IR noise filtering) |

> **Tip.** Use indoor mode indoors, even in a big room. Full-power IR in a small space bounces
> off walls, and a bounce can land on your own headset. A gun can drain its own armor by firing at
> a wall a few feet away.

## Sighting the Laser

Target mode makes the gun harmless, tireless, and honest about where it points.

**Enter target mode:**

1. Start with the gun off. Hold LEFT and slide the power on. Keep holding until you hear
   "TARGET MODE".
2. Check what the mode does: the gun is on the yellow team, does 0 damage, and has unlimited
   ammo. The headset will not pair, and that is expected.
3. Have a helper wear a powered headset at your sighting distance, or prop one up. A direct hit
   flashes the headset green.
4. Adjust the scope or sight until the flash lands where the reticle says it should.
5. Power-cycle the gun to leave target mode.

**Sighting distances the community uses:**

| Loadout | Sight at |
|---|---|
| General indoor play | ~20 ft |
| General outdoor play | ~300 ft |
| Sniper (SR-100 class) | 300-400 ft |
| Shotgun / SMG | 50-100 ft |

> **Why bursts hit and mag-dumps miss.** The BRX simulates recoil. Rapid fire drags your
> accuracy down toward each weapon's floor. A "miss" still flashes the target's headset and
> plays a zip sound, but it does 0 damage. Fire in bursts and let your accuracy recover.

## Pairing the Headset

The number one cause of "my gun won't fire", and the fix for it.

> **The headset is a separate radio device**, and it carries most of the hit sensors. It pairs
> to one gun. A gun that boots with a headset and then loses it locks its trigger until the
> headset returns (anti-cheat).

**Normal pairing (every day):**

1. Turn the gun on, then the headset. The headset LEDs cycle rainbow while they search.
2. Wait. Pairing can take up to 3 minutes when lots of taggers and Bluetooth devices are around.
3. Watch for the LEDs to settle to the gun's team colour. That means you are paired.

**Reading the headset LEDs:**

| Headset shows | It means |
|---|---|
| Slow rainbow blink | Not paired / disconnected. The gun will not join a phone game, so re-pair before you start. |
| Solid team colour (red / blue...) | Paired, in the menu or lobby. Pre-game only. |
| Dark during play | Normal. The headset goes dark once a game starts. |

**Re-pairing a headset that has lost its gun (Gen-3 procedure):**

1. Turn the headset on. Its LEDs cycle colours.
2. Press and hold the small headset button. Keep holding it through the whole procedure.
3. Hold RIGHT on the D-pad while you slide the gun power on.
4. Wait for the voice line "PAIRING MODE".
5. Pull the trigger once. You get "HEADSET CONNECTED" and the headset LEDs stop cycling.
6. Pull the trigger a second time. It announces "device paired". Now release the headset
   button.

### Alternative: "install accessory" route

Boot the gun holding RIGHT ("install accessory"), power the headset, then press its button once.
It is the same boot mode you use to pair a grenade or a sidearm.

> **Warning.** Firmware updates can un-pair everything. Owners report the v4.30 update wipes
> settings and breaks headset pairing until you re-run setup. Battle Company's own fix involved
> a temporary downgrade. Re-pair after any firmware update, before a game day. Details are in
> Firmware and Sounds.

**Headset troubleshooting:**

### The gun charges a weapon but nothing happens on the trigger

That is the classic headset lockout. Look at the headset: rainbow means re-pair it.

### The phone app connects, then drops within a couple of seconds

The app needs a paired headset and quietly disconnects without one. The gun is fine. Get the
headset lit before you open the app.

### Only some guns joined the phone game

A gun whose headset is off or unpaired (slow rainbow) refuses to join, and gives no error.
Eyeball every headset before you start. Before the game a paired headset shows team colour, and
it only goes dark once play begins.

### It paired yesterday and not today

That is the headset battery. It charges from any USB 5 V.

## The Grenade and Other Accessories

Pair a thrown grenade, or use it as a respawn point, a hill or a flag. No app needed.

> **Two different jobs, two different setups.** A thrown grenade pairs to your gun, once. An
> objective device needs no pairing at all, because any gun talks to it over IR. That covers the
> respawn station, King of the Hill, Assault point and CTF flag. Do not use "install accessory"
> for objective modes.

**Pairing accessories to your gun (grenade, sidearm, hatchet, shield):**

1. Start with the gun off. Hold RIGHT and power on to reach "install accessory".
2. Power on the accessory. It accepts a new pairing for 30 seconds after power-up.
3. Aim the gun at it and pull the trigger. The pairing code goes over IR, and the device flashes
   or chirps to confirm.
4. Pair every accessory in the same session, without powering the gun off, then tap SELECT to
   finish. Adding a new accessory later means re-pairing all of them together.

**Throwing a paired grenade:**

1. Check that your headset is on and paired.
2. Press the grenade's top button near your headset to arm it.
3. Throw it. On detonation everyone in range takes the blast. Land it on a hill or a respawn
   point and your team captures that point instantly, at full charge.

**Setting an objective mode on the grenade:**

1. Power the grenade off, then on, and wait for the green ready LED.
2. Hold the top button ~4 s until you hear a long loud beep. You are now in setup.
3. Keep holding. It beeps fast and cycles colours. Release on the colour you want.
4. Watch the LED go white to confirm the lock. The mode survives power-cycling, and on every
   boot it flashes the current mode's colour for about a second.
5. Repeat from step 1 to change the mode.

**Grenade mode colours:**

| Colour | Mode | How it plays |
|---|---|---|
| Red | Frag | a plain blast grenade; throw it or trigger it with the button |
| Green | Assault | shoot it to capture it for your team; the LED turns your colour (owners call it finicky) |
| Blue | Hill (King of the Hill) | starts neutral white; shoot to claim it; every shot adds charge and the other team must out-shoot it to take it back; guns announce "control point captured" |
| Yellow | Respawn station | starts neutral; shoot to claim it for a team; it then respawns that team's dead players |
| White | CTF flag | shoot to grab it; a tagger carrying the flag plays the CTF music |

**Using a respawn station:**

1. Set the grenade to yellow, put it at your base, and have one player from the team shoot it.
   It turns that team's colour.
2. Arm each tagger before kickoff. Press the grenade button near each player. Or have each
   player face the station with the front of the headset and pull the trigger. A tagger that
   never gets the station signal just self-respawns as normal.
3. Send dead players back to base to respawn. They press the station button, which respawns
   everyone of that team nearby. Or they face it with the headset front and pull the trigger
   (about 18-20 ft, less indoors).
4. Expect the other team to overrun it. They shoot it or grenade it to flip its colour.
5. Missed the arming step? Pressing the station button near a gun during the game forces it
   into station-respawn mode too.

> **Tip.** A spare tagger left in accessory-setup mode is a free "announcer". It calls out the
> grenade's mode names as you cycle them. It also says "respawn point enabled" and a claim chime
> as the game runs. That is handy for setting up a field without staring at LED colours.

> **Everything you hear from a grenade is really played by the guns and headsets.** The
> explosion, the flashbang, the CTF music and the respawn chime are all their answer to its IR
> signal. The grenade itself only chirps and flashes. That is why custom sound packs on the gun
> change "grenade sounds" too.

**Grenade quirks owners run into:**

### It can't show a winner

Stock kit tallies hill and domination scoring nowhere, so a ref or host keeps score.

### The defending team captured their own Assault point

That is a known quirk. Treat Assault as low-reliability.

### A grenade in the wrong mode triggered odd game reactions

CTF music in a deathmatch, for example. Check the boot-flash colour before every game.

### The USB-C port is charge-only

There is no drive, no console and no update path on that port.

## The Callsign App

Callsign is Battle Company's official phone app. It hosts games and pushes settings to the gun;
this section covers building a game and the gotchas that catch new users.

> **What the app is.** Callsign turns a phone into the game host. It keeps the clock, the score
> and the respawn timer. It also pushes weapons and settings to the gun over Bluetooth. The gun
> enforces none of the rules. Take the phone out of Bluetooth range and nobody respawns, and the
> round never ends.

**Callsign at a glance:**

- Keep the phone within about 1 m of its gun for the whole match. It is the game engine.
- A hosted game typically takes about 1 minute to show up as joinable on a second phone. It
  round-trips through the cloud.
- On connect the Android app sets the gun's internal volume to 100 out of 100. iOS sets it to
  69. That matters here, because the app is effectively Android-only.
- Owners report the app only works on Android 10 or earlier. iOS is fine.

**Building and starting a game:**

1. Get the top-right connection icon green ("connected"). You cannot create a game until it is,
   and it will not go green without a paired headset.
2. Tap SELECT A GAME and swipe the category carousel: Team Arena, Battle Royale, Battle Lines,
   Faction Wars, Infection.
3. Tap SELECT GAME MODE. Under Team Arena, for example: Arena, Team Arena, Team Snipers,
   Capture the Flag.
4. Fill in GAME SETTINGS: primary and secondary weapon, then the rules in the table below. Press
   CREATE. Some modes add a step for teams, starting health, or the players-remaining display.
5. Wait in the lobby while other players join from their phones, pick weapons, and hit ready. On
   a single device, use Start Offline Game.
6. Let the host launch. Every gun goes live together, and the in-game HUD shows health, shield,
   ammo and weapon.

**Game settings the app exposes:**

| Setting | Choices |
|---|---|
| Primary / Secondary weapon | 19-weapon roster (Assault Rifle, Sniper, Shotgun, SMG, Rail Gun, Rocket Launcher...); secondary removable |
| Weapon respawn | 30 s, 60 s, 90 s, 3 min |
| Weapon pick-up | Scan, Player, Both |
| Weapon selection | on / off |
| Outdoor mode | on / off |
| Voice | Male, Female |
| Time | minutes |
| Score to win | a number |
| Respawn type | Scanner (respawn at a printed QR code), Auto (timed) |
| Respawn time | seconds |
| Lives | a count, or Unlimited |
| Extra step (some modes) | Allow Teams / No Teams, Starting health Low/Medium/Full, Players remaining Show/Hide |

> **Field objectives in Callsign are printed QR codes.** Respawn points, weapon pickups, control
> points and supply drops are all paper you scan or fire at, not boxes.

> **Volume.** The app's whole global settings screen is one Sound slider. On connect the Android
> app sets the gun to 100 on its internal 0-100 scale, and iOS sets it to 69. 69 is quieter than
> the number suggests: measured on 2026-08-30 it lands at roughly on-gun level 2, and it was
> inaudible outdoors. Anything much below 50 makes weapon sounds effectively silent, and 30
> measures as inaudible over room noise. Open BRX plays at 80 indoors and 90 outdoors instead.

> **Gotcha 1: the app renames your gun.** Every session Callsign writes the name "Tactix2" to
> the gun. Gave a gun a custom Bluetooth name with Open BRX tools? Opening Callsign on it
> silently resets that name.

> **Gotcha 2: "the app is flaky" is almost always the headset.** With no headset paired, the app
> connects to the gun and drops it about a second later. There is no message, and the icon
> simply never turns green. Nothing is intermittent: it works exactly when the headset happens
> to be linked.

> **Gotcha 3: the firmware warning is soft.** Newer guns show "firmware v4.32 ... supported
> until v2.01e". The gun is ahead of the app's list, not behind it, and games still run. Do not
> downgrade firmware to satisfy that message.

> **Tip.** The app shows player numbers as 1-64. The gun stores them 0-63. This only matters if
> you compare app numbers with developer tools.

## Running a Native Game on Stock Kit

A walkthrough of a whole match, on-gun or app-hosted, and what every light and voice line means
while it runs.

**Option A: a game hosted on the gun (no phone):**

1. Get every player set: gun on, headset on and settled, no rainbow.
2. Have every player select the same mode with LEFT/RIGHT and pull the trigger.
3. Pick your team with the D-pad, your weapon with the trigger, and your perk with ALT (Team
   Death Match only).
4. Step through lives, time, respawn and volume with SELECT. Agree the values across all guns,
   because each gun runs its own clock.
5. Count down together and pull the reload handle to start.
6. Keep score by voice, by a ref, or by team flags. The guns do not tally kills.

**Option B: a game hosted from Callsign:**

1. Get every player set: headset paired, phone mounted on the gun, app icon green.
2. Have the host create the game while the others join and ready up. Allow a minute for the
   lobby.
3. Let the host launch. Guns spawn together and HUDs light up. You do not need the reload handle
   to start.
4. Die, and the app respawns you after the set respawn time, or at a QR scanner.
5. Hit the time or score limit, and the app ends the game with a voice line and stops the guns.
   Scores live on the phones.

**During play: what you see and hear:**

| Signal | Meaning |
|---|---|
| Gun LED | ammo and health indicator |
| Headset dark | normal during a game |
| Headset flashes, "zip" sound, no damage | a miss under the recoil-accuracy model |
| Headset lit with team colour mid-game | that gun is still in the lobby; it never entered the game |
| Headset slow rainbow | the headset dropped; that gun is locked until it re-pairs |
| Trigger only reloads / chirps | you are in a menu, the game has not started, or the gun is locked |
| "Dead / out of ammo" noise on trigger | you are dead and a respawn station is set up, so go to the station |

> **Where hits land.** The headset carries sensor domes front, left, right and back, and the gun
> has a sensor of its own. At field distances the dome that catches the shot is the one you were
> facing with. Point-blank, IR floods every receiver and any dome can report it. The damage is
> the same either way, because a dome hit is a hit.

> **Dead means dead.** A tagger that is dead (out of health) ignores all incoming IR. It cannot
> take a hit, be healed, or be armed by a station until it respawns.

> **Warning: the "screamer".** Owners widely report this in hosted or online play. After about
> an hour some guns fail with a loud buzz and need a reboot. They also report that a low battery
> stops Bluetooth re-pairing entirely. A game can cascade down to half its players. A gun left
> powered all day still advertises normally but refuses connections. Power guns off between
> rounds, keep packs topped up, and reboot a buzzing gun instead of fighting it.

**Owner-invented rulesets that need no extra gear:**

- **Ribbon teams**: run everyone on one team with friendly fire on, and tell teams apart by a
  coloured ribbon on a clip. Swap ribbons on death for infection or team-swap modes.
- **Respawn character**: Generals, Commanders and Swarm modes give one player a mobile respawn
  point. Teammates revive at them with the trigger.
- **Ammo restock**: a grenade, a perk slot, or the respawn character can hand out ammo in
  limited-ammo games.

## Range and Line of Sight

What the numbers on the box mean once the sun comes out.

**Range at a glance:**

- Battle Company rates the IR beam's typical maximum reach at about 600 ft in good conditions.
  Shade and night are the good conditions.
- Bright direct sunlight shrinks the gun's hit radius by about 50%.
- The IR wavelength and carrier are 980 nm / 38 kHz. It is a Class 1 device, safe for eyes.
- A respawn station "hears" a headset-and-trigger request from about 18-20 ft outdoors.

**Line-of-sight rules of thumb:**

- **IR is light.** It needs a clear path to a sensor dome. It does not go through people, walls
  or dense foliage. Shade and dusk improve range, and full noon sun cuts it.
- **It bounces.** In small rooms and near walls a shot can reflect back onto your own headset.
  Use indoor mode indoors.
- **The headset is the bigger target.** Head-height domes on four sides catch far more than the
  gun's own sensor, so snipers aim for the head.
- **Close range is chaos.** Point-blank, every dome reports. At distance the facing dome
  reports. Neither changes the damage.
- **Feedback fades in sun.** The headset's green hit LEDs are hard to read in direct sun, so
  long-range tags look like misses. Listen for the target's hit sound instead.

> **Bluetooth range is not IR range.** The phone hosting a game has to stay within Bluetooth
> reach of its gun. In practice that means mounted on it. IR shots still land at hundreds of
> feet. It is the game logic that stops working when the phone is out of range.

## Care and Storage

Keep it charged, keep it dry, and turn it off between rounds.

**Between games:**

- **Power off between rounds.** Guns left powered for many hours develop Bluetooth trouble
  ("screamers"), and a power-rest clears it.
- **Charge every pack after a game day**, and top up before the next one. A low pack quietly
  breaks Bluetooth re-pairing.
- **Headsets on USB.** Any 5 V USB source charges them. Check every headset before a game day.
- **Keep gun-and-headset pairs together.** Same sticker on both, stored together.

> **Warning: water.** Owners report guns usually survive a soaking after several days of drying
> with the battery out. Headsets usually do not. Treat the headset as the fragile half.

> **Warning: battery out before opening.** If you ever open the gun for a repair or a mod,
> unplug the pack first. Owners have lost mainboards working on a gun with a live pack
> connected.

**Wear items to watch:**

| Symptom | Part (as owners found it) | Owner fix |
|---|---|---|
| Reload handle stiff or binding | handle track friction | thin nylon washer under the handle; light silicone lube on the track |
| A D-pad button feels dead | cracked button plastic, a known wear failure | replace from Battle Company or a parts gun |
| Gun powers on/off by itself | worn power switch | contact cleaner helps for a while; switch replacement |
| No sound, but a "pop" at boot | loose or corrupt audio card | the speaker is fine; see Repairs |
| Shots never register on anyone | the IR emitter has died (they do) | replaceable part; see Repairs |

> **Tip.** Sound and firmware updates go through the micro-USB Programing Port with a
> SELECT-hold boot. The gun then shows up as a disk with an AUDIO folder. Keep a copy of the
> originals before you swap anything. The full procedure is in Firmware and Sounds.
