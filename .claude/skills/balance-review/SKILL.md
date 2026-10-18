---
name: balance-review
description: Judge a proposed weapon, a weapon variant, a weapon number change or a perk change for Open BRX, deterministically, and log Tony's decision. Runs mcp/tools/balance_review.py (a kit dominance matrix, the Balance rules before and after, and six named tests - value_addition, no_domination, viable, balance_kept, op_rule, marksman_rush_counter), proposes the smallest fix for a failed test, asks Tony for the call and records it in docs/balance-decisions.md. Use whenever someone (Tony, another session, a community member) proposes a new gun, a variant of a gun, a damage/cadence/magazine/reload/swap change, a perk change, or asks "does this break balance", "is this gun OP", "would X dominate", "rerun the sniper sims", "balance check", "balance review".
---

# Balance review

Tony (2026-10-17): "we need a skill that can repeat these sims and balance adjustments. lets say someone
from the community wants to add a gun. or a variant of a gun. We need a way to deterministically say that
its a value addition. that it adds complexity to sandbox. that it does not dominate. that it can be a
viable option and wont upset balance of the game ... it would help document our decisions."

The tool is `mcp/tools/balance_review.py`; its docstring explains the engine. The rules it protects are the
*Balance rules* table in `docs/weapon-design.md`. The decision log is `docs/balance-decisions.md`.

## The loop

1. **Take the proposal.** Write down what changes, in catalogue terms: which row, which field, which value.
   Ask only if a number is missing. Say which existing row a new weapon copies its captured frame from.
2. **Write the candidate file** in your scratchpad (not in the repo). One of:
   - a diff on a shipped row: `{"title": ..., "weapon_id": "sniper_rifle", "changes": {"wire.dmg": 57, "mag": 1}}`;
   - a new row: a full `weapons.json` row (a copy of the row it is based on, with a new `weapon_id` and `name`),
     bare or as `{"title": ..., "row": {...}}`;
   - a perk change: `{"perk_id": "quick_hands", "changes": {"reload_mult": 0.4}}`, or `{"perk": {...row...}}`.

   Optional keys: `"with": [...]` holds other pending changes that apply to BOTH worlds (for example "with the
   Charge Rifle at 55/14"). Nothing escapes judgement that way: the rule cells and the one-shot check also run
   against the shipped catalogue, and a `with` entry that breaks one fails `balance_kept` or `op_rule`.
   `"sim": {"style": "full"}` makes an automatic hold the trigger instead of bursting. A bolt is
   `"reload_type": "bolt"` in `changes`: the ammo and reload perks then skip it, as compile.py `_ammo` does. The
   report marks a candidate bolt row **Sim only** only on a tree whose compiler lacks that exemption
   (`_bolt_exempt_sim_only`): shipping that verdict needs the compile change too. Balance numbers live in `wire`: use `wire.dmg`, `wire.tap_dmg`, `wire.fire_ms`,
   `wire.swap_ms`, `wire.headset_dmg`. The tool refuses every requested field that the catalogue does not read
   or that does not change.
3. **Run it** from the repo root, in the background (about 90 s with 4 workers):

       python3 mcp/tools/balance_review.py --candidate <file.json> --out <scratch>/verdict.json --report <scratch>/report.md

   The exit code is 0 for PASS and 1 for FAIL. Do not change a constant, a margin or a rep count to get a pass.
   A change to the scenario list bumps `SCENARIO_VERSION`, and is its own reviewed change.
4. **Read the verdict.** Each test is pass, fail or n/a, with its numbers:
   - `value_addition`: near the top in at least one scenario, or a trigger mechanic the arsenal lacks
     (overheat, charge, burst, bolt, shell reload, two-word pull). A stat change alone is not a mechanic.
   - `no_domination`: no kit near the top in every scenario.
   - `viable`: field ratio at or over the floor, and it beats at least one kit in some 1v1 band. A sidearm
     instead finishes 35 HP inside the R10a bar.
   - `balance_kept`: no Balance rule cell (R1-R12, R10a, Standard and Shields) flips to fail, and no other kit
     loses its last near-top cell.
   - `op_rule`: no loadout weapon's pull, or crit pull, one-shots the lowest pool a player can field on Standard
     or Shields, with any visible perk (rule 7).
   - `marksman_rush_counter`: marksman rows only. Strong against players who do not rush (peek-kill, and near
     the top in `MARKSMAN_STRONG_COLUMN`), beaten by rushers. The report also says when any candidate moves
     the other marksman rows' rush numbers.
   Also read the matrix, the rule table, the time-to-kill table (perfect aim, recoil, crits) and the
   hits-to-kill: a damage step that changes hits-to-kill (57 x 2 = 114, under the 115 pool) changes the weapon.
5. **Propose the smallest fix** for each failed test: one field, one value, with the reason. Run the fix as its
   own candidate and show both verdicts side by side. Never fix a failure by editing the tool.
6. **Ask Tony for the call.** Give him, in this order: the verdict line per test, the matrix row of the
   candidate, the smallest fix, and **the invented assumptions** (the pull model, reaction delays, range bands
   and closing speed, peek windows; the report prints them all). Say plainly that the verdict holds under those
   assumptions, not in the field.
7. **Record it** once Tony has decided, from the verdict you already have (no re-run):
   `python3 mcp/tools/balance_review.py --record-from <scratch>/verdict.json --call "<Tony's words, verbatim>"`.
   The tool refuses without a real call (no "pending"), on a verdict made on a dirty tree, on a tree dirty now,
   and when the fingerprint (assumptions, both sim files, `weapons.json`, `perks.json`) moved since the verdict.
   So run the review on a clean, committed tree. A pending review stays out of the log: the log starts empty
   and holds decisions only. It is append-only: a new decision is a new section, never an edit.
8. **Ship separately.** A pass is not a change to `weapons.json`. The row edit, its tests and the Balance rules
   row go through the normal land lane, and quote the decision section.

## Rules

- State the invented assumptions every time you report a verdict, in chat as well as in the doc.
- A scaled run (`--reps-scale`, tests only) is never a verdict and `--record` refuses it.
- Do not run repo setup scripts or anything that touches a gun. The review is desk work.
- One seed (`SEED`), fixed reps: the same input gives the same verdict. If a re-run differs, a catalogue file
  changed underneath it: check `git status` before you trust either number.
- Tests: `cd mcp && python3 run_tests.py test_balance_review`.
