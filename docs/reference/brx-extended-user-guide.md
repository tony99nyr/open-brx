# BRX Extended User Guide — distilled notes

Source: **"BRX Extended User Guide" (8-24-2018), Laser Tag Pro / Battle Company** (owner
`brx@neighborhoodwarfare.com`; shared in the community). Facts restated for our own use; far richer
than the V7 quick manual (`brx-manual-notes.md`). This is an authoritative primary source — where it
conflicts with our inferences, it wins.

## Firmware & sound-pack updates over USB (AUTHORITATIVE — confirms the data-port swap)

The micro-USB "Programing Port" exposes a **USB mass-storage disk** with a firmware `.BIN` at the
root and an **`AUDIO` folder** of sound files. This is the "internal memory for audio pack expansion."

- **Enter USB disk mode:** gun **OFF → hold SELECT → turn ON**. The gun makes **no startup sound**;
  a disk drive appears on Windows/macOS. (Non-logo guns: after entering, tap SELECT a few times.)
- **Firmware:** delete the existing `.BIN` at the root, copy the new firmware `.BIN` to the root.
  Non-logo guns then wait ~10 s → "UPGRADE COMPLETE".
- **Sound pack (custom sounds!):** drag new audio files into the **`AUDIO` folder**, overwrite = YES.
  Slow — "up to an hour per 250 MB." Files are per-sound (`<ID>.LTP`, see `sound-bank.md`).
- **Headset / grenade / hatchet / shield / sidearm firmware:** hold the **PROGRAM button** (pin) while
  powering on → USB disk mode → replace the root firmware file.

This is the definitive confirmation that **on-tagger custom audio is supported** (Star Wars packs
etc.) — content change over USB, not a firmware hack. Keep originals; BC's download is the restore.

## IR laser specs (for our objective-station / effect-node hardware)

Class 1, IEC 60825-1: **wavelength 980 nm**, pulse width **6.5 µs**, energy/pulse **111 nJ**,
**pulse rep rate 38,000 Hz (38 kHz)**, beam < 18 mm at aperture. The 38 kHz matches the community
IR-encoding notes (`lasertagmods.md`) and the **Vishay TSSP38** receiver the group IDs. Note the
**980 nm** emitter (many IR parts are 940 nm) — pick 980 nm-capable emitters/receivers for our
stations to match the BRX.

## Accessory / grenade pairing (AUTHORITATIVE — answers followup F/G)

Accessories (grenade, extra grenades, hatchet, shield, sidearm) are **IR-paired to a specific gun**
so only the owner triggers them:
1. **Hold RIGHT while powering up the gun** → "install accessory".
2. Power on the device to pair — it accepts a new pairing ID for **30 s** after power-up.
3. **Pull the gun trigger aimed at the device** → sends a new pairing code over IR; the device
   flashes/chirps to confirm.
4. Pair **all** devices in one session (don't power the gun off between); tap SELECT when done.
   Re-pair everything together whenever you add a new accessory.

**Implication for the grenade work:** the grenade is an **IR-paired accessory**, and pairing is
gun→device over IR (trigger aimed at it). So the `$GREN` config (`apk-harvest.md`: FlashBang/Gas/
Confusion/Molotov) is applied through the gun, and the gun↔grenade link is IR — not a separate BLE
device. This is why grenade config is "hard/buggy" from the on-gun menu, and why a clean host-driven
`$GREN` path would help. (Still to test on hardware: whether `$GREN` reprograms an already-paired
grenade live.)

## On-gun game variables (SELECT menu — NOT in `$GSET`)

Set via SELECT at the root menu; **remembered per game mode**. Confirms these live in on-gun storage
(and the app drives them separately), consistent with our finding that respawn/time/lives are absent
from the `$GSET` stream:
- **Lives:** 1, 3, 5, 10, 25, Unlimited
- **Game Time:** 5, 10, 15, 20, 30 min, Off
- **Respawn Time:** Off, 15, 30, 60 s, **45 s ramping, 90 s ramping**
- **Volume:** 1–5

## Game modes (authoritative; RED = Callsign-Live unlock)

Free For All [white], **Death Match** [red], **Generals** [yellow] (a General character = the team's
mobile respawn point; revive at them with trigger; can be lives-limited for seek-and-destroy),
**Supremacy** [blue] (3 factions), **Commander** [pink] (faction wars + Commander respawn character),
**Survival** [green] (infection), **The Swarm** [orange] (Hive Queen = infected respawn point).
LED colour indicates the selected mode.

## Character classes & abilities (maps to the DamageType/PowerType enums)

Factions: **Nexus** (energy, shields, explode-on-death), **Resistance** (milsim, explosives),
**Vanguard** (exotic, long-range). Classes seen: Sentinel (tank, charge energy gun, EMP alt),
Marauder (energy rifle, adrenaline alt), Guardian (shield-pulse support), Grenadier (laser beam +
sticky grenade), Mercenary (silenced AR + healing/tracking dart), Heavy (belt-fed MG + rally buff),
Soldier (M4 + shotgun swap), Medic (SMG + medi-gel), Valkyrie (burst SMG + mini-rockets), Wraith
(frost burst MG + frost grenade), Technician (incendiary rifle + nano heal), Viper (poison burst +
poison grenade), Sniper (AP bolt rifle, silencer alt). The status effects — **frost (Cryogenic),
poison (Radiation?), incendiary, EMP, shield-pulse, armor-piercing, sticky** — line up with the
`DamageType` enum in `protocol-classes.md`.

**Perks (Deathmatch/Generals, ALT cycles):** Grenade Launcher, Med Kit, Body Armor, Extended Mags,
Concussion Grenades, Critical Strike, Foregrip (recoil↓), Focus (laser designator).

## Weapons (authoritative descriptions)

M-4 (auto, low dmg, med mag), SR-100 (bolt, high dmg, small mag), SMG-X3 (3-round burst), TAC-87
(semi shotgun — hold reload to load shells, full dmg in melee range), MG-7 (suppressing auto, low
accuracy, **overheats/jams** on sustained fire), TAR-33 (semi-auto med), Silenced AR. Matches the
weapon sound IDs (`sound-bank.md`: R02=M4, T14=TAC-87, S16=SR-100, J07=MG7, G10=SMG-x3). Note the
**simulated-recoil accuracy model**: rapid fire drifts accuracy (miss = enemy hears a zip, headset
lights but 0 damage); every gun has a minimum accuracy — fire in bursts.

## Modes/handling details worth knowing

- **Bluetooth pairing:** the gun advertises as **`LTP-alpha`**, default pair code **`0001`**
  (matches our transport doc's HC-05 PIN). Logo guns need no password. v1 = Android only.
- **Indoor/outdoor** (hold ALT 3 s, persists across power cycle): indoor dims the green hit LEDs,
  **enables the RGB LEDs**, and shrinks explosion/melee range; bright sunlight shrinks gun hit radius
  ~50% (IR noise filtering).
- **Target mode** (hold LEFT at power-on): yellow team, 0 dmg, unlimited ammo — for sighting.
- **RESET:** hold LEFT+RIGHT 5 s in game → reboot to menu.
- **Melee gesture (v2):** swing elbow → melee from the front headset emitter (logo = gesture-enabled;
  else use RIGHT).
- **Headset** does **offline short-range scoring** + player proximity detection; 3 W green hit LEDs
  (4 directions) + RGB short-range LEDs (the WS2812B, `community-notes.md`).
- **Battery:** gun needs the **8.4 V two-cell smart charger** (headset = any USB 5 V); swap via one
  screw near the reload switch (gun) / slide compartment (headset v1); ~8 h life, 2–4 h charge.
- **QR codes:** Callsign Team Arena uses QR codes for weapon pickups + capturable flags; Battle
  Royale uses GPS for weapon/supply drops (corroborates `apk-harvest.md`).
- **Manufacturer:** Laser Tag Pro, 9100 S. Nicholson, Oak Creek WI (same address as SwapTX).
