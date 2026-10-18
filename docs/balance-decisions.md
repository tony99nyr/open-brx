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

## 2026-10-18: s75_2000

- Verdict: **FAIL** (scenario version 1, seed 7, git `0b30c24ae`, fingerprint `b3a838ca6f86a22f`).
- Tony's call: Ok so 2s still fits. If sniper misses shot it dies. If it hits twice peaking it wins. That seems ok to me
- Command: `--record-from s75_2000.v.json`
- Fails: balance_kept, marksman_rush_counter.
- Shipped anyway, on Tony's call. Rushers from 20 m win only 31% against the bolt Sniper. The strong side reads
  "1v1 long", and the Sniper is not near the top there. The AMR and CR+Sniper+BA lose their last near-top cell.
  The Charge Rifle keeps its long range: t2 sets the carrier frequency, so a range-band trim cannot ship. On
  Shields, the bolt Sniper wins only 36% of open mid-range fights, by design: it must peek.

| test | result | numbers |
|---|---|---|
| value_addition | pass | {"near_top_in": ["peek mid"], "new_mechanics": ["bolt action (1-round magazine)"]} |
| no_domination | pass | {"near_top_everywhere": [], "baseline_near_top_everywhere": []} |
| viable | pass | {"field": 0.627, "floor": 0.5, "beats_in_some_band": ["Assault Rifle", "Burst Rifle", "SMG", "Shotgun", "Suppressor", "Energy Rifle", "CR+Sniper+BA", "CR+Sniper+QS"]} |
| balance_kept | fail | {"rule_flips": {}, "already_failing_when_shipped": [], "kits_losing_last_near_top": ["amr", "CR+Sniper+BA"]} |
| op_rule | pass | {"failing": [], "already_one_shot_when_shipped": []} |
| marksman_rush_counter | fail | {"vs_plain_ar": {"peek_kill": 0.698, "peek_death": 0.0, "escape": 0.302, "rush_success": 0.306, "marksman_beats_rusher": 0.694}, "vs_ar_body_armor": {"peek_kill": 0.696, "peek_death": 0.0, "escape": 0.304, "rush_success": 0.307, "marksman_beats_rusher": 0.693}, "strong_column": "1v1 long", "near_top_in_strong_column": false, "strong_ok": false, "counter_ok": false, "rush_start_m": 20} |

Candidate:

```json
{
 "title": "s75_2000",
 "weapon_id": "sniper_rifle",
 "changes": {
  "wire.dmg": 75,
  "mag": 1,
  "reload_type": "bolt",
  "reload_ms": 2000,
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

