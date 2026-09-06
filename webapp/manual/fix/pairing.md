# Headset, pairing & Bluetooth
_The headset controls everything: firing, joining a game, and whether a phone can hold a connection._
Last verified: 2026-08-27

**Rainbow means disconnected.** Learn to read the headset LEDs. Re-pair when you have to. And learn about "screamers", the after-an-hour failure that ends hosted games. ✅👥
Source: docs/experiment-log.md 2026-08-27 (headset LED) · docs/reference/community-notes.md (SCREAMERS)

## Headset LED language (what the colours mean)
| Headset shows | Meaning | Confidence |
|---|---|---|
| Slow rainbow blink, or LEDs cycling colours at power-on | Disconnected or not paired. It is waiting to pair, and the gun will not join a game or fire | ✅ owner-observed, repeatable · 👥 |
| Solid team colour (red/blue) | Paired, pre-game only | ✅ |
| Dark | Normal during play. Not a fault | ✅ |
Source: docs/experiment-log.md 2026-08-27 · docs/reference/community-notes.md (Gen-3 re-pair)

## "Headset not detected" / "keeps dropping"
1. **Is the headset charged?** → Check the headset battery first. The v2 headset runs on a single 18650 cell. Charge it from any 5 V USB. 👥📖
2. **Did you boot the gun in target mode (LEFT held)?** → yes → The headset will not pair in target mode. That is on purpose. Reboot normally. 📖
3. **Lots of taggers or Bluetooth devices nearby?** → Auto-pairing can take up to 3 minutes. Wait it out before you re-pair. 📖
4. **Still rainbow after 3 minutes?** → Re-pair with the steps below. 👥
5. **Just updated firmware (v4.30 or later)?** → The v4.30 "makeover" wipes your config. It also breaks headset pairing until you go back into setup. Battle Company verified this fix for a headset that will not pair after the update. Downgrade to the previous gun firmware, run `SETUP` over the USB console, re-pair, then upgrade again. 👥
6. **Paired, then the whole fleet drops after an hour?** → Those are "screamers". See below. 👥✅
Source: docs/reference/brx-manual-notes.md · docs/reference/brx-extended-user-guide.md · docs/reference/community-notes.md (Firmware / pairing)

## Re-pair a headset to a tagger (Gen-3, the "PAIRING MODE" steps, contributed by the owner community)
1. Turn the **headset** on. Its LEDs cycle colours.
2. Press and **hold the small headset button**. Keep holding it through every step.
3. On the **tagger**, hold **RIGHT on the D-pad while sliding the power on**.
4. Wait for the voice line **"PAIRING MODE"**.
5. **Pull the trigger once** → "HEADSET CONNECTED"; the headset LEDs stop cycling.
6. A **second trigger pull** says "device paired". Now release the headset button.
Source: docs/reference/community-notes.md ("Gen-3 headset re-pair procedure")

## Other pairing routes
- **"Install accessory" boot:** power the tagger holding RIGHT, power the headset, then press its button once. This is the same boot mode you use to pair grenades and other IR accessories. 👥📖
- **USB serial console (`QUERY` / `SETUP`):** the micro-USB *programming* port is a plain serial terminal (PuTTY in serial mode, or `screen`). `QUERY` prints the device record, including the **Serial Number / Head PIN**. That PIN matches the sticker on the paired headset. `SETUP` asks for a headset serial to bind. Entering `SETUP` and backing out changes nothing. Committing it is a factory re-provision. Credit LaserTagMods for the command set. ✅👥
- **Pairing PIN facts:** change one digit of the PIN and the pair breaks. Make the digits match again and it pairs again. 👥
Source: protocol/brx-protocol.md ("What DOES work: QUERY and SETUP") · docs/reference/lasertagmods.md · docs/reference/community-notes.md

**"Screamers": the after-an-hour failure.** In any hosted or online mode, taggers start failing at random after about an hour. They give a loud buzz and need a reboot. Separately, the firmware refuses to re-pair Bluetooth once the battery drops below a threshold. Together they can cut a game down to half or three-quarters of its players. On our bench, a gun left powered all day still advertised normally, but connection attempts hung. Power cycles helped only for a short while. **Prevention:** keep batteries topped up, plan on regular reboots, and never assume a Bluetooth link lasts a full session. 👥✅
Source: docs/reference/community-notes.md (SCREAMERS) · docs/experiment-log.md 2026-08-26 ("screamer" state) · docs/gotchas.md

## "Can't pair / connect my phone"
1. **Android 11 or newer?** → The official Callsign app works only on Android 10 and older. Use an older Android device. 👥
2. **Is the headset linked (not rainbow)?** → no → Callsign connects to a headset-less tagger, then quietly drops about a second later. You cannot create a game until the app's top-right icon is green and reads "connected". The gun answers other clients fine. The app is the thing enforcing the headset. ✅
3. **"Connection failed" once?** → Try again. A Bluetooth link does not always come up first try, and that includes the official app. The link holds once it is up. Retrying *is* the fix, not a sign of a broken stack. ✅
4. **Reconnecting right after the gun dropped you?** → Wait at least 5 seconds after a gun-initiated disconnect. Any sooner and the new session comes up dead. ✅
5. **Gun is admin-locked?** → A locked tagger cannot host. Unlock it (LEFT+RIGHT 3 s). 👥
6. **Gen-1 tagger?** → It uses Bluetooth *Classic*. It advertises as `LTP-alpha` with the default pair code `0001`. It also needs the headset connected for Bluetooth to work at all. Gen-2/3 advertise as `Tactix-XXXX` over BLE with no PIN. 📖✅
Source: docs/reference/community-notes.md (Ecosystem; Admin lock) · docs/experiment-log.md §16 · docs/gotchas.md ("Connecting") · protocol/brx-protocol.md (transport table) · docs/reference/brx-extended-user-guide.md

**"My gun is called Tactix2 again."** Opening the official app resets an owner-assigned gun name back to the factory `Tactix2`. The Bluetooth advertised name (`Tactix-XXXX`, built from the radio address) is a different field and never changes. This is not a fault. Re-apply your name, then power-cycle. The advertised name only refreshes at boot. ✅
Source: docs/gotchas.md ("The gun is called Tactix2 again") · docs/experiment-log.md 2026-08-24 (QUERY vs BLE names; rename)

## What survives a Bluetooth drop vs. a power cycle
| State | Survives a BLE drop? | Survives a power cycle? |
|---|---|---|
| Pushed game config (weapon, health pools, team) | **Yes**. Reconnect, re-spawn, reload, and it plays on with the config intact | **No**. The gun boots live with nothing loaded, so the whole head must be sent again |
| Alive/dead status and ammo count | Yes (the gun keeps counting) | No |
| Indoor/outdoor mode (ALT 3 s) | Yes | **Yes** |
| On-gun menu settings (lives, time, respawn, volume) | Yes | **Yes**. They are remembered per game mode |
| Owner-assigned gun name | Yes | Yes (advert refreshes at boot) |
| Headset pairing (PIN) | Yes | Yes, but the gun needs the headset *re-linked* before Bluetooth will hold |
| Smart grenade's locked objective mode | n/a | **Yes**. It flashes its mode colour for ~1 s at boot |
| Firmware and sound files | Yes | Yes |
Source: protocol/session-findings-2026-08.md §7r ("config survives a BLE drop (E1)", "Power-cycle WIPES the config") · docs/reference/brx-extended-user-guide.md (indoor/outdoor persists; SELECT menu) · docs/reference/grenade.md

**Two resets worth knowing.** In-game soft reset: hold LEFT+RIGHT for 5 s → the gun reboots to its menu. Fresh from a power cycle, a tagger ignores a bare version query until it has been greeted (the phone's handshake). So "it's not answering" right after boot is expected. 📖✅
Source: docs/reference/brx-extended-user-guide.md (RESET) · protocol/session-findings-2026-08.md §7r ("Fresh power-up needs the handshake")
