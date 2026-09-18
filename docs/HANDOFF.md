# Handoff — Open BRX

**State as of 2026-09-18 (night).** Branch `integrate-jay-2026-09-18` is main plus four merged branches:
`cut-live-accuracy` (the S42 live-accuracy writer is gone), `community-audio-labels`, `soak-tool`, and
`jay-drive-integration` (the LaserTagMods drive: stock firmware images, Jay's ESP32 sources, BC's command sheets
and BC's 2018 app). Main also gained a Callsign capture (cap30) and a weapons pass the same day. **Every firmware
fact from the drive is a disassembly reading, not a measurement on v4.32**; the bench that settles them is
`bench-firmware-levers-2026-09-19.md` (five sessions, a 21-claim checklist).

⚠️ **Top priority (Tony): screamers.** A gun locks up in play, a sound loops, and only a power cycle recovers it. The plan
to reproduce and prevent them is [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md). Its Phase C
tool is built: `python -m brx_mcp soak <address> <pattern> <minutes>` (`soak-tool`).

## Today

1. **F206 has a root cause and a shipped fix** (`d0f4c729`). The gun keeps ONE team byte; `$TID`, `$TEAM` and
   `$PSET` t2 all write it, and the last writer wins. Our `$PSET` hard-coded t2 = 0, so every gun went live as
   team 0 and dropped every enemy hit under `$GSET` t1 = 0. Now every `$PSET` carries the `$TID` team, `$TID`
   follows every `$SPAWN`, and `assert_team_byte_consistent` refuses a bundle where the two disagree.
   **One bench run confirms it** (levers sheet §1, runs a-f).
2. **The command rail has three tiers** (`cbd05419`): `KNOWN_COMMANDS` (arity and a bench-proven flag),
   `DENIED_COMMANDS` (refused even with confirm: factory, DFU, pairing, `$IRT`, `$SITE`, `$RESET`, `$DPLAY` and
   more), and unknown = confirm. The phone gets the deny list as `NODE_DENIED_COMMANDS`.
3. **Transport hardening is designed, two parts built** (`spec/transport-hardening.md`). The gun reads one serial
   byte per loop pass, a lost `*` corrupts the next frame, and six audio waits block the loop with no watchdog:
   a screamer mechanism. Built: the deny list, and `brxlink.WRITE_PACING` with the block pause OFF. Filed:
   F255 pacing and the runt `$SIR` rows, F256 write with response, F257 `$QUERY` read-back, F258 the lock-up
   detector, F259 whether `$PB*` joins the deny list. (Renumbered at the merge from F254-F258; main owns F254.)
4. **`$BUMP` is live, and the shapes agree.** The firmware shape is
   `$BUMP,<amount>,<hp 0/1>,<armour 0/1>,<shield 0/1>,<sound>,*`. Callsign's shield recharge (cap30) sends
   `$BUMP,12,,1,,,*`, which confirms the armour flag on the wire. The hp and shield flags, negatives and the
   cascade are still to bench (levers sheet §5, F65).
5. **The second emitter is priced** (`9b7d2ae0`, `afe064c4`). One Shotgun pull lands two words (gun 45, headset
   70, cap30), which narrows F71 (still open, see F254). t12 is now a declared `wire.headset_dmg`; the Shotgun ships 20 + 20. The drive
   adds that the range tokens set the IR **carrier frequency**, not the power, which bears on F254 (at what `t13`
   the headset word stops arriving). `$GSET` t2 = 1 means indoor; Callsign sends 0 on its default OUTDOOR venue.
6. **The protocol reference is tagged by evidence** (`[disasm]` `[sheet]` `[apk2018]` `[jay]`; no tag = bench).
   The bench result was kept over the disassembly in three places: `$WEAP` t37/t38, the `$LIFE` token order,
   and the x1.5 crit at t7 = 0.

## Next

1. **Push and merge this branch** after `npm run test:all -- --ui` (known red on main: app-screens #53 and some
   app-e2e steps).
2. **Screamers first** (top priority): the screamers sheet, Phase C can run unattended on one gun with `soak`. Do not turn
   the block pause on before screamers sheet Phase A gives F255/F256/F258 their numbers.
3. **Levers bench, session 1** (45 min, two guns): §1 F206, §2 melee, §4 step 1, §5 step 1, §13 `$DD`. If
   `$STUN,3000` and `$BUMP,-20,1,1,1` behave as V4_30 says, run the rest; if not, v4.32 has drifted.
4. **After §1 passes:** close F206 (one dated line in the archive) and start F257 (the `$QUERY` team read-back).
5. **F254** (outdoor space): the headset word's reach. It unlocks the close-range weapon class.

## Open, not moved

F207 (the START echo false positive) and F209 (the respawn burst) from the 2026-09-13 playtest are untouched.
The playtest branch's `_overheating()` design is still the better one for heat (see the 2026-09-17 handoff in
`git log -p -- docs/HANDOFF.md`). The perk build's node half (Motion Tracker, Second Wind, S52) is not started.
