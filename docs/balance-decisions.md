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

