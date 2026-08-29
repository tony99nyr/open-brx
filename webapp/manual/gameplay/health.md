# Health, armor & damage
_What a hit takes away, what armor does, and why nothing comes back on its own_
Last verified: 2026-08-27

Every player is a pool of points: **45 health and 70 armor by default, which is 115 in total**. A hit comes off your armor first. Whatever armor cannot soak up spills straight into your health. When your health hits zero you are out. Nothing in the stock firmware fills you back up until you respawn.
Source: docs/weapon-design.md §0, protocol/brx-protocol.md §7r addendum

_[diagram GAME-09: The three pools (shield → armor → health) draining under fire, with an 80-point standard hit splitting 70 into armor and 10 into health.]_

## What happens when you get hit
1. The shot's damage number lands on your gun. The IR word carries it (see *How a kill works*).
2. Your gun looks up the shot's damage type in its effect table. Most shots are "standard damage". Class abilities can be heals, shield grants or multipliers instead.
3. **Armor soaks damage 1 for 1, with no cap per hit.** An 80-point standard hit takes all 70 armor and 10 health at once.
4. Health takes the rest. Your headset and gun play the hit tone. The gun reports your new pool to any connected phone.
5. At 0 health the gun plays the death alarm, stops firing, and ignores every incoming shot until it respawns.
Source: protocol/brx-protocol.md §7r + §7r addendum, docs/weapon-design.md §6.1, docs/reference/grenade.md §Can we add new modes (dead gun accepts no IR)

## Health facts, in player terms
| Question | Answer | Confidence |
|---|---|---|
| Default pool? | 45 HP + 70 armor = 115. Modes like Battle Royale offer Low / Medium / Full starting health. | ✅ 📖 |
| Does armor reduce damage? | No. It *is* extra hit points, and they drain first. Armor never makes a hit weaker. | ✅ |
| Do I heal over time? | **No.** On the bench we set the pools to 99/99 and shot armor down to 18. It sat there through 18 s, then another 12 s, with nothing happening. Any healing you see comes from a class ability, a medic, or a host that refills you. | ✅ |
| What is a shield? | A third pool that sits above armor. Nexus-style classes use it (Guardian 125, Marauder 150, Sentinel 175). It only fills from an IR "activate shield" event. A phone cannot just set it. | ✅ 📖 |
| Can a medic heal me? | Yes. The Supremacy Medic's medi-gel pulse is a heal *shot*, and the community confirms it heals by shooting teammates. A host can also grant health directly. | 📖 👥 ✅ |
| Do heals overfill? | No. A heal adds to your pool and stops at the maximum. | ✅ |
| Head shots? | The headset has two sensors (front and back domes) and the gun body has a third. Every shot carries a crit flag, but no stock weapon sets it. A crit multiplies damage by `1 + $GSET t7/100`. That is a per-game setting: ×1.5 at the shipped t7=50, and t7=0 turns crits off. | ✅ |
| Can friendly fire hurt me? | Only if the game turns it on. With friendly fire off, the gun itself blocks same-team damage (and blocks enemy "heals"). FFA is one team with friendly fire on. | ✅ 📖 |
Source: docs/weapon-design.md §0 + §6.1, docs/experiment-log.md #33 ("NO native regen"), docs/experiment-log.md 2026-08-27 (crit = magnitude × (1 + $GSET t7/100), exact at seven levels), docs/reference/brx-manual-notes.md §Supremacy characters, docs/game-modes.md §Health/regen variants + §Team structure, protocol/brx-ir-protocol.md (crit bit), protocol/brx-protocol.md §7r (sensor map)

## Heals and boosts "add", they never "set".
When a phone or host gives health to a live gun, the amount is *added* to your current pool and stops at the maximum. Nobody can set you to a lower number this way, and a grant to a full-health player does nothing. That is why Halo-style regenerating shields, health-on-kill and medic roles all work the same way. A host watches your pool and tops it up.
Source: docs/experiment-log.md #33 "SEMANTICS + REGEN nailed", docs/game-modes.md §Health/regen variants

## A dead gun is deaf.
At 0 health the tagger takes no IR at all. A respawn station cannot revive you with a beam; it arms the living. Pull the trigger while dead and all you get is the dead or out-of-ammo noise.
Source: docs/reference/grenade.md §Can we add new modes, protocol/brx-protocol.md §7r (Resync)

## Respawn & lives: the knobs every mode shares
| Setting | Gun-menu values (V7 manual / Extended Guide) | Callsign app values |
|---|---|---|
| Lives | a count, or unlimited | a number, or **Unlimited** |
| Respawn time | Off · 15 · 30 · 60 s · **Ramp 45** · **Ramp 90** (the penalty grows with each death 👥) | a number in seconds (e.g. 15) |
| Respawn type | self-respawn on the gun, or at a **respawn station** (grenade) once armed | **Scanner** (respawn at a QR / station) · **Auto** (timed) |
| Game time | Off · 5 · 10 · 15 · 20 · 30 min | a number in minutes |
Source: docs/reference/brx-manual-notes.md §Game modes, docs/reference/brx-extended-user-guide.md ($GSET stream), docs/reference/callsign-ui.md §GAME SETTINGS, docs/reference/community-notes.md §Game-mode design ideas (ramps)

## Taking damage while in the respawn state is disliked
is a balance note that comes up again and again in the owner community. The gun menu's Ramp 45 and Ramp 90 respawn options grow the wait with each death.
Source: docs/reference/community-notes.md §Balance notes, docs/reference/brx-manual-notes.md §Game modes
