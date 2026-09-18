# Handoff: Open BRX

**State as of 2026-09-18 (night).** `main` carries the LaserTagMods drive integration (stock firmware
images, Jay's ESP32 sources, BC's command sheets, BC's 2018 app, a Callsign capture, the `soak` tool),
the fix/playtest-2026-09-13 desk work (F264-F268, S54-S55, the recoil writer rebuild, the cure test
suite), and tonight's firmware levers bench, session 1 (both halves). **Every firmware fact from the
drive is a disassembly reading until this bench proves it on v4.32.** The full plan, all five sessions
in one running order: [`bench-plan.md`](bench-plan.md). **Open that file first at the bench.** The
claim-by-claim checklist is [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md).

## Tonight's bench: what session 1 settled

Two guns (Tactix-E20D, Tactix-3D4F), then Tactix-E20D alone with the ESP32 IR rig. Full findings:
`docs/experiment-log/2026-09.md` (2026-09-18, "firmware levers session 1").

- **F206 CONFIRMED at the wire level** (runs a-e). Run f, a real TDM through Mission Control, is the
  only part still open.
- **`$STUN,<ms>` is a real, native, SILENT stun**, about 6 s. The node must play its own cue (`X17`,
  matching Battle Company's concussion-grenade sheet entry) since the gun plays nothing.
- **`$BUMP` is fully confirmed**: `<amount>,<hp 0/1>,<armour 0/1>,<shield 0/1>,<sound>`. Closes F65.
- **`$TMP` t4 (accuracy), t8 (incoming damage) and t9 (magazine) are all confirmed over BLE**, none of
  them reset the magazine or reserve on their own, and this unblocks three things at once: the recoil
  writer can move off `$WEAP`+`$AMMO` onto one 20-byte `$TMP` frame (F274), spawn protection can drop
  from a 28-frame fn-28 twin table to `$SPAWN,,*` + one `$TMP` t8 write (levers §23, F121/F269), and
  Extended Mags gets a wire-only alternative to today's compile-time x2 (S50). ⚠️ **`$TMP` t4 is
  last-writer-wins against the gun's own fn 23 smoke, and the smoke's own ~6 s timer resets t4 to 0
  regardless of the last write.** Any accuracy writer needs the single-owner design S55 already
  proposes, plus one more rule: never write t4 while a smoke is active, and re-send the owner's value
  once it ends.
- **A dead gun answers the bare `$LIFE,*` with `$HP,0,0,0` at once; poll with that, not `$QUERY`**
  (`$QUERY`'s reply holds a dead gun's print loop busy for about 2 s). Confirms F264/F272's probe.
- **`$DD` REFUTED for this gun**: a one-hit kill gave no `$DD` at all. Do not build any cure on it.
- **No native kill-confirm callout either** (levers §13 step 3): every protocol-15 magnitude 1-39 registered
  silently on the killer's gun, but none produced an audible line. Callsign's own kill voice is an app-side
  `$PLAY`. That leaves a protocol-15 word as a cheap IR-only carrier for a host-defined kill confirm (B31).
- **Screamers A1/A2**: `$DPLAY` on a looping sound blocked the gun (no `$PONG`, no reply, no audio) and
  dropped the BLE link about 15 s in, but it recovered on reconnect with no power cycle needed this
  run: a partial screamer, not yet a proven full lock. `$DPLAY` stays on the never-send list either way.
- **A dead gun still forwards a host `$IRTX` out through its headset** (a dying gun emits no IR of its
  own), the headset loop fields on `$IRTX` work as read, and fn 34 registers on a dead gun. `$LIFE` set
  mode fully revives a dead gun (fires, takes hits, keeps its magazine and any `$TMP` write), though the
  headset death flash needs a separate `$HLED,,6,*` clear. **Untested against the F264 stall state
  specifically**: reproduce that stall before trusting this as the cure.
- **`$TMP` t5 (fire interval) CONFIRMED on a full-auto weapon** (scales the cycle by `(100+t5)/100`, exact
  match to V4_31), but showed no effect on the Shotgun's shell-fed reload. **t7 (outgoing damage) and t4's
  effect on the REAL hit rate are both CONFIRMED**: t4 at 50 landed 41% of rounds, matching the earlier
  `$WEAP`-based reading, so the recoil writer can move fully onto one `$TMP` frame with no `$AMMO` restore.
  This was the last test of tonight's sitting.

## Still open, unchanged by tonight

1. **F264** a player can be dead on the gun and alive on the HUD; `pool_stale: no_fire` is detected and
   nothing acts on it. Tonight's `$LIFE,*` poll result is the ingredient the cure needs.
2. **F265** a bound phone's scoreboard can freeze while the overlay says LIVE.
3. **F261** a fresh Mission Control never offers to adopt a running match.
4. **F257** the HUD says OUT OF ENERGY on a charge weapon that can still fire taps.
5. **F256** the coverage line claims an internet path WiFi-only phones do not have.
6. **F262** the gun's native shield-hit sound tracks something other than the pool.
7. **F209** the respawn burst read as an outbox-flush artefact, not the engine; ordering facts by their
   own `t` (F223) is what is left.
8. **Screamers is still Tony's top priority.** Tonight's A1/A2 is one run of Phase A; the rest of
   `bench-screamers-2026-09-19.md` (Phase A remainder, B, C, D) is unrun.

## Next actions, in order

1. **Screamers Phase A, the rest of it**, then Phase C (`python -m brx_mcp soak <address> <pattern>
   <minutes>`) once A gives F269/F270/F272 their numbers. Do not turn the block pause on before that.
2. **Levers session 1, the rest of it**: §21 steps 4-19 (sitting 3), §2/§4/§5/§12/§16 (sitting 4), per
   `bench-plan.md`.
3. **Levers session 2** (§3, §6-§10, §15, §23 in full) and the IR-rig session (§11, §13, §16, §17, §20,
   §24), both in `bench-plan.md`.
4. **Fix F264** using the `$LIFE,*` poll now confirmed; it is the one that costs a player their match.
5. **Fix F265 and F261**, both small: never print LIVE over a stale board, and record an orphan match
   whether or not a node is bound.
6. Tony decides **F220** (publish app 0.3.0 as a GitHub Release).

## Machine state

MC runs from `mcp/` on 8765/8766 and serves `webapp/mc/dist`; rebuild that before starting it, and
restart MC **between matches only**. Check with `ss -ltn | grep 876`.

```
setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume
```

Both Pixels hold 0.3.0. The shield recharge only runs on the **Shields preset** (armour 0), because
every compiled head carries a shield ceiling regardless.

**Machine roles:** WSL runs the Python suites and no-hardware MC; Windows Python is for BLE
instruments; the MacBook is the field target. Never modify stock firmware.
