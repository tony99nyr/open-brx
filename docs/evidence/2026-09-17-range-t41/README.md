# Evidence — 2026-09-17 garden range test

`victim.jsonl` is the full traffic capture from the victim gun's BLE link for the whole session, both
directions, timestamped (`session_log`). It is the evidence behind every number in
[`../../experiment-log/2026-09.md`](../../experiment-log/2026-09.md) (2026-09-17 afternoon) and behind
**F231**, **F232**, **F233** and the closure of **F170**.

**What is in it.** Every `$HIR` (hit received, token 5 = magnitude, which names the slot that fired),
every `$HP`, every `$LCD`/`$ALCD`, and every frame Mission Control wrote — so each `$WEAP` head shows
exactly which `t2`/`t41` value was live for the hits that follow it.

**What is NOT in it.** The shooter's side. That gun was deliberately disconnected for the walk-out marks
per the run sheet, and it drops the BLE link past about 20 m anyway, so shot counts exist only for the
close marks and are read from the magazine walk (`$ALCD` token 1) in the log entry.

**Reading it.** Split by `$WEAP` writes to get the configuration in force, then count `$HIR` by magnitude
between writes. Hits cluster by distance with multi-second gaps where Tony walked. ⚠ Two caveats that the
log entry explains in full: the receiving dome was in direct sun for the whole hour, and the first two
trigger pulls of any group are weaker than the rest (F232), which handicaps the first two shots of every
group in here.
