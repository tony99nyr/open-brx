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
2026-09-25 close: every session lane is pushed with CI green (main 93cc339a, run 36152678385). FOLLOWUPS holds 56
open MVP rows (desk 3, bench 51, decision 2). Built today after the docs pass: F368/F370/F371 alert layering, F221 MC
alert colours, F366 gamertag limit, D5 pistol Extended Mags (+50%), B6 and I2b recap icons, F375 no critical line after
the death scream, F374 a pickup Stick waits for START, F164 reconcile ammo, F319, Q13's solo-game fix, B21's Android
switch. Decided and recorded (do not re-ask): everything in the FOLLOWUPS rows, plus D5, F366 and F317 (post-MVP).
- **Next:** run [`bench-2026-09-25.md`](bench-2026-09-25.md) with Tony. Route sitting A's results to the t23 value,
  rule B and F350's pick, then cut 0.4.12 (RELEASING.md); sitting C's powerup result goes to F372.
- **Desk:** F377 (solo LMS picks no winner), B21's iOS half (needs the MacBook), F372 after the bench.
- **Awaiting Tony:** F221 (look at `C:\Users\Tony\brx-mc-alerts\index.html`) and S32 (the koth and melee art).
- **Parked, not merged:** `pu-select` 1fb1aec9 (brx5, SELECT swap; later powerup work on main likely supersedes it).
## Lane: brx2, bench, audio, utility and docs
2026-09-24 bench: Blocks 0, 1, 1.4, 3.1-3.3, 4.3 and 7.11 ran (F297 laptop control 10/10, median 1.37 s). Built:
the gun-audio FIFO simulator ([`audio-queue-scenarios.md`](audio-queue-scenarios.md)), the utility-screen rebuild,
the F365 phone half (`f22ebe66`), this docs pass, and runbook Block 11 (F350, the powerup claim, F365, F364,
auto-join, death first) plus a rewritten 4.11 (the claim calibration, phone station and Stick).
- **Next bench task:** [`bench-2026-09-25.md`](bench-2026-09-25.md), sitting A first (it gates 0.4.12); Block 10
  step 4 settles F347's `$PSET` t23 value, do not ship a t23 change before it. Then the LATER list, by setup:
  screamers A7/A8 (F269, F270), A1c/A13 (F272, F274), sitting 5 (F264, F277, F237).
2026-09-25 desk (for brx1): F164 fixed (a reconcile re-arms the live counts, also after an app restart); F161 was
already fixed by F258, now guarded by a test; F342 has no phone desk work left and moved to bench sitting C.
- **Next desk task:** none open. R4/T5 read-only research is authorised; flashing stays decision first.
- **Blocked:** F270 on A8; F274 on its three 2-hour soaks; F275 on outdoor space.
## Lane: brx3, releases and Mission Control
APKs 0.4.7-0.4.11 published, each on green CI. 2026-09-25: F319 built and closed; Q13's desk half built (one
team-damage rule, `compile.team_damage_on`, which also fixed solo LMS: no hit could register); S32's fallback shipped.
- **Next:** cut 0.4.12 once sitting A passes A4 and F347 (and brx5's t23 fix lands). Its notes add the infection, extraction and feed fixes, and TEAM DAMAGE: OFF.
- **Desk (MVP):** F377 (solo LMS picks no winner), the MC half of F372 after sitting C. S32 waits on Tony's two renders.
## Lane: brx4, the StickS3
Stick stations are Bluetooth-only for MVP (hill, pickup, respawn); Stick IR receive, the grenade hill, revive
counting and the SETTINGS screen are post-MVP (F338, F314, F344). On main: F365 on the Stick (`e9e81efc`), the
side-button lock (F332), a pickup claim at any strength (`e879b9db`), `presence.h`, the host screen simulator,
`hardware/player-sim`, and (2026-09-25) F374: a pickup Stick waits for START's `station_update` before it offers its
item, with the phone guard in `_puClaimable`. F333's desk half is closed: every MVP screen is wired and gated.
- **Next bench task:** sitting B of [`bench-2026-09-25.md`](bench-2026-09-25.md): F332's physical click, the pickup
  online and offline, F374 (LOBBY to START, then the carry-out A/B/A), F333 (the lit screens), the hill with real
  phones (H9), F353's phone half, then 11.5 (F365).
- **Next desk task:** F342 (a powerup or control-point game still floods the scan: a slower advert or a native filter).
- **Resume:** a fresh worktree off `origin/main` (the old `/home/tony/brx4-l3` and `/home/tony/brx4-f333` are
  disposable). Native Windows MC for mDNS:
  `cd mcp && /mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.mc --host 0.0.0.0 --port 8785 --ws-port
  8786 --ephemeral --powerups`.
## Lane: brx5, powerups, the HUD and gun audio
On main: S58 powerups behind `--powerups` (the heavy on the trigger, SELECT toggles, the protected overshield, no
claim RSSI floor, a phone powerup station advertises -55); S59 Visor; F348/F349; death first (`7173d400`); the
three-lane alerts and the style B recap icons; B21's Android half, the WebView debugging switch in the ⓘ panel
(`app/plugins/brx-debug`, default ON, not yet on a phone); today's doc-rot fixes.
- **Next desk task:** F347's compile change once sitting A picks a silent t23; F350's clip once Tony picks it;
  F372 (powerups on by default, after sitting C) with the calibrated claim thresholds; B21's iOS half on the MacBook.
- **Next bench task:** sitting C's powerup setup (11.3) and 11.8; flip the B21 switch on a Pixel after the next cut.

## Start here

1. **Next sitting:** [`bench-2026-09-25.md`](bench-2026-09-25.md), sitting A first (it gates 0.4.12); record
   evidence and promote or close each row from the result.
2. **Desk:** the FOLLOWUPS MVP DESK group, highest value first (B21, F372, Q13).
3. **Decisions for Tony:** the FOLLOWUPS MVP DECISION group.
4. **Only after MVP:** [`post-mvp.md`](post-mvp.md) is the roadmap; nothing there is scheduled.

If Tony is not at the bench, prepare the decision packet and read the exact FOLLOWUPS methods; do not invent a new
implementation for a bench-gated row.

## Machine state

MC is `mcp/` on 8765/8766 serving `webapp/mc/dist`; rebuild before starting and restart between matches
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume`
(add `--powerups` for S58). Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC,
Windows drives BLE, and the MacBook is the field target. Never modify stock firmware.
