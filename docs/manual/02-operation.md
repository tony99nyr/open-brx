# 02 · Operating the BRX  (section slug: /manual/operate)
**Last verified:** 2026-08-27
**Audience:** anyone with stock BRX gear (a tagger, a headset, maybe a grenade and the Callsign app) who wants to charge it, set it up, and play today. No Open BRX software required. · **Goal of this section:** get you from "box on the table" to "a game running and understood". Every button hold, every LED and every voice line should mean something to you. Anything that needs a laptop, a cable, or the BLE protocol is pointed at the developer section, not explained here.
**Provenance legend:** ✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the Callsign APK · 👥 community-reported. Only confirmed facts are published; see Research backlog at the end.

> **Credits for this section.** Restated (never copied) from Battle Company's *BRX Manual V7* and the 2018 *BRX Extended User Guide*; the BRX owner community (the BRX Elite Owners group); Jay at **Extreme Laser Tag And More!** (grenade operation videos); and **LaserTagMods** (JEDGE/JBOX) for the protocol discovery that underpins the bench-verified items. Link the official PDFs. Do not rehost them.

## Pages

### Page: Quick Start  (`/manual/operate/quick-start`)
_From the box to your first "TARGET MODE" voice line in about fifteen minutes, plus a charge._

[hero] A tagger and a headset side by side, powered, headset dome lit. Short line: "Charge it, pair it, sight it, play." 📖 src: docs/reference/brx-manual-notes.md

[callout:info] What you are holding. The BRX is a rifle-style infrared tagger (Class 1, 980 nm IR "laser"). The wireless headset carries the hit sensors, and the gun has a sensor too. Out of the box it is a **non-scoring** system. The gun keeps no score and no clock, so scoring comes from the on-gun game or the phone app. 📖👥 src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, protocol/session-findings-2026-08.md §7n

[steps] "First power-on checklist"
1. **Charge the gun first.** Plug the two-cell 8.4 V smart charger into the round *charging* port. Do not use the micro-USB "Programing Port" next to it. The charger LED is red, then green when full. A full charge gives you roughly 8 h of play. The headset takes any USB 5 V supply. 📖
2. **Power on the gun** with the slide switch by the barrel. You should hear a startup sound. A "pop" from the speaker at boot means audio is alive. If it boots **silently**, you were holding SELECT. That is USB disk mode, so power off and try again. 📖👥
3. **Power on the headset.** Its LEDs cycle through colours ("rainbow") while it is unpaired, then settle. Pairing is automatic. It can take up to **3 minutes** when lots of taggers and Bluetooth devices are around. 📖✅
4. **Watch the headset settle.** A slow rainbow blink that never stops means it is not paired. Go to *Pairing the Headset*. Once paired it shows the gun's team colour. ✅
5. **Set indoor or outdoor mode** for where you will play (hold ALT 3 s). It changes IR range and LED brightness, and it sticks across power cycles. 📖
6. **Sight the laser** in target mode before your first real game (hold LEFT while powering on). 📖
7. **Pick a game on the gun** with LEFT/RIGHT, pull the trigger to select, then **pull the reload handle to start.** 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/experiment-log.md (2026-08-27 headset LED entry)

[cards] "The controls, in one glance"
- **Trigger**: fire. In menus it selects, and it cycles weapons or characters. 📖
- **ALT (orange)**: alt-fire or perk. Hold 3 s to toggle indoor/outdoor. In the menu it cycles perks. 📖
- **SELECT**: steps through settings. Hold it at power-on for USB disk mode (firmware and sounds). 📖
- **LEFT / RIGHT (D-pad)**: cycle modes and teams. Hold LEFT at power-on for target mode. Hold RIGHT at power-on for accessory/headset pairing. 📖👥
- **Reload handle**: reloads in play. **Pulling it starts an on-gun game.** 📖
- **Slide power switch**: by the barrel. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[callout:tip] Label each gun and its headset as a pair. Put a strip of tape or a sticker with the same mark on both. Stock taggers look identical and come unlabeled. A mixed-up pair is the number one reason for "my gun won't fire" at a party. 👥 src: docs/reference/community-notes.md, docs/field-process.md

[image OPS-01]

---

### Page: Charging & Batteries  (`/manual/operate/power`)
_Two ports on the gun, two kinds of charger, one polarity trap._

[spec-sheet] "Power at a glance"
- **Gun pack**: 7.4 V Li-ion, ~2200 mAh, two cells, 2-pin connector. 👥
- **Gun charger**: the supplied 8.4 V two-cell smart charger. The LED is red while charging and green when done. 📖
- **Run time**: roughly 8 h of play per full charge. 📖
- **Headset**: charges from any USB 5 V source. The v2 headset runs on a single 18650 cell. 📖👥
- **Fallback**: the gun can run on an optional 6×AA holder. Use **alkaline only, never rechargeable AAs.** 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

[callout:warn] Battery polarity is REVERSED from the usual convention. Replacing the pack, building spares, or wiring an external charger? Check polarity with a meter before you connect anything. A reversed pack risks damaging the tagger. Some aftermarket packs have a 3-pin connector, and the BRX ignores the third (thermistor) pin. 👥 src: docs/reference/community-notes.md

[callout:warn] Two ports, and you must not confuse them. The round charging port takes the charger. The micro-USB "Programing Port" next to it is only for firmware and sound updates (see *Firmware & Sounds*). It is not a charging input. 📖 src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[steps] "Swapping the gun battery"
1. Power off and unplug the charger. 📖
2. Remove the single screw near the reload switch to open the battery bay. 📖
3. Disconnect the old pack. Check the new pack's polarity against the old one before you plug it in. 👥
4. Close it up, power on, and listen for the startup sound. 📖
src: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

[callout:tip] Field practice from the owner community: keep a stack of charged spare packs and swap them in the field. That beats trying to top up a gun from a power bank. A spliced BRX AC adapter can charge packs outside the gun. 👥 src: docs/reference/community-notes.md

[callout:info] Low battery has a hidden cost. Below a certain charge the BRX firmware will not re-establish its Bluetooth link to a phone. If the app suddenly cannot reconnect late in a day of play, blame the battery before the phone. 👥✅ src: docs/reference/community-notes.md (SCREAMERS), docs/gotchas.md

[image OPS-02]

---

### Page: The On-Gun Menu  (`/manual/operate/on-gun-menu`)
_Everything you can set without a phone, and what the gun remembers._

[callout:info] The gun's LED tells you which mode is selected: **white** Free For All · **red** Death Match · **yellow** Generals · **blue** Supremacy · **pink** Commander · **green** Survival · **orange** The Swarm. During play the same LED shows ammo and health. 📖 src: docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

[steps] "Navigating the root menu"
1. Power on. You land at the root menu. LEFT / RIGHT cycle game modes and the LED colour changes with each one. **Trigger selects.** 📖
2. Pick your team or faction with the D-pad. Trigger cycles weapons (or characters in Supremacy). ALT cycles perks, but only in modes that have them. 📖
3. Press SELECT to step through the game variables: lives, game time, respawn, volume. The D-pad changes each value and SELECT moves you on. 📖
4. Pull the reload handle to start. Anything you changed becomes the new default for that mode. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[table] "Game variables on the gun"
| Setting | Values | Notes |
|---|---|---|
| Game time | Off · 5 · 10 · 15 · 20 · 30 min | 📖 |
| Respawn | Off · 15 · 30 · 60 s · Ramp 45 · Ramp 90 | "Ramp" grows the penalty with each death, up to the cap 📖👥 |
| Volume | 1 – 5 | 📖 |
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md (respawn delay ramps)

[callout:info] The gun remembers these variables **per game mode**, and they live on the gun. They are not the numbers the Callsign app uses. The app keeps its own clock and respawn timer on the phone, and it never writes these to the gun. 📖✅ src: docs/reference/brx-extended-user-guide.md, protocol/session-findings-2026-08.md §7n

[cards] "Button holds worth memorising"
- **ALT, hold 3 s**: toggle indoor / outdoor (it sticks). 📖
- **LEFT at power-on**: target mode, for sighting. 📖
- **RIGHT at power-on**: "install accessory" pairing mode (headset, grenade, sidearm and friends). 📖👥
- **SELECT at power-on**: USB disk mode. No startup sound. 📖
- **LEFT + RIGHT, hold 5 s in a game**: soft reset back to the menu. 📖
- **LEFT + RIGHT, hold 3 s at the root menu**: admin lock. It blocks mode changes and reset. Add SELECT for the stronger lock, which also freezes indoor/outdoor, weapon, team and perk. A locked gun cannot host. 👥
- **Swing your elbow (gesture-enabled "logo" guns)**: melee from the headset's front emitter. Other guns use RIGHT. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

[table] "Stock modes selectable on the gun"
| Mode | Teams | Weapons | Perks |
|---|---|---|---|
| Free For All | none, friendly fire on | M-4 · SMG-X3 · MG-7 · SR-100 | none |
| Team Death Match | Alpha / Bravo | + TAC-87 | Grenade Launcher · Med Kit · Concussion Grenade · Extended Mags · Body Armor |
| Supremacy | Resistance (red) / Vanguard (green) / Nexus (blue) | 9 characters are the loadout | per-character abilities |
| Survival | Human / Infected | M-4 · SMG-X3 · MG-7 · SR-100 · TAC-87 | none |
Generals, Commander and The Swarm show up on newer firmware as Callsign-Live unlocks. Full stats and abilities are in the *Game Modes & Weapons* section. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[diagram OPS-03]

---

### Page: Indoor vs Outdoor Mode  (`/manual/operate/indoor-outdoor`)
_One three-second hold changes your range, your LEDs and your blast radius._

[steps] "Switching modes"
1. Hold **ALT for 3 seconds** at any time. The gun announces the new mode. 📖
2. Leave it. The setting **persists across power cycles**, so you set it once per venue. 📖
3. Host from the Callsign app instead? Its per-game **Outdoor mode** toggle sets the same thing. ✅
4. Driving a gun from your own code? It is `$GSET` **token 2**, `outdoorMode`. A second field,
   token 3 `gunLaserRegion`, carries the IR power limit. Both are in the
   [developer reference](/manual/dev/gset-pset). 🔍
src: docs/reference/brx-extended-user-guide.md, docs/reference/callsign-ui.md, protocol/session-findings-2026-08.md §7g

[compare] "What changes"
| | Indoor | Outdoor |
|---|---|---|
| Green hit LEDs | dimmed 📖 | full brightness 📖 |
| RGB headset LEDs | enabled 📖 | (bright-sun visibility is poor on any headset) 👥 |
| Explosion / melee range | shrunk 📖 | full 📖 |
| Station / respawn-signal reach | shorter, because the forward IR projection scales with mode ✅ | ~18–20 ft to a respawn station ✅ |
| Gun hit radius | n/a | bright sunlight cuts it roughly in half (IR noise filtering) 📖 |
src: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/grenade.md

[callout:tip] Use indoor mode indoors, even in a big room. Full-power IR in a small space bounces off walls, and a bounce can land on your own headset. We have watched a gun drain its own armor by firing at a wall a few feet away. ✅ src: docs/gotchas.md (Capturing IR), docs/experiment-log.md

[image OPS-04]

---

### Page: Sighting the Laser  (`/manual/operate/sighting`)
_Target mode makes the gun harmless, tireless, and honest about where it points._

[steps] "Enter target mode"
1. Start with the gun off. Hold **LEFT** and slide the power on. Keep holding until you hear **"TARGET MODE"**. 📖
2. Check what the mode does: the gun is on the **yellow** team, does **0 damage**, and has **unlimited ammo**. The headset will not pair, and that is expected. 📖
3. Have a helper wear a powered headset at your sighting distance, or prop one up. A **direct hit flashes the headset green**. 📖
4. Adjust the scope or sight until the flash lands where the reticle says it should. 📖
5. Power-cycle the gun to leave target mode. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[table] "Sighting distances the community uses"
| Loadout | Sight at |
|---|---|
| General indoor play | ~20 ft 👥 |
| General outdoor play | ~300 ft 👥 |
| Sniper (SR-100 class) | 300–400 ft 👥 |
| Shotgun / SMG | 50–100 ft 👥 |
src: docs/reference/community-notes.md

[callout:info] Why bursts hit and mag-dumps miss: the BRX simulates recoil. Rapid fire drags your accuracy down toward each weapon's floor. A "miss" still flashes the target's headset and plays a zip sound, but it does **0 damage**. Fire in bursts and let your accuracy recover. 📖 src: docs/reference/brx-extended-user-guide.md

[image OPS-05]

---

### Page: Pairing the Headset  (`/manual/operate/headset-pairing`)
_The number one cause of "my gun won't fire", and the fix for it._

[callout:info] The headset is a separate radio device, and it carries most of the hit sensors. It pairs to one gun. A gun that boots **with** a headset and then loses it **locks its trigger until the headset returns** (anti-cheat). 📖 src: docs/reference/brx-manual-notes.md

[steps] "Normal pairing (every day)"
1. Turn the gun on, then the headset. The headset LEDs cycle rainbow while they search. 📖✅
2. Wait. Pairing can take up to **3 minutes** when lots of taggers and Bluetooth devices are around. 📖
3. Watch for the LEDs to settle to the gun's team colour. That means you are paired. ✅
src: docs/reference/brx-manual-notes.md, docs/experiment-log.md (2026-08-27 headset LED entry)

[table] "Reading the headset LEDs"
| Headset shows | It means | Confidence |
|---|---|---|
| Slow rainbow blink | **Not paired / disconnected.** The gun will not join a phone game, so re-pair before you start. | ✅ |
| Solid team colour (red / blue…) | Paired, in the menu or lobby. **Pre-game only.** | ✅ |
| Dark during play | Normal. The headset goes dark once a game starts. | ✅ |
src: docs/experiment-log.md (2026-08-27), docs/field-process.md, docs/gotchas.md

[steps] "Re-pairing a headset that has lost its gun (Gen-3 procedure)"
1. Turn the **headset** on. Its LEDs cycle colours. 👥
2. Press and **hold the small headset button**. Keep holding it through the whole procedure. 👥
3. Hold **RIGHT** on the D-pad while you slide the **gun** power on. 👥
4. Wait for the voice line **"PAIRING MODE"**. 👥
5. **Pull the trigger once.** You get "HEADSET CONNECTED" and the headset LEDs stop cycling. 👥
6. Pull the trigger a second time. It announces "device paired". Now release the headset button. 👥
src: docs/reference/community-notes.md (Gen-3 headset re-pair procedure, contributed to the BRX owner community; it is the procedure behind the "PAIRING MODE" voice line)

[accordion] "Alternative: 'install accessory' route": Boot the gun holding **RIGHT** ("install accessory"), power the headset, then press its button once. It is the same boot mode you use to pair a grenade or a sidearm. 📖👥 src: docs/reference/brx-extended-user-guide.md (accessory pairing), docs/reference/community-notes.md

[callout:warn] Firmware updates can un-pair everything. Owners report the v4.30 update wipes settings and breaks headset pairing until you re-run setup. Battle Company's own fix involved a temporary downgrade. Re-pair after any firmware update, before a game day. Details are in *Firmware & Sounds*. 👥 src: docs/reference/community-notes.md

[faq] "Headset troubleshooting"
- **The gun charges a weapon but nothing happens on the trigger.** That is the classic headset lockout. Look at the headset: rainbow means re-pair it. 👥✅
- **The phone app connects, then drops within a couple of seconds.** The app needs a paired headset and quietly disconnects without one. The gun is fine. Get the headset lit before you open the app. ✅ (src: protocol/session-findings-2026-08.md §7m)
- **Only some guns joined the phone game.** A gun whose headset is off or unpaired (slow rainbow) refuses to join, and gives no error. Eyeball every headset before you start. Before the game a paired headset shows team colour, and it only goes dark once play begins. ✅
- **It paired yesterday and not today.** That is the headset battery. It charges from any USB 5 V. 📖
src: docs/reference/community-notes.md, protocol/session-findings-2026-08.md §7m, docs/gotchas.md, docs/field-process.md

[image OPS-06]

---

### Page: The Grenade & Other Accessories  (`/manual/operate/accessories`)
_Pair a thrown grenade, or use it as a respawn point, a hill or a flag. No app needed._

[callout:info] Two different jobs, two different setups. A **thrown grenade** pairs to *your* gun, once. An **objective device** needs no pairing at all, because any gun talks to it over IR. That covers the respawn station, King of the Hill, Assault point and CTF flag. Do not use "install accessory" for objective modes. ✅📖 src: docs/reference/grenade.md, docs/reference/brx-extended-user-guide.md

[steps] "Pairing accessories to your gun (grenade, sidearm, hatchet, shield)"
1. Start with the gun off. Hold **RIGHT** and power on to reach "install accessory". 📖
2. Power on the accessory. It accepts a new pairing for **30 seconds** after power-up. 📖
3. **Aim the gun at it and pull the trigger.** The pairing code goes over IR, and the device flashes or chirps to confirm. 📖
4. Pair **every** accessory in the same session, without powering the gun off, then tap SELECT to finish. Adding a new accessory later means re-pairing all of them together. 📖
src: docs/reference/brx-extended-user-guide.md

[steps] "Throwing a paired grenade"
1. Check that your headset is on and paired. 📖
2. Press the grenade's top button near your headset to arm it. 👥
3. Throw it. On detonation everyone in range takes the blast. Land it on a hill or a respawn point and your team captures that point instantly, at full charge. 👥✅
Credit: Extreme Laser Tag And More! (grenade videos). src: docs/reference/grenade.md

[steps] "Setting an objective mode on the grenade"
1. Power the grenade **off, then on**, and wait for the **green** ready LED. ✅
2. **Hold the top button ~4 s** until you hear a long loud beep. You are now in setup. ✅
3. Keep holding. It beeps fast and **cycles colours**. Release on the colour you want. ✅
4. Watch the LED go **white** to confirm the lock. The mode survives power-cycling, and on every boot it flashes the current mode's colour for about a second. ✅
5. Repeat from step 1 to change the mode. ✅
src: docs/reference/grenade.md

[table] "Grenade mode colours"
| Colour | Mode | How it plays |
|---|---|---|
| Red | Frag | a plain blast grenade; throw it or trigger it with the button ✅ |
| Green | Assault | shoot it to capture it for your team; the LED turns your colour ✅ (owners call it finicky 👥) |
| Blue | Hill (King of the Hill) | starts neutral white; shoot to claim it; every shot adds charge and the other team must out-shoot it to take it back; guns announce "control point captured" ✅👥 |
| Yellow | Respawn station | starts neutral; shoot to claim it for a team; it then respawns that team's dead players ✅ |
| White | CTF flag | shoot to grab it; a tagger carrying the flag plays the CTF music 👥 |
src: docs/reference/grenade.md, docs/reference/community-notes.md

[steps] "Using a respawn station"
1. Set the grenade to **yellow**, put it at your base, and have one player from the team **shoot it**. It turns that team's colour. ✅
2. **Arm each tagger** before kickoff. Press the grenade button near each player. Or have each player face the station with the **front of the headset** and pull the trigger. A tagger that never gets the station signal just self-respawns as normal. ✅
3. Send dead players back to base to respawn. They **press the station button**, which respawns everyone of that team nearby. Or they **face it with the headset front and pull the trigger** (about 18–20 ft, less indoors). ✅
4. Expect the other team to overrun it. They shoot it or grenade it to flip its colour. ✅👥
5. Missed the arming step? Pressing the station button near a gun **during** the game forces it into station-respawn mode too. 👥
Credit: Extreme Laser Tag And More! for the mid-game arming path. src: docs/reference/grenade.md, docs/field-process.md

[callout:tip] A spare tagger left in accessory-setup mode is a free "announcer". It calls out the grenade's mode names as you cycle them. It also says "respawn point enabled" and a claim chime as the game runs. That is handy for setting up a field without staring at LED colours. ✅ src: docs/reference/grenade.md

[callout:info] Everything you *hear* from a grenade is really played by the guns and headsets. The explosion, the flashbang, the CTF music and the respawn chime are all their answer to its IR signal. The grenade itself only chirps and flashes. That is why custom sound packs on the gun change "grenade sounds" too. ✅ src: docs/reference/grenade.md

[faq] "Grenade quirks owners run into"
- **It can't show a winner.** Stock kit tallies hill and domination scoring nowhere, so a ref or host keeps score. 👥
- **The defending team captured their own Assault point.** That is a known quirk. Treat Assault as low-reliability. 👥✅
- **A grenade in the wrong mode triggered odd game reactions** (CTF music in a deathmatch, for example). Check the boot-flash colour before every game. 👥✅
- **The USB-C port is charge-only.** There is no drive, no console and no update path on that port. ✅
src: docs/reference/grenade.md, docs/reference/community-notes.md

[image OPS-07]

---

### Page: The Callsign App  (`/manual/operate/callsign-app`)
_Battle Company's official phone app: what it does, how you build a game, and the three things nobody tells you._

[callout:info] What the app is. Callsign turns a phone into the **game host**. It keeps the clock, the score and the respawn timer. It also pushes weapons and settings to the gun over Bluetooth. The gun enforces none of the rules. Take the phone out of Bluetooth range and nobody respawns, and the round never ends. ✅ src: protocol/session-findings-2026-08.md §7g, §7n

[stat-row]
- **~1 m**: keep the phone this close to its gun for the whole match. It is the game engine. ✅
- **~1 min**: the typical wait for a hosted game to show up as joinable on a second phone. It round-trips through the cloud. ✅
- **69 / 100**: the internal volume the app sets on the gun when it connects. ✅
- **Android ≤ 10**: owners report the app only works on older Android. iOS is fine. 👥
src: protocol/session-findings-2026-08.md §7g, §7b, docs/experiment-log.md, docs/reference/community-notes.md

[steps] "Building and starting a game"
1. Get the top-right connection icon **green ("connected")**. You cannot create a game until it is, and it will not go green without a **paired headset**. ✅
2. Tap **SELECT A GAME** and swipe the category carousel: Team Arena · Battle Royale · Battle Lines · Faction Wars · Infection. ✅
3. Tap **SELECT GAME MODE**. Under Team Arena, for example: Arena · Team Arena · Team Snipers · Capture the Flag. ✅
4. Fill in **GAME SETTINGS**: primary and secondary weapon, then the rules in the table below. Press **CREATE**. Some modes add a step for teams, starting health, or the players-remaining display. ✅
5. Wait in the **lobby** while other players join from their phones, pick weapons, and hit ready. On a single device, use **Start Offline Game**. ✅
6. Let the host launch. Every gun goes live together, and the in-game HUD shows health, shield, ammo and weapon. ✅
src: docs/reference/callsign-ui.md, protocol/session-findings-2026-08.md §7g, §7m, docs/experiment-log.md (2026-08-25 cap10/cap11)

[table] "Game settings the app exposes"
| Setting | Choices |
|---|---|
| Primary / Secondary weapon | ~18-weapon roster (Assault Rifle, Sniper, Shotgun, SMG, Rail Gun, Rocket Launcher…); secondary removable |
| Weapon respawn | 30 s · 60 s · 90 s · 3 min |
| Weapon pick-up | Scan · Player · Both |
| Weapon selection | on / off |
| Outdoor mode | on / off |
| Voice | Male · Female |
| Time | minutes |
| Score to win | a number |
| Respawn type | Scanner (respawn at a printed QR code) · Auto (timed) |
| Respawn time | seconds |
| Lives | a count, or Unlimited |
| Extra step (some modes) | Allow Teams / No Teams · Starting health Low/Medium/Full · Players remaining Show/Hide |
✅ src: docs/reference/callsign-ui.md, protocol/callsign-extract/apk-harvest.md

[callout:info] Field objectives in Callsign are **printed QR codes**. Respawn points, weapon pickups, control points and supply drops are all paper you scan or fire at, not boxes. 📖✅ src: protocol/callsign-extract/apk-harvest.md, docs/reference/brx-extended-user-guide.md

[callout:info] Volume. The app's whole global settings screen is one **Sound** slider. On connect it sets the gun to about 69 on its internal 0–100 scale. That is loud enough for weapon audio indoors and out. Anything much below 50 makes weapon sounds effectively silent, and we measured 30 as inaudible over room noise. ✅ src: docs/reference/callsign-ui.md, docs/experiment-log.md (finding 6), protocol/session-findings-2026-08.md §7b

[callout:warn] Gotcha 1: the app renames your gun. Every session Callsign writes the name **"Tactix2"** to the gun. Gave a gun a custom Bluetooth name with Open BRX tools? Opening Callsign on it silently resets that name. ✅ src: docs/gotchas.md, protocol/session-findings-2026-08.md §7b

[callout:warn] Gotcha 2: "the app is flaky" is almost always the headset. With no headset paired, the app connects to the gun and drops it about a second later. There is no message, and the icon simply never turns green. Nothing is intermittent. It works exactly when the headset happens to be linked. ✅ src: protocol/session-findings-2026-08.md §7m

[callout:warn] Gotcha 3: the firmware warning is soft. Newer guns show *"firmware v4.32 … supported until v2.01e"*. The gun is *ahead* of the app's list, not behind it, and games still run. Do not downgrade firmware to satisfy that message. ✅ src: docs/experiment-log.md (finding 3), protocol/session-findings-2026-08.md §7b

[callout:tip] The app shows player numbers as 1–64. The gun stores them 0–63. This only matters if you compare app numbers with developer tools. ✅ src: docs/experiment-log.md (2026-08-25 P2)

---

### Page: Running a Native Game on Stock Kit  (`/manual/operate/stock-game`)
_A walkthrough of a whole match, on-gun or app-hosted, and what every light and voice line means while it runs._

[steps] "Option A: a game hosted on the gun (no phone)"
1. Get every player set: gun on, headset on and settled, no rainbow. ✅📖
2. Have every player select the **same mode** with LEFT/RIGHT and pull the trigger. 📖
3. Pick your team with the D-pad, your weapon with the trigger, and your perk with ALT (Team Death Match only). 📖
4. Step through lives, time, respawn and volume with SELECT. Agree the values across all guns, because each gun runs its own clock. 📖✅
5. Count down together and **pull the reload handle** to start. 📖
6. Keep score by voice, by a ref, or by team flags. The guns do not tally kills. 👥✅
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, protocol/session-findings-2026-08.md §7n

[steps] "Option B: a game hosted from Callsign"
1. Get every player set: headset paired, phone mounted on the gun, app icon green. ✅
2. Have the host create the game while the others join and ready up. Allow a minute for the lobby. ✅
3. Let the host launch. Guns spawn together and HUDs light up. You do **not** need the reload handle to start. ✅
4. Die, and the app respawns you after the set respawn time, or at a QR scanner. ✅
5. Hit the time or score limit, and the app ends the game with a voice line and stops the guns. Scores live on the phones. ✅
src: protocol/session-findings-2026-08.md §7e, §7f, §7n, docs/reference/callsign-ui.md

[table] "During play: what you see and hear"
| Signal | Meaning |
|---|---|
| Gun LED | ammo and health indicator 📖 |
| Headset dark | normal during a game ✅ |
| Headset flashes, "zip" sound, no damage | a miss under the recoil-accuracy model 📖 |
| Headset lit with team colour mid-game | that gun is still in the lobby; it never entered the game ✅ |
| Headset slow rainbow | the headset dropped; that gun is locked until it re-pairs 📖✅ |
| Trigger only reloads / chirps | you are in a menu, the game has not started, or the gun is locked 📖✅ |
| "Dead / out of ammo" noise on trigger | you are dead and a respawn station is set up, so go to the station ✅ |
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/experiment-log.md (2026-08-27), docs/reference/grenade.md

[callout:info] Where hits land. The headset carries sensor domes front, left, right and back, and the gun has a sensor of its own. At field distances the dome that catches the shot is the one you were facing with. Point-blank, IR floods every receiver and any dome can report it. The damage is the same either way, because a dome hit is a hit. ✅ src: protocol/session-findings-2026-08.md §7r, docs/gotchas.md

[callout:info] Dead means dead. A tagger that is dead (out of health) ignores **all** incoming IR. It cannot take a hit, be healed, or be armed by a station until it respawns. ✅ src: docs/gotchas.md, docs/reference/grenade.md

[callout:warn] The "screamer", or what long powered sessions do. Owners widely report this in hosted or online play. After about an hour some guns fail with a **loud buzz** and need a reboot. They also report that a low battery stops Bluetooth re-pairing entirely. A game can cascade down to half its players. We reproduced the Bluetooth half on a gun left powered all day. The rules: power guns **off** between rounds, keep packs topped up, and reboot a buzzing gun instead of fighting it. 👥✅ src: docs/reference/community-notes.md (SCREAMERS), docs/gotchas.md, docs/experiment-log.md (2026-08-26 U6 parked)

[cards] "Owner-invented rulesets that need no extra gear"
- **Ribbon teams**: run everyone on one team with friendly fire on, and tell teams apart by a coloured ribbon on a clip. Swap ribbons on death for infection or team-swap modes. 👥
- **Respawn character**: Generals, Commanders and Swarm modes give one player a mobile respawn point. Teammates revive at them with the trigger. 📖
- **Ammo restock**: a grenade, a perk slot, or the respawn character can hand out ammo in limited-ammo games. 👥
src: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md

[diagram OPS-08]

---

### Page: Range & Line of Sight  (`/manual/operate/range`)
_What the numbers on the box mean once the sun comes out._

[stat-row]
- **~600 ft**: the rated maximum reach of the IR beam in daylight (Battle Company). 📖
- **~50 %**: how much bright direct sunlight shrinks the gun's hit radius. 📖
- **980 nm / 38 kHz**: the IR wavelength and carrier. It is a Class 1 device, safe for eyes. 📖
- **~18–20 ft**: how far a respawn station "hears" a headset-and-trigger request outdoors. ✅
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/grenade.md

[cards] "Line-of-sight rules of thumb"
- **IR is light.** It needs a clear path to a sensor dome. It does not go through people, walls or dense foliage. Shade and dusk **improve** range, and full noon sun cuts it. 📖
- **It bounces.** In small rooms and near walls a shot can reflect back onto your own headset. Use indoor mode indoors. ✅
- **The headset is the bigger target.** Head-height domes on four sides catch far more than the gun's own sensor, so snipers aim for the head. 👥
- **Close range is chaos.** Point-blank, every dome reports. At distance the facing dome reports. Neither changes the damage. ✅
- **Feedback fades in sun.** The headset's green hit LEDs are hard to read in direct sun, so long-range tags look like misses. Listen for the target's hit sound instead. 👥
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/gotchas.md, protocol/session-findings-2026-08.md §7r

[callout:info] Bluetooth range is not IR range. The phone hosting a game has to stay within Bluetooth reach of its gun. In practice that means mounted on it. IR shots still land at hundreds of feet. It is the *game logic* that stops working when the phone is out of range. ✅ src: protocol/session-findings-2026-08.md §7n

---

### Page: Care & Storage  (`/manual/operate/care`)
_Keep it charged, keep it dry, and turn it off between rounds._

[cards] "Between games"
- **Power off between rounds.** Guns left powered for many hours develop Bluetooth trouble ("screamers"), and a power-rest clears it. 👥✅
- **Charge every pack after a game day**, and top up before the next one. A low pack quietly breaks Bluetooth re-pairing. 👥
- **Headsets on USB.** Any 5 V USB source charges them. Check every headset before a game day. 📖
- **Keep gun-and-headset pairs together.** Same sticker on both, stored together. 👥
src: docs/reference/community-notes.md, docs/gotchas.md, docs/reference/brx-extended-user-guide.md

[callout:warn] Water. Owners report guns usually survive a soaking after several days of drying with the battery out. Headsets usually do not. Treat the headset as the fragile half. 👥 src: docs/reference/community-notes.md

[callout:warn] Battery out before opening. If you ever open the gun for a repair or a mod, unplug the pack first. Owners have lost mainboards working on a gun with a live pack connected. 👥 src: docs/reference/community-notes.md

[table] "Wear items to watch"
| Symptom | Part (as owners found it) | Owner fix |
|---|---|---|
| Reload handle stiff or binding | handle track friction | thin nylon washer under the handle; light silicone lube on the track 👥 |
| A D-pad button feels dead | cracked button plastic, a known wear failure | replace from Battle Company or a parts gun 👥 |
| Gun powers on/off by itself | worn power switch | contact cleaner helps for a while; switch replacement 👥 |
| No sound, but a "pop" at boot | loose or corrupt audio card | the speaker is fine; see *Repairs* 👥 |
| Shots never register on anyone | the IR emitter has died (they do) | replaceable part; see *Repairs* 👥📖 |
src: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md

[callout:tip] Sound and firmware updates go through the micro-USB Programing Port with a SELECT-hold boot. The gun then shows up as a disk with an `AUDIO` folder. Keep a copy of the originals before you swap anything. The full procedure is in *Firmware & Sounds*. 📖 src: docs/reference/brx-extended-user-guide.md

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| OPS-01 | Quick Start · hero | A real BRX tagger and its headset on a table, headset powered with domes lit, charger cable visible, shot slightly from above with the D-pad, ALT button and reload handle all readable. | REAL PHOTO | owner shoot | n/a (photograph: dark surface, single soft key light from the left, tagger at 3/4 angle, headset in front; no stickers or labels visible) |
| OPS-02 | Charging & Batteries · after the polarity warning | Close-up of the gun's two ports side by side, the round charging port and the micro-USB Programing Port, with the charger plugged into the correct one. | REAL PHOTO | owner shoot | n/a (macro, shallow depth of field, ports centred, charger LED visible; mask any serial sticker) |
| OPS-03 | The On-Gun Menu · after button holds | Diagram: the control cluster of a rifle-style tagger with seven callout leader lines to blank label plates (trigger, ALT, SELECT, LEFT, RIGHT, reload handle, power switch). | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a simplified line-art side view of a modern black rifle-style laser-tag tagger, drawn as a clean technical illustration; seven thin electric-blue leader lines run from the trigger, a small orange side button, a centre button, two directional buttons, a side reload lever and a rear power slider out to empty rounded rectangular plates at the edges, ready for overlaid labels. |
| OPS-04 | Indoor vs Outdoor · after the compare table | Split atmosphere image: on the left a dim indoor arena with soft blue LED glow on a headset silhouette, on the right an open field at dusk with a faint IR beam line reaching far. | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a vertical split composition: left, a dim indoor arena interior with a silhouetted black laser-tag headset with sensor domes glowing soft electric blue close to the camera; right, a wide open grassy field at dusk with a single faint straight beam of light travelling far into the distance toward a tiny amber point; a thin vertical seam divides the halves. |
| OPS-05 | Sighting the Laser · after the distance table | Diagram: a tagger on the left, a headset target on the right at distance, a straight beam between them, and a small green flash ring on the headset dome. | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a minimal technical diagram: a simplified black rifle-style laser-tag tagger in profile at the far left, a simplified black laser-tag headset with sensor domes at the far right, a perfectly straight thin electric-blue beam connecting muzzle to headset dome, a small concentric ring pulse where the beam meets the dome, and faint tick marks along the beam suggesting distance. |
| OPS-06 | Pairing the Headset · after the LED table | Three small headset states in a row (rainbow-cycling, solid team colour, dark) as a real photo strip of the actual headset. | REAL PHOTO | owner shoot | n/a (three tightly framed photos of the same headset at the same angle in a dim room: 1 cycling colours, 2 solid team colour, 3 dark/off during play; combined as a strip in HTML) |
| OPS-07 | The Grenade & Accessories · after the mode-colour table | The real grenade with its top button and LED, shot in five exposures showing red, green, blue, yellow and white LED states. | REAL PHOTO | owner shoot | n/a (grenade on a dark surface, same framing for all five; the LED colour is the only change; button clearly visible) |
| OPS-08 | Running a Native Game · end of page | Diagram: a match timeline as a horizontal band (lobby, start, play with hit/kill ticks, death and respawn gap, end) in colour and shape only, with labels overlaid later. | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; wide 21:9 banner. Subject: an abstract horizontal timeline band: a thin electric-blue line runs left to right; a small hollow circle near the start, a solid circle marking the start, a run of tiny upward tick marks, one amber gap in the line with a dotted bridge over it, more ticks, and a solid end cap; small empty rounded label plates float above five points, ready for overlaid text. |
| OPS-09 | Range & Line of Sight · hero | Atmosphere: a player silhouette with a headset at long range across a field under harsh midday sun versus the same scene in shade, hinting at IR reach. | GENERATE | n/a | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a wide low-angle field at the edge of a treeline; a distant human silhouette wearing a black laser-tag headset with small sensor domes stands half in harsh amber sunlight and half in cool blue shade; a faint thin beam of light reaches toward the silhouette from the camera's position and fades where the sunlight is strongest. |
| OPS-10 | Care & Storage · after the wear table | Real photo of a gun's battery bay open with the pack and its 2-pin connector visible, showing the single screw. | REAL PHOTO | owner shoot | n/a (bay open, pack lifted slightly so the connector and its two wires are visible; no polarity marking added in-camera, since the overlay will annotate) |

## Interactive ideas (optional, ≤5)
1. **LED decoder**: tap a headset state (rainbow / team colour / dark) or a gun LED colour and get the one-line meaning plus "what to do". It doubles as a pre-game checklist ("no rainbow before you start").
2. **Button-hold cheat sheet**: a tagger outline. Hover or tap a control to see its tap, hold and power-on-hold actions (ALT 3 s, LEFT at boot, RIGHT at boot, SELECT at boot, L+R 5 s).
3. **"Won't fire" troubleshooter**: a four-question flow (headset rainbow? can you select a weapon before starting? app icon green? battery?) that lands you on the right fix page.
4. **Match planner**: pick on-gun or app hosting and it prints the exact pre-game checklist for that path (headsets settled, same mode on every gun, reload-handle start or host launch).

## Sources used
- `docs/reference/brx-manual-notes.md`: Battle Company *BRX Manual V7* (link: https://battlecompany.com/wp-content/uploads/2021/01/BRX_Manual_V7_FINAL.pdf): controls, charging, on-gun flow, headset lockout, target mode, modes/settings ranges.
- `docs/reference/brx-extended-user-guide.md`: Battle Company / Laser Tag Pro *BRX Extended User Guide* (2018): accessory pairing, on-gun variables, indoor/outdoor effects, reset, admin lock, melee gesture, IR specs, charger and battery details, recoil-accuracy model, mode LED colours.
- `docs/reference/community-notes.md`: BRX Elite Owners group: Gen-3 re-pair, won't-fire ladder, battery polarity, SCREAMERS, Android ≤10, wear items, water survival, sighting distances, ribbon-team rules.
- `docs/reference/grenade.md`: grenade modes and station operation (Extreme Laser Tag And More! videos, hardware-confirmed on our bench).
- `docs/reference/callsign-ui.md`: Callsign app screens and settings (owner screenshots, restated).
- `protocol/callsign-extract/apk-harvest.md`: Callsign mode list, QR-code objectives, lobby architecture.
- `protocol/session-findings-2026-08.md` §7b, §7e, §7g, §7h, §7m, §7n, §7r: app connect ritual (volume 69, name write), headset gate, gun-holds-no-state, sensor map.
- `docs/gotchas.md`, `docs/field-process.md`: headset eyeball check, screamer power-rest rule, name-reset gotcha, IR bounce.
- `docs/experiment-log.md`: 2026-08-23 finding 3 (soft version gate) and 6 (30 inaudible / app 69); 2026-08-25 P2 (player id 1–64 vs 0–63); 2026-08-26 U6 (screamer reproduced); 2026-08-27 headset LED observations.

## Research backlog (held, NOT published)
Nothing below appears on the site. Each item moves up into a page block only when a source settles it.
- **Top on-gun Lives step: 15 or 25.** *BRX Manual V7* lists ∞/1/3/5/10/**15**; the *Extended User Guide* lists 1/3/5/10/**25**/Unlimited. Whole Lives row removed from the "Game variables on the gun" table until confirmed per firmware. src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md
- **Gun charge time: 2 h or 2–4 h.** V7 manual says ~2 h; Extended Guide says 2–4 h. Number removed from Quick Start step 1 and the "Power at a glance" sheet (the ~8 h run time both agree on is kept). src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md
- **Headset green blink / hold = hit / kill, and whose.** Seen on the bench, but not yet pinned whether it is the wearer's hit/kill or the wearer being hit. Rows removed from "Reading the headset LEDs" and "During play"; OPS-06 trimmed from four states to three; LED-decoder idea trimmed. One clean two-player session will settle it. src: docs/experiment-log.md (2026-08-27 headset LED entry)
- **On-gun volume 1–5 → internal 0–100 mapping.** The 60/70/80/90/100 mapping is a field estimate, not a measurement. Removed from the game-variables table and the Callsign stat-row; "Volume translator" interactive idea dropped. The 1–5 range itself (📖) and the app's 69 (✅) stay. src: docs/experiment-log.md (on-gun volume estimate), protocol/session-findings-2026-08.md §7b
- **"Install accessory" boot = RIGHT vs RIGHT+SELECT.** Owners report RIGHT+SELECT; the Extended User Guide says RIGHT alone. Published RIGHT only (📖); the RIGHT+SELECT variant is held. src: docs/reference/community-notes.md (Re-pair headset), docs/reference/brx-extended-user-guide.md (accessory pairing)
- **Headset pairing "usually takes seconds".** Not in any source. Only the "up to 3 minutes with many taggers/BT devices" figure is official; removed from Quick Start step 3 and the Normal pairing steps. src: docs/reference/brx-manual-notes.md (Headset)
- **Firing with no headset at boot.** V7 manual: a gun booted with no headset shoots without one. Owners: post-2018 firmware stops firing whenever the headset is off. Clause removed from the Pairing page callout; only the lock-on-loss behaviour (both agree) is published. Collecting firmware-version/behaviour pairs. src: docs/reference/brx-manual-notes.md, docs/reference/community-notes.md
- **Respawn station arming.** Does the passive station beacon arm a gun by itself, or only the button press / headset-and-trigger? Does a gun armed mid-game stay in station mode for the rest of the match? Owner-reported, not bench-confirmed (the mid-game button-press arming step is published as 👥). src: docs/reference/grenade.md
- **The screamer's root cause.** Bluetooth-refuses-to-hold reproduced after a full day powered; the "loud buzz" failure and the exact battery threshold are owner reports only. src: docs/reference/community-notes.md (SCREAMERS), docs/experiment-log.md (2026-08-26 U6)
- **Callsign on current Android.** The ≤ Android 10 limit is published as 👥; what breaks and whether a workaround exists is uncharacterised. src: docs/reference/community-notes.md
- **The gun ↔ headset radio.** The headset syncs team colour from the gun, so the link carries game state; never characterised, not driven. src: docs/experiment-log.md (2026-08-27)
