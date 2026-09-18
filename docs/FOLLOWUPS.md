# Followups — open work only

Updated: 2026-09-18. **Everything in this file is open.** Closed items are in
[`archive/followups-closed.md`](archive/followups-closed.md), verbatim and ordered by close date; the evidence
behind every row is in [`experiment-log/`](experiment-log/) (grep the id or the date). Session close = strike or
add rows here, one experiment-log entry, one HANDOFF banner. A fact goes to `protocol/` or `docs/manual/` in the
same commit, or it gets a row here saying "promote X".

**Ids.** One capital letter + number. Never renumbered, never reused. **CLAIM AN ID BY WRITING ITS ROW FIRST, before doing the work** -- a stub row and the bumped "next free" below, committed, then the investigation. Ids collided FOUR times on 2026-09-18 alone and every one was two sessions reading "next free" at the same moment and both working for an hour before either wrote anything down. The loser renumbers, which is tedious and loses cross-references. This is a process fault, not anyone's mistake. **Next free: B32 · D6 · E8 · F278 · G11 · H9 ·
K9 · P19 · Q20 · R4 · S56.** (2026-09-18 evening, the drive integration: **F269-F274** taken. F269-F273 are the transport-hardening measures of `spec/transport-hardening.md` §8, and F274 is the recoil writer's write budget. They skip F261-F268, which the fix/playtest-2026-09-13 branch uses. F255-F259 are that branch's rows, closed and archived there. F206 root-caused and its fix shipped, row kept open for the bench.) (2026-09-18: **F260** taken: the two-word weapons double-count HITS in the recap. F255-F259 belong to the fix/playtest-2026-09-13 branch. **F254** taken: at what `t13` value does the headset word (t12) stop
arriving; filed alongside the t12/t13/t42 balance change; **renumbered F275** by the 2026-09-18 merge, see below.) ⚠ **F254 collided**: this branch filed F254 for the eleven-row `$SIR` table and closed it on the 2026-09-18 bench, while main filed its own F254 for the headset word's reach. **The archived row keeps the id**, because `archive/followups-closed.md` is immutable history and a closed id must stay citable; **main's open row is renumbered F275**, the same rule that settled the F253 collision the same day. Its references moved with it in `docs/weapon-design.md`, `mcp/brx_mcp/mc/compile.py` and `mcp/tests/test_mc_compile.py`; the `experiment-log` entry keeps F254 because the log is history too.
(2026-09-17 merge of the brx-weapons arsenal rework: this branch's thirteen
verification rows moved from F230-F242 to **F235-F247**, because main had already taken F230-F234. **F248** taken for the merge's one visible consequence, and **F249** for the `connect()` alias bug that F234 had carried as a second item. **F248 closed** the same night; **F250** taken for the night skin's missing pip gauge, and **F251-F252** from the DRY review. **F253** taken and **B25 closed** by the polish review; **F254** by the 2026-09-18 merge review; **F256-F259**, **F261** and **F262** from the 2026-09-18 bench, and F260 left to main, which took it for the accuracy over-report. **F263-F266** from the same bench: the two-word weapon measurement, the dead-gun desync, the frozen scoreboard, and the slow-link echo. **F267-F268** and **S54** from the F259 second step: the unanswered press, the ladder's two judgements, and the catalogue fields that are still unwired. (2026-09-18 night: the six ids after F268 belong to the brx-ltm session by agreement, so this branch takes F275 upward.) ⚠ **F253 collided**: main filed and closed its own F253 (the stun cell shipping fn 24) on 2026-09-18 while this branch was carrying F253 for the reserve question. Main's is the one that keeps the id, because it is closed and archived; **this branch's reserve row is renumbered F255** and closed the same day, because the bench answered it. **S53** is main's (the smoke tell on the HUD), and this branch owns it.)
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
**Blocked on:** `trigger` · `eyes` · `ears` · `space` · `grenade` · `capture` · `decision` · `build`.
**Status:** 🔴 blocking or high value · 🟠 next · 🟡 useful · 🟢 low.

## 0. Where to look

| You want | Go to |
|---|---|
| **The bench running order** (setup blocks, exact command, reading, control per rung) | [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md). §9 below is the REGISTER: ids live here, order lives there |
| **The grenade / hill rungs** | [`bench-grenade.md`](bench-grenade.md) §"Still to run" |
| **Open BUILD items** (no hardware needed) | §2 extensibility · §3 build · §7 September build items · the `build`-tagged rows in §6 |
| **Open DECISIONS** (keyboard, Tony's call) | §9 "Decisions", and the seven-item list in [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) §"Decisions" |
| **What closed today** | [`archive/followups-closed.md`](archive/followups-closed.md), newest last |
| **Why a fact is believed** | [`experiment-log/`](experiment-log/) — grep the id or the date |

**🔴 blocking, at a glance (2026-09-18):** the 🔴 ids in the lane lists below. *(**F208** closed and **F209**
dropped to 🟡 on 2026-09-18, in the desk pass after the playtest merge: A45 flags a stale pool, A47 gives the
operator RESYNC GUN and FORCE RESPAWN (F235), and A44 spawn protection is confirmed on hardware (F217). What is left
of F208 is in **F272** and **F264**; what is left of F209 is **F223**.)*
*(**F206** and **F207** left this list on 2026-09-16: F206 was `$TID` resetting to 0 on every `$PSET` write,
fixed by resending `$TID` after the last `$PSET` of any write; F207 was the START echo check comparing the
gun's reserve against the wrong `$WEAP` token. Both fixed and bench-confirmed through Mission Control; see
`archive/followups-closed.md`. ⚠ Main's own F206 fix (`d0f4c729`: the team in every `$PSET`, and `$TID` after
`$SPAWN`) is a different fix, now merged beside it. Do not call it proven until
`bench-firmware-levers-2026-09-19.md` §1 run f has run on the merged code.)*
*Earlier (2026-09-11):* **F68** a miss permanently kills the headset team colour (built 2026-09-17, now 🟡) ·
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
**Re-sorted 2026-09-18 (the FOLLOWUPS accuracy audit) from every row's priority and tag; an untagged row is placed by what it needs.** ⚠ **This index has no guard.** It is the `tag` at the end of each row, re-sorted by hand
(`grep -n '\`bench\`' docs/FOLLOWUPS.md` and friends rebuild it); **if it disagrees with a row, the ROW is
right** and this index is stale. Do not cite it as evidence that something is or is not open.

**Needs Tony at the bench** (tagged `trigger` · `bench` · `ears` · `eyes` · `space` · `grenade` · `capture` ·
`hardware` — running order in [`bench-plan.md`](bench-plan.md)):
- 🔴 **B26** · **F198** · **F231** · **F232** · **F257** · **F261** · **F275** · **F276** · **K4** · **Q15** · **S10**
- 🟠 **B31** · **F50** · **F59** · **F152** · **F158** · **F162** · **F171** · **F183** · **F219** · **F226** · **F230** · **F237** · **F269** · **F271** · **F272** · **F274** · **G9** · **P8** · **Q16** · **S9** · **S33**
- 🟡 **B28** · **B29** · **B30** · **D1** · **D4** · **F3** · **F13** · **F21** · **F26** · **F27** · **F28** · **F30** · **F39** · **F63** · **F65** · **F66** · **F67** · **F68** · **F75** · **F76** · **F82** · **F88** · **F128** · **F131** · **F167** · **F168** · **F169** · **F195** · **F214** · **F216** · **F227** · **F229** · **F233** · **F262** · **F267** · **F268** · **F270** · **G3** · **G10** · **H7** · **H8** · **K1** · **P3** · **P15** · **S1** · **S2** · **S7** · **S-A12** · **S36** · **S49** · **U11′**
- 🟢 **B20** · **F29** · **F87** · **F99** · **F111** · **F114** · **F120** · **F250** · **F273** · **G4** · **P4** · **P12** · **S8** (F65 rose to 🟡 on 2026-09-18, F270 filed 🟡)

**Keyboard only** (tagged `build` or `decision` — no gun, no rig, no dim room):
- 🔴 **B23** · **E5** · **F43** · **F231** · **F257** · **F261** · **F264** · **F265** · **S10**
- 🟠 **B4** · **B21** · **B31** · **E2** · **F12** · **F40** · **F70** · **F164** · **F182** · **F196** · **F203** · **F256** · **F260** · **F269** · **F271** · **F272** · **F274** · **P8** · **S3** · **S14** · **S16** · **S33** · **S50** · **S52** · **S53**
- 🟡 **B1** · **B8** · **B14** · **B17** · **B18b** · **D1** · **D3** · **E3** · **E4** · **E6** · **F5** · **F16** · **F20** · **F24** · **F25** · **F42** · **F60** · **F68** · **F88** · **F95** · **F108** · **F109** · **F112** · **F113** · **F121** · **F123** · **F126** · **F128** · **F130** · **F132** · **F133** · **F161** · **F172** · **F173** · **F174** · **F175** · **F176** · **F177** · **F178** · **F179** · **F180** · **F181** · **F184** · **F185** · **F186** · **F187** · **F188** · **F189** · **F190** · **F191** · **F192** · **F193** · **F202** · **F209** · **F220** · **F221** · **F223** · **F229** · **F233** · **F249** · **F251** · **F266** · **F267** · **F270** · **H1** · **H2** · **H6** · **H8** · **K2** · **Q12′** · **Q13** · **R3** · **S1** · **S2** · **S6** · **S7** · **S-A12** · **S13** · **S25** · **S27** · **S28** · **S29** · **S30** · **S31** · **S32** · **S34** · **S35** · **S36** · **S42** · **S43** · **S46** · **S47** · **S48** · **S49** · **S51** · **S54**
- 🟢 **B11** · **B22** · ⬜ **D5** · **E7** · **F14** · **F17** · **F18** · **F19** · **F32** · **F52** · **F83** · **F87** · **F89** · **F93** · **F98** · **F99** · **F100** · **F107** · **F204** · **F224** · **F250** · **F252** · **F273** · ⬜ **H3** · ⬜ **H4** · ⬜ **H5** · ⬜ **K6** · ⬜ **K8** · **P14** · **R2** · **S19**

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
- **B8 🟡** grenade STATE app: a live Hill/Respawn display from the passthrough row (`$SIR,15,0,,28`, fn 28 since 2026-09-10, + FF on → `$HIR,0,15,…`).
  Objective modes are button-locked on the grenade (G8), so this is display only. `build`.
- **B26 🔴 Needs Tony at the bench** does a gun with NO headset fire in local (on-gun) play? `dev.md` says yes,
  citing Battle Company's V7 manual. `fix.md`'s ladder step 1, `hardware.md` and `operate.md` all say a gun whose
  headset is off, unpaired or flat refuses to join or fire at all, citing operators. Both are load-bearing and
  they cannot both be right. One gun, headset removed, try a local game. `trigger`.
  → 2026-09-12: the manual no longer publishes the contradiction; `manual/fix.md` "Won't fire" step 1 is the line to update when this closes.
- **B28 🟡** do guns talk gun-to-gun in phoneless games? `sound.md` and `gameplay.md` explain phoneless multikill
  lines as the guns sorting it out "over their radio mesh"; `dev.md` says flatly "nothing propagates gun-to-gun".
  The dev sentence is scoped to what a BLE host can observe. Either the mesh claim needs evidence or the dev
  sentence needs its scope written in. **→ 2026-09-18:** `bench-firmware-levers-2026-09-19.md` §13 steps 1-2
  (listen for `$DD`, then a passive IR capture at a death) answer part of it. `capture`.
- **B29 🟡** voice pack: 16 slots or 17? `sound.md` gives a 17-row slot table confirmed on hardware 2026-09-07;
  `dev.md` says sixteen ids on the wire with the slot mapping unknown, and its own sample frame carries 16.
  17 declared field names against 16 wire ids is a real gap, not a typo. **→ 2026-09-18:** V4_30 reads 17 sound
  ids in `$PSET` t7-t23; `bench-firmware-levers-2026-09-19.md` §19 step 10 checks the slot alignment. `capture`.
- **B11 🟢** "Open BRX connected/disconnected" voice: ids are VA99 / VA9A; back up, convert, USB-load. `build`.
- **B14 🟡** voice-pack selection: every character voice uses one 22-slot layout (sound catalog), so the per-character
  map is now derivable without P3. `build`.
- **B17 🟡** tutorial mode (`TutorialEngine`, audio-guided, event-gated). `build`.
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
  same-team beacon. **Bench leads (2026-09-18):** `bench-firmware-levers-2026-09-19.md` §6 (`$LIFE` set mode as a revive),
  §10 (fn 34/35 on a dead gun) and §16 (the revive beam). `build`.
- **B30 🟡** BACKHAUL (contracts A28) — **FIELD-PROVEN 2026-09-12** (WSL host, cloudflared quick tunnel, Pixel 10 on cellular with
  Wi-Fi off, Pixel 4 on home Wi-Fi): join, kills scored, KILL CONFIRMED on the shooter's HUD, result to both HUDs, logs pulled,
  stranger hellos refused 4004, coverage FULL 2/2 derived, store-and-forward across a real data loss (flushed exactly once).
  Needed one fix first (F136, bind loopback). Left: the manual `--public-url` / named-tunnel path (Tony, later); the field
  findings are their own rows (F140 F142 F144 F146 F153 F155 F156 F157, S40, D5 — all but D5 closed by PR #4 and
  the 2026-09-12 integration, see `archive/followups-closed.md`). `capture`.
- **B31 🟠** KILL CONFIRM OVER THE BLE ADVERT (Tony 2026-09-12): the victim's player advert (utility.md §2) already
  carries alive + seq and has three spare bytes (11 value, 14 threshold, 15 reserved); the victim's node already
  latches the shooter's player_num from its last `$HIR`. Put `killed_by` in the value byte while the alive bit is
  off (it stays up for the whole respawn delay), have player phones read player adverts (only utility phones do
  today), and a dead player in my game whose value byte is my number, deduped per (victim, seq), fires KILL
  CONFIRMED locally (A11.4 HUD-driven event, class "peer-witnessed") with no LAN, backhaul or MC. Range = BLE
  advert range (~10-30 m outdoors at medium TX). **Presentation only:** adverts are unauthenticated (utility.md
  §2 posture), so the confirm never scores; the kill still enters the board from the victim's own report and the
  recap stays victim-authoritative. Phase 2 (optional): a backhaul phone relays the death advert to MC as a
  PROVISIONAL kill, reconciled against the victim's event on flush. Cost: one byte definition in utility.md §2,
  a player-advert consumer + dedupe set in `app.js`/`engine.js`, one engine event reusing the KILL CONFIRMED
  moment, one line in contracts A11.4. Hardware caveats: iOS advertises the service UUID cleanly only in the
  foreground (play already requires it); Android scan starvation (the 7 s restart already fights it). Complements
  B30, not part of it. **→ 2026-09-18:** first find how a stock game confirms a kill: `bench-firmware-levers-2026-09-19.md` §13
  (the discovery phase, commit 707da59b; step 1 listens for `$DD`). `build` · `capture`.

## 4. Hardware, prints, research (H, R)

- **H1 🟡** reload-handle → push-button STL (version-tag it; older/newer handles differ). **H2 🟡** D-pad buttons STL.
  **H3 ⬜** Companion mount + ported audio box (with B1). **H4 ⬜** station enclosure (with B4). **H5 ⬜** skins.
  **H6 🟡** curated MIT sound pack + load guide (data-port swap, `community-notes.md`). All blocked on Tony's caliper
  measurements (reload socket, D-pad, rail). `hardware/print-files.md`.
- **H7 🟡** M5StickS3 station: station hardware on order (quantities and date live in `hardware/inventory.md`, not here);
  firmware `hardware/m5sticks3/`. Gates: (1) a `proto=15 mag=8` grenade beacon decoded on G42 over RMT with the speaker
  amp off; (2) a HUD phone sees the Stick's kind-5 advert carrying that owner; (3) Grove-emitter range walk against the
  bare-LED cliff (8 to 10 ft). Ring + power bank are planned, not ordered. `hardware`.
- **H8 🟡 THE STICK TAKES ITS KIND FROM MISSION CONTROL OVER WI-FI, THEN IS PLACED IN THE FIELD.** Tony,
  2026-09-14: set it at MC during setup, carry it out, prop it. Specified in `spec/utility.md` **§5g**. ⭐ The
  finding that sizes this: **the wire needs no amendment** — `envelope.py` checks only that a `hello` CARRIES
  `node_type`, `state.py set_station()` gates on the one string `"utility"`, and `NodeView.platform` is free
  text, so an ESP32 that speaks the envelope is a utility node today and `station_config` (A13.5, F104) reaches
  it unchanged. Work is all Stick-side: a WS client of four kinds (`hello` · `welcome` · `station_config` ·
  `status` at 2 s), `WIFI`/`MC` serial commands plus mDNS `_openbrx._tcp` (a Stick cannot scan MC's QR, so the
  typed floor is not optional), and **two Wi-Fi association modes** (§5g.4, Tony 2026-09-14): `muster`
  (default, drop the link for the match) and **`held`** (stay linked all game) — `held` is what makes **F95**
  roaming hills possible on a Stick, so the client must never treat "match started" as "MC unreachable"
  (§5g.8 lists what not to preclude: hot = advert byte 10 value **16**, accept `station_config` in any phase
  without resetting the point, 15 s grace then degrade, never self-promote). ⚠ `held` puts the Wi-Fi/BLE
  coexistence jitter **on the critical path** instead of avoiding it, and almost certainly needs the power
  bank; both that jitter and the battery delta are asserted, never measured. Arm it **respawn** or **control**
  first: those are the only two kinds whose player side is built (K2/K3/K4 are not). Carries one `decision`:
  `STATION_SOURCES` has no value for a Stick (§5g.7). Blocked behind H7 — no Stick has been powered on.
  `build` · `hardware`.
- **R2 🟢** software `DUTY <0-255>` (and `PULSES`) command on the IR emitter, echoing its own duty; re-run the fn 1
  control at every duty before trusting a result. A nicety again since the emitter was fixed (2026-09-03). `build`.

- **R3 🟡 IS JAY (EXTREME LASER TAG) THE SAME PROJECT AS LASERTAGMODS?** `reference/jay-ecosystem.md` presented JBOX/JCUBE/JBOX Mini/JTOWER/JHALO/JEDGE as his devices; `reference/lasertagmods.md` and CLAUDE.md credit JEDGE and JBOX to LaserTagMods. Two sources disagree, so the ownership claim was withdrawn 2026-09-12. Settle it (channel about page vs GitHub org commit authorship); it decides the public credit line. **→ 2026-09-18:** the drive Jay shared holds the JEDGE, JBOX and JHALO sources, and `reference/lasertagmods.md` already cites "Jay's JEDGE 6.0 source". **Decision for Tony:** ask Jay for the credit line he wants, then fix the warning in `reference/jay-ecosystem.md`. `research` + `decision`.

## 5. Tony's asks (K)

- **K1 🟡** kid auto-reload: `alt_reload` ships. The other mechanism, `$WEAP` t19 = 5 (AutoReload), does not reload an
  empty magazine by itself (2026-08-27); only the fire-triggered case is untested. Pick by feel. **→ 2026-09-18:** BC's sheet names t19 = 6 "no reload" and 10 "bottomless": `bench-firmware-levers-2026-09-19.md`
  §19 step 7. `trigger` (bench 1.4).
- **K2 🟡** perk on ALT-fire: the ALT button cycles slots (`$BMAP,1,100,0,1,99,99`), so it is a slot-loading question;
  `$BUT` AltFire is the host-side path for arbitrary perks. `build`.
- **K4 🔴** melee does not work in our compiled game while our frames are byte-identical to Callsign's (`$WEAP,4`, three
  `$SIR,13,*` rows, `$GSET` gyroscope=1, `$BMAP,8,4`). One swing: select slot 4, watch `$BUT,8` and `$HIR,…,13`. **→ 2026-09-18, a lead:** BC's own weapon sheet names `$WEAP` t1 `WeaponIRSource` and every stock melee ships 1 = headset only. The V4_31 fire path confirms it: with t1 = 1 the swing leaves as an `$IRTX` frame to the HEADSET at range t2/t41 (t13/t42 are read only for t1 = 2 or 3, so the empty t13/t42 on our row is NOT the fault; the catalogue is unchanged). So K4 is either the swing detection (`$GSET` t5 = 1, `$BMAP,8,4`, started, live, un-stunned) or the headset emitter path (the range token is a carrier frequency, and the melee row's t2 = 90 is 36.75 kHz). The V4_30 image has no `$MELEE` handler (the `$BUT,4,0` reply may be a coincidence) and `$FIREX,4,*` fires a slot with no swing, which is the control that separates the emitter from the gyro; a receiver control must face the headset domes, not the barrel. `bench-firmware-levers-2026-09-19.md` §2. `trigger` (bench 1.1).
- **K6 ⬜** per-game weapon tuning (damage / fire sound / rate inside a saved game); `SavedGame.weapon_tuning` is
  reserved in `spec/loadout.md` §8. Needs its own spec. `build`.

- **K8 ⬜** A volume control at MC (Tony, field 2026-09-12): play volume comes only from the venue (80 indoors / 90 outdoors, try-outs 69) with no operator override; add a bounded per-game knob in the config + Kit, still defaulting from the venue. `build`.
## 6. Field bugs, protocol gaps, questions (F, Q, D)

**The 2026-09-18 drive integration (LaserTagMods' firmware images, ESP32 sources, BC's sheets and 2018 app; branch
`jay-drive-integration`). The design of record is [`spec/transport-hardening.md`](spec/transport-hardening.md); each row
names the bench step that settles it, in [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md) or
[`bench-firmware-levers-2026-09-19.md`](bench-firmware-levers-2026-09-19.md).**

- **F269 🟠 ARM PACING: A BLOCK PAUSE, AND THE RUNT `$SIR` ROWS.** The gun reads ONE serial byte per main-loop pass from a 1 KB buffer, and a lost `*` corrupts the NEXT frame (V4_30/V4_31). An arm is 43 frames / 1012 B / 75 packets; 13-14 of its fn-28 registrar rows are 21-22 bytes, a full packet plus a 1-2 byte runt, the packet most exposed to a loss. `brxlink.WRITE_PACING` now holds the field pacing (8 ms per chunk, 18 ms per frame) and a block pause that ships OFF (`blockFrames = 0`); turning it on is one line. Do not move it on a reading: screamers sheet A8 (200 `$WEAP` frames that alternate the magazine size, count the frames that did not apply) and A7 (bursts with and without a pause) give the number, and A8b (one gun, armed alternately with the trailing empty token trimmed off the registrar rows and with the full row, 50 arms each, counting BAD FRAME) says whether the runt can go (`$SIR` is positional; F11 makes this a real risk). `transport-hardening.md` §3. `bench` + `build`.
- **F270 🟡 WRITE WITH RESPONSE FOR MULTI-PACKET FRAMES.** Every write is `writeWithoutResponse`, so a lost packet is invisible. Jay's ESP32 and the 2018 BC app both wrote every chunk with response. Cost: an arm goes from about 1.2 s to about 2.5 s. Worth it only if screamers A8 shows frames going missing; then one line in `brxlink.write` and `ble._write`, head and spawn only. `transport-hardening.md` §5. `bench` + `build`.
- **F271 🟠 `$QUERY` READ-BACK AFTER ARMING.** The V4_30 `$QUERY` reply starts `<playerId>,<team>,<hpMax>,<armourMax>,<shieldMax>`. One `$QUERY,*` after the head echo, parsed into `ack_config` beside `gun_echo`, lets MC compare the gun's TEAM against the pushed `$TID` and refuse `start` on a mismatch: the check that would have caught F206 on every gun at the lobby. Needs claim 19 (§18) first: the token map is a firmware reading, and the 2026-08 capture proves only the shape. `transport-hardening.md` §6. **Folded in from F80 and B19 (2026-09-18):** also refuse a gun whose `$QUERY` player id reads 0: a gun whose `$PSET` never landed fires as wire id 0 and scores nothing (F80; the recap already counts wire-id-0 hits). B19's wider diff belongs here too: the read-back also covers HP/armour/shield, voice, and per-slot damage and fire sound; replies arrive seconds late, so poll until stable; `$SIR` and `$BMAP` cannot be read back. `bench` + `build`.
- **F272 🟠 THE LOCK-UP DETECTOR: SILENCE PLUS NO `$PONG` MEANS POWER-CYCLE.** A screamer answers nothing and its BLE link may stay up (the radio is a separate chip), so "connected" proves nothing and F208's gun sat byte-identical for 105 s. Design: while LIVE and alive, after `GUN_SILENT_MS` (about 8 s, needs the idle `$VOLTS` cadence confirmed) send one `$PING`; no `$PONG` after two pings 3 s apart = `gun_locked`: a HUD takeover that tells the player to hold power 3 s and power on, `status.gun_locked` for the board, and a relink that marks the player down and revives on the normal timer instead of keeping stale pools. Replaces the disabled B4 watchdog reading (F163). The HUD half belongs to the `brx-hud` session. Screamers sheet A13 and A1 (does the link stay up on a hang?). `transport-hardening.md` §7. **Folded in from F163 (2026-09-18):** the B4 link watchdog still ships disabled (`engine.js` `LINK_WATCHDOG_ENABLED = false`, 150 s), because a false trip re-arms from `frames.spawn`'s `$AMMO` and hands out a free magazine. Its three questions are this detector's bench: does the `$PHONE,*` tap survive a real drop, is the silence threshold right against the real `$VOLTS` gaps, and does `noteStale()` recover a stale native stack on Android and iOS. **Folded in from F208 (2026-09-18):** the HUD does not render `pool_stale` yet (brx-hud), and a probe on `no_fire` (`$QUERY,*`, or a bare `$LIFE,*`: `bench-firmware-levers-2026-09-19.md` §22 step 4, moved there from §19 step 13) is unbenched. `build` + `bench`.
- **F273 🟢 SHOULD `$PB*` AND `$AS` JOIN THE DENY LIST?** Four of the six blocking audio waits sit in the gun's own game paths (the mode announcement, game-over audio, two channel-4 waits), which `$PBSTART`/`$AS,1` enter. They stay on the known list (bench tools use them; no compiled bundle carries them). Screamers A1-A3 test only
`$DPLAY`; a `$PB*`/`$AS` hang test needs its own step, not yet in the screamers sheet (it could start a native
game, so it needs care: see levers §19 step 17's warning). If a future step shows a `$PB*` start can hang a gun,
they move to `protocol.DENIED_COMMANDS`. `bench` + `decision`.
- **F277 🟠 A RELOAD THAT NEVER COMPLETES STRANDS THE PLAYER, AND NOTHING WILL EVER NOTICE.** Filed 2026-09-18 from the F264 log scan. Of the two proven stalls that night, the first is cured (F264: three unanswered pulls, the node asks, the reply books the death). **The second cannot be**: the gun froze at `ammo 0 / shots 714` with the player ALIVE, 45 s after `reload partial: 0 -> 12 of 32 (timeout)`, and it took an operator force respawn 50 s later. It never reaches `no_fire`, and correctly so: `_awaitShot` routes a pull into `_dryPull()` whenever the account says the magazine is empty (`app/src/engine.js`), so an empty gun can never raise the stale-pool flag. That is the right guard and it is why this variant is invisible. **The detector this needs is its own**: a reload the node STARTED that never reported completion, with the magazine still short and the reserve above zero, for longer than the weapon's own reload time by some margin. The node already tracks `reloading` and has the per-weapon `reload_ms`, so the ingredients exist. ⚠ **Do not widen `no_fire` to catch it.** An empty magazine is the overwhelmingly common reason a trigger produces no round, and a detector that fires on it would cry wolf every match. **Cure, once detected:** the same question F264 asks, `$QUERY`, and the reply's `$LCD` corrects the magazine with no write at all, which is exactly the branch that already exists. Only escalate if the gun answers nothing. Needs a bench repro first: nobody has reproduced a timed-out partial reload on purpose. `build` + `bench`.
- **F274 🟠 THE RECOIL WRITER INSIDE THE PER-GUN WRITE BUDGET, SOAK-PROVEN.** Tony 2026-09-18 kept S42 live accuracy (the cut was reversed the same day). The recoil writer is the biggest load in a match: each change of live accuracy re-sends the active slot's `$WEAP` (about 101 B, 6 packets) plus an `$AMMO` restore, and today's writer can do that every 250 ms under sustained fire (`ACC_WRITE_MIN_GAP_MS`, `app/src/engine.js`). The rebuilt writer (the `brx-latest-playtest` session, PR to main pending) writes on a state change only: at most three per burst (crisp to degraded, degraded to heavy, crisp again 600 ms after release). Its worst case is oscillation, about 150 pairs a minute. Requirement (`spec/transport-hardening.md` §2): the writer fits the per-gun write budget and passes screamers Phase C runs 1 to 3, with `recoil-oscillate` as the worst case (`python -m brx_mcp soak <address> recoil-oscillate 120`, [`bench-screamers-2026-09-19.md`](bench-screamers-2026-09-19.md)). Keep the soak patterns (`mcp/brx_mcp/soak/patterns.py`) in step with the writer when it lands. **→ Tony 2026-09-18: "its too demanding on the br channel currently", so this is a live concern rather than a precaution.** ⚠️ **The pathological pattern is NOT sustained fire.** Holding the trigger costs three writes however long you hold, because there is nothing left to degrade to. It is tap-pause-tap: fire `after_shots` rounds, pause just past `settle_ms`, repeat, and you pay TWO writes per cycle forever. At the AR's 3 rounds, 100 ms cycle and a 600 ms settle that is a ~900 ms cycle, about **2.2 writes a second per gun, indefinitely** (the playtest lane independently measured ~2.5). Raising `settle_ms` only shifts that; 900 is the cheapest mitigation and costs no feel. **PARKED PROPOSAL, if §21 fails and we stay on `$WEAP`: recover on the RELOAD rather than on a timer**, with a long 2.5 to 3 s backstop settle for a player who disengages without reloading. A reload is a write that happens anyway, so recovery leaves the budget entirely, and tap-pause-tap collapses from a permanent drip to two writes once, because a 900 ms pause never reaches a 3 s backstop. It also reads better: a player who fired three rounds a second ago has not cooled off. ⚠️ The recovery write goes AFTER the refill completes, never on the lever pull, or it is F259 through a different door. ⚠️ **A minimum write interval is NOT the fix and must not be reached for**: `ACC_WRITE_MIN_GAP_MS` at 250 ms against rungs three rounds apart already deferred the second rung to a clock tick, which landed composed against stale counts and whose `$AMMO` handed a round back. A write that waits must not carry the counts it was composed with. **All of this may be moot:** levers sheet §21 probes `$TMP` t4, a short frame that does NOT reset the magazine, and `brx-protocol.md:307` says fn 23 sets t4 and STAMPS A RECOVERY TIMER, so the field may walk back on its own and remove the recovery write altogether. Settle §21 before building any of this. `bench` + `build`.

**Game test 2026-09-13 evening (2 players, 3 matches, both phones on APK 0.2.1). Full sheet:
[`game-test-2026-09-13.md`](game-test-2026-09-13.md).** Evidence for every row below is
`~/.brx-mcp/mc/session-3782dc77.sqlite` — it holds the compiled heads MC pushed AND six node-log uploads, so
nine of these eleven were root-caused without touching a gun.

- **F209 🟡 THE RESPAWN DELAY COLLAPSES TO ZERO IN A BURST, AND SPAWN PROTECTION DOES NOT HOLD.** "you can die and get shot before the weapon comes online during respawn" (Tony). In a game with `delay_s: 5`: **five deaths and five respawns inside one second**, every respawn at +0.0 s after its death (18:38:17 ROCCO; again 18:40:34 TONY), and outside the bursts hits land at **+1.6 s, +2.9 s, +3.0 s** after a respawn. Nothing on the death path has a refractory period, so a burst of `$HIR` is processed as N independent hit→death→respawn cycles with the delay skipped rather than queued. The post-respawn hits are the first field look at **F121/A23**'s spawn protection, whose bench gate has never been run: either it is not landing, or it ends at `$SPAWN` while the weapon needs ~2 s more (`write gun take` lands ~3 s after `respawned`). The asymmetry IS the bug: **hit reception returns before the trigger does.** Fix: one death per life until the respawn completes, and a protection window that ends when the weapon is armed. [`game-test-2026-09-13.md`](game-test-2026-09-13.md) B1. `build`, proof needs two guns. **→ 2026-09-16:** protection half BUILT (A44): spawn, revive and flip writes carry the fn-28 twin, and the node writes the live table (one `sir_pool` take) on the gun's first shot or 2100 ms after the write; death, end and a head cancel it, a rejoin reconcile always re-arms. Measured: `$BMAP,0,0` leaves ~300 ms after `$SPAWN`, the write starts 0.7-1.2 s before it. **→ 2026-09-16, burst half:** the burst is not the engine. The two phones' own logs show every death with its own 5 s respawn (ROCCO 22:36:40 to 22:37:42, TONY 22:39:15 to 22:40:33 UTC) while the MC link was down or half-open; the outbox flushed them in one batch, and `events.tsv` orders by MC's `t_recv`, not the fact's own `t`. The rule is now structural anyway: `_death` returns when already down (A45), mirrored and tested. **Still open:** read or order node facts by `t` in the extract and on the MC timeline. **Bench gate:** two guns, shoot a player in the first 2 s after respawn (`$HIR` fn 28, no pool change), fire, then the same shot lands. **→ 2026-09-17:** the operator's FORCE RESPAWN (A47) gives a manual recovery for a player stuck mid-respawn; the burst-collapse bench gate above is still open. **→ 2026-09-18:** A44 spawn protection is confirmed on hardware (F217, closed), which is the bench gate above, and the burst was an outbox flush, not the engine. What is left is **F223**: order node facts by their own `t`. Folded in from F148: field 2026-09-12, a player was hit during the HUD's REDEPLOYED screen before they could shoot, which is the case A44 answers.
- **F214 🟡 THE HEAVY BREATHING STILL FOLLOWS THE DEATH SCREAM** (Tony, 2026-09-13), after F149's fix. NEW and narrowing: the frame ring shows `$PLAYX,0,*` **is** written at death, so the stop is sent and the loop survives it. Same sound as **F114** (VA6, the male `hurt_loop` slot); sits beside **F158** (whether that `$PLAYX,0` also clips the NATIVE scream, never benched). One gun, one death, listen for the scream and then for what follows — that run answers F158 and F214 together. [`game-test-2026-09-13.md`](game-test-2026-09-13.md) E1. `ears`.
- **F216 🟡 THE HEADSET PLAYED THE DEAD/AWAITING-RESPAWN FLASH WHILE ALIVE** (Tony, 2026-09-13): "started flashing like i was dead and waiting to respawn but i was alive and fine". Not isolated in the store. The two things that make it plausible rather than mysterious are both in this session: **F209**'s burst (five death/respawn pairs in a second will leave any LED state machine behind) and **F208**'s desync. Treat it as a symptom of one of those until it reproduces alone. `eyes` — after F209 and F208.
- **F226 🟠 A CHARGE WITH FEWER ROUNDS THAN A FULL CHARGE LOCKS THE GUN.** Bench 2026-09-17: a full charge spends **10** rounds (measured 4 times; a tap spends 1). With 6 rounds left, holding a charge fired nothing, heat jumped to **156**, and two reload-lever pulls did not refill; every later charge attempt read heat 156 and fired nothing until `$AMMO` refilled the cell. From exactly 10 rounds a charge fires normally. A player reads this as a broken gun. Fix: a catalogue `rounds_per_full_charge` (10) that the one-magazine guard and the ammo sums divide by, a HUD "NOT ENOUGH ENERGY" state below 10, and a bench recheck of whether the reload is refused or only delayed by the lockout. **→ 2026-09-18:** `rounds_per_charge` 10 ships (`weapons.json`), and the HUD energy state is closed (F238). Left: the bench recheck of the reload. `trigger`.
- **F227 🟡 THE HEADSET FLASHES YELLOW UNDER SUSTAINED FIRE, AND NOTHING SAYS SO OVER BLE.** Bench 2026-09-17 (Tony's eyes, both logs): the hit flash turns from green to yellow after about **2.5-3 s / 18-30 hits** of continuous full-auto fire (about 10 hits per second), is still yellow for a single hit 1.4 s later, and clears to green by itself within about 5 s, including while single hits keep landing about once a second. Every hit in those bursts landed full damage, and the gun sent no extra frame when the colour changed: it is a headset-local "under fire" counter. Characterise the threshold and decay (hits at 5/s vs 10/s, time to clear), then decide whether it is the native cue for flinch (arsenal review §7). **→ 2026-09-17:** the flash colour follows the team: yellow on a team-2 victim, blue on a team-1 victim (Tony). `trigger`.
- **F229 🟡 THE ENERGY RIFLE'S OVERHEAT IS STILL INERT, AND THE PLANNED FIX WAS WRONG.** The arsenal plan copied the Charge Rifle's `t37`/`t38` onto the Energy Rifle to switch its overheat on. Bench 2026-09-17 proved `t37` is the charge weapon's **tap damage** (t37 20 → taps land 20, t37 30 → taps land 30; the full charge stays `t5`), not a heat token. Next rung: the Energy Rifle with `t38` = 150 alone, held full auto, `$ALCD` token 5 logged. If that stays inert, diff the Charge Rifle frame's other heat-adjacent tokens (`t35`/`t36`). **→ 2026-09-17: `t38` = 150 ALONE SWITCHES THE OVERHEAT ON.** Energy Rifle on `Tactix-E20D` (`t24` 6, `t14` 90, 300 cell): heat climbs about +3 per shot net during full auto (90, 93, 96, 99), fire stops at heat 99 (after about 30 shots, 2.9 s), and trigger presses fire nothing until the lockout ends. Not ammo: every stop came with 245-268 rounds in the cell. **The Energy Rifle does not cool down on its own once locked** (Tony: "I can only fire again after I reload"): heat sat at 100-102 for 14 s of trigger presses, and **each lever pull vented about 35 heat** (102 → 67 → 32 → 0, and 100 → 65 → 30 → 0 within one hold); at heat 0 it fired again from the same magazine, and holding the lever on recharged the cell. So a lockout ends only by working the lever, about three pulls or one held pull. The Charge Rifle, by contrast, cooled by itself in 4.8 s. **Overheat sound, ear-confirmed 2026-09-17 (Tony):** the captured Energy Rifle `t35` `D122` "sounds like it reloaded"; `C19` (the Charge Rifle's `t35`) is the early-release sound of a charge, not an overheat; **`D11` (the SMG's captured `t35`) is right**, heard on a real Energy Rifle overheat ("yeah nice"). Ship the Energy Rifle with `t38` = 150 and `t35` = `D11` as `wire` overrides. Next rung: `t38` = 75, to see whether `t38` sets the lockout length. **The Energy Rifle reload is hold-to-recharge** (Tony: "like the shotgun, took me a second to figure it out"): lever taps of 0.15-0.23 s refilled nothing; holds of 0.7-4.1 s refilled the whole cell in one step, 3.5-3.9 s after the pull started (the catalogue says 2400 ms). Unlike the Shotgun it is not per shell. The HUD must say HOLD TO RECHARGE for this weapon, and `easy_reload` needs the same check F123 did for the Shotgun. **→ 2026-09-18:** `t38` = 150 and `t35` = `D11` ship as `weapons.json` overrides. Left: the `t38` = 75 rung, a check that the HUD says HOLD TO RECHARGE on this weapon, and the `easy_reload` check. `trigger` + `build`.
- **F230 🟠 ONLY ONE OF THREE GUNS DECAYS ACCURACY UNDER SUSTAINED FIRE, AND IT IS THE GUN THE MODEL WAS PROVEN ON.** **→ 2026-09-17 tie-break:** a third gun, `Tactix-9498` (same firmware, outdoor mode, identical head), held live accuracy at **90 for 32 shots**, like `Tactix-3D4F`. So `Tactix-E20D` is the outlier, and the 2026-09-09 bench that established the walk to the `t22` floor ran on `Tactix-E20D`. Promote a caveat to `docs/manual/dev.md` (the `$ALCD` token 2 row and the `t21`/`t22` rows): the walk is measured on one gun; two others take at most one or two steps. Hit rate on `Tactix-9498` at a flat 90: 59 of 64 shots (92%), so the probability model itself works there; only the walk is missing. Also ruled out: battery (the walking gun walked at 84-87%, the others held at 86-93%), the BLE `$QUERY` state (identical apart from player and team), and the USB device record: all four guns read `v4.32`, `PCB-5`, `BTchip- 4`, `devhost.03`, headset `hds.59`, FieldID 1, PlayerID 0, NRF host and slave 1; the only factory differences (gun burn-in and laser tested on two guns) split the walking gun and `Tactix-9498` into the SAME group. Also negative: the device PlayerID (mirrors the last `$PSET` id), a gun power cycle with the headset off and on, and any Callsign command we do not send (captures hold only presentation commands). Design consequence: the native decay is not a usable balance lever; every accuracy cost is node-written (S42). Original finding: Bench 2026-09-17, bench AR at 100 ms with `t21` 100 / `t22` 50, both guns `v4.32 hds.59 devhost.03`, headsets beside the guns in every run. Gun `Tactix-E20D` walked live accuracy 100 → 50 in 9-16 rounds of full auto, repeatedly. Gun `Tactix-3D4F`, same frame, stayed at **90** for 5 full magazines, again after a re-arm at `$GSET` t7 0, again resting still on the desk and again swung while firing; armed with E20D's exact identity (player 1, team 1) it stepped once to 80 and held. So the difference is not t7, motion, identity or firmware version. Consequence now: stance and flinch (S42) must set `t21`/`t22` themselves and never depend on the native spray decay; accuracy-recovery timing (runbook step 6) must be measured on E20D. **Also ruled out (same day, after a power-cycle of both):** indoor/outdoor mode (3D4F was indoor and E20D outdoor; with both outdoor, 3D4F still held 90 for 28 shots while E20D walked to 50), the `$GSET` token 5 gyro (E20D still walked with it off), fire rate (3D4F at `t14` 60 ms and floor 0 stepped once to 80 and held for 18 shots), trigger bounce (one press and one release per burst on both), a full `$STOP`/`$CLEAR`/re-arm/respawn (90, 80, then 80 for 30 shots) and a stale slot 1 (the same AR written to slot 1: 90 for 32 shots). 3D4F takes one or two decay steps, then holds; E20D steps every 1-2 shots. Tony: the guns have no on-device menu setting that could differ. Left untested: swapping headsets (Tony declined). Side result: `t14` = 60 ms fires cleanly at about 13 rounds per second. **→ 2026-09-18:** the caveat is promoted (`docs/manual/dev.md`, the `$ALCD` row and the `t21`/`t22` rows). Left: `bench-firmware-levers-2026-09-19.md` §19 step 18, the factory SETUP menu, read only. `trigger`.

**Game test 2026-09-16 bench pass, desk fixes for the above (2 guns, then Pixel 4 + Pixel 5 through Mission Control). Evidence:** `docs/experiment-log/2026-09.md` (2026-09-16 entry).

- **F219 🟠 Needs Tony at the bench** in scanner respawn mode, does a trigger held on `$BMAP` fn 98 still report `$BUT`? The revive gate needs this reading. `trigger`.
- **F220 🟡 Decision for Tony.** Publish app 0.3.0 as a GitHub Release. Mission Control marks any 0.2.x build red, and the download page still offers 0.2.1. `decision`.
- **F221 🟡 Decision for Tony.** Mark each item in `docs/mc-warning-audit-2026-09-16.md` keep, quieter or remove. `decision`.
- **F223 🟡** the evidence extract and the Mission Control timeline order facts by `t_recv`, the arrival time. Order them by the fact's own `t`, the time it happened, instead. `build`.

**Verification bench 2026-09-17, desk work built the same day. Evidence:** `docs/experiment-log/2026-09.md` (2026-09-17 entry).

- **F237 🟠 Needs Tony at the bench** confirm the Pixel 5 BLE flood is gone: no Choreographer skipped frames, taps land instantly, and stations are still detected in a scanner-respawn game with the 25-per-second scan guard in place. `trigger`. **Bench 2026-09-18, partly answered and sharpened:** the scan flood itself is gone and the picker is clean (F258), but the Pixel 5 still took **about 10 s** to connect after a tap on one occasion, and about 3 s on another. The distinguishing fact is Tony's: **after a force-close it reconnects immediately**, so a cold start is fast and the slow case is a re-pick while the app is already running. That points at leftover link or scan state in the process rather than the radio or the gun. Timers are hooked on `scan`/`stopScan`/`connect`/`disconnect` in the live app to catch the next slow one with a breakdown.
- **F224 🟢** low items left by the polish loop: add a retry cap for a live-table write that keeps failing; the Bluetooth-picker test greps source text, the same pattern as F179; the green STANDING BY label has low contrast in night mode; iOS has no hint that Bluetooth is off. `build`.

**Game test 2026-09-11 (1v1, two taggers). Full sheet: [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md).**

- **F121 🟡 HIT RECEPTION IS ARMED AT CONFIG PUSH AND NEVER DISARMED** — so you take damage during the countdown and before your gun arms at spawn. `compile.py:934` ships `sir_rows` in the SAME head as the pregame team colour, and per F11 the `$SIR` table IS the arming. No spawn-protection concept exists anywhere. Fix mechanism in-tree: `_SIR_NO_POOL` (`compile.py:135`) pregame, real table at `$SPAWN`; `$SIR` swaps are proven safe (`_revive` re-sends every life). [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md) C1. `decision` + `build`. **→ 2026-09-12:** BUILT (A23): the head ships every `$SIR` cell on fn 28, the live table rides `spawn`/`revive` (or the `sir_pool` take), three compile guards (`assert_spawn_protected`, `assert_arms_at_spawn`, `assert_rearms_every_life`); `test_spawn_protection.py`. **Bench gate:** push, take a hit during the countdown — no headset reaction, no pool movement; after `$SPAWN` the same shot lands. **→ 2026-09-13 field, FIRST look, and it does not hold:** hits landed +1.6 s, +2.9 s and +3.0 s after a respawn, and the weapon comes online ~3 s after `respawned` — hit reception returns before the trigger does. See **F209**. **→ 2026-09-18:** the respawn half is confirmed on hardware (F217, closed: no damage in the first ~2.4 s). Left: the countdown half of the bench gate, and the `$STOP`-until-spawn alternative in `bench-firmware-levers-2026-09-19.md` §12 then §23.
- **F123 🟡 easy_reload FAILS ON THE SHOTGUN, AND THE HUD RELOAD ANIMATION IS A BLIND TIMER.** Three faults: the shotgun's per-shell chain needs a HELD handle; `engine.js:1850-1852` discards every `$BUT` release although the gun streams `state 0` (hardware-confirmed in the frame ring); and `_reloadPulled` (`engine.js:1971`) writes NOTHING to the gun, so any failed reload animates as success on every weapon. [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md) C2. `build`. **→ 2026-09-12:** BUILT: `$BUT` releases read (`held`, `lastButton`), the RELOADING bar reconciled against the gun's `$ALCD` (deadline from the last shell, F27's slow refill covered, overrun → indeterminate pulse, `reloadOutcome` books what the gun did), a stun refuses the pull, a swap ends it; `easy_reload` + a chain-reload weapon refused by the loadout policy (`weapons.json reload_type: "chain"`, shotgun). Residual = **F128**. **Bench gate:** shotgun + easy_reload refused in the kit UI; an AR reload bar ends when the mag refills (~1.7 s).
- **F128 🟡 MAKE easy_reload WORK ON A CHAIN-RELOAD WEAPON.** The shotgun reloads as a HELD per-shell chain (`$ALCD` mag 1→6 at ~420 ms per shell while the handle is down); `easy_reload` is `$BMAP,1,97`, a momentary alt-fire remap, so one tap emits one reload event. F123 excludes the pairing for now. To do: bench whether a held alt-fire (`$BUT,1,1` … `$BUT,1,0`) drives the chain the way the handle does, or whether fn 97 needs repeating per shell; if either works, lift the policy exclusion and add the hold to the HUD's reload takeover (the engine already reads releases).
- **F130 🟡 A HOT-JOINED (NEVER-SYNCED) NODE'S LATE FLUSH CANNOT MOVE THE END.** A24's replay orders facts by `t`; a node that never completed clock sync has its facts re-based to `t_recv` (contracts §4), so a late flush from it is scored at arrival time and can never reveal an earlier cap kill. Documented in `_match_facts`. Options: refuse the frag-cap rule for unsynced nodes (their kills count, their timestamp cannot decide the winner), or force a sync before the hot-join spawn (E5). Decide with the first field case.
- **F133 🟡 THE KIT-LOCK LATCH CAN OUTLIVE THE GAME IT WAS RAISED FOR.** A30's phone-side `kitLocked` clears on a `kit_open` false→true edge, at match end and at START (round-2 fix 2026-09-12) — but a host who locks the kit, never starts, and pushes a NEW game while the node sits in lobby spends none of those, so the next lobby still leads with THE HOST LOCKED KITS. Durable fix: MC sends `kit_open:false` on every re-push, or the latch carries the `config_id` it was raised for and clears when it changes. Same row: `moment {kind:'kit_locked_by_host'}` is emitted and read by nothing (the copy keys off `kitLocked`) — wire it to the lobby line in hud.js `_moments` or strike it from loadout.md §4.4.
- **F113 🟡 THE GUN LED STRIP FREEZES AT A PARTIAL LEVEL FOR THE WHOLE DEATH.** Documented A16 behaviour (`engine.js:2179`, "death is deliberately hands-off") whose assumption the field refuted: it reads "a sliver of health left" while you are dead. Worse the bigger the per-shot damage. Overturning it is a decision; `test_led_invariants.py` must stay green. [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md) C3. `decision`. **→ 2026-09-12:** BUILT: `_death` writes one `gun.blank` frame at once (nothing when the bundle has no gun table), `_gunTake` repaints at respawn, `$HLED,,6` still never in play; led-language.md amended; stage mirrored. **Bench gate:** a fast two-shot kill mid-animation → the strip goes dark immediately, repaints at respawn.
- **F126 🟡 THE iPHONE DEBUG PANEL FONT IS INFLATED** — `-webkit-text-size-adjust` is set nowhere in `app/www/index.html`, so WKWebView auto-inflates text in `#diag` (a scroller). One line to fix; compounds F122. [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md) A4. `build`. **→ 2026-09-12:** BUILT: `-webkit-text-size-adjust:100%` on html/body; screen-truth pins the computed value. Confirm on the iPhone (WKWebView cannot be reproduced in Chromium).
- **F112 🟡 THE CAM BUTTON CRASHED THE iPHONE** — `NSCameraUsageDescription` was absent, and iOS hard-terminates on camera access without it; `android-setup.sh` had carried the permission all along, only iOS was missing. Fixed in `scripts/ios-setup.sh` 2026-09-11, **not yet verified on device**. The QR join scanner shares the permission (`app.js:429`), so it stays even though the look-through is dropped (S21). Why Android also failed was never diagnosed. [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md) A6. `build`.
- **F111 🟢 TRY-OUT OVERLAP NOT REPRODUCED** — "READY UP overlaps the damage line" was reported on the iPhone, but at 891x411, 667x375 AND 812x375 with the demo payload there is 27px of clearance and no overlap. Hypothesis: the real MC-pushed `WeaponView` renders more stat rows than the demo's four. Needs a device screenshot or the real bundle in the harness. [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md) C4. `eyes`.
- **F120 🟢 THE UNSTOPPABLE MEDAL PLAYS NO AUDIO.** It fires, the bundle carries its `$PLAY` frame, and VX0U is `on_gun`. Both cheap theories refuted (both guns were in earshot; 0.1.8 postdates the medal path by 6 days). Narrowed by a success: the voice slot demonstrably works (kill lines play through the same form), so the fault is VX0U itself — the only medal sound that is `voice:game_mode` not `voice:medal`, with in-repo precedent for clips silent over BLE (`compile.py:1148`). [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md) E1. `ears`.
- **F114 🟢 WRONG SOUND ON A DEAGLE KILL** — "groaning heavy breathing", identified as VA6 (5.96 s, the male `hurt_loop` slot). First ear ever on A15.3. `low_health` REFUTED (all nine kills at hp=45/armor=70) and a bad kill-line id REFUTED (the male kill pool is clean). Leading untested theory: it came from the VICTIM's gun. The store holds no sound envelopes, so this cannot be settled from the desk. [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md) E2. `ears`.

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
- **F109 🟡 HOST-GRANTED SHIELDS AND HEALS: the `$LIFE` lever.** Proven 2026-09-11 (evening, bench): `$LIFE,<hp>,<armour>,<shield>,*` is additive per pool INCLUDING shields and takes negatives, with no `$SIR` row involved (F60 is IR-only). So a spawn perk (overshield), a phone/BLE station, a timed regen, a medic ROLE that grants over the LAN, or a hill-holder buff can all be node-written `$LIFE` frames -- no IR word, no new firmware state, and the shield hum (A10, F44) and the pool readout light up for free. Design: which grants, from whom, with what cap. **→ 2026-09-18:** the per-grant cap guess from F58 (d) (`$LIFE,25` did nothing where `$LIFE,20` healed) is refuted for shields: grants of 10, 20, 25 and 30 all land and the gun clamps at the maximum (S29, bench 2026-09-17 step 7). Left from F58 (closed): one HP grant of 25 from low HP, which can ride `bench-firmware-levers-2026-09-19.md` §6. The designs live in S29 (shield recharge), S50 (perks) and S51 (cooldown perks). Related: S14 syphon (the first consumer), F60. `build` + one bench rung.
- **F65 🟡 `$BUMP` looked inert on v4.32: it was our shape.** Bench 2026-09-09: `$BUMP,-5,0,0,*` on
  full HP and `$BUMP,0,5,0,*` on armour at 61 both did nothing, with the read validated either side (a real IR hit
  moved the pools and `$QUERY`'s `$LCD` tracked it). `$LIFE` with the identical arity worked in the same session, so
  this is not the connection or the arming. `brx-protocol.md` now says INERT. Open only as: does `$BUMP` want a
  different arity, a different game state, or is it dead firmware? Low value — `$LIFE` covers the need.
  **→ 2026-09-18: ANSWERED, it was our shape (tokens 2-4 are pool flags; cap30's `$BUMP,12,,1,,,*` adds 12 armour).**
  The full account is the `$BUMP` row, `protocol/brx-protocol.md` §3.2. Still to bench: the hp and shield flags,
  negatives and the cascade (`bench-firmware-levers-2026-09-19.md` §5). `trigger`.
- **S19 🟢 Lighthouse pass on `/` and `/manual/`** once the photos are in: LCP with a real hero JPEG (consider
  `fetchpriority="high"` on the hero image and an eager load for the first shot), CLS (every image already
  carries width/height), a11y score, and an OG-image check with a real unfurler. The gate covers landmarks,
  contrast, targets and fonts; it does not measure load. `build`.
- **S53 🟠 SMOKE: THE HUD MUST TELL A FLASHED PLAYER WHY THEY CANNOT HIT ANYTHING.** Tony 2026-09-18, on seeing fn 23 work: "we obviously have to show in hud what is happening to the player who got flashed". Without it the player pulls the trigger, hears their own gun, watches nothing land, and concludes the gun is broken. **The node needs no new wire support**: the victim's own `$ALCD` accuracy token drops **100 → 0 in the same millisecond** as the `$HIR`, and `engine.js` already parses that token for recoil (`_recoilObserve`, the `$ALCD` case). So the tell is: a `$HIR` that moves no pool, together with live accuracy at 0. Recovery is automatic and visible on the same token (0 → 2 → 4 → 7 → 12 over about 3 s), so the HUD can show a real countdown rather than a guess. Do: a takeover on the phone that names the effect and shows it clearing, plus the gun-body LED and a cue, since a player looking down the sights is not reading text. ⚠️ **Naming (Tony, same conversation): call it SMOKE, not a flashbang.** A flashbang should sting, and fn 23 deals exactly zero damage; a weapon carries ONE `<t3,t4>` key so it lands on ONE function, and we cannot blind and damage with a single word. A real flashbang needs two words (two shots, or a station firing twice), which is a design with a cost and belongs in its own row. The HUD half is the `brx-hud` session's file. `build` + `decision`.
- **S16 🟠 Damage over time, on the node** (unblocked by the 2026-09-09 bench; raised to 🟠 2026-09-17, Tony: "we don't have any damage over time weapons, like a poison gun"). `$LIFE` takes negatives, so
  poison / burn / bleed / gas are buildable with no firmware change and no IR per tick: the gun registers the
  proc once (a status cell, fn 8/24-28/35 — `$SIR,9,3,,24` already ships), the node reads the protocol off `$HIR`
  and runs the tick clock itself. Three things the bench pinned that the design must respect: a negative is
  **per-pool with no spill**, so the node walks shield → armour → health itself; the pool **floors at 0**, so
  overkill is silent; and a lethal tick emits **no `$HP`**, so the node books it via the `$LCD` path (F64, which was filed wrong and corrected) but produces **no `hit_taken` fact and no attribution** — S16 must decide who gets credit for a lethal tick.
  Also needs: who gets the kill credit for a tick, whether a DoT survives a respawn, and what the HUD shows while
  it ticks. **→ 2026-09-17: designed in `weapon-design.md` §6.3b** (the Toxin Rifle: half-damage direct, a small
  tick, refresh instead of stack, and the first weapon that punishes turtling rather than out-damaging it; the
  victim's node keys off the `$WEAP` t3 damage type echoed in `$HIR` token 2, and the stock enum already carries
  11 = gas). ⚠ **2026-09-18: the NATIVE route is UNSETTLED, not dead; `bench-firmware-levers-2026-09-19.md` §8
  settles it.** The perks bench (§3; P18, closed) saw one fn-24 shot do no damage and then replay a phantom hit every
  5.07 s until `$SPAWN`. The drive reading explains the loop: an expired fn 24-27 fuse injects a protocol-9 word, and
  `<9,3>` was itself fn 24 at the time, so every replay re-armed the fuse (`experiment-log/2026-09.md`, the drive entry
  §5). Now that `<9,3>` is fn 1 (F165), V4_30 predicts ONE delayed hit, which is a native delayed hit and not a poison
  tick. Until §8 runs, build poison on the node tick clock in `spec/node.md` §3.17, which works whichever way §8
  reads. The proc mechanism it wanted also arrived the same day: `$WEAP` t6 makes the gun roll a crit on a
  percentage of shots and echoes it on `$HIR` token 6 (F62, closed), so "poison on 15% of shots" is buildable.
  **The spec section is written**: `spec/node.md` §3.17 (recognise, tick, refresh never stack,
  end on death, the unattributed lethal tick, and the HUD's duty). What is left is the decision on kill credit, then
  the code. `$BHIT` (levers §3) is a candidate route to credit a lethal tick. `build`.
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
  **F42.1 ✅ ANSWERED 2026-09-11 (evening, bench):** the token slots are not equivalent — token 1 INTERRUPTS, token 4 QUEUES, and that is a property of the slot, not of the id (six trials, see `experiment-log/2026-09.md` → *the sound pass*). `presentation.cue_frames`'s token-4 `game_over` (VA33) is the one to keep: it queues behind an in-flight effect rather than cutting it, which is the right behaviour for an announcer line. `Compiler.cues()`'s `game_over`/`medal`/`multi` keys are dead — `cue_frames` overwrites them for the same resolved profile and nothing reads the stale copies — delete them on the next pass through `compile.py`. VA81 in slot 1 for the countdown stays confirmed and correct, unaffected by this. **F42.2 ✅ CLOSED 2026-09-12 (doc-rot pass):** `SENSOR`/`witnessed`/`word` moved into `bench_common.py`, the four surviving hand-rolled teardowns use `bench_common.connected()`, and `f11_ab.py` plus 39 other closed-experiment scripts were deleted (git keeps them). **F42.3 ✅ CLOSED 2026-09-12:** `led_ingame_usable.py` and `led_effects.py` went with the closed experiments. **F42.4** still zero-coverage:
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
  **Contract-DRY execution record (complete 2026-09-16): [`archive/HANDOFF-dry-2026-09-13.md`](archive/HANDOFF-dry-2026-09-13.md).**
  The remaining F42 work is the separate cleanup backlog below: coverage (F42.4), module seams (F42.5), repeated
  logic (F42.6), and the small interface/input items (F42.7).
  Contract-DRY phase 1 (`types.py`/`envelope.py` → generated `contract.gen.ts`/`contract.gen.js`) is DONE, see contracts.md
  A33. **F42.10 ✅ CLOSED 2026-09-12:** pyright gates `mcp/` in CI (`standard` mode, `mcp/pyproject.toml`). None of the
  rows below blocks a match.
  **F42.9 ✅ CLOSED 2026-09-16:** all five batches are done: generated leaf,
  arsenal, saved-game, live-row, node, station, tunnel, presentation, mode, recap and history shapes replace
  their console copies, and their producers are checked. `State.snapshot()` now composes named checked views
  into the generated top-level contract. **F42.12 ✅ CLOSED 2026-09-16:** `app/src/transport` is checked with
  strict `allowJs`/`checkJs`; the Python contract generator emits its sibling declaration, wire bodies remain
  unknown until narrowed, and the app CI job runs the checker before tests.
  **F42.14 ✅ CLOSED 2026-09-16:** `brx_mcp/stage/` is in the pyright gate. Its page and MC JSON boundaries,
  internal profile, advert, hill, stun and walkthrough state, and shared config/player/bundle shapes are checked;
  the stage/phone mirror suite remains the behavioral guard.

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
- **F5 🟡 decision** the AR's fire rate and reserve are balance choices, not the capture: `weapons.json` ships it at the native **100 ms** with **reserve 192** against the captured 384 (the 2026-09-17 arsenal rework restored the native cycle; the reserve is still half). Keep or restore the captured numbers, and say which. **→ 2026-09-18:** the gun carries the full 192 after `$SPAWN` (**F255**, closed; perks bench §6), so the reserve is not halved in play. The only decision left is reserve 192 against the captured 384. `decision`.
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
- **F16 🟡** `bench_common` half fixed: `BMAP` + `spawn_tail()` exist and the surviving tools use them (`stun_hunt.py` was deleted 2026-09-12); the other
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
  score teamkills as policy, or accept no teamkill feedback. Decide before any mode advertises it. **→ 2026-09-18:** with the F206 fix in, friendly fire off works in team games;
  a blocked shot still emits no `$HIR`, so the choice stands. `decision`.
- **Q15 🔴 → THE RANGE LEVER IS REAL, BUT IT IS `$WEAP` t2 `gunRangeOutdoor`, NOT t41 (garden, 2026-09-17).**
  ⚠️ **Corrects the first write-up of this same session**, which recorded the finding against t41: the two commits on
  2026-09-17 16:01/16:04 describe our t41 A/B setup but report the t2 result. What was actually measured, mag-counted:
  **t41 is a NULL** — two slots differing only in t41 (5 vs 75, damage 1 vs 21 so the `$HIR` magnitude names the slot)
  scored **27 of 27 for the low slot against 55 of 57 for stock, at 3 m, 10 m, 20 m, 40 m and ~200 ft**. There is no
  10 m drop-off at t41=5 and no distance at which the two slots differ. **The control is t2** (F231): t2=5 lands
  nothing at any distance including muzzle-on-dome, t2=100 (the shipped value on every gun; melee 90) reaches 200 ft,
  and between them sit a floor, a transition around **13-26**, and a flat shelf from ~31 up where every value behaves
  alike at any distance we can pace out. **Still unresolved and gating everything below: whether t2 can fence a weapon
  to a chosen distance at all** — above ~31 the cone at 30 m was barely different from the t2=100 control and
  37/41/42/45 all land at 40 m on careful aim. Two confounds make the whole ladder provisional: the receiving dome sat
  in **direct sun** for the hour with the light moving (misses came in streaks of 5-6), and **the first two trigger
  pulls of any group are weaker** (F232), which handicapped the first two shots of every group fired.
  **The design intent below stands and is unaffected by the token correction.** Range is per VENUE, not one number
  (Tony 2026-09-17: "10 m for any gun outside is really short ... when are you going to be that close in a park"), so
  it scales with the venue like play volume does, and the compiler's range hook lives there — **✅ moved from t41 to
  t2 2026-09-17** (F234 closed). Target reaches, ratios first, Tony's shotgun number set at
  15-18 m outdoors: Shotgun 8-10 m indoor / 15-18 m outdoor; SMG 12 / 25-30; AR and Burst 18-20 / 40-45; Suppressor
  and LMG 15 / 30; Marksman and Sniper full reach / 60 m or the hardware limit (the field has seen hits at ~200 ft).
  **Shipped 2026-09-17 (outdoor only, `docs/weapon-design.md` §4.2):** Sniper 100; AMR/Charge Rifle 85; AR/Burst 70;
  Suppressor/Energy Rifle 55; SMG 30; Shotgun/Rocket Launcher/Rail Gun 22 (heavies corrected to the close band, one-shot
  power is meant to be earned close, not out-ranged). Only the SMG/Shotgun/Rocket/Rail values are real guesses.
  (2026-09-18: the Shotgun went back to t2 100, because 22 made it miss about half its shots at 10 m, see F275;
  `weapons.json` ships it at 100.)
  Calibration method for the next sitting, **re-pointed at t2 and shaded**: at taped marks, binary-search the LOWEST
  t2 that still registers, **full 32-round mags with the first two shots discarded** (F232 makes 5-shot steps
  worthless), or use the ESP32 receiver on a tripod for a graded detect/decode margin instead of a hit count; one
  ladder indoors and one outdoors, dome out of direct sun. Note `$HIR` token 1 names the sensor at playing distance
  (F228 is a close-range caveat only). See S48 for the HUD-driven venue control. **→ 2026-09-18 capture (cap30), how Callsign does a short
  Shotgun:** it does not shorten the shot. Its Shotgun ships `t2` = 100 like every Callsign gun; only the t12 = 70
  headset word has its own reach, `t13` 80 outdoor / `t42` 30 indoor (35.2 / 28.2 kHz under the headset's carrier formula,
  `protocol/brx-protocol.md` §6, the `2, 41` row), so a far target takes 45 and a near one can take 115 (F71). And with the app's venue on
  OUTDOOR it still sent `$GSET` t2 = 0, so the app's venue switch is not t2. Which of t13/t42 fires is presumably
  the gun's own ALT-hold level; unmeasured. Original row: sub-indoor IR power
  (Tony: indoor bounces register hits from everywhere). Lever 1 = `$WEAP` t41
  `gunRangeIndoor` (75 on all guns, 20 on melee) — **one prior positive, see `weapon-design.md` §5 U2**; lever 2 =
  `$GSET` t3 `gunLaserRegion`. `$IRTX`/`$HFIRE` emit nothing on v4.32. **Run sheet:
  [`bench-super-indoor-2026-09-07.md`](bench-super-indoor-2026-09-07.md)** (MacBook — the rig has never run on
  macOS; find the margin before sweeping). A null is an answer. If it works, an `indoor_tight` venue preset.
  **→ 2026-09-18:** t41 in INDOOR mode is `bench-firmware-levers-2026-09-19.md` §19 step 5 (V4_30 reads the indoor
  fields only when `$GSET` t2 is not 0). `space` (bench 2.1).
- **Q16 🟠** beam divergence: on-axis then 10–50° off-axis at 3 m, 10 shots each, closing control. Sharp fall-off ⇒ skip
  the snoot, cut power (t41, then an aperture attenuator). Black plastic is IR-transparent at 980 nm; test any snoot. `space` (bench 2.4).
- **F162 🟠 Needs Tony at the bench** characterise the remaining venue controls after the 2026-09-13
  receiver finding. `$GSET` t2=1 crippled reception; player and utility heads must keep t2=0 at both venues
  (F197/F198). The native ALT toggle changed aim tolerance, with hits at ~200 ft in both states; it is not
  the remedy for the outdoor reception failure. `$WEAP` t41 matches the stock catalogue at both venues.
  **→ 2026-09-17: t41's effect is MEASURED and it is nil in outdoor mode (F231/Q15); t2 `gunRangeOutdoor` is the live control.** **→ 2026-09-18: t2 is a CARRIER FREQUENCY, not a power** (V4_31 disassembly, `protocol/brx-protocol.md`): a low value detunes the word out of the receiver's ~38 kHz band-pass, and t41 is read only indoors and only when it is itself non-zero, which is why the garden measured it inert. `$GSET` t3's effect remains unmeasured: `RANGE_ENV_OVERRIDE` stays a no-op
  and `DRIVE_IO_MODE` stays `off`. Do not enable either from the old range theory. Any future sweep needs
  fixed shooter/receiver controls and a closing control; keep t2=0 throughout. ALT notification/read-back
  is F169; indoor reflections are F198. See `archive/HANDOFF-gset-t2-2026-09-13.md` for the field evidence. **→ 2026-09-18 (V4_31 trace, LaserTagMods' drive):** the mechanism is the IR **carrier frequency**, not power (formulas: `protocol/brx-protocol.md` §6, the `2, 41` row), and the receiver's 38 kHz band-pass is the curve; t41 replaces t2 only indoors AND when non-zero, which is why it was inert outdoors; `$GSET` t3 is stored and never read. Calibrate in kHz (S48/S49). `bench`.
- **Q12′ 🟡 decision** should `hit_taken` carry the shield delta as its own field (both sessions said yes; `dmg: 0` invites
  `if dmg:` guards to drop the event)? `decision`.
- **B20 🟢** is `$LCD` token 3 the shield? Grant a shield (fn 11, friendly), `$HP` shows it, trigger an `$LCD`, read
  token 3. Yes ⇒ re-add the read in `engine.js` with a test; no ⇒ record confirmed-not-shield. `eyes`.
- **D1 🟡** the nRF radio (`NRFhost 1` / `NRFslave 1`): a bonus long-range channel only; not needed for feedback or
  attribution. Time-box the mesh tap to 30 min. **D3 🟡** reproduce Jay's 45-gun LoRa host (`reference/jay-ecosystem.md`).
  **D4 🟡** does the native "double kill" callout fire under OUR config (3 guns + ears)? `build` / `ears`.

- **F131 🟡 TWO `spec/modes.md` §8 QUESTIONS WITHOUT IDS** (surfaced 2026-09-12): (a) the mid-match revive drops `$HLOOP,0,0` and the headset returns via the A11.6 respawn sequence; confirm on hardware nothing else needed it; (b) `Compiler.cues()` ships runway_30/20 and the klaxon silent while start-sequence §2 names the lines; pin by ear. `bench` · `ears`.
- **F132 🟡 HANDOFF BYTE RATCHET.** `test_docs_hygiene._HANDOFF_MAX_BYTES` is 13,400 against a one-screen intent of ~9,000; the line rule passes because the bullets are paragraph-length. Trim on each close and lower the cap. `hygiene`.

- **F161 🟡** HUD gun picker does not refresh live: a gun powered on while the list is open updates the RSSI bars but never appears until "Set my gun" is tapped again (field 2026-09-12). `build`.
- **F152 🟠** Right after a redeploy the HEADSET kept BLINKING GREEN until something reset it: a `$HLOOP` not stopped before `$SPAWN`, or the spawn's stop frame ordered wrong (field 2026-09-12). Bench, with F148. `trigger`.
- **F158 🟠** F149's fix stops the low-health loop at death with `$PLAYX,0,*`; NOT bench-verified whether that also clips the NATIVE death scream (A15.3 keeps the scream native). One gun, one death, listen (field-fix lane 2026-09-12). `ears`.
- **D5 ⬜** PISTOL BALANCE (Tony, field 2026-09-12): a Deagle killed in 3 hits (check the headset x2 row before touching damage) and Extended Mags takes the USP to 40. Tony: the perk SHOULD apply to a pistol carried as the primary; the numbers are the question — sidearm base mags, or a fixed count / smaller multiplier for sidearms instead of x2. `decision`.
## 7. September build items (S)

**From the 2026-09-11 game test ([`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md)):**

- **S27 🟡 ONE-TAP "UPDATE THE APP" SCREEN (after store builds exist).** Tony 2026-09-12: a phone behind the newest build gets a full-screen HUD prompt with one tap into the Play Store / App Store listing; the store URLs and the newest version ride MC's `welcome` (A29 carries the build report). An OS push notification is the later step (needs APNs/FCM).
- **S28 🟡 RETUNE EVERY WEAPON WITH THE PROBABILITY MODEL.** Tony 2026-09-12 ("I like the new probability research folded in, probably needs a retune for all weapons"): the sidearm pass (S22, 2026-09-12) balanced on IDEAL ttk + expected ttk at p=0.7 + one-mag-kill probability + sustained DPS + kills per kit, with a no-strict-dominance check across all 22 weapons (`docs/reference/ttk-model.md` → *Shipped 2026-09-12*). Do the same for the 19 primaries: publish the 22-row table, decide the intended tiers (assault / burst / bolt / heavies / snipers) by EXPECTED ttk at a stated field accuracy rather than by ideal ttk alone, keep the captured `$WEAP` frames and change only `wire` tokens, and gate it on the bench (a body, not a spreadsheet — ttk-model.md's own caution). Prerequisite worth doing first: one measured field accuracy (hits / shots from a real match's `ScoreRow`, now that `shots` and `hits` are both booked). **→ 2026-09-17:** Tony approved the arsenal cuts (S44) and "AR back to 100 ms, sustained fire costs accuracy". Bench data for the retune: at 100 ms with `t22` = 50 live accuracy steps 10 per 1-2 shots and reaches the floor in 9-11 rounds; recovery after release runs at about 10 points per 0.15 s and completes within 2 s, and the walk-down varies from burst to burst (step 11 to never within 19 shots) on the gun that decays (F230: one of our two guns barely decays at all). The dominance test should drop "kills per kit" (a respawn refills ammo). Arsenal review page and `archive/bench-weapons-2026-09-17.md`.
- **S29 🟡 SHIELDS RECHARGE, AND THEY SOUND LIKE IT.** Tony 2026-09-12, from the Callsign run: Callsign games have HEALTH with SHIELDS on top; stop taking damage for a while and the shields RECHARGE by themselves, with a humming, growing "shields getting stronger" sound during the recharge and a "Shields Online" line when full — "I don't think we have our shield sound quite right". Ours today: `shield_up` plays VA8C ("SHIELD ONLINE", also VA6Y "Shields Online"), the shield LOOP while up is A10 (F44), and there is NO recharge mechanic and NO rising hum. To do: (a) mechanic — does the firmware regen shields natively (`$GSET`/`$PSET` tokens? the APK's `RepairRegenTick` sound enum suggests an app-driven tick) or do we drive it with the F109 `$LIFE` shield lever (node-written grants every N s after `SHIELD_REGEN_DELAY_S` without damage, capped at the pool); (b) audio — find the rising recharge hum on the gun (candidates: A08 "getting armour or protection on" heard 2026-09-11, the `RepairRegenTick` clip, the H/A families near A10) and play it during the regen, then VA8C/VA6Y at full; (c) contracts: a `presentation.events` pair `shield_recharging` / `shield_online`, a `GameConfig.shield.regen = {delay_s, per_s}` with the `silenced`/`vip` presets deciding on/off. Ear-confirm before shipping any id (A17's rule). **→ 2026-09-17:** see S45 (Callsign drives it from the app; node-driven `$LIFE` grants; ~4 s full refill).
  **⚠ Ids chosen by ear at the bench 2026-09-18, and they move the 2026-09-17 decision:** Tony auditioned the candidates through a gun and picked the Halo pair he had named from memory. **`N101` plays when the shield is DEPLETED**, which replaces "no voice line on the break". **`N102` is the shields CHARGING UP sound, not the finished one**, and it plays on the **first shield grant** of a recharge: "102 is shields charging up, it should play on the first shield grant probably". That puts it where `A34` sat (the start of the refill) rather than where `VA6Y` sat (full), so it is a single cue at the start rather than `A34`'s twice-through-the-refill shape. **Open:** whether the `N74` heartbeat still loops underneath while the shield is down or `N101` is the whole break cue, and whether anything still marks FULL. Everything here is a one-line id swap by design, so the bench decides rather than the code.
  **Folded in from S45 (2026-09-18), NAMED HEALTH PRESETS AND THE SHIELDS PRESET:** Tony 2026-09-17: Standard (45 HP + 70 armour), Shields (45 HP + 0 armour + 70 shield that recharges), Hardcore (45 HP); weapons are defined by hits to kill and the compiler scales damage to the preset's pool. Callsign's shield recharge is app-driven (class `DetectRecoverShieldCommand`, fields `_lastHitTime`/`_startRecover`), so ours is node-driven `$LIFE,0,0,<n>,*` grants after a delay; Tony's guess for a full refill is about **4 s** (7 × 10 every 570 ms). Bench: `archive/bench-weapons-2026-09-17.md` step 7 (grant sizes vs F58, clamp at the `$PSET` t5 ceiling). **Bench 2026-09-17 (step 7):** `$PSET` t5 is the shield MAXIMUM (spawn reads 0); `$LIFE` shield grants of 10, 20, 25 and 30 all land and the gun clamps at the maximum; 7 × 10 at 600 ms refilled 0 → 70 in 3.6 s; shield absorbs hits first; the native shield-hit sound and a shield hum play by themselves, but a `$LIFE` grant plays **no** recharge sound and **no** "Shields Online", so the node must play both. **Presentation chosen by ear 2026-09-17 (Tony, played live against a real 3.6 s refill):** recharge cue **`A34`** (3.5 s charge-up) played **TWICE**, once at the start and once halfway ("that last one was the best one yet"), then **`VA6Y`** "Shields Online" at full; **no voice line when the shield breaks** (Tony 2026-09-17: drop `VA6X`): instead the existing heartbeat `N74` loops **for as long as the shield is down** and stops when the recharge starts, which also warns the player that the Shields pool leaves only 45 HP (5 AR hits); the shield hum (`$PSET` shield loop, `A10`) and the shield-hit sound are native and correct. Rejected by ear: `A08` (the ShieldOnHeal clip, usable but weaker), `C08`, `C18`, `C04`, `H123`, `H124`, `N100`, `N18`, `N25`, `W12`, `X04`, `R120`, `W44`, `X32`, `ST10`. Tony: use this announcer (the `VA6` series of the `VA` male pack, already the default voice) for the whole mode. **Bank analysis 2026-09-17 (agent, raw PCM off `~/brx-audio-bank`, script in the session scratchpad):** `A34` is the ONLY id in the bank whose loudness AND brightness both rise over 2.5-4.5 s (slopes +0.35 / +0.36, centroid 2444 Hz), which matches the Halo recharge whine (a continuous ascending "armour spooling up", per O'Donnell); `A08` falls on both axes and is 1.5 s. Alternates worth one listen: `N54` (2.3 s, cleanest pitch rise) and `Y07` (3.6 s, rising loudness but too bright). **Halo's own timings for the preset defaults: 5 s delay after the last hit, 4 s to refill from empty, and the base clip replayed when the refill is longer** (which is why two plays of `A34` fit). **Shape decided with Tony 2026-09-17: small HP, large shield.** 30 HP + 120 shield played well twice on the bench (the shield takes 14 AR hits, then 3 hits leave 6 HP); 45+70, 40+100 and 20+130 were the other options considered. The full cycle (break, heartbeat, 5 s delay, `A34` x2 over a 4.1 s refill, `VA6Y`) ran clean twice: Tony "yeah ok clean". Best way to find Callsign's exact ids: capture Callsign's BLE traffic during a Halo-mode shield recharge and read its `$PLAY` frames. Siphon (S14) is parked: it depends on kill confirms. **→ 2026-09-18 capture (cap30), Callsign's actual recipe:** the recharged pool is ARMOUR (`$PSET` 45/70, the `$HP` shield token stays 0); after **6.2-6.6 s** with no hit it sends `$PLAY,W20,3,6,VA8C,,,,*` (the 2.6 s `W20`, then "Shields online" `VA8C` queued in token 4) and then **`$BUMP,12,,1,,,*` every ~0.4/0.6 s** until the pool clamps, 0 → 70 in 2.46 s. At the break it sends `$PLAY,VA8B` ("Shields depleted") and `$HLED,7,4,90,90,10,15,*`. Our by-ear picks (`A34` x2, `VA6Y`, heartbeat) stay the design; `W20` is one more candidate to hear. `decision` + `build`.
  **Folded in from K7 (2026-09-18):** shields as a game-config option (Tony, field 2026-09-12). K7's blocker is gone: `$LIFE` grants a shield over BLE (2026-09-11), and `$SPAWN,<n>,*` may spawn with shield n (`bench-firmware-levers-2026-09-19.md` §6 step 3).
- **S30 🟡 THE TAGGER SPEAKS THROUGH SETUP.** Tony 2026-09-12: "add audio out of the guns during steps of MC — some voice that makes sense for stage preparation." Today a gun is silent from the armory scan to the T-10 klaxon. Mechanism already in place: `apply {frames, preview:true}` (A9.1) may carry `$PLAY`/`$SFLASH` in `connected`/`kitted`/`lobby`, and every player has a character voice (A15: `intro`, `boast`, `status_*` roles on the gun). Design: a `setup` event class in `presentation.events` (`source: mc`, gated by `announcer`, volume at the try-out level 69 — the gun is at arm's length) fired by MC at the phase steps it already owns — gun bound to a player (`bind`/`welcome`: "Linked" / the character's `intro`), kit opened (`assign.kit_open`: "Choose your loadout"), config acked (`ack_config`: "Loadout locked — stand by"), all ready (kit→lobby: "Waiting for the host"), START scheduled (`start`: "Get ready", then the existing countdown cues). One line per step, once per phase, never over a try-out. Ids from the on-gun catalog (`status_*`, `intro` families) and EAR-CONFIRMED before shipping (A17's rule); the `silenced` preset drops them. Contract: an `A33`-shaped row (event class + the MC-side triggers); the node writes the frames verbatim as today.
- **S31 🟡 PICK YOUR VOICE ON THE HUD, AND HEAR ITS INTRO WHEN YOU DO.** Tony 2026-09-12: "play the intro sound when you pick the voice, and let players select it on the HUD." Today the voice (`Player.voice_slots`, A15's 24 characters) is HOST-set on MC's Kit screen, and A9.1 already makes the gun speak a sample when the host changes it — make that sample the character's `intro` line (catalog role `intro`, e.g. V21), at the try-out volume 69. Phone side: a VOICE row in the kit editor beside PRIMARY/SECONDARY/PERK (padlocked when `policy.hud_select` is false or the host fixed it), a `loadout_request {slot:"voice", id}` (contracts §5, additive `slot` value; MC validates against `gameconfig.VOICE_PACKS`, applies, re-sends `assign`, answers `loadout_ack`) and the same intro sample written to THAT player's gun through the preview `apply` path so the pick is heard where it is made. Ready ENDS a voice try-out like a weapon try-out (A10.4). Ear-confirm each character's intro id first (A17); one row per character in `voices.py`. Pairs with S30 (setup voice lines) — the same `setup` class carries the intro.
- **S48 🟡 PER-VENUE / PER-GAME-TYPE IR POWER FROM THE HUD ("SUPER INDOOR").** Tony 2026-09-17, watching the t2 ladder: "my preference is we control all of this. we leave the guns native outdoor mode and then we control these values from the hud per game type. we should be able to configure a super indoor mode with this too." Mechanism exists today: `$WEAP` t2 is per-weapon, per-slot and writable mid-life (S42 proved a bare `$WEAP` is safe), so MC can compile a venue/mode power level into every head. **Shape: a master level, not a per-weapon identity** — 2026-09-17 could not find a t2 that fences one weapon to a chosen distance (F231), and above ~31 every value behaves alike at playable distances. So ship it as `GameConfig` venue power (e.g. indoor_tight / indoor / outdoor) applied to all weapons, and keep per-weapon range out of the catalogue until F231's shaded re-run says otherwise. Depends on F231 and F232. Note the `$WEAP` write resets mag/reserve/accuracy, so every power change needs the `$AMMO` restore (S42). ⚠️ **2026-09-18: re-read this row before building it.** `$WEAP` t2 is a CARRIER FREQUENCY, not a power (V4_31 disassembly, `protocol/brx-protocol.md`), so "venue power from the HUD" cannot be built on t2: a low value detunes the word out of the receiver's band-pass, it does not turn the gun down. The one real emitted-power lever the trace names is the gun's own indoor/outdoor level (PWM duty about 20% against 38%), which we do not drive over BLE. Decide what "super indoor" now means before any build: a detune that costs range at every distance, or a physical fix. The carrier reading is benched at `bench-firmware-levers-2026-09-19.md` §20. `decision` + `build`.
- **S49 🟡 A PORTABLE IR RECEIVER, SO ONE PERSON CAN MEASURE RANGE.** Tony 2026-09-17, after the garden run needed two guns, a MacBook and a full walk per value: put the receive side on an **M5StickS3** (2 ordered, due the week of 2026-09-22, `m5sticks3` prototype work) so a receiver can be staked out in the field with no laptop, no victim gun and no BLE. Shape: a receive-and-log sketch that counts decoded words, shows a running total on the screen and keeps a timestamped log; **several Sticks at once** (for example 25 m, 50 m, 100 m) turn a range ladder into one group of shots per value instead of a walk per value; one Stick at a fixed short distance is the per-pass control. Constraint already known: the Stick's IR receive is RMT-only with the speaker off. Also gives the indoor attenuator ladder (layers over the dome standing in for distance) on the same instrument, which is how the `t2` transition band (13-26) gets mapped without pacing 200 m. Shade every receiver (the 2026-09-17 sun confound) and drop the first two shots of each group (the weak-first-pulls finding). Serves Q15, F231 and S48. `hardware` + `build`.
- **S50 🟠 THE PERKS ARE NOT A CHOICE: BODY ARMOR IS A STRAIGHT UPGRADE.** Tony 2026-09-17: "body armor might be broken. we need rock paper scissors in those selections not an obvious OP". `body_armor` adds **+50 armour on a 115 pool, +43% effective health, at no cost**: an Assault Rifle needs 19 hits instead of 13. Every other perk buys convenience (`extended_mags` x2 magazine and reserve, `quick_hands` x0.5 reload, `quick_switch` x0.5 swap, `easy_reload` ALT-to-reload and no second weapon). Reserve ammo is nearly free in play (a respawn refills the kit, F225-era finding), so `extended_mags` is worth less than it looks. Do: (a) compute effective health and hits-to-kill per perk per weapon at each health preset, including the Shields preset where armour sits beside a regenerating shield; (b) convert the convenience perks into seconds saved per fight and compare them with the hits Body Armor absorbs; (c) read real pick rates from the match store if any exist; (d) propose a cost for every perk so the set trades off (for example Body Armor paying in swap or reload time, or being weaker where a shield already regenerates). (e) **Research how other shooters build perk sets** (Call of Duty perk tiers and Specialist, Halo equipment and armour abilities, Valorant abilities, Apex legends' passives, Battlefield gadgets) and **propose NEW perks that need nothing but what we already control**: `$WEAP` tokens per player (damage, cycle, magazine, reload, swap, accuracy ceiling and floor, muzzle flash and loudness `t25`/`t26`, heat), `$PSET` pools, the `$SIR` table (heal, armour, shield, armour-piercing, dual-polarity rows), node-written `$LIFE` grants, and HUD-only logic on the phone (the node already sees every hit with its SENSOR and shooter id, every shot, the BLE presence list of nearby players with team and alive state, stations, and the match feed). Examples worth costing: a suppressor perk that buys `t25`/`t26` quiet on any weapon; a motion-tracker perk reading the presence list (F93, already decided as a perk not a baseline); a "threat direction" HUD cue from the `$HIR` sensor field; faster shield regen or a spawn overshield in the Shields preset (`$LIFE`); an accuracy boost after a kill; a heavy-barrel trade of damage for cadence; a medic row from the `$SIR` heal functions (`med_kit` is already catalogued and hidden). Each proposal states its cost, so the set stays rock, paper, scissors. **`easy_reload` is OUT of that comparison: it is ACCESSIBILITY, not balance** (Tony 2026-09-17: "my daughter cant reload the brx normally"). Today it sits in the perk slot and costs the player a second weapon (the ALT button), so a child who needs it pays twice. Proposal: move it beside the per-player pool handicap (`loadout.overrides`) as a per-player accessibility setting the host sets once, so it never competes with a balance perk; keep the "no second weapon" rule and the two-tap warning, since that is a hardware fact. **Keep the two accessibility switches INDEPENDENT** (Tony 2026-09-17): a child gets Easy Reload AND a bigger pool, while a left-handed player, for whom the lever is awkward, gets Easy Reload and NO extra armour. So the per-player block is `{easy_reload, max_hp, max_armor}` with each part optional, not one bundled "kid" toggle; the game-wide `kid_mode` in `gameconfig.py` (health floors, friendly fire off) stays a separate thing. **→ 2026-09-17 night, decided with Tony:** Body Armor drops **+50 → +25** (about 20% of the pool, so it scales with the health preset), and in the Shields preset it must grant SHIELD, never an armour layer the preset was designed without (`armed_armor()` is preset-blind today, and a Body Armor pick there would take the pool 150 → 200). Every perk gains a cost on the lever its opposite buys. **Armour Piercing** joins as the counter-pick, but at about **60% less damage**, not 20%: bypassing armour leaves only the 45 HP pool, so at -20% an AP rifle kills in 7 hits instead of 13 and is simply the best gun in the game; at -60% it matches a normal rifle against a bare target and beats armour and shields, which is the counter role. **Motion Tracker** is buildable today from the presence list the phones already receive (F93), as a proximity LIST with no bearing, unauthenticated, about a 10 ft bubble. The slot may hold more than four perks. **A health pack (Tony's idea, 2026-09-17): heal once per life**, node-written `$LIFE` grant (the shield bench proved grants of 10 to 30 land and the gun clamps at the pool ceiling), triggered from the HUD, with the heal ticking over a second or two and CANCELLING if a hit lands, so it cannot be used mid-duel; it pairs with the Shields preset, where HP never regenerates. **Three more of Tony's, 2026-09-17 night.** (a) **Heal a teammate with the second weapon**: buildable today with no host logic, because the `$SIR` dual-polarity rows heal an ally and damage an enemy with the same emitted word, and the firmware gates support functions to a same-team source (`weapon-design.md` §6.3; the hidden `med_kit` row is the placeholder). Shape: a slot-2 weapon whose `<t3,t4>` key maps to a heal function, one heal per few seconds, and the healer gives up a real backup weapon to carry it. (b) **Bubble shield**: a temporary shield, now that the 2026-09-17 bench proved `$LIFE` shield grants and the clamp; the node grants a block, starts a timer, and takes it back with a negative grant when it expires, with the recharge cue, the hum and "Shields Online" already ear-picked (S45). Decide whether it protects only the carrier or anyone standing in a station's area. (c) **The EMP grenade is still the one we cannot build**: no `$SIR` function has produced a stun, `$STUN` over BLE is a no-op, and fn 23 (silences the gun and forces accuracy to 0 for 6 to 8 s) is the closest primitive; the live lead is still to capture the native Sentinel EMP ability (U11'). (d) **Stim pack** (Tony, 2026-09-17 night): spend health, gain rate of fire and damage for a few seconds. It uses only levers the same day's bench proved: a NEGATIVE `$LIFE` takes the HP at once, a mid-match `$WEAP` raises `t5` and lowers `t14` (30 to 90 ms to apply) with the `$AMMO` restore, and the timer writes the frame back. It is a genuine trade rather than a buff, and it stacks badly with the Shields preset on purpose (HP never regenerates there), so it wants a per-preset cost. Two traps to design against: the revert must obey S42's writer guards, because a revert racing a reload is the one case the bench could not place; and a player who stims at low HP can kill themselves, so the node must refuse the spend below a floor. Two idea sources for the next pass, both running 2026-09-17 night: a catalogue of 60 to 80 perk mechanics from other shooters, and an exhaustive map of every lever our hardware actually gives us. **→ 2026-09-17 night, catalogued in [`perk-design.md`](perk-design.md)**: the rules a perk has to obey here, a core set of SEVEN (Body Armor at +25 and preset-aware, Armour Piercing at about -60% damage, Quick Hands, Extended Mags, Quick Switch, Motion Tracker, Second Wind), the next wave with the one thing each waits on, and every rejected idea with its reason. The research sweep and the lever survey are folded into its §6, so the idea pool is durable and this row no longer has to carry it. Depends on the arsenal numbers landing first (S28/S43). **→ 2026-09-17 night, compile-time half BUILT** (`mcp/brx_mcp/mc/compile.py`, `perks.json`, `perks.py`, `policy.py`, `state.py`, `types.py`, `gameconfig.py`, `hitaudio.py`): the seven-perk set at the decided numbers (Body Armor +25 armour/×1.25 reload, preset-aware — a base-armour-0 game grants SHIELD via a new `armed_shield()`; Extended Mags ×2 ammo/×1.3 switch; Quick Hands ×0.5 reload/×0.8 ammo; Quick Switch ×0.5 switch/-20 armour, `armed_armor()` now floors at 0; Armour Piercing's primary-only `$SIR` rekey onto a new permanent `<4,0>` fn-2 cell at a 60% damage cut, refused on a charge weapon or a non-plain-damage cell, `assert_armor_piercing_armed` guards a missing row; Motion Tracker/Second Wind catalogued with no compile-time lever); `perk_effects` on `FrameBundle` and `State`, resolved from the compiled frame by one shared `Compiler.perk_effects_resolved()`; Easy Reload moved to `loadout.overrides.easy_reload`, independent of `max_hp`/`max_armor`, the ALT-button/chain-reload refusal moved with it. `npm run test:all -- --ui` is green except `app/src/hud` (owned by the HUD session): the PERK tab's row count, the two-line summary a two-effect perk now needs, and the retired Easy-Reload-in-the-perk-picker flow all want HUD-side updates; `webapp/mc/src/screens/Kit.tsx` likewise has no control yet for `overrides.easy_reload`. `decision` + `build`.
- **S52 🟠 THE HUD NEVER TELLS A PLAYER THEY HAVE EASY RELOAD.** S50 moved `easy_reload` out of the perk slot into the per-player accessibility block (`loadout.overrides`), which is right: a child who needs it no longer pays a second weapon for it. But `app/src/hud` has no notion of `overrides` at all (grep: the only `easy_reload` in the HUD is a glyph). Two consequences, both found while retiring the old screen-truth step on 2026-09-17. (a) A player whose host set the override sees NOTHING that says ALT reloads their gun, so the one person who needs the hint most is the one who does not get it. (b) The ALT-button conflict is now enforced only on the server (`policy.conflict`, `chain_conflict`, `state._check_loadout`): a player with the override who picks a second weapon gets a refusal from MC rather than the two-tap warning the picker used to give, and out of MC coverage there is no warning at all. Do: show the override on the kit plate or the chip bar (`ALT = RELOAD`), warn in the picker before the request goes out, and add a screen-truth step that drives the override rather than a perk pick. The HUD is the `brx-hud` session's file. `build`.
- **S51 🟡 PERK CHARGES RUN ON THE MATCH CLOCK, NOT ONCE PER LIFE.** Tony 2026-09-17 night: "we can do perks across lives too, we could allow a grant every 5 minutes regardless of how many deaths bc we have the phone hud", then **3 minutes** as the shipped period. **Why it is the better shape:** a once-per-life charge REWARDS DYING, because dying is how it refills; a cooldown on the match clock rewards surviving and creates timing decisions, which is what arena shooters are built on. The phone holds the match clock, survives the player's death and needs nothing from MC, so this works with no coverage. **Rules:** the clock starts at MATCH START, not at a player's first spawn, so every charge lands at the same moment for everyone and a late joiner gets no free one; one charge is held at a time and an unspent charge never stacks; a second trigger during an active window is refused, not queued; the HUD must show the timer or the perk is invisible and unplannable (the HUD session owns that). **The family, each a 3 minute charge:** Overshield (a block of shield, spent not permanent), Overclock (about 15 s of faster cycle and more damage), Resupply (an instant full magazine mid-fight, no reload), Sweep (10 s of the nearby-enemy list, then dark again), Field Dressing (heal to full over about 2 s, cancelled by a hit). **The argument this creates, on purpose:** a cooldown perk is nothing for three minutes and then decisive for ten seconds, against a passive perk worth about 300 ms in every fight. Players should disagree about which is better. Every one writes the gun, so all of them queue behind recoil, spawn protection and the operator resync (the HUD session's `_holdAccuracyWrites`), and each needs a state table saying what happens if the effect expires while the player is down or the match ends. **→ 2026-09-18 bench: the write-during-reload blocker is GONE.** A mid-reload `$WEAP` plus `$AMMO` does not break the reload: the write applies AND the reload still completes afterwards, debiting the reserve (magazine 0 → 5, reserve 192 → 187, 2.9 s later, twice). So Stim Pack, Overclock and Adrenaline can all write mid-life without dodging a reload. One design rule falls out: a writer must not treat its own `$AMMO` restore as final while a reload is in flight, because the gun refills on top of it. Depends on S50's set landing first; the family is listed as the next wave in [`perk-design.md`](perk-design.md) §3, each row naming its gate. `decision` + `build`.
- **S42 🟡 BUILD STANCE, FLINCH AND RECOIL (node-driven accuracy), ON BY DEFAULT.** Tony 2026-09-17: default on, host can turn off; **and recoil is ours too** ("lets use our own recoil"): the catalogue keeps `t21` = `t22` (native walk off, F230), and the node lowers the ceiling step by step during a sustained burst and restores it after release, at rates we choose; the phone rides on the tagger's Picatinny rail. Bench 2026-09-17 cleared the mechanism: a bare mid-life `$WEAP` with new `t21`/`t22` keeps the gun firing and taking hits (71 shots through 12 writes; 13 hits taken during 20 writes), applies in **30-90 ms**, does not revive a dead gun, but **resets the magazine to `t39`, the reserve to `t40` and live accuracy to `t21`**; `$AMMO` sent straight after restores the live counts exactly. A written ceiling is honoured on a non-walking gun too (`Tactix-9498` at a fixed 50/50: 12 of 32 hits, 38%, near-miss whizz-bys heard at the target). Accuracy-model misses send **no `$HIR`** (the victim still plays its `missShotHit` near-miss sound and flashes, per the 2026-09-09 bench, so they are silent to our software only): hit rate 38/40 at live accuracy 90, 13/13 at 70-80, 7/18 at 50-60. Required guards: one writer, latest state wins; never write between a reload-lever pull and the refill (a write mid-reload was not measured); `$AMMO` restore after every write; account for the accuracy reset in the flinch design; log every write. HUD: stability bar from `$ALCD` token 2, STEADY/MOVING/RUNNING chip, flinch jolt (brx-hud owns `app/src/hud`). **→ 2026-09-18:** recoil is BUILT (commit 76ad3764), and its writer was rebuilt and proven on hardware (F259, closed). Stance and flinch are not built (the seams are in `spec/node.md` §3.15). Left: stance, flinch, the HUD parts, and the write budget (F274). Run `bench-firmware-levers-2026-09-19.md` §21 before building stance or flinch: if `$TMP` t4 drives live accuracy with no magazine reset, all three move off `$WEAP` plus `$AMMO`. `build`.
- **S43 🟡 THE CHARGE RIFLE IS A PRE-CHARGE AMBUSHER: ONE CHARGE PLUS 2 TAPS KILLS.** Tony 2026-09-17: nobody lands a second charge in a 1v1. Bench 2026-09-17: a full charge takes 3-4 s by feel, can be **held indefinitely**, costs 10 rounds and +56 heat; a tap costs 1 round and +14 heat (`t24`); heat locks out at about **103** for about **4.8 s** and decays about 30 per second. **`t5` sets the charge damage and `t37` the tap damage, independently.** Rule, derived per game from the pool (Tony: we set the pools): `pool − 2×tap ≤ charge < pool − tap`; at the 115 pool, taps 20 and charge 85 (charge + 1 tap = 105, + 2 taps = 125). The combo costs 12 rounds and 84 heat (under the lockout). Depends on F226 (F225 closed 2026-09-18). **→ 2026-09-18 (perks bench):** the tap cadence is 285 ms, not the 500 ms placeholder, so charge plus two taps kills 570 ms after release (`experiment-log/2026-09.md`, the perks bench entry item 7). `decision` + `build`.
- **S46 🟡 HEAVIES AS STATION OR PICKUP WEAPONS.** Tony 2026-09-17: Rocket Launcher and Rail Gun never appear in a loadout (S44 enforces the pool rule). The pickup itself does not exist: design how a station grants a heavy mid-life (a slot-1 `$WEAP` + `$AMMO` write, now proven safe per S42) and how it is taken away (ammo out, death). `decision` + `build`.
- **S47 🟡 TEAM ROLE LIMITS AS A GAME CONFIG OPTION, NO DEFAULT.** Tony 2026-09-17. A loadout-policy rule such as "at most 1 LONG per team", on the arsenal review's roles (LONG, HOLD, RUSH, FLANK); the kit screen shows teammates' picks. `decision` + `build`.

- **S25 🟡 A SPECTATOR / BROADCAST VIEW FOR MC** ("espn quality"). Resolve the tension first — MC has been pushed toward calm and scannable; a scoreboard wants big and animated. `Live.tsx` mixes score display with END MATCH EARLY and RECALL, which must not be on a screen pointed at a room. Measure Oswald's tabular figures before animating numbers (see F115). [`archive/game-test-2026-09-11.md`](archive/game-test-2026-09-11.md) D4. `decision`. **→ 2026-09-12: v1 SHIPPED** — `#spectate` read-only route (no command bar, no control anywhere, a projector tab latches on it), big scores/clock/leaderboard/feed, rows fit the viewport at ≥ 900×500, the whole board dims behind `FROZEN · MC OFFLINE`, the result card follows the phase. The ESPN treatment (animated count-ups on the `<Num>` cells, replays of the feed) stays open here.

- **S14 🟠** **SYPHON: heal the killer, as a HUD-driven event** (Tony 2026-09-07, for a fair 2v1). The mechanic
  exists only in `modes/deathmatch.py`, the laptop-BLE CLI path, and has never run on hardware; the phone node
  and the node↔MC bundle know nothing about it, so it does not exist in a real match. **Design (agreed):** it is
  a HUD event, not an MC push. MC already tells the killer's node it scored (`feedback` `kind: "kill"`,
  `engine.js` §3.6, the same body that carries medals), so the node writes the heal to its OWN gun and animates
  it. The alternative, MC composing `$LIFE` for a remote gun over A6.4 `apply`, needs coverage at the instant of
  the kill and silently does nothing out of range. Shape: a `siphon` block in the game config compiled into the
  bundle (`{hp, armor}` + the precompiled `$LIFE` frame), so the node holds it and works offline. Guards: never
  heal a node that is not `live` and alive; `$LIFE` is additive-and-clamped so it cannot overfill; a shield grant is
  possible too (`$LIFE` fills the shield over BLE, 2026-09-11; the old "no shield, P16" guard is stale). Open sub-items: **S14.1** the Designer control + a per-team or per-player switch
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
- **S7 leftovers 🟡** reconnect (S7.1/S7.2 built + hardware-validated): gap-death re-arm (a gun that died while the app
  was closed and does not re-report `$HP,0` is re-armed as alive; decide whether reconcile re-probes once); the
  dead-player rejoin path is untested on hardware; a soft reload left the native BLE link half-open (release on
  teardown). `trigger` + `build`.
- **S8 🟢** station scan fix (low-latency scan + 8 s restart, 73d391a) needs the two-Pixel bench to confirm; try a lower
  station TX if it recurs. `eyes`.
- **S1 leftovers 🟡** sound catalog: Tony's by-ear audit: **249 of 2477** distinct ids in `~/.brx-mcp/sound-audit.jsonl` (101 new on 2026-09-11 evening, in two sittings) and **`fx:hit` is COMPLETE** (all 122: 105 in the audit file + the 17 judged 2026-09-07 that live in `hitaudio.py`'s comments). New armour-family takes for A17's pool if it ever wants a fourth: H35/H39/H40/H54 "hammer on metal"; H52/H53/H58 "metal bucket"; H134/H135/H136 "typical hit" (health-hit candidates, health ships silent by decision). Still to hear: every other fx category; the category-driven picker in the MC game-mode editor. **2026-09-18:** folded in **158 new community labels** from the LaserTagMods BRX Audio sheet (`mcp/tools/soundbank_community.py`), plus 224 that differ from ours and 622 that agree; **20 ids** the sheet reports broken since firmware v4.30 are flagged `community_flag_noise` and still need our own ear check. `ears` + `build`.
- **S-A12 sidearms 🟡** .1 ✅ **CLOSED 2026-09-11 (evening, bench):** P09 reads as "a pronounced shot, could be the Deagle"; P16 preferred for the GLOCK ("I like the deagle sound for the glock"); Q04 confirmed silenced, for the USP-S; **Deagle = X14** ("heavy rifle shot", "that could work"); reload chain D08->D07->D06 at 400 ms confirmed working. Wired in `weapons.json`: glock t27 = P16, deagle t27 = X14; usp keeps Q04.
  .2 semi-auto cadence on hardware (t20 = 7, t14 150/200/375; USP-S t25=2/t26=50 = no flash + half loudness?) `trigger`;
  .3 real Counter-Strike audio stays out of the repo (convert with `ltp_convert.py`, copy over the data port) `build`;
  .5 a stock `pistols` template in START FROM. `build`.

- **S32 🟡 MODE ART FOR koth (MC + phone) AND MELEE WEAPON ART.** `state.py` MODES has six modes; `webapp/mc/public/assets/modes/` and `app/www/assets/modes/` have five images. `hud.js` builds the art path with no fallback; MC's GAMES rail shows the placeholder caption (`webapp/mc/src/modeArt.ts` names the gap). `melee` is in `weapons.json` with no `melee.jpg` in either tree. With it, decide the D7 duplication from the doc-rot ledger: the two asset trees are byte-identical (720 KB); make one the source and copy at build, or genuinely downscale for the phone. `build`.
- **S33 🟠 WIRE THE `ir.*` DIAGNOSTIC CASES TO `IRBridge`.** `diag/cases.py` `ir.capture`/`ir.emit`/`ir.sir_sweep` carry no send/verify and skip; their docstring said the bridge did not exist. It does (`brx_mcp/irbridge.py`, `hardware/esp32-ir-bridge/README.md` ~line 137). `build` · `bench`.
- **S34 🟡 SELF-HOST THE HUD AND MC FONTS.** `app/www/index.html:8` and `webapp/mc/index.html:7` load Saira Condensed / Oswald / Chakra Petch from Google; the field Wi-Fi has no internet (`ios-setup.sh` allows local networking only), so both faces fail on the one network that matters. `site/public/fonts/` already self-hosts Chakra Petch and Oswald; Saira Condensed is the missing face. (replaces the fonts line that sat in §11's MC-build ledger) `build`.
- **S35 🟡 `app/src/app.js` (node.md §3.11 lifecycle, §3.14 log sync) AND `app/src/utility.js` HAVE NO TESTS**; `engine.test.mjs` covers neither §3.13 match result nor §3.14 (S26 built the sync; the gate is `ui:logsync`, not a unit). `build`.
- **S36 🟡 UTILITY LEFTOVERS cut from the roadmap's status table 2026-09-12** (check each against F106/S5 before working): ITEMS-panel assignments do not survive an MC restart; the phone utility screen does not render `valid_ids`; B1's two-phone soak (73d391a) has not been run; the A6 recap stations row (revives per station vs the station's own count) is unbuilt. `build` · `bench`.

## 8. Protocol unknowns (P), grenade (G), bench unknowns (U)

- **P3 🟡** `$PSET` voice-pack token → line map. **2026-09-11:** the field is `SquadLeaderVoices` in the
  lobby `RoomIsOpenMessage`, but it was **empty** in the capture (no squad-leader voice set). To capture: set
  a squad voice in Callsign and re-host, then decode. `ears` / `capture`.
- **P4 🟢** `$AS` / `$UP` are silent on v4.32 (seven shapes); their *effect* was never probed. `trigger`.
- **P8 🟠** Callsign API capture. **2026-09-11: largely resolved** — API is **plain HTTP** (OAuth2, hardcoded
  client_secret), and the game config **did not ride REST in this capture**; it came through the SNS/SQS lobby as .NET blobs.
  Whole lobby + match message catalog and game-data model are now in `protocol/callsign-extract/protocol-classes.md`.
  **Still open:** numeric **weapon stat values** were not in the payload (names/enum only). Method that works:
  WireGuard mode, not the HTTP proxy (`capture-runbook.md`). **Decision (2026-09-18): does Tony still want the Callsign
  API view?** Every weapon's numbers now come from its own captured `$WEAP` frame (`weapons.json` `capture`), so the
  missing stat values may be moot. `capture` (Mac) + `decision`.
- **P12 🟢** `$PB*` playbook enums: silent on v4.32; a BLE probe, not in the HTTP capture (P8 did not yield them). `capture`.
- **P14 🟢** is the audio SD card removable? Needs a teardown; not worth it on a 4-gun fleet until there is a spare. `decision`.
- **P15 🟡** phone-as-station limits: which `$PLAY` id is a field-wide alarm (candidates from F44's failed shield-hum shortlist, 2026-09-11: N71/N72, both read as "security alert"/"very annoying security alarm" — promising for THIS use even though they failed as a shield loop); max simultaneous BLE links an Android phone holds. `ears` + `space`.
- **G3 🟡** capture Callsign configuring a grenade → the exact `$GREN`. `capture`. **G4 🟢** grenade `.bin` flashing: no
  known method (USB-C is power-only, G7). **G9 🟠** CTF flag team assignment (a white grenade shot by team 1 turned red;
  likely `$GREN channel`; pull Jay's CTF videos). **G10 🟡** `$GREN` blast type on a paired thrown grenade. `grenade`.
- **Grenade captures still to do:** Hill / Assault / CTF / Frag beacons (`bench-grenade.md` steps 1, 5, 6); a BLE scan
  with the grenade on; the receiver on a HEADSET for the three unexplained emissions (proto-15 killer-id word on death,
  three self-hits after the button word with FF on, short bursts on dead-trigger pulls). `grenade`.
- **U2** = Q15 (t41). **U4 / U5** reload-chain timing vs `reload_ms`; held-trigger fire sound retrigger vs ring-under. `ears`.
- **U11′ 🟡** which `$SIR` function, if any, is a real STUN in OUR table? fn 23 is the smoke (accuracy to 0, no pool change, 2026-09-18); the enemy-polarity
  shortlist that registers a hit and moves no pool is **8, 24, 25, 26, 27, 28, 35** (fn 3 drains shield, so damage);
  ally 31, 32, 34 are genuine status functions (re-measured from depleted pools). Only a human holding the gun can name
  them. **Narrowed 2026-09-10 (F73, closed — `archive/followups-closed.md`): enemy 8 and 24-28 are swept and written
  up** (fn 28 registers with nothing at all, fn 8 is silent but flashes and buzzes, fn 24-27 fire one long
  grenade-ish clip). **Left here: enemy 35, and ally 31 / 32 / 34** — bench-queue rung **BQ-D6**, whose three
  run-voiding traps are mandatory. Moot for the product if F15 ships. **→ 2026-09-18:** `$STUN,<ms>` is a candidate native
  stun (`bench-firmware-levers-2026-09-19.md` §4); enemy 35 and ally 34 are levers §10, and ally 31 and 32 are levers §19 step 3.
  `trigger` (bench 1.5).
- **Explained 2026-09-11 (F23):** the 2026-08-27 24-cell ×1.0 matrix was the GUN BODY (always ×1); the ×1.25/×2
  runs measured the HEADSET. Different sensors, both correct. Kept: one 16/16 vs 4/10 registration run under
  identical geometry (2026-09-02).

## 9. Needs Tony at the bench (merged from bench-tomorrow.md + unknowns.md, 2026-09-06)

**The running order is [`bench-plan.md`](bench-plan.md)** (2026-09-18). The method of the older rungs is in
[`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md) — the same items
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

**B4 link watchdog** (one gun, a real drop; `bench`):
- **F164 🟠 A reconcile hands out a FREE FULL MAGAZINE, on any reconcile.** `engine.js` `_endReconcile()`
  re-arms both slots from `frames.spawn`'s `$AMMO` — the SPAWN magazine plus the spawn reserve — whatever
  the reconcile was. So even a genuine BLE drop mid-firefight (and F163's watchdog, if it is ever turned
  on) refills a player who was one round from empty: exactly the resume-gap cheat `RESUME_GAP_MS` exists
  to deny, arriving through the door beside it. It should re-arm from the LAST-KNOWN LIVE counts (the
  `$ALCD`/`$LCD` the phone already tracks) and fall back to the spawn frame only when it has never seen a
  count this life. Pre-existing S7.1 behaviour, found by the round-2 review of the 2026-09-12 field
  branch; separate from F163 and not fixed in that pass.

**A17 hit audio** (one gun, our compiled game, an armoured life; `ears` + `trigger`):
- **F39 🟡 The real `$SIR` row ceiling.** "Max 14 distinct IR recognitions per game" is a community figure we have
  never measured; `hitaudio.MAX_SIR_ROWS` treats it as a soft budget. Push a 20-row table and check every row still
  registers. Gates `hit_audio_rekey`, which is DEFAULT OFF. Lower value now that F38 has ruled the class layer off
  by default — the rekey only matters if we ever choose per-weapon audio over per-pool.
  **→ 2026-09-18:** eleven rows are proven (the F254 archive line: the `$SIR` table takes eleven rows). Left: a 20-row
  table, `bench-firmware-levers-2026-09-19.md` §19 step 11.
- **F68 🟡 A MISS PERMANENTLY KILLS THE HEADSET TEAM COLOUR.** Bench-observed 2026-09-09, Tony watching a gun painted
  blue: a magnitude-0 word makes the headset **flash green exactly like a hit and then go dark, and it stays dark**. Same
  mechanism as the 2026-09-03 "a registered hit WIPES the headset" finding -- but a miss emits **no `$HIR` and no `$HP`**
  (F46), and our repaint lives inside the `dmg > 0` branch of the `$HIR` handler (`engine.js`, mirrored in `stage.py`), so the node never
  learns and never repaints. **Consequence: the first miss of a life removes that player's team identity until the next
  real hit or respawn** -- and A16.4 deliberately rests the GUN body on team colour for exactly the identity reason the
  headset just lost. Invisible today only because misses cannot happen at stock 100/100, so this ships the moment S17
  does. Fix needs a trigger that does not depend on damage: the node cannot see the miss at all, so either repaint on a
  timer/heartbeat while alive, or accept a dark headset and move team identity entirely to the gun body. **Also worth
  knowing for gameplay: a miss is VISUALLY IDENTICAL to a hit** (same green flash), so no observer can tell them apart. **→ 2026-09-17: BUILT** (commit 76ad3764): `tick()` repaints the team colour
  every 5 s while the player is alive (`app/test/engine.test.mjs`, the F68 test). Left: `stage.py` does not mirror it
  (`test_stage_mirror.py` pins `_teamRepaintTick` as unmirrored), and one eyes check on a gun. `build` + `eyes`.
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
- **F99 🟢 AN M5STACK STATION IS THE IR↔BLE BRIDGE.** ⚠ **2026-09-18: (a) below is stale.** `$LIFE` fills the
  shield over BLE (2026-09-11, F109), so a station is no longer the only way to grant a shield; (b) stands. Tony's
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
- **F107 🟢 LOWS FROM THE 2026-09-11 (LATE, SECOND SESSION) POLISH LOOP.** Noted, not fixed: (a) `net.py _fire_node` never forwards `gun_fw` while `_on_node` copies a `fw` key that never arrives (the `app_ver` shape again); (b) `_role_due` is not cleared on end/recall/panic (the phase gate in `_push_role` covers it); session.json `v` stays 1 though the shape gained `stations`/`game_no`; (c) F57 suppresses the grunt even when the profile writes no `hurt` line (announcer off, pre-A15 bundle): one fully silent hit per life there; (d) a reload pull while stunned starts the HUD RELOADING takeover off the frozen pre-stun reserve; (e) the stage logs a `warn` on every EMP because no profile carries `stunned`/`stun_over` cues (the phone is silent) — **candidates surfaced 2026-09-11 (evening) from the S1 `fx:hit` pass: H20/H21, "hit then electrical pulse, could be EMP disable"** — not auditioned in context, just noted while auditing the wider `fx:hit` batch; (f) `utility.js` `?stage` persists `settings.mc = 'stage://mc'`; (g) `Recap.tsx STATION_TID_NAME` duplicates `Items.tsx TID_NAME`; `types.py Stun.duration_s` is `int` while the validator accepts a float; contracts §10 rows A18-A20 sit above A1; CLAUDE.md still says amendments A1-A14; (h) E1 leftovers: no Designer editor for `mode_params` (not even read-only) and no phone-side consumer; (i) A19 leftovers: `beacon` / `extracted` have no MC-side signal (see S10); (j) `_endReconcile` re-arms with the frame's `$AMMO` but leaves `_prevAmmo`/`_prevReserve` at the pre-drop pair, so a stun before the next `$ALCD` restores the older (lower) pair -- never a refill, same shape on the stage; (k) `restore_snapshot` resets an out-of-range stored `mode_params` value to its default with no log line; (l) the `role: utility` status from a bound player logs once per heartbeat. `build`.

- **F231 🔴 `$WEAP` TOKEN 2 IS `gunRangeOutdoor`, THE RANGE CONTROL, AND NOTHING SHIPS IT.** ⚠️ **2026-09-18: t2 sets the emitter's CARRIER FREQUENCY, not its power** (V4_31 disassembly, `protocol/brx-protocol.md`). Every number below stands; what they prove changes. A low value detunes the word out of the receiver's band-pass near 38 kHz instead of shortening the beam, so the shelf is the pass-band and the knee is a receiver property. Calibrate in kHz, not as a percentage ladder, and see `docs/weapon-design.md` §4.2 for what that does to the shipped table. Garden 2026-09-17, outdoor mode, `$GSET` t2=0: t2=5 landed **0 of 38** shots (15 at 3 m, 23 with the muzzle on the dome); t2=100 is the stock value and reaches 200 ft. Ladder between: 13 → 3/8 at 15 m on precise aim, 25 → 15/32 at 10 m, 32 → 15/32 at 10 m, 50 → 11/11 at 3 m, 21/23 at 10 m, 100% at 20 m, 90%+ at 30 m, ~33% at 40 m. Shape: a floor where nothing arrives at any distance, a transition roughly **13–26**, then a flat shelf from ~31 to 100 where every value behaves the same at any distance we can pace out. ⚠️ **THIS ROW CONTRADICTS ITS OWN DATA and the re-run must settle it:** t2=32 landed 15/32 at 10 m, IDENTICAL to t2=25, while t2=50 landed 21/23 at 10 m and 100% at 20 m. On those three points the shelf starts somewhere between 32 and 50, NOT at 31, and 32 still behaves like the transition. Do not set a weapon near 31 on the strength of the summary sentence. Position derived from the APK field order (`callsign-extract/protocol-classes.md`: `slotType, iRSource, gunRangeOutdoor, primaryDamageType, …`) against the bench anchors t5=damage and t14=fire-rate; `weapmap.py` calls t2 `(scale/const)` because both derivation frames held it constant. The shipped catalogue proves it is a live field: **every gun 100, melee 90**. ✅ done 2026-09-17 (this lane): t2 is promoted to `docs/manual/dev.md` beside the t41 row, named in `weapmap.py` FIELDS, and `mc/compile.py` now drives t2 from `wire.range_outdoor_pct` (F234 closed). Still open: whether t2 fences a weapon to a distance above the shelf, and the shaded indoor/outdoor re-run below. ⚠ **Every number above was shot into a dome in DIRECT SUN with the light moving, and the misses came in streaks of 5-6** — re-run the ladder shaded before shipping a value. Next step: `bench-firmware-levers-2026-09-19.md` §20 (measure the carrier at t2 = 100, 75, 50 and 13). `bench` + `build`.
- **F232 🔴 THE FIRST TWO TRIGGER PULLS ARE WEAKER THAN THE REST.** Tony, unprompted and repeatedly, 2026-09-17: "first two trigger pulls will usually not have the power and then 3+ have better chance of hitting." Every group in the F231 ladder was 5 or 10 rounds, so the first two of every group were handicapped — which inflates the miss rate everywhere and bites hardest at low t2, where a weak shot falls under the receiver threshold instead of merely being weaker. Probable cause of "16/32 then 0/32 at the same mark, one mag apart". **This invalidates short-group sampling for any IR-power work.** Probe: same value, same mark, 10 shots at 2 s spacing vs 10 as fast as the trigger allows; and groups of 4 with 10 s between, checking whether misses cluster on shots 1-2. Then re-run F231 with full 32-round mags, discarding the first two. `bench`.
- **F233 🟡 THE GUN HOLDS AT LEAST FOUR `$WEAP` SLOTS BUT ALT ONLY CYCLES TWO.** Bench 2026-09-17: `$WEAP,0..3` each acked with its own `$ALCD` and took an independent `$AMMO`; the ALT button toggles slots 0 and 1 only, so 2 and 3 are configured and unreachable. Callsign only ever used two. Worth knowing for (a) a four-weapon loadout and (b) bench A/B work — four configs per walk instead of two, if a `$BMAP` can be found that selects a slot directly. Next step (2026-09-18): `bench-firmware-levers-2026-09-19.md` §19 step 6 (a four-entry ALT cycle from `$BMAP` tokens 3-6). `bench` + `build`.
- **F249 🟡 `connect()` REFUSES TO RE-OPEN AN ALIAS WHOSE LINK HAS DROPPED.** The brx MCP answers "alias already connected", and the next write fails with "Service Discovery has not been performed yet". `disconnect` then `connect` is the workaround, and it cost several minutes across the 2026-09-17 weapons bench. Make `connect` reconnect a dead alias in place. Filed out of F234, which had carried two unrelated items. `build`.
- **F250 🟢 THE NIGHT SKIN SHOWS NO AMMO GAUGE ON A PIP WEAPON.** `app/www/index.html` hides discrete pips at night (`[data-env="night"] .pips > i{display:none}`) and styles a thin bar in their place, but a pip weapon has no bar, so a Rail Gun or a sniper rifle shows the number alone at night. Found 2026-09-17 while fixing F248; it is older than the night skin work and it is the same on every pip weapon. Decide at the bench whether night should keep dim pips, draw the thin bar for pip weapons too, or stand on the number. `eyes` + `build`.
- **F251 🟡 THREE FAKES IMPLEMENT THE NODE HANDSHAKE AND NOTHING COMPARES THEM.** `mcp/brx_mcp/mc/fakes.py` (`FakeNet`, callbacks direct), `mcp/brx_mcp/mc/mock_node.py` (`MockNode`, real envelopes) and `webapp/mc/src/mock/backend.ts` (the whole kit → lobby → armed → live → recap machine, in TypeScript) each implement the same handshake. `test_contract_generated.py` pins the wire SHAPES only, never the behaviour, and two of the three carry a comment claiming they mirror the server with no tool behind the word. `fakes.py` already records the cost: "A FakeNet that does not mirror the real one is how F106(b) hid for a month." Fix: one short list of node-protocol invariants asserted in both languages, so a change to one forces the other's test. DRY review 2026-09-17. `build`.
- **F252 🟢 TWO `parse_query()` FUNCTIONS READ THE SAME TEENSY DUMP AND RETURN DIFFERENT SHAPES.** `mcp/brx_mcp/protocol.py` returns 8 fields with `pcb_rev` as `"PCB-123"`; `mcp/brx_mcp/usbconsole.py` returns 20 fields with `pcb` as `123`. Same name, same input, different callers, so the name implies they are interchangeable and they are not. Rename one. DRY review 2026-09-17. `build`.
- **F256 🟠 "FULL COVERAGE" CLAIMS A RESILIENCE THE PHONES DO NOT HAVE.** Bench 2026-09-18, Tony: both phones were on WiFi with no SIM, joined through the cloudflared URL, and the board read **FULL COVERAGE, 2 OF 2 ON THE INTERNET PATH**. `Session.coverage()` counts a node as covered when `reach == "backhaul"`, and `reach` only says **which URL the phone joined through**, never what that phone is riding. Two phones on one WiFi, both leaving through the same tunnel, are a single point of failure, and the operator is told they are covered. The line is the one an operator reads before deciding the LAN can die. Fix, in order of honesty: have the node report its own transport (Capacitor's Network API gives `wifi` / `cellular`) and count only an INDEPENDENT transport as coverage; or, until it does, stop the copy claiming coverage and say plainly how many phones joined through the tunnel. A28.4 derived coverage rather than asserting it, which was right, but it derived it from the wrong fact. `build`.
- **F257 🔴 THE HUD CALLS A CHARGE WEAPON "OUT OF ENERGY" WHILE IT CAN STILL FIRE.** Bench 2026-09-18, Tony, charge rifle at **7 of 40 with no reserve**: the HUD showed the big **OUT OF ENERGY** prompt AND the small **NOT ENOUGH ENERGY** note together, over a gauge reading 20%, and **the gun fired a tap perfectly well**. A charge weapon with a tap magnitude (`t37`) can always spend single rounds; what it cannot do is pay `rounds_per_charge` for a FULL charge. `hud.js` `energyOut` = below a charge AND no reserve, which it reads as a dead end and is not one. Three faults in one state: the copy contradicts the gauge, it contradicts the gun, and two prompts say nearly the same thing at once. Fix: `OUT OF ENERGY` only when the cell is truly empty (`ammo === 0`) with no reserve; below a charge with taps available says so and nothing more; never show the big prompt and the note together. `build` + `eyes`.
- **F261 🔴 A FRESH MISSION CONTROL NEVER OFFERS TO ADOPT A RUNNING MATCH, WHICH IS THE CASE ADOPT EXISTS FOR.** Bench 2026-09-18, the adopt half of F236: MC was stopped mid-match, its session file was moved aside, and it was restarted, which is the field case of Mission Control coming up on a DIFFERENT laptop. The phones carried on: one reported `phase: live`, `match_id: 0530ad9415`, `ws: bound`, so it was connected to the new MC and sending status. MC showed `phase: muster`, 0 players, both nodes present and `arm_state: live`, and **`orphan_match: None`**. Cause, in `state.py _note_orphan`: the check opens `if (nid in self.node_player and arm in ("armed", "live") ...)`, so a node must already be BOUND to a player for its match to be noticed. A fresh MC has no roster, nothing is bound, and the orphan is dropped on every heartbeat. The binding is exactly what a fresh MC cannot have, so the guard excludes the one scenario the feature was built for; the snapshot path (F236) works and hides this, because there the roster comes back with the session. **An unbound phone shouting LIVE in a match nobody started is MORE interesting than a bound one, not less.** Fix: record the orphan regardless of binding, and let adopting it create the binding. `build` + `bench`.
- **F265 🔴 A BOUND PHONE'S SCOREBOARD FREEZES, AND THE HUD LABELS IT LIVE.** Bench 2026-09-18, mid-match. Tony covered the other gun's sensor and emptied a magazine, so zero hits landed, and said "the acc in hud never changed". It had not changed because **nothing on that board had**: the phone's score snapshot was **161 s old** while `wsState` read `bound`. Phone held `shots 292, hits 50, accuracy 17.1`; MC's live row at the same moment held `shots 452, hits 50, accuracy 11.1`. Same match, same player, 160 shots apart. ⚠ **The label makes it worse:** `hud.js _boardAge()` returns `LIVE` whenever `wsState === 'bound'`, so the overlay presents a two-and-a-half-minute-old board as current. The design (A26, and the comment on `_boardAge`) is that MC pushes every change to a bound phone and the age label only matters off the link, so either the push stopped or the phone stopped applying it, and the honest label would have shown the age instead of claiming LIVE. Two fixes, and both are wanted: find why a bound phone stops receiving score pushes, and **never print LIVE on a snapshot older than a few seconds** regardless of what the socket says. Found because a player asked why a statistic did not move. ⚠ **A second cause landed on the same number and is now fixed:** every recoil `$WEAP` reset the magazine, and `_onAmmo` booked that reset as a 26-round decrement, so `this.shots` gained ~26 phantom rounds per write. Tony's 452 shots for 50 hits was inflated by our own writes, which is why the accuracy read so low as well as so still. The echo guard now returns "book nothing" for a frame that is our own write coming back, which fixes the gauge, the pip count, the low-ammo warning, the shot count, the try-out arming confirmation and the resync evidence at once, since all six read the same delta. **This row's own finding stands**: the board was 161 s stale with the socket bound and the overlay still said LIVE. `build`.
- **F266 🟡 ON A SLOW LINK THE NODE CANNOT TELL A REAL ROUND FROM ITS OWN WRITE COMING BACK.** Recorded 2026-09-18 as a known limitation, with the machinery for it deliberately NOT shipped. A round that leaves the gun INSIDE the accuracy write's echo window is not booked, because its `$ALCD` still reads above the number we wrote and cannot be distinguished from the reset. At the measured write latency of 30 to 90 ms the window is narrower than a weapon's fire interval, so it never happens and both the shot count and the displayed ammo are exact on the bench. The lane built a carry-and-book-at-close mechanism for it, found it **unexercised at real latency and WRONG at 150 ms** (it over-counted by two, because the window closes on the first real round before the write has landed), and deleted it rather than carry unverified code that is wrong in the regime it exists for. The limitation is commented at `_acctAmmo`. If a field link ever gets slow enough to matter, this is the row. `build` when a real link proves it.
- **F267 🟡 A TRIGGER PRESS THE GUN NEVER ANSWERS IS NEVER CLEARED OFF THE SHOT ACCOUNT.** Filed 2026-09-18 by the recoil lane, from reading the code rather than from a gun. `_acctPress` books a round on every `$BUT,0,1` and the only line that gives one back fires on a confirmed magazine DROP, so a press the gun answers with a rise, or does not answer at all, leaves the count standing. `_acctLive` then reads the magazine short for `TRIGGER_NO_FIRE_MS`, and each expiry admits exactly one more press, which re-arms the stale count and restamps the clock. Two consequences, both stacked on the same stale number: `shotInFlight` parks the accuracy writer for as long as the player keeps pulling, and a stun or an operator RESYNC GUN landing inside that window writes the short count to the gun, which at the cap is `$AMMO,<slot>,0` on a loaded weapon. ⚠ **It needs a gun to say whether the sequence happens at all**, because it depends on the gun answering a press with something other than a decrement. Five shipping weapons hold a 2-round magazine, so they reach the cap in two presses. Pre-existing, not from the two-step recoil. `build` + `bench`.
- **F268 🟡 THE TWO-STEP RECOIL LADDER SHIPS TWO JUDGEMENTS, AND ONE MAGAZINE ANSWERS BOTH.** Filed 2026-09-18 with the F259 second step. The shipped table raises three floors to 60 (SMG and Suppressor from 55, Stinger from 45) on the reading that a weapon landing 39% of its rounds is removed from the fight rather than penalised, and it sets `after_heavy` at twice `after_shots` on no evidence at all, only on what the two stages mean. Both are marked as judgements in `spec/node.md` §3.15 rather than dressed as measurements. **The bench gate:** one magazine of full auto at accuracy 60 against a static target, then another at 55, counting `$HIR` each time. If 55 is playable the floors go back down; if the 60 run already feels punishing, the second rung wants a longer fuse than double. Run it after `bench-firmware-levers-2026-09-19.md` §21, which may move the ladder onto `$TMP` t4. `bench`.
- **S55 🟠 ONE ACCURACY OWNER ON THE NODE, AND A HUD PILL THAT SAYS WHY YOU CANNOT HIT ANYTHING.** Tony 2026-09-18, after asking for a recoil/flinch/movement bench: "We will want a hud indicator for low accuracy and for why. In all of those cases." **Four things will want to degrade accuracy**: recoil (S42, shipped), flinch (unbuilt), stance and movement (unbuilt), and the smoke effect `$SIR` fn 23 (an ENEMY doing it to you, S53). They all land on one field, `$TMP` t4 if levers sheet §21 holds, and fn 23 already writes -100 there with a recovery timer. ⚠ **The wire cannot tell the causes apart.** `$ALCD` token 2 is the gun's LIVE accuracy, so if t4 is additive the node reads a SUM and can never attribute it from the frame. **So attribution must come from the node's own model, and the node has every input it needs**: it owns the recoil state machine, it sees the `$HIR` that caused a flinch, it holds the phone's own IMU for stance (the phone rides the Picatinny rail, so movement is PHONE-SIDE and costs nothing on the wire, confirmed with Tony 2026-09-18), and a `$HIR` that moves no pool while accuracy falls is the smoke tell S53 already names. That makes ONE component the answer to two separate problems: a single owner that computes the accuracy value, is the only writer of the field, and carries the REASON alongside the number. The HUD then renders the reason it is handed rather than guessing. **This is the same component §21 forces on us if the gun turns out to be last-writer-wins**, so it is worth building whichever way that bench lands. Do: the owner on the node, the reason in the status the HUD already receives, and one pill with a cause and a visible recovery, since a player looking down the sights will not read a sentence. Folds S53 in as the fn 23 case. ⚠ **Not to be built before §21 reports**: whether the effects stack, whether a directly written t4 self-decays the way fn 23's does, and whether a `$WEAP` push clears it all change the owner's shape. `build` + `decision`.
- **S54 🟡 THE CATALOGUE DOES NOT CARRY THE RECOIL FIELDS IT NOW NEEDS.** Filed 2026-09-18. `weapons.json` and the `Recoil` TypedDict in `mc/types.py` still hold only `{ceiling, floor, per_shot, recover_ms}`, so every weapon runs on the engine's derivation and no row can state its own ladder. Adoption is one commit: all six fields (`crisp`, `degraded`, `heavy`, `after_shots`, `after_heavy`, `settle_ms`) into `types.py`, a contract regeneration, `heavy` added to the dominance axis list, and the per-weapon rows that want to differ from the derivation. Until then the derivation IS the design, which is fine as long as nobody edits `weapons.json` expecting it to be read. `build`.
- **F264 🔴 A PLAYER CAN BE DEAD ON THE GUN AND ALIVE ON THE HUD, AND NOTHING SELF-HEALS IT.** Bench 2026-09-18, mid-match, Tony: "I'm dead and i didnt respawn", then "hud thinks im alive, headset flashing like im dead. nothing on trigger". The phone read `alive: true, hp: 45, armor: 6` while the gun was dead and refusing the trigger, so the killing blow's `$HP` never reached the node (the armour value shows the hits before it did arrive). **The detection worked**: MC showed `pool_stale: no_fire` on that gun, which is A45 doing exactly its job. **Nothing acted on it.** The player stood there until an operator pressed something, which in a real game is a player out of the match for as long as it takes someone to notice. ⚠ **A resync alone did not cure it**: one ran at t=71 s and the player was still dead; at t=97 s a second resync and a force respawn landed in the same second and he came back, so the respawn is the probable cure but the two cannot be told apart from the feed. The question this raises is the product one: **when the node has already concluded `no_fire`, should it cure itself** (re-arm, or ask MC to) rather than wait for a human? A45 was built to make the state visible; this says visible is not enough. `build` + `decision`. **→ LOG SCAN 2026-09-18 (2,385 session databases, 650 lives reconstructed).** The detector is `ammo` AND `shots` frozen together across at least 8 consecutive `status` envelopes over 40 s while `preflight.gun_linked` stays true: 89 stalls, but only **2 are this bug**, both in match `b5c11ab450` on the same node tonight. The rest classify as the gun resuming by itself (28, nearly all a player simply not shooting), an ordinary respawn (4), a `hit_taken` or `death` arriving (16, so the gun was still reporting and it was never this), or the match ending (39). ⚠ **The spawn-protection theory is DEAD, and the control is what killed it.** 35 of 89 stalls began within 6 s of a spawn, which looks damning until you notice a respawn resets `ammo` and `shots` cannot move before the first shot, so a frozen run begins at EVERY spawn by construction; 13 of those self-resumed. The two proven cases sit at 4.6 s and 365.6 s after spawn, so our own arming writes are not the trigger either. **The cure is known and it is one frame.** A resync writes 3 frames plus an 11-frame `$SIR` re-arm and did NOT restart the gun; the force respawn wrote the same 14 and then a 17-frame revive head carrying **`$SPAWN`**, and the gun answered instantly (`tx $SPAWN` → `tx $PLAYX,0` → `tx $STOP` → `rx $LCD,45,70,0,0,32,192`). So `$SIR` writes do not restart a gun in this state and `$SPAWN` does, which is exactly what a stock tagger does when it is in its own dead state. ⚠ **CORRECTION to the first reading of this scan: the gun's outbound stream does NOT stop.** `status.battery` is fed only by `$VOLTS`, which measures at a 60.1 s cadence (n=162), and it kept arriving THROUGH the stalls: 63 → 64 sixty-four seconds into the first, and 94 → 95 twenty-eight seconds into the 2026-09-12 candidate. What stops is the shot and pool path alone, `$ALCD` / `$LCD` / `$HP`. The gun is powered, linked and still chatting; it has simply left the state our writes assume. Two consequences. A "gun has gone quiet" watchdog can never fire on this fault, so `GUN_QUIET_STALE_MS` (185 s) is dead code for it and `no_fire` is the only working detector, which needs the player to pull the trigger three times. And `$VOLTS` continuity is a free discriminator worth recording: a stall with `$VOLTS` still ticking is a dead gun, a stall with everything stopped is a link problem. **The design hole underneath:** the node has ONE death path, `$HP` with health `=== 0` (`engine.js:2490`, `:3363`, `:4074`), and no backstop, so a gun-side death that never puts a zero in that field is invisible for the rest of the life and no retry can help, because there is nothing to retry. The proposed fix follows from both: when A45 has already concluded `no_fire`, the node should send the REVIVE head, not a `$SIR` resync. ⚠ **The two proven stalls may not be one bug**: the first froze at `ammo 32 / shots 0` 0.6 s after a 64-damage hit with `pool_stale: no_fire`; the second froze at `ammo 0 / shots 714` with no hit at all, 45 s after a `reload partial: 0 → 12 of 32 (timeout)`, which reads as a lost reload on an empty magazine. If the second reproduces it splits into its own row. **Coverage limit that decides the next step:** `pool_stale`, `pool_src` and `operator_result` exist only in the 2026-09-18 builds, and the phone keeps only the last 60 BLE frames, dumped at recap, so no field day can ever be promoted from this data. The next move is LOGGING, not more analysis, and three changes would settle it in one evening: make the frame ring time-based (5 minutes, not 60 frames, which is about 9 s) and upload it on the `no_fire` edge rather than only at recap; emit `pool_stale` as its own envelope so MC has a timestamped record it can act on; and log every trigger pull and its answer, so a frozen life can be told from an idle one afterwards. Of the eleven 2026-09-12 candidates, four self-resumed, one had the gun demonstrably alive and six are unresolved: not one can be confirmed or cleared, so treat the detector as WEAK rather than the fault as rare. **Bench:** `bench-firmware-levers-2026-09-19.md` §22, the dead-gun probe (session 1), tests whether a dead gun answers `$QUERY` and a bare `$LIFE` with positive evidence.
- **F262 🟡 THE GUN'S NATIVE SHIELD-HIT SOUND IS WRONG SOMETIMES.** (Filed as F260 and renumbered the same day: main took F260 for the accuracy over-report, and an id is never reused.) Bench 2026-09-18, Tony, stripping a 120 shield 20 at a time: "it played the wrong shield hit sound sometimes". The `$HIR` trace for that run shows the shots landed on TWO different sensors, some on the headset (token 1 = 0) and some on the gun body (token 1 = 4), so the suspicion is that the native sound tracks the SENSOR struck rather than which pool absorbed the hit. The shield hum and the shield-hit sound are native and we do not write them (S45), so if this is real the fix is either a `$SIR` row per sensor or a node-played cue over the top. Cheap to settle: fire ten shots at the headset alone, then ten at the gun body alone, with a shield up, and listen. `bench` + `ears`.
- **F171 🟠 Needs Tony at the bench** quantify the indoor/outdoor AIM TOLERANCE in a real angle. Measured 2026-09-13 at
  ~200 ft on a red dot: indoor tolerates ~1.5 dot-widths off centre, outdoor ~3. Roughly DOUBLE, on three guns. The
  toggle reads as a BEAM-WIDTH control at the muzzle, not as a `$WEAP` range control. **2026-09-18 gives it a
  mechanism**: the V4_31 trace shows the indoor/outdoor level alone sets the emitter's PWM duty, about 20% indoors and
  38% outdoors, so the toggle DOES move emitted power even though `$WEAP` t2 does not. Needs F195 to convert
  dot-widths to degrees. `bench`.
- **F195 🟡 Needs Tony at the bench** record the stock BRX Pro sight's dot angular size (MOA). Nothing in `docs/manual/`
  or `hardware/` has it. Needs the sight and a tape measure at a known distance, NOT a range session. `hardware`.
- **F167 🟡 Needs Tony at the bench** does the gun clamp an fn 9-22 `$SIR` armour grant at the `$PSET` ceiling? Decides
  whether armour above the compiled ceiling is provable again (red) instead of an amber advisory. `trigger`.
- **F168 🟡 Needs Tony at the bench** measure the pool settle window. 2 s is reasoned; the real store shows a
  body-armour pool landing at exactly +2.0 s, i.e. on the boundary. `trigger`.
- **F169 🟡 Needs Tony at the bench** Run D: does a gun emit anything when ALT is pressed during the native
  configuration step at power-on? If yes the venue reminder becomes a real per-gun readiness check instead of a
  prompt. Demoted 2026-09-13: the toggle is no longer a range suspect. `capture`.
- **F183 🟠 Needs Tony at the bench** confirm the START fan-out change: arm a match with phones connected and confirm
  every gun spawns at T-0. Delivery moved from a broadcast to addressed sends over the node registry (A40). `trigger`.

- **F172 🟡** `?mock` `patchPlayer` has no armed/live team-change refusal, so the demo permits what the server 409s. `build`.
- **F173 🟡** the diagnostic HTTP route shares the store's single sqlite connection through the executor. `build`.
- **F174 🟡** the diagnostic 409s during ARMED, blocking a read of the PREVIOUS match once the next is on the runway. `build`.
- **F175 🟡** the diagnostic attributes a node re-bound mid-match to the LAST binding's player. `build`.
- **F176 🟡** a gun echoing the same wrong magazine every time has only RE-PUSH or STANDBY as an exit; decide whether a
  repeat mismatch should decay to an advisory. `decision`.
- **F177 🟡** a mode switch re-teams by INDEX and rebalances only when a side would be EMPTY, so an uneven roster can
  land 7/1. Decide whether it should balance evenly; the confirm now shows the split either way. `decision`.
- **F178 🟡** the READY count can include a phone holding an older head; START still refuses via the stale-ack gate. `build`.
- **F179 🟡** two guards assert behaviour by grepping source text (`lobby-standby.test.tsx`, `tapgate.test.mjs`). `build`.
- **F180 🟡** the HUD screen-truth standby steps run only under `ui:screens`, never under `npm test`. `build`.
- **F181 🟡** `m2-ui` has a timing-dependent live-accuracy-settling assertion that flaked once. `build`.
- **F182 🟠** validation wall-clock is too long to iterate against (Tony, 2026-09-13). Wants a fast inner loop with the
  full run kept as the merge gate. `build`.
- **F184 🟡** a released station's entry is never removed when the phone re-hellos as a plain HUD, so ITEMS shows it
  OUT OF WI-FI until CLEAR. Pre-existing; `clear_station` does not delete the entry either. `build`.
- **F185 🟡** the LIVE-board end-delivery notice is proven in jsdom only; after the whistle MATCH renders RECAP. `build`.
- **F186 🟡** `recall`/`panic` are deliberately unwatched by end-delivery; decide if a recall should be confirmed. `decision`.
- **F187 🟡** the end-delivery ladder is ~137 s, then the A34 reconcile is the long tail; a phone returning after the
  match is evicted gets nothing. Untested at that boundary. `build`.
- **F188 🟡** Designer's PLAY THIS NOW jumps to KIT without loading, landing on "NOT LOADED YET". `build`.
- **F189 🟡** `kit-continue.mjs` hardcodes `.venv/bin/python` and needs `MC_PY` in a worktree. `build`.
- **F190 🟡** `LoadStatus` counts acks by `ok` while `pushGate` uses the stricter config-id-current test; unify. `build`.
- **F191 🟡** should a standing WSL banner displace other alerts in the shared header? Fixed in the e2e boots, not in
  `CommandBar`. A product decision; low field risk. `decision`.
- **F192 🟡** PRE-EXISTING, reproduced on unmodified main: the session reads its net join info at construction, before
  the net starts, so any `--fake-net` run leaves the advertised URL and QR stale for the whole run. `build`.
- **F193 🟡** the mock's WSL warning string is a hand-kept copy with no test pinning it to the server's. `build`.
- **F196 🟠** `test_amendment_citations` cannot see SCREAMING_CASE or CamelCase symbols, and its searched directories
  exclude `mcp/tests`, so those citations are silently skipped. Worse, it only checks that cited symbols EXIST, never
  that an amendment's citations name THAT amendment, so it could not have caught the 2026-09-13 A41→A42 renumbering in
  either direction. Add the shapes AND a renumbering check, each proven by a deliberately broken case. `build`.
- **F198 🔴 Needs Tony at the bench** the reflection theory behind `$GSET` t2 is untested and may INVERT the
  current fix. Reading: low sensitivity (t2=1) may be deliberate for INDOOR play, rejecting bounced/reflected
  shots off walls and ceilings, in which case the right end state is `indoor -> t2=1, outdoor -> t2=0` — the
  opposite of what shipped. Test: play indoors at t2=0 (today's pinned value) and look for phantom hits (no line
  of sight, or hits on players nobody aimed at). If they appear, invert the mapping; if not, leave t2 pinned at 0
  everywhere. (filed 2026-09-13 from archive/HANDOFF-gset-t2-2026-09-13.md §3) Next step (2026-09-18): the one-sided
  `$GSET` t2 test, `bench-firmware-levers-2026-09-19.md` §19 step 4. `bench`.
- **F202 🟡** the HUD has no way to change which tagger a phone owns. Only RELINK GUN and a reconnect pill exist,
  and both just reconnect the gun the phone already has (`brx.engine` -> `gun` in the saved blob); nothing in the
  UI clears it. Workaround: power the old tagger off so it stops advertising, forcing a fresh pick. (filed
  2026-09-13 from archive/HANDOFF-gset-t2-2026-09-13.md §3) `build`.
- **F203 🟠** a phone keeps its Mission Control address in TWO keys (`brx.mc_url`, `brx.pub_url`), and an
  unreachable one survives an app upgrade. Both phones in the field 2026-09-13 held a stale WSL NAT address
  neither could reach, and had silently fallen back to sweeping whole subnets. The boot warning shipped the same
  day tells the OPERATOR the server is advertising something unreachable, but it cannot clear a bad address a
  PHONE has already saved. (filed 2026-09-13 from archive/HANDOFF-gset-t2-2026-09-13.md §3) `build`. **→ SECOND FIELD SIGHTING 2026-09-13 evening:** a phone opened the session on a remembered `ws://192.168.0.55:8766/ws`, failed five reconnects and a `no welcome within 10000 ms` over 14 s, and was rescued only by a QR scan to `…0.171`. `game-test-2026-09-13.md` C3.
- **F204 🟢** nothing on the wire reports headset battery level or link quality. Checked 2026-09-13: no protocol
  field carries it, and the phone exposes no headset health of any kind. A weak or dying headset can only be
  observed by a player, never measured or surfaced by MC. (filed 2026-09-13 from archive/HANDOFF-gset-t2-2026-09-13.md §3)
  `build`.
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
  cadence not at all (102.0 ms/round owned vs 101.6 enemy-held, control inside the measurement, bench-queue BQ-D7).
  ⚠ Hosted-only — a native game drops the BLE link, so this does not disprove a native buff. **And the firmware
  cannot be made to grant it either:** every hill word lands in the single `$SIR` cell `<15,0>`, so an
  ally-polarity grant at `$GSET` t1 = 0 would gate on the owner correctly and go **blind to enemy-held hills**
  (rejected words emit no `$HIR`, so capture detection dies), while t1 = 1 lifts the gate and the grant fires on
  ANY beacon, boosting a player standing in an ENEMY hill. **One cell cannot both read every owner and grant only
  to the owner** — so read with fn 28 at t1 = 1 and apply the boost node-side. ⚠ Whether any ally function buffs
  RoF at all is UNMEASURED (fn 31/32/34 unswept, bench-queue BQ-D6); the conflict stands either way.
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
  off a real beacon). Design: `docs/utility-roadmap.md` "Rewarding the holder". **→ 2026-09-18, a second lever:**
  V4_30 reads `$TMP` t5 as a fire-interval percentage with a 65 ms floor and no magazine reset, and the stock hill
  buff writes it; `bench-firmware-levers-2026-09-19.md` §21 traces it. `build` + `bench`.
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
- **F275 🔴 AT WHAT `t13` VALUE DOES THE HEADSET WORD (t12) STOP ARRIVING? IT UNLOCKS THE WHOLE CLOSE-RANGE
  WEAPON CLASS.** 2026-09-18: the Shotgun/Plasma Sniper/Rocket Launcher's second IR word ships with
  `t13`/`t42` locked at 100, F231's flat measured shelf, so it lands at every range today, not a short one.
  **Why this is now the highest-value bench item we hold.** An audit of every weapon's `range_outdoor_pct`
  against F231 shows our range BANDS are decorative: everything set between 55 and 100 sits on the flat shelf
  and reaches the same distance, so `mid`, `long` and `close` do not differ in play. The only three weapons the
  token affects are the SMG (30), Rocket Launcher (22) and Rail Gun (22), and it makes them UNRELIABLE, not
  short-ranged — about half their shots missing at 10 m, the same defect just repaired on the Shotgun (t2 22 →
  100). So `t2` cannot express a close-range weapon at all, and the headset word's own reach is the only range
  mechanic the hardware offers. A close-range weapon becomes one that carries most of its damage in that word:
  a Shotgun that kills in 3 up close and 6 at range, an SMG that mops at contact and tickles at distance, while
  the AR's 13 hits cost the same everywhere. That also dissolves the AMR-dominates-Shotgun dominance failure at
  source, by giving the Shotgun back the identity the t2 repair took away, rather than buying it off with a
  magazine buff. F231's ladder was shot against `t2` (`gunRangeOutdoor`), never `t13`, and its unstable 13-26
  transition band is unconfirmed for this token. **Run:** a shaded, F231-style re-run of the range ladder
  against `t13` specifically (same rig, same shading fix, same discard-the-first-two-pulls control, F232): set
  a Shotgun's `t13` to a few values, fire at a victim at 5 m and at 25 m, and find where the 20 stops arriving.
  ⚠️ **Needs outdoor space**; Tony 2026-09-18: "i have to go outside for it tho. wont be today". Cross-ref
  F231, F71. ⚠ **2026-09-18:** `t13` also sets a carrier frequency, not a power: 140 Hz per step on the headset
  (`protocol/brx-protocol.md` §6), so `t13` = 13 is 25.8 kHz. Read this run as a frequency ladder; see
  `bench-firmware-levers-2026-09-19.md` §20. `bench` + `space`.
- **F260 🟠 THE THREE TWO-WORD WEAPONS REPORT ROUGHLY DOUBLE ACCURACY IN THE RECAP.** Found by review 2026-09-18.
  The Shotgun, Plasma Sniper and Rocket Launcher carry `$WEAP` t1 = 2, so ONE trigger pull sends two IR words about
  88 ms apart (measured, cap30). The victim's gun emits an `$HIR` for each, the node turns each into a `hit_taken`
  fact, and `scoring.py` does `st.hits += 1` per fact. The denominator, `st.shots`, is the gun's OWN trigger-pull
  count off the status heartbeat, which increments once. So a Shotgun landing every pull on one target publishes
  **200% accuracy**. Damage is NOT affected: two real words, two real deductions, the health maths is right. This is
  the shots-landed statistic alone, surfaced in the recap and in `Recap.tsx`. **The fix is not obvious and that is
  why this is a row rather than a patch.** Deduping by (shooter, victim) inside a time window does not work on its
  own: the window would have to exceed 88 ms, and the AR (100 ms), SMG (95 ms) and Burst Rifle (75 ms) can all land
  two legitimate hits faster than that, so a blanket window would silently DELETE real hits from the weapons most
  players carry. The sensor does not separate them either (both words landed on sensor 4 in cap30), and neither does
  the magnitude once a weapon prices both words equally, as our Shotgun did at 20 and 20 until F276 moved it to 21 and 19. The workable shape:
  Mission Control compiled the loadout, so it knows which players carry a weapon declaring `wire.headset_dmg`, and
  can collapse a PAIR into one landed shot for those players only. Failing safe matters more than being clever here:
  over-reporting accuracy is ugly, deleting a real hit from an assault rifle is a wrong match result. ⚠️ **Every candidate fix has the same trap (playtest lane, 2026-09-18): it must NOT run on a SPAWN-PROTECTED player.** A protected player emits `$HIR` and moves no pool, so anything collapsing on hit COUNT rather than on damage would quietly change the number in the one case where nothing landed at all. **→ 2026-09-18 (F263, playtest lane): the frames were read and the answer is NO.** Protocol, shooter id, team and both trailing tokens are identical in both words; the SENSOR is geometry (the Shotgun's pair split 0 then 4, the Plasma Sniper's were 4 and 4); and the GAP VARIES (57, 88 and 119 ms across three pulls), which sits either side of the AR's 100 ms cycle and kills any fixed-window collapse outright. Magnitude differs only because the catalogue prices the two words differently, and ours priced the Shotgun's at 20 and 20, so even that was gone (since F276 it prices 21 and 19, and a catalogue guard refuses two equal words). **Decided: the NODE owns the collapse**, because a mid-life weapon swap is invisible to MC and obvious to the node. Collapse the shots-landed STATISTIC only: both words really land and really deduct, so the health maths must keep counting two. Original plan, now superseded: If any token separates the second word from the first (subtype, crit bit, anything), the victim's node collapses the pair alone and no loadout inference is needed. The playtest lane has both guns on BLE and is running it: one pull from a `t1 = 2` head, both `$HIR` verbatim, plus a `t1 = 0` control. Try the Plasma Sniper too: it ships 25 and 10, so its words differ in magnitude where the Shotgun's are both 20 -- if magnitude is the ONLY separator, never pricing two words equally becomes a catalogue constraint. If the frames are identical, the collapse must survive a mid-match weapon SWITCH, which MC's compiled loadout cannot see and the node can. `build`.
- **F66 🟡 `$SIR` fn 23: one mechanism with two symptoms, or two effects?** The 2026-08-27 row called it an audio
  suppressor on the strength of `$ALCD` token 2 dropping 100 → 0. Token 2 is now bench-proven to be **live accuracy**
  (F46), so that number never evidenced the audio claim at all. Both observations stand on their own: the gun **was heard**
  to go silent, and its accuracy **was measured** at 0 for ~6-8 s. What is gone is the belief that one reading demonstrated
  both. Re-run fn 23 and separate them: is the gun silent AND inaccurate, or did the silence have another cause? Note fn 23
  forces accuracy to literal 0, below whatever `t22` floor the weapon ships, which no normal firing walk can do -- so it is
  a genuine debuff primitive either way. **→ 2026-09-18 (perks bench):** the accuracy half is measured: one hit
  drops live accuracy 100 → 0 at once, no pool moves, the gun keeps firing and every shot misses, and it recovers in
  about 3 s. Only the audio half is left: `bench-firmware-levers-2026-09-19.md` §19 step 14. Folded in from B27: `sound.md` says fn 23
  mutes the victim's gun audio for 6 to 8 s, and this run confirms or corrects that page. `ears`.
- **F67 🟡 The three numbers F46 did not pin.** The accuracy model is proven and drivable; these calibrate it.
  **(a) The recovery rate.** A native time-based recovery races the per-shot drop: at t22=0, single shots ~2 s apart held a
  flat 80 forever while a held trigger reached 0 in eight rounds. Nobody has measured how long one step back up takes, and
  that number decides how long a burst pause has to be -- i.e. whether "fire in bursts" is real advice or theatre.
  **(b) The hit probability per accuracy value.** Misses are probabilistic, not a threshold (floor 50 gave 4 × `mag=0` to
  12 × `mag=9`; floor 0 gave 16 to 12), but those samples mix pre-floor and floored rounds. Clean probe: set **t21 = t22**
  (e.g. 50/50) so accuracy is pinned from the first shot with no drift, then count `mag=0` against total rounds over 3-4
  magazines. If accuracy is literally a percent-to-hit, the printed manual's per-weapon pairs (M-4 96/91, MG-7 66/45)
  become directly meaningful to us.
  **(c) The near-miss sound's rate gate.** Spaced misses play `missShotHit` every time; three back-to-back played it once.
  **→ 2026-09-17:** (a) and (b) are measured. Recovery runs at about one 10-point step per 0.15 s and is complete within
  2 s (`Tactix-E20D`). Hit rates: 38/40 at live accuracy 90, 13/13 at 70-80, 7/18 at 50-60, and 12/32 at a fixed 50
  (S42's bench). Only (c) is left. `trigger`.
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
- 1.7 t37/t38 overheat: answered 2026-09-17 (F229: t37 is the tap damage, t38 = 150 alone switches the overheat on). Left: F229's `t38` = 75 rung.
- 1.8 **U4/U5** one long reload with a stopwatch; hold the AR trigger and listen.
- **F15** (closed 2026-09-11, built unproven) rung 9: fire a proto-8 word at a gun armed with `config.stun` — expect `$AMMO,<slot>,0,0,1` from the node and the live counts back after 10 s; then `$BHIT` with the `$HIR` field set as the cheaper source.
- **F26** two guns, two phones, ten shots: does `$HIR` shooter id map to `player_num`?
- **F27** per weapon, `$BUT,2` → `$ALCD` up, versus `reload_ms`.
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
sound (O01 ships; alternates O05 O02 O04 O06 O03; its zero damage is fixed, F165); **S9**; **S1** audit;
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

**Capture (Mac + iPhone, batch for a Mac day):** **P8** leftovers (the numeric weapon stat values), **P3** (set a squad
voice in Callsign, re-host; WireGuard mode, not the HTTP proxy), **G3**; re-scrape the FB group with comments expanded
(the 2026-08-24 crawl missed threads). P12 is not a capture item: v4.32 ignores `$PB*` and the cloud capture did not carry the enums.

**Decisions (Tony's call):** **Q12′**; **Q13**; **F5**; **F20**; **F25**; **K1** which kid
mode; **P14**.

## 10. System proofs (needs players, space, time)

From `verification-checklist.md` (archived 2026-09-06); what is ⬜ there and still true:
- **Hold-across-disperse 5 min**: config head written, gun left unspawned 5+ min, then `$SPAWN` + `$AMMO` goes live with
  config intact (2 min passed; the 5 min run was cut). Else the T-10 s head re-write becomes default.
- **20-minute two-node soak** (Pixel + iPhone): screen-lock one at T+5, background the other at T+10, walk out of Wi-Fi;
  BLE held, engine reconciled on unlock, outbox flushed on return, timed end fired locally on both. **F272** (which
  absorbed F163) wants the same run watched for a SILENT (not disconnected) link and the lock-up detector's recovery.
- **Phone auto-rejoin** to the no-internet SSID after 3 min out of range, mobile data on vs off, per OS.
- **iOS locked-phone BLE**: lock mid-match, take 3 hits, unlock; did the queued `$HIR`/`$HP` reach the engine?
- **`$VOLTS` % token**: controlled discharge sweep of tokens 3 and 4 (HUD reads tok3 today).
- **FFA on real guns** (`play ffa A B C`, one `$TID`, FF on, distinct ids) + the **attribution fuse** (an old non-fatal hit
  does not steal a later kill) + **time-limit end / respawn ramp** (only frag-limit ends have run); infection / lms live.
- **Syphon / regen live** (`syphon=1`, `regen=1`: refill after `regen_delay_s`, re-arm on damage, no heal on respawn).
- **Config knobs on-gun**: native ALT venue setting (beam width; `$GSET` t2 stays 0, F198), kid_mode FF-off,
  volume 80 = comfortable L3, `hp=`/`armor=` echo,
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
  snapshot; `lobby.all_acked` unused; `T.micro` contrast; PANIC copy is protocol jargon; spec §3 prose says
  `damage`/`rof` are substituted into `$WEAP` (they are not).
- **HUD 2026-08-25:** top-right cluster cramped on device; a distinct no-cam layout (design pass, Tony owns visuals);
  a browsable per-match history view.
- **Design ideas parked:** directional hit mechanics on tok1 (backstab bonus, flank callout) after field-distance
  validation; a rocket description that couples to the default health block.
