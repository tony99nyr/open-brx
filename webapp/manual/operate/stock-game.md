# Running a Native Game on Stock Kit
_A walkthrough of a whole match — on-gun or app-hosted — and what every light and voice line means while it runs._
Last verified: 2026-08-27

## Option A — a game hosted on the gun (no phone)
1. Every player: gun on, headset on and settled (no rainbow). ✅📖
2. Every player selects the **same mode** with LEFT/RIGHT and pulls the trigger. 📖
3. Pick team with the D-pad, weapon with the trigger, perk with ALT (Team Death Match only). 📖
4. Step through lives / time / respawn / volume with SELECT. Agree the values across all guns — each gun runs its own clock. 📖✅
5. Count down together and **pull the reload handle** to start. 📖
6. Keep score by voice, by a ref, or by team flags — the guns do not tally kills. 👥✅
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, protocol/brx-protocol.md §7n

## Option B — a game hosted from Callsign
1. Every player: headset paired, phone mounted on the gun, app icon green. ✅
2. Host creates the game, others join and ready up (allow a minute for the lobby). ✅
3. Host launches: guns spawn together, HUDs light up. The reload handle is **not** needed to start. ✅
4. Death → the app respawns you after the configured respawn time (or at a QR scanner). ✅
5. Time or score limit reached → the app ends the game with a voice line and stops the guns. Scores live on the phones. ✅
Source: protocol/brx-protocol.md §7e, §7f, §7n, docs/reference/callsign-ui.md

## During play — what you see and hear
| Signal | Meaning |
|---|---|
| Gun LED | ammo and health indicator 📖 |
| Headset dark | normal during a game ✅ |
| Headset flashes, "zip" sound, no damage | a miss under the recoil-accuracy model 📖 |
| Headset lit with team colour mid-game | that gun is still in the lobby — it never entered the game ✅ |
| Headset slow rainbow | headset dropped — that gun is locked until it re-pairs 📖✅ |
| Trigger only reloads / chirps | you are in a menu, the game has not started, or the gun is locked 📖✅ |
| "Dead / out of ammo" noise on trigger | you are dead and a respawn station is configured — go to the station ✅ |
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/experiment-log.md (2026-08-27), docs/reference/grenade.md

Where hits land. The headset carries sensor domes front, left, right and back, and the gun has a sensor of its own. At field distances the dome that catches the shot is the one you were facing with; point-blank, IR floods every receiver and any dome can report. Damage is the same either way — a dome hit is a hit.
Source: protocol/brx-protocol.md §7r, docs/gotchas.md

Dead means dead. A tagger that is dead (out of health) ignores **all** incoming IR — it cannot take a hit, be healed, or be armed by a station until it respawns.
Source: docs/gotchas.md, docs/reference/grenade.md

The "screamer" — long powered sessions. Owners widely report that in hosted/online play, after about an hour some guns fail with a **loud buzz** and need a reboot, and that a low battery stops Bluetooth re-pairing entirely; a game can cascade down to half its players. We reproduced the Bluetooth half on a gun left powered all day. Rules: power guns **off** between rounds, keep packs topped, and reboot a buzzing gun rather than fighting it.
Source: docs/reference/community-notes.md (SCREAMERS), docs/gotchas.md, docs/experiment-log.md (2026-08-26 U6 parked)

## Owner-invented rulesets that need no extra gear
- **Ribbon teams** — run everyone on one team with friendly fire on and tell teams apart by a coloured ribbon on a clip; swap ribbons on death for infection or team-swap modes. 👥
- **Respawn character** — Generals / Commanders / Swarm modes give one player a mobile respawn point: teammates revive at them with the trigger. 📖
- **Ammo restock** — a grenade, a perk slot, or the respawn character can hand out ammo in limited-ammo games. 👥
Source: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md

_[diagram OPS-08: ]_
