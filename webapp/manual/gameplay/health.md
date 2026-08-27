# Health, armor & damage
_What a hit takes away, what armor does, and why nothing comes back on its own_
Last verified: 2026-08-27

Every player is a pool of points: **45 health and 70 armor by default — 115 in total**. A hit subtracts its damage from armor first, and whatever armor cannot absorb spills straight into health. When health reaches zero you are dead, and nothing in the stock firmware refills you until you respawn.
Source: docs/weapon-design.md §0, protocol/brx-protocol.md §7r addendum

_[diagram GAME-09: The three pools (shield → armor → health) draining under fire, with an 80-point standard hit splitting 70 into armor and 10 into health.]_

## What happens when you get hit
1. The shot's damage number lands on your gun (the IR word carries it — see *How a kill works*).
2. Your gun looks up the shot's damage type in its effect table. Most shots are "standard damage"; class abilities can be heals, shield grants, or multipliers instead.
3. **Armor absorbs 1:1 first, with no per-hit cap** — an 80-point standard hit takes all 70 armor and 10 health at once.
4. Health takes the rest. Your headset and gun play the hit tone; the gun reports the new pool to any connected phone.
5. At 0 health the gun plays the death alarm, stops firing, and ignores all incoming shots until it respawns.
Source: protocol/brx-protocol.md §7r + §7r addendum, docs/weapon-design.md §6.1, docs/reference/grenade.md §Can we add new modes (dead gun accepts no IR)

## Health facts, in player terms
| Question | Answer | Confidence |
|---|---|---|
| Default pool? | 45 HP + 70 armor = 115. Modes like Battle Royale offer Low / Medium / Full starting health. | ✅ 📖 |
| Does armor reduce damage? | No — it *is* extra hit points that drain first. Damage per hit is not reduced by armor. | ✅ |
| Do I heal over time? | **No.** Armor sat at 18/70 for 30 s of idle on the bench and never moved. Any "regen" you experience comes from a class ability, a medic, or a host that refills you. | ✅ |
| What is a shield? | A third pool above armor, used by Nexus-style classes (Guardian 125, Marauder 150, Sentinel 175). It only fills from an IR "activate shield" event — a phone cannot simply set it. | ✅ 📖 |
| Can a medic heal me? | Yes — the Supremacy Medic's medi-gel pulse is a heal *shot*; community confirms it heals by shooting teammates. A host can also grant health directly. | 📖 👥 ✅ |
| Do heals overfill? | No — a heal adds to the pool and clamps at the maximum. | ✅ |
| Head shots? | The headset carries two sensors (front and back domes) and the gun body a third; a crit flag exists in every shot (×1.5 damage) but no stock weapon sets it. | ✅ |
| Can friendly fire hurt me? | Only if the game enables it. With friendly fire off the gun itself blocks same-team damage (and blocks enemy "heals"). FFA is one team with friendly fire on. | ✅ 📖 |
Source: docs/weapon-design.md §0 + §6.1, docs/experiment-log.md #33 ("NO native regen"), docs/reference/brx-manual-notes.md §Supremacy characters, docs/game-modes.md §Health/regen variants + §Team structure, protocol/brx-ir-protocol.md (crit bit), protocol/brx-protocol.md §7r (sensor map)

## Heals and boosts are "add", never "set".
When a phone or host grants health to a live gun, the grant is *added* to the current pool and clamped at the maximum — you cannot be set to a lower number this way, and a grant to a full-health player does nothing. This is why Halo-style regenerating shields, health-on-kill and medic roles are all built by a host watching your pool and topping it up.
Source: docs/experiment-log.md #33 "SEMANTICS + REGEN nailed", docs/game-modes.md §Health/regen variants

## A dead gun is deaf.
Once at 0 health, the tagger accepts no IR at all — a respawn station cannot "revive a corpse" by beam; it arms the living. The trigger of a dead gun only makes the dead/out-of-ammo noise.
Source: docs/reference/grenade.md §Can we add new modes, protocol/brx-protocol.md §7r (Resync)

## Respawn & lives — the knobs every mode shares
| Setting | Gun-menu values (V7 manual / Extended Guide) | Callsign app values |
|---|---|---|
| Lives | a count, or unlimited | a number, or **Unlimited** |
| Respawn time | Off · 15 · 30 · 60 s · **Ramp 45** · **Ramp 90** (penalty grows per death) | a number in seconds (e.g. 15) |
| Respawn type | self-respawn on the gun, or at a **respawn station** (grenade) once armed | **Scanner** (respawn at a QR / station) · **Auto** (timed) |
| Game time | Off · 5 · 10 · 15 · 20 · 30 min | a number in minutes |
Source: docs/reference/brx-manual-notes.md §Game modes, docs/reference/brx-extended-user-guide.md ($GSET stream), docs/reference/callsign-ui.md §GAME SETTINGS, docs/reference/community-notes.md §Game-mode design ideas (ramps)

## Taking damage while in the respawn state is disliked
a recurring community balance note about stock BRX. The gun menu's Ramp 45 / Ramp 90 respawn options grow the wait with each death.
Source: docs/reference/community-notes.md §Balance notes, docs/reference/brx-manual-notes.md §Game modes
