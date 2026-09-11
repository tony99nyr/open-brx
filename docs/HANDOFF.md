# Handoff — Open BRX

**State as of 2026-09-11 (late: the bench pass, then the sound pass).** One screen. Open work: `FOLLOWUPS.md`; evidence: `experiment-log/`; old banners:
[`archive/handoff-history.md`](archive/handoff-history.md).

## Tonight's bench (2026-09-11, three closes, all written up, tests green, NOT committed)

- **F69 + F91 CLOSED.** No ambient `proto=0` word exists: a receiver on a live neutral hill saw only
  `proto=15` beacons for ~5 min while the gun bled. The chip damage is manufactured INSIDE the gun by the
  fn-24 blast row; with the SHIPPED `$SIR,15,0,,28` a 100/200 gun took nothing beside a live hill for 70 s.
  Moving weapons off protocol 0 solved a non-problem; retired. **Rule: never ship fn 24-27 on any cell.**
- **F74 → 🟡.** The "phantom replay" was emitter + grenade pinging a fn-24-armed gun, plus a tool trap:
  `ir-emit` returns instantly while the board fires ~0.15 s/repeat (1000-count = ~2.5 min). Tool now prints
  the estimate and takes `--wait`; gotchas has the line. The zero-IR self-replay was NOT reproduced; kept open.
- **F23 CLOSED.** Damage depends on the SENSOR: body always ×1; headset fn 36 ×(1+t7/200), fn 37 ×(1+2·t7/100),
  t7 = `$GSET` critModifier (default 50 → ×1.25 / ×2). Crit bit never fired; reconciles the Aug/Sep dispute
  (different sensors). `compile.py` has `headset_multiplier()`; htk/ttk stay on the body number; docs fixed ×7.
  ⚠ side effects: sidearms inherit subtype 3 (top headset bonus); kid_mode halves t7.
- **F27 (open):** handle-to-refill is SLOWER than catalog on all three (AR 1701 vs 1400, burst 2160 vs 1700,
  charge 3220 vs 2500), so the RELOADING HUD bar ends early; sidearms/melee open. ⚠ **Link tonight:** after
  ~55 min the BLE link dropped ~15 s into every long `send_batch`; the fix was the 4-frame spawn tail post-arm.

## What is true today

- ⭐⭐ **KING OF THE HILL IS BUILT, END TO END (2026-09-10/11), AND MC CAN NOW ARM A PHONE POINT (2026-09-11 late).**
  A $200 BRX grenade in hill mode is a working control point, proven **through the gun over BLE**: beacons
  `proto=15 team=<owner> mag=8` every 5.0 s, **neutral = team 2**, `mag=50` announces the new owner, **`mag=53`
  only when the point was NEUTRAL before**. The row to ship is `$SIR,15,0,,28`. Shipped: `hillbeacon.py`,
  `DominationEngine` possession scoring, `control.js` (the PHONE control point, capture rate = leader minus the
  **largest single rival**), the phone's hill audio, MC's `koth` mode with `station_source` **`grenade` /
  `ir_station` / `phone`**, and the possession fact with an `observed_ms` floor.
  ✅ **F104/S5: MC arms utility phones** (the ITEMS panel; and `MC_KINDS` had lacked `alert` too, F105, fixed).
  ✅ **F69/F91 CLOSED tonight** (see Tonight's bench): the hill does NOT chip anyone with the shipped fn-28 row.
  🟡 **F82**: never a player on tid 2 in a hill mode; refused at three layers, and **F97** now refuses a fourth team.
  **F101, F102 and F103 are closed**: the stage models the phone control point too (an injected advert through
  the phone's own byte layout), so the whole phone-sourced hill is rehearsable at the bench before a field day.
  Spec: `spec/utility.md` §5b–§5f. Triage of everything open: [`followups-triage.md`](followups-triage.md).
- ⭐⭐ **SIMULATED RECOIL IS REAL AND OURS TO DRIVE (2026-09-09, F46 closed).** `$WEAP` **t21 = accuracy
  ceiling · t22 = floor · `$ALCD` tok2 = live accuracy**; falls in five steps toward the floor, races a native
  recovery (**t14 sets how hard it bites**), resets on reload, and below the ceiling a shot emits **IR magnitude
  0** — a real miss, reaching the PLAYER natively and our SOFTWARE not at all. **Stock 100/100 = OFF.** Ship via
  **S17** after **F68 🔴**. Mechanism: `protocol/brx-protocol.md`.

- **The stack runs whole matches on real hardware.** Mission Control (`mcp/brx_mcp/mc`, `python -m
  brx_mcp.mc`) compiles a per-player `FrameBundle`; each player's phone (`app/`, the Companion HUD)
  drives its own gun over BLE and reports to MC over the LAN. Verified end to end: a 300 s FFA on
  2026-08-30 (two iPhones, MacBook host, 12 kills / 126 hits) and a TDM outdoors on 2026-09-01 (two
  Android HUDs). MC is setup, start and recap only; it is not BLE-connected to guns during play.
- **APK 0.1.8 is published** (`app-v0.1.8`, 2026-09-10): A16, A17 and the hill work; nothing since (see Next actions 4).
- **Presentation profile (contracts A11)** is built: presets `standard / silenced / counter_strike / vip
  / infection / last_stand / extraction`, per-event sound + gun-LED burst + headset colour, shipped in
  the bundle. Events are **HUD-driven** (fire on the phone from the bundle) except cross-player facts
  (kill credit, medals, lead changes, last survivor), which MC pushes best-effort. Headset block A11.6
  and gun-body A11.7 (default `team`, body blanked 2.5 s after `$SPAWN`) are in. The MC console shows
  it read-only; the write UI is open (S2).
- **Voices (A15-A15.3):** `voices.py` reads the 22-slot character layout off the on-gun catalog; 24
  personas. Sounds VARY now, because Callsign never varied anything: a kill draws from 5 takes; the
  pains are OURS, picked by `$HIR` damage (long at 40+, short below, melee grunt on proto 13), one per
  600 ms and never on the lethal hit; the spawn line is OURS and draws per spawn; the death scream stays
  NATIVE but a `$PSET` before every `$SPAWN` re-rolls it per life. **Not yet heard on hardware.**
- **Loadout:** three slots, primary + secondary + perk (A14); sidearms Glock / USP / Deagle (A12);
  `$WEAP` tok15 is the swap delay, so Quick Switch is real (F4/F22 closed 2026-09-04).
- **Gun stage** (`python -m brx_mcp stage`, `docs/gun-stage.md`): click-to-try page for one real gun
  plus a walkthrough with PASS/FAIL verdicts, and since 2026-09-06 the **voice soundboard** (§8): pick any of
  the 24 characters, hear every line it carries with its role and words, ✓/✗ each one
  (`~/.brx-mcp/voice-verdicts.jsonl`). `--gun` now links in the background (S11 closed): the page is up at
  once, LINKED=false until the gun answers, and CONNECT still works.
- **Utility station (A13):** a spare phone as a BLE-beacon respawn station is proven on hardware, built on the
  phone side, and **MC arms it from the MUSTER ITEMS panel since 2026-09-11 (S5/F104 closed; not yet used at a field):**
  assignments persist across an MC restart, the recap carries a stations row, battery + app version ride the heartbeat.
  Hosted games ignore the grenade's IR station words (B23), so hosted respawn stations are node-defined.
  **Station hardware is on order (2026-09-11):** 2× M5StickS3 + 3× Grove IR emitters ([`../hardware/inventory.md`](../hardware/inventory.md)); firmware `hardware/m5sticks3/`; gates in **H7**.
- **`$PLAY` token 1 interrupts / token 4 queues (2026-09-11, A21, per-event `slot`).** 249 of 2477 (`fx:hit` complete) clips audited by ear; F45, F48, W4a, S-A12.1, F58(a) and the defeat line closed by ear, S9 all but the preset sweep; F59 is firmware not clips (`soundbank_leadin.py`), one filmed rung left. **Later the same night:** F44 closed (the shield loop is A10, heard live via `$LIFE,0,0,20,*`), S12 decided and built (`presentation.voice`, A22), and **F109** filed: `$LIFE` grants shields over BLE, so host-granted overshields/heals need no IR word.
- **Hit audio (A17, ear-confirmed 2026-09-07):** metal for armour (`H02/H36/H37`), an energy note for
  shield (`H22`), **health deliberately SILENT** — real damage is where the metal stops and the pain
  grunt starts. Every id picked by acoustic SHAPE was rejected by ear (features separate tonal from
  noisy, never metal from electronic). ⚠ **An empty slot is not silence** — it falls through to a
  neighbouring pool; health can ship empty only as the innermost one. `$SIR` REPLACES the `$PSET` pool
  sound rather than layering (F38), so the class layer ships OFF and the stock rows' empty sound tokens
  are what make the pool sounds audible. **A17.2:** `low_health` now fires below **15 HP**, not when
  armour reaches 0 — the old rule fired on the first health hit of a life (44/45 HP), and A17's silence
  made that the only sound on the transition. **A17.3:** the pain grunt is still sized on TOTAL pools
  lost, not the HP portion, on purpose — a round that strips your plating and reaches you is a heavy hit.
- **IR rig:** emitter (board B, COM8) registers 6/6 at 3 ft, 10/10 at 6 ft, cliff at 10 ft; work at
  6 ft or less. Receiver (board A, COM7) fragments frames but `native_capture.py` stitches them (F12
  worked around). Never end a run on a bare `$CLEAR`: it wipes the `$SIR` table (F11).
- **The public site has two doors and one source (2026-09-11).** `docs/platform/*.md` → `/` (the marketing
  landing for the ecosystem), `/platform/` (the platform landing, as a match runs), `/docs/*`
  and `/download` (Android card rendered off the APK sidecar, iOS = build from source); `docs/manual/*.md` →
  `/manual/*` with its own landing. Two templates in `site/build.mjs` (`doc`, `landing`); landings are plain
  markdown read by shape (`docs/site/FORMAT.md` "Landing pages") and the build FAILS on a date, version or status
  word in them. Screenshots are generated (`cd site && npm run shots`) and `test_site_shots.py` fails when the UI
  source moves past them. Gate: `cd site && npm test`, 82 steps at 1280 and 390. Photos are real (Gemini-edited, the HUD frame
  composited onto the phone); `og.jpg` is the share card; the wordmark names the place and opens the core places; `MODES[*].proven` badges unproven modes.
- **Environment:** WSL2 has no Bluetooth; run anything that touches a gun with
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`. `mcp/pyproject.toml` pins `mcp>=2,<3`; the
  2.0 port is done. `~/.brx-mcp/armory.json` is never in git (headset PINs); stickers stay out of
  docs, use `Tactix-XXXX`.

## Recent history (detail in the log; only what still bites is kept here)

- **Prior sessions 2026-09-11:** site rebuilt (two doors, one source, see "What is true today"); a triage
  pass closed 8 ids (F102 F54 S11 F57 F15 F78 E1 S5) and added amendments A18 `config.mode_params`, A19
  `alert.role` + `config.vip_player_id`, A20 `config.stun`. Full story: [`experiment-log/2026-09.md`](experiment-log/2026-09.md).
- **LEDs, the three A16 facts that still bite:** `$HLED,,6` must NEVER be sent in play (kills the firmware
  death flash for the life; in-play dark is `$HLED,9,0,,,10,,*`, `$HLOOP` is the down signal); `$TID` is 0-3
  only (F35); phones are on a pre-`role` APK so `headset_frames()` still ships `headset.carrier` (S10).
  `test_led_invariants.py` pins all of it.

## Next actions

1. **Bench, still open on [`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md):** A1/B1/B2 ANSWERED
   tonight (F69/F91/F23). Remaining: **A2** the t14 rate-of-fire floor (F87/F100), **B3** the capture currency
   (F70/F76), **C1** the shield grant (F60), **C2** enemy fn 35 (D6). Also block E (LED metering) and **F15 rung 9**
   (a proto-8 word at a stun-armed gun). F27 sidearms + melee reload timing are quick adds when a gun is armed. **F59**'s filmed rung is also due: phone at 240 fps on a batched `$GLED`+`$PLAY`, reading announcer/effect/hit-path latency off the video.
2. **Keyboard, in order** (`followups-triage.md` §7): **E2** the other three touch points (the registry exists) · **B23** the hosted respawn assembly (every link built) ·
   **F88** multi-point Domination on phones (the ids now reach every HUD) · **S3** extraction on phones · **B19**
   for F80's real fix · the E1 Designer editor (F107 (h)) · **E5** phone audio when there is an ear for it.
3. **Hear A15.3 on a gun** (10 min): scream per life, spawn line varies, pain matches damage.
4. **APK 0.1.8** (`app-v0.1.8`) carries A16/A17/hill; **nothing since is on a phone** — two sessions of engine
   fixes (F81 · F34 · F47 · F86 · F103 · F105 · F57 · F15 · the utility heartbeat) need a NEW build before a field day.
   ⚠ Debug-signed (B21).
5. ⚠ **Nothing shield-shaped has EVER been on a gun** (F60); rung C1 is the first attempt.

**Next bench sheet: [`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md)**, self-contained. Whole queue:
[`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md). Register: FOLLOWUPS §9. Pre-flight: `gotchas.md`.

## Machine roles

| Machine | Role | Notes |
|---|---|---|
| **Windows PC (WSL2 + Windows Python)** | **primary development** | Code, protocol work, Android-side captures, the IR rig and the gun stage. |
| **MacBook** | **field / match day, and the only capture rig** | Goes to the field with the taggers. Keep `mcp/` working here (`docs/mac-dev-runbook.md`). |

**Only the MacBook can capture the official app** (Callsign iOS-only, PacketLogger macOS-only), so capture
jobs batch for a Mac day — flow and its two capture-costing traps: `docs/capture-runbook.md`. Code must run on
both: macOS gives BLE UUIDs, Windows/BlueZ give MACs; never pattern-match the format (`_split_addrs()` does).

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
