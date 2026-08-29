# Running a Native Game on Stock Kit
_A walkthrough of a whole match, on-gun or app-hosted, and what every light and voice line means while it runs._
Last verified: 2026-08-27

## Option A: a game hosted on the gun (no phone)
1. Get every player set: gun on, headset on and settled, no rainbow. ✅📖
2. Have every player select the **same mode** with LEFT/RIGHT and pull the trigger. 📖
3. Pick your team with the D-pad, your weapon with the trigger, and your perk with ALT (Team Death Match only). 📖
4. Step through lives, time, respawn and volume with SELECT. Agree the values across all guns, because each gun runs its own clock. 📖✅
5. Count down together and **pull the reload handle** to start. 📖
6. Keep score by voice, by a ref, or by team flags. The guns do not tally kills. 👥✅
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, protocol/brx-protocol.md §7n

## Option B: a game hosted from Callsign
1. Get every player set: headset paired, phone mounted on the gun, app icon green. ✅
2. Have the host create the game while the others join and ready up. Allow a minute for the lobby. ✅
3. Let the host launch. Guns spawn together and HUDs light up. You do **not** need the reload handle to start. ✅
4. Die, and the app respawns you after the set respawn time, or at a QR scanner. ✅
5. Hit the time or score limit, and the app ends the game with a voice line and stops the guns. Scores live on the phones. ✅
Source: protocol/brx-protocol.md §7e, §7f, §7n, docs/reference/callsign-ui.md

## During play: what you see and hear
| Signal | Meaning |
|---|---|
| Gun LED | ammo and health indicator 📖 |
| Headset dark | normal during a game ✅ |
| Headset flashes, "zip" sound, no damage | a miss under the recoil-accuracy model 📖 |
| Headset lit with team colour mid-game | that gun is still in the lobby; it never entered the game ✅ |
| Headset slow rainbow | the headset dropped; that gun is locked until it re-pairs 📖✅ |
| Trigger only reloads / chirps | you are in a menu, the game has not started, or the gun is locked 📖✅ |
| "Dead / out of ammo" noise on trigger | you are dead and a respawn station is set up, so go to the station ✅ |
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/experiment-log.md (2026-08-27), docs/reference/grenade.md

Where hits land. The headset carries sensor domes front, left, right and back, and the gun has a sensor of its own. At field distances the dome that catches the shot is the one you were facing with. Point-blank, IR floods every receiver and any dome can report it. The damage is the same either way, because a dome hit is a hit.
Source: protocol/brx-protocol.md §7r, docs/gotchas.md

Dead means dead. A tagger that is dead (out of health) ignores **all** incoming IR. It cannot take a hit, be healed, or be armed by a station until it respawns.
Source: docs/gotchas.md, docs/reference/grenade.md

The "screamer", or what long powered sessions do. Owners widely report this in hosted or online play. After about an hour some guns fail with a **loud buzz** and need a reboot. They also report that a low battery stops Bluetooth re-pairing entirely. A game can cascade down to half its players. We reproduced the Bluetooth half on a gun left powered all day. The rules: power guns **off** between rounds, keep packs topped up, and reboot a buzzing gun instead of fighting it.
Source: docs/reference/community-notes.md (SCREAMERS), docs/gotchas.md, docs/experiment-log.md (2026-08-26 U6 parked)

## Owner-invented rulesets that need no extra gear
- **Ribbon teams**: run everyone on one team with friendly fire on, and tell teams apart by a coloured ribbon on a clip. Swap ribbons on death for infection or team-swap modes. 👥
- **Respawn character**: Generals, Commanders and Swarm modes give one player a mobile respawn point. Teammates revive at them with the trigger. 📖
- **Ammo restock**: a grenade, a perk slot, or the respawn character can hand out ammo in limited-ammo games. 👥
Source: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md

_[diagram OPS-08: ]_
