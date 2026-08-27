# Pairing the Headset
_The single most common cause of "my gun won't fire" — and the fix for it._
Last verified: 2026-08-27

The headset is a separate radio device that carries most of the hit sensors. It pairs to one gun. A gun that boots **with** a headset and then loses it **locks its trigger until the headset returns** (anti-cheat).
Source: docs/reference/brx-manual-notes.md

## Normal pairing (every day)
1. Gun on, then headset on. The headset LEDs cycle rainbow while searching. 📖✅
2. Wait. Usually seconds; up to **3 minutes** with many taggers and phones around. 📖
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
Credit: contributed to the BRX owner community; this is the procedure behind the mysterious "PAIRING MODE" voice line.
Source: docs/reference/community-notes.md

## Alternative: 'install accessory' route
Boot the gun holding **RIGHT + SELECT** ("install accessory"), power the headset, press its button once. Owners use this route as well — same idea, different hold.
Source: docs/reference/community-notes.md

Firmware updates can un-pair everything. Owners report the v4.30 update wipes settings and breaks headset pairing until you re-run setup; Battle Company's own fix involved a temporary downgrade. Re-pair after any firmware update before a game day. Details in *Firmware & Sounds*.
Source: docs/reference/community-notes.md

## Headset troubleshooting
- **The gun charges a weapon but nothing happens on the trigger.** Classic headset-lockout symptom. Look at the headset: rainbow = re-pair it. 👥✅
- **The phone app connects, then drops within a couple of seconds.** The app requires a paired headset and silently disconnects without one — the gun is fine. Get the headset lit before opening the app. ✅
- **Only some guns joined the phone game.** A gun with a dark or unpaired headset refuses to join with no error. Eyeball every headset before you start. ✅
- **It paired yesterday and not today.** Headset battery. It charges from any USB 5 V. 📖
Source: docs/reference/community-notes.md, protocol/brx-protocol.md §7m, docs/gotchas.md, docs/field-process.md

_[image OPS-06: ]_
