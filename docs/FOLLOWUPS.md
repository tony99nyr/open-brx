# Followups — open work only

Updated: 2026-09-10. **Everything in this file is open.** Closed items are in
[`archive/followups-closed.md`](archive/followups-closed.md), verbatim and ordered by close date; the evidence
behind every row is in [`experiment-log/`](experiment-log/) (grep the id or the date). Session close = strike or
add rows here, one experiment-log entry, one HANDOFF banner. A fact goes to `protocol/` or `docs/manual/` in the
same commit, or it gets a row here saying "promote X".

**Ids.** One capital letter + number. Never renumbered, never reused. **Next free: B30 · D5 · E8 · F98 · G11 · H7 ·
K7 · P18 · Q20 · R3 · S18.** (2026-09-10: F94/F95 taken — the phone control point (`spec/utility.md` §5d) and its LAN-coupled variant (§5e). 2026-09-10 evening: F83/F84/F85/F86/F87 taken — rotating-hill mode idea, the "constant
wider than the hill's period" generalisation, the double-`$HIR`-per-beacon dedupe finding (F85, closed same
session), the team-change-leaves-old-LED-colour finding, and the hosted hill rate-of-fire boost.) (2026-09-07: F40/F41/F42 went to the Python DRY review and the fake-tagger row; the A17 bench items were re-lettered to F44/F45/F46 the same day to clear a three-way collision -- three sessions read "next free" concurrently. F43 is the A17 method finding. The bold list above is the ONLY authoritative "next free"; do not restate a number here.) Renumbered once, on 2026-09-06, to end collisions: the HUD-review items formerly
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
- **✅ DONE (verified 2026-09-10) — the APK is out of git.** No `.apk` is tracked (`git ls-files` is clean)
  and `.gitignore:31` carries `webapp/download/*.apk`; only the `build.json` sidecar is tracked. Every build
  goes to the `app-v<version>` release via `npm run android:apk` (0.1.8 published 2026-09-10 from `cfe2a8e`).
  ⚠ The site publishes NO link to it: `site/build.mjs`'s `REPO_PUBLIC = false` strips repo links on all twelve
  pages, and the build FAILS if a manual page adds one back ("links the repository, which is private"). That
  guard exists because the site had shipped 404ing repo links on every page. Flipping `REPO_PUBLIC` is the
  one switch that restores them.
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
- **B26 🔴 Needs Tony at the bench** does a gun with NO headset fire in local (on-gun) play? `dev.md` says yes,
  citing Battle Company's V7 manual. `fix.md`'s ladder step 1, `hardware.md` and `operate.md` all say a gun whose
  headset is off, unpaired or flat refuses to join or fire at all, citing operators. Both are load-bearing and
  they cannot both be right. One gun, headset removed, try a local game. `trigger`.
- **B27 🟡 Needs Tony at the bench** is `$SIR` function 23 an audio-silence weapon? `sound.md` states it mutes the
  victim's gun audio for 6 to 8 s. `dev.md` records only that `$ALCD` token 2 drops 100 to 0 and recovers over
  6 to 8 s while the gun keeps firing, and marks token 2's meaning unknown. Take a fn 23 hit and LISTEN. `ears`.
- **B28 🟡** do guns talk gun-to-gun in phoneless games? `sound.md` and `gameplay.md` explain phoneless multikill
  lines as the guns sorting it out "over their radio mesh"; `dev.md` says flatly "nothing propagates gun-to-gun".
  The dev sentence is scoped to what a BLE host can observe. Either the mesh claim needs evidence or the dev
  sentence needs its scope written in. `capture`.
- **B29 🟡** voice pack: 16 slots or 17? `sound.md` gives a 17-row slot table confirmed on hardware 2026-09-07;
  `dev.md` says sixteen ids on the wire with the slot mapping unknown, and its own sample frame carries 16.
  17 declared field names against 16 wire ids is a real gap, not a typo. `capture`.
- ~~**B24**~~ deploy-time builds. **CLOSED 2026-09-09**: no dashboard change was needed. Workers
  Builds runs `npx wrangler deploy`, which runs `[build]` in `wrangler.toml` (`npm run build:ci`),
  so Cloudflare regenerates the site from `docs/manual/*.md` on every push and the built pages are
  now git-ignored. Proven by a source-only push with stale output, and by a clean-clone rebuild.

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
  station words do nothing in a host-driven game (2026-09-04). ⭐ **WHY they do nothing is now known (2026-09-10): our
  compiled `$SIR` table ships no protocol-15 row, so the firmware discards every station word in silence. One row
  (`$SIR,15,0,,24,...`) makes them arrive as `$HIR` -- proven on a gun, see F70.** That removes the "can we even
  hear a station" unknown from this design; what is left is the assembly. Design: on `$HP,0` re-spawn stunned (F15) ≥ 3 s later,
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
- **F56 🟠 HALF CLOSED 2026-09-09 ON THE GUN — the DAY half is fixed and verified, the NIGHT half stands.**
  Fix shipped: the in-play rest is the team colour at brightness 1 while the readout paints at full, so
  brightness separates them. Tony, watching purple armour over the dim blue rest: *"way brighter, reads as an
  event"*. ⚠ **At NIGHT both rest and readout are dim**, so that separation does not exist and the hue
  collision below is live on a SETTLED bar. A drop still reads at night (it opens with an all-off blink and
  the steps carry the change); a bar that has already settled does not. Night was verified as READABLE on
  blue team, which is the easy case — **the untested bad case is team 3, whose colour IS armour purple.**
  The collision itself, unchanged and still true at night: A16.4 (2026-09-09) made
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
- **F59 🟠 ON-GUN AUDIO LAGS THE LED BY ABOUT A SECOND, AND IT IS NOT OUR SCHEDULING.** Tony, bench
  2026-09-09: *"the leds update on the gun and then a second later there is the hit sound ... the delay is
  weird"*. Measured on one hit, stage enqueue timestamps: `$HIR` and `$HP` at +0.000s, **`$PLAY` at +0.000s
  (FIRST)**, then the first `$GLED` also at +0.000s, the rest of the animation following. So the node sends the
  SOUND BEFORE the light; the gun renders the light immediately and starts the clip ~1 s later. **Reordering on
  our side cannot fix this** — that was the obvious first theory and the measurement kills it.
  Two candidates left, and they want different fixes: firmware audio latency after `$PLAY` (nothing we can do
  except stop pretending the two surfaces are simultaneous), or LEAD-IN SILENCE in the clips themselves (fixable
  by picking or trimming ids). A17 already knows the bank has tail problems -- `H03` passed a rapid audition and
  failed heard solo because a hit sound is mostly tail (F43) -- so a lead-in is entirely plausible and has never
  been checked. **Measure it before theorising**: play one clip with the receiver capturing, and time the gap
  between the `$PLAY` write and the first audio. If it is the clips, the fix is id selection; if it is the
  firmware, the LED language should stop assuming light and sound land together.
  Owner: the audio lane (A17). Found by the LED lane, and the LED side is not at fault. `ears`.
- **F58 🟠 HEALING HAS NO FEEDBACK ON ANY SURFACE, and the two consumers disagree about it.** Tony, bench
  2026-09-09, after a real `$LIFE` heal took hp 6 → 25: *"it made a health hit sound. the sound wasn't heal"*.
  Three separate holes, found together:
  **(a)** `presentation.py:84` ships `healed` with `sound=None, gun_led=None, headset=None`. It is a registered
  event with NOTHING attached, so even where it fires it is silent and unlit. Same for `armour_up`; `shield_up`
  at least has a paint. So being healed is, by configuration, indistinguishable from nothing happening.
  **(b) DIVERGENCE:** `engine.js:1560` fires `healed`/`armour_up`/`shield_up` on a pool RISE. `stage.py` fires
  none of them — zero occurrences of `healed` in the file. So the bench instrument cannot exercise the heal
  path AT ALL, which is why this went unnoticed: the surface built to predict the phone is missing the branch.
  That is the eighth stage-vs-phone divergence in a week (see [[stage-must-mirror-the-phone]] reasoning in
  `experiment-log`), and the first one where the STAGE is the side missing a feature rather than mis-copying it.
  **(c) ✅ RESOLVED the same evening, and it was NOT a bug — recorded so nobody re-opens it.** The LED gain
  animation DOES step correctly on the gun: a `$LIFE,20` heal at hp 4 gave `$HP,24` and the strip wrote
  `RED · ·` (L1) → `yel · ·` (L2) → `yel yel ·` (L3), stepping up with the hue warming red → yellow as it rose.
  It reads exactly as intended. The earlier run that appeared to SNAP had both `$HP` frames land on the SAME
  timestamp (the heal readback and the 1-damage shot used to force it), so the second change cancelled the
  animation and retargeted from current, collapsing it to one write at the endpoint — which is the correct
  cancel-and-retarget rule, not a fault. The original observation is left below for provenance:
  the LED gain animation did not step on the gun in the FIRST run — one write straight to the settled level,
  where the drop animates properly. The gain path is CORRECT in isolation (driven offline it writes L1, L2, L3),
  so the live difference is unexplained. Two `$HP` frames arrived back to back (`$HP,26` from the heal readback
  then `$HP,25` from the 1-damage shot used to force it), and the interaction of a gain immediately followed by
  a small drop is the obvious suspect — but that is a hypothesis, not a finding. Needs an instrumented test of
  back-to-back opposite-direction changes, NOT another bench evening of guessing.
  Tony's brief, 2026-09-09: *"healing should also animate intuitively without distraction"*. Today it does not
  animate, does not sound, and cannot be rehearsed on the bench. `build` + `ears`.
  **(d) `$LIFE` is INCONSISTENT on hardware and S14 depends on it.** `$LIFE,20,0,0` healed twice (hp 6 → 26,
  and hp 4 → 24). `$LIFE,25,0,0` from hp 5 did NOTHING — the frame was confirmed sent (the stage logs
  "UNKNOWN command sent on explicit confirm" then the tx), the pool never moved, and a readback showed the
  value unchanged. Both were additive and far under the 45 max, so this is not clamping. A per-grant cap
  somewhere between 20 and 25 is the obvious guess and is UNTESTED. **S14's whole design is MC composing
  `$LIFE` for a remote gun**, so a grant size that silently does nothing is a real risk to that feature and
  wants a proper sweep (walk the value 1..45 and record which land) before S14 is built on it.
  ⚠ Method note for whoever picks this up: `$LIFE` is NOT on the known-safe list, so `raw` refuses it unless you
  pass `confirm=true`. Two silent refusals cost 20 minutes tonight and nearly produced a false finding that
  `$LIFE` does not heal — which would have undermined S14, whose whole design is MC composing `$LIFE`.
- **F60 🟡 NO COMPILED GAME CAN RECEIVE A HEAL OR A SHIELD.** Checked all five modes on the gun 2026-09-09:
  `medic` reports `registers: False` in tdm, ffa, infection, lms AND extraction, i.e. no compiled `$SIR` table
  carries a proto-1 row, so a medic word is discarded by the firmware with no error (the F40 "absence reports
  as health" shape). Fired at a live gun it produced no `$HIR` and no pool change at all. `fn 10` is a KNOWN
  heal and `compile._SIR_GRANT` is fns 9-22, so the row is buildable — nothing ships one. Consequences: the
  shield pool (IR-only, P16) can never be filled in one of our games, so the TEAL shield bar and A16.5's
  shield → armour handover are unverifiable on hardware; and the `healed`/`armour_up` events (F58) can never
  fire from IR either. Decide whether a heal/grant row belongs in the compiled table at all — it may be that
  we simply do not want medic words in a hosted game, in which case say so and mark shield permanently
  node-granted — but today the gap is silent and looks like a bug from the bench. `build`.
- **F64 🟢 CLOSED-AS-WRONG 2026-09-10 — a host-inflicted kill is NOT invisible; the node books it.** Filed 🔴 on
  the strength of a real measurement (a lethal `$LIFE` emits `$LCD,0,0,0,0,32,192,*` and never `$HP,0,0,0`, with a
  same-session IR-death control that emitted BOTH) plus a reading of the code that was simply wrong. I checked
  `_onHp`, saw death booked from `$HP`, and never read the `$LCD` handler. **`engine.js:1264`, inside
  `case 'LCD'`, is `if (this.phase === 'live' && this.hp === 0 && this.alive) this._death(wasResync);`** — a
  zeroed `$LCD` books a death directly. `stage.py:1059` routes `cmd in ("HP","LCD")` through the same
  `_on_pools`, which books death at `hp == 0` too, so the two mirrors agree. **The wire fact stands and is worth
  keeping** (the frame shape really does swap on a lethal host write, which is why `protocol/brx-protocol.md`
  documents it); what was wrong was the consequence. Caught by a code-impact reviewer, not by me.
  ⚠ **Two residuals.** (1) The `$LCD` death path skips `_onHp`, so a host-inflicted kill books the death but
  produces no `hit_taken` fact and no damage attribution — fine today because nothing inflicts one, but S16
  (damage-over-time) must decide who gets credit for a tick that kills. (2) ⚠ **The correction itself is a CODE
  READ, not a bench replay.** The reviewer who caught it flagged this and is right: we have the real frame from
  the bench (`$LCD,0,0,0,0,32,192,*` from a lethal `$LIFE`) and we have code that would handle it, but the two
  have never been put together — that frame arrived in an MCP session, with no engine or stage consuming it. Given
  that this session produced three retractions from exactly this kind of inference, replay the captured sequence
  through `stage.py` and the phone engine before treating "the node books it" as proven. Cheap: the frame is in
  the 2026-09-09 log.
- **F65 🟢 `$BUMP` is inert on v4.32 — is that the command or our shape?** Bench 2026-09-09: `$BUMP,-5,0,0,*` on
  full HP and `$BUMP,0,5,0,*` on armour at 61 both did nothing, with the read validated either side (a real IR hit
  moved the pools and `$QUERY`'s `$LCD` tracked it). `$LIFE` with the identical arity worked in the same session, so
  this is not the connection or the arming. `brx-protocol.md` now says INERT. Open only as: does `$BUMP` want a
  different arity, a different game state, or is it dead firmware? Low value — `$LIFE` covers the need. `trigger`.
- **S16 ⬜ Damage over time, on the node** (unblocked by the 2026-09-09 bench). `$LIFE` takes negatives, so
  poison / burn / bleed / gas are buildable with no firmware change and no IR per tick: the gun registers the
  proc once (a status cell, fn 8/24-28/35 — `$SIR,9,3,,24` already ships), the node reads the protocol off `$HIR`
  and runs the tick clock itself. Three things the bench pinned that the design must respect: a negative is
  **per-pool with no spill**, so the node walks shield → armour → health itself; the pool **floors at 0**, so
  overkill is silent; and a lethal tick emits **no `$HP`**, so the node books it via the `$LCD` path (F64, which was filed wrong and corrected) but produces **no `hit_taken` fact and no attribution** — S16 must decide who gets credit for a lethal tick.
  Also needs: who gets the kill credit for a tick, whether a DoT survives a respawn, and what the HUD shows while
  it ticks. Needs a spec section before code. `build`.
- **F62 🟡 `$WEAP` t6 `primaryCritChance` — can we emit crits?** The crit bit reads 0 on every stock weapon,
  "not dead, just never set", and t6 would be a per-shot firmware roll. Design already written in
  `bench-weap-tokens-discovery-2026-09-04.md` §t6 (~10 min): t6 0 → 100 → 50 → 0 with `$GSET` t7=100 so a crit
  exactly doubles; read `$HIR` tok6 and 9-vs-18 damage. Also the cheapest proof that the firmware rolls dice
  per shot at all, which is what F46 and F63 both assume. `trigger` (bench C2).
- **F63 🟡 `$WEAP` t7-t11, the secondary-fire block — a per-shot damage type?** `secondaryFireChance`,
  `secondaryDamageType`, `secondaryPowerType`, `secondaryDamage`, `secondaryCritChance`: **empty on all 20
  captured stock frames.** If t7 is a per-shot percentage that swaps the emitted `<protocol, subtype>` to the
  secondary pair, it is the ONLY way to vary a shot's damage type per trigger pull — the host cannot, because
  the gun emits autonomously on the pull. That unlocks proc weapons (a poison round on 15% of shots) and is the
  one route to a "miss" token besides F46. Probe on the RIG, counting words by protocol (aim t8/t9 at a free
  protocol: 4, 5, 7, 12, 14), and check whether `$GSET` t6 `secondaryBluetoothWeapons` gates it. `trigger` (bench C3).
- **W4a ⬜ Energy Launcher fire sound — bench audition.** `O01` ships; alternates `O05` `O02` `O04` `O06` `O03`,
  all fitting the 1600 ms cycle. Wanted: an ordnance report, not a music sting. **This row exists because W4a had
  no definition anywhere in this file** — it was referenced in §9's Ears block while its only definition sat in
  `archive/followups-closed.md`, which itself said it was "carried as an open ears item". `test_followups_ids_are_
  defined_exactly_once` cannot catch that: it flags an id defined TWICE, never an id referenced with no definition
  at all. ⚠ The launcher's zero damage (`$SIR,9,3,,24` is a status row) is the bigger problem and is a decision,
  not an audition. `ears` (bench B4).
- **F57 🟠 THE LOW-HEALTH WARNING AND THE PAIN GRUNT FIRE IN THE SAME MILLISECOND.** Bench 2026-09-09, Tony:
  *"the critical sounds are a bit bugged when it was at 1 red"*. Captured on the wire, one `$HP` tick:
  `rx $HP,8,0,0` → `tx $PLAY,,4,6,VA6` (low health) and `tx $PLAY,,4,6,VAG` (pain short, 10 dmg) at the SAME
  timestamp, 2244290.79. The gun plays one clip at a time, so they cut each other off. Every earlier hit that
  life fired the grunt alone, because A17.2 arms `low_health` only under 15 HP — so **the collision happens
  exactly once per life, at the moment the warning is the whole point.** The LEDs at that instant were right
  (red, blinking to dark, the critical state); it is only the audio.
  A17 already owns the concept needed to fix it: the pain gate is "one per 600 ms and never on the lethal
  hit". This is the same class — two cues competing for one speaker — and wants the same kind of rule.
  Shape, undecided: either suppress the pain grunt on the hit that crosses the threshold (the low-health line
  IS the reaction to that hit, and a grunt adds nothing the player does not already know), or sequence the
  warning after the grunt by the grunt's own length. The first is simpler and matches the never-on-the-lethal-
  hit precedent. **Owner: the audio lane (A17 is brx-sound's).** Found by the LED lane while walking the bar
  state by state, so nothing here is an audio judgement — just the capture. `ears`.
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
- **F12 🟠** (raised from 🟡 2026-09-09) ⚠️ **the STITCH is not just lossy, it INVENTS parity-valid words.** Rig
  qualification 2026-09-09, a real gun firing a known word (`proto=0 player=0 team=1 mag=9 sub=0`): every whole
  read was correct, but the ambiguous stitches each offered a second candidate that ALSO passed parity —
  `proto=4`, `proto=1`, `mag=137`, `mag=41`, `sub=1`, `sub=2`, `player=16`. Those are the exact fields F46
  (magnitude 0) and F63 (protocol) measure, so an ambiguous stitch manufactures the signal. Only **7 of 45
  bursts** were whole words, so this is the common case, not the edge. Until the firmware assembly bug below is
  fixed, any word-content experiment must count `WORD`/unambiguous-`STITCH` lines only, and prefer a count
  ("did a word arrive") over a decode where it can. Original row: the VS1838B capture firmware splits one frame into 2–4 pieces (a real gun 3/44
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
- **F27 🟡** (was F16) reload takeover timing: time `$BUT,2` → `$ALCD` per weapon; correct `weapons.json` **`reload_ms`** (there is no `reload_s` field; the old name here sent a bench pass looking for a key that does not exist). `trigger` + `ears`.
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

**The running order is [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md)** — the same items
grouped by SETUP BLOCK with the exact command, reading and control per rung, plus the four traps that
fake a result (`firemode_probe`'s raw-vs-doc token index; `tutorial_frames` shipping one `$SIR` row and
`$BMAP,0,0` only; and that it disconnects, so it cannot read `$ALCD`). This section stays the register:
ids live here, order lives there. Items below marked ✅ or superseded are kept only until the next
session-close strike.

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
  **`H06` IS ANSWERED (bench 2026-09-09):** fired a magnitude-0 IR word at a gun armed with our `$PSET` and Tony heard it by ear -- `H06` is a bullet near-miss and it is correctly placed in `missShotHit`. It is also now reachable in a real game for the first time (F46 proved a miss exists). ⚠ Spaced misses play it every time; three fired back-to-back played it once, so there is a rate gate or a batch collapse (F67). Still open here: `U15`, `W71` and `H43`. `ears`.
- **F68 🔴 A MISS PERMANENTLY KILLS THE HEADSET TEAM COLOUR.** Bench-observed 2026-09-09, Tony watching a gun painted
  blue: a magnitude-0 word makes the headset **flash green exactly like a hit and then go dark, and it stays dark**. Same
  mechanism as the 2026-09-03 "a registered hit WIPES the headset" finding -- but a miss emits **no `$HIR` and no `$HP`**
  (F46), and our repaint lives inside the `dmg > 0` branch (`engine.js:1494`, mirrored `stage.py:1101`), so the node never
  learns and never repaints. **Consequence: the first miss of a life removes that player's team identity until the next
  real hit or respawn** -- and A16.4 deliberately rests the GUN body on team colour for exactly the identity reason the
  headset just lost. Invisible today only because misses cannot happen at stock 100/100, so this ships the moment S17
  does. Fix needs a trigger that does not depend on damage: the node cannot see the miss at all, so either repaint on a
  timer/heartbeat while alive, or accept a dark headset and move team identity entirely to the gun body. **Also worth
  knowing for gameplay: a miss is VISUALLY IDENTICAL to a hit** (same green flash), so no observer can tell them apart. `build`.
- **F69 🔴 A GRENADE HILL DAMAGES AND KILLS PLAYERS IN OUR GAMES TODAY, AND MC CANNOT SEE WHY.** Bench
  2026-09-10. A grenade in HILL mode emits **two** words on the same ~5 s cycle: a beacon
  (`proto=15 mag=8`, team = the OWNER) and a **standard damage word (`proto=0 mag=8`)**. Our compiled table
  has no proto-15 row, so the beacon is discarded silently -- but `$SIR,0,0,,1` is our ordinary damage row, so
  **the damage lands in full**. Measured: a player flipped to the non-owning team was killed by an unattended
  hill in ~106 s, 8 damage a tick, 70 armour + 45 HP to zero, with no host involvement and nothing in the
  event stream naming the cause. Anyone who brings a grenade in hill mode to a match today gets unexplained
  deaths. Either ship the proto-15 row (see F70) so the node can name it, or document the hazard loudly.
  ⚠️ **It was WORSE than "cannot see why", and that half is now fixed (2026-09-10).** The hill's damage word
  carries **shooter wire id 0**, and nothing in the attribution helpers enforced A5.1's "wire 0 is never a
  player". So the word was stored as `_last_shot`; `ATTRIB_FUSE_S` (6 s) is WIDER than the hill's ~5 s period,
  so the attribution never went stale; and `_handle_death` ran `team_score[owner] += 1`. **The hill was
  crediting its owning team with kills.** `shooter_team()`/`shooter_player_id()` now return `None` on wire 0,
  covered by `test_a_hill_that_kills_you_scores_for_nobody` plus a real-shooter control. The suite could not
  see this because every fixture defaulted the shooter's wire id to 0 (see the log). **Still open: the DAMAGE
  itself.** Players are still killed by an unattended hill — and **"nothing names the cause" turns out to be too
  kind: the victim's phone names the WRONG team as the killer (F81).** `build`.
- **F70 🟠 KING OF THE HILL IS A NATIVE PRIMITIVE, FULLY MAPPED, AND WE CAN READ IT WITH ONE ROW.**
  **The wire, bench 2026-09-10:** neutral hill beacons `proto=15 team=2 mag=8` every ~5 s. Shoot it with a gun
  and the very next beacon carries THAT GUN'S TEAM: a red gun (`proto=0 player=5 team=0 mag=22`) fired at
  07:59:58 and every beacon from 08:00:01 onward read `team=0`, held for ten straight beacons. **Neutral is
  team 2** — which means an earlier capture the same night labelled "hill-neutral" reading `team=1` was in fact
  a hill already OWNED by blue, and any inference from "neutral = team 1" is void.
  ✅ **SETTLED 2026-09-10: CAPTURE IS CHARGE. Any weapon can take a point.** The extra-headset hypothesis is
  DEAD and was never needed. Clean run, our config throughout: a NEUTRAL hill (`team=2`) was claimed by **one AR
  round** (`proto=0 team=1 mag=9`), leaving it holding ~9 of charge; the shooter was then re-armed RED and
  emptied a magazine at it, and the **first beacon 2.3 s later already read `team=0`** (13 AR rounds on the air),
  staying red for the remaining 48 s. **A weapon with NO extra-headset block retook an owned point.**
  This matches `reference/grenade.md`'s prior hardware-confirmed charge mechanic, and Tony's own observation that
  in native play every player captures the hill regardless of weapon — which is what a three-weapon mechanism
  could never explain. Last night's shotgun-vs-AR result was never evidence for a headset word: one shotgun word
  is 70 of charge against four AR rounds at 36, so it simply out-charged it. Two variables differed and I picked
  the wrong one, for the third time in one session.
  🟡 **THE EXCHANGE RATE LOOKS 1:1, AND "LINEAR" IS A WORD I SHOULD NOT HAVE USED (2026-09-10, one-round-then-wait
  protocol).** Downgraded from ✅ on review: it rests on **TWO POINTS**, and two points define a line by
  construction, not by measurement. Nothing here separates 1:1-linear from any curve through (1,1) and (5,5).
  Seed 20 and see whether it still costs 20 before anyone builds an economy on the rate. The DIRECTION —
  more charge in costs more to take back — is solid; the RATE is one hypothesis that fits two readings. Against hills seeded from
  a power-cycled neutral with a known number of AR rounds, contested one round at a time with a beacon read
  between each: **seeded 1 → retaken with 1; seeded 5 → retaken with 5** (both counts confirmed on the wire by
  `$ALCD`, 32→31 and 32→27). Charge ACCUMULATES and costs the attacker exactly what the defender invested. That
  is a self-tuning objective: a lightly-touched point flips instantly, a defended one is genuinely expensive, and
  **a mode needs no host rules to make holding a point meaningful**.
  🟠 **THE CURRENCY IS MAGNITUDE, NOT ROUNDS (2026-09-10) — n=1, CONFOUNDED, AND F76 CONTRADICTS IT.**
  Downgraded ✅ → 🟡 → 🟠 across two review passes, and the second downgrade is the damning one.
  ⚠️ **THE DISCRIMINATING TRIAL CHANGED TWO VARIABLES.** The shotgun's `mag=70` is, in this session's own
  words, *"the shotgun's `t12` extraHeadsetDamage, not its `t5` of 45"* — an **extra-headset word from a
  `t1=2` weapon**. So "5 AR rounds (45) lost to one shotgun shell (70)" varied magnitude AND weapon-block
  together, and it cannot separate *"magnitude is the currency"* from *"an extra-headset word captures out of
  proportion"* — **the very hypothesis this entry declares dead, and the fourth two-variable comparison in one
  session.** The AR magdump retaking an owned point does kill "capture REQUIRES an extra-headset word"; it does
  NOT establish what the exchange is priced in. **The clean experiment nobody has run: a HIGH-MAGNITUDE word
  from a non-`t1=2` weapon** (rocket is also t1=2 — use a boosted AR via `$WEAP` t5). Until then F76's
  contradiction has a candidate resolution that fits every reading, which F76 did not list: the per-weapon
  counts could be right for ordinary rounds while the three extra-headset weapons capture disproportionately —
  and `reference/grenade.md`'s own *"a thrown grenade blast instantly captures 100%"* is that same shape. Seeded 5 AR rounds (45), then ONE shotgun shell
  (`mag=70`) retook it — confirmed on the wire, `$ALCD` 6→5, one shell against a hill holding 45. Every reading
  now fits a single rule: **charge accumulates and the ATTACKER WINS TIES.**
  ⚠️ **Not "the higher total owns the point" — this entry's own table falsifies that.** Both AR flips landed at
  EXACT EQUALITY (9 v 9; 45 v 45, "flipped on the 5th"), and a strict *higher* rule predicts neither. The only
  strictly-greater run is the confounded shotgun one. So what is measured is **`attacker >= defender` flips**;
  whether a strict majority is ever required has never been tested.
  | seeded | contested with | totals | result |
  |---|---|---|---|
  | 1 AR (9) | 1 AR | 9 v 9 | flipped |
  | 5 AR (45) | 5 AR | 45 v 45 | flipped on the 5th |
  | 5 AR (45) | **1 shotgun (70)** | 45 v **70** | **flipped on one shell** |
  This also explains 2026-09-09 with nothing left over: the shotgun's `mag=70` word out-charged what was in the
  hill while four AR rounds at 36 fell short. It was always charge. **Design consequence, and it is a good one:
  a weapon's capture power EQUALS ITS DAMAGE, automatically.** A shotgun or rocket seizes a point in one hit, a
  rifleman needs a burst, and a defended point costs an attacker exactly what the defender invested — a coherent
  objective economy falling straight out of the weapon balance we already tune, with no separate capture stat and
  no host rules. ⚠ Still unmeasured: the MAX charge (does a hill cap, and how long does a full one take to build?).
  **Original entry:** Bench 2026-09-10, and it
  answers `bench-grenade.md` Q3 ("does a spawned gun in one of our games surface grenade beacons if we give it a
  `$SIR` row for protocol 15?") **YES** -- adding `$SIR,15,0,,24,0,0,1,,*` made the hill beacons appear
  immediately as `$HIR,<sensor>,15,0,<owner>,8,0,0` with no pool change. ⚠️ **But "one row" is NOT the whole fix: `app/src/engine.js:1273` drops every `$HIR` with proto 15 before the phone sees it** (`if (t[2] === '15') break;`). The row makes the GUN report beacons; the PHONE still discards them (F72). The whole mechanic is native: **shoot
  the grenade to capture it** (the gun announces "hill captured"), the **owner team rides in the beacon's team
  bits**, **holding it plays a looping tick** on the owner's gun, and an **enemy-held hill damages intruders**
  (F69). Magnitude is the mode: **8 = hill, 6 = respawn**, and the periods differ (5 s vs ~2.5 s). So KotH,
  Domination and respawn points are available with a $30 grenade, one table row and no station hardware -- Tier 1
  of the mode catalog, unblocked. Node work: read the beacon, track the owner, drive the scoring. ⚠ Polarity: fn
  24 is enemy-only, so a gun sees only hills it does NOT own unless `$GSET` t1 = 1; decide how to read your own
  point. ⚠ And pick the row's `<soundID>` deliberately: a hit lands every 5 s for as long as anyone stands
  there. `build`.
- **F82 🔴 A HILL MODE MUST NOT PUT ANYONE ON TEAM 2, AND NOTHING IN MC STOPS IT.** Found in review 2026-09-10,
  falls straight out of F70 and was never written down. **A neutral hill broadcasts team 2.** The firmware's
  polarity gate compares that against the receiving gun's own `$TID`, so a roster that contains team 2 reads
  every NEUTRAL point as its OWN: those players go deaf to neutral hills under an enemy-only row, and the
  `proto=0` damage word that punishes intruders **cannot land on them** — team 2 gets free run of every
  uncaptured point while everyone else is contested. **MC's team assignment must skip 2 for any mode with a
  hill** (use 0, 1, 3 — and remember tids 4-7 are colours, not teams, per `$TID`), or the mode must run
  `$GSET` t1 = 1 and resolve ownership in software instead of leaning on the gate. ⚠ Untested — this is
  predicted from the polarity rule plus "neutral = team 2", both of which ARE measured; rung D would show it
  directly. `build` + `bench`.
- **F88 🟡 THE HILL BRIDGE DRIVES ONE POINT ONLY, SO MULTI-POINT DOMINATION IS STILL BLOCKED.** Opened
  2026-09-10 alongside the KotH build. A grenade beacon carries **no station id** — `$HIR,<sensor>,15,0,
  <owner>,<mode>,0,0` says who owns *a* point and which MODE it is, and nothing distinguishes one grenade
  from another. So `hillbeacon.py` drives `sites[0]` and KotH (one point) works, while **Domination with 2+
  points cannot be built on grenades at all**: two hills in range are indistinguishable, and their beacons
  would fight over the same site. Domination needs either a station source that names its point, or a way to
  tell grenades apart on the wire that we have not found. ➡ **The station source is specified: `spec/utility.md`
  §5d / F94.** A phone control point's advert carries its station id in bytes 6-7, so several of them are
  distinguishable by construction, which is the thing a grenade can never be. ⚠ Do not "fix" this by inferring identity from
  timing or magnitude — magnitude is the MODE (8 hill, 6 respawn) and the period is fixed at 5 s, so neither
  carries identity. `build` + `bench` (is there ANY per-device field? check a two-grenade capture).
- **F89 🟢 THE STATION `$CAPTURE` PATH CANNOT HAND A POINT TO TEAM 0.** `objectives.py`'s `_team()` treats a
  zero team as malformed, which is correct for the station path it was written for but means an explicit
  `config.teams` override putting a player on tid 0 in `domination`/`cs`/`ctf` silently cannot score. **Not a
  live bug and deliberately not fixed:** `assign_teams` never returns 0 for any of those modes (ffa/extraction
  use `i+1`, infection/survival 1/2, domination/koth 1/3, else 1/2), and MC's `MODES` catalogue does not list
  domination/koth/ctf/cs at all, so tid 0 is reachable only by hand. Recorded so nobody "fixes" it later
  assuming it is reachable by default — and so nobody routes BEACONS through `_team()`, which WOULD break:
  a beacon's team 0 is genuinely red, bench-captured 2026-09-10 taking a blue-held hill. `build`.
- **F90 🟢 THE HILL SOUND CONSTANTS LIVE IN THE WRONG FILE.** `HILL_CONTESTED`/`HILL_LOST` were put in
  `modes/hillbeacon.py` because `sounds.py` was being edited concurrently. They belong in `sounds.py` with
  every other grounded cue — `test_engines_use_catalog_not_raw_ids` exists precisely to stop raw ids leaking
  into engines, and this is a near miss. Move them and cross-check the ids against the by-ear results
  (`VB0N`/`VB0O`/`VB0P` confirmed 2026-09-10; ⚠ `V8Q` is "**Kill** Confirmed", never a hill line). `build`.
- **F91 🔴 BENCH: MOVE OUR WEAPONS OFF IR PROTOCOL 0 SO A HILL'S CHIP DAMAGE VANISHES.** A grenade hill
  emits an ambient `proto=0 sub=0 mag=8` damage word that our `$SIR,0,0,,1` row applies in full (F69), which
  punishes the ATTACKER and is the one hardware fact working against a push-the-objective mode. It cannot be
  switched off while our weapons share that cell. **But `$WEAP` t3 = `primaryDamageType` IS the IR word's
  protocol field** and selects the victim's `$SIR` row — a 15-value enum (0 Standard, 5 Cryogenic, 6
  ArmorPiercing, 7 EMP …), bench-proven in its wire position, and stock weapons already use different values
  (8 charge, 10 rocket, 11 gas, 13 melee). So: set our weapons to a non-zero t3, ship `$SIR,<that>,0,,1`
  instead of `$SIR,0,0,,1`, and the hill's word lands in an **unmatched cell = silently discarded** (the F11
  shape, used deliberately). Protocol independence for fn 1 is already measured across protocols 0, 5, 7, 9
  and 10 (50 cells, none varied), so damage behaves the same.
  **UNTESTED and the whole point of this rung:** nobody has set a non-stock t3 on OUR gun and watched the
  wire. Arm via `arm_sequence()` with t3=7, fire at board A, confirm the captured word reads **proto=7**;
  then confirm a hill no longer drains an intruder. ⚠ **The tradeoff to state in the write-up:** dropping
  `<0,0>` makes our guns DEAF to anything shooting standard protocol 0, including a native BRX gun. Fine for
  an all-hosted match, fatal for mixing hosted and native players in one game. `bench`.
- **F92 🟠 A PHONE STATION CANNOT LEARN WHO OWNS A GRENADE HILL, AND MC CANNOT TELL IT.** The gap that
  blocks coupling a respawn station to hill control. A grenade's ownership travels **only over IR**, so only
  a GUN can hear it — and a utility phone (`spec/utility.md` role `utility`) has no gun. The station channel
  is BLE adverts, which carry `team` and `value` (progress %) for `kind 5 control`, but nothing bridges IR to
  that advert. And relaying it through MC is not available: §5c states *"stations are self-authoritative and
  report at recap (MC is not live mid-match)"*, so a mid-match `station_config` re-arm contradicts the
  architecture. **Consequences for mode design:** (a) a grenade hill and a phone respawn station cannot be
  coupled today — the station must run a FIXED team, or be contestable in its own right by BLE presence;
  (b) K1's "still needs: shoot-to-capture = the IR box" is the same gap from the other side. **Options, none
  free:** give the station a gun/headset of its own so it can hear IR; have player phones relay ownership
  peer-to-peer via their own player adverts (the advert has spare bytes but no field for it); or accept
  presence-capture for phone control points and keep shoot-to-capture for the grenade as a separate objective.
  Decide before building multi-point Domination, since F88 already rules out two grenades.
  ➡ **DECIDED 2026-09-10 (Tony): option (c).** Phone control points capture by **presence** (`spec/utility.md`
  §5d, F94) and the grenade keeps shoot-to-capture as a separate objective; the two are **not** coupled and no
  IR-to-advert bridge is built. The gap this row describes is real and is now designed around rather than closed.
  `build`.
- **F93 🟢 A PROXIMITY LAYER IS ALREADY ARRIVING ON EVERY PHONE AND BEING DISCARDED.** Opened 2026-09-10
  (Tony's idea, and his design call recorded below). `app/src/app.js:121` feeds **every** OBRX advert into the
  presence tracker — `presence.observe(hit.uuids, hit.rssi, …)`, low-latency scan mode, open for the whole
  match — and `Presence` decodes role, so **player** adverts land in it alongside stations. But `app.js:381`
  surfaces only `presence.stations()` to the engine: **`presence.players()` is populated and unused.** Every
  phone therefore already knows, continuously and with no LAN: who is in range, their **player id**, their
  **team** (advert byte 9), whether they are **alive or down** (byte 10 bit 0), and a smoothed RSSI. No radio
  work is needed — this is a consumer, not plumbing.
  ⭐ **DESIGN DECISION (Tony, 2026-09-10): teammates only by default; enemies are a PERK, not baseline.**
  Enemy adverts are readable, so a baseline enemy display is a wallhack — symmetric, so not unfair, but it
  turns flanking into a solved problem and changes the game more than it improves it. As a perk it is a
  deliberate loadout cost instead: the A14 perk slot and `mc/perks.json` (7 perks today, `perk_id` +
  name/desc, policy pool in `mc/policy.py`) already carry exactly this shape, so a "motion tracker" perk is a
  registry row plus a filter, and MC's policy pool can switch it off per game.
  **What it can and cannot do, so nobody promises a radar:** ⚠ **there is NO direction.** BLE gives no bearing
  without multi-antenna AoA, so this is a proximity LIST, never a sweep. ⚠ Distance is a crude bubble, not a
  range: the bench-tuned default is **-74 dBm at high TX ≈ 10 ft** (`spec/utility.md` §3), and body blocking
  and phone orientation wreck it. ⚠ Adverts are **unauthenticated**, so a player can go dark by not
  advertising, or lie about their team — already the documented accepted tradeoff for friends on a LAN, which
  makes this fine as flavour and unusable as a competitive guarantee. ⚠ Advertising plus scanning all match
  costs battery, and Android throttles scan restarts (~5 per 30 s, which is why `app.js:148` uses 7 s / 90 s).
  **Cheapest first slice:** expose `presence.players()` in engine state, filter to own team, show "N
  teammates near" on the HUD. Related: **F92** (byte 15 is `reserved` — a spare byte in the same advert is the
  cheapest way to relay grenade-hill ownership phone to phone). ⚠ **F94 uses byte 15 of the STATION advert**
  (role 1) for a control point's net capture rate — a different record from the player advert (role 2), so the
  player-side spare byte this row wants is untouched. `build`.
- **F94 🟢 BUILD THE PHONE CONTROL POINT (K1 base) — SPECIFIED 2026-09-10, NO LAN NEEDED.** Tony's design,
  written up in full as `spec/utility.md` **§5d**; this row is the build. `kind 5 control` already exists in the
  advert schema, so **no radio work**: capture rate is the **net difference of living present players** (2v1
  counts as the 1, 2v0 goes twice as fast, an even fight nets zero — explicitly **not** a contested freeze), a
  **two-phase conversion** (drain an enemy point to neutral, then build it for the claimant) on one 0-100 scale in
  advert byte 11, phase / `toward` / contested in byte 10, and the signed net rate in byte 15 (role-scoped, so it
  does not consume the **player**-advert spare byte F93 mentions). Three surfaces: the station state machine and
  an **animated** screen (§5d.4 — the point of it is that a defender can see "you are losing this" at a glance,
  built on the roster already at `app/src/utility.js:161`); a player-node branch on `presence.stations()`, which
  `app.js:158-163` already feeds to the engine; and MC's `koth`/`domination` catalog entry + scorer.
  ⭐ **The callouts need no LAN and that is the whole point:** every phone already scans all match
  (`app/src/app.js:121`), so it reads the point's own advert and plays its own line locally — `VB0N` captured to
  the new owner, `VB0P` lost to the team that just lost it, `U100` while you hold it, the listener's team picking
  the line exactly as `engine.js:_hillCallout` already does for the grenade. ⭐ **And this is the first path that
  can wire `VB0O` "Hill Contested"**: `HILL_CUES.hill_contested` sits in `engine.js` with no caller because on the
  grenade path **F75** says a non-capturing hit emits nothing decodable, so contest can only be guessed at — a
  phone point *counts bodies* and measures it. **The callout set is closed at the five confirmed-by-ear ids**
  (`VB0N` covers both capture and "you control it" — Tony: no separate "controlled" line is wanted; `V8Q` is
  catalogued "Hill Confirmed" and says "**Kill** Confirmed", so nothing is used unheard). ⚠ One callout per `seq`
  transition, never per advert (F74), and the existing scheduling rule stands: a callout owns the announcer for the
  clip's real length with the tick waiting, and a later callout preempts rather than queues (`4348721`). ⚠ The
  callout's reach is the advert's radio reach, not the field. Needs **B1** (the station must hear player adverts
  reliably) more than any other kind, since the rule IS a head count. Cross-refs: **F88** (no grenade carries a
  station id, so multi-point Domination needs phones), **F92** (and is why a grenade hill and a phone station
  cannot be coupled), **F82** (no tid 2 in a hill mode). `build`.
- **F95 🟡 THE LAN-COUPLED CONTROL-POINT VARIANT: POINTS TO WIN AND ROAMING HILLS — A DELIBERATE A4.8 EXCEPTION.**
  Tony's second, opt-in mode for a small field where every point really is on one Wi-Fi (his example: one hill in
  the garage, another on the porch, both on the house AP). Specified as `spec/utility.md` **§5e**. Two features
  that are impossible offline because no single station can know the fact they need: **points to win** (the target
  is crossed by the SUM across points, and 16 bytes hold no running score) and **roaming hills** (somebody must
  choose which point is hot and tell the others — which is what `VB0Q` "Hill Moved" exists for, and what **F83**
  proposes on the grenade side).
  🔴 **The exception is the headline, not a footnote.** `spec/contracts.md` §5 **[A4.8]** says *"nothing about the
  match outcome depends on coverage"*; a points-to-win race and an MC-driven hill rotation both **do** — a point
  out of Wi-Fi range is not merely invisible, it is not in the game. Taken knowingly and fenced: only modes
  flagged `lan_coupled`, never F94's base mode, and the only place in the system where coverage decides an
  outcome. **If this is built, A4.8 gains a pointer to §5e** — an exception not written next to the rule it breaks
  is a bug waiting to be rediscovered.
  **Two setup surfaces are part of the work, not polish:** (a) MC emits a **`SETUP: `** `config_warnings` entry
  (the operator-warning channel already documented in `mcp/brx_mcp/mc/API.md`, rendered verbatim by the GAMES
  rail) naming how many control points are linked, plus a link state and attention flag per phone in the ITEMS
  panel (roadmap A2/A4) — reuse that channel, do not invent one; and (b) the **utility screen** promotes its
  existing MC-link line (`utility.js:159` LINKED / OFFLINE / NO ADDRESS) to a blocking band, `THIS GAME NEEDS
  WI-FI — MISSION CONTROL OFFLINE`, because the person who can fix it is standing in front of that phone and not
  in front of MC. ⬜ **LAN loss mid-match is a PROPOSAL needing Tony's sign-off** (§5e.4): 15 s grace, then the
  station degrades to running F94's local rule on the last known owner and stops scoring, roaming freezes, both
  screens say so, and MC declines a points win it cannot stand behind (falling back to most possession time) if
  any point was degraded for more than ~10% of the match. The honest alternative is awarding it anyway from
  partial data with a recap warning. Needs **F94** first, and A1/A2. `build` + `decision`.
- **F96 🔴 FFA HANDS OUT TID 4 AND 5, WHICH THE PROTOCOL FORBIDS — ONE-DIRECTIONAL IMMUNITY AT 5 PLAYERS.**
  Found 2026-09-10 while sizing an FFA King of the Hill. `assign_teams("ffa", …)` assigns `i+1`, so four
  players get tids 1,2,3,**4** and five get 1,2,3,4,**5**. But `$TID` is **masked to 2 bits on the wire**
  (`protocol/brx-protocol.md`: *"⚠️ TEAMS ARE 0-3 (bench 2026-09-07) … Use 4-7 as COLOURS only, never as a
  team"*). A victim compares the incoming team against its **FULL** tid, so the asymmetry is real damage
  logic, not cosmetics: **tid 5 transmits as wire team 1, so a tid-5 player's shots read FRIENDLY to the
  tid-1 player and do nothing**, while tid 5 still takes damage from tid 1 — one-directional immunity, and
  the unluckiest player in the lobby simply cannot shoot one specific opponent. A tid-5 gun was also observed
  **killing itself** off a nearby surface (`$HIR,4,0,7,1,9` naming its own player id, armour to 0).
  ⚠ **Four players happens to be safe, by luck only**: tid 4 aliases to wire 0 and FFA starts at 1, so no
  real tid-0 player exists for it to collide with. Do not rely on that — it breaks the moment anything
  assigns tid 0. **Never run FFA above 4 players until this is fixed**, and the real cap is 4 because the
  hardware has four teams, full stop. Fix: refuse >4 in FFA at validate time with a clear operator message
  rather than silently assigning an unusable tid. Never run in the field above 2 players (the 2026-08-30 FFA
  was two iPhones), so this has never bitten anyone yet. `build`.
- **F97 🟡 AN FFA KING OF THE HILL CAPS AT THREE PLAYERS, AND THAT IS WORTH SAYING OUT LOUD.** Tony's idea,
  2026-09-10. FFA KotH is attractive because the net-difference rule (§5d.1) reads beautifully in a free-for-
  all: every player is their own team, so the point only converts for someone who has it **to themselves**,
  and any two players can deny a third. But the roster maths is brutal — four teams exist (tids 0-3), **F82
  removes tid 2** because a neutral hill broadcasts team 2 and a tid-2 player would read every neutral point
  as already theirs and take no hill damage. That leaves **tids 0, 1, 3 = three players**. Going to four
  forces either tid 2 (an unfair advantage, F82) or tid 4 (forbidden, F96). ⚠ Also decide the three-way rate
  rule, currently specced as summing the other teams so 1v1v1 nets **negative** and progress drains toward
  neutral — arguably right for FFA (you must be alone to hold it) but it is a design choice, not a
  measurement, and it is the agent's call rather than Tony's so far. `build` + a design decision.
- **F80 🟠 A GUN WHOSE `$PSET` NEVER LANDED PLAYS THE WHOLE MATCH WITH NO IDENTITY, AND NOW SCORES NOTHING.**
  Opened 2026-09-10 as the honest other half of F69's fix. Wire 0 is not only environmental: a gun that never
  received `$PSET` fires with player id **0** (`manual/dev.md`: *"every gun on that capture sat on the default
  id"*), and `compile.py:899` relies on exactly that for try-outs. The F69 guard makes attribution refuse wire
  0, which is right for a hill and **costs a mis-armed gun every kill it makes** — previously those reached its
  team via `sole_member_of_team`. ⚠ **A single `$HIR` cannot separate the two cases, so do not fix this in
  attribution;** any heuristic there is a guess that will silently mis-score one of them. **The fix is at ARM
  TIME:** MC should confirm `$PSET` landed (`$QUERY` the gun, or read back the id) and refuse to start a player
  with no identity, rather than letting an identity-less gun into a match. Cheap interim: surface it in the
  muster screen — a gun reporting id 0 is a gun that will score nothing. `build`.
- **F81 🟠 THE VICTIM'S PHONE NAMES THE WRONG TEAM AS THE KILLER WHEN A HILL KILLS YOU.** Found in review
  2026-09-10, and it is the half F69 missed. `app/src/engine.js`'s `$HIR` case excludes only the beacon
  (`t[2] === '15'`) and never checks wire 0, so a hill's damage word latches
  `{shooter_num: 0, shooter_team: <hill owner>}` and the DOWN screen renders **"KILLED BY <the owning team>"**
  (`nameOf(0)` is null, so it falls back to the team name). MC's scoreboard is now correct and **the player is
  told a specific lie** — worse than F69's "nothing names the cause", which is what that entry still claims.
  ⚠ Same ambiguity as F80: a mis-armed gun also sends wire 0, and for THAT case the team shown is correct. So
  the phone fix is not simply "drop the latch" — it is "say the killer is unknown when the shooter has no
  identity". The engine half (latch + the `hit_taken` fact) is ours; **the DOWN-screen copy belongs to the
  brx-hud session** and should be handed over rather than guessed at. `build`.
- **F83 🟢 A ROTATING-HILL MODE IS BUILDABLE, AND THE GRENADE ALREADY SUPPORTS IT.** Tony's suggestion, bench
  2026-09-10 evening: `VB0Q` "Hill Moved" is a real hosted callout (confirmed by ear, rung S) that is only
  meaningful when the live point can change — several grenades set to HILL, with the node choosing which one
  is currently "hot" and reading only that beacon (or all of them and scoring the one the node has picked).
  Nothing hardware-side blocks it: each grenade beacons independently on its own `proto=15` cell, so the node
  already has one wire per point and just needs the rotation logic and the `VB0Q` transition wired to it.
  Not scoped or bench-tested; a new mode idea, not a finding. ➡ **Specified on the phone path as
  `spec/utility.md` §5e / F95**, where choosing the hot point needs a live LAN and is written up as a deliberate
  **A4.8** exception; the same rotation logic serves both sources. `build`.
- **F87 🟢 GRANT A RATE-OF-FIRE BOOST TO THE TEAM HOLDING A HILL, FROM THE NODE.** Tony's ask; designed
  2026-09-10 evening, not built. The grenade will not do it for us: holding a hill under fn 28 changes `$ALCD`
  cadence not at all (102.0 ms/round owned vs 101.6 enemy-held, control inside the measurement, bench-queue D7).
  ⚠ Hosted-only — a native game drops the BLE link, so this does not disprove a native buff. **And the firmware
  cannot be made to grant it either:** every hill word lands in the single `$SIR` cell `<15,0>`, so an
  ally-polarity grant at `$GSET` t1 = 0 would gate on the owner correctly and go **blind to enemy-held hills**
  (rejected words emit no `$HIR`, so capture detection dies), while t1 = 1 lifts the gate and the grant fires on
  ANY beacon, boosting a player standing in an ENEMY hill. **One cell cannot both read every owner and grant only
  to the owner** — so read with fn 28 at t1 = 1 and apply the boost node-side. ⚠ Whether any ally function buffs
  RoF at all is UNMEASURED (fn 31/32/34 unswept, bench-queue D6); the conflict stands either way.
  **The build:** on "my team owns it and the beacon is fresh", push the player's `$WEAP` with a reduced **t14**
  and then IMMEDIATELY `$AMMO,<slot>,<live mag>,<live reserve>,1,*` from the count `engine.js` already reads off
  `$ALCD`; reverse both on loss or staleness (≥ 2 missed beacons, ~12 s). 🔴 **The `$AMMO` restore is not
  cosmetic:** a `$WEAP` re-push resets ammo to the frame's values, so omitting it is a **free full magazine every
  time a player steps onto their own hill**, repeatable at will. Revert unconditionally on BLE reconnect (stock is
  the state you can always justify). **No boost value is proposed, and one must not be invented:** t14 is
  calibrated at ~1 ms/round (`protocol/brx-protocol.md` §6) so the arithmetic is trivial, but **the floor is
  unknown** — how low t14 can go before the firmware clamps or the IR stops keying — and a faster cadence
  interacts with the t21/t22 recoil model (F46), so a boost may cost accuracy as a side effect. **Blocked on
  `docs/bench-grenade.md` rung Z** (sweep t14 for the floor; prove the push/revert preserves ammo exactly; fire it
  off a real beacon). Design: `docs/utility-roadmap.md` "Rewarding the holder". `build` + `bench`.
- **F84 🟠 A HOST CONSTANT WIDER THAN AN AMBIENT EMITTER'S PERIOD NEVER EXPIRES — THIS IS THE THIRD TIME IN ONE
  DAY.** Bench 2026-09-10 evening. Two independent bugs, same shape, found hours apart: `ATTRIB_FUSE_S` (6.0 s)
  kept hill-kill attribution permanently fresh against the hill's ~5 s beacon (F69's attribution half), and
  `regen_delay_s` (6.0 s) meant `deathmatch.py` restarting the regen idle timer on *every* `$HP` — including the
  hill's zero-damage echo — never let `now - last_damage` reach 6, so **a player standing in a hill never
  regenerated, for the whole match, in any regen mode** (60 s in a hill = 0 heals; 60 s outside = 1 heal).
  Fixed by measuring the pools' actual DROP rather than treating a frame's arrival as damage
  (`mcp/brx_mcp/modes/deathmatch.py`, `_last_pools`; tests `test_standing_in_a_hill_does_not_block_health_regen`
  + `test_a_real_hit_still_suppresses_regen`). **The generalisation, not yet acted on:** any timer or fuse in
  `mcp/brx_mcp/` that is wider than ~5 s and resets on a frame's mere arrival (rather than on what the frame
  MEANS) will silently never fire once a hill or station is in play, because that is now the shortest ambient
  period on the wire. Audit every time constant in `mcp/brx_mcp/` against the 5 s hill period as a required
  check for every future objective, not only the two caught by hand this session. `build`.
- **F85 ✅ CLOSED 2026-09-10 — deduped on IDENTITY, not on time alone.** Bench 2026-09-10 evening. Captured
  verbatim, 14 ms apart:
  ```
  $HIR,4,15,0,2,8,0,0    <- sensor 4, gun body
  $HIR,0,15,0,2,8,0,0    <- sensor 0, headset front — SAME transmission
  ```
  Same protocol, owner and magnitude, on two different sensors on the same gun: one physical beacon, two
  frames on the wire. **Any node that ticks, scores or counts presence per `$HIR` will double-count**, and a
  capture/possession timer driven per-frame would run at roughly double rate. Cross-reference **F72** (the
  phone throws away every proto-15 `$HIR` today, so this had not reached `engine.js` — but F72 has since
  shipped, so the phone's own handling needed the same dedupe, not only the node's).
  **Fixed in `app/src/engine.js`'s proto-15 `$HIR` branch.** The obvious fix — drop any beacon within
  N ms of the last one, time alone — is wrong, and a second same-evening capture proves it: two DIFFERENT
  beacon words arrived in the SAME MILLISECOND on different sensors during a real hill capture —
  `$HIR,0,15,0,2,53,0,0` (mag 53: the state being left, neutral) and `$HIR,4,15,0,1,8,0,0` (mag 8: the new
  owner's beacon). A time-only window would have dropped one of those and could silently swallow the
  capture announcement, the single most important beacon event there is. So the key is **protocol (implicit,
  this branch only runs on proto 15) + owner team + magnitude**, matched within a 150 ms window (comfortably
  above the 14 ms observed spread, well clear of the ~5 s beacon period so a normal repeat is never mistaken
  for a duplicate of itself); **sensor id is deliberately excluded from the key** — a differing sensor is
  exactly what a duplicate looks like. Tests in `app/test/engine.test.mjs`: the true duplicate (14 ms apart,
  same sensor pair as bench) collapses to one beacon; the same-millisecond capture pair (mag 53 → mag 8,
  different owner) yields two distinct beacon updates, the regression guard against the time-only fix; a
  normal 5.0 s repeat is not swallowed. `build`.
- **F86 🟠 A LIVE `$TID` WRITE MOVES A PLAYER'S TEAM FOR HIT RESOLUTION BUT LEAVES THE LEDS ON THE OLD COLOUR.**
  Bench 2026-09-10 evening. The operator's gun was switched `$TID,1` -> `$TID,0` mid-session; the very next
  shot captured an enemy-held hill for team 0 (the firmware had genuinely moved him — consistent with the
  documented `$TID` behaviour in `protocol/brx-protocol.md`, "a live write changes hit resolution immediately
  but does not repaint the LEDs"), while **the gun LEDs still showed the previous team's colour**. Operator's
  words: *"the gun leds dont show me as red, but i shot the grenade and it switched to red."* The protocol row
  is correct and needs no change — this is the missing CONSEQUENCE for modes, not a protocol bug. A player can
  be on one team for damage/objective purposes and display as ANOTHER team to themselves and to everyone
  looking at them, which is a live gameplay hazard, not cosmetic: teammates read each other by LED colour in
  the field. **`docs/led-language.md` does not cover this today** — no mention of `$TID`, team change or a
  repaint requirement anywhere in it, checked 2026-09-10. ✅ **The remedy is VERIFIED on hardware, same
  evening, not just proposed:** blank (`$GLED,,,,5,,,*`) then paint (`$GLED,<colour>,<colour>,<colour>,0,10,,*`
  plus `$HLED,<colour>,0,,,10,,*`) right after the `$TID` write. Operator confirmed both gun and headset
  showed the new team colour after each of two live switches ("yes both red", then "now they are blue"). A
  painted colour does not hold on a spawned gun without the blank first (`protocol/brx-protocol.md`). `$SPAWN`
  also repaints from `$TID`, but it is not a free substitute — it restores ammo and re-enables the firmware's
  native breathing animation as a side effect. **Fix still open at the MODE level:** any mode that changes a
  player's team mid-match must call the verified blank-then-paint sequence itself; nothing wires it in
  automatically today. **Modes affected: infection** (the single most likely place for this to bite — players
  change team ON infection), any host-driven team swap, and team-based objective modes generally. `build`.
- **F77 🟠 A REPLAYED HIT IS INDISTINGUISHABLE FROM A REAL ONE, AND BOTH SCORE.** F74's phantom loop
  (a gun replaying `$HIR`+`$HP` every 5.07 s with no IR in the air) reaches the scoring path unchallenged:
  `engine.js:1514` gates `hit_taken` only on `latch.at` being under 1 s old and `dmg > 0`, and
  `mc/scoring.py:220-225` dedups on nothing at all -- it counts every `hit_taken` it is handed. So a latched
  gun inflates the shooter's hit count and, once the replayed damage empties the victim, can book a phantom
  death. ⚠ **Deliberately NOT fixed with a heuristic.** At frame level a replay looks exactly like genuine
  repeated fire; a "same shooter + same dmg at a regular period" suppressor would silently eat real bursts,
  which is worse than the bug it fixes. The honest fix is upstream: find why the gun latches (F74) so the
  replay never reaches the wire, or get a per-shot sequence number out of the firmware. **Interim mitigation
  that costs nothing: MC should FLAG the signature, not drop it** -- a run of identical `hit_taken` facts at a
  near-constant period is a recap warning, so a match spoiled this way is at least visible after the fact.
  `build` (detector) + `bench` (F74 root cause).
- **F78 🟡 `fake.py` cannot model a single one of this week's grenade findings.** The fake tagger takes hits
  only through `receive_ir(shooter_team, shooter_id)`, which always emits a protocol-0, magnitude-9 word. It
  cannot produce a protocol-15 beacon, a hill's ambient damage word, a magnitude-0 miss, or a `$SIR` cell that
  discards in silence -- so F69, F70, F72, F73, F74 and F75 are all invisible to the 1000-test suite by
  construction. This is the `stage-must-mirror-the-phone` failure: the sim's fidelity ceiling, not its
  coverage, is what let the F69 scoring bug sit green. ✅ **Half done 2026-09-10:** `receive_ir` now takes
  `proto`/`mag`/`sub`, `beacon()` emits a protocol-15 station word with no pool change, and the hill is
  modelled end to end in `test_a_hill_drains_a_fake_gun_to_death_and_scores_for_nobody`. Also fixed on the way:
  the fake **subtracted `self.damage` (25) from the pools while emitting magnitude 9 in the frame**, so
  anything reading dmg off `$HIR` inherited a contradiction; magnitude now drives the damage. **Still missing:
  (a) the `$SIR` TABLE GATE** -- the fake accepts `$SIR` and `$CLEAR` silently and always registers a hit, so
  it cannot reproduce the F11/F40/F60 shape (an unmatched or absent cell discarding in silence) that has now
  bitten three times in one week, and which is the single highest-value thing left to model; **(b) a
  magnitude-0 MISS** (F46/F62). `build`.
- **F79 🟢 `assert_sir_covers_weapons` has no concept of a non-weapon `$SIR` cell.** It checks that every
  weapon in the loadout has a matching row, so a bundle that ships with NO protocol-15 row -- the exact
  condition that made station words silently vanish (F60, and the third instance of the F11 shape this week)
  -- raises nothing. A table is "covered" while being deaf to every beacon in the venue. Add a check that a
  game whose config declares an objective also carries the cell that can hear it. ⏸ **Deliberately deferred,
  not forgotten:** no compiled mode ships a protocol-15 row yet (F70/F72 is that work), so the check would
  either be a no-op or fire on every config that legitimately has no objective support. **Write it in the same
  commit that ships the row** -- a guard added before its feature is a guard nobody can test. `build`.
- **F76 🟡 The reference page's per-weapon capture counts contradict the bench.** `reference/grenade.md`'s King
  of the Hill section says retaking costs *"at least as many ROUNDS back into it (2-3 rounds to 2-3 magazines
  depending on weapon; ~4 on an MG, ~10-12 on a shotgun)"*, and that section is labelled hardware-confirmed
  (exp-log #37). **The 2026-09-10 bench measured the currency as MAGNITUDE** (F70): seeded 1 AR round → retaken
  with 1; seeded 5 → retaken with 5; seeded 5 (45) → retaken by ONE shotgun shell (70). Under magnitude a shotgun
  is among the FASTEST capturers; that figure makes it the slowest. **Both cannot be right.** Candidates: the
  per-weapon counts came from video rather than the bench; or they describe a FULL hill, where a slow-firing
  weapon takes longer in wall-clock even at high magnitude per round; or magnitude is not the whole story and
  something weapon-specific also matters. Probe: fill a hill to max from one team, then time and count a retake
  with an AR versus a shotgun. Until then the reference page says "do not use the per-weapon counts" — the
  magnitude result has the stronger method (single-variable, `$ALCD`-verified, one round per beacon). `grenade`.
- **F75 🟡 Does a NON-capturing hit on a grenade emit anything? (native says "contested"; our wire says nothing.)**
  Checked 2026-09-10 across four runs where a hill was shot and did NOT change hands (single rounds into a
  45-charge hill; one shotgun shell): **the only protocol-15 traffic is the ordinary `mag=8` beacon.** The grenade
  announces CAPTURES (`mag=50`), not hits. But native play says **"control point contested"** when you shoot an
  enemy-held point without taking it (Tony), so either the native gun INFERS it the same way we would have to, or
  there is a word we have not captured. **Why it matters:** a hosted "contested" callout must otherwise be
  inferred from *I fired* + *enemy hill in range* + *no capture word followed*, and that cannot tell a hit from a
  miss — firing past the grenade while standing in an enemy hill would produce a false callout. **Probe:** in a
  NATIVE game, stand in an enemy-held hill and deliberately MISS the grenade. If it still says "contested",
  native is inferring too and we lose nothing. If it stays silent, the grenade emits a hit word and board A should
  be pointed at it during a deliberate near-miss to catch it. `grenade`.
- **F74 🔴 A GUN CAN LATCH AN IR EVENT AND REPLAY IT FOREVER — with no IR in the air.** Bench 2026-09-10,
  measured from both directions. The gun emitted `$HIR,0,0,42,0,20,0,0` + `$HP` **every 5.07 s, indefinitely**,
  while **board A recorded ZERO bursts across an 18 s capture** — nothing was transmitting. The grenade was off,
  the emitter was idle, and the operator was stationary. It **survived three `$PLAYX,0,*`** (the audio went quiet
  briefly and the event kept going) and was **cleared by `$SPAWN,,*`** — the same command that clears the `$SIR`
  fn-23 state, so `$SPAWN` looks like the general "drop stuck IR state" lever.
  **Why it is 🔴:** in a match a latched gun MANUFACTURES HITS THAT MC WILL SCORE. Accuracy, kill attribution
  and hit feedback all corrupt, and to the player it is indistinguishable from being shot by nobody. It is also
  silent to us: nothing in the node or MC can tell a replayed `$HIR` from a real one.
  **It already cost us a result:** the U11′ sweep (F73) ran with phantom hits mixed into every trial, which is
  what produced "multiple sounds per shot" and sent me chasing multipath. Tony called it early — *"i think it
  also queues the events on the tagger"* — and I looked at rig geometry instead.
  **It is the whole EVENT, not queued audio** (Tony proposed audio queueing, then ruled it out himself): the
  **headset flashed** on every repeat, and the wire carries `$HIR` **and** `$HP` each time. The durations settle
  it too — every hit clip in the `$PSET` is 0.36-0.79 s (`H06` .43, `H55` .36, `H13` .79, `H21` .74, `H02` .39),
  so nothing retriggered at 5 s can overlap itself into a "growing" sound.
  ⚠ **Loose end: which clip is the hiss?** It is not `A10` (`energyShieldLoop` shipped EMPTY in these runs) and
  none of the five hit slots is a long hiss, so something outside the slots we set is producing it — and it is
  the same sound heard during the grenade runs. Identify it: it may be a fall-through (an empty effect field
  falls OUTWARD to the neighbouring pool's clip, A17) or a firmware default we have never catalogued.
  **Unknown: the trigger.** It appeared during rapid emitter shots with a grenade beaconing nearby, so a flood of
  IR is the suspect, but nothing was isolated. Probe: hammer a gun with `rapid_fire.py`, stop, and watch for a
  replay; then bisect (emitter alone vs beacon alone). Also open: does it survive a BLE drop, and does a NODE
  see it as real (it should, which is the problem). Consider a node-side guard — identical `$HIR` at a fixed
  period with no `$ALCD` from any shooter is not a real hit. `trigger` + `build`.
- **F73 ✅ ANSWERED 2026-09-10 — `$SIR` fn 28 REGISTERS WITH ZERO PLAYER FEEDBACK.** The question was whether any
  status function can be read by a node without the player experiencing it. **fn 28 can.** Swept enemy-side
  8/24/25/26/27/28 on a free cell (`$SIR,5,0,,<fn>` as the ONLY row, so a mis-decoded word has no row and is
  discarded), three spaced words each, `$HIR` protocol verified per trial:
  | fn | registers | sound | headset flash | vibrate |
  |---|---|---|---|---|
  | 8 | ✓ | none | **yes** | **yes** |
  | 24 / 25 / 26 / 27 | ✓ | a long grenade-ish clip (hiss → timer → explosion) | ? | ? |
  | **28** | **✓ ×3** | **none** | **none** | **none** |
  ⭐ **fn 28 is the row to ship on protocol 15**: a node reads the hill beacon every ~5 s and the player feels,
  hears and sees nothing. ✅ **CONFIRMED on a real beacon, protocol 15, bench 2026-09-10 evening (rung F73-b
  closed).** The original sweep ran fn 28 only in cell `<5,0>` with the ESP32 rig's synthetic words, so
  "ship it on protocol 15" was an assumption. Armed a gun for real with `$SIR,15,0,,28,0,0,1,,*` against the
  live grenade: the beacon arrived as `$HIR,4,15,0,2,8,0,0` (sensor 4, protocol 15, neutral team 2, mag 8 =
  hill), 20+ consecutive beacons, period 5.0 s, no drift, zero misses. **The cell is the key, the function is
  the effect — holds on real hardware, not only the rig's cell `<5,0>`.**
  **Polarity, both directions measured.** fn 28 is **enemy-only** under `$GSET` t1=0 (three ally words → zero
  registrations, silently rejected). With **`$GSET` t1=1** the gate lifts: the same ally words registered
  `$HIR,0,5,42,**1**,20` ×3, **owner in the team field**. So:
  **FF off** = you hear only hills you do NOT own (cheap, but "no beacon" is ambiguous between out-of-range and
  we-own-it, and you miss your own captures, since the `mag=50` capture word carries the new owner's team).
  **FF on** = every beacon and every capture, ownership read from `$HIR`, complete information — at the cost of
  same-team IR registering elsewhere in the game. **A KotH mode wants FF on; that is a mode-level decision.**
  ⚠ Also learned: the "varied sounds" across 24-27 are ONE long clip truncated by the next event, not several
  clips — spacing shots 6 s apart let it play through to the explosion. Which clip it is remains unidentified
  (not `A10`, not any of the five `$PSET` hit slots). And on fn 27 the first of three sounded genuinely different
  in a way a leftover tail does not explain; unexplained, recorded rather than tidied away.
  ⚠ Not swept: enemy 35, and the ally-side 31/32/34 — unnecessary now that fn 28 answers the question, but they
  are the fallback if fn 28 turns out to have a side effect we have not looked for.
  **Extended 2026-09-10 (evening): fn 28 ignores the `$SIR` `<soundID>` field too.** Armed
  `$SIR,15,0,U100,28,0,0,1,,*` — `U100` known audible, confirmed by ear the same evening at the same
  `$VOL,80` — against the live grenade. The row registered repeatedly (`$HIR,4,15,0,0,8,0,0`, no misses) and
  produced **no sound at all** ("havent heard a tick yet"). So "zero player feedback" is a property of the
  FUNCTION, not of leaving the sound slot empty — no gun-native beacon cue is possible through fn 28.
  **Design consequence:** hill audio is node/phone work, not gun work (`docs/utility-roadmap.md` "Where the
  hill audio has to live" updated). ⚠ Still untested: whether any OTHER protocol-15 function honours
  `<soundID>`, and the `$PSET`-override side effect — no sound played at all, so nothing to observe an
  override on. `docs/bench-grenade.md` rung Y closed with this result.
- **F72 🟠 The phone throws away every grenade/station beacon.** `app/src/engine.js:1273` opens the `$HIR`
  handler with `if (t[2] === '15') break;` — protocol 15 is dropped before anything reads it. That predates
  knowing what a beacon carries, and it is a SECOND blind spot stacked on the missing `$SIR` row (F70): fixing
  the compiled table alone surfaces beacons to the gun and still not to the player. To read a hill or a respawn
  point a node needs both. The beacon carries the owner (team bits) and the mode (magnitude 8 hill / 6 respawn),
  so the handler should parse and route it rather than break. ⚠ It also needs a rate rule: a beacon lands every
  ~5 s for as long as anyone stands there, so whatever the node does with it must not fire per beacon. Blocks the
  KotH/Domination path in `utility-roadmap.md` §8. `build`.
- **F71 🟠 The three headset weapons may do far more damage than we publish.** The catalog derives `dmg`, `htk`
  and `ttk_ms` from `$WEAP` **t5 alone**. But the shotgun's capture word went out at **magnitude 70** = its
  `t12` extraHeadsetDamage, alongside a t5 of 45 — so at headset range a shotgun may land **115, not 45**, and
  the rocket (t12=115) and plasma sniper (t12=80) likewise. If so every hits-to-kill number we print for those
  three is wrong at exactly the range they are built for, and `test_ttk_band` is validating a fiction. Same
  family as **F23** (damage depends on the sensor). Probe: fire each of the three at a victim at headset range
  and at gun range, and read the `$HP` delta against t5 and t5+t12. Only ONE word (`mag=70`) decoded on the
  shotgun shot, so whether the primary goes out too is open — the second half of that burst was undecodable. `trigger`.
- **F66 🟡 `$SIR` fn 23: one mechanism with two symptoms, or two effects?** The 2026-08-27 row called it an audio
  suppressor on the strength of `$ALCD` token 2 dropping 100 → 0. Token 2 is now bench-proven to be **live accuracy**
  (F46), so that number never evidenced the audio claim at all. Both observations stand on their own: the gun **was heard**
  to go silent, and its accuracy **was measured** at 0 for ~6-8 s. What is gone is the belief that one reading demonstrated
  both. Re-run fn 23 and separate them: is the gun silent AND inaccurate, or did the silence have another cause? Note fn 23
  forces accuracy to literal 0, below whatever `t22` floor the weapon ships, which no normal firing walk can do -- so it is
  a genuine debuff primitive either way. `trigger` + `ears`.
- **F67 🟡 The three numbers F46 did not pin.** The accuracy model is proven and drivable; these calibrate it.
  **(a) The recovery rate.** A native time-based recovery races the per-shot drop: at t22=0, single shots ~2 s apart held a
  flat 80 forever while a held trigger reached 0 in eight rounds. Nobody has measured how long one step back up takes, and
  that number decides how long a burst pause has to be -- i.e. whether "fire in bursts" is real advice or theatre.
  **(b) The hit probability per accuracy value.** Misses are probabilistic, not a threshold (floor 50 gave 4 × `mag=0` to
  12 × `mag=9`; floor 0 gave 16 to 12), but those samples mix pre-floor and floored rounds. Clean probe: set **t21 = t22**
  (e.g. 50/50) so accuracy is pinned from the first shot with no drift, then count `mag=0` against total rounds over 3-4
  magazines. If accuracy is literally a percent-to-hit, the printed manual's per-weapon pairs (M-4 96/91, MG-7 66/45)
  become directly meaningful to us.
  **(c) The near-miss sound's rate gate.** Spaced misses play `missShotHit` every time; three back-to-back played it once. `trigger`.
- **S17 ⬜ Ship the accuracy model per weapon** (unblocked by F46, 2026-09-09). We already write t21, t22 and t14 on every
  weapon, so this is balance work and not plumbing: pick a ceiling/floor per weapon and the fire interval that decides how
  fast it gets there. The catalog ships 100/100 today (model OFF) on all 22 rows, so adopting it is deliberate, per weapon,
  and reversible. **Gated on F68** -- turning this on with the headset bug live would strip team identity from every player
  who sprays. Design notes in `weapon-design.md` §4.4; the manual pages already describe the mechanic for players. Consider
  also surfacing `$ALCD` token 2 on the HUD: it is a live per-shot accuracy number the phone can already read, and it would
  make the mechanic legible instead of mysterious. `build`.
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
- **S10** **VERIFIED ON THE GUN 2026-09-09** — the A16 language was walked state by state and passed: dim team rest,
  readout contrast, the seven-level ladder down AND up, the gain having no lead/blink, rapid retrigger holding
  the 3-per-second ceiling (5 hits in 290 ms, no replayed blinks), critical red pulsing to dark, death
  hands-off then `$HLOOP`, night mode, and the 3-flash event burst against the new rest. Evidence:
  `experiment-log/2026-09.md`, 2026-09-09 late. What is still open:
  L-ladder: **L1–L9 and L12–L14 ANSWERED 2026-09-07** (the `$LED` pulsing scheme is deleted, `$HLOOP` is
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
