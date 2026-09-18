# Handoff — Open BRX

**State as of 2026-09-18 (evening).** Jay (LaserTagMods) shared the stock firmware images, his ESP32 sources,
BC's command sheets and BC's 2018 app. A desk session read them into the repo on branch **`jay-drive-integration`**
(five commits, unmerged, not pushed). The morning's perks bench (`bench-perks-2026-09-18.md`) had already closed
F62 and the Energy Launcher bug. **Every firmware fact below is a disassembly reading, not a measurement on v4.32**;
the bench that settles them is `bench-firmware-levers-2026-09-19.md` (four sessions, a 20-claim checklist).

## Today

1. **F206 has a root cause and a shipped fix** (`d0f4c729`). The gun keeps ONE team byte; `$TID`, `$TEAM` and
   `$PSET` t2 all write it and the last writer wins. Our `$PSET` hard-coded t2 = 0 and the node writes one before
   every `$SPAWN`, so every gun went live as team 0 and dropped every enemy hit under `$GSET` t1 = 0. Now every
   `$PSET` carries the `$TID` team, `$TID` follows every `$SPAWN`, a turned (infection) player revives onto the new
   team, and `assert_team_byte_consistent` refuses any bundle where the two disagree (`test_f206_team_byte.py`).
   **One bench run confirms it** (levers sheet §1, runs a-f; run f is the TDM end to end).
2. **The command rail has three tiers** (`cbd05419`): `KNOWN_COMMANDS` (with arity and a bench-proven flag; the
   instrument says "not bench-proven" when it sends a new one), `DENIED_COMMANDS` (refused even with confirm:
   factory, DFU, pairing, `$IRT`, factory tests, zombie, `$SITE`, `$RESET`, radio frames, `SETUP`, `$DPLAY`), and
   unknown = confirm. The deny list reaches the phone as `NODE_DENIED_COMMANDS`; `engine._write` drops such a
   frame and `compile()` refuses to build one.
3. **Transport hardening is designed, two parts built** (`ba840b94`, `spec/transport-hardening.md`). The gun reads
   one serial byte per loop pass from a 1 KB buffer, a lost `*` corrupts the next frame, six audio waits block the
   loop with the port unread (`$DPLAY` reachable over BLE) and there is no hardware watchdog: a screamer no BLE
   command can reach. Built: the deny list, and `brxlink.WRITE_PACING` with a block pause that ships OFF. Designed
   and filed: F254 pacing and the runt `$SIR` rows, F255 write with response, F256 `$QUERY` read-back (the check
   that would have caught F206 at the lobby), F257 the lock-up detector (silence + no `$PONG` = power-cycle; the
   other half of F208), F258 whether `$PB*` joins the deny list. The S42 writer is being removed on
   `cut-live-accuracy` and was not touched.
4. **The protocol reference is tagged by evidence** (`protocol/brx-protocol.md` header: `[disasm]` `[sheet]`
   `[apk2018]` `[jay]`; no tag = bench). Headlines: `$SIR` fn 0-52 (24-27 are 5/4/3/2 s fuses; 34/35 work on a
   dead gun; 38 halves HP damage), p5-p8 named, `$WEAP` t1/t2/t19/t20/t25/t26/t30-t42 named, `$PSET` t6 crit
   bonus and seventeen sound ids at t7-t23, `$SPAWN` t1 shield, `$START`/`$STOP` gate IR reception, `$BUMP`'s real
   5-field shape, `$STUN,<ms>`, `$PRES`/`$TMP`/`$INVU`/`$BHIT`/`$FIREX`, the gun's own `$DD`, the native hosting
   vocabulary, protocol-15 station words. **Bench kept over disassembly in three places:** `$WEAP` t37/t38, the
   `$LIFE` token order, and the x1.5 crit at t7 = 0 (V4_31: the shooter multiplies by (100 + `$PSET` t6)/100, §9). The manual (`docs/manual/dev.md`)
   carries the same facts with their caveats, and contracts A20 now says fn 23, P16's "shield not BLE-writable" is
   gone, and the `$GSET` t2 polarity in `callsign-extract` is corrected (1 = indoor).
5. **Nothing changed on the wire, and one lead died.** A late V4_31 trace shows the range tokens (t2/t41, t13/t42,
   `$IRTX` field 8) set the IR **carrier frequency** (38 kHz minus 125 Hz per point on the gun), not power; the
   bench range curve is a receiver band-pass knee, so range calibrates in kHz (S48/S49). A t1 = 1 melee goes to
   the headset as an `$IRTX` at range t2/t41 and never reads t13/t42, so the empty t13/t42 on our melee row is not
   a K4 fix. K4 is the swing detection or the headset emitter; levers sheet §2 has the controls.

## Tomorrow

1. **Merge `jay-drive-integration`** after `npm run test:all -- --ui` on main, then the **levers bench**: session 1
   (45 min, two guns) is §1 F206, §2 melee, §4 `$STUN`, §5 `$BUMP`, §13 `$DD`. If `$STUN,3000` and `$BUMP,-20,1,1,1`
   behave as V4_30 says, run the rest; if not, v4.32 has drifted from V4_30 and most of the sheet can wait.
2. **After §1 passes:** close F206 (one dated line in the archive), and start F256 (the `$QUERY` team read-back),
   which is the cheapest guard against the same class of bug.
3. **§14 (transport) can run unattended** on one gun and a laptop; it gives F254/F255/F257 their numbers. Do not
   turn the block pause on before it.

## Open, not moved

F207 (the START echo false positive) and F209 (the respawn burst) from the 2026-09-13 playtest are untouched, and
the playtest branch's `_overheating()` design is still the better one for heat (see the 2026-09-17 handoff in
`git log -p -- docs/HANDOFF.md`). The perk build's node half (Motion Tracker, Second Wind, S52) is not started.
