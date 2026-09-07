# Handoff — Open BRX

**State as of 2026-09-06.** One screen. Open work lives in `FOLLOWUPS.md`; evidence in
`experiment-log.md`; the dated banners that used to live here are in
[`archive/handoff-history.md`](archive/handoff-history.md) (newest first, verbatim).

## What is true today

- **The stack runs whole matches on real hardware.** Mission Control (`mcp/brx_mcp/mc`, `python -m
  brx_mcp.mc`) compiles a per-player `FrameBundle`; each player's phone (`app/`, the Companion HUD)
  drives its own gun over BLE and reports to MC over the LAN. Verified end to end: a 300 s FFA on
  2026-08-30 (two iPhones, MacBook host, 12 kills / 126 hits) and a TDM outdoors on 2026-09-01 (two
  Android HUDs). MC is setup, start and recap only; it is not BLE-connected to guns during play.
- **APK 0.1.6 = `83542f3` is what phones have; 0.1.7 is REQUIRED before the next game** and has not
  been built (`webapp/download/build.json` still reads 0.1.6). Un-shipped since 83542f3: the engine's
  2.5 s `gun.take` timer, the A11.8 kill flash and 750 ms out-pulse, the A14 perk slot, the utility
  phone's MC link. Build: `cd app && npm run android:apk`, then rebuild the site.
- **Presentation profile (contracts A11)** is built: presets `standard / silenced / counter_strike / vip
  / infection / last_stand / extraction`, per-event sound + gun-LED burst + headset colour, shipped in
  the bundle. Events are **HUD-driven** (fire on the phone from the bundle) except cross-player facts
  (kill credit, medals, lead changes, last survivor), which MC pushes best-effort. Headset block A11.6
  and gun-body A11.7 (default `team`, body blanked 2.5 s after `$SPAWN`) are in. The MC console shows
  it read-only; the write UI is open (S2).
- **Voices (A15-A15.3, 2026-09-06):** `voices.py` reads the 22-slot character layout off the on-gun catalog;
  24 selectable personas. Sounds VARY now, because the Callsign app never varied anything (13 captured kills,
  one frame): a single kill draws from 5 takes (3 kill confirms + 2 taunts); the pains are OURS, picked by the
  `$HIR` damage (long at 40+: shotgun / snipers / power; short below; melee grunt on proto 13), one per 600 ms,
  never on the lethal hit; the spawn line is OURS (an empty `battleRespawnCry` silences the firmware) and draws
  per spawn; the death scream stays NATIVE but a `$PSET` written before every `$SPAWN` re-rolls it per life.
  Slot 2 is the tear-gas death in every family, not an idle line; slot 6 (hurt loop) is the critical-health
  sound; slot J (long death) is retired. **Not yet heard on hardware** - the gun slept before the build landed.
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
- **IR rig:** emitter (board B, COM8) registers 6/6 at 3 ft, 10/10 at 6 ft, cliff at 10 ft; work at
  6 ft or less. Receiver (board A, COM7) fragments frames but `native_capture.py` stitches them (F12
  worked around). Never end a run on a bare `$CLEAR`: it wipes the `$SIR` table (F11).
- **Environment:** WSL2 has no Bluetooth; run anything that touches a gun with
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`. `mcp/pyproject.toml` pins `mcp>=2,<3`; the
  2.0 port is done. `~/.brx-mcp/armory.json` is never in git (headset PINs); stickers stay out of
  docs, use `Tactix-XXXX`.

## What changed since the last handoff (2026-09-04 night to 2026-09-07)

- **Repo hygiene, 2026-09-07 (decision: keep ONE repo).** A split was reviewed and rejected on evidence:
  only 24 of 741 commits touch the manual/site *and* software, but the site build reads two code-owned
  data files and the manual's provenance citations point into `protocol/` and `mcp/`; and 160 commits
  touch software *and* the working docs, which a public/private split would break. Executed instead:
  the raw Callsign JSONs are gone (restated as our own data under `mcp/brx_mcp/data/`), CONTRIBUTING and
  a code of conduct exist, `test_ui_contract.py` now fails on UI↔server drift (it caught three real
  gaps), apk builds publish to a GitHub Release, and the PDF + ten stale apk blobs are purged from
  history: **pack 93 MB → 28 MB, so every SHA changed. `git fetch && git reset --hard origin/main`,
  do not pull.** Backup: `~/brx-backups/open-brx-pre-purge-2026-09-07.bundle`.

- The APK's own metadata was read: `$LED` has two fields (colour, green flag), `$BLINK` is
  `colour, on, off, level 0-10, loop`, `$BHIT` injects a hit through the firmware path. Wall-camera
  measurement: the native hit flash beats ours by at least 2x. Both feed the next bench sheet.
- `docs/gun-stage.md` gained the WSL driving notes (host address, safe stop, emitter port).
- FOLLOWUPS: F25 (is every kill "confirmed by MC"?), E1-E7 extensibility (`docs/utility-roadmap.md` §9),
  S7/S9 de-collided.
- **⭐ LEDs: A16 BUILT AND COMMITTED (parts 1 + 2), after a bench night that retracted two beliefs.**
  `docs/led-language.md` is the design of record; `contracts.md` A16/A16.2 is the spec.
  - **The native death flash was never missing from hosted games — our own `$HLED,,6` was disabling it.**
    Effect 6 kills the firmware's death-flash loop for the rest of that life, and it was our `in_play: dark`
    rest frame. A colour write does not. In-play dark is now `$HLED,9,0,,,10,,*`; effect 6 is teardown-only.
    This deletes the whole A11.8 `death_flash` scheme (`$LED` pulsed at 750 ms, ~80 writes/min, at least 2x
    dimmer than the firmware's own). `$HLOOP,<1|2>,<ms>` drives that loop over BLE at native drive or better;
    `$HLOOP,0,0` stops it and `$SPAWN` clears it. The node now writes NOTHING at death and re-arms once.
  - **Gun body rests DARK** with a transient 3-segment pool readout (shield WHITE, armour PURPLE, health
    GREEN/YELLOW/RED, innermost moved pool wins, 4 s hold, 2 s reload glance). The blank is mandatory before
    any paint, once per life; a held paint survives 8 min and all game traffic. **night is a DIM overlay, not
    a blackout** (token 5 = 1; ⚠ apply-gate 5 is OFF, not the "~1/3" documented since 2026-09-02 — retracted);
    a separate `blackout` switch empties the tables and the DOWN signal survives both.
  - **`$TID` is 0-3 only (F35).** The IR word's team field is 2 bits so a gun transmits `tid & 3` while the
    victim compares the FULL tid: on tid >= 4 teammates damage each other, their shots do nothing to the tid
    they alias onto, and a gun can kill itself off a nearby surface (observed — one drained its own armour to
    zero). Guarded in `state.py` and `compile.validate()`. Team COLOUR is now decoupled from the tid, so team
    3 keeps green on the wire and paints PURPLE. FFA is white (Q19 closed).
  - Headset **role states** survive hits (carrier WHITE, infected, vip, beacon, extracted); the last three
    have no trigger reaching the node yet (S10 sub-item).
  - **The gun stage is now event-driven** (`ble.py` gained an `on_frame` callback): a hit reacts in ~36 ms
    instead of up to a poll tick, `spawn()` waits the real T-3 countdown lead instead of cutting the
    countdown off mid-"2", and `page.html` shows a GUN BODY READOUT tile.
  - ⚠ **Phones are on a pre-`role` APK**, so `presentation.headset_frames()` still ships the legacy
    `headset.carrier` key on purpose — deleting it breaks the flag blink in the field. Delete once an APK
    carrying `role` is deployed (S10). **None of the node-side work reaches a player until that APK ships.**
  - `mcp/tests/test_led_invariants.py` walks every reachable frame across every preset x team x night x ffa
    and pins these facts; it caught a real defect within an hour.
- Docs consolidation:- Docs consolidation: sticker ids swept (fc6d1e3); `docs/archive/` created; this file cut to one
  screen; the bench queues, `unknowns.md` and `verification-checklist.md` folded into FOLLOWUPS §9/§10 (the old files sit in `archive/`).

## Next actions

1. **Hear A15.3 on a gun** (10 min, one tagger + emitter): power the tagger, start the stage without `--gun`,
   CONNECT, ARM, then spawn/respawn a few times and take rifle and BIG HIT (80) hits. Confirm the scream changes
   per life, the spawn line varies, short vs long pain match the damage, and a kill draws from the 5 takes.
2. **Build and ship APK 0.1.7**, rebuild the site, install on both phones.
3. **Build an APK carrying A16** — until it ships, none of the node-side LED work (dark rest, the pool
   readout, the `$HLOOP` down signal, headset roles) reaches a player, and `presentation.py`'s legacy
   `headset.carrier` key cannot be deleted. Then see the A16 bar and the down flash in a real match.
4. **Bench, gun body only** (`bench-flash-control-2026-09-05.md` §6 L10-L14, ~15 min): the down-signal
   ladder L1-L9 is ANSWERED and mostly moot; what is left is a metered A/B of `$HLOOP,2,750` against a
   native out-blink (the "might be brighter" call was one operator, one session, no meter), the rate's
   usable range, a dim 2-of-3 held 60 s, and `$TID,4` purple.
5. **Build S5** (MC arms utility stations at muster), then run the `$WEAP` blind-token plan in
   `docs/bench-weap-tokens-discovery-2026-09-04.md` (sensor damage F23 first).

**The bench queue** is the "Needs Tony at the bench" section of `FOLLOWUPS.md` plus one dated run
sheet at a time (today: the gun-body rungs above, then weap-tokens-discovery, then the remaining steps in
`bench-grenade.md`). Read `gotchas.md` first; its "Before a bench session" block is the pre-flight.

## Machine roles

| Machine | Role | Notes |
|---|---|---|
| **Windows PC (WSL2 + Windows Python)** | **primary development** | Code, protocol work, Android-side captures, the IR rig and the gun stage. |
| **MacBook** | **field / match day, and the only capture rig** | Goes to the field with the taggers. Keep `mcp/` working here (`docs/mac-dev-runbook.md`). |

**Only the MacBook can capture the official app.** Callsign is iOS-only, iOS Bluetooth traces need
PacketLogger, and PacketLogger is macOS-only, so every "capture what the real app does" job
(`docs/capture-runbook.md`) is batched for a Mac day. PacketLogger is at
`/Applications/PacketLogger.app` and the iPhone X carries Apple's Bluetooth logging profile. Flow: plug
the iPhone in via USB (needs a hub), **File → New iOS Trace**, confirm lines are scrolling *before*
playing, then **File → Export → btsnoop**; decode with `python -m brx_mcp.btsnoop <file>`. Two traps
that each cost a capture: export acts on the **frontmost** window, and a trace that is not actually
recording produces a silently useless file.

Code must run on both machines: macOS gives BLE UUIDs, Windows/BlueZ give MACs; never pattern-match
the address format (`_split_addrs()` in `__main__.py` handles both).

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
