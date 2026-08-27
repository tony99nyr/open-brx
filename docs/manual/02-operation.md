# 02 · Operating the BRX  (section slug: /manual/operate)
**Last verified:** 2026-08-27
**Audience:** a new or returning BRX owner with stock kit — tagger, headset, maybe a grenade and the Callsign app — who wants to charge it, set it up, and run a game today. No Open BRX software required. · **Goal of this section:** get from "box on the table" to "a game running and understood", and make every button-hold, LED and voice line on the stock kit mean something. Anything that needs a laptop, a cable, or the BLE protocol is pointed at the developer section, not explained here.
**Provenance legend:** ✅ verified on our bench · 📖 official Battle Company docs · 🔍 decoded from the Callsign APK · 👥 community-reported — only confirmed facts are published; see Research backlog at the end.

> **Credits for this section.** Restated (never copied) from Battle Company's *BRX Manual V7* and the 2018 *BRX Extended User Guide*; the BRX owner community (the BRX Elite Owners group); Jay at **Extreme Laser Tag And More!** (grenade operation videos); and **LaserTagMods** (JEDGE/JBOX) for the protocol discovery that underpins the bench-verified items. Link the official PDFs — do not rehost them.

## Pages

### Page: Quick Start  (`/manual/operate/quick-start`)
_From the box to the first "TARGET MODE" voice line in about fifteen minutes (plus a charge)._

[hero] A tagger and a headset side by side, powered, headset dome lit. Short line: "Charge it, pair it, sight it, play." 📖 src: docs/reference/brx-manual-notes.md

[callout:info] What you are holding — the BRX is a rifle-style infrared tagger (Class 1, 980 nm IR "laser") with a wireless headset that carries the hit sensors. The gun has its own hit sensor too. Out of the box it is a **non-scoring** system: the gun keeps no score and no clock, so scoring comes from the on-gun game or the phone app. 📖👥 src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, protocol/brx-protocol.md §7n

[steps] "First power-on checklist"
1. **Charge first.** Gun: plug the two-cell 8.4 V smart charger into the *charging* port (not the micro-USB "Programing Port" beside it). Charger LED red → green when full; a full charge gives roughly 8 h of play. Headset: any USB 5 V supply. 📖
2. **Power on the gun** with the slide switch by the barrel. You should hear a startup sound; a "pop" from the speaker at boot means audio is alive. If it boots **silently**, you were holding SELECT — that is USB disk mode; power off and try again. 📖👥
3. **Power on the headset.** Its LEDs cycle through colours ("rainbow") while it is unpaired, then settle. Pairing is automatic; it can take up to **3 minutes** with many taggers and Bluetooth devices around. 📖✅
4. **Watch the headset settle.** A slow rainbow blink that never stops = not paired — see *Pairing the Headset*. Once paired it shows the gun's team colour. ✅
5. **Set indoor or outdoor mode** (hold ALT 3 s) for where you will play — it changes IR range and LED brightness and persists across power cycles. 📖
6. **Sight the laser** in target mode before the first real game (hold LEFT while powering on). 📖
7. **Pick a game on the gun** with LEFT/RIGHT, pull the trigger to select, and **pull the reload handle to start.** 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/experiment-log.md (2026-08-27 headset LED entry)

[cards] "The controls, in one glance"
- **Trigger** — fire; in menus, *select* / cycle weapons or characters. 📖
- **ALT (orange)** — alt-fire / perk; hold 3 s = indoor/outdoor toggle; cycles perks in the menu. 📖
- **SELECT** — advances through settings; hold at power-on = USB disk mode (firmware/sounds). 📖
- **LEFT / RIGHT (D-pad)** — cycle modes and teams; hold LEFT at power-on = target mode; hold RIGHT at power-on = accessory/headset pairing. 📖👥
- **Reload handle** — reload in play; **pulling it starts an on-gun game**. 📖
- **Slide power switch** — by the barrel. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[callout:tip] Label each gun and its headset as a pair — a strip of tape or a sticker with the same mark on both. Stock taggers are identical and unlabeled, and a mixed-up pair is the most common reason "my gun won't fire" at a party. 👥 src: docs/reference/community-notes.md, docs/field-process.md

[image OPS-01]

---

### Page: Charging & Batteries  (`/manual/operate/power`)
_Two ports on the gun, two kinds of charger, one polarity trap._

[spec-sheet] "Power at a glance"
- **Gun pack:** 7.4 V Li-ion, ~2200 mAh, two cells, 2-pin connector. 👥
- **Gun charger:** the supplied 8.4 V two-cell smart charger; LED red while charging, green when done. 📖
- **Run time:** roughly 8 h of play per full charge. 📖
- **Headset:** charges from any USB 5 V source; the v2 headset runs on a single 18650 cell. 📖👥
- **Fallback:** the gun can run on an optional 6×AA holder — **alkaline only, never rechargeable AAs.** 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

[callout:warn] Battery polarity is REVERSED from the usual convention. If you ever replace the pack, build spares, or wire an external charger, verify polarity with a meter before connecting — a reversed pack risks damaging the tagger. Some aftermarket packs have a 3-pin connector; the BRX ignores the third (thermistor) pin. 👥 src: docs/reference/community-notes.md

[callout:warn] Two ports, do not confuse them. The round charging port takes the charger. The micro-USB "Programing Port" next to it is for firmware and sound updates only (see *Firmware & Sounds*) — it is not a charging input. 📖 src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[steps] "Swapping the gun battery"
1. Power off and unplug the charger. 📖
2. Remove the single screw near the reload switch to open the battery bay. 📖
3. Disconnect the old pack; check the new pack's polarity against the old one before plugging in. 👥
4. Close up, power on, listen for the startup sound. 📖
src: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

[callout:tip] Field practice from the owner community: keep a stack of charged spare packs and swap in the field instead of trying to top up a gun from a power bank. A spliced BRX AC adapter can charge packs outside the gun. 👥 src: docs/reference/community-notes.md

[callout:info] Low battery has a hidden cost: below a certain charge the BRX firmware will not re-establish its Bluetooth link to a phone. If the app suddenly cannot reconnect late in a day of play, suspect the battery before the phone. 👥✅ src: docs/reference/community-notes.md (SCREAMERS), docs/gotchas.md

[image OPS-02]

---

### Page: The On-Gun Menu  (`/manual/operate/on-gun-menu`)
_Everything you can set without a phone — and what the gun remembers._

[callout:info] The gun's LED tells you which mode is selected: **white** Free For All · **red** Death Match · **yellow** Generals · **blue** Supremacy · **pink** Commander · **green** Survival · **orange** The Swarm. During play the same LED indicates ammo and health. 📖 src: docs/reference/brx-extended-user-guide.md, docs/reference/brx-manual-notes.md

[steps] "Navigating the root menu"
1. Power on → you are at the root menu. LEFT / RIGHT cycle game modes; the LED colour changes with each. **Trigger selects.** 📖
2. D-pad picks your team or faction. Trigger cycles weapons (or characters in Supremacy). ALT cycles perks — only in modes that have them. 📖
3. Press SELECT to step through the game variables: lives, game time, respawn, volume. D-pad changes each value; SELECT advances. 📖
4. Pull the reload handle to start. Settings you changed become the new defaults for that mode. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[table] "Game variables on the gun"
| Setting | Values | Notes |
|---|---|---|
| Game time | Off · 5 · 10 · 15 · 20 · 30 min | 📖 |
| Respawn | Off · 15 · 30 · 60 s · Ramp 45 · Ramp 90 | "Ramp" grows the penalty with each death, up to the cap 📖👥 |
| Volume | 1 – 5 | 📖 |
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md (respawn delay ramps)

[callout:info] These variables are remembered **per game mode** and live on the gun. They are not the same numbers the Callsign app uses — the app keeps its own clock and respawn timer on the phone and never writes these to the gun. 📖✅ src: docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7n

[cards] "Button holds worth memorising"
- **ALT, hold 3 s** — toggle indoor / outdoor (persists). 📖
- **LEFT at power-on** — target mode for sighting. 📖
- **RIGHT at power-on** — "install accessory" pairing mode (headset, grenade, sidearm…). 📖👥
- **SELECT at power-on** — USB disk mode; no startup sound. 📖
- **LEFT + RIGHT, hold 5 s in a game** — soft reset back to the menu. 📖
- **LEFT + RIGHT, hold 3 s at the root menu** — admin lock (blocks mode changes and reset); add SELECT for the stronger lock that also freezes indoor/outdoor, weapon, team and perk. A locked gun cannot host. 👥
- **Swing your elbow (gesture-enabled "logo" guns)** — melee from the headset's front emitter; other guns use RIGHT. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

[table] "Stock modes selectable on the gun"
| Mode | Teams | Weapons | Perks |
|---|---|---|---|
| Free For All | none, friendly fire on | M-4 · SMG-X3 · MG-7 · SR-100 | — |
| Team Death Match | Alpha / Bravo | + TAC-87 | Grenade Launcher · Med Kit · Concussion Grenade · Extended Mags · Body Armor |
| Supremacy | Resistance (red) / Vanguard (green) / Nexus (blue) | 9 characters are the loadout | per-character abilities |
| Survival | Human / Infected | M-4 · SMG-X3 · MG-7 · SR-100 · TAC-87 | — |
Generals, Commander and The Swarm appear on newer firmware as Callsign-Live unlocks. Full stats and abilities are in the *Game Modes & Weapons* section. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[diagram OPS-03]

---

### Page: Indoor vs Outdoor Mode  (`/manual/operate/indoor-outdoor`)
_One three-second hold that changes range, LEDs and blast radius._

[steps] "Switching modes"
1. Hold **ALT for 3 seconds** at any time; the gun announces the new mode. 📖
2. The setting **persists across power cycles** — set it once per venue. 📖
3. If you host from the Callsign app, its per-game **Outdoor mode** toggle sets the same thing. ✅
src: docs/reference/brx-extended-user-guide.md, docs/reference/callsign-ui.md, protocol/brx-protocol.md §7g

[compare] "What changes"
| | Indoor | Outdoor |
|---|---|---|
| Green hit LEDs | dimmed 📖 | full brightness 📖 |
| RGB headset LEDs | enabled 📖 | (bright-sun visibility is poor on any headset) 👥 |
| Explosion / melee range | shrunk 📖 | full 📖 |
| Station / respawn-signal reach | shorter — the forward IR projection scales with mode ✅ | ~18–20 ft to a respawn station ✅ |
| Gun hit radius | — | bright sunlight cuts it roughly in half (IR noise filtering) 📖 |
src: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/grenade.md

[callout:tip] Use indoor mode indoors even if the room is big. Full-power IR in a small space bounces off walls, and a bounce can register on your own headset — we have watched a gun drain its own armor firing at a wall a few feet away. ✅ src: docs/gotchas.md (Capturing IR), docs/experiment-log.md

[image OPS-04]

---

### Page: Sighting the Laser  (`/manual/operate/sighting`)
_Target mode makes the gun harmless, tireless, and honest about where it is pointing._

[steps] "Enter target mode"
1. Gun off. Hold **LEFT** and slide the power on; keep holding until you hear **"TARGET MODE"**. 📖
2. In this mode the gun is on the **yellow** team, does **0 damage**, and has **unlimited ammo**. The headset will not pair — that is expected. 📖
3. Have a helper wear a powered headset (or prop one up) at your sighting distance. A **direct hit flashes the headset green**. 📖
4. Adjust the scope or sight until the flash lands where the reticle says. 📖
5. Power-cycle to leave target mode. 📖
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

[table] "Sighting distances the community uses"
| Loadout | Sight at |
|---|---|
| General indoor play | ~20 ft 👥 |
| General outdoor play | ~300 ft 👥 |
| Sniper (SR-100 class) | 300–400 ft 👥 |
| Shotgun / SMG | 50–100 ft 👥 |
src: docs/reference/community-notes.md

[callout:info] Why bursts hit and mag-dumps miss — the BRX simulates recoil. Rapid fire drifts accuracy down toward each weapon's floor; a "miss" still makes the target's headset flash and play a zip sound, but does **0 damage**. Fire in bursts and let the accuracy recover. 📖 src: docs/reference/brx-extended-user-guide.md

[image OPS-05]

---

### Page: Pairing the Headset  (`/manual/operate/headset-pairing`)
_The single most common cause of "my gun won't fire" — and the fix for it._

[callout:info] The headset is a separate radio device that carries most of the hit sensors. It pairs to one gun. A gun that boots **with** a headset and then loses it **locks its trigger until the headset returns** (anti-cheat). 📖 src: docs/reference/brx-manual-notes.md

[steps] "Normal pairing (every day)"
1. Gun on, then headset on. The headset LEDs cycle rainbow while searching. 📖✅
2. Wait. Pairing can take up to **3 minutes** with many taggers and Bluetooth devices around. 📖
3. When the LEDs settle to the gun's team colour, you are paired. ✅
src: docs/reference/brx-manual-notes.md, docs/experiment-log.md (2026-08-27 headset LED entry)

[table] "Reading the headset LEDs"
| Headset shows | It means | Confidence |
|---|---|---|
| Slow rainbow blink | **Not paired / disconnected.** The gun will not join a phone game — re-pair before you start. | ✅ |
| Solid team colour (red / blue…) | Paired, in the menu or lobby — **pre-game only**. | ✅ |
| Dark during play | Normal. The headset goes dark once a game starts. | ✅ |
src: docs/experiment-log.md (2026-08-27), docs/field-process.md, docs/gotchas.md

[steps] "Re-pairing a headset that has lost its gun (Gen-3 procedure)"
1. Turn the **headset** on; LEDs cycle colours. 👥
2. Press and **hold the small headset button** — keep holding through the whole procedure. 👥
3. On the **gun**: hold **RIGHT** on the D-pad while sliding the power on. 👥
4. Wait for the voice line **"PAIRING MODE"**. 👥
5. **Pull the trigger once** → "HEADSET CONNECTED"; the headset LEDs stop cycling. 👥
6. A second trigger pull announces "device paired". Release the headset button. 👥
src: docs/reference/community-notes.md (Gen-3 headset re-pair procedure — contributed to the BRX owner community; it is the procedure behind the "PAIRING MODE" voice line)

[accordion] "Alternative: 'install accessory' route" — Boot the gun holding **RIGHT** ("install accessory"), power the headset, press its button once. Same boot mode as pairing a grenade or sidearm. 📖👥 src: docs/reference/brx-extended-user-guide.md (accessory pairing), docs/reference/community-notes.md

[callout:warn] Firmware updates can un-pair everything. Owners report the v4.30 update wipes settings and breaks headset pairing until you re-run setup; Battle Company's own fix involved a temporary downgrade. Re-pair after any firmware update before a game day. Details in *Firmware & Sounds*. 👥 src: docs/reference/community-notes.md

[faq] "Headset troubleshooting"
- **The gun charges a weapon but nothing happens on the trigger.** Classic headset-lockout symptom. Look at the headset: rainbow = re-pair it. 👥✅
- **The phone app connects, then drops within a couple of seconds.** The app requires a paired headset and silently disconnects without one — the gun is fine. Get the headset lit before opening the app. ✅ (src: protocol/brx-protocol.md §7m)
- **Only some guns joined the phone game.** A gun whose headset is powered off or unpaired (slow rainbow) refuses to join with no error. Eyeball every headset before you start — before the game a paired headset shows team colour; it only goes dark once play begins. ✅
- **It paired yesterday and not today.** Headset battery. It charges from any USB 5 V. 📖
src: docs/reference/community-notes.md, protocol/brx-protocol.md §7m, docs/gotchas.md, docs/field-process.md

[image OPS-06]

---

### Page: The Grenade & Other Accessories  (`/manual/operate/accessories`)
_Pairing a thrown grenade, and using it as a respawn point, hill or flag — no app needed._

[callout:info] Two different jobs, two different setups. **Thrown grenade** = pair it to *your* gun (once). **Objective device** (respawn station, King of the Hill, Assault point, CTF flag) = no pairing at all; any gun interacts with it over IR. Do not "install accessory" for objective modes. ✅📖 src: docs/reference/grenade.md, docs/reference/brx-extended-user-guide.md

[steps] "Pairing accessories to your gun (grenade, sidearm, hatchet, shield)"
1. Gun off. Hold **RIGHT** and power on → "install accessory". 📖
2. Power on the accessory. It accepts a new pairing for **30 seconds** after power-up. 📖
3. **Aim the gun at it and pull the trigger** — the pairing code goes over IR; the device flashes or chirps to confirm. 📖
4. Pair **every** accessory in the same session without powering the gun off, then tap SELECT to finish. Adding a new accessory later means re-pairing all of them together. 📖
src: docs/reference/brx-extended-user-guide.md

[steps] "Throwing a paired grenade"
1. Your headset must be on and paired. 📖
2. Press the grenade's top button near your headset → it arms. 👥
3. Throw. On detonation everyone in range takes the blast; landing it on a hill or respawn point instantly captures the point at full charge for your team. 👥✅
Credit: Extreme Laser Tag And More! (grenade videos). src: docs/reference/grenade.md

[steps] "Setting an objective mode on the grenade"
1. Power the grenade **off, then on**; wait for the **green** ready LED. ✅
2. **Hold the top button ~4 s** until a long loud beep — you are in setup. ✅
3. Keep holding: it beeps rapidly and **cycles colours**. Release on the colour you want. ✅
4. The LED goes **white** to confirm the lock. The mode survives power-cycling; on every boot it flashes the current mode's colour for about a second. ✅
5. To change mode, repeat from step 1. ✅
src: docs/reference/grenade.md

[table] "Grenade mode colours"
| Colour | Mode | How it plays |
|---|---|---|
| Red | Frag | plain blast grenade — throw or button-trigger ✅ |
| Green | Assault | shoot it to capture for your team; LED turns your colour ✅ (owners call it finicky 👥) |
| Blue | Hill (King of the Hill) | starts neutral white; shoot to claim; every shot adds charge and the other team must out-shoot it to retake; guns announce "control point captured" ✅👥 |
| Yellow | Respawn station | starts neutral; shoot to claim for a team; then respawns that team's dead players ✅ |
| White | CTF flag | shoot to grab; a tagger carrying the flag plays the CTF music 👥 |
src: docs/reference/grenade.md, docs/reference/community-notes.md

[steps] "Using a respawn station"
1. Set the grenade to **yellow**, place it at base, and have one player from the team **shoot it** — it turns that team's colour. ✅
2. **Arm each tagger** before kickoff: press the grenade button near each player, or have each player face the station with the **front of the headset** and pull the trigger. A tagger that never receives the station signal will just self-respawn as normal. ✅
3. Dead players return to base and respawn either by **pressing the station button** (everyone of that team nearby) or by **facing it with the headset front and pulling the trigger** (about 18–20 ft, less indoors). ✅
4. The other team can overrun it — shoot or grenade it to flip its colour. ✅👥
5. Missed the arming step? Pressing the station button near a gun **during** the game forces it into station-respawn mode too. 👥
Credit: Extreme Laser Tag And More! for the mid-game arming path. src: docs/reference/grenade.md, docs/field-process.md

[callout:tip] A spare tagger left in accessory-setup mode is a free "announcer": it calls out the grenade's mode names as you cycle and says "respawn point enabled" and a claim chime as the game runs. Handy for setting up a field without staring at LED colours. ✅ src: docs/reference/grenade.md

[callout:info] Everything you *hear* from a grenade — the explosion, the flashbang, the CTF music, the respawn chime — is actually played by the guns and headsets in response to its IR signal. The grenade itself only chirps and flashes. That is why custom sound packs on the gun change "grenade sounds" too. ✅ src: docs/reference/grenade.md

[faq] "Grenade quirks owners run into"
- **It can't show a winner.** Hill/domination scoring is not tallied anywhere on stock kit — a ref or host keeps score. 👥
- **The defending team captured their own Assault point.** A known quirk; treat Assault as low-reliability. 👥✅
- **A grenade in the wrong mode triggered odd game reactions** (e.g. CTF music in a deathmatch). Check the boot-flash colour before every game. 👥✅
- **The USB-C port is charge-only.** There is no drive, no console, no update path on that port. ✅
src: docs/reference/grenade.md, docs/reference/community-notes.md

[image OPS-07]

---

### Page: The Callsign App  (`/manual/operate/callsign-app`)
_Battle Company's official phone app: what it actually does, how a game is built, and the three things nobody tells you._

[callout:info] What the app is. Callsign turns a phone into the **game host**: it keeps the clock, the score and the respawn timer, and pushes weapons and settings to the gun over Bluetooth. The gun enforces none of the rules — take the phone out of Bluetooth range and nobody respawns and the round never ends. ✅ src: protocol/brx-protocol.md §7g, §7n

[stat-row]
- **~1 m** — keep the phone this close to its gun for the whole match; it is the game engine. ✅
- **~1 min** — typical wait for a hosted game to appear as joinable on a second phone (it round-trips through the cloud). ✅
- **69 / 100** — the internal volume the app sets on the gun when it connects. ✅
- **Android ≤ 10** — owners report the app only works on older Android; iOS is fine. 👥
src: protocol/brx-protocol.md §7g, §7b, docs/experiment-log.md, docs/reference/community-notes.md

[steps] "Building and starting a game"
1. Get the top-right connection icon **green ("connected")**. You cannot create a game until it is — and it will not go green without a **paired headset**. ✅
2. **SELECT A GAME** — swipe the category carousel: Team Arena · Battle Royale · Battle Lines · Faction Wars · Infection. ✅
3. **SELECT GAME MODE** — e.g. under Team Arena: Arena · Team Arena · Team Snipers · Capture the Flag. ✅
4. **GAME SETTINGS** — primary and secondary weapon, then the rules (table below). Press **CREATE**. Some modes add a step for teams / starting health / players-remaining display. ✅
5. **Lobby** — other players join from their phones, pick weapons, and hit ready. Single device? Use **Start Offline Game**. ✅
6. **Host launches** — every gun goes live together, and the in-game HUD shows health, shield, ammo and weapon. ✅
src: docs/reference/callsign-ui.md, protocol/brx-protocol.md §7g, §7m, docs/experiment-log.md (2026-08-25 cap10/cap11)

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

[callout:info] Field objectives in Callsign are **printed QR codes** — respawn points, weapon pickups, control points and supply drops are all paper you scan or fire at, not boxes. 📖✅ src: protocol/callsign-extract/apk-harvest.md, docs/reference/brx-extended-user-guide.md

[callout:info] Volume. The app's entire global settings screen is one **Sound** slider. On connect it sets the gun to about 69 on its internal 0–100 scale — loud enough for weapon audio indoors and out. Anything much below 50 makes weapon sounds effectively silent; we measured 30 as inaudible over room noise. ✅ src: docs/reference/callsign-ui.md, docs/experiment-log.md (finding 6), protocol/brx-protocol.md §7b

[callout:warn] Gotcha 1 — the app renames your gun. Every session Callsign writes the name **"Tactix2"** to the gun. If you have given a gun a custom Bluetooth name with Open BRX tools, opening Callsign on it silently resets that name. ✅ src: docs/gotchas.md, protocol/brx-protocol.md §7b

[callout:warn] Gotcha 2 — "app is flaky" is almost always the headset. With no headset paired the app connects to the gun and drops it about a second later with no message; the icon simply never turns green. Nothing is intermittent — it works exactly when the headset happens to be linked. ✅ src: protocol/brx-protocol.md §7m

[callout:warn] Gotcha 3 — the firmware warning is soft. Newer guns show *"firmware v4.32 … supported until v2.01e"*. The gun is *ahead* of the app's list, not behind it, and games still run. Do not downgrade firmware to satisfy the message. ✅ src: docs/experiment-log.md (finding 3), protocol/brx-protocol.md §7b

[callout:tip] Player numbers in the app are shown 1–64. The gun stores them 0–63 — only matters if you ever compare app numbers with developer tools. ✅ src: docs/experiment-log.md (2026-08-25 P2)

---

### Page: Running a Native Game on Stock Kit  (`/manual/operate/stock-game`)
_A walkthrough of a whole match — on-gun or app-hosted — and what every light and voice line means while it runs._

[steps] "Option A — a game hosted on the gun (no phone)"
1. Every player: gun on, headset on and settled (no rainbow). ✅📖
2. Every player selects the **same mode** with LEFT/RIGHT and pulls the trigger. 📖
3. Pick team with the D-pad, weapon with the trigger, perk with ALT (Team Death Match only). 📖
4. Step through lives / time / respawn / volume with SELECT. Agree the values across all guns — each gun runs its own clock. 📖✅
5. Count down together and **pull the reload handle** to start. 📖
6. Keep score by voice, by a ref, or by team flags — the guns do not tally kills. 👥✅
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, protocol/brx-protocol.md §7n

[steps] "Option B — a game hosted from Callsign"
1. Every player: headset paired, phone mounted on the gun, app icon green. ✅
2. Host creates the game, others join and ready up (allow a minute for the lobby). ✅
3. Host launches: guns spawn together, HUDs light up. The reload handle is **not** needed to start. ✅
4. Death → the app respawns you after the configured respawn time (or at a QR scanner). ✅
5. Time or score limit reached → the app ends the game with a voice line and stops the guns. Scores live on the phones. ✅
src: protocol/brx-protocol.md §7e, §7f, §7n, docs/reference/callsign-ui.md

[table] "During play — what you see and hear"
| Signal | Meaning |
|---|---|
| Gun LED | ammo and health indicator 📖 |
| Headset dark | normal during a game ✅ |
| Headset flashes, "zip" sound, no damage | a miss under the recoil-accuracy model 📖 |
| Headset lit with team colour mid-game | that gun is still in the lobby — it never entered the game ✅ |
| Headset slow rainbow | headset dropped — that gun is locked until it re-pairs 📖✅ |
| Trigger only reloads / chirps | you are in a menu, the game has not started, or the gun is locked 📖✅ |
| "Dead / out of ammo" noise on trigger | you are dead and a respawn station is configured — go to the station ✅ |
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/experiment-log.md (2026-08-27), docs/reference/grenade.md

[callout:info] Where hits land. The headset carries sensor domes front, left, right and back, and the gun has a sensor of its own. At field distances the dome that catches the shot is the one you were facing with; point-blank, IR floods every receiver and any dome can report. Damage is the same either way — a dome hit is a hit. ✅ src: protocol/brx-protocol.md §7r, docs/gotchas.md

[callout:info] Dead means dead. A tagger that is dead (out of health) ignores **all** incoming IR — it cannot take a hit, be healed, or be armed by a station until it respawns. ✅ src: docs/gotchas.md, docs/reference/grenade.md

[callout:warn] The "screamer" — long powered sessions. Owners widely report that in hosted/online play, after about an hour some guns fail with a **loud buzz** and need a reboot, and that a low battery stops Bluetooth re-pairing entirely; a game can cascade down to half its players. We reproduced the Bluetooth half on a gun left powered all day. Rules: power guns **off** between rounds, keep packs topped, and reboot a buzzing gun rather than fighting it. 👥✅ src: docs/reference/community-notes.md (SCREAMERS), docs/gotchas.md, docs/experiment-log.md (2026-08-26 U6 parked)

[cards] "Owner-invented rulesets that need no extra gear"
- **Ribbon teams** — run everyone on one team with friendly fire on and tell teams apart by a coloured ribbon on a clip; swap ribbons on death for infection or team-swap modes. 👥
- **Respawn character** — Generals / Commanders / Swarm modes give one player a mobile respawn point: teammates revive at them with the trigger. 📖
- **Ammo restock** — a grenade, a perk slot, or the respawn character can hand out ammo in limited-ammo games. 👥
src: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md

[diagram OPS-08]

---

### Page: Range & Line of Sight  (`/manual/operate/range`)
_What the numbers on the box mean once the sun comes out._

[stat-row]
- **~600 ft** — rated maximum reach of the IR beam in daylight (Battle Company). 📖
- **~50 %** — how much bright direct sunlight shrinks the gun's hit radius. 📖
- **980 nm / 38 kHz** — the IR wavelength and carrier; a Class 1 device, safe for eyes. 📖
- **~18–20 ft** — how far a respawn station "hears" a headset-and-trigger request outdoors. ✅
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/grenade.md

[cards] "Line-of-sight rules of thumb"
- **IR is light.** It needs a clear path to a sensor dome; it does not go through people, walls or dense foliage. Shade and dusk **improve** range; full noon sun reduces it. 📖
- **It bounces.** In small rooms and near walls a shot can reflect back onto your own headset. Use indoor mode indoors. ✅
- **The headset is the bigger target.** Head-height domes on four sides catch far more than the gun's own sensor; snipers aim for the head. 👥
- **Close range is chaos.** Point-blank, every dome reports; at distance the facing dome reports. Neither changes the damage. ✅
- **Feedback fades in sun.** The headset's green hit LEDs are hard to read in direct sun, so long-range tags look like misses. Listen for the target's hit sound instead. 👥
src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/gotchas.md, protocol/brx-protocol.md §7r

[callout:info] Bluetooth range is not IR range. The phone hosting a game must stay within Bluetooth reach of its gun — in practice mounted on it. IR shots still land at hundreds of feet; the *game logic* is what stops working when the phone is out of range. ✅ src: protocol/brx-protocol.md §7n

---

### Page: Care & Storage  (`/manual/operate/care`)
_Keep it charged, keep it dry, and turn it off between rounds._

[cards] "Between games"
- **Power off between rounds.** Guns left powered for many hours develop Bluetooth trouble ("screamers"); a power-rest clears it. 👥✅
- **Charge every pack after a game day**, and top up before the next one — a low pack quietly breaks Bluetooth re-pairing. 👥
- **Headsets on USB.** Any 5 V USB source charges them — check every headset before a game day. 📖
- **Keep gun-and-headset pairs together** — same sticker on both, stored together. 👥
src: docs/reference/community-notes.md, docs/gotchas.md, docs/reference/brx-extended-user-guide.md

[callout:warn] Water. Owners report guns usually survive a soaking after several days of drying with the battery out; headsets usually do not. Treat the headset as the fragile half. 👥 src: docs/reference/community-notes.md

[callout:warn] Battery out before opening. If you ever open the gun for a repair or a mod, unplug the pack first — owners have lost mainboards working on a gun with a live pack connected. 👥 src: docs/reference/community-notes.md

[table] "Wear items to watch"
| Symptom | Part (as owners found it) | Owner fix |
|---|---|---|
| Reload handle stiff or binding | handle track friction | thin nylon washer under the handle; light silicone lube on the track 👥 |
| A D-pad button feels dead | cracked button plastic — a known wear failure | replace from Battle Company or a parts gun 👥 |
| Gun powers on/off by itself | worn power switch | contact cleaner helps for a while; switch replacement 👥 |
| No sound, but a "pop" at boot | loose or corrupt audio card | the speaker is fine — see *Repairs* 👥 |
| Shots never register on anyone | IR emitter has died (they do) | replaceable part — see *Repairs* 👥📖 |
src: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md

[callout:tip] Sound and firmware updates go through the micro-USB Programing Port with a SELECT-hold boot; the gun exposes a disk with an `AUDIO` folder. Keep a copy of the originals before you swap anything. Full procedure in *Firmware & Sounds*. 📖 src: docs/reference/brx-extended-user-guide.md

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|
| OPS-01 | Quick Start · hero | A real BRX tagger and its headset on a table, headset powered with domes lit, charger cable visible, shot slightly from above with the D-pad, ALT button and reload handle all readable. | REAL PHOTO | owner shoot | — (photograph: dark surface, single soft key light from the left, tagger at 3/4 angle, headset in front; no stickers or labels visible) |
| OPS-02 | Charging & Batteries · after the polarity warning | Close-up of the gun's two ports side by side — round charging port and the micro-USB Programing Port — with the charger plugged into the correct one. | REAL PHOTO | owner shoot | — (macro, shallow depth of field, ports centred, charger LED visible; mask any serial sticker) |
| OPS-03 | The On-Gun Menu · after button holds | Diagram: the control cluster of a rifle-style tagger with seven callout leader lines to blank label plates (trigger, ALT, SELECT, LEFT, RIGHT, reload handle, power switch). | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a simplified line-art side view of a modern black rifle-style laser-tag tagger, drawn as a clean technical illustration; seven thin electric-blue leader lines run from the trigger, a small orange side button, a centre button, two directional buttons, a side reload lever and a rear power slider out to empty rounded rectangular plates at the edges, ready for overlaid labels. |
| OPS-04 | Indoor vs Outdoor · after the compare table | Split atmosphere image: left half a dim indoor arena with soft blue LED glow on a headset silhouette, right half an open field at dusk with a faint IR beam line reaching far. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a vertical split composition — left, a dim indoor arena interior with a silhouetted black laser-tag headset with sensor domes glowing soft electric blue close to the camera; right, a wide open grassy field at dusk with a single faint straight beam of light travelling far into the distance toward a tiny amber point; a thin vertical seam divides the halves. |
| OPS-05 | Sighting the Laser · after the distance table | Diagram: a tagger on the left, a headset target on the right at distance, a straight beam between them, and a small green flash ring on the headset dome. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a minimal technical diagram — a simplified black rifle-style laser-tag tagger in profile at the far left, a simplified black laser-tag headset with sensor domes at the far right, a perfectly straight thin electric-blue beam connecting muzzle to headset dome, a small concentric ring pulse where the beam meets the dome, and faint tick marks along the beam suggesting distance. |
| OPS-06 | Pairing the Headset · after the LED table | Three small headset states in a row: rainbow-cycling, solid team colour, dark — as a real photo strip of the actual headset. | REAL PHOTO | owner shoot | — (three tightly framed photos of the same headset at the same angle in a dim room: 1 cycling colours, 2 solid team colour, 3 dark/off during play; combined as a strip in HTML) |
| OPS-07 | The Grenade & Accessories · after the mode-colour table | The real grenade with its top button and LED, shot in five exposures showing red, green, blue, yellow and white LED states. | REAL PHOTO | owner shoot | — (grenade on a dark surface, same framing for all five; the LED colour is the only change; button clearly visible) |
| OPS-08 | Running a Native Game · end of page | Diagram: a match timeline as a horizontal band — lobby, start, play with hit/kill ticks, death and respawn gap, end — with only colour and shape, labels overlaid later. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; wide 21:9 banner. Subject: an abstract horizontal timeline band — a thin electric-blue line runs left to right; a small hollow circle near the start, a solid circle marking the start, a run of tiny upward tick marks, one amber gap in the line with a dotted bridge over it, more ticks, and a solid end cap; small empty rounded label plates float above five points, ready for overlaid text. |
| OPS-09 | Range & Line of Sight · hero | Atmosphere: a player silhouette with a headset at long range across a field under harsh midday sun versus the same scene in shade, hinting at IR reach. | GENERATE | — | Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a wide low-angle field at the edge of a treeline; a distant human silhouette wearing a black laser-tag headset with small sensor domes stands half in harsh amber sunlight and half in cool blue shade; a faint thin beam of light reaches toward the silhouette from the camera's position and fades where the sunlight is strongest. |
| OPS-10 | Care & Storage · after the wear table | Real photo of a gun's battery bay open with the pack and its 2-pin connector visible, showing the single screw. | REAL PHOTO | owner shoot | — (bay open, pack lifted slightly so the connector and its two wires are visible; no polarity marking added in-camera — the overlay will annotate) |

## Interactive ideas (optional, ≤5)
1. **LED decoder** — tap a headset state (rainbow / team colour / dark) or a gun LED colour and get the one-line meaning plus "what to do"; doubles as a pre-game checklist ("no rainbow before you start").
2. **Button-hold cheat sheet** — a tagger outline; hover/tap a control to see its tap, hold and power-on-hold actions (ALT 3 s, LEFT at boot, RIGHT at boot, SELECT at boot, L+R 5 s).
3. **"Won't fire" troubleshooter** — a four-question flow (headset rainbow? can you select a weapon before starting? app icon green? battery?) that lands on the right fix page.
4. **Match planner** — pick on-gun vs app hosting and it prints the exact pre-game checklist for that path (headsets settled, same mode on every gun, reload-handle start vs host launch).

## Sources used
- `docs/reference/brx-manual-notes.md` — Battle Company *BRX Manual V7* (link: https://battlecompany.com/wp-content/uploads/2021/01/BRX_Manual_V7_FINAL.pdf): controls, charging, on-gun flow, headset lockout, target mode, modes/settings ranges.
- `docs/reference/brx-extended-user-guide.md` — Battle Company / Laser Tag Pro *BRX Extended User Guide* (2018): accessory pairing, on-gun variables, indoor/outdoor effects, reset, admin lock, melee gesture, IR specs, charger and battery details, recoil-accuracy model, mode LED colours.
- `docs/reference/community-notes.md` — BRX Elite Owners group: Gen-3 re-pair, won't-fire ladder, battery polarity, SCREAMERS, Android ≤10, wear items, water survival, sighting distances, ribbon-team rules.
- `docs/reference/grenade.md` — grenade modes and station operation (Extreme Laser Tag And More! videos, hardware-confirmed on our bench).
- `docs/reference/callsign-ui.md` — Callsign app screens and settings (owner screenshots, restated).
- `protocol/callsign-extract/apk-harvest.md` — Callsign mode list, QR-code objectives, lobby architecture.
- `protocol/brx-protocol.md` §7b, §7e, §7g, §7h, §7m, §7n, §7r — app connect ritual (volume 69, name write), headset gate, gun-holds-no-state, sensor map.
- `docs/gotchas.md`, `docs/field-process.md` — headset eyeball check, screamer power-rest rule, name-reset gotcha, IR bounce.
- `docs/experiment-log.md` — 2026-08-23 finding 3 (soft version gate) and 6 (30 inaudible / app 69); 2026-08-25 P2 (player id 1–64 vs 0–63); 2026-08-26 U6 (screamer reproduced); 2026-08-27 headset LED observations.

## Research backlog (held — NOT published)
Nothing below appears on the site. Each item moves up into a page block only when a source settles it.
- **Top on-gun Lives step: 15 or 25.** *BRX Manual V7* lists ∞/1/3/5/10/**15**; the *Extended User Guide* lists 1/3/5/10/**25**/Unlimited. Whole Lives row removed from the "Game variables on the gun" table until confirmed per firmware. src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md
- **Gun charge time: 2 h or 2–4 h.** V7 manual says ~2 h; Extended Guide says 2–4 h. Number removed from Quick Start step 1 and the "Power at a glance" sheet (the ~8 h run time both agree on is kept). src: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md
- **Headset green blink / hold = hit / kill, and whose.** Seen on the bench, but not yet pinned whether it is the wearer's hit/kill or the wearer being hit. Rows removed from "Reading the headset LEDs" and "During play"; OPS-06 trimmed from four states to three; LED-decoder idea trimmed. One clean two-player session will settle it. src: docs/experiment-log.md (2026-08-27 headset LED entry)
- **On-gun volume 1–5 → internal 0–100 mapping.** The 60/70/80/90/100 mapping is a field estimate, not a measurement. Removed from the game-variables table and the Callsign stat-row; "Volume translator" interactive idea dropped. The 1–5 range itself (📖) and the app's 69 (✅) stay. src: docs/experiment-log.md (on-gun volume estimate), protocol/brx-protocol.md §7b
- **"Install accessory" boot = RIGHT vs RIGHT+SELECT.** Owners report RIGHT+SELECT; the Extended User Guide says RIGHT alone. Published RIGHT only (📖); the RIGHT+SELECT variant is held. src: docs/reference/community-notes.md (Re-pair headset), docs/reference/brx-extended-user-guide.md (accessory pairing)
- **Headset pairing "usually takes seconds".** Not in any source — only the "up to 3 minutes with many taggers/BT devices" figure is official; removed from Quick Start step 3 and the Normal pairing steps. src: docs/reference/brx-manual-notes.md (Headset)
- **Firing with no headset at boot.** V7 manual: a gun booted with no headset shoots without one. Owners: post-2018 firmware stops firing whenever the headset is off. Clause removed from the Pairing page callout; only the lock-on-loss behaviour (both agree) is published. Collecting firmware-version/behaviour pairs. src: docs/reference/brx-manual-notes.md, docs/reference/community-notes.md
- **Respawn station arming.** Does the passive station beacon arm a gun by itself, or only the button press / headset-and-trigger? Does a gun armed mid-game stay in station mode for the rest of the match? Owner-reported, not bench-confirmed (the mid-game button-press arming step is published as 👥). src: docs/reference/grenade.md
- **The screamer's root cause.** Bluetooth-refuses-to-hold reproduced after a full day powered; the "loud buzz" failure and the exact battery threshold are owner reports only. src: docs/reference/community-notes.md (SCREAMERS), docs/experiment-log.md (2026-08-26 U6)
- **Callsign on current Android.** The ≤ Android 10 limit is published as 👥; what breaks and whether a workaround exists is uncharacterised. src: docs/reference/community-notes.md
- **The gun ↔ headset radio.** The headset syncs team colour from the gun, so the link carries game state; never characterised, not driven. src: docs/experiment-log.md (2026-08-27)
