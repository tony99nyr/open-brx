# Followups — consolidated & prioritised

> **📍 For "what is still unknown?" read [`unknowns.md`](unknowns.md)** — one page, every open
> question, grouped by *what unblocks it* (bench / grenade / capture / unwired hardware / parts /
> build work / decisions). This file remains the **detail and method** for each item; the index is
> how you see the whole board without reading six files.

Single source of truth for open work. Supersedes the scattered A–G lists in
`experiment-log.md` (kept there for history). Updated 2026-08-24. Status: ✅ done · 🔴 blocking /
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
| B18b | **Headset-present pre-game GATE in Mission Control** | 🔴 NEW — blocking, HW-confirmed | A gun with its **headset OFF silently refuses to join** a game (§7m, confirmed live — it was the real cause of every "only 2 of 3 in-game"). A dark headset = a player standing dead all round. **MC muster MUST verify each headset before allowing start.** Detectors: (a) **cabled** — `QUERY` → `Headset Version:` present & ≠ `?` (already parsed in `usbconsole.py`); (b) **BLE/field** — send spawn, require the `$LCD,45,70,…` echo within ~500 ms; **silence = not ready** (headset off/asleep) — a headset-less gun is 100% BLE-silent. Add to the readiness board next to battery; block/flag start on any unready gun. Ties to B3 + `field-process.md` §Muster. |
| B16 | **Kid-mode alt-button reload** (`GameConfig`, per-tagger) | 🟡 NEW | Young kids can't work the reload lever — option to remap the **orange ALT button → reload** (via `$BMAP`). Per-tagger pre-game toggle; allowed on any mode that doesn't need alt-fire; optionally **disable secondary fire** for kids (they won't use it). Clean config→frames feature (the `$BMAP` table is already in GAME_CONFIG). Find the orange-button `$BMAP` index + the reload action code from the app capture / `protocol-classes.md`, add `alt_reload`/`disable_secondary` to GameConfig, emit the remapped `$BMAP`, sim-test the frames. Ties to kid_mode. |
| B14 | **Voice-pack selection in `GameConfig`** (`voice=`) | 🟡 NEW | The official Callsign app lets you **pick a voice** (announcer character); we don't — our `$PSET` voice-pack tail is hardcoded to **Heavy** (`V33/V3I/V3C/V3G/V3E/V37` in `gameconfig.py:_PSET_TAIL`). Add a `voice` field that swaps the 6 voice-event ids (deathAlarm/pain/hitHP/armor/shield/crit + respawn line) to another character. **Data need (P3):** the per-character voice-event id set — sound-bank.md has the prefixes (V0 Fury, V2 Guardian, V3 Heavy, V8 Medic, V9 Raider, VA male…) and examples (Heavy V3I "Get Some", Medic V8W "one shot one kill", V85/83/84 death) but not the full per-event map. Extract the app's voice profiles from the APK, or capture by ear. Fits Tony's "customize everything" requirement. |
| B11 | **Custom connect/disconnect voice** ("Open BRX connected/disconnected") | 🟡 NEW | Branding polish: **back up + replace** the tagger's "phone connected" / "phone disconnected" audio with "Open BRX connected" / "Open BRX disconnected" via the USB `AUDIO`-folder sound swap (`<ID>.LTP`, `reference/brx-extended-user-guide.md`). First find the sound IDs (probe `$PLAY,<id>` around the connect voice, or diff the bank), archive originals, drop in the new clips. Nice first sound-swap demo. |

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
| **K1** | **Auto-reload for kids who can't work the lever** | 🟢 **ALREADY SHIPS — plus a second untested mechanism** | ⚠️ My earlier "t19=5" answer was incomplete. **The feature already exists**: `GameConfig`'s **`alt_reload` flag remaps `$BMAP,1,97`** so the orange ALT button reloads (`gameconfig.py:108/188`) — kid-mode is a per-tagger toggle we already build. **Separately**, the APK's `ReloadType` enum ends in **`AutoReload` (ordinal 5)** and `$WEAP` **t19 = reloadType** — that would be *fully automatic* reloading rather than a button. **Bench: push `$WEAP` t19=5 and fire dry — does it reload itself?** Two different kid-modes; test which Tony actually wants. |
| **K2** | **Equip a secondary weapon / perk to the ALT-FIRE button** | 🟡 **mechanism corrected — NOT the t7–t11 block** | ⚠️ My earlier claim that `$WEAP` t7–t11 is the alt-fire mechanism is **refuted by the captures**: t7–t13 are empty in **every** captured frame *and* in ours, and Callsign's alt-fire works anyway. The real path: **the alt button cycles weapon slots** via `$BMAP,1,100,0,1,99,99` (slots 0↔1), which we already push — so "secondary weapon on ALT" is a **slot-loading** question (put the perk/weapon in slot 1), not a token-filling one. `$BUT`'s `ButtonCode` enum (`Trigger, AltFire, Analog`) still gives a host-side path for arbitrary perks. P1's "t7–t11 dormant" call **stands** — I was wrong to reopen it. |
| **K3** | **Death-explosion: the headset emits IR when a Supremacy robot dies** | ⬜ NEW, high value | Tony (hardware fact): a Supremacy robot's death **emits IR from the HEADSET**, damaging like a grenade. That means **the headset is an IR emitter we don't control yet** — and `$WEAP`'s field map has **`extraHeadsetDamage`, `extraHeadsetRangeOutdoor`, `extraHeadsetRangeIndoor`, `headsetDirection`, `headsetRepeat`** (tokens 12–13, 39–40, 43), plus **`PowerType/IRSource` enum members `HeadSetOnly`, `GunAndHead`, `DoubleGunAndHead`**. So headset emission is a **`$WEAP` `primaryPowerType` (t4) setting**, not a hidden command. ⇒ **Suicide-bomber / death-nova is buildable**: set powerType to a HeadSet variant + `extraHeadsetDamage`. Verify on hardware. |
| **K4** | **MELEE does not work in our compiled game** (native mode does) | 🔴 NEW — **NOT a config bug** | Tony had to reboot into a native on-gun game to melee (2026-08-26). But two independent capture reviews found **our melee surface is byte-identical to Callsign's**: `$WEAP,4` character-for-character (`…,4,1,90,13,1,90,…M92…` — proto 13, sub 1, magnitude 90, matching the native swing we captured), all three `$SIR,13,*` rows, `$GSET` with `gyroscope=1`, and all seven `$BMAP` rows including **`$BMAP,8,4`** (button 8 = gyro → melee). Callsign sends only `$GLED` and `$PLAY` beyond what we send; neither gates a swing. ⇒ **runtime/state/trial issue, not a frame.** **Bench (one swing):** in *our* compiled game, **select slot 4 and swing hard**, watching the victim for `$HIR,…,13,…` and the shooter for **`$BUT,8`**. `$BUT,8` + no IR ⇒ slot-4 firing. No `$BUT,8` ⇒ the gyro mapping isn't live despite being sent (check whether `$SPAWN` wipes `$BMAP`, since spawn only re-sends `$BMAP,0,0`). |
| **K5** | **Slot 2 = weapon OR perk; loadout policy; phone self-serve picks** | 🟢 **SERVER BUILT 2026-08-27** (`docs/spec/loadout.md`, contracts A10) | v1 perks are the PASSIVE ones (Body Armor → `$PSET` armor; Extended Mags → `$AMMO,0` + t16/t39/t17/t40; Quick Hands → t18; **Easy Reload = K1's `alt_reload`, now per-player**). **Med Kit / Concussion stay `hidden` in `perks.json`** until the emit-side bench: their effect lives in the VICTIM's `$SIR` table (a shared constant, game-wide), so a per-player heal-gun needs the table to become policy-derived first. **Empty slot 1 is now legal** (Tony: "alt-fire just does nothing") — the compiler no longer writes a silent default shotgun; bench item: one ALT press with slot 1 empty should reload, not chirp (`brx-protocol.md:48` says reload). The `tutorial` path is unchanged (a try-out is the raw weapon, no perk knobs). |
| **K6** | **Per-game WEAPON TUNING (damage / fire-sound / rate overrides inside a saved game)** | ⬜ deferred — own spec | Tony's "silenced sniper" wants a fire-sound override. `SavedGame.weapon_tuning` is RESERVED in `docs/spec/loadout.md` §8 (always absent today) so it slots in without a schema change; the builtin "Silenced Sniper" preset ships with the stock sound and says so in its desc. Needs: which `$WEAP` tokens per weapon are host-tunable (t5 dmg, t14 fire interval, t27–t29 sounds — `compile._NAMED`), a per-preset override shape, and the bench for sound ids. |


## 🔴 Q12 — THE SHIELD POOL IS DISCARDED IN CODE, not just in the spec (2026-08-26)

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
| P10 | **IR damage value in the hit payload** | ⚠️ **PARTLY OVERTURNED 2026-08-26 (night)** — **tok5 is the RAW MAGNITUDE from the IR word, NOT the applied damage.** Measured with the emitter at magnitude 20: fn 1 → tok5 20 / pool −20 · **fn 36 → tok5 20 / pool −25** · **fn 37 → tok5 20 / pool −40**. The original reading held only because every weapon tested sat on a `$SIR` **fn-1** row, where raw and applied coincide. ⇒ **tok5 is unusable as a damage source wherever a multiplier row is in play**; derive damage from the `$HP` delta instead (our node path already does). Original text: | `$HIR` **token 5 = the applied damage, EXACT** across 4 weapons (AR 9, Shotgun 45, Sniper 80, Rocket 115) — it equals the `$WEAP` `t5` field, so **damage-weighted scoring and heavy-weapon balance are BLE-native** (no IR-payload bit-decode needed). **Token 2 = the shooter's IR protocol** (0 standard, 10 on the rocket) — the explosive/tag-type signal Jay described; **token 7 = weapon subtype** (sniper 1). **Armor model pinned:** armor absorbs 1:1, overflow spills to HP, **no per-hit cap** (feeds the engine/sim — B15). See `brx-protocol.md` §7r. |
| P11 | Health-write semantics | ✅ RESOLVED | exp-log #33: **`$LIFE` and `$BUMP` are both ADDITIVE grants, clamped at max** (send the delta to add; neither is an absolute-set). **NO native regen** — armor held at 18 through 30 s idle. ⇒ shields/overshield/medic/Syphon are buildable via **host-driven** writes (heal on event; Halo-shields = host timer refill). Writes **don't self-emit `$HP`** — value shows on next hit/HUD refresh. |
| P16 | **Do shields activate?** | ✅ **CLOSED 2026-08-26** — **YES, via an IR `$SIR` function-11 event**, never a BLE pool value: shield 0→50→70 on our emitter, and a later hit drains **shield first** (order shields→armor→HP). `$PSET` shield=70 alone does nothing, which is why G-2 saw 0. Original note: | The `$HP` **shield** field stayed **0** all through G-2 despite `$PSET` shield=70/99. Shields may need explicit **activation** (APK `ActivateShield` ability / a `$SIR` or mode setting), not just a pool value — so armor+HP are the working health pools today. Find how to turn shields on (needed for overshield / energy-shield modes). |
| P12 | **`$PB*` playbook enum tables + re-test on v4.32** | 🟡 NEW | FB captured the full `$PB*` remote-start sequence on **v4.30** with enum values (`$PBGAME 0=FFA`, `$PBWEAP 0=M4 AUTO`, `$PBPERK 2=Body Armor`, `$PBLIVES 2=5`, `$PBTIME 5=Inf`; `$INIT` blocks start) — `brx-protocol.md` §7j. Map the **full enum tables** for each `$PB*` and confirm the sequence on our **v4.32** (behaviour is version-sensitive). |
| P13 | **`$GLED` colour = single index (0–8)?** | 🟡 NEW | FB colour map (0 red…8 orange) fits **token-2-as-index** for 5/6 of our §7i probe. Re-probe `$GLED,<0-8>,0,0,1,2000,2000,*` mid-game, one field at a time → settle the LED-colour decode (needed for neutral-white FFA + team colours). |
| P17 | **How to turn the LEDs OFF (night mode)** | 🟡 NEW | `GameConfig(leds=False)` (night mode = outdoor + LEDs off) emits a **best-effort, UNCONFIRMED** `$GLED,0,4,0,0,0,,*` (effect=4=StopIR). Verify the actual LEDs-off frame: try `$GLED` effect=StopIR vs all-zeros vs a brightness/duration=0 mid-game; LED colour is team-derived (§7i/P13), so "off" is likely an effect or brightness field. Until confirmed, night mode's LED-off is not guaranteed. (`gameconfig.py _led_frames`) |
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
- **LED life mode** — our app-derived config slow-blinks the team colour and never shows HP; native on-gun games
  reportedly show life on the LEDs. Find the `$GSET`/`$PSET`/`$GLED`/`$HLED` token that selects it.
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
  sound-duration ceiling exists at all (weapon-design §3.2 void note, 2026-08-26).

- **Directional hit mechanics are now buildable** (2026-08-26): $HIR tok1 = 0 front dome / 1 back
  dome / 4 gun body, shield-isolated. Design candidates: backstab bonus, flank callouts, HUD hit
  direction indicator. Field-distance validation recommended before shipping a mode on it.

- **Special weapons & accessories design space (Tony, 2026-08-26).** The protocol natively supports it:
  (a) the victim-side `$SIR` matrix interprets each IR protocol/subtype separately (sound + undecoded
  numeric params — likely modifiers) → per-weapon on-target effects; (b) **medic heal-gun**: custom IR
  protocol + harmless `$SIR` row + Companion reads the `$HIR` tok2 protocol echo and applies +HP —
  buildable today with attribution; (c) **EMP grenade**: `$STUN` direct command is a NO-OP (probed 4 arg shapes 2026-08-26 — stun is likely IR-delivered via a $SIR row, weapon category 10 'Stun') +
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

## polish-loop 2026-08-26 deferred lows (noted, not fixed — pick freely)

Code: api.py range_verdict 500s (not 400) on malformed JSON + verdicts jsonl unbounded/full-rescan
per GET; CORS `*` + `--no-auth` admits internet-origin pages in a LAN browser (moot with auth on);
compile t17==2×t40 silently floors odd reserves + the override _NAMED set permits ammo tokens that
would break the invariant; restore_snapshot trusts file player_nums until next config change;
zeroconf executor thread survives the 6s timeout (registers late); app onReconnectMc no-ops after a
discovery-only connect; allowAssist never resets after bind (transient two-MC steal possible,
never persisted); Kit registry fetched once (no refresh after later scans) + `v as never` cast;
parseMcQr gives no "not an MC code" feedback + rejects uppercase WS://; JoinPanel renders the
GET-THE-APP header with no QR when lan.ip is missing; NEW MATCH button not disabled in-flight;
u9_pickup/quick_victim lack the try/finally disconnect wrap; hoist shared PSET/SIR/AR frames + a
connect-finally helper into mcp/tools/bench_common.py (7-file copy-paste drift).
Docs: FOLLOWUPS/HANDOFF header dates stale; U7 cites closed P10; Energy-Launcher O-family audition
alternates (O05/O02/O04/O06/O03) live only in weapon-design §3.2 prose.
