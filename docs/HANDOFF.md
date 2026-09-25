# Handoff: Open BRX, state after the 2026-09-24 bench day and its desk fixes
**State as of 2026-09-24 (night, after the doc-rot pass).** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
The bench order lives in [`bench-plan.md`](bench-plan.md) and every open item in [`FOLLOWUPS.md`](FOLLOWUPS.md). Update only the lane you worked.
## State of main (2026-09-24)
**App 0.4.11 is published** (`app-v0.4.11`, release-signed; 0.4.6 was the first release-signed build, so every
player uninstalled the debug build once). Main is ahead of 0.4.11 with: the announcer queue and the gun audio-queue
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
2026-09-24: Blocks 0, 1, 1.4 (all five steps), 3.1-3.3, 4.3 and 7.11 ran; the log has each result. **F297**: laptop
control 10/10, median 1.37 s. **F293** is open for a new flap under load, not the fixed relink-before-join shape.
The gun audio simulator and its scenarios are built ([`audio-queue-scenarios.md`](audio-queue-scenarios.md)).
- **Next bench task:** Block 1 step 1.5 (a second phone's SCAN AGAIN mid-join, A/B/A), then Block 10's gun
  audio-queue steps (F347: the hum's yield model and t23 EMPTY).
- **Next desk task:** none open.
- **Blocked:** F270 on A8.
## Lane: F341 transport and pool repair
F341 is fixed on the desk: brxlink sends `$*` before the next frame after a chunk error or a drop, and the node repairs
a pool above the armed `$PSET` or shows GUN POOLS WRONG. F342's respawn-only games scan only while down.
- **Next bench task:** Block 2 step 4 (A4), then step 6 (2.6) of [`bench-2026-09-24.md`](bench-2026-09-24.md).
- **Next desk task:** F342's open half (a powerup or control-point game still floods the scan).
## Lane: Mission Control console honesty
APKs 0.4.7-0.4.11 published, each on green CI. On main: A58 station lock, KOTH's phone-hill default (F338), the utility
sweep, the console-port ws guard, the chaos kill-cue invariant and A60 auto-join.
- **Next:** cut 0.4.12 once sitting A of `bench-2026-09-25.md` passes; bench F309, F311 and F312. Tony decides F346 (d): trust on first use, or one
  JOIN tap on first contact. Lows: F337, F343, F346.
## Lane: S57, B21, StickS3 (brx4)
Tony's MVP scope: Stick stations are Bluetooth-only (hill, pickup, respawn); Stick IR receive and the grenade hill are
post-MVP (F338). On main: `presence.h` ports the phone's Presence, ControlPoint and revive count (`e65aea17`); the
side-button lock writes the M5PM1 registers (F332, `8a8bcae9`); a revive counts from player state bit 6, no RSSI
(`169157eb`); a pickup claim is awarded at any strength (`e879b9db`); the announcer queue (F351) and the 300 ms S57
name-word gap. B21's Android half shipped; `webContentsDebuggingEnabled` and iOS remain.
- **Next bench task:** Blocks 9 and 10 of [`bench-2026-09-24.md`](bench-2026-09-24.md) (the Stick over BLE; the lock,
  the pickup and the audio queue).
- **Next desk task:** F333's unwired screens, F353 (advert gaps), F352 (the kill-confirm design pass for Tony).
- **Blocked:** the Stick's advert-bit revive on the phone half of F344 (brx5).
## Lane: powerups and the shield HUD (brx5)
S58 is on main behind MC's `--powerups` flag: the heavy goes straight onto the trigger (SELECT toggles), and the
overshield raises the `$PSET` shield max under 1 s of spawn protection. F348 is fixed and F349 in part (the cue side waits on F347); S59's Visor meter is built.
- **Next bench task:** steps 3.4-3.5, 4.11, 4.18 and 4.19 of [`bench-2026-09-24.md`](bench-2026-09-24.md); then Tony
  decides the flag.
- **Next desk task:** the phone half of F344 (set state bit 6 for about 5 s after a station revive); S58's pickup
  threshold (a code read: no station advertises 0, so the -55 default never applies); F350's shield-hit audition.

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
