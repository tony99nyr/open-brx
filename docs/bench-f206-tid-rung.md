# Bench rung: F206, does the gun emit the `$TID` we set? (A to B' run 2026-09-16)

The field read `$HIR` t4 = 0 while both guns held `$TID,1`, and TDM registered no hits. Our 2026-09-07 bench
armed `$TID,n` then `$SPAWN` and the word DID carry the team. So a plain `$SPAWN` is probably not the reset.
The phone's spawn burst differs: it writes a `$PSET` (the scream take) and the full `$SIR` table between
`$TID` and `$SPAWN`. This rung tells those apart. Two guns, A (shooter) and B (victim). `$HIR` t4 is the
4th token after `HIR`: `$HIR,<sensor>,<proto>,<shooter id>,<TEAM>,...`.

## Setup
1. `brx connect` A as alias `a`, B as alias `b`.
2. `.venv/bin/python mcp/tools/armgen.py 1 5 friendly_fire=1 > /tmp/armA.txt` (A: team 1, player 5).
3. `.venv/bin/python mcp/tools/armgen.py 2 6 friendly_fire=1 > /tmp/armB.txt` (B: team 2, player 6).

## Step A: the bench order (`$TID` then `$SPAWN`, nothing between)
4. `brx send_batch` alias `a` with the frames of `/tmp/armA.txt`, then alias `b` with `/tmp/armB.txt`.
5. `brx wait_for` alias `b`, prefix `$HIR`, while Tony shoots B with A. Read t4. Repeat 3 times.
6. Swap roles: `brx wait_for` alias `a`, prefix `$HIR`, while Tony shoots A with B. Read t4.

## Step A2: the phone order (`$PSET` + `$SIR` between `$TID` and `$SPAWN`)
7. Edit `/tmp/armA.txt`: copy its `$PSET` line and its `$SIR` rows to just before `$SPAWN,,*`. Same for B.
8. Repeat steps 4 to 6 with the edited files.

## Step B: re-send `$TID` after `$SPAWN` (the candidate fix)
9. `brx send` alias `a` `$TID,1,*`, and alias `b` `$TID,2,*` (guns still live from step 8).
10. Repeat steps 5 and 6. Read t4.

## Step C: TDM through MC with the candidate build
11. Run MC and the app from branch `fix/playtest-2026-09-13`. Hard-reload the console.
12. Push a two-player TDM, opposite teams, default settings (friendly fire OFF). Arm, start.
13. Shoot across teams 10 times each way. Read `hit_taken` count and `shooter_team` in the MC events.

## Measured 2026-09-16 (two guns, `$GSET` t1 = 1, no HUDs)
| Step | t4 on the victim |
|---|---|
| A: head (`$PSET` early, `$TID` last), then `$SPAWN` | correct both ways |
| A2: head, then one write `$PSET`, 10 `$SIR`, `$SPAWN`, `$PLAYX`, `$AMMO`, `$BMAP` | **0 both ways** (field bug reproduced) |
| B: live `$TID` after A2 | correct |
| B': A2 write with `$TID` right after `$SPAWN` | correct |
| Split, live guns, no `$SPAWN`/`$TID`: a lone `$PSET` | 0 |
| Split: a lone 10-row `$SIR` table | team kept |

Rule: **any `$PSET` clears the team; a later `$TID` restores it.** The build now writes `$TID` after the last
`$PSET` of every write (phone `_tidAfterPset`, stage `write`, driver `_send`). Step C is still to run with it.

## End every run armed, never on a bare `$CLEAR`
- Panic is `brx panic` (`$CLEAR,*` then `$SP,99,*`). It leaves the gun with NO `$SIR` table (F11): it
  cannot be hit.
- After a panic, re-send `/tmp/armA.txt` to `a` and `/tmp/armB.txt` to `b` before you stop, or power-cycle.
- Do not open the Callsign app on these guns: it resets `$NAME`.
