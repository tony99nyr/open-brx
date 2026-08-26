# Critical design review — MC web UI + phone HUD (2026-08-26)

Standing: per Tony, the Claude-Design exports were **inspiration, not definitive** — visibility,
practicality, contrast and layout may diverge as the product hardens. This file tracks the critique and
what was changed. Evidence: `app/shots/e2e/` (suite screenshots), WCAG numbers computed from tokens.

## Objective failures (fix now)
1. **MC `micro` token 3.8:1 on page/panel — WCAG fail.** Used for half the app's labels (hints, captions,
   armory meta, "SELECT TO ARM"). → FIXED: `#5c7186` → `#71879c` (≥4.5:1, still muted).
2. **Recap kicker illegible** — rendered light-on-white against the winner band. → FIXED: kicker in `dim`,
   z-raised, margin below before the band.
3. **Honors with tiny rosters read as parody** — → FIXED: no honors/medals under 3 scored players; MVP and
   MOST KILLS require kills > 0; SURVIVOR requires someone to actually outlive the field and now reads
   "FEWEST DEATHS · N" (both `scoring.honors()` and `compile.award_medals`, with tests).
4. **Kit has no gun-binding affordance** — roster rows say NO GUN but only auto-adopt/API can set it. An
   operator manually pairing a walk-up player cannot do it from the UI. → add a gun picker to the Kit
   detail panel (armory guns not yet bound, + UNBIND).

## Found by the e2e suite while reviewing (fixed)
- **END TRY-OUT never reached the phone** — MC popped local state only; the player's HUD stayed in try-out
  and the gun stayed armed. → MC now pushes `tutorial {end, frames}` teardown; the engine quiets the gun and
  drops the panel. Second occurrence of the same contract trap: the envelope silently DROPS a frame missing a
  required field (`tutorial.weapon`, like `feedback.player_id` before) — `weapon` is now optional on both
  sides. Rule of thumb adopted: every MC push path needs a node-side delivery assertion in the e2e suite.

## High-value UX (queue)
5. **HUD non-cam layout** — the camera-overlay treatment (scrims, vignette, thin skewed chips) without a
   camera behind it wastes the screen and reads dim. Design-tool pass (Tony) — tracked in FOLLOWUPS.
6. **Armed screen runway seg mid-countdown** — → FIXED: relabeled "RESCHEDULE TO" (it feeds the
   RESCHEDULE button; it is not a live control).
7. **HUD camchip 32px tall** (raised from 24) — still under the 40px comfortable glove-tap size; the
   whole top-right cluster is at the edge of field-usability. Part of the non-cam redesign.
8. **MC LIVE event feed placeholder** ("WAITING FOR THE FIRST SYNC POINT…") is good; but K/A/ACC columns
   silently dash mid-match on a park — the "MC-DERIVED, RECONCILED AT SYNC POINTS" footnote carries a lot
   of weight in 9px micro text. Consider a one-time banner on first LIVE entry.

## Verified good (keep)
- HUD tokens all pass contrast (mut ≈7:1, numerals 17:1); T-MINUS / DOWN / redeploy moments are strong.
- MC lobby 3-step strip (READY → PUSH → ARM) with the disabled-until-green gate matches the A5/A6 flow.
- Two-step confirms everywhere destructive (ABORT / END / PANIC / EVICT) — consistent and testable.
- Weapon/mode art integration (2026-08-26) lifts Kit/Build from wireframe to product.

## Process
The e2e suite (`npm run ui:e2e`) is the regression net for all of the above: it drives both UIs through
every flow, audits animations/tap-targets/aria/console errors, and screenshots each step.

## Round 3 (Tony's questions ARE findings)
- **Kit detail panel: bare "2" chip + "FRAME PROVISIONAL"** — the operator had to ask what they mean.
  The chip is the raw BRX `$WEAP` class id (protocol plumbing); the badge means the weapon's frame is a
  template, not hardware-verified (only AR + Charge Rifle are). → chip becomes "CLASS n" with a tooltip;
  badge gets a tooltip; rule: no UI element whose meaning needs the protocol doc.
