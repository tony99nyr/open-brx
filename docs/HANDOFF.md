# Handoff — Open BRX

**State as of 2026-09-07 (late).** One screen. Open work lives in `FOLLOWUPS.md`; evidence in
`experiment-log.md`; the dated banners that used to live here are in
[`archive/handoff-history.md`](archive/handoff-history.md) (newest first, verbatim).

## What is true today

- **The stack runs whole matches on real hardware.** Mission Control (`mcp/brx_mcp/mc`, `python -m
  brx_mcp.mc`) compiles a per-player `FrameBundle`; each player's phone (`app/`, the Companion HUD)
  drives its own gun over BLE and reports to MC over the LAN. Verified end to end: a 300 s FFA on
  2026-08-30 (two iPhones, MacBook host, 12 kills / 126 hits) and a TDM outdoors on 2026-09-01 (two
  Android HUDs). MC is setup, start and recap only; it is not BLE-connected to guns during play.
- **APK 0.1.7 IS built and published** (`app-v0.1.7`, from `51cc20b`, 2026-09-07 18:46) — the
  handoff said otherwise until 2026-09-07, which would have sent someone to rebuild what exists.
  ⚠ **It predates A16 + A17** (`976e35a`), so the LED language and the hit audio are NOT on any
  phone: dark rest, the pool readout, the `$HLOOP` down signal, headset roles and the material hit
  sounds all need a NEW build. `cd app && npm run android:apk`, then rebuild the site.
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
  (`~/.brx-mcp/voice-verdicts.jsonl`). Start it WITHOUT `--gun` (S11: that flag blocks the web server until
  the gun answers) and press CONNECT.
- **Utility station (A13):** a spare phone as a BLE-beacon respawn station is proven on hardware and
  built on the phone side; **MC arming at muster (S5, A13.5) is not built.** A hosted game ignores the
  grenade's IR station words (B23), so hosted respawn stations are node-defined.
- **Sound bank:** all 2477 on-gun clips are off the gun and classified (`sound_catalog.json`,
  `docs/reference/sound-catalog.md`); 148 ids audited by ear. The in-game sound pass is open (S9).
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
- **Environment:** WSL2 has no Bluetooth; run anything that touches a gun with
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`. `mcp/pyproject.toml` pins `mcp>=2,<3`; the
  2.0 port is done. `~/.brx-mcp/armory.json` is never in git (headset PINs); stickers stay out of
  docs, use `Tactix-XXXX`.

## What changed since the last handoff (2026-09-04 night to 2026-09-07)

- **Repo hygiene, 2026-09-07: ONE repo, decided on evidence** (a split breaks the site build's two
  code-owned data files and the manual's provenance citations). Raw Callsign JSONs restated as our own
  data; CONTRIBUTING + code of conduct exist; apks publish to a GitHub Release. The PDF and ten stale
  apk blobs are **purged from history: pack 93 MB → 28 MB, every SHA changed. `git fetch && git reset
  --hard origin/main`, do not pull.** Backup: `~/brx-backups/open-brx-pre-purge-2026-09-07.bundle`.
- APK metadata read (`$LED`, `$BLINK`, `$BHIT`); the native hit flash beats ours by 2x on camera —
  both feed the next bench sheet. `gun-stage.md` gained the WSL driving notes.
- **⭐ LEDs: A16 BUILT + COMMITTED (parts 1+2); a bench night retracted two beliefs.**
  `docs/led-language.md` is the design of record; `contracts.md` A16/A16.2 is the spec.
  - **The native death flash was never missing — our own `$HLED,,6` was disabling it.** Effect 6 kills
    the firmware's death-flash loop for the rest of that life, and it was our `in_play: dark` rest frame.
    In-play dark is now `$HLED,9,0,,,10,,*`; effect 6 is teardown-only. Deletes the A11.8 `death_flash`
    scheme. `$HLOOP,<1|2>,<ms>` drives the loop over BLE, `$HLOOP,0,0` stops it, `$SPAWN` clears it; the
    node writes NOTHING at death and re-arms once.
  - **Gun body rests DARK** with a transient pool readout — **A16.3: SEVEN levels** + a drop animation
    (shield WHITE, armour PURPLE, health GREEN/YELLOW/RED, innermost moved pool wins, 4 s hold). Half-steps
    BLINK: per-LED brightness does not exist, the token is global. The blank is mandatory before any paint,
    once per life. **Night is a DIM overlay, not a blackout** (token 5 = 1; ⚠ apply-gate 5 is OFF, not the
    "~1/3" believed since 2026-09-02 — retracted); `blackout` empties the tables, DOWN survives both.
  - **`$TID` is 0-3 only (F35).** The IR team field is 2 bits so a gun sends `tid & 3` while the victim
    compares the FULL tid: on tid >= 4 teammates damage each other, their shots do nothing to the tid they
    alias onto, and a gun can kill itself off a surface (observed). Guarded in `state.py` + `compile.validate()`.
    Team COLOUR is decoupled from the tid now (team 3 = green on the wire, PURPLE painted); FFA white (Q19).
  - Headset **role states** survive hits (carrier WHITE, infected, vip, beacon, extracted); the last
    three have no trigger reaching the node yet (S10). The gun stage is **event-driven** now (`ble.py`
    `on_frame`): a hit reacts in ~36 ms, not a poll tick.
  - ⚠ **Phones are on a pre-`role` APK**: `headset_frames()` still ships the legacy `headset.carrier`
    key on purpose (delete only once an APK with `role` is deployed, S10). `test_led_invariants.py`
    pins these facts across every preset x team x night x ffa, and across compiled bundles.
- **⭐ Python reviewed + deduped, 2026-09-07.** Suite 809 → **993 passed / 0 failed / 46 skipped / 78
  files**, ~150 new tests. Real dedupe (CLI wire tables imported from `gameconfig`, one armed-pool
  formula, one `_resend`, a `ScoredEngine` base, one event-loop policy for eleven hand-rolled helpers)
  — but the duplication was NOT the problem. **Seven bugs a green suite was hiding:** five bench tools
  AND the diag runner ending on a bare `$CLEAR`; `diag/cases.py` shipping 5 of 10 `$SIR` rows; `alert`
  missing from `MC_KINDS` so every A11.4 alert was rejected at the node; the fallback compiler playing
  the VICTORY sting at every game over; extraction crediting the wrong gun on a shared team.
  **F40 is the lesson and it recurred four times: a guard that cannot see the fault it was built for**
  (a teardown scan reading only `finally:` blocks, a sweep reading only named constants, an LED harvest
  never importing the compiler, and an "ids are unique" check that saw 1 id out of 89 while three
  sessions collided on F40-F42). Each was correct for where it looked. Remaining debt is **F42**; the
  un-guardable half — wrong only against a bench measurement — is **F43**.
- Docs consolidation: sticker ids swept (fc6d1e3); `docs/archive/` created; this file cut to one
  screen; the bench queues, `unknowns.md` and `verification-checklist.md` folded into FOLLOWUPS §9/§10.

## Next actions

1. **Hear A15.3 on a gun** (10 min, one tagger + emitter): power the tagger, start the stage without `--gun`,
   CONNECT, ARM, then spawn/respawn a few times and take rifle and BIG HIT (80) hits. Confirm the scream changes
   per life, the spawn line varies, short vs long pain match the damage, and a kill draws from the 5 takes.
2. **Build and ship an APK carrying A16 + A17** (0.1.7 is published but predates both). Until it
   ships, none of the LED work (dark rest, pool readout, `$HLOOP` down signal, headset roles) and none
   of the hit audio reaches a player, and `presentation.py`'s legacy `headset.carrier` key cannot be
   deleted. Then see the A16 bar, the down flash and the material hits in a real match.
4. **Bench, gun body only** (`bench-flash-control-2026-09-05.md` §6 L10-L14, ~15 min): the down-signal
   ladder L1-L9 is ANSWERED and mostly moot; what is left is a metered A/B of `$HLOOP,2,750` against a
   native out-blink (the "might be brighter" call was one operator, one session, no meter), the rate's
   usable range, a dim 2-of-3 held 60 s, and `$TID,4` purple.
5. **Build S5** (MC arms utility stations at muster), then run the `$WEAP` blind-token plan in
   `docs/bench-weap-tokens-discovery-2026-09-04.md` (sensor damage F23 first).

**The bench queue** is the "Needs Tony at the bench" section of `FOLLOWUPS.md` plus one dated run
sheet at a time (today: `bench-super-indoor-2026-09-07.md` on the Mac, the gun-body rungs above, then
weap-tokens-discovery, then `bench-grenade.md`). Read `gotchas.md` first; its "Before a bench session" block is the pre-flight.

## Machine roles

| Machine | Role | Notes |
|---|---|---|
| **Windows PC (WSL2 + Windows Python)** | **primary development** | Code, protocol work, Android-side captures, the IR rig and the gun stage. |
| **MacBook** | **field / match day, and the only capture rig** | Goes to the field with the taggers. Keep `mcp/` working here (`docs/mac-dev-runbook.md`). |

**Only the MacBook can capture the official app** (Callsign is iOS-only, PacketLogger is macOS-only),
so every capture job is batched for a Mac day — full flow and its two capture-costing traps are in
`docs/capture-runbook.md`. Code must run on both machines: macOS gives BLE UUIDs, Windows/BlueZ give
MACs; never pattern-match the address format (`_split_addrs()` handles both).

## Where things live

| what | where |
|---|---|
| Open work, all of it, by id | `FOLLOWUPS.md` (incl. "Needs Tony at the bench" and "System proofs") |
| Evidence, append after every session | `experiment-log.md` |
| Field lore by symptom, bench pre-flight | `gotchas.md` |
| Issues reported at a live session + what to check next match | `field-issues.md` |
| Running a match / armory + muster / Mac setup / one-gun bench page | `field-runbook-mc.md` · `field-process.md` · `mac-dev-runbook.md` · `gun-stage.md` |
| Mac-only capture jobs | `capture-runbook.md` |
| Spec of record / protocol truth / confirmed BRX facts | `spec/contracts.md` · `../protocol/brx-protocol.md` · `manual/` |
| History: old handoff banners, closed bench sheets, superseded handoffs | `archive/` |
