# Closed followups (archive)

Sections run oldest first, so the newest closure is last. Each dated line is one closed id; the id stays retired.

# Id history (moved from FOLLOWUPS.md on 2026-09-24)

How the ids were allocated, and every collision and renumber. The live "Next free" list stays in FOLLOWUPS.md.

(2026-09-19: **R4** taken, the stock firmware images.) (2026-09-19, the toxin lane: **F290-F292** taken, and **S16** closed.) (2026-09-19, pre-game office test: **F293-F298** taken — the P0 link-loop root cause, the MC network sweep's missing 192.168.0.55, ten pre-existing phone-screens overlay failures on main, a stronger dead-headset LED pattern, the BLE setup-reliability metrics bench, and a Shields-preset in-match test. These rows were filed as F290-F295 and **renumbered F293-F298** by the 2026-09-19 merge, because the toxin lane had already pushed its own F290-F292; the lane that pushed first keeps the ids. **F121** and **F209** CLOSED, superseded by the 0.4.3 respawn-profile rebuild — see `archive/followups-closed.md`.) (2026-09-18, polish review #2: **F289** taken — an offline player mid-protection-window may stay invulnerable.) (2026-09-18 night, the three-lane close: **F283-F285** taken (F282 went to the Suppressor bench the same hour): the soak's phone pacing, the phone's offline give-up policy, and the `$TMP` write-behaviour table.) (2026-09-18 evening, the drive integration: **F269-F274** taken. F269-F273 are the transport-hardening measures of `spec/transport-hardening.md` §8, and F274 is the recoil writer's write budget. They skip F261-F268, which the fix/playtest-2026-09-13 branch uses. F255-F259 are that branch's rows, closed and archived there. F206 root-caused and its fix shipped; the F206 row closed on 2026-09-16, and levers §1 run f is the open end-to-end proof. **→ 2026-09-18, confirmed at the wire level** (levers §1 runs a-e: run a reproduces F206 with 0 hits, run b fixes it with 6 hits and `$HIR` token 4 = 2); run f, a real TDM through Mission Control, is the only part still open.) (2026-09-18: **F260** taken: the two-word weapons double-count HITS in the recap. F255-F259 belong to the fix/playtest-2026-09-13 branch. **F254** taken: at what `t13` value does the headset word (t12) stop
arriving; filed alongside the t12/t13/t42 balance change; **renumbered F275** by the 2026-09-18 merge, see below.) ⚠ **F254 collided**: this branch filed F254 for the eleven-row `$SIR` table and closed it on the 2026-09-18 bench, while main filed its own F254 for the headset word's reach. **The archived row keeps the id**, because `archive/followups-closed.md` is immutable history and a closed id must stay citable; **main's open row is renumbered F275**, the same rule that settled the F253 collision the same day. Its references moved with it in `docs/weapon-design.md`, `mcp/brx_mcp/mc/compile.py` and `mcp/tests/test_mc_compile.py`; the `experiment-log` entry keeps F254 because the log is history too.
(2026-09-17 merge of the brx-weapons arsenal rework: this branch's thirteen
verification rows moved from F230-F242 to **F235-F247**, because main had already taken F230-F234. **F248** taken for the merge's one visible consequence, and **F249** for the `connect()` alias bug that F234 had carried as a second item. **F248 closed** the same night; **F250** taken for the night skin's missing pip gauge, and **F251-F252** from the DRY review. **F253** taken and **B25 closed** by the polish review; **F254** by the 2026-09-18 merge review; **F256-F259**, **F261** and **F262** from the 2026-09-18 bench, and F260 left to main, which took it for the accuracy over-report. **F263-F266** from the same bench: the two-word weapon measurement, the dead-gun desync, the frozen scoreboard, and the slow-link echo. **F267-F268** and **S54** from the F259 second step: the unanswered press, the ladder's two judgements, and the catalogue fields that are still unwired. (2026-09-18 night: the six ids after F268 belong to the brx-ltm session by agreement, so this branch takes F275 upward.) (2026-09-19: the two ids after F279 are the brx-weapons session's, agreed by message after a SIXTH near-collision: it claimed F279 for its own row without knowing F279 was already filed and pushed here. The lesson is that claiming an id by writing its row only works once the row is PUSHED; an unpushed claim is invisible to the other session.) ⚠ **F253 collided**: main filed and closed its own F253 (the stun cell shipping fn 24) on 2026-09-18 while this branch was carrying F253 for the reserve question. Main's is the one that keeps the id, because it is closed and archived; **this branch's reserve row is renumbered F255** and closed the same day, because the bench answered it. **S53** is main's (the smoke tell on the HUD), and this branch owns it.)
(2026-09-17 verification bench: F215, F217 and F218 closed; F235-F247 taken for the
verification bench and one folded-in residue row.) (2026-09-17 bench pass on
the same playtest: **F206, F207, F212, F213, F210, F211**
closed, **F201** closed as answered by F207; **F217-F224** taken for the desk fixes' bench gates and two decisions
for Tony.) (2026-09-17 night: **S52** taken, the missing Easy Reload hint on the HUD, and **S51**, the cooldown perk family.) (2026-09-17 evening: **S50** taken, the perk balance pass.) (2026-09-17 evening: **S49** taken, the portable IR receiver.) (2026-09-17 range test, garden/MacBook, step 3 of `archive/bench-weapons-2026-09-17.md`: **F231-F234** and **S48** taken; **F170 closed** → archive; Q15's t41 half answered (null).) (2026-09-17 weapons bench, `archive/bench-weapons-2026-09-17.md`: **F225-F230** and **S42-S47** taken; F217-F224 belong to the fix/playtest-2026-09-13 branch.) (2026-09-16 write-up of the 2026-09-13 evening playtest: **F206-F216** taken, all from
[`game-test-2026-09-13.md`](game-test-2026-09-13.md); F201 is ANSWERED by F207 and F203 gained a second field sighting.)
(2026-09-14: H8 taken — the Stick as an MC-armed utility node, `spec/utility.md` §5g.) (2026-09-13 GSET field handoff: F197-F205 filed from archive/HANDOFF-gset-t2-2026-09-13.md §3.)
(2026-09-12 integration of the field branch into the fix branch: the two rows the fix branch had filed as F135 and F136 collide with the field session's own F135/F136 and are **RENUMBERED to F162** (no outdoor IR range) and **F163** (the B4 link watchdog) — the second collision renumber in this file, same cause as 2026-09-06: two sessions read "next free" at once. No upstream row moved. F146 and F157 closed → archive with the merge; the PR #4 list closed → archive (F135 F137-F145 F147 F149-F151 F153-F156, S37-S41).) (2026-09-12 pyright gate: F134 filed; F42.10 closed → archive, F42.14 filed.) (2026-09-12 field test of the backhaul, WSL host + Pixel 10 on cellular: F135-F157 + F161, K7-K8, S37-S41, D5 taken (F134 went to the pyright gate on main the same day, so the gun-picker row became F161); F136 closed the same hour.) (2026-09-12 evening: F129 closed → archive; F133 filed.) (2026-09-12 backhaul, PR #3: B30 and B31 taken.) (2026-09-12 doc-rot close: F131 F132, R3, S32-S36 taken; F42.2/F42.3 closed → archive.) (2026-09-12 M2 close: S20 S21 S22 S23 S24 S26 F127 closed → archive; F129 F130 new; S25 v1 shipped, ESPN pass open.) (2026-09-12 midday: S28 all-weapons retune, S29 shield recharge taken.) (2026-09-12 desk pass: F128, P18, S27 taken; F110 F115 F116 F117 F118 F119 F122 F124 F125 closed → archive.) (2026-09-11 night game test: F110-F127 and S20-S26 taken, see [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md).) (2026-09-11 late: F105 taken and closed the same session -- the phone dropped every MC `alert`.) (Unchanged on 2026-09-11: **F35**, **F73** and **F96** closed that day and their
ids are retired, never reused.) (2026-09-10: F94/F95/F98 taken — the phone control point
(`spec/utility.md` §5d), its LAN-coupled roaming variant (§5e) and Territories (§5f). 2026-09-10 evening: F83/F84/F85/F86/F87 taken — rotating-hill mode idea, the "constant
wider than the hill's period" generalisation, the double-`$HIR`-per-beacon dedupe finding (F85, closed same
session), the team-change-leaves-old-LED-colour finding, and the hosted hill rate-of-fire boost.) (2026-09-07: F40/F41/F42 went to the Python DRY review and the fake-tagger row; the A17 bench items were re-lettered to F44/F45/F46 the same day to clear a three-way collision -- three sessions read "next free" concurrently. F43 is the A17 method finding. The bold list above is the ONLY authoritative "next free"; do not restate a number here.) Renumbered before, on 2026-09-06, to end collisions: the HUD-review items formerly
F15/F16 are **F26/F27**, and the 2026-09-01 field findings formerly G1–G7 (colliding with the grenade G ids) are
**F28–F32**. Bench-sheet numbers (1.1, 2.1, 3¾, A10a …) survive as aliases in §9.

# Closed 2026-09-10 — the docs consolidation pass

*One dated line each, per `CLAUDE.md`'s session-close rule. The evidence is in
`docs/experiment-log/2026-09.md`; the FACT (where there is one) is named with its new canonical home.*

- 2026-09-07 **F37** the `$PSET` slot order is the APK's — hitHp / hitArrmor / hitShield sit exactly where
  the field list says (a voice line placed in the hitShield position was heard on a shield hit). An
  intermediate *"the slots are SWAPPED"* reading was published mid-session and **RETRACTED**; what killed it
  was a CONTROL (move one clip, watch the sound NOT change), not more reasoning. Fact now lives in
  `protocol/brx-protocol.md` `$PSET`.
- 2026-09-07 **F38** `$SIR`'s `<soundID>` **REPLACES** the `$PSET` pool sound; it does not layer.
  Single-variable test: with a voice on `$SIR,0,0` only the voice played; silencing that token revealed the
  pool sound underneath. Consequence: per-weapon and per-pool audio compete for one hit, so the class layer
  ships OFF (`GameConfig.hit_audio_class`) and the stock rows keep Callsign's EMPTY sound token, which is what
  makes the pool sounds audible. Fact now lives in `protocol/brx-protocol.md` `$PSET` (c) and contracts A17.
- 2026-09-10 **F33** the gun-body team table is now an IDENTITY map — `poolgauge.TEAM_COLOURS =
  {0: RED, 1: BLUE, 2: YELLOW, 3: GREEN}`, was the offset `{1: BLUE, 2: RED, 3: YELLOW, 4: GREEN}` that
  painted a yellow-team gun RED — and the colour actually PAINTED is split out into `display_colour()` /
  `TEAM_DISPLAY_COLOURS`. Pinned for tid 0 and 2 by `test_poolgauge.py` and `test_led_invariants.py`, exactly
  what the row asked for. Verified in code 2026-09-10; the fix itself landed earlier and the row was never
  struck. ⚠ The separate hue COLLISION between the readout bar and the rest frame is **F56** and is still open.
- 2026-09-10 **F72** the phone no longer discards protocol 15. `engine.js`'s `$HIR` case was
  `if (t[2] === '15') break;`; it now parses the beacon (owner team + magnitude), dedupes it on identity
  (F85) and calls `_onHillBeacon`, which owns the hill state and its callouts. Read the beacon as a STANDING
  snapshot, never as a one-shot moment.
- 2026-09-10 **F85** one physical grenade transmission arrives as TWO `$HIR` on two sensors ~14 ms apart, so
  anything ticking or scoring per `$HIR` double-counts. Deduped on **IDENTITY** (owner team + magnitude, 150 ms
  window), never on time alone: a real capture produced two DIFFERENT beacon words in the SAME millisecond on
  different sensors (`mag=53` neutral leaving, `mag=8` new owner), and a time-only window would have silently
  swallowed the capture announcement. Sensor is deliberately excluded from the key. Three tests in
  `app/test/engine.test.mjs`.

**Pre-public checklist items completed** (moved out of `FOLLOWUPS.md` §1 on 2026-09-10, because that file is
open work only and these were five ✅ rows):

- 2026-09-07 **history purge, binaries.** `docs/reference/BRX_Manual_V7.pdf` (Battle Company's copyrighted
  manual, 14 MB) and every stale APK blob removed from history with `git filter-repo` and force-pushed. Old
  clones are invalid; re-clone rather than pull.
- 2026-09-07 **raw Callsign assets.** The five raw JSONs are gone from the tree per
  `protocol/callsign-extract/RAW_ASSETS_NOTE.md`; three were unreferenced, two restated as our own derived data
  under `mcp/brx_mcp/data/`. Regeneration reads a gitignored local copy of the APK.
- 2026-09-07 **headset ids in binary captures.** The two `protocol/captures/raw/2026-08-25-*.btsnoop` traces
  carried a sticker id in the advertised name; both patched in place with an equal-length alias, byte count
  unchanged, and both still decode identically.
- 2026-09-07 **dead branches deleted.** `bench/feedback-fork-ir-nrf-2026-08-25` (local and remote) and
  `worktree-agent-a8593058024df0d96` are gone; the remote one still pinned the PDF and every old apk, which is
  why purging `main` alone did not shrink anything. Pack 93 MB → 28 MB. Pre-purge backup:
  `~/brx-backups/open-brx-pre-purge-2026-09-07.bundle` (48 MB, all refs). **A release tag can pin purged
  history too**: `app-v0.1.6` had to be re-pointed through `.git/filter-repo/commit-map` before the objects
  would drop.
- 2026-09-10 **the APK is out of git.** No `.apk` is tracked and `.gitignore` carries
  `webapp/download/*.apk`; only the `build.json` sidecar is tracked. Every build goes to the `app-v<version>`
  release via `npm run android:apk` (0.1.8 published 2026-09-10 from `cfe2a8e`).
- 2026-09-10 **F79** the compiled `$SIR` table now has a concept of a non-weapon cell.
  `assert_sir_covers_weapons` only ever checked that every WEAPON in the loadout had a row, so a bundle that
  shipped **no protocol-15 row** — the exact condition that made every station word vanish in silence (F60, the
  third instance of the F11 shape that week) — raised nothing: a table was "covered" while deaf to every beacon
  in the venue. `compile.py` now carries `_OBJECTIVE_SIR_ROW = "$SIR,15,0,,28,0,0,1,,*"` and a guard that
  RAISES for any `_OBJECTIVE_MODES` config shipping no protocol-15 cell. The row was deliberately deferred until
  the feature existed, and then written in the same commit that shipped it, because **a guard added before its
  feature is a guard nobody can test**.

# Closed 2026-09-11 — the docs DRY pass

*One dated line each, per `CLAUDE.md`'s session-close rule. Each was checked against the CODE, not against
the row: all three were filed as open work that has since shipped, or as a question the bench answered.*

- 2026-09-11 **F35** `$TID` 4-7 are display-only and BREAK combat (bench 2026-09-07: the IR word's team field
  is 2 bits, so a gun transmits `tid & 3` while the victim compares the FULL tid — teammates on tid ≥ 4 damage
  each other and a gun can kill itself off a surface). **Both fixes the row asked for have shipped.** The tid is
  refused at three layers (`mc/state.py` validate, `mc/compile.py` validate, `modes/driver.assign_teams`, all
  naming F35 in the operator message), and the displayed team COLOUR is a separate lookup from the wire tid
  (`poolgauge.display_colour()` / `TEAM_DISPLAY_COLOURS`, so team 3 stays GREEN on the wire and PAINTS purple).
  Pinned by `test_led_invariants.py` (`pg.TEAM_TIDS == (0,1,2,3)`, plus an assertion that the two palettes must
  DISAGREE so merging them cannot silently reintroduce it), `test_mc_state.py`, `test_mc_compile.py` and
  `test_poolgauge.py`. The FACT lives in `protocol/brx-protocol.md`'s `$TID` row and is not moved by this
  closure; **F96** (the FFA path that was handing out those tids) closed the same day.
- 2026-09-11 **F96** FFA no longer hands out a tid the wire does not have. `assign_teams("ffa"|"extraction", …)`
  assigned `i + 1`, so the FOURTH gun was armed on `$TID,4` and a fifth on 5 — one-directional immunity, because
  a tid-5 gun transmits as wire team 1 and its shots read FRIENDLY to the real tid-1 player while it still takes
  their damage. It is now **0-based**, so four guns fill teams 0-3 exactly, and a fifth RAISES with the operator
  message the row asked for rather than silently arming an unusable tid. ⚠ **Recorded because it is the thing a
  later reader will get wrong:** this is the CLI driver path only. **MC's FFA is a single team on `$TID,1`** with
  identity from `$PSET` (A4.1), so it never had this bug and must not be "fixed" to match. Pinned by
  `test_modes.py`, `test_fake_game.py` (the operator message), `test_sim_deathmatch.py` and
  `test_sim_extraction.py`.
- 2026-09-11 **F73** ANSWERED at the bench 2026-09-10 — **`$SIR` fn 28 registers with ZERO player feedback**
  (no sound, no headset flash, no vibration), which is what makes a hill beacon readable by a node without the
  player perceiving it every 5 s. Swept enemy-side 8 / 24 / 25 / 26 / 27 / 28 on a free cell, then CONFIRMED on a
  real protocol-15 beacon over BLE (20+ consecutive beacons, 5.0 s period, no misses), and confirmed again to
  ignore the `$SIR` `<soundID>` field outright — so "zero feedback" is a property of the FUNCTION, and no
  gun-native beacon cue is possible through it. ⚠ Also learned and kept: the "varied sounds" across fn 24-27 are
  ONE long clip truncated by the next event, not several clips (spacing shots 6 s apart let it play through);
  fn 27's first of three sounded genuinely different in a way a leftover tail does not explain, and that is
  **unexplained, recorded rather than tidied away**. The wire fact and the polarity rule now live in
  `protocol/brx-ir-protocol.md` §"The grenade beacon"; the design consequence (all hill audio is node work) in
  `docs/utility-roadmap.md` "Where the hill audio has to live"; the method and traps in `docs/bench-grenade.md`
  rungs S and Y. **What the sweep did NOT cover stays open as U11′** (enemy 35 and the ally side 31 / 32 / 34)
  and as bench-queue rung **D6**.

# Closed 2026-09-11 (late) — the triage session: keyboard bugs and the station arming path

Evidence: `experiment-log/2026-09.md` → *2026-09-11 (late) — the followups triage, and what a keyboard could close*.

- 2026-09-11 **F81** the victim's phone said "KILLED BY <hill owner>" on a wire-0 damage word; the killer is now UNKNOWN with no team chip, and a stale latch is the same case (`engine.js _death`, `hud.js`; `test F81`). MC already scored wire 0 for nobody.
- 2026-09-11 **F34** the node floors the respawn delay at 3 s whatever the config says (`engine.js MIN_RESPAWN_S`, matching `gameconfig.MIN_RESPAWN_S`), MC's PUT already refused 1-2 s, and the Designer skips the band instead of stepping into a 400. Closes F13(1) with it; F13(2) (headset pacing) stays.
- 2026-09-11 **F97** a hill mode refuses a FOURTH team at PUT (`state.py`), in `validate()` and in `DominationEngine.add_player`, naming the three-team cap (tids 0/1/3) rather than F82's "use tid 0, 1 or 3". `test_hillbeacon.py` §10, `test_mc_koth.py`.
- 2026-09-11 **F47** `get maxArmor()` reads an explicit 0 as no armour (`?? 70` semantics); the no-armour low-health test A17.2 could not write is added.
- 2026-09-11 **F55** `_play_burst`'s `finally` no longer raises "no running event loop" into a green run; pinned in `test_modes.py`.
- 2026-09-11 **F53** `compile._hit_entry` raises on an uncovered IR cell instead of keying the weapon to fn 0 (`test_hitaudio.py`).
- 2026-09-11 **F41** the fake tagger reports shield 0 after `$SPAWN` (P16) and keeps `$PSET` token 5 as the ceiling (`test_fake_game.py`).
- 2026-09-11 **F90** `HILL_CONTESTED` / `HILL_LOST` live in `sounds.py` in the cue catalog; `hillbeacon.py` aliases them (`test_sounds.py`).
- 2026-09-11 **F101** all three tests run un-skipped (253 pass, 0 skipped). (a) the handover-after-revive line and (c) the forced possession send at the whistle were ALREADY BUILT -- the tests drove the engine wrongly (a bare `$HP,45` is not a revive; END arrives as `control{cmd:end}`); (b) source gating needed F103's `phone` value.
- 2026-09-11 **F103** possession accrues real elapsed time while conversion stays clamped (`control.js`); the F82 banner follows whether a tid-2 player is present; `STATION_SOURCES` gains `phone` with its own SETUP checklist (arming resets the point, never a power cycle), mirrored in the console + mock, and `engine.js _hillSourceAllowed` reads the real vocabulary.
- 2026-09-11 **F104** MC arms the stations: a `node_type: utility` hello is a station (never bound, never pruned while assigned); `PUT /api/stations/{node_id}` assigns kind / team / id / threshold and pushes `station_config` at once; every lobby push re-arms with the per-match game byte (bumped on the first push after a match STARTED, so `applyStationConfig`'s `resetPoint()` finally fires between matches) and ships `config.stations` to the players; an offline station is flagged and armed on its next hello. ⚠ It was TWO-sided: the phone's `MC_KINDS` lacked the kind too. `test_mc_stations.py` (12) pins both whitelists equal. Server half of S5.
- 2026-09-11 **F105** found while fixing F104 -- the phone's `MC_KINDS` (`app/src/transport/envelope.js`) never listed `alert`, so EVERY A11.4 alert MC sent (flag taken, infected broadcast, last survivor, objective lines) was counted as a malformed frame and dropped before `onMessage`, on every phone, since alerts shipped. The engine tests never saw it because they call `onMcMessage` directly. Fixed with F104; `test_mc_stations.py` pins the two lists equal and `transport.test.mjs` decodes an alert. (Never had a row: opened and closed in one session.)
- 2026-09-11 **F86** a team change repaints on both paths: the CLI driver blanks then paints the new team's rest right after `$TID` (the verified sequence), and the bundle ships `team_flip_take` per tid so the phone takes the gun with the team it is on NOW (`engine.js _gunTake`) -- it used to paint the human colour back over an infected gun 2.5 s after every revive. The headset stays the `infected` ROLE's job (A16 §3.3). `test_sim_survival_lms.py`, `test_mc_compile.py`, `test F86` in engine.test.mjs.
- 2026-09-11 **F77** the DETECTOR: `Scorer.warnings()` names a run of >= 4 identical hits at a steady 3-8 s period in the recap ("F74? ... a gun REPLAYING a latched IR event"), never drops them; rendered on RECAP. The root cause stays F74 (bench).
- 2026-09-11 **F64** the captured lethal `$LCD,0,0,0,0,32,192,*` is replayed through `engine.js` and `stage.py`: both book the death, neither invents a hit, the DOWN screen says UNKNOWN. The S16 residual (credit for a lethal tick) stays in S16.
- 2026-09-11 **F31** MC reports how many nodes END reached since 2026-09-07; the residual fixed 2026-09-11 is that `reached` counted every SOCKET while `nodes` counted bound players, so "3 of 2" was possible -- END/RECALL/PANIC now go per bound player node and the two numbers are the same population.
- 2026-09-11 **F84** the audit is a TEST: `test_timers_vs_hill_period.py` fails on any `*_S`/`*_MS` constant in `mcp/brx_mcp/` at or above the 5 s beacon period that is not listed with the reason a beacon cannot keep it from firing (every existing one judged), and re-asserts the two fuses that bit through the engine.
- 2026-09-11 **F92** DECIDED 2026-09-10 (option c: phone points capture by presence, the grenade keeps shoot-to-capture, no IR-to-advert bridge); nothing left open, the reasoning is kept here and in `spec/utility.md` §5d.
- 2026-09-11 **F94** built; the three leftovers were F101 (closed), F103 (closed) and F102 (still open -- the stage mirror). Nothing else was left in this row.

## Closed 2026-09-11 (afternoon, site refactor)

- **S18** Real photos on the landing: Tony shot the gear 2026-09-11, Gemini replaced the backgrounds, the real HUD frame was composited onto the phone screen and a hallucinated logo cloned out; `site/photos/hero.jpg`, `grenade.jpg` and `og.jpg` (the share card) replaced the SVG placeholders the same afternoon.

# Closed 2026-09-11 (late, second session) — the second triage pass: the stage mirror, the wire, the stun

- 2026-09-11 **F102** the bench stage models the phone control point: an injected advert encoded to the 16-byte layout and decoded through the phone's own byte positions, the `phone`/`grenade` source gate, the 4 s station vs 12 s grenade windows, the losing tick, the contested and callout floors, the site latch and the new-match reset, all ported from `engine.js`; the constants-parity test reads `engine.js`, `control.js` and `beacon.js`; page section 4b + five walkthrough steps (`test_stage_mirror.py`, `docs/gun-stage.md`). Possession accrual (an MC fact, not player-audible) is deliberately not mirrored.
- 2026-09-11 **F54** the stage has a reload path: `$BUT,2,1` drives the phone's gates and the reload glance (`reload_glance_s` from the bundle), RELOAD and REPORT AMMO buttons on the page. Found on the way: the stage nulled `_readout_last_pool` after a hold where the phone keeps it.
- 2026-09-11 **S11** `stage/server.py` boots `--gun`/`--mc` as a background task; the page is up at once LINKED=false, a failed connect is one warn line, and the boot task never replaces a link the operator made first.
- 2026-09-11 **F57** the `$HP` tick that arms `low_health` plays the warning and NOT the pain grunt, and stamps the 600 ms pain gap (engine.js and stage.py, both with the 16 HP / past-the-gap controls).
- 2026-09-11 **F15** BUILT, unproven on hardware (contracts A20, node.md §3.12): `config.stun {duration_s}` (PUT, default 10 s, 1..60) ships `$SIR,8,0,,24` in place of the charge rifle's damage row on the head and every hit-audio take; the node disarms every live slot on a proto-8 `$HIR`, extends on a second word, restores the LIVE counts once on expiry (both `$ALCD` maps reset on spawn, so a new life never inherits the last one's reserve), death and reconcile cancel; stage mirror + profile knob + page control. The charge rifle is the source (it keys `<8,0>`); rung 9 in §9 is the proof.
- 2026-09-11 **F78** `fake.py` keeps the `$SIR` table it was sent (boots with the stock one, `$CLEAR` wipes it), registers only on a matching cell with the function deciding the pool effect, discards an unmatched cell in silence (the F11/F40/F60 shape), treats `mag=0` as a miss, needs a `<15,0>` row for a beacon, and has a `listening` flag.
- 2026-09-11 **E1** `config.mode_params` on the wire (contracts A18, modes.md §2.1): engine-declared `PARAMS` schemas (`modes/params.py`), `modes/registry.py` (the E2 seed; `driver.build_engine` dispatches through it), validation at PUT and in `compile.validate`, complete-or-absent on the wire and in saved games, `GET /api/modes .params[]`; Domination/CTF/CS/Extraction/LMS read their params instead of literals (defaults equal the literals they replaced). No Designer editor and no phone consumer yet (F107).
- 2026-09-11 **S5** the leftovers: assignments + `game_no` persist in session.json (a restored station re-arms on its next hello); `battery` + `app_ver` ride the utility heartbeat and `net._fire_node` forwards `app_ver` (it never had); the recap carries a `stations` row per assigned station (revives / owner + hold, `heard` for the rest) on every recap path incl. the late-fact re-store; screens.mjs #49 drives a real socket; the utility screen shows `valid_ids`.

# Closed 2026-09-11 (bench) — the hill's chip damage is manufactured inside the gun, not on the wire

Evidence: `experiment-log/2026-09.md` → *2026-09-11 (bench) — F69 REFUTED: the hill's "chip damage" is manufactured INSIDE the gun by fn 24, not a word in the air*.

- 2026-09-11 **F69** REFUTED as originally framed. Its premise was an ambient `proto=0 mag=8` damage word on the wire; a receiver aimed at a live grenade recorded ZERO protocol-0 words across ~5 minutes of beacons while the gun logged chip damage under the fn-24 row, and with the shipped fn-28 row on the cell a 100/200 gun sat beside a live neutral hill for 70 s and took nothing. The damage is manufactured INSIDE the gun by fn 24 (see F91), not transmitted. The original ~106 s death (2026-09-10) carried the same fn-24 row, so the two findings agree rather than conflict. `bench-critical-2026-09-11.md` rungs A1 and B1 answered/moot with it.
- 2026-09-11 **F91** RETIRED. Its premise (an ambient wire-level `proto=0` damage word our weapons could dodge by moving off protocol 0) is refuted by F69: there is no such word, so there is nothing to dodge and the deaf-to-native-guns tradeoff never needs paying. `bench-critical-2026-09-11.md` rung B2 is moot with it; A2, B3, C1, C2 stand.
- 2026-09-11 **F23** CLOSED, and it reconciles rather than overturns the two readings it looked like it was refereeing. Gun Tactix-3D4F, one emitter, five words per set, sensor recorded on every `$HIR`: the gun-body sensor lands the raw magnitude on fn 1/36/37 alike (×1, always); the headset sensor scales fn 36 by `1 + t7/200` and fn 37 by `1 + 2·t7/100` (t7 = the compiled `$GSET criticalShotModifier`), confirmed across t7 = 0/50/100 with a t7=0 closing control reading fn 37 back to ×1. At the MC default t7=50 that is exactly the 2026-09-02 headset reading (×1.25/×2), and the 2026-08-27 "×1.0" matrix was rig-pinned to the gun body the whole time — both were right, they measured different sensors. `mc/compile.py` gains `headset_multiplier(fn, crit_modifier)`; `damage()`/`hits_to_kill()`/`time_to_kill()` now document themselves as the gun-body (guaranteed-kill) number and `validate()`'s multiplier warning quotes the compiled crit_modifier. `docs/weapon-design.md` §6.2, `protocol/brx-protocol.md` §5, `protocol/callsign-extract/protocol-classes.md` and `docs/manual/dev.md` corrected off the flat ×1.25/×2/"1.5-if-crit" reading. `mcp/tests/test_headset_multiplier.py` pins the three measured points.

- 2026-09-11 **F45** all four never-heard `$PSET` tokens now have picks, ear-confirmed solo bench 2026-09-11 (evening): `missShotHit` = H06 (answered 2026-09-09, a bullet near-miss; F67's rate-gate/batch-collapse question stays open there, cross-referenced not re-opened here), `emptyUnboundButtonSound` = U15 ("disabled trigger sound"), `ammoOrGearPickUp` = W71 ("a military guy adjusting his gear", fits pickup), `hitCrit` = **X49** ("metal hit"), not H43 (H43 rejected: "dropped a gun on the ground", it was a shape pick and placeholder, never a real choice). Wired: `hitaudio.MATERIAL_POOLS['hit_crit'] = ('X49',)`, H43 pinned as rejected in `test_hitaudio.py`.
- 2026-09-11 **F48** `low_health` = **N74** ("yeah heartbeat, it could be looped, I like that more for critical health"), ear-confirmed bench 2026-09-11 (evening), replacing the shape-picked shortlist. N75 (a second heartbeat take) kept as a pool partner candidate, N25 (a faster heartbeat) as a tier candidate; neither adopted tonight. Baseline `voice:hurt_loop` (V06 "guy breathing heavy in pain") stays as the existing sound this can pool alongside, per the row's original design. Wired: `presentation.EVENTS['low_health'].sound = 'N74'`.
- 2026-09-11 **W4a** Energy Launcher fire sound settled by ear, bench 2026-09-11 (evening): **O06** ("shooting a rocket"). O04 ("shooting a missile") is the runner-up. The shipped O01 and alternates O02/O05 read as the BLAST rather than the launch; O03 is a rifle. Wired: `weapons.json` energy launcher t27 = O06. The launcher's zero-damage design question stays a separate open decision (not re-filed here).
- 2026-09-11 **defeat line (unnumbered, §9 Ears)** answered negative by ear: JAW and JAX are both a neutral "game ending music climax"; the bank has no defeat sting. The loser cue is the character's own `voice:defeat_taunt` over a neutral bed.
- 2026-09-11 **F44** the shield loop is **A10**, heard as a real loop on a live gun (golden bundle armed, `$LIFE,0,0,20,*` up, `$LIFE,0,0,-20,*` down and the loop stopped): "oh this is a nice humming of shield or energy". The 2026-09-07 rejection was context (it played under a barrage of hits), not the clip. A08/A09/A10 are Callsign's ShieldOnHeal/ShieldOffExpire/ShieldLoop set (A08 "getting armor or protection on", A09 "losing shield"); U100/U13 in the slot read as "a bomb ticking", rejected. Wired: `hitaudio.SHIELD_LOOP = "A10"`; the low-hum shape shortlist (N71/N72/N67/CC07/Y07) is dead.
- 2026-09-11 **S12** decided by Tony ("let the config drive it. silenced snipers no grunts could be legit") and built the same night: `presentation.voice` = `on` / `hits_only` / `off` (A22); the `silenced` preset ships `off`; the native death scream is untouched in every mode.
- 2026-09-12 **F124** the frag limit now ENDS the match: `Scorer._check_frag_limit` → `Session._on_frag_limit`, the same `set_end` + `_finish` path a manual END takes (FFA per player, team modes per team, `win_by != kills` never), judged after the whole `event_batch` and only by the live scorer. Demo e2e: tdm cap 3 → recap on its own, feed `FRAG LIMIT 3 REACHED — MATCH OVER · END REACHED 8 OF 8 NODE(S)`. Reconciliation by cap-kill timestamp + replay is A24 (M2).
- 2026-09-12 **F125** `control()` now returns `{ok, ended, reached, pushed, nodes, phase, error?}` and `reached` counts nodes whose match actually ENDED (it was counted before the branch that ends anything); END with no scorer is `{ok:false, ended:false, reached:0, error}` naming RECALL, a second END in recap ends nothing; the MC UI shows the error on the strip and words success from `ended` (`MATCH ENDED · REACHED 8 OF 8 NODES`).
- 2026-09-12 **F116** `ScoreRow` gains `best_streak`, `multi_best`, `first_blood`; per-kill Halo medals reach `medals` via `earned_medals()` (read back off `self.kills`, repeats collapsed to ×N, honors deduped by a base-label alias map) so a 1v1 shows medals while `honors()` keeps its 3+ rule; CSV gains `best_streak`. UI residual (show `best_streak` not `streak` on STK) is in S24.
- 2026-09-12 **F118** MC feed alert lines are third person, mode-aware, ids resolved through the same roster as the kill feed (`presentation.feed_text` / `MC_TEXT`, `Session._display_for`): `ROCCO takes the lead`, `BLUE takes the lead`; an unresolvable subject reads `THE LEAD CHANGED (id)`, never the HUD's second-person line. The player's own `alert` text is unchanged.
- 2026-09-12 **F119** `ScoreRow.acc_provisional` = `shots < ACC_MIN_SHOTS (10)` or the shots sample predates the last landed hit; `accuracy` itself untouched. UI residual (settling treatment) is in S24.
- 2026-09-12 **F110** briefing shear: `.bf .r` rows are `flex:0 0 auto`, the body is bounded, `.bfname` is measured and shrunk to fit (`_fitBriefing`, re-checked after the webfont swaps in), kicker/loadout lines clamped; a `briefing-long` stage drives a long host name + wrapped loadout line and three screen-truth steps assert no row meets `.bffoot` at 891×411, 667×375 and 812×375.
- 2026-09-12 **F117** the post-match control is `READY FOR NEXT MATCH ▸` in the primary (`off`) style with `data-act`, the note leads with the instruction, `.wait` dresses only the inert STANDING BY, and an unsynced clock is explained under the button (`_readyNote(st,'over')`). Screen-truth compares the over button's computed colour/size to READY UP.
- 2026-09-12 **F122** the debug panel: `setDiag` skips an unchanged write, keeps `#dbody` and both `<pre>` scroll positions (pinned to the tail when the reader was there), and the actions live in a one-row sticky footer so SHARE LOG is reachable without scrolling; a press that straddles a re-render still fires (4 of 4 in the step).
- 2026-09-12 **F115** DOWN digits: Saira Condensed has no tabular figures (measured: neither do Oswald or Chakra Petch, so MC's `TAB` token is the same lie); the countdown renders per-digit fixed-width `.d` cells, `line-height` reconciled with the glyph box (170 px / 1.24), a small `text-indent` centres the italic ink; steps assert equal width across 11/10/09/08/88 and the glyph box within the element.
- 2026-09-12 **S20** the try-out collapsed into selection (A26): a weapon row tap equips AND arms after a 400 ms node-side debounce (`PICK_DEBOUNCE_MS`; three taps in 300 ms = one request with the last id), ⟳ until `loadout_ack`, ✓ on ack, `TRY IT` gone, `REVIEW KIT ▸` opens the three-plate summary, every row has an ⓘ; a try-out arriving while the rack is open no longer takes the screen. 10 engine tests, 6 screen-truth steps (#59–#64).
- 2026-09-12 **S21** the CAM look-through is gone (button, `camera-preview` plugin, `onToggleCam`, `#cam` CSS); `NSCameraUsageDescription` and `android.permission.CAMERA` stay for the MC-join QR scanner.
- 2026-09-12 **S22** sidearms retuned on `wire` only: USP 160 ms/9 dmg/mag 20, Glock 240/13/16, Deagle 480/26/7 — all ideal ttk 1920 ms (> every rifle), Tony's ordering (USP fastest+weakest, Glock middle, Deagle slow+heavy), reserves hand-set so sustained-DPS and kills-per-kit rank opposite and no pistol strictly dominates (all 22 weapons checked). `docs/reference/ttk-model.md` → *Shipped 2026-09-12*. Bench gate: a sidearm-only round, does any one feel like the pick? Follow-up for the primaries: S28.
- 2026-09-12 **S23** FINAL RESULTS built end to end (A24): MC pushes `result` per recipient at the whistle (re-sent while provisional, in `welcome.node.result` during recap), the phone never infers win/lose (`RESULT PENDING · CONFIRM AT MISSION CONTROL` → `MC NOT REACHED` after 30 s), TEAMS|PLAYERS views, honors, best streak, hill time, the unofficial `AFTER THE WHISTLE` block, HISTORY; the frag-cap end is RE-DERIVED at the timestamp of the winning kill by REPLAYING the stored facts (the end can only move EARLIER; ties inside `CLOCK_TIE_MS` 1 s are `winner.tie`), with the as-played roster frozen at the whistle. Residual: F130 (hot-joined nodes' late flushes cannot move the end).
- 2026-09-12 **S24** MC match page legibility: headers 11 px, three numeric groups with rules from one column model (`columns.ts`, shared with Recap), STK = `best_streak`, ACC dimmed with a leading `~` while provisional, alert/WITHHELD feed rows, a `<Num>` fixed-width digit primitive (no product font has tabular figures — measured), plus a repo-wide sweep raising ~100 strings from 9–10.5 px to ≥ 11 px through the shared primitives. Residual UI polish in F129.
- 2026-09-12 **S26** background log sync built both sides (A25): the phone answers `pull_log` only when not armed/live and its fact ring is empty (5→60 s backoff, tail-only resend, one chunk behind `bufferedAmount`, a refused chunk halves), re-offers on reconnect; MC asks at recap / on offer / on the reconnect of a node owing the last match's log / from the ⬇ LOGS button, gated by `log_sync` (`GET/PUT /api/options`), one outstanding ask per node, a per-match budget; `NodeView.log` states on the readiness board. `npm run ui:logsync` = the 17-check browser gate. A29 rides with it: real semver build + platform in hello/status, red on major mismatch, amber behind the field/release.
- 2026-09-12 **F127** CONTINUE is guarded on both sides (A27): the MC UI's two-step confirm names who is still kitting and says they lose their screen, `POST /api/phase` refuses 409 `{not_ready, greens, roster_size}` unless `force` (sent only after a named warning — two taps in both orders), and the phone leads its lobby screen with `THE HOST LOCKED KITS — you play what you had` (`moment kit_locked_by_host`, A30) instead of a silent screen swap.
- 2026-09-12 **F42.2** `SENSOR`/`witnessed`/`word` hoisted from `f11_ab.py` into `mcp/tools/bench_common.py`; the four surviving hand-rolled teardowns use `connected()`; `f11_ab.py` and 39 closed-experiment scripts deleted (doc-rot pass, commit e4073f8).
- 2026-09-12 **F42.3** `led_ingame_usable.py`'s UNC-path `exec()` hack is gone with the script (doc-rot pass, commit e4073f8).
- 2026-09-12 **F42.13** `test_ui_contract.py` DEFAULT_POLICY test skipped on an unparsable `gameSummary.ts` spread — closed the same day: `_ts_object` reads `...ident`, the test runs (4/4, 0 skipped) and fails by field name; parser misses are now AssertionErrors, not Skipped.
- 2026-09-12 **F42.10** pyright gates `mcp/` in CI: `standard` mode over `brx_mcp/` (config `mcp/pyproject.toml`), `mcp/tests/test_pyright.py` fails the suite on any error and skips cleanly where pyright isn't installed, CI installs it for its with-extras pass. First run (2026-09-12) found 249 errors on a base already 81% annotated; `brx_mcp/stage/stage.py` (56 of those errors, the raw-JSON bench stage that must keep mirroring the phone engine) is excluded rather than fixed in place — filed as its own job, F42.14.
- 2026-09-12 **F129** the M2 UI polish residuals landed in 88b4d20: Live/Spectate carry a `▸ SCROLL` hint with a fading edge on a phone; headset copy `CONNECTED (LINK)` / `CONNECTED (ECHO)`; toasts take their own row under the command bar at ≤ 820 px (NEW MATCH back to one line); the spectator latch releases on a fresh load carrying a typed view; a stale Kit refusal clears with the roster it described; a LOG SYNC legend; the roster tag no longer clips at 393 px; the e2e shot names the screen it shows; the rack hero reads ARMING… until the ack. The phone-side round-2 review that followed found and fixed a per-node pick debounce (a slot switch destroyed the first pick) and a foreground reconcile that handed out a free magazine — both in the same commit.
- **F136** 2026-09-12 — MC bound the node socket to the LAN IP only, so the cloudflared origin (127.0.0.1:<ws-port>) answered 502 on the first real tunnel; fixed the same hour (bind 0.0.0.0, advertise the LAN IP), field-verified.
- **F159** 2026-09-12 — HUD loadout detail pane: the name + role + EQUIPPED line overflowed for "Assault Rifle"; fixed by the badge shrink-to-fit that the field-fix HUD lane added the same day (screens.mjs clean, 318/318).
- **F135** 2026-09-12 — fixed in PR #4, 2026-09-12: the HUD's SCAN QR was only reachable AFTER a gun was linked, so an MC-first join the transport already supported was impossible on the phone; folded into F156's fix (a scan control in every state).
- **F137** 2026-09-12 — fixed in PR #4, 2026-09-12: the HUD's "MC LINKED — WAITING FOR KIT-OUT" label no longer touches the edge of its button.
- **F138** 2026-09-12 — fixed in PR #4, 2026-09-12: the join QR (~140 chars: LAN url + secret + url-encoded public url) that took the Pixel 10 two scans is rendered larger with a distance hint.
- **F139** 2026-09-12 — fixed in PR #4, 2026-09-12: the phone's discovery SWEEP, blocked as Mixed Content on Android for its whole life and sweeping the subnet of a REMEMBERED MC url, now probes over a WebSocket and derives the subnet from the current join.
- **F140** 2026-09-12 — fixed in PR #4, 2026-09-12: a quick-tunnel hostname is no longer announced UP before other resolvers can see it (the home router negative-cached NXDOMAIN for ~250 s); MC holds `starting` until DNS-over-HTTPS answers, then renders the QR and pushes `join`.
- **F141** 2026-09-12 — fixed in PR #4, 2026-09-12: the MC Kit "sniper" class chip can be deselected again, and an empty primary filter is refused at validate instead of silently degrading both loadouts to pistols (which is what fired F146).
- **F142** 2026-09-12 — fixed in PR #4, 2026-09-12: MC no longer restores a `--demo` snapshot into a non-demo launch (two ghost players, ALPHA/BRAVO on GUN-A/GUN-B, reached a real 4-player roster behind one terminal banner line); a restore shows on the board against FRESH SESSION and a row with no phone looks different.
- **F143** 2026-09-12 — fixed in PR #4, 2026-09-12: `lan.mode` is no longer hard-coded "unknown" (the REACH block printed "UNKNOWN · ip:port"); there is still no SSID detection on any platform, which the reach wording now respects.
- **F144** 2026-09-12 — fixed in PR #4, 2026-09-12: a node reachable over the backhaul reads READY (green, with a reach tag) on the Armory instead of CHECK/amber; amber and red are for a phone MC cannot reach.
- **F145** 2026-09-12 — fixed in PR #4, 2026-09-12: the HUD loadout browser's weapon ⓘ is tappable again (A26 made the row tap equip + try-out and swallowed it), so the weapon detail page is reachable.
- **F146** 2026-09-12 — fixed: the weapon-design §2.1 one-magazine guard is the PRIMARY slot's, graded against the BASE pool (no perk) and the weapon's OWN magazine, and it is a WARNING naming slot + weapon + both numbers. It blocked the push twice at the field — once on the pistols-only fallback the operator never chose, once on a secondary sidearm graded against a Body-Armor pool, which banned every sidearm whenever anyone took the perk. The one hard ERROR left is a sidearm carried as a player's ONLY gun: then it is the gun they fight with, and it is the one case the operator can fix at the whistle (`mc/compile.py`, integration of the field branch 2026-09-12).
- **F147** 2026-09-12 — fixed in PR #4, 2026-09-12: the HUD try-out's EQUIPPED / READY follows the gun's echo of the write rather than the SEND (F123's family).
- **F149** 2026-09-12 — fixed in PR #4, 2026-09-12: a death cancels `low_health`, so the breathing loop no longer plays AFTER the kill (the lethal hit crosses the 15 HP threshold on its way to `$HP,0`). Whether the `$PLAYX,0,*` that stops it also clips the NATIVE death scream is unverified and stays open as F158.
- **F150** 2026-09-12 — fixed in PR #4, 2026-09-12: streak and multi-kill medals reach the recap view (an 11-5 line had an empty medals list while the other row's FIRST BLOOD showed).
- **F151** 2026-09-12 — fixed in PR #4, 2026-09-12: the MC Games tab explains a locked config (CUSTOMIZE on FFA without saving, back to Games, phase lobby, no preset) instead of locking it silently.
- **F153** 2026-09-12 — fixed in PR #4, 2026-09-12: reconnect latency. After mobile data came back the Pixel 10 took ~3 min to rejoin (a failed pub dial fell to the unroutable LAN url, whose dial had no pre-open giveup, into Android's ~2 min connect timeout) and a fresh QR scan queued behind the same hung dial; now an 8 s LAN giveup, pub→lan→pub, a new `connect()` aborts any in-flight dial, and a network change re-dials.
- **F154** 2026-09-12 — fixed in PR #4, 2026-09-12: an FFA tied 1-1 reads DRAW, not LOST (the Pixel 4 showed LOST and flipped to WIN only after the late flush re-sent the result).
- **F155** 2026-09-12 — fixed in PR #4, 2026-09-12: a node whose last reach was the internet reads "NOT REACHED FOR n s" / "TUNNEL DOWN" while the tunnel is down, instead of "LOST CONNECTION" then a red "WRONG WI-FI / UNREACHABLE" that blocked the Lobby for a phone on the right network.
- **F156** 2026-09-12 — fixed in PR #4, 2026-09-12: SCAN QR and a typed address are reachable from the MC chip in every HUD state. Once the HUD held an MC address there was no way back, so a tunnel restart (new hostname) stranded every phone; the field recovery that day was CLEAR APP DATA on both phones.
- **F157** 2026-09-12 — fixed: MC's `_log_inflight` gate stops the `log_offer`-mid-upload free-run that held 126 `log_offer` + 126 `log_data` rows of ~30-40 KB in one session (~4 MB over cellular, the phone re-offering on every reconnect/status while MC re-pulled the same log). One ask outstanding per node; measured 44 rounds to the 1 MB cap on 2026-09-12 (integration of the field branch).
- **S37** 2026-09-12 — fixed in PR #4, 2026-09-12: Quick Switch is refused when a weapon slot is off (with one weapon there is nothing to swap); policy refuses it and the phone's pool drops it.
- **S38** 2026-09-12 — fixed in PR #4, 2026-09-12: the Armory gun card shows the bound player's gamertag, not only the connected-nodes strip.
- **S39** 2026-09-12 — fixed in PR #4, 2026-09-12: picking a character voice previews the KILL line, not the intro (A9.1/A15).
- **S40** 2026-09-12 — fixed in PR #4, 2026-09-12: the reach tags read LAN / INTERNET (matching the REACH block) and are worded as the path to MC rather than the phone's radio; a phone on home Wi-Fi read BACKHAUL because the WSL host had no reachable LAN address.
- **S41** 2026-09-12 — fixed in PR #4, 2026-09-12: the recap hides "AFTER THE WHISTLE" when it has no data.
- **F42.11** 2026-09-15 — enabled strict TypeScript checking for the Mission Control console; zero new errors, 514 console tests passed. See `docs/experiment-log/2026-09.md` (2026-09-15 contract-DRY phase 1).
- **F134** 2026-09-15 — closed `scoring.win_by` to kills/survival/objective, with a shared parser and visible refusals at config PUT, compile validation and scorer construction. See `docs/experiment-log/2026-09.md` (2026-09-15 contract-DRY phase 2).
- **F42.16** 2026-09-15 — removed four Python casts and five redundant console pool intersections; malformed standby JSON rows are decoded and logged. See `docs/experiment-log/2026-09.md` (2026-09-15 contract-DRY phase 2).
- **F42.15** 2026-09-15 — `Session.compiler` now has a checked Protocol; real and fake compile signatures, catalog stats and public perk effects agree, and catalog failures no longer silently admit unknown weapons. See `docs/experiment-log/2026-09.md` (2026-09-15 contract-DRY phase 3).

# Closed 2026-09-13 — GSET t2 handoff

- **2026-09-18** ~~**F253 THE HOST-DRIVEN STUN (A20) PUTS fn 24 ON THE EMP CELL**~~ ✅ **FILED AND FIXED 2026-09-18, same session.** The bench proved fn 24 does no damage and leaves the victim's gun manufacturing a fake `$HIR` every 5.07 s until the next `$SPAWN` (P18), so every stunned player would have been told they were being shot by nobody for the rest of the life. **fn 23 is the primitive**, measured the same hour: the victim's live accuracy goes **100 → 0 in the same millisecond** as the `$HIR`, no pool moves, the gun keeps firing but every shot MISSES (the person being shot at hears the near-miss whizz-bys), and it recovers by itself, 0 → 2 → 4 → 7 → 12 over about 3 s, leaving nothing behind. No phantom 12 s later. `_STUN_SIR_ROW` now ships `$SIR,8,0,,23,0,0,1,,*`, and `test_spawn_protection` now asserts the strongest form: **the phantom family reaches NO shipped table in any configuration**, broken once to prove it goes red. Tony, on hearing it: "it's more like a flashbang than a stun", which is the better name and the better design brief. → archive.
- **2026-09-18** ~~**F62 `$WEAP` t6 `primaryCritChance` — can we emit crits?**~~ ✅ **CLOSED 2026-09-18, bench: YES, and t6 is a straight percentage the GUN rolls.** Bench AR at 9 damage, victim with no armour so the `$HP` delta is the applied damage. t6 = 20: **9 crits in 64 hits, 14.1%**. t6 = 50: **54 in 119, 45.4%**. Both within about one standard deviation of the token value. A crit is the magnitude **x1.5 truncated** (9 → 13) and **`$HIR` token 6 reads 1 on it** (0 on every normal hit), so a proc is visible to the victim's node. This is a separate axis from `$GSET` t7, which scales fn 36/37 on the headset only and ships at 0. Unlocked by this: a crit-chance perk, a high-variance weapon, and the proc mechanism a poison round needs (fire poison on a percentage of shots rather than every shot). Promoted to `protocol/brx-protocol.md` §6. → archive.
- **2026-09-18** ~~**P18 IS fn 24 A STATUS FUNCTION OR THE DELAYED BLAST?**~~ ✅ **CLOSED 2026-09-18, bench: NEITHER, and the truth is worse.** A single hand-aimed fn-24 shot applies **no damage at all** and leaves the victim's gun **manufacturing a fake `$HIR` on sensor 0 every 5.07 s**, carrying the original magnitude, shooter and team, pools untouched, until the next `$SPAWN` (13 replays over 61 s, no sign of stopping; the shooting gun is idle throughout). Each hit starts its own timer. To the player it is indistinguishable from being shot: ticking clip, hit sound, vibration, headset flash. **25, 26 and 27 behave identically; 28 and 35 do not** and fn 28 stays the silent-beacon row. The 2026-09-11 "1 to 3 delayed damage ticks" came from a beacon that kept re-arriving, and is retracted for the single-word case. The rule stands and is now evidenced: **never ship fn 24-27 on a cell a weapon can reach.** → archive.
- 2026-09-13 **F197** t2 pin completed, reviewed and validated across real/fallback player, try-out and
  utility frame generators; t2 remains 0 for both venues. Evidence: `docs/experiment-log/2026-09.md`.
- 2026-09-13 **F199** venue reminder rationale corrected to describe the measured ALT beam-width effect.
  Evidence: `docs/experiment-log/2026-09.md`.
- 2026-09-13 **F200** protocol and spec claims corrected: `$GSET` t2 is a receiver gate distinct from
  the physical ALT mode and is not an emitted-range control. Evidence: `docs/experiment-log/2026-09.md`.

# Closed 2026-09-16: the F206-F216 bench pass, evening into 2026-09-17

Two-gun bench (F206) plus a Pixel 4 + Pixel 5 game through Mission Control. Full findings:
`docs/experiment-log/2026-09.md` (2026-09-16 entry). Validated by the polish loop (commits fbeb9b62,
0cd811fd, a0ee6e19, 149981be, c913e26b, 313ae7ff).

- 2026-09-16 **F206** a `$PSET` write clears the gun's team, and nothing re-sent `$TID` after it, so the
  phone's spawn write ($PSET + $SIR table + $SPAWN) gave `$HIR` t4 = 0 both ways. Fixed: `$TID` now
  follows the last `$PSET` of any write (engine, stage, driver). Bench-proven on two guns: head then
  `$SPAWN` gave the correct t4; the phone write reproduced t4 = 0; a live `$TID` after it restored the
  team; a split test showed a lone `$PSET` clears the team and a lone `$SIR` table does not. Commits
  5458b252, fd76b58d.
- 2026-09-16 **F207** the START echo check compared the gun's `$ALCD` reserve, which mirrors `$WEAP`
  t40, against t17 instead of t17 halved, so it could never pass on any weapon. Fixed to compare against
  t40; confirmed through Mission Control 2026-09-16, the first push acked on both guns after the fix.
  This answers **F201**. Commit 9c6bb1f1.
- 2026-09-16 **F201** ANSWERED by F207: the 96-vs-192 echo mismatch was the head's own t40 value, not a
  clamp and not a halving; four weapons agreed.
- 2026-09-16 **F212** the respawn gate label and the trigger hold were fixed together: the HUD no longer
  shows `respawnGate: "trigger"` under an `auto` config, and the trigger now stays dead until T-0,
  confirmed by Tony (dead in the countdown, live in the match, live after respawn). Commits 3318df64,
  eb95e4e5.
- 2026-09-16 **F213** the armour ceiling now follows the real perk-adjusted maximum, so the HUD no
  longer shows armour above its own `maxArmor` for a `body_armor` carrier. Commit 3318df64.
- 2026-09-16 **F210** a gun link that connects and disconnects repeatedly now backs off instead of
  looping; built at the desk (commit bb624b0a, polish fix fbeb9b62). Not reproduced on hardware: the
  original loop was never captured, so this closes on the built fix, not a confirmed repro-then-fix.
- 2026-09-16 **F211** the HUD now reports whether Bluetooth is off (`bluetooth_on`, beside the other
  preflight fields) and shows a message instead of a silently empty picker. Commit bb624b0a.

- **F205** 2026-09-17 — `app/tools/screens.mjs` binds a free port per shard (`SCREENS_PORT` pins it), and `site/shots.mjs` already reads `SHOTS_MC_PORT`/`SHOTS_HUD_PORT`. See `docs/experiment-log/2026-09.md` (2026-09-17 parallel test suite).
- 2026-09-17 **F222** site shots recaptured on fix/playtest-2026-09-13 after merging main 89dd1c3d (commit 32286e1a); `test_site_shots` passes.

# Closed 2026-09-17 — the garden range test

**F170** (closed 2026-09-17) — repeat the hosted/native control at the far mark (~200 ft) with the shipped t2=0
config. Answered by the range test (`experiment-log/2026-09.md`, 2026-09-17 afternoon): a **hosted** head written
over BLE from the MacBook, `$GSET` t2=0, physical outdoor mode, bright sun, landed **12 hits at ~200 ft** with the
stock-range slot, alongside 7 hits from the reduced-t41 slot at the same mark. The hosted t2=0 far-mark result the
2026-09-13 handoff never recorded now exists, and it matches the native ~200 ft reach.

---

# Closed 2026-09-17: the verification bench (two guns, Pixel 4 + Pixel 5)

Two-gun bench (Tactix-3D4F, Tactix-E20D) plus a Pixel 4 + Pixel 5 game through Mission Control, run with
`--bench-volume`. Full findings: `docs/experiment-log/2026-09.md` (2026-09-17 entry). Validated by the
polish loop (commits b7c095c4, 0003df1a, 16a8f72f, 3a02e263, 476d5b17, faa64843, f8f7006a).

- 2026-09-17 **F215** the sniper's HUD magazine and reserve numbers tracked the gun on the bench.
- 2026-09-17 **F217** A44 spawn protection confirmed on hardware: no damage in the first ~2.4 s after
  respawn, the protection cap released every time (9 of 9 phone-log lines read `cap`), and the
  first-shot release never fired. Tony decided the respawned player must not get an advantage; a
  survivor keeping about 0.3 s of the window is fine.
- 2026-09-17 **F218** the charge-rifle match gave no false GUN NOT FIRING report, except during
  overheat lockout, which is now fixed. The swap-to-empty-slot half of the original check did not run
  today; it continues as **F247**.

# Closed 2026-09-18: the FOLLOWUPS accuracy audit
- 2026-09-19 **F220** Tony said yes and it is published: app **0.3.0** is the `app-v0.3.0` GitHub Release, cut from a clean tree at `6161a8f9`, and `webapp/download/build.json` points the site at it, which turns `test_published_build` green for the first time since the version bump. ⚠ It is a DEBUG build, because this project still has no release keystore: it sideloads, but it is signed with the throwaway Android debug key, so the first release-signed build will NOT upgrade over it and every player must uninstall once. That is a decision to take before a public game, not after, and it is not yet a row.

- 2026-09-18 **F194** `--advertise` is in the CLI flags table of `mcp/brx_mcp/mc/README.md` (commit 2d0abd5b, 2026-09-17).
- 2026-09-18 **F246** The energy-weapon "reload timeout" was a lever TAP: a tap refills nothing on an energy weapon, and a HELD lever vents the heat and refills the cell 1.95 s after release (`experiment-log/2026-09.md`, the 2026-09-18 perks bench entry item 8; F229).
- 2026-09-18 **F279** The Python `is_pool_probe` predicate and every call site unified under one semantic check: no divergence between string and numeric comparisons. `source_scan_pool_probes()` in `engine.test.mjs` fails on any new `$LIFE` string not routed through the predicate (commit cf2d34dd). → archive.
- 2026-09-18 **F283** `soak --phone-pacing` built in `mcp/brx_mcp/soak/runner.py` with `WRITE_PACING` pacing (20-byte chunks, 8 ms chunk gap, 18 ms frame gap held in the write lock, 50 ms ack cap, block pause flags); screamers Phase C now counts only with this flag (commits fd3b3dd2, 455465f3). → archive.

# Closed 2026-09-18: the desk pass on FOLLOWUPS after the playtest merge

A keyboard pass over the open rows against merged `main` (38bf662c). Each line names the evidence on `main`.

- 2026-09-18 **F225** The Charge Rifle's `<8,0>` cell moved from fn 38 to fn 1, so a charge lands its full value. `compile._SIR_PLAIN_DAMAGE` keeps fn 38 off the plain-damage list, so no weapon keys to a multiplier row by accident (`gameconfig._SIR_TABLE`, commit f35b38ba). The playtest's unexplained 85 is left to `bench-firmware-levers-2026-09-19.md` §19 step 1.
- 2026-09-18 **F165** The Energy Launcher's `<9,3>` cell moved from fn 24 to fn 1. Bench, same weapon and same word: fn 24 moved the victim 999 → 999, fn 1 moved it 999 → 884 (`experiment-log/2026-09.md`, 2026-09-18 perks bench §2; `gameconfig._SIR_TABLE`).
- 2026-09-18 **F74** The self-replay is reproduced and explained. One fn-24 hit makes the victim's gun raise a `$HIR` every 5.07 s with the shooter idle, and only `$SPAWN` clears it (perks bench §1). The loop is the fuse re-injecting a protocol-9 word while `<9,3>` was itself fn 24 (drive entry §5). No shipped table carries fn 24-27 (`test_spawn_protection`).
- 2026-09-18 **F71** The headset word deals its own damage and the two words stack: one Shotgun pull landed 45 then 70, a kill (cap30). Our compiler now prices t12 as `wire.headset_dmg` (commits 3b321148, 9b7d2ae0, afe064c4). Which emitter sends which word, and at what reach, is tracked as **F275** (and `bench-firmware-levers-2026-09-19.md` §19 step 15).
- 2026-09-18 **F36** Built APKs have run on hardware: both phones ran 0.2.1 for three matches on 2026-09-13 (`game-test-2026-09-13.md`, Setup).
- 2026-09-18 **F166** After a `$WEAP` head write the gun emits one `$ALCD` with the magazine and the t40 reserve (`game-test-2026-09-13.md` A2 table, six `ack_config` rows; perks bench §4). The echo check was fixed to compare against t40 (F207).
- 2026-09-18 **S44** The arsenal cuts are merged (commit 1bb10b67). Its three open calls (`no_heavies` now equals `open`, the Designer HEAVY chip, the unplayable-weapon path) go to Tony only if he still wants them.
- 2026-09-18 **S17** Superseded by **S42**: the native accuracy walk is not a balance lever (F230), and every accuracy cost is node-written. Recoil shipped as S42 (commit 76ad3764).
- 2026-09-18 **B16** The disable-secondary toggle exists: the loadout policy's secondary slot takes `off` (`mc/policy.py`, the `snipers` preset and `_check_rule`), and the Designer's slot editor sets it (`webapp/mc/src/screens/Designer.tsx`, `SlotEditor slot="secondary"`).
- 2026-09-18 **F228** The method note is in `docs/manual/dev.md`, the `$HIR` token 1 row: trust the sensor field only at field distance, and cover the gun sensor at the bench (2 m added in this pass).
- 2026-09-18 **F58** (a) to (c) closed earlier (sound, stage mirror, gain animation). The cap guess in (d) is refuted for shields: `$LIFE` grants of 10, 20, 25 and 30 all land (bench 2026-09-17 step 7, now in S29). The one HP grant of 25 from low HP continues as **F109**.
- 2026-09-18 **F208** (a) is built as A45 (`pool_stale` in `mc/types.py` and on the MC board; the bench saw it flag `no_fire`, F264). (b) is closed by A47 RESYNC GUN and FORCE RESPAWN, proven on hardware (F235). The bench gate passed: no false `no_fire` on a charge-rifle hold (F218) or a swap to an empty slot (F247). The HUD rendering and a probe on `no_fire` continue as **F272**; the self-cure question is F264.
- 2026-09-18 **F49** Folded into F206 (closed 2026-09-16). A lone `$PSET` clears the gun's team, so a head that sent `$PSET` after `$TID` left the gun on team 0. That is the reading that fits this row, not a re-run: a team-0 word was then a same-team shot (dropped with friendly fire off) and a team-1 word an enemy shot (landed), which is the "backwards" polarity this row saw through the stage's arm. The stage now re-sends `$TID` after the last `$PSET` of any write.
- 2026-09-18 **B27** Folded into F66: both rows ask whether fn 23 cuts the victim's audio. F66 carries the `sound.md` claim and the bench step.
- 2026-09-18 **K7** Folded into S29. Its blocker is stale: `$LIFE` grants a shield over BLE (2026-09-11), and the Shields preset is designed there.
- 2026-09-18 **S45** Folded into S29, as the row itself said. Its presets, bench step 7 results, by-ear picks and the cap30 recipe moved into S29 verbatim.
- 2026-09-18 **F148** Folded into F209: a hit during the REDEPLOYED screen is the spawn-protection case, and A44 is confirmed on hardware (F217).
- 2026-09-18 **F80** Folded into F271: the arm-time refusal is the `$QUERY` read-back. The recap already counts wire-id-0 hits.
- 2026-09-18 **B19** Folded into F271: the same `$QUERY` read-back after arming. Its wider diff (voice, per-slot damage and fire sound, the late replies) moved into F271.
- 2026-09-18 **F163** Folded into F272, which replaces the disabled B4 watchdog reading. Its three open questions moved into F272.
- 2026-09-18 **F234** Closed 2026-09-17 in its own row, swept out now: `resolve()` writes t2 only, t41 is never written, and a floor guard refuses t2 under 13. Its second item continues as **F249**.

# Closed 2026-09-18 — the verification bench, MC + two phones + two guns

- 2026-09-18 **F235** All three operator actions ran against real hardware. **FORCE RESPAWN** is proven twice, including as the probable cure for a live dead-gun desync (F264). **RESYNC GUN** runs end to end and the phone confirms it (`RESYNC DONE` in the feed, from both the console and the API), but ⚠ **it did not cure the desync it was aimed at**, which is recorded in F264 rather than here. RELINK GUN was not needed and is not proven.
- 2026-09-18 **F236** Mission Control was killed mid-match and restarted while two phones stayed in the game. It came back in `phase: live` on the SAME match id (`0530ad9415`), both nodes `arm: live` and neither stale, and Tony on the console: "it rendered on the match tab and it seems to be completely accurate". The orphan-resume path was not even needed: the session snapshot carried the running match through the restart, so there was nothing to adopt. That is the 2026-09-17 failure (a restarted MC could not account for the running match, and by design would not end it) fixed at the root. The adopt path, for a match with NO snapshot, is still unproven on hardware.
- 2026-09-18 **F238** the energy gauge on the charge rifle reads correctly: the cell as a percentage, the reserve as cell pills, and HOLD TO RECHARGE once the cell cannot pay for a charge. NOT ENOUGH ENERGY correctly stays hidden until the cell is part-full. (The out-of-energy wording it exposed is **F257**.)
- 2026-09-18 **F239** the full-screen OVERHEAT takes over the HUD on the charge rifle, confirmed by Tony.
- 2026-09-18 **F240** NIGHT OPS dims the LEDs only and the HUD skin is right. Tony on the gun LEDs: "oh gun leds are dimmed yeah", and on the per-player skin toggle: "the toggle for night mode is workin btw, its nice". The contrast complaint it produced (thin text unreadable at low luminance) is fixed in the same session by adding weight rather than brightness, because the dim red is the point of the mode.
- 2026-09-18 **F241** the shot-ready cue. Tony at T-0: "it sayd weapons hot weapon led flashed and once leds went team color then trigger worked", which also confirms the trigger stayed dead through the countdown. Note the cue is deliberately only for weapons cycling at 400 ms or slower (`SHOT_CUE_MIN_MS`), so an assault rifle gets none and that is by design.
- 2026-09-18 **F242** the results overlay opens from the player name and from the game time, both tabs, closable, confirmed mid-match. (The name's left margin is fixed in the same session.)
- 2026-09-18 **F243** HARDWARE READY and ENABLE BACKHAUL against a real `cloudflared` tunnel: the button ran STARTING then BACKHAUL ON, the join QR carried both the LAN and the public URL, and both phones joined. (The coverage line it exposed is **F256**.)
- 2026-09-18 **F244** MARK ALL READY marked both players ready from the operator's side.
- 2026-09-18 **F245** Tony on the charge rifle's overheat: "yes it sounded like overheating". `$PLAY,C19` is the right cue after all, and the full-screen OVERHEAT shows with it (F239).
- 2026-09-18 **F247** A45 `no_fire` does not fire on a swap to an empty slot. Tony with a one-weapon loadout: "alt button does nothing" and "hud does nothing", which is both halves: the button is inert and the HUD makes no false claim about the gun not firing.
- 2026-09-18 **F255** THE HUD IS NOT TOLD TWICE THE SPARE ROUNDS AFTER ALL. `resolve()` writes the catalogue's `reserve` to **t17** and half of it to **t40**, and F207 proved the gun reports t40, so reading the compiler alone said a player carried half of what the HUD claimed. The bench and the bundle both say otherwise: **`$AMMO,0,32,192` rides `frames.spawn` AND `frames.revive`**, so the gun is set to the full catalogue reserve at every spawn and the HUD agrees with it. The halved t40 is live only in the ~200 ms between the `$WEAP` and the `$SPAWN`, when nobody is shooting. Nothing to fix; the lesson is the older one, that a value on the wire is not a value in play until you check what overwrites it (brx-weapons found it on the bench, 2026-09-18).
- 2026-09-18 **F254** The `$SIR` table takes **eleven rows**: S50's armour-piercing cell is the eleventh and it works, so there is no cap at ten and nothing is dropped silently. Two more answers from the same run: **fn 2 is real armour piercing** (magnitude straight to health, armour untouched), and **A44 already covers the new cell** (against the protected twin table an AP shot fires a `$HIR` and moves no pool). ⚠ Method note for the next person: `$QUERY` over BLE returns a status array, NOT the `$SIR` table, so a row can only be tested by firing the word it answers and watching the gun's own `$LCD`.
- 2026-09-18 **F263** Bench 2026-09-18, two guns, victim at 250/250 so nothing could die. One trigger pull each, victim's own frames: - **Shotgun** (`t1=2`, `t5` 45, `t12` 70): `$HIR,0,0,8,2,45` then `$HIR,4,0,8,2,70`, **119 ms apart**. Armour 250 → 205 → 135. **115 damage a pull**, which one-shots the 115 pool. - **Plasma Sniper** (`t1=2`, `t5` 25, `t12` 80): `$HIR,4,0,8,2,25` then `$HIR,4,0,8,2,80`, **57 ms apart**. Armour 126 → 101 → 21. **105 damage a pull.** - **Control, assault rifle** (`t1` empty): one frame, `$HIR,4,0,8,2,9`. Nothing else differs. ⚠ **Read the frames before the conclusion: those are CALLSIGN's captured numbers, which is what I armed, NOT what Open BRX ships.** Our compiled Shotgun is `t5` 20 with `t12` 20, so 40 a pull and three pulls to kill, and the 1.60 s in `weapon-design.md` was right all along. The finding is the MECHANISM, not a balance emergency: **the second word carries `t12`'s own magnitude**, proven twice with different numbers on two weapons, which had been sourced from one capture and one expert reading and never independently measured. main priced `t12` from a declared `wire.headset_dmg` the same morning (`damage_per_pull()`, commit 9b7d2ae0) and now refuses to compile a weapon whose capture carries an unpriced `t12`, so the second word can never be free again. **Related, and it is the answer to main's F260 question: NO token separates the two words.** Protocol, shooter id, team and the last two tokens are identical in both; the sensor differs by geometry (0 then 4 for the shotgun, 4 then 4 for the plasma sniper, and main's own capture had both on 4); the magnitude differs only because the catalogue prices `t5` and `t12` differently, which our own Shotgun (20 and 20) erases. **The gap is not fixed either: 119 ms here, 57 ms on the plasma sniper, 88 ms in main's capture**, and the assault rifle cycles at 100 ms, so no fixed window can separate a pair from two real shots. So a collapse cannot be keyed on the frames and must be keyed on the live weapon, which the NODE knows and MC only knows as the loadout a player started with. **The collapse belongs to the NODE, for the statistic ONLY**: both words really land and really deduct, so the health maths must keep counting two and only the shots-landed number collapses. MC cannot own it because a mid-life weapon swap is invisible to it. That half is open as main's F260.
- 2026-09-18 **F259** The writer erased shots because it restored `$AMMO` from a remembered count while its own `$WEAP` reset the magazine, so the gun never ran dry ("31/32 back and forth", then settling on 32). The first rebuild then OSCILLATED on hardware, because the restore's own `$ALCD` looked like a burst and re-triggered the degrade: a loop of our own making, caught by tapping the phone's outgoing frames. Fixed with an echo window owned by the write plus a shot account that books the trigger press, and the gun's absolute number wins whenever no write is in flight. **Proven end to end, 2026-09-18:** the node degraded after four rounds, **the gun confirmed 70 and held it for all 22 frames of the burst**, and recovered to 100 on release, one degrade and one recovery. Tony heard the victim playing near-miss cues through the burst, which is the independent confirmation that the shots really did miss (a miss sends no `$HIR`). The design is Tony's: one step, not a walk. ⚠ **One display blemish remains and is not this row:** the gun's reset value still flashes on the HUD mid-burst ("it shoots up to 32 while shooting ... it syncs on trigger release"), because `state()` reads the raw magazine inside the echo window instead of the account. Fix in flight; the count itself is correct throughout.
- 2026-09-18 **F258** The picker ranks the player's assigned gun first, then a Nordic UART advert, then a tagger-shaped name, and folds the televisions away. It paints at 2 Hz only when something changed, patches rows in place by `deviceId`, orders by first sighting rather than RSSI, and stops the scan before it connects (the three-second freeze after a pick). The raw scan keeps no service filter, for the bench-proven reason on the line. Proven by 16 mutations and confirmed on the phones at the bench the same day, Tony: "the bluetooth list is clean now, just the taggers listed".
- 2026-09-18 **B25** Answered by **F207**: the gun's own `$ALCD` reserve mirrors **t40**, so t40 is the player's spare-round count and t17 is twice it. The manual, `protocol/brx-protocol.md` and the published arsenal column all read t40 now. The row's second half became **F253**, because the wire answer exposed a mismatch the prose never could.
- 2026-09-18 **B25 CORRECTED** the same day by main's perks bench: `$ALCD` mirrors **t40 only in the ~200 ms between `$WEAP` and `$SPAWN`**. Measured on the real AR frame (t17 192, t40 96): reserve read 96 after `$WEAP`, then **192** after `$SPAWN` and after MC's `$AMMO`. So the count a player CARRIES is t17's 192; t40 is what a bare `$WEAP` leaves behind, which is why `$AMMO` follows every re-push. The 2026-09-16 reading was taken inside that window and read a transient as the steady state.
- 2026-09-18 **F248** The Rail Gun read "50%" on a two-round magazine, because the HUD's energy gauge followed A48's `weapon_class`. The gauge now follows **`rounds_per_charge > 1`** (`usesCellGauge()` in `app/src/hud/hud.js`), which is the question the gauge actually asks: a weapon that spends several rounds per charge gets the cell gauge and the reserve pills, and everything else gets pips or the big-magazine bar. `isEnergyWeapon()` keeps only the wording (RELOAD against RECHARGE, HOLD TO RECHARGE, OUT OF ENERGY). The Energy Rifle's 300-round magazine correctly moves to the big bar with it. `app/tools/screens.mjs` asserts both classes, and a pre-A48 bundle falls back to the named charge-cost constant.
- 2026-09-18 **F56** 🟠 HALF CLOSED 2026-09-09 ON THE GUN — the DAY half is fixed and verified, the NIGHT half stands. Fix shipped: the in-play rest is the team colour at brightness 1 while the readout paints at full, so brightness separates them. Tony, watching purple armour over the dim blue rest: *"way brighter, reads as an event"*. ⚠ **At NIGHT both rest and readout are dim**, so that separation does not exist and the hue collision below is live on a SETTLED bar. A drop still reads at night (it opens with an all-off blink and the steps carry the change); a bar that has already settled does not. Night was verified as READABLE on blue team, which is the easy case — **the untested bad case is team 3, whose colour IS armour purple.** The collision itself, unchanged and still true at night: A16.4 (2026-09-09) made the gun body rest on the team colour. `TEAM_DISPLAY_COLOURS` is `{0: RED, 1: BLUE, 2: YELLOW, 3: PURPLE}` and the readout paints **armour PURPLE** and **health GREEN/YELLOW/RED**, so: **team 3's armour bar is the same hue as its own rest frame**, **team 2's mid-health band is**, and worst, **team 0's CRITICAL red is** — a red-team player's about-to-die bar is the colour their gun sits at all match. Only team 1 (blue) is clean, and blue is what the bench has been running on, so this would pass a hardware check and fail for three quarters of a real game. The existing collision guard (`presentation.py`, led-language §6 finding #3) covers EVENT BURSTS only — the readout bar has no such guard. Partly masked by motion (a drop opens with a lead freeze and an all-off blink, so there is a dark beat before the bar lands) but a SETTLED bar at the rest hue is genuinely ambiguous, and the shield/armour bars do not shift hue at all. **Recommended fix: rest DIM (token 5 = 1), readout FULL.** Brightness is global and otherwise unused by the bar, it separates every colliding pair at once, it makes the resting body unobtrusive (Tony's immersion brief and his own "the team color doesn't need to be static bright"), and it costs nothing — brightness is already a token on every compiled frame. Alternatives: move team 3 off purple and team 0 off red, or force a dark beat before every readout paint. `build`, then one bench look.
- 2026-09-18 **Q18** 🟡 ✅ the print half closed 2026-09-11 (late, second session): `modes/driver.py` probes `$PHONE` and waits for the gun's `$BUT` before it prints, counts or re-arms a reconnect (`test_reconnect_is_not_declared_until_the_gun_answers_the_probe`). Still untested: can a gun absent at START join a running match? `build` + `space`.
- 2026-09-18 **S4** leftovers 🟢 gun body LED (A11.7, body taken 2.5 s after `$SPAWN`): (b) CLOSED 2026-09-07 (a paint held 8 min with no traffic); (e) blink forms after a blank; the separate muzzle-flash LED's addressability; an event burst in the first 2.5 s of a life still fights the breathing (exact threshold 1.5–2.0 s). `eyes`.
- 2026-09-18 **F106** 🟢 STATION-ARMING LOWS FROM THE 2026-09-11 POLISH PASS (PR #1). ✅ (a) (b) (c) (d) (e) (i) fixed 2026-09-11 (late, second session); **(f) (g) (h) stand.** The original list, for the record: (a) `abort_start` leaves `_game_no_started` set, so the next muster push bumps the game byte though no match ran (harmless: the point resets to neutral; the ITEMS "GAME n" counter drifts); (b) `net.py _fire_node` never forwards `app_ver`, so `station.app_ver` is always None off a real socket; (c) a node that was bound as a player and re-hellos as `utility` keeps its `node_player` entry; (d) `_finish` still sends `pull_log` to utility nodes and `abort_start` still broadcasts to them (noise); (e) `engine.js _stationAllowed` is PERMISSIVE when `config.stations` is absent, so clearing the LAST station re-opens the allow-list to everything (matches the seven-tap hand-arm fallback; the `types.py` comment should say so); (f) `control.js` credits possession from `Date.now()` unclamped, so a forward clock step is credited to the owner in full (a cap would also under-report; decide a bound); (g) ITEMS: "n/m ARMED" excludes a card whose only flag is BATTERY LOW; CLEAR has no confirm and the phone keeps advertising the old assignment with nothing on the card saying so; `TID_NAME` hardcodes colour names where LOBBY uses `teams[].name`; the PHONE/LINK rows are unpaired spans for a screen reader; the Recap `warnings` block is styled like PROVISIONAL; (h) `delay_s: 0` still means 10 s on the node with no message; (i) API.md omits `app_ver` from `StationView`; the mock's `online` is always true so OUT OF WI-FI cannot be demoed. `build`.

# Closed 2026-09-18: firmware levers bench, session 1

Two guns, Tactix-E20D and Tactix-3D4F, then Tactix-E20D alone with the ESP32 IR rig as emitter. Full findings:
`docs/experiment-log/2026-09.md` (2026-09-18 entries, "firmware levers session 1"). Claim checklist:
`docs/bench-firmware-levers-2026-09-19.md`.

- 2026-09-18 **F276** not a defect: five single pulls from a flat 20/20 Shotgun gave TWO `$HIR` of 20
  every time, 60 to 75 ms apart, including one pull where both landed on sensor 0 as distinct frames.
  The 159 ms beacon block does not merge identical words, so the published 3-pull kill stands.
- 2026-09-18 **F65** answered in full: `$BUMP,<amount>,<hp 0/1>,<armour 0/1>,<shield 0/1>,<sound>,*`
  is confirmed (negative cascades armour then HP, positive heals HP then spills into armour, each
  pool flag gates independently), and the original "inert" reading was two flags of 0, which the gun
  correctly ignores with no `$HP` reply at all. The shield flag and the sound token are still
  untested.
- 2026-09-18 **F230** closed as explained enough. The native accuracy walk appears only when a `$WEAP`
  frame sets the floor below the ceiling (`t22` < `t21`). The catalogue ships `t21` = `t22` (S42), and the
  walking gun holds a flat frame (100/100 for 32 rounds, 50/50 from the first shot), so no shipped game
  sees the walk. Recoil is node-written with `$TMP` t4. The per-gun cause is still unknown; the USB
  device records of both guns match apart from factory QC fields.

# Closed 2026-09-18 (night): the three-lane session close

- 2026-09-18 **F65** addendum to the closure above: the third sitting confirmed the two fields that line called
  untested. The shield flag gates the shield pool on its own (`$BUMP,-10,0,0,1,,*` took shield 40 to 30), a drain
  empties the shield and then cascades into the other selected pool, and the sound token plays the named id (an
  empty token plays nothing). `$BUMP` is confirmed on every field. Evidence: `docs/experiment-log/2026-09.md`,
  2026-09-18, "firmware levers session 1, third sitting".

# Closed 2026-09-18 (night): overnight cycle 1

- 2026-09-18 **F257** `hud.js`'s `energyOut` now fires only when the cell is truly empty (`ammo === 0`) with no
  reserve; a charge weapon with taps left shows the small note only, never the big OUT OF ENERGY prompt
  (commit 180b0c5b).
- 2026-09-18 **F261** A fresh Mission Control now records an orphan match from any unbound node, not only a
  bound one, so RESUME MATCH works after a restart (commit 0c98b487).
- 2026-09-18 **F278** The runtime crit-perk refusal ships beside the existing compile-time guard: a weapon
  declaring `wire.headset_dmg` refuses a crit perk at runtime (commit 483925ea).

# Closed 2026-09-19: the toxin lane

- 2026-09-19 **S16** Damage over time ships as the Toxin Rifle: every hit poisons, the node tick clock (`spec/node.md` §3.17),
  kill credit to the applier (`death` with `dot: true`), cleared on death and respawn, HUD countdown. Unhidden; balance in
  weapon-design.md §7.5b (branch `feat/toxin-s16`).

# Closed 2026-09-19: the pre-game office test and the respawn-profile rebuild

Field feedback from Tony's 2026-09-19 office test (Pixel 4 + Pixel 5) drove App 0.4.3's respawn profiles
(commit 9fe9dcfc, review fixes 9f234a2b). Full findings: `docs/experiment-log/2026-09.md` (2026-09-19 entry).

- 2026-09-19 **F121** superseded by the 0.4.3 respawn-profile rebuild (contracts A49). The single
  spawn-protection mechanism this row described (`$SPAWN,,*` then `$TMP` t8 = -100, ending at the gun's first
  shot or a 2.1 s cap) is replaced by two named profiles: a timed respawn (protection 0/1/2 s, a separate
  weapon-delay hold of 500/1000/3000 ms that never goes live until 0.5 s after protection ends) and a station
  respawn (protection 2/3 s, trigger live at once, a visible shield blink). Go-live is now equal for every
  player: the live `$SIR` table lands at T-3 while the head still holds every trigger, closing the countdown
  half of this row's original bench gate. Office-test observation, recorded and not chased further: on 0.4.2 a
  hit landed damage 0.73 s after a respawn (09:49:52.4 against a 09:49:51.7 respawn) even though the same
  window blocked other hits cleanly (green headset flash, no damage) — superseded by 0.4.3's rules before a
  root cause was needed.
- 2026-09-19 **F209** superseded by the same rebuild. The asymmetry this row named — hit reception returning
  before the trigger does — is now a design rule rather than a bug: `weapon_delay_ms` is independent of
  `protect_s` and the trigger is held (`$BMAP,0,98`) for the whole delay, so the gap cannot reopen the way the
  single-mechanism design did. The burst-collapse half was already closed 2026-09-16 as an outbox-flush
  artefact, not the engine. What this row's diagnosis leaves behind is **F223** (order node facts by their own
  `t`, not arrival time), which stays open on its own.

# Closed 2026-09-21: browser-gate baseline

- 2026-09-21 **F290** current `main` passes the complete 19-job UI tier. The historical `mc-koth` stale-server
  cascade no longer reproduces; the one live `app-screens` failure was the utility phone's rAF-driven hold-to-exit
  deadline, closed with an independent timer and deterministic browser coverage.
- 2026-09-21 **F295** closed with F290: the ten recorded overlay failures no longer reproduce. The surviving
  hold-to-exit race now covers pointer cancellation, deployment, keyboard and assistive activation at both target
  phone sizes.

# Closed 2026-09-21: arming read-back

- 2026-09-21 **F271** the phone now sends `$QUERY,*` after a successful head echo and reports the confirmed
  player id, team and HP/armour/shield maxima in optional `ack_config.gun_config`. MC compares all five with the
  actual pushed `$PSET`/`$TID`, renders a red re-push cure and refuses a mismatch even with force. The undecoded
  sound/gyro/per-slot remainder was split to F300.

# Closed 2026-09-21: evidence-gated operator resync

- 2026-09-21 **F287** RESYNC now sends only `$LIFE,0,0,0,*`, waits for that write to enter and clear the
  serialized BLE queue, and releases its re-arm burst only for the probe's positive `$HP` inside 1.5 s. Dead,
  silent, expired, pre-send and cancelled paths write no burst and report a truthful refusal to Mission Control.

# Closed 2026-09-21: phone-visible gun-health verdict

- 2026-09-21 **F288** the live phone HUD now renders `poolStale.why === 'no_fire'` and the conclusive
  `cure.verdict === 'no_answer'`, with the latter naming FORCE RESPAWN or relink. The compact alert owns its lane
  over lower-priority chips, remains readable at the smallest phone size and at night, and yields to gun-link,
  flap and relink controls. Recovery removes the warning and restores the ordinary chip lane.

# Closed 2026-09-22: tagger ownership picker

- 2026-09-22 **F202** the HUD diagnostics panel's CHANGE TAGGER action disconnects the current gun, clears
  only the locally remembered tagger, and opens the existing picker; player/roster context is preserved.

# Closed 2026-09-22: stale Mission Control target cleanup

- 2026-09-22 **F203** a remembered MC target that times out before welcome now clears the saved LAN URL,
  backhaul URL, and secret, then resumes discovery. Focused app tests pass 898/898.

This archive began as the 2026-09-06 migration from `docs/FOLLOWUPS.md`; later session-close blocks are appended
in the same format. **Not maintained; grep it, do not read it.** Older snapshots can repeat an id when two lanes
closed or corrected the same row; use the latest living entry in `docs/FOLLOWUPS.md` as the canonical status. A
block's *internal* statuses were true when it closed and may since have been superseded (the living files win: `docs/manual/`,
`docs/spec/contracts.md`, `protocol/brx-protocol.md`, `docs/FOLLOWUPS.md`). Evidence for every claim is in
`docs/experiment-log/`.

---

# Closed 2026-09-22: live phone scoreboard

- 2026-09-22 **F265** Mission Control now pushes score snapshots after status-heartbeat ingestion, not only after
  hit/death events. Miss-only firing therefore updates shots and accuracy on every bound phone, while the existing
  full-body de-duplication keeps unchanged heartbeats quiet. A real two-phone browser regression proves that one
  phone's miss-only burst lowers its rendered accuracy on the other phone's PLAYERS board, keeps the board LIVE,
  and remains visible inside a 740×340 viewport. The earlier 16-second MC-message freshness label remains the
  disconnect guard; the missing status-to-score push was the cause of the continuously bound freeze.

# Closed 2026-09-22: one accuracy owner

- 2026-09-22 **S55** recoil now writes only absolute `$TMP` t4, never `$WEAP` or `$AMMO`. Native fn-23
  smoke/EMP owns t4 for its measured six-second window; repeated Haze extends it and the node reasserts its
  latest target afterward. The shared HUD pill renders RECOIL / RELEASE TO STEADY and retains smoke priority.
  Flinch and stance remain separate unbuilt mechanics.

# Closed 2026-09-22: mock team lock

- 2026-09-22 **F172** `?mock` now refuses a real team change in ARMED/LIVE with the same 409 and operator
  guidance as the server, while same-team and null no-ops remain legal and editable phases remain editable.

# Closed 2026-09-22: isolated diagnostic reader

- 2026-09-22 **F173** the diagnostic HTTP worker now owns a short-lived read-only SQLite connection instead of
  sharing the live store writer. Its multi-query report runs in one snapshot, and encoded absolute file URIs
  preserve valid store paths containing URI metacharacters.

# Closed 2026-09-22: diagnostic binding attribution

- 2026-09-22 **F175** a node that reports multiple player bindings in one match now keeps an ambiguous physical
  summary and explicit per-player/null attribution rows instead of assigning every status fact to the last player.
  Cumulative shot-counter deltas preserve the match total across rebinds and resets.

# Closed 2026-09-22: previous-match diagnostic on the runway

- 2026-09-22 **F174** ARMED now permits a token-gated, explicitly named previous-match diagnostic while retaining
  409s for the current match, a full-session scan, missing current-match state, and every LIVE request.

# Closed 2026-09-22: behavioral UI guards

- 2026-09-22 **F179** replaced the standby and hidden utility-door source-text greps with rendered/component and
  built-app behavior. Lobby, Kit and Armory are locked in both ARMED and LIVE. The utility door requires six taps
  plus a held seventh, cancels on an outside-frame release or eligibility loss, and refuses a gun link that comes
  up during the hold.

# Closed 2026-09-22: low-risk polish residue

- 2026-09-22 **F224** is stale: live-gun recovery has the bounded `GUN_RECOVERY_MAX_WRITES` retry budget and
  exhaustion coverage; the picker is covered by behavior tests rather than a source-text grep; the night skin
  raises standby contrast/weight; and the iOS-like picker path explicitly says **BLUETOOTH IS OFF** while keeping
  Android-only enable/settings actions gated.

# Closed 2026-09-22: standby screen truth in the standard gate

- 2026-09-22 **F180** ordinary app `npm test` now runs all six existing A38 standby browser checks: both standby
  entry paths and the handler-level READY refusal at 891×411 and 667×375. The root parallel runner reuses its
  up-front build and writes focused captures privately; CI installs Chromium before the gate.

# Closed 2026-09-22: deterministic live-accuracy browser fixture

- 2026-09-22 **F181** the M2 browser walk disables only the mock's random background kills, drives exactly one
  six-shot kill, and reads the resulting `~50%` provisional accuracy from the rendered board. An adversarial
  zero-random control makes deleting the fixture fail deterministically instead of reviving the timing race.

# Closed 2026-09-22: utility-to-HUD station cleanup

- 2026-09-22 **F184** the first HUD hello after BACK TO HUD proves its distinct prior utility identity with that
  identity's takeover key. MC then removes the retained ITEMS/node row, shrinks active allow-lists, and preserves
  any self-authoritative station counters for the live match's recap.

# Closed 2026-09-22: real-browser end-delivery truth

- 2026-09-22 **F185** real Chromium now ends a LIVE match through the guarded console controls against a real MC,
  proves the automatic MATCH-to-RECAP transition, then renders the explicit LIVE diagnostic view against that same
  post-whistle snapshot. Desktop and phone checks cover the delivery notice, every pending STATUS cell and overflow.

# Closed 2026-09-22: Designer PLAY loads before KIT

- 2026-09-22 **F188** `PLAY THIS NOW` now applies the draft, announces it to phones through the frameless LOAD
  contract, and only then enters KIT. Failed or stale-server LOADs stay in Designer with a visible error; an
  in-flight PLAY locks duplicate actions and navigation. KIT distinguishes a loaded game from guns not yet configured.

# Closed 2026-09-22: worktree-safe KIT browser harness

- 2026-09-22 **F189** the KIT browser harness resolves an explicit `MC_PY`, its checkout's venv, then the main
  checkout's shared venv through Git's common directory. The child still imports MC code from the current worktree,
  and a missing interpreter now fails with an actionable `MC_PY` message.

# Closed 2026-09-22: amendment citation coverage

- 2026-09-22 **F196** the amendment citation resolver now scans `mcp/tests` as well as production code, so
  amendment rows can cite their regression tests without silently skipping them. The focused citation suite passes 4/4.

# Closed 2026-09-22: Easy Reload HUD indication

- 2026-09-22 **S52** `loadout.overrides.easy_reload` now reaches the phone HUD state, which renders `ALT = RELOAD`; the picker also warns before a secondary weapon request that would take the ALT button. The S52 engine regression and existing app screen gate pass.

# Closed 2026-09-22: alias reconnect after BLE drop

- 2026-09-22 **F249** `connect()` now replaces a dead alias session in both the real and fake BLE managers while preserving the live-alias refusal. The focused fake-manager regression and server safety suite pass.

# Closed 2026-09-22: mock WSL warning parity

- 2026-09-22 **F193** the Mission Control mock imports one shared warning constant, and the rendered MC test
  compares it exactly with the server's `WSL_UNREACHABLE_WARNING`. The MC reach suite (22/22) and netinfo suite (17/17) pass.

# Closed 2026-09-22: fake-net join refresh

- 2026-09-22 **F192** synchronous `FakeNet.start()` and the real async startup now refresh the session's URL
  and QR from post-bind `join_info`, eliminating the stale `0.0.0.0:0` join address. The focused advertise suite passes 10/10.

# Closed 2026-09-22: current-config load status

- 2026-09-22 **F190** was already implemented in the current tree: `pushGate` owns the config-id-current
  predicate and both LOBBY and GAMES `LoadStatus` callers consume its `acked` count. The focused browser
  regression explicitly rejects an older-config ack; the row was stale bookkeeping, not a remaining code gap.

# Closed 2026-09-22: APK SDK provenance

- 2026-09-22 **B22** `build.json` now records Android `minSdk` 24 and `targetSdk` 36, and the rendered
  download card shows both values. The sidecar guard and real browser download-page check pass.

# Closed 2026-09-22: distinct USB query parser naming

- 2026-09-22 **F252** renamed the USB-console parser to `parse_usb_query`; the protocol parser remains
  `protocol.parse_query` with its distinct normalized wire-diagnostic shape. USB callers and focused tests now
  name the parser they actually consume.

# Closed 2026-09-23: kill confirm, superseded by the IR callout bus

- 2026-09-23 **B31** the BLE-advert kill-confirm design is superseded by **S57**, which keeps the victim gun's own
  `$IRTX` (a dead gun still forwards it). The design lives in the S57 row.

# Closed 2026-09-23: dual-emitter accuracy accounting

- 2026-09-23 **F260** the node assigns both words from one physical dual-emitter pull the same `shot_group`; MC counts each group once for the accuracy numerator while retaining both landed words in the damage log. Node regressions cover grouped dual words versus rapid ordinary hits, and `mcp/tests/test_mc_scoring_warnings.py` covers grouped versus distinct accuracy counts.

# Closed 2026-09-23: native playbook command safety decision

- 2026-09-23 **F273** remains on the known command list: `$PB*` and `$AS` are used by bench tools, no compiled
  bundle emits them, and the protocol/safety tests preserve that boundary. The row's decision was already recorded.

# Closed 2026-09-23: FFA standings ladder

- 2026-09-23 **F18** was stale bookkeeping: the HUD already renders the FFA player standings board from the
  Mission Control snapshot, labels the tab `STANDINGS`, and limits the player list to the top three.

# Closed 2026-09-23: app lifecycle and utility contract coverage

- 2026-09-23 **S35** added focused source-contract tests for app log-sync wiring and utility lifecycle identity,
  persistence, and release handoff. The app lifecycle test file passes 4/4; no production behavior changed.

# Closed 2026-09-23: evidence event-time ordering

- 2026-09-23 **F223** the evidence extractor now emits both event time `t` and receive time `t_recv`,
  sorting by the fact's own time with stable receive-order fallback for legacy/unsynchronised rows.

# Closed 2026-09-23: validation inner loop and headset preflight

- 2026-09-23 **F182** was already shipped in `fb5b3bcc`: `test-all.mjs` provides parallel, memory-bounded
  focused jobs and preserves the full UI run as the merge gate; current contributor docs cover the workflow.
- 2026-09-23 **B18b** was already shipped: MC proves headset presence from sustained link or config echo,
  exposes the proof in readiness, and Armory renders the resulting state. Existing tests pass 16/16 and 14/14.

# Closed 2026-09-23: self-host HUD and Mission Control fonts

- 2026-09-23 **S34** removed the Google Fonts dependencies from the phone HUD, utility page, and Mission Control. Saira Condensed is now bundled for the app/site trees, while Mission Control bundles Oswald and Chakra Petch. The app, MC, and site builds pass; the site Playwright font/accessibility gate passes.

# Closed 2026-09-23: decisions and the balance rules

- 2026-09-23 **F187** closed by decision: Tony accepts the 16-retired-match bound (`_ENDED_KEEP`); a phone away
  that long rejoins the lobby and gets no end delivery. No durable match ownership.
- 2026-09-23 **S54**, **F268**, **F280** closed by `aa7b08b9`: Tony chose recoil rungs by ROUNDS PER TRIGGER PULL scaled by
  calibre (5 clean at 8 damage, 3 more to heavy), a release reset while crisp, the Burst Rifle flat, floors at 60,
  the Assault Rifle at 80/60. The catalogue now carries the S54 fields. The bench half is F308.
- 2026-09-23 **F178** closed: READY stays player intent (Tony's decision). `lobby.updating` counts the READY players whose
  gun has not answered the pushed head, and LOBBY reads "7/7 READY · 1 UPDATING" (the intent count, plus the updating tag). Server, console, API.md and mock together.
- 2026-09-23 **F256** closed by the conservative fix: `coverage.level` is always `zones`, because `reach` names only the URL.
  The chip states the tunnel count and is never green. The real fix, a node-reported transport, is F309.
- 2026-09-23 **F251** closed by `ec5c4ba3`: `mc/fake_invariants.json` lists seven node-protocol behaviours, asserted against
  Session/FakeNet and MockNode in Python and against the `?mock` backend in vitest; each side fails on an id with no case.
- 2026-09-23 **F289** closed: Tony chose the board flag. The node reports the owed end write (`status.protected`,
  `protect_ms` on respawn/team_change, brx4 `8b480775`/`bbbadf30`); MC stamps `LiveRow.possibly_protected` on a STALE
  row whose newest evidence says it was owed, and LIVE reads POSSIBLY PROTECTED · HITS MAY NOT COUNT.
- 2026-09-23 **F191** closed: Tony's rule is that the standing WSL banner never displaces a real alert. `CommandBar` already
  rendered every banner on its own condition; the WSL banner now sits LAST, below the tunnel alert, pinned in `console.test.tsx`.
- 2026-09-23 **F284** closed: there is no 180 s give-up (likely the "3 min out of range" rejoin test step). The phone never
  gives up on MC: it redials in every phase, 0.5 s doubling to 10 s (`transport.js` backoff), keeps the match local, and
  queues facts (`ring.js`, 500 or 2 h); only a 4001/4003 refusal stops it. MC: stale at 8 s, gone at 10 min. Tony accepted it as is.
- 2026-09-23 **F291** closed by the balance rules R1-R10 (docs/weapon-design.md, top table; `ef55b7db..6dae402d`):
  Tony's duel rules are CI-gated at 65% on Standard. Charge Rifle 70 + 16-damage taps, Shotgun 700 ms / 30% range,
  SMG 7 + 2, Burst Rifle t23 550 with its 40% crit, Deagle 700 ms, USP mag 12, Suppressor 100/85/70. Bench half: F308.
- 2026-09-23 **F310** closed: every balance rule R1-R10b holds on the Shields preset, gated at 60% (Tony: "60 is fine");
  Hardcore reported only; the heavies decision is Balance rules row 7. Detail: docs/weapon-design.md §7.5f, row 13.
- 2026-09-24 **F318** closed: the MC visual-QA Lows. LIVE offline reads LAST KNOWN, not a red LIVE; VIEW GAME · NOT LOADED;
  the locked GAMES line; the clock subtitle breaks at its separators; KIT names ellipsise; the feed de-duplicates (the
  go-live and restart doubles); one noun, NODES; the GameEditPanel hook order; locked selects look locked; 36 px targets;
  11 px GAMES labels (the nav digits stay decorative). SPECTATE fits every player (`8b7a392c`).
- 2026-09-24 **F108** closed: MC binds its HTTP socket before the banner and serves uvicorn on it; a busy port exits 2 with
  one line (`f1ea2b47`, POSIX-only SO_REUSEADDR in `519f3172`).
- 2026-09-24 **F325** closed: `respawn.gate` survives PUT /api/config, scanner only; null clears it, a bad value is a 400.
- 2026-09-24 **F133** closed: the kit-lock notice carries the config_id it was raised for (`147671cb`); a re-push retires it too.
- 2026-09-24 **F52** closed: the A16.3 readout timings have one owner, mc/types.py, generated to the phone (`bc2fd113`).
- 2026-09-24 **K8** closed: a per-game `volume` (60-100, null = the venue default) in the game editor; --bench-volume still wins,
  try-outs stay 69, saved games keep it.
- 2026-09-24 **F335** closed (bench, StickS3, found and fixed the same day): a standalone HILL beacon stopped once the
  flashing PC closed the Stick's USB serial port, because the ESP32-S3's HWCDC blocks `loop()` on a TX timeout with no
  host attached. An A/B/A/B test proved it (port closed: no beacons; open: beacons; closed: none; open: beacons
  resumed) and proved the fix, `Serial.setTxTimeoutMs(0)` (`fc8c3db4`): beacons continued every 5 s with the port
  closed. Every field station was affected, since none carries a permanently attached host.

# Closed 2026-09-24: the docs DRY pass

- 2026-09-24 **F25** closed: the string it asked about is gone. The kill confirm is now two cards: MC's card reads
  "+1 ELIMINATION · … · MISSION CONTROL", and the S57 IR card reads "CONFIRMED BY THEIR GUN · MC KEEPS THE SCORE"
  (`app/src/hud/hud.js`), so an out-of-range player still sees a confirmed kill. What is left is tracked as **S57**.
- 2026-09-24 **F299** merged: the same Pixel 5 first-connect evidence and goal as F297, so its review task is
  tracked as **F297**.
- 2026-09-24 **F326** fixed (chaos testing, found and closed the same day): an MC restart in the middle of a match lost
  every fact of a player who HOT-JOINED it. `_match_snapshot` keeps a node's binding only for a player in
  `_match_players`, and a late joiner was never added there. `add_player` now adds them. Regression scenario
  `restart-after-hot-join` (`mcp/brx_mcp/chaos/scenarios/regressions.py`).
- 2026-09-24 **F327** fixed (chaos testing): a SECOND MC restart lost the facts of any phone that had not said hello
  since the first, because each snapshot kept only the bindings of connected nodes. `Session._match_nodes` now keeps
  every node that spoke for a player in the match. Regression scenario `restart-twice-while-offline`.
- 2026-09-24 **F328** fixed (chaos testing): the frag cap's re-derivation (`_replay`) bound the stored facts through the
  nodes connected NOW, so a phone offline since an MC restart lost its kills from the recap when the cap was reached,
  and the cap could move to the wrong kill. `_replay` now binds through `_match_nodes` too. Regression scenario
  `cap-after-restart-offline-node`.
- 2026-09-24 **F329** fixed (chaos testing, `mc_crash`): an MC CRASH within the 2 s snapshot debounce of a hot join
  (or of a phone binding in the middle of a match) resumed without that binding, and the player's stored facts scored
  for nobody. A bind or an added player while a match is in play now writes the snapshot at once.
- 2026-09-24 **F334** fixed (bench, Pixel 5 on the factory WebView 83): the app floor is now Android System WebView
  111 and iOS 16.2, set by what the CSS uses (`color-mix()` meter fills; `inset`, flex `gap`). Capacitor's own
  `minWebViewVersion` check shows `webview-too-old.html` below it, with a Play Store button. Tony verified the page, the
  link and the normal HUD after the update. `d373c1ae`.
- 2026-09-24 **K4** closed (bench, Tactix-FE30 vs Tactix-9498, both on the shipped melee frames): melee WORKS in our
  compiled game on v4.32. A swing (`$BMAP,8,4` or `,8,7`) gives `$BUT,8` plus an isolated `$ALCD` at that slot, and
  a swing landed on the victim's headset gave `$HIR,4,13,5,1,90,0,1,*` twice, killing a Standard 115 pool (armour
  70 then HP 45). The `$MELEE`/`$XYZZY` control gave NO reply either, so the old `$MELEE` → `$BUT,4,0` note did
  not reproduce and was a coincidence, not a real command. An emitter A/B (the barrel covered by hand versus the
  headset domes covered) found the shot leaves the SHOOTER'S HEADSET, not the barrel: one hit with the barrel
  covered, no hit in two swings with the headset domes covered (small n; A was not BLE-connected during the A/B,
  so it is Tony's report of the swing, not a `$BUT,8` wire confirmation). Matches the `$WEAP` t1 = 1 "headset only"
  code reading. Why it failed on 2026-08-26 is unknown. Reading: melee at 90 damage kills a full Standard pool in
  two swings.
- 2026-09-24 **F330** fixed (chaos testing): a replay or MC restart credited an assist the live board never gave. After a backward clock jump, a hit from the victim's NEXT life sorted by `t` before the death. `Scorer._death` now skips a hit the victim's node sent after that death (a higher seq on the same node); with no seq, or from another node, the old t-window rule stands. clock-back-assist passes (xfail removed), crash-mixed 5023 and seven more seeds pass, plus 400 explored seeds.
- 2026-09-24 **F337** fixed (A58 station lock Lows, brx3 lane-a/lows): the lock, unlock and restart state persists across an MC restart; a lock-only same-game re-send no longer restarts a phone station's advert; an adopted match locks to the cap; a pushed game keeps its lock when the host steps back from LOBBY (UNLOCK STATIONS is on ARMORY, KIT, GAMES and LOBBY); an invalid edit that drops the push unlocks the stations.
- 2026-09-24 **F343** fixed (utility join and ITEMS Lows, brx3 lane-a/f343): ITEMS suggests each unassigned station a stable free id (draftIds: kept until another station takes it, never moved by a newcomer); a wiring test drives the real utility.js (a typed console address becomes the node URL, a sweep hit joins untrusted, never over a connect in flight). (c) stays: a typed http address maps to :8766, because a phone cannot fetch MC's http API (Android Mixed Content, F139); type the ws:// url for another --ws-port.
- 2026-09-24 **F356** fixed (chaos sweep, brx3 lane-a/f356): a late team kill stamped before the capping kill took the capping team below the frag cap. A64: after the cap fires, a team kill MC receives later is frozen out in any arrival order (the board can show the capping team one above its true net, by design); cap_recv survives an MC restart and replays honour it. Tests: test_mc_block_b, test_mc_result both orders, test_mc_resume restart; chaos frag-cap-team-kill-live passes.
- 2026-09-25 **F363** fixed (chaos, frag-cap-team-kills seed 3009): a resume ended a live match on a frag cap the live board never reached. The `t`-order replay passed the cap for a moment before a team kill took it back. `_build_scorer` now forgets a cap that the arrival-order check (`_arrival_cap_recv`) does not reach, so a real cap reached later still ends the match. Regression `resume-transient-cap` (red before the fix).
- 2026-09-25 **F362 (k), (l), part of (m)** fixed: a resume takes the lead and `next_kill_wins` from the replayed board and does not tell the field again; `frag_cap_ends_match` judges an operator or time end on the facts MC held at the end, so a late flush never re-labels it as a frag-cap win (regression `host-end-then-late-cap`, seeds 14 and 20 pass); a failed append to the enrolled list is cut back off the file (a torn line and the fsync case); `release_station` uses `_STATION_LOCK_KEYS`.
- 2026-09-25 **F346** fixed (A60 auto-join Lows, brx3): (a) a lost key is re-issued to the same per-host enrol nonce; (b) only gun-bound ids count toward the cap, and a full unbound pool refuses rather than evicts; (c) the named-dial window follows the transport's deadline; (d) Tony 2026-09-25: a never-keyed phone that sees exactly ONE MC auto-joins and enrols with no tap (3 s settle window, distinct host:port); several gets one tap; a keyed phone still needs the proof. The utility proof is bound to its MC url and never sent on a first contact. Open follow-up: the tunnel shares one rate-limit bucket (Cf-Connecting-Ip).
- 2026-09-25 **F364** fixed (Tony, brx3): MC assigns each station a unique id at ARM (the id the node holds, else the one handed to it this session, else the lowest free id; phones and Sticks share one sequence), kept across a station restart, relink and MC restart, released when the node is evicted, handed off, pruned or the roster is cleared. The console shows it read-only; an older console's explicit id is validated; a new console retries once against an older MC. A66.
- 2026-09-25 **F357** fixed (Tony, brx3): MC sends no kill confirm or medal cue for any kill it processes after the end (frag cap, host or time); a kill stamped after the end never counts and is marked AFTER WHISTLE in the feed and LIVE; a late-arriving kill stamped before the end counts with no confirm. The capping kill keeps its confirm; an adopted match past the draft cap keeps confirms.
- 2026-09-25 **F354** fixed (Tony, brx3, A65): kill credit follows the last damaging hit; when only a no-pool word (smoke, EMP) is fresh, the TEAM gets the kill (credit "team", KILLED BY <TEAM>): it counts for the team score and cap, and no player gets the K, a medal, a chain, first blood, an assist or a confirm. Own-team words, FFA and a tid off the roster credit nobody. Phone, stage and MC agree.
- 2026-09-25 **F358** answered by Tony through F365 (A67): an operator may edit a station's radius and strength on the
  station during play (a 1.5 s hold, a 5 s hold under an A58 lock), and the edit syncs to MC, last edit wins. Phone
  half `f22ebe66`, MC half `2e472dad`.
- 2026-09-25 **F351** fixed (brx4, brx5): one announcer queue on main (`2c3ebb68`, `2f21877a`), the lead change
  must-hear, and Tony's trade decision ("your death wins") built and merged from `death-wins`. The rules are in
  `docs/announcer.md`.
- 2026-09-25 **F361** decided (Tony): KILLJOY keeps the green gun flash, like every medal;
  `test_mc_awards.py::test_killjoy_keeps_its_gun_flash_like_every_medal` guards it.
- 2026-09-25 **F368** decided and built (Tony: "the brx-alerts are very thorough. ship it"): the phone HUD layering
  model, `docs/announcer.md` "Layering and priority on the phone HUD". Warnings in a bottom-centre status rail, a kill
  card that waits for a takeover; gates `layering` and `F368` in `app/tools/screens.mjs`.
- 2026-09-25 **F370** decided as shown (Tony, from the gallery): "Hill Contested" still speaks during a kill streak.
  Tony can revisit.
- 2026-09-25 **F371** decided as shown (Tony, from the gallery): the other MC alerts stay in the left FEED lane, not
  a full-width banner. Tony can revisit.

# Closed 2026-09-25: the final docs pass (the MVP split)

*FOLLOWUPS now holds open MVP work only; the post-MVP rows moved to `docs/post-mvp.md` with their ids. These rows
closed in the same pass, each checked against the code, the git log or the experiment log.*

- 2026-09-25 **B23** superseded: a hosted game's respawn station works over Bluetooth presence (the phone and Stick
  utility stations; the 2026-09-24 field log has `respawn{station:2}`, F344). The IR station-word rungs (levers §16
  step 6.3, §17) stay in the levers sheet as research.
- 2026-09-25 **F352** fixed: Tony picked the three-lane HUD alerts, merged in `ea678b6a`.
- 2026-09-25 **S46** superseded by **S58**: the heavies are powerup pickups.
- 2026-09-25 **F233** superseded by **S58**: bench 3.3 (2026-09-24) found that a slot button fires its own slot, so a
  pickup goes straight onto the trigger and SELECT toggles it.
- 2026-09-25 **S56** built (A52 and `deathscreen.js`); its field check and Lows continue as **F313**.
- 2026-09-25 **F123** built 2026-09-12 and code-confirmed: `policy.py` refuses Easy Reload on a chain-reload primary
  (`test_mc_loadout.py`), and the reload bar follows the gun's `$ALCD`. Its bench gate was never logged. The chain
  reload itself continues as **F128**.
- 2026-09-25 **F113** built 2026-09-12 and code-confirmed: `engine.js _gunBlankOnDeath` blanks the gun strip at death
  (`engine.test.mjs`, the two F113 tests). Its bench gate was never logged.
- 2026-09-25 **F183** confirmed by the 2026-09-17 verification bench (two guns through Mission Control, after the
  addressed START fan-out): the trigger stayed dead until T-0 and both guns went live.
- 2026-09-25 **S29** superseded by the shipped Shields preset; the recharge feel continues as **F349**, the shield
  hum as **F347** and the shield-hit sound as **F350**.
- 2026-09-25 **F43** a method rule, not a task: sound picks by acoustic shape are untrustworthy. The rule moved to
  `docs/gotchas.md` ("Two lessons that are not tasks").
- 2026-09-25 **S8** superseded by the scan guard (`app/src/scanwatch.js`, the F237 and F342 work); the two-Pixel
  confirm continues as **F237**.
- 2026-09-25 **B30** field-proven 2026-09-12 (backhaul, A28). Only the optional named tunnel was left, and it is not
  planned.
- 2026-09-25 **F40** a lesson, not a task: "absence reports as health". Every listed instance is fixed; the rule
  moved to `docs/gotchas.md` ("Two lessons that are not tasks").
- 2026-09-25 **F369** decided (Tony): "Lets document the medals are named after the sounds they emit in game from the
  battle company product. If any dispute we are happy to rename them." The note is in `spec/modes.md` §5b, the
  `types.py` MEDALS comment and `platform/run.md`.
- 2026-09-25 **F367** decided and built (Tony): BEAT DOWN is B6, the fist and impact, and IRON MAN is I2b, the
  bevelled iron heart, in `app/src/hud/medalicons.js` (style B); `app/test/medal-icons.test.mjs` fails on either placeholder.
- 2026-09-25 **F366** decided and built (Tony: "366 sounds good", brx3): a gamertag is at most 16 characters (`MAX_TAG_LEN`), and MC refuses a longer one with a 400 instead of cutting it at 24. From 13 to 16 (`SOFT_TAG_LEN` 12) the ARMORY claim and the KIT add and rename fields warn that the phone HUD may shorten it. Both numbers are in the generated contract. A stored longer tag keeps working and shows the refusal on its rename field. **→ 2026-09-25, the HUD rename note is built**: the pre-game/lobby/kit screen nudges a player past `MAX_TAG_LEN` ("YOUR TAG IS OVER 16 LETTERS · ASK THE HOST TO SHORTEN IT"), never in a match — `app/src/hud/hud.js` (`tagTooLong`, `_lobby`), `app/test/gamertag-length.test.mjs`, `app/tools/screens.mjs` "F366 lobby-long-tag"/"F366 live-long-tag".
- 2026-09-25 **D5** decided (Tony): the Deagle stays; Extended Mags +50% on pistols, x2 elsewhere (`66ddadb8`).
- 2026-09-25 **F164** fixed (brx2): a reconcile re-arms each slot to the live counts snapshotted at `_beginReconcile`
  (the spawn row only for a slot never counted this life), the counts survive an app restart, and the disarm echo
  books no shots. Rounds fired while the link was down still come back (a bounded refund). Three F164 tests in
  `engine.test.mjs`; `docs/spec/node.md` updated.
- 2026-09-25 **F161** already fixed by the F258 picker rewrite (2026-09-18): a gun that appears while the list is open
  gets its row at the next paint. `app/test/gunpicker-live.test.mjs` guards it on the real `_idle()` markup.
- 2026-09-25 **F319** built (`3ba7fb23`, `d79a268e`, polish `d1a6763f`, `cb16c008`): the infected alert reaches survivors only; the extraction alert is silent; the event feed survives an MC restart; MC setup says what each hill source announces; the recap carries `played_s` and `lan.public.was_up` latches. (c) and (f) needed no build.
- 2026-09-25 **F341** closed: bench sitting A, screamers A4, PASSES 3/3 (garbled-then-reset `$AMMO` reads correct;
  no reset gives a `$ALCD` BAD FRAME), so the `$*` fix may ship. All four F341 pool-repair lines PASS 3/3 on
  `bench-2026-09-24.md` Block 2 step 6 (the field shape reproduces on line 2, the reset fixes it on line 3, and the
  node's repair on a 4545/7070 gun holds through one rig hit on line 4). See `experiment-log/2026-09.md`'s
  2026-09-25 bench entry.
- 2026-09-25 **F347** closed at the desk (brx5): sitting A showed `$PLAYX,0` does not stop the A10 t23 hum, and t23 EMPTY
  plays no hum. Every `$PSET` now ships t23 empty and the hum model is gone. The in-game A/B/A is a sitting C step.
- 2026-09-25 **F350** closed at the desk (brx5): the shield-hit sound (`$PSET` t19) is H21, not H22. H22 rattled on
  4-6 of 10 rig hits, H21 on 0 of 10. The in-play check is sitting C step 11.1 (c).
- 2026-09-25 **F378** closed at the desk (brx5, with F347): the gun simulator models the burst drop, no write carries
  two `$PLAY` frames, and `$PLAY` writes are `PLAY_GAP_MS` (150 ms, UNPROVEN) apart. Sitting C's spacing check proves
  or moves the gap.
- 2026-09-25 **F332** closed: sitting B's physical side-button test PASSES A/B/A (unlocked single-click restarts
  boot 51→53; locked single- and double-click do nothing; A+B held 7 s restarts a locked Stick, boot 54; unlocked
  restores after relink, boot 55). A separate edge-case bug, a stuck-at-JOINING-WI-FI state where an unlocked click
  did not restart, is filed as F392.
- 2026-09-25 **H9** closed: sitting B proved the Stick's Bluetooth hill and pickup against real phones, not only
  the simulated-player parity: 3(a)/(b)/(c) capture, contest and drain with the presence RSSI logged; step 4's
  restart-survival; the 2(a)/2(b) online and offline pickup claims. The hill threshold value itself stays open as
  F383.
- 2026-09-25 **F401** built (brx3): a station counts as synced once MC hears it after the whistle; RECAP lists each unsynced station (NEEDS SYNC: BRING IT INTO WI-FI) and LOAD warns that loading loses its result, until the next game byte resets it. The list survives an MC restart. No new Stick message.
