# Domination, KOTH scaling and Juggernaut: a proposal

Updated: 2026-11-01. **Status: a proposal for Tony's decision. Nothing here is built.** Each section ends with the
choices Tony must make. The source is the field game of 2026-11-01 (F651): players misread KOTH.

The mode catalogue is [`game-modes.md`](game-modes.md). How a mode is added end to end is
[`adding-modes.md`](adding-modes.md). The control-point spec of record is [`spec/utility.md`](spec/utility.md) §5d.

## 1. The misread, and why it happened

Players thought a hill in their team's colour keeps scoring for them. Under today's KOTH rules it does not. Four
things on the field told them it did:

1. **The station screen.** A control point paints the whole screen in the owner's colour, whether or not anyone
   stands on it (`app/src/utility.js:736-745`). Red on the screen reads as "red is scoring".
2. **The possession tick.** The phone plays the `U100` tick while its own team owns a fresh, uncontested point
   (`spec/utility.md` §5d.5). Nothing gates the tick on a living owner being on the point. A teammate 20 m away
   who hears the advert hears the tick, but the hill banks nothing.
3. **The scoring rule is presence-gated, and nothing says so.** A station banks hold time only while a living
   owner is counted alone on the point (F554, `app/src/control.js:200-207`; the Stick has the same rule in
   `hardware/m5sticks3/presence.h`). The mode brief says this in one sentence (`mcp/brx_mcp/mc/state.py:279`),
   but no screen repeats it during play.
4. **The phone's result screen leads with kills.** In tonight's KOTH recaps the team score map held kills
   (red 14, blue 3) while hill time decided the winner (blue 424 s, red 211 s). The phone's TEAMS tab draws the
   team chip with `t.score`, which is the kill count, large and in the team colour
   (`app/src/hud/result.js:151`, `app/src/hud/shared.js:90`). The hill time sits under it in small type
   (`HELD 3:31`, `result.js:153`). A player reads "RED 14" and thinks red won. MC's recap is already right: its
   headline is HILL TIME, with kills in small type under each team (`webapp/mc/src/screens/Recap.tsx:257-266`).
   The in-match board is right too: its KOTH chip shows hold time (`app/src/hud/score.js:47-60`).

### 1.1 Proposed wording

The rule: **a word or a colour that suggests scoring appears only when the hill scores.**

| Surface | Today | KOTH, proposed | Domination, proposed |
|---|---|---|---|
| Station screen, owned, owner on it, alone | owner colour, `RED` | owner colour, `RED · SCORING` | owner colour, `RED OWNS · SCORING` |
| Station screen, owned, nobody on it | owner colour, `RED` | owner colour dimmed, `RED · NOT SCORING · STAND ON IT` | owner colour, `RED OWNS · SCORING` |
| Station screen, contested | `CONTESTED` state | `CONTESTED · NOBODY SCORES` | `CONTESTED · RED STILL SCORING` |
| Phone tick (`U100`) | owner, fresh, uncontested | only while the hill scores (needs advert byte 15, §3.3) | while my team owns any hill I hear |
| HUD hill badge after a capture | `HILL CAPTURED` | `HILL CAPTURED` + `STAY ON IT TO SCORE` | `HILL A CAPTURED` + `SCORES UNTIL THEY TAKE IT` |
| BRIEFING rule line | the mode brief | `STAND ON THE HILL TO SCORE` | `CAPTURE A HILL. IT SCORES FOR YOU UNTIL THEY TAKE IT.` |
| Phone result, TEAMS tab chip | kills, large | hill time, large; `KILLS 14` small under it | points, large; `KILLS 14` small under it |

For the result screen there are two ways to fix it:

- **Option "label only".** The phone draws hill time in the chip for an objective mode, and kills on a labelled
  line. No wire change.
- **Option "score field": the score field carries what decides the winner.** In an objective mode, MC's `team_scores[].score`
  becomes hill seconds (or Domination points), and a new `kills` field carries the kill count. Every surface
  that prints `score` is then right by default. This is a contract amendment, and an older phone prints the hill
  time where it used to print kills (which is the correct number).

**Recommendation: "score field", with the "label only" layout.** The number a surface prints as "the score" must be the number that
decides the match.

## 2. Domination

### 2.1 The rules in plain words

- There are three hills, A, B and C.
- Stand on a hill to capture it. An enemy hill drains to neutral first, then builds up for you.
- A hill you own scores for your team every second, **whether or not anyone stands on it**.
- It keeps scoring for you until another team drains it to neutral.
- The first team to the score target wins. If nobody reaches it, the team with more points at the whistle wins.

The difference from KOTH is one rule: **ownership scores, not presence.** In KOTH you must stand on the hill to
score. In Domination you must defend it.

### 2.2 How capture works today (KOTH), and who knows what

The capture model is built and field-proven. Domination reuses all of it.

| Fact | Value and source |
|---|---|
| Capture rate | `net × 100 / capture_s` per second. `net` = the leading team's living close players minus the largest single other team's, clamped (`app/src/control.js:8-16`, `189-195`) |
| Capture time | `HILL_CAPTURE_S = 10` s per phase at net 1 (`mcp/brx_mcp/mc/types.py:725`). MC may set 3 to 60 s per game (`types.py:757-758`, `HillSettings`) |
| Net cap | `HILL_NET_CAP = 3` (`types.py:728`), settable 1 to 6 |
| Two phases | an enemy hill drains to 0 (neutral, "Hill Lost"), then builds to 100 ("Hill Captured"). A steal is 20 s at net 1, a neutral take is 10 s (`control.js:17-20`) |
| Abandoned capture | a half-built neutral bar drains in `HILL_DECAY_S = 10` s after a 500 ms grace (`types.py:726-727`) |
| Contest | two teams counted on the point. Nobody builds or drains at net 0 (`control.js:196`) |
| Presence | binary: in the circle or not, never weighted by RSSI (`control.js:170-172`). An edge player ("fading") contests but does not build (`control.js:177-180`) |
| Who scores (KOTH) | the station banks time only while a living owner is counted alone (F554, `control.js:200-207`). The phone credits the owner while the point is held and uncontested, but only while it hears the advert (`app/src/hill.js:476-481`) |
| Authority | the station's own tally is the authority for its point (F555). MC takes it when fresh, else the largest phone reading per (hill, team) (`mcp/brx_mcp/mc/scoring.py:1160-1189`) |
| Several hills | MC already sums hold time across hills (F572, `scoring.py:804-830`), and the phone accrues each hill it hears on its own clock (F556, `hill.js:483-495`) |

**What each device knows:**

- **The station** (a phone in the utility role, or an M5StickS3) knows everything about its own hill: owner,
  progress, who is on it, and its own tally. It persists that state and works with no LAN and no MC
  (`spec/utility.md` §5d.6). It reports its tally to MC over Wi-Fi when it can reach MC.
- **A player phone** knows each hill it hears: owner, progress, the contested bit (advert bytes 9 to 11,
  `spec/utility.md` §5d.3). It does not know a hill it cannot hear, and it does not know how many players stand on
  a hill.
- **MC** knows nothing live. It merges the stations' and phones' tallies when they arrive.

### 2.3 What is built for Domination, and what is missing

**Built:**

- `DominationEngine` (`mcp/brx_mcp/modes/objectives.py:69-252`) already scores Tony's rule: every owned point earns
  its owner `points_per_s` each second, with no presence check (`objectives.py:226-231`). But it is a **CLI and
  simulator engine only** (`docs/spec/modes.md` §2). MC has no `domination` row in `MODES`
  (`state.py:223-286`), and MC scores objective modes through `Scorer`'s possession merge, not through this engine.
- `domination` is already in `OBJECTIVE_MODES` (`types.py:616`), so the tid 2 guard, the possession ingest and
  the hill listener already accept it.
- Multi-point identity: a phone or Stick control point names itself in advert bytes 6 and 7, so several hills are
  distinguishable. This is what closes the old blocker (F88) for station hills.

**Missing:**

1. **A mode row** in `MODES` (`win_by: "objective"`, `station_source: "phone"`, a `hold` item, red and blue), plus
   the three hand-kept tables in `adding-modes.md` §2.
2. **A score rule per mode on the station.** The station banks for the owner on every tick while it is owned,
   with no presence check and no contest pause. This is a flag in the station config (for example
   `hill.score_rule: "owned"`; KOTH keeps `"presence"`), read by `control.js` and by the Stick's
   `presence.h`/`control_point.h`.
3. **The same rule in the phone's accrual.** `hill.js:477-481` credits the owner while the point is held and not
   contested. For Domination it must credit the owner while held, contested or not.
4. **Hill names.** MC maps each armed station id to a letter (A, B, C) in the bundle, so the HUD and the voice can
   say "Hill B".
5. **Hill audio.** `hill.js:36-39` mutes all hill audio in `domination`, because two grenades are
   indistinguishable. For a station source the hills are distinguishable, so lift the mute for
   `station_source: "phone"` only.
6. **The HUD.** The HUD shows one hill today (F556's note at `engine.js:5933`). Domination needs a row of hills
   (§2.6).
7. **A grenade refusal.** A grenade carries no point identity (F88), so Domination refuses `station_source:
   "grenade"`, the same way `compile.validate` refuses the `control_points` knob today.
8. **Tests and art**, per `adding-modes.md` §8 and §9.

**Rough size:** about 5 lane-days on the desk, plus one field check with three hills. No hardware.

### 2.4 Decisions inside the rules

| Question | Options | Recommendation |
|---|---|---|
| Who holds ownership? | the station; the phones; MC | **The station.** It already does, it persists, and it needs no LAN. Phones only read it. MC only collects tallies |
| Does an owned hill score while contested? | yes, until it drains to neutral; no, pause | **Yes.** Tony's rule is "until another team captures it". The drain takes 10 s at net 1, so a defender has time to answer |
| Neutralise then capture, or a direct flip? | two phases (today); direct flip | **Two phases.** It is built and field-proven, and "Hill Lost" fires at the right moment for the defender |
| How many hills? | 2, 3 or more | **3.** An odd count always gives a majority. With 2, a 1-1 split stalls the game |
| MC out of range | | Stations and phones keep running. Each station keeps its own tally. MC collects the tallies at the whistle or when it next hears them. An early end on the score target reaches only the devices that can hear MC (the same limit KOTH's hold target has today, `adding-modes.md` §1) |

### 2.5 Scoring options

The units match KOTH: one point is one hill-second, and the score target uses the same field as KOTH's
`hold_target_s` (seconds, summed across hills, F572). A tick of the score does not need its own clock: the station
accrues by elapsed time, the same as KOTH.

**The model behind the numbers.** 2v2, 15 minutes (900 s), 3 hills. All hills are neutral for the first 30 s.
After that, about 10% of hill-time is neutral (captures in progress), or about 15% with a slower capture. A close
game splits the owned time 55/45. A one-sided game splits it 80/20.

| Option | Hills | Points | Capture (neutral / steal at net 1) | Target | Close game | One-sided game |
|---|---|---|---|---|---|---|
| **A. Seconds, clock only** | 3 | 1 per owned hill per s | 10 s / 20 s | none | 1290 to 1060 at 15:00 | 1880 to 470 at 15:00 |
| **B. First to 1000** | 3 | 1 per owned hill per s | 10 s / 20 s | 1000 | ends about 11:45, about 1000 to 820 | ends about 8:15, about 1000 to 250 |
| **C. Halo-style small numbers** | 3 | 1 per owned hill per 5 s | 15 s / 30 s | 200 | ends about 12:25, about 200 to 165 | ends about 8:40, about 200 to 50 |
| **D. Two hills** | 2 | 1 per owned hill per s | 10 s / 20 s | 600 | ends about 10:35, about 600 to 490 | ends about 7:25, about 600 to 150 |

**Recommendation: B.** It is the same unit and the same target field as KOTH, so the scorer, the target check and
the recap need no new arithmetic. Capture stays at the 10 s default. The target ends a one-sided game early and
lets a close game run to about 12 minutes. C gives smaller numbers on a screen but needs a new points unit. D
stalls on a 1-1 split.

### 2.6 The HUD for several hills

The phone sees only the hills it hears. The HUD must show that limit honestly:

- A row of letters, one per hill, each in its owner's colour: `A ■ RED   B ■ BLUE   C ?`.
- A hill the phone has not heard for 30 s shows its last owner dimmed, with its age: `C ■ RED 1:40 AGO`.
- The voice says the hill letter: "Hill B captured". The station screen shows its letter large.
- No live team score on the HUD unless MC pushed one recently. The phone cannot add up hills it does not hear.
  The line `YOU OWN 2 OF 3 (AS LAST HEARD)` is honest and is enough to play on.

## 3. KOTH per-player scaling

### 3.1 The rule

More of your team on the hill scores faster. One player scores at the base rate. Each extra living teammate in
the circle adds to the rate, up to a cap.

### 3.2 Options

Points per second for the owning team, by the number of living teammates counted on the hill:

| Option | 1 on the hill | 2 | 3 or more | 2v2, 15 min example |
|---|---|---|---|---|
| **Flat (today)** | 1 | 1 | 1 | 360 |
| **Linear: +50% per extra teammate** | 1 | 1.5 | 2 | 450 |
| **Diminishing** | 1 | 1.5 | 1.75 | 450 |
| **Double, capped at 2** | 1 | 2 | 2 | 540 |

The example assumes the team holds the hill uncontested for 40% of the match (360 s), with two players on it for
half of that time. In a 2v2 only the 2-player column matters, so Linear and Diminishing are the same game. They differ only in
3v3 and larger games.

### 3.3 Interactions

- **Contest.** Any living enemy counted in the circle stops all scoring, as today (F382, `hill.js:477`; the
  station's "counted alone" test, `control.js:206`). Scaling applies only to an uncontested hill. Scoring on the
  net difference was considered and rejected: the "Hill Contested" call would then be wrong half the time.
- **Who counts.** Count the same players the capture counts: living, in the circle, and not fading at the edge
  (`capCounts`, `control.js:180`). Presence stays binary. No RSSI weighting and no per-phone calibration, so no
  phone's radio gives its team a better rate.
- **The cap.** The cap is the hill's `net_cap` (default 3), so one knob bounds both the capture rate and the score
  rate.
- **The wire.** The station is the only device that knows the head count. Two changes carry it:
  - The station reports its hold time **per head count**, for example `hold_ms: {"0": {"1": 120000, "2": 90000}}`.
    MC applies the multiplier. This keeps MC's clamp honest: the clamp limits a team's hold to the match length
    (`scoring.py:287-307`, `1138`), and a pre-scaled number would break it. It also lets MC re-score a match with
    a different multiplier.
  - The station emits advert byte 15 as `net` (already specified, `spec/utility.md` §5d.3). On an uncontested
    owned hill, `net` is exactly the owner's close head count. The phone then gates the tick on `net > 0` (§1.1)
    and can scale its own fallback tally.
- **The target.** With scaling, `hold_target_s` counts points, not seconds. The console and the recap must say
  `HILL POINTS`, not `HILL TIME`.

**Recommendation: Diminishing (1 / 1.5 / 1.75), capped at 3.** It rewards a second player clearly. A third player adds less,
so stacking the whole team on the hill is not the dominant play (the rock-paper-scissors rule). **Rough size:**
about 3 lane-days (station on phone and Stick, MC scorer, wording), no hardware.

## 4. Juggernaut: feasibility

### 4.1 The mode

Free-for-all. One player starts as the Juggernaut, with more health and a different kit. Whoever kills the
Juggernaut becomes the Juggernaut. Points come from kills as the Juggernaut and from killing the Juggernaut. MC is
not live during play, so the handover must work with no MC.

### 4.2 What the phone has today

- **Pools.** `$PSET` tokens 3 to 5 set the HP, armour and shield ceilings. `$SPAWN` fills HP and armour to them.
  `$LIFE` adds to a pool and clamps at its ceiling (`protocol/brx-protocol.md`, the `$PSET` row). So more health
  needs a new `$PSET`, not only a `$LIFE`. Any `$PSET` clears the gun's team until a `$TID` follows (F206); the
  node's write path restores it (`app/src/engine.js:1830-1840`).
- **Weapons.** `$WEAP` rows. A bare `$WEAP` re-push refills the magazine and reserve (`docs/gotchas.md:335`). The
  pickup weapons already change a kit during a life.
- **Roles.** `_setRole(name, on, tid)` paints a held headset role (`engine.js:3124-3136`). The role names are a
  closed list: carrier, infected, vip, beacon, extracted (`engine.js:5617`). A Juggernaut role needs one more
  entry and its headset sequence in the bundle.
- **Kill attribution.** The victim's phone knows the killer: `$HIR` token 3 is the shooter id, and the death fact
  carries `shooter_num` (`engine.js:7286`). The killer's gun reports nothing when its shot lands.
- **A mid-match role change with no MC already exists: the infection flip.** On death, the victim's phone writes a
  frame list that MC compiled into the bundle (`team_flip`, `mcp/brx_mcp/mc/compile.py:3070-3091`), re-arms
  the gun, and emits a `team_change` fact (`engine.js:7287-7303`). Juggernaut uses the same pattern.
- **The killer learns of a kill over IR, with no MC: the S57 callout bus** ([`ir-callouts.md`](ir-callouts.md)).
  On death the victim's phone makes its dead gun send `DOWN_BY` naming the killer (`engine.js:7310-7320`). The
  killer's phone hears it in about 50 ms and plays KILL CONFIRMED (`engine.js:3572`). A dead gun still forwards
  the word. A dead gun cannot receive one.

### 4.3 The key question: how does the killer's phone learn that it is now the Juggernaut?

| Option | How | Strength | Weakness |
|---|---|---|---|
| **J1. Victim-side decision, IR broadcast** | When the Juggernaut dies, its phone sends one new word, `JUGG_DOWN_BY`, naming the killer (a new magnitude in the bench-silent range 1 to 39, clear of the used values). The killer's phone takes the role on that word | about 50 ms, no LAN, the existing bus | lost when the killer is out of IR reach of the dead gun's domes |
| **J2. Deterministic rule on both sides** | each phone tracks who the Juggernaut is from the words it hears | no new word | a phone that missed one word holds a wrong belief for the rest of the match. Not safe alone |
| **J3. MC relay, best-effort, with a timeout** | MC gets the Juggernaut's death fact with `shooter_num` and sends an `alert` with a role to the killer if the killer has not reported taking the role. The phone accepts it only within 20 s of that death | heals a lost IR word when both phones reach MC | needs LAN on both phones. Never waited on |

**Proposal: J1, with J3 as the repair.** J1 has a useful property: only the victim decides, and the old Juggernaut
always drops the role on its own death. So a lost word can leave **no** Juggernaut for a while, but it can never
make **two**. J3 fills that gap when the LAN allows. Every role change is also a fact (`role_change`, like
`team_change`), so MC scores what happened on the field and flags a handover the IR bus missed.

Edge rules:

- **The Juggernaut dies with no known killer** (a self-kill, a gun recovery): the old Juggernaut keeps the role and
  respawns as the Juggernaut. The victim's phone decides, so no other device is needed.
- **The new Juggernaut announces itself once**, with one IR word naming itself, so the phones in range can show
  `JUGGERNAUT: <name>` on the HUD. This follows the one-event, one-word rule.
- **The first Juggernaut** comes from the bundle (MC picks at compile), so every phone starts with the same answer.

### 4.4 The gun-side changes

Do **not** use a `config` push to change a role. A `config` push to an armed or live gun clears `spawned`, and
nothing re-spawns that gun (A30, `docs/spec/contracts.md:806`, `docs/spec/loadout.md:312`). Every change is a
phone-local write from tables MC compiled into the bundle, like `team_flip`:

- **Taking the role (the killer, alive):** the Juggernaut `$PSET` (higher HP and armour, the same team), `$TID`,
  the Juggernaut `$WEAP` rows, then a top-up. The top-up is either `$LIFE` to the new ceilings, or an in-place
  `$SPAWN` like the operator's FORCE RESPAWN.
- **Losing the role (the old Juggernaut, dead):** its next respawn burst leads with the normal `$PSET` and the
  normal `$WEAP` rows. `life_frames` already takes a `lead` list (`compile.py:872-884`).
- **The headset:** the new `juggernaut` role through `_setRole`.

### 4.5 What the bench must answer

1. Does a `$PSET` with higher ceilings on a live gun keep the current pools, or reset them? (This decides `$LIFE`
   or `$SPAWN` for the top-up.)
2. Does an in-place `$SPAWN` on a live gun behave like a revive, with no side effects on `spawned` or the trigger?
3. Does the new IR magnitude arrive silent and decode reliably, the same way step 7.11 proved magnitude 22?
4. Does a `$WEAP` swap during a life keep the slot selection and the trigger mapping?

### 4.6 Verdict

**Feasible with two small extensions: a new IR callout magnitude and bundle-compiled role tables.** It needs no new
hardware. The victim-side IR decision gives a handover with no MC, and its only failure mode is a short period with
no Juggernaut, never two.

**Rough size:** about 8 to 10 lane-days (MC mode row, compile tables and scoring: 3 to 4; the phone engine, role,
IR word and HUD: 3 to 4; tests and a chaos scenario: 2), plus one bench sitting of about an hour for §4.5.

## 5. Decisions for Tony

1. Recap fix: "label only" or **"score field"** (§1.1).
2. Domination: build it now or post-MVP. Scoring option A, **B**, C or D (§2.5).
3. Domination: an owned hill scores while contested, **yes** or no (§2.4).
4. KOTH scaling: Flat, Linear, **Diminishing** or Double (§3.2).
5. Juggernaut: post-MVP design accepted, J1 + J3 (§4.3), and the bench items in §4.5.
