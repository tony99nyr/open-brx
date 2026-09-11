---
name: ui-build-verify
description: How to build or change a web/app UI so it actually works for the person who opens it — not just in a fresh same-tree demo. Use this skill whenever you are asked to build, redesign, add, or fix a screen, page, panel, flow, control, or "UX" in any frontend (React/TS, vanilla JS, a phone web-view, an operator console), whenever a UI change depends on a new server route or field, and whenever the user reports "this control does nothing", "it's disabled", "it crashed", or "you should have caught this". It covers contract-first building, verifying in a REAL browser against a fresh AND a stale server, screen-truth assertions for every control, no swallowed errors, reviewer-team passes, and what "done" means. Also use it when writing or auditing UI e2e tests — many suites pass while the UI is broken, and this skill explains why and how to fix that.
---

# UI build & verify

This skill exists because of one bad afternoon: a UI shipped with "verified in browser, e2e 56/56", and the
owner opened it and found a crash, every control disabled, and buttons that did nothing. Every single
failure had the same shape — *the UI was only ever exercised against a fresh server built from the same
tree, on the happy path, with errors swallowed*. The tests said "pass" because they asserted internal state
and API responses, not what a person sees. Everything below is the fix for that shape.

## The mindset

The person who opens your UI is running **whatever server process they started this morning**, with
**whatever data their last session persisted**, and they will click **every control in the order that
occurs to them**. "Works on my demo" is not a claim about their screen. Your job ends when you have seen it
work under those conditions — or when the UI *tells them* why it can't.

## 1. Contract first, then build against it

Before writing UI code for anything that crosses the server boundary, pin the contract in a doc (field
names, message shapes, who owns what). Then build every surface against that doc, not against each other.
Why: when three lanes (server, UI, phone) build in parallel from one written contract, mismatches show up as
"the doc was wrong" instead of as runtime crashes the user finds.

- New server field or route? Write down what the UI does **when it is absent** (older server, older
  persisted session). A UI that assumes a field exists will crash on `undefined.something` the first time a
  real process is a version behind.
- Keep one rule engine. If the UI needs to preview a rule result (a pool, a filter, an eligibility), either
  compute it **on the client from the same rules** or call the server — never "call the server, and if that
  fails show everything allowed". A fallback that ignores the user's edits makes every control look dead.

## 2. Build for the failure the user will actually hit

- **Never swallow an action's error.** `promise.catch(() => {})` on a user action turns a failure into
  "the button does nothing". Route action errors to the visible error strip / toast. Silent catches are
  acceptable only for background list fetches, and even then the *absence* should show ("no saved games yet",
  "server predates this UI").
- **Detect version skew and say it.** If a route the UI needs 404s, show a banner: "THE SERVER PREDATES
  THIS UI — RESTART IT". Give the user the command. A degraded page with an explanation beats a page that
  seems broken.
- **Check the result before the consequence.** If an action is "save then apply" or "patch then start
  try-out", branch on the first result. Firing the second step after a failed first step produces
  contradictory UI (a rejected pick reported as someone else's change, a try-out of a refused weapon).
- **Identity is never content.** Marking "which saved thing is active" by comparing content breaks the
  moment two things share content (a duplicate). Have the server record the applied id.
- **Every control must visibly respond.** After any tap: a count, a highlight, a summary line, a card state —
  something a person can see changes. If a tap legitimately does nothing (locked, off), the control should
  say why (padlock + reason), and it should not look tappable.
- **Explain the model on screen, not in tooltips.** If controls interact (a class chip vs individual tiles
  vs "who picks"), one legend line under the controls and a hint that changes with the selection. Partial
  states need their own look (◐ 1/5), not the "on" look.
- **Confirm discards.** Leaving an editor with unsaved edits, or tapping a card that replaces a tuned-but-
  unsaved draft, asks once (an inline two-tap confirm, no modal).
- **Tap targets ≥36–44 px, text that carries meaning ≥11 px**, on the pages you touched. Global primitives
  (segmented controls, toggles, chips) are where undersized targets hide — fix the primitive, not one use.

## 3. Verify in a real browser — the checklist that is "done"

Do all of these before saying "verified". Screenshots are evidence; describe what they show.

1. **Fresh server, happy path**: every new screen renders; walk the user's real path (the CONTINUE buttons,
   not the nav stepper).
2. **Click every control** you added or changed and assert the visible result of each one — counts,
   dimming (`getComputedStyle(el).opacity`/`filter`), `aria-pressed`, summary text, the rendered card. One
   control per step so a failure names the control.
3. **Stale server**: the same UI against responses missing your new fields and with your new routes
   returning 404. In Playwright, `page.route('**/api/**')` strips REST — but **it cannot touch a WebSocket**;
   use `page.routeWebSocket` to strip pushed snapshots too, or the "stale" run is a lie. Every page must
   render, the controls must still work locally, and the skew banner must be visible.
4. **Old data**: boot the server from a persisted session created before your change (a fixture file) and
   open every page.
5. **Failure paths**: intercept one action's request and return 400/500 — the error must show, and no
   follow-on effect may fire.
6. **Small viewports** the product targets (tablet, phone landscape, short height); night/high-contrast
   modes if the product has them.
7. **Audits**: tap-target and tiny-text sweeps on the pages you touched, and make undersized *primary
   controls* fail the run, not just print a finding nobody reads.
8. **Lint/typecheck clean**, and the **served bundle is rebuilt** — a stale `dist` is the second most common
   reason "it works for me". Have the e2e boot refuse to run when `src` is newer than the bundle.

If any of 1–8 is skipped, say so explicitly in the report ("not run: old-data boot"). Never write
"verified" for a step you didn't run.

## 4. Tests that can't pass while the UI is broken

A UI e2e step is worth having only if it would fail on the bug you're guarding against. Patterns that
produce false passes, and their fixes:

| False-pass pattern | Fix |
|---|---|
| Asserting engine/API state (`state.phase === 'kit'`) | Assert the rendered screen (visible text, visible buttons, computed style) |
| Waiting for text that is always on the page | Wait for the text that *changes* after the action |
| `expect(dis \|\| true)`, counting elements that always exist, "no crash banner" as the only check | Assert the specific value; click the control and assert the change |
| Navigating by stepper/API instead of the user's buttons | Walk the CONTINUE path the user walks |
| Skipping a step when a route 404s ("not up yet") | Hard-fail; if the route is optional, that's a product decision to write down |
| Stripping REST responses to fake an old server | Also strip the WebSocket (`routeWebSocket`) |
| One giant step with 20 assertions | One control per step; forensics (screenshot + button inventory) on failure |
| Suite spawns a server from the same tree only | Add a stale-server step and an old-session fixture boot |
| Audits that only log findings | Fail on undersized primary controls; exclude decorative regions (nav digits) from tiny-text so real hits aren't buried |

Give the suite an `ONLY=<step>` switch so one step can run alone (steps must self-navigate), and make it
refuse to run on a stale bundle. See `references/playwright-patterns.md` for copy-paste snippets.

Rule adopted: **every user-reported UI bug becomes a screen-truth step before the fix is written**, so the
fix is proven by a test that failed first.

## 5. Review before delivery — and let reviewers be adversarial

Your own screenshots are the weakest review. After the checklist:

- Run a **critical review team** with distinct lenses (or, without a spawn tool, the same lenses yourself one
  after another), each verified adversarially (default to
  "not reproduced" unless the verifier *sees* it): (a) a browser-breaker that clicks everything on fresh
  and stale servers; (b) a suite auditor asking "which assertions are tautologies, what user-visible
  behaviour is never asserted, does it ever run against anything but a fresh same-tree server"; (c) a
  first-use UX critic who reads the rule model as a stranger. Confirmed findings become fixes *and* test
  steps; refuted ones are dropped.
- Act on the audit output. A report that lists 38 UX findings nobody reads is not a review.

## 6. Reporting

State outcomes plainly: what was run, what passed, what was skipped, what the user must do (e.g. "restart
your server — it predates this UI"). Send the screenshots. If the user found something first, say what
condition was untested and why, then add the test that would have caught it — don't explain, ship the test.

## Quick self-check before you say "done"

- Did I click every control I added, against a stale server too, and watch the screen change?
- Is any `.catch(() => {})` on a user action still in my diff?
- Does the served bundle contain my change?
- Would my new e2e step fail on yesterday's build?
- Did a reviewer other than me try to break it?
