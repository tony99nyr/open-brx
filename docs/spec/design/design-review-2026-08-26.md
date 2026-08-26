# Critical design review — MC web UI + phone HUD (2026-08-26)

Standing: per Tony, the Claude-Design exports were **inspiration, not definitive** — visibility,
practicality, contrast and layout may diverge as the product hardens. This file tracks the critique and
what was changed. Evidence: `app/shots/e2e/` (suite screenshots), WCAG numbers computed from tokens.

## Objective failures (fix now)
1. **MC `micro` token 3.8:1 on page/panel — WCAG fail.** Used for half the app's labels (hints, captions,
   armory meta, "SELECT TO ARM"). → FIXED: `#5c7186` → `#71879c` (≥4.5:1, still muted).
2. **Recap kicker illegible** — "[ A8 // MATCH COMPLETE · … ]" renders light-on-white ON the winner band.
   → fix: dark ink on the band, or move the kicker off the band.
3. **Honors with tiny rosters read as parody** — 1 player gets MVP ("0 K · 0.0 K/D"), MOST KILLS
   ("0 ELIMINATIONS") and SURVIVOR ("1 DEATHS"). → gate honors: no medals under 3 scored players or when
   every candidate value is 0; "SURVIVOR · 1 DEATHS" copy is wrong regardless (fewest deaths ≠ survivor).
4. **Kit has no gun-binding affordance** — roster rows say NO GUN but only auto-adopt/API can set it. An
   operator manually pairing a walk-up player cannot do it from the UI. → add a gun picker to the Kit
   detail panel (armory guns not yet bound, + UNBIND).

## High-value UX (queue)
5. **HUD non-cam layout** — the camera-overlay treatment (scrims, vignette, thin skewed chips) without a
   camera behind it wastes the screen and reads dim. Design-tool pass (Tony) — tracked in FOLLOWUPS.
6. **Armed screen shows the runway preset seg mid-countdown** — changing it does nothing until
   RESCHEDULE is pressed; it looks like a live control. → move the seg next to RESCHEDULE or label it
   "NEXT RESCHEDULE".
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
