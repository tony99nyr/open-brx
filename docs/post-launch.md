# After 1.0.0

Updated: 2026-09-25. What ships in 1.0.0 is [`release-1.0.md`](release-1.0.md).

This page is the roadmap after 1.0.0, grouped by theme. It is a reading guide, not a backlog. The backlog of
record is [`post-mvp.md`](post-mvp.md): every id below is a row there, unless the text says otherwise. Read the
row for the detail, the evidence and the open questions. Nothing here has a date or a promised order.

## How an item gets into a release

An item moves into a release when Tony schedules it. The row then moves from `post-mvp.md` to
[`FOLLOWUPS.md`](FOLLOWUPS.md) with its id unchanged, and the row says why. From then on it counts toward the
release gate, the same as any other MVP row. An idea that has no row yet gets one in `post-mvp.md` first. The id
rules are in the `FOLLOWUPS.md` header.

## Game modes

1.0.0 ships Team Deathmatch, Free For All and King of the Hill. Extraction is the flagship mode after launch:
players carry loot to an extraction point before the zone closes ([`extraction-design.md`](extraction-design.md)).
Infection and Last Man Standing already exist in Mission Control's code, but neither has run a real match, and
neither has its own row yet. Gun Game hands each player a new weapon at every spawn. A tutorial mode, Syphon (the
killer heals), and several hill variants (roaming hills, Territories, a rotating hill, a rate-of-fire boost for
the holding team) are designed or partly specified in [`utility-roadmap.md`](utility-roadmap.md) and
[`game-modes.md`](game-modes.md). Adding a mode is still harder than it should be; the extensibility rows fix that.

Ids: S3 (Extraction on the phone), S60 (Gun Game), B17 (tutorial), S14 (Syphon), F95, F98, F83, F87, F93 (hill
variants and proximity), E2, E3, E4, E6, E7 (extensibility). F377 (solo Last Man Standing picks no winner) is
still an MVP row in `FOLLOWUPS.md` today.

## Station kinds and the Stick

1.0.0 has three station kinds: respawn station, pickup and hill. The station advert already reserves an
extraction point and a bomb site ([`spec/utility.md`](spec/utility.md)); neither is built as a station, and
neither has its own row yet. The Stick is Bluetooth-only in 1.0.0, and two IR features wait. Stick IR receive
would let a Stick hear a tagger's shot; the Stick's onboard receiver cannot decode a BRX shot, and an external one
can. The grenade hill uses a BRX Smart Grenade as the hill; it ran through the gun on 2026-09-10 and stays
selectable, but it is not a 1.0.0 feature. MUSTER, the Stick mode that drops Wi-Fi for the match, is post-launch; HELD is the 1.0.0 mode.

Ids: F338 and F314 (Stick IR receive and the grenade hill), F312, F70, F82, F88, F89, B8, G3, F75, F76 (the
grenade hill and multi-point control), F99, F100, H7, S49, B4, S36, P15 (other station hardware and limits).
F390 (MUSTER has no way back to Mission Control) is an MVP DECISION row in `FOLLOWUPS.md` today.

## The revive count

A station respawn works in 1.0.0; counting the revives each station gives does not ship. Both halves of the count
are built, but Tony switched the count off for 1.0.0, and the phone half waits on a branch. When it returns, the
Stick counts a revive from the player's own advert state, not from signal strength. Tony also wants a visible
"redeploy" flash on a revive.

Ids: F344.

## The armour pickup

A pickup that grants armour or health, beside the Overshield that ships in 1.0.0. The `$LIFE` lever that a pickup
would use is proven on the bench, and [`utility-roadmap.md`](utility-roadmap.md) sketches the station. There is no
row for the pickup itself yet.

Ids: F109 (the host-granted shield and heal lever), F60, Q12, B20 (how a heal or shield reaches a game and the
HUD), F100 (a wearable powerup that death drops).

## Mission Control features

A spectator view for a screen pointed at the room: a read-only first version exists, and the broadcast treatment
(big animated scores, feed replays) is the open part. A daylight or high-contrast theme, because the console has
one dark theme and a laptop in sunlight is hard to read. Live range calibration: a screen on the utility phone
sets the range while each player's HUD shows IN RANGE or OUT OF RANGE, so players can walk the edge. Smaller items: a write UI for the presentation presets, a
one-tap app update screen once store builds exist, and session totals owned by Mission Control.

Ids: S25 (spectator view), F317 (daylight theme), F373 (range calibration), S2, S27, F24.

## Weapons, perks and balance

The next balance pass makes every perk a real choice and moves perk charges onto the match clock. Stance and
flinch (node-driven accuracy) come after the recoil that ships in 1.0.0. Several weapon questions wait on bench
work: whether the Suppressor really suppresses its flash and sound, the Energy Rifle's overheat, and per-venue IR
power. The perk rules and the next wave of perks are in [`perk-design.md`](perk-design.md); the balance rules
are in [`weapon-design.md`](weapon-design.md).

Ids: S50, S51, S42, S43, S13, S47, S28, F281, F5, K1, K2, K6, F128, F229, F315, F282, S48, F63, F66, F67, F39,
F336, U11, D1.

## iOS

The iPhone app builds from source and has played a match, but it has no store or TestFlight path. The iOS half of
B21 (distribution and the WebView debugging switch) is still an MVP row in `FOLLOWUPS.md`. After that, the iPhone
has its own fixes: a camera crash, an inflated debug-panel font, and a locked-phone Bluetooth check.

Ids: F112, F126, S27, and the *iOS locked-phone BLE* check in `post-mvp.md` *System proofs*.

## Audio and voice

A phone-side audio channel would let the HUD play clips through the phone speaker. Players could pick their voice
on the HUD and hear the tagger speak during setup. Several wrong or missing sounds remain from the field tests.
The sound bank is catalogued in [`reference/sound-catalog.md`](reference/sound-catalog.md).

Ids: E5, S30, S31, S1, S9, B11, B14, B28, B29, P19, F120, F114, F214, F262, F59.

## Lights

A few headset light faults seen at the bench and in the field: a yellow flash under sustained fire, a dead-state
flash while alive, a team colour lost after a miss, and a respawn that wedges the out-blink. The design of record
is [`led-language.md`](led-language.md).

Ids: F227, F216, F68, F13.

## HUD and console polish

The Low findings from the visual-QA passes and polish loops. None of them blocks a match.

Ids: F316, F313, F331, F355, F359, F360, F362, F107, F14, F17, F19, F32, F250, F111, S53, S59, S6, F20, F26, F27,
F29, F130, F176, F177, F186, F204, F266, F267, F12, F30, S7.

## Protocol, firmware and research

Desk research on the stock firmware images (read only, never hosted and never flashed), the undecoded commands,
and the bench measurements that would make the IR model exact. Publishing any firmware-derived detail waits on
Battle Company's answer.

Ids: R4, F300 to F307, F320, F321, F323, F324, R3, F162, F171, F195, F167, F168, F169, F28, P3, P4, P8, P12, P14,
Q16, F285, F286, U2.

## Hardware, tooling and the site

The BRX Companion (an ESP32 rider that could replace the phone), a push-button reload handle, IR emitter tooling,
the Lighthouse pass on the public site, and the code and docs DRY backlog.

Ids: B1, H1, R2, S33, S19, F42, F16, F131, F132.

## Proofs that need players, space and time

Some checks need more than two players, a field or a long session: more than two phones, a 20-minute soak, a
dispersed start, a phone rejoining the field Wi-Fi, and the old bench rungs. They are listed in `post-mvp.md`
*System proofs* and *Old bench rungs*, not as numbered rows.
