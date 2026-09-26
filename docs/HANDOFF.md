# Handoff: Open BRX, state after the 2026-09-25 final docs pass
**State as of 2026-09-25 (before Tony clears every session).** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
Open MVP work is [`FOLLOWUPS.md`](FOLLOWUPS.md) (desk, bench, decision); ideas and the roadmap are [`post-mvp.md`](post-mvp.md);
what is done is [`archive/followups-closed.md`](archive/followups-closed.md). The bench order is [`bench-plan.md`](bench-plan.md).
What 1.0.0 ships is [`release-1.0.md`](release-1.0.md); the roadmap after it is [`post-launch.md`](post-launch.md).
Update only the lane you worked.
## State of main (2026-09-25)
**App 0.4.11 is published** (`app-v0.4.11`, release-signed; a phone on a debug build must uninstall once). Main is
ahead of 0.4.11 with: the announcer queue and "my death wins" (F351, F149), the gun audio-queue model (F347), a Shields
spawn at full shield (F348), the Android 11 Location gate (F340), the pool repair after a lost chunk (F341), the
station scan and revive fixes (F342 part, F344, F345), A60 auto-join with first contact (F346 d), the A61-A63 medals
and awards, A64/A65 no kill cue after any whistle and team-only credit (F357, F354), A66 MC-assigned station ids
(F364), A67 the station range edit on all three halves (F365), the F231 ranges (SMG and rockets 40, rail 100) and
F308's AR heavy 45. **0.4.12 waits on sitting A** of [`bench-2026-09-25.md`](bench-2026-09-25.md): screamers A4 (F341's
`$*` reset) and F347's two answers. **Powerups are ON by default** (Tony, 2026-09-25, F372 closed): sitting C's
powerup setup now runs as verification, not a gate. Still P0: the link loop under load (**F293**) and BLE setup metrics (**F297**).
Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: brx1, orchestration
2026-09-25 close: every session lane is pushed with CI green (main 93cc339a, run 36152678385). FOLLOWUPS holds 56
open MVP rows (desk 3, bench 51, decision 2). Built today after the docs pass: F368/F370/F371 alert layering, F221 MC
alert colours, F366 gamertag limit, D5 pistol Extended Mags (+50%), B6 and I2b recap icons, F375 no critical line after
the death scream, F374 a pickup Stick waits for START, F164 reconcile ammo, F319, Q13's solo-game fix, B21's Android
switch. Decided and recorded (do not re-ask): everything in the FOLLOWUPS rows, plus D5, F366 and F317 (post-MVP).
- **Next:** run [`bench-2026-09-25.md`](bench-2026-09-25.md) with Tony. Sitting A's audio results are built (brx5,
  t23 empty and the shield-hit clip); cut 0.4.12 after A4 (RELEASING.md); sitting C's powerup setup verifies F372 (closed).
- **Desk:** F377 (solo LMS picks no winner), B21's iOS half (needs the MacBook).
- **Awaiting Tony:** F221 (look at `C:\Users\Tony\brx-mc-alerts\index.html`) and S32 (the koth and melee art).
- **Parked, not merged:** `pu-select` 1fb1aec9 (brx5, SELECT swap; later powerup work on main likely supersedes it).
## Lane: brx2, bench, audio, utility and docs
2026-09-25 bench: **sitting A and sitting B both done** ([`bench-2026-09-25.md`](bench-2026-09-25.md)); **stop point
2 done** (all three Pixels on app 0.4.12, release `3f9bf7fd`; MC restarted from `main` with `--powerups
--bench-volume 75`). Sitting A (gun Tactix-FE30, rig board B): A4 PASSES, F341 closed; F347's answer is t23 EMPTY;
F350 picks H21; full write-up in `experiment-log/2026-09.md`. Sitting B (the Stick, 2 guns, 3 Pixels): F332, H9 and
F333 closed; F374's LOBBY/countdown half and F365's RADIUS/STRENGTH edit half CONFIRMED, both stay open for their
other halves; the STRENGTH A/B/A numbers and the presence RSSI asymmetry are promoted to
`hardware/m5sticks3/README.md`. Filed F379-F398, the biggest being **F379** (a rocket pickup desyncs the gun's ALT
pointer from the phone, file:line cause found) and its ammo-pips sibling **F394**; hill correctness bugs F382-F386;
Stick lock/link bugs F387-F392, F397; **F390** (MUSTER's no-way-back) to DECISION. Full write-up:
`experiment-log/2026-09.md`'s 2026-09-25 sitting B entry.
**Stop point 2 done; sitting C is next.**
- **Next bench task:** sitting C (two guns, both phones, powerups, a real fight),
  [`bench-2026-09-25.md`](bench-2026-09-25.md). Then the LATER list, by setup: screamers A7/A8 (F269, F270), A1c/A13
  (F272, F274), sitting 5 (F264, F277, F237).
- **Next desk task:** F379/F394 (the rocket-pickup ALT/ammo desync) and F380 (the false NOT ANSWERING race) are
  ready to build straight from their file:line causes, no bench needed to start. R4/T5 read-only research is
  authorised; flashing stays decision first.
- **Blocked:** F270 on A8; F274 on its three 2-hour soaks; F275 on outdoor space.
## Lane: brx3, releases and Mission Control
APK 0.4.12 published 2026-09-25 (release-signed, WebView debugging on). Since then on main: F282 (silenced weapons,
MC-only: restart MC from main before the bench), F382 phone half, F384, F385, F401, F402, F404, F405, the MVP mode
cut (TDM, FFA, KOTH), the TDM/FFA/KOTH chaos desk proofs and three flake fixes; F372 closed (powerups on by default).
- **Next:** S32 waits on Tony's two renders. The next APK carries F382, F384, F385 and the phone's MVP-only utility
  drawer.
- **Tools:** Codex returns 401 until `codex login`; Sonnet agents did the work since.
## Lane: brx4, the StickS3
Stick stations are Bluetooth-only for MVP (hill, pickup, respawn); Stick IR receive, the grenade hill, revive
counting and the SETTINGS screen are post-MVP (F338, F314, F344). HELD is the MVP mode and the boot default (Tony,
2026-09-25). On main: A68 (the hill counts from go-live to the whistle; `duration_ms` ends a Stick carried out of Wi-Fi
before START), the -75 dBm hill default, the locked-RANGE refusal, and F389-F392, F397, F398. Flashed from main, unlocked.
- **Next bench task:** sitting C: the carried-out timed hill, F386-F388, the F383 3 m and 7 m readings, F399's claim
  latency, F391's restart, F392's repro with the serial log, F397's MC restart.
- **Next desk task:** F342 (a powerup or control-point game still floods the scan: a slower advert or a native filter).
- **Resume:** a fresh worktree off `origin/main` (the old `/home/tony/brx4-l3` and `/home/tony/brx4-f333` are
  disposable). Native Windows MC for mDNS:
  `cd mcp && /mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.mc --host 0.0.0.0 --port 8785 --ws-port
  8786 --ephemeral --powerups`.
## Lane: brx5, powerups, the HUD and gun audio
On main: S58 powerups ON by default (F372 closed, `--no-powerups` is the opt-out); S59 Visor; F348/F349; death first; the three-lane alerts; F347, F350, F378.
2026-09-25: sitting B's F379, F380, F381 (a same-weapon stack capped at 2x the drop) and F393; F400, the pickup switch
card (ALT's card and timing for a weapon pickup, SELECT and the switch-back; display only; the Overshield gets N102
and no card; the kill-card clash is Tony's lean). 2026-09-26: F403, the BRIEFING's PICKUPS line (MC's brief carries `pickups`); F394, the ammo number and pips after ALT (built, bench check left).
- **Next desk task:** B21's iOS half on the MacBook; `PLAY_GAP_MS` from sitting C's spacing check (F372 closed).
- **Next bench task:** sitting C: F394 (ALT to the secondary with no shot: number, pips and a reload pull), the powerup setup (11.3), F381 (Rockets twice: 3, then 4), F400 on the gun (the card
  holds ALT's time, SELECT works while it is up), the shield-up kill-cue A/B/A, the spacing check, 11.1 (c), 11.8.

## Start here

1. **Next sitting:** [`bench-2026-09-25.md`](bench-2026-09-25.md), sitting A first (it gates 0.4.12); record
   evidence and promote or close each row from the result.
2. **Desk:** the FOLLOWUPS MVP DESK group, highest value first (F411, B21, F400).
3. **Decisions for Tony:** the FOLLOWUPS MVP DECISION group.
4. **Only after MVP:** [`post-mvp.md`](post-mvp.md) is the roadmap; nothing there is scheduled.

If Tony is not at the bench, prepare the decision packet and read the exact FOLLOWUPS methods; do not invent a new
implementation for a bench-gated row.

## Machine state

MC is `mcp/` on 8765/8766 serving `webapp/mc/dist`; rebuild before starting and restart between matches
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume`
(S58 powerups are on by default; add `--no-powerups` to turn them off). Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC,
Windows drives BLE, and the MacBook is the field target. Never modify stock firmware.
