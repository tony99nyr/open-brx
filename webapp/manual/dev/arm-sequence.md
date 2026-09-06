# The arm sequence: from `$CLEAR` to a live gun
_The exact frame order that takes a tagger live, respawns it, and ends the game. Send these frames in this order. We captured the order from the official app and reproduced it with our own host._
Last verified: 2026-09-06

## The headset is a second device and it needs time
A command that the tagger must relay to the headset is received, processed and executed there, not instantly. Send `$SPAWN` within about 2 seconds of a death and the headset never executes it: it stays stuck flashing the green out-blink while the gun is alive and registering hits normally, so the player looks dead while playing normally. Measured 2026-09-02: gaps of 1.0 s and 2.0 s stick, and 2.5 s, 3.0 s and 6.0 s are clean. **Leave at least 3 seconds.** The same applies to anything else with a headset side effect, such as `$HLOOP` and `$HLED`. Note the gun queues commands and drains them one at a time, so a frame echoing back proves the gun received it, not that the headset executed it.
Source: docs/experiment-log.md 2026-09-02 (night, last)

## `$CLEAR` wipes the `$SIR` table and the gun then ignores every hit
This is the single most confusing failure mode we have found: the gun arms, spawns, reports full pools, answers `$QUERY` normally and looks perfectly healthy, while every shot that reaches it is discarded. There is no `$HIR`, the headset stays dark, and the pools never move, so it presents as a broken headset or a dead sensor. It is neither. The `$SIR` matrix decides what an incoming IR word does to this gun, unmatched cells are silently ignored, and after `$CLEAR` there are no cells at all. Re-sending the `$SIR` rows alone restores it immediately. Bench-proven 2026-09-02: deterministic 5/5, and independent of how long you wait between `$CLEAR` and `$SPAWN` (tested 0.05 s to 1.0 s). Note the table SIZE does not matter, only its absence: a one-row table and the full ten-row table both registered 24/24 in an interleaved A/B.
Source: docs/experiment-log.md 2026-09-02 (night, FINAL)

This sequence was captured from the official iOS app driving a live game on firmware v4.32, then reproduced byte-for-byte by our own host on real taggers. Three pieces were missing from every earlier attempt: **`$AMMO` after spawn**, **`$BMAP` before *and* after spawn**, and the **empty token in `$SPAWN,,*`**.
Source: protocol/session-findings-2026-08.md §7e, §7o; protocol/captures/2026-08-23-ios-callsign-game-start.txt

```text
$CLEAR,*
$START,*
$GSET,1,0,1,0,1,0,50,1,*
$PSET,0,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*
$WEAP,0,...                (primary)
$WEAP,1,...                (secondary)
$WEAP,4,...                (melee, always sent)
$SIR,... x10               (incoming-IR effects table)
$BMAP,0,0,,,,,*   $BMAP,1,100,0,1,99,99,*   $BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*  $BMAP,4,98,,,,,*          $BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$TID,<team>,*              (ours; the app relies on defaults)
$PLAYX,0,*
$PLAY,VA81,4,6,,,,,*       (go-live voice cue)
$SPAWN,,*                  <-- go-live (note the empty token)
$AMMO,0,36,108,1,*         <-- load magazines
$AMMO,1,6,12,1,*
$BMAP,0,0,,,,,*            <-- trigger re-mapped AFTER spawn
```
Source: protocol/session-findings-2026-08.md §7e, §7k

_[diagram DEV-04: Sequence diagram: host → gun frames above, with the gun's echoes (`$LCD,0,0,0,0,0,0` after `$START`; `$LCD,45,70,0,0,36,216` after `$SPAWN`; `$ALCD` per shot; `$BUT` per trigger).]_

## What the gun echoes back
| After | Echo | Meaning |
|---|---|---|
| `$START,*` | `$LCD,0,0,0,0,0,0,*` | Cleared state |
| `$SPAWN,,*` | `$LCD,45,70,0,0,36,216,*` | Live: HP 45, armor 70, mag 36, reserve 216 (this config) |
| each shot | `$ALCD,35,100,0,108,0,*` … | Mag decrementing, slot 0, reserve, heat |
| each trigger | `$BUT,0,1,*` / `$BUT,0,0,*` | Press / release |
| ~30 s | `$VOLTS,7634,3770,53,45,*` | Telemetry continues in-game |
Source: protocol/session-findings-2026-08.md §7e

## The config head is silent and safe.
Writing `$CLEAR … $TID` without `$SPAWN` plays nothing and **a configured-but-unspawned gun ignores IR**: no `$HIR`, no `$HP`. "Get some" and the cocking sound belong to `$SPAWN`. A head held unspawned for ~2 minutes then spawned went live with config intact.
Source: protocol/session-findings-2026-08.md §7r

## Death and respawn are host-driven
1. Victim reports `$HP,0,0,0,*` then `$LCD,0,0,0,1,1,1,*`. The gun does **not** revive itself, and a dead gun's trigger produces `$BUT` events but no `$ALCD` decrement (it cannot fire).
2. The app sends `$HLOOP,0,0,*` ~1.7 s after death.
3. After the game's respawn delay (the app's own timer, ~10 s in the capture; 👥 community: a per-death ramp capping at 45/90 s) the host sends `$SPAWN,,*`.
4. Gun echoes `$LCD,45,70,0,0,36,216,*`: HP, armor **and ammo** restored with no `$AMMO` needed.
5. **A dead gun ignores all incoming IR**: 448 distinct words, including every grenade-beacon shape, failed to revive one. Only the host can.
Source: protocol/session-findings-2026-08.md §7f, §7j(community ramp), §7q (dead gun cannot fire); docs/experiment-log.md 2026-08-26 ("448-word brute force: a DEAD gun accepts NO IR")

## After a BLE drop, re-send the whole head.
Re-sending the full sequence (`$CLEAR`→`$START`→…→`$SPAWN,,*`→`$AMMO`) on a fresh link brought a gun back in every bench case.
Source: protocol/session-findings-2026-08.md §7r, §7r addendum

```text
# Clean end-of-game, as the official app does it (note the ~3.9 s settle before the last $PLAY):
$VOL,69,0,*
$HLED,,6,,,,,*
$STOP,*
$CLEAR,*
$PLAY,VSF,4,6,JAY,,,,*     # victory sting (slot 1) + "victory" announcer (slot 4); solo game: $PLAY,VS6,4,6,,,,,*
```
Source: protocol/session-findings-2026-08.md §7e, §7n, §7o

- **Do I need the reload-handle pull?** No. The manual's reload-handle pull is the *local* start; `$SPAWN,,*` is the *remote* one. Both exist.
- **Where do respawn time, game time, lives and score-to-win go?** Nowhere on the gun. Three captures at respawn 5/15/30 s gave byte-identical `$GSET`/`$PSET`. Your host keeps the clock.
- **Is the second `$BMAP,0,0` (after `$SPAWN`) needed?** Yes. Omit it and the trigger is dead.
Source: protocol/session-findings-2026-08.md §7e · protocol/session-findings-2026-08.md §7n · protocol/session-findings-2026-08.md §7e, §7r addendum
