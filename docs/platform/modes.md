# Modes and game setup
Last verified: 2026-09-12

This page covers the modes Open BRX itself runs, and the pieces you choose when you build a game.
The stock on-tagger and Callsign modes are a separate thing and live on the [gameplay page](/manual/gameplay).

## What you can run

Three of the modes have been run on real taggers with a scoreboard at the end. The rest are written
and covered by tests, but have never been fired at a person. That gap is real: a mode that has never
met a tagger can still surprise you.

**Played on hardware:**

| Mode | The rule | Proven by |
|---|---|---|
| Team Deathmatch | Teams score a point per elimination. Downed players respawn after a delay. Highest score at the cap or the clock wins. | The laptop-only path on 2026-08-25: two taggers, one command, spawn, hits, deaths, host-driven respawn, a frag limit and the correct winner. The Mission Control plus phones path ran outdoors on 2026-09-01 with two Android phones, but its frag limit only started ending the match on 2026-09-12, when the check moved into Mission Control's own scorer. |
| Free-for-all | No teams. Every elimination scores for the shooter. First to the frag limit, or the top score at the clock. | A 300 second match on 2026-08-30: two phones, two taggers, 12 kills over 126 landed hits. |
| King of the Hill | One point. Hold the hill and possession scores for your team. | Proven end to end through a tagger on 2026-09-10. The hill is a BRX Smart Grenade in hill mode, so the mode needs no station hardware at all: the grenade beacons its owner, the tagger reports the beacon over Bluetooth, and Mission Control scores possession. |

**Written, never played on taggers:**

| Mode | The rule | What is missing |
|---|---|---|
| Infection | One player starts infected. Anyone who goes down respawns onto the infected side. Survivors win by outlasting the clock. | Rules engine and Mission Control support are both in. No live run. |
| Last Man Standing | Every player carries a fixed number of lives. Spend them all and you are out. Last player or squad standing wins. | Rules engine and Mission Control support are both in. No live run. |
| Extraction | Loot, reach the extraction point, hold a loud channel, survive it to bank what you carry. Die and you drop the lot. | The mode is in Mission Control's list and compiles a tagger head. Its objective rules (the zone, the loot, the channel) run only on the laptop command line and have not run on hardware. |
| Counter-Strike (plant and defuse) | Attackers plant at a site, defenders defuse. The round ends on detonate, defuse, or a side wiped out. | Needs a station to report plant and defuse. Not in the Mission Control mode list. |
| Domination | Teams hold capture points. Score accrues per second held. | Needs a station per point. Not in the Mission Control mode list. |
| Capture the Flag | Grab the enemy flag, carry it home. Tag the carrier to send it back. | Needs a station to report grab, capture and drop. Not in the Mission Control mode list. |

Two rule variants sit in the same "written, not played" bucket. **Syphon** heals the killer on every
kill, and **regenerating health** refills a player who has gone a few seconds without damage. Both
exist only in the laptop command-line path, so neither reaches a player carrying a phone.

## How a game is put together

A game is one config object. Everything the taggers are told is derived from it, so a game you like is
a game you can save and run again.

| Piece | What it does |
|---|---|
| Mode | Picks the rules and, with them, sensible defaults for the rest of this table. |
| Teams | Up to 4 native teams. The team id is 2 bits in every shot, which is what makes friendly fire work on the tagger itself. Beyond 4, run free-for-all and let Mission Control keep logical teams; there is no on-tagger friendly-fire protection in that mode. |
| Time limit | The clock. It is the only ending every player sees, because each phone counts it down locally and stops on its own even with nothing in range. |
| Frag or score limit | An early end. Mission Control decides it from the events it has and tells the phones. Players in range stop; players out of range keep playing until the clock runs out. |
| Respawn | Timed (the phone counts a delay and re-arms the tagger), station (walk back to a respawn station and it re-arms you), or none (Last Man Standing lives). |
| Health pool | 45 health and 70 armor by default. Armor soaks first. You can raise or lower it per player, which is how you handicap a strong player or help a small one. |
| Loadout policy | Who picks the weapons: the operator, the players, or nobody (see below). |
| Venue | Indoor or outdoor sets the tagger's IR range profile and the game volume (80 indoors, 90 outdoors). Night dims the LEDs instead of lighting the field up. |
| Friendly fire and critical hits | Both are tagger settings, both are per game. Free-for-all forces friendly fire on, since everyone is an enemy. |

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

Open BRX defines weapons on the wire. Each one is a frame the tagger is sent at arming time, so a
weapon is data, not firmware, and a game can hand out numbers Battle Company never shipped.

The roster is 22 entries: the 19 captured Callsign weapons, melee among them, and three pistols we
added (Glock-18, USP-S, Desert Eagle). Melee is always loaded and never shown in the picker.
Every captured weapon starts from the real frame Battle Company sent. Only the balance numbers are
overwritten: damage, fire interval, magazine, reserve, reload time and swap delay. Sounds, fire
mode, burst behaviour and overheat come through from the capture untouched.

The full stat table for the Callsign 19 is on the [gameplay page](/manual/gameplay), with the
numbers the app itself sends. Open BRX ships its own tuning on top of those rows, so treat the
gameplay page as the arsenal and this page as what the platform does with it.

A player can also try a weapon before the game starts. The tagger is armed with that one weapon,
privately, at a lower volume, with no team and no identity, so they can pull the trigger and feel
the reload without it counting for anything.

## Control points: the grenade or a phone

A control point is a place on the field a team can own: the King of the Hill point, a Domination point, a bomb site. There are two ways to put one on your field, and the choice is not cheap against expensive.

**The Smart Grenade is what works today.** It is the only control point you can shoot, and the only one that plays inside a native game with no host running at all. What it does and what it costs are on the [gameplay page](/manual/gameplay). King of the Hill uses it, and that is the mode that has been played on hardware.

**A phone as a control point is designed and specified, and not built.** Read the table below as the plan. It is what you reach for when you want more than one point, or want the point to count people, or want it to keep scoring after you walk away.

| | Smart Grenade, Hill mode | A phone as a control point |
|---|---|---|
| Status | works today, in native games too | designed, not built |
| How you capture it | shoot it. Charge accumulates, any weapon counts | stand on it |
| More than one point | no. A beacon carries no point id, so two grenades cannot be told apart on the wire | yes. Every point carries its own station id |
| Do more attackers capture faster | no. It counts the charge fired into it, not the people | yes. It counts living players present per team, and nets the leading team against the largest single rival team |
| Downed players | no idea they are there | ignored, so reviving on the point matters |
| Contested | not readable. A non-capturing hit emits nothing we can decode | a real state it can see and announce |
| Progress you can watch | the LED colour and a beep | a percentage on the air for other phones and stations, and an animated bar on its own screen, so a defender can see the point going |
| A point nobody is standing on | ownership travels only over IR and only a gun receives IR, so nobody learns that a far point flipped until a player walks into range | the phone sits on the point all match and keeps its own clock, so it keeps scoring for its owner with nobody there. That is what makes a Territories game possible |
| Points talking to each other | no | yes, with no network at all. The adverts are broadcast, so a respawn station can read a control point |
| Presence range | you aim a gun at it | a bubble of roughly 10 feet at the tuned default, with no direction at all |
| It fights back | yes. An enemy-held hill emits an ordinary damage word, so pushing onto a point you do not own costs you health | no |
| Security | a beacon is unauthenticated | an advert is unauthenticated too. Fine for friends on a private network, not a guarantee |
| What it costs | about $200 for ours, bought from Battle Company | a second-hand Android phone, a small fraction of that |

The money does not buy capability, then. It buys the interaction: you can shoot the grenade, everybody nearby sees and hears it flip, and it works in a native game with nothing else switched on.

**One caveat if you run a hill game today.** An enemy-held hill emits an ordinary damage word, so in a hosted game its chip damage is currently indistinguishable from being shot. A fix is under investigation (moving our own weapons off the IR protocol the hill uses) and it has not been tested.

## What is not built yet

- The remaining objective modes (Domination, Capture the Flag, Counter-Strike) cannot be configured from Mission Control. Their settings do not cross the wire yet. King of the Hill is the exception: it is in the mode list, and its hill is a Smart Grenade rather than a station.
- Extraction's objective rules (the zone, the loot, the channel timer) run only on the laptop command line. The phone knows nothing about them.
- Syphon and regenerating health are laptop-only for the same reason.
- Mission Control arms utility phones from the muster items panel: a spare phone can be armed as a respawn station or a control point before the match. Dedicated station hardware does not exist yet, and the Smart Grenade is set by its own button, not by Mission Control.
- Per-player handicaps stop at the health and armor pool. Damage, fire rate, respawn delay and lives are not adjustable per player.
- No mode has been run with more than two phones.
