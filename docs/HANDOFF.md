# Handoff: Open BRX, state after the 2026-09-24 bench day and its desk fixes
**State as of 2026-09-24 (night, after the doc-rot pass).** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
The bench order lives in [`bench-plan.md`](bench-plan.md) and every open item in [`FOLLOWUPS.md`](FOLLOWUPS.md). Update only the lane you worked.
## State of main (2026-09-24)
**App 0.4.11 is published** (`app-v0.4.11`, release-signed; 0.4.6 was the first release-signed build, so a phone on
a debug build must uninstall once). Main is ahead of 0.4.11 with: the announcer queue and the gun audio-queue
model (F351, F347), a Shields spawn at full shield and a lighter recharge (F348, part of F349), the Android 11 Location gate
(F340), the pool repair after a lost chunk (F341), the station scan and revive fixes (F342, F344, F345), A60 MC
auto-join, the A61 medal ladder and the A62 melee medal, the S57 name-word gap, and F308's eased AR ladder.
**0.4.12 waits on sitting A of [`bench-2026-09-25.md`](bench-2026-09-25.md)**: screamers A4 (F341's `$*` reset
is a v4.32 code read until it passes) and F347's two answers (the hum's restart delay, and the `$PSET` t23 value
that stops the hum blocking cues). Still P0: the link loop's new flap under load (**F293**) and BLE setup metrics
(**F297**). Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32; the claim checklist is
[`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md), and proven facts live in
[`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
## Lane: levers and screamers
Screamers remain P0. Phase A has run A1 and A2. F269's `raw-bytes` helper is built for A4/A7/A7b/A7c/A8.
- **Next bench task:** Block 2 of [`bench-2026-09-24.md`](bench-2026-09-24.md), A4 first (it gates 0.4.12), then
  Block 2b (F320-F322, the R4 readings). Do not send `$AS,1`.
- **Next desk task:** prepare F293 GPIO logging and the S48 carrier/duty measurement from the
  [R4 research plan](firmware-image-research-plan.md). R4/T5 read-only research is authorised; flashing remains
  decision first.
- **Open boundaries:** hosted RAM-table loading and headset routing, the protocol-15 magnitude-2 source and receiver,
  native win checks, and headset mode-5 effects; see the [experiment log](experiment-log/2026-09.md).
## Lane: playtest and the node cure
The F264 cure is on main: three unanswered pulls make the node probe with `$LIFE,*`, and GUN NOT ANSWERING reaches
the operator when it cannot help. F274's desk half is complete; the row stays open for the three hardware soaks.
F285's `$TMP` table marks t4/t8 absolute and t9 additive; the bench fills the rest. Open office-test rows: **F294**
(the MC LAN sweep on WSL), **F296** (the down pattern still reads as a hit) and **F298** (the first real Shields match
ran on 2026-09-24 and found F347-F349; it needs a clean match on a build with those fixes).
- **Next bench task:** sitting 5 of [`bench-plan.md`](bench-plan.md): F264 in a live match, then the F277 repro.
- **Blocked:** F274 on its three two-hour soaks; F277's detector on its repro.
## Lane: weapons and perks
The Balance rules table at the top of [`weapon-design.md`](weapon-design.md) is the one home of every balance rule.
F308 polish round 2 shipped (`70559776`): AR `heavy` 40 to 45 and the Burst Rifle gap 550 to 540 ms, after bench 4.3
felt too harsh; R7 has its own 55% bar, R3 and R6 hold 65%.
- **Next bench task:** confirm the eased ladder (100/70/45) and the 540 ms gap, then **F292**, then sittings 2 and 3
  of [`bench-plan.md`](bench-plan.md).
- **Next desk task:** none open.
- **Blocked:** Extended Mags on `$TMP` (S50) and F281 on sitting 2; **F275** on outdoor space.
## Lane: BLE reliability (brx2)
2026-09-24 bench: Blocks 0, 1, 1.4 (all five steps), 3.1-3.3, 4.3 and 7.11 ran; the log has each result.
**F297**: laptop control 10/10, median 1.37 s. **F293** stays open for a new flap under load, not the fixed
relink-before-join shape (Block 1 step 1.5 is its A/B/A). 2026-09-25 overnight (desk, no bench): the gun-audio
FIFO simulator and its scenario suite are built and pushed for F347 (`acd610ec`, `a1df789c`,
[`audio-queue-scenarios.md`](audio-queue-scenarios.md)); the utility-screen drawer rebuild (rounds 1-3,
`982abe49..c665755c`) fixed Tony's 7 notes plus a VQA pass (2C/5H/16M), gated at 23 states × 2 orientations.
[`bench-2026-09-25.md`](bench-2026-09-25.md) is written and folds in brx4's overnight Stick proofs, with a new
Block 10 for the gun-audio steps (F347).
- **Next bench task:** [`bench-2026-09-25.md`](bench-2026-09-25.md), sitting A first (it gates 0.4.12); Block 10
  step 4 settles F347's `$PSET` t23 value, do not ship a t23 change before it.
- **Next desk task:** none open.
- **Blocked:** F270 on A8.
- **Open decision for Tony:** F358, may a phone drawer override an MC-armed station's radius/strength?
## Lane: F341 transport and pool repair
F341 is fixed on the desk: brxlink sends `$*` before the next frame after a chunk error or a drop, and the node repairs
a pool above the armed `$PSET` or shows GUN POOLS WRONG. F342's respawn-only games scan only while down.
- **Next bench task:** Block 2 step 4 (A4), then step 6 (2.6) of [`bench-2026-09-24.md`](bench-2026-09-24.md).
- **Next desk task:** F342's open half (a powerup or control-point game still floods the scan).
## Lane: Mission Control console honesty
APKs 0.4.7-0.4.11 published, each on green CI. On main since 0.4.11: A60 auto-join, A61 multi-kill ladder, A62 Beat
Down, A63 Killjoy and the AWARDS table, A64 the frag-cap freeze, MC visual QA round 2 (mc-vqa2 gate), and fixes
F330, F343, F337, F354, F356. Each was polish-looped and test:all --ui green.
- **Next:** cut 0.4.12 once sitting A of `bench-2026-09-25.md` passes; bench F309, F311 and F312.
- **Tony decides:** F361 (the KILLJOY gun flash).
- **Build:** F355 (VQA2 Lows), F360 (F356 edge cases).
## Lane: S57, B21, StickS3 (brx4)
Tony's MVP scope: Stick stations are Bluetooth-only (hill, pickup, respawn); Stick IR receive and the grenade hill
stay post-MVP (F338). Revive counting and the REDEPLOY animation are also post-MVP: `REVIVE_FEEDBACK_ENABLED` is
off, a respawn Stick only advertises, and the phone's bit6 signal sits parked on branch `revive-bit`. On main:
`presence.h` ports the phone's Presence, ControlPoint and revive logic (`e65aea17`); the side-button lock writes the
M5PM1 registers (F332, `8a8bcae9`, `e17efa66`); a revive counts from player state bit 6, no RSSI (`169157eb`); a
pickup claim is awarded at any strength (`e879b9db`); a host screen simulator (`edef75c9`, `e17efa66`) drives
`station_render.h` through 46 scenarios and found 14 wrong screens, all fixed; `hardware/player-sim` (`03c21273`)
simulates a player advert for bench-free proof. Overnight, unattended: mDNS discovery, status reporting, the A58
lock round trip on real PM1 registers, and an offline pickup award (with a dead player's claim refused), all against
a simulated player. F353's desk half is done: the Stick's own advert gaps are fine (median 106 ms, max under 1 s);
the phones' "left" flips are phone-side, and a laptop Wi-Fi scanner cannot measure BLE advert timing. B21's Android
half shipped; `webContentsDebuggingEnabled` and iOS remain.
- **Next bench task:** sitting B of [`bench-2026-09-25.md`](bench-2026-09-25.md): a real-phone pickup and hill are
  still unproven over the air (H9); also the physical side-button click test while locked.
- **Next desk task:** F333's remaining unwired screens (hill capturing/contested, an empty pickup, settings); F353's
  phone-side half (a phone log of Stick advert arrivals); F352 (the kill-confirm design pass for Tony).
- **Blocked:** none.
- **Resume:** worktree `/home/tony/brx4-l3` on `main`; tools are `stick.py`/`sim.py`/`stick_sim.py`. Windows MC:
  `cd mcp && /mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.mc --host 0.0.0.0 --port 8785 --ws-port
  8786 --ephemeral --powerups`.
## Lane: powerups, shields, HUD and alerts (brx5)
On main: S58 powerups behind `--powerups` (heavy on the trigger, SELECT toggles; protected overshield; no claim RSSI
floor; a phone powerup station advertises -55); S59 Visor; F348/F349; the announcer gaps (lead and hill voice-silent
during a kill streak); HUD VQA round 2 (POOLS WRONG, F359 Lows); the three-lane alerts (HERO/OBJECTIVE/FEED, medals from
contract MEDALS, AWARDS tab on A63), gallery `C:\Users\Tony\brx-alerts\index.html`.
- **Next bench task:** the t23 shield-loop A/B (F347, docs/audio-queue-scenarios.md step 2), then 3.4, 3.5, 4.18, 4.19.
- **Next desk task:** F347's compile change once the bench picks a silent t23; Beat Down's voice (VA7F or VA7G) and
  F149 (kill vs death stop) wait on Tony. The revive bit6 is parked on `origin/revive-bit` (post-MVP).

## Start here

Use this priority stack; do not spend Tony's bench time on desk work:

1. **Next sitting:** [`bench-2026-09-25.md`](bench-2026-09-25.md), sitting A first (it gates 0.4.12); record
   evidence and promote or close each row from the result.
2. **Screamer transport:** Block 2 (A4 first, it gates 0.4.12), then A8b; capture F269/F270/F272, then F274's soaks.
3. **Decisions for Tony:** F346 (d) first contact; F351's B3 (the kill line at my own death); F350's shield-hit
   sound; F352's kill confirm; the powerups flag after 3.4-3.5.
4. **Only after reliability:** E2/E3/E4, B17, K6 and the remaining feature rows are roadmap work.

If Tony is not at the bench, prepare the decision packet and read the exact FOLLOWUPS methods; do not invent a new
implementation for a bench-gated row.

## Machine state

MC is `mcp/` on 8765/8766 serving `webapp/mc/dist`; rebuild before starting and restart between matches
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume`
(add `--powerups` for S58). Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC,
Windows drives BLE, and the MacBook is the field target. Never modify stock firmware.
