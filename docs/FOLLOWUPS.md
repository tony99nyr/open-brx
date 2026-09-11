# Followups — open work only

Updated: 2026-09-11. **Everything in this file is open.** Closed items are in
[`archive/followups-closed.md`](archive/followups-closed.md), verbatim and ordered by close date; the evidence
behind every row is in [`experiment-log/`](experiment-log/) (grep the id or the date). Session close = strike or
add rows here, one experiment-log entry, one HANDOFF banner. A fact goes to `protocol/` or `docs/manual/` in the
same commit, or it gets a row here saying "promote X".

**Ids.** One capital letter + number. Never renumbered, never reused. **Next free: B30 · D5 · E8 · F110 · G11 · H8 ·
K7 · P18 · Q20 · R3 · S20.** (2026-09-11 late: F105 taken and closed the same session -- the phone dropped every MC `alert`.) (Unchanged on 2026-09-11: **F35**, **F73** and **F96** closed that day and their
ids are retired, never reused.) (2026-09-10: F94/F95/F98 taken — the phone control point
(`spec/utility.md` §5d), its LAN-coupled roaming variant (§5e) and Territories (§5f). 2026-09-10 evening: F83/F84/F85/F86/F87 taken — rotating-hill mode idea, the "constant
wider than the hill's period" generalisation, the double-`$HIR`-per-beacon dedupe finding (F85, closed same
session), the team-change-leaves-old-LED-colour finding, and the hosted hill rate-of-fire boost.) (2026-09-07: F40/F41/F42 went to the Python DRY review and the fake-tagger row; the A17 bench items were re-lettered to F44/F45/F46 the same day to clear a three-way collision -- three sessions read "next free" concurrently. F43 is the A17 method finding. The bold list above is the ONLY authoritative "next free"; do not restate a number here.) Renumbered once, on 2026-09-06, to end collisions: the HUD-review items formerly
F15/F16 are **F26/F27**, and the 2026-09-01 field findings formerly G1–G7 (colliding with the grenade G ids) are
**F28–F32**. Bench-sheet numbers (1.1, 2.1, 3¾, A10a …) survive as aliases in §9.
**Blocked on:** `trigger` · `eyes` · `ears` · `space` · `grenade` · `capture` · `decision` · `build`.
**Status:** 🔴 blocking or high value · 🟠 next · 🟡 useful · 🟢 low.

## 0. Where to look

| You want | Go to |
|---|---|
| **The whole file TRIAGED** (bug in active code · core platform gap · bench-gated · decision · future · hygiene, with doer and dependencies) | [`followups-triage.md`](followups-triage.md) — an index over this file; if it disagrees with a row, the row is right |
| **The bench running order** (setup blocks, exact command, reading, control per rung) | [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md). §9 below is the REGISTER: ids live here, order lives there |
| **The grenade / hill rungs** | [`bench-grenade.md`](bench-grenade.md) §"Still to run" |
| **Open BUILD items** (no hardware needed) | §2 extensibility · §3 build · §7 September build items · the `build`-tagged rows in §6 |
| **Open DECISIONS** (keyboard, Tony's call) | §9 "Decisions", and the seven-item list in [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) §"Decisions" |
| **What closed today** | [`archive/followups-closed.md`](archive/followups-closed.md), newest last |
| **Why a fact is believed** | [`experiment-log/`](experiment-log/) — grep the id or the date |

**🔴 blocking, at a glance (2026-09-11):** **F68** a miss permanently kills the headset team colour ·
**F43** sound picks by acoustic shape are not trustworthy · **S10** LED language v2 · **E5** extensibility
(E1 closed 2026-09-11) · **B23**/**B26** respawn-for-hosted and the headset-less-gun contradiction.
*(**F35** and **F96** left this list on 2026-09-11: both were fixed in code and only the rows were still
open — see `archive/followups-closed.md`. **F82** is 🟡, not 🔴: MC refuses a tid-2 hill at three layers, and
what remains is the bench observation. **F69** and **F91** left this list on 2026-09-11 (bench): the hill's
"chip damage" turned out to be manufactured inside the gun by fn 24, not a wire-level word — F69 closed as
refuted, F91 retired since there is no word left to dodge; see `archive/followups-closed.md`. **F74** stays
open but drops off this list, downgraded to 🟡 the same night: the trigger is fn 24-27, not a general IR
latch, though the original self-replay-with-no-IR observation is still unreproduced.)*

### Every open id, by lane

**Two questions cover the whole file: does it need a gun, or does it need a keyboard?** The lists below are
just the rows re-sorted; the rows themselves are the truth. An id appears in BOTH lists when it carries both a
hardware tag and `build` (S10 is the biggest of those: the LED language is code that then needs an eye on it).
**Re-sorted 2026-09-11 (late) after the triage session closed 18 ids; the categorised view is [`followups-triage.md`](followups-triage.md).** ⚠ **This index has no guard.** It is the `tag` at the end of each row, re-sorted by hand
(`grep -n '\`bench\`' docs/FOLLOWUPS.md` and friends rebuild it); **if it disagrees with a row, the ROW is
right** and this index is stale. Do not cite it as evidence that something is or is not open.

**Needs Tony at the bench** (tagged `trigger` · `bench` · `ears` · `eyes` · `space` · `grenade` · `capture` ·
`hardware` — running order in [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md), next sheet
[`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md)):
- 🔴 **B26** · **F49** · **K4** · **Q15** · **S10**
- 🟠 **F13** · **F50** · **F58** · **F59** · **F71** · **P8** · **Q16** · **S9**
- 🟡 **B27** · **B28** · **B29** · **D1** · **F3** · **F21** · **F26** · **F27** · **F28** · **F30** · **F36** · **F62** · **F63** · **F66** · **F67** · **F74** · **F75** · **F76** · **F82** · **F88** · **G3** · **K1** · **P3** · **P15** · **Q18** · **S1** · **S2** · **S7** · **U11′**
- 🟢 **B20** · **F29** · **F65** · **F87** · **F99** · **P4** · **P12** · **S4** · **S8**

**Keyboard only** (tagged `build` or `decision` — no gun, no rig, no dim room):
- 🔴 **B18b** · **B23** · **E5** · **F43** · **F68** · **S10**
- 🟠 **B4** · **B19** · **B21** · **E2** · **F12** · **F13** · **F40** · **F56** · **F58** · **F70** · **F80** · **S3** · **S14**
- 🟡 **F109** · **B1** · **B8** · **B14** · **B17** · **D1** · **E3** · **E4** · **E6** · **F5** · **F16** · **F20** · **F24** · **F25** · **F39** · **F42** · **F60** · **F88** · **F95** · **H1** · **K2** · **Q12′** · **Q13** · **Q18** · **S1** · **S2** · **S6** · **S7** · **S13**
- 🟢 **B11** · **B16** · **B22** · **B25** · **E7** · **F14** · **F17** · **F18** · **F19** · **F32** · **F52** · **F83** · **F87** · **F89** · **F93** · **F98** · **F99** · **F100** · **P14** · **R2** · ⬜ **K6** · **S16** · **S17** · **S19**

## 1. Before going public

The repo went PUBLIC on 2026-09-10 (MIT). What remains here is what a public repo still owes.

- **✅ Five items are DONE and have moved out** (history purge · raw Callsign assets · headset ids in the
  binary captures · dead branches · the APK out of git). One dated line each in
  [`archive/followups-closed.md`](archive/followups-closed.md) under *Closed 2026-09-10*. Two traps worth
  remembering are kept there: a **release tag can pin purged history** (`app-v0.1.6` had to be re-pointed
  through `.git/filter-repo/commit-map` before the objects would drop), and the site publishes **no** link
  into the repo while `site/build.mjs`'s `REPO_PUBLIC = false` — flipping that one switch restores every link
  at once, and the build FAILS if a manual page adds one back by hand.
- **⬜ Device identifiers in text history.** Sticker ids and BLE MACs remain in ~88 old commits (the tree is
  clean; `mcp/tests/test_docs_hygiene.py` keeps it that way). Deliberately not purged: they label Tony's own
  four headsets and grant nothing remotely. Revisit only if that judgement changes; it needs `--replace-text`
  plus a `--blob-callback` for binaries (`docs/gotchas.md` has the traps).
- **⬜ Release-sign the APK** (B21) and drop `webContentsDebuggingEnabled` before a build leaves the bench.
- **Standing rules.** Credit LaserTagMods in anything public-facing (CLAUDE.md hard rule). Keep
  `test_docs_hygiene.py` green: no sticker ids (write `Tactix-XXXX`), the Updated stamp above moves with the
  file, one id per H2, HANDOFF ≤ 150 lines, every relative link in `docs/` resolves. `~/.brx-mcp/armory.json`,
  `device-backups/`, the audio bank and `session-*.sqlite` stay out of the repo.

## 2. Extensibility — let outsiders build modes and sound packs (E1–E7)

Review + rationale: [`mode-extensibility.md`](archive/mode-extensibility.md). JSON re-skins shipped modes; a new ruleset
needs Python across ~4 core files, and the wire schema cannot carry a new mode's parameters. Do them in order.

- **E2 🟠** one `register_mode(name, engine_cls, meta, preset, scorer)` replacing the four hardcoded touch points. *(2026-09-11 late: `modes/registry.py` exists and `driver.build_engine` dispatches through it — E1's seed; the other three touch points are still hardcoded.)*
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
  (`$SIR,15,0,,28,...` — fn 28, not the fn 24 this row used to name; 24 proved the mechanism first and is
  unbearable in play) makes them arrive as `$HIR` -- proven on a gun, see F70.** That removes the "can we even
  hear a station" unknown from this design; what is left is the assembly. Design: on `$HP,0` re-spawn stunned (F15) ≥ 3 s later,
  node paints the dead look, station beacon arrives via the passthrough row, node checks team + delay, restores pools.
  Every link is proven separately; the assembly is not. Open: a downed gun still takes IR damage; FF must be ON for a
  same-team beacon. `build`.

## 4. Hardware, prints, research (H, R)

- **H1 🟡** reload-handle → push-button STL (version-tag it; older/newer handles differ). **H2 🟡** D-pad buttons STL.
  **H3 ⬜** Companion mount + ported audio box (with B1). **H4 ⬜** station enclosure (with B4). **H5 ⬜** skins.
  **H6 🟡** curated MIT sound pack + load guide (data-port swap, `community-notes.md`). All blocked on Tony's caliper
  measurements (reload socket, D-pad, rail). `hardware/print-files.md`.
- **H7 🟡** M5StickS3 station: 2× Stick + 3× Seeed Grove IR emitter ordered 2026-09-11 (`hardware/inventory.md`);
  firmware `hardware/m5sticks3/`. Gates: (1) a `proto=15 mag=8` grenade beacon decoded on G42 over RMT with the speaker
  amp off; (2) a HUD phone sees the Stick's kind-5 advert carrying that owner; (3) Grove-emitter range walk against the
  bare-LED cliff (8 to 10 ft). Ring + power bank are planned, not ordered. `hardware`.
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
  ✅ **The clip side is RULED OUT, offline, 2026-09-11 (evening):** `mcp/tools/soundbank_leadin.py` (stdlib + numpy, reads the raw s16le/44.1 kHz `.LTP` bank, first crossing of -40 dBFS relative to each clip's own peak, 5 ms windows) measured the whole shipped hit path at 0.000 s lead-in — H02/H36/H37/H22/H43/H06 all start immediately. Across all 2,477 ids on the gun only three exceed 0.5 s and none exceed 1.0 s (worst: J100 0.90 s, V108 0.90 s, SW31 0.57 s — long ambient/rules tracks, not hit sounds). Every id in `presentation.EVENTS` tops out around 0.1-0.2 s. **What is left is firmware latency after `$PLAY`, and it needs one filmed rung, not more theory:** phone at 240 fps, a batched `$GLED,6,6,6,0,10,,*` + `$PLAY` frame, light-to-first-sound off the video, repeated once for a slot-4 announcer line, once for a slot-1 effect, once for a real hit off the emitter. Narrowed from "measure it" to "film these three specific numbers"; stays `ears` + a camera.
- **F58 🟠 HEALING HAS NO FEEDBACK ON ANY SURFACE, and the two consumers disagree about it.** Tony, bench
  2026-09-09, after a real `$LIFE` heal took hp 6 → 25: *"it made a health hit sound. the sound wasn't heal"*.
  Three separate holes, found together:
  **(a) ✅ CLOSED 2026-09-11 (evening, bench):** all three now have sound and a paint, ear-confirmed solo. `healed` = the character's own slot-7 line (`voice:healed`: V37 "patched up", clean male take; V87 "Bleeding stopped", clean female take). `armour_up` = VA1G, "Body Armor.", Halo-style announcer (VA16 "armor suit" also clean, not chosen). `shield_up` = VA8C, "Shields online", with a sound effect. Wired in `presentation.EVENTS` and pinned by `test_presentation.py` the same night.
  **(b) ✅ CLOSED 2026-09-11 (late, second session): `stage.py` `_on_pools` now fires `healed`/`armour_up`/`shield_up` on a pool rise with engine.js's exact drop rules (`test_stage_mirror.py`).** It used to fire
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
  ✅ **Narrowed 2026-09-11 (evening, bench): this is an IR fact only.** Over BLE `$LIFE,0,0,20,*` filled the shield pool of a gun armed with the golden bundle (`$HP,45,70,20`) and `$LIFE,0,0,-20,*` emptied it again, on a table with no proto-1 row. So the shield pool CAN be filled in one of our games -- by the host, not by a word in the air. The IR side (a medic row nobody ships) stays open here; the host-side lever is **F109**.
- **F109 🟡 HOST-GRANTED SHIELDS AND HEALS: the `$LIFE` lever.** Proven 2026-09-11 (evening, bench): `$LIFE,<hp>,<armour>,<shield>,*` is additive per pool INCLUDING shields and takes negatives, with no `$SIR` row involved (F60 is IR-only). So a spawn perk (overshield), a phone/BLE station, a timed regen, a medic ROLE that grants over the LAN, or a hill-holder buff can all be node-written `$LIFE` frames -- no IR word, no new firmware state, and the shield hum (A10, F44) and the pool readout light up for free. Design: which grants, from whom, with what cap (F58 (d): `$LIFE,25` did nothing where `$LIFE,20` healed -- a per-grant cap is UNMEASURED and gates every design here). Related: S14 syphon (the first consumer), F60. `build` + one bench rung for the cap.
- **F65 🟢 `$BUMP` is inert on v4.32 — is that the command or our shape?** Bench 2026-09-09: `$BUMP,-5,0,0,*` on
  full HP and `$BUMP,0,5,0,*` on armour at 61 both did nothing, with the read validated either side (a real IR hit
  moved the pools and `$QUERY`'s `$LCD` tracked it). `$LIFE` with the identical arity worked in the same session, so
  this is not the connection or the arming. `brx-protocol.md` now says INERT. Open only as: does `$BUMP` want a
  different arity, a different game state, or is it dead firmware? Low value — `$LIFE` covers the need. `trigger`.
- **S19 🟢 Lighthouse pass on `/` and `/manual/`** once the photos are in: LCP with a real hero JPEG (consider
  `fetchpriority="high"` on the hero image and an eager load for the first shot), CLS (every image already
  carries width/height), a11y score, and an OG-image check with a real unfurler. The gate covers landmarks,
  contrast, targets and fonts; it does not measure load. `build`.
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
  ⚠ **Warning added 2026-09-11 (bench):** the "9-vs-18" expectation this design was built on is the fn-37
  HEADSET multiplier effect (`docs/weapon-design.md` §6.2, `compile.headset_multiplier()`), not the crit bit —
  15 headset hits that night all read tok6 = 0 while still landing the fn-37 scale. Run this probe with
  `$GSET` t7=0 (kills the fn-37 confound outright) or aimed at the GUN BODY (always ×1 regardless of t7), or
  the result will look like a t6 effect that is really t7 leaking through.
- **F63 🟡 `$WEAP` t7-t11, the secondary-fire block — a per-shot damage type?** `secondaryFireChance`,
  `secondaryDamageType`, `secondaryPowerType`, `secondaryDamage`, `secondaryCritChance`: **empty on all 20
  captured stock frames.** If t7 is a per-shot percentage that swaps the emitted `<protocol, subtype>` to the
  secondary pair, it is the ONLY way to vary a shot's damage type per trigger pull — the host cannot, because
  the gun emits autonomously on the pull. That unlocks proc weapons (a poison round on 15% of shots) and is the
  one route to a "miss" token besides F46. Probe on the RIG, counting words by protocol (aim t8/t9 at a free
  protocol: 4, 5, 7, 12, 14), and check whether `$GSET` t6 `secondaryBluetoothWeapons` gates it. `trigger` (bench C3).
- **F50 🟠** the A17 pain gate has never run in a REAL node path — only unit tests and grunts hand-played over
  BLE (brx-sound, 2026-09-07). The stage is now the only instrument that can exercise it, and any A17 audio
  judgement taken through the stage before `3388362` used the rejected shape-picked pools. Re-verify: an
  armour-absorbed hit stays silent, a hit that reaches HEALTH grunts, a hit that spills armour→health grunts
  (the innermost-moved-pool rule), and a lethal hit never grunts. `ears`.

- **F42 🟡** **the DRY-review backlog** (2026-09-07 Python review, agent team). Six bugs from that pass are FIXED
  and pushed; what is left is real but none of it is blocking. Evidence: every item below was measured, not read.
  **F42.1 ✅ ANSWERED 2026-09-11 (evening, bench):** the token slots are not equivalent — token 1 INTERRUPTS, token 4 QUEUES, and that is a property of the slot, not of the id (six trials, see `experiment-log/2026-09.md` → *the sound pass*). `presentation.cue_frames`'s token-4 `game_over` (VA33) is the one to keep: it queues behind an in-flight effect rather than cutting it, which is the right behaviour for an announcer line. `Compiler.cues()`'s `game_over`/`medal`/`multi` keys are dead — `cue_frames` overwrites them for the same resolved profile and nothing reads the stale copies — delete them on the next pass through `compile.py`. VA81 in slot 1 for the countdown stays confirmed and correct, unaffected by this. **F42.2** 12 bench tools hand-roll the body of `B.teardown_frames()`
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
  `mc/armory.py`'s `gen` check is case-sensitive, so `"Gen1"` silently becomes `gen2_3` (pinned as current
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
  (`END = ("$STOP,*", "$CLEAR,*")` in `diag/cases.py`), so running the diagnostic LEAVES the gun un-hittable** — F11,
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

- **F3 🟡** empty-mag / reload prompt never appeared on sustained full-auto. Gun and engine are eliminated from captures;
  what is left is the phone transport/render layer. Needs the phone's BLE frame ring (Share log before closing the app). `capture`.
- **F5 🟡 decision** the AR ships at 140 ms / reserve 192, not the captured 100 / 384 (balance; 100 strictly dominates 10 of
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
- **F13 🟡** a respawn within ~2 s of death wedges the headset in the green out-blink (threshold 2.0–2.5 s; use ≥ 3 s).
  (1) ✅ floored everywhere 2026-09-11 (F34 closed: PUT refuses 1–2 s, the node floors at 3 s, the CLI already did); (2) headset-side frame pacing of
  the arming burst is unverified (echo proves the gun got it, not that the headset executed it) `eyes`.
- **F14 🟢** HUD moment nits: a `gain` inside the 250 ms rare-moment guard is dropped (deliberate); the night hit-chip
  lost the shooter's team colour (deliberate); `engine.js` drops a `gain` when a frame damages and grants in one tick.
- **F16 🟡** `bench_common` half fixed: `BMAP` + `spawn_tail()` exist and `stun_hunt.py` uses them; the other
  operator-fires tools (`hittest`/`damage_bench` style) and a test pinning `BMAP` to MC's `_bmap()` remain. Re-read any
  past "trigger did nothing" negative from such a tool with this in mind. `build`.
- **F17 🟢** lives cap: DOWN recap shows LIVES LEFT only if `config.respawn.lives` exists; no mode sets it. `build`.
- **F18 🟢** FFA board is the top three players standing in for teams; a real FFA ladder is a small HUD follow-up. `build`.
- **F19 🟢** after a PANIC the HUD shows the plain kitted screen; add a "HOST STOPPED THE MATCH" pill. `build`.
- **F20 🟡 decision** kill confirm during a reload is deferred until the RELOADING takeover ends (~2 s). `decision`.
- **F21 🟡** status-bar / display-corner inset fixed in code (APK 0.1.6+); verify on the Pixel 4 and Pixel 10. `eyes`.
- **F24 🟡** MC-owned session totals (`session_totals` in the `score` push) so the phone's tally matches the laptop. `build`.
- **F25 🟡 decision** the kill strip says "CONFIRMED BY MISSION CONTROL"; true by construction (kills only arrive from MC),
  but an out-of-range player reads their kills as unconfirmed. Keep, or "ELIMINATION"? One string in `hud.js`. `decision`.
- **F26 🟡** (was F15) accuracy attribution unverified: `$HIR` shooter field → `player_num` as `scoring.py` assumes?
  Two guns, two phones, ten shots. `trigger`.
- **F27 🟡** (was F16) reload takeover timing: time `$BUT,2` → `$ALCD` per weapon; correct `weapons.json` **`reload_ms`** (there is no `reload_s` field; the old name here sent a bench pass looking for a key that does not exist). `trigger` + `ears`.
- **F28 🟡** (was field G1) headset sensor 1 (back dome) took zero hits in the 2026-09-01 match and 69 in the nozzle
  test; `outdoorMode`, daylight and uptime are refuted. `field-issues.md` F2-1 / `verify-together.md` V1. `eyes` + `space`.
- **F29 🟢** (was G3) the low-health alert is now logged when it fires; verify it in a match (V2). `eyes`.
- **F30 🟡** (was G5) a game whose rules fix the weapon/perk did not apply them; no evidence captured; repro with the config id. `capture`.
- **F32 🟢** (was G7) the perks menu on the phone is too small and hard to find. `build` (check `hud-review-2026-09-03.md` first).
- **Q13 🟡 decision** friendly fire is invisible on the wire (a team-blocked shot emits no `$HIR`). Either run FF on and
  score teamkills as policy, or accept no teamkill feedback. Decide before any mode advertises it. `decision`.
- **Q15 🔴** sub-indoor IR power (Tony: indoor bounces register hits from everywhere). Lever 1 = `$WEAP` t41
  `gunRangeIndoor` (75 on all guns, 20 on melee) — **one prior positive, see `weapon-design.md` §5 U2**; lever 2 =
  `$GSET` t3 `gunLaserRegion`. `$IRTX`/`$HFIRE` emit nothing on v4.32. **Run sheet:
  [`bench-super-indoor-2026-09-07.md`](bench-super-indoor-2026-09-07.md)** (MacBook — the rig has never run on
  macOS; find the margin before sweeping). A null is an answer. If it works, an `indoor_tight` venue preset.
  `space` (bench 2.1).
- **Q16 🟠** beam divergence: on-axis then 10–50° off-axis at 3 m, 10 shots each, closing control. Sharp fall-off ⇒ skip
  the snoot, cut power (t41, then an aperture attenuator). Black plastic is IR-transparent at 980 nm; test any snoot. `space` (bench 2.4).
- **Q18 🟡** ✅ the print half closed 2026-09-11 (late, second session): `modes/driver.py` probes `$PHONE` and waits for the gun's `$BUT`
  before it prints, counts or re-arms a reconnect (`test_reconnect_is_not_declared_until_the_gun_answers_the_probe`). Still untested: can a gun absent at START join a running match? `build` + `space`.

- **Q12′ 🟡 decision** should `hit_taken` carry the shield delta as its own field (both sessions said yes; `dmg: 0` invites
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
- **F36 🟡** **The published APK is unproven on hardware.** 0.1.8 is cut (2026-09-10, `app-v0.1.8`), published and advertised on the site,
  but no build since 0.1.6 (2026-09-04) has run on a phone; it carries the S7.1 rejoin anti-cheat, A11.7/A11.8 and A16/A17 LED work,
  the A15 voices and the hill work, and everything since 2026-09-11 (F81/F34/F47/F86/F103/F105, station arming) is on NO build yet. Install it before the next match. `trigger`.
- **S3 🟠** extraction on the phone path, HUD-driven (ARC Raiders / Fortnite Sprite reference): zone presence from the
  station beacon on the player's own gun; call → window → close timers on the node with `extraction_tick`; a wallet;
  hard end at expiry (`raid_ending` → `raid_over`); MC reconciles wallets at recap. Port `modes/extraction.py`'s rules,
  not its transport. `last_survivor` stays opt-in. `build`.
- **S6 🟡** kill the legacy shims (Tony: "we dont need to support legacy at all"): `presentation.EVENTS` `multi`/`medal`
  and `compile.cues()` `multi`/`medal`; `cues.team_led` + the pre-A11.6 bundle fallback; engine "older MC" defaults
  (`swap_ms` 850, kit-open flag, `feedback.cue`), `restore_snapshot()` pre-A11 normalising; the scorer's "kind stays
  kill" comment. Keep the "server predates this UI" banners. One sweep, regen the golden bundle, cut an APK. `build`.
- **S9 🟠** event sound pass on the gun stage, mostly closed by ear 2026-09-11 (evening) — what is left is the mode-preset sweep. `extraction_closing` = V114 ("10 seconds", Halo voice; VX0R rejected, it is the numbers/menu announcer). `extraction_complete` = VS7 ("Objective complete" with a call sound, Battle Company announcer voice; VQ8 rejected, the Nexus commander is a zombie/creature voice; VR7 is the same words in an Indian-accented male, kept as a note). `unstoppable` = VX0U ("Domination", Halo voice). `killing_spree` stays VA7K (both reads are clean; VA7K keeps the sting and matches the shipped VA7H/VA7E/VA7Q family). **`extraction_tick` = JAS, in the QUEUE slot (token 4)**, replacing the U100 trial: Tony heard JAS (10.7 s) as "a cool extraction sound, intro hype music" and asked for it to loop for extraction — the tick already re-fires every ~10 s, so JAS in slot 4 queues cleanly (F42.1) and never cuts an announcer line. JAQ (11 s, "good extraction sound too, ticking in the background") is the not-yet-assigned candidate for the window-open phase. U100 and U13 are both real ticks (U13 brighter); U100 goes back to being F44's shield-loop trial. `healed`/`armour_up`/`shield_up` now have sound (see F58(a), closed tonight). Wired: `presentation.py` carries a per-event `slot` field now, `presentation.EVENTS` is pinned by `test_presentation.py`, and `extraction_tick` is `JAS` with `slot: "queue"`. Still open: the mode-preset sweep, and assigning JAQ. `ears`.
- **S10 🔴** LED language v2 (A16): build [`led-language.md`](led-language.md) §3–§5. **Bench 2026-09-07 settled the
  down signal**: never send `$HLED,,6` in play (effect 6 disables the firmware's own death flash for the life; a
  colour write does not, so `dark` = `$HLED,9,0,,,10,,*`), write nothing at death, re-arm with one `$HLOOP,2,750,*`;
  **delete `death_flash` / `flash_frame` / `_deathFlash` / `_reassertDeathBlink` and the `death: flash` enum** -- `presentation.lights` block
  with the night OVERLAY (dim + sparse, never a blackout; the DOWN signal exempt), gun body DARK at rest with the
  transient pool readout (SEVEN levels since A16.3) + bursts, headset role states that survive hits (carrier white, infected,
  VIP, extraction beacon), the DOWN pulse with quiet gaps around death/`$SPAWN` and the eliminated cadence, `_lightGen`
  cancel on end/panic/resync, respawn white flash at +1.0 s, preset name on every `MODES` row, console lights editor +
  muster lights check + DOWN-screen copy. Findings table and build lanes in the doc. Gate for the down-signal timing:
  the L-ladder (bench sheet §6). **Sub-item ✅ CLOSED 2026-09-11 (late, second session, contracts A19):** `alert.role = {name, on, tid?}` reaches the node's
  `_setRole`; `config.vip_player_id` names the VIP and MC sends `vip` 3 s after go-live and after each VIP respawn
  (`_push_role`, `ROLE_SETTLE_MS`; the feed line says WITHHELD when the phone was out of Wi-Fi). `beacon` / `extracted`
  have the contract but no MC-side SIGNAL yet: no node fact says who is channelling, and MC runs no extraction engine (S3). `build` + `eyes`.
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
- **S1 leftovers 🟡** sound catalog: Tony's by-ear audit: **249 of 2477** distinct ids in `~/.brx-mcp/sound-audit.jsonl` (101 new on 2026-09-11 evening, in two sittings) and **`fx:hit` is COMPLETE** (all 122: 105 in the audit file + the 17 judged 2026-09-07 that live in `hitaudio.py`'s comments). New armour-family takes for A17's pool if it ever wants a fourth: H35/H39/H40/H54 "hammer on metal"; H52/H53/H58 "metal bucket"; H134/H135/H136 "typical hit" (health-hit candidates, health ships silent by decision). Still to hear: every other fx category; the category-driven picker in the MC game-mode editor. `ears` + `build`.
- **S-A12 sidearms 🟡** .1 ✅ **CLOSED 2026-09-11 (evening, bench):** P09 reads as "a pronounced shot, could be the Deagle"; P16 preferred for the GLOCK ("I like the deagle sound for the glock"); Q04 confirmed silenced, for the USP-S; **Deagle = X14** ("heavy rifle shot", "that could work"); reload chain D08->D07->D06 at 400 ms confirmed working. Wired in `weapons.json`: glock t27 = P16, deagle t27 = X14; usp keeps Q04.
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
- **P15 🟡** phone-as-station limits: which `$PLAY` id is a field-wide alarm (candidates from F44's failed shield-hum shortlist, 2026-09-11: N71/N72, both read as "security alert"/"very annoying security alarm" — promising for THIS use even though they failed as a shield loop); max simultaneous BLE links an Android phone holds. `ears` + `space`.
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
  them. **Narrowed 2026-09-10 (F73, closed — `archive/followups-closed.md`): enemy 8 and 24-28 are swept and written
  up** (fn 28 registers with nothing at all, fn 8 is silent but flashes and buzzes, fn 24-27 fire one long
  grenade-ish clip). **Left here: enemy 35, and ally 31 / 32 / 34** — bench-queue rung **D6**, whose three
  run-voiding traps are mandatory. Moot for the product if F15 ships. `trigger` (bench 1.5).
- **Explained 2026-09-11 (F23):** the 2026-08-27 24-cell ×1.0 matrix was the GUN BODY (always ×1); the ×1.25/×2
  runs measured the HEADSET. Different sensors, both correct. Kept: one 16/16 vs 4/10 registration run under
  identical geometry (2026-09-02).

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
- **F39 🟡 The real `$SIR` row ceiling.** "Max 14 distinct IR recognitions per game" is a community figure we have
  never measured; `hitaudio.MAX_SIR_ROWS` treats it as a soft budget. Push a 20-row table and check every row still
  registers. Gates `hit_audio_rekey`, which is DEFAULT OFF. Lower value now that F38 has ruled the class layer off
  by default — the rekey only matters if we ever choose per-weapon audio over per-pool.
- **F68 🔴 A MISS PERMANENTLY KILLS THE HEADSET TEAM COLOUR.** Bench-observed 2026-09-09, Tony watching a gun painted
  blue: a magnitude-0 word makes the headset **flash green exactly like a hit and then go dark, and it stays dark**. Same
  mechanism as the 2026-09-03 "a registered hit WIPES the headset" finding -- but a miss emits **no `$HIR` and no `$HP`**
  (F46), and our repaint lives inside the `dmg > 0` branch of the `$HIR` handler (`engine.js`, mirrored in `stage.py`), so the node never
  learns and never repaints. **Consequence: the first miss of a life removes that player's team identity until the next
  real hit or respawn** -- and A16.4 deliberately rests the GUN body on team colour for exactly the identity reason the
  headset just lost. Invisible today only because misses cannot happen at stock 100/100, so this ships the moment S17
  does. Fix needs a trigger that does not depend on damage: the node cannot see the miss at all, so either repaint on a
  timer/heartbeat while alive, or accept a dark headset and move team identity entirely to the gun body. **Also worth
  knowing for gameplay: a miss is VISUALLY IDENTICAL to a hit** (same green flash), so no observer can tell them apart. `build`.
- **F70 🟠 KING OF THE HILL IS A NATIVE PRIMITIVE, AND A HOSTED GAME CAN NOW READ IT.** Bench
  2026-09-10. **The wire is documented once, in
  [`protocol/brx-ir-protocol.md`](../protocol/brx-ir-protocol.md) §"The grenade beacon"** — beacon,
  capture pair, `mag=50`/`mag=53` semantics, ship-fn-28-not-24, polarity. Do not restate it here or anywhere
  else; this row is the OPEN work and the design consequences only. Reading it in one of our games is
  **done**: the compiled `$SIR` proto-15 row plus the phone-side parse (**F72**, both closed 2026-09-10).
  ✅ **SETTLED: CAPTURE IS CHARGE, ANY WEAPON CAN TAKE A POINT, AND THE ATTACKER WINS TIES.** The
  extra-headset-word hypothesis is **DEAD** — a re-armed gun emptied an AR magazine into a point another team
  held and took it on the 13th round, with no `t1=2` block involved. This matches `reference/grenade.md`'s
  prior hardware-confirmed charge mechanic and Tony's own native play, where every player captures regardless
  of weapon. **Two readings are RETRACTED and must not be repeated:** that an owned hill cannot be retaken at
  all, and that capture requires the extra-headset word. Two variables differed in the run that suggested
  otherwise (one shotgun word at 70 vs four AR rounds at 36) and the wrong one was picked, for the third time
  in one session. A third is retracted too: an earlier capture labelled "hill-neutral" reading `team=1` was a
  hill already OWNED by blue, so **any inference from "neutral = team 1" is void** (neutral is team 2).
  🟠 **WHAT THE CHARGE IS PRICED IN IS NOT SETTLED, and rung X is the trial that settles it.**
  Downgraded ✅ → 🟡 → 🟠 across two review passes, and the second downgrade is the damning one.
  ⚠️ **The discriminating trial changed TWO variables.** The shotgun's `mag=70` is its `t12`
  **extraHeadsetDamage** — an extra-headset word from a `t1=2` weapon — so "5 AR rounds (45) lost to one
  shotgun shell (70)" varied magnitude AND weapon-block together. It cannot separate *"magnitude is the
  currency"* from *"an extra-headset word captures out of proportion"*: **the very hypothesis the paragraph
  above declares dead**, and the fourth two-variable comparison in one session. The AR magdump kills "capture
  REQUIRES an extra-headset word"; it does NOT establish the exchange. ⚠️ **"Linear" is a word I should not
  have used**: 1:1 rests on **two points**, and two points define a line by construction, not by measurement.
  Nothing separates 1:1-linear from any curve through (1,1) and (5,5) — seed 20 and see whether it still costs
  20 before anyone builds an economy on a rate. The DIRECTION (more charge in costs more to take back) is
  solid.
  | seeded | contested with | totals | result |
  |---|---|---|---|
  | 1 AR (9) | 1 AR | 9 v 9 | flipped |
  | 5 AR (45) | 5 AR | 45 v 45 | flipped on the 5th |
  | 5 AR (45) | **1 shotgun (70)** | 45 v **70** | **flipped on one shell** |
  ⚠️ **Not "the higher total owns the point" — that table falsifies it.** Both AR flips landed at EXACT
  EQUALITY and a strict *higher* rule predicts neither; the only strictly-greater run is the confounded one.
  What is measured is **`attacker >= defender` flips**. Whether a strict majority is ever required is untested.
  ⚠ **Max charge is unmeasured** (rung M): does a hill cap, and how long does a full one take to build?
  **The clean experiment nobody has run (rung X): a HIGH-MAGNITUDE word from a non-`t1=2` weapon** — boost an
  AR's `$WEAP` t5 to ~70 and fire it into a hill seeded with 45. Until it runs, **F76**'s contradicting
  per-weapon round counts have a candidate resolution nobody has ruled out: the counts could be right for
  ordinary rounds while the three extra-headset weapons capture disproportionately — which is the same shape as
  `reference/grenade.md`'s *"a thrown grenade blast instantly captures 100%"*.
  **If magnitude does win, the design consequence is a good one:** a weapon's capture power EQUALS its damage
  automatically, so a shotgun or rocket seizes a point in one hit, a rifleman needs a burst, and a defended
  point costs an attacker what the defender invested — a coherent objective economy falling out of the weapon
  balance we already tune, with no separate capture stat and no host rules. **Do not build that economy yet.**
  **Node work still open here:** track the owner, drive the scoring, and pick the `$SIR` row's `<soundID>`
  deliberately (moot on fn 28, which ignores it — rung Y). Cross-refs: **F88** no beacon carries a station id ·
  **F82** no tid 2 · **F91** (closed 2026-09-11, retired: the chip damage was fn 24 manufacturing ticks inside
  the gun, not a wire word) · **F87** the rate-of-fire boost. `build`.
- **F82 🟡 NOBODY MAY BE ON TEAM 2 IN A HILL MODE — the GUARD has shipped; the HARDWARE claim is still
  untested.** Found in review 2026-09-10, falls straight out of F70. **A neutral hill broadcasts team 2.** The
  firmware's polarity gate compares that against the receiving gun's own `$TID`, so a roster containing team 2
  should read every NEUTRAL point as its OWN: those players go deaf to neutral hills under an enemy-only row,
  and the `proto=0` damage word that punishes intruders cannot land on them — team 2 gets free run of every
  uncaptured point while everyone else is contested.
  ✅ **The headline "and nothing in MC stops it" is no longer true, and is corrected here.** Three independent
  refusals ship: `mc/state.py`'s validate refuses a hill config that contains tid 2 *at all*, roster or not
  (`NEUTRAL_TEAM` imported from `hillbeacon.py` so one constant drives both), `DominationEngine.add_player`
  refuses the player, and `assign_teams` defaults domination/koth to 1/3. Pinned by `test_hillbeacon.py`
  §9 **with a control** — the identical config on tid 3 raises nothing, and tdm on tid 2 raises nothing, so the
  guard is reading the tid and the mode rather than always firing.
  ⚠ **What is still open is the measurement.** The consequence above is PREDICTED from the polarity rule plus
  "neutral = team 2" — both measured — and has never been observed directly. Rung **D** (two guns, opposing
  teams, one carrying the row) would show it. Downgraded from 🔴 because nothing can reach the hazard
  through MC any more; keep the rung, because a guard built on an unobserved mechanism is worth confirming.
  Cross-ref **F97** (this is what caps an FFA hill at three players). `bench`.
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
  live bug and deliberately not fixed:** `assign_teams` never returns 0 for **domination / cs / ctf**
  (domination/koth alternate 1/3, infection/survival 1/2, else 1/2), so tid 0 is reachable there only by hand.
  ⚠ **Corrected 2026-09-11: the parenthetical used to say "ffa/extraction use `i+1`", and that is no longer
  true** — F96's fix made FFA/extraction **0-based**, so the first gun really does get tid 0. That path does not
  go through `_team()` and the conclusion is unchanged, but the sentence was evidence for a claim it no longer
  supports.
  ⚠ **Corrected 2026-09-10: the second reason this row gave has expired.** It said MC's `MODES` catalogue does
  not list domination/koth/ctf/cs at all — **`koth` is in the catalogue now** (it shipped with the hill bridge),
  so the mode IS selectable by an operator and `assign_teams` is the only thing keeping tid 0 out of it. The
  conclusion still holds; it now rests on one leg instead of two. Recorded so nobody "fixes" it later
  assuming it is reachable by default — and so nobody routes BEACONS through `_team()`, which WOULD break:
  a beacon's team 0 is genuinely red, bench-captured 2026-09-10 taking a blue-held hill. `build`.
- **F93 🟢 A PROXIMITY LAYER IS ALREADY ARRIVING ON EVERY PHONE AND BEING DISCARDED.** Opened 2026-09-10
  (Tony's idea, and his design call recorded below). `app/src/app.js:121` feeds **every** OBRX advert into the
  presence tracker — `presence.observe(hit.uuids, hit.rssi, …)`, low-latency scan mode, open for the whole
  match — and `Presence` decodes role, so **player** adverts land in it alongside stations. But `app.js`
  surfaces only `presence.stations()` to the engine (via `engine.setStations()`): **`presence.players()` is populated and unused.** Every
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
- **F95 🟡 THE LAN-COUPLED VARIANT: ROAMING HILLS — A DELIBERATE A4.8 EXCEPTION. Specified as
  `spec/utility.md` §5e; this row is the open work.** Tony's second, opt-in mode for a small field where every
  point really is on one Wi-Fi (his example: one hill in the garage, another on the porch, both on the house AP).
  ⚠ **SCOPE NARROWED 2026-09-10 by F98/§5f: points-to-win is OUT, roaming hills is all that is left.** A
  Territories station scores itself offline and reports at recap (plain §5c), so only the form of a points race
  that **ends the match early** on crossing a target needs a live sum — and **Tony has declined that form: the
  target is read at the horn.** So it is not "allowed but unbuilt"; reviving it means opening a second A4.8
  exception and saying so.
  🔴 **The exception is the headline, not a footnote.** `spec/contracts.md` §5 **[A4.8]** says *"nothing about the
  match outcome depends on coverage"*, and an MC-driven hill rotation **does** — a point out of Wi-Fi range is not
  merely invisible, it is not in the game. Fenced: only modes flagged `lan_coupled`, never F94's base mode.
  **If this is built, A4.8 gains a pointer to §5e** — an exception not written next to the rule it breaks is a bug
  waiting to be rediscovered.
  ✅ **§5e.4's LAN-loss behaviour is DECIDED (Tony, 2026-09-10), accepted exactly as proposed** and written up
  there; the rationale worth repeating is that a win computed from data we know is incomplete is not a win.
  **Open build work:** the two setup surfaces, which are part of the job and not polish — (a) MC's `SETUP:`
  `config_warnings` entry naming how many control points are linked, plus link state and attention per phone in
  the ITEMS panel (**reuse that channel, do not invent one**); and (b) the utility screen promoting its MC-link
  line to a blocking band, because the person who can fix Wi-Fi is standing in front of that phone and not in
  front of MC. Needs **F94** first, and A1/A2. `build`.
- **F98 🟢 TERRITORIES: THE MULTI-POINT MODE THAT SOLVES CAMPING BY CONSTRUCTION AND NEEDS NO LAN.** Tony's
  design, 2026-09-10, in his words: *"you tick points whether you are there or not. You turn it your colour and
  then you go find the next territory."* **Specified in full as `spec/utility.md` §5f — the rule, the linear
  scoring, the two configurable rates and the decisions below all live there; this row is the open work and the
  corrections.** §5d needs no change: it already scores OWNERSHIP rather than presence, which is why this is
  cheap.
  🔴 **It SHRINKS the A4.8 exception, and that is the load-bearing consequence.** A Territories station is its own
  scorekeeper — it decided the owner, it is on the point all match, it already persists its tally across a reboot
  — so it accrues locally and reports at recap, needing no coverage. **F95 claimed points-to-win as a second
  reason for the exception and that was over-claimed:** only the form that ENDS the match early needs a live sum.
  The exception is down to **roaming hills alone** (F95, scope narrowed).
  ⚠ **Territories does NOT work on grenades, and the reason is OBSERVATION, not memory.** A grenade holds its
  ownership unattended perfectly well (F70), but ownership travels **only over IR and only a gun receives IR**
  (**F92**), so an unattended grenade territory is **unverifiable** — a rival flips a far point and nobody learns
  until a player wanders into range (rung R: solid close in, 85 s and 145 s dropouts by ~30 ft). Eventually-
  consistent scoring is fine as flavour and unusable as a win condition. ➡ **So Territories is the strongest case
  for the phone control point (F94):** a phone station IS the observer a grenade lacks.
  ⚠ **The spec's byte-10 encoding was the STALE side, corrected 2026-09-10** — the wire is **independent flags**
  (`CONTROL_STATE` in `app/src/control.js`), shipped and self-consistent, so nobody should "fix" the code toward
  the old packed-bitfield prose. **One reader rule survives from the packed draft:** `rising && falling` is
  **invalid** and a reader must fall back to neither, because packing made that contradiction unrepresentable and
  flags do not. Also corrected: byte 9 carries the **claimant** while `held` is clear, so callouts key off the
  decoded owner and never off raw byte 9.
  ⚠ **Two warnings worth keeping out of the spec's prose:** the conversion rate and the score tick are **two
  different numbers** that must stay separate in config, and **both shipped values are proposals** — Tony asked
  for a good default, not for these. And **do not cite "Halo" as one answer**: Halo 4 *Dominion* ticked per base,
  *Strongholds* is the majority threshold. The threshold was rejected for our point counts, not on merit (it needs
  THREE points to mean anything); ➡ revisit it if a three-point Territories game is ever built.
  ⬜ **The ONE item still open** (§5f.7): **scale ADVANTAGE rather than points** — holding more territories
  **shortens your respawn delay** (*Dominion*). `respawn_s` is host-driven and already the lever §4/§5d use, so it
  is buildable today with no new mechanism; it compounds board control without the score snowballing and composes
  with the linear score. Needs Tony's sign-off before anyone builds it. `build`.
- **F99 🟢 AN M5STACK STATION IS THE IR↔BLE BRIDGE, AND THE ONLY THING THAT CAN GRANT A SHIELD.** Tony's
  idea 2026-09-10, and it is the piece that makes the grenades genuinely useful inside Open BRX rather than a
  parallel toy. `hardware/brx-companion-spec.md` already names the **M5StickC Plus2 (~$20)** as the closest
  off-the-shelf ESP32 — rugged case, battery, buttons, screen, LED and **IR TX** — with a Grove **IR RX**
  (~$5) and a battery base (~$10) making a pocketable unit at ~$30-35 with **no fabrication**. Two capability
  unlocks a phone can never have:
  **(a) IT CAN GRANT A SHIELD.** `spec/utility.md` §5's powerup row names the limit: everything else a powerup
  gives rides BLE (`$LIFE` armor/HP, `$WEAP`+`$AMMO`, ammo) but **shields are "IR fn-11 only"**, so no phone
  can ever grant one. F60/P16: **"nothing shield-shaped has EVER been on a gun"**, which is why the teal shield
  bar and A16.5's handover remain unverifiable. An M5Stack emitting an fn-11 word would be the first thing in
  this project to put a shield on a gun. ⚠ The emit side is already proven — our ESP32 rig has had synthetic
  IR words accepted by a stock tagger — so this is packaging, not research.
  **(b) IT CLOSES F92, WHICH UNBLOCKS THE WHOLE GRENADE-PLUS-PHONE DESIGN.** A utility phone has no IR
  receiver, so a grenade's ownership is invisible to the BLE world and a phone station cannot learn who holds a
  hill. An M5Stack with IR RX hears the beacon and re-broadcasts the owner in a BLE advert:
  `grenade --IR--> M5Stack --BLE--> phone stations + every player's phone`. That makes Tony's coupling work
  (hold the hill, get faster respawns) with **no LAN and no MC**, and it gives a grenade hill a station id it
  otherwise cannot have — which is the F88 wall. Plan: one M5Stack per grenade as a bridge, plus spares as
  powerups. ⚠ Do NOT confuse this with running the app on one: `app/` is a Capacitor web app and an ESP32 has
  no WebView, so the logic is a C++ reimplementation under `firmware/`, and it becomes a **THIRD** engine to
  keep in sync with `engine.js` and `stage.py` — the repo's highest-yield bug class (7 of 9 defects in one
  night). Keep the bridge DUMB: hear IR, republish, no game rules. `build` + `hardware`.
- **F100 🟢 A WEARABLE POWERUP, AND DEATH MAKES YOU DROP IT — ENFORCED BY RADIO, NOT BY HONOUR.** Tony's
  design 2026-09-10: clip an M5Stack (or any station-role device) to a physical prop such as a mask. **Wear
  the mask and you get faster rate of fire; die wearing it and you cannot respawn until you physically leave
  its range** — you have to put it down and walk away. His words: *"could enforce it with technology"*, and
  that is the appeal: the rule is not a convention players agree to honour, it is a radio condition the node
  checks. It also creates a real risk/reward loop: the buff is strongest for whoever is pushing, and dying
  with it hands the enemy a chance to take it.
  **Everything needed already exists.** Presence is a smoothed-RSSI bubble with a dwell (bench-tuned -74 dBm
  at high TX, 0.8 s, ~10 ft), the phone already reads station adverts, `respawn_s` and `$SPAWN` are
  host-driven so the phone can simply decline to respawn, and the RoF lever is `$WEAP` **t14** in ms/round
  (bench-calibrated: t14 = 100 gave 101.6-102.0 ms/round), so a buff is a lower t14. ⚠ A `$WEAP` re-push
  **resets ammo**, so applying or removing the buff must re-send `$AMMO` with the live count or it is a free
  reload exploit (see F87).
  **Design questions to settle before building, none of them blockers:**
  (1) **A new kind, or a powerup variant?** Every existing kind is a PLACED item; this one MOVES with a
  player, and `kind 2 powerup` is specced as "ready or depleted + cooldown", not a persistent worn buff.
  (2) **Who gets the buff when two players are near it?** The advert cannot say who is carrying it, only who
  is nearby. Nearest by RSSI is the obvious rule and RSSI is a poor judge of that.
  (3) 🔴 **The blocked-respawn rule is griefable and the grief is interesting**: a teammate who picks the mask
  up and stands over your body keeps you dead. Decide whether that is a bug or a tactic.
  (4) **The bubble is not a boundary.** No direction, ~10 ft nominal, wrecked by body blocking and
  orientation, so "I dropped it" may read as 8 ft one moment and 15 ft the next. A dwell on the LEAVE
  transition matters as much as on the enter.
  (5) **Self-declared presence.** Adverts are unauthenticated, so a player could claim proximity they do not
  have. Accepted tradeoff for friends on a LAN, but a persistent RoF buff is a stronger temptation than a
  respawn, so say so out loud rather than discovering it. `build` + a design pass.
- **F108 🟡 MC PRINTS ITS "Mission Control http://…:8765/" BANNER BEFORE UVICORN BINDS THE PORT** (`__main__.py main()`), so a launch onto a busy :8765 shows the success line first and the `[Errno 98] address already in use` a line later, and every curl/browser check after that is answered by the squatter (2026-09-11: a 7-hour-old `--demo` MC from an earlier session). Found dogfooding "start Mission Control" as a fresh agent. Fix: probe/bind first (or print after `uvicorn` reports startup), exit non-zero with "something else owns :8765" — the e2e already does this check in JS (`koth.mjs startMC`). Related: `vite.config.ts` proxies :8765 only, so `--port` cannot rescue `npm run dev`; a `MC_PORT` env for the proxy would. Docs now warn (`mc/README.md` → Start it). `build`.
- **F106 🟢 STATION-ARMING LOWS FROM THE 2026-09-11 POLISH PASS (PR #1).** ✅ (a) (b) (c) (d) (e) (i) fixed 2026-09-11 (late, second session); **(f) (g) (h) stand.** The original list, for the record: (a) `abort_start` leaves `_game_no_started` set, so the next muster push bumps the game byte though no match ran (harmless: the point resets to neutral; the ITEMS "GAME n" counter drifts); (b) `net.py _fire_node` never forwards `app_ver`, so `station.app_ver` is always None off a real socket; (c) a node that was bound as a player and re-hellos as `utility` keeps its `node_player` entry; (d) `_finish` still sends `pull_log` to utility nodes and `abort_start` still broadcasts to them (noise); (e) `engine.js _stationAllowed` is PERMISSIVE when `config.stations` is absent, so clearing the LAST station re-opens the allow-list to everything (matches the seven-tap hand-arm fallback; the `types.py` comment should say so); (f) `control.js` credits possession from `Date.now()` unclamped, so a forward clock step is credited to the owner in full (a cap would also under-report; decide a bound); (g) ITEMS: "n/m ARMED" excludes a card whose only flag is BATTERY LOW; CLEAR has no confirm and the phone keeps advertising the old assignment with nothing on the card saying so; `TID_NAME` hardcodes colour names where LOBBY uses `teams[].name`; the PHONE/LINK rows are unpaired spans for a screen reader; the Recap `warnings` block is styled like PROVISIONAL; (h) `delay_s: 0` still means 10 s on the node with no message; (i) API.md omits `app_ver` from `StationView`; the mock's `online` is always true so OUT OF WI-FI cannot be demoed. `build`.
- **F107 🟢 LOWS FROM THE 2026-09-11 (LATE, SECOND SESSION) POLISH LOOP.** Noted, not fixed: (a) `net.py _fire_node` never forwards `gun_fw` while `_on_node` copies a `fw` key that never arrives (the `app_ver` shape again); (b) `_role_due` is not cleared on end/recall/panic (the phase gate in `_push_role` covers it); session.json `v` stays 1 though the shape gained `stations`/`game_no`; (c) F57 suppresses the grunt even when the profile writes no `hurt` line (announcer off, pre-A15 bundle): one fully silent hit per life there; (d) a reload pull while stunned starts the HUD RELOADING takeover off the frozen pre-stun reserve; (e) the stage logs a `warn` on every EMP because no profile carries `stunned`/`stun_over` cues (the phone is silent) — **candidates surfaced 2026-09-11 (evening) from the S1 `fx:hit` pass: H20/H21, "hit then electrical pulse, could be EMP disable"** — not auditioned in context, just noted while auditing the wider `fx:hit` batch; (f) `utility.js` `?stage` persists `settings.mc = 'stage://mc'`; (g) `Recap.tsx STATION_TID_NAME` duplicates `Items.tsx TID_NAME`; `types.py Stun.duration_s` is `int` while the validator accepts a float; contracts §10 rows A18-A20 sit above A1; CLAUDE.md still says amendments A1-A14; (h) E1 leftovers: no Designer editor for `mode_params` (not even read-only) and no phone-side consumer; (i) A19 leftovers: `beacon` / `extracted` have no MC-side signal (see S10); (j) `_endReconcile` re-arms with the frame's `$AMMO` but leaves `_prevAmmo`/`_prevReserve` at the pre-drop pair, so a stun before the next `$ALCD` restores the older (lower) pair -- never a refill, same shape on the stage; (k) `restore_snapshot` resets an out-of-range stored `mode_params` value to its default with no log line; (l) the `role: utility` status from a bound player logs once per heartbeat. `build`.
- **F80 🟡 A GUN WHOSE `$PSET` NEVER LANDED PLAYS THE WHOLE MATCH WITH NO IDENTITY, AND NOW SCORES NOTHING.** ➡ **Narrowed 2026-09-11 (late): the AFTER-the-match surface is built** — the recap's `warnings` count every hit and death from wire id 0 ("a grenade hill's damage word, or a gun whose $PSET never landed") and RECAP renders it, so a mis-armed gun is no longer invisible. **Still open: the ARM-TIME refusal** (`$QUERY` read-back, B19) and a muster flag, which needs a signal the node does not report today (the head echo is an `$LCD`, it carries no id).
  Opened 2026-09-10 as the honest other half of F69's fix. Wire 0 is not only environmental: a gun that never
  received `$PSET` fires with player id **0** (`manual/dev.md`: *"every gun on that capture sat on the default
  id"*), and `compile.py`'s try-out path relies on exactly that. The F69 guard makes attribution refuse wire
  0, which is right for a hill and **costs a mis-armed gun every kill it makes** — previously those reached its
  team via `sole_member_of_team`. ⚠ **A single `$HIR` cannot separate the two cases, so do not fix this in
  attribution;** any heuristic there is a guess that will silently mis-score one of them. **The fix is at ARM
  TIME:** MC should confirm `$PSET` landed (`$QUERY` the gun, or read back the id) and refuse to start a player
  with no identity, rather than letting an identity-less gun into a match. Cheap interim: surface it in the
  muster screen — a gun reporting id 0 is a gun that will score nothing. `build`.
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
- **F74 🟡 A GUN ONCE LATCHED AN IR EVENT AND REPLAYED IT WITH NO IR IN THE AIR — the mechanism is now
  understood, the SELF-replay is not.** Bench 2026-09-10, measured from both directions. The gun emitted
  `$HIR,0,0,42,0,20,0,0` + `$HP` **every 5.07 s, indefinitely**, while **board A recorded ZERO bursts across an
  18 s capture** — nothing was transmitting. The grenade was off, the emitter was idle, and the operator was
  stationary. It **survived three `$PLAYX,0,*`** (the audio went quiet briefly and the event kept going) and was
  **cleared by `$SPAWN,,*`** — the same command that clears the `$SIR` fn-23 state, so `$SPAWN` looks like the
  general "drop stuck IR state" lever.
  **It already cost us a result:** the U11′ sweep (F73) ran with phantom hits mixed into every trial, which is
  what produced "multiple sounds per shot" and sent me chasing multipath. Tony called it early — *"i think it
  also queues the events on the tagger"* — and I looked at rig geometry instead.
  **It is the whole EVENT, not queued audio** (Tony proposed audio queueing, then ruled it out himself): the
  **headset flashed** on every repeat, and the wire carries `$HIR` **and** `$HP` each time. The durations settle
  it too — every hit clip in the `$PSET` is 0.36-0.79 s (`H06` .43, `H55` .36, `H13` .79, `H21` .74, `H02` .39),
  so nothing retriggered at 5 s can overlap itself into a "growing" sound.
  ✅ **Which clip is the hiss is now answered (bench 2026-09-11): it is fn 24-27's own clip.** The same
  hiss-then-explosion sequence heard during these runs is exactly what a live `$SIR,15,0,,24` beacon plays every
  ~5 s (see F69/F91's close), so it is not `A10` or a fall-through — it is the function's own effect, playing on
  a real ~5 s cycle rather than nothing.
  **Downgraded 🔴 → 🟡 (bench 2026-09-11): the TRIGGER is identified as the fn 24-27 blast family, and the
  proposed node-side guard is no longer justified.** Arming the beacon cell with fn 24 and watching it live
  produces the same shape as this row — a fixed-period `$HIR`+`$HP` repeat with a delay baked into the function
  — but each tick traces to a real beacon and stops within one period of the beacon stopping (60+ s of silence,
  zero further ticks, board A confirming no IR). **Self-replay with NO IR in the air at all — this row's
  original 2026-09-10 observation — was NOT reproduced tonight and stays open and unexplained.** The rule to
  ship is simply "never put fn 24-27 on any cell," which needs no defensive code; a node-side guard (identical
  `$HIR` at a fixed period with no `$ALCD` from any shooter) would still be worth having if the original
  observation ever recurs, but nothing justifies building it from tonight's evidence. Also still open: does it
  survive a BLE drop, and was the grenade actually fully off during the 2026-09-10 capture (never independently
  confirmed with a receiver on the grenade itself). `trigger`.
- **F71 🟠 The three headset weapons may do far more damage than we publish.** The catalog derives `dmg`, `htk`
  and `ttk_ms` from `$WEAP` **t5 alone**. But the shotgun's capture word went out at **magnitude 70** = its
  `t12` extraHeadsetDamage, alongside a t5 of 45 — so at headset range a shotgun may land **115, not 45**, and
  the rocket (t12=115) and plasma sniper (t12=80) likewise. If so every hits-to-kill number we print for those
  three is wrong at exactly the range they are built for, and `test_ttk_band` is validating a fiction. Same
  family as **F23** (damage depends on the sensor). Probe: fire each of the three at a victim at headset range
  and at gun range, and read the `$HP` delta against t5 and t5+t12. Only ONE word (`mag=70`) decoded on the
  shotgun shot, so whether the primary goes out too is open — the second half of that burst was undecodable. `trigger`.
  ⚠ **Cross-ref added 2026-09-11 (bench):** this is a DIFFERENT mechanism from F23's headset scaling, now closed
  and explained by `$SIR` fn 36/37 + the compiled `$GSET` t7 (`docs/weapon-design.md` §6.2). F71's candidate is
  `$WEAP` t12 `extraHeadsetDamage`, a per-weapon token added on top of t5 at headset range, which is orthogonal to
  the fn-driven multiplier and untested either way. Both could be true on the same shot; probe both.
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

**Trigger in hand** (one gun, our compiled game, Tony firing):
- 1.1 **K4** melee swing, watch `$BUT,8` / `$HIR,…,13`.
- 1.4 **K1** `$WEAP` t19 = 5, pull the trigger on an empty chamber, watch `$ALCD`.
- 1.5 **U11′** fire enemy **35** and ally **31, 32, 34** at a held gun; report what you hear, see, or cannot do.
  (Enemy 8 and 24-28 are done — F73, closed 2026-09-11.)
  1.5a first (keyboard): `mcp/tools/ally_remeasure.py <victim>` with fn 10/11 as positive controls.
- 1.6 KotH rate-of-fire buff: while ally 31/32/34 land, hold the trigger and listen for cadence.
- 1.7 t37/t38 overheat: two varied-value probes on the SMG frame, watch the `$ALCD` heat gauge.
- 1.8 **U4/U5** one long reload with a stopwatch; hold the AR trigger and listen.
- **F15** (closed 2026-09-11, built unproven) rung 9: fire a proto-8 word at a gun armed with `config.stun` — expect `$AMMO,<slot>,0,0,1` from the node and the live counts back after 10 s; then `$BHIT` with the `$HIR` field set as the cheaper source.
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

**Ears:** **P3** voice-pack token; **W4a** Energy Launcher fire
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
