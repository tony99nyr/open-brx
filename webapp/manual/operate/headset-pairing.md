# Pairing the Headset
_The number one cause of "my gun won't fire", and the fix for it._
Last verified: 2026-08-27

The headset is a separate radio device, and it carries most of the hit sensors. It pairs to one gun. A gun that boots **with** a headset and then loses it **locks its trigger until the headset returns** (anti-cheat).
Source: docs/reference/brx-manual-notes.md

## Normal pairing (every day)
1. Turn the gun on, then the headset. The headset LEDs cycle rainbow while they search. 📖✅
2. Wait. Pairing can take up to **3 minutes** when lots of taggers and Bluetooth devices are around. 📖
3. Watch for the LEDs to settle to the gun's team colour. That means you are paired. ✅
Source: docs/reference/brx-manual-notes.md, docs/experiment-log.md (2026-08-27 headset LED entry)

## Reading the headset LEDs
| Headset shows | It means | Confidence |
|---|---|---|
| Slow rainbow blink | **Not paired / disconnected.** The gun will not join a phone game, so re-pair before you start. | ✅ |
| Solid team colour (red / blue…) | Paired, in the menu or lobby. **Pre-game only.** | ✅ |
| Dark during play | Normal. The headset goes dark once a game starts. | ✅ |
Source: docs/experiment-log.md (2026-08-27), docs/field-process.md, docs/gotchas.md

## Re-pairing a headset that has lost its gun (Gen-3 procedure)
1. Turn the **headset** on. Its LEDs cycle colours. 👥
2. Press and **hold the small headset button**. Keep holding it through the whole procedure. 👥
3. Hold **RIGHT** on the D-pad while you slide the **gun** power on. 👥
4. Wait for the voice line **"PAIRING MODE"**. 👥
5. **Pull the trigger once.** You get "HEADSET CONNECTED" and the headset LEDs stop cycling. 👥
6. Pull the trigger a second time. It announces "device paired". Now release the headset button. 👥
Source: docs/reference/community-notes.md (Gen-3 headset re-pair procedure, contributed to the BRX owner community; it is the procedure behind the "PAIRING MODE" voice line)

## Alternative: 'install accessory' route
Boot the gun holding **RIGHT** ("install accessory"), power the headset, then press its button once. It is the same boot mode you use to pair a grenade or a sidearm.
Source: docs/reference/brx-extended-user-guide.md (accessory pairing), docs/reference/community-notes.md

Firmware updates can un-pair everything. Owners report the v4.30 update wipes settings and breaks headset pairing until you re-run setup. Battle Company's own fix involved a temporary downgrade. Re-pair after any firmware update, before a game day. Details are in *Firmware & Sounds*.
Source: docs/reference/community-notes.md

## Headset troubleshooting
- **The gun charges a weapon but nothing happens on the trigger.** That is the classic headset lockout. Look at the headset: rainbow means re-pair it. 👥✅
- **The phone app connects, then drops within a couple of seconds.** The app needs a paired headset and quietly disconnects without one. The gun is fine. Get the headset lit before you open the app. ✅ (
- **Only some guns joined the phone game.** A gun whose headset is off or unpaired (slow rainbow) refuses to join, and gives no error. Eyeball every headset before you start. Before the game a paired headset shows team colour, and it only goes dark once play begins. ✅
- **It paired yesterday and not today.** That is the headset battery. It charges from any USB 5 V. 📖
Source: protocol/session-findings-2026-08.md §7m) · docs/reference/community-notes.md, protocol/session-findings-2026-08.md §7m, docs/gotchas.md, docs/field-process.md

_[image OPS-06: ]_
