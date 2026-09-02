# Followups — consolidated & prioritised

> **📍 For "what is still unknown?" read [`unknowns.md`](unknowns.md)** — one page, every open
> question, grouped by *what unblocks it* (bench / grenade / capture / unwired hardware / parts /
> build work / decisions). This file remains the **detail and method** for each item; the index is
> how you see the whole board without reading six files.

Single source of truth for open work. Supersedes the scattered A–G lists in
`experiment-log.md` (kept there for history). Updated 2026-09-01. Status: ✅ done · 🔴 blocking /
high value · 🟡 useful · ⬜ open · ❎ closed as answered.

## Build (hardware/software the platform needs)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | **BRX Companion accessory** (ESP32-S3 rider: offline engine + powerups + audio + WiFi) | 🔴 spec'd, not built | `hardware/brx-companion-spec.md`. Prototype Tier-0 "Brain" first; validate powerup command sequences ($LIFE/$WEAP re-push/$AMMO) on hardware. Community-proven mount pattern (power-bank + ESP32 on phone bracket, no gun mod). **⚠️ Hardware gotchas from FB (`community-notes.md`):** BRX serial needs a **~5 ms delay per char**, **3.0–3.4 V logic (~3.06 V sweet spot; 5 V corrupts)**, a **diode on ESP32 pin 17 → board RX**; keep tagger-drawn current **<300 mA** (BC-confirmed OK). Design to survive **"SCREAMERS"** (BLE drops / random buzz-fail after ~1 hr, and BC firmware won't re-pair below a battery threshold) — expect reboots, keep batteries topped, don't assume a session-long BLE link. |
| B2 | **Native phone app** to replace Callsign | 🟢 **BUILT** | Native Capacitor app (Android + iOS), the per-player game engine + HUD, reporting to Mission Control over the LAN. Web Bluetooth is dead — see `docs/adr/0003-native-app-over-web-bluetooth.md` + `app/README.md`. Field path (MC↔phone) VERIFIED for the live path (2026-08-25/26 real phone→MC→gun sessions); soak/scale still unverified on hardware (verification-checklist). |
| B3 | **Mission Control** (scan → assign games/teams/weapons → live scoreboard) | 🟢 **BUILT + TESTED** | `docs/spec/mission-control.md`. Operator console built + tested **with operator auth**; compiles per-player `FrameBundle`s (`mcp/brx_mcp/mc/compile.py`) and drives the live game over the LAN (WebSocket). MC↔phone field path VERIFIED for the live path (2026-08-25/26 real phone→MC→gun sessions); soak/scale still unverified on hardware (verification-checklist). |
| B4 | **BRX Utility Box** (open, MC-programmable objective node) | 🟢 **UNBLOCKED 2026-08-26 — emit PROVEN on hardware**: a stock tagger accepted a fully synthetic word from our ESP32+LED rig (`$HIR,4,0,42,2,33` = our invented player/team/damage), armor model applied correctly. Build is now a packaging exercise, not a research one. | `hardware/brx-station-spec.md` — one ESP32+IR box → Hill/Assault/CTF/Respawn/Domination/**Extraction**/**Bomb**/perk emitter, driven live by Mission Control. The open answer to the sealed grenade (G7/G8). ~~Gating build task → B13~~ — **B13 is closed and emit is hardware-proven**; the build is now a packaging exercise. Sounds are `$SIR`-mapped (ours to assign), not cloned from the grenade. QR codes stay the ~$0 alt for simple pickups. |
| B13 | **Capture the BRX IR bit-layout** (for the Utility Box emit side) | ✅ **CLOSED — BENCH-VERIFIED 2026-08-26** (timings, 25 bits, field offsets, parity rule; B=IR-protocol not bullet-type; `payload_parity()` added). Emit side (Session 2) is next. | **Answered from LaserTagMods `NRFL-Bases/Nodes/node1.ino`** — full layout in `protocol/brx-ir-protocol.md`: ~25-bit word after a **2 ms sync**, pulse-width bits (**~1000 µs=1 / ~500 µs=0**, split 750 µs), fields **B4 bullet · P6 player-id · T2 team · D8 damage · C1 crit · U2 · Z parity** (accept if `Z1≠Z0 && Z2<250`). IR-RX prototyping (VS1838B, arriving 2026-08-26) now has a target to confirm. ~~Verify pulse timings/thresholds before trusting the emit side.~~ **Done** — measured sync 1988–1991 µs, marks 990/500, and a stock gun accepted our synthetic word. Field names updated: **B = IR protocol / DamageType**, **U = `$SIR` subtype** (the old "B4 bullet … U2" labels are retracted). |
| B5 | Fix `server.py` for **mcp 2.0** | ✅ **DONE** (commit `2c963b1`) | Ported to the 2.0 API — `mcp.server.mcpserver.MCPServer` replaces the removed `mcp.server.fastmcp.FastMCP`. Verified 2026-08-26 on the Windows venv (`mcp` 2.0.0): `import brx_mcp.server` OK and the `mcp__brx__*` tools are live in-session. No pin needed. |
| B9 | **Definitive BRX manual website** (high-polish public site) | 🟡 strategic | Aggregate everything on tagger + headset into *the* authoritative, beautifully-designed public reference (searchable sound bank, pairing/repairs/mods/protocol). Community magnet + SEO funnel to the platform/hardware. Prototype the design + sound-bank explorer as an Artifact first. Restate-with-credit, link official PDFs. See `VISION.md`. |
| B8 | **Grenade STATE app** (phone/web, $0) | 🟡 reframed (exp-log #35/#36) | **Config-over-BLE is DEAD** — objective modes are button-set + locked on the grenade (G8 negative); the app can't replace the on-grenade setup. **Real value = a live STATE DISPLAY:** read the grenade's beacons over BLE (`$HIR` token2=15) → show **Hill** possession + **Respawn** availability live (those two beacon; Assault/CTF/Frag don't). Pair with a printed setup cheat-sheet for the manual button config. Optional: thrown-blast config via `$GREN` if paired (G10). |
| B7 | **Serial-console backend** (pyserial) for `brx-mcp` | 🟢 **QUERY built + verified 2026-08-24** | `brx_mcp/usbconsole.py` + CLI `usb-query [port]`. Reads the full device record over the Teensy USB CDC (VID 16C0): **Serial/Head PIN (= the paired headset's sticker id), Headset Version + Head voltage, Gun voltage, PlayerID, nRF flags, Grenade Pin, PCB rev, BT versions**. Live-confirmed on COM5 (`headset_linked=true`, head 4.0 V). Raw dump backed up to `~/.brx-mcp/device-backups/<serial>.txt` (**out of repo — contains the headset PIN**). **Still open:** `SETUP` (write — set tagger ID / re-pair headset; feeds **P2** per-player identity) — deliberately NOT built yet (factory-provisioning writes; gate behind explicit confirm). |
| B10 | **Synchronized multi-gun start** | 🟢 **HW-PROVEN 3-gun (2026-08-25)** | G-2 (exp-log #33): sequential per-gun config = starts **~10 s apart**. **Fix HARDWARE-PROVEN in `arm_test.py`:** connect ALL → config each → **hold until all live+configured simultaneously** → `$SPAWN` burst to all → armed all 3 **first-try, zero retries, repeatably**. Overturns the old "direct-BLE multi-gun unreliable/pilot-only" call (that was a **dead headset**, not the radio — see B18b). Bake the **config-all-then-spawn barrier + reconnect-until-all-live** into the engine/driver (M0.2, `docs/spec/`); retire per-gun config-then-spawn. |
| B12 | **Host-respawn vs grenade-respawn conflict** | 🟡 NEW | The grenade respawn-station disables a gun's self-respawn and provides its own (grenade button → team in-area, or headset-front + trigger); our engine does host-driven `$SPAWN` respawn. **Two competing authorities** — a mode using grenade respawn stations must NOT also host-respawn those players (or must reconcile). Decide per-mode which owns respawn; document in the engine. (exp-log #37) **Respawn-station arming is a per-game step ("Station Arming", `field-process.md` §Muster):** each tagger must **receive the station IR** to switch from self-respawn to station-respawn — an unarmed tagger just self-respawns. **Timing RECONCILED (Jay's video, 2026-08-25):** two arming paths, both valid — **pre-game passive arming** (expose each tagger to station IR before start → it respawns at the station, not automatically) **and** a **post-start grenade-button press** (works even if the game started before the grenade was set to respawn — pressing the button forces each gun in range into respawn-station mode mid-match; explains exp-log #37's "signal after start"). The button press is the reliable per-gun force/re-arm. Still to confirm on HW (→ verification-checklist): (a) a button-armed gun **stays** station-respawn all match; (b) whether the passive beacon alone (no button) also arms. Engine: pick one respawn authority per mode; if using grenade stations, don't also host-`$SPAWN` those players. |
| B15 | **FakeTagger fidelity roadmap** (deferred sim gaps) | 🟡 sim built | `brx_mcp/fake.py` runs the full `run_live` path in CI (scoring, respawn, frag-limit, teardown revive, mid-game drop). **Not modeled (each hides a bug class):** weapon-specific damage/ammo, crit modifier, `$GSET` FF→scoring closed-loop, `$VERSION`/`$VOLTS` handshake timing (30 s cadence, `$PHONE` gate) + a fake `diagnose`/`fleet`, native multikill audio, physical LED/headset/audio state, MTU-20 chunking + 5 ms/char serial timing, grenade/objective `$HIR` token2==15 beacons (so cs/domination/ctf/extraction aren't integration-tested yet). Add per-value as those paths are hardened; keep the sim honest (a green test ≠ "works on real guns" — that's earned on the bench). |
| B17 | **Tutorial mode** (guided onboarding, in-range of MC) | 🟡 NEW | A short scripted "training" game that teaches players the controls + what the sounds mean, run while in BLE range of Mission Control (direct-BLE, host-driven). Host walks each player through a sequence and confirms each step from the event stream: pull the trigger (→ hear fire), **reload** (lever or the B16 alt-button; watch `$BUT`/`$ALCD` ammo refill), get tagged (→ hear the hit/pain/death sounds; `$HP` drops), **respawn** (host `$SPAWN`; hear the respawn cue), team LED colour, low-ammo/empty chirp. Each step: `$PLAY` a spoken/cue prompt → wait for the expected event → confirm → next. A `TutorialEngine` (host prompts + event-gated progression) reusing the driver; great first-run experience + a live demo of the sound catalog. No screen, so it's all audio-guided. Sim-testable (scripted events). |
| B18 | **MC Scorekeeper feedback engine** (reconstruct native feedback over BLE) | 🟢 **announcer BUILT + tested** · **mechanism CAPTURED (cap8, §7o)** — wiring `$SFLASH` + confirmed ids open | **The landmark unlock, now upgraded twice.** MC is the **scorekeeper that drives feedback itself**: subscribe to every gun's `$HIR`/`$HP,0`, attribute the kill (team-granular over BLE; per-player needs P2), track streaks + the **4 s double-kill window** (`game-medals-config.json`), and play the right line back to the **shooter**. Host-stamp arrival time — **each gun uses its own boot-local clock**, don't trust `$t_ms`. **⚠ SUPERSEDED:** the earlier *"green-sight is nRF-only, not BLE-drivable, audio compensates"* call is **WRONG** — it probed `$GLED` (team-derived, §7i), the wrong command. `cap8` caught the official app doing it over plain BLE: **`$SFLASH,*` = the shooter's green-sight kill-confirm flash** (exactly one per kill, ~0.4 s after the burst) and **`$PLAY,,4,6,<id>,,,,*` = the announcer slot** (`$PLAY` has a second sound slot at **token 4**; `V3A` = **"kill"**, **confirmed**; `VB17` = score/lead line, sent only when the lead changes). Game end uses both slots: `$PLAY,VSF,4,6,JAY,,,,*`. The app's per-kill burst is `$SFLASH` → kill line → (lead-change) score line. **DONE (2026-08-25):** `brx_mcp/modes/announcer.py` `KillAnnouncer` — first-blood, multikill chain (4 s window), per-life streaks (5/10), all scoped to the shooter's gun; wired into `DeathmatchEngine` (fires in **FFA / unique-team** where a specific killer resolves), snapshot-visible, 10 tests. **WIRED (2026-08-25):** `KillConfirm` action → **`$SFLASH,*`** on every credited kill (the visual, now ours), the **confirmed** `V3A` kill line, and `PlaySound(slot="voice")` → the **token-4** `$PLAY` form for every announcer line (effects keep slot 1). Wire-level tests pin the exact frames. **OPEN:** confirm the remaining **medal/streak** ids (bench `$PLAY` probe or the 2166 bank — `Callout`-only until set); add the **score/lead line** (`VB17`-style, on lead change) which no engine emits yet; adopt the helper in cs/lms/survival/objectives; ~~verify `$SFLASH` on hardware from *our* stack~~ ✅ **DONE 2026-08-26: bare `$SFLASH,*` greens the sight unconditionally, latches several seconds** (exp-log); per-player announces in **shared-team** modes need P2 — **the only stock-feel gap left over pure BLE**. |
| B18b | **Headset-present pre-game GATE in Mission Control** | 🔴 blocking — **but there is now a FREE VISUAL CHECK**: a headset **slow-blinks RAINBOW when disconnected** (Tony, 2026-08-27), so an operator can spot a non-joining gun across the room during muster, before any software gate exists. Add to `field-process.md` §Muster. | A gun with its **headset OFF silently refuses to join** a game (§7m, confirmed live — it was the real cause of every "only 2 of 3 in-game"). A dark headset = a player standing dead all round. **MC muster MUST verify each headset before allowing start.** Detectors: (a) **cabled** — `QUERY` → `Headset Version:` present & ≠ `?` (already parsed in `usbconsole.py`); (b) **BLE/field** — send spawn, require the `$LCD,45,70,…` echo within ~500 ms; **silence = not ready** (headset off/asleep) — a headset-less gun is 100% BLE-silent. Add to the readiness board next to battery; block/flag start on any unready gun. Ties to B3 + `field-process.md` §Muster. |
| B16 | **Kid-mode alt-button reload** (`GameConfig`, per-tagger) | 🟡 NEW | Young kids can't work the reload lever — option to remap the **orange ALT button → reload** (via `$BMAP`). Per-tagger pre-game toggle; allowed on any mode that doesn't need alt-fire; optionally **disable secondary fire** for kids (they won't use it). Clean config→frames feature (the `$BMAP` table is already in GAME_CONFIG). Find the orange-button `$BMAP` index + the reload action code from the app capture / `protocol-classes.md`, add `alt_reload`/`disable_secondary` to GameConfig, emit the remapped `$BMAP`, sim-test the frames. Ties to kid_mode. |
| B14 | **Voice-pack selection in `GameConfig`** (`voice=`) | 🟡 NEW | The official Callsign app lets you **pick a voice** (announcer character); we don't — our `$PSET` voice-pack tail is hardcoded to **Heavy** (`V33/V3I/V3C/V3G/V3E/V37` in `gameconfig.py:_PSET_TAIL`). Add a `voice` field that swaps the 6 voice-event ids (deathAlarm/pain/hitHP/armor/shield/crit + respawn line) to another character. **Data need (P3):** the per-character voice-event id set — sound-bank.md has the prefixes (V0 Fury, V2 Guardian, V3 Heavy, V8 Medic, V9 Raider, VA male…) and examples (Heavy V3I "Get Some", Medic V8W "one shot one kill", V85/83/84 death) but not the full per-event map. Extract the app's voice profiles from the APK, or capture by ear. Fits Tony's "customize everything" requirement. |
| B22 | **APK pipeline: the leftovers a review team flagged and we chose not to fix** | 🟢 low, none blocking (2026-09-01) | Recorded so they are not lost with the session. (a) **minSdk/targetSdk can drift silently**: `app/README.md` and `/platform/app` state 24 / 36, but both live in the generated, git-ignored `android/variables.gradle`, so a Capacitor bump changes them with nothing checking the docs. Fix when convenient: have `android-apk.sh` record them in `build.json` and have site step 9 assert the page matches (do it in the same change, or it is another field with no consumer). (b) **`site/build.mjs` link check does not decode percent-encoding** on `/download/` hrefs; harmless while filenames are restricted to `[A-Za-z0-9._-]`. (c) **The section stamp** `docs/manual/07-platform.md` "Last verified: 2026-08-27" is section-wide and renders above a newer build date on this page; it also drives `sitemap.xml` lastmod. (d) **iOS has no distribution path at all** (folded into B21): an iPhone player still builds from source with a free Apple ID and a 7-day expiry. **What is already handled and needs no work:** dirty-tree publishing (the site build refuses it), a hand-written or orphaned `build.json`, two APKs, an illegal filename, a missing sidecar, and writes into `webapp/download/` (the generator now throws). All are pinned by site step 9c. |
| B21 | **Release-sign + distribute the Android app** | 🟡 NEW (2026-08-30) | The site now hands out the app at `/platform/app` (`webapp/download/*.apk`, built by `npm run android:apk`), but it is a **debug-signed** build: it is signed with Android's throwaway debug key, so the first release-signed build will **not** upgrade over it (every tester has to uninstall first). The debug build is also **`android:debuggable="true"`** (verified in the shipped manifest), so anything with USB debugging can attach to it and read its data; `assembleRelease` clears that too. Before anyone outside the bench installs it: create a release keystore (kept OUT of the repo, password in a git-ignored `android/keystore.properties`), switch the script to `assembleRelease`, and bump `app/package.json` per build (`android-setup.sh` stamps `versionName`/`versionCode` from it). iOS has no sideload path at all, so an iPhone player still builds from source (free Apple ID = 7-day build) until TestFlight. |
| B11 | **Custom connect/disconnect voice** ("Open BRX connected/disconnected") | 🟡 NEW | Branding polish: **back up + replace** the tagger's "phone connected" / "phone disconnected" audio with "Open BRX connected" / "Open BRX disconnected" via the USB `AUDIO`-folder sound swap (`<ID>.LTP`, `reference/brx-extended-user-guide.md`). First find the sound IDs (probe `$PLAY,<id>` around the connect voice, or diff the bank), archive originals, drop in the new clips. Nice first sound-swap demo. |

### ⭐ B19 — MC config VERIFICATION via `$QUERY` (new 2026-08-27, high value / low effort)

**`$QUERY,*` reads the gun's configured state back over BLE** — player id, team, HP, armor, shield,
voice, and **every weapon slot's damage + fire sound** (bench-validated one field at a time, see the
experiment log). `$LCD` returns the *live* pools alongside it. **This turns MC's status from asserted
into observed.**

What it unlocks, roughly in order of value:

1. **Verify the head landed.** We push ~20 frames and *assume* success. A gun that power-cycles silently
   loses its config, and today the only tell is a `$SPAWN` echoing `$LCD,0,0,0,0,0,0`. **Read back after
   arming and diff against what we compiled** — a mismatch means re-push, before the match starts
   rather than during it.
2. **Real muster readiness.** The armory/roster screen can show each gun's **actual** loadout, pools and
   team instead of what we intended. Pairs with the headset **rainbow = disconnected** check (B18b) for
   a muster that is genuinely verified rather than hopeful.
3. **Catch drift.** Callsign wiping `$NAME`, a stale head from a previous game, a gun someone
   power-cycled mid-setup — all become visible.
4. **Debugging aid.** "Did that frame take?" stops being a guess for every future protocol probe.

**Implementation notes / gotchas:**
- **Replies arrive SECONDS late.** Query repeatedly until the answer stops changing; never read the
  first frame back. (This is what first made it look like `$WEAP,*` was the read-back.)
- The read surface is **`$QUERY` + `$VERSION` only** — `$SIR`, `$BMAP`, `$GSET`, `$PSET`, `$TID`, `$LCD`,
  `$HP` bare reads are all **silent**. So the `$SIR` table and button map **cannot** be verified this
  way; the check covers identity, pools, voice and the arsenal.
- Fields are the *configured* values; `$LCD` is the *current* state. Both are useful and they differ.

**Untested and worth 2 minutes at the bench:** `$QUERY,*` against a gun in a **native** game — it should
report that character's HP/armor/shield and weapon damage, which would give us Supremacy character
stats straight off the hardware (part of what P8 is for, with no proxy or Mac).

## Hardware / 3D printing (no public BRX print library exists — `hardware/print-files.md`)

Major repos (Printables/Thingiverse/STLFinder/Cults) have **zero** BRX-specific models; community
files are shared privately. Our MIT `hardware/` can become the canonical open library. Concrete asks:

| # | Item | Status | Notes |
|---|---|---|---|
| H1 | **Reload-handle → push-button mod** STL | 🟡 highest demand | Clean-room design; **version-tag it** (older vs newer BRX handles differ — a known wrong-print trap). Community pays ~$35–50 for a 5-pack. Tutorial: youtube JUP5ixjEZHw. |
| H2 | **D-pad replacement buttons** STL | 🟡 requested, unpublished | Button plastic cracks from wear; nobody has published one — good first contribution. |
| H3 | **BRX Companion mount + ported audio enclosure** | ⬜ with B1 | Clips to rail/phone bracket, no gun mod; ported box for the speaker (`brx-companion-spec.md`). |
| H4 | **Objective-station / effect-node enclosures** | ⬜ with B4 | Houses TSSP38 IR receiver + LED ring. |
| H5 | Decorative **skins / covers** | ⬜ nice-to-have | Community interest (e.g. sniper body); currently only private SwapTX work. |
| H6 | **Custom on-tagger sound packs** (data port) | 🟡 confirmed possible | Sounds swap over the micro-USB port — hold SELECT while powering on to expose storage (`community-notes.md`). Build a tool/guide + curate an MIT arena sound pack. Keep originals. |

## Research / capture

| # | Item | Status | Notes |
|---|---|---|---|
| R1 | **Callsign HTTPS API capture** (MITM proxy) | 🟡 gun-off | =P8. Proxy + cert on the phone → `/api/v1/callsign/settings`, `voice-profiles`, `arenas/games` give weapon stats, the `$PSET` voice-pack, game defs. Highest data yield; no gun. |
| R2 | **Re-scrape the FB group WITH comments expanded** | 🟡 | The 2026-08-24 crawl expanded post "See more" but NOT "View more comments" — comment threads (where much Q&A lives, e.g. the sound-swap process) were missed. Re-run clicking "view/more comments" + reply expanders. |

**Blocker for all:** needs **caliper measurements** from Tony (reload-handle socket, D-pad button,
rail dimensions) before CAD. Publish as version-tagged STL + source (OpenSCAD/STEP), MIT.

## ⭐ Tony's asks 2026-08-26 (night) — perks / alt-fire / headset-explosion

| # | Item | Status | The mechanism (found, needs a trigger-pull to verify) |
|---|---|---|---|
| **K1** | **Auto-reload for kids who can't work the lever** | 🟢 **ALREADY SHIPS — plus a second untested mechanism** | ⚠️ My earlier "t19=5" answer was incomplete. **The feature already exists**: `GameConfig`'s **`alt_reload` flag remaps `$BMAP,1,97`** so the orange ALT button reloads (`gameconfig.py:108/188`) — kid-mode is a per-tagger toggle we already build. **Separately**, the APK's `ReloadType` enum ends in **`AutoReload` (ordinal 5)** and `$WEAP` **t19 = reloadType** — that would be *fully automatic* reloading rather than a button. **Bench: push `$WEAP` t19=5 and pull the trigger on an EMPTY chamber.** ⚠️ Half of this is already answered (2026-08-27, controls both ends): t19=5 does **not** self-reload on an empty or near-empty magazine. Only the *fire-triggered* case remains. Two different kid-modes; test which Tony actually wants. |
| **K2** | **Equip a secondary weapon / perk to the ALT-FIRE button** | 🟡 **mechanism corrected — NOT the t7–t11 block** | ⚠️ My earlier claim that `$WEAP` t7–t11 is the alt-fire mechanism is **refuted by the captures**: t7–t13 are empty in **every** captured frame *and* in ours, and Callsign's alt-fire works anyway. The real path: **the alt button cycles weapon slots** via `$BMAP,1,100,0,1,99,99` (slots 0↔1), which we already push — so "secondary weapon on ALT" is a **slot-loading** question (put the perk/weapon in slot 1), not a token-filling one. `$BUT`'s `ButtonCode` enum (`Trigger, AltFire, Analog`) still gives a host-side path for arbitrary perks. P1's "t7–t11 dormant" call **stands** — I was wrong to reopen it. |
| ~~K3~~ | **Death-explosion** | ✅ **CLOSED 2026-08-27 — CAPTURED**: `proto=10 (StandardLethalExplosive), MAG=125, player/team = the DYING player`. Out-damages the Rocket Launcher (115) and **credits kills to the corpse**. Replayable from any emitter. See the experiment log. Original note: | Tony (hardware fact): a Supremacy robot's death **emits IR from the HEADSET**, damaging like a grenade. That means **the headset is an IR emitter we don't control yet** — and `$WEAP`'s field map has **`extraHeadsetDamage`, `extraHeadsetRangeOutdoor`, `extraHeadsetRangeIndoor`, `headsetDirection`, `headsetRepeat`** (tokens 12–13, 39–40, 43), plus **`PowerType/IRSource` enum members `HeadSetOnly`, `GunAndHead`, `DoubleGunAndHead`**. So headset emission is a **`$WEAP` `primaryPowerType` (t4) setting**, not a hidden command. ⇒ **Suicide-bomber / death-nova is buildable**: set powerType to a HeadSet variant + `extraHeadsetDamage`. Verify on hardware. |
| **K4** | **MELEE does not work in our compiled game** (native mode does) | 🔴 NEW — **NOT a config bug** | Tony had to reboot into a native on-gun game to melee (2026-08-26). But two independent capture reviews found **our melee surface is byte-identical to Callsign's**: `$WEAP,4` character-for-character (`…,4,1,90,13,1,90,…M92…` — proto 13, sub 1, magnitude 90, matching the native swing we captured), all three `$SIR,13,*` rows, `$GSET` with `gyroscope=1`, and all seven `$BMAP` rows including **`$BMAP,8,4`** (button 8 = gyro → melee). Callsign sends only `$GLED` and `$PLAY` beyond what we send; neither gates a swing. ⇒ **runtime/state/trial issue, not a frame.** **Bench (one swing):** in *our* compiled game, **select slot 4 and swing hard**, watching the victim for `$HIR,…,13,…` and the shooter for **`$BUT,8`**. `$BUT,8` + no IR ⇒ slot-4 firing. No `$BUT,8` ⇒ the gyro mapping isn't live despite being sent (check whether `$SPAWN` wipes `$BMAP`, since spawn only re-sends `$BMAP,0,0`). |
| **K5** | **Slot 2 = weapon OR perk; loadout policy; phone self-serve picks** | 🟢 **SERVER BUILT 2026-08-27** (`docs/spec/loadout.md`, contracts A10) | v1 perks are the PASSIVE ones (Body Armor → `$PSET` armor; Extended Mags → `$AMMO,0` + t16/t39/t17/t40; Quick Hands → t18; **Easy Reload = K1's `alt_reload`, now per-player**). **Med Kit / Concussion stay `hidden` in `perks.json`** until the emit-side bench: their effect lives in the VICTIM's `$SIR` table (a shared constant, game-wide), so a per-player heal-gun needs the table to become policy-derived first. **Empty slot 1 is now legal** (Tony: "alt-fire just does nothing") — the compiler no longer writes a silent default shotgun; bench item: one ALT press with slot 1 empty should reload, not chirp (`brx-protocol.md:48` says reload). The `tutorial` path is unchanged (a try-out is the raw weapon, no perk knobs). |
| **K6** | **Per-game WEAPON TUNING (damage / fire-sound / rate overrides inside a saved game)** | ⬜ deferred — own spec | Tony's "silenced sniper" wants a fire-sound override. `SavedGame.weapon_tuning` is RESERVED in `docs/spec/loadout.md` §8 (always absent today) so it slots in without a schema change; the builtin "Silenced Sniper" preset ships with the stock sound and says so in its desc. Needs: which `$WEAP` tokens per weapon are host-tunable (t5 dmg, t14 fire interval, t27–t29 sounds — `compile._NAMED`), a per-preset override shape, and the bench for sound ids. |


## 🟢 R2 — add a software POWER control to the IR emitter (small, unblocks two tests)
*(renamed from R1 on 2026-08-29: `R1` was already the Callsign HTTPS API capture, also tracked as P8.)*

`hardware/esp32-ir-bridge/ir_emit.ino` fixes `CARRIER_DUTY = 128` (~50%) as a **compile-time
constant**, and the serial interface accepts only `TX` / `TXN` / `AUTO`. So effective range and signal
strength can only be changed by physically moving the rig.

**Add a `DUTY <0-255>` serial command** (and optionally `PULSES <n>`). One line of parsing next to the
existing handlers, writing `ledcWrite(IR_TX_PIN, duty)`.

**Why it is worth doing:**
- **It makes the sensor question answerable unattended.** `$HIR` token 1 (front dome / back dome / gun
  body) appears to be driven by signal conditions — the spec notes point-blank floods mis-attribute —
  and this rig currently lands **100% gun-body** hits. Varying duty simulates distance and may let the
  dome register without anyone re-aiming anything. That question currently blocks explaining two
  non-reproduced results.
- **It makes range tests repeatable.** Range work presently means physically moving a breadboard, which
  is neither precise nor reproducible between sessions.

**Not done here deliberately, and the sharper reason is not the flash risk** (brx-opus2): **a bad
`DUTY` cannot be verified from here.** If the command misbehaves — wrong duty, bad parse, carrier off —
the symptom is *fewer or no registrations*, which is **indistinguishable from "the effect under test
isn't there."** That would inject an unverifiable confound into the very instrument being used to
resolve confounds. That argument holds even if reflashing were zero-risk. (The secondary reason still
stands: a failed flash takes the bench down with nobody able to recover it.)

**Two things to build in when it is done, so it does not become a fourth unstated condition:**
1. **Make the rig report its own duty** — echo it on `TX`, or add a `DUTY?` query — so every capture
   records the value beside protocol / sensor / range instead of relying on memory. The method rule,
   applied to the instrument itself.
2. **Re-run the fn 1 control at every duty before trusting anything else at that duty.** Changing duty
   changes effective range, and range is a known-live variable — so the control is not optional there,
   it is what proves the rig is still faithful at the new setting.

## 🟢 B20 — is `$LCD` token 3 the shield? (one-line bench check)

`$LCD` tokens 3 and 4 are **undocumented** (`docs/manual/06-developer.md`, and `protocol/brx-protocol.md`
says "semantics TBD"). They read **0** in every frame we have ever captured, which is consistent with
"not the shield" and equally consistent with "the shield was always 0 when we looked".

This matters because `app/src/engine.js` deliberately does **not** read shield from `$LCD` (a version
that did was reverted for recreating Q12). Until this is settled, the HUD can only learn the shield
from `$HP`, so a client that joins mid-life and gets an `$LCD` snapshot cannot know the shield.

**Check:** grant a shield (fn 11 from a friendly team), confirm `$HP` shows it, then trigger an `$LCD`
(`$SPAWN` or a `$LCD,*` query) and read token 3.
- token 3 == the shield ⇒ re-add the read in `engine.js` **with a test**, and document the token.
- token 3 == 0 with a live shield ⇒ record it as confirmed-not-shield and the current code is right.

## 🟠 Q16 — measure the IR beam DIVERGENCE, to decide between a snoot and an attenuator (2026-08-30)

**Why this exists.** Tony asked whether something on the nozzle could stop indoor bounce. The answer
depends on a number nobody has measured: **how much light leaves the muzzle off-axis.**

**What we know about the emitter** (published spec, `manual/01-hardware.md`): Class 1 laser
(IEC 60825-1), **980 nm**, **16.9 mW** on one unit's factory record, **beam under 18 mm at the
aperture**, ~600 ft range, 38 kHz carrier. That is a **collimated** emitter with a lens, not a bare
wide-angle LED, which is why the answer is not obvious.

**The two failure modes need opposite fixes:**

| bounce mode | what happens | the fix |
|---|---|---|
| **off-axis splash** | light leaves the muzzle at a wide angle, hits a side wall | a **snoot** (a tube) helps |
| **on-axis return** | the beam goes where aimed, hits that wall, scatters back | **only less power** helps; a snoot does nothing |

We have already seen the second one: a gun **drained its own armour** firing at a wall a few feet away
(`gotchas.md`). A collimated laser should produce little of the first. **So the prior is that a snoot
is useless here** and the real fix is power. But that is an inference from the spec sheet, not a
measurement, and it is cheap to settle.

### The measurement (~10 min, receiver only, no victim gun)

Fix the receiver at a set distance (say 3 m) on a taped mark. Fire from **on-axis (0 deg)**, then step
the *gun* off-axis in ~10 deg increments (10, 20, 30, 40, 50) while keeping the distance constant, and
count detections per 10 shots at each angle. Return to 0 deg as a **closing control**.

- **Sharp fall-off by 10 to 20 deg** ⇒ tight beam, off-axis splash is not the problem, **a snoot is
  pointless.** Fix the power instead (t41, then an aperture attenuator).
- **Detections still landing at 30 to 50 deg** ⇒ a real off-axis skirt, and **a snoot is worth
  building.**

⚠️ Do it in the room that actually misbehaves, or in a corridor with the far wall covered. In a small
room the receiver may catch the wall bounce rather than the direct beam, which is the very thing under
test. If in doubt, run it twice: once facing a soft/absorbing background, once facing the bare wall,
and compare.

### If a snoot does turn out to be worth building

- **Most black plastic is IR-TRANSPARENT at 980 nm.** A 3D-printed black snoot or a black cap can block
  visible light and pass IR almost unchanged. **Test the material by firing through it at the receiver
  before trusting it.** This is the trap that will waste an afternoon.
- The inside must be non-reflective or the tube becomes a light pipe. Flocking, matte black paint or
  felt, not bare aluminium.
- **The headset emits too** (front IR emitter, for melee swings and respawn-station requests), so a
  muzzle attachment does not cover the whole system.

### Ranking, until this is measured

1. **`$WEAP` t41 = `gunRangeIndoor`** (Q15) - free, per-game, reversible, no hardware.
2. **Aperture attenuator** - a couple of layers of matte tape or ND film over the emitter window.
   Trivially reversible, and it is the hardware equivalent of lowering t41.
3. **Snoot** - only if this measurement shows a real off-axis skirt.

## 🔴 Q15 — SUB-INDOOR IR POWER: native indoor is still too strong for tight spaces (2026-08-30)

**Tony's own words:** *"native indoor is way too powerful. the ir hits after bouncing way too easily.
would be awesome if we found a customization to go lower."* This is a real venue problem, not a
curiosity: a bounce off a wall lands on a headset and registers a hit nobody fired. We have already
watched a gun **drain its own armour** shooting a wall a few feet away.

The native indoor/outdoor toggle is the only power control BRX exposes to players, and indoor is its
floor. We want **below** that.

### ⚠️ First, the answer to "is there a width, or only power?": **only power.**

There is **no width, spread, cone or angle field anywhere** in the APK dump (searched
width/spread/cone/angle/arc across `callsign-extract/`). Beam geometry is fixed by the physical optics,
the emitter LED and its lens. Every control BRX exposes is **power/range**, so a narrower beam is not
available in software. If bounce is the problem, the only software answer is less power.

### The four range fields (this is more structured than it first looked)

The APK field order gives the gun **four** range values, not one: `gunRangeOutdoor`,
**`gunRangeIndoor`**, `extraHeadsetRangeOutdoor` and `extraHeadsetRangeIndoor`. `$GSET` token 2
(`outdoorMode`) is described in the metadata as the *"indoor(0)/outdoor(1) IR range profile"*, i.e. it
**selects which pair is live** rather than scaling anything itself.

### Lever 1 (best): `$WEAP` token 41 = `gunRangeIndoor`

**t41 is literally `gunRangeIndoor`** — the APK field order places it between `ammoReserv` (t40) and
`extraHeadsetRangeIndoor` (t42). It is a percent, reading **75 on all eighteen guns** and **20 on
melee** (`weapon-design.md` §4.2). So it is not a generic "range" number: it is specifically the
**indoor** value, which is exactly the case we want to lower, and lowering it leaves outdoor alone.

**That melee value is the argument.** Melee is a contact weapon, and Battle Company set its range field
to 20 while every gun sits at 75. An inert cosmetic number would not track physical reality in exactly
the direction physics demands. It is decent evidence the field really drives emitted range.

Battle Company never varies it across the arsenal, which is likely why nobody has tried. **We can:
push `$WEAP` with t41 at 30, 20, 10 and measure.** Per-weapon, writable over BLE, already in our
config path. If it works it is a per-game, per-weapon power dial, which is better than any toggle.

### Dead end, already tested: `$IRTX` / `$HFIRE`

The APK lists an **`$IRTX`** command with an explicit **`iRPower`** field ("raw IR transmit"), and
`$HFIRE` with `Range, CountIRPulses, RateOfFire, FlashLED`. Both look ideal. **Both produced ZERO IR**
on our firmware: 5 `$IRTX` shapes and 5 `$HFIRE` shapes, with receiver controls passing
(`experiment-log.md` 2026-08-26). Treat them as unimplemented on v4.32 unless someone finds the right
argument shape.

### Lever 2: `$GSET` token 3, `gunLaserRegion`

APK-decoded as **USA / International = IR legal power**. International limits are generally the lower
of the two, so flipping it is plausibly a power cut. **Coarse** (two regulatory levels, not a dial) and
**untested**. Worth one probe, but t41 is the better bet.

### How to test, and what it needs

This is bench item **2.1 / U2**, already queued: receiver on a tripod at a taped mark, no victim gun
needed. Sweep t41 (75 as the opening control, then 30, 20, 10, then **75 again as a closing control**)
and count detections at fixed distance. **Needs an operator only for the trigger pulls.**

⚠️ A null result is a real answer here too, and it must be reported as one: if detection at a fixed
distance does not move across the sweep, t41 is not a range control and lever 2 becomes the only
candidate.

**If lever 1 works, it belongs in `GameConfig` as an indoor/tight-space preset**, alongside the existing
kid-mode toggles. That is the shippable outcome.

## ✅ Q17 — FIXED 2026-08-30. (was: kill attribution used shooter TEAM, so it broke whenever a team had 2+ guns)

**Root-caused 2026-08-30. Not a bug: an unfinished migration.** Two earlier framings of this item were
wrong and are superseded — it is neither a general attribution failure nor a player-id collision.

**Symptom.** Two live games, same shooter, same weapon, same mode:

| | teams | result |
|---|---|---|
| 3 guns, TDM 2v1 | team 1 has **two** guns | **every gun `kills: 0`**, team score correct |
| 2 guns, TDM 1v1 | each team has **one** gun | **5/5 kills credited correctly** |

**Cause, documented in the code itself** (`mcp/brx_mcp/modes/base.py:14`):

> *"Kill attribution: a victim's gun reports `$HIR` (**shooter TEAM in token 4**)... Per-player credit
> works when each gun has a **unique team** (`$TID`) - FFA - or once P2 sets a real PlayerID."*

The engine credits kills by **shooter team**. That is unambiguous only when one gun owns a team, i.e.
FFA or 1v1. Put two guns on team 1 and the victim's `$HIR` says "team 1 shot me", which cannot pick
between them, so nobody is credited. Team scoring is unaffected because it comes from **deaths**, which
the victim reports about itself.

**The fix is already half-built.** The precondition that comment waits for has been met:

- `mcp/brx_mcp/protocol.py:92` already parses **`shooter_player_id` = `$HIR` token 3**.
- `mcp/brx_mcp/modes/driver.py:113-120` already **assigns a distinct id per gun** (auto-numbered 0,1,2,
  overridable via `config.player_ids`) and pushes it as `$PSET` token 1, with a comment noting distinct
  ids are "what make per-player attribution possible at all". The assignment is computed once so a
  mid-game resetup re-sends the same id and does not orphan a player's kills.

**So the driver did its half and the engine never switched over.** `grep` finds **no use of
`shooter_player_id` anywhere in `modes/`** - the engine still reads only token 4.

**FIXED as described.** `modes/base.py` gained `shooter_player_id(ev)` (reads `$HIR` token 3) and
`Roster.wire_ids` / `Roster.by_wire_id()`. `modes/driver.py` populates that map from the ids it already
assigns. `modes/deathmatch.py` now resolves the killer by player id first and falls back to
`sole_member_of_team` when the id is unmapped, so a gun we never assigned an id to is no worse off than
before. A guard drops the id if it disagrees with the shooter's team rather than guessing.

**The harness was also blind, and that is fixed too.** `fake.py` hardcoded `$HIR` token 3 to `0`, so
**no sim scenario could express a two-gun team** - which is exactly why 156 scenarios missed this.
`receive_ir()` and `SimGame.kill()` now take an optional `shooter_id`.

**Two regression tests**, mutation-proven: reverting the fix fails
`test_tdm_credits_the_specific_killer_when_a_team_holds_two_guns`, restoring it passes 535/535. The
second test covers the unknown-id fallback.

**Test that proves it:** the 3-gun TDM above is the failing case and takes one short game to re-run.
Also worth an FFA run, where the current team-based path is expected to work with 3 guns - that would
confirm the diagnosis from the other direction.

**Impact:** per-player scoreboards, K/D, streaks and medals are wrong in any team mode where a team has
more than one gun, which is the normal case. Team scores and win conditions are correct.

## 🟠 Q19 — our FFA shows THREE team colours; native FFA is white (2026-08-30, observed live)

**Tony, at the bench:** *"green yellow and blue colors. i think on the native game ffa is usually just
white for all."*

**Confirmed on our FFA run with 3 guns:** each tagger lit a different colour. Native BRX FFA shows
**white** for everyone, because stock has no per-player scoring to support and players are genuinely
teamless.

**Why ours differs, and it is not arbitrary.** Kill attribution currently resolves the shooter by
**team** (`$HIR` token 4 — see Q17). For per-player credit to work at all, shooter-team must identify
exactly one gun, so our FFA gives **every gun its own `$TID`**. LED colour is `$TID`-derived, so three
guns produce three colours. We traded the correct look for a working scoreboard.

**Fixing Q17 removes the tradeoff.** Once the engine attributes by `$HIR` **token 3** (shooter player
id, already parsed and already pushed per gun as `$PSET` token 1), FFA can put **every gun on one
team** — white, matching native — and still credit kills correctly. That is a concrete second payoff
for Q17 beyond fixing 2v1 TDM.

**Open question before implementing:** which `$TID` (or other mechanism) produces the native **white**?
⚠️ *(This paragraph predates the `$GLED` solve.)* We can now paint **white directly** — `$GLED,6,6,6` —
so a neutral-white FFA no longer depends on finding a magic `$TID`. The open part is only whether a
spawned gun's native health gauge repaints over it; check what a native FFA actually pushes.

**Decide, do not drift:** if we keep distinct colours, that is a legitimate design choice (a 3-colour
FFA is arguably clearer for players than 3 identical white guns) — but it should be **chosen and
documented**, not an accident of how attribution happens to work.

## 🟡 Q18 — the FIRST mid-game reconnect reports success falsely (2026-08-30, live bench)

⚠️ **This item was first filed as a critical failure. That was wrong and is corrected here** — I read a
mid-sequence snapshot instead of waiting for the run to finish. **Resilience actually works.**

**What really happened**, running checklist item 2 with R0BAS power-cycled mid-match:

```
 9-18  (send to D9:50:2F:98:FE:30 failed: Not connected)   x10   <- the gun is genuinely gone
   19  (reconnected D9:50:2F:98:FE:30)                           <- FALSE: not actually back
 20-26 (send ... failed: Not connected)                    x7    <- still dead
   27  (reconnected D9:50:2F:98:FE:30)                           <- GENUINE
   28  team1: 3 (+1)   30  respawn ...   31  team1: 4 (+1)       <- fully recovered
```

**The outcome is a PASS.** The gun dropped, the host retried, and it rejoined and resumed scoring and
respawning. That is the flat-battery-swap case working on real hardware.

**The defect is the log line, and it is worth fixing.** `modes/driver.py:318` prints "reconnected" once
`mgr.connect(..., attempts=1)` and `driver.resetup(addr)` both return without raising. Neither proves
the gun is listening: `is_connected` reads `client.is_connected` (`ble.py`), the transport's opinion.
So the first attempt lands in the window where a power-cycled gun **advertises before it is ready** (and
`gotchas.md` records that a gun whose headset link is not up drops BLE entirely), reports success, and
dies. Recovery takes a second attempt about 7 failed sends later.

**Why it still matters:** an operator watching the log believes the player is back well before they are.
And `RECONNECT_CAP = 6` bounds total attempts per gun, so **false successes consume a budget that a
genuinely recoverable gun may need** — with a flakier link than this one, burning attempts on phantom
recoveries could abandon a gun that would otherwise have come back.

**Fix:** verify with a real round trip before printing "reconnected" and before charging the attempt
against `RECONNECT_CAP` — send something harmless and require a reply, or re-check after a short settle.

**Still open, and now genuinely uncertain:** R0BAT was off at start, powered on mid-game, and never
rejoined. Connect-grace at START passed cleanly (`playing with 2/3 taggers`, ~110 s after five
attempts). Whether a gun absent at start can ever join a running match is **untested** — it may be by
design. Worth one deliberate test.

## 🔴 F11 — A gun can arm, spawn and look healthy while SILENTLY registering no hits (2026-09-02)

**Observed at the bench.** Mid-session the victim stopped registering IR entirely: ~80 shots, zero
`$HIR`. Everything else looked correct — it connected, took the full arm sequence, echoed
`$LCD,45,70,0,0,32,384` on `$SPAWN`, reported `$VOLTS`, and drove its own LEDs and the headset's on
command. **Nothing in the BLE stream said anything was wrong.**

**Root cause: the headset had dropped its link to the gun.** It showed up in a BLE scan as
`BC-HEADSET-8F8C` advertising **standalone**. Power-cycling the headset restored hits immediately
(3/3 on the next burst). Tony also saw the headset **flash green and take a hit** at one point in the
dead window, so the headset's own sensors were alive — the path from headset to gun was what was gone.

**Why this matters beyond the bench.** `gotchas.md` records that a gun whose headset has dropped
*"silently refuses to join a game"*. This is a **different and worse symptom**: the game arms and
spawns completely normally and simply never scores. In a match that is a player who appears fine to
MC, to their phone and to themselves, and is invisible to everyone shooting them.

### ⚠️ SECOND OCCURRENCE 2026-09-02 (later) — and it is a DIFFERENT failure mode

Caught live and characterised before clearing it. Tony: *"this headset not registering hits, it's a
hard to repro but consistent problem... maybe a bad state it gets in."*

| signal | reading | meaning |
|---|---|---|
| `$VERSION` | `v4.32,**hds.59**,4,,devhost.03` | the gun **SEES the headset** — reports its firmware, and token 3 = 4 (matching the four sensors) |
| standalone advert | **absent** | the headset is **LINKED**, unlike the first occurrence |
| `$VOLTS` | 8062 mV pack, 3796 mV cell, 88% | battery fine, not a brownout |
| arm + spawn | `$LCD,45,70,0,0,0,0` | game state healthy |
| emitter | receiver decoded the full 25-bit word | **transmitting correctly** |
| `$HIR` | **ZERO** over 14+ shots | not registering |

**So the first occurrence's tell does NOT generalise.** That one had the headset advertising standalone
with a dropped link; this one is linked, visible to the gun, healthy battery, and still deaf. **There
are at least two distinct failure modes with the same symptom**, and only one of them shows up in a
BLE scan.

**`$VERSION` token 2 is a live headset-presence signal over BLE** (`hds.59`), which is new and useful:
it is the first BLE-visible headset field we have found, and it did NOT flag this fault. So it is
necessary but not sufficient for a preflight check.

**Recovery both times: a power cycle** (headset the first time, the whole tagger the second).

### ⭐ ISOLATED: the link is alive in ONE DIRECTION only

Tested while the fault was live, before clearing it. **`$HLED,0` lit all three visible headset modules
RED** (measured 1.00/0.07/0.37, 1.00/0.09/0.27, 1.00/0.03/0.20) **while the same headset registered
zero hits from a verified-transmitting emitter.**

So in this state:

| path | status |
|---|---|
| host → gun (BLE) | ✅ works |
| gun → headset (commands, `$HLED`) | ✅ **works — the headset lights on demand** |
| headset → gun (IR hit reporting) | ❌ **dead** |

That rules out the whole obvious set: not unlinked, not unpowered, not a BLE fault, not a flat battery
(88%), not the emitter (the receiver decoded the word). **The fault is confined to the IR sensor path**
— either the sensors themselves or the headset's reporting of them back to the gun.

### ⚠️ Consequence: lighting the headset is NOT a valid health check

A preflight that lights the headset and calls it good **passes a headset that cannot score**. Same for
`$VERSION` reporting `hds.59`: it does too. **The only signal that distinguishes a working headset from
this fault is an actual registered hit**, so muster/preflight needs a **test shot**, not a light test.
That is a concrete change to `docs/field-process.md`'s Armory/Muster flow and to MC's preflight.

### ⭐ AND IT SURVIVES A TAGGER POWER CYCLE — the fault is in the HEADSET

Re-tested immediately after a full tagger recycle, with the operator confirming the emitter LED was
aimed directly at the headset and the board had not moved:

- `$HLED,3` lit all three visible modules **green** (0.28/1.00/0.52, 0.23/1.00/0.52, 0.12/1.00/0.33)
- the same headset registered **zero hits** from 45+ shots

So a **gun** power cycle does not clear it. Recovery required cycling the **headset** itself, both
times it has happened.

### The full signature, and why no cheap preflight can catch it

| check | result while broken |
|---|---|
| advertising standalone? | **no** — still linked |
| `$VERSION` reports `hds.59`? | **yes** — the gun sees it |
| responds to `$HLED`? | **yes** — lights on demand, all modules |
| battery | **88%** |
| registers hits? | **NO** |
| survives a tagger power cycle? | **yes, the fault persists** |
| emitter transmitting? | verified — the receiver decoded the word |
| aim? | ruled out by the operator |

**Every non-invasive check a preflight could plausibly run — link status, firmware presence, LED
response, battery — PASSES while the headset cannot score.** There is no cheap proxy. **Only a real
registered hit distinguishes a working headset from this fault**, which makes a **test shot**
mandatory in muster and in MC preflight rather than a nice-to-have.

**Still to try next occurrence:** fire at the **GUN BODY**. If `$HIR` tok1 = 4 still registers, the
gun's own sensor is fine and only the headset's four are deaf, which would localise it further.

**The diagnostic ladder that found the FIRST one** (it cost ~40 minutes without one):
1. **Have the RECEIVER decode the emitter** (`ir-capture COM7` while `ir-emit COM8`). A clean decode
   separates *"not transmitting"* from *"not aimed"* — this is the step that saved us, and it also
   incidentally closed bench 0.2.
2. If TX is good, **scan for `BC-HEADSET-*` advertising on its own**. That is the tell.

**Open:**
- **What breaks the link?** Ours went during a session in which the gun's own hit-vibration walked it
  off its stand — so mechanical shock is the leading suspect, but it is not proven.
- **Can the gun tell us over BLE?** `armory.json` has a `headset_linked` field harvested over USB;
  find whether anything on the BLE side exposes it (`$QUERY`?). **If it does, MC and the node should
  surface an unlinked headset as a RED preflight** — this is exactly the class of fault the preflight
  exists for, and right now it would pass.
- Does a `$HIR` ever arrive from the **gun body** sensor while the headset is unlinked? If the gun's
  own sensor still works, the failure is partial, not total, and looks even more like flaky scoring.

## 🟢 F1 — POOL-STATUS LEDs: show health/armour/shield on change, revert to team colour (2026-08-30)

**Tony's spec, verbatim:** *"during game we want to be able to take over and show shield health. after a
time of no damage reset to team color."* … *"on health/armor/shield change +/- the leds should indicate
that status. then after a few seconds maybe 3-5s go back to team color or mode color."*

### ⭐ THIS ALREADY EXISTS IN STOCK FIRMWARE — find the field, do not build a driver

Tony, on Supremacy (2026-08-30): *"the maurader health bar worked differently. it showed armor and then
health and it would switch back to team after being delt damage."* That is this entire spec, running
natively, with the **gun** handling the revert timeout.

**So F1 is probably a CONFIG question, not an LED-driver question.** The Marauder differs from other
classes, so a field selects the behaviour. Find it and F1 costs one setting instead of a BLE write per
hit per player.

**Where to look:** diff a Supremacy class setup against ours — `$PSET` (the class/character block)
first, then `$GSET`. Note a native game runs on-gun and may never touch BLE, in which case config
diffing is the *only* route and there is nothing to capture.

**Do not build the `$GLED` driver below until this is ruled out.** Driving it from the host is strictly
worse: it flickers against the native gauge, costs a write per hit, and reimplements something the
hardware already does properly.

### Behaviour (as originally specified)

1. Any change to **health, armour or shield** — up or down — paints the three gun LEDs as a gauge of the
   pool that changed.
2. After **3-5 s with no further change**, revert to the team (or mode) colour.
3. A new change inside that window **restarts the timer** rather than queuing.

### What makes it buildable

`$GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>` — three independently addressable LEDs, direct palette
indices over nine colours (**0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white ·
7 pink · 8 orange**; 9/10 dark). **Token 4 is an apply gate**, not an effect enum: 0/6/7/8/9/10 apply the
frame's colours at full brightness, 5 applies them at ~1/3 brightness, 1/2/3/4 are no-ops that leave the
previous colour lit. `$GLED,,,,5,,,*` (Callsign's) blanks because **its colour tokens are empty and t4=5
applies them**, not because 5 means off. Token 5 is brightness: **0 off · 1 dim · >=2 full**. Solved
2026-08-30; palette completed and token 4 explained 2026-09-02.

The host already sees every pool change on the wire: `$HP,<hp>,<armor>,<shield>` arrives on damage, and
`$HIR` on every hit. So the trigger is free — no polling.

Suggested mapping (colour per pool, segments per level):
- **shield** teal · **armour** purple · **health** green, shifting yellow then red as it drops
- 3 lit = full, 2 = two-thirds, 1 = one-third, 0 = empty

### ⚠️ RESOLVED 2026-08-30 — the "blocker" was the native gauge, and my override was destroying it

**This subsection used to argue that a spawned gun's pulse was interference to suppress. That reading is
RETRACTED.** Tony, watching a **native FFA** game: *"two guns went blue. i shoot the other, the pulsing
blue led represents the health. now only the 3rd led is pulsing blue."*

The pulsing is the gun's **own 3-segment health gauge**, in the team colour: three LEDs at full health,
dropping to one as health falls. So:

- The "alternation" that "washed out" my gauge **was a working gauge underneath**. `$GLED` was not being
  ignored and was not fighting an animation — it was **overpainting the real thing**.
- A spawned gun pulses **because it is displaying pools**. That is why it only ever appeared when
  spawned, and why it never "settled".
- The old option list ("find the suppressor", "re-assert on a repeat") aimed at destroying the feature
  F1 was asking for. **Do not pursue it.** `$HLOOP,0,0` is still not a suppressor — that part stands.

`$GLED` per-LED control remains real and useful for **night mode, hit flash, per-player colour and FFA
white**. It is simply the wrong tool for **health**, because the gun does health itself.

### ✅ ANSWERED 2026-09-02 — F1 IS BUILDABLE (an earlier answer here was wrong, see below)

Both halves are now measured, on hardware, with a camera rig.

**1. The native gauge does NOT appear in our compiled games.** Armed and spawned from our own frames,
damaged to armour 0 / HP 15 of 45: still three LEDs pulsing, no step-down at any point. The 2026-08-30
"the pulse IS the gauge" sighting was a **native** FFA and does not transfer; in our games the same
pulse is only team colour.

**2. And we cannot paint over it either.** Sampled repeatedly rather than once, because the failure
mode is "works for a moment and is then repainted":

| state | result |
|---|---|
| UNSPAWNED, we set green | **HELD**, stable over 9.3 s |
| SPAWNED, our green | **wiped** — the gun shows its own team blue |
| SPAWNED, we set red / white | **alternates** blue ↔ ours |
| SPAWNED, re-sent before every sample (~1 Hz) | **still alternates** |

⚠️ **THE TABLE ABOVE IS RETRACTED.** It was measured with `screencap` at ~1 Hz. Re-measured at 60 fps,
our colour is the **dominant hue in 100% of frames** (white 317 mean / 40 ripple, red 227/32, green
224/61, against 65 for the native animation alone). The native pulse modulates BRIGHTNESS by 10-25%;
it does not replace the hue. The apparent "alternation" was **aliasing** — stills landing in the
ripple's troughs and being classified as the team colour.

**So F1 as originally specified — a persistent 3-segment pool gauge on the gun — IS BUILDABLE**, as
per-LED colour at full brightness. Use colour, not brightness, to encode: at the dim setting
(`t4=5`) our hue stops dominating and the native colour shows through.

### ⭐ What IS buildable, and where F1 should go instead

**The headset holds a colour.** It is natively dark during play, so nothing competes for it:

| state | result |
|---|---|
| SPAWNED, colour re-sent once after `$SPAWN` | **HELD**, stable over 8.4 s |

| want | surface | verdict |
|---|---|---|
| **3-segment pool gauge** | **gun** | ✅ **buildable** — per-LED colour, full brightness |
| sustained state (low health, flag held, powerup) | gun or headset | ✅ both work |
| flash on hit / pickup / kill | either | ✅ |
| brightness as an encoding | gun | ❌ dim loses hue dominance |

**So F1 becomes: pool state as a single headset colour, plus optional transient gun flashes.** Not the
three-segment gauge, which the hardware will not give us.

⚠️ **The caveat that bites in a match and not on a bench.** The native hit flash returns the headset
to **DARK, not to the previous colour**. A held headset colour therefore dies on that player's **first
hit**. The host must re-assert on `$HIR` — one BLE write per hit, cheap, but it has to be designed in
or the feature tests perfectly and silently degrades the moment someone is shot.

**Still open (config, not driver):** what selects the Marauder's armour-then-health native gauge, and
whether that field can be set in a compiled game. That would give us the gauge for free and is the
only route to it.

## ✅ Q14 — the fn 36/37 multipliers are REAL (CLOSED 2026-09-02)

**fn 36 = floor(magnitude × 1.25) · fn 37 = magnitude × 2.**

**Measured 2026-09-02:** 16 trials, 4 magnitudes, 8 different `$SIR` row-tail shapes, with an **fn 1
control on subtype 0 in every trial** that had to read exactly the magnitude or the trial was voided.

| magnitude | control fn 1 | fn 36 | fn 37 |
|---|---|---|---|
| 20 | 20 | 25 | 40 |
| 40 | 40 | 50 | 80 |
| 9 | 9 | 11 | 18 |
| 7 | 7 | 8 | 14 |

**The ×1.25 TRUNCATES:** 7 × 1.25 = 8.75 landed as **8**, not 9. That matters for hits-to-kill.
**Negative result:** the row's trailing tokens do **not** gate the multiplier — tails `0,0,1,,` /
`,,,,` / `0,0,0,,` / `0,0,2,,` / `0,1,1,,` / none / `0,0,1,60` all produced ×1.25 and ×2.

**Still unexplained, recorded not buried:** the 2026-08-27 24-cell controlled matrix read **×1.0 in
every multiplier cell** with a clean fn 1 control. It is **outvoted, not explained** — we do not know
why it read ×1.0. The 2026-08-27 emitter exoneration still stands (the emitter is function-agnostic).

**Scope:** measured through **our** `$SIR` table, which is the configuration we ship; the victim's row
picks the function.

**What is still blocked:** `docs/manual/03-gameplay.md` still withholds hits-to-kill for the **Burst
Rifle, Force Rifle, Bolt Rifle, AMR and Energy Launcher** — not because of the multiplier any more, but
because whether the Callsign app pushes this same `$SIR` table in every game is not established, and
the Energy Launcher's fn 24 lands no damage at all.

## 🟠 Q13 — friendly fire is INVISIBLE on the wire; MC cannot log or score it (2026-08-27)

**Bench-measured.** When `$GSET` token 1 (friendly fire) = 0, a same-team damage shot is rejected by
the receiving headset **before it produces any BLE event** — `$HIR` count is 0, not "1 with zero
damage". The same holds for support grants aimed at an enemy. See `docs/experiment-log.md`
(2026-08-27) and `protocol/brx-protocol.md` §5.

**Why it matters.** Any MC or Companion feature that wants to react to a friendly-fire event —
"you tagged a teammate", a teamkill penalty, a griefing counter, an accuracy stat that counts
misdirected shots — **cannot be built from gun telemetry** while friendly fire is off. The gun does
not tell us it happened. This is a hardware constraint, not a gap in our parsing.

**Options, if the mechanic is wanted:**
1. Run games with `$GSET` t1=1 (friendly fire ON) and enforce "no teamkills" as an MC *scoring*
   policy over events that now do reach the wire — the damage lands, and MC decides what it costs.
   Costs: real damage is applied to the teammate.
2. Accept it and design around it — no teamkill feedback at all when t1=0.

**Action:** decide before any mode advertises teamkill feedback. Nothing in the shipped modes depends
on it today, so this is a design constraint to record rather than a bug to fix.

## ✅ Q12 — FIXED 2026-08-27 (was: the shield pool is discarded in code)

**Fixed in `mcp/brx_mcp/protocol.py` and `app/src/engine.js`, with regression tests.**

Bench evidence that forced it (`docs/experiment-log.md` 2026-08-27): the shield is a **real,
damage-absorbing pool** — shield 150 took four 30-damage hits as `150/120/90/60/30` with HP and armour
**untouched** — and its ceiling is `$PSET` token 5.

**The bug was worse than "the shield isn't displayed".** `_onHp` summed only `hp + armor`, so a hit
absorbed entirely by the shield computed `dmg === 0`, and the `dmg > 0` guard then dropped the
`hit_taken` fact **completely**. Against the measured sequence above, **all four hits would have
emitted nothing at all** — no HUD feedback, no MC event, no score, while the player really was being
shot.

What changed:
- `protocol.py` now parses `$HP` as `<hp>,<armor>,<shield>` (it read only `<hp>`).
- `engine.js` tracks `this.shield`, includes it in the damage total, and reads **`$HP`** token 3.
  ⚠️ **Not `$LCD`.** A first version also read `$LCD` token 3; it was **reverted 2026-08-28** as a bug.
  `$LCD` tokens 3-4 are undocumented and read 0 in every observed frame, so that write could only
  *zero* a live shield, recreating Q12 verbatim. `engine.js` carries a comment saying not to re-add
  it. Open question filed as **B20**.
- Spawn and respawn **zero** the shield, matching hardware: `$PSET` t5 is a capacity filled by an
  fn-11 grant, never a starting pool. A stale shield would have inflated the next damage computation.
- Two regression tests in `app/test/engine.test.mjs` (48/48 pass; Python 533/533).

**Still open (design, not code):** whether `hit_taken` should carry the shield delta as a separate
field so the HUD can distinguish "your shield ate that" from "you took it in the face". The fix above
makes the event *fire*; it does not yet break out which pool absorbed it.

---

## 🔴 Q12 (original report) — THE SHIELD POOL IS DISCARDED IN CODE, not just in the spec (2026-08-26)

`$HP` is **three** pools — `$HP,<hp>,<armor>,<shield>` — confirmed on the wire tonight (a shield grant
reads `$HP,45,70,70` and the next hit drains **shield first**). brx-opus2 found `docs/spec/node.md`
documented it as a two-token frame; **the code matches the wrong spec**:

| where | what it does | consequence |
|---|---|---|
| `mcp/brx_mcp/protocol.py:93-99` | parses **only `tok(1)`** (hp) | armor *and* shield never reach the parsed event |
| `app/src/engine.js:450` | `case 'HP': this._onHp(+t[1] \|\| 0, +t[2] \|\| 0)` | reads hp + armor, **drops the shield token** |
| `app/src/` | **zero** occurrences of `shield` | the phone engine has no concept of the pool at all |

**Why it was harmless until tonight:** nothing could put a value in the shield pool — `$PSET` shield is
inert (P16). **It stopped being harmless the moment we proved an IR `$SIR` fn-11 event fills it.**

**Failure mode, in order of nastiness:**
1. A hit **fully absorbed by a shield** changes neither hp nor armor ⇒ the engine sees nothing ⇒ on a
   strict reading **no `hit_taken` event at all**: no damage, no assist, no "who shot me", nothing in
   the outbox. A player being shot appears untouched.
2. `status` carries no shield ⇒ the HUD and MC's board cannot show it.
3. It fails **open** — everything looks correct until the first shield charger exists.

**Decision needed (Tony's, not ours):** `hit_taken.dmg` should almost certainly **include the shield
delta** rather than emit `dmg: 0` — a hit that landed is a hit that landed, and `dmg: 0` invites
`if dmg:` guards downstream to drop the event again, which is the same bug wearing a different hat.
Both brx-ir and brx-opus2 independently reached that recommendation. Parsing the third token is
additive and safe; changing the event's meaning is a **contract change** and wants sign-off.

Full write-up: `docs/spec/node.md` §10-Q12.

## Protocol — still unknown (worth a capture or probe)

| # | Item | Status | Method |
|---|---|---|---|
| P1 | `$WEAP` ~6 secondary-fire token positions (7–13) | 🟢 **largely RESOLVED on hardware (2026-08-26)** — 7–11 closed as dormant | **Confirmed not static** (server-fetched, `apk-harvest.md`). Field names/order known; pin wire positions via a one-field Callsign BLE capture, or the server API response. **PROGRESS (2026-08-26, `weapmap` + cap14):** 8 previously-unvalidated positions now move. **`t23` = burstWeaponTime CONFIRMED** (275 on the named Burst Rifle, empty on the full-auto AR and every other weapon). **`t17` == 2 × `t40` in all 6 frames** and `t39` == `t16` — so those are not independent knobs. Wire signatures named: `R01`=Assault Rifle, `R18`=Burst Rifle. ⚠ `t5` (primaryDamage) reads **9** on the AR, not the 24 the 2-frame derivation anchored to — **t5 is unresolved**. **Still empty in every frame: tokens 7–11 (the secondary-fire block)** — needs a weapon with a real alt-fire. Tool: `python -m brx_mcp.weapmap <captures…>`. **DONE: the full Callsign arsenal (20 weapons) is captured and named** → `docs/reference/weapons.md`. Hardware-confirmed: `t14` cycle/charge, `t15` swap delay, `t23` burst, `t24` overheat, `t28`/`t29` action sounds, `t35` overheat sound, `t1`=2 → `t12`/`t13`/`t42`, `t25`/`t26` (Suppressor only, 1 sample). Constraints: `t17`==2×`t40`, `t39`==`t16`. Corrected: `t14`/`t15` were swapped; token 27 is a SOUND not a weapon id. **t5 since RESOLVED (= the RAW magnitude carried in the IR word, NOT applied damage — see P10); t19 captured (Shells on the shotgun); the demotion below is historical** — an AR reads 9 not 24, and a shell-reload weapon reads `t19`=0. **Tokens 7–11 CLOSED as dormant** — empty on all 20, no stock weapon has an alt-fire. Further weapon captures are not worth running. |
| P2 | Per-player identity (not just team) | ✅ **RESOLVED over pure BLE (2026-08-25, §7p + §7q)** | **Set:** `$PSET` token 1 = player id, 0-based 0–63 (app shows 1–64; write `id-1`) — cap10/cap11. **Read:** `$HIR` token 3 = the shooter's player id on every hit (token 4 = shooter `$TID`) — bench-verified both directions on two guns with ids 6 and 19 (§7q). Every earlier capture had all guns at id 0, which is why tok3 looked constant. **No USB `SETUP` cable, no IR receiver needed** for attribution; MC numbers the fleet at arm time. Unlocks FFA per-player scoring, individual K/D + assists, Syphon, and per-player `$SFLASH` kill feedback. FFA no longer needs unique `$TID`s (P9 becomes a duos/trios question only). Remaining: `$HIR` token 2 (always 0) and the IR `P[6]` field cross-check (B13, optional). |
| P3 | `$PSET` voice-pack token→sound mapping | ⬜ | **Server-side** — it's the Callsign `voice-profiles` endpoint (`apk-harvest.md`). Get it from the API capture, or change one voice profile and diff the `$PSET`. |
| P8 | **Callsign server API capture** (gun-off) | 🟡 NEW | MITM the app's HTTPS (`/api/v1/callsign/settings`, `voice-profiles`, `arenas/games`) → yields weapon stats, voice-pack presets, game defs directly. Needs proxy + cert on the phone, not the gun. Distinct from BLE snooping. Answers P1/P3 + weapon stats at once. |
| P4 | `$AS` / `$UP` semantics | 🟡 **probed 2026-08-26 — SILENT on v4.32** | Seven shapes sent to a live, spawned, in-game gun: `$UP,*` · `$UP,0,*` · `$UP,1,*` · `$AS,*` · `$AS,0,*` · `$AS,1,0,0,0,0,0,0,99,*` · `$AS,1,0,0,0,0,0,0,0,*` — **every one produced no reply frame at all.** So neither command is a query on this firmware. Either they are write-only (effect not observable over BLE), or inert on v4.32. `$AS` token 8 = applicator (99=all, 0=local) per LaserTagMods remains untested for *effect*; a future probe should look for a behaviour change, not a reply. |
| P5 | `$HIR` variants; per-weapon IR protocol | ✅ **RESOLVED 2026-08-26** | Per-weapon IR protocol is carried on **`$HIR` token 2** (0 standard, 10 on the rocket — bench exp 2, `brx-protocol.md` §7r / P10). The `45,0,0`/`70,0,0` variants were `$HP`-pool echoes, not damage classes. `tok1` = a per-hit sensor id (groups {0,4} seen; front-vs-back **not** resolvable at bench distance — sensor sweep 2026-08-26, needs shielded isolation). |
| P6 | Results read-back after a game | ❎ | Gun keeps **no score** (§7n). There is nothing to read; the host/phone is the only score-keeper. **Do not probe `$SP`** (half the panic sequence). |
| P7 | `$SFLASH,*` | ✅ **RESOLVED** | **It is the shooter's green-sight kill-confirm flash** — one per kill scored, sent by the host over plain BLE (cap8, §7o). The old "periodic, never near a hit" note came from a **victim-side** capture; kills you score are invisible in your own `$HIR`/`$HP`. |
| P9 | **Max native team count** (`$TID` range) | ✅ **RESOLVED (bench exp 4, 2026-08-26)** | `$TID` is **masked to 2 bits** — effective team = `$TID & 3` (tok4 read 4→0, 63→3, 100→0). **All four masked teams (0–3) are usable** — a re-run with a properly re-armed victim (spawned, team 1, full `$SIR`) caught **5 clean `$HIR,4,0,0,2,24,0,0`** registrations from a `$TID,2` shooter; the earlier team-2 silences were a **bench-script re-setup race** (shooter caught mid-`$CLEAR`), not a team-2 limit. So **native team count = FOUR (0,1,2,3)**; larger squad counts → MC logical teams (FFA + armbands). ~~**FF sub-open now CLOSED:** friendly fire is **NOT IR/firmware-enforced**~~ — **⚠ OVERTURNED 2026-08-26 (unattended IR bench, replicated 2× with a trailing known-good control).** `$GSET` **token 1 IS friendlyFire and IS firmware-enforced**, exactly as the APK teardown labelled it, and it gates **both** damage and support effects:

| `$GSET` t1 | dmg from same team | dmg from enemy | heal from same team | heal from enemy |
|---|---|---|---|---|
| **0** (FF off) | **blocked** (0, 1) | 3, 3 | 3, 4 | **blocked** (0, 0) |
| **1** (FF on) | 4, 3 | 3, 3 | 3, 5 | 5, 3 |

FF off ⇒ team identity is enforced in both directions (damage enemies only, heal allies only). FF on ⇒ team is ignored entirely. The earlier "same-team damage lands under both values" reading came from a single un-repeated probe; a controlled matrix does not reproduce it. **MC keeping `friendly_kills` separately is still right** — but "FF off" is now *also* enforced on the gun, so a mode can rely on it. See exp-log + `brx-protocol.md` `$TID` row. |
| P10 | **IR damage value in the hit payload** | ⚠️ **PARTLY OVERTURNED 2026-08-26 (night)** — **tok5 is the RAW MAGNITUDE from the IR word, NOT the applied damage.** Measured with the emitter at magnitude 20: fn 1 → tok5 20 / pool −20 · ✅ **CONFIRMED 2026-09-02 — see brx-protocol.md §5** fn 36 → tok5 20 / pool −25** · **fn 37 → tok5 20 / pool −40**. The original reading held only because every weapon tested sat on a `$SIR` **fn-1** row, where raw and applied coincide. ⇒ **tok5 is unusable as a damage source wherever a multiplier row is in play**; derive damage from the `$HP` delta instead (our node path already does). Original text: | `$HIR` **token 5 = the applied damage, EXACT** across 4 weapons (AR 9, Shotgun 45, Sniper 80, Rocket 115) — it equals the `$WEAP` `t5` field, so **damage-weighted scoring and heavy-weapon balance are BLE-native** (no IR-payload bit-decode needed). **Token 2 = the shooter's IR protocol** (0 standard, 10 on the rocket) — the explosive/tag-type signal Jay described; **token 7 = weapon subtype** (sniper 1). **Armor model pinned:** armor absorbs 1:1, overflow spills to HP, **no per-hit cap** (feeds the engine/sim — B15). See `brx-protocol.md` §7r. |
| P11 | Health-write semantics | ✅ RESOLVED | exp-log #33: **`$LIFE` and `$BUMP` are both ADDITIVE grants, clamped at max** (send the delta to add; neither is an absolute-set). **NO native regen** — armor held at 18 through 30 s idle. ⇒ shields/overshield/medic/Syphon are buildable via **host-driven** writes (heal on event; Halo-shields = host timer refill). Writes **don't self-emit `$HP`** — value shows on next hit/HUD refresh. |
| P16 | **Do shields activate?** | ✅ **CLOSED 2026-08-26** — **YES, via an IR `$SIR` function-11 event**, never a BLE pool value: shield 0→50→70 on our emitter, and a later hit drains **shield first** (order shields→armor→HP). `$PSET` shield=70 alone does nothing, which is why G-2 saw 0. Original note: | The `$HP` **shield** field stayed **0** all through G-2 despite `$PSET` shield=70/99. Shields may need explicit **activation** (APK `ActivateShield` ability / a `$SIR` or mode setting), not just a pool value — so armor+HP are the working health pools today. Find how to turn shields on (needed for overshield / energy-shield modes). |
| P12 | **`$PB*` playbook enum tables + re-test on v4.32** | ❎ **NEGATIVE on v4.32 (2026-08-27)** — all 12 `$PB*` shapes plus `$INIT` are **silent**: no reply, no state change. The v4.30 FB sequence does not respond on our firmware, so the enums cannot be mapped this way. Enum values would have to come from P8 (the HTTPS capture). Original note: | FB captured the full `$PB*` remote-start sequence on **v4.30** with enum values (`$PBGAME 0=FFA`, `$PBWEAP 0=M4 AUTO`, `$PBPERK 2=Body Armor`, `$PBLIVES 2=5`, `$PBTIME 5=Inf`; `$INIT` blocks start) — `brx-protocol.md` §7j. Map the **full enum tables** for each `$PB*` and confirm the sequence on our **v4.32** (behaviour is version-sensitive). |
| P13 | **`$GLED` colour = single index (0–8)?** | ✅ **CLOSED 2026-08-30 · palette completed 2026-09-02** | **YES, and there are three of them.** `$GLED,<led1>,<led2>,<led3>,<t4>,<brightness>` — tokens 1-3 are the three body LEDs, each a direct palette index over **nine colours**: **0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal · 6 white · 7 pink · 8 orange** (9/10 dark). Bench-verified one field at a time, then predicted and confirmed: `$GLED,3,2,1,0,10` → green/yellow/blue. **7 and 8 were read off a gun on 2026-09-02** with the camera rig (normalised R/G/B: 7 = 1.00/0.30/0.66 pink, 8 = 1.00/0.38/0.30 orange), all three LEDs agreeing on every row and matching the community lead. `$HLED` token 1 shares the palette for 0-7 and diverges at 8 (red on the headset, orange on the gun). **Do not re-run.** |
| P17 | **How to turn the LEDs OFF (night mode)** | ✅ **CLOSED 2026-08-30 · mechanism corrected 2026-09-02** | Send Callsign's own death frame `$GLED,,,,5,,,*`, which is what `gameconfig._led_frames` already ships — **the shipped frame was always right; only the rationale was wrong.** ⚠️ **RETRACTED 2026-09-02: "token 4 = 5 is the off value".** Token 4 is an **apply gate**, measured on a black-background camera rig, 3 trials per value, pre-state verified, driven from a known GREEN by sending RED (which distinguishes a no-op from a blank in a way a dark start cannot): **0, 6, 7, 8, 9, 10 apply** the frame's colour tokens at full brightness · **5 applies them at about 1/3 brightness** (ratios 0.29/0.41, 0.30/0.44, 0.33/0.44 on two LEDs over three trials) · **1, 2, 3, 4 are no-ops** — colours ignored, gun keeps what it was showing. **No value animates** (trustworthy null: the positive control, a spawned gun's native pulse, swings luminance ~494 against 24-70 here). So `$GLED,,,,5,,,*` blanks **because its colour tokens are empty and t4=5 applies them**; applying an empty colour is what turns the LEDs off, and **there may be no dedicated off value at all**. This retro-explains the leftovers: `$GLED,,,,6,,,*`/`$GLED,,,,7,,,*` blanked a lit gun because 6 and 7 also apply with empty colours; `$GLED,,,,3,,,*` did not blank because 3 is a no-op. It also explains why four sweeps of this token disagreed with each other — **a no-op leaves the previous row's colour lit**, so a sweep that blanks between rows reports "nothing is lit" and one that does not reports "everything is lit", from identical hardware. **New the same session: token 5 is a three-state brightness — 0 off · 1 dim (~70%) · >=2 full**, saturating at 2 (2 through 255 indistinguishable; 3× alternating with no overlap, t5=1 → 172/181/184, t5=2 → 267/254/247). ⚠️ `$GLED` now has **two apparent brightness controls** (token 4 = 5 and token 5); whether they compose or one overrides the other is **UNTESTED**. ⚠️ The older shipped frame `$GLED,0,4,0,0,0,,*` was built on the retracted "index 0 = off" reading — index 0 is **red**, so it never turned anything off. Fixed 2026-08-31. |
| P14 | **Audio SD card removable?** | 🟡 NEW | FB: audio is on a **(removable) SD card** ("pop" at boot = speaker OK; corrupt SD = no sound) — tensions our "SD hot-glued, not removed" note. Inspect on hardware: is the card accessible/swappable, and does swapping it change sound independent of the USB `AUDIO`-folder path? (`community-notes.md`) |
| P15 | **`$PLAY` alarm + phone-as-station BLE limits** | 🟡 NEW | For phone-as-extraction-site (`docs/adr/0003-native-app-over-web-bluetooth.md`; phone-app-spec.md deleted): confirm which `$PLAY` sound ids make a good field-wide **extraction alarm** (grenade/explosion bank), and measure the **max simultaneous BLE connections** an Android target phone holds (decides how many guns one phone can make scream — ~3–7 expected). Below that count → mesh-event + per-node alarm. |

## Grenade (mostly RESOLVED on hardware, exp-log #33–40 — see `reference/grenade.md`)

> **⭐ NEXT BENCH — GRENADE + IR EMITTER, side by side (Tony, 2026-08-26; deferred: too loud, family asleep).**
> Now that we can **emit arbitrary BRX IR**, the grenade stops being a sealed black box: we can put our
> VS1838B next to it and **capture exactly what each station mode beacons**, then **replay it** and see
> whether a gun responds identically. Specifically:
> 1. **Capture** the real Respawn-mode and Hill-mode beacons on the receiver (`ir-capture`), decoding
>    protocol/team/magnitude/subtype with the now-verified field map. Our decode predicts
>    `$HIR,0,15,0,<team>,<mode>` → protocol **15**, mode in the **magnitude** field (Respawn 6, Hill 8).
> 2. **Replay** them from our emitter at a gun and compare the reaction to the real grenade's.
> 3. **Tony's correction (2026-08-26): IR CAN respawn — the grenade does it.** Our unattended test that
>    concluded otherwise only tried protocol 1 / fn 10 at a dead gun. Find the beacon that actually
>    revives, and whether it revives the dead or only **arms the living** (B12's two arming paths).
> 4. If the replay works, the **Utility Box can impersonate a grenade station** — which answers G9 (CTF
>    team assignment) and the whole objective tier without needing the sealed hardware at all.

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Grenade objective modes | ✅ RESOLVED (exp-log #33–40) | **5 button-set modes** — red=Frag, green=Assault, blue=Hill(KotH), yellow=Respawn, white=CTF. Set on-grenade only (`$GREN` can't — G8). Beacon decode: `$HIR,0,15,0,<team>,<mode>` (token5: Hill=8, Respawn=6); only Hill/Respawn beacon. Full detail in `reference/grenade.md`. Open sub-items: G9 (CTF team-assign), G10 (thrown-blast). |
| G6 | What objective state does the gun expose over BLE? | 🟢 mostly answered (exp-log #35) | **Grenade IR surfaces as `$HIR` with token2==15**, but only if the gun's `$SIR` table doesn't eat it (bare/`minfire` config). **Mode-dependent:** **Hill** (`$HIR,0,15,0,2,8`) and **Respawn** (`,2,6`) **beacon their state ~every 2.5–5 s** → readable live; **Assault/CTF/Frag do NOT beacon** (state on the grenade LED only). Remaining: decode the beacon's owner/charge fields over a full capture; confirm the dead-gun-can't-fire gate through a death→respawn cycle. |
| G8 | Active `$GREN` — drive objective modes | ❎ NEGATIVE (exp-log #36) | Swept `$GREN` operationMode 0–7 × iRType {0,15} → **no effect**. **Objective modes (Respawn/Hill/Assault/CTF/Frag) are button-set and LOCKED on the grenade** (set in the boot/setup window only — anti-tamper). `$GREN` is **not** the objective-mode config path. Remaining `$GREN` question → G10. |
| G10 | **`$GREN` for a *paired thrown* grenade's blast type** | 🔴 NEW | `$GREN`'s `GrenadeType` = FlashBang/Gas/Confusion/Molotov = *blast effects* → `$GREN` likely configures a **thrown** grenade (needs the install-accessory pairing), not station modes. Test: pair a thrown grenade, send `$GREN` GrenadeType variants, observe blast. Also test the APK hypothesis that `$GREN` needs the grenade "tapped/loaded" to the gun first. |
| G9 | **CTF flag team assignment** (Tony's hypothesis) | 🔴 NEW | Shooting a CTF (white) grenade w/ a team-1 gun turned it **red**, not team colour (exp-log #35) — CTF likely needs the flag **assigned to a team/home base first** (you grab the *enemy* flag). Likely knob = `$GREN` **`channel`** field (channel/MaxCount decoded from APK → per-team/objective addressing). Test alongside G8. **Also: pull Jay's CTF videos** (`SWAPTX capture the flag JBOX` CxGkNrxUKIQ, `10 gen1 CTF + respawns w/ QR` -_zSFsG79tI) — not yet transcribed; they'd explain the CTF mechanic (JBOX/QR, likely transfers to the grenade). |
| G2 | Grenade pairing procedure | ✅ known | **Hold RIGHT while powering on the gun → "install accessory" → power on grenade (30 s window) → pull trigger aimed at it → it chirps/flashes.** Pair all accessories in one session, tap SELECT to finish (`brx-extended-user-guide.md`). |
| G3 | Capture the app configuring a grenade | 🟡 | PacketLogger while Callsign sets a grenade → exact `$GREN` |
| G4 | Grenade firmware `.bin` flashing | ⬜ uncertain | Community says grenade firmware is `.bin`-updatable, **but G7 found the USB-C is power-only (no disk/DFU) and there's NO PROGRAM pin** — so the assumed "hold pin → USB disk" method does NOT apply. If `.bin` flashing is real it uses an unknown method. Unresolved (`community-notes.md` tension note). |
| G5 | Grenade STATE-display UI | 🟡 (=B8) | NOT a config UI (config is button-locked, G8). Build a live objective screen reading Hill/Respawn beacons (`$HIR,0,15,0,<team>,<mode>`) via a BLE tagger relay. Folded into **B8**. |
| G7 | Grenade USB-C data interface | ❎ RESOLVED negative (exp-log #40) | USB-C is **power/charge only** — no console/drive/DFU in any state (off/on/purple button-hold), no PROGRAM pin. Verified on a known-good data path (a Pixel enumerated on it). So there's **no non-IR channel** to the grenade; state-read = the IR-beacon relay. Grenade audio is reskinned on the gun/headset/Companion, not on the grenade. |

## Field-range / transport (followup D — the way to scale)

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | **Probe the nRF radio** | 🔴 | `QUERY` reports `NRFhost 1`/`NRFslave 1`; LaserTagMods ship NRFL-Bases on nRF24L01. **The BRX may already carry a long-range radio** — if so the range problem has a native answer. Highest-upside unknown. **NEW lead (D4):** the gun natively announces **multikills** ("double kill" on 2 back-to-back enemy kills) — so the *shooter's* gun receives kill confirmations, plausibly over nRF (guns meshing). If so, nRF is already carrying game events. Probe together. |
| D4 | **Native multikill / kill-confirmation mechanism** | 🔴 NEW | Hardware fact (Tony): a BRX gun says **"double kill"** when you tag two different enemies back-to-back in TDM — so the firmware tracks **local ephemeral kill state** and the **shooter's** gun *knows it got a kill* (it must receive a hit/kill confirmation — likely nRF, maybe a return IR ack). Reconciles with §7n (no host-readable *score*, but local kill tracking exists). **Investigate:** (1) does our **BLE-configured** TDM still fire multikill/streak/first-blood callouts (free announcer sounds)? (2) is there a **shooter-side kill event on the BLE stream** (watch the *shooter's* gun on a kill — cleaner attribution than victim `$HP,0`)? (3) mechanism — nRF (→ D1, guns already mesh) vs IR-ack? A 2-gun capture watching the killer's stream is the test. |
| D2 | Transport layer pluggable | 🟡 | design for BLE now, LoRa (RYLR896) / ESPNOW later (`lasertagmods.md`). The Companion's WiFi/MQTT covers most fields. **Radio baseline decided from Jay's measured tests** (`jay-ecosystem.md` §5): **ESP-NOW + external antenna (~581 ft)** for arena chatter; **LoRa in *standard/fast* mode (~1,373 ft, zero loss)** — NOT max-range (~1-in-7 loss) — for the field backbone; LoRa too slow for live score sync → time-sequence control + local scoring. |
| D3 | **Reproduce JEDGE 45-gun host** | 🟡 NEW | Jay ran **45 BRX rifles on one LoRa channel, no server** (`jay-ecosystem.md`). Validates our scale target. Confirm the broadcast-to-all-on-channel model and how per-gun addressing/scoring is time-sequenced. |

**Range problem itself is ❎ answered:** BLE can't support out-of-range play because the gun holds
no state (§7n). The fix is a device *on* each player (the Companion / a phone) — not a better
courtside radio. That reframes D1 as "is there a bonus native radio" rather than "how do we reach
the field."

## Done (for reference)

- ✅ Remote game start (`$SPAWN,,*` + `$AMMO` + `$BMAP`), two-tagger arena, `$HIR` team attribution
- ✅ `$GSET` map (hardware-confirmed), `$WEAP` token positions, `$PSET`/all command field maps
- ✅ Complete 2166-id sound bank (retired the mic-sweep dead end)
- ✅ Game modes, QR-station system, weapon-spawn types, grenade modes (APK harvest)
- ✅ Headset re-pair procedure recovered (`community-notes.md`) — the fix for the lockout that blocks firing
- ✅ Link stability (retry 5×; connecting is 1-in-3 flaky, holding is fine)

## Polish-loop Low items (deferred 2026-08-24, not blocking)

Surfaced by the 3-lens review, kept as Low (cleanup, not correctness):
- **Code nits:** `gsetdiff.py` rstrip strips all trailing commas (hides a last-field change);
  `btsnoop.py` assumes non-fragmented ACL (fine for MTU-23 NUS); `command_name` strips a run of `$`;
  `send` vs `send_batch` reply-seq filter differ (both correct); `_fieldstart` prints "HOST
  DISCONNECTED" just before the `finally` disconnects (cosmetic).
- **Doc/spec nits:** (`field-architecture.md` **deleted** — superseded by `docs/adr/0001` + `0002` /
  `reference/jay-ecosystem.md` §5; its "ESP32 has no HUD" nit was already superseded by the Companion
  T2 HUD tier); `$VIB` is a toggle so "custom hit effects" via VIB overstates; `getDevices()` reconnect
  isn't "silent auto-rejoin"; M-4 damage cited as "token 6" (1-indexed) vs "tok 5" (0-indexed) —
  standardise on 0-indexed; Companion BOM total ($25 vs $28) and pilot BLE cap (~7 / 7–10 / ≤8)
  wander within a doc; session dates stamped 2026-08-24 vs the environment's 2026-08-23;
  (`mac-capture-plan.md` **deleted** → folded into `docs/experiment-log.md`; its "Battle Lines/Faction
  Wars" mode names were not in the harvested list).

## Snooping — do we need more?

The APK teardown gave us the command **structure** (field names, order, enums) but the deeper dive
(UnityPy, 2026-08-24) proved the game **data** (weapon stats, voice-profiles, secondary-fire values)
is **server-fetched, not bundled**. So two capture routes remain, both gun-off-friendly:
- **P8 — Callsign HTTPS API capture** (MITM proxy) — the highest-yield: `settings`/`voice-profiles`/
  `arenas/games` endpoints hand over weapon/voice/game data in one shot. Answers P1, P3, weapon stats.
- **Targeted one-setting BLE captures** — P1 ($WEAP secondary), P3 (voice profile), G3 (grenade);
  a full end-of-game capture settles P4/P7. These need the gun.

No broad "watch the app over BLE" sweep is needed; the remaining data is either in the server API or
in a couple of one-setting diffs.

## Polish-loop Low items — Mission Control build (deferred 2026-08-25, not blocking)

Three review iterations (9 fresh lenses + the peer's spec-vs-code read) on commits `d0fedaa..9254c5f`; every
Critical/High/Medium was fixed in `ae05b75`/`9162040`/`9254c5f`. These Lows were surfaced, not fixed:
- **Server:** `store.py` commits per status envelope (~N/2 fsyncs/s) — consider `synchronous=NORMAL`; `recap`
  keys `post_end`/`parked` vs API.md `post_end_facts` naming drift; FFA winner with 0 kills / team-tie `tie` key
  handling in the UI copy; `net.py` a never-applied seq >256 behind a newer live seq is dropped as replay;
  `time_req.t_node` oversize raises inside `_send` (handled, noisy); `compile.py` station-gated list vs MODES
  (`extraction` left ungated as coverage-only); UI allows `max_hp` up to 999, server caps 255.
- **Phone node:** `pull_log`/`log_offer` unimplemented on the JS side (§6); `statusBody` omits `dropped`;
  `hit_taken` uses a hardcoded 1000 ms latch for the dmg pairing; a stale-latch death reports the stale team
  rather than 0; `app/package.json` lacks `"type": "module"` (Node warning only); ARMED-phase resync re-writes
  the head and lets T-0 spawn (an unspawned gun can't give trigger evidence — documented choice).
- **UI:** feed backlog not seeded from the snapshot (additive `live.feed?`); `lobby.all_acked` emitted but
  unused; `T.micro` (#5c7186) ≈3.7:1 on the new copy; PANIC copy is protocol jargon ("$CLEAR → $SP,99") —
  fine for the owner, opaque to a guest host; the alternate compact weapon-list layout from the design is
  not implemented; fonts still Google-hosted (self-host before a no-internet field).
- **Spec drift to amend:** modes §3 prose says `damage`/`rof` are substituted into `$WEAP` — the compiler
  deliberately does not (catalog dmg/rof are 0–100 UI bars, not frame rates; provisional weapons share the
  base tail until a capture pins them); §3 prose `class/damage/range` vs code `cls/dmg/rng`.

## Bench 2026-08-25 (late) — new items
- ✅ **ANSWERED 2026-08-30 — LED life mode.** The "slow blink" **was** the life gauge: three LEDs pulsing
  in the team colour, stepping down as health falls (Tony, native FFA). Confirmed in native games; the open
  part — does it appear in **our compiled** games? — is tracked in **F1**, not here.
- **5-min hold-across-disperse** — re-run (the 2-min run passed; the 5-min run was cut by the headset event).
- ✅ BUILT (23a5930, peer session: MC pushes `victory` to the winning team's connected nodes at recap + e2e test; defeat line still unpinned) **Victory cue wiring** — `compile.py` now has `victory` (VSF+JAY) separate from `game_over` (VA33); MC should
  send `victory` to winning nodes in coverage at recap (M-MC), losers get nothing extra. Find a defeat line
  (`JAW`/`JAX` are 8-s announcer lines next to `JAY` — pin by ear).
- **Reconnect-after-`$DISCONNECT`** — a fresh link right after the gun's own `$DISCONNECT` comes up dead
  (NUS TX char missing). Node should back off ≥5 s before reconnecting after a gun-initiated drop; log it.
- **Node: detect a power-cycled gun** — after resync, a `$SPAWN` that echoes `$LCD,0,0,0,0,0,0` means the config
  was wiped (power-cycle): re-write the head (§3.10 "silence → re-push" gets a second, positive trigger).
- ✅ FIXED (23a5930, peer session) **MC banner** printed `nodes: ws://<ip>:0/ws` before the net server binds — print after `_start_net`.
- **Phone-path bench** (items 4/8/13 + the whole MC↔phone↔gun path) — APK is on the Pixel; MC runs on the
  Windows Python (`/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp.mc --no-auth`).

## Phone-path bench 2026-08-25 (night)
- **Try-out LED flashes** — the gun fires in try-out but the LEDs strobe (standby/unspawned pattern). Find the
  LED-quieting token for the tutorial head (relates to the LED-life-mode item above).
- **MC self-discovery on the phone** — MC advertises `_brx-mc._tcp` over mDNS; the app should auto-fill the MC
  URL (and offer a camera QR scan) instead of manual `ws://ip:8766/ws` entry.
- ✅ FIXED (23a5930: full-width MC LINKED ✓ chip on the connected screen) **HUD: MC-link state is too subtle** — "MC LINKED" is tiny green top-right; make link/disconnect obvious.
- ✅ FIXED (23a5930: moved to the free corner) **HUD: info icon clips behind "LINKED"** on the post-connect screen (CSS alignment).
- **Node keep-alive across shade/short-lock** — investigate a foreground-service or wake path so a brief shade
  pull / glance doesn't drop the socket (today it recovers in ~10 s; acceptable but not ideal).
- **HUD weapon-select (self-serve kitting)** — let each player pick/try weapons on their own phone during KIT
  instead of the operator running tryouts one at a time. Fits the architecture: HUD shows the catalog (already
  in `welcome`/`assign`), player taps → node sends a **new up-message (loadout/tryout request)** → MC pushes the
  existing `tutorial` frames (just proven on hardware) and records the selection as the player's loadout for
  compile. **MC gates it** with a per-session/per-mode setting (allow vs lock weapon-select on the HUD) — some
  modes want fixed loadouts. Touches: node HUD picker + `engine`/`transport`, a NODE_KIND, contract, MC state.

## Phone HUD polish — bench 2026-08-25 (night), on-device findings (batch before next bench)
- ✅ FIXED (23a5930, pending device re-test) **Cam button dead** — `@capacitor-community/camera-preview` throws: the Android manifest has no `CAMERA`
  permission (only INTERNET/BT/LOCATION) and no runtime request; iOS needs `NSCameraUsageDescription`. Add both
  in `scripts/android-setup.sh` / `scripts/ios-setup.sh` + request at first toggle.
- ✅ FIXED (23a5930) **RELOAD blinks constantly** — `lowMag = st.ammo/st.mag <= .15` fires in transient states; should only show
  when live, alive, ammo<mag, ratio<=.15 (never at spawn / on a fresh mag).
- ✅ FIXED (23a5930: bigger pips + warn gating; root cause was the boot hang + warn rule) **Ammo pips bar bugged** — the pip strip above the weapon name shows a single yellow tick at full ammo
  instead of a filled magazine; `_pips()` mis-maps mag→pips (likely divides by the wrong max or fixed pip count).
- **Top-right cluster cramped/tiny on device** — LINK + battery + CAM chip on one skewed row plus K/D/A/ACC
  reads micro on a phone; needs a responsive pass (bigger CAM target, wrap/space the row).
- ✅ FIXED (23a5930: edge-triggered cues, runway_30/20 silenced; re-verify by ear) **Countdown audio bunches on the gun** — heard "10,9,8,10,3,2,1" with the last 3-2-1 together; the node's
  runway/countdown voice cues are scheduled or written with wrong timing/duplication. Review the M-START
  countdown scheduler on the node (BLE write pacing vs tick clock).
- (already logged: info icon clips behind "LINKED"; MC-LINKED text too subtle; MC mDNS auto-fill + QR.)
- **Non-cam layout should differ from cam-overlay** — the HUD is designed as a camera overlay (scrims, vignette,
  edge glow, thin skewed chips). With no camera behind it, that reads cramped/hard. Want a distinct **no-cam
  layout**: drop the overlay scrims, use the full screen for big readable HP/ammo/clock/K-D, and switch to the
  overlay treatment only when CAM is on. (Design-tool pass — Tony owns the HUD visuals per the design workflow.)

## Phone HUD — end-of-match + history (bench 2026-08-25 night)
- ✅ BUILT (23a5930: GAME OVER + K/D/A/ACC/shots + session totals → OK → MATCH COMPLETE; VICTORY/DEFEAT variants still need the winner reaching the node) **No game-over / victory / defeat screen** — at match end the HUD shows nothing (no result, no stats). Want a
  real end screen: VICTORY / DEFEAT / GAME OVER banner + this player's K/D/A/ACC, an **OK** button → the existing
  "MATCH COMPLETE — READY FOR NEXT" idle-between-games screen. (MC already sends `score`/recap; the node has its
  own totals.) Ties into the `victory`/`game_over` cues just pinned (VSF+JAY / VA33).
- ✅ BUILT (23a5930: localStorage per-match history, session totals on the result screen; a browsable history view is still open) **Game history / running totals (nice-to-have)** — keep per-game results on the phone (localStorage) so a
  player can see how they did each game across a session; optional lifetime totals. Node-local, no MC needed.

## Night session 2026-08-25→26 — root cause worth remembering
- **Capacitor plugin proxies are thenables-of-doom**: any promise that RESOLVES WITH a plugin proxy makes
  `await` call `proxy.then()` (a fake native method) and NEVER SETTLES — the app's whole boot hung there on
  device and web, silently killing keep-awake, the app-state listener, auto-scan, cam and demo mode. Rule:
  never let a plugin object be a promise's resolution value — box it (`{v: Plugin}`). Regression canary: the
  `?demo` page must reach phase `connected` (playwright harness in the scratchpad did this).
- **Screen-lock answer (Tony's question)**: with the boot fixed, keep-awake holds FLAG_KEEP_SCREEN_ON → no
  auto-lock (re-asserted on every foreground). Still IMPOSSIBLE to prevent from an app: power-button lock,
  incoming calls, user-initiated backgrounding — webview JS suspends; engine reconciles on resume (§3.11).
  The remaining hardening option is the Android foreground service (manifest already carries the permission)
  plus moving T-0/respawn/expiry into native — logged above, M3-scale.
- Verify on device next bench: KEEP_SCREEN_ON flag present (`dumpsys window`), cam permission prompt + preview,
  countdown by ear (single count, no stacking), result screen after a real match. Webview devtools now
  enabled in debug builds (`webContentsDebuggingEnabled`) — `adb forward tcp:9224 localabstract:webview_devtools_remote_<pid>`.
- **$WEAP tok3/tok4 naming** — captured frames all carry the $SIR protocol number at tok3 (charge 8, gas 11, **[UPDATE 2026-08-26: t3=damageType is working truth — U6 evidence, see protocol-classes note]**
  melee 13, rocket 10), so wire.proto lives there; but the metadata order (damageType vs powerType) and the
  SUBTYPE-at-tok4 guess (sniper 1 / AMR 3) are unpinned — one-field Callsign capture arbitrates (brx-opus2).
- **Rocket desc couples to default health** — the blurb says 115 beats a default kit (45+70); update if the
  default health block changes.

- **Persist the session (roster/kits) across MC restarts.** 2026-08-26: an MC restart mid-setup wiped the
  in-memory roster; a connected phone then sat on "WAITING FOR KIT-OUT" with no hint why. Snapshot
  roster+kits to `~/.brx-mcp/session.json` and restore on boot (phase resets to muster, players survive).

- **SUPERSEDED — t20 = fire mode + t23 = burst cycle, PROVEN 2026-08-26 (see the U0-closed entry).** ~~Capture the burst-fire token.~~ 2026-08-26 field: Burst Rifle fired single heavy shots (no burst) —
  our 4 captured $WEAP samples (ar/charge/laser/rocket) never exercise burst. `burstWeaponTime` is now
  **suspected at `tok23`** (raw idx24; a sniper probe read ≈275 there, unverified). But the
  `GunWeaponType` enum has **no burst member** (C2 in `weapon-design.md`), so a "burst rifle" may only
  ever be a fast-cadence weapon with burst-shaped audio — capture Callsign's Burst Rifle frame to settle
  whether `tok23` changes anything. Until then it's tuned as fast tap-fire (14 dmg / 180 ms).

- **SUPERSEDED same day — t20 IS the fire mode, PROVEN by one-field flip (see the U0-closed entry).** ~~Original claim: fire-mode token likely does not exist.~~ Original text: Range session 2026-08-26:
  sniper and shotgun fire FULL-AUTO on trigger hold. **Eliminated** as the selector: `tok1` (sniper
  `tok1=2`, still full-auto) and `tok19`=`reloadType` (a reload mechanism — probe changed nothing).
  The `GunWeaponType` enum (`FullAutoFire/Bow/ChargeAndAutoRelease/ChargeAndRelease`) has **no semi
  member**, so per-pull semi-auto may not be expressible in this firmware — every built weapon stays
  full-auto. **What DID resolve:** fire RATE is now real — `tok14` = fire-interval ms is **bench-PROVEN**
  (sniper `1250`→1 shot/s), and the compiler bug that had pinned every weapon at 10 shots/s is fixed
  (it wrote `fire_ms` to the constant `tok15`; now writes `tok14`, commit c606417). Cadences work; only
  per-pull discipline can't be enforced.

- **Bench: held-trigger fire sounds — retrigger-from-zero or ring-under?** Decides whether any
  sound-duration ceiling exists at all (weapon-design §3.3 void note, 2026-08-26).

- **Directional hit mechanics are now buildable** (2026-08-26): $HIR tok1 = 0 front dome / 1 back
  dome / 4 gun body, shield-isolated. Design candidates: backstab bonus, flank callouts, HUD hit
  direction indicator. Field-distance validation recommended before shipping a mode on it.

- **Special weapons & accessories design space (Tony, 2026-08-26).** The protocol natively supports it:
  (a) the victim-side `$SIR` matrix interprets each IR protocol/subtype separately (sound + undecoded
  numeric params — likely modifiers) → per-weapon on-target effects; (b) **medic heal-gun**: custom IR
  protocol + harmless `$SIR` row + Companion reads the `$HIR` tok2 protocol echo and applies +HP —
  buildable today with attribution; (c) **EMP grenade** — ⚠️ **UPDATED 2026-08-27: `$SIR` fn 23 is NOT a stun, it is AUDIO SUPPRESSION** (the gun keeps firing and keeps emitting IR; it just goes silent for ~6–8 s). **No `$SIR` function has produced a stun; U11 is REOPENED.** The live lead is to capture the **native Sentinel EMP ability word** and read its protocol/subtype off the wire. Original note: `$STUN` direct command is a NO-OP (probed 4 arg shapes 2026-08-26 — stun is likely IR-delivered via a $SIR row, weapon category 10 'Stun') +
  `$GREN`/`$BUT` (grenade + alt-fire button notifications, unprobed) — bench-probe these three next
  session; (d) decode the `$SIR` row params (e.g. `90,1,40` / `100,2,60`) — probably damage %/stun.

- ✅ **U0 CLOSED — t20 = fire mode, PROVEN by one-field flip (2026-08-26).** 0 auto / 7 single / 9
  burst (+t23 cycle) / 2-3-14 charge variants / 13 melee. Sniper flipped 7→0 changed single-shot to
  full-auto on the bench; captured Burst Rifle fired true 3-round bursts. The re-based catalog ships
  native modes.

- ✅ **Overheat mechanism SOLVED (2026-08-26): t37/t38 enable it** — SMG + t37=20/t38=150 transplant
  brought the dead heat gauge alive (28→52/dump, trigger gating at top). t24/t35 are inert without
  them. Remaining: map what 20 vs 150 each mean (two varied-value probes).

- **U2 (t41 range) — OPEN, one tantalizing positive.** t41=100 killed at max indoor distance; t41=5
  read zero — but the session ended in rig degradation (point-blank zeros on a known-good frame), so
  5's zeros are unattributable. **METHOD SUPERSEDED 2026-08-26 (IR kit arrived):** run it against a
  **VS1838B receiver** instead of a victim gun — fixed distance, `ir-range` detect%/decode% at t41=100
  vs 5 with a closing 100 control. Removes the screamer/arming-race failure mode that contaminated the
  first attempt. See `docs/bench-plan-hardware.md` Session 1½a.

- ✅ **`$GSET` token1 RESOLVED 2026-08-26 — it IS friendlyFire, and it IS firmware-enforced.** The
  earlier "not enforced under either value" reading did not survive a controlled, repeated matrix
  (IR emitter + BLE readback): at **t1=0** same-team damage and enemy heals are both **blocked**; at
  **t1=1** every combination registers. The token switches whether team identity is enforced on
  incoming IR effects. See P9 and the experiment log.
- **Fleet ops rule: POWER-REST the guns.** Two "screamer" failures on day-long-powered taggers
  (2026-08-26): advertise-but-won't-link / connect-then-drop. Rotate power between sessions; never
  bench-marathon a match-day fleet.

## polish-loop 2026-08-26 deferred lows — ✅ WORKED 2026-09-01 (handoff W4)

The ledger sat un-owned for six days. It is closed now: **15 rows — 14 fixed, 1 deliberately kept.**
Each line says what happened and, where one exists, which test pins it; the rows without a test are
copy or wiring changes with no sensible unit. Nobody should have to re-derive whether an item is real.

| item | outcome |
|---|---|
| `api.py range_verdict` 500s on malformed JSON | ✅ fixed — it used `request.json()` (which raises) instead of the `body()` helper that degrades to `{}`. Same class as the header defect fixed 2026-08-31: **a guard that itself throws**. A full/read-only disk is now a 503, not a 500. `test_mc_api_range::test_malformed_json_is_400_not_500` + `::test_a_failed_write_is_503_not_500` |
| verdicts jsonl unbounded / full-rescan per GET | ✅ fixed — the GET reads the last 256 KB and skips a torn line instead of re-parsing a whole bench day on every KIT mount. `test_verdicts_read_only_the_tail_and_skip_torn_lines` |
| CORS `*` + `--no-auth` | ⬜ **deliberately left.** Both halves are needed: the phone app is a `capacitor://` origin, so `*` is the only value that lets it reach `/api/state` during the sweep fallback, and `--no-auth` is a bench convenience. With a token on (the default) mutating routes are gated anyway, and the read-only ones expose a LAN game's roster. Revisit only if MC is ever exposed off-LAN — at which point the answer is not CORS. Pinned by `test_range_cors_allows_any_origin` so it stays a decision, not an accident. |
| compile floors odd reserves; overrides could write ammo tokens | ✅ both fixed — the even-rounding moved into `_mods`, so the frame and the number `spawn_ammo()` gives the phone's HUD cannot disagree (an `ammo_mult` perk could ship a gun one round short of what the HUD said). An `overrides` entry naming an ammo token is now a hard error. `test_mc_compile::test_an_odd_reserve_never_splits_the_frame_from_the_hud`, `…::test_an_override_may_not_write_an_ammo_token` |
| `restore_snapshot` trusts file `player_nums` | ✅ fixed — `player_num` is the `$PSET` player id on the wire, so a duplicate arms two guns that answer to the same id and every hit either takes is scored to whoever MC looks up first. Restore now repairs to unique 1..63, first claimant keeps its number. `test_mc_persist::test_restore_repairs_duplicate_and_out_of_range_player_nums` |
| zeroconf thread survives the 6 s timeout | ✅ fixed — `wait_for` abandons the *await*, not the thread. A late registration now unpublishes itself rather than advertising an MC that `stop()` has already run past. `test_mc_net::test_a_late_mdns_registration_unpublishes_itself` |
| app `onReconnectMc` no-ops after a discovery-only connect | ✅ fixed — it dialled `settings.mcUrl`, which a discovery-only connect deliberately never writes, so the button returned on line 1 and did nothing. It falls back to the last URL actually dialled, and says so in the log when there is no target at all rather than no-opping again (review 2026-09-01). No unit test: `app.js` imports the DOM at module scope. |
| `allowAssist` never resets after bind | ✅ fixed — cleared on `bound`, so a momentary drop mid-match cannot hand the phone to a second MC on the LAN. |
| Kit registry fetched once; `v as never` cast | ✅ both fixed — the gun picker refetches when the FLEET changes (`registrySig`), and the cast is a real narrowing. ⚠️ The first fix keyed it on `readiness.t`, which is a clock pushed at 4/s — i.e. it re-created the RECAP refetch storm this same ledger documents. Caught in review and now pinned both ways: `console.test.tsx` "the armory is refetched when the FLEET changes, not on a clock". |
| `parseMcQr`: no "not an MC code" feedback, rejects uppercase `WS://` | ✅ both fixed, and the function moved to `app/src/mcurl.js` so it can be tested at all — `app.js` imports the DOM at module scope. `app/test/mcurl.test.mjs` |
| JoinPanel GET-THE-APP header with no QR | ✅ fixed — the header alone told the operator to point a camera at nothing. Guards on `isRoutableLanIp()`, not truthiness: `lan.ip` falls back to `127.0.0.1`, so the first fix was dead code and the real failure still printed a QR for loopback (review 2026-09-01). `console.test.tsx` "the APK QR is only offered on an address a phone can reach". |
| NEW MATCH not disabled in-flight | ✅ fixed — `newSession()` rebuilds the session, and a double-tap on a slow LAN fired it twice. `console.test.tsx` "NEW MATCH disables itself in flight". |
| `u9_pickup`/`quick_victim` lack try/finally disconnect | ✅ fixed via `bench_common.connected()` — a tool that died holding an open BLE link left a gun that would not accept the next connection until it was power-cycled. `test_bench_common::test_connected_always_disconnects` (covers a raise inside the block, a teardown that itself fails, and a part-way connect). |
| hoist shared PSET/SIR/AR frames (7-file drift) | ✅ done — `mcp/tools/bench_common.py`. Not a style fix: a run that re-tunes the arming config in one tool and not the others measures two different games and reports one number. `ally_remeasure.py` keeps its own 190 ms AR and shield-150 `$PSET` **deliberately** (its experiment depends on them) and is exempted by name. `test_bench_common.py` fails if a frame is ever pasted back. |
| Docs: header dates stale · stale P10 markers · O-family alternates only in prose | ✅ done — `mode-limits.md`'s two 🧪 P10 markers now say resolved (2026-08-26); the duplicate `### 3.2` heading in `weapon-design.md` is renumbered (§3.3–§3.5); the Energy Launcher audition shortlist is a real bench item below rather than a line of prose. |

### W4a · Energy Launcher fire sound — bench audition ⬜

`O01` (1.45 s) ships as the Energy Launcher's `t27` override. If it does not sit right on the range,
the alternates are **`O05` 1.46 s · `O02` 1.71 s · `O04` 1.79 s · `O06` 1.81 s · `O03` 2.51 s** — any
of them fits the 1600 ms cycle (`weapon-design.md` §3.2). Ten minutes with one gun and the KIT
try-out button; log the verdict through the range-verdict API like any other weapon.
⚠️ Its damage is the bigger problem: the Energy Launcher sits on `$SIR,9,3,,24` — a **status** row
that moves no pool — so it deals **zero damage** in every game we ship (`weapon-design.md` §6.2, and
`Compiler.validate()` warns on it). Fixing that comes first; the sound is cosmetic beside it.

## Field 2026-08-30 — open after the first full match (see `experiment-log.md` 2026-08-30)

- ~~**F2 · The headset never flashes green on hit or kill under our host.**~~ ✅ **DECODED
  2026-09-01, from captures already on disk — do NOT run the capture this item used to ask for.**
  Callsign sends exactly three headset frames: a pre-game `$HLED,<team>,0,,,10,,*`, a once-per-life
  low-health alert (`$PLAY,VA8B,3,6,,,,,*` then `$HLED,7,4,90,90,10,15,*`, fired ~0.9 s after armour
  reaches 0 and HP starts dropping), and an end-of-game blank. **There is no per-hit and no per-kill
  headset frame**: 23 `$HIR` hits produced 2 alerts, one per death. We sent none of the first two,
  which is why our headsets were dark. Both now ship (`compile.py` head, `cues.hurt`/`hurt_led`).
  Full write-up: `experiment-log.md` 2026-09-01 (MacBook).
  **Still open, and it is an EYEBALL test, not a capture (~12 min):** does a per-hit blink happen
  autonomously once the headset has been lit by that pre-game frame? We have never seen the lit
  state, so we have never been able to observe it. Also unconfirmed on hardware: that the two new
  frames do what the capture says. → **F10 below.**
- **F3 · Empty-mag / reload prompt never appeared on sustained full-auto — NARROWED 2026-09-01 to
  one layer.** The gun and the engine are both eliminated, from captures already on disk: a capture
  shows one `$ALCD` per shot all the way down to 0 and then a dry trigger emitting `$BUT` with no
  `$ALCD`, so the gun does report it. What is left is the phone-side path. **Needs:** the phone's raw
  BLE frame ring — hit **Share log** on the phone before closing the app; it lands in the session
  SQLite. See `experiment-log.md` 2026-09-01 (MacBook) for what was ruled out and how.
- **F10 · The two new headset frames are shipped but UNCONFIRMED on hardware.** `compile.py` sends
  the pre-game `$HLED,<tid>,…` and the node fires `hurt`/`hurt_led` once per life; neither has ever
  been seen on a real headset. This is the **only shipped-unverified code path** we have. Next match,
  before anything else: look at the headsets pre-game (do they show team colour?) and at the moment a
  player's armour breaks (does the alert fire?). Either machine, ~12 min, no rig.
  **Test the colour token specifically.** `compile.py` writes `$HLED,<tid>,…` — but across every
  capture on disk that token is only ever **0, 1 or 7**, and no capture contains a `$TID` at all, so
  nothing observed links it to a team. "The tid is the colour" is an inference from `$GLED`'s
  palette, not a measurement (review 2026-09-01; pinned by
  `test_mc_compile::test_what_the_captures_actually_say_about_HLED`). Put a player on **tid 2 or 3**
  and see whether the headset takes the colour at all. Also note Callsign sends this frame in the
  **lobby**, seconds before `$CLEAR`/`$START`, and always paired with a `$GLED` of the same token —
  we send it mid-head and alone. If the headset does not light, try the captured shape first.
  ⚠️ **`docs/manual/` publishes "headset green: blink on a hit, hold on a kill" as a ✅ confirmed
  fact** (`01-hardware.md:139,144`, `03-gameplay.md:187,197-198,205`, `02-operation.md:389`,
  `00-home.md:95`). That marker is not earned — we have never seen the lit state. Settle F10 first,
  then correct the manual in one pass rather than retracting twice. A manual edit needs a site
  rebuild before the next push (`CLAUDE.md` → Layout).
- **F4 · A weapon swap has never been timed.** `SWITCH_MAX_MS = 2500` in `engine.js` is a guess.
  `engine.lastSwitchMs` now records the true figure whenever an `$ALCD` confirms a swap — pull it off
  the diagnostics log after the next match and tighten the constant.
- **F5 · The AR ships at 140 ms, not the captured 100 ms.** Deliberate (see the log entry): native
  speed with the stock 384 reserve strictly dominates 10 of 17 picker weapons. If stock feel is worth
  more than a balanced arsenal, set `wire.fire_ms` back to 100 and delete
  `test_ttk_band_and_no_strictly_dominant_weapon` — it will fail, by design.
- ~~**F6 · `/api/recap.csv` only ever serves the LIVE scorer.**~~ ✅ **CLOSED 2026-09-01 (handoff W1).**
  `GET /api/matches/{id}.csv` serves any finished match in the session store, through the same writer
  as the live export (`scoring.rows_csv`) so the two cannot drift. The RECAP picker exports the match
  it is showing; NEW MATCH stays live-only, because an archived match is a record, not a place to
  start a game from. `test_mc_api::test_archived_match_csv_exports_that_match_not_the_live_one`.

- ~~**F8 · `POOL = 115` is hardcoded in `views.py`.**~~ ✅ **CLOSED 2026-09-01 (handoff W2).** ARSENAL
  and KIT quoted `HITS TO KILL 13 · TTK 1.68S` for the AR at every health config; at a 100/100 pool
  the real answer is 23 hits. `weapon_view(..., pool=)` now follows `config.health` (per-player
  `loadout.overrides` win, exactly as `_gset` reads them), the screens name the pool they are
  quoting, and `weapon-design.md` §2.5's sensitivity table is machine-checked against the wire.

- ~~**F9 · Nothing tests the MC web console.**~~ ✅ **CLOSED 2026-09-01 (handoff W5).** `webapp/mc`
  has a `test` script: 69 jsdom tests in ~1.7 s that mount every screen against a full session, an
  empty one and a null one. It found two live bugs on its first run — `CommandBar` still crashed on
  `PH[si][1]` for an unrecognised phase (the same defect as the black ARSENAL page), and `Kit` called
  two hooks below its `if (!state) return null`, so the render that first received a snapshot ran
  more hooks than the one before it. It does not replace `app/tools/e2e.mjs`; it is the gate that
  runs before that suite is worth starting.

## Field 2026-09-01 — second live match (2 Android HUDs, TDM). Six findings, evidence attached

Session: `~/.brx-mcp/mc/session-8bbf96ab.sqlite` — **both phones' BLE frame rings were shared to MC**,
so several of these are settled from data rather than recollection.

- **G1 · ⛔ RETRACTED — "the headset domes never registered a hit" is wrong.** It rested on 10 frames
  from a 60-frame teardown ring, and on counting only sensors 0 and 1 as headset. `$HIR` tok1 **0–3
  are ALL headset** (it has four sensors, operator-confirmed 2026-09-01). Split by match: the reported
  match was **13 headset / 62 gun (17%)** — above Callsign's native 3/23 ≈ 13% — and the later nozzle
  test **95 / 0**. Refuted causes: `outdoorMode`, daylight, gun uptime. **What is still unexplained:**
  sensor 1 (back dome) took **zero** hits in the reported match and 69 in the test. Tracked as
  `field-issues.md` F2-1, tested by `verify-together.md` V1.
- **G2 · ✅ DONE** — `hit_taken` now carries `sensor`. Doing it exposed a real bug: `ir_proto` was read
  from `$HIR` tok1, i.e. it had been carrying the SENSOR all along. Facts recorded before 2026-09-01
  carry that mix-up with no version marker.
- **G3 · The low-health alert did not visibly fire.** Instrumented: the HUD now logs when the cue
  fires, so absence becomes decidable — the 60-frame ring could never settle it. `verify-together.md` V2.
- **G4 · The headsets DID show team colour, but on DEATH rather than pre-game.** Consistent with the
  Windows lane's correction that our `$HLED` sits mid-head where Callsign sends it as a LOBBY frame
  paired with `$GLED`. Try matching Callsign's position and pairing.
- **G5 · A game whose rules fix the weapon/perk did not apply them.** No evidence captured yet —
  needs a repro with the config id noted.
- **G6 · END MATCH EARLY on MC did not reach either HUD.** `control{end}` fan-out. Both nodes were
  `wsState: bound` at the time, so this is not a transport drop.
- **G7 · The perks menu on the phone is too small and hard to find.** UX.
- **NOT a bug:** "a phone HUD would not reconnect/sync on Wi-Fi". Its own log says
  `wsState: "bound"`, `synced: true`, `mc_reachable: true`, `pending: 0`, and **it delivered its log
  over the wire**. What was down was `bleUp:false` — the *gun*, which was off. The HUD presented that
  as a sync problem, which is the real defect: **UI truth, not transport.**
