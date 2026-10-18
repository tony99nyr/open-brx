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
