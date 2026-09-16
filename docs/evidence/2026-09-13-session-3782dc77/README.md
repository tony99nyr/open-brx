# Evidence — 2026-09-13 playtest, MC session `3782dc77`

The committed, sanitised extract of the MC session store behind
[`../../game-test-2026-09-13.md`](../../game-test-2026-09-13.md) (F206-F216). **The store itself is not in the
repo** — ~900 KB, one MacBook, and its node logs carry headset sticker ids. Everything the write-up argues
from is here instead, so the argument survives that machine.

Regenerate with `python3 extract.py [path-to-session.sqlite]` (default `~/.brx-mcp/mc/session-3782dc77.sqlite`).
The script documents what it strips and why, and it **refuses to write a file** if a sticker id survives
sanitising. Guns appear as their PIN-free aliases: `Tactix-3D4F` = ROCCO's, `Tactix-FE30` = TONY's.

| File | What it is | Read it for |
|---|---|---|
| `heads.md` | The three match configs **and the compiled head MC pushed to each gun**, byte for byte | Everything. `$GSET` t1/t2, `$TID`, the `$WEAP,0` ammo pair and its t39/t40 tail |
| `acks.md` | The six `ack_config` rows — what each gun echoed back | **F207/F201**: the echo reserve is the head's own t40 every time |
| `events.tsv` | Every `hit_taken` / `death` / `respawn`, in order | **F206** (none at all in the TDM match), **F209** (the 0.0 s bursts), **F208** (the last hit, then silence) |
| `status-changes.tsv` | The status stream, **deduplicated to changes only** | **F208**: one row, then a 105 s gap, is the freeze |
| `nodelog-*.log` | Six uploads from the two phones: engine log lines + the BLE frame ring | **F208** (`$BUT` arriving while nothing fires), **F203** (the stale-address retry storm), **F214** (`$PLAYX,0,*` at death) |

`status-changes.tsv` is deduplicated on purpose: 968 raw rows, most identical. A 105-second freeze reads as
one row and a long gap, instead of 53 lines that look like healthy traffic.

## Reading the timestamps

`t_recv` is epoch ms, MC's clock. The session ran **1789338636000–1789339818000** ≈ 2026-09-13
18:30:36–18:50:18 EDT. Node-log lines carry the phone's own wall clock in UTC, so `[22:47:34]` in a log is
`18:47:34` here. The three matches:

| match_id | mode | venue | go_live | ended |
|---|---|---|---|---|
| `fba981640d` | ffa | indoor | 18:36:21 | 18:42:59 |
| `a1003b7ae7` | tdm | outdoor | 18:45:05 | 18:45:47 |
| `f46fdd96e1` | ffa | outdoor | 18:46:40 | 18:49:21 |

## The one thing this extract cannot tell you

**No `$HIR` was ever emitted in the TDM match**, because nothing registered. So the store holds a team reading
for `$TID,1` only (it is 0, and it should be 1 — see the sheet's A1). `$TID,2`'s emitted value is unmeasured
and needs two guns. Do not infer it from anything in here.
