# What the lights mean in a game
Last verified: 2026-09-09

In an Open BRX game the host takes over the gun body LEDs and the headset ring, so what you see is
ours. For the stock behaviour of a tagger nobody is hosting, see [Meet the BRX](/manual/hardware).

## The gun body

Three LEDs run along the body. In a game they do two jobs: they rest on your team colour, and they
briefly become a bar showing the pool that just moved.

**Rest.** The body holds your team's paint colour, dimmed. In free-for-all every player rests on
white. An armed gun that has not spawned holds the same colour at full brightness, so a dim body means
the match is live.

**The readout.** Whenever a pool changes (damage, a heal, a shield or armour grant) the three LEDs
become a bar in that pool's colour, then hand back to the rest colour 4 seconds after the last
change. A reload repaints the pool that last moved for 2 seconds.

Which pool you are looking at:

- The innermost pool that moved wins. A hit that strips the last of your shield and bites into armour
  shows armour, because armour is what you have left.
- If that pool is now empty, the bar hands over inward to the next pool that still has something
  (shield to armour, armour to health). The drain animates to zero first, so you see the loss, but
  the strip never sits dark while you are alive.
- Health emptying hands over to nothing. That is death.

The bar has seven levels, because half steps blink:

| Level | What you see | Health hue |
|---|---|---|
| 6 | 3 solid | green |
| 5 | 2 solid, 3rd blinking | green |
| 4 | 2 solid | green |
| 3 | 1 solid, 2nd blinking | yellow |
| 2 | 1 solid | yellow |
| 1 | 1st blinking | red |
| 0 | dark | (empty) |

A pool with anything left in it never shows level 0, so 1 HP never looks like dead.

Seven levels is a promise the hardware keeps for **health alone**, because only health shifts hue as
it falls. Shield and armour hold one colour, so their adjacent levels differ only by whether the top
segment blinks: 1 and 2 are both one lit segment, 3 and 4 are both two, 5 and 6 are both three. Catch
the blink and you read seven. Glance and you read four.

**How you tell a resting gun from a readout.** Brightness, not colour. The rest paint is dim and the
readout paints at full, which matters because three of the four team colours share a hue with a pool:
team 3 purple against armour, team 2 yellow against mid health, team 0 red against critical health.
Without the brightness gap a settled bar and a resting gun are the same picture. **At night both are
dim, so that separation is gone**: read the bar by its length instead.

**Why a half step blinks instead of dimming.** Brightness on this hardware is one setting for the
whole strip, not one per LED, so two bright segments and one dim one does not exist. The top segment
of a half step blinks (on and off every 400 ms) instead.

**The drop.** A change plays as an animation: the level you were on holds for 180 ms, the whole strip
goes off for 80 ms, then it steps down one level every 120 ms, settles, and blinks the top segment if
it landed on a half step. A gain animates upward with no leading blink. A second change inside
400 ms skips the freeze and the all-off blink and steps straight down from what is showing, so
automatic fire does not turn the strip into a strobe.

**The blank comes first.** After every spawn the firmware breathes the body colour on its own, and a
colour written on top of that only alternates with it. Open BRX sends a blank frame 2.5 seconds after
every spawn, which lifts the strip out of that loop, and paints after that. For those first 2.5
seconds you see the tagger's own breathing. The same hands-off rule applies at death: nothing is
written to the body for 2.5 seconds after you go down.

## The headset

The ring is what everyone else reads. You cannot see your own head, so nothing on it is for you.

| Moment | Headset |
|---|---|
| Pregame, in the muster | your team colour, solid |
| Match start | white double flash, then the resting state |
| In play, resting | dark (a mode can choose to hold the team colour instead) |
| Hit taken | the tagger's own flash, which is brighter than anything we can write |
| Down | the tagger's own bright flash on the small LED, every 750 ms, for as long as you stay down |
| Respawn | white double flash, then the resting state |

Some modes hold a role on your head until it ends. The carrier blink and the infected colour are the
two in play today.

| Role | Headset |
|---|---|
| Flag, bomb or objective carrier | white blink, 300 ms on and off |
| Infected | solid, in the infected team's colour |
| VIP | solid white |
| Extraction beacon | orange blink, 300 ms on and off |
| Extracted | solid white |

A carrier blinks white and never the flag's colour: a team colour is an identity, a role is a state.

## Colours

Both surfaces share one nine colour palette.

| Index | Colour |
|---|---|
| 0 | red |
| 1 | blue |
| 2 | yellow |
| 3 | green |
| 4 | purple |
| 5 | teal |
| 6 | white |
| 7 | pink |
| 8 | orange |

Index 9 and above are dark, which is how a segment is switched off. Pools read like this:

| Pool | Colour |
|---|---|
| Shield | teal at every level |
| Armour | purple at every level |
| Health | green above two thirds, yellow above one third, red below that |

Only health changes hue as it falls. Shield and armour keep one colour and let the bar length carry
the level.

Teams paint red (team 0), blue (team 1), yellow (team 2) and purple (team 3). Team 3 fights as green
on the wire and paints purple, because green is what a headset flashes on a hit and out. Free-for-all
paints white for everyone.

## Night games

Night dims the lights, it does not switch them off:

- every gun and headset paint drops to the low brightness setting
- the readout holds 2 seconds instead of 4, and a reload glance 1 second instead of 2
- the white start and respawn flashes are single, not double
- the down flash is unchanged and stays at full brightness, because a downed player has nothing to
  hide and is the one most likely to be shot again or walked into

Blackout is a separate switch and is the one that empties the lights. With blackout on, nothing is
written to either surface anywhere in the game except the down flash, which survives every setting.

## What a player actually sees

- **A dim body in your team colour**: the match is running and nothing has happened to you lately.
- **A bright body in your team colour**: you are armed but the game has not started.
- **The body drops to a short bar**: something just changed. Teal is your shield, purple your armour,
  and green, yellow or red is your health.
- **A blinking top segment**: you are half a step above the level below.
- **The bar goes to one red segment**: the next hit is likely to be the one that ends you.
- **Someone's head is dark**: they are alive and playing.
- **Someone's head flashes small and fast**: they are down.
- **Someone's head blinks white**: they are carrying the objective.
