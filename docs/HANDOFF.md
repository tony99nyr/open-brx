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
checklist is [`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md). Facts that session 1
proved, and that every lane builds on:
- **`$TMP` works over BLE** for t4 (accuracy, also the REAL hit rate), t5 (full-auto interval only), t6 (reload
  time), t7 (outgoing damage), t8 (incoming damage) and t9 (magazine, raw rounds, ADDS on every re-send). No token
  resets the magazine. `$SPAWN` zeroes `$TMP`; a `$LIFE` revive keeps it. ⚠️ t4 is last-writer-wins against the
  gun's own fn 23 smoke, and the smoke's ~6 s timer resets t4 to 0 regardless.
- **`$STOP` blocks a hit's damage but not its `$HIR`, and it survives `$SPAWN`.** Anything that sends `$STOP` must
  send `$START` (plus `$GSET` and `$TID`) before the next life.
- **`$SPAWN,,*` then `$TMP` t8 = -100 then `$TID` protects a spawn** with no fn-28 twin table; the `$SIR` table
  survives `$SPAWN`. The t8 write must come AFTER `$SPAWN`.
- **`$BUMP,<amount>,<hp>,<armour>,<shield>,<sound>` is confirmed on every field** (F65 closed).
- **`$STUN,<ms>` is a native, SILENT stun.** The node plays `X17` itself (built, commit `273e949a`, not yet heard in a match).
- **Poll a gun with the bare `$LIFE,*`**: a dead gun answers `$HP,0,0,0` at once. `$QUERY` holds a dead gun for ~2 s.
- **`$DD` does not exist on this gun**, and no protocol-15 word plays a native kill callout. A DEAD gun still
  forwards a host `$IRTX` through its headset, so a kill confirm can ride IR (S57, the IR callout bus).
- **`$LIFE,<hp>,0,0,1,*` then `$HLED,,6,*` revives a gun killed over BLE.** Untested on a real F264 stall.
- **`$DPLAY` on a looping sound blocked the gun and dropped the link** (screamers A1). It stays on the never-send list.
## Lane: levers and screamers
Screamers are Tony's P0. Levers session 1 ran in three sittings; its remainder is bench-plan sitting 2.
Screamers Phase A has run A1 and A2 only.
- **Next desk task:** reprioritize outside R4; R4/T5 is decision first and remains blocked on Tony's explicit
  recovery-research decision. **T4 is complete:** the verified update ZIP contains 211 audio payloads, not 213;
  193 match the off-gun bank, 18 differ and none add an id. The streaming comparator copied no audio and the
  catalog stayed unchanged. **T3 is complete:** all 128 command rows now have a
  sampled-version vocabulary gate; core Open BRX names occur in every sampled tagger, `$CONNECT` joins at 2.08b,
  and the five known-safe candidates `$AS`, `$IT`, `$KK`, `$SP` and `$UP` occur only in 4.32. `$VERSION` then `$PING` is the conservative older-gun
  probe, but the existing safety tier still decides every send. **The untested-levers pass is complete:** corrected
  v4.32 contradicts the seven-field `$BHIT` and `$SPAWN`-shield claims, while fuse/splash/station semantics cross
  an unresolved gun-to-controller forwarding boundary; the levers sheet now gives a controlled next step for each
  and marks the undefined protocol-15 “perk/proximity” meanings blocked on source clarification. **F272's build is complete:** the phone and MC now expose a
  durable, older-node-safe lock verdict after two unanswered all-zero `$LIFE` reads, and recovery restores the
  full head before the configured down/respawn path begins. Its 8 s threshold and stable-radio screamer remain
  bench-provisional. R4/T2's code-read already pinned the blocking wait, 1,023-byte usable UART rings, persistent
  split frames and `$*` cleanup. F269's raw-byte helper (`raw-bytes`) is built; F300 holds the `$QUERY` sound/gyro/per-slot remainder.
- **Next bench task:** Block 2 of [`bench-2026-09-24.md`](bench-2026-09-24.md) (A4, A7, A7b, A7c, A8 with
  `raw-bytes`), then A1c, A3, A5, A6, A11 and A12.
- **Blocked:** R4/T2's full `$SIR` table on the unresolved gun-to-controller effect owner; F269 and Phase C on
  complete A7/A8 numbers; Phase E on F272's bench validation; Phase D on the Phase B rules.
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
## Lane: BLE reliability (desk half)
On `main` 2026-09-23: the desk half of F297, F269 and F270. All three stay open for the bench.
- **F297:** `python -m brx_mcp connect-metrics <address> --runs 10` asks for a gun and headset power cycle, then
  logs link time, first-attempt success and any headset or BLE drop within 30 s. The laptop connects, so a clean
  laptop run beside a looping phone points F293 at the phone.
- **F269:** `python -m brx_mcp raw-bytes` writes exact segments or a zero-gap stream under one lock and checks
  liveness after. It runs screamers A4, A7b and the zero-gap A7, A7c and A8 (command lines: screamers sheet).
- **F270:** `responseForMultiPacket` (brxlink) and `RESPONSE_FOR_MULTI_PACKET` (ble.py) ship false. Head/spawn-only
  scoping needs an engine.js call-site change.
- **Next bench task:** the ordered runbook [`bench-2026-09-24.md`](bench-2026-09-24.md). **Blocked:** F270 on A8.
## Lane: Mission Control console honesty
F178, F256, F251, F289 closed; F309, brx-net, F312's gated row built 2026-09-23. **Next:** bench F309/F311/F312; APK 0.4.6 prepared in `~/brx3-release`, awaiting Tony's go.

## Lane: S56, S57, B21 (brx4)
2026-09-23: **S57 built**, deaths, kills and objectives (docs/ir-callouts.md); Block 7 of `bench-2026-09-24.md` settles it, F312 first. S56 built. **B21:** key made; the signed cut waits for the desk fixes.
## Lane: F293 and the death screen (brx5)
2026-09-23: `brx_mcp.btlink` built; the S56 death screen built (`hud/deathscreen.js`). Next: read bench 1.3's captures; F313's field check.

## Start here

Use this priority stack; do not spend Tony's bench time on desk work:

1. **Next sitting (now):** [`bench-2026-09-24.md`](bench-2026-09-24.md), on a build from `main` (S56 and F309 are
   newer than 0.4.5), then sitting 5 for F264/F277. Record evidence and promote/close each row from the result.
2. **Screamer transport:** the runbook's Block 2, then A8b; capture F269/F270/F272, then F274's three hardware soaks. This unlocks Phase B-E; do not infer numbers from ordinary `send` runs.
3. **Decisions before more code:** B21's release key exists (2026-09-23); the signed 0.4.6 cut waits for
   Tony's go to publish. Defer S50/F281 until sitting 2 confirms `$TMP` semantics.
4. **Only after reliability:** E2/E3/E4, B17, K6/K8 and the remaining feature rows are roadmap work.

If Tony is not at the bench, prepare the decision packet and inspect the exact FOLLOWUPS methods; do not invent a
new implementation for a bench-gated row. All other open rows are parked in [`FOLLOWUPS.md`](FOLLOWUPS.md) by gate.

## Machine state

MC is `mcp/` on 8765/8766 serving `webapp/mc/dist`; rebuild before starting and restart between matches
(`ss -ltn | grep 876`). Launch with `setsid nohup ../.venv/bin/python -m brx_mcp.mc --advertise 192.168.0.55 --bench-volume`.
Shields recharge only on the Shields preset (armour 0). WSL runs Python/no-hardware MC, Windows drives BLE, and the
MacBook is the field target. Never modify stock firmware.
