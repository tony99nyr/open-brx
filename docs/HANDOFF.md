# Handoff — Open BRX

**State as of 2026-09-09.** One screen. Open work: `FOLLOWUPS.md`; evidence: `experiment-log.md`; old
banners: [`archive/handoff-history.md`](archive/handoff-history.md).

## What is true today

- ⭐⭐ **SIMULATED RECOIL IS REAL AND OURS TO DRIVE (2026-09-09, F46 closed).** `$WEAP` **t21 = accuracy
  ceiling · t22 = floor · `$ALCD` tok2 = live accuracy**; drops ~1/5 of the range per shot, races a native
  recovery (**t14 sets how hard it bites**), resets on reload, and below the ceiling a shot emits **IR
  magnitude 0** — a real miss, which reaches the PLAYER natively and our SOFTWARE not at all. **Stock
  100/100 = OFF.** Ship via **S17** after **F68 🔴**. Mechanism: `protocol/brx-protocol.md`.

- **The stack runs whole matches on real hardware.** Mission Control (`mcp/brx_mcp/mc`, `python -m
  brx_mcp.mc`) compiles a per-player `FrameBundle`; each player's phone (`app/`, the Companion HUD)
  drives its own gun over BLE and reports to MC over the LAN. Verified end to end: a 300 s FFA on
  2026-08-30 (two iPhones, MacBook host, 12 kills / 126 hits) and a TDM outdoors on 2026-09-01 (two
  Android HUDs). MC is setup, start and recap only; it is not BLE-connected to guns during play.
- **APK 0.1.7 IS built and published** (`app-v0.1.7`, from `51cc20b`, 2026-09-07 18:46).
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
  built on the phone side; **MC arming at muster (S5, A13.5) is not built.** Hosted games ignore the
  grenade's IR station words (B23), so hosted respawn stations are node-defined.
- **Sound bank:** 2477 on-gun clips off the gun and classified; 148 audited by ear (S9 open).
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
- **The public site is twelve plain-markdown pages** at open-brx.iamrossi.workers.dev. `docs/manual/*.md`
  is ordinary CommonMark (contract: `docs/site/FORMAT.md`), rendered by a 597-line generator and gated
  by 62 browser steps at desktop AND phone width (`cd site && npm test`). Eight pages are the BRX
  manual, four are Open BRX (`/platform`, plus leds, modes, run-a-game). No block syntax, no badges, no
  `src:` lines; confidence lives in the log and FOLLOWUPS. Search is generated per heading and lazy.
  **Cloudflare rebuilds the site on every push** (`wrangler deploy` runs `wrangler.toml`'s `[build]`),
  so the generated pages are git-ignored and there is no stale-output failure mode (B24 closed).
  ⚠ The repo is PRIVATE, so the site publishes no link into it: flip `REPO_PUBLIC` in
  `site/build.mjs` when that changes and every link returns at once.
  `site/lib/led-facts.mjs` reads `SHIELD_COLOUR`, `ARMOUR_COLOUR`, `GUN_DEFAULT` and the drain
  direction out of the live Python and FAILS THE SITE BUILD when a published LED fact disagrees. It
  proves the page matches the code, never that the code is right.

- **Environment:** WSL2 has no Bluetooth; run anything that touches a gun with
  `/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe`. `mcp/pyproject.toml` pins `mcp>=2,<3`; the
  2.0 port is done. `~/.brx-mcp/armory.json` is never in git (headset PINs); stickers stay out of
  docs, use `Tactix-XXXX`.

## What changed since the last handoff (2026-09-07 to 2026-09-09)

- **⭐ The manual website was rebuilt around edit cost, 2026-09-09.** The block DSL is gone: 21 block
  types, 1,524 badge glyphs, ~700 `src:` citations and 54 KB of unused image prompts deleted; 74 pages
  became 9; the generator went 1,009 → 233 lines and the Playwright gate 779 → 146. Three defects the
  complexity was causing are fixed: the markdown twins had been losing their table headers (12 tables,
  and the twins are what `llms.txt` serves), a no-op rebuild dirtied four files with a timestamp, and
  the published sound data was being enriched by scraping manual prose by column name. `07-platform.md`
  went from 528 lines of positioning to a 74-line page; the architecture tables it used to carry moved
  into `docs/architecture-topology.md`, which is internal. Every published `$` command in the developer
  reference survived (checked by set-diff; the 16 that vanished were all in the unpublished backlog).
  ⚠ **NINE guards could not see their own fault**, all one shape: read the artefact, never exercise
  the behaviour. Worst was the gate having ONE viewport, which made half its phone assertions
  unfalsifiable. Two were fixes for earlier ones on the same list. Every guard in `site/` has now
  been broken on purpose and observed failing; see the 2026-09-09 (late) log entry.

- **Repo hygiene, 2026-09-07:** ONE repo (decided on evidence), binaries purged from history — pack
  93 MB → 28 MB and **every SHA changed**, so `git fetch && git reset --hard origin/main`, do NOT pull.
  Backup: `~/brx-backups/open-brx-pre-purge-2026-09-07.bundle`. Detail in `archive/handoff-history.md`.

- **LEDs, the three facts from A16 parts 1+2 that still bite** (full block moved to
  [`archive/handoff-history.md`](archive/handoff-history.md) 2026-09-09, now that A16 is verified):
  **`$HLED,,6` must NEVER be sent in play** — it disables the firmware's death flash for the rest of the
  life, silently, and that cost three days; in-play dark is `$HLED,9,0,,,10,,*` and `$HLOOP` is the down
  signal. **`$TID` is 0-3 only (F35)** — the IR team field is 2 bits, so above 3 teammates damage each other
  and a gun can kill itself off a surface. **Phones are on a pre-`role` APK**, so `headset_frames()` still
  ships the legacy `headset.carrier` key on purpose (S10). `test_led_invariants.py` pins all of it.

## Next actions

1. **Hear A15.3 on a gun** (10 min, one tagger + emitter): ARM, spawn/respawn a few times, take rifle and
   BIG HIT (80) hits. Confirm the scream changes per life, the spawn line varies, short vs long pain match
   the damage, and a kill draws from the 5 takes.
2. **Build and ship an APK carrying A16 + A17** (0.1.7 predates both). Until it ships, none of the LED work
   or the hit audio reaches a player, and the legacy `headset.carrier` key cannot be deleted (S10).
3. **The two LED design questions are DECIDED (2026-09-09): the partial-level blink stays, healing gets no
   opening beat. Recorded in `led-language.md` with the reasoning — do not re-open.**

4. **Bench, gun body only** (`bench-flash-control-2026-09-05.md` §6): a metered A/B of `$HLOOP,2,750`
   against a native out-blink (the "might be brighter" call was one operator, no meter), that rate's usable
   range, a dim 2-of-3 held 60 s, and `$TID,4` purple. Plus **F50**, the A17 pain gate in a real node path.
5. **Build S5** (MC arms utility stations at muster), then the `$WEAP` blind-token plan in
   `docs/bench-weap-tokens-discovery-2026-09-04.md` (sensor damage F23 first).
6. ⚠ **Nothing shield-shaped has EVER been on a gun** (F60): the pool is IR-only (P16) and no compiled mode
   registers a medic word, so the teal bar and A16.5's shield→armour handover are unverifiable as things
   stand. Decide whether a grant row belongs in the compiled `$SIR` table at all.

**The bench queue is [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md)** — every open item in eight
SETUP blocks with the command, reading, control and blocked-on-code per rung, plus the five traps that fake
a result. `FOLLOWUPS.md` §9 stays the register. Pre-flight: `gotchas.md`.

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
| Issues at a live session · Mac-only capture jobs | `field-issues.md` · `capture-runbook.md` |
| Running a match / armory + muster / Mac setup / one-gun bench page | `field-runbook-mc.md` · `field-process.md` · `mac-dev-runbook.md` · `gun-stage.md` |
| Spec of record / protocol truth / confirmed BRX facts | `spec/contracts.md` · `../protocol/brx-protocol.md` · `manual/` |
| History: old handoff banners, closed bench sheets, superseded handoffs | `archive/` |
