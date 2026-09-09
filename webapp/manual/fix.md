# Fix, mod and accessorise
Last verified: 2026-08-27

Diagnose a tagger that won't fire, work through the fix ladders for pairing, sound and battery,
and see what the community repairs, mods and accessories actually look like.

## Diagnose my tagger

Start with what you see: pick the ladder that matches, then work down it. The headset is the
first thing to check.

It won't fire. Before you decide it is broken, check three things: the headset, the game state
and the locks. Work the ladder in order and stop at the first check that says yes.

> **Three things to know before any ladder.**
>
> 1. The tagger keeps no game state. If it is not in a started game, it will not shoot anyone.
> 2. The gun locks when its headset disconnects mid-game. That is anti-cheat.
> 3. A dead player's trigger only clicks. That is a game rule, not a fault.

### "Won't fire"

1. **Is the headset slow-blinking a rainbow?** → yes → It is disconnected. The gun will not join a
   game or fire until the headset links. Power the headset on and wait for it to settle to team
   colour. That can take up to 3 minutes in a room full of Bluetooth. If it never settles, re-pair
   (see "Headset, pairing & Bluetooth").
2. **Did the headset drop after the game started?** (it was fine, then the gun "charges its energy
   weapon but nothing happens on the trigger") → yes → That is the anti-cheat lockout. Re-link the
   headset. If it will not link, power-cycle both and restart the round.
3. **Is the game actually started?** → no → On-gun play: pull the reload handle to start. That is
   the "go" signal, not the trigger. Hosted play: wait for the host to start it.
4. **Are you dead, or waiting on a respawn station?** → yes → Respawn, or walk to the station.
   Once a tagger has been armed to a respawn station, its self-respawn is off. A dead player's
   trigger only makes the empty click.
5. **Can you cycle weapons with the trigger before a game starts?** → no → The controls are
   locked. Check the admin lock. The primary lock is LEFT+RIGHT held 3 s in the root menu. The
   secondary is LEFT+RIGHT+SELECT for 3 s, and it also blocks indoor/outdoor, weapon, team and
   perk changes. Unlock the same way (v4.30: also hold SELECT).
6. **Does the reload handle click home?** → no → The handle drives a mechanical switch under two
   screws. Press that switch with a pen. If the pen works and the handle does not, the handle is
   the problem (see "Repairs").
7. **Does the trigger switch show continuity when pulled?** (multimeter in beep mode, battery
   unplugged) → no → It is the trigger switch, or a loose cable inside. Open the shell and reseat
   the connectors (see "Repairs").
8. **Still nothing?** → It is the mainboard. That is not community-serviceable. Contact Battle
   Company for repair.

> **Running the gun from a third-party host or your own code?** We hit three silent fire-killers
> on the bench. Send the button map, or the firmware reports the trigger as disabled. Send a game
> head with no start command, and the gun spawns with a trigger that only reloads. Load a magazine
> after the spawn, or the gun goes live with no ammunition.

### "Won't power on" / "powers off by itself"

1. **Did you hold a button while sliding the switch?** → yes → SELECT-at-boot puts the gun in USB
   disk mode with no startup sound. It looks dead, but it is waiting for a computer. LEFT-at-boot
   is target mode. RIGHT-at-boot is accessory pairing. Power off, then power on with nothing held.
2. **Is the battery charged?** → no → The charger LED is red while charging and goes green when
   full. A full charge gives ~8 h of play. Use the 8.4 V two-cell smart charger for the gun. The
   headset takes any 5 V USB.
3. **Using AAs?** → The optional 6xAA tray takes non-rechargeable cells only. The manual says
   never use rechargeable AAs.
4. **Replacement pack or rebuilt connector?** → Battle Company wires the battery connector with
   polarity reversed from the usual convention. Check it with a meter before you plug it in. A
   reversed pack can damage the board.
5. **Random on/off, especially when jostled?** → The slide power switch is a known mechanical
   failure. Contact or switch cleaner buys you time. Replacing the switch is the real fix (see
   "Repairs").
6. **Was the battery plugged in while you modded it?** → A live battery during a mod is how owners
   have killed mainboards. That is now a repair, not a fix.
7. **Got wet?** → Owners have brought guns back after days of thorough drying. Take the battery
   out. Dry the gun fully before any power attempt.

- ~8 h play per charge
- Charger LED goes red, then green when full
- Up to 3 min for a headset to auto-pair in a crowded room
- A Bluetooth link does not always come up first try, official app included, so retrying is the
  fix

## Headset, pairing & Bluetooth

The headset controls everything: firing, joining a game, and whether a phone can hold a
connection.

Rainbow means disconnected. Learn to read the headset LEDs. Re-pair when you have to. And learn
about "screamers", the after-an-hour failure that ends hosted games.

| Headset shows | Meaning |
|---|---|
| Slow rainbow blink, or LEDs cycling colours at power-on | Disconnected or not paired. It is waiting to pair, and the gun will not join a game or fire |
| Solid team colour (red/blue) | Paired, pre-game only |
| Dark | Normal during play. Not a fault |

### "Headset not detected" / "keeps dropping"

1. **Is the headset charged?** → Check the headset battery first. The v2 headset runs on a single
   18650 cell. Charge it from any 5 V USB.
2. **Did you boot the gun in target mode (LEFT held)?** → yes → The headset will not pair in
   target mode. That is on purpose. Reboot normally.
3. **Lots of taggers or Bluetooth devices nearby?** → Auto-pairing can take up to 3 minutes. Wait
   it out before you re-pair.
4. **Still rainbow after 3 minutes?** → Re-pair with the steps below.
5. **Just updated firmware (v4.30 or later)?** → The v4.30 "makeover" wipes your config. It also
   breaks headset pairing until you go back into setup. Battle Company verified this fix for a
   headset that will not pair after the update. Downgrade to the previous gun firmware, run
   `SETUP` over the USB console, re-pair, then upgrade again.
6. **Paired, then the whole fleet drops after an hour?** → Those are "screamers". See below.

**Re-pair a headset to a tagger (Gen-3, the "PAIRING MODE" steps, contributed by the owner
community)**

1. Turn the headset on. Its LEDs cycle colours.
2. Press and hold the small headset button. Keep holding it through every step.
3. On the tagger, hold RIGHT on the D-pad while sliding the power on.
4. Wait for the voice line "PAIRING MODE".
5. Pull the trigger once. The tagger says "HEADSET CONNECTED" and the headset LEDs stop cycling.
6. A second trigger pull says "device paired". Now release the headset button.

### Other pairing routes

- **"Install accessory" boot:** power the tagger holding RIGHT, power the headset, then press its
  button once. This is the same boot mode you use to pair grenades and other IR accessories.
- **USB serial console (`QUERY` / `SETUP`):** the micro-USB programming port is a plain serial
  terminal (PuTTY in serial mode, or `screen`). `QUERY` prints the device record, including the
  Serial Number / Head PIN. That PIN matches the sticker on the paired headset. `SETUP` asks for a
  headset serial to bind. Entering `SETUP` and backing out changes nothing. Committing it is a
  factory re-provision. Credit LaserTagMods for the command set.
- **Pairing PIN facts:** change one digit of the PIN and the pair breaks. Make the digits match
  again and it pairs again.

> **"Screamers": the after-an-hour failure.** In any hosted or online mode, taggers start failing
> at random after about an hour. They give a loud buzz and need a reboot. Separately, the firmware
> refuses to re-pair Bluetooth once the battery drops below a threshold. Together they can cut a
> game down to half or three-quarters of its players. On our bench, a gun left powered all day
> still advertised normally, but connection attempts hung. Power cycles helped only for a short
> while. Prevention: keep batteries topped up, plan on regular reboots, and never assume a
> Bluetooth link lasts a full session.

### "Can't pair / connect my phone"

1. **Android 11 or newer?** → The official Callsign app works only on Android 10 and older. Use an
   older Android device.
2. **Is the headset linked (not rainbow)?** → no → Callsign connects to a headset-less tagger,
   then quietly drops about a second later. You cannot create a game until the app's top-right
   icon is green and reads "connected". The gun answers other clients fine. The app is the thing
   enforcing the headset.
3. **"Connection failed" once?** → Try again. A Bluetooth link does not always come up first try,
   and that includes the official app. The link holds once it is up. Retrying is the fix, not a
   sign of a broken stack.
4. **Reconnecting right after the gun dropped you?** → Wait at least 5 seconds after a
   gun-initiated disconnect. Any sooner and the new session comes up dead.
5. **Gun is admin-locked?** → A locked tagger cannot host. Unlock it (LEFT+RIGHT 3 s).
6. **Gen-1 tagger?** → It uses Bluetooth Classic. It advertises as `LTP-alpha` with the default
   pair code `0001`. It also needs the headset connected for Bluetooth to work at all. Gen-2/3
   advertise as `Tactix-XXXX` over BLE with no PIN.

> **"My gun is called Tactix2 again."** Opening the official app resets an owner-assigned gun name
> back to the factory `Tactix2`. The Bluetooth advertised name (`Tactix-XXXX`, built from the
> radio address) is a different field and never changes. This is not a fault. Re-apply your name,
> then power-cycle. The advertised name only refreshes at boot.

### What survives a Bluetooth drop vs. a power cycle

| State | Survives a BLE drop? | Survives a power cycle? |
|---|---|---|
| Pushed game config (weapon, health pools, team) | Yes. Reconnect, re-spawn, reload, and it plays on with the config intact | No. The gun boots live with nothing loaded, so the whole head must be sent again |
| Alive/dead status and ammo count | Yes (the gun keeps counting) | No |
| Indoor/outdoor mode (ALT 3 s) | Yes | Yes |
| On-gun menu settings (lives, time, respawn, volume) | Yes | Yes. They are remembered per game mode |
| Owner-assigned gun name | Yes | Yes (advert refreshes at boot) |
| Headset pairing (PIN) | Yes | Yes, but the gun needs the headset re-linked before Bluetooth will hold |
| Smart grenade's locked objective mode | n/a | Yes. It flashes its mode colour for ~1 s at boot |
| Firmware and sound files | Yes | Yes |

> **Two resets worth knowing.** In-game soft reset: hold LEFT+RIGHT for 5 s to reboot the gun to
> its menu. Fresh from a power cycle, a tagger ignores a bare version query until it has been
> greeted (the phone's handshake). So "it's not answering" right after boot is expected.

## Hits, sound & battery

When the gun fires but nothing lands, nothing is heard, or nothing lasts.

### "IR isn't registering hits"

1. **Same team, friendly fire off?** → yes → Zero damage is correct. The firmware enforces it.
2. **Is the target alive and in a started game?** → no → A dead tagger accepts no IR at all. A
   tagger that is set up but not started ignores it too. Silence from a corpse proves nothing.
3. **Bright sunlight?** → The gun's hit radius shrinks by about half in full sun, because of IR
   noise filtering. Range is best in shade and at night. Typical max is ~600 ft in good
   conditions.
4. **Wrong indoor/outdoor mode?** → Hold ALT for 3 s to toggle it. The setting survives power
   cycles. Indoor dims the green hit LEDs, turns on the RGB LEDs, and shrinks explosion and melee
   range. Outdoor projects further.
5. **Is the scope sighted?** → Boot in target mode (hold LEFT at power-on: yellow team, 0 damage,
   unlimited ammo). Direct hits flash the target green. Sight indoors at ~20 ft and outdoors at
   ~300 ft. Snipers want 300–400 ft; shotgun and SMG want 50–100 ft.
6. **Mag-dumping?** → The simulated-recoil model pulls your accuracy off under rapid fire. A miss
   makes the enemy hear a zip and lights their headset with 0 damage. Fire in bursts.
7. **Hits register from the front but not the back, or the other way round?** → The headset has
   separate front and back sensor domes, plus a gun-body sensor. A dead dome is a replaceable
   part, and sensor boards for front, left and right are sold.
8. **Never lands at any range, target mode included?** → IR emitters do die. The laser emitter is
   a separately replaceable part.

> **Outdoors, prefer the stock headset.** SwapTX-modded headsets have dimmer LEDs than the BRX
> headset. In direct sun that makes it hard to tell whether you are landing tags at range.

### "No sound" / "too quiet"

1. **Did you hear a "pop" at power-on?** → yes → The speaker and amp have power, so check the
   audio files next. → no → It is the speaker or its wiring. Battle Company sells replacement
   speakers.
2. **Volume set to 1?** → On-gun volume is 1-5 in the SELECT menu, and it is remembered per game
   mode.
3. **Driven from an app or host?** → The wire-level volume command has a much wider range. The
   official app sends 69. At a "safe" 30 you cannot hear weapon audio outdoors at all.
4. **Booted into USB disk mode by accident?** → SELECT-at-boot turns the startup sound off
   completely. Reboot with nothing held.
5. **Just updated to v4.30+?** → That release needs a complete new audio file set in the `AUDIO`
   folder. Old files leave silences.
6. **Installed a custom pack and only some sounds changed?** → App-selected guns use different
   filenames from the default gun files. The default weapons to target are SR-100, TAC-87, SMG-X3
   and MG7 (see the Sound page for the id map).

### "Battery dies fast" / "won't charge" / replacing a pack

1. **Charger LED never goes green?** → Make sure it is the 8.4 V two-cell smart charger (the
   headset takes any 5 V USB). The LED is red while charging and green when full.
2. **Bluetooth stops holding as the day goes on?** → The firmware will not re-pair BLE below a
   battery threshold. Top the pack up, or swap packs.
3. **Buying a replacement pack?** → Stock is a 7.4 V, ~2200 mAh Li-ion with a 2-pin connector.
   Marketplace packs often have a 3-pin connector, and the BRX ignores the third (thermistor) pin.
   Check the polarity: Battle Company's is reversed from the usual convention.
4. **Want to charge spares without the gun?** → Owners splice a BRX AC adapter onto a battery
   connector and charge packs on the bench. Then they hot-swap in the field. One screw near the
   reload switch opens the gun's battery bay. The v1 headset has a slide compartment.
5. **Running a rider board off the tagger?** → Battle Company confirms that under 300 mA draw from
   the tagger's port is OK. Most modders use a separate USB power bank anyway.
6. **Want a live reading?** → The USB console `QUERY` shows gun and headset volts. A battery frame
   also comes over Bluetooth.

> **A live pack during a mod fries the mainboard. Reversed polarity risks damage too.** Unplug the
> battery before any work inside the shell. Meter the connector before you plug in a non-stock
> pack. Never use rechargeable AAs in the AA tray.

## Repairs

What owners fix themselves, what Battle Company sells, and what's a send-it-back.

BRX repairs are switches, plastic and sensors. You can reach the reload handle, D-pad, power
switch, battery bay, sensors and emitter. You cannot reach the mainboard. Unplug the battery
first, every time.

> **Before you open anything.**
> - Unplug the battery. A live pack during work inside the shell is how owners have fried
>   mainboards.
> - The emitter is a Class 1 IR laser (980 nm, 38 kHz, ~17 mW measured on our unit). Do not change
>   its drive circuit, and do not stare into it while you probe.
> - There is no public mainboard schematic (only partial community mapping). Do not expect to
>   trace faults past the switches and connectors.
> - Never modify stock firmware. Battle Company's official USB updater is the factory-restore
>   path. A firmware backup is not possible over the console.
> - Lots of wires and switches live inside. Photograph every connector before you pull it.

### The repair catalogue

- **Reload handle: stiff, binding, or not registering.** The handle works a mechanical switch
  under two screws. Test the switch with a pen. If it binds, slip a thin nylon washer between the
  handle and the assembly. Owners cut one from a soft clear plastic lid. Add a light silicone lube
  on the inner track. Or replace the handle with the reload-button mod (see Mods).
- **D-pad buttons: cracked.** The button plastic cracks from wear, and it is a known repeat
  failure. The DIY fix is to fill it with hot glue. Better: pull one from a parts gun, or ask
  Battle Company for the part. No printable STL exists yet. That is an open contribution.
- **Power switch: random on/off.** The mechanical slide switch is failing. Switch cleaner is a
  temporary fix. Replacing it is the real one.
- **Trigger switch.** Continuity-test it. It should beep on a pull, with the battery unplugged.
  Replace the microswitch, or reseat the cable.
- **Battery bay and contacts.** One screw near the reload switch opens it. Check the 2-pin
  connector for looseness, and confirm the polarity if anything was ever rewired.
- **Headset sensor domes / gun sensor.** Battle Company sells the sensor circuit boards
  (front/left/right, headset 2.0), speakers, and a 19" 2-pin wire bundle. The v2 headset is the
  same hardware as the Battle Rifle Pro headset. Only the firmware differs.
- **IR emitter.** They do die. The laser emitter is a separately replaceable module.
- **Water.** Take the battery out. Owners have brought guns back after days of drying.
- **Sling mount.** Drill 7/32". A 15/64" hole is too loose.
- **Mainboard.** Not community-serviceable. Send it in.

**Firmware update over USB (the official path: use only Battle Company's files)**

1. Gun off. Hold SELECT, slide power on. There is no startup sound, and that is correct.
2. Plug the micro-USB programming port (not the charging port) into a computer. A disk drive
   appears with a firmware `.BIN` at the root and an `AUDIO` folder.
3. Delete the existing `.BIN`, then copy the new one to the root. Non-logo guns wait ~10 s and say
   "UPGRADE COMPLETE". Gen-1 guns need an extra step: reboot, then press SELECT three times.
4. Expect v4.30+ to wipe your config. It also breaks headset pairing until you re-run setup, and
   it demands a complete new audio set in `AUDIO`.
5. Headset, hatchet, shield and sidearm firmware: hold the device's PROGRAM pin-button while
   powering on to enter disk mode, then replace the root file.

> **Keep a record of your gun before it breaks.** The USB console's `QUERY` prints the firmware
> version, the headset PIN, battery voltages, player and field IDs, and the grenade pin. It is the
> only local "backup" the tagger offers. Save it for each gun. It holds the headset PIN, so keep
> it private.

## Mods

The community norm is "no permanent modification". Everything rides on the phone bracket or clips
to the rail.

Bolt on, never cut. The proven BRX mods run from a reload button up to a full ESP32 field host.
Every one of them leaves the tagger stock and reversible. That is also how the Open BRX Companion
is designed.

### Mods owners actually run

- **Reload-button mod (the most established BRX print).** It swaps the pull-back reload handle
  for a push button, which makes a fleet easier to store and carry. A YouTube tutorial exists
  ("Battle Company BRX Laser Tag Gun Reload Button Modification"). An STL circulates privately in
  the owners' group.
- **JEDGE tagger rider (LaserTagMods).** An ESP32 that Bluetooth-bridges each tagger for
  phone-free, host-run multiplayer. It handles scoring, respawn, and team, perk and weapon
  assignment. It talks over ESP-NOW or LoRa, and you set it up from a WiFi web page. It rides on
  the phone bracket with a USB power bank. A 5000 mAh pack runs ~15 h, about two gun-battery
  cycles. There is no permanent mod and no drain on the gun. One field host has run 45 rifles at
  once. Credit LaserTagMods (JEDGE/JBOX).
- **JBOX / JCUBE / JBOX Mini / JTOWER / JHALO (Jay, Extreme Laser Tag And More!).** ESP32
  objective stations: domination, CTF, respawn, medic, sentry, supply/upgrade, tug-of-war,
  battle-royale checkpoints. JHALO turns a spare BRX headset into a respawn box. Each one is its
  own WiFi hotspot (`192.168.4.1`). You get a ~45 s window after boot to reach the menu. Firmware
  is flashed from that page. See Accessories for stations.
- **SwapTX headset mod.** A ~$50 replacement headset (single 18650) that unlocks STX-style
  on-tagger hosting and JEDGE controls. It has no IR emitters, so you lose splash damage,
  shotguns, pass-through, medics, many Supremacy and Deathmatch perks, and base/commander respawn
  requests. It is a non-final beta, and Battle Company declined to productise it.
- **Custom sound packs.** The tagger's audio swaps over the programming port (SELECT-at-boot, then
  the `AUDIO` folder, then replace `<ID>.LTP`). Star Wars overlay packs exist. Keep the originals.
  See the Sound page.
- **Headset LED mods.** The addressable RGB LEDs are standard WS2812B (5050). They are wired in
  series on the BRX headset, on one data line, and they are NeoPixel-compatible.
- **Phone bracket / mount.** Battle Company sells the BRX phone bracket. It doubles as the mount
  for rider boards and power banks.
- **Scope.** Sight it in target mode (LEFT-at-boot). Indoors ~20 ft, outdoors ~300 ft, snipers
  300–400 ft.
- **Cosmetics.** 3D-printed skins exist (private files, SwapTX-style). Painting: clean, scuff,
  black Krylon primer, thin colour coats, clear. Owners use stickers or paint to keep gun and
  headset pairs matched at events.

> **Hard-won electrical cautions for any ESP32 rider (credit Jay / the owners' group).**
> - Feed the BRX serial side 3.0-3.4 V logic (~3.06 V sweet spot). 5 V produces corrupt
>   characters, and even 0.3 V off on the BT-module pins breaks reception.
> - Insert ~5 ms between characters, or the tagger garbles or drops them.
> - A diode is required between the ESP32 TX pin and the board RX or BT-module tab.
> - Draw under 300 mA if you power from the tagger (Battle Company-confirmed). A separate power
>   bank is the norm.
> - Cheap ESP32 D1-mini boards fail often because the regulator is undersized. Power them over
>   USB, or add a large capacitor.
> - Use exactly the units in the maintained build docs. Swapped-in hardware is what sits behind
>   the "JEDGE 6 doesn't work, LoRa doesn't work" threads. Play outdoors. ESP32 radio range is
>   flaky indoors around solid cover.

### 3D-printed parts: what exists (there is no public BRX print library)

| Part | Status | Where |
|---|---|---|
| Reload-button handle | Exists, shared privately | Owners' group |
| JEDGE rider mount / clip-on cover | Exists, part of the JEDGE build docs | LaserTagMods / owners' group |
| Skins / covers (incl. sniper body) | Private SwapTX work; wanted | Owners' group |
| D-pad replacement buttons | Wanted, no STL | Open contribution |
| JBOX enclosures (Box V5 / Disk / Mini) | Published with the JBOX repo. For the accessory, not the tagger; unlicensed | LaserTagMods GitHub |
| Open BRX `hardware/` | Planned MIT library, version-tagged: reload button, D-pad, Companion mount, station enclosures, skins | this project |

## Accessories

Grenade, stations, headsets, power and mounts. What each one is, and the gotchas nobody tells
you.

### Smart grenade

- **What it is:** a portable objective device. It has a button on top, three IR emitters, an
  emitter and receiver, status LEDs, and USB-C charging. A green flash at power-up means it is
  ready.
- **Five button-set modes, by LED colour:** red = Frag (thrown blast), green = Assault, blue =
  Hill (King of the Hill), yellow = Respawn, white = CTF. Hold the top button ~4 s until a long
  beep. Keep cycling while it beeps, then release on the colour you want. The LED goes white to
  confirm the lock. The mode stays set across power cycles, and at boot it flashes the current
  mode's colour for ~1 s.
- **Pairing is only for thrown use:** boot the gun holding RIGHT ("install accessory"), then shoot
  the grenade within its 30 s window. Pair all accessories in one session. Objective modes need no
  pairing, because any gun works with them by IR.
- **Respawn-station gotcha:** each tagger must receive the station's IR to switch from
  self-respawn to station-respawn. That happens before the game, or from a grenade-button press
  mid-game. A tagger that never got it just self-respawns. Stations can be overtaken.
- **Known quirks:** there is no winner display for its own KotH and domination modes. The
  defending team can capture Assault by accident. You cannot set the mode from an app, because it
  is button-locked on the device.
- Credit: Jay's two 2019 grenade videos are the de-facto manual, and our reference adds bench
  findings on top. See the grenade page in Gameplay.

### Other IR-paired accessories (official)

- **Hatchet, shield, sidearm, extra grenades**: each one pairs to a specific gun over IR. They use
  the same "install accessory" boot, so only the owner can trigger them. Re-pair everything
  together whenever you add one. Hatchet, shield and sidearm firmware updates the same way as the
  gun (PROGRAM button at power-on, then disk mode).

### Utility boxes & stations

- **JBOX family (LaserTagMods / Jay):** IR "smart bases". A player shoots one to capture it, and
  it emits IR back to heal, boost, respawn or damage. Modes: single- and multi-point domination
  (time / shots / damage-weighted), tug-of-war, Ultimate King of the Hill (up to 21 boxes, roles
  reshuffled every round), battle royale with storm and checkpoints, loot/weapon pickups,
  proximity mine, gas, alarm. You configure it from a phone browser on the box's WiFi hotspot.
  JBOX Mini is the minimal build: an ESP32, IR rx/tx and one RGB LED, powered over USB.
- **JHALO:** a spare BRX headset plus an ESP32 becomes a respawn or utility box. It reuses gear
  you already own.
- **Measured radio ranges (Jay, obstructed trail):** ESP-NOW reached ~250 ft, or ~580 ft with an
  external antenna. LoRa standard mode reached ~1,370 ft with zero loss, but the round trip took
  ~3.5 s.

### Headset variants

| Headset | Notes |
|---|---|
| v1 | Slide-out battery compartment |
| v2 | Single 18650 cell; same hardware as the Battle Rifle Pro headset, but different firmware; 3 W green hit LEDs on four sides plus WS2812B RGB |
| "Gen-3" pairing | Uses the button-hold + RIGHT-at-boot "PAIRING MODE" steps |
| SwapTX headset (mod) | ~$50, 18650, unlocks on-tagger hosting; no IR emitters; dimmer LEDs in sun; beta |
| All | Pairs automatically at power-on (up to 3 min); won't pair in target mode; goes dark during play; rainbow = disconnected |

### Batteries & chargers

| Item | Value |
|---|---|
| Gun pack | 7.4 V ~2200 mAh Li-ion, 2-pin connector, reversed polarity vs. convention |
| Gun charger | 8.4 V two-cell smart charger; LED red while charging, green when full |
| Headset | Single 18650 (v2); any 5 V USB charger |
| Runtime | ~8 h play per charge |
| Alternative | 6xAA tray, non-rechargeable only |
| Spares | Charge outside the gun with a spliced BRX AC adapter; keep a stack and swap |
| Rider power | USB power bank on the bracket (5000 mAh ≈ 15 h of JEDGE); tagger port OK under 300 mA |

### Mounts & carry

- **Phone bracket**: the official Battle Company part, and the standard mount for phones, power
  banks and rider boards.
- **Sling**: drill 7/32" for a sling swivel.

## The community

Where BRX owners really solve things, and what each place is good for.

- **BRX Elite Owners Group (Facebook, ~200 members).** The live source. You get repair threads,
  battery and pairing fixes, sound-pack swaps, painted-tagger photos (browse the Media tab), and
  the pinned "JEDGE for all" document. Best for: "has anyone seen this?"
- **LaserTagMods on GitHub (JEDGE / JBOX / autoupdate and ~10 more repos).** The de-facto
  reverse-engineered BRX command dictionary, plus the JBOX station designs with enclosures and
  schematics. No license: read, don't copy. Best for: protocol facts, station behaviours, current
  firmware versions.
- **Jay, "Extreme Laser Tag And More!" (YouTube @extremelasertag3602).** The grenade manual that
  never shipped, measured radio-range tests, every JBOX mode demonstrated, and the 45-rifle field
  host. Best for: seeing a mode or accessory actually work before you build it.
- **lasertaginfo.org forum + Jay's Google Drive.** Legacy JEDGE documentation and binaries.
- **SWAPTX-EVOLVER (Facebook).** The sister group for the SwapTX headset mod and Evolver
  cross-play.
- **Battle Company (battlecompany.com).** Official manual PDFs (link to them, don't rehost), the
  firmware updater, replacement parts (speakers, sensor boards, wire bundles, D-pad on request),
  the phone bracket, and mainboard repair.
- **Open BRX (this project).** MIT-licensed protocol reference, Mission Control, the Companion and
  Utility Box designs, and the planned open print library.

> "No permanent BRX modification" is the community norm. Everything rides on the phone bracket,
> and the taggers stay stock.

## FAQ

The questions owners ask first.

### Why won't my gun fire?

Check the headset first. If it is off, unpaired (slow rainbow blink), or it dropped mid-game, the
firmware locks the trigger. Link it, or re-pair it. The next most common cause: the game has not
started (pull the reload handle), or you are dead.

### How do I re-pair a headset?

Headset on, hold its small button, then boot the tagger holding RIGHT. Wait for "PAIRING MODE".
Pull the trigger once ("HEADSET CONNECTED"), then once more ("device paired").

### The headset went dark once the game started. Is it broken?

No. Team colour shows before the game only. Dark during play is normal. Rainbow is the fault
state.

### Can I put custom sounds on the tagger?

Yes. Plug the programming port into a computer and hold SELECT while powering on. A drive appears
with an `AUDIO` folder, and you replace the `.LTP` files (slow: ~1 h per 250 MB). Keep the
originals.

### Which phones work with the official app?

Callsign works on Android 10 and older, not on newer Android. On any phone the headset must be
linked, or the app disconnects.

### What battery and charger does it take?

A 7.4 V ~2200 mAh Li-ion pack with an 8.4 V two-cell smart charger. The headset charges from any
5 V USB. There is an optional 6xAA tray, non-rechargeable only.

### Is the battery polarity really reversed?

Yes. It is reversed from the usual convention. Meter any replacement pack before you plug it in.

### Why is my gun called Tactix2 again?

Opening the official app resets the owner-set name. Rename it and power-cycle.

### Why do guns fail after about an hour of hosted play?

"Screamers": a documented failure of taggers left powered and hosted for long sessions. There is
also a firmware rule that refuses Bluetooth re-pairing below a battery threshold. Power-rest guns,
rotate them, and keep batteries topped up.

### Do I have to open the gun for JEDGE?

No. It rides on the phone bracket with its own power, and stock firmware is never touched. The
Open BRX Companion is designed the same way.

### Can I change the grenade's mode from an app?

No. You set it only by holding the button on the device, and it stays set across power cycles.

### Where do I get 3D-print files?

There is no public BRX library yet. The reload-button STL circulates in the owners' group. Open
BRX is building an open, versioned one.
