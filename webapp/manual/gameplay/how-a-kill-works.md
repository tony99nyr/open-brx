# How a kill actually works
_From trigger pull to green flash in five steps (the developer section has the bit layout)_
Last verified: 2026-08-27

A BRX "bullet" is a burst of infrared light 25 bits long, sent on a 38 kHz carrier. It carries **who fired (player id), which team, how much damage, and what kind of damage**. Your target's headset or gun catches it, looks it up, and takes off the damage. If that was the last of their health, your sight flashes green.
Source: protocol/brx-ir-protocol.md, protocol/brx-protocol.md §7o + §7r

_[diagram GAME-10: The kill pipeline: gun → 25-bit IR word → the receivers on the victim → pool subtraction → death → kill-confirm flash back on the shooter.]_

## The five steps
1. **Fire.** The trigger pull sends the IR word: a 2 ms start pulse, then 25 bits (a long pulse is 1, a short one is 0). Damage type (4 bits) · player id (6 bits, 0–63) · team (2 bits, 4 teams) · damage (8 bits, up to 255) · crit flag · effect subtype · 2 check bits.
2. **Catch.** Your target has five receivers: **four domes on the headset**, one of them at the back, and a sensor on the **gun body**. Whichever one catches the word reports it, and the wire tells front from back from gun. Across the field that tells you where the shot came from. At point-blank range the IR floods every sensor, and the first one to see it wins.
3. **Resolve.** The target's gun checks the team bits first. Same team with friendly fire off means the shot is dropped. Then it looks up the damage type in its effect table and applies the damage: armor first, then health.
4. **Feedback.** The target's headset lights green (a blink on a hit, a hold on a kill) and plays the pain or death sound. The gun reports the hit and the new health to any connected phone. Melee, explosive and other damage types each get their own hit sound.
5. **Confirm.** On a kill the *shooter's* sight flashes green and the announcer says "kill". In a phoneless gun-menu game, the guns sort this out between themselves over their short-range radio. In an app-hosted game the phone scores the kill and drives the same flash and voice line.
Source: protocol/brx-ir-protocol.md §Frame + §Field layout, protocol/brx-protocol.md §7r (sensor map, FF), docs/sound-architecture.md §Native multikills, docs/experiment-log.md ("headset LED map" 2026-08-27 entries), protocol/callsign-extract/protocol-classes.md §FSET

## Why misses still make noise.
The manual's "simulated recoil" accuracy model means a rapid-fire miss still reaches the enemy. Their headset lights and they hear a zip, but 0 damage is applied. If someone's headset keeps flashing and they are not dying, you are missing. Fire in bursts.
Source: docs/reference/brx-extended-user-guide.md §Weapons

## Feedback you will see and hear
| Event | Victim | Shooter |
|---|---|---|
| Hit (non-lethal) | headset green blink · hit tone (HP / armor / shield / crit each have their own) · gun LEDs | nothing (no radio path for a plain hit) |
| Kill | headset green hold · death alarm · gun stops firing | **green sight flash** + "kill" callout; in gun-menu games also "double kill" and other streak lines |
| Same team, FF off | nothing (the gun drops the shot) | nothing |
| Miss (accuracy roll) | headset lights + zip, 0 damage | – |
Source: protocol/brx-protocol.md §7o, docs/sound-architecture.md, docs/experiment-log.md (LED map entries 2026-08-27), docs/reference/brx-extended-user-guide.md

## Every shot names its shooter.
The 6-bit player id in the word is why a host can credit the *exact* killer, run free-for-all scoring, and build health-on-kill. All of it comes from what the target's gun reports. Stock BRX uses it too: that is how the kill-confirm and streak callouts find the right gun. For the full bit layout, the timings and the effect-table mechanism: → *Developer / IR protocol*.
Source: protocol/brx-ir-protocol.md §Why this matters, docs/game-modes.md (P2 closed note)

_[image GAME-11: REAL PHOTO: a headset lit green mid-hit next to a tagger sight showing the kill-confirm flash.]_
