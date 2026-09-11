# Followups triage — every open id, sorted by what it needs

Updated: 2026-09-11. **This is an INDEX over [`FOLLOWUPS.md`](FOLLOWUPS.md); the rows there are the truth
and this file never restates them.** It answers the four questions the register cannot answer at a glance:
*is it a bug in code that runs today or a feature we do not have yet · can a keyboard alone close it, or does
it need a gun, a rig or an ear · what is it waiting on · what does closing it unblock.* Re-sort it by hand
whenever a row changes status; if this file and a row disagree, **the row is right**.

Doer legend: **KB** = keyboard only, an agent can finish it without Tony · **BENCH** = Tony with a gun, a rig,
a dim room or an ear · **DECISION** = Tony's call, five minutes, no hardware · **HW** = hardware to buy, print
or measure. Status is copied from the row (🔴 blocking · 🟠 next · 🟡 useful · 🟢 low · ⬜ not started).

**Closed by the SECOND 2026-09-11 (late) session, removed from the tables below:** F102 · F54 · S11 · F57 · F15 · F78 · E1 · S5. Narrowed: F58 (b) done, Q18 (print half done), S10 (role contract A19 done), F106 ((a)-(e)(i) done). Opened: F107 (the loop's Lows). Evidence: the second 2026-09-11 (late) log entry.

**Closed by the first 2026-09-11 (late) session, removed from the tables below:** F81 · F34 · F97 · F47 · F55 · F53 · F41 · F90 · F101 · F103 · F104 · F105 (opened and closed) · F86 · F77 · F64 · F31 · F84 · F92 · F94. Narrowed: F80 (recap surface built, arm-time refusal open), S5 (server + panel built, persistence + recap row open), F13 (the floor is in; the headset-pacing half stays). Evidence: `experiment-log/2026-09.md`, the 2026-09-11 (late) entry.

**Headline counts (by the hygiene test's definition count, a `- **ID 🟡` row: 126 at the start of the second 2026-09-11 session, 119 after it; the earlier 158/140 figures counted bench-sheet aliases too):** 26 bugs in active code (**20 KB**), 14 core platform
gaps (**10 KB**), 46 bench-gated unknowns, 14 decisions, 29 future features / ideas, 23 hygiene or research
leftovers. **The 🔴 list is eight ids, and only ONE is still keyboard work: E5 (E1 closed 2026-09-11, second session).** Every other 🔴 is
either bench-gated (F91, F74, K4, Q15, B26, F49) or a lesson already learned and kept as a rule (F43, F40).

---

## 1. Bugs in ACTIVE code (it runs in a real match, at the bench, or in the suite today)

Sorted by how badly it bites, then by whether a keyboard can close it.

### 1a. Keyboard-only bug fixes, in the order to do them

| id | st | one line | blocked on / depends | unblocks |
|---|---|---|---|---|
| **F80** | 🟡 | a gun whose `$PSET` never landed fires as id 0; the RECAP now counts wire-0 hits; the arm-time refusal is B19 | B19 | — |
| **F52** | 🟢 | four readout timings still carry fallback literals in two consumers | nothing | — |
| **Q18** | 🟡 | the print half is done (2026-09-11, second session); the join-late half is `space` | `space` | — |

### 1b. Bugs that need the bench (a keyboard cannot see them)

| id | st | one line | needs |
|---|---|---|---|
| **F69** | 🔴 | a grenade hill chips and kills players in our games | **F91** (move weapons off protocol 0) — but `bench-critical` **B2** may kill that plan; KB fallback = a loud `SETUP:` hazard warning |
| **F74** | 🔴 | a gun latches an IR event and replays it every 5.07 s with no IR in the air | `trigger`: hammer with `rapid_fire.py`, bisect emitter vs beacon; then a node guard (KB) |
| **F49** | 🔴 | own-team shot registered, enemy shot did not; contradicts polarity | `trigger`: diff the stage's arm vs `ff_ab.py`'s frame by frame |
| **K4** | 🔴 | melee does not work in our compiled game with byte-identical frames | `trigger`, one swing |
| **F68** | 🔴 | a magnitude-0 miss kills the headset team colour for the life | KB heartbeat repaint is buildable, but only bites once **S17** ships; verify with `eyes` |
| **F56** | 🟠 | night: team 3's settled armour bar is the same hue as its rest | `eyes` on team 3 at night; day half is closed |
| **F59** | 🟠 | on-gun audio lags the LED by ~1 s; not our ordering | `ears` + receiver: time `$PLAY` → first audio |
| **F58(a)(d)** | 🟠 | `healed` ships with no sound; `$LIFE,25` did nothing where `$LIFE,20` healed | `ears` for the pick (F43), `trigger` for the 1..45 sweep — **S14 depends on (d)** |
| **F50** | 🟠 | the pain gate has never run in a real node path | `ears`, one armoured life |
| **F13(2)** | 🟠 | headset frame pacing of the arming burst unverified | `eyes` |
| **F71** | 🟠 | headset weapons may land t5 + t12 (shotgun 115, not 45) | `trigger`, read `$HP` at headset vs gun range |
| **F23** | 🟠 | damage may depend on the SENSOR (18 on headset vs 9 on body) | `trigger` |
| **F12** | 🟠 | the receiver firmware's stitch INVENTS parity-valid words | firmware fix is KB; proving it needs the rig |
| **F36** | 🟡 | no published APK has run on a phone (0.1.8 now; row still says 0.1.7) | `trigger`: install it |
| **F21 · F28 · F29 · F3 · F30** | 🟡/🟢 | inset on both Pixels · back dome took 0 hits · low-health alert in a match · empty-mag prompt · fixed-weapon rules not applied | `eyes` / `space` / `capture` |
| **F82** | 🟡 | tid 2 in a hill mode is refused at three layers; the mechanism is unobserved | rung D, two guns |
| **F65** | 🟢 | `$BUMP` inert on v4.32 | `trigger`, low value — `$LIFE` covers it |

## 2. CORE PLATFORM gaps (the spec says it exists; the software does not)

| id | st | one line | doer | depends on | unblocks |
|---|---|---|---|---|---|
| **E2** | 🟠 | one `register_mode()` replacing four hardcoded touch points — `modes/registry.py` exists and `build_engine` uses it (E1's seed); three touch points left | KB | nothing (E1 closed) | E4, outsiders adding modes |
| **E5** | 🔴 | phone-side audio channel (the app plays no game audio) | KB build, `ears` to hear it | nothing | E6, a custom announcer |
| **B23** | 🔴 | respawn station for HOSTED games (node-defined downed state) | KB assembly, then bench | F15 (built) + F104/S5 (built) + the proto-15 row (shipped): every link exists, the ASSEMBLY is the work | station respawn |
| **B19** | 🟠 | MC verifies its config landed via `$QUERY` before start | KB, bench to validate | nothing | **F80**'s real fix, B18b |
| **B18b** | 🟡 | headset-present gate in MC preflight (detectors known) | KB | B19 is the natural home | — |
| **S14** | 🟠 | Syphon as a HUD-driven kill event (`siphon: {hp, armor}` in the kill moment) | KB (S14.1/.2), `trigger` (S14.3) | **F58(d)** — `$LIFE` grant sizes are inconsistent on hardware | a fair 2v1 |
| **S10** | 🔴 | LED language v2: verified on the gun; the role contract is A19 (done, `vip` reaches the node); open = an MC-side SIGNAL for `beacon`/`extracted` (S3) + four bench leftovers | `eyes` for (a)–(d); KB for the signals once S3 exists | S3 | VIP / extraction roles lighting |
| **S3** | 🟠 | extraction on the phone path, HUD-driven | KB, then bench | nothing (S5 closed: the zone is a station beacon MC can arm) | extraction live, the `extracted` role signal (S10) |
| **F24** | 🟡 | MC-owned `session_totals` so the phone's tally matches the laptop | KB | nothing | — |
| **S2** | 🟡 | presentation profile WRITE UI + per-event override editor | KB (`ui-build-verify`); 6b is `eyes` | nothing | operators changing sounds without JSON |
| **S6** | 🟡 | kill the legacy shims (Tony: no legacy support) | KB, then an APK cut | F36 (a phone on the current build) | smaller engine |
| **F88** | 🟡 | multi-point Domination: grenades carry no station id; phones do | KB on phones (F94 path); grenade half is `bench` | nothing (F104/F103 closed; `config.stations` reaches every HUD) | Domination |
| **F70** | 🟠 | KotH node work is done; open = what the charge is priced in (rung X), max charge (rung M) | `grenade` bench | — | F76, the capture economy |
| **E3 · E4 · E6 · E7** | 🟡/🟢 | unify the two `GameConfig`s + JSON Schema · contributor doc · sound packs · `.LTP` import | KB | E2 · E2 · E5 · B11 | outsiders |

## 3. BENCH-gated unknowns (Tony + hardware; the running order is [`bench-queue-2026-09-09.md`](bench-queue-2026-09-09.md))

**Next sitting, self-contained: [`bench-critical-2026-09-11.md`](bench-critical-2026-09-11.md).** Grouped by setup.

- **Trigger in hand:** 🔴 **K4** melee · 🔴 **F49** polarity · 🔴 **F74** latch · 🔴 **F91** off protocol 0 (B2 first) · 🟠 **F23** sensor damage · 🟠 **F71** t12 · **F15** rung 9 (closed, built unproven: the proto-8 word at a stun-armed gun, then `$BHIT`) · 🟡 **K1** t19 · 🟡 **U11′** enemy 35 / ally 31-32-34 · 🟡 **F26** attribution · 🟡 **F27** reload timing · 🟡 **F62** crits · 🟡 **F63** secondary fire · 🟡 **F66** fn 23 · 🟡 **F67** accuracy calibration · 🟡 **F39** 20-row `$SIR` · 🟡 **S7** dead-player rejoin · 🟡 **S-A12.2** pistol cadence · 🟢 **F65** `$BUMP` · 🟢 **P4** `$AS`/`$UP` · 🟢 **F87** rung Z (t14 floor).
- **Eyes (dim room):** 🔴 **S10** (a)–(d) · 🟠 **F56** team 3 at night · 🟠 **F13(2)** · 🟡 **F21** · **F28** · **B20** · **S8** · **S4** · **S2 6b** · 🟢 **F29**.
- **Ears:** 🔴 **F43** is the RULE (confirm every id solo) · 🟠 **F44** shield hum · 🟠 **F59** audio lag · 🟠 **F58(a)** heal sound · 🟠 **F50** pain gate · **F57** (closed) hear the crossing hit play the warning alone · 🟠 **S9** event sound pass · 🟡 **F45** four `$PSET` slots · 🟡 **F48** heartbeat pool · 🟡 **B27** fn 23 mute · 🟡 **S1** by-ear audit · 🟡 **P3** voice map · 🟡 **S-A12.1** · 🟡 **D4** double kill · 🟡 **U4/U5** · 🟡 **P15** alarm id · ⬜ **W4a** launcher sound.
- **Space / tape:** 🔴 **Q15** sub-indoor power (Mac) · 🟠 **Q16** divergence · 🟡 **Q18** join late · 🟡 **D1** nRF mesh (30 min) · **F28** field distance · **P15** BLE link count.
- **Grenade:** 🟠 **F70** rungs X/M · 🟠 **G9** CTF colour · 🟡 **F75** contested word · 🟡 **F76** per-weapon counts · 🟡 **F82** rung D · 🟡 **F88** two-grenade capture · 🟡 **G3** · 🟡 **G10** · the §8 captures.
- **Capture (Mac + iPhone day):** 🟠 **P8** HTTPS API · 🟡 **B28** mesh claim · 🟡 **B29** 16 vs 17 slots · 🟡 **F3** · 🟡 **F30** · 🟢 **P12** · 🟢 **B25** t17 vs t40.
- **Doc contradictions only a gun can settle:** 🔴 **B26** headset-less gun fires? · 🟡 **B27** · 🟡 **B28** · 🟡 **B29**.
- **System proofs** (players, space, time): FOLLOWUPS §10, unchanged.

## 4. DECISIONS (Tony, keyboard, no hardware)

| id | the question | why it is waiting on a person |
|---|---|---|
| **F60** | do medic / shield grant rows belong in a compiled `$SIR` table at all? | it decides whether shield is permanently node-granted |
| **S12** | a `presentation.voice` switch (`on` / `hits_only` / `off`) for the player's own grunts | a silenced sniper grunting gives the position away |
| **Q13** | friendly fire ON and score teamkills, or accept no teamkill feedback | FF is invisible on the wire |
| **F5** | AR at 140 ms / 192 reserve (balance) or stock 100 / 384 | one test decides |
| **F20 · F25** | kill confirm deferred during a reload · "CONFIRMED BY MISSION CONTROL" copy | HUD strings |
| **Q12′** | `hit_taken` carries the shield delta as its own field | both sessions said yes; nobody wrote it |
| **S13** | which per-player kit powers beyond pools are worth a control | needs a home on the wire per item |
| **K1 · P14** | which kid auto-reload · is the SD card removable | feel / a teardown |
| **W4a** | the Energy Launcher deals zero damage in every shipped game | flatten `_SIR_TABLE` or retune five weapons |
| **F98 §5f.7** | Territories: hold more, respawn faster | sign-off before build |
| **F100 (3)** | the wearable powerup's blocked-respawn grief: bug or tactic | design pass |
| **F40** | the "a guard states its own blind spot" rule as policy | the code half is done |

## 5. FUTURE features and ideas (nothing runs today; spec first, then KB)

| id | st | what | needs first |
|---|---|---|---|
| **S16** | ⬜ | damage over time on the node (`$LIFE` negatives) | a spec section: kill credit, respawn, HUD |
| **S17** | ⬜ | ship the accuracy model per weapon (t21/t22) | **F68** fixed, F67 calibration |
| **F93** | 🟢 | teammates-near proximity list (enemies as a perk) | KB: expose `presence.players()` |
| **F95** | 🟡 | roaming hills, the LAN-coupled A4.8 exception | F94 (F101/F102/F103), A1/A2 |
| **F98** | 🟢 | Territories | F94 + the §5f.7 decision |
| **F83** | 🟢 | rotating-hill mode | same rotation logic as F95 |
| **F87** | 🟢 | rate-of-fire boost for the hill holder (`$WEAP` t14 + `$AMMO` restore) | rung Z (t14 floor) |
| **F99** | 🟢 | M5Stack IR↔BLE bridge and shield granter — **firmware WRITTEN 2026-09-11** (`hardware/m5sticks3/`: RMT IR decode, kind-5 advert, BRIDGE/HILL state machines, host-tested by `test_sticks3_core.py`), never run on a Stick | **H7** hardware ordered 2026-09-11; gates (1)-(3) in the H7 row |
| **F100** | 🟢 | wearable powerup, death drops it | design pass (5 questions) |
| **B8** | 🟡 | grenade STATE display app | a grenade to verify |
| **B16 · B17 · K2 · K6** | 🟢/🟡 | kid disable-secondary · tutorial mode · perk on ALT-fire · per-game weapon tuning | K6 needs a spec |
| **B14** | 🟡 | voice-pack selection (derivable now) | superseded by E6 |
| **F17 · F18 · F19 · F32** | 🟢 | lives cap · FFA ladder · HOST STOPPED pill · perks menu size | HUD polish |
| **S-A12 .3 .5** | 🟡 | CS audio outside the repo · `pistols` template | — |
| **B1 · B4 · H1–H7 · R2** | HW | Companion rider · Utility Box · prints · M5Stick station · emitter `DUTY` | calipers, parts |
| **B21 · B22 · B11** | 🟠/🟢 | release-sign the APK · pipeline leftovers · connected voice USB-load | keystore (Tony) |
| **§1 public flip** | — | device ids in old commits (deliberately kept) · B21 | — |

## 6. HYGIENE, method and research leftovers (KB, never blocking)

**F42** the DRY backlog (.1 needs an ear for `game_over`'s slot; .2–.7 are KB; .8 is a DO-NOT-MERGE note) ·
**F16** `bench_common` half fixed · **F14** three deliberate HUD nits (recorded, not bugs) · **F89** recorded so
nobody routes beacons through `_team()` (not a bug) · **F43** the sound-pick rule (a lesson, keep it where the code
is) · **S2 Lows** (2026-09-04 polish) · **S4/S7 leftovers** · **§11** low ledgers · **D3** Jay's LoRa host ·
**F94** and **F92** closed 2026-09-11 (archive) · **F106** the station-arming Lows ((a)-(e)(i) fixed 2026-09-11; (f)(g)(h) stand) · **F107** the second polish loop's Lows (nine letters, all KB).

## 7. Dependency spine (what to do first so the rest can move)

```
S5 (closed) + F15 (closed) ──► B23 = the ASSEMBLY (KB), then bench
  ├──► S3 extraction on phones ──► the `extracted` role signal (S10)
  └──► F88 multi-point on phones ──► Domination
E1 (closed) ──► E2 (registry seeded) ──► E3 / E4 ──► outsiders' modes
B19 ──► F80 real fix ──► B18b
F58(d) [bench] ──► S14 syphon
F68 ──► S17 accuracy per weapon ──► F67 calibration
F91 [bench, B2 first] ──► F69 closes
F74 [bench] ──► F77 root cause
```

**Recommended order for the next keyboard sessions** (nineteen of the original list closed 2026-09-11, eight more in the second session): **E2** (three touch points, the registry is there) · **B23** the hosted respawn assembly (every link built) · **F88** multi-point on phones · **S3** extraction on phones · **B19** for F80's real fix · the E1 Designer editor (F107 (h)) · **E5** when there is an ear for it. **The next bench sitting is
unchanged** (`bench-critical-2026-09-11.md`); B2 there decides whether F91 is even the fix for F69.
