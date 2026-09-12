# Closed followups (archive)

Moved out of `docs/FOLLOWUPS.md` on 2026-09-06. **Not maintained; grep it, do not read it.** Each block is
verbatim, headed by the id, its close date and the line range it occupied in `FOLLOWUPS.md` at the time of the
move. A block's *internal* statuses were true when it closed and may since have been superseded (the living
files win: `docs/manual/`, `docs/spec/contracts.md`, `protocol/brx-protocol.md`, `docs/FOLLOWUPS.md`).
Ordered by close date. Evidence for every claim is in `docs/experiment-log/`.

---

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
