# Handoff: the victim gun on the MacBook for the `t41` range test (2026-09-17)

For a fresh session on Tony's small MacBook, running step 3 of
[`bench-weapons-2026-09-17.md`](bench-weapons-2026-09-17.md) outdoors. **You arm both guns, then stay connected to the
VICTIM only** while Tony walks out and shoots: log every hit and report counts per distance. The desktop session has
released both guns and does the write-up afterwards.

Read [`mac-dev-runbook.md`](mac-dev-runbook.md) first for the setup that is not in git.

## What the test is

The shooter carries **two weapon slots that differ only in `$WEAP` t41** (the app's `gunRangeIndoor`), and ALT switches
between them. Each slot has its own damage, so the victim's `$HIR` magnitude names the slot:

| slot | t41 | damage | fire sound |
|---|---|---|---|
| 0 | **5** (low) | **1** | SMG `G03` |
| 1 | **75** (stock) | **21** | rifle `R01` |

At each distance Tony fires 5 stock, 5 low, 5 stock, single shots about 1.5 s apart. The two stock counts must agree or
that distance is void. If low matches stock everywhere, `t41` does nothing and the arsenal loses the range axis (Q15).

## The two guns

macOS gives BLE **UUIDs, not MAC addresses**, so do not pattern-match an address. Scan and pick the tagger by name:
the victim advertises as `Tactix-3D4F` and the shooter as `Tactix-E20D` (each may carry a name prefix).

**Step 1, arm the victim** (`Tactix-3D4F`) and confirm one hit at 2 m:

```
$VOL,65,0,*
$CLEAR,*
$START,*
$GSET,0,0,1,0,1,0,0,1,*
$PSET,2,0,999,0,0,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*
$SIR,0,0,,1,0,0,1,,*
$TID,2,*
$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*
$BMAP,0,0,,,,,*
$BMAP,1,100,0,1,99,99,*
$BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*
$BMAP,4,98,,,,,*
$BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$SPAWN,,*
$AMMO,0,32,384,1,*
$BMAP,0,0,,,,,*
```

999 HP is accepted (bench 2026-09-17) and stops the victim dying mid-run: 40 stock hits at 21 only spend 840.
Then start a traffic log (`session_log` action `start`), and keep it running for the whole test.

**Step 2, arm the shooter** (`Tactix-E20D`) with the two range slots, then DISCONNECT it so the link cannot interfere
while Tony walks out. Config, ammo and team all survive a BLE drop, so the gun keeps firing both slots correctly.

```
$VOL,65,0,*
$CLEAR,*
$START,*
$GSET,0,0,1,0,1,0,0,1,*
$PSET,1,0,45,0,0,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*
$SIR,0,0,,1,0,0,1,,*
$TID,1,*
$WEAP,0,,100,0,0,1,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,G03,,,,D04,D03,D02,D18,,,,,32,192,5,*
$WEAP,1,,100,0,0,21,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*
$BMAP,0,0,,,,,*
$BMAP,1,100,0,1,99,99,*
$BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*
$BMAP,4,98,,,,,*
$BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$SPAWN,,*
$AMMO,0,32,384,1,*
$AMMO,1,32,384,1,*
$BMAP,0,0,,,,,*
```

Check by ear before he leaves: slot 0 fires with the SMG sound (low range), ALT switches to slot 1 with the rifle
sound (stock range). If a slot will not fire, re-send its `$AMMO` and the last `$BMAP,0`.

## During the run

1. Tony calls out each distance before he fires. Write it down with the wall clock.
2. Count `$HIR` frames per distance and split them by magnitude: **21 = stock slot, 1 = low slot**.
3. Report after each distance: distance, stock hits of the first 5, low hits of 5, stock hits of the last 5, and the
   victim's HP.
4. If the victim dies, send `$SPAWN,,*` then `$AMMO,0,32,384,1,*` and say so: that distance is void.
5. If the link drops, reconnect and say which distance was running. Config survives a drop, so nothing needs re-arming.

## Rules

- **Once the run starts, leave the shooter alone.** Do not reconnect to `Tactix-E20D` mid-run: a re-push would reset its slots and ammo, and a live `$WEAP` resets the magazine.
- **Never end on a bare `$CLEAR`** (F11): clear, then send the `$SIR` row again.
- Keep `$GSET` token 2 at `0` (F162: `1` cripples reception).
- Cover nothing on the victim at distance, but note that at 2 m and closer the gun-body sensor catches headset shots
  (F228), so the sensor field is only meaningful at field distance.
- Note sun or shade per distance. IR reception outdoors is light-sensitive (F162).

## When Tony comes back in

Reconnect to **both** guns in the garage. Then:

1. Read the victim's HP with a `$QUERY`-free check: the last `$HP` in your log is enough, or send `$SPAWN,,*` plus
   `$AMMO,0,32,384,1,*` to reset it for another run.
2. If a distance was void or a count is in doubt, repeat it indoors at a known distance while both guns are linked, so
   the desktop session has a clean control.
3. Leave both guns armed and hittable: clear, then send the `$SIR` row again. Never end on a bare `$CLEAR` (F11).

## Reporting back

Post the per-distance table to the desktop session, and keep the log file path. The desktop session folds the result
into `docs/experiment-log/2026-09.md`, the runbook's status table and Q15.
