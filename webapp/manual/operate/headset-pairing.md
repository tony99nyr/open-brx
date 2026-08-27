# Pairing the Headset
_The single most common cause of "my gun won't fire" — and the fix for it._
Last verified: 2026-08-27

The headset is a separate radio device that carries most of the hit sensors. It pairs to one gun. A gun that boots **with** a headset and then loses it **locks its trigger until the headset returns** (anti-cheat).
Source: docs/reference/brx-manual-notes.md

## Normal pairing (every day)
1. Gun on, then headset on. The headset LEDs cycle rainbow while searching. 📖✅
2. Wait. Pairing can take up to **3 minutes** with many taggers and Bluetooth devices around. 📖
3. When the LEDs settle to the gun's team colour, you are paired. ✅
Source: docs/reference/brx-manual-notes.md, docs/experiment-log.md (2026-08-27 headset LED entry)

## Reading the headset LEDs
| Headset shows | It means | Confidence |
|---|---|---|
| Slow rainbow blink | **Not paired / disconnected.** The gun will not join a phone game — re-pair before you start. | ✅ |
| Solid team colour (red / blue…) | Paired, in the menu or lobby — **pre-game only**. | ✅ |
| Dark during play | Normal. The headset goes dark once a game starts. | ✅ |
Source: docs/experiment-log.md (2026-08-27), docs/field-process.md, docs/gotchas.md

## Re-pairing a headset that has lost its gun (Gen-3 procedure)
1. Turn the **headset** on; LEDs cycle colours. 👥
2. Press and **hold the small headset button** — keep holding through the whole procedure. 👥
3. On the **gun**: hold **RIGHT** on the D-pad while sliding the power on. 👥
4. Wait for the voice line **"PAIRING MODE"**. 👥
5. **Pull the trigger once** → "HEADSET CONNECTED"; the headset LEDs stop cycling. 👥
6. A second trigger pull announces "device paired". Release the headset button. 👥
Source: docs/reference/community-notes.md (Gen-3 headset re-pair procedure — contributed to the BRX owner community; it is the procedure behind the "PAIRING MODE" voice line)

## Alternative: 'install accessory' route
Boot the gun holding **RIGHT** ("install accessory"), power the headset, press its button once. Same boot mode as pairing a grenade or sidearm.
Source: docs/reference/brx-extended-user-guide.md (accessory pairing), docs/reference/community-notes.md

Firmware updates can un-pair everything. Owners report the v4.30 update wipes settings and breaks headset pairing until you re-run setup; Battle Company's own fix involved a temporary downgrade. Re-pair after any firmware update before a game day. Details in *Firmware & Sounds*.
Source: docs/reference/community-notes.md

## Headset troubleshooting
- **The gun charges a weapon but nothing happens on the trigger.** Classic headset-lockout symptom. Look at the headset: rainbow = re-pair it. 👥✅
- **The phone app connects, then drops within a couple of seconds.** The app requires a paired headset and silently disconnects without one — the gun is fine. Get the headset lit before opening the app. ✅ (
- **Only some guns joined the phone game.** A gun whose headset is powered off or unpaired (slow rainbow) refuses to join with no error. Eyeball every headset before you start — before the game a paired headset shows team colour; it only goes dark once play begins. ✅
- **It paired yesterday and not today.** Headset battery. It charges from any USB 5 V. 📖
Source: protocol/brx-protocol.md §7m) · docs/reference/community-notes.md, protocol/brx-protocol.md §7m, docs/gotchas.md, docs/field-process.md

_[image OPS-06: ]_
