# Followups — open work only

Updated: 2026-09-07. **Everything in this file is open.** Closed items are in
[`archive/followups-closed.md`](archive/followups-closed.md), verbatim and ordered by close date; the evidence
behind every row is in [`experiment-log/`](experiment-log/) (grep the id or the date). Session close = strike or
add rows here, one experiment-log entry, one HANDOFF banner. A fact goes to `protocol/` or `docs/manual/` in the
same commit, or it gets a row here saying "promote X".

**Ids.** One capital letter + number. Never renumbered, never reused. **Next free: B24 · D5 · E8 · F40 · G11 · H7 ·
K7 · P18 · Q20 · R3 · S16.** Renumbered once, on 2026-09-06, to end collisions: the HUD-review items formerly
F15/F16 are **F26/F27**, and the 2026-09-01 field findings formerly G1–G7 (colliding with the grenade G ids) are
**F28–F32**. Bench-sheet numbers (1.1, 2.1, 3¾, A10a …) survive as aliases in §9.
**Blocked on:** `trigger` · `eyes` · `ears` · `space` · `grenade` · `capture` · `decision` · `build`.
**Status:** 🔴 blocking or high value · 🟠 next · 🟡 useful · 🟢 low.

## 1. Before going public

The repo is private, MIT-licensed, 0 forks. Nothing below blocks day-to-day work; all of it blocks a public flip.

- **✅ DONE 2026-09-07 — history purge, binaries.** `docs/reference/BRX_Manual_V7.pdf` (Battle Company's
  copyrighted manual, 14 MB) and every stale APK blob were removed from history with `git filter-repo`
  and force-pushed. Old clones are invalid; re-clone rather than pull.
- **✅ DONE 2026-09-07 — raw Callsign assets.** The five raw JSONs are gone from the tree per
  `protocol/callsign-extract/RAW_ASSETS_NOTE.md`; three were unreferenced, two were restated as our own
  derived data under `mcp/brx_mcp/data/`. Regeneration reads a gitignored local copy of the APK.
- **✅ DONE 2026-09-07 — headset ids in binary captures.** The two `protocol/captures/raw/2026-08-25-*.btsnoop`
  traces carried a sticker id in the advertised name; both were patched in place with an equal-length alias,
  byte count unchanged, and both still decode identically.
- **⬜ Flip the APK to the Release.** One apk is still tracked in `webapp/download/` because a release asset
  on a *private* repo is not downloadable by an anonymous visitor, and the site is public. The moment the repo
  goes public: `git rm --cached webapp/download/*.apk` and append `webapp/download/*.apk` to `.gitignore`.
  The download card already prefers the local file and falls back to `build.json`'s `url`, so the page does
  not change. Every build from now on is published to the `app-v<version>` release by `npm run android:apk`.
- **⬜ Device identifiers in text history.** Sticker ids and BLE MACs remain in ~88 old commits (the tree is
  clean; `mcp/tests/test_docs_hygiene.py` keeps it that way). Deliberately not purged: they label Tony's own
  four headsets and grant nothing remotely. Revisit only if that judgement changes; it needs `--replace-text`
  plus a `--blob-callback` for binaries (`docs/gotchas.md` has the traps).
- **✅ DONE 2026-09-07 — dead branches deleted.** `bench/feedback-fork-ir-nrf-2026-08-25` (local and
  remote) and `worktree-agent-a8593058024df0d96` are gone. They were superseded 2026-08-25 forks and the
  remote one still pinned the PDF and every old apk, which is why the purge of `main` alone did not shrink
  anything. Full pre-purge backup: `~/brx-backups/open-brx-pre-purge-2026-09-07.bundle` (48 MB, all refs).
  Pack went 93 MB → 28 MB. **A release tag can pin purged history too**: `app-v0.1.6` pointed at the old
  commit and had to be re-pointed through `.git/filter-repo/commit-map` before the objects would drop.
- **⬜ Release-sign the APK** (B21) and drop `webContentsDebuggingEnabled` before a build leaves the bench.
- **Standing rules.** Credit LaserTagMods in anything public-facing (CLAUDE.md hard rule). Keep
  `test_docs_hygiene.py` green: no sticker ids (write `Tactix-XXXX`), the Updated stamp above moves with the
  file, one id per H2, HANDOFF ≤ 150 lines, every relative link in `docs/` resolves. `~/.brx-mcp/armory.json`,
  `device-backups/`, the audio bank and `session-*.sqlite` stay out of the repo.

## 2. Extensibility — let outsiders build modes and sound packs (E1–E7)

Review + rationale: [`mode-extensibility.md`](archive/mode-extensibility.md). JSON re-skins shipped modes; a new ruleset
needs Python across ~4 core files, and the wire schema cannot carry a new mode's parameters. Do them in order.

- **E1 🔴** `mode_params: dict` on the wire `GameConfig` (`mcp/brx_mcp/mc/types.py`), validated by the engine. The
  wire is mode-agnostic today, so objective modes cannot be configured over MC at all. `build`.
- **E2 🟠** one `register_mode(name, engine_cls, meta, preset, scorer)` replacing the four hardcoded touch points
  (`modes/driver.py build_engine`, `mc/state.py MODES`, `mc/presentation.py MODE_PRESET`, `mc/scoring.py`). `build`.
- **E3 🟡** unify `gameconfig.py` (CLI dataclass) and `mc/types.py GameConfig` (wire TypedDict); publish a JSON Schema. `build`.
- **E4 🟡** "How to add a game mode" contributor doc with a ~40-line worked `GameEngine` subclass. `build`.
- **E5 🔴** phone-side audio channel: the HUD plays a bundled/hosted clip through the phone speaker on a presentation
  event (no per-gun USB load, no fixed-id limit). Today the app plays no game audio. Home of a custom announcer. `build`.
- **E6 🟡** first-class sound-pack abstraction (a named `event → sound` set you select; gun ids and/or phone clips).
  Supersedes B14. `build`.
- **E7 🟢** `.LTP` import/convert + gun-load tool (`mcp/tools/ltp_convert.py` exists; the per-gun USB load is manual, B11). `build`.

## 3. Build (B)

- **B1 🟡** BRX Companion (ESP32-S3 rider): spec'd (`hardware/brx-companion-spec.md`), not built; per ADR-0001 an
  optimisation, not required. Hardware gotchas: 5 ms/char serial, 3.0–3.4 V logic, diode on RX, <300 mA, screamers
  (`reference/community-notes.md`). `build`.
- **B4 🟠** BRX Utility Box: emit is hardware-proven (2026-08-26); build is packaging (`hardware/brx-station-spec.md`).
  A respawn station for *hosted* games is B23; for native games it is one word (see `reference/grenade.md`). `build`.
- **B8 🟡** grenade STATE app: a live Hill/Respawn display from the passthrough row (`$SIR,15,*,,24` + FF on → `$HIR,0,15,…`).
  Objective modes are button-locked on the grenade (G8), so this is display only. `build`.
- **B9 🟡** the definitive manual website: `site/` ships; open is the sound-bank explorer + the polish pass. `build`.
- **B11 🟢** "Open BRX connected/disconnected" voice: ids are VA99 / VA9A; back up, convert, USB-load. `build`.
- **B14 🟡** voice-pack selection: every character voice uses one 22-slot layout (sound catalog), so the per-character
  map is now derivable without P3. `build`.
- **B16 🟢** kid mode: Easy Reload ships per player (K5); remaining = a disable-secondary toggle. `build`.
- **B17 🟡** tutorial mode (`TutorialEngine`, audio-guided, event-gated). `build`.
- **B19 🟠** MC config verification via `$QUERY`: read-back is proven (player id, team, HP/armor/shield, voice, per-slot
  damage + fire sound). Replies arrive seconds late (poll until stable); read surface is `$QUERY` + `$VERSION` only, so
  `$SIR`/`$BMAP` cannot be verified. Diff after arming, flag mismatches before start. `build`.
- **B18b 🟡** (was 🔴) headset-present gate in MC preflight. The detectors are known: link + `$ALCD` echo, `$VERSION`
  token 2 = `hds.59`, rainbow blink = disconnected; a real registered hit is the only proof it can score. Open is the
  MC wiring, not the detection. `build`.
- **B21 🟠** release-sign + distribute the Android app (debug key today, `debuggable=true`; keystore out of repo,
  `assembleRelease`, version bump per build; iOS = TestFlight or source build). `build`.
- **B22 🟢** APK pipeline leftovers: minSdk/targetSdk can drift silently (record in `build.json`, assert on the page);
  site link check ignores percent-encoding; the 07-platform section stamp renders above a newer build date. `build`.
- **B23 🔴** respawn station for HOSTED games = a node-defined "downed" state. A dead hosted gun hears no IR and native
  station words do nothing in a host-driven game (2026-09-04). Design: on `$HP,0` re-spawn stunned (F15) ≥ 3 s later,
  node paints the dead look, station beacon arrives via the passthrough row, node checks team + delay, restores pools.
  Every link is proven separately; the assembly is not. Open: a downed gun still takes IR damage; FF must be ON for a
  same-team beacon. `build`.

## 4. Hardware, prints, research (H, R)

- **H1 🟡** reload-handle → push-button STL (version-tag it; older/newer handles differ). **H2 🟡** D-pad buttons STL.
  **H3 ⬜** Companion mount + ported audio box (with B1). **H4 ⬜** station enclosure (with B4). **H5 ⬜** skins.
  **H6 🟡** curated MIT sound pack + load guide (data-port swap, `community-notes.md`). All blocked on Tony's caliper
  measurements (reload socket, D-pad, rail). `hardware/print-files.md`.
- **R2 🟢** software `DUTY <0-255>` (and `PULSES`) command on the IR emitter, echoing its own duty; re-run the fn 1
  control at every duty before trusting a result. A nicety again since the emitter was fixed (2026-09-03). `build`.

## 5. Tony's asks (K)

- **K1 🟡** kid auto-reload: `alt_reload` ships. The other mechanism, `$WEAP` t19 = 5 (AutoReload), does not reload an
  empty magazine by itself (2026-08-27); only the fire-triggered case is untested. Pick by feel. `trigger` (bench 1.4).
- **K2 🟡** perk on ALT-fire: the ALT button cycles slots (`$BMAP,1,100,0,1,99,99`), so it is a slot-loading question;
  `$BUT` AltFire is the host-side path for arbitrary perks. `build`.
- **K4 🔴** melee does not work in our compiled game while our frames are byte-identical to Callsign's (`$WEAP,4`, three
  `$SIR,13,*` rows, `$GSET` gyroscope=1, `$BMAP,8,4`). One swing: select slot 4, watch `$BUT,8` and `$HIR,…,13`. `trigger` (bench 1.1).
- **K6 ⬜** per-game weapon tuning (damage / fire sound / rate inside a saved game); `SavedGame.weapon_tuning` is
  reserved in `spec/loadout.md` §8. Needs its own spec. `build`.

## 6. Field bugs, protocol gaps, questions (F, Q, D)

- **F35 🔴** `$TID` 4-7 are display-only and BREAK combat (bench 2026-09-07): the IR word's team field is 2 bits so
  the gun transmits `tid & 3`, but the victim compares the FULL tid — teammates on tid ≥ 4 damage each other, their
  shots read as friendly to the tid they alias onto (no damage), and a gun can kill itself off a nearby surface
  (observed, `$HIR` naming its own player id). **Guard it in code**: reject `tid > 3` in `state.validate()` /
  team assignment, and make the displayed team COLOUR a separate lookup (palette 0-7) from the tid. `build`.

- **F3 🟡** empty-mag / reload prompt never appeared on sustained full-auto. Gun and engine are eliminated from captures;
  what is left is the phone transport/render layer. Needs the phone's BLE frame ring (Share log before closing the app). `capture`.
- **F5 decision** the AR ships at 140 ms / reserve 192, not the captured 100 / 384 (balance; 100 strictly dominates 10 of
  17 weapons). Stock feel = set `wire.fire_ms` to 100 and delete `test_ttk_band_and_no_strictly_dominant_weapon`. `decision`.
- **F12 🟡** (header corrected 2026-09-06) the VS1838B capture firmware splits one frame into 2–4 pieces (a real gun 3/44
  whole). **Captures are no longer blocked**: `native_capture.py` stitches every split (a split loses exactly one
  duration, 2026-09-03) and the grenade session ran on it. Still open: the firmware assembly bug itself (log `micros()`
  at frame start/end, then raise `IDLE_GAP_US` past the measured hole or stitch in firmware), and the rule that
  `loopback.py` runs before any IR session. `build`.
- **F13 🟠** a respawn within ~2 s of death wedges the headset in the green out-blink (threshold 2.0–2.5 s; use ≥ 3 s).
  (1) enforce a floor on `respawn_s` (nothing stops an operator setting 1 s) `build`; (2) headset-side frame pacing of
  the arming burst is unverified (echo proves the gun got it, not that the headset executed it) `eyes`.
- **F14 🟢** HUD moment nits: a `gain` inside the 250 ms rare-moment guard is dropped (deliberate); the night hit-chip
  lost the shooter's team colour (deliberate); `engine.js` drops a `gain` when a frame damages and grants in one tick.
- **F15 🟠** build the host-driven stun (EMP). Proven chain: proto-8 word → victim `$SIR,8,0,,24` → `$HIR,…,8,…` →
  `$AMMO,0,0,0,1` + `$AMMO,1,0,0,1` → restore. Build: engine timer (default 10 s, extend not double-restore, death
  cancels) + a `_SIR_TABLE` row when the mode enables EMP + a source (slot with t3=8, or the Utility Box) + tests.
  Cheaper alternative to bench first: `$BHIT,<BulletType>,<PlayerId>,<Team>,<Damage>,<Crit>,<PowerLevel>,<Direction>`
  injects a hit through the firmware path (APK field set; the 2026-08-26 "echoed, not applied" used a 3-token shape).
  Do not rely on the native stun (2/5 singles, lasts until death). `build` + `trigger`.
- **F16 🟡** `bench_common` half fixed: `BMAP` + `spawn_tail()` exist and `stun_hunt.py` uses them; the other
  operator-fires tools (`hittest`/`damage_bench` style) and a test pinning `BMAP` to MC's `_bmap()` remain. Re-read any
  past "trigger did nothing" negative from such a tool with this in mind. `build`.
- **F17 🟢** lives cap: DOWN recap shows LIVES LEFT only if `config.respawn.lives` exists; no mode sets it. `build`.
- **F18 🟢** FFA board is the top three players standing in for teams; a real FFA ladder is a small HUD follow-up. `build`.
- **F19 🟢** after a PANIC the HUD shows the plain kitted screen; add a "HOST STOPPED THE MATCH" pill. `build`.
- **F20 decision** kill confirm during a reload is deferred until the RELOADING takeover ends (~2 s). `decision`.
- **F21 🟡** status-bar / display-corner inset fixed in code (APK 0.1.6+); verify on the Pixel 4 and Pixel 10. `eyes`.
- **F23 🟠** applied damage may depend on the SENSOR, not just the `$SIR` function: a Callsign capture shows 18/hit on
  headset sensor 0 vs 9/hit on gun body 4, same victim, same life. Would break every hits-to-kill number.
  `bench-weap-tokens-discovery-2026-09-04.md` item 1. `trigger`.
- **F24 🟡** MC-owned session totals (`session_totals` in the `score` push) so the phone's tally matches the laptop. `build`.
- **F25 decision** the kill strip says "CONFIRMED BY MISSION CONTROL"; true by construction (kills only arrive from MC),
  but an out-of-range player reads their kills as unconfirmed. Keep, or "ELIMINATION"? One string in `hud.js`. `decision`.
- **F26 🟡** (was F15) accuracy attribution unverified: `$HIR` shooter field → `player_num` as `scoring.py` assumes?
  Two guns, two phones, ten shots. `trigger`.
- **F27 🟡** (was F16) reload takeover timing: time `$BUT,2` → `$ALCD` per weapon; correct `weapons.json reload_s`. `trigger` + `ears`.
- **F28 🟡** (was field G1) headset sensor 1 (back dome) took zero hits in the 2026-09-01 match and 69 in the nozzle
  test; `outdoorMode`, daylight and uptime are refuted. `field-issues.md` F2-1 / `verify-together.md` V1. `eyes` + `space`.
- **F29 🟢** (was G3) the low-health alert is now logged when it fires; verify it in a match (V2). `eyes`.
- **F30 🟡** (was G5) a game whose rules fix the weapon/perk did not apply them; no evidence captured; repro with the config id. `capture`.
- **F31 🟠** (was G6) END MATCH EARLY on MC did not reach either HUD (`control{end}` fan-out; both nodes were `bound`). `build`.
- **F32 🟢** (was G7) the perks menu on the phone is too small and hard to find. `build` (check `hud-review-2026-09-03.md` first).
- **F33 🔴** gun-body team table is OFFSET from the server's tids: `poolgauge.TEAM_COLOURS = {1: BLUE, 2: RED, 3: YELLOW,
  4: GREEN}` vs `state.py` red 0 / blue 1 / yellow 2 / green 3, so a yellow-team gun paints RED pregame and in play
  (only blue, every bench, agrees). Identity map + tests for tid 0 and 2 (`led-language.md` §6 #1). `build`.
- **F34 🟠** no F13 floor on the node path: MC accepts `respawn.delay_s` 0–600 and the engine spawns at exactly that,
  so 1–2 s puts every `$SPAWN` inside the relay wedge. Validate ≥ 3 at PUT, floor in the engine. `build`.
- **Q13 decision** friendly fire is invisible on the wire (a team-blocked shot emits no `$HIR`). Either run FF on and
  score teamkills as policy, or accept no teamkill feedback. Decide before any mode advertises it. `decision`.
- **Q15 🔴** sub-indoor IR power: only power exists, no width field. Lever 1 = `$WEAP` t41 `gunRangeIndoor` (75 on all
  guns, 20 on melee); lever 2 = `$GSET` t3 `gunLaserRegion`. `$IRTX`/`$HFIRE` emit nothing on v4.32. Sweep t41
  75 → 30 → 20 → 10 → 75 at a fixed distance on the receiver; a null is an answer. If it works, an indoor preset. `space` (bench 2.1).
- **Q16 🟠** beam divergence: on-axis then 10–50° off-axis at 3 m, 10 shots each, closing control. Sharp fall-off ⇒ skip
  the snoot, cut power (t41, then an aperture attenuator). Black plastic is IR-transparent at 980 nm; test any snoot. `space` (bench 2.4).
- **Q18 🟡** the first mid-game reconnect prints "reconnected" before the gun is listening (`modes/driver.py`), burning
  `RECONNECT_CAP`; verify with a round trip first. Also untested: can a gun absent at START join a running match? `build` + `space`.

- **Q12′ decision** should `hit_taken` carry the shield delta as its own field (both sessions said yes; `dmg: 0` invites
  `if dmg:` guards to drop the event)? `decision`.
- **B20 🟢** is `$LCD` token 3 the shield? Grant a shield (fn 11, friendly), `$HP` shows it, trigger an `$LCD`, read
  token 3. Yes ⇒ re-add the read in `engine.js` with a test; no ⇒ record confirmed-not-shield. `eyes`.
- **D1 🟡** the nRF radio (`NRFhost 1` / `NRFslave 1`): a bonus long-range channel only; not needed for feedback or
  attribution. Time-box the mesh tap to 30 min. **D3 🟡** reproduce Jay's 45-gun LoRa host (`reference/jay-ecosystem.md`).
  **D4 🟡** does the native "double kill" callout fire under OUR config (3 guns + ears)? `build` / `ears`.

## 7. September build items (S)

- **S14 🟠** **SYPHON: heal the killer, as a HUD-driven event** (Tony 2026-09-07, for a fair 2v1). The mechanic
  exists only in `modes/deathmatch.py`, the laptop-BLE CLI path, and has never run on hardware; the phone node
  and the node↔MC bundle know nothing about it, so it does not exist in a real match. **Design (agreed):** it is
  a HUD event, not an MC push. MC already tells the killer's node it scored (`feedback` `kind: "kill"`,
  `engine.js` §3.6, the same body that carries medals), so the node writes the heal to its OWN gun and animates
  it. The alternative, MC composing `$LIFE` for a remote gun over A6.4 `apply`, needs coverage at the instant of
  the kill and silently does nothing out of range. Shape: a `siphon` block in the game config compiled into the
  bundle (`{hp, armor}` + the precompiled `$LIFE` frame), so the node holds it and works offline. Guards: never
  heal a node that is not `live` and alive; `$LIFE` is additive-and-clamped so it cannot overfill; **no shield**
  (P16, the pool is IR-only). Open sub-items: **S14.1** the Designer control + a per-team or per-player switch
  (a 2v1 wants it for the solo side only, and the config is game-wide today), **S14.2** the HUD treatment (brx-hud owns
  `app/src/hud`) — Tony 2026-09-07: **not a new screen. It rides the KILL CONFIRMED takeover as another entry in
  the medal stack, coloured differently**, so a heal reads as part of the kill it came from. It **plays a heal
  sound and the health bar animates up** — reuse the profile's existing `healed` event (presentation.py already
  defines its sound and LED per preset) rather than inventing a siphon cue, so a silenced game stays silent. The
  engine puts it on the kill moment as `siphon: {hp, armor}` beside `medals`, which is the same shape the stack
  already walks, and the health it heals is the node's own pool so the bar has something to animate to.
  **Show what was GAINED, not what was granted** (brx-led, 2026-09-07): `$LIFE` is clamped at the pool ceiling,
  so a kill at full health grants 50 and gains 0, and a screen that claims +50 there is lying. The node knows its
  own pool, so it computes `min(grant, max - current)` and the stack shows that; a gain of 0 shows nothing at all
  —
  **S14.3** prove it on hardware. `build`.
- **S15 🟡** **Nothing guards the FrameBundle boundary** (raised by brx-sound, 2026-09-07). The UI contract test
  added 2026-09-07 compares `types.py` against `webapp/mc/src/api/types.ts`, which covers the MC console. The
  **phone** consumes a different contract, `FrameBundle`, and reads it in **57 places** in `app/src/engine.js`
  against **zero** mirrored declarations, so a field the compiler renames or drops fails as `undefined` at
  match time rather than in CI. It is the same class of bug the UI test was written for, on the boundary that
  actually runs a game. A cheap first cut: assert every key `compile.py` emits is named in `contracts.md` §3,
  and that each bundle key the engine reads is one the compiler emits. Worth doing before the bundle grows
  again — S14's `siphon` block crosses exactly this line. `build`.
- **S13 🟡** **Per-player kit powers beyond the pool** (Tony 2026-09-07). The per-player POOL override
  (`loadout.overrides`, KIT) covers health and armour and shipped 2026-09-07. The same per-player idea could
  carry more: a damage or fire-rate modifier, a respawn-delay handicap, extra lives. Each needs a home on the
  wire before it is worth a control: pools ride `$PSET`, weapon numbers ride that player's `$WEAP`, respawn and
  lives are node-side. Decide which are worth it before building any. `decision`.
- **F36 🟡** **The published APK is unproven on hardware.** 0.1.7 is cut, published and advertised on the site,
  but no build since 0.1.6 (2026-09-04) has run on a phone, and it carries 16 commits including the S7.1 rejoin
  anti-cheat, A11.7/A11.8 LED work and the A15 voices. Install it before the next match. `trigger`.
- **S3 🟠** extraction on the phone path, HUD-driven (ARC Raiders / Fortnite Sprite reference): zone presence from the
  station beacon on the player's own gun; call → window → close timers on the node with `extraction_tick`; a wallet;
  hard end at expiry (`raid_ending` → `raid_over`); MC reconciles wallets at recap. Port `modes/extraction.py`'s rules,
  not its transport. `last_survivor` stays opt-in. `build`.
- **S5 🟠** MC arms the utility stations at muster (contracts A13.5, `spec/utility.md` §5b/c, `utility-roadmap.md`).
  Server side not built: `hello node_type:"utility"` accepted without a gun; ITEMS panel (kind / team / station id /
  threshold); `station_config` push at muster and on re-arm; `config.stations` allow-list from the assigned ids.
  Phone-side wire facts are in the archive (S5 block). Build with the ui-build-verify discipline. `build`.
- **S6 🟡** kill the legacy shims (Tony: "we dont need to support legacy at all"): `presentation.EVENTS` `multi`/`medal`
  and `compile.cues()` `multi`/`medal`; `cues.team_led` + the pre-A11.6 bundle fallback; engine "older MC" defaults
  (`swap_ms` 850, kit-open flag, `feedback.cue`), `restore_snapshot()` pre-A11 normalising; the scorer's "kind stays
  kill" comment. Keep the "server predates this UI" banners. One sweep, regen the golden bundle, cut an APK. `build`.
- **S12 🟡 Tony's call** the player's OWN voice has no off switch. A15.3 moved the pains, the spawn line and the
  death scream from the firmware to us, but `compile.py` emits them ungated: `preset: "silenced"`, `announcer: false`
  and `hud_events: false` all still ship `cues.pain_short`, `cues.spawn` and a 3-frame `pset_pool` (verified
  2026-09-06). Kept deliberately — `announcer: false` mutes the announcer and objective groups only, and pre-A15.3 the
  firmware grunted under a silenced game anyway, so gating it would have REMOVED a sound players had. But a silenced
  sniper grunting on every hit gives away the position, which is the point of that preset. Decide: a
  `presentation.voice` switch (`on` / `hits_only` / `off`) or leave it. `decision`.
- **S11 🟡** the gun stage's boot blocks the HTTP server: `--gun <addr>` is awaited INSIDE the lifespan before
  `yield`, so when the tagger is asleep or the BLE stack is busy the page never starts listening and the process looks
  hung (hit 2026-09-06 after two forced restarts; two orphan processes, port 8790 dead, no error in the log). Fix: boot
  the link as a background task and let the page come up LINKED=false, or bound the connect with a timeout that logs.
  Workaround meanwhile: start without `--gun` and press CONNECT. `build`.
- **S9 🟠** event sound pass on the gun stage (45-step walkthrough failed several): `extraction_tick` (K01 is a fly-by;
  trial U100, alts U13/U41), `extraction_closing` VX0R and `extraction_complete` VQ8 failed, `unstoppable` had no line
  (trial VX0U), `killing_spree` V125 vs VA7K, `healed`/`armour_up`/`shield_up` have no sound. Then every mode preset.
  One sound per verdict, Tony's ear decides; write ids into `presentation.EVENTS` with a `test_sound_catalog` pin. `ears`.
- **S10 🔴** LED language v2 (A16): build [`led-language.md`](led-language.md) §3–§5. **Bench 2026-09-07 settled the
  down signal**: never send `$HLED,,6` in play (effect 6 disables the firmware's own death flash for the life; a
  colour write does not, so `dark` = `$HLED,9,0,,,10,,*`), write nothing at death, re-arm with one `$HLOOP,2,750,*`;
  **delete `death_flash` / `flash_frame` / `_deathFlash` / `_reassertDeathBlink` and the `death: flash` enum** -- `presentation.lights` block
  with the night OVERLAY (dim + sparse, never a blackout; the DOWN signal exempt), gun body DARK at rest with the
  transient 3-segment pool readout + bursts, headset role states that survive hits (carrier white, infected,
  VIP, extraction beacon), the DOWN pulse with quiet gaps around death/`$SPAWN` and the eliminated cadence, `_lightGen`
  cancel on end/panic/resync, respawn white flash at +1.0 s, preset name on every `MODES` row, console lights editor +
  muster lights check + DOWN-screen copy. Findings table and build lanes in the doc. Gate for the down-signal timing:
  the L-ladder (bench sheet §6). **Open sub-item (found in the A16 part-2 build):** the node's headset ROLE
  mechanism is general and wired for `carrier` (via `alert()`) and `infected` (via the death/team_flip path), but
  **`vip` / `beacon` / `extracted` have no signal that reaches the node** — nothing on an `alert()` body or in the
  config tells a phone "you are the VIP". Needs an MC-side contract field before those three role states can fire;
  the engine side is ready. `build` + `eyes`.
- **S2 leftovers 🟡** presentation profile: the WRITE UI (preset picker + switches; today `PUT /api/config`);
  per-event override editor with the catalog picker; objective/VIP emitters (`Session._alert("objective_scored")`,
  `survivors_win` for infection); `bomb_detonated` X12 vs X13 (Tony: X13 might be a sniper); **6b** the headset flash
  LED (`$LED,9,1,1,1,*`; native hit flash is ≥ 2× ours by wall reflection; bound the ratio with an ND filter; try `$LED`
  tokens 3/4; does `$LED` need a spawned gun; plan `bench-flash-control-2026-09-05.md`); CLI `GameDriver` still paints
  the team colour in play (align with `presentation.headset_frames()`). `build` + `eyes`.
- **S2 Lows** (polish round 2026-09-04, no behaviour at stake): `merge` rejects `{"preset":"custom"}`, unhashable preset
  500s, bare `{"preset"}` KeyErrors; `_colour` admits 8 and tids 4–7 while compile's `_HLED_SEEN_COLOURS` is 0–3
  (`$HLED,8` unverified); an alive-event static `$HLED` under `in_play: dark` stays lit; medal `delay()`s and event
  GLED steps not cancelled by `_endLocal`/panic; `_reassertDeathBlink` not gated on `!resync`; `alert()` plays in
  `armed`; `syncPlayerAdvert` sets `playerAdvert` before `start()`; `utility.js stopAdvert` swallows errors;
  `mc_confidence()` treats a phoneless rostered player as missing (intended, document); iOS `CBUUID(string:)` throws on
  a malformed uuid; Android catches only `SecurityException`; `webview_eval.py` carries a personal adb path;
  `compile.py` legacy `$WEAP` `int(f.split(",")[16])` has no guard; `_turned` not persisted or reset; 3-team infection
  survivor count is wrong (restrict to two teams in `validate()`).
- **S4 leftovers 🟢** gun body LED (A11.7, body taken 2.5 s after `$SPAWN`): (b) CLOSED 2026-09-07 (a paint held
  8 min with no traffic); (e) blink forms after a blank; the separate muzzle-flash LED's addressability; an
  event burst in the first 2.5 s of a life still fights the breathing (exact threshold 1.5–2.0 s). `eyes`.
- **S7 leftovers 🟡** reconnect (S7.1/S7.2 built + hardware-validated): gap-death re-arm (a gun that died while the app
  was closed and does not re-report `$HP,0` is re-armed as alive; decide whether reconcile re-probes once); the
  dead-player rejoin path is untested on hardware; a soft reload left the native BLE link half-open (release on
  teardown). `trigger` + `build`.
- **S8 🟢** station scan fix (low-latency scan + 8 s restart, 73d391a) needs the two-Pixel bench to confirm; try a lower
  station TX if it recurs. `eyes`.
- **S1 leftovers 🟡** sound catalog: Tony's by-ear audit (148 of 2477 done; `fx:hit` is the most valuable batch left);
  the category-driven picker in the MC game-mode editor. `ears` + `build`.
- **S-A12 sidearms 🟡** .1 ear audit of P09 / Q04 / P16 and the D08 D07 D06 reload run (fallback D04/D03/D02) `ears`;
  .2 semi-auto cadence on hardware (t20 = 7, t14 150/200/375; USP-S t25=2/t26=50 = no flash + half loudness?) `trigger`;
  .3 real Counter-Strike audio stays out of the repo (convert with `ltp_convert.py`, copy over the data port) `build`;
  .5 a stock `pistols` template in START FROM. `build`.

## 8. Protocol unknowns (P), grenade (G), bench unknowns (U)

- **P3 🟡** `$PSET` voice-pack token → line map (or from P8). `ears` / `capture`.
- **P4 🟢** `$AS` / `$UP` are silent on v4.32 (seven shapes); their *effect* was never probed. `trigger`.
- **P8 🟠** Callsign HTTPS API capture (MITM: `settings`, `voice-profiles`, `arenas/games`): weapon stats, voice packs,
  game defs in one shot, gun-free. Method: `capture-runbook.md`. Also answers P3 and P12's enums. `capture` (Mac + iPhone).
- **P12 🟢** `$PB*` playbook enums: silent on v4.32; values only via P8. `capture`.
- **P14 🟢** is the audio SD card removable? Needs a teardown; not worth it on a 4-gun fleet until there is a spare. `decision`.
- **P15 🟡** phone-as-station limits: which `$PLAY` id is a field-wide alarm; max simultaneous BLE links an Android phone holds. `ears` + `space`.
- **G3 🟡** capture Callsign configuring a grenade → the exact `$GREN`. `capture`. **G4 🟢** grenade `.bin` flashing: no
  known method (USB-C is power-only, G7). **G9 🟠** CTF flag team assignment (a white grenade shot by team 1 turned red;
  likely `$GREN channel`; pull Jay's CTF videos). **G10 🟡** `$GREN` blast type on a paired thrown grenade. `grenade`.
- **Grenade captures still to do:** Hill / Assault / CTF / Frag beacons (`bench-grenade.md` steps 1, 5, 6); a BLE scan
  with the grenade on; the receiver on a HEADSET for the three unexplained emissions (proto-15 killer-id word on death,
  three self-hits after the button word with FF on, short bursts on dead-trigger pulls). `grenade`.
- **U2** = Q15 (t41). **U4 / U5** reload-chain timing vs `reload_ms`; held-trigger fire sound retrigger vs ring-under. `ears`.
- **U11′ 🟡** which `$SIR` function, if any, is a real STUN in OUR table? fn 23 is audio suppression; the enemy-polarity
  shortlist that registers a hit and moves no pool is **8, 24, 25, 26, 27, 28, 35** (fn 3 drains shield, so damage);
  ally 31, 32, 34 are genuine status functions (re-measured from depleted pools). Only a human holding the gun can name
  them. Moot for the product if F15 ships. `trigger` (bench 1.5).
- **Unexplained, recorded not buried:** the 2026-08-27 24-cell ×1.0 multiplier matrix (outvoted by two runs, never
  explained); one 16/16 vs 4/10 registration run under identical geometry (2026-09-02).

## 9. Needs Tony at the bench (merged from bench-tomorrow.md + unknowns.md, 2026-09-06)

Preflight, every session: power-cycle gun AND headset (screamers after ~a day powered); kill stale `brx_mcp` processes
at the OS level (a forgotten server holds a gun); `loopback.py COM8 COM7 6` before any IR work; state the shooter TEAM
for every IR test (damage from an enemy, grants from the victim's own team, or the shot is discarded with no `$HIR`);
never advance an operator-in-the-loop sweep on a timer; never end a run on a bare `$CLEAR` (F11). Run everything from
the Windows venv (`/mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe -m brx_mcp …`); the ESP32 rig is board A =
receiver COM7, board B = emitter COM8; Windows COM ports are exclusive.

**A17 hit audio** (one gun, our compiled game, an armoured life; `ears` + `trigger`):
- F37 🟠 **`$PSET` hit-slot ORDER.** hitHp / hitArrmor / hitShield / hitCrit are source-derived from the APK, but
  `docs/manual/06-developer.md` still marks the wire-slot -> name mapping unknown. Arm with three unmistakably
  different clips in those slots, take an armour hit then a health hit on one life, and say which played when.
  Everything in `hitaudio.MATERIAL_POOLS` rides on this; a wrong order plays a real but wrong clip per pool.
- F38 🟠 **Does a `$SIR` sound LAYER with the `$PSET` pool sound, or REPLACE it?** Put a bell on `$SIR,0,0` and a
  thud in hitHp, then take one standard hit on health. Two sounds = the ideal (weapon impact + material); one =
  the class layer wins and the material layer only speaks on the rows we leave silent. Decides which layer we tune.
- F39 🟡 **The real `$SIR` row ceiling.** "Max 14 distinct IR recognitions per game" is a community figure we have
  never measured; `hitaudio.MAX_SIR_ROWS` treats it as a soft budget. Push a 20-row table and check every row still
  registers. Gates `hit_audio_rekey`, which is DEFAULT OFF until F38 and this are both in.
- F37-39 all read off `FrameBundle.hit_audio` (cells, families, material roles) for what the gun was actually armed with.

**Trigger in hand** (one gun, our compiled game, Tony firing):
- 1.1 **K4** melee swing, watch `$BUT,8` / `$HIR,…,13`.
- 1.4 **K1** `$WEAP` t19 = 5, pull the trigger on an empty chamber, watch `$ALCD`.
- 1.5 **U11′** fire enemy 8, 24–28, 35 and ally 31, 32, 34 at a held gun; report what you hear, see, or cannot do.
  1.5a first (keyboard): `mcp/tools/ally_remeasure.py <victim>` with fn 10/11 as positive controls.
- 1.6 KotH rate-of-fire buff: while ally 31/32/34 land, hold the trigger and listen for cadence.
- 1.7 t37/t38 overheat: two varied-value probes on the SMG frame, watch the `$ALCD` heat gauge.
- 1.8 **U4/U5** one long reload with a stopwatch; hold the AR trigger and listen.
- **F15** rung 9: `$BHIT` with the `$HIR` field set; does it apply a hit, and does Damage 0 give the native flash?
- **F23** same word at headset sensor 0 vs gun body 4, compare the `$HP` delta.
- **F26** two guns, two phones, ten shots: does `$HIR` shooter id map to `player_num`?
- **F27** per weapon, `$BUT,2` → `$ALCD` up, versus `reload_s`.
- **P4** `$AS,1,0,0,0,0,0,0,99,*` and `$UP,1,*` on a live gun: any behaviour change?
- **A10a** kit an EMPTY secondary (no perk), press ALT: expect nothing, then fire still works; **A10d** Easy Reload: ALT on
  an empty mag reloads; **A10 Quick Hands** vs the D-family reload chain: listen for clipping (floor t18 at the chain length if ugly).
- **S7** dead-player rejoin (force-close while DOWN → come back DOWN at the real `deadAt`); gap-death re-arm.
- **S-A12.2** pistol semi-auto cadence.

**Eyes** (dim room, lit gun):
- 4.4 try-out LED strobe (unspawned pattern during tutorials): quieting token, or a mode fix.
- 4.5 `$PSET` t2 and t6: invisible to the damage instrument; push mid-game, watch LEDs, listen. Nothing ⇒ record inert.
- **A10c** Extended Mags HUD max matches the `$AMMO,0` we write (64/768).
- **B20**, **S4** (b)/(e)/muzzle LED, **S8** two-Pixel confirm, **F13** (2) headset state across the arming burst,
  **F21** on both Pixels, **F28/F29** in a match, **S2 6b** flash-LED ladder with an ND filter.
- **S10** L-ladder: L1–L9 ANSWERED 2026-09-07 (the `$LED` pulsing scheme is deleted; `$HLOOP` is the down signal).
  Left: a metered A/B of `$HLOOP,2,750` against a native out-blink, the rate's usable range, L10 dim 2-of-3 held
  60 s, L11 purple `$TID,4`, L12–L14 (gun body dark paint vs blank, blank idempotency, dim after a blank).
- Night mode: confirm a blanked gun stays dark once spawned (the S4 blank holds; only `$SPAWN` re-breathes).

**Ears:** **P3** voice-pack token; the defeat line (`JAW`/`JAX` beside the confirmed `JAY`); **W4a** Energy Launcher fire
sound (O01 ships; alternates O05 O02 O04 O06 O03) and, first, its zero damage (decision below); **S9**; **S1** audit;
**S-A12.1**; **D4** does "double kill" fire under our config (3 guns); **P15** alarm id.

**Space / tape measure** (receiver on a taped mark, no victim gun):
- 2.1 **Q15** t41 100 → 5 → 100 (closing control), `ir-range` detect%. 2.4 **Q16** divergence at 3 m, 0/10/20/30/40/50°.
- 2.2 the "halo assassinate": a back-dome melee is a different word, or the same word on tok1 = 1? (melee is magnitude 90).
- 2.3 sensor map (tok1 0/1/2/3/4) at ~5 m. **F28** back dome at field distance.
- IR range of real guns vs our emitter, outdoor mode / weapon / angle (`docs/archive/hardware/range-experiment.md`); the grenade beacon's ~18–20 ft.
- **P15** BLE link count on the target phone. **Q18** gun absent at start joining a running match.

**Grenade:** 3.2 the Hill BUFF word (a gun in the hill, receiver on its headset); 3.5 **G9**; 3.6 **G10**; the captures in §8.

**Capture (Mac + iPhone, batch for a Mac day):** **P8**, **P3**, **P12**, **G3**; re-scrape the FB group with comments
expanded (the 2026-08-24 crawl missed threads).

**Decisions (Tony's call):** Energy Launcher deals zero damage in every shipped game (`$SIR,9,3,,24` is a status row;
flatten `_SIR_TABLE` or retune five weapons); **Q12′**; **Q13**; **F5**; **F20**; **F25**; **K1** which kid
mode; **P14**.

## 10. System proofs (needs players, space, time)

From `verification-checklist.md` (archived 2026-09-06); what is ⬜ there and still true:
- **Hold-across-disperse 5 min**: config head written, gun left unspawned 5+ min, then `$SPAWN` + `$AMMO` goes live with
  config intact (2 min passed; the 5 min run was cut). Else the T-10 s head re-write becomes default.
- **20-minute two-node soak** (Pixel + iPhone): screen-lock one at T+5, background the other at T+10, walk out of Wi-Fi;
  BLE held, engine reconciled on unlock, outbox flushed on return, timed end fired locally on both.
- **Phone auto-rejoin** to the no-internet SSID after 3 min out of range, mobile data on vs off, per OS.
- **iOS locked-phone BLE**: lock mid-match, take 3 hits, unlock; did the queued `$HIR`/`$HP` reach the engine?
- **`$VOLTS` % token**: controlled discharge sweep of tokens 3 and 4 (HUD reads tok3 today).
- **FFA on real guns** (`play ffa A B C`, one `$TID`, FF on, distinct ids) + the **attribution fuse** (an old non-fatal hit
  does not steal a later kill) + **time-limit end / respawn ramp** (only frag-limit ends have run); infection / lms live.
- **Syphon / regen live** (`syphon=1`, `regen=1`: refill after `regen_delay_s`, re-arm on damage, no heal on respawn).
- **Config knobs on-gun**: outdoor (`$GSET` t2), kid_mode FF-off, volume 80 = comfortable L3, `hp=`/`armor=` echo,
  provisional weapons (`charge`, `ar`) fire.
- **Session F, objectives**: the grenade beacon relay made repeatable for the state display; Domination/KotH CAPTURE
  events score point-time; CTF GRAB/CAP/DROP with per-team `held` (needs G9); CS plant/defuse from a station;
  **extraction live** (`play extraction A B C`, station feeds ZONE/LEAVE/LOOT/PICKUP); a button-armed native gun stays
  station-respawn all match (the plain beacon alone does NOT arm, 2026-09-04).
- **Armory / muster end-to-end**: enroll every tagger (USB PIN read, rename to the sticker, power-cycle, `armory` →
  `MAP=ok`), then muster with the config-all-then-spawn barrier and Station Arming for an objective mode.
- **Node keep-alive** across shade / short lock (foreground service); **reconnect backoff** ≥ 5 s after a gun-initiated
  `$DISCONNECT` (a fresh link comes up dead); **detect a power-cycled gun** (a `$SPAWN` echoing `$LCD,0,0,0,0,0,0`
  means the config was wiped: re-write the head).

## 11. Low ledgers (deferred, not blocking)

- **Code nits 2026-08-24:** `gsetdiff.py` rstrip strips all trailing commas; `btsnoop.py` assumes non-fragmented ACL;
  `command_name` strips a run of `$`; `send` vs `send_batch` reply-seq filters differ; `_fieldstart` prints
  "HOST DISCONNECTED" before the `finally`. Doc nits: standardise on 0-indexed tokens; Companion BOM total and pilot
  BLE cap wander within a doc.
- **MC build Lows 2026-08-25:** `store.py` commits per status envelope (consider `synchronous=NORMAL`); `recap` keys
  `post_end`/`parked` vs API.md `post_end_facts`; FFA winner with 0 kills / team-tie `tie` key in UI copy; `net.py` a
  never-applied seq >256 behind a newer live seq is dropped as replay; `time_req.t_node` oversize raises inside `_send`;
  UI allows `max_hp` 999, server caps 255; phone `pull_log`/`log_offer` unimplemented; `statusBody` omits `dropped`;
  `hit_taken` 1000 ms latch hardcoded; a stale-latch death reports the stale team; feed backlog not seeded from the
  snapshot; `lobby.all_acked` unused; `T.micro` contrast; PANIC copy is protocol jargon; fonts Google-hosted (self-host
  before a no-internet field); spec §3 prose says `damage`/`rof` are substituted into `$WEAP` (they are not).
- **HUD 2026-08-25:** top-right cluster cramped on device; a distinct no-cam layout (design pass, Tony owns visuals);
  a browsable per-match history view.
- **Design ideas parked:** directional hit mechanics on tok1 (backstab bonus, flank callout) after field-distance
  validation; a rocket description that couples to the default health block.
