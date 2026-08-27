# Headset, pairing & Bluetooth
_The headset gates everything — firing, joining a game, and whether a phone can even hold a connection._
Last verified: 2026-08-27

**Rainbow means disconnected.** Read the headset LEDs, re-pair when you have to, and understand "screamers" — the after-an-hour failure that ends hosted games. ✅👥
Source: docs/experiment-log.md 2026-08-27 (headset LED) · docs/reference/community-notes.md (SCREAMERS)

## Headset LED language (what the colours mean)
| Headset shows | Meaning | Confidence |
|---|---|---|
| Slow rainbow blink | Disconnected / not paired — the gun will not join or fire | ✅ owner-observed, repeatable |
| Solid team colour (red/blue) | Paired, pre-game only | ✅ |
| Dark | Normal during play — not a fault | ✅ |
| LEDs cycling colours at power-on | Waiting to pair | 👥 |
Source: docs/experiment-log.md 2026-08-27 · docs/reference/community-notes.md (Gen-3 re-pair)

## "Headset not detected" / "keeps dropping"
1. **Is the headset charged?** → Check the headset battery first. The v2 headset runs on a single 18650 cell; charge from any 5 V USB. 👥📖
2. **Did you boot the gun in target mode (LEFT held)?** → yes → The headset deliberately won't pair in target mode. Reboot normally. 📖
3. **Lots of taggers or Bluetooth devices nearby?** → Auto-pairing can take up to 3 minutes. Wait it out before re-pairing. 📖
4. **Still rainbow after 3 minutes?** → Re-pair using the procedure below. 👥
5. **Just updated firmware (v4.30 or later)?** → The v4.30 "makeover" wipes config and breaks headset pairing until you re-enter setup. A Battle Company-verified fix for a headset that won't pair after the update: downgrade to the previous gun firmware, run `SETUP` over the USB console, re-pair, then upgrade again. 👥
6. **Paired, then the whole fleet drops after an hour?** → "Screamers" — see below. 👥✅
Source: docs/reference/brx-manual-notes.md · docs/reference/brx-extended-user-guide.md · docs/reference/community-notes.md (Firmware / pairing)

## Re-pair a headset to a tagger (Gen-3, the "PAIRING MODE" procedure — contributed by the owner community)
1. Turn the **headset** on; its LEDs cycle colours.
2. Press and **hold the small headset button** — keep holding through every step.
3. On the **tagger**, hold **RIGHT on the D-pad while sliding the power on**.
4. Wait for the voice line **"PAIRING MODE"**.
5. **Pull the trigger once** → "HEADSET CONNECTED"; the headset LEDs stop cycling.
6. A **second trigger pull** announces "device paired". Release the headset button.
Source: docs/reference/community-notes.md ("Gen-3 headset re-pair procedure")

## Other pairing routes
- **"Install accessory" boot:** power the tagger holding RIGHT, power the headset, press its button once. This is the same boot mode used to pair grenades and other IR accessories. 👥📖
- **USB serial console (`QUERY` / `SETUP`):** the micro-USB *programming* port is a plain serial terminal (PuTTY in serial mode, or `screen`). `QUERY` prints the device record including the **Serial Number / Head PIN** — which matches the sticker on the paired headset; `SETUP` asks for a headset serial to bind. Entering `SETUP` and backing out changes nothing; committing it is a factory re-provision. Credit LaserTagMods for the command set. ✅👥
- **Pairing PIN facts:** change one digit of the PIN and the pair breaks; re-matching re-pairs. 👥
Source: protocol/brx-protocol.md ("What DOES work: QUERY and SETUP") · docs/reference/lasertagmods.md · docs/reference/community-notes.md

**"Screamers" — the after-an-hour failure.** In any hosted/online mode, after roughly an hour taggers start randomly failing with a loud buzz and need a reboot; separately, the firmware refuses to re-pair Bluetooth once the battery drops below a threshold, so a game cascades down to half or three-quarters of its players. On our bench, a gun left powered all day still advertised normally but connection attempts hung, and power cycles helped only briefly. **Prevention:** keep batteries topped, plan on periodic reboots, and never assume a Bluetooth link survives a full session. 👥✅
Source: docs/reference/community-notes.md (SCREAMERS) · docs/experiment-log.md 2026-08-26 ("screamer" state) · docs/gotchas.md

## "Can't pair / connect my phone"
1. **Android 11 or newer?** → The official Callsign app works only on Android 10 and older. Use an older Android device. 👥
2. **Is the headset linked (not rainbow)?** → no → Callsign connects to a headset-less tagger and silently disconnects about a second later; you cannot create a game until the app's top-right icon is green and reads "connected". The gun answers other clients fine — the app is enforcing the headset. ✅
3. **"Connection failed" once?** → Try again. A Bluetooth link succeeds roughly one attempt in three, with the official app too; retrying *is* the fix, not a sign of a broken stack. ✅
4. **Reconnecting right after the gun dropped you?** → Back off at least 5 seconds after a gun-initiated disconnect, or the new session comes up dead. ✅
5. **Gun is admin-locked?** → Locked taggers cannot host. Unlock (LEFT+RIGHT 3 s). 👥
6. **Gen-1 tagger?** → It uses Bluetooth *Classic*, advertises as `LTP-alpha`, default pair code `0001`, and needs the headset connected for Bluetooth to work at all. Gen-2/3 advertise as `Tactix-XXXX` over BLE with no PIN. 📖✅
Source: docs/reference/community-notes.md (Ecosystem; Admin lock) · docs/experiment-log.md §16 · docs/gotchas.md ("Connecting") · protocol/brx-protocol.md (transport table) · docs/reference/brx-extended-user-guide.md

**"My gun is called Tactix2 again."** Opening the official app resets an owner-assigned gun name back to the factory `Tactix2`; the Bluetooth advertised name (`Tactix-XXXX`, derived from the radio address) is a different field and never changes. Not a fault — re-apply your name, then power-cycle: the advertised name only refreshes at boot. ✅
Source: docs/gotchas.md ("The gun is called Tactix2 again") · docs/experiment-log.md 2026-08-24 (QUERY vs BLE names; rename)

## What survives a Bluetooth drop vs. a power cycle
| State | Survives a BLE drop? | Survives a power cycle? |
|---|---|---|
| Pushed game config (weapon, health pools, team) | **Yes** — reconnect, re-spawn, reload and it plays on with config intact | **No** — the gun boots live with nothing loaded; the whole head must be re-sent |
| Alive/dead status and ammo count | Yes (the gun keeps counting) | No |
| Indoor/outdoor mode (ALT 3 s) | Yes | **Yes** |
| On-gun menu settings (lives, time, respawn, volume) | Yes | **Yes** — remembered per game mode |
| Owner-assigned gun name | Yes | Yes (advert refreshes at boot) |
| Headset pairing (PIN) | Yes | Yes — but the gun needs the headset *re-linked* before Bluetooth will hold |
| Smart grenade's locked objective mode | n/a | **Yes** — it flashes its mode colour for ~1 s at boot |
| Firmware and sound files | Yes | Yes |
Source: protocol/brx-protocol.md §7r ("config survives a BLE drop (E1)", "Power-cycle WIPES the config") · docs/reference/brx-extended-user-guide.md (indoor/outdoor persists; SELECT menu) · docs/reference/grenade.md

**Two resets worth knowing.** In-game soft reset: hold LEFT+RIGHT for 5 s → the gun reboots to its menu. Fresh from a power cycle a tagger ignores a bare version query until it has been greeted (the phone's handshake) — so "it's not answering" right after boot is expected. 📖✅
Source: docs/reference/brx-extended-user-guide.md (RESET) · protocol/brx-protocol.md §7r ("Fresh power-up needs the handshake")
