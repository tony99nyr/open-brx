# Handoff: Open BRX — desk closures through 2026-09-23; remaining work is bench- or decision-gated.
**State as of 2026-09-23 (desk follow-up).** This is the current truth; history is `git log -p -- docs/HANDOFF.md`.
The bench order and desk-work list live in [`bench-plan.md`](bench-plan.md); update only the lane you worked.
## State of main (2026-09-23, after the desk closure)
The 2026-09-23 desk closure (S34 self-hosted fonts) and the 2026-09-20 playtest fixes are committed on `main`
(opt-in score caps, headset damage for Breacher/Toxin/SMG, grouped dual-emitter hits, LOAD retries, a separate
shield pool, scanner-station warnings, utility auto-join); `git log` has the detail. The playtest station deaths
came 2.7-4.2 s after respawn, beyond the 2 s window; the wire profile shows protection was active.
App **0.4.5 is published as the `app-v0.4.5` GitHub release and pushed on `main`**, with the 0.4.1-0.4.4 fixes:
flap back-off, picker pacing, the respawn-profile rebuild, the office-test fixes and life presets (Standard
45/70/0, Shields 45/0/105, Hardcore 45/0/0). **F206 is PROVEN** (levers §1 run f, a real TDM through Mission
Control). **0.4.3's respawn profiles replace the F121/F209 mechanism** (timed vs station, a separate
weapon-arming delay, equal go-live at T-3); both rows are closed. **The first field test is the Shields preset in a real match plus the new respawn rules on
both phones** (Block 4 of [`bench-2026-09-24.md`](bench-2026-09-24.md)). Still open and P0: the BLE link-loop root
cause (**F293**) and BLE setup-reliability metrics (**F297**); see Block 1.
**Every firmware fact from the drive is a disassembly reading until a bench proves it on v4.32**; the claim
checklist is [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md). The facts session 1 proved
(`$TMP`, `$STOP`, spawn protection, `$BUMP`, `$STUN`, the `$LIFE` probe and revive, the IR kill confirm, `$DPLAY`)
live in [`protocol/brx-protocol.md`](../protocol/brx-protocol.md) and [`manual/dev.md`](manual/dev.md).
**APK 0.4.6: one blocker.** brx3 built it release-signed (held in `~/brx3-release`; the B21 key exists). It waits
only on the go or no-go in step 4.0 of [`bench-2026-09-24.md`](bench-2026-09-24.md); then Tony publishes it. Every
player uninstalls the debug-signed 0.4.5 once.
## Lane: levers and screamers
Screamers remain P0. Phase A has run A1 and A2. The current order is in
[`bench-plan.md`](bench-plan.md); the next runbook is [`bench-2026-09-24.md`](bench-2026-09-24.md).
F269's `raw-bytes` helper is built for A4/A7/A7b/A7c/A8.

- **Next bench task:** the sitting plan at the top of [`bench-2026-09-24.md`](bench-2026-09-24.md) (MUST sittings A-C);
  Block 2 and Block 2b (F320-F322, the R4 readings) come after its stop point. Do not send `$AS,1`.
- **Next desk task:** prepare F293 GPIO logging and S48 carrier/duty measurement from the
  [R4 research plan](firmware-image-research-plan.md). R4/T5 read-only research is authorised; flashing remains
  decision first.
- **Open boundaries:** hosted RAM-table loading and headset routing, protocol-15 magnitude-2 source and receiver,
  native win checks, F308 ordering, and headset mode-5 effects. See the dated
  [experiment log](experiment-log/2026-09.md) for evidence and uncertainty.

## Lane: playtest and the node cure

The F264 cure SHIPPED: on three unanswered pulls the node probes with `$LIFE,*`, acts only on the reply, and puts
GUN NOT ANSWERING on the operator's board when it cannot help. **F121 and F209 are CLOSED (2026-09-19)**,
superseded by 0.4.3's respawn-profile rebuild (a separate weapon-arming delay, no default protection on a timed
respawn, equal go-live at T-3); the evidence timeline ordering fix (F223) is now shipped.
Overnight cycle 1 (2026-09-18 night) closed **F261** (a fresh MC now records an orphan match from any
unbound node) and **F257** (the charge-weapon HUD). Today's stale-node fix (`88ead536`, no open row) answers both
ghost-node incidents from the office test. **F289 is closed:** MC flags an offline player who may still hold spawn
protection. **F265 is closed:** status heartbeats now push a changed
score snapshot, so miss-only shot/accuracy changes reach every bound phone; unchanged heartbeats de-duplicate.
**F287 is closed:** operator
RESYNC now proves the gun alive before any re-arm burst. **F288 is closed:** the phone renders `no_fire` and
`no_answer`, names the host cure, and yields its alert lane to link/reconnect controls. Also open: **F277** (a
reload that never completes), and the office test's rows **F293**, **F294**, **F296**, **F297** and **F298** (link-loop
root cause, the MC LAN sweep, the down-pattern LED, BLE setup metrics, a real Shields-preset match). Block 4 of the
runbook needs a build from `main`: S56 and F309 are newer than 0.4.5.

- **S55 is closed:** recoil now has one t4-only owner, native fn-23 priority and a phone HUD reason. **F274's
  desk half is complete:** its soak catalog matches the short t4 writer; the row remains open for hardware soaks.
- **F173 is closed:** the diagnostic route now scans through its own read-only SQLite connection and one stable
  snapshot; the live store writer never crosses into the executor.
- **F175 is closed:** rebound nodes retain physical totals plus per-player/null status attribution; no fact is
  silently assigned to the last binding, and cumulative shot deltas do not inflate the match total.
- **F174 is closed:** an explicitly named previous match remains diagnosable on the next runway; current/full scans
  still fail closed in ARMED and every diagnostic remains blocked in LIVE.
- **F179-F185, F188, F189 and S35 are closed:** UI guards are behavioral, standby truth gates `npm test`, M2 accuracy is
  deterministic, Designer PLAY loads before KIT, and the KIT e2e finds the main-checkout venv from a worktree.
- **F285 desk work is complete:** the guarded `$TMP` table marks only t4/t8 absolute and t9 additive; bench fills the unmeasured cells.
- **Next bench task:** Block 4 of [`bench-2026-09-24.md`](bench-2026-09-24.md) (respawn rules, Shields, the down
  animation, full screen), then sitting 5: F264 live and the F277 repro.
- **Blocked:** F274 on its three two-hour hardware soaks; F277's detector on its repro.
## Lane: weapons and perks

**S52 is closed (2026-09-22):** the HUD shows `ALT = RELOAD` and warns on conflicting secondary picks; app gates passed.

**Balance rules R1-R10 shipped 2026-09-23** (`ef55b7db..6dae402d`): the one-page table at the top of
[`weapon-design.md`](weapon-design.md) is the single home of every Tony balance rule; `test_balance_sim.py` gates each at
65% on Standard (R7 is the tightest, 65.5%). The sim now models range bands (headset word close only) and crits.
Recoil counts rounds per trigger pull by calibre (S54, `aa7b08b9`). F291 is closed. `balance_sim.py` balances any weapon.

- **Next desk task:** none open. F310 is closed (Shields bar 60%, heavies decided); every rule lives in the
  Balance rules table at the top of `weapon-design.md`.
- **Next bench task:** **F308** and **F292** in [`bench-2026-09-24.md`](bench-2026-09-24.md), then sitting 2 steps 1-4,
  then sitting 3 (§26 groups A and B).
- **Blocked:** Extended Mags on `$TMP` (S50) and F281 on sitting 2; **F275** on outdoor space (runbook Block 5).
## Lane: BLE reliability (brx2)
2026-09-24, day sitting: Blocks 0-1, 1.4 (all 5 steps PASS) and 3.1-3.3 of
[`bench-2026-09-24.md`](bench-2026-09-24.md) done, plus a melee side-run (K4 CLOSED) and F336 (melee `$HIR`
carries no front/back direction, a design question only). **F297**: laptop control 10/10, median 1.37 s.
**F308** 3.1-3.2 PASS; 4.3 PASSES too but Tony calls it too harsh, DECISION the AR ladder becomes 100/70/55.
**S58** 3.3 items 1-8 PASS, `spec/powerups.md` corrected. Evening, Block 4 setup (0.4.11+f366156e,
`--powerups`): **F293** stays OPEN for a NEW load-triggered flap shape (not the fixed relink-before-join
shape); follow-up is Block 1 step 1.5 (a second phone's SCAN AGAIN mid-join). **F340** confirmed on the bench.
**S57** 7.11 PASSES but finds a real collision: the victim-name word is lost inside the headset's 199 ms rate
guard, brx4 fixing in 0.4.12. **F345**'s tonight decision (-70/-57) does not match the branch's shipped
defaults (-66/-60), flagged for brx1. **F344**/**F333**: brx4's Stick fixes (fn-15 beacon, advert
game-byte) make the revive count correct in MC; the Stick's own screen still doesn't update it. **F347**
filed: the native shield hum blocks the audio FIFO, explaining tonight's late/missing kill and shield cues;
Tony's decision drops the "Shields Online" callout, brx4's 0.4.12 adds FIFO modelling, and brx2 is building a
simulator and scenario suite for it. **F341** (unkillable-gun frame corruption) is brx1's, unchanged here.
- **Next bench task:** Block 1 step 1.5 (the SCAN AGAIN A/B/A), then Block 4 onward of
  [`bench-2026-09-24.md`](bench-2026-09-24.md); 4.11's RSSI calibration lands there.
- **Next desk task:** the audio-FIFO simulator and scenario suite for F347.
- **Blocked:** F270 on A8.
## Lane: Mission Control console honesty
2026-09-24: APKs 0.4.7-0.4.11 published (each on green CI). On main: A58 station lock, KOTH phone-hill default (F338), utility sweep, the console-port ws guard, the chaos kill-cue invariant, and A60 MC auto-join (Lows and Tony's first-contact decision: F346). **Next:** 0.4.12 cut on brx1's word; bench F309/F311/F312.

## Lane: S57, B21, StickS3 (brx4)
2026-09-24, evening (desk, no bench). Tony's decisions: Stick stations are Bluetooth-only for the
MVP (hill, pickup, respawn); Stick IR receive and grenade hill support on a Stick are post-MVP.
`e65aea17` ports the phone's Presence, ControlPoint and revive count into `presence.h` (C++ agrees
with beacon.js/control.js/utility.js on 6,000 random ticks); one passive scan feeds presence for
control and respawn plus the pickup ClaimGate; an MC-armed control station uses the BLE point and
still sends the S57 IR capture word; respawn now advertises state 1 (state 0 read as disabled on
every phone, a live bug since the station was built); mDNS discovery never worked before this
commit (`MDNS.begin` was never called, see H8). KOTH now defaults `station_source` to `phone`
(brx3, `9ac01a5d`), with `a4d2a1ee`'s SETUP warning when a CONTROL station is assigned under a
grenade or IR-station objective. Found in review, fixed by brx5 in the 0.4.11 hotfix (not this
lane): MC armed a station by its game_no byte while phones scoped presence by a config_id hash, so
every MC-armed station was invisible to players.
**Next:** Block 9 in `bench-2026-09-24.md` (the Stick over BLE, MUST for the MVP), after 0.4.11
ships. F332 (PM1 side-button registers 0x49/0x4A) and F333 (five station screens unwired) are
untouched. F314 (Stick IR receive) is post-MVP; do not build toward it.
## Lane: powerups and the shield HUD (brx5)
2026-09-24: S58 reworked to Tony's shapes and pushed behind `--powerups`: the heavy goes straight on the trigger (SELECT toggles, done by the phone), the overshield raises the `$PSET` shield max under 1 s of spawn protection (hits during the grant ignored). F293 and F339 fixed. Next: bench 3.4-3.5, then the flag decision.

## Start here

Use this priority stack; do not spend Tony's bench time on desk work:

1. **Next sitting (now):** [`bench-2026-09-24.md`](bench-2026-09-24.md), on a build from `main` (S56 and F309 are
   newer than 0.4.5), then sitting 5 for F264/F277. Record evidence and promote/close each row from the result.
2. **Screamer transport:** the runbook's Block 2, then A8b; capture F269/F270/F272, then F274's three hardware soaks. This unlocks Phase B-E; do not infer numbers from ordinary `send` runs.
3. **Decisions before more code:** 0.4.6 is published (2026-09-24, `app-v0.4.6`). Defer S50/F281
   until sitting 2 confirms `$TMP` semantics.
4. **Only after reliability:** E2/E3/E4, B17, K6 and the remaining feature rows are roadmap work.

If Tony is not at the bench, prepare the decision packet and inspect the exact FOLLOWUPS methods; do not invent a
new implementation for a bench-gated row. All other open rows are parked in [`FOLLOWUPS.md`](FOLLOWUPS.md) by gate.

## Machine state

MC is `mcp/` on 8765/8766 serving `webapp/mc/dist`; rebuild before starting and restart between matches
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume`.
Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC, Windows drives BLE, and the
MacBook is the field target. Never modify stock firmware.
