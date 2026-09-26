# Open BRX 1.0.0: what ships

Updated: 2026-09-25. Scope set by Tony on 2026-09-25. What comes after 1.0.0 is [`post-launch.md`](post-launch.md).

This page says what a group can do with Open BRX 1.0.0, and how sure we are that each part works. It is written
for a reader who knows laser tag and the Battle Company BRX tagger, but not our code. The detail lives in the
[spec](spec/README.md), the [mode catalogue](game-modes.md), the [weapon design](weapon-design.md) and the
[public manual](manual/). This page links to them and does not repeat their numbers.

## The version and the gate

The phone app is at 0.4.x today (0.4.12 is the newest published build). The target is 1.0.0. The gate is simple:
1.0.0 ships when the open MVP rows in [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench and decision) reach zero. A row
leaves that file in one of two ways: it closes into [`archive/followups-closed.md`](archive/followups-closed.md), or
Tony moves it to [`post-mvp.md`](post-mvp.md). This page names no date.

## What 1.0.0 is, in one paragraph

Each player carries an Android phone clipped to a stock BRX tagger. The phone holds the Bluetooth link to that
tagger and runs that player's game, so play does not depend on the laptop. Mission Control, on a laptop, sets
up the game, starts it over the field Wi-Fi, and adds up the result afterwards. Stations (a spare phone or an
M5StickS3) act as respawn points, pickups and hills. There are three game modes: Team Deathmatch, Free For All
and King of the Hill. The stock tagger firmware is never changed. All control goes over the tagger's Bluetooth
serial protocol, which LaserTagMods (JEDGE/JBOX) discovered.

## How to read the status column

- **proven**: a bench or field run showed it working. The evidence column gives the date and the place to read
  it, usually [`experiment-log/2026-09.md`](experiment-log/2026-09.md) or the archive.
- **bench pending**: the code is built, and an MVP BENCH row in `FOLLOWUPS.md` is still open for it.
- **building**: an MVP DESK or MVP DECISION row is open, or the work is planned and not started.
- **built**: closed at the desk and held by the test suite. It needs no gun, so it has no bench row.
- **unclear**: the rows, the log and the code do not decide it. Each one is listed at the end.

A proven feature can still carry an open row for one part of it. The evidence column names that row.

## Game modes

1.0.0 has three modes. Infection, Last Man Standing and Extraction are in the code but are post-launch
([`post-launch.md`](post-launch.md)). How each mode plays is in [`game-modes.md`](game-modes.md) and
[`spec/modes.md`](spec/modes.md).

| Feature | Status | Evidence or row |
|---|---|---|
| **Free For All.** Every player for themselves; kills score. | proven | 2026-08-30, the first full match on our stack (a 300 s FFA through Mission Control, `experiment-log/2026-08.md`); 2026-09-12, three FFA matches over mobile data |
| **Team Deathmatch.** Two teams; kills score for the team. | proven | 2026-09-16, two guns through Mission Control, 43 or more hits all credited to the right team after the F206 team fix. Q13 (team damage stays off) is bench pending |
| **King of the Hill.** Teams hold one hill; possession time scores. The hill is a phone or a Stick station. | building | F402: a KOTH game must not LOAD without a hill station. The hill rows F382, F383, F384, F385 and F386 are bench pending, and [`bench-2026-09-25.md`](bench-2026-09-25.md) sitting D is the first real KOTH bench. The chaos suite checks the win path at the desk for both hill sources ([`chaos-testing.md`](chaos-testing.md)). The mode itself ran through the gun on 2026-09-10 with the BRX grenade as the hill, which is post-launch |

## The phone app and HUD

The phone app is the per-player game engine. It links to the player's own tagger, holds the compiled game, and
shows the HUD: health, shield, ammo, the active weapon, kill confirms and alerts. It keeps playing when Mission
Control is out of reach, and it catches up when it comes back. The design brief is
[`spec/design/phone-hud.md`](spec/design/phone-hud.md); the node's rules are [`spec/node.md`](spec/node.md).

| Feature | Status | Evidence or row |
|---|---|---|
| Link the phone to its own tagger over Bluetooth, and relink after a drop mid-match | proven | Every field match since 2026-08-30; a headset power-cycle mid-match relinked in 2 s on 2026-09-24 (bench step 1.4). The P0 link loop under load (F293) and the setup metrics (F297) are bench pending |
| Find a tagger on Android 11 and older with Location off | bench pending | F340 |
| Join Mission Control on the field Wi-Fi | proven | Every field match since 2026-08-30 |
| Rejoin Mission Control with no tap when it is the same Mission Control (contract A60) | unclear | Built 2026-09-24 and 2026-09-25 (F346 closed its Lows); no bench or field record of it |
| Keep the Mission Control link on a field Wi-Fi with no internet | bench pending | F311 |
| Play over mobile data when the phone is off the field Wi-Fi (contract A28) | proven | 2026-09-12 field test: a Pixel on cellular played three FFA matches (B30 closed) |
| Play on with no link to Mission Control, then flush every event exactly once | proven | 2026-09-12: two minutes of real data loss mid-match, then an exact recap |
| In-play HUD: health, ammo, active weapon, KILL CONFIRMED | proven | 2026-09-12, KILL CONFIRMED on the shooter's HUD over mobile data. F394 (ammo pips out of step after ALT) is bench pending |
| Alert layering: three lanes, the player's own death first ([`announcer.md`](announcer.md)) | built | F352 and F368 closed 2026-09-25, from Tony's pick on the gallery |
| The death screen: what hit you ([`spec/contracts.md`](spec/contracts.md) A52) | built | S56 closed 2026-09-25; its field check is F313 in `post-mvp.md` |
| The full weapon-switch card when a pickup lands on the trigger | building | F400 (built at the desk; the on-gun timing check is open) |
| Share log, and the background log sync to Mission Control | proven | 2026-09-12 (A25 pulled both phones' logs with no player action); the 2026-09-13 game test was root-caused from these logs |

## Mission Control

Mission Control runs on a laptop. The operator works through its tabs in order: ARMORY, GAMES, KIT, LOBBY and
MATCH. It is setup, start and recap only: it is not linked to any tagger while the match runs. The operator
runbook is [`field-runbook-mc.md`](field-runbook-mc.md); the public walkthrough is
[`platform/run.md`](platform/run.md); the server's API is
[`../mcp/brx_mcp/mc/API.md`](../mcp/brx_mcp/mc/API.md).

| Feature | Status | Evidence or row |
|---|---|---|
| **ARMORY.** Enrol each tagger once, see every phone and station, and set up stations and pickups | proven | Used in every field match since 2026-08-30; stations since 2026-09-24 |
| Gamertags: at most 16 characters, with a warning from 13 to 16 | built | F366 closed 2026-09-25 |
| **GAMES.** Choose the mode, limits, life preset and loadout rules | proven | Every field match; the 2026-09-13 game test ran open-loadout matches |
| **GAMES redesign into PLAY and BUILD** | building | Planned for 1.0. A storyboard is in progress and nothing is built |
| Presentation presets, including **silenced**, which also silences the weapons | unclear | The presets exist (`mc/presentation.py`); none is logged on hardware. Silencing the weapons needs `$WEAP` t25/t26, which are unproven (F282, in `post-mvp.md`) |
| **KIT and LOBBY.** Assign taggers, kit players, try weapons, ready up, push the game with an echo check, and count down to a shared start | proven | 2026-09-16 and 2026-09-17 (F207 echo check; F183: triggers dead until T-0, then live on both guns) |
| **MATCH, live.** A live board from the phones' best-effort reports; end the match early | proven | 2026-08-30 (live streaks and a winner); 2026-09-12 (END from Mission Control) |
| **MATCH, recap.** The result goes to every HUD, and the recap stays provisional until every phone flushes | proven | 2026-09-12 field test |
| Station results after the whistle, and a warning when a station has not synced | built | F401 closed 2026-09-25 |
| Kill credit after the whistle, and team credit for a kill by smoke or EMP (A64, A65) | built | F354, F356 and F357 closed 2026-09-24 and 2026-09-25 |
| Alert colours: one catalogue for every warning | building | F221 (built; Tony reviews the gallery) |

## Utility stations

A station is a spare phone in its utility role or an M5StickS3. It advertises over Bluetooth, and a player's phone
decides "I am at the station" from signal strength. 1.0.0 has three station kinds: respawn station, pickup and
hill. Mission Control assigns each station its kind and id. The Stick runs in HELD mode: it stays on the Wi-Fi to
Mission Control all game. Stick stations use Bluetooth only; the Stick does not receive IR in 1.0.0. The design is
[`spec/utility.md`](spec/utility.md); the Stick is [`../hardware/m5sticks3/README.md`](../hardware/m5sticks3/README.md).

| Feature | Status | Evidence or row |
|---|---|---|
| Respawn station on a phone | proven | 2026-09-24 field log (`respawn{station:2}`, B23 closed). F345 (the 3 m range defaults) is bench pending |
| Respawn station on a Stick | proven | 2026-09-24 evening: a gun respawned at the Stick and Mission Control counted it |
| Pickup on a phone | bench pending | S58; F372's gate lists the phone pickup steps |
| Pickup on a Stick, with or without Mission Control in reach | proven | 2026-09-25 sitting B, online and offline (H9 closed). F374, F380 and F399 are bench pending |
| Hill on a phone | bench pending | F382, F384, F385; sitting D game 1 |
| Hill on a Stick | proven | 2026-09-25 sitting B: capture, contest and drain with real phones (H9 closed). F383 (the 5 to 7 m threshold) and F386 (the hill stops at the whistle, A68) are bench pending |
| Mission Control assigns each station a unique id (A66) | built | F364 closed 2026-09-25 |
| Edit a station's range on the station during play, synced to Mission Control (A67) | bench pending | F365 (the Stick half passed in part on 2026-09-25; the phone half has not run). F387 and F388 are bench pending |
| The Stick in HELD mode: configured by Mission Control over Wi-Fi, then placed on the field | bench pending | H8 (the Wi-Fi and Bluetooth coexistence and the battery cost are not measured). F389, F391, F392 and F397 are bench pending |
| The Stick's tamper lock during a match (A58) | proven | 2026-09-25 sitting B, A/B/A on the side button (F332 closed) |

## Weapons, perks and loadouts

Each player picks a kit of three slots on the phone: a primary, a secondary and a perk. The host sets the loadout
rules. The arsenal and its balance rules are in [`platform/arsenal.md`](platform/arsenal.md) and
[`weapon-design.md`](weapon-design.md); the perks are in [`perk-design.md`](perk-design.md); the loadout contract
is [`spec/loadout.md`](spec/loadout.md).

Pickups are part of 1.0.0. There are three: Rockets, Rail Gun and Overshield. The operator sets them up in the
ARMORY only, and they are on by default. The mechanism is [`spec/powerups.md`](spec/powerups.md).

| Feature | Status | Evidence or row |
|---|---|---|
| Three-slot kit picked on the phone, under the host's loadout rules | proven | 2026-09-13 game test (open loadout, with a perk in play) |
| Weapon fire rates on a real gun | proven | 2026-09-24 bench 3.2 (Shotgun, Desert Eagle, Burst Rifle) |
| Per-weapon range | bench pending | F231 and Q15 |
| Recoil on sustained fire (the Assault Rifle's ladder) | bench pending | F308 (bench 4.3 passed on 2026-09-24; the tuned value ships and sitting C re-checks the feel); F274 (the write budget, soak) |
| The Charge Rifle | bench pending | F226 |
| The Toxin Rifle (poison over time) | bench pending | F292 |
| Perks | proven | The perk levers were answered on the 2026-09-18 perks bench; Body Armor played in the 2026-09-13 game test. The perk values since then are balanced at the desk |
| Easy Reload: the ALT button reloads, for a player who cannot work the lever | proven | `experiment-log/2026-08.md`, 2026-08-27 (`alt_reload` proven) |
| Pickups: Rockets, Rail Gun and Overshield, on by default | building | F372 (on by default once the powerup bench passes). S58, F379, F381 and F394 are bench pending; F400 and F403 (the briefing names the pickups) are building |

## Health, shields and respawn

A game uses one life preset: Standard, Shields or Hardcore. A down player comes back on a timer or at a respawn
station. The gun lights and the headset tell the player their state. The respawn rules are in
[`spec/node.md`](spec/node.md) and [`spec/contracts.md`](spec/contracts.md) (A49); the lights are
[`led-language.md`](led-language.md).

| Feature | Status | Evidence or row |
|---|---|---|
| Standard life preset | proven | Every field match |
| Shields life preset: a Halo-style shield that recharges, with the shield bar on the HUD | bench pending | F298, F348, F349 |
| Hardcore life preset | unclear | Built and in the balance tests (`experiment-log/2026-09.md`, 2026-09-23); no bench or field record |
| Timed respawn | proven | 2026-08-30 (12 respawns in one match); every field match since |
| Station respawn | proven | See *Utility stations* |
| Per-player kill credit: the shooter is known from the hit | proven | 2026-08-30 (12 kills credited); kill credit follows the last damaging hit (F354 closed) |
| The LED language on the gun and the headset | bench pending | S10; F296 (the down pattern still reads as a hit) |
| IR callouts: a death is announced gun to gun with no network ([`ir-callouts.md`](ir-callouts.md)) | bench pending | S57 |

## The announcer, medals and awards

The phone speaks and shows events through one announcer queue, one item at a time, in priority order. Mission
Control awards medals and end-of-match awards. The queue is [`announcer.md`](announcer.md); the medals are
[`spec/modes.md`](spec/modes.md) and contracts A61 to A63.

| Feature | Status | Evidence or row |
|---|---|---|
| One announcer queue for voice lines and HUD banners | bench pending | F351 closed 2026-09-25; the gun-audio rows F375, F158 and F50 are bench pending |
| Kill confirms and voice lines on the gun | proven | 2026-09-12 field test |
| Kill medals: first blood, the multi-kill ladder and streaks | proven | Medals reached the recap in the 2026-09-12 field test (F150); Tony confirmed the ladder by ear on 2026-09-24 (A61) |
| The melee and Killjoy medals (A62, A63) | built | F361 closed 2026-09-25 |
| End-of-match awards table (A63) | built | Built 2026-09-24; no bench gate |
| Recap medal icons | built | F367 closed 2026-09-25 |
| Mode art on the phone briefing | building | S32 (Tony's two renders) |

## Releases and setup

| Feature | Status | Evidence or row |
|---|---|---|
| One-command setup and start: `./start.sh`, `start.cmd` | built | `mcp/tests/test_launcher.py`; no newcomer run is logged |
| Release-signed Android app from GitHub Releases | proven | 0.4.6 was the first release-signed build (2026-09-24); 0.4.12 ran on all three bench Pixels on 2026-09-25 |
| The iOS app | building | B21 (the iOS half: distribution and the WebView debugging switch). A source build ran the 2026-08-30 match on two iPhones |
| Bug reports: a scrubbed zip for a public GitHub issue | built | `mcp/tests/test_mc_report.py`; no field use is logged |
| Laptop-only play: one command, the laptop holds every Bluetooth link | proven | 2026-08-25, a scored Team Deathmatch on two taggers ([`platform/run.md`](platform/run.md)) |

## Known limits in 1.0.0

- **Mission Control is not live during play.** It sets up, starts and recaps. The live board shows the phones'
  best-effort reports, and a player out of Wi-Fi shows as stale until they walk back. This is by design (ADR
  [0001](adr/0001-companion-rider-architecture.md), [0002](adr/0002-laptop-mission-control-host.md)).
- **Some IR facts are unproven.** The headset hit word's range (F275), the `$GSET` t2 reflection theory (F198), the
  range lever (Q15, F231), weaker first trigger pulls (F232) and a gun with no headset (B26) are all open.
- **The Bluetooth link can still loop under load** (F293), and the setup has no measured metrics yet (F297).
- **A player can be dead on the gun and alive on the HUD** with nothing to repair it (F264). A reload that never
  completes is not noticed (F277).
- **The iOS app is not release-signed** (B21). An iPhone station cannot set its advert power, so Mission Control
  hides STRENGTH for it.
- **A pickup or hill game can flood a phone's Bluetooth scan** (F342).
- **A Stick out of Wi-Fi misses some signals.** A Stick carried out of Wi-Fi before START advertises its pickup
  early; the player's phone refuses the claim (F374). An operator or objective end does not reach a Stick out of
  Wi-Fi (F386, accepted for 1.0.0).
- **PANIC is a stop, not a pause.** A panicked tagger cannot be hit until it is re-armed.
- **Untried at scale.** No match has run with more than two player phones, a 20-minute soak, or a dispersed start
  with players out of Wi-Fi before T-0 ([`post-mvp.md`](post-mvp.md), *System proofs*).

## Status unclear

- Rejoin Mission Control with no tap (A60): built, with no bench or field record.
- Presentation presets, and the silenced preset's weapon half (F282 is a `post-mvp.md` row, not an MVP row).
- The Hardcore life preset: built, with no bench or field record.
