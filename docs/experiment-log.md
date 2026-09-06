# Experiment log — index

The lab notebook: what was sent, what happened, what it means, one entry per session. **Append after every
session** to the current month's file, [`experiment-log/2026-09.md`](experiment-log/2026-09.md) (new month = new
file, add a row here). Entry = date, machine, tagger state, experiment, wire evidence, human observation,
conclusion. Name guns by `Tactix-XXXX` (MAC suffix), never by the headset sticker.

**Do not read the log for orientation.** Entries were inserted above older ones and retractions sit beside what
they retract, so a skim returns superseded conclusions. Current state is `HANDOFF.md`; open work is
`FOLLOWUPS.md`; confirmed facts are `manual/` and `../protocol/`. **Use the log for the evidence behind one claim:
grep the date or the phrase** (`grep -rn "fn 36" docs/experiment-log/`). Superseded A–G followup lists that used
to live in this file are in `archive/followups-closed.md`.

| date | file | what happened (entries) |
|---|---|---|
| 2026-08-23 | [2026-08](experiment-log/2026-08.md) | first contact on Windows, then the MacBook: MTU chunking, `$PHONE` opens the tap, PacketLogger captures solve the remote game start, `$HIR` tok4 = shooter team, guns play with no host but keep no score, `$GSET` carries no respawn field (5) |
| 2026-08-24 | 2026-08 | Callsign APK teardown and IL2CPP field maps, sound bank, live diagnostics, USB `QUERY` console, `$NAME` persists over BLE, 4-gun fleet sweep (8) |
| 2026-08-25 | 2026-08 | first live M0 game, teardown fix, sim hardening, no shooter-side kill event, `$SFLASH` + `$PLAY` token 4 = the kill feedback, native app validated, two phone nodes, P2 closed (`$PSET` t1 / `$HIR` tok3), first MC bundle and phone→MC→gun runs (18) |
| 2026-08-26 | 2026-08 | the big bench day: `$WEAP` t14/t20/t23/t37/t38, sensor map, `$TID` masked to 2 bits, FF enforced, IR word verified and emitted, a stock gun accepts a synthetic shot, `$SIR` function map both polarities, AP / heals / crit compose, melee captured, parity acceptance, `$GREN` emits a second protocol (31) |
| 2026-08-27 | 2026-08 | fn 23 is audio suppression not a stun, victim-side function audio, protocol independence, K3 death nova captured (proto 10 mag 125), LED life mode by eye, headset autonomy, `$QUERY` read-back, crit formula, shield cap, pools not 8-bit, the fn 36/37 dispute (22) |
| 2026-08-29 | 2026-08 | screamer at ~3 days powered; fn 3 is damage (floor artifact) (2) |
| 2026-08-30 | 2026-08 | `$GLED` solved then partly retracted, the pulse is the native gauge, and the FIRST FULL MATCH on our own stack with 11 findings (8) |
| 2026-08-31 | 2026-08 | measuring the docs: three cold-read handoff tests (1) |
| 2026-09-01 | [2026-09](experiment-log/2026-09.md) | headset feedback decoded from captures already on disk, M2 narrowed, the Windows lane (derived weapon numbers, console tests, the worked ledger, three review rounds) (3) |
| 2026-09-02 | 2026-09 | fn 36/37 multipliers real, F12 receiver fragmentation, `$HIR` honest / BLE blind in native games, F11 solved (`$CLEAR` wipes `$SIR`), F13 respawn gap, `$GLED`/`$HLED` fully decoded with the camera rig, F1 hunt / built / strobe / surface split, the emitter stops reaching 3 ft (23) |
| 2026-09-03 | 2026-09 | event flash tuned, emitter fixed (ceiling 8–9 ft), `$HLED` on a spawned gun, EMP and medic words captured, native stun replay (retracted twice), host-driven stun works, the whole sound bank off the gun and classified (11) |
| 2026-09-04 | 2026-09 | sound audits, presentation profile A11–A11.8, event system, `$WEAP` tok15 swap delay, the respawn station is one IR word (hosted games ignore it), gun-body LED blank + hold, S7.1 anti-cheat validated, gun-stage ladders, `$LED`/`$BLINK`/`$BHIT` layouts, wall-reflection method (27) |
| 2026-09-06 | 2026-09 | LED language review (four lenses) → `docs/led-language.md`, S10, F33, F34 (1) |
