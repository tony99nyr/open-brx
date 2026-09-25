# Handoff: Open BRX, state after the 2026-09-25 final docs pass
**State as of 2026-09-25 (before Tony clears every session).** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
Update only the lane you worked.
## State of main (2026-09-25)
**App 0.4.11 is published** (`app-v0.4.11`, release-signed; a phone on a debug build must uninstall once). Main is
ahead of 0.4.11 with: the announcer queue and "my death wins" (F351, F149), the gun audio-queue model (F347), a Shields
spawn at full shield (F348), the Android 11 Location gate (F340), the pool repair after a lost chunk (F341), the
station scan and revive fixes (F342 part, F344, F345), A60 auto-join with first contact (F346 d), the A61-A63 medals
and awards, A64/A65 no kill cue after any whistle and team-only credit (F357, F354), A66 MC-assigned station ids
(F364), A67 the station range edit on all three halves (F365), the F231 ranges (SMG and rockets 40, rail 100) and
F308's AR heavy 45. **0.4.12 waits on sitting A** of [`bench-2026-09-25.md`](bench-2026-09-25.md): screamers A4 (F341's
`$*` reset) and F347's two answers. **Powerups are MVP** (Tony, 2026-09-25): they turn on by default (F372) once
sitting C's powerup setup passes. Still P0: the link loop under load (**F293**) and BLE setup metrics (**F297**).
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: brx1, orchestration
The 2026-09-25 final docs pass is done: FOLLOWUPS holds 62 open MVP rows (desk 12, bench 46, decision 4); 167
post-MVP ids live in `post-mvp.md` (165 moved unchanged, plus F317 and the new F373); the pass closed 14 rows.
Decided 2026-09-25 and recorded (do not re-ask): F346 d auto-join, F354 team-only credit, F357 no cue after any
whistle, F364 station ids, F365 the range edit, F361 keep the Killjoy flash, F149/F351 death first, A63 surprise
medals, F231 ranges, S58 powerups are MVP, Q13 TEAM DAMAGE OFF, B21 WebView debugging as a toggle (default on), F221
the colour rule and alert audit (approved; brx1's agent builds it), F350 fix after F347 then audition, F369 the medal
names (named after the gun's own lines; we rename on objection), F308 heavy 45, F366 the gamertag (hard 16, soft 12;
brx3 builds and closes it), the recap icons (IRON MAN I2b, built; BEAT DOWN B6, brx5 wires it), F317 the daylight theme is post-MVP.
- **Next:** run [`bench-2026-09-25.md`](bench-2026-09-25.md) with Tony. Route sitting A's results to brx5 (the t23
  value, rule B, F350's pick) and brx3 (the 0.4.12 cut); sitting B's to brx4; sitting C's powerup result to F372.
- **Awaiting Tony:** the MVP DECISION group: F368, F370, F371, D5.
## Lane: brx2, bench, audio, utility and docs
2026-09-24 bench: Blocks 0, 1, 1.4, 3.1-3.3, 4.3 and 7.11 ran (F297 laptop control 10/10, median 1.37 s). Built:
the gun-audio FIFO simulator ([`audio-queue-scenarios.md`](audio-queue-scenarios.md)), the utility-screen rebuild,
the F365 phone half (`f22ebe66`), this docs pass, and runbook Block 11 (F350, the powerup claim, F365, F364,
auto-join, death first) plus a rewritten 4.11 (the claim calibration, phone station and Stick).
- **Next bench task:** [`bench-2026-09-25.md`](bench-2026-09-25.md), sitting A first (it gates 0.4.12); Block 10
  step 4 settles F347's `$PSET` t23 value, do not ship a t23 change before it. Then the LATER list, by setup:
  screamers A7/A8 (F269, F270), A1c/A13 (F272, F274), sitting 5 (F264, F277, F237).
- **Next desk task:** none open. R4/T5 read-only research is authorised; flashing stays decision first.
- **Blocked:** F270 on A8; F274 on its three 2-hour soaks; F275 on outdoor space.
## Lane: brx3, releases and Mission Control
APKs 0.4.7-0.4.11 published, each on green CI. The MC halves of A60-A67 are on main, each polish-looped and
`test:all --ui` green.
- **Next:** cut 0.4.12 once sitting A passes A4 and F347 (and brx5's t23 fix lands).
- **Desk (MVP):** Q13 (check compile keeps team damage off everywhere; label it TEAM DAMAGE: OFF), B21 (the WebView
  debugging toggle, default on; release-sign stays at each cut), F319 (d) and (e), S32 (the KOTH art), F366 (the gamertag limit, hard 16, soft 12), the MC half of F372.
## Lane: brx4, the StickS3
Stick stations are Bluetooth-only for MVP (hill, pickup, respawn); Stick IR receive, the grenade hill and revive
counting are post-MVP (F338, F314, F344). On main: F365 on the Stick (`e9e81efc`, hold A 5 s on STATS), the side-button
lock (F332), a pickup claim at any strength (`e879b9db`), `presence.h`, the host screen simulator and
`hardware/player-sim`.
- **Next bench task:** sitting B of [`bench-2026-09-25.md`](bench-2026-09-25.md): F332's physical click, the pickup
  online and offline, the hill with real phones (H9), F353's phone half, then 11.5 (F365).
- **Next desk task:** F333's unwired screens (hill capturing or contested, an empty pickup, settings); F342 (a
  powerup or control-point game still floods the scan: a slower advert or a native filter).
- **Resume:** worktree `/home/tony/brx4-l3`. Native Windows MC for mDNS:
  `cd mcp && /mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.mc --host 0.0.0.0 --port 8785 --ws-port
  8786 --ephemeral --powerups`.
## Lane: brx5, powerups, the HUD and gun audio
On main: S58 powerups behind `--powerups` (the heavy on the trigger, SELECT toggles, the protected overshield, no
claim RSSI floor, a phone powerup station advertises -55); S59 Visor; F348/F349; death first (`7173d400`); the
three-lane alerts and the style B recap icons.
- **Next desk task:** F347's compile change once sitting A picks a silent t23; BEAT DOWN's B6 icon; F350's clip once Tony picks it; F164
  (a reconcile re-arms from the last-known counts, not the spawn magazine); F161 (the gun picker refreshes live);
  F372 (powerups on by default, after sitting C) with the calibrated claim thresholds.
- **Next bench task:** sitting C's powerup setup (11.3) and 11.8.

## Start here

1. **Next sitting:** [`bench-2026-09-25.md`](bench-2026-09-25.md), sitting A first (it gates 0.4.12); record
   evidence and promote or close each row from the result.
2. **Desk:** the FOLLOWUPS MVP DESK group, highest value first (F164, F342, Q13, B21, F372).
3. **Decisions for Tony:** the FOLLOWUPS MVP DECISION group.
4. **Only after MVP:** [`post-mvp.md`](post-mvp.md) is the roadmap; nothing there is scheduled.

If Tony is not at the bench, prepare the decision packet and read the exact FOLLOWUPS methods; do not invent a new
implementation for a bench-gated row.

## Machine state

MC is `mcp/` on 8765/8766 serving `webapp/mc/dist`; rebuild before starting and restart between matches
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume`
(add `--powerups` for S58). Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC,
Windows drives BLE, and the MacBook is the field target. Never modify stock firmware.
