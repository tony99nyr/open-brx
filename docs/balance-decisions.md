# Balance decisions

The log of balance reviews: one section per proposed weapon, weapon change or perk change, newest last.
The rules themselves live in [weapon-design.md](weapon-design.md) → *Balance rules*; this page records how
each proposal was judged and what Tony decided.

Each section comes from `python3 mcp/tools/balance_review.py --candidate <file.json> --record`, through the
`balance-review` skill (`.claude/skills/balance-review/SKILL.md`). It holds the inputs, the verdict of the six
named tests, the git sha and the scenario version. "Tony's call: pending" means the review ran and the
decision is still open. When Tony decides, run the tool again with `--record --call "<his words>"`; do not
edit an old section.

A verdict rests on invented assumptions (the pull model, reaction delays, range bands, closing speed and
peek windows). The tool prints all of them in every report. Read a verdict as "under these assumptions",
not as a field result.

## 2026-10-18: Sniper bolt action at 57 (with Charge Rifle 55/14)

- Verdict: **FAIL** (scenario version 1, seed 7, git `749d151bf`).
- Tony's call: pending (requested by brx1, 2026-10-18)
- Command: `python3 mcp/tools/balance_review.py --candidate sniper57.json`

| test | result | numbers |
|---|---|---|
| value_addition | pass | {"near_top_in": ["peek mid"], "new_mechanics": ["bolt action (1-round magazine)"]} |
| no_domination | pass | {"near_top_everywhere": [], "baseline_near_top_everywhere": []} |
| viable | pass | {"field": 0.553, "floor": 0.5, "beats_in_some_band": ["Assault Rifle", "Burst Rifle", "SMG", "Shotgun", "Suppressor", "Energy Rifle", "CR+Sniper+QS"]} |
| balance_kept | pass | {"rule_flips": {}, "already_failing_in_baseline": [], "kits_losing_last_near_top": []} |
| op_rule | pass | {"failing": []} |
| marksman_rush_counter | fail | {"vs_plain_ar": {"peek_kill": 0.694, "peek_death": 0.0, "escape": 0.306, "rush_success": 0.577, "marksman_beats_rusher": 0.423}, "vs_ar_body_armor": {"peek_kill": 0.697, "peek_death": 0.0, "escape": 0.303, "rush_success": 0.572, "marksman_beats_rusher": 0.428}, "near_top_1v1_long": false, "strong_ok": false, "counter_ok": true, "rush_start_m": 20} |

Candidate:

```json
{
 "title": "Sniper bolt action at 57 (with Charge Rifle 55/14)",
 "proposed_by": "brx1",
 "weapon_id": "sniper_rifle",
 "changes": {
  "mag": 1,
  "reserve": 48,
  "wire.dmg": 57,
  "reload_ms": 1500,
  "wire.fire_ms": 1000,
  "wire.swap_ms": 500
 },
 "sim": {
  "perk_exempt": true
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

## 2026-10-18: Sniper bolt action at 75 (with Charge Rifle 55/14)

- Verdict: **FAIL** (scenario version 1, seed 7, git `749d151bf`).
- Tony's call: pending (requested by brx1, 2026-10-18)
- Command: `python3 mcp/tools/balance_review.py --candidate sniper75.json`

| test | result | numbers |
|---|---|---|
| value_addition | pass | {"near_top_in": ["1v1 long", "peek mid"], "new_mechanics": ["bolt action (1-round magazine)"]} |
| no_domination | pass | {"near_top_everywhere": [], "baseline_near_top_everywhere": []} |
| viable | pass | {"field": 0.727, "floor": 0.5, "beats_in_some_band": ["Assault Rifle", "Burst Rifle", "SMG", "Shotgun", "AMR", "Suppressor", "Energy Rifle", "Charge Rifle", "CR+Sniper+BA", "CR+Sniper+QS"]} |
| balance_kept | fail | {"rule_flips": {}, "already_failing_in_baseline": [], "kits_losing_last_near_top": ["AMR"]} |
| op_rule | pass | {"failing": []} |
| marksman_rush_counter | fail | {"vs_plain_ar": {"peek_kill": 0.709, "peek_death": 0.0, "escape": 0.291, "rush_success": 0.152, "marksman_beats_rusher": 0.848}, "vs_ar_body_armor": {"peek_kill": 0.699, "peek_death": 0.0, "escape": 0.301, "rush_success": 0.142, "marksman_beats_rusher": 0.858}, "near_top_1v1_long": true, "strong_ok": true, "counter_ok": false, "rush_start_m": 20} |

Candidate:

```json
{
 "title": "Sniper bolt action at 75 (with Charge Rifle 55/14)",
 "proposed_by": "brx1",
 "weapon_id": "sniper_rifle",
 "changes": {
  "mag": 1,
  "reserve": 48,
  "wire.dmg": 75,
  "reload_ms": 1500,
  "wire.fire_ms": 1000,
  "wire.swap_ms": 500
 },
 "sim": {
  "perk_exempt": true
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

