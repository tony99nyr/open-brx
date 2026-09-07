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
4. ✅ FIXED (93357c9 — after Tony hit it live) **Kit has no gun-binding affordance** — roster rows say NO GUN but only auto-adopt/API can set it. An
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

## Round 4 — fresh-eyes critic (independent agent, full report in session log) + triage
25 ranked findings; the three "do-not-lose" strengths noted: HUD glance hierarchy (corner anchors/sizes),
the honest distributed-system microcopy semantics, and the single design system + two-step-confirm pattern.

**Confirmed + already fixed this round:** #4 armory GO gate (aae3209, plus Tony independently hit it live —
the board also presented 11-hour-old data as current: now aged/decayed server-side fields).

**Fix next (behavioral, code):**
- #5 PUSH CONFIG & ARM is one click doing push AND start — verified in Lobby.tsx (pushAndArm). Split.
- #2 TAKING FIRE is a persistent low-HP state, not a damage event — event-triggered with decay; keep firevig for low HP.
- #3 KILL overlay fully occludes combat view ~2.2 s — shrink to non-occluding top banner.
- #6 PANIC gives zero UI acknowledgment — persistent "FLEET SAFED n/N" banner.
- #7 join QR buried in the 10px status bar — big QR panel on Armory (it has the dead space).
- #8 "KITTED" ignores gun binding — predicate or "· 1 NO GUN" warn.
- #20 no font fallbacks → field LAN (no internet) collapses to serif. Add stacks now; self-host later.
- #15 mode-card click re-applies defaults over tuned settings — apply on change only (+undo toast later).
- #9 global 900 ms long-press flips night blackout — diag-only.
- #17 RECALL/RESCHEDULE lack the two-step confirm the rest have.
- #23 DOWN copy must say "GO TO A RESPAWN SCANNER" in scanner mode.
- #14 team-red === alarm-red — shift team hue. #19 NEW MATCH should be primary on recap.
- #24 demo button off the player path; in-use rows not tappable. #25 dead COMPANION row, FFA chip, unlabeled clip number.
- #12/#13/#16/#18/#22: copy + tiny-text sweep (labels ≥11px when they carry meaning; human wording on the HUD;
  spec jargon out of operator copy; status-vocabulary legend).
**Design-tool scale (Tony's pass or a dedicated block):** #1 daylight/sun theme (the field-critical one),
#11 fixed-stage scaling / portrait handling, #17's pinned control rail, #21 write-failure toasts.

## Round 5 — live-bench driven (Tony at the desk)
- ✅ Armory board: STANDBY gate + stale-decay card + real age field (aae3209); phantom-node prune (7bad3b6).
- ✅ Armory/Build redesign after Tony's "horrendous" verdict (f27aa6c): mode boards uncropped at native
  aspect (they carry baked-in text), real NodeCards/GhostCards, screen width capped 1380px.
- ✅ Kit gun picker (93357c9). Suite at 34/34 (run 7); e2e caught-and-fixed along the way: shared-context
  localStorage collapsed both HUD pages into one node_id; an inline comment swallowed the config envelope
  spec (every config push silently dropped — third silent-drop incident: assert DELIVERY, not just send).
- brx-opus session took the HUD lane: tap targets ≥44, labeled plates, human status copy, tiny-text sweep.

## Round 6 retrospective — why Tony's finds slipped past a 34/34 suite, and what changed
Slips and their mechanism:
1. **HUD stuck on MATCH COMPLETE after NEW MATCH** — the suite asserted `engine.phase === 'kitted'`,
   which was ALREADY true underneath the over screen. Lesson: assert the RENDERED SCREEN (visible text,
   visible buttons), never internal state, for anything a human reported seeing.
2. **Dead GO chip** — the suite navigated by the stepper, so the CTA a real operator clicks was never
   clicked. Lesson: the suite must walk the operator's actual path (now: CONTINUE ▸ chain end to end).
3. **Night-ops layout broken** — night mode was simply never rendered by any test. Lesson: every visual
   MODE (night, cam-on, short viewports) needs its own sweep, not just every screen.
4. **Result-screen overlap on the real phone** — one fixed desktop-ish viewport; the phone is shorter.
   Now: overlap audit re-runs at a short viewport.
5. **Reload/pips wrong on real guns only** — the fake gun echoed only slot 0; real config echoes carry
   other slots' clip caps. Lesson: the fake gun must reproduce the FULL bench-captured frame traffic.
6. **Cam passthrough black** — genuinely device-only (native preview under the webview). Boundary is now
   explicit: device-only checks live in the bench checklist, not the browser suite.
Process changes (implemented in tools/e2e.mjs): screen-truth steps for every reported issue; the
CONTINUE-path walk; voice-preview asserted at the GUN (fakegun.writes); reload thresholds + pip counts;
short-viewport overlap re-audit; diag-panel content assertions (no PANIC, SHARE LOG ships); runway
presets. Night sweep lands with the night fix. Rule going forward: every user-reported bug becomes a
screen-truth e2e step BEFORE the fix is written.

## Round 7 — Tony hit the GAMES/DESIGNER pages live (2026-08-27 evening): "riddled with issues, smells like poor testing"
What he saw: a crash banner (`cannot read 'preset' of undefined`), every designer tile disabled with "0 OF 18",
raw class numbers on tiles, template buttons that did nothing. One root cause: **today's UI bundle against an MC
process started before today's server code** (no `loadout_policy`, no `role`, `/api/loadout/pool` 404). Why no
test caught it: every test ran the UI and the server from the same tree at the same moment, so "new UI, old
server" had zero coverage — and the designer swallowed the failed calls (`.catch(() => {})`), so controls looked
broken instead of saying why. Fixed + guarded:
- UI tolerates a config without a policy; a stale MC raises a **"THE MC SERVER PREDATES THIS UI — RESTART IT"**
  banner; the designer's templates are client-side rules (no round-trip to click); a missing pool preview means
  "everything allowed" with a visible notice; no raw class ids on tiles.
- e2e **F8b compat-older-server**: the same UI against stripped responses + 404'd A10 routes, walking every page
  and clicking the designer's controls; proven to fail on the pre-fix bundle.
- e2e **F8a designer-controls**: every designer control clicked on the real stack, each asserted by what the host
  SEES (summary text, counts, the rail, the saved card).
- `ONLY=<step-substring> node tools/e2e.mjs` runs one step in isolation (steps that stand alone self-navigate).
Rules adopted: (1) a user action whose API call fails must show it — never `.catch(() => {})` on an action;
(2) every control in a new screen gets a screen-truth assertion before the screen is called done; (3) any UI
that depends on a new server route gets a compat step against a server without it.

## Round 8 — reviewer team (3 lenses × adversarial verification; 28 agents) after Tony's "this whole selection is busted"
24 confirmed. The designer's chips/tiles were dead because the pool came only from a server preview whose
stale-server fallback ignored the edits — fixed by computing the pool on the client from the rules being edited.
Then the team found what the suite had missed:
- **Identity by content**: GAMES marked the wrong saved game PLAYING after DUPLICATE / SAVE AS NEW (a copy is
  content-identical to its source) → the server now records `active_preset_id` on apply; GAMES prefers it.
- **A rejected host pick** on KIT was blamed on the phone ("CHANGED FROM THEIR PHONE"), started a try-out of the
  refused weapon, and the error strip was wiped → the pick is recorded and the try-out fired only after a
  confirmed write.
- **The stale-server e2e step never starved the UI**: `page.route` cannot touch the WebSocket, so the snapshot
  arrived complete → `routeWebSocket` strips it now. Plus: designer controls asserted by what is visible (tile
  opacity/filter), tap/tiny-text audits on GAMES/DESIGNER/KIT with failures not findings, the Kit gun `<select>`
  finally driven, tautologies removed, a pre-A10 session fixture booted via `--session-file`, bundle-freshness
  check at boot, duplicate→play-copy and failed-PATCH steps.
- **Rule model legibility**: chip ON / ◐ partial (1/5) / OFF with a one-line legend; a hint under WHO PICKS that
  changes with the choice; FIXED shows candidates at full opacity and "TAP THE WEAPON EVERYONE GETS"; "PERKS ONLY"
  instead of "0 OF 18 WEAPONS"; slot-2 who-picks in every summary line; "PLAYER picks" reads HOST when phone picks
  are off; a hand-built NO HEAVIES reads NO HEAVIES; discard guards on BACK TO GAMES and on playing another card
  while the draft is TUNED — NOT SAVED; PLAY THIS NOW says it won't save an unnamed game; COPY / MAKE MY OWN open a
  draft (nothing written until SAVE); one verb per situation (CUSTOMIZE stock · EDIT yours · COPY a saved game).
Refuted: 1 (race-pattern claim). Low, left: stepper "PHASE" shows the browsed tab; tablet rail order; BASE legend
now in the rail footnote.
