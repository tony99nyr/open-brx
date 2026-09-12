# Handoff — Open BRX

**State as of 2026-09-12 (morning: the game-test sheet worked at the desk, Block D specified, WSL crash root-caused).** One screen. Open work: `FOLLOWUPS.md`; evidence: `experiment-log/`; old banners: `git log -p -- docs/HANDOFF.md`.

## ⭐ The game-test sheet is WORKED (2026-09-12 desk pass): Blocks A–C built, Block D specified, one commit

**Sheet:** [`game-test-2026-09-11.md`](game-test-2026-09-11.md) (status block at the top). **Log:** `experiment-log/2026-09.md` → 2026-09-12.
Built and verified without hardware, as parallel lanes + a polish-loop (3 read-only reviewers → 3 fix lanes):

- **Closed → archive:** F110 F115 F116 F117 F118 F119 F122 F124 F125. **🟡 bench-gated:** F121 (A23 spawn protection:
  the head's `$SIR` table is fn 28, the live table rides `spawn`/`revive`), F113 (death blanks the gun strip), F123
  (reload reconciled against `$ALCD`; easy_reload + shotgun refused; residual **F128**), F126 (iPhone confirm), F127
  (MC UI two-step CONTINUE shipped; A27 server guard + node moment = M2). **New:** F128, **P18** (fn 24: status fn per
  A20 vs "delayed blast" per F69 — the stun row `<8,0>` needs the bench), S27 (one-tap store update).
- **Safety fixes the loop found:** a refused perk pick silently ate the SECONDARY (policy order); a config push to an
  ARMED/LIVE gun is refused (A23 made it an un-hittable gun; it always un-spawned it) → **A30 THE KIT LOCKS AT START**
  (phone picks refused with a reason, host edits 400, late joiners still hot-join per E5); `control()` reports
  `{ok, ended, reached, pushed, nodes, phase, error?}` and the MC UI shows the refusal.
- **Decisions this morning (spec A24 · A29 · A30 · A31 + memory `game-test-2026-09-11-workplan`):** the match ENDS at the
  timestamp of the confirmed winner's cap kill and MC re-scores by REPLAYING the fact log when a late flush moves it
  (post-end facts kept as an unofficial "after the whistle" block); phones report a real semver build `x.y.z+sha`
  (MAJOR mismatch red, minor/patch amber; today they send `hud-0.2`); a pre-game "a win is confirmed at Mission
  Control" line unless full coverage or all phones have backhaul (A28, another session).
- ⚠ **The WSL crash (×3) was ONE test:** the stage's reload watchdog spun under a no-op sleep + hand clock and the
  test's sleep log grew to 23 GB. Fixed (`stage.py _reload_watchdog` returns when the clock does not move; `poll()`
  re-checks the deadline). Run long suites through `~/brx-scratch/watchdog.sh 6 <log> <cmd>` anyway.
- **Verified:** `python3 mcp/run_tests.py` 1312/0 (4 GB cap) · app 289/289 · MC UI 151/151 · `npm run e2e:kit`
  mock/real/stale/400 × desk/phone · HUD screen-truth 212/0 (6 GB watchdog) · every changed screen looked at.
- **Next (M2, in order):** D3 results (A24 push + replay scoring + HUD FINAL RESULTS) · D6 log sync + A29 versions ·
  D4 S24/S25 (digits need fixed-width cells: no product font has tabular figures) · D1 try-out collapse (A26) ·
  D2 sidearms (`docs/reference/ttk-model.md`; USP mag ≥ 20) · D5 drop CAM · A27/A31 · APK cut · push.
- **Android is still on APK 0.1.8** — cut before the next field day; the iPhone needs the Mac for A6/F126.

## What is true today

- ⭐⭐ **KING OF THE HILL IS BUILT, END TO END, AND MC ARMS A PHONE POINT.** A grenade in hill mode is a working
  control point over BLE: `proto=15 team=<owner> mag=8` every 5.0 s, **neutral = team 2**, `mag=50` new owner,
  `mag=53` only when it was NEUTRAL. Ship `$SIR,15,0,,28`. `hillbeacon.py` · `DominationEngine` · `control.js`
  (phone point; capture rate = leader minus the largest single rival) · MC's `koth` with `station_source`
  `grenade`/`ir_station`/`phone`. ✅ F104/S5 MC arms utility phones. ✅ **F69/F91 CLOSED tonight** — the hill does
  NOT chip anyone with the shipped fn-28 row. 🟡 **F82** never a player on tid 2; **F97** refuses a fourth team.
  Spec: `spec/utility.md` §5b-§5f. Triage: [`followups-triage.md`](followups-triage.md).
- ⭐⭐ **SIMULATED RECOIL IS REAL AND OURS TO DRIVE (2026-09-09, F46 closed).** `$WEAP` **t21 = accuracy
  ceiling · t22 = floor · `$ALCD` tok2 = live accuracy**; falls in five steps toward the floor, races a native
  recovery (**t14 sets how hard it bites**), resets on reload, and below the ceiling a shot emits **IR magnitude
  0** — a real miss, reaching the PLAYER natively and our SOFTWARE not at all. **Stock 100/100 = OFF.** Ship via
  **S17** after **F68 🔴**. Mechanism: `protocol/brx-protocol.md`.

- **The stack runs whole matches on real hardware.** MC compiles a per-player `FrameBundle`; each phone
  (`app/`, the Companion HUD) drives its own gun over BLE and reports over the LAN. MC is setup, start and
  recap only; it is never BLE-connected to guns during play. Verified: FFA 2026-08-30, TDM 2026-09-01,
  and the 1v1 game test 2026-09-11.
- **APK 0.1.8 is published** (`app-v0.1.8`, 2026-09-10): A16, A17 and the hill work; nothing since (see Next actions 4).
- **Presentation profile (contracts A11)** is built: presets `standard/silenced/counter_strike/vip/infection/
  last_stand/extraction`, per-event sound + gun-LED burst + headset colour, in the bundle. Events are HUD-driven
  except cross-player facts (kill credit, medals, lead changes, last survivor), which MC pushes best-effort.
  Headset A11.6 and gun-body A11.7 are in. The write UI is open (S2).
- **Voices (A15-A15.3):** `voices.py` reads the 22-slot character layout off the on-gun catalog; 24
  personas. Sounds VARY now, because Callsign never varied anything: a kill draws from 5 takes; the
  pains are OURS, picked by `$HIR` damage (long at 40+, short below, melee grunt on proto 13), one per
  600 ms and never on the lethal hit; the spawn line is OURS and draws per spawn; the death scream stays
  NATIVE but a `$PSET` before every `$SPAWN` re-rolls it per life. **Not yet heard on hardware.**
- **Loadout:** three slots, primary + secondary + perk (A14); sidearms Glock / USP / Deagle (A12);
  `$WEAP` tok15 is the swap delay, so Quick Switch is real (F4/F22 closed 2026-09-04).
- **Gun stage** (`python -m brx_mcp stage`, `docs/gun-stage.md`): click-to-try page for one real gun, a
  walkthrough with PASS/FAIL verdicts, and the voice soundboard (§8) for all 24 characters. `--gun` links in
  the background (S11 closed).
- **Utility station (A13):** a spare phone as a BLE-beacon respawn station is proven on hardware and **MC arms it from the
  MUSTER ITEMS panel** (S5/F104; not yet used at a field). Hosted games ignore the grenade's IR station words (B23).
  **Station hardware on order:** 2x M5StickS3 + 3x Grove IR emitters; firmware `hardware/m5sticks3/`; gates in **H7**.
- **`$PLAY` token 1 interrupts / token 4 queues (2026-09-11, A21, per-event `slot`).** 249 of 2477 (`fx:hit` complete) clips audited by ear; F45, F48, W4a, S-A12.1, F58(a) and the defeat line closed by ear, S9 all but the preset sweep; F59 is firmware not clips (`soundbank_leadin.py`), one filmed rung left. **Later the same night:** F44 closed (the shield loop is A10, heard live via `$LIFE,0,0,20,*`), S12 decided and built (`presentation.voice`, A22), and **F109** filed: `$LIFE` grants shields over BLE, so host-granted overshields/heals need no IR word.
- **Hit audio (A17, ear-confirmed 2026-09-07):** metal for armour (`H02/H36/H37`), an energy note for shield
  (`H22`), **health deliberately SILENT**. ⚠ **An empty slot is not silence** — it falls through to a
  neighbouring pool, so health ships empty only as the innermost one. `$SIR` REPLACES the `$PSET` pool sound
  (F38), so the class layer ships OFF. **A17.2** `low_health` fires below **15 HP**. **A17.3** the pain grunt is
  sized on TOTAL pools lost, on purpose. Detail in the log.
- **IR rig:** emitter (board B, COM8) registers 6/6 at 3 ft, 10/10 at 6 ft, cliff at 10 ft; work at
  6 ft or less. Receiver (board A, COM7) fragments frames but `native_capture.py` stitches them (F12
  worked around). Never end a run on a bare `$CLEAR`: it wipes the `$SIR` table (F11).
- **The public site has two doors, one source:** `docs/platform/*.md` → `/`, `/docs/*`, `/download`;
  `docs/manual/*.md` → `/manual/*`. Landings are plain markdown read by shape (`docs/site/FORMAT.md`); the
  build FAILS on a date, version or status word in them. Gate: `cd site && npm test`. Detail in the log.
- **Environment:** WSL2 has no Bluetooth; run anything that touches a gun with
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`. `mcp/pyproject.toml` pins `mcp>=2,<3`; the
  2.0 port is done. `~/.brx-mcp/armory.json` is never in git (headset PINs); stickers stay out of docs,
  use `Tactix-XXXX`. ⚠ **The git remote MOVED to `tony99nyr/open-brx`** — pushes redirect with a warning;
  `git remote set-url` silences it. Mac install traps are in the game-test sheet's environment notes.

## Recent history (detail in the log; only what still bites is kept here)

- **⭐ Callsign's whole cloud protocol is decoded** (Mac + mitmproxy **WireGuard**, not the HTTP proxy the Unity
  app ignores; `capture-runbook.md` corrected). Plain-HTTP API; game config rides the **SNS/SQS lobby**, not
  REST. Model: [`../protocol/callsign-extract/protocol-classes.md`](../protocol/callsign-extract/protocol-classes.md). **P8 largely resolved** (open: weapon stats), **P3 refined**.
- **Prior sessions 2026-09-11** (log has it): site rebuilt; triage closed 8 ids; A18 `config.mode_params` / A19 `alert.role` + `config.vip_player_id` / A20 `config.stun`.
- **LEDs (pinned by `test_led_invariants.py`, full block in archive):** never `$HLED,,6` in play (kills the
  death flash; in-play dark = `$HLED,9,0,,,10,,*`); `$TID` 0-3 only (F35); phones ship `headset.carrier` (S10).

## Next actions

1. **Bench, still open on [`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md):** A1/B1/B2 ANSWERED
   tonight (F69/F91/F23). Remaining: **A2** the t14 rate-of-fire floor (F87/F100), **B3** the capture currency
   (F70/F76), **C1** the shield grant (F60), **C2** enemy fn 35 (D6). Also block E (LED metering) and **F15 rung 9**
   (a proto-8 word at a stun-armed gun). F27 sidearms + melee reload timing are quick adds when a gun is armed. **F59**'s filmed rung is also due: phone at 240 fps on a batched `$GLED`+`$PLAY`, reading announcer/effect/hit-path latency off the video.
2. **Keyboard, in order** (`followups-triage.md` §7): **E2** the other three touch points (the registry exists) · **B23** the hosted respawn assembly (every link built) ·
   **F88** multi-point Domination on phones (the ids now reach every HUD) · **S3** extraction on phones · **B19**
   for F80's real fix · the E1 Designer editor (F107 (h)) · **E5** phone audio when there is an ear for it.
3. **Work the game-test sheet** ([`game-test-2026-09-11.md`](game-test-2026-09-11.md)): block A is six confirmed
   bugs behind ONE rebuild-and-install; B/C are MC- and node-side; D needs Tony's decisions; E needs the bench.
   ⚠ **APK 0.1.8 is still what the Android runs** — cut a fresh one before the next field day (debug-signed, B21).
4. **Hear A15.3 on a gun** — partly done 2026-09-11 and it found F114/F120; the scream/spawn/pain sweep is open.
5. ⚠ **Nothing shield-shaped has EVER been on a gun** (F60); rung C1 is the first attempt.

**Bench sheet: [`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md)** (self-contained). Queue:
[`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md). Register: FOLLOWUPS §9. Pre-flight: `gotchas.md`.

## Machine roles

**Windows PC (WSL2 + Windows Python)** = primary development. **MacBook** = field / match day, and the only capture
rig (Callsign is effectively iOS-only: the Android build cannot connect a gun; PacketLogger is macOS-only), so capture
jobs batch for a Mac day (`capture-runbook.md`, `mac-dev-runbook.md`). Code must run on both: macOS gives BLE UUIDs, Windows/BlueZ MACs.

## Where things live

| what | where |
|---|---|
| Open work, all of it, by id | `FOLLOWUPS.md` (incl. "Needs Tony at the bench" and "System proofs") |
| Evidence, append after every session | `experiment-log/` (by month) |
| Field lore by symptom, bench pre-flight | `gotchas.md` |
| Issues at a live session · Mac-only capture jobs | `field-issues.md` · `capture-runbook.md` |
| Start MC with no hardware (the command, the busy-port trap) / running a match / armory + muster / Mac setup / one-gun bench page | `../mcp/brx_mcp/mc/README.md` → *Start it* · `field-runbook-mc.md` · `field-process.md` · `mac-dev-runbook.md` · `gun-stage.md` |
| Spec of record / protocol truth / confirmed BRX facts | `spec/contracts.md` · `../protocol/brx-protocol.md` · `manual/` |
| History: old handoff banners, closed bench sheets, superseded handoffs | `archive/` |
