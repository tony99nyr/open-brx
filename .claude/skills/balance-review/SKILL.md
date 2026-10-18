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
   A change to the scenario list bumps `SCENARIO_VERSION`, and is its own reviewed change. The current
   version is 8. Add `--haze` for the hidden AR + Haze comparison. Use `--haze-blind-ms N` to set its
   blind window for a sensitivity run.
4. **Read the verdict.** Each test is pass, fail or n/a, with its numbers:
   - `value_addition`: near the top in at least one scenario, or a trigger mechanic the arsenal lacks
     (overheat, charge, burst, bolt, shell reload, two-word pull). A stat change alone is not a mechanic.
   - `no_domination`: no kit near the top in every scenario.
   - `viable`: the plain primary's field ratio clears the floor, and its full kit beats another kit in a 1v1
     band. A sidearm instead finishes 35 HP inside the R10a bar.
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

Scenario version 8 uses these models:

- The two catalogue `heat` blocks control lockout. The crossing round fires. The Charge Rifle cools between
  rounds by default, then clears after its timed lockout. Cooling while firing is unproven (F575); each
  verdict that touches a heat weapon runs with `HEAT_COOL_WHILE_FIRING` on and off. In the off case,
  heat does not cool; a lockout resets heat to zero. The Energy Rifle vents through its reload lever.
- A lethal secondary can cover an empty or heat-locked primary. The kit also draws it when its expected finish
  time, including the swap, is shorter. Estimate the real shot sequence, including bolt and charge cycles,
  magazine and reserve reloads, and count the first shot at draw time. Reject a secondary that cannot finish
  the remaining pool with its magazine and reserve reloads. Swapping back pays the same catalogue swap delay.
  Combo kits keep their opener and finisher plan. A support secondary does not enter the ordinary finish choice.
  Reloads and lever vents progress only while that weapon is in hand. A swap credits a finished reload.
  A swap cancels an unfinished reload or vent. When cooling is on, heat cools while holstered.
- Armour Piercing uses the primary row's `ap_dmg` and `ap_fire_ms`. Its hit drains health directly, past shield
  and armour. It removes the headset word. A primary without both values cannot carry the perk.
- Toxin Rifle damage over time refreshes on a new hit and does not stack. Each tick drains shield, then armour,
  then health. A tick can kill after the shooter stops.
- `--haze` reports AR + Haze against reference kits at close and mid range. A landed Haze opener blinds the
  target for `HAZE_BLIND_MS` (3,000 ms by default), keyed by the row's `sir_fn` 23. A non-lethal Haze hit
  deals no damage. The shooter then pays a swap to its primary. Haze remains outside the shipped kit matrix
  while it is hidden.
- The matrix has a `1v1 real aim` column at `REAL_AIM` 0.4. The existing 0.9 aim columns remain. The real aim
  value gives about 0.38 landed hits per round for a mid rifle at mid range.
- The field sim uses hit probability 0.35, mean contact 3 seconds and mean ordinary gap 70 seconds. A respawn
  has a separate mean seek delay, currently `DEFAULT_RESPAWN_SEEK_MEAN_S` 7 seconds. An attacker
  who waits for a defeated target's respawn seeks that target first. A stale seek cannot replace a live
  engagement.
- Semi-automatic fight shots use `FIGHT_OVERSHOOT_MS`, an additive lognormal overshoot after the row's `t14`.
  Its fitted median is 36.67 ms, from the USP, AMR and Desert Eagle field medians.
  The bolt lever and the press after it retain the ordinary pull model.
  The published `compile.py` `ttk_ms` still uses its 300 ms pull for semi weapons, so
  its semi-weapon TTK differs from the fight sim.
- A close-range kit can finish a weak target with the catalogue melee row's damage and cooldown. The swing uses
  `MELEE_SWING_MS` 150 ms. `MELEE_HIT_P` 0.9 is the hit chance at aim 1; aim and blindness
  scale it. The rush model limits it to `MELEE_REACH_M` 6 metres. Melee is excluded from the published TTK.
- Heat cooling while firing is an unproven assumption pending bench check F575. The default is on, matching
  the catalogue cooling rate; `--heat-cool-while-firing off` disables cooling entirely.
  A lockout resets heat to zero.
  Heated sidearm R10 pairs use the kit engine. The CI rule engine has no heat state.
- The report checks every marksman and combo kit against plain AR, SMG and Shotgun rushers from 20 m and 30 m.
  `marksman_rush_counter` still gates the plain AR rush from 20 m. The report shows 30 m beside it.
- `hill hold` is the mean chance to kill two close attackers of each reference kit (AR, SMG and Shotgun).
  The second attacker arrives 3,500 ms after the first. The holder fights the first attacker alone until then.
  The holder is alert and can fire when the second attacker arrives, with no reaction delay.
  The second attacker waits a reaction delay after arrival before firing.
  Each reference attacker carries the baseline world's Deagle. The holder cannot leave the circle.
  The report also shows long-range overwatch by marksmen, combo kits and the AR without escape.
  Close contests start with both kits alert.
- `ammo stress` is kills in one life against a mid-range stream of plain AR attackers, divided by the
  baseline plain AR kit's kills under the same rules. The holder fires at 0.4 aim and the attackers at
  the invented 0.2 aim. Range-band fit is off, so the column compares ammunition rather than band reach.
  The holder's pool heals after each kill. Ammunition, reloads and heat persist.
  The holder wins the exchange while able to fire. Incoming rounds land only during reload, vent,
  heat lock, swap or dry down time (`AMMO_STRESS_DOWNTIME_ONLY`). Bolt kits, including combos with a bolt
  slot, score n/a. Their whole bolt cycle is down time, so this rule measures exposure instead of ammunition.
  Only ammo stress credits each chain-reload shell separately and lets the holder fire between shells.
  This Shotgun behaviour is unproven on a gun. Other scenarios credit the full reload at completion.
  The next attacker arrives 1,500 ms
  after the last fight. An attacker arriving during down time starts after a normal reaction delay.
  Otherwise, it reacts 1,000 ms after the holder's first landed hit.
  After four kills, one AMMO pickup tops each held slot's reserve to its compiled spawn reserve.
  A pending reload delays the top-up until that reload ends. The pickup leaves the magazine alone.
  The holder reloads or vents the primary under fire. It draws the secondary when the primary has no rounds.
  The model caps the stream at 128 attackers and
  reports how many reps reach the cap. Direct calls without cap reporting raise an error on a cap hit.
  A life ends when the holder dies during down time or all held slots have no rounds. The report counts
  dry, reload, heat or vent, swap and cap endings per kit. A fight can last 120 seconds. An unresolved
  fight raises an error instead of ending the life.
- The pistol finisher report pairs every visible sidearm with every shipped primary.
  It starts when the primary runs dry with 35 HP left at close range. It compares swapping and finishing with reloading
  the primary, and reports the R10a 1,200 ms bar. The pistol path uses R10a's sampled median, including misses and
  reaction, plus the kit swap. The primary reload path uses the expected finish time and mean reaction.
  The sidearm `viable` test keeps its existing rule.
- `hill hold` uses a 0.05 absolute near-top margin. `ammo stress` uses a 0.10 relative margin.
  Both enter `value_addition`,
  `no_domination` and the last-near-top check in `balance_kept` through the matrix.

Read `assumptions()` in each verdict for the exact values used by that run. Treat `--haze-blind-ms` as a
scenario parameter, and report its value with the Haze comparison.

- State the invented assumptions every time you report a verdict, in chat as well as in the doc.
- A scaled run (`--reps-scale`, tests only) is never a verdict and `--record` refuses it.
- Do not run repo setup scripts or anything that touches a gun. The review is desk work.
- One seed (`SEED`), fixed reps: the same input gives the same verdict. If a re-run differs, a catalogue file
  changed underneath it: check `git status` before you trust either number.
- Tests: `cd mcp && python3 run_tests.py test_balance_review`.
