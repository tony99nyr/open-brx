# Adding an Open BRX weapon

Adding a row to `weapons.json` is only the first step. A weapon is supported when Mission Control can
offer it, every victim can interpret its IR word, the phone can run any off-gun effect, and a field build
that lacks that behaviour is stopped before the whistle.

## 1. Start from evidence

1. Capture the closest Callsign weapon and keep its complete `$WEAP` frame in
   `mcp/brx_mcp/mc/weapons.json` under `capture.frame`. If there is no direct capture, use `based_on`
   with the source weapon and a plain explanation of the choice.
2. Put only deliberate changes in `wire`. Do not reconstruct or normalise tokens that the capture can
   preserve.
3. Record new hardware or protocol facts in `protocol/` or `docs/manual/`. Record balance choices in
   `docs/weapon-design.md`. Leave an unresolved claim in `docs/FOLLOWUPS.md` instead of presenting it as
   measured.

The capture tools and raw-trace locations are in `docs/capture-runbook.md`. The `$WEAP` token map is in
`docs/manual/dev.md` and `protocol/callsign-extract/protocol-classes.md`.

## 1b. Run the balance review and log Tony's call

This step is mandatory for a new weapon and for any change to a weapon number. Do it before you write code.

1. Write a candidate file outside the repo. For a new weapon, use a full `weapons.json` row. For a change, use
   `{"weapon_id": ..., "changes": {...}}`.
2. Run `python3 mcp/tools/balance_review.py --candidate <file.json> --out <verdict.json> --report <report.md>`.
   The exit code is 0 for PASS and 1 for FAIL. Do not change a constant or a margin to get a pass.
3. Show Tony the report. Tony makes the call, whatever the verdict says.
4. Record the call in [`balance-decisions.md`](balance-decisions.md) with `--record --call "<Tony's words>"`
   (or `--record-from <verdict.json> --call ...`). It is the only file the tool writes.

The `balance-review` skill (`.claude/skills/balance-review/SKILL.md`) holds the full loop and the eight tests.

## 2. Define the catalogue row

Give the row a stable `weapon_id`, display name, slot policy, tags, class, magazine and reserve counts,
reload model, captured frame, and the smallest possible `wire` override. Run the catalogue derivation tests;
the compiler derives the public weapon view, resolved frame, balance figures, Mission Control picker, and
phone demo catalogue from this source. After any change to `weapons.json`, run
`python3 mcp/tools/gen_ui_catalog.py` to refresh the generated catalogues. If you changed `types.py`, also run
`python3 mcp/tools/gen_contract.py`.

A plain-damage weapon that should be able to carry Armour Piercing needs the pair `ap_dmg` and `ap_fire_ms`
in its row. Without both, the compiler refuses the perk on that weapon (`_refuse_if_ap_ineligible` in
`compile.py`). Price the pair by the method in [`weapon-design.md`](weapon-design.md) §7.7. A charge weapon, a
one-shot weapon and a weapon on a headset-multiplier cell stay refused.

If the weapon fires on a nonstock IR cell, declare its `sir_fn`. Mission Control then adds that row only
when a roster needs it. Never add a conditional weapon row to the permanent stock table. If the behaviour
continues after the hit, declare the node contract as well, such as Toxin's `dot` block. A support weapon
that intentionally cannot kill must say so with `lethal: false`; otherwise the validation gate treats a
missing row, a no-pool function, zero damage, or too little ammunition as an error.

## 3. Implement every runtime that owns part of the behaviour

Trace one shot end to end:

1. The shooter's resolved `$WEAP` frame emits the intended `<protocol, subtype>` cell.
2. Every possible victim receives a matching `$SIR` row in the live table and in private try-out mode.
3. The phone engine handles any behaviour the gun cannot provide, and clears it on death, respawn,
   reconnect, config replacement, and match end.
4. The HUD explains state that changes play, including a timer, pool, or status effect.
5. Mission Control refuses a phone build older than the first app release that implements a required
   node behaviour. Declare that release as `min_app` beside the mechanic in the catalogue row. A `dot`
   contract without `min_app` fails compilation, so an older, nominally compatible APK cannot play a
   partial version of the weapon.

Use a minor compatibility-tier bump for a general engine or bundle contract change. A narrowly scoped
weapon feature may use the catalogue's `min_app`, but the same change must bump `app/package.json`
and ship that build before the weapon becomes available in a field release.

## 4. Prove the whole path

Write the failing test first. At minimum, cover:

- catalogue and picker visibility in every allowed slot;
- resolved `$WEAP` cell, damage, cadence, magazine, reserve, and special fields;
- validation of the exact loadout that will be used, including combinations with another conditional
  weapon;
- a matching `$SIR` row in every compiled victim bundle and in the private try-out head;
- victim-side runtime behaviour and teardown for node-driven effects;
- fresh spawn, respawn, slot changes, and HUD state before the player pulls the trigger;
- generated catalogue and contract files;
- an old-app match-gate test when the weapon needs new phone behaviour.

Run focused suites while iterating, then `pnpm run test:all`. If phone or Mission Control UI changed, also
run `pnpm run test:all -- --ui`.

## 5. Field proof before calling it shipped

On the release APK, try the weapon from Mission Control, arm a two-player game, and shoot both the gun body
and headset. Confirm the victim's pools, sound, light, vibration, HUD state, facts, and score. Repeat after a
slot swap and a respawn. For a node-driven effect, break contact and let its full timer finish. Save the
session report and promote any new protocol fact before enabling the weapon for normal play.

## Dogfood: Breacher and Toxin Rifle

Breacher is catalogue id `stripper`. It is built on the captured Suppressor frame (`based_on: suppressor`; no support weapon was ever captured), emits `<5,0>`, and requests
function 20 through `sir_fn`. It is nonlethal and secondary-only, so validation must accept it beside a
lethal primary while every victim gets its conditional row.

Toxin Rifle is catalogue id `toxin_rifle`. It emits `<11,0>`, requests plain-damage function 1, and declares
the poison clock in `dot`. The gun owns the direct hit; the victim phone owns the five-second poison effect,
HUD status, kill attribution, and teardown.

The 2026-09-20 playtest exercised Toxin primary plus Breacher secondary. The match compiler accepts that
exact pair and puts both conditional rows in every victim bundle. The private try-out compiler now builds
the same catalogue-driven SIR table instead of clearing the gun and restoring only `<0,0>`. The remaining
release boundary is explicit: the field APK used that day predated Toxin's phone engine, so a build without
that engine must never be allowed to start a Toxin match.
