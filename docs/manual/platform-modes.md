# Modes and game setup
Last verified: 2026-09-09

This page covers the modes Open BRX itself runs, and the pieces you choose when you build a game.
The stock on-gun and Callsign modes are a separate thing and live on the [gameplay page](/manual/gameplay).

## What you can run

Two of the modes have been played on real taggers, start to finish, with a scoreboard at the end.
The rest are written and covered by tests, but have never been fired at a person. That gap is real:
a mode that has never met a gun can still surprise you.

**Played on hardware:**

| Mode | The rule | Proven by |
|---|---|---|
| Team Deathmatch | Teams score a point per elimination. Downed players respawn after a delay. Highest score at the cap or the clock wins. | A two-gun laptop match on 2026-08-25 (frag limit, correct winner) and an outdoor two-phone match on 2026-09-01. |
| Free-for-all | No teams. Every elimination scores for the shooter. First to the frag limit, or the top score at the clock. | A 300 second match on 2026-08-30: two phones, two taggers, 12 kills over 126 landed hits. |

**Written, never played on guns:**

| Mode | The rule | What is missing |
|---|---|---|
| Infection | One player starts infected. Anyone who goes down respawns onto the infected side. Survivors win by outlasting the clock. | Rules engine and Mission Control support are both in. No live run. |
| Last Man Standing | Every player carries a fixed number of lives. Spend them all and you are out. Last player or squad standing wins. | Rules engine and Mission Control support are both in. No live run. |
| Extraction | Loot, reach the extraction point, hold a loud channel, survive it to bank what you carry. Die and you drop the lot. | Runs from the laptop command line only. The phone carries none of it, so play stays inside Bluetooth range. |
| Counter-Strike (plant and defuse) | Attackers plant at a site, defenders defuse. The round ends on detonate, defuse, or a side wiped out. | Needs a station to report plant and defuse. Not in the Mission Control mode list. |
| Domination | Teams hold capture points. Score accrues per second held. | Needs a station per point. Not in the Mission Control mode list. |
| King of the Hill | Domination with one point: hold the hill for time. | Same as Domination. |
| Capture the Flag | Grab the enemy flag, carry it home. Tag the carrier to send it back. | Needs a station to report grab, capture and drop. Not in the Mission Control mode list. |

Two rule variants sit in the same "written, not played" bucket. **Syphon** heals the killer on every
kill, and **regenerating health** refills a player who has gone a few seconds without damage. Both
exist only in the laptop command-line path, so neither reaches a player carrying a phone.

## How a game is put together

A game is one config object. Everything the guns are told is derived from it, so a game you like is
a game you can save and run again.

| Piece | What it does |
|---|---|
| Mode | Picks the rules and, with them, sensible defaults for the rest of this table. |
| Teams | Up to 4 native teams. The team id is 2 bits in every shot, which is what makes friendly fire work on the gun itself. Beyond 4, run free-for-all and let Mission Control keep logical teams; there is no on-gun friendly-fire protection in that mode. |
| Time limit | The clock. It is the only ending every player sees, because each phone counts it down locally and stops on its own even with nothing in range. |
| Frag or score limit | An early end. Mission Control decides it from the events it has and tells the phones. Players in range stop; players out of range keep playing until the clock runs out. |
| Respawn | Timed (the phone counts a delay and re-arms the gun), station (walk back to a respawn station and it re-arms you), or none (Last Man Standing lives). |
| Health pool | 45 health and 70 armor by default. Armor soaks first. You can raise or lower it per player, which is how you handicap a strong player or help a small one. |
| Loadout policy | Who picks the weapons: the operator, the players, or nobody (see below). |
| Venue | Indoor or outdoor sets the gun's IR range profile and the game volume (80 indoors, 90 outdoors). Night dims the LEDs instead of lighting the field up. |
| Friendly fire and critical hits | Both are gun settings, both are per game. Free-for-all forces friendly fire on, since everyone is an enemy. |

Because the clock is the only ending that reaches everyone, a game with no time limit is refused
unless you assert that every player will stay in range for the whole match.

## Loadouts

Every player carries three slots.

| Slot | Holds | Notes |
|---|---|---|
| Primary | Any weapon | Required. Never empty. |
| Secondary | Any weapon, including the three pistols | Optional. |
| Perk | One perk | Optional, and it rides beside the secondary. An assault rifle, a pistol and a perk is a legal kit. |

Five perks are offered: Body Armor (50 extra armor), Extended Mags (double the primary's magazine
and reserve), Quick Hands (half the reload time), Quick Switch (half the weapon-swap delay, 0.85 s
down to 0.43 s) and Easy Reload (the orange ALT button reloads, for anyone who finds the pump hard
to work).

Who picks is set per slot, per game:

| Policy | Primary | Secondary | Perk |
|---|---|---|---|
| Open | player picks, whole catalog | player picks, whole catalog | player picks |
| No heavies | player picks, heavy weapons excluded | player picks, heavy weapons excluded | player picks |
| Snipers | fixed to the Sniper Rifle | off | off |
| Custom | whatever you set, slot by slot | | |

Free-for-all defaults to No heavies. Every other mode defaults to Open. A slot can also be set to
"host", which means the operator picks for the player, or "off", which disables it for everyone. If
you tighten the policy after players have already kitted, every loadout is re-fixed to the new rules
and the affected players are told.

**The one exception.** Easy Reload maps the ALT button to reload, and ALT is also the button that
switches weapons. So Easy Reload cannot ride with a second weapon. Picking one drops the other, and
both the operator console and the phone warn you with a two-tap confirm before it happens. Any
future perk that claims a button joins the same rule.

## Weapons

Open BRX defines weapons on the wire. Each one is a frame the gun is sent at arming time, so a
weapon is data, not firmware, and a game can hand out numbers Battle Company never shipped.

The roster is 22 entries: the 19 weapons captured from the Callsign app, three pistols we added
(Glock-18, USP-S, Desert Eagle) and melee, which is always loaded and never shown in the picker.
Every captured weapon starts from the real frame Battle Company sent. Only the balance numbers are
overwritten: damage, fire interval, magazine, reserve, reload time and swap delay. Sounds, fire
mode, burst behaviour and overheat come through from the capture untouched.

The full stat table for the Callsign 19 is on the [gameplay page](/manual/gameplay), with the
numbers the app itself sends. Open BRX ships its own tuning on top of those rows, so treat the
gameplay page as the arsenal and this page as what the platform does with it.

A player can also try a weapon before the game starts. The gun is armed with that one weapon,
privately, at a lower volume, with no team and no identity, so they can pull the trigger and feel
the reload without it counting for anything.

## What is not built yet

- The objective modes (Domination, King of the Hill, Capture the Flag, Counter-Strike) cannot be configured from Mission Control. Their settings do not cross the wire yet.
- Extraction runs from the laptop command line only. The phone knows nothing about loot, zones or the channel timer.
- Syphon and regenerating health are laptop-only for the same reason.
- Mission Control does not arm respawn or objective stations at muster. A station is set up by hand.
- Per-player handicaps stop at the health and armor pool. Damage, fire rate, respawn delay and lives are not adjustable per player.
- No mode has been run with more than two phones.
