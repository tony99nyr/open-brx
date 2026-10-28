# Balance decisions

The log of balance reviews: one section per proposed weapon, weapon change or perk change, newest last.
The rules themselves live in [weapon-design.md](weapon-design.md) → *Balance rules*; this page records how
each proposal was judged and what Tony decided.

Each section is written by `mcp/tools/balance_review.py`, through the `balance-review` skill
(`.claude/skills/balance-review/SKILL.md`), only once Tony has made his call:

    python3 mcp/tools/balance_review.py --record-from <verdict.json> --call "<Tony's words>"

The tool refuses to record a verdict without a call, a verdict made on a dirty tree, or one whose
fingerprint (a hash of the assumptions, both sim files, `weapons.json` and `perks.json`) no longer
matches the checkout. The log is append-only: a changed decision is a new section, never an edit.

## Format

    ## <date>: <title>

    - Verdict: **PASS** or **FAIL** (scenario version, seed, git sha, fingerprint).
    - Tony's call: <his words, verbatim>
    - Command: <how it was recorded>

    | test | result | numbers |   (value_addition, no_domination, viable, balance_kept, op_rule,
                                    marksman_rush_counter)

    Candidate: <the candidate file, as JSON>

A verdict rests on invented assumptions (the pull model, reaction delays, range bands, closing speed and
peek windows). The tool prints all of them in every report. Read a verdict as "under these assumptions",
not as a field result.

## 2026-10-18: s75_2200

- Verdict: **FAIL** (scenario version 1, seed 7, git `0b30c24ae`, fingerprint `b3a838ca6f86a22f`).
- Tony's call: Ok lets do 2.2s bolt and 75. Yes bench it.  Next real match ill play it and see how it feels
- Command: `--record-from s75_2200.v.json`
- Fails: balance_kept, marksman_rush_counter.
- Shipped anyway, on Tony's call, and Tony judges it in the next real match. Rushers from 20 m win only 35%
  against the bolt Sniper. The strong side reads "1v1 long", and the Sniper is not near the top there. The AMR
  and CR+Sniper+BA lose their last near-top cell. The Charge Rifle keeps its long range: t2 sets the carrier
  frequency, so a range-band trim cannot ship. On Shields, the bolt Sniper wins only 35% of open mid-range
  fights, by design: it must peek.
- The verdict ran with the Charge Rifle at 55/14 in "with". That half was withdrawn before it shipped, for the
  heat budget: a full charge costs +56 heat, a tap +14, and the gun locks out at about 103, so at 55/14 a 115 pool
  needs 126 heat and the gun locks out after 111 damage. Neither sim models heat. The Charge Rifle stays at 70/16
  until Tony picks its numbers (F575: 73/14 or 70/16).

| test | result | numbers |
|---|---|---|
| value_addition | pass | {"near_top_in": ["peek mid"], "new_mechanics": ["bolt action (1-round magazine)"]} |
| no_domination | pass | {"near_top_everywhere": [], "baseline_near_top_everywhere": []} |
| viable | pass | {"field": 0.607, "floor": 0.5, "beats_in_some_band": ["Assault Rifle", "Burst Rifle", "SMG", "Shotgun", "Suppressor", "Energy Rifle", "CR+Sniper+BA", "CR+Sniper+QS"]} |
| balance_kept | fail | {"rule_flips": {}, "already_failing_when_shipped": [], "kits_losing_last_near_top": ["amr", "CR+Sniper+BA"]} |
| op_rule | pass | {"failing": [], "already_one_shot_when_shipped": []} |
| marksman_rush_counter | fail | {"vs_plain_ar": {"peek_kill": 0.707, "peek_death": 0.0, "escape": 0.293, "rush_success": 0.352, "marksman_beats_rusher": 0.648}, "vs_ar_body_armor": {"peek_kill": 0.692, "peek_death": 0.0, "escape": 0.308, "rush_success": 0.335, "marksman_beats_rusher": 0.665}, "strong_column": "1v1 long", "near_top_in_strong_column": false, "strong_ok": false, "counter_ok": false, "rush_start_m": 20} |

Candidate:

```json
{
 "title": "s75_2200",
 "weapon_id": "sniper_rifle",
 "changes": {
  "wire.dmg": 75,
  "mag": 1,
  "reload_type": "bolt",
  "reload_ms": 2200,
  "wire.swap_ms": 500
 },
 "with": [
  {
   "weapon_id": "charge_rifle",
   "changes": {
    "wire.dmg": 55,
    "wire.tap_dmg": 14
   }
  }
 ]
}
```

## 2026-10-24: F576 published single-shot cycle

- Verdict: none. F576 is a rule change, not a weapon candidate, so `balance_review.py` has no verdict to record and
  this section is written by hand. A check run (seed 7, scale 0.25, before and after the change) changed no verdict.
- Tony's call: "yes your rec" (2026-10-24, relayed by brx1), on two points:
  1. The Shotgun's TTK band floor is 0.85 s, not 1.20 s. Its 400 ms pump and the fitted fight interval give 0.89 s.
  2. "Pistols weak against the rifles" is tested on the R10b duel result, not on the published TTK. The USP now
     publishes 2.10 s and the hidden Glock 2.26 s, faster than the Burst Rifle's 2.53 s. Every primary still wins
     the R10b duel against each live sidearm; the lowest cell is the Bolt Rifle against the USP, about 90%.
- Correction: the pistol call rests on the old-pace duel. The R10b duel engine still paces single shots with the
  300 ms pull model, not the field fit. At field pace (seed 7, 10,000 reps) the USP wins most duels against the
  Energy Rifle (the rifle wins .45) and the Suppressor (.29), and R10b fails. F579 reopens the call; Tony chose
  to land F576 first ("go for it", relayed by brx1).
- Tests: `mcp/tests/test_mc_compile.py::test_ttk_band_and_no_strictly_dominant_weapon` (the floor),
  `mcp/tests/test_mc_sidearms.py::test_pistol_identities_keep_tonys_ordering` (R10b at its own 65% bar).

## 2026-10-24: F579 USP damage 10 at field pace

- Verdict: **PASS** (scenario version 13, seed 7, git `2b5ab96b7`, fingerprint `ed3d11a64c650421`).
- Tony's call: sounds good
- Command: `--record-from verdict2-usp.json`

| test | result | numbers |
|---|---|---|
| value_addition | pass | {"finish_ms": {"deagle": 1017, "usp": 1008}, "new_mechanics": []} |
| no_domination | pass | {"near_top_everywhere": [], "baseline_near_top_everywhere": [], "field_ceiling_exceeded": [], "field_ratio_ceiling": 1.6, "priority_near_top": [], "priority_columns": ["1v1 close", "1v1 mid", "1v1 long", "field"]} |
| viable | pass | {"finish_ms": 1008, "bar_ms": 1200} |
| pickup_utility | n/a | {} |
| balance_kept | pass | {"rule_flips": {}, "already_failing_when_shipped": ["standard|R9", "standard|R12d", "standard|R12e", "standard|R10b energy_rifle/usp", "standard|R10b suppressor/usp"], "kits_losing_last_near_top": [], "near_top_losses_within_noise": [], "noise_z": 2.0, "haze_flip_over_bar": false, "haze_win_bar": 0.65, "r10b_primaries_beat_it": {"standard|ar_burst": 0.991, "standard|burst_rifle": 0.963, "standard|energy_rifle": 1.0, "standard|suppressor": 0.839, "standard|amr": 0.998, "standard|bolt_rifle": 1.0, "shields|ar_burst": 1.0, "shields|burst_rifle": 1.0, "shields|energy_rifle": 1.0, "shields|suppressor": 0.999, "shields|amr": 1.0, "shields|bolt_rifle": 1.0}, "r10b_under_bar": {}} |
| op_rule | pass | {"failing": [], "already_one_shot_when_shipped": []} |
| marksman_rush_counter | n/a | {} |

Candidate:

```json
{
 "title": "F579 USP damage 10 at field pace",
 "weapon_id": "usp",
 "changes": {
  "wire.dmg": 10
 },
 "with": [
  {
   "weapon_id": "shotgun",
   "changes": {
    "wire.dmg": 19
   }
  }
 ]
}
```

## 2026-10-24: F579 Shotgun gun word 19 at field pace

- Verdict: **PASS** (scenario version 13, seed 7, git `2b5ab96b7`, fingerprint `ed3d11a64c650421`).
- Tony's call: yeah sounds good
- Command: `--record-from verdict2-sg.json`
- Caveat: the mid-range gain assumes only the gun word reaches past headset range. Past it a kill needs 7 gun
  hits of 19 instead of 6 of 20, more than the 6-shell tube, so R9, R12d and R12e go green. If the headset word
  carries as far as the gun word, a pull stays at 39 there and the gain is gone. A bench row checks the reach
  (`~/reviews-2026-10-17/bench.md`, F579). Scenario 13 is the first with the R1-R12 duels at field pace.

| test | result | numbers |
|---|---|---|
| value_addition | pass | {"near_top_in": ["real aim"], "new_mechanics": ["shell-by-shell reload"]} |
| no_domination | pass | {"near_top_everywhere": [], "baseline_near_top_everywhere": [], "field_ceiling_exceeded": [], "field_ratio_ceiling": 1.6, "priority_near_top": [], "priority_columns": ["1v1 close", "1v1 mid", "1v1 long", "field"]} |
| viable | pass | {"field": 0.678, "kit_field": 0.641, "floor": 0.5, "beats_in_some_band": ["Assault Rifle", "Sniper Rifle", "AMR", "Suppressor", "Energy Rifle", "Toxin Rifle", "CR+Sniper+BA", "CR+Sniper+QS"]} |
| pickup_utility | n/a | {} |
| balance_kept | pass | {"rule_flips": {}, "already_failing_when_shipped": ["standard|R9", "standard|R12d", "standard|R12e", "standard|R10b energy_rifle/usp", "standard|R10b suppressor/usp"], "kits_losing_last_near_top": [], "near_top_losses_within_noise": [], "noise_z": 2.0, "haze_flip_over_bar": false, "haze_win_bar": 0.65} |
| op_rule | pass | {"failing": [], "already_one_shot_when_shipped": []} |
| marksman_rush_counter | n/a | {} |

Candidate:

```json
{
 "title": "F579 Shotgun gun word 19 at field pace",
 "weapon_id": "shotgun",
 "changes": {
  "wire.dmg": 19
 },
 "with": [
  {
   "weapon_id": "usp",
   "changes": {
    "wire.dmg": 10
   }
  }
 ]
}
```


## 2026-10-24: corrections to earlier sections (F583)

The log is append-only, so these corrections do not edit the sections they name.
- **s75_2200 (2026-10-18).** Commit `781164436` rewrote the `s75_2000` section in place, which this log forbids.
  The rewritten section keeps the 2 s run's git (`0b30c24ae`) and fingerprint (`b3a838ca6f86a22f`). Tony's 2 s
  call, as first recorded: "Ok so 2s still fits. If sniper misses shot it dies. If it hits twice peaking it wins.
  That seems ok to me". The 2 s verdict failed `marksman_rush_counter` too (rushers from 20 m won 31%). The
  shipped bolt is 2200 ms, which matches the section as it reads now. The full 2 s text is in
  `git show 781164436^:docs/balance-decisions.md`.
- **The Charge Rifle 55/14 half (s75_2200, last bullet).** "Withdrawn before it shipped" is true: 55/14 was on
  main from `e75f1fdbc` to `324b1a869` (2026-10-18, 01:51 to 08:46), and no APK came from that window (0.4.25 is
  from `e91600c2`, 2026-10-17; 0.4.26 is from `29c755645`, 2026-10-24).
- **F576.** The USP's 2.10 s is the figure at 12 damage. Since F579 (10 damage) the USP publishes 2.56 s.

## 2026-10-25: balance review sign-off (0.4.31)

- Verdict: none from `balance_review.py` for the set as a whole. The evidence is the phase C sandbox passes 6, 7a,
  7b, 7c, 7d and 7e (`~/reviews-2026-10-18-sandbox/phase-c/report.md`); pass 7e's Standard-only gate on scenario 22
  passed Body Armor +20 / reload ×1.25. The sim's field ratios carry the F607 caveat (field contacts are not
  independent timers).
- Tony's call (2026-10-25, relayed by brx1, from his signed-off review page):
  1. AMR fire interval 350 to 450 ms on both presets. Every other AMR number stays.
  2. Body Armor: +25 to +20 armour. Reload ×1.25 stays, with the Sniper bolt exempt.
  3. Armour Piercing pairs (`ap_dmg` / `ap_fire_ms`): Assault Rifle 4/131, SMG 4/131, Shotgun 15/467, Suppressor
     6/314, Energy Rifle 4/170. The Stinger stays 5/250.
  4. AP on the AMR (10/399), Burst Rifle (7/430) and USP (5/277): approved, but the compiler guard on their fn 37
     cell stays until the F618 bench row proves the gun-side emission after the AP re-key. Under AP a weapon's crit
     chance is zero, which keeps the "no AP with crit chance" rule; this only matters once F618 lifts the guard for
     the AMR (30% crit) and the Burst Rifle (40% crit).
  5. Fast Hands: Quick Hands and Quick Switch merge into one perk, reload ×0.5, swap ×0.5, ammo ×1.0, no armour
     cost. Stored loadouts move both old ids to `fast_hands`. A stored `exclude_ids: ["quick_switch"]` now excludes
     Fast Hands as a whole.
  6. Extended Mags: ammo ×1.5 on Shields; ×2.0 on Standard; swap ×1.3 on both.
  7. Rejected: raising AP damage on the SMG and Shotgun to price in the headset word AP loses (the shipped gun
     drops it, `compile.py` AP path). Close-range AP against the plain gun stays SMG 35.2%, Shotgun 49.7%.
  8. Rejected: the Recharge perk on Shields (pass 7c found no passing variant, and every OP Recharge kit carried
     the AMR).
- The Shields perk pool is Fast Hands and Extended Mags. Body Armor and AP stay refused there (A80).
- Command: recorded by hand; no `--record-from` run.

## 2026-10-27: the marksman rush counter becomes a flip test (F578)

- Tony's call (2026-10-27, relayed by brx1, from his answer to F578 (a)): "Relative". `marksman_rush_counter`
  becomes a flip test like the heat branches: a change fails only when it makes the rifle rush weaker than the
  shipped baseline. Parts (b) and (c) of F578 were answered by the 2026-10-25 sign-off above.
- The rule (scenario version 27): the plain AR and the AR with Body Armor rush the marksman from 20 m in both
  worlds. The change fails when either rush wins less often than in the baseline world, by more than 2 points or
  the 95% binomial noise of the two rates, whichever is larger. A changed marksman is compared with itself as
  shipped. A new marksman is compared with the shipped Sniper (pending Tony: the hardest shipped marksman to
  rush is the AMR, which would make the bar lenient). Peek-kill, "near the top at long range" and the old
  absolute 0.50 bar are reported only.
- Verdict for the 0.4.31 AMR change (fire interval 350 to 450 ms): **PASS** (scenario version 26 with the flip
  rule at `64c406fad`, seed 7, full scale, fingerprint `622e16401616c81a`). The run read the catalogue from before
  the 0.4.31 set (`edfe7319b^`), so the tree was dirty and `--record-from` refuses it. Version 27 changes only how a
  new marksman picks its baseline, so this verdict reads the same under 27. Kept off the repo in
  `~/reviews-2026-10-18-sandbox/phase-c/f578/`.
- Rush success from 20 m, baseline (350 ms) to candidate (450 ms): plain AR 0.002 to 0.018, AR with Body Armor
  0.008 to 0.060 (margin 0.02 each). Peek-kill stays about 0.71. The rush is stronger, not weaker, so the gate
  passes. Under the old absolute bar it would still fail (both far below 0.50). The speed sweep shows no flip.
- The rest of the 0.4.31 set (Body Armor, Fast Hands, Extended Mags, the AP pairs) changes perks, so the rush
  counter does not apply. Their phase C verdicts stand unchanged.
- Command: recorded by hand; no `--record-from` run.

| test | result |
|---|---|
| value_addition | pass |
| no_domination | pass |
| viable | pass |
| pickup_utility | n/a |
| balance_kept | pass |
| op_rule | pass |
| marksman_rush_counter | pass |
| heat_sensitivity | pass |
