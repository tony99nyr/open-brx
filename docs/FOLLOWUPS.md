# Followups — open work only

Updated: 2026-09-09. **Everything in this file is open.** Closed items are in
[`archive/followups-closed.md`](archive/followups-closed.md), verbatim and ordered by close date; the evidence
behind every row is in [`experiment-log/`](experiment-log/) (grep the id or the date). Session close = strike or
add rows here, one experiment-log entry, one HANDOFF banner. A fact goes to `protocol/` or `docs/manual/` in the
same commit, or it gets a row here saying "promote X".

**Ids.** One capital letter + number. Never renumbered, never reused. **Next free: B26 · D5 · E8 · F57 · G11 · H7 ·
K7 · P18 · Q20 · R3 · S16.** (2026-09-07: F40/F41/F42 went to the Python DRY review and the fake-tagger row; the A17 bench items were re-lettered to F44/F45/F46 the same day to clear a three-way collision -- three sessions read "next free" concurrently. F43 is the A17 method finding. The bold list above is the ONLY authoritative "next free"; do not restate a number here.) Renumbered once, on 2026-09-06, to end collisions: the HUD-review items formerly
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
- ~~**B9**~~ the manual website. Rebuilt 2026-09-09: plain-markdown source, 9 pages, 233-line generator, 18-step gate. Closed.
- **B25 🟢** the manual names one quantity two ways: `dev.md`'s `$WEAP` map calls **t17** `maxAmmo`
  ("always 2 x t40, or 32768 as an unlimited flag, not an independent knob") and **t40** `ammoReserv`
  ("reserve; 9999999 = unlimited"), while the published arsenal's "Reserve" column and the retired
  table both show t17 (AR 384 = 2 x t40's 192). Not a falsehood, and it matches the app's mags x clip
  presentation, but which token a player's "spare rounds" actually is has never been settled. One
  capture read with the operator counting real reloads would close it. `build`.
- **B24 🟡 Needs Tony** finish the deploy change: set the Cloudflare build command (Workers & Pages -> open-brx ->
  Settings -> Build -> Build command: `npm run build`), push once, confirm the deploy renders, then stop committing
  the generated files in `webapp/`. Until that setting exists, push-to-deploy serves what is committed, so the built
  pages stay in git. `build`.
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
- **B22 🟢** APK pipeline leftovers: minSdk/targetSdk can drift silently (record in `build.json`, assert on the page).
  The two site items are gone with the old generator: the link check is now a real browser crawl, and per-section
  stamps no longer exist. `build`.
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

- **F52 🟢** the A16.3 readout timings (lead 180 / blink-gap 80 / step 120 / blink 400 ms) exist in THREE places:
  **Narrowed 2026-09-07:** the fifth timing, `min_gap_ms` (400), was worse than the others — a hidden default in
  BOTH consumers and emitted by NEITHER, so retuning it at the bench would have changed nothing at all, silently.
  It is also the one that is a SAFETY knob (it is what holds automatic fire under the 3-light-ups-per-second
  ceiling). Now compiled by MC and documented in contracts A16.3. **The four below still carry fallback literals.**
  authoritative in `poolgauge.py` (`READOUT_LEAD_MS` etc.), and again as fallback literals in `engine.js` and
  `stage.py`. MC always ships them so the fallbacks are dead today, but if the numbers are ever retuned at the
  bench without touching both consumers, the fallback path silently disagrees — the same shape as the level
  rounding that DID diverge (Python banker's vs JS half-up, fixed 2026-09-07). Either drop the fallbacks and
  require the fields, or generate the consumers' copies. `build`.

- **F49 🔴 UNEXPLAINED, and it contradicts our reading of polarity.** Bench 2026-09-07, gun on `$TID,1`, armed by
  the stage, `$GSET` friendly fire OFF, one emitter, shots seconds apart: a shot claiming **team 1 (the gun's OWN
  team) REGISTERED** (armour 70 → 20, two hits), and a shot claiming **team 0 (an enemy) did NOT** (armour
  untouched, no `$HIR`), repeated twice each. That is backwards from protocol §5 — with FF off a same-team shot
  should be discarded and an enemy shot should land. Meanwhile the SAME team-0 word, fired from
  `tools/ff_ab.py` (which arms the gun itself), registered 24/24 and then 12/12 and then 4/4. So "team 0 fails"
  is real and reproducible through the stage's arm, and false through ff_ab's arm, with the gun's `$TID,1`
  identical in both. **Something other than the team field decides this and we have not found it.** Do not build
  on "FF is irrelevant" (F48) or on any polarity rule until this is explained: diff the two heads frame by frame
  on the wire (`$PSET` player_num differs: 1 vs 7 — the emitted word's player id is 42 in both), and re-run with
  each difference isolated. This cost most of an evening's bench time and produced four wrong diagnoses. `trigger`.
- **F56 🔴 A TEAM-COLOURED REST COLLIDES WITH THE POOL HUES — three of the four teams.** A16.4 (2026-09-09) made
  the gun body rest on the team colour. `TEAM_DISPLAY_COLOURS` is `{0: RED, 1: BLUE, 2: YELLOW, 3: PURPLE}` and the
  readout paints **armour PURPLE** and **health GREEN/YELLOW/RED**, so: **team 3's armour bar is the same hue as its
  own rest frame**, **team 2's mid-health band is**, and worst, **team 0's CRITICAL red is** — a red-team player's
  about-to-die bar is the colour their gun sits at all match. Only team 1 (blue) is clean, and blue is what the bench
  has been running on, so this would pass a hardware check and fail for three quarters of a real game. The existing
  collision guard (`presentation.py`, led-language §6 finding #3) covers EVENT BURSTS only — the readout bar has no
  such guard. Partly masked by motion (a drop opens with a lead freeze and an all-off blink, so there is a dark beat
  before the bar lands) but a SETTLED bar at the rest hue is genuinely ambiguous, and the shield/armour bars do not
  shift hue at all. **Recommended fix: rest DIM (token 5 = 1), readout FULL.** Brightness is global and otherwise
  unused by the bar, it separates every colliding pair at once, it makes the resting body unobtrusive (Tony's
  immersion brief and his own "the team color doesn't need to be static bright"), and it costs nothing — brightness
  is already a token on every compiled frame. Alternatives: move team 3 off purple and team 0 off red, or force a
  dark beat before every readout paint. `build`, then one bench look.
- **F55 🟡** `modes/driver.py:306` raises `RuntimeError: no running event loop` into stderr during test runs.
  `_play_burst`'s `finally` calls `asyncio.current_task()`, which raises once the loop is gone — i.e. when a
  still-pending burst task is garbage-collected after `asyncio.run()` closed the loop. The cleanup is then
  skipped (harmless at teardown, nothing left to clean) but **the traceback prints while the suite reports 0
  failed**, which is the F40 shape from the other side: noise that looks like a failure, in the output an
  operator uses to decide whether a run was good. It also means a real error in that `finally` would be
  indistinguishable from this one. Wrap the call: `try: cur = asyncio.current_task() except RuntimeError: cur =
  None`. Noticed 2026-09-07 while using the suite as a release gate; not fixed here because `modes/` is the
  game-driver lane's file and this is unrelated to A16. `build`.
- **F54 🟠** **the reload glance has no bench instrument.** `engine.js` has `_gunReadoutReloadGlance` (A16 §3.1:
  a reload repaints the current pool readout for `reload_glance_s`, 2 s day / 1 s night) wired to the reload path;
  `stage.py` has none, and says so in its own comment ("no reload path on the stage yet"). So the one behaviour a
  player triggers deliberately, to ask "how am I doing", is the one an operator cannot see on hardware. Everything
  else in A16.3 can be judged at the stage. It also interacts with the animation (a glance cutting a drop short
  now records the level, fixed 2026-09-07) and that interaction is exactly what is unobservable. Build a reload
  action on the stage page, or accept that this ships to players unverified. `build`.
- **F50 🟠** the A17 pain gate has never run in a REAL node path — only unit tests and grunts hand-played over
  BLE (brx-sound, 2026-09-07). The stage is now the only instrument that can exercise it, and any A17 audio
  judgement taken through the stage before `3388362` used the rejected shape-picked pools. Re-verify: an
  armour-absorbed hit stays silent, a hit that reaches HEALTH grunts, a hit that spills armour→health grunts
  (the innermost-moved-pool rule), and a lethal hit never grunts. `ears`.

- **F42 🟡** **the DRY-review backlog** (2026-09-07 Python review, agent team). Six bugs from that pass are FIXED
  and pushed; what is left is real but none of it is blocking. Evidence: every item below was measured, not read.
  **F42.1** `Compiler.cues()` carries THREE values that are unreachable — `presentation.cue_frames` overwrites
  `game_over`, `medal` and `multi` for the same resolved profile, so `cues()` is stale for them. No live impact
  (`state._push_voice_preview` reads only `kill`, which agrees). `game_over` is the interesting one: same VA33
  sound, different `$PLAY` token slot (token1 vs token4), so which is right needs an `ear`. Decide which table
  owns which key, then delete the loser. **F42.2** 12 bench tools hand-roll the body of `B.teardown_frames()`
  instead of calling it (~55-60 lines); `tools/f11_ab.py`, a one-shot experiment, is imported as a LIBRARY by 18
  scripts for `SENSOR`/`witnessed`/`word` — those three belong in `bench_common.py`. **F42.3**
  `tools/led_ingame_usable.py` reaches into `led_effects.py` through a hardcoded Windows UNC path and `exec()`s a
  slice of its source to borrow `record_roi`; a same-directory import replaces it. **F42.4** still zero-coverage:
  `ble.ConnectionManager` (monkeypatched everywhere, asserted nowhere), `protocol.py`'s pure helpers,
  `storage.py`, `btsnoop.py` (no malformed-capture case), `usbconsole.py`, `irbridge.py`, `mock_node`'s
  reconnect/persisted-fact ring, and ~85% of `__main__.py`. **F42.5** god modules unsplit: `state.py` 1665,
  `stage.py` 1319, `compile.py` 1163, `__main__.py` 1452 — seams and line ranges are in the review reports.
  **F42.6** smaller repeats: the mute rule 4x in `presentation.py`, the (primary, secondary, perk) unpack 5x in
  `policy.py`, `views.weapon_view` re-implementing `WeaponCatalog.hits_to_kill`, `net._send`/`_send_raw`,
  `_lan_ip` twice; in tests, the Session-builder `mk()` 5x and the API TestClient bootstrap 3x. **F42.7**
  `mc/armory.py:19`'s `gen` check is case-sensitive, so `"Gen1"` silently becomes `gen2_3` (pinned as current
  behaviour, not fixed); `mc/interfaces.py` documents `resolve_gun`/`evict` as "optional on fakes" but not
  `on_batch`, which `state.py` guards identically. **F42.8 DO NOT MERGE, for whoever runs the next pass:**
  `hitaudio.MATERIAL_POOLS["hit_hp"]` is `("",)` -- a deliberate empty id meaning SILENCE, not a missing
  value (health ships silent by bench decision 2026-09-07). `roll_material` tests `role in fixed` rather than
  truthiness, and `pset_foot` tests `v is not None`, precisely so a pinned `""` is not rolled over. Both read
  as defensive noise and are load-bearing: a truthiness "simplification" puts a sound back into a slot
  measured as better empty, and no test could catch it by inspecting output because the frame stays valid
  (pinned by `test_an_explicit_empty_pick_is_not_rolled_over`). Likewise `sir_table(..., class_sounds=False)`
  is a real behavioural default, not a flag awaiting cleanup: F38 proved `$SIR` REPLACES the `$PSET` pool
  sound rather than layering, so enabling it silences the material layer. The stock `$SIR` rows' empty sound
  tokens are what make the pool sounds audible, not a gap to fill. `build`.

- **F41 🟡** the FAKE tagger diverges from real hardware on SHIELD, and it produced a false bug report. Our compiled
  `$PSET` sets shield 70, and `fake.py` applies it on spawn and reports `$HP,hp,armor,70`. A REAL gun reports
  **shield 0** there and always has (every `$HP` captured on hardware 2026-09-07 is `…,0`; P16 — the shield pool is
  IR-only and not BLE-writable). Because the node zeroes its own shield tracking at spawn, the fake's 70 makes the
  first `$HP` of a life look like a 70-point pool GAIN, which nets out the real damage in the `before − after`
  total and swallows the first hit's reaction. **On a real gun this cannot happen**, so the stage/fake is a poor
  simulator for anything shield-shaped. Fix the fake to mirror P16 (accept the `$PSET` shield token but report 0
  until an IR grant), or the whole class of shield behaviour cannot be trusted at the bench. `build`.

- **F40 🟠** **"absence reports as health" — three instances in one evening (2026-09-07), so treat it as a class, not
  three bugs.** (1) `mcp/run_tests.py` aborted the whole run on one file's import error, so ~30 later files silently
  never executed while the totals still looked plausible; (2) an unmatched `$SIR` cell is silently ignored by the
  firmware (the F11 shape), so a mis-keyed hit sound is inaudible rather than an error; (3) `$HLED,,6` disabled the
  firmware's death flash for a whole life with nothing anywhere reporting it — three days of dark downed players.
  Add (4): **five bench tools ended every run on a bare `$CLEAR` with no `$SIR` restore** (F11 — the gun then cannot
  be hit until re-armed, which at the bench reads as broken hardware), and the guard that existed to catch exactly
  that, `test_bench_teardown.py`, could not see them because it only scanned `finally:` blocks while all five put
  their teardown in the body of `main()`. A safety net trusted precisely because it existed. Fixed by the refactor
  lane (AST scan of whole files, zero false positives across 66 tools, plus a regression test for the
  not-in-a-`finally` shape). Add (5) **the purest instance, and it is the DETECTOR**: `diag/cases.py` — the tool
  whose whole job is answering "can this gun be hit?" — shipped FIVE of the ten `$SIR` rows (no rocket, no melee),
  so it would sign off a gun that is deaf to three weapon classes; its docstring claimed the frames were kept in
  sync by hand. Fixed 2026-09-07 (`028cc4e`) by importing them. **And the same file still ends on a bare `$CLEAR`
  (`END = ("$STOP,*", "$CLEAR,*")`, cases.py:38), so running the diagnostic LEAVES the gun un-hittable** — F11,
  the very fault it exists to detect. **Corrected 2026-09-07 (`f25981e`): `cases.END` was DEAD code; the live
  fault was `diag/runner.py`'s inline `finally:` teardown, running after every diagnostic — worse, not better.
  And BOTH guards missed it for complementary reasons: `test_clear_safety` sweeps NAMED sequences, so an inline
  teardown was never in the sweep, while the dead `diag.END` sat on that file's ALLOWLIST legitimising the shape.
  The declared one was safe and the live one was invisible — the allowlist entry is what made the file look
  considered.** Fix: name-based sweep for deliberate sequences, AST code-scan for inline ones, over `brx_mcp/`
  and not just `mcp/tools/`.
  Add (6) **a new shape — the wrong value was individually VALID**: `FakeCompiler.cues()["game_over"]` was
  byte-identical to the real compiler's VICTORY frame and the fake had no `victory` key at all, so every `--demo`
  run (a RUNTIME path — `__main__.build()` falls back to that compiler whenever the real one raises on import)
  played the win sting to everyone at the whistle. Nothing about `$PLAY,VSF,4,6,JAY,,,,*` looks wrong on its own;
  only its RELATIONSHIP to the real table was wrong, which is exactly where no assertion was looking. Pinned as an
  inequality against the real compiler rather than as a literal, so it survives either id being re-picked by ear.
  Add (7) **the guard could not see a file that did not exist yet**: `test_no_headset_sticker_id_in_tracked_files`
  ran `git ls-files`, i.e. TRACKED ONLY. A new bench sheet carrying a sticker id was written, the suite was run
  and PASSED (the file was still untracked), and the leak entered the next commit — green precisely because the
  file was new, which is when a leak is most likely. Fixed 2026-09-07: `--cached --others --exclude-standard`, so
  a file is checked before it is added rather than one commit too late. Add (8): a known defect with no owner. White-on-white bursts were already written down as finding #3 (red-on-red)
  in `led-language.md` §6 and were never assigned, so a KNOWN bug was indistinguishable from an unknown one until a
  refactor lane rediscovered it. Add (9) **the clean-worktree re-check does not cover the app**: `origin/main` is
  re-verified in `/home/tony/brx-stage-head`, which has no `app/node_modules`, so the JS suite there cannot import
  `@capacitor-community/bluetooth-le`, loses `brxlink.test.mjs` whole, and prints "156 passed, 1 failed" on a commit
  that is green. The check reports a PYTHON result while reading like a full one. 2026-09-07 that number was briefly
  mistaken for a regression in the commit just pushed. Fix: `npm ci` in that worktree, or have the check say out loud
  which suites it ran. **Action:** when a probe can return "nothing", make the nothing loud — a runner
  reports a file that did not run, a compiler asserts its `$SIR` cells cover the weapons (done, A17), a light rule is
  pinned by a test that walks the reachable surface (done, `test_led_invariants.py`), and every finding in a review
  table carries an owner or an id.
  **The generalisation, and the real lesson of the night: A GUARD MUST STATE ITS OWN BLIND SPOT.** Four guards failed
  the same way and none was careless — each was correct for the place it looked. A `finally:`-only scan could not see
  five bench tools tearing down in the body of `main()`; a names-only sweep could not see the diag runner's inline
  teardown while a DEAD constant sat on that sweep's allowlist making the file look considered; and the new LED harvest
  walked two modules but not the third, where bundles are assembled, so the highest-value pin (effect 6) had a hole
  exactly where a real bundle is built. **A green result from a narrow guard is indistinguishable from a green result
  from a complete one.** So: every guard says in its docstring what it does NOT cover, and prefers asserting an
  INVARIANT ("one bundle must not carry two brightnesses for the same surface") over a VALUE a later retraction moves.
  `decision` + `build`.

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
- **Q15 🔴** sub-indoor IR power (Tony: indoor bounces register hits from everywhere). Lever 1 = `$WEAP` t41
  `gunRangeIndoor` (75 on all guns, 20 on melee) — **one prior positive, see `weapon-design.md` §5 U2**; lever 2 =
  `$GSET` t3 `gunLaserRegion`. `$IRTX`/`$HFIRE` emit nothing on v4.32. **Run sheet:
  [`bench-super-indoor-2026-09-07.md`](bench-super-indoor-2026-09-07.md)** (MacBook — the rig has never run on
  macOS; find the margin before sweeping). A null is an answer. If it works, an `indoor_tight` venue preset.
  `space` (bench 2.1).
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
  transient pool readout (SEVEN levels since A16.3) + bursts, headset role states that survive hits (carrier white, infected,
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
- **✅ F37 CLOSED 2026-09-07 — the `$PSET` slot order is the APK's.** hitHp / hitArrmor / hitShield sit exactly
  where the field list says; a voice line placed in the hitShield position was heard on a shield hit. An
  intermediate "the slots are SWAPPED" reading was published mid-session and RETRACTED: two different clips both
  read as "a computer sound" to the ear and the inference chain hung on that ambiguity. What killed it was a
  CONTROL (move one clip, watch the sound NOT change), not more reasoning.
- **✅ F38 CLOSED 2026-09-07 — `$SIR`'s sound REPLACES the `$PSET` pool sound; it does not layer.** Single-variable
  test: with a voice on `$SIR,0,0` only the voice played; silencing that token revealed the pool sound underneath,
  nothing else changed. CONSEQUENCE: per-weapon and per-pool audio compete for one hit and only one can speak.
  The class layer therefore ships OFF (`GameConfig.hit_audio_class`, default false) so the ear-confirmed material
  layer is audible; the stock rows keep the EMPTY sound token Callsign ships, which is what makes that work.
- **F44 🟠 `energyShieldLoop` needs a low hum.** BENCH 2026-09-07: `$PSET` position 7 is a REAL LOOP that runs while
  the shield is UP, survives a `$PSET` rewrite, and stops only on `$PLAYX,0,*` or the shield reaching zero.
  Callsign's stock `A10` is a geiger-ish tick and, because it loops, it played under every shield-band hit and made
  an hour of shield readings incoherent. It now ships EMPTY. Tony wants "a better low hum ... several halo shield
  sounds in many variety" — the whole `SW` family was auditioned and rejected (Star-Wars-style: lightsabers), and
  `C22`/`C23`/`C08`/`C10` are energy WEAPON charge-ups, not shields. Search `fx:scifi_fx` / `fx:retro_fx` on PITCH
  rather than centroid. Also decide whether we want a hum ON GRANT (this slot, one shot) or WHILE SHIELDED (a node
  loop with a stop when the pool empties — real work, a live BLE write in play). `ears`.
- **F39 🟡 The real `$SIR` row ceiling.** "Max 14 distinct IR recognitions per game" is a community figure we have
  never measured; `hitaudio.MAX_SIR_ROWS` treats it as a soft budget. Push a 20-row table and check every row still
  registers. Gates `hit_audio_rekey`, which is DEFAULT OFF. Lower value now that F38 has ruled the class layer off
  by default — the rekey only matters if we ever choose per-weapon audio over per-pool.
- **F45 🟡 Audit the four `$PSET` tokens nobody has ever heard.** `missShotHit` (`H06`), `emptyUnboundButtonSound`
  (`U15`), `ammoOrGearPickUp` (`W71`) and `hitCrit` (`H43`, a shape pick and a placeholder, not a choice) all still
  ship inherited or unaudited ids. `W71` fires on every ammo/gear pickup in a real game and no one has heard it.
  `H07`/`H09` were identified as bullet WHIZZ-BYS on 2026-09-07 and are the obvious `missShotHit` candidates. `ears`.
- **F46 🟡 Weapon accuracy and near-miss audio** (Tony's question, 2026-09-07: "does our hosted game implement the
  missed wizz shots? shot accuracy from holding the trigger?"). Answer today: NO. Accuracy exists only as a
  SCOREBOARD stat (`scoring.py`, hits ÷ shots); nothing degrades accuracy while the trigger is held, and it cannot
  be done host-side because the gun emits IR autonomously per pull. It would have to be `$WEAP` t21/t22 (APK-named
  accuracy), both in the protocol doc's UNVERIFIED list. Probe: flip t21/t22 on one weapon and count `$HIR` against
  `$ALCD` shots. If they gate the gun's own accuracy, the feature is: set the token, let the firmware miss, and the
  victim hears `H07`/`H09` go past instead of a hit. `trigger`.
- **F47 🟡 `get maxArmor()` turns an explicit 0 into 70.** `engine.js:195` is
  `(config.health.max_armor) || 70`, so a loadout that deliberately ships NO armour gets 70 instead. Two
  consequences: a no-armour class silently has armour, and A17.2's dropped `maxArmor > 0` guard could never
  have been false, so it was dead code the whole time it was relied on. Same truthiness family as F42.8's
  `role in fixed` / `v is not None` notes. Fix with `?? 70` (or an explicit undefined check) and then add the
  test that A17.2 could not write: a no-armour loadout must still get its low-health warning. `build`.
- **F48 🟡 A heartbeat pool for `low_health`** (Tony, bench 2026-09-07: "the heart beat sound could be used as
  a pool for low health"). Fits A17.2, which moved the alert to an actual threshold (HP under 15) -- a heartbeat
  says "you are nearly dead" in a way a hurt-breath loop does not, and `low_health` is once per life so a longer
  clip is affordable. NOT YET AUDITIONED and must not be picked by shape (F43). The catalog has no literal
  "heart" match; the shape candidates are the lowest-centroid pulsing clips in the bank -- `N74` (1.94 s,
  centroid 186, sustained), `N75` (2.86 s, centroid 201, varying) and `N25` (2.51 s, centroid 315) -- none of
  which any ear has heard. Today the event plays `voice:hurt_loop` (the character's own breathing, `V06`/`V16`/
  …), which could become a two-take pool with a heartbeat rather than being replaced. `ears`.
- **F53 🟡 `assert_sir_covers_weapons` checks a row EXISTS, never that its FUNCTION is right.**
  `compile._hit_entry` defaults an uncovered cell's `$SIR` function to 0 (`sir.get(cell, 0)`). Inert today
  -- every catalogued weapon's stock cell is in `_SIR_TABLE` -- but a future weapon on an uncovered cell
  with `hit_audio_rekey` ON would get its new row written with fn 0, silently changing its damage class,
  and the guard would pass. Either raise on an uncovered cell in `_hit_entry`, or extend the guard to
  compare each weapon's row function against the one it had before the re-key. `build`.
  (Filed as F49 first and re-lettered within the minute: another lane had taken F49 while this row was
  being written. Caught by `test_followups_ids_are_defined_exactly_once` -- the guard rewritten tonight
  after it was found to be scanning `## ` headings and seeing 1 id out of 89.)
- **F43 🔴 SOUND PICKS BY ACOUSTIC SHAPE ARE NOT TRUSTWORTHY — do not repeat the method.** Every id in the first
  `hitaudio.py` was chosen from `sound_catalog.json` by envelope / flatness / centroid / duration. NOT ONE survived
  a listen on 2026-09-07. Signal features separate TONAL from NOISY; they cannot separate METAL from ELECTRONIC
  (`H14` = a synth tone picked as the armour head), an IMPACT from a NEAR-MISS (`H07`/`H09` = whizz-bys picked into
  health), a PLAYER from a CREATURE (`H33`, `Z06`, `Z07`; `fx:splat` is a SIGNAL label, not a semantic one), or a
  clean clip from one with a cough tail (`H03`). Second trap: a RAPID AUDITION HIDES TAILS — `H03` passed a
  six-clip run as "metal" and failed instantly heard alone, because a sequence gives the ear each clip's onset and
  a hit sound is mostly tail. Confirm every candidate SOLO. The catalog's `speech_untrusted` transcripts are wrong
  too (`V116` is catalogued "Can't believe!"; on the gun it says "gained the lead"). This is the S1 ear-audit's
  real justification: 20-odd `fx:hit` ids now have by-ear meanings and the rest do not.
  **AND THE REASON THIS ROW EXISTS RATHER THAN A TEST.** There are two kinds of "individually valid, wrong in
  relation to something else", and only one can be guarded. Wrong-between-CODE-PATHS is testable: when a fake
  and a real compiler disagree, an assertion comparing them finds it (that is F42's `FakeCompiler` game_over
  bug, and how it was caught). Wrong-against-a-MEASUREMENT is not: a non-empty `hit_hp` id plays a real clip
  that sounds like a hit, and is wrong only relative to a bench result saying silence tested better. No
  assertion can reach that, because nothing in the repo disagrees with it -- the disagreement lives in an
  operator's ear on a particular evening. So the only defence is to WRITE THE REASON DOWN NEXT TO THE CODE,
  which is why `hitaudio.MATERIAL_POOLS` carries its rejections inline and F42.8 records reasons and not
  rules. A rule without its reason is the first thing a tidy-minded pass deletes, and it will be deleted by
  someone who is reading the code correctly.

**Trigger in hand** (one gun, our compiled game, Tony firing):**Trigger in hand** (one gun, our compiled game, Tony firing):
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
- **S10** L-ladder: **L1–L9 and L12–L14 ANSWERED 2026-09-07** (the `$LED` pulsing scheme is deleted, `$HLOOP` is
  the down signal; a dark paint with NO prior blank does not suppress the breathing, the blank IS idempotent, and a
  dim paint keeps its hue after a blank). ⚠ L14's frame as written in the ladder, `$GLED,3,3,3,5,10`, is now known
  to BLANK the gun — gate 5 is off, not a dimmer — so the dim rung is token 5 = 1 and it passed. **Left: (a)** a
  metered A/B of `$HLOOP,2,750` against a native out-blink (the "might be brighter" call was one operator, one
  session, no meter), **(b)** that rate's usable range (750 and 2000 both work, the ends are unknown), **(c)** L10
  dim 2-of-3 **held 60 s** — the render itself is confirmed, only the long hold is not, **(d)** L11 purple `$TID,4`
  ⚠ F35: never leave the gun there.
- Night mode: confirm a blanked gun stays dark once spawned (the S4 blank holds; only `$SPAWN` re-breathes).

**Ears:** **P3** voice-pack token; the defeat line (`JAW`/`JAX` beside the confirmed `JAY`); **W4a** Energy Launcher fire
sound (O01 ships; alternates O05 O02 O04 O06 O03) and, first, its zero damage (decision below); **S9**; **S1** audit;
**S-A12.1**; **D4** does "double kill" fire under our config (3 guns); **P15** alarm id.

**Space / tape measure** (receiver on a taped mark, no victim gun):
- 2.1 **Q15** t41 ladder, `ir-range` detect%/decode% — **superseded by the run sheet
  [`bench-super-indoor-2026-09-07.md`](bench-super-indoor-2026-09-07.md)** (Mac; margin first, closing control
  mandatory — a missing one spoiled U2). 2.4 **Q16** divergence at 3 m, 0/10/20/30/40/50°, taken in the same sitting.
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
