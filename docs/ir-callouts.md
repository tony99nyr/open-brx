# The IR callout bus (S57)

Design of record for S57, 2026-09-23. Tony's decisions are marked **Tony**. The table of event codes lives in ONE
constant (`IR_CALLOUT` in `app/src/engine.js`), so a later firmware or bench finding changes one line.

## What it does

When a player dies, their phone makes their own dead gun send ONE IR word. Every gun in range reports it, and each
phone that hears it plays a local callout. Nothing is relayed: only the gun where the event happened broadcasts, once
(**Tony**). No network is involved, so the callout arrives in about 50 ms.

The bus is **presentation only**. It never scores, never books a death or a kill, and never writes the ledger S56
keeps. Scoring stays with the victims' `hit_taken`/`death` facts and Mission Control (MC). A callout the bus misses
costs a sound, nothing else.

## The bench facts it rests on

- A host `$IRTX` word, protocol 15, reaches other guns as a silent `$HIR`. Magnitudes 1 to 39 register with no pool
  change and no native sound on the `<15,0>` fn-28 row (bench 2026-09-18, levers §13).
- A dead gun still forwards a host `$IRTX` through its headset (B23/B31). A dead gun does NOT register a fn-28 word,
  so a dead player misses callouts. That is acceptable: they are on the down screen.
- With friendly fire off, a gun drops a fn-28 word whose team field equals its own team.
- Magnitudes 2, 6, 8, 10, 50, 53 and 56 already mean something (native kill word, respawn and hill beacons, captures,
  boot). The bus never uses them.

## Event codes (`IR_CALLOUT`)

An IR word carries one player id, so ONE word names the killer and its magnitude names the victim's team:

| Code | Magnitude | Player id in the word | Meaning |
|---|---|---|---|
| `DOWN_BY` | 21 + victim's team id (21 to 24) | the killer | a player of that team went down; this player killed them |
| `DOWN` | 25 + victim's team id (25 to 28) | the victim | a player of that team went down; the killer is unknown (or it was the victim's own doing) |

All magnitudes sit in the bench-silent range 1 to 39, clear of 2, 6, 8 and 10. The word is protocol 15, subtype 0,
direction 100 (all domes), fired once (`$IRTX` field 9 = 1), from the victim's phone right after its death is booked.

The word's team field is `frames.callout_team`: a team id that no player in this match holds, compiled by MC. With
friendly fire on the gate does not apply and any value works. When all four team ids are in use (and friendly fire
is off), `callout_team` is null and the phone sends with the victim's own team: enemies still hear it, teammates do
not.

## What a receiving phone does

| Word | Condition | Callout |
|---|---|---|
| `DOWN_BY` | the player id is mine | KILL CONFIRMED: the kill cue (`_pickCue('kill')`) and the kill banner, with no victim name |
| `DOWN_BY` or `DOWN` | the victim's team is mine (not FFA) | TEAMMATE DOWN: a HUD chip only, no sound (**Tony**: no suitable line exists) |
| `DOWN_BY` or `DOWN` | the victim's team is another, or FFA | ENEMY DOWN: "Target down." (`VB8`) and a HUD chip |
| `DOWN` | the player id is mine | nothing (my own phone already knows) |

The first matching row wins, so the killer hears KILL CONFIRMED and not ENEMY DOWN as well.

**Kill confirm, first to arrive, once (Tony).** An IR `DOWN_BY` naming me and MC's `feedback{kind:"kill"}` both mean the same
thing. Whichever arrives first plays the kill cue. The other is suppressed within `CALLOUT_WINDOW_MS` (3 s). MC's
medal cues still play, because they carry information the IR word does not. The IR word never moves the score:
only MC's feedback does.

**Dedupe.** One word lands on several sensors about 14 ms apart. A word is keyed by `magnitude:playerId` and dropped
when the same key arrived within `CALLOUT_DEDUPE_MS` (600 ms). The window is short on purpose: a double kill of two
players on one team makes the same key twice, a second or so apart, and both must count. A callout word never overwrites `state().beacon`, which
stays the hill and station beacon.

## Scope (Tony, v1)

Deaths and kills only. Hill captures keep their native path: the grenade's own capture word already reaches nearby
guns, and the phones already play HILL CAPTURED from it. The code table reserves room for more events later.

## What MC must ship

- The silent `<15,0>` fn-28 row in EVERY mode's live table, not only the objective modes, so every gun reports the
  words.
- `callout_team` in the frame bundle, as above.

## Open questions for the bench (brx5)

1. Does the sender's own gun report its own host `$IRTX` (the self-hit reject), and does a dead gun really emit it?
2. With friendly fire off, does a word carrying an unused team id reach players on every team?
3. How many `$HIR` does one word make on a receiver, and how far apart (sets the dedupe window)?
4. Do magnitudes 21 to 28 on protocol 15 trigger any native sound, LED or pool change?
5. Range: does a word from a dead gun's headset reach as far as a live shot?
