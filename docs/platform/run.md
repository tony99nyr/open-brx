# Running a match
Last verified: 2026-09-12

How to get from a bag of taggers to a finished game with a scoreboard. There are two ways to run
one, and the simpler way needs nothing but a laptop.

## The two ways to run a game

**A laptop on its own.** Your laptop holds a Bluetooth link to every tagger and runs the whole game.
Everyone has to stay within Bluetooth range of it, which is a room or a small yard. This is the
simplest thing that works and it is proven on hardware: on 2026-08-25 one command ran a full scored
Team Deathmatch on two real taggers, with spawn, hits, deaths, host-driven respawn, a frag limit and
the correct winner. A three-tagger synced start is proven too. The command is:

```
python -m brx_mcp play tdm <addr1> <addr2>
```

Get the addresses from `python -m brx_mcp scan`. Add `outdoor=1 volume=90` outdoors: the default
volume of 80 is set for indoors, and anything near 69 is roughly on-tagger level 2 and is inaudible in
the open.

**Mission Control plus a phone on every tagger.** Each player carries a phone running the BRX Combat
HUD, which holds the Bluetooth link to that player's tagger and runs that player's game. Mission
Control on a laptop writes the game, starts it and adds up the results over the field Wi-Fi. This
is what scales to a real field, because the Bluetooth link rides the player instead of sitting on
the laptop. It has run whole matches: a 300 second free-for-all on 2026-08-30 with two iPhones and
a MacBook host, and an outdoor Team Deathmatch on 2026-09-01 with two Android phones. It is also
unfinished and changes week to week, and the published Android build can be behind the current game
rules. Four things have never been run: a dispersed start with players out of Wi-Fi range before
T-0, a recovery after real coverage loss, more than two phones, and a 20 minute soak.

## What you need

For the laptop-only way:

- A laptop with a Bluetooth radio (Windows, macOS or Linux) and Python 3.11 or later.
- The software: `pip install -e ./mcp` from a clone of the repository.
- Your taggers, each with a charged headset **switched on**.

For Mission Control plus phones, all of the above, and:

- A Wi-Fi router for the field. It needs no internet. A battery travel router is the recommended
  option and is what both live matches used. The laptop's own hotspot works for a small game.
- One phone per player, with the BRX Combat HUD installed and paired to that player's tagger
  **before** match day. Install it at home, where there is internet.
- The armory map for your taggers (`~/.brx-mcp/armory.json`) on the machine that will host.
- Optional, for phones that have a data plan: internet at the laptop and `cloudflared` installed. See
  *Reaching phones over the internet* below.

## Before the players arrive

**Once per tagger (the armory).** Do this at home, once, and again only if you re-pair a headset or
rename a tagger. Stock taggers are identical and unlabelled, so this is what makes each one
self-identifying.

1. Power on **exactly one** tagger and switch every other one off. With a single tagger visible on
   Bluetooth, the advert you see is certainly the tagger in your hand.
2. Cable it to the machine over USB (the "Programing Port") and run
   `python -m brx_mcp enroll <GunName>`. That reads the device record, saves a backup, binds the
   serial number to the Bluetooth address and writes the tagger's name.
3. Name the tagger its **headset sticker code**, not a player's nickname. The tagger then announces itself
   on every scan, and nicknames stay a display layer in Mission Control.
4. Print that same code on a label and stick it on the tagger, so anyone can grab a tagger and its
   correct headset without guessing.
5. Power-cycle the tagger and run `python -m brx_mcp armory` to confirm the row.

`~/.brx-mcp/armory.json` holds headset PINs. Keep it out of any repository, and copy it to the
match-day machine: a fresh laptop has an empty one and will show no taggers.

**Every match.** Charge everything. Use taggers that have been powered off since the last session,
because a tagger left powered all day starts refusing links. Put the router up, join the laptop to
it, and start Mission Control so its output is saved rather than scrolled away:

```
python3 -m brx_mcp.mc -v 2>&1 | tee ~/mc-$(date +%Y%m%d-%H%M).log
```

Open the exact link it prints, including the `#tok=` part. That is the operator token, and it is
new every launch. On each phone: join the game Wi-Fi and set it to auto-join, turn **mobile data
off** on Android, and turn Do Not Disturb on.

## Muster

This is the per-game arming, and it is where a bad start gets caught.

1. **Eyeball every headset first.** A headset slow-blinks rainbow when it is disconnected or
   unpaired, and a tagger with a dark or unpaired headset **silently refuses to join**, with no error
   and no voice line. This is the single most common cause of "only two of the three taggers started".
   A settled headset shows its team colour before the game and goes dark once play begins, which is
   normal.
2. **Get each player onto a tagger.** Add the player in Mission Control and assign their tagger; the
   player opens the HUD and taps Set My Tagger. The player's row goes from "no node" to linked.
3. **Kit them out.** Set display name, team, weapon and voice. A weapon change can push a silent
   try-out so the player fires and reloads to feel it. A configured but unspawned tagger ignores
   incoming shots, so try-outs are safe in a crowd. Point the tagger away from people anyway.
4. **Ready up and push.** Players ready up on their phones, then you push the configuration to every
   tagger. Each tagger answers with an echo. A tagger that does not echo is almost always a headset problem,
   and it blocks the start. Add every player **before** the push: a player added afterwards is not
   sent a game and needs a re-push.
5. **Check the board has no reds.** Amber never blocks a start. Reds do, and each one names its own
   fix.
6. **Start with a runway.** The default is 120 seconds, which is walk-to-your-base time. Every phone
   counts its own tagger down and spawns it at zero, so no signal is needed at the moment of start.
   Confirm every player shows armed and counting. If you need to abort, do it **before** players
   scatter: a phone already out of range never hears the cancel.

On the laptop-only way, muster is the same eyeball check plus the one `play` command, which
configures every tagger first and then spawns them together.

## Reaching phones over the internet

By default the field is an island: phones reach Mission Control over the field Wi-Fi and nothing else. If the
laptop has internet (a travel router with a SIM, or tethered to a phone), you can also let any player phone
that has a data plan reach Mission Control from wherever it has signal. Nothing is installed or configured on
the phones. This is optional, and a match never depends on it.

1. Install `cloudflared` on the laptop once (`brew install cloudflared` on a Mac). No account, no login.
2. Start Mission Control as usual. On the **Armory** screen, in the join panel, find **REACH** and press
   **TURN ON** under INTERNET. The row reads STARTING, then UP with a hostname. If it reads ERROR, the text
   beside it is the reason; the usual one is no internet at the laptop.
3. The join QR now carries both addresses. New phones scan it as always. Phones that already joined over
   Wi-Fi pick the internet address up by themselves; nobody rescans.
4. In the **Lobby**, each row shows LAN or BACKHAUL, and the header says how many phones are on backhaul. A
   phone on backhaul keeps getting kill confirms, score and the result anywhere it has signal. When every
   phone on the board is on backhaul, the score-cap and last-one-standing ends become live across the whole
   park.

What it needs and what it does not do: the laptop must have internet; the phone must have a data plan and a
signal, so a park with no cell service plays exactly as it does without it; the time limit is still required.
If the tunnel dies, a banner says so on every screen and the phones fall back to Wi-Fi on their own. Turning
it back on gives a new hostname, which only matters for a phone that never comes back into Wi-Fi range: that
one rescans the QR. You can also start with the tunnel on: `python -m brx_mcp.mc --tunnel`.

## During the match

Mission Control is setup, start and recap only. It is **not** Bluetooth-connected to any tagger while
you play. Each phone runs its own tagger's game loop and reports over the Wi-Fi when it can.

You can watch the live board, end the match early, recall a running game, and (with an explicit
confirmation) panic-stop the reachable taggers. A panic leaves a tagger unable to register hits until it
is re-armed or power-cycled, so it is a stop, not a pause. You cannot change loadouts, add players
or re-push a game once it is live.

A player who walks out of Wi-Fi range is **stale, not gone**. Their row shows the last known values
and how old they are, their events queue on their own phone, and everything flushes and is credited
exactly once when they walk back into coverage. So a scoreboard can be behind while the final result
is still correct. Tell players not to press the power button and not to take calls: a locked or
backgrounded phone pauses the HUD's timers until it is back in front.

## After

At the time limit, or when you end the match, Mission Control works out the winner, per-player
kills, deaths, accuracy and medals. The recap stays **provisional** until every player's phone has
flushed its events, so a player still walking back can still change a number.

Before anyone closes the app, have each player hit **Share log**. The HUD keeps its log and the last
60 raw Bluetooth frames in memory only, and closing the app loses them. Then copy off the session
database (`~/.brx-mcp/mc/session-<id>.sqlite`) and the log you saved above. Results export as CSV,
and every finished match of the session stays available. Starting the next game is one action, and
you can keep or clear the roster. Power the taggers off between sessions.

## When something goes wrong

**Only some of the taggers joined.** A headset that is off, unpaired or flat makes its tagger refuse to
join, silently. Look for the rainbow blink, fix the headset, power-cycle that tagger and push again.

**A phone shows as on the wrong Wi-Fi, or Mission Control unreachable.** The field router has no
internet, so Android decides the network is dead and moves the phone onto mobile data. The link then
leaves over cellular and never arrives. Turn mobile data off on that phone, and check auto-join is
on for the game network. With the internet tunnel on (see *Reaching phones over the internet*) this stops
being a fault: that phone reaches Mission Control over mobile data anyway and its row reads BACKHAUL.

**A tagger will not connect, or connects and drops straight away.** A tagger left powered all day
starts doing this: power-rest the taggers between sessions. Establishing a Bluetooth link succeeds
roughly one attempt in three anyway, and the automatic retry is the fix, so give it a moment. If a
tagger never appears at all, a forgotten `brx_mcp` process from an earlier session may still be holding
it: a held tagger stops advertising and looks broken. Kill the old process and it comes straight back.

**A tagger is called Tactix2 again.** Someone opened the Callsign app on it, which wipes the name you
enrolled. Re-stamp it with `python -m brx_mcp rename <address> <name>`, and do not open Callsign on
an enrolled tagger.

**The console says the operator token is required, or shows Mission Control offline while the server
is plainly running.** That is nearly always a stale token: a bookmark without the `#tok=` part, or a
restart, which mints a new one. Open the link the server printed this time.
