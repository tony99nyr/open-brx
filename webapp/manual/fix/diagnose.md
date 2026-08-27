# Diagnose my tagger
_Symptom first. Start at the top of the ladder that matches what you see — the headset is the first thing to check._
Last verified: 2026-08-27

**It won't fire.** Before you decide it's broken, check the headset, the game state and the locks. Work the ladder in order and stop at the first check that says yes. Confidence for the whole page is shown per block. ✅📖👥
Source: docs/gotchas.md · docs/reference/community-notes.md · docs/reference/brx-manual-notes.md

**Three things to know before any ladder.** (1) The tagger keeps no game state — if it isn't in a started game it won't shoot at anyone. (2) Since a 2018/2019 firmware revision, the gun locks when its headset disconnects *mid-game* (anti-cheat); a gun booted with no headset at all fires fine. (3) A dead player's trigger does nothing but click — that's a game rule, not a fault. 📖✅
Source: docs/reference/brx-manual-notes.md (Headset §) · protocol/brx-protocol.md §7r · docs/experiment-log.md (2026-08-25 "dead gun can't fire")

## "Won't fire" — the ladder
1. **Is the headset slow-blinking a rainbow?** → yes → It's disconnected. The gun refuses to join or fire until the headset links. Power the headset on, wait for it to settle to team colour (up to 3 minutes in a room full of Bluetooth), or re-pair (→ *Headset, pairing & Bluetooth*). ✅📖
2. **Did the headset drop *after* the game started?** (it was fine, then the gun "charges its energy weapon but nothing happens on the trigger") → yes → Anti-cheat lockout. Re-link the headset; if it won't, power-cycle both and restart the round. 👥📖
3. **Is the game actually started?** → no → On-gun play: pull the **reload handle** to start — that's the "go" signal, not the trigger. Hosted play: wait for the host's start. 📖
4. **Are you dead / waiting on a respawn station?** → yes → Respawn (or walk to the station; once a tagger has been armed to a respawn station its self-respawn is disabled). Trigger-while-dead makes only the empty click. ✅👥
5. **Can you cycle weapons with the trigger *before* a game starts?** → no → Controls are locked. Check **admin lock**: primary lock is LEFT+RIGHT held 3 s in the root menu; the secondary LEFT+RIGHT+SELECT 3 s also blocks indoor/outdoor, weapon, team and perk changes. Unlock the same way (v4.30: also hold SELECT). 👥
6. **Does the reload handle click home?** → no → The handle drives a mechanical switch under two screws; press the switch with a pen. If the pen works and the handle doesn't, it's the handle (→ *Repairs*). 📖👥
7. **Does the trigger switch show continuity when pulled?** (multimeter in beep mode, battery **unplugged**) → no → Trigger switch or a loose internal cable. Open the shell and reseat connectors (→ *Repairs*). 👥
8. **Still nothing?** → It's the mainboard. Not community-serviceable — contact Battle Company for repair. 👥
Source: docs/reference/community-notes.md ("Gun won't fire — diagnostic ladder") · docs/reference/brx-manual-notes.md · docs/reference/grenade.md (Respawn Station) · docs/experiment-log.md 2026-08-27 (headset rainbow)

**Running the gun from a third-party host or your own code?** Three silent fire-killers we hit on the bench: the button map must be sent or the firmware reports the trigger as disabled; a game head without the start command spawns a gun whose trigger only reloads; and a magazine must be loaded *after* the spawn or the gun goes live with no ammunition. ✅
Source: docs/gotchas.md ("Sending commands") · docs/experiment-log.md 2026-08-25 (night, try-out couldn't fire)

## "Won't power on" / "powers off by itself"
1. **Did you hold a button while sliding the switch?** → yes → SELECT-at-boot puts the gun in USB disk mode with **no startup sound** — it looks dead but is waiting for a computer. LEFT-at-boot is target mode, RIGHT-at-boot is accessory pairing. Power off, power on with nothing held. 📖
2. **Is the battery charged?** → no → The charger LED goes red → green; a full 2 h charge gives ~8 h of play. Use the 8.4 V two-cell smart charger for the gun (the headset takes any 5 V USB). 📖
3. **Using AAs?** → The optional 6×AA tray takes **non-rechargeable** cells only — the manual says never use rechargeable AAs. 📖
4. **Replacement pack or rebuilt connector?** → Battle Company wires the battery connector with polarity **reversed** from the usual convention. Verify with a meter before plugging in — a reversed pack can damage the board. 👥
5. **Random on/off, especially when jostled?** → The slide **power switch** is a known mechanical failure. Contact/switch cleaner buys time; replacement is the fix (→ *Repairs*). 👥
6. **Was the battery plugged in while you modded it?** → A live battery during a mod is how owners have killed mainboards. That's a repair, not a fix. 👥
7. **Got wet?** → Owners have recovered guns after days of thorough drying. Remove the battery, dry fully before any power attempt. 👥
Source: docs/reference/brx-extended-user-guide.md (USB disk mode, battery) · docs/reference/brx-manual-notes.md · docs/reference/community-notes.md (Battery / power; Common failures)

~8 h play per charge (📖) · 2–4 h to recharge (📖) · up to 3 min for a headset to auto-pair in a crowded room (📖) · ~1 in 3 — how often a Bluetooth connection attempt succeeds first time, official app included (✅)
Source: docs/reference/brx-manual-notes.md · docs/reference/brx-extended-user-guide.md · docs/gotchas.md ("Connection failed")
